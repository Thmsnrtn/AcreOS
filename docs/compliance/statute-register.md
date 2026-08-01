# The Statute Register

**Last updated:** 2026-08-01
**Machine-readable source of truth:** [`shared/governance/statuteRegister.ts`](../../shared/governance/statuteRegister.ts)
**Ratchet:** [`tests/unit/statuteRegister.test.ts`](../../tests/unit/statuteRegister.test.ts)

---

## This is a map, not a claim of compliance

Read that sentence again before you use anything below.

This document does **not** assert that AcreOS complies with any law. It asserts
only this: *here is code that takes a legal obligation on, here is where it
lives, and here is who has — or has not — checked it.*

It is an **inventory of exposure**, not a certificate. A register that reads
like a compliance certificate is a liability, because someone will eventually
rely on it. Nothing here has been reviewed by an attorney. Where an entry says
`founder-reviewed`, that means a solo founder made a dated business decision
recorded in `docs/company/` — it does not mean a legal analysis was performed.

If you are looking for "is AcreOS compliant with RESPA?", this file cannot
answer you. What it can tell you is which files would have to be correct for
that answer to be yes, and whether anything is currently checking them.

---

## The number that matters

> ## 29 of 31
>
> **29 statute implementations that no lawyer has read.**

31 entries. 29 `UNREVIEWED`. 2 `founder-reviewed`. 0 `attorney-reviewed`.

That number is expected to be high — a solo founder, zero customers, no counsel
on retainer. Making it look better is not the goal. The register's job is to
make it **visible and shrinkable**. `tests/unit/statuteRegister.test.ts` holds
it at a baseline that may only go **down**; adding a new statute
implementation without a review raises it, and the build says so.

**Enforcement mix** — how correctness is checked *today*:

| Enforcement | Count | What it means |
|---|---:|---|
| `unit-test` | 22 | A vitest suite exercises the rule's logic |
| `ratchet` | 1 | A structural ratchet fails the build on drift |
| `refusal-path` | 4 | The code refuses when it can't satisfy the rule, but **no test pins that refusal** |
| `prose-only` | 4 | A comment. Nothing automated. |

The eight `refusal-path` + `prose-only` entries are the enforcement debt. Two
of them are worse than the label suggests and are called out below.

---

## Why this file exists

In **one** recent program of work, audits found **five** separate places where
this platform encoded a legal obligation in code and got it materially wrong.
Every one of them passed every gate:

1. **RESPA §1024.39** early intervention fired off a delinquency date derived
   from a note whose servicing history the platform had never seen — a federal
   obligation triggered by an invented number.
2. **Reg-Z §1026.41** periodic statements printed *"the 1st of next month"* as
   the payment due date for **every** borrower, with a code comment promising a
   per-loan override that was never written. §1026.41(b)(2)'s delivery deadline
   was computed off the same wrong date.
3. **The same §1024.39 clock** counted from due-date-plus-grace instead of the
   due date, delaying a federal obligation by the grace period.
4. **IRS Pub 1220** 1099-INT record layout carried multiple wrong field
   positions. Those e-filings would have been rejected.
5. **Tex. Prop. Code §92.019** late-fee cap selected its statutory branch off a
   unit count the platform itself admitted was a guess.

Plus a money-custody violation where consumer mortgage payments settled into
AcreOS's own platform balance with no payout path.

The common factor is not carelessness. It is that **statute-implementing code
is indistinguishable from ordinary code**. Nothing marked it, nothing listed
it, and nobody could answer *"what laws does this platform claim to implement,
and who checked?"*

That question now has a file.

---

## The three worst failure modes on this list

Ranked by *severity of harm to a real person*, not by likelihood.

### 1. `scra.tolling-and-rate-cap` — SCRA tolling is accepted as an input and thrown away

`server/services/redemptionClock.ts` takes an `scraTolling` input and
**discards it** — literally `void input.scraTolling` — with a comment saying
full tolling "lands when we wire active-duty status into the certificate row."
The schema has `scra_checked_at` and `scra_active_duty` columns. `rmloAdvisor`
emits a 6%-cap *checklist line*. **No code applies any SCRA protection.**

The platform therefore renders a redemption deadline that, for an active-duty
servicemember, has not run under federal law — and renders it as a plain date,
with nothing on screen distinguishing "computed" from "legally binding." An
operator forecloses or forfeits redemption on the strength of it.

This is the worst entry on the list because: the harm lands on a deployed
servicemember; SCRA carries criminal exposure and mandatory attorney fees; the
gap is *known* and *documented in the code* rather than accidental; and the
enforcement is `prose-only`, so nothing will ever tell you it is still true.
Everything needed to be correct is already in the schema. Only the arithmetic
is missing.

### 2. `regz.periodic-statement-due-date` — the due date on a required disclosure

This one is not hypothetical: **it shipped.** Every §1026.41 periodic statement
AcreOS produced told the borrower their payment was due on the 1st of next
month, for every borrower whose note said anything else.

It is second, not first, because it is now fixed and tested — the resolvers
read the loan's own schedule and *refuse* (skip with `NO_DERIVABLE_DUE_DATE`)
rather than substitute a calendar constant. But it stays near the top of this
list because of what it demonstrates: a wrong due date on a federally required
disclosure is a **compounding** error, not a local one. Borrowers pay late on
their servicer's own written instruction. They incur late fees for it. And
every downstream clock — the §1026.41(b)(2) delivery deadline, the §1024.39
36-day early-intervention trigger, the §1026.41(d)(8) 45-day delinquency
disclosure — counts from the same wrong number. One field, silently wrong, and
four separate federal obligations misfire together.

It also shows how this class of defect survives review: the code *documented*
the missing override in a comment, and the comment was mistaken for the work.

### 3. `regz.ability-to-repay` — a hard gate with nothing holding it

`server/storage/noteRepo.ts` and `server/routes-finance.ts` refuse to create or
activate a covered consumer note without an ATR determination, returning
`regulatoryCite: "12 CFR §1026.43(c)"`. Good gate. **No test anywhere pins
it.** A refactor that drops the check breaks nothing visible, and the register
would still say the obligation is handled — because the refusal is in the code,
not in a test.

The consequence is asymmetric in a way the other entries are not. A borrower
gets a mortgage they cannot repay, and under §1026.43 they gain a defense to
foreclosure **for the life of the loan** — meaning the lender's own software
destroyed the record that would have defended them, and will not find out for
years. It is the single highest-value place on this list to convert
`refusal-path` → `unit-test`.

**Honourable mention:** `esign.consumer-consent` and `fcra.permissible-purpose`
are the same shape — well-designed refusals (five-flag §101(c) consent with
version invalidation; annual FCRA attestation persisted for class-action
defence) with **zero tests**. FCRA in particular is the classic class-action
vehicle, with statutory damages per consumer.

---

## The register

| # | Citation | Enforcement | Review |
|---:|---|---|---|
| 1 | 12 C.F.R. §1026.41(a),(e); §1026.2(a)(19); §1026.36(a)(4); §1024.2(b) — statement scope | `unit-test` | UNREVIEWED |
| 2 | 12 C.F.R. §1026.41(d)(1) — payment due date | `unit-test` | UNREVIEWED |
| 3 | 12 C.F.R. §1026.41(d)(1)–(d)(5) — required content | `unit-test` | UNREVIEWED |
| 4 | 12 C.F.R. §1026.41(b),(b)(2) — delivery timing | `unit-test` | UNREVIEWED |
| 5 | 12 C.F.R. §1026.41(d)(8) — 45-day delinquency block | `unit-test` | UNREVIEWED |
| 6 | 12 C.F.R. §1026.36(c)(2) — late-fee non-pyramiding | `unit-test` | UNREVIEWED |
| 7 | 12 C.F.R. §1026.36(c)(1)(i),(ii) — prompt crediting + suspense | `unit-test` | UNREVIEWED |
| 8 | 12 C.F.R. §1026.43(c),(e) — ability to repay | **`refusal-path`** | UNREVIEWED |
| 9 | 12 C.F.R. §1026.36(a)(4); 12 U.S.C. §5102 — seller-financer exclusion | `unit-test` | UNREVIEWED |
| 10 | 12 C.F.R. §1024.39(a) — RESPA early intervention (36 days) | `unit-test` | UNREVIEWED |
| 11 | 12 C.F.R. §1024.17 — RESPA escrow analysis | `unit-test` | UNREVIEWED |
| 12 | IRS Pub 1220 (Rev. 5-2026) Part C — FIRE record layout | `unit-test` | UNREVIEWED |
| 13 | 26 U.S.C. §6050H — Form 1098 | `unit-test` | UNREVIEWED |
| 14 | 26 U.S.C. §6049 — Form 1099-INT | `unit-test` | UNREVIEWED |
| 15 | Tex. Prop. Code §92.019 — residential late-fee cap | `unit-test` | UNREVIEWED |
| 16 | State security-deposit return statutes | **`prose-only`** | UNREVIEWED |
| 17 | State lease non-renewal notice statutes | **`prose-only`** | UNREVIEWED |
| 18 | State eviction-notice + retaliation statutes | `unit-test` | UNREVIEWED |
| 19 | 42 U.S.C. §3604(c),(f); §3607(b) — fair-housing advertising | `unit-test` | UNREVIEWED |
| 20 | 42 U.S.C. §4852d; 24 C.F.R. §35.92; 40 C.F.R. §745.113 — lead paint | **`refusal-path`** | UNREVIEWED |
| 21 | E-SIGN §101(c), 15 U.S.C. §7001(c) — consumer consent | **`refusal-path`** | UNREVIEWED |
| 22 | 15 U.S.C. §1681b — FCRA permissible purpose | **`refusal-path`** | UNREVIEWED |
| 23 | SCRA, 50 U.S.C. §3936, §3937, §3953 — tolling + 6% cap | **`prose-only`** | UNREVIEWED |
| 24 | 47 C.F.R. §64.1200(c)(1); 47 U.S.C. §227 — TCPA quiet hours | `unit-test` | UNREVIEWED |
| 25 | 47 C.F.R. §64.1200(c)(2) — DNC + litigator scrub | `unit-test` | **founder-reviewed 2026-07-29** |
| 26 | CAN-SPAM §5(a)(3),(a)(5); 15 U.S.C. §7704 | `unit-test` | UNREVIEWED |
| 27 | 31 C.F.R. §1010.100(ff)(5) + state MTL — no platform money custody | `ratchet` | **founder-reviewed 2026-07-29** |
| 28 | NACHA Operating Rules §2.3 — ACH authorization record | `unit-test` | UNREVIEWED |
| 29 | 31 C.F.R. Chapter V — OFAC screening (**advisory only**) | `unit-test` | UNREVIEWED |
| 30 | State usury statutes | `unit-test` *(partial)* | UNREVIEWED |
| 31 | State tax-sale redemption statutes | **`prose-only`** | UNREVIEWED |

Full detail — `what`, `codeSites`, enforcement notes, and the `failureMode` for
every entry — is in `shared/governance/statuteRegister.ts`. The table above is
a summary; the TypeScript file is the source of truth, because it is the one
the ratchet checks.

---

## Things the register found while being written

These are not statute entries. They are structural problems the inventory
surfaced, worth recording because nobody was looking for them:

- **Two overlapping security-deposit registries.**
  `shared/regulatory/depositReturnRules.ts` and `SECURITY_DEPOSIT_RULES` in
  `server/services/landlordCompliance.ts` both encode per-state deposit
  deadlines. They can disagree. Nothing cross-checks them. One is tested; the
  other is not.

- **Three overlapping usury tables.** `server/services/usury.ts`,
  `server/services/usuryCeiling.ts`, and the cap table in
  `shared/regulatory/rmloAdvisor.ts`. Two surfaces of the same product can give
  an operator two different answers about the same rate.

- **A test that tests nothing.** `tests/unit/usuryCeiling.test.ts` does not
  import `server/services/usuryCeiling.ts` — it **reimplements the logic
  inline** and asserts against its own copy. The shipped service is untested,
  and the file name says otherwise. This is a worked example of why the ratchet
  checks that `unit-test` entries name a *file that exists* and why "there's a
  test for that" is a hypothesis until you open it.

- **Pub 1220's validator is structural, not semantic.** `assembleRecord()`
  proves fields are contiguous and correctly sized; `validateFireFile()` proves
  the file is well-formed. Neither can prove a field sits where the IRS says it
  does — a mis-transcribed position is still perfectly self-consistent. That is
  exactly how the wrong 1099-INT layout passed.

- **RESPA §1024.39 logs, it does not contact.** The module fires an idempotent
  audit event at day 36 and persists the §-citation. It sends **nothing to a
  borrower**. The federal duty is to make live contact; recording that contact
  was due does not discharge it. An operator watching `respa_outreach_events`
  fill up would reasonably believe otherwise.

---

## How to use this file

**Adding a statute implementation.** Add the entry to
`shared/governance/statuteRegister.ts` in the same commit as the code. The
`UNREVIEWED` count goes up, and that is correct — you just took on a legal
obligation nobody has reviewed. Do not raise the baseline to hide it.

**Getting one reviewed.** Record the review somewhere citable (a dated founder
decision in `docs/company/`, or an attorney engagement memo). Set
`reviewStatus`, `reviewedAt`, and a `reviewScope` that says *what was actually
reviewed* — a bare `founder-reviewed` on a decision about something adjacent
overstates it. Then lower `UNREVIEWED_BASELINE` in the same commit.

**Paying down enforcement debt.** `refusal-path` → `unit-test` is the cheapest
high-value move in this repo: the refusal already exists, it just needs a test
that would notice its removal. Start with `regz.ability-to-repay`,
`esign.consumer-consent`, and `fcra.permissible-purpose`.

**When a wave touches any of these files.** Verify against the code, not
against the wave's report. Four of the five defects listed at the top of this
document were reported as complete by the agent that shipped them.
