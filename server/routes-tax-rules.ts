/**
 * Tax jurisdiction rules — state-by-state redemption + statutory data.
 *
 * GET    /api/tax-rules           — list all states with their rules
 * GET    /api/tax-rules/:state    — single-state detail
 *
 * Read-only customer endpoints; updates are paralegal-driven via DB
 * mutations (no UI write surface in this PR — the data is sensitive
 * enough that we don't want hot-path UI editors before review workflow
 * lands).
 */

import type { Express, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { taxJurisdictionRules } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { STATE_REDEMPTION_RULES } from "./services/redemptionClock";

export function registerTaxRuleRoutes(app: Express): void {
  // List — returns the union of DB-stored rules + in-memory fallbacks.
  // The UI uses `attorneyReviewedAt` to display the review state per row;
  // unreviewed states show "preliminary" pills.
  app.get(
    "/api/tax-rules",
    isAuthenticated,
    getOrCreateOrg,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const dbRules = await db.select().from(taxJurisdictionRules);
        const dbRuleByState = new Map(dbRules.map((r) => [r.state.toUpperCase(), r]));

        // Build the full state list — every state we have either DB or
        // fallback for. Fallback-only states appear as "preliminary."
        const allStates = new Set<string>([
          ...dbRuleByState.keys(),
          ...Object.keys(STATE_REDEMPTION_RULES),
        ]);

        const rows = Array.from(allStates).sort().map((state) => {
          const dbRule = dbRuleByState.get(state);
          const fallback = STATE_REDEMPTION_RULES[state];
          if (dbRule) {
            return {
              state: dbRule.state,
              source: "db" as const,
              saleType: dbRule.saleType,
              interestModel: dbRule.interestModel,
              redemptionPeriodMonths: dbRule.redemptionPeriodMonths,
              redemptionPeriodMonthsOwnerOccupied: dbRule.redemptionPeriodMonthsOwnerOccupied,
              defaultRateBps: dbRule.defaultRateBps,
              firstPeriodMonths: dbRule.firstPeriodMonths,
              firstPeriodRateBps: dbRule.firstPeriodRateBps,
              secondPeriodRateBps: dbRule.secondPeriodRateBps,
              yearlyAddOnBps: dbRule.yearlyAddOnBps,
              deadlineAnchor: dbRule.deadlineAnchor,
              citation: dbRule.citation,
              noticeRequirements: dbRule.noticeRequirements,
              quietTitleProcedure: dbRule.quietTitleProcedure,
              foreclosureProcedure: dbRule.foreclosureProcedure,
              attorneyReviewedAt: dbRule.attorneyReviewedAt,
              attorneyReviewedBy: dbRule.attorneyReviewedBy,
              notes: dbRule.notes,
              updatedAt: dbRule.updatedAt,
            };
          }
          // Fallback-only.
          return {
            state,
            source: "fallback" as const,
            saleType: fallback.saleType,
            interestModel: fallback.interestModel,
            redemptionPeriodMonths: fallback.redemptionPeriodMonths,
            redemptionPeriodMonthsOwnerOccupied: fallback.redemptionPeriodMonthsOwnerOccupied,
            defaultRateBps: fallback.defaultRateBps,
            firstPeriodMonths: fallback.firstPeriodMonths,
            firstPeriodRateBps: fallback.firstPeriodRateBps,
            secondPeriodRateBps: fallback.secondPeriodRateBps,
            yearlyAddOnBps: fallback.yearlyAddOnBps,
            deadlineAnchor: fallback.deadlineAnchor,
            citation: fallback.citation,
            noticeRequirements: null,
            quietTitleProcedure: null,
            foreclosureProcedure: null,
            attorneyReviewedAt: fallback.attorneyReviewedAt,
            attorneyReviewedBy: fallback.attorneyReviewedBy,
            notes: null,
            updatedAt: null,
          };
        });

        const reviewedCount = rows.filter((r) => r.attorneyReviewedAt).length;
        return res.json({
          rules: rows,
          totalStates: rows.length,
          reviewedCount,
          missingStates: 50 - rows.length, // approximate — PR + DC etc not counted
        });
      } catch (err) {
        logger.error("taxRules.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // Single state detail.
  app.get(
    "/api/tax-rules/:state",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const state = req.params.state.toUpperCase();
        const [dbRule] = await db
          .select()
          .from(taxJurisdictionRules)
          .where(eq(taxJurisdictionRules.state, state))
          .limit(1);
        if (dbRule) {
          return res.json({ source: "db", rule: dbRule });
        }
        const fallback = STATE_REDEMPTION_RULES[state];
        if (fallback) {
          return res.json({ source: "fallback", rule: { state, ...fallback } });
        }
        return Errors.notFound(res, `Rules for state '${state}'`);
      } catch (err) {
        logger.error("taxRules.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
