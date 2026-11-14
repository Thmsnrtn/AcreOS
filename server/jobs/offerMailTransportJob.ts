/**
 * Offer-mail transport — every 5 minutes, drains offer letters whose Send
 * queued them (Settlement & Documents Rail, Land S-01's missing consumer).
 *
 * Before the rail, `POST /api/offer-letters/:id/send` set status="queued"
 * and NOTHING consumed the queue: the letter was never mailed while the UI
 * toasted success. The transport (services/settlementRail/offerMailTransport)
 * sends each queued letter through the mail lane with its own parcel's price
 * merged, records the provider's letter id on success, and returns failures
 * to draft with the reason on the letter. withJobLock + the per-letter
 * provider idempotency key (`offer-letter:<id>`) make overlapping cycles
 * harmless. Registered by runScheduledJobs via scheduledJobsBoot —
 * worker process only.
 */
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

export function startOfferMailTransportJob() {
  const FIVE_MIN = 5 * 60 * 1000;
  log("Registering offer-mail transport (every 5m)", "offer-mail");
  trackInterval(async () => {
    withJobLock("offer_mail_transport", 4 * 60 + 30, async () => {
      const { drainQueuedOfferLetters } = await import("../services/settlementRail/offerMailTransport");
      const r = await drainQueuedOfferLetters();
      if (r.claimed > 0) {
        log(`[offer-mail] claimed=${r.claimed} sent=${r.sent} failed=${r.failed} skipped=${r.skipped}`, "offer-mail");
      }
    }).catch((err: unknown) => {
      log(`[offer-mail] failed: ${err instanceof Error ? err.message : String(err)}`, "offer-mail");
    });
  }, FIVE_MIN);
}
