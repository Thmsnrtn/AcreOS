# Remediation status — audit 2026-08

*Companion to `99-master.md`. Tracks what was actually FIXED in code vs. what remains. Every fix was committed with the pre-commit typecheck passing on its staged files; ratchets re-verified green after the changes.*

---

## Fixed & committed

| Finding | Sev | What shipped | Verified |
|---|---|---|---|
| **F-23-1** WebSocket cross-org stream | P0 | `validateWsSession` now verifies the user belongs to the claimed `?orgId=` (owner or active team seat) via the Drizzle query builder; org is session-verified, not caller-trusted | tsc; logic mirrors `getOrCreateOrg` |
| **F-23-2** `founder:activity` open to any client | P0 | channel gated on a session-derived `isFounder` flag (was `return true`) | tsc |
| **F-23-3** Pax task tools cross-org write | P0 | `update_task`/`complete_task` now `getTask(org.id,…)` precheck + pass `org.id` to `updateTask` | **unit test (4 cases) passing** — `tenantBoundaryTaskTools.test.ts` |
| **F-23-4** notification tray singleton | P0 | tray endpoints serve from org-scoped DB store; `markNotificationRead` gains org filter | tsc |
| **F-21-1/2** campaign SMS bypasses DNC + BYO | P0 | batch routed through `sendOrgSMS` (DNC scrub + frequency + quiet hours + BYO Twilio); per-recipient credit refund on block | tsc; no raw Twilio `messages.create` left outside comms/ |
| **F-08-1** hallucination guard stream-only | P0 | `finalizePaxOutput` helper runs the guard + live eval gate on the non-stream `processChat` before persist | tsc |
| **F-20-1/3** Connect webhook acks on failure | P1 | atomic claim-then-release: on handler throw the claim is released and rethrown so Stripe redelivers (was `finally`-marked) | tsc |
| **F-15-1** FCRA screening ungated on CREATE | P1 | `POST /api/tenants` requires the org-level FCRA attestation when screening fields present, mirroring PATCH | tsc |
| **F-11-1** Today door stale after mutation | P1 | lead/deal/property hooks invalidate `/api/today` (the door's real key) on **create, update AND delete** — the original commit only covered delete (caught + fixed in the completeness pass below) | tsc |
| **F-05-1** schema validator blind to 248 tables | P1 | column validator indexes `schema.ts` + `schema/*.ts` | **ran: 500→744 tables, 0 new violations** |
| **F-13-1** failing critical job never pages | P1 | `backupRestoreVerify` + `dbBackup` call `alertSpine.raiseAlert(critical)` on failure (the live page path), not the Class-C tray | tsc |
| **F-17-1/2/3/4** stale docs | P1–P3 | ledger row #1 corrected (renamed filenames + vN decoder + NOT-EXECUTED); DEFECT-0059 OPEN→FIXED; H0 boxes ticked; README counts refreshed | doc review |
| **F-17-1** ledger's #1 KILL — dead-facade portion executed + premise corrected + gate built | P1 | Investigated the KILL against code: the "delete all 8 routers + 43 services / ~20K LOC" premise was FALSE (v10–v14 back live founder pages; the v6/v7/v8 *services* are live via `ceoCommandBridge`←mounted `routes-founder-intelligence` + worker jobs). Deleted only the provably-dead **~4,788 LOC**: 3 v6/v7/v8 routers (dead HTTP facade) + 17 orphaned founder components + the 3 services those routers solely owned. Ledger row rewritten to the true reachability map. New **`lint:ledger-refs`** gate (block/row-aware: scans active verdict rows + OPEN defects, hard-fails on a cited path that doesn't resolve, 2-entry allowlist). | **adversarial verify agent (runtime-safe) + full `npm run check` + `routeManifest.test.ts` 11/11**; ratchets lowered same commit (as-any 1417→1409, colon-any 3081→3020, res-status-raw 507→506) + reachability deletion-revealed +2/+2 tables queued for founder drop |
| **F-07** `sql.raw` ungated | P2 | new `sql-raw` ratchet, baseline **38**, down-only | **ratchet green** |
| **F-06-1** `: any` ungated | P1 | new `colon-any` ratchet over `server/`, baseline **3085**, down-only | **ratchet green** |
| **F-16-1 / F-08-4** va/support AI escapes cost chokepoint | P1 | new `aiSpendGuard` — cost-ceiling gate at agent entry + telemetry per call (so their spend counts toward the ceiling + COGS); wired into `processAgentTask`, `generateBriefing`, `processSupportChat`; new `openai-bypass` ratchet (baseline **89**, down-only) | **test 4/4 + ratchet green** |

**Net: all 6 P0s + 9 P1 groups fixed, plus 2 new gates.** One integration test added (the crown-jewel tool P0); the rest verified by typecheck + reading + (for the schema/ratchet fixes) running the gate.

---

## Continuation batch (2026-08-06) — the 9 follow-on items, all shipped

Each was implemented, verified against code (not against a self-report), and committed. The `lint:ledger-refs` gate below was previously listed here as "deliberately not done" — it is now **built** (the "fragile executed-vs-pending" concern was solved by block/row-aware scoping: only ACTIVE verdict rows + OPEN defect blocks are scanned).

| # | Finding | What shipped | Gate/test |
|---|---|---|---|
| 1 | **F-05-2** | `lint:schema-migrate-mirror` — table-level mirror (every `pgTable` needs a `CREATE TABLE` in `migrations/*.sql` ∪ `migrate.mjs`); 95-table allowlist; flags `agent_action_log` as a live unmigrated table | gate green |
| 2 | **F-15-2** | `statuteRegister.test.ts` now asserts referenced unit tests contain real `expect(` and aren't wholly skipped (+ PROSE_ONLY/REFUSAL_ONLY down-only ratchets) | 17/17 |
| 3 | **F-18-1** | `vendorCredentialExpiry.ts` — sole-source vendor expiry registry + `stepAwayReadiness` check + milestone paging in the daily briefing (warn 14/7, page ≤2) | 5/5 |
| 4 | **F-13-2** | runbook 07 dead-link corrected; `dr_drills` staleness readiness check (zero rows ⇒ "RTO unproven"); deliberately did NOT auto-populate drills (false reassurance) | tsc |
| 5 | **F-10-2** | `listCap.ts` — bounded + LOUD org-wide reads (`getNotes` was unbounded; leads/deals/properties silently 5000-capped) | 4/4 |
| 6 | **F-08-2/3** | `eval.yml` model matrix (Sonnet + **Haiku**, the served model); `paxModelTier` grounding-switch comment made honest | yaml + gate |
| 7 | **F-06-1** | typed the highest-risk `: any` on tenant/money paths (landCredit, Stripe clients); `colon-any` 3085→3081 | ratchet |
| 8 | **F-16-1** | 3-phase tool-aware router migration **plan** (`F-16-router-tool-migration-plan.md`) — full migration needs live API keys (eval-gated), so documented not shipped; the load-bearing cost-ceiling+telemetry already shipped via `aiSpendGuard` | doc |
| 9 | **F-17-1** | ledger's #1 KILL: dead-facade portion executed (~4,788 LOC), premise corrected, `lint:ledger-refs` gate built (see the fixed table above) | adversarial verify + full check |

### The paxModelTier tsc-break caught in this batch
Item 6's commit (`c717d79`) shipped a JSDoc comment containing the literal `safe*/adversarial*` — the `*/` **closed the block comment early** and broke `tsc` for the whole tree. It survived because that run's "exit 0" was read from a trailing `echo`, not from `npm run check`. Fixed here; the process lesson is baked into the verification method below (read the command's OWN exit code via a sentinel file, never a wrapped one).

---

## Completeness audit (2026-08-06) — an independent 6-dimension adversarial pass over the WHOLE branch

Because the paxModelTier break proved a "green" claim had been read wrong, the entire remediation branch (base `5ca0f29`, ~30 commits) was re-audited by an independent fan-out that treated every "fixed" claim as a hypothesis: build-integrity, security-P0 bypass, built-but-unwired, ratchet honesty, deletion residue, and claim-vs-code. **Clean dimensions (zero findings): build-integrity, built-but-unwired, ratchet-honesty.** It confirmed **7 defects — 2 of them P1 I introduced in this very remediation** — all now fixed:

| Sev | Defect | Fix |
|---|---|---|
| **P1** | `websocket.ts` `isAllowedChannel` prefix-matched `org:${id}` with no delimiter → org 1 could subscribe to `org:19`/`org:100` and receive their live streams (defeated the F-23-1 boundary) | exact-match `channel === org:${id} \|\| startsWith(org:${id}:)`, same for `user:` |
| **P1** | `routes-campaigns.ts` blocked-SMS **double refund** — the inline per-recipient refund I added stacked with the pre-existing post-loop batch refund → blocked recipients minted free credits | removed the inline refund; the single post-loop batch refund credits every failure exactly once |
| **P2** | Campaign SMS fell back to the **platform** Twilio account when the org had no BYO identity — a "be the rail" constitution breach; the fix comment even claimed the opposite | added `orgHasConnectedSmsIdentity` gate — campaign (counterparty) send refuses + refunds when no BYO is connected; corrected the false comment |
| **P2** | **F-11-1 was overclaimed** — only DELETE hooks invalidated `/api/today`; create/update left the Today door stale | added `/api/today` invalidation to create + update hooks for leads/deals/properties |
| **P3** | `POST /api/notifications/:id/read` scoped by org only → a user could flip a co-org user's notification by id | `markNotificationRead` now also filters `userId`; route passes it |
| **P3** | Six orphaned middleware mounts for the deleted `/api/founder/v6\|v7\|v8` prefixes survived in `routes.ts` | removed |
| **P3** | `docs/founder-routes-audit.md` still said V6/V7/V8 are live ("None are dead") | dated update banner correcting it to the true reachability map |

Verified: full `npm run check` green after all 7 fixes; the two P1s were re-read against code before and after.

---

## Deliberately NOT done (with reason)

- **`: any` full remediation (~3,020 sites).** The ratchet freezes it; the tenant-key/money/auth subset is typed (F-06-1). Bulk remediation is XL, explicitly deferred in the audit.
- **Dropping `agent_improvement_plans` / `agent_synergy_map`** (orphaned by item 9's service deletion). A production `DROP TABLE` is a founder-only hard-stop; both are queued for the founder table-drop decision in `reachability.json`'s note, schema defs preserved.
- **Full router migration (F-16-1 Phase 2/3)** — needs a keyed environment + the eval; documented, not shipped.
- **One real DR restore drill (F-13-2)** — operational, needs `DB_BACKUP_S3_BUCKET`; the runbook link + staleness surfacing shipped, the drill itself is founder/ops-run.
- The audit's **deferred-with-trigger** items (marketplace/API count-gates, FK indexes before the 10k-lead tenant, schema-file split, residential-comps) — untouched by design; doing them now contradicts the audit.

---

## Verification run (2026-08-06)

- **`npm run check` — PASS (exit 0)** across the full change set: `tsc --noEmit --incremental false` + all 17 lints + all ratchets (`as-any` 1417, `sql-raw` 38, `colon-any` 3085, `table-count` 748, reachability, org-fetch 0 new/0 stale, …). Ran twice: the first run surfaced one stale `org-fetch` baseline entry that the F-23-4 fix had earned (markNotificationRead retired) — removed it, second run green.
- **`npx vitest run tests/unit/tenantBoundaryTaskTools.test.ts` — 4/4 pass** (the tenant P0 test).
- Each commit additionally passed the repo's pre-commit staged-file typecheck.

## Suggested manual smoke before deploy

- A WS connect with a foreign `?orgId=` should close 4003; a same-org connect still works.
- A non-founder subscribing to `founder:activity` should be rejected.
- A campaign SMS to a DNC/consent-blocked number should NOT send and should refund the credit.
- Pax `update_task` with another org's task id should return not-found and mutate nothing.
