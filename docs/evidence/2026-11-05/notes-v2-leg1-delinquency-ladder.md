# Notes V2 Leg 1 — delinquency ladder (2026-11-05)

Package: `claude-package-notes-v2-2026-11.md`, Leg 1. Built under founder
decision 2026-11-05 ruling 1 (Muse, standing rule): default review is an
operator act and is never derived from aging. The record is in
`docs/company/founder-decisions-2026-11-05-b1-notes-v2.md`.

**Stacked on Leg 2 (PR #461).** Both legs redefine the same `note_events` CHECK
constraints. Two PRs that each redefined them off main would let the second
merge silently drop the first one's types. Migration 0302 restates 0301 and must
apply after it.

**Traceability.** This lands gap 3's ladder half: "Saenz/Bilal delinquency ladder
(30/60/90+)", as evidence and record only.

## §3.1 stage table, as amended by ruling 1

| Ladder stage | Entry fact | Written by |
|---|---|---|
| `current` | `days_delinquent = 0` on a determinable schedule (recorded only as an exit from a past-due stage; a note that never left current has no ladder history) | aging sweep, source `aging_engine` |
| `past_due_under_30` | 1–29 days delinquent (see the gap note below) | aging sweep |
| `stage_30` | 30–59 days delinquent | aging sweep |
| `stage_60` | 60–89 days delinquent | aging sweep |
| `stage_90_plus` | 90+ days delinquent | aging sweep |
| **`default_review`** (outside the derived sequence) | **An operator records it.** It is recorded once, with the actor (`recorded_by`) and the time. **No aging run creates it at any age.** It is not a declaration of default. | operator, source `operator_recorded` (event `default_review_recorded`) |

**Gap filled conservatively, flagged for Muse.** The spec's table went from
`current` (0 days) to `stage_30` and did not say what days 1–29 are. A note ten
days past due is not current, so it gets its own factual stage,
`past_due_under_30`. If Muse prefers it folded into `current`, it is a one-line
change in `ladderStageFor` (`shared/notes/delinquency.ts`), and the boundary
tests move with it.

## Step 0 verdicts (Leg 1)

| Item | Verdict |
|---|---|
| §2.1 head and census | Stacked on #461; the next migration is 0302. No new table: the table-count ratchet holds at 748. |
| §2.3 spine extension | 0302 adds category `delinquency`, with two types each bound both ways to one source: `delinquency_stage_entered` ↔ `aging_engine` and `default_review_recorded` ↔ `operator_recorded`. The append-only triggers are untouched. 0301's and V1's shapes still validate. |
| §2.4 aging chain | The stage comes from `planNoteAging`'s own `daysDelinquent` (via `computeNoteDelinquency`, the one derivation place). The ladder re-derives no dates. The bands are unchanged: ruling 1 rejected re-banding, and `NOTE_DELINQUENCY_THRESHOLDS` and the `financeAgent.ts` mirror are untouched. The stage entry is written **inside the sweep's status transaction**, the same transaction as the status write and the `payment.missed` outbox row (the DEFECT-0114 rule). The test pinning that transaction's write list was rewritten to the new truth, not deleted, and a mutant that moves the write outside fails it. |
| §2.5 loss-mit state | The bundle reads the latest case (status, SCRA fields) and never writes it. Opening a case stays manual. |
| §2.12 consent and Pax boundaries | No borrower-communication consent grant surface exists, and the E2 packet kernel (`pending_actions`) is not touched. The ladder prepares evidence only. |
| Payments for extend-and-pretend | `note_payments` records the principal and interest split per payment, so the check uses recorded payments only. |
| Route collision found and avoided | `GET /api/notes/:noteId/delinquency` already exists for the **originated** book (`routes-va-engine.ts`, integer ids). The ladder lives at `/api/notes/:id/delinquency-ladder[...]`, so the two books never share a route. `lint:route-shadowing` caught the first draft. |

## What was built

- **`shared/notes/delinquency.ts`.** The one stage definition (`ladderStageFor`, `LADDER_STAGES`, `ladderStageEscalates`), imported by the sweep, the note page and the portfolio list.
- **`shared/notes/extendAndPretend.ts`.** The pattern from recorded payments, over a 180-day window. It is shown as numbers and labelled a pattern. Short history is "not determinable from recorded payments".
- **`server/services/notes/delinquencyLadder.ts`.** It provides:
  - stage-entry recording, idempotent, with the full input snapshot;
  - the operator's default-review act (once per note; refused on terminal notes);
  - the ladder view, which surfaces disagreement when the stored aging and the last recorded stage differ, keeping both;
  - the escalation bundle: the aging snapshot, payment history and performance reports, the collateral picture, the document completeness, scope facts (consumer purpose, dwelling, the RESPA day-36 flag, SCRA), extend-and-pretend, and the loss-mit case or "none opened".
- **`server/jobs/acquiredNoteAging.ts`.** One call per note (inside the status transaction when the aging changed), plus a `ladderStagesRecorded` count in the run summary.
- **`server/routes-note-delinquency.ts`.** `GET` ladder, `GET` bundle, and `POST` default-review. The guard is owner/admin; another org's note gets a 404.
- **`client`.** The ladder panel on the note page (timeline with tappable snapshots, a confirmed default-review dialog, and an on-request bundle), and ladder buckets on the notes list. The buckets are labelled "on this page" because the list is paginated.

## Proof

| Spec test (§7.1, as amended) | Where | Result |
|---|---|---|
| 1: boundaries | `delinquencyLadder.test.ts` (0/1/29/30/59/60/89/90/400) and `delinquencyLadder.realdb.test.ts` (the real sweep at due+0/29/30/59/60/89/90) | Stages land exactly on the boundaries, and the snapshot records the right days, paid-through and derived due date |
| 2: unknown is not late; a partial payment does not reset | realdb | An undeterminable note records no stage and states why. A partial payment leaves the stage unchanged. Paying current records the exit. |
| 3: idempotence | realdb | The same date twice appends 0 rows. Exit and re-entry append exactly the transitions. |
| 4: no-sends fence | realdb and unit | Every exported function of the legacy dunning ladder, `borrowerNotices`, `emailService` and `smsService` is wrapped and called 0 times across every sweep. The modules are loaded first, with a vacuity floor. A static import scan finds no send, dunning, notice, outbox or workflow import. |
| 5: terminal immunity | realdb | A paid-off note gains no row at 365 or 800 days |
| 6: extend-and-pretend | unit | The pattern with window math; no pattern when principal is reduced; a reversal cancelling principal counts; short history and partial-only history are not determinable |
| Ruling 1 | realdb | No default review at 1,000 days. The operator records it once, and a second attempt is refused. The DB refuses that type from `aging_engine` or `note_tape`. Terminal notes refuse. |
| 18: cross-tenant | realdb | Another org gets no ladder and no bundle, and cannot record |
| 0302 constraints | realdb | The type↔source bindings are refused in both directions, and ladder rows refuse UPDATE |

**Mutants, each caught and then restored.**
- Aging writes default review at 90+ days (rejected option b): the ruling test fails.
- The idempotence guard removed: 3 tests fail.
- The ladder calls `borrowerNotices`: the runtime spy fence and the static import fence both fail.
- The ladder write moved outside the status transaction: the DEFECT-0114 test fails.

## Gates (local, 2026-11-05, on the stacked tree)

- **Typecheck and checks.** `check:app` (tsc) exits 0, and every other step of `npm run check` exits 0 when run individually.
- **Reachability baseline lowered.** `tablesNoReader` goes 59 → 58: the bundle is the first production reader of `respa_outreach_events`. The baseline was lowered in the same commit, with a bump note.
- **`check:tests` comes from CI.** tsc is OOM-killed on this 8 GB container.
- **vitest.**
  - The affected population: 90 files and 1,630 tests (aging, note events, workout, delinquency, reachability, RESPA, route manifest) against a repo-built Postgres 16. All pass.
  - The full suite comes from CI.
- **Bundle.** **9,823 KB against the 9,823 KB ceiling: PASS with zero headroom.**
  - To make room without raising the ceiling, the Leg 2 workout panel was trimmed on #461 (−1.7 KB minified: a data-driven form and a shared class constant, same fields and copy), and the ladder panel was trimmed the same way.
  - The remaining weight is mostly the honesty copy the spec requires.
  - **The next client change anywhere fails the ceiling.** Making room is a separate trim, like the jsPDF stubs that made room before.
  - Note: CI runs the bundle check only on PRs into main, so this stacked PR is measured by CI when it is retargeted to main after #461 merges.

## Fences held

- No sends, no dispatch, no reminders, no outbox rows from the ladder.
- No automated enforcement, and no clock started against a borrower.
- No legacy dunning reuse, no money movement, no tax output, no new table.
- The ladder never opens a workout analysis or a loss-mit case (no leg triggers another).

## Staging proof (§10): owed after merge, not claimed here

1. A seeded acquired book ages through simulated dates, and the stage entries appear at the boundary days with their snapshots intact.
2. The 30+ bundle assembles with provenance visible, and one not-determinable note is shown honestly.
3. The no-sends proof: the staging outbox/comms record shows zero entries attributable to the ladder run.

**Atlas row (proposed):** "Notes — delinquency ladder present (evidence model); default review operator-recorded", added only once that proof is recorded.
