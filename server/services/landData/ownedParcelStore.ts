/**
 * Owned parcels — the KEPT copy of a county's storable parcels, as
 * parcel_snapshots rows with source "owned_pipeline" and organization_id NULL
 * (global public-record rows, never a tenant's data and never a lookup cache).
 *
 * Two writers share saveOwnedParcels():
 *   - the on-demand county pipeline (countyPipeline.ts), paging a reviewed,
 *     storable ArcGIS county service;
 *   - the Tennessee Comptroller loader (scripts/land-data/build-tn-showcase.ts
 *     --comptroller, bounded via tnComptrollerCounty.ts; it saves in batches and
 *     finishes with completeLoadedCounty), whose download's terms allow
 *     commercial use. That is how
 *     TN parcels arrive (founder decision 2026-10-11: the state's
 *     non-commercial public service is never used).
 *
 * One reader serves customers by point: ownedParcelAtPoint(), used by every
 * coordinate lookup before any outside source.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { countyDiscoveryQueue, parcelSnapshots } from "@shared/schema";
import { normalizeParcelRef } from "@shared/parcel/parcelRef";
import type { ParcelFactSet } from "@shared/landData/parcelFacts";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";
import { areaBbox, localProjection, pointInProjectedArea, projectArea, type AreaGeometry } from "./geometry";

/** parcel_snapshots.source of a KEPT parcel (never a cache row). */
export const OWNED_SNAPSHOT_SOURCE = "owned_pipeline";

export function normalizeCountyName(c: string): string {
  return (c || "").toLowerCase().replace(/ county$/i, "").replace(/-/g, " ").trim();
}

/**
 * The stored id of an owned parcel: the canonical natural-key APN form
 * (shared/parcel/parcelRef.ts), so the lookup route finds what was stored.
 */
export function ownedApn(state: string, county: string, sourceId: string): string | null {
  const ref = normalizeParcelRef({ state, county, apn: sourceId });
  return ref.ok ? ref.ref.apn : null;
}

export interface OwnedParcelInput {
  parcelKey: string;
  sourceParcelId: string;
  geometry: AreaGeometry;
  centroid: [number, number];
  gisAcres: number;
  deededAcres: number | null;
  facts: ParcelFactSet;
  /** Non-personal source fields only (no owner names). */
  attributes: Record<string, unknown>;
}

export interface OwnedTarget {
  state: string;
  county: string;
  /** Licence-register name of the source the parcels came from. */
  sourceName: string;
  sourceUrl: string;
}

/** Insert or update kept parcels by parcel key. Returns how many were stored. */
export async function saveOwnedParcels(target: OwnedTarget, parcels: OwnedParcelInput[]): Promise<number> {
  const state = target.state.toUpperCase();
  const county = normalizeCountyName(target.county);
  const now = clock.now();
  let stored = 0;
  for (const p of parcels) {
    const [existing] = await db
      .select({ id: parcelSnapshots.id, rawData: parcelSnapshots.rawData })
      .from(parcelSnapshots)
      .where(and(isNull(parcelSnapshots.organizationId), eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE), eq(parcelSnapshots.parcelKey, p.parcelKey)))
      .limit(1);
    const prevHistory = Array.isArray(existing?.rawData?.sourceIdHistory) ? (existing!.rawData!.sourceIdHistory as string[]) : [];
    const apn = ownedApn(state, county, p.sourceParcelId);
    if (!apn) {
      // An id the canonical natural key refuses cannot be found again —
      // skipped (and logged), never stored under a guessed key.
      logger.warn("[ownedParcels] parcel skipped — unusable parcel id", { metadata: { county, state } });
      continue;
    }
    const values = {
      organizationId: null,
      apn,
      state,
      county,
      source: OWNED_SNAPSHOT_SOURCE,
      sourceId: p.sourceParcelId,
      boundary: p.geometry,
      centroid: { lng: p.centroid[0], lat: p.centroid[1] },
      acres: String(p.gisAcres),
      rawData: {
        sourceName: target.sourceName,
        sourceUrl: target.sourceUrl,
        deededAcres: p.deededAcres,
        attributes: p.attributes,
        sourceIdHistory: Array.from(new Set([...prevHistory, apn])),
      },
      parcelKey: p.parcelKey,
      facts: p.facts as unknown as Record<string, unknown>,
      factsComputedAt: now,
      fetchedAt: now,
      expiresAt: null,
      updatedAt: now,
    };
    if (existing) {
      await db.update(parcelSnapshots).set(values).where(and(eq(parcelSnapshots.id, existing.id), isNull(parcelSnapshots.organizationId)));
    } else {
      await db.insert(parcelSnapshots).values(values);
    }
    stored++;
  }
  return stored;
}

/** Mark a county's coverage row complete with the number of parcels kept. */
async function markOwnedCountyComplete(target: OwnedTarget, stored: number): Promise<void> {
  const state = target.state.toUpperCase();
  const county = normalizeCountyName(target.county);
  await db
    .insert(countyDiscoveryQueue)
    .values({ state, county, status: "resolved", lastResult: `loaded from ${target.sourceName}` })
    .onConflictDoNothing();
  await db
    .update(countyDiscoveryQueue)
    .set({ ownedStatus: "complete", ownedRefusalReason: null, ownedParcelsStored: stored, ownedCompletedAt: clock.now(), updatedAt: clock.now() })
    .where(and(eq(countyDiscoveryQueue.state, state), eq(countyDiscoveryQueue.county, county)));
}

export interface OwnedParcelHit {
  apn: string;
  state: string;
  county: string;
  boundary: AreaGeometry;
  centroid: { lat: number; lng: number };
  acres: number;
  sourceName: string;
  fetchedAt: Date | null;
}

/** The kept parcel containing a point, if AcreOS holds one. */
export async function ownedParcelAtPoint(lat: number, lng: number): Promise<OwnedParcelHit | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const pad = 0.02; // ~2 km: a parcel's centroid lies within this of any point inside it (rural parcels up to ~1,000 ac)
  const cLng = sql`(${parcelSnapshots.centroid}->>'lng')::float8`;
  const cLat = sql`(${parcelSnapshots.centroid}->>'lat')::float8`;
  const rows = await db
    .select({
      apn: parcelSnapshots.apn,
      state: parcelSnapshots.state,
      county: parcelSnapshots.county,
      boundary: parcelSnapshots.boundary,
      centroid: parcelSnapshots.centroid,
      acres: parcelSnapshots.acres,
      rawData: parcelSnapshots.rawData,
      fetchedAt: parcelSnapshots.fetchedAt,
    })
    .from(parcelSnapshots)
    .where(
      and(
        isNull(parcelSnapshots.organizationId),
        eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE),
        sql`${cLng} BETWEEN ${lng - pad} AND ${lng + pad}`,
        sql`${cLat} BETWEEN ${lat - pad} AND ${lat + pad}`,
      ),
    )
    .limit(2000);
  const proj = localProjection(lng, lat);
  for (const r of rows) {
    const g = r.boundary as AreaGeometry | null;
    if (!g || !r.centroid) continue;
    const [w, s, e, n] = areaBbox(g);
    if (lng < w || lng > e || lat < s || lat > n) continue;
    if (!pointInProjectedArea(0, 0, projectArea(g, proj))) continue;
    const raw = (r.rawData ?? {}) as Record<string, unknown>;
    return {
      apn: r.apn,
      state: r.state,
      county: r.county,
      boundary: g,
      centroid: { lat: r.centroid.lat, lng: r.centroid.lng },
      acres: Number(r.acres ?? 0),
      sourceName: typeof raw.sourceName === "string" ? raw.sourceName : "AcreOS owned parcels",
      fetchedAt: r.fetchedAt ?? null,
    };
  }
  return null;
}

/**
 * Complete a county whose parcels were kept — in batches by the bounded
 * Comptroller loader (tnComptrollerCounty.ts via
 * scripts/land-data/build-tn-showcase.ts): mark the coverage row complete with
 * `stored`, record each bucket-confirmed receipt against it (what
 * getCorporaStatus() reads for "ingested"), and tell IndexNow.
 */
export async function completeLoadedCounty(
  target: OwnedTarget,
  stored: number,
  receipts: import("./openDataBucket").UploadReceipt[],
): Promise<{ receiptsRecorded: number }> {
  await markOwnedCountyComplete(target, stored);
  const { recordReceipt } = await import("./openDataBucket");
  for (const r of receipts) await recordReceipt(target.state, normalizeCountyName(target.county), r);
  // The county now has a public guide and parcel pages: tell IndexNow
  // (best-effort; dormant without a key).
  const { announceCountyLoaded } = await import("../publicCountyGuide");
  await announceCountyLoaded(target.state, target.county);
  return { receiptsRecorded: receipts.length };
}
