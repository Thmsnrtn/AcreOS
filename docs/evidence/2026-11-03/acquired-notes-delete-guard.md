# Acquired notes are deleted only by org erasure — guard (2026-11-03)

Branch `claude/acquired-notes-delete-guard`, off main `29a17553`. Decisions:
`docs/company/founder-decisions-2026-11-03-notes.md`.

## Delete-path sweep (package step 1)

Population: every non-test source file under `server/`, `shared/`, `scripts/`,
`packages/`, `apps/`, `migrations/`, plus the client's DELETE callers. Shapes:
literal SQL `DELETE FROM`/`TRUNCATE`, Drizzle `.delete()`, `organizations`-row
deletes (whose FK cascades into `acquired_notes`), `TRUNCATE … CASCADE`, and
computed-table deletes. The live FK graph was measured on a database built from
this repo.

| Path | Reaches `acquired_notes`? | Class |
|---|---|---|
| `server/services/orgDeletion.ts` `deleteOrganization` (D2/#412) | Yes: tenant-key sweep plus the org-row delete | **Org erasure.** Intentionally unchanged; stays a hard delete |
| `DELETE /api/notes/:id` (`routes-finance.ts` → `storage.deleteNote`), client `useDeleteNote` on the Finance page | No: the legacy integer `notes` table; a uuid id gets a 400 | Not an acquired-note path |
| `POST /api/clear-demo-data` → `orgDataClear.clearOrganizationRecords` | No: it deletes only the NO ACTION/RESTRICT blockers of its roots, and `acquired_notes` → properties/leads is SET NULL (`confdeltype = n`). Proven by running it | Not an acquired-note path |
| `importExport.importNotesFromCSV` rollback | No: it deletes the lead and the activity row it created; the note written is a legacy `notes` row | Not an acquired-note path |
| `DELETE /api/note-acquisitions/:id`, `DELETE /api/note-splits/:id` | No: `note_acquisitions` and `note_ownership_splits` hold no cascading FK into `acquired_notes` | Not an acquired-note path |
| `server/jobs/dataRetention.ts`, `server/jobs/archival.ts`, `scripts/data/delete-orphan-photo-and-vision-rows.ts` | No: the table lists are literal in each file and none names it | Not an acquired-note path |
| `scripts/seed-test-borrower.mjs` cleanup, `scripts/founder-autonomy/reset-cohort.ts` | Yes, by org-row cascade, but only for synthetic orgs (a fixed fixture slug; `sim-*` gated by `SIMULATION_MODE`) | **Anything else.** Reported and left unchanged |
| `migrations/0020_clerk_migration.sql` `TRUNCATE users CASCADE` | No: `migrations/*.sql` run only in an empty-database build, before 0073 creates the table; deploy and staging run `migrate.mjs` | Reported and left unchanged |

**Result:** there is no user-facing hard delete of an acquired note to convert.
Per the 2026-11-03 decision, there is no migration and no soft-delete service;
the change is a guard.

## Live FK graph (database built from this repo, local Postgres 16)

`acquired_notes` as child: organizations `c` (CASCADE), properties `n` (SET NULL),
leads `n` (SET NULL).
Into `acquired_notes`, all CASCADE: note_payments, note_ownership_of_record,
note_field_observations, note_events, note_assignments, note_ownership_splits,
note_loss_mit_cases.

The local build reported one table it could not create, `solene_embedded_records`.
It needs pgvector, which this sandbox's Postgres lacks; CI uses the pgvector image.
That table is unrelated to notes.

## Mutation proof

`acquired-notes-delete-guard-mutants.log`: 11 mutants, all red. Each was
restored, and the baseline was 38/38 green.

- Direct Drizzle delete in `routes-notes.ts`.
- An aliased import in a new service.
- Raw SQL in a new script.
- An unregistered org-row delete.
- An unregistered computed-table delete.
- `acquired_notes` added to the retention list.
- `acquired_notes` added to `CLEAR_ROOT_TABLES`, caught statically and on the live DB.
- The live FK changed to NO ACTION. The real "Clear data" run deleted the note, and the test went red.
- The live FK changed to CASCADE.
- A stale register entry: orgDeletion no longer deleting the org row.

## Gates (local, verdicts read from files)

See the PR body for the counts. `npm run check:tests` cannot complete in this
8 GB sandbox: tsc is killed (137) at its 6 GB heap, alone and with Postgres
stopped. The two new files typecheck with zero diagnostics under
`tsconfig.tests.json`. The CI Test job is authoritative for that step.
