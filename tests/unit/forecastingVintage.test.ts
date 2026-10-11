/**
 * Vintages: a value as known on a date, never overwritten.
 *
 * The backtest is only honest if `asKnownOn` hides what was published later,
 * and the store is only a vintage store if `revisionsToRecord` never edits.
 */
import { describe, expect, it } from "vitest";
import { asKnownOn, revisionsToRecord, addMonths, monthsBetween, type VintageRow } from "../../shared/forecasting/vintage";

const rows: VintageRow[] = [
  { seriesId: "TNNA", observationDate: "2020-01-01", vintageDate: "2020-02-20", value: 100 },
  { seriesId: "TNNA", observationDate: "2020-02-01", vintageDate: "2020-03-20", value: 101 },
  // A revision, published later, of January.
  { seriesId: "TNNA", observationDate: "2020-01-01", vintageDate: "2021-03-15", value: 98 },
  { seriesId: "TXNA", observationDate: "2020-01-01", vintageDate: "2020-02-20", value: 500 },
];

describe("asKnownOn", () => {
  it("returns what was published by the date, and nothing later", () => {
    const k = asKnownOn(rows, "2020-03-01");
    expect(k.get("TNNA")).toEqual([{ date: "2020-01-01", value: 100 }]);
    expect(k.get("TXNA")).toEqual([{ date: "2020-01-01", value: 500 }]);
  });
  it("a revision replaces the value only from its own vintage date on", () => {
    expect(asKnownOn(rows, "2021-03-14").get("TNNA")?.[0].value).toBe(100);
    expect(asKnownOn(rows, "2021-03-15").get("TNNA")?.[0].value).toBe(98);
  });
  it("before anything was published there is nothing", () => {
    expect(asKnownOn(rows, "2020-01-01").size).toBe(0);
  });
  it("refuses a malformed date rather than guessing", () => {
    expect(() => asKnownOn(rows, "March 2020")).toThrow(/YYYY-MM-DD/);
  });
});

describe("revisionsToRecord — append-only", () => {
  it("appends new observations and changed values; skips unchanged ones", () => {
    const fresh = [
      { seriesId: "TNNA", observationDate: "2020-01-01", value: 98 }, // unchanged since 2021-03-15
      { seriesId: "TNNA", observationDate: "2020-02-01", value: 102 }, // revised
      { seriesId: "TNNA", observationDate: "2020-03-01", value: 103 }, // new
    ];
    const out = revisionsToRecord(rows, fresh, "2021-06-01");
    expect(out).toEqual([
      { seriesId: "TNNA", observationDate: "2020-02-01", vintageDate: "2021-06-01", value: 102 },
      { seriesId: "TNNA", observationDate: "2020-03-01", vintageDate: "2021-06-01", value: 103 },
    ]);
  });
  it("never produces a row at or before an existing vintage for the same observation (no edits of the past)", () => {
    const out = revisionsToRecord(rows, [{ seriesId: "TNNA", observationDate: "2020-01-01", value: 1 }], "2021-03-15");
    expect(out).toEqual([]);
  });
  it("skips non-finite values instead of recording them", () => {
    expect(revisionsToRecord([], [{ seriesId: "X", observationDate: "2020-01-01", value: Number.NaN }], "2021-01-01")).toEqual([]);
  });
});

describe("month arithmetic", () => {
  it("crosses year boundaries both ways", () => {
    expect(addMonths("2020-11-01", 3)).toBe("2021-02-01");
    expect(addMonths("2020-02-01", -3)).toBe("2019-11-01");
    expect(monthsBetween("2019-11-01", "2021-02-01")).toBe(15);
  });
});
