/**
 * Seed `tax_jurisdiction_rules` from the in-repo 51-jurisdiction reference
 * module.
 *
 * The table shipped with ~21 hand-written INSERT statements in
 * scripts/migrate.mjs and no write surface at all, while
 * `shared/regulatory/taxLienStateRules.ts` — 50 states + DC of researched
 * sale types, redemption periods, statutory yields and citations — had zero
 * call sites. This seeder closes that gap, DERIVING every row (see
 * `deriveJurisdictionRuleSeedRows`) so the table and the module cannot drift.
 *
 * Idempotent and non-destructive by construction:
 *   • `onConflictDoNothing` on the `state` primary key, so a hand-curated or
 *     attorney-reviewed row is never overwritten by a derived one.
 *   • Every derived row carries `attorney_reviewed_at = NULL`. The seeder has
 *     no code path that can set a review stamp.
 *
 * Runs on boot (server/index.ts), non-fatally.
 */

import { db } from "../db";
import { taxJurisdictionRules } from "@shared/schema";
import { logger } from "../utils/logger";
import { deriveJurisdictionRuleSeedRows } from "./taxRuleCoverage";

export interface SeedResult {
  /** Jurisdictions the reference module covers. */
  candidates: number;
  /** Rows actually written (absent states only). */
  inserted: number;
  /** Rows already present, left untouched. */
  preserved: number;
  insertedStates: string[];
}

export async function seedTaxJurisdictionRules(): Promise<SeedResult> {
  const rows = deriveJurisdictionRuleSeedRows();

  const written = await db
    .insert(taxJurisdictionRules)
    .values(
      rows.map((r) => ({
        state: r.state,
        saleType: r.saleType,
        interestModel: r.interestModel,
        redemptionPeriodMonths: r.redemptionPeriodMonths,
        redemptionPeriodMonthsOwnerOccupied: r.redemptionPeriodMonthsOwnerOccupied,
        defaultRateBps: r.defaultRateBps,
        firstPeriodMonths: r.firstPeriodMonths,
        firstPeriodRateBps: r.firstPeriodRateBps,
        secondPeriodRateBps: r.secondPeriodRateBps,
        yearlyAddOnBps: r.yearlyAddOnBps,
        deadlineAnchor: r.deadlineAnchor,
        citation: r.citation,
        notes: r.notes,
        // Never set by the seeder. Review is a human act.
        attorneyReviewedAt: null,
        attorneyReviewedBy: null,
      })),
    )
    .onConflictDoNothing({ target: taxJurisdictionRules.state })
    .returning({ state: taxJurisdictionRules.state });

  const result: SeedResult = {
    candidates: rows.length,
    inserted: written.length,
    preserved: rows.length - written.length,
    insertedStates: written.map((w) => w.state).sort(),
  };

  logger.info("[taxRules] jurisdiction-rule seed complete", {
    metadata: {
      candidates: result.candidates,
      inserted: result.inserted,
      preserved: result.preserved,
      attorneyReviewed: 0,
    },
  });

  return result;
}
