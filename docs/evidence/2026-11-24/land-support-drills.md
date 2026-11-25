# Land — support drill set (scenarios from the land_flipper gap sheet, bar item (e)) — LOCAL run

**Spec:** Land work item 9 of the land_flipper gap sheet (bar item (e)): the support drill set — money moment (payoff quote / borrower-says-paid), stuck moment (listing won't go live), "Pax told me X" (parcel figure), data-wrong (flood/soil), and the fail-closed fences land touches (DEFECT-0101 on seller-financed note interest; S-1 and stop-on-reply cited where they already live).
**Run id:** `drill-land-local-2026-11-24`
**Run (ET):** 2026-11-24, late evening ET (builder lane; local execution).
**Environment:** LOCAL ONLY — repo worktree composed of main `50f0f29862cf3ee3b7bee5ab7b7f108a1e0b5ee8` (verified unauthenticated; the #740 merge) PLUS PR #744's nine changed files at head `f57c3297fe87c6f6f0ccd2586394f60c32862836` (verified live, OPEN, base main), because Land's Pax tools exist only on #744. **This drill set is stacked on #744 and lands only after it.** No staging or prod access was used; no staging/prod data was read or mutated; no drill org exists — none was created anywhere.
**Step 0 (landed-work check):** no existing land_flipper drill set or record exists — unauthenticated search of all PRs (open + closed) for "drill" returns only Tax #740/#742 and Notes #698/#738; no land drill branch exists; main at `50f0f29` has no `landSupportDrills` file. This set is new work, not a duplicate.
**Messages sent during the drills:** ZERO by construction — no org, no ticket, no mail/SMS/channel path was invoked. Every leg is a pure engine function, the real tool switch (`executeTool`) over a mocked database seam (the #744 harness pattern), the real passport assembler, the real refusal middleware (mocked flag store), or a first-hand code read. The paste-text leg's syndication builder is mocked to its recorded output shape and the drill asserts zero writes and zero receipts result.
**Correctness rules** were written in the lane record (`hidden_files/build-land-drills-e-2026-11.md`) BEFORE each leg ran. A drill whose surface invents a field, a figure, or a send is a FAIL under these rules even if its other facts are right.

## Residual named up front (not buried)

- **Support clock UNRATIFIED (Tap #7 / R-10):** the ratified support clock the bar names does not yet exist. No live tickets were filed in this run, so no time-to-resolution was measured; the drills were judged against the correctness rules, not a clock. (Same residual as the N9 and T9 records.)
- **The support resolver has no land read (LD-DEF-1, below):** the live resolver legs of drills 1–4 are UNPROVEN, exactly the N9-DEF-1 / T9-DEF-1 shape. The deterministic legs below pin everything the support answer must be grounded in; they do not round the live legs up.

---

## Drill 1 — Money moment: borrower says paid / the operator payoff quote — PASS (deterministic legs); live resolver leg UNPROVEN (LD-DEF-1)

- **Seeded state (synthetic, local):** a serviced note in the Leg 9 sell-on-terms shape — balance $53,100.00 at 10%, originated 2026-09-25, one completed payment on 2026-10-25 that settled $420.38 of interest through that day.
- **Ticket (as designed):** "my borrower says they paid — what is the payoff if they close it out on 2026-11-24 instead?"
- **Correctness rule:** the quote is the serviced-note engine's figure, derived from the note's own completed ledger (accrual from the last interest-settling day, never a schedule guess); the Pax tool and the GET /api/notes/:id/payoff route are the SAME computation; the quote is indicative and records nothing; a replayed payment can never post twice.
- **Observed (measured, this run):** (1) **One computation** — first-hand source pin (in the drill file): `server/routes-notes.ts` (the GET :id/payoff handler, ~:3141) and `server/ai/landTools.ts` both call `deriveServicedNotePayoffInput` and `computePayoffQuote`. (2) **Exact figures** — the real `payoffInputsFromServicedNote` + `computePayoffQuote` (actual/365 fixed): accrual start **2026-10-25** (the ledger day), **30 days** accrued, interest **$436.44** (43,644¢), per-diem **$14.55** (1,455¢), total payoff **$53,536.44** (5,353,644¢). (3) **Through the real switch** — `executeTool("get_land_payoff_quote", …)` returns the identical total and accrued interest, carries `recorded: false` and an INDICATIVE coverage statement, and writes nothing (zero updates observed). (4) **Replay discipline** — the real `insertPaymentIdempotentCents`: a duplicate transaction id returns the existing row with `created: false` (the ledger keeps ONE posting — the "borrower says paid" answer is checkable against exactly one row); a fresh id creates exactly one row; a conflict with no row behind it throws loudly rather than silently dropping a payment.
- **Verdict: PASS** for every deterministic leg. The live resolver leg (ticket → resolver → reply) was not run — no staging access in this lane, and the resolver cannot ground a land answer today (LD-DEF-1).

## Drill 2 — Stuck moment: listing won't go live — PASS (deterministic legs); live resolver leg UNPROVEN (LD-DEF-1)

- **Seeded state (synthetic, local):** listing 9, "10 acres in Luna County", status `draft`, one recorded channel target (Craigslist, `manual_posting`).
- **Ticket (as designed):** "my listing won't go live — publish it for me / why isn't it on Craigslist?"
- **Correctness rule:** AcreOS never posts; "listed" (the operator's own word) is never conflated with "active" (a channel accepted a posting through AcreOS); mark-listed records ONLY status + on-market date; sold/withdrawn/active refuse in plain words; the paste text posts NOTHING.
- **Observed (measured, this run), all through `executeTool`:** (1) A draft marks listed — the single update touches `status` + `publishedAt` only (asserted: no `syndicationTargets` in the write), and the result message says in words "AcreOS did not post it to any channel". (2) **Plain-words refusals** — for `sold`, `withdrawn` and `active`, mark-listed refuses: `what` = "That listing was not marked as listed", `why` names the listing's own state ("It is sold — …" / "It is already active — a channel accepted its posting through AcreOS, and marking it listed would understate that"), an `unlock` is always present, and the spoken refusal contains no internal code, defect id, or the words "syndication"/"attestation"; zero writes and zero receipts across all three. (3) **listed ≠ active** — the single-listing read's coverage states both meanings in words. (4) **Paste text posts NOTHING** — `get_listing_paste_text` returns the Craigslist text + manual instructions with coverage "AcreOS has NOT posted anything", and the run observes **zero updates and zero receipts**; a source pin asserts the land tool module names no mail lane, send service, or channel credential store, so no send is reachable from it.
- **Verdict: PASS** for every deterministic leg; live resolver leg UNPROVEN (LD-DEF-1).

## Drill 3 — "Pax told me X": a parcel figure — PASS (deterministic legs); live resolver leg UNPROVEN (LD-DEF-1)

- **Seeded state (synthetic, local):** the walk's Leg 4 shape — a Luna County parcel whose recorded bundle populates exactly **3 of 17** passport fields (acreage 10 + owner from County GIS, flood "Zone X" from FEMA NFHL).
- **Ticket (as designed):** "Pax told me my parcel is 10 acres in Zone X — is that right, and what don't we know?"
- **Correctness rule:** the answer states its coverage; every quoted figure carries its own source, as-of date and classification; every other field is a named gap with a reason — a 3-of-17 answer is never presented as complete.
- **Observed (measured, this run):** through `executeTool("get_parcel_passport")` into the REAL `assembleLandProfile`: `fieldsPopulated: 3`, `fieldsTotal: 17`, coverage text states "3 of 17 fields"; floodZone = `{value: "Zone X", source: "FEMA NFHL", asOf: "2024-01-01", classification: "authoritative"}`; acreage/owner carry County GIS provenance with their own as-of; `gaps` has exactly **14** entries, every one with a field name and a reason, `soilCapabilityClass` among them.
- **Verdict: PASS** for the deterministic legs; live resolver leg UNPROVEN (LD-DEF-1).

## Drill 4 — Data-wrong: flood/soil lookup returned a gap — PASS (deterministic legs); live resolver leg UNPROVEN (LD-DEF-1)

- **Seeded state (synthetic, local):** (a) a cold parcel — no recorded enrichment bundle at all; (b) the drill 3 parcel — flood recorded, soil never looked up. (The gap sheet's common case — the statewide lookup gate serves 0 counties until dossiers clear — is exactly state (a) at scale; the honest answer is the same shape.)
- **Correctness rule:** a field that was never looked up is a named gap with its reason; no flood zone and no soil class may be invented, inferred, or borrowed from a neighbouring field.
- **Observed (measured, this run):** (a) cold parcel: `fieldsPopulated: 0`, `fields.floodZone` and `fields.soilCapabilityClass` are **absent** (undefined — not null-filled, not guessed), all 17 gaps carry reason `not_looked_up`. (b) flood recorded, soil not: flood reads **exactly** "Zone X" as recorded (no embellishment, no re-derivation) while soil stays a named gap.
- **Verdict: PASS** for the deterministic legs; live resolver leg UNPROVEN (LD-DEF-1).

## Drill 5 — The fences where land touches them — PASS (DEFECT-0101 leg); S-1 and stop-on-reply cited at their existing pins

- **DEFECT-0101 (1099-INT on seller-financed note interest):** the land book's income line IS note interest — the one line the 1099-INT generator reads — so the fence matters more here than anywhere. **Observed (measured, this run):** with the flag store mocked off (the `bookkeeping1099.test.ts` pattern), a customer request through the real `requireQualified1099Output()` is refused **422** `{error: "not_qualified_filing_output", details: {defect: "DEFECT-0101"}}` and `next` is never called; with the flag store throwing, the refusal is still 422 (fail closed). Pinned in the drill file.
- **S-1 borrower-erasure refusal:** already pinned where it lives — `dsarDrill.realdb.test.ts` assertion 9 (RETENTION_REQUIRED_LOAN_RECORDS against a real DB), cited by the N9 record; a serviced note's records are loan records under the same refusal. Not re-pinned here (realdb legs do not run in this lane).
- **Stop-on-reply (offer-letter follow-up):** no land-specific leg is pinned in this set; the outreach suppression discipline is platform-level and unchanged by #744 or this set. Named here so the fence is accounted for, not silently dropped: a land-shaped stop-on-reply pin is owed with the cure lane if LD-DEF-1's fix touches outreach tooling.
- **Verdict: PASS** — the DEFECT-0101 refusal is correct and fail-closed on the land book's own interest line.

---

## Defects filed by this drill set (filed, never fixed in this lane)

**LD-DEF-1 (Capability, Medium) — the Pax support resolver has no land read: the live legs of drills 1–4 cannot be grounded on the support path.**
- Step: file a support ticket on a `land_flipper` org about a parcel passport figure, a listing that won't go live, or a serviced-note payoff.
- Expected: the resolver can read the passport / listings / payoff (with the coverage statements the #744 tools carry), or is structurally routed to escalate land questions.
- Observed (code, first-hand at main `50f0f29` + #744 head `f57c3297`): `RESOLVER_TOOL_NAMES` in `server/ai/paxSupportResolver.ts:98–112` contains none of the six land tools (`get_parcel_passport`, `get_land_listings`, `get_land_listing`, `get_listing_paste_text`, `get_land_payoff_quote`, `mark_land_listing_listed`); the chat path registers all six (proven by `paxLandTools.test.ts`, PR #744). The capability pin in `tests/unit/landSupportDrills.test.ts` makes the gap visible until a cure removes it.
- Consequence: for this scenario class the resolver's only correct move is a low-confidence escalation, and nothing structural guarantees it — a confident generic answer would be a drill FAIL. The live legs stay UNPROVEN until either (a) the land reads are registered for the resolver (the #738 cure for notes is the working pattern), or (b) a live staging run shows the resolver escalating correctly.
- Severity Medium: a proof/capability gap on the support path, not a demonstrated mis-resolution (no live reply was observed). Same shape and severity as N9-DEF-1 and T9-DEF-1.
- **Census note:** no purpose-ledger census entry was needed or made by this set — nothing here touches `supportAgent` dispatch; if the LD-DEF-1 cure registers land tools on the resolver, that cure lane owns the census + plain-words gates.

## Battery (all legs run solo, first-hand, this run)

| Leg | Result |
|---|---|
| `tests/unit/landSupportDrills.test.ts` (NEW — drills 1–5 + LD-DEF-1 capability pin) | **18 passed** |
| `tests/unit/paxLandTools.test.ts` (#744 family proof; drills 1–4 supporting) | **17 passed** |
| `tests/unit/taxSupportDrills.test.ts` (form precedent, unaffected) | **20 passed** |
| `tests/unit/bookkeeping1099.test.ts` (drill 5 supporting) | **20 passed** |
| `tests/unit/paxSupportResolver.test.ts` (LD-DEF-1 gate) | **3 passed** |
| `tests/unit/supportResolverCalibration.test.ts` (LD-DEF-1) | **5 passed** |

Lint legs of the `npm run check` chain, run individually, first-hand: **31 of 34 legs rc=0** (schema, schema-migrate-mirror, schema-journal-sync, ledger-refs, no-fabrication, measurement-defaults, boundaries, kernel-boundary, ratchets, reachability, model-prefix, prompt-envelope, contract-adoption, org-fetch, css-hover, page-hex, dead-token-alpha, semantic-contrast, unchecked-mutation, prefetch-authority, date-format, zindex, translucency, eslint-ratchet, browser-safe-shared, route-order, route-shadowing, infrastructure-restraint, residential-comps-hold, inline-provenance, clock-reads). The remaining three legs and the two tsc legs are **named here as CI-discharge, not local passes**: `lint:ghost-fields` was OOM-killed once (rc=137) while a parallel scoped tsc ran on this 6 GB cell; `lint:empty-update-set` and `lint:status-vocabulary` (both full-tree scans) did not complete locally across repeated attempts under VM contention and the deny windows below; `check:app` / `check:tests` likewise — a scoped tsc over the new file's import graph was also OOM-killed under the same contention, so no scoped-tsc attribution is claimed. CI discharges all five on the PR. Bundle: this set adds one test file and this record only — the published diff touches nothing under `client/` or any server runtime path (tests + docs only), so the customer (7,954 KB ceiling) and founder (2,735 KB) bundles cannot move; no build figure is claimed beyond that construction proof.

**Environment note (honesty, local only):** this VM intermittently denied node process execution and node reads of the drill file's first version for extended windows during this run (the same quirk the T9 record documents). The first version's bytes were persistently unreadable to node while the Tax/Notes files read fine; the file was rewritten with a fresh surface and ran green on the first clean attempt (18/18). Every result above was read from a completed run; no result was inferred from a denied one.

**No product code changes. No staging or prod data touched. No sends of any kind — zero real mail, absolute.**
