/**
 * Panel-300 founder compliance + ops dashboards backend.
 *
 *   GET  /api/founder/compliance/fair-lending — recent audit runs
 *   GET  /api/founder/compliance/vendor-telemetry — vendor adoption rows
 *   POST /api/founder/compliance/fair-lending/run — manual trigger
 *   POST /api/founder/compliance/disclosure-timing/run — manual dispatch
 *   POST /api/founder/compliance/reconciliation/run — manual reconciliation
 *
 *   GET  /api/founder/multi-vertical-pnl/:orgId — aggregate P&L per vertical
 *
 *   GET  /api/founder/pricing-experiments — list experiments + conversions
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  fairLendingAuditRuns,
  vendorAdoptionMetrics,
  vendorReferralFees,
  pricingExperiments,
  organizations,
} from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";

const w2ExitSchema = z.object({
  monthlyW2IncomeCents: z.number().int().min(0),
  monthlyGrowthRatePct: z.number().min(0).max(50).optional(),
});

export function registerFounderComplianceRoutes(app: Express): void {
  // ── Fair-lending audit ─────────────────────────────────────────────
  app.get(
    "/api/founder/compliance/fair-lending",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select()
          .from(fairLendingAuditRuns)
          .orderBy(desc(fairLendingAuditRuns.runAt))
          .limit(500);
        const summary = {
          total: rows.length,
          divergent: rows.filter((r) => r.status === "divergent").length,
          ok: rows.filter((r) => r.status === "ok").length,
          insufficient: rows.filter((r) => r.status === "insufficient_sample").length,
        };
        return res.json({ rows, summary });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/compliance/fair-lending/run",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { runFairLendingAudit } = await import("./services/fairLendingAudit");
        const period = (req.query.period as string) || undefined;
        const outcomes = await runFairLendingAudit(period);
        return res.json({ outcomes });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Vendor adoption telemetry ──────────────────────────────────────
  app.get(
    "/api/founder/compliance/vendor-telemetry",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const metrics = await db
          .select()
          .from(vendorAdoptionMetrics)
          .orderBy(desc(vendorAdoptionMetrics.capturedAt))
          .limit(500);
        const fees = await db
          .select()
          .from(vendorReferralFees)
          .orderBy(desc(vendorReferralFees.createdAt))
          .limit(200);
        return res.json({ metrics, referralFees: fees });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Manual triggers (compliance + ops) ─────────────────────────────
  app.post(
    "/api/founder/compliance/disclosure-timing/run",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { runDisclosureTimingDispatch } = await import("./services/disclosureTimingDispatcher");
        const r = await runDisclosureTimingDispatch();
        return res.json(r);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/compliance/reconciliation/run",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { runReconciliation } = await import("./services/reconciliation");
        const results = await runReconciliation();
        return res.json({ results });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Multi-vertical P&L (#22) ───────────────────────────────────────
  app.get(
    "/api/founder/multi-vertical-pnl/:orgId",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = parseInt(req.params.orgId, 10);
        if (isNaN(orgId)) return Errors.badRequest(res, "Invalid org ID");
        const { aggregateMultiVerticalPnL } = await import("./services/multiVerticalPnL");
        const pnl = await aggregateMultiVerticalPnL(orgId);
        return res.json(pnl);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/multi-vertical-pnl/:orgId/w2-exit",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = parseInt(req.params.orgId, 10);
        if (isNaN(orgId)) return Errors.badRequest(res, "Invalid org ID");
        const parsed = w2ExitSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const { aggregateMultiVerticalPnL, projectW2Exit } = await import("./services/multiVerticalPnL");
        const pnl = await aggregateMultiVerticalPnL(orgId);
        const projection = projectW2Exit({
          monthlyW2IncomeCents: parsed.data.monthlyW2IncomeCents,
          monthlyNetRunRateCents: pnl.monthlyNetRunRateCents,
          monthlyGrowthRatePct: parsed.data.monthlyGrowthRatePct,
        });
        return res.json({ pnl, projection });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Pricing experiments ────────────────────────────────────────────
  app.get(
    "/api/founder/pricing-experiments",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select({
            experimentKey: pricingExperiments.experimentKey,
            variantKey: pricingExperiments.variantKey,
            assignments: sql<string>`count(*)::int`,
            conversions: sql<string>`count(${pricingExperiments.convertedAt})::int`,
            totalRevenue: sql<string>`COALESCE(SUM(${pricingExperiments.amountPaidCents}), 0)`,
          })
          .from(pricingExperiments)
          .groupBy(pricingExperiments.experimentKey, pricingExperiments.variantKey)
          .orderBy(pricingExperiments.experimentKey, pricingExperiments.variantKey);
        const summary = rows.map((r) => {
          const assignments = Number(r.assignments);
          const conversions = Number(r.conversions);
          const totalRevenue = Number(r.totalRevenue);
          return {
            ...r,
            assignments,
            conversions,
            conversionRate: assignments > 0 ? Math.round((conversions / assignments) * 10000) / 100 : 0,
            avgRevenuePerAssignmentCents:
              assignments > 0 ? Math.round(totalRevenue / assignments) : 0,
          };
        });
        return res.json({ rows: summary });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── List orgs (helper for pages that pick a subject org) ───────────
  app.get(
    "/api/founder/orgs",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select({
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            tier: organizations.subscriptionTier,
            status: organizations.subscriptionStatus,
          })
          .from(organizations)
          .orderBy(desc(organizations.createdAt))
          .limit(500);
        return res.json({ rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
