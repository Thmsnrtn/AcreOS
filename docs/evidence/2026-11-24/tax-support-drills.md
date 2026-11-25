# Tax T9 — support drill set (five scenarios from the Tax gap sheet, bar item (e)) — LOCAL run

**Spec:** Tax T9, work item 9 of the Tax gap sheet (`tax_lien_deed`, bar item (e)): the support drill set, including the 1099-INT fence on redemption interest and the zero-real-mail posture.
**Run id:** `drill-tax-t9-local-2026-11-24`
**Run (ET):** 2026-11-24, ~18:45–19:05 ET (builder lane; local execution).
**Environment:** LOCAL ONLY — repo worktree at main head `1562c6dd6b379c9fcf9c647cdb54db38e2783715` (branch `tax-t9-support-drills`). **No staging or prod access was used and no staging/prod data was read or mutated.** No drill org exists for this run — no org was created anywhere.
**Step 0 (landed-work check):** no existing tax drill set or record exists — local grep at the base head finds only the Notes N9 set (#698), and unauthenticated GitHub search returns 0 PRs/issues for "tax drill" (the "support drill" hits are #698 and the open Notes cure #738). This set is therefore new work, not a duplicate.
**Messages sent during the drills:** ZERO by construction — no org, no ticket, no mail/SMS path was invoked; every leg is a pure function, the real notice gate, the real ledger projection, the real CSV validator, the real refusal middleware (mocked flag store), or a first-hand code read. The zero-real-mail constraint (Tom, 2026-11-18) is absolute in this set: the only notice leg exercised is the ledger's projection of a notice the rail recorded in TEST mode, which is the simulation surface itself.
**Simulation footnote (carried verbatim, as the bar requires):** simulation mode does not prove Lob accepting a real `letters.create`; the provider id in the walked leg is a `sim_…` record id, not an `ltr_…`. Nothing in this record claims a real notice was mailed.
**Correctness rules** were written in the lane record (`hidden_files/build-tax-drills-e-2026-11.md`) BEFORE each leg ran. A drill whose surface invents a deadline, an amount, or a send is a FAIL under these rules even if its other facts are right.

## Residual named up front (not buried)

- **Support clock UNRATIFIED (Tap #7 / R-10):** the ratified support clock the bar names does not yet exist. No live tickets were filed in this run, so no time-to-resolution was measured; the drills were judged against the correctness rules, not a clock. (Same residual as the N9 record.)

---

## Drill 1 — Money moment: redemption amount + notice on the support path — PASS (deterministic legs; live send leg not applicable by constraint)

- **Seeded state (synthetic, local):** the T1 walk's own GA certificate figures — purchase $6,000 (`600_000`¢), sale 2025-11-23, as-of 2026-11-23.
- **Ticket (as designed):** "what do I get back if they redeem, and can you send the redemption notice?"
- **Correctness rule:** the amount is the encoded-rule computation with its preliminary status stated; a notice may only be readied on recorded county notice requirements with a determinable amount; a simulated notice is never described as mailed; nothing is sent.
- **Observed (measured, this run):** `computeRedemptionAmount` (GA, tiered_yearly) returns principal `600_000`, interest `120_000`, total `720_000` — the walk's $6,000 + $1,200 exactly — with `preliminary: true` (every encoded rule carries `attorneyReviewedAt: null`). The notice gate (`assessTaxNoticeReadiness`) is **ready** with that amount (basis `computed_preliminary`, basis text stating "preliminary, not attorney-reviewed") and **refuses fail-closed** in both support-relevant cases: no recorded notice requirements → `notice_requirements_not_recorded` ("AcreOS will not improvise statutory notice language"); amount indeterminable (the WY computation's refusal fed in) with no county-supplied amount → `amount_not_determinable`. The ledger projection of a rail notice recorded with `testMode: true` and provider id `sim_T9DRILL` is `simulated: true` (the T-DEF-4 cure, also pinned in `taxLedger.test.ts`), and the ledger's interest line reads "$1,200.00 accrued on the certificate amount as of 2026-11-23 — preliminary; verify with the county." Pinned in the new `tests/unit/taxSupportDrills.test.ts` — **20 passed** (all drills). Supporting legs: `taxRedemptionNotice.test.ts` **11 passed**, `taxNoticeService.test.ts` **6 passed**, `certificateRedemptionNotice.test.tsx` **14 passed**, `taxLedger.test.ts` **8 passed**.
- **Verdict: PASS.** A correct support answer is producible from data at every step of the money moment, and the one send-shaped step is gated, sourced, and — in simulation — labelled simulated on the record the customer sees. No send was attempted or simulated beyond the projection leg.

## Drill 2 — Stuck moment: no encoded rule for a state (the WY pattern) — PASS

- **Seeded state (synthetic, local):** a WY certificate — WY is not one of the ten states whose redemption math is encoded (`STATE_REDEMPTION_RULES` = AL, AZ, FL, GA, IA, MS, NC, SC, TN, TX; pinned as the drill's premise).
- **Ticket (as designed):** "when does my Wyoming certificate expire, and what's the redemption amount?"
- **Correctness rule:** no deadline and no amount may be stated; the refusal must name the reason and point at the county / the operator-entered path.
- **Observed (measured, this run):** `computeRedemptionDeadline({state: "WY", …})` returns **null**; `computeRedemptionAmount({state: "WY", …})` returns `modelUsed: "no_rule"` with `interestCents: null`, `totalRedemptionCents: null`, `appliedRateBps: null` and `refusalReason: "AcreOS has no encoded redemption rule for WY, so it does not compute an amount. Get the redemption amount from the county."` First-hand code read at this head: the certificate-create route speaks the same refusal in words and offers exactly one alternative — the operator enters the deadline from the county's records, with its source (`server/routes-tax-certificates.ts`, the three-situations block after the deadline computation). This matches the T1 walk's case (b) observation on the walked build.
- **Verdict: PASS.** The product refuses/banners instead of inventing a deadline, on both the amount and deadline surfaces a support answer would quote.

## Drill 3 — Data-wrong — PASS (both legs)

### 3a — The clock mismatch flag (GA Fulton pattern)

- **Seeded state (synthetic, local):** a GA redeemable deed, sale 2026-04-01, deadline on record 2027-04-01 (the encoded 12-month rule), with a recorded county procedure stating a 6-month redemption period.
- **Correctness rule:** the mismatch is flagged with both figures visible; the deadline on record is NOT silently changed to either figure.
- **Observed (measured, this run):** `redemptionClock` returns `procedureCheck: { agrees: false, statedMonths: 6, impliedDeadlineFromSale: "2026-10-01", … }` and `deadline` remains `"2027-04-01"`. Pinned in `taxSupportDrills.test.ts`; the agreeing case and the same flag are also pinned in `taxRedemptionClock.test.ts` (**5 passed**).
- **Verdict: PASS.**

### 3b — A wrong county CSV import

- **Seeded state (synthetic, local):** a 3-row Fulton County CSV (`T9-1` good; `T9-2` with sale date `2026-02-30`, a non-calendar date; `T9-1` again, a duplicate parcel).
- **Correctness rule:** every bad row is refused with the field, the column it was read from, the offending value and the reason; the good row is untouched; no row is lost or silently skipped.
- **Observed (measured, this run):** through the real `parseDelimited` → `suggestColumnMapping` → `validateLotRows`: summary `{totalRows: 3, validCount: 1, rejectedCount: 2}`; `assertNoRowLost` holds; the good row validates as `{apn: "T9-1", county: "Fulton", state: "GA"}`; the bad-date rejection is `{field: "saleDate", column: "sale date", value: "2026-02-30", message: "\"2026-02-30\" is not a real calendar date."}`; the duplicate is refused as a duplicate ("already on this worksheet / also appears on row …"), not skipped. Pinned in `taxSupportDrills.test.ts`; supporting leg `taxSaleCsvImportDedup.test.ts` **9 passed**, `taxListGolden.test.ts` **4 passed**.
- **Verdict: PASS.** A support answer can name the refusing row and reason from the validation response — it never has to claim "I fixed it".

## Drill 4 — "Pax told me X" on the support path — UNPROVEN (live leg not run); capability defect filed (T9-DEF-1)

- **Seeded state (as designed, not seeded):** a tax org with certificates; ticket quotes a prior Pax chat answer about a certificate's clock/ledger and asks support to check it.
- **Correctness rule:** correct = the support-path answer is grounded in the certificate, clock or ledger reads (with their coverage / notice-simulation statements), OR an escalation. FAIL = a confident resolution the resolver could not have grounded.
- **What was run locally:** the resolver's gate battery — `paxSupportResolver.test.ts` **3 passed**, `supportResolverCalibration.test.ts` **5 passed** — plus the capability pin in `taxSupportDrills.test.ts`: the five T7 tax tools (`get_tax_certificates`, `get_tax_certificate`, `get_tax_certificate_clock`, `get_tax_certificate_ledger`, `record_tax_ledger_entry`) ARE registered on the chat path (`server/ai/tools.ts`; the family itself is proven by `paxTaxCertificateTools.test.ts`, **17 passed**, PR #694), but `RESOLVER_TOOL_NAMES` (`server/ai/paxSupportResolver.ts:98–112`) contains **none** of them — the support resolver's subset is the same 13 generic tools the N9 record read. On the support path, Pax therefore cannot read a certificate, its clock, or its ledger at all; the only correct outcomes available to it are an honest partial answer from generic account data or a low-confidence escalation.
- **Verdict: UNPROVEN.** The live ticket leg (file → resolver → reply text judged against the rule → receipts) was not run — no staging access in this lane. Filed as **T9-DEF-1** below: exactly the N9-DEF-1 shape, one vertical over. This leg is NOT marked PASS.

## Drill 5 — The fence: 1099-INT (DEFECT-0101) on redemption interest — PASS (correct refusal; no leak path)

- **Question (from the gap sheet):** redemption interest is income on the certificate (the T1 walk's amount was $6,000 + $1,200 interest). Does the DEFECT-0101 fence refuse correctly for that income line? UNVERIFIED before this drill.
- **Seeded state:** none (local). The gate is `requireQualified1099Output()` (`server/services/form1099Refusal.ts`), mounted on every 1099-INT entry point (pinned by source scan in `bookkeeping1099.test.ts`).
- **Correctness rule:** no customer path may produce a 1099-INT artifact for the redemption-interest line; the gate refuses with the structured 422 naming DEFECT-0101 and fails CLOSED when the flag store errors; and redemption interest must have no path into the generator at all.
- **Observed (measured, this run):** (1) **No leak path** — a first-hand read of `generateAnnualInterestReport` (`server/services/bookkeeping.ts`) shows it reads note payments only (`payments ⨝ notes`, grouped per note, `requires1099` at ≥ $600 of NOTE interest); the drill pins, on the comment-stripped source, that bookkeeping names no `taxCertificates`, no `computeRedemptionAmount` and no `redemptionClock` — tax-certificate redemption interest never enters the report the generator renders. (2) **The fence refuses** — with the flag store mocked off (the `bookkeeping1099.test.ts` pattern), a customer request through `requireQualified1099Output()` is refused **422** `{error: "not_qualified_filing_output", details: {defect: "DEFECT-0101"}}` and `next` is never called; with the flag store throwing, the refusal is still 422 (fail closed; the run's log shows the gate's own "flag read failed — refusing (fail closed)" warning). Pinned in `taxSupportDrills.test.ts`. Supporting legs: `bookkeeping1099.test.ts` **20 passed**, `nec1099QualifiedOutputGate.test.ts` **18 passed** (the NEC gate is separate and does not open INT).
- **Verdict: PASS — correct refusal.** The redemption-interest line is covered twice over: it has no route into the generator, and the generator's every door is fenced. Founder / direction-reviewed-flag pass-through is by design, as in the N9 record.

---

## Defects filed by this drill set (filed, never fixed in this lane)

**T9-DEF-1 (Capability, Medium) — the Pax support resolver has no tax read: drill 4 cannot be grounded on the support path.**
- Step: file a support ticket about a tax certificate (its redemption clock, its ledger, a prior Pax tax answer) on a `tax_lien_deed` org.
- Expected: the resolver can read the certificate / clock / ledger (with the coverage and notice-simulation statements the T7 tools carry), or is structurally routed to escalate tax-certificate questions.
- Observed (code, first-hand at `1562c6dd`): `RESOLVER_TOOL_NAMES` in `server/ai/paxSupportResolver.ts:98–112` contains no tax tool of any kind; the chat path's five T7 tools (coverage-stated, simulation-stated, proven in `paxTaxCertificateTools.test.ts` and the T7 walk) are not in the support resolver's subset.
- Consequence: for this scenario class the resolver's only correct move is a low-confidence escalation, and nothing structural guarantees it — a confident generic answer would be a drill FAIL. The drill's live leg stays UNPROVEN until either (a) the tax reads are registered for the resolver (the #738 cure for notes is the working pattern), or (b) a live staging run shows the resolver escalating correctly.
- Severity Medium: a proof/capability gap on the support path, not a demonstrated mis-resolution (no live reply was observed). Same shape and severity as N9-DEF-1.

## Battery (all legs run solo, first-hand, this run)

| Leg | Result |
|---|---|
| `tests/unit/taxSupportDrills.test.ts` (NEW — drills 1, 2, 3, 5 + drill-4 capability pin) | 20 passed |
| `tests/unit/taxRedemptionClock.test.ts` (drill 3a) | 5 passed |
| `tests/unit/redemptionDeadlines.test.ts` (drill 2) | 16 passed |
| `tests/unit/taxLedger.test.ts` (drill 1, T-DEF-4 projection) | 8 passed |
| `tests/unit/taxRedemptionNotice.test.ts` (drill 1 gate) | 11 passed |
| `tests/unit/taxNoticeService.test.ts` (drill 1) | 6 passed |
| `tests/unit/certificateRedemptionNotice.test.tsx` (drill 1) | 14 passed |
| `tests/unit/taxSaleCsvImportDedup.test.ts` (drill 3b) | 9 passed |
| `tests/unit/taxListGolden.test.ts` (drill 3b) | 4 passed |
| `tests/unit/paxTaxCertificateTools.test.ts` (drill 4, chat path) | 17 passed |
| `tests/unit/paxSupportResolver.test.ts` (drill 4 gate) | 3 passed |
| `tests/unit/supportResolverCalibration.test.ts` (drill 4) | 5 passed |
| `tests/unit/bookkeeping1099.test.ts` (drill 5) | 20 passed |
| `tests/unit/nec1099QualifiedOutputGate.test.ts` (drill 5) | 18 passed |

Full `npm run check` chain: run by this lane. The chain died on its FIRST leg — `check:app` (`tsc --noEmit`, NODE_OPTIONS=--max-old-space-size=8192) was OOM-killed (exit 137) on this 6 GB VM — so the two full-tree tsc legs (`check:app`, `check:tests`) are **named here as not discharged locally; CI discharges them**. Attribution for the new file was done the N9 way: a scoped tsc (temp config extending `tsconfig.tests.json`, include = `taxSupportDrills.test.ts` only, 5120 MB heap) reports **zero diagnostics in the new file**; the only 4 errors in its import graph (`form1099Refusal.ts` ×2, `logger.ts` ×2, express `Request.user` augmentation) reproduce identically when the same scoped run is pointed at the pre-existing `bookkeeping1099.test.ts`, i.e. they are scoped-graph artifacts, not introduced here. (The scoped run also caught and this lane fixed one real fixture error before publish: a `verification` literal corrected to `confirmed_with_county`; the drill battery re-ran green, 20 passed.) All **34 lint legs** of the chain were then run individually, first-hand: **every leg rc=0** (schema, schema-migrate-mirror, schema-journal-sync, ledger-refs, no-fabrication, ghost-fields, measurement-defaults, boundaries, kernel-boundary, ratchets, reachability, model-prefix, prompt-envelope, contract-adoption, org-fetch, css-hover, page-hex, dead-token-alpha, semantic-contrast, unchecked-mutation, empty-update-set, status-vocabulary, prefetch-authority, date-format, zindex, translucency, eslint-ratchet, browser-safe-shared, route-order, route-shadowing, infrastructure-restraint, residential-comps-hold, inline-provenance, clock-reads).

**Environment note (honesty, local only):** this VM intermittently denied node/python process execution and node reads of shell-derived copies of the new test file (EACCES) for ~15 minutes during this run; a fresh file-tool write of identical content ran clean on the first attempt. This is a local environment quirk, not a repo property; it affected no result above (every leg's result was read from a completed run).

## Files in this commit

- `docs/evidence/2026-11-24/tax-support-drills.md` — this record.
- `tests/unit/taxSupportDrills.test.ts` — the deterministic drill pins for drills 1, 2, 3 and 5, plus drill 4's capability pin (drill 4's live leg is LLM-path and stays record-only until it runs).

**No product code changes. No staging or prod data touched. No sends of any kind — zero real mail, absolute.**
