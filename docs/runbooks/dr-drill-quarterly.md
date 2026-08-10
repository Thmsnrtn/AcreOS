# Runbook: Quarterly DR Drill

**Severity:** P1 (drill — not a real incident)
**On-call owner:** Founder (until Eng team grows)
**Last updated:** 2026-05-08
**Cadence:** Quarterly — first Tuesday of January / April / July / October
**Related runbooks:** `07-database-restore-from-snapshot.md`, `fly-machine-failover.md`, `agent-loop-runaway.md`

## Why this runbook exists

Panel-300 G5: "Quarterly DR drill with measured RTO/RPO + blue/green deploy
with instant rollback + postmortem template + MTTR <15min Sev-1." DR drills
that aren't measured don't count. This runbook adds the *cadence + measurement*
on top of the existing restore mechanics in `07-database-restore-from-snapshot.md`.

## Drill prerequisites

- Latest snapshot is < 24h old (verify via `flyctl postgres backups list -a acreos-db`)
- Scratch DB exists: `acreos-db-scratch` (separate Fly Postgres app, no production
  traffic). If it doesn't, create it: `flyctl postgres create -n acreos-db-scratch`
- Stopwatch ready. Two browser tabs open: the prod founder home (`/founder`, The
  Letter) and the scratch app pointed at `acreos-db-scratch`.

## Drill steps + targets

| Step | Target | Notes |
|---|---|---|
| 1. Restore latest snapshot to scratch DB | ≤ 30 min | `07-database-restore-from-snapshot.md` step 4 |
| 2. Boot AcreOS app pointed at scratch | ≤ 5 min | `flyctl deploy -a acreos-scratch -e DATABASE_URL=postgres://...scratch` |
| 3. Verify `/api/founder/synthetic-checks/run` returns all-OK | ≤ 2 min | The synthetic-checks runner from FW-OLU-2 doubles as a drill assertion |
| 4. Verify a known recent row from prod exists in scratch | ≤ 1 min | E.g., last `community_letters` published_at; last `audit_events.created_at` |
| 5. Verify writes work in scratch (insert + read back) | ≤ 1 min | Idempotency check on a sentinel row |
| 6. Tear down scratch | ≤ 2 min | `flyctl apps destroy acreos-scratch` (or stop+keep for next drill) |

**Total RTO target:** ≤ 45 minutes from "decision to restore" to "scratch app green."

**RPO target:** snapshot ≤ 24h old at any moment, so worst-case data loss is 24h.

## Blue/green rollback (separate but related)

For app-tier failures (broken deploy, not data loss), the blue/green model is:
- Deploy new image to a SECOND Fly app (`acreos-green`) running the same DATABASE_URL.
- Smoke-test against the green app.
- Cutover by swapping Cloudflare DNS or Fly internal routing.
- If green is broken, swap back to blue. Data is shared; no rollback of DB needed.

Today AcreOS deploys to a single app; G5 future ticket: stand up the green app
permanently and rotate which is "active." Until then, rollback = `flyctl deploy`
with the previous image tag.

## Drill measurement template

After every drill, fill out:

```
DR drill — YYYY-MM-DD
Snapshot age at start: ___ hours
Snapshot restore time: ___ minutes
App boot time: ___ minutes
Synthetic-check run time: ___ minutes
Data-verify time: ___ minutes
Total RTO: ___ minutes (target: ≤ 45)
What went wrong (be honest): _______________
What's flaky / brittle: _______________
Action items (with owner + date): _______________
```

Persist the measurement in `docs/runbooks/dr-drill-history.md` (append-only log).

## Real-incident escalation

If a drill exposes a gap that's a real incident (e.g., snapshots are >48h old,
or a restore reveals corruption), STOP the drill and treat it as a Sev-1.
Use `founder-account-recovery.md` as the next-step guide for any data-loss
investigation.

## What this runbook does NOT cover

- Multi-region failover (deferred — single Fly region today)
- Customer notification during a real DR event (use `08-founder-out-of-office.md`
  + `gdpr-dsar-fulfilment.md` for the legal-comms angle)
- Insurance-claim filing for a real incident (separate process)
