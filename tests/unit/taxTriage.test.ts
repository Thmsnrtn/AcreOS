/**
 * V-Tax-1 T1 — triage against the ignorance map (shared/tax/triage.ts).
 *   - unknown is never clean: an unsearched senior lien is "unknown", a parcel
 *     search that found nothing is "searched, none found", and neither carries
 *     a value;
 *   - the order is weight ÷ cost rank (ties by weight), and both are on the
 *     fact, so the order can be checked;
 *   - a known fact drops out of the to-do list and keeps its source;
 *   - no cost is a dollar figure.
 */
import { describe, expect, it } from "vitest";
import { triageLot, DECISION_WEIGHT, RESOLVE_COST_RANK, TRIAGE_ORDER_BASIS } from "@shared/tax/triage";

describe("tax-lot triage", () => {
  it("an unmatched lot with nothing stated: every fact is open, cheapest high-weight first", () => {
    const t = triageLot({ parcel: { status: "searched_none", reason: "no AcreOS-held public-record parcel has this county parcel id" }, listMarketValueCents: null, amountOwedCents: null, redemptionPeriod: null });
    expect(t.facts.every((f) => f.state.status !== "known")).toBe(true);
    expect(t.facts.find((f) => f.key === "parcelMatch")!.state).toMatchObject({ status: "searched_none" });
    expect(t.facts.find((f) => f.key === "seniorLiens")!.state).toMatchObject({ status: "unknown", reason: "no lien search has been performed" });
    // Score = weight ÷ cost rank: marketValue 5÷2 = 2.5; amountOwed and
    // redemptionPeriod 4÷2 = 2 (equal weight: list order); seniorLiens 5÷3 ≈ 1.67;
    // parcelMatch and access 3÷2 = 1.5; occupancy 2÷2 = 1.
    expect(t.unknownsInOrder).toEqual(["marketValue", "amountOwed", "redemptionPeriod", "seniorLiens", "parcelMatch", "access", "occupancy"]);
    // A search that already found nothing is never told "match the parcel, free".
    expect(t.facts.find((f) => f.key === "marketValue")!.resolve).toMatchObject({ cost: "your_time" });
    const score = (k: string) => { const f = t.facts.find((x) => x.key === k)!; return f.weight / RESOLVE_COST_RANK[f.resolve!.cost]; };
    for (let i = 1; i < t.unknownsInOrder.length; i++) expect(score(t.unknownsInOrder[i - 1])).toBeGreaterThanOrEqual(score(t.unknownsInOrder[i]));
    expect(t.facts.map((f) => f.weight)).toEqual(t.facts.map((f) => DECISION_WEIGHT[f.key]));
  });

  it("known facts drop out of the to-do list and keep their source; a matched parcel's missing value costs an outside valuation", () => {
    const t = triageLot({ parcel: { status: "matched", marketValueCents: null, valueSource: "SYNTHETIC roll" }, listMarketValueCents: null, amountOwedCents: 481250, redemptionPeriod: { months: 6, source: "SYNTHETIC county sale notice" } });
    expect(t.facts.find((f) => f.key === "amountOwed")).toMatchObject({ state: { status: "known", value: "$4,812.50", source: "the tax list" }, resolve: null });
    expect(t.facts.find((f) => f.key === "redemptionPeriod")).toMatchObject({ state: { status: "known", value: "6 months", source: "SYNTHETIC county sale notice" } });
    expect(t.unknownsInOrder).not.toContain("amountOwed");
    expect(t.unknownsInOrder).not.toContain("parcelMatch");
    expect(t.facts.find((f) => f.key === "marketValue")!.resolve).toEqual({ how: "get a valuation (comparable sales or an appraisal)", cost: "paid_outside" });
  });

  it("a matched parcel with a public-record value is known from that record", () => {
    const t = triageLot({ parcel: { status: "matched", marketValueCents: 15000000, valueSource: "SYNTHETIC roll" }, listMarketValueCents: null, amountOwedCents: null, redemptionPeriod: null });
    expect(t.facts.find((f) => f.key === "marketValue")!.state).toEqual({ status: "known", value: "$150,000.00", source: "SYNTHETIC roll" });
  });

  it("no resolve cost is a dollar figure, and the order says it is a screen", () => {
    const t = triageLot({ parcel: { status: "not_searched", reason: "no APN" }, listMarketValueCents: null, amountOwedCents: null, redemptionPeriod: null });
    for (const f of t.facts) expect(JSON.stringify(f.resolve)).not.toMatch(/\$/);
    expect(TRIAGE_ORDER_BASIS).toMatch(/not a measurement/);
  });
});
