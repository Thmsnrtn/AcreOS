/**
 * The commercial acquisition/hold engine — the registered engine that
 * declares the `commercial` vertical (Step-0 gap sheet commercial.md,
 * work item 1, bar (b)).
 *
 * WHAT IT COMPUTES, AND FROM WHAT
 * -------------------------------
 * Everything here rests on the org's RECORDED data, flattened by the caller
 * from the records themselves:
 *
 *   - in-place rent: the recorded leases' base rents, made escalation-aware
 *     by `shared/rental/rentEscalation.ts` (the caller applies the recorded
 *     rent schedule steps as of `asOfMonth` and passes both the base and the
 *     escalated figure, so the uplift is visible in the persisted inputs
 *     rather than hidden inside a single number);
 *   - CAM recoveries: the monthly recoveries from recorded CAM
 *     reconciliations (`shared/rental/camReconciliation.ts` statements),
 *     included in effective gross income only when actually recorded;
 *   - rollover exposure: the in-place rent on recorded leases whose terms
 *     expire within twelve months of `asOfMonth`.
 *
 * WHAT IT REFUSES, AND WHY
 * ------------------------
 *   - No leases recorded → refused outright. An underwrite of a commercial
 *     asset with no recorded lease has no in-place income to underwrite.
 *   - No operator-entered price → refused outright. The cap rate's
 *     denominator is the price the OPERATOR entered; there is no market
 *     value, assessed value or comp to fall back to, and none is invented.
 *   - Unmeasured operating expenses → NOI, cap rate and the expense ratio
 *     are NULL, never an assumed figure. This delegates to
 *     `decideOperatingExpense` in `shared/rental/noi.ts` with
 *     `isCommercial: true`: the residential 40%-of-collections rule of
 *     thumb is meaningless under a triple-net or gross lease, so a
 *     commercial asset with neither measured expenses nor an operator's
 *     own ratio override gets NO op-ex — and therefore no NOI — rather
 *     than a fabricated one. The persisted normalised inputs
 *     (`measuredOpExRowCount: 0`, no `opExBps`) plus the declared
 *     assumption explain the refusal to any later reader.
 *
 * NO MARKET DATA. There is no commercial rent-comps source in this
 * codebase and this engine invents none: no market rent, no vacancy
 * assumption, no market cap rate. Vacancy is not modelled at all — the
 * income is the recorded in-place rent, stated as such.
 *
 * IT DOES NOT WIDEN `multifamilyNoi`. That engine declares only
 * `multifamily`; its `structureClass: "commercial"` flag is a multifamily
 * input, not a commercial declaration. This engine is the commercial one.
 */

import {
  ScenarioEngineError,
  metric,
  optionalCents,
  requireCents,
  requireNumber,
  type EngineSpec,
  type ScenarioAssumption,
  type ScenarioMetric,
} from "@shared/economics/scenario";
import {
  TRAILING_12_WINDOW_MONTHS,
  computeNoi,
  decideOperatingExpense,
  isMeasuredCoverageComplete,
} from "@shared/rental/noi";

/** Bumped when the ADAPTER's mapping changes, not the underlying decisions. */
const COMMERCIAL_ENGINE_VERSION = "commercial-underwrite-1" as const;

function optionalNumber(
  inputs: Record<string, number | string>,
  key: string,
): number | null {
  return inputs[key] === undefined ? null : requireNumber(inputs, key);
}

function requireCount(
  inputs: Record<string, number | string>,
  key: string,
): number {
  const v = requireNumber(inputs, key);
  if (v < 0 || !Number.isInteger(v)) {
    throw new ScenarioEngineError(`${key} must be a non-negative integer`);
  }
  return v;
}

export const commercialUnderwriteEngine: EngineSpec = {
  id: "commercial_underwrite",
  version: COMMERCIAL_ENGINE_VERSION,
  label: "Commercial acquisition/hold (in-place NOI, cap rate, rollover)",
  verticals: ["commercial"],
  produces: [
    "effective_gross_income",
    "cam_recoveries_annual",
    "annual_rent_per_sqft",
    "annual_operating_expense",
    "annual_noi",
    "cap_rate",
    "operating_expense_ratio",
    "rollover_rent_share_12m",
    "total_cost",
  ],

  compute(inputs) {
    // ── The price: operator-entered, or the underwrite is refused ─────────
    // requireCents IS the refusal for a missing price: there is no other
    // denominator this engine is willing to divide by.
    const purchasePriceCents = requireCents(inputs, "purchasePriceCents");
    if (purchasePriceCents <= 0) {
      throw new ScenarioEngineError("purchasePriceCents must be positive");
    }

    // ── The recorded leases: none recorded, nothing to underwrite ─────────
    const leaseCount = requireCount(inputs, "leaseCount");
    if (leaseCount === 0) {
      throw new ScenarioEngineError(
        "No recorded leases: a commercial underwrite needs at least one " +
          "recorded lease — there is no in-place income to underwrite without one",
      );
    }

    const asOfMonthRaw = inputs["asOfMonth"];
    if (typeof asOfMonthRaw !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(asOfMonthRaw)) {
      throw new ScenarioEngineError(
        'Scenario input "asOfMonth" is required and must be a YYYY-MM month',
      );
    }
    const asOfMonth = asOfMonthRaw;

    // ── In-place rent: recorded base, and the escalation-aware figure ─────
    const baseMonthlyRentCents = requireCents(inputs, "baseMonthlyRentCents");
    const escalatedMonthlyRentCents = requireCents(inputs, "escalatedMonthlyRentCents");
    if (baseMonthlyRentCents < 0) {
      throw new ScenarioEngineError("baseMonthlyRentCents must not be negative");
    }
    if (escalatedMonthlyRentCents < 0) {
      throw new ScenarioEngineError("escalatedMonthlyRentCents must not be negative");
    }

    // ── Rollover: recorded rent expiring inside the next twelve months ────
    const expiringMonthlyRentCents = requireCents(
      inputs,
      "expiringWithin12MonthsMonthlyRentCents",
    );
    if (expiringMonthlyRentCents < 0) {
      throw new ScenarioEngineError(
        "expiringWithin12MonthsMonthlyRentCents must not be negative",
      );
    }
    if (expiringMonthlyRentCents > escalatedMonthlyRentCents) {
      throw new ScenarioEngineError(
        "expiringWithin12MonthsMonthlyRentCents cannot exceed the in-place rent",
      );
    }

    // ── CAM recoveries: recorded reconciliations only ─────────────────────
    const camRecoveriesMonthlyCents = optionalCents(inputs, "camRecoveriesMonthlyCents");
    if (camRecoveriesMonthlyCents !== null && camRecoveriesMonthlyCents < 0) {
      throw new ScenarioEngineError("camRecoveriesMonthlyCents must not be negative");
    }

    const rentableSqft = optionalNumber(inputs, "rentableSqft");
    if (rentableSqft !== null && rentableSqft <= 0) {
      throw new ScenarioEngineError("rentableSqft must be positive when supplied");
    }

    // ── Operating expenses: measured, operator ratio, or refused ──────────
    // Same discipline as multifamilyNoi: "measured" is derived from a row
    // count (a fact), never accepted as a caller-supplied boolean (a claim).
    const measuredOpExRowCount = requireCount(inputs, "measuredOpExRowCount");
    const measuredOpExMonthsCovered = requireCount(inputs, "measuredOpExMonthsCovered");
    const hasMeasured = measuredOpExRowCount > 0;
    const measuredOpExMonthlyCents = optionalCents(inputs, "measuredOpExMonthlyCents");
    if (hasMeasured && measuredOpExMonthlyCents === null) {
      throw new ScenarioEngineError(
        "measuredOpExMonthlyCents is required when measuredOpExRowCount > 0",
      );
    }
    const opExBps =
      inputs["opExBps"] === undefined ? undefined : requireNumber(inputs, "opExBps");
    if (opExBps !== undefined && (opExBps < 0 || opExBps > 10000)) {
      throw new ScenarioEngineError("opExBps must be between 0 and 10000");
    }

    const monthlyIncomeCents =
      escalatedMonthlyRentCents + (camRecoveriesMonthlyCents ?? 0);
    const annualIncomeCents = monthlyIncomeCents * 12;

    const decision = decideOperatingExpense({
      hasMeasured,
      measuredOpExMonthlyCents: measuredOpExMonthlyCents ?? 0,
      opExBps,
      isCommercial: true,
      monthlyRentCollectedCents: monthlyIncomeCents,
    });
    const opExMonthly = decision.opExMonthlyCents;
    const { noiMonthlyCents: noiMonthly, noiAnnualCents: noiAnnual } = computeNoi({
      monthlyRentCollectedCents: monthlyIncomeCents,
      opExMonthlyCents: opExMonthly,
    });

    const assumptions: ScenarioAssumption[] = [];

    assumptions.push({
      key: "valuation_basis",
      value: "operator_entered_price",
      origin: "user",
      basis:
        "Cap rate is computed on the price the operator entered for this " +
        "acquisition. It is not a market valuation or an assessed value, " +
        "and no market or comp figure was used anywhere in this scenario.",
    });

    // ── What `total_cost` actually IS ────────────────────────────────────
    // The acquisition cost, on the multifamilyNoi v2 pattern: the gradeable
    // predicate (tests/support/verticalEvidence.ts) credits an engine only
    // if it produces `total_cost` or `profit`, and the outcome loop reads
    // `total_cost` as "what it cost to acquire" — the one predicted figure
    // here with a real-world actual to compare against at review time.
    // The price is a required input (the underwrite refuses without one),
    // so the metric is always present; the form supplies no closing costs,
    // so none is added or assumed.
    assumptions.push({
      key: "total_cost_basis",
      value: "acquisition",
      origin: "derived",
      basis:
        "Total cost is the ACQUISITION cost: the price the operator " +
        "entered for this acquisition. The underwrite form supplies no " +
        "closing costs, so none is added. It is not a market valuation.",
    });

    if (escalatedMonthlyRentCents !== baseMonthlyRentCents) {
      assumptions.push({
        key: "rent_escalation",
        value: `${baseMonthlyRentCents} -> ${escalatedMonthlyRentCents} cents/month`,
        origin: "derived",
        basis:
          `In-place rent is escalation-aware as of ${asOfMonth}: the recorded ` +
          "rent schedule steps on the recorded leases move the in-place rent " +
          "from the recorded base figure to the escalated figure above. " +
          "Every income figure in this scenario uses the escalated figure.",
      });
    } else {
      assumptions.push({
        key: "rent_escalation",
        value: "no escalation in effect",
        origin: "derived",
        basis:
          `No recorded rent schedule step changes the in-place rent as of ` +
          `${asOfMonth}, so in-place rent is the recorded base rent.`,
      });
    }

    if (camRecoveriesMonthlyCents === null) {
      assumptions.push({
        key: "cam_recoveries",
        value: "not recorded — excluded",
        origin: "derived",
        basis:
          "No CAM recoveries from recorded reconciliations were supplied, " +
          "so effective gross income is rent only. No recovery figure was " +
          "assumed; a reconciled recovery would raise the income and the NOI.",
      });
    }

    if (decision.opExSource === "commercial_unmeasured") {
      assumptions.push({
        key: "operating_expense",
        value: "unmeasured — NOI refused",
        origin: "derived",
        basis:
          "No operating expenses were measured from records and the operator " +
          "supplied no expense ratio, so no operating expense was assumed: " +
          "the residential rule of thumb does not apply to a commercial " +
          "lease. NOI, cap rate and the expense ratio are therefore null — " +
          "unknown, not zero.",
      });
    } else if (decision.opExSource === "ratio_override") {
      assumptions.push({
        key: "operating_expense",
        value: `${(opExBps ?? 0) / 100}% of income`,
        origin: "user",
        basis:
          "The operator supplied an expense RATIO rather than expense " +
          "records. It is their own judgement, not a measurement.",
      });
    } else if (
      decision.opExSource === "measured_expenses" &&
      !isMeasuredCoverageComplete(measuredOpExMonthsCovered)
    ) {
      assumptions.push({
        key: "operating_expense_coverage",
        value: `${measuredOpExMonthsCovered}/${TRAILING_12_WINDOW_MONTHS} months`,
        origin: "derived",
        basis:
          "Operating expenses were measured from real records, but they cover " +
          `only ${measuredOpExMonthsCovered} of the trailing ` +
          `${TRAILING_12_WINDOW_MONTHS} months. The annual figures below ` +
          "extrapolate that partial slice.",
      });
    }

    assumptions.push({
      key: "rollover_exposure",
      value: `${expiringMonthlyRentCents} cents/month expiring within 12 months`,
      origin: "derived",
      basis:
        `Of the recorded in-place rent, the figure above sits on leases whose ` +
        `recorded terms expire within twelve months of ${asOfMonth}. It is ` +
        "exposure from recorded lease terms only — no renewal probability " +
        "or market rent is modelled.",
    });

    const metrics: ScenarioMetric[] = [
      metric("effective_gross_income", annualIncomeCents),
      metric(
        "cam_recoveries_annual",
        camRecoveriesMonthlyCents === null ? null : camRecoveriesMonthlyCents * 12,
      ),
      metric(
        "annual_rent_per_sqft",
        rentableSqft === null
          ? null
          : Math.round((escalatedMonthlyRentCents * 12) / rentableSqft),
      ),
      metric("annual_operating_expense", opExMonthly === null ? null : opExMonthly * 12),
      metric("annual_noi", noiAnnual),
      metric("cap_rate", noiAnnual === null ? null : noiAnnual / purchasePriceCents),
      metric(
        "operating_expense_ratio",
        opExMonthly === null || annualIncomeCents <= 0
          ? null
          : (opExMonthly * 12) / annualIncomeCents,
      ),
      metric(
        "rollover_rent_share_12m",
        escalatedMonthlyRentCents <= 0
          ? null
          : expiringMonthlyRentCents / escalatedMonthlyRentCents,
      ),
      metric("total_cost", purchasePriceCents),
    ];

    return {
      normalisedInputs: {
        purchasePriceCents,
        leaseCount,
        asOfMonth,
        baseMonthlyRentCents,
        escalatedMonthlyRentCents,
        expiringWithin12MonthsMonthlyRentCents: expiringMonthlyRentCents,
        measuredOpExRowCount,
        measuredOpExMonthsCovered,
        ...(camRecoveriesMonthlyCents === null ? {} : { camRecoveriesMonthlyCents }),
        ...(rentableSqft === null ? {} : { rentableSqft }),
        ...(measuredOpExMonthlyCents === null ? {} : { measuredOpExMonthlyCents }),
        ...(opExBps === undefined ? {} : { opExBps }),
      },
      assumptions,
      metrics,
    };
  },
};
