/**
 * Borrower-dispute deadline escalation sweep (every 1 hour) — autopilot
 * brief B-2. A thin scheduler over runConnectDisputeEscalationSweep
 * (server/services/connectDisputes.ts):
 *
 *   • open Connect disputes whose Stripe response deadline (response.by)
 *     is under 72h away get a warning founder alert + lender re-notice;
 *   • under 24h (or already overdue) they get the critical tier;
 *   • each tier is stamped on the payments row, so it fires exactly once.
 *
 * A missed dispute deadline is an automatic loss on the lender's own
 * account — the deadline is the whole reason this job exists.
 *
 * Self-rescheduling (each run is awaited before the next is armed) and
 * lock-guarded, like the refund SLA sweep. Registered by
 * startSubscriptionLifecycleJobs() — worker process only.
 */
import { withJobLock, jobLog as log } from "../utils/jobRuntime";
import { jobSupervisor } from "../services/jobSupervisor";

const ONE_HOUR = 60 * 60 * 1000;
const LOCK_TTL_SECONDS = 55 * 60; // slightly under the interval

async function processConnectDisputeEscalation() {
  try {
    const { runConnectDisputeEscalationSweep } = await import("../services/connectDisputes");
    const r = await runConnectDisputeEscalationSweep();
    if (r.escalated72h || r.escalated24h) {
      log(
        `Connect dispute escalation sweep: scanned=${r.scanned}, escalated72h=${r.escalated72h}, escalated24h=${r.escalated24h}`,
        "connect-disputes",
      );
    }
    jobSupervisor.notifyResult("connect_dispute_escalation", ONE_HOUR, true);
  } catch (err) {
    log(`Connect dispute escalation sweep error: ${err}`, "connect-disputes");
    jobSupervisor.notifyResult("connect_dispute_escalation", ONE_HOUR, false, undefined, String(err));
  }
}

export function startConnectDisputeEscalationJob(): void {
  log("Starting connect dispute escalation sweep (self-rescheduling, 1h)", "connect-disputes");
  import("./scheduler").then(({ scheduleSelfRescheduling }) => {
    scheduleSelfRescheduling({
      name: "connect_dispute_escalation",
      intervalMs: ONE_HOUR,
      initialDelayMs: 15 * 60 * 1000,
      run: async () => {
        await withJobLock("connect_dispute_escalation", LOCK_TTL_SECONDS, processConnectDisputeEscalation);
      },
    });
  });
}
