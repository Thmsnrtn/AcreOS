/**
 * The operator's land-deal underwriting rules — the land equivalent of
 * `PLATFORM_FLIP_DEFAULTS` / `resolveFlipDefaults` in `flipUnderwriting.ts`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `organizations.underwritingDefaults` carried an `ownerFinance` section and a
 * `flip` section. It carried nothing for land — the wedge vertical — so
 * `buildCashFlipScenario` in `blindOfferCalculator.ts` hardcoded every cost it
 * needed: holding as `acquisition * 0.02 + salePrice * 0.01`, disposition as
 * `salePrice * 0.08`, and a 45-day hold. Those numbers reached the customer as
 * `netProfit` and `roi` with nothing marking them as ours rather than theirs.
 *
 * The flip section's own schema comment already states the house rule this
 * follows: "Every field is optional: an absent field falls back to
 * PLATFORM_FLIP_DEFAULTS and is BADGED as a platform default in the UI, never
 * presented as the operator's own rule."
 *
 * WHY THE PLATFORM NUMBERS ARE THE OLD HARDCODES
 * ----------------------------------------------
 * Deliberately unchanged. The defect was that they were INVISIBLE and
 * UNOVERRIDABLE, not that they were wrong — nobody has evidence for better
 * ones, and inventing new figures here would be the same mistake with fresher
 * digits. What changes is that each one is now named, sourced, and settable.
 *
 * The one place this departs from flip: flip sets `monthlyHoldingCostCents: 0`
 * and treats 0 as "excluded and named as missing", because `computeMao` returns
 * a NULL profit rather than an optimistic one when an input it needs is absent.
 * `computeLandDeal` has no such sentinel — it would compute a profit with zero
 * carry and show a larger number. So land keeps its carry expressed as a rate
 * rather than dropping it, and the rate is visible.
 */

/** Every land-deal rule, as percentages and months. */
export interface LandDealDefaults {
  /** Acquisition closing as a percent of the purchase price. */
  closingAtBuyPct: number;
  /** Resale closing + marketing as a percent of the sale price. */
  dispositionCostPct: number;
  /**
   * Months held from close to resale.
   *
   * The engine floors this to whole months, so the previous 45-day assumption
   * is carried as 2 rather than 1.5 — rounding DOWN would have quietly reduced
   * carry and increased profit, which is the direction this file exists to
   * avoid.
   */
  holdMonths: number;
  /**
   * Carry per month, as a percent of the SALE price.
   *
   * Property tax and insurance during the hold. Expressed against sale price
   * because that is what the previous hardcode did (`salePrice * 0.01` across
   * the whole hold); at the default 2 months × 0.5% it reproduces that 1%
   * exactly, so no figure moves when an org has saved nothing.
   */
  monthlyHoldingPctOfSale: number;
}

/**
 * What AcreOS assumes when the operator has told it nothing.
 *
 * Each figure is the one `buildCashFlipScenario` used inline before
 * 2026-08-19, preserved so that adopting this file moves no customer's numbers.
 */
export const PLATFORM_LAND_DEFAULTS: LandDealDefaults = {
  closingAtBuyPct: 2,
  dispositionCostPct: 8,
  holdMonths: 2,
  monthlyHoldingPctOfSale: 0.5,
};

export type LandDefaultSource = "org_rule" | "platform_default";

export interface ResolvedLandDefaults {
  values: LandDealDefaults;
  /** Per-field provenance so the UI can badge "your rule" vs "our default". */
  sources: Record<keyof LandDealDefaults, LandDefaultSource>;
  /** True when the org has saved at least one land rule. */
  isCustomised: boolean;
}

const LAND_DEFAULT_KEYS = Object.keys(PLATFORM_LAND_DEFAULTS) as Array<
  keyof LandDealDefaults
>;

/**
 * Merge the org's saved land rules over the platform defaults, recording where
 * each field came from.
 *
 * A field is `org_rule` only when the stored value is a FINITE number — a
 * partially-saved blob keeps platform provenance for the fields it does not
 * carry, and a `NaN` or a string that leaked in is treated as absent rather
 * than adopted. Same rule as `resolveFlipDefaults`, deliberately.
 */
export function resolveLandDefaults(
  stored: Partial<LandDealDefaults> | null | undefined,
): ResolvedLandDefaults {
  const values = { ...PLATFORM_LAND_DEFAULTS };
  const sources = {} as Record<keyof LandDealDefaults, LandDefaultSource>;
  let customised = false;

  for (const key of LAND_DEFAULT_KEYS) {
    const raw = stored?.[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      values[key] = raw;
      sources[key] = "org_rule";
      customised = true;
    } else {
      sources[key] = "platform_default";
    }
  }

  return { values, sources, isCustomised: customised };
}

/**
 * The land-deal ENGINE's inputs, in integer cents, from two dollar figures and
 * the org's rules.
 *
 * One mapping, two callers — `buildCashFlipScenario` (what the wizard shows)
 * and the blind-offer commit endpoint (what gets frozen into a Scenario). They
 * were about to be two copies of the same seven-line conversion, and a
 * divergence between them would mean the record of a decision did not match the
 * numbers the operator was looking at when they made it. That is the one
 * failure a frozen scenario exists to prevent, so the mapping is shared rather
 * than trusted to stay identical.
 *
 * Marketing is deliberately zero: `dispositionCostPct` is documented as resale
 * closing AND marketing, so a second marketing figure would count it twice.
 */
export interface LandDealEngineInputs {
  purchaseCents: number;
  closingAtBuyCents: number;
  holdingPerMonthCents: number;
  holdMonths: number;
  marketingCents: number;
  salePriceCents: number;
  closingAtSaleCents: number;
}

export function landDealEngineInputs(
  purchaseDollars: number,
  salePriceDollars: number,
  values: LandDealDefaults,
): LandDealEngineInputs {
  const toCents = (dollars: number) => Math.round(dollars * 100);
  return {
    purchaseCents: toCents(purchaseDollars),
    closingAtBuyCents: toCents(purchaseDollars * (values.closingAtBuyPct / 100)),
    holdingPerMonthCents: toCents(salePriceDollars * (values.monthlyHoldingPctOfSale / 100)),
    holdMonths: values.holdMonths,
    marketingCents: 0,
    salePriceCents: toCents(salePriceDollars),
    closingAtSaleCents: toCents(salePriceDollars * (values.dispositionCostPct / 100)),
  };
}

/** Human labels, so a badge and a scenario assumption read the same words. */
export const LAND_DEFAULT_LABELS: Record<keyof LandDealDefaults, string> = {
  closingAtBuyPct: "Closing costs at purchase",
  dispositionCostPct: "Resale closing + marketing",
  holdMonths: "Months held before resale",
  monthlyHoldingPctOfSale: "Monthly carry (taxes, insurance)",
};

/** Pre-formatted figures, so server and client word an assumption identically. */
export function formatLandDefault(
  key: keyof LandDealDefaults,
  value: number,
): string {
  switch (key) {
    case "holdMonths":
      return `${value} month${value === 1 ? "" : "s"}`;
    case "monthlyHoldingPctOfSale":
      return `${value}% of sale price per month`;
    default:
      return `${value}%`;
  }
}
