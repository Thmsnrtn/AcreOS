/**
 * Statewide first-party ingest — a LOCAL DRY RUN of one county against the
 * live layer (first-party ingest package 2026-11-03, §2.11 / §9.1–9.2).
 *
 * What it does, in order, and nothing else:
 *   1. asks the registry whether the state is admitted to ingest (internal use
 *      allowed after the re-verification radar). A refused state stops here,
 *      before any request;
 *   2. reads the PUBLISHER's own count for the county (a count-only query on
 *      the layer) BEFORE the fetch;
 *   3. streams the county through buildCounty with bucketConfigured:false —
 *      artifacts are built in a temp dir and never uploaded, so the outcome is
 *      "dry_run_only" by construction;
 *   4. reconciles: rows in = rows stored + rows rejected-with-reason, and rows
 *      in = the publisher's figure; then re-counts at the source so a delta
 *      can be attributed to a source-side change;
 *   5. prints one JSON evidence record (manifest-shaped: artifact digests,
 *      counts, reconciliation, peak RSS) and deletes the artifacts.
 *
 * It writes no database row and touches no bucket. It is the pre-merge proof
 * that the pipeline runs against the live layer; the staging proof (§9) is a
 * separate, post-merge step.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/land-data/statewide-dry-run.ts --state WI --county PEPIN [--county-field CONAME]
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const state = (arg("state") ?? "").toUpperCase();
  const county = arg("county") ?? "";
  const countyField = arg("county-field") ?? "CONAME";
  if (!state || !county) throw new Error("usage: --state XX --county NAME [--county-field FIELD]");

  const { statewideIngestAdmission } = await import("../../server/services/openData/statewideSourceRegistry");
  const admission = statewideIngestAdmission(state);
  if (!admission.admitted) {
    process.stdout.write(`${JSON.stringify({ state, county, refused: true, fetches: 0, reasons: admission.reasons }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const { fetchGeo } = await import("../../server/services/providers/fetchGeo");
  const { buildCounty, buildSpecFor, reconcileCountyBuild } = await import("../../server/services/landData/statewideCadastral");
  const urls: string[] = [];
  const getJson = async (url: string) => {
    urls.push(url);
    const res = await fetchGeo(url, { timeoutMs: 60_000, ratePerSec: 2, maxConcurrentPerHost: 1 });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body, etag: res.headers?.get?.("etag") ?? null };
  };

  const spec = buildSpecFor(state);
  const where = `${countyField} = '${county.replace(/'/g, "''")}'`;
  const countOnce = async () => {
    const r = await getJson(`${spec.layerUrl}/query?${new URLSearchParams({ where, returnCountOnly: "true", f: "json" })}`);
    const n = (r.body as { count?: unknown } | null)?.count;
    if (typeof n !== "number") throw new Error(`the ${state} layer returned no count for ${county}`);
    return n;
  };
  const before = await countOnce();
  const countedAt = new Date().toISOString();

  const outDir = mkdtempSync(path.join(os.tmpdir(), `dry-${state.toLowerCase()}-`));
  const t0 = Date.now();
  try {
    const report = await buildCounty(spec, { countyField, countyValue: county }, {
      getJson,
      outDir,
      bucketConfigured: false,
      today: new Date().toISOString().slice(0, 10),
    });
    const after = await countOnce();
    const rec = reconcileCountyBuild(report, { count: before, source: `${spec.layerUrl} count-only query, ${countedAt}` });
    process.stdout.write(
      `${JSON.stringify(
        {
          state,
          county,
          layerUrl: spec.layerUrl,
          asOf: report.summary.asOf,
          admission,
          outcome: report.outcome,
          gate: report.gate,
          summary: report.summary,
          artifacts: {
            parquet: { sha256: report.artifacts.parquet.sha256, bytes: report.artifacts.parquet.bytes, objectKey: report.artifacts.parquet.objectKey },
            pmtiles: { sha256: report.artifacts.pmtiles.sha256, bytes: report.artifacts.pmtiles.bytes, objectKey: report.artifacts.pmtiles.objectKey },
            rowsWritten: report.artifacts.rowsWritten,
            rowsReadBack: report.artifacts.rowsReadBack,
            tileCount: report.artifacts.tileCount,
          },
          reconciliation: rec,
          recountAfterFetch: after,
          requests: urls.length,
          seconds: Math.round((Date.now() - t0) / 1000),
          peakRssMb: report.summary.peakRssMb,
          rssCeilingMb: report.rssCeilingMb,
        },
        null,
        2,
      )}\n`,
    );
    // Read the parquet back for the suppression evidence before deleting it.
    const { readGeoParquetRows } = await import("../../server/services/landData/geoParquet");
    const { rows } = await readGeoParquetRows<Record<string, unknown> & { geometry: never }>(report.artifacts.parquet.localPath);
    let suppressedStored = 0;
    let suppressedFlagged = 0;
    for (const r of rows) {
      if (r.owner_name === "NOT AVAILABLE") suppressedStored += 1;
      const prov = JSON.parse(String(r.provenance_json)) as { ownership?: { suppressedUpstream?: boolean } };
      if (prov.ownership?.suppressedUpstream) suppressedFlagged += 1;
    }
    process.stdout.write(`${JSON.stringify({ suppressionReadBack: { rows: rows.length, ownerNameNotAvailable: suppressedStored, provenanceSuppressedUpstream: suppressedFlagged } })}\n`);
    if (rec.status !== "reconciled") process.exitCode = 1;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
