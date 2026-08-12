/**
 * The buy-and-hold / rental scenario engine — the fourth registered engine.
 *
 * IT DELEGATES to `computeRentalReturns` (server/services/flipUnderwriting.ts)
 * rather than reimplementing the maths, like every other engine here.
 *
 * WHY computeRentalReturns AND NOT calculateRentalAnalysis
 * --------------------------------------------------------
 * Both exist, and the difference is the whole reason this adapter is worth
 * writing. `calculateRentalAnalysis` silently substitutes a 40%-of-rent expense
 * ratio when expenses are unknown, and its own file comment says the return
 * value "cannot say so — callers must use `computeRentalReturns`, which reports
 * `expenseBasis`, rather than rendering these numbers unlabelled."
 *
 * That `expenseBasis` is exactly what drove widening the EngineSpec contract to
 * let an engine DECLARE its own assumptions: only the engine knows it
 * substituted something, and without a way to say so the substitution would
 * vanish into a metric and read as measured. A platform default quietly
 * becoming "what the customer believed" is the failure `origin` exists to
 * prevent, and it would be invisible six months later.
 *
 * IT REUSES `total_cost`. Cap rate, NOI, cash flow and GRM are genuinely
 * rental-specific quantities and get their own ids; the acquisition price is
 * the same quantity every other engine calls total cost (BI92).
 */

import {
  ScenarioEngineError,
  metric,
  requireCents,
  type EngineSpec,
  type ScenarioAssumption,
} from "@shared/economics/scenario";
import { computeRentalReturns } from "../../flipUnderwriting";

/** Bumped when the ADAPTER's mapping changes, not the underlying arithmetic. */
const RENTAL_ENGINE_VERSION = "rental-returns-1" as const;

export const rentalReturnsEngine: EngineSpec = {
  id: "rental_returns",
  version: RENTAL_ENGINE_VERSION,
  label: "Buy & hold (NOI, cap rate, cash flow)",
  produces: [
    "total_cost",
    "annual_noi",
    "monthly_cash_flow",
    "cap_rate",
    "gross_rent_multiplier",
  ],

  compute(inputs) {
    const purchasePriceCents = requireCents(inputs, "purchasePriceCents");
    const monthlyRentCents = requireCents(inputs, "monthlyRentCents");
    if (purchasePriceCents <= 0) {
      throw new ScenarioEngineError("purchasePriceCents must be positive");
    }
    if (monthlyRentCents < 0) {
      throw new ScenarioEngineError("monthlyRentCents must not be negative");
    }

    // Omitted means UNKNOWN, and the engine will substitute — which it then
    // declares below. It does NOT mean "expenses are zero".
    //
    // Note that an explicit 0 is ALSO unknown: computeRentalReturns's contract
    // is "0/omitted = unknown", because a property with genuinely zero
    // operating expenses does not exist. The adapter does not paper over that —
    // an explicit 0 declares the same platform-default assumption an omission
    // does, so a caller who read `0` as "no expenses" still sees the
    // substitution named rather than a 40%-derived NOI presented as measured.
    const hasExpenses = inputs["monthlyExpensesCents"] !== undefined;
    const monthlyExpensesCents = hasExpenses
      ? requireCents(inputs, "monthlyExpensesCents")
      : null;

    const r = computeRentalReturns({
      purchasePriceCents,
      monthlyRentCents,
      monthlyExpensesCents,
    });

    const assumptions: ScenarioAssumption[] = [];
    if (r.expenseBasis === "assumed_40pct") {
      assumptions.push({
        key: "monthly_operating_expenses",
        value: "40% of gross rent",
        origin: "platform-default",
        basis:
          "The operator supplied no expense figure, so a 40%-of-rent ratio was " +
          "substituted. Every NOI, cap-rate and cash-flow figure below rests on " +
          "it — replace it with real expenses before relying on them.",
      });
    }

    return {
      normalisedInputs: {
        purchasePriceCents,
        monthlyRentCents,
        ...(monthlyExpensesCents === null ? {} : { monthlyExpensesCents }),
      },
      assumptions,
      metrics: [
        metric("total_cost", purchasePriceCents),
        metric("annual_noi", r.annualNoiCents),
        metric("monthly_cash_flow", r.monthlyCashFlowCents),
        // capRatePct is a PERCENT; `cap_rate` is a RATIO. Converting at the
        // boundary rather than storing a percent under a ratio label is the
        // difference between a comparable number and a 100x error (BI182) —
        // the same trap the flip adapter hit with roi.
        metric("cap_rate", r.capRatePct / 100),
        metric("gross_rent_multiplier", r.grossRentMultiplier),
      ],
    };
  },
};
