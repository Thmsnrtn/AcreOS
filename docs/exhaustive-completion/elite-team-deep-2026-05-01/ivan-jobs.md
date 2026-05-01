# Background Jobs Audit — AcreOS

**Author:** Iván Solano (ex-Sidekiq, ex-Temporal)
**Date:** 2026-05-01
**Lens:** "90% of weird production bugs are background-job bugs the team hasn't realized are background-job bugs."

I read `server/index.ts` (jobs registration, lines 1040–2725), `server/services/jobSupervisor.ts`, the `withJobLock` wrapper at `server/index.ts:113-168`, and Ines's reliability audit. The list below covers the 40+ scheduled timers I could enumerate.

---

## 1. Verdict

You don't have a background-job system. You have **40+ unsupervised setInterval timers** that share a Postgres advisory lock, no concurrency guard inside a single instance, no DLQ, no per-job timeout, no retry policy, and a "supervisor" that only counts consecutive failures in **process memory** — restart the instance and it forgets every failure. The Postgres lock saves you from double execution across two Fly machines, but inside one machine a long-running job can stack up `setInterval` invocations indefinitely. There is no Sidekiq/Temporal-style runner here. Once you cross 200 customers, the AI-heavy jobs (`finance_agent`, `voice_learning_refresh`, `pax_nudges`, `growth_automation`) will start overlapping their intervals, and you will discover this only because Postgres CPU spikes.

The mitigation is two weeks of focused work: self-rescheduling timers for the heavy jobs, per-job timeouts wired to AbortController, persistent failure counters in `jobHealthLogs`, and an outbox table for the AI/Stripe/Twilio side-effects so a mid-job Fly restart doesn't double-charge or double-send.

---

## 2. Job inventory

Format: `name | schedule | est-duration (loaded) | timeout | failure-mode | criticality`. "Loaded" means with 200 paying orgs.

### Tier A — frequent / hot path

| name | schedule | est-duration | timeout | failure-mode | crit |
|---|---|---|---|---|---|
| `event_mesh_drain` | every 10 s | 50 ms–2 s | none | swallowed `.catch()` | high |
| `api_queue` | every 10 s | 1–30 s | none (lock TTL 9 s) | lock TTL < runtime → re-acquire race | high |
| `scheduled_tasks` | every 60 s | 1–10 s | none | logger only | high |
| `pax_scheduler` | every 60 s | 1–20 s | none | logger only | high |
| `sequence_processor` | self-managed (every 60s per service) | unknown | unknown | unknown | high |
| `agent_reaction_processor` | every 2 min | 1–60 s | none | swallowed | medium |
| `job_supervisor.checkHealth` | every 2 min | < 50 ms | n/a | in-memory only | meta |
| `consensus_auto_execute` | every 5 min | 1–30 s | none | swallowed | medium |
| `realtime_alert_sync` | every 5 min | 1–10 s | none | logger | low |
| `agent_proactive_engine` | every 5 min | 5–120 s **AI** | none | logger | medium |

### Tier B — minutes-to-hours

| name | schedule | est-duration | timeout | failure-mode | crit |
|---|---|---|---|---|---|
| `lead_nurturing` | every 15 min | 30 s–8 min (per-org loop, AI) | none, lock TTL 14 min | drift / overlap | high |
| `delegation_completion_check` | every 15 min | 1–10 s | none | swallowed | low |
| `v5_maintenance` | every 15 min | 1–60 s | none | logger | medium |
| `retry_failed_actions` | every 30 min | 1–30 s | none | swallowed | high |
| `finance_agent` | every 30 min | 30 s–10 min (Stripe + AI) | none, lock 25 min | drift | **critical (money)** |
| `autonomous_decision_executor` | every 30 min | 30 s–15 min **AI** | none, lock 25 min | drift | high |
| `alerting` | hourly | 5–60 s | none, lock 55 min | logger | medium |
| `campaign_optimizer` | hourly | 30 s–5 min (per-org AI) | none, lock 55 min | drift | medium |
| `distress_recalculation` | hourly | 10 s–5 min | none, lock 55 min | logger | low |
| `autonomous_deal_machine` | hourly | varies; 7 AM CT branch is 1–5 min AI | none, lock 55 min | drift | medium |
| `autonomous_health_monitor` | hourly | 5–30 s | none, lock 10 min | swallowed | meta |
| `prompt_evolution` | monthly (1st 09:00 UTC), checked hourly | 30 s–10 min **AI** | none | logger | low |
| `experiment_sweep` | weekly (Mon 09:00 UTC) | 5–60 s | none | logger | low |
| `expansion_radar` | weekly (Mon 08:00 UTC) | 30 s–5 min **AI** | none | logger | low |
| `onboarding_sweeper` | hourly | 1–30 s | none | logger | high |
| `customer_letter_job` | monthly (1st 15:00 UTC) | **5–30 min** (per-org AI) | none | logger | medium |
| `action_preview_sweeper` | hourly | < 5 s | none | logger | medium |
| `strategic_proposals` | weekly + monthly | 1–10 min **AI** | none | logger | low |
| `founder_letter` | monthly (1st 12:00 UTC) | 30 s–5 min **AI** | none | logger | low |

### Tier C — heavy / nightly

| name | schedule | est-duration | timeout | failure-mode | crit |
|---|---|---|---|---|---|
| `digest` | every 6 h | 30 s–3 min | none, lock 5 h | logger | high |
| `dunning_tasks` | every 6 h | 30 s–10 min (Stripe + email) | none, lock 55 min ⚠️ | drift | **critical (money)** |
| `pax_nudges` | every 6 h | 1–10 min (per-org SMS/email) | none, lock 5 h | logger | high |
| `growth_automation` | every 6 h | 5–30 min (mass email/SMS/AI) | none, lock 55 min ⚠️ | **lock TTL < runtime** | high |
| `voice_learning_refresh` | every 12 h | 1–10 min (per-org AI build) | none, lock 11 h | logger | low |
| `deal_hunter_scraping` | nightly 02:00 local | **5 min–2 h** (web scraping) | none, lock 23 h | silent fail | medium |
| `county_assessor_ingest` | nightly 23:00 UTC | minutes (BullMQ-backed) | n/a (BullMQ) | unobservable | medium |
| `outcome_verification` | daily 02:00 UTC | 1–10 min | none, lock 55 min | logger | medium |
| `outcome_analyzer` | daily 02:00 local | 1–10 min **AI** | none, lock 23 h | swallowed | medium |
| `telemetry_optimizer` | daily 03:00 local | 1–5 min | none, lock 23 h | logger | low |
| `data_retention` | daily 03:30 UTC | 1–10 min (DELETEs) | none, lock 23 h | logger | high |
| `evolution_pipeline` | every 6 h, deploys 03–05 local | 1–30 min | none, lock 5 h | logger | medium |
| `daily_autonomous_summary` | daily 07:00 UTC | 30 s–5 min | none, lock 55 min | logger | low |
| `weekly_alert_digest` | Sunday 09:00 UTC | 30 s–5 min | none, lock 55 min | logger | low |
| `founder_weekly_digest` | Monday 14:00 UTC | 30 s–3 min | none, lock 30 min | logger | low |
| `founder_briefing` (daily 7am local) | daily 07:00 local | 30 s–2 min | none | swallowed | medium |
| `model_intelligence` | weekly Sun 04:00 local | 5–30 min | none, lock 6 d | logger | low |
| `self_assessment` | weekly Sun 03:00 local | 5–30 min **AI** | none, lock 6 d | logger | low |
| `agent_memory_consolidation` | weekly Sun 23:00 UTC | 5–30 min **AI** | none | logger | low |
| `trust_evolution` | weekly Sun 00:00 UTC | 1–10 min | none, lock 30 min | logger | low |
| `churn_engine` | daily 06:00 local | 30 s–5 min | none | logger (no lock!) | medium |
| `revenue_protection` | every 6 h | unknown | unknown (delegated to service) | unknown | high |
| `founder_digest` (daily 8am CT) | hourly check | 30 s–2 min | unknown | unknown | low |
| `external_status_monitor` | every 5 min | 1–10 s | n/a (own impl) | logger | medium |
| `job_health_cleanup` | daily | 1–30 s | none | logger | meta |
| `agent_events_cleanup` | daily | 1–30 s | none | logger | meta |
| `company_briefing_generator` | daily 11:45 UTC (5-min check) | 30 s–3 min **AI** | none, lock 55 min | logger | medium |
| `agent_initiative_engine` | every 30 min (org=1 only) | 5 s–2 min | none | swallowed | low |
| `seedCompanyAgentsOnStartup` | startup only, retries 3× | 1–10 s | none | logged loudly | meta |
| `job_queue_worker` (email/webhook/notification handlers) | every 10 s | per-job 1–30 s | webhook=10 s only | retry policy unclear | high |

That is **47 distinct timers** plus three startup-only one-shots and one BullMQ-delegated job. The Tier C cell I'd watch hardest is `growth_automation`: its lock TTL is 55 minutes but the function loops upsell/win-back/referral/re-engagement sequences across all eligible orgs and easily blows past an hour at scale. Once it does, the lock expires mid-run, the next interval fire acquires the lock, and you have **two concurrent growth-automation runs in the same instance**. That is the canonical Sidekiq footgun: a lock TTL shorter than the actual job runtime is **strictly worse than no lock at all**, because you trade "obvious double-execution" for "rare concurrency races that only fire under load."

---

## 3. setInterval → setTimeout migration (which jobs need the change)

`setInterval(fn, X)` fires every X ms regardless of whether the previous invocation finished. Inside one Node process, two simultaneous calls to `withJobLock(name)` would both try to acquire the Postgres lock — one wins, one logs `skipped_lock`. Looks fine. **But** the JS event loop is now holding two pending promises plus all their imported modules in memory, and if the work itself is CPU-bound (AI prompts, JSON parsing, scraping), the second one queues behind the first on the event loop. You get backpressure-by-leak, not backpressure-by-policy.

Rule of thumb: **if est-duration > 30% of interval at p95, migrate to self-rescheduling setTimeout.** The list:

| job | interval | p95 duration | %  | action |
|---|---|---|---|---|
| `api_queue` | 10 s | up to 30 s | 300% | **P0 — already broken**; lock TTL 9 s < runtime |
| `lead_nurturing` | 15 min | up to 8 min | 53% | **P0** |
| `finance_agent` | 30 min | up to 10 min | 33% | **P0** (money path) |
| `autonomous_decision_executor` | 30 min | up to 15 min | 50% | **P0** |
| `growth_automation` | 6 h | up to 30 min | 8% | **P0** anyway — lock TTL 55 min ≪ p99 runtime |
| `dunning_tasks` | 6 h | up to 10 min | 3% | P1 — lock TTL 55 min OK, but wire timeout |
| `customer_letter_job` | monthly | up to 30 min | n/a | **P1** — adds `setTimeout` after self-completion + per-org idempotency |
| `voice_learning_refresh` | 12 h | up to 10 min | < 2% | P2 — fine for now |
| `deal_hunter_scraping` | daily | up to 2 h | 8% | **P1** — wire per-source timeout (60s each) and partial-progress checkpoint |
| `agent_proactive_engine` | 5 min | up to 2 min | 40% | **P1** |

**Pattern to use everywhere:**

```ts
async function loop(name: string, intervalMs: number, ttlSec: number, fn: () => Promise<void>) {
  let stopped = false;
  (globalThis as any).__bgStop?.push(() => { stopped = true; });
  const tick = async () => {
    if (stopped) return;
    const startedAt = Date.now();
    await withJobLock(name, ttlSec, async () => {
      const ac = new AbortController();
      const timeoutMs = Math.min(intervalMs * 0.8, ttlSec * 1000 * 0.9);
      const t = setTimeout(() => ac.abort(), timeoutMs);
      try { await fn(/* pass ac.signal in */); } finally { clearTimeout(t); }
    }).catch(() => {});
    const elapsed = Date.now() - startedAt;
    setTimeout(tick, Math.max(intervalMs - elapsed, 1_000)).unref();
  };
  setTimeout(tick, /* initialDelay */ 0).unref();
}
```

Three properties this gives you:
1. **No queue** — next tick is scheduled only after the current one returns.
2. **Per-tick timeout** strictly less than the lock TTL, so a hung job releases the lock cleanly via the AbortController-driven failure path.
3. **Stop hook** that the SIGTERM handler can flip atomically rather than racing `clearInterval`.

---

## 4. Dead-letter + alerting plan

What exists today:
- `jobHealthLogs` table records `{success | failed | skipped_lock}` with `errorMessage` (server/index.ts:122–159).
- `jobSupervisor` keeps an **in-memory** `consecutiveFailures` counter; after 3 it inserts a `systemAlerts` row of type `system_error`, severity `critical` (jobSupervisor.ts:91–94, 196–217).
- `eventMeshPublisher.jobFailed(...)` fires on every failure (server/index.ts:160–163).

What's missing:
1. **`consecutiveFailures` doesn't survive a restart.** Fly.io rolls instances. If a job fails twice, the instance restarts, and it fails twice more, that's four real failures, but the supervisor sees `consecutive=2` and never alerts. Fix: derive the counter from a SQL query against `jobHealthLogs` ordered by `runStartedAt desc limit MAX_CONSECUTIVE_FAILURES`, in `notifyResult`/`wrap`.
2. **No DLQ.** If `processLeadNurturing` errors halfway through 50 orgs, the first 25 ran (some side-effected), the 26th threw, and the next tick starts from org 1 again. There is no "this org's nurturing failed at 14:32 and needs a retry" record. Add a `jobItemFailures(jobName, scopeKey, lastError, attempts, nextRetryAt)` table, write to it from each per-org loop, and have a single nightly DLQ-replay job pick up `attempts < 5 AND nextRetryAt <= now()`.
3. **No SLO for "skipped_lock".** A healthy ratio is < 1% — if it climbs to 30%, the cluster is racing locks rather than doing work. Add a Prometheus gauge.
4. **`systemAlerts` lands in a customer-facing org by accident.** Read `createJobFailureAlert` carefully: it picks **the first org in the table** to attach the alert to, because `systemAlerts.organizationId` is NOT NULL. Customer #1 will see "Background job 'x' is failing" in their feed. Fix: nullable column, or a dedicated `_platform` org row, or send to PagerDuty/Slack instead of `systemAlerts`.
5. **No paging escalation.** A `critical` alert in `systemAlerts` does not page anyone. Wire the eventMesh failure event to a paging channel (Slack `#oncall-jobs` is the minimum).

**Concrete plan:**

```sql
-- migration: persistent failure tracking
ALTER TABLE job_health_logs ADD INDEX (job_name, run_started_at desc);

CREATE TABLE job_item_failures (
  id bigserial primary key,
  job_name text not null,
  scope_key text not null,           -- e.g. "org:42" or "deal:1234"
  attempts int not null default 1,
  last_error text,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  next_retry_at timestamptz not null,
  unique (job_name, scope_key)
);
```

The supervisor changes from "count failures in a Map" to "SELECT count(*) FROM job_health_logs WHERE job_name=$1 AND status='failed' AND run_started_at > $latestSuccess". That single query is the difference between a real DLQ and theater.

---

## 5. Idempotency-at-job-level audit

A "races at the job level" means: if the same job runs twice (e.g., Fly restart mid-execution, lock TTL expiry, accidental manual trigger), what gets duplicated? File:line where I see exposure:

| site | what doubles |
|---|---|
| `server/services/dunning.ts:539` `stripe.invoices.pay(...)` | **double Stripe invoice payment** if dunning_tasks runs twice and the invoice was already in the second run's "to-pay" list. No Stripe idempotency-key passed; Stripe will accept the second call and charge again. **MONEY RISK.** |
| `server/services/financeAgent.ts:101` `openai.chat.completions.create(...)` | duplicate AI call → duplicate generated note → duplicate `notes` row → duplicate SMS reminder if reminder send key is `(noteId)`. |
| `server/jobs/growthAutomation` (mass email/SMS) | mass duplicate sends across all orgs. The lock TTL of 55 min vs runtime up to 30 min is fine **per run**, but at month-end load can blow past 55 min, and Fly restart mid-loop guarantees doubles. |
| `server/services/paxNudges` (per `runPaxNudges`) | per-org nudge duplicated if mid-loop fail. |
| `server/services/eSigningService.sendForSignature` (Ines flagged this) | duplicate counterparty emails. Confirmed — no `documentId`-based dedup. |
| `processLeadNurturing` → `processOrganizationLeads(scoringLimit:20, generateFollowUps:false)` | per-lead scoring is cached, but if `generateFollowUps` ever flips true, we'd double-generate AI follow-ups. Defensive: gate by `(leadId, dayBucket)` in the followups table. |
| `runMonthlyCustomerLetters` | comment says "Idempotent: per (orgId, monthKey)" — verify. If the upsert isn't enforced by a unique index, a partial run + restart writes two letters. |
| `runMonthlyPromptEvolution` | comment says "Only reads + proposes; never mutates live prompts" — proposals table needs `(monthKey, promptId)` unique. |
| `processChurnEngine` | **NO LOCK** — `churnEngine.runForAllOrgs()` called directly without `withJobLock`. Two instances will duplicate every score write. Bug. |
| `processFounderBriefing` | NO LOCK either; relies on the 5-minute window check, but two instances both within the window will both send. |
| `agentInitiativeEngine.runInitiativeCycle(1)` | hard-coded `org=1` — if you ever pass 2+, two instances duplicate. Also: only org 1 gets initiatives at all. |

The single highest-impact fix is the **outbox pattern** for the side-effect-producing jobs (Stripe pay, SMS send, email send, AI generation that gets persisted). Job loop writes to `outbox(jobName, scopeKey, sideEffectKind, payload, attemptedAt, completedAt)` with `unique(jobName, scopeKey, sideEffectKind, dayBucket)`. The outbox drainer then performs the side effect with a real idempotency key derived from the row id. If the job restarts, the outbox row is already there; the drainer is a no-op for already-completed rows.

---

## 6. External-call observability — AI / Stripe / Twilio

What I could find:

**Stripe.** Calls in jobs: `dunning.ts:539` (`stripe.invoices.pay`), invoice creation paths in dunning, finance agent. None I read pass `idempotencyKey`. Stripe's SDK supports it as a per-request option; we should set `idempotencyKey: \`${jobName}:${scopeKey}:${dayBucket}\`` on every mutating call. No global timeout on the Stripe client; the SDK default is 80 s. Recommendation: configure `new Stripe(key, { timeout: 15_000, maxNetworkRetries: 2 })` once at module init — the built-in retries handle transient 5xx with exponential backoff.

**Twilio.** Couldn't enumerate from inside jobs cheaply, but inbound webhook signature check exists. Outbound SMS (likely in `paxNudges` and `dunningService.processScheduledTasks`) needs:
- A timeout (Twilio default is 30 s — fine, but make it explicit at 10 s).
- A spend cap per org per day (you have `usageLimits.ts` per Ines's note; confirm wiring).
- An `idempotencyKey` derived from `(notificationId | leadId, dayBucket)` to avoid double-send.

**OpenAI / Anthropic.** `financeAgent.ts:101` is one site. Across the AI-heavy jobs (`agentProactiveEngine`, `autonomousDecisionExecutor`, `customerNarrative`, `founderNarrative`, `expansionRadar`, `voiceLearning`, `outcomeAnalyzer`, `selfAssessment`, `modelIntelligence`, `agentMemoryConsolidation`, `growthAutomation`, `companyBriefingGenerator`, `promptEvolutionMetaAgent`), I see **no consistent timeout configuration**. The OpenAI SDK default is 10 minutes per request. A single hung request + a `setInterval`-based job = the entire job is lost, and the event mesh `jobFailed` only fires after the lock TTL.

Recommendation:

```ts
// server/services/aiClient.ts (one place)
export const openai = new OpenAI({
  timeout: 30_000,         // 30s per call
  maxRetries: 2,           // SDK exponential backoff
  defaultHeaders: { 'X-Acreos-Job': '...' },
});
```

Then **every job that invokes openai/anthropic must wrap the call in `withTimeout(call, jobTimeoutMs)`** where jobTimeoutMs is < 80% of intervalMs. Without this, the AI provider's tail latency is your tail latency.

**Observability minimum:**

| metric | shape | example |
|---|---|---|
| `job_run_duration_ms` | histogram, label by `job_name`, `status` | p95 per job |
| `job_external_call_duration_ms` | histogram, label by `provider`, `endpoint`, `job_name` | spot Stripe/OpenAI tail latency |
| `job_external_call_total` | counter, label by `provider`, `result` | retry rate, error rate |
| `job_skipped_lock_total` | counter, label by `job_name` | concurrency saturation |
| `job_dlq_size` | gauge, label by `job_name` | "we are X items behind" |

You already export Prometheus metrics via `metricsMiddleware`; adding job-side metrics is a one-day fix.

---

## 7. The 1-week job-hardening sprint

### Day 1 — stop the bleeding (Stripe / SMS / AI doubles)

1. **Outbox table** for `dunning_tasks`, `paxNudges`, `growthAutomation`, `financeAgent`, `eSigningService`. Add a unique key gating every external side effect. Write the outbox row first, attempt the call second, mark complete third. *(8 hours.)*
2. **Stripe idempotency keys on every mutating call from jobs.** Format: `acr:${jobName}:${scopeKey}:${YYYYMMDD}`. *(2 hours.)*
3. **`processChurnEngine` lock fix** — wrap in `withJobLock("churn_engine", 23 * 3600, processChurnEngine)`. Same for `processFounderBriefing`. *(1 hour.)*

### Day 2 — kill the interval queueing

4. **Migrate Tier-A and high-risk Tier-B to self-rescheduling setTimeout** with the `loop()` helper above: `api_queue`, `lead_nurturing`, `finance_agent`, `autonomous_decision_executor`, `growth_automation`, `agent_proactive_engine`. *(6 hours.)*
5. **Fix `api_queue` lock TTL.** It is 9 seconds against an interval of 10 seconds; if the work takes 11 s, you re-acquire after 9 s while the previous run is still alive. Set TTL to `Math.max(runtime, 30s)` and switch to setTimeout. *(1 hour.)*

### Day 3 — per-job timeouts wired through

6. **AbortController on every external call inside jobs.** Add `aiClient.ts` with a 30 s default; pass `signal` through to OpenAI/Anthropic/Twilio/Stripe SDKs. Job-level wrapper enforces a hard cap (intervalMs * 0.8). *(6 hours.)*
7. **Stripe SDK timeout config** in `server/services/stripeClient.ts` (15 s, 2 retries). *(1 hour.)*

### Day 4 — persistent supervisor + DLQ

8. **`jobSupervisor` reads `consecutiveFailures` from `jobHealthLogs` instead of memory.** Every `notifyResult` triggers a `SELECT count(*) FROM job_health_logs WHERE job_name=$1 AND status='failed' AND run_started_at > (last success)`. *(3 hours.)*
9. **`job_item_failures` DLQ table + nightly replayer.** Refactor `processLeadNurturing`, `processOrganizationCampaigns`, `runPaxNudges` per-org loops to write to the DLQ on per-item failure rather than continuing silently. *(5 hours.)*
10. **Fix `createJobFailureAlert` orgScoping bug** (currently writes critical alerts to whichever org happens to be first). Make `systemAlerts.organizationId` nullable for platform alerts, or send to a separate `platform_alerts` table; either way, route to PagerDuty/Slack via webhook. *(2 hours.)*

### Day 5 — observability + cron drift

11. **Prometheus job metrics** (5 metrics from §6 table). Grafana dashboard with one row per job — runs/hr, p95 duration, skip rate, error rate. *(4 hours.)*
12. **Replace "every 5 min, check if it's 09:00 UTC"** with proper cron. Use `node-cron` or a tiny in-process cron evaluator, but stop scheduling 1 ms intervals just to maybe-fire monthly. About 12 jobs use this anti-pattern (`prompt_evolution`, `experiment_sweep`, `expansion_radar`, `customer_letter`, `founder_letter`, `strategic_proposals`, `trust_evolution`, `outcome_analyzer`, `telemetry_optimizer`, `model_intelligence`, `self_assessment`, `daily_autonomous_summary`, `weekly_alert_digest`, `outcome_verification`, `data_retention`). *(3 hours.)*
13. **SIGTERM-safe stop hook**. Today the SIGTERM handler `clearInterval`s the timers, but in-flight job promises continue to run during the 5-second drain window. With `setTimeout` self-rescheduling, replace `__bgIntervals` with `__bgStop = []` of cancellation callbacks the ticks check. Mid-job, abort the AbortController. *(2 hours.)*

### Stretch — Temporal/BullMQ migration scoping

14. We already have one BullMQ-backed job (`countyAssessorIngest`). The path forward at 500+ customers is **either** standardize on BullMQ for everything (Redis dependency, but battle-tested), **or** introduce Temporal (workflows, durable timers, real retry policies, real idempotency tokens). At current scale, the outbox + persistent DLQ described above is sufficient and cheaper. Revisit at the 1k-customer mark.

### What I'd push back on

- **Don't add a "stop all jobs" admin endpoint** without an audit trail. Tempting, but a bored intern killing growth_automation mid-run leaves the outbox half-drained.
- **Don't unify all 47 jobs into one monolithic scheduler**. The lazy-import-per-tick pattern is intentional and right — module load failures don't crash the server. Keep it.

---

## Closing

You have built 47 jobs. That's real productive throughput. The footguns are concentrated in three places: lock-TTL-shorter-than-runtime, AI/Stripe/Twilio with no client timeout, and an in-memory failure counter that resets on restart. The outbox pattern (day 1) eliminates the worst money/customer-trust bugs. The setTimeout migration (day 2) eliminates the silent queueing. Days 3–5 buy you the observability to spot the next class of bug before customers do.

The day this matters is the day OpenAI has a 90-second p99 latency spike at 14:00 UTC during the `customer_letter_job` window. Today: 200 customer letters take 6 hours, the lock expires, and a parallel run sends a duplicate of every letter sent before the lock expired. After the sprint: the outbox catches the dupes, the AbortController kills the slow calls before the lock expires, and the DLQ replayer picks up the few orgs that legitimately failed.

— Iván Solano
