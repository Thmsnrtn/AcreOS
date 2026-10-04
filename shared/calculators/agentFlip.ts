/**
 * Agent-investor flip — the arithmetic behind "do I buy this deal for my own
 * account, given I earn a commission on the buy and save one on the sale?".
 *
 * A licensed agent buying for their own book is not a flipper with a licence
 * attached. Both commission lines move. On the BUY side the agent represents
 * themselves and earns the buyer-side commission, less whatever their brokerage
 * keeps. On the SALE side they list the property themselves, so the listing
 * commission is money they would pay to themselves, and only the brokerage's
 * cut of it is a real cost. The co-op commission paid to the buyer's agent is a
 * real cost in full. The flip engine (server/services/flipUnderwriting.ts,
 * computeMao) treats every commission as a selling cost at a flat % of ARV,
 * which overstates an agent's cost on both lines. This engine keeps that
 * engine's conventions (integer cents, whole-number percentage points, total
 * cash in = price + rehab + purchase closing, profit net of carry, ROI on the
 * money put in) and changes only the two commission treatments.
 *
 * THE MODEL (one purchase, one resale, simple — not compounded):
 *   buy-side credit   = price × buy-side commission% × (1 − brokerage split%)
 *                       the commission the agent keeps on their own purchase,
 *                       treated as reducing what the purchase costs them
 *   holding           = monthly holding cost × holding months
 *   total cost        = price + purchase closing + rehab + holding
 *                       − buy-side credit
 *   sale costs        = sale × co-op%                       (paid in full)
 *                       + sale × listing% × brokerage split% (only the
 *                         brokerage's cut of the agent's own listing commission)
 *                       + sale × sale closing%
 *   net proceeds      = sale − sale costs
 *   profit            = net proceeds − total cost
 *   ROI               = profit ÷ total cost
 *   annualised return = ROI × 12 ÷ holding months (simple, as land_deal does)
 *
 * THE TWO COMMISSION TREATMENTS, plainly:
 *   1. The buy-side commission the agent earns, net of the brokerage's split,
 *      is a credit against the purchase. It is never more than 10% of price.
 *   2. The agent's own listing commission net of split is money they pay
 *      themselves, so it is not a cost. Only the brokerage's split portion is.
 * The split is the brokerage's share in percentage points (30 on a 70/30
 * split). shared/commission/split.ts stores the same arrangement as the
 * AGENT's share in basis points (agentSplitBps 7000 = 30 here). Its annual
 * cap, franchise fee and per-transaction fee are not modelled here. An agent
 * past their cap enters a 0% split; a transaction fee belongs in closing
 * costs.
 *
 * NOT MODELLED: income tax on the commission earned, financing (this is the
 * all-in cost of the deal, not the cash the agent puts in), and the agent's
 * disclosure duties when buying for their own account — those are the
 * agent's to meet and nothing here checks them.
 *
 * UNKNOWNS ARE NOT ZEROS. Purchase closing costs, rehab and monthly holding
 * cost are optional. Omitted, each is excluded, and the engine adapter
 * DECLARES the exclusion so it cannot read as a measured $0. Every commission
 * and split rate is REQUIRED: 0 is a real answer (no co-op offered, a capped
 * agent's 0% split), and there is no honest default for any of them.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */

export const AGENT_FLIP_ENGINE_ID = "agent_flip" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const AGENT_FLIP_ENGINE_VERSION = "agent-flip-1" as const;

export interface AgentFlipInputs {
  purchasePriceCents: number;
  /** Buyer-side commission the agent earns on their own purchase, % of price (0–10). */
  buySideCommissionPct: number;
  /** The brokerage's share of that commission, % (0–100). 30 on a 70/30 split. */
  buySideBrokerageSplitPct: number;
  /** null = not entered (excluded and declared), never zero. */
  purchaseClosingCostsCents: number | null;
  rehabCents: number | null;
  /** Whole months from purchase to sale, 1–60. */
  holdMonths: number;
  /** Taxes, insurance, utilities, loan interest — per month. null = not entered. */
  monthlyHoldingCostCents: number | null;
  salePriceCents: number;
  /** The listing commission the agent charges on their own listing, % of sale (0–10). */
  listingCommissionPct: number;
  /** The brokerage's share of the listing commission, % (0–100). */
  listingBrokerageSplitPct: number;
  /** Co-op commission paid to the buyer's agent, % of sale (0–10). */
  coopCommissionPct: number;
  /** Seller-side closing costs, % of sale (0–20). */
  saleClosingCostsPct: number;
}

export interface AgentFlipOutputs {
  buySideCreditCents: number;
  holdingCostCents: number;
  totalCostCents: number;
  coopCommissionCents: number;
  listingSplitCostCents: number;
  saleClosingCostsCents: number;
  saleCostsCents: number;
  netProceedsCents: number;
  profitCents: number;
  /** Profit ÷ total cost, as a ratio. null when total cost is not positive. */
  roi: number | null;
  /** ROI × 12 ÷ holding months — simple, not compounded. null with ROI. */
  annualizedReturn: number | null;
  holdMonths: number;
}

export class AgentFlipInputError extends Error {}

/**
 * The buy-side commission the agent keeps: price × commission% × (1 − split%).
 * Exported so the page's decision sentence uses the same arithmetic as the
 * engine instead of re-deriving it.
 */
export function buySideCreditCents(purchasePriceCents: number, commissionPct: number, brokerageSplitPct: number): number {
  return Math.round((purchasePriceCents * commissionPct * (100 - brokerageSplitPct)) / 10_000);
}

export function computeAgentFlip(i: AgentFlipInputs): AgentFlipOutputs {
  if (i.purchasePriceCents <= 0) throw new AgentFlipInputError("Purchase price must be positive");
  if (i.salePriceCents <= 0) throw new AgentFlipInputError("Expected sale price must be positive");
  // A negative cost is a typo that flatters every return; refuse it.
  for (const [k, v] of [
    ["purchaseClosingCostsCents", i.purchaseClosingCostsCents],
    ["rehabCents", i.rehabCents],
    ["monthlyHoldingCostCents", i.monthlyHoldingCostCents],
  ] as const) {
    if (v !== null && v < 0) throw new AgentFlipInputError(`${k} cannot be negative`);
  }
  for (const [k, v, max] of [
    ["buySideCommissionPct", i.buySideCommissionPct, 10],
    ["listingCommissionPct", i.listingCommissionPct, 10],
    ["coopCommissionPct", i.coopCommissionPct, 10],
    ["buySideBrokerageSplitPct", i.buySideBrokerageSplitPct, 100],
    ["listingBrokerageSplitPct", i.listingBrokerageSplitPct, 100],
    ["saleClosingCostsPct", i.saleClosingCostsPct, 20],
  ] as const) {
    if (!Number.isFinite(v) || v < 0 || v > max) throw new AgentFlipInputError(`${k} must be between 0 and ${max}`);
  }
  if (!Number.isInteger(i.holdMonths) || i.holdMonths < 1 || i.holdMonths > 60) {
    throw new AgentFlipInputError("Holding period must be a whole number of months, 1 to 60");
  }

  const buySideCredit = buySideCreditCents(i.purchasePriceCents, i.buySideCommissionPct, i.buySideBrokerageSplitPct);
  const holdingCostCents = (i.monthlyHoldingCostCents ?? 0) * i.holdMonths;
  const totalCostCents =
    i.purchasePriceCents + (i.purchaseClosingCostsCents ?? 0) + (i.rehabCents ?? 0) + holdingCostCents - buySideCredit;

  const coopCommissionCents = Math.round((i.salePriceCents * i.coopCommissionPct) / 100);
  const listingSplitCostCents = Math.round(
    (i.salePriceCents * i.listingCommissionPct * i.listingBrokerageSplitPct) / 10_000,
  );
  const saleClosingCostsCents = Math.round((i.salePriceCents * i.saleClosingCostsPct) / 100);
  const saleCostsCents = coopCommissionCents + listingSplitCostCents + saleClosingCostsCents;
  const netProceedsCents = i.salePriceCents - saleCostsCents;
  const profitCents = netProceedsCents - totalCostCents;

  // The credit is at most 10% of price, so total cost stays positive; the
  // guard keeps ROI honest if that bound ever moves.
  const roi = totalCostCents > 0 ? profitCents / totalCostCents : null;

  return {
    buySideCreditCents: buySideCredit,
    holdingCostCents,
    totalCostCents,
    coopCommissionCents,
    listingSplitCostCents,
    saleClosingCostsCents,
    saleCostsCents,
    netProceedsCents,
    profitCents,
    roi,
    annualizedReturn: roi === null ? null : (roi * 12) / i.holdMonths,
    holdMonths: i.holdMonths,
  };
}
