/**
 * Earnest-money holds — wholesaler EMD inspection-period state machine (W-2).
 *
 * Trey's gap: "EMD goes to the title company on Day 0, sits in escrow during
 * the inspection period, is refundable until inspection-period expiration,
 * then becomes non-refundable. Where in AcreOS does that timeline live?
 * Nowhere I could find."
 *
 * Endpoints:
 *   GET    /api/earnest-money               — list, optional ?dealId / ?status
 *   POST   /api/earnest-money               — record a new EMD hold
 *   PATCH  /api/earnest-money/:id           — update status / notes / extend
 *   POST   /api/earnest-money/:id/release   — released_to_seller (closing)
 *   POST   /api/earnest-money/:id/refund    — refunded_to_buyer (within period)
 *   POST   /api/earnest-money/:id/forfeit   — forfeited (lost)
 *   GET    /api/earnest-money/at-risk       — currently-held EMD with
 *                                             refundable-until ≤ 7 days out
 *                                             (Trey's "EMD becomes non-
 *                                              refundable in 48 hours" view)
 *
 * Event trail (0086 writer wiring, 2026-11-19): every status transition —
 * creation included — appends exactly one row to the append-only
 * `earnest_money_events` log (migration 0086; UPDATE refused by 0239's
 * trigger). The table is deliberately UNMODELLED (founder Option A, S4
 * 0086): writes go through raw sql`` INSERTs, following the
 * push_subscriptions precedent in routes-organization.ts. The append runs
 * in the SAME transaction as the hold mutation and is fail-closed: if the
 * append fails, the transaction rolls back and the transition does not
 * persist — a status change without its trail is never silently accepted.
 * Non-transition updates (no status change) append nothing.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  earnestMoneyHolds,
  EARNEST_MONEY_STATUSES,
  type EarnestMoneyStatus,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { assertEntityBelongsToOrg } from "./utils/orgScope";
import { clientIpOrNull } from "./utils/clientIp";
import { clock } from "./utils/clock";
import { routeParam } from "./utils/routeParams";

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── earnest_money_events writer (0086) ─────────────────────────────────────
// Append-only discipline: this helper is the ONLY write path to the events
// table and it only ever INSERTs. Org deletion still removes events through
// the table's own FK CASCADE, which application code never issues directly.
interface EmdEventInput {
  organizationId: number;
  holdId: string;
  fromState: string | null;
  toState: string;
  amountCents: number;
  actorUserId: string | null;
  actorIp: string | null;
  actorUa: string | null;
  justification: string | null;
}

/** Anything carrying Drizzle's execute — `db` or a transaction handle. */
type EmdEventExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

async function appendEarnestMoneyEvent(exec: EmdEventExecutor, e: EmdEventInput): Promise<void> {
  await exec.execute(sql`
    INSERT INTO earnest_money_events
      (organization_id, hold_id, from_state, to_state, amount_cents,
       actor_user_id, actor_ip, actor_ua, justification)
    VALUES (${e.organizationId}, ${e.holdId}, ${e.fromState}, ${e.toState},
            ${e.amountCents}, ${e.actorUserId}, ${e.actorIp}, ${e.actorUa},
            ${e.justification})
  `);
}

/** Actor context for an event row, captured the way neighbouring routes do. */
function emdActorContext(req: AuthenticatedRequest): {
  actorUserId: string | null;
  actorIp: string | null;
  actorUa: string | null;
} {
  return {
    actorUserId: req.user?.id ?? null,
    // Stored-field IP: CF-Connecting-IP first, never bare req.ip (the
    // Cloudflare edge address) — see utils/clientIp.ts (DEFECT-0062).
    actorIp: clientIpOrNull(req),
    actorUa: (req.headers?.["user-agent"] as string | undefined) ?? null,
  };
}

const createSchema = z.object({
  dealId: z.number().int().positive().nullable().optional(),
  propertyId: z.number().int().positive().nullable().optional(),
  amountCents: z.number().int().nonnegative(),
  titleCompany: z.string().max(240).optional(),
  referenceNumber: z.string().max(120).optional(),
  depositedAt: z.string().min(1),
  inspectionPeriodDays: z.number().int().min(0).max(365).default(7),
  notes: z.string().max(4_000).optional(),
});

const patchSchema = z.object({
  amountCents: z.number().int().nonnegative().optional(),
  titleCompany: z.string().max(240).optional(),
  referenceNumber: z.string().max(120).optional(),
  // For contract-amendment-driven inspection extensions: bump the
  // refundable-until date forward.
  inspectionPeriodDays: z.number().int().min(0).max(365).optional(),
  refundableUntilAt: z.string().optional(),
  status: z.enum(EARNEST_MONEY_STATUSES).optional(),
  notes: z.string().max(4_000).optional(),
});

export function registerEarnestMoneyRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── List ──────────────────────────────────────────────────────────────────
  app.get(
    "/api/earnest-money",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const dealId = req.query.dealId ? parseInt(req.query.dealId as string, 10) : undefined;
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const conds = [eq(earnestMoneyHolds.organizationId, orgId)];
        if (dealId && !Number.isNaN(dealId)) conds.push(eq(earnestMoneyHolds.dealId, dealId));
        if (status && (EARNEST_MONEY_STATUSES as readonly string[]).includes(status)) {
          conds.push(eq(earnestMoneyHolds.status, status as EarnestMoneyStatus));
        }
        const rows = await db
          .select()
          .from(earnestMoneyHolds)
          .where(and(...conds))
          .orderBy(asc(earnestMoneyHolds.refundableUntilAt));
        return res.json({ holds: rows });
      } catch (err) {
        logger.error("emd.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── At-risk view ─────────────────────────────────────────────────────────
  // Trey's "EMD becomes non-refundable in 48 hours" surface. Pulls active
  // 'held' EMDs whose refundable-until is ≤ N days away (default 7).
  app.get(
    "/api/earnest-money/at-risk",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const withinDays = Math.min(
          90,
          Math.max(1, parseInt(String(req.query.withinDays ?? "7"), 10) || 7),
        );
        const today = clock.now().toISOString().slice(0, 10);
        const horizon = addDaysIso(today, withinDays);

        const rows = await db
          .select()
          .from(earnestMoneyHolds)
          .where(and(
            eq(earnestMoneyHolds.organizationId, orgId),
            eq(earnestMoneyHolds.status, "held"),
            sql`${earnestMoneyHolds.refundableUntilAt} <= ${horizon}`,
          ))
          .orderBy(asc(earnestMoneyHolds.refundableUntilAt));

        const totalAtRiskCents = rows.reduce((s, r) => s + r.amountCents, 0);
        return res.json({
          holds: rows,
          asOf: today,
          horizonIso: horizon,
          withinDays,
          totalAtRiskCents,
        });
      } catch (err) {
        logger.error("emd.atRisk failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Create ────────────────────────────────────────────────────────────────
  app.post(
    "/api/earnest-money",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;

        // Lens 48 — verify body-supplied FKs belong to the same tenant.
        // Without this, an attacker writes an EMD hold in their own org
        // but bound to another org's dealId/propertyId, contaminating
        // downstream finance reports that join across.
        if (data.dealId != null) {
          const ok = await assertEntityBelongsToOrg("deal", data.dealId, orgId);
          if (!ok) return Errors.notFound(res, "Deal");
        }
        if (data.propertyId != null) {
          const ok = await assertEntityBelongsToOrg("property", data.propertyId, orgId);
          if (!ok) return Errors.notFound(res, "Property");
        }

        const refundableUntilAt = addDaysIso(data.depositedAt, data.inspectionPeriodDays ?? 7);

        // Hold + its initial event commit or roll back together (0086):
        // from_state is NULL for the creation event and to_state is the
        // hold's initial status ("held" — recording means at title).
        const actor = emdActorContext(req);
        const row = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(earnestMoneyHolds)
            .values({
              organizationId: orgId,
              dealId: data.dealId ?? null,
              propertyId: data.propertyId ?? null,
              amountCents: data.amountCents,
              titleCompany: data.titleCompany ?? null,
              referenceNumber: data.referenceNumber ?? null,
              depositedAt: data.depositedAt,
              inspectionPeriodDays: data.inspectionPeriodDays ?? 7,
              refundableUntilAt,
              status: "held", // assume the act of recording = at title in escrow
              statusChangedAt: clock.now(),
              notes: data.notes ?? null,
            })
            .returning();
          await appendEarnestMoneyEvent(tx, {
            organizationId: orgId,
            holdId: created.id,
            fromState: null,
            toState: created.status,
            amountCents: created.amountCents,
            ...actor,
            justification: data.notes ?? null,
          });
          return created;
        });
        return res.status(201).json({ hold: row });
      } catch (err) {
        logger.error("emd.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Patch ─────────────────────────────────────────────────────────────────
  app.patch(
    "/api/earnest-money/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Load the hold first (org-scoped): the event writer needs the
        // previous status, and a missing hold is a 404 before any write.
        const [existing] = await db
          .select({
            depositedAt: earnestMoneyHolds.depositedAt,
            status: earnestMoneyHolds.status,
          })
          .from(earnestMoneyHolds)
          .where(and(eq(earnestMoneyHolds.id, routeParam(req.params.id)), eq(earnestMoneyHolds.organizationId, orgId)))
          .limit(1);
        if (!existing) return Errors.notFound(res, "EMD hold");

        // Recompute refundableUntilAt when inspectionPeriodDays changes
        // and refundableUntilAt isn't explicitly supplied.
        let derivedRefundableUntil: string | undefined = parsed.data.refundableUntilAt;
        if (parsed.data.inspectionPeriodDays !== undefined && !derivedRefundableUntil) {
          derivedRefundableUntil = addDaysIso(
            existing.depositedAt as unknown as string,
            parsed.data.inspectionPeriodDays,
          );
        }

        const update: Partial<typeof earnestMoneyHolds.$inferInsert> = {
          ...parsed.data,
          refundableUntilAt: derivedRefundableUntil,
          updatedAt: clock.now(),
        };
        if (parsed.data.status) update.statusChangedAt = clock.now();

        // A status CHANGE appends exactly one event in the same
        // transaction; a status-preserving update appends nothing (0086).
        const isTransition =
          parsed.data.status !== undefined && parsed.data.status !== existing.status;
        const actor = emdActorContext(req);
        const row = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(earnestMoneyHolds)
            .set(update)
            .where(and(eq(earnestMoneyHolds.id, routeParam(req.params.id)), eq(earnestMoneyHolds.organizationId, orgId)))
            .returning();
          if (!updated) return undefined;
          if (isTransition) {
            await appendEarnestMoneyEvent(tx, {
              organizationId: orgId,
              holdId: updated.id,
              fromState: existing.status,
              toState: updated.status,
              amountCents: updated.amountCents,
              ...actor,
              justification: parsed.data.notes ?? null,
            });
          }
          return updated;
        });
        if (!row) return Errors.notFound(res, "EMD hold");
        return res.json({ hold: row });
      } catch (err) {
        logger.error("emd.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Terminal-status convenience endpoints ────────────────────────────────
  // Each captures the final disposition amount + transitions status.
  for (const action of ["release", "refund", "forfeit"] as const) {
    app.post(
      `/api/earnest-money/:id/${action}`,
      isAuthenticated,
      getOrCreateOrg,
      ownerOrAdmin,
      async (req: AuthenticatedRequest, res: Response) => {
        try {
          const orgId = getOrganizationId(req);
          const parsed = z.object({
            finalDispositionAmountCents: z.number().int().nonnegative().optional(),
            notes: z.string().max(4_000).optional(),
          }).safeParse(req.body);
          if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

          const targetStatus: EarnestMoneyStatus =
            action === "release" ? "released_to_seller"
              : action === "refund" ? "refunded_to_buyer"
              : "forfeited";

          // Load the hold first (org-scoped): the default disposition is
          // the full hold amount, and the event writer needs the previous
          // status. A missing hold is a 404 before any write.
          const [existing] = await db
            .select({
              amountCents: earnestMoneyHolds.amountCents,
              status: earnestMoneyHolds.status,
            })
            .from(earnestMoneyHolds)
            .where(and(eq(earnestMoneyHolds.id, routeParam(req.params.id)), eq(earnestMoneyHolds.organizationId, orgId)))
            .limit(1);
          if (!existing) return Errors.notFound(res, "EMD hold");

          // Default disposition amount = full hold amount when not specified.
          const dispositionCents = parsed.data.finalDispositionAmountCents ?? existing.amountCents;

          // The terminal transition appends exactly one event in the same
          // transaction (0086). Re-applying the status the hold already
          // carries is not a transition and appends nothing. The event's
          // amount is the hold's recorded amount, not the disposition.
          const isTransition = existing.status !== targetStatus;
          const actor = emdActorContext(req);
          const row = await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(earnestMoneyHolds)
              .set({
                status: targetStatus,
                statusChangedAt: clock.now(),
                finalDispositionAmountCents: dispositionCents,
                notes: parsed.data.notes ?? undefined,
                updatedAt: clock.now(),
              })
              .where(and(eq(earnestMoneyHolds.id, routeParam(req.params.id)), eq(earnestMoneyHolds.organizationId, orgId)))
              .returning();
            if (!updated) return undefined;
            if (isTransition) {
              await appendEarnestMoneyEvent(tx, {
                organizationId: orgId,
                holdId: updated.id,
                fromState: existing.status,
                toState: targetStatus,
                amountCents: updated.amountCents,
                ...actor,
                justification: parsed.data.notes ?? null,
              });
            }
            return updated;
          });
          if (!row) return Errors.notFound(res, "EMD hold");
          return res.json({ hold: row });
        } catch (err) {
          logger.error(`emd.${action} failed`, err instanceof Error ? err : undefined);
          return Errors.internal(res, err);
        }
      },
    );
  }
}
