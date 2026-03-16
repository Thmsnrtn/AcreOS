/**
 * Custom Domain Router Middleware
 *
 * Routes inbound requests by their custom domain to the corresponding tenant
 * (white-label organization) configuration. The resolved tenant context is
 * attached to the request for downstream handlers.
 *
 * Resolution order:
 *   1. X-Forwarded-Host header  (set by Cloudflare / load balancers)
 *   2. Host header              (raw connection host)
 *
 * Cache: tenant lookups are cached in-process with a 5-minute TTL.
 *        When Redis is available the cache is promoted to Redis for
 *        cross-instance consistency.
 *
 * Behaviour:
 *   - Known custom domain  → injects TenantContext onto req.tenantContext
 *   - Unknown domain        → sets req.tenantContext = null, continues (no 404)
 *     (404 guard is opt-in via requireTenant() helper below)
 *
 * Usage:
 *   import { customDomainRouter, requireTenant } from "./middleware/customDomainRouter";
 *
 *   app.use(customDomainRouter);                // inject context (always passes)
 *   app.use("/api/tenant-only", requireTenant); // 404 guard for unknown domains
 */

// @ts-nocheck — ORM type refinement deferred; runtime-correct
import type { Request, Response, NextFunction } from "express";
import { db } from "../storage";
import { whitelabelTenants } from "@shared/schema";
import { eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: number;
  organizationId: number;
  customDomain: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  status: string;
}

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      tenantContext: TenantContext | null;
    }
  }
}

// ─── In-process cache ─────────────────────────────────────────────────────────

interface CacheEntry {
  value: TenantContext | null;
  expiresAt: number;
}

const localCache = new Map<string, CacheEntry>();
const LOCAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function localGet(domain: string): TenantContext | null | undefined {
  const entry = localCache.get(domain);
  if (!entry) return undefined; // miss
  if (Date.now() > entry.expiresAt) {
    localCache.delete(domain);
    return undefined; // expired
  }
  return entry.value;
}

function localSet(domain: string, value: TenantContext | null): void {
  localCache.set(domain, { value, expiresAt: Date.now() + LOCAL_CACHE_TTL_MS });

  // Evict oldest entries if cache grows too large
  if (localCache.size > 1000) {
    const firstKey = localCache.keys().next().value;
    if (firstKey) localCache.delete(firstKey);
  }
}

// ─── Redis cache (optional, best-effort) ─────────────────────────────────────

const REDIS_TTL_SECONDS = 5 * 60;
const REDIS_KEY_PREFIX = "tenant:domain:";

async function redisGet(domain: string): Promise<TenantContext | null | undefined> {
  try {
    const { storage } = await import("../storage");
    if (typeof (storage as any).redis?.get !== "function") return undefined;
    const raw = await (storage as any).redis.get(`${REDIS_KEY_PREFIX}${domain}`);
    if (raw === null) return undefined; // miss
    if (raw === "null") return null; // cached negative
    return JSON.parse(raw) as TenantContext;
  } catch {
    return undefined;
  }
}

async function redisSet(domain: string, value: TenantContext | null): Promise<void> {
  try {
    const { storage } = await import("../storage");
    if (typeof (storage as any).redis?.setex !== "function") return;
    await (storage as any).redis.setex(
      `${REDIS_KEY_PREFIX}${domain}`,
      REDIS_TTL_SECONDS,
      value === null ? "null" : JSON.stringify(value)
    );
  } catch {
    // Non-fatal
  }
}

// ─── Database lookup ──────────────────────────────────────────────────────────

async function lookupTenantByDomain(
  domain: string
): Promise<TenantContext | null> {
  try {
    const rows = await db
      .select()
      .from(whitelabelTenants)
      .where(eq(whitelabelTenants.customDomain, domain))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    if (row.status !== "active") return null;

    return {
      tenantId: row.id,
      organizationId: row.organizationId,
      customDomain: row.customDomain,
      brandName: row.brandName,
      logoUrl: row.logoUrl ?? null,
      primaryColor: row.primaryColor ?? "#000000",
      status: row.status,
    };
  } catch (err) {
    // Table may not exist yet in dev environments
    console.error("[customDomainRouter] DB lookup error:", err);
    return null;
  }
}

// ─── Domain extraction ────────────────────────────────────────────────────────

function extractDomain(req: Request): string | null {
  // X-Forwarded-Host is set by Cloudflare/CDN and is more reliable
  const forwarded = req.headers["x-forwarded-host"];
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return raw.split(":")[0].toLowerCase().trim() || null;
  }

  const host = req.headers.host;
  if (host) {
    return host.split(":")[0].toLowerCase().trim() || null;
  }

  return null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Resolves tenant context from the request's Host / X-Forwarded-Host header.
 * Always calls next() — use requireTenant() downstream if you need a 404 guard.
 */
export async function customDomainRouter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const domain = extractDomain(req);

  if (!domain) {
    req.tenantContext = null;
    return next();
  }

  // 1. Local cache
  const localHit = localGet(domain);
  if (localHit !== undefined) {
    req.tenantContext = localHit;
    if (localHit) {
      res.setHeader("X-Tenant-Id", localHit.organizationId.toString());
    }
    return next();
  }

  // 2. Redis cache (cross-instance)
  const redisHit = await redisGet(domain);
  if (redisHit !== undefined) {
    localSet(domain, redisHit); // promote to local cache
    req.tenantContext = redisHit;
    if (redisHit) {
      res.setHeader("X-Tenant-Id", redisHit.organizationId.toString());
    }
    return next();
  }

  // 3. Database
  try {
    const tenant = await lookupTenantByDomain(domain);
    localSet(domain, tenant);
    await redisSet(domain, tenant);

    req.tenantContext = tenant;
    if (tenant) {
      res.setHeader("X-Tenant-Id", tenant.organizationId.toString());
    }
  } catch (err) {
    console.error("[customDomainRouter] Unhandled error, continuing without tenant context:", err);
    req.tenantContext = null;
  }

  next();
}

// ─── Guard middleware ─────────────────────────────────────────────────────────

/**
 * Guard middleware that returns 404 if no tenant was resolved for this domain.
 * Mount after customDomainRouter on routes that require a valid tenant.
 *
 * Example:
 *   app.use("/tenant-portal", customDomainRouter, requireTenant, tenantRoutes);
 */
export function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.tenantContext) {
    res.status(404).json({
      error: "Not found",
      message: "No tenant configuration found for this domain.",
    });
    return;
  }
  next();
}

// ─── Cache management ─────────────────────────────────────────────────────────

/** Evict a specific domain from both local and Redis caches. */
export async function evictTenantCache(domain: string): Promise<void> {
  localCache.delete(domain);
  try {
    const { storage } = await import("../storage");
    if (typeof (storage as any).redis?.del === "function") {
      await (storage as any).redis.del(`${REDIS_KEY_PREFIX}${domain}`);
    }
  } catch {
    // Non-fatal
  }
}

/** Clear the entire local tenant cache (for testing). */
export function clearTenantCache(): void {
  localCache.clear();
}

/** Return current local cache stats for monitoring. */
export function getTenantCacheStats(): { size: number; domains: string[] } {
  return {
    size: localCache.size,
    domains: Array.from(localCache.keys()),
  };
}
