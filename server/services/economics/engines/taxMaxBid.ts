/**
 * The tax max-bid engine — the tax lien / deed vertical's registered engine
 * (Step 0 items T4+T5; the founder call in the tax gap sheet decided the
 * tax "decision" is the bid / no-bid call on a listing, against a max bid).
 *
 * WHAT IT ANSWERS. "What is the most I can bid for this tax-sale lot and
 * still make my required return?" — the purchase decision a tax investor
 * actually makes, before the sale. The certificate machinery (clocks,
 * ledgers, redemption notices) serves a certificate already held; it
 * decides nothing about bidding, which is why no engine declared
 * `tax_lien_deed` and this engine exists.
 *
 * IT DELEGATES; IT DOES NOT REIMPLEMENT. The arithmetic is the pure
 * function in `shared/tax/maxBid.ts` (`deriveMaxBid`) — the same screen
 * the listing worksheet's bid discipline (server/services/tax/
 * bidDiscipline.ts) records from: stated value − liens the operator's own
 * search says survive − other taxes − costs to clear and hold − the
 * operator's required return. Two implementations of the same money
 * formula is precisely the duplication canonical law 1 forbids.
 *
 * PROVENANCE, HONESTLY SCOPED. On the listing, every stack line carries
 * its own source and as-of date, and that record (MaxBidRecord) stays the
 * provenance-bearing surface. The desk takes the operator's stated
 * amounts at decision time — the scenario's own timestamp is their
 * as-of — and freezes each line as a derived assumption, so what the
 * number rests on is readable from the decision itself. A $0 liens or
 * taxes line is read the way `deriveMaxBid` reads it: searched, none
 * found. The desk cannot verify a search happened; the field copy says
 * "not searched is not none", the input is required (never defaulted),
 * and the frozen line states the reading rather than hiding it.
 *
 * WHAT IT PREDICTS. `max_allowable_offer` — the derived max bid itself;
 * `total_cost` — the all-in cost of winning AT that bid (bid + surviving
 * liens + other taxes + clear-and-hold costs); and `profit` — the stated
 * value less that total cost, which at the max bid equals the operator's
 * required return by construction. `total_cost` + `profit` are what make
 * a decision under this engine GRADEABLE (evidence rule v2). When the
 * stack leaves nothing, the max bid is $0 and profit is negative — the
 * engine reports that rather than refusing: "no bid at any price makes
 * your return" is an answer, and recording a `pass` against it is the
 * desk's most valuable decision.
 *
 * NO DEFAULTS. Every stack line is required; the required return is the
 * only choice of form, and it is all-or-nothing — a dollar return OR a
 * percentage of value, never both, never neither.
 *
 * Declares `tax_lien_deed`: a decision under that pack counts only when
 * it cites a scenario from this engine (evidence rule v2).
 */

import {
  ScenarioEngineError,
  metric,
  optionalCents,
  requireCents,
  requireNumber,
  type EngineSpec,
  type ScenarioAssumption,
} from "@shared/economics/scenario";
import { deriveMaxBid, type RightsStackInput, type StackAmount } from "@shared/tax/maxBid";

const TAX_MAX_BID_ENGINE_ID = "tax_max_bid" as const;
/** Bumped when the ADAPTER's mapping changes. The arithmetic's own history lives with the pure function. */
const TAX_MAX_BID_ENGINE_VERSION = "tax-max-bid-1" as const;

function centsInput(inputs: Record<string, number | string>, key: string): number {
  const v = requireCents(inputs, key);
  if (v < 0) throw new ScenarioEngineError(`"${key}" cannot be negative`);
  return v;
}

/** A stated amount line: $0 is the operator affirming "searched, none found". */
function amountLine(amountCents: number, source: string): StackAmount {
  return amountCents === 0
    ? { status: "searched_none", source, asOf: "at decision" }
    : { status: "known", amountCents, source, asOf: "at decision" };
}

export const taxMaxBidEngine: EngineSpec = {
  id: TAX_MAX_BID_ENGINE_ID,
  version: TAX_MAX_BID_ENGINE_VERSION,
  label: "Tax max bid (your value, less what stands ahead of you, your costs and your return)",
  verticals: ["tax_lien_deed"],
  produces: ["max_allowable_offer", "total_cost", "profit"],

  compute(inputs) {
    const lotValueCents = centsInput(inputs, "lotValueCents");
    if (lotValueCents <= 0) throw new ScenarioEngineError("lotValueCents must be positive");
    const survivingLiensCents = centsInput(inputs, "survivingLiensCents");
    const otherTaxesCents = centsInput(inputs, "otherTaxesCents");
    const clearAndHoldCostsCents = centsInput(inputs, "clearAndHoldCostsCents");

    // The required return is one form or the other — both (or neither) is
    // an ambiguous instruction, refused rather than resolved by a guess.
    const returnCents = optionalCents(inputs, "requiredReturnCents");
    const returnPctRaw = inputs["requiredReturnPct"];
    if ((returnCents === null) === (returnPctRaw === undefined)) {
      throw new ScenarioEngineError(
        "State your required return one way — a dollar amount or a percentage of the lot's value — not both, not neither.",
      );
    }
    if (returnCents !== null && returnCents < 0) {
      throw new ScenarioEngineError("requiredReturnCents cannot be negative");
    }
    const returnPct = returnPctRaw === undefined ? null : requireNumber(inputs, "requiredReturnPct");
    if (returnPct !== null && (returnPct < 0 || returnPct > 100)) {
      throw new ScenarioEngineError('"requiredReturnPct" must be at least 0 and at most 100 (percentage points)');
    }

    const stack: RightsStackInput = {
      value: { status: "known", amountCents: lotValueCents, source: "operator-stated on the bid desk", asOf: "at decision" },
      survivingLiens: amountLine(survivingLiensCents, "operator's own lien search, stated on the bid desk"),
      otherTaxes: amountLine(otherTaxesCents, "operator-stated on the bid desk"),
      costs: [
        {
          label: "Costs to clear title and hold (total)",
          amountCents: clearAndHoldCostsCents,
          source: "operator-stated on the bid desk",
        },
      ],
      requiredReturn:
        returnCents !== null
          ? { kind: "cents", amountCents: returnCents }
          : { kind: "pct_of_value", bps: Math.round((returnPct as number) * 100) },
    };

    const screen = deriveMaxBid(stack);
    if (screen.status === "refused") {
      // Unreachable given the validation above (every line is present);
      // kept so a future stack line fails as a refusal, never a number.
      throw new ScenarioEngineError(
        `The max bid cannot be derived — missing: ${screen.missing.map((m) => m.label).join("; ")}`,
      );
    }

    const totalCostCents = screen.maxBidCents + survivingLiensCents + otherTaxesCents + clearAndHoldCostsCents;

    const assumptions: ScenarioAssumption[] = screen.lines.map((line) => ({
      key: `stack_${line.key}`,
      value: line.amountCents,
      unit: "cents",
      origin: "derived",
      basis: `${line.label}: ${line.basis}`,
    }));
    assumptions.push({
      key: "bid_screen",
      value: "screen",
      origin: "derived",
      basis: screen.label,
    });
    if (screen.leavesNothing) {
      assumptions.push({
        key: "leaves_nothing",
        value: "yes",
        origin: "derived",
        basis:
          "The stack leaves nothing: at any positive bid the required return is missed, so the derived max bid is $0.",
      });
    }

    return {
      normalisedInputs: {
        lotValueCents,
        survivingLiensCents,
        otherTaxesCents,
        clearAndHoldCostsCents,
        ...(returnCents !== null ? { requiredReturnCents: returnCents } : {}),
        ...(returnPct !== null ? { requiredReturnPct: returnPct } : {}),
      },
      assumptions,
      metrics: [
        metric("max_allowable_offer", screen.maxBidCents),
        metric("total_cost", totalCostCents),
        // At the max bid this equals the required return by construction;
        // computed from value − total cost so the leaves-nothing case
        // reports its true (negative) figure instead of the clamped bid's.
        metric("profit", lotValueCents - totalCostCents),
      ],
    };
  },
};
