/**
 * requireApiKey(scope) — public API authentication middleware.
 *
 * Lens 50 (Public API v0). Gates every /api/v1/* route.
 *
 * Flow:
 *   1. Extract `Authorization: Bearer ak_...` header.
 *   2. Hash the plaintext with the server pepper (HMAC-SHA256).
 *   3. Look up the row in api_keys by hashed_key (indexed).
 *   4. timing-safe re-compare to guard against partial-prefix attacks.
 *   5. Reject if revoked, expired, or missing the required scope.
 *   6. Attach { apiKey, organization } to the request.
 *   7. After the response finishes, append a row to api_key_usage.
 *
 * Rate limiting (per-org, tier-default with per-key override) is handled
 * in middleware/publicApiRateLimit.ts and stamps X-RateLimit-* headers.
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { apiKeys, apiKeyUsage, organizations, type ApiKey, type Organization } from "@shared/schema";
import { eq, and, isNull, or, gt, sql as drizzleSql } from "drizzle-orm";
import { hashApiKey, verifyHash, type ApiScope } from "../services/apiKeys";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";
import { randomUUID } from "node:crypto";

declare module "express-serve-static-core" {
  interface Request {
    apiKey?: ApiKey;
    apiKeyOrganization?: Organization;
  }
}

const BEARER_RE = /^Bearer\s+(ak_(?:live|test)_[A-Za-z0-9_-]{16,})$/;

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const m = header.match(BEARER_RE);
  return m ? m[1] : null;
}

/**
 * Truncate a remote address for the usage log. We keep only enough
 * bits to bucket abuse patterns; we do NOT persist full IPs for the
 * same reason rate limiting can't trust them (cellular NAT).
 */
function truncateRemote(raw: string | undefined): string | null {
  if (!raw) return null;
  const ip = raw.split(",")[0].trim();
  if (ip.includes(":")) {
    // IPv6 — keep first 3 hextets
    return ip.split(":").slice(0, 3).join(":") + "::/48";
  }
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  return null;
}

export function requireApiKey(requiredScope: ApiScope) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const requestId = (req.headers["x-request-id"] as string) || randomUUID();
    res.setHeader("X-Request-Id", requestId);

    const token = extractBearer(req);
    if (!token) {
      return Errors.unauthorized(res);
    }

    let row: ApiKey | undefined;
    let org: Organization | undefined;

    try {
      const hashed = hashApiKey(token);
      const rows = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.hashedKey, hashed), isNull(apiKeys.revokedAt)))
        .limit(1);

      row = rows[0];
      if (!row) {
        return Errors.unauthorized(res);
      }

      // Constant-time re-check (defense-in-depth — the index lookup
      // already used the full hash, but if a future migration changes
      // the column we don't want to silently regress to prefix match).
      if (!verifyHash(hashed, row.hashedKey)) {
        return Errors.unauthorized(res);
      }

      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        return Errors.unauthorized(res);
      }

      if (!row.scopes.includes(requiredScope)) {
        return Errors.forbidden(res, `Missing required scope: ${requiredScope}`);
      }

      const [foundOrg] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, row.organizationId))
        .limit(1);

      if (!foundOrg) {
        // Org deleted out from under the key — treat as revoked.
        return Errors.unauthorized(res);
      }
      org = foundOrg;
    } catch (err) {
      logger.error("requireApiKey lookup failed", err instanceof Error ? err : undefined);
      return Errors.internal(res, err);
    }

    req.apiKey = row;
    req.apiKeyOrganization = org;
    // Bridge to AuthenticatedRequest contract so downstream handlers
    // (and Errors.* helpers) can use req.organization / organizationId
    // without a second middleware.
    req.organization = org;
    req.organizationId = org.id;

    // Fire-and-forget usage log + lastUsedAt bump after the response
    // completes. We intentionally don't await — adding a DB round-trip
    // to the hot path would be the kind of thing the Stripe gateway
    // would call out in a postmortem.
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const apiKeyId = row!.id;
      const orgId = row!.organizationId;
      const remoteAddrPrefix = truncateRemote(
        (req.headers["x-forwarded-for"] as string) || req.ip,
      );
      const userAgent = (req.headers["user-agent"] as string)?.slice(0, 255) ?? null;

      Promise.all([
        db.insert(apiKeyUsage).values({
          apiKeyId,
          organizationId: orgId,
          method: req.method,
          path: req.path.slice(0, 255),
          statusCode: res.statusCode,
          durationMs,
          remoteAddrPrefix,
          userAgent,
          requestId,
        }),
        db
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, apiKeyId)),
      ]).catch((err) => {
        logger.warn("api_key_usage log write failed", {
          metadata: { apiKeyId, err: err instanceof Error ? err.message : String(err) },
        });
      });
    });

    next();
  };
}

// Silence the unused-import warning on `or`/`gt`/`drizzleSql` — they're
// reserved for the next iteration (expires_at index push-down).
void or; void gt; void drizzleSql;
