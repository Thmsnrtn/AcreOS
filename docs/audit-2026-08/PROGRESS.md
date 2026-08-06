# Audit 2026-08 — Progress

**Question:** How would you improve this platform across every aspect possible?
**Mode:** read-only. Writes only under `docs/audit-2026-08/`. No prod code, no migrations, no destructive git.

## Phase status

| Phase | State | Notes |
|---|---|---|
| 0 — Priors + regression check | ✅ DONE | Orientation written; founder approved |
| 1 — Gate coverage (load-bearing six) | ✅ DONE | `01-gate-coverage.md` committed |
| Fan-out (T1–T5, 04–18, cosmetic) | ⏳ RUNNING | workflow `wd81gdj38`; T1+T2 landed & verified |
| 3 — Ledger reconciliation | ⏳ prep started | independent KILL-residue/FREEZE checks below |
| Synthesis (99-master) | ⛔ | |
| Adversarial pass | ⛔ | |

## Verification log (trust discipline — citations opened)

- **T1 F-20-1 (P1) CONFIRMED** — `routes-billing.ts:1150-1162`: Connect webhook marks event processed in `finally` even when handler throws; contrast platform webhook `webhookHandlers.ts:85-93` which releases-and-rethrows. Opened both; holds.
- **T2 F-21-1 (P0) CONFIRMED** — `routes-campaigns.ts:2042-2233`: campaign send-sms batch calls `client.messages.create` directly, 0 calls to `sendOrgSMS`/`dncGateForSms`; `canSendViaChannel` (tcpaCompliance.ts:407-433) is in-memory only; `dncScrub.ts:42-43` header falsely claims campaigns can't skip the choke point. Fully verified.
- **T2 F-21-2 (P1) CONFIRMED** — same handler reads `process.env.TWILIO_*`, no BYO lookup.

## Independent Phase-3 (ledger execution) findings

- **KILL residue clean at file level** — voice/satellite/SCP-five target files all gone. `routes-voice-learning` mention is correct (ledger Correction 1, live). One straggler: `whiteLabelService.ts:38,122` still advertises killed `voiceAI`/`visionAI` tenant flags (P3).
- **FREEZE un-wire items DONE but ledger checkboxes stale** — Capital tab removed (`money.tsx:31`), marketplace sidebar entry removed (`layout-sidebar.tsx:450`). Ledger `[ ]` boxes never ticked → doc drift (slice 17).
- **Un-executed KILLs (toward ≤600K/≤450):** (1) academy/certification — `routes-certification.ts` still mounted `/api/certification` behind `feature_academy`, `services/certification.ts` + courses/courseModules/courseEnrollments tables present; (2) negotiation-copilot standalone — `routes-negotiation.ts` mounted `/api/negotiation`, `pages/negotiation-copilot.tsx` routed `/negotiation` (FlaggedRoute), `services/negotiationCopilot.ts` present (orchestrator twin `negotiationOrchestrator.ts` also present → confirms "duplicate"). Both flag-gated OFF (hygiene holds) but not deleted.
- **3 SCP modules held, 0 prod importers** — `scpCustomerLifecycle`, `scpSelfProvisioning`, `scpExperimentEngine` exist, dead, awaiting founder ruling per SCPv2 row.

## Slice map (one writer per file)

**Primary lane (orchestrator writes):** `00-orientation.md` ✅, `01-gate-coverage.md`, `03-ledger-reconciliation.md`, `99-master.md`, `PROGRESS.md`.

**Fan-out (one slice each):**
- `20-trace-money-in.md` (T1) · `21-trace-message-out.md` (T2) · `22-trace-number-provenance.md` (T3) · `23-trace-tenant-boundary.md` (T4) · `24-trace-day-one.md` (T5)
- `04-service-sprawl.md` · `05-schema.md` · `06-type-safety.md` · `07-security.md` · `08-ai-systems.md` · `09-correctness.md` · `10-performance.md` · `11-frontend.md` · `12-testing.md` · `13-reliability.md` · `14-ux-mobile-a11y.md` · `15-compliance.md` · `16-cost.md` · `17-documentation-drift.md` · `18-solo-operator.md`
- `02-cosmetic-gates.md` (quick slice: one table row per cosmetic lint)

## Open threads (carry into slices)

- **sql.raw class survives no gate** — 38 occurrences repo-wide; DEFECT-0002's specific sites fixed but the pattern is ungated. → slice 07 + T4.
- **`: any` ungated** — ~3,731 in server/shared/client (excl .test). The ratchet only counts `as any`. → slice 06.
- **marketplace.ts is a grab-bag, not just marketplace** — holds courses/regulatory/compliance/whitelabel/webhook-event tables; its "churn" is deletion of dead tables parked there, NOT construction. → slice 05 + ledger.
- **Stale registry rows** — DEFECT-0059 (two onboarding wizards) already resolved (onboarding-v2 canonical since 2026-05-11); registry still says OPEN. → slice 17.
- **Notifications endpoints** in sovereign-integration use `_req` (no in-handler org scope) — guarded by path-prefix `isAuthenticated` but verify tenant scoping. → T4.

## Deviations from brief

- None yet.

## Resumption

If this run dies: read this file first. Re-dispatch only slices whose output file is absent or empty. Commits: `audit: <phase|slice> complete`.
