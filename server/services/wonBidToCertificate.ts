/**
 * Won bid → tax certificate handoff, and the live session budget.
 *
 * ── Why ────────────────────────────────────────────────────────────────
 * The auction worksheet's "Won" button wrote a bid-log row and set the
 * listing status to `won`. It did NOT create the certificate. So in the one
 * flow AcreOS owns end to end — operator standing at a courthouse auction,
 * phone in hand, hammer just fell — the next step was to re-type the APN,
 * county, state, sale type, sale date and purchase amount into the
 * certificate form. Every field was already on the listing.
 *
 * This module is the handoff, plus the number the operator actually wants
 * mid-auction: how much of my capital is left.
 *
 * ── Honesty ────────────────────────────────────────────────────────────
 * A certificate carries a `redemption_deadline` that is NOT NULL, and that
 * date is the whole fiduciary point of the record. For states whose rules
 * are not encoded we do NOT invent one: `buildCertificateFromWonLot`
 * returns a refusal naming the state and telling the caller to supply the
 * deadline explicitly. The bid log still records the win either way —
 * losing the operator's record of what happened at the auction would be a
 * worse failure than making them type one date.
 *
 * ── Doctrine ───────────────────────────────────────────────────────────
 * Founder ruling #15, "be the rail, not the provider": this module tracks
 * and calculates. The purchase money moves between the operator and the
 * county on the operator's own rails. Nothing here collects, holds, routes
 * or transfers funds, and `committedCents` is a ledger of what the operator
 * says they bid — not a balance AcreOS custodies.
 *
 * Pure module — no DB, no Express. Unit-testable without DATABASE_URL.
 */

import {
  preliminaryRedemptionDeadline,
  type PreliminaryDeadline,
  UNREVIEWED_RULE_CAVEAT,
} from "./taxRuleCoverage";
import { numericToCents } from "./taxSaleCsvImport";
// The canonical money renderer, replacing a private `toLocaleString("en-US")`
// copy. The canonical one is locale-independent BY DESIGN, and its own comment
// says why: `toLocaleString` renders differently per runtime ICU build, so a
// figure frozen into a decision record would not read back identically. The
// strings below are frozen into a tax-certificate document — the exact case that
// rationale was written for. Identical output on every value this file can
// produce (bid amounts, minimums, and a budget already clamped at zero); the two
// renderers differ only on negatives, which none of these can be.
import { formatCents } from "@shared/finance/cents";

export interface WonLot {
  id: number;
  apn: string;
  county: string;
  state: string;
  /** `lien` | `deed` | `redeemable_deed` as stored on the listing. */
  saleType: string;
  ownerName: string | null;
  ownerAddress: string | null;
  city: string | null;
  zip: string | null;
  /** Legacy `numeric` columns, as strings. */
  minimumBid: string | null;
  openingBid: string | null;
  /** Pre-auction walk-away max, in cents. */
  maxBidCents: number | null;
  propertyId: number | null;
  redemptionPeriodMonths: number | null;
}

export interface BuildCertificateInput {
  lot: WonLot;
  organizationId: number;
  /** What the operator actually paid, integer cents. */
  wonAmountCents: number;
  /** ISO `YYYY-MM-DD`. The auction date, or today when the auction has none. */
  saleDate: string;
  ownerOccupiedAtSale?: boolean;
  /**
   * Operator-supplied deadline, required for states whose redemption rule
   * is not encoded. When present it WINS over the derived date, and the
   * result records that the operator is its source.
   */
  redemptionDeadlineOverride?: string | null;
}

export interface CertificateDraft {
  organizationId: number;
  listingId: number;
  propertyId: number | null;
  state: string;
  county: string;
  apn: string;
  saleType: "lien" | "deed" | "redeemable_deed";
  saleDate: string;
  purchaseAmountCents: number;
  ownerName: string | null;
  ownerAddress: { line1?: string; city?: string; state?: string; zip?: string } | null;
  redemptionDeadline: string;
  ownerOccupiedAtSale: boolean | null;
  notes: string;
}

export type BuildCertificateResult =
  | {
      ok: true;
      draft: CertificateDraft;
      /** How the deadline was arrived at — surfaced verbatim in the UI. */
      deadlineSource: "derived_preliminary" | "operator_supplied";
      deadlineBasis: string;
      citation: string | null;
      attorneyReviewed: false;
      caveat: string;
    }
  | {
      ok: false;
      code: "redemption_deadline_required" | "no_redemption_period" | "invalid_input";
      message: string;
      /** Present when the refusal came from rule coverage. */
      coverage?: PreliminaryDeadline;
    };

const SALE_TYPES = new Set(["lien", "deed", "redeemable_deed"]);

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

/**
 * Build the certificate record a won lot implies — or explain why we won't.
 */
export function buildCertificateFromWonLot(input: BuildCertificateInput): BuildCertificateResult {
  const { lot } = input;
  const state = (lot.state || "").trim().toUpperCase();

  if (!lot.apn?.trim() || !lot.county?.trim() || !state) {
    return {
      ok: false,
      code: "invalid_input",
      message:
        "This lot is missing the parcel number, county or state, so a certificate cannot be created from it. Fix the lot on the worksheet first.",
    };
  }
  if (!SALE_TYPES.has(lot.saleType)) {
    return {
      ok: false,
      code: "invalid_input",
      message: `Lot sale type "${lot.saleType}" is not one of lien / deed / redeemable_deed.`,
    };
  }
  if (!isIsoDate(input.saleDate)) {
    return {
      ok: false,
      code: "invalid_input",
      message: `Sale date "${input.saleDate}" is not a YYYY-MM-DD date.`,
    };
  }
  if (!Number.isSafeInteger(input.wonAmountCents) || input.wonAmountCents <= 0) {
    return {
      ok: false,
      code: "invalid_input",
      message:
        "A winning bid amount is required to create the certificate — enter what you actually paid.",
    };
  }

  const coverage = preliminaryRedemptionDeadline({
    state,
    saleDate: input.saleDate,
    ownerOccupied: input.ownerOccupiedAtSale,
  });

  let redemptionDeadline: string;
  let deadlineSource: "derived_preliminary" | "operator_supplied";
  let deadlineBasis: string;

  const override = input.redemptionDeadlineOverride?.trim() || null;
  if (override) {
    if (!isIsoDate(override)) {
      return {
        ok: false,
        code: "invalid_input",
        message: `Redemption deadline "${override}" is not a YYYY-MM-DD date.`,
      };
    }
    redemptionDeadline = override;
    deadlineSource = "operator_supplied";
    deadlineBasis = `Entered by the operator at certificate creation. AcreOS did not derive this date${
      coverage.status === "not_encoded" ? ` (${state} redemption rules are not encoded).` : "."
    }`;
  } else if (coverage.status === "preliminary") {
    redemptionDeadline = coverage.deadline;
    deadlineSource = "derived_preliminary";
    deadlineBasis = coverage.basis;
  } else if (coverage.status === "no_redemption") {
    return {
      ok: false,
      code: "no_redemption_period",
      message: `${state} is encoded as having no post-sale redemption period, so a redemption deadline has to come from you (or the lot is a straight deed purchase and belongs on the property record, not a certificate).`,
      coverage,
    };
  } else {
    return {
      ok: false,
      code: "redemption_deadline_required",
      message: `${coverage.reason} Enter the statutory redemption deadline for this parcel and AcreOS will record the certificate with your date, marked as operator-supplied.`,
      coverage,
    };
  }

  const ownerAddress =
    lot.ownerAddress || lot.city || lot.zip
      ? {
          ...(lot.ownerAddress ? { line1: lot.ownerAddress } : {}),
          ...(lot.city ? { city: lot.city } : {}),
          state,
          ...(lot.zip ? { zip: lot.zip } : {}),
        }
      : null;

  const minCents = numericToCents(lot.minimumBid);
  const premiumNote =
    minCents !== null && input.wonAmountCents > minCents
      ? ` Paid ${formatCents(input.wonAmountCents)} against a ${formatCents(minCents)} minimum bid.`
      : "";
  const overMaxNote =
    lot.maxBidCents !== null && input.wonAmountCents > lot.maxBidCents
      ? ` NOTE: this exceeded the pre-auction walk-away max of ${formatCents(lot.maxBidCents)}.`
      : "";

  return {
    ok: true,
    draft: {
      organizationId: input.organizationId,
      listingId: lot.id,
      propertyId: lot.propertyId,
      state,
      county: lot.county.trim(),
      apn: lot.apn.trim(),
      saleType: lot.saleType as CertificateDraft["saleType"],
      saleDate: input.saleDate,
      purchaseAmountCents: input.wonAmountCents,
      ownerName: lot.ownerName,
      ownerAddress,
      redemptionDeadline,
      ownerOccupiedAtSale: input.ownerOccupiedAtSale ?? null,
      notes:
        `Created from auction worksheet lot #${lot.id} on a won bid.` +
        premiumNote +
        overMaxNote +
        ` Redemption deadline basis: ${deadlineBasis} ${UNREVIEWED_RULE_CAVEAT}`,
    },
    deadlineSource,
    deadlineBasis,
    citation: coverage.status === "not_encoded" ? coverage.citation : coverage.citation,
    attorneyReviewed: false,
    caveat: UNREVIEWED_RULE_CAVEAT,
  };
}


// ============================================================================
// Session budget
// ----------------------------------------------------------------------------
// The number an operator bidding live actually needs: capital left. Tracking
// only — see the doctrine note at the top of this file.
// ============================================================================

export interface SessionBudgetInput {
  /** Capital the operator allocated to this auction, integer cents. Null = not set. */
  budgetCents: number | null;
  /** One entry per won lot, integer cents. Nulls are counted as unknown, not zero. */
  wonAmountsCents: ReadonlyArray<number | null>;
}

export interface SessionBudget {
  budgetCents: number | null;
  /** Sum of won amounts we actually know. */
  committedCents: number;
  /** Wins whose amount was not recorded — the remaining figure is a ceiling, not a fact. */
  winsWithUnknownAmount: number;
  wonCount: number;
  /** Null when no budget is set: we do not invent one. */
  remainingCents: number | null;
  overBudget: boolean;
  /** True when unknown-amount wins mean `remainingCents` cannot be trusted as exact. */
  remainingIsUpperBound: boolean;
}

export function computeSessionBudget(input: SessionBudgetInput): SessionBudget {
  const known = input.wonAmountsCents.filter((a): a is number => typeof a === "number" && Number.isFinite(a));
  const committedCents = known.reduce((s, a) => s + a, 0);
  const winsWithUnknownAmount = input.wonAmountsCents.length - known.length;
  const budgetCents =
    typeof input.budgetCents === "number" && Number.isFinite(input.budgetCents)
      ? input.budgetCents
      : null;
  const remainingCents = budgetCents === null ? null : budgetCents - committedCents;
  return {
    budgetCents,
    committedCents,
    winsWithUnknownAmount,
    wonCount: input.wonAmountsCents.length,
    remainingCents,
    overBudget: remainingCents !== null && remainingCents < 0,
    remainingIsUpperBound: winsWithUnknownAmount > 0,
  };
}

/**
 * Would this bid break the session budget? Advisory only — the operator is
 * never blocked from recording what actually happened at the auction.
 */
export function checkBidAgainstBudget(
  budget: SessionBudget,
  bidCents: number,
): { withinBudget: boolean; message: string | null } {
  if (budget.remainingCents === null) {
    return { withinBudget: true, message: null };
  }
  if (bidCents > budget.remainingCents) {
    return {
      withinBudget: false,
      message: `${formatCents(bidCents)} exceeds the ${formatCents(Math.max(0, budget.remainingCents))} left in this session's budget${
        budget.remainingIsUpperBound ? " (and that figure is an upper bound — some wins have no amount recorded)" : ""
      }.`,
    };
  }
  return { withinBudget: true, message: null };
}
