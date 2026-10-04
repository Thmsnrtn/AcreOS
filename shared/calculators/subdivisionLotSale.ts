/**
 * Subdivision lot sale — the arithmetic behind "I am locking these asking
 * prices; what does the project make if the lots sell at them?".
 *
 * The subdivider's core decision is the LOCK of the lot-pricing grid
 * (server/routes-lot-pricing.ts): it writes every child lot's list price, so it
 * is the moment the grid stops being a preview. This engine turns that locked
 * grid into a prediction an outcome can later be compared with. It is the
 * subdivider desk of the vertical program
 * (decision-memos/2026-10-04-vertical-program.md).
 *
 * THE MODEL (the whole project, from the lock to the last lot sold):
 *   gross sell-out     = Σ locked asking price of every lot
 *   selling costs      = gross sell-out × selling cost%   (commissions, closing)
 *   net proceeds       = gross sell-out − selling costs
 *   subdivision costs  = survey + plat + permits + improvements (each if entered)
 *   carry              = monthly carry × months to sell out (if entered)
 *   total cost         = parent parcel cost basis + subdivision costs + carry
 *   profit             = net proceeds − total cost
 *   ROI                = profit ÷ total cost
 *   hold               = months to sell out
 *
 * It assumes every lot sells at its locked asking price within the months
 * given. A lot that sells for less lowers proceeds one for one; that gap is what
 * the outcome prompt later measures.
 *
 * UNKNOWNS ARE NOT ZEROS. The parent parcel's cost basis is optional because a
 * lock can happen before anyone has recorded what the parent cost. When it is
 * absent, total cost, profit and ROI are NOT computed (null, never 0): a
 * project's profit without the price of its land is not a smaller profit, it is
 * no profit figure at all. The four subdivision cost lines and the monthly carry
 * are optional; when omitted they are excluded, and the engine adapter DECLARES
 * each exclusion. The selling cost % and the sell-out months are REQUIRED: there
 * is no honest default for either.
 *
 * Not a wrapper over shared/subdivision/proForma.ts: that pro-forma has no
 * selling-cost or subdivision-cost lines and projects carry over a county
 * approval timeline, not over a sell-out. Its gross-proceeds line (Σ locked
 * asking prices) is the same quantity as gross sell-out here.
 *
 * PURE: integer cents in and out; rates in percentage points (8 = 8%).
 */

export const SUBDIVISION_LOT_SALE_ENGINE_ID = "subdivision_lot_sale" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const SUBDIVISION_LOT_SALE_ENGINE_VERSION = "subdivision-lot-sale-1" as const;

/** The longest sell-out the engine accepts, in months (20 years). */
const MAX_SELL_OUT_MONTHS = 240;

/**
 * Scenario inputs are a flat record, so each lot's locked price travels as its
 * own integer-cents key, named by the child parcel it prices:
 * `lotPriceCents_<childParcelId>`. A price list packed into one string would
 * slip money past the integer-cents check every other input gets.
 */
const LOT_PRICE_INPUT_PREFIX = "lotPriceCents_";
const LOT_PRICE_KEY = /^lotPriceCents_(\d+)$/;

export function lotPriceInputKey(childParcelId: number): string {
  return `${LOT_PRICE_INPUT_PREFIX}${childParcelId}`;
}

/** The child parcel id a lot-price key names, or null when the key is not one. */
export function lotIdOfInputKey(key: string): number | null {
  const m = LOT_PRICE_KEY.exec(key);
  return m ? Number(m[1]) : null;
}

export interface SubdivisionLotSaleInputs {
  /** The locked asking price of each lot, in cents. At least one lot. */
  lotPricesCents: number[];
  /** Commissions and closing costs on each sale, % of the sale price. */
  sellingCostPct: number;
  /** Whole months from the lock until the last lot sells, 1 to 240. */
  monthsToSellOut: number;
  /** What the parent parcel cost. null = not entered: no total cost, profit or ROI. */
  parentBasisCents: number | null;
  /** null = not entered (excluded and declared), never zero. */
  surveyCents: number | null;
  platCents: number | null;
  permitsCents: number | null;
  improvementsCents: number | null;
  /** Taxes, insurance, interest and upkeep per month while lots are unsold. */
  monthlyCarryCents: number | null;
}

export interface SubdivisionLotSaleOutputs {
  lotCount: number;
  grossSelloutCents: number;
  sellingCostsCents: number;
  netProceedsCents: number;
  subdivisionCostsCents: number;
  carryCents: number;
  /** null when the parent's cost basis is unknown. */
  totalCostCents: number | null;
  /** null when the parent's cost basis is unknown. */
  profitCents: number | null;
  /** Profit ÷ total cost, as a ratio. null when the basis is unknown or total cost is 0. */
  roi: number | null;
  holdMonths: number;
}

export class SubdivisionLotSaleInputError extends Error {}

export function computeSubdivisionLotSale(i: SubdivisionLotSaleInputs): SubdivisionLotSaleOutputs {
  if (i.lotPricesCents.length === 0) {
    throw new SubdivisionLotSaleInputError("There are no lots to sell. Lock a grid with at least one lot");
  }
  for (const p of i.lotPricesCents) {
    if (!Number.isInteger(p)) throw new SubdivisionLotSaleInputError("Lot prices must be whole cents");
    // A negative price is a typo that would lower proceeds below anything real.
    if (p < 0) throw new SubdivisionLotSaleInputError("A lot price cannot be negative");
  }
  if (i.sellingCostPct < 0 || i.sellingCostPct > 100) {
    throw new SubdivisionLotSaleInputError("Selling cost must be between 0% and 100%");
  }
  if (!Number.isInteger(i.monthsToSellOut) || i.monthsToSellOut < 1 || i.monthsToSellOut > MAX_SELL_OUT_MONTHS) {
    throw new SubdivisionLotSaleInputError(
      `Months to sell out must be a whole number, 1 to ${MAX_SELL_OUT_MONTHS}`,
    );
  }
  // A negative cost is a typo that flatters every return; refuse it.
  for (const [label, v] of [
    ["Parent parcel cost basis", i.parentBasisCents],
    ["Survey cost", i.surveyCents],
    ["Plat cost", i.platCents],
    ["Permit cost", i.permitsCents],
    ["Improvement cost", i.improvementsCents],
    ["Monthly carry", i.monthlyCarryCents],
  ] as const) {
    if (v !== null && v < 0) throw new SubdivisionLotSaleInputError(`${label} cannot be negative`);
  }

  const grossSelloutCents = i.lotPricesCents.reduce((n, p) => n + p, 0);
  const sellingCostsCents = Math.round((grossSelloutCents * i.sellingCostPct) / 100);
  const netProceedsCents = grossSelloutCents - sellingCostsCents;
  const subdivisionCostsCents =
    (i.surveyCents ?? 0) + (i.platCents ?? 0) + (i.permitsCents ?? 0) + (i.improvementsCents ?? 0);
  const carryCents = (i.monthlyCarryCents ?? 0) * i.monthsToSellOut;

  const totalCostCents =
    i.parentBasisCents === null ? null : i.parentBasisCents + subdivisionCostsCents + carryCents;
  const profitCents = totalCostCents === null ? null : netProceedsCents - totalCostCents;
  const roi =
    totalCostCents !== null && profitCents !== null && totalCostCents > 0 ? profitCents / totalCostCents : null;

  return {
    lotCount: i.lotPricesCents.length,
    grossSelloutCents,
    sellingCostsCents,
    netProceedsCents,
    subdivisionCostsCents,
    carryCents,
    totalCostCents,
    profitCents,
    roi,
    holdMonths: i.monthsToSellOut,
  };
}
