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
 *
 * TTL: 24 hours (configurable via IDEMPOTENCY_TTL_HOURS env var).
 *
 * Apply to sensitive routes:
 *   router.post("/create-payment", idempotencyMiddleware, handler)
 *
 * Routes that auto-apply this middleware (via routes.ts):
 *   POST /api/billing/*, POST /api/finance/notes, POST /api/offers/batch
 */

import type { Request, Response, NextFunction } from "express";

const TTL_SECONDS =
  parseInt(process.env.IDEMPOTENCY_TTL_HOURS ?? "24", 10) * 3600;

// ─── Storage (Redis preferred, in-memory fallback) ────────────────────────────

interface StoredResponse {
  status: number;
  body: unknown;
  timestamp: number;
}

const memStore = new Map<string, StoredResponse>();

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memStore.entries()) {
    if (now - value.timestamp > TTL_SECONDS * 1000) {
      memStore.delete(key);
    }
  }
}, 10 * 60 * 1000);

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
  memStore.set(key, value);
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
  const org = (req as any).organization;
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

    // Intercept the response to cache it
    const originalJson = res.json.bind(res);
    (res as any).json = function (body: unknown) {
      const status = res.statusCode || 200;
      // Only cache success responses
      if (status < 400) {
        setCached(scopedKey, { status, body, timestamp: Date.now() }).catch(
          () => {}
        );
      }
      return originalJson(body);
    };

    next();
  });
}
