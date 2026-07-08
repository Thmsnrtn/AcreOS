/**
 * scheduleSelfRescheduling — Phase 3 Week 7-8 background-jobs hardening.
 *
 * Why this exists
 * ───────────────
 * The legacy AcreOS background-job pattern uses `setInterval(fn, ms)`. That
 * fires on a wall-clock cadence regardless of whether the previous run is
 * still in flight, which in production has caused:
 *
 *   1. Concurrent overlapping runs of the same job (e.g. dunning sweeper
 *      double-charging customers when the previous run hadn't finished).
 *   2. Silent failure: errors thrown out of the interval callback are lost
 *      to the void with no DB record, no DLQ, no alert.
 *   3. No backoff: a failing job will retry on every tick until something
 *      else notices.
 *
 * `scheduleSelfRescheduling` replaces that pattern with a self-rescheduling
 * `setTimeout` chain:
 *
 *   - Each invocation `await`s `run()` to completion (success or thrown).
 *   - Only after the run resolves does it schedule the next run.
 *   - On error the failure is logged + persisted to `job_runs` (status
 *     `failure`) + dead-lettered to `outbox_dlq`, and the next run is
 *     delayed by an exponential backoff capped at 1 hour.
 *   - Returns a cancel function that clears the pending timer and prevents
 *     any further runs from being scheduled.
 *
 * Observability
 * ─────────────
 * Every run inserts a `job_runs` row before it starts (status=running) and
 * updates it on completion (status=success|failure with errorMessage,
 * recordsProcessed). Operators can query `job_runs` for SLO dashboards and
 * the in-memory state (`getJobRuntimeStatus`) is used by the existing job
 * supervisor's stuck-job detector.
 *
 * Failure mode
 * ────────────
 * If the DB itself is down, the row inserts will throw — we swallow those
 * errors so the scheduler keeps making forward progress. The `run()`
 * function's own error path is unaffected.
 */

import crypto from "crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { db } from "../db";
import { jobLocks, jobRuns, outboxDlq } from "@shared/schema";
import { logger } from "../utils/logger";
import { coerceTimerDelay } from "../utils/safeTimer";

/**
 * FNV-1a 64-bit hash → signed bigint. Kept exported for existing unit tests
 * and any future advisory-lock use, but the scheduler itself no longer uses
 * advisory locks (see the lease-row pattern below).
 */
export function fnv1a64Signed(input: string): bigint {
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i) & 0xff);
    h = (h * FNV_PRIME) & MASK;
  }
  // Reinterpret as signed int64: if the top bit is set, subtract 2^64.
  return h >= 0x8000000000000000n ? h - 0x10000000000000000n : h;
}

// ── Lease-row mutual exclusion (Tier 1H — job bodies OUT of transactions) ──
//
// The previous design held a `pg_try_advisory_xact_lock` for the ENTIRE
// `run()` body by executing it inside `db.transaction(...)`. That pinned a
// pool connection in `idle in transaction` for the full duration of every
// scheduled job — the 60-second idle-in-transaction landmine: any ETL/AI job
// body slower than the Postgres `idle_in_transaction_session_timeout` (or a
// pgBouncer transaction-mode pool) gets its connection killed mid-run, and
// a hung body wedges a pool slot indefinitely.
//
// The replacement is a LEASE ROW in the existing `job_locks` table:
//
//   1. CLAIM   — one short atomic statement (conditional UPDATE…RETURNING,
//                INSERT fallback) sets locked_by/expires_at. No transaction
//                is held open.
//   2. RUN     — the job body executes OUTSIDE any transaction. A heartbeat
//                timer re-extends the lease every HEARTBEAT_MS so long jobs
//                keep ownership without a long TTL.
//   3. RELEASE — completion (success or failure) deletes the lease row.
//
// Crash semantics: if the process dies mid-run the heartbeat stops and the
// lease expires after LEASE_TTL_SECONDS — another machine picks the job up
// on its next tick (the advisory lock released instantly on crash; a ≤2-min
// pickup delay is the accepted cost of unpinning connections).
//
// The lease name is prefixed `sched:` so it can never collide with
// `withJobLock(...)` entries that job bodies themselves take out under the
// same logical name (same table, same instance — an unprefixed name would
// let the body's `releaseJobLock` delete the scheduler's lease mid-run).

const LEASE_TTL_SECONDS = 120;
const HEARTBEAT_MS = 40_000; // extend at 3× the rate the TTL expires

// One UUID per Node process — the lease-owner identity. Deliberately local
// (not jobRuntime.instanceId) so importing the scheduler never drags in the
// full storage layer.
export const schedulerInstanceId = crypto.randomUUID();

/**
 * Atomically claim (or re-extend) the lease row for `leaseName`.
 * Exactly one concurrent claimer wins: the conditional UPDATE only matches
 * an expired row or one we already own, and the INSERT fallback loses by
 * unique-constraint (23505) when another claimer got there first.
 */
export async function claimJobLease(
  leaseName: string,
  ownerId: string,
  ttlSeconds: number = LEASE_TTL_SECONDS,
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const updated = await db
    .update(jobLocks)
    .set({ lockedBy: ownerId, lockedAt: now, expiresAt })
    .where(
      and(
        eq(jobLocks.jobName, leaseName),
        or(lt(jobLocks.expiresAt, now), eq(jobLocks.lockedBy, ownerId)),
      ),
    )
    .returning({ id: jobLocks.id });
  if (updated.length > 0) return true;

  try {
    await db.insert(jobLocks).values({ jobName: leaseName, lockedBy: ownerId, expiresAt });
    return true;
  } catch (err) {
    // 23505 = unique violation: another claimer inserted between our UPDATE
    // and INSERT — they own the lease. drizzle-orm ≥0.4x wraps the pg error
    // in DrizzleQueryError with code on err.CAUSE, not err — checking only
    // err.code turned every lease-contended tick into a job-run failure +
    // DLQ row instead of a graceful skip (WS5 worker-kill drill, 2026-07-08).
    const code =
      (err as { code?: string })?.code ??
      ((err as { cause?: { code?: string } })?.cause?.code);
    if (code === "23505") return false;
    throw err;
  }
}

/** Release the lease iff we still own it. Best-effort. */
export async function releaseJobLease(leaseName: string, ownerId: string): Promise<void> {
  await db
    .delete(jobLocks)
    .where(and(eq(jobLocks.jobName, leaseName), eq(jobLocks.lockedBy, ownerId)));
}

// ── Graceful-shutdown bookkeeping (Tier 1H) ─────────────────────────────────
// The worker entrypoint needs to know which scheduled jobs are mid-body on
// SIGTERM so it can drain them before exiting, and needs a way to stop new
// ticks from being scheduled.

const _inFlightJobs = new Set<string>();
const _cancelFns = new Set<() => void>();

/** Names of scheduled jobs whose body is currently executing. */
export function getInFlightScheduledJobs(): string[] {
  return Array.from(_inFlightJobs);
}

/** Cancel every registered scheduler — no further ticks will fire. */
export function cancelAllScheduledJobs(): void {
  for (const cancel of _cancelFns) {
    try {
      cancel();
    } catch (err) {
      logger.warn("[jobs] cancel fn threw during shutdown", {
        metadata: { error: String(err) },
      });
    }
  }
}

export interface SelfReschedulingOpts {
  /** Logical job name. Used for `job_runs.job_name` and DLQ event_type. */
  name: string;
  /** Base interval in ms between successful runs. */
  intervalMs: number;
  /** The work to perform. May return number of records processed. */
  run: () => Promise<void | number>;
  /** Optional error sink. Defaults to logger.error + DLQ. */
  onError?: (err: unknown) => void;
  /**
   * Cap for exponential backoff in ms. Default: 1 hour. Backoff doubles each
   * consecutive failure starting from `intervalMs * 2`.
   */
  maxBackoffMs?: number;
  /**
   * Optional initial delay before the first run. Defaults to 0 (run
   * immediately on schedule).
   */
  initialDelayMs?: number;
}

interface JobRuntimeStatus {
  name: string;
  lastRunStartedAt: Date | null;
  lastRunCompletedAt: Date | null;
  lastStatus: "running" | "success" | "failure" | null;
  consecutiveFailures: number;
  cancelled: boolean;
}

const _runtimeStatus = new Map<string, JobRuntimeStatus>();

export function getJobRuntimeStatus(name: string): JobRuntimeStatus | undefined {
  return _runtimeStatus.get(name);
}

export function getAllJobRuntimeStatus(): JobRuntimeStatus[] {
  return Array.from(_runtimeStatus.values());
}

/**
 * Compute exponential backoff for the Nth consecutive failure.
 * Exposed for unit testing — keep in sync with the inline use below.
 */
export function computeBackoffMs(
  intervalMs: number,
  consecutiveFailures: number,
  maxBackoffMs = 60 * 60 * 1000,
): number {
  if (consecutiveFailures <= 0) return intervalMs;
  // First failure: intervalMs * 2, second: intervalMs * 4, ...
  const backoff = intervalMs * Math.pow(2, consecutiveFailures);
  return Math.min(backoff, maxBackoffMs);
}

export function scheduleSelfRescheduling(opts: SelfReschedulingOpts): () => void {
  const {
    name,
    intervalMs,
    run,
    onError,
    maxBackoffMs = 60 * 60 * 1000,
    initialDelayMs = 0,
  } = opts;

  const status: JobRuntimeStatus = {
    name,
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    lastStatus: null,
    consecutiveFailures: 0,
    cancelled: false,
  };
  _runtimeStatus.set(name, status);

  let timer: NodeJS.Timeout | null = null;

  const insertJobRunStart = async (): Promise<number | null> => {
    try {
      const [row] = await db
        .insert(jobRuns)
        .values({
          jobName: name,
          completedAt: null,
          status: "running",
          errorMessage: null,
          recordsProcessed: null,
        })
        .returning({ id: jobRuns.id });
      return row?.id ?? null;
    } catch (err) {
      // Best-effort observability — never block the job because the
      // observability table is unhappy.
      logger.warn(`[jobs:${name}] failed to insert job_runs start row`, {
        metadata: { error: String(err) },
      });
      return null;
    }
  };

  const updateJobRunEnd = async (
    runId: number | null,
    completed: { status: "success" | "failure"; errorMessage?: string; recordsProcessed?: number },
  ): Promise<void> => {
    if (runId == null) return;
    try {
      const { eq } = await import("drizzle-orm");
      await db
        .update(jobRuns)
        .set({
          completedAt: new Date(),
          status: completed.status,
          errorMessage: completed.errorMessage ?? null,
          recordsProcessed: completed.recordsProcessed ?? null,
        })
        .where(eq(jobRuns.id, runId));
    } catch (err) {
      logger.warn(`[jobs:${name}] failed to update job_runs end row`, {
        metadata: { error: String(err) },
      });
    }
  };

  const deadLetter = async (err: unknown): Promise<void> => {
    try {
      await db.insert(outboxDlq).values({
        eventType: `job:${name}`,
        payload: { jobName: name, intervalMs, consecutiveFailures: status.consecutiveFailures },
        status: "failed",
        attempts: status.consecutiveFailures,
        lastErrorAt: new Date(),
        failureReason: err instanceof Error ? err.message : String(err),
      });
    } catch (dlqErr) {
      logger.error(`[jobs:${name}] failed to dead-letter run`, dlqErr);
    }
  };

  const tick = async (): Promise<void> => {
    if (status.cancelled) return;

    // Tier 1H lease-row pattern: a SHORT atomic claim takes the lease, the
    // job body runs OUTSIDE any transaction (no idle-in-transaction pinning),
    // a heartbeat re-extends the lease for long bodies, and completion
    // releases it. See the module header above claimJobLease for rationale.
    status.lastRunStartedAt = new Date();
    status.lastStatus = "running";

    let nextDelayMs = intervalMs;
    let claimed = false;
    let runId: number | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    const leaseName = `sched:${name}`;

    try {
      claimed = await claimJobLease(leaseName, schedulerInstanceId);
      if (!claimed) {
        logger.info(`[jobs:${name}] skipped tick — lease held by another machine`, {
          metadata: { jobName: name },
        });
        // Skipped tick — reset status and reschedule on the normal cadence.
        status.lastStatus = null;
        status.lastRunCompletedAt = new Date();
      } else {
        _inFlightJobs.add(name);

        // Heartbeat: keep the lease alive while the body runs so a long job
        // isn't stolen by another machine after LEASE_TTL_SECONDS. Losing
        // the lease (e.g. a DB hiccup let it expire and another machine
        // claimed it) is logged loudly but does not abort the body — the
        // body's own withJobLock/idempotency guards are the second fence.
        heartbeat = setInterval(() => {
          claimJobLease(leaseName, schedulerInstanceId).then(
            (ok) => {
              if (!ok) {
                logger.warn(`[jobs:${name}] lease heartbeat lost ownership — another machine may pick this job up`, {
                  metadata: { jobName: name },
                });
              }
            },
            (err) => {
              logger.warn(`[jobs:${name}] lease heartbeat failed (non-fatal)`, {
                metadata: { error: String(err) },
              });
            },
          );
        }, HEARTBEAT_MS);
        heartbeat.unref?.();

        runId = await insertJobRunStart();

        // The body runs with NO transaction and NO advisory lock held.
        const recordsProcessed = await run();

        status.lastRunCompletedAt = new Date();
        status.lastStatus = "success";
        status.consecutiveFailures = 0;
        await updateJobRunEnd(runId, {
          status: "success",
          recordsProcessed: typeof recordsProcessed === "number" ? recordsProcessed : undefined,
        });
      }
    } catch (err) {
      status.lastRunCompletedAt = new Date();
      status.lastStatus = "failure";
      status.consecutiveFailures += 1;

      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[jobs:${name}] run failed (#${status.consecutiveFailures})`, err, {
        metadata: { jobName: name, consecutiveFailures: status.consecutiveFailures },
      });

      await updateJobRunEnd(runId, { status: "failure", errorMessage: message });
      await deadLetter(err);

      try {
        onError?.(err);
      } catch (sinkErr) {
        logger.warn(`[jobs:${name}] onError sink threw`, {
          metadata: { error: String(sinkErr) },
        });
      }

      nextDelayMs = computeBackoffMs(intervalMs, status.consecutiveFailures, maxBackoffMs);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (claimed) {
        _inFlightJobs.delete(name);
        await releaseJobLease(leaseName, schedulerInstanceId).catch((err) => {
          // Best-effort: an unreleased lease simply expires after the TTL.
          logger.warn(`[jobs:${name}] lease release failed (lease will expire)`, {
            metadata: { error: String(err) },
          });
        });
      }
    }

    if (status.cancelled) return;
    const safeNext = coerceTimerDelay(nextDelayMs, `jobs:${name}:nextDelayMs`);
    if (safeNext === null) {
      logger.error(`[jobs:${name}] refusing to reschedule — nextDelayMs is not a usable number`, undefined, {
        metadata: { nextDelayMs: String(nextDelayMs) },
      });
      return;
    }
    timer = setTimeout(tick, safeNext);
  };

  // Kick off the first run after the optional initial delay.
  const safeInitial = coerceTimerDelay(initialDelayMs, `jobs:${name}:initialDelayMs`);
  if (safeInitial === null) {
    logger.error(`[jobs:${name}] refusing to start — initialDelayMs is not a usable number`, undefined, {
      metadata: { initialDelayMs: String(initialDelayMs) },
    });
    return function cancel() {
      status.cancelled = true;
    };
  }
  timer = setTimeout(tick, safeInitial);

  const cancel = function cancel() {
    status.cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  // Registered so the worker's SIGTERM path (cancelAllScheduledJobs) can stop
  // every scheduler from firing new ticks during drain.
  _cancelFns.add(cancel);
  return cancel;
}
