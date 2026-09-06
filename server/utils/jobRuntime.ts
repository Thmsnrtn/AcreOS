/**
 * Shared job-runtime primitives.
 *
 * Extracted from server/index.ts so both the customer-facing app process
 * (server/index.ts) AND the offload worker process (server/worker.ts) can
 * register scheduled background jobs. Production runs the app with
 * DISABLE_BACKGROUND_JOBS=1 — the ~70 start*Job calls would otherwise be
 * dark. By centralising instanceId / trackInterval / withJobLock / jobLog
 * here, the same helpers and lock semantics apply on either entrypoint.
 *
 * Module-scoped state (`instanceId`, `_jobLastSuccessLog`) is per-Node-
 * process; each Fly machine therefore gets its own UUID + its own
 * success-log sampling, which is correct — locking coordinates across
 * machines via the `job_locks` Postgres table, not via shared memory.
 */

import crypto from "crypto";
import { db, storage } from "../storage";
import { jobHealthLogs } from "@shared/schema";
import { logger } from "./logger";

// One UUID per Node process. Used as the lock-holder identifier so
// `releaseJobLock` only releases a lock this process actually owns.
export const instanceId = crypto.randomUUID();

// ── Background interval tracking for graceful shutdown ──────────────────────
// All setInterval calls for background jobs MUST use trackInterval() so they
// are cleared during SIGTERM/SIGINT shutdown. Bare setInterval() leaks timers
// and prevents graceful shutdown from completing.
(globalThis as any).__bgIntervals = (globalThis as any).__bgIntervals || [];

export function trackInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  const handle = setInterval(fn, ms);
  (globalThis as any).__bgIntervals.push(handle);
  return handle;
}

// Track last success log time per job to implement
// "1 success log per hour per job" sampling.
const _jobLastSuccessLog: Record<string, number> = {};

/**
 * Re-extend a held lease while its job body runs.
 *
 * The scheduler's own lease-row path learned this (scheduler.ts: HEARTBEAT_MS
 * at 3x the TTL expiry rate) when job bodies moved out of transactions. This
 * mechanism — the one job bodies take out for THEMSELVES, across 185 call
 * sites — did not. A body that outlives its TTL simply loses the lock, and the
 * next machine's tick acquires it and starts the same job concurrently: two
 * dunning runs, two nudge sends, two ETL writes.
 *
 * Most TTLs here are generous (60 * 60 is the commonest by far), so this was
 * never the everyday failure — but "the job finished inside an hour every time
 * so far" is a hope, not a lock, and the TTLs that are seconds-scale have no
 * margin at all.
 *
 * acquireJobLock already re-extends rather than refusing when the caller is
 * the current holder (its WHERE matches `lockedBy = instanceId`), so the
 * heartbeat is the same call on a timer. It is unref'd: a heartbeat must never
 * be the reason a process stays alive.
 */
function startLeaseHeartbeat(jobName: string, ttlSeconds: number): () => void {
  // A third of the TTL, floored so a very short lease still gets several
  // extensions and ceilinged so an all-day lease is not pinged pointlessly.
  const periodMs = Math.min(Math.max((ttlSeconds * 1000) / 3, 5_000), 15 * 60_000);
  const timer = setInterval(() => {
    void storage
      .acquireJobLock(jobName, instanceId, ttlSeconds)
      .then((held) => {
        if (!held) {
          // Losing a lease mid-run is worth knowing about: it means the body
          // overran its TTL far enough that another machine took it, and the
          // two are now running concurrently.
          logger.warn("[jobRuntime] lease lost while job was still running", {
            metadata: { jobName, ttlSeconds },
          });
        }
      })
      .catch(() => {
        /* transient db error — the next beat retries, the TTL is the backstop */
      });
  }, periodMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function withJobLock<T>(
  jobName: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const acquired = await storage.acquireJobLock(jobName, instanceId, ttlSeconds);
  if (!acquired) {
    jobLog(`Lock not acquired, skipping execution`, jobName);
    // Log skipped_lock (fire-and-forget, non-blocking)
    db.insert(jobHealthLogs).values({
      jobName,
      runStartedAt: new Date(),
      runCompletedAt: new Date(),
      durationMs: 0,
      status: "skipped_lock",
    }).catch(() => {/* best effort */});
    return null;
  }
  const startedAt = new Date();
  const stopHeartbeat = startLeaseHeartbeat(jobName, ttlSeconds);
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt.getTime();
    // Sample: only log success once per hour per job
    const now = Date.now();
    const lastLog = _jobLastSuccessLog[jobName] ?? 0;
    if (now - lastLog > 60 * 60 * 1000) {
      _jobLastSuccessLog[jobName] = now;
      db.insert(jobHealthLogs).values({
        jobName,
        runStartedAt: startedAt,
        runCompletedAt: new Date(),
        durationMs,
        status: "success",
      }).catch(() => {/* best effort */});
    }
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startedAt.getTime();
    // Always log failures
    db.insert(jobHealthLogs).values({
      jobName,
      runStartedAt: startedAt,
      runCompletedAt: new Date(),
      durationMs,
      status: "failed",
      errorMessage: err?.message ?? String(err),
    }).catch(() => {/* best effort */});
    // Phase B: Publish job failure to event mesh for real-time alerts
    import("../services/eventMeshPublisher").then(({ eventMeshPublisher }) => {
      eventMeshPublisher.jobFailed(jobName, err?.message ?? String(err), { durationMs }).catch(() => {});
    }).catch(() => {});
    throw err;
  } finally {
    stopHeartbeat();
    await storage.releaseJobLock(jobName, instanceId);
  }
}

/**
 * Timestamped logger matching the local `log()` in server/index.ts.
 * Used inside runScheduledJobs (extracted from index.ts) so the line
 * format stays identical to pre-extraction production logs.
 */
export function jobLog(message: string, source = "express"): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  logger.info(`${formattedTime} [${source}] ${message}`);
}
