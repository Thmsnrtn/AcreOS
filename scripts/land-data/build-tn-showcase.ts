/**
 * Build one Tennessee county's showcase artifacts: GeoParquet (every
 * rural/vacant parcel, every fact with sources and confidence) + PMTiles (map
 * layer carrying only facts that passed the accuracy gate), and keep every
 * parcel of the county in parcel_snapshots. A thin wrapper: the bounded,
 * county-by-county build lives in server/services/landData/tnComptrollerCounty.ts.
 *
 * Input modes (exactly one):
 *
 *   --comptroller <dir>   The PRODUCTION path. <dir> holds ONE county's
 *                         Comptroller download (parcel .shp/.dbf/.prj and
 *                         Assessment_Data_##.dbf). The download is a manual,
 *                         form-gated file whose page says it "can be used in a
 *                         commercial application". Roll field names come from
 *                         the download's own field dictionary:
 *                           --mailing-state-field <F>     (out-of-state owner)
 *                           --improvement-value-field <F> (vacant = 0)
 *                         The county: --county-fips 47xxx and/or --county <name>;
 *                         with neither, it is read from the file's COUNTY_NAME.
 *
 *   --sample <fixture.json>  The PROOF path: the labelled accuracy sample (real
 *                         DeKalb County parcels taken from the state's
 *                         non-commercial public service for verification only).
 *                         Artifacts are written locally, labelled as a fixture,
 *                         and NEVER uploaded or stored.
 *
 *   --plan                Print the metros-first county order and exit.
 *
 * There is no statewide mode: --statewide, or a statewide county value, is refused.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/land-data/build-tn-showcase.ts \
 *     --sample tests/fixtures/land-data/tn-accuracy-sample.json --out /tmp/w2-data/showcase
 *
 * CHANGES IN D2a (bounded rewrite):
 *   - artifacts are named per county — tn-<county>.parquet / tn-<county>.pmtiles
 *     (were tn-parcel-facts.parquet / tn-parcels.pmtiles) — and uploaded as
 *     tn/<county>/<date>/tn-<county>.<sha256[0:16]>.<ext> (was tn/<date>/<name>,
 *     where two counties, or two runs, on one day overwrote each other);
 *   - GeoParquet rows are ascending by source_parcel_id (UTF-8 byte order), not cell order;
 *   - PMTiles are built at z14–15 by the streaming writer (was z10–15);
 *   - the county FIPS is required to resolve (no "47000" placeholder in parcel keys);
 *   - a roll field the roll lacks, or a roll field named with no roll file, is
 *     refused (a missing improvement field used to read as "vacant");
 *   - a deleted .dbf row no longer shifts every later parcel's attributes;
 *   - parcels are kept in batches as the build goes, not in one call at the end.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadParcelContext } from "../../server/services/providers/land-context-sources";
import { bucketConfigFromEnv, s3ClientFor, uploadFileAndConfirm, type UploadReceipt } from "../../server/services/landData/openDataBucket";
import type { OwnedParcelInput } from "../../server/services/landData/ownedParcelStore";
import {
  buildTnCounty,
  comptrollerDirSource,
  resolveTnCounty,
  sampleFixtureSource,
  TN_METRO_COUNTY_ORDER,
  type TnCountyStore,
  type TnCountyTarget,
  type TnParcelSource,
} from "../../server/services/landData/tnComptrollerCounty";
import { TN_COMPTROLLER_DOWNLOAD } from "../../server/services/landData/tnParcelSources";

const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const today = new Date().toISOString().slice(0, 10);

/** The county a Comptroller directory names, read from its first page only. */
async function countyNamedBy(source: TnParcelSource): Promise<string | null> {
  for await (const page of source.parcelPages()) {
    const named = page.find((p) => p.county);
    if (named) return named.county;
  }
  return null;
}

/**
 * Keep the county's parcels batch by batch; at the end complete the county
 * through ownedParcelStore's one canonical completeLoadedCounty (coverage row,
 * confirmed receipts, IndexNow).
 */
async function databaseStore(target: TnCountyTarget): Promise<TnCountyStore> {
  const { saveOwnedParcels, completeLoadedCounty } = await import("../../server/services/landData/ownedParcelStore");
  const owned = { state: "TN", county: target.county, sourceName: TN_COMPTROLLER_DOWNLOAD.licenseSource, sourceUrl: TN_COMPTROLLER_DOWNLOAD.pageUrl };
  return {
    saveBatch: (parcels: OwnedParcelInput[]) => saveOwnedParcels(owned, parcels),
    complete: (stored: number, receipts: UploadReceipt[]) => completeLoadedCounty(owned, stored, receipts),
  };
}

async function main() {
  if (argv.includes("--statewide")) throw new Error("refused: there is no statewide Tennessee build — run one county per Comptroller download");
  if (argv.includes("--plan")) {
    console.log(JSON.stringify(TN_METRO_COUNTY_ORDER, null, 2));
    return;
  }
  const sample = arg("--sample");
  const comptroller = arg("--comptroller");
  if (!sample === !comptroller) throw new Error("pass exactly one of --sample <fixture.json> or --comptroller <dir>");
  // Default: a fresh private directory (mkdtemp, mode 0700), not a fixed
  // /tmp path another local user could pre-create or symlink (CodeQL
  // js/insecure-temporary-file). Pass --out to choose the directory.
  const outDir = arg("--out") ?? mkdtempSync(path.join(os.tmpdir(), "acreos-tn-showcase-"));

  let source: TnParcelSource;
  let target: TnCountyTarget;
  if (sample) {
    source = sampleFixtureSource(sample);
    target = resolveTnCounty({ countyName: await countyNamedBy(source) });
  } else {
    source = comptrollerDirSource(comptroller as string, { mailingStateField: arg("--mailing-state-field"), improvementValueField: arg("--improvement-value-field") }, today);
    const fips = arg("--county-fips");
    const name = arg("--county") ?? (fips ? null : await countyNamedBy(source));
    target = resolveTnCounty({ countyFips: fips, countyName: name });
  }
  console.log(`building ${target.county} County (${target.fips}) from ${source.label}`);

  const cfg = source.kind === "comptroller" ? bucketConfigFromEnv() : null;
  const report = await buildTnCounty(target, source, {
    outDir,
    today,
    loadContext: (bbox, retrievedOn) => loadParcelContext(bbox, retrievedOn, { onLayerError: (l, e) => console.error(`layer ${l} unavailable:`, e) }),
    bucketConfigured: cfg !== null,
    objectStore: cfg ? () => s3ClientFor(cfg) : undefined,
    upload: uploadFileAndConfirm,
    store: source.kind === "comptroller" && process.env.DATABASE_URL ? await databaseStore(target) : undefined,
  });
  if (report.outcome.status === "ingested") writeFileSync(path.join(outDir, "receipts.json"), JSON.stringify(report.outcome.receipts, null, 2));
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().then(
  () => process.exit(0), // the DB pool, when used, would keep the process alive
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
