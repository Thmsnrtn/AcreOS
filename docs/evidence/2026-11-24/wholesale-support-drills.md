# Wholesale support drills — evidence record (LOCAL ONLY)

**Run id:** drill-wholesale-w8-local-2026-11-24
**Date:** 2026-11-24 (executed 2026-11-25 ~05:14–05:16 UTC)
**Tree:** composed head = main `50f0f29862cf3ee3b7bee5ab7b7f108a1e0b5ee8` (PR #740 merge, verified unauthenticated) **plus** the PR #753 wholesale Pax-tools head `4063072f82daea829ef994c2294241e7a82d3d2f` (branch `wholesale-pax-tools-current`, verified unauthenticated). This drill PR is **stacked on #753 and lands only after it** — the wholesale tools under drill exist on main only once #753 lands.
**Executed by:** the drill tests in this PR — `tests/unit/wholesaleSupportDrills.test.ts` (drills 1, 2a, 2b), `tests/unit/wholesaleSupportDrillsStuck.test.ts` (drills 2c, 2d + the drill-3 capability pin), `tests/unit/wholesaleSupportDrillsData.test.ts` (drill 4) — run locally with vitest against the composed tree. **24/24 tests PASS.** LOCAL ONLY: no staging run, no real email, no provider call of any kind. The drills exercise the wholesale Pax tools through the REAL `executeTool` switch in `server/ai/tools.ts`, the REAL `checkAssignmentCompliance` in `server/routes-wholesaler-rules.ts` and the REAL `offerComplianceGate` over it (deliberately not mocked), and the REAL pure `resolveStateContractTemplate` in `server/services/contracts/contractAssembly.ts`. Mocks are infrastructure only — the db handle, the packet-derivation service (doubled so its call count can prove a blocked gate derives nothing), the decision/outcome stores, receipts, the clock, Pax controls and role scope, per the `paxWholesaleTools` precedent.

**Correction record (2026-11-25):** an earlier version of this record described a tool surface that does not exist in this codebase and claimed two legs no shipped test contains. That version was rejected by the PR #767 audit (Leg 2, evidence fidelity). This record has been rewritten to describe ONLY what the shipped drill tests actually execute or pin, using the real tool, function, field and error names as they appear in the test files and the repo (every name below was grep-verified against the composed tree). The two fabricated claim families are not silently deleted: the payout-honesty claim (Drill 1) and the dashboard-average claim (Drill 4) are carried below as **UNPROVEN**, with the plain reason, so they ride the promised scorecard as owed items.

**Step-0 landed-work check (before building):** main's tree contains exactly two drill sets (Notes #698, Tax #740); no wholesale drill set exists on main, in any open PR, or in any closed PR (wholesale hits were the Pax-tools and dashboard PRs). This set is new work, not a duplicate.

## Verdict summary

| Drill | Promised-bar moment | Verdict |
|---|---|---|
| 1 | Money moment — assignment fee as record, no-custody, EMD record | **PASS** — payout-honesty leg **UNPROVEN** (no payout surface exists; see Drill 1) |
| 2 | Stuck moment — compliance refusal, template gap, blast preflight | **PASS** (2d by source pin + supporting execution; see Drill 2) |
| 3 | "Pax told me X" — buyer-match / fee-figure traceability | **UNPROVEN** — defect **WS-DEF-1** |
| 4 | Data-wrong — comps/ARV are operator inputs; dashboard fee dispute | **PARTIAL** — decision / buyer-match / fee-agreement legs **PASS**; dashboard-average derivation **UNPROVEN** (see Drill 4) |

Drill 3 is UNPROVEN for the same structural reason as N9-DEF-1 / T9-DEF-1 / BH-DEF-1: the support resolver cannot reach the vertical's tools. It is pinned as a capability pin (below), not forced green. No census entries were added and no resolver code was touched (founder-gated).

## Drill 1 — money moment: the signed assignment fee is a record; only signed counts

**Seeded state (as the drills seed it):** org 7; deal 11 with two rows in `contract_assignments` — one `signed` with `assignmentFeeCents: 1_200_000` ($12,000) and one `draft` with `assignmentFeeCents: 900_000` ($9,000). A second leg seeds the draft row alone.

**Ticket:** "Where is my assignment fee — what is counted as my fee so far?"

**Correctness rule:** the fee total counts signed assignments only, stated as a record of the fee in the contract, never as money AcreOS holds or moves (the no-custody fence: `moneyCustodyHardStop`, `no-platform-money-custody`). A draft is not money and is never counted. EMD is likewise a record about a deposit held by a licensed third party, never a balance AcreOS holds.

**Observed (real tool paths):**
- `executeTool("get_wholesale_assignments", { deal_id: 11, organization_id: 999 })` → `success: true`, `signedCount: 1`, `signedFeeCents: 1_200_000`, `signedFee: "$12,000"`, and both assignment rows returned (length 2) — the $12,000 signed fee counts, the $9,000 draft does not. Org scoping is pinned on the query itself: the `contract_assignments` where-parameters contain the caller's org 7 and do NOT contain the passed-in 999 — the tool reads the caller's own account only.
- The coverage a support answer quotes states the no-custody truth verbatim: "An assignment fee is a RECORD of the fee in the contract — AcreOS holds and moves no money." and "Only a signed assignment counts toward the fee total."
- Draft-only seed → `signedFeeCents: 0` and the plain statement "No assignment on this deal is signed yet, so no fee is counted" — the draft's $9,000 is never quoted as money.
- Dashboard agreement, pinned by source on `server/routes-wholesaler-dashboard.ts`: the dashboard sums `contract_assignments` filtered to `status "signed"` (`SUM` over `assignmentFeeCents`) — the same population the tool counts; the wire carries `assignmentFeeSource`, and the fee is `null` — not zero, not an estimate — when the source is not `"assignments"` (`assignmentFeeSource === "assignments" ? totalAssignmentFeesCents : null`); the fee block contains no `netProfit` and no `analysisResults` (founder call B-6, #699: no netProfit proxy may feed the fee fields).
- EMD pins: the schema's own header in `shared/schema/earnest-money-events.ts` states the deposit is "HELD BY LICENSED THIRD PARTIES" and is "not a balance AcreOS holds"; the one writer in `server/routes-earnest-money.ts` only ever INSERTs into `earnest_money_events` ("this helper is the ONLY write path to the events") — no UPDATE or DELETE exists in that route (append-only discipline).

**UNPROVEN — payout honesty (correction, not a shipped leg):** an earlier version of this record claimed a payout-status leg (a `get_payout_status` tool answering "Payouts are not set up…"). No such tool — and no payout-status surface of any kind — exists in this codebase, and no shipped drill test contains a payout leg. The claim is therefore **UNPROVEN** and owed: the drills prove the fee-as-record and no-custody statements above, and nothing about payout status.

**Verdict: PASS** for the drilled legs (signed-only fee, org scoping, no-custody coverage, dashboard source pins, EMD schema/writer pins). The payout-honesty leg is **UNPROVEN** as corrected above.

## Drill 2 — stuck moment: the blast that cannot go, and why

**Seeded state:** `wholesaler_state_rules` rows — IL `license_required` (citation "735 ILCS 455/20", attorney-reviewed), TX `unrestricted`; WY exercised with NO rule rows seeded. Deals sit on a property at "1 Main St" whose state is set to IL or TX per leg.

**Ticket:** "My buyer blast won't go out and the contract won't generate — what is blocking me?"

**Correctness rule:** compliance refusals fire BEFORE any send or derivation machinery and name the state's rule and citation; a state with no rule on file is blocked, never silently allowed; a missing state template is a plain code-level refusal, never a fabricated document; a blast with no connected counterparty email identity starves honestly instead of sending from a platform address.

**Observed (real paths — the compliance module is NOT mocked in these drills):**
- (2a) `executeTool("get_wholesale_disposition_packet", { deal_id: 11 })` on the IL deal → `success: false`; the refusal's `what` states it "did not prepare a disposition packet", and its `why` states the deal is "blocked in IL", cites "735 ILCS 455/20", and names it as the "same state rule that blocks the buyer blast". The real `offerComplianceGate` fired over the real `checkAssignmentCompliance`: the packet derivation (`buildDispositionPacket`) was called **0 times** and zero updates were written — a blocked gate derives nothing.
- (2a, support visibility) The same real gate surfaces on the buyer-match read: `executeTool("get_wholesale_buyer_matches", { deal_id: 11 })` on the IL deal → `blastGate.status: "blocked"` — support sees the block before composing anything. On the TX deal → `blastGate.status: "clear"` and the gate statement matches "not legal advice" — a rule check on seeded states, stated as such.
- (2b) The REAL `checkAssignmentCompliance` called directly: with no rule rows seeded, `checkAssignmentCompliance("WY")` → `blocked: true`, `warn: false`, `recommendation: "double_close_only"`, and a summary stating "No rule entry on file for WY" and that the check "blocks assignment-template generation in unseeded states". The IL rule → `blocked: true` with `citation: "735 ILCS 455/20"` and `attorneyReviewed: true`. The TX rule → `blocked: false`, `warn: false`.
- (2c) The REAL pure `resolveStateContractTemplate("IL", "assignment_of_contract")` → `ok: false`, refusal code `STATE_NOT_CONFIGURED`, refusal state `IL`, and a refusal message naming Illinois. The TX control resolves (`ok: true`) — the refusal is about state coverage, not a blanket block. This leg tests the pure resolver function only; no contract-generation tool is executed by the drill.
- (2d) Blast identity preflight, pinned on the real route source `server/routes-buyer-blasts.ts`: the refusal `reason: "no_counterparty_email_identity"` appears in the source BEFORE the `.insert(buyerBlasts)` call, with `sent: 0` — the send path refuses before any blast row exists; the warning words a support answer quotes are verbatim in the source: "buyer blasts go out under your own sending identity" and "AcreOS does not email your buyers from its own address", and the preview surfaces the same warning as `sendingIdentityWarning`. The drill file pins this by source only; the preflight's execution proof lives in the supporting tests `buyerBlastIdentityPreflight.test.ts` and `counterpartyIdentityPreflight.test.ts`, which pass on this tree (see battery).

**Verdict: PASS** (2d by source pin + supporting execution, as noted). Every stuck path refuses or starves honestly, in plain words — and the compliance legs run the production rule engine itself, not a double.

## Drill 3 — "Pax told me X": buyer-match and fee figures a ticket cannot trace — UNPROVEN (WS-DEF-1)

**Ticket:** "Pax told me my best buyer match scores 88 and my signed fee is $12,000 — can you check that?"

**Correctness rule:** a support agent working the ticket through the support resolver (`server/ai/paxSupportResolver.ts`) must be able to re-run the same tools Pax used, against the same records, and reproduce the figure.

**Observed:** the resolver's `RESOLVER_TOOL_NAMES` holds exactly 13 generic tools (`search_knowledge_base`, `search_resolved_tickets`, `get_similar_resolutions`, `get_troubleshooting_steps`, `diagnose_account`, `check_data_integrity`, `get_account_summary`, `query_user_data`, `get_user_activity`, `estimate_resolution_confidence`, `recall_user_memory`, `draft_customer_response`, `escalate_to_human`). **None of the nine wholesale tools is in the set** — not `get_wholesale_buyer_matches`, not `get_wholesale_assignments` — while all nine ARE live on the chat path in `server/ai/tools.ts`. The drill pins this exactly: the chat path is asserted to carry all nine wholesale tools, and the resolver block is asserted to contain none of them (with a re-point-not-delete guard if the block cannot be found). A support agent therefore cannot reproduce a match score or a fee figure through the sanctioned resolver path; the ticket is untraceable by construction.

**Verdict: UNPROVEN — defect WS-DEF-1** (below). The pin turns red the day the resolver gains the tools, which is the cure's regression test.

## Drill 4 — data-wrong: the decision read reproduces recorded figures; comps and ARV are the operator's inputs

**Seeded state:** a recorded wholesale decision (id 5) whose scenario (`engineId: "wholesale_mao"`, `scenarioId: 9`) carries the predicted figures `max_allowable_offer: 9_000_000`, `assignment_fee: 1_000_000`, `profit: 1_000_000`; a stored buyer match (`buyerProfileId: 3`, `matchScore: 88`) on the org's own buyer list for the TX deal; and drill 1's assignment seed ($12,000 signed + $9,000 draft) for the fee-agreement leg.

**Ticket:** "Your figures for my deal look wrong — the offer math, the buyer match, and the dashboard fee."

**Correctness rule:** AcreOS computes nothing about value at support time — the decision read reproduces the recorded scenario's figures exactly, nothing recomputed and nothing rounded, and its coverage states that comps and ARV are the operator's own inputs (the residential-comps data plane is held: `lint:residential-comps-hold`). Buyer matches are stored scores from the org's OWN buyer list only, and asking does not re-run matching. The dashboard fee and the tool fee agree because both count the same population: signed assignments only.

**Observed (real tool paths):**
- (4a) `executeTool("get_wholesale_decision", { deal_id: 11 })` → the recorded decision reproduced exactly: `decisionId: 5`, scenario `wholesale_mao` / 9, and the predicted list verbatim (`max_allowable_offer` 9_000_000, `assignment_fee` 1_000_000, `profit` 1_000_000). Its coverage states verbatim: "Comps and ARV in it are the operator's own inputs — AcreOS supplies no residential comps." With no decision recorded → `decision: null` and the plain statement "No wholesale underwriting decision is recorded" — never a fabricated figure.
- (4b) `executeTool("get_wholesale_buyer_matches", { deal_id: 11 })` → the stored match returned as stored (`buyerProfileId: 3`, `matchScore: 88` — not re-run, not re-scored); coverage verbatim: "It covers this account's OWN buyer list only — buyers you entered or imported here.", "It does not include any other account's buyers, a shared buyer network, or buyers you have not added.", and asking "does not re-run matching". No buyer email or phone appears anywhere in the read's payload. With no stored matches → the plain statement "I cannot tell which, and I did not run it" — matching is not run to fill the gap.
- (4c) Tool-vs-dashboard fee agreement on drill 1's seed: `get_wholesale_assignments` returns `signedFeeCents: 1_200_000`, equal to the signed-only sum the dashboard rule pinned in drill 1 produces over the same rows; the draft row's 900_000 is present in the read as a draft, which explains the "off" feeling — neither surface counts it.

**UNPROVEN — dashboard average derivation (correction, not a shipped leg):** an earlier version of this record claimed a real dashboard derivation producing a closed-only average fee with separate earned/pipeline lines, and a blended "$6,750" the surface never produces. The fields that claim named (`averageAssignmentFeeCents`, `pipelineAssignmentFeesCents`, `totalAssignmentFeesEarnedCents`) exist nowhere in this codebase, `server/routes-wholesaler-dashboard.ts` contains no average or pipeline fee computation, and no shipped drill test exercises any dashboard average. The claim is therefore **UNPROVEN** and owed. What the shipped tests DO prove about the dashboard is narrower and stated above: the signed-only fee sum, its source field, and its agreement with the tool (drills 1 and 4c).

**Verdict: PARTIAL.** The decision-reproduction, own-list match, and fee-agreement legs **PASS**; the dashboard-average derivation is **UNPROVEN** as corrected above.

## Defect WS-DEF-1 — the support resolver cannot reach any wholesale tool

`RESOLVER_TOOL_NAMES` in `server/ai/paxSupportResolver.ts` contains 13 generic tools and **zero** of the nine wholesale Pax tools (`get_wholesale_buy_box`, `get_wholesale_triage`, `get_wholesale_buyers`, `get_wholesale_buyer_matches`, `get_wholesale_assignments`, `get_wholesale_decision`, `get_wholesale_disposition_packet`, `get_wholesale_blasts`, `record_buyer_blast_response` — all live in `server/ai/tools.ts` on the chat path). Any "Pax told me X" ticket about a buyer match, a fee figure, a disposition packet, or a blast is therefore untraceable through the sanctioned support path. Same shape as N9-DEF-1 (Notes), T9-DEF-1 (Tax), BH-DEF-1 (Buy-and-Hold). The cure (register the vertical's tools with the resolver, with the purpose-ledger census entries that requires) is founder-gated and is **not** in this PR; drill 3 pins the gap so the cure lands against a red-to-green test. No census entries were added by this PR.

## Residual (not a drill failure)

The **support clock is UNRATIFIED** (founder Tap #7 / R-10) — the same residual the N9 and T9 records carry. These drills prove the resolver/tool surface a support answer stands on; they assert nothing about response-time promises, because none has been ratified.

## Battery (this tree, local)

| Leg | Result |
|---|---|
| Drill files (3) | **24/24 PASS** (two consecutive full runs) |
| paxWholesaleTools / wholesalerDashboardProvenance / buyerBlastIdentityPreflight / counterpartyIdentityPreflight / earnestMoneyEventsWriter / moneyCustodyHardStop / paxSupportResolver / supportResolverCalibration / offerCompliancePopulation | 80 PASS, 0 fail |
| assignmentDocumentReview + contractChainReview (the STATE_NOT_CONFIGURED pins) | 9 PASS |
| purposeLedgerCensus + refusalsArePlainWords | 75 PASS (supportAgent dispatch untouched; run as insurance) |
| Lint legs (33 of 34 in `npm run check`) | PASS first-hand (schema ×3, ledger-refs, no-fabrication, measurement-defaults, boundaries, kernel-boundary, css-hover, page-hex, dead-token-alpha, zindex, translucency, model-prefix, prompt-envelope, contract-adoption, org-fetch, semantic-contrast, date-format, prefetch-authority, unchecked-mutation, route-order, route-shadowing, infrastructure-restraint, residential-comps-hold, inline-provenance, clock-reads, browser-safe-shared, reachability, status-vocabulary, ghost-fields, ratchets, eslint-ratchet) |
| lint:empty-update-set | **Not discharged locally** — OOM-killed once and timed out at 500s twice under fleet contention on this 6 GB VM; the change adds no update-set code. CI-discharge. |
| TypeScript | Scoped tsc over the 3 drill files: 109 errors, all in 15 pre-existing server files; a control run over pre-existing `paxWholesaleTools.test.ts` produced a **byte-identical** error set (scoped-graph artifacts: express Request augmentation etc.) — **zero diagnostics attributable to the drill files**. Full `check:app`/`check:tests` are CI-discharge (OOM class on this VM, per the Tax record). |
| Bundle | Customer **7,953 KB vs 7,954 KB limit — PASS**; founder **2,734 KB vs 2,735 KB limit — PASS**. Unchanged: this PR adds tests + this record only, no client/shared/server code. (Built via the vite builds in `script/build.ts` driven in-process; the build's two shell spawns — sitemap check, verified separately PASS — are blocked by the environment note below.) |

## Environment note

This VM intermittently denied interpreters (node/python) opening newly created files (EACCES) and shell spawns from node (spawnSync /bin/sh EACCES) during this run, and background processes were repeatedly killed by runtime restarts. Every result above comes from a completed run observed first-hand; legs that could not complete locally are named as CI-discharge rather than estimated. The drill files themselves were written so node can read them, and ran green twice consecutively.

## Files in this PR

- `tests/unit/wholesaleSupportDrills.test.ts` — drills 1, 2a, 2b.
- `tests/unit/wholesaleSupportDrillsStuck.test.ts` — drills 2c, 2d + drill-3 capability pin (WS-DEF-1).
- `tests/unit/wholesaleSupportDrillsData.test.ts` — drill 4.
- `docs/evidence/2026-11-24/wholesale-support-drills.md` — this record.

**No product code changes.** No census entries added. Nothing sent; zero provider calls.
