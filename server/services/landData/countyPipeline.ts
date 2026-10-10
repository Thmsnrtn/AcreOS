/**
 * On-demand county pipeline (W2 task 1), run on the existing worker.
 *
 * The first customer search in a county creates a county_parcel_jobs row.
 * The worker drains ONE county at a time (the 1 GB machine's safety margin):
 * it pages the county's free source through fetchGeo, normalizes each parcel,
 * assigns a stable parcel_key through the crosswalk, computes the derived
 * facts for the page's neighbourhood, and stores everything in owned_parcels —
 * kept, not re-fetched per lookup.
 *
 * Refusal is a first-class outcome, decided BEFORE a byte is fetched:
 *   - no free source for the county         → refused; the miss is recorded
 *     as a "request this county" demand signal (county_discovery_queue);
 *   - a source exists but is pending review  → refused until a human reviews;
 *   - the source's terms forbid storing      → refused; live lookups only.
 * The reason is stored on the row and shown to the customer verbatim.
 */

import { and, desc, eq, sql, gte, lte, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  countyGisEndpoints,
  countyParcelJobs,
  ownedParcels,
  parcelIdCrosswalk,
  type CountyParcelJob,
} from "@shared/schema";
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
export const MAX_PAGES_PER_TICK = 8;

/**
 * Statewide layers carry many counties; storing one county needs a VERIFIED
 * county field. Only fields read from the live layer metadata appear here.
 */
export const STATEWIDE_COUNTY_FIELD: Record<string, string> = { TN: "COUNTY_NAME" };

/** Register keys of the statewide parcel services (see data-licenses.ts). */
export const STATEWIDE_LICENSE_SOURCE: Record<string, string> = { TN: "TN Property Boundaries Public Use service" };

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
  const [row] = await db
    .insert(countyParcelJobs)
    .values({
      state: st,
      county: c,
      status: refused ? "refused" : "pending",
      refusalReason: refused ? decision.reason : null,
      sourceEndpointId: refused ? null : decision.endpoint.id,
      sourceUrl: refused ? null : decision.endpoint.baseUrl,
    })
    .onConflictDoUpdate({
      target: [countyParcelJobs.state, countyParcelJobs.county],
      set: {
        demandCount: sql`${countyParcelJobs.demandCount} + 1`,
        // A refused county is re-decided on fresh demand (a source may have
        // been reviewed since); a complete or running one is left alone.
        status: sql`CASE WHEN ${countyParcelJobs.status} = 'refused' THEN ${refused ? "refused" : "pending"} ELSE ${countyParcelJobs.status} END`,
        refusalReason: sql`CASE WHEN ${countyParcelJobs.status} = 'refused' THEN ${refused ? decision.reason : null} ELSE ${countyParcelJobs.refusalReason} END`,
        updatedAt: clock.now(),
      },
    })
    .returning({ status: countyParcelJobs.status, refusalReason: countyParcelJobs.refusalReason, demandCount: countyParcelJobs.demandCount });

  if (refused && decision.code === "no_free_source") {
    const { enqueueCountyForDiscovery } = await import("../coverageLedger");
    await enqueueCountyForDiscovery(st, c).catch((err) =>
      logger.warn("[countyPipeline] discovery demand signal failed", {
        metadata: { state: st, county: c, error: err instanceof Error ? err.message : String(err) },
      }),
    );
  }
  return { status: row?.status ?? "unknown", refusalReason: row?.refusalReason ?? null, demandCount: row?.demandCount ?? 0 };
}

export async function getCountyJob(state: string, county: string): Promise<CountyParcelJob | null> {
  const [row] = await db
    .select()
    .from(countyParcelJobs)
    .where(and(eq(countyParcelJobs.state, state.toUpperCase()), eq(countyParcelJobs.county, normalizeCountyName(county))))
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
      how: a.how,
    };
  });
  await deps.save(out);
  return { stored: out.length, lastObjectId: Math.max(...feats.map((f) => f.objectId)), done: feats.length < PAGE_SIZE };
}

// ── Live deps ──────────────────────────────────────────────────────────────

async function liveDeps(job: CountyParcelJob, ep: EndpointView, countyWhere: string | null, retrievedOn: string): Promise<{ deps: PageDeps; fields: FieldMap }> {
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
      const body = (await res.json()) as { features?: Array<{ geometry: any; properties: Record<string, unknown> }>; error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? "ArcGIS error");
      return (body.features ?? [])
        .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
        .map((f) => ({ objectId: Number(f.properties[oid]), geometry: f.geometry as AreaGeometry, attributes: f.properties }));
    },
    loadContext: (bbox) =>
      loadParcelContext(bbox, retrievedOn, {
        onLayerError: (layer, err) =>
          logger.warn("[countyPipeline] context layer unavailable", {
            metadata: { layer, county: job.county, error: err instanceof Error ? err.message : String(err) },
          }),
      }),
    async existingNear(b) {
      const rows = await db
        .select({
          parcelKey: ownedParcels.parcelKey,
          sourceId: ownedParcels.sourceParcelId,
          lng: ownedParcels.centroidLng,
          lat: ownedParcels.centroidLat,
          geometry: ownedParcels.geometry,
        })
        .from(ownedParcels)
        .where(
          and(
            eq(ownedParcels.state, job.state),
            eq(ownedParcels.county, job.county),
            gte(ownedParcels.centroidLng, b[0]),
            lte(ownedParcels.centroidLng, b[2]),
            gte(ownedParcels.centroidLat, b[1]),
            lte(ownedParcels.centroidLat, b[3]),
          ),
        );
      return rows.map((r) => ({
        parcelKey: r.parcelKey,
        sourceId: r.sourceId,
        centroid: [r.lng, r.lat] as [number, number],
        areaSqM: areaSqM(r.geometry as AreaGeometry),
      }));
    },
    async save(parcels) {
      const now = clock.now();
      for (const p of parcels) {
        const values = {
          parcelKey: p.parcelKey,
          state: job.state,
          county: job.county,
          sourceParcelId: p.sourceParcelId,
          sourceName: ep.licenseSource ?? `County GIS endpoint #${ep.id}`,
          sourceUrl: layerUrl,
          retrievedAt: now,
          geometry: p.geometry,
          centroidLng: p.centroid[0],
          centroidLat: p.centroid[1],
          gisAcres: p.gisAcres,
          deededAcres: p.deededAcres,
          facts: p.facts,
          factsComputedAt: now,
          updatedAt: now,
        };
        await db.insert(ownedParcels).values(values).onConflictDoUpdate({ target: ownedParcels.parcelKey, set: values });
        await db
          .insert(parcelIdCrosswalk)
          .values({ parcelKey: p.parcelKey, state: job.state, county: job.county, sourceParcelId: p.sourceParcelId, firstSeenAt: now, lastSeenAt: now })
          .onConflictDoUpdate({
            target: [parcelIdCrosswalk.state, parcelIdCrosswalk.county, parcelIdCrosswalk.sourceParcelId, parcelIdCrosswalk.parcelKey],
            set: { lastSeenAt: now },
          });
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
    .select()
    .from(countyParcelJobs)
    .where(inArray(countyParcelJobs.status, ["pending", "processing"]))
    .orderBy(desc(countyParcelJobs.demandCount))
    .limit(1);
  if (!job) return { county: null, stored: 0, outcome: "idle" };

  const decision = decideCountyProcessing(job.state, job.county, await endpointViews(job.state));
  if (decision.action === "refuse") {
    await db
      .update(countyParcelJobs)
      .set({ status: "refused", refusalReason: decision.reason, updatedAt: clock.now() })
      .where(eq(countyParcelJobs.id, job.id));
    return { county: job.county, stored: 0, outcome: `refused:${decision.code}` };
  }

  const retrievedOn = clock.now().toISOString().slice(0, 10);
  let stored = 0;
  let offset = job.nextOffset;
  try {
    await db
      .update(countyParcelJobs)
      .set({ status: "processing", startedAt: job.startedAt ?? clock.now(), attempts: job.attempts + 1, updatedAt: clock.now() })
      .where(eq(countyParcelJobs.id, job.id));
    const { deps, fields } = await liveDeps(job, decision.endpoint, decision.countyWhere, retrievedOn);
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const r = await processCountyPage({ state: job.state, county: job.county, countyFips: null, nextOffset: offset }, fields, deps);
      stored += r.stored;
      offset = r.lastObjectId;
      await db
        .update(countyParcelJobs)
        .set({ nextOffset: offset, parcelsStored: sql`${countyParcelJobs.parcelsStored} + ${r.stored}`, updatedAt: clock.now() })
        .where(eq(countyParcelJobs.id, job.id));
      if (r.done) {
        await db
          .update(countyParcelJobs)
          .set({ status: "complete", completedAt: clock.now(), updatedAt: clock.now() })
          .where(eq(countyParcelJobs.id, job.id));
        return { county: job.county, stored, outcome: "complete" };
      }
    }
    return { county: job.county, stored, outcome: "partial" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(countyParcelJobs)
      .set({ status: job.attempts + 1 >= 5 ? "failed" : "processing", lastError: message.slice(0, 500), updatedAt: clock.now() })
      .where(eq(countyParcelJobs.id, job.id));
    logger.warn("[countyPipeline] tick failed", { metadata: { county: job.county, state: job.state, error: message } });
    return { county: job.county, stored, outcome: "error" };
  }
}
