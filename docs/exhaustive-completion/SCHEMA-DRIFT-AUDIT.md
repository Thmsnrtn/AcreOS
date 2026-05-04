# Schema-Drift Audit — Phase 3.0 Discovery

**Date:** 2026-05-04T21:35:32.195Z
**Database queried:** postgres://postgres:***@acreos-pg.flycast:5432/acreos
**shared/schema.ts version:** as of working tree (no git revision lookup)

---

## Sweep status

| Batch | Scope | Status | Notes |
|---|---|---|---|
| 1 | `outbox` + `outbox_dlq` + `job_runs` | ✅ **clean** (2026-05-04) | tables landed via migrate.mjs; worker `ANY(arr)` query bug surfaced + fixed (commit 14e87630, see §"Worker query notes" below) |
| 2 | compliance + audit (legal_holds, dsar_requests, data_processing_agreements, compliance_validations, prompt_versions, ai_injection_attempts, ai_routing_overrides, critical_alert_acks) | pending | next |
| 3-9 | see plan | pending | |

---

## Worker query notes

The first attempt to fix the worker's array-binding bug (`AND event_type = ANY(${arr}::text[])`, commit b22055c7) **did not work**: Drizzle's `sql\`${arr}\`` template expands a JS array as N positional placeholders *before* the cast applies, so the rendered SQL became `ANY(($1, $2, ..., $6)::text[])` — Postgres treats `(1,2,...)` as a record, and casting record-to-array fails with 42809.

The working fix (commit 14e87630) replaces `ANY(arr)` with `IN (...)` via `sql.join(arr.map(t => sql\`${t}\`), sql\`, \`)`, producing `event_type IN ($1, $2, ..., $6)`. Each value gets its own positional placeholder, no array-binding ambiguity. Semantically equivalent for small constant sets.

**General rule for Drizzle sql templates:** prefer `IN (sql.join(...))` over `ANY($::text[])` when binding a JS array of values. The `::text[]` cast doesn't reach the array because the array is already expanded by the time the cast applies.

---

## Summary

| Category | Count |
|---|---|
| Declared tables | 500 |
| Tables in prod | 440 |
| Missing tables | **62** |
| Missing columns | **25** |
| Missing extensions | **2** |

---

## Missing extensions (HIGH risk — may not be available)

- `vector` — ⚠ Confirmed unavailable on current Fly Postgres image. Postgres image upgrade required separately.
- `unaccent` — additive — `CREATE EXTENSION IF NOT EXISTS`.

---

## Missing tables (LOW risk — additive)

Each is a `CREATE TABLE IF NOT EXISTS` that adds the table without touching existing data.

| # | Table | Canonical migration | Columns declared |
|---|---|---|---|
| 1 | `account_ledger_entries` | `0042_chart_of_accounts.sql`, `0063_customer_unit_economics.sql` | 10 |
| 2 | `acquired_notes` | `0073_acquired_notes.sql` | 25 |
| 3 | `activation_events` | `0055_activation_retention.sql` | 6 |
| 4 | `adjacent_verticals_waitlist` | _(not found)_ | 4 |
| 5 | `ai_injection_attempts` | `0065_compliance_validations.sql` | 7 |
| 6 | `ai_routing_overrides` | `0060_ai_routing_overrides.sql` | 11 |
| 7 | `ai_usage_daily` | `0047_ai_quota.sql`, `0063_customer_unit_economics.sql` | 7 |
| 8 | `cancellation_surveys` | _(not found)_ | 9 |
| 9 | `chart_of_accounts` | `0042_chart_of_accounts.sql` | 9 |
| 10 | `churn_reasons` | `0055_activation_retention.sql` | 8 |
| 11 | `cohort_assignments` | `0055_activation_retention.sql` | 7 |
| 12 | `compliance_validations` | `0065_compliance_validations.sql` | 14 |
| 13 | `cost_optimization_runs` | `0062_cost_optimization.sql` | 10 |
| 14 | `critical_alert_acks` | `0053_saved_replies.sql` | 10 |
| 15 | `customer_concentration` | `0048_stripe_tax_concentration_deferred.sql` | 10 |
| 16 | `customer_unit_economics` | `0063_customer_unit_economics.sql` | 22 |
| 17 | `data_processing_agreements` | `0049_dsar_audit_subprocessors.sql` | 11 |
| 18 | `deferred_revenue` | `0048_stripe_tax_concentration_deferred.sql` | 13 |
| 19 | `dsar_requests` | `0049_dsar_audit_subprocessors.sql` | 17 |
| 20 | `email_reputation_snapshot` | `0056_eleonora_deliverability.sql` | 11 |
| 21 | `email_templates` | `0064_lifecycle_program.sql` | 10 |
| 22 | `email_warmup_state` | `0056_eleonora_deliverability.sql` | 8 |
| 23 | `etl_jobs` | `0070_etl_orchestrator.sql` | 15 |
| 24 | `etl_runs` | `0070_etl_orchestrator.sql` | 13 |
| 25 | `export_jobs` | `0069_import_export_jobs.sql` | 14 |
| 26 | `feedback_submissions` | _(not found)_ | 11 |
| 27 | `field_scout_photos` | `0003_robust_namora.sql`, `0072_field_scout_photo_hash.sql` | 15 |
| 28 | `field_scout_visits` | `0003_robust_namora.sql` | 13 |
| 29 | `form_1099_batches` | `0059_recognition_worker.sql` | 11 |
| 30 | `import_jobs` | `0069_import_export_jobs.sql` | 19 |
| 31 | `integration_status` | _(not found)_ | 9 |
| 32 | `job_runs` | `0046_outbox_jobs.sql` | 7 |
| 33 | `lead_assignment_rules` | `0066_team_readiness.sql` | 11 |
| 34 | `legal_holds` | `0057_legal_holds.sql` | 13 |
| 35 | `lifecycle_message_sends` | `0064_lifecycle_program.sql` | 13 |
| 36 | `ml_training_snapshots` | `0058_ml_training_snapshots.sql` | 11 |
| 37 | `note_payments` | `0007_composite_indexes.sql`, `0073_acquired_notes.sql` | 12 |
| 38 | `nps_responses` | `0012_nps_churn_risk.sql` | 7 |
| 39 | `offer_approvals` | `0066_team_readiness.sql` | 11 |
| 40 | `org_assignment_cursor` | `0066_team_readiness.sql` | 4 |
| 41 | `org_co_owners` | `0054_co_owners.sql` | 5 |
| 42 | `org_email_identities` | `0056_eleonora_deliverability.sql` | 15 |
| 43 | `org_integrations_slack` | `0066_team_readiness.sql` | 11 |
| 44 | `outbox` | `0046_outbox_jobs.sql`, `0064_lifecycle_program.sql`, `0070_etl_orchestrator.sql` | 9 |
| 45 | `outbox_dlq` | `0046_outbox_jobs.sql`, `0070_etl_orchestrator.sql` | 10 |
| 46 | `prompt_versions` | `0065_compliance_validations.sql` | 15 |
| 47 | `property_vision_snapshots` | `0067_property_vision_snapshots.sql` | 16 |
| 48 | `reactivation_tokens` | `0064_lifecycle_program.sql` | 7 |
| 49 | `recognition_runs` | `0059_recognition_worker.sql` | 10 |
| 50 | `recognition_schedules` | `0059_recognition_worker.sql` | 13 |
| 51 | `refund_requests` | _(not found)_ | 13 |
| 52 | `retention_events` | `0055_activation_retention.sql` | 7 |
| 53 | `scp_evolution_metrics` | `0022_scp_v2_memory_system.sql` | 16 |
| 54 | `scp_golden_cases` | `0022_scp_v2_memory_system.sql` | 9 |
| 55 | `scp_procedures` | `0022_scp_v2_memory_system.sql` | 19 |
| 56 | `scp_semantic_facts` | `0022_scp_v2_memory_system.sql` | 18 |
| 57 | `scp_shared_memory` | `0022_scp_v2_memory_system.sql` | 13 |
| 58 | `support_saved_replies` | `0053_saved_replies.sql` | 7 |
| 59 | `title_orders` | `0068_title_partners.sql` | 24 |
| 60 | `title_partners` | `0068_title_partners.sql` | 13 |
| 61 | `unsubscribe_tokens` | `0056_eleonora_deliverability.sql` | 5 |
| 62 | `vm_resource_usage` | `0061_vm_resource_usage.sql` | 20 |

---

## Missing columns on existing tables (MEDIUM risk)

`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is safe but the column's
absence may have caused silent SELECT failures or NULL coalescence in
application code.

| # | Table | Column | Canonical migration |
|---|---|---|---|
| 1 | `deal_patterns` | `embedding_refreshed_at` | `0052_pgvector_columns.sql` |
| 2 | `dunning_events` | `sms_sent_at` | `0048_stripe_tax_concentration_deferred.sql` |
| 3 | `email_suppressions` | `bounce_category` | `0056_eleonora_deliverability.sql` |
| 4 | `email_suppressions` | `last_soft_bounce_at` | `0056_eleonora_deliverability.sql` |
| 5 | `email_suppressions` | `organization_id` | `0056_eleonora_deliverability.sql`, `0000_sleepy_betty_ross.sql`, `0001_brief_giant_man.sql`, `0002_puzzling_millenium_guard.sql`, `0003_robust_namora.sql`, `0006_goals_portfolio_push.sql`, `0007_composite_indexes.sql`, `0012_nps_churn_risk.sql`, `0013_index_audit.sql`, `0014_direct_mail_attribution_and_api_keys.sql`, `0015_pax_deep_features.sql`, `0016_pax_connectors.sql`, `0017_pax_next_gen.sql`, `0018_pax_task_runs.sql`, `0024_cascade_critical_fks.sql`, `0025_credit_allowance_month_unique.sql`, `0026_organization_invitations.sql`, `0027_agent_llm_traces.sql`, `0042_chart_of_accounts.sql`, `0043_subscription_history.sql`, `0045_index_audit.sql`, `0047_ai_quota.sql`, `0048_stripe_tax_concentration_deferred.sql`, `0049_dsar_audit_subprocessors.sql`, `0053_saved_replies.sql`, `0054_co_owners.sql`, `0055_activation_retention.sql`, `0057_legal_holds.sql`, `0058_ml_training_snapshots.sql`, `0059_recognition_worker.sql`, `0063_customer_unit_economics.sql`, `0064_lifecycle_program.sql`, `0065_compliance_validations.sql`, `0066_team_readiness.sql`, `0067_property_vision_snapshots.sql`, `0068_title_partners.sql`, `0069_import_export_jobs.sql`, `0072_field_scout_photo_hash.sql`, `0073_acquired_notes.sql` |
| 6 | `email_suppressions` | `soft_bounce_count` | `0056_eleonora_deliverability.sql` |
| 7 | `leads` | `phone_normalized` | `0051_phone_normalized.sql` |
| 8 | `leads` | `tax_id` | `0035_tax_identity_columns.sql` |
| 9 | `leads` | `tax_id_type` | `0035_tax_identity_columns.sql` |
| 10 | `organizations` | `autopay_frozen` | `0040_organizations_autopay_frozen.sql` |
| 11 | `organizations` | `autopay_frozen_at` | `0040_organizations_autopay_frozen.sql` |
| 12 | `organizations` | `autopay_frozen_reason` | `0040_organizations_autopay_frozen.sql` |
| 13 | `organizations` | `autopay_frozen_until` | `0040_organizations_autopay_frozen.sql` |
| 14 | `organizations` | `billing_interval` | `0037_organizations_billing_interval.sql`, `0043_subscription_history.sql` |
| 15 | `organizations` | `ein` | `0035_tax_identity_columns.sql`, `0016_v11_anticipatory_enterprise.sql`, `0018_v13_sentient_enterprise.sql`, `0036_skip_trace_pii_encryption.sql`, `0066_team_readiness.sql` |
| 16 | `organizations` | `investor_type` | `0073_acquired_notes.sql` |
| 17 | `organizations` | `legal_entity_name` | `0035_tax_identity_columns.sql` |
| 18 | `organizations` | `org_ai_quota_daily_usd` | `0047_ai_quota.sql` |
| 19 | `organizations` | `requires_approval_offers_over` | `0066_team_readiness.sql` |
| 20 | `organizations` | `seat_count` | `0066_team_readiness.sql` |
| 21 | `organizations` | `tax_address` | `0035_tax_identity_columns.sql` |
| 22 | `organizations` | `tax_id_type` | `0035_tax_identity_columns.sql` |
| 23 | `properties` | `land_status` | `0038_land_status.sql`, `0045_index_audit.sql` |
| 24 | `signatures` | `document_content_hash` | `0033_signature_document_content_hash.sql` |
| 25 | `team_members` | `view_only_assigned_leads` | `0054_co_owners.sql` |

---

## Recommended execution order

1. **Extensions** — apply first (cheap; some columns/indexes depend on them)
2. **Tables** — alphabetical-by-domain, grouped where related (outbox + outbox_dlq + job_runs together; etl_jobs + etl_runs together; etc.)
3. **Columns** — after all tables exist (some columns reference foreign keys to tables added in step 2)
4. **pgvector** — DEFER. Unavailable on current Fly Postgres image; needs Postgres image upgrade.

---

## Estimated time

- Mechanical work: ~132 minutes (extracting CREATE/ALTER blocks, pasting into migrate.mjs)
- Deploy + verify cycles: ~5-7 deploys at ~5 min each = ~30-35 minutes
- Total: **~3-3 hours** end to end

---

*Generated by `scripts/audit-schema-drift.mjs` — re-run after each batch to track progress.*