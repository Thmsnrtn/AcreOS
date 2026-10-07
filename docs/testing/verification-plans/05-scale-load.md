# Plan 5 — Scale and load

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Find out how AcreOS behaves at data volumes and concurrency beyond a single
local instance: many organizations, large lead tables per organization, many
concurrent users, the connection pool under pressure, and scheduled jobs
running while the app is busy. The output is a measured curve on a
production-like environment and a comparison against **targets the founder
confirms** — not a pass/fail invented in advance.

## Why the campaign could not cover it

The campaign measured one local instance on a shared-core container, against
a seeded local database, with the test-auth bypass. That says something about
per-request cost on that box; it says nothing about Fly machine sizing, the
real network, Clerk token verification on every request, PgBouncer, the
production pool settings, or data at the scale of many tenants. Its own gap
list names organization count, lead volume, pool exhaustion and jobs under
load as unexercised.

## Existing tooling (read before writing anything new)

- `tests/load/` — k6 scripts (`k6-baseline.js`, `k6-concurrent-users.js`,
  `k6-multi-tenant.js`, `k6-db-stress.js`, `k6-soak.js`, `k6-deal-pipeline.js`
  and others), a runner (`run-all.sh`) and `README.md` with documented SLOs.
  **Known gap to resolve first:** `tests/load/lib/helpers.js` sends the
  supplied cookie as `connect.sid=…` unless it already starts with that name,
  while the app authenticates with Clerk's `__session` JWT
  (`server/auth/clerkAuth.ts`). Until the helper is aligned with Clerk, these
  scripts may be measuring 401s.
- `tests/perf/loadConcurrency.ts` — seeds a high-volume org and fires N
  concurrent authed requests at one endpoint, using persona cookies from the
  test-auth bypass. Usable only off-Fly.
- `tests/simulation/LOAD-TEST-SPEC.md` — scenario specifications with
  thresholds.
- `npm run test:scale` → `tests/simulation/sim-scaling-operator.spec.ts`.
- autocannon is not a dependency of this repo; k6 is the documented tool.

## Environment and prerequisites

- **A staging environment sized like production** — same Fly machine class
  and count as `fly.toml`, same Postgres tier, same `DB_POOL_MAX` /
  `DB_REPLICA_POOL_MAX` (`server/db.ts` defaults both to 5 per process), same
  PgBouncer arrangement if production uses one (`fly.pgbouncer.toml`,
  `docs/runbooks/pgbouncer-rollout.md`). Record every one of these values in
  the run log; a result without them is not comparable.
- **Never production.** Synthetic tenants and leads are created on staging
  only, marked as synthetic, and removed afterwards.
- **Authentication for many virtual users.** Either (a) a pool of Clerk test
  users on a non-production Clerk instance with a token-refresh step in the k6
  script (Clerk session tokens are short-lived, so a long run must renew
  them), or (b) a production-like box **off Fly** with `E2E_TEST_AUTH=1` and
  persona cookies. (b) omits Clerk verification cost and must be labelled so.
- **AI and paid providers stubbed or excluded.** Pax and enrichment endpoints
  spend money per call; leave them out or point them at a stub, and say so.
- Secrets by name: `DATABASE_URL`, `REDIS_URL`, the Clerk keys from plan 2,
  and `BASE_URL` / `AUTH_COOKIE` / `ORG_COOKIES` as k6 environment values.
- A load generator outside the app's region so the network is real.

## Scale tiers (proposed — founder to confirm)

| Tier                       | Organizations                                         | Leads per large org | Concurrent users |
| -------------------------- | ----------------------------------------------------- | ------------------- | ---------------- |
| T1                         | [TARGET — founder to confirm]                         | [TARGET]            | [TARGET]         |
| T2                         | [TARGET]                                              | [TARGET]            | [TARGET]         |
| T3 (stress, find the knee) | step up until the error or latency target is breached |                     |                  |

The campaign's own gap list mentions 1,000 organizations and 100,000 leads as
the scale it did not reach; those figures are offered as a starting point for
the founder's decision, not as a requirement.

## Endpoints

Reads (each confirmed to exist in `server/` at time of writing):
`GET /api/leads` (paginated), `/api/deals`, `/api/properties`, `/api/notes`,
`/api/payments`, `/api/inbox`, `/api/inbox/unread-count`, `/api/search`,
`/api/dashboard/stats`, `/api/campaigns`, `/api/me/permissions`,
`/api/auth/organizations`, `/api/health`.

Writes (staging only, synthetic data): lead creation and CSV import;
`POST /api/payments` (requires an `Idempotency-Key` and owner/admin role).

Background: run the worker process group with scheduled jobs enabled during
the soak, and read `GET /api/jobs/health` before and after.

## Procedure

1. **Baseline.** Seed T1. Run the k6 smoke scenario. Confirm a non-trivial
   share of 2xx responses before measuring anything (a load test of 401s is
   the vacuity case — assert the auth works first).
2. **Ramp.** Ramp concurrent users in steps to T1, then T2, holding each step;
   record p50/p95/p99 latency, error rate by status class, and throughput per
   endpoint.
3. **Volume.** At a fixed moderate concurrency, grow one organization's lead
   table through the tiers; record the paginated list and search latency at
   each size and capture `EXPLAIN (ANALYZE, BUFFERS)` for the slowest query.
4. **Multi-tenant fairness.** One very large org plus many small orgs under
   load at once (`k6-multi-tenant.js`); record whether small orgs' latency
   moves with the large org's activity.
5. **Pool exhaustion.** Raise concurrency until the pool saturates; record the
   first failure mode (queueing, timeouts, 5xx) and whether the app recovers
   without a restart once load drops.
6. **Soak with jobs.** Hold a moderate load for an extended period with the
   worker's scheduled jobs running; compare job durations and outcomes with an
   idle period.
7. **Clean up** the synthetic data and record that it was removed.

## Pass criteria

All thresholds below are **targets for the founder to confirm**. Existing
documented targets are cited so the founder can adopt, change or reject them:

- Read endpoints p95: `tests/load/README.md` states < 500 ms and < 1% errors.
  [TARGET — founder to confirm]
- AI endpoints p95: `tests/load/README.md` states < 2,000 ms and < 2% errors.
  [TARGET — founder to confirm, if AI is in scope]
- Alerting threshold: `docs/disaster-recovery.md` treats P95 > 2 s as a SEV2
  signal. [TARGET — founder to confirm]
- No 5xx under T1 and T2. [TARGET — founder to confirm]
- Recovery after pool saturation without a restart. [TARGET — founder to confirm]
- **Fail** is any confirmed target breached at a tier the founder marks as
  required for launch.

## Results

Not yet run.

## Still owed

- An owner and a date.
- Founder decisions on scale tiers and every target above.
- Alignment of `tests/load/lib/helpers.js` with Clerk session cookies, or a
  decision to use the off-Fly bypass path with that limitation stated.
- A production-like staging environment and its recorded configuration.

## Run log

_(empty — append entries per the format in [README](README.md))_
