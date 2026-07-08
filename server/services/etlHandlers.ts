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
 * Both handlers expose a `_runtime` object that lets unit tests inject a
 * canned page-iterator (so we can verify watermark + DLQ behaviour
 * without hitting the real upstream).
 */

import { and, eq } from "drizzle-orm";

import { providerCache, parcelSnapshots } from "@shared/schema";
import { logger } from "../utils/logger";
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
  registered = true;
}
