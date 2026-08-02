# Migration Cutover Plan — kill the schema-drift class permanently

> **Status: PREPARED, not executed.** This runbook needs a founder-supervised
> production window. Nothing here touches prod until you run it. Prepared during
> the Phase 0/1 charter work (audit: `docs/audit/PLATFORM-AUDIT.md` §3).

## Why this exists

Production applies schema **only** through `scripts/migrate.mjs` — an ~8,700-line
hand-appended idempotent SQL array run as the Fly `release_command`
(`fly.toml:19`). The 223 files in `migrations/` are applied by nothing; the
Drizzle journal was abandoned at `0017`. Three properties of this setup caused
the `users`-table login outages and keep the drift class open:

1. **The mirror is manual.** A `schema.ts` change with no matching hand-edit to
   `migrate.mjs` ships a column the DB doesn't have → Drizzle's full-column
   `SELECT` 500s every authenticated request. This already happened (commit
   `a4f6277c` → hotfix `1a9bc24d`, ~67-min outage).
2. **Errors are swallowed.** `migrate.mjs`'s `EXPECTED_FAILURE_PATTERNS`
   (~line 8607) downgrades `relation/column does not exist` to a non-fatal skip,
   so a statement with a missing prerequisite silently never applies — forever —
   while the release stays green.
3. **No environment can be rebuilt from the DDL.** 95 pgTable definitions have no
   CREATE in either path (they exist in prod only from Replit-era
   `drizzle-kit push`); staging/DR-from-empty lack all 95.

**Goal:** make generated Drizzle migrations the single source of truth, verified
in CI against a clean database, so "schema without migration" becomes impossible.

## Guardrails (charter §5)

- Expand-contract only. No destructive step without a tested rollback.
- The platform stays deployable at every commit.
- `migrate.mjs` is kept as a fallback for one full release before deletion.
- Every step below is reversible by the "Rollback" line under it.

## Pre-req (already true)

- `fly.staging.toml` exists → a staging app to rehearse against (the guide's
  original blocker, "no staging DB", is gone).
- `drizzle.config.ts` glob already includes `shared/schema.ts` + `shared/schema/*.ts`.
  **Add `shared/models/*.ts`** to the glob first (the `users` table lives there and
  is currently outside drizzle's introspection scope) — see step 1.

## Steps

### 1. Bring the schema fully into drizzle's scope (safe, no prod)
- Add `./shared/models/*.ts` to `drizzle.config.ts` `schema`.
- Run `npm run db:generate` locally against an empty DB to confirm drizzle sees
  all 748 tables (matches `scripts/schema-files.mjs`, which Wave 5 already unified).
- **Rollback:** revert the config line.

### 2. Snapshot production schema (read-only)
- `pg_dump --schema-only $PROD_DATABASE_URL > prod-schema-snapshot.sql`.
- Load it into the staging DB: `psql $STAGING_DATABASE_URL < prod-schema-snapshot.sql`.
- Staging now mirrors prod's ACTUAL schema (including the 95 push-only tables).
- **Rollback:** none needed (read-only on prod).

### 3. Regenerate the Drizzle journal from reality (staging only)
- `drizzle-kit introspect` against the staging DB → a baseline migration + fresh
  `migrations/meta/_journal.json` that matches what prod actually has.
- Commit this as the new migration baseline (`0000_baseline` semantics), on a
  branch, reviewed.
- **Rollback:** discard the branch.

### 4. Prove `drizzle-kit migrate` is a NO-OP on staging
- Against the introspected staging DB, `drizzle-kit migrate` must apply nothing
  (schema already matches). If it wants to change anything, the introspection is
  incomplete — fix before proceeding.
- **This is the go/no-go gate.** Do not continue until it is a clean no-op.

### 5. Add the boot-and-SELECT CI job (see below) BEFORE switching prod
- Enable `.github/workflows/migration-boot-check.yml` (prepared, currently
  manual-trigger only). It boots a clean pgvector, runs the generated migrations,
  boots the server, and `SELECT`s one row per pgTable — failing on any orphan.
- Fix orphans until green (this converts the 95-orphan baseline into a burn-down).
- **Rollback:** the job is additive; disable it.

### 6. Flip the release command (the actual cutover — prod window)
- Change `fly.toml` `release_command` from `node scripts/migrate.mjs` to the
  generated-migration apply (`npx drizzle-kit migrate` or a thin wrapper).
- Keep `migrate.mjs` in the tree, unreferenced, for ONE release as fallback.
- Deploy to **staging first**, watch a full release cycle, then prod with you
  watching `flyctl logs`.
- **Rollback:** revert `fly.toml` to `node scripts/migrate.mjs` and redeploy —
  `migrate.mjs` is idempotent, so this is safe at any point.

### 7. Delete the expected-failure patterns (same release, after green)
- Remove `EXPECTED_FAILURE_PATTERNS` so a missing relation/column FAILS the
  release loudly instead of silently skipping. With generated migrations this can
  no longer legitimately fire.
- **Rollback:** revert the deletion.

### 8. Retire `migrate.mjs` (a release later, once prod is stable)
- Delete `scripts/migrate.mjs` and the `[no-migrate-mirror]` bypass + the
  presence-only `migrate-mirror-check.yml` (now obsolete — the boot-check
  supersedes it).
- Lower `BASELINE_ORPHANS` in `tests/unit/schemaMigrationDrift.test.ts` to 0.
- **Rollback:** restore from git history (the file is idempotent).

## Definition of done

- Prod deploys via generated migrations; `migrate.mjs` gone.
- The boot-and-SELECT CI job is a required check.
- `BASELINE_ORPHANS` = 0; a `schema.ts` change with no migration fails CI.
- `docs/INVARIANTS.md` INV-SCHEMA-1 gap updated to "closed".
- The drift class that caused the users-table outages is provably impossible.

## What needs YOU

- A production window (~30–60 min) to watch steps 4/6.
- Confirmation of the staging + prod `DATABASE_URL`s (fly secrets) for the
  rehearsal.
