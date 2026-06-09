/**
 * Scheduled-job health surface.
 *
 * The Critic agent flagged that scheduled jobs (morningBrief,
 * cmoBroadcast, autonomousDealMachine, dunning sweeper, etc.) can
 * silently stop running and the only signal is server logs. From the
 * user's perspective, Pax/Sophie/Atlas "just stop happening." This
 * route reads the `job_health_logs` table (the one `withJobLock` in
 * jobRuntime.ts actually writes, keyed by the snake_case logical job
 * names) and reports per-job last-liveness and stale-ness so the
 * client can surface a "Pax is behind" / "Morning brief paused" card
 * on /today. Job names come from the canonical JOB_ROSTER so this can
 * never drift back into reporting phantom never_ran rows.
 *
 * Read-only and cheap — one indexed query per job name. Cached
 * client-side at 60s staleTime so this isn't a hot path.
 *
 * GET /api/jobs/health → { jobs: [{ name, lastSuccessAt, lastFailureAt,
 *                                    consecutiveFailures, status,
 *                                    isStale, expectedIntervalMs }] }
 */

import type { Express, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { jobHealthLogs, drDrills } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { JOB_ROSTER } from "./jobs/jobRegistry";

/**
 * Jobs we surface in the user-facing health card, derived from the canonical
 * JOB_ROSTER so this endpoint can never again drift from what's actually
 * scheduled. Previously this hardcoded 8 camelCase names that were NEVER
 * written to the source table — so the endpoint permanently reported
 * "never_ran" for every row. We now (a) source names from the roster (the same
 * snake_case logical names `withJobLock` writes) and (b) read from
 * `job_health_logs` (the table the writer ACTUALLY populates) instead of
 * `job_runs`. The 2× multiplier is the "stale" threshold.
 *
 * We surface the customer-facing subset (the autopilots a user would notice
 * "just stopped happening"), not all ~118 internal jobs — but every name here
 * is guaranteed to exist in the roster + be written by the runtime.
 */
const SURFACED_JOBS: Record<string, string> = {
  atlas_morning_brief_daily: "Morning brief",
  founder_briefing_daily: "Daily briefing",
  pax_nudges: "Pax nudges",
  autonomous_deal_machine: "Deal autopilot",
  scheduled_tasks: "Task processor",
  churn_engine_daily: "Churn engine",
  dunning_tasks: "Dunning",
  onboarding_scheduler: "Onboarding",
};

const TRACKED_JOBS: Array<{ name: string; label: string; intervalMs: number }> =
  JOB_ROSTER.filter((e) => e.name in SURFACED_JOBS).map((e) => ({
    name: e.name,
    label: SURFACED_JOBS[e.name],
    intervalMs: e.intervalMs,
  }));

interface JobHealth {
  name: string;
  label: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  status: "ok" | "stale" | "failing" | "never_ran";
  expectedIntervalMs: number;
  isStale: boolean;
}

export function registerJobHealthRoutes(app: Express): void {
  app.get(
    "/api/jobs/health",
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const now = Date.now();
        const out: JobHealth[] = [];

        for (const j of TRACKED_JOBS) {
          // Last liveness: success OR skipped_lock both prove the job ran
          // (a lock-skipped job is alive — another machine won the lock).
          // job_health_logs success rows are sampled (≤1/hr/process), so we
          // anchor "ran successfully" on the broader liveness set.
          const [lastSuccess] = await db
            .select({ at: jobHealthLogs.runStartedAt })
            .from(jobHealthLogs)
            .where(
              and(
                eq(jobHealthLogs.jobName, j.name),
                sql`${jobHealthLogs.status} IN ('success', 'skipped_lock')`,
              ),
            )
            .orderBy(desc(jobHealthLogs.runStartedAt))
            .limit(1);

          // Last failure
          const [lastFailure] = await db
            .select({ at: jobHealthLogs.runStartedAt })
            .from(jobHealthLogs)
            .where(
              and(
                eq(jobHealthLogs.jobName, j.name),
                sql`${jobHealthLogs.status} IN ('failed', 'timeout')`,
              ),
            )
            .orderBy(desc(jobHealthLogs.runStartedAt))
            .limit(1);

          // Consecutive failures: count failures more recent than the
          // last liveness row.
          let consecutiveFailures = 0;
          if (lastFailure?.at) {
            const sinceTs = lastSuccess?.at ?? new Date(0);
            const [cnt] = await db
              .select({ n: sql<number>`COUNT(*)::int` })
              .from(jobHealthLogs)
              .where(
                and(
                  eq(jobHealthLogs.jobName, j.name),
                  sql`${jobHealthLogs.status} IN ('failed', 'timeout')`,
                  sql`${jobHealthLogs.runStartedAt} > ${sinceTs}`,
                ),
              );
            consecutiveFailures = Number(cnt?.n ?? 0);
          }

          const lastSuccessMs = lastSuccess?.at ? new Date(lastSuccess.at).getTime() : 0;
          const isStale = !lastSuccessMs || now - lastSuccessMs > j.intervalMs * 2;

          let status: JobHealth["status"];
          if (!lastSuccessMs && !lastFailure?.at) status = "never_ran";
          else if (consecutiveFailures >= 3) status = "failing";
          else if (isStale) status = "stale";
          else status = "ok";

          out.push({
            name: j.name,
            label: j.label,
            lastSuccessAt: lastSuccess?.at ? new Date(lastSuccess.at).toISOString() : null,
            lastFailureAt: lastFailure?.at ? new Date(lastFailure.at).toISOString() : null,
            consecutiveFailures,
            status,
            expectedIntervalMs: j.intervalMs,
            isStale,
          });
        }

        // Kareem §7: surface DR drill staleness alongside job health. A
        // drill that hasn't run in > 100 days is "stale" (quarterly cadence
        // = 91 days + slack); > 200 days is "failing." Pulls the most
        // recent dr_drills row.
        const DRILL_STALE_DAYS = 100;
        const DRILL_FAILING_DAYS = 200;
        const [lastDrill] = await db
          .select({
            id: drDrills.id,
            ranAt: drDrills.ranAt,
            totalRtoMinutes: drDrills.totalRtoMinutes,
            passedRtoTarget: drDrills.passedRtoTarget,
          })
          .from(drDrills)
          .orderBy(desc(drDrills.ranAt))
          .limit(1);

        let drDrill: {
          lastRanAt: string | null;
          daysSince: number | null;
          status: "ok" | "stale" | "failing" | "never_ran";
          lastTotalRtoMinutes: number | null;
          lastPassedRtoTarget: boolean | null;
        } = {
          lastRanAt: null,
          daysSince: null,
          status: "never_ran",
          lastTotalRtoMinutes: null,
          lastPassedRtoTarget: null,
        };

        if (lastDrill?.ranAt) {
          const days = Math.floor((Date.now() - new Date(lastDrill.ranAt).getTime()) / 86_400_000);
          drDrill = {
            lastRanAt: new Date(lastDrill.ranAt).toISOString(),
            daysSince: days,
            status: days > DRILL_FAILING_DAYS ? "failing" : days > DRILL_STALE_DAYS ? "stale" : "ok",
            lastTotalRtoMinutes: lastDrill.totalRtoMinutes ?? null,
            lastPassedRtoTarget: lastDrill.passedRtoTarget ?? null,
          };
        }

        return res.json({ jobs: out, drDrill });
      } catch (err) {
        logger.error("jobs.health failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
