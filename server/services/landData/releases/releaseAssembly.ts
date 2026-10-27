/**
 * Release assembly — D2b §3 (the caller that makes the release store real).
 *
 * Reads the latest SUCCESSFUL build of each county from every statewide
 * cadastral job's run series (etl_runs.observation — each a CountyBuildReport,
 * written by etlHandlers' statewide handler) and stores ONE release from the
 * ones that were INGESTED. countyEntryFromBuild refuses a dry run or an
 * unreceipted artifact, so a county that was never bucket-confirmed can never
 * enter a release. Today every wave-1 build is a dry run (dossiers unresolved),
 * so an assembly run honestly stores nothing and says why, per county.
 *
 * ONE ROW PER source_parcel_id (founder decision 2026-10-27). A county
 * artifact can repeat a parcel id — the source layer serves the same APN on
 * two features, and D2a's external sort is stable, so it keeps both. Lineage
 * and the release diff REFUSE such a county (they stay as defense in depth),
 * so assembly dedupes it first: each included county's parquet is read back
 * from the bucket (digest-checked), and when an id repeats, the LAST copy in
 * artifact order wins. Artifact order is the stable id sort over the source's
 * `OBJECTID ASC` paging, so the winner is the copy with the highest source
 * OBJECTID — in an ArcGIS feature layer, the most recently inserted record.
 * The rows carry no per-row edit date (provenance holds one build-wide asOf),
 * so this is the deterministic rule, not a judgement of which copy is right.
 * A county with a repeated id gets a deduped artifact pair, uploaded and
 * bucket-confirmed like a build's, and the release names THAT pair; a county
 * without one is named exactly as built. Every drop is reported.
 *
 * Run by the ETL job acreos_parcels_release_assemble (seeded inactive, 0290).
 * Assembly never promotes: making a release current is a founder action
 * (POST /api/founder/releases/:releaseId/promote).
 */

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ObjectStoreClient, UploadReceipt } from "../openDataBucket";
import type { BulkRow } from "../statewideCadastral";
import { countyEntryFromBuild, DATASET, MANIFEST_FORMAT, type BuildForRelease, type ReleaseArtifactRef, type ReleaseCountyEntry, type ReleaseManifest } from "./releaseManifest";

/** One candidate build: the newest successful run for a (job, county). */
export interface LatestCountyBuild {
  job: string;
  etlRunId: number;
  observation: Record<string, unknown>;
}

export interface AssemblyOutcome {
  /** The manifest to store, or null when no county qualified. */
  manifest: ReleaseManifest | null;
  included: Array<{ job: string; county: string; etlRunId: number }>;
  /** Every candidate that did not enter, with the refusal in its own words. */
  excluded: Array<{ job: string; county: string | null; etlRunId: number; reason: string }>;
}

/** Job name → state (`nc_statewide_cadastral_v1` → `NC`). */
export function stateOfStatewideJob(job: string): string | null {
  const m = /^([a-z]{2})_statewide_cadastral_v1$/.exec(job);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Pure: the manifest from the latest builds. `specFor` supplies the layer
 * URL and the seed mapping for a state (statewideCadastral.buildSpecFor);
 * the mapping a build used is its promoted remap when one ran.
 */
export function assembleManifest(
  builds: readonly LatestCountyBuild[],
  specFor: (state: string) => { layerUrl: string; mapping: Readonly<Record<string, string | undefined>> },
  mappingVersion: string,
): AssemblyOutcome {
  const counties: ReleaseCountyEntry[] = [];
  const included: AssemblyOutcome["included"] = [];
  const excluded: AssemblyOutcome["excluded"] = [];
  for (const b of builds) {
    const summary = (b.observation.summary ?? null) as { county?: unknown } | null;
    const county = typeof summary?.county === "string" ? summary.county : null;
    const state = stateOfStatewideJob(b.job);
    if (!state) {
      excluded.push({ job: b.job, county, etlRunId: b.etlRunId, reason: "not a statewide cadastral job" });
      continue;
    }
    try {
      const spec = specFor(state);
      const remap = (b.observation.remap ?? null) as { mappingAfter?: Record<string, string | undefined> } | null;
      const entry = countyEntryFromBuild(b.observation as unknown as BuildForRelease, {
        job: b.job,
        etlRunId: b.etlRunId,
        layerUrl: spec.layerUrl,
        mapping: remap?.mappingAfter ?? spec.mapping,
      });
      counties.push(entry);
      included.push({ job: b.job, county: entry.county, etlRunId: b.etlRunId });
    } catch (err) {
      excluded.push({ job: b.job, county, etlRunId: b.etlRunId, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    manifest: counties.length > 0 ? { format: MANIFEST_FORMAT, dataset: DATASET, mappingVersion, counties } : null,
    included,
    excluded,
  };
}

// ── One row per source_parcel_id ────────────────────────────────────────

/**
 * Pure: keep the LAST row for each source_parcel_id, in the rows' own order.
 * On an artifact (stable id sort over OBJECTID ASC paging) that is the copy
 * with the highest source OBJECTID — see the header.
 */
export function dedupeBySourceParcelId<R extends { source_parcel_id: string }>(rows: readonly R[]): { rows: R[]; dropped: number; repeatedIds: string[] } {
  const last = new Map<string, number>();
  rows.forEach((r, i) => last.set(r.source_parcel_id, i));
  const repeated = new Set<string>();
  const kept: R[] = [];
  rows.forEach((r, i) => {
    if (last.get(r.source_parcel_id) === i) kept.push(r);
    else repeated.add(r.source_parcel_id);
  });
  return { rows: kept, dropped: rows.length - kept.length, repeatedIds: [...repeated] };
}

export interface CountyDedupe {
  state: string;
  county: string;
  /** Rows dropped because a later copy of the same id won. */
  dropped: number;
  /** Up to 20 of the repeated ids, for the report. */
  repeatedIds: string[];
  /** The artifact pair the release names instead of the build's. */
  artifacts: ReleaseArtifactRef[];
}

export interface DedupeDeps {
  client: ObjectStoreClient;
  /** Records a confirmed receipt on the county's coverage row (openDataBucket.recordReceipt). */
  recordReceipt?: (state: string, county: string, r: UploadReceipt) => Promise<void>;
  workDir?: string;
}

const NULL_TO_UNDEFINED = ["county", "owner_name", "situs_address", "assessed_value_usd", "market_value_usd", "last_sale_price_usd", "legal_description"] as const;

/**
 * One county entry with one row per source_parcel_id. Reads the entry's
 * parquet back (digest-checked against the manifest), and when an id repeats
 * writes, uploads and confirms a deduped artifact pair and returns an entry
 * naming it. An entry with no repeated id is returned unchanged.
 */
export async function dedupeCountyEntry(entry: ReleaseCountyEntry, deps: DedupeDeps): Promise<{ entry: ReleaseCountyEntry; dedupe: CountyDedupe | null }> {
  const parquetRef = entry.artifacts.find((a) => a.kind === "parquet");
  if (!parquetRef) throw new Error(`refused: ${entry.state} ${entry.county} names no parquet artifact`);
  if (!deps.client.getFile) throw new Error("refused: this object store cannot read artifacts back — repeated parcel ids cannot be checked");
  const work = deps.workDir ?? mkdtempSync(path.join(os.tmpdir(), "acreos-assembly-"));
  try {
    const local = path.join(work, `${parquetRef.sha256}.parquet`);
    await deps.client.getFile(parquetRef.objectKey, local);
    const { fileDigest } = await import("../streamingArtifacts");
    const got = await fileDigest(local);
    if (got.sha256 !== parquetRef.sha256 || got.bytes !== parquetRef.bytes) {
      throw new Error(`refused: ${parquetRef.objectKey} does not match its manifest digest`);
    }
    const { readGeoParquetRows } = await import("../geoParquet");
    const { rows } = await readGeoParquetRows<BulkRow>(local);
    rmSync(local, { force: true });
    const d = dedupeBySourceParcelId(rows);
    if (d.dropped === 0) return { entry, dedupe: null };

    // Rewrite the county with its winners, exactly as a build writes it.
    const { BULK_SCHEMA, artifactObjectKey, buildSpecFor } = await import("../statewideCadastral");
    const { StreamingArtifactWriter } = await import("../streamingArtifacts");
    const { uploadFileAndConfirm } = await import("../openDataBucket");
    const spec = buildSpecFor(entry.state);
    const stem = `${entry.state.toLowerCase()}-${entry.county.replace(/[^a-z0-9]+/g, "-")}-dedup`;
    const writer = new StreamingArtifactWriter<BulkRow>(
      {
        outDir: work,
        stem,
        schemaDef: BULK_SCHEMA,
        layerName: "parcels",
        tileName: `AcreOS ${entry.state} parcels`,
        tileDescription: `${entry.state} ${entry.county}`,
        attribution: `Parcels: ${spec.attribution}`,
      },
      (row) => ({ parcel_id: row.source_parcel_id }),
    );
    await writer.open();
    let built;
    try {
      for (const r of d.rows) {
        const row = { ...r } as Record<string, unknown>;
        for (const k of NULL_TO_UNDEFINED) if (row[k] === null) row[k] = undefined;
        await writer.write(row as unknown as BulkRow);
      }
      built = await writer.finish();
    } catch (err) {
      writer.discard();
      throw err;
    }
    if (built.rowsWritten !== d.rows.length || built.rowsReadBack !== d.rows.length) {
      throw new Error(`refused: deduped ${entry.county} wrote ${built.rowsWritten} / read back ${built.rowsReadBack} rows, expected ${d.rows.length}`);
    }
    const prefix = path.posix.dirname(parquetRef.objectKey);
    const artifacts: ReleaseArtifactRef[] = [];
    for (const [kind, a] of [["parquet", built.parquet], ["pmtiles", built.pmtiles]] as const) {
      const r = await uploadFileAndConfirm(deps.client, "statewide-parcels-bulk", artifactObjectKey(prefix, stem, a, kind), a);
      if (deps.recordReceipt) await deps.recordReceipt(entry.state, entry.county, r);
      artifacts.push({ kind, bucket: r.bucket, objectKey: r.objectKey, bytes: r.bytes, sha256: r.sha256 });
    }
    const dedupe: CountyDedupe = { state: entry.state, county: entry.county, dropped: d.dropped, repeatedIds: d.repeatedIds.slice(0, 20), artifacts };
    return { entry: { ...entry, parcelCount: d.rows.length, artifacts }, dedupe };
  } finally {
    if (!deps.workDir) rmSync(work, { recursive: true, force: true });
  }
}

/** Every county of a manifest, one row per source_parcel_id (county by county: memory holds one county). */
async function dedupeManifest(manifest: ReleaseManifest, deps: DedupeDeps): Promise<{ manifest: ReleaseManifest; deduped: CountyDedupe[] }> {
  const counties: ReleaseCountyEntry[] = [];
  const deduped: CountyDedupe[] = [];
  for (const c of manifest.counties) {
    const r = await dedupeCountyEntry(c, deps);
    counties.push(r.entry);
    if (r.dedupe) deduped.push(r.dedupe);
  }
  return { manifest: { ...manifest, counties }, deduped };
}

/** The newest successful run per (statewide job, county). */
async function loadLatestCountyBuilds(): Promise<LatestCountyBuild[]> {
  const { db } = await import("../../../db");
  const { etlJobs, etlRuns } = await import("@shared/schema");
  const { and, desc, eq, isNotNull, like } = await import("drizzle-orm");
  const rows = await db
    .select({ job: etlJobs.jobName, etlRunId: etlRuns.id, observation: etlRuns.observation })
    .from(etlRuns)
    .innerJoin(etlJobs, eq(etlRuns.jobId, etlJobs.id))
    .where(and(like(etlJobs.jobName, "%\\_statewide\\_cadastral\\_v1"), eq(etlRuns.status, "success"), isNotNull(etlRuns.observation)))
    .orderBy(desc(etlRuns.startedAt))
    .limit(5000);
  const seen = new Set<string>();
  const latest: LatestCountyBuild[] = [];
  for (const r of rows) {
    const obs = (r.observation ?? null) as Record<string, unknown> | null;
    if (!obs) continue;
    const county = ((obs.summary ?? null) as { county?: unknown } | null)?.county;
    const key = `${r.job}|${typeof county === "string" ? county : `run:${r.etlRunId}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push({ job: r.job, etlRunId: r.etlRunId, observation: obs });
  }
  return latest;
}

export interface AssemblyReport extends Omit<AssemblyOutcome, "manifest"> {
  kind: "acreos_parcels_release_assembly";
  /** The stored release, or null when nothing qualified. */
  release: { releaseId: string; created: boolean; counties: number } | null;
  /** Counties whose repeated parcel ids were deduped before storing (empty when none repeated). */
  deduped: CountyDedupe[];
}

export interface AssemblyDeps {
  loadBuilds: () => Promise<LatestCountyBuild[]>;
  /** The bucket client the included artifacts are read back from; null when none is configured. */
  objectStore: () => Promise<ObjectStoreClient | null>;
  storeRelease: (m: ReleaseManifest, createdBy: string) => Promise<{ releaseId: string; created: boolean }>;
  recordReceipt?: DedupeDeps["recordReceipt"];
}

async function liveAssemblyDeps(): Promise<AssemblyDeps> {
  const { storeRelease } = await import("./releaseStore");
  const { bucketConfigFromEnv, s3ClientFor, recordReceipt } = await import("../openDataBucket");
  return {
    loadBuilds: loadLatestCountyBuilds,
    objectStore: async () => {
      const cfg = bucketConfigFromEnv();
      return cfg ? s3ClientFor(cfg) : null;
    },
    storeRelease,
    recordReceipt,
  };
}

/**
 * Assemble from the latest builds, dedupe each county by source_parcel_id,
 * and store the release (idempotent on content). Assembly never promotes.
 */
export async function assembleAndStoreRelease(createdBy: string, deps?: AssemblyDeps): Promise<AssemblyReport> {
  const d = deps ?? (await liveAssemblyDeps());
  const { buildSpecFor, BULK_ROW_VERSION } = await import("../statewideCadastral");
  const outcome = assembleManifest(await d.loadBuilds(), (st) => buildSpecFor(st), BULK_ROW_VERSION);
  let manifest = outcome.manifest;
  let deduped: CountyDedupe[] = [];
  if (manifest) {
    const client = await d.objectStore();
    // Included counties are bucket-confirmed, so a bucket must exist to read them back.
    if (!client) throw new Error("refused: object storage not configured — the release's artifacts cannot be checked for repeated parcel ids");
    ({ manifest, deduped } = await dedupeManifest(manifest, { client, recordReceipt: d.recordReceipt }));
  }
  const stored = manifest ? await d.storeRelease(manifest, createdBy) : null;
  return {
    kind: "acreos_parcels_release_assembly",
    release: stored && manifest ? { ...stored, counties: manifest.counties.length } : null,
    included: outcome.included,
    excluded: outcome.excluded,
    deduped,
  };
}
