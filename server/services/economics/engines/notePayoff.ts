/**
 * The note-payoff scenario engine — the second, structurally different engine.
 *
 * WHY IT EXISTS (BI191): "Every core primitive must pass contrasting Strategy
 * Pack fixtures. A land-only implementation that happens to expose generic
 * labels does not satisfy the architecture." A registry containing one land
 * engine is a land-shaped abstraction pretending to be general. This engine is
 * genuinely different in shape — date-driven day-count accrual rather than a
 * cash-flow series, with dates as inputs rather than only money — so it tests
 * the contract instead of repeating it.
 *
 * WHY IT LIVES SERVER-SIDE
 * ------------------------
 * It delegates to `server/services/notePaymentMath.ts`, which implements
 * statute-adjacent arithmetic (it is registered in
 * shared/governance/statuteRegister.ts) and already carries its own
 * PAYOFF_ENGINE_VERSION and day-count convention.
 * `scripts/check-boundaries.mjs` rule S1 forbids shared/ importing server/, and
 * relocating regulated money code to satisfy a module boundary would be the
 * wrong trade. The registry is composed in ./index.ts instead and passed in.
 *
 * IT DOES NOT REIMPLEMENT THE MATHS. `computePayoffQuote` remains the single
 * payoff engine — this is an adapter that presents its result in the shared
 * metric vocabulary so a payoff can be compared with a forecast and graded by
 * an Outcome. Two implementations of the same money formula is precisely the
 * duplication canonical law 1 forbids.
 */

import {
  ScenarioEngineError,
  metric,
  requireCents,
  requireIsoDate,
  type EngineSpec,
} from "@shared/economics/scenario";
import {
  PAYOFF_ENGINE_VERSION,
  computePayoffQuote,
} from "../../notePaymentMath";

/**
 * Module-private on purpose: the id is reachable as `notePayoffEngine.id`, and
 * an exported constant whose only external reader is a test is precisely what
 * lint:reachability flags as built-but-unwired.
 */
const NOTE_PAYOFF_ENGINE_ID = "note_payoff" as const;

export const notePayoffEngine: EngineSpec = {
  id: NOTE_PAYOFF_ENGINE_ID,
  // The version is READ FROM the engine that owns the arithmetic, never
  // duplicated — a version that can drift from its formula is a stamp that
  // lies.
  version: PAYOFF_ENGINE_VERSION,
  label: "Note payoff (day-count accrual)",
  produces: ["payoff_total", "accrued_interest", "principal_balance", "days_accrued"],

  compute(inputs) {
    const principalBalanceCents = requireCents(inputs, "principalBalanceCents");
    const accrualStartDate = requireIsoDate(inputs, "accrualStartDate");
    const payoffDate = requireIsoDate(inputs, "payoffDate");

    // The rate MAY legitimately be fractional — the servicing table stores a
    // decimal percent, so 9.875% arrives as 987.5 basis points. requireCents
    // would refuse it, correctly, because it is not money.
    const annualRateBps = inputs["annualRateBps"];
    if (typeof annualRateBps !== "number" || !Number.isFinite(annualRateBps)) {
      throw new ScenarioEngineError(
        `Scenario input "annualRateBps" is required and must be a finite number`,
      );
    }
    if (annualRateBps < 0) {
      throw new ScenarioEngineError(`"annualRateBps" must not be negative`);
    }
    if (payoffDate.getTime() < accrualStartDate.getTime()) {
      throw new ScenarioEngineError(
        `"payoffDate" must not precede "accrualStartDate" — a negative accrual ` +
          `period would produce a payoff smaller than the principal.`,
      );
    }

    const optionalCents = (key: string): number =>
      inputs[key] === undefined ? 0 : requireCents(inputs, key);

    const unappliedCreditCents = optionalCents("unappliedCreditCents");
    const lateFeesOutstandingCents = optionalCents("lateFeesOutstandingCents");
    const payoffFeeCents = optionalCents("payoffFeeCents");

    const quote = computePayoffQuote({
      principalBalanceCents,
      annualRateBps,
      accrualStartDate,
      payoffDate,
      unappliedCreditCents,
      lateFeesOutstandingCents,
      payoffFeeCents,
    });

    return {
      // Dates round-trip as ISO strings so the stored inputs stay verbatim and
      // re-runnable, which is the whole point of persisting them.
      normalisedInputs: {
        principalBalanceCents,
        annualRateBps,
        accrualStartDate: accrualStartDate.toISOString(),
        payoffDate: payoffDate.toISOString(),
        unappliedCreditCents,
        lateFeesOutstandingCents,
        payoffFeeCents,
      },
      metrics: [
        metric("payoff_total", quote.totalPayoffCents),
        metric("accrued_interest", quote.accruedInterestCents),
        metric("principal_balance", quote.principalBalanceCents),
        metric("days_accrued", quote.daysAccrued),
      ],
    };
  },
};
