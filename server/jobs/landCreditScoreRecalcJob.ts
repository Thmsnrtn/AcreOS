/**
 * Land credit-score recalculation start wrapper (daily ~01:00 UTC) — S3
 * decomposition slice, extracted verbatim from runScheduledJobs.ts
 * 2026-09-02. The recalculation logic already lived in
 * ./landCreditScoreRecalculation; this moves its scheduler wrapper next to
 * the other extracted slices so the god-file only shrinks.
 */

import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

export function startLandCreditScoreRecalcJob(): void {
  log("Registering land credit-score recalculation (daily ~01:00 UTC)", "land-credit-recalc");
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 1 || now.getUTCMinutes() >= 5) {
      return;
    }
    void withJobLock("land_credit_score_recalc", 23 * 60 * 60, async () => {
      const { runLandCreditScoreRecalculation } = await import("./landCreditScoreRecalculation");
      await runLandCreditScoreRecalculation();
      log("Land credit-score recalculation complete", "land-credit-recalc");
    }).catch((err) => {
      log(`Land credit-score recalc run failed: ${err}`, "land-credit-recalc");
    });
  }, 5 * 60 * 1000);
}
