/**
 * The tax-lien bid engine: the registered adapter over
 * shared/calculators/taxLienBid.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently:
 *   - an omitted redemption penalty is counted as none (platform default);
 *   - omitted registration and admin fees are excluded from total cost
 *     (platform default).
 * The premium, the rate, the premium treatment and the redemption month are
 * REQUIRED. None of them has an honest default: states differ on every one, and
 * a $0 premium is a real bid.
 *
 * The premium treatment arrives either as its name or as the form's code
 * (shared/economics/fields/taxLienBid.ts). Either way the NAME is what is
 * frozen in the scenario's inputs, so the record reads as words and recomputes
 * to the same numbers.
 *
 * It declares the `tax_lien_deed` vertical: a decision under that pack counts
 * only when it cites a scenario from this engine (evidence rule v2). It models
 * redemption only. The deed path (no redemption, foreclosure, taking the
 * property) is a different decision and is not computed here.
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
} from "@shared/economics/scenario";
import {
  PREMIUM_TREATMENTS,
  TAX_LIEN_BID_ENGINE_ID,
  TAX_LIEN_BID_ENGINE_VERSION,
  TaxLienBidInputError,
  computeTaxLienBid,
  type PremiumTreatment,
} from "@shared/calculators/taxLienBid";
import { PREMIUM_TREATMENT_BY_CODE } from "@shared/economics/fields/taxLienBid";

function optionalNumber(inputs: Record<string, number | string>, key: string): number | null {
  return inputs[key] === undefined ? null : requireNumber(inputs, key);
}

/** The named rule, from its name or its form code. Anything else is refused, never defaulted. */
function requirePremiumTreatment(inputs: Record<string, number | string>): PremiumTreatment {
  const v = inputs.premiumTreatment;
  if (typeof v === "number") {
    const named = Number.isInteger(v) ? PREMIUM_TREATMENT_BY_CODE[v] : undefined;
    if (!named) {
      throw new ScenarioEngineError(
        `Scenario input "premiumTreatment" must be 1 (refunded with interest), 2 (refunded, no interest) or 3 (forfeited)`,
      );
    }
    return named;
  }
  return requireOneOf(inputs, "premiumTreatment", PREMIUM_TREATMENTS);
}

export const taxLienBidEngine: EngineSpec = {
  id: TAX_LIEN_BID_ENGINE_ID,
  version: TAX_LIEN_BID_ENGINE_VERSION,
  label: "Tax-lien certificate bid (return if the owner redeems at a chosen month, simple interest)",
  verticals: ["tax_lien_deed"],
  produces: ["total_cost", "profit", "roi", "irr", "annualized_return", "hold_months"],

  compute(inputs) {
    const normalised = {
      faceAmountCents: requireCents(inputs, "faceAmountCents"),
      premiumCents: requireCents(inputs, "premiumCents"),
      interestRatePct: requireNumber(inputs, "interestRatePct"),
      penaltyPct: optionalNumber(inputs, "penaltyPct"),
      premiumTreatment: requirePremiumTreatment(inputs),
      acquisitionCostsCents: optionalCents(inputs, "acquisitionCostsCents"),
      redemptionMonth: requireNumber(inputs, "redemptionMonth"),
    };

    let out;
    try {
      out = computeTaxLienBid(normalised);
    } catch (err) {
      if (err instanceof TaxLienBidInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    // Only an ABSENT penalty is our substitution. A typed 0 is the operator's
    // own answer (the state charges none), not a default to declare.
    if (normalised.penaltyPct === null) {
      assumptions.push({
        key: "redemption_penalty",
        value: "none counted",
        origin: "platform-default",
        basis: "No redemption penalty was entered, so the payoff counts interest only. Enter your state's penalty on face if it has one",
      });
    }
    if (normalised.acquisitionCostsCents === null) {
      assumptions.push({
        key: "acquisition_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No registration or admin fees were entered, so total cost, profit and every return leave them out. Enter what the county or auction platform charges before relying on them",
      });
    }

    const wire: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(normalised)) if (v !== null) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("total_cost", out.totalCostCents),
        metric("profit", out.profitCents),
        metric("roi", out.roi),
        metric("irr", out.irr),
        metric("annualized_return", out.annualizedReturn),
        metric("hold_months", out.holdMonths),
      ],
    };
  },
};
