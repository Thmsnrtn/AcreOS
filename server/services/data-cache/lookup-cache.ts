/**
 * Pillar 6 — Data Cross-Customer Cache
 *
 * The second customer who looks up the same physical fact (same parcel,
 * same owner, same flood zone) pays $0 and reads from cache. The first
 * customer paid full price; we record the saving so we can show the
 * cross-customer flywheel back to the customer ("you saved $84 this month
 * via shared data cache") and to the founder ("hit rate 41% over 7 days").
 *
 * Architecture:
 *   - cached_lookups: keyed by (provider, entityType, queryFingerprint)
 *     UNIQUE. Holds the original response + costCents the FIRST caller paid.
 *   - cached_lookup_hits: append-only log of cache-served reads, one row
 *     per read (counter; not deduped per-org so analytics stay honest).
 *
 * The cache wraps a `fetchFn` rather than baking provider details in here,
 * so any provider can adopt the pattern with a few lines of glue.
 */

import crypto from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import { cachedLookups, cachedLookupHits } from "@shared/schema";
import { logger } from "../../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
// TTL policy. Tuned per entity type — parcel polygons are effectively static
// (refresh once a year), AVMs move every 30 days, skip-trace contacts go stale
// at ~90 days. Mirrors the Pillar 6 table in the approved overhead-reduction
// plan.
// ─────────────────────────────────────────────────────────────────────────────

export const TTL_BY_ENTITY_TYPE: Record<string, number> = {
  skip_trace: 2160,        // 90 days
  parcel_ownership: 4320,  // 180 days
  parcel_polygon: 8760,    // 365 days
  avm: 720,                // 30 days
  flood_zone: 8760,        // 365 days
  liens: 720,              // 30 days
  usda: 8760,              // 365 days
  census: 8760,            // 365 days
  wetlands: 8760,          // 365 days
};

const DEFAULT_FRESHNESS_HOURS = 720; // 30 days

export function defaultFreshnessHours(entityType: string): number {
  return TTL_BY_ENTITY_TYPE[entityType] ?? DEFAULT_FRESHNESS_HOURS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query normalization. The fingerprint MUST be deterministic across callers
// for the cache to share rows — same parcel typed two different ways must
// collapse. We sort keys, lowercase + trim string values, and SHA-256 the
// resulting JSON.
// ─────────────────────────────────────────────────────────────────────────────

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) {
      const v = canonicalize(obj[key]);
      if (v === null || v === "") continue; // drop empty values from the fingerprint
      out[key] = v;
    }
    return out;
  }
  return String(value);
}

export function normalizeQuery(query: unknown): string {
  const canon = canonicalize(query);
  const json = JSON.stringify(canon);
  return crypto.createHash("sha256").update(json).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// getCachedOrFetch — the only function callers need.
// ─────────────────────────────────────────────────────────────────────────────

export interface GetCachedOrFetchOpts<T> {
  provider: string;
  entityType: string;
  queryFingerprint: string;
  freshnessHours?: number;
  organizationId: number;
  fetchFn: () => Promise<{ result: T; costCents: number }>;
}

export interface GetCachedOrFetchResult<T> {
  result: T;
  fromCache: boolean;
  costCentsCharged: number;
  /** Cost the original fetch paid; surfaces savings on cache hits. */
  originalCostCents: number;
  cachedLookupId: number;
}

/**
 * Returns a cached result if one exists and is still fresh; otherwise calls
 * fetchFn and stores the result for the next caller.
 *
 * costCentsCharged is 0 on a cache HIT (the customer pays nothing for the
 * provider call) and equal to fetchFn().costCents on a MISS. Credit
 * weighting / billing happens upstream (Pillar 4) — this module only signals
 * whether the provider was actually billed.
 */
export async function getCachedOrFetch<T>(
  opts: GetCachedOrFetchOpts<T>,
): Promise<GetCachedOrFetchResult<T>> {
  const freshnessHours = opts.freshnessHours ?? defaultFreshnessHours(opts.entityType);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - freshnessHours * 60 * 60 * 1000);

  // Look up existing row.
  const [existing] = await db
    .select()
    .from(cachedLookups)
    .where(and(
      eq(cachedLookups.provider, opts.provider),
      eq(cachedLookups.entityType, opts.entityType),
      eq(cachedLookups.queryFingerprint, opts.queryFingerprint),
    ))
    .limit(1);

  if (existing && existing.firstFetchedAt && existing.firstFetchedAt > staleBefore) {
    // CACHE HIT — fresh.
    try {
      await db.insert(cachedLookupHits).values({
        cachedLookupId: existing.id,
        organizationId: opts.organizationId,
        hitAt: now,
      });
      await db
        .update(cachedLookups)
        .set({
          hits: sql`${cachedLookups.hits} + 1`,
          lastHitAt: now,
          updatedAt: now,
        })
        .where(eq(cachedLookups.id, existing.id));
    } catch (err) {
      logger.warn(`[lookupCache] hit-row insert failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
    return {
      result: existing.resultJson as T,
      fromCache: true,
      costCentsCharged: 0,
      originalCostCents: existing.costCents ?? 0,
      cachedLookupId: existing.id,
    };
  }

  // CACHE MISS or stale — fetch fresh.
  const fetched = await opts.fetchFn();
  const costCents = Math.max(0, Math.round(fetched.costCents ?? 0));

  // Upsert: if a row exists (stale), refresh it; otherwise insert.
  const inserted = await db
    .insert(cachedLookups)
    .values({
      provider: opts.provider,
      entityType: opts.entityType,
      queryFingerprint: opts.queryFingerprint,
      resultJson: fetched.result as any,
      freshnessHours,
      firstFetchedAt: now,
      firstFetchedBy: opts.organizationId,
      hits: 0,
      lastHitAt: null,
      costCents,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [cachedLookups.provider, cachedLookups.entityType, cachedLookups.queryFingerprint],
      set: {
        resultJson: fetched.result as any,
        freshnessHours,
        firstFetchedAt: now,
        firstFetchedBy: opts.organizationId,
        costCents,
        updatedAt: now,
        // Reset hits — this is a fresh fact.
        hits: 0,
        lastHitAt: null,
      },
    })
    .returning({ id: cachedLookups.id });

  const cachedLookupId = inserted[0]?.id ?? existing?.id ?? 0;

  return {
    result: fetched.result,
    fromCache: false,
    costCentsCharged: costCents,
    originalCostCents: costCents,
    cachedLookupId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "You saved $X this month" — sum the costCents of the original lookups
 * whose cached results this org consumed over the period.
 */
export async function getCacheHitSavingsForOrg(
  organizationId: number,
  sinceDays = 30,
): Promise<{ savingsCents: number; hitCount: number }> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      savingsCents: sql<number>`COALESCE(SUM(${cachedLookups.costCents}), 0)::int`,
      hitCount: sql<number>`COUNT(*)::int`,
    })
    .from(cachedLookupHits)
    .innerJoin(cachedLookups, eq(cachedLookupHits.cachedLookupId, cachedLookups.id))
    .where(and(
      eq(cachedLookupHits.organizationId, organizationId),
      gte(cachedLookupHits.hitAt, since),
    ));
  const row = rows[0];
  return {
    savingsCents: Number(row?.savingsCents ?? 0),
    hitCount: Number(row?.hitCount ?? 0),
  };
}

/**
 * Cross-customer cache-hit rate over the period. Numerator: hit rows.
 * Denominator: hit rows + new cachedLookups rows (i.e. misses).
 * Returns 0 when there is no traffic at all.
 */
export async function getCacheHitRate(sinceDays = 7): Promise<{
  hitRate: number;
  hits: number;
  misses: number;
}> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const [hitsRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(cachedLookupHits)
    .where(gte(cachedLookupHits.hitAt, since));
  const [missRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(cachedLookups)
    .where(gte(cachedLookups.firstFetchedAt, since));
  const hits = Number(hitsRow?.count ?? 0);
  const misses = Number(missRow?.count ?? 0);
  const denom = hits + misses;
  return {
    hitRate: denom === 0 ? 0 : hits / denom,
    hits,
    misses,
  };
}
