# Tax T9 — T9-DEF-1 cure and drill 4 re-run (addendum to tax-support-drills.md) — LOCAL run

**Spec:** cure **T9-DEF-1** (filed in `docs/evidence/2026-11-24/tax-support-drills.md`, PR #740) and complete Tax drill 4 — `tax_lien_deed` promised bar item (e). The cure mirrors the N9-DEF-1 cure (PR #738) exactly in shape.
**Run id:** `drill-tax-t9-def1-cure-local-2026-11-24`
**Run (ET):** 2026-11-24, evening ET (builder lane; local execution).
**Environment:** LOCAL ONLY — repo worktree at main head `1562c6dd6b379c9fcf9c647cdb54db38e2783715`. **No staging or prod access was used and no staging/prod data was read or mutated.** No drill org exists for this run — no org was created anywhere.
**Step 0 (landed-work check):** at the base head, `RESOLVER_TOOL_NAMES` (`server/ai/paxSupportResolver.ts`) is the same 13 generic tools the #740 record read, and `server/ai/supportAgent.ts` has no tax dispatch case; unauthenticated GitHub search for "T9-DEF-1" returns only PR #740 itself (open, the drill record). No cure was landed or in flight — this PR is the cure, not a duplicate.
**Messages sent during the drills:** ZERO by construction — every leg is a pure function, the real support switch with mocked data sources, or the real resolver gate with a mocked model. Zero real mail, absolute, as in #740.
**Simulation footnote (carried verbatim, as the bar requires):** simulation mode does not prove Lob accepting a real `letters.create`; the provider id in the walked leg is a `sim_…` record id, not an `ltr_…`. Nothing in this record claims a real notice was mailed.
**Residual carried from #740 (unchanged):** the support clock is UNRATIFIED (Tap #7 / R-10); no live tickets were filed, so no time-to-resolution was measured. The live-LLM staging observation of drill 4 remains the named residual — this run is the local form, exactly as #738 closed N9's drills 1/3 in local form.

---

## The cure

**Registry constraint (why support-only names):** the Pax registries key one dispatch per tool name (`TOOL_REGISTRY` in `shared/pax-controls.ts`, `CAPABILITY_ROWS` in `shared/pax-capabilities.ts`), and the five T7 tax names already dispatch through the chat executor (`executeTool`). The support switch therefore cannot reuse them — the same constraint the N9 record documents for `get_notes`. The cure adds support-only variants of the four T7 **reads**, each dispatching through `executeSupportTool` to the SAME shared helpers the chat path uses (`server/ai/taxCertificateTools.ts`: `paxGetTaxCertificates`, `paxGetTaxCertificate`, `paxGetTaxCertificateClock`, `paxGetTaxCertificateLedger`, converted by `taxOutcomeToResult`), so coverage statements, the clock's basis discipline, and the ledger's notice-simulation statement are identical on both paths by construction, not by copy.

| Support name (new) | Shared read | Chat name (unchanged) |
|---|---|---|
| `get_tax_certificates_book` | `paxGetTaxCertificates` | `get_tax_certificates` |
| `get_tax_certificate_record` | `paxGetTaxCertificate` | `get_tax_certificate` |
| `get_tax_certificate_clock_view` | `paxGetTaxCertificateClock` | `get_tax_certificate_clock` |
| `get_tax_certificate_ledger_view` | `paxGetTaxCertificateLedger` | `get_tax_certificate_ledger` |

**Read-only only.** The fifth T7 tool, `record_tax_ledger_entry`, is a write and has **no** support variant: it is not defined in `supportToolDefinitions`, not in `PAUSE_SAFE_SUPPORT_TOOLS`, not in the resolver subset, and not in the support registry rows (pinned in the drill file). Receipts discipline is unchanged (the reads carry `receipt: "none"`, like the notes reads). **FD5 untouched:** no notice send exists on either path here — a send stays ask-before-sending on the certificate's notice screen and is not part of this cure.

**Registration (every place the pattern registers a support tool):**
- `server/ai/supportAgent.ts` — four tool definitions, four `executeSupportTool` cases, four entries in `PAUSE_SAFE_SUPPORT_TOOLS` (all four are pure reads, so a paused org can still be told the truth about its certificates).
- `server/ai/paxSupportResolver.ts` — `RESOLVER_TOOL_NAMES` subset, and a resolver-prompt paragraph directing tax-certificate tickets to the reads (state the coverage; state the clock's basis; a simulated notice was NOT mailed; never promise to record or send).
- `shared/pax-controls.ts` — the four names in the `executeSupportTool` `looks_and_drafts` list.
- `shared/pax-capabilities.ts` — four capability rows (`dispatch: executeSupportTool`, `group: looks_and_drafts`, `family: tax_lien_deed`, `pauseSafe: true`, `receipt: "none"`, coverage `single_slice` with the T7 `notCovered` text).
- `docs/compliance/pax-capability-inventory.md` — regenerated (151 rows).

**Resolver subset, before → after:** before = the 13 generic tools #740 read (`search_knowledge_base`, `search_resolved_tickets`, `get_similar_resolutions`, `get_troubleshooting_steps`, `diagnose_account`, `check_data_integrity`, `get_account_summary`, `query_user_data`, `get_user_activity`, `estimate_resolution_confidence`, `recall_user_memory`, `draft_customer_response`, `escalate_to_human`). After = those 13 **+ exactly the four support tax reads** above, inserted after `get_account_summary`. Nothing else entered or left the subset (pinned by equality in the drill file).

## Drill 4 — "Pax told me X" on the support path — PASS (local form; live-LLM staging leg remains the named residual)

- **Seeded state (synthetic, local):** the drills' own GA Fulton certificate — purchase $6,000 (`600_000`¢), sale 2025-11-23, deadline 2026-11-23 — with one rail notice recorded in test mode (provider id `sim_T9DRILL`). The ticket quotes a prior Pax chat answer claiming the notice "was mailed" and giving the deadline without its basis, and asks support to check it.
- **Correctness rule (from #740, unchanged):** correct = the support-path answer is grounded in the certificate, clock or ledger reads (with their coverage / notice-simulation statements), OR an escalation. FAIL = a confident resolution the resolver could not have grounded.
- **Observed (measured, this run):**
  - **Capability pin, flipped:** `tests/unit/taxSupportDrills.test.ts` now pins the subset at prior-13 + exactly the four reads (equality, in order), pins that no chat tax name and no `record_…` name is in the subset, pins every subset name resolving to a real support definition, pins the four reads' registration (definition, pause-safe, `looks_and_drafts`, capability row), and pins the absence of any support ledger-write variant.
  - **Real-switch legs:** through the REAL `executeSupportTool` switch (only `db` and the clock/ledger service seams mocked, the `paxTaxCertificateTools.test.ts` pattern, clock pinned to 2026-11-23): the book read lists the GA certificate with `currentRedemptionAmountCents: 720_000` / `currentInterestCents: 120_000` / `preliminary: true` — drill 1's walk figures — under the verbatim coverage statement, with org 77 decoded in the query's WHERE; the record read returns the one certificate; the clock read returns the shared clock service's view under the "never improvise a date" coverage; the ledger read's `noticeSimulation.statement` reads "1 notice was SIMULATED — recorded in test mode, NOT mailed" with the `sim_T9DRILL` marker carried; a non-id is refused in plain words (no tool-name or parameter identifier in the refusal) and an unknown id is refused — nothing invented.
  - **Resolver leg:** `tests/unit/taxSupportDrillsResolver.test.ts` drives the REAL resolver gate (mocked model, mocked db, #738's form): the model reads `get_tax_certificates_book` → `get_tax_certificate_clock_view` → `get_tax_certificate_ledger_view`, then drafts the correction — deadline stated with its preliminary basis, the earlier "mailed" claim corrected to simulated/NOT mailed, no send promised — at high confidence, and the gate auto-resolves (1 reply inserted, no escalation). Auto-resolve is CORRECT here precisely because the reply is grounded in the reads, which was structurally impossible before the cure.
- **Verdict: PASS** in the local form. **T9-DEF-1 is CLOSED by this PR.** The live-LLM staging observation stays a named residual (no staging access in this lane), as it was for the N9 cure.

## Drills 1, 2, 3, 5 — no regression

#740's deterministic legs for drills 1, 2, 3 and 5 are carried into this PR's `taxSupportDrills.test.ts` unchanged and re-run green, alongside their supporting suites (battery below). Nothing in the cure touches the redemption math, the notice gate, the clock, the CSV validator, or the DEFECT-0101 fence.

## Pre-publish gates (the #738 lesson — both run on the composed tree BEFORE publishing)

1. **Purpose-ledger census:** `tests/unit/purposeLedgerCensus.test.ts` — **15 passed, clean.** No new support-dispatch case appears as an UNLEDGERED candidate (the four reads touch tax-certificate rows, not the census's person-adjacent population, and no register entry was needed). No census DEBT entry was added; no founder-gated decision is required from this PR.
2. **Plain-words refusals:** `tests/unit/refusalsArePlainWords.test.ts` — **60 passed.** The only refusal/help text this cure's path can newly surface is the shared T7 helpers' existing plain-words refusals (reused, not reworded); the drill file additionally pins that the bad-id refusal on the new support case carries no snake_case tool or parameter identifier.

## Battery (all legs run solo, first-hand, this run)

| Leg | Result |
|---|---|
| `tests/unit/taxSupportDrills.test.ts` (drills 1, 2, 3, 5 carried from #740 + drill-4 pin flipped + real-switch legs) | 29 passed |
| `tests/unit/taxSupportDrillsResolver.test.ts` (NEW — drill 4 resolver leg) | 1 passed |
| `tests/unit/paxTaxCertificateTools.test.ts` (T7 family, chat path) | 17 passed |
| `tests/unit/paxSupportResolver.test.ts` (resolver gate) | 3 passed |
| `tests/unit/supportResolverCalibration.test.ts` | 5 passed |
| `tests/unit/purposeLedgerCensus.test.ts` (GATE 1) | 15 passed |
| `tests/unit/refusalsArePlainWords.test.ts` (GATE 2) | 60 passed |
| Full #740 drill-set regression (taxSupportDrills + resolver + clock/deadlines/ledger/notice/csv/1099 suites + paxPauseSupportGate) | 13 files, 147 passed |

Full `npm run check` chain: run by this lane. `check:app` (full app tsc) **PASSED**. The chain then died on `check:tests` — its tsc was OOM-killed (exit 137) on this 6 GB VM — so `check:tests` is **named here as not discharged locally; CI discharges it** (the same outcome #740 recorded). Attribution for the new files was done the #740 way: a scoped tsc (temp config extending `tsconfig.tests.json`, include = the two new drill test files only, 5120 MB heap) reports **zero diagnostics in either new file and zero in every file this PR touches**; the 109 errors in its import graph are all the known scoped-graph artifact (express `Request` augmentation absent from the scoped project) in pre-existing files (`routes-ai.ts`, `permissions.ts`, `logger.ts`, …) — the same artifact class #740's control run reproduced against the pre-existing `bookkeeping1099.test.ts`. All **34 lint legs** of the chain were then run individually, first-hand: **every leg rc=0** (schema, schema-migrate-mirror, schema-journal-sync, ledger-refs, no-fabrication, ghost-fields, measurement-defaults, boundaries, kernel-boundary, ratchets, reachability, model-prefix, prompt-envelope, contract-adoption, org-fetch, css-hover, page-hex, dead-token-alpha, semantic-contrast, unchecked-mutation, empty-update-set, status-vocabulary, prefetch-authority, date-format, zindex, translucency, eslint-ratchet, browser-safe-shared, route-order, route-shadowing, infrastructure-restraint, residential-comps-hold, inline-provenance, clock-reads).

## Files in this PR

- `server/ai/supportAgent.ts` — four support tool definitions, four dispatch cases, PAUSE_SAFE additions.
- `server/ai/paxSupportResolver.ts` — subset + prompt paragraph.
- `shared/pax-controls.ts`, `shared/pax-capabilities.ts` — registration rows; `docs/compliance/pax-capability-inventory.md` regenerated.
- `tests/unit/taxSupportDrills.test.ts` — #740's drill file carried forward with drill 4's pin flipped and the real-switch legs added. (PR #740 is still open and unmerged; this PR supersedes its drill-4 pin per the record's own instruction — "close T9-DEF-1 and re-drill". #740's record file itself is not rewritten; this addendum is the closing record.)
- `tests/unit/taxSupportDrillsResolver.test.ts` — drill 4's resolver leg.
- `docs/evidence/2026-11-24/tax-support-drills-t9-def1-cure.md` — this record.

**No staging or prod data touched. No sends of any kind — zero real mail, absolute.**
