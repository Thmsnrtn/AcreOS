# AcreOS Improvement Audit — Master

*2026-08-06. Read-only audit. Every finding below had its citation opened by the orchestrator before it entered this document. 6 P0, ~15 deduped P1. The full per-slice detail is in the sibling files; this is the founder's one-screen brief.*

---

## 1. State of AcreOS

**Would I put this in front of a paying customer next week? Not until the tenant boundary is closed — but the gap is a week of work, not a rebuild.**

This is a genuinely strong, real product with an unusually mature immune system — 8 ratchets, 22 lints, a machine-readable constitution, ~661 test files. All 12 historical P0 defects still hold. The money-in path is sound: a stranger can pay and reliably receive the product. Fabrication is aggressively defended on the surfaces that matter most (occupancy, the founder Letter, autopilot forecasts).

But the audit found **six live P0s that every existing gate misses**, and four of them are the same shape: **cross-tenant data leakage.** The WebSocket trusts a client-supplied org id; the `founder:activity` channel is open to any customer (a defect marked FIXED that regressed); two Pax tools mutate any org's tasks; the notification tray is a shared global. The moment there are *two* paying customers, any one can wiretap the other. Add a P0 where the primary cold-outreach button bypasses the DNC/litigator scrub (TCPA liability), and one where the Pax hallucination guard runs on only one of two code paths.

None of these blocks the *first* sale. All of them burn trust — or create legal exposure — in *week one*. They are concentrated exactly where the gates don't look: WebSockets, `server/ai`, raw SQL, and the client. Fix the ten items below and the answer to the question becomes yes.

---

## 2. Coverage ledger

| Region | Examined | Method |
|---|---|---|
| Money-in (billing/webhooks/stripe) | exhaustive | T1 read billing region in full |
| Message-out (campaigns/DNC/email/SMS) | exhaustive | T2 read send handlers + DNC seam in full |
| Tenant boundary (WS/AI-tools/singletons/raw-SQL) | exhaustive | T4 read tools.ts, websocket.ts, notificationDispatcher in full |
| `server/ai/` + eval | exhaustive | slice 08 + Phase 1 |
| The 6 load-bearing gates | exhaustive | Phase 1, read every script |
| Schema + migration gates | exhaustive (code); **DB row counts = requires DB confirmation** | slice 05 (`DATABASE_URL` unset) |
| Reliability / DR | exhaustive (code+docs) | slice 13 |
| Number provenance | 5 numbers traced | T3 |
| Service sprawl (solene/autopilot) | high (stratified) | slice 04 |
| Type-safety, security, correctness, perf, frontend, testing, UX/a11y, compliance, cost, docs, solo-op, day-one | stratified (>1,500-line files + churn + sample) | slices 06,07,09,10,11,12,14,15,16,17,18,24 |
| **~880 `services/` files outside solene/autopilot** | **untouched** | out of budget |
| **Live prod (Fly secrets, DB rows, Stripe dashboard config)** | **untouched** | un-inspectable read-only |

**Absence of a finding in an untouched region is not evidence of absence.** The biggest blind spot is the ~880-file `services/` mass and anything that depends on live secrets/DB state (F-05-2's live drift, F-13-4's Sentry DSN, T2's `SEARCHBUG_*` provisioning are all framed on the *code path*, not a claim about prod config).

---

## 3. Findings table (deduped by root cause)

| ID | Title | Sev | Effort | Impact | Gate proposed | By |
|---|---|---|---|---|---|---|
| **F-23-1** | WebSocket trusts client-asserted `orgId` → full cross-org stream | **P0** | M | Trust wk-1 | WS session-derived org + lint | T4 |
| **F-23-2** | `founder:activity` open to any client (DEFECT-0022 regressed, still "FIXED") | **P0** | S | Trust wk-1 | founder-channel test; re-open 0022 | T4 |
| **F-23-3** | Pax `update_task`/`complete_task` omit org scope → cross-org write+read | **P0** | S | Trust wk-1 | tool-org-enforcement suite | T4 |
| **F-23-4** | Notification tray = process-global singleton, no org filter | **P0** | M | Trust wk-1 | tenancy lint on tray endpoints | T4 |
| **F-21-1** | Campaign SMS bypasses DNC/litigator scrub (calls Twilio directly) | **P0** | M | Legal | no-raw-Twilio lint; choke-point test | T2 |
| **F-08-1** | Pax hallucination guard runs only on streaming path; non-stream ships fabricated parcel facts | **P0** | M | Trust wk-1 | guard-parity test | 08 |
| **F-05-1 / F-05-2** | Schema-column validator blind to 248/748 tables; no schema→DDL mirror → 500 on deploy | P1 | S+M | Blocks sale | widen validator + `lint:schema-migrate-mirror` | 05 |
| **F-20-1** | Stripe Connect webhook marks event processed on handler throw → borrower charged-not-recorded | P1 | S | Trust | shared webhook-idempotency test | T1 |
| **F-15-1** | `POST /api/tenants` writes FCRA screening fields ungated (PATCH is gated) | P1 | S | Legal | FCRA-gate parity test | 15 |
| **F-13-1 / F-13-2** | Failing critical job → in-app tray, not phone; no DR restore ever executed | P1 | M | Trust/ops | critical-job-failure-pages test; `dr_drills` staleness | 13 |
| **F-11-1 / F-10-1** | Entity mutations don't invalidate `/api/today` (wrong key); Today loads 4 whole tables | P1 | S/M | Trust/perf | today query-key invalidation test | 11,10 |
| **F-16-1 / F-08-4** | `/api/va` + supportAgent run gpt-4o outside aiRouter → no cap, no eval | P1 | M | Cost | `lint:ai-through-router` | 16,08 |
| **F-08-2 / F-08-3** | Eval never runs Haiku (the free-trial model); `DATA_GROUNDING_EVAL_GREEN` hardcoded `true` | P1 | M | Trust | Haiku eval lane; derive switch from real run | 08 |
| **F-17-1** | Ledger's #1 KILL (~20K LOC) un-executed behind stale filenames | P1 | M | Shrink | `lint:ledger-refs` | 17 |
| **F-06-1** | `: any` annotation (~3,731) is the uncounted sibling of the as-any ratchet | P1 | M | Latent | `: any` ratchet | 06 |
| **F-10-2** | `getLeads/Deals/Properties` cap at 5000 (silent truncation); `getNotes` uncapped | P1 | M | Perf/truth | pagination + no-silent-cap | 10 |
| **F-18-1** | Vendor-credential expiry monitored by nothing (ATTOM lapses ~2026-08-28) | P1 | S | Ops | vendor-expiry ratchet | 18 |
| **F-14-1** | Per-page empty-vs-error residual (global `onError` toast fires, but pages still render EmptyState under it) | P2 *(down from P1 — see Adversarial)* | M | Trust | QueryErrorState enforcement | 14 |
| **F-15-2** | Statute-register ratchet validates pointer existence, not claim truth | P1 | M | Legal | claim-truth tests behind pointers | 15 |
| **F-07-x** | `sql.raw` class (38 sites) gated by nothing | P2 | S | Latent | `sql.raw` recurrence ratchet | 07 |
| **F-22-1..5** | Honestly-sourced numbers wearing labels that overstate them (projection→"cash", model over invented defaults→"valuation") | P2×5 | M | Trust | label-honesty review on 5 numbers | T3 |
| **F-04-1 / F-05-3** | ~2,064 LOC dead solene modules + ~80 dead tables, unadjudicated | P2 | S/L | Shrink | reachability policy + ledger triage | 04,05 |
| **F-24-x** | Day-one CTA overstates seeded leads 10×; primary persona routed to the one door that hard-depends on an unset key | P2 | S | Trust wk-1 | — | T5 |

*(Full schema for each — mechanism, evidence, fix, blast radius, confidence — in the sibling slice files.)*

---

## 4. The Ten — ready-to-paste implementation briefs

*Ordered for the first paying customer and their first month. Each is a self-contained Claude Code brief. All are `docs/`-free — real code changes.*

### 1. Close the tenant boundary (F-23-1/2/3/4) — **do this first**
**Context:** Four gate-blind paths let one org reach another's data. The moment there are two paying customers this is a live wiretap. Root cause: org identity is taken from the caller, never derived from the session.
**Changes:**
- `server/websocket.ts`: in `validateWsSession`, look up the authenticated user's real `organizationId` (join users→membership) and reject if it ≠ the `?orgId=` param; set `client.organizationId` from the session, never the query param (fixes F-23-1). In `isAllowedChannel`, gate `founder:activity` on `client.isFounder` and stop fanning per-org agent events to it (`broadcastAgentEvent` line 344) — partition by org (fixes F-23-2).
- `server/ai/tools.ts`: `update_task` (1507) and `complete_task` (1513) — add `const t = await storage.getTask(org.id, args.task_id); if(!t) return notFound;` and pass `org.id` to `updateTask`, exactly like `update_lead_status`/`update_property` already do (fixes F-23-3). `org.id` is already in scope.
- `server/routes-sovereign-integration.ts` (88-123): route `/api/notifications/history|unread-count|:id/read` through the org-scoped `storage.getNotifications(orgId, userId, limit)` instead of the global `notificationDispatcher` singleton; verify org on `markAsRead` (fixes F-23-4).
- `server/storage/tasksRepo.ts`: make `organizationId` **required** on `updateTask/deleteTask/completeTask` (drop the `?`) so `tsc` flags every unscoped caller (fixes F-23-5, the latent trap).
**Gates to add:** vitest `tenantBoundary.test.ts` — org-A session + `?orgId=B` closes 4003; non-founder subscribe to `founder:activity` rejected; `executeTool('update_task',{task_id:<orgB>},orgA)` mutates nothing; `getNotifications` as A after dispatch for B returns none.
**Verify:** `npm test tenantBoundary && npm run check`.
**Commit shape:** `fix(security): derive org identity from session on WS, AI tools, notification tray (P0 cross-tenant)`.

### 2. Route campaign SMS through the send choke point (F-21-1/F-21-2)
**Context:** `POST /api/campaigns/:id/send-sms` calls Twilio directly (`routes-campaigns.ts:2214`), bypassing the Searchbug DNC/litigator scrub, the frequency cap, and BYO-Twilio. The DNC seam's own header claims campaigns *can't* skip it — false. TCPA damages are $500–$1,500/message; a litigator hit is a targeted suit.
**Change:** Replace the raw-Twilio loop (2160-2226) with per-recipient `await sendOrgSMS(org.id, lead.phone, body)` — it already does consent + quiet-hours + DNC + frequency + BYO-Twilio + ledger. Refuse (don't platform-fallback) when the org has no connected Twilio.
**Gate:** `campaignSmsChokePoint.test.ts` — mock DNC to `litigator`, assert zero Twilio calls + recipient reported blocked; grep-ratchet: **0** `messages.create(` outside `server/services/comms/` (baseline 1, this site).
**Commit:** `fix(compliance): campaign SMS through sendOrgSMS choke point (P0 DNC bypass)`.

### 3. Run the Pax hallucination guard on the non-streaming path (F-08-1)
**Context:** `processChatStream` calls `guardPaxOutput` + `evaluateLivePaxOutput`; `processChat` (customer-reachable at `routes-ai.ts:354`, plus the scheduler + `pax_subagent`) calls only the leak-check. A non-stream caller gets a fabricated "FEMA Zone X" after a flood-data miss.
**Change:** Extract the guard+gate block (`executive.ts` ~2130-2290) into `finalizePaxOutput(text, ctx)`; call it from `processChat` before `createMessage` (1617).
**Gate:** `paxGuardParity.test.ts` — a `dg-miss-flood-001` fixture through both entry points must yield a deflection.
**Commit:** `fix(ai): apply hallucination guard on non-streaming Pax path (P0 fabrication)`.

### 4. Make schema changes provably reach prod DDL (F-05-1/F-05-2)
**Context:** `validate-schema-column-refs` indexes only `shared/schema.ts` — 248 split-schema tables are invisible, so a bad column ref on rent-roll/notes/finance/compliance 500s prod with no CI signal. And `migrate-mirror-check` only fires when a `.sql` file changes, so a `schema.ts`-only column add (the actual recurring incident, per `migrate.mjs`'s own 6 incident comments) has no tripwire.
**Changes:** (a) point the validator's index at `["shared/schema.ts","shared/schema/*.ts"]` (mirror `drizzle.config.ts`), re-baseline once. (b) New `lint:schema-migrate-mirror`: parse `pgTable` columns from schema + split files, assert each has a matching `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS` in `migrate.mjs` (textual, no DB); allowlist current gap, ratchet down. Wire into `npm run check`.
**Verify:** `npm run lint:schema && node scripts/check-schema-migrate-mirror.mjs`.
**Commit:** `fix(schema): cover all 748 tables in column validator + add schema→DDL mirror gate`.

### 5. Fix the Stripe Connect webhook failure semantics (F-20-1)
**Context:** `routes-billing.ts:1150` marks the event processed in a `finally` that runs even when `handleWebhookEvent` throws → borrower card charged, note balance never decremented, Stripe retry suppressed. The platform webhook does the opposite (release-and-rethrow, `webhookHandlers.ts:87`).
**Change:** Move the "processed" insert to run only on success; on throw, don't record processed, return non-2xx so Stripe redelivers. Replace the SELECT-then-INSERT idempotency (F-20-3) with the atomic `INSERT … ON CONFLICT DO NOTHING RETURNING` claim. Add a `transactionId` guard to `stripeConnect.handleSuccessfulPayment`.
**Gate:** shared `webhookIdempotency.test.ts` covering both endpoints — throwing handler ⇒ event NOT processed + non-2xx.
**Commit:** `fix(billing): Connect webhook must not ack on handler failure (P1 charged-not-recorded)`.

### 6. Gate FCRA screening on tenant CREATE (F-15-1)
**Context:** `POST /api/tenants` (`routes-rentals.ts:559`) writes `screeningCreditScore`/`screeningHasPriorEviction`/`screeningHasCriminalRecord`/`screeningIncomeMonthlyCents`/`screeningCriteriaMet` with no FCRA permissible-purpose gate; the PATCH route gates the identical fields. A customer bypasses the gate by creating instead of patching. Founder personal FCRA exposure.
**Change:** Apply the same `fcraAttestation` permissible-purpose check the PATCH handler uses (`:600-612`) to the screening fields on POST — or strip screening fields from the create schema and require the gated PATCH to set them.
**Gate:** `fcraCreateParity.test.ts` — POST with screening fields + no attestation ⇒ rejected.
**Commit:** `fix(compliance): FCRA permissible-purpose gate on tenant create (P1)`.

### 7. Make a failing critical job page the phone, and run one DR restore (F-13-1/F-13-2)
**Context:** A critical job that *runs and fails* (worst case: the backup pipeline) routes to a Class-C in-app tray that "never interrupts the founder." And no full DR restore has ever been executed — runbook 07 cites a "timed restore drill" via a dead link to a doc whose own verdict is "no demonstrated restore."
**Changes:** (a) Route `job:failed` for `JOB_ROSTER` entries with `critical:true` through `alertSpine.raiseAlert({severity:"critical"})`; minimum, have `backupRestoreVerify.ts`/`dbBackup.ts` call `raiseAlert` on failure. (b) Provision `DB_BACKUP_S3_BUCKET`, run the restore drill in `dr-runbook-postgres-restore.md` once end-to-end, fill the RTO table, append `dr-drill-history.md` + a `dr_drills` row; fix runbook 07's dead link.
**Gate:** `criticalJobFailurePages.test.ts`; `dr_drills` staleness alert (>90d or zero rows).
**Commit:** `fix(reliability): page on critical-job failure + execute first DR restore`.

### 8. Fix the Today door: cache invalidation + bounded reads (F-11-1/F-10-1)
**Context:** Entity CRUD hooks invalidate `/api/dashboard/today-priorities`, but the Today door reads `/api/today` — a different key — so the primary customer door goes stale up to 2 min after creating a lead/deal/property. And `/api/today` loads 4 whole tables into memory and JS-ranks on every open.
**Changes:** (a) In `use-leads.ts`/`use-deals.ts`/`use-properties.ts`, add `queryClient.invalidateQueries({queryKey:["/api/today"]})` alongside the existing `today-priorities` invalidation. (b) Push the Today ranking into SQL (`LIMIT`/indexed `ORDER BY`) instead of loading full tables.
**Gate:** `todayInvalidation.test.ts` — a lead-create mutation invalidates `/api/today`.
**Commit:** `fix(client): invalidate /api/today on entity CRUD + bound the Today reads`.

### 9. Route every AI surface through aiRouter + add a Haiku eval lane (F-16-1/F-08-4/F-08-2/F-08-3)
**Context:** `/api/va` (`vaService.ts`, gpt-4o) and `supportAgent.ts` (4× gpt-4o) build their own OpenAI client, escaping the per-org quota, the $15/day platform ceiling, and all telemetry. Separately, the eval never runs Haiku — the model that serves the free trial and the most common Pax turn — and `DATA_GROUNDING_EVAL_GREEN` is a hardcoded `true` authorizing the Haiku downgrade with no model behind it.
**Changes:** (a) Route `processSupportChat` and the va agent through `routeAITask`. (b) Add a Haiku lane to `eval.yml` (`--model claude-haiku-4-5`) with a grounding floor. (c) Derive `DATA_GROUNDING_EVAL_GREEN` from the last real Haiku run of the dg-v1 set (or drop `data_lookup_restate.floorModel` to Sonnet until then).
**Gate:** `lint:ai-through-router` — forbid `chat.completions.create` outside aiRouter/anthropicClient/eval (baseline: 4 supportAgent + 3 vaService, allowlisted then driven down).
**Commit:** `fix(ai): route va/support through aiRouter; eval the served (Haiku) model`.

### 10. Rewrite ledger row #1 + add `lint:ledger-refs` (F-17-1)
**Context:** The deletion ledger's "biggest pure win" KILL points at `routes-founder-v6.ts` (renamed to `routes-founder-sovereign-company.ts` etc.) — so a fresh session greps, finds nothing, and assumes ~20K LOC was deleted. It wasn't; 8 routers + 43 `*V[6-14].ts` services (~20,091 LOC) are still mounted.
**Changes:** (a) Rewrite the row: real filenames, mount ref `routes.ts:1865-1879`, the vN⇄name decoder table, LOC, mark KILL-pending. (b) `lint:ledger-refs` — parse `` `path` `` / `file.ts:LINE` from `deletion-ledger.md` + `defect-registry.md`, fail on any path absent from disk.
**Verify:** `node scripts/check-ledger-refs.mjs`.
**Commit:** `chore(ledger): correct row #1 pointers + gate dangling refs`.

---

## 5. New gates (the highest-leverage deliverable)

Each extends the immune system to a defect class it currently can't see. Measured baselines where computable read-only:

| Gate | Catches | Baseline |
|---|---|---|
| **Extend `lint:org-scoped-fetch` to routes+services** | cross-tenant `from(orgTable)` outside storage (the F-23 class the storage-only lint misses) | measure with `--measure` (large; ratchet down) |
| **`sql.raw` recurrence ratchet** | new interpolated raw-SQL sites (DEFECT-0002 class) | **38** (`server/**`), direction down |
| **`: any`-annotation ratchet** | the uncounted sibling of `as any` on tenant/money/auth | **~3,731** server/shared/client (or scope to `server/`), rank by blast radius first |
| **Extend `lint:no-fabrication` to `server/ai` + `server/jobs`** | AI/job fabrication (the fabrication gate's biggest blind spot) | seed allowlist from a first scan |
| **Empty-set honesty check** on the T3 numbers | aggregate-over-zero-rows rendered as a measurement | scoped to the 5 first-seen numbers |
| **Widen `validate-schema-column-refs` + `lint:schema-migrate-mirror`** | 248 invisible tables; schema→DDL drift → deploy 500s | 500→748 indexed; migrate-mirror gap allowlisted |
| **`lint:ai-through-router`** | AI calls escaping the cost/quota/eval chokepoint | 4 supportAgent + 3 vaService raw sites |
| **`lint:ledger-refs`** | dangling `file:line` refs in ledger/registry (false "done") | row #1 alone ≥3 dangling |
| **`vendor-expiry` ratchet** | sole-source credential lapse mid-absence | 0 rows today; seed ATTOM 2026-08-28 |
| **`criticalJobFailurePages` + WS/notification tenancy tests** | failing critical job silence; caller-asserted org | new |
| **Haiku eval lane + tool-call-correctness golden set** | eval-vs-prod model divergence; a copilot answering from memory | 0 Haiku runs today |

---

## 6. Ledger additions (unadjudicated; never contradicting a KEEP)

- **KILL** — 7 test-only solene modules (F-04-1, ~2,064 LOC): `adversarialTests`, `distributedReasoning`, `founderBypass`, `timeAwareDecisions`, `planProposals`, `sessionTaskStore`, `chat/ceoQuestions`. Only importer is own test.
- **KILL-execute** — academy/certification (467 LOC + 4 tables), negotiation-copilot standalone (1,788 LOC): ledger already says KILL; still mounted (flag-gated off). Execute.
- **DROP-triage** — ~80 gate-certified dead tables (F-05-3), toward the ≤450 target; 13/14 sampled absent from the ledger.
- **Founder ruling needed** — 3 held SCP modules (`scpCustomerLifecycle/SelfProvisioning/ExperimentEngine`), 0 importers.

---

## 7. Deferrals (each with a revisit trigger)

- **Marketplace/API customer-count gates** → at ~20 customers (before the 25/50 triggers).
- **FK-index lint + the 148 org-leading offenders** → before the first 10,000-record tenant (near-empty today).
- **Autopilot characterization tests** (F-04-4) → before the first customer whose data the planners touch.
- **~80 dead-table drops** → batch into the next shrink wave, not piecemeal.
- **`: any` full remediation** → after the ratchet lands; fix tenant/money/auth subset first.
- **Residential-comps data plane** → at its revenue trigger (unchanged).
- **F-15-2 statute-register claim-truth tests** → alongside each compliance trigger (LLC / CAN-SPAM / DNC).

---

## 8. Constitution collisions (founder-only)

- **F-21-2** — campaign SMS sends from the platform Twilio number, against "no re-fronting platform send rails / BYO identity" (2026-07-17, which named email explicitly). Surfaced as a **code-parity defect**, not a request to change the decision — the constitution is right; the SMS path doesn't honor it yet. Fixed by The Ten #2.
- **No other collisions.** `public-api.ts` and `marketplace.ts` schema are KEEP-dormant by deliberate founder decision — noted, not relitigated.

---

## 9. Sequencing (batches that each ship independently)

1. **Batch A — the boundary (week 1):** Ten #1 (tenant P0s), #2 (DNC), #3 (Pax guard). Ships alone; each has its own gate. No half-migrated state.
2. **Batch B — deploy safety + money integrity:** Ten #4 (schema→DDL), #5 (Connect webhook). Land before any schema-touching deploy.
3. **Batch C — trust + legal:** Ten #6 (FCRA), #7 (reliability/DR), #8 (Today door).
4. **Batch D — AI hygiene + shrink:** Ten #9 (aiRouter+eval), #10 (ledger). Then execute the KILL queue (§6) as its own reviewed wave.

Each batch is independently shippable and independently gated. Do not interleave A and D.

---

## 10. If this were mine

Three things, in order.

**One: close the tenant boundary this week and treat it as the launch gate.** Everything else can iterate under real users; a cross-tenant leak cannot. The four P0s are ~1 day of code and the gates to prevent recurrence are cheap. Until they land, "would I show a customer" is no.

**Two: stop trusting the immune system's *coverage* the way you trust its *existence*.** Every gate here is honest and well-built — and every one has a blind spot its name hides. The `no-fabrication` gate is a `Math.random` grep over a third of the server; `org-scoped-fetch` never leaves the storage layer; the eval scores a model the free trial never uses. The single highest-leverage investment is not new features — it's the §5 gates that extend coverage to where the six P0s actually lived. In an AI-maintained repo, a gate that *looks* like coverage is worse than a missing one.

**Three: the shrink campaign is real but its bookkeeping lies to you.** The ledger's #1 "biggest pure win" is un-executed behind renamed files, so every session since assumed it was done. `lint:ledger-refs` (Ten #10) plus honest row-rewrites turn the ledger back into something you can act on — and unlock ~20K LOC of the ~440K gap that's been sitting in plain sight. You are less than halfway to ≤600K/≤450, and you'll only get there by trusting a ledger that's telling the truth.

The product is genuinely good. The gates are genuinely good. The gap between "what the gates check" and "what they're named" is where the next customer's trust will be won or lost.

---

## Adversarial Review

*Turned on this document. Cuts, downgrades, and honest caveats. The audit is stronger shorter.*

**Corrections (a finding entered the table stronger than its citation supports):**
- **F-14-1 downgraded P1 → P2.** I checked its citation late: `handleQueryError` **is** wired into `QueryCache.onError` (`queryClient.ts:517`, DEFECT-0035's fix), so a failed query *does* fire a global error toast — it does not silently vanish. The real residual is narrower: some pages render `EmptyState` *beneath* that toast instead of `QueryErrorState`. Real, but partly re-reports paid debt. Not a Ten item.
- **F-22-3 (cash-flow "health" index rendered as a %) is the weakest T3 finding — treat as P3/borderline.** A composite health score shown as 0–100% is ordinary product practice, not fabrication. The strong T3 findings are F-22-1 (a *projection* labeled "cash position") and F-22-2 (a model run over *invented feature-defaults* labeled a parcel-specific "valuation"); those are the trust risks. Don't over-rotate on the index.

**Where I bundled or over-urgent'd:**
- **The Ten is 10 briefs, ~15 fixes** (F-05-1/2, F-13-1/2, F-11-1/10-1, F-16-1/08-4, F-08-2/3 are paired). Honest, but don't read it as 10 atomic changes.
- **Ten #8 is really two items of different urgency.** The cache-invalidation (F-11-1) is a week-one trust bug — a customer creates a lead and the home door doesn't reflect it. The bounded-reads (F-10-1) is a *post-scale* perf issue; tables are near-empty at zero customers. Do F-11-1 now; F-10-1 before the first big tenant, not this week.
- **Ten #7's DR drill (F-13-2) trails its paging fix (F-13-1).** Paging on a failing backup is week-one. A full timed restore drill is "before customer #1's data is irreplaceable" — important, but not the same week as closing the tenant boundary.
- **F-18-1's fix is over-built.** A whole `vendor_credential_expiry` table + ratchet for one known lapse is maintenance a solo operator doesn't need yet. The 80/20 is a calendar reminder for 2026-08-28 + one `stepAwayReadiness` check. Build the table only when there are ≥3 sole-source vendors.

**Trade-offs I'm asking the founder to accept, named:**
- **F-08-3's stopgap (drop `data_lookup_restate` to Sonnet) raises AI cost** — it partly undoes the cost-conscious Haiku routing the founder deliberately built. The *right* fix is to eval Haiku and keep it if it passes; the Sonnet drop is only the interim if the eval lane isn't wired yet. Don't leave it on Sonnet permanently.
- **Tension inside the founder's own plan, not with mine:** ruling #11 ("build ALL verticals fully") expands surface while the deletion-ledger targets ≤600K LOC. My deletion proposals (§6) only touch *dead* code (renamed narrative routers, test-only modules) — they don't cut a vertical — so they don't collide with #11. But the two rulings pull opposite directions on total LOC, and no amount of dead-code deletion closes a 440K gap while every registered vertical is also being built to completeness. That's the founder's call to reconcile; I'm flagging it, not resolving it.

**What was not examined — and where a 7th P0 most likely hides:**
- **4 of 6 P0s were cross-tenant leaks in the corners I *did* check (WS, AI tools, notification singleton). The corners I did NOT check are the connector executor's ~16 tools (`server/services/connectors/executor.ts`) and the aggregate/report query surface.** T4 explicitly deferred the connector executor's per-tool org enforcement. Given the hit rate, that is the single likeliest place for a 7th cross-tenant P0. **Recommend: point one focused follow-up at `connectors/executor.ts` org-scoping before launch.** (`orgDataClear.ts` I did glance — its header shows it's recursively org-scoped by design, deleting only the target org; lower risk.)
- **The ~880 `services/` files outside solene/autopilot were untouched.** Correctness, cost, and tenant bugs there are unmeasured. Absence of findings ≠ absence of defects.
- **Everything depending on live prod state is inferred, not confirmed:** F-05-2's live drifted columns, F-13-4's Sentry DSN, T2's `SEARCHBUG_*` and `DNC_SCRUB_PROVIDER` provisioning (the `.env.example` default is `none` — so even the *good* DNC path may be inert until the founder sets it, which would make F-21-1 worse, not better). These need a DB/secrets pass the read-only audit couldn't do.

**Net:** the six P0s and the gate-coverage thesis are the load-bearing output and they held under verification. The long tail (F-22-3, F-14-1, the perf/DR urgency) is softer than the table's severities implied before this pass. If only the first three Ten items ship, the "would I show a customer" answer flips to yes.
