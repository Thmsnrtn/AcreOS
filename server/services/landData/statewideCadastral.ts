/**
 * Statewide cadastral build — D2a, the D1b template applied to every seeded
 * statewide layer (bulk wave 1: NC, WI, AR, MT; FL is the D1 golden source).
 *
 * One state = one row of STATEWIDE_PARCEL_ENDPOINTS (endpoint + field map
 * verified live, never guessed) + one entry of the statewide source registry
 * (cadence + dossier). From those this module:
 *
 *  1. REFUSES before building anything when
 *     - the state has no verified statewide row (IN, OH, and any state never
 *       seeded) — a layer is not discovered at run time, it is verified first;
 *     - the live layer no longer carries a mapped field (schema drift — the D2d
 *       adapter may propose a remap; it is never applied here);
 *     - the run is not bounded to one county, or names a county field the live
 *       layer does not carry, or the layer exposes no object-id to page on;
 *  2. STREAMS the county: page → normalize → write → release. Nothing holds the
 *     county (streamingArtifacts.ts holds the memory bound); the run samples
 *     RSS every page and reports its peak against RSS_CEILING_MB;
 *  3. DECIDES ingest from the dossier and the bucket, and uploads only then:
 *     a source whose four use classes are not all resolved, or whose policy
 *     forbids caching, is never uploaded — storing a copy in our bucket is
 *     itself the use the dossier has to permit. With a permitted source and a
 *     configured bucket, each artifact is uploaded and HEAD-confirmed
 *     (uploadFileAndConfirm) and the run is "ingested" only with a receipt for
 *     every artifact's exact bytes. No receipts, no "ingested".
 */

import type { BulkParcelRecord, FieldGroup, GroupProvenance } from "@shared/landData/bulkParcelRecord";
import { FIELD_GROUP_DECAY, sourceNumber, sourceText } from "@shared/landData/bulkParcelRecord";
import { unresolvedUseClasses } from "@shared/openData/sourcePolicy";
import { STATEWIDE_PARCEL_ENDPOINTS, type StatewideParcelEndpointSeed } from "../statewideParcelEndpoints";
import { statewideSource, type StatewideSourceEntry } from "../openData/statewideSourceRegistry";
import type { AreaGeometry } from "./geometry";
import type { ParquetColumnDef } from "./geoParquet";
import { StreamingArtifactWriter, type BuiltArtifact, type StreamingArtifactResult } from "./streamingArtifacts";
import type { ObjectStoreClient, UploadReceipt } from "./openDataBucket";

/** The documented per-run RSS ceiling. The acceptance gate runs a large county under a 512 MB cap. */
export const RSS_CEILING_MB = 400;
/** A run never pulls more than this many parcels (one county, however large). */
export const MAX_PARCELS_PER_RUN = 1_500_000;
const PAGE_SIZE = 1000;

/** The canonical fields the normalizer reads. A source maps the subset it carries. */
export const CANONICAL_FIELDS = ["apn", "owner", "address", "assessedValue", "marketValue", "lastSalePrice", "legalDescription"] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];
export type FieldMapping = Partial<Record<CanonicalField, string>>;

export interface StatewideBuildSpec {
  state: string;
  job: string;
  layerUrl: string;
  attribution: string;
  /** canonical field → the live layer's field name. `apn` is required. */
  mapping: FieldMapping;
}

/** The ETL job name for a state's statewide build. */
export const statewideJobName = (state: string) => `${state.toLowerCase()}_statewide_cadastral_v1`;

/** The verified field map of a seed row, restricted to what the normalizer reads. */
export function seedMapping(seed: StatewideParcelEndpointSeed): FieldMapping {
  const m: FieldMapping = {};
  for (const k of CANONICAL_FIELDS) {
    const v = seed.fieldMappings[k];
    if (typeof v === "string" && v.length > 0) m[k] = v;
  }
  return m;
}

/**
 * The build spec for a state, or a refusal. `mapping` overrides the seed's map
 * (the D2d promoted remap) — the seed stays the verified baseline.
 */
export function buildSpecFor(state: string, mapping?: FieldMapping): StatewideBuildSpec {
  const st = state.toUpperCase();
  const seed = STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === st);
  if (!seed) {
    throw new Error(
      `refused: ${st} has no verified statewide layer in statewideParcelEndpoints.ts — a layer is verified live and seeded before it is built, never discovered at run time`,
    );
  }
  const m = mapping ?? seedMapping(seed);
  if (!m.apn) throw new Error(`refused: the ${st} field map names no parcel-id field — records could not be keyed`);
  return { state: st, job: statewideJobName(st), layerUrl: `${seed.baseUrl.replace(/\/+$/, "")}/${seed.layerId}`, attribution: seed.attribution, mapping: m };
}

// ── Conformance (the drift stop condition) ───────────────────────────────

export interface Conformance {
  ok: boolean;
  present: string[];
  missing: string[];
}

export function checkConformance(spec: StatewideBuildSpec, layerFieldNames: readonly string[]): Conformance {
  const have = new Set(layerFieldNames);
  const mapped = Object.values(spec.mapping).filter((f): f is string => !!f);
  const missing = mapped.filter((f) => !have.has(f));
  return { ok: missing.length === 0, present: mapped.filter((f) => have.has(f)), missing };
}

// ── Normalization (A1 provenance per field group) ────────────────────────

const COMPILATION = "statewide compilation of the county assessor rolls; not checked against the county roll for this record";

function group(spec: StatewideBuildSpec, fields: Array<string | undefined>, hasValue: boolean, asOf: string | null, g: FieldGroup, basis: string): GroupProvenance {
  return {
    source: spec.attribution,
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

/** One feature → the canonical record; null when the parcel has no id (it cannot be keyed). */
export function normalizeFeature(spec: StatewideBuildSpec, f: SourceFeature, ctx: { asOf: string | null; county: string | null }): BulkParcelRecord | null {
  const m = spec.mapping;
  const a = f.attributes;
  const read = (k: CanonicalField) => (m[k] ? a[m[k] as string] : undefined);
  const parcelId = sourceText(read("apn"));
  if (!parcelId) return null;
  const geometry =
    f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
      ? { type: f.geometry.type as "Polygon" | "MultiPolygon", coordinates: f.geometry.coordinates }
      : null;
  const ownerName = sourceText(read("owner"));
  const situsAddress = sourceText(read("address"));
  const assessed = sourceNumber(read("assessedValue"));
  const market = sourceNumber(read("marketValue"));
  const sale = sourceNumber(read("lastSalePrice"));
  return {
    state: spec.state,
    county: ctx.county,
    identity: { sourceParcelId: parcelId },
    geometry,
    ownership: { ownerName, situsAddress },
    tax: { assessedValueUsd: assessed },
    valuation: { marketValueUsd: market },
    sale: { lastSalePriceUsd: sale },
    legalDescription: sourceText(read("legalDescription")),
    provenance: {
      identity: group(spec, [m.apn], true, ctx.asOf, "identity", "the source's own parcel key"),
      geometry: group(spec, [], geometry !== null, ctx.asOf, "geometry", `${COMPILATION}; polygon as served (outSR 4326)`),
      ownership: group(spec, [m.owner, m.address], ownerName !== null || situsAddress !== null, ctx.asOf, "ownership", COMPILATION),
      tax: group(spec, [m.assessedValue], assessed !== null, ctx.asOf, "tax", `${COMPILATION}; the assessed value as the source states it`),
      valuation: group(spec, [m.marketValue], market !== null, ctx.asOf, "valuation", `${COMPILATION}; an appraised value is an estimate`),
      sale: group(spec, [m.lastSalePrice], sale !== null, ctx.asOf, "sale", `${COMPILATION}; most recent sale price on the roll`),
    },
  };
}

// ── The streamed county ───────────────────────────────────────────────────

export interface CountyRunConfig {
  countyField?: string;
  countyValue?: string;
  limit?: number;
  /** Forces a dry run even where the gate would allow upload (the D1 FL job seed sets it). */
  dryRun?: boolean;
}

export interface LayerDeps {
  getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }>;
  /** RSS in bytes; defaults to process.memoryUsage().rss. Injected by tests. */
  rss?(): number;
}

export interface LayerField {
  name: string;
  type: string;
  alias: string | null;
}

export interface LayerMeta {
  fieldNames: string[];
  fields: LayerField[];
  objectIdField: string | null;
  asOf: string | null;
}

/**
 * The drift STOP, typed: the live layer no longer carries mapped field(s). It
 * carries what the D2d adapter needs to propose a remap (the live field list);
 * the build itself never acts on it.
 */
export class SchemaDriftError extends Error {
  constructor(
    readonly state: string,
    readonly missing: string[],
    readonly liveFields: LayerField[],
    readonly mapping: FieldMapping,
  ) {
    super(
      `STOP: the live ${state} layer no longer carries mapped field(s) ${missing.join(", ")} — the field map is out of date; mappings are not guessed`,
    );
    this.name = "SchemaDriftError";
  }
}

export async function readLayerMeta(spec: StatewideBuildSpec, deps: LayerDeps): Promise<LayerMeta> {
  const meta = await deps.getJson(`${spec.layerUrl}?f=json`);
  const body = meta.body as { fields?: Array<{ name: string; type: string; alias?: string }>; objectIdField?: string; editingInfo?: { lastEditDate?: number }; error?: { message?: string } } | null;
  if (!meta.ok || !body || body.error || !Array.isArray(body.fields)) {
    throw new Error(`${spec.state} layer metadata unavailable (${body?.error?.message ?? `HTTP ${meta.status}`}) — nothing built`);
  }
  return {
    fieldNames: body.fields.map((f) => f.name),
    fields: body.fields.map((f) => ({ name: f.name, type: f.type, alias: typeof f.alias === "string" && f.alias.length > 0 ? f.alias : null })),
    objectIdField: body.objectIdField || body.fields.find((f) => f.type === "esriFieldTypeOID")?.name || null,
    asOf: typeof body.editingInfo?.lastEditDate === "number" ? new Date(body.editingInfo.lastEditDate).toISOString() : null,
  };
}

export interface CountyStreamSummary {
  state: string;
  county: string;
  countyField: string;
  asOf: string | null;
  conformance: Conformance;
  fetched: number;
  normalized: number;
  skippedNoId: number;
  skippedNoGeometry: number;
  pages: number;
  peakRssMb: number;
}

/**
 * Stream one county through `sink`, page by page. Throws a plain-words
 * refusal on any stop condition, BEFORE the first feature page is read.
 */
export async function streamCounty(
  spec: StatewideBuildSpec,
  config: CountyRunConfig,
  deps: LayerDeps,
  sink: (rec: BulkParcelRecord) => Promise<void>,
): Promise<CountyStreamSummary> {
  const meta = await readLayerMeta(spec, deps);
  const conformance = checkConformance(spec, meta.fieldNames);
  if (!conformance.ok) throw new SchemaDriftError(spec.state, conformance.missing, meta.fields, spec.mapping);
  if (!config.countyField || !config.countyValue) {
    throw new Error("refused: a run is bounded to one county — set config.countyField and config.countyValue");
  }
  if (!meta.fieldNames.includes(config.countyField)) {
    throw new Error(`refused: the live ${spec.state} layer has no field "${config.countyField}" — the county filter must name a field the layer itself carries`);
  }
  const oid = meta.objectIdField;
  if (!oid) throw new Error(`refused: the ${spec.state} layer exposes no object-id field — it cannot be paged stably`);
  const rss = deps.rss ?? (() => process.memoryUsage().rss);
  const limit = Math.min(Math.max(1, config.limit ?? MAX_PARCELS_PER_RUN), MAX_PARCELS_PER_RUN);
  const value = config.countyValue.replace(/'/g, "''");
  const outFields = Array.from(new Set([oid, config.countyField, ...Object.values(spec.mapping).filter((f): f is string => !!f)])).join(",");
  const s: CountyStreamSummary = {
    state: spec.state,
    county: config.countyValue,
    countyField: config.countyField,
    asOf: meta.asOf,
    conformance,
    fetched: 0,
    normalized: 0,
    skippedNoId: 0,
    skippedNoGeometry: 0,
    pages: 0,
    peakRssMb: Math.round(rss() / 1048576),
  };
  let after = 0;
  while (s.fetched < limit) {
    const params = new URLSearchParams({
      where: `${oid} > ${after} AND ${config.countyField} = '${value}'`,
      outFields,
      orderByFields: `${oid} ASC`,
      resultRecordCount: String(Math.min(PAGE_SIZE, limit - s.fetched)),
      outSR: "4326",
      returnGeometry: "true",
      f: "geojson",
    });
    const page = await deps.getJson(`${spec.layerUrl}/query?${params}`);
    const pb = page.body as { features?: Array<{ geometry: SourceFeature["geometry"]; properties: Record<string, unknown> }>; error?: { message?: string } } | null;
    if (!page.ok || !pb || pb.error) throw new Error(`${spec.state} page failed (${pb?.error?.message ?? `HTTP ${page.status}`})`);
    const feats = pb.features ?? [];
    if (feats.length === 0) break;
    s.pages += 1;
    let maxOid = after;
    for (const f of feats) {
      s.fetched += 1;
      const o = Number(f.properties[oid]);
      if (Number.isFinite(o) && o > maxOid) maxOid = o;
      const rec = normalizeFeature(spec, { attributes: f.properties, geometry: f.geometry }, { asOf: meta.asOf, county: config.countyValue });
      if (!rec) {
        s.skippedNoId += 1;
        continue;
      }
      if (!rec.geometry) s.skippedNoGeometry += 1;
      s.normalized += 1;
      await sink(rec);
    }
    if (maxOid <= after) throw new Error(`${spec.state} paging made no progress past object id ${after} — refusing to loop`);
    after = maxOid;
    s.peakRssMb = Math.max(s.peakRssMb, Math.round(rss() / 1048576));
  }
  return s;
}

// ── The artifact row (owner names withheld until display is resolved) ────

export interface BulkRow {
  source_parcel_id: string;
  state: string;
  county: string | undefined;
  owner_name: string | undefined;
  situs_address: string | undefined;
  assessed_value_usd: number | undefined;
  market_value_usd: number | undefined;
  last_sale_price_usd: number | undefined;
  legal_description: string | undefined;
  provenance_json: string;
  geometry: AreaGeometry;
}

export const BULK_SCHEMA: Record<keyof BulkRow, ParquetColumnDef> = {
  source_parcel_id: { type: "UTF8" },
  state: { type: "UTF8" },
  county: { type: "UTF8", optional: true },
  owner_name: { type: "UTF8", optional: true },
  situs_address: { type: "UTF8", optional: true },
  assessed_value_usd: { type: "DOUBLE", optional: true },
  market_value_usd: { type: "DOUBLE", optional: true },
  last_sale_price_usd: { type: "DOUBLE", optional: true },
  legal_description: { type: "UTF8", optional: true },
  provenance_json: { type: "UTF8" },
  geometry: { type: "BYTE_ARRAY" },
};

/**
 * The artifact row. Owner names are written only when the source's dossier
 * allows display — otherwise withheld (the D1 rule, now per state).
 */
export function toBulkRow(r: BulkParcelRecord, ownerNamesAllowed: boolean): BulkRow | null {
  if (!r.geometry) return null;
  const u = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
  return {
    source_parcel_id: r.identity.sourceParcelId,
    state: r.state,
    county: u(r.county),
    owner_name: ownerNamesAllowed ? u(r.ownership.ownerName) : undefined,
    situs_address: u(r.ownership.situsAddress),
    assessed_value_usd: u(r.tax.assessedValueUsd),
    market_value_usd: u(r.valuation.marketValueUsd),
    last_sale_price_usd: u(r.sale.lastSalePriceUsd),
    legal_description: u(r.legalDescription),
    provenance_json: JSON.stringify(r.provenance),
    geometry: r.geometry as unknown as AreaGeometry,
  };
}

// ── The ingest decision (dossier + bucket) ───────────────────────────────

export interface IngestGate {
  /** Upload is permitted: every use class resolved, caching allowed, bucket configured. */
  upload: boolean;
  ownerNamesAllowed: boolean;
  reasons: string[];
}

export function ingestGate(
  state: string,
  bucketConfigured: boolean,
  dryRun = false,
  entry: StatewideSourceEntry | undefined = statewideSource(state),
): IngestGate {
  const reasons: string[] = [];
  if (dryRun) reasons.push("job config dryRun:true — upload disabled for this job");
  if (!entry) {
    reasons.push(`${state} has no statewide registry entry — no dossier, nothing ships`);
    return { upload: false, ownerNamesAllowed: false, reasons };
  }
  const unresolved = unresolvedUseClasses(entry.dossier);
  if (unresolved.length > 0) reasons.push(`${state} use classes unresolved (${unresolved.join(", ")}) — dry run only until the dossier resolves them`);
  else if (!entry.policy.can_cache) reasons.push(`${state} dossier does not allow internal use — no copy may be kept, so nothing is uploaded`);
  if (!bucketConfigured) reasons.push("object storage not configured (OPEN_DATA_BUCKET_* unset) — nothing uploaded");
  return { upload: reasons.length === 0, ownerNamesAllowed: entry.policy.can_display, reasons };
}

export type BuildOutcome =
  | { status: "ingested"; receipts: UploadReceipt[] }
  | { status: "dry_run_only"; reasons: string[] };

/**
 * "ingested" ONLY when the gate allowed upload AND every artifact has a
 * bucket-confirmed receipt for its exact bytes and digest.
 */
export function buildOutcome(gate: IngestGate, artifacts: readonly BuiltArtifact[], receipts: readonly UploadReceipt[]): BuildOutcome {
  const reasons = [...gate.reasons];
  const confirmed = (r: UploadReceipt) => r.bytes > 0 && /^[0-9a-f]{64}$/.test(r.sha256) && r.bucket.length > 0;
  const covered = artifacts.length > 0 && artifacts.every((a) => receipts.some((r) => confirmed(r) && r.sha256 === a.sha256 && r.bytes === a.bytes));
  if (!covered) reasons.push("no bucket-confirmed upload receipt for every built artifact");
  if (reasons.length === 0) return { status: "ingested", receipts: [...receipts] };
  return { status: "dry_run_only", reasons };
}

// ── The whole run ────────────────────────────────────────────────────────

export interface CountyBuildDeps extends LayerDeps {
  outDir: string;
  bucketConfigured: boolean;
  /** Present only when the gate allows upload; built lazily from config by the job. */
  objectStore?: () => Promise<ObjectStoreClient>;
  upload?: (client: ObjectStoreClient, corpusKey: string, objectKey: string, a: BuiltArtifact) => Promise<UploadReceipt>;
  /** Records a confirmed receipt on the county's coverage row. */
  recordReceipt?: (state: string, county: string, r: UploadReceipt) => Promise<void>;
  today: string;
  /** The registry entry the gate reads; defaults to the statewide source registry. */
  sourceEntry?: StatewideSourceEntry;
}

export interface CountyBuildReport {
  kind: "statewide_cadastral_build";
  summary: CountyStreamSummary;
  artifacts: Omit<StreamingArtifactResult, "parquet" | "pmtiles"> & { parquet: BuiltArtifact & { objectKey: string }; pmtiles: BuiltArtifact & { objectKey: string } };
  gate: IngestGate;
  outcome: BuildOutcome;
  rssCeilingMb: number;
  overCeiling: boolean;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Stream a county into local artifacts, then upload them if — and only if —
 * the gate allows. Failures discard the partial artifacts.
 */
export async function buildCounty(spec: StatewideBuildSpec, config: CountyRunConfig, deps: CountyBuildDeps): Promise<CountyBuildReport> {
  const gate = ingestGate(spec.state, deps.bucketConfigured, config.dryRun === true, deps.sourceEntry ?? statewideSource(spec.state));
  const countyLabel = config.countyValue ?? "";
  const stem = `${spec.state.toLowerCase()}-${slug(countyLabel) || "county"}`;
  const writer = new StreamingArtifactWriter<BulkRow>(
    {
      outDir: deps.outDir,
      stem,
      schemaDef: BULK_SCHEMA,
      layerName: "parcels",
      tileName: `AcreOS ${spec.state} parcels`,
      tileDescription: `${spec.state} ${countyLabel}`,
      attribution: `Parcels: ${spec.attribution}`,
    },
    (row) => ({ parcel_id: row.source_parcel_id }),
  );
  await writer.open();
  let summary: CountyStreamSummary;
  let built: StreamingArtifactResult;
  try {
    summary = await streamCounty(spec, config, deps, async (rec) => {
      const row = toBulkRow(rec, gate.ownerNamesAllowed);
      if (row) await writer.write(row);
    });
    built = await writer.finish();
  } catch (err) {
    writer.discard();
    throw err;
  }
  const rss = deps.rss ?? (() => process.memoryUsage().rss);
  summary.peakRssMb = Math.max(summary.peakRssMb, Math.round(rss() / 1048576));
  const prefix = `statewide/${spec.state.toLowerCase()}/${slug(countyLabel)}/${deps.today}`;
  const parquet = { ...built.parquet, objectKey: `${prefix}/${stem}.parquet` };
  const pmtiles = { ...built.pmtiles, objectKey: `${prefix}/${stem}.pmtiles` };
  const receipts: UploadReceipt[] = [];
  if (gate.upload) {
    if (!deps.objectStore || !deps.upload) throw new Error("gate allows upload but the run was given no object store — refusing to report a dry run as a build");
    const client = await deps.objectStore();
    for (const a of [parquet, pmtiles]) {
      const r = await deps.upload(client, "statewide-parcels-bulk", a.objectKey, a);
      if (deps.recordReceipt) await deps.recordReceipt(spec.state, countyLabel, r);
      receipts.push(r);
    }
  }
  return {
    kind: "statewide_cadastral_build",
    summary,
    artifacts: { ...built, parquet, pmtiles },
    gate,
    outcome: buildOutcome(gate, [parquet, pmtiles], receipts),
    rssCeilingMb: RSS_CEILING_MB,
    overCeiling: summary.peakRssMb > RSS_CEILING_MB,
  };
}
