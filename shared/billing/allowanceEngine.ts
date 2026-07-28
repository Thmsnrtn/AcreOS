/**
 * Free-taste allowance engine — founder decisions 2026-07-28, rulings #2 + #6.
 *
 * Ruling #2 (allowance shape): every plan includes a MONTHLY allowance of
 * platform sends/lookups per rail; past it (or on higher tiers) the customer
 * connects their own account (BYO).
 *
 * Ruling #6 (allowance sizing): each plan's monthly included allowance is
 * DERIVED, never hand-set — whatever quantity of platform sends/lookups costs
 * the platform ≤ ~20% of that plan's monthly price, computed from live
 * provider prices. Margin-safe by construction; auto-adjusts with any future
 * price change. No number is ever hand-invented.
 *
 * This module is deliberately PURE: it takes the plan price and the verified
 * per-unit provider costs as inputs and does only arithmetic. It never
 * invents a unit cost — the caller (server-side) supplies constants verified
 * against the real provider integrations (see /api/billing/allowances in
 * server/routes-billing.ts for the sources). If a rail's true cost is not
 * known, the caller must not call this with a guess.
 *
 * ── The split, and why ──────────────────────────────────────────────────────
 * The 20%-of-price budget is allocated across the three platform rails by
 * FIXED weights that reflect the wedge:
 *
 *   letters      45% — the physical letter is the product's wow moment and by
 *                      far the most expensive unit (~85¢ vs cents); it gets
 *                      the largest slice so every plan includes a real taste
 *                      of the thing that closes deals.
 *   data lookups 40% — lookups (parcel / owner / skip-trace) are what FEED
 *                      the letters; a letter without data is unaddressable,
 *                      so data gets nearly as much budget as mail.
 *   email        15% — email is near-free per unit, so even a small slice
 *                      buys a generous count; giving it more would waste
 *                      budget that letters and data actually need.
 *
 * Weights are constants (not inputs) so the split is a recorded design
 * decision, pinned by tests (they must sum to 1), and changed only
 * deliberately in code review — never per-request.
 *
 * ── Rounding ────────────────────────────────────────────────────────────────
 * Every division rounds DOWN (Math.floor). We never promise a unit the budget
 * can't fully cover; the honest direction of error is "slightly fewer than
 * the budget would stretch to", never "slightly more".
 */

/** Fixed budget split across the three platform rails. Must sum to 1. */
export const ALLOWANCE_RAIL_WEIGHTS = {
  letters: 0.45,
  dataLookups: 0.4,
  email: 0.15,
} as const;

export type AllowanceRail = keyof typeof ALLOWANCE_RAIL_WEIGHTS;

/**
 * Verified per-unit platform costs, in cents. These MUST come from the real
 * provider constants in code (never invented). The server endpoint documents
 * exactly where each one is read from.
 */
export interface AllowanceUnitCosts {
  /** Cost of one platform data lookup, in cents. */
  dataLookupCents: number;
  /** Cost of one platform-sent letter, in cents. */
  letterCents: number;
  /** Cost of one platform-sent email, in cents. */
  emailCents: number;
}

export interface DeriveAllowancesInput {
  /** The plan's monthly price, in cents (e.g. Pro = 4900). */
  planPriceCents: number;
  /**
   * Fraction of the plan price the included allowance may cost the platform.
   * Defaults to 0.20 per ruling #6 ("≤ ~20% of that plan's monthly price").
   */
  marginFraction?: number;
  unitCosts: AllowanceUnitCosts;
}

export interface RailAllowance {
  /** Included units per month, floored — the number the customer sees. */
  count: number;
  /** The verified per-unit cost this count was derived from, in cents. */
  unitCostCents: number;
  /** This rail's slice of the monthly budget, in cents (floored). */
  budgetShareCents: number;
  /** What the derived count actually costs (count × unit), in cents. */
  spendCents: number;
}

export interface DerivedAllowances {
  planPriceCents: number;
  marginFraction: number;
  /** Total monthly platform-cost budget = floor(price × marginFraction). */
  budgetCents: number;
  weights: typeof ALLOWANCE_RAIL_WEIGHTS;
  rails: Record<AllowanceRail, RailAllowance>;
  /** Sum of all rails' spendCents — always ≤ budgetCents by construction. */
  totalSpendCents: number;
}

/**
 * Floor that forgives binary floating-point representation error only.
 * 0.145 * 1000 is 144.99999999999997 in IEEE doubles; the intended value is
 * 145 and flooring the raw double would drop a whole unit for no real
 * reason. The epsilon (1e-9 cents) is far below any money amount, so this
 * can never round a genuinely fractional cent up.
 */
function floorCents(x: number): number {
  return Math.floor(x + 1e-9);
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`allowanceEngine: ${name} must be a finite number >= 0 (got ${value})`);
  }
}

/**
 * Derive the monthly included allowance counts for each rail.
 *
 * Throws (refuses) rather than guessing when inputs are unusable:
 *  - negative / non-finite plan price
 *  - marginFraction outside (0, 1]
 *  - any unit cost that is zero, negative, or non-finite (a zero unit cost
 *    would derive an infinite allowance — that is a caller bug, not a
 *    promotion).
 *
 * A zero-price plan is valid and derives zero everywhere (a free plan buys
 * no platform sends — honest, not punitive: BYO still works on free).
 */
export function deriveAllowances(input: DeriveAllowancesInput): DerivedAllowances {
  const { planPriceCents, unitCosts } = input;
  const marginFraction = input.marginFraction ?? 0.2;

  assertFiniteNonNegative(planPriceCents, "planPriceCents");
  if (!Number.isFinite(marginFraction) || marginFraction <= 0 || marginFraction > 1) {
    throw new Error(
      `allowanceEngine: marginFraction must be in (0, 1] (got ${marginFraction})`,
    );
  }
  const costEntries: Array<[AllowanceRail, number]> = [
    ["letters", unitCosts.letterCents],
    ["dataLookups", unitCosts.dataLookupCents],
    ["email", unitCosts.emailCents],
  ];
  for (const [rail, cents] of costEntries) {
    if (!Number.isFinite(cents) || cents <= 0) {
      throw new Error(
        `allowanceEngine: unit cost for ${rail} must be a finite number > 0 (got ${cents}) — ` +
          `if this rail's true provider cost is unknown, exclude the rail rather than guessing`,
      );
    }
  }

  const budgetCents = floorCents(planPriceCents * marginFraction);

  const rails = {} as Record<AllowanceRail, RailAllowance>;
  let totalSpendCents = 0;
  for (const [rail, unitCostCents] of costEntries) {
    const budgetShareCents = floorCents(budgetCents * ALLOWANCE_RAIL_WEIGHTS[rail]);
    const count = Math.max(0, floorCents(budgetShareCents / unitCostCents));
    const spendCents = count * unitCostCents;
    rails[rail] = { count, unitCostCents, budgetShareCents, spendCents };
    totalSpendCents += spendCents;
  }

  return {
    planPriceCents,
    marginFraction,
    budgetCents,
    weights: ALLOWANCE_RAIL_WEIGHTS,
    rails,
    totalSpendCents,
  };
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function plural(count: number, singular: string, pluralWord?: string): string {
  return `${count} ${count === 1 ? singular : (pluralWord ?? `${singular}s`)}`;
}

/**
 * Plain-words description of a derived allowance, for the founder cost panel
 * (and, later, customer-facing copy once that ships as its own reviewed
 * change). States the derivation honestly — including when a plan includes
 * nothing.
 */
export function formatAllowanceSummary(d: DerivedAllowances): string {
  const pct = Math.round(d.marginFraction * 100);
  if (d.budgetCents <= 0) {
    return (
      `A ${dollars(d.planPriceCents)}/mo plan derives no included platform sends or lookups ` +
      `(${pct}% of the price is ${dollars(d.budgetCents)}). Bring-your-own accounts still work.`
    );
  }
  const parts = [
    plural(d.rails.letters.count, "letter"),
    plural(d.rails.dataLookups.count, "data lookup"),
    plural(d.rails.email.count, "email"),
  ];
  return (
    `On a ${dollars(d.planPriceCents)}/mo plan, up to ${dollars(d.budgetCents)}/mo ` +
    `(${pct}% of the price) of platform cost is included each month: ` +
    `${parts[0]}, ${parts[1]}, and ${parts[2]}. ` +
    `Actual cost of that allowance: ${dollars(d.totalSpendCents)}/mo. ` +
    `Past the allowance, connect your own provider accounts (bring-your-own).`
  );
}
