/**
 * T6 — Idempotency Keys Middleware
 *
 * Prevents duplicate processing of payment mutations, offer sends, and any
 * other state-changing operation that would be dangerous to execute twice.
 *
 * How it works:
 *   Client sends: Idempotency-Key: <uuid> header with any POST/PATCH/PUT.
 *   Server checks cache (Redis or in-memory) for that key + orgId.
 *   If found → returns the cached response (HTTP 200 or original status).
 *   If not found → processes the request, caches the response, returns it.
 *   If the first request with that key is STILL RUNNING in this process →
 *   409 IDEMPOTENCY_IN_PROGRESS (a concurrent retry must not run it twice).
 *
 * The middleware must sit AFTER getOrCreateOrg: the key is scoped by
 * req.organization, and without it two tenants' keys share one namespace —
 * and after the route's own permission/scope checks, so a replay is only ever
 * served to a caller who could have made the original request.
 *
 * TTL: 24 hours (configurable via IDEMPOTENCY_TTL_HOURS env var).
 *
 * Apply to sensitive routes:
 *   router.post("/create-payment", idempotencyMiddleware, handler)
 *
 * It is applied per route — nothing in routes.ts auto-applies it (an earlier
 * version of this header said otherwise). grep for `idempotencyMiddleware`
 * for the live set; POST /api/leads joined it 2026-10-07.
 */

import type { Request, Response, NextFunction } from "express";
import { clock } from "../utils/clock";
import { sendError } from "../utils/errors";

const TTL_SECONDS =
  parseInt(process.env.IDEMPOTENCY_TTL_HOURS ?? "24", 10) * 3600;

// ─── Storage (Redis preferred, in-memory fallback) ────────────────────────────

interface StoredResponse {
  status: number;
  body: unknown;
  timestamp: number;
}

const memStore = new Map<string, StoredResponse>();

// P0 #2 — Idempotency cache cleanup migrated to scheduleSelfRescheduling
// (Phase 3 Week 7-8). Self-rescheduling avoids concurrent sweeps if the
// previous one is somehow stuck, persists every run to job_runs, and routes
// terminal failures to outbox_dlq instead of swallowing them.
//
// Skipped entirely under NODE_ENV=test so unit tests don't open a DB pool
// or leak timers when they import this module.
function _runIdempotencyMemSweep(): number {
  const now = clock.nowMs();
  let removed = 0;
  for (const [key, value] of memStore.entries()) {
    if (now - value.timestamp > TTL_SECONDS * 1000) {
      memStore.delete(key);
      removed++;
    }
  }
  return removed;
}

if (process.env.NODE_ENV !== "test") {
  // Lazy import so unit tests that don't touch this middleware never load
  // server/db.ts.
  import("../jobs/scheduler").then(({ scheduleSelfRescheduling }) => {
    scheduleSelfRescheduling({
      name: "idempotency_cache_cleanup",
      intervalMs: 10 * 60 * 1000,
      initialDelayMs: 10 * 60 * 1000,
      run: async () => _runIdempotencyMemSweep(),
    });
  }).catch(() => { /* scheduler optional in non-server contexts */ });
}

async function getRedis(): Promise<any> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  try {
    const IORedis = (await import("ioredis")).default;
    return new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  } catch {
    return null;
  }
}

let _redis: any | null = null;
async function redis(): Promise<any | null> {
  if (_redis) return _redis;
  _redis = await getRedis();
  return _redis;
}

async function getCached(key: string): Promise<StoredResponse | null> {
  // This process's own record first: it is written synchronously the moment a
  // response is produced, so a retry landing here never races the async Redis
  // write.
  const local = memStore.get(key);
  if (local) return local;
  try {
    const r = await redis();
    if (r) {
      const raw = await r.get(`idempotency:${key}`);
      return raw ? JSON.parse(raw) : null;
    }
  } catch {}
  return memStore.get(key) ?? null;
}

async function setCached(key: string, value: StoredResponse): Promise<void> {
  try {
    const r = await redis();
    if (r) {
      await r.setex(`idempotency:${key}`, TTL_SECONDS, JSON.stringify(value));
      return;
    }
  } catch {}
  rememberLocally(key, value);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

  if (!idempotencyKey) {
    return next(); // key is optional — only applied when provided
  }

  // Scope key to organization to prevent cross-tenant collisions
  const org = req.organization;
  const scopedKey = org
    ? `org:${org.id}:${idempotencyKey}`
    : idempotencyKey;

  // Check cache asynchronously
  getCached(scopedKey).then((cached) => {
    if (cached) {
      // Replay the original response
      res.status(cached.status).json(cached.body);
      return;
    }

    // A retry that arrives while the first attempt is still running would
    // otherwise miss the cache (nothing is cached until the first response)
    // and run the handler a second time — the duplicate this middleware
    // exists to prevent. Refuse it instead; the client retries after the
    // first attempt settles and then gets the replay. Per-process: a retry
    // that lands on a different machine in the same window is not covered.
    const startedAt = inFlight.get(scopedKey);
    if (startedAt !== undefined && clock.nowMs() - startedAt < IN_FLIGHT_TTL_MS) {
      sendError(
        res,
        409,
        "IDEMPOTENCY_IN_PROGRESS",
        "A request with this Idempotency-Key is still being processed. Retry in a moment.",
      );
      return;
    }
    inFlight.set(scopedKey, clock.nowMs());
    // Released when the response is PRODUCED (json below, or "finish" for a
    // handler that answers some other way) — never on "close": a client that
    // gives up while the handler is still running closes the socket, and
    // releasing then would let its retry run the handler a second time. A
    // handler that never answers is covered by IN_FLIGHT_TTL_MS.
    const release = () => inFlight.delete(scopedKey);
    res.on?.("finish", release);

    // Intercept the response to cache it
    const originalJson = res.json.bind(res);
    (res as any).json = function (body: unknown) {
      const status = res.statusCode || 200;
      // Only cache success responses
      if (status < 400) {
        // Recorded locally BEFORE the in-flight marker is released, so a retry
        // can never fall into the gap between the two.
        rememberLocally(scopedKey, { status, body, timestamp: clock.nowMs() });
        setCached(scopedKey, { status, body, timestamp: clock.nowMs() }).catch(
          () => {}
        );
      }
      release();
      return originalJson(body);
    };

    next();
  });
}

/** Keys whose first request is still running in this process → start time. */
const inFlight = new Map<string, number>();

/**
 * An in-flight marker older than this no longer blocks a retry — the first
 * attempt has outlived any request timeout (server/middleware/security.ts
 * caps requests well below it) and is treated as gone.
 */
const IN_FLIGHT_TTL_MS = 5 * 60 * 1000;

/**
 * The local store is bounded: it is the only store without Redis, and with
 * Redis it is a short-lived local copy that closes the gap before the async
 * Redis write lands. Oldest entries are evicted first (Map insertion order).
 */
const MEM_STORE_MAX = 10_000;
function rememberLocally(key: string, value: StoredResponse): void {
  memStore.delete(key);
  memStore.set(key, value);
  while (memStore.size > MEM_STORE_MAX) {
    const oldest = memStore.keys().next();
    if (oldest.done) break;
    memStore.delete(oldest.value);
  }
}
