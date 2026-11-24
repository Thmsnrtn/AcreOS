/**
 * The tax max-bid engine (`tax_max_bid`) — Step 0 items T4+T5.
 *
 * FALSIFYING: on pre-slice main this file fails to import (the engine does
 * not exist), no engine declares `tax_lien_deed`, and the kit's ownership
 * guard refuses every tax_lien_deed decision.
 *
 * Proves:
 *   - the max bid is the shared rights-stack screen's derivation
 *     (`deriveMaxBid` in shared/tax/maxBid.ts), presented in the shared
 *     metric vocabulary — the engine delegates, it does not re-derive;
 *   - a hand-computed stack lands on the exact cent, in both return forms;
 *   - it predicts `total_cost` and `profit`, which is what makes a decision
 *     under it gradeable (evidence rule v2) — and at the max bid the
 *     predicted profit IS the operator's required return;
 *   - a $0 liens/taxes line freezes as "searched, none found", the reading
 *     the pure function gives it — never as a silently assumed zero;
 *   - a stack that leaves nothing reports max bid $0 and a negative
 *     profit rather than refusing: "no bid makes your return" is an
 *     answer, and the pass recorded against it is gradeable;
 *   - both-or-neither required return, a missing stack line and a
 *     negative line are all refused;
 *   - the engine is registered properly: in ALL_ENGINES, declaring
 *     tax_lien_deed, and the kit preview runs it under that declaration.
 */
import { describe, expect, it } from "vitest";
import { computeScenario, engineById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { taxMaxBidEngine } from "../../server/services/economics/engines/taxMaxBid";
import { deriveMaxBid } from "../../shared/tax/maxBid";
import { previewUnderwriting } from "../../server/services/underwriting/verticalDecision";
import { TAX_MAX_BID_FIELDS } from "../../shared/economics/fields/taxMaxBid";
import { wireInputs } from "../../shared/economics/engineFields";

/** A $50,000 lot: $5,000 surviving liens, $2,000 other taxes, $3,000 costs, $10,000 required return. */
const stack = {
  lotValueCents: 5_000_000,
  survivingLiensCents: 500_000,
  otherTaxesCents: 200_000,
  clearAndHoldCostsCents: 300_000,
  requiredReturnCents: 1_000_000,
};

const body = (inputs: Record<string, number>) =>
  computeScenario({ subjectType: "property", subjectId: 1, label: "t", engineId: "tax_max_bid", inputs }, ALL_ENGINES);
const metric = (inputs: Record<string, number>, id: string) => body(inputs).metrics.find((m) => m.id === id)?.value;

describe("the arithmetic", () => {
  it("derives the hand-computed max bid to the exact cent", () => {
    // $50,000 − $5,000 − $2,000 − $3,000 − $10,000 = $30,000.
    expect(metric(stack, "max_allowable_offer")).toBe(3_000_000);
    // All-in at that bid: $30,000 + $5,000 + $2,000 + $3,000 = $40,000.
    expect(metric(stack, "total_cost")).toBe(4_000_000);
    // $50,000 − $40,000 = the $10,000 required return, by construction.
    expect(metric(stack, "profit")).toBe(1_000_000);
  });

  it("delegates to the shared rights-stack screen — same max bid, to the cent", () => {
    const direct = deriveMaxBid({
      value: { status: "known", amountCents: 5_000_000, source: "s", asOf: "d" },
      survivingLiens: { status: "known", amountCents: 500_000, source: "s", asOf: "d" },
      otherTaxes: { status: "known", amountCents: 200_000, source: "s", asOf: "d" },
      costs: [{ label: "c", amountCents: 300_000, source: "s" }],
      requiredReturn: { kind: "cents", amountCents: 1_000_000 },
    });
    expect(direct.status).toBe("derived");
    if (direct.status !== "derived") throw new Error("fixture must derive");
    expect(metric(stack, "max_allowable_offer")).toBe(direct.maxBidCents);
  });

  it("the percentage return form lands on the same stack", () => {
    const { requiredReturnCents: _drop, ...noReturn } = stack;
    // 20% of the $50,000 value is the same $10,000 return.
    const pct = { ...noReturn, requiredReturnPct: 20 };
    expect(metric(pct, "max_allowable_offer")).toBe(3_000_000);
    expect(metric(pct, "profit")).toBe(1_000_000);
  });

  it("a $0 line freezes as searched-none, with its line stated on the scenario", () => {
    const searched = { ...stack, survivingLiensCents: 0, otherTaxesCents: 0 };
    expect(metric(searched, "max_allowable_offer")).toBe(3_700_000);
    const liens = body(searched).assumptions.find((a) => a.key === "stack_survivingLiens");
    expect(liens?.value).toBe(0);
    expect(liens?.basis).toContain("searched, none found");
    // The screen's own honesty label is frozen on every scenario.
    expect(body(searched).assumptions.find((a) => a.key === "bid_screen")?.basis).toContain("not an appraisal");
  });

  it("a stack that leaves nothing reports $0 and a negative profit — it does not refuse", () => {
    const underwater = {
      lotValueCents: 1_000_000, // $10,000
      survivingLiensCents: 800_000,
      otherTaxesCents: 100_000,
      clearAndHoldCostsCents: 200_000,
      requiredReturnCents: 500_000,
    };
    expect(metric(underwater, "max_allowable_offer")).toBe(0);
    expect(metric(underwater, "total_cost")).toBe(1_100_000);
    expect(metric(underwater, "profit")).toBe(-100_000);
    expect(body(underwater).assumptions.find((a) => a.key === "leaves_nothing")?.value).toBe("yes");
  });
});

describe("refusals — never a guessed number", () => {
  it.each([
    ["both return forms", { ...stack, requiredReturnPct: 20 }],
    ["a negative stack line", { ...stack, survivingLiensCents: -1 }],
    ["a return percentage past 100", { lotValueCents: 5_000_000, survivingLiensCents: 0, otherTaxesCents: 0, clearAndHoldCostsCents: 0, requiredReturnPct: 101 }],
    ["no value", { ...stack, lotValueCents: 0 }],
  ])("refuses %s", (_label, inputs) => {
    expect(() => body(inputs)).toThrow(ScenarioEngineError);
  });

  it("refuses a missing stack line rather than treating it as zero", () => {
    const { survivingLiensCents: _drop, ...noLiens } = stack;
    expect(() => body(noLiens)).toThrow(ScenarioEngineError);
  });

  it("refuses no required return at all", () => {
    const { requiredReturnCents: _drop, ...noReturn } = stack;
    expect(() => body(noReturn)).toThrow(ScenarioEngineError);
  });
});

describe("registration and the kit", () => {
  it("is in ALL_ENGINES, declaring tax_lien_deed and predicting gradeable metrics", () => {
    const found = engineById("tax_max_bid", ALL_ENGINES);
    expect(found).toBe(taxMaxBidEngine);
    expect(found?.verticals).toEqual(["tax_lien_deed"]);
    expect(found?.produces).toEqual(expect.arrayContaining(["total_cost", "profit"]));
  });

  it("the kit preview runs it — what the desk shows is what gets frozen", () => {
    const preview = previewUnderwriting("tax_max_bid", stack);
    expect(preview.engineVersion).toBe(taxMaxBidEngine.version);
    expect(preview.metrics.find((m) => m.id === "max_allowable_offer")?.value).toBe(3_000_000);
  });

  it("the desk's field set wires into exactly the inputs the engine consumes", () => {
    const typed: Record<string, string> = {
      lotValueCents: "50000",
      survivingLiensCents: "5000",
      otherTaxesCents: "2000",
      clearAndHoldCostsCents: "3000",
      requiredReturnCents: "10000",
    };
    const { inputs, missing } = wireInputs(TAX_MAX_BID_FIELDS, typed);
    expect(missing).toEqual([]);
    expect(inputs).toEqual(stack);
    expect(metric(inputs, "max_allowable_offer")).toBe(3_000_000);
  });
});
