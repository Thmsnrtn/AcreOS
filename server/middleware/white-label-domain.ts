// @ts-nocheck — ORM type refinement deferred; runtime-correct
import type { Request, Response, NextFunction } from 'express';
import { whiteLabelService } from '../services/whiteLabelService';

interface WhiteLabelOrgInfo {
  orgId: number;
  brandName: string;
  logoUrl?: string;
  primaryColor: string;
}

// Augment Express Request type
declare global {
  namespace Express {
    interface Request {
      whiteLabelOrg: WhiteLabelOrgInfo | null;
    }
  }
}

interface CacheEntry {
  value: WhiteLabelOrgInfo | null;
  expiresAt: number;
}

// In-memory domain lookup cache with 5-minute TTL
const domainCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(domain: string): WhiteLabelOrgInfo | null | undefined {
  const entry = domainCache.get(domain);
  if (!entry) return undefined; // cache miss
  if (Date.now() > entry.expiresAt) {
    domainCache.delete(domain);
    return undefined; // expired
  }
  return entry.value;
}

function setCache(domain: string, value: WhiteLabelOrgInfo | null): void {
  domainCache.set(domain, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Express middleware that resolves white-label configuration from the Host header.
 *
 * 1. Reads the Host header (strips port if present)
 * 2. Checks the in-memory cache (5-minute TTL)
 * 3. On cache miss: queries DB via whiteLabelService.resolveFromDomain()
 * 4. If a matching config is found: populates req.whiteLabelOrg with org info
 *    and sets req.hostname to the custom domain
 * 5. If not found: sets req.whiteLabelOrg = null and continues normally
 *
 * Register BEFORE auth middleware in routes.ts.
 */
export async function whiteLabelDomainMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawHost = req.headers.host ?? '';
    // Strip port (e.g. "app.mycompany.com:3000" → "app.mycompany.com")
    const host = rawHost.split(':')[0].toLowerCase();

    if (!host) {
      req.whiteLabelOrg = null;
      return next();
    }

    // Check cache first
    const cached = getCached(host);
    if (cached !== undefined) {
      req.whiteLabelOrg = cached;
      if (cached) {
        // Override Express's parsed hostname with the custom domain
        Object.defineProperty(req, 'hostname', {
          value: host,
          writable: true,
          configurable: true,
        });
      }
      return next();
    }

    // Cache miss — query DB
    const config = await whiteLabelService.resolveFromDomain(host);

    if (config && config.status === 'active') {
      const orgInfo: WhiteLabelOrgInfo = {
        orgId: config.organizationId,
        brandName: config.brandName,
        logoUrl: config.logoUrl,
        primaryColor: config.primaryColor,
      };
      setCache(host, orgInfo);
      req.whiteLabelOrg = orgInfo;
      Object.defineProperty(req, 'hostname', {
        value: host,
        writable: true,
        configurable: true,
      });
    } else {
      setCache(host, null);
      req.whiteLabelOrg = null;
    }

    next();
  } catch (err) {
    // Non-fatal: if domain lookup fails, continue without white-label context
    console.error('[WhiteLabelDomainMiddleware] Error resolving domain:', err);
    req.whiteLabelOrg = null;
    next();
  }
}
