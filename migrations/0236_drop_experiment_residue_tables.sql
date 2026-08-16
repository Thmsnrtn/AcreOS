-- ============================================================================
-- 0236_drop_experiment_residue_tables.sql
-- Founder ruling (picker, 2026-08-16): "Triage 3 ways, drop only experiment
-- residue."
-- ----------------------------------------------------------------------------
-- WHAT THIS IS
-- ────────────
-- `scripts/lint-reachability.mjs --measure` reports 62 tables with no writer
-- and 75 with no reader; the INTERSECTION — no writer AND no reader anywhere in
-- code — is 48 tables. All 48 were triaged three ways and the full triage is
-- written down in `docs/company/deletion-ledger.md` (section "2026-08-16 —
-- 48-table dead-storage triage"). This migration drops the CLASS A subset and
-- nothing else.
--
-- CLASS A is the narrow set: storage left behind by a module the deletion
-- ledger ALREADY RECORDS AS KILLED, holding no customer content — derived agent
-- state, internal scoring, AcreOS's own experiment metrics. Thirteen tables
-- qualify and are dropped here. Class B (customer or regulated records) and
-- class C (unclear) are NOT dropped: customer-data deletion is a founder-only
-- hard stop and this ruling did not authorise it.
--
-- PROVENANCE, per table — every one traceable to a ledger row:
--
--   agent_improvement_plans, agent_synergy_map
--     Deletion ledger, 2026-08-06 (Founder narrative routers V6–V14 row): the
--     v6/v7/v8 ROUTERS and the three services they solely owned — including
--     `agentSelfImprovement` and `agentSynergyMap` — were deleted with their 17
--     retired founder components (AgentGrowth.tsx, SynergyMap.tsx). Rows are
--     per-AGENT goals, skill requests and agent-pair collaboration scores. No
--     organization_id, no customer content.
--
--   playbook_evolutions
--     Deletion ledger, 2026-08-14 (B19 class 3): `playbookEvolutionV9` deleted;
--     the ratchet note had explicitly predicted this table would be revealed.
--     Rows are champion/challenger A-B mutation records for agent playbooks.
--
--   compass_recommendations   (writer: compassAutoRecommendV9)
--   spend_watchers            (writer: spendAutonomyV9)
--   spend_optimizations       (writer: spendAutonomyV9)
--   causal_investigations     (writer: causalReasoningV9)
--   delegated_goals           (writer: delegationDepthV9)
--   external_intelligence     (writer: externalIntelligenceV9)
--     Deletion ledger, 2026-08-14 (B19 class 3, founder ruling "Delete classes
--     2 and 3 now"). All six were named in that entry's own DELETION-REVEALED
--     list and queued for this decision. Content is AcreOS's INTERNAL operating
--     state: agent mode suggestions to the founder, AcreOS's own vendor spend
--     figures, internal anomaly root-cause analyses, agent-to-agent goal
--     cascades, competitor/market notes. None is org-scoped; none holds a
--     customer row.
--
--   product_specifications, build_buy_decisions, feature_impact_scores
--     Deletion ledger, 2026-08-15 (B19 orphan triage, founder ruling "Delete
--     all 15"). Only writer was `productEvolutionEngine.ts`, deleted as a
--     FABRICATOR (build estimates derived from `gap.length` — a string length).
--     Content is AcreOS's own roadmap: its specs, its build-vs-buy analyses,
--     its own feature adoption scores.
--
--   automation_executions
--     Deletion ledger, 2026-07-29 ("/automation rules twin", Wave A). The dead
--     parallel automation surface was deleted because it had NO EXECUTION
--     ENGINE: that entry records `createAutomationExecution` as having ZERO
--     call sites, so this log can never have held a row. The entry says in so
--     many words that the tables "remain in shared/schema.ts pending a drop
--     migration (execution rule 2)". Only the EXECUTION LOG is dropped here.
--     `automation_rules` is NOT dropped — see below.
--
-- WHAT IS DELIBERATELY *NOT* DROPPED, and why, because the omissions are the
-- part a later reader will question:
--
--   automation_rules — same ledger row, same KILL, but the rows are
--     CUSTOMER-AUTHORED (name, description, conditions, actions, created_by,
--     organization_id). Customers authored rules that could never run; the
--     rules are still their words. Class B.
--
--   agent_playbooks — class A by content (agent SOPs, no org key, writer
--     deleted 2026-08-14) but NOT DROPPABLE HERE: two tables that are neither
--     writer-less nor reader-less hold foreign keys into it —
--     `institutional_patterns.linked_playbook_id` and
--     `signal_correlations.auto_trigger_playbook_id`. Dropping it means
--     altering two LIVE tables, which is a larger change than "drop experiment
--     residue" authorises.
--
--   scp_evolution_metrics — class A by content, but
--     `server/services/scpGoldenSuite.ts` still names the identifier in its
--     import list (an unused import; the symbol appears nowhere else in that
--     file). Removing the schema export without that one-token edit breaks the
--     build, and that file is outside this unit's file set.
--
--   tax_strategies, tax_forecast_scenarios, opportunity_zone_holdings,
--   auth_fail_attempts, tutor_sessions, tenant_metrics — the founder queue
--     carried these as drop candidates; reading their COLUMNS moved them out of
--     class A. Reasons per table are in the deletion-ledger triage.
--
-- HONESTY NOTE ON WHAT THIS ACTUALLY DELETES IN PRODUCTION
-- ───────────────────────────────────────────────────────
-- Twelve of these thirteen have NO `CREATE TABLE` in `migrations/*.sql` or in
-- `scripts/migrate.mjs` — that is exactly why they sit in
-- `scripts/schema-migrate-mirror.allowlist.json`, whose gate note records that
-- `db:push` is NOT run in prod. So for twelve of them this DROP is expected to
-- be a no-op against a table that was never created, and the real deletion is
-- the removal of the `pgTable` definitions from `shared/schema.ts`. The one
-- exception is `automation_executions`, created by
-- `migrations/0001_brief_giant_man.sql`, which does exist in prod and whose
-- writer the 2026-07-29 wave records as never having had a call site.
--
-- IDEMPOTENCY
-- ───────────
-- `scripts/migrate.mjs` is the Fly `release_command` and re-runs on EVERY
-- deploy, so every statement is `DROP TABLE IF EXISTS` and a second run is a
-- no-op. Mirrored statement-for-statement in `scripts/migrate.mjs` — a
-- migration file nothing runs is this repo's most common defect.
--
-- NO `CASCADE` ANYWHERE, deliberately: `CASCADE` would silently take dependent
-- objects this ruling never named. If one of these DROPs ever fails on a
-- dependency, that dependency is news and must be adjudicated, not swallowed.
-- Verified before writing this file: `rg "REFERENCES <table>"` over
-- `migrations/` + `scripts/migrate.mjs` returns 0 for all thirteen, and the
-- drizzle `.references(() => …)` scan over `shared/` + `server/` returns 0
-- inbound references for all thirteen.
--
-- ORDER: children before parents, so no CASCADE is needed. Both outbound FKs
-- point at tables that SURVIVE (`playbook_evolutions` → `agent_playbooks`,
-- `automation_executions` → `automation_rules`), so the order below only has
-- to be internally consistent.
--
-- Mirrors the removal of these thirteen `pgTable` definitions from
-- `shared/schema.ts`. table-count ratchet 763 -> 750.
-- ============================================================================

-- ── Agent self-improvement / narrative-suite residue (ledger 2026-08-06) ─────
DROP TABLE IF EXISTS "playbook_evolutions";
DROP TABLE IF EXISTS "agent_improvement_plans";
DROP TABLE IF EXISTS "agent_synergy_map";

-- ── V9 experiment residue (ledger 2026-08-14, B19 classes 2+3) ──────────────
DROP TABLE IF EXISTS "compass_recommendations";
DROP TABLE IF EXISTS "spend_watchers";
DROP TABLE IF EXISTS "spend_optimizations";
DROP TABLE IF EXISTS "causal_investigations";
DROP TABLE IF EXISTS "delegated_goals";
DROP TABLE IF EXISTS "external_intelligence";

-- ── productEvolutionEngine residue (ledger 2026-08-15, B19 orphan triage) ───
DROP TABLE IF EXISTS "product_specifications";
DROP TABLE IF EXISTS "build_buy_decisions";
DROP TABLE IF EXISTS "feature_impact_scores";

-- ── The execution log of an engine that never existed (ledger 2026-07-29) ───
-- Child of automation_rules, which is NOT dropped (customer-authored rows).
DROP TABLE IF EXISTS "automation_executions";
