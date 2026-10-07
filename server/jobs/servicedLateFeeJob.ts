/**
 * Daily serviced-note late-fee assessment (founder ruling 2026-09-29 #6,
 * DEFECT-0099). 13:00 UTC. Thin scheduler over
 * `runServicedLateFeeAssessmentPass` (server/services/notes/servicedLateFees.ts),
 * which records a fee in `late_fee_assessments` when grace passes on an
 * installment not paid in full — idempotent per installment, so a re-run or a
 * posting that got there first changes nothing. Registered by
 * runScheduledJobs() — worker process only (ruling #5).
 */
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import { clock } from "../utils/clock";

export function startServicedLateFeeJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 15 * 60;

  log("Registering serviced late-fee assessment (daily 13:00 UTC)", "late-fees");

  trackInterval(() => {
    if (clock.now().getUTCHours() !== 13) return;
    import("../services/notes/servicedLateFees")
      .then(({ runServicedLateFeeAssessmentPass }) =>
        withJobLock("serviced_late_fee_assessment", TTL_SECONDS, async () => {
          const r = await runServicedLateFeeAssessmentPass();
          log(
            `Late fees: scanned=${r.scanned} assessed=${r.assessed} alreadyAssessed=${r.alreadyAssessed} errors=${r.errors}`,
            "late-fees",
          );
        }),
      )
      .catch((err) => log(`Late-fee assessment pass failed: ${err}`, "late-fees"));
  }, ONE_HOUR);
}
