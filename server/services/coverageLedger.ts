/**
 * County coverage ledger + demand-driven discovery-on-miss.
 *
 * Closes the binary coverage gap (~34 seeded counties → a parcel outside them
 * returns nothing) for $0, along real customer demand:
 *
 *   - enqueueCountyForDiscovery(): on a parcel-lookup miss for an unseeded
 *     county (or an explicit customer "request this county" CTA), upsert a
 *     county_discovery_queue row, bumping demand_count so the crawler chases
 *     the counties customers are actually in — not alphabetically.
 *
 *   - getCoverageLedger(): left-joins the distinct (state, county) our
 *     customers touch (properties + parcel_snapshots) against
 *     county_gis_endpoints → coverage % + a demand-ranked discovery queue.
 *     Surfaced on a founder data surface.
 *
 *   - runDiscoveryQueueDrain(): drains the queue in demand+priority order.
 *     For each county it runs ArcGIS discovery, probes a candidate /query
 *     endpoint for an APN-shaped feature, auto-populates apn/owner/field
 *     mappings, and inserts the county_gis_endpoints row as isActive=false +
 *     redistributable='review-required' (Beatrice rule: un-reviewed counties
 *     are live-passthrough only). It flips isActive=true ONLY after the
 *     endpoint returns a real feature for a test APN. Demand-driven coverage
 *     growth costs $0 and compounds — every miss makes the next lookup hit.
 */

import { db } from "../db";
import { dbForReads } from "../db-replica";
import {
  countyDiscoveryQueue,
  countyGisEndpoints,
  countyCoverageRequests,
  properties,
  parcelSnapshots,
} from "@shared/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import { logger } from "../utils/logger";
import {
  validateEndpoint,
  extractEndpointInfo,
  searchArcGISOnline,
  type ArcGISSearchItem,
} from "./arcgis-discovery";
import { checkOperatorUrl } from "./providers/ssrf-guard";

// ── Normalization (shared with parcel.ts lookup path) ───────────────────────

export function normalizeState(state: string): string {
  return (state || "").trim().toUpperCase();
}

export function normalizeCounty(county: string): string {
  return (county || "")
    .toLowerCase()
    .replace(/ county$/i, "")
    .replace(/-/g, " ")
    .trim();
}

// ── 1. Demand-driven enqueue ────────────────────────────────────────────────

export interface EnqueueResult {
  queued: boolean; // true if a new row was created
  bumped: boolean; // true if an existing pending row had its demand bumped
  alreadyCovered: boolean; // true if an active endpoint already exists (no-op)
  queueId: number | null;
  status: string | null;
  demandCount: number | null;
}

/**
 * Enqueue a (state, county) for background discovery. Idempotent: if a row
 * already exists, bump its demand_count (and lift priority/requester for
 * customer-driven requests). No-op if an active endpoint already covers the
 * county. Safe to call fire-and-forget from the parcel-lookup miss path.
 */
export async function enqueueCountyForDiscovery(
  rawState: string,
  rawCounty: string,
  opts: { organizationId?: number; priorityBoost?: number } = {},
): Promise<EnqueueResult> {
  const state = normalizeState(rawState);
  const county = normalizeCounty(rawCounty);

  const empty: EnqueueResult = {
    queued: false,
    bumped: false,
    alreadyCovered: false,
    queueId: null,
    status: null,
    demandCount: null,
  };

  if (!state || !county) return empty;

  // Already covered by an active endpoint? Nothing to discover.
  const active = await db
    .select({ id: countyGisEndpoints.id })
    .from(countyGisEndpoints)
    .where(
      and(
        eq(countyGisEndpoints.state, state),
        sql`lower(regexp_replace(${countyGisEndpoints.county}, ' county$', '', 'i')) = ${county}`,
        eq(countyGisEndpoints.isActive, true),
      ),
    )
    .limit(1);

  if (active.length > 0) {
    return { ...empty, alreadyCovered: true };
  }

  const priorityBoost = opts.priorityBoost ?? 0;

  // Upsert: one queue row per (state, county); bump demand on conflict.
  // Reset a terminal/exhausted row back to pending when fresh demand arrives.
  const inserted = await db
    .insert(countyDiscoveryQueue)
    .values({
      state,
      county,
      demandCount: 1,
      priority: priorityBoost,
      firstRequestedBy: opts.organizationId ?? null,
      status: "pending",
    })
    .onConflictDoUpdate({
      target: [countyDiscoveryQueue.state, countyDiscoveryQueue.county],
      set: {
        demandCount: sql`${countyDiscoveryQueue.demandCount} + 1`,
        priority: sql`GREATEST(${countyDiscoveryQueue.priority}, ${priorityBoost})`,
        // Re-open exhausted/failed rows when new demand arrives so a county
        // that briefly had no public endpoint gets re-tried later.
        status: sql`CASE WHEN ${countyDiscoveryQueue.status} = 'exhausted' THEN 'pending' ELSE ${countyDiscoveryQueue.status} END`,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: countyDiscoveryQueue.id,
      status: countyDiscoveryQueue.status,
      demandCount: countyDiscoveryQueue.demandCount,
    });

  const row = inserted[0];
  if (!row) return empty;

  return {
    queued: row.demandCount === 1,
    bumped: row.demandCount > 1,
    alreadyCovered: false,
    queueId: row.id,
    status: row.status,
    demandCount: row.demandCount,
  };
}

// ── 2. Coverage ledger ──────────────────────────────────────────────────────

export interface CoverageLedgerCounty {
  state: string;
  county: string;
  demandCount: number; // # of distinct customer touches (properties + snapshots)
  covered: boolean; // active endpoint exists
  endpointStatus: "active" | "pending-review" | "discovering" | "none";
  redistributable: string | null; // license posture of the covering endpoint, if any
  queueStatus: string | null; // discovery queue lifecycle, if queued
}

export interface CoverageLedger {
  totalCounties: number;
  coveredCounties: number;
  coveragePct: number; // 0–100, rounded
  counties: CoverageLedgerCounty[]; // demand-ranked desc
  discoveryQueue: CoverageLedgerCounty[]; // uncovered, demand-ranked — the crawl order
}

/**
 * Build the coverage ledger: the distinct (state, county) our customers
 * actually touch, left-joined against active county_gis_endpoints. Output is
 * demand-ranked so the founder surface and the discovery job both crawl the
 * counties customers are in, not alphabetically.
 */
export async function getCoverageLedger(): Promise<CoverageLedger> {
  const reader = await dbForReads("coverage-ledger");

  // Distinct (state, county) demand from real customer data. properties has
  // notNull state+county; parcel_snapshots is the lookup cache. We normalize
  // and aggregate so a county touched via either source counts as demand.
  const demandRows = await reader.execute(sql`
    WITH demand AS (
      SELECT upper(trim(${properties.state})) AS state,
             lower(regexp_replace(regexp_replace(trim(${properties.county}), ' county$', '', 'i'), '-', ' ', 'g')) AS county
      FROM ${properties}
      WHERE ${properties.state} IS NOT NULL AND ${properties.county} IS NOT NULL
      UNION ALL
      SELECT upper(trim(${parcelSnapshots.state})) AS state,
             lower(regexp_replace(regexp_replace(trim(${parcelSnapshots.county}), ' county$', '', 'i'), '-', ' ', 'g')) AS county
      FROM ${parcelSnapshots}
      WHERE ${parcelSnapshots.state} IS NOT NULL AND ${parcelSnapshots.county} IS NOT NULL
    )
    SELECT state, county, COUNT(*)::int AS demand
    FROM demand
    WHERE state <> '' AND county <> ''
    GROUP BY state, county
  `);

  const demand = (((demandRows as any)?.rows ?? demandRows) as Array<{
    state: string;
    county: string;
    demand: number;
  }>) ?? [];

  // All endpoints (active + pending) keyed by normalized (state, county).
  const endpoints = await reader
    .select({
      state: countyGisEndpoints.state,
      county: countyGisEndpoints.county,
      isActive: countyGisEndpoints.isActive,
      redistributable: countyGisEndpoints.redistributable,
    })
    .from(countyGisEndpoints);

  const endpointMap = new Map<
    string,
    { active: boolean; redistributable: string | null }
  >();
  for (const e of endpoints) {
    const key = `${normalizeState(e.state)}|${normalizeCounty(e.county)}`;
    const prev = endpointMap.get(key);
    endpointMap.set(key, {
      active: (prev?.active ?? false) || !!e.isActive,
      redistributable: e.redistributable ?? prev?.redistributable ?? null,
    });
  }

  // Queue status keyed by normalized (state, county).
  const queueRows = await reader
    .select({
      state: countyDiscoveryQueue.state,
      county: countyDiscoveryQueue.county,
      status: countyDiscoveryQueue.status,
    })
    .from(countyDiscoveryQueue);
  const queueMap = new Map<string, string>();
  for (const q of queueRows) {
    queueMap.set(`${normalizeState(q.state)}|${normalizeCounty(q.county)}`, q.status);
  }

  const counties: CoverageLedgerCounty[] = demand.map((d) => {
    const key = `${d.state}|${d.county}`;
    const ep = endpointMap.get(key);
    const queueStatus = queueMap.get(key) ?? null;

    let endpointStatus: CoverageLedgerCounty["endpointStatus"] = "none";
    if (ep?.active) endpointStatus = "active";
    else if (ep) endpointStatus = "pending-review";
    else if (queueStatus === "pending" || queueStatus === "in_progress")
      endpointStatus = "discovering";

    return {
      state: d.state,
      county: d.county,
      demandCount: d.demand,
      covered: !!ep?.active,
      endpointStatus,
      redistributable: ep?.redistributable ?? null,
      queueStatus,
    };
  });

  counties.sort((a, b) => b.demandCount - a.demandCount);

  const totalCounties = counties.length;
  const coveredCounties = counties.filter((c) => c.covered).length;
  const coveragePct =
    totalCounties === 0 ? 0 : Math.round((coveredCounties / totalCounties) * 100);

  return {
    totalCounties,
    coveredCounties,
    coveragePct,
    counties,
    discoveryQueue: counties.filter((c) => !c.covered),
  };
}

// ── 3. Discovery-on-miss queue drain ────────────────────────────────────────

/**
 * The ArcGIS probe seam — injected so tests can mock the network entirely.
 * Returns the candidate endpoints found for a (state, county) and validates a
 * given URL. In production these delegate to arcgis-discovery.ts.
 */
export interface ArcGisProbe {
  /** Find candidate parcel endpoints for a (state, county). */
  findCandidates(
    state: string,
    county: string,
  ): Promise<
    Array<{
      baseUrl: string;
      county: string;
      state: string;
      confidenceScore: number;
      endpointType: string;
      discoverySource: string;
    }>
  >;
  /** Validate a candidate URL returns parcel-shaped data + its fields. */
  validate(url: string): Promise<{
    valid: boolean;
    hasParcelData?: boolean;
    parcelLayerId?: number;
    parcelFields?: string[];
    message: string;
  }>;
  /** Probe the endpoint for a real feature using the mapped APN field. */
  probeFeature(
    baseUrl: string,
    layerId: string,
    apnField: string,
  ): Promise<{ returnedFeature: boolean; sampleApn?: string }>;
}

const APN_FIELD_NAMES = [
  "apn",
  "parcel_id",
  "parcelid",
  "pin",
  "parcel_number",
  "parcelnumber",
  "parcel_no",
  "prop_id",
];
const OWNER_FIELD_NAMES = ["owner", "ownername", "owner_name", "owner1", "ownnam"];

function pickField(fields: string[], candidates: string[], fallback: string): string {
  return (
    fields.find((f) => candidates.some((n) => f.toLowerCase().includes(n))) ?? fallback
  );
}

/** Production ArcGIS probe — real network calls via arcgis-discovery.ts. */
export const liveArcGisProbe: ArcGisProbe = {
  async findCandidates(state, county) {
    // Targeted search for this state, then keep only items whose extracted
    // location matches the county we want.
    const items: ArcGISSearchItem[] = await searchArcGISOnline(undefined, {
      maxResults: 60,
      targetStates: [state],
    });
    const out: Array<{
      baseUrl: string;
      county: string;
      state: string;
      confidenceScore: number;
      endpointType: string;
      discoverySource: string;
    }> = [];
    const wantCounty = normalizeCounty(county);
    for (const item of items) {
      const info = extractEndpointInfo(item);
      if (!info) continue;
      if (normalizeState(info.state) !== normalizeState(state)) continue;
      if (normalizeCounty(info.county) !== wantCounty) continue;
      out.push({
        baseUrl: info.baseUrl,
        county: info.county,
        state: info.state,
        confidenceScore: info.confidenceScore,
        endpointType: info.endpointType,
        discoverySource: info.discoverySource,
      });
    }
    // Best confidence first.
    out.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return out;
  },
  async validate(url) {
    return validateEndpoint(url);
  },
  async probeFeature(baseUrl, layerId, apnField) {
    // Pull a single real feature and confirm the APN field resolves on it.
    try {
      const clean = baseUrl.replace(/\/$/, "");
      const url = `${clean}/${layerId}/query?where=1=1&outFields=${encodeURIComponent(
        apnField,
      )}&resultRecordCount=1&f=json`;
      const { fetchGeo } = await import("./providers/fetchGeo");
      const res = await fetchGeo(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return { returnedFeature: false };
      const data = (await res.json()) as {
        features?: Array<{ attributes?: Record<string, unknown> }>;
      };
      const feat = data.features?.[0];
      if (!feat?.attributes) return { returnedFeature: false };
      const sampleApn = feat.attributes[apnField];
      return {
        returnedFeature: sampleApn !== undefined && sampleApn !== null,
        sampleApn: sampleApn != null ? String(sampleApn) : undefined,
      };
    } catch {
      return { returnedFeature: false };
    }
  },
};

export interface DiscoverOneResult {
  state: string;
  county: string;
  outcome: "activated" | "review-pending" | "no-candidate" | "exhausted" | "error";
  endpointId?: number;
  message: string;
}

/**
 * Attempt discovery for a single queued county. Inserts a county_gis_endpoints
 * row as isActive=false + redistributable='review-required' once a candidate
 * validates, and flips isActive=true ONLY after probeFeature confirms a real
 * feature for the mapped APN field. Updates the queue row's lifecycle.
 *
 * The probe is injected (defaults to liveArcGisProbe) so tests mock the network.
 */
export async function discoverCountyEndpoint(
  queueRow: {
    id: number;
    state: string;
    county: string;
    attempts: number;
    maxAttempts: number;
  },
  probe: ArcGisProbe = liveArcGisProbe,
): Promise<DiscoverOneResult> {
  const state = normalizeState(queueRow.state);
  const county = normalizeCounty(queueRow.county);
  const attempts = queueRow.attempts + 1;

  const fail = async (
    outcome: DiscoverOneResult["outcome"],
    message: string,
  ): Promise<DiscoverOneResult> => {
    const terminal = attempts >= queueRow.maxAttempts;
    await db
      .update(countyDiscoveryQueue)
      .set({
        status: terminal ? "exhausted" : outcome === "no-candidate" ? "failed" : "pending",
        attempts,
        lastAttemptAt: new Date(),
        lastResult: message,
        updatedAt: new Date(),
      })
      .where(eq(countyDiscoveryQueue.id, queueRow.id));
    return { state, county, outcome: terminal ? "exhausted" : outcome, message };
  };

  try {
    const candidates = await probe.findCandidates(state, county);
    if (candidates.length === 0) {
      return fail("no-candidate", "No ArcGIS candidate endpoint found");
    }

    for (const candidate of candidates) {
      // SSRF guard: auto-discovered URLs are fetched server-side.
      if (!checkOperatorUrl(candidate.baseUrl).ok) continue;

      const validation = await probe.validate(candidate.baseUrl);
      if (!validation.valid || !validation.hasParcelData) continue;

      const fields = validation.parcelFields ?? [];
      const apnField = pickField(fields, APN_FIELD_NAMES, "APN");
      const ownerField = pickField(fields, OWNER_FIELD_NAMES, "OWNER");
      const layerId = String(validation.parcelLayerId ?? 0);

      // De-dupe: don't insert a second row for the same (state, county, url).
      const existing = await db
        .select({ id: countyGisEndpoints.id, isActive: countyGisEndpoints.isActive })
        .from(countyGisEndpoints)
        .where(
          and(
            eq(countyGisEndpoints.state, candidate.state),
            eq(countyGisEndpoints.county, candidate.county),
            eq(countyGisEndpoints.baseUrl, candidate.baseUrl),
          ),
        )
        .limit(1);

      let endpointId: number;
      if (existing.length > 0) {
        endpointId = existing[0].id;
      } else {
        // Insert pending: isActive=false until a real feature proves it.
        // redistributable stays 'review-required' (Beatrice rule) — we never
        // auto-mark a freshly-discovered county fully redistributable.
        const ins = await db
          .insert(countyGisEndpoints)
          .values({
            state: candidate.state,
            county: candidate.county,
            endpointType: candidate.endpointType,
            baseUrl: candidate.baseUrl,
            layerId,
            apnField,
            ownerField,
            geometryField: "geometry",
            fieldMappings: { apn: apnField, owner: ownerField },
            isVerified: false,
            isActive: false,
            redistributable: "review-required",
            errorCount: 0,
            sourceUrl: `arcgis-online:${candidate.discoverySource}`,
            notes: `discovery-on-miss ${new Date()
              .toISOString()
              .slice(0, 10)} — confidence ${candidate.confidenceScore.toFixed(
              0,
            )} — ${validation.message} — PENDING feature probe`,
            contributedBy: "discovery-on-miss",
          })
          .returning({ id: countyGisEndpoints.id });
        endpointId = ins[0].id;
      }

      // Confidence gate: flip active ONLY after a real feature comes back.
      const featureProbe = await probe.probeFeature(candidate.baseUrl, layerId, apnField);
      if (featureProbe.returnedFeature) {
        await db
          .update(countyGisEndpoints)
          .set({
            isActive: true,
            isVerified: true,
            lastVerified: new Date(),
            errorCount: 0,
            notes: `discovery-on-miss ${new Date()
              .toISOString()
              .slice(0, 10)} — ACTIVE (feature probe ok${
              featureProbe.sampleApn ? `, sample APN ${featureProbe.sampleApn}` : ""
            }) — redistributable=review-required pending license review`,
          })
          .where(eq(countyGisEndpoints.id, endpointId));

        await db
          .update(countyDiscoveryQueue)
          .set({
            status: "resolved",
            attempts,
            lastAttemptAt: new Date(),
            lastResult: `activated endpoint ${endpointId}`,
            resolvedEndpointId: endpointId,
            updatedAt: new Date(),
          })
          .where(eq(countyDiscoveryQueue.id, queueRow.id));

        // Mark any open per-org coverage requests for this county as covered.
        await db
          .update(countyCoverageRequests)
          .set({ status: "covered", updatedAt: new Date() })
          .where(
            and(
              eq(countyCoverageRequests.queueId, queueRow.id),
              eq(countyCoverageRequests.status, "pending"),
            ),
          );

        return {
          state,
          county,
          outcome: "activated",
          endpointId,
          message: `Activated ${candidate.baseUrl}`,
        };
      }

      // Validated but no live feature yet — leave the row pending review and
      // record the partial progress; try the next candidate if any.
      await db
        .update(countyDiscoveryQueue)
        .set({
          status: "pending",
          attempts,
          lastAttemptAt: new Date(),
          lastResult: `endpoint ${endpointId} inserted, awaiting feature probe`,
          updatedAt: new Date(),
        })
        .where(eq(countyDiscoveryQueue.id, queueRow.id));

      return {
        state,
        county,
        outcome: "review-pending",
        endpointId,
        message: `Inserted ${candidate.baseUrl} as isActive=false (feature probe pending)`,
      };
    }

    return fail("no-candidate", "Candidates found but none validated as parcel data");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[coverage-ledger] discovery error", {
      metadata: { state, county, message },
    });
    return fail("error", message);
  }
}

export interface DrainResult {
  drained: number;
  activated: number;
  reviewPending: number;
  noCandidate: number;
  exhausted: number;
  errors: number;
}

/**
 * Drain up to `limit` pending queue rows in demand+priority order. Called by
 * the scheduled worker job. Demand-weighted so we crawl the counties
 * customers are actually in.
 */
export async function runDiscoveryQueueDrain(
  limit = 5,
  probe: ArcGisProbe = liveArcGisProbe,
): Promise<DrainResult> {
  const result: DrainResult = {
    drained: 0,
    activated: 0,
    reviewPending: 0,
    noCandidate: 0,
    exhausted: 0,
    errors: 0,
  };

  const rows = await db
    .select({
      id: countyDiscoveryQueue.id,
      state: countyDiscoveryQueue.state,
      county: countyDiscoveryQueue.county,
      attempts: countyDiscoveryQueue.attempts,
      maxAttempts: countyDiscoveryQueue.maxAttempts,
    })
    .from(countyDiscoveryQueue)
    .where(
      sql`${countyDiscoveryQueue.status} IN ('pending', 'failed') AND ${countyDiscoveryQueue.attempts} < ${countyDiscoveryQueue.maxAttempts}`,
    )
    .orderBy(
      desc(countyDiscoveryQueue.priority),
      desc(countyDiscoveryQueue.demandCount),
    )
    .limit(limit);

  for (const row of rows) {
    result.drained += 1;
    const r = await discoverCountyEndpoint(row, probe);
    switch (r.outcome) {
      case "activated":
        result.activated += 1;
        break;
      case "review-pending":
        result.reviewPending += 1;
        break;
      case "no-candidate":
        result.noCandidate += 1;
        break;
      case "exhausted":
        result.exhausted += 1;
        break;
      case "error":
        result.errors += 1;
        break;
    }
  }

  return result;
}
