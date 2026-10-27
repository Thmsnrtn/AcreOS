/**
 * Release assembly dedupes by source_parcel_id (founder decision 2026-10-27).
 *
 * A county artifact can repeat a parcel id: the source serves one APN on two
 * features and D2a's stable sort keeps both. Before this, assembly named such
 * an artifact as built, and the county was then REFUSED downstream (lineage:
 * duplicate_source_id; the release diff: unsorted/duplicate input). Now the
 * real assembly entrypoint reads each included county back, keeps the LAST
 * copy of a repeated id (artifact order = stable id sort over OBJECTID ASC
 * paging, so the highest source OBJECTID wins), and stores a release naming a
 * deduped, bucket-confirmed artifact pair. The downstream refusals stay.
 *
 * Real artifacts (StreamingArtifactWriter + BULK_SCHEMA, exactly as a build
 * writes them) in a file-backed object store; SYNTHETIC parcels only.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const root = mkdtempSync(path.join(os.tmpdir(), "acreos-dedupe-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A bucket that is a directory: putFile copies in, getFile copies out. */
function fileStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  const at = (key: string) => path.join(dir, key.replace(/\//g, "__"));
  const puts: string[] = [];
  return {
    puts,
    client: {
      bucket: "synthetic-bucket",
      put: async () => {
        throw new Error("bulk artifacts are never buffered");
      },
      putFile: async (key: string, filePath: string) => {
        copyFileSync(filePath, at(key));
        puts.push(key);
        return { etag: null };
      },
      headBytes: async (key: string) => {
        try {
          return statSync(at(key)).size;
        } catch {
          return null;
        }
      },
      getFile: async (key: string, dest: string) => {
        copyFileSync(at(key), dest);
        return statSync(dest).size;
      },
    },
  };
}

const square = (i: number) => ({
  type: "Polygon" as const,
  coordinates: [[[-78.6 + i * 1e-3, 35.7], [-78.6 + i * 1e-3 + 5e-4, 35.7], [-78.6 + i * 1e-3 + 5e-4, 35.7005], [-78.6 + i * 1e-3, 35.7005], [-78.6 + i * 1e-3, 35.7]]],
});
const row = (id: string, situs: string, i: number) => ({
  source_parcel_id: id,
  state: "NC",
  county: "wake",
  owner_name: undefined,
  situs_address: situs,
  assessed_value_usd: 1000 + i,
  market_value_usd: undefined,
  last_sale_price_usd: undefined,
  legal_description: undefined,
  provenance_json: "{}",
  geometry: square(i),
});

/** Build + upload a county artifact pair exactly as buildCounty does; returns its build observation and release entry. */
async function asBuilt(store: ReturnType<typeof fileStore>, rows: ReturnType<typeof row>[], stem: string) {
  const { StreamingArtifactWriter } = await import("../../server/services/landData/streamingArtifacts");
  const { BULK_SCHEMA, artifactObjectKey } = await import("../../server/services/landData/statewideCadastral");
  const { uploadFileAndConfirm } = await import("../../server/services/landData/openDataBucket");
  const out = mkdtempSync(path.join(root, "build-"));
  const w = new StreamingArtifactWriter(
    { outDir: out, stem, schemaDef: BULK_SCHEMA, layerName: "parcels", tileName: "t", tileDescription: "d", attribution: "a" },
    (r: { source_parcel_id: string }) => ({ parcel_id: r.source_parcel_id }),
  );
  await w.open();
  for (const r of rows) await w.write(r as never);
  const built = await w.finish();
  const keyed = {
    parquet: { ...built.parquet, objectKey: artifactObjectKey("statewide/nc/wake/2026-10-27", stem, built.parquet, "parquet") },
    pmtiles: { ...built.pmtiles, objectKey: artifactObjectKey("statewide/nc/wake/2026-10-27", stem, built.pmtiles, "pmtiles") },
  };
  const receipts = [];
  for (const a of [keyed.parquet, keyed.pmtiles]) receipts.push(await uploadFileAndConfirm(store.client as never, "statewide-parcels-bulk", a.objectKey, a));
  // The etl_runs.observation a statewide build writes (CountyBuildReport shape).
  const observation = {
    kind: "statewide_cadastral_build",
    summary: { state: "NC", county: "Wake", asOf: "2026-10-01T00:00:00.000Z" },
    artifacts: { ...built, ...keyed },
    outcome: { status: "ingested", receipts },
  };
  const { countyEntryFromBuild } = await import("../../server/services/landData/releases/releaseManifest");
  const entry = countyEntryFromBuild(observation as never, { job: "nc_statewide_cadastral_v1", etlRunId: 1, layerUrl: "https://example.invalid/layer", mapping: { apn: "PARNO" } });
  return { observation: observation as unknown as Record<string, unknown>, entry };
}

async function rowsOf(store: ReturnType<typeof fileStore>, objectKey: string) {
  const { readGeoParquetRows } = await import("../../server/services/landData/geoParquet");
  const local = path.join(mkdtempSync(path.join(root, "read-")), "x.parquet");
  await store.client.getFile(objectKey, local);
  return (await readGeoParquetRows<{ source_parcel_id: string; situs_address: string | null; geometry: never }>(local)).rows;
}

describe("dedupeBySourceParcelId (pure)", () => {
  it("keeps the LAST copy of each id, in the rows' own order, and counts the drops", async () => {
    const { dedupeBySourceParcelId } = await import("../../server/services/landData/releases/releaseAssembly");
    const r = dedupeBySourceParcelId([
      { source_parcel_id: "A", v: 1 },
      { source_parcel_id: "B", v: 2 },
      { source_parcel_id: "B", v: 3 },
      { source_parcel_id: "C", v: 4 },
      { source_parcel_id: "B", v: 5 },
    ]);
    expect(r.rows.map((x) => [x.source_parcel_id, x.v])).toEqual([["A", 1], ["C", 4], ["B", 5]]);
    expect(r.dropped).toBe(2);
    expect(r.repeatedIds).toEqual(["B"]);
  });
});

describe("assembleAndStoreRelease — one row per source_parcel_id, deduped in assembly", () => {
  it("a county artifact that repeats an id is stored deduped (later copy wins), and lineage accepts it where the as-built artifact is refused", async () => {
    const store = fileStore(path.join(root, "bucket-dup"));
    // As a build writes it: stable id sort over OBJECTID ASC paging, so the
    // second SYNTHETIC-B is the higher OBJECTID — the copy that must win.
    const { observation, entry } = await asBuilt(store, [row("SYNTHETIC-A", "1 OLD RD", 1), row("SYNTHETIC-B", "2 FIRST COPY", 2), row("SYNTHETIC-B", "2 LATER COPY", 3), row("SYNTHETIC-C", "3 OLD RD", 4)], "nc-wake");
    expect(entry.parcelCount).toBe(4);

    const { classifyLineage } = await import("@shared/landData/lineage");
    const { toLineageSide } = await import("../../server/services/landData/releases/releaseLineage");
    const asBuiltRows = await rowsOf(store, entry.artifacts[0].objectKey);
    // Control: the as-built artifact is exactly what downstream refuses.
    expect(classifyLineage({ previous: [], next: toLineageSide(asBuiltRows) })).toMatchObject({ ok: false, reason: "duplicate_source_id" });

    const { assembleAndStoreRelease } = await import("../../server/services/landData/releases/releaseAssembly");
    const { validateManifest } = await import("../../server/services/landData/releases/releaseManifest");
    const stored: unknown[] = [];
    const report = await assembleAndStoreRelease("test", {
      loadBuilds: async () => [{ job: "nc_statewide_cadastral_v1", etlRunId: 1, observation }],
      objectStore: async () => store.client as never,
      storeRelease: async (m) => {
        stored.push(m);
        return { releaseId: "sha256:" + "a".repeat(64), created: true };
      },
    });
    expect(report.included).toEqual([{ job: "nc_statewide_cadastral_v1", county: "wake", etlRunId: 1 }]);
    expect(report.deduped).toEqual([expect.objectContaining({ state: "NC", county: "wake", dropped: 1, repeatedIds: ["SYNTHETIC-B"] })]);
    expect(stored).toHaveLength(1);
    // What was stored is a valid manifest — the store would accept it.
    expect(validateManifest(stored[0]).ok).toBe(true);
    const m = stored[0] as { counties: Array<{ parcelCount: number; artifacts: Array<{ kind: string; objectKey: string; sha256: string }> }> };
    const c = m.counties[0];
    expect(c.parcelCount).toBe(3);
    // The release names a NEW, bucket-confirmed artifact pair, not the build's.
    expect(c.artifacts.map((a) => a.kind)).toEqual(["parquet", "pmtiles"]);
    expect(c.artifacts[0].sha256).not.toBe(entry.artifacts[0].sha256);
    expect(store.puts).toContain(c.artifacts[0].objectKey);
    expect(store.puts).toContain(c.artifacts[1].objectKey);

    const deduped = await rowsOf(store, c.artifacts[0].objectKey);
    expect(deduped.map((r) => r.source_parcel_id)).toEqual(["SYNTHETIC-A", "SYNTHETIC-B", "SYNTHETIC-C"]);
    expect(deduped.find((r) => r.source_parcel_id === "SYNTHETIC-B")?.situs_address).toBe("2 LATER COPY");
    // Downstream now accepts the county instead of refusing it.
    expect(classifyLineage({ previous: [], next: toLineageSide(deduped) })).toMatchObject({ ok: true });
  });

  it("a county with no repeated id is named exactly as built — nothing rewritten, nothing uploaded", async () => {
    const store = fileStore(path.join(root, "bucket-clean"));
    const { entry } = await asBuilt(store, [row("SYNTHETIC-A", "1 RD", 1), row("SYNTHETIC-B", "2 RD", 2)], "nc-wake");
    const uploadsBefore = store.puts.length;
    const { dedupeCountyEntry } = await import("../../server/services/landData/releases/releaseAssembly");
    const r = await dedupeCountyEntry(entry as never, { client: store.client as never });
    expect(r.dedupe).toBeNull();
    expect(r.entry).toBe(entry);
    expect(store.puts.length).toBe(uploadsBefore);
  });

  it("refuses an artifact whose bytes do not match the manifest digest", async () => {
    const store = fileStore(path.join(root, "bucket-tamper"));
    const { entry } = await asBuilt(store, [row("SYNTHETIC-A", "1 RD", 1)], "nc-wake");
    const tampered = { ...entry, artifacts: entry.artifacts.map((a) => (a.kind === "parquet" ? { ...a, sha256: "0".repeat(64) } : a)) };
    const { dedupeCountyEntry } = await import("../../server/services/landData/releases/releaseAssembly");
    await expect(dedupeCountyEntry(tampered as never, { client: store.client as never })).rejects.toThrow(/does not match its manifest digest/);
  });

  it("refuses to store a release it could not check: an included county with no object store configured", async () => {
    const store = fileStore(path.join(root, "bucket-nostore"));
    const { observation } = await asBuilt(store, [row("SYNTHETIC-A", "1 RD", 1)], "nc-wake");
    const { assembleAndStoreRelease } = await import("../../server/services/landData/releases/releaseAssembly");
    const storeRelease = vi.fn(async () => ({ releaseId: "x", created: true }));
    await expect(
      assembleAndStoreRelease("test", { loadBuilds: async () => [{ job: "nc_statewide_cadastral_v1", etlRunId: 1, observation }], objectStore: async () => null, storeRelease }),
    ).rejects.toThrow(/object storage not configured/);
    expect(storeRelease).not.toHaveBeenCalled();
    // Nothing included → nothing to check, nothing stored.
    const empty = await assembleAndStoreRelease("test", { loadBuilds: async () => [], objectStore: async () => null, storeRelease });
    expect(empty).toMatchObject({ release: null, deduped: [] });
  });
});
