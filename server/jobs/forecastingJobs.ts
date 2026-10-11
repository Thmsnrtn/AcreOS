/**
 * W4 forecasting — the monthly vintage recorder, issuer and scorer.
 *
 * Its own module (the runScheduledJobs.ts monolith only shrinks); the
 * orchestrator calls `startForecastingMonthlyJob()` once. Fires on the 25th
 * of each month at 06:00 UTC (catching up later in the month if that hour was missed) — after the BLS state employment release (third
 * week) and the Census permits release, so last month is in. Single-flight via
 * the job lock; the deadman roster entry is `forecasting_monthly`.
 */
import { and, eq, gte } from "drizzle-orm";
import { jobHealthLogs } from "@shared/schema";
import { db } from "../db";
import { clock } from "../utils/clock";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

const ONE_HOUR_MS = 60 * 60 * 1000;
const FORECASTING_MONTHLY_DAY = 25;
const FORECASTING_MONTHLY_HOUR_UTC = 6;

/**
 * The start of this month's run window (the 25th, 06:00 UTC), or null before it.
 * A WINDOW, not a single hour: a deploy or restart across 06:00 on the 25th
 * used to skip the whole month until the deadman noticed. From the window's
 * start to month end the hourly tick runs the job once, unless a successful
 * run is already logged inside the window.
 */
export function forecastingWindowStart(now: Date): Date | null {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), FORECASTING_MONTHLY_DAY, FORECASTING_MONTHLY_HOUR_UTC));
  return now.getTime() >= start.getTime() ? start : null;
}

async function alreadyRanThisWindow(start: Date): Promise<boolean> {
  const rows = await db
    .select({ id: jobHealthLogs.id })
    .from(jobHealthLogs)
    .where(and(eq(jobHealthLogs.jobName, "forecasting_monthly"), eq(jobHealthLogs.status, "success"), gte(jobHealthLogs.runStartedAt, start)))
    .limit(1);
  return rows.length > 0;
}

export function startForecastingMonthlyJob(): void {
  log("Registering forecasting monthly run (from the 25th, 06:00 UTC, once a month)", "forecasting");
  trackInterval(() => {
    const start = forecastingWindowStart(clock.now());
    if (!start) return;
    alreadyRanThisWindow(start)
      .then((ran) => {
        if (ran) return;
        return withJobLock("forecasting_monthly", 60 * 60, async () => {
          const { runForecastingMonthly } = await import("../services/forecasting/monthlyJob");
          const r = await runForecastingMonthly();
          log(
            `[forecasting] recorded ${r.publicSeries.families.reduce((a, f) => a + f.rowsAppended, 0)} public rows, ` +
              `${r.outcomes.appended} outcomes; issued ${r.issued.engines.reduce((a, e) => a + e.issued, 0)}; scored ${r.scored}`,
            "forecasting",
          );
        });
      })
      .catch((err: unknown) => {
        log(`[forecasting] monthly run failed: ${err instanceof Error ? err.message : String(err)}`, "forecasting");
      });
  }, ONE_HOUR_MS);
}
