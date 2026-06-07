/**
 * Data-procurement policy (Lena CFO lens, items 3 + 6).
 *
 * Encodes the financial gate for turning on a paid data provider. Two rules:
 *
 *  1. **Vendor-cost guardrail (the 2%-of-MRR rule).** Lena's constitutional
 *     decision authority caps recurring vendor onboarding at ≤2% of monthly
 *     revenue without Solene+Tom. A data vendor's minimum monthly commit
 *     (Regrid/ATTOM/Batch floors) can silently exceed that. We refuse to
 *     enable a paid provider whose minMonthlyCommit > 2% of trailing MRR.
 *     Pay-per-call vendors with no floor (minMonthlyCommit = 0) always pass.
 *
 *  2. **The MRR phase gate.** No paid data is purchasable below $200 sustained
 *     MRR (Phase 1). Phase 2 ($1k) unlocks Regrid pay-per-call; Phase 3 ($5k)
 *     considers flat subscriptions.
 *
 * This module is pure arithmetic and lives in `shared/` so the pricing page,
 * a founder settings surface, and the server gate all read one source of
 * truth. The server passes in trailing MRR (dollars) + the provider's
 * minMonthlyCommitCents; the function returns an allow/deny with a reason.
 */

/** Lena's vendor-cost cap: a recurring vendor floor may not exceed 2% of MRR. */
export const VENDOR_COMMIT_MRR_FRACTION = 0.02;

/** Hard minimum MRR (dollars) before ANY paid data is purchasable (Phase 1). */
export const MIN_MRR_FOR_PAID_DATA_DOLLARS = 200;

export interface PaidProviderGateInput {
  /** Trailing monthly recurring revenue, in whole dollars. */
  trailingMrrDollars: number;
  /** The provider's minimum monthly commit, in cents (0 = pay-per-call). */
  minMonthlyCommitCents: number;
}

export interface PaidProviderGateResult {
  allowed: boolean;
  reason: string;
  /** The computed 2%-of-MRR ceiling in cents, for surfacing in the UI. */
  commitCeilingCents: number;
}

/**
 * Decide whether a paid provider may be enabled given trailing MRR and the
 * provider's monthly floor. Pure + deterministic.
 */
export function evaluatePaidProviderGate(
  input: PaidProviderGateInput,
): PaidProviderGateResult {
  const mrr = Number.isFinite(input.trailingMrrDollars)
    ? Math.max(0, input.trailingMrrDollars)
    : 0;
  const floorCents = Number.isFinite(input.minMonthlyCommitCents)
    ? Math.max(0, input.minMonthlyCommitCents)
    : 0;
  const commitCeilingCents = Math.floor(mrr * 100 * VENDOR_COMMIT_MRR_FRACTION);

  // Phase gate: nothing paid below $200 sustained MRR.
  if (mrr < MIN_MRR_FOR_PAID_DATA_DOLLARS) {
    return {
      allowed: false,
      reason: `Paid data is locked below $${MIN_MRR_FOR_PAID_DATA_DOLLARS} MRR (current: $${Math.round(mrr)}).`,
      commitCeilingCents,
    };
  }

  // Pay-per-call vendors (no floor) always pass the commit guardrail.
  if (floorCents === 0) {
    return {
      allowed: true,
      reason: "Pay-per-call vendor (no monthly floor) — within guardrail.",
      commitCeilingCents,
    };
  }

  // Flat-commit vendors must clear the 2%-of-MRR ceiling.
  if (floorCents > commitCeilingCents) {
    return {
      allowed: false,
      reason:
        `Vendor monthly commit ($${(floorCents / 100).toFixed(2)}) exceeds the ` +
        `2%-of-MRR ceiling ($${(commitCeilingCents / 100).toFixed(2)} at $${Math.round(mrr)} MRR). ` +
        `Requires Solene+Tom sign-off.`,
      commitCeilingCents,
    };
  }

  return {
    allowed: true,
    reason:
      `Vendor monthly commit ($${(floorCents / 100).toFixed(2)}) is within the ` +
      `2%-of-MRR ceiling ($${(commitCeilingCents / 100).toFixed(2)}).`,
    commitCeilingCents,
  };
}
