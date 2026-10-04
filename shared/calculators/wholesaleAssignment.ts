/**
 * Wholesale assignment — the arithmetic behind "do I put this house under
 * contract at price X, and what fee will a cash buyer leave me?".
 *
 * A wholesaler does not buy the house. They contract it, then assign the
 * contract to a cash buyer for a fee. So the ceiling on the deal is not what the
 * house is worth to the wholesaler; it is what the house is worth to the BUYER.
 * The model starts there.
 *
 * THE MODEL:
 *   buyer's max price  = ARV × buyer rule% − buyer's repair estimate
 *                        (the cash-buyer MAO: the same convention as
 *                        `calculateFlipAnalysis` / `computeMao` in
 *                        server/services/flipUnderwriting.ts, ARV × rule% −
 *                        repairs, rounded to the cent. The buyer's own
 *                        contingency and closing costs are inside their rule%,
 *                        so none are added here.)
 *   assignment fee     = buyer's max price − your contract price
 *   your total cost    = marketing/acquisition cost of this deal
 *                        + your transaction/closing costs to assign
 *   profit             = assignment fee − your total cost
 *   ROI                = profit ÷ total cost (undefined when total cost is 0)
 *
 * A NEGATIVE FEE IS AN ANSWER. It means the contract price is above what a cash
 * buyer will pay. That is the most useful thing this engine can say, so it is
 * returned, not refused. The same holds for a negative buyer's max price: the
 * repairs exceed the buyer's rule, and no cash buyer pays anything.
 *
 * EARNEST MONEY IS NOT A COST. It is at risk while the contract is open, but
 * when the contract assigns it comes back (reimbursed by the buyer or credited
 * at closing). It is accepted as an input and reported as the amount at risk;
 * it is never added to total cost.
 *
 * UNKNOWNS ARE NOT ZEROS. Marketing cost and closing costs are optional. When
 * omitted they are excluded, and the engine adapter DECLARES each exclusion as
 * an assumption. ARV, the buyer's rule and the buyer's repair estimate are
 * REQUIRED: there is no honest default for any of them, and a silent one is how
 * a wholesale deal looks assignable on paper.
 *
 * PURE: integer cents in and out; the rule in percentage points (70 = 70%).
 */

export const WHOLESALE_ASSIGNMENT_ENGINE_ID = "wholesale_assignment" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const WHOLESALE_ASSIGNMENT_ENGINE_VERSION = "wholesale-assignment-1" as const;

export interface WholesaleAssignmentInputs {
  /** After-repair value: what the house sells for once fixed. */
  arvCents: number;
  /** The cash buyer's rule, percentage points of ARV (70 = 70%). */
  buyerRulePct: number;
  /** What the cash buyer will budget for repairs, not your own estimate. */
  buyerRepairEstimateCents: number;
  /** The price you put the house under contract at with the seller. */
  contractPriceCents: number;
  /** null = not entered (excluded and declared), never zero. */
  marketingCostCents: number | null;
  /** Your title/escrow/attorney costs to assign. null = not entered. */
  closingCostsCents: number | null;
  /** Earnest money deposited with the seller. At risk; never a cost. null = none entered. */
  earnestMoneyCents: number | null;
}

export interface WholesaleAssignmentOutputs {
  /** The most a cash buyer pays under their rule. May be negative. */
  buyerMaxPriceCents: number;
  /** Buyer's max price − contract price. Negative when the contract is too high. */
  assignmentFeeCents: number;
  /** Your out-of-pocket costs (entered ones only). */
  totalCostCents: number;
  /** Assignment fee − total cost. */
  profitCents: number;
  /** Profit ÷ total cost, as a ratio. null when total cost is 0. */
  roi: number | null;
  /** Earnest money at risk until the contract assigns. null when none entered. */
  earnestMoneyAtRiskCents: number | null;
}

export class WholesaleAssignmentInputError extends Error {}

export function computeWholesaleAssignment(i: WholesaleAssignmentInputs): WholesaleAssignmentOutputs {
  if (i.arvCents <= 0) throw new WholesaleAssignmentInputError("After-repair value must be positive");
  if (i.contractPriceCents <= 0) throw new WholesaleAssignmentInputError("Contract price must be positive");
  if (i.buyerRulePct < 0 || i.buyerRulePct > 100) {
    throw new WholesaleAssignmentInputError("buyerRulePct must be between 0 and 100");
  }
  // A negative cost is a typo that flatters the fee or the profit; refuse it.
  for (const [k, v] of [
    ["buyerRepairEstimateCents", i.buyerRepairEstimateCents],
    ["marketingCostCents", i.marketingCostCents],
    ["closingCostsCents", i.closingCostsCents],
    ["earnestMoneyCents", i.earnestMoneyCents],
  ] as const) {
    if (v !== null && v < 0) throw new WholesaleAssignmentInputError(`${k} cannot be negative`);
  }
  if (i.earnestMoneyCents !== null && i.earnestMoneyCents > i.contractPriceCents) {
    throw new WholesaleAssignmentInputError("Earnest money cannot exceed the contract price");
  }

  // ARV × rule% − repairs, rounded to the cent (the computeMao convention).
  const buyerMaxPriceCents = Math.round((i.arvCents * i.buyerRulePct) / 100) - i.buyerRepairEstimateCents;
  const assignmentFeeCents = buyerMaxPriceCents - i.contractPriceCents;
  const totalCostCents = (i.marketingCostCents ?? 0) + (i.closingCostsCents ?? 0);
  const profitCents = assignmentFeeCents - totalCostCents;

  return {
    buyerMaxPriceCents,
    assignmentFeeCents,
    totalCostCents,
    profitCents,
    roi: totalCostCents > 0 ? profitCents / totalCostCents : null,
    earnestMoneyAtRiskCents: i.earnestMoneyCents,
  };
}
