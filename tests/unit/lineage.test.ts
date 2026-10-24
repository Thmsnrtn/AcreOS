/**
 * D2c — lineage classifier edges the golden file does not carry: refusal on
 * duplicate ids, id normalization, unusable geometry, holes, the threshold
 * parameter actually being read, scale, and the inheritance rules.
 */
import { describe, expect, it } from "vitest";
import {
  classifyLineage,
  inheritanceFor,
  INHERITANCE_RULES,
  LINEAGE_THRESHOLDS,
  type LineageEvent,
  type LineageGeometry,
  type LineageKind,
  type LngLat,
} from "../../shared/landData/lineage";

const U = 0.0001;
const LNG0 = -82.25;
const LAT0 = 29.5;
const ring = (x0: number, y0: number, x1: number, y1: number): LngLat[] => {
  const p = (x: number, y: number): LngLat => [LNG0 + x * U, LAT0 + y * U];
  return [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1), p(x0, y0)];
};
const rect = (x0: number, y0: number, x1: number, y1: number): LineageGeometry => ({ type: "Polygon", coordinates: [ring(x0, y0, x1, y1)] });
const rec = (sourceId: string, geometry: LineageGeometry | null) => ({ sourceId, geometry });

function events(previous: ReturnType<typeof rec>[], next: ReturnType<typeof rec>[], t = LINEAGE_THRESHOLDS): LineageEvent[] {
  const r = classifyLineage({ previous, next }, t);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.events;
}

describe("classifyLineage — refusals and normalization", () => {
  it("refuses a release that lists one id twice (never picks one)", () => {
    const r = classifyLineage({ previous: [rec("SYNTHETIC-A", rect(0, 0, 10, 10)), rec(" synthetic-a ", rect(20, 0, 30, 10))], next: [] });
    expect(r).toEqual({ ok: false, reason: "duplicate_source_id", side: "previous", ids: ["SYNTHETIC-A"] });
    const r2 = classifyLineage({ previous: [], next: [rec("SYNTHETIC-B", null), rec("SYNTHETIC-B", null)] });
    expect(r2.ok).toBe(false);
  });

  it("ids are compared after the crosswalk's normalization", () => {
    const e = events([rec("synthetic  12-a ", rect(0, 0, 10, 10))], [rec("SYNTHETIC 12-A", rect(0, 0, 10, 10))]);
    expect(e.map((x) => x.kind)).toEqual(["same"]);
  });

  it("a ring with fewer than 3 points or non-finite coordinates is no geometry → id_only", () => {
    const bad: LineageGeometry = { type: "Polygon", coordinates: [[[LNG0, LAT0], [LNG0 + U, LAT0]]] };
    const nan: LineageGeometry = { type: "Polygon", coordinates: [[[Number.NaN, LAT0], [LNG0 + U, LAT0], [LNG0, LAT0 + U]]] };
    const e = events([rec("SYNTHETIC-A", bad), rec("SYNTHETIC-B", rect(0, 0, 10, 10))], [rec("SYNTHETIC-A", rect(0, 0, 10, 10)), rec("SYNTHETIC-B", nan)]);
    expect(e.map((x) => [x.kind, x.basis])).toEqual([["same", "id_only"], ["same", "id_only"]]);
  });

  it("an unclosed ring is closed, not refused", () => {
    const open: LineageGeometry = { type: "Polygon", coordinates: [ring(0, 0, 10, 10).slice(0, 4)] };
    const e = events([rec("SYNTHETIC-A", open)], [rec("SYNTHETIC-A", rect(0, 0, 10, 10))]);
    expect(e.map((x) => [x.kind, x.basis])).toEqual([["same", "geometry"]]);
  });

  it("holes are subtracted: a donut and its hole are disjoint, and a filled donut is a merge", () => {
    const donut: LineageGeometry = { type: "Polygon", coordinates: [ring(0, 0, 10, 10), ring(4, 4, 6, 6).reverse()] };
    const e = events([rec("SYNTHETIC-RING", donut), rec("SYNTHETIC-HOLE", rect(4, 4, 6, 6))], [rec("SYNTHETIC-WHOLE", rect(0, 0, 10, 10))]);
    expect(e).toHaveLength(1);
    expect(e[0].kind).toBe("merge");
    const ringPair = e[0].overlaps.find((o) => o.previousId === "SYNTHETIC-RING");
    expect(ringPair?.fractionOfNext).toBeCloseTo(0.96, 6); // (100 - 4) / 100
    expect(e[0].coverage).toBeCloseTo(1, 6);
  });
});

describe("classifyLineage — the thresholds are read, and the band is honest", () => {
  it("raising `covers` above a drift's fraction turns same into ambiguous, never into a guess", () => {
    const prev = [rec("SYNTHETIC-A", rect(0, 0, 10, 10))];
    const next = [rec("SYNTHETIC-A", rect(0, 0, 10, 10.3))]; // fractionOfNext 0.9709
    expect(events(prev, next)[0].kind).toBe("same");
    const strict = events(prev, next, { ...LINEAGE_THRESHOLDS, covers: 0.98 });
    expect(strict[0]).toMatchObject({ kind: "ambiguous", reason: "boundary_change" });
  });

  it("a sliver above `negligible` joins the group and makes it ambiguous", () => {
    // Shared edge moved 0.5: next Q overlaps previous R by 5/100 of R.
    const prev = [rec("SYNTHETIC-Q", rect(0, 0, 10, 10)), rec("SYNTHETIC-R", rect(10, 0, 20, 10))];
    const next = [rec("SYNTHETIC-Q", rect(0, 0, 10.5, 10)), rec("SYNTHETIC-R", rect(10.5, 0, 20, 10))];
    const e = events(prev, next);
    expect(e).toHaveLength(1);
    expect(e[0].kind).toBe("ambiguous");
    expect(e[0].previousIds).toEqual(["SYNTHETIC-Q", "SYNTHETIC-R"]);
  });

  it("children that overlap each other are not a split", () => {
    const e = events([rec("SYNTHETIC-P", rect(0, 0, 10, 10))], [rec("SYNTHETIC-C1", rect(0, 0, 6, 10)), rec("SYNTHETIC-C2", rect(3, 0, 10, 10))]);
    // C1 ∩ C2 is 3/10 of each — partial, but within ONE release, so they are not a stack;
    // their sum of fractions of P is 1.3 > 2 - covers.
    expect(e[0]).toMatchObject({ kind: "ambiguous", reason: "overlapping_parts" });
  });

  it("a merge whose parents leave a hole in the child is ambiguous (merge_coverage_short)", () => {
    const e = events([rec("SYNTHETIC-P1", rect(0, 0, 5, 10)), rec("SYNTHETIC-P2", rect(5, 0, 9, 10))], [rec("SYNTHETIC-M", rect(0, 0, 10, 10))]);
    expect(e[0]).toMatchObject({ kind: "ambiguous", reason: "merge_coverage_short" });
  });

  it("a split child that also reaches into a neighbour is ambiguous, not a split", () => {
    const prev = [rec("SYNTHETIC-P", rect(0, 0, 10, 10)), rec("SYNTHETIC-N", rect(10, 0, 20, 10))];
    const next = [rec("SYNTHETIC-C1", rect(0, 0, 5, 10)), rec("SYNTHETIC-C2", rect(5, 0, 13, 10)), rec("SYNTHETIC-N", rect(13, 0, 20, 10))];
    const e = events(prev, next);
    expect(e).toHaveLength(1);
    expect(e[0].kind).toBe("ambiguous");
  });
});

describe("classifyLineage — scale", () => {
  it("a 30×30 block of unchanged parcels is 900 'same' events (the grid keeps it near-linear)", () => {
    const prev: ReturnType<typeof rec>[] = [];
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) prev.push(rec(`SYNTHETIC-${i}-${j}`, rect(i * 10, j * 10, i * 10 + 10, j * 10 + 10)));
    const t0 = Date.now();
    const e = events(prev, prev);
    expect(e).toHaveLength(900);
    expect(e.every((x) => x.kind === "same")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});

describe("inheritance — what a child takes from its parents", () => {
  const golden = (prev: ReturnType<typeof rec>[], next: ReturnType<typeof rec>[]) => events(prev, next)[0];
  const sq = rect(0, 0, 10, 10);

  it("the rule table covers every kind but retired, and field values are never inherited", () => {
    const kinds: Array<Exclude<LineageKind, "retired">> = ["same", "renumber", "split", "merge", "condo", "new", "ambiguous"];
    expect(Object.keys(INHERITANCE_RULES).sort()).toEqual([...kinds].sort());
    for (const k of kinds) expect(Object.keys(INHERITANCE_RULES[k]).sort()).toEqual(["history", "identity"]);
  });

  it("same and renumber carry identity and history from the previous record", () => {
    expect(inheritanceFor(golden([rec("SYNTHETIC-A", sq)], [rec("SYNTHETIC-A", sq)]))).toEqual([
      { nextId: "SYNTHETIC-A", identity: "carried", carriedFrom: "SYNTHETIC-A", history: "own", ancestors: [], candidateAncestors: [] },
    ]);
    expect(inheritanceFor(golden([rec("SYNTHETIC-OLD", sq)], [rec("SYNTHETIC-NEW", sq)]))).toEqual([
      { nextId: "SYNTHETIC-NEW", identity: "carried", carriedFrom: "SYNTHETIC-OLD", history: "own", ancestors: [], candidateAncestors: [] },
    ]);
  });

  it("split children are minted, with the parent as ancestor — even the one that keeps the parent's APN", () => {
    const plans = inheritanceFor(golden([rec("SYNTHETIC-D", sq)], [rec("SYNTHETIC-D", rect(0, 0, 7, 10)), rec("SYNTHETIC-D-1", rect(7, 0, 10, 10))]));
    expect(plans).toEqual([
      { nextId: "SYNTHETIC-D", identity: "minted", carriedFrom: null, history: "ancestral", ancestors: ["SYNTHETIC-D"], candidateAncestors: [] },
      { nextId: "SYNTHETIC-D-1", identity: "minted", carriedFrom: null, history: "ancestral", ancestors: ["SYNTHETIC-D"], candidateAncestors: [] },
    ]);
  });

  it("a merged child has every parent as ancestor", () => {
    const plans = inheritanceFor(golden([rec("SYNTHETIC-P1", rect(0, 0, 5, 10)), rec("SYNTHETIC-P2", rect(5, 0, 10, 10))], [rec("SYNTHETIC-M", sq)]));
    expect(plans).toEqual([{ nextId: "SYNTHETIC-M", identity: "minted", carriedFrom: null, history: "ancestral", ancestors: ["SYNTHETIC-P1", "SYNTHETIC-P2"], candidateAncestors: [] }]);
  });

  it("condo: the record keeping the parent id continues it; the other units descend from it", () => {
    const plans = inheritanceFor(golden([rec("SYNTHETIC-G", sq)], [rec("SYNTHETIC-G", sq), rec("SYNTHETIC-G-1", sq)]));
    expect(plans).toEqual([
      { nextId: "SYNTHETIC-G", identity: "carried", carriedFrom: "SYNTHETIC-G", history: "own", ancestors: [], candidateAncestors: [] },
      { nextId: "SYNTHETIC-G-1", identity: "minted", carriedFrom: null, history: "ancestral", ancestors: ["SYNTHETIC-G"], candidateAncestors: [] },
    ]);
  });

  it("ambiguous inherits nothing: provisional identity, candidates only, no ancestors", () => {
    const plans = inheritanceFor(golden([rec("SYNTHETIC-J", sq)], [rec("SYNTHETIC-J", rect(5, 0, 15, 10))]));
    expect(plans).toEqual([{ nextId: "SYNTHETIC-J", identity: "provisional", carriedFrom: null, history: "none", ancestors: [], candidateAncestors: ["SYNTHETIC-J"] }]);
  });

  it("new inherits nothing; retired produces no plan", () => {
    expect(inheritanceFor(golden([], [rec("SYNTHETIC-N", sq)]))).toEqual([
      { nextId: "SYNTHETIC-N", identity: "minted", carriedFrom: null, history: "none", ancestors: [], candidateAncestors: [] },
    ]);
    expect(inheritanceFor(golden([rec("SYNTHETIC-R", sq)], []))).toEqual([]);
  });
});
