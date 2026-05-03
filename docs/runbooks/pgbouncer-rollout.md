# pgBouncer Rollout Runbook

**Owner:** Infra / SRE
**Phase:** 3, Week 7-8 (P1-15)
**Risk:** Medium — touches `DATABASE_URL` on the production app.
**Reversal time:** < 60 seconds (just flip `DATABASE_URL` back).

This runbook flips the `acreos` app from talking directly to Postgres to
talking through a transaction-pooling pgBouncer in front of Postgres.

---

## Why

Each Fly machine for `acreos` previously held 20 Postgres connections.
At 2 machines that is 40 backends; under autoscale (up to 6 machines) we
can starve Postgres' `max_connections` (typically 100). pgBouncer fixes
this by multiplexing many short-lived client connections onto a small
fixed pool of real backends.

Target steady-state: **25 server-side connections** total to Postgres,
regardless of how many app machines are running.

---

## Pre-flight checklist

- [ ] `fly.pgbouncer.toml` is on the branch / merged.
- [ ] You have the primary Postgres host, port, db, user, password.
- [ ] You have `flyctl` authenticated as someone with deploy rights on
      both `acreos` and (about-to-be-created) `acreos-pgbouncer`.
- [ ] You have read access to the `acreos` Sentry project to watch for
      a regression spike during the cutover.
- [ ] Confirm no migrations are mid-run (`fly logs --app acreos | grep migrate`).

---

## Step 1 — Deploy pgBouncer (no traffic yet)

```bash
# Create the new app shell.
fly launch \
  --config fly.pgbouncer.toml \
  --name  acreos-pgbouncer \
  --region iad \
  --no-deploy \
  --copy-config

# Inject Postgres credentials.
fly secrets set --app acreos-pgbouncer \
  DATABASES_HOST=<primary-host> \
  DATABASES_PORT=5432 \
  DATABASES_DBNAME=postgres \
  DATABASES_USER=postgres \
  DATABASES_PASSWORD=<password>

# Deploy the edoburu/pgbouncer image.
fly deploy --config fly.pgbouncer.toml
```

Expected pool config (from `fly.pgbouncer.toml`):

| Setting              | Value         |
| -------------------- | ------------- |
| `pool_mode`          | `transaction` |
| `default_pool_size`  | 25            |
| `reserve_pool_size`  | 5             |
| `max_client_conn`    | 1000          |

---

## Step 2 — Smoke-test pgBouncer in isolation

From a workstation with `psql`:

```bash
PGPASSWORD=<password> \
  psql -h acreos-pgbouncer.fly.dev -p 5432 -U postgres -d postgres \
       -c 'select 1;'
```

If this returns `1`, pgBouncer is healthy and authenticated.

---

## Step 3 — Flip `DATABASE_URL` on the `acreos` app

> **Important:** `DB_POOL_MAX` must already be 5 (our default). If somebody
> overrode it to 20+, lower it first or pgBouncer's pool will saturate.

```bash
# Capture the current URL so we can roll back.
fly secrets list --app acreos

# Set the new URL pointing at pgBouncer.
fly secrets set --app acreos \
  DATABASE_URL=postgres://postgres:<password>@acreos-pgbouncer.flycast:5432/postgres
```

This triggers a rolling restart. Watch:

```bash
fly logs --app acreos | grep -E 'database|pool|ECONNREFUSED'
```

Healthy log lines: `db: ready`, `T2 pool ready`. Bad lines: `ECONNREFUSED`,
`prepared statement "..." does not exist` — see "Known issues" below.

---

## Step 4 — Verify

In Postgres:

```sql
SELECT count(*) FROM pg_stat_activity WHERE usename = 'postgres';
-- expect ≈ 25 (default_pool_size), not 40+
```

In pgBouncer (admin shell):

```bash
psql -h acreos-pgbouncer.flycast -p 5432 -U postgres pgbouncer
SHOW POOLS;   -- cl_active should grow with traffic, sv_active should not exceed 25
SHOW STATS;
```

Sentry: confirm no spike in DB-related errors over the next 10 minutes.

---

## Step 5 — Rollback (if needed)

```bash
fly secrets set --app acreos DATABASE_URL=<old-direct-postgres-url>
```

Rolling restart will bring traffic back to direct Postgres. Leave the
`acreos-pgbouncer` app deployed (no cost when idle, easy to retry later).

---

## Known issues with `pool_mode = transaction`

| Issue                                | Mitigation                                          |
| ------------------------------------ | --------------------------------------------------- |
| Server-side prepared statements lose context | We don't use `pg.Client.prepare()`. Drizzle queries are plain text + params. |
| `SET LOCAL` only valid inside a tx   | We never `SET` connection state outside tx scope.   |
| `LISTEN/NOTIFY` not supported        | We use Redis Pub/Sub, not Postgres pub/sub.         |
| Long-running advisory locks         | Migrations bypass pgBouncer (see below).            |

### Migrations and admin scripts

`scripts/migrate.mjs` runs at deploy time as a one-shot release VM. It
**must** continue using the direct Postgres URL, not pgBouncer, because
schema migrations rely on session-state that transaction pooling breaks
(`SET search_path`, advisory locks).

Make sure the release command picks up `DATABASE_DIRECT_URL` if you split
them; today the release VM uses the same `DATABASE_URL` as the app, so
either:

- run migrations before flipping `DATABASE_URL`, or
- introduce a separate `DATABASE_MIGRATIONS_URL` secret pointing at
  Postgres directly, and update `scripts/migrate.mjs` to prefer it.

---

## Post-rollout

- [ ] Add `acreos-pgbouncer` to status-page / uptime monitor.
- [ ] Add `pg_stat_statements` dashboards (enabled by migration `0044`).
- [ ] Schedule an index-audit revisit in 4 weeks once `pg_stat_statements`
      has captured real production patterns.
