/**
 * Florida statewide cadastral build — D1b (dry-run only; no bucket writes).
 *
 * Fetches the FDOR statewide layer (endpoint + field map verified in
 * server/services/statewideParcelEndpoints.ts), normalizes each parcel to the
 * canonical bulk record (shared/landData/bulkParcelRecord.ts, with per-group
 * provenance — amendment A1), writes GeoParquet + PMTiles LOCALLY, and
 * produces the upload-receipt shape (byte count + SHA-256) WITHOUT uploading.
 *
 * Refusals, decided before anything is built:
 *  - the live layer no longer carries a mapped field   → stop; never guess a
 *    mapping (no-fabrication rule; the D1 stop condition);
 *  - no county, or a county field the live layer does not carry → refuse:
 *    a dry run is bounded to one county, and the FL county field is not in
 *    the verified seed, so it must be named in the job config AND be present
 *    in the live layer's own field list at run time.
 *
 * Honesty contract (corporaStatus): the outcome is "ingested" ONLY with
 * bucket-confirmed upload receipts (openDataBucket.uploadAndConfirm). This job
 * never uploads — no bucket is provisioned (founder decision) and FL's use
 * classes are unresolved (statewideSourceRegistry.ts) — so every run reports
 * dry_run_only with its reasons.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../statewideParcelEndpoints";
import { clock } from "../../utils/clock";
import {
  FIELD_GROUP_DECAY,
  sourceNumber,
  sourceText,
  type BulkParcelRecord,
  type FieldGroup,
  type GroupProvenance,
} from "@shared/landData/bulkParcelRecord";
import { unresolvedUseClasses } from "@shared/openData/sourcePolicy";
import type { AreaGeometry } from "./geometry";
import { readGeoParquetRows, writeGeoParquetRows, type ParquetColumnDef } from "./geoParquet";
import { buildPmtiles } from "./pmtilesWriter";
import type { UploadReceipt } from "./openDataBucket";
import { statewideSource } from "../openData/statewideSourceRegistry";

export const FL_JOB = "fl_statewide_cadastral_v1";

const FL = STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === "FL");
if (!FL) throw new Error("statewideParcelEndpoints.ts has no FL row — the FL build has no verified source");
const FL_LAYER_URL = `${FL.baseUrl.replace(/\/+$/, "")}/${FL.layerId}`;

/** Every source field the normalizer reads — exactly the seed's verified field map. */
const FL_MAPPED_FIELDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FL.fieldMappings).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0),
);

/** A dry run never pulls more than this many parcels (one bounded county). */
const FL_DRY_RUN_MAX_PARCELS = 50_000;
const PAGE_SIZE = 1000;

// ── Conformance (the stop condition) ──────────────────────────────────────

export interface Conformance {
  ok: boolean;
  /** Mapped fields the live layer still carries. */
  present: string[];
  /** Mapped fields the live layer no longer carries — any one stops the build. */
  missing: string[];
}

function checkConformance(layerFieldNames: readonly string[]): Conformance {
  const have = new Set(layerFieldNames);
  const mapped = Object.values(FL_MAPPED_FIELDS);
  const missing = mapped.filter((f) => !have.has(f));
  return { ok: missing.length === 0, present: mapped.filter((f) => have.has(f)), missing };
}

// ── Normalization (A1 provenance per field group) ─────────────────────────

const SOURCE_NAME = FL.attribution;
const STATE_COMPILATION =
  "FDOR statewide compilation of the county property-appraiser rolls; not checked against the county roll for this record";

function group(fields: Array<string | undefined>, hasValue: boolean, asOf: string | null, g: FieldGroup, basis: string): GroupProvenance {
  return {
    source: SOURCE_NAME,
    sourceFields: fields.filter((f): f is string => !!f),
    asOf,
    confidence: hasValue ? (g === "identity" ? "high" : "medium") : null,
    confidenceBasis: hasValue ? basis : "the source carries no value for this group on this parcel",
    decayClass: FIELD_GROUP_DECAY[g],
  };
}

export interface SourceFeature {
  attributes: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

/**
 * One FL feature → the canonical record. null when the parcel has no id (it
 * cannot be keyed). `asOf` is the layer's own lastEditDate when it publishes
 * one; null otherwise — never the fetch date dressed up as the data's date.
 */
function normalizeFlFeature(f: SourceFeature, ctx: { asOf: string | null; county: string | null }): BulkParcelRecord | null {
  const m = FL_MAPPED_FIELDS;
  const a = f.attributes;
  const parcelId = sourceText(a[m.apn]);
  if (!parcelId) return null;
  const geometry =
    f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
      ? { type: f.geometry.type as "Polygon" | "MultiPolygon", coordinates: f.geometry.coordinates }
      : null;
  const ownerName = sourceText(a[m.owner]);
  const situsAddress = sourceText(a[m.address]);
  const assessed = sourceNumber(a[m.assessedValue]);
  const market = sourceNumber(a[m.marketValue]);
  const sale = sourceNumber(a[m.lastSalePrice]);
  return {
    state: "FL",
    county: ctx.county,
    identity: { sourceParcelId: parcelId },
    geometry,
    ownership: { ownerName, situsAddress },
    tax: { assessedValueUsd: assessed },
    valuation: { marketValueUsd: market },
    sale: { lastSalePriceUsd: sale },
    legalDescription: sourceText(a[m.legalDescription]),
    provenance: {
      identity: group([m.apn], true, ctx.asOf, "identity", "the source's own parcel key"),
      geometry: group([], geometry !== null, ctx.asOf, "geometry", `${STATE_COMPILATION}; polygon as served (outSR 4326)`),
      ownership: group([m.owner, m.address], ownerName !== null || situsAddress !== null, ctx.asOf, "ownership", STATE_COMPILATION),
      tax: group([m.assessedValue], assessed !== null, ctx.asOf, "tax", `${STATE_COMPILATION}; AV_NSD is the non-school assessed value`),
      valuation: group([m.marketValue], market !== null, ctx.asOf, "valuation", `${STATE_COMPILATION}; JV is the appraiser's just value, an estimate`),
      sale: group([m.lastSalePrice], sale !== null, ctx.asOf, "sale", `${STATE_COMPILATION}; most recent sale price on the roll`),
    },
  };
}

// ── Local artifacts + the receipt shape ───────────────────────────────────

/** The GeoParquet row. Owner names are withheld while FL's display/internal use is unresolved. */
export interface FlBulkRow {
  source_parcel_id: string;
  state: string;
  county: string | undefined;
  situs_address: string | undefined;
  assessed_value_usd: number | undefined;
  market_value_usd: number | undefined;
  last_sale_price_usd: number | undefined;
  legal_description: string | undefined;
  provenance_json: string;
  geometry: AreaGeometry;
}

const FL_SCHEMA: Record<keyof FlBulkRow, ParquetColumnDef> = {
  source_parcel_id: { type: "UTF8" },
  state: { type: "UTF8" },
  county: { type: "UTF8", optional: true },
  situs_address: { type: "UTF8", optional: true },
  assessed_value_usd: { type: "DOUBLE", optional: true },
  market_value_usd: { type: "DOUBLE", optional: true },
  last_sale_price_usd: { type: "DOUBLE", optional: true },
  legal_description: { type: "UTF8", optional: true },
  provenance_json: { type: "UTF8" },
  geometry: { type: "BYTE_ARRAY" },
};

/** What an upload WOULD be — the receipt shape, explicitly not uploaded. */
export interface DryRunReceipt {
  corpusKey: "statewide-parcels-bulk";
  objectKey: string;
  localPath: string;
  bytes: number;
  sha256: string;
  contentType: string;
  uploaded: false;
  bucket: null;
}

export interface DryRunArtifacts {
  receipts: DryRunReceipt[];
  rowsWritten: number;
  rowsReadBack: number;
  tileCount: number;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export async function buildDryRunArtifacts(records: BulkParcelRecord[], outDir: string, label: string): Promise<DryRunArtifacts> {
  const shaped = records.filter((r) => r.geometry !== null);
  if (shaped.length === 0) throw new Error("no FL parcels with geometry — refusing to emit empty artifacts");
  const u = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
  const rows: FlBulkRow[] = shaped.map((r) => ({
    source_parcel_id: r.identity.sourceParcelId,
    state: r.state,
    county: u(r.county),
    situs_address: u(r.ownership.situsAddress),
    assessed_value_usd: u(r.tax.assessedValueUsd),
    market_value_usd: u(r.valuation.marketValueUsd),
    last_sale_price_usd: u(r.sale.lastSalePriceUsd),
    legal_description: u(r.legalDescription),
    provenance_json: JSON.stringify(r.provenance),
    geometry: r.geometry as unknown as AreaGeometry,
  }));
  mkdirSync(outDir, { recursive: true });
  const pq = path.join(outDir, "fl-parcels.parquet");
  await writeGeoParquetRows(pq, FL_SCHEMA, rows);
  // Loader proof before any receipt: read every row back.
  const back = await readGeoParquetRows<FlBulkRow>(pq);
  if (back.rows.length !== rows.length) throw new Error(`GeoParquet round-trip lost rows: ${back.rows.length} != ${rows.length}`);
  const tiles = await buildPmtiles(
    {
      type: "FeatureCollection",
      features: rows.map((r) => ({ type: "Feature" as const, geometry: r.geometry, properties: { parcel_id: r.source_parcel_id } })),
    },
    { layerName: "parcels", minZoom: 10, maxZoom: 15, name: "AcreOS Florida parcels (dry run)", description: label, attribution: `Parcels: ${SOURCE_NAME}` },
  );
  const pm = path.join(outDir, "fl-parcels.pmtiles");
  writeFileSync(pm, tiles.bytes);
  const pqBytes = readFileSync(pq);
  const day = clock.now().toISOString().slice(0, 10);
  const receipt = (localPath: string, objectKey: string, body: Buffer, contentType: string): DryRunReceipt => ({
    corpusKey: "statewide-parcels-bulk",
    objectKey,
    localPath,
    bytes: body.length,
    sha256: sha256(body),
    contentType,
    uploaded: false,
    bucket: null,
  });
  return {
    receipts: [
      receipt(pq, `fl/${day}/fl-parcels.parquet`, pqBytes, "application/vnd.apache.parquet"),
      receipt(pm, `fl/${day}/fl-parcels.pmtiles`, tiles.bytes, "application/vnd.pmtiles"),
    ],
    rowsWritten: rows.length,
    rowsReadBack: back.rows.length,
    tileCount: tiles.tileCount,
  };
}

// ── The honesty contract ─────────────────────────────────────────────────

export type FlBuildOutcome =
  | { status: "ingested"; receipts: UploadReceipt[] }
  | { status: "dry_run_only"; reasons: string[] };

/**
 * "ingested" ONLY when every artifact has a bucket-confirmed upload receipt
 * (real bytes, a real digest, a named bucket). Dry-run receipts can never
 * satisfy it — they say uploaded:false and name no bucket.
 */
export function ingestOutcome(args: {
  artifacts: readonly DryRunReceipt[];
  uploadReceipts: readonly UploadReceipt[];
  bucketConfigured: boolean;
}): FlBuildOutcome {
  const reasons: string[] = [];
  const entry = statewideSource("FL");
  const unresolved = entry ? unresolvedUseClasses(entry.dossier) : ["internal", "display", "redistribution", "resale"];
  if (unresolved.length > 0) reasons.push(`FL use classes unresolved (${unresolved.join(", ")}) — dry run only until the dossier resolves them`);
  if (!args.bucketConfigured) reasons.push("object storage not provisioned (OPEN_DATA_BUCKET_* unset) — nothing uploaded");
  const confirmed = (r: UploadReceipt) => r.bytes > 0 && /^[0-9a-f]{64}$/.test(r.sha256) && r.bucket.length > 0;
  const covered =
    args.artifacts.length > 0 &&
    args.artifacts.every((a) => args.uploadReceipts.some((r) => confirmed(r) && r.sha256 === a.sha256 && r.bytes === a.bytes));
  if (!covered) reasons.push("no bucket-confirmed upload receipt for the built artifacts");
  if (reasons.length === 0) return { status: "ingested", receipts: [...args.uploadReceipts] };
  return { status: "dry_run_only", reasons };
}

// ── The run ───────────────────────────────────────────────────────────────

export interface FlRunConfig {
  /** The live layer's county field — must be present in the layer's own field list. */
  countyField?: string;
  /** The county value to select (as the source spells it, or its code). */
  countyValue?: string;
  limit?: number;
}

export interface FlRunDeps {
  getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }>;
}

export interface FlFetched {
  asOf: string | null;
  conformance: Conformance;
  county: string;
  countyField: string;
  records: BulkParcelRecord[];
  fetched: number;
  skippedNoId: number;
}

/** Fetch + normalize one bounded county. Throws a plain-words refusal on any stop condition. */
export async function fetchFlCounty(config: FlRunConfig, deps: FlRunDeps): Promise<FlFetched> {
  const meta = await deps.getJson(`${FL_LAYER_URL}?f=json`);
  const body = meta.body as { fields?: Array<{ name: string; type: string }>; objectIdField?: string; editingInfo?: { lastEditDate?: number }; error?: { message?: string } } | null;
  if (!meta.ok || !body || body.error || !Array.isArray(body.fields)) {
    throw new Error(`FL layer metadata unavailable (${body?.error?.message ?? `HTTP ${meta.status}`}) — nothing built`);
  }
  const names = body.fields.map((f) => f.name);
  const conformance = checkConformance(names);
  if (!conformance.ok) {
    throw new Error(
      `STOP: the live FL layer no longer carries mapped field(s) ${conformance.missing.join(", ")} — statewideParcelEndpoints.ts is out of date; mappings are not guessed`,
    );
  }
  if (!config.countyField || !config.countyValue) {
    throw new Error("refused: a dry run is bounded to one county — set config.countyField and config.countyValue");
  }
  if (!names.includes(config.countyField)) {
    throw new Error(`refused: the live FL layer has no field "${config.countyField}" — the county filter must name a field the layer itself carries`);
  }
  const oid = body.objectIdField || body.fields.find((f) => f.type === "esriFieldTypeOID")?.name;
  if (!oid) throw new Error("refused: the FL layer exposes no object-id field — it cannot be paged stably");
  const asOf = typeof body.editingInfo?.lastEditDate === "number" ? new Date(body.editingInfo.lastEditDate).toISOString() : null;
  const limit = Math.min(Math.max(1, config.limit ?? FL_DRY_RUN_MAX_PARCELS), FL_DRY_RUN_MAX_PARCELS);
  const value = config.countyValue.replace(/'/g, "''");
  const outFields = [oid, config.countyField, ...Object.values(FL_MAPPED_FIELDS)].join(",");
  const records: BulkParcelRecord[] = [];
  let fetched = 0;
  let skippedNoId = 0;
  let after = 0;
  while (fetched < limit) {
    const params = new URLSearchParams({
      where: `${oid} > ${after} AND ${config.countyField} = '${value}'`,
      outFields,
      orderByFields: `${oid} ASC`,
      resultRecordCount: String(Math.min(PAGE_SIZE, limit - fetched)),
      outSR: "4326",
      returnGeometry: "true",
      f: "geojson",
    });
    const page = await deps.getJson(`${FL_LAYER_URL}/query?${params}`);
    const pb = page.body as { features?: Array<{ geometry: SourceFeature["geometry"]; properties: Record<string, unknown> }>; error?: { message?: string } } | null;
    if (!page.ok || !pb || pb.error) throw new Error(`FL page failed (${pb?.error?.message ?? `HTTP ${page.status}`})`);
    const feats = pb.features ?? [];
    if (feats.length === 0) break;
    for (const f of feats) {
      fetched += 1;
      const rec = normalizeFlFeature({ attributes: f.properties, geometry: f.geometry }, { asOf, county: config.countyValue });
      if (rec) records.push(rec);
      else skippedNoId += 1;
    }
    after = Math.max(...feats.map((f) => Number(f.properties[oid]) || 0));
  }
  return { asOf, conformance, county: config.countyValue, countyField: config.countyField, records, fetched, skippedNoId };
}
