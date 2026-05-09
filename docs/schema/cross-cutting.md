# Cross-cutting schema (billing, audit, AI, comms, e-signature)

Tables shared across all 6 verticals. New eng hires read this BEFORE
any per-vertical doc.

## Billing / revenue

| Table | Purpose |
|---|---|
| `organizations` | Top-level tenancy. ownerId + subscriptionTier + billingInterval. |
| `subscription_events` | Tier upgrade/downgrade/cancel history. |
| `revenue_recognition_periods` | ASC 606 ratable recognition (FW-MARISOL-2). |
| `org_vertical_packs` | Vertical add-on pack subscriptions (FW-TEGAN-1). |
| `pricing_experiments` | A/B test assignment + conversion (panel-300 #27). |

Authoritative pricing: `shared/billing/tier-pricing.ts`. NEVER hardcode
tier prices anywhere else.

## Audit + compliance

| Table | Purpose |
|---|---|
| `audit_events` | Append-only via DB trigger (FW-SAM-1). |
| `simulated_actions` | Founder safety harness. |
| `legal_holds` + `legal_holds_scope` | P0-23 — blocks deletes. |
| `dsar_requests_lifecycle` | GDPR DSAR with 24h SLA (panel-300 #26). |
| `fair_lending_audit_runs` | Monthly disparate-impact (panel-300 #34). |
| `vendor_referral_fees` | RESPA transparency (panel-300 #34). |
| `retention_policies` | Per-table retention rules (FW-WYNNE-3). |
| `statutory_forms` | Per-state legal templates (panel-300 #10). |
| `disclosure_timing_scheduled` | TILA T-3 cron (panel-300 #10). |

## AI

| Table | Purpose |
|---|---|
| `ai_models` | Per-model lifecycle (added / deprecated / retired). |
| `ai_test_cases` | Eval harness corpus per surface. |
| `ai_test_runs` | Per-(case, model) run history. |
| `ai_cost_ceiling_overrides` | Per-org daily/monthly $ caps. |
| `ai_telemetry_events` | Per-call cost + latency. |

Eval-as-gate (panel-300 G1) wraps complianceAI.generateDisclosure
via `gateOutputOrThrow()` from server/services/aiEvalHarness.ts.

## Communications + e-signature

| Table | Purpose |
|---|---|
| `email_events` | Outbound email log. |
| `email_suppressions` | Bounce / complaint suppression list. |
| `community_letters` | Founder letters (FW-DIEGO-1). |
| `signatures` | Native e-sign with documentContentHash (P0-3). |
| `signature_requests` | Multi-signer workflows. |
| `dropbox_sign_webhook_events` | Idempotent Dropbox Sign webhook (P0-10). |
| `esign_webhook_events` | Generic e-sign webhook log. |

E-sign integrity stack (FW-HARLOWE-1):
1. Content-hash captured at signature creation
2. Route-level immutability guard
3. DB BEFORE-trigger immutability guard
4. Completion-certificate route with hash re-verification

## Auth + roles + sessions

| Table | Purpose |
|---|---|
| `users` | Local user records (Clerk-synced). |
| `team_members` | Org membership + role. |
| `auth_fail_attempts` | Rate-limit lockout (panel-300 G3). |
| `user_sign_in_locations` | New-location detector (RS-5). |
| `nps_micro_surveys` | D7 NPS + score (FW-CAMILA-2). |
| `pre_churn_rungs` | 5d/10d/14d/21d/30d ladder (FW-CAMILA-3). |

Role-scoped permissions: 11 scopes × 11 roles via
`server/middleware/roleScope.ts`. UI introspects via
`/api/account/role-scopes`.

## Provider + integration

| Table | Purpose |
|---|---|
| `providers` | Provider registry per category. |
| `provider_cache` | Response cache. |
| `synthetic_check_runs` | Vendor health pings every 15min (FW-OLU-2). |
| `vendor_adoption_metrics` | Per-vendor adoption telemetry (panel-300 #25). |
| `reconciliation_rules` + `reconciliation_runs` | Stripe/wire/1099 reconciliation (panel-300 #9). |

## Known cliffs

- **`shared/schema.ts` is 17,468 LOC.** Panel-300 T12 prescribes
  modularization Phase 1 in the 180-day backlog (split into
  per-vertical files). Until then, search-and-jump.
- **86 migration files with one collision.** `scripts/migrate.mjs`
  is hand-rolled idempotent; Drizzle journal stops at 0017.
  Re-runnable + safe; structurally hostile to fast iteration.
- **No FK enforcement on most cross-vertical joins** — the joins
  exist by convention, not by ON DELETE CASCADE. Schema
  modularization Phase 2 (panel-300 #53) addresses this.
