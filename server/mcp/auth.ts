/**
 * MCP endpoint authentication — T0-3 (2026-06-10).
 *
 * Replaces the original plain `!==` compare against MCP_API_KEY (timing
 * unsafe) and the unbound `organizationId` tool parameter (any caller with
 * the static key could read ANY org's data).
 *
 * Two credential paths, both of which resolve to an org binding that the
 * MCP tools are forced to (see server/mcp/index.ts — the org-scoped tools
 * no longer accept an organizationId argument at all):
 *
 *   1. Per-org API key (`ak_live_…` / `ak_test_…`) — the clean path.
 *      Resolved through the same api_keys machinery as /api/v1/*
 *      (hashApiKey lookup + timing-safe re-compare, revocation and
 *      expiry honored). The key's organizationId becomes the binding.
 *
 *   2. Static MCP_API_KEY (back-compat with existing Claude Desktop
 *      configs + routes-setup.ts generation). Compared timing-safe via
 *      verifySecret, and bound to MCP_ORG_ID. If MCP_ORG_ID is unset the
 *      session has NO org binding: public-data tools still work, but
 *      org-scoped tools refuse. The static key can no longer roam orgs.
 */

import { hashApiKey, verifyHash, verifySecret } from "../services/apiKeys.js";
import { logger } from "../utils/logger.js";

export type McpAuthResult =
  | { status: "unconfigured" }
  | { status: "unauthorized" }
  | { status: "ok"; organizationId: number | null };

/** Matches the public-API token format from server/services/apiKeys.ts. */
const AK_TOKEN_RE = /^ak_(?:live|test)_[A-Za-z0-9_-]{16,}$/;

const BEARER_RE = /^Bearer\s+(.+)$/i;

export function extractBearerToken(authorizationHeader: string): string {
  const m = BEARER_RE.exec(authorizationHeader.trim());
  return m?.[1]?.trim() ?? "";
}

export async function resolveMcpAuth(
  authorizationHeader: string,
): Promise<McpAuthResult> {
  const token = extractBearerToken(authorizationHeader);

  // ── Path 1: per-org API key ────────────────────────────────────────────
  if (AK_TOKEN_RE.test(token)) {
    try {
      const { db } = await import("../db.js");
      const { apiKeys } = await import("@shared/schema");
      const { and, eq, isNull } = await import("drizzle-orm");

      const hashed = hashApiKey(token);
      const [row] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.hashedKey, hashed), isNull(apiKeys.revokedAt)))
        .limit(1);

      if (!row) return { status: "unauthorized" };
      // Timing-safe re-compare (defense-in-depth, mirrors requireApiKey.ts).
      if (!verifyHash(hashed, row.hashedKey)) return { status: "unauthorized" };
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        return { status: "unauthorized" };
      }
      return { status: "ok", organizationId: row.organizationId };
    } catch (err) {
      // Never log the token. Lookup failure is treated as unauthorized.
      logger.error(
        "[mcp] api-key auth lookup failed",
        err instanceof Error ? err : undefined,
      );
      return { status: "unauthorized" };
    }
  }

  // ── Path 2: static MCP_API_KEY bound to MCP_ORG_ID ─────────────────────
  const staticKey = process.env.MCP_API_KEY;
  if (!staticKey) {
    // Not configured — block all access until a key is set (or the caller
    // presents a valid per-org ak_ key, handled above).
    return { status: "unconfigured" };
  }
  if (!token || !verifySecret(token, staticKey)) {
    return { status: "unauthorized" };
  }

  const rawOrgId = process.env.MCP_ORG_ID;
  const parsed = rawOrgId ? Number.parseInt(rawOrgId, 10) : Number.NaN;
  return {
    status: "ok",
    organizationId: Number.isFinite(parsed) ? parsed : null,
  };
}
