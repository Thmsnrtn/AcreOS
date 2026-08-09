// ============================================================================
// SHARED/RENTAL/PERCENTAGERENT.TS — retail percentage rent, computed honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe. A retail lease often charges, on top of base rent, a
// percentage of the tenant's gross sales ABOVE a breakpoint. This is the ONE
// place that overage is computed, so its honesty rules live once here:
//
//   1. The overage is a function of REPORTED sales. With no sales reported for
//      the period the engine REFUSES — it never assumes a sales figure, because a
//      percentage-rent bill on invented sales is a fabricated charge.
//   2. The breakpoint is DERIVED or REFUSED. A 'natural' breakpoint is
//      base rent ÷ percentage rate; an 'artificial' one is the negotiated figure.
//      If the inputs a breakpoint needs are missing (no base rent for a natural
//      breakpoint, no figure for an artificial one) the engine refuses rather
//      than pick a denominator.
//   3. A lease with no percentage-rent term is APPLICABLE=false — a clean "this
//      lease has no percentage rent", not a zero that looks computed.
// ============================================================================

/** The lease's percentage-rent terms + the base rent for the reconciliation period. */
export interface PercentageRentLeaseInput {
  /** The percentage of over-breakpoint sales owed, in basis points (600 = 6%). Null = no percentage rent. */
  pctRentBps: number | null;
  /** 'natural' — breakpoint = base rent ÷ rate; 'artificial' — the negotiated figure. Null defaults to natural. */
  pctRentBreakpointType: "natural" | "artificial" | null;
  /** The negotiated sales breakpoint when the type is 'artificial'. */
  pctRentArtificialBreakpointCents: number | null;
  /** The base rent over the reconciliation period, in cents — the numerator of a natural breakpoint. */
  periodBaseRentCents: number | null;
}

export interface PercentageRentResult {
  /** False when the lease carries no percentage-rent term — a clean absence, not a computed zero. */
  applicable: boolean;
  /** The breakpoint applied, in cents — null when not applicable or refused. */
  breakpointCents: number | null;
  breakpointBasis: "natural" | "artificial" | null;
  /** The reported sales the computation used (echoed for the frozen record). */
  reportedGrossSalesCents: number | null;
  /** Sales above the breakpoint — the base of the overage. Null when not applicable/refused. */
  overageSalesCents: number | null;
  /** The percentage rent owed for the period, in cents. Null when not applicable/refused. */
  percentageRentCents: number | null;
  /** Non-null when the engine refused (missing sales or breakpoint inputs) — surface it, bill nothing. */
  refusedReason: string | null;
}

const NOT_APPLICABLE: Omit<PercentageRentResult, "reportedGrossSalesCents"> = {
  applicable: false,
  breakpointCents: null,
  breakpointBasis: null,
  overageSalesCents: null,
  percentageRentCents: null,
  refusedReason: null,
};

/**
 * Compute percentage rent for one lease over one period.
 *
 * A 'natural' breakpoint is the classic base-rent ÷ rate: the sales level at
 * which percentage rent would equal base rent, above which the tenant pays the
 * rate on the excess. An 'artificial' breakpoint is a negotiated fixed figure.
 * Either way the overage is `max(0, sales − breakpoint) × rate`, and any missing
 * input REFUSES rather than guesses.
 */
export function computePercentageRent(args: {
  lease: PercentageRentLeaseInput;
  grossSalesCents: number | null;
}): PercentageRentResult {
  const { lease, grossSalesCents } = args;

  // No percentage-rent term → a clean, honest "not applicable".
  if (lease.pctRentBps == null || lease.pctRentBps <= 0) {
    return { ...NOT_APPLICABLE, reportedGrossSalesCents: grossSalesCents ?? null };
  }

  // The overage is a function of REPORTED sales — never assumed.
  if (grossSalesCents == null) {
    return {
      applicable: true,
      breakpointCents: null,
      breakpointBasis: null,
      reportedGrossSalesCents: null,
      overageSalesCents: null,
      percentageRentCents: null,
      refusedReason:
        "No gross sales reported for this period. Percentage rent cannot be computed without the " +
        "tenant's reported sales — refusing to bill on an assumed figure.",
    };
  }

  // Derive the breakpoint, or refuse.
  const type = lease.pctRentBreakpointType ?? "natural";
  let breakpointCents: number;
  let breakpointBasis: "natural" | "artificial";
  if (type === "artificial") {
    if (lease.pctRentArtificialBreakpointCents == null) {
      return {
        applicable: true,
        breakpointCents: null,
        breakpointBasis: null,
        reportedGrossSalesCents: grossSalesCents,
        overageSalesCents: null,
        percentageRentCents: null,
        refusedReason:
          "This lease uses an artificial breakpoint, but no breakpoint figure is set. Refusing to " +
          "compute percentage rent without it.",
      };
    }
    breakpointCents = lease.pctRentArtificialBreakpointCents;
    breakpointBasis = "artificial";
  } else {
    if (lease.periodBaseRentCents == null) {
      return {
        applicable: true,
        breakpointCents: null,
        breakpointBasis: null,
        reportedGrossSalesCents: grossSalesCents,
        overageSalesCents: null,
        percentageRentCents: null,
        refusedReason:
          "A natural breakpoint needs the period's base rent, which is not known for this lease. " +
          "Refusing to compute percentage rent without it.",
      };
    }
    // Natural breakpoint = base rent ÷ rate. rate = pctRentBps / 10000.
    breakpointCents = Math.round(lease.periodBaseRentCents / (lease.pctRentBps / 10000));
    breakpointBasis = "natural";
  }

  const overageSalesCents = Math.max(0, grossSalesCents - breakpointCents);
  const percentageRentCents = Math.round(overageSalesCents * (lease.pctRentBps / 10000));

  return {
    applicable: true,
    breakpointCents,
    breakpointBasis,
    reportedGrossSalesCents: grossSalesCents,
    overageSalesCents,
    percentageRentCents,
    refusedReason: null,
  };
}
