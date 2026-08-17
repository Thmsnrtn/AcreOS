# Foundry → AcreOS cross-pollination ledger

**Started 2026-08-17.** One line per candidate invariant, with its disposition
and the evidence behind it.

## The rule this ledger exists to enforce

**Do not make AcreOS into Foundry.** Foundry is a general Adaptive Company
Institution; AcreOS is an opinionated property-investment OS. What may cross is
an *invariant* or a *failure-mode discovery* — a thing Foundry learned the hard
way about how systems lie to their operators. What may never cross is a noun: no
Foundry table, migration, ontology, brand name, or runtime dependency. AcreOS
gains no import from Foundry, and Foundry is read-only throughout.

Consequence in practice: every accepted transfer below lands as AcreOS-native
code against structures AcreOS already owns, and at least one deliberately
*inverts* Foundry's implementation because AcreOS's obligations differ.

Traffic already runs both ways — Foundry's `scripts/ratchet.mjs` says in its own
header that it was ported FROM AcreOS. This is an exchange between two
codebases, not an upstream and a downstream.

## Admission test

A candidate is only imported if it passes all of these. Any failure means
**DO NOT IMPORT**, and the reason is recorded rather than argued away.

1. Names a defect that exists in AcreOS *today*, citable by file and line.
2. Transfers an invariant, not a noun.
3. Creates no parallel architecture — it narrows or hardens something AcreOS
   already has.
4. Introduces no second authority model, vocabulary, or maturity ladder.
5. No Foundry runtime dependency, import, or schema.
6. Does not touch money custody, or the founder-only hard-stops.
7. Does not increase owner burden.
8. Testable locally, without production access.
9. Fits the doors model — no new top-level surface, customer or founder.
10. The AcreOS version would still be right if Foundry disappeared tomorrow.

---

## Ledger

| # | Invariant | Disposition | Landed as |
|---|---|---|---|
| 1 | A caller cannot declare its own safety | **ALREADY PRESENT — retired** | — |
| 2 | Maturity is a projection of evidence | **ADAPTED** | `shared/business-types/readiness.ts`, `verticalReadiness.test.ts` (`73dc6924`) |
| 3 | An epistemic vocabulary is real only when the store refuses violations | **ADAPTED, PARTLY INVERTED** | `migrations/0238`, `0239`, `evidenceClaimsIntegrity.test.ts` (`708542d2`) |

---

### 1 — "A caller cannot declare its own safety" → RETIRED, already present

**Foundry's version.** Derive policy from trusted server context; fail closed on
missing facts; refuse a caller's conflicting assertion.

**The AcreOS surface tested.** `emailService.ts` takes `purpose?: 'system' |
'counterparty'` from the caller, which looks exactly like the defect: a caller
declaring the lane that decides whether BYO identity is required.

**Why it was retired, not imported.** Two findings, both against HEAD:

- The founder has **explicitly ruled** that `purpose` stays optional and that
  "an explicit declaration is a decision of record and the guard does not
  second-guess it." Importing the invariant here would relitigate a standing
  decision — out of bounds regardless of merit.
- `disclosureTimingDispatcher.ts:104` already derives `purpose: recipient.lane`
  from server-side resolution, with the comment that it is done so the two
  "cannot drift apart." That is *better* than the fix the transfer would have
  proposed, and it was already there.

**Recording a retirement is the point.** A ledger that only lists accepted
transfers overstates what the exercise found.

---

### 2 — "Maturity is a projection of evidence" → ADAPTED

**Foundry's version.** An E0–E6 evidence ladder (`PROOF_PROGRAM.md`), with the
governing rule that "a test proves only its stated boundary." Notably, Foundry's
ladder is **documented only** — no type, no column, no ratchet. Its value is the
discipline it produced, not the vocabulary.

**The AcreOS defect.** All 15 verticals declare `maturity: "core"`. Exactly two
can show it. The guard that should have caught this — `customerPersonas.test.ts`
— asserts maturity only inside `if (displayName.includes("(waitlist)"))` /
`("(beta)")`, and measured, no persona display name contains either: 30 personas
iterated, 0 assertions made.

**What crossed:** the law that a declared level must be a projection of
evidence, and the discipline of refusing to promote on constructed rather than
executed proof.

**What did NOT cross:** E0–E6 itself. AcreOS gets four tiers named for what this
repository can actually demonstrate — `declared` / `surfaced` / `underwritten` /
`decided` — because a level AcreOS could never award from source would be
decoration. There is deliberately no `learning` tier: grading needs realized
outcomes, and `calibration.ts` already refuses a direction below six
comparisons.

**Result.** 13 of 15 overclaim; frozen and down-only. The useful finding is the
*shape*: every vertical has a real surface (4–7 modules, 2–5 templates, no
dangling ids) and thirteen stop dead before a recorded decision. **The gap is
the loop, not the surface**, so building more screens moves none of it.

The label is not rewritten automatically — that is a customer-facing claim and
therefore a founder decision (OD-5). What is not a founder decision is whether
the gap is visible and counted.

---

### 3 — "An epistemic vocabulary is real only when the store refuses violations" → ADAPTED, PARTLY INVERTED

**Foundry's version.** `reconstruction_claims` carries a closed status set as a
CHECK plus a BEFORE INSERT trigger enforcing the vocabulary's semantics, and its
judgment ledger is append-only via BEFORE UPDATE **and** DELETE aborts.

**The AcreOS defect.** `shared/schema/evidence.ts` declares "APPEND-ONLY BY
CONTRACT" and argues it correctly — "a row that can be updated is a row whose
history can be rewritten" — while `migrations/0227` created the table with **zero
constraints**. `authority = 'guess'` inserted cleanly. The immutability promise
rested entirely on the absence of an `updated_at` column, and Law 6 plus the
frozen `RESOLUTION_POLICY_VERSION` in decision snapshots both depend on it.

**What crossed:** put the vocabulary in the write path.

**WHERE ACREOS MUST NOT FOLLOW FOUNDRY.** Foundry blocks UPDATE *and* DELETE.
AcreOS must not: `evidence_claims.organization_id` carries `ON DELETE CASCADE`,
so a DELETE-refusing trigger makes a tenant permanently undeletable and puts the
table beyond reach of GDPR erasure. Copying the ledger wholesale would have
built an unerasable store of third-party personal data. **Erasing a record and
rewriting one are different acts.** UPDATE is refused; DELETE is not.

**And the analysis that proposed it was wrong on a detail that mattered.** The
suggested "exactly one value column is populated" constraint would have refused
the live writer on its next insert — `evidenceStore.ts:73-76` sets `value_text`
alongside `value_number`/`value_bool` as a human-readable rendering. The shipped
rule is derived from the reader at `:89-93` instead. Verifying against code
rather than the report is what caught it.

**What the same test then found.** `earnest_money_events` had implemented
append-only with rewrite RULES (`DO INSTEAD NOTHING`). A rewrite rule rewrites
PostgreSQL's own foreign-key check queries, so **`DELETE FROM organizations`
aborted for an organization with zero escrow rows** — the GDPR erasure path
(`orgDeletion.ts:122`) could not succeed for any customer, ever. Replaced with a
trigger; org deletion verified working. The retention question that exposes is
OD-6.

---

## Not yet dispositioned

The 2026-08-17 read produced seven Foundry themes; the three above are closed.
The full agent output is large and lives outside the repo — re-derive from
Foundry directly rather than trusting a summary, per the wave-discipline rule
that a report is a hypothesis.

Themes noted but not yet tested against AcreOS HEAD:

- **Observer independence** — a verification observation whose payload carries
  its own expectation is self-confirming (`119_development_observation_independence.sql`).
  Plausibly relevant to AcreOS's outcome-grading path, untested.
- **Deny-dominant, bidirectional authority scoping** — a grant may not widen its
  own reach, checked in both directions (`120_development_authority.sql`).
- **Refusing promotion into an unproven state at the write**
  (`115_operating_promotion_freeze.sql`).
- **Owner direction that is structurally non-authoritative** — a disposition
  ledger with no consent/scope/capability column, so no later authority lookup
  can read it (`118_judgment_owner_disposition.sql`).
- **Public-claim auditing against code-derived sources** (`audit-public-claims.mjs`).
  Closest AcreOS analogue is the `lint:no-fabrication` gate plus OD-5's finding
  that two public surfaces publish vertical maturity and can already drift.

Each still has to pass the ten-point test on its own evidence. None is admitted
by association with the three that did.
