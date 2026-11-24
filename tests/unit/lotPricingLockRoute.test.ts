/**
 * POST /api/parcels/:id/pricing-rules/lock — behaviour of the real handler.
 *
 * lotPricingDecision.test.ts reads the route's SOURCE; this runs it. Only the
 * edges are faked: `db` (a table-name stub), the scenario lookup and the
 * decision store (spies), so what is asserted is what the handler DID —
 * which parcel it asked about, what it cited, what it told the caller.
 *
 * Subdivider item 1 (founder call B-4, P1 taken): the lock cites the parent's
 * newest `subdivision_feasibility` scenario and takes an operator-chosen review
 * date; with no scenario on file it saves prices, records nothing, says so.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const NOW = vi.hoisted(() => ({ iso: "2026-11-23T12:00:00.000Z" }));
const spies = vi.hoisted(() => ({
  latest: vi.fn(),
  record: vi.fn(),
  listPrices: [] as Array<{ table: string; set: Record<string, unknown> }>,
}));

vi.mock("../../server/utils/clock", async (orig) => {
  const real = await orig<any>();
  return { ...real, clock: { ...real.clock, now: () => new Date(NOW.iso), nowMs: () => Date.parse(NOW.iso) } };
});
vi.mock("../../server/services/economics/scenarioStore", () => ({ latestScenarioForSubject: spies.latest }));
vi.mock("../../server/services/decisions/decisionStore", () => ({ recordDecision: spies.record }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: any, _s: any, n: any) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_r: any, _s: any, n: any) => n() }));
vi.mock("../../server/types/request", async (orig) => ({
  ...(await orig<object>()),
  getUserId: () => "user_1",
  getOrganizationId: () => 7,
}));
vi.mock("../../server/db", () => {
  const RULES = {
    id: 11,
    organizationId: 7,
    parentParcelId: 1049,
    basePriceSource: "fixed_per_acre",
    fixedPerAcreCents: 1_000_000,
    rules: [],
    lockedGrid: null,
  };
  const rowsFor = (table: unknown): any[] => {
    const name = getTableName(table as any);
    if (name === "lot_pricing_rules") return [RULES];
    if (name === "properties")
      return [
        { id: 2001, childLotNumber: "1", sizeAcres: "2", zoning: "R1", dd: null },
        { id: 2002, childLotNumber: "2", sizeAcres: "3", zoning: "R1", dd: null },
      ];
    return [];
  };
  const chain = (rows: any[]) => {
    const p: any = Promise.resolve(rows);
    p.orderBy = () => chain(rows);
    return p;
  };
  const writer = (table: unknown) => ({
    set: (set: Record<string, unknown>) => ({
      where: () => {
        spies.listPrices.push({ table: getTableName(table as any), set });
        return Promise.resolve();
      },
    }),
  });
  const db: any = {
    select: () => ({ from: (t: unknown) => ({ where: () => chain(rowsFor(t)) }) }),
    update: (t: unknown) => writer(t),
    transaction: async (fn: (tx: any) => Promise<void>) => fn({ update: (t: unknown) => writer(t) }),
  };
  return { db };
});

import { registerLotPricingRoutes } from "../../server/routes-lot-pricing";

type Handler = (req: any, res: any, next: (e?: unknown) => void) => unknown;
const routes = new Map<string, Handler[]>();
const appStub: any = {};
for (const m of ["get", "post", "patch", "put", "delete"]) appStub[m] = (p: string, ...h: Handler[]) => routes.set(`${m.toUpperCase()} ${p}`, h);
registerLotPricingRoutes(appStub);

async function lock(body: unknown, id = "1049") {
  const req: any = { params: { id }, body, headers: {} };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  for (const h of routes.get("POST /api/parcels/:id/pricing-rules/lock")!) {
    let next = false;
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return res;
}

const FUTURE = "2027-03-01T00:00:00.000Z";

beforeEach(() => {
  spies.latest.mockReset();
  spies.record.mockReset();
  spies.record.mockResolvedValue({ id: 901 });
  spies.listPrices.length = 0;
});

describe("lock route — behaviour", () => {
  it("vacuity: the route is registered and the stub db serves the rules and child lots", async () => {
    expect(routes.has("POST /api/parcels/:id/pricing-rules/lock")).toBe(true);
    spies.latest.mockResolvedValue(null);
    const res = await lock({ reviewDueAt: null });
    expect(res.statusCode).toBe(200);
    expect(res.body.lockedGrid).toHaveLength(2);
  });

  it("WITH a scenario: asks about the PARENT parcel + the feasibility engine, cites exactly that id, records the operator's date", async () => {
    spies.latest.mockResolvedValue({ id: 5150, computedAt: new Date(), body: {} });
    const res = await lock({ reviewDueAt: FUTURE });
    expect(res.statusCode).toBe(200);
    // Which parcel, which engine — the named trap is citing the wrong parcel's scenario.
    expect(spies.latest).toHaveBeenCalledWith(7, "property", 1049, "subdivision_feasibility");
    expect(spies.record).toHaveBeenCalledTimes(1);
    const [org, input, , scenarioIds] = spies.record.mock.calls[0];
    expect(org).toBe(7);
    expect(input.subjectId).toBe(1049);
    expect(input.kind).toBe("price");
    expect(input.strategyPackId).toBe("subdivider");
    expect(scenarioIds).toEqual([5150]);
    expect(input.reviewDueAt).toEqual(new Date(FUTURE));
    expect(input.rationale).toContain("Graded on the parent position: sold / abandoned — lot-level sell-through is not captured by this vocabulary.");
    expect(res.body).toMatchObject({ decisionSnapshotId: 901, decisionRecorded: true, decisionWhy: null, reviewDueAt: FUTURE });
  });

  it("a null review date is an ANSWER ('no set date') — recorded as null, never replaced by a default", async () => {
    spies.latest.mockResolvedValue({ id: 5150, computedAt: new Date(), body: {} });
    const res = await lock({ reviewDueAt: null });
    expect(res.statusCode).toBe(200);
    expect(spies.record.mock.calls[0][1].reviewDueAt).toBeNull();
    expect(res.body.reviewDueAt).toBeNull();
  });

  it("with NO scenario: prices still save, NO decision is recorded or invented, and the response says so", async () => {
    spies.latest.mockResolvedValue(null);
    const res = await lock({ reviewDueAt: FUTURE });
    expect(res.statusCode).toBe(200);
    expect(spies.record).not.toHaveBeenCalled();
    // Prices were written (every child's listPrice) and the grid frozen.
    expect(spies.listPrices.filter((w) => w.table === "properties" && "listPrice" in w.set)).toHaveLength(2);
    expect(spies.listPrices.some((w) => w.table === "lot_pricing_rules" && "lockedGrid" in w.set)).toBe(true);
    // No decision link was written either.
    expect(spies.listPrices.some((w) => "lockedDecisionSnapshotId" in w.set)).toBe(false);
    expect(res.body.decisionRecorded).toBe(false);
    expect(res.body.decisionSnapshotId).toBeNull();
    expect(res.body.reviewDueAt).toBeNull();
    expect(res.body.decisionWhy).toMatch(/No feasibility scenario is on file/);
    expect(res.body.decisionWhy).toMatch(/prices were saved and no decision was recorded/);
  });

  it("a MISSING review date is refused with nothing written (required, no default)", async () => {
    spies.latest.mockResolvedValue({ id: 5150, computedAt: new Date(), body: {} });
    for (const body of [{}, { overrides: {} }, undefined, { reviewDueAt: undefined }]) {
      const res = await lock(body);
      expect(res.statusCode).toBe(422);
    }
    expect(spies.listPrices).toEqual([]);
    expect(spies.record).not.toHaveBeenCalled();
  });

  it("a PAST (or malformed) review date is refused with nothing written", async () => {
    spies.latest.mockResolvedValue({ id: 5150, computedAt: new Date(), body: {} });
    for (const reviewDueAt of ["2026-11-01T00:00:00.000Z", NOW.iso, "next tuesday", 20270301]) {
      const res = await lock({ reviewDueAt });
      expect(res.statusCode, String(reviewDueAt)).toBe(422);
    }
    expect(spies.listPrices).toEqual([]);
    expect(spies.record).not.toHaveBeenCalled();
  });

  it("a decision-store failure never fails the lock — prices saved, no snapshot, and it says why", async () => {
    spies.latest.mockResolvedValue({ id: 5150, computedAt: new Date(), body: {} });
    spies.record.mockRejectedValue(new Error("db down"));
    const res = await lock({ reviewDueAt: FUTURE });
    expect(res.statusCode).toBe(200);
    expect(res.body.decisionRecorded).toBe(false);
    expect(res.body.decisionWhy).toMatch(/could not be written/);
    expect(spies.listPrices.filter((w) => "listPrice" in w.set)).toHaveLength(2);
  });
});
