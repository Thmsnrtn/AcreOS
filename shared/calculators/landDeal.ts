/**
 * Land-deal economics — pure math for the public /tools/calculator surface.
 *
 * All money values are integer cents to avoid float drift on the core
 * arithmetic. The UI accepts dollar input and converts at the boundary.
 *
 * The IRR solver below is the same Newton-Raphson algorithm used in
 * server/routes-notes.ts calcIRR() and client/src/components/IRRCalculator.tsx
 * (1e-7 tolerance, 1000-iter ceiling) with an explicit bisection
 * fallback when Newton diverges or the derivative collapses. Returning
 * `null` honestly is required behaviour — the calculator UI then renders
 * "n/a" with a one-sentence explanation rather than fabricating a
 * convergent rate where none exists. A flip with no positive cash flow
 * (sale price ≤ total cost) is the canonical example: no rate brings
 * NPV to zero, so IRR is undefined.
 */

export interface CalculatorInputs {
  /** Purchase price in cents. */
  purchaseCents: number;
  /** Closing costs at acquisition in cents (already computed; UI may default to 1% of purchase). */
  closingAtBuyCents: number;
  /** Monthly holding cost in cents (taxes + insurance). */
  holdingPerMonthCents: number;
  /** Hold time in months. Integer ≥ 1 for the IRR cash-flow series. */
  holdMonths: number;
  /** Marketing cost in cents. */
  marketingCents: number;
  /** Expected sale price in cents. */
  salePriceCents: number;
  /** Closing costs at sale in cents (already computed; UI may default to 3% of sale). */
  closingAtSaleCents: number;
}

export interface CalculatorOutputs {
  totalCostInCents: number;
  netProceedsCents: number;
  profitCents: number;
  /** ROI as a decimal (0.10 = 10%). null when totalCostIn is 0. */
  roi: number | null;
  /** Annualized return as a decimal — simple (not compounded): roi × 12 / months. */
  annualizedReturn: number | null;
  /** IRR as an annual decimal (compounded from monthly). null when the cash-flow shape doesn't support an IRR. */
  irr: number | null;
  /** Sale price (in cents) at which profit equals zero, given all other inputs fixed. */
  breakevenSaleCents: number;
}

/**
 * Compute every output for the land-deal calculator. Pure function;
 * deterministic; safe to call on every keystroke.
 */
export function computeLandDeal(inputs: CalculatorInputs): CalculatorOutputs {
  const {
    purchaseCents,
    closingAtBuyCents,
    holdingPerMonthCents,
    holdMonths,
    marketingCents,
    salePriceCents,
    closingAtSaleCents,
  } = inputs;

  const months = Math.max(0, Math.floor(holdMonths));
  const totalHoldingCents = holdingPerMonthCents * months;
  const totalCostInCents =
    purchaseCents + closingAtBuyCents + totalHoldingCents + marketingCents;
  const netProceedsCents = salePriceCents - closingAtSaleCents;
  const profitCents = netProceedsCents - totalCostInCents;

  const roi = totalCostInCents > 0 ? profitCents / totalCostInCents : null;
  const annualizedReturn =
    roi !== null && months > 0 ? (roi * 12) / months : null;

  // Breakeven: solve salePrice - closingAtSale = totalCostIn for salePrice,
  // where closingAtSale scales with sale price ONLY if the caller passed a
  // proportional value. Without knowing the caller's rate, we solve for the
  // sale-price-net-of-already-quoted-sale-closing-cost. The UI keeps closing
  // costs as an absolute number that the user controls, so this is correct:
  // user sees "what sale gross do I need given the closing-cost line I set?"
  const breakevenSaleCents = totalCostInCents + closingAtSaleCents;

  const irr = computeIrr(buildCashFlows(inputs));

  return {
    totalCostInCents,
    netProceedsCents,
    profitCents,
    roi,
    annualizedReturn,
    irr,
    breakevenSaleCents,
  };
}

/**
 * Build the monthly cash-flow series for IRR.
 *
 * Convention:
 *   t=0: outflow of (purchase + closingAtBuy + marketing) — money out the door at acquisition.
 *   t=1..holdMonths-1: outflow of holdingPerMonth — taxes/insurance paid during the hold.
 *   t=holdMonths: holding cost + (salePrice - closingAtSale) — final month nets the sale.
 *
 * The holding cost at the final month is included on the same period as
 * the sale so a 6-month hold series has exactly 7 entries (t=0..6). A
 * zero-month hold collapses to two entries.
 */
export function buildCashFlows(inputs: CalculatorInputs): number[] {
  const {
    purchaseCents,
    closingAtBuyCents,
    holdingPerMonthCents,
    holdMonths,
    marketingCents,
    salePriceCents,
    closingAtSaleCents,
  } = inputs;
  const months = Math.max(0, Math.floor(holdMonths));
  const flows: number[] = [];
  flows.push(-(purchaseCents + closingAtBuyCents + marketingCents));
  for (let m = 1; m < months; m++) {
    flows.push(-holdingPerMonthCents);
  }
  if (months >= 1) {
    flows.push(salePriceCents - closingAtSaleCents - holdingPerMonthCents);
  } else {
    // Zero-month hold edge: net the sale immediately into t=0 flow.
    flows[0] = flows[0] + (salePriceCents - closingAtSaleCents);
  }
  return flows;
}

/**
 * Annual IRR for a monthly cash-flow series, in decimal form
 * (0.42 = 42%/yr). Returns null when:
 *   - cash flows are all-negative or all-positive (no sign change → no IRR),
 *   - Newton diverges and bisection can't bracket a root in [-0.99, 10],
 *   - the result is non-finite.
 *
 * The monthly rate is converted to annual via (1+r_m)^12 - 1.
 */
export function computeIrr(cashFlows: number[]): number | null {
  if (cashFlows.length < 2) return null;
  // Sign-change check: NPV(r) must cross zero somewhere for an IRR to exist.
  const hasPositive = cashFlows.some((f) => f > 0);
  const hasNegative = cashFlows.some((f) => f < 0);
  if (!hasPositive || !hasNegative) return null;

  const monthly = newtonRaphsonIrr(cashFlows) ?? bisectionIrr(cashFlows);
  if (monthly === null || !Number.isFinite(monthly)) return null;
  // A monthly rate ≤ -1 makes (1+r)^12 nonsense. Refuse rather than NaN.
  if (monthly <= -1) return null;
  const annual = Math.pow(1 + monthly, 12) - 1;
  if (!Number.isFinite(annual)) return null;
  return annual;
}

function npv(rate: number, flows: number[]): number {
  let sum = 0;
  for (let t = 0; t < flows.length; t++) {
    sum += flows[t] / Math.pow(1 + rate, t);
  }
  return sum;
}

function newtonRaphsonIrr(flows: number[], guess = 0.01): number | null {
  const MAX_ITER = 1000;
  const TOL = 1e-7;
  let rate = guess;
  for (let i = 0; i < MAX_ITER; i++) {
    let f = 0;
    let df = 0;
    for (let t = 0; t < flows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      f += flows[t] / denom;
      if (t > 0) df -= (t * flows[t]) / Math.pow(1 + rate, t + 1);
    }
    if (!Number.isFinite(f) || !Number.isFinite(df)) return null;
    if (Math.abs(df) < 1e-12) return null; // collapsed slope — let bisection take over
    const next = rate - f / df;
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - rate) < TOL) return next;
    rate = next;
    // Newton may wander into rate ≤ -1 where NPV explodes. Bail; bisection has a bounded search.
    if (rate <= -0.999) return null;
  }
  return null;
}

function bisectionIrr(flows: number[]): number | null {
  // Search [lo, hi] for a sign change in NPV. lo is just above -1 to avoid
  // division-by-zero; hi is generous (1000%/month would catch the most
  // pathological positive shapes) but capped to keep Math.pow stable.
  let lo = -0.9999;
  let hi = 10.0;
  let fLo = npv(lo, flows);
  let fHi = npv(hi, flows);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo * fHi > 0) return null; // no sign change → can't bracket

  const MAX_ITER = 200;
  const TOL = 1e-7;
  for (let i = 0; i < MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < TOL || (hi - lo) / 2 < TOL) return mid;
    if (fMid * fLo < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

// ─── URL state encoding ─────────────────────────────────────────────────────
// Stable abbreviated keys so the shareable URL stays short. We keep cents
// as the wire unit (no decimals) — the form converts dollars↔cents at the
// edge.

export interface CalculatorInputsDollars {
  purchase: number;
  closingAtBuy: number;
  holdingPerMonth: number;
  holdMonths: number;
  marketing: number;
  salePrice: number;
  closingAtSale: number;
}

const URL_KEYS: Record<keyof CalculatorInputsDollars, string> = {
  purchase: "p",
  closingAtBuy: "cb",
  holdingPerMonth: "h",
  holdMonths: "m",
  marketing: "mk",
  salePrice: "sp",
  closingAtSale: "cs",
};

export function encodeInputsToQuery(inputs: CalculatorInputsDollars): string {
  const params = new URLSearchParams();
  (Object.keys(URL_KEYS) as Array<keyof CalculatorInputsDollars>).forEach((k) => {
    const v = inputs[k];
    if (Number.isFinite(v)) params.set(URL_KEYS[k], String(v));
  });
  return params.toString();
}

export function decodeInputsFromQuery(
  search: string,
  fallback: CalculatorInputsDollars,
): CalculatorInputsDollars {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: CalculatorInputsDollars = { ...fallback };
  (Object.keys(URL_KEYS) as Array<keyof CalculatorInputsDollars>).forEach((k) => {
    const raw = params.get(URL_KEYS[k]);
    if (raw === null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    out[k] = n;
  });
  return out;
}

export const DEFAULT_INPUTS_DOLLARS: CalculatorInputsDollars = {
  purchase: 4500,
  closingAtBuy: 45, // 1% of purchase
  holdingPerMonth: 25,
  holdMonths: 6,
  marketing: 200,
  salePrice: 15000,
  closingAtSale: 450, // 3% of sale
};

/** Convert the dollar-denominated input object to the cents-denominated math input. */
export function dollarsToCentsInput(
  d: CalculatorInputsDollars,
): CalculatorInputs {
  return {
    purchaseCents: Math.round(d.purchase * 100),
    closingAtBuyCents: Math.round(d.closingAtBuy * 100),
    holdingPerMonthCents: Math.round(d.holdingPerMonth * 100),
    holdMonths: Math.max(0, Math.floor(d.holdMonths)),
    marketingCents: Math.round(d.marketing * 100),
    salePriceCents: Math.round(d.salePrice * 100),
    closingAtSaleCents: Math.round(d.closingAtSale * 100),
  };
}
