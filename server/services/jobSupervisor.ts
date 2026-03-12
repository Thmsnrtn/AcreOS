/**
 * jobSupervisor.ts
 *
 * Tracks the health of every background job in AcreOS.
 * - Wraps each job function with timing, success/failure tracking
 * - Detects when a job misses its expected interval (degraded)
 * - Creates a systemAlert if a job fails 3 consecutive times (failed)
 * - Exposes getAll() for the /api/admin/job-health endpoint
 *
 * Usage in server/index.ts:
 *   const wrappedFn = jobSupervisor.wrap("finance_agent", 30 * 60 * 1000, financeAgent.run);
 *   setInterval(wrappedFn, 30 * 60 * 1000);
 */

import { db } from "../db";
import { systemAlerts, organizations } from "@shared/schema";
import { logActivity } from "./systemActivityLogger";

export interface JobHealth {
  name: string;
  intervalMs: number;
  lastRunAt: Date | null;
  lastRunDurationMs: number | null;
  lastRunSuccess: boolean | null;
  consecutiveFailures: number;
  status: "healthy" | "degraded" | "failed" | "unknown";
  processedCount: number;
  lastError?: string;
}

const MAX_CONSECUTIVE_FAILURES = 3;
const HEALTH_CHECK_MULTIPLIER = 2.5; // miss 2.5x interval → degraded

class JobSupervisor {
  private jobs = new Map<string, JobHealth>();

  /** Register a job by name + expected interval. Call before wrapping. */
  register(name: string, intervalMs: number): void {
    if (!this.jobs.has(name)) {
      this.jobs.set(name, {
        name,
        intervalMs,
        lastRunAt: null,
        lastRunDurationMs: null,
        lastRunSuccess: null,
        consecutiveFailures: 0,
        status: "unknown",
        processedCount: 0,
      });
    }
  }

  /**
   * Wrap a job function with health tracking.
   * Returns a new async function that:
   *  1. Records timing
   *  2. Updates health state on success/failure
   *  3. Logs to systemActivity on error
   *  4. Creates systemAlert after MAX_CONSECUTIVE_FAILURES
   */
  wrap<T>(
    name: string,
    intervalMs: number,
    fn: () => Promise<T>
  ): () => Promise<T | undefined> {
    this.register(name, intervalMs);

    return async (): Promise<T | undefined> => {
      const start = Date.now();
      try {
        const result = await fn();
        const durationMs = Date.now() - start;
        const job = this.jobs.get(name)!;
        job.lastRunAt = new Date();
        job.lastRunDurationMs = durationMs;
        job.lastRunSuccess = true;
        job.consecutiveFailures = 0;
        job.status = "healthy";
        job.processedCount += 1;
        return result;
      } catch (err: any) {
        const durationMs = Date.now() - start;
        const job = this.jobs.get(name)!;
        job.lastRunAt = new Date();
        job.lastRunDurationMs = durationMs;
        job.lastRunSuccess = false;
        job.consecutiveFailures += 1;
        job.lastError = err?.message ?? "Unknown error";

        if (job.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          job.status = "failed";
          // Create a platform-wide system alert (no org — it's a system issue)
          this.createJobFailureAlert(name, job.consecutiveFailures, err?.message).catch(() => {});
        } else {
          job.status = "degraded";
        }

        logActivity({
          job: name,
          action: "job_error",
          summary: `${name} failed (${job.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} consecutive): ${err?.message ?? "unknown error"}`,
          metadata: { consecutiveFailures: job.consecutiveFailures, durationMs },
        }).catch(() => {});

        // Don't re-throw — jobs should be resilient
        console.error(`[JobSupervisor] ${name} failed (attempt ${job.consecutiveFailures}):`, err?.message);
        return undefined;
      }
    };
  }

  /**
   * Called every 2 minutes from server/index.ts to detect stalled jobs.
   * If a job hasn't run in HEALTH_CHECK_MULTIPLIER * intervalMs, mark degraded.
   */
  checkHealth(): void {
    const now = Date.now();
    for (const [, job] of this.jobs) {
      if (job.status === "failed") continue; // already alerted
      if (!job.lastRunAt) continue; // hasn't run yet (server just started)

      const msSinceRun = now - job.lastRunAt.getTime();
      const stallThreshold = job.intervalMs * HEALTH_CHECK_MULTIPLIER;

      if (msSinceRun > stallThreshold && job.status !== "degraded") {
        job.status = "degraded";
        const minutesSince = Math.round(msSinceRun / 60_000);
        logActivity({
          job: name,
          action: "job_stalled",
          summary: `${job.name} appears stalled — last ran ${minutesSince} min ago (expected every ${Math.round(job.intervalMs / 60_000)} min)`,
          metadata: { minutesSince, intervalMs: job.intervalMs },
        }).catch(() => {});
        console.warn(`[JobSupervisor] ${job.name} is stalled (${minutesSince} min since last run)`);
      }
    }
  }

  /**
   * Simple alternative to wrap(): call this at the end of a processX() function.
   * Idempotent — registers the job if not already registered.
   */
  notifyResult(
    name: string,
    intervalMs: number,
    success: boolean,
    durationMs?: number,
    error?: string
  ): void {
    this.register(name, intervalMs);
    const job = this.jobs.get(name)!;
    job.lastRunAt = new Date();
    job.lastRunDurationMs = durationMs ?? null;
    job.lastRunSuccess = success;

    if (success) {
      job.consecutiveFailures = 0;
      job.status = "healthy";
      job.processedCount += 1;
    } else {
      job.consecutiveFailures += 1;
      job.lastError = error;
      if (job.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        job.status = "failed";
        this.createJobFailureAlert(name, job.consecutiveFailures, error).catch(() => {});
      } else {
        job.status = "degraded";
      }
      logActivity({
        job: name,
        action: "job_error",
        summary: `${name} run failed (${job.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} consecutive): ${error ?? "unknown"}`,
        metadata: { consecutiveFailures: job.consecutiveFailures },
      }).catch(() => {});
    }
  }

  /** Returns health snapshot for all registered jobs. */
  getAll(): JobHealth[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Returns summary counts for briefing email. */
  getSummary(): { healthy: number; degraded: number; failed: number; unknown: number } {
    let healthy = 0, degraded = 0, failed = 0, unknown = 0;
    for (const [, job] of this.jobs) {
      if (job.status === "healthy") healthy++;
      else if (job.status === "degraded") degraded++;
      else if (job.status === "failed") failed++;
      else unknown++;
    }
    return { healthy, degraded, failed, unknown };
  }

  private async createJobFailureAlert(
    jobName: string,
    consecutiveFailures: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      // Get one org to attach the alert to (use first org as platform-level proxy)
      const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
      if (!org) return;

      await db.insert(systemAlerts).values({
        organizationId: org.id,
        type: "system_error" as any,
        severity: "critical",
        title: `Background job "${jobName}" is failing`,
        message: `The ${jobName} job has failed ${consecutiveFailures} consecutive times. Last error: ${errorMessage ?? "unknown"}. Automated processes depending on this job may be paused.`,
        metadata: { jobName, consecutiveFailures, errorMessage },
      });
    } catch {
      // Never let the supervisor crash the server
    }
  }
}

export const jobSupervisor = new JobSupervisor();
