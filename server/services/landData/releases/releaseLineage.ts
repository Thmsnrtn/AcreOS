/**
 * Release lineage — D2c §2 wiring: the CURRENT release's lineage applied to
 * each county's persisted APID ledger (apidStore.applyCountyRelease).
 *
 * For every county in the current release:
 *   - next     = that county's rows in the current release's parquet artifact;
 *   - previous = the same county's rows in the release that was current when
 *                this one was promoted (its previousReleaseId), or [] when that
 *                release did not cover the county (first appearance → all new);
 *   - ordinal  = the seq of the release's promote entry (strictly increasing
 *                along promotions).
 * Artifacts are read back from the bucket by their receipted keys and checked
 * against the manifest's sha256 before use — a release names exact bytes.
 *
 * Refusals are per county and stated, never guessed past:
 *   - no county FIPS reference for the county (APIDs are FIPS-scoped; only TN
 *     has a reference in this repo today — tnCountyBoundaries.json);
 *   - the current pointer entry is a rollback (lineage only moves forward;
 *     the ledger keeps the newer release's state);
 *   - an artifact that does not match its manifest digest.
 *
 * Memory: classifyLineage holds both releases' shapes for ONE county, so this
 * runs county by county (docs/land-data/INTEGRATION-D2c.md §2).
 */

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LineageInput, LineageParcel } from "@shared/landData/lineage";
import tnBoundaries from "@shared/landData/tnCountyBoundaries.json";
import type { ReleaseCountyEntry } from "./releaseManifest";

/** The 5-digit county FIPS for a release county, or null when no reference covers it. */
export function countyFipsFor(state: string, county: string): string | null {
  if (state.toUpperCase() !== "TN") return null;
  const want = county.trim().toLowerCase().replace(/ county$/, "");
  const f = (tnBoundaries as { features: Array<{ properties: { fips: string; name: string } }> }).features.find((x) => x.properties.name.toLowerCase() === want);
  return f ? f.properties.fips : null;
}

/** Artifact rows → one side of a LineageInput (the adapter of INTEGRATION-D2c §2). */
export function toLineageSide(rows: ReadonlyArray<{ source_parcel_id: string; geometry: unknown }>): LineageParcel[] {
  return rows.map((r) => {
    const g = r.geometry as { type?: string } | null;
    return {
      sourceId: r.source_parcel_id,
      geometry: g && (g.type === "Polygon" || g.type === "MultiPolygon") ? (g as LineageParcel["geometry"]) : null,
    };
  });
}

export interface CountyLineageOutcome {
  state: string;
  county: string;
  countyFips: string | null;
  status: "applied" | "already_applied" | "refused";
  detail: string;
}

export interface ReleaseLineageReport {
  kind: "acreos_parcels_lineage_apply";
  releaseId: string | null;
  ordinal: number | null;
  /** Why nothing ran, when nothing ran. */
  skipped: string | null;
  counties: CountyLineageOutcome[];
}

const keyOf = (c: Pick<ReleaseCountyEntry, "state" | "county">) => `${c.state}|${c.county}`;

/** Apply the current release's lineage, county by county. */
export async function applyCurrentReleaseLineage(): Promise<ReleaseLineageReport> {
  const { loadPointerHistory, loadRelease } = await import("./releaseStore");
  const history = await loadPointerHistory();
  const cur = history[history.length - 1];
  const base: ReleaseLineageReport = { kind: "acreos_parcels_lineage_apply", releaseId: cur?.releaseId ?? null, ordinal: null, skipped: null, counties: [] };
  if (!cur) return { ...base, skipped: "no release has been promoted" };
  if (cur.action === "rollback") return { ...base, skipped: `the current entry is a rollback to ${cur.releaseName} — lineage only moves forward; the ledger keeps the newer release's state` };
  const manifest = await loadRelease(cur.releaseId);
  if (!manifest) throw new Error(`release ${cur.releaseId} is in the pointer history but not stored`);
  const prevManifest = cur.previousReleaseId ? await loadRelease(cur.previousReleaseId) : null;
  const prevByCounty = new Map((prevManifest?.counties ?? []).map((c) => [keyOf(c), c]));

  const { bucketConfigFromEnv, s3ClientFor } = await import("../openDataBucket");
  const cfg = bucketConfigFromEnv();
  const { applyCountyRelease } = await import("../apidStore");
  const work = mkdtempSync(path.join(os.tmpdir(), "acreos-lineage-"));
  const counties: CountyLineageOutcome[] = [];
  try {
    const client = cfg ? await s3ClientFor(cfg) : null;
    const rowsOf = async (entry: ReleaseCountyEntry): Promise<LineageParcel[]> => {
      const a = entry.artifacts.find((x) => x.kind === "parquet");
      if (!a) throw new Error("the release names no parquet artifact for this county");
      if (!client?.getFile) throw new Error("object storage not configured — release artifacts cannot be read back");
      const local = path.join(work, `${a.sha256}.parquet`);
      await client.getFile(a.objectKey, local);
      const { fileDigest } = await import("../streamingArtifacts");
      const got = await fileDigest(local);
      if (got.sha256 !== a.sha256 || got.bytes !== a.bytes) throw new Error(`${a.objectKey} does not match its manifest digest — the release names exact bytes`);
      const { readGeoParquetRows } = await import("../geoParquet");
      const { rows } = await readGeoParquetRows<{ source_parcel_id: string; geometry: never }>(local);
      rmSync(local, { force: true });
      return toLineageSide(rows);
    };
    for (const entry of manifest.counties) {
      const fips = countyFipsFor(entry.state, entry.county);
      const out = { state: entry.state, county: entry.county, countyFips: fips };
      if (!fips) {
        counties.push({ ...out, status: "refused", detail: `no county FIPS reference for ${entry.state} — APIDs are FIPS-scoped and none is guessed` });
        continue;
      }
      try {
        const prev = prevByCounty.get(keyOf(entry));
        const input: LineageInput = { previous: prev ? await rowsOf(prev) : [], next: await rowsOf(entry) };
        const r = await applyCountyRelease({ state: entry.state, countyFips: fips, release: { releaseId: cur.releaseId, ordinal: cur.seq }, input });
        counties.push({ ...out, status: r.status, detail: r.status === "applied" ? `${r.events} events, ${r.minted} APIDs minted, ${r.retiredOrHeld} retired or held` : r.detail });
      } catch (err) {
        counties.push({ ...out, status: "refused", detail: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { ...base, ordinal: cur.seq, counties };
}
