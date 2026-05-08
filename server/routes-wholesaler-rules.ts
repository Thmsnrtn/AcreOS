/**
 * Wholesaler state rules — assignment-legality lookup (W-1).
 *
 * GET /api/wholesaler-rules         — directory of all states
 * GET /api/wholesaler-rules/:state  — single-state detail
 * GET /api/wholesaler-rules/check?state=&type=
 *                                    — compliance pre-check used by the
 *                                      document-generator UI before
 *                                      submitting an assignment template.
 *
 * Read-only customer endpoints. Updates are paralegal-driven via DB
 * mutation (same pattern as tax_jurisdiction_rules in TD-3).
 */

import type { Express, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { wholesalerStateRules } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export function registerWholesalerRuleRoutes(app: Express): void {
  // List all states.
  app.get(
    "/api/wholesaler-rules",
    isAuthenticated,
    getOrCreateOrg,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db.select().from(wholesalerStateRules);
        const totalStates = rows.length;
        const reviewedCount = rows.filter((r) => r.attorneyReviewedAt).length;
        const restrictedCount = rows.filter(
          (r) => r.status !== "unrestricted",
        ).length;
        return res.json({
          rules: rows.sort((a, b) => a.state.localeCompare(b.state)),
          totalStates,
          reviewedCount,
          restrictedCount,
        });
      } catch (err) {
        logger.error("wholesalerRules.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // Single state.
  app.get(
    "/api/wholesaler-rules/:state",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const state = req.params.state.toUpperCase();
        const [row] = await db
          .select()
          .from(wholesalerStateRules)
          .where(eq(wholesalerStateRules.state, state))
          .limit(1);
        if (!row) {
          // Default to "unrestricted" with a preliminary flag for unseeded
          // states — better than 404, because the customer is asking "is
          // it OK to wholesale here." The UI surfaces the "no entry yet"
          // caveat.
          return res.json({
            rule: {
              state,
              status: "unrestricted",
              licenseRequired: false,
              advertisingRestricted: false,
              recommendation: "consult_counsel",
              citation: null,
              summary: "No entry on file for this state. Default permissive but verify with counsel before relying on the assignment template.",
              detail: null,
              attorneyReviewedAt: null,
              attorneyReviewedBy: null,
              updatedAt: null,
            },
            preliminary: true,
          });
        }
        return res.json({ rule: row, preliminary: !row.attorneyReviewedAt });
      } catch (err) {
        logger.error("wholesalerRules.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}

/**
 * Reusable compliance check called from doc-generation flows.
 * Returns null when generation is OK, or an object with a blocking
 * reason / warning + recommendation to surface to the user.
 */
export interface AssignmentComplianceResult {
  blocked: boolean;       // when true, generation should be refused
  warn: boolean;          // when true (and blocked=false), generation
                          //   proceeds but UI shows a banner
  recommendation: string;
  citation: string | null;
  summary: string;
  attorneyReviewed: boolean;
}

export async function checkAssignmentCompliance(
  state: string | undefined | null,
): Promise<AssignmentComplianceResult> {
  // No state = can't check; lean toward warn (don't silently proceed).
  if (!state) {
    return {
      blocked: false,
      warn: true,
      recommendation: "consult_counsel",
      citation: null,
      summary: "No state specified — cannot check assignment legality.",
      attorneyReviewed: false,
    };
  }

  const stateUp = state.toUpperCase();
  const [rule] = await db
    .select()
    .from(wholesalerStateRules)
    .where(eq(wholesalerStateRules.state, stateUp))
    .limit(1);

  if (!rule) {
    return {
      blocked: false,
      warn: true,
      recommendation: "consult_counsel",
      citation: null,
      summary: `No rule entry on file for ${stateUp}. Default permissive but verify with counsel.`,
      attorneyReviewed: false,
    };
  }

  // license_required → block. Trey's exact framing: "If AcreOS lets me
  // generate and send an assignment-of-contract document in a regulated
  // state without a warning, the platform is materially complicit."
  // We go further than warning when the state is license_required —
  // we block, with a recommendation to use double-close instead.
  if (rule.status === "license_required") {
    return {
      blocked: true,
      warn: false,
      recommendation: rule.recommendation,
      citation: rule.citation,
      summary: rule.summary ?? "Assignment for fee is restricted in this state.",
      attorneyReviewed: !!rule.attorneyReviewedAt,
    };
  }

  // advertising_restricted or pending_legislation → warn but allow.
  if (rule.status !== "unrestricted") {
    return {
      blocked: false,
      warn: true,
      recommendation: rule.recommendation,
      citation: rule.citation,
      summary: rule.summary ?? "Restrictions apply in this state.",
      attorneyReviewed: !!rule.attorneyReviewedAt,
    };
  }

  return {
    blocked: false,
    warn: false,
    recommendation: rule.recommendation,
    citation: rule.citation,
    summary: rule.summary ?? "Permitted in this state.",
    attorneyReviewed: !!rule.attorneyReviewedAt,
  };
}
