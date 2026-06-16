/**
 * Founder Autopilot — the uptime sense (real, derived from heartbeat gaps).
 *
 * Replaces the old hard-stubbed 99.9% with a genuinely measured number. The
 * worker writes one uptime sample ~per minute as it polls; a GAP between two
 * consecutive samples larger than the expected cadence is provable downtime —
 * the worker wasn't running to write the missing beats. Uptime % over a window
 * is (measured span − downtime) / measured span.
 *
 * Honesty:
 *  - It measures WORKER-PROCESS liveness (the thing that runs all autonomous
 *    work + alerting). On Fly the worker and app share a deploy, so a whole-app
 *    outage shows up here too — but it is not a web-request SLA. Labelled as
 *    such; an optional external probe (source='external') can feed the same
 *    table for true outside-in reachability.
 *  - It only claims uptime for the span it actually has samples for. Too little
 *    data ⇒ null (the caller keeps the conservative default rather than
 *    inventing a number).
 *
 * computeUptimePct is PURE → exhaustively testable. The DB helpers are thin.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "../../db";
import { uptimeSamples } from "@shared/schema";
import { logger } from "../../utils/logger";

/** The worker writes a sample at most this often (piggybacks the 5s poll). */
export const SAMPLE_INTERVAL_MS = 60_000; // 1 minute
/** A gap beyond expected × this grace isn't normal jitter — it's downtime. */
export const GRACE_FACTOR = 3;
/** Rolling window the pulse reports over. */
export const UPTIME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Below this much measured data we don't claim a number (return null). */
export const MIN_MEASURED_MS = 60 * 60 * 1000; // 1 hour
/** Keep ~31 days of samples. */
export const RETENTION_MS = 31 * 24 * 60 * 60 * 1000;

export interface UptimeComputeOpts {
  now: number;
  windowMs?: number;
  expectedIntervalMs?: number;
  graceFactor?: number;
  minMeasuredMs?: number;
}

/**
 * Compute uptime % from sample timestamps (epoch ms, any order). Pure + total.
 * Returns null when there isn't enough measured span to make an honest claim.
 */
export function computeUptimePct(sampleTimes: number[], opts: UptimeComputeOpts): number | null {
  const windowMs = opts.windowMs ?? UPTIME_WINDOW_MS;
  const expected = opts.expectedIntervalMs ?? SAMPLE_INTERVAL_MS;
  const grace = opts.graceFactor ?? GRACE_FACTOR;
  const minMeasured = opts.minMeasuredMs ?? MIN_MEASURED_MS;
  const tolerance = expected * grace;

  const windowStart = opts.now - windowMs;
  const inWindow = sampleTimes
    .filter((t) => t >= windowStart && t <= opts.now)
    .sort((a, b) => a - b);
  if (inWindow.length === 0) return null;

  const measuredStart = inWindow[0];
  const measuredSpan = opts.now - measuredStart;
  if (measuredSpan < minMeasured) return null;

  // Sum downtime: any gap beyond tolerance contributes (gap − expected); plus a
  // trailing gap (currently down) from the last sample to now.
  let downtime = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const gap = inWindow[i] - inWindow[i - 1];
    if (gap > tolerance) downtime += gap - expected;
  }
  const trailing = opts.now - inWindow[inWindow.length - 1];
  if (trailing > tolerance) downtime += trailing - expected;

  const up = Math.max(0, Math.min(1, (measuredSpan - downtime) / measuredSpan));
  return Math.round(up * 1000) / 10; // one decimal, e.g. 99.9
}

// ── DB helpers ───────────────────────────────────────────────────────────────

let lastSampleAt = 0;

/**
 * Record a liveness sample, throttled to SAMPLE_INTERVAL_MS so the 5s poll loop
 * doesn't flood the table. Best-effort — never throws (an observability write
 * must never break the worker). Occasionally prunes old rows.
 */
export async function recordUptimeSample(source = "worker"): Promise<void> {
  const now = Date.now();
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = now;
  try {
    await db.insert(uptimeSamples).values({ at: new Date(now), source });
    // Prune ~1% of the time to keep the table bounded without per-write cost.
    if (now % 100 < 1) {
      await db.delete(uptimeSamples).where(lt(uptimeSamples.at, new Date(now - RETENTION_MS)));
    }
  } catch (err) {
    logger.warn("[uptime] sample write failed", err instanceof Error ? err : undefined);
  }
}

async function uptimeForSource(source: string, now: number): Promise<number | null> {
  const rows = await db
    .select({ at: uptimeSamples.at })
    .from(uptimeSamples)
    .where(and(gte(uptimeSamples.at, new Date(now - UPTIME_WINDOW_MS)), eq(uptimeSamples.source, source)))
    .orderBy(uptimeSamples.at);
  return computeUptimePct(rows.map((r) => r.at.getTime()), { now });
}

/**
 * Real uptime % over the rolling window, or null if not enough data yet.
 * PREFERS the external probe (true outside-in web reachability) when it has
 * data; otherwise falls back to the worker-liveness pulse. This matters: if
 * the web tier is down but the worker is alive, worker samples would mask the
 * outage — so when the external probe is enabled, it is the measure of record.
 */
export async function getUptimePct(now = Date.now()): Promise<number | null> {
  try {
    const external = await uptimeForSource("external", now);
    if (external != null) return external;
    return await uptimeForSource("worker", now);
  } catch (err) {
    logger.warn("[uptime] read failed", err instanceof Error ? err : undefined);
    return null;
  }
}
