# Runbook 09 — Off-provider backup, and a restore you can prove

**Severity:** P0 tool (use during a total data event), P3 routine (run on a schedule)
**Owner:** Founder
**Scripts:** `scripts/db-backup.sh`, `scripts/db-restore.sh`

Runbook 07 restores a **Fly volume snapshot**. Those snapshots live with Fly: lose the
provider, the account or the region, and you lose them too. This runbook keeps a
portable `pg_dump` **somewhere that is not Fly**, and restores it with a check that
every table came back with every row.

## Back up

```bash
# From any machine that can reach the database (fly proxy 5432 -a acreos-pg works).
export DATABASE_URL='postgres://…'                    # never on the command line
export BACKUP_DEST='s3://<bucket>/acreos-db'          # an S3-compatible bucket NOT on Fly
# For Cloudflare R2 / Backblaze B2 also: export AWS_ENDPOINT_URL=https://…
scripts/db-backup.sh /tmp/acreos-backups
```

It writes `acreos-<UTC>.dump` (pg_dump custom format) and `acreos-<UTC>.manifest.json`
(the dump's sha256 and the exact row count of every public table), and copies both to
`BACKUP_DEST`. Without `BACKUP_DEST` it says so: a backup on the same machine is not
off-provider. `rclone:remote:path` works too.

**🔑 Founder action:** choose and create the off-provider destination (a bucket in an
account that is not Fly's), give the backup host write-only credentials for it, and
schedule the script (a daily cron on a machine you control, or a GitHub Actions
workflow with the bucket credentials as secrets). Until then nothing leaves Fly.

## Restore

```bash
export RESTORE_URL='postgres://…/acreos_restore'     # a NEW database; created if missing
scripts/db-restore.sh s3://<bucket>/acreos-db/acreos-<UTC>.dump
```

It refuses, before writing anything, a dump whose sha256 differs from its manifest and a
target database that already has tables (a restore is never merged into live data).
It then runs `pg_restore` and counts every table again: any missing table or different
count fails the restore, table by table.

Promote the restored database the way runbook 07 describes (swap `DATABASE_URL`,
restart, verify).

## Proof that it works

- CI: `scripts/ci/build-schema-from-repo.sh` step 10 backs up the freshly built schema and
  restores it into a fresh database on every run; a mismatch fails the build.
- 2026-10-09, a throwaway database (`acreos_w1a`, 731 tables, 2,621 rows): backup, restore
  into a fresh database, every count matched. The negative cases each failed as they
  should: restore into a non-empty database, a dump with one byte appended (sha256
  mismatch), a manifest one lead larger than the dump (`leads: backup 2501, restored 2500`),
  a missing manifest, an unknown destination scheme. The throwaway databases were dropped.

This is still not a timed production drill. Run it once against a real production dump,
record the wall time in the RTO table in runbook 07, and keep the result.
