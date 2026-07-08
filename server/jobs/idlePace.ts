/**
 * idlePace — activity-aware job pacing (2026-07-07 cost audit).
 *
 * The autopilot shouldn't think at full cadence when nothing is changing.
 * At zero paying customers the decision executor scanned its inbox every
 * 30 minutes and the embedding refresher ticked every ~6 minutes — worker
 * CPU and (for the executor) LLM budget spent re-examining a platform
 * where nothing moved. This was the single biggest idle-cost lever the
 * audit found.
 *
 * Mechanism: a job keeps its registered interval, but when the platform is
 * IDLE (paying orgs below IDLE_PACE_CUSTOMER_THRESHOLD) only 1 in
 * IDLE_PACE_MULTIPLIER ticks does real work. The gate is STATELESS —
 * `floor(now / intervalMs) % multiplier === 0` — so it needs no per-process
 * counters (module-state discipline) and behaves identically across
 * machines and restarts. Defaults: threshold 5 paying orgs, multiplier 8
 * (executor 30min → 4h effective; embeddings 6min → ~48min effective).
 *
 * Fail-safe direction: any error reading the paying-org count reports
 * ACTIVE (full speed). We never slow a real business down because a count
 * query hiccuped — the failure cost of over-thinking is dollars; the
 * failure cost of under-thinking is customers.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../utils/logger";

const IDLE_PACE_CUSTOMER_THRESHOLD = Number.parseInt(
  process.env.IDLE_PACE_CUSTOMER_THRESHOLD || "5",
  10,
);
const IDLE_PACE_MULTIPLIER = Math.max(
  1,
  Number.parseInt(process.env.IDLE_PACE_MULTIPLIER || "8", 10),
);
const COUNT_CACHE_TTL_MS = 10 * 60 * 1000;

// Process-local read-through cache of the paying-org count (SAFE class:
// staleness across machines is acceptable — see module-state audit).
let cachedCount: number | null = null;
let cachedAt = 0;

async function payingOrgCount(): Promise<number> {
  const now = Date.now();
  if (cachedCount !== null && now - cachedAt < COUNT_CACHE_TTL_MS) {
    return cachedCount;
  }
  const result = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM organizations
    WHERE subscription_tier NOT IN ('free')
      AND COALESCE(subscription_status, 'active') NOT IN ('cancelled', 'suspended')
  `);
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  cachedCount = Number(rows?.[0]?.n ?? 0);
  cachedAt = now;
  return cachedCount;
}

/** True when the platform has too few paying customers to justify full cadence. */
export async function isPlatformIdle(): Promise<boolean> {
  try {
    return (await payingOrgCount()) < IDLE_PACE_CUSTOMER_THRESHOLD;
  } catch (err) {
    // Fail toward ACTIVE — never throttle a real business on a read error.
    logger.warn("[idlePace] paying-org count failed — assuming ACTIVE pace", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}

/**
 * Gate for a fixed-interval job's tick. Returns true when the tick should
 * do real work: always when the platform is active; 1 in
 * IDLE_PACE_MULTIPLIER intervals when idle. Stateless time-slot math, so
 * every machine agrees on which slot is live.
 */
export async function shouldRunAtPace(
  jobName: string,
  intervalMs: number,
): Promise<boolean> {
  if (!(await isPlatformIdle())) return true;
  const slot = Math.floor(Date.now() / intervalMs);
  const live = slot % IDLE_PACE_MULTIPLIER === 0;
  if (!live) {
    logger.debug(`[idlePace] ${jobName}: idle platform — skipping tick`, {
      metadata: { slot, multiplier: IDLE_PACE_MULTIPLIER },
    });
  }
  return live;
}

/** Test seam. */
export function __resetIdlePaceCache(): void {
  cachedCount = null;
  cachedAt = 0;
}
