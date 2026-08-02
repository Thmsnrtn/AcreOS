# Blast-Radius Inventory

> Every code path that can **spend money**, **send an outbound communication**, **mutate a legal
> document**, or **touch another tenant's data**. Verified against code in the Phase 0 audit
> (2026-08-02). This list drives the guardrail-plane work in Phase 1.
>
> The charter's standard: every such path must carry an **idempotency key, dry-run mode, spend cap,
> approval gate, and audit-log entry**. Grade below is against that five-part standard:
> **complete** (all five, or all applicable), **partial** (some missing), **naked** (no gate).
>
> Method: enumerated categories exhaustively, instances representatively — where many routes share
> one chokepoint, the chokepoint is documented and a sample probed for bypass. Confirmed bypasses
> are listed at the end and are the highest-priority Phase 1 items.

## Grade summary

| Path | Kind | Idem | Dry-run | Cap | Approval | Audit | Grade |
|---|---|---|---|---|---|---|---|
| Platform billing (subscriptions/credits/packs) | spend | yes | yes | plan-priced | user + permission | Stripe+ledger | **complete** |
| Borrower card checkout (customer money, org's Stripe) | spend | partial | yes | amount due | custody-enforced | session+ledger | **complete** |
| ACH autopay debit (customer money) | spend | yes (dual) | yes | NACHA mandate | retained mandate | append-only attempts | **complete** |
| Paid provider lookups (skip-trace/comps) | spend | yes | cache+BYOK | pool fail-closed | tier gate | lookup log | **complete** |
| SMS send + spend | spend+send | yes | yes | credit pool | TCPA by construction | ledger per sid | **complete** |
| Autonomous agent spend | spend | yes | executor gate | $500/$25K/envelopes | founder >$500 | approvals+anomalies | **complete** |
| Solene/autopilot AI dispatch | spend | yes | observe-mode | $100/dispatch+envelope | witnessed-send | dispatch results | **complete** |
| Growth ads (founder Meta acct) | spend | n/a | propose-only | monthly cap+clamp | founder per ramp | policy proposals | **complete** |
| E-sign / signature request | legal | yes | n/a | n/a | human + §101(c) consent | signing consent audit | **complete** |
| Admin recovery (2FA/session/autopay/ownership) | cross-tenant | n/a | n/a | n/a | founder + Clerk MFA | chained audit_events | **complete** |
| Outbound webhooks — legacy integrations | send | job attempts | no | n/a | SSRF guard | job runs | **complete** |
| Email (all outbound) | send | no per-send key | yes | per-org warmup cap | counterparty BYO (opt-in) | in-memory + side effects | **partial** |
| Direct mail queue + campaign | spend+send | **no (Date.now key)** | strong interlock | free-tier cap + pool | user | ledger | **partial** |
| Twilio phone-number purchase | spend | no | no | none (org BYOK) | user | swallowed non-fatal catch | **partial** |
| Founder/admin impersonation | cross-tenant | n/a | n/a | n/a | isFounderAdmin; readOnly/expiry **unenforced** | activityLog row | **partial** |
| Cross-org jobs/crons | cross-tenant | job lease | no | n/a | `unscopedForPlatformOps` | reason logging | **partial** |
| Outbound webhooks — public-API lane | send | event id | no | auto-disable (designed) | HMAC | delivery log | **partial** (retry poller unwired; lane dormant) |
| **supportAgent `apply_billing_fix`** | spend | **no** | **no** | **NONE** | **description prose only** | **paxMemory only** | **naked** |

## Confirmed bypasses (Phase 1, ranked)

1. **`supportAgent.apply_billing_fix` — uncapped platform-Stripe money from customer support chat.**
   `apply_credit` calls `stripe.customers.update(balance: -amount_cents)` with no bound; `invoices.pay`
   and `voidInvoice` likewise; reachable from customer-authenticated support chat that exposes the full
   tool catalog (`server/ai/supportAgent.ts:671-688,3661-3790,5242`, `server/routes-support-tickets.ts:197-198`).
   The only "approval gate" is the sentence "Requires customer confirmation" in the tool description.
   Writes `paxMemory`, no `audit_events`; bypasses `checkHardGuardrails` and `financialAuthorityGate`
   entirely — a prompt-injection surface directly on money. The autonomous resolver variant
   (`paxSupportResolver.ts:90-109`) correctly excludes these tools; the interactive lane does not.
   **This is a critical breach of INV-MONEY-2 and INV-AUDIT-1.**
   *Remedy:* remove the mutation tools from the interactive catalog (keep `send_update_payment_link`),
   or route credits through `financialAuthorityGate.requestSpend` with a hard per-ticket cap and a
   chained audit write; add a ratchet asserting the interactive tool set ⊆ an allowlisted read/draft set.

2. **agent-skills `sendEmail` fronts the platform identity for counterparty mail (INV-RAILS-1).**
   The skill — whose own docstring example is `sendEmail({to: "seller@example.com"})` — calls
   `emailService.sendEmail` without `purpose:'counterparty'`, defaulting to the `system` lane
   (`server/services/agent-skills.ts:269-296`, `server/services/emailService.ts:317`). One forgotten
   property re-fronts the platform `@acreos.io` identity for customer deal mail.
   *Remedy:* make `purpose` required at the type level (or default `counterparty` and force explicit
   `system` opt-in), fix the skill in the same commit, add the source ratchet the constitution already
   marks owed.

3. **Direct-mail pool debit keyed on `Date.now()` (INV-MONEY, ASP-3).**
   A client retry double-debits the customer's credit pool; money-out is still held by the interlock
   but the ledger double-counts (`server/routes-outreach-mail.ts:449-459` — the `Date.now()` key is built at :449).
   *Remedy:* derive the debit `externalEventId` from request content + client `Idempotency-Key`.

4. **Impersonation `readOnly`/`expiresAt` are unenforced JSON (INV-AUDIT-1, INV-TRUTH-1).**
   `POST /api/admin/impersonate/:orgId` returns `{readOnly:true, expiresAt:+30min}` but mints no token
   and no middleware enforces either; contrast admin-recovery two files away, which requires founder
   identity + Clerk MFA and writes chained audit rows (`server/routes-admin.ts:4533-4562`).
   *Remedy:* mint a short-lived scoped token that middleware enforces read-only; audit start/end into a
   founder-visible log, not the tenant's.

5. **`publicWebhookDispatcher` retry/DLQ scaffold has no registered worker (ASP-2).**
   First-attempt-only delivery; header admits "worker registration not wired in v0"
   (`server/services/publicWebhookDispatcher.ts:20-23,130`). Dormant behind the no-public-API gate, but
   it is a live instance of this repo's named most-common defect.
   *Remedy:* register the poller or delete the retry machinery until the public-API gate opens.

## Residual risks (no live instance, but the guard is not airtight)

- **Money-custody static scan is a name-list regex** — `stripe['transfers'].create` (bracket access) or a
  fee-less unscoped charge (the original V1 defect shape) would evade the static half; the runtime half
  fires only at call sites using the chokepoint (`tests/unit/moneyCustodyHardStop.test.ts:144-152`). No
  live instance found after enumerating all Stripe money call sites.
- **Phone-number purchase** has no spend cap or idempotency and its audit write is inside a swallowed
  "non-fatal" catch; damage is bounded to the org's own BYOK Twilio account (`server/routes-integrations.ts:719-800`).
- **Cross-org job breadth** — `unscopedForPlatformOps(reason)` is the sole sanctioned bypass (7 files, the
  complete audit surface), but `runScheduledJobs.ts` (5,848 lines) iterates orgs with breadth no per-query
  audit can cover, and there is no RLS backstop (ASP-1).

## Reference implementations to copy

Two paths are already at the charter bar and should be the templates for the rest:

- **ACH autopay** — dual-layer idempotency (unique claim index + replayed processor key), NACHA mandate
  as approval gate, simulation dry-run, org-scoped account, append-only attempt audit
  (`server/services/achAutopay.ts`).
- **Admin recovery** — founder identity + Clerk MFA + Zod validation + chained immutable `audit_events`
  (`server/routes-admin-recovery.ts`).
