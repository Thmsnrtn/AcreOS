# External Monitoring Setup — UptimeRobot / Better Stack

**Owner:** Tess (SRE) · **Status:** 🔑 FOUNDER ACTION REQUIRED · **Last updated:** 2026-06-08

## Why this exists

Every other layer of monitoring AcreOS has — Fly health checks, the Docker
`HEALTHCHECK`, the in-app `/api/health` fan-out, the CI release-watchdog — runs
**inside our own infrastructure or GitHub**. If Fly, Cloudflare, or our DNS goes
sideways, the thing reporting "all good" is sitting behind the same failure. We
have no **external eye**: a probe from outside our blast radius that pings the
live site on a schedule and texts Tom when it can't.

Code cannot sign Tom up for an external monitor (it needs his account, his phone
number, his payment method). This document is the exact, do-it-once setup. Pick
**one** provider — both are fine; UptimeRobot has a free tier that covers this,
Better Stack has nicer phone-call escalation.

---

## 🔑 The three monitors to create

All three are **HTTP(S) GET**, **5-minute interval**, alerting **→ Tom's phone**
(SMS and/or push; add a phone-call escalation on the first one if the provider
supports it). Use the production host `https://acreos.io` (Cloudflare-fronted —
this tests the full customer path, not the Fly origin directly).

### 1. App liveness — `/api/healthz`

- **URL:** `https://acreos.io/api/healthz`
- **Expect:** HTTP `200`. This is the tiny no-fan-out liveness probe; a non-200
  or a timeout means the app process is down or unreachable.
- **Keyword check:** none needed — status code alone is the signal.
- **Alert when:** down for 2 consecutive checks (~10 min) to avoid paging on a
  single cold-start blip (Fly `min_machines_running = 0` can cold-start the
  first request after idle).

### 2. Cached health snapshot — `/api/health/cached`

- **URL:** `https://acreos.io/api/health/cached`
- **Expect:** HTTP `200`. This is the snapshot the Docker `HEALTHCHECK` uses;
  it reflects the last periodic fan-out (refreshed every ~30s in-process).
- **Keyword check:** if the provider supports response-body assertions, alert if
  the body does **NOT** contain `"status":"healthy"` (the snapshot reports
  degraded/unhealthy sub-checks in its body even while returning 200 in some
  states). If body assertions aren't available on your plan, status-code-only is
  acceptable here.
- **Alert when:** down/degraded for 2 consecutive checks.

### 3. Worker heartbeat — `/api/health/worker-heartbeat` ⚠️ body check is mandatory

- **URL:** `https://acreos.io/api/health/worker-heartbeat`
- **Expect:** HTTP `200` **AND** a JSON body where `stale` is `false`.
- **⚠️ CRITICAL — this endpoint ALWAYS returns HTTP 200, even when the worker is
  dead.** It deliberately encodes the failure in the JSON body, not the status
  code, so a probe keyed on status alone will be fooled. You **must** configure a
  response-body keyword assertion:
  - **UptimeRobot:** monitor type "Keyword", keyword `"stale":true`, alert when
    keyword **EXISTS** (i.e. keyword-found = down).
  - **Better Stack:** "Expected to contain" / use a body assertion that the
    response should contain `"stale":false`; alert when that assertion fails.
- **Why it matters:** the worker process runs scheduled jobs (dunning, digests,
  satellite refresh, the periodic health fan-out). If it wedges, the web app
  still serves pages and looks healthy — but money-moving jobs silently stop.
  The heartbeat going stale is the only external signal of that.
- **Alert when:** `stale:true` appears for 2 consecutive checks (the in-app
  threshold is 10 min / 600s of no beat before it flips, so a single 5-min check
  catching a transient won't falsely fire).

---

## Provider-specific quick setup

### UptimeRobot (free tier covers all three)

1. Sign in → **+ Add New Monitor**.
2. Monitors 1 & 2: type **HTTP(s)**, paste the URL, interval **5 minutes**.
3. Monitor 3: type **Keyword**, URL = the worker-heartbeat URL, keyword =
   `"stale":true`, **Alert When** = *Keyword Exists*, interval **5 minutes**.
4. Under **Alert Contacts**, add Tom's mobile (SMS) and the UptimeRobot mobile
   app push. Attach all three monitors to that contact.
5. (Optional) Set "Notify when down after **2** failed checks" on each.

### Better Stack (Uptime)

1. **Monitors → Create monitor** for each URL, check frequency **5 minutes**.
2. For monitor 3, enable **Request body / response checks** → "Response body
   should contain" `"stale":false` (alert when it does not).
3. Create an **On-call escalation policy** → Tom's phone: push → SMS → phone
   call after N minutes. Attach the liveness monitor (#1) to it for hard pages;
   #2 and #3 can be lower-severity SMS/push.

---

## Verifying it works (do this once, after setup)

- Hit each URL yourself in a browser / `curl` and confirm the expected response:
  - `curl -s https://acreos.io/api/healthz` → `{"status":"ok"...}` 200
  - `curl -s https://acreos.io/api/health/cached` → JSON 200
  - `curl -s https://acreos.io/api/health/worker-heartbeat` → JSON with
    `"stale":false` when the worker is alive.
- Trigger a **test alert** from the provider's UI to confirm the SMS/push
  actually lands on Tom's phone. An untested alerting path is not an alerting
  path.

---

## How this fits the rest of the alerting stack

| Layer | Watches | Runs where | Pages whom |
|---|---|---|---|
| Fly health check (`fly.toml`) | origin liveness | Fly (inside blast radius) | restarts machine |
| Docker `HEALTHCHECK` | `/api/health/cached` | container | restarts container |
| `release-watchdog.yml` (hourly) | origin/main SHA vs live `/api/version` | GitHub Actions | `DEPLOY_ALERT_WEBHOOK` |
| deploy.yml "Notify on failure" | the deploy job itself | GitHub Actions | `DEPLOY_ALERT_WEBHOOK` |
| **This doc (UptimeRobot/Better Stack)** | **live site from outside** | **3rd-party, outside blast radius** | **Tom's phone** |

The external pinger is the only layer that survives a total Fly/Cloudflare/DNS
outage, and the only one that catches a **stale worker** (HTTP-200-but-dead).
The two GitHub layers above also depend on the **`DEPLOY_ALERT_WEBHOOK`** secret
being set — see `.github/workflows/deploy.yml` / `release-watchdog.yml`:

```
# ntfy:  gh secret set DEPLOY_ALERT_WEBHOOK --body "https://ntfy.sh/<private-topic>"
# Slack: gh secret set DEPLOY_ALERT_WEBHOOK --body "https://hooks.slack.com/services/XXX/YYY/ZZZ"
```
