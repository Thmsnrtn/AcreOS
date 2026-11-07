/**
 * Note pricing engine (shared/calculators/notePricing.ts) and its registered
 * adapter (server/services/economics/engines/notePricing.ts).
 *
 * Every expected number below is HAND-COMPUTED from the stated conventions
 * (arithmetic in the comments) and was cross-checked with independent Python
 * Decimal arithmetic, not with this engine. Case D reproduces Notes V2 Leg 2's
 * own golden case (#461, shared/notes/golden/workout-golden.expected.json),
 * which was computed independently of both engines.
 */
import { describe, expect, it } from "vitest";
import { priceNote, type NoteFact, type NotePricingInputs } from "../../shared/calculators/notePricing";
import { recordedField, type ObservationView } from "../../shared/provenance/fieldRecord";
import { notePricingEngine } from "../../server/services/economics/engines/notePricing";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { ScenarioEngineError, metricById } from "../../shared/economics/scenario";
import { BUSINESS_TYPE_IDS } from "../../shared/business-types";

const inp = (v: number | string): NoteFact => ({ kind: "input", value: v });

function note(over: Partial<NotePricingInputs["facts"]> = {}, stated: Partial<NotePricingInputs["stated"]> = {}): NotePricingInputs {
  return {
    facts: {
      upbCents: inp(100_000),
      noteRateBps: inp(1200),
      paymentCents: inp(50_751),
      remainingTermMonths: inp(2),
      status: inp("performing"),
      collateralValueCents: inp(200_000),
      lienPosition: inp(1),
      ...over,
    },
    stated: { targetYieldBps: 2400, servicingMonthlyCents: 1000, acquisitionCostsCents: 1500, ...stated },
  };
}

const val = (l: { status: string; value?: number }) => (l.status === "computed" ? l.value : `refused`);

describe("hand-computed cases (table-driven)", () => {
  it("A — zero-rate note, 3 periods, no servicing, 12% target", () => {
    // payments 1,000.00 × 3; df = 1/1.01^t
    // t1 100000/1.01     = 99009.90 → 99010
    // t2 100000/1.0201   = 98029.60 → 98030
    // t3 100000/1.030301 = 97059.01 → 97059      yield price = 294,099
    // costs 0 → max bid 294,099; discount 5,901 / 300,000 = 0.01967; profit 300,000 − 294,099 = 5,901
    const r = priceNote(note({ upbCents: inp(300_000), noteRateBps: inp(0), paymentCents: inp(100_000), remainingTermMonths: inp(3) }, { targetYieldBps: 1200, servicingMonthlyCents: 0, acquisitionCostsCents: 0 }));
    expect(r.schedule!.map((l) => l.discountedCents)).toEqual([99_010, 98_030, 97_059]);
    expect(val(r.lines.yieldPrice)).toBe(294_099);
    expect(val(r.lines.maxBid)).toBe(294_099);
    expect(r.lines.discountToUpb.status === "computed" && r.lines.discountToUpb.value).toBeCloseTo(5_901 / 300_000, 12);
    expect(val(r.lines.totalCost)).toBe(294_099);
    expect(val(r.lines.profitIfPerforming)).toBe(5_901);
  });

  it("B — amortizing 2-period note, servicing and costs, no cap: the yield binds", () => {
    // t1 interest 100000×1200/10000/12 = 1000; pay 50751; principal 49751; bal 50249; net 50751−1000 = 49751
    //    49751/1.02   = 48775.49 → 48775
    // t2 interest 50249×0.01 = 502.49 → 502; due 50751 (last period pays it all); net 49751
    //    49751/1.0404 = 47819.11 → 47819          yield price = 96,594
    // max bid 96,594 − 1,500 = 95,094; discount 4,906/100,000; LTV 100,000/200,000 = 0.5;
    // ITV 95,094/200,000 = 0.47547; total 96,594; profit (49,751×2 = 99,502) − 96,594 = 2,908
    const r = priceNote(note());
    expect(r.schedule!.map((l) => [l.interestCents, l.paymentCents, l.netCents, l.discountedCents])).toEqual([
      [1000, 50_751, 49_751, 48_775],
      [502, 50_751, 49_751, 47_819],
    ]);
    expect(val(r.lines.yieldPrice)).toBe(96_594);
    expect(r.lines.maxBid).toMatchObject({ status: "computed", value: 95_094, binding: "yield" });
    expect(r.lines.discountToUpb.status === "computed" && r.lines.discountToUpb.value).toBeCloseTo(0.04906, 12);
    expect(r.lines.ltv.status === "computed" && r.lines.ltv.value).toBe(0.5);
    expect(r.lines.itv.status === "computed" && r.lines.itv.value).toBeCloseTo(0.47547, 12);
    expect(val(r.lines.totalCost)).toBe(96_594);
    expect(val(r.lines.profitIfPerforming)).toBe(2_908);
  });

  it("C — same note, stated 40% max ITV: the cap binds", () => {
    // cap = floor(4000 × 200,000 / 10,000) − 0 = 80,000 < 95,094 → max bid 80,000
    // discount 0.2; ITV 0.4; total 81,500; profit 99,502 − 81,500 = 18,002
    const r = priceNote(note({}, { maxItvBps: 4000 }));
    expect(r.lines.maxBid).toMatchObject({ status: "computed", value: 80_000, binding: "itv_cap" });
    expect(r.lines.discountToUpb.status === "computed" && r.lines.discountToUpb.value).toBeCloseTo(0.2, 12);
    expect(r.lines.itv.status === "computed" && r.lines.itv.value).toBeCloseTo(0.4, 12);
    expect(val(r.lines.totalCost)).toBe(81_500);
    expect(val(r.lines.profitIfPerforming)).toBe(18_002);
  });

  it("C2 — a second lien: LTV and ITV are combined with the senior balance", () => {
    // CLTV (60,000 + 100,000)/200,000 = 0.8; cap = 80,000 − 60,000 = 20,000 → max bid 20,000
    // combined ITV (60,000 + 20,000)/200,000 = 0.4; total 21,500; profit 99,502 − 21,500 = 78,002
    const r = priceNote(note({ lienPosition: inp(2), seniorLienBalanceCents: inp(60_000) }, { maxItvBps: 4000 }));
    expect(r.lines.ltv.status === "computed" && r.lines.ltv.value).toBeCloseTo(0.8, 12);
    expect(r.lines.maxBid).toMatchObject({ status: "computed", value: 20_000, binding: "itv_cap" });
    expect(r.lines.itv.status === "computed" && r.lines.itv.value).toBeCloseTo(0.4, 12);
    expect(val(r.lines.profitIfPerforming)).toBe(78_002);
  });

  it("D — reproduces #461's independent golden hold/perform case, without its arrears", () => {
    // #461 golden: UPB 10,000.00, 9%, payment 874.53, 12 months, servicing 25.00, discount 12%.
    // Its hold/perform lines 2..12 are taken verbatim from workout-golden.expected.json.
    // Line 1 there includes 1,749.06 arrears; without them: (87,453 − 2,500)/1.01 = 84,111.88 → 84,112.
    // 1,129,310 (golden NPV) − 257,286 (golden line 1) + 84,112 = 956,136
    const r = priceNote(note(
      { upbCents: inp(1_000_000), noteRateBps: inp(900), paymentCents: inp(87_453), remainingTermMonths: inp(12) },
      { targetYieldBps: 1200, servicingMonthlyCents: 2500, acquisitionCostsCents: 0 },
    ));
    expect(r.schedule!.map((l) => l.discountedCents)).toEqual([84_112, 83_279, 82_455, 81_638, 80_830, 80_030, 79_237, 78_453, 77_676, 76_907, 76_145, 75_374]);
    expect(val(r.lines.yieldPrice)).toBe(956_136);
  });

  it("E — at a target yield equal to the note rate and no servicing, the price is the balance", () => {
    // Property, checked with Decimal arithmetic: this schedule's discounted lines sum to exactly 1,000,000.
    const r = priceNote(note(
      { upbCents: inp(1_000_000), noteRateBps: inp(900), paymentCents: inp(87_453), remainingTermMonths: inp(12) },
      { targetYieldBps: 900, servicingMonthlyCents: 0, acquisitionCostsCents: 0 },
    ));
    expect(val(r.lines.yieldPrice)).toBe(1_000_000);
    expect(r.lines.discountToUpb.status === "computed" && r.lines.discountToUpb.value).toBe(0);
  });

  it("the yield price is the sum of its rounded discounted lines", () => {
    const r = priceNote(note());
    expect(r.schedule!.reduce((a, l) => a + l.discountedCents, 0)).toBe(val(r.lines.yieldPrice));
  });

  it("a max bid at or below zero is still computed — and says pass", () => {
    const r = priceNote(note({}, { acquisitionCostsCents: 200_000 }));
    expect(r.lines.maxBid).toMatchObject({ status: "computed", value: 96_594 - 200_000 });
    expect(r.lines.maxBid.status === "computed" && r.lines.maxBid.basis).toMatch(/no positive price/);
  });
});

describe("refuse per line — never default", () => {
  const refusedInputs = (l: { status: string; refusals?: Array<{ input: string }> }) => (l.status === "refused" ? l.refusals!.map((x) => x.input) : []);

  it.each([
    ["upbCents", "Unpaid principal balance"],
    ["noteRateBps", "Note rate"],
    ["paymentCents", "Scheduled payment (P&I)"],
    ["remainingTermMonths", "Remaining term (months)"],
    ["status", "Payment status"],
  ] as const)("a missing %s refuses the price lines by name; LTV still computes when its own inputs are there", (key, label) => {
    const r = priceNote(note({ [key]: null }));
    for (const line of ["yieldPrice", "maxBid", "discountToUpb", "itv", "totalCost", "profitIfPerforming"] as const) {
      expect(refusedInputs(r.lines[line]), line).toContain(label);
    }
    if (key !== "upbCents") expect(r.lines.ltv.status).toBe("computed");
  });

  it.each([
    ["targetYieldBps", "Target yield"],
    ["servicingMonthlyCents", "Servicing cost per month"],
  ] as const)("an unstated %s refuses the price — no default yield or servicing cost", (key, label) => {
    const r = priceNote(note({}, { [key]: null }));
    expect(r.lines.yieldPrice.status).toBe("refused");
    expect(refusedInputs(r.lines.yieldPrice)).toEqual([label]);
    expect(r.lines.yieldPrice.status === "refused" && r.lines.yieldPrice.refusals[0].reason).toMatch(/no default/);
    expect(r.lines.ltv.status).toBe("computed");
  });

  it("unstated acquisition costs refuse the bid lines but not the yield price", () => {
    const r = priceNote(note({}, { acquisitionCostsCents: null }));
    expect(val(r.lines.yieldPrice)).toBe(96_594);
    for (const line of ["maxBid", "discountToUpb", "itv", "totalCost", "profitIfPerforming"] as const) {
      expect(refusedInputs(r.lines[line])).toContain("Acquisition costs (closing, diligence)");
    }
  });

  it("no collateral value: LTV and ITV refuse, the uncapped bid still computes", () => {
    const r = priceNote(note({ collateralValueCents: null }));
    expect(refusedInputs(r.lines.ltv)).toEqual(["Collateral value"]);
    expect(refusedInputs(r.lines.itv)).toEqual(["Collateral value"]);
    expect(r.lines.maxBid).toMatchObject({ status: "computed", value: 95_094 });
  });

  it("a STATED max ITV that cannot be applied refuses the bid — it is never silently dropped", () => {
    for (const over of [{ collateralValueCents: null }, { lienPosition: null }, { lienPosition: inp(2) }]) {
      const r = priceNote(note(over, { maxItvBps: 4000 }));
      expect(r.lines.maxBid.status, JSON.stringify(over)).toBe("refused");
      expect(refusedInputs(r.lines.maxBid)).toContain("Maximum ITV");
      expect(r.lines.totalCost.status).toBe("refused");
    }
  });

  it("no lien position: LTV refuses (a junior lien's LTV would be understated)", () => {
    expect(refusedInputs(priceNote(note({ lienPosition: null })).lines.ltv)).toEqual(["Lien position"]);
  });

  it.each(["late", "default", "paid_off", "sold", "mystery"])("status %s refuses the yield price by name", (status) => {
    const r = priceNote(note({ status: inp(status) }));
    expect(refusedInputs(r.lines.yieldPrice)).toEqual(["Payment status"]);
  });

  it("'performing' with days delinquent above zero contradicts itself and refuses", () => {
    const r = priceNote(note({ daysDelinquent: inp(31) }));
    expect(r.lines.yieldPrice.status === "refused" && r.lines.yieldPrice.refusals[0].reason).toMatch(/disagrees with itself/);
    expect(priceNote(note({ daysDelinquent: inp(0) })).lines.yieldPrice.status).toBe("computed");
  });

  it("malformed values refuse rather than coerce", () => {
    expect(priceNote(note({ upbCents: inp(1000.5) })).lines.yieldPrice.status).toBe("refused");
    expect(priceNote(note({ upbCents: inp("100000") })).lines.yieldPrice.status).toBe("refused");
    expect(priceNote(note({}, { targetYieldBps: 12.5 })).lines.yieldPrice.status).toBe("refused");
  });
});

describe("provenance — the note record's per-field record is consumed, not re-derived", () => {
  const obs = (value: unknown, fileName: string, fileRow: number): ObservationView => ({
    value,
    kind: "value",
    source: "note_tape",
    sourceRef: { fileName, fileRow, column: "UPB" },
    asOf: "2026-10-01",
    confidence: "medium",
    basis: "stated on the seller's tape",
    decayClass: "months",
    observedAt: "2026-10-27T00:00:00.000Z",
  });

  it("a recorded value carries its tape file, row, column and as-of into the inputs", () => {
    const rec = recordedField("currentBalance", "Unpaid principal balance", 100_000, [obs(100_000, "tape-a.csv", 4)]);
    const r = priceNote(note({ upbCents: { kind: "recorded", record: rec } }));
    expect(val(r.lines.yieldPrice)).toBe(96_594);
    const upb = r.inputs.find((i) => i.key === "upbCents")!;
    expect(upb).toMatchObject({ basis: "recorded", value: 100_000 });
    expect(upb.source).toBe('note_tape (tape-a.csv, row 4, column "UPB"), as of 2026-10-01, medium confidence');
  });

  it("sources that DISAGREE refuse the lines that need the field, listing every value and source", () => {
    const rec = recordedField("currentBalance", "Unpaid principal balance", 100_000, [obs(100_000, "tape-a.csv", 4), obs(98_000, "tape-b.csv", 2)]);
    const r = priceNote(note({ upbCents: { kind: "recorded", record: rec } }));
    expect(r.lines.yieldPrice.status).toBe("refused");
    const reason = r.lines.yieldPrice.status === "refused" ? r.lines.yieldPrice.refusals[0].reason : "";
    expect(reason).toMatch(/sources disagree/);
    expect(reason).toContain("$1,000.00");
    expect(reason).toContain("$980.00");
    expect(reason).toContain("tape-b.csv");
  });

  it("an absent recorded value says why (blank on the tape vs never stated)", () => {
    const blank: ObservationView = { ...obs(null, "tape-a.csv", 4), kind: "searched_none", sourceRef: { fileName: "tape-a.csv", column: "Rem Term" } };
    const r1 = priceNote(note({ remainingTermMonths: { kind: "recorded", record: recordedField("remainingTermMonths", "Remaining term", null, [blank]) } }));
    expect(r1.lines.yieldPrice.status === "refused" && r1.lines.yieldPrice.refusals[0].reason).toMatch(/blank on tape-a\.csv \(column "Rem Term"\)/);
    const r2 = priceNote(note({ remainingTermMonths: { kind: "recorded", record: recordedField("remainingTermMonths", "Remaining term", null, []) } }));
    expect(r2.lines.yieldPrice.status === "refused" && r2.lines.yieldPrice.refusals[0].reason).toMatch(/no import has stated it/);
  });

  it("operator-stated facts and judgements are labelled as the operator's", () => {
    const r = priceNote(note({ lienPosition: { kind: "stated", value: 1, note: "title commitment reviewed" } }, { maxItvBps: 4000 }));
    expect(r.inputs.find((i) => i.key === "lienPosition")).toMatchObject({ basis: "operator_stated", source: "stated by the operator: title commitment reviewed" });
    expect(r.stated.map((x) => [x.key, x.statedBy])).toEqual([
      ["targetYieldBps", "operator"],
      ["servicingMonthlyCents", "operator"],
      ["acquisitionCostsCents", "operator"],
      ["maxItvBps", "operator"],
    ]);
  });

  it("is deterministic", () => {
    expect(priceNote(note({}, { maxItvBps: 4000 }))).toEqual(priceNote(note({}, { maxItvBps: 4000 })));
  });
});

describe("the registered engine (EngineSpec adapter)", () => {
  const WIRE = {
    upbCents: 100_000, noteRateBps: 1200, paymentCents: 50_751, remainingTermMonths: 2, status: "performing",
    collateralValueCents: 200_000, lienPosition: 1, targetYieldBps: 2400, servicingMonthlyCents: 1000, acquisitionCostsCents: 1500, maxItvBps: 4000,
  };

  it("is registered once, declares note_investor only, and speaks the registered vocabulary", () => {
    expect(ALL_ENGINES.filter((e) => e.id === "note_pricing")).toEqual([notePricingEngine]);
    expect(notePricingEngine.verticals).toEqual(["note_investor"]);
    expect(BUSINESS_TYPE_IDS).toContain("note_investor");
    for (const id of notePricingEngine.produces) expect(metricById(id), id).toBeDefined();
    // Gradeable: predicts what the outcome loop measures.
    expect(notePricingEngine.produces).toEqual(expect.arrayContaining(["total_cost", "profit"]));
  });

  it("maps case C onto the metrics and declares stated vs derived assumptions", () => {
    const out = notePricingEngine.compute(WIRE);
    expect(Object.fromEntries(out.metrics.map((m) => [m.id, m.value]))).toEqual({
      max_allowable_offer: 80_000, discount_to_face: 0.2, total_cost: 81_500, profit: 18_002,
    });
    const a = Object.fromEntries((out.assumptions ?? []).map((x) => [x.key, x]));
    expect(a.targetYieldBps).toMatchObject({ value: 2400, origin: "user" });
    expect(a.acquisitionCostsCents).toMatchObject({ value: 1500, origin: "user" });
    expect(a.yield_price).toMatchObject({ value: 96_594, origin: "derived" });
    expect(a.binding_constraint).toMatchObject({ value: "itv_cap", origin: "derived" });
    expect(a.ltv).toMatchObject({ value: 0.5, origin: "derived" });
    expect(out.normalisedInputs).toEqual(WIRE);
  });

  it("refuses the scenario by name when a price input is missing — never computes with a default", () => {
    for (const key of ["targetYieldBps", "servicingMonthlyCents", "acquisitionCostsCents", "upbCents", "status"]) {
      const { [key]: _drop, ...rest } = WIRE as Record<string, number | string>;
      expect(() => notePricingEngine.compute(rest), key).toThrow(ScenarioEngineError);
    }
    expect(() => notePricingEngine.compute({ ...WIRE, targetYieldBps: undefined as never })).toThrow(/Target yield: not stated/);
  });

  it("a refused LTV is recorded as not computed, without refusing the scenario", () => {
    const { collateralValueCents: _c, maxItvBps: _m, ...rest } = WIRE;
    const out = notePricingEngine.compute(rest);
    expect(out.assumptions?.find((x) => x.key === "ltv")).toMatchObject({ value: "not computed" });
    expect(out.metrics.find((m) => m.id === "max_allowable_offer")?.value).toBe(95_094);
  });
});
