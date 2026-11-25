/**
 * The creative-finance origination-terms engine — the creative finance
 * vertical's registered engine (Step 0 gap sheet creative_finance.md,
 * work item 1, bar (b)).
 *
 * WHAT IT ANSWERS. "On the terms I am structuring, what does this deal
 * pay me, and what is still owed when the balloon falls due?" — the
 * origination question a creative-finance operator actually structures:
 * a property carried subject to an existing loan is sold on a wrap (or
 * an owned property with an existing loan is wrapped), and the operator
 * keeps the spread between the wrap loan they originate and the
 * underlying loan they keep paying.
 *
 * IT DELEGATES; IT DOES NOT REIMPLEMENT. Both loans' arithmetic is the
 * shared finance calculator (`shared/calculators/finance.ts`):
 * `monthlyPaymentCents` for the wrap payment and `remainingBalanceCents`
 * for both balloon figures. Two implementations of the same money
 * formula is precisely the duplication canonical law 1 forbids.
 *
 * WHAT IT PREDICTS.
 *   - `monthly_cash_flow` — the wrap payment less the stated subject-to
 *     payment: the monthly spread the operator keeps (or carries).
 *   - `balloon_amount` — the wrap loan's remaining balance at the
 *     balloon month: what the wrap buyer must retire then.
 *   - `total_interest` — interest the wrap loan earns from origination
 *     through the balloon (payments plus balloon, less its principal).
 *   - `profit` — the wrap spread through the balloon: the cumulative
 *     monthly cash flow plus the balloon spread (wrap balloon less the
 *     underlying payoff at the same month). By construction that equals
 *     the equity-principal spread (wrap principal less subject-to
 *     balance) plus the interest spread (wrap interest less underlying
 *     interest), and the tests pin both derivations to the same cent.
 *   - `total_cost` — what carrying the underlying loan through the
 *     balloon costs in total: the stated subject-to payments through
 *     the balloon month plus the underlying payoff at the balloon.
 * `profit` and `total_cost` are what make a decision under this engine
 * GRADEABLE (evidence rule v2).
 *
 * NO DEFAULTS. Every term is required — wrap price, down payment, wrap
 * rate and term, the balloon month, and the subject-to balance, stated
 * payment, rate and term. A rate, term or balance assumed here would be
 * an invented fact about someone else's loan, so the engine refuses
 * rather than assumes. The balloon must fall at or before both loans'
 * amortizations end: past that point there is no balloon to structure,
 * and modelling a post-payoff carry would need terms this engine was
 * not given.
 *
 * TERMS ARITHMETIC ONLY. This engine structures numbers. It makes no
 * determination about any loan, party or transaction, and nothing in
 * its outputs speaks to any other machinery in the product.
 *
 * Declares `creative_finance`: a decision under that pack counts only
 * when it cites a scenario from this engine (evidence rule v2).
 */

import {
  ScenarioEngineError,
  metric,
  requireCents,
  requireNumber,
  type EngineSpec,
  type ScenarioAssumption,
} from "@shared/economics/scenario";
import { monthlyPaymentCents, remainingBalanceCents } from "@shared/calculators/finance";

const CREATIVE_FINANCE_TERMS_ENGINE_ID = "creative_finance_terms" as const;
/** Bumped when the ADAPTER's mapping changes. The arithmetic's own history lives with the shared calculator. */
const CREATIVE_FINANCE_TERMS_ENGINE_VERSION = "creative-finance-terms-1" as const;

function centsInput(inputs: Record<string, number | string>, key: string): number {
  const v = requireCents(inputs, key);
  if (v < 0) throw new ScenarioEngineError(`"${key}" cannot be negative`);
  return v;
}

function pctInput(inputs: Record<string, number | string>, key: string): number {
  const v = requireNumber(inputs, key);
  if (v < 0 || v > 100) {
    throw new ScenarioEngineError(`"${key}" must be at least 0 and at most 100 (percentage points)`);
  }
  return v;
}

function monthsInput(inputs: Record<string, number | string>, key: string): number {
  const v = requireCents(inputs, key);
  if (v < 1 || v > 1200) {
    throw new ScenarioEngineError(`"${key}" must be a whole number of months from 1 to 1200`);
  }
  return v;
}

export const creativeFinanceTermsEngine: EngineSpec = {
  id: CREATIVE_FINANCE_TERMS_ENGINE_ID,
  version: CREATIVE_FINANCE_TERMS_ENGINE_VERSION,
  label: "Creative finance terms (wrap spread over the subject-to loan, through the balloon)",
  verticals: ["creative_finance"],
  produces: ["profit", "total_cost", "monthly_cash_flow", "total_interest", "balloon_amount"],

  compute(inputs) {
    const wrapPriceCents = centsInput(inputs, "wrapPriceCents");
    if (wrapPriceCents <= 0) throw new ScenarioEngineError("wrapPriceCents must be positive");
    const downPaymentCents = centsInput(inputs, "downPaymentCents");
    if (downPaymentCents >= wrapPriceCents) {
      throw new ScenarioEngineError(
        "downPaymentCents must be less than wrapPriceCents — a down payment at or above the wrap price leaves no wrap loan to structure",
      );
    }
    const wrapRatePct = pctInput(inputs, "wrapRatePct");
    const wrapTermMonths = monthsInput(inputs, "wrapTermMonths");
    const balloonMonths = monthsInput(inputs, "balloonMonths");
    if (balloonMonths > wrapTermMonths) {
      throw new ScenarioEngineError(
        "balloonMonths must not exceed wrapTermMonths — the balloon falls due while the wrap loan is still amortizing",
      );
    }

    const subjectToBalanceCents = centsInput(inputs, "subjectToBalanceCents");
    if (subjectToBalanceCents <= 0) throw new ScenarioEngineError("subjectToBalanceCents must be positive");
    const subjectToPaymentCents = centsInput(inputs, "subjectToPaymentCents");
    if (subjectToPaymentCents <= 0) throw new ScenarioEngineError("subjectToPaymentCents must be positive");
    const subjectToRatePct = pctInput(inputs, "subjectToRatePct");
    const subjectToTermMonths = monthsInput(inputs, "subjectToTermMonths");
    if (balloonMonths > subjectToTermMonths) {
      throw new ScenarioEngineError(
        "balloonMonths must not exceed subjectToTermMonths — at the balloon the underlying loan is retired, so it must still be amortizing then",
      );
    }

    const wrapPrincipalCents = wrapPriceCents - downPaymentCents;
    const wrapPaymentCents = monthlyPaymentCents(wrapPrincipalCents, wrapRatePct, wrapTermMonths / 12);
    const balloonAmountCents = remainingBalanceCents(
      wrapPrincipalCents,
      wrapRatePct,
      wrapTermMonths / 12,
      balloonMonths,
    );
    const underlyingPayoffCents = remainingBalanceCents(
      subjectToBalanceCents,
      subjectToRatePct,
      subjectToTermMonths / 12,
      balloonMonths,
    );

    const monthlyCashFlowCents = wrapPaymentCents - subjectToPaymentCents;
    // Interest is receipts less principal returned: for the wrap loan,
    // the payments through the balloon plus the balloon itself, less
    // the wrap principal. The underlying figure is the same shape, on
    // the stated subject-to payment.
    const totalInterestCents = balloonMonths * wrapPaymentCents + balloonAmountCents - wrapPrincipalCents;
    const underlyingInterestCents =
      balloonMonths * subjectToPaymentCents + underlyingPayoffCents - subjectToBalanceCents;
    const totalCostCents = balloonMonths * subjectToPaymentCents + underlyingPayoffCents;
    const profitCents =
      balloonMonths * monthlyCashFlowCents + (balloonAmountCents - underlyingPayoffCents);

    const assumptions: ScenarioAssumption[] = [
      {
        key: "contract_as_stated",
        value: balloonMonths,
        unit: "months",
        origin: "derived",
        basis:
          "Every figure runs to the balloon month on the terms as stated: both loans' payments in full and on time, " +
          "the wrap balloon paid at that month and the underlying loan retired from it. No missed payments, " +
          "prepayments or servicing costs are modelled.",
      },
      {
        key: "wrap_spread",
        value: profitCents,
        unit: "cents",
        origin: "derived",
        basis:
          "Profit is the wrap spread through the balloon: the cumulative monthly cash flow plus the balloon spread " +
          "(wrap balloon less the underlying payoff). It is the spread over the underlying loan, not the sale's " +
          "whole proceeds — the down payment and the wrap principal are the buyer's money passing through the structure.",
      },
      {
        key: "underlying_payoff",
        value: underlyingPayoffCents,
        unit: "cents",
        origin: "derived",
        basis:
          "The underlying payoff at the balloon is the subject-to balance amortized on its stated rate and term; " +
          "the stated subject-to payment drives the monthly cash flow and total cost.",
      },
    ];

    return {
      normalisedInputs: {
        wrapPriceCents,
        downPaymentCents,
        wrapRatePct,
        wrapTermMonths,
        balloonMonths,
        subjectToBalanceCents,
        subjectToPaymentCents,
        subjectToRatePct,
        subjectToTermMonths,
      },
      assumptions,
      metrics: [
        metric("profit", profitCents),
        metric("total_cost", totalCostCents),
        metric("monthly_cash_flow", monthlyCashFlowCents),
        metric("total_interest", totalInterestCents),
        metric("balloon_amount", balloonAmountCents),
      ],
    };
  },
};
