/**
 * Schema ↔ migration drift ratchet (2026-07 DB audit).
 *
 * This repo's only migration path is scripts/migrate.mjs (idempotent SQL,
 * run as Fly's release_command) — the drizzle journal was retired 2026-05-11.
 * The audit found ~95 tables defined in shared/schema*.ts with NO CREATE
 * TABLE anywhere: on a fresh database the first SELECT against any of them
 * 500s (this bit prod once already — see migrate.mjs's own header).
 *
 * The frozen BASELINE below is that historical debt. The rules:
 *   1. A NEW pgTable must ship with a CREATE TABLE in migrations/ or
 *      migrate.mjs — the first test fails the moment one doesn't.
 *   2. When an orphan gets its migration (or is deleted), remove it from
 *      the baseline — the second test forces the shrink to be locked in.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../..");

function schemaTableNames(): Set<string> {
  const files = [resolve(ROOT, "shared/schema.ts")];
  for (const f of readdirSync(resolve(ROOT, "shared/schema"))) {
    if (f.endsWith(".ts")) files.push(resolve(ROOT, "shared/schema", f));
  }
  const names = new Set<string>();
  const re = /pgTable\(\s*["']([a-z0-9_]+)["']/g;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

function createdTableNames(): Set<string> {
  const files = [resolve(ROOT, "scripts/migrate.mjs")];
  for (const f of readdirSync(resolve(ROOT, "migrations"))) {
    if (f.endsWith(".sql")) files.push(resolve(ROOT, "migrations", f));
  }
  const names = new Set<string>();
  const re = /CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?/gi;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[1].toLowerCase());
  }
  return names;
}

// Historical debt frozen 2026-07-04 (95 tables). Only ever REMOVE lines.
const BASELINE_ORPHANS = new Set<string>([
  "agent_action_log",
  "agent_action_undo_log",
  "agent_budget_envelopes",
  "agent_conversations",
  "agent_debates",
  "agent_goals",
  "agent_improvement_plans",
  "agent_initiatives",
  "agent_override_learnings",
  "agent_performance_reviews",
  "agent_playbooks",
  "agent_prompt_evolutions",
  "agent_spawn_proposals",
  "agent_synergy_map",
  "agent_workflow_runs",
  "agent_workflows",
  "attention_insights",
  "autonomy_score_snapshots",
  "board_decisions",
  "board_meetings",
  "board_votes",
  "build_buy_decisions",
  "cascade_resolutions",
  "causal_investigations",
  "ceo_absence_mode",
  "ceo_briefings",
  "company_agents",
  "company_briefing_cache",
  "company_chronicle",
  "company_priorities",
  "company_seasons",
  "compass_recommendations",
  "constitutional_principles",
  "content_drafts",
  "contract_templates",
  "county_reviews",
  "crisis_playbooks",
  "custom_autonomy_rules",
  "daily_deal_feed",
  "deal_feed_interactions",
  "decision_patterns",
  "delegated_goals",
  "entity_comments",
  "error_boundary_trips",
  "evolution_circuit_breaker",
  "evolution_history",
  "external_intelligence",
  "feature_impact_scores",
  "feedback_learnings",
  "financial_approvals",
  "founder_briefs",
  "founder_dependency_events",
  "founder_drafts",
  "founder_intents",
  "founder_overrides",
  "founder_twin_context",
  "founder_wellbeing",
  "institutional_patterns",
  "intent_progress_logs",
  "lead_emails",
  "legal_actions",
  "market_adaptations",
  "meta_learning_insights",
  "mission_statements",
  "openrouter_model_catalog",
  "outcome_verification_queue",
  "perpetual_ops_checks",
  "personal_bests",
  "platform_issues",
  "playbook_evolutions",
  "processed_feedback",
  "product_specifications",
  "provider_cache",
  "quiet_hours_config",
  "reaction_chain_links",
  "reaction_chain_runs",
  "reaction_chains",
  "regulatory_feeds",
  "regulatory_filing_calendar",
  "self_audit_reports",
  "shared_deal_links",
  "signal_correlations",
  "spend_anomalies",
  "spend_optimizations",
  "spend_watchers",
  "strategic_compass",
  "strategic_plans",
  "trust_evolution_log",
  "user_activation_events",
  "user_feedback",
  "user_sessions",
  "war_room_messages",
  "war_rooms",
  "webhook_deliveries",
]);

describe("schema ↔ migration drift ratchet", () => {
  const schema = schemaTableNames();
  const created = createdTableNames();
  const orphans = [...schema].filter((t) => !created.has(t));

  it("every NEW pgTable ships with a CREATE TABLE migration", () => {
    const newOrphans = orphans.filter((t) => !BASELINE_ORPHANS.has(t));
    expect(
      newOrphans,
      `tables defined in shared/schema*.ts with NO migration (add a CREATE TABLE to scripts/migrate.mjs + migrations/): ${newOrphans.join(", ")}`,
    ).toEqual([]);
  });

  it("baseline only shrinks — remove entries whose migrations landed", () => {
    const stale = [...BASELINE_ORPHANS].filter((t) => !orphans.includes(t));
    expect(
      stale,
      `baseline entries no longer orphaned (migration landed or table deleted) — remove them: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("sanity: the scanner actually finds tables on both sides", () => {
    expect(schema.size).toBeGreaterThan(500);
    expect(created.size).toBeGreaterThan(400);
  });
});
