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

### 0.1 — The Ten (REMEDIATION briefs): confirm state, finish stragglers — 🔍 NEXT UP
Premise check from this session's reading: `REMEDIATION.md` records all 6 P0s +
9 P1 groups fixed, the 9-item continuation batch shipped (incl. F-18-1), and an
independent 6-dimension completeness pass that found + fixed 7 more defects.
Known deliberate residue to verify/disposition: F-16-1 full router migration was
PLANNED not shipped (`F-16-router-tool-migration-plan.md` — needs live API keys;
the load-bearing cost gate shipped via `aiSpendGuard`); that is 0.3's scope.
Exit test: each of the Ten's gates runs green at HEAD + no straggler brief open.

### 0.3 — Router totality + `.chat.completions.create` allowlist lint (Pax/VA/support/Atlas/Solene) — pending
Premises to verify: `openai-bypass` ratchet exists (baseline 89, down-only);
the six direct-completions offenders; the 3-phase migration plan's eval-gating
constraint (live keys). Exit: every AI call path routes via `aiRouter` or is
allowlisted with a shrinking baseline.

### 0.4 — `resolveActionPolicy` enforcement at the pending-actions chokepoint + `autonomyEnforcement.test` — pending
### 0.5 — Guard totality (non-streaming + subagent recursion enveloped, depth/step budgets, injection eval lane) — pending
### 0.6 — Connectors `executor.ts` P0 disposition (org-scoping, SSRF guard, enveloped results) — pending
### 0.7 — MCP server dark/per-org allowlist; hashed-key auth; shared-store rate limit — pending
### 0.8 — Mail lanes (`lobService` → `resolveProviderCredential`, purpose lanes, wedge cap, `mailProviderLanes.test`) — pending · **SEND LANE: propose-don't-merge (§A rule 5) — goes to founder approval queue before merge**
### 0.9 — Critical-job-failure pages (F-13-1 shipped — verify) + pager-matrix-as-data ratchet + external watchdogs armed (F-18-2) — pending

---

## Approval queue for the founder

*(empty — 0.8 will enter it when built, per §A rule 5)*

## Next item up

- **0.1**: run the Ten's gates at HEAD, verify no straggler, log. Then 0.3 → 0.9
  in order. Waves G/O/F/X-B may start in parallel once Wave 0 is green.
