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
 * Run by the ETL job acreos_parcels_release_assemble (seeded inactive, 0290).
 * Assembly never promotes: making a release current is a founder action
 * (POST /api/founder/releases/:releaseId/promote).
 */

import { countyEntryFromBuild, DATASET, MANIFEST_FORMAT, type BuildForRelease, type ReleaseCountyEntry, type ReleaseManifest } from "./releaseManifest";

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
}

/** Assemble from the latest builds and store the release (idempotent on content). */
export async function assembleAndStoreRelease(createdBy: string): Promise<AssemblyReport> {
  const { buildSpecFor, BULK_ROW_VERSION } = await import("../statewideCadastral");
  const { storeRelease } = await import("./releaseStore");
  const outcome = assembleManifest(await loadLatestCountyBuilds(), (st) => buildSpecFor(st), BULK_ROW_VERSION);
  const stored = outcome.manifest ? await storeRelease(outcome.manifest, createdBy) : null;
  return {
    kind: "acreos_parcels_release_assembly",
    release: stored && outcome.manifest ? { ...stored, counties: outcome.manifest.counties.length } : null,
    included: outcome.included,
    excluded: outcome.excluded,
  };
}
