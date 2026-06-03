/**
 * Response-time ring buffer — lightweight in-memory per-route timing
 * accumulator. Feeds Iris's continuous p95 baseline sampler.
 *
 * Why an in-process ring (vs Sentry transactions): the codebase has no
 * existing request-timing telemetry the sampler can pull from. A Sentry
 * span pull would require the cron to hit Sentry's API (paid, rate-limited)
 * for what's effectively local state. The ring is O(N) memory bounded per
 * tracked route (default N=1000 ≈ 8KB per route), cleared each time the
 * sampler drains it, and never blocks request processing.
 *
 * Discipline: ONLY tracks routes in IRIS_TRACKED_ENDPOINTS. Every other
 * route's timing is dropped on the floor — the middleware must stay below
 * 50µs overhead per request, so we exit early on the path-match check.
 *
 * The middleware mounts once at app boot. drain() is called by the cron
 * (server/services/iris/perfMonitor.ts:samplePerformance) to consume the
 * accumulated observations and persist a summary row.
 */

import type { Request, Response, NextFunction } from "express";
import { IRIS_TRACKED_ENDPOINTS } from "@shared/schema/iris-perf";

const RING_CAPACITY_PER_ROUTE = 1000;

interface RouteKey {
  path: string;
  method: string;
}

interface RouteRing {
  durations: number[]; // milliseconds; capacity = RING_CAPACITY_PER_ROUTE
  windowStartedAt: Date;
}

/**
 * Make a deterministic key for a (path, method) tuple. We normalise to
 * lowercase method so "get"/"GET" collide; path stays exact since route
 * params aren't expanded here (the tracked set is static literal paths,
 * not templates).
 */
function keyFor(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`;
}

const TRACKED_KEYS = new Set(
  IRIS_TRACKED_ENDPOINTS.map((e) => keyFor(e.path, e.method)),
);

/**
 * Per-route accumulators. Lazily initialised on first observation so
 * unreferenced routes never allocate.
 */
const rings = new Map<string, RouteRing>();

/**
 * Express middleware. Mount once, top-of-stack, before routers. Captures
 * the elapsed time from request-arrival to response-finish, dropping
 * any sample for an untracked route in O(1).
 */
export function responseTimeRingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const key = keyFor(req.path, req.method);
  if (!TRACKED_KEYS.has(key)) return next();

  const startedAtMs = Date.now();
  // process.hrtime.bigint() would be more precise but adds an import +
  // allocation each request; Date.now() resolution (1ms) is fine for
  // p50/p95/p99 buckets in the 10-1000ms range we care about.
  res.once("finish", () => {
    const elapsed = Date.now() - startedAtMs;
    pushObservation(key, elapsed);
  });
  return next();
}

function pushObservation(key: string, durationMs: number): void {
  let ring = rings.get(key);
  if (!ring) {
    ring = { durations: [], windowStartedAt: new Date() };
    rings.set(key, ring);
  }
  // Bounded ring — drop the oldest observation when full so the buffer
  // never grows unbounded if the cron is delayed.
  if (ring.durations.length >= RING_CAPACITY_PER_ROUTE) {
    ring.durations.shift();
  }
  ring.durations.push(durationMs);
}

export interface RingSnapshot {
  endpointPath: string;
  method: string;
  durations: number[];
  windowStartedAt: Date;
  windowEndedAt: Date;
}

/**
 * Drain all rings — returns a snapshot per tracked route and resets the
 * accumulators with a fresh window start. Called by the sampler cron.
 *
 * Resetting on drain means each persisted sample is exact and disjoint
 * — no double-counting across windows — at the cost of losing samples
 * if the cron fails to call this drain. That's the right trade: a missed
 * drain is recoverable (a gap in the trend chart), but double-counting
 * a slow request would silently inflate baselines.
 */
export function drainRings(now: Date = new Date()): RingSnapshot[] {
  const out: RingSnapshot[] = [];
  for (const endpoint of IRIS_TRACKED_ENDPOINTS) {
    const key = keyFor(endpoint.path, endpoint.method);
    const ring = rings.get(key);
    if (!ring || ring.durations.length === 0) continue;
    out.push({
      endpointPath: endpoint.path,
      method: endpoint.method,
      durations: [...ring.durations],
      windowStartedAt: ring.windowStartedAt,
      windowEndedAt: now,
    });
    // Reset — fresh window starts now.
    ring.durations = [];
    ring.windowStartedAt = now;
  }
  return out;
}

/**
 * Test-only: reset all in-memory rings. Production code never calls this.
 */
export function _resetRingsForTest(): void {
  rings.clear();
}

/**
 * Test-only: directly push an observation. Used by perfMonitor.test.ts
 * to avoid wiring a full Express request through the middleware.
 */
export function _pushObservationForTest(
  path: string,
  method: string,
  durationMs: number,
): void {
  pushObservation(keyFor(path, method), durationMs);
}
