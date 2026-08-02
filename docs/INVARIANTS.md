# AcreOS Invariants

> The statements about this system that must never become false.
>
> **Relationship to `shared/governance/constitution.ts`:** the constitution registry is the
> machine-readable, ratchet-tested source of truth for *standing founder decisions* — it stays
> authoritative for those, and this file must never contradict it. This file is the wider
> engineering superset: it includes the constitutional invariants (cross-referenced by id), plus
> the engineering invariants that are not founder decisions (ledger math, schema discipline,
> audit-chain integrity), plus — clearly separated — the invariants this platform is *supposed*
> to have but does not yet (`ASP-*`). Every one below was verified against code during the
> Phase 0 audit (2026-08-02); enforcement pointers were opened, and the governance test suite
> was executed green (`constitution.test.ts`, `moneyCustodyHardStop.test.ts`,
> `founderFourDoors.test.ts` — 24/24).
>
> **Rules of use:**
> 1. Every change is checked against this file before merge. If a change touches an invariant,
>    say so in the PR and update this file in the same commit.
> 2. An invariant's *gap* note is a debt record, not permission. Closing a gap means adding
>    enforcement and updating both this file and (where applicable) the constitution registry.
> 3. Only the founder can rescind an invariant that mirrors a founder decision, at its source.
> 4. `ASP-*` entries are **aspirational — not current**. Never cite them as existing protection.

Enforcement kinds: `code-invariant` (structural, tested) · `ratchet-test` (vitest ratchet fails build on drift) · `lint` (scripts/*.mjs gate in `npm run check`) · `prose-only` (recorded, **no automated backstop**).

---

## 1. Money

### INV-MONEY-1 — Customer money never moves on AcreOS's own account
Every customer-managed money movement (borrower payments, rent, escrow, distributions) runs on the
customer's OWN connected processor account or is routed out entirely. No platform-account fallback,
no application fee, no funds transiting AcreOS's balance. Subscription payments TO AcreOS are the
only payments AcreOS is a party to. *(Mirrors constitution `rails.customer-money`; founder ruling #15, 2026-07-29.)*
- **Enforcement:** code-invariant + ratchet-test, 3 layers — runtime chokepoint (`server/services/customerMoneyRouting.ts:186-362`, throws `PlatformTakeError` / `UnscopedCustomerMoneyCallError`), repo-wide structural scan + deleted-surface pins (`tests/unit/moneyCustodyHardStop.test.ts`), org-account wiring (`server/services/achAutopay.ts:1412`, `server/services/achMandateSetup.ts:253`).
- **Gap:** chokepoint is opt-in per call site; the static scan is a name-list regex (bracket/dynamic access or a fee-less unscoped charge would evade it). Audit enumerated all current Stripe money call sites: clean.

### INV-MONEY-2 — Spends over $500 are founder-only, forever
Only Tier 1 ($0–500) is autonomous; every larger spend routes to the founder and never self-executes.
*(Mirrors constitution `hard-stop.spend-over-500`.)*
- **Enforcement:** code-invariant — `spendIsAutonomous` Tier-1-only + pre-AI amount block (`server/services/financialAuthorityGate.ts:98-178,290-312`, `server/services/autonomousDecisionExecutor.ts:572,611-616`), pinned by `tests/unit/spendHardStop.test.ts` + constitution ratchet.
- **Gap:** lane-scoped — the support-agent `apply_billing_fix` tool moved uncapped platform-Stripe money outside both enforcement points (confirmed bypass; see `docs/audit/BLAST-RADIUS.md` confirmed bypass #1). **Closing this is Phase 1 work.**

### INV-MONEY-3 — Absolute autonomous-spend ceiling
Above the absolute cap (default $25,000) the system refuses to even *create* an approval record.
- **Enforcement:** code-invariant (`server/services/financialAuthorityGate.ts:59-68,241-258`).
- **Gap:** same lane scoping as INV-MONEY-2; ceiling value is a founder setting (data, not code).

### INV-MONEY-4 — A borrower can never be double-debited
One ACH debit per (note, period, attempt), guaranteed twice over.
- **Enforcement:** code-invariant — unique claim index `ON CONFLICT DO NOTHING` + the same deterministic key replayed as the processor idempotency key (`server/services/achAutopay.ts:57-59,166-167,693-702,1109`).
- **Gap:** none found. Card lane relies on Stripe Checkout session semantics (acceptable).

### INV-MONEY-5 — Paid provider lookups are pre-metered and fail closed
Pre-flight credit balance check; debit only on non-cached, non-BYOK success with a unique
`externalEventId` collapsing retries; empty pool blocks the lookup.
- **Enforcement:** code-invariant (`server/services/providers/provider-registry.ts:150-320`, `server/services/creditPool.ts`).
- **Gap:** callers must check `allowed`; the `enforce:'record'` path deliberately records COGS even on an empty pool (honest soft cap).

## 2. Outbound rails

### INV-RAILS-1 — Counterparty mail requires the org's own connected identity (BYO)
The platform sender is for system mail only; there is no silent platform fallback for
counterparty mail. *(Mirrors constitution rails decision, 2026-07-17.)*
- **Enforcement:** code-invariant, **opt-in** — `purpose:'counterparty'` branch refuses without org identity (`server/services/emailService.ts:317,523-560`); workflow engine source-ratcheted to the counterparty lane (`tests/unit/workflowActionHonesty.test.ts:364-369`).
- **Gap:** `purpose` *defaults to `'system'`*; only ~8 of 42 caller files opt in; confirmed live bypass in the agent-skills `sendEmail` skill; the constitution itself flags the missing ratchet as governance debt. **Flip the default / require the field — Phase 1.**

### INV-RAILS-2 — Platform-keyed physical mail cannot go live unless deliberately armed
Live Lob sends require `NODE_ENV=production` AND `LOB_LIVE_SEND_ENABLED=true`; otherwise the Lob
TEST environment only, and the live key is never returned while disarmed.
- **Enforcement:** code-invariant — env-level interlock the app cannot write (`server/services/mail/liveSendInterlock.ts:24-67`).
- **Gap:** BYOK org keys are deliberately exempt (customer's own account and budget).

### INV-RAILS-3 — No SMS leaves without the TCPA gate
Consent + recipient-local quiet hours + DNC/litigator scrub at the `smsService` chokepoint;
litigators block even with consent; unverifiable consent or a failed scrub fails CLOSED for
marketing traffic. A **selected** DNC vendor with missing credentials returns "not checked" and
blocks (the 2026-07 wave defect is cured and test-pinned).
- **Enforcement:** code-invariant (`server/services/smsService.ts:176-193`, `server/services/compliance/dncScrub.ts:122-170,335-343`; pinned by `tests/unit/dncScrub.test.ts:71`).
- **Gap:** with NO vendor selected (`DNC_SCRUB_PROVIDER` unset) the seam is inert allow-all by design — production arming is a deploy secret the repo cannot prove. Cold SMS is additionally dark on 10DLC by standing choice.

## 3. Founder-only hard stops

### INV-HARD-1 — Pricing changes are founder-only
- **Enforcement:** code-invariant — `BILLING_SUBSCRIPTION_ACTIONS` pre-AI block + static price constants (`server/services/autonomousDecisionExecutor.ts:575-584,626-633`, `shared/billing/tier-pricing.ts`; `tests/unit/founderHardStopGuardrails.test.ts`).
- **Gap:** the guard is a substring denylist over action labels — a novel label evades it; the support-agent credit lane was functionally a pricing/billing adjustment outside this guard (see INV-MONEY-2 gap).

### INV-HARD-2 — Legal signing is founder/human-only
E-sign is human-initiated: HMAC per-signer tokens, ESIGN §101(c) five-disclosure consent with
version pinning persisted to `signingConsentAudit`; autonomous envelope dispatch is blocked pre-AI.
- **Enforcement:** code-invariant (`server/routes-public-sign.ts:29-75,201`, `server/services/autonomousDecisionExecutor.ts:594-602,644-649`).
- **Gap:** honestly scoped in the constitution — a sub-$500 accepted offer letter can still form a contract outside the gate (documented, not mitigated).

### INV-HARD-3 — Customer-data deletion is founder-only
- **Enforcement:** code-invariant — `DATA_DELETION_ACTIONS` + delete/permanent/purge payload flags pre-AI (`server/services/autonomousDecisionExecutor.ts:586-592,636-641,652-657`).
- **Gap:** same denylist shape as INV-HARD-1.

## 4. Navigation doctrine

### INV-NAV-1 — Exactly five customer doors, identical for every persona, never hidden
- **Enforcement:** ratchet-test iterating every persona-axis combination (`tests/unit/sidebarHiddenRoutes.test.ts:31-56`, `tests/unit/mobileNavFixedDoors.test.ts`).
- **Gap:** none.

### INV-NAV-2 — Exactly four founder doors; `/founder/*` route count may only shrink
- **Enforcement:** ratchet-test (`tests/unit/founderFourDoors.test.ts:20,72-81`, baseline 82; `client/src/lib/founder-doors.ts`).
- **Gap:** baseline 82 vs the 4-door north star — sprawl is bounded, not resolved; exactly one file lives under `/founder/admin` today.

## 5. Truth

### INV-TRUTH-1 — No fabrication, ever
No invented numbers, no fake activity, no synthetic processor ids, no phantom action success.
Refuse-not-fabricate everywhere. *(Mirrors constitution no-fabrication.)*
- **Enforcement:** lint + ratchet-test — `scripts/check-no-fabrication.mjs`, fabricated-id scan (`tests/unit/moneyCustodyHardStop.test.ts:221-236`), derived live-trigger set + rail-read-back success ratchet (`tests/unit/workflowActionHonesty.test.ts:348-541`), `noMockWidgets.test.ts`.
- **Gap:** the lint covers known vectors (Math.random allowlist), not the concept. Phase 0 found three live violations of the *spirit*: consent `checkboxChecked` defaulted to `true` in the evidence table (`server/routes-leads.ts:503-505`), valuation comp distance hardcoded to 0 feeding a +15 confidence bonus (`server/services/acreOSValuation.ts:739,1007`), and impersonation's `readOnly/expiresAt` claims enforced by nothing (`server/routes-admin.ts:4533-4562`). All three are Phase 1 fixes.

## 6. Tenancy

### INV-TENANT-1 — Org scoping by construction
A bare-id fetch on an org table must not typecheck; the only sanctioned cross-tenant access is the
greppable `unscopedForPlatformOps(reason)` escape hatch (7 non-test files).
- **Enforcement:** code-invariant + lint — forOrg-only `OrgScopedDb` (`server/utils/orgScopedDb.ts`), `scripts/check-org-scoped-fetch.mjs`, `scripts/check-org-leading-index.mjs`.
- **Gap:** a *type-level* stand-in, not a DB guarantee: 1,417 baselined `as any` in server code can erase it; the lint grandfathers pre-1F storage methods and misses the 51 tables using `orgId`/`tenantId` naming; no RLS floor exists (see ASP-1). The AI response cache had a real cross-tenant leak, fixed 2026-06-10 (`server/services/aiRouter.ts` header) — treat that class as live.

## 7. Audit trail

### INV-AUDIT-1 — Crown-jewel events are hash-chained and append-only
Global `audit_events` chain over an UPDATE-denied table (7-year retention); per-org chained `audit_log`.
- **Enforcement:** code-invariant (`server/utils/auditEventsChain.ts`, exercised by `server/routes-admin-recovery.ts`).
- **Gap:** *coverage* is per-call-site opt-in — AI-initiated Stripe mutations logged only to `paxMemory`; the phone-purchase audit write sits inside a swallowed "non-fatal" catch. Nothing asserts every money/legal/cross-tenant path writes a chained row (see ASP-4).

## 8. Ledger correctness

### INV-LEDGER-1 — Note math is correct to the cent, and there is exactly ONE payoff engine
1,000 randomized amortization schedules validated on five invariants with reproducible seeds; the
four historically divergent payoff paths (one of which invented an "early payoff discount") are
unified on one engine (actual/365 floored, integer cents), every entry point pinned to the identical
number, and issued quotes persisted immutably.
- **Enforcement:** ratchet-test (`tests/unit/amortizationParanoia.test.ts`, `tests/unit/payoffEngineUnification.test.ts`) — executed green in this audit.
- **Gap:** none found in the math. Note: late-fee *assessment* is built but has no production call site, and no forfeiture/contract-for-deed lifecycle exists (capability gaps, not correctness gaps — see the audit §7).

## 9. Schema discipline

### INV-SCHEMA-1 — The schema is monotonic and every table must be reached
Table count is strict-down (ratchet at 748 with per-drop rationales); writer-less and reader-less
tables are counted debt that may only shrink.
- **Enforcement:** ratchet-test + lint (`scripts/ratchets/table-count.json`, `scripts/lint-reachability.mjs` — 45 writer-less / 57 reader-less counted).
- **Gap:** nothing diffs `shared/schema.ts` against the migration paths — "schema table shipped with no migration," the failure mode CLAUDE.md documents, has no dedicated gate; 95 pgTable definitions have no CREATE anywhere (`tests/unit/schemaMigrationDrift.test.ts` baseline; 91 live). The production DDL path (`scripts/migrate.mjs`) downgrades "relation does not exist" to a non-fatal skip and is executed by no CI job. **The drift class that caused the users-table outages remains open — Phase 1 closes it.**

## 10. Expansion gates & AI surface

### INV-EXPANSION-1 — No marketplace before ~25 customers; no public API before ~50
- **Enforcement:** prose-only with structural friction — marketplace behind `featureGate('feature_marketplace')` (`server/routes.ts:1323`); the api-v1 router deliberately unmounted, pinned as the reachability ratchet's single allowed unmounted route.
- **Gap:** no automated customer-count gate; the constitution labels this governance debt honestly.

### INV-AI-1 — Pax stays ambient fabric; no new AI destinations
- **Enforcement:** prose-only, indirectly backed by the five-door ratchet.
- **Gap:** no dedicated Pax-surface gate (acknowledged governance debt).

### INV-DATA-1 — No residential-comps data plane before its revenue trigger
Residential lookups ride the existing provider registry (ATTOM exception recorded, ruling #11).
- **Enforcement:** code-invariant (`server/services/residentialComps.ts` restricted to the registry seam; `shared/governance/constitution.ts:287-298`).
- **Gap:** none.

---

## ASPIRATIONAL — demanded by the transformation charter, NOT current

### ASP-1 — Database-level tenant isolation (Postgres RLS)
Does not exist: zero `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` anywhere in `migrations/`,
`scripts/migrate.mjs`, or `server/`. Explicitly deferred in code (`server/utils/orgScopedDb.ts:31-33`,
citing pgBouncer transaction mode + table count). Tenant isolation today is 100% application-layer
WHERE clauses across ~400 org-scoped tables. The audit's recommendation: pilot RLS on the ten
hottest tenant tables via per-transaction `SET LOCAL` GUC set inside the existing `forOrg` /
`unscopedForPlatformOps` chokepoints, with a down-only "tables without RLS" ratchet.

### ASP-2 — Transactional outbox for every external side effect
A real outbox exists for accounting ops (`outbox` + `outbox_dlq`, dedicated Fly worker — the
strongest piece of the data plane), but it is not the universal pattern: external sends generally
fire in-band, and the public-API webhook dispatcher's retry/DLQ machinery is a self-admitted
unwired scaffold (`server/services/publicWebhookDispatcher.ts:20-23` — zero background consumers).

### ASP-3 — Universal idempotency on state-changing routes
`idempotencyMiddleware` covers ~10 route groups (billing, e-sign, SMS, api-v1). Not universal:
the direct-mail pool debit key embeds `Date.now()` (client retry double-debits,
`server/routes-outreach-mail.ts:449-459`); phone-number purchase has no key; the middleware's
in-memory fallback store is per-process on a multi-machine Fly deploy.

### ASP-4 — Enforced audit coverage on every blast-radius path
The primitives are excellent (INV-AUDIT-1); no test enumerates the spend/send/legal/cross-tenant
entrypoints and asserts each writes a chained audit row. Write it the way `moneyCustodyHardStop`
is written — derived in both directions.

### ASP-5 — Bitemporal parcel/valuation truth
`parcel_observations` is a genuine single-axis observation ledger (observedAt + provenance), but
"what did we believe this parcel was worth on date X, and when did we learn otherwise" is
unanswerable. Scope: valid-time on `valuation_predictions` with a supersedes chain when the
valuation surface is next touched — not bitemporality across 748 tables.
