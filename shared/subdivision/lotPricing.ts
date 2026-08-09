// ============================================================================
// SHARED/SUBDIVISION/LOTPRICING.TS — per-lot asking prices, priced honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. This is the ONE place
// a subdivision's per-lot asking price is computed, so the rules that keep the
// number honest are decided once here and cannot be re-decided per call site:
//
//   1. The base price is the PARENT PARCEL'S OWN value per acre — its AVM
//      (market value), else its purchase price — or an operator-supplied
//      fixed $/acre. It is NEVER a residential comp: a raw-land subdivision
//      is not priced off nearby house sales, and this engine has no path to
//      one. (DO-NOT-DO list: "no residential-comps data plane".)
//   2. When the base cannot be derived — the parent has no market value AND no
//      purchase price, or its acreage is unknown / non-positive — the engine
//      REFUSES (returns null) rather than invent a $/acre. A grid built on a
//      fabricated base is exactly the kind of number this program refuses.
//   3. Premiums are SIGNED. A corner lot is +10%; a sub-1.5-acre interior lot
//      is −10%. Negative premiums are first-class, so a discount lot reads as a
//      real discount, never clamped to zero.
//
// The lock step (server/routes-lot-pricing.ts) freezes the computed grid onto
// lot_pricing_rules.lockedGrid and writes each lot's listPrice; the pro-forma
// engine reads that frozen grid back as gross proceeds. Keeping the math here,
// pure, is what lets that flow share ONE definition of the price.
// ============================================================================

/**
 * A single premium rule. Mirrors lot_pricing_rules.rules (shared/schema/
 * subdivision.ts): match `attribute` against a per-lot fact with `operator`
 * and (for the comparison operators) `threshold`, and on a match add the
 * SIGNED `premiumPct` (0.10 = +10%, -0.10 = -10%) to the lot's premium.
 */
export interface LotPricingRule {
  attribute: string;
  operator: "==" | ">" | "<" | ">=" | "<=";
  threshold?: number | string | boolean;
  premiumPct: number;
  label?: string;
}

/** The per-lot facts + identity the grid needs for one child lot. */
export interface LotPricingChild {
  id: number;
  childLotNumber: string | null;
  sizeAcres: number;
  /** Facts the rules match against (acres, zoning, corner, frontage, view, …). */
  attributes: Record<string, number | string | boolean>;
}

/** How the base price per acre is anchored — the parent's own value or a fixed rate. */
export interface DeriveBaseArgs {
  /** lot_pricing_rules.basePriceSource: "avm_per_acre" | "fixed_per_acre". */
  source: string;
  /** Operator-supplied $/acre baseline, in cents — used only for "fixed_per_acre". */
  fixedPerAcreCents: number | null;
  /** The PARENT parcel's market value (AVM), in cents. Preferred base numerator. */
  marketValueCents: number | null;
  /** The PARENT parcel's purchase price, in cents. Fallback base numerator. */
  purchasePriceCents: number | null;
  /** The PARENT parcel's acreage — the base denominator. */
  acres: number;
}

/**
 * Derive the base price per acre, in cents — or REFUSE (null).
 *
 * Precedence: an operator-supplied fixed $/acre ("fixed_per_acre") wins; else
 * the base is the parent parcel's OWN value ÷ its acreage — market value (AVM)
 * preferred, purchase price as fallback. There is deliberately no residential-
 * comp path: the base is the parent's own worth per acre, nothing else.
 *
 * Returns null when the base is underivable: no fixed rate AND (no positive
 * market/purchase value OR non-positive acreage). The caller must surface the
 * refusal and price no grid, never substitute a guess.
 */
export function deriveBasePerAcreCents(args: DeriveBaseArgs): number | null {
  if (args.source === "fixed_per_acre" && args.fixedPerAcreCents != null && args.fixedPerAcreCents > 0) {
    return args.fixedPerAcreCents;
  }
  if (!(args.acres > 0)) return null;
  const valueCents =
    args.marketValueCents != null && args.marketValueCents > 0
      ? args.marketValueCents
      : args.purchasePriceCents != null && args.purchasePriceCents > 0
        ? args.purchasePriceCents
        : 0;
  if (!(valueCents > 0)) return null;
  return Math.round(valueCents / args.acres);
}

/**
 * Evaluate the premium rules against one lot's facts.
 *
 * A rule fires only when its attribute is PRESENT in the facts (an unknown fact
 * never matches — no fact, no premium) and the comparison holds. Numeric
 * comparisons require both sides to be numbers; equality is strict. Matched
 * premiums sum (signed), so premiums stack and a discount rule can pull the
 * total below zero.
 */
export function evaluateRules(
  rules: LotPricingRule[],
  facts: Record<string, unknown>,
): { totalPremiumPct: number; matched: Array<{ attribute: string; premiumPct: number }> } {
  let total = 0;
  const matched: Array<{ attribute: string; premiumPct: number }> = [];
  for (const r of rules) {
    const f = facts[r.attribute];
    if (f === undefined) continue;
    let ok = false;
    switch (r.operator) {
      case "==": ok = f === r.threshold; break;
      case ">":  ok = typeof f === "number" && typeof r.threshold === "number" && f > r.threshold; break;
      case "<":  ok = typeof f === "number" && typeof r.threshold === "number" && f < r.threshold; break;
      case ">=": ok = typeof f === "number" && typeof r.threshold === "number" && f >= r.threshold; break;
      case "<=": ok = typeof f === "number" && typeof r.threshold === "number" && f <= r.threshold; break;
    }
    if (ok) {
      total += r.premiumPct;
      matched.push({ attribute: r.attribute, premiumPct: r.premiumPct });
    }
  }
  return { totalPremiumPct: total, matched };
}

/** One computed row of the asking-price grid (before any operator override). */
export interface LotPricingGridRow {
  childParcelId: number;
  childLotNumber: string | null;
  sizeAcres: number;
  /** basePerAcreCents × acres, rounded. */
  basePriceCents: number;
  /** The signed premium applied to the base. */
  premiumPct: number;
  /** basePriceCents × (1 + premiumPct), rounded — the computed asking price. */
  askingPriceCents: number;
  matchedRules: Array<{ attribute: string; premiumPct: number }>;
}

/**
 * Compute the asking-price grid for a set of child lots off a derived base.
 *
 * Each lot's base is `basePerAcreCents × acres`; its premium is the signed sum
 * of the rules it matches; its asking price is `base × (1 + premium)`, rounded.
 * A negative net premium yields an asking price below base — intended, not an
 * error. This is a pure projection of the inputs; operator overrides are applied
 * by the caller at lock time, not here.
 */
export function computeLotPricingGrid(
  basePerAcreCents: number,
  children: LotPricingChild[],
  rules: LotPricingRule[],
): LotPricingGridRow[] {
  return children.map((c) => {
    const basePriceCents = Math.round(basePerAcreCents * c.sizeAcres);
    const { totalPremiumPct, matched } = evaluateRules(rules, c.attributes);
    const askingPriceCents = Math.round(basePriceCents * (1 + totalPremiumPct));
    return {
      childParcelId: c.id,
      childLotNumber: c.childLotNumber,
      sizeAcres: c.sizeAcres,
      basePriceCents,
      premiumPct: totalPremiumPct,
      askingPriceCents,
      matchedRules: matched,
    };
  });
}
