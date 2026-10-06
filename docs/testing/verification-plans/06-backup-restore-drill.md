# Plan 6 — Backup and restore drill

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Restore the production database to a separate target, from the hosting
provider's backups, to a chosen point in time; boot the app against it;
confirm the data and the app are sound; and measure recovery time (RTO) and
data-loss window (RPO) against the targets in `docs/disaster-recovery.md`.
Also exercise a migration rollback, which the campaign named as unexercised.

## Alignment with existing documents

This plan executes, and does not replace, the procedures already written:

- **`docs/disaster-recovery.md`** — the plan of record. States RTO **4 hours**
  and RPO **1 hour** for all services (critical: auth, payments); daily
  automated snapshots via Fly Postgres with 7-day retention; a restore using
  `flyctl postgres restore --restore-time`; and a testing schedule of a
  monthly restore to staging and a quarterly full drill.
- **`docs/runbooks/dr-drill-quarterly.md`** — the drill cadence and
  measurement template (first Tuesday of January / April / July / October).
- **`docs/runbooks/07-database-restore-from-snapshot.md`** — side-by-side
  restore from Fly volume snapshots; its header states that no full timed
  restore drill has been executed.
- **`docs/reliability/dr-runbook-postgres-restore.md`** — restore from the
  portable `pg_dump` artifact produced by `server/jobs/dbBackup.ts` to
  `DB_BACKUP_S3_BUCKET`, plus the `scripts/migrate.mjs --dry-run` schema gate.
  Its local mechanism drill is recorded there; its own text says the S3 fetch
  and realistic timings were not exercised.
- **`docs/runbooks/dr-drill-history.md`** — the append-only drill log, which
  currently records no drills; and the `dr_drills` table (`shared/schema.ts`)
  read by `/api/jobs/health`.
- `server/jobs/backupRestoreVerify.ts` — the weekly automated restore-to-
  scratch parity check; it proves a dump is restorable, not a production
  cutover RTO.

## Inconsistencies to resolve before the drill (founder to decide)

These are differences between existing documents. The drill cannot pass or
fail cleanly until each is settled:

1. **Targets.** `docs/disaster-recovery.md` says RTO 4 h / RPO 1 h.
   `docs/runbooks/dr-drill-quarterly.md` says total RTO ≤ 45 min and RPO
   24 h ("snapshot ≤ 24h old"). One must be chosen as the drill's target.
2. **PITR or snapshots.** `docs/disaster-recovery.md` shows a point-in-time
   restore command; runbook 07 describes daily volume snapshots. A 1-hour RPO
   requires true point-in-time recovery (continuous WAL archiving); daily
   snapshots alone give up to a day. Which the current hosting tier actually
   provides must be confirmed in the provider's console before the drill.
3. **Names.** The Postgres app is called `acreos-db` in
   `docs/disaster-recovery.md` and the quarterly drill, and `acreos-pg` in
   runbook 07. Confirm the real name.
4. **Post-restore schema step.** `docs/disaster-recovery.md` step 4 runs
   `npm run db:push`; production's `fly.toml` runs `node scripts/migrate.mjs`
   as its release command. The drill should use the production path
   (`scripts/migrate.mjs`, with `--dry-run` first), and the plan of record
   should be corrected to match.

## Why the campaign could not cover it

The campaign had no access to the hosting provider, the production database,
its backups or the backup bucket. It restarted a local Postgres; it did not
restore anything.

## Environment and prerequisites

- Access to the hosting provider's Postgres backups for production (read-only
  listing is the only production touch in this plan).
- A **throwaway restore target** — a new Postgres app or cluster that receives
  no production traffic — and a throwaway app deployment pointed at it, both
  destroyed afterwards.
- Secrets by name: `DATABASE_URL` for the restore target (never the
  production value in any shell used for the drill), `DB_BACKUP_S3_BUCKET`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` for the dump path,
  `FLY_API_TOKEN` for the operator.
- A stopwatch and the measurement template from
  `docs/runbooks/dr-drill-quarterly.md`.
- Two people, per runbook 07 ("two-person flow").
- **Customer-data handling:** the restored copy contains customer data. It
  stays inside the same provider and region, is not downloaded to laptops, and
  is destroyed at the end (recorded in the run log).

## Procedure

1. **Choose the restore point.** Pick a timestamp T (for PITR) or the latest
   snapshot (if not). Before starting, note a sentinel: the newest row in a
   high-churn table (e.g. the latest `audit_events.created_at`) at or before T.
2. **Path A — provider restore.** Restore production's backup to the
   throwaway target per runbook 07 (side-by-side) or the PITR command in
   `docs/disaster-recovery.md`, as decided above. Start the stopwatch at
   "decision to restore".
3. **Schema gate.** `DATABASE_URL=<target> node scripts/migrate.mjs --dry-run`;
   record its verdict, including any statements it reports as not validated.
4. **Boot.** Deploy a throwaway app against the target with outbound sending,
   billing and scheduled jobs **disabled** so the copy cannot email, charge or
   act on real customers.
5. **Check the data.** Row counts on `organizations`, `users`, `deals`,
   `financial_ledger` and `payments`, compared with production counts taken
   at T; the sentinel row present; nothing newer than T present.
6. **Check the app.** Sign in as a staff test account; open each customer door
   read-only; run `/api/founder/synthetic-checks/run` as the quarterly drill
   specifies; write and read back one sentinel row.
7. **Path B — portable dump.** Repeat steps 2–5 from the latest `pg_dump`
   object in `DB_BACKUP_S3_BUCKET` per `docs/reliability/dr-runbook-postgres-restore.md`,
   including the S3 download that its local drill did not exercise. Confirm
   the bucket's lifecycle rule exists, as that runbook asks.
8. **Migration rollback.** On the throwaway target, apply the newest
   migration, then roll back per `docs/rollback.md` and
   `docs/runbooks/db-migration-failed.md`; confirm the app boots on the
   rolled-back schema.
9. **Tear down** every throwaway resource; record that it was destroyed.
10. **Record** the drill in `docs/runbooks/dr-drill-history.md` using its
    format, and insert the matching `dr_drills` row.

## Pass criteria

- Restore completes and the app boots against the copy with steps 5 and 6
  clean.
- Measured RTO (decision to restore → app green on the copy) is within the
  RTO target the founder chose above.
- Measured RPO (T minus the newest recoverable write) is within the RPO
  target the founder chose above.
- The copy sent no email, SMS, mail or charge (provider dashboards checked).
- Every throwaway resource is destroyed.
- **Fail:** restore cannot complete; data is missing or inconsistent; the
  schema gate blocks a correct restore without explanation; either target is
  missed; the copy caused any outbound effect.

## Results

Not yet run.

## Still owed

- An owner and a date.
- Founder decisions on the four inconsistencies above.
- Confirmation from the provider console of the backup type, retention and
  whether PITR is enabled.
- A correction to `docs/disaster-recovery.md` once the decisions are made
  (out of scope for this plan file).

## Run log

_(empty — append entries per the format in [README](README.md); also append
to `docs/runbooks/dr-drill-history.md`)_
