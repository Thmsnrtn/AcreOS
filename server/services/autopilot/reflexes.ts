/**
 * Founder Autopilot — reflex perception (Elite Vision H1: unify reflexes + brain).
 *
 * AcreOS runs ~118 autonomous jobs (churn rescue, dunning, lifecycle, compliance,
 * backups, ledger replay…) — its autonomic nervous system. Until now the brain
 * (the deliberative autopilot) ran BLIND to them: two parallel autonomy systems.
 * This module lets the brain perceive what the reflexes are doing by reading
 * job_health_logs, so a spike in autonomous-job failures becomes a first-class
 * stabilize signal (a failing dunning/billing job is a real business incident).
 *
 * summarizeReflexHealth is PURE → unit-testable; the read is best-effort and
 * degrades to the honest "all healthy / none known" default, never fabricated.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { jobHealthLogs } from "@shared/schema";
import { logger } from "../../utils/logger";

export interface ReflexHealth {
  /** Distinct job runs observed in the window. */
  totalRuns: number;
  /** Runs that ended failed or timed out (skipped_lock is NOT a failure). */
  failed: number;
  /** Names of jobs with at least one failure/timeout in the window. */
  failingJobs: string[];
  healthy: boolean;
}

interface RawRun {
  jobName: string;
  status: string;
}

/** Pure: roll raw job-health rows into a reflex-health summary. */
export function summarizeReflexHealth(rows: RawRun[]): ReflexHealth {
  const failing = new Set<string>();
  let failed = 0;
  for (const r of rows) {
    if (r.status === "failed" || r.status === "timeout") {
      failed += 1;
      failing.add(r.jobName);
    }
  }
  return {
    totalRuns: rows.length,
    failed,
    failingJobs: [...failing].sort(),
    healthy: failed === 0,
  };
}

/** Read + summarize reflex health over the window. Best-effort (honest default). */
export async function readReflexHealth(windowHours = 6): Promise<ReflexHealth> {
  try {
    const rows = await db
      .select({ jobName: jobHealthLogs.jobName, status: jobHealthLogs.status })
      .from(jobHealthLogs)
      .where(sql`${jobHealthLogs.runStartedAt} > now() - (${windowHours} || ' hours')::interval`)
      .limit(5000);
    return summarizeReflexHealth(rows);
  } catch (err) {
    logger.warn("[autopilot/reflexes] reflex-health read failed; defaulting to healthy-unknown", err instanceof Error ? err : undefined);
    return { totalRuns: 0, failed: 0, failingJobs: [], healthy: true };
  }
}

/** One-line reflex-health summary for the daily letter. Pure. */
export function reflexHealthLine(h: ReflexHealth): string {
  if (h.totalRuns === 0) return "Autonomous jobs: no runs observed in window.";
  if (h.healthy) return `Autonomous jobs: ${h.totalRuns} run(s), all healthy.`;
  return `Autonomous jobs: ${h.failed} failure(s) across ${h.failingJobs.length} job(s) — ${h.failingJobs.slice(0, 5).join(", ")}.`;
}
