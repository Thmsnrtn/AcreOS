/**
 * Release diff (D2b) — what changed between two releases.
 *
 * Two levels:
 *
 *  1. diffManifests(from, to): counties added / removed / changed, per-county
 *     parcel-count deltas, artifact digest changes and source-ref changes.
 *     Manifest-only — no artifact is opened.
 *
 *  2. diffParcelRows(from, to): the parcel-level diff of ONE county, over two
 *     streams of (sourceParcelId, fingerprint) rows. It is a SORT-MERGE: both
 *     inputs must be sorted ascending by sourceParcelId in UTF-8 byte order
 *     (Postgres `ORDER BY … COLLATE "C"`, or a parquet file sorted on the
 *     column) with no duplicate ids, and the diff holds exactly one row from
 *     each side at a time. Memory is O(1) in county size; it never builds a
 *     Map or array of either input. Unsorted or duplicated input is REFUSED
 *     (ParcelStreamOrderError) the moment it is seen — a sort-merge over
 *     unsorted input silently reports false adds/removes, which is worse than
 *     no diff at all.
 *
 * Keyed by the SOURCE parcel id, as the county publishes it. A county
 * renumbering therefore reads as remove + add here; carrying identity across
 * a renumbering is the crosswalk's job (shared/landData/parcelCrosswalk.ts),
 * not the diff's — the spec says why.
 *
 * Pure: no I/O. The integrator supplies the row streams.
 */

import { createHash } from "node:crypto";
import { canonicalJson, compareUtf8, releaseIdOf, type ArtifactKind, type ReleaseCountyEntry, type ReleaseManifest, type ReleaseSourceRef } from "./releaseManifest";

// ── 1. Manifest diff ─────────────────────────────────────────────────────

export interface CountyRef {
  state: string;
  county: string;
  parcelCount: number;
}

export interface ArtifactDigestChange {
  kind: ArtifactKind;
  /** null when the artifact is absent on that side. */
  fromSha256: string | null;
  toSha256: string | null;
  fromBytes: number | null;
  toBytes: number | null;
}

export type SourceField = keyof ReleaseSourceRef;
const SOURCE_FIELDS: readonly SourceField[] = ["job", "etlRunId", "sourceAsOf", "layerUrl", "fieldMappingDigest"];

export interface CountyChange {
  state: string;
  county: string;
  parcelCountFrom: number;
  parcelCountTo: number;
  parcelCountDelta: number;
  artifactChanges: ArtifactDigestChange[];
  sourceChanges: SourceField[];
  /** The rows changed bytes — the county is a candidate for a parcel-level diff. */
  parquetChanged: boolean;
}

export interface ReleaseDiff {
  fromReleaseId: string;
  toReleaseId: string;
  mappingVersion: { from: string; to: string } | null;
  countiesAdded: CountyRef[];
  countiesRemoved: CountyRef[];
  countiesChanged: CountyChange[];
  countiesUnchanged: number;
  totals: { parcelsFrom: number; parcelsTo: number; parcelDelta: number };
}

const keyOf = (c: { state: string; county: string }) => `${c.state}/${c.county}`;
const ref = (c: ReleaseCountyEntry): CountyRef => ({ state: c.state, county: c.county, parcelCount: c.parcelCount });

function countyChange(a: ReleaseCountyEntry, b: ReleaseCountyEntry): CountyChange | null {
  const artifactChanges: ArtifactDigestChange[] = [];
  for (const kind of ["parquet", "pmtiles"] as const) {
    const x = a.artifacts.find((r) => r.kind === kind) ?? null;
    const y = b.artifacts.find((r) => r.kind === kind) ?? null;
    if (x?.sha256 !== y?.sha256 || x?.bytes !== y?.bytes) {
      artifactChanges.push({ kind, fromSha256: x?.sha256 ?? null, toSha256: y?.sha256 ?? null, fromBytes: x?.bytes ?? null, toBytes: y?.bytes ?? null });
    }
  }
  const sourceChanges = SOURCE_FIELDS.filter((f) => a.source[f] !== b.source[f]);
  if (artifactChanges.length === 0 && sourceChanges.length === 0 && a.parcelCount === b.parcelCount) return null;
  return {
    state: a.state,
    county: a.county,
    parcelCountFrom: a.parcelCount,
    parcelCountTo: b.parcelCount,
    parcelCountDelta: b.parcelCount - a.parcelCount,
    artifactChanges,
    sourceChanges,
    parquetChanged: artifactChanges.some((c) => c.kind === "parquet"),
  };
}

/**
 * Diff two manifests. Both are re-validated (releaseIdOf throws on an invalid
 * one), so the counties are in canonical order and the walk is a merge.
 */
export function diffManifests(from: ReleaseManifest, to: ReleaseManifest): ReleaseDiff {
  const fromReleaseId = releaseIdOf(from);
  const toReleaseId = releaseIdOf(to);
  const A = [...from.counties].sort((x, y) => compareUtf8(keyOf(x), keyOf(y)));
  const B = [...to.counties].sort((x, y) => compareUtf8(keyOf(x), keyOf(y)));
  const diff: ReleaseDiff = {
    fromReleaseId,
    toReleaseId,
    mappingVersion: from.mappingVersion === to.mappingVersion ? null : { from: from.mappingVersion, to: to.mappingVersion },
    countiesAdded: [],
    countiesRemoved: [],
    countiesChanged: [],
    countiesUnchanged: 0,
    totals: { parcelsFrom: 0, parcelsTo: 0, parcelDelta: 0 },
  };
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    const a = A[i];
    const b = B[j];
    const c = a && b ? compareUtf8(keyOf(a), keyOf(b)) : a ? -1 : 1;
    if (c < 0) {
      diff.countiesRemoved.push(ref(a));
      i++;
    } else if (c > 0) {
      diff.countiesAdded.push(ref(b));
      j++;
    } else {
      const ch = countyChange(a, b);
      if (ch) diff.countiesChanged.push(ch);
      else diff.countiesUnchanged += 1;
      i++;
      j++;
    }
  }
  for (const c of from.counties) diff.totals.parcelsFrom += c.parcelCount;
  for (const c of to.counties) diff.totals.parcelsTo += c.parcelCount;
  diff.totals.parcelDelta = diff.totals.parcelsTo - diff.totals.parcelsFrom;
  return diff;
}

// ── 2. Parcel-level diff (bounded memory) ────────────────────────────────

export interface ParcelRowRef {
  sourceParcelId: string;
  /** Content fingerprint of the row (parcelFingerprint), compared for "changed". */
  fingerprint: string;
}

export type ParcelChange =
  | { kind: "added"; sourceParcelId: string; toFingerprint: string }
  | { kind: "removed"; sourceParcelId: string; fromFingerprint: string }
  | { kind: "changed"; sourceParcelId: string; fromFingerprint: string; toFingerprint: string };

/** Counters the diff keeps as it walks; the only state that grows is integers. */
export interface ParcelDiffStats {
  fromRows: number;
  toRows: number;
  unchanged: number;
}

export class ParcelStreamOrderError extends Error {
  constructor(
    readonly side: "from" | "to",
    readonly previous: string,
    readonly next: string,
  ) {
    super(
      `refused: the ${side} parcel stream is not strictly ascending by source parcel id (${JSON.stringify(previous)} then ${JSON.stringify(next)}) — sort it in UTF-8 byte order (COLLATE "C") with no duplicates; a merge over unsorted rows reports changes that did not happen`,
    );
    this.name = "ParcelStreamOrderError";
  }
}

type RowSource = AsyncIterable<ParcelRowRef> | Iterable<ParcelRowRef>;

function iteratorOf(src: RowSource): AsyncIterator<ParcelRowRef> | Iterator<ParcelRowRef> {
  if (Symbol.asyncIterator in src) return (src as AsyncIterable<ParcelRowRef>)[Symbol.asyncIterator]();
  return (src as Iterable<ParcelRowRef>)[Symbol.iterator]();
}

/** One side of the merge: pulls one row at a time and enforces strict order. */
class OrderedCursor {
  private prev: string | null = null;
  constructor(
    private readonly it: AsyncIterator<ParcelRowRef> | Iterator<ParcelRowRef>,
    private readonly side: "from" | "to",
    private readonly onRow: () => void,
  ) {}

  async next(): Promise<ParcelRowRef | null> {
    const r = await this.it.next();
    if (r.done) return null;
    const row = r.value;
    if (typeof row.sourceParcelId !== "string" || row.sourceParcelId.length === 0) {
      throw new Error(`refused: a ${this.side} row has no source parcel id — it cannot be keyed`);
    }
    if (this.prev !== null && compareUtf8(this.prev, row.sourceParcelId) >= 0) throw new ParcelStreamOrderError(this.side, this.prev, row.sourceParcelId);
    this.prev = row.sourceParcelId;
    this.onRow();
    return row;
  }

  async close(): Promise<void> {
    if (typeof this.it.return === "function") await this.it.return();
  }
}

/**
 * Sort-merge two sorted row streams into a stream of changes. Lazy: it pulls
 * a row only when the merge needs the next one, so when the k-th change is
 * yielded no more than k + 1 rows have been read from either side beyond the
 * unchanged ones already passed. `stats`, if given, is updated as it goes.
 */
export async function* diffParcelRows(from: RowSource, to: RowSource, stats?: ParcelDiffStats): AsyncGenerator<ParcelChange, void, undefined> {
  const s: ParcelDiffStats = stats ?? { fromRows: 0, toRows: 0, unchanged: 0 };
  const A = new OrderedCursor(iteratorOf(from), "from", () => (s.fromRows += 1));
  const B = new OrderedCursor(iteratorOf(to), "to", () => (s.toRows += 1));
  try {
    let a = await A.next();
    let b = await B.next();
    while (a !== null || b !== null) {
      const c = a !== null && b !== null ? compareUtf8(a.sourceParcelId, b.sourceParcelId) : a !== null ? -1 : 1;
      if (c < 0 && a !== null) {
        yield { kind: "removed", sourceParcelId: a.sourceParcelId, fromFingerprint: a.fingerprint };
        a = await A.next();
      } else if (c > 0 && b !== null) {
        yield { kind: "added", sourceParcelId: b.sourceParcelId, toFingerprint: b.fingerprint };
        b = await B.next();
      } else if (a !== null && b !== null) {
        if (a.fingerprint !== b.fingerprint) yield { kind: "changed", sourceParcelId: a.sourceParcelId, fromFingerprint: a.fingerprint, toFingerprint: b.fingerprint };
        else s.unchanged += 1;
        a = await A.next();
        b = await B.next();
      }
    }
  } finally {
    await A.close();
    await B.close();
  }
}

export interface ParcelDiffSummary extends ParcelDiffStats {
  added: number;
  removed: number;
  changed: number;
  /** The first `sampleLimit` ids of each kind, in id order — bounded, for a human-readable report. */
  samples: { added: string[]; removed: string[]; changed: string[] };
}

/** Run diffParcelRows to completion keeping counts and a bounded sample only. */
export async function summarizeParcelDiff(from: RowSource, to: RowSource, sampleLimit = 20): Promise<ParcelDiffSummary> {
  const stats: ParcelDiffStats = { fromRows: 0, toRows: 0, unchanged: 0 };
  const out: ParcelDiffSummary = { ...stats, added: 0, removed: 0, changed: 0, samples: { added: [], removed: [], changed: [] } };
  for await (const ch of diffParcelRows(from, to, stats)) {
    out[ch.kind] += 1;
    const list = out.samples[ch.kind];
    if (list.length < sampleLimit) list.push(ch.sourceParcelId);
  }
  return { ...out, ...stats };
}

/**
 * The fingerprint of one artifact row: SHA-256 over its canonical JSON, with
 * byte columns (the WKB geometry) as `{"$bytes": "<hex>"}`. Any change to any
 * column — an owner, a value, one vertex — changes it.
 */
export function parcelFingerprint(row: Readonly<Record<string, unknown>>): string {
  const cells: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array) cells[k] = { $bytes: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("hex") };
    else if (v === null) cells[k] = undefined; // parquet optional-absent and null are the same cell
    else cells[k] = v;
  }
  return createHash("sha256").update(canonicalJson(cells), "utf8").digest("hex");
}
