/**
 * Refund SLA / escalation sweep (every 10 minutes) — refund automation,
 * design 2026-11 §3.3. A thin scheduler over runRefundSlaSweep
 * (server/services/refunds/refundQueue.ts):
 *
 *   • retries guarantee-eligible requests whose execution failed BEFORE the
 *     refund call, with backoff, up to the attempt cap;
 *   • reminder at dueAt, severity raise + founder ask at dueAt + 24h;
 *   • lists `uncertain` requests every run until the founder resolves them.
 *
 * Self-rescheduling (each run is awaited before the next is armed) and
 * lock-guarded, like the finance-agent sweep. Registered by
 * runScheduledJobs() — worker process only.
 */
import { withJobLock, jobLog as log } from "../utils/jobRuntime";
import { jobSupervisor } from "../services/jobSupervisor";

const TEN_MINUTES = 10 * 60 * 1000;
const LOCK_TTL_SECONDS = 9 * 60; // slightly under the interval

async function processRefundSlaSweep() {
  try {
    const { runRefundSlaSweep } = await import("../services/refunds/refundQueue");
    const r = await runRefundSlaSweep();
    if (r.retried || r.reminded || r.escalated || r.uncertainListed || r.retryExhausted) {
      log(
        `Refund SLA sweep: retried=${r.retried} (processed ${r.retryProcessed}), exhausted=${r.retryExhausted}, reminded=${r.reminded}, escalated=${r.escalated}, uncertain=${r.uncertainListed}`,
        "refund-sla",
      );
    }
    jobSupervisor.notifyResult("refund_sla_sweep", TEN_MINUTES, true);
  } catch (err) {
    log(`Refund SLA sweep error: ${err}`, "refund-sla");
    jobSupervisor.notifyResult("refund_sla_sweep", TEN_MINUTES, false, undefined, String(err));
  }
}

export function startRefundSlaSweepJob(): void {
  log("Starting refund SLA sweep (self-rescheduling, 10m)", "refund-sla");
  import("./scheduler").then(({ scheduleSelfRescheduling }) => {
    scheduleSelfRescheduling({
      name: "refund_sla_sweep",
      intervalMs: TEN_MINUTES,
      initialDelayMs: 60_000,
      run: async () => {
        await withJobLock("refund_sla_sweep", LOCK_TTL_SECONDS, processRefundSlaSweep);
      },
    });
  });
}
