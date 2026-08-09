# Master Handoff — progress ledger

*Maintained per the handoff's STATE & REPORTING rule. Any future session resumes
from this file, not from memory. Updated every working session.*

**Branch:** `claude/acreos-audit-2026-08-4l2rlu` · **Base at session start:** `016c619`
(Wave 5 merged — all 15 verticals core).

---

## ⚠️ Drift log (repo-at-HEAD vs. the handoff, which was written 2026-08-08/09)

| # | Drift | Consequence |
|---|---|---|
| D-1 | **RESOLVED 2026-08-09.** The master handoff document was absent from the repo at session start (not tracked or untracked anywhere). The founder supplied it in-session; it is now committed in full (§A–§G including all six reference parts) at `docs/handoffs/acreos-master-handoff.md`. | Wave 0 items 0.1–0.9, Waves 1–6, G/O/F/X are now enumerable. Program unblocked. |
| D-2 | **Item 0.2's headline premise is stale — the F-18-1 fix already shipped** in the remediation continuation batch (2026-08-06, `REMEDIATION.md` item 3): `server/services/vendorCredentialExpiry.ts` (registry seeded ATTOM `2026-08-28`), milestone paging in `sendDailyBriefing` (warn T-14/T-7, critical page ≤T-2 via `alertSpine`), and the `vendor_credentials` step-away readiness check. All verified wired at HEAD (scheduler → `runScheduledJobs.ts:1146`). | 0.2 re-scoped from "build it" to "verify at HEAD + close the enforcement gap" (below). |
| D-3 | The audit's F-18-1 **"Gate it"** (sole-source ⇒ expiry-row invariant) was NOT part of the shipped fix — no `vendor-expiry` ratchet existed and the unit test didn't derive from the sole-source allowlist. | Closed this session (see 0.2). Built as a **derived set-invariant test**, not a count ratchet — per `99-master.md:228`'s over-build dissent and the repo's derived-test preference. |

---

## Wave 0 — trust prerequisites

### 0.2 — ATTOM trial-key expiry registry + countdown paging + step-away check (F-18-1) — ✅ VERIFIED + GAP CLOSED

- **Status:** DONE at HEAD. Registry/paging/readiness pre-existed (D-2); this
  session verified each against code and closed the D-3 enforcement gap.
- **Verified at HEAD (against code, not reports):**
  - Registry: `vendorCredentialExpiry.ts` — ATTOM / `ATTOM_API_KEY` /
    `expiresOn: 2026-08-28` / sole-source-for residential comps; thresholds `[14,7,2,0]`.
  - Countdown paging: `founderBriefing.ts:193-202` inside `sendDailyBriefing()` —
    warning at T-14/T-7, **critical page ≤T-2 or expired** via `alertSpine.raiseAlert`;
    `sendDailyBriefing` is scheduled (`server/jobs/runScheduledJobs.ts:1146`) and
    manually triggerable (`routes-admin.ts:3906`).
  - Step-away check: `autopilot/stepAwayReadiness.ts:298-312` — `vendor_credentials`
    check; expired sole-source key ⇒ `action_needed` (verdict can't read "armed").
  - Timeline: today 2026-08-09 ⇒ T-19. First warn milestone fires **2026-08-14** (T-14).
- **Exit test (falsifiable, ratchet-style):** `tests/unit/vendorCredentialExpiry.test.ts`
  — extended from 5 → **9 tests, all passing**: (a) every member of
  `RESIDENTIAL_CAPABLE_PROVIDERS` (derived from source, not hardcoded) must have a
  registry row with a parseable date — removing the ATTOM row or adding a
  sole-source provider without one FAILS; (b) wiring pins — the paging block stays
  in `sendDailyBriefing`, `sendDailyBriefing` stays scheduled, the readiness check
  stays present with expired ⇒ `action_needed`.
- **Deliberately NOT built:** the audit's optional weekly live ATTOM probe
  (`vendor-health-probe` live-check). F-18-1 marks it optional and `99-master.md:228`
  flags the fix as already over-built for one vendor; the countdown + paging covers
  the known dated lapse. Revisit at ≥3 sole-source vendors.
- **Completeness audit:** wiring verified by call-site greps at every seam
  (registry→briefing→scheduler; registry→readiness) + the new wiring-pin tests
  make the verification permanent. Full `npm run check` + full `npm test` run on
  the commit (results in the session report).
- **Approval queue:** nothing — no gate/ratchet baseline changed, no hard-stop
  domain touched (a new derived test adds enforcement; it moves no baseline).

### 0.1 — The Ten (REMEDIATION briefs): confirm state, finish stragglers — ✅ CONFIRMED at HEAD
- **State:** `REMEDIATION.md` records all 6 P0s + 9 P1 groups fixed, the 9-item
  continuation batch shipped (incl. F-18-1), and an independent 6-dimension
  completeness pass that found + fixed 7 further defects (incl. 2 P1s introduced
  by the remediation itself). This session re-verified against code, not the
  report: full `npm run check` (tsc + all 21 lint gates + all ratchet families)
  exit 0 and full `npm test` 792 files / 10,700 tests / 0 failures at this tree,
  plus a dedicated clean-tree `npm run check` as 0.1's own gate-run evidence.
- **Straggler disposition (all four deliberate deferrals are ROUTED, none open):**
  1. `: any` bulk (~3,020 sites) — deferred by the audit's own design; frozen by
     the down-only `colon-any` ratchet (3,018 at HEAD). Not a straggler.
  2. Orphaned-table drops (`agent_improvement_plans`, `agent_synergy_map`) —
     queued for the FOUNDER table-drop decision (customer-data deletion is a
     hard-stop); schema defs preserved per reachability.json's note. → In the
     approval queue below as a standing founder decision.
  3. F-16-1 router migration Phase 2/3 — deferred pending a keyed environment +
     eval; the cost chokepoint (`aiSpendGuard`) + `openai-bypass` ratchet
     (baseline 89, down-only) shipped. → This IS item 0.3's scope; premise
     verification there decides what is mechanically migratable without keys.
  4. DR restore drill (F-13-2) — operational, founder/ops-run (needs
     `DB_BACKUP_S3_BUCKET`); runbook + staleness surfacing shipped. → Wave O2;
     the drill execution is a founder action.
- **Exit test:** the Ten's gates green at HEAD (evidence above) + zero un-routed
  stragglers. MET.

### 0.3 — Router totality + completions allowlist (Pax/VA/support/Atlas/Solene) — ✅ DONE (scope honest to the F-16 plan's key-gating)
- **Premise verification re-scoped the item:** the allowlist lint already exists
  (`openai-bypass` ratchet, baseline 89 down-only, tamper-pinned now). The F-16
  plan gates Phases 2–3 (the actual migrations) on a KEYED environment + eval —
  "reckless without" per the plan itself — so those are founder-queue, not this
  wave. Executed here:
  1. **F-16 Phase 1 — tool-aware `routeAITask`** (additive, opt-in): AITask gains
     `tools`/`toolChoice` + tool/assistant-with-tool_calls messages; AIResponse
     gains `toolCalls`/`finishReason` only when tools are used; incompatible
     features (json responseFormat, confidence, extended thinking, both cache
     layers, the cascade) explicitly disabled on the tools path with the choices
     documented; ceiling/telemetry/tier paths shared and untouched. Pinned by
     `aiRouterTools.test.ts` (8 tests, mocked client): pass-through, tool_calls
     surfacing, multi-turn round-trip, byte-identical no-tools request
     (regression pin), ceiling-before-client on the tools path, no-cache/
     no-cascade with a non-vacuity leg. Honesty: plumbing is mocked-client
     tested; NOT validated against live models (that is Phase 2's eval).
  2. **Derived cost-coverage invariant** (`aiCostCoverage.test.ts`, 7 tests):
     derives every tool-calling agent surface from source and asserts each
     enforces ceiling+telemetry (routeAITask | aiSpendGuard pair | inline
     ceiling+telemetry). A new unguarded agent surface fails CI. Plus a tamper
     pin on the openai-bypass ratchet (direction/baseline/pattern).
  3. **Finding CLOSED same-session:** `paxSupportResolver.resolveTicketWithPax`
     was a WIRED, customer-triggered tool loop (fires on every ticket creation +
     /pax-resolve) with ZERO cost enforcement, and the comment at its call site
     claimed otherwise. Wired with the sibling aiSpendGuard pattern
     (assertAiSpendAllowed + recordExternalAiSpend on both completion sites);
     false comment corrected; its allowlist entry removed so the invariant
     enforces it.
- **Findings held in the dated, down-only KNOWN_GAPS allowlist (founder queue):**
  Atlas main loop (`routes-founder-chat.ts` — own OpenRouter client, no ceiling/
  telemetry; its TOOLS route via routeAITask), Solene (`solene/chat/turnRunner.ts`
  — consults the ceiling + own caps but never writes aiTelemetryEvents, so the
  ceiling can't see its spend), `decisionsInbox.createFromFeatureRequest`
  (unguarded + likely unwired), `negotiationOrchestrator` (unguarded single-shots
  wired via routes-core-ai; its 6-round agent loop has ZERO call sites —
  built-but-unwired; fate decided at Wave 4.4's transplant/kill).
- **Exit test:** aiRouterTools 8/8 + aiCostCoverage 7/7 + openai-bypass ≤89 +
  full check/test green. MET (full-gate evidence in the commit).

### 0.4 — `resolveActionPolicy` enforcement at the pending-actions chokepoint — ✅ DONE
- **P-1 executed, enforcement-true without switching autonomy ON** (the
  load-bearing property, verified against code): `resolveActionPolicy(...)` →
  `suggest | draft | require_approval | auto_with_receipt | forbid` (+reason),
  consulted inside `approvalKernel.proposePendingAction` (the verified SINGLE
  `insert(pendingActions)` site) in resolve→forbid→stamp→insert order. `forbid`
  throws with the rule surfaced; every other verdict — INCLUDING
  `auto_with_receipt` — still lands frozen awaiting a human: the stamp records
  that the matrix grants autonomy, but no execution lane consumes it (the two
  `trustedApproval` human-tap endpoints are unchanged and pinned by a derived
  test). Any future auto lane must require the stamp AND the Wave 6.5
  standing-instruction consent artifact (seam documented, not built).
- **Resolution precedence:** explicit dailyActionLimit=0 ⇒ forbid · org-effective
  level = MIN across owner+expressing members (level 0 is a hard ceiling —
  per-action overrides cannot raise it) · none stored ⇒ require_approval ·
  $-threshold / money-bearing-with-no-ceiling / pausedUntil / time-guard window
  (org IANA timezone) each downgrade a provisional grant · read failure fails
  CLOSED to require_approval (never auto, never forbid).
- **Stamp:** `pending_actions.policy` jsonb (migration 0227 — one nullable
  column, mirrored; table-count unchanged 756). UI parity: `GET
  /api/me/autonomy/effective` renders verdicts from the SAME function; the three
  stale "wired progressively as Phase E" docstrings corrected.
- **Model gaps recorded honestly (not invented around):** dailyActionLimit>0
  count-capping deferred (stored model defines no counting unit/day boundary —
  only explicit 0 enforces); kernel-tool↔panel-action ids bridged by an explicit
  map (stricter wins; unmapped money-bearing tools can never go auto); legacy
  `organizations.paxAutonomyLevel` second store deliberately NOT consulted
  (never gated the kernel) — flag for consolidation at Wave 6.
- **Exit test:** `autonomyEnforcement.test.ts` — level-0 ⇒ zero auto possible
  (even with overrides), no-settings ⇒ require_approval, threshold/time
  downgrades, forbid writes nothing, stamp present, chokepoint-uniqueness
  derived pin. 49/49 with the kernel suite. MET.
### 0.5 — Guard totality (non-streaming + subagent recursion enveloped, depth/step budgets, injection eval lane) — pending
### 0.6 — Connectors `executor.ts` P0 disposition (org-scoping, SSRF guard, enveloped results) — pending
### 0.7 — MCP server dark/per-org allowlist; hashed-key auth; shared-store rate limit — pending
### 0.8 — Mail lanes (`lobService` → `resolveProviderCredential`, purpose lanes, wedge cap, `mailProviderLanes.test`) — pending · **SEND LANE: propose-don't-merge (§A rule 5) — goes to founder approval queue before merge**
### 0.9 — Critical-job-failure pages (F-13-1 shipped — verify) + pager-matrix-as-data ratchet + external watchdogs armed (F-18-2) — pending

---

## Approval queue for the founder

1. **Standing table-drop decision (pre-existing, surfaced not created here):**
   `agent_improvement_plans` + `agent_synergy_map` are orphaned (their sole
   readers/writers were deleted in the founder-approved dead-facade KILL) and
   queued in `reachability.json`'s note for an explicit DROP ruling. Customer-
   data deletion is a hard-stop, so only the founder can rule. No urgency; they
   sit inert in the reachability baseline until ruled on.
2. **DR restore drill (F-13-2 / Wave O2):** founder/ops-run with
   `DB_BACKUP_S3_BUCKET` — the one Ten item whose execution is physically a
   founder action.
3. **F-16 Phases 2–3 (router migrations)** — need a KEYED environment + the eval
   gate (the plan's own constraint). Decide when/where to run them; the tool-aware
   router (Phase 1) is now built and baked, so Phase 2 can start the moment keys
   exist.
4. **Founder-side metering design (from 0.3's findings):** (a) Atlas's main loop
   has no ceiling consult / telemetry — metering the founder's own cockpit has a
   real tradeoff (a misconfigured ceiling could block Atlas mid-incident); (b)
   Solene records spend to capitalTracker but not aiTelemetryEvents, so ceilings
   can't see it. Both held in aiCostCoverage's dated KNOWN_GAPS allowlist pending
   your call on the metering semantics for founder-org spend.
5. *(anticipated)* **0.8 mail lanes** will enter this queue when built — it is a
   send-lane change (§A rule 5: propose, don't merge).

## Next item up

- **0.5**: guard totality — `finalizePaxOutput` on the non-streaming path +
  SUBAGENT recursion (spawn_subagent outputs re-enter the parent inside the
  untrusted envelope), depth/step budgets on recursion, injection eval lane in
  CI (P2 P-2). Verify premises at HEAD first (F-08-1's non-streaming fix
  shipped in the Ten — confirm whether it covers the subagent path; the audit
  says a subagent can launder fabrication past the guard as a "tool result").
  Then 0.6 → 0.9 in order.
