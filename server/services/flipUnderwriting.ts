/**
 * Fix-and-flip underwriting math — the 70%-rule MAO chain (comps → ARV → MAO
 * → offer).
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * `calculateFlipAnalysis` and `calculateRentalAnalysis` lived on
 * `DealUnderwritingService` (server/services/dealUnderwriting.ts) with ZERO
 * routes and ZERO client references — a fix-and-flip customer could not
 * compute a Maximum Allowable Offer in-product while Pax's wholesaler persona
 * prompt (server/services/pax/personas.ts) talks about MAO as if it were
 * available. The two functions are MOVED here (not copied) so:
 *
 *   1. the math has a single home that imports NO database module, so the
 *      arithmetic is unit-testable without DATABASE_URL, and
 *   2. `DealUnderwritingService` keeps its public method surface by
 *      delegating to these exports (no call site changes).
 *
 * The only change to the moved arithmetic is that the two hardcoded
 * constants — the 70% rule factor and the 7% selling-cost factor — became
 * trailing parameters that DEFAULT to 70 and 7. Output at the defaults is
 * bit-identical to the pre-move behaviour; the parameters exist so the
 * operator's own rules (organizations.underwritingDefaults.flip) drive the
 * result instead of a platform constant.
 *
 * MONEY UNITS
 * ───────────
 * Everything in this module is INTEGER CENTS, matching the fix-and-flip
 * schema (`arv_calculations.arv_mid_cents`, `rehabs.budget_total_cents`).
 * `calculateFlipAnalysis` / `calculateRentalAnalysis` are homogeneous of
 * degree 1 in money (MAO, profit and NOI are linear; ROI, cap rate and GRM
 * are ratios), so passing cents is exact and rounds at the cent rather than
 * at the dollar. Percentages are whole-number percents (70 = 70%), never
 * fractions, and are never mixed with the `numeric` decimal-dollar strings
 * that `properties`/`offers` use — conversion happens once, at the route
 * boundary.
 *
 * HONESTY CONTRACT (this is a valuation surface)
 * ─────────────────────────────────────────────
 * Every figure the customer sees must trace to an operator input, a stored
 * org rule, or an explicitly labelled platform default. So:
 *   - `resolveFlipDefaults` reports a `source` per field — "org_rule" when the
 *     operator saved it, "platform_default" when it did not.
 *   - Holding cost has NO invented default (0 ¢/month, source "not_set"): an
 *     unset holding cost is excluded from net profit and named in `missing`,
 *     never filled with a plausible-looking number.
 *   - Net profit is null (not zero, not optimistic) whenever an input it needs
 *     is absent, and `profitBasis` says which price the profit is computed
 *     against.
 *   - The raw 70%-rule profit line is reported separately as
 *     `rule*` fields and labelled: it deliberately ignores acquisition closing
 *     costs and holding costs, so it reads HIGH. The `net*` fields are the
 *     fuller model.
 */

// ────────────────────────────────────────────────────────────────────────────
// Moved verbatim from DealUnderwritingService (see file header for the one
// change: the trailing rulePct / sellingCostPct parameters).
// ────────────────────────────────────────────────────────────────────────────

/**
 * ARV analysis for fix & flip properties.
 * Uses the n% rule (classic 70): MAO = ARV × n% − estimated repair cost.
 *
 * @param afterRepairValue  ARV, integer cents.
 * @param estimatedRepairCost  Repair budget, integer cents.
 * @param purchasePrice  Price being tested, integer cents.
 * @param rulePct  Percent of ARV the rule allows (default 70 = the 70% rule).
 * @param sellingCostPct  Resale cost as a percent of ARV (default 7).
 */
export function calculateFlipAnalysis(
  afterRepairValue: number,
  estimatedRepairCost: number,
  purchasePrice: number,
  rulePct: number = 70,
  sellingCostPct: number = 7,
): {
  mao: number;
  profitProjection: number;
  roi: number;
  isGoodDeal: boolean;
} {
  const mao = afterRepairValue * (rulePct / 100) - estimatedRepairCost;
  const totalInvested = purchasePrice + estimatedRepairCost;
  const profitProjection =
    afterRepairValue * (1 - sellingCostPct / 100) - totalInvested;
  const roi = totalInvested > 0 ? (profitProjection / totalInvested) * 100 : 0;

  return {
    mao: Math.round(mao),
    profitProjection: Math.round(profitProjection),
    roi: Math.round(roi * 10) / 10,
    isGoodDeal: purchasePrice <= mao && profitProjection > 0,
  };
}

/**
 * Cash-on-cash and cap rate analysis for buy & hold (rental) properties.
 *
 * NOTE on the 40% fallback: when `monthlyExpenses` is 0/omitted this
 * substitutes a 40% expense ratio. That substitution is an ASSUMPTION, and
 * the return value cannot say so — callers must use
 * `computeRentalReturns` (below), which reports `expenseBasis`, rather than
 * rendering these numbers unlabelled.
 *
 * NOTE on cashOnCashReturn: with no financing, cash-on-cash IS the cap rate.
 * The two fields are the SAME number under two names, not two independent
 * derivations. `computeRentalReturns` labels it accordingly.
 */
export function calculateRentalAnalysis(
  purchasePrice: number,
  monthlyRent: number,
  monthlyExpenses: number = 0,
): {
  cashOnCashReturn: number;
  capRate: number;
  grossRentMultiplier: number;
  monthlyCashFlow: number;
  annualNOI: number;
} {
  const annualRent = monthlyRent * 12;
  // Estimate 40% expenses if not provided (taxes, insurance, maintenance, vacancy)
  const annualExpenses = monthlyExpenses > 0 ? monthlyExpenses * 12 : annualRent * 0.4;
  const annualNOI = annualRent - annualExpenses;
  const monthlyCashFlow = annualNOI / 12;
  const capRate = purchasePrice > 0 ? (annualNOI / purchasePrice) * 100 : 0;
  const cashOnCashReturn = capRate; // Simplified — no leverage
  const grossRentMultiplier = monthlyRent > 0 ? purchasePrice / annualRent : 0;

  return {
    cashOnCashReturn: Math.round(cashOnCashReturn * 10) / 10,
    capRate: Math.round(capRate * 10) / 10,
    grossRentMultiplier: Math.round(grossRentMultiplier * 10) / 10,
    monthlyCashFlow: Math.round(monthlyCashFlow),
    annualNOI: Math.round(annualNOI),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Org rules (organizations.underwritingDefaults.flip)
// ────────────────────────────────────────────────────────────────────────────

export interface FlipDefaults {
  /** Percent of ARV the rule allows. 70 = the classic 70% rule. */
  maoRulePct: number;
  /** Percent added on top of the operator's rehab estimate. */
  rehabContingencyPct: number;
  /** Resale cost (agent + closing + concessions) as a percent of ARV. */
  sellingCostPct: number;
  /** Acquisition closing cost as a percent of the purchase price. */
  purchaseClosingPct: number;
  /** Expected months held from close to resale. */
  holdMonths: number;
  /** Carry per month — taxes, insurance, utilities, loan interest. Cents. */
  monthlyHoldingCostCents: number;
  /** Minimum net profit the operator will accept, as a percent of ARV. */
  targetProfitPct: number;
}

/**
 * Platform starting points, shown to an operator who has saved nothing.
 *
 * `monthlyHoldingCostCents` is deliberately 0: a monthly carry depends on the
 * operator's lender, county and utilities, and inventing one would silently
 * change every net-profit figure on the page. 0 means "excluded and named as
 * missing", not "free to hold".
 */
export const PLATFORM_FLIP_DEFAULTS: FlipDefaults = {
  maoRulePct: 70,
  rehabContingencyPct: 10,
  sellingCostPct: 7,
  purchaseClosingPct: 2,
  holdMonths: 6,
  monthlyHoldingCostCents: 0,
  targetProfitPct: 15,
};

export type DefaultSource = "org_rule" | "platform_default";

export interface ResolvedFlipDefaults {
  values: FlipDefaults;
  /** Per-field provenance so the UI can badge "your rule" vs "our default". */
  sources: Record<keyof FlipDefaults, DefaultSource>;
  /** True when the org has saved at least one flip rule. */
  isCustomised: boolean;
}

const FLIP_DEFAULT_KEYS = Object.keys(PLATFORM_FLIP_DEFAULTS) as Array<keyof FlipDefaults>;

/**
 * Merge the org's saved flip rules over the platform defaults, recording where
 * each field came from. A field is "org_rule" only when the stored value is a
 * finite number — a partially-saved blob keeps platform provenance for the
 * fields it does not carry.
 */
export function resolveFlipDefaults(
  stored: Partial<FlipDefaults> | null | undefined,
): ResolvedFlipDefaults {
  const values = { ...PLATFORM_FLIP_DEFAULTS };
  const sources = {} as Record<keyof FlipDefaults, DefaultSource>;
  let customised = false;

  for (const key of FLIP_DEFAULT_KEYS) {
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

// ────────────────────────────────────────────────────────────────────────────
// MAO
// ────────────────────────────────────────────────────────────────────────────

/** Where a number on the MAO card came from. Rendered as a badge. */
export type FigureSource =
  | "operator_input"
  | "org_rule"
  | "platform_default"
  | "saved_arv"
  | "rehab_budget"
  | "not_set";

export interface FlipAssumption {
  key: string;
  label: string;
  /** Pre-formatted for display so server and client agree on the wording. */
  display: string;
  source: FigureSource;
}

export interface MaoInput {
  /** After-repair value, integer cents. Required — never defaulted. */
  arvCents: number;
  /** Operator's rehab estimate BEFORE contingency, integer cents. */
  rehabEstimateCents: number;
  /**
   * The price being tested, integer cents. Omit when the operator has no
   * number yet: profit is then computed AT the MAO and labelled as such.
   */
  purchasePriceCents?: number | null;
  /** Assignment fee / wholesale spread carved out of the MAO, integer cents. */
  feeCents?: number;
  defaults: FlipDefaults;
}

export interface MaoResult {
  arvCents: number;
  rehabEstimateCents: number;
  contingencyCents: number;
  rehabWithContingencyCents: number;
  feeCents: number;

  maoRulePct: number;
  /** 70%-rule MAO, integer cents, AFTER contingency and fee. */
  maoCents: number;

  /** Raw rule outputs — high by construction (no closing, no carry). */
  ruleProfitCents: number;
  ruleRoiPct: number;

  /** Which price the net figures are computed against. */
  profitBasis: "operator_price" | "at_mao";
  priceUsedCents: number;

  purchaseClosingCents: number;
  sellingCostCents: number;
  /** Null when the operator has not set a monthly carry. */
  holdingCostCents: number | null;
  totalCashInCents: number;
  /** Null when holding cost is unknown — never optimistically zeroed. */
  netProfitCents: number | null;
  netProfitPctOfArv: number | null;
  netRoiPct: number | null;

  /** null when netProfit is unknown. */
  meetsTargetProfit: boolean | null;
  /** True when the tested price is at or below MAO. */
  atOrBelowMao: boolean;

  assumptions: FlipAssumption[];
  /** Human-readable inputs the operator still owes us. Render verbatim. */
  missing: string[];
}

function pct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * The 70%-rule MAO plus a fuller net-profit model, with provenance.
 *
 * Delegates the rule arithmetic to `calculateFlipAnalysis` (the previously
 * dead function) so there is exactly one implementation of the rule.
 */
export function computeMao(input: MaoInput): MaoResult {
  const { defaults } = input;
  const arvCents = Math.round(input.arvCents);
  const rehabEstimateCents = Math.round(input.rehabEstimateCents);
  const feeCents = Math.round(input.feeCents ?? 0);

  const contingencyCents = Math.round(
    rehabEstimateCents * (defaults.rehabContingencyPct / 100),
  );
  const rehabWithContingencyCents = rehabEstimateCents + contingencyCents;

  // Rule MAO does not depend on the tested price, so a first pass with 0 is
  // enough to read `mao` off the shared implementation.
  const rulePass = calculateFlipAnalysis(
    arvCents,
    rehabWithContingencyCents,
    0,
    defaults.maoRulePct,
    defaults.sellingCostPct,
  );
  const maoCents = rulePass.mao - feeCents;

  const hasOperatorPrice =
    typeof input.purchasePriceCents === "number" &&
    Number.isFinite(input.purchasePriceCents);
  const priceUsedCents = hasOperatorPrice
    ? Math.round(input.purchasePriceCents as number)
    : maoCents;
  const profitBasis: MaoResult["profitBasis"] = hasOperatorPrice
    ? "operator_price"
    : "at_mao";

  const priced = calculateFlipAnalysis(
    arvCents,
    rehabWithContingencyCents,
    priceUsedCents,
    defaults.maoRulePct,
    defaults.sellingCostPct,
  );

  const purchaseClosingCents = Math.round(
    priceUsedCents * (defaults.purchaseClosingPct / 100),
  );
  const sellingCostCents = Math.round(arvCents * (defaults.sellingCostPct / 100));

  const holdingKnown = defaults.monthlyHoldingCostCents > 0;
  const holdingCostCents = holdingKnown
    ? Math.round(defaults.monthlyHoldingCostCents * defaults.holdMonths)
    : null;

  const totalCashInCents =
    priceUsedCents + rehabWithContingencyCents + purchaseClosingCents;

  const netProfitCents =
    holdingCostCents === null
      ? null
      : arvCents - sellingCostCents - totalCashInCents - holdingCostCents;

  const netProfitPctOfArv =
    netProfitCents === null || arvCents <= 0
      ? null
      : Math.round(((netProfitCents / arvCents) * 100) * 10) / 10;

  const netRoiPct =
    netProfitCents === null || totalCashInCents <= 0
      ? null
      : Math.round(((netProfitCents / totalCashInCents) * 100) * 10) / 10;

  const missing: string[] = [];
  if (!holdingKnown) {
    missing.push(
      "Monthly holding cost is not set, so carry is EXCLUDED from net profit — set it under Your rules to see a true net.",
    );
  }
  if (!hasOperatorPrice) {
    missing.push(
      "No purchase price entered — profit below is computed at the MAO, not at a price you have negotiated.",
    );
  }
  if (rehabEstimateCents <= 0) {
    missing.push(
      "Rehab estimate is $0 — MAO assumes no repairs, which is almost never true on a flip.",
    );
  }

  const assumptions: FlipAssumption[] = [
    {
      key: "maoRulePct",
      label: "MAO rule",
      display: `${pct(defaults.maoRulePct)} of ARV`,
      source: "org_rule",
    },
    {
      key: "rehabContingencyPct",
      label: "Rehab contingency",
      display: `${pct(defaults.rehabContingencyPct)} (${usd(contingencyCents)})`,
      source: "org_rule",
    },
    {
      key: "sellingCostPct",
      label: "Selling cost",
      display: `${pct(defaults.sellingCostPct)} of ARV (${usd(sellingCostCents)})`,
      source: "org_rule",
    },
    {
      key: "purchaseClosingPct",
      label: "Acquisition closing",
      display: `${pct(defaults.purchaseClosingPct)} of price (${usd(purchaseClosingCents)})`,
      source: "org_rule",
    },
    {
      key: "holdingCost",
      label: "Holding cost",
      display: holdingCostCents === null
        ? "not set — excluded"
        : `${usd(defaults.monthlyHoldingCostCents)}/mo × ${defaults.holdMonths} mo (${usd(holdingCostCents)})`,
      source: holdingCostCents === null ? "not_set" : "org_rule",
    },
    {
      key: "targetProfitPct",
      label: "Target profit",
      display: `${pct(defaults.targetProfitPct)} of ARV`,
      source: "org_rule",
    },
  ];

  return {
    arvCents,
    rehabEstimateCents,
    contingencyCents,
    rehabWithContingencyCents,
    feeCents,
    maoRulePct: defaults.maoRulePct,
    maoCents,
    ruleProfitCents: priced.profitProjection,
    ruleRoiPct: priced.roi,
    profitBasis,
    priceUsedCents,
    purchaseClosingCents,
    sellingCostCents,
    holdingCostCents,
    totalCashInCents,
    netProfitCents,
    netProfitPctOfArv,
    netRoiPct,
    meetsTargetProfit:
      netProfitPctOfArv === null
        ? null
        : netProfitPctOfArv >= defaults.targetProfitPct,
    atOrBelowMao: priceUsedCents <= maoCents,
    assumptions,
    missing,
  };
}

/**
 * Overlay real per-field provenance onto the assumption list. `computeMao`
 * cannot know it — it only receives resolved values — so the route stamps it
 * from `resolveFlipDefaults().sources`. Called by the route, kept here so the
 * key→source mapping lives next to the keys it names.
 */
export function stampAssumptionSources(
  assumptions: FlipAssumption[],
  sources: Record<keyof FlipDefaults, DefaultSource>,
): FlipAssumption[] {
  const keyMap: Record<string, keyof FlipDefaults> = {
    maoRulePct: "maoRulePct",
    rehabContingencyPct: "rehabContingencyPct",
    sellingCostPct: "sellingCostPct",
    purchaseClosingPct: "purchaseClosingPct",
    holdingCost: "monthlyHoldingCostCents",
    targetProfitPct: "targetProfitPct",
  };
  return assumptions.map((a) => {
    if (a.source === "not_set") return a;
    const mapped = keyMap[a.key];
    return mapped ? { ...a, source: sources[mapped] } : a;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Buy-and-hold comparison (wires the second dead function)
// ────────────────────────────────────────────────────────────────────────────

export interface RentalInput {
  purchasePriceCents: number;
  monthlyRentCents: number;
  /** Operator's real monthly operating expenses, cents. 0/omitted = unknown. */
  monthlyExpensesCents?: number | null;
}

export interface RentalResult {
  purchasePriceCents: number;
  monthlyRentCents: number;
  annualNoiCents: number;
  monthlyCashFlowCents: number;
  capRatePct: number;
  grossRentMultiplier: number;
  /**
   * "operator" — expenses came from the operator.
   * "assumed_40pct" — a 40%-of-rent expense ratio was SUBSTITUTED. Must be
   * rendered as an assumption, never as a measured figure.
   */
  expenseBasis: "operator" | "assumed_40pct";
  /** Cash-on-cash equals cap rate only because no financing is modelled. */
  cashOnCashNote: string;
  missing: string[];
}

export function computeRentalReturns(input: RentalInput): RentalResult {
  const purchasePriceCents = Math.round(input.purchasePriceCents);
  const monthlyRentCents = Math.round(input.monthlyRentCents);
  const monthlyExpensesCents =
    typeof input.monthlyExpensesCents === "number" &&
    Number.isFinite(input.monthlyExpensesCents)
      ? Math.round(input.monthlyExpensesCents)
      : 0;

  const raw = calculateRentalAnalysis(
    purchasePriceCents,
    monthlyRentCents,
    monthlyExpensesCents,
  );
  const expenseBasis: RentalResult["expenseBasis"] =
    monthlyExpensesCents > 0 ? "operator" : "assumed_40pct";

  const missing: string[] = [];
  if (expenseBasis === "assumed_40pct") {
    missing.push(
      "Operating expenses were not entered — every figure here assumes expenses run 40% of rent. Enter your real taxes, insurance, maintenance and vacancy to replace the assumption.",
    );
  }
  if (monthlyRentCents <= 0) {
    missing.push("Monthly rent is $0 — enter the rent you can actually achieve.");
  }

  return {
    purchasePriceCents,
    monthlyRentCents,
    annualNoiCents: raw.annualNOI,
    monthlyCashFlowCents: raw.monthlyCashFlow,
    capRatePct: raw.capRate,
    grossRentMultiplier: raw.grossRentMultiplier,
    expenseBasis,
    cashOnCashNote:
      "No financing is modelled, so cash-on-cash equals the cap rate — it is the same number, not a second measurement.",
    missing,
  };
}
