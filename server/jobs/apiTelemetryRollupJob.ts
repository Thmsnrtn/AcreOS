/**
 * api_telemetry_samples nightly rollup + purge job (S3 decomposition slice,
 * carved out of runScheduledJobs.ts 2026-11-03 with legal-run Leg 6.3).
 *
 * services/apiTelemetryRollup.ts is the single owner of the table's
 * retention; this file only schedules it and reports to the job supervisor.
 */
import { jobSupervisor } from "../services/jobSupervisor";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import { clock } from "../utils/clock";

// ============================================================================
// Tahoe L14 follow-up — api_telemetry_samples nightly rollup + purge.
//
// 30-day rolling retention on api_telemetry_samples. Older rows are
// aggregated into api_telemetry_rollup_monthly (UPSERT) then DELETEd from
// the source. Idempotent — see server/services/apiTelemetryRollup.ts.
// Daily wall-clock 01:00 UTC.
// ============================================================================
export function startApiTelemetryRollupJob() {
  // Ticks every 5 minutes so the 01:00–01:05 window is hit every day. It
  // used to tick hourly against the same 5-minute window, so it fired only
  // when the process happened to boot in minutes :00–:04 — on most days it
  // never ran (legal-run Leg 6.3). The job lock keeps it to one run a day.
  const TICK_MS = 5 * 60 * 1000;
  const TTL_SECONDS = 50 * 60;

  log('Registering api_telemetry rollup + purge job (daily 01:00 UTC)', 'api-telemetry-rollup');

  trackInterval(() => {
    const now = clock.now();
    if (now.getUTCHours() === 1 && now.getUTCMinutes() < 5) {
      void withJobLock('api_telemetry_rollup', TTL_SECONDS, async () => {
        const { runApiTelemetryRollup } = await import('../services/apiTelemetryRollup');
        const r = await runApiTelemetryRollup();
        log(
          `[api-telemetry-rollup] upserted=${r.rollupRowsUpserted} deleted=${r.sourceRowsDeleted} retentionDays=${r.retentionDays}`,
          'api-telemetry-rollup',
        );
        jobSupervisor.notifyResult('api_telemetry_rollup', 24 * 60 * 60 * 1000, true);
      }).catch((err) => {
        // The rollup is now the ONLY bound on api_telemetry_samples (Leg 6.3),
        // so a failing run must reach the supervisor, not just the log.
        log(`api_telemetry rollup failed: ${err}`, 'api-telemetry-rollup');
        jobSupervisor.notifyResult('api_telemetry_rollup', 24 * 60 * 60 * 1000, false, undefined, String(err));
      });
    }
  }, TICK_MS);
}
