# Founder decisions — 2026-11-03 (acquired-note deletion and the note ledgers)

## 1. Deleting an acquired note is a soft delete

**Decision (Tom, 2026-11-03):** soft-delete acquired notes. A deleted note is
flagged, its row and its full ledger history (`note_field_observations`,
`note_events`) are kept, and the deletion is reversible.

**Why it came up.** The G11 fidelity re-run (2026-11-01) confirmed from
`pg_constraint` that both ledgers reference `acquired_notes(id)` ON DELETE
CASCADE. The ledgers refuse UPDATE and TRUNCATE, but a hard delete of the note
row removes its whole provenance and calendar history with it.

**Options that were offered.** RESTRICT on the ledger FKs, and a deletion-ledger
archive. Both were rejected; soft delete was the recommendation and was chosen.

**Unchanged.** Org erasure (`deleteOrganization`, D2/#412) stays a hard delete:
total erasure, including the ledgers, is its legal purpose.

## 2. With no deletion surface yet, ship only the guard

**Decision (2026-11-03, answered on Tom's behalf under his standing delegation
for working-session questions):** no schema change, no soft-delete service and
no new delete route. Ship only a ratchet that fails when any code other than
org erasure can delete `acquired_notes`.

**Why.** The delete-path sweep for decision 1 found no product path that deletes
an acquired note:
- `DELETE /api/notes/:id` and the Finance page's delete button act on the legacy
  integer `notes` table. A uuid acquired-note id is refused with a 400.
- Settings "Clear data" (`clearOrganizationRecords`) deletes only tables that
  block its roots through NO ACTION/RESTRICT foreign keys. `acquired_notes`
  references `properties` and `leads` with SET NULL, so it is never in that set.
  Running it against a built database proves this.
- The only other `organizations`-row deleters are two dev scripts that tear down
  synthetic orgs: the test-borrower fixture and the `sim-*` cohort.

Building `deleted_at` now would have shipped a soft-delete function with no
caller. The guard makes the first hard-delete path fail instead, so when an
acquired-note deletion is built, decision 1 governs it.

**Options that were offered.** Build it as written (migration 0301, a service
with no caller). Build it plus a new delete route, a new customer action. Stop
and report only.

**Enforcement.** `tests/unit/acquiredNotesDeletedOnlyByErasure.test.ts` (source
population) and `tests/unit/acquiredNotesDeletedOnlyByErasure.realdb.test.ts`
(the live FK graph and the real "Clear data" and erasure runs).
