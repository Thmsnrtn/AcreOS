/**
 * On-demand county pipeline (W2 task 1), run on the existing worker.
 *
 * The first customer search in a county starts the county's OWNERSHIP
 * lifecycle on its coverage row (county_discovery_queue.owned_* — discovery
 * finds a source, ownership keeps its parcels; no new table, by the
 * table-count ratchet).
 * The worker drains ONE county at a time (the 1 GB machine's safety margin):
 * it pages the county's free source through fetchGeo, normalizes each parcel,
 * assigns a stable parcel_key through the crosswalk, computes the derived
 * facts for the page's neighbourhood, and stores everything as
 * parcel_snapshots rows with source "owned_pipeline" — kept, not re-fetched
 * per lookup, and never served or overwritten by the lookup cache.
 *
 * Refusal is a first-class outcome, decided BEFORE a byte is fetched:
 *   - no free source for the county         → refused; the miss is recorded
 *     as a "request this county" demand signal (county_discovery_queue);
 *   - a source exists but is pending review  → refused until a human reviews;
 *   - the source's terms forbid storing      → refused; live lookups only.
 * The reason is stored on the row and shown to the customer verbatim.
 */

import { and, desc, eq, sql, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { countyDiscoveryQueue, countyGisEndpoints, parcelSnapshots } from "@shared/schema";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";
import { fetchGeo } from "../providers/fetchGeo";
import { mayCacheAndRedistribute } from "../providers/data-licenses";
import { loadParcelContext, type Bbox } from "../providers/land-context-sources";
import { computeParcelFacts, gisAcres, type ParcelInput, type ParcelContext } from "./computeParcelFacts";
import { areaBbox, areaCentroid, areaSqM, type AreaGeometry } from "./geometry";
import { newParcelKey, reconcileCrosswalk, type KeyedRecord } from "@shared/landData/parcelCrosswalk";
import type { ParcelFactSet } from "@shared/landData/parcelFacts";

// ── Resource caps (1 GB worker) ────────────────────────────────────────────

/** Counties processed at once. The drain lock enforces it; this documents it. */
export const MAX_CONCURRENT_COUNTIES = 1;
/** Features per ArcGIS page — one page is one neighbourhood context load. */
export const PAGE_SIZE = 250;
/** Pages per worker tick (≤ 2,000 parcels), then yield until the next tick. */
const MAX_PAGES_PER_TICK = 8;

/** parcel_snapshots.source of a KEPT parcel (never a cache row). */
export const OWNED_SNAPSHOT_SOURCE = "owned_pipeline";

/** The ownership lifecycle columns of one county's coverage row. */
export interface CountyJob {
  id: number;
  state: string;
  county: string;
  ownedStatus: string | null;
  ownedRefusalReason: string | null;
  ownedDemand: number;
  ownedNextOffset: number;
  ownedParcelsStored: number;
  ownedAttempts: number;
  ownedStartedAt: Date | null;
  ownedCompletedAt: Date | null;
}

const JOB_COLUMNS = {
  id: countyDiscoveryQueue.id,
  state: countyDiscoveryQueue.state,
  county: countyDiscoveryQueue.county,
  ownedStatus: countyDiscoveryQueue.ownedStatus,
  ownedRefusalReason: countyDiscoveryQueue.ownedRefusalReason,
  ownedDemand: countyDiscoveryQueue.ownedDemand,
  ownedNextOffset: countyDiscoveryQueue.ownedNextOffset,
  ownedParcelsStored: countyDiscoveryQueue.ownedParcelsStored,
  ownedAttempts: countyDiscoveryQueue.ownedAttempts,
  ownedStartedAt: countyDiscoveryQueue.ownedStartedAt,
  ownedCompletedAt: countyDiscoveryQueue.ownedCompletedAt,
};

/**
 * Statewide layers carry many counties; storing one county needs a VERIFIED
 * county field. Only fields read from the live layer metadata appear here.
 */
const STATEWIDE_COUNTY_FIELD: Record<string, string> = { TN: "COUNTY_NAME" };

/** Register keys of the statewide parcel services (see data-licenses.ts). */
const STATEWIDE_LICENSE_SOURCE: Record<string, string> = { TN: "TN Property Boundaries Public Use service" };

export function normalizeCountyName(c: string): string {
  return (c || "").toLowerCase().replace(/ county$/i, "").replace(/-/g, " ").trim();
}

// ── Decision (pure) ────────────────────────────────────────────────────────

export interface EndpointView {
  id: number;
  state: string;
  county: string;
  baseUrl: string;
  layerId: string | null;
  isActive: boolean | null;
  redistributable: string;
  /**
   * Data-licence register key for this source, when the register has one
   * (statewide programs). Null for a county row: its human-reviewed licence
   * lives on the county_gis_endpoints row itself (migration 0120).
   */
  licenseSource: string | null;
}

export type Decision =
  | { action: "process"; endpoint: EndpointView; countyWhere: string | null }
  | { action: "refuse"; code: "no_free_source" | "review_pending" | "terms_forbid_storing" | "no_county_filter"; reason: string };

export function decideCountyProcessing(
  state: string,
  county: string,
  endpoints: EndpointView[],
): Decision {
  const st = state.toUpperCase();
  const c = normalizeCountyName(county);
  const countyEp = endpoints.find((e) => e.state === st && normalizeCountyName(e.county) === c);
  const statewide = endpoints.find((e) => e.state === st && e.county === "*");
  const ep = countyEp ?? statewide;
  if (!ep) {
    return {
      action: "refuse",
      code: "no_free_source",
      reason: "We have not found a free parcel source for this county yet. Your search counts as a request — we look for one in order of demand.",
    };
  }
  if (!ep.isActive) {
    return {
      action: "refuse",
      code: "review_pending",
      reason: "A free source for this county was found but has not passed review yet, so we cannot load it.",
    };
  }
  // Storing a copy IS redistribution: the endpoint's own reviewed posture
  // must allow it, and so must the licence register entry it will cite.
  const rowAllows = ep.redistributable === "yes" || ep.redistributable === "attribution";
  if (!rowAllows || (ep.licenseSource !== null && !mayCacheAndRedistribute(ep.licenseSource))) {
    return {
      action: "refuse",
      code: "terms_forbid_storing",
      reason: "This county's free source does not allow us to keep a copy, so its parcels are available as live lookups only.",
    };
  }
  if (ep.county === "*") {
    const field = STATEWIDE_COUNTY_FIELD[st];
    if (!field) {
      return {
        action: "refuse",
        code: "no_county_filter",
        reason: "The statewide source has no verified county field, so one county cannot be loaded from it safely.",
      };
    }
    const name = county.replace(/ county$/i, "").trim().replace(/'/g, "''");
    return { action: "process", endpoint: ep, countyWhere: `${field} = '${name}'` };
  }
  return { action: "process", endpoint: ep, countyWhere: null };
}

// ── Enqueue on customer search ─────────────────────────────────────────────

async function endpointViews(state: string): Promise<EndpointView[]> {
  const rows = await db.select().from(countyGisEndpoints).where(eq(countyGisEndpoints.state, state.toUpperCase()));
  return rows.map((r) => ({
    id: r.id,
    state: r.state,
    county: r.county,
    baseUrl: r.baseUrl,
    layerId: r.layerId,
    isActive: r.isActive,
    redistributable: r.redistributable,
    licenseSource: r.county === "*" ? (STATEWIDE_LICENSE_SOURCE[r.state] ?? null) : null,
  }));
}

export interface EnqueueOutcome {
  status: string;
  refusalReason: string | null;
  demandCount: number;
}

/**
 * Record a customer search in a county. Idempotent per (state, county):
 * repeat searches bump demand. A refusal is decided now so the customer sees
 * the honest answer immediately, and an unsourced county is also pushed onto
 * the discovery queue as a "request this county" demand signal.
 */
export async function enqueueCountyProcessing(state: string, county: string): Promise<EnqueueOutcome> {
  const st = state.toUpperCase();
  const c = normalizeCountyName(county);
  const decision = decideCountyProcessing(st, c, await endpointViews(st));
  const refused = decision.action === "refuse";
  const nextStatus = refused ? "refused" : "pending";
  const nextReason = refused ? decision.reason : null;

  if (refused && decision.code === "no_free_source") {
    // The demand signal: creates or bumps the discovery row for this county.
    const { enqueueCountyForDiscovery } = await import("../coverageLedger");
    await enqueueCountyForDiscovery(st, c).catch((err) =>
      logger.warn("[countyPipeline] discovery demand signal failed", {
        metadata: { state: st, county: c, error: err instanceof Error ? err.message : String(err) },
      }),
    );
  } else {
    // A county with a known source still gets its coverage row, marked
    // resolved for discovery (there is nothing to discover).
    await db
      .insert(countyDiscoveryQueue)
      .values({
        state: st,
        county: c,
        status: "resolved",
        resolvedEndpointId: decision.action === "process" ? decision.endpoint.id : null,
        lastResult: "source already known (W2 ownership request)",
      })
      .onConflictDoNothing();
  }

  const [row] = await db
    .update(countyDiscoveryQueue)
    .set({
      ownedDemand: sql`${countyDiscoveryQueue.ownedDemand} + 1`,
      // Never asked, or refused before: decide afresh (a source may have been
      // reviewed since). Running or complete: leave it alone.
      ownedStatus: sql`CASE WHEN ${countyDiscoveryQueue.ownedStatus} IS NULL OR ${countyDiscoveryQueue.ownedStatus} = 'refused' THEN ${nextStatus} ELSE ${countyDiscoveryQueue.ownedStatus} END`,
      ownedRefusalReason: sql`CASE WHEN ${countyDiscoveryQueue.ownedStatus} IS NULL OR ${countyDiscoveryQueue.ownedStatus} = 'refused' THEN ${nextReason} ELSE ${countyDiscoveryQueue.ownedRefusalReason} END`,
      updatedAt: clock.now(),
    })
    .where(and(eq(countyDiscoveryQueue.state, st), eq(countyDiscoveryQueue.county, c)))
    .returning({
      status: countyDiscoveryQueue.ownedStatus,
      refusalReason: countyDiscoveryQueue.ownedRefusalReason,
      demandCount: countyDiscoveryQueue.ownedDemand,
    });
  return { status: row?.status ?? nextStatus, refusalReason: row?.refusalReason ?? nextReason, demandCount: row?.demandCount ?? 0 };
}

export async function getCountyJob(state: string, county: string): Promise<CountyJob | null> {
  const [row] = await db
    .select(JOB_COLUMNS)
    .from(countyDiscoveryQueue)
    .where(and(eq(countyDiscoveryQueue.state, state.toUpperCase()), eq(countyDiscoveryQueue.county, normalizeCountyName(county))))
    .limit(1);
  return row ?? null;
}

// ── Page processing (deps injected for tests) ─────────────────────────────

export interface SourceFeature {
  objectId: number;
  geometry: AreaGeometry;
  attributes: Record<string, unknown>;
}

export interface StoredParcel {
  parcelKey: string;
  sourceParcelId: string;
  geometry: AreaGeometry;
  centroid: [number, number];
  gisAcres: number;
  deededAcres: number | null;
  facts: ParcelFactSet;
  /** Non-personal mapped source fields (FieldMap.keep). */
  attributes: Record<string, unknown>;
  how: "same_id" | "renumbered" | "new";
}

export interface PageDeps {
  fetchPage(afterObjectId: number): Promise<SourceFeature[]>;
  loadContext(bbox: Bbox): Promise<ParcelContext>;
  existingNear(bbox: Bbox): Promise<KeyedRecord[]>;
  save(parcels: StoredParcel[]): Promise<void>;
}

export interface FieldMap {
  apn: string;
  acres?: string;
  /** Non-personal attributes kept on the row (no owner names). */
  keep: string[];
}

export async function processCountyPage(
  job: { state: string; county: string; countyFips: string | null; nextOffset: number },
  fields: FieldMap,
  deps: PageDeps,
): Promise<{ stored: number; lastObjectId: number; done: boolean }> {
  const feats = await deps.fetchPage(job.nextOffset);
  if (feats.length === 0) return { stored: 0, lastObjectId: job.nextOffset, done: true };

  const inputs: Array<{ f: SourceFeature; sourceId: string; centroid: [number, number]; sqm: number }> = [];
  for (const f of feats) {
    const sourceId = String(f.attributes[fields.apn] ?? "").trim();
    if (!sourceId) continue; // an unidentifiable parcel cannot be keyed — skipped, counted below
    inputs.push({ f, sourceId, centroid: areaCentroid(f.geometry) as [number, number], sqm: areaSqM(f.geometry) });
  }
  const pts = inputs.flatMap((i) => [areaBbox(i.f.geometry)]);
  const bbox: Bbox = [
    Math.min(...pts.map((b) => b[0])), Math.min(...pts.map((b) => b[1])),
    Math.max(...pts.map((b) => b[2])), Math.max(...pts.map((b) => b[3])),
  ];
  const previous = await deps.existingNear(bbox);
  const fips = job.countyFips ?? "00000";
  const xw = reconcileCrosswalk(
    previous,
    inputs.map((i) => ({ sourceId: i.sourceId, centroid: i.centroid, areaSqM: i.sqm })),
    (sid) => newParcelKey(job.state, fips, sid),
  );
  const keyOf = new Map(xw.assigned.map((a) => [a.sourceId, a]));
  const ctx = await deps.loadContext(bbox);
  const out: StoredParcel[] = inputs.map((i) => {
    const a = keyOf.get(i.sourceId)!;
    const deeded = fields.acres ? Number(i.f.attributes[fields.acres]) : NaN;
    const input: ParcelInput = {
      parcelKey: a.parcelKey,
      state: job.state,
      county: job.county,
      sourceParcelId: i.sourceId,
      geometry: i.f.geometry,
      deededAcres: Number.isFinite(deeded) ? deeded : null,
    };
    return {
      parcelKey: a.parcelKey,
      sourceParcelId: i.sourceId,
      geometry: i.f.geometry,
      centroid: i.centroid,
      gisAcres: gisAcres(i.f.geometry),
      deededAcres: input.deededAcres ?? null,
      facts: computeParcelFacts(input, ctx),
      attributes: Object.fromEntries(fields.keep.filter((k) => k in i.f.attributes).map((k) => [k, i.f.attributes[k]])),
      how: a.how,
    };
  });
  await deps.save(out);
  return { stored: out.length, lastObjectId: Math.max(...feats.map((f) => f.objectId)), done: feats.length < PAGE_SIZE };
}

// ── Live deps ──────────────────────────────────────────────────────────────

async function liveDeps(job: CountyJob, ep: EndpointView, countyWhere: string | null, retrievedOn: string): Promise<{ deps: PageDeps; fields: FieldMap }> {
  const layerUrl = `${ep.baseUrl.replace(/\/$/, "")}/${ep.layerId ?? "0"}`;
  const metaRes = await fetchGeo(`${layerUrl}?f=json`, { timeoutMs: 30_000 });
  if (!metaRes.ok) throw new Error(`layer metadata HTTP ${metaRes.status}`);
  const meta = (await metaRes.json()) as { objectIdField?: string; fields?: Array<{ name: string; type: string }> };
  const oid = meta.objectIdField || meta.fields?.find((f) => f.type === "esriFieldTypeOID")?.name;
  if (!oid) throw new Error("layer exposes no object-id field — cannot page it stably");
  const [epRow] = await db.select().from(countyGisEndpoints).where(eq(countyGisEndpoints.id, ep.id)).limit(1);
  const mappings = (epRow?.fieldMappings ?? {}) as Record<string, string | undefined>;
  const fields: FieldMap = {
    apn: mappings.apn || epRow?.apnField || "APN",
    acres: mappings.acres,
    keep: [mappings.apn, mappings.acres, mappings.address, mappings.assessedValue, mappings.zoning].filter((x): x is string => !!x),
  };

  const deps: PageDeps = {
    async fetchPage(after) {
      const where = [`${oid} > ${Math.floor(after)}`, countyWhere].filter(Boolean).join(" AND ");
      const params = new URLSearchParams({
        where,
        outFields: [oid, ...fields.keep].join(","),
        orderByFields: `${oid} ASC`,
        resultRecordCount: String(PAGE_SIZE),
        outSR: "4326",
        returnGeometry: "true",
        f: "geojson",
      });
      const res = await fetchGeo(`${layerUrl}/query?${params}`, { timeoutMs: 60_000, ratePerSec: 1, maxConcurrentPerHost: 1 });
      if (!res.ok) throw new Error(`page HTTP ${res.status}`);
      const body = (await res.json()) as { features?: Array<{ geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }>; error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? "ArcGIS error");
      return (body.features ?? [])
        .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
        .map((f) => ({ objectId: Number(f.properties[oid]), geometry: f.geometry as unknown as AreaGeometry, attributes: f.properties }));
    },
    loadContext: (bbox) =>
      loadParcelContext(bbox, retrievedOn, {
        onLayerError: (layer, err) =>
          logger.warn("[countyPipeline] context layer unavailable", {
            metadata: { layer, county: job.county, error: err instanceof Error ? err.message : String(err) },
          }),
      }),
    async existingNear(b) {
      const lng = sql`(${parcelSnapshots.centroid}->>'lng')::float8`;
      const lat = sql`(${parcelSnapshots.centroid}->>'lat')::float8`;
      const rows = await db
        .select({ parcelKey: parcelSnapshots.parcelKey, sourceId: parcelSnapshots.apn, centroid: parcelSnapshots.centroid, boundary: parcelSnapshots.boundary })
        .from(parcelSnapshots)
        .where(
          and(
            // Owned parcels are GLOBAL public-record rows (organization_id NULL).
            isNull(parcelSnapshots.organizationId),
            eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE),
            eq(parcelSnapshots.state, job.state),
            eq(parcelSnapshots.county, job.county),
            sql`${lng} BETWEEN ${b[0]} AND ${b[2]}`,
            sql`${lat} BETWEEN ${b[1]} AND ${b[3]}`,
          ),
        );
      return rows
        .filter((r) => r.parcelKey && r.centroid && r.boundary)
        .map((r) => ({
          parcelKey: r.parcelKey!,
          sourceId: r.sourceId,
          centroid: [r.centroid!.lng, r.centroid!.lat] as [number, number],
          areaSqM: areaSqM(r.boundary as AreaGeometry),
        }));
    },
    async save(parcels) {
      const now = clock.now();
      for (const p of parcels) {
        const [existing] = await db
          .select({ id: parcelSnapshots.id, rawData: parcelSnapshots.rawData })
          .from(parcelSnapshots)
          .where(and(isNull(parcelSnapshots.organizationId), eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE), eq(parcelSnapshots.parcelKey, p.parcelKey)))
          .limit(1);
        const prevHistory = Array.isArray(existing?.rawData?.sourceIdHistory) ? (existing!.rawData!.sourceIdHistory as string[]) : [];
        const history = Array.from(new Set([...prevHistory, p.sourceParcelId.toUpperCase()]));
        const values = {
          organizationId: null,
          apn: p.sourceParcelId.toUpperCase(),
          state: job.state,
          county: job.county,
          source: OWNED_SNAPSHOT_SOURCE,
          sourceId: p.sourceParcelId,
          boundary: p.geometry,
          centroid: { lng: p.centroid[0], lat: p.centroid[1] },
          acres: String(p.gisAcres),
          rawData: {
            sourceName: ep.licenseSource ?? `County GIS endpoint #${ep.id}`,
            sourceUrl: layerUrl,
            deededAcres: p.deededAcres,
            attributes: p.attributes,
            sourceIdHistory: history,
          },
          parcelKey: p.parcelKey,
          facts: p.facts as unknown as Record<string, unknown>,
          factsComputedAt: now,
          fetchedAt: now,
          expiresAt: null,
          updatedAt: now,
        };
        if (existing) {
          await db
            .update(parcelSnapshots)
            .set(values)
            .where(and(eq(parcelSnapshots.id, existing.id), isNull(parcelSnapshots.organizationId)));
        }
        else await db.insert(parcelSnapshots).values(values);
      }
    },
  };
  return { deps, fields };
}

/**
 * One worker tick: take the highest-demand pending/processing county, re-check
 * the decision (terms can change), and process up to MAX_PAGES_PER_TICK pages.
 */
export async function runCountyPipelineTick(): Promise<{ county: string | null; stored: number; outcome: string }> {
  const [job] = await db
    .select(JOB_COLUMNS)
    .from(countyDiscoveryQueue)
    .where(inArray(countyDiscoveryQueue.ownedStatus, ["pending", "processing"]))
    .orderBy(desc(countyDiscoveryQueue.ownedDemand))
    .limit(1);
  if (!job) return { county: null, stored: 0, outcome: "idle" };
  const setJob = (v: Partial<typeof countyDiscoveryQueue.$inferInsert>) =>
    db.update(countyDiscoveryQueue).set({ ...v, updatedAt: clock.now() }).where(eq(countyDiscoveryQueue.id, job.id));

  const decision = decideCountyProcessing(job.state, job.county, await endpointViews(job.state));
  if (decision.action === "refuse") {
    await setJob({ ownedStatus: "refused", ownedRefusalReason: decision.reason });
    return { county: job.county, stored: 0, outcome: `refused:${decision.code}` };
  }

  const retrievedOn = clock.now().toISOString().slice(0, 10);
  let stored = 0;
  let offset = job.ownedNextOffset;
  try {
    await setJob({ ownedStatus: "processing", ownedStartedAt: job.ownedStartedAt ?? clock.now(), ownedAttempts: job.ownedAttempts + 1 });
    const { deps, fields } = await liveDeps(job, decision.endpoint, decision.countyWhere, retrievedOn);
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const r = await processCountyPage({ state: job.state, county: job.county, countyFips: null, nextOffset: offset }, fields, deps);
      stored += r.stored;
      offset = r.lastObjectId;
      await db
        .update(countyDiscoveryQueue)
        .set({ ownedNextOffset: offset, ownedParcelsStored: sql`${countyDiscoveryQueue.ownedParcelsStored} + ${r.stored}`, updatedAt: clock.now() })
        .where(eq(countyDiscoveryQueue.id, job.id));
      if (r.done) {
        await setJob({ ownedStatus: "complete", ownedCompletedAt: clock.now() });
        return { county: job.county, stored, outcome: "complete" };
      }
    }
    return { county: job.county, stored, outcome: "partial" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setJob({ ownedStatus: job.ownedAttempts + 1 >= 5 ? "failed" : "processing", ownedLastError: message.slice(0, 500) });
    logger.warn("[countyPipeline] tick failed", { metadata: { county: job.county, state: job.state, error: message } });
    return { county: job.county, stored, outcome: "error" };
  }
}
