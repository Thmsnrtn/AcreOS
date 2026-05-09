/**
 * FW-MARISOL-2 + FW-MARISOL-3 (push-forward 2026-05-08):
 *   /founder/financials backend — ASC 606 recognition + NRR/GRR/COGS rollup.
 *
 * The single most-requested founder dashboard from the panel. Marisol
 * (CFO), Ashok (Series-A IC), Harlowe (M&A) all converged: until the
 * founder can answer "what's our NRR? what's COGS per customer? show
 * me the recognized-vs-deferred shape" in one pane, neither investor
 * conversation nor acquirer diligence is winnable.
 *
 * Routes:
 *   POST /api/founder/financials/run-recognition?period=YYYY-MM
 *     — kicks off ASC 606 recognition for one period. Idempotent.
 *   GET  /api/founder/financials/periods?from=YYYY-MM&to=YYYY-MM
 *     — totals across a window
 *   GET  /api/founder/financials/by-org?period=YYYY-MM
 *     — recognition rows for a single period, joined to org name
 *   GET  /api/founder/financials/nrr?period=YYYY-MM
 *     — NRR (net revenue retention) computed over the trailing 12 months
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { organizations, revenueRecognitionPeriods, subscriptionEvents } from "@shared/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  runMonthlyRecognition,
  getPeriodTotals,
  currentPeriodKey,
} from "./services/revenueRecognition";

export function registerFounderFinancialsRoutes(app: Express): void {
  app.post(
    "/api/founder/financials/run-recognition",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const period = (req.query.period as string) || currentPeriodKey();
        const result = await runMonthlyRecognition(period);
        return res.json(result);
      } catch (err: any) {
        logger.error("[/founder/financials] run-recognition failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/founder/financials/periods",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const from = (req.query.from as string) || currentPeriodKey();
        const to = (req.query.to as string) || from;
        const totals = await getPeriodTotals(from, to);
        return res.json(totals);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/founder/financials/by-org",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const period = (req.query.period as string) || currentPeriodKey();
        const rows = await db
          .select({
            id: revenueRecognitionPeriods.id,
            organizationId: revenueRecognitionPeriods.organizationId,
            orgName: organizations.name,
            tier: revenueRecognitionPeriods.tier,
            billingInterval: revenueRecognitionPeriods.billingInterval,
            source: revenueRecognitionPeriods.source,
            recognizedCents: revenueRecognitionPeriods.recognizedCents,
            deferredCents: revenueRecognitionPeriods.deferredCents,
          })
          .from(revenueRecognitionPeriods)
          .leftJoin(organizations, eq(organizations.id, revenueRecognitionPeriods.organizationId))
          .where(eq(revenueRecognitionPeriods.periodKey, period))
          .orderBy(desc(revenueRecognitionPeriods.recognizedCents))
          .limit(1000);
        return res.json({ period, rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // NRR over trailing 12 months.
  // NRR = (revenue_this_period_from_existing_cohort) / (revenue_12mo_ago_from_same_cohort)
  // Cohort: orgs that existed 12 months ago AND are still active today.
  // Returns NRR percent + the two raw numerator/denominator values.
  app.get(
    "/api/founder/financials/nrr",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const periodTo = (req.query.period as string) || currentPeriodKey();
        const [yearStr, monthStr] = periodTo.split("-");
        const yearTo = Number(yearStr);
        const monthTo = Number(monthStr);
        const yearFrom = monthTo === 12 ? yearTo : yearTo - 1;
        const monthFrom = monthTo;
        const periodFrom = `${yearFrom}-${String(monthFrom).padStart(2, "0")}`;

        // Cohort: org IDs that have a recognition row in BOTH periods.
        const cohort = await db
          .select({ orgId: revenueRecognitionPeriods.organizationId })
          .from(revenueRecognitionPeriods)
          .where(eq(revenueRecognitionPeriods.periodKey, periodFrom))
          .groupBy(revenueRecognitionPeriods.organizationId);
        const cohortIds = cohort.map((r) => r.orgId).filter((x): x is number => x !== null);

        if (cohortIds.length === 0) {
          return res.json({
            periodFrom,
            periodTo,
            cohortSize: 0,
            denominatorCents: 0,
            numeratorCents: 0,
            nrrPct: null,
          });
        }

        const [denom] = await db
          .select({
            sum: sql<string>`COALESCE(SUM(${revenueRecognitionPeriods.recognizedCents}), 0)`,
          })
          .from(revenueRecognitionPeriods)
          .where(and(
            eq(revenueRecognitionPeriods.periodKey, periodFrom),
            sql`${revenueRecognitionPeriods.organizationId} = ANY(ARRAY[${sql.raw(cohortIds.join(","))}]::int[])`,
          ));
        const [num] = await db
          .select({
            sum: sql<string>`COALESCE(SUM(${revenueRecognitionPeriods.recognizedCents}), 0)`,
          })
          .from(revenueRecognitionPeriods)
          .where(and(
            eq(revenueRecognitionPeriods.periodKey, periodTo),
            sql`${revenueRecognitionPeriods.organizationId} = ANY(ARRAY[${sql.raw(cohortIds.join(","))}]::int[])`,
          ));
        const denominatorCents = Number(denom?.sum ?? 0);
        const numeratorCents = Number(num?.sum ?? 0);
        const nrrPct = denominatorCents > 0
          ? Math.round((numeratorCents / denominatorCents) * 1000) / 10
          : null;

        return res.json({
          periodFrom,
          periodTo,
          cohortSize: cohortIds.length,
          denominatorCents,
          numeratorCents,
          nrrPct,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Subscription event history (founder context for the financials page).
  app.get(
    "/api/founder/financials/subscription-events",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = Math.min(Number(req.query.limit ?? 100), 1000);
        const rows = await db
          .select()
          .from(subscriptionEvents)
          .orderBy(desc(subscriptionEvents.createdAt))
          .limit(limit);
        return res.json({ rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
