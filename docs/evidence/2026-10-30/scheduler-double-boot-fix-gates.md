# Gates log — scheduler double-boot fix (2026-10-30)

Branch `claude/scheduler-double-boot-fix`, rebased onto main `b7558ad` (first built on `58d1a9b`). Gates re-run on 2026-11-02 at tree `3509a17` (code commit `e6b3a1d`); the commit that records this file changes only this file, so the code measured is the code pushed.
Every verdict was read from a redirected file and its exit status, never through a pipe.

| Gate | Result |
|---|---|
| `npm run check` | exit 0; `run-scheduled-jobs-linecount` PASS at 5588 (baseline 5588; lowered from 5594 in the first run after carving the guard and janitor into `server/jobs/scheduledJobsBoot.ts`) |
| `npm run build` | exit 0 |
| `npm run db:build-from-repo` | PASS, 752 tables, 842 rows, every count matches the manifest (local Postgres 16 plus pgvector) |
| Real-DB tests (all 26 `*.realdb.test.ts`, `ACREOS_REAL_DATABASE_URL` + `ACREOS_REQUIRE_REAL_DB=1`) | exit 0; 26 files, 117 tests passed |
| `npm test` (full vitest, real-DB env set as in CI) | exit 0; 1586 files passed; 19497 tests passed, 1 skipped; 0 failed |

First run (base `58d1a9b`, code commit `92885d1`), kept for history: check exit 0, build exit 0, db build PASS 752 tables, real-DB 24 files / 85 tests, `npm test` 1539 files / 19229 tests passed, 0 failed.

## Acceptance tests (named in the package)

- `runScheduledJobs is idempotent in one process` — `tests/unit/runScheduledJobsIdempotent.test.ts`
- `scheduleSelfRescheduling refuses a duplicate name` — `tests/unit/schedulerRefusesDuplicateName.test.ts`
- `importing jobQueue does not boot the server` — `tests/unit/importingJobQueueDoesNotBootServer.test.ts` (fresh child process; also covers `dbBackup.ts`)
- `run-now route respects the job lock` — `tests/unit/etlRunNowRespectsJobLock.test.ts`
- `janitor registers exactly once across placements` — `tests/unit/janitorRegistersExactlyOnce.test.ts`
- Extra: `tests/unit/workerBootNamesIndexSideEffects.test.ts`

## Falsification (first run, base `58d1a9b`: each fix undone on purpose, matching test went red, fix restored)

runScheduledJobs guard off; scheduler duplicate guard off; jobQueue importing `../index` again; run-now lock off; run-now using a process-wide holder id; janitor registered again in `routes.ts`; worker no longer calling the bootstrap.

## NOT verified here

Package verification criteria 1-5 need the fix deployed to staging and observed over 2 poll days (`job_runs` counts, single `etl_runs` rows, worker no longer on :5000, singles still single, two concurrent run-now calls). None of that was run. Criterion 6 is this file.
