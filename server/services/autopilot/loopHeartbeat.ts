/**
 * The brain's heartbeat — when did the Solene continuous tick last complete?
 *
 * The tick runs through `withJobLock` (runScheduledJobs.ts), which records to
 * `job_health_logs`, NOT `job_runs`. The founder banner read only `job_runs`,
 * so it said "the brain hasn't run a cycle yet" forever. deadmanCheck.ts
 * documents the same two-table trap: liveness lives in both tables depending
 * on how a job is scheduled, so this reads BOTH and takes the latest.
 *
 * withJobLock SAMPLES success rows (at most one per job per hour, per process),
 * so the latest recorded success can trail the real last cycle by up to that
 * interval. Staleness allows for it rather than flapping on a healthy loop.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { jobHealthLogs, jobRuns } from "@shared/schema";

const LOOP_JOB = "solene_continuous_tick";
const LOOP_CADENCE_MS = 30 * 60 * 1000;
/** withJobLock's success-row sampling interval (jobRuntime.ts). */
const SUCCESS_SAMPLE_MS = 60 * 60 * 1000;

export interface LoopHeartbeat {
  lastCycleAt: string | null;
  cadenceMs: number;
  nextDueAt: string | null;
  stale: boolean;
}

/** Pure: the banner shape from the latest recorded success. */
export function heartbeatFrom(last: Date | null, nowMs: number): LoopHeartbeat {
  if (!last) return { lastCycleAt: null, cadenceMs: LOOP_CADENCE_MS, nextDueAt: null, stale: false };
  return {
    lastCycleAt: last.toISOString(),
    cadenceMs: LOOP_CADENCE_MS,
    nextDueAt: new Date(last.getTime() + LOOP_CADENCE_MS).toISOString(),
    stale: nowMs - last.getTime() > 2 * LOOP_CADENCE_MS + SUCCESS_SAMPLE_MS,
  };
}

type Db = typeof import("../../db").db;

/** Latest successful completion of the tick across BOTH liveness tables. */
export async function readLoopLastSuccess(db: Db): Promise<Date | null> {
  const [health] = await db
    .select({ at: sql<Date | null>`max(${jobHealthLogs.runCompletedAt})` })
    .from(jobHealthLogs)
    .where(and(eq(jobHealthLogs.jobName, LOOP_JOB), eq(jobHealthLogs.status, "success"), isNotNull(jobHealthLogs.runCompletedAt)));
  const [runs] = await db
    .select({ at: sql<Date | null>`max(${jobRuns.completedAt})` })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobName, LOOP_JOB), eq(jobRuns.status, "success"), isNotNull(jobRuns.completedAt)));
  const seen = [health?.at, runs?.at].filter((d): d is Date => d != null).map((d) => new Date(d).getTime());
  return seen.length > 0 ? new Date(Math.max(...seen)) : null;
}
