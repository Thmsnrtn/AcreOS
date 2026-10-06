/**
 * W10.4 contract items 1–2 — ONE close writer, ONE contract-signed emitter.
 *
 * Every consequence of a deal closing (calibration, outcome snapshots, the
 * comp, the commission, first_deal_closed, …) ran only inside PUT
 * /api/deals/:id. advance-stage, both bulk endpoints, the Kanban PATCH, Pax,
 * the autopilot, workflows and voice CRM closed deals through the same
 * repository and got none of it. deal.contract_signed was likewise emitted by
 * PUT alone.
 *
 * Both now run from the deal repository's post-write hook
 * (storage/dealRepo.ts → services/dealClose.ts), so:
 *
 *   - a close through ANY writer runs recordDealClose exactly once;
 *   - PUT runs it exactly once (it no longer runs the effects itself);
 *   - a bulk close runs it once per row that actually closed;
 *   - a refused write runs none;
 *   - entering escrow emits deal.contract_signed iff a signed document exists
 *     (or PUT's operator attestation, carried as context).
 *
 * The routes are driven for real over a fake primary handle that EVALUATES
 * its WHERE clauses (tests/helpers/fakeDealsDb.ts), with the real repository
 * methods behind `storage`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const F = vi.hoisted(() => ({
  h: null as null | ReturnType<typeof import("../helpers/fakeDealsDb").createFakeDb>,
  recordDealClose: vi.fn(async (..._args: unknown[]) => undefined),
  retract: vi.fn(async () => true),
  emitEvidenced: vi.fn(),
  wholesale: vi.fn(),
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
vi.mock("../../server/services/workflow-engine", () => ({ emitWholesaleDealEvent: F.wholesale }));
vi.mock("../../server/services/dealClose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/dealClose")>();
  return {
    ...actual,
    recordDealClose: F.recordDealClose,
    retractClosedSaleTraining: F.retract,
    // The REAL evidence rule + emit, observed.
    emitContractSignedIfEvidenced: (...args: Parameters<typeof actual.emitContractSignedIfEvidenced>) => {
      F.emitEvidenced(...args);
      return actual.emitContractSignedIfEvidenced(...args);
    },
  };
});
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
  const deals = () => F.h!.fake.rows("deals");
  const s: Record<string, unknown> = {
    getDeal: async (orgId: number, id: number) => {
      const r = deals().find((d) => d.id === id && d.organizationId === orgId);
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

let app: express.Application;
const settle = () => new Promise((r) => setTimeout(r, 30));

function seed(...rows: Array<Record<string, unknown>>) {
  const t = F.h!.fake.rows("deals");
  for (const r of rows) {
    t.push({ organizationId: 42, type: "disposition", propertyId: 3, acceptedAmount: "60000", assignedTo: null, ...r });
  }
}

beforeAll(async () => {
  // The hook loads dealClose lazily; load it once up front so a first-import
  // delay cannot push one test's hook into the next test's window.
  await import("../../server/services/dealClose");
  await import("../../server/services/wholesaleEvents");
  const { registerDealRoutes } = await import("../../server/routes-deals");
  app = express();
  app.use(express.json());
  registerDealRoutes(app as any);
});

beforeEach(() => {
  F.h!.fake.reset();
  F.recordDealClose.mockClear();
  F.retract.mockClear();
  F.emitEvidenced.mockClear();
  F.wholesale.mockClear();
});

describe("a close through any writer runs recordDealClose exactly once", () => {
  it("PUT /api/deals/:id — exactly once, with the acting user (no double-fire)", async () => {
    seed({ id: 7, status: "in_escrow" });
    const res = await request(app).put("/api/deals/7").send({ status: "closed" });
    expect(res.status).toBe(200);
    await settle();
    expect(F.recordDealClose).toHaveBeenCalledTimes(1);
    expect(F.recordDealClose).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ status: "in_escrow" }),
      expect.objectContaining({ id: 7, status: "closed", type: "disposition" }),
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("advance-stage (in_escrow → closed) — the swipe path now has the close's consequences", async () => {
    seed({ id: 7, status: "in_escrow" });
    const res = await request(app).post("/api/deals/7/advance-stage");
    expect(res.status).toBe(200);
    expect(res.body.nextStatus).toBe("closed");
    await settle();
    expect(F.recordDealClose).toHaveBeenCalledTimes(1);
    expect(F.recordDealClose.mock.calls[0][2]).toMatchObject({ id: 7, status: "closed" });
  });

  it("PATCH /api/deals/:id/stage (the Kanban drag) — once", async () => {
    seed({ id: 7, status: "in_escrow" });
    const res = await request(app).patch("/api/deals/7/stage").send({ stage: "closed" });
    expect(res.status).toBe(200);
    await settle();
    expect(F.recordDealClose).toHaveBeenCalledTimes(1);
  });

  it("bulk-update — once per row that actually closed; an already-closed row runs none", async () => {
    seed({ id: 7, status: "in_escrow" }, { id: 8, status: "in_escrow" }, { id: 9, status: "closed" });
    const res = await request(app).post("/api/deals/bulk-update").send({ ids: [7, 8, 9], updates: { status: "closed" } });
    expect(res.status).toBe(200);
    await settle();
    expect(F.recordDealClose).toHaveBeenCalledTimes(2);
    expect(F.recordDealClose.mock.calls.map((c) => (c[2] as { id: number }).id).sort()).toEqual([7, 8]);
    for (const c of F.recordDealClose.mock.calls) {
      expect(c[2]).toMatchObject({ status: "closed", type: "disposition" }); // the full committed row, not a guess
    }
  });

  it("a cancel is a close too (the lost snapshot + calibration) — once", async () => {
    seed({ id: 7, status: "offer_sent" });
    const res = await request(app).put("/api/deals/7").send({ status: "cancelled" });
    expect(res.status).toBe(200);
    await settle();
    expect(F.recordDealClose).toHaveBeenCalledTimes(1);
    expect(F.recordDealClose.mock.calls[0][2]).toMatchObject({ status: "cancelled" });
  });

  it("a refused write runs none (closed is terminal)", async () => {
    seed({ id: 7, status: "closed" });
    const res = await request(app).put("/api/deals/7").send({ status: "negotiating" });
    expect(res.status).toBe(400);
    await settle();
    expect(F.recordDealClose).not.toHaveBeenCalled();
    expect(F.h!.fake.rows("deals")[0].status).toBe("closed");
  });

  it("a field-only edit of a closed deal runs none", async () => {
    seed({ id: 7, status: "closed" });
    const res = await request(app).put("/api/deals/7").send({ notes: "wire received" });
    expect(res.status).toBe(200);
    await settle();
    expect(F.recordDealClose).not.toHaveBeenCalled();
  });

  it("the repository itself (no route): updateDeal and bulkUpdateDeals both call it", async () => {
    const { storage } = (await import("../../server/storage")) as unknown as { storage: Record<string, (...a: unknown[]) => Promise<unknown>> };
    seed({ id: 7, status: "in_escrow" }, { id: 8, status: "in_escrow" });
    await storage.updateDeal(7, { status: "closed" }, undefined, 42);
    await storage.bulkUpdateDeals(42, [8], { status: "closed" });
    await settle();
    expect(F.recordDealClose.mock.calls.map((c) => (c[2] as { id: number }).id).sort()).toEqual([7, 8]);
    // No acting user on a non-route write: none is invented.
    expect(F.recordDealClose.mock.calls[0][3] ?? {}).not.toHaveProperty("userId", expect.any(String));
  });
});

describe("deal.contract_signed: one emitter, on evidence, for every path", () => {
  const contractSigned = () => F.wholesale.mock.calls.filter((c) => c[0] === "deal.contract_signed");

  it("advance-stage accepted → in_escrow with NO signed document emits nothing", async () => {
    seed({ id: 7, status: "accepted" });
    const res = await request(app).post("/api/deals/7/advance-stage");
    expect(res.status).toBe(200);
    expect(res.body.nextStatus).toBe("in_escrow");
    await settle();
    expect(F.emitEvidenced).toHaveBeenCalledTimes(1); // the hook ran…
    expect(contractSigned()).toHaveLength(0); // …and found no evidence
  });

  it("advance-stage accepted → in_escrow WITH a signed document emits once, citing it", async () => {
    seed({ id: 7, status: "accepted" });
    F.h!.fake.rows("generated_documents").push(
      { id: 55, organizationId: 42, dealId: 7, status: "signed", signedAt: new Date("2026-10-01T00:00:00Z") },
      // Another org's signed document on a deal with the same id is not evidence.
      { id: 56, organizationId: 99, dealId: 7, status: "signed", signedAt: new Date("2026-10-02T00:00:00Z") },
    );
    const res = await request(app).post("/api/deals/7/advance-stage");
    expect(res.status).toBe(200);
    await settle();
    expect(contractSigned()).toHaveLength(1);
    expect(contractSigned()[0][3]).toMatchObject({ evidence: { kind: "signed_document", documentId: 55 } });
  });

  it("a merely 'final' (unsigned) document is not evidence", async () => {
    seed({ id: 7, status: "accepted" });
    F.h!.fake.rows("generated_documents").push({ id: 57, organizationId: 42, dealId: 7, status: "final", signedAt: null });
    await request(app).post("/api/deals/7/advance-stage");
    await settle();
    expect(contractSigned()).toHaveLength(0);
  });

  it("PUT with the operator's attestation still emits — once, attested by the acting user", async () => {
    seed({ id: 7, status: "accepted" });
    const res = await request(app).put("/api/deals/7").send({ status: "in_escrow", contractSignedAttested: true });
    expect(res.status).toBe(200);
    await settle();
    expect(F.emitEvidenced).toHaveBeenCalledTimes(1);
    expect(contractSigned()).toHaveLength(1);
    expect(contractSigned()[0][3]).toMatchObject({ evidence: { kind: "operator_attested", attestedBy: "user-1" } });
  });

  it("an UNDO back into in_escrow (closed → in_escrow, backwardUndo) is not a signing — nothing emits, even with a signed document", async () => {
    const { storage } = (await import("../../server/storage")) as unknown as { storage: Record<string, (...a: unknown[]) => Promise<unknown>> };
    seed({ id: 7, status: "closed" });
    F.h!.fake.rows("generated_documents").push({ id: 55, organizationId: 42, dealId: 7, status: "signed", signedAt: new Date("2026-10-01T00:00:00Z") });
    await storage.updateDeal(7, { status: "in_escrow" }, undefined, 42, { backwardUndo: true });
    await settle();
    expect(F.h!.fake.rows("deals")[0].status).toBe("in_escrow"); // the undo applied…
    expect(contractSigned()).toHaveLength(0); // …and announced no contract
    // The forward entry from accepted, same evidence, still emits (the gate is the direction).
    seed({ id: 8, status: "accepted" });
    F.h!.fake.rows("generated_documents").push({ id: 58, organizationId: 42, dealId: 8, status: "signed", signedAt: new Date("2026-10-01T00:00:00Z") });
    await storage.updateDeal(8, { status: "in_escrow" }, undefined, 42);
    await settle();
    expect(contractSigned()).toHaveLength(1);
  });

  it("a LEGACY status entering escrow with a signed document emits — only a backward move is excluded (W10.4 re-audit, finding 10)", async () => {
    const { storage } = (await import("../../server/storage")) as unknown as { storage: Record<string, (...a: unknown[]) => Promise<unknown>> };
    seed({ id: 7, status: "under_contract" }); // pre-vocabulary; validateDealTransition lets it re-enter
    F.h!.fake.rows("generated_documents").push({ id: 55, organizationId: 42, dealId: 7, status: "signed", signedAt: new Date("2026-10-01T00:00:00Z") });
    await storage.updateDeal(7, { status: "in_escrow" }, undefined, 42);
    await settle();
    expect(F.h!.fake.rows("deals")[0].status).toBe("in_escrow");
    expect(contractSigned()).toHaveLength(1);
  });

  it("PUT without the attestation and without a document emits nothing", async () => {
    seed({ id: 7, status: "accepted" });
    await request(app).put("/api/deals/7").send({ status: "in_escrow" });
    await settle();
    expect(contractSigned()).toHaveLength(0);
  });
});

describe("the population: the close's effects live in ONE file, triggered from ONE place", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  function serverFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts") && !/\.test\.|\.spec\./.test(e.name)) out.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, "server"));
    return out;
  }

  /** Each close side effect formerly inline in PUT, by the call that performs it. */
  const CLOSE_EFFECTS = [
    "onDealClosed(",
    "recordReferralShareMoment(",
    'snapshotType: "deal_outcome"',
    'snapshotType: "avm_vs_actual"',
    'snapshotType: "lead_conversion"',
    "recordTransactionForTraining(",
    'dispatchTeamEvent(orgId, "deal_closed"',
    "recordDealCommission(",
    '"deal_closed", {',
    'eventName: "first_deal_closed"',
    'outcomeType: "deal_won"',
    "contributeClosedDealToNetwork(",
    "recordPatternFromClosedDeal(",
  ];

  it("dealClose.ts performs every one of them (vacuity)", () => {
    const src = read("server/services/dealClose.ts");
    for (const m of CLOSE_EFFECTS) expect(src, m).toContain(m);
  });

  it("PUT's route file performs none of them, and never emits contract_signed itself", () => {
    const src = read("server/routes-deals.ts");
    const present = CLOSE_EFFECTS.filter((m) => src.includes(m));
    expect(present).toEqual([]);
    expect(src).not.toMatch(/\bemitContractSigned\(/);
    expect(src).not.toMatch(/\brecordDealClose\(/);
  });

  it("recordDealClose and the evidenced emit are called only by the deal repository; emitContractSigned only by dealClose", () => {
    const callers = (re: RegExp, defFile: string) =>
      serverFiles().filter((f) => {
        const src = read(f);
        const n = (src.match(re) ?? []).length;
        // The defining file names it once in its declaration.
        return f === defFile ? n > 1 : n > 0;
      });
    expect(callers(/\brecordDealClose\(/g, "server/services/dealClose.ts")).toEqual(["server/storage/dealRepo.ts"]);
    expect(callers(/\bemitContractSignedIfEvidenced\(/g, "server/services/dealClose.ts")).toEqual(["server/storage/dealRepo.ts"]);
    expect(callers(/\bemitContractSigned\(/g, "server/services/wholesaleEvents.ts")).toEqual(["server/services/dealClose.ts"]);
  });

  it("the close's training row (keyed deal:<dealKey>) is written only by dealClose", () => {
    const writers = serverFiles().filter((f) => /dedupeKey:\s*`deal:/.test(read(f)));
    expect(writers).toEqual(["server/services/dealClose.ts"]);
  });
});
