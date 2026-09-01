/**
 * Referral maturity sweep (daily ~02:10 UTC) — S3 decomposition slice.
 *
 * Market-match terms (founder decision, picker 2026-09-01): referrals that
 * hit 'paid' 30+ days ago either convert (referee org still an active
 * subscriber → referrer credited, annual + milestone bonuses) or void.
 * Each transition is a guarded claim in services/referralReward.ts, so
 * overlapping runs are safe. Same shared runtime as every other job
 * (jobRuntime lock/interval/log); runScheduledJobs.ts calls the start*
 * entrypoint from its orchestrator like the other extracted slices.
 */

import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

export function startReferralMaturityJob(): void {
  log("Registering referral maturity sweep (daily ~02:10 UTC)", "referral-maturity");
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 2 || now.getUTCMinutes() < 10 || now.getUTCMinutes() >= 15) {
      return;
    }
    void withJobLock("referral_reward_maturity", 23 * 60 * 60, async () => {
      const { matureReferralRewards } = await import("../services/referralReward");
      const { converted, voided } = await matureReferralRewards();
      log(`Referral maturity sweep complete: ${converted} converted, ${voided} voided`, "referral-maturity");
    }).catch((err) => {
      log(`Referral maturity sweep failed: ${err}`, "referral-maturity");
    });
  }, 5 * 60 * 1000);
}
