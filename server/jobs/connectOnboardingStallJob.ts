/**
 * Lender Connect onboarding-stall aging sweep (every 24 hours) — autopilot
 * brief B-7. A thin scheduler over runOnboardingStallSweep
 * (server/services/connectOnboardingStalls.ts):
 *
 *   • every connected account is live-read once a day and its stall clock
 *     advanced (seeded on first sight of outstanding requirements,
 *     cleared the day the requirements empty);
 *   • an account stuck in `currentlyDue` for 7 days gets ONE founder
 *     systemAlert (warning) plus a lender notice through the witnessed
 *     rails (push + in-app, preference-gated) — stamped, so it fires
 *     once per stall episode.
 *
 * No automatic account changes, no email or SMS to the lender: detection
 * + surfacing only. A stall that predates this slice is clocked from its
 * first observation after deploy, never backdated.
 *
 * Self-rescheduling (each run is awaited before the next is armed) and
 * lock-guarded, like the dispute escalation sweep. Registered by
 * startSubscriptionLifecycleJobs() — worker process only.
 */
import { withJobLock, jobLog as log } from "../utils/jobRuntime";
import { jobSupervisor } from "../services/jobSupervisor";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_TTL_SECONDS = 23 * 60 * 60; // slightly under the interval

async function processConnectOnboardingStall() {
  try {
    const { runOnboardingStallSweep } = await import("../services/connectOnboardingStalls");
    const r = await runOnboardingStallSweep();
    if (r.stalled || r.alerted || r.newlySeeded || r.resolved) {
      log(
        `Connect onboarding stall sweep: scanned=${r.scanned}, stalled=${r.stalled}, newlySeeded=${r.newlySeeded}, resolved=${r.resolved}, alerted=${r.alerted}`,
        "connect-onboarding-stall",
      );
    }
    jobSupervisor.notifyResult("connect_onboarding_stall", DAY_MS, true);
  } catch (err) {
    log(`Connect onboarding stall sweep error: ${err}`, "connect-onboarding-stall");
    jobSupervisor.notifyResult("connect_onboarding_stall", DAY_MS, false, undefined, String(err));
  }
}

export function startConnectOnboardingStallJob(): void {
  log("Starting connect onboarding stall sweep (self-rescheduling, 24h)", "connect-onboarding-stall");
  import("./scheduler").then(({ scheduleSelfRescheduling }) => {
    scheduleSelfRescheduling({
      name: "connect_onboarding_stall",
      intervalMs: DAY_MS,
      initialDelayMs: 60 * 60 * 1000,
      run: async () => {
        await withJobLock("connect_onboarding_stall", LOCK_TTL_SECONDS, processConnectOnboardingStall);
      },
    });
  });
}
