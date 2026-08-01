# Lens 062 — Background Job Reliability

Auditor: Background Job Reliability Reviewer
Date: 2026-04-18
Severity: mixed (several P1, multiple P2)

---

## 1. Job Inventory

### 1a. setInterval-based jobs registered in `server/index.ts` (via `trackInterval`)

There are **44 `trackInterval()` calls** in `server/index.ts`, covering these distinct background jobs:

| # | Job Name | Interval | Uses `withJobLock`? | Supervisor? |
|---|----------|----------|---------------------|-------------|
| 1 | Event mesh drain | 10s | No | No |
| 2 | API queue | 10s | Yes | No |
| 3 | Sequence processor | 60s (via service) | Yes (internal) | No |
| 4 | Scheduled tasks | 1m | Yes | No |
| 5 | Pax scheduler | 1m | Yes | No |
| 6 | Agent reaction processor | 2m | No | No |
| 7 | Job supervisor health check | 2m | No | N/A (is the supervisor) |
| 8 | Realtime alert sync | 5m | No | No |
| 9 | Agent proactive engine | 5m | No | No |
| 10 | Delegation completion check | 15m | No | No |
| 11 | Lead nurturing | 15m | Yes | No |
| 12 | v5 maintenance | 15m | No | No |
| 13 | Consensus auto-execution | 5m | No | No |
| 14 | Daily autonomous summary | 5m poll (7am UTC) | Yes | No |
| 15 | Retry failed actions | 30m | No | No |
| 16 | Finance agent | 30m | Yes | `notifyResult` |
| 17 | Agent initiative engine | 30m | No | No |
| 18 | Autonomous decision executor | 30m | Yes | No |
| 19 | Campaign optimizer | 1h | Yes | `notifyResult` |
| 20 | Alerting | 1h | Yes | No |
| 21 | Distress recalculation | 1h | Yes | No |
| 22 | Autonomous deal machine | 1h | Yes | No |
| 23 | Autonomous health monitor | 1h | Yes | No |
| 24 | Founder weekly digest | 1h poll (Mon 8am CT) | Yes | No |
| 25 | Company briefing | 5m poll (6:45am CT) | Yes | No |
| 26 | Trust evolution | 1h poll (Sun midnight) | Yes | No |
| 27 | Weekly alert digest | 5m poll (Sun 9am UTC) | Yes | No |
| 28 | Churn engine | 5m poll (6am local) | No | `notifyResult` |
| 29 | Founder briefing | 5m poll (7am local) | No | `notifyResult` |
| 30 | Outcome analyzer | 5m poll (2am local) | Yes (in poll) | `notifyResult` |
| 31 | Telemetry optimizer | 5m poll (3am local) | Yes | `notifyResult` |
| 32 | Model intelligence | 5m poll (Sun 4am local) | Yes | `notifyResult` |
| 33 | Self-assessment | 5m poll (Sun 3am local) | Yes | `notifyResult` |
| 34 | Evolution pipeline | 6h | Yes | `notifyResult` |
| 35 | Digest | 6h | Yes | No |
| 36 | Pax nudges | 6h | Yes | No |
| 37 | Growth automation | 6h | Yes | No |
| 38 | Revenue protection | via service | Yes (external) | No |
| 39 | Founder digest | via service | Yes (external) | No |
| 40 | Dunning tasks | 6h | Yes | No |
| 41 | Voice learning refresh | 12h | Yes | No |
| 42 | Deal hunter scraping | 24h | Yes | No |
| 43 | Job health log cleanup | 24h | No | No |
| 44 | Agent events cleanup | 24h | No | No |
| 45 | Outcome verification | 5m poll (2am UTC) | Yes | No |
| 46 | Data retention | 5m poll (3:30am UTC) | Yes | `notifyResult` |

### 1b. Untracked `setInterval` calls (NOT using `trackInterval`, NOT cleared on shutdown)

**15 bare `setInterval` calls** exist in the codebase that will leak timers during graceful shutdown:

| File | Line | Purpose | Risk |
|------|------|---------|------|
| `server/routes.ts` | 188 | Clean expired borrower sessions (1h) | Medium — DB write leak |
| `server/routes.ts` | 204 | Clean expired job locks (5m) | Medium — DB write leak |
| `server/middleware/rateLimiting.ts` | 57 | Cleanup in-memory rate limit entries (2m) | Low — memory only |
| `server/middleware/rateLimit.ts` | 36 | Cleanup rate limit hit counters (1h) | Low — memory only |
| `server/middleware/rateLimit.ts` | 93 | Cleanup rate limit store entries (1m) | Low — memory only |
| `server/middleware/idempotency.ts` | 38 | Cleanup idempotency store (10m) | Low — memory only |
| `server/services/communicationDeduplication.ts` | 36 | Cleanup dedup keys (periodic) | Low — memory only |
| `server/services/founderDigest.ts` | 259 | Founder digest hourly check | Medium — DB reads + email sends |
| `server/services/revenueProtection.ts` | 318 | Revenue protection (6h) | High — DB reads + writes |
| `server/services/externalStatusMonitor.ts` | 207 | External service monitoring (5m) | Low — HTTP calls |
| `server/services/healthCheck.ts` | 412 | Periodic health checks (1m) | Low — diagnostic |
| `server/services/browserAutomation.ts` | 746 | Job queue processor | Medium — may fire during drain |
| `server/services/aiAdvisorTeamV15.ts` | 525 | Advisor cycle | Medium — AI API calls |
| `server/jobs/autonomousTaskProcessor.ts` | 340 | Autonomous task poll (30s) | High — DB reads + AI calls |
| `server/services/sequenceProcessor.ts` | 24 | Sequence processing (60s) | High — DB reads + email sends |

### 1c. BullMQ-based jobs (`server/jobs/`)

**14 BullMQ cron jobs** are defined but depend on `REDIS_URL` being set:

| File | Cron Schedule |
|------|---------------|
| `countyAssessorIngest.ts` | `0 23 * * *` (11 PM UTC) |
| `autonomousDealMachine.ts` | `0 1 * * *` (1 AM UTC) |
| `dataIngestJob.ts` | `0 22 * * *` (10 PM UTC) |
| `courseCompletionCheck.ts` | `0 6 * * *` (6 AM UTC) |
| `dailyBriefing.ts` | `0 7 * * *` (7 AM UTC) *(deleted 2026-08-01 — module orphan; distinct from the LIVE founder briefing, `services/founderBriefing.ts` `sendDailyBriefing`, fired by `runScheduledJobs.ts`)* |
| `regulatoryComplianceCheck.ts` | `0 4 * * *` (4 AM UTC) |
| `satelliteImageUpdate.ts` | `0 2 * * *` (2 AM UTC) |
| `dealHunterScrape.ts` | `0 */2 * * *` (every 2h) |
| `landCreditScoreRecalculation.ts` | `0 3 * * *` (3 AM UTC) |
| `featureEngineeringJob.ts` | `0 23 * * *` (11 PM UTC) |
| `valuationModelRetrain.ts` | `0 1 * * 0` (Sun 1 AM) |
| `indexAnalyzer.ts` | `0 2 * * 0` (Sun 2 AM) |
| `autonomousHealthMonitor.ts` | `0 * * * *` (hourly) |
| `founderWeeklyDigest.ts` | `0 8 * * 1` (Mon 8 AM) |
| `dbBackup.ts` | `0 3 * * *` (3 AM UTC) |
| `realtimeTranscription.ts` | on-demand (queue-based) |

**Critical: Redis is reported as missing in production** (orientation doc P0 #4: "Cannot find package 'redis'"). If `REDIS_URL` is not set, all 14 BullMQ jobs silently fall back to no-ops. Several of these jobs (county assessor ingest, deal machine, data ingest) are also triggered by `setInterval` wrappers in `index.ts` that merely import the module but do not actually execute the job body — they just log "triggered" (see `processCountyAssessorIngest()` at line 1430, which imports the module and logs but never calls any function on it).

---

## 2. Error Handling

### What works well
- **`withJobLock` wrapper** (`server/index.ts:113-168`): Catches all errors, logs them to `job_health_logs` table, publishes failure events to the event mesh, and releases the lock in `finally`. This is solid.
- **`jobSupervisor.wrap()`** (`server/services/jobSupervisor.ts:62-110`): Catches errors, tracks consecutive failures, creates system alerts after 3 consecutive failures. Does NOT re-throw (resilient). Also solid.
- **Individual job functions**: Most `process*` functions in `index.ts` have their own `try/catch` blocks.

### Problems found

**P2-A: Double error handling creates silent swallowing.** Many jobs wrap their body in `try/catch` (e.g., `processChurnEngine` at line 1620 catches and logs), then are also called inside `withJobLock` which also catches. The inner catch prevents the outer `withJobLock` from seeing the failure — so the `job_health_logs` table records "success" even when the job function caught an internal error and returned gracefully. This means `job_health_logs` understates failure rates.

**P2-B: Several time-gated jobs lack `withJobLock`.** `startChurnEngineJob` (line 1631) and `startFounderBriefingJob` (line 1655) poll every 5 minutes checking `now.getHours()`, but call `processChurnEngine()` / `processFounderBriefing()` directly without `withJobLock`. On a 2-machine deployment, both instances will fire the same job simultaneously. The `processChurnEngine` function at line 1634 runs on startup with a bare `setTimeout` — also no lock.

**P2-C: Startup `setTimeout` calls for initial job runs are not tracked.** Many jobs use `setTimeout(() => { ... }, delay)` for their initial run (e.g., lines 883, 937, 974, 1041, 1114, 1140, etc.). These timeout handles are never stored or cleared during graceful shutdown. If the server receives SIGTERM during the startup delay window, these timeouts will still fire.

---

## 3. Idempotency Analysis

### Idempotent jobs (safe to run multiple times)
- **Data retention** (`dataRetention.ts`): DELETE with timestamp condition — idempotent.
- **Job health cleanup** (line 717): DELETE with timestamp condition — idempotent.
- **Agent events cleanup** (line 731): DELETE with timestamp condition — idempotent.
- **Lead nurturing** (line 849): Reads active orgs, scores leads with limit — idempotent (scoring overwrites).
- **Health monitor**: Read-only diagnostics + self-healing — idempotent.
- **Company agent seeding**: Upserts — idempotent.

### Non-idempotent or unclear
- **P1-D: Growth automation** (`growthAutomation.ts`): Sends emails (upsell, win-back, re-engagement). If run twice, could double-send. The 21-day cooldown per org provides some protection, but a rapid double-fire within the same cycle would bypass it since the cooldown is checked at the start of the run.
- **P1-E: Founder digest / Revenue protection**: Both use `setInterval` in their service files AND are called from `index.ts`. The `founderDigest.ts` service at line 259 starts its OWN `setInterval` hourly loop, while `index.ts` at line 578 also calls `startFounderDigestJob`. This means **two independent intervals** run the same job. The `withJobLock` calls should prevent double execution, but it doubles the lock acquisition overhead.
- **P2-F: Pax nudges** (`paxNudges.ts`): Sends push notifications — not inherently idempotent without dedup.
- **P2-G: Autonomous decision executor**: Processes founder inbox items and takes action. Double-execution could duplicate actions if the action was taken but the "processed" flag was not yet committed.

---

## 4. Job Duration vs. Interval (Overlap Risk)

**P1-H: No overlap guard on most jobs.** If a job takes longer than its interval, the next invocation starts while the previous is still running. The only protection is `withJobLock`, which prevents cross-instance overlap but does NOT prevent same-instance overlap — `withJobLock` acquires a DB-level advisory lock, and the same Node.js process can fire the next `setInterval` callback while the previous async execution is still awaiting.

Specific risks:
- **API queue** (10s interval): If queue processing takes >10s, callbacks stack up. No `isProcessing` guard.
- **Agent reaction processor** (2m interval): No lock, no guard. If AI calls take >2m, overlaps.
- **Agent proactive engine** (5m interval): No lock, no guard.
- **v5 maintenance** (15m interval): No lock, no guard.

Counter-examples that DO handle this correctly:
- **browserAutomation.ts** (line 746): Uses an `isProcessingQueue` boolean guard.
- **sequenceProcessor.ts**: Uses `isRunning` flag + job lock.
- **InMemoryJobQueueService** (line 516): Uses `this.processing` boolean.

---

## 5. Job Queue System Assessment

### Architecture
The codebase uses a **hybrid approach**:

1. **`setInterval` in `server/index.ts`** — 44 tracked intervals for periodic background work. This is the primary scheduler.
2. **BullMQ** (14 cron jobs in `server/jobs/`) — requires Redis (`REDIS_URL`). Used for heavier batch processing.
3. **`jobQueueService`** (`server/services/jobQueue.ts`) — a generic job queue abstraction that wraps BullMQ with an in-memory fallback. Handles email, webhook, payment sync, and notification jobs. Falls back transparently when Redis is unavailable.

### P0-I: BullMQ jobs are likely non-functional in production
The orientation doc lists "Cannot find package 'redis'" as a P0 issue. The `secretsValidation.ts` marks `REDIS_URL` as required only in production but notes the package itself may be missing. If Redis is not available:
- All 14 BullMQ cron jobs silently degrade to nothing.
- The `jobQueueService` falls back to an in-memory queue that does not survive restarts.
- Several `index.ts` wrappers for BullMQ jobs (county assessor, deal machine) import the module but **never actually call the job function** — they just log "triggered" (see line 1430-1438).

### P2-J: No dead-letter queue for setInterval jobs
When a `setInterval` job fails, it is logged and then forgotten. There is no retry mechanism for the failed run — the system simply waits for the next interval. For daily jobs, this means a full 24-hour gap if one run fails.

---

## 6. Monitoring and Observability

### What exists
- **`jobSupervisor`** (`server/services/jobSupervisor.ts`): Tracks health state (healthy/degraded/failed), consecutive failures, duration, last run time. Creates `systemAlerts` after 3 consecutive failures. Detects stalled jobs (2.5x interval missed). Exposed via `/api/admin/job-health`.
- **`job_health_logs` table**: Written by `withJobLock` on success (sampled: 1 per hour per job) and on every failure.
- **`systemActivityLogger`**: Job errors are logged to `activity_log` via `logActivity()`.
- **Event mesh**: Job failures publish events via `eventMeshPublisher.jobFailed()`.

### P2-K: Incomplete supervisor coverage
Only **8 of 46+ jobs** report to `jobSupervisor` via `notifyResult()`:
- `campaign_optimizer`, `finance_agent`, `churn_engine`, `founder_briefing`, `outcome_analyzer`, `telemetry_optimizer`, `model_intelligence`, `self_assessment`, `evolution_pipeline`, `data_retention`

The remaining ~36 jobs are invisible to the supervisor. They use `withJobLock` which logs to `job_health_logs`, but the supervisor's real-time health dashboard (`getAll()`) does not know about them. The supervisor's stall detection (`checkHealth()`) only works for registered jobs.

### P2-L: Success logging is sampled at 1/hour
The `withJobLock` wrapper (line 136-141) only logs success to `job_health_logs` once per hour per job. For a 10-second interval job (API queue), this means 359 out of 360 success runs per hour are unrecorded. While this reduces log volume, it makes it impossible to detect intermittent timing issues or performance degradation from the logs alone.

---

## 7. Graceful Shutdown

### What works
- **`trackInterval` + `__bgIntervals` array** (line 98-108): All 44 `trackInterval` handles are cleared on SIGTERM/SIGINT.
- **Graceful shutdown handler** (line 748-784): Clears intervals, closes HTTP server, drains DB pools, gives 5s for in-flight work, force-exits after 30s.
- **BullMQ worker**: Has its own SIGTERM/SIGINT handler that closes the worker and queue (line 336-344 of `jobQueue.ts`).

### P1-M: 15 untracked `setInterval` calls will leak
As enumerated in section 1b, 15 bare `setInterval` calls across `routes.ts`, middleware, and service files are NOT tracked. These timers continue firing during the shutdown window, potentially:
- Writing to the DB after pools start draining.
- Making external API calls (health checks, external monitoring) during shutdown.
- Sending emails (sequence processor, founder digest) while the system is draining.

### P2-N: Untracked `setTimeout` calls (~12 instances)
The startup `setTimeout` calls in `index.ts` (for initial delayed runs) are never cleared. On a very fast restart cycle, these could fire after the new instance is already running.

---

## 8. Resource Contention

### DB Pool Configuration
- **Primary pool**: 20 connections max (`server/db.ts:29`)
- **Replica pool**: 5 connections max (default, `server/db.ts:58`)
- **Deployment**: 2 Fly.io machines

### P1-O: 46+ concurrent jobs compete for 20 DB connections
At any given moment, multiple background jobs are active:
- 10-second jobs: API queue, event mesh drain
- 1-minute jobs: scheduled tasks, pax scheduler, rate limit cleanup
- 2-minute jobs: agent reaction processor, job supervisor health
- 5-minute jobs: realtime alert sync, agent proactive engine, consensus execution, multiple time-gated polls

During the 2-3 AM UTC window, an additional burst of nightly jobs fires:
- Data retention, outcome analyzer, telemetry optimizer, satellite image update, deal hunter scraping, data ingest, county assessor ingest, DB backup

Each of these jobs acquires a DB connection. With 20 max connections across 2 instances (10 effective per instance), there is significant risk of connection exhaustion during nightly batch windows. The `connectionTimeoutMillis: 10_000` setting means a job waiting for a connection will block for up to 10 seconds before failing.

### P2-P: No connection pool partitioning
All jobs, API requests, and background tasks share the same 20-connection pool. There is no reservation mechanism to ensure API requests (user-facing) can always get a connection even when background jobs are saturating the pool.

---

## 9. Summary of Findings

### P0 (Ships Broken)
| ID | Finding | Location |
|----|---------|----------|
| P0-I | BullMQ jobs likely non-functional (Redis package missing) — 14 cron jobs silently degraded | `server/jobs/*.ts`, orientation doc P0 #4 |

### P1 (Ships Bad)
| ID | Finding | Location |
|----|---------|----------|
| P1-D | Growth automation + digest emails not idempotent — double-send risk | `server/jobs/growthAutomation.ts`, `server/services/founderDigest.ts` |
| P1-E | Duplicate scheduling — founderDigest and revenueProtection start their OWN setInterval AND are called from index.ts | `server/services/founderDigest.ts:259`, `server/services/revenueProtection.ts:318`, `server/index.ts:569-585` |
| P1-H | No same-instance overlap guard on most interval jobs — async callbacks can stack | `server/index.ts` (API queue, reaction processor, proactive engine, etc.) |
| P1-M | 15 untracked `setInterval` calls leak timers during shutdown | `server/routes.ts`, `server/middleware/`, `server/services/` (see section 1b) |
| P1-O | 46+ concurrent jobs sharing 20 DB connections — exhaustion risk during nightly window | `server/db.ts:29`, `server/index.ts` |

### P2 (Should Fix)
| ID | Finding | Location |
|----|---------|----------|
| P2-A | Double error handling silently marks failed jobs as success | Multiple `process*` functions |
| P2-B | Churn engine and founder briefing lack `withJobLock` — multi-instance duplicate execution | `server/index.ts:1631-1663` |
| P2-C | ~12 startup `setTimeout` handles untracked for shutdown | `server/index.ts` (lines 883, 937, 974, etc.) |
| P2-F | Pax nudges sends notifications without dedup guard | `server/index.ts:1153-1177` |
| P2-G | Autonomous decision executor may duplicate actions on concurrent runs | `server/index.ts:1559-1587` |
| P2-J | No retry/dead-letter for failed setInterval job runs | Systemic |
| P2-K | Only 8/46+ jobs report to jobSupervisor — most are invisible to health dashboard | `server/index.ts`, `server/services/jobSupervisor.ts` |
| P2-L | Success logs sampled at 1/hour — insufficient for debugging timing issues | `server/index.ts:136-141` |
| P2-N | ~12 untracked `setTimeout` calls during startup | `server/index.ts` |
| P2-P | No DB pool partitioning between API and background jobs | `server/db.ts` |

---

## 10. Recommendations (Priority Order)

1. **Fix Redis/BullMQ** — resolve the missing Redis package and verify `REDIS_URL` is set in production. Until then, 14 cron jobs are silently dead.
2. **Add `withJobLock` to churn engine and founder briefing** — both currently fire on all instances simultaneously.
3. **Add same-instance overlap guards** — wrap each `setInterval` callback with an `isRunning` boolean check so a slow execution does not stack with the next invocation.
4. **Track all `setInterval` calls** — convert the 15 bare `setInterval` calls in `routes.ts`, middleware, and services to use `trackInterval()` or store handles for cleanup.
5. **Register all jobs with `jobSupervisor`** — add `notifyResult` calls to the ~36 unregistered jobs so the health dashboard has full visibility.
6. **Add DB pool partitioning** — create a separate pool (5-8 connections) dedicated to background jobs, leaving the primary pool for API traffic.
7. **Stagger nightly jobs** — the 2-3 AM UTC window has too many overlapping batch jobs. Spread them across the 10 PM - 6 AM window.
8. **Fix duplicate scheduling** — `founderDigest.ts` and `revenueProtection.ts` should not start their own intervals when `index.ts` already schedules them.
9. **Track startup `setTimeout` handles** for graceful shutdown cleanup.
