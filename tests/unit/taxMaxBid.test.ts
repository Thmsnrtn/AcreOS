/**
 * V-Tax-1 T3a — the max bid derived from the rights stack. Pure. SYNTHETIC.
 *
 *   - the golden cases (shared/tax/golden/max-bid-golden.json): every line and
 *     its basis reproduced exactly; a stack that leaves nothing derives 0 and
 *     says so; a missing line refuses, naming it;
 *   - each line, missing on its own, refuses — a missing line is never zero;
 *   - "searched, none found" is a stated line, not a missing one;
 *   - a bid is flagged over the max, and says whether the max has a basis;
 *   - a typed max that no longer matches the derivation drops the basis;
 *   - triage reads the lien line from the recorded stack instead of
 *     reporting a search that was run as never run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bidAgainstMax, deriveMaxBid, isDiscarded, MAX_BID_SCREEN_LABEL, type MaxBidRecord, type RightsStackInput } from "@shared/tax/maxBid";
import { triageLot } from "@shared/tax/triage";
import { basisAfterManualMax } from "../../server/services/tax/bidDiscipline";

const golden = JSON.parse(readFileSync(path.join(__dirname, "../../shared/tax/golden/max-bid-golden.json"), "utf8")) as {
  cases: Array<{ name: string; input: RightsStackInput; expected: Record<string, unknown> }>;
};

describe("golden max-bid cases", () => {
  it("has the three cases (vacuity)", () => expect(golden.cases).toHaveLength(3));
  for (const c of golden.cases) {
    it(c.name, () => {
      const out = deriveMaxBid(c.input);
      expect(out.label).toBe(MAX_BID_SCREEN_LABEL);
      if (c.expected.status === "refused") {
        expect(out.status).toBe("refused");
        if (out.status === "refused") expect(out.missing.map((m) => m.key)).toEqual(c.expected.missingKeys);
        return;
      }
      expect(out.status).toBe("derived");
      if (out.status !== "derived") return;
      expect(out.maxBidCents).toBe(c.expected.maxBidCents);
      expect(out.leavesNothing).toBe(c.expected.leavesNothing);
      expect(out.lines.map(({ key, sign, amountCents, basis }) => ({ key, sign, amountCents, basis }))).toEqual(c.expected.lines);
    });
  }
});

const full = golden.cases[0].input;

describe("a missing line is never zero", () => {
  const cases: Array<[string, Partial<RightsStackInput>]> = [
    ["value", { value: { status: "unknown" } }],
    ["value", { value: { status: "searched_none", source: "SYNTHETIC", asOf: "2026-10-01" } }],
    ["survivingLiens", { survivingLiens: { status: "unknown" } }],
    ["otherTaxes", { otherTaxes: { status: "unknown" } }],
    ["costs", { costs: null }],
    ["requiredReturn", { requiredReturn: null }],
  ];
  for (const [key, patch] of cases) {
    it(`refuses without ${key} (${JSON.stringify(Object.values(patch)[0])})`, () => {
      const out = deriveMaxBid({ ...full, ...patch });
      expect(out.status).toBe("refused");
      if (out.status === "refused") expect(out.missing.map((m) => m.key)).toEqual([key]);
    });
  }

  it("a lien search that found none is stated, and derives", () => {
    const out = deriveMaxBid({ ...full, survivingLiens: { status: "searched_none", source: "SYNTHETIC title search #T-9", asOf: "2026-10-05" } });
    expect(out.status).toBe("derived");
    if (out.status === "derived") {
      expect(out.maxBidCents).toBe(2_060_000 + 650_000);
      expect(out.lines.find((l) => l.key === "survivingLiens")?.basis).toBe("searched, none found — SYNTHETIC title search #T-9, as of 2026-10-05");
    }
  });
});

const record = (maxBidCents: number): MaxBidRecord => ({ input: full, maxBidCents, leavesNothing: false, lines: [], recordedAt: "2026-10-29T00:00:00.000Z", recordedByUserId: "u" });

describe("a bid against the max", () => {
  it("over a derived max is flagged with how far over, and says it is derived", () => {
    expect(bidAgainstMax(2_100_000, 2_060_000, record(2_060_000))).toEqual({ status: "over", maxBidCents: 2_060_000, overByCents: 40_000, derived: true });
  });
  it("over a typed max says there is no basis", () => {
    expect(bidAgainstMax(2_100_000, 2_000_000, record(2_060_000))).toMatchObject({ status: "over", derived: false });
    expect(bidAgainstMax(2_100_000, 2_000_000, null)).toMatchObject({ status: "over", derived: false });
  });
  it("at the max is within; with no max there is nothing to flag", () => {
    expect(bidAgainstMax(2_060_000, 2_060_000, record(2_060_000))).toMatchObject({ status: "within" });
    expect(bidAgainstMax(1, null, null)).toEqual({ status: "no_max" });
  });
  it("a typed max that differs drops the basis; the same number keeps it", () => {
    expect(basisAfterManualMax(record(2_060_000), 2_060_000)).not.toBeNull();
    expect(basisAfterManualMax(record(2_060_000), 1_500_000)).toBeNull();
    expect(basisAfterManualMax(record(2_060_000), null)).toBeNull();
    expect(basisAfterManualMax(null, 1_500_000)).toBeNull();
  });
});

describe("discards", () => {
  it("a reopened discard is no longer a discard, but stays on record", () => {
    const d = { reason: "landlocked" as const, note: null, discardedAt: "x", discardedByUserId: null, priorStatus: "available", reopened: null };
    expect(isDiscarded(d)).toBe(true);
    expect(isDiscarded({ ...d, reopened: { at: "y", byUserId: null, note: null } })).toBe(false);
    expect(isDiscarded(null)).toBe(false);
  });
});

describe("triage reads the recorded lien search", () => {
  const base = { parcel: { status: "not_searched" as const, reason: "no APN" }, listMarketValueCents: null, amountOwedCents: null, redemptionPeriod: null };
  const liens = (t: ReturnType<typeof triageLot>) => t.facts.find((f) => f.key === "seniorLiens")!.state;
  it("with no stack, no lien search has been performed", () => {
    expect(liens(triageLot(base))).toEqual({ status: "unknown", reason: "no lien search has been performed" });
  });
  it("a recorded amount is known, with the operator's source", () => {
    const s = liens(triageLot({ ...base, survivingLiens: { status: "known", amountCents: 650_000, source: "SYNTHETIC title search #T-1", asOf: "2026-10-05" } }));
    expect(s).toEqual({ status: "known", value: "$6,500.00 your search says survives the sale", source: "SYNTHETIC title search #T-1, as of 2026-10-05" });
  });
  it("a search that found none is searched-none, not clean", () => {
    const t = triageLot({ ...base, survivingLiens: { status: "searched_none", source: "SYNTHETIC title search #T-9", asOf: "2026-10-05" } });
    expect(liens(t)).toMatchObject({ status: "searched_none" });
    expect(t.unknownsInOrder).toContain("seniorLiens");
  });
});
