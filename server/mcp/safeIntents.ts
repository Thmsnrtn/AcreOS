/**
 * Tahoe E12 — MCP safe-intent subset + scope mapping.
 *
 * The MCP endpoint (POST /api/mcp) exposes AcreOS as a tool surface callable
 * by OTHER AI agents (agentic-web prep). External agents are far less trusted
 * than the in-product Pax loop, so we deliberately expose only a SAFE,
 * READ-MOSTLY slice of the App Intent registry — never the full catalog.
 *
 * Single source of truth: the App Intent registry (Tahoe H4). Each intent
 * already carries name / description / inputSchema / door / requiredScope /
 * approvalRequired. We derive the external tool list by FILTERING that
 * registry — we never hand-maintain a second list.
 *
 * Safety gate (an intent is external-callable iff ALL hold):
 *   1. approvalRequired === false   — no human-approval-gated actions.
 *   2. requiredScope is null OR a read-only scope (ends in "_read").
 *      → every "_write" intent (create/update/send/generate/trigger) is
 *        excluded automatically. This is the core "read-mostly" guarantee.
 *   3. The intent name is not on the explicit external deny-list (defence in
 *      depth against a future read-scoped-but-sensitive intent).
 *
 * Founder-only intents never reach here: this registry is the CUSTOMER
 * registry (persona separation, project_persona_architecture.md) — founder
 * surfaces (Sophie/Forge/Atlas) are a different code path entirely.
 *
 * Per-call authorization: the API key carries public ApiScope grants
 * (leads:read, properties:read, deals:read, notes:read, …). Each intent's
 * role-Scope is mapped to the ApiScope(s) that authorize it, and a tool call
 * is rejected unless the calling key holds a satisfying scope. This keeps the
 * MCP surface gated by the same key-scope ladder as /api/v1/*.
 */

import type { AppIntent } from "../services/appIntents";
import { listIntents } from "../services/appIntents";
import type { Scope } from "../middleware/roleScope";
import type { ApiScope } from "../services/apiKeys";

/**
 * Explicit deny-list: intents that would pass the structural filter but must
 * never be exposed to external agents regardless. The structural filter
 * already excludes every write/approval intent; this is a hard stop so a
 * future read-only-but-sensitive intent can be blocked by name without
 * weakening the general rule.
 */
const EXTERNAL_DENY = new Set<string>([
  // Arbitrary outbound web fetch — not appropriate to hand to external agents.
  "browse_web",
]);

/** A role-Scope is read-only if it is null or ends in "_read". */
function isReadOnlyScope(scope: Scope | null): boolean {
  return scope === null || scope.endsWith("_read");
}

/**
 * Is this intent safe to expose to external MCP agents?
 * Exported so the unit test can assert the rule directly.
 */
export function isExternalSafeIntent(intent: AppIntent): boolean {
  if (intent.approvalRequired) return false;
  if (!isReadOnlyScope(intent.requiredScope)) return false;
  if (EXTERNAL_DENY.has(intent.name)) return false;
  return true;
}

/** The filtered, external-safe subset of the registry. */
export function listExternalSafeIntents(): AppIntent[] {
  return listIntents().filter(isExternalSafeIntent);
}

/**
 * Map an intent's role-Scope (roleScope.ts vocabulary) to the set of public
 * ApiScopes (apiKeys.ts vocabulary) that authorize calling it. A key holding
 * ANY one of the returned scopes is permitted. `door` disambiguates which
 * read-domain a generic `deal_read` belongs to:
 *   today/map  → properties / generic deals read
 *   deals      → leads + deals read
 *   finance    → notes read
 *
 * Returns an empty array for intents whose role-Scope is null — those are
 * ungated reads (e.g. get_system_context, calculators) and need no API scope.
 */
export function requiredApiScopesFor(intent: AppIntent): ApiScope[] {
  const scope = intent.requiredScope;
  if (scope === null) return [];

  switch (scope) {
    case "deal_read":
      switch (intent.door) {
        case "deals":
          return ["deals:read", "leads:read"];
        case "map":
        case "today":
          return ["properties:read", "deals:read"];
        default:
          return ["deals:read"];
      }
    case "financial_read":
      return ["notes:read"];
    case "comms_read":
      // No dedicated comms ApiScope in v0; gate behind deals:read (message
      // history is deal-adjacent).
      return ["deals:read"];
    case "audit_read":
      // No external audit scope — require deals:read at minimum.
      return ["deals:read"];
    default:
      // Any other (write/PII) scope should never reach here — the safe filter
      // already excluded it. Fail closed with an unsatisfiable requirement.
      return ["__never__" as ApiScope];
  }
}

/**
 * Does a key holding `grantedScopes` satisfy the authorization for `intent`?
 * Null-scope intents (ungated reads) are always satisfied.
 */
export function keyMaySatisfyIntent(
  intent: AppIntent,
  grantedScopes: readonly string[],
): boolean {
  const required = requiredApiScopesFor(intent);
  if (required.length === 0) return true; // ungated read
  return required.some((s) => grantedScopes.includes(s));
}
