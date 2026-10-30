/**
 * Boot-time registration helpers split out of runScheduledJobs.ts (S3
 * decomposition; the god-file's line ratchet only goes down).
 */
import { storage } from "../storage";
import { logger } from "../utils/logger";
import { withJobLock } from "../utils/jobRuntime";

// Once-per-process guard (same pattern as atlasPendingConfirmationNudger's
// `started`). Every start*Job creates its own timer chain, so a second
// runScheduledJobs() in one process doubles every job's ticks — the 2026-10
// double-boot (index.ts imported via jobQueue → a second call beside the
// worker's own) did exactly that. The per-job lock cannot stop it: both loops
// hold the same process's instance id. Defense in depth behind the import-cycle
// fix: it must hold even if that cycle is ever reintroduced.
let scheduledJobsStarted = false;

/** true for the first caller in this process; later callers are refused loudly. */
export function claimScheduledJobsBoot(): boolean {
  if (!scheduledJobsStarted) {
    scheduledJobsStarted = true;
    return true;
  }
  // Name the duplicate call site so a future double-boot surfaces at boot
  // instead of hiding in tick counts.
  const callSite = (new Error().stack ?? "").split("\n").slice(2, 5).map((l) => l.trim()).join(" <- ");
  logger.error(
    "[runScheduledJobs] DUPLICATE CALL REFUSED — scheduled jobs are already running in this process; " +
      "a second boot would double every job. Find and remove the second caller.",
    undefined,
    { metadata: { callSite } },
  );
  return false;
}

/**
 * P0 #6 — Job-locks janitor + borrower-session cleanup (self-rescheduling).
 *
 * Moved verbatim from a module-scope registration in server/routes.ts, which
 * fired in both the app and the worker process (each ticked twice). Only WHERE
 * it is registered changed — what it cleans and how often did not. The
 * borrower-session cleanup shares the helper because both are idempotent
 * deletes that must never overlap themselves; stuck/failed runs surface in
 * `job_runs` and dead-letter to `outbox_dlq`.
 */
export function startJobLockJanitorJobs(): void {
  import('./scheduler').then(({ scheduleSelfRescheduling }) => {
    // Clean expired borrower sessions every hour (with job lock)
    scheduleSelfRescheduling({
      name: "clean_borrower_sessions",
      intervalMs: 60 * 60 * 1000,
      initialDelayMs: 60 * 60 * 1000,
      run: async () => {
        await withJobLock("clean_borrower_sessions", 300, async () => {
          try {
            const cleaned = await storage.cleanExpiredBorrowerSessions();
            if (cleaned > 0) {
              logger.info(`Cleaned ${cleaned} expired borrower sessions`);
            }
            return cleaned;
          } catch (err) {
            logger.error("Error cleaning expired borrower sessions", err instanceof Error ? err : undefined);
            return 0;
          }
        });
      },
    });

    // Clean expired job locks every 5 minutes
    scheduleSelfRescheduling({
      name: "clean_expired_job_locks",
      intervalMs: 5 * 60 * 1000,
      initialDelayMs: 5 * 60 * 1000,
      run: async () => {
        await storage.cleanExpiredJobLocks();
      },
    });
  }).catch((err) => {
    logger.error("Failed to register job-lock janitor", err instanceof Error ? err : undefined);
  });
}
