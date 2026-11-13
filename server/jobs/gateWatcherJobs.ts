/**
 * Gate-watcher background job (Launch-Week WS4 — the self-birthing roadmap).
 *
 * Extracted verbatim from runScheduledJobs.ts (S3 decomposition) on
 * 2026-11-08: the god-file's line ratchet is strictly DOWN, and PKG-4's new
 * tripwire job needed its import + start call paid for without growing the
 * monolith. Same shared runtime (jobRuntime lock/interval/log, clock), same
 * cadence, same lock name — only where the body lives changed.
 * runScheduledJobs.ts imports the start* entrypoint and calls it from its
 * orchestrator exactly as before.
 */

import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import { clock } from "../utils/clock";

// ============================================================================
// Launch-Week WS4 — Gate-Watcher (the self-birthing roadmap). Daily 09:00 UTC.
// Evaluates every machine-encoded roadmap gate (mature-machine §4 autonomy
// switch schedule + phase triggers: Phase-1 runbook at $200 MRR held 30d,
// Sentry rung at $500, Telnyx eval at $3k, switch eligibility at 25 paying).
// A ripened gate raises a one-tap founder Decision via founderCollab, or
// auto-executes ONLY where the studio revenue-trigger dial already says
// autoApprove. Hard-stops never auto-execute. Every evaluation is logged and
// persisted to the Story surface; dedup state lives in founder_settings, so a
// duplicate tick (second machine acquiring the lock later in the hour) is a
// no-op.
// ============================================================================
export function startGateWatcherJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;

  log('Registering gate watcher job (daily 09:00 UTC)', 'gate-watcher');

  trackInterval(() => {
    const now = clock.now();
    if (now.getUTCHours() === 9) {
      import('../services/autopilot/gateWatcher').then(({ runGateWatch }) => {
        withJobLock('gate_watcher_daily', TTL_SECONDS, async () => {
          await runGateWatch();
        }).catch(err => {
          log(`Gate watcher run failed: ${err}`, 'gate-watcher');
        });
      }).catch(err => log(`Gate watcher import failed: ${err}`, 'gate-watcher'));
    }
  }, ONE_HOUR);
}
