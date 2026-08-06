# Runbook 07 — Database restore from snapshot (Fly Postgres)

**Severity:** P0 — Total data event
**Owner:** Founder + engineering, two-person flow
**Time to first response:** 15 min

> **DR readiness (corrected 2026-08 audit, F-13-2):** No full timed restore drill has ever been executed — RTO/RPO are UNPROVEN. The only related artifact, `docs/archive/exhaustive-completion/elite-team-deeper-2026-05-01/boniface-dr.md`, is a **tabletop audit, not a drill**; its own verdict is "AcreOS has backups but no demonstrated restore." The weekly automated `backupRestoreVerify` job proves a backup is *restorable* into a scratch DB (parity-checked) but does NOT measure full production-cutover RTO. Run this runbook end-to-end once against a real snapshot, fill the RTO table below, and append a `dr-drill-history.md` block + a `dr_drills` row. Until then, treat the RTO as a hope.

---

## Symptom
- Production data corrupted or lost (catastrophic delete, bad migration, ransomware)
- Database unreachable and Fly's automatic recovery has failed
- Audit shows unauthorized destructive query was run

If the issue is "slow queries" or "one table is wrong" — **do not restore.** Use point-in-time SQL or partial restore to a separate cluster instead.

---

## Diagnose
1. Confirm the scope. What's the smallest unit you need to recover — one row, one table, one schema, the whole cluster?
2. Find the freshest snapshot before the incident. Fly takes daily volume snapshots:
   ```bash
   fly volumes list -a acreos-pg
   fly volumes snapshots list <volume-id> -a acreos-pg
   ```
3. Note: snapshot timestamps are UTC. Pick the latest snapshot **before** the incident timestamp.
4. Decide: **in-place restore** (replaces prod, downtime, fastest) vs **side-by-side restore** (new cluster, no downtime, slower, then promote).
5. Announce a status-page incident before you begin.

---

## Fix
### Side-by-side restore (preferred)
1. Restore the snapshot to a new volume:
   ```bash
   fly volumes create acreos_pg_restore --snapshot-id <snap-id> --region iad --size <GB>
   ```
2. Boot a new Postgres app pointing at that volume:
   ```bash
   fly postgres create --name acreos-pg-restore --region iad --volume-size <GB>
   # Attach the restored volume in the launch
   ```
3. Verify data integrity:
   ```bash
   fly postgres connect -a acreos-pg-restore
   \dt
   SELECT COUNT(*) FROM organizations;  -- spot check against your last known good count
   ```
4. If only partial recovery needed, `pg_dump` the rows / table you need from the restored cluster, then `pg_restore` into prod:
   ```bash
   pg_dump -h <restore-host> -t organizations acreos > recovered.sql
   psql -h <prod-host> acreos < recovered.sql
   ```
5. If full promotion needed: stop app traffic, swap `DATABASE_URL` in fly secrets, restart app, verify, resume traffic.

### In-place restore (only if cluster is unreachable)
1. Stop the app: `fly scale count 0 -a acreos`.
2. Detach current volume, attach snapshot-restored volume.
3. Start cluster, validate, scale app back up.

---

## Verify
- Row counts on critical tables (`organizations`, `users`, `subscriptions`, `tax_1099_documents`, `audit_events`) match expectations within tolerance.
- Application boots and `/api/health` returns 200.
- A test sign-in works and shows correct billing state.
- Stripe webhook replay (runbook 06) for the gap between snapshot time and recovery time.
- Audit `audit_events` for any data the customer wrote between snapshot and incident — this work is lost; communicate with affected customers.

---

## Escalate if
- Snapshot is older than 24h or unreadable → escalate to Fly support immediately, in parallel start a cold rebuild from `pg_dumpall` if we have a recent off-platform backup.
- Restore succeeds but the corruption is present in the snapshot too → we have a deeper problem (ransomware? bad migration that ran days ago?). Stop, do forensic review with engineering before the next attempt.
- Customer-visible data loss exceeds 4 hours → founder must communicate via /status and direct email; do not let it leak via a customer noticing first.

---

## Drill cadence
Target: exercised quarterly. **Last full timed drill: NONE (as of the 2026-08 audit).** The `dr_drills` table is empty; the step-away readiness verdict ("External keys / DR" checks) surfaces this until a drill is recorded. When ≥1 drill exists, "last drill" is the newest `dr_drills.ran_at`; if it is more than 90 days old, schedule one before you actually need this runbook.
