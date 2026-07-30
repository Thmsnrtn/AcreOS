/**
 * Tax-sale rule COVERAGE — what we actually know per state, and what we
 * deliberately refuse to guess.
 *
 * ── Why this file exists ────────────────────────────────────────────────
 * Two per-state rule sources already existed in the repo and neither one
 * was honest on its own:
 *
 *   1. `STATE_REDEMPTION_RULES` (server/services/redemptionClock.ts) — TEN
 *      states with full COMPUTATIONAL structure (interest model, rate,
 *      period, deadline anchor). This is what the redemption math runs on.
 *   2. `STATE_TAX_LIEN_RULES` (shared/regulatory/taxLienStateRules.ts) —
 *      FIFTY-ONE jurisdictions (50 states + DC) of REFERENCE data
 *      (sale type, redemption months, statutory yield, statutory cite).
 *      It had zero call sites: 51 states of research sitting unrendered
 *      while `/state-rules` showed ten.
 *
 * The dangerous part was the seam. `computeRedemptionAmount()` in
 * redemptionClock.ts falls back to "12% simple annual is the closest
 * median rule" for any state it doesn't have — a made-up number driving a
 * redemption quote an operator hands to a county clerk. That is exactly
 * the fabrication this codebase forbids.
 *
 * So this module defines THREE coverage tiers and makes the third one
 * speak up instead of defaulting:
 *
 *   computational  — we can compute redemption math. Still PRELIMINARY:
 *                    no state is attorney-reviewed yet.
 *   reference_only — we know the sale type / period / statutory cite, but
 *                    NOT enough to compute interest. Surfaces must say
 *                    "redemption math not encoded", never a number.
 *   not_encoded    — we know nothing (territories, PR/VI/GU). Surfaces
 *                    say so. No fallback, no median, no guess.
 *
 * ── Honesty contract ───────────────────────────────────────────────────
 * Nothing in here is attorney-reviewed. Every row we hand out carries
 * `attorneyReviewed: false` and `UNREVIEWED_RULE_CAVEAT`, and every
 * derived date carries its `basis` string so the operator can check our
 * arithmetic against the statute themselves. A redemption deadline is a
 * number someone loses a property over; it gets a citation or it gets a
 * refusal.
 *
 * Pure module — no DB, no Express. Safe to unit-test without DATABASE_URL.
 */

import {
  STATE_TAX_LIEN_RULES,
  type StateTaxLienRules,
} from "@shared/regulatory/taxLienStateRules";
import type { TaxCertSaleType } from "@shared/schema";
import { STATE_REDEMPTION_RULES } from "./redemptionClock";

/**
 * The one sentence that must appear on every surface derived from this
 * data. Not decorative — see the class-action risk in a redemption quote
 * that turns out to be wrong.
 */
export const UNREVIEWED_RULE_CAVEAT =
  "Preliminary — not attorney-reviewed. Confirm against the state code and the county clerk before relying on this.";

/**
 * Sentinel `interest_model` written into `tax_jurisdiction_rules` for
 * states where we have reference data but no computational structure.
 * Readers MUST branch on this rather than falling through a switch (a
 * fall-through yields interest = $0, which is a lie, not an absence).
 */
export const INTEREST_MODEL_NOT_ENCODED = "not_encoded";

export type RuleCoverageTier = "computational" | "reference_only" | "not_encoded";

export interface StateRuleCoverage {
  state: string;
  tier: RuleCoverageTier;
  /** True only when redemption INTEREST math can be computed for this state. */
  redemptionMathEncoded: boolean;
  /** No state is attorney-reviewed today. Kept as a field, not a constant, so
   *  the surfaces read the truth rather than a hardcoded `false`. */
  attorneyReviewed: boolean;
  /** Statutory citation, from whichever tier supplied it. Null if unknown. */
  citation: string | null;
  caveat: string;
}

const ALL_STATES: readonly string[] = Object.keys(STATE_TAX_LIEN_RULES).sort();

/** The 51 jurisdictions (50 states + DC) we have reference data for. */
export function referenceCoveredStates(): readonly string[] {
  return ALL_STATES;
}

/** The states whose redemption math is actually encoded. */
export function computationalStates(): readonly string[] {
  return Object.keys(STATE_REDEMPTION_RULES).sort();
}

function normalizeState(state: string): string {
  return (state || "").trim().toUpperCase();
}

export function getStateRuleCoverage(stateInput: string): StateRuleCoverage {
  const state = normalizeState(stateInput);
  const computational = STATE_REDEMPTION_RULES[state];
  const informational: StateTaxLienRules | undefined = STATE_TAX_LIEN_RULES[state];

  if (computational) {
    return {
      state,
      tier: "computational",
      redemptionMathEncoded: true,
      attorneyReviewed: computational.attorneyReviewedAt !== null,
      citation: computational.citation ?? informational?.statutoryReference ?? null,
      caveat: UNREVIEWED_RULE_CAVEAT,
    };
  }
  if (informational) {
    return {
      state,
      tier: "reference_only",
      redemptionMathEncoded: false,
      attorneyReviewed: false,
      citation: informational.statutoryReference,
      caveat: UNREVIEWED_RULE_CAVEAT,
    };
  }
  return {
    state,
    tier: "not_encoded",
    redemptionMathEncoded: false,
    attorneyReviewed: false,
    citation: null,
    caveat: `AcreOS has no tax-sale rule encoded for '${state || "(blank)"}'. Nothing is assumed on your behalf.`,
  };
}

// ============================================================================
// Preliminary redemption deadline
// ----------------------------------------------------------------------------
// A discriminated union, on purpose. There is no shape of this return value
// that hands the caller a date without also handing it the basis, and no
// shape that hands back a date for a state we cannot compute.
// ============================================================================

export interface PreliminaryDeadlineInput {
  state: string;
  /** ISO `YYYY-MM-DD`. */
  saleDate: string;
  ownerOccupied?: boolean;
}

export type PreliminaryDeadline =
  | {
      status: "preliminary";
      state: string;
      /** ISO `YYYY-MM-DD`. */
      deadline: string;
      /** Human-readable derivation, e.g. "sale date 2026-03-04 + 24 months (FL)". */
      basis: string;
      citation: string | null;
      attorneyReviewed: false;
      caveat: string;
    }
  | {
      status: "no_redemption";
      state: string;
      basis: string;
      citation: string | null;
      caveat: string;
    }
  | {
      status: "not_encoded";
      state: string;
      /** Which tier we stopped at, so the UI can word it precisely. */
      tier: Exclude<RuleCoverageTier, "computational">;
      reason: string;
      citation: string | null;
      caveat: string;
    };

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid sale date '${iso}'`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp to the last day of the target month (Jan 31 + 1 month = Feb 28/29,
  // not Mar 3 — a three-day error on a redemption deadline is a lost parcel).
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/**
 * Derive a redemption deadline, or refuse.
 *
 * Only the `computational` tier produces a date. `reference_only` states
 * DO have a redemption period in the reference data, but the period alone
 * is not enough to know the anchor (sale date vs first-Monday-after-sale
 * vs deed recordation — Marcus's exact deal-killer), so we decline rather
 * than silently anchor on the sale date.
 */
export function preliminaryRedemptionDeadline(
  input: PreliminaryDeadlineInput,
): PreliminaryDeadline {
  const state = normalizeState(input.state);
  const coverage = getStateRuleCoverage(state);
  const rule = STATE_REDEMPTION_RULES[state];

  if (!rule) {
    const reason =
      coverage.tier === "reference_only"
        ? `${state} has reference data only — its redemption interest model and deadline anchor are not encoded, so AcreOS will not compute a deadline for it.`
        : `${state} has no tax-sale rule encoded in AcreOS.`;
    return {
      status: "not_encoded",
      state,
      tier: coverage.tier === "reference_only" ? "reference_only" : "not_encoded",
      reason,
      citation: coverage.citation,
      caveat: coverage.caveat,
    };
  }

  if (rule.interestModel === "no_redemption" || rule.redemptionPeriodMonths === 0) {
    return {
      status: "no_redemption",
      state,
      basis: `${state} is encoded as a no-post-sale-redemption jurisdiction.`,
      citation: rule.citation ?? coverage.citation,
      caveat: UNREVIEWED_RULE_CAVEAT,
    };
  }

  const months =
    input.ownerOccupied && rule.redemptionPeriodMonthsOwnerOccupied
      ? rule.redemptionPeriodMonthsOwnerOccupied
      : rule.redemptionPeriodMonths;

  let anchorIso = input.saleDate;
  let anchorLabel = `sale date ${input.saleDate}`;
  if (rule.deadlineAnchor === "first_monday_after_sale") {
    const d = new Date(`${input.saleDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid sale date '${input.saleDate}'`);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    anchorIso = d.toISOString().slice(0, 10);
    anchorLabel = `first Monday after sale (${anchorIso})`;
  } else if (rule.deadlineAnchor === "deed_recordation") {
    // We are given a sale date, not a recordation date. Say so instead of
    // pretending they are the same day.
    return {
      status: "not_encoded",
      state,
      tier: "reference_only",
      reason: `${state} anchors redemption on DEED RECORDATION, not the sale date. AcreOS needs the recordation date before it can compute this deadline.`,
      citation: rule.citation ?? coverage.citation,
      caveat: UNREVIEWED_RULE_CAVEAT,
    };
  }

  const occupancyNote =
    input.ownerOccupied && rule.redemptionPeriodMonthsOwnerOccupied
      ? " (owner-occupied period)"
      : "";

  return {
    status: "preliminary",
    state,
    deadline: addMonthsIso(anchorIso, months),
    basis: `${anchorLabel} + ${months} months${occupancyNote}, per AcreOS's encoded ${state} rule.`,
    citation: rule.citation ?? coverage.citation,
    attorneyReviewed: false,
    caveat: UNREVIEWED_RULE_CAVEAT,
  };
}

// ============================================================================
// Seed rows for tax_jurisdiction_rules
// ----------------------------------------------------------------------------
// The table shipped with ~21 hand-written INSERTs in scripts/migrate.mjs and
// no write surface, while 51 jurisdictions of research sat in the repo. These
// rows are DERIVED from that module so the two cannot drift.
//
// Deliberate choices:
//   • Rows are inserted ON CONFLICT DO NOTHING by the seeder — a hand-curated
//     or attorney-reviewed row always wins over a derived one.
//   • `attorneyReviewedAt` is NULL on every derived row. Always.
//   • Reference-only states get interest_model = 'not_encoded' and
//     default_rate_bps = 0 with the "rate not encoded" note. Consumers branch
//     on the model; they must not read 0 as "zero percent".
// ============================================================================

export interface JurisdictionRuleSeedRow {
  state: string;
  saleType: TaxCertSaleType;
  interestModel: string;
  redemptionPeriodMonths: number;
  redemptionPeriodMonthsOwnerOccupied: number | null;
  defaultRateBps: number;
  firstPeriodMonths: number | null;
  firstPeriodRateBps: number | null;
  secondPeriodRateBps: number | null;
  yearlyAddOnBps: number | null;
  deadlineAnchor: string;
  citation: string | null;
  notes: string;
  attorneyReviewedAt: null;
  attorneyReviewedBy: null;
}

const SALE_TYPE_FROM_REFERENCE: Record<StateTaxLienRules["saleType"], TaxCertSaleType> = {
  tax_lien_certificate: "lien",
  tax_deed: "deed",
  hybrid: "redeemable_deed",
};

const DERIVED_PROVENANCE =
  "Derived from shared/regulatory/taxLienStateRules.ts (paralegal-quality research, not attorney-reviewed).";

export function deriveJurisdictionRuleSeedRows(): JurisdictionRuleSeedRow[] {
  return ALL_STATES.map((state) => {
    const ref = STATE_TAX_LIEN_RULES[state];
    const comp = STATE_REDEMPTION_RULES[state];

    if (comp) {
      return {
        state,
        saleType: comp.saleType,
        interestModel: comp.interestModel,
        redemptionPeriodMonths: comp.redemptionPeriodMonths,
        redemptionPeriodMonthsOwnerOccupied: comp.redemptionPeriodMonthsOwnerOccupied ?? null,
        defaultRateBps: comp.defaultRateBps,
        firstPeriodMonths: comp.firstPeriodMonths ?? null,
        firstPeriodRateBps: comp.firstPeriodRateBps ?? null,
        secondPeriodRateBps: comp.secondPeriodRateBps ?? null,
        yearlyAddOnBps: comp.yearlyAddOnBps ?? null,
        deadlineAnchor: comp.deadlineAnchor,
        citation: comp.citation ?? ref.statutoryReference,
        notes: `${DERIVED_PROVENANCE} Redemption math IS encoded for ${state}. ${ref.notes}`,
        attorneyReviewedAt: null,
        attorneyReviewedBy: null,
      };
    }

    // Reference-only. Period comes from whichever field the reference data
    // populated for this sale type; interest is explicitly NOT encoded.
    const months = ref.redemptionPeriodMonths ?? ref.postSaleRedemptionMonths ?? 0;
    return {
      state,
      saleType: SALE_TYPE_FROM_REFERENCE[ref.saleType],
      interestModel: INTEREST_MODEL_NOT_ENCODED,
      redemptionPeriodMonths: months,
      redemptionPeriodMonthsOwnerOccupied: null,
      defaultRateBps: 0,
      firstPeriodMonths: null,
      firstPeriodRateBps: null,
      secondPeriodRateBps: null,
      yearlyAddOnBps: null,
      deadlineAnchor: "sale_date",
      citation: ref.statutoryReference,
      notes:
        `${DERIVED_PROVENANCE} REFERENCE ONLY: ${state}'s redemption interest model is NOT encoded — ` +
        `default_rate_bps of 0 means "not encoded", NOT "zero percent". ` +
        (ref.statutoryYieldBps !== null
          ? `Research indicates a statutory yield near ${(ref.statutoryYieldBps / 100).toFixed(2)}%` +
            (ref.rateIsBidDown ? " (bid down at auction, so this is a ceiling)" : "") +
            "; it is not encoded for computation. "
          : "") +
        ref.notes,
      attorneyReviewedAt: null,
      attorneyReviewedBy: null,
    };
  });
}
