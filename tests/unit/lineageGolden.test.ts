/**
 * D2c — the SYNTHETIC golden lineage case (shared/landData/golden/lineage-golden.json)
 * against shared/landData/lineage.ts classifyLineage().
 *
 * Every expected answer in the golden file was computed by hand from
 * rectangles; this suite asserts the classifier reproduces each one — kind,
 * ids, basis, reason, flags, the condo continuing id, coverage, and every
 * pair's overlap fractions. Population: the golden file must exercise every
 * LineageKind, and every case is asserted (a vacuity floor on the count).
 */
import { describe, expect, it } from "vitest";
import golden from "../../shared/landData/golden/lineage-golden.json";
import {
  classifyLineage,
  LINEAGE_THRESHOLDS,
  type LineageEvent,
  type LineageGeometry,
  type LineageInput,
  type LineageKind,
  type LngLat,
} from "../../shared/landData/lineage";

type Rect = [number, number, number, number];
type GoldenGeometry = { rect: number[] } | { rects: number[][] } | null;
interface GoldenRecord { sourceId: string; geometry: GoldenGeometry }
interface GoldenOverlap { previousId: string; nextId: string; fractionOfPrevious: number; fractionOfNext: number }
interface GoldenEvent extends Omit<LineageEvent, "overlaps"> { overlaps: GoldenOverlap[] }
interface GoldenCase { name: string; note: string; previous: GoldenRecord[]; next: GoldenRecord[]; expected: GoldenEvent[] }

const G = golden as unknown as {
  synthetic: boolean;
  unitDegrees: number;
  originLat: number;
  originLngStart: number;
  originLngStep: number;
  thresholds: typeof LINEAGE_THRESHOLDS;
  cases: GoldenCase[];
};

const ALL_KINDS: LineageKind[] = ["same", "renumber", "split", "merge", "condo", "retired", "new", "ambiguous"];

function rectRing(r: Rect, lng0: number): LngLat[] {
  const u = G.unitDegrees;
  const [x0, y0, x1, y1] = r;
  const p = (x: number, y: number): LngLat => [lng0 + x * u, G.originLat + y * u];
  return [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1), p(x0, y0)];
}
function expand(g: GoldenGeometry, lng0: number): LineageGeometry | null {
  if (g === null) return null;
  if ("rect" in g) return { type: "Polygon", coordinates: [rectRing(g.rect as Rect, lng0)] };
  return { type: "MultiPolygon", coordinates: g.rects.map((r) => [rectRing(r as Rect, lng0)]) };
}
function inputOf(c: GoldenCase, index: number): LineageInput {
  const lng0 = G.originLngStart + index * G.originLngStep;
  const side = (rs: GoldenRecord[]) => rs.map((r) => ({ sourceId: r.sourceId, geometry: expand(r.geometry, lng0) }));
  return { previous: side(c.previous), next: side(c.next) };
}

function expectEventsMatch(got: LineageEvent[], want: GoldenEvent[], label: string) {
  expect(got.map((e) => [e.kind, e.previousIds, e.nextIds]), label).toEqual(want.map((e) => [e.kind, e.previousIds, e.nextIds]));
  got.forEach((e, i) => {
    const w = want[i];
    expect(e.basis, `${label} basis`).toBe(w.basis);
    expect(e.reason, `${label} reason`).toBe(w.reason);
    expect([...e.flags].sort(), `${label} flags`).toEqual([...w.flags].sort());
    expect(e.continuingId, `${label} continuingId`).toBe(w.continuingId);
    if (w.coverage === null) expect(e.coverage, `${label} coverage`).toBeNull();
    else expect(e.coverage, `${label} coverage`).toBeCloseTo(w.coverage, 5);
    expect(e.overlaps.map((o) => [o.previousId, o.nextId]), `${label} overlap pairs`).toEqual(w.overlaps.map((o) => [o.previousId, o.nextId]));
    e.overlaps.forEach((o, j) => {
      expect(o.fractionOfPrevious, `${label} pair ${j} fractionOfPrevious`).toBeCloseTo(w.overlaps[j].fractionOfPrevious, 5);
      expect(o.fractionOfNext, `${label} pair ${j} fractionOfNext`).toBeCloseTo(w.overlaps[j].fractionOfNext, 5);
    });
  });
}

describe("lineage golden case — labelled synthetic, never real data", () => {
  it("is marked synthetic and every id says SYNTHETIC", () => {
    expect(G.synthetic).toBe(true);
    const ids = G.cases.flatMap((c) => [...c.previous, ...c.next].map((r) => r.sourceId));
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ids) expect(id.startsWith("SYNTHETIC-")).toBe(true);
  });

  it("states the thresholds it was computed under, and they are the production ones", () => {
    expect(G.thresholds).toEqual(LINEAGE_THRESHOLDS);
  });

  it("population: covers every lineage kind, with a floor on the case count", () => {
    expect(G.cases.length).toBeGreaterThanOrEqual(22);
    const kinds = new Set(G.cases.flatMap((c) => c.expected.map((e) => e.kind)));
    expect([...kinds].sort()).toEqual([...ALL_KINDS].sort());
    const names = G.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("classifyLineage reproduces every hand-computed golden answer", () => {
  G.cases.forEach((c, i) => {
    it(c.name, () => {
      const r = classifyLineage(inputOf(c, i));
      if (!r.ok) throw new Error(`refused: ${r.reason}`);
      expectEventsMatch(r.events, c.expected, c.name);
    });
  });

  it("all cases in ONE release pair give exactly the per-case answers (nothing leaks between neighbours)", () => {
    const inputs = G.cases.map((c, i) => inputOf(c, i));
    const merged: LineageInput = { previous: inputs.flatMap((x) => x.previous), next: inputs.flatMap((x) => x.next) };
    const r = classifyLineage(merged);
    if (!r.ok) throw new Error("refused");
    const want = G.cases.flatMap((c) => c.expected);
    const key = (e: { kind: string; previousIds: string[]; nextIds: string[] }) => JSON.stringify([e.kind, e.previousIds, e.nextIds]);
    expect(r.events.map(key).sort()).toEqual(want.map(key).sort());
  });

  it("every source id of both releases lands in exactly one event", () => {
    G.cases.forEach((c, i) => {
      const r = classifyLineage(inputOf(c, i));
      if (!r.ok) throw new Error("refused");
      const prevSeen = r.events.flatMap((e) => e.previousIds).sort();
      const nextSeen = r.events.flatMap((e) => e.nextIds).sort();
      expect(prevSeen, c.name).toEqual(c.previous.map((x) => x.sourceId).sort());
      expect(nextSeen, c.name).toEqual(c.next.map((x) => x.sourceId).sort());
    });
  });

  it("swapping the releases swaps parent and child: split ↔ merge, retired ↔ new", () => {
    const flip: Partial<Record<LineageKind, LineageKind>> = { split: "merge", merge: "split", retired: "new", new: "retired", same: "same", renumber: "renumber" };
    let checked = 0;
    G.cases.forEach((c, i) => {
      const fwd = classifyLineage(inputOf(c, i));
      const input = inputOf(c, i);
      const back = classifyLineage({ previous: input.next, next: input.previous });
      if (!fwd.ok || !back.ok) throw new Error("refused");
      for (const e of fwd.events) {
        const want = flip[e.kind];
        if (!want || e.flags.includes("condo_stack")) continue;
        const match = back.events.find((b) => JSON.stringify(b.previousIds) === JSON.stringify(e.nextIds) && JSON.stringify(b.nextIds) === JSON.stringify(e.previousIds));
        expect(match?.kind, `${c.name}: ${e.kind} reversed`).toBe(want);
        checked++;
      }
    });
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});
