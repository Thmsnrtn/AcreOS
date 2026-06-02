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
          // Carla Mendoza fix (2026-05-27): for the 37 unseeded states the
          // prior default was "unrestricted + consult_counsel" — that is a
          // *permissive* fallback, which in a UPL-sensitive product is
          // exactly the wrong direction. A wholesaler in OK / IL / SC who
          // sees "unrestricted" on the dashboard and proceeds is sitting
          // on a license-revocation, refund, and (in OK) a
          // class-A-misdemeanor charge. Flipped to an EXPLICIT-BLOCK
          // default: status=pending_legislation (so the UI treats it
          // identically to a restricted state for the compliance gate),
          // licenseRequired=true (so the doc-generator refuses to emit an
          // assignment template), recommendation=double_close_only, and a
          // summary that names the gap and the user-action to request a
          // citation review. The "preliminary" flag stays true so the
          // sticky banner can render.
          return res.json({
            rule: {
              state,
              status: "pending_legislation",
              licenseRequired: true,
              advertisingRestricted: true,
              recommendation: "double_close_only",
              citation: null,
              summary:
                `No rule entry on file for ${state}. AcreOS BLOCKS assignment-template generation for unseeded states until counsel has reviewed the state's broker-licensing + assignment-disclosure regime. Use the double-close path or request a statute review from support.`,
              detail:
                "Unseeded states are treated as license-required by default. " +
                "Reason: in the post–Dodd-Frank wave, the states that most " +
                "aggressively prosecute UPL by wholesalers (OK 59 O.S. § " +
                "858-301; IL 225 ILCS 454/1-10; SC § 40-57-30; PA § 35.201) " +
                "are exactly the states most likely to be missing from a " +
                "partial seed. A permissive default biases failure toward " +
                "the customer. Request review at support@acreos.io with " +
                "the statute citation you want us to load.",
              attorneyReviewedAt: null,
              attorneyReviewedBy: null,
              updatedAt: null,
            },
            preliminary: true,
            unseeded: true,
            requestCitationUrl:
              `mailto:support@acreos.io?subject=Statute%20citation%20request%3A%20${state}%20wholesaler%20rules&body=I%27m%20wholesaling%20in%20${state}.%20Please%20review%20the%20broker-license%20%2B%20assignment-disclosure%20regime%20and%20seed%20the%20wholesaler_state_rules%20entry.%0A%0AStatute%20citation%20(if%20I%20have%20one)%3A%20`,
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
    // Carla Mendoza fix (2026-05-27): the previous default was "warn but
    // allow." That silently shipped assignment templates in the 37
    // unseeded states, including OK / IL / SC / PA where assigning a
    // contract for a fee without a broker license is a prosecutable
    // offense. We now BLOCK unseeded states by default and force the
    // operator through the double-close path or a counsel review. This
    // matches the policy on the customer-facing state-detail endpoint
    // above. To unblock a state, seed wholesaler_state_rules with an
    // explicit row (paralegal-reviewed at minimum).
    return {
      blocked: true,
      warn: false,
      recommendation: "double_close_only",
      citation: null,
      summary: `No rule entry on file for ${stateUp}. AcreOS blocks assignment-template generation in unseeded states; use the double-close flow or request a statute review.`,
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
