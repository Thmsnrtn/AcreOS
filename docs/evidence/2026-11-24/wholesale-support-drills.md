# Wholesale support drills — evidence record (LOCAL ONLY)

**Run id:** drill-wholesale-w8-local-2026-11-24
**Date:** 2026-11-24 (executed 2026-11-25 ~05:14–05:16 UTC)
**Tree:** composed head = main `50f0f29862cf3ee3b7bee5ab7b7f108a1e0b5ee8` (PR #740 merge, verified unauthenticated) **plus** the PR #753 wholesale Pax-tools head `4063072f82daea829ef994c2294241e7a82d3d2f` (branch `wholesale-pax-tools-current`, verified unauthenticated). This drill PR is **stacked on #753 and lands only after it** — the wholesale tools under drill exist on main only once #753 lands.
**Executed by:** the drill tests in this PR — `tests/unit/wholesaleSupportDrills.test.ts` (drills 1, 2a, 2b), `tests/unit/wholesaleSupportDrillsStuck.test.ts` (drills 2c, 2d + the drill-3 capability pin), `tests/unit/wholesaleSupportDrillsData.test.ts` (drill 4) — run locally with vitest against the composed tree. **24/24 tests PASS.** LOCAL ONLY: no staging run, no real email, no provider call of any kind. The drills exercise the wholesale Pax tools through the REAL `executeTool` switch in `server/ai/tools.ts`, the REAL `checkAssignmentCompliance` / `offerComplianceGate` in `server/routes-wholesaler-rules.ts` (deliberately not mocked), and the REAL `resolveStateContractTemplate` in `server/services/stateContractTemplates.ts`. Only the db handle, the packet-derivation counter, and the decision/outcome stores are doubled, per the `paxWholesaleTools` precedent.

**Step-0 landed-work check (before building):** main's tree contains exactly two drill sets (Notes #698, Tax #740); no wholesale drill set exists on main, in any open PR, or in any closed PR (wholesale hits were the Pax-tools and dashboard PRs). This set is new work, not a duplicate.

## Verdict summary

| Drill | Promised-bar moment | Verdict |
|---|---|---|
| 1 | Money moment — assignment fee as record, no-custody, EMD record | **PASS** |
| 2 | Stuck moment — compliance refusal, template gap, blast preflights | **PASS** |
| 3 | "Pax told me X" — buyer-match / fee-figure traceability | **UNPROVEN** — defect **WS-DEF-1** |
| 4 | Data-wrong — comps/ARV are operator inputs; dashboard fee dispute | **PASS** |

Drill 3 is UNPROVEN for the same structural reason as N9-DEF-1 / T9-DEF-1 / BH-DEF-1: the support resolver cannot reach the vertical's tools. It is pinned as a capability pin (below), not forced green. No census entries were added and no resolver code was touched (founder-gated).

## Drill 1 — money moment: the assignment fee is a record; AcreOS holds nothing

**Seeded state (as support would see it):** org 501 with NO Stripe Connect account; deal "Maple assignment" whose stored packet carries `assignmentFeeCents: 750_000` ($7,500) and `assignmentFeeAssignmentCents: 600_000` ($6,000); a second deal "Birch assignment" ($4,200); seller "Sam Seller" (no email), buyer "Bayou Buyers LLC" (opted in), a wholesaler assignment agreement, and one EMD event row (amount 250_000, method "wire", status "held_by_title", recorded 2026-11-02).

**Ticket:** "Where is my $7,500 assignment fee — has it been paid out to me yet?"

**Correctness rule:** the fee is computed from the deal's own stored packet figures and stated as a record, never as money AcreOS holds or moves; the no-custody fence (`moneyCustodyHardStop`, `no_platform_money_custody`) forbids any payout path, and the org's missing Connect account makes "not set up" the only honest payout answer. EMD is likewise a record the operator keeps (held by title/escrow), never funds in AcreOS.

**Observed (real tool paths):**
- `calculate_assignment_fee` (dealId) → feeCents 750_000, arvCents 4_200_000, maoCents 2_940_000, equitySpreadCents 1_260_000, `source: "stored_deal_packet"` — the $7,500 reproduces exactly from the seeded packet.
- `calculate_assignment_fee` (manual figures) → feeCents 525_000, `source: "provided_figures"`, `persisted: false` — what-if math is labeled non-persisted.
- `get_payout_status` → `connectStatus: "not_connected"`, payoutsEnabled false, and the tool's own words: "Payouts are not set up for this workspace, so no assignment fee has been paid out through AcreOS." The $7,500 was never AcreOS's to pay.
- `get_deal_pipeline_summary` → 2 active assignments, totalAssignmentFeesCents 1_170_000 ($7,500 + $4,200, the operator's own records summed), stage counts {contract:1, marketing:1}, top deal = Maple.
- `list_earnest_money_events` → the seeded EMD row verbatim (250_000, wire, held_by_title) — a record of money held by title, not by AcreOS.
- Source pin: `server/routes-earnest-money.ts` states in its own header that an EMD event "is a record, never a movement of funds... the money itself stays wherever it actually is (title company, escrow, attorney trust, the buyer's bank)."

**Verdict: PASS.** Support can answer the money question end-to-end from stored records, and every surface states the no-custody truth in plain words.

## Drill 2 — stuck moment: the blast that cannot go, and why

**Seeded state:** wholesaler state rules — IL `license_required` (citation "735 ILCS 455/20", effective 2020-01-01), TX `unrestricted`, WY unseeded; a deal in Springfield, IL (contract with seller + opted-in buyer present) and one in Austin, TX; `senderIdentities: []` (the org never connected an email identity); a second org whose only buyer opted out (`emailOptIn: false`) and whose only seller has no email.

**Ticket:** "My buyer blast won't go out and the contract won't generate — what is blocking me?"

**Correctness rule:** compliance refusals fire BEFORE any send machinery, carry the state's citation, and name the cure; a missing state template is a plain-words gap, never a fabricated document; a blast with no connected identity starves honestly instead of sending from a platform address.

**Observed (real paths — the compliance module is NOT mocked in these drills):**
- (2a) `send_buyer_blast` on the IL deal → refused by the REAL `checkAssignmentCompliance` against the seeded IL row: code `wholesaler_compliance_blocked`, httpStatus 409, reason names the citation ("Illinois requires a real estate license to wholesale (735 ILCS 455/20)"), cure = `obtain_license_or_partner` / "Obtain a real estate license, or partner with a licensed broker for Illinois deals." The TX control deal passes the same real gate (`allowed: true`, status "unrestricted") — the refusal is the rule, not the wiring.
- (2b) `generate_assignment_contract` (IL) → the packet builds (real derivation runs once), then the REAL `resolveStateContractTemplate("IL", "assignment_of_contract")` returns `STATE_NOT_CONFIGURED` — only NC/TX/FL/GA ship templates — and the tool refuses in plain words: "No state packet is configured for Illinois yet, so I can't generate this contract. Supported states: NC, TX, FL, GA." No document is fabricated.
- (2c) With compliance green (TX deal) but `senderIdentities: []` → the blast starves at the FD5 identity preflight: `success: false`, errorCode `sender_identity_required`, "Connect your own email account first — buyer outreach is sent from your own address, never from a shared AcreOS address." Zero sends attempted; no platform sending path exists to fall back to.
- (2d) `list_counterparties` → coverage stated exactly as the tool emits it: the opted-out buyer is `emailOptIn: false` (the matcher skips opt-outs — the stop-on-reply fence as it exists in this codebase), and the emailless seller reports `email: null`. Support sees the same coverage truth the operator sees; nothing is dressed up.

**Verdict: PASS.** Every stuck path refuses or starves honestly, in plain words, with the cure named — and the compliance leg is the production rule engine itself, not a double.

## Drill 3 — "Pax told me X": buyer-match and fee figures a ticket cannot trace — UNPROVEN (WS-DEF-1)

**Ticket:** "Pax told me my best buyer match is 92% and my fee would be $7,500 — can you check that?"

**Correctness rule:** a support agent working the ticket through the support resolver (`server/ai/paxSupportResolver.ts`) must be able to re-run the same tools Pax used, against the same records, and reproduce the figure.

**Observed:** the resolver's `RESOLVER_TOOL_NAMES` holds 13 generic tools (deals, leads, mail, portfolio, tasks, calendar, activity, data quality, platform info). **None of the nine wholesale tools is in the set** — not `match_buyers`, not `calculate_assignment_fee` — while all nine ARE live on the chat path in `server/ai/tools.ts`. The drill pins this exactly: the resolver set is asserted disjoint from the wholesale tool set, and the chat path is asserted to carry all nine. A support agent therefore cannot reproduce a match score or a fee figure through the sanctioned resolver path; the ticket is untraceable by construction.

**Verdict: UNPROVEN — defect WS-DEF-1** (below). The pin turns red the day the resolver gains the tools, which is the cure's regression test.

## Drill 4 — data-wrong: comps and ARV are the operator's inputs; the dashboard fee dispute

**Seeded state:** a deal whose packet carries operator-entered `arvCents: 4_200_000`, `repairEstimateCents: 900_000`, `assignmentFeeCents: 750_000`, `assignmentFeeAssignmentCents: 600_000` (asking), `contractPriceCents: 2_850_000`, plus a seller asking price of 2_900_000 in the packet notes; dashboard inputs with a CLOSED deal (sold 2026-08-14, closed 2026-09-01, fee 600_000) and an ACTIVE deal (fee 750_000).

**Ticket:** "Your comps say my ARV is $42,000 and the dashboard says my average fee is $6,750 — both look wrong."

**Correctness rule:** AcreOS computes nothing about value — ARV and repair figures are operator inputs stored on the deal, the fee math is a stated formula over those inputs, and no tool may present a valuation as AcreOS's own (the residential-comps data plane is held: `lint:residential-comps-hold`). The dashboard's average is over CLOSED deals only; an active deal's fee is pipeline, not earnings.

**Observed (real tool paths):**
- `analyze_wholesale_deal` → returns the seeded figures verbatim (arvCents 4_200_000, repairEstimateCents 900_000), `assignmentFeeCents: 750_000` with `assignmentFeeSource: "packet"` (the operator's stored figure wins), MAO 2_940_000 = 70% of the operator's ARV − repairs, and `arvSource: "operator_provided_packet"` — provenance is in the payload, not implied.
- `get_wholesaler_dashboard` (REAL derivation) → closedDeals 1, averageAssignmentFeeCents 600_000 (the closed deal only), totalAssignmentFeesEarnedCents 600_000, pipelineAssignmentFeesCents 750_000, activeDeals 1. The operator's "$6,750" blends the active deal's $7,500 asking fee into the average; the surface never does — earned and pipeline are separate lines with separate labels.
- Source pins: no tool under drill contains a "we estimate / AcreOS values / our valuation" claim, and the comps-hold lint passes on this tree (see battery).

**Verdict: PASS.** Support can show the operator exactly which of their own inputs produced each figure, and the disputed average resolves to a labeling distinction the product itself maintains.

## Defect WS-DEF-1 — the support resolver cannot reach any wholesale tool

`RESOLVER_TOOL_NAMES` in `server/ai/paxSupportResolver.ts` contains 13 generic tools and **zero** of the nine wholesale Pax tools (`match_buyers`, `calculate_assignment_fee`, `analyze_wholesale_deal`, `get_deal_pipeline_summary`, `list_counterparties`, `send_buyer_blast`, `generate_assignment_contract`, `generate_loi`, `get_payout_status` — all live in `server/ai/tools.ts` on the chat path). Any "Pax told me X" ticket about a buyer match, a fee figure, a pipeline total, or a payout state is therefore untraceable through the sanctioned support path. Same shape as N9-DEF-1 (Notes), T9-DEF-1 (Tax), BH-DEF-1 (Buy-and-Hold). The cure (register the vertical's tools with the resolver, with the purpose-ledger census entries that requires) is founder-gated and is **not** in this PR; drill 3 pins the gap so the cure lands against a red-to-green test. No census entries were added by this PR.

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
