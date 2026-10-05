/**
 * County AREA query — "how many parcels in this county match these filters,
 * and which are they?" (W10.3 list builder, behind the Map door).
 *
 * The parcel providers registered in provider-registry.ts answer ONE parcel
 * per lookup (an APN, an address, a point). A county list is a different
 * question, asked of the same free source: the county's own ArcGIS
 * FeatureServer/MapServer layer (county_gis_endpoints). ATTOM cannot answer an
 * area query and Regrid is not licensed, so this is the only source, and it
 * says so rather than pretending to another.
 *
 * It keeps the registry's disciplines for that source:
 *   - every request goes through fetchGeo (timeout, bounded retry, per-host
 *     rate limit, SSRF guard, contactable User-Agent);
 *   - a circuit breaker with the registry's settings (3 failures in 5 min
 *     opens it; state persisted via dbBreakerStore), keyed per ENDPOINT so one
 *     dark county never blocks another;
 *   - licensing stays on the endpoint row (`redistributable`); this module
 *     reports it and never decides whether records may be saved;
 *   - nothing here is written to provider_cache: a list count must be exact
 *     and current, and most county rows are review-required (live
 *     pass-through only), which the cache guard would refuse anyway.
 *
 * EXACTNESS. Every count returned is the source's own count of the matching
 * records (`returnCountOnly`), or — for a filter the server cannot evaluate —
 * a count over EVERY record of the pushed-down set, read in full. Nothing is
 * sampled and extrapolated. When the set to read exceeds the fetch ceiling
 * the query is REFUSED with the true pushed-down count ("narrow by acreage
 * first"). When the source fails, the caller gets a CountySourceError and no
 * number at all.
 *
 * INJECTION. The `where` clause is built only from (a) field names that come
 * from the endpoint row AND exist in the layer's own field list AND match a
 * plain identifier pattern, and (b) literals this module formats itself:
 * finite numbers rendered without exponent, and an ISO date computed from an
 * integer. No user-supplied string — county, state, name — ever reaches it.
 */

import type { CountyGisEndpoint } from "@shared/schema";
import { OWNER_TYPES, classifyOwnerType, type OwnerType } from "@shared/parcel/ownerName";
import { fetchGeo } from "./fetchGeo";
import { FetchGeoUrlRefused } from "./fetchGeoErrors";
import { ProviderCircuitBreaker } from "./circuit-breaker";
import { dbBreakerStore } from "./circuit-breaker-store";
import { logger } from "../../utils/logger";

/**
 * The most records read to evaluate a filter the county server cannot
 * (owner type always; years owned when the sale date is not a date column).
 * Above it the query is refused with the true pushed-down count.
 */
const AREA_FETCH_CEILING = 20_000;

const SAMPLE_SIZE = 5;
const MAX_ACRES = 1_000_000;
const MAX_YEARS_OWNED = 100;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGE_SIZE = 2_000;

// Same settings as the provider registry's breaker (provider-registry.ts).
const breaker = new ProviderCircuitBreaker({
  failureThreshold: 3,
  windowMs: 5 * 60 * 1000,
  cooloffMs: 5 * 60 * 1000,
  store: dbBreakerStore,
});

export type AreaFilterName = "acreage" | "ownerType" | "yearsOwned";

export interface AreaFilters {
  acreageMin?: number;
  acreageMax?: number;
  ownerTypes?: OwnerType[];
  yearsOwnedMin?: number;
}

export interface AreaRecord {
  apn: string | null;
  owner: string | null;
  acres: number | null;
  address: string | null;
}

export interface AreaQueryResult {
  /** The exact number of matching records in the county source. */
  count: number;
  /** Every matching record when count ≤ memberLimit; null when it was not read. */
  records: AreaRecord[] | null;
  /** Up to five matching records. */
  sample: AreaRecord[];
}

export type CountySourceFailure =
  | "unreachable"
  | "bad_response"
  | "circuit_open"
  | "changed_while_reading"
  | "cannot_page"
  | "misconfigured"
  | "query_refused";

/**
 * The county source failed, refused, or answered unusably. Carries no count,
 * by design.
 *
 * `transient` says whether trying again can help — the route's 502 ("the
 * source failed to answer; try again") versus 422 ("this source cannot answer
 * this, as configured"). Only a source FAILING to answer is transient: it was
 * unreachable, answered 5xx, sent something unreadable, its breaker is open,
 * or its records changed mid-read. A layer that cannot page, a misconfigured
 * endpoint (bad layer id, 4xx, no fields, non-numeric object ids) and a query
 * the server refused with a 4xx-class ArcGIS error are structural.
 */
export class CountySourceError extends Error {
  readonly transient: boolean;
  constructor(
    readonly reason: CountySourceFailure,
    message: string,
    /** The ArcGIS error code, for a `query_refused`. */
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = "CountySourceError";
    this.transient =
      reason === "cannot_page" || reason === "misconfigured"
        ? false
        : reason === "query_refused"
          ? !(code !== null && code >= 400 && code < 500)
          : true;
  }
}

/** The caller went away (the client disconnected); the read stopped. Not a failure of the source. */
export class AreaQueryAborted extends Error {
  constructor() {
    super("The county read was stopped: the request was abandoned.");
    this.name = "AreaQueryAborted";
  }
}

/**
 * The request cannot be answered as asked: a filter the source cannot
 * evaluate, an invalid value, or a set too large to read exactly. `filter`
 * names which; `details` carries any true count that explains it.
 */
export class AreaQueryRefusal extends Error {
  constructor(
    readonly filter: AreaFilterName | null,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AreaQueryRefusal";
  }
}

// ── Field names ──────────────────────────────────────────────────────────────

/** A plain ArcGIS field identifier (optionally one `TABLE.FIELD` qualifier). */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}(\.[A-Za-z_][A-Za-z0-9_]{0,127})?$/;

function safeFieldName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return FIELD_NAME.test(n) ? n : null;
}

type Mappings = NonNullable<CountyGisEndpoint["fieldMappings"]>;

/** The endpoint row's field for each role — null when unmapped or not a plain identifier. */
function mappedFields(endpoint: CountyGisEndpoint) {
  const m: Mappings = endpoint.fieldMappings ?? {};
  return {
    apn: safeFieldName(m.apn ?? endpoint.apnField),
    owner: safeFieldName(m.owner ?? endpoint.ownerField),
    acres: safeFieldName(m.acres),
    address: safeFieldName(m.address),
    saleDate: safeFieldName(m.lastSaleDate),
  };
}

/**
 * Which filters this endpoint's MAPPING can answer. A filter whose field is
 * unmapped is never silently ignored — the query refuses it, naming it.
 * (Whether the mapped field really exists in the layer is checked against
 * the layer's own metadata at query time.)
 */
export function areaFilterCapabilities(endpoint: CountyGisEndpoint): Record<AreaFilterName, boolean> {
  const f = mappedFields(endpoint);
  return { acreage: f.acres !== null, ownerType: f.owner !== null, yearsOwned: f.saleDate !== null };
}

// ── Literals ─────────────────────────────────────────────────────────────────

/** A finite number as an SQL literal with no exponent (toFixed never uses one below 1e21). */
function numericLiteral(n: number): string {
  if (!Number.isFinite(n)) throw new AreaQueryRefusal("acreage", "Acreage must be a number.");
  const text = n.toFixed(4).replace(/\.?0+$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new AreaQueryRefusal("acreage", "Acreage must be a number.");
  return text;
}

/** `now` minus `years` whole years, as YYYY-MM-DD (UTC). */
function cutoffDate(now: Date, years: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

function validateFilters(filters: AreaFilters): void {
  for (const [key, v] of [["acreageMin", filters.acreageMin], ["acreageMax", filters.acreageMax]] as const) {
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_ACRES) {
      throw new AreaQueryRefusal("acreage", `${key} must be a number between 0 and ${MAX_ACRES.toLocaleString("en-US")}.`);
    }
  }
  if (filters.acreageMin !== undefined && filters.acreageMax !== undefined && filters.acreageMin > filters.acreageMax) {
    throw new AreaQueryRefusal("acreage", "The minimum acreage is larger than the maximum.");
  }
  if (filters.ownerTypes !== undefined) {
    if (filters.ownerTypes.length === 0 || filters.ownerTypes.some((t) => !OWNER_TYPES.includes(t))) {
      throw new AreaQueryRefusal("ownerType", `Owner type must be one or more of: ${OWNER_TYPES.join(", ")}.`);
    }
  }
  const y = filters.yearsOwnedMin;
  if (y !== undefined && (!Number.isInteger(y) || y < 1 || y > MAX_YEARS_OWNED)) {
    throw new AreaQueryRefusal("yearsOwned", `Years owned must be a whole number from 1 to ${MAX_YEARS_OWNED}.`);
  }
}

// ── Sale dates held in a non-date column ─────────────────────────────────────

/**
 * Read a sale date from a non-date column, as the LATEST instant it can mean
 * (a bare year means "some time that year" → its last day), so "owned at
 * least N years" is only ever claimed when it is certain. `null` = empty;
 * `undefined` = present but unreadable.
 */
function readSaleDate(v: unknown): Date | null | undefined {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isInteger(v) && v >= 1800 && v <= 2200) return new Date(Date.UTC(v, 11, 31));
    if (Number.isInteger(v) && v >= 18000101 && v <= 22001231) return readSaleDate(String(v));
    // Epoch milliseconds (how ArcGIS serialises dates) — only where the
    // number cannot be anything else; a small integer is not a date.
    if (Math.abs(v) >= 1e10) return new Date(v);
    return undefined;
  }
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return validDate(+m[3], +m[1], +m[2]);
  m = /^(\d{4})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], 11, 31));
  return undefined;
}

function validDate(y: number, mo: number, d: number): Date | undefined {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : undefined;
}

// ── Talking to the layer ─────────────────────────────────────────────────────

const NUMERIC_TYPES = new Set([
  "esriFieldTypeDouble", "esriFieldTypeSingle", "esriFieldTypeInteger",
  "esriFieldTypeSmallInteger", "esriFieldTypeBigInteger",
]);
const DATE_TYPES = new Set(["esriFieldTypeDate", "esriFieldTypeDateOnly", "esriFieldTypeTimestampOffset"]);

/**
 * The ONLY endpoint additionalParams forwarded to the county: an access
 * token. An allowlist, matched case-insensitively — ArcGIS reads parameter
 * names without regard to case, so a deny-list of `where` let `WHERE` through,
 * and any other key (`outStatistics`, `returnDistinctValues`, `gdbVersion`, a
 * second `resultOffset`) can change what a count or a page MEANS.
 */
const FORWARDED_PARAMS = new Set(["token"]);

interface LayerInfo {
  /** Layer field name, keyed by its upper-cased name → { name, type }. */
  fields: Map<string, { name: string; type: string }>;
  maxRecordCount: number;
  supportsPagination: boolean;
  objectIdField: string | null;
}

class LayerClient {
  private readonly layerUrl: string;
  private readonly extraParams: Record<string, string>;
  private readonly breakerKey: string;

  constructor(
    private readonly endpoint: CountyGisEndpoint,
    private readonly signal: AbortSignal | undefined,
  ) {
    const layerId = (endpoint.layerId ?? "0").trim() || "0";
    if (!/^\d{1,6}$/.test(layerId)) {
      throw new CountySourceError("misconfigured", "This county's source is misconfigured (its layer id is not a number).");
    }
    this.layerUrl = `${endpoint.baseUrl.replace(/\/+$/, "")}/${layerId}`;
    this.extraParams = {};
    for (const [k, v] of Object.entries((endpoint.additionalParams ?? {}) as Record<string, unknown>)) {
      const key = k.trim().toLowerCase();
      if (FORWARDED_PARAMS.has(key) && typeof v === "string") this.extraParams[key] = v;
    }
    this.breakerKey = `county-gis-area:${endpoint.id}`;
  }

  /**
   * One request. Only the source FAILING to answer — a network error or
   * timeout, a 5xx/429/408 after fetchGeo's retries, an ArcGIS `error` body
   * whose code is 5xx-class ("Error performing query" is the server failing,
   * whatever the HTTP status) — counts against the breaker. A 4xx-class
   * ArcGIS error on a 200 is the server REFUSING this query (a bad field, an
   * unsupported parameter): refused honestly, but no evidence the county is
   * down, so three of them never black out the county for everyone else. A
   * 4xx is a misconfigured endpoint, and a URL fetchGeo will not fetch at all
   * (unparseable, or blocked by the SSRF guard) is too — neither is an outage.
   *
   * fetchGeo takes no AbortSignal (it owns the per-attempt timeout signal), so
   * an abandoned request is honoured BETWEEN requests: nothing new is sent
   * once the caller has gone.
   */
  private async getJson(url: string): Promise<Record<string, unknown>> {
    if (this.signal?.aborted) throw new AreaQueryAborted();
    const gate = await breaker.shouldAllow(this.breakerKey);
    if (!gate.allowed) {
      throw new CountySourceError(
        "circuit_open",
        "This county's records server failed repeatedly in the last few minutes. Try again shortly.",
      );
    }
    let res: Response;
    try {
      res = await fetchGeo(url, { headers: { Accept: "application/json" }, timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (e) {
      if (e instanceof FetchGeoUrlRefused) {
        // Nothing was sent: the endpoint's address is the problem, not the county.
        throw this.refused(
          new CountySourceError(
            "misconfigured",
            "This county's records address can't be read safely as configured; its source needs to be set up again.",
          ),
        );
      }
      this.sourceFailed(e);
      throw new CountySourceError("unreachable", "We couldn't reach this county's records server.");
    }
    if (!res.ok) {
      if (res.status === 408) {
        // fetchGeo already retried it: the server kept timing out.
        const err = new CountySourceError("unreachable", "This county's records server timed out.");
        this.sourceFailed(err);
        throw err;
      }
      if (res.status >= 500 || res.status === 429) {
        const err = new CountySourceError("bad_response", `This county's records server answered HTTP ${res.status}.`);
        this.sourceFailed(err);
        throw err;
      }
      throw this.refused(
        new CountySourceError(
          "misconfigured",
          `This county's records server refused the request (HTTP ${res.status}); its source needs to be set up again.`,
        ),
      );
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw this.refused(new CountySourceError("bad_response", "This county's records server sent a response we could not read."));
    }
    const err = (data as { error?: { code?: unknown; message?: string } } | null)?.error;
    if (err) {
      const code = typeof err.code === "number" && Number.isInteger(err.code) ? err.code : null;
      const e = new CountySourceError(
        "query_refused",
        `This county's records server refused the query${err.message ? `: ${String(err.message).slice(0, 200)}` : "."}`,
        code,
      );
      // A 5xx-class code is the server failing to answer (counted); anything
      // else is a refusal of this query (logged, not counted).
      if (code !== null && code >= 500) {
        this.sourceFailed(e);
        throw e;
      }
      throw this.refused(e);
    }
    if (!data || typeof data !== "object") {
      throw this.refused(new CountySourceError("bad_response", "This county's records server sent a response we could not read."));
    }
    breaker.recordSuccess(this.breakerKey);
    return data as Record<string, unknown>;
  }

  /** The source failed to answer: counts toward opening this endpoint's breaker. */
  private sourceFailed(e: unknown): void {
    breaker.recordFailure(this.breakerKey);
    logger.warn("[county-area-query] source request failed", {
      source: "county-area-query",
      metadata: { endpointId: this.endpoint.id, state: this.endpoint.state, error: e instanceof Error ? e.message : String(e) },
    });
  }

  /** The source answered but refused or garbled this request: logged, never a breaker failure. */
  private refused(e: CountySourceError): CountySourceError {
    logger.warn("[county-area-query] source refused the request", {
      source: "county-area-query",
      metadata: { endpointId: this.endpoint.id, state: this.endpoint.state, reason: e.reason, code: e.code, error: e.message },
    });
    return e;
  }

  async info(): Promise<LayerInfo> {
    const data = await this.getJson(`${this.layerUrl}?${new URLSearchParams({ ...this.extraParams, f: "json" })}`);
    const fields = new Map<string, { name: string; type: string }>();
    for (const f of Array.isArray(data.fields) ? (data.fields as Array<Record<string, unknown>>) : []) {
      if (typeof f?.name === "string" && typeof f?.type === "string") fields.set(f.name.toUpperCase(), { name: f.name, type: f.type });
    }
    if (fields.size === 0) {
      throw new CountySourceError("misconfigured", "This county's records server did not describe its fields; its source needs to be set up again.");
    }
    const maxRecordCount = Number(data.maxRecordCount);
    const adv = (data.advancedQueryCapabilities ?? {}) as Record<string, unknown>;
    const declaredOid = safeFieldName(typeof data.objectIdField === "string" ? data.objectIdField : null);
    // The layer's own spelling of the field, so the attribute key read back matches.
    const oidField =
      (declaredOid ? safeFieldName(fields.get(declaredOid.toUpperCase())?.name ?? declaredOid) : null) ??
      safeFieldName([...fields.values()].find((f) => f.type === "esriFieldTypeOID")?.name ?? null);
    return {
      fields,
      maxRecordCount: Number.isInteger(maxRecordCount) && maxRecordCount > 0 ? maxRecordCount : 1000,
      supportsPagination: adv.supportsPagination === true,
      objectIdField: oidField,
    };
  }

  private queryUrl(params: Record<string, string>): string {
    return `${this.layerUrl}/query?${new URLSearchParams({ ...this.extraParams, ...params, f: "json" })}`;
  }

  async count(where: string): Promise<number> {
    const data = await this.getJson(this.queryUrl({ where, returnCountOnly: "true" }));
    const n = data.count;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new CountySourceError("bad_response", "This county's records server did not return a count.");
    }
    return n;
  }

  private async page(
    where: string,
    outFields: string[],
    paging: { offset: number; size: number; orderBy: string } | { first: number; orderBy: string | null } | null,
  ): Promise<{ rows: Array<Record<string, unknown>>; exceeded: boolean }> {
    const params: Record<string, string> = { where, outFields: outFields.join(","), returnGeometry: "false" };
    if (paging && "offset" in paging) {
      params.orderByFields = paging.orderBy;
      params.resultOffset = String(paging.offset);
      params.resultRecordCount = String(paging.size);
    } else if (paging) {
      if (paging.orderBy) params.orderByFields = paging.orderBy;
      params.resultRecordCount = String(paging.first);
    }
    const data = await this.getJson(this.queryUrl(params));
    if (!Array.isArray(data.features)) {
      throw new CountySourceError("bad_response", "This county's records server did not return records.");
    }
    const rows = (data.features as Array<{ attributes?: Record<string, unknown> }>).map((f) => f?.attributes ?? {});
    return { rows, exceeded: data.exceededTransferLimit === true };
  }

  /** Every record matching `where`, which the source counted as `expected`. Exact or an error. */
  async readAll(info: LayerInfo, where: string, outFields: string[], expected: number): Promise<Array<Record<string, unknown>>> {
    if (expected === 0) return [];
    const pageSize = Math.min(info.maxRecordCount, MAX_PAGE_SIZE);
    const changed = () =>
      new CountySourceError("changed_while_reading", "This county's records changed while we were reading them. Try again.");
    if (expected <= pageSize) {
      const { rows, exceeded } = await this.page(where, outFields, null);
      if (exceeded || rows.length !== expected) throw changed();
      return rows;
    }
    if (!info.supportsPagination || !info.objectIdField) {
      throw new CountySourceError(
        "cannot_page",
        `This county's records server returns at most ${info.maxRecordCount.toLocaleString("en-US")} records per request and cannot page, so a set this large can't be read exactly. Narrow the filters.`,
      );
    }
    // Offset paging is exact only if the server really honours the offset
    // and the object-id order. A server that ignores `resultOffset` returns
    // the first page every time — the old loop would have filled the list
    // with repeats and reported exactly `expected` records. So the object id
    // is read with every page and must ADVANCE strictly across the whole
    // read; a repeat or a step backwards is the set changing under us (or a
    // server that cannot page), never a list.
    const oid = info.objectIdField;
    const fieldsWithOid = outFields.some((f) => f.toUpperCase() === oid.toUpperCase()) ? outFields : [...outFields, oid];
    const out: Array<Record<string, unknown>> = [];
    let last = Number.NEGATIVE_INFINITY;
    while (out.length < expected) {
      const { rows } = await this.page(where, fieldsWithOid, { offset: out.length, size: pageSize, orderBy: oid });
      if (rows.length === 0) throw changed();
      for (const row of rows) {
        const id = row[oid];
        if (typeof id !== "number" || !Number.isFinite(id)) {
          throw new CountySourceError(
            "misconfigured",
            "This county's records server does not report numeric record ids, so a set this large can't be read exactly. Narrow the filters.",
          );
        }
        if (id <= last) throw changed();
        last = id;
      }
      out.push(...rows);
    }
    if (out.length !== expected) throw changed();
    return out;
  }

  async sample(info: LayerInfo, where: string, outFields: string[]): Promise<Array<Record<string, unknown>>> {
    const { rows } = await this.page(
      where,
      outFields,
      info.supportsPagination ? { first: SAMPLE_SIZE, orderBy: info.objectIdField } : null,
    );
    return rows.slice(0, SAMPLE_SIZE);
  }
}

// ── The query ────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Count — and, when there are at most `memberLimit`, read — the parcels of
 * one county matching `filters`.
 *
 * Throws AreaQueryRefusal (the request cannot be answered as asked; nothing
 * was guessed), CountySourceError (the source failed or cannot answer; no
 * number exists — see `transient`), or AreaQueryAborted (`opts.signal`
 * fired: the caller went away, and no further request was sent).
 */
export async function queryCountyArea(
  endpoint: CountyGisEndpoint,
  filters: AreaFilters,
  opts: { memberLimit: number; now?: Date; signal?: AbortSignal },
): Promise<AreaQueryResult> {
  validateFilters(filters);
  const wantAcreage = filters.acreageMin !== undefined || filters.acreageMax !== undefined;
  const wantOwner = filters.ownerTypes !== undefined;
  const wantYears = filters.yearsOwnedMin !== undefined;

  const mapped = mappedFields(endpoint);
  const unmapped = (
    [
      ["acreage", wantAcreage && !mapped.acres, "acreage"],
      ["ownerType", wantOwner && !mapped.owner, "owner name"],
      ["yearsOwned", wantYears && !mapped.saleDate, "last sale date"],
    ] as const
  ).find(([, missing]) => missing);
  if (unmapped) {
    throw new AreaQueryRefusal(
      unmapped[0],
      `This county's source has no ${unmapped[2]} field we can read, so it can't filter by ${unmapped[0] === "ownerType" ? "owner type" : unmapped[0] === "yearsOwned" ? "years owned" : "acreage"}. Remove that filter.`,
    );
  }

  const client = new LayerClient(endpoint, opts.signal);
  const info = await client.info();
  const inLayer = (name: string | null) => (name ? info.fields.get(name.toUpperCase()) ?? null : null);
  // Only names the layer itself reports, re-checked as plain identifiers.
  const layerName = (f: { name: string } | null) => (f ? safeFieldName(f.name) : null);

  const acresField = inLayer(mapped.acres);
  const ownerField = inLayer(mapped.owner);
  const saleField = inLayer(mapped.saleDate);
  if (wantAcreage && (!layerName(acresField) || !NUMERIC_TYPES.has(acresField!.type))) {
    throw new AreaQueryRefusal(
      "acreage",
      acresField
        ? "This county's acreage field isn't numeric, so it can't filter by acreage. Remove that filter."
        : "This county's source no longer has the acreage field it was set up with, so it can't filter by acreage. Remove that filter.",
    );
  }
  if (wantOwner && !layerName(ownerField)) {
    throw new AreaQueryRefusal("ownerType", "This county's source no longer has an owner-name field, so it can't filter by owner type. Remove that filter.");
  }
  if (wantYears && !layerName(saleField)) {
    throw new AreaQueryRefusal("yearsOwned", "This county's source no longer has a sale-date field, so it can't filter by years owned. Remove that filter.");
  }

  const fields = {
    apn: layerName(inLayer(mapped.apn)),
    owner: layerName(ownerField),
    acres: layerName(acresField),
    address: layerName(inLayer(mapped.address)),
    saleDate: layerName(saleField),
  };

  const now = opts.now ?? new Date();
  const saleIsDate = wantYears && DATE_TYPES.has(saleField!.type);
  const clauses: string[] = [];
  if (filters.acreageMin !== undefined) clauses.push(`${fields.acres} >= ${numericLiteral(filters.acreageMin)}`);
  if (filters.acreageMax !== undefined) clauses.push(`${fields.acres} <= ${numericLiteral(filters.acreageMax)}`);
  // A parcel with no recorded sale cannot be shown to have been owned N years,
  // so it does not match (the comparison is false for NULL in SQL, and the
  // client-side path below treats an empty value the same way).
  if (saleIsDate) clauses.push(`${fields.saleDate} <= DATE '${cutoffDate(now, filters.yearsOwnedMin!)}'`);
  const where = clauses.length > 0 ? clauses.join(" AND ") : "1=1";

  const outFields = Array.from(
    new Set([fields.apn, fields.owner, fields.acres, fields.address, wantYears && !saleIsDate ? fields.saleDate : null].filter(
      (f): f is string => f !== null,
    )),
  );
  if (outFields.length === 0) {
    throw new CountySourceError("misconfigured", "This county's source has none of the parcel fields we read; it needs to be set up again.");
  }
  const toRecord = (a: Record<string, unknown>): AreaRecord => ({
    apn: fields.apn ? str(a[fields.apn]) : null,
    owner: fields.owner ? str(a[fields.owner]) : null,
    acres: fields.acres ? num(a[fields.acres]) : null,
    address: fields.address ? str(a[fields.address]) : null,
  });

  const pushedDownCount = await client.count(where);
  const clientSide = wantOwner || (wantYears && !saleIsDate);

  if (!clientSide) {
    if (pushedDownCount <= opts.memberLimit) {
      const records = (await client.readAll(info, where, outFields, pushedDownCount)).map(toRecord);
      return { count: pushedDownCount, records, sample: records.slice(0, SAMPLE_SIZE) };
    }
    const sample = (await client.sample(info, where, outFields)).map(toRecord);
    return { count: pushedDownCount, records: null, sample };
  }

  if (pushedDownCount > AREA_FETCH_CEILING) {
    const which = wantOwner ? "Owner type" : "Years owned";
    throw new AreaQueryRefusal(
      wantOwner ? "ownerType" : "yearsOwned",
      `Narrow by acreage first: ${pushedDownCount.toLocaleString("en-US")} parcels match before the ${which.toLowerCase()} filter, and ${which.toLowerCase()} can only be checked exactly over ${AREA_FETCH_CEILING.toLocaleString("en-US")} or fewer.`,
      { pushedDownCount, fetchCeiling: AREA_FETCH_CEILING },
    );
  }

  const all = await client.readAll(info, where, outFields, pushedDownCount);
  // The same boundary as the pushed-down `<= DATE 'cutoff'`: on or before
  // midnight UTC of the cutoff day.
  const cutoff = wantYears && !saleIsDate ? new Date(`${cutoffDate(now, filters.yearsOwnedMin!)}T00:00:00.000Z`) : null;
  const wanted = wantOwner ? new Set<OwnerType>(filters.ownerTypes) : null;
  const matched: AreaRecord[] = [];
  for (const a of all) {
    const rec = toRecord(a);
    if (wanted) {
      const type = classifyOwnerType(rec.owner);
      if (!type || !wanted.has(type)) continue;
    }
    if (cutoff) {
      const raw = a[fields.saleDate!];
      const sold = readSaleDate(raw);
      if (sold === undefined) {
        throw new AreaQueryRefusal(
          "yearsOwned",
          `This county's sale-date field holds values we can't read as dates (for example "${String(raw).slice(0, 40)}"), so it can't filter by years owned. Remove that filter.`,
        );
      }
      if (sold === null || sold.getTime() > cutoff.getTime()) continue;
    }
    matched.push(rec);
  }
  return {
    count: matched.length,
    records: matched.length <= opts.memberLimit ? matched : null,
    sample: matched.slice(0, SAMPLE_SIZE),
  };
}
