/**
 * The mobile-home park acquisition engine — the registered engine that
 * declares the `mobile_home` vertical (Step-0 gap sheet mobile_home.md,
 * work item 3, ENGINE half, bar (b)).
 *
 * WHAT IT DECIDES, AND FROM WHAT
 * ------------------------------
 * The acquisition call for a park operator — buy a park, buy a home, buy a
 * pad lot — underwritten from the operator's OWN RECORDED numbers only,
 * flattened by the caller from the records themselves:
 *
 *   - lot count and occupied lot count: the recorded pads and which of
 *     them carry a recorded occupancy. Income is taken at RECORDED
 *     occupancy only; vacant pads contribute nothing and no lease-up,
 *     stabilisation or market occupancy is modelled.
 *   - lot rent: the total recorded monthly lot rent across the occupied
 *     pads (the ground rent every occupied pad pays, POH and TOH alike —
 *     the decomposition discipline of `shared/rental/lotRentSplit.ts`).
 *   - POH/TOH mix: the recorded count of occupied pads carrying a
 *     park-owned home. A park-owned home collects a HOME rent on top of
 *     the lot rent, so when the recorded mix says POH pads exist, the
 *     recorded home-rent total is REQUIRED — a lump sum with no recorded
 *     split is refused, never decomposed by a guess (lotRentSplit rule 1
 *     applied at underwriting scale).
 *   - utility pass-through recovery: the monthly recovery from recorded
 *     utility billback statements (`shared/rental/utilityBillback.ts`),
 *     included in income only when actually recorded. Whether a
 *     pass-through is lawful in a given state is the operator's
 *     responsibility; this engine records what was recovered and asserts
 *     nothing about its legality.
 *
 * WHAT IT REFUSES, AND WHY
 * ------------------------
 *   - No operator-entered price → refused outright. The cap rate's and
 *     cash-on-cash's denominators rest on the price the OPERATOR entered;
 *     there is no market value, assessed value or comp to fall back to.
 *   - No recorded occupancy, or no recorded lot rent → refused outright.
 *     An acquisition underwrite with no recorded income has nothing to
 *     underwrite.
 *   - POH pads recorded but no recorded home rent → refused (above).
 *   - Unmeasured operating expenses → NOI, cap rate, profit and
 *     cash-on-cash are NULL, never an assumed figure. This delegates to
 *     `decideOperatingExpense` in `shared/rental/noi.ts` on its
 *     no-assumed-ratio branch: the residential 40%-of-collections rule of
 *     thumb is a platform substitution, and a park's books are the
 *     operator's to record. The operator may still supply their OWN
 *     expense ratio, declared as their judgement.
 *
 * NO COMPS OF ANY KIND. Submarket lot-rent comps are excluded by
 * hard-stop for this vertical, and this engine invents none: no market
 * lot rent, no market occupancy, no market cap rate. Every rent in this
 * scenario is the operator's own recorded rent.
 *
 * NO CHATTEL / TITLE / LIEN ASSERTIONS. The POH/TOH mix is a count of
 * what the operator recorded. The home record in this product is
 * operator-asserted — AcreOS never checks a title against a DMV or
 * registry and never characterises a home as chattel or real property —
 * and this engine treats the mix exactly that way: recorded counts in,
 * arithmetic out, no characterisation.
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
import { monthlyPaymentCents } from "@shared/calculators/finance";

/** Bumped when the ADAPTER's mapping changes, not the underlying decisions. */
const MOBILE_HOME_ENGINE_VERSION = "mobile-home-acquisition-1" as const;

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

export const mobileHomeAcquisitionEngine: EngineSpec = {
  id: "mobile_home_acquisition",
  version: MOBILE_HOME_ENGINE_VERSION,
  label: "Mobile-home park acquisition (recorded lot rent, POH/TOH mix, cash-on-cash)",
  verticals: ["mobile_home"],
  produces: [
    "total_cost",
    "cash_required",
    "effective_gross_income",
    "utility_recoveries_annual",
    "annual_operating_expense",
    "annual_noi",
    "cap_rate",
    "operating_expense_ratio",
    "annual_debt_service",
    "profit",
    "monthly_cash_flow",
    "cash_on_cash",
    "occupancy_rate",
  ],

  compute(inputs) {
    // ── The price: operator-entered, or the underwrite is refused ─────────
    const purchasePriceCents = requireCents(inputs, "purchasePriceCents");
    if (purchasePriceCents <= 0) {
      throw new ScenarioEngineError("purchasePriceCents must be positive");
    }

    const closingCostsCents = optionalCents(inputs, "closingCostsCents");
    if (closingCostsCents !== null && closingCostsCents < 0) {
      throw new ScenarioEngineError("closingCostsCents must not be negative");
    }

    // ── The recorded pads: none recorded, nothing to underwrite ───────────
    const lotCount = requireCount(inputs, "lotCount");
    if (lotCount === 0) {
      throw new ScenarioEngineError(
        "No recorded pads: a park underwrite needs at least one recorded " +
          "lot — there is no park to underwrite without one",
      );
    }
    const occupiedLotCount = requireCount(inputs, "occupiedLotCount");
    if (occupiedLotCount > lotCount) {
      throw new ScenarioEngineError(
        "occupiedLotCount cannot exceed the recorded lotCount",
      );
    }
    if (occupiedLotCount === 0) {
      throw new ScenarioEngineError(
        "No recorded occupancy: every recorded pad is vacant, so there is " +
          "no recorded income to underwrite — a lease-up projection is a " +
          "forecast this engine does not make",
      );
    }

    // ── The POH/TOH mix: recorded counts, and the split they imply ────────
    const parkOwnedHomeCount = requireCount(inputs, "parkOwnedHomeCount");
    if (parkOwnedHomeCount > occupiedLotCount) {
      throw new ScenarioEngineError(
        "parkOwnedHomeCount cannot exceed the recorded occupiedLotCount",
      );
    }
    const monthlyLotRentCents = requireCents(inputs, "monthlyLotRentCents");
    if (monthlyLotRentCents < 0) {
      throw new ScenarioEngineError("monthlyLotRentCents must not be negative");
    }
    if (monthlyLotRentCents === 0) {
      throw new ScenarioEngineError(
        "No recorded lot rent: the occupied pads carry no recorded lot " +
          "rent, so there is no recorded income to underwrite",
      );
    }

    // A park-owned home collects a home rent on top of its lot rent. When
    // the recorded mix says POH pads exist, that home rent must itself be
    // recorded — a lump sum is refused, never split by a guess.
    const monthlyPohHomeRentCents = optionalCents(inputs, "monthlyPohHomeRentCents");
    if (parkOwnedHomeCount > 0 && monthlyPohHomeRentCents === null) {
      throw new ScenarioEngineError(
        "monthlyPohHomeRentCents is required when parkOwnedHomeCount > 0: " +
          "a park-owned home's rent must be recorded as its lot and home " +
          "components — a lump sum has no split this engine will invent",
      );
    }
    if (monthlyPohHomeRentCents !== null && monthlyPohHomeRentCents < 0) {
      throw new ScenarioEngineError("monthlyPohHomeRentCents must not be negative");
    }
    if (parkOwnedHomeCount === 0 && (monthlyPohHomeRentCents ?? 0) > 0) {
      throw new ScenarioEngineError(
        "monthlyPohHomeRentCents is recorded but parkOwnedHomeCount is 0: " +
          "home rent with no recorded park-owned home is incoherent",
      );
    }

    // ── Utility pass-through recovery: recorded statements only ───────────
    const utilityRecoveryMonthlyCents = optionalCents(
      inputs,
      "utilityRecoveryMonthlyCents",
    );
    if (utilityRecoveryMonthlyCents !== null && utilityRecoveryMonthlyCents < 0) {
      throw new ScenarioEngineError(
        "utilityRecoveryMonthlyCents must not be negative",
      );
    }

    // ── Operating expenses: measured, operator ratio, or refused ──────────
    // "Measured" is derived from a row count (a fact), never accepted as a
    // caller-supplied boolean (a claim). The no-assumed-ratio branch of
    // decideOperatingExpense is used (its `isCommercial` carve-out): a park
    // with neither measured expenses nor the operator's own ratio gets NO
    // op-ex — and therefore no NOI — rather than the residential rule of
    // thumb, which is a platform substitution this engine will not make.
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

    // ── Financing: the operator's recorded terms, or all cash ─────────────
    const downPaymentPct = optionalNumber(inputs, "downPaymentPct");
    if (downPaymentPct !== null && (downPaymentPct < 0 || downPaymentPct > 100)) {
      throw new ScenarioEngineError("downPaymentPct must be between 0 and 100");
    }
    const interestRatePct = optionalNumber(inputs, "interestRatePct");
    if (interestRatePct !== null && interestRatePct < 0) {
      throw new ScenarioEngineError("interestRatePct must not be negative");
    }
    const amortizationYears = optionalNumber(inputs, "amortizationYears");
    if (amortizationYears !== null && amortizationYears <= 0) {
      throw new ScenarioEngineError("amortizationYears must be positive when supplied");
    }
    const loanCents =
      downPaymentPct === null
        ? 0
        : Math.round(purchasePriceCents * (1 - downPaymentPct / 100));
    if (loanCents > 0 && (interestRatePct === null || amortizationYears === null)) {
      throw new ScenarioEngineError(
        "interestRatePct and amortizationYears are required when a down " +
          "payment below 100% is recorded: a loan with no recorded terms " +
          "has no debt service this engine will assume",
      );
    }
    const annualDebtServiceCents =
      loanCents > 0
        ? monthlyPaymentCents(loanCents, interestRatePct ?? 0, amortizationYears ?? 0) * 12
        : 0;
    const downPaymentCents =
      downPaymentPct === null
        ? purchasePriceCents
        : Math.round(purchasePriceCents * (downPaymentPct / 100));
    const cashRequiredCents = downPaymentCents + (closingCostsCents ?? 0);

    // ── The arithmetic: recorded income, decided expenses ─────────────────
    const monthlyIncomeCents =
      monthlyLotRentCents +
      (monthlyPohHomeRentCents ?? 0) +
      (utilityRecoveryMonthlyCents ?? 0);
    const annualIncomeCents = monthlyIncomeCents * 12;

    const decision = decideOperatingExpense({
      hasMeasured,
      measuredOpExMonthlyCents: measuredOpExMonthlyCents ?? 0,
      opExBps,
      isCommercial: true,
      monthlyRentCollectedCents: monthlyIncomeCents,
    });
    const opExMonthly = decision.opExMonthlyCents;
    const { noiAnnualCents: noiAnnual } = computeNoi({
      monthlyRentCollectedCents: monthlyIncomeCents,
      opExMonthlyCents: opExMonthly,
    });

    const profitAnnualCents =
      noiAnnual === null ? null : noiAnnual - annualDebtServiceCents;

    const assumptions: ScenarioAssumption[] = [];

    assumptions.push({
      key: "valuation_basis",
      value: "operator_entered_price",
      origin: "user",
      basis:
        "Cap rate and cash-on-cash are computed on the price the operator " +
        "entered for this acquisition. It is not a market valuation or an " +
        "assessed value, and no market or comp figure was used anywhere " +
        "in this scenario.",
    });

    assumptions.push({
      key: "no_comps",
      value: "no comps used",
      origin: "derived",
      basis:
        "Every rent in this scenario is the operator's own recorded rent. " +
        "No submarket lot-rent comp, market rent, market occupancy or " +
        "market cap rate was consulted or modelled — submarket lot-rent " +
        "comps are excluded for this vertical.",
    });

    assumptions.push({
      key: "occupancy_basis",
      value: `${occupiedLotCount}/${lotCount} pads recorded occupied`,
      origin: "derived",
      basis:
        "Income is taken at the recorded occupancy above. Vacant pads " +
        "contribute nothing and no lease-up or stabilised occupancy is " +
        "projected.",
    });

    assumptions.push({
      key: "poh_toh_mix",
      value: `${parkOwnedHomeCount} park-owned / ${occupiedLotCount - parkOwnedHomeCount} tenant-owned of ${occupiedLotCount} occupied`,
      origin: "derived",
      basis:
        "The POH/TOH mix is a count of what the operator recorded. The " +
        "home record is operator-asserted: this scenario makes no " +
        "chattel, title or lien assertion about any home, and no home is " +
        "characterised as chattel or real property.",
    });

    if (utilityRecoveryMonthlyCents === null) {
      assumptions.push({
        key: "utility_recoveries",
        value: "not recorded — excluded",
        origin: "derived",
        basis:
          "No utility pass-through recovery from recorded billback " +
          "statements was supplied, so income is rent only. No recovery " +
          "figure was assumed; a recorded recovery would raise the " +
          "income and the NOI.",
      });
    }

    if (closingCostsCents === null) {
      assumptions.push({
        key: "closing_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis:
          "No closing cost was entered, so total cost and cash required " +
          "leave it out. Enter your estimate before relying on them.",
      });
    }

    if (downPaymentPct === null) {
      assumptions.push({
        key: "financing",
        value: "all cash",
        origin: "platform-default",
        basis:
          "No down payment was entered, so the purchase is modelled as " +
          "all cash: no debt service, and profit is the full NOI.",
      });
    }

    if (decision.opExSource === "commercial_unmeasured") {
      assumptions.push({
        key: "operating_expense",
        value: "unmeasured — NOI refused",
        origin: "derived",
        basis:
          "No operating expenses were measured from records and the " +
          "operator supplied no expense ratio, so no operating expense " +
          "was assumed: a rule-of-thumb ratio is a platform substitution, " +
          "not the park's books. NOI, cap rate, profit and cash-on-cash " +
          "are therefore null — unknown, not zero.",
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
          "Operating expenses were measured from real records, but they " +
          `cover only ${measuredOpExMonthsCovered} of the trailing ` +
          `${TRAILING_12_WINDOW_MONTHS} months. The annual figures below ` +
          "extrapolate that partial slice.",
      });
    }

    const metrics: ScenarioMetric[] = [
      metric("total_cost", purchasePriceCents + (closingCostsCents ?? 0)),
      metric("cash_required", cashRequiredCents),
      metric("effective_gross_income", annualIncomeCents),
      metric(
        "utility_recoveries_annual",
        utilityRecoveryMonthlyCents === null ? null : utilityRecoveryMonthlyCents * 12,
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
      metric("annual_debt_service", annualDebtServiceCents),
      metric("profit", profitAnnualCents),
      metric(
        "monthly_cash_flow",
        profitAnnualCents === null ? null : Math.round(profitAnnualCents / 12),
      ),
      metric(
        "cash_on_cash",
        profitAnnualCents === null || cashRequiredCents <= 0
          ? null
          : profitAnnualCents / cashRequiredCents,
      ),
      metric("occupancy_rate", occupiedLotCount / lotCount),
    ];

    return {
      normalisedInputs: {
        purchasePriceCents,
        lotCount,
        occupiedLotCount,
        parkOwnedHomeCount,
        monthlyLotRentCents,
        measuredOpExRowCount,
        measuredOpExMonthsCovered,
        ...(closingCostsCents === null ? {} : { closingCostsCents }),
        ...(monthlyPohHomeRentCents === null ? {} : { monthlyPohHomeRentCents }),
        ...(utilityRecoveryMonthlyCents === null
          ? {}
          : { utilityRecoveryMonthlyCents }),
        ...(measuredOpExMonthlyCents === null ? {} : { measuredOpExMonthlyCents }),
        ...(opExBps === undefined ? {} : { opExBps }),
        ...(downPaymentPct === null ? {} : { downPaymentPct }),
        ...(interestRatePct === null ? {} : { interestRatePct }),
        ...(amortizationYears === null ? {} : { amortizationYears }),
      },
      assumptions,
      metrics,
    };
  },
};
