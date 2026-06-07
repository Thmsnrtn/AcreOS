# Tess — SRE Elevation Brief (2026-06-07)

> Lens: operational excellence. Observability/tracing depth, SLOs, alerting maturity,
> capacity/cost on a shoestring, graceful degradation, the on-call story, chaos-readiness.
> Goal for first customers: **boringly reliable, and we hear about problems before they do.**

## State of the domain (surveyed firsthand)

This is genuinely past "launch-gap" territory. We have real substrate:

- **Metrics:** `server/metrics.ts` — prom-client `Registry` with HTTP counter+histogram,
  DB pool gauges, AI cost/call counters, job run counter+histogram, Stripe webhook failure
  counter. Exporter gated behind `METRICS_TOKEN` in prod (`metricsHandler`).
- **Tracing:** `server/tracing.ts` — OpenTelemetry, OTLP/console/no-op modes, HTTP+Express
  auto-instrumentation, `traceAsync` helper. Defaults to **no-op** in prod (no endpoint set).
- **Health:** `server/services/healthCheck.ts` (501 lines) — layered probes with real
  `healthy|degraded|unavailable|unconfigured` semantics; `routes.ts` exposes
  `/api/healthz` (liveness), `/api/health/cached` (Fly check target), `/api/health/live`,
  `/api/health/deep`. The "free data source unhealthy → degraded, never unavailable" rule
  is correct and tasteful.
- **Per-route SLI:** `middleware/apiTelemetry.ts` (2xx/4xx/5xx + p50/p95, durable samples)
  and `middleware/responseTimeRing.ts` (ring buffer for tracked endpoints).
- **Error budget:** `routes-error-budget.ts` computes month-to-date budget consumption for
  3 SLOs (AI success ≥99.9%, job success ≥99%, zero SEV-1) from real telemetry tables.
- **Incidents:** `incidents` table + `INCIDENT_STATUSES` + `routes-incidents.ts` (CRUD) +
  `docs/runbooks/_postmortem-template.md`.
- **Self-healing:** `jobs/autonomousHealthMonitor.ts` — job-failure sentinel, AI cost guardian
  (auto-downgrade to Haiku on budget trend), stale-connection/zombie-job cleanup, all logged
  to `autonomous_decisions`.
- **Alert scaffold:** `routes-founder-critical-alerts.ts` — P0/P1 ack-deadline timers
  (15m/60m), `registerCriticalAlert()` helper, escalation flag.
- **DR:** `docs/runbooks/07-database-restore-from-snapshot.md`,
  `docs/runbooks/dr-drill-quarterly.md`, `dr_drills` table + `dr-drill-history.md`.
- **Capacity honesty:** `docs/reliability/capacity-and-uptime-notes.md` names SPOF #1
  (single worker at `min_machines_running=1`) and the Phase-0 cost trade
  (`min_machines_running=0` + `auto_stop=suspend` on the app).

The substrate is excellent. The **wiring between substrate and a human at 3am is where the
gaps live** — and that is precisely the SRE job. Below, ranked by what makes us *boringly
reliable for first customers* vs. what's nice-to-have.

---

## The structural truth that shapes everything

**`min_machines_running = 0` + `auto_stop_machines = 'suspend'` (`fly.toml:51-53`) means the
app process is asleep most of the Phase-0 month.** That is the correct call for runway. But it
quietly breaks the entire Prometheus-pull model documented in `docs/slo-monitoring.md`:

- A scraper hitting `/metrics` will *itself wake the machine* (cost) or scrape nothing (gap).
- prom-client counters are **in-memory**; every suspend/resume **resets them to zero**. Our
  p95/error-rate histograms are amnesiac across the very idle cycles we designed for.
- If the app fails to cold-resume, **nothing notices** — there is no external eye. The Fly
  health check only runs against a *running* machine.

So our observability is, today, built for an always-on topology we deliberately don't run.
Several ideas below close exactly this seam. This is the single most important reframing.

---

## Top ideas (ranked)

### 1. External synthetic uptime probe — the "Twitter found out first" insurance
**improve · both · S**
We have golden-parcel synthetic probes (`jobs/dataSourceProbe.ts`) that run *on the worker* —
i.e. inside the same blast radius. There is **no eye outside the Fly app**. With the app
suspended, the only thing that knows it's healthy is the app itself. That is a blind spot a
first customer will find before we do.

What "great" looks like: a free external probe (UptimeRobot / Better Stack free tier / a
Cloudflare Worker cron — we already own the CF zone per `project_infra.md`) hits
`/api/healthz` every 60s from outside Fly, and a *separate* deep probe hits `/api/health/live`
every 5m. It validates cold-resume actually works, owns the public status page, and is the
backstop when the in-app monitor is itself down. Cost: $0.

First step: stand up a Cloudflare Worker cron pinging `https://acreos.../api/healthz`;
on two consecutive non-200s, POST to a Fly-hosted webhook that calls `registerCriticalAlert`.
Pointer: `server/routes.ts:539` (`/api/healthz` is already auth-free and fan-out-free —
purpose-built for exactly this).

### 2. Close the alert-delivery loop: a breach must reach Tom's phone, not a DB row
**improve · founder · M**
Right now the chain breaks at delivery. `registerCriticalAlert()`
(`routes-founder-critical-alerts.ts:118`) *writes a row*. `autonomousHealthMonitor.ts:537`
*sends an email*. `pushNotificationService.ts` has full VAPID web-push — but it is wired to
deal events (`notifyDealAccepted`), **not to incidents or critical alerts**. So a SEV-1 at 3am
produces: a DB row, maybe an email (which Tom won't see asleep), and silence on his phone.

What "great" looks like: one `notifyOnCall(severity, title, body)` function that fans out to
**push (VAPID) + email + the founder-bell ack-timer** atomically, and is the *only* way a
P0/P1 is raised. Push is the primary channel (web-push works on a locked iPhone via PWA);
email is the audit trail. The ack-deadline timer already exists — we just need delivery to
feed it.

First step: add `notifyOnCall()` to a new `server/services/oncall.ts` that calls
`sendPushToUser` (`pushNotificationService.ts:163`) + `emailService.sendEmail` +
`registerCriticalAlert` in one shot. Refactor `autonomousHealthMonitor.ts:537` to use it.

### 3. Burn-rate alerting + auto-incident-open, not pull-only error budget
**develop · founder · M**
`routes-error-budget.ts` is excellent but **pull-only** — it computes consumption only when
the founder opens the page. SRE practice is *multi-window burn-rate alerting*: a fast-burn
(2% of monthly budget in 1h) pages immediately; a slow-burn (10% in 6h) warns. Nothing watches
this today, and `incidents` rows are **only ever created by hand** (`routes-incidents.ts` POST).

What "great" looks like: a 5-minute worker job that runs the same SLO math against a rolling
window, and when fast-burn fires, **auto-opens an incident** (`detectionSource: "burn_rate"`)
and calls `notifyOnCall` (#2). The post-mortem template auto-attaches. This is the difference
between "we have SLOs" and "our SLOs defend themselves." Detector #1 and #2 from my charter,
made real.

First step: extract the three `*Slo()` functions from `routes-error-budget.ts` into
`server/services/reliability/sloCompute.ts`, add a rolling-window variant, register a
5-min job in `runScheduledJobs.ts` alongside `dataSourceProbe`.

### 4. Make tracing actually trace — light up OTel for first customers
**elevate · both · S**
`tracing.ts` is a beautiful no-op. In prod `OTEL_EXPORTER` is unset, so every span is
discarded. When a first customer says "the parcel lookup spun for 8 seconds," we have p95
aggregates but **no per-request waterfall** showing whether it was the county provider, the
cache miss, the AI grounding call, or the DB. With <50 customers, trace volume is trivial and
**Honeycomb's free tier (20M events/mo) covers us with headroom.**

What "great" looks like: every customer-facing request has a distributed trace; the slow ones
are one click from the founder cockpit. We already pass `GIT_SHA` for Sentry release tagging
(`fly.toml:6-12`) — tag traces with the same SHA so a regression is attributable to a deploy.

First step: set `OTEL_EXPORTER=otlp` + Honeycomb endpoint/headers as Fly secrets; add explicit
`traceAsync` spans around the provider-registry lookup path (the highest-variance customer call)
so the waterfall is legible, not just HTTP/Express auto-spans.

### 5. The worker is a SPOF for *all* observability and *all* alerting
**improve · founder · M**
`capacity-and-uptime-notes.md` honestly names SPOF #1: the single worker runs every scheduled
job. But the reliability implication is under-stated — **the worker is also where every alert
originates** (autonomousHealthMonitor, dataSourceProbe, the proposed burn-rate job). If the
worker dies, we lose background processing *and* the ability to tell anyone we lost it. The
watchman watches everyone but no one watches the watchman.

What "great" looks like: a worker liveness heartbeat written to a `worker_heartbeat` row each
loop, and the **external probe (#1)** checks heartbeat freshness via a tiny app endpoint. If
the heartbeat is >10m stale, the *external* eye pages. This is the only correct topology: the
thing that detects "alerting is down" must live outside alerting.

First step: write `updatedAt` to a single-row `worker_heartbeat` table in the outbox drain
loop (`server/worker.ts`); expose `/api/health/worker-heartbeat` (auth-free, like healthz);
have the CF Worker probe assert freshness.

### 6. Persist the metric counters across suspend — or stop pretending they're durable
**refine · founder · S**
prom-client counters reset on every cold-resume. Our durable layer (`apiTelemetrySamples`,
`getTelemetrySummaryDurable`) partially fixes this for HTTP telemetry, but the *Prometheus*
counters (AI cost, job runs, Stripe webhook failures) silently zero out. A founder reading
"$0 AI spend today" after a resume will trust a number that's just amnesia.

What "great" looks like: either (a) periodically flush counter snapshots to a `metric_snapshots`
table on the worker (which stays warm) and seed counters on boot, or (b) explicitly label the
in-memory metrics as "since last boot" in every surface that reads them, and route anything a
human *decides* on through the durable DB-backed path. (b) is the honest Phase-0 call;
(a) is the Phase-3 elevation. Pick (b) now.

First step: audit founder-facing surfaces that read `metrics.ts` counters; add a
"since process start (resets on idle)" caveat or repoint to durable telemetry. Grep
`getTelemetrySummary` vs `getTelemetrySummaryDurable` consumers.

### 7. Run the first DR drill for real — `dr-drill-history.md` has zero entries
**improve · founder · M**
The runbook (`07-database-restore-from-snapshot.md`), the quarterly cadence doc, the
`dr_drills` table, and the append-only history file all exist — and the history has **one
header block and zero actual drills logged** (`grep -c "ran-by="` → 1, the format example).
An untested restore runbook is a hope, not a plan. The RTO target is 45 min; we have never
measured the real number.

What "great" looks like: one real drill against a throwaway Fly Postgres from the latest B2
snapshot, fully timed (snapshot-age / restore / boot / synthetic / verify), one honest
`what-went-wrong` line, and the gaps fed back into the runbook. Do it **before** the first
customer's data is the thing at risk.

First step: provision a temp Fly PG, run `07-database-restore-from-snapshot.md` end-to-end
with a stopwatch, append the real block to `dr-drill-history.md`, file the gaps.

---

## Boldest elevation bet

**A closed-loop self-defending reliability spine: external eye → detection → auto-incident →
phone → ack-timer → blameless post-mortem, all wired end-to-end before customer #1.**

Today we have every *component* of this and almost none of the *connections*. The bet is to
spend one focused arc turning the pile of excellent parts into a single chain that, when the
parcel-check widget 500s at 3am on a holiday, does this without a human in the loop: the
Cloudflare external probe sees the failure (the app's own monitor can't, it's suspended) →
opens an `incidents` row with `detectionSource: "external_probe"` → fires VAPID push to Tom's
locked phone → starts the 15-min P0 ack-timer → and if unacked, escalates. Then resolution
auto-attaches the post-mortem template.

That single demonstrable chain — *we hear about it before the customer, on the phone, with a
timer running* — is the thing that turns "we have good infra" into "we are operationally
serious." It is the embodiment of my charter's non-negotiable: **detection-before-customer-
report.** Everything else is polish; this is the spine.

---

## Small high-ROI polish refinements

- **`/api/healthz` should report build SHA + uptime + worker-heartbeat-age** so the external
  probe gets signal in one cheap call (`routes.ts:539`).
- **Tag OTel spans and Sentry events with the same `GIT_SHA`** already baked at build
  (`fly.toml:6-12`) so a latency/error regression is one query from "which deploy."
- **`X-Request-Id` propagation:** ensure the request ID in logs == the OTel `traceId` so a
  Sentry error links straight to its trace. Check `middleware/apiTelemetry.ts` + `tracing.ts`.
- **A public, honest status page** that reads `healthCheckService.getLastResults()` and shows
  per-dependency `degraded`/`unavailable` with the "free source unhealthy = degraded" framing.
  We already compute it (`routes.ts:511-527`); we just don't show customers a calm version.
- **Surface "data freshness, not just up/down"** on the status page — a county source being
  stale is the failure mode *land investors* actually feel, and it's our distinctive angle.
- **Stripe webhook failure → alert path:** `stripeWebhookFailedTotal` counter exists and
  `slo-monitoring.md` names the `StripeWebhookFailing` alert, but nothing consumes the counter.
  A failed webhook = a customer charged-but-not-provisioned. Wire it to `notifyOnCall`.
- **Document the cold-start latency budget** customers will actually see (1–2s on first request
  after idle, per `fly.toml:44-50`) so it's a known/accepted SLI line, not a surprise p99.
- **Rename `incident-response.md` vs `INCIDENT_RESPONSE.md`** — two files, case-collision risk
  on case-insensitive filesystems, and ambiguity about which is canon. Pick one.
- **Add a `min_machines_running` revenue-trigger reminder** to the `$200 MRR` ladder so the
  cold-start trade is consciously revisited, not forgotten (cross-ref `tier-limits.ts`).

---

## The one thing that would most embarrass us

**If the app fails to cold-resume — or a SEV-1 fires while the app is suspended — nobody finds
out until a customer emails, and even then the alert lands as an unread email and a DB row, not
a notification on the phone.** We have an elaborate, genuinely good monitoring apparatus that is
*structurally blind during the exact idle windows our cost topology creates*, and whose one
delivery path that could wake a sleeping founder (VAPID push, fully built in
`pushNotificationService.ts`) is wired to "deal accepted" but **not to "production is down."**

A sharp first customer (or any SRE who looked) would notice in five minutes that the watchman
lives inside the building it's watching, and that the alarm bell isn't connected to anything
that rings. That is the gap to close before customer #1, and ideas #1, #2, and #5 close it.
