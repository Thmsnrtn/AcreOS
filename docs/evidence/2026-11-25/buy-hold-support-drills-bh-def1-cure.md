# Buy-and-Hold BH — BH-DEF-1 cure and drill 3 re-run (addendum to buy-hold-support-drills.md) — LOCAL run

**Spec:** cure **BH-DEF-1** (filed in `docs/evidence/2026-11-24/buy-hold-support-drills.md`, PR #757) and complete Buy-and-Hold drill 3 — `buy_and_hold` promised bar item (e). The cure mirrors the T9-DEF-1 cure (PR #742) and the N9-DEF-1 cure (PR #738) in shape, with one deliberate divergence: the tenant read is excluded, for the reason stated in full below.
**Run id:** `drill-bh-def1-cure-local-2026-11-25`
**Run (ET):** 2026-11-25, early ET (builder lane; local execution).
**Environment:** LOCAL ONLY — repo worktree at main head `50f0f29862cf3ee3b7bee5ab7b7f108a1e0b5ee8`. **No staging or prod access was used and no staging/prod data was read or mutated.** No drill org exists for this run — no org was created anywhere.
**Step 0 (landed-work check):** at the base head, `RESOLVER_TOOL_NAMES` (`server/ai/paxSupportResolver.ts`) is the same 13 generic tools the #757 record read, and `server/ai/supportAgent.ts` has no buy-hold dispatch case; unauthenticated GitHub search for "BH-DEF-1" returns only PR #757 itself (open, the drill record). No cure was landed or in flight — this PR is the cure, not a duplicate.
**Messages sent during the drills:** ZERO by construction — every leg is a pure function, the real support switch with mocked data sources, or the real resolver gate with a mocked model. Zero real mail, absolute, as in #757.

---

## The cure

**Registry constraint (why support-only names):** the Pax registries key one dispatch per tool name (`TOOL_REGISTRY` in `shared/pax-controls.ts`, `CAPABILITY_ROWS` in `shared/pax-capabilities.ts`), and the seven #737 buy-hold names already dispatch through the chat executor (`executeTool`). The support switch therefore cannot reuse them — the same constraint the N9 and T9 records document. The cure adds support-only variants of the four **non-PII reads**, each dispatching through `executeSupportTool` to the SAME shared helpers the chat path uses (`server/ai/buyHoldTools.ts`: `paxGetRentRoll`, `paxGetRentalLeases`, `paxGetLeaseLedger`, `paxGetRentalUnderwritingDecision`, converted by `buyHoldOutcomeToResult`), so coverage statements and shaping are identical on both paths by construction, not by copy.

| Support name (new) | Shared read | Chat name (unchanged) |
|---|---|---|
| `get_rent_roll_view` | `paxGetRentRoll` | `get_rent_roll` |
| `get_rental_leases_view` | `paxGetRentalLeases` | `get_rental_leases` |
| `get_lease_ledger_view` | `paxGetLeaseLedger` | `get_lease_ledger` |
| `get_rental_underwriting_view` | `paxGetRentalUnderwritingDecision` | `get_rental_underwriting_decision` |

**Read-only only.** The two #737 writes, `record_rent_payment` and `generate_scheduled_rent_charges`, have **no** support variant: not defined in `supportToolDefinitions`, not in `PAUSE_SAFE_SUPPORT_TOOLS`, not in the resolver subset, and not in the support registry rows (pinned in the drill file). Receipts discipline is unchanged (the reads carry `receipt: "none"`, like the tax and notes reads). **FD5 untouched:** no tenant send exists on either path here.

**Registration (every place the pattern registers a support tool):**
- `server/ai/supportAgent.ts` — four tool definitions, four `executeSupportTool` cases, four entries in `PAUSE_SAFE_SUPPORT_TOOLS` (all four are pure reads, so a paused org can still be told the truth about its rent roll).
- `server/ai/paxSupportResolver.ts` — `RESOLVER_TOOL_NAMES` subset, and a resolver-prompt paragraph directing rent/lease tickets to the reads (state the coverage; an empty roll is empty; a recorded decision or its stated absence; tenant details are NOT available on this path — escalate, never guess; never promise to record or generate).
- `shared/pax-controls.ts` — the four names in the `executeSupportTool` `looks_and_drafts` list.
- `shared/pax-capabilities.ts` — four capability rows (`dispatch: executeSupportTool`, `group: looks_and_drafts`, `family: buy_and_hold`, `pauseSafe: true`, `receipt: "none"`, coverage `single_slice` with the #737 `notCovered` text).
- `docs/compliance/pax-capability-inventory.md` — regenerated (158 rows).

**Resolver subset, before → after:** before = the 13 generic tools #757 read (`search_knowledge_base`, `search_resolved_tickets`, `get_similar_resolutions`, `get_troubleshooting_steps`, `diagnose_account`, `check_data_integrity`, `get_account_summary`, `query_user_data`, `get_user_activity`, `estimate_resolution_confidence`, `recall_user_memory`, `draft_customer_response`, `escalate_to_human`). After = those 13 **+ exactly the four support buy-hold reads** above, inserted after `get_account_summary`. Nothing else entered or left the subset (pinned by equality in the drill file).

## The get_tenants exclusion — the fence is not weakened to complete a drill

The fifth #737 read, `get_tenants`, has **no support variant in this cure**, and drill 3's completion is scoped to the four reads above. The reason is structural, and it is pinned in the drill file so a future reader cannot mistake it for an oversight:

- On the chat path, the permission ladder checks `get_tenants` against the `tenant_pii_read` scope for **every** caller: `tools.ts` runs the check for PII scopes even while Pax is paused and even for an unidentified caller (who is refused). That is the fence drill 4 pins.
- On the support path, the ladder (`executeSupportTool`'s gate over `SUPPORT_TOOL_SCOPES` → `userHasScope`, checked against the ticket's author and the person who asked) runs **only** for tools classified as side-effecting — the gate is guarded by `if (!pauseSafe)`. A read can reach that gate only by leaving the pause-safe set.
- But the classification system cannot represent a gated read truthfully. `paxControlsOffered.test.ts` pins the support `looks_and_drafts` registry to the pause-safe set **exactly**, so a non-pause-safe read cannot sit there; the remaining groups are `changes_records` (which requires a record domain — this tool changes nothing, and `decidePaxCall` would rail it as a record change) and `sends` (it sends nothing). And a pause-safe variant would be misregistered as well as ungated: `paxCapabilityInventory.test.ts` derives a support row's scope solely from `SUPPORT_TOOL_SCOPES`, which `supportToolsHonorThePermissionLadder.test.ts` forbids declaring for a pause-safe tool — its row would claim scope `null`.
- Every placement therefore either drops the ladder check (weakening the fence relative to the chat path) or writes a false statement into the registries the controls page and the capability inventory render from. Neither is acceptable; the exclusion is.
- What a support ticket that turns on tenant details gets instead: the resolver prompt now states tenant names/contact are not available on this path and directs escalation rather than guessing. Tenant PII remains reachable exactly where it was — the chat path, behind the ladder, and the REST doors behind `requireScope`.
- The change that would reopen this is an architecture decision — a gated-read classification the registries can state truthfully (a scope-bearing read class on the support switch) — named here as a founder/architecture call, not taken inside a drill cure.

## Drill 3 — "Pax told me X" on the support path — PASS (local form; live-LLM staging leg remains the named residual)

- **Seeded state (synthetic, local):** drills 1/3's own walk figures — two units (3B leased, 3C never leased), November rent $1,500 + $50 late fee on the 3B lease, $500 recorded November 10 — leaving $1,050 open and overdue, occupancy 50%. The ticket quotes a prior Pax chat answer claiming everything is paid and occupancy is 100%, and asks support to check it.
- **Correctness rule (from #757, unchanged):** correct = the support-path answer is grounded in the rent-roll, leases, ledger or underwriting reads (with their coverage statements), OR an escalation. FAIL = a confident resolution the resolver could not have grounded.
- **Pinned (written in exactly this form; their execution tonight is CI-discharge — see the execution note under Pre-publish gates):**
  - **Capability pin, flipped:** `tests/unit/buyHoldSupportDrills.test.ts` now pins the subset at prior-13 + exactly the four reads (equality, in order), pins that no chat buy-hold name and no write name is in the subset, pins every subset name resolving to a real support definition, pins the four reads' registration (definition, pause-safe, `looks_and_drafts`, capability row), pins the absence of any support write variant, and pins the `get_tenants` exclusion with its reason (no tenant-named support tool exists; the chat fence is unchanged; the resolver prompt carries the not-available/escalate direction).
  - **Real-switch legs:** through the REAL `executeSupportTool` switch (only `db` mocked, the `paxBuyHoldTools.test.ts` pattern, clock pinned to 2026-11-23): the rent-roll read returns occupancy 50% (never-leased 3C counts vacant), $1,050 open and overdue, under the verbatim coverage statement, with org 77 decoded in the queries' WHERE and no tenant PII fields anywhere in the payload; the leases read lists the 3B lease shaped without tenant fields; the ledger read returns drill 1's figures (charged $1,550, paid $500, open $1,050, allocations split $450 rent / $50 fee); the underwriting read returns the frozen decision and, with no snapshot, states absence instead of reconstructing one; a unit label is refused as a lease id in plain words (no tool-name or parameter identifier in the refusal) and an unknown id is refused — nothing invented.
  - **Resolver leg:** `tests/unit/buyHoldSupportDrillsResolver.test.ts` drives the REAL resolver gate (mocked model, mocked db, #738's form): the model reads `get_rent_roll_view` → `get_lease_ledger_view`, then drafts the correction — occupancy corrected to 50% with 3C vacant, the $1,050 open balance stated, coverage stated, no record or send promised — at high confidence, and the gate auto-resolves (1 reply inserted, no escalation). Auto-resolve is CORRECT here precisely because the reply is grounded in the reads, which was structurally impossible before the cure.
- **Verdict: PASS** in the local form, scoped to the four non-PII reads (the `get_tenants` exclusion above) — with the execution caveat stated in the execution note: the drill legs are pinned in the same form #742 executed for T9, and their green run is CI's to confirm on this PR before merge. **BH-DEF-1 is CLOSED by this PR** for every read the support path can hold without weakening the tenant-PII fence. The live-LLM staging observation stays a named residual (no staging access in this lane), as it was for the N9 and T9 cures.

## Drills 1, 2, 4, 5 — no regression

#757's deterministic legs for drills 1, 2, 4 and 5 are carried into this PR's `buyHoldSupportDrills.test.ts` unchanged (byte-identical, diff-verified); their supporting suites that could execute tonight are green (battery below) and the carried legs themselves are CI-discharge per the execution note. Nothing in the cure touches the allocation rule, the payment writer, the money-routing resolver, the late-fee rule, or the PII shaping in `buyHoldTools.ts` — drill 4's fence pins pass against the same source they pinned in #757.

## Pre-publish gates (the #738 lesson — both checked on the composed tree BEFORE publishing)

**Execution note (the #757 situation, stated plainly):** tonight the VM's execution guard denied every test-runner read of this session's new/modified files (`EACCES` on `server/ai/supportAgent.ts`, `server/ai/paxSupportResolver.ts`, `shared/pax-controls.ts`, `shared/pax-capabilities.ts` and both drill files — forks and threads pools alike, while shell reads and earlier sessions' files stayed readable). Both gates are therefore discharged two ways: (a) their substance is verified below by applying each gate's own derivation to the composed tree by hand, and (b) their executable run is **CI-discharge**, named here and in the PR body — the same disposition #757 recorded for its new drill file. No gate result is claimed as locally executed that was not.

1. **Purpose-ledger census:** substance verified by the census's own predicates (`tests/unit/purposeLedgerCensus.test.ts`): a candidate requires a surface whose text matches `DIRECT_READ` (a read of `leads` / `skipTraces` / `parcelSnapshots`, a lead-shaped storage reader, an owner/mailing-address token, or raw SQL over those tables) or that calls a function the reader closure marks as a reader. On the composed tree: `server/ai/buyHoldTools.ts` contains **zero** `DIRECT_READ` matches (grep-verified), so none of `paxGetRentRoll` / `paxGetRentalLeases` / `paxGetLeaseLedger` / `paxGetRentalUnderwritingDecision` is a census reader; and the four new `executeSupportTool` case bodies contain no `.from(`, no `storage.` call, no `recordPurpose(`, and no owner/mailing token (read first-hand above the `escalate_to_human` case). No new candidate can arise, so **no DEBT entry is needed and none was added** — the founder-gated DEBT path does not arise for any variant. Executable confirmation: CI.
2. **Plain-words refusals:** substance verified by diff inspection: this cure introduces **no new refusal strings at all** — the four cases return the shared #737 helpers' existing plain-words refusals through `buyHoldOutcomeToResult` / `toolRefusal`, unreworded; the new user-facing text is tool descriptions and the resolver-prompt paragraph (guidance, not refusals). The drill file additionally pins that the bad-id refusal on the new ledger case carries no snake_case tool or parameter identifier. Executable confirmation: CI.

## Battery

**Executed locally, first-hand, this run (green):**

| Leg | Result |
|---|---|
| `tests/unit/customerMoneyRouting.test.ts` (drill 2's resolver population) | 34 passed |
| `tests/unit/rentCollection.test.ts` | 21 passed |
| `tests/unit/rentRollEmptyIsNotPaidInFull.test.tsx` (drill 5b's supporting leg) | 2 passed |
| TypeScript parse of `server/ai/supportAgent.ts` + `server/ai/paxSupportResolver.ts` (compiler API over shell-fed source) | 0 parse diagnostics each |
| Census derivation by hand (gate 1, above) | no new candidate; no DEBT entry |

**Named CI-discharge (guard-blocked locally, every failure an `EACCES` on this session's modified files — attribution read first-hand in the run logs, no code failure observed):** `buyHoldSupportDrills.test.ts` (drills 1/2/4/5 carried + drill 3 flipped + real-switch legs), `buyHoldSupportDrillsResolver.test.ts` (drill 3 resolver leg), `purposeLedgerCensus.test.ts`, `refusalsArePlainWords.test.ts`, `paxBuyHoldTools.test.ts` (imports the modified `shared/pax-controls.ts`), `paxCapabilityInventory.test.ts` (byte-currency of the regenerated inventory doc), `paxPauseSupportGate.test.ts`, `supportToolsHonorThePermissionLadder.test.ts`, `paxControlsOffered.test.ts`, `paxSupportResolver.test.ts`, `supportResolverCalibration.test.ts`, `rentLedgerLateFeeNoStacking.test.ts`, `moneyCustodyHardStop.test.ts` (5 of its 11 legs passed locally; the 6 repo-sweep legs failed only on `EACCES` reads of the modified files), the full `npm run check` chain, and the bundle build. The diff is server/test/shared/docs only — no client source — so the bundle is neutral by construction; CI's Build leg is the measurement of record, as in #757.

**Carried-file integrity:** `tests/unit/buyHoldSupportDrills.test.ts` in this PR is #757's file with ONLY the header, the vitest import line, and drill 3's block changed — drills 1/2/4/5 verified byte-identical to #757's by diff. #757's own evidence record is carried unrewritten; this addendum is the closing record.

**No staging or prod data touched. No sends of any kind — zero real mail, absolute.**
