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
 *
 * POPULATION. The first version gated only the service path. POST
 * /api/offer-batches (routes-va-engine.ts) wrote the same table through
 * storage.createOfferBatch with no refusal at all. So this file enumerates
 * EVERY `createOfferBatch(` call site and EVERY `insert(offerBatches)` in
 * server/ (comments stripped) and requires each to be a member of a list
 * whose members are driven behaviourally below — adding a third creation
 * path without adding it here is what fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const { insert, update, addJob, storageCreate } = vi.hoisted(() => ({
  storageCreate: vi.fn(async () => ({ id: 99 })),
  insert: vi.fn(() => ({
    values: () => ({ returning: async () => [{ id: 1 }] }),
  })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
  addJob: vi.fn(() => ({ id: "job_1" })),
}));
vi.mock("../../server/db", () => ({ db: { insert, update, select: vi.fn() } }));
vi.mock("../../server/services/jobQueue", () => ({ jobQueueService: { addJob } }));
vi.mock("../../server/storage", () => ({ storage: { createOfferBatch: storageCreate } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization: unknown; user: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    req.user = { id: "1" };
    n();
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import express from "express";
import request from "supertest";
import { createOfferBatch, OfferBatchUnavailableError } from "../../server/services/offerBatchService";
import { vaEngineRepo } from "../../server/storage/vaEngineRepo";
import { registerVAEngineRoutes } from "../../server/routes-va-engine";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

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

/** Every creation path, each driven behaviourally in this file. */
const CREATION_CALL_SITES: Record<string, number> = {
  // routes-analytics.ts POST /api/offers/batch → offerBatchService.createOfferBatch
  "server/routes-analytics.ts": 1,
  // routes-va-engine.ts POST /api/offer-batches → storage.createOfferBatch
  "server/routes-va-engine.ts": 1,
};
/** Every raw insert into offer_batches — the two definitions gated above. */
const INSERT_SITES: Record<string, number> = {
  "server/services/offerBatchService.ts": 1,
  "server/storage/vaEngineRepo.ts": 1,
};

function scan(re: RegExp, prefilter: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of walk(path.join(ROOT, "server"))) {
    const raw = readFileSync(file, "utf8");
    if (!raw.includes(prefilter)) continue;
    const n = [...stripComments(raw).matchAll(re)].length;
    if (n > 0) out[path.relative(ROOT, file).split(path.sep).join("/")] = n;
  }
  return out;
}

describe("every offer-batch creation path is enumerated", () => {
  it("createOfferBatch call sites are exactly the gated set", { timeout: 120_000 }, () => {
    // A call, not the definition (`async createOfferBatch(` / `function createOfferBatch(`)
    // nor the interface member (`createOfferBatch(data: ...): Promise`).
    const sites = scan(/(?<!function\s|async\s)\bcreateOfferBatch\((?!\s*data\s*:)/g, "createOfferBatch(");
    expect(Object.keys(sites).length).toBeGreaterThanOrEqual(2); // vacuity floor
    expect(sites).toEqual(CREATION_CALL_SITES);
  });

  it("offer_batches inserts are exactly the two gated definitions", { timeout: 120_000 }, () => {
    const sites = scan(/\.insert\(\s*offerBatches\s*\)/g, "offerBatches");
    expect(Object.keys(sites).length).toBeGreaterThanOrEqual(2); // vacuity floor
    expect(sites).toEqual(INSERT_SITES);
  });
});

describe("offer batches without a processor", () => {
  beforeEach(() => {
    storageCreate.mockClear();
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

describe("the storage path (POST /api/offer-batches) is held to the same refusal", () => {
  beforeEach(() => {
    insert.mockClear();
    storageCreate.mockClear();
  });

  it("storage createOfferBatch refuses before inserting", async () => {
    const create = (vaEngineRepo as unknown as { createOfferBatch: (d: unknown) => Promise<unknown> }).createOfferBatch;
    await expect(create.call({}, { organizationId: 7, name: "Spring" })).rejects.toBeInstanceOf(OfferBatchUnavailableError);
    expect(insert).not.toHaveBeenCalled();
  });

  it("POST /api/offer-batches refuses with the reason and never reaches storage", async () => {
    const a = express();
    a.use(express.json());
    await registerVAEngineRoutes(a);
    const res = await request(a).post("/api/offer-batches").send({ name: "Spring", pricingMatrix: {} });
    expect(res.status).toBe(400);
    expect(res.body.details?.reason).toBe("offer_batch_processing_unavailable");
    expect(storageCreate).not.toHaveBeenCalled();
  });
});
