// ============================================================================
// SHARED/REGULATORY/DODDFRANKELEMENTS.TS — the terms elements of a CLAIMED
// Reg Z seller-financer exclusion, one verdict per element.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no I/O, no clock, no imports.
//
// ONE RULE, TWO CONSUMERS. The Dodd-Frank checker page
// (server/services/doddFrankChecker.ts, `evaluateSellerFinancerExclusions`) and
// the Notes V2 Leg 3 activation gate (shared/notes/sellerFinanceGate.ts) both
// decide these elements here. The checker re-exports this function and reads
// its element verdicts; the gate calls it for the deal being activated. shared/
// is the only directory both may import from (shared/notes must not import
// server/), so the rule lives here rather than in the checker module.
//
// THE ELEMENTS (12 CFR 1026.36(a)(4)(ii)-(iii) and (a)(5)(ii)-(iii)):
//
//   element                       claim a4 (3-property)    claim a5 (1-property)
//   ----------------------------  -----------------------  ----------------------
//   balloon                       yes ⇒ failed             always met — a balloon
//                                 (must fully amortize)    is permitted here
//   negative_amortization         yes ⇒ failed             yes ⇒ failed
//   rate_adjustment_timing        adjustable, first        same
//                                 change < 60 months ⇒
//                                 failed; month missing ⇒
//                                 unanswered
//   rate_caps                     adjustable, caps 'no' ⇒  not an element here
//                                 failed                   (see the note below)
//   seller_constructed_dwelling   yes ⇒ failed             yes ⇒ failed
//
// Every element that is not answered is 'unanswered', never assumed met
// (refuse, never assume). Absence of an input means 'unanswered'.
//
// Decisions recorded here so they are provenance, not drift:
//
//  - rate_caps under a4: an adjustable rate with caps answered 'no' fails; caps
//    left unanswered is 'unanswered' (it still blocks the claim, and names
//    itself) rather than 'failed'. A fixed rate has no caps question: met.
//
//  - rate_caps under a5: NOT evaluated. The brief that specified this module
//    makes the (a)(5) rate condition the timing rule only, and the existing
//    checker's evaluation code models no caps input for either exclusion. NOTE
//    the checker's own header comment describes (a)(5)(iii)(B) as "adjustable
//    only after 5+ years with reasonable caps"; if counsel reads the caps as an
//    (a)(5) element too, add it here and both consumers pick it up.
//
//  - seller_constructed_dwelling fails under a5 as well as a4. The brief named
//    it only for a4; the existing checker evaluation fails BOTH exclusions on
//    it ((a)(4)(ii) and (a)(5)(ii)), and the page and the gate share one rule,
//    so the existing code governs.
//
//  - hasDwelling: not an element of either exclusion. It is accepted so the
//    facts align with the gate's record, and used in exactly one place: when
//    the property is answered as having NO dwelling, there is no residence the
//    seller could have constructed, so seller_constructed_dwelling is met.
// ============================================================================

/** A fact element as recorded: answered yes, answered no, or not answered. */
export type TriState = "yes" | "no" | "unanswered";

export type ClaimedExclusion = "a4" | "a5";

export const DODD_FRANK_ELEMENT_CODES = [
  "balloon",
  "negative_amortization",
  "rate_adjustment_timing",
  "rate_caps",
  "seller_constructed_dwelling",
] as const;
export type ElementCode = (typeof DODD_FRANK_ELEMENT_CODES)[number];

export type ElementVerdictValue = "met" | "failed" | "unanswered";

export interface ElementVerdict {
  element: ElementCode;
  verdict: ElementVerdictValue;
  reason: string;
}

/** Every input optional: an omitted element is 'unanswered'. */
export interface ClaimedExclusionFacts {
  balloon?: TriState;
  negativeAmortization?: TriState;
  rateType?: "fixed" | "adjustable" | "unanswered";
  /** Months from consummation to the first possible rate change (adjustable only). */
  firstRateAdjustmentMonths?: number | null;
  rateCapsStated?: TriState;
  sellerConstructedDwelling?: TriState;
  hasDwelling?: TriState;
}

const A4 = "the 3-property exclusion, 12 CFR 1026.36(a)(4)";
const A5 = "the 1-property exclusion, 12 CFR 1026.36(a)(5)";

function answered(v: TriState | undefined): "yes" | "no" | "unanswered" {
  return v === "yes" || v === "no" ? v : "unanswered";
}

/**
 * Per-element verdicts for a claimed exclusion. The array order is stable:
 * balloon, negative_amortization, rate_adjustment_timing, rate_caps (a4 only),
 * seller_constructed_dwelling.
 */
export function evaluateClaimedExclusion(claim: ClaimedExclusion, facts: ClaimedExclusionFacts): ElementVerdict[] {
  const rule = claim === "a4" ? A4 : A5;
  const out: ElementVerdict[] = [];

  // ── balloon ──────────────────────────────────────────────────────────────
  if (claim === "a5") {
    out.push({ element: "balloon", verdict: "met", reason: `A balloon is permitted under ${A5}.` });
  } else {
    const b = answered(facts.balloon);
    out.push(
      b === "yes"
        ? { element: "balloon", verdict: "failed", reason: `The note has a balloon, so it is not fully amortizing, which ${A4} requires.` }
        : b === "no"
          ? { element: "balloon", verdict: "met", reason: "The note has no balloon." }
          : { element: "balloon", verdict: "unanswered", reason: "Whether the note has a balloon is not recorded." },
    );
  }

  // ── negative amortization ────────────────────────────────────────────────
  const n = answered(facts.negativeAmortization);
  out.push(
    n === "yes"
      ? { element: "negative_amortization", verdict: "failed", reason: `The schedule can negatively amortize, which ${rule} does not allow.` }
      : n === "no"
        ? { element: "negative_amortization", verdict: "met", reason: "The schedule cannot negatively amortize." }
        : { element: "negative_amortization", verdict: "unanswered", reason: "Whether the schedule can negatively amortize is not recorded." },
  );

  // ── rate: timing of the first adjustment ─────────────────────────────────
  const rateType = facts.rateType === "fixed" || facts.rateType === "adjustable" ? facts.rateType : "unanswered";
  const months = facts.firstRateAdjustmentMonths;
  if (rateType === "fixed") {
    out.push({ element: "rate_adjustment_timing", verdict: "met", reason: "The rate is fixed." });
  } else if (rateType === "unanswered") {
    out.push({ element: "rate_adjustment_timing", verdict: "unanswered", reason: "Whether the rate is fixed or adjustable is not recorded." });
  } else if (typeof months !== "number") {
    out.push({ element: "rate_adjustment_timing", verdict: "unanswered", reason: "When the adjustable rate can first change is not recorded." });
  } else if (months >= 60) {
    out.push({ element: "rate_adjustment_timing", verdict: "met", reason: `The rate first adjusts at month ${months}, after 5 years.` });
  } else {
    // Written as "not ≥ 60" so a NaN month fails, exactly as the checker's
    // original `months >= 60 ? met : failed` did.
    out.push({ element: "rate_adjustment_timing", verdict: "failed", reason: `The rate can first adjust at month ${months}; ${rule} requires 60 months or more.` });
  }

  // ── rate: stated caps (a4 only — see the header) ─────────────────────────
  if (claim === "a4") {
    const caps = answered(facts.rateCapsStated);
    if (rateType === "fixed") {
      out.push({ element: "rate_caps", verdict: "met", reason: "The rate is fixed, so no caps are needed." });
    } else if (rateType === "unanswered") {
      out.push({ element: "rate_caps", verdict: "unanswered", reason: "Whether the rate is fixed or adjustable is not recorded, so the caps question is open." });
    } else if (caps === "yes") {
      out.push({ element: "rate_caps", verdict: "met", reason: "Annual and lifetime rate caps are stated." });
    } else if (caps === "no") {
      out.push({ element: "rate_caps", verdict: "failed", reason: `The adjustable rate has no stated caps; ${A4} requires reasonable annual and lifetime caps.` });
    } else {
      out.push({ element: "rate_caps", verdict: "unanswered", reason: "Whether the adjustable rate has stated caps is not recorded." });
    }
  }

  // ── seller-constructed dwelling ──────────────────────────────────────────
  const s = answered(facts.sellerConstructedDwelling);
  if (s === "yes") {
    out.push({ element: "seller_constructed_dwelling", verdict: "failed", reason: `The seller constructed the residence in the ordinary course of business, which ${rule} does not allow.` });
  } else if (s === "no") {
    out.push({ element: "seller_constructed_dwelling", verdict: "met", reason: "The seller did not construct the residence." });
  } else if (facts.hasDwelling === "no") {
    out.push({ element: "seller_constructed_dwelling", verdict: "met", reason: "The property has no dwelling, so there is no residence the seller could have constructed." });
  } else {
    out.push({ element: "seller_constructed_dwelling", verdict: "unanswered", reason: "Whether the seller constructed the residence is not recorded." });
  }

  return out;
}
