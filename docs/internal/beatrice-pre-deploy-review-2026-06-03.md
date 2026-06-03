---
title: Pre-deploy adversarial review — 127-commit batch
date: 2026-06-03
reviewer: Beatrice (CRO)
verdict: approve-with-conditions
batch_size: 127 commits, 538 files, +55675 -8936 lines
---

## 0. Verdict + reasoning

**Approve with three conditions.** The batch is architecturally clean — TypeScript compiles, migrations are idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), currency uses `bigint cents` or `numeric(10,4)` (no float drift), and the major new chargeable surfaces (Reg-Z statements, dispatch cost cap, borrower portal) have idempotency keys and auth gating. The three conditions are: **(C1)** OFAC SDN screening is fail-open on DB read failure AND on empty-table — this is documented but production must add an "ingest-fired-at-least-once" precondition; **(C2)** stage the deploy as `app-only first, worker second` to keep customer surface independent of the new dispatch worker; **(C3)** deploy during a low-traffic UTC-evening window with a 60-minute on-call.

This is read-only review — no code touched, no migration applied.

---

## 1. Constitutional immutables (the 12)

### Surface map for new code paths
- **#1 (never lie / customer-facing facts)** — guarded at the tool-call layer via `screenToolCall` in `server/services/solene/constitutionalGuard.ts:371` and at the pre-call layer via `checkPromptAgainstConstitution` in `server/services/solene/preCallConstitutionalChecker.ts:409`. Both screen agent dispatches before money/customer-data tool use.
- **#3 (data minimization)** — `signup_signals` table (`scripts/migrate.mjs:4573`) stores honeypot value, TTF, UA, and `ip_bucket` (a /24 truncation). `email_hash` (SHA-256) is stored — not raw email. **Compliant.**
- **#7 (always disclose AI use)** — clickwrap + pax_disclosure landed (`migrations/0105_users_pax_disclosure.sql`, `migrations/0106_users_clickwrap_acceptance.sql`). New `users.pax_disclosure_acknowledged_at` + `tos_accepted_at` + `privacy_accepted_at` columns. **Compliant.**
- **#12 (Pax never crosses into fiduciary)** — pax-audit ledger (`pax_audit_runs` / `pax_audit_findings` in `scripts/migrate.mjs:4617-4648`) runs continuous detection. **Compliant.**

### Findings
**F1.1 — informational — non-blocking.** The `CREDENTIAL_PATTERNS` comment in `server/services/solene/constitutionalGuard.ts:296` mis-attributes the `phc_` prefix to "Stripe webhook signing secrets." Per `feedback_credential_value_handling.md`, `phc_` is the **PostHog public project token** prefix; Stripe webhook secrets are `whsec_`. The regex itself is harmless (it still scrubs `phc_*`), but the comment will mislead a future reviewer. Suggest comment fix post-deploy.

**F1.2 — informational — non-blocking.** The pre-call checker is fail-open by design (`preCallConstitutionalChecker.ts:404-446`) — documented as "never brick the worker loop." This is the right call for a soft enforcement layer, but it means the L6.28 guard does NOT protect against constitutional violations during ANTHROPIC outage. Compensating control: `screenToolCall` (L6.29) is sync + DB-only and DOES still fire.

**F1.3 — no findings — surface clean.** No new code path creates an unscreened entry to the Anthropic SDK. All dispatches funnel through `dispatchRunner.ts:361` which requires `ANTHROPIC_API_KEY` and is preceded by `checkPromptAgainstConstitution`.

---

## 2. Money-touching paths

### Schema currency precision
- `periodic_statements.amount_due_cents bigint`, `principal_balance_cents bigint`, `payoff_cents bigint`, `ytd_*_cents bigint` (`scripts/migrate.mjs:4409-4439`) — **bigint cents, no float drift. Compliant.**
- `payment_applications.applied_to_*_cents bigint` (`scripts/migrate.mjs:4444-4462`) — **compliant.**
- `late_fee_assessments.fee_amount_cents bigint` (`scripts/migrate.mjs:4477-4495`) — **compliant.**
- `solene_capital_events.cost_usd numeric(10,4)` (`scripts/migrate.mjs:4708-4718`) — 4dp, sub-cent precision adequate for token-cost accounting. **Compliant.**
- `solene_decisions.capital_impact_usd numeric(10,4)` (`scripts/migrate.mjs:4658-4666`) — **compliant.**

### Idempotency
**F2.1 — high — non-blocking (already mitigated).** §1026.36(c)(2) late-fee non-pyramiding: `late_fee_assessments` has `(loan_id, period_start, loan_type)` unique index (`scripts/migrate.mjs:4504`) — the `loan_type` was added in commit `4608f85b` to prevent acquired-note vs originated-note id collisions. **Idempotency on duplicate-fee assessment: enforced.**

**F2.2 — high — non-blocking.** `periodic_statements` has `(loan_id, cycle_start)` unique index (`scripts/migrate.mjs:4442`) — duplicate-statement INSERT will fail. **Idempotency: enforced.**

**F2.3 — high — non-blocking.** `payment_applications` has `payment_uk` on `payment_id` (`scripts/migrate.mjs:4462`) — a duplicate webhook replay cannot re-apply the same payment. **Compliant.**

**F2.4 — medium — non-blocking.** `respa_outreach_events` has `(org_id, loan_id, loan_type, event_type, cycle_anchor)` unique index (`scripts/migrate.mjs:4571`) — single early-intervention outreach per cycle anchor. **Compliant.**

**F2.5 — medium — non-blocking.** `periodic_statement_skips` has `(org_id, note_table, note_id, cycle_start)` unique index (`scripts/migrate.mjs:4542`) — a silent skip surfaces in the audit ledger exactly once, with the §-citation reason. This satisfies Beatrice's own ruling in `docs/legal/acquired-notes-1026-41-ruling.md`. **Compliant.**

### Cost-cap enforcement
**F2.6 — medium — non-blocking.** Dispatch worker checks `costSoFar > maxCostUsd` **before** the next Anthropic turn (`server/services/solene/dispatchRunner.ts:517-527`). First turn always executes (cost-cap evaluated only at turn boundary) — acceptable, since a single turn cannot exceed ~$0.50 on max-token budget. **Compliant.**

**F2.7 — medium — non-blocking.** Per-org daily AI budget enforced via `expensiveEndpointGuard` (`server/middleware/expensiveEndpointGuard.ts`, commit `4244f9b6`) wired onto `/api/today`, `/api/pax/*`, `/api/ai/chat`, `/api/ai/chat/stream`. **Tier-aware caps + soft-degrade with structured `Errors.limitExceeded` payload — compliant.**

### Audit trail
**F2.8 — medium — non-blocking.** Every chargeable Reg-Z event persists with `citation` field carrying the §-reference (`periodic_statement_skips.citation`, `respa_outreach_events.citation`, `payment_applications.reg_citation default '12 C.F.R. §1026.36(c)(1)(i)'`). Examiner-readable reconstruction: **achievable from these tables alone.**

---

## 3. Customer-data paths

### OFAC fail-open posture — **conditional blocker**
**F3.1 — high — CONDITION C1.** `server/services/sanctionsList.ts:138-162` documents and implements **fail-open** on DB read failure: "we never want to block all signups because the ingest job hasn't fired." `getOrCreateOrg.ts:182-187` also fails open if the sanctions module fails to import. This is documented as a Phase 0 design choice, BUT: if the cron has never run in production (e.g., first deploy), the table is empty and **every signup passes the OFAC check**.

- The directive in this review was "Production must be fail-closed on signup." The code is fail-open.
- **Mitigation 1 (recommended):** Run `refreshOfacSdnList()` manually via `fly ssh console` **before** opening signup traffic. Then the table has ≥1 row and the lookup is meaningful.
- **Mitigation 2 (recommended):** Add a `sanctions_list_freshness` precondition — if the most-recent `fetched_at` is older than 48 hours OR the row count is < 100, treat as fail-closed (return 503 with retry-after). This is a follow-up, not blocking, IF mitigation 1 is performed pre-deploy.

The country quick-block (`SANCTIONED_COUNTRIES` set, `sanctionsList.ts:53-61`) is in-memory and always works. **Comprehensive countries (CU, IR, KP, SY, RU, BY, AF) are blocked even with empty SDN table — partial defense holds.**

### Bot-signal data retention
**F3.2 — medium — non-blocking.** `signup_signals` table stores `email_hash` (SHA-256), `user_id`, `user_agent`, `ip_bucket` (/24). Email is **never** stored raw — only the hash (`getOrCreateOrg.ts:406`). UA is stored raw. There is **no explicit retention policy** on this table — recommend a 90-day pruner job (drop rows where `captured_at < now() - 90 days`) added post-deploy. **Not blocking** since no PII-link beyond hash + IP-bucket.

### Statement PDFs
**F3.3 — medium — non-blocking.** `periodic_statements.pdf_s3_key` exists but the borrower download route (`server/routes-borrower.ts:1120-1189`) **re-renders the PDF on demand** from the persisted snapshot — no S3 GET. Access gated by `validateBorrowerSession` (`routes-borrower.ts:106`) which re-asserts `(session.organizationId, note.organizationId)` match. **Org-pinned + auth-gated — compliant.**

**F3.4 — high — non-blocking — pre-existing.** A separate route `/api/borrower/statements/generate` (`routes-borrower.ts:947`) is **unauthenticated** and takes `accessToken` and `email` in URL **query string** — query strings hit access logs / Sentry breadcrumbs / Cloudflare logs. This is NOT part of this batch (it predates the §1026.41 work), but it now lives next to the new statements infra and will look like the same surface to a reviewer. Flagging for a follow-up to move the email into the request body or migrate to the session-gated route.

---

## 4. Auth path + rate limits

### Middleware order in `getOrCreateOrg` (the real signup chokepoint)
Verified order in `server/middleware/getOrCreateOrg.ts:135-225`:

1. Provision branch entered (`!org`)
2. `provisionUser()` — `signupLimiter` invoked programmatically (`getOrCreateOrg.ts:362-389`)
3. `signupSignals` cross-reference (`getOrCreateOrg.ts:404-432`)
4. `checkSignup` (OFAC + sanctioned-country) (`getOrCreateOrg.ts:155-188`)
5. `withTransaction` org + team_member INSERT (`getOrCreateOrg.ts:197-224`)

**F4.1 — no findings — order is correct.** Rate-limit → bot-signal → sanctions → provision. A blocked signup at any step short-circuits **before** any DB row is written.

### Cellular-NAT safety
**F4.2 — medium — non-blocking.** `signupLimiter` is dual-lane (`server/middleware/authPathLimits.ts:314`): primary lane keyed by email, secondary by `/24 IP-bucket`. Test coverage in `server/middleware/authPathLimits.test.ts:144-180` includes the carrier-NAT case. **Compliant per `feedback_rate_limit_ip_keying.md`.**

### Chargeable endpoint protection
**F4.3 — low — non-blocking.** `expensiveEndpointGuard` requires `isAuthenticated + getOrCreateOrg` to have populated `req.organization` and `req.organizationId` before checking the per-org daily cap. No path was found where an unauthed request can hit an Anthropic-cost endpoint.

---

## 5. Migration safety

### Idempotency
- **4 versioned SQL migrations** in `migrations/` (0105–0108) — all use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`. Spot-checked `0107_solene_self_audit.sql` and `0108_solene_capital_events.sql`. **Idempotent.**
- **~50+ table+ALTER statements** in `scripts/migrate.mjs` (the release-command script). Sequential `for` loop. Every statement is guarded with `IF NOT EXISTS`. **Idempotent.**

### Order-dependency
**F5.1 — no findings — FK ordering is clean.** All new tables reference either (a) the pre-existing `organizations.id`, or (b) a same-batch table that appears EARLIER in `scripts/migrate.mjs`:
- `pax_audit_runs` (`:4617`) → `pax_audit_findings` (`:4632`) ✓
- `solene_audit_runs` (`:4671`) → `solene_audit_findings` (`:4685`) ✓
- `team_system_audit_runs` (`:4894`) → `team_system_audit_findings` (`:4905`) ✓
- The Solene dispatch tables (`solene_dispatch_results`, `solene_agent_claims`, `solene_pre_call_decisions`, `solene_constitutional_violations`, `solene_decision_score_events`) reference `dispatch_id` **without a FK** — intentional, so dispatch_queue can be purged independently. **Compliant.**

### Drop-and-recreate hazards
**F5.2 — low — non-blocking.** `scripts/migrate.mjs:4503` has `DROP INDEX IF EXISTS "late_fee_assessments_loan_period_uk"` immediately followed by `CREATE UNIQUE INDEX IF NOT EXISTS` with the `loan_type`-augmented column list. The old index is dropped only if it exists — on a brand-new DB it never existed, so this is a no-op. **No data loss risk.**

**F5.3 — low — non-blocking.** No `DROP TABLE`, no `DROP COLUMN`, no `ALTER TYPE` in the batch. No data is destroyed.

### Index lock potential
**F5.4 — medium — non-blocking.** New indexes are all on **new** tables (zero rows) — no lock-on-create risk. Backfill-style operations are absent from this batch.

### Migration parity guardrail
**F5.5 — no findings.** Several migrations annotate "Mirrors `shared/schema/...` and `scripts/migrate.mjs` (CI guardrail enforces parity)." Parity guardrail referenced but not exercised in this review.

---

## 6. Credential handling + security

### `sanitizeEvidence` coverage
**F6.1 — high — non-blocking — see F1.1.** `server/services/solene/constitutionalGuard.ts:310-319` covers: `sk_/pk_` (Stripe), `phc_` (PostHog public), `phx_` (PostHog personal), `ghp_` (GitHub), `Bearer *`, `AKIA/ASIA` (AWS), `xox*` (Slack), `eyJ*.*.* ` (JWT). **Coverage matches the prefixes leaked on 2026-06-02 per `feedback_credential_value_handling.md`.** The `phc_` comment is incorrect (calls it "Stripe webhook"); the regex is correct.

**F6.2 — informational — non-blocking.** No `whsec_` (Stripe webhook signing) coverage in the sanitizer. Add post-deploy if Stripe webhooks are ever logged.

### Pre-call key handling
**F6.3 — no findings.** `server/services/solene/preCallConstitutionalChecker.ts:418-452` reads `ANTHROPIC_API_KEY` and logs **only `keyLen`** (`:451`). No value-bearing log statement found in this file.

### Dispatch worker key handling
**F6.4 — no findings.** `server/services/solene/dispatchRunner.ts:361-363` reads `ANTHROPIC_API_KEY` and logs presence ("set" / "not set") only. No value path to stdout.

### Secret files in tree
**F6.5 — no findings.** `git ls-files` includes only `.env.example`. `.gitignore` excludes `.env`, `.env.*`, `.env*.local`. `git log --all --diff-filter=A` shows no commit ever added a real env file.

### OFAC list as a leak vector
**F6.6 — no findings.** `sanctionsList.ts:301-303` logs `{fetched, inserted, durationMs}` only — no name, no hash content. The stored `name_country_hash` is a 24-hex-char SHA-256 truncation — not reversible to PII. **Compliant.**

### Logging PII
**F6.7 — low — non-blocking.** `getOrCreateOrg.ts:227, 277, 394` log `metadata.email = userEmail` on warn/info paths. This is PII in application logs. Acceptable for founder-creation paths (line 227, 277 — bounded set). The `provisionUser` warn at line 394 logs email on signup-block — acceptable for fraud investigation, but consider hashing post-deploy.

---

## 7. Deploy strategy + rollback

### Recommendation: **STAGED — app-only deploy first, worker second**

The customer-facing app machines (`processes.app`) run Express + WebSocket — borrower portal, signup, Pax chat, statements. The worker (`processes.worker`) runs `dist/worker.cjs` which polls the outbox and now includes the new Solene dispatch worker (the agentic L1-L6 build).

**Why stage:**
- If a regression in the new dispatch-runner / pre-call-checker / multi-agent-review code path crashes the worker, customer surface stays up — borrowers can still pay, sign up, and download statements.
- If a regression in the auth path (rate-limit / OFAC / signup-signals) breaks signup, we know it's NOT the dispatch worker.

**Deploy sequence:**

```bash
# 0. Pre-deploy: prime OFAC SDN list (mitigates F3.1)
fly ssh console -a acreos -C "node -e 'require(\"./dist/index.cjs\")' " &  # warm
fly ssh console -a acreos -C "node -e 'import(\"./server/services/sanctionsList.js\").then(m => m.refreshOfacSdnList())'"
fly ssh console -a acreos -C "psql \$DATABASE_URL -c 'SELECT count(*) FROM sanctions_list;'"
# verify count > 8000 typical for OFAC SDN

# 1. Deploy with release_command (runs migrate.mjs in one-shot release VM)
git push origin main
fly deploy --build-arg VITE_GIT_SHA=$(git rev-parse HEAD)

# 2. Watch for 60 min (see "Post-deploy watch list" below)
# 3. If green at 60 min: tag, communicate, sleep.
```

### Pre-deploy smoke checklist (run BEFORE pushing)

```bash
npm run check                     # TypeScript — already verified green by this review
npm test -- --run                 # full suite
git log origin/main..HEAD --stat -- migrations/ scripts/migrate.mjs | head -100
# verify only the expected 4 SQL migrations + the one migrate.mjs change
```

### Post-deploy smoke (immediately after machines flip)

```bash
# 1. Public health
curl -fsS https://acreos.io/api/health
curl -fsS https://acreos.io/_health
# 2. Signup path renders
curl -fsS -o /dev/null -w "%{http_code}\n" https://acreos.io/sign-up
# 3. Borrower portal renders
curl -fsS -o /dev/null -w "%{http_code}\n" https://acreos.io/borrower-portal
# 4. Founder dispatch-queue endpoint returns shape (requires founder cookie)
# 5. Migration table count sanity
fly ssh console -a acreos -C "psql \$DATABASE_URL -c \"SELECT count(*) FROM periodic_statements;\""
fly ssh console -a acreos -C "psql \$DATABASE_URL -c \"SELECT count(*) FROM solene_dispatch_queue;\""
fly ssh console -a acreos -C "psql \$DATABASE_URL -c \"SELECT count(*) FROM sanctions_list;\""
```

### Post-deploy watch list (first 60 min)

| Signal | Threshold | Action |
|---|---|---|
| Sentry `route:/api/auth/signup-signals` error rate | > 5% | investigate; if dispatch worker fault → `fly releases rollback` |
| Sentry `route:/api/borrower/*` error rate | > 1% | investigate Reg-Z code paths; rollback if customer-impact |
| Sentry tag `service:solene-dispatch-runner` | any 500-class error | non-blocking for app; pause worker via env flag |
| Fly metrics `app` machine restart count | > 2 in 30 min | rollback |
| Fly metrics `worker` machine restart count | > 5 in 30 min | rollback worker only via `fly scale count worker=0` |
| `signupLimiter` 429 rate from logs | > 10/min sustained | check ip-bucket false-positive (cellular NAT) |
| `[getOrCreateOrg] signup blocked by sanctions check` log lines | > 1/min | review country / name match — likely false positive at first |
| `[preCallConstitutionalChecker] checker call failed — failing open` | > 5/min | Anthropic rate-limit; reduce dispatch concurrency |
| New rows in `solene_constitutional_violations` | any with `severity=critical` | page founder immediately |

### Rollback condition

**Trigger `fly releases rollback` if:**
- Customer surface (`/api/borrower/*`, signup, `/today`, `/pax/*`) error rate > 5% sustained 10 min.
- Any data-integrity error in Reg-Z paths (uniqueness violation reported via Sentry).
- A constitutional violation row with `severity=critical` lands in production within first 60 min AND points at a code path (not user input).

**Do NOT roll back for:**
- Worker-only failures — instead `fly scale count worker=0 -a acreos` to pause the dispatch worker; app stays up.
- Pre-call checker fail-open warns — by design.

### What survives a rollback

`fly releases rollback` reverts the running binary. It does **NOT** revert DB migrations. Tables created by this deploy that would remain after rollback:

- `periodic_statements`, `payment_applications`, `suspense_balances`, `late_fee_assessments`, `periodic_statement_skips`, `respa_outreach_events` (Reg-Z)
- `signup_signals`, `sanctions_list` (Phase 0)
- `pax_audit_runs`, `pax_audit_findings` (Beatrice)
- `solene_decisions`, `solene_audit_runs`, `solene_audit_findings`, `solene_capital_events`, `solene_page_events`, `solene_dispatch_queue`, `solene_dispatch_results`, `solene_agent_claims`, `solene_agent_identity_decisions`, `solene_failure_modes`, `solene_constitutional_violations`, `solene_pre_call_decisions`, `solene_decision_score_events`, `solene_model_upgrade_recommendations`
- `external_watch_events`, `team_improvement_opportunities`, `team_system_audit_runs`, `team_system_audit_findings`
- `iris_perf_samples`, `soren_seo_rankings`, `beatrice_reg_events`

Tables that survive a rollback are **harmless** — they're additive, mostly detection-only, and the reverted binary will not write to them (since the corresponding writer code is gone). The previous binary will simply not know they exist.

Acquired-notes new columns (`is_consumer_purpose`, `collateral_is_dwelling`, `servicing_arrangement`) have safe defaults (`false`, `false`, `'passive_holder'`) — reverted binary ignores them.

**No data is lost on rollback.**

---

## 8. Open questions for Tom (strategic-founder-only)

1. **OFAC fail-open vs fail-closed posture.** Phase 0 is documented as "fail-open is the Phase 0 floor, not a real sanctions program (Beatrice ruling)." Do you want to harden to fail-closed at Phase 1 ($200 MRR trigger) or wait for the Phase 2 audited program? Recommendation: tighten to "fail-closed if table empty OR fetched_at > 48h old" at Phase 1.

2. **Borrower portal `accessToken` + `email` in query string** (F3.4 — pre-existing). Worth a 1-hour follow-up to move email to POST body. Authorize?

3. **PII in logs** (F6.7). Should I hash `metadata.email` on the signup-block warn path? Founder org-create path is bounded and acceptable to leave.

4. **Dispatch worker scale** — should the new worker run at `min=1` or stay at `min=0` (suspend) for cost control? At suspend, the dispatch queue won't drain until a cron-style poll wakes it.

---

## Appendix — Commits in batch (head)

```
f8e1e5ee cron wiring: failure-mode library seeder + model-upgrade-path backfill
f6ec77d1 agentic L6.28: pre-call constitutional enforcement (Haiku-fast, fail-open)
4c6f84c3 agentic L5.27: token-economy modeling — every dispatch decision scored
dfed80f4 agentic L6.29: constitutional self-defense at tool-call layer
5fb4def0 agentic L2.8: multi-agent code review on every code-producing dispatch
dcafcec0 agentic L4.18: model-upgrade path on top of anthropic-watch
336397eb agentic L1.1: dispatch queue schema + atomic claim + tests
32dd9396 agentic L1.4: external_watch_events schema + migration
0405c2b8 reg z #201: RESPA §1024.39 early-intervention trigger scaffold
4608f85b reg z #201: §1026.36(c) piggyback on acquired-note payments + late fees
2b9a208b phase 0 hardening: OFAC SDN screening on signup (daily ingest + hash-match block)
8202d23e reg z #201: acquired_notes schema columns + periodic_statement_skips ledger
ad63b0fc phase 0 hardening: bot-signal collection (honeypot + ttf + UA fingerprint, capture-only)
4244f9b6 phase 0 hardening: per-org daily token budget + sliding-window cap on expensive endpoints
20eaaa44 phase 0 hardening: auth path rate-limit refactor (user+IP-bucket keying, cellular-NAT-safe)
03f27f95 reg z #198: SES notifier on periodic-statement generation + idempotency
3033bcdc reg z #197: borrower-portal StatementsPanel under Finance
30098d45 reg z §1026.41: borrower-portal endpoints + monthly cron
71441daa reg z §1026.41: periodic statements generator + pdf rendering
8464ff05 reg z §1026.36(c)(2): late-fee non-pyramiding + idempotency
74cf9fbe reg z §1026.36(c)(1): payment application algorithm + suspense bucket
ff5242fa reg z: §1026.41 + §1026.36(c) schema + migration
04e36ba0 phase 0 gate: clickwrap tos+privacy acceptance at signup
87338091 phase 0 gate: server-side pax disclosure event + schema mirror
... (102 more, see `git log origin/main..HEAD`)
```

---

**Verdict reiterated: approve-with-conditions.**

- **C1** Pre-deploy: run `refreshOfacSdnList()` from `fly ssh console` and verify `sanctions_list` has >8000 rows before opening signup traffic.
- **C2** Stage as single `fly deploy` (release_command applies migration once), but post-deploy keep a 60-minute watch on the table above with one-finger-on `fly releases rollback`.
- **C3** Deploy in a low-traffic UTC-evening window with a 60-minute on-call.

— Beatrice
