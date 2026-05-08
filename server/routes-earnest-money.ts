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

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
        const today = new Date().toISOString().slice(0, 10);
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
        const refundableUntilAt = addDaysIso(data.depositedAt, data.inspectionPeriodDays ?? 7);

        const [row] = await db
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
            statusChangedAt: new Date(),
            notes: data.notes ?? null,
          })
          .returning();
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

        // Recompute refundableUntilAt when inspectionPeriodDays changes
        // and refundableUntilAt isn't explicitly supplied.
        let derivedRefundableUntil: string | undefined = parsed.data.refundableUntilAt;
        if (parsed.data.inspectionPeriodDays !== undefined && !derivedRefundableUntil) {
          const [existing] = await db
            .select({ depositedAt: earnestMoneyHolds.depositedAt })
            .from(earnestMoneyHolds)
            .where(and(eq(earnestMoneyHolds.id, req.params.id), eq(earnestMoneyHolds.organizationId, orgId)))
            .limit(1);
          if (existing) {
            derivedRefundableUntil = addDaysIso(
              existing.depositedAt as unknown as string,
              parsed.data.inspectionPeriodDays,
            );
          }
        }

        const update: Partial<typeof earnestMoneyHolds.$inferInsert> = {
          ...parsed.data,
          refundableUntilAt: derivedRefundableUntil,
          updatedAt: new Date(),
        };
        if (parsed.data.status) update.statusChangedAt = new Date();

        const [row] = await db
          .update(earnestMoneyHolds)
          .set(update)
          .where(and(eq(earnestMoneyHolds.id, req.params.id), eq(earnestMoneyHolds.organizationId, orgId)))
          .returning();
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

          // Default disposition amount = full hold amount when not specified.
          let dispositionCents = parsed.data.finalDispositionAmountCents;
          if (dispositionCents === undefined) {
            const [row] = await db
              .select({ amountCents: earnestMoneyHolds.amountCents })
              .from(earnestMoneyHolds)
              .where(and(eq(earnestMoneyHolds.id, req.params.id), eq(earnestMoneyHolds.organizationId, orgId)))
              .limit(1);
            dispositionCents = row?.amountCents ?? 0;
          }

          const [row] = await db
            .update(earnestMoneyHolds)
            .set({
              status: targetStatus,
              statusChangedAt: new Date(),
              finalDispositionAmountCents: dispositionCents,
              notes: parsed.data.notes ?? undefined,
              updatedAt: new Date(),
            })
            .where(and(eq(earnestMoneyHolds.id, req.params.id), eq(earnestMoneyHolds.organizationId, orgId)))
            .returning();
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
