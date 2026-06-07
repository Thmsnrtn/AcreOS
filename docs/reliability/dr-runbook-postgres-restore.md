# DR Runbook — Postgres Restore (and migrate dry-run gate)

**Owner:** Tess (SRE) / Iris (CTO)
**Last updated:** 2026-06-06
**Status:** Phase 0 — written before customer #1. Restore steps verified-by-construction; **measured RTO is a placeholder until the first live drill** (see below).

> A backup nobody has restored is a hope, not a recovery plan. Customer #1's
> deals, `financial_ledger`, and signed docs live in Postgres. Losing them is
> existential; a 6-hour fumbling restore at 2am is nearly as bad. This runbook
> turns an unbounded risk into a known procedure.

---

## What we back up, and where

`server/jobs/dbBackup.ts` runs `pg_dump --no-owner --no-acl` and uploads to
**real object storage** via the AWS SDK (`@aws-sdk/client-s3`, `PutObjectCommand`
with `ServerSideEncryption: AES256`), keyed `database-backups/<year>/acreos-backup-<ts>.sql`.

- **Prod path (object storage):** active when `DB_BACKUP_S3_BUCKET` is set
  (plus `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`). Confirm
  with: `fly secrets list -a acreos | grep DB_BACKUP_S3_BUCKET`.
- **Dev/console fallback:** if `DB_BACKUP_S3_BUCKET` is unset, OR an upload
  throws, the dump is left on local tmp and logged as `local:<path>` — it is
  **not** durable. A `local:` destination in the backup log is an alarm: prod is
  not actually backing up off-box. Treat it as a Sev-2.
- **Retention:** the code keeps "last 30 days" by intent, but deletion of old
  objects is via an **S3/B2 lifecycle rule that must be configured on the bucket
  in the provider console** — it is not enforced in code. **Action item:** verify
  the lifecycle rule exists (`aws s3api get-bucket-lifecycle-configuration
  --bucket "$DB_BACKUP_S3_BUCKET"`); if it returns nothing, the bucket grows
  unbounded and old encrypted dumps never expire.

Fly Postgres also takes its own volume snapshots; the `pg_dump` artifact is the
portable, provider-independent copy and is what this runbook restores from.

---

## Restore procedure (into a throwaway target — never restore over prod blindly)

```bash
# 0. Identify the latest dump.
aws s3 ls "s3://$DB_BACKUP_S3_BUCKET/database-backups/$(date +%Y)/" | sort | tail -5

# 1. Pull it down.
aws s3 cp "s3://$DB_BACKUP_S3_BUCKET/database-backups/2026/acreos-backup-<ts>.sql" /tmp/restore.sql

# 2. Stand up a THROWAWAY target. Options:
#    (a) local: createdb acreos_restore_check
#    (b) staging Fly Postgres: fly pg create --name acreos-restore-drill ... (destroy after)
#    Set RESTORE_URL to the throwaway target's connection string.

# 3. Restore. (pg_dump produced a plain-SQL file → psql, not pg_restore.)
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -f /tmp/restore.sql

# 4. Smoke-verify the load: row counts on the load-bearing tables.
psql "$RESTORE_URL" -c "SELECT
  (SELECT count(*) FROM organizations)     AS orgs,
  (SELECT count(*) FROM deals)             AS deals,
  (SELECT count(*) FROM financial_ledger)  AS ledger_rows,
  (SELECT count(*) FROM users)             AS users;"

# 5. Schema sanity: run the migrate dry-run against the restored DB (see below).
DATABASE_URL="$RESTORE_URL" node scripts/migrate.mjs --dry-run

# 6. App sanity (optional but recommended):
DATABASE_URL="$RESTORE_URL" npm run check

# 7. Tear down the throwaway target.
#    dropdb acreos_restore_check    # or: fly apps destroy acreos-restore-drill
```

### Measured RTO — **PLACEHOLDER, fill on first drill**

| Step | Target | Measured (drill date: ____) |
|------|--------|------------------------------|
| Locate + download latest dump | < 2 min | ____ |
| Restore via `psql` | depends on DB size | ____ |
| Smoke verify (row counts) | < 1 min | ____ |
| **Total RTO** | **< 30 min goal** | **____** |
| **RPO** (max data loss) | ≤ backup interval | = backup cron cadence |

Run the drill once by hand, time each step, and replace the blanks. Until then,
RTO is unproven.

---

## `migrate.mjs --dry-run` / `--check` (pre-deploy schema gate)

`scripts/migrate.mjs` is the Drizzle-bypass idempotent patcher run as the Fly
`release_command`. One bad statement against a real customer DB with no rehearsed
restore is the nightmare scenario. The dry-run mode de-risks it:

```bash
DATABASE_URL=<snapshot-or-replica> node scripts/migrate.mjs --dry-run
```

- Runs the entire `STATEMENTS` batch inside a transaction and **ROLLBACKs** — it
  validates every CREATE/ALTER/INDEX against the live schema **without persisting
  anything**, so it is safe against a snapshot/replica (or even prod).
- Exit `0` = all statements valid (or only expected-missing-dependency skips);
  exit `1` = at least one statement would fail unexpectedly → **do not deploy**.
- Recommended pipeline: restore the latest dump into a throwaway DB, run
  `--dry-run` against it, and only proceed to the real `release_command` on exit 0.

---

## Monthly automated restore-verify (idea — to wire when capacity allows)

A backup that silently corrupts is worse than none, because we'll trust it.
Add a **monthly** worker job (same `withJobLock` + `job_runs` pattern as
`dataSourceProbe`) that:

1. Downloads the latest dump from object storage.
2. Restores into an ephemeral throwaway DB (local temp PG in the worker, or a
   short-lived Fly PG).
3. Runs the step-4 row-count asserts; fails if any load-bearing table is empty
   or the restore errors.
4. Runs `migrate.mjs --dry-run` against the restored DB.
5. Writes pass/fail to a `restore_verify` log / `system_alerts` on failure, and
   tears the throwaway DB down.

This surfaces a silently-corrupt backup *before* we need it. It is not wired yet
(Phase 0 cost/complexity); this runbook is the manual stand-in until then.

---

## Quick checklist (the half-page version)

- [ ] `DB_BACKUP_S3_BUCKET` set in Fly secrets (backups go to durable storage, not `local:`).
- [ ] Bucket lifecycle/retention rule configured in the provider console.
- [ ] Latest dump exists and is < 1 backup-interval old.
- [ ] Restore drill run at least once; RTO table above filled in.
- [ ] `migrate.mjs --dry-run` is part of the pre-deploy gate.
