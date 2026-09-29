/**
 * The 90-day borrower wind-down notices (founder ruling 2026-09-29 #3,
 * DEFECT-0106). Daily 14:00 UTC — US business hours, so a lender or borrower
 * reads the notice the day it is sent. Thin scheduler over
 * `runServicingWindDownPass` (server/services/borrower/servicingWindDown.ts),
 * which tells a lender in wind-down to export or move the book and, once the
 * wind-down is over, tells each borrower to pay the lender directly. Every
 * notice is idempotency-keyed, so a re-run replays rather than re-sends.
 * Registered by runScheduledJobs() — worker process only (ruling #5).
 */
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import { startServicedLateFeeJob } from "./servicedLateFeeJob";

/** The borrower-servicing duties the worker runs daily (rulings #3 and #6). */
export function startBorrowerServicingJobs() {
  startServicingWindDownJob();
  startServicedLateFeeJob();
}

function startServicingWindDownJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 15 * 60;

  log("Registering borrower servicing wind-down notices (daily 14:00 UTC)", "borrower-servicing");

  trackInterval(() => {
    if (new Date().getUTCHours() !== 14) return;
    import("../services/borrower/servicingWindDown")
      .then(({ runServicingWindDownPass }) =>
        withJobLock("borrower_servicing_wind_down", TTL_SECONDS, async () => {
          const r = await runServicingWindDownPass();
          log(
            `Wind-down: stamped=${r.stamped} lendersInWindDown=${r.lendersInWindDown} lenderSent=${r.lenderNoticesSent} lenderNotSent=${r.lenderNoticesNotSent} borrowerSent=${r.borrowerNoticesSent} borrowerNotSent=${r.borrowerNoticesNotSent} noEmail=${r.borrowersWithoutEmail}`,
            "borrower-servicing",
          );
        }),
      )
      .catch((err) => log(`Borrower wind-down pass failed: ${err}`, "borrower-servicing"));
  }, ONE_HOUR);
}
