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

import { db } from "../db";
import { jobRuns, outboxDlq } from "@shared/schema";
import { logger } from "../utils/logger";
import { coerceTimerDelay } from "../utils/safeTimer";

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

    status.lastRunStartedAt = new Date();
    status.lastStatus = "running";
    const runId = await insertJobRunStart();

    let nextDelayMs = intervalMs;

    try {
      const recordsProcessed = await run();
      status.lastRunCompletedAt = new Date();
      status.lastStatus = "success";
      status.consecutiveFailures = 0;
      await updateJobRunEnd(runId, {
        status: "success",
        recordsProcessed: typeof recordsProcessed === "number" ? recordsProcessed : undefined,
      });
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

  return function cancel() {
    status.cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
