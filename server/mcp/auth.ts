/**
 * MCP availability policy — the founder controls over the MCP surface.
 *
 * HISTORY. This file used to be the AUTH module for a second MCP endpoint:
 * the POST/GET `/mcp` mount in server/index.ts. That surface was RETIRED by
 * founder ruling R-1 (2026-08-11) and its auth resolver (`resolveMcpAuth`)
 * went with it. The reason is the whole point of this note: `resolveMcpAuth`
 * accepted a per-org `ak_live_…`/`ak_test_…` key, resolved its
 * `organizationId`, and NEVER read its `scopes` column — so a zero-scope key
 * reached all 29 tools of that surface for its org, while the very same
 * credential is gated per-tool on /api/mcp
 * (server/mcp/safeIntents.ts::keyMaySatisfyIntent). One credential, two
 * ladders. The founder removed the shorter ladder rather than lengthening it.
 *
 * Retired with it: the static `MCP_API_KEY` env lane. A scope-less env secret
 * has nothing to check against a per-tool scope ladder, so it cannot be
 * repointed at /api/mcp — /api/mcp's `authenticate()` accepts `ak_`-shaped
 * per-org keys only. Claude Desktop users now configure an org API key
 * (Settings → API keys) whose granted scopes decide which tools they see.
 *
 * WHAT REMAINS HERE, and it is NOT orphaned: the Wave 0.7 availability
 * controls. They were written to cover both surfaces; there is one surface
 * left, POST /api/mcp, and server/mcp/streamableHttp.ts enforces both of them
 * on every request — the kill switch before auth, the allowlist after it.
 */

import { logger } from "../utils/logger.js";

// ─── Availability policy (audit §8.2 / Wave 0.7) ────────────────────────────
//
// Founder env controls over the MCP surface. Wave 0.7 wrote them to cover BOTH
// endpoints because hardening only one of two left the kill switch a
// half-truth; R-1 retired the second endpoint, so "both" is now "the one" —
// POST /api/mcp, enforced in server/mcp/streamableHttp.ts. Defaults preserve
// current behavior (enabled, all orgs); flipping them is a founder decision,
// queued in the ledger.

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
 * Allowlist verdict for an authed org binding. The surviving surface always
 * resolves a real org from the presented key, so `null` no longer arises in
 * production — it is still DENIED whenever an allowlist is set, because a
 * narrowing control must not admit an unidentified caller.
 */
export function mcpOrgAllowed(orgId: number | null): boolean {
  const allowlist = parseOrgAllowlist(process.env.MCP_ORG_ALLOWLIST);
  if (allowlist === null) return true;
  return orgId !== null && allowlist.has(orgId);
}
