/**
 * PKG-4 (LQ-22) — /investor-network tripwire background job.
 *
 * The job body lives here, not in runScheduledJobs.ts: that file is the
 * autopilot heartbeat under a strictly-DOWN line-count ratchet (S3
 * decomposition), so new job groups land in server/jobs/*.ts and the
 * monolith keeps only the import + start call. Same shared runtime
 * (jobRuntime lock/interval/log, clock) as every other carved-out job.
 * The counting / freeze-verification work itself lives in
 * server/services/lq22Tripwire.ts (runLq22TripwireCheck).
 */

import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import { clock } from "../utils/clock";

// ============================================================================
// PKG-4 (LQ-22) — /investor-network tripwire: daily 08:00 UTC pass counting
// paying customers toward the ~25-customer marketplace ladder and verifying
// the freeze is still in force (route frozen + ladder flag off for
// non-founders). The report persists to founder_settings
// (lq22_tripwire.latest) for the ops watch; every pass logs its one-line
// summary either way. Observation only — the freeze is enforced by
// requireLadderFlag, never by this job.
// ============================================================================
export function startLq22TripwireJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;

  log('Registering LQ-22 tripwire job (daily 08:00 UTC)', 'lq22-tripwire');

  trackInterval(() => {
    const now = clock.now();
    if (now.getUTCHours() === 8) {
      import('../services/lq22Tripwire').then(({ runLq22TripwireCheck }) => {
        withJobLock('lq22_tripwire_daily', TTL_SECONDS, async () => {
          await runLq22TripwireCheck();
        }).catch(err => {
          log(`LQ-22 tripwire run failed: ${err}`, 'lq22-tripwire');
        });
      }).catch(err => log(`LQ-22 tripwire import failed: ${err}`, 'lq22-tripwire'));
    }
  }, ONE_HOUR);
}
