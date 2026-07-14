/**
 * Agent Codenames — single source of truth for the modern 13-member roster
 * AND the legacy codenames that still exist throughout older code paths.
 *
 * Phase 6 of the AcreOS-Solene migration introduces a GitHub-style harmonious
 * merge: legacy codenames (atlas_cto, sophie_csm, forge_revenue, oracle) stay
 * routable, but are quietly aliased to the canonical modern roster via the
 * agentCodenameAlias service. Both legacy + canonical work in parallel during
 * the natural 60-90 day migration window.
 *
 * This file is consumed by:
 *   - server/services/agentCodenameAlias.ts (resolution + dedupe + counters)
 *   - server/services/agentActionExecutors.ts (entry-point alias resolution)
 *   - future deprecation-watch tooling
 */

/** Canonical team-member codenames (the modern roster). */
export const CANONICAL_AGENT_CODENAMES = [
  "solene",
  "iris",
  "soren",
  "beatrice",
  "krieger",
  "maren",
  "lena",
  "rafe",
  "andrei",
  "tess",
  "iyari",
  "quinn",
  "henrik",
] as const;
export type CanonicalAgentCodename = (typeof CANONICAL_AGENT_CODENAMES)[number];

/** Legacy codenames still referenced in older code paths. */
export const LEGACY_AGENT_CODENAMES = [
  "atlas_cto",
  "atlas",
  "sophie_csm",
  "sophie",
  "forge_revenue",
  "forge",
  "oracle",
  // Kernel restructure step 4 (2026-07-14): the remaining companyAgents.ts
  // roster codenames, previously unbridged — an unbridged name silently
  // fell back to iris at the resolver. Bridging completes the alias layer
  // so the eventual fork retirement is a data migration, not a guess.
  "beacon_marketing",
  "sentinel_devops",
  "ledger_finance",
  "shield_legal",
  "oracle_analytics",
  "compass_pm",
  "crucible_qa",
  "prism_ux",
  "scribe_content",
] as const;
export type LegacyAgentCodename = (typeof LEGACY_AGENT_CODENAMES)[number];

/**
 * Alias map: legacy → canonical (default routing).
 *
 * Notes:
 *  - atlas/atlas_cto → iris  (CTO domain)
 *  - sophie/sophie_csm → rafe  (Customer Success / CCO Phase 2)
 *  - forge/forge_revenue → soren  (revenue acquisition default; per-action
 *    overrides may route to maren — see LEGACY_ACTION_AWARE_ALIAS).
 *  - oracle → iris  (Iyari is dormant until Phase 3; iris owns perf
 *    prediction as a graceful fallback in the meantime).
 */
export const LEGACY_TO_CANONICAL_ALIAS: Record<
  LegacyAgentCodename,
  CanonicalAgentCodename
> = {
  atlas_cto: "iris",
  atlas: "iris",
  sophie_csm: "rafe",
  sophie: "rafe",
  forge_revenue: "soren",
  forge: "soren",
  oracle: "iris",
  // Step-4 completions, mapped by roster domain
  // (docs/internal/team-roster-overview.md):
  beacon_marketing: "soren", // brand / content / acquisition
  sentinel_devops: "iris", // engineering / deploys
  ledger_finance: "lena", // capital allocation / unit economics
  shield_legal: "beatrice", // compliance / legal / security
  oracle_analytics: "iris", // analytics / perf prediction (matches oracle)
  compass_pm: "maren", // product strategy / prioritization
  crucible_qa: "krieger", // customer-surface test matrices
  prism_ux: "krieger", // customer-surface UX
  scribe_content: "soren", // content
};

/**
 * Action-aware override: for some legacy codenames, the right modern agent
 * depends on the action being executed.
 *
 * Example: forge's "send_alert" fits Soren (acquisition / general nudges);
 * forge's "send_churn_intervention" / "flag_deal_risk" fit Maren (retention).
 *
 * Lookup precedence in resolveCodename:
 *   1. LEGACY_ACTION_AWARE_ALIAS[legacy][action]  (if present)
 *   2. LEGACY_TO_CANONICAL_ALIAS[legacy]          (default)
 */
export const LEGACY_ACTION_AWARE_ALIAS: Record<
  string,
  Partial<Record<string, CanonicalAgentCodename>>
> = {
  forge_revenue: {
    send_churn_intervention: "maren",
    flag_deal_risk: "maren",
    escalate_to_founder: "soren",
    send_alert: "soren",
  },
  forge: {
    send_churn_intervention: "maren",
    flag_deal_risk: "maren",
    escalate_to_founder: "soren",
    send_alert: "soren",
  },
};

/**
 * Reverse lookup — canonical → list of legacy codenames that route to it.
 * Used by the deprecation-watch script (future).
 */
export const CANONICAL_TO_LEGACY_REVERSE: Record<
  CanonicalAgentCodename,
  LegacyAgentCodename[]
> = (() => {
  const reverse: Partial<Record<CanonicalAgentCodename, LegacyAgentCodename[]>> = {};
  for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL_ALIAS) as Array<
    [LegacyAgentCodename, CanonicalAgentCodename]
  >) {
    if (!reverse[canonical]) reverse[canonical] = [];
    reverse[canonical]!.push(legacy);
  }
  // Initialize all canonical keys (even those with no legacy aliases) for
  // exhaustive typing.
  const full: Record<CanonicalAgentCodename, LegacyAgentCodename[]> = {} as Record<
    CanonicalAgentCodename,
    LegacyAgentCodename[]
  >;
  for (const canonical of CANONICAL_AGENT_CODENAMES) {
    full[canonical] = reverse[canonical] ?? [];
  }
  return full;
})();
