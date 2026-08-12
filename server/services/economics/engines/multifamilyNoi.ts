/**
 * The multifamily / operated-asset engine — the fifth registered engine.
 *
 * IT DELEGATES to `shared/rental/noi.ts`, which already owns the hard part: the
 * ONE place that decides what an operating expense IS and where the figure came
 * from. That module excludes mortgage interest and depreciation from NOI (so a
 * levered and an unlevered owner of the same building compute the same NOI),
 * defines "measured" precisely as operating rows present in the trailing-12
 * window, and refuses to invent an op-ex for an unmeasured COMMERCIAL building
 * because the residential 40%-of-collections rule of thumb is meaningless under
 * a triple-net or gross lease.
 *
 * WHAT THIS ADAPTER ACTUALLY ADDS
 * ------------------------------
 * The op-ex DECISION was already pure and tested. What was not versioned or
 * persisted is everything downstream of it: NOI, cap rate, DSCR and the expense
 * ratio are computed INLINE in `server/routes-investor-analytics.ts` and exist
 * only as an HTTP response. Nothing can point at the arithmetic that produced a
 * cap rate a customer acted on, which is exactly the gap the Scenario layer
 * exists to close (canonical law 4: deterministic, tested AND versioned).
 *
 * THE NULL METRICS ARE THE POINT, NOT A DEFECT
 * --------------------------------------------
 * An unmeasured commercial building yields a NULL op-ex, and therefore a null
 * NOI, cap rate, expense ratio, cash flow and DSCR. `ScenarioMetric.value` is
 * nullable precisely so an engine can decline. Nothing here substitutes a
 * plausible number for an absent one.
 *
 * The null does not carry its own reason, and deliberately so: `normalisedInputs`
 * is persisted verbatim, so `structureClass: "commercial"` with
 * `measuredOpExRowCount: 0` and no `opExBps` fully explains the refusal to any
 * later reader. Widening the persisted metric shape to narrate it would be a
 * shape-version bump bought for a reason nobody has asked for yet.
 *
 * IT DOES NOT REUSE `total_cost`. Its denominator is a VALUATION, and a held
 * building's market value is not what it cost. Reusing the id would put two
 * different quantities under one label — a subtler version of the percent-under-
 * a-ratio-label error two earlier adapters hit, and the exact thing the metric
 * registry exists to prevent (BI182, BI92).
 *
 * WHY IT IS NOT A CORE (shared/) ENGINE, even though it could be. Its arithmetic
 * is browser-safe, so `CORE_ENGINES` would accept it and the client could then
 * compute a cap rate without a round trip. Nothing computes scenarios
 * client-side today, so that capability would be built for a need nobody has
 * measured — and one registry location is worth more than a speculative one.
 */

import {
  ScenarioEngineError,
  metric,
  optionalCents,
  requireCents,
  requireNumber,
  requireOneOf,
  type EngineSpec,
  type ScenarioAssumption,
  type ScenarioMetric,
} from "@shared/economics/scenario";
import {
  ASSUMED_OPEX_BPS,
  TRAILING_12_WINDOW_MONTHS,
  computeNoi,
  decideOperatingExpense,
  isMeasuredCoverageComplete,
} from "@shared/rental/noi";

/** Bumped when the ADAPTER's mapping changes, not the underlying decision. */
const MULTIFAMILY_ENGINE_VERSION = "multifamily-noi-1" as const;

/**
 * What the cap-rate denominator actually IS. The route this generalises falls
 * back `marketValue ?? assessedValue`, and those are not the same number: an
 * assessment is a taxing authority's figure produced on its own cycle and its
 * own method, so a cap rate built on one is systematically different from a cap
 * rate built on a market value. The basis is therefore an explicit input rather
 * than an inference, and the engine declares it when it is not a market value.
 */
const VALUATION_BASES = ["market", "assessed", "purchase_price"] as const;

/** Residential obeys the 40% rule of thumb; commercial does not (see noi.ts). */
const STRUCTURE_CLASSES = ["residential", "commercial"] as const;

export const multifamilyNoiEngine: EngineSpec = {
  id: "multifamily_noi",
  version: MULTIFAMILY_ENGINE_VERSION,
  label: "Operated asset (NOI, cap rate, DSCR)",
  produces: [
    "annual_operating_expense",
    "annual_noi",
    "cap_rate",
    "operating_expense_ratio",
    "monthly_cash_flow",
    "dscr",
    "gross_rent_multiplier",
  ],

  compute(inputs) {
    const monthlyRentCollectedCents = requireCents(inputs, "monthlyRentCollectedCents");
    const valuationCents = requireCents(inputs, "valuationCents");
    const valuationBasis = requireOneOf(inputs, "valuationBasis", VALUATION_BASES);
    const structureClass = requireOneOf(inputs, "structureClass", STRUCTURE_CLASSES);
    const measuredOpExRowCount = requireNumber(inputs, "measuredOpExRowCount");
    const measuredOpExMonthsCovered = requireNumber(inputs, "measuredOpExMonthsCovered");

    if (monthlyRentCollectedCents < 0) {
      throw new ScenarioEngineError("monthlyRentCollectedCents must not be negative");
    }
    if (valuationCents <= 0) {
      throw new ScenarioEngineError("valuationCents must be positive");
    }
    if (measuredOpExRowCount < 0 || !Number.isInteger(measuredOpExRowCount)) {
      throw new ScenarioEngineError("measuredOpExRowCount must be a non-negative integer");
    }
    if (measuredOpExMonthsCovered < 0 || !Number.isInteger(measuredOpExMonthsCovered)) {
      throw new ScenarioEngineError("measuredOpExMonthsCovered must be a non-negative integer");
    }

    // "Measured" is defined in noi.ts as OPERATING ROWS PRESENT in the window,
    // and the engine derives it here rather than accepting a `hasMeasured`
    // boolean from the caller. A caller-supplied flag is a claim; a row count is
    // a fact, and the whole provenance chain below rests on which one it is.
    const hasMeasured = measuredOpExRowCount > 0;
    const measuredOpExMonthlyCents = optionalCents(inputs, "measuredOpExMonthlyCents");
    if (hasMeasured && measuredOpExMonthlyCents === null) {
      throw new ScenarioEngineError(
        "measuredOpExMonthlyCents is required when measuredOpExRowCount > 0",
      );
    }
    const opExBps =
      inputs["opExBps"] === undefined ? undefined : requireNumber(inputs, "opExBps");
    const debtServiceMonthlyCents = optionalCents(inputs, "debtServiceMonthlyCents");

    const decision = decideOperatingExpense({
      hasMeasured,
      measuredOpExMonthlyCents: measuredOpExMonthlyCents ?? 0,
      opExBps,
      isCommercial: structureClass === "commercial",
      monthlyRentCollectedCents,
    });

    const opExMonthly = decision.opExMonthlyCents;
    const { noiMonthlyCents: noiMonthly, noiAnnualCents: noiAnnual } = computeNoi({
      monthlyRentCollectedCents,
      opExMonthlyCents: opExMonthly,
    });
    const annualCollections = monthlyRentCollectedCents * 12;

    const assumptions: ScenarioAssumption[] = [];

    // ── What the op-ex figure actually rests on ──────────────────────────────
    // Three of the four sources are assumptions and one is a measurement, and
    // they are NOT interchangeable. The `origin` distinction is the whole
    // reason this is declared rather than folded into a number: an operator's
    // own ratio override is that operator's judgement, while the 40% fallback
    // is the platform's, and collapsing them is how a platform default comes to
    // read as what the customer believed.
    if (decision.opExSource === "assumed_ratio") {
      assumptions.push({
        key: "operating_expense",
        value: `${ASSUMED_OPEX_BPS / 100}% of collections`,
        origin: "platform-default",
        basis:
          "No operating expenses were recorded and no ratio was supplied, so the " +
          "platform's residential rule of thumb was substituted. Every figure " +
          "below — NOI, cap rate, expense ratio, cash flow, DSCR — rests on it.",
      });
    } else if (decision.opExSource === "ratio_override") {
      assumptions.push({
        key: "operating_expense",
        value: `${(opExBps ?? 0) / 100}% of collections`,
        // The route this generalises makes the same point: an override is
        // operator-supplied but is NOT measured from records.
        origin: "user",
        basis:
          "The operator supplied an expense RATIO rather than expense records. " +
          "It is their own judgement, not the platform's, but it is still a " +
          "ratio and not a measurement.",
      });
    } else if (decision.opExSource === "measured_expenses") {
      // A real ledger that does not span the year is a real but PARTIAL slice.
      // Annualising it reads as a full year's books unless the gap is stated,
      // which is precisely the "thin ledger reading as a complete one" failure
      // noi.ts names in its header.
      if (!isMeasuredCoverageComplete(measuredOpExMonthsCovered)) {
        assumptions.push({
          key: "operating_expense_coverage",
          value: `${measuredOpExMonthsCovered}/${TRAILING_12_WINDOW_MONTHS} months`,
          origin: "derived",
          basis:
            "Operating expenses were measured from real records, but they cover " +
            `only ${measuredOpExMonthsCovered} of the trailing ` +
            `${TRAILING_12_WINDOW_MONTHS} months. The annual figures below ` +
            "extrapolate that partial slice, and a year with an uncovered " +
            "insurance or tax month would come in higher.",
        });
      }
    }

    // ── What the cap-rate denominator actually IS ────────────────────────────
    if (valuationBasis !== "market") {
      assumptions.push({
        key: "valuation_basis",
        value: valuationBasis,
        origin: "derived",
        basis:
          valuationBasis === "assessed"
            ? "Cap rate and GRM are computed against an ASSESSED value, which a " +
              "taxing authority produced on its own cycle and method. It is not " +
              "a market valuation and the resulting cap rate is not comparable " +
              "to one computed against market."
            : "Cap rate and GRM are computed against the PURCHASE PRICE, so they " +
              "describe the return at acquisition rather than against the " +
              "asset's value today.",
      });
    }

    const metrics: ScenarioMetric[] = [
      metric("annual_operating_expense", opExMonthly === null ? null : opExMonthly * 12),
      metric("annual_noi", noiAnnual),
      metric("cap_rate", noiAnnual === null ? null : noiAnnual / valuationCents),
      metric(
        "operating_expense_ratio",
        // Undefined rather than zero when nothing is collected: dividing by no
        // collections is not a 0% expense ratio, it is an unanswerable question.
        opExMonthly === null || annualCollections <= 0
          ? null
          : (opExMonthly * 12) / annualCollections,
      ),
      metric(
        "monthly_cash_flow",
        noiMonthly === null || debtServiceMonthlyCents === null
          ? null
          : noiMonthly - debtServiceMonthlyCents,
      ),
      metric(
        "dscr",
        noiMonthly === null ||
          debtServiceMonthlyCents === null ||
          debtServiceMonthlyCents <= 0
          ? null
          : noiMonthly / debtServiceMonthlyCents,
      ),
      metric(
        "gross_rent_multiplier",
        annualCollections <= 0 ? null : valuationCents / annualCollections,
      ),
    ];

    return {
      normalisedInputs: {
        monthlyRentCollectedCents,
        valuationCents,
        valuationBasis,
        structureClass,
        measuredOpExRowCount,
        measuredOpExMonthsCovered,
        ...(measuredOpExMonthlyCents === null ? {} : { measuredOpExMonthlyCents }),
        ...(opExBps === undefined ? {} : { opExBps }),
        ...(debtServiceMonthlyCents === null ? {} : { debtServiceMonthlyCents }),
      },
      assumptions,
      metrics,
    };
  },
};
