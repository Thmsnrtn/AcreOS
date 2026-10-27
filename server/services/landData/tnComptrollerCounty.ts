/**
 * Tennessee Comptroller county build — D2a, bounded memory, one county per run.
 *
 * WHY COUNTY-BY-COUNTY. Tennessee has no statewide layer AcreOS may use: the
 * TNMap "Property Boundaries Public Use" service says it "is not intended for
 * commercial use" and is blocked outright (founder decision 2026-10-11,
 * tnParcelSources.ts). The only storable source is the Comptroller's
 * per-county download, fetched by a person through a request form. So there
 * is no statewide mode here, and resolveTnCounty() refuses every request that
 * is not exactly one Comptroller-maintained county.
 *
 * WHY BOUNDED. The previous loader (scripts/land-data/build-tn-showcase.ts
 * before D2a) read the whole .shp/.dbf/roll into memory, built every parcel,
 * every OwnedParcelInput (with facts), every GeoParquet row and a GeoJSON
 * FeatureCollection, and only then wrote anything — the shape that OOM-killed
 * the D1 FL build on a 1 GB machine. This module never holds a county:
 *
 *   1. the roll and the parcel file are read a page (PAGE_SIZE records) at a
 *      time through file descriptors — never readFileSync of a whole file;
 *   2. both are SPILLED to disk in JOIN_BUCKETS hash buckets keyed by GISLINK;
 *   3. bucket by bucket, the roll slice (≈ county / JOIN_BUCKETS records) is
 *      joined to its parcels and each joined parcel is spilled to its 0.05°
 *      neighbourhood CELL file;
 *   4. cell by cell: one pass for the cell's bbox, one context load, then a
 *      second streamed pass computes facts, persists the cell's parcels in
 *      batches of STORE_BATCH (parcel_snapshots, when a store is wired), and
 *      writes rural/vacant rows through StreamingArtifactWriter (GeoParquet
 *      row groups + spill-partitioned PMTiles).
 *
 * Peak memory is one page + one roll slice + one cell's context + one store
 * batch + the writer's bound, independent of county size. RSS is sampled
 * every page and every cell and reported against RSS_CEILING_MB; the
 * acceptance gate (scripts/d2-tn-memory-gate.ts) runs a large synthetic
 * county under a 512 MB cap and an accumulating mutant that must OOM.
 *
 * Upload and storage happen only for the "comptroller" source kind. The
 * labelled sample and synthetic sources are never uploaded or stored,
 * whatever deps are passed.
 */

import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { FactSource, ParcelFactSet } from "@shared/landData/parcelFacts";
import { newParcelKey } from "@shared/landData/parcelCrosswalk";
import { parcelTruths } from "@shared/landData/parcelTruths";
import { projectFactsForCustomer } from "@shared/landData/factAccuracyGate";
import { COUNTY_SOURCE_CENSUS, type CensusRow } from "@shared/landData/countySourceCensus";
import { computeParcelFacts, gisAcres, type ParcelContext } from "./computeParcelFacts";
import { areaBbox, areaCentroid, areaSqM, localProjection, pointInProjectedArea, projectArea, type AreaGeometry } from "./geometry";
import { decodeWkb, type ParquetColumnDef } from "./geoParquet";
import { readDbf, readShpPolygons, unprojectFromPrj, type Unproject } from "./shapefile";
import { StreamingArtifactWriter, type BuiltArtifact } from "./streamingArtifacts";
import { artifactObjectKey, buildOutcome, ExternalSorter, RSS_CEILING_MB, type BuildOutcome, type IngestGate } from "./statewideCadastral";
import type { ObjectStoreClient, UploadReceipt } from "./openDataBucket";
import type { OwnedParcelInput } from "./ownedParcelStore";
import { TN_COMPTROLLER_DOSSIER, TN_COMPTROLLER_DOWNLOAD, TN_PARCEL_FIELDS, TN_SELF_MAINTAINED_COUNTIES } from "./tnParcelSources";
import { unresolvedUseClasses, type SourceDossier } from "@shared/openData/sourcePolicy";

const PAGE_SIZE = 1000;
const JOIN_BUCKETS = 64;
/** Neighbourhood grid for context loads (unchanged from the pre-D2a loader). */
const CELL_DEG = 0.05;
const STORE_BATCH = 500;
/** A spill buffer is flushed to its file past this many characters. */
const SPILL_FLUSH_CHARS = 64 * 1024;

// ── Which county, in which order ──────────────────────────────────────────

export interface TnMetroCounty {
  fips: string;
  county: string;
  /** The metro this county is built for — a planning grouping, not a claim shown to anyone. */
  metro: string;
}

/**
 * The build order: metros first, Comptroller-maintained counties only.
 *
 * FIPS: every code is the county's GEOID as recorded in
 * shared/landData/countySourceCensus.tn.json, which
 * scripts/land-data/build-county-source-census.ts built on 2026-10-10 from US
 * Census TIGERweb State_County (STATE = 47). tests/unit/tnComptrollerCounty
 * pins each (fips, county) pair against that file, so a typo cannot ship.
 *
 * METRO GROUPING: each county is placed in the metro whose core it rings
 * (OMB core-based statistical area delineations). The OMB bulletin was NOT
 * re-read for this list (the build container cannot reach it); the grouping
 * only orders work, it is never rendered as a fact.
 *
 * The metro CORE counties — Davidson, Shelby, Knox, Hamilton, Montgomery,
 * Rutherford, Williamson — are absent on purpose: they maintain their own
 * parcels and are not in the Comptroller download (TN_SELF_MAINTAINED_COUNTIES),
 * so this path refuses them; each needs its own county-direct source.
 */
export const TN_METRO_COUNTY_ORDER: readonly TnMetroCounty[] = [
  { fips: "47165", county: "Sumner", metro: "Nashville" },
  { fips: "47189", county: "Wilson", metro: "Nashville" },
  { fips: "47119", county: "Maury", metro: "Nashville" },
  { fips: "47147", county: "Robertson", metro: "Nashville" },
  { fips: "47043", county: "Dickson", metro: "Nashville" },
  { fips: "47021", county: "Cheatham", metro: "Nashville" },
  { fips: "47167", county: "Tipton", metro: "Memphis" },
  { fips: "47047", county: "Fayette", metro: "Memphis" },
  { fips: "47009", county: "Blount", metro: "Knoxville" },
  { fips: "47001", county: "Anderson", metro: "Knoxville" },
  { fips: "47105", county: "Loudon", metro: "Knoxville" },
  { fips: "47145", county: "Roane", metro: "Knoxville" },
  { fips: "47115", county: "Marion", metro: "Chattanooga" },
  { fips: "47153", county: "Sequatchie", metro: "Chattanooga" },
  { fips: "47161", county: "Stewart", metro: "Clarksville" },
  { fips: "47163", county: "Sullivan", metro: "Kingsport–Bristol" },
  { fips: "47073", county: "Hawkins", metro: "Kingsport–Bristol" },
  { fips: "47179", county: "Washington", metro: "Johnson City" },
  { fips: "47019", county: "Carter", metro: "Johnson City" },
  { fips: "47113", county: "Madison", metro: "Jackson" },
  { fips: "47011", county: "Bradley", metro: "Cleveland" },
];

export interface TnCountyTarget {
  fips: string;
  county: string;
}

const STATEWIDE_WORDS = /^(\*|all|statewide|state|tn|tennessee|47|47000)$/i;

const tnRows = (): readonly CensusRow[] => COUNTY_SOURCE_CENSUS.find((c) => c.state === "TN")?.rows ?? [];
const norm = (s: string) => s.toLowerCase().replace(/ county$/i, "").trim();

/**
 * Exactly one Comptroller-maintained county, or a plain-words refusal.
 * Refuses: nothing named; any statewide word; an unknown FIPS or name; a FIPS
 * and a name that disagree; a county that maintains its own parcels.
 */
export function resolveTnCounty(req: { countyFips?: string | null; countyName?: string | null }): TnCountyTarget {
  const fips = (req.countyFips ?? "").trim();
  const name = (req.countyName ?? "").trim();
  if (!fips && !name) throw new Error("refused: a Tennessee build is one county — name it (--county-fips 47xxx); there is no statewide mode");
  for (const v of [fips, name]) {
    if (v && STATEWIDE_WORDS.test(v)) {
      throw new Error(
        `refused: "${v}" asks for a statewide build — Tennessee is built county by county from the Comptroller download (the state's public layer is non-commercial and blocked)`,
      );
    }
  }
  const rows = tnRows();
  const byFips = fips ? rows.find((r) => r.countyFips === fips) : undefined;
  if (fips && !byFips) throw new Error(`refused: ${fips} is not a Tennessee county FIPS in the county source census`);
  const byName = name ? rows.find((r) => norm(r.county) === norm(name)) : undefined;
  if (name && !byName) throw new Error(`refused: "${name}" is not a Tennessee county in the county source census`);
  if (byFips && byName && byFips.countyFips !== byName.countyFips) {
    throw new Error(`refused: FIPS ${fips} is ${byFips.county} County, but the request names ${name} — one county per run`);
  }
  const row = (byFips ?? byName) as CensusRow;
  const selfMaintained = (TN_SELF_MAINTAINED_COUNTIES as readonly string[]).includes(row.county) || row.maintainedBy === "county";
  if (selfMaintained) {
    throw new Error(
      `refused: ${row.county} County maintains its own parcels and is not in the Comptroller download — it needs a county-direct source (see the county source census)`,
    );
  }
  return { fips: row.countyFips, county: row.county };
}

// ── Sources (paged) ───────────────────────────────────────────────────────

export interface TnSourceParcel {
  gisLink: string;
  sourceParcelId: string;
  /** The county the source names for this parcel ("" when the source names none). */
  county: string;
  geometry: AreaGeometry;
  deededAcres: number | null;
  subdivision: string | null;
  lot: string | null;
}

export interface TnRollRecord {
  gisLink: string;
  mailingState: string | null;
  improvementValue: number | null;
}

export interface TnParcelSource {
  /** Only "comptroller" may ever be stored or uploaded. */
  kind: "comptroller" | "sample" | "synthetic";
  label: string;
  sourceName: string;
  rollSource: FactSource | null;
  parcelPages(): AsyncIterable<TnSourceParcel[]>;
  rollPages(): AsyncIterable<TnRollRecord[]>;
  /** Records the reader skipped (deleted .dbf rows, null shapes, no GISLINK). */
  skipped(): { deleted: number; nullShape: number; noGisLink: number };
}

/** dBASE header: record count, lengths and field names — read once, never the records. */
function dbfHeader(fd: number): { nRecords: number; headerLen: number; recordLen: number; header: Buffer; fields: string[] } {
  const head = Buffer.alloc(32);
  readSync(fd, head, 0, 32, 0);
  const headerLen = head.readUInt16LE(8);
  const header = Buffer.alloc(headerLen);
  readSync(fd, header, 0, headerLen, 0);
  const fields: string[] = [];
  for (let p = 32; p < headerLen - 1 && header[p] !== 0x0d; p += 32) fields.push(header.toString("latin1", p, p + 11).replace(/\0.*$/, ""));
  return { nRecords: head.readUInt32LE(4), headerLen, recordLen: head.readUInt16LE(10), header, fields };
}

/**
 * One .dbf record at a time through shapefile.ts's own parser: the header with
 * its count patched to 1, plus the record. Returns null for a deleted record —
 * which keeps the .dbf aligned with the .shp (the pre-D2a loader paired
 * geometry i with the i-th NON-deleted row, so one deleted row shifted every
 * later parcel's attributes).
 */
class DbfCursor {
  private readonly fd: number;
  readonly fields: string[];
  readonly nRecords: number;
  private readonly headerLen: number;
  private readonly recordLen: number;
  private readonly one: Buffer;
  constructor(file: string) {
    this.fd = openSync(file, "r");
    const h = dbfHeader(this.fd);
    this.fields = h.fields;
    this.nRecords = h.nRecords;
    this.headerLen = h.headerLen;
    this.recordLen = h.recordLen;
    this.one = Buffer.concat([h.header, Buffer.alloc(h.recordLen)]);
    this.one.writeUInt32LE(1, 4);
  }
  record(i: number): Record<string, string | number | null> | null {
    readSync(this.fd, this.one, this.headerLen, this.recordLen, this.headerLen + i * this.recordLen);
    return readDbf(this.one)[0] ?? null;
  }
  close() {
    closeSync(this.fd);
  }
}

/** .shp records one at a time, each parsed by shapefile.ts's readShpPolygons on a header + that record. */
class ShpCursor {
  private readonly fd: number;
  private readonly size: number;
  private readonly header = Buffer.alloc(100);
  private pos = 100;
  constructor(file: string, private readonly unproject: Unproject) {
    this.fd = openSync(file, "r");
    this.size = fstatSync(this.fd).size;
    readSync(this.fd, this.header, 0, 100, 0);
    const type = this.header.readInt32LE(32);
    if (![5, 15, 25].includes(type)) {
      closeSync(this.fd);
      throw new Error(`shapefile type ${type} is not a polygon layer`);
    }
  }
  /** undefined at end of file; null for a null shape. */
  next(): AreaGeometry | null | undefined {
    if (this.pos + 8 > this.size) return undefined;
    const rh = Buffer.alloc(8);
    readSync(this.fd, rh, 0, 8, this.pos);
    const contentBytes = rh.readInt32BE(4) * 2;
    const content = Buffer.alloc(contentBytes);
    readSync(this.fd, content, 0, contentBytes, this.pos + 8);
    this.pos += 8 + contentBytes;
    return readShpPolygons(Buffer.concat([this.header, rh, content]), this.unproject)[0] ?? null;
  }
  close() {
    closeSync(this.fd);
  }
}

export interface ComptrollerFieldArgs {
  /** The roll's owner-mailing-state field, from the download's own field dictionary. */
  mailingStateField?: string;
  /** The roll's improvement-value field (vacant = 0), from the download's own field dictionary. */
  improvementValueField?: string;
}

/**
 * The Comptroller download in `dir` (parcel .shp/.dbf/.prj + Assessment_Data_##.dbf),
 * read page by page. Refuses, before reading a record, a roll field the roll
 * does not carry and a roll field named with no roll present — a mapping is
 * never guessed, and a missing improvement field must not read as "vacant".
 */
export function comptrollerDirSource(dir: string, fieldArgs: ComptrollerFieldArgs, today: string): TnParcelSource {
  const files = readdirSync(dir);
  const shp = files.find((f) => /\.shp$/i.test(f) && !/assessment/i.test(f));
  if (!shp) throw new Error(`no parcel .shp in ${dir}`);
  const base = shp.replace(/\.shp$/i, "");
  const dbfName = files.find((f) => f.toLowerCase() === `${base.toLowerCase()}.dbf`);
  const prjName = files.find((f) => f.toLowerCase() === `${base.toLowerCase()}.prj`);
  if (!dbfName || !prjName) throw new Error(`the parcel layer ${shp} needs its .dbf and .prj beside it`);
  const unproject = unprojectFromPrj(readFileSync(path.join(dir, prjName), "utf8"));
  const rollFile = files.find((f) => /^assessment_data.*\.dbf$/i.test(f));
  const { mailingStateField, improvementValueField } = fieldArgs;
  if (rollFile) {
    const roll = new DbfCursor(path.join(dir, rollFile));
    const have = new Set(roll.fields);
    roll.close();
    for (const f of [TN_COMPTROLLER_DOWNLOAD.joinField, mailingStateField, improvementValueField]) {
      if (f && !have.has(f)) throw new Error(`refused: the roll ${rollFile} has no field "${f}" — field names come from the download's own dictionary, never guessed`);
    }
  } else if (mailingStateField || improvementValueField) {
    throw new Error(`refused: a roll field was named but ${dir} holds no Assessment_Data_##.dbf to read it from`);
  }
  const skipped = { deleted: 0, nullShape: 0, noGisLink: 0 };
  return {
    kind: "comptroller",
    label: `TN Comptroller download (${dir})`,
    sourceName: TN_COMPTROLLER_DOWNLOAD.licenseSource,
    rollSource: { name: TN_COMPTROLLER_DOWNLOAD.licenseSource, url: TN_COMPTROLLER_DOWNLOAD.pageUrl, retrievedOn: today, sourceAsOf: null },
    skipped: () => ({ ...skipped }),
    async *parcelPages() {
      const shpCur = new ShpCursor(path.join(dir, shp), unproject);
      const dbf = new DbfCursor(path.join(dir, dbfName));
      try {
        let page: TnSourceParcel[] = [];
        for (let i = 0; ; i++) {
          const g = shpCur.next();
          if (g === undefined) break;
          if (i >= dbf.nRecords) throw new Error(`${shp} has more shapes than ${dbfName} has records — the pair is misaligned`);
          const a = dbf.record(i);
          if (!a) {
            skipped.deleted += 1;
            continue;
          }
          if (!g) {
            skipped.nullShape += 1;
            continue;
          }
          const gis = String(a[TN_PARCEL_FIELDS.gisLink] ?? "").trim();
          if (!gis) {
            skipped.noGisLink += 1;
            continue;
          }
          const deeded = a[TN_PARCEL_FIELDS.deededAcres];
          const text = (v: unknown) => (typeof v === "string" ? v : null);
          page.push({
            gisLink: gis,
            sourceParcelId: gis,
            county: String(a[TN_PARCEL_FIELDS.countyName] ?? "").trim(),
            geometry: g,
            deededAcres: typeof deeded === "number" ? deeded : null,
            subdivision: text(a[TN_PARCEL_FIELDS.subdivision]),
            lot: text(a[TN_PARCEL_FIELDS.lot]),
          });
          if (page.length >= PAGE_SIZE) {
            yield page;
            page = [];
          }
        }
        if (page.length) yield page;
      } finally {
        shpCur.close();
        dbf.close();
      }
    },
    async *rollPages() {
      if (!rollFile) return;
      const roll = new DbfCursor(path.join(dir, rollFile));
      try {
        let page: TnRollRecord[] = [];
        for (let i = 0; i < roll.nRecords; i++) {
          const r = roll.record(i);
          if (!r) continue;
          const gis = String(r[TN_COMPTROLLER_DOWNLOAD.joinField] ?? "").trim();
          if (!gis) continue;
          const imp = improvementValueField ? r[improvementValueField] : null;
          const impNum = imp === null || imp === undefined || imp === "" ? null : Number(imp);
          page.push({
            gisLink: gis,
            mailingState: mailingStateField ? String(r[mailingStateField] ?? "") || null : null,
            improvementValue: impNum !== null && Number.isFinite(impNum) ? impNum : null,
          });
          if (page.length >= PAGE_SIZE) {
            yield page;
            page = [];
          }
        }
        if (page.length) yield page;
      } finally {
        roll.close();
      }
    },
  };
}

interface SampleFixture {
  meta: { county: string; parcelSource: { name: string } };
  parcels: Array<{ gisLink: string; county: string; deededAcres: number | null; geometry: AreaGeometry }>;
}

/**
 * The labelled accuracy sample (tests/fixtures/land-data/tn-accuracy-sample.json):
 * 20 DeKalb parcels from the retired non-commercial service, kept for
 * verification only. A fixture, so it is read whole; it is never stored or uploaded.
 */
export function sampleFixtureSource(file: string): TnParcelSource {
  const fx = JSON.parse(readFileSync(file, "utf8")) as SampleFixture;
  return {
    kind: "sample",
    label: "FIXTURE — verification sample from the non-commercial TN public service; local proof only, never uploaded",
    sourceName: fx.meta.parcelSource.name,
    rollSource: null,
    skipped: () => ({ deleted: 0, nullShape: 0, noGisLink: 0 }),
    async *parcelPages() {
      // The fixture no longer carries subdivision/lot (W3 privacy trim).
      yield fx.parcels.map((p) => ({ gisLink: p.gisLink, sourceParcelId: p.gisLink, county: p.county, geometry: p.geometry, deededAcres: p.deededAcres, subdivision: null, lot: null }));
    },
    async *rollPages() {
      /* the sample carries no assessment roll */
    },
  };
}

// ── Spill files ───────────────────────────────────────────────────────────

class SpillFiles {
  private readonly buf = new Map<string, string>();
  readonly keys = new Set<string>();
  constructor(private readonly dir: string, private readonly prefix: string) {}
  file(key: string) {
    return path.join(this.dir, `${this.prefix}-${key}.ndjson`);
  }
  add(key: string, line: string) {
    this.keys.add(key);
    const s = (this.buf.get(key) ?? "") + line + "\n";
    if (s.length >= SPILL_FLUSH_CHARS) {
      appendFileSync(this.file(key), s);
      this.buf.delete(key);
    } else this.buf.set(key, s);
  }
  flush() {
    for (const [k, s] of Array.from(this.buf.entries())) appendFileSync(this.file(k), s);
    this.buf.clear();
  }
}

async function* lines(file: string): AsyncIterable<string> {
  if (!existsSync(file)) return;
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const l of rl) if (l) yield l;
}

function bucketOf(gis: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < gis.length; i++) {
    h ^= gis.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String(h % JOIN_BUCKETS);
}

// ── The build ─────────────────────────────────────────────────────────────

interface JoinedParcel extends TnSourceParcel {
  mailingState: string | null;
  improvementValue: number | null;
}

interface TnRow {
  parcel_key: string;
  state: string;
  county_fips: string;
  county: string;
  source_parcel_id: string;
  source_name: string;
  retrieved_on: string;
  gis_acres: number;
  deeded_acres: number | null;
  facts_json: string;
  truths_json: string;
  geometry: AreaGeometry;
}

/** The pre-D2a showcase GeoParquet columns, unchanged. */
const TN_SCHEMA: Record<keyof TnRow, ParquetColumnDef> = {
  parcel_key: { type: "UTF8" },
  state: { type: "UTF8" },
  county_fips: { type: "UTF8" },
  county: { type: "UTF8" },
  source_parcel_id: { type: "UTF8" },
  source_name: { type: "UTF8" },
  retrieved_on: { type: "UTF8" },
  gis_acres: { type: "DOUBLE" },
  deeded_acres: { type: "DOUBLE", optional: true },
  facts_json: { type: "UTF8" },
  truths_json: { type: "UTF8" },
  geometry: { type: "BYTE_ARRAY" },
};

export interface TnCountyStore {
  /** Keep one batch of the county's parcels (parcel_snapshots). Returns how many were stored. */
  saveBatch(parcels: OwnedParcelInput[]): Promise<number>;
  /** After every batch: mark the county complete with the total and record each confirmed receipt. */
  complete(stored: number, receipts: UploadReceipt[]): Promise<{ receiptsRecorded: number }>;
}

export interface TnBuildDeps {
  outDir: string;
  today: string;
  /** Context layers for one cell's bbox (production: loadParcelContext). */
  loadContext(bbox: [number, number, number, number], retrievedOn: string): Promise<ParcelContext>;
  bucketConfigured: boolean;
  /** The use-class dossier the upload gate reads; production default TN_COMPTROLLER_DOSSIER (all unresolved). */
  dossier?: SourceDossier;
  objectStore?: () => Promise<ObjectStoreClient>;
  upload?: (client: ObjectStoreClient, corpusKey: string, objectKey: string, a: BuiltArtifact) => Promise<UploadReceipt>;
  store?: TnCountyStore;
  /** RSS in bytes; defaults to process.memoryUsage().rss. */
  rss?(): number;
  /** Keeps the spill directory after the run (diagnosis only). */
  keepWorkDir?: boolean;
  /** Sort-run size in serialized characters (ExternalSorter default when unset). */
  sortRunChars?: number;
}

export interface TnCountyReport {
  kind: "tn_comptroller_county_build";
  builtOn: string;
  county: string;
  countyFips: string;
  label: string;
  sourceKind: TnParcelSource["kind"];
  parcelsIn: number;
  skipped: { deleted: number; nullShape: number; noGisLink: number };
  countyNameMissing: number;
  rollRecords: number;
  joined: number;
  cells: number;
  rural: number;
  urbanSkipped: number;
  vacant: number;
  vacancyUnknown: number;
  written: number;
  geoparquet: BuiltArtifact & { objectKey: string; rowsReadBack: number };
  pmtiles: BuiltArtifact & { objectKey: string; tiles: number; partitions: number; sampleTile: string; featuresInSampleTile: number };
  upload: string;
  store: string;
  stored: number;
  outcome: BuildOutcome;
  peakRssMb: number;
  rssCeilingMb: number;
  overCeiling: boolean;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Bytes of a PMTiles archive on disk, read by range — the archive is never loaded whole. */
async function sampleTileCheck(pmtilesPath: string, at: [number, number], layerName: string): Promise<{ tile: string; features: number }> {
  const { PMTiles } = await import("pmtiles");
  const fd = openSync(pmtilesPath, "r");
  try {
    const archive = new PMTiles({
      getKey: () => pmtilesPath,
      async getBytes(offset: number, length: number) {
        const b = Buffer.alloc(length);
        const n = readSync(fd, b, 0, length, offset);
        return { data: b.buffer.slice(b.byteOffset, b.byteOffset + n) as ArrayBuffer };
      },
    });
    const [cx, cy] = at;
    const z = 14;
    const n = 2 ** z;
    const tx = Math.floor(((cx + 180) / 360) * n);
    const ty = Math.floor(((1 - Math.log(Math.tan((cy * Math.PI) / 180) + 1 / Math.cos((cy * Math.PI) / 180)) / Math.PI) / 2) * n);
    const tile = await archive.getZxy(z, tx, ty);
    if (!tile || tile.data.byteLength === 0) throw new Error("PMTiles loader found no tile under the first written parcel");
    const { VectorTile } = await import("@mapbox/vector-tile");
    const { PbfReader } = await import("pbf");
    const vt = new VectorTile(new PbfReader(new Uint8Array(tile.data)));
    const layer = vt.layers[layerName];
    if (!layer || layer.length === 0) throw new Error(`PMTiles tile ${z}/${tx}/${ty} has no ${layerName} layer`);
    return { tile: `${z}/${tx}/${ty}`, features: layer.length };
  } finally {
    closeSync(fd);
  }
}

interface ParquetCursorLib {
  ParquetReader: { openFile(p: string): Promise<{ getCursor(): { next(): Promise<{ geometry: Uint8Array } | null> }; close(): Promise<void> }> };
}

/** Stream the GeoParquet back: row count + summed geometry area (geometry must survive the WKB round trip). */
async function parquetReadBack(file: string): Promise<{ rows: number; areaSum: number }> {
  const mod = (await import("parquetjs-lite")) as { default?: ParquetCursorLib } & ParquetCursorLib;
  const lib = mod.default ?? mod;
  const reader = await lib.ParquetReader.openFile(file);
  let rows = 0;
  let areaSum = 0;
  const cursor = reader.getCursor();
  for (let r = await cursor.next(); r; r = await cursor.next()) {
    rows += 1;
    areaSum += areaSqM(decodeWkb(Buffer.from(r.geometry)));
  }
  await reader.close();
  return { rows, areaSum };
}

/**
 * Build one county: spill, join, cell by cell facts + persistence + artifacts,
 * then upload (comptroller source + bucket only) and complete the county.
 * Any failure discards the partial artifacts and the spill directory.
 */
export async function buildTnCounty(target: TnCountyTarget, source: TnParcelSource, deps: TnBuildDeps): Promise<TnCountyReport> {
  const checked = resolveTnCounty({ countyFips: target.fips, countyName: target.county });
  const rss = deps.rss ?? (() => process.memoryUsage().rss);
  let peak = 0;
  const sample = () => {
    peak = Math.max(peak, Math.round(rss() / 1048576));
  };
  sample();
  const stem = `tn-${slug(checked.county)}`;
  const work = path.join(deps.outDir, `.${stem}-work`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const mayPersist = source.kind === "comptroller";

  const tileProps = new WeakMap<TnRow, Record<string, unknown>>();
  const writer = new StreamingArtifactWriter<TnRow>(
    {
      outDir: deps.outDir,
      stem,
      schemaDef: TN_SCHEMA,
      layerName: "parcels",
      tileName: "AcreOS Tennessee parcels",
      tileDescription: source.label,
      attribution:
        "Parcels: Tennessee Comptroller of the Treasury · Roads, places: US Census TIGER · Flood: FEMA NFHL · Wetlands: USFWS NWI · Elevation: USGS 3DEP · Public land: USGS PAD-US",
    },
    (row) => tileProps.get(row) ?? { parcel_key: row.parcel_key },
  );

  let parcelsIn = 0, countyNameMissing = 0, rollRecords = 0, joined = 0;
  let rural = 0, urban = 0, vacant = 0, vacancyUnknown = 0, written = 0, stored = 0;
  let areaSumWritten = 0;
  let firstCentroid: [number, number] | null = null;
  let cellCount = 0;
  // Showcase rows reach the writer ascending by source_parcel_id (UTF-8 byte
  // order, the D2b release-diff order) through the bounded external sort; the
  // tile properties travel with each row through the sort.
  const sorter = new ExternalSorter<{ row: TnRow; props: Record<string, unknown> }>(path.join(work, "sort"), (e) => e.row.source_parcel_id, deps.sortRunChars);
  await writer.open();
  try {
    // 1–2. Spill the roll and the parcels into GISLINK hash buckets.
    const rollSpill = new SpillFiles(work, "roll");
    for await (const page of source.rollPages()) {
      for (const r of page) {
        rollRecords += 1;
        rollSpill.add(bucketOf(r.gisLink), JSON.stringify(r));
      }
      sample();
    }
    rollSpill.flush();
    const parcelSpill = new SpillFiles(work, "parcel");
    for await (const page of source.parcelPages()) {
      for (const p of page) {
        parcelsIn += 1;
        if (!p.county) countyNameMissing += 1;
        else if (norm(p.county) !== norm(checked.county)) {
          throw new Error(
            `refused: this run is ${checked.county} County but the source also names ${p.county} — a Comptroller download is one county; statewide or multi-county files are not built`,
          );
        }
        parcelSpill.add(bucketOf(p.gisLink), JSON.stringify(p));
      }
      sample();
    }
    parcelSpill.flush();

    // 3. Bucket by bucket: join a roll slice to its parcels, spill each to its cell.
    const cellSpill = new SpillFiles(work, "cell");
    for (const b of Array.from(parcelSpill.keys).sort()) {
      const roll = new Map<string, TnRollRecord>();
      for await (const l of lines(rollSpill.file(b))) {
        const r = JSON.parse(l) as TnRollRecord;
        roll.set(r.gisLink, r); // last record wins, as before
      }
      for await (const l of lines(parcelSpill.file(b))) {
        const p = JSON.parse(l) as TnSourceParcel;
        const r = roll.get(p.gisLink);
        if (r) joined += 1;
        const jp: JoinedParcel = { ...p, mailingState: r?.mailingState ?? null, improvementValue: r?.improvementValue ?? null };
        const [x, y] = areaCentroid(p.geometry);
        cellSpill.add(`${Math.floor(x / CELL_DEG)}_${Math.floor(y / CELL_DEG)}`, JSON.stringify(jp));
      }
      rmSync(parcelSpill.file(b), { force: true });
      rmSync(rollSpill.file(b), { force: true });
      sample();
    }
    cellSpill.flush();

    // 4. Cell by cell: bbox pass, one context load, then a streamed facts pass.
    for (const cell of Array.from(cellSpill.keys).sort()) {
      cellCount += 1;
      const file = cellSpill.file(cell);
      const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for await (const l of lines(file)) {
        const b = areaBbox((JSON.parse(l) as JoinedParcel).geometry);
        bbox[0] = Math.min(bbox[0], b[0]);
        bbox[1] = Math.min(bbox[1], b[1]);
        bbox[2] = Math.max(bbox[2], b[2]);
        bbox[3] = Math.max(bbox[3], b[3]);
      }
      const ctx = await deps.loadContext(bbox, deps.today);
      let batch: OwnedParcelInput[] = [];
      const flushBatch = async () => {
        if (batch.length && mayPersist && deps.store) stored += await deps.store.saveBatch(batch);
        batch = [];
      };
      for await (const l of lines(file)) {
        const p = JSON.parse(l) as JoinedParcel;
        const parcelKey = newParcelKey("TN", checked.fips, p.gisLink);
        const c = areaCentroid(p.geometry);
        const facts: ParcelFactSet = computeParcelFacts(
          { parcelKey, state: "TN", county: checked.county, sourceParcelId: p.sourceParcelId, geometry: p.geometry, deededAcres: p.deededAcres, subdivision: p.subdivision, lot: p.lot, ownerMailingState: p.mailingState },
          ctx,
          { assessmentRollSource: source.rollSource },
        );
        const acres = gisAcres(p.geometry);
        // EVERY parcel of a Comptroller county is kept (a customer's lookup
        // anywhere in the county finds it); the artifacts stay the rural/vacant showcase.
        batch.push({
          parcelKey, sourceParcelId: p.sourceParcelId, geometry: p.geometry, centroid: c as [number, number],
          gisAcres: acres, deededAcres: p.deededAcres ?? null, facts,
          attributes: { SUBDIV: p.subdivision ?? null, LOT: p.lot ?? null },
        });
        if (batch.length >= STORE_BATCH) await flushBatch();
        const proj = localProjection(c[0], c[1]);
        const inTown = (ctx.towns?.features ?? []).some((t) => pointInProjectedArea(0, 0, projectArea(t.geometry, proj)));
        if (inTown) {
          urban++;
          continue;
        }
        rural++;
        if (p.improvementValue === null) vacancyUnknown++;
        else if (p.improvementValue > 0) continue;
        else vacant++;
        const truths = parcelTruths({
          state: "TN", county: checked.county, gisAcres: acres, deededAcres: p.deededAcres, subdivision: p.subdivision, lot: p.lot,
          accessIndication: facts.legal_access_indication.status === "computed" ? facts.legal_access_indication.value : null,
        });
        const row: TnRow = {
          parcel_key: parcelKey, state: "TN", county_fips: checked.fips, county: checked.county,
          source_parcel_id: p.sourceParcelId, source_name: source.sourceName, retrieved_on: deps.today,
          gis_acres: acres, deeded_acres: p.deededAcres ?? null,
          facts_json: JSON.stringify(facts), truths_json: JSON.stringify(truths), geometry: p.geometry,
        };
        // Tiles carry only gated facts — the map is a customer surface.
        const props: Record<string, unknown> = { parcel_key: parcelKey, gis_acres: acres, vacancy: p.improvementValue === null ? "unknown" : "vacant" };
        for (const f of projectFactsForCustomer(facts).shown) {
          if (f.status !== "computed") continue;
          if (f.key === "road_frontage_m") props.frontage_m = f.value;
          if (f.key === "legal_access_indication") props.access = f.value;
          if (f.key === "buildable_acres") props.buildable_acres = f.value.acres;
          if (f.key === "public_land_adjacent") props.public_land_adjacent = f.value.adjacent;
          if (f.key === "distance_to_town_km") props.town_km = f.value.km;
        }
        sorter.add({ row, props });
        written++;
        areaSumWritten += areaSqM(p.geometry);
      }
      await flushBatch();
      rmSync(file, { force: true });
      sample();
    }
    if (written === 0) throw new Error("no rural parcels to write — refusing to emit empty artifacts");
    for await (const e of sorter.drain()) {
      tileProps.set(e.row, e.props);
      await writer.write(e.row);
      if (!firstCentroid) firstCentroid = areaCentroid(e.row.geometry) as [number, number];
    }
  } catch (err) {
    writer.discard();
    if (!deps.keepWorkDir) rmSync(work, { recursive: true, force: true });
    throw err;
  }
  const built = await writer.finish();
  if (!deps.keepWorkDir) rmSync(work, { recursive: true, force: true });
  sample();

  // Loader proof, streamed: every row back, and the geometry unchanged in sum.
  const back = await parquetReadBack(built.parquet.localPath);
  if (back.rows !== written) throw new Error(`GeoParquet round-trip lost rows: ${back.rows} != ${written}`);
  if (Math.abs(back.areaSum - areaSumWritten) > 1e-6 * Math.max(1, written)) throw new Error(`geometry changed in round trip (${back.areaSum} vs ${areaSumWritten} m²)`);
  const tileCheck = await sampleTileCheck(built.pmtiles.localPath, firstCentroid as [number, number], "parcels");
  sample();

  const prefix = `tn/${slug(checked.county)}/${deps.today}`;
  const parquet = { ...built.parquet, objectKey: artifactObjectKey(prefix, stem, built.parquet, "parquet") };
  const pmtiles = { ...built.pmtiles, objectKey: artifactObjectKey(prefix, stem, built.pmtiles, "pmtiles") };
  const reasons: string[] = [];
  if (!mayPersist) reasons.push(`never — ${source.kind} artifacts are local proof only`);
  else if (!TN_COMPTROLLER_DOWNLOAD.mayStore) reasons.push("the Comptroller terms record does not allow storing a copy");
  else if (unresolvedUseClasses(deps.dossier ?? TN_COMPTROLLER_DOSSIER).length > 0) {
    reasons.push(`TN use classes unresolved (${unresolvedUseClasses(deps.dossier ?? TN_COMPTROLLER_DOSSIER).join(", ")}) — nothing is uploaded until the dossier resolves them`);
  } else if (!deps.bucketConfigured) reasons.push("skipped — OPEN_DATA_BUCKET_* not set (founder action: create the bucket and keys)");
  const gate: IngestGate = { upload: reasons.length === 0, ownerNamesAllowed: false, reasons };
  const receipts: UploadReceipt[] = [];
  if (gate.upload) {
    if (!deps.objectStore || !deps.upload) throw new Error("the bucket is configured but the run was given no object store — refusing to report a local build as uploaded");
    const client = await deps.objectStore();
    for (const a of [parquet, pmtiles]) receipts.push(await deps.upload(client, "statewide-parcels-bulk", a.objectKey, a));
  }
  let store = "not attempted";
  if (!mayPersist) store = `never — ${source.kind} data is never stored`;
  else if (!deps.store) store = "skipped — set DATABASE_URL to keep this county's parcels (and record its upload receipts)";
  else {
    const r = await deps.store.complete(stored, receipts);
    store = `kept ${stored} parcels in ${checked.county} County; recorded ${r.receiptsRecorded} upload receipt(s)`;
  }
  sample();
  return {
    kind: "tn_comptroller_county_build",
    builtOn: deps.today,
    county: checked.county,
    countyFips: checked.fips,
    label: source.label,
    sourceKind: source.kind,
    parcelsIn,
    skipped: source.skipped(),
    countyNameMissing,
    rollRecords,
    joined,
    cells: cellCount,
    rural,
    urbanSkipped: urban,
    vacant,
    vacancyUnknown,
    written,
    geoparquet: { ...parquet, rowsReadBack: back.rows },
    pmtiles: { ...pmtiles, tiles: built.tileCount, partitions: built.partitions, sampleTile: tileCheck.tile, featuresInSampleTile: tileCheck.features },
    upload: gate.upload ? `uploaded ${receipts.length} objects` : reasons.join("; "),
    store,
    stored,
    outcome: buildOutcome(gate, [parquet, pmtiles], receipts),
    peakRssMb: peak,
    rssCeilingMb: RSS_CEILING_MB,
    overCeiling: peak > RSS_CEILING_MB,
  };
}
