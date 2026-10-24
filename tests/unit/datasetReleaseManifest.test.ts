/**
 * D2b — the release manifest and its content id.
 *
 * What is proven here:
 *   - the id is a function of CONTENT only: key order, whitespace, county
 *     order and artifact order in the input cannot move it;
 *   - ANY change to ANY leaf of the manifest changes the id (or is refused) —
 *     over an ENUMERATED population of every leaf of the fixture, with a
 *     vacuity floor so a walker that read nothing cannot pass;
 *   - the id is exactly sha256(domain tag + canonical JSON), recomputed here
 *     independently of the module;
 *   - a stored manifest edited after release is detected;
 *   - a release names only bucket-confirmed (ingested) artifacts.
 *
 * Fixtures under tests/fixtures/releases/ are SYNTHETIC (labelled in-file).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalManifestBytes,
  countyEntryFromBuild,
  fieldMappingDigest,
  releaseIdFromJson,
  releaseIdOf,
  summarizeRelease,
  validateManifest,
  verifyReleaseId,
  type ReleaseManifest,
} from "../../server/services/landData/releases/releaseManifest";
import { parcelFingerprint } from "../../server/services/landData/releases/releaseDiff";

const fixture = (name: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/releases", name), "utf8")) as { synthetic: boolean; manifest: ReleaseManifest };
const base = fixture("base.synthetic.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Rebuild a JSON value with every object's keys in REVERSE order. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

describe("fixtures are synthetic", () => {
  it("every fixture says so", () => {
    for (const f of ["base.synthetic.json", "next.synthetic.json", "parcels.synthetic.json"]) {
      expect(fixture(f).synthetic, f).toBe(true);
    }
  });
});

describe("the content id is deterministic", () => {
  const id = releaseIdOf(base.manifest);

  it("has the sha256:<hex> shape", () => {
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is sha256 over the domain tag + canonical JSON, recomputed independently", () => {
    const bytes = canonicalManifestBytes(base.manifest);
    expect(bytes.startsWith("acreos-parcels/release-manifest@1\n")).toBe(true);
    const body = bytes.slice("acreos-parcels/release-manifest@1\n".length);
    // The body is JSON with no insignificant whitespace: re-serializing it compactly is the identity.
    expect(JSON.stringify(JSON.parse(body))).toBe(body);
    expect(id).toBe(`sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`);
  });

  it("does not depend on key order", () => {
    expect(releaseIdOf(reverseKeys(base.manifest) as ReleaseManifest)).toBe(id);
  });

  it("does not depend on whitespace in the manifest text", () => {
    const m = base.manifest;
    expect(releaseIdFromJson(JSON.stringify(m))).toBe(id);
    expect(releaseIdFromJson(JSON.stringify(m, null, 2))).toBe(id);
    expect(releaseIdFromJson(`\n\t ${JSON.stringify(reverseKeys(m), null, "\t")}  \n`)).toBe(id);
  });

  it("does not depend on county or artifact order", () => {
    const m = clone(base.manifest);
    m.counties.reverse();
    for (const c of m.counties) c.artifacts.reverse();
    expect(releaseIdOf(m)).toBe(id);
  });

  it("is the same across repeated calls and does not mutate its input", () => {
    const before = JSON.stringify(base.manifest);
    expect(releaseIdOf(base.manifest)).toBe(releaseIdOf(base.manifest));
    expect(JSON.stringify(base.manifest)).toBe(before);
  });
});

// ── Any byte change changes the id ───────────────────────────────────────

type Leaf = { path: Array<string | number>; value: string | number };

function leaves(v: unknown, p: Array<string | number> = []): Leaf[] {
  if (typeof v === "string" || typeof v === "number") return [{ path: p, value: v }];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, [...p, i]));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, [...p, k]));
  return [];
}

/** The smallest change to a leaf that keeps its class (a hex digit stays hex, a digit stays a digit). */
function nudge(v: string | number): string | number {
  if (typeof v === "number") return v + 1;
  const last = v[v.length - 1];
  if (/^[0-9a-f]{64}$/.test(v)) return v.slice(0, -1) + (last === "0" ? "1" : "0");
  if (/^[A-Z]{2}$/.test(v)) return v[0] + (last === "Z" ? "A" : String.fromCharCode(last.charCodeAt(0) + 1));
  const d = v.search(/\d(?!.*\d)/);
  if (d >= 0) return v.slice(0, d) + String((Number(v[d]) + 1) % 10) + v.slice(d + 1);
  return `${v}x`;
}

function setAt(root: unknown, p: Array<string | number>, value: unknown): void {
  let cur = root as Record<string | number, unknown>;
  for (const k of p.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  cur[p[p.length - 1]] = value;
}

describe("any change to any leaf changes the id", () => {
  const all = leaves(base.manifest);
  const id = releaseIdOf(base.manifest);

  it("enumerates the whole manifest (vacuity floor)", () => {
    // 3 header leaves; per county state/county/parcelCount + 5 source + 4 per artifact (kind/bucket/objectKey/bytes/sha256 = 5).
    // base: 3 counties, 5 artifacts → 3 + 3*(3+5) + 5*5 = 52.
    expect(all.length).toBe(52);
  });

  it.each(leaves(base.manifest).map((l) => [l.path.join("."), l] as const))("%s", (_name, leaf) => {
    const m = clone(base.manifest);
    setAt(m, leaf.path, nudge(leaf.value));
    let changed: string | null;
    try {
      changed = releaseIdOf(m);
    } catch {
      changed = null; // refused as invalid — also not the same release
    }
    expect(changed).not.toBe(id);
  });

  it("most nudges stay valid, so the id (not the validator) is what is being proven", () => {
    let valid = 0;
    for (const leaf of all) {
      const m = clone(base.manifest);
      setAt(m, leaf.path, nudge(leaf.value));
      if (validateManifest(m).ok) valid++;
    }
    // Only format, dataset and the five artifact kinds are refused when nudged.
    expect(valid).toBe(all.length - 7);
  });
});

// ── Validation ───────────────────────────────────────────────────────────

describe("validateManifest refuses what it cannot vouch for", () => {
  type Mutable = ReleaseManifest & Record<string, unknown>;
  const bad = (mut: (m: Mutable) => void, expectText: RegExp) => {
    const m = clone(base.manifest) as Mutable;
    mut(m);
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" | ")).toMatch(expectText);
  };

  it("an unknown top-level field (it would be hashed but never read)", () => bad((m) => (m.synthetic = true), /unknown manifest field "synthetic"/));
  it("a duplicate county", () => bad((m) => m.counties.push(clone(m.counties[0])), /appears twice/));
  it("a county without a parquet artifact", () => bad((m) => (m.counties[0].artifacts = []), /no parquet artifact/));
  it("two parquet artifacts for a county", () => bad((m) => m.counties[0].artifacts.push(clone(m.counties[0].artifacts[0])), /two parquet/));
  it("a malformed digest", () => bad((m) => (m.counties[0].artifacts[0].sha256 = "ABC"), /sha256 must be 64/));
  it("a zero-byte artifact", () => bad((m) => (m.counties[0].artifacts[0].bytes = 0), /positive integer/));
  it("an artifact with no bucket (no receipt)", () => bad((m) => (m.counties[0].artifacts[0].bucket = ""), /no receipt/));
  it("an un-normalized county name", () => bad((m) => (m.counties[0].county = "Synthetic Charlie County"), /normalized county/));
  it("a fractional parcel count", () => bad((m) => (m.counties[0].parcelCount = 1.5), /parcelCount/));
  it("an empty release", () => bad((m) => (m.counties = []), /at least one county/));
  it("a wrong format tag", () => bad((m) => ((m as Record<string, unknown>).format = "acreos-parcels/release-manifest@2"), /format must be/));
});

describe("canonicalJson refuses what JSON cannot say exactly", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a Date", new Date(0)],
    ["a bigint", BigInt(1)],
    ["undefined in an array", [1, undefined]],
    ["a Map", new Map()],
  ])("%s", (_n, v) => {
    expect(() => canonicalJson({ v })).toThrow();
  });

  it("omits undefined-valued keys, as JSON does, and sorts keys", () => {
    expect(canonicalJson({ b: 1, a: undefined, c: { z: null, y: [true, "s"] } })).toBe('{"b":1,"c":{"y":[true,"s"],"z":null}}');
  });
});

describe("a stored manifest edited after release is detected", () => {
  it("verifyReleaseId", () => {
    const id = releaseIdOf(base.manifest);
    expect(verifyReleaseId(id, clone(base.manifest))).toEqual({ ok: true });
    const edited = clone(base.manifest);
    edited.counties[1].parcelCount += 1;
    const r = verifyReleaseId(id, edited);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/changed after release/);
  });
});

// ── From a build ─────────────────────────────────────────────────────────

describe("countyEntryFromBuild names only bucket-confirmed artifacts", () => {
  const sha = (s: string) => createHash("sha256").update(`SYNTHETIC ${s}`).digest("hex");
  const parquet = { localPath: "/tmp/x.parquet", bytes: 100, sha256: sha("pq"), contentType: "application/vnd.apache.parquet", objectKey: "statewide/nc/synthetic-alpha/2026-10-24/nc-synthetic-alpha.parquet" };
  const pmtiles = { localPath: "/tmp/x.pmtiles", bytes: 90, sha256: sha("pm"), contentType: "application/vnd.pmtiles", objectKey: "statewide/nc/synthetic-alpha/2026-10-24/nc-synthetic-alpha.pmtiles" };
  const receipt = (a: typeof parquet) => ({ corpusKey: "statewide-parcels-bulk", objectKey: a.objectKey, bytes: a.bytes, sha256: a.sha256, bucket: "synthetic-bucket", etag: null, uploadedAt: new Date(0) });
  const summary = {
    state: "NC",
    county: "Synthetic Alpha",
    countyField: "CNTYNAME",
    asOf: "2026-10-01T00:00:00.000Z",
    conformance: { ok: true, present: [], missing: [] },
    fetched: 12,
    normalized: 12,
    skippedNoId: 0,
    skippedNoGeometry: 0,
    pages: 1,
    peakRssMb: 50,
  };
  const artifacts = { parquet, pmtiles, rowsWritten: 12, rowsReadBack: 12, tileCount: 3, partitions: 1, maxPartitionFeatures: 12, bbox: [0, 0, 1, 1] as [number, number, number, number] };
  const src = { job: "nc_statewide_cadastral_v1", etlRunId: 41, layerUrl: "https://synthetic.invalid/nc/0", mapping: { apn: "PARNO", owner: "OWNNAME" } };

  it("refuses a dry run", () => {
    expect(() => countyEntryFromBuild({ summary, artifacts, outcome: { status: "dry_run_only", reasons: ["object storage not configured"] } }, src)).toThrow(/not ingested/);
  });

  it("refuses when no receipt matches a built artifact", () => {
    const wrong = { ...receipt(pmtiles), sha256: sha("other") };
    expect(() => countyEntryFromBuild({ summary, artifacts, outcome: { status: "ingested", receipts: [receipt(parquet), wrong] } }, src)).toThrow(/no receipt matches the built pmtiles/);
  });

  it("builds a valid entry from the receipts", () => {
    const e = countyEntryFromBuild({ summary, artifacts, outcome: { status: "ingested", receipts: [receipt(parquet), receipt(pmtiles)] } }, src);
    expect(e).toEqual({
      state: "NC",
      county: "synthetic alpha",
      parcelCount: 12,
      artifacts: [
        { kind: "parquet", bucket: "synthetic-bucket", objectKey: parquet.objectKey, bytes: 100, sha256: parquet.sha256 },
        { kind: "pmtiles", bucket: "synthetic-bucket", objectKey: pmtiles.objectKey, bytes: 90, sha256: pmtiles.sha256 },
      ],
      source: { job: src.job, etlRunId: 41, sourceAsOf: summary.asOf, layerUrl: src.layerUrl, fieldMappingDigest: fieldMappingDigest(src.mapping) },
    });
    const m: ReleaseManifest = { format: "acreos-parcels/release-manifest@1", dataset: "acreos-parcels", mappingVersion: "bulk-row@1", counties: [e] };
    expect(validateManifest(m).ok).toBe(true);
  });

  it("the field-map digest ignores key order and sees any remap", () => {
    expect(fieldMappingDigest({ owner: "OWNNAME", apn: "PARNO" })).toBe(fieldMappingDigest({ apn: "PARNO", owner: "OWNNAME" }));
    expect(fieldMappingDigest({ apn: "PARNO2", owner: "OWNNAME" })).not.toBe(fieldMappingDigest({ apn: "PARNO", owner: "OWNNAME" }));
  });
});

describe("summarizeRelease (the D2g inventory type)", () => {
  it("totals the synthetic base release", () => {
    const s = summarizeRelease(base.manifest, "acreos-parcels v2026.10.1");
    expect(s).toEqual({
      releaseId: releaseIdOf(base.manifest),
      dataset: "acreos-parcels",
      name: "acreos-parcels v2026.10.1",
      mappingVersion: "bulk-row@1",
      states: ["NC", "WI"],
      countyCount: 3,
      parcelCount: 180,
      artifactCount: 5,
      artifactBytes: 3000 + 9000 + 10000 + 5000 + 4500,
      byState: [
        { state: "NC", counties: 2, parcels: 150 },
        { state: "WI", counties: 1, parcels: 30 },
      ],
    });
  });
});

describe("parcelFingerprint", () => {
  it("sees one changed byte of geometry, ignores key order, and treats null as absent", () => {
    const g = new Uint8Array([1, 3, 0, 0, 0]);
    const a = parcelFingerprint({ source_parcel_id: "SYNTHETIC-1", geometry: g, owner_name: null });
    expect(parcelFingerprint({ geometry: new Uint8Array([1, 3, 0, 0, 0]), source_parcel_id: "SYNTHETIC-1" })).toBe(a);
    expect(parcelFingerprint({ source_parcel_id: "SYNTHETIC-1", geometry: new Uint8Array([1, 3, 0, 0, 1]) })).not.toBe(a);
  });
});
