/**
 * Whether an offer batch may be created — the ONE refusal every creation
 * path goes through.
 *
 * A created batch hands its letters / sends / reply tracking to the
 * OFFER_BATCH_JOB_TYPE job. No handler for it is registered
 * (server/jobs/runScheduledJobs.ts), so a batch used to be written, its job
 * enqueued into nothing, and its status left "processing" forever. Until the
 * handler exists (Phase 4 land work), creation is refused outright — on
 * EVERY path that writes an offer_batches row:
 *   - services/offerBatchService.ts createOfferBatch  (POST /api/offers/batch)
 *   - storage/vaEngineRepo.ts createOfferBatch         (POST /api/offer-batches)
 *
 * Flip OFFER_BATCH_PROCESSOR_REGISTERED in the same commit that registers the
 * handler; offerBatchIsRefusedWithoutHandler.test.ts holds the refusal to
 * whether a handler is registered anywhere in server/ and enumerates every
 * createOfferBatch call site and offer_batches insert.
 *
 * Deliberately import-free so the storage layer can depend on it.
 */

/** The job a created batch hands its letters / sends / reply tracking to. */
export const OFFER_BATCH_JOB_TYPE = "process-offer-batch" as const;

const OFFER_BATCH_PROCESSOR_REGISTERED = false;

export class OfferBatchUnavailableError extends Error {
  readonly reason = "offer_batch_processing_unavailable";
  constructor() {
    super(
      "Offer batches are not processed yet: nothing generates the letters, sends them, or tracks replies. No batch was created.",
    );
    this.name = "OfferBatchUnavailableError";
  }
}

/** Throws OfferBatchUnavailableError while nothing processes a batch. */
export function assertOfferBatchCreatable(): void {
  if (!OFFER_BATCH_PROCESSOR_REGISTERED) throw new OfferBatchUnavailableError();
}
