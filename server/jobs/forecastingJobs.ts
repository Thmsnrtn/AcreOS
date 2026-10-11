/**
 * W4 forecasting — the monthly vintage recorder, issuer and scorer.
 *
 * Its own module (the runScheduledJobs.ts monolith only shrinks); the
 * orchestrator calls `startForecastingMonthlyJob()` once. Fires on the 25th
 * of each month at 06:00 UTC — after the BLS state employment release (third
 * week) and the Census permits release, so last month is in. Single-flight via
 * the job lock; the deadman roster entry is `forecasting_monthly`.
 */
import { clock } from "../utils/clock";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

const ONE_HOUR_MS = 60 * 60 * 1000;
export const FORECASTING_MONTHLY_DAY = 25;
export const FORECASTING_MONTHLY_HOUR_UTC = 6;

/** True in the one hour a month the job does its work. */
export function isForecastingHour(now: Date): boolean {
  return now.getUTCDate() === FORECASTING_MONTHLY_DAY && now.getUTCHours() === FORECASTING_MONTHLY_HOUR_UTC;
}

export function startForecastingMonthlyJob(): void {
  log("Registering forecasting monthly run (25th, 06:00 UTC)", "forecasting");
  trackInterval(() => {
    if (!isForecastingHour(clock.now())) return;
    withJobLock("forecasting_monthly", 60 * 60, async () => {
      const { runForecastingMonthly } = await import("../services/forecasting/monthlyJob");
      const r = await runForecastingMonthly();
      log(
        `[forecasting] recorded ${r.publicSeries.families.reduce((a, f) => a + f.rowsAppended, 0)} public rows, ` +
          `${r.outcomes.appended} outcomes; issued ${r.issued.engines.reduce((a, e) => a + e.issued, 0)}; scored ${r.scored}`,
        "forecasting",
      );
    }).catch((err: unknown) => {
      log(`[forecasting] monthly run failed: ${err instanceof Error ? err.message : String(err)}`, "forecasting");
    });
  }, ONE_HOUR_MS);
}
