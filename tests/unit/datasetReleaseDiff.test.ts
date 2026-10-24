/**
 * D2b — the release diff.
 *
 *   - manifest diff: the labelled synthetic pair (base → next) produces the
 *     hand-written expected report exactly;
 *   - parcel diff: the labelled synthetic rows produce the expected
 *     added/removed/changed/unchanged sets;
 *   - BOUNDED MEMORY: the parcel diff is lazy — at every change it yields, it
 *     has read at most one row past what it has settled on each side, and a
 *     consumer that stops early stops the reads (and closes both sources);
 *   - unsorted or duplicated input is refused, never merged into false changes;
 *   - order is UTF-8 byte order (Postgres COLLATE "C"), not JS UTF-16 order.
 *
 * All fixtures are SYNTHETIC (tests/fixtures/releases/*.synthetic.json).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { releaseIdOf, type ReleaseManifest } from "../../server/services/landData/releases/releaseManifest";
import {
  diffManifests,
  diffParcelRows,
  parcelFingerprint,
  ParcelStreamOrderError,
  summarizeParcelDiff,
  type ParcelChange,
  type ParcelDiffStats,
  type ParcelRowRef,
} from "../../server/services/landData/releases/releaseDiff";

const load = <T>(name: string): T => JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/releases", name), "utf8")) as T;
const base = load<{ manifest: ReleaseManifest }>("base.synthetic.json");
const next = load<{ manifest: ReleaseManifest; expectedDiffFromBase: Record<string, unknown> }>("next.synthetic.json");
const parcels = load<{
  from: Array<Record<string, unknown> & { source_parcel_id: string }>;
  to: Array<Record<string, unknown> & { source_parcel_id: string }>;
  expected: { added: string[]; removed: string[]; changed: string[]; unchanged: number };
}>("parcels.synthetic.json");

const refs = (rows: Array<Record<string, unknown> & { source_parcel_id: string }>): ParcelRowRef[] =>
  rows.map((r) => ({ sourceParcelId: r.source_parcel_id, fingerprint: parcelFingerprint(r) }));

async function collect(it: AsyncIterable<ParcelChange>): Promise<ParcelChange[]> {
  const out: ParcelChange[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("manifest diff — labelled synthetic pair", () => {
  it("base → next equals the hand-written expected report", () => {
    const d = diffManifests(base.manifest, next.manifest);
    expect(d.fromReleaseId).toBe(releaseIdOf(base.manifest));
    expect(d.toReleaseId).toBe(releaseIdOf(next.manifest));
    const { fromReleaseId: _f, toReleaseId: _t, ...rest } = d;
    expect(rest).toEqual(next.expectedDiffFromBase);
  });

  it("next → base is the mirror image", () => {
    const d = diffManifests(next.manifest, base.manifest);
    expect(d.countiesAdded).toEqual([{ state: "WI", county: "synthetic charlie", parcelCount: 30 }]);
    expect(d.countiesRemoved).toEqual([{ state: "AR", county: "synthetic delta", parcelCount: 20 }]);
    expect(d.countiesChanged.map((c) => c.parcelCountDelta)).toEqual([-4]);
    expect(d.totals.parcelDelta).toBe(6);
  });

  it("a release against itself has no changes", () => {
    const d = diffManifests(base.manifest, base.manifest);
    expect(d.countiesAdded).toEqual([]);
    expect(d.countiesRemoved).toEqual([]);
    expect(d.countiesChanged).toEqual([]);
    expect(d.countiesUnchanged).toBe(3);
    expect(d.fromReleaseId).toBe(d.toReleaseId);
  });

  it("reports a pmtiles-only change as a change whose parquet did NOT change", () => {
    const m = JSON.parse(JSON.stringify(base.manifest)) as ReleaseManifest;
    const bravo = m.counties.find((c) => c.county === "synthetic bravo")!;
    const pm = bravo.artifacts.find((a) => a.kind === "pmtiles")!;
    pm.sha256 = "0".repeat(64);
    const d = diffManifests(base.manifest, m);
    expect(d.countiesChanged).toHaveLength(1);
    expect(d.countiesChanged[0]).toMatchObject({ county: "synthetic bravo", parquetChanged: false, parcelCountDelta: 0, sourceChanges: [] });
    expect(d.countiesChanged[0].artifactChanges.map((a) => a.kind)).toEqual(["pmtiles"]);
  });

  it("reports a mapping-version change", () => {
    const m = { ...base.manifest, mappingVersion: "bulk-row@2" };
    expect(diffManifests(base.manifest, m).mappingVersion).toEqual({ from: "bulk-row@1", to: "bulk-row@2" });
  });
});

describe("parcel diff — labelled synthetic rows", () => {
  it("summarizeParcelDiff equals the hand-written expectation", async () => {
    const s = await summarizeParcelDiff(refs(parcels.from), refs(parcels.to));
    expect(s.samples).toEqual({ added: parcels.expected.added, removed: parcels.expected.removed, changed: parcels.expected.changed });
    expect(s).toMatchObject({
      added: parcels.expected.added.length,
      removed: parcels.expected.removed.length,
      changed: parcels.expected.changed.length,
      unchanged: parcels.expected.unchanged,
      fromRows: parcels.from.length,
      toRows: parcels.to.length,
    });
  });

  it("emits changes in id order with both fingerprints on a change", async () => {
    const out = await collect(diffParcelRows(refs(parcels.from), refs(parcels.to)));
    expect(out.map((c) => `${c.kind}:${c.sourceParcelId}`)).toEqual([
      "changed:SYNTHETIC-0002",
      "removed:SYNTHETIC-0003",
      "removed:SYNTHETIC-0005",
      "added:SYNTHETIC-0007",
    ]);
    const ch = out[0];
    expect(ch.kind === "changed" && ch.fromFingerprint !== ch.toFingerprint).toBe(true);
  });

  it("accepts async iterables and empty sides", async () => {
    async function* gen(rows: ParcelRowRef[]) {
      for (const r of rows) yield r;
    }
    const s = await summarizeParcelDiff(gen([]), gen(refs(parcels.to)));
    expect(s.added).toBe(parcels.to.length);
    const t = await summarizeParcelDiff(gen(refs(parcels.from)), []);
    expect(t.removed).toBe(parcels.from.length);
  });
});

describe("order is enforced, not assumed", () => {
  const r = (id: string, fp = "f"): ParcelRowRef => ({ sourceParcelId: id, fingerprint: fp });

  it("refuses an unsorted 'from' stream", async () => {
    await expect(collect(diffParcelRows([r("B"), r("A")], [r("A"), r("B")]))).rejects.toBeInstanceOf(ParcelStreamOrderError);
  });
  it("refuses an unsorted 'to' stream", async () => {
    await expect(collect(diffParcelRows([r("A"), r("B")], [r("A"), r("C"), r("B")]))).rejects.toThrow(/to parcel stream is not strictly ascending/);
  });
  it("refuses a duplicate id", async () => {
    await expect(collect(diffParcelRows([r("A"), r("A")], [r("A")]))).rejects.toThrow(/not strictly ascending/);
  });
  it("refuses an empty id", async () => {
    await expect(collect(diffParcelRows([r("")], []))).rejects.toThrow(/no source parcel id/);
  });
  it("uses UTF-8 byte order (COLLATE \"C\"), where U+FF5E sorts before U+1F600", async () => {
    // UTF-16 code units would put the astral character (a surrogate, 0xD83D) first; UTF-8 bytes do not.
    const ids = ["SYNTHETIC-～", "SYNTHETIC-\u{1F600}"];
    const s = await summarizeParcelDiff(ids.map((i) => r(i)), ids.map((i) => r(i)));
    expect(s.unchanged).toBe(2);
    await expect(collect(diffParcelRows([...ids].reverse().map((i) => r(i)), []))).rejects.toBeInstanceOf(ParcelStreamOrderError);
  });
  it("merges in the same byte order it enforces (a UTF-16 comparator would invent an add and a remove)", async () => {
    const [bmp, astral] = ["SYNTHETIC-～", "SYNTHETIC-\u{1F600}"];
    const out = await collect(diffParcelRows([r(bmp), r(astral)], [r(astral)]));
    expect(out).toEqual([{ kind: "removed", sourceParcelId: bmp, fromFingerprint: "f" }]);
  });
});

describe("bounded memory: the parcel diff is a lazy sort-merge", () => {
  /** A lazily generated sorted stream that counts every row it hands out and notes when it is closed. */
  function instrumented(n: number, skip: (i: number) => boolean, fp: (i: number) => string) {
    const probe = { pulled: 0, closed: false };
    function* gen(): Generator<ParcelRowRef> {
      try {
        for (let i = 0; i < n; i++) {
          if (skip(i)) continue;
          probe.pulled += 1;
          yield { sourceParcelId: `SYNTHETIC-${String(i).padStart(8, "0")}`, fingerprint: fp(i) };
        }
      } finally {
        probe.closed = true;
      }
    }
    return { probe, rows: { [Symbol.iterator]: gen } as Iterable<ParcelRowRef> };
  }

  it("never reads more than one row past what it has settled, on either side (200k rows)", async () => {
    const N = 200_000;
    const A = instrumented(N, (i) => i % 1000 === 7, () => "same");
    const B = instrumented(N, (i) => i % 1000 === 500, (i) => (i % 5000 === 3 ? "changed" : "same"));
    const stats: ParcelDiffStats = { fromRows: 0, toRows: 0, unchanged: 0 };
    let settledFrom = 0;
    let settledTo = 0;
    let worstLookahead = 0;
    let changes = 0;
    const check = () => {
      // Rows settled on a side = changes that consumed a row there + unchanged pairs.
      const aheadFrom = A.probe.pulled - (settledFrom + stats.unchanged);
      const aheadTo = B.probe.pulled - (settledTo + stats.unchanged);
      worstLookahead = Math.max(worstLookahead, aheadFrom, aheadTo);
    };
    for await (const c of diffParcelRows(A.rows, B.rows, stats)) {
      check();
      changes++;
      if (c.kind !== "added") settledFrom++;
      if (c.kind !== "removed") settledTo++;
    }
    // At each yield the merge holds the current row of each side — at most 1 ahead.
    expect(worstLookahead).toBeLessThanOrEqual(1);
    expect(stats.fromRows).toBe(A.probe.pulled);
    expect(stats.toRows).toBe(B.probe.pulled);
    expect(A.probe.pulled).toBe(N - N / 1000);
    // Expected counts derived from the generators' rules, not from the code under test.
    const removed = N / 1000; // ids ≡ 500 mod 1000 missing from B
    const added = N / 1000; // ids ≡ 7 mod 1000 missing from A
    const changed = N / 5000; // ids ≡ 3 mod 5000 (present on both sides)
    expect(changes).toBe(removed + added + changed);
    expect(stats.unchanged).toBe(N - removed - added - changed);
  });

  it("a consumer that stops early stops the reads and closes both sources", async () => {
    const N = 1_000_000;
    const A = instrumented(N, () => false, () => "a");
    const B = instrumented(N, () => false, () => "b"); // every row differs
    let seen = 0;
    for await (const _ of diffParcelRows(A.rows, B.rows)) {
      seen++;
      if (seen === 3) break;
    }
    expect(A.probe.pulled).toBeLessThanOrEqual(4);
    expect(B.probe.pulled).toBeLessThanOrEqual(4);
    expect(A.probe.closed).toBe(true);
    expect(B.probe.closed).toBe(true);
  });

  it("the first change is yielded before the inputs are drained", async () => {
    const N = 1_000_000;
    const A = instrumented(N, (i) => i === 0, () => "x");
    const B = instrumented(N, () => false, () => "x");
    const it = diffParcelRows(A.rows, B.rows);
    const first = await it.next();
    expect(first.value).toMatchObject({ kind: "added", sourceParcelId: "SYNTHETIC-00000000" });
    expect(A.probe.pulled + B.probe.pulled).toBeLessThanOrEqual(3);
    await it.return(undefined);
  });
});
