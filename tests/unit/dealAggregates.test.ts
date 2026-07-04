/**
 * T0-10 — Deals header aggregates.
 *
 * Two layers under test:
 *  1. foldDealAggregates (server/services/dealAggregates.ts) — the pure
 *     fold from grouped SQL rows to the response shape. This encodes the
 *     exact KPI semantics the Deals header used to compute client-side
 *     from a single 25-row page (and therefore got wrong for >25 deals).
 *  2. GET /api/deals/aggregates (server/routes-deals.ts) — mounted on a
 *     bare express app with auth/org/db mocked, per the routes-eddm.test.ts
 *     pattern. Verifies route registration order (literal path must beat
 *     /api/deals/:id), org scoping inputs, param validation, and shape.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import {
  foldDealAggregates,
  STAGE_BENCHMARK_DAYS,
  type DealAggregateRow,
} from "../../server/services/dealAggregates";

// ── Mock infra dependencies BEFORE importing the module under test ──────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

// Heavy service imports pulled in by routes-deals.ts — stubbed; the
// aggregates route touches none of them.
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("../../server/services/usury", () => ({ checkUsury: vi.fn() }));
vi.mock("../../server/services/dealHandoffService", () => ({
  getAllHandoffs: vi.fn(),
  getHandoffsForDeal: vi.fn(),
  initiateHandoff: vi.fn(),
  updateHandoffChecklist: vi.fn(),
  completeHandoff: vi.fn(),
}));

// db.select().from().where().groupBy() resolves to whatever groupedRows
// holds; we also capture the where() arg to assert org scoping happened.
let groupedRows: any[] = [];
let lastWhereArg: unknown = null;
vi.mock("../../server/db", () => {
  const chain: any = {
    from: () => chain,
    where: (arg: unknown) => {
      lastWhereArg = arg;
      return chain;
    },
    groupBy: async () => groupedRows,
  };
  return {
    db: { select: () => chain },
    withTransaction: async (fn: any) => fn(),
  };
});

import { registerDealRoutes } from "../../server/routes-deals";

// ── 1. Pure fold semantics ──────────────────────────────────────────────────

const row = (over: Partial<DealAggregateRow>): DealAggregateRow => ({
  status: "negotiating",
  type: "acquisition",
  count: 0,
  pipelineValueCents: 0,
  acceptedValueCents: 0,
  stalledCount: 0,
  warnAtLeastCount: 0,
  ...over,
});

describe("foldDealAggregates", () => {
  it("returns all-zero totals and empty stages for no rows", () => {
    const out = foldDealAggregates([]);
    expect(out.totals).toEqual({
      totalDeals: 0,
      acquisitions: 0,
      dispositions: 0,
      totalPipelineValue: 0,
      closedValue: 0,
      stalledCount: 0,
      warningCount: 0,
    });
    expect(out.stages).toEqual([]);
  });

  it("computes header KPIs across statuses and types", () => {
    const out = foldDealAggregates([
      row({ status: "negotiating", type: "acquisition", count: 30, pipelineValueCents: 30_000_000, stalledCount: 4, warnAtLeastCount: 10 }),
      row({ status: "offer_sent", type: "disposition", count: 5, pipelineValueCents: 5_000_000, stalledCount: 1, warnAtLeastCount: 1 }),
      row({ status: "closed", type: "acquisition", count: 8, pipelineValueCents: 8_000_000, acceptedValueCents: 7_500_000 }),
      row({ status: "cancelled", type: "acquisition", count: 3, pipelineValueCents: 3_300_000 }),
    ]);

    // totalDeals counts everything, including cancelled (bar denominator).
    expect(out.totals.totalDeals).toBe(46);
    // acquisitions/dispositions exclude cancelled (30 + 8 closed acq).
    expect(out.totals.acquisitions).toBe(38);
    expect(out.totals.dispositions).toBe(5);
    // pipeline value excludes closed AND cancelled groups.
    expect(out.totals.totalPipelineValue).toBe(350_000);
    // closed value sums acceptedValue of closed rows only.
    expect(out.totals.closedValue).toBe(75_000);
    // stalled sums only active groups; warning is warnAtLeast minus stalled.
    expect(out.totals.stalledCount).toBe(5);
    expect(out.totals.warningCount).toBe(6);
  });

  it("merges (status, type) groups into one stage entry per status", () => {
    const out = foldDealAggregates([
      row({ status: "negotiating", type: "acquisition", count: 2, pipelineValueCents: 2_000 }),
      row({ status: "negotiating", type: "disposition", count: 3, pipelineValueCents: 3_000 }),
    ]);
    expect(out.stages).toEqual([{ status: "negotiating", count: 5, value: 50 }]);
  });

  it("never reports negative warning counts", () => {
    const out = foldDealAggregates([
      row({ status: "accepted", count: 2, stalledCount: 2, warnAtLeastCount: 1 }),
    ]);
    expect(out.totals.warningCount).toBe(0);
  });

  it("keeps stage benchmarks in lockstep with the client copy", () => {
    // Mirror of STAGE_BENCHMARK_DAYS in client/src/pages/deals.tsx — if one
    // side changes, change both (the client uses its copy for per-card
    // health dots; the server for aggregate stalled/warning counts).
    expect(STAGE_BENCHMARK_DAYS).toEqual({
      negotiating: 14,
      offer_sent: 5,
      countered: 5,
      accepted: 7,
      in_escrow: 30,
      closed: 999,
      cancelled: 999,
    });
  });
});

// ── 2. Route behavior ───────────────────────────────────────────────────────

describe("GET /api/deals/aggregates", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerDealRoutes(app as any);
  });

  it("returns folded org-scoped aggregates", async () => {
    groupedRows = [
      row({ status: "negotiating", type: "acquisition", count: 40, pipelineValueCents: 40_000_000, stalledCount: 3, warnAtLeastCount: 5 }),
      row({ status: "closed", type: "acquisition", count: 10, acceptedValueCents: 12_000_000 }),
    ];
    lastWhereArg = null;

    const res = await request(app).get("/api/deals/aggregates");
    expect(res.status).toBe(200);
    expect(res.body.totals.totalDeals).toBe(50);
    expect(res.body.totals.totalPipelineValue).toBe(400_000);
    expect(res.body.totals.closedValue).toBe(120_000);
    expect(res.body.totals.stalledCount).toBe(3);
    expect(res.body.totals.warningCount).toBe(2);
    expect(res.body.stages).toHaveLength(2);
    // The query MUST be org-scoped — a where clause was applied.
    expect(lastWhereArg).not.toBeNull();
  });

  it("is not shadowed by the /api/deals/:id route", async () => {
    // If /api/deals/:id were registered first, "aggregates" would be parsed
    // as an id (NaN) and this would 404/500 through storage.getDeal.
    groupedRows = [];
    const res = await request(app).get("/api/deals/aggregates");
    expect(res.status).toBe(200);
    expect(res.body.totals).toBeDefined();
  });

  it("rejects an invalid type filter with 400", async () => {
    const res = await request(app).get("/api/deals/aggregates?type=bogus");
    expect(res.status).toBe(400);
  });

  it("accepts the acquisition/disposition type filter", async () => {
    groupedRows = [row({ status: "negotiating", type: "disposition", count: 2, pipelineValueCents: 900_000 })];
    const res = await request(app).get("/api/deals/aggregates?type=disposition");
    expect(res.status).toBe(200);
    expect(res.body.totals.dispositions).toBe(2);
  });
});
