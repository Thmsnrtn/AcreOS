/**
 * Canonical revenue-allocation policy for the financial ledger (Pillar 1).
 *
 * Every dollar of platform revenue is split into five named buckets the
 * moment it lands. The buckets are mutually exclusive and exhaustive:
 *
 *   - tax_reserve   (25%) — set-aside for federal/state income tax
 *   - refund_reserve (10%) — covers chargebacks, refunds, disputes
 *   - profit_reserve  (5%) — undistributed retained earnings
 *   - owner_draw      (5%) — founder personal compensation
 *   - opex_available (55%) — the only bucket from which spend can post.
 *                            Every external-provider charge debits here.
 *
 * The policy lives in `founder_settings` under the key `allocation.policy`
 * (JSON value) so it can be tuned from the /founder/studio surface without
 * a deploy. This module is the *default* when no founder override exists,
 * and the *type definition* the rest of the code uses to refer to bucket
 * names.
 *
 * Invariant: the five fractions MUST sum to 1.0 exactly (validated at
 * service boundary). Any change in production must go through founderSettings
 * setSetting with audit logging.
 */

export type BucketName =
  | "tax_reserve"
  | "refund_reserve"
  | "profit_reserve"
  | "owner_draw"
  | "opex_available";

export const BUCKET_NAMES: readonly BucketName[] = [
  "tax_reserve",
  "refund_reserve",
  "profit_reserve",
  "owner_draw",
  "opex_available",
] as const;

export interface AllocationPolicy {
  tax_reserve: number;
  refund_reserve: number;
  profit_reserve: number;
  owner_draw: number;
  opex_available: number;
}

export const DEFAULT_ALLOCATION_POLICY: AllocationPolicy = {
  tax_reserve: 0.25,
  refund_reserve: 0.10,
  profit_reserve: 0.05,
  owner_draw: 0.05,
  opex_available: 0.55,
};

/**
 * Founder-settings key under which the live allocation policy is stored
 * (as a JSON-serialised AllocationPolicy). Service-layer code should read
 * via getSetting(FOUNDER_SETTINGS_ALLOCATION_POLICY_KEY) and fall back to
 * DEFAULT_ALLOCATION_POLICY when absent or unparsable.
 */
export const FOUNDER_SETTINGS_ALLOCATION_POLICY_KEY = "allocation.policy";

/**
 * Validate that an allocation policy's fractions are well-formed and sum
 * to 1.0 within a small floating-point epsilon. Throws on failure.
 */
export function assertValidAllocationPolicy(p: AllocationPolicy): void {
  for (const k of BUCKET_NAMES) {
    const v = p[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(`allocation policy: invalid fraction for ${k}: ${v}`);
    }
  }
  const sum =
    p.tax_reserve +
    p.refund_reserve +
    p.profit_reserve +
    p.owner_draw +
    p.opex_available;
  if (Math.abs(sum - 1.0) > 1e-6) {
    throw new Error(`allocation policy: fractions must sum to 1.0 (got ${sum})`);
  }
}

/**
 * Deterministic integer-cents split: distribute `amountCents` across the
 * five buckets so that the parts sum back to `amountCents` exactly (no
 * rounding loss). Any rounding residue is absorbed into `opex_available`
 * because it is both the largest share and the only bucket that gets
 * spent against — penny mismatches against it are immaterial.
 */
export function splitAmountByPolicy(
  amountCents: number,
  policy: AllocationPolicy,
): Record<BucketName, number> {
  if (!Number.isInteger(amountCents)) {
    throw new Error(`splitAmountByPolicy: amountCents must be an integer, got ${amountCents}`);
  }
  const tax = Math.round(amountCents * policy.tax_reserve);
  const refund = Math.round(amountCents * policy.refund_reserve);
  const profit = Math.round(amountCents * policy.profit_reserve);
  const draw = Math.round(amountCents * policy.owner_draw);
  const opex = amountCents - tax - refund - profit - draw;
  return {
    tax_reserve: tax,
    refund_reserve: refund,
    profit_reserve: profit,
    owner_draw: draw,
    opex_available: opex,
  };
}
