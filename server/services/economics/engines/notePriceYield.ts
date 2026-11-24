/**
 * The note price-to-yield engine — the note investor's registered engine
 * (Step 0 item N3; the founder call B-1 decided the notes desk is
 * price-to-yield).
 *
 * WHAT IT ANSWERS. "What is the most I can pay for this note and still earn
 * my target yield?" — the purchase decision a note investor actually makes,
 * before the note is on the book. The payoff engine (`note_payoff`) answers a
 * servicing question about a note already held; it decides nothing about
 * buying, which is why it declares no vertical and this engine exists.
 *
 * IT DELEGATES; IT DOES NOT REIMPLEMENT. The arithmetic is the pure function
 * in `shared/notes/notePriceYield.ts` — built and unit-tested in PR #541
 * (2026-11-10, never merged) and adopted as written: the scheduled cash flows
 * of the contract as stated, priced by closed-form present value at the
 * target monthly yield ((1 + Y)^(1/12) − 1, the `computeYields` convention),
 * with typed refusals for inputs the math cannot use. This adapter validates
 * the wire inputs, converts percentage points to the basis points the
 * function speaks, and presents the result in the shared metric vocabulary.
 * Two implementations of the same money formula is precisely the duplication
 * canonical law 1 forbids.
 *
 * WHAT IT PREDICTS. `total_cost` — the price at the target yield plus any
 * acquisition costs the operator entered — and `profit` — the scheduled
 * contract total less that total cost, if every payment arrives as written.
 * Those two are what make a decision under this engine GRADEABLE (evidence
 * rule v2: the outcome loop measures `total_cost` and `profit`). It also
 * reports `max_allowable_offer` (the price itself — the most to pay for the
 * target yield), `irr` (the target yield, which is the yield at that price
 * by construction), `discount_to_face` and `hold_months` (the schedule's
 * horizon). The contract-as-stated basis of the profit figure is frozen as a
 * derived assumption on every scenario: no defaults, prepayments or
 * servicing costs are modelled, and the scenario says so rather than letting
 * the number read as a forecast of collections.
 *
 * NO DEFAULTS. Every pricing input is required; the balloon pair and the
 * acquisition costs are the only optionals, and each is all-or-nothing — a
 * balloon amount with no month (or the reverse) is refused, not guessed.
 * When no acquisition costs are entered, total cost is the price alone and
 * an assumption on the scenario says exactly that.
 *
 * Declares `note_investor`: a decision under that pack counts only when it
 * cites a scenario from this engine (evidence rule v2).
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
import { priceForTargetYield } from "@shared/notes/notePriceYield";

const NOTE_PRICE_YIELD_ENGINE_ID = "note_price_yield" as const;
/** Bumped when the ADAPTER's mapping changes. The arithmetic's own history lives with the pure function. */
const NOTE_PRICE_YIELD_ENGINE_VERSION = "note-price-yield-1" as const;

function pctInput(
  inputs: Record<string, number | string>,
  key: string,
  { min, max, exclusiveMin }: { min: number; max: number; exclusiveMin?: boolean },
): number {
  const v = requireNumber(inputs, key);
  if ((exclusiveMin ? v <= min : v < min) || v > max) {
    throw new ScenarioEngineError(
      `"${key}" must be ${exclusiveMin ? "above" : "at least"} ${min} and at most ${max} (percentage points)`,
    );
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

export const notePriceYieldEngine: EngineSpec = {
  id: NOTE_PRICE_YIELD_ENGINE_ID,
  version: NOTE_PRICE_YIELD_ENGINE_VERSION,
  label: "Note price-to-yield (the most to pay for your target yield)",
  verticals: ["note_investor"],
  produces: ["max_allowable_offer", "total_cost", "profit", "irr", "discount_to_face", "hold_months"],

  compute(inputs) {
    const currentBalanceCents = requireCents(inputs, "currentBalanceCents");
    if (currentBalanceCents <= 0) throw new ScenarioEngineError("currentBalanceCents must be positive");
    const paymentAmountCents = requireCents(inputs, "paymentAmountCents");
    if (paymentAmountCents <= 0) throw new ScenarioEngineError("paymentAmountCents must be positive");
    const noteRatePct = pctInput(inputs, "noteRatePct", { min: 0, max: 100 });
    const targetYieldPct = pctInput(inputs, "targetYieldPct", { min: 0, max: 200, exclusiveMin: true });
    const remainingTermMonths = monthsInput(inputs, "remainingTermMonths");

    // The balloon pair is all-or-nothing: half a balloon is a tape error,
    // and placing it by guess would price a different note than the seller's.
    const balloonAmountCents = optionalCents(inputs, "balloonAmountCents");
    const balloonMonthRaw = inputs["balloonMonth"];
    if ((balloonAmountCents === null) !== (balloonMonthRaw === undefined)) {
      throw new ScenarioEngineError(
        "A balloon needs both its amount and the payment it falls due with — give both or neither.",
      );
    }
    const balloonMonth = balloonMonthRaw === undefined ? null : monthsInput(inputs, "balloonMonth");
    if (balloonAmountCents !== null && balloonAmountCents <= 0) {
      throw new ScenarioEngineError("balloonAmountCents must be positive");
    }

    const acquisitionCostsCents = optionalCents(inputs, "acquisitionCostsCents");
    if (acquisitionCostsCents !== null && acquisitionCostsCents < 0) {
      throw new ScenarioEngineError("acquisitionCostsCents cannot be negative");
    }

    const priced = priceForTargetYield(
      {
        currentBalanceCents,
        noteRateBps: noteRatePct * 100,
        paymentAmountCents,
        remainingTermMonths,
        balloon:
          balloonAmountCents !== null && balloonMonth !== null
            ? { amountCents: balloonAmountCents, month: balloonMonth }
            : null,
      },
      targetYieldPct * 100,
    );
    if (!priced.ok) throw new ScenarioEngineError(priced.message);

    const priceCents = priced.priceCents;
    const totalCostCents = priceCents + (acquisitionCostsCents ?? 0);
    const totalScheduledCents = Math.round(priced.totalScheduledCents);

    const assumptions: ScenarioAssumption[] = [
      {
        key: "contract_as_stated",
        value: totalScheduledCents,
        unit: "cents",
        origin: "derived",
        basis:
          "Profit is the note's scheduled contract total less total cost — every payment in full and on time, " +
          "with no defaults, prepayments or servicing costs modelled. It grades the pricing call, not a collections forecast.",
      },
    ];
    if (acquisitionCostsCents === null) {
      assumptions.push({
        key: "acquisition_costs",
        value: "excluded",
        origin: "derived",
        basis: "No acquisition costs were entered, so total cost is the purchase price alone.",
      });
    }

    return {
      normalisedInputs: {
        currentBalanceCents,
        noteRatePct,
        paymentAmountCents,
        remainingTermMonths,
        targetYieldPct,
        ...(balloonAmountCents !== null ? { balloonAmountCents } : {}),
        ...(balloonMonth !== null ? { balloonMonth } : {}),
        ...(acquisitionCostsCents !== null ? { acquisitionCostsCents } : {}),
      },
      assumptions,
      metrics: [
        metric("max_allowable_offer", priceCents),
        metric("total_cost", totalCostCents),
        metric("profit", totalScheduledCents - totalCostCents),
        // The yield at the computed price IS the target, by construction —
        // the price was solved from it. Stated, not recomputed, so the two
        // can never drift apart by rounding in a second solve.
        metric("irr", targetYieldPct / 100),
        metric("discount_to_face", 1 - priceCents / currentBalanceCents),
        metric("hold_months", priced.horizonMonths),
      ],
    };
  },
};
