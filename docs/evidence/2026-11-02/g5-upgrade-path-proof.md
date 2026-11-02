# G5 upgrade-path proof — 2026-11-02

**Result: GREEN.** A database built at `58d1a9b7` upgrades through the current
`scripts/migrate.mjs` to the same schema as a fresh build of current main. The
upgraded-vs-fresh diff is EMPTY, under both normalizations, for both upgrade
entries.

| | |
|---|---|
| Workflow | `.github/workflows/g5-proof.yml` (PR Thmsnrtn/AcreOS#438) |
| Run | https://github.com/Thmsnrtn/AcreOS/actions/runs/41401168690 — conclusion **success**, 2026-11-02 06:38–07:04 UTC (01:38–02:04 EST) |
| Base ref (old install) | `58d1a9b7beca4a94fe8c08f020da4637b6cf1039` (the 2026-10-30 fresh-install proof base) |
| Current ref (under test) | `833f88f21fab9a2cd75d57f223c76e6ec7b1c499` = main `b539f15d` + this workflow file only (`git diff --stat b539f15 833f88f` → `.github/workflows/g5-proof.yml` only) |
| Commits between | 12; migrations added between them: `0296_tax_v1_events_clock_gates.sql`, `0297_tax_v1_bid_discipline.sql`, `0300_note_observations_edit_source.sql` |
| Postgres | `pgvector/pgvector:pg16` service, the same image as the real-DB suites; pg_dump 16 |

## Table counts (the census's physical read: `public`, relkind r/p, no partitions)

| Snapshot | Tables | Normalized DDL lines |
|---|---|---|
| base (`58d1a9b7`, its own `npm run db:build-from-repo`) | 752 | 21,864 |
| upgraded, after `node scripts/migrate.mjs --ddl-only` (the staging reconcile entry) | **752** | 21,890 |
| upgraded, after `node scripts/migrate.mjs` (the production release_command) | **752** | 21,890 |
| fresh (current `npm run db:build-from-repo`, a second database) | **752** | 21,890 |

The table count did not change between base and current. The three migrations
in between add columns, constraints and triggers, not tables. The upgrade did
real work: the normalized DDL grew by 26 lines, from 21,864 to 21,890, and
landed exactly on the fresh build.

## The verdict lines (from the run log)

```
[migrate] --ddl-only: applying 2011 schema statement(s); skipping 113 data statement(s)
[migrate:dry-run] complete — 2117 ok, 0 skipped (missing prereq), 7 not validated (non-transactional), 0 would-fail
[g5] upgraded-ddl-only vs fresh (census): EMPTY DIFF
[g5] upgraded-ddl-only vs fresh (ddl): EMPTY DIFF
[g5] upgraded vs fresh (census): EMPTY DIFF
[g5] upgraded vs fresh (ddl): EMPTY DIFF
[g5] 7 real-database script(s) passed on the upgraded database
[g5] 41 vitest file(s) import tests/helpers/realDb
[g5] vitest: 199 total, 199 passed, 0 failed, 0 skipped/todo, 93 suites
```

The base build at `58d1a9b7` and the fresh build at the current ref each ended
`[build-schema] PASS`. They tolerated 162 and 174 base-layer statement errors
respectively, as the build script expects.

## Normalizations

- **census:** `T <table> <constraint count> <trigger count>` per table, sorted.
  This is the same physical read `scripts/staging-schema-census.ts` consumes.
- **ddl:** `pg_dump --schema-only --no-owner --no-privileges`. Comments, blank
  lines, `SET` and `set_config` lines, and pg_dump's per-run `\restrict`
  tokens are dropped. Each line is trimmed and loses its trailing comma, then
  the lines are sorted.

**Falsified locally (PG 16.15, the workflow's own snapshot helper, size floor disabled for toy databases):**

- Two databases with the same table, built with columns in a different order
  (`CREATE … ADD COLUMN` versus inline): EMPTY diff, as intended. The upgrade
  path appends columns.
- A database missing one column: the diff is NON-EMPTY (`< y integer`).

**Known blind spot of a sorted-line diff:** a line moved between two objects
with no other change would not show. The census half covers the per-table
constraint and trigger counts.

## How it was run, honestly

The spec asked for a `workflow_dispatch` from the PR branch. That was not
possible:

- GitHub refuses to dispatch a workflow that is not on the default branch
  (`gh workflow run` → `HTTP 404: workflow g5-proof.yml not found on the
  default branch`).
- The session's GitHub integration also lacks Actions write
  (`403 Resource not accessible by integration`).

So one temporary commit (`833f88f2`) added a `push:` trigger limited to this
branch, with `base_ref` defaulting to `58d1a9b7`. It ran the identical job, and
the next commit reverted it. The merged file is `workflow_dispatch` only and is
byte-identical to the first commit (`3465763f`).

After merge, the workflow becomes dispatchable from the Actions tab or with
`gh workflow run g5-proof.yml -f base_ref=<sha>`.
