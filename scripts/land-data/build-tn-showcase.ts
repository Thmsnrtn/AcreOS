/**
 * Build the Tennessee showcase artifacts: GeoParquet (every parcel, every fact
 * with sources and confidence) + PMTiles (map layer carrying only facts that
 * passed the accuracy gate). Uploads to the open-data bucket when the four
 * OPEN_DATA_BUCKET_* keys are set; otherwise writes local files only.
 *
 * Two input modes:
 *
 *   --comptroller <dir>   The PRODUCTION path. <dir> holds one county's
 *                         Comptroller download (parcel .shp/.dbf/.prj and
 *                         Assessment_Data_##.dbf). The download is a manual,
 *                         form-gated file whose page says it "can be used in a
 *                         commercial application". Pass the assessment-roll
 *                         field names from the download's own field dictionary:
 *                           --mailing-state-field <F>   (out-of-state owner)
 *                           --improvement-value-field <F> (vacant = 0)
 *
 *   --sample <fixture.json>  The PROOF path used in this repo: the labelled
 *                         accuracy sample (real DeKalb County parcels taken from
 *                         the state's non-commercial public service for
 *                         verification only). Artifacts are written locally,
 *                         labelled as a fixture, and NEVER uploaded.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/land-data/build-tn-showcase.ts \
 *     --sample tests/fixtures/land-data/tn-accuracy-sample.json --out /tmp/w2-data/showcase
 *
 * "Vacant and rural": rural = the parcel lies outside every incorporated place
 * (Census TIGER). Vacant needs the assessment roll's improvement value; without
 * it vacancy is reported as unknown — never assumed.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadParcelContext, type Bbox } from "../../server/services/providers/land-context-sources";
import { computeParcelFacts, gisAcres, type ParcelInput } from "../../server/services/landData/computeParcelFacts";
import { areaBbox, areaCentroid, areaSqM, localProjection, pointInProjectedArea, projectArea, type AreaGeometry } from "../../server/services/landData/geometry";
import { writeGeoParquet, readGeoParquet, type OwnedParcelRow } from "../../server/services/landData/geoParquet";
import { buildPmtiles } from "../../server/services/landData/pmtilesWriter";
import { readDbf, readShpPolygons, unprojectFromPrj } from "../../server/services/landData/shapefile";
import { bucketConfigFromEnv, s3ClientFor, uploadAndConfirm, type UploadReceipt } from "../../server/services/landData/openDataBucket";
import type { OwnedParcelInput } from "../../server/services/landData/ownedParcelStore";
import { TN_COMPTROLLER_DOWNLOAD, TN_PARCEL_FIELDS } from "../../server/services/landData/tnParcelSources";
import { newParcelKey } from "../../shared/landData/parcelCrosswalk";
import { parcelTruths } from "../../shared/landData/parcelTruths";
import { projectFactsForCustomer } from "../../shared/landData/factAccuracyGate";
import type { FactSource, ParcelFactSet } from "../../shared/landData/parcelFacts";

const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const outDir = arg("--out") ?? "/tmp/w2-data/showcase";
const today = new Date().toISOString().slice(0, 10);

interface InputParcel extends ParcelInput {
  countyFips: string;
  sourceName: string;
  improvementValue: number | null;
}

function loadSample(file: string): { parcels: InputParcel[]; label: string } {
  const fx = JSON.parse(readFileSync(file, "utf8"));
  return {
    label: "FIXTURE — verification sample from the non-commercial TN public service; local proof only, never uploaded",
    parcels: fx.parcels.map((p: any) => ({
      parcelKey: newParcelKey("TN", "47041", p.gisLink),
      state: "TN",
      county: p.county,
      countyFips: "47041",
      sourceParcelId: p.gisLink,
      geometry: p.geometry,
      deededAcres: p.deededAcres,
      subdivision: p.subdivision,
      lot: p.lot,
      ownerMailingState: null,
      sourceName: fx.meta.parcelSource.name,
      improvementValue: null,
    })),
  };
}

function loadComptroller(dir: string): { parcels: InputParcel[]; label: string; rollSource: FactSource } {
  const files = readdirSync(dir);
  const shp = files.find((f) => /\.shp$/i.test(f) && !/assessment/i.test(f));
  if (!shp) throw new Error(`no parcel .shp in ${dir}`);
  const base = shp.replace(/\.shp$/i, "");
  const prj = readFileSync(path.join(dir, `${base}.prj`), "utf8");
  const geoms = readShpPolygons(readFileSync(path.join(dir, shp)), unprojectFromPrj(prj));
  const attrs = readDbf(readFileSync(path.join(dir, `${base}.dbf`)));
  const rollFile = files.find((f) => /^assessment_data.*\.dbf$/i.test(f));
  const mailingField = arg("--mailing-state-field");
  const improvementField = arg("--improvement-value-field");
  const roll = new Map<string, Record<string, unknown>>();
  if (rollFile) for (const r of readDbf(readFileSync(path.join(dir, rollFile)))) roll.set(String(r[TN_COMPTROLLER_DOWNLOAD.joinField]), r);
  const parcels: InputParcel[] = [];
  geoms.forEach((g, i) => {
    if (!g) return;
    const a = attrs[i];
    const gis = String(a[TN_PARCEL_FIELDS.gisLink] ?? "").trim();
    if (!gis) return;
    const r = roll.get(gis);
    const county = String(a[TN_PARCEL_FIELDS.countyName] ?? "").trim();
    parcels.push({
      parcelKey: newParcelKey("TN", String(arg("--county-fips") ?? "47000"), gis),
      state: "TN",
      county,
      countyFips: String(arg("--county-fips") ?? ""),
      sourceParcelId: gis,
      geometry: g,
      deededAcres: typeof a[TN_PARCEL_FIELDS.deededAcres] === "number" ? (a[TN_PARCEL_FIELDS.deededAcres] as number) : null,
      subdivision: (a[TN_PARCEL_FIELDS.subdivision] as string) ?? null,
      lot: (a[TN_PARCEL_FIELDS.lot] as string) ?? null,
      ownerMailingState: mailingField && r ? String(r[mailingField] ?? "") || null : null,
      sourceName: TN_COMPTROLLER_DOWNLOAD.licenseSource,
      improvementValue: improvementField && r && r[improvementField] !== null ? Number(r[improvementField]) : null,
    });
  });
  return {
    parcels,
    label: `TN Comptroller download (${dir})`,
    rollSource: { name: TN_COMPTROLLER_DOWNLOAD.licenseSource, url: TN_COMPTROLLER_DOWNLOAD.pageUrl, retrievedOn: today, sourceAsOf: null },
  };
}

async function main() {
  const sample = arg("--sample");
  const comptroller = arg("--comptroller");
  if (!sample === !comptroller) throw new Error("pass exactly one of --sample <fixture.json> or --comptroller <dir>");
  const loaded = sample ? { ...loadSample(sample), rollSource: null as FactSource | null } : loadComptroller(comptroller!);
  console.log(`${loaded.parcels.length} parcels from ${loaded.label}`);

  // Neighbourhood batches: a 0.05° grid keeps each context load small.
  const cells = new Map<string, InputParcel[]>();
  for (const p of loaded.parcels) {
    const [x, y] = areaCentroid(p.geometry);
    const k = `${Math.floor(x / 0.05)}:${Math.floor(y / 0.05)}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(p);
  }

  const rows: OwnedParcelRow[] = [];
  const tileFeatures: any[] = [];
  // EVERY parcel of a Comptroller county is kept in parcel_snapshots (so a
  // customer's lookup anywhere in the county finds it); the artifacts below
  // stay the rural/vacant showcase.
  const owned: OwnedParcelInput[] = [];
  let rural = 0, urban = 0, vacant = 0, vacancyUnknown = 0;
  for (const [cell, parcels] of cells) {
    const bs = parcels.map((p) => areaBbox(p.geometry));
    const bbox: Bbox = [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
    const ctx = await loadParcelContext(bbox, today, { onLayerError: (l, e) => console.error(`cell ${cell}: layer ${l} unavailable:`, e) });
    for (const p of parcels) {
      const c = areaCentroid(p.geometry);
      const proj = localProjection(c[0], c[1]);
      const facts: ParcelFactSet = computeParcelFacts(p, ctx, { assessmentRollSource: loaded.rollSource });
      const acres = gisAcres(p.geometry);
      owned.push({
        parcelKey: p.parcelKey, sourceParcelId: p.sourceParcelId, geometry: p.geometry, centroid: c as [number, number],
        gisAcres: acres, deededAcres: p.deededAcres ?? null, facts,
        attributes: { SUBDIV: p.subdivision ?? null, LOT: p.lot ?? null },
      });
      const inTown = (ctx.towns?.features ?? []).some((t) => pointInProjectedArea(0, 0, projectArea(t.geometry, proj)));
      if (inTown) { urban++; continue; }
      rural++;
      if (p.improvementValue === null) vacancyUnknown++;
      else if (p.improvementValue > 0) continue;
      else vacant++;
      const truths = parcelTruths({
        state: p.state, county: p.county, gisAcres: acres, deededAcres: p.deededAcres, subdivision: p.subdivision, lot: p.lot,
        accessIndication: facts.legal_access_indication.status === "computed" ? facts.legal_access_indication.value : null,
      });
      rows.push({
        parcel_key: p.parcelKey, state: p.state, county_fips: p.countyFips, county: p.county,
        source_parcel_id: p.sourceParcelId, source_name: p.sourceName, retrieved_on: today,
        gis_acres: acres, deeded_acres: p.deededAcres ?? null,
        facts_json: JSON.stringify(facts), truths_json: JSON.stringify(truths), geometry: p.geometry,
      });
      // Tiles carry only gated facts — the map is a customer surface.
      const shown = projectFactsForCustomer(facts).shown;
      const props: Record<string, unknown> = { parcel_key: p.parcelKey, gis_acres: acres, vacancy: p.improvementValue === null ? "unknown" : "vacant" };
      for (const f of shown) {
        if (f.status !== "computed") continue;
        if (f.key === "road_frontage_m") props.frontage_m = f.value;
        if (f.key === "legal_access_indication") props.access = f.value;
        if (f.key === "buildable_acres") props.buildable_acres = f.value.acres;
        if (f.key === "public_land_adjacent") props.public_land_adjacent = f.value.adjacent;
        if (f.key === "distance_to_town_km") props.town_km = f.value.km;
      }
      tileFeatures.push({ type: "Feature", geometry: p.geometry, properties: props });
    }
  }
  if (rows.length === 0) throw new Error("no rural parcels to write — refusing to emit empty artifacts");

  mkdirSync(outDir, { recursive: true });
  const pq = path.join(outDir, "tn-parcel-facts.parquet");
  const pm = path.join(outDir, "tn-parcels.pmtiles");
  await writeGeoParquet(pq, rows);
  const tiles = await buildPmtiles(
    { type: "FeatureCollection", features: tileFeatures },
    {
      layerName: "parcels", minZoom: 10, maxZoom: 15, name: "AcreOS Tennessee parcels",
      description: loaded.label,
      attribution: "Parcels: Tennessee Comptroller of the Treasury · Roads, places: US Census TIGER · Flood: FEMA NFHL · Wetlands: USFWS NWI · Elevation: USGS 3DEP · Public land: USGS PAD-US",
    },
  );
  writeFileSync(pm, tiles.bytes);

  // ── Loader proof: read both artifacts back with independent readers. ──
  const back = await readGeoParquet(pq);
  if (back.rows.length !== rows.length) throw new Error(`GeoParquet round-trip lost rows: ${back.rows.length} != ${rows.length}`);
  if (back.geo.primary_column !== "geometry" || back.geo.columns.geometry.encoding !== "WKB") throw new Error("GeoParquet geo metadata wrong");
  const areaDrift = Math.max(...back.rows.map((r, i) => Math.abs(areaSqM(r.geometry as AreaGeometry) - areaSqM(rows[i].geometry))));
  if (areaDrift > 1e-6) throw new Error(`geometry changed in round trip (${areaDrift} m²)`);
  const { PMTiles } = await import("pmtiles");
  const bytes = tiles.bytes;
  const src = {
    getKey: () => pm,
    getBytes: async (offset: number, length: number) => ({ data: bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length) }),
  };
  const archive = new PMTiles(src as any);
  const header = await archive.getHeader();
  const [cx, cy] = areaCentroid(rows[0].geometry);
  const z = 14, n = 2 ** z;
  const tx = Math.floor(((cx + 180) / 360) * n);
  const ty = Math.floor(((1 - Math.log(Math.tan((cy * Math.PI) / 180) + 1 / Math.cos((cy * Math.PI) / 180)) / Math.PI) / 2) * n);
  const tile = await archive.getZxy(z, tx, ty);
  if (!tile || tile.data.byteLength === 0) throw new Error("PMTiles loader found no tile under the first parcel");
  const { VectorTile } = await import("@mapbox/vector-tile");
  const pbfMod: any = await import("pbf");
  const Pbf = pbfMod.PbfReader ?? pbfMod.default;
  const vt = new VectorTile(new Pbf(new Uint8Array(tile.data)));
  const layer = vt.layers.parcels;
  if (!layer || layer.length === 0) throw new Error("PMTiles tile has no parcels layer");

  const summary = {
    builtOn: today,
    label: loaded.label,
    parcelsIn: loaded.parcels.length,
    rural, urbanSkipped: urban, vacant, vacancyUnknown,
    written: rows.length,
    geoparquet: { path: pq, bytes: readFileSync(pq).length, rowsReadBack: back.rows.length },
    pmtiles: { path: pm, bytes: tiles.bytes.length, tiles: tiles.tileCount, minZoom: header.minZoom, maxZoom: header.maxZoom, sampleTile: `${z}/${tx}/${ty}`, featuresInSampleTile: layer.length },
    upload: "not attempted",
    store: "not attempted",
  };

  const cfg = bucketConfigFromEnv();
  let receipts: UploadReceipt[] = [];
  if (sample) summary.upload = "never — fixture artifacts are local proof only";
  else if (!cfg) summary.upload = "skipped — OPEN_DATA_BUCKET_* not set (founder action: create the bucket and keys)";
  else {
    const client = await s3ClientFor(cfg);
    receipts = [
      await uploadAndConfirm(client, "statewide-parcels-bulk", `tn/${today}/tn-parcel-facts.parquet`, readFileSync(pq), "application/vnd.apache.parquet"),
      await uploadAndConfirm(client, "statewide-parcels-bulk", `tn/${today}/tn-parcels.pmtiles`, tiles.bytes, "application/vnd.pmtiles"),
    ];
    writeFileSync(path.join(outDir, "receipts.json"), JSON.stringify(receipts, null, 2));
    summary.upload = `uploaded ${receipts.length} objects (receipts.json)`;
  }

  // Keep the county's parcels and record the receipts — the Comptroller path
  // only: the sample is fixture data and is never stored.
  if (comptroller) {
    if (!process.env.DATABASE_URL) {
      summary.store = "skipped — set DATABASE_URL to keep this county's parcels (and record its upload receipts)";
    } else {
      const counties = Array.from(new Set(loaded.parcels.map((p) => p.county))).filter(Boolean);
      if (counties.length !== 1) throw new Error(`a Comptroller download is one county; this one names ${counties.length}: ${counties.join(", ")}`);
      const { persistLoadedCounty } = await import("../../server/services/landData/ownedParcelStore");
      const r = await persistLoadedCounty(
        { state: "TN", county: counties[0], sourceName: TN_COMPTROLLER_DOWNLOAD.licenseSource, sourceUrl: TN_COMPTROLLER_DOWNLOAD.pageUrl },
        owned,
        receipts,
      );
      summary.store = `kept ${r.stored} parcels in ${counties[0]} County; recorded ${r.receiptsRecorded} upload receipt(s)`;
    }
  }
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().then(
  () => process.exit(0), // the DB pool, when used, would keep the process alive
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
