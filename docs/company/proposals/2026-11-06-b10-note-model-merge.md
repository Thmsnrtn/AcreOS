# B10 — merging the two note models: a migration proposal (DRAFT, 2026-11-06)

**Status: proposal only.** This PR changes no schema and moves no data. Every stage
below that touches schema or customer data is founder-gated and is listed with
what it needs from Tom.

Labels used throughout: **[read]** = verified by reading code on main `07de7936`
(re-checked after rebase onto `2fe0a7cb`); **[ran]** = verified by running
something; **[inferred]** = a conclusion, not a measurement.

## 0. What B10 is

B10 is defined in `docs/implementation/BLOCKERS.md` ("Two note-payment data models,
and one writer that respects neither rule") [read]:

- **Founder ruling 2026-08-13:** `acquired_notes` / `note_payments` (the integer-cents
  family) is the successor. The legacy `notes` / `payments` family is terminal.
- Unit 87 deleted the float `POST /api/notes/:id/record-payment` and turned the legacy
  writers into a down-only ratchet (`tests/unit/legacyNoteModelIsTerminal.test.ts`).
- **Still open:** "the actual data migration — moving legacy rows into the cents
  family and retiring the writers — is not attempted." This doc is the plan for that.

The task brief guessed the two models were "originated seller-finance notes" and
"acquired notes from the tape import". That is correct, and it is exactly the B10
split [read]:

| | legacy (originated, seller-finance) | cents family (acquired) |
|---|---|---|
| tables | `notes`, `payments` (`shared/schema.ts`) | `acquired_notes`, `note_payments` (`shared/schema/notes-vertical.ts`) |
| id | `serial` integer | `uuid` |
| money | `numeric` decimal dollar strings, rate as a percent string | `bigint` integer cents, rate in integer bps |
| auth | seller-finance list is not owner/admin-gated | owner/admin (carries borrower TINs) |
| UI | Finance door `/finance` (`useNotes()` → `GET /api/notes`) | `/notes`, `/notes/:id`, `/notes/pipeline[/:id]` |

Note there is a **third** note-shaped table: `note_acquisitions` (the pre-book
pipeline — notes being *considered*), varchar-uuid keyed, promoted into
`acquired_notes` on funding (`server/routes-note-acquisitions.ts`) [read]. It is not
part of B10, but it matters for the pricing engine (§B).

## 1. Inventory

Writer/reader counts below were measured with a comment-stripping scan of
`server/ client/src shared scripts` for `.insert/.update/.delete(X)` and
`.from/.join(X)` / `db.query.X` [ran]. It is an inventory, not a gate; a
`payments` identifier could in principle be a different symbol.

### 1.1 Tables

**Legacy family — integer `notes.id` referenced by** [read, FK scan of `shared/schema*.ts`]:
`payments` (cascade), `tax_escrow_payments`, `payment_reminders`,
`collection_enrollments`, `cash_flow_forecasts`, `va_actions.related_note_id`,
`borrower_sessions`, `borrower_messages`, `autopay_enrollments`, `trust_ledger`,
`delinquency_escalations` (`shared/schema/deal-lifecycle.ts`), `ach_mandates`,
`ach_debit_attempts` (cascade, `shared/schema/ach-autopay.ts`); plus un-FK'd integer
`note_id` on `borrower_payment_profiles` and `va_tasks`, and `noteId: number` inside
`form_1099_batches.forms` jsonb. `notes` itself carries origination-only columns with
no cents-family twin: ATR determination + exemption code (DB CHECK from
`migrations/0099_notes_atr_origination_gate.sql`: `status='active'` impossible without
one), escrow fields, borrower-portal `access_token`, autopay pointers and fallback
cascade, `amortization_schedule` jsonb, `originating_deal_id`, `owning_entity`,
`version` (optimistic lock), soft delete (`deleted_at`).

**Cents family — uuid `acquired_notes.id` referenced by** [read]: `note_payments`,
`note_field_observations` (per-field provenance, append-only by trigger),
`note_events` (append-only by trigger), `note_assignments`, `note_ownership_splits`,
`note_loss_mit_cases` (→ `note_loss_mit_actions`), `note_ownership_of_record` — all
ON DELETE CASCADE.

**Already polymorphic over both books** [read]: `periodic_statements`
(`loan_id text` + `loan_type 'note'|'acquired_note'`), `periodic_statement_skips`
(`note_id text` + `note_table`), `note_payoff_quotes` (`note_system` + `note_ref`),
`respa_outreach_events`, `payment_applications`, `suspense_balances`,
`late_fee_assessments` (`loan_id text`, `shared/schema/reg-z.ts`). These need a
re-point of the legacy rows' key, not a redesign.

### 1.2 Write paths

- **Legacy `notes`** (7 server files, exactly the `LEGACY_WRITERS` ratchet list):
  `routes-subdivisions.ts` (lot sale creates a note), `services/achAutopay.ts`,
  `services/atrSafeHarbor.ts`, `services/propertyTaxService.ts` (4 escrow writes),
  `services/borrower/portalPaymentPosting.ts`, `webhookHandlers.ts` (refund reversal),
  `storage/noteRepo.ts`; plus scripts `seed-james-note.ts`,
  `founder-autonomy/reset-cohort.ts` [ran]. `payments`: webhookHandlers, achAutopay,
  portalPaymentPosting, noteRepo.
- **Cents family:** `acquired_notes` ← `routes-notes.ts`, `routes-note-acquisitions.ts`
  (promote), `jobs/acquiredNoteAging.ts`, `services/notes/noteTapeCommit.ts`;
  `note_payments` ← `routes-notes.ts` only; observations ← tape commit + routes-notes;
  `note_events` ← tape commit (and, in open #461/#463, the workout and ladder writers) [ran].

### 1.3 Read surfaces

- **Pages:** Finance door `/finance` (seller-finance list, dunning, schedule PDF,
  documents); `/notes`, `/notes/:id` (acquired record, payments, yield, basis, payoff,
  splits, assignments, loss-mit, compliance), `/notes/pipeline[/:id]` [read].
- **Routes:** `routes-finance.ts` owns `GET /api/notes` and numeric `GET /api/notes/:id`
  and **calls `next()` on a non-numeric id** so `routes-notes.ts` serves uuids under
  the same URL space ("ONE PATH, ONE OWNER", `routes-notes.ts:1303`);
  `routes-va-engine.ts` `GET /api/notes/:noteId/delinquency` is the legacy book's (which
  is why #463 put its ladder at `/delinquency-ladder`) [read].
- **Borrower portal:** `routes-borrower.ts` (12 legacy reads), portal payment posting,
  autopay/ACH mandates, periodic statements — **legacy book only** for money [read].
- **Tax/exports:** `form1098Batch.ts` reads both books; `form1099Batch.ts` unions both;
  `acquiredNotesExport.ts` (acquired), `dataPortability.ts` (legacy),
  `migrationJobs.ts` (both), `bookkeeping.ts` (legacy), `investorStatementBatch.ts` and
  `servicerRemittance.ts` (acquired) [read/ran].
- **Pax:** the `get_notes` tool (`server/ai/tools.ts:1654`) reads `storage.getNotes`
  — **legacy only**; Pax cannot see the acquired book. `supportAgent.ts` reads legacy
  `notes`/`payments` [read].
- **Jobs/workflows:** `acquiredNoteAging` (acquired; durable outbox hand-off) vs
  `notePaymentDueDetector`, payment reminders, collection enrollments, `ltvMonitor`,
  `cashFlowForecaster` (legacy). `emitPaymentEvent` from both sides [read].
- **Webhooks:** `webhookHandlers.ts` reverses refunded charges on the legacy ledger,
  through the `customerMoneyRouting.ts` chokepoint [read].

### 1.4 Invariants and guards that must survive

- `legacyNoteModelIsTerminal.test.ts` — legacy writer set down-only.
- `acquiredNotesDeletedOnlyByErasure{,.realdb}.test.ts` (#450; founder decisions
  2026-11-03) — only org erasure may delete an acquired note; soft delete is the
  ruled future shape.
- `note_field_observations` / `note_events` append-only triggers; disagreement is kept,
  never resolved (`shared/provenance/fieldRecord.ts`).
- ATR origination CHECK on `notes` (0099) and the 2026-11-05 ruling 3 (activation
  requires the ATR record on every path; #461).
- Money custody: `customerMoneyRouting.ts` + `moneyCustodyHardStop.test.ts` — borrower
  money moves only on the customer's own Stripe Standard / ACH account.
- TCPA servicing carve-out keyed on "borrower of record".
- Periodic-statement servicer-scope gates (`periodicStatements/predicate.ts`).

### 1.5 Every place code branches on which book a note is in

`ACQUIRED_BOOK_ID` / `SELLER_FINANCE_BOOK_ID` (`routes-notes.ts` responses);
numeric-vs-uuid id dispatch in `routes-finance.ts` → `routes-notes.ts`; `loanType`
in `respa/earlyIntervention.ts`, `lateFees/index.ts`, `paymentApplication/index.ts`,
`periodicStatements/{index,delivery,predicate}.ts`; `noteTable` in
`periodicStatements/index.ts`; `noteSystem` in `routes-notes.ts` payoff quotes;
`acquiredNoteAging.ts` (`loanType: "acquired_note"`); the separate legacy-only
delinquency route; the 1098/1099 dual reads; Pax `get_notes` [ran grep, read].

## 2. Target model

One note book: **`acquired_notes` / `note_payments`, generalised to hold originated
notes**, with an `origin` discriminator (`'acquired' | 'originated'`), integer cents,
uuid ids, and the provenance spine (`note_field_observations`, `note_events`) for
both. This is the founder's 2026-08-13 ruling made concrete, not a new choice.

## 3. Options

### Option A — staged fold into the cents family (RECOMMENDED)

| Stage | What | Entry check | Exit check | Reversible by | Needs from Tom |
|---|---|---|---|---|---|
| 0 | Read-only production census: legacy notes by status, payments, every dependent table's row count, orgs holding both books, legacy notes whose balance does not re-derive from their payments to the cent. Counts only. | — | census filed | n/a | run/approve a read-only prod query (production is founder-only) |
| 1 | **Additive schema.** `acquired_notes`: `origin` NOT NULL DEFAULT `'acquired'`, `legacy_note_id integer UNIQUE NULL`, nullable origination columns (ATR record + exemption, escrow, portal token, autopay pointers, originating deal, owning entity, version, `deleted_at`); relax `acquisition_date/acquisition_price_cents` NOT NULL to a CHECK (`origin='acquired' ⇒ NOT NULL`); port the 0099 ATR CHECK as `origin='originated' AND status active ⇒ ATR or exemption`. `note_payments.legacy_payment_id`. Widen `note_field_observations.source` CHECK to admit `legacy_notes_migration`. No data moves. | census | migrations apply on staging; all existing ratchets green | drop the added columns/CHECKs | **schema approval** |
| 2 | **Dual-write.** The 7 legacy writers write the mirrored cents row in the same transaction (keyed by `legacy_note_id`). A nightly reconciliation compares count and balance per note to the cent. | stage 1 on prod | zero drift for 30 days | stop mirroring; cents rows are inert | approval to run the reconciler on prod |
| 3 | **Backfill.** Copy every legacy note and payment. Decimal → cents via `centsFromDecimal` (`shared/finance/cents.ts`), half away from zero, with a per-note rounding-residue report; **a residue is reported, never "fixed"**. Each backfilled field gets one `note_field_observations` row (`source='legacy_notes_migration'`, sourceRef = table/column/row id, as-of = migration time) so per-field provenance starts honest: "came from the legacy book on <date>", not dressed as a tape. Legacy payment history → `note_payments`; nothing is written to `note_events` (no performance is invented). | 2's exit | per-note equivalence: every legacy read reproduced from the cents rows (balance, next due, 1098 interest by year) byte-identical per org | delete the backfilled rows by `origin='originated'` (founder: customer data) | **customer-data migration approval** |
| 4 | **Read switch,** one reader at a time behind per-reader equivalence tests (old read vs new read). Order: exports/1098/1099 and Pax `get_notes` first; Finance door list; then servicing jobs; **borrower portal and payment posting last**. The `routes-finance` → `routes-notes` id dispatch collapses to one owner. | 3's exit | each reader's equivalence test green on staging data | per-reader flag back | none per reader; Tom sees the order |
| 5 | **Re-point dependents** (the ~14 integer-keyed tables of §1.1 and the polymorphic `loan_id` rows): add a nullable uuid key, fill it from `legacy_note_id`, switch readers, then drop the integer FK. Money-path tables (`ach_mandates`, `ach_debit_attempts`, `autopay_enrollments`, `borrower_payment_profiles`) go last, behaviour-preserving, each with its own proof. | 4's exit | `legacyNoteModelIsTerminal` LEGACY_WRITERS empty | restore the integer column (kept until stage 6) | approval per money-path table |
| 6 | **Retire:** rename `notes`, `payments` to `*_retired` for a hold period, then drop. | 5's exit + hold period | — | rename back (until dropped) | **drop = customer-data deletion, a founder hard-stop** |

**Table count:** −2 firm (`notes`, `payments`): 748 → 746 at stage 6. Conditional
extra candidates, each a separate decision: `trust_ledger` (0 readers, 0 writers in
the scan — already dead [ran]), `cash_flow_forecasts` (a derived cache),
`tax_escrow_payments` (could become `note_payments` escrow rows). Best case −5.

**Ratchets/tests that change:** `legacyNoteModelIsTerminal` (list shrinks to empty,
then the test is rewritten to "the legacy tables are gone and nothing names them");
`acquiredNotesDeletedOnlyByErasure*` (population grows to include originated rows —
the guard must not loosen); `table-count.json` baseline down; `schema-migrate-mirror`
per migration; `moneyCustodyHardStop`/`customerMoneyRouting` unchanged and re-run;
routes manifest when the id dispatch collapses; the 0099 ATR CHECK's replacement gets a
realdb test that `status='active'` without ATR is still refused for originated rows.

### Option B — freeze and run off

New originations (Close & Carry `POST /api/notes/from-deal`, subdivision lot sale,
CSV import) write `acquired_notes` with `origin='originated'`; existing legacy notes
service on the legacy model until they pay off, then the tables retire empty. Lowest
data-migration risk, but two books live as long as the longest seller-financed note
(often 10–30 years), every §1.5 branch stays, and the borrower portal/autopay must be
built for the cents family anyway. Table count −2, on a horizon of years.

### Option C — unified read model only

A read model (view or service) over both books; writers unchanged. Fixes Pax's
blindness and the Finance/`/notes` split for readers, but net tables **0** and B10
stays open. Do-minimum; not recommended except as stage 4's scaffolding.

**Recommendation: A**, with B's "new originations go to the cents family" landing as
soon as stage 1 exists (it stops the legacy book growing while 2–5 run).

## 4. What must NOT happen

- Losing per-field provenance, or dressing a migrated value as a tape observation.
- Resolving a disagreement or a rounding residue silently.
- Loosening the acquired-note deletion guard (#450) — it must widen to originated rows.
- Any change to who moves money or how: borrower money stays on the customer's own
  connected processor; no platform-account fallback; no new send path.
- Inventing an acquisition price/date for an originated note to satisfy a NOT NULL.
- Writing performance events for history nobody reported.
- Dropping any table holding customer data without Tom's explicit go.
- Touching Notes V2's live files (#461, #463) while they are open.

## 5. Risks

Float-era legacy balances that do not re-derive (stage 0 measures how many);
borrower-portal tokens and autopay mandates re-keyed mid-cycle (stage 5 order);
1098 interest totals shifting by rounding at the decimal→cents boundary (stage 3
equivalence per tax year); ATR CHECK semantics drifting in the port; the routes-finance
`next()` dispatch hiding a collision during the read switch; the open Notes V2 legs
widening `note_events` CHECKs (any stage-1 migration must restate 0301/0302).

## B. Note pricing engine — how it composes, and what stopped

Shipped in this draft: `shared/calculators/notePricing.ts` (pure engine) and
`server/services/economics/engines/notePricing.ts` (`EngineSpec` `note_pricing`,
`verticals: ["note_investor"]`), registered in `ALL_ENGINES`.

- **Not a duplicate of Notes V2.** #461's workout engine compares workout paths on a
  note already owned and refuses to recommend; neither PR computes a bid, a discount to
  UPB, LTV/ITV or a max bid, and neither records a bid/pass decision [read #461/#463
  diffs]. The Notes V2 package spec itself is not in the repo, so whether a later leg
  *plans* one could not be checked.
- **Shared math, written down.** The performing-note yield price is #461's hold/perform
  NPV at discount rate = target yield with no arrears; the test reproduces #461's
  independent golden lines exactly [ran]. **Follow-up 1:** on #461's merge, export one
  payment-stream function and have both engines call it.
- **Composition.** A non-performing note is refused by name; its value is #461's
  workout comparison, and a later bid desk can take a chosen path's NPV as the price
  basis.

**STOPPED — decision recording.** The kit's stores key a subject by
`subject_id integer NOT NULL` with subject types `property | opportunity | deal`
(`shared/schema/scenarios.ts`, `shared/schema/decision-snapshots.ts`); every note is
uuid-keyed (`acquired_notes.id`, `note_acquisitions.id`). No integer key exists, and
keying a note bid to its collateral property (or a deal) records the decision against
the wrong entity — and the `deal` branch of `recordDecision` does not even check the
subject exists. Options for Tom:

1. **(Recommended)** Add `subject_ref text NULL` to `scenarios` and
   `decision_snapshots` (and `outcomes`), a `note_acquisition` / `acquired_note` subject
   type, and a CHECK that exactly one of `subject_id`/`subject_ref` is set. No new table;
   decision memory can then hold any uuid subject.
2. Give `note_acquisitions` an integer surrogate column used only as the decision
   subject key. Smaller blast radius, but notes on the book need a second one.
3. Record bid/pass on the `note_events` spine like #461's runs. Not the kit, so it
   would not count for readiness or reach the Today outcome prompt; and it collides
   with Notes V2's CHECK chain.

**Surface (follow-up 2).** The natural home for a bid desk is the pipeline page
`/notes/pipeline/:id` (Finance door), which is not in the Notes V2 lane; a re-price
desk on `/notes/:id` waits for #461/#463 to merge. **Nothing can record a note
scenario or decision until the founder's subject-key decision.** The engine declares
`subjectKind: "note"`, and `recordScenario`, the only writer of the `scenarios`
table, refuses it on every subject type before it computes or inserts.
`POST /api/scenarios` answers 422 `scenario_subject_mismatch`, and the kit throws
before either write (`tests/unit/scenarioSubjectGuard.test.ts`). Because it is
registered, it is listed by `GET /api/scenarios/engines` and computed by
`POST /api/scenarios/preview`, which records nothing. No client calls either with
this engine.
*Correction 2026-11-08:* the first draft said the engine was reachable "only through
preview". The independent audit found that `POST /api/scenarios` would also have
RECORDED it against an integer property, opportunity or deal id. The guard above
closes that path.

**Other findings (follow-ups, not fixed here).** `computeYields`
(`routes-notes.ts:896`) projects YTM-at-acquisition from the ORIGINAL `termMonths`
rather than the remaining term, and its effective net yield subtracts a hard-coded
`SERVICING_BPS_DEFAULT = 25` (labelled, but a platform default the Notes V2 posture
refuses).
