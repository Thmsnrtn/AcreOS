# AcreOS Data Dictionary

> Generated 2026-08-02 by static analysis of every `pgTable` definition in the repo
> (extraction script + reference counting; method and raw JSON preserved in the Phase 0 audit scratchpad,
> re-runnable via the approach described in `docs/audit/PLATFORM-AUDIT.md` §3). This is a **code-side**
> dictionary: it reflects what the schema declares and what the codebase references, not the live database.
> Liveness = referenced by runtime (non-test) code outside the schema files themselves.

## Totals

| Metric | Count |
|---|---|
| pgTable definitions | **748** |
| Live (runtime-referenced) | 714 |
| Test-only | 1 |
| Dead (zero references outside schema files) | 33 |
| Tables with zero FK constraints | 372 (49%) |
| Org-scoped tables | 400 (organizationId 349 / orgId 46 / tenantId 5) |
| **Live tables with no CREATE in either DDL path** | **91** (exist in prod only via Replit-era `drizzle-kit push`; a fresh environment lacks them) |

## Reading the table

`Org` = tenant column present. `FK` = declares at least one `.references()`. `Idx` = declares at least one index.
`DDL` = where a CREATE TABLE exists: `mig` (migrations/), `mjs` (scripts/migrate.mjs — the path production actually runs), `both`, or `NONE`.
`Refs` = runtime files referencing the table.

## `shared/schema.ts` (499 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `ab_test_variants` | 5046 | 22 | — | yes | — | mig | 2 | live |
| `ab_tests` | 5020 | 15 | yes | yes | — | mig | 3 | live |
| `action_previews` | 13988 | 17 | — | — | yes | mjs | 1 | live |
| `activation_events` | 5922 | 6 | yes | yes | yes | both | 4 | live |
| `activity_events` | 4901 | 11 | yes | yes | — | mig | 1 | live |
| `activity_log` | 2156 | 12 | yes | yes | — | mig | 20 | live |
| `ad_creative_bundles` | 14249 | 9 | — | yes | — | mig | 1 | live |
| `ad_postings` | 3151 | 25 | yes | yes | — | mig | 1 | live |
| `adjacent_verticals_waitlist` | 18233 | 4 | — | — | — | mjs | 1 | live |
| `agent_action_graduations` | 14813 | 12 | — | — | yes | mig | 4 | live |
| `agent_action_log` | 14940 | 21 | — | — | yes | **NONE** | 28 | live |
| `agent_action_undo_log` | 15091 | 10 | — | yes | yes | **NONE** | 2 | live |
| `agent_budget_envelopes` | 17600 | 9 | — | — | yes | **NONE** | 1 | live |
| `agent_calibration_history` | 16116 | 13 | — | — | yes | mig | 2 | live |
| `agent_channel_messages` | 14887 | 11 | — | — | yes | both | 3 | live |
| `agent_configs` | 1801 | 9 | yes | yes | — | mig | 1 | live |
| `agent_conversations` | 14999 | 8 | — | — | yes | **NONE** | 2 | live |
| `agent_debates` | 15619 | 14 | — | — | yes | **NONE** | 2 | live |
| `agent_delegations` | 17006 | 14 | yes | — | yes | mig | 2 | live |
| `agent_dialogues` | 16970 | 12 | yes | — | yes | mig | 2 | live |
| `agent_episodic_memory` | 16814 | 15 | yes | — | yes | mig | 2 | live |
| `agent_events` | 2031 | 9 | yes | yes | — | mig | 37 | live |
| `agent_execution_counts` | 13628 | 4 | — | — | yes | both | 0 | **DEAD** |
| `agent_feedback` | 1903 | 8 | yes | yes | — | mig | 1 | live |
| `agent_goals` | 14978 | 13 | — | — | yes | **NONE** | 2 | live |
| `agent_health_baselines` | 17069 | 10 | — | — | yes | mig | 2 | live |
| `agent_improvement_plans` | 15430 | 9 | — | yes | yes | **NONE** | 1 | live |
| `agent_initiatives` | 15216 | 13 | — | — | yes | **NONE** | 5 | live |
| `agent_llm_traces` | 17834 | 16 | yes | yes | yes | both | 11 | live |
| `agent_memory` | 1880 | 10 | yes | yes | — | mig | 10 | live |
| `agent_memory_notes` | 13703 | 9 | — | — | yes | mjs | 1 | live |
| `agent_negotiations` | 16241 | 17 | — | — | yes | mig | 1 | live |
| `agent_override_learnings` | 15072 | 11 | — | — | yes | **NONE** | 2 | live |
| `agent_performance_reviews` | 15249 | 13 | — | — | yes | **NONE** | 4 | live |
| `agent_playbooks` | 15286 | 18 | — | — | yes | **NONE** | 2 | live |
| `agent_prompt_evolutions` | 17816 | 11 | — | — | — | **NONE** | 5 | live |
| `agent_proposal_observations` | 14843 | 14 | — | — | yes | mig | 3 | live |
| `agent_reputation_votes` | 17029 | 10 | yes | — | yes | mig | 1 | live |
| `agent_resource_quotas` | 16399 | 16 | — | — | yes | mig | 1 | live |
| `agent_runs` | 1867 | 9 | — | — | — | mig | 4 | live |
| `agent_runtime_state` | 16546 | 21 | — | — | yes | mig | 1 | live |
| `agent_semantic_memory` | 16839 | 15 | yes | — | yes | mig | 1 | live |
| `agent_session_steps` | 1964 | 15 | yes | yes | — | mig | 1 | live |
| `agent_sessions` | 1926 | 10 | yes | yes | — | mig | 1 | live |
| `agent_skill_registry` | 17048 | 11 | — | — | yes | mig | 1 | live |
| `agent_spawn_proposals` | 17861 | 13 | — | — | — | **NONE** | 1 | live |
| `agent_strategies` | 16897 | 20 | yes | — | yes | mig | 2 | live |
| `agent_synergy_map` | 15716 | 13 | — | — | yes | **NONE** | 1 | live |
| `agent_tasks` | 1827 | 20 | yes | yes | yes | mig | 21 | live |
| `agent_versions` | 16690 | 16 | — | — | yes | mig | 2 | live |
| `agent_workflow_runs` | 15148 | 10 | — | yes | yes | **NONE** | 1 | live |
| `agent_workflows` | 15114 | 13 | — | — | yes | **NONE** | 1 | live |
| `agent_working_memory_v13` | 16864 | 9 | yes | — | yes | mig | 1 | live |
| `ai_agent_profiles` | 2327 | 9 | — | — | — | mig | 1 | live |
| `ai_conversations` | 2657 | 13 | yes | — | yes | mig | 9 | live |
| `ai_execution_runs` | 2352 | 11 | yes | — | — | mig | 1 | live |
| `ai_memory` | 2367 | 7 | yes | — | — | mig | 3 | live |
| `ai_messages` | 2763 | 9 | — | yes | — | mig | 11 | live |
| `ai_tool_definitions` | 2340 | 8 | — | — | — | mig | 1 | live |
| `anomaly_detections` | 17086 | 14 | yes | — | yes | mig | 4 | live |
| `api_jobs` | 4828 | 13 | yes | yes | — | mig | 1 | live |
| `api_usage_logs` | 8004 | 8 | yes | yes | — | mig | 5 | live |
| `attention_insights` | 15499 | 8 | — | — | yes | **NONE** | 1 | live |
| `auction_readiness_checklists` | 8191 | 15 | yes | — | yes | mjs | 0 | **DEAD** |
| `audit_events` | 5496 | 14 | — | — | yes | both | 7 | live |
| `audit_explanations` | 17203 | 10 | yes | — | yes | mig | 1 | live |
| `audit_log` | 5410 | 13 | yes | yes | yes | mig | 12 | live |
| `audit_log_purges` | 5467 | 11 | yes | yes | yes | mig | 1 | live |
| `auth_fail_attempts` | 8479 | 6 | — | — | yes | mjs | 1 | live |
| `authority_delegations` | 13593 | 9 | — | — | yes | both | 1 | live |
| `auto_bid_rules` | 12499 | 24 | yes | yes | yes | mig | 1 | live |
| `automation_executions` | 7562 | 11 | yes | yes | — | mig | 0 | **DEAD** |
| `automation_rules` | 7517 | 13 | yes | yes | yes | mig | 1 | live |
| `autonomy_score_snapshots` | 17515 | 18 | yes | — | yes | **NONE** | 1 | live |
| `autopay_enrollments` | 9457 | 16 | yes | yes | — | mig | 1 | live |
| `autopilot_conversions` | 13239 | 7 | yes | — | yes | both | 1 | live |
| `autopilot_experiences` | 12784 | 21 | — | — | yes | both | 4 | live |
| `autopilot_objectives` | 13284 | 12 | — | — | yes | both | 1 | live |
| `autopilot_pending_actions` | 13311 | 13 | — | — | yes | both | 1 | live |
| `autopilot_policy_proposals` | 12854 | 10 | — | — | yes | both | 2 | live |
| `autopilot_sends` | 13336 | 7 | — | — | — | both | 1 | live |
| `autopilot_senses` | 13265 | 5 | — | — | yes | both | 2 | live |
| `autopilot_settings` | 13175 | 8 | — | — | — | both | 1 | live |
| `autopilot_standing_orders` | 12770 | 7 | — | — | — | both | 1 | live |
| `autopilot_worldmodel_snapshots` | 12838 | 6 | — | — | yes | mjs | 1 | live |
| `backup_verified` | 2642 | 9 | — | — | yes | both | 1 | live |
| `board_decisions` | 17724 | 11 | — | — | yes | **NONE** | 1 | live |
| `board_meetings` | 17689 | 12 | — | — | yes | **NONE** | 1 | live |
| `board_votes` | 17707 | 11 | — | — | yes | **NONE** | 1 | live |
| `borrower_messages` | 8053 | 7 | yes | yes | — | mig | 1 | live |
| `borrower_payment_profiles` | 794 | 16 | yes | yes | — | mig | 0 | **DEAD** |
| `borrower_sessions` | 8023 | 10 | yes | yes | — | mig | 1 | live |
| `browser_automation_jobs` | 9739 | 19 | yes | yes | — | mig | 1 | live |
| `browser_automation_templates` | 9688 | 15 | yes | — | — | mig | 1 | live |
| `browser_session_credentials` | 9789 | 12 | yes | yes | — | mig | 1 | live |
| `build_buy_decisions` | 17789 | 9 | — | — | — | **NONE** | 1 | live |
| `buyer_prequalifications` | 3194 | 23 | yes | yes | — | mig | 1 | live |
| `buyer_profiles` | 11609 | 13 | yes | yes | — | mig | 5 | live |
| `buyer_property_matches` | 11674 | 14 | yes | yes | yes | mig | 2 | live |
| `buyer_qualifications` | 11710 | 12 | yes | yes | — | mig | 1 | live |
| `buyer_reservations` | 9380 | 15 | yes | yes | — | mig | 1 | live |
| `cached_lookup_hits` | 3672 | 4 | yes | yes | yes | mjs | 1 | live |
| `cached_lookups` | 3630 | 13 | — | yes | yes | mjs | 1 | live |
| `call_transcripts` | 11181 | 25 | yes | yes | — | mig | 2 | live |
| `campaign_delivery_events` | 1781 | 8 | — | yes | — | mig | 4 | live |
| `campaign_leads` | 14451 | 8 | yes | — | — | mig | 1 | live |
| `campaign_optimizations` | 1709 | 11 | yes | yes | — | mig | 2 | live |
| `campaign_responses` | 1744 | 15 | yes | yes | — | mig | 4 | live |
| `campaign_sequences` | 4947 | 9 | yes | yes | — | mig | 2 | live |
| `campaign_variants` | 14297 | 12 | — | yes | — | mig | 1 | live |
| `campaigns` | 1654 | 25 | yes | yes | yes | mig | 132 | live |
| `cancellation_surveys` | 9008 | 12 | yes | yes | — | mjs | 3 | live |
| `cascade_resolutions` | 17450 | 15 | yes | — | yes | **NONE** | 4 | live |
| `cash_flow_forecasts` | 11415 | 17 | yes | yes | — | mig | 1 | live |
| `causal_investigations` | 15922 | 19 | — | — | yes | **NONE** | 1 | live |
| `ceo_absence_mode` | 15327 | 10 | — | — | yes | **NONE** | 2 | live |
| `ceo_briefings` | 15783 | 10 | — | — | yes | **NONE** | 1 | live |
| `ceo_cognitive_model` | 16322 | 13 | — | — | yes | mig | 1 | live |
| `ceo_decision_replays` | 16139 | 15 | — | — | yes | mig | 1 | live |
| `ceo_shadow_predictions` | 16353 | 11 | — | — | yes | mig | 1 | live |
| `chaos_experiments` | 17141 | 15 | — | — | yes | mig | 1 | live |
| `chat_pending_tool_calls` | 2684 | 8 | — | yes | yes | mjs | 2 | live |
| `chat_secret_paste_requests` | 2719 | 8 | — | yes | yes | mjs | 2 | live |
| `chat_tool_cooldowns` | 2702 | 3 | — | — | yes | mig | 1 | live |
| `checklist_templates` | 3954 | 8 | yes | yes | — | mig | 1 | live |
| `churn_reasons` | 6054 | 8 | yes | yes | yes | both | 2 | live |
| `churn_risk_scores` | 13028 | 21 | yes | yes | yes | mig | 12 | live |
| `circuit_breaker_state` | 7697 | 7 | — | — | — | both | 2 | live |
| `closing_packets` | 9429 | 9 | yes | yes | — | mig | 1 | live |
| `cma_reports` | 8162 | 17 | yes | — | yes | mjs | 0 | **DEAD** |
| `cohort_assignments` | 6023 | 7 | yes | yes | yes | both | 0 | **DEAD** |
| `collection_enrollments` | 3272 | 15 | yes | yes | — | mig | 1 | live |
| `collection_sequences` | 3237 | 15 | yes | yes | — | mig | 1 | live |
| `company_agents` | 14769 | 15 | — | — | yes | **NONE** | 24 | live |
| `company_briefing_cache` | 14911 | 5 | — | — | — | **NONE** | 2 | live |
| `company_chronicle` | 15742 | 11 | — | — | yes | **NONE** | 4 | live |
| `company_priorities` | 15043 | 8 | — | — | yes | **NONE** | 1 | live |
| `company_seasons` | 15684 | 10 | — | — | yes | **NONE** | 2 | live |
| `compass_recommendations` | 15854 | 13 | — | — | yes | **NONE** | 1 | live |
| `compliance_checks` | 11529 | 15 | yes | yes | — | mig | 2 | live |
| `compliance_rules` | 11477 | 17 | — | — | — | mig | 4 | live |
| `compliance_snapshots` | 17221 | 7 | yes | — | yes | mig | 1 | live |
| `constitutional_principles` | 17740 | 13 | — | — | — | **NONE** | 1 | live |
| `content_drafts` | 18006 | 10 | — | — | — | **NONE** | 2 | live |
| `contract_templates` | 17653 | 13 | — | — | — | **NONE** | 1 | live |
| `conversations` | 2096 | 11 | yes | yes | — | mig | 36 | live |
| `county_building_permits` | 8769 | 9 | — | — | yes | both | 2 | live |
| `county_coverage_requests` | 6516 | 10 | yes | yes | yes | both | 2 | live |
| `county_discovery_queue` | 6325 | 14 | — | yes | yes | both | 3 | live |
| `county_employment_wages` | 8802 | 9 | — | — | yes | both | 2 | live |
| `county_gis_endpoints` | 6236 | 28 | — | — | — | mig | 10 | live |
| `county_market_rollups` | 6754 | 7 | — | — | yes | both | 3 | live |
| `county_markets` | 14467 | 9 | — | — | — | mig | 2 | live |
| `county_migration_summary` | 8739 | 14 | — | — | yes | both | 2 | live |
| `county_redemption_rates` | 10622 | 13 | — | — | — | mig | 0 | **DEAD** |
| `county_research` | 3304 | 28 | — | — | — | mig | 1 | live |
| `county_reviews` | 14748 | 10 | yes | yes | — | **NONE** | 1 | live |
| `county_rollup_runs` | 6781 | 5 | — | — | yes | both | 1 | live |
| `credit_transactions` | 2276 | 11 | yes | yes | yes | mig | 3 | live |
| `crisis_playbooks` | 17905 | 9 | — | — | — | **NONE** | 1 | live |
| `custom_autonomy_rules` | 3694 | 7 | yes | yes | yes | **NONE** | 3 | live |
| `custom_field_definitions` | 5122 | 13 | yes | yes | — | mig | 1 | live |
| `custom_field_values` | 5139 | 6 | — | yes | — | mig | 1 | live |
| `customer_audit_log` | 5555 | 11 | yes | yes | yes | both | 2 | live |
| `customer_concentration` | 8825 | 10 | — | — | — | both | 2 | live |
| `customer_health_scores` | 5816 | 11 | yes | yes | yes | mjs | 3 | live |
| `customer_letters` | 13938 | 10 | yes | yes | yes | mjs | 1 | live |
| `customer_unit_economics` | 8875 | 22 | yes | yes | yes | both | 1 | live |
| `daily_deal_feed` | 14561 | 6 | yes | yes | yes | **NONE** | 3 | live |
| `dashboard_context_states` | 16218 | 10 | — | — | yes | mig | 1 | live |
| `data_processing_agreements` | 5681 | 11 | — | — | yes | both | 2 | live |
| `data_source_cache` | 9055 | 10 | — | yes | — | mig | 2 | live |
| `data_sources` | 8071 | 27 | — | — | — | mig | 11 | live |
| `dd_assignments` | 9549 | 17 | yes | yes | — | mig | 1 | live |
| `deadman_page_state` | 7716 | 3 | — | — | — | both | 1 | live |
| `deal_alerts` | 12550 | 13 | yes | yes | yes | mig | 1 | live |
| `deal_checklists` | 3966 | 7 | — | yes | — | mig | 3 | live |
| `deal_feed_interactions` | 14573 | 6 | yes | yes | yes | **NONE** | 2 | live |
| `deal_pattern_matches` | 10969 | 12 | yes | yes | yes | mig | 1 | live |
| `deal_patterns` | 10891 | 17 | yes | yes | yes | mig | 2 | live |
| `deal_room_documents` | 12952 | 11 | — | yes | yes | mig | 1 | live |
| `deal_room_messages` | 12932 | 9 | — | yes | yes | mig | 1 | live |
| `deal_sources` | 12450 | 18 | — | — | yes | mig | 0 | **DEAD** |
| `deals` | 1281 | 24 | yes | yes | yes | mig | 294 | live |
| `decision_causality_nodes` | 16438 | 14 | — | — | yes | mig | 1 | live |
| `decision_experiment_assignments` | 13845 | 8 | yes | yes | yes | mjs | 1 | live |
| `decision_experiments` | 13815 | 14 | — | — | yes | mjs | 6 | live |
| `decision_patterns` | 15360 | 18 | — | — | yes | **NONE** | 2 | live |
| `decisions_inbox_items` | 12978 | 30 | yes | yes | yes | mig | 51 | live |
| `deferred_revenue` | 8961 | 13 | yes | yes | — | both | 0 | **DEAD** |
| `degradation_modes` | 17109 | 9 | — | — | yes | mig | 1 | live |
| `delegated_goals` | 15963 | 19 | — | — | yes | **NONE** | 1 | live |
| `delegation_tokens` | 16463 | 19 | — | — | yes | mig | 1 | live |
| `delinquency_escalations` | 9519 | 14 | yes | yes | yes | mig | 1 | live |
| `deployments` | 5355 | 12 | — | — | yes | mig | 2 | live |
| `dialogue_messages` | 16989 | 9 | — | — | yes | mig | 1 | live |
| `digest_subscriptions` | 4852 | 7 | yes | yes | — | mig | 1 | live |
| `disclosure_timing_scheduled` | 8452 | 11 | yes | — | yes | mjs | 1 | live |
| `discovered_endpoints` | 9083 | 15 | — | — | — | mig | 3 | live |
| `disposition_recommendations` | 11757 | 14 | yes | yes | — | mig | 2 | live |
| `dnc_scrub_results` | 13543 | 9 | yes | yes | yes | both | 1 | live |
| `document_analysis` | 11332 | 19 | yes | yes | — | mig | 2 | live |
| `document_packages` | 7445 | 13 | yes | yes | — | mig | 1 | live |
| `document_templates` | 7229 | 12 | yes | yes | — | mig | 1 | live |
| `document_versions` | 7418 | 10 | yes | yes | — | mig | 1 | live |
| `domain_autonomy_levels` | 12756 | 8 | — | — | — | both | 1 | live |
| `dr_drills` | 5380 | 14 | — | — | yes | mig | 2 | live |
| `dsar_requests` | 5602 | 17 | yes | yes | yes | both | 1 | live |
| `dsar_requests_lifecycle` | 8276 | 11 | — | — | yes | mjs | 3 | live |
| `due_diligence_checklists` | 7051 | 18 | yes | yes | — | mig | 2 | live |
| `due_diligence_dossiers` | 10680 | 22 | yes | yes | — | mig | 2 | live |
| `due_diligence_items` | 3880 | 10 | — | yes | — | mig | 3 | live |
| `due_diligence_templates` | 3870 | 6 | yes | yes | — | mig | 1 | live |
| `dunning_events` | 4611 | 22 | yes | yes | — | mig | 4 | live |
| `email_events` | 399 | 11 | — | — | yes | both | 2 | live |
| `email_reputation_snapshot` | 631 | 11 | yes | — | yes | both | 1 | live |
| `email_sender_identities` | 7727 | 16 | yes | yes | — | mig | 1 | live |
| `email_suppressions` | 423 | 8 | yes | — | yes | both | 2 | live |
| `email_warmup_state` | 596 | 8 | yes | — | — | both | 1 | live |
| `entity_comments` | 14590 | 8 | yes | yes | yes | **NONE** | 1 | live |
| `escalation_alerts` | 9856 | 17 | yes | yes | — | mig | 1 | live |
| `escrow_checklists` | 9403 | 10 | yes | yes | — | mig | 1 | live |
| `event_mesh_events` | 16576 | 16 | yes | — | yes | mig | 4 | live |
| `event_mesh_subscriptions` | 16605 | 10 | — | — | yes | mig | 2 | live |
| `event_subscriptions` | 2000 | 10 | yes | yes | — | mig | 2 | live |
| `evolution_circuit_breaker` | 14429 | 7 | — | — | — | **NONE** | 4 | live |
| `evolution_history` | 14382 | 26 | — | — | yes | **NONE** | 5 | live |
| `expansion_candidates` | 13866 | 14 | yes | yes | yes | mjs | 3 | live |
| `external_intelligence` | 15997 | 15 | — | — | yes | **NONE** | 1 | live |
| `fair_lending_audit_runs` | 8330 | 9 | yes | — | yes | mjs | 2 | live |
| `feature_impact_scores` | 17801 | 10 | — | — | — | **NONE** | 1 | live |
| `feature_requests` | 4561 | 13 | yes | yes | — | mig | 9 | live |
| `feedback_learnings` | 17426 | 14 | yes | — | yes | **NONE** | 1 | live |
| `feedback_submissions` | 18251 | 17 | — | — | — | mjs | 2 | live |
| `field_scout_photos` | 18199 | 15 | yes | — | yes | both | 1 | live |
| `field_scout_visits` | 18176 | 13 | yes | — | yes | both | 1 | live |
| `financial_approvals` | 17577 | 16 | — | — | yes | **NONE** | 2 | live |
| `fix_attempts` | 12219 | 13 | yes | yes | yes | mig | 1 | live |
| `founder_ad_accounts` | 14193 | 10 | — | — | — | mig | 5 | live |
| `founder_briefings` | 17257 | 11 | yes | — | yes | mig | 1 | live |
| `founder_briefs` | 14647 | 6 | — | — | — | **NONE** | 0 | **DEAD** |
| `founder_dependency_events` | 17539 | 12 | yes | — | yes | **NONE** | 1 | live |
| `founder_digest_history` | 13672 | 16 | — | — | yes | mig | 1 | live |
| `founder_drafts` | 15481 | 9 | — | — | yes | **NONE** | 1 | live |
| `founder_intents` | 17476 | 15 | yes | — | yes | **NONE** | 2 | live |
| `founder_interactions` | 17312 | 7 | yes | — | yes | mig | 1 | live |
| `founder_letters` | 14067 | 8 | — | — | yes | mjs | 2 | live |
| `founder_overrides` | 17405 | 12 | yes | — | yes | **NONE** | 4 | live |
| `founder_settings` | 14019 | 8 | — | — | yes | mjs | 8 | live |
| `founder_twin_context` | 15465 | 9 | — | — | yes | **NONE** | 1 | live |
| `founder_wellbeing` | 15655 | 6 | — | — | yes | **NONE** | 3 | live |
| `generated_documents` | 7258 | 24 | yes | yes | — | mig | 4 | live |
| `go_nogo_memos` | 9595 | 15 | yes | yes | — | mig | 1 | live |
| `governance_policies` | 17165 | 12 | — | — | yes | mig | 1 | live |
| `growth_campaigns` | 14213 | 15 | — | — | — | mig | 3 | live |
| `growth_targets` | 13197 | 10 | — | — | yes | both | 3 | live |
| `inbox_messages` | 7769 | 23 | yes | yes | — | mig | 3 | live |
| `incident_playbooks` | 17125 | 10 | — | — | yes | mig | 1 | live |
| `incidents` | 5709 | 21 | — | — | yes | mjs | 21 | live |
| `institutional_patterns` | 15526 | 14 | — | yes | yes | **NONE** | 1 | live |
| `integration_credentials` | 16738 | 15 | yes | — | yes | mig | 1 | live |
| `integration_execution_log` | 16762 | 17 | yes | — | yes | mig | 3 | live |
| `integration_status` | 18282 | 9 | — | — | — | mjs | 1 | live |
| `intent_progress_logs` | 17498 | 8 | yes | — | yes | **NONE** | 1 | live |
| `job_cursors` | 7651 | 8 | — | — | — | mig | 1 | live |
| `job_health_logs` | 13109 | 9 | — | — | yes | mig | 26 | live |
| `job_locks` | 7674 | 5 | — | — | — | mig | 2 | live |
| `knowledge_base_articles` | 12068 | 22 | — | yes | yes | mig | 5 | live |
| `knowledge_freshness` | 16373 | 15 | — | — | yes | mig | 1 | live |
| `land_intelligence_reports` | 6828 | 17 | yes | yes | yes | both | 2 | live |
| `lead_activities` | 941 | 8 | yes | yes | — | mig | 9 | live |
| `lead_consent_events` | 2191 | 18 | yes | yes | yes | mig | 1 | live |
| `lead_conversions` | 1052 | 13 | yes | yes | — | mig | 3 | live |
| `lead_emails` | 14723 | 14 | yes | yes | — | **NONE** | 2 | live |
| `lead_qualification_signals` | 9824 | 10 | yes | yes | — | mig | 1 | live |
| `lead_score_history` | 996 | 10 | yes | yes | — | mig | 3 | live |
| `lead_scoring_profiles` | 957 | 24 | yes | yes | — | mig | 1 | live |
| `leads` | 835 | 50 | yes | yes | yes | mig | 308 | live |
| `learning_propagations` | 16046 | 12 | — | — | yes | mig | 2 | live |
| `legal_actions` | 17630 | 17 | — | — | yes | **NONE** | 1 | live |
| `legal_holds` | 5644 | 13 | yes | yes | yes | both | 2 | live |
| `lien_search_records` | 8219 | 12 | yes | — | yes | mjs | 0 | **DEAD** |
| `lifecycle_events` | 5762 | 9 | yes | yes | yes | mjs | 5 | live |
| `mail_sender_identities` | 7825 | 18 | yes | yes | — | mig | 1 | live |
| `mailing_order_pieces` | 7942 | 18 | — | yes | — | mig | 3 | live |
| `mailing_orders` | 7885 | 20 | yes | yes | — | mig | 3 | live |
| `market_adaptations` | 17949 | 10 | — | — | — | **NONE** | 1 | live |
| `market_indicators_temp` | 12303 | 11 | — | — | — | mig | 0 | **DEAD** |
| `market_metrics` | 10162 | 32 | yes | yes | — | mig | 5 | live |
| `market_predictions` | 10251 | 27 | yes | yes | — | mig | 2 | live |
| `market_report_drafts` | 6797 | 6 | — | — | yes | both | 2 | live |
| `marketing_artifacts` | 13217 | 11 | — | — | yes | both | 4 | live |
| `marketing_lists` | 2991 | 15 | yes | yes | — | mig | 2 | live |
| `marketing_spend` | 8704 | 8 | — | — | yes | both | 3 | live |
| `marketing_touch` | 507 | 19 | yes | — | yes | both | 3 | live |
| `memory_access_log` | 16881 | 7 | — | — | yes | mig | 1 | live |
| `messages` | 2114 | 12 | yes | yes | yes | mig | 189 | live |
| `meta_learning_insights` | 17877 | 10 | — | — | — | **NONE** | 1 | live |
| `mission_statements` | 17919 | 8 | — | — | — | **NONE** | 1 | live |
| `ml_training_snapshots` | 5989 | 11 | yes | yes | yes | both | 2 | live |
| `model_calibration_log` | 13765 | 9 | yes | yes | yes | both | 2 | live |
| `mrr_snapshots` | 8686 | 4 | — | — | — | both | 3 | live |
| `negotiation_moves` | 12637 | 16 | — | yes | yes | mig | 1 | live |
| `negotiation_outcomes` | 12677 | 15 | yes | yes | yes | mig | 1 | live |
| `negotiation_sessions` | 11062 | 19 | yes | yes | — | mig | 1 | live |
| `negotiation_strategies` | 12715 | 15 | yes | yes | yes | mig | 1 | live |
| `negotiation_threads` | 12580 | 23 | yes | yes | yes | mig | 1 | live |
| `notes` | 1388 | 51 | yes | yes | yes | mig | 391 | live |
| `notes_receivable` | 14506 | 5 | yes | — | — | mig | 2 | live |
| `notification_preferences` | 5259 | 9 | yes | yes | — | mig | 3 | live |
| `notifications` | 7618 | 12 | yes | yes | — | mig | 59 | live |
| `nps_micro_surveys` | 8525 | 7 | yes | — | yes | mjs | 2 | live |
| `nps_prompt_queue` | 13086 | 9 | yes | yes | yes | both | 2 | live |
| `nps_responses` | 13061 | 7 | yes | yes | — | both | 3 | live |
| `offer_batches` | 3031 | 16 | yes | yes | — | mig | 2 | live |
| `offer_letters` | 6932 | 22 | yes | yes | — | mig | 3 | live |
| `offer_templates` | 6974 | 10 | yes | yes | — | mig | 1 | live |
| `offers` | 3081 | 22 | yes | yes | — | mig | 92 | live |
| `onboarding_journeys` | 13895 | 12 | yes | yes | yes | mjs | 3 | live |
| `onboarding_steps` | 13917 | 8 | — | yes | yes | mjs | 2 | live |
| `open_data_change_events` | 3590 | 12 | — | — | yes | both | 2 | live |
| `openrouter_model_catalog` | 14358 | 15 | — | — | yes | **NONE** | 2 | live |
| `opportunity_scores` | 10000 | 28 | yes | yes | — | mig | 2 | live |
| `org_api_keys` | 14321 | 12 | yes | yes | yes | mig | 1 | live |
| `org_co_owners` | 351 | 5 | yes | yes | yes | both | 1 | live |
| `org_credits` | 2303 | 3 | yes | yes | — | mig | 0 | *test-only* |
| `org_email_identities` | 563 | 15 | yes | — | yes | both | 2 | live |
| `org_heartbeat_snapshots` | 16089 | 12 | — | — | yes | mig | 2 | live |
| `org_vertical_packs` | 8581 | 14 | yes | — | yes | mjs | 3 | live |
| `organization_integrations` | 716 | 10 | yes | yes | — | mig | 15 | live |
| `organization_invitations` | 366 | 13 | yes | yes | — | both | 1 | live |
| `organizations` | 58 | 65 | — | — | — | mig | 178 | live |
| `outbound_email_log` | 457 | 11 | yes | — | yes | both | 1 | live |
| `outcome_calibrations` | 16068 | 12 | — | — | yes | mig | 3 | live |
| `outcome_telemetry` | 2057 | 9 | yes | yes | — | mig | 4 | live |
| `outcome_verification_contracts` | 16624 | 20 | yes | — | yes | mig | 1 | live |
| `outcome_verification_queue` | 15020 | 10 | — | yes | yes | **NONE** | 2 | live |
| `paid_data_eval_runs` | 6892 | 13 | yes | yes | yes | both | 1 | live |
| `parcel_alerts` | 6675 | 18 | yes | yes | yes | both | 2 | live |
| `parcel_observations` | 6623 | 11 | yes | yes | yes | both | 4 | live |
| `parcel_snapshots` | 6546 | 30 | yes | yes | — | mig | 6 | live |
| `pax_connector_instances` | 2382 | 11 | yes | — | yes | mig | 1 | live |
| `pax_cross_org_learnings` | 12258 | 17 | — | — | yes | mig | 4 | live |
| `pax_drafts` | 2524 | 12 | yes | — | yes | both | 1 | live |
| `pax_knowledge_files` | 2401 | 12 | yes | — | yes | mig | 1 | live |
| `pax_memory` | 12175 | 11 | yes | yes | yes | mig | 10 | live |
| `pax_nudges` | 2494 | 15 | yes | — | yes | mig | 9 | live |
| `pax_observations` | 4752 | 25 | yes | yes | yes | mig | 6 | live |
| `pax_project_files` | 2437 | 8 | — | — | yes | mig | 1 | live |
| `pax_projects` | 2420 | 10 | yes | — | yes | mig | 1 | live |
| `pax_scheduled_task_runs` | 2476 | 8 | yes | — | yes | mig | 3 | live |
| `pax_scheduled_tasks` | 2449 | 17 | yes | — | yes | mig | 1 | live |
| `pax_sends` | 2576 | 8 | yes | — | yes | both | 3 | live |
| `payment_reminders` | 1623 | 12 | yes | yes | — | mig | 2 | live |
| `payments` | 1562 | 16 | yes | yes | yes | mig | 117 | live |
| `payoff_quotes` | 9481 | 12 | yes | yes | — | mig | 1 | live |
| `pending_actions` | 2552 | 12 | yes | — | yes | both | 5 | live |
| `perpetual_ops_checks` | 17973 | 9 | — | — | — | **NONE** | 1 | live |
| `personal_bests` | 14705 | 7 | yes | yes | — | **NONE** | 1 | live |
| `platform_config` | 14086 | 12 | — | — | yes | mig | 1 | live |
| `platform_feature_flags` | 14140 | 12 | — | — | — | mig | 4 | live |
| `platform_issues` | 17989 | 10 | — | — | — | **NONE** | 2 | live |
| `playbook_evolutions` | 15821 | 18 | — | yes | yes | **NONE** | 1 | live |
| `playbook_instances` | 11876 | 14 | yes | yes | — | mig | 1 | live |
| `policy_evaluations` | 17185 | 9 | yes | — | yes | mig | 1 | live |
| `portfolio_alerts` | 11292 | 17 | yes | yes | — | mig | 1 | live |
| `pre_authorized_tradeoffs` | 17892 | 10 | — | — | — | **NONE** | 1 | live |
| `pre_churn_rungs` | 8548 | 6 | yes | — | yes | mjs | 2 | live |
| `predictive_staged_actions` | 16493 | 15 | — | — | yes | mig | 1 | live |
| `price_recommendations` | 10824 | 17 | yes | yes | — | mig | 2 | live |
| `price_trends` | 12335 | 17 | — | — | yes | mig | 2 | live |
| `pricing_config` | 14166 | 10 | — | — | — | mig | 2 | live |
| `pricing_experiments` | 8303 | 9 | yes | — | yes | mjs | 1 | live |
| `processed_feedback` | 14660 | 7 | — | yes | — | **NONE** | 0 | **DEAD** |
| `product_specifications` | 17772 | 14 | — | — | — | **NONE** | 1 | live |
| `proof_receipts` | 2597 | 22 | yes | — | yes | mjs | 2 | live |
| `properties` | 1104 | 64 | yes | yes | yes | mig | 327 | live |
| `property_listings` | 7148 | 22 | yes | yes | — | mig | 3 | live |
| `provider_cache` | 3556 | 8 | — | — | yes | **NONE** | 2 | live |
| `provider_health` | 13790 | 8 | — | — | yes | both | 3 | live |
| `provider_lookup_log` | 13724 | 15 | yes | yes | yes | mjs | 2 | live |
| `provisioned_phone_numbers` | 680 | 12 | yes | yes | — | mig | 1 | live |
| `public_parcel_reports` | 6467 | 14 | — | — | yes | both | 2 | live |
| `quiet_hours_config` | 15058 | 9 | — | — | — | **NONE** | 1 | live |
| `radar_configs` | 9907 | 11 | yes | yes | — | mig | 1 | live |
| `reaction_chain_links` | 17390 | 6 | — | — | yes | **NONE** | 1 | live |
| `reaction_chain_runs` | 17369 | 13 | yes | — | yes | **NONE** | 2 | live |
| `reaction_chains` | 17344 | 17 | yes | — | yes | **NONE** | 2 | live |
| `reactivation_surveys` | 8994 | 5 | yes | yes | yes | both | 1 | live |
| `realtime_event_log` | 16202 | 6 | — | — | yes | mig | 1 | live |
| `reconciliation_rules` | 8375 | 10 | — | — | yes | mjs | 1 | live |
| `reconciliation_runs` | 8400 | 8 | — | — | yes | mjs | 1 | live |
| `refund_requests` | 9032 | 13 | yes | yes | — | mjs | 1 | live |
| `regulatory_feeds` | 17930 | 13 | — | — | yes | **NONE** | 1 | live |
| `regulatory_filing_calendar` | 17669 | 12 | — | — | yes | **NONE** | 1 | live |
| `regulatory_sandbox_runs` | 17236 | 11 | yes | — | yes | mig | 1 | live |
| `resilience_tests` | 16173 | 10 | — | — | yes | mig | 1 | live |
| `resource_quota_events` | 16424 | 5 | — | — | yes | mig | 1 | live |
| `retention_events` | 5950 | 7 | yes | yes | yes | both | 0 | **DEAD** |
| `retention_policies` | 8502 | 9 | — | — | yes | mjs | 3 | live |
| `revenue_attribution_nodes` | 16274 | 11 | — | — | yes | mig | 1 | live |
| `revenue_attribution_reports` | 16295 | 8 | — | — | yes | mig | 1 | live |
| `revenue_protection_interventions` | 13644 | 16 | yes | yes | yes | mig | 4 | live |
| `revenue_recognition_periods` | 8615 | 12 | yes | — | yes | mjs | 3 | live |
| `saga_instances` | 16655 | 16 | yes | — | yes | mig | 1 | live |
| `sanctions_list_entries` | 13481 | 12 | — | — | yes | both | 2 | live |
| `sanctions_screenings` | 13406 | 17 | yes | yes | yes | both | 1 | live |
| `saved_views` | 5171 | 13 | yes | yes | — | mig | 2 | live |
| `scenario_outcome_comparisons` | 16029 | 9 | — | yes | yes | mig | 1 | live |
| `scenario_simulations` | 15401 | 10 | — | — | yes | mig | 2 | live |
| `scheduled_tasks` | 9339 | 15 | yes | yes | — | mig | 2 | live |
| `scp_evolution_metrics` | 18152 | 16 | yes | — | yes | both | 0 | **DEAD** |
| `scp_golden_cases` | 18114 | 9 | yes | — | yes | both | 1 | live |
| `scp_procedures` | 18079 | 19 | yes | — | yes | both | 1 | live |
| `scp_semantic_facts` | 18050 | 18 | yes | — | yes | both | 1 | live |
| `scp_shared_memory` | 18131 | 13 | yes | — | yes | both | 1 | live |
| `scraped_deals` | 12379 | 31 | — | — | yes | mig | 1 | live |
| `self_audit_reports` | 17962 | 8 | — | — | — | **NONE** | 1 | live |
| `seller_communications` | 3117 | 19 | yes | yes | — | mig | 2 | live |
| `seller_intent_predictions` | 10749 | 16 | yes | yes | — | mig | 5 | live |
| `sequence_enrollments` | 4981 | 12 | — | yes | — | mig | 2 | live |
| `sequence_performance` | 11125 | 26 | yes | yes | — | mig | 1 | live |
| `sequence_steps` | 4965 | 12 | — | yes | — | mig | 1 | live |
| `shared_deal_links` | 14680 | 6 | yes | yes | — | **NONE** | 0 | **DEAD** |
| `signal_correlations` | 15557 | 9 | — | yes | yes | **NONE** | 1 | live |
| `signatures` | 7312 | 15 | yes | yes | — | mig | 19 | live |
| `signing_consent_audit` | 7368 | 14 | yes | yes | yes | both | 2 | live |
| `simulated_actions` | 5443 | 7 | yes | yes | — | mjs | 3 | live |
| `simulation_runs` | 17276 | 10 | yes | — | yes | mig | 1 | live |
| `skip_traces` | 6999 | 15 | yes | yes | — | mig | 1 | live |
| `spend_anomalies` | 17614 | 9 | — | — | yes | **NONE** | 2 | live |
| `spend_optimizations` | 15901 | 12 | — | — | yes | **NONE** | 1 | live |
| `spend_watchers` | 15884 | 8 | — | — | yes | **NONE** | 1 | live |
| `statutory_forms` | 8424 | 12 | — | — | yes | mjs | 1 | live |
| `strategic_compass` | 15579 | 11 | — | — | yes | **NONE** | 3 | live |
| `strategic_plans` | 17756 | 11 | — | — | — | **NONE** | 1 | live |
| `strategic_proposals` | 14039 | 15 | — | — | yes | mjs | 7 | live |
| `strategic_recommendations` | 17293 | 10 | yes | — | yes | mig | 1 | live |
| `strategy_assignments` | 16926 | 11 | yes | — | yes | mig | 1 | live |
| `strategy_proposals` | 16946 | 14 | yes | — | yes | mig | 1 | live |
| `subscription_events` | 8121 | 6 | yes | yes | — | mig | 10 | live |
| `subscription_history` | 8652 | 8 | yes | yes | — | both | 3 | live |
| `support_actions` | 4414 | 11 | — | yes | — | mig | 1 | live |
| `support_cases` | 4343 | 18 | yes | yes | — | mig | 7 | live |
| `support_messages` | 4386 | 9 | — | yes | — | mig | 2 | live |
| `support_playbooks` | 4440 | 20 | — | — | — | mig | 1 | live |
| `support_resolution_history` | 12120 | 13 | yes | yes | yes | mig | 2 | live |
| `support_ticket_messages` | 12046 | 8 | — | yes | yes | mig | 8 | live |
| `support_tickets` | 11967 | 26 | yes | yes | yes | mig | 26 | live |
| `swot_reports` | 9574 | 13 | yes | yes | — | mig | 1 | live |
| `syndication_channel_states` | 7209 | 8 | yes | yes | yes | both | 1 | live |
| `synthetic_check_runs` | 8141 | 7 | — | — | yes | mjs | 2 | live |
| `system_activity` | 14267 | 9 | yes | yes | yes | mig | 3 | live |
| `system_alerts` | 4691 | 16 | yes | yes | — | mig | 33 | live |
| `system_meta` | 14285 | 3 | — | — | — | mig | 6 | live |
| `target_counties` | 6177 | 16 | yes | yes | — | mig | 6 | live |
| `tasks` | 5301 | 18 | yes | yes | — | mig | 74 | live |
| `tax_escrow_payments` | 1595 | 17 | yes | yes | — | mig | 2 | live |
| `tax_sale_alerts` | 10585 | 10 | yes | yes | — | mig | 0 | **DEAD** |
| `tax_sale_auctions` | 10369 | 29 | yes | yes | yes | mig | 2 | live |
| `tax_sale_listings` | 10463 | 56 | yes | yes | yes | mig | 1 | live |
| `team_conversations` | 6106 | 10 | yes | yes | — | mig | 1 | live |
| `team_member_presence` | 6158 | 6 | yes | yes | — | mig | 1 | live |
| `team_members` | 323 | 11 | yes | yes | — | mig | 38 | live |
| `team_messages` | 6129 | 8 | — | yes | — | mig | 2 | live |
| `temporal_prediction_patterns` | 16518 | 14 | — | — | yes | mig | 1 | live |
| `tenant_agent_config` | 16789 | 12 | yes | — | yes | mig | 2 | live |
| `territories` | 14484 | 9 | yes | — | — | mig | 5 | live |
| `today_queue_state` | 13364 | 8 | yes | yes | yes | both | 1 | live |
| `tool_proposals` | 13959 | 15 | — | — | yes | mjs | 4 | live |
| `trust_enforcement_log` | 16715 | 13 | yes | — | yes | mig | 2 | live |
| `trust_evolution_log` | 14920 | 13 | — | — | yes | **NONE** | 4 | live |
| `trust_ledger` | 9501 | 10 | yes | yes | — | mig | 6 | live |
| `ui_state` | 5218 | 6 | yes | yes | yes | both | 1 | live |
| `unsubscribe_tokens` | 612 | 5 | yes | — | yes | both | 2 | live |
| `uptime_samples` | 13162 | 3 | — | — | yes | both | 1 | live |
| `usage_events` | 2243 | 6 | yes | yes | — | mig | 3 | live |
| `usage_rates` | 2312 | 7 | — | — | — | mig | 1 | live |
| `usage_records` | 2255 | 9 | yes | yes | — | mig | 4 | live |
| `user_activation_events` | 14621 | 5 | yes | yes | yes | **NONE** | 1 | live |
| `user_feedback` | 14632 | 6 | yes | yes | yes | **NONE** | 2 | live |
| `user_sessions` | 14609 | 6 | yes | yes | yes | **NONE** | 1 | live |
| `va_actions` | 2825 | 27 | yes | yes | — | mig | 2 | live |
| `va_agents` | 2780 | 14 | yes | yes | — | mig | 3 | live |
| `va_briefings` | 2883 | 10 | yes | yes | — | mig | 1 | live |
| `va_calendar_events` | 2922 | 20 | yes | yes | — | mig | 1 | live |
| `va_templates` | 2961 | 12 | yes | yes | — | mig | 1 | live |
| `vendor_adoption_metrics` | 8248 | 8 | — | — | yes | mjs | 1 | live |
| `vendor_referral_fees` | 8349 | 10 | — | — | yes | mjs | 1 | live |
| `verified_email_domains` | 659 | 12 | yes | yes | — | mig | 1 | live |
| `war_room_messages` | 15200 | 7 | — | yes | yes | **NONE** | 2 | live |
| `war_rooms` | 15178 | 14 | — | — | yes | **NONE** | 6 | live |
| `webhook_deliveries` | 14690 | 11 | yes | yes | — | **NONE** | 0 | **DEAD** |
| `white_label_configs` | 765 | 21 | yes | yes | — | mig | 1 | live |
| `worker_heartbeat` | 13141 | 4 | — | — | — | both | 2 | live |
| `workflow_runs` | 9294 | 10 | — | yes | — | mig | 2 | live |
| `workflows` | 9262 | 9 | yes | yes | — | mig | 27 | live |
| `workspace_presets` | 11929 | 12 | yes | yes | yes | mig | 1 | live |
| `writing_style_profiles` | 9622 | 14 | yes | yes | — | mig | 1 | live |

## `server/services/atlasToolRegistry.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `atlas_tool_usage` | 22 | 7 | yes | — | — | **NONE** | 0 | **DEAD** |

## `shared/models/auth.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `referrals` | 251 | 8 | — | yes | yes | mig | 5 | live |
| `users` | 131 | 25 | — | — | — | mig | 84 | live |

## `shared/models/chat.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `conversations` | 6 | 3 | — | — | — | mig | 36 | live |
| `messages` | 12 | 5 | — | yes | — | mig | 189 | live |

## `shared/schema/accounting-ops.ts` (24 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `account_ledger_entries` | 93 | 10 | yes | yes | yes | both | 4 | live |
| `ai_injection_attempts` | 590 | 7 | yes | — | yes | both | 1 | live |
| `chart_of_accounts` | 66 | 9 | yes | yes | yes | both | 5 | live |
| `compliance_validations` | 535 | 14 | yes | — | yes | both | 1 | live |
| `critical_alert_acks` | 393 | 10 | — | yes | — | both | 1 | live |
| `email_templates` | 454 | 10 | — | — | yes | both | 1 | live |
| `form_1099_batches` | 242 | 11 | yes | yes | — | both | 1 | live |
| `job_runs` | 342 | 7 | — | — | yes | both | 2 | live |
| `lead_assignment_rules` | 613 | 11 | yes | yes | yes | both | 2 | live |
| `lifecycle_message_sends` | 477 | 13 | yes | — | yes | both | 3 | live |
| `offer_approvals` | 667 | 11 | yes | yes | yes | both | 2 | live |
| `org_assignment_cursor` | 637 | 4 | — | yes | — | both | 1 | live |
| `org_integrations_slack` | 647 | 11 | yes | yes | yes | both | 2 | live |
| `outbox` | 279 | 10 | — | — | yes | both | 8 | live |
| `outbox_dlq` | 306 | 15 | — | — | yes | both | 8 | live |
| `prompt_versions` | 562 | 15 | — | — | yes | both | 1 | live |
| `property_vision_snapshots` | 699 | 16 | yes | yes | yes | both | 1 | live |
| `reactivation_tokens` | 512 | 7 | yes | — | yes | both | 1 | live |
| `recognition_runs` | 229 | 10 | yes | yes | — | both | 1 | live |
| `recognition_schedules` | 201 | 13 | yes | yes | yes | both | 1 | live |
| `support_saved_replies` | 369 | 7 | yes | yes | — | both | 1 | live |
| `title_orders` | 790 | 24 | yes | yes | yes | both | 2 | live |
| `title_partners` | 763 | 13 | yes | yes | yes | both | 2 | live |
| `vm_resource_usage` | 420 | 20 | — | — | — | both | 1 | live |

## `shared/schema/ach-autopay.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `ach_debit_attempts` | 215 | 24 | yes | yes | yes | both | 1 | live |
| `ach_mandates` | 89 | 32 | yes | yes | yes | both | 3 | live |

## `shared/schema/ai-telemetry.ts` (11 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `ai_budget_runs` | 191 | 8 | — | — | yes | mjs | 1 | live |
| `ai_call_log` | 248 | 13 | yes | yes | yes | mjs | 3 | live |
| `ai_model_configs` | 331 | 12 | — | — | yes | mig | 4 | live |
| `ai_routing_overrides` | 214 | 11 | — | — | yes | both | 1 | live |
| `ai_telemetry_events` | 133 | 15 | yes | yes | yes | mig | 12 | live |
| `ai_usage_daily` | 162 | 7 | yes | yes | yes | both | 4 | live |
| `background_jobs` | 393 | 11 | — | — | — | mig | 8 | live |
| `cost_optimization_runs` | 297 | 10 | — | — | yes | both | 4 | live |
| `goals` | 375 | 9 | yes | yes | — | mig | 29 | live |
| `system_api_keys` | 355 | 11 | — | — | — | mig | 3 | live |
| `user_map_layer_preferences` | 317 | 6 | — | yes | yes | mig | 1 | live |

## `shared/schema/api-telemetry-rollup-monthly.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `api_telemetry_rollup_monthly` | 43 | 11 | — | — | yes | mjs | 1 | live |

## `shared/schema/api-telemetry-samples.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `api_telemetry_samples` | 32 | 13 | — | — | yes | mjs | 2 | live |

## `shared/schema/autopilot-immune.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `autopilot_immune_reports` | 27 | 14 | — | — | yes | both | 1 | live |

## `shared/schema/autopilot-witness-grants.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `witness_grants` | 31 | 15 | — | — | yes | both | 1 | live |

## `shared/schema/beatrice-regwatch.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `beatrice_reg_events` | 35 | 11 | — | — | yes | mjs | 2 | live |

## `shared/schema/calibration-threshold-adjustments.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `support_resolver_threshold_adjustments` | 33 | 11 | — | — | yes | both | 1 | live |

## `shared/schema/compliance.ts` (13 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `background_check_results` | 121 | 10 | yes | yes | yes | mig | 0 | **DEAD** |
| `certificate_verification` | 364 | 14 | yes | yes | yes | mig | 1 | live |
| `compliance_checklist_items` | 335 | 13 | yes | yes | yes | mig | 0 | **DEAD** |
| `cost_basis` | 163 | 15 | yes | yes | yes | mig | 4 | live |
| `depreciation_schedules` | 189 | 16 | yes | yes | yes | mig | 1 | live |
| `investor_verification_documents` | 73 | 15 | yes | yes | yes | mig | 0 | **DEAD** |
| `investor_verification_history` | 100 | 9 | yes | yes | yes | mig | 0 | **DEAD** |
| `investor_verification_requests` | 48 | 14 | yes | yes | yes | both | 1 | live |
| `opportunity_zone_holdings` | 216 | 17 | yes | yes | yes | mig | 2 | live |
| `regulatory_requirements` | 306 | 17 | — | — | yes | mig | 0 | **DEAD** |
| `tax_forecast_scenarios` | 271 | 14 | yes | yes | yes | mig | 1 | live |
| `tax_strategies` | 245 | 14 | yes | yes | yes | mig | 1 | live |
| `tenant_metrics` | 394 | 12 | yes | yes | yes | mig | 0 | **DEAD** |

## `shared/schema/connected-mailboxes.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `connected_mailboxes` | 17 | 12 | yes | — | yes | both | 1 | live |

## `shared/schema/domain-audit-findings.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `domain_audit_findings` | 62 | 15 | — | — | yes | both | 2 | live |

## `shared/schema/error-boundary-trips.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `error_boundary_trips` | 40 | 11 | yes | yes | yes | **NONE** | 2 | live |

## `shared/schema/etl.ts` (22 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `agent_rejection_notes` | 710 | 8 | — | — | yes | mjs | 1 | live |
| `ai_cost_ceiling_overrides` | 322 | 7 | yes | — | — | mjs | 2 | live |
| `ai_eval_gate_runs` | 285 | 17 | — | — | yes | both | 0 | **DEAD** |
| `ai_models` | 206 | 11 | — | — | yes | mjs | 0 | **DEAD** |
| `ai_test_cases` | 229 | 11 | — | — | yes | mjs | 1 | live |
| `ai_test_runs` | 252 | 11 | — | — | yes | mjs | 2 | live |
| `brand_profiles` | 421 | 18 | — | — | yes | mjs | 5 | live |
| `cmo_ad_performance` | 577 | 13 | — | yes | yes | mjs | 2 | live |
| `cmo_ad_renders` | 499 | 21 | — | yes | yes | mjs | 6 | live |
| `cmo_asset_usage` | 538 | 12 | — | — | yes | mjs | 1 | live |
| `cmo_budget` | 615 | 12 | — | yes | yes | mjs | 4 | live |
| `cmo_hook_archetypes` | 558 | 12 | — | — | yes | mjs | 3 | live |
| `cmo_rejection_notes` | 599 | 9 | — | yes | yes | mjs | 2 | live |
| `cmo_scripts` | 459 | 22 | — | yes | yes | mjs | 6 | live |
| `community_letters` | 343 | 12 | — | — | yes | mjs | 3 | live |
| `etl_jobs` | 135 | 15 | — | — | yes | both | 2 | live |
| `etl_runs` | 164 | 13 | — | yes | yes | both | 2 | live |
| `export_jobs` | 93 | 14 | yes | yes | yes | both | 1 | live |
| `founder_audit` | 688 | 10 | — | — | yes | mjs | 17 | live |
| `import_jobs` | 44 | 21 | yes | yes | yes | both | 3 | live |
| `platform_settings` | 651 | 13 | — | — | yes | mjs | 11 | live |
| `user_sign_in_locations` | 376 | 10 | — | — | yes | mjs | 1 | live |

## `shared/schema/external-watch.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `external_watch_events` | 35 | 12 | — | — | yes | mjs | 4 | live |

## `shared/schema/finance.ts` (8 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `byok_credentials` | 259 | 8 | yes | yes | yes | mjs | 7 | live |
| `comms_provider_quotes` | 217 | 6 | — | — | yes | mjs | 0 | **DEAD** |
| `financial_ledger` | 69 | 14 | yes | yes | yes | mjs | 19 | live |
| `ledger_dead_letters` | 135 | 12 | yes | yes | yes | both | 1 | live |
| `mail_qr_scan_events` | 436 | 8 | yes | yes | yes | both | 2 | live |
| `mail_shipment_pieces` | 379 | 22 | yes | yes | yes | mjs | 6 | live |
| `mail_shipments` | 321 | 25 | yes | yes | yes | mjs | 8 | live |
| `tracking_number_assignments` | 177 | 10 | yes | yes | yes | mjs | 1 | live |

## `shared/schema/fix-and-flip.ts` (9 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `arv_calculations` | 390 | 19 | yes | yes | yes | mjs | 2 | live |
| `bid_estimates` | 345 | 14 | yes | yes | yes | mjs | 1 | live |
| `construction_draws` | 304 | 17 | yes | yes | yes | mjs | 1 | live |
| `contractor_payments` | 249 | 14 | yes | yes | yes | mjs | 1 | live |
| `contractor_w9_documents` | 226 | 9 | yes | yes | yes | mjs | 0 | **DEAD** |
| `contractors` | 182 | 21 | yes | yes | yes | mjs | 18 | live |
| `rehab_line_items` | 140 | 16 | yes | yes | yes | mjs | 2 | live |
| `rehab_photos` | 466 | 12 | yes | yes | yes | mig | 1 | live |
| `rehabs` | 65 | 22 | yes | yes | yes | mjs | 21 | live |

## `shared/schema/founder-life-cockpit.ts` (6 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `founder_documents` | 78 | 11 | — | — | yes | both | 1 | live |
| `founder_estimated_payments` | 237 | 11 | — | — | yes | both | 1 | live |
| `founder_income_sources` | 136 | 13 | — | — | yes | both | 1 | live |
| `founder_obligations` | 109 | 9 | — | — | yes | both | 1 | live |
| `founder_tax_profile` | 47 | 9 | — | — | yes | both | 1 | live |
| `founder_tax_returns` | 188 | 16 | — | — | yes | both | 1 | live |

## `shared/schema/hardening.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `sanctions_list` | 81 | 5 | — | — | yes | mjs | 4 | live |
| `signup_signals` | 34 | 12 | — | — | yes | mjs | 2 | live |

## `shared/schema/iris-perf.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `iris_perf_samples` | 39 | 10 | — | — | yes | mjs | 1 | live |

## `shared/schema/krieger-audit.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `krieger_audit_findings` | 73 | 13 | — | — | yes | mjs | 1 | live |

## `shared/schema/market-watchlist.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `market_watchlist_alerts` | 58 | 12 | yes | yes | yes | both | 1 | live |
| `market_watchlist_entries` | 29 | 16 | yes | yes | yes | both | 1 | live |

## `shared/schema/marketplace.ts` (27 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `buyer_behavior_events` | 259 | 10 | — | — | yes | mig | 2 | live |
| `capital_raises` | 670 | 19 | yes | yes | yes | mig | 1 | live |
| `compliance_alerts` | 1004 | 15 | yes | yes | yes | mig | 2 | live |
| `course_enrollments` | 894 | 14 | — | yes | yes | mig | 4 | live |
| `course_modules` | 863 | 12 | — | yes | yes | mig | 3 | live |
| `courses` | 817 | 20 | — | — | yes | mig | 5 | live |
| `deal_rooms` | 171 | 14 | — | yes | — | mig | 3 | live |
| `demand_heatmaps` | 294 | 14 | — | — | yes | mig | 2 | live |
| `esign_webhook_events` | 1130 | 6 | — | — | yes | mjs | 0 | **DEAD** |
| `investor_profiles` | 129 | 20 | yes | yes | yes | mig | 5 | live |
| `land_credit_scores` | 512 | 15 | — | yes | yes | mig | 8 | live |
| `lender_network` | 625 | 21 | yes | yes | yes | mig | 1 | live |
| `marketplace_bids` | 94 | 15 | — | yes | yes | mig | 1 | live |
| `marketplace_listings` | 41 | 24 | — | yes | yes | mig | 3 | live |
| `marketplace_transactions` | 218 | 12 | — | yes | yes | mig | 1 | live |
| `note_securities` | 585 | 19 | yes | yes | yes | mig | 1 | live |
| `optimization_recommendations` | 392 | 13 | yes | yes | yes | mig | 1 | live |
| `photo_analysis` | 769 | 17 | — | yes | yes | mig | 0 | **DEAD** |
| `portfolio_simulations` | 333 | 11 | yes | yes | yes | mig | 2 | live |
| `processed_webhook_events` | 1108 | 6 | — | — | yes | mjs | 1 | live |
| `property_photos` | 725 | 20 | — | yes | yes | mig | 0 | **DEAD** |
| `regulatory_changes` | 964 | 15 | — | — | yes | mig | 1 | live |
| `stripe_processed_events` | 1092 | 4 | — | — | yes | mig | 3 | live |
| `transaction_training` | 434 | 22 | — | — | yes | mig | 3 | live |
| `tutor_sessions` | 931 | 11 | — | yes | yes | mig | 1 | live |
| `valuation_predictions` | 483 | 10 | — | yes | yes | mig | 1 | live |
| `whitelabel_tenants` | 1044 | 19 | — | — | yes | mig | 2 | live |

## `shared/schema/notes-vertical.ts` (16 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `acquired_notes` | 50 | 49 | yes | yes | yes | both | 12 | live |
| `auction_bid_log` | 816 | 9 | yes | yes | yes | mjs | 1 | live |
| `note_acquisitions` | 365 | 19 | yes | yes | yes | mjs | 1 | live |
| `note_assignments` | 442 | 17 | yes | yes | yes | mjs | 1 | live |
| `note_loss_mit_actions` | 604 | 8 | yes | yes | yes | mjs | 1 | live |
| `note_loss_mit_cases` | 561 | 13 | yes | yes | yes | mjs | 1 | live |
| `note_ownership_of_record` | 963 | 10 | yes | yes | yes | mig | 3 | live |
| `note_ownership_splits` | 504 | 13 | yes | yes | yes | mjs | 2 | live |
| `note_payments` | 287 | 15 | yes | yes | yes | both | 7 | live |
| `note_payoff_quotes` | 1110 | 26 | yes | yes | yes | both | 1 | live |
| `quiet_title_cases` | 864 | 18 | yes | yes | yes | mjs | 1 | live |
| `quiet_title_steps` | 909 | 11 | yes | yes | yes | mjs | 1 | live |
| `servicer_licenses` | 1044 | 9 | yes | yes | yes | mig | 1 | live |
| `servicer_remittances` | 1000 | 15 | yes | yes | yes | mig | 2 | live |
| `tax_certificates` | 653 | 23 | yes | yes | yes | mjs | 4 | live |
| `tax_jurisdiction_rules` | 761 | 19 | — | — | — | mjs | 3 | live |

## `shared/schema/onboarding-funnel.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `onboarding_funnel_metrics` | 47 | 16 | yes | — | yes | mjs | 2 | live |

## `shared/schema/outreach-ab.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `outreach_ab_outcomes` | 58 | 6 | — | yes | yes | both | 1 | live |
| `outreach_ab_tests` | 32 | 9 | yes | yes | yes | both | 1 | live |

## `shared/schema/pax-audit.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `pax_audit_findings` | 85 | 12 | — | yes | yes | mjs | 2 | live |
| `pax_audit_runs` | 45 | 10 | yes | yes | yes | mjs | 3 | live |

## `shared/schema/pax-decision-appeals.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `pax_decision_appeals` | 69 | 14 | yes | yes | yes | mjs | 2 | live |

## `shared/schema/pax-refusal-payloads.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `pax_refusal_payloads` | 82 | 9 | yes | yes | yes | mjs | 3 | live |

## `shared/schema/pax-user-context.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `pax_user_context` | 35 | 12 | yes | — | yes | mjs | 2 | live |

## `shared/schema/platform-connections.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `platform_connections` | 36 | 10 | — | — | yes | both | 10 | live |

## `shared/schema/public-api.ts` (4 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `api_key_usage` | 72 | 11 | yes | yes | yes | mig | 1 | live |
| `api_keys` | 41 | 15 | yes | yes | yes | mig | 4 | live |
| `webhook_delivery_log` | 122 | 14 | yes | yes | yes | mig | 1 | live |
| `webhook_subscriptions` | 95 | 12 | yes | yes | yes | mig | 2 | live |

## `shared/schema/recourse-drafts.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `recourse_drafts` | 79 | 17 | yes | yes | yes | both | 2 | live |

## `shared/schema/reg-z.ts` (6 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `late_fee_assessments` | 316 | 15 | yes | yes | yes | mjs | 1 | live |
| `payment_applications` | 188 | 14 | yes | yes | yes | mjs | 3 | live |
| `periodic_statement_skips` | 392 | 8 | yes | yes | yes | mjs | 1 | live |
| `periodic_statements` | 45 | 29 | yes | yes | yes | mjs | 5 | live |
| `respa_outreach_events` | 449 | 11 | yes | yes | yes | mjs | 1 | live |
| `suspense_balances` | 258 | 8 | yes | yes | yes | mjs | 1 | live |

## `shared/schema/rental.ts` (14 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `fcra_attestations` | 145 | 8 | yes | yes | yes | mjs | 1 | live |
| `late_fee_rules` | 705 | 12 | — | — | — | mjs | 1 | live |
| `lease_addendums` | 533 | 10 | yes | yes | yes | mjs | 1 | live |
| `lease_tenants` | 490 | 9 | yes | yes | yes | mjs | 3 | live |
| `maintenance_tickets` | 757 | 21 | yes | yes | yes | mjs | 1 | live |
| `move_inspections` | 806 | 18 | yes | yes | yes | mjs | 2 | live |
| `rent_charges` | 562 | 17 | yes | yes | yes | mjs | 4 | live |
| `rent_payment_allocations` | 666 | 13 | yes | yes | yes | both | 2 | live |
| `rent_payments` | 604 | 18 | yes | yes | yes | mjs | 3 | live |
| `rental_leases` | 393 | 27 | yes | yes | yes | mjs | 10 | live |
| `rental_units` | 281 | 13 | yes | yes | yes | both | 4 | live |
| `security_deposits` | 855 | 24 | yes | yes | yes | mjs | 3 | live |
| `tenant_screenings` | 97 | 23 | yes | yes | yes | mjs | 3 | live |
| `tenants` | 177 | 22 | yes | yes | yes | mjs | 28 | live |

## `shared/schema/reserve-floor-checks.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `reserve_floor_check` | 27 | 9 | — | — | yes | mjs | 2 | live |

## `shared/schema/solene-adversarial-tests.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_adversarial_tests` | 43 | 11 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-agent-claims.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_agent_claims` | 40 | 9 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-agent-identity.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_agent_identity_decisions` | 57 | 12 | — | — | yes | mjs | 4 | live |

## `shared/schema/solene-agent-messages.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `agent_messages` | 36 | 12 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-audit.ts` (3 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_audit_findings` | 113 | 9 | — | yes | yes | both | 3 | live |
| `solene_audit_runs` | 81 | 9 | — | — | yes | both | 3 | live |
| `solene_decisions` | 53 | 8 | — | — | yes | both | 2 | live |

## `shared/schema/solene-capability-proposals.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_capability_introspections` | 81 | 5 | — | — | yes | mjs | 1 | live |
| `solene_capability_proposals` | 40 | 15 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-capital.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_capital_events` | 37 | 6 | — | — | yes | both | 7 | live |

## `shared/schema/solene-confidence-observations.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_confidence_observations` | 39 | 9 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-constitutional-violations.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_constitutional_violations` | 55 | 14 | — | — | yes | mjs | 3 | live |

## `shared/schema/solene-conversations.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_conversations` | 59 | 8 | — | — | yes | mjs | 1 | live |
| `solene_messages` | 103 | 13 | — | — | yes | mjs | 2 | live |

## `shared/schema/solene-counterfactuals.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_counterfactual_analyses` | 32 | 10 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-decision-traces.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_decision_traces` | 43 | 10 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-dispatch.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_dispatch_queue` | 68 | 23 | — | — | yes | mjs | 16 | live |
| `solene_dispatch_results` | 161 | 12 | — | — | yes | mjs | 5 | live |

## `shared/schema/solene-distributed-reasoning.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_reasoning_contributions` | 77 | 8 | — | — | yes | mjs | 1 | live |
| `solene_reasoning_sessions` | 42 | 12 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-embeddings.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_embedded_records` | 87 | 11 | yes | yes | yes | mjs | 2 | live |

## `shared/schema/solene-evidence-weights.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_evidence_assessments` | 46 | 11 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-failure-modes.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_failure_modes` | 33 | 13 | — | — | yes | mjs | 2 | live |

## `shared/schema/solene-founder-collab.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_founder_asks` | 38 | 15 | — | — | yes | mjs | 2 | live |

## `shared/schema/solene-learning-loop.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_retrieval_events` | 42 | 11 | — | — | yes | mjs | 2 | live |

## `shared/schema/solene-memory-files.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_memory_files` | 38 | 11 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-memory-retrieval.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_memory_corpus_status` | 50 | 8 | — | — | yes | mjs | 0 | **DEAD** |

## `shared/schema/solene-model-upgrade.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_model_upgrade_recommendations` | 33 | 12 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-morning-pulse.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_morning_pulse` | 40 | 3 | — | — | yes | mjs | 2 | live |

## `shared/schema/solene-page.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_page_events` | 31 | 7 | — | — | yes | mjs | 3 | live |

## `shared/schema/solene-pipeline.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_pipelines` | 45 | 16 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-plan-proposals.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `plan_proposals` | 39 | 14 | — | — | yes | mjs | 2 | live |

## `shared/schema/solene-pre-call-decisions.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_pre_call_decisions` | 82 | 15 | — | — | yes | mjs | 2 | live |

## `shared/schema/solene-session-tasks.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_session_tasks` | 38 | 11 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-speculations.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_speculations` | 47 | 16 | — | — | yes | mjs | 1 | live |

## `shared/schema/solene-token-economy.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `solene_decision_score_events` | 43 | 12 | — | — | yes | mjs | 1 | live |

## `shared/schema/soren-seo.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `soren_seo_rankings` | 30 | 6 | — | — | yes | mjs | 2 | live |

## `shared/schema/subdivision.ts` (7 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `cc_r_templates` | 375 | 12 | yes | yes | yes | mjs | 1 | live |
| `county_subdivision_timelines` | 315 | 21 | — | — | yes | mjs | 1 | live |
| `lot_basis_allocations` | 210 | 16 | yes | yes | yes | mjs | 2 | live |
| `lot_pricing_rules` | 255 | 13 | yes | yes | yes | mjs | 1 | live |
| `permit_checklists` | 134 | 11 | yes | yes | yes | mjs | 1 | live |
| `permit_gates` | 157 | 19 | yes | yes | yes | mjs | 1 | live |
| `subdivision_plans` | 59 | 17 | yes | yes | yes | mjs | 2 | live |

## `shared/schema/team-improvement.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `team_improvement_opportunities` | 49 | 14 | — | — | yes | mjs | 4 | live |

## `shared/schema/team-system-audit.ts` (2 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `team_system_audit_findings` | 101 | 7 | — | yes | yes | mjs | 2 | live |
| `team_system_audit_runs` | 66 | 7 | — | — | yes | mjs | 2 | live |

## `shared/schema/transparency-reports.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `transparency_reports` | 65 | 13 | — | — | yes | mjs | 2 | live |

## `shared/schema/unattached-inbound.ts` (1 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `unattached_inbound_messages` | 27 | 12 | yes | — | yes | both | 1 | live |

## `shared/schema/wholesale.ts` (6 tables)

| Table | Line | Cols | Org | FK | Idx | DDL | Refs | Liveness |
|---|---|---|---|---|---|---|---|---|
| `buyer_blast_recipients` | 266 | 12 | yes | yes | yes | mjs | 2 | live |
| `buyer_blasts` | 229 | 14 | yes | yes | yes | mjs | 2 | live |
| `contract_assignments` | 313 | 12 | yes | yes | yes | both | 4 | live |
| `double_close_deals` | 162 | 22 | yes | yes | yes | mjs | 1 | live |
| `earnest_money_holds` | 99 | 16 | yes | yes | yes | mjs | 1 | live |
| `wholesaler_state_rules` | 49 | 11 | — | — | — | mjs | 2 | live |

## Dead tables (zero references outside schema files)

Candidates for the deletion-ledger drop process (the same one commit `5ca0f29c` used — verify readers/writers before dropping; that ruling refused 3 of 9 authorized drops on verification):

- `agent_execution_counts` (shared/schema.ts:13628)
- `ai_eval_gate_runs` (shared/schema/etl.ts:285)
- `ai_models` (shared/schema/etl.ts:206)
- `atlas_tool_usage` (server/services/atlasToolRegistry.ts:22)
- `auction_readiness_checklists` (shared/schema.ts:8191)
- `automation_executions` (shared/schema.ts:7562)
- `background_check_results` (shared/schema/compliance.ts:121)
- `borrower_payment_profiles` (shared/schema.ts:794)
- `cma_reports` (shared/schema.ts:8162)
- `cohort_assignments` (shared/schema.ts:6023)
- `comms_provider_quotes` (shared/schema/finance.ts:217)
- `compliance_checklist_items` (shared/schema/compliance.ts:335)
- `contractor_w9_documents` (shared/schema/fix-and-flip.ts:226)
- `county_redemption_rates` (shared/schema.ts:10622)
- `deal_sources` (shared/schema.ts:12450)
- `deferred_revenue` (shared/schema.ts:8961)
- `esign_webhook_events` (shared/schema/marketplace.ts:1130)
- `founder_briefs` (shared/schema.ts:14647)
- `investor_verification_documents` (shared/schema/compliance.ts:73)
- `investor_verification_history` (shared/schema/compliance.ts:100)
- `lien_search_records` (shared/schema.ts:8219)
- `market_indicators_temp` (shared/schema.ts:12303)
- `photo_analysis` (shared/schema/marketplace.ts:769)
- `processed_feedback` (shared/schema.ts:14660)
- `property_photos` (shared/schema/marketplace.ts:725)
- `regulatory_requirements` (shared/schema/compliance.ts:306)
- `retention_events` (shared/schema.ts:5950)
- `scp_evolution_metrics` (shared/schema.ts:18152)
- `shared_deal_links` (shared/schema.ts:14680)
- `solene_memory_corpus_status` (shared/schema/solene-memory-retrieval.ts:50)
- `tax_sale_alerts` (shared/schema.ts:10585)
- `tenant_metrics` (shared/schema/compliance.ts:394)
- `webhook_deliveries` (shared/schema.ts:14690)

## Live tables with no CREATE TABLE in any DDL path

These exist in production only because a Replit-era `drizzle-kit push` created them. Any environment rebuilt from
`migrations/` + `scripts/migrate.mjs` (staging, disaster recovery) will not have them; the first SELECT 500s.
Tracked as `BASELINE_ORPHANS` in `tests/unit/schemaMigrationDrift.test.ts` (baseline 95 pgTable definitions; the 91 below are the live subset).

- `agent_action_log` (shared/schema.ts:14940, 28 runtime ref files)
- `agent_action_undo_log` (shared/schema.ts:15091, 2 runtime ref files)
- `agent_budget_envelopes` (shared/schema.ts:17600, 1 runtime ref files)
- `agent_conversations` (shared/schema.ts:14999, 2 runtime ref files)
- `agent_debates` (shared/schema.ts:15619, 2 runtime ref files)
- `agent_goals` (shared/schema.ts:14978, 2 runtime ref files)
- `agent_improvement_plans` (shared/schema.ts:15430, 1 runtime ref files)
- `agent_initiatives` (shared/schema.ts:15216, 5 runtime ref files)
- `agent_override_learnings` (shared/schema.ts:15072, 2 runtime ref files)
- `agent_performance_reviews` (shared/schema.ts:15249, 4 runtime ref files)
- `agent_playbooks` (shared/schema.ts:15286, 2 runtime ref files)
- `agent_prompt_evolutions` (shared/schema.ts:17816, 5 runtime ref files)
- `agent_spawn_proposals` (shared/schema.ts:17861, 1 runtime ref files)
- `agent_synergy_map` (shared/schema.ts:15716, 1 runtime ref files)
- `agent_workflow_runs` (shared/schema.ts:15148, 1 runtime ref files)
- `agent_workflows` (shared/schema.ts:15114, 1 runtime ref files)
- `attention_insights` (shared/schema.ts:15499, 1 runtime ref files)
- `autonomy_score_snapshots` (shared/schema.ts:17515, 1 runtime ref files)
- `board_decisions` (shared/schema.ts:17724, 1 runtime ref files)
- `board_meetings` (shared/schema.ts:17689, 1 runtime ref files)
- `board_votes` (shared/schema.ts:17707, 1 runtime ref files)
- `build_buy_decisions` (shared/schema.ts:17789, 1 runtime ref files)
- `cascade_resolutions` (shared/schema.ts:17450, 4 runtime ref files)
- `causal_investigations` (shared/schema.ts:15922, 1 runtime ref files)
- `ceo_absence_mode` (shared/schema.ts:15327, 2 runtime ref files)
- `ceo_briefings` (shared/schema.ts:15783, 1 runtime ref files)
- `company_agents` (shared/schema.ts:14769, 24 runtime ref files)
- `company_briefing_cache` (shared/schema.ts:14911, 2 runtime ref files)
- `company_chronicle` (shared/schema.ts:15742, 4 runtime ref files)
- `company_priorities` (shared/schema.ts:15043, 1 runtime ref files)
- `company_seasons` (shared/schema.ts:15684, 2 runtime ref files)
- `compass_recommendations` (shared/schema.ts:15854, 1 runtime ref files)
- `constitutional_principles` (shared/schema.ts:17740, 1 runtime ref files)
- `content_drafts` (shared/schema.ts:18006, 2 runtime ref files)
- `contract_templates` (shared/schema.ts:17653, 1 runtime ref files)
- `county_reviews` (shared/schema.ts:14748, 1 runtime ref files)
- `crisis_playbooks` (shared/schema.ts:17905, 1 runtime ref files)
- `custom_autonomy_rules` (shared/schema.ts:3694, 3 runtime ref files)
- `daily_deal_feed` (shared/schema.ts:14561, 3 runtime ref files)
- `deal_feed_interactions` (shared/schema.ts:14573, 2 runtime ref files)
- `decision_patterns` (shared/schema.ts:15360, 2 runtime ref files)
- `delegated_goals` (shared/schema.ts:15963, 1 runtime ref files)
- `entity_comments` (shared/schema.ts:14590, 1 runtime ref files)
- `error_boundary_trips` (shared/schema/error-boundary-trips.ts:40, 2 runtime ref files)
- `evolution_circuit_breaker` (shared/schema.ts:14429, 4 runtime ref files)
- `evolution_history` (shared/schema.ts:14382, 5 runtime ref files)
- `external_intelligence` (shared/schema.ts:15997, 1 runtime ref files)
- `feature_impact_scores` (shared/schema.ts:17801, 1 runtime ref files)
- `feedback_learnings` (shared/schema.ts:17426, 1 runtime ref files)
- `financial_approvals` (shared/schema.ts:17577, 2 runtime ref files)
- `founder_dependency_events` (shared/schema.ts:17539, 1 runtime ref files)
- `founder_drafts` (shared/schema.ts:15481, 1 runtime ref files)
- `founder_intents` (shared/schema.ts:17476, 2 runtime ref files)
- `founder_overrides` (shared/schema.ts:17405, 4 runtime ref files)
- `founder_twin_context` (shared/schema.ts:15465, 1 runtime ref files)
- `founder_wellbeing` (shared/schema.ts:15655, 3 runtime ref files)
- `institutional_patterns` (shared/schema.ts:15526, 1 runtime ref files)
- `intent_progress_logs` (shared/schema.ts:17498, 1 runtime ref files)
- `lead_emails` (shared/schema.ts:14723, 2 runtime ref files)
- `legal_actions` (shared/schema.ts:17630, 1 runtime ref files)
- `market_adaptations` (shared/schema.ts:17949, 1 runtime ref files)
- `meta_learning_insights` (shared/schema.ts:17877, 1 runtime ref files)
- `mission_statements` (shared/schema.ts:17919, 1 runtime ref files)
- `openrouter_model_catalog` (shared/schema.ts:14358, 2 runtime ref files)
- `outcome_verification_queue` (shared/schema.ts:15020, 2 runtime ref files)
- `perpetual_ops_checks` (shared/schema.ts:17973, 1 runtime ref files)
- `personal_bests` (shared/schema.ts:14705, 1 runtime ref files)
- `platform_issues` (shared/schema.ts:17989, 2 runtime ref files)
- `playbook_evolutions` (shared/schema.ts:15821, 1 runtime ref files)
- `pre_authorized_tradeoffs` (shared/schema.ts:17892, 1 runtime ref files)
- `product_specifications` (shared/schema.ts:17772, 1 runtime ref files)
- `provider_cache` (shared/schema.ts:3556, 2 runtime ref files)
- `quiet_hours_config` (shared/schema.ts:15058, 1 runtime ref files)
- `reaction_chain_links` (shared/schema.ts:17390, 1 runtime ref files)
- `reaction_chain_runs` (shared/schema.ts:17369, 2 runtime ref files)
- `reaction_chains` (shared/schema.ts:17344, 2 runtime ref files)
- `regulatory_feeds` (shared/schema.ts:17930, 1 runtime ref files)
- `regulatory_filing_calendar` (shared/schema.ts:17669, 1 runtime ref files)
- `self_audit_reports` (shared/schema.ts:17962, 1 runtime ref files)
- `signal_correlations` (shared/schema.ts:15557, 1 runtime ref files)
- `spend_anomalies` (shared/schema.ts:17614, 2 runtime ref files)
- `spend_optimizations` (shared/schema.ts:15901, 1 runtime ref files)
- `spend_watchers` (shared/schema.ts:15884, 1 runtime ref files)
- `strategic_compass` (shared/schema.ts:15579, 3 runtime ref files)
- `strategic_plans` (shared/schema.ts:17756, 1 runtime ref files)
- `trust_evolution_log` (shared/schema.ts:14920, 4 runtime ref files)
- `user_activation_events` (shared/schema.ts:14621, 1 runtime ref files)
- `user_feedback` (shared/schema.ts:14632, 2 runtime ref files)
- `user_sessions` (shared/schema.ts:14609, 1 runtime ref files)
- `war_room_messages` (shared/schema.ts:15200, 2 runtime ref files)
- `war_rooms` (shared/schema.ts:15178, 6 runtime ref files)

