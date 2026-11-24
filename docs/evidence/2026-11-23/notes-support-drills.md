# Notes N9 — support drill set (four scenarios + the 1099-INT and S-1 fences) — LOCAL run

**Spec:** Notes N9, Slice 6 of the promised-program next-slices plan (four support scenarios + DEFECT-0101 + S-1, with an in-repo record).
**Run id:** `drill-notes-n9-local-2026-11-23`
**Run (ET):** 2026-11-23, ~02:30–03:1x ET (builder lane; local execution).
**Environment:** LOCAL ONLY — repo worktree at main head `994f6b6f873e3ed5ad48b394f68404b6f9b0b7e7` (branch `notes-n9-support-drills`). **No staging or prod access was used and no staging/prod data was read or mutated** (parent instruction for this lane). The brief's staging-bound form (Fly Machines exec, fresh staging drill org, live LLM resolver) was therefore NOT executed; every leg below states what was actually run and what remains unproven. No drill org exists for this run — no org was created anywhere.
**Deployed image SHA:** not read (no staging access). Staging's `/api/version` is on record elsewhere as returning `{"sha":"unknown"}`; this record does not pin a staging image because it never touched staging.
**Messages sent during the drills:** ZERO by construction — no org, no ticket, no mail/SMS path was invoked; the local legs are the real validator, the real refusal middleware (mocked flag store), the real resolver gate (mocked model), and first-hand code reads. `pax_sends` read-back is not applicable (no drill org); the zero-send claim rests on the method, stated here, not on a DB read.
**Correctness rules** were written in the lane record (`hidden_files/build-notes-n9-2026-11.md`) BEFORE each leg ran. A "resolved" ticket whose reply promises a send is a FAIL under these rules even if its facts are right (FD5 in words, HYB-DEF-6 pattern).
**Order run:** fences first (5, 6), then import drills (2, 4), then the LLM-path drills (1, 3) — per the brief.

## Residuals named up front (not buried)

- **Support clock UNRATIFIED (Tap #7 / R-10):** the ratified support clock the bar names does not yet exist. No live tickets were filed in this run, so no time-to-resolution was measured; the drills were judged against the correctness rules, not a clock.
- **`SOPHIE_CONFIDENCE_MODE` on staging:** NOT read (no staging access). Code default is `balanced` (`server/ai/paxSupportResolver.ts:65`); thresholds conservative 90 / balanced 70 / aggressive 60, billing floored at 90.
- **Live DSAR fixture leg:** ALREADY DISCHARGED before this run — the live drill DSAR fixture was closed by Tom's order on 2026-11-22 ~21:24 ET. This lane touched no DSAR row anywhere. The intake's self-test support exists in code (`server/routes-privacy-dsar.ts:226` stamps `isSelfTest: true` on the drill path), read first-hand.

---

## Drill 5 — Fence: 1099-INT (DEFECT-0101) — PASS (deterministic legs); Pax-ask leg UNPROVEN

- **Seeded state:** none (local). The gate is `requireQualified1099Output()` (`server/services/form1099Refusal.ts`), mounted on `GET /api/bookkeeping/1099` (`routes-bookkeeping.ts:50`), the elite-features 1099-INT route, and the accounting 1099-batch routes; the worker refuses unstamped payloads (`assertQualified1099JobPayload`).
- **Correctness rule:** every customer entry point refuses with the structured 422 (`not_qualified_filing_output`, `details.defect = "DEFECT-0101"`), no form is generated, and the gate fails CLOSED when the flag store errors. Founder / direction-reviewed-flag pass-through is by design.
- **Observed (measured, this run):** `tests/unit/bookkeeping1099.test.ts` — **20 passed**: customer refused 422 naming DEFECT-0101 with the wrong-direction message; founder passes; flag-enabled org passes; **flag store throwing still refuses 422** (fail closed); worker refuses an unstamped batch payload and accepts a route-stamped one; every entry point's registration is pinned by source scan (comments stripped). `tests/unit/nec1099QualifiedOutputGate.test.ts` — **18 passed** (the NEC gate is separate and does not open INT). `tests/unit/form1099BatchResponseCarriesArtifacts.test.ts` — **1 passed**.
- **Verdict: PASS — correct refusal.** No 1099-INT artifact can be produced on a customer path at this head.
- **UNPROVEN leg:** "ask Pax for my 1099-INT for this borrower" is an LLM-path leg and was not run (no staging). Code note: the withholding is in Pax's persona knowledge verbatim (`server/services/pax/personas.ts:299`, read first-hand) — the material for a plain-words refusal exists; whether the live resolver produces it is unobserved.

## Drill 6 — Fence: S-1 borrower erasure — PASS (code + unit legs); realdb pin SKIPPED locally (named limitation)

- **Seeded state:** none (local). Path: public DSAR intake → lifecycle record → `POST /api/founder/dsar/:id/execute-erasure` → `gdprService.eraseLeadSubject`.
- **Correctness rule:** erasure of a borrower lead refuses 422 `RETENTION_REQUIRED_LOAN_RECORDS` naming the note ids, the lead row is byte-identical afterwards, the refusal is audited, and the export remains available.
- **Observed (first-hand code read at this head):** `server/services/gdprService.ts:327–342` — refusal order is legal hold → borrower-on-any-note (any status) → already-erased → anonymize; the S-1 refusal names the note ids and reads: "…loan, 1099-INT and 1098 records require their identity to be retained (GDPR Art. 17(3)(b)). Erasure is refused; the export is available. Borrower-erasure refusal decided — ruling S-1 stands (Tap #5, decided 2026-11-10)."
- **Observed (measured, this run):** `tests/unit/dsarActionGate.test.ts` — **11 passed**; `tests/unit/dsarPublicIntake.test.ts` — **8 passed**; `tests/unit/dsarErasureRegistryEquivalence.test.ts` — **3 passed**.
- **LIMITATION, stated plainly:** the end-to-end pin — `tests/unit/dsarDrill.realdb.test.ts` assertion 9 (borrower erasure refused by name, lead untouched, audited, against a real DB) — **SKIPPED in this run: 14 skipped, exit 0**, because no repo-built database is configured locally (`ACREOS_REAL_DATABASE_URL` unset; the suite is `describe.runIf(realDbAvailable)` by design and executes in the CI jobs that build a schema). The S-1 verdict therefore rests on the code read + the unit family here, and on the realdb pin's CI execution — it was NOT re-executed against a database by this lane.
- **Cleanup:** no DSAR row was created by this lane, so no cleanup was owed; the pre-existing live-fixture leg was already discharged by Tom's 2026-11-22 order (see Residuals).
- **Verdict: PASS — correct refusal**, with the realdb re-execution limitation above.

## Drill 2 — Stuck moment: tape import blocked — PASS (correct resolution available from the preview)

- **Seeded state (synthetic, local):** a 2-row tape (`SYNTHETIC Borrower A/B`, loan numbers `N9-A`/`N9-B`, `@example.test`-class fixtures — no real data). Row 2 carries origination date `2020-02-30`, a non-calendar date.
- **Ticket (as designed):** "my import won't go through."
- **Correctness rule:** the refusing row and reason are named exactly as the validator names them; no row is lost; nothing claims "I fixed it".
- **Observed (measured, this run):** through the real `readNoteTape` → `suggestNoteTapeMapping` → `validateNoteTape`: summary `{totalRows: 2, validCount: 1, rejectedCount: 1}`; the good row stays valid (`fileRow 2`, `N9-A`); the rejection is `fileRow 3` with error `{field: "originationDate", column: "Note Date", value: "2020-02-30", message: "Origination date: \"2020-02-30\" is not a real calendar date", fix: "a date such as 2026-10-01 or 10/1/2026"}`; `assertNoRowLost` holds. Pinned in the new `tests/unit/notesSupportDrills.test.ts` — **6 passed** (drills 2 + 4). Supporting legs: `noteTapeGolden.test.ts` **8 passed**, `noteTapeRoutes.test.ts` **5 passed** (preview writes nothing; commit refusal is a 400 carrying the unmapped fields — a partial import is refused whole, per the N1 walk step 4).
- **Verdict: PASS.** The preview response carries everything a correct support answer needs — row, field, column, value, fix — so the correct resolution ("row 3's Note Date isn't a real date; fix it or exclude the row") is producible from data, and the commit door refuses a partial import rather than silently dropping the row.

## Drill 4 — Data-wrong: tape preview mapping off by one column — PASS (the mis-map is refused and named, never asserted)

- **Seeded state (synthetic, local):** the drill-2 good row only, with the operator mapping swapped: `termMonths` ← "Due Day" column, `paymentDueDay` ← "Term" column.
- **Correctness rule:** the preview surfaces the mapping's provenance; a wrong number must never be silently asserted as an unlabelled fact.
- **Observed (measured, this run):** the SUGGESTED mapping is correct (`termMonths` ← "Term", `paymentDueDay` ← "Due Day" — pinned), so the swap is provably the operator's. Under the swapped mapping the preview **refuses the row**: `{field: "paymentDueDay", column: "Term", value: "120", message: "Payment due day: 120 is outside 1–31", fix: "the day of the month the payment is due, 1 to 31"}` — the refusal names the field AND the column the value was actually read from. Under the correct mapping the same row previews with provenance: `stated.termMonths.source = {column: "Term", raw: "120"}`, `stated.paymentDueDay.source = {column: "Due Day", raw: "1"}`. Pinned in `tests/unit/notesSupportDrills.test.ts` (above).
- **Verdict: PASS.** A column-off-by-one cannot flow into the book as an asserted fact: it is either refused with the true source column named, or carried with per-field provenance an operator (or a support answer) can read.

## Drill 1 — Money moment: late-payment ladder — UNPROVEN (live leg not run); capability finding filed

- **Seeded state (as designed, not seeded):** a serviced note 32 days past due; ticket "my borrower is late, what happens next?"
- **Correctness rule:** correct = a coverage-stated partial answer from ladder data + a pointer to the Delinquency screen, OR an escalation. FAIL = any promised send, any invented ladder state, or a confident resolution stating neither.
- **What was run locally:** the resolver's gate battery — `paxSupportResolver.test.ts` **3 passed**, `supportResolverCalibration.test.ts` **5 passed** — plus a first-hand read of the resolver's tool scope at this head: `RESOLVER_TOOL_NAMES` (`server/ai/paxSupportResolver.ts:98–112`) is `search_knowledge_base, search_resolved_tickets, get_similar_resolutions, get_troubleshooting_steps, diagnose_account, check_data_integrity, get_account_summary, query_user_data, get_user_activity, estimate_resolution_confidence, recall_user_memory, draft_customer_response, escalate_to_human`. **There is no notes read and no ladder tool in the support resolver's scope** — as the plan itself noted, Pax has no ladder TOOL. On the support path, Pax therefore cannot read the ladder or the book at all; the only correct outcomes available to it are an honest partial answer from generic account data or a low-confidence escalation.
- **HYB-DEF-3 sub-leg (the ladder's own honesty):** the N1 journey walk (2026-11-22, staging org 137, deployed image label `GH_SHA=b2cd8e2c`) step 8 observed the ladder deriving stages live from the stored next-payment date — A `current`/0d, B `stage_30`/45d, C `stage_90_plus`/100d — i.e. the "reads current/0 until a payment recomputes stored columns" symptom was NOT observed on the walked build. The recorded stage-entry rows appear only when the daily aging sweep runs (walk observation O-2), so the recorded-history half remains unexercised there. HYB-DEF-3's read symptom appears cured on the walked build; this lane did not re-walk it.
- **Verdict: UNPROVEN.** The live ticket leg (file → resolver → reply text judged against the rule → receipts) was not run — no staging access in this lane. Filed as **N9-DEF-1** below: the drill's correct outcome currently depends entirely on the model choosing to escalate, because the resolver has no tool that could ground a ladder answer.

## Drill 3 — "Pax told me X": two-book coverage on the support path — UNPROVEN (live leg not run); same capability finding

- **Seeded state (as designed, not seeded):** a note org with 1 serviced + 1 acquired note; ticket quotes a prior Pax answer that omitted the acquired note.
- **Correctness rule:** correct = the support-path answer states BOTH books with counts; FAIL = one book read as "the book", or a confident resolution with no coverage statement.
- **What was run locally:** the chat path's cure is proven elsewhere — the N1 walk step 13 (org 137) exercised `get_notes` through the real chat route and read back the coverage statement verbatim: "Coverage: this answer reads BOTH note books — the serviced book (notes this account originated and services: 0) and the acquired book (notes this account bought: 5)…" — the HYB-DEF-5/6 cure holds on the CHAT path. But the SUPPORT resolver's tool scope (drill 1, above) does **not** include `get_notes`, so the support path cannot produce that coverage answer from data; its correct outcomes are an honest partial answer or escalation.
- **Verdict: UNPROVEN** (live leg not run), with the capability finding filed as **N9-DEF-1**: a "Pax told me X" ticket about the notes book reaches a resolver that has no notes tool.

---

## Defects filed by this drill set (filed, never fixed in this lane)

**N9-DEF-1 (Capability, Medium) — the Pax support resolver has no notes read: drills 1 and 3 cannot be grounded on the support path.**
- Step: file a support ticket about a late borrower (drill 1) or about a prior Pax notes answer (drill 3) on a note_investor org.
- Expected: the resolver can read the ladder / the two-book notes state (with the coverage statement), or is structurally routed to escalate notes-book questions.
- Observed (code, first-hand at `994f6b6f8`): `RESOLVER_TOOL_NAMES` in `server/ai/paxSupportResolver.ts:98–112` contains no notes, ladder, or book read of any kind; the chat path's `get_notes` (two-book, coverage-stated, proven in the N1 walk step 13) is not in the support resolver's subset, and no ladder tool exists for either path.
- Consequence: for these two scenario classes the resolver's only correct move is a low-confidence escalation, and nothing structural guarantees it — a confident generic answer would be a drill FAIL (and, for drill 1, an FD5-in-words risk if it promises borrower contact). The drills' live legs stay UNPROVEN until either (a) a notes/ladder read is registered for the resolver, or (b) a live staging run shows the resolver escalating correctly.
- Severity Medium: a proof/capability gap on the support path, not a demonstrated mis-resolution (no live reply was observed).

## Battery (all legs run solo, first-hand, this run)

| Leg | Result |
|---|---|
| `tests/unit/notesSupportDrills.test.ts` (NEW — drills 2 + 4) | 6 passed |
| `tests/unit/noteTapeGolden.test.ts` | 8 passed |
| `tests/unit/noteTapeRoutes.test.ts` | 5 passed |
| `tests/unit/bookkeeping1099.test.ts` (drill 5) | 20 passed |
| `tests/unit/form1099BatchResponseCarriesArtifacts.test.ts` | 1 passed |
| `tests/unit/nec1099QualifiedOutputGate.test.ts` | 18 passed |
| `tests/unit/dsarActionGate.test.ts` (drill 6) | 11 passed |
| `tests/unit/dsarPublicIntake.test.ts` | 8 passed |
| `tests/unit/dsarErasureRegistryEquivalence.test.ts` | 3 passed |
| `tests/unit/dsarDrill.realdb.test.ts` (drill 6 end-to-end pin) | **14 skipped** — no repo-built DB locally (named limitation, drill 6) |
| `tests/unit/paxSupportResolver.test.ts` (drills 1/3 gate) | 3 passed |
| `tests/unit/supportResolverCalibration.test.ts` | 5 passed |
| Scoped tsc of the new test file (temp config extending `tsconfig.tests.json`, include = `notesSupportDrills.test.ts` only, NODE_OPTIONS=--max-old-space-size=5120) | **exit 0, 0 errors** across the file's whole import graph — the new file adds no diagnostics. The FULL `tsconfig.tests.json` run was attempted first and was OOM-killed (exit 137) on this 6 GB VM under cross-lane tsc contention, so the full-tree count was not re-measured locally; the scoped run is the attribution method the plan names for exactly this case |

`check:tests` baseline: the baseline is 151 and must never be raised; the new test file was authored to add no diagnostics (no index-signature indexing, no hand-rolled comment stripping — it performs no source scans). The FULL `npm run check` chain was not run by this lane (record-only + one test file; the auditor runs the full chain per the standing rule).

## Files in this commit

- `docs/evidence/2026-11-23/notes-support-drills.md` — this record.
- `tests/unit/notesSupportDrills.test.ts` — the deterministic drill pins for drills 2 and 4 (drills 5 and 6 were already pinned where they live; drills 1 and 3 are LLM-path and stay record-only until their live legs run).

**No product code changes. No staging or prod data touched. No sends of any kind.**
