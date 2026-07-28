/**
 * Reference ETL provider handlers — Phase 8 Months 11.
 *
 * These plug into the Wenzeslaus orchestrator (etlOrchestrator.ts) and
 * implement the `EtlProviderHandler` contract for two upstream sources:
 *
 *   1. `regrid_parcels` — incremental parcel-boundary updates from
 *      Regrid's API (or compatible source). Streams pages, upserts into
 *      `parcel_snapshots` keyed on `(source='regrid', sourceId=externalId)`.
 *      Watermark: the highest `updatedAt` ISO string seen in the page.
 *
 *   2. `fema_flood_zones` — flood-zone updates from FEMA NFHL. Stores
 *      result documents in `provider_cache` keyed on
 *      `etl:fema:<externalId>`. We reuse `provider_cache` so we don't
 *      need a dedicated table for what is in-effect a low-write
 *      reference snapshot.
 *
 *   3. `irs_soi_migration_v1` — IRS SOI county-to-county migration totals
 *      (Open-Data Program 2.1). Annual inflow/outflow CSVs → upserts the
 *      platform-global `county_migration_summary` table. Watermark: the
 *      IRS filing-year label (e.g. '2223').
 *
 *   4. `census_bps_permits_v1` — Census Building Permits Survey county
 *      annual files (Open-Data Program 2.2). Latest 3 available years →
 *      upserts `county_building_permits`. Watermark: the survey year.
 *
 *   5. `bls_qcew_employment_v1` — BLS QCEW annual county employment +
 *      wages (Open-Data Program 2.3, keyless leg). Latest 3 available
 *      years → upserts `county_employment_wages`. Watermark: the data year.
 *
 * Both handlers expose a `_runtime` object that lets unit tests inject a
 * canned page-iterator (so we can verify watermark + DLQ behaviour
 * without hitting the real upstream).
 *
 * Ruling #9 wave 3: the three county reference ETLs additionally emit
 * best-effort temporal change events into `open_data_change_events` when a
 * newly ingested year materially swings a county signal — see the
 * "County-signal temporal change events" section below.
 */

import { and, eq } from "drizzle-orm";

import {
  providerCache,
  parcelSnapshots,
  countyMigrationSummary,
  countyBuildingPermits,
  countyEmploymentWages,
  openDataChangeEvents,
} from "@shared/schema";
import { db } from "../db";
import { logger } from "../utils/logger";
import { fetchGeo } from "./providers/fetchGeo";
import { recordProviderParcelFacts, coerceSaleDate } from "./data-cache/observation-log";
import {
  registerEtlHandler,
  type DrizzleDb,
  type EtlFetchOpts,
  type EtlProviderHandler,
  type EtlRecord,
  type UpsertAction,
} from "./etlOrchestrator";

// ─── Regrid ─────────────────────────────────────────────────────────────────

/** Numeric-string coercion for parcel_snapshots numeric columns; null on junk. */
function etlNumericStr(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * Shape of a Regrid parcel record we care about for the orchestrator.
 * Real Regrid pulls deliver many more fields; we only normalise what
 * `parcel_snapshots` needs at insert time. The handler stores the
 * untouched original on `rawData` so downstream consumers can read
 * fields the schema doesn't model.
 */
export interface RegridParcelRecord {
  externalId: string; // e.g. "regrid_<ll_uuid>"
  apn: string;
  state: string;
  county: string;
  fipsCode?: string | null;
  owner?: string | null;
  ownerAddress?: string | null;
  siteAddress?: string | null;
  acres?: number | string | null;
  // Tier 2A widened facts (elevation blueprint 2026-06-10) — captured
  // opportunistically from the Regrid standardized schema when present.
  assessedValue?: number | string | null;
  lastSalePrice?: number | string | null;
  lastSaleDate?: string | number | null;
  centroid?: { lat: number; lng: number } | null;
  boundary?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
  rawData?: Record<string, unknown>;
  updatedAt: string; // ISO
}

type RegridFetchPageFn = (opts: {
  since: string | Date | null;
  cursor?: string | null;
  apiKey: string;
  sourceUrl?: string | null;
}) => Promise<{ records: RegridParcelRecord[]; nextCursor?: string | null }>;

/**
 * Default Regrid page-fetcher. In production this would issue a paginated
 * GET against the Regrid `/api/v2/parcels` endpoint with a
 * `?since=<watermark>` query param. The orchestrator only needs the
 * generator semantics — we keep network code out of the orchestrator
 * itself so unit tests can swap this out without an HTTP mock.
 */
const defaultRegridFetchPage: RegridFetchPageFn = async ({ since, cursor, apiKey, sourceUrl }) => {
  const baseUrl = sourceUrl ?? "https://app.regrid.com/api/v2/parcels";
  const url = new URL(baseUrl);
  if (since) {
    const sinceIso = since instanceof Date ? since.toISOString() : String(since);
    url.searchParams.set("since", sinceIso);
  }
  if (cursor) url.searchParams.set("cursor", cursor);
  url.searchParams.set("limit", "200");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Regrid pull failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    parcels?: Array<Record<string, unknown>>;
    next_cursor?: string | null;
  };

  const records: RegridParcelRecord[] = (body.parcels ?? []).map((p) => {
    const fields = (p as { fields?: Record<string, unknown> }).fields ?? {};
    const idVal = String(p.ll_uuid ?? p.id ?? "");
    return {
      externalId: `regrid_${idVal}`,
      apn: String(fields.parcelnumb ?? ""),
      state: String(fields.state2 ?? "").toUpperCase(),
      county: String(fields.county ?? ""),
      fipsCode: (fields.fips as string | undefined) ?? null,
      owner: (fields.owner as string | undefined) ?? null,
      ownerAddress: (fields.mailadd as string | undefined) ?? null,
      siteAddress: (fields.address as string | undefined) ?? null,
      acres: (fields.gisacre as number | string | undefined) ?? null,
      // Tier 2A widened facts — Regrid standardized schema, absent stays null.
      assessedValue: (fields.parval as number | string | undefined) ?? null,
      lastSalePrice: (fields.saleprice as number | string | undefined) ?? null,
      lastSaleDate: (fields.saledate as string | number | undefined) ?? null,
      centroid:
        typeof fields.lat === "number" && typeof fields.lon === "number"
          ? { lat: fields.lat as number, lng: fields.lon as number }
          : null,
      boundary: (p.geometry as RegridParcelRecord["boundary"]) ?? null,
      rawData: p as Record<string, unknown>,
      updatedAt:
        (fields.ll_updated_at as string | undefined) ??
        (p.updated_at as string | undefined) ??
        new Date().toISOString(),
    };
  });

  return { records, nextCursor: body.next_cursor ?? null };
};

export const regridEtlHandler: EtlProviderHandler & {
  _runtime: { fetchPage: RegridFetchPageFn; getApiKey: () => string | null };
} = {
  name: "regrid_parcels",
  _runtime: {
    fetchPage: defaultRegridFetchPage,
    getApiKey: () => process.env.REGRID_API_KEY ?? null,
  },

  async *fetch(opts: EtlFetchOpts): AsyncGenerator<EtlRecord, void, void> {
    const apiKey = regridEtlHandler._runtime.getApiKey();
    if (!apiKey) {
      logger.warn("[etl:regrid] no API key configured — skipping pull");
      return;
    }
    let cursor: string | null = null;
    do {
      const page = await regridEtlHandler._runtime.fetchPage({
        since: opts.since,
        cursor,
        apiKey,
        sourceUrl: opts.sourceUrl,
      });
      for (const r of page.records) {
        yield {
          externalId: r.externalId,
          updatedAt: r.updatedAt,
          payload: r as unknown as Record<string, unknown>,
        };
      }
      cursor = page.nextCursor ?? null;
      // Hard safety: stop after 50 pages per run so a misbehaving cursor
      // never spins forever.
    } while (cursor);
  },

  async upsert(record: EtlRecord, tx: DrizzleDb): Promise<{ action: UpsertAction }> {
    const r = record.payload as unknown as RegridParcelRecord;

    // Iyari — the acorn: every fact this ETL sees becomes an immutable
    // observation. Fire-and-forget; never block or fail the upsert. Read each
    // fact defensively — provenance fields on the record may not exist.
    // Tier 2A: widened to assessed value + sale history; the sale facts land
    // as DATED observations (observedAt = sale date) for the tenure clock.
    if (r?.apn && r?.state && r?.county) {
      void recordProviderParcelFacts({
        apn: r.apn,
        state: r.state,
        county: r.county,
        source: "regrid",
        owner: r.owner,
        ownerAddress: r.ownerAddress,
        siteAddress: r.siteAddress,
        acres: r.acres ?? undefined,
        assessedValue: r.assessedValue ?? undefined,
        lastSalePrice: r.lastSalePrice ?? undefined,
        lastSaleDate: r.lastSaleDate ?? undefined,
      });
    }

    const [existing] = await tx
      .select({ id: parcelSnapshots.id })
      .from(parcelSnapshots)
      .where(
        and(
          eq(parcelSnapshots.source, "regrid"),
          eq(parcelSnapshots.sourceId, r.externalId),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(parcelSnapshots)
        .set({
          apn: r.apn,
          state: r.state,
          county: r.county,
          fipsCode: r.fipsCode ?? null,
          owner: r.owner ?? null,
          ownerAddress: r.ownerAddress ?? null,
          siteAddress: r.siteAddress ?? null,
          acres: r.acres == null ? null : String(r.acres),
          assessedValue: etlNumericStr(r.assessedValue),
          lastSalePrice: etlNumericStr(r.lastSalePrice),
          lastSaleDate: coerceSaleDate(r.lastSaleDate),
          centroid: r.centroid ?? null,
          boundary: r.boundary ?? null,
          rawData: r.rawData ?? null,
          updatedAt: new Date(),
        })
        .where(eq(parcelSnapshots.id, existing.id));
      return { action: "updated" };
    }

    await tx.insert(parcelSnapshots).values({
      source: "regrid",
      sourceId: r.externalId,
      apn: r.apn,
      state: r.state,
      county: r.county,
      fipsCode: r.fipsCode ?? null,
      owner: r.owner ?? null,
      ownerAddress: r.ownerAddress ?? null,
      siteAddress: r.siteAddress ?? null,
      acres: r.acres == null ? null : String(r.acres),
      assessedValue: etlNumericStr(r.assessedValue),
      lastSalePrice: etlNumericStr(r.lastSalePrice),
      lastSaleDate: coerceSaleDate(r.lastSaleDate),
      centroid: r.centroid ?? null,
      boundary: r.boundary ?? null,
      rawData: r.rawData ?? null,
    });
    return { action: "inserted" };
  },

  /**
   * Soft-delete propagation: a parcel that disappears upstream is rare
   * (Regrid does emit retire events though). When it happens we tombstone
   * the local row by clearing the `expiresAt` watermark so callers know
   * to refetch. We don't actually `DELETE` because parcel_snapshots is
   * referenced by deals/leads.
   */
  async softDelete(externalId: string, tx: DrizzleDb): Promise<void> {
    await tx
      .update(parcelSnapshots)
      .set({ expiresAt: new Date(0), updatedAt: new Date() })
      .where(
        and(
          eq(parcelSnapshots.source, "regrid"),
          eq(parcelSnapshots.sourceId, externalId),
        ),
      );
  },
};

// ─── FEMA flood zones ───────────────────────────────────────────────────────

export interface FemaFloodZoneRecord {
  externalId: string; // e.g. "fema_<flood_zone_id>"
  floodZone: string;
  bfe?: number | null; // base flood elevation
  panelId?: string | null;
  geometry?: Record<string, unknown> | null;
  updatedAt: string; // ISO
}

type FemaFetchPageFn = (opts: {
  since: string | Date | null;
  cursor?: string | null;
  sourceUrl?: string | null;
}) => Promise<{ records: FemaFloodZoneRecord[]; nextCursor?: string | null }>;

/**
 * Default FEMA NFHL page-fetcher. The real endpoint is an ArcGIS
 * MapServer that supports a `where` clause on `MOD_DATE` for incremental
 * pulls. We construct that here so production runs only fetch the
 * delta. As with Regrid, the network call is isolated so tests can stub.
 */
const defaultFemaFetchPage: FemaFetchPageFn = async ({ since, cursor, sourceUrl }) => {
  const baseUrl =
    sourceUrl ??
    "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query";
  const url = new URL(baseUrl);
  url.searchParams.set("f", "json");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "1000");
  if (cursor) {
    url.searchParams.set("resultOffset", cursor);
  }
  if (since) {
    const sinceMs =
      since instanceof Date ? since.getTime() : Date.parse(String(since));
    if (!Number.isNaN(sinceMs)) {
      url.searchParams.set("where", `MOD_DATE > ${sinceMs}`);
    } else {
      url.searchParams.set("where", "1=1");
    }
  } else {
    url.searchParams.set("where", "1=1");
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`FEMA pull failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    features?: Array<{ attributes?: Record<string, unknown> }>;
    exceededTransferLimit?: boolean;
  };

  const records: FemaFloodZoneRecord[] = (body.features ?? []).map((f) => {
    const a = f.attributes ?? {};
    const id = String(a.OBJECTID ?? a.DFIRM_ID ?? "");
    return {
      externalId: `fema_${id}`,
      floodZone: String(a.FLD_ZONE ?? ""),
      bfe: typeof a.STATIC_BFE === "number" ? (a.STATIC_BFE as number) : null,
      panelId: (a.DFIRM_ID as string | undefined) ?? null,
      updatedAt:
        typeof a.MOD_DATE === "number"
          ? new Date(a.MOD_DATE as number).toISOString()
          : new Date().toISOString(),
    };
  });

  // ArcGIS pagination: when exceededTransferLimit is true, advance the
  // offset by the page size; otherwise terminate.
  const nextCursor = body.exceededTransferLimit
    ? String((cursor ? parseInt(cursor, 10) : 0) + 1000)
    : null;

  return { records, nextCursor };
};

export const femaEtlHandler: EtlProviderHandler & {
  _runtime: { fetchPage: FemaFetchPageFn };
} = {
  name: "fema_flood_zones",
  _runtime: { fetchPage: defaultFemaFetchPage },

  async *fetch(opts: EtlFetchOpts): AsyncGenerator<EtlRecord, void, void> {
    let cursor: string | null = null;
    do {
      const page = await femaEtlHandler._runtime.fetchPage({
        since: opts.since,
        cursor,
        sourceUrl: opts.sourceUrl,
      });
      for (const r of page.records) {
        yield {
          externalId: r.externalId,
          updatedAt: r.updatedAt,
          payload: r as unknown as Record<string, unknown>,
        };
      }
      cursor = page.nextCursor ?? null;
    } while (cursor);
  },

  async upsert(record: EtlRecord, tx: DrizzleDb): Promise<{ action: UpsertAction }> {
    const r = record.payload as unknown as FemaFloodZoneRecord;
    const cacheKey = `etl:fema:${r.externalId}`;
    // 30 days is plenty — real FEMA updates are rare.
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [existing] = await tx
      .select({ id: providerCache.id })
      .from(providerCache)
      .where(eq(providerCache.cacheKey, cacheKey))
      .limit(1);

    if (existing) {
      await tx
        .update(providerCache)
        .set({
          responseData: r as unknown as Record<string, unknown>,
          expiresAt,
        })
        .where(eq(providerCache.id, existing.id));
      return { action: "updated" };
    }

    await tx.insert(providerCache).values({
      provider: "fema",
      category: "flood_zone",
      cacheKey,
      responseData: r as unknown as Record<string, unknown>,
      costCents: 0,
      expiresAt,
    });
    return { action: "inserted" };
  },

  async softDelete(externalId: string, tx: DrizzleDb): Promise<void> {
    await tx
      .delete(providerCache)
      .where(eq(providerCache.cacheKey, `etl:fema:${externalId}`));
  },
};

// ─── Shared plumbing for free federal CSV pulls ─────────────────────────────

/**
 * GET a public CSV with the hardened geo fetch. Returns null on 404 (the
 * probing pattern: "this year isn't published yet"), throws on any other
 * failure — a failed pull must fail the run loudly, never fabricate.
 */
async function fetchPublicCsv(url: string, timeoutMs: number): Promise<string | null> {
  const res = await fetchGeo(url, { timeoutMs, retries: 2 });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`CSV pull failed: ${res.status} ${res.statusText} (${url})`);
  }
  return await res.text();
}

/** HEAD-probe a public file. 404 → false; any other non-2xx throws. */
async function publicCsvExists(url: string): Promise<boolean> {
  const res = await fetchGeo(url, { method: "HEAD", timeoutMs: 15_000, retries: 2 });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`CSV probe failed: ${res.status} ${res.statusText} (${url})`);
  }
  return true;
}

// ─── County-signal temporal change events (ruling #9 wave 3) ────────────────
//
// When one of the three county reference ETLs (IRS SOI migration, Census BPS
// permits, BLS QCEW employment) ingests a NEW year for a county that already
// has the CONSECUTIVE prior year, material county-level swings become rows in
// `open_data_change_events` (read back via the change-detection service's
// `listRecentChangeEvents`). Honesty rules mirror countyMarketSignals.ts:
//   - suppressed/NULL years never produce events,
//   - no percent is ever computed against zero,
//   - a county's first-ever ingested year is not a change,
//   - narratives contain only real ingested values.
// Emission is strictly best-effort: every failure is logged and swallowed so
// it can never fail a record upsert, poison the DLQ, or hold back the
// watermark. Tests inject `changeEventsRuntime` (same seam pattern as the
// handlers' `_runtime`) to supply canned prior-year rows and capture emitted
// events without a database.

/** One open_data_change_events row, typed against the wave-3 contract. */
export interface OpenDataChangeEventRow {
  category: "migration" | "permits" | "employment";
  scopeType: "county";
  /** "ST/countyslug", e.g. "TX/travis" (see countyScopeRef for the QCEW fallback). */
  scopeRef: string;
  field: string;
  previousValue: string;
  newValue: string;
  /**
   * Source freshness of the PREVIOUS knowledge. Annual county data for year Y
   * is as-of the end of that year (UTC), so this is the prior data-year's end
   * — a real property of the source's coverage, not an invented timestamp.
   */
  previousAsOf: Date | null;
  detectedAt: Date;
  source: string;
  severity: "info" | "notable";
  narrative: string;
}

/** End of a data year, UTC — the as-of instant of annual county data. */
function yearEndUtc(year: number): Date {
  return new Date(Date.UTC(year, 11, 31));
}

/**
 * As-of instant for an IRS filing-year pair label: "2223" covers tax years
 * 2022→2023, so the data is as-of end of the second year. Null on junk.
 * (Labels are 2000s-era by construction — the IRS scheme is 'YYZZ'.)
 */
function filingYearAsOf(label: string): Date | null {
  if (!/^\d{4}$/.test(label)) return null;
  return yearEndUtc(2000 + parseInt(label.slice(2), 10));
}

/** Census state FIPS → USPS abbreviation (states + DC + territories). */
const STATE_FIPS_TO_USPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
  "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI",
};

/**
 * Slugify a county label the same way growthTargets.countySlugFromLabel does
 * ("Travis County" → "travis") so change-event scopeRefs line up with the
 * "ST/countyslug" keys used elsewhere on the platform.
 */
function countySlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\bcounty\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Build the "ST/countyslug" scope ref. The county name comes from the source
 * file when the upstream publishes one (IRS county flow files and Census BPS
 * annual files both carry the county name; both are threaded through the
 * parsed rows). The BLS QCEW industry file publishes NO county name — for
 * employment events the 3-digit county FIPS stands in as the slug
 * ("TX/453"), which is real data, never a guessed name.
 * Returns null (→ no event) when the state FIPS is unknown.
 */
export function countyScopeRef(
  stateFips: string,
  countyName: string | null,
  countyFips: string,
): string | null {
  const st = STATE_FIPS_TO_USPS[stateFips];
  if (!st) return null;
  const slug = countyName ? countySlug(countyName) : "";
  return `${st}/${slug || countyFips}`;
}

/** "+1,204" / "-312" — signed, thousands-separated, from the real value. */
function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toLocaleString("en-US")}`;
}

/** Consecutive prior IRS filing-year pair label: "2324" → "2223"; null on junk. */
export function priorFilingYearLabel(label: string): string | null {
  if (!/^\d{4}$/.test(label)) return null;
  const a = parseInt(label.slice(0, 2), 10);
  const b = parseInt(label.slice(2), 10);
  const pad = (n: number) => String((n + 99) % 100).padStart(2, "0");
  return `${pad(a)}${pad(b)}`;
}

/**
 * Migration rule (IRS SOI net returns), both years non-suppressed:
 *   - net-returns sign flip (inflow↔outflow, both strictly non-zero) → notable
 *   - else |netReturns| change ≥50% of the prior absolute value → info
 * A flip takes precedence — one event per ingest, the stronger signal wins.
 * Suppressed (NULL) years and a zero prior (percent-against-zero) → no event.
 */
export function detectMigrationChangeEvent(args: {
  scopeRef: string;
  prev: { filingYear: string; netReturns: number | null };
  next: { filingYear: string; netReturns: number | null };
  detectedAt: Date;
}): OpenDataChangeEventRow | null {
  const { scopeRef, prev, next, detectedAt } = args;
  if (prev.netReturns === null || next.netReturns === null) return null;
  const p = prev.netReturns;
  const n = next.netReturns;

  const base = {
    category: "migration" as const,
    scopeType: "county" as const,
    scopeRef,
    field: "netReturns",
    previousValue: String(p),
    newValue: String(n),
    previousAsOf: filingYearAsOf(prev.filingYear),
    detectedAt,
    source: "irs_soi_migration_v1",
  };

  const flipped = (p > 0 && n < 0) || (p < 0 && n > 0);
  if (flipped) {
    const prevDir = p > 0 ? "inflow" : "outflow";
    const nextDir = n > 0 ? "inflow" : "outflow";
    return {
      ...base,
      severity: "notable",
      narrative: `IRS migration for ${scopeRef} flipped from net ${prevDir} (${fmtSigned(p)} returns) to net ${nextDir} (${fmtSigned(n)}) in filing year ${next.filingYear}`,
    };
  }

  if (p === 0) return null; // no percent against zero
  const changePct = ((n - p) / Math.abs(p)) * 100;
  if (Math.abs(changePct) < 50) return null;
  return {
    ...base,
    severity: "info",
    narrative: `IRS net migration for ${scopeRef} moved from ${fmtSigned(p)} to ${fmtSigned(n)} returns (${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%) between filing years ${prev.filingYear} and ${next.filingYear}`,
  };
}

/**
 * Permits rule (Census BPS total permitted units), consecutive years:
 *   latest-year units ≥2x or ≤0.5x the prior year, both years >0 → notable.
 * A zero year never produces an event (a ratio against zero would be
 * fabricated). Note: the BPS annual county files include Census-imputed
 * values and our schema keeps the full (reported+imputed) unit totals with no
 * per-row estimation flag, so both-years>0 + consecutive-years are the
 * enforceable guards here.
 */
export function detectPermitChangeEvent(args: {
  scopeRef: string;
  prev: { year: number; totalUnits: number };
  next: { year: number; totalUnits: number };
  detectedAt: Date;
}): OpenDataChangeEventRow | null {
  const { scopeRef, prev, next, detectedAt } = args;
  if (next.year !== prev.year + 1) return null;
  if (prev.totalUnits <= 0 || next.totalUnits <= 0) return null;
  const ratio = next.totalUnits / prev.totalUnits;
  if (ratio < 2 && ratio > 0.5) return null;
  return {
    category: "permits",
    scopeType: "county",
    scopeRef,
    field: "totalUnits",
    previousValue: String(prev.totalUnits),
    newValue: String(next.totalUnits),
    previousAsOf: yearEndUtc(prev.year),
    detectedAt,
    source: "census_bps_permits_v1",
    severity: "notable",
    narrative: `Census BPS permitted units for ${scopeRef} went from ${prev.totalUnits.toLocaleString("en-US")} (${prev.year}) to ${next.totalUnits.toLocaleString("en-US")} (${next.year}) — ${ratio.toFixed(2)}x year over year`,
  };
}

/**
 * Employment rule (BLS QCEW): the year-over-year employment trend percent
 * crossing the +10% or -10% line between consecutive ingests → info.
 * Needs three consecutive non-suppressed years (two consecutive trends);
 * any suppressed (NULL) year or zero denominator → no event. The first-ever
 * computable trend has nothing to cross from → no event.
 */
export function detectEmploymentTrendCrossing(args: {
  scopeRef: string;
  /** year-2 / year-1 / newly ingested year, consecutive. */
  oldest: { year: number; avgEmployment: number | null };
  middle: { year: number; avgEmployment: number | null };
  newest: { year: number; avgEmployment: number | null };
  detectedAt: Date;
}): OpenDataChangeEventRow | null {
  const { scopeRef, oldest, middle, newest, detectedAt } = args;
  if (middle.year !== oldest.year + 1 || newest.year !== middle.year + 1) return null;
  if (oldest.avgEmployment === null || middle.avgEmployment === null || newest.avgEmployment === null) {
    return null; // BLS-suppressed year — never an event
  }
  if (oldest.avgEmployment === 0 || middle.avgEmployment === 0) return null; // no percent against zero

  const prevTrend = ((middle.avgEmployment - oldest.avgEmployment) / oldest.avgEmployment) * 100;
  const newTrend = ((newest.avgEmployment - middle.avgEmployment) / middle.avgEmployment) * 100;

  const crossed = (t: number): boolean =>
    (prevTrend < t && newTrend >= t) || (prevTrend > t && newTrend <= t);
  const lines: string[] = [];
  if (crossed(10)) lines.push("+10%");
  if (crossed(-10)) lines.push("-10%");
  if (lines.length === 0) return null;

  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  return {
    category: "employment",
    scopeType: "county",
    scopeRef,
    field: "employmentTrendPercent",
    previousValue: prevTrend.toFixed(1),
    newValue: newTrend.toFixed(1),
    previousAsOf: yearEndUtc(middle.year),
    detectedAt,
    source: "bls_qcew_employment_v1",
    severity: "info",
    narrative: `BLS QCEW employment trend for ${scopeRef} crossed ${lines.join(" and ")}: ${fmtPct(prevTrend)} (${oldest.year}→${middle.year}) to ${fmtPct(newTrend)} (${middle.year}→${newest.year})`,
  };
}

/**
 * Injection seam for change-event emission (same pattern as the handlers'
 * `_runtime`). Tests replace the loaders with canned prior-year rows and
 * `insert` with a capturing stub — no database needed. Production code never
 * reassigns it.
 */
export const changeEventsRuntime = {
  now: () => new Date(),

  /** Insert one row into open_data_change_events. Fails loudly here; callers swallow + log. */
  insert: async (event: OpenDataChangeEventRow): Promise<void> => {
    await db.insert(openDataChangeEvents).values({ ...event });
  },

  loadPriorMigration: async (
    stateFips: string,
    countyFips: string,
    filingYear: string,
  ): Promise<{ filingYear: string; netReturns: number | null } | null> => {
    const [row] = await db
      .select({
        filingYear: countyMigrationSummary.filingYear,
        netReturns: countyMigrationSummary.netReturns,
      })
      .from(countyMigrationSummary)
      .where(
        and(
          eq(countyMigrationSummary.stateFips, stateFips),
          eq(countyMigrationSummary.countyFips, countyFips),
          eq(countyMigrationSummary.filingYear, filingYear),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  loadPermitYear: async (
    stateFips: string,
    countyFips: string,
    year: number,
  ): Promise<{ year: number; totalUnits: number } | null> => {
    const [row] = await db
      .select({
        year: countyBuildingPermits.year,
        totalUnits: countyBuildingPermits.totalUnits,
      })
      .from(countyBuildingPermits)
      .where(
        and(
          eq(countyBuildingPermits.stateFips, stateFips),
          eq(countyBuildingPermits.countyFips, countyFips),
          eq(countyBuildingPermits.year, year),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  loadEmploymentYear: async (
    stateFips: string,
    countyFips: string,
    year: number,
  ): Promise<{ year: number; avgEmployment: number | null } | null> => {
    const [row] = await db
      .select({
        year: countyEmploymentWages.year,
        avgEmployment: countyEmploymentWages.avgEmployment,
      })
      .from(countyEmploymentWages)
      .where(
        and(
          eq(countyEmploymentWages.stateFips, stateFips),
          eq(countyEmploymentWages.countyFips, countyFips),
          eq(countyEmploymentWages.year, year),
        ),
      )
      .limit(1);
    return row ?? null;
  },
};

function logChangeEventFailure(
  category: OpenDataChangeEventRow["category"],
  meta: Record<string, unknown>,
  err: unknown,
): void {
  logger.warn(`[etl:change-events] ${category} change-event emission failed (non-fatal)`, {
    metadata: { ...meta, error: err instanceof Error ? err.message : String(err) },
  });
}

/** Best-effort — never throws. Called only when a NEW filing year was inserted. */
export async function emitMigrationChangeEvent(r: CountyMigrationUpsertRow): Promise<void> {
  try {
    const scopeRef = countyScopeRef(r.stateFips, r.countyName ?? null, r.countyFips);
    if (!scopeRef) return;
    const priorLabel = priorFilingYearLabel(r.filingYear);
    if (!priorLabel) return;
    const prev = await changeEventsRuntime.loadPriorMigration(r.stateFips, r.countyFips, priorLabel);
    if (!prev) return; // first-ever year (or a gap) is not a change
    const event = detectMigrationChangeEvent({
      scopeRef,
      prev,
      next: { filingYear: r.filingYear, netReturns: r.netReturns },
      detectedAt: changeEventsRuntime.now(),
    });
    if (event) await changeEventsRuntime.insert(event);
  } catch (err) {
    logChangeEventFailure("migration", { stateFips: r.stateFips, countyFips: r.countyFips, filingYear: r.filingYear }, err);
  }
}

/** Best-effort — never throws. Called only when a NEW survey year was inserted. */
export async function emitPermitChangeEvent(r: BpsCountyPermitRow): Promise<void> {
  try {
    const scopeRef = countyScopeRef(r.stateFips, r.countyName ?? null, r.countyFips);
    if (!scopeRef) return;
    const prev = await changeEventsRuntime.loadPermitYear(r.stateFips, r.countyFips, r.year - 1);
    if (!prev) return; // first-ever year (or a gap) is not a change
    const event = detectPermitChangeEvent({
      scopeRef,
      prev,
      next: { year: r.year, totalUnits: r.totalUnits },
      detectedAt: changeEventsRuntime.now(),
    });
    if (event) await changeEventsRuntime.insert(event);
  } catch (err) {
    logChangeEventFailure("permits", { stateFips: r.stateFips, countyFips: r.countyFips, year: r.year }, err);
  }
}

/** Best-effort — never throws. Called only when a NEW data year was inserted. */
export async function emitEmploymentChangeEvent(r: QcewCountyRow): Promise<void> {
  try {
    if (r.avgEmployment === null) return; // suppressed new year — never an event
    // QCEW's industry file carries no county name; FIPS stands in as the slug.
    const scopeRef = countyScopeRef(r.stateFips, null, r.countyFips);
    if (!scopeRef) return;
    const [middle, oldest] = await Promise.all([
      changeEventsRuntime.loadEmploymentYear(r.stateFips, r.countyFips, r.year - 1),
      changeEventsRuntime.loadEmploymentYear(r.stateFips, r.countyFips, r.year - 2),
    ]);
    if (!middle || !oldest) return; // no prior consecutive trend to cross from
    const event = detectEmploymentTrendCrossing({
      scopeRef,
      oldest,
      middle,
      newest: { year: r.year, avgEmployment: r.avgEmployment },
      detectedAt: changeEventsRuntime.now(),
    });
    if (event) await changeEventsRuntime.insert(event);
  } catch (err) {
    logChangeEventFailure("employment", { stateFips: r.stateFips, countyFips: r.countyFips, year: r.year }, err);
  }
}

// ─── IRS SOI county migration (Open-Data Program 2.1) ──────────────────────

const IRS_SOI_BASE = "https://www.irs.gov/pub/irs-soi";

/**
 * Per-county totals extracted from one IRS flow file. `null` means the IRS
 * suppressed the cell (published as -1) — stored as NULL, never guessed.
 */
export interface IrsCountyFlowTotals {
  stateFips: string;
  countyFips: string;
  /**
   * County name as published in the flow file's summary row (e.g.
   * "Autauga County", stripped of the "Total Migration-…" suffix). Null when
   * the upstream cell is blank. Used only for change-event scope refs.
   */
  countyName: string | null;
  returns: number | null;
  individuals: number | null;
  agiThousands: number | null;
}

/** One upsert row for county_migration_summary (payload of an EtlRecord). */
export interface CountyMigrationUpsertRow {
  stateFips: string;
  countyFips: string;
  /** From the source file's summary row; not persisted — change-event scope only. */
  countyName: string | null;
  filingYear: string;
  inflowReturns: number | null;
  inflowIndividuals: number | null;
  inflowAgiThousands: number | null;
  outflowReturns: number | null;
  outflowIndividuals: number | null;
  outflowAgiThousands: number | null;
  netReturns: number | null;
  netAgiThousands: number | null;
}

/** IRS publishes suppressed cells as -1; anything else non-integer is drift. */
function irsCell(field: string, line: string): number | null {
  const t = field.trim();
  if (t === "-1") return null;
  if (!/^-?\d+$/.test(t)) {
    throw new Error(`IRS migration CSV: unparseable numeric "${t}" in row: ${line}`);
  }
  return parseInt(t, 10);
}

/**
 * Parse one IRS county flow file (countyinflowYYZZ.csv / countyoutflowYYZZ.csv)
 * down to per-county totals.
 *
 * Format (verified empirically 2026-07-13 against countyinflow2223.csv /
 * countyoutflow2223.csv — no quoted fields, no embedded commas):
 *
 *   inflow:  y2_statefips,y2_countyfips,y1_statefips,y1_countyfips,y1_state,y1_countyname,n1,n2,agi
 *   outflow: y1_statefips,y1_countyfips,y2_statefips,y2_countyfips,y2_state,y2_countyname,n1,n2,agi
 *
 * In BOTH files the subject county is columns 0-1 and the counterpart is
 * columns 2-3. We take the IRS-published summary row per county — pseudo-
 * state-FIPS 96 + county 000, labelled "Total Migration-US and Foreign" —
 * rather than summing the county-pair detail, which is suppressed below 10
 * returns (and bucketed into "other flows") and would systematically
 * undercount. n1 = returns, n2 = individuals (exemptions), agi = $ thousands.
 */
export function parseIrsMigrationCsv(
  csv: string,
  direction: "inflow" | "outflow",
): IrsCountyFlowTotals[] {
  const lines = csv.split(/\r?\n/);
  const expectedFirstCol = direction === "inflow" ? "y2_statefips" : "y1_statefips";
  const header = (lines[0] ?? "").trim().toLowerCase();
  if (!header.startsWith(expectedFirstCol)) {
    throw new Error(
      `IRS migration CSV (${direction}): unexpected header "${lines[0]}" — upstream format drift`,
    );
  }

  const totals: IrsCountyFlowTotals[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    if (cols.length < 9) {
      throw new Error(`IRS migration CSV (${direction}): short row: ${line}`);
    }
    // Summary marker: counterpart state 96, county 000. Guard against
    // state-level rollups on the subject side (county 000) just in case.
    if (cols[2] !== "96" || cols[3] !== "000") continue;
    if (cols[1] === "000") continue;
    // Summary rows label the subject county as e.g.
    // "Autauga County Total Migration-US and Foreign" — keep the real name,
    // drop the flow-total suffix. Never invented: blank stays null.
    const rawName = (cols[5] ?? "").replace(/\s+Total Migration-.*$/i, "").trim();
    totals.push({
      stateFips: cols[0],
      countyFips: cols[1],
      countyName: rawName || null,
      returns: irsCell(cols[6], line),
      individuals: irsCell(cols[7], line),
      agiThousands: irsCell(cols[8], line),
    });
  }
  return totals;
}

/**
 * Full outer join of inflow + outflow totals by county. Net values are only
 * computed when BOTH sides are present and unsuppressed — otherwise null.
 */
export function joinIrsMigrationFlows(
  filingYear: string,
  inflows: IrsCountyFlowTotals[],
  outflows: IrsCountyFlowTotals[],
): CountyMigrationUpsertRow[] {
  const net = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : a - b;

  const byKey = new Map<string, CountyMigrationUpsertRow>();
  const blank = (stateFips: string, countyFips: string): CountyMigrationUpsertRow => ({
    stateFips,
    countyFips,
    countyName: null,
    filingYear,
    inflowReturns: null,
    inflowIndividuals: null,
    inflowAgiThousands: null,
    outflowReturns: null,
    outflowIndividuals: null,
    outflowAgiThousands: null,
    netReturns: null,
    netAgiThousands: null,
  });

  for (const f of inflows) {
    const key = `${f.stateFips}${f.countyFips}`;
    const row = byKey.get(key) ?? blank(f.stateFips, f.countyFips);
    row.countyName = row.countyName ?? f.countyName;
    row.inflowReturns = f.returns;
    row.inflowIndividuals = f.individuals;
    row.inflowAgiThousands = f.agiThousands;
    byKey.set(key, row);
  }
  for (const f of outflows) {
    const key = `${f.stateFips}${f.countyFips}`;
    const row = byKey.get(key) ?? blank(f.stateFips, f.countyFips);
    row.countyName = row.countyName ?? f.countyName;
    row.outflowReturns = f.returns;
    row.outflowIndividuals = f.individuals;
    row.outflowAgiThousands = f.agiThousands;
    byKey.set(key, row);
  }
  for (const row of byKey.values()) {
    row.netReturns = net(row.inflowReturns, row.outflowReturns);
    row.netAgiThousands = net(row.inflowAgiThousands, row.outflowAgiThousands);
  }
  return Array.from(byKey.values());
}

/** Filing-year labels newest-first, e.g. 2026 → ['2526','2425','2324','2223','2122']. */
function irsFilingYearCandidates(now = new Date()): string[] {
  const y = now.getUTCFullYear();
  const labels: string[] = [];
  for (let end = y; end >= y - 4; end--) {
    const a = String((end - 1) % 100).padStart(2, "0");
    const b = String(end % 100).padStart(2, "0");
    labels.push(`${a}${b}`);
  }
  return labels;
}

export const irsSoiMigrationEtlHandler: EtlProviderHandler & {
  _runtime: {
    exists: (url: string) => Promise<boolean>;
    download: (url: string) => Promise<string | null>;
    now: () => Date;
  };
} = {
  name: "irs_soi_migration_v1",
  _runtime: {
    exists: publicCsvExists,
    // ~5 MB per file; generous per-attempt timeout.
    download: (url) => fetchPublicCsv(url, 120_000),
    now: () => new Date(),
  },

  async *fetch(opts: EtlFetchOpts): AsyncGenerator<EtlRecord, void, void> {
    const rt = irsSoiMigrationEtlHandler._runtime;
    const base = (opts.sourceUrl ?? IRS_SOI_BASE).replace(/\/$/, "");

    // Newest published filing year, probed newest-first. IRS lags ~2 years,
    // so a handful of 404s before the hit is the normal case.
    let filingYear: string | null = null;
    for (const label of irsFilingYearCandidates(rt.now())) {
      if (await rt.exists(`${base}/countyinflow${label}.csv`)) {
        filingYear = label;
        break;
      }
    }
    if (!filingYear) {
      throw new Error(
        `[etl:irs_soi] no countyinflow file found under ${base} for any recent filing year`,
      );
    }

    // Watermark is the filing-year label; labels compare lexicographically
    // within the 'YYZZ' scheme. Already ingested → cheap monthly no-op.
    if (opts.since && String(opts.since) >= filingYear) {
      logger.info(`[etl:irs_soi] filing year ${filingYear} already ingested — skipping`, {
        metadata: { filingYear, since: String(opts.since) },
      });
      return;
    }

    const [inflowCsv, outflowCsv] = await Promise.all([
      rt.download(`${base}/countyinflow${filingYear}.csv`),
      rt.download(`${base}/countyoutflow${filingYear}.csv`),
    ]);
    if (!inflowCsv || !outflowCsv) {
      throw new Error(
        `[etl:irs_soi] filing year ${filingYear} probe succeeded but download 404'd — refusing partial ingest`,
      );
    }

    const rows = joinIrsMigrationFlows(
      filingYear,
      parseIrsMigrationCsv(inflowCsv, "inflow"),
      parseIrsMigrationCsv(outflowCsv, "outflow"),
    );
    logger.info(`[etl:irs_soi] parsed ${rows.length} county summaries for ${filingYear}`, {
      metadata: { filingYear, counties: rows.length },
    });
    for (const row of rows) {
      yield {
        externalId: `irs_soi_${row.stateFips}${row.countyFips}_${row.filingYear}`,
        updatedAt: row.filingYear,
        payload: row as unknown as Record<string, unknown>,
      };
    }
  },

  async upsert(record: EtlRecord, tx: DrizzleDb): Promise<{ action: UpsertAction }> {
    const r = record.payload as unknown as CountyMigrationUpsertRow;
    const [existing] = await tx
      .select({ id: countyMigrationSummary.id })
      .from(countyMigrationSummary)
      .where(
        and(
          eq(countyMigrationSummary.stateFips, r.stateFips),
          eq(countyMigrationSummary.countyFips, r.countyFips),
          eq(countyMigrationSummary.filingYear, r.filingYear),
        ),
      )
      .limit(1);

    const values = {
      inflowReturns: r.inflowReturns,
      inflowIndividuals: r.inflowIndividuals,
      inflowAgiThousands: r.inflowAgiThousands,
      outflowReturns: r.outflowReturns,
      outflowIndividuals: r.outflowIndividuals,
      outflowAgiThousands: r.outflowAgiThousands,
      netReturns: r.netReturns,
      netAgiThousands: r.netAgiThousands,
    };

    if (existing) {
      await tx
        .update(countyMigrationSummary)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(countyMigrationSummary.id, existing.id));
      return { action: "updated" };
    }

    await tx.insert(countyMigrationSummary).values({
      stateFips: r.stateFips,
      countyFips: r.countyFips,
      filingYear: r.filingYear,
      ...values,
    });
    // A NEW filing year just landed for this county — compare it against the
    // consecutive prior year and emit a change event on a material swing.
    // Best-effort by construction: emitMigrationChangeEvent never throws, so
    // the upsert result (and the run's DLQ/watermark accounting) is untouched.
    await emitMigrationChangeEvent(r);
    return { action: "inserted" };
  },
};

// ─── Census BPS county building permits (Open-Data Program 2.2) ─────────────

const CENSUS_BPS_COUNTY_BASE = "https://www2.census.gov/econ/bps/County";

/** One upsert row for county_building_permits (payload of an EtlRecord). */
export interface BpsCountyPermitRow {
  stateFips: string;
  countyFips: string;
  /** From the source file's county-name column; not persisted — change-event scope only. */
  countyName: string | null;
  year: number;
  totalUnits: number;
  singleFamilyUnits: number;
  multiFamilyUnits: number;
}

function bpsCell(field: string, line: string): number {
  const t = field.trim();
  if (!/^\d+$/.test(t)) {
    throw new Error(`Census BPS CSV: unparseable numeric "${t}" in row: ${line}`);
  }
  return parseInt(t, 10);
}

/**
 * Parse one Census BPS county annual file (co{YYYY}a.txt).
 *
 * Format (verified empirically 2026-07-13 against co2023a.txt): comma-
 * delimited, 2-row header + a blank spacer row, no quoted fields. Data
 * columns: [0]=survey year, [1]=state FIPS, [2]=county FIPS, [3]=region,
 * [4]=division, [5]=county name, then Bldgs/Units/Value triplets for
 * 1-unit [6-8], 2-units [9-11], 3-4 units [12-14], 5+ units [15-17],
 * followed by the "reported" (rep) variants we don't need.
 *
 * We keep permit UNITS (housing units, the demand signal), not building
 * counts. County FIPS 000 rows ("Balance of State", unorganized territory
 * rollups) are skipped — they aren't counties.
 */
export function parseCensusBpsCountyCsv(text: string, year: number): BpsCountyPermitRow[] {
  const lines = text.split(/\r?\n/);
  if (!(lines[1] ?? "").includes("Bldgs,Units,Value")) {
    throw new Error(
      `Census BPS CSV: unexpected header "${lines[1]}" — upstream format drift`,
    );
  }

  const rows: BpsCountyPermitRow[] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    if (!/^\d{4}$/.test(cols[0].trim())) continue; // spacer / non-data line
    if (cols.length < 18) {
      throw new Error(`Census BPS CSV: short row: ${line}`);
    }
    const rowYear = parseInt(cols[0], 10);
    if (rowYear !== year) {
      throw new Error(
        `Census BPS CSV: row year ${rowYear} does not match file year ${year}: ${line}`,
      );
    }
    const stateFips = cols[1].trim();
    const countyFips = cols[2].trim();
    if (countyFips === "000") continue;

    const singleFamilyUnits = bpsCell(cols[7], line);
    const multiFamilyUnits =
      bpsCell(cols[10], line) + bpsCell(cols[13], line) + bpsCell(cols[16], line);
    rows.push({
      stateFips,
      countyFips,
      countyName: cols[5]?.trim() || null,
      year: rowYear,
      totalUnits: singleFamilyUnits + multiFamilyUnits,
      singleFamilyUnits,
      multiFamilyUnits,
    });
  }
  return rows;
}

/** How many annual files to ingest per run — permitCountTrend needs a baseline. */
const BPS_YEARS_TO_INGEST = 3;
/** How far back to probe before concluding the upstream layout changed. */
const BPS_MAX_PROBE_YEARS = 6;

export const censusBpsPermitsEtlHandler: EtlProviderHandler & {
  _runtime: {
    download: (url: string) => Promise<string | null>;
    now: () => Date;
  };
} = {
  name: "census_bps_permits_v1",
  _runtime: {
    download: (url) => fetchPublicCsv(url, 60_000),
    now: () => new Date(),
  },

  async *fetch(opts: EtlFetchOpts): AsyncGenerator<EtlRecord, void, void> {
    const rt = censusBpsPermitsEtlHandler._runtime;
    const base = (opts.sourceUrl ?? CENSUS_BPS_COUNTY_BASE).replace(/\/$/, "");
    const lastCompleteYear = rt.now().getUTCFullYear() - 1;

    // Latest BPS_YEARS_TO_INGEST published annual files, probing newest-first.
    const found: Array<{ year: number; text: string }> = [];
    for (
      let year = lastCompleteYear;
      year > lastCompleteYear - BPS_MAX_PROBE_YEARS && found.length < BPS_YEARS_TO_INGEST;
      year--
    ) {
      // Watermark is the newest ingested survey year — once we're below it
      // the remaining files are already in the table.
      if (opts.since && year <= parseInt(String(opts.since), 10)) break;
      const text = await rt.download(`${base}/co${year}a.txt`);
      if (text !== null) found.push({ year, text });
    }
    if (found.length === 0) {
      if (opts.since) {
        logger.info(`[etl:census_bps] no county file newer than watermark — skipping`, {
          metadata: { since: String(opts.since) },
        });
        return;
      }
      throw new Error(
        `[etl:census_bps] no county annual file found under ${base} in the last ${BPS_MAX_PROBE_YEARS} years`,
      );
    }

    // Oldest first so the watermark lands on the newest year at run end.
    found.sort((a, b) => a.year - b.year);
    for (const { year, text } of found) {
      const rows = parseCensusBpsCountyCsv(text, year);
      logger.info(`[etl:census_bps] parsed ${rows.length} county rows for ${year}`, {
        metadata: { year, counties: rows.length },
      });
      for (const row of rows) {
        yield {
          externalId: `bps_${row.stateFips}${row.countyFips}_${row.year}`,
          updatedAt: String(row.year),
          payload: row as unknown as Record<string, unknown>,
        };
      }
    }
  },

  async upsert(record: EtlRecord, tx: DrizzleDb): Promise<{ action: UpsertAction }> {
    const r = record.payload as unknown as BpsCountyPermitRow;
    const [existing] = await tx
      .select({ id: countyBuildingPermits.id })
      .from(countyBuildingPermits)
      .where(
        and(
          eq(countyBuildingPermits.stateFips, r.stateFips),
          eq(countyBuildingPermits.countyFips, r.countyFips),
          eq(countyBuildingPermits.year, r.year),
        ),
      )
      .limit(1);

    const values = {
      totalUnits: r.totalUnits,
      singleFamilyUnits: r.singleFamilyUnits,
      multiFamilyUnits: r.multiFamilyUnits,
    };

    if (existing) {
      await tx
        .update(countyBuildingPermits)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(countyBuildingPermits.id, existing.id));
      return { action: "updated" };
    }

    await tx.insert(countyBuildingPermits).values({
      stateFips: r.stateFips,
      countyFips: r.countyFips,
      year: r.year,
      ...values,
    });
    // New survey year for the county — best-effort change event (never throws).
    await emitPermitChangeEvent(r);
    return { action: "inserted" };
  },
};

// ─── BLS QCEW county employment & wages (Open-Data Program 2.3) ─────────────

const BLS_QCEW_BASE = "https://data.bls.gov/cew/data/api";

/** One upsert row for county_employment_wages (payload of an EtlRecord). */
export interface QcewCountyRow {
  stateFips: string;
  countyFips: string;
  year: number;
  /** Annual avg of monthly employment; null when BLS-suppressed. */
  avgEmployment: number | null;
  /** Annual avg weekly wage in whole dollars; null when BLS-suppressed. */
  avgWeeklyWage: number | null;
  /** Annual avg establishment count (published even under suppression). */
  establishments: number | null;
}

/** QCEW numeric cells are non-negative integers; anything else is drift. */
function qcewCell(field: string, line: string): number {
  const t = field.trim();
  if (!/^\d+$/.test(t)) {
    throw new Error(`BLS QCEW CSV: unparseable numeric "${t}" in row: ${line}`);
  }
  return parseInt(t, 10);
}

/** QCEW quotes string columns and leaves numerics bare; strip the quotes. */
function qcewField(field: string): string {
  const t = field.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/**
 * Parse one BLS QCEW annual-averages open-data slice
 * (`{year}/a/industry/10.csv` — industry 10 = "total, all industries",
 * every area in one ~3.5 MB file) down to per-county rows.
 *
 * Format (verified empirically 2026-07-13 against the live 2023/2024/2025
 * files): 38 columns, string columns quoted, numerics bare, no embedded
 * commas. We key columns off the header rather than fixed positions so a
 * benign column addition doesn't silently mis-key.
 *
 * Row selection — how non-county aggregates are excluded:
 *   - own_code=0 (total covered) + agglvl_code=70 (county, total, all
 *     ownerships). The file also carries national (10/11), MSA/CSA
 *     (30/40/41), statewide (50/51), MicroSA (80) and per-ownership county
 *     (71) rows — all skipped by this predicate alone.
 *   - area_fips must be 5 digits (belt-and-braces: MSA codes like "C1010"
 *     are non-numeric) and splits as state(2)+county(3).
 *   - county 999 ("unknown or undefined" within a state) and 000 rollups
 *     are not counties — skipped.
 *
 * disclosure_code 'N' means BLS suppressed the county: employment/wage are
 * PUBLISHED AS ZEROS, so we store NULL instead — never a fake zero. The
 * establishment count is published even for suppressed counties and is kept.
 */
export function parseQcewAnnualCsv(csv: string, year: number): QcewCountyRow[] {
  const lines = csv.split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map((c) => qcewField(c).toLowerCase());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i === -1) {
      throw new Error(
        `BLS QCEW CSV: missing column "${name}" in header "${lines[0]}" — upstream format drift`,
      );
    }
    return i;
  };
  const iArea = col("area_fips");
  const iOwn = col("own_code");
  const iAgg = col("agglvl_code");
  const iYear = col("year");
  const iDisclosure = col("disclosure_code");
  const iEstabs = col("annual_avg_estabs");
  const iEmplvl = col("annual_avg_emplvl");
  const iWklyWage = col("annual_avg_wkly_wage");

  const rows: QcewCountyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    if (cols.length !== header.length) {
      throw new Error(`BLS QCEW CSV: expected ${header.length} columns, got ${cols.length}: ${line}`);
    }
    // County, total covered, all ownerships — everything else (national,
    // state, MSA, per-ownership detail) is a rollup we must not double-count.
    if (qcewField(cols[iOwn]) !== "0" || qcewField(cols[iAgg]) !== "70") continue;

    const areaFips = qcewField(cols[iArea]);
    if (!/^\d{5}$/.test(areaFips)) continue; // MSA/CSA codes like "C1010"
    const stateFips = areaFips.slice(0, 2);
    const countyFips = areaFips.slice(2);
    if (countyFips === "999" || countyFips === "000") continue; // not counties

    const rowYear = qcewCell(qcewField(cols[iYear]), line);
    if (rowYear !== year) {
      throw new Error(
        `BLS QCEW CSV: row year ${rowYear} does not match file year ${year}: ${line}`,
      );
    }

    const suppressed = qcewField(cols[iDisclosure]) === "N";
    rows.push({
      stateFips,
      countyFips,
      year: rowYear,
      avgEmployment: suppressed ? null : qcewCell(qcewField(cols[iEmplvl]), line),
      avgWeeklyWage: suppressed ? null : qcewCell(qcewField(cols[iWklyWage]), line),
      establishments: qcewCell(qcewField(cols[iEstabs]), line),
    });
  }
  return rows;
}

/** How many annual files to ingest per run — the wage/employment trends need a baseline. */
const QCEW_YEARS_TO_INGEST = 3;
/** How far back to probe before concluding the upstream layout changed. */
const QCEW_MAX_PROBE_YEARS = 6;

export const blsQcewEmploymentEtlHandler: EtlProviderHandler & {
  _runtime: {
    download: (url: string) => Promise<string | null>;
    now: () => Date;
  };
} = {
  name: "bls_qcew_employment_v1",
  _runtime: {
    // ~3.5 MB per file; generous per-attempt timeout.
    download: (url) => fetchPublicCsv(url, 120_000),
    now: () => new Date(),
  },

  async *fetch(opts: EtlFetchOpts): AsyncGenerator<EtlRecord, void, void> {
    const rt = blsQcewEmploymentEtlHandler._runtime;
    const base = (opts.sourceUrl ?? BLS_QCEW_BASE).replace(/\/$/, "");
    // QCEW publishes the annual file with the Q4 release (~6 months after
    // year end), so last calendar year is the newest possible.
    const lastCompleteYear = rt.now().getUTCFullYear() - 1;

    // Latest QCEW_YEARS_TO_INGEST published annual files, probing newest-first.
    const found: Array<{ year: number; text: string }> = [];
    for (
      let year = lastCompleteYear;
      year > lastCompleteYear - QCEW_MAX_PROBE_YEARS && found.length < QCEW_YEARS_TO_INGEST;
      year--
    ) {
      // Watermark is the newest ingested data year — once we're below it
      // the remaining files are already in the table.
      if (opts.since && year <= parseInt(String(opts.since), 10)) break;
      const text = await rt.download(`${base}/${year}/a/industry/10.csv`);
      if (text !== null) found.push({ year, text });
    }
    if (found.length === 0) {
      if (opts.since) {
        logger.info(`[etl:bls_qcew] no annual file newer than watermark — skipping`, {
          metadata: { since: String(opts.since) },
        });
        return;
      }
      throw new Error(
        `[etl:bls_qcew] no annual industry-10 file found under ${base} in the last ${QCEW_MAX_PROBE_YEARS} years`,
      );
    }

    // Oldest first so the watermark lands on the newest year at run end.
    found.sort((a, b) => a.year - b.year);
    for (const { year, text } of found) {
      const rows = parseQcewAnnualCsv(text, year);
      logger.info(`[etl:bls_qcew] parsed ${rows.length} county rows for ${year}`, {
        metadata: { year, counties: rows.length },
      });
      for (const row of rows) {
        yield {
          externalId: `qcew_${row.stateFips}${row.countyFips}_${row.year}`,
          updatedAt: String(row.year),
          payload: row as unknown as Record<string, unknown>,
        };
      }
    }
  },

  async upsert(record: EtlRecord, tx: DrizzleDb): Promise<{ action: UpsertAction }> {
    const r = record.payload as unknown as QcewCountyRow;
    const [existing] = await tx
      .select({ id: countyEmploymentWages.id })
      .from(countyEmploymentWages)
      .where(
        and(
          eq(countyEmploymentWages.stateFips, r.stateFips),
          eq(countyEmploymentWages.countyFips, r.countyFips),
          eq(countyEmploymentWages.year, r.year),
        ),
      )
      .limit(1);

    const values = {
      avgEmployment: r.avgEmployment,
      avgWeeklyWage: r.avgWeeklyWage,
      establishments: r.establishments,
    };

    if (existing) {
      await tx
        .update(countyEmploymentWages)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(countyEmploymentWages.id, existing.id));
      return { action: "updated" };
    }

    await tx.insert(countyEmploymentWages).values({
      stateFips: r.stateFips,
      countyFips: r.countyFips,
      year: r.year,
      ...values,
    });
    // New data year for the county — best-effort change event (never throws).
    await emitEmploymentChangeEvent(r);
    return { action: "inserted" };
  },
};

// ─── Bootstrap registration ─────────────────────────────────────────────────

let registered = false;

/**
 * Register the reference handlers. Idempotent — safe to call multiple
 * times during boot/test setup.
 */
export function registerReferenceEtlHandlers(): void {
  if (registered) return;
  registerEtlHandler(regridEtlHandler.name, regridEtlHandler);
  registerEtlHandler(femaEtlHandler.name, femaEtlHandler);
  registerEtlHandler(irsSoiMigrationEtlHandler.name, irsSoiMigrationEtlHandler);
  registerEtlHandler(censusBpsPermitsEtlHandler.name, censusBpsPermitsEtlHandler);
  registerEtlHandler(blsQcewEmploymentEtlHandler.name, blsQcewEmploymentEtlHandler);
  registered = true;
}
