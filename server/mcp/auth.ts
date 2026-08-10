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

// ─── Availability policy (audit §8.2 / Wave 0.7) ────────────────────────────
//
// Founder env controls covering BOTH MCP surfaces (POST /api/mcp streamable
// AND the POST/GET /mcp stdio-shaped mount in server/index.ts — the 0.7
// completeness audit caught that hardening only one of the two left the kill
// switch a half-truth). Defaults preserve current behavior (enabled, all
// orgs); flipping them is a founder decision, queued in the ledger.

export function isTruthyEnv(v: string | undefined): boolean {
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  if (t === "1" || t === "true") return true;
  if (t.length > 0) {
    // A kill switch that silently no-ops on "yes"/"on" is worse than none.
    logger.warn("[mcp] unrecognized boolean env value — treating as false", {
      metadata: { value: v },
    });
  }
  return false;
}

/** True when the founder has darkened every MCP surface. */
export function mcpEndpointDark(): boolean {
  return isTruthyEnv(process.env.MCP_PUBLIC_DISABLED);
}

/**
 * Parse MCP_ORG_ALLOWLIST ("1,7,42") → Set of org ids; null when unset
 * (all orgs). Set-but-unparseable FAILS CLOSED (empty set = deny all) —
 * a restriction control must not evaporate on a typo.
 */
export function parseOrgAllowlist(raw: string | undefined): Set<number> | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const ids = entries
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) {
    logger.error(
      "[mcp] MCP_ORG_ALLOWLIST is set but contains no valid org ids — denying all orgs (fail closed)",
    );
    return new Set();
  }
  if (ids.length < entries.length) {
    logger.warn("[mcp] MCP_ORG_ALLOWLIST contains invalid entries — ignoring them", {
      metadata: { raw },
    });
  }
  return new Set(ids);
}

/**
 * Allowlist verdict for an authed org binding. A null binding (static key
 * with no MCP_ORG_ID) is DENIED whenever an allowlist is set — only listed
 * orgs pass a narrowing control.
 */
export function mcpOrgAllowed(orgId: number | null): boolean {
  const allowlist = parseOrgAllowlist(process.env.MCP_ORG_ALLOWLIST);
  if (allowlist === null) return true;
  return orgId !== null && allowlist.has(orgId);
}

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
