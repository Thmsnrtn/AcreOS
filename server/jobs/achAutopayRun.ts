/**
 * ACH autopay cycle job (Wave C "Money moves").
 *
 * Two passes per run, in this order:
 *   1. SUBMIT — one ACH debit per (note, period) that is due, has autopay on,
 *      and has a stored active mandate whose ceiling covers the amount.
 *   2. RECONCILE — poll every in-flight debit and drive it to its real state:
 *      settlement posts the ledger row (once) and emits `payment.received`
 *      after commit; a return posts the reversal (once), applies the mandate /
 *      autopay consequence, and schedules a bounded re-presentment.
 *
 * Cadence: hourly. Submission is naturally at-most-once per (note, period)
 * because of the unique claim, so running hourly rather than daily costs
 * nothing and gets a borrower's due-date debit out within the hour. Hourly
 * also bounds how long a return sits undiscovered — the reconciliation sweep
 * is the system of record for returns (no webhook is wired; see
 * server/services/achAutopay.ts, "WHAT IS DELIBERATELY NOT REAL").
 *
 * Dormancy: the whole cycle is a no-op under SIMULATION_MODE / STRIPE
 * simulation and refuses per-note when a lender's Connect account cannot take
 * ACH — both are declared in the job roster so a dark cycle is visible
 * instead of mysterious.
 *
 * Scheduling lives HERE, not inline in runScheduledJobs.ts, following the S3
 * decomposition convention set by leadCampaignJobs.ts and workflowDelayResume.ts:
 * this module owns its own process/start-job pair on the shared runtime
 * (jobRuntime lock/interval/log), and runScheduledJobs.ts only imports
 * `startAchAutopayJob` and calls it from the orchestrator. That file is under a
 * strictly-DOWN line-count ratchet — a money job must not be the reason it grows.
 */

import { runAchAutopayCycle, type AchAutopayCycleResult } from "../services/achAutopay";
import { logger } from "../utils/logger";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

// The dormancy predicate lives in jobRegistry (the dependency-free jobs
// module) so the roster entry and this job body evaluate the SAME function.
// Imported (not just re-exported) because the scheduling wrapper below calls it.
import { achAutopayDormantReason } from "./jobRegistry";
export { achAutopayDormantReason };

export interface AchAutopayJobResult extends AchAutopayCycleResult {
  /** Refusal reasons, counted — so "why wasn't this collected" is answerable. */
  refusalsByReason: Record<string, number>;
}

export async function runAchAutopayJob(): Promise<AchAutopayJobResult> {
  const cycle = await runAchAutopayCycle();

  const refusalsByReason: Record<string, number> = {};
  for (const outcome of cycle.submit.outcomes) {
    if (outcome.status === "submitted") continue;
    const key = outcome.reason ?? "unknown";
    refusalsByReason[key] = (refusalsByReason[key] ?? 0) + 1;
  }

  logger.info("[achAutopay] cycle complete", {
    scanned: cycle.submit.scanned,
    submitted: cycle.submit.submitted,
    refused: cycle.submit.refused,
    submitErrors: cycle.submit.errors,
    reconciled: cycle.reconcile.checked,
    settled: cycle.reconcile.settled,
    returned: cycle.reconcile.returned,
    stillPending: cycle.reconcile.stillPending,
    reconcileErrors: cycle.reconcile.errors,
    refusalsByReason,
  });

  return { ...cycle, refusalsByReason };
}

// ── Scheduling ──────────────────────────────────────────────────────────────
/**
 * The lock/roster key. It is passed to `withJobLock` as a STRING LITERAL below
 * (not via this constant) because jobRosterCoverage.test.ts extracts roster
 * parity from the literals — a constant would make the roster entry look like a
 * phantom and blind the deadman. achAutopayJobWiring.test.ts asserts this
 * constant, the literal in the source, and the JOB_ROSTER entry are all the
 * same string, so the two spellings cannot drift.
 */
export const ACH_AUTOPAY_JOB_NAME = "ach_autopay_cycle";

/** Lock TTL — under the hourly interval so a crashed run cannot wedge the lane. */
const ACH_AUTOPAY_LOCK_TTL_SECONDS = 55 * 60;
const ONE_HOUR_MS = 60 * 60 * 1000;
/**
 * Offset from startup, past the minute-cadence jobs. Long enough that a boot
 * loop cannot hammer the processor, short enough that a due debit is collected
 * within the hour of a deploy.
 */
const ACH_AUTOPAY_STARTUP_DELAY_MS = 150_000;

/**
 * One tick. Dormancy is evaluated INSIDE the lock so a dormant-but-alive worker
 * still writes a job_health_logs row (the deadman stays fed) and the reason is
 * printed every cycle rather than being silently dark — the exact failure mode
 * `disabledReason` exists to kill.
 */
async function processAchAutopayCycle(): Promise<void> {
  const dormant = achAutopayDormantReason();
  if (dormant) {
    log(`ACH autopay cycle skipped — ${dormant}`, "ach-autopay");
    return;
  }
  try {
    const result = await runAchAutopayJob();
    log(
      `ACH autopay cycle: scanned=${result.submit.scanned}, submitted=${result.submit.submitted}, ` +
        `refused=${result.submit.refused}, reconciled=${result.reconcile.checked}, ` +
        `settled=${result.reconcile.settled}, returned=${result.reconcile.returned}`,
      "ach-autopay",
    );
  } catch (err) {
    // Never rethrow: withJobLock records the failure, and a thrown error here
    // would leave the interval lane noisy without collecting anything.
    log(`ACH autopay cycle error: ${err}`, "ach-autopay");
    logger.error(
      "[achAutopay] cycle failed",
      err instanceof Error ? err : undefined,
    );
  }
}

/** Registered from runScheduledJobs.ts. Hourly, single-flight via the job lock. */
export function startAchAutopayJob(): void {
  log("Starting borrower ACH autopay cycle job (hourly)", "ach-autopay");

  setTimeout(() => {
    withJobLock("ach_autopay_cycle", ACH_AUTOPAY_LOCK_TTL_SECONDS, processAchAutopayCycle).catch(
      (err) => log(`Initial ACH autopay cycle failed: ${err}`, "ach-autopay"),
    );
  }, ACH_AUTOPAY_STARTUP_DELAY_MS);

  trackInterval(() => {
    withJobLock("ach_autopay_cycle", ACH_AUTOPAY_LOCK_TTL_SECONDS, processAchAutopayCycle).catch(
      (err) => log(`ACH autopay cycle failed: ${err}`, "ach-autopay"),
    );
  }, ONE_HOUR_MS);
}
