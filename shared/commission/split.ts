// ============================================================================
// SHARED/COMMISSION/SPLIT.TS — the brokerage commission split, computed honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. This is the ONE place
// a gross commission (GCI) is split between the agent and their broker, so the
// rules that keep an agent's net honest live once here and cannot be re-decided
// per call site:
//
//   1. The split is the operator's OWN saved arrangement or it is REFUSED. There
//      is no "standard" 70/30 to fall back on — a commission split is a private,
//      negotiated term, and inventing one would fabricate the single number this
//      engine exists to compute. With no split config (or no agent-share set) the
//      engine returns applicable=false + a refusedReason and agentNetCents null.
//      (Mirrors shared/rental/percentageRent.ts's applicable/refusedReason posture.)
//   2. The ANNUAL CAP is applied against company dollar ALREADY collected this
//      year (agentYtdCompanyDollarCents), passed in — never assumed. Once the
//      broker has retained `annualCapCents` in company dollar for the year, the
//      agent keeps 100% of subsequent gross (less the flat fees). A null cap is a
//      clean "uncapped", not a zero cap.
//   3. Flat fees are subtracted as configured, never invented. A per-transaction
//      fee (config.transactionFeeCents) and a franchise/royalty fee
//      (config.franchiseFeeBps, taken off the top of gross) reduce the agent's
//      net; both default to nothing when unset.
//
// ── THE MODEL (documented so it is not re-decided at a call site) ────────────
// The order of operations is the common brokerage one and each step is a
// configured fact, never a guess:
//   franchise fee off the top of GROSS  →  house split of the ADJUSTED gross into
//   company dollar (broker) + agent share  →  apply the annual company-dollar CAP
//   (once the broker has collected the cap for the year, the agent keeps the rest)
//   →  subtract the flat per-transaction fee to get the agent's net.
//
// Company dollar is the broker's split share (what the cap counts). It is
// reported separately from the flat transaction fee so nothing is double-counted:
// brokerCents is the split retention only; transactionFeeCents is its own line.
// ============================================================================

/** The operator's OWN saved split arrangement. Null fields mean "not configured". */
export interface CommissionSplitConfig {
  /**
   * The agent's share of the (franchise-adjusted) gross, in basis points
   * (7000 = 70% to the agent, 30% company dollar to the broker). Null = the
   * split is unconfigured and the engine REFUSES — a split is never assumed.
   */
  agentSplitBps: number | null;
  /**
   * The ANNUAL company-dollar cap, in cents: once the broker has retained this
   * much company dollar for the year, the agent keeps 100% of subsequent gross
   * (less flat fees). Null = uncapped (a clean absence, not a zero cap).
   */
  annualCapCents: number | null;
  /** A flat per-transaction fee the agent pays at closing, in cents. Null/0 = none. */
  transactionFeeCents: number | null;
  /**
   * A franchise/royalty fee taken off the top of gross, in basis points
   * (600 = 6% of GCI). Null/0 = none.
   */
  franchiseFeeBps: number | null;
}

export interface CommissionSplitResult {
  /** False when the split is unconfigured/refused — never a computed zero. */
  applicable: boolean;
  /** The gross commission (GCI) that was split, echoed for the frozen record. */
  grossCommissionCents: number | null;
  /** Franchise/royalty fee taken off the top of gross. 0 when none, null when refused. */
  franchiseFeeCents: number | null;
  /** Gross after the franchise fee — the base of the house split. Null when refused. */
  adjustedGrossCents: number | null;
  /** The broker's split share BEFORE the cap is applied. Null when refused. */
  companyDollarBeforeCapCents: number | null;
  /** The agent's gross split share (incl. any cap-freed dollars), before flat fees. Null when refused. */
  agentCents: number | null;
  /** The company dollar the broker actually retains on THIS deal, after the cap. Null when refused. */
  brokerCents: number | null;
  /** The flat per-transaction fee applied. 0 when none, null when refused. */
  transactionFeeCents: number | null;
  /** The agent's net after split, cap and flat fees. Null when refused — the honest "cannot say". */
  agentNetCents: number | null;
  /** True when the annual cap reduced (or eliminated) the broker's take on this deal. */
  cappedThisDeal: boolean;
  /** Company-dollar cap room remaining BEFORE this deal, in cents. Null when uncapped/refused. */
  capRemainingBeforeCents: number | null;
  /** Non-null when the engine refused (no config / no split / bad inputs) — surface it, split nothing. */
  refusedReason: string | null;
}

const REFUSED_BASE = {
  applicable: false as const,
  franchiseFeeCents: null,
  adjustedGrossCents: null,
  companyDollarBeforeCapCents: null,
  agentCents: null,
  brokerCents: null,
  transactionFeeCents: null,
  agentNetCents: null,
  cappedThisDeal: false as const,
  capRemainingBeforeCents: null,
};

function refuse(grossCommissionCents: number | null, reason: string): CommissionSplitResult {
  return { ...REFUSED_BASE, grossCommissionCents, refusedReason: reason };
}

/**
 * Split one deal's gross commission between the agent and their broker.
 *
 * REFUSES (applicable=false, agentNetCents null, refusedReason set) when the
 * split cannot be computed from configured facts: no split config, no agent
 * share, an out-of-range share, or no gross commission. It never assumes a
 * split, a cap or a fee.
 */
export function computeCommissionSplit(args: {
  grossCommissionCents: number | null;
  config: CommissionSplitConfig | null;
  agentYtdCompanyDollarCents?: number;
}): CommissionSplitResult {
  const { grossCommissionCents, config } = args;

  // 1. No split config at all → refuse. A split is a private negotiated term.
  if (config == null) {
    return refuse(
      grossCommissionCents,
      "No commission split is configured for this workspace. A split is a private, negotiated term — " +
        "refusing to assume one. Save your split arrangement to compute agent net.",
    );
  }

  // 2. The agent share is the one thing that is never assumed.
  if (config.agentSplitBps == null) {
    return refuse(
      grossCommissionCents,
      "No agent split percentage is configured. Refusing to split a commission without the agreed share.",
    );
  }
  if (config.agentSplitBps < 0 || config.agentSplitBps > 10000) {
    return refuse(
      grossCommissionCents,
      "The configured agent split is out of range (must be between 0% and 100%). Refusing to compute a split from an invalid share.",
    );
  }

  // 3. No gross commission → nothing to split; refuse rather than emit a zero net.
  if (grossCommissionCents == null || grossCommissionCents < 0) {
    return refuse(
      grossCommissionCents,
      "No gross commission is available to split for this deal. Refusing to compute a net on an assumed figure.",
    );
  }

  const gross = grossCommissionCents;
  const ytd = Math.max(0, args.agentYtdCompanyDollarCents ?? 0);

  // Franchise/royalty off the top of gross.
  const franchiseFeeCents =
    config.franchiseFeeBps != null && config.franchiseFeeBps > 0
      ? Math.round(gross * (config.franchiseFeeBps / 10000))
      : 0;
  const adjustedGrossCents = Math.max(0, gross - franchiseFeeCents);

  // House split of the adjusted gross → company dollar (broker) before the cap.
  const companyBps = 10000 - config.agentSplitBps;
  const companyDollarBeforeCapCents = Math.round(adjustedGrossCents * (companyBps / 10000));

  // Apply the ANNUAL company-dollar cap against what the broker has already
  // collected this year. Uncapped when annualCapCents is null.
  let brokerCents: number;
  let cappedThisDeal: boolean;
  let capRemainingBeforeCents: number | null;
  if (config.annualCapCents != null) {
    capRemainingBeforeCents = Math.max(0, config.annualCapCents - ytd);
    brokerCents = Math.min(companyDollarBeforeCapCents, capRemainingBeforeCents);
    // The cap "bit" whenever it reduced the broker's take (including a full
    // pass-through once the cap is already met, i.e. room is 0).
    cappedThisDeal = companyDollarBeforeCapCents > capRemainingBeforeCents;
  } else {
    capRemainingBeforeCents = null;
    brokerCents = companyDollarBeforeCapCents;
    cappedThisDeal = false;
  }

  // The agent keeps the adjusted gross the broker does not retain (their split
  // share plus any dollars the cap freed up).
  const agentCents = adjustedGrossCents - brokerCents;

  const transactionFeeCents =
    config.transactionFeeCents != null && config.transactionFeeCents > 0
      ? config.transactionFeeCents
      : 0;
  // Franchise is already off the top; the flat transaction fee is the only
  // remaining deduction from the agent's share.
  const agentNetCents = agentCents - transactionFeeCents;

  return {
    applicable: true,
    grossCommissionCents: gross,
    franchiseFeeCents,
    adjustedGrossCents,
    companyDollarBeforeCapCents,
    agentCents,
    brokerCents,
    transactionFeeCents,
    agentNetCents,
    cappedThisDeal,
    capRemainingBeforeCents,
    refusedReason: null,
  };
}
