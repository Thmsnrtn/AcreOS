# Capacity & Uptime Notes — Phase 0

**Owner:** Tess (SRE) / Iris (CTO)
**Last updated:** 2026-06-06

A short, honest note on the known capacity risks at Phase 0. The point is that
each accepted risk is **named**, not discovered in an incident.

---

## Deploy topology (from `fly.toml`)

| Process group | machines | memory | posture |
|---------------|----------|--------|---------|
| `app` (customer-facing) | `min_machines_running = 0`, `auto_stop_machines = 'suspend'`, `auto_start_machines = true` | 1gb | suspends after ~5m idle; cold-resumes on next request |
| `worker` (scheduled jobs, ETL, probes, outbox drain) | `min_machines_running = 1` | 2gb | always warm |

Health check: `[[http_service.http_checks]]` hits **`/api/health/cached`** with a
`grace_period = '15s'`. The cached path does **no** upstream fan-out, so a flaky
county/federal source can never fail the Fly health check (live fan-out is opt-in
at `/api/health/live`).

---

## SPOF #1 — the single worker (ACCEPTED, named)

`worker` runs at `min_machines_running = 1`. **Every** scheduled job — ETL,
`dataSourceProbe`, outbox drain, cache-warming, all the agent jobs — runs on this
one machine. If it dies between Fly's restart and the next health cycle, all
background processing stalls. `withJobLock` (Postgres-backed) makes the jobs
*safe* to run on multiple workers, so the fix when revenue justifies it is purely
`min_machines_running = 2` — no code change. **At Phase 0 this is an accepted
risk:** the failure mode is delayed background work, not customer-facing downtime
(the app group serves requests independently). Revisit at Phase 1+.

## Cold-start first impression (app group)

`app` suspends at idle. The **first request a new customer or live demo makes
after idle is a 1–2s cold suspend-resume** — a bad first impression on an
otherwise fast product. Mitigations, cheapest first:

1. **External uptime pinger (also our $0 monitoring — see below)** hitting
   `/api/health/cached` every 5 min keeps one machine warm during business hours
   essentially for free.
2. For a scheduled demo/launch window only, temporarily set
   `min_machines_running = 1` on the `app` group, then revert. (This is a small
   real run-rate decision — coordinate with Lena's cost envelope.)

Action: measure cold-resume TTFB once (`curl -w '%{time_starttransfer}\n'`
against the app URL after forcing a suspend). If > ~1.5s, apply mitigation 1 for
the demo window.

---

## $0 external monitoring (Tess item 6)

The app health-checks *itself* from inside the machine — always green even when
the machine is unreachable from the outside. Close that gap with an **external
pinger** (UptimeRobot / Better Stack free tier, 5-min interval) pointed at:

- `https://<app-url>/api/health/cached` — liveness + cached service health.
- `https://<app-url>/api/healthz` — bare liveness.

Alert channel → **founder's phone** (Tom), single escalation target. No
PagerDuty spend until Phase 3. This pinger doubles as the keep-warm in the
cold-start section above. The in-app `dataSourceProbe` job is the *internal*
half (a synthetic data lookup from the warm worker that alerts on a dead
source); the external pinger is the *outside-in* half (is the app reachable at
all). Together they cover both "the app is down" and "the data behind the app is
stale/broken".

---

## Free-data reliability stance (one line)

Treat the free-data tier as a **latency + freshness SLO**, not an availability
gamble: *95% of map data layers render in < 1.5s from cache; no layer is ever
blank — a degraded source falls back to last-good cache with an as-of badge.*
The `provider_cache` + stale-while-revalidate path in the registry, plus the
`dataSourceProbe` canary, make that achievable today for ~$0. The eventual paid
upgrade (Regrid/etc.) is then a coverage/quality decision, not a reliability
rescue.

---

## Open action items (cheap, do before / around customer #1)

- [ ] Stand up the external pinger → founder's phone (item 6).
- [ ] Measure cold-resume TTFB; decide on demo-window `min_machines_running`.
- [ ] Confirm `DB_BACKUP_S3_BUCKET` set + bucket lifecycle rule (see DR runbook).
- [ ] Run the Postgres restore drill once; fill in the measured RTO table.
- [ ] Bump `worker` to 2 machines when MRR justifies (removes SPOF #1, no code change).
