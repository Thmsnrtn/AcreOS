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
| **F-11-1** Today door stale after mutation | P1 | lead/deal/property hooks now invalidate `/api/today` (the door's real key), not just `today-priorities` | tsc |
| **F-05-1** schema validator blind to 248 tables | P1 | column validator indexes `schema.ts` + `schema/*.ts` | **ran: 500→744 tables, 0 new violations** |
| **F-13-1** failing critical job never pages | P1 | `backupRestoreVerify` + `dbBackup` call `alertSpine.raiseAlert(critical)` on failure (the live page path), not the Class-C tray | tsc |
| **F-17-1/2/3/4** stale docs | P1–P3 | ledger row #1 corrected (renamed filenames + vN decoder + NOT-EXECUTED); DEFECT-0059 OPEN→FIXED; H0 boxes ticked; README counts refreshed | doc review |
| **F-07** `sql.raw` ungated | P2 | new `sql-raw` ratchet, baseline **38**, down-only | **ratchet green** |
| **F-06-1** `: any` ungated | P1 | new `colon-any` ratchet over `server/`, baseline **3085**, down-only | **ratchet green** |
| **F-16-1 / F-08-4** va/support AI escapes cost chokepoint | P1 | new `aiSpendGuard` — cost-ceiling gate at agent entry + telemetry per call (so their spend counts toward the ceiling + COGS); wired into `processAgentTask`, `generateBriefing`, `processSupportChat`; new `openai-bypass` ratchet (baseline **89**, down-only) | **test 4/4 + ratchet green** |

**Net: all 6 P0s + 9 P1 groups fixed, plus 2 new gates.** One integration test added (the crown-jewel tool P0); the rest verified by typecheck + reading + (for the schema/ratchet fixes) running the gate.

---

## Deliberately NOT done (with reason)

- **`lint:ledger-refs` gate (F-17-1's proposed gate).** A naive "every cited path must exist" check false-positives on every deletion the ledger correctly logs. A sound version needs to special-case executed-vs-pending rows — fragile. Per the adversarial principle (a noisy gate is worse than none), the stale pointers were corrected directly instead.
- **`: any` full remediation (3,085 sites).** The ratchet freezes it; remediating the tenant-key/money/auth subset is the follow-up. Bulk remediation is XL and was explicitly deferred in the audit.
- The audit's **deferred-with-trigger** items (marketplace/API count-gates, FK indexes before the 10k-lead tenant, schema-file split, residential-comps) — untouched by design; doing them now contradicts the audit.

---

## Remaining (larger / riskier — recommended next, not yet done)

These are real but each is a behavior-changing refactor or new CI infrastructure that warrants its own reviewed change rather than being folded into this security sweep:

1. **F-16-1 / F-08-4 — full tool-aware router migration (partially done).** ✅ The cost-ceiling gate + telemetry + the `openai-bypass` ratchet shipped (see the fixed table), so va/support spend is now capped and visible. ⏳ The *remaining* piece is routing these agents fully through a router — blocked because `routeAITask`'s message shape has **no `tool` role and its response has no `tool_calls`**, so tool-calling agents can't use it. The real unblock is extending `routeAITask` (or adding a tool-aware sibling) to carry `tools`/`tool_calls`, then migrating vaService/supportAgent/executive and driving the `openai-bypass` ratchet to 0. That's a shared-chokepoint change with wide blast radius — its own project.
2. **F-08-2 / F-08-3 — eval the served (Haiku) model; derive `DATA_GROUNDING_EVAL_GREEN` from a real run.** Add a Haiku lane to `eval.yml`; wire the switch to the last real Haiku dg-v1 pass-rate. The interim "drop `data_lookup_restate` floor to Sonnet" **raises AI cost** — a founder cost decision, deliberately not made unilaterally.
3. **F-05-2 — `lint:schema-migrate-mirror`.** Assert every `pgTable` column has a matching DDL statement in `migrate.mjs`. High value (prevents deploy 500s) but a robust textual matcher (renames, type changes) is non-trivial; a naive version would be noisy.
4. **F-10-2 — paginate `getNotes` / the 5000-capped reads.** Pre-scale (near-empty tables today); the right fix is real pagination, not another silent cap. Do before the first large tenant.
5. **F-18-1 — vendor-credential expiry (ATTOM ~2026-08-28).** The 80/20 is a calendar reminder + one `stepAwayReadiness` check, not the full `vendor_credential_expiry` table (over-built for one known expiry per the audit's own adversarial note).
6. **F-13-2 — execute one real DR restore drill** (operational, needs `DB_BACKUP_S3_BUCKET` provisioned) + fix runbook 07's dead link.
7. **F-15-2 — claim-truth tests behind the statute-register pointers.**

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
