/**
 * Pending-action expiry sweep (daily ~02:20 UTC) — S3 decomposition slice.
 *
 * Customer review-queue plumbing (autonomy clarity program, 2026-09-02).
 * pending_actions rows expire after PENDING_ACTION_TTL_MS (24h) but the
 * status column was only ever flipped LAZILY — when a human tapped Approve on
 * a stale row. Every reader (list / count / the kernel's own duplicate-reuse
 * check) applies `expires_at > now()` itself, so this sweep changes no
 * visible behaviour: it is bookkeeping that keeps `status` truthful for the
 * audit trail and for anything that groups by status. Guarded UPDATE
 * (`status = 'pending' AND expires_at <= now()`), so overlapping or repeated
 * runs are safe. Same shared runtime as every other job (jobRuntime
 * lock/interval/log); runScheduledJobs.ts calls the start* entrypoint from
 * its orchestrator like the other extracted slices.
 */

import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

export function startPendingActionExpiryJob(): void {
  log("Registering pending-action expiry sweep (daily ~02:20 UTC)", "pending-action-expiry");
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 2 || now.getUTCMinutes() < 20 || now.getUTCMinutes() >= 25) {
      return;
    }
    void withJobLock("pending_action_expiry_sweep", 23 * 60 * 60, async () => {
      const { sweepExpiredPendingActions } = await import("../services/approvalKernel");
      const expired = await sweepExpiredPendingActions();
      log(`Pending-action expiry sweep complete: ${expired} flipped pending → expired`, "pending-action-expiry");
    }).catch((err) => {
      log(`Pending-action expiry sweep failed: ${err}`, "pending-action-expiry");
    });
  }, 5 * 60 * 1000);
}
