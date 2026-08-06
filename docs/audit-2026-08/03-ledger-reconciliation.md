# 03 — Ledger reconciliation & distance to H2

*Phase 3, primary lane. Audits the deletion ledger's **execution**, not its judgment. Every claim below was checked against code at HEAD `5ca0f29`. Consumes slices 04, 05, 17 + my own KILL-residue/FREEZE checks.*

---

## Distance-to-H2 dashboard

| Target | Now (HEAD) | H2 goal | Gap | Campaign status |
|---|---|---|---|---|
| TS/TSX LOC | **1,039,751** | ≤600,000 | **−439,751** | <½ done |
| `pgTable` count | **748** | ≤450 | **−298** | <½ done |

**The ledger's own KILL queue + this audit's finds account for ~24K LOC and ~80 tables of that gap — meaningful, but the 440K LOC gap is dominated by structural mass (the 500-table `schema.ts`, the large per-vertical service files), not the KILL queue.** Hitting ≤600K needs consolidation at the `schema.ts`/service-file level, not only deletion of dead modules. Hitting ≤450 tables is more reachable: ~80 tables are already gate-certified dead (F-05-3).

---

## Highest-yield next deletions (ranked, from the ledger's own KILL rows + unadjudicated finds)

| # | Target | LOC | Tables | Ledger status | Verified at HEAD |
|---|---|---|---|---|---|
| 1 | **Founder narrative V6–V14** (8 renamed routers + 43 `*V[6-14].ts` services) | **~20,091** (2,763 + 17,328) | — | KILL row #1 "biggest pure win" — **UN-EXECUTED, stale pointers** | routers mounted `routes.ts:1865-1879`; services present. Keep the 2 refit pages (`/founder/scenarios`, `/founder/governance`) per the row. |
| 2 | **7 dead solene modules** (F-04-1) | **~2,064** | — | Unadjudicated | only importer is own test; no dynamic/string refs |
| 3 | **Negotiation-copilot standalone** | **1,788** | — | KILL — **UN-EXECUTED** | `routes-negotiation.ts` mounted `/api/negotiation`; `pages/negotiation-copilot.tsx` routed `/negotiation`; orchestrator twin present (confirms "duplicate") |
| 4 | **Academy/certification** | **467** | 4 (`courses`,`courseModules`,`courseEnrollments`,`tutorSessions`) | KILL — **UN-EXECUTED** | `routes-certification.ts` mounted `/api/certification` behind `feature_academy`; tables in `marketplace.ts` |
| 5 | **3 dead SCP modules** (`scpCustomerLifecycle`/`SelfProvisioning`/`ExperimentEngine`) | ~? | — | Held pending founder ruling (SCPv2 row) | 0 production importers each |
| 6 | **~80 gate-certified dead tables** (F-05-3) | — | **~80** (45 no-writer ∪ 57 no-reader, minus 3 known false-positives) | Unadjudicated (13/14 sampled absent from ledger) | from `lint-reachability --measure` |

**Row 1 is the single biggest lever in the entire campaign** — ~20K LOC (≈4.5% of the whole gap) sitting in the ledger's own #1 row, un-executed, behind stale filenames. But it needs care, not `rm -rf`: some narrative-name strings appear in `nav-items.ts`/`governance.tsx` (the 2 KEEP refit pages). Execute per-router with a client-consumer check.

---

## KILL execution audit

**Clean executions (verified — no residue):** voice, satellite/vision, SCP-five, `routes-sso.ts`, platform-custody surfaces. Target files gone; the only string mentions remaining are correct (`routes-voice-learning` is the live Correction-1 module; not residue).

**One straggler:** `whiteLabelService.ts:38,122` still advertises killed `voiceAI`/`visionAI` as tenant feature flags (`visionAI: true` in a preset). White-label is itself FROZEN/flag-off so no live exposure — P3 cleanup, folds into the white-label freeze.

**Un-executed KILLs (rows 1, 3, 4 above):** the ledger marks these KILL but code shows them mounted (all correctly flag-gated OFF, so hygiene holds — but not deleted). The ledger has **no "executed" log entry** for any of them. Row #1's pointers are actively misleading (F-17-1): it cites `routes-founder-v6.ts` (renamed away), so a fresh session greps, finds nothing, and assumes the deletion happened. **This is the most expensive ledger defect: a false "done" on the biggest row.**

---

## FREEZE leakage audit

**Both H0 "immediate un-wire" items are DONE — but the ledger checkboxes are stale (`[ ]`):**
- Capital tab removed from `money.tsx:31` (comment records the 2026-07-07 removal).
- Marketplace sidebar entry removed (`layout-sidebar.tsx:450`).

So the `money.tsx`-Capital-tab-against-a-404 analogue the ledger worried about is resolved; no FREEZE surface currently bleeds into the five customer doors. **The drift is documentation-only: the ledger shows unchecked boxes for completed work** (slice 17's theme).

**marketplace.ts churn explained (Section 1's open question):** it churns because it's a **grab-bag** — dead tables from *other* killed subsystems (`voiceCalls`, `satelliteSnapshots`) physically lived there and are being removed. Not marketplace construction. No FREEZE violation. But the file mixes 27 tables across 6 unrelated domains (F-05-5); its name defeats file-level FREEZE reasoning.

**public-api.ts (4 tables) vs "no public API <50 customers":** KEEP-dormant by deliberate founder decision (scaffold-only, routes unmounted, the one allowlisted `unregisteredRoutes` entry). Not a violation — concur, do not relitigate.

---

## Unadjudicated inventory (the ledger's blind spots — it missed a second voice pipeline once)

Feed these to the next KILL-decision cycle:
1. **43 `*V[6-14].ts` narrative service suites** (17,328 LOC) — nominally under KILL row #1 but never individually adjudicated or executed.
2. **7 test-only solene modules** (F-04-1, 2,064 LOC) — zero ledger rows.
3. **~80 dead tables** (F-05-3) — 13/14 sampled absent from the ledger.
4. **3 held SCP modules** — named but ruling deferred.
5. **`services/taxOptimizationEngine.ts`, `field-scout` visits/photos API** — the ledger's own Wave-A notes flagged these "consumer-less, candidate for a follow-up wave"; never followed up.

---

## Proposed ledger corrections (hand to slice 17's fix)

1. **Rewrite row #1**: real filenames (`routes-founder-<name>.ts`), mount ref `routes.ts:1865-1879`, list the 43 services with LOC, mark KILL-pending with a live task. Add the vN⇄filename decoder table (F-17-2).
2. **Tick the two H0 un-wire boxes** (done since 2026-07-07).
3. **Add executed-log entries or KILL-pending flags** for academy + negotiation-copilot.
4. **Gate it:** `lint:ledger-refs` — parse `` `path` `` / `file.ts:LINE` tokens from `deletion-ledger.md` + `defect-registry.md`, fail on any path absent from disk. Baseline: measure current dangling refs (row #1 alone contributes ≥3). **This is the gate that would have caught the false "done."**

---

## Verdict

The ledger's **judgment** is sound (KILL/FREEZE/KEEP verdicts hold; no KEEP is wrong). Its **execution and bookkeeping** have drifted: the #1 KILL is un-executed behind stale pointers, three KILLs sit undone, two done items show unchecked boxes, and ~80 dead tables plus ~22K LOC of dead modules were never adjudicated. **None of this is a correctness risk today (all correctly gated off) — it is a shrink-campaign integrity risk: the ledger overstates progress, so the founder cannot trust its "done."** The fix is cheap (rewrite row #1 + one `lint:ledger-refs` gate) and unlocks the campaign's single biggest LOC lever.
