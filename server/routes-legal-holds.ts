/**
 * Phase 3 Week 11 — Legal-hold operator surface (Saskia, Lazlo, Margolis).
 *
 * Founder-gated routes for placing, listing, and releasing FRCP 37(e) legal
 * holds. Every action is audit-logged via `auditLog` (utils/auditLog.ts).
 *
 * Routes:
 *   GET    /api/founder/legal-holds                 — list all holds (active + released)
 *   GET    /api/founder/legal-holds/active          — list active holds only
 *   POST   /api/founder/legal-holds                 — place a new hold
 *   POST   /api/founder/legal-holds/:id/release     — release with justification (2-step)
 *   GET    /api/founder/legal-holds/banner          — banner payload for current org
 *
 * Customer-side:
 *   GET    /api/legal-hold/banner                   — current org banner status
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "./db";
import { legalHolds, LEGAL_HOLD_SCOPES, systemAlerts } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import { getActiveHoldSummary, orgHasActiveHold } from "./services/legalHold";
import type { AuthenticatedRequest } from "./types/request";

// ─── Validation schemas ─────────────────────────────────────────────────────
const placeHoldSchema = z.object({
  organizationId: z.number().int().positive(),
  caseRef: z.string().min(2).max(500),
  scope: z.enum(LEGAL_HOLD_SCOPES),
  scopeIds: z.array(z.string().min(1).max(64)).max(10000).optional().default([]),
  notes: z.string().max(10000).optional(),
});

const releaseHoldSchema = z.object({
  reason: z.string().min(20).max(5000),  // 2-step confirmation: long-form justification required
  confirm: z.literal("RELEASE LEGAL HOLD"),
});

// ─── Founder gate ───────────────────────────────────────────────────────────
function requireFounder(req: AuthenticatedRequest, res: Response): boolean {
  const user = req.user as any;
  const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.forbidden(res, "Founder access required");
    return false;
  }
  return true;
}

function actorUserId(req: Request): string | null {
  const user = (req as any).user as { id?: string } | undefined;
  const auth = (req as any).auth as { userId?: string } | undefined;
  return user?.id ?? auth?.userId ?? null;
}

// ─── Augment AuditActions namespace at runtime (compile-time keys live in
// utils/auditLog.ts; we extend with stringly-typed action names here so the
// audit trail is grep-able without editing the central registry mid-feature).
const LEGAL_HOLD_ACTIONS = {
  PLACED: "legal_hold.placed",
  RELEASED: "legal_hold.released",
} as const;

// ─── Routes ─────────────────────────────────────────────────────────────────
export function registerLegalHoldRoutes(app: Express): void {
  // ── GET /api/founder/legal-holds ──────────────────────────────────────
  app.get("/api/founder/legal-holds", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const rows = await db
        .select()
        .from(legalHolds)
        .orderBy(desc(legalHolds.placedAt))
        .limit(1000);
      return res.json({ holds: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── GET /api/founder/legal-holds/active ───────────────────────────────
  app.get("/api/founder/legal-holds/active", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const rows = await db
        .select()
        .from(legalHolds)
        .where(and(eq(legalHolds.status, "active"), isNull(legalHolds.releasedAt)))
        .orderBy(desc(legalHolds.placedAt));
      return res.json({ holds: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── POST /api/founder/legal-holds ─────────────────────────────────────
  app.post("/api/founder/legal-holds", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = placeHoldSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    const body = parsed.data;

    // Scope-specific holds require non-empty scopeIds.
    if (body.scope !== "org_wide" && body.scopeIds.length === 0) {
      return Errors.badRequest(res, `scope='${body.scope}' requires at least one scopeId`);
    }
    if (body.scope === "org_wide" && body.scopeIds.length > 0) {
      return Errors.badRequest(res, "scope='org_wide' must not specify scopeIds (the entire org is covered)");
    }

    try {
      const [row] = await db
        .insert(legalHolds)
        .values({
          organizationId: body.organizationId,
          caseRef: body.caseRef,
          scope: body.scope,
          scopeIds: body.scopeIds,
          placedBy: actorUserId(areq),
          notes: body.notes ?? null,
          status: "active",
        })
        .returning();

      await auditFromRequest(areq, {
        action: LEGAL_HOLD_ACTIONS.PLACED,
        target: { type: "organization", id: body.organizationId },
        justification: body.notes ?? body.caseRef,
        metadata: {
          holdId: row.id,
          caseRef: body.caseRef,
          scope: body.scope,
          scopeIdCount: body.scopeIds.length,
        },
      });

      logger.info("[legalHold] placed", {
        metadata: { id: row.id, orgId: body.organizationId, caseRef: body.caseRef, scope: body.scope },
      });

      // Margolis §1 — mirror placements into the existing `system_alerts`
      // primitive so the alert-tray + escalation surfaces inherit the event
      // automatically. Failure here MUST NOT block the hold being placed.
      try {
        await db.insert(systemAlerts).values({
          type: "legal_hold_placed",
          alertType: "system_error",
          severity: "critical",
          title: `Legal hold placed (${body.caseRef})`,
          message:
            `An active legal hold (${body.caseRef}, scope=${body.scope}) is now in force for this organization. ` +
            `Automatic retention sweeps and delete operations are blocked until released.`,
          organizationId: body.organizationId,
          relatedEntityType: "legal_hold",
          status: "new",
          autoResolvable: false,
          metadata: { holdId: row.id, scope: body.scope, caseRef: body.caseRef },
        });
      } catch (alertErr) {
        logger.warn("[legalHold] system_alerts mirror failed", {
          metadata: { holdId: row.id, error: (alertErr as Error).message },
        });
      }

      return res.status(201).json({ hold: row });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── POST /api/founder/legal-holds/:id/release ─────────────────────────
  // 2-step confirmation: client must POST `{reason: <≥20 chars>, confirm: "RELEASE LEGAL HOLD"}`.
  // The justification is stored in legal_holds.release_reason AND mirrored
  // into the audit_events row so the deletion-resumption rationale is
  // permanently traceable.
  app.post("/api/founder/legal-holds/:id/release", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = releaseHoldSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

    try {
      const [row] = await db
        .select()
        .from(legalHolds)
        .where(eq(legalHolds.id, req.params.id))
        .limit(1);
      if (!row) return Errors.notFound(res, "Legal hold");
      if (row.status !== "active" || row.releasedAt) {
        return Errors.badRequest(res, "Hold is already released");
      }

      const now = new Date();
      const [updated] = await db
        .update(legalHolds)
        .set({
          status: "released",
          releasedAt: now,
          releaseReason: parsed.data.reason,
          updatedAt: now,
        })
        .where(eq(legalHolds.id, row.id))
        .returning();

      await auditFromRequest(areq, {
        action: LEGAL_HOLD_ACTIONS.RELEASED,
        target: { type: "organization", id: row.organizationId },
        justification: parsed.data.reason,
        metadata: {
          holdId: row.id,
          caseRef: row.caseRef,
          scope: row.scope,
          placedAt: row.placedAt,
        },
      });

      logger.info("[legalHold] released", {
        metadata: { id: row.id, orgId: row.organizationId, caseRef: row.caseRef },
      });

      return res.json({ hold: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── GET /api/legal-hold/banner ────────────────────────────────────────
  // Customer-side banner payload — used by the site-wide red banner. Returns
  // null when the org has no active hold.
  app.get("/api/legal-hold/banner", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    const orgId = areq.organization?.id;
    if (!orgId) {
      return res.json({ banner: null });
    }
    try {
      const summary = await getActiveHoldSummary(orgId);
      if (!summary) return res.json({ banner: null });
      return res.json({
        banner: {
          caseRef: summary.caseRef,
          scope: summary.scope,
          placedAt: summary.placedAt,
          message: `This account is under a legal hold (${summary.caseRef}). Some delete operations are restricted.`,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── GET /api/founder/legal-holds/banner/:orgId ────────────────────────
  app.get("/api/founder/legal-holds/banner/:orgId", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const orgId = Number(req.params.orgId);
    if (!Number.isFinite(orgId)) return Errors.badRequest(res, "Invalid orgId");
    try {
      const active = await orgHasActiveHold(orgId);
      const summary = await getActiveHoldSummary(orgId);
      return res.json({ active, summary });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Avoid unused-import lint flag for AuditActions — referenced for action-naming
  // convention parity with utils/auditLog.ts even though legal_hold actions
  // are declared inline above.
  void AuditActions;
}
