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
 *   1. The intent is on EXTERNAL_ALLOW, the reviewed list of bounded reads.
 *   2. approvalRequired === false   — no human-approval-gated actions.
 *   3. requiredScope is null OR a read-only scope (ends in "_read").
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
 * The POSITIVE allowlist: the only intents an external agent may see or call,
 * each reviewed as a bounded read of the org's own records — no row written,
 * no agent run, no provider spend, no outbound call.
 *
 * It replaced a deny-list over a structural rule ("scope is null or ends in
 * _read"), which exposed `remember_fact` (writes a Pax memory row) and
 * `spawn_subagent` (runs a billed LLM loop) to a key holding NO scopes — both
 * had `scope: null`, which the rule read as "read-only" — along with reads
 * that spend (`run_comps*`, `propstream_*`, `get_property_enrichment`,
 * `research_property`) or reach third-party accounts (`search_gmail`,
 * `get_drive_file`, Stripe). A new intent is external only when it is added
 * here, on purpose (quality directive 2026-09-29).
 */
const EXTERNAL_ALLOW = new Set<string>([
  "get_system_context",
  "get_dashboard_stats",
  "get_tasks",
  "recall_facts",
  "get_properties",
  "get_property_details",
  "get_leads",
  "get_lead_details",
  "get_pipeline_summary",
  "get_deals",
  "get_stale_leads",
  "get_notes",
  "get_cashflow_summary",
  "calculate_amortization",
  "calculate_roi",
  "calculate_payment_schedule",
]);

/**
 * The four allowlisted intents with no role scope read org-wide context, so
 * each names the read scopes a key must hold ALL of. "Any read scope" let a
 * notes-only key read recent lead names through get_system_context (audit of
 * 60ebfd9). `retrieve_land_knowledge` left the list in the same audit: with
 * its flag on it calls a paid embeddings provider on AcreOS's key.
 */
const NULL_SCOPE_REQUIRES_ALL: Readonly<Record<string, readonly ApiScope[]>> = {
  get_system_context: ["leads:read", "deals:read", "properties:read"],
  get_dashboard_stats: ["leads:read", "deals:read", "properties:read"],
  get_tasks: ["leads:read", "deals:read"],
  recall_facts: ["leads:read", "deals:read", "properties:read"],
};

/** A role-Scope is read-only if it is null or ends in "_read". */
function isReadOnlyScope(scope: Scope | null): boolean {
  return scope === null || scope.endsWith("_read");
}

/**
 * Is this intent safe to expose to external MCP agents?
 * Exported so the unit test can assert the rule directly.
 */
export function isExternalSafeIntent(intent: AppIntent): boolean {
  if (!EXTERNAL_ALLOW.has(intent.name)) return false;
  // Defence in depth: an allowlisted name that becomes approval-gated or
  // write-scoped drops out rather than being exposed.
  if (intent.approvalRequired) return false;
  if (!isReadOnlyScope(intent.requiredScope)) return false;
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
 * A null role-Scope is NOT ungated here: such an intent names the read
 * scopes it needs ALL of (NULL_SCOPE_REQUIRES_ALL); one it does not name is
 * unsatisfiable. A key with no scopes calls nothing.
 */
export function requiredApiScopesFor(intent: AppIntent): ApiScope[] {
  const scope = intent.requiredScope;
  if (scope === null) return [...(NULL_SCOPE_REQUIRES_ALL[intent.name] ?? [])];

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

/** Does a key holding `grantedScopes` satisfy the authorization for `intent`? */
export function keyMaySatisfyIntent(
  intent: AppIntent,
  grantedScopes: readonly string[],
): boolean {
  const required = requiredApiScopesFor(intent);
  if (required.length === 0) return false;
  // Null role-scope: every named read scope; otherwise any one of them.
  return intent.requiredScope === null
    ? required.every((s) => grantedScopes.includes(s))
    : required.some((s) => grantedScopes.includes(s));
}
