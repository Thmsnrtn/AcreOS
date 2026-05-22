/**
 * Pillar 8.6 — Postgres Read-Replica Adoption
 *
 * Routes heavy analytical READ queries to the Postgres read replica
 * (`DATABASE_REPLICA_URL`) when one is configured, falling back to the
 * primary otherwise. Single-DB deployments are unchanged — `dbReplica`
 * is null and `dbForReads()` returns the primary.
 *
 * Call-site contract:
 *   - Only pass READ-ONLY queries that don't need read-after-write
 *     consistency (analytics dashboards, KPI roll-ups, public landing
 *     reads, /api/health/deep, founder-cockpit aggregations).
 *   - NEVER use this inside a read-modify-write sequence — the replica
 *     can lag behind the primary by tens of milliseconds and the write
 *     would race against stale data.
 *   - Categories are tagged at the call site so the adoption-tracker
 *     log can show which surfaces are actually exercising the replica.
 *
 * Founder override:
 *   `infra.override.readReplica.categories` (founder_settings) controls
 *   which categories route to the replica. Empty list (default) means
 *   ALL eligible reads route. Non-empty list narrows to the listed
 *   categories. The setting is cached in-memory for 60s so we don't
 *   hit founder_settings on every query.
 */

import { db, dbReplica } from "./db";
import { getSetting } from "./services/settings";
import { logger } from "./utils/logger";

const SETTING_KEY = "infra.override.readReplica.categories";
const CACHE_TTL_MS = 60_000;

interface CachedCategories {
  value: string[];
  expiresAt: number;
}

let categoryCache: CachedCategories | null = null;

/**
 * Read the configured category filter from founder_settings, cached
 * for ~60s. Returns an empty array (= route everything) when the
 * setting hasn't been seeded yet, when the value isn't an array, or
 * when the read fails — we always prefer "route to replica" over
 * "fail open to primary" since the helper itself already falls back
 * when the replica is unset.
 */
async function getConfiguredCategories(): Promise<string[]> {
  const now = Date.now();
  if (categoryCache && categoryCache.expiresAt > now) {
    return categoryCache.value;
  }

  let value: string[] = [];
  try {
    const raw = await getSetting<unknown>(SETTING_KEY, []);
    if (Array.isArray(raw)) {
      value = raw.filter((v): v is string => typeof v === "string");
    }
  } catch (err) {
    logger.warn("[db-replica] failed to read category filter", {
      metadata: { error: (err as Error)?.message },
    });
    value = [];
  }

  categoryCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Test-only — clears the in-memory category cache. */
export function _resetReplicaCategoryCache(): void {
  categoryCache = null;
}

interface AdoptionCounters {
  primary: number;
  replica: number;
  byCategory: Map<string, { primary: number; replica: number }>;
}

const adoption: AdoptionCounters = {
  primary: 0,
  replica: 0,
  byCategory: new Map(),
};

let lastLogAt = 0;
const ADOPTION_LOG_INTERVAL_MS = 60_000;

function recordRoutingDecision(category: string, routed: "primary" | "replica"): void {
  if (routed === "primary") adoption.primary += 1;
  else adoption.replica += 1;

  const bucket = adoption.byCategory.get(category) ?? { primary: 0, replica: 0 };
  bucket[routed] += 1;
  adoption.byCategory.set(category, bucket);

  // Emit a structured adoption-rate log at most once per minute so we
  // can verify the helper is firing without flooding the log stream.
  const now = Date.now();
  if (now - lastLogAt > ADOPTION_LOG_INTERVAL_MS) {
    lastLogAt = now;
    const total = adoption.primary + adoption.replica;
    const rate = total > 0 ? adoption.replica / total : 0;
    logger.info("[db-replica] adoption window", {
      metadata: {
        windowEndedAt: new Date(now).toISOString(),
        totalReads: total,
        replicaReads: adoption.replica,
        primaryReads: adoption.primary,
        adoptionRate: Number(rate.toFixed(3)),
        byCategory: Object.fromEntries(adoption.byCategory.entries()),
      },
    });
  }
}

/**
 * Lightweight tag emitted for every read so the adoption rate can be
 * verified per category. Callers pass a stable string like
 * "founder.intelligence.pulse", "cohort.retention", "health.deep".
 *
 * Exported separately so call sites that already pick the right
 * Drizzle instance manually (rare) can still register adoption.
 */
export function recordReplicaUsage(
  category: string,
  routed: "primary" | "replica",
): void {
  recordRoutingDecision(category, routed);
}

/**
 * Route this query to the read replica when eligible, else the primary.
 *
 * Pass a stable category string (`"founder.intelligence.pulse"`,
 * `"cohort.retention"`, `"health.deep"`, etc.) so adoption can be
 * verified per surface.
 *
 * Usage:
 *   const rows = await (await dbForReads("founder.intelligence.pulse"))
 *     .select(...)
 *     .from(...);
 *
 * Synchronous shorthand (`dbForReadsSync`) is also exported below for
 * the common case where the caller doesn't care about per-category
 * filtering and just wants the replica-or-primary instance.
 */
export async function dbForReads(category: string): Promise<typeof db> {
  // No replica configured → return primary (no log spam).
  if (!dbReplica) {
    recordRoutingDecision(category, "primary");
    return db;
  }

  const filter = await getConfiguredCategories();
  if (filter.length === 0) {
    // Empty filter = route every eligible read to the replica.
    recordRoutingDecision(category, "replica");
    return dbReplica;
  }

  if (filter.includes(category)) {
    recordRoutingDecision(category, "replica");
    return dbReplica;
  }

  recordRoutingDecision(category, "primary");
  return db;
}

/**
 * Synchronous variant — bypasses the category filter and returns the
 * replica if configured, else the primary. Use this in hot paths where
 * the extra `await` would be noisy AND the call site doesn't need
 * category-level opt-in/out. Adoption is still recorded against the
 * provided category tag.
 */
export function dbForReadsSync(category: string): typeof db {
  if (!dbReplica) {
    recordRoutingDecision(category, "primary");
    return db;
  }
  recordRoutingDecision(category, "replica");
  return dbReplica;
}

/**
 * Snapshot of the adoption counters — used by `/api/health/replica`
 * and tests. Returns a structural clone so callers can't mutate the
 * live counters.
 */
export function snapshotAdoption(): {
  primary: number;
  replica: number;
  adoptionRate: number;
  byCategory: Record<string, { primary: number; replica: number }>;
} {
  const total = adoption.primary + adoption.replica;
  return {
    primary: adoption.primary,
    replica: adoption.replica,
    adoptionRate: total > 0 ? adoption.replica / total : 0,
    byCategory: Object.fromEntries(adoption.byCategory.entries()),
  };
}

/** Test-only — resets adoption counters. */
export function _resetAdoptionCounters(): void {
  adoption.primary = 0;
  adoption.replica = 0;
  adoption.byCategory.clear();
  lastLogAt = 0;
}
