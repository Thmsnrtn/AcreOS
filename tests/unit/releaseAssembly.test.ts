/**
 * D2b §3 — release assembly: only INGESTED county builds enter a release;
 * every other candidate is excluded with its refusal in its own words, and a
 * run with no ingested build yields NO manifest (never an empty release).
 * Builds are labelled SYNTHETIC — no county, digest or bucket here is real.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assembleManifest, stateOfStatewideJob, type LatestCountyBuild } from "../../server/services/landData/releases/releaseAssembly";
import { releaseIdOf, validateManifest } from "../../server/services/landData/releases/releaseManifest";

const sha = (s: string) => createHash("sha256").update(`SYNTHETIC ${s}`).digest("hex");
const art = (county: string, kind: "parquet" | "pmtiles", bytes: number) => ({
  localPath: `/tmp/${county}.${kind}`,
  bytes,
  sha256: sha(`${county}-${kind}`),
  contentType: "application/octet-stream",
  objectKey: `statewide/nc/${county}/2026-10-24/nc-${county}.${sha(`${county}-${kind}`).slice(0, 16)}.${kind}`,
});
function build(county: string, ingested: boolean, remap: Record<string, unknown> | null = null): Record<string, unknown> {
  const parquet = art(county, "parquet", 1200);
  const pmtiles = art(county, "pmtiles", 300);
  const receipt = (a: typeof parquet) => ({ corpusKey: "statewide-parcels-bulk", objectKey: a.objectKey, bytes: a.bytes, sha256: a.sha256, bucket: "synthetic-bucket", etag: null, uploadedAt: "2026-10-24T00:00:00.000Z" });
  return {
    summary: { state: "NC", county: `Synthetic ${county}`, asOf: "2026-10-01T00:00:00.000Z" },
    artifacts: { parquet, pmtiles, rowsWritten: 12, rowsReadBack: 12 },
    outcome: ingested ? { status: "ingested", receipts: [receipt(parquet), receipt(pmtiles)] } : { status: "dry_run_only", reasons: ["NC use classes unresolved (internal, display, redistribution, resale) — dry run only until the dossier resolves them"] },
    remap,
  };
}
const specFor = () => ({ layerUrl: "https://synthetic.invalid/nc/0", mapping: { apn: "PARNO", owner: "OWNNAME" } });

describe("release assembly from the latest builds", () => {
  it("only ingested builds enter; a dry run is excluded with the dossier reason it was refused for", () => {
    const builds: LatestCountyBuild[] = [
      { job: "nc_statewide_cadastral_v1", etlRunId: 7, observation: build("alpha", true) },
      { job: "nc_statewide_cadastral_v1", etlRunId: 8, observation: build("beta", false) },
    ];
    const out = assembleManifest(builds, specFor, "bulk-row@1");
    expect(out.included).toEqual([{ job: "nc_statewide_cadastral_v1", county: "synthetic alpha", etlRunId: 7 }]);
    expect(out.excluded).toEqual([expect.objectContaining({ job: "nc_statewide_cadastral_v1", county: "Synthetic beta", etlRunId: 8, reason: expect.stringMatching(/not ingested.*use classes unresolved/) })]);
    expect(out.manifest).not.toBeNull();
    const check = validateManifest(out.manifest);
    expect(check.ok).toBe(true);
    expect(out.manifest!.counties.map((c) => c.source.etlRunId)).toEqual([7]);
  });

  it("no ingested build → NO manifest (never an empty release) and every candidate is accounted for", () => {
    const out = assembleManifest([{ job: "nc_statewide_cadastral_v1", etlRunId: 3, observation: build("gamma", false) }], specFor, "bulk-row@1");
    expect(out.manifest).toBeNull();
    expect(out.included).toEqual([]);
    expect(out.excluded).toHaveLength(1);
  });

  it("the mapping a build actually used (its promoted remap) is the one the release digests", () => {
    const seed = assembleManifest([{ job: "nc_statewide_cadastral_v1", etlRunId: 1, observation: build("alpha", true) }], specFor, "bulk-row@1");
    const healed = assembleManifest([{ job: "nc_statewide_cadastral_v1", etlRunId: 1, observation: build("alpha", true, { outcome: "promoted", mappingAfter: { apn: "PARNO_2026", owner: "OWNNAME" } }) }], specFor, "bulk-row@1");
    expect(seed.manifest!.counties[0].source.fieldMappingDigest).not.toBe(healed.manifest!.counties[0].source.fieldMappingDigest);
    expect(releaseIdOf(seed.manifest!)).not.toBe(releaseIdOf(healed.manifest!));
  });

  it("a non-statewide job is excluded, never guessed into a state", () => {
    expect(stateOfStatewideJob("nc_statewide_cadastral_v1")).toBe("NC");
    expect(stateOfStatewideJob("regrid_bulk_v1")).toBeNull();
    const out = assembleManifest([{ job: "regrid_bulk_v1", etlRunId: 2, observation: build("alpha", true) }], specFor, "bulk-row@1");
    expect(out.manifest).toBeNull();
    expect(out.excluded[0].reason).toMatch(/not a statewide cadastral job/);
  });
});
