# Gates log — scheduler double-boot fix (2026-10-30)

Branch `claude/scheduler-double-boot-fix`, based on main `58d1a9b`. Code commit `92885d1`.
Every verdict was read from a redirected file and its exit status, never through a pipe.

| Gate | Result |
|---|---|
| `npm run check` | exit 0 (first run failed `run-scheduled-jobs-linecount` at +71 lines; fixed by carving the guard and janitor into `server/jobs/scheduledJobsBoot.ts`, file now 5588 lines, baseline lowered 5594 -> 5588; re-run exit 0) |
| `npm run build` | exit 0 |
| `npm run db:build-from-repo` | PASS, 752 tables (local Postgres 16 plus pgvector; a first run without pgvector failed only on `solene_embedded_records`) |
| Real-DB tests (`ACREOS_REAL_DATABASE_URL` + `ACREOS_REQUIRE_REAL_DB=1`) | 24 files, 85 tests passed, none skipped |
| `npm test` (full vitest) | exit 0; 1539 files passed, 34 skipped; 19229 tests passed, 159 skipped; 0 failed |

## Acceptance tests (named in the package)

- `runScheduledJobs is idempotent in one process` — `tests/unit/runScheduledJobsIdempotent.test.ts`
- `scheduleSelfRescheduling refuses a duplicate name` — `tests/unit/schedulerRefusesDuplicateName.test.ts`
- `importing jobQueue does not boot the server` — `tests/unit/importingJobQueueDoesNotBootServer.test.ts` (fresh child process; also covers `dbBackup.ts`)
- `run-now route respects the job lock` — `tests/unit/etlRunNowRespectsJobLock.test.ts`
- `janitor registers exactly once across placements` — `tests/unit/janitorRegistersExactlyOnce.test.ts`
- Extra: `tests/unit/workerBootNamesIndexSideEffects.test.ts`

## Falsification (each fix undone on purpose, matching test went red, fix restored)

runScheduledJobs guard off; scheduler duplicate guard off; jobQueue importing `../index` again; run-now lock off; run-now using a process-wide holder id; janitor registered again in `routes.ts`; worker no longer calling the bootstrap.

## NOT verified here

Package verification criteria 1-5 need the fix deployed to staging and observed over 2 poll days (`job_runs` counts, single `etl_runs` rows, worker no longer on :5000, singles still single, two concurrent run-now calls). None of that was run. Criterion 6 is this file.
