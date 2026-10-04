/**
 * Land development pro-forma — the arithmetic behind "do I buy this land and
 * develop it, given entitlement, improvement and sell-out economics?".
 *
 * WHY NOT computeProForma. shared/subdivision/proForma.ts (served by GET
 * /api/parcels/:id/pro-forma in server/routes-lot-basis.ts) is pure, but it
 * answers a different question. It reads a project that already exists: a
 * stored parent basis, a LOCKED per-lot pricing grid and a county-timeline
 * carry. Its net margin is gross proceeds − COGS − carry, and it has no line
 * for entitlement, improvements or selling costs. This engine answers the
 * question that comes BEFORE the land is bought, so it takes those as inputs.
 * It keeps that file's formula (margin = proceeds − cost basis − carry) and
 * extends the cost basis with the lines a go/no-go has to carry. The carry line
 * reuses projectCarryForMonths from shared/subdivision/carryCost.ts, the one
 * place carry is projected (holding cost × months).
 *
 * THE MODEL (whole project, monthly timeline):
 *   hold months      = months to entitle + months to build + months to sell out
 *   carry            = monthly carry × hold months (flat until the last lot
 *                      closes; a conservative simplification)
 *   total cost       = land + entitlement/soft costs + improvements + carry
 *   gross sell-out   = lot count × average lot price
 *   selling costs    = gross sell-out × selling cost%
 *   net proceeds     = gross sell-out − selling costs
 *   profit           = net proceeds − total cost
 *   ROI              = profit ÷ total cost
 *   annualised       = ROI × 12 ÷ hold months (simple, not compounded — the
 *                      land_deal engine's convention)
 *
 * THE IRR TIMELINE (monthly cash flows, t = 0 … hold months), via computeIrr
 * from shared/calculators/landDeal.ts, which annualises the monthly rate as
 * (1 + m)^12 − 1:
 *   t = 0                    −(land + entitlement/soft costs)
 *   t = 1 … E                −carry                       (entitling)
 *   t = E+1 … E+D            −improvements ÷ D − carry     (building)
 *   t = E+D+1 … E+D+S        +net proceeds ÷ S − carry     (selling evenly)
 * Even spreads are in whole cents; any remainder lands in the last month of
 * the spread, so each series sums exactly to its total.
 *
 * UNKNOWNS ARE NOT ZEROS. Monthly carry is optional. When it is omitted it is
 * excluded, and the engine adapter DECLARES the exclusion as an assumption.
 * Land, entitlement, improvements, lot count, lot price, selling costs and the
 * three periods are REQUIRED: there is no honest default for any of them. An
 * already-entitled parcel is an explicit 0 entitlement cost and 0 months, which
 * is the operator's answer, not a substitution.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */
import { computeIrr } from "./landDeal";
import { projectCarryForMonths } from "../subdivision/carryCost";

export const DEVELOPMENT_PROFORMA_ENGINE_ID = "development_proforma" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const DEVELOPMENT_PROFORMA_ENGINE_VERSION = "development-proforma-1" as const;

/** Longest single period the model accepts (10 years). */
const MAX_PERIOD_MONTHS = 120;
/** Largest project the model accepts. */
const MAX_LOT_COUNT = 10_000;

export interface DevelopmentProformaInputs {
  landCostCents: number;
  /** Engineering, surveys, plat and permit fees, legal — getting to approval. */
  entitlementCostsCents: number;
  /** Total horizontal improvements: roads, utilities, grading, drainage. */
  improvementCostsCents: number;
  lotCount: number;
  averageLotPriceCents: number;
  /** Commissions, closing and marketing on lot sales, % of gross sales. */
  sellingCostPct: number;
  entitlementMonths: number;
  developmentMonths: number;
  selloutMonths: number;
  /** Taxes, insurance and interest per month. null = not entered (excluded and declared), never zero. */
  monthlyCarryCents: number | null;
}

export interface DevelopmentProformaOutputs {
  totalCostCents: number;
  carryCents: number;
  grossSelloutCents: number;
  sellingCostsCents: number;
  netProceedsCents: number;
  profitCents: number;
  /** Profit ÷ total cost, as a ratio. */
  roi: number | null;
  /** ROI × 12 ÷ hold months, simple. */
  annualizedReturn: number | null;
  /** Annual IRR, compounded from monthly. null when the cash flows have no IRR. */
  irr: number | null;
  holdMonths: number;
  /** The monthly series the IRR was solved over, t = 0 … holdMonths. */
  cashFlowsCents: number[];
}

export class DevelopmentProformaInputError extends Error {}

/** `total` cents over `n` months in whole cents; the remainder lands in the last month. */
function spread(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const out = new Array<number>(n).fill(base);
  out[n - 1] = total - base * (n - 1);
  return out;
}

export function computeDevelopmentProforma(i: DevelopmentProformaInputs): DevelopmentProformaOutputs {
  if (i.landCostCents <= 0) throw new DevelopmentProformaInputError("Land price must be positive");
  // A negative cost is a typo that flatters every return; refuse it.
  for (const [k, v] of [
    ["entitlementCostsCents", i.entitlementCostsCents],
    ["improvementCostsCents", i.improvementCostsCents],
    ["averageLotPriceCents", i.averageLotPriceCents],
    ["monthlyCarryCents", i.monthlyCarryCents],
  ] as const) {
    if (v !== null && v < 0) throw new DevelopmentProformaInputError(`${k} cannot be negative`);
  }
  if (!Number.isInteger(i.lotCount) || i.lotCount < 1 || i.lotCount > MAX_LOT_COUNT) {
    throw new DevelopmentProformaInputError(`Lot count must be a whole number from 1 to ${MAX_LOT_COUNT}`);
  }
  if (i.sellingCostPct < 0 || i.sellingCostPct > 100) {
    throw new DevelopmentProformaInputError("sellingCostPct must be between 0 and 100");
  }
  for (const [k, v, min] of [
    ["entitlementMonths", i.entitlementMonths, 0],
    ["developmentMonths", i.developmentMonths, 0],
    ["selloutMonths", i.selloutMonths, 1],
  ] as const) {
    if (!Number.isInteger(v) || v < min || v > MAX_PERIOD_MONTHS) {
      throw new DevelopmentProformaInputError(`${k} must be a whole number of months, ${min} to ${MAX_PERIOD_MONTHS}`);
    }
  }
  if (i.improvementCostsCents > 0 && i.developmentMonths === 0) {
    throw new DevelopmentProformaInputError(
      "Improvement costs need at least one month of development to be spent in",
    );
  }

  const E = i.entitlementMonths;
  const D = i.developmentMonths;
  const S = i.selloutMonths;
  const holdMonths = E + D + S;

  const monthlyCarry = i.monthlyCarryCents ?? 0;
  // The one carry projector (holding cost × months). This engine takes a single
  // all-in monthly carry, so debt and opportunity components are zero here.
  const carryCents =
    projectCarryForMonths(holdMonths, {
      holdingCostMonthlyCents: monthlyCarry,
      debtPrincipalCents: 0,
      debtRateBps: 0,
      purchaseBasisCents: i.landCostCents,
      opportunityCostBps: 0,
    })?.totalCarryCents ?? 0;

  const upfrontCents = i.landCostCents + i.entitlementCostsCents;
  const totalCostCents = upfrontCents + i.improvementCostsCents + carryCents;
  const grossSelloutCents = i.lotCount * i.averageLotPriceCents;
  const sellingCostsCents = Math.round((grossSelloutCents * i.sellingCostPct) / 100);
  const netProceedsCents = grossSelloutCents - sellingCostsCents;
  const profitCents = netProceedsCents - totalCostCents;

  const roi = totalCostCents > 0 ? profitCents / totalCostCents : null;
  const annualizedReturn = roi !== null ? (roi * 12) / holdMonths : null;

  const cashFlowsCents: number[] = [-upfrontCents];
  for (let t = 1; t <= E; t++) cashFlowsCents.push(-monthlyCarry);
  if (D > 0) for (const x of spread(i.improvementCostsCents, D)) cashFlowsCents.push(-x - monthlyCarry);
  for (const x of spread(netProceedsCents, S)) cashFlowsCents.push(x - monthlyCarry);

  return {
    totalCostCents,
    carryCents,
    grossSelloutCents,
    sellingCostsCents,
    netProceedsCents,
    profitCents,
    roi,
    annualizedReturn,
    irr: computeIrr(cashFlowsCents),
    holdMonths,
    cashFlowsCents,
  };
}
