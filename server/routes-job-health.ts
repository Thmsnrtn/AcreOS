/**
 * Scheduled-job health surface.
 *
 * The Critic agent flagged that scheduled jobs (morningBrief,
 * cmoBroadcast, autonomousDealMachine, dunning sweeper, etc.) can
 * silently stop running and the only signal is server logs. From the
 * user's perspective, Pax/Sophie/Atlas "just stop happening." This
 * route reads the `job_runs` table (the same one `scheduler.ts`
 * writes) and reports per-job last-success and stale-ness so the
 * client can surface a "Pax is behind" / "Morning brief paused" card
 * on /today.
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
import { jobRuns, drDrills } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

/**
 * Jobs we surface in the user-facing health card and their canonical
 * expected interval. Kept in sync with the schedules in
 * `server/jobs/runScheduledJobs.ts`. The 2× multiplier becomes the
 * "stale" threshold — a job that hasn't completed successfully in
 * twice its expected interval is treated as behind.
 */
const TRACKED_JOBS: Array<{ name: string; label: string; intervalMs: number }> = [
  { name: "morningBrief",            label: "Morning brief",      intervalMs: 24 * 60 * 60 * 1000 },
  { name: "dailyBriefing",           label: "Daily briefing",     intervalMs: 24 * 60 * 60 * 1000 },
  { name: "atlasPendingConfirmationNudger", label: "Pax nudges",  intervalMs: 60 * 60 * 1000 },
  { name: "autonomousDealMachine",   label: "Deal autopilot",     intervalMs: 60 * 60 * 1000 },
  { name: "autonomousTaskProcessor", label: "Task processor",     intervalMs: 15 * 60 * 1000 },
  { name: "cmoBroadcast",            label: "Outreach broadcasts", intervalMs: 60 * 60 * 1000 },
  { name: "noteDunning",             label: "Note dunning",       intervalMs: 24 * 60 * 60 * 1000 },
  { name: "embeddingRefresh",        label: "Search index",       intervalMs: 6 * 60 * 60 * 1000 },
];

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
          // Last success
          const [lastSuccess] = await db
            .select({ at: jobRuns.completedAt })
            .from(jobRuns)
            .where(
              and(
                eq(jobRuns.jobName, j.name),
                eq(jobRuns.status, "success"),
              ),
            )
            .orderBy(desc(jobRuns.completedAt))
            .limit(1);

          // Last failure
          const [lastFailure] = await db
            .select({ at: jobRuns.startedAt })
            .from(jobRuns)
            .where(
              and(
                eq(jobRuns.jobName, j.name),
                sql`${jobRuns.status} IN ('failure', 'timeout')`,
              ),
            )
            .orderBy(desc(jobRuns.startedAt))
            .limit(1);

          // Consecutive failures: count failures more recent than the
          // last success.
          let consecutiveFailures = 0;
          if (lastFailure?.at) {
            const sinceTs = lastSuccess?.at ?? new Date(0);
            const [cnt] = await db
              .select({ n: sql<number>`COUNT(*)::int` })
              .from(jobRuns)
              .where(
                and(
                  eq(jobRuns.jobName, j.name),
                  sql`${jobRuns.status} IN ('failure', 'timeout')`,
                  sql`${jobRuns.startedAt} > ${sinceTs}`,
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
