import { describe, it, expect } from "vitest";
import {
  parseCountyInput,
  parseCountyList,
  compareTargets,
  countySlugFromLabel,
} from "../../server/services/autopilot/growthTargets";

describe("countySlugFromLabel", () => {
  it("strips 'county', lowercases, hyphenates", () => {
    expect(countySlugFromLabel("Travis County")).toBe("travis");
    expect(countySlugFromLabel("St. Lucie")).toBe("st-lucie");
    expect(countySlugFromLabel("DeKalb")).toBe("dekalb");
  });
});

describe("parseCountyInput — tolerant founder county parsing", () => {
  it("parses ST/County", () => {
    expect(parseCountyInput("TX/Travis")).toEqual({ state: "TX", countySlug: "travis", countyLabel: "Travis" });
  });
  it("parses County, ST", () => {
    expect(parseCountyInput("Travis, TX")).toEqual({ state: "TX", countySlug: "travis", countyLabel: "Travis" });
  });
  it("parses 'ST County' and 'County County ST'", () => {
    expect(parseCountyInput("TX Travis")).toEqual({ state: "TX", countySlug: "travis", countyLabel: "Travis" });
    expect(parseCountyInput("Travis County TX")).toEqual({ state: "TX", countySlug: "travis", countyLabel: "Travis" });
  });
  it("uppercases the state and title-cases the label", () => {
    expect(parseCountyInput("fl/st. lucie")).toEqual({ state: "FL", countySlug: "st-lucie", countyLabel: "St Lucie" });
  });
  it("returns null on garbage / missing state", () => {
    expect(parseCountyInput("")).toBeNull();
    expect(parseCountyInput("Travis")).toBeNull();
    expect(parseCountyInput("   ")).toBeNull();
  });
});

describe("parseCountyList — multi-line + dedupe", () => {
  it("parses a newline list and dedupes", () => {
    const out = parseCountyList("TX/Travis\nFL, St. Lucie\nTX/Travis\nbad-line");
    expect(out).toEqual([
      { state: "TX", countySlug: "travis", countyLabel: "Travis" },
      { state: "FL", countySlug: "st-lucie", countyLabel: "St Lucie" },
    ]);
  });
});

describe("compareTargets — selection ordering", () => {
  it("higher demand wins; ties break to earliest id (seed order)", () => {
    const a = { demandScore: 0, id: 1 };
    const b = { demandScore: 0, id: 2 };
    const c = { demandScore: 5, id: 9 };
    expect([b, c, a].sort(compareTargets)).toEqual([c, a, b]); // demand first, then id asc
  });
  it("cold-start (all zero demand) is pure FIFO seed order", () => {
    const rows = [{ demandScore: 0, id: 3 }, { demandScore: 0, id: 1 }, { demandScore: 0, id: 2 }];
    expect(rows.sort(compareTargets).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
