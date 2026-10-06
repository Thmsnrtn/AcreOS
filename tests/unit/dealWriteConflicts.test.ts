/**
 * W10.4 contract items 5–6 — a deal status write applies only while the row
 * still has the status it was decided on, and every deal-writing route answers
 * the repository's typed refusals through ONE mapper.
 *
 * updateDeal used to pre-read the status unlocked, check the state machine,
 * then UPDATE by id alone — so two writers racing in_escrow → closed both
 * passed on the same pre-read and both "closed" the deal (and, now that the
 * close has one writer, would both have run it). The UPDATE now carries
 * `status = <pre-read>`; zero rows → StaleDealWriteError → 409 CONFLICT. The
 * Task 219 `expectedUpdatedAt` branch, unreachable and throwing a plain Error
 * the routes string-matched into a 400, throws the same class.
 *
 * Driven over a fake primary handle that evaluates the WHERE clause
 * (tests/helpers/fakeDealsDb.ts): drop the status condition and the race test
 * goes red.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const F = vi.hoisted(() => ({
  h: null as null | ReturnType<typeof import("../helpers/fakeDealsDb").createFakeDb>,
  recordDealClose: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", async () => {
  const { createFakeDb } = await import("../helpers/fakeDealsDb");
  F.h = createFakeDb();
  return { db: F.h.db, withTransaction: F.h.withTransaction };
});
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: { dealDiscovered: async () => undefined, dealClosed: async () => undefined, dealUpdated: async () => undefined },
}));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: vi.fn() }));
vi.mock("../../server/services/dealClose", () => ({
  recordDealClose: F.recordDealClose,
  emitContractSignedIfEvidenced: vi.fn(async () => undefined),
  retractClosedSaleTraining: vi.fn(async () => true),
  recordDealReopen: vi.fn(async () => undefined),
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", claims: { sub: "user-1" } };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Test Org" };
    req.organizationId = 42;
    next();
  },
}));
vi.mock("../../server/storage", async () => {
  const { dealRepo } = await import("../../server/storage/dealRepo");
  const s: Record<string, unknown> = {
    getDeal: async (orgId: number, id: number) => {
      const r = F.h!.fake.rows("deals").find((d) => d.id === id && d.organizationId === orgId);
      return r ? { ...r } : undefined;
    },
    getProperty: async () => undefined,
    createAuditLogEntry: async () => ({}),
    checkStageGate: async () => ({ canAdvance: true, incompleteItems: [] }),
    _autoGenerateClosingChecklist: async () => undefined,
  };
  for (const k of ["updateDeal", "bulkUpdateDeals", "createDeal", "getDealsByIds"] as const) {
    s[k] = (dealRepo[k] as (...a: unknown[]) => unknown).bind(s);
  }
  return { storage: s };
});
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("../../server/services/usury", () => ({ checkUsury: vi.fn() }));
vi.mock("../../server/services/dealEvents", () => ({ emitDealCreated: vi.fn(), emitDealStageChanged: vi.fn() }));
vi.mock("../../server/services/dealHandoffService", () => ({
  getAllHandoffs: vi.fn(),
  getHandoffsForDeal: vi.fn(),
  initiateHandoff: vi.fn(),
  updateHandoffChecklist: vi.fn(),
  completeHandoff: vi.fn(),
}));

type Repo = typeof import("../../server/storage/dealRepo");
let repo: Repo;
let storage: Record<string, (...a: any[]) => Promise<any>>;
let app: express.Application;
const settle = () => new Promise((r) => setTimeout(r, 30));
const deals = () => F.h!.fake.rows("deals");
function seed(...rows: Array<Record<string, unknown>>) {
  for (const r of rows) deals().push({ organizationId: 42, type: "disposition", propertyId: 3, ...r });
}

/** A concurrent writer that moves deal `id` after the repository's pre-read, before its UPDATE. */
function concurrentlyMove(id: number, status: string) {
  let fired = false;
  F.h!.fake.beforeUpdate = (table) => {
    if (fired || table !== "deals") return;
    fired = true;
    const row = deals().find((d) => d.id === id);
    if (row) row.status = status;
  };
}

beforeAll(async () => {
  repo = await import("../../server/storage/dealRepo");
  await import("../../server/services/dealClose");
  storage = ((await import("../../server/storage")) as any).storage;
  const { registerDealRoutes } = await import("../../server/routes-deals");
  app = express();
  app.use(express.json());
  registerDealRoutes(app as any);
});

beforeEach(() => {
  F.h!.fake.reset();
  F.recordDealClose.mockClear();
});

describe("the conditional UPDATE (item 5)", () => {
  it("two updateDeal calls racing in_escrow → closed: one closes, the other is StaleDealWriteError — and the close runs once", async () => {
    seed({ id: 7, status: "in_escrow" });
    F.h!.fake.selectDelayMs = 5; // both pre-read before either writes
    const results = await Promise.allSettled([
      storage.updateDeal(7, { status: "closed" }, undefined, 42),
      storage.updateDeal(7, { status: "closed" }, undefined, 42),
    ]);
    F.h!.fake.selectDelayMs = 0;
    await settle();
    const ok = results.filter((r) => r.status === "fulfilled");
    const stale = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(stale).toHaveLength(1);
    expect((stale[0] as PromiseRejectedResult).reason).toBeInstanceOf(repo.StaleDealWriteError);
    expect((stale[0] as PromiseRejectedResult).reason).toMatchObject({ dealId: 7, expectedStatus: "in_escrow" });
    expect(F.recordDealClose).toHaveBeenCalledTimes(1);
    expect(deals()[0].status).toBe("closed");
  });

  it("a deal moved under the write (in_escrow → cancelled) is not then closed on the stale pre-read", async () => {
    seed({ id: 7, status: "in_escrow" });
    concurrentlyMove(7, "cancelled");
    await expect(storage.updateDeal(7, { status: "closed" }, undefined, 42)).rejects.toBeInstanceOf(repo.StaleDealWriteError);
    expect(deals()[0].status).toBe("cancelled");
    await settle();
    expect(F.recordDealClose).not.toHaveBeenCalled();
  });

  it("a field-only write is not status-guarded (no false conflicts)", async () => {
    seed({ id: 7, status: "in_escrow" });
    concurrentlyMove(7, "closed");
    const out = await storage.updateDeal(7, { notes: "x" }, undefined, 42);
    expect(out).toMatchObject({ id: 7, notes: "x" });
  });

  it("expectedUpdatedAt mismatch throws the same class (the plain-Error branch is gone)", async () => {
    seed({ id: 7, status: "in_escrow", updatedAt: new Date("2026-10-01T00:00:00Z") });
    await expect(
      storage.updateDeal(7, { notes: "x" }, new Date("2026-09-01T00:00:00Z"), 42),
    ).rejects.toBeInstanceOf(repo.StaleDealWriteError);
  });

  it("bulkUpdateDeals: one row moved under the batch → StaleDealWriteError, NOTHING written, no close", async () => {
    seed({ id: 7, status: "in_escrow" }, { id: 8, status: "in_escrow" });
    concurrentlyMove(8, "cancelled");
    await expect(storage.bulkUpdateDeals(42, [7, 8], { status: "closed" })).rejects.toBeInstanceOf(repo.StaleDealWriteError);
    expect(deals().map((d) => d.status)).toEqual(["in_escrow", "cancelled"]);
    await settle();
    expect(F.recordDealClose).not.toHaveBeenCalled();
  });
});

describe("the routes answer 409 through ONE mapper (item 6)", () => {
  const conflict = (res: request.Response) => {
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "CONFLICT", statusCode: 409, details: { dealId: 7 } });
    expect(typeof res.body.message).toBe("string");
  };

  it("PUT /api/deals/:id", async () => {
    seed({ id: 7, status: "in_escrow" });
    concurrentlyMove(7, "cancelled");
    conflict(await request(app).put("/api/deals/7").send({ status: "closed" }));
  });

  it("POST /api/deals/:id/advance-stage (was a 500)", async () => {
    seed({ id: 7, status: "in_escrow" });
    concurrentlyMove(7, "cancelled");
    conflict(await request(app).post("/api/deals/7/advance-stage"));
  });

  it("PATCH /api/deals/:id/stage", async () => {
    seed({ id: 7, status: "in_escrow" });
    concurrentlyMove(7, "cancelled");
    conflict(await request(app).patch("/api/deals/7/stage").send({ stage: "closed" }));
  });

  it("POST /api/deals/bulk-update", async () => {
    seed({ id: 7, status: "in_escrow" });
    concurrentlyMove(7, "cancelled");
    conflict(await request(app).post("/api/deals/bulk-update").send({ ids: [7], updates: { status: "closed" } }));
  });
});

describe("sendDealWriteError / Errors.conflict", () => {
  function fakeRes() {
    const r: any = { statusCode: 0, body: undefined, status(c: number) { r.statusCode = c; return r; }, json(b: unknown) { r.body = b; return r; } };
    return r;
  }

  it("maps each typed refusal; anything else is left to the caller", async () => {
    const { sendDealWriteError } = await import("../../server/utils/dealWriteErrors");
    let res = fakeRes();
    expect(sendDealWriteError(res, new repo.StaleDealWriteError(7, "in_escrow"))).toBe(true);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: "CONFLICT", statusCode: 409, details: { dealId: 7, expectedStatus: "in_escrow" } });

    res = fakeRes();
    expect(sendDealWriteError(res, new repo.DealTransitionRefusedError(7, "Cannot transition from closed to negotiating"))).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Cannot transition from closed to negotiating");

    res = fakeRes();
    expect(sendDealWriteError(res, new repo.DealCreationRefusedError("closed", ["negotiating", "offer_sent"], "opening"))).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body.details).toEqual({ status: "closed", allowedStatuses: ["negotiating", "offer_sent"] });
    expect(res.body.message).toContain("negotiating, offer_sent");

    res = fakeRes();
    expect(sendDealWriteError(res, new Error("boom"))).toBe(false);
    expect(res.statusCode).toBe(0); // nothing sent
  });

  it("Errors.conflict conforms to the envelope", async () => {
    const { Errors } = await import("../../server/utils/errors");
    const res = fakeRes();
    Errors.conflict(res, "moved", { a: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "CONFLICT", message: "moved", statusCode: 409, details: { a: 1 } });
  });
});
