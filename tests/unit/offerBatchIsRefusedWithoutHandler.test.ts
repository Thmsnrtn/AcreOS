/**
 * P1 false-claims sweep — an offer batch nothing processes is not created.
 *
 * POST /api/offers/batch wrote a batch, enqueued "process-offer-batch" into a
 * job queue with NO registered handler, and set the batch "processing" — where
 * it stayed forever. The page promised Pax "hands the merge to the print
 * vendor, and tracks reply windows per recipient".
 *
 * Coupled to the truth: whether any server file registers a handler for the
 * job type decides the expected behaviour of the REAL createOfferBatch. With
 * no handler it must refuse before writing a row or enqueuing a job, and the
 * page may not claim the processing; once a handler exists the refusal must
 * be lifted (so the service flag cannot be left stale either way).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const { insert, update, addJob } = vi.hoisted(() => ({
  insert: vi.fn(() => ({
    values: () => ({ returning: async () => [{ id: 1 }] }),
  })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
  addJob: vi.fn(() => ({ id: "job_1" })),
}));
vi.mock("../../server/db", () => ({ db: { insert, update, select: vi.fn() } }));
vi.mock("../../server/services/jobQueue", () => ({ jobQueueService: { addJob } }));

import { createOfferBatch, OfferBatchUnavailableError } from "../../server/services/offerBatchService";

const OFFER_BATCH_JOB_TYPE = "process-offer-batch";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** Every registerHandler(...) call in server/ — the population a handler could live in. */
function registeredJobTypes(): string[] {
  const types: string[] = [];
  for (const file of walk(path.join(ROOT, "server"))) {
    const raw = readFileSync(file, "utf8");
    // Cheap prefilter on the raw text; only candidate files are comment-stripped
    // (a match in raw text is a superset of a match in stripped text).
    if (!raw.includes("registerHandler(")) continue;
    const src = stripComments(raw);
    for (const m of src.matchAll(/registerHandler\(\s*(['"`]([^'"`]+)['"`]|([A-Za-z_][\w.]*))/g)) {
      // An identifier argument naming the batch job counts as the batch job.
      types.push(m[2] ?? (/OFFER_BATCH/.test(m[3] ?? "") ? OFFER_BATCH_JOB_TYPE : m[3]));
    }
  }
  return types;
}

describe("offer batches without a processor", () => {
  beforeEach(() => {
    insert.mockClear();
    update.mockClear();
    addJob.mockClear();
  });

  let handlerRegistered = false;

  it("scans every registerHandler call in server/", { timeout: 120_000 }, () => {
    const types = registeredJobTypes();
    // Vacuity: the scan must see the handlers that DO exist.
    expect(types).toEqual(expect.arrayContaining(["email", "webhook", "payment_sync", "notification"]));
    handlerRegistered = types.includes(OFFER_BATCH_JOB_TYPE);
  });

  it("createOfferBatch refuses (writing nothing) exactly while no handler is registered", async () => {
    const attempt = createOfferBatch(
      [{ apn: "001-002", acreage: 5, priceOverride: 10_000 }],
      { orgId: 7, userId: 1, name: "Spring", pricingMatrix: [] },
    );
    if (handlerRegistered) {
      // A processor exists: the refusal must have been lifted with it.
      await expect(attempt).resolves.toMatchObject({ batchId: 1 });
      return;
    }
    await expect(attempt).rejects.toBeInstanceOf(OfferBatchUnavailableError);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();
  });

  it("the page does not claim processing that does not exist", () => {
    if (handlerRegistered) return;
    const page = stripComments(readFileSync(path.join(ROOT, "client/src/pages/offer-batches.tsx"), "utf8"));
    expect(page.length).toBeGreaterThan(1000); // vacuity
    for (const claim of [/print vendor/i, /reply windows?/i, /\/api\/offers\/batch/, /ready to send/i, /batches mailed/i]) {
      expect(page).not.toMatch(claim);
    }
    expect(page).toMatch(/can't be created yet/);
  });
});
