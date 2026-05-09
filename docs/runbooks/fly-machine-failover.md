# Runbook: Fly.io Primary Machine Down / Failover to Secondary

**Severity:** P0 — App unavailable
**Owner:** Founder / infrastructure
**Time to first response:** 2 min

---

## Symptom
- App is returning 5xx or timeout errors
- `https://acreos.com` or `https://app.acreos.com` is unreachable
- Customers report app is down or very slow
- Fly.io dashboard shows primary machine (e827514ae34de8) as `stopped`, `suspended`, or `unhealthy`
- No recent deploy or changes known

---

## Diagnose
1. Check Fly.io machine status:
   ```bash
   flyctl status -a acreos
   ```
   Look for machine status. Should show at least one machine as `running` with `healthy` state.
2. List all machines:
   ```bash
   flyctl machine list -a acreos
   ```
   Note: primary machine ID is `e827514ae34de8` (pinned). Identify any secondary machines.
3. Verify the primary machine is actually down:
   ```bash
   flyctl machine status e827514ae34de8 -a acreos
   ```
   If status is not `running`, it's down.
4. Check recent logs for errors:
   ```bash
   flyctl logs -a acreos --limit=100
   ```
   Look for crash loops, memory/CPU overload, or connectivity issues.
5. Try a health check:
   ```bash
   curl -I https://acreos.com/api/healthz
   ```
   Should return 200. If timeout or 502, the machine is not responding.

---

## Fix
- **Primary machine is stopped/suspended** → Restart it:
  ```bash
  flyctl machine restart e827514ae34de8 -a acreos
  ```
  Wait 30s, then verify status:
  ```bash
  flyctl machine status e827514ae34de8 -a acreos
  ```
  Machine should transition to `running` with `healthy` state.
- **Primary machine is unhealthy (OOM, CPU throttle, crash loop)** → Check resource usage:
  ```bash
  flyctl machine list -a acreos
  ```
  If primary shows `running` but `unhealthy`, scale the machine:
  ```bash
  flyctl machine update e827514ae34de8 --vm-memory=2048 -a acreos
  ```
  Or restart and increase resources:
  ```bash
  flyctl machine restart e827514ae34de8 -a acreos --force
  ```
- **Restart didn't work; failover to secondary** — Identify a healthy secondary machine:
  ```bash
  flyctl machine list -a acreos
  ```
  If a secondary is healthy, Fly's load balancer will already be routing traffic to it. Verify:
  ```bash
  curl -I https://acreos.com/api/healthz
  ```
  Should return 200.
- **No secondary machine available** — Create an emergency secondary:
  ```bash
  flyctl machine clone <machine-id> -a acreos
  ```
  This clones the primary and starts it. Wait for it to transition to `healthy`.
- **Postgres is unreachable** — Check DB connection:
  ```bash
  flyctl postgres status -a acreos-db
  ```
  If the primary is down, Fly's HA standby will promote. Wait 1-2 min for automatic failover.
  If manual intervention needed:
  ```bash
  flyctl postgres failover -a acreos-db
  ```

---

## Verify
- `flyctl status -a acreos` shows at least one machine as `running` and `healthy`.
- `curl -I https://acreos.com/api/healthz` returns 200.
- `/api/healthz` response includes `status: ok`, `database: connected`, `cache: connected`.
- Customer can load `https://acreos.com` and navigate to `/today` within <2s.
- App handles a test request (POST/GET) without errors.
- Monitor `flyctl logs -a acreos` for 2 min — no new errors or restarts.

---

## Escalate if
- Primary machine restart fails repeatedly (status never returns to `running`) → file Fly.io support ticket with machine ID and logs.
- Postgres failover doesn't complete within 2 min — escalate to Fly.io support. This is a DB availability issue.
- Secondary machine also goes down while primary is recovering → all machines are unhealthy. Check for platform-wide issues (Fly.io status page, our code, or a deployment issue).
- Traffic is reaching both primary and secondary but only one is responding — may indicate a session/state consistency issue. Escalate to engineering.

---

## Rollback
If you scaled up resources or changed configuration:
1. After the primary recovers and is stable (15+ min), you may scale back down to original settings:
   ```bash
   flyctl machine update e827514ae34de8 --vm-memory=1024 -a acreos
   ```
2. If you created a temporary secondary clone, you can delete it after primary is stable:
   ```bash
   flyctl machine destroy <clone-machine-id> -a acreos
   ```
3. Do not remove the secondary in production — keep at least 2 machines for HA.

---

## Related
- Fly.io machines docs: https://fly.io/docs/machines/
- Fly.io HA and failover: https://fly.io/docs/reference/architecture/
- Runbook: restore.md (database recovery)
- Monitoring: /admin/infrastructure/fly-status
