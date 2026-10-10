/**
 * Subscription lifecycle jobs, carved out of runScheduledJobs.ts:
 *   - trial expiry (daily 09:00 UTC): reminders and follow-ups, runTrialExpiryCycle;
 *   - the yearly-plan pre-renewal notice (daily 10:00 UTC).
 *
 * The yearly-plan pre-renewal notice: Cal. Bus. & Prof.
 * Code § 17602(b)(2): 15–45 days before a yearly renewal. Thin scheduler over
 * runAnnualRenewalNotices (server/services/annualRenewalNotice.ts), which sends
 * once per org and renewal period (idempotency-keyed, so a re-run replays
 * rather than re-sends). Registered by runScheduledJobs() — worker process only.
 */
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import { jobSupervisor } from "../services/jobSupervisor";
import { clock } from "../utils/clock";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Both duties; registered by runScheduledJobs() — worker process only. */
export function startSubscriptionLifecycleJobs() {
  startTrialExpiryJob();
  startAnnualRenewalNoticeJob();
}

// ── Trial expiry automation (daily 9am UTC) ─────────────────────────────────
async function processTrialExpiryJob() {
  try {
    const { runTrialExpiryCycle } = await import("../services/trialEngine");
    const result = await runTrialExpiryCycle();
    log(
      `Trial engine: reminders=${result.remindersSent}, followups=${result.followupsSent}, skipped=${result.skipped}`,
      "trial-engine",
    );
    jobSupervisor.notifyResult("trial_engine", DAY_MS, true);
  } catch (err) {
    log(`Trial engine error: ${err}`, "trial-engine");
    jobSupervisor.notifyResult("trial_engine", DAY_MS, false, undefined, String(err));
  }
}

function startTrialExpiryJob() {
  log("Starting trial-expiry job (daily at 9am UTC)", "trial-engine");
  trackInterval(() => {
    const now = clock.now();
    if (now.getUTCHours() === 9 && now.getUTCMinutes() < 5) {
      withJobLock("trial_engine", 23 * 60 * 60, processTrialExpiryJob).catch((err) => {
        log(`Trial engine lock error: ${err}`, "trial-engine");
      });
    }
  }, 5 * 60 * 1000);
}

// ── Yearly-plan pre-renewal notice (daily 10am UTC) ─────────────────────────
async function processAnnualRenewalNoticeJob() {
  try {
    const { runAnnualRenewalNotices } = await import("../services/annualRenewalNotice");
    const r = await runAnnualRenewalNotices();
    log(`Annual renewal notices: considered=${r.considered} sent=${r.sent} skipped=${r.skipped} failed=${r.failed}`, "annual-renewal");
    jobSupervisor.notifyResult("annual_renewal_notice", DAY_MS, r.failed === 0, undefined, r.failed ? `${r.failed} notice(s) not sent` : undefined);
  } catch (err) {
    log(`Annual renewal notice error: ${err}`, "annual-renewal");
    jobSupervisor.notifyResult("annual_renewal_notice", DAY_MS, false, undefined, String(err));
  }
}

function startAnnualRenewalNoticeJob() {
  log("Starting annual renewal notice job (daily at 10am UTC)", "annual-renewal");
  trackInterval(() => {
    const now = clock.now();
    if (now.getUTCHours() === 10 && now.getUTCMinutes() < 5) {
      withJobLock("annual_renewal_notice", 23 * 60 * 60, processAnnualRenewalNoticeJob).catch((err) => {
        log(`Annual renewal notice lock error: ${err}`, "annual-renewal");
      });
    }
  }, 5 * 60 * 1000);
}
