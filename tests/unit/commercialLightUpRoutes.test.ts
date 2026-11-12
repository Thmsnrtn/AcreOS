/**
 * W2-COMMERCIAL (2026-11-06) — the commercial handlers the Commercial tab on
 * /leases now calls, driven through their REAL registrations in
 * server/routes-rent-ledger.ts with the database mocked by TABLE (a query
 * resolves to the rows staged for the table it reads, whatever order the handler
 * asks in — so a reordered handler cannot pass by accident of call order).
 *
 * The pure engines are tested in camReconciliation.test.ts / perSqft.test.ts.
 * What is pinned here is the WIRING that put a wrong figure within reach once
 * the screen existed:
 *
 *   1. CAM generate no longer turns "nothing recorded" into a bill. Before, a
 *      lease with no CAM charges on the ledger was reconciled against its
 *      monthly CAM estimate × the pool's months (or $0), and the frozen
 *      statement said "Balance due"/"Credit due" on that assumption.
 *   2. The lease's TERM reaches the engine, so a mid-period tenant is refused
 *      rather than billed a full period's share.
 *   3. A lease already reconciled for the same expenses in an overlapping pool is
 *      refused (one expense recovers once).
 *   4. Per-sqft quotes the escalated rent in effect, read from the lease's own
 *      escalation steps — not the starting rent.
 *   5. The deleted Stage-1 operator-entered reconciliation writer is gone from
 *      the registrations, and the surviving commercial routes are all present
 *      (a vacuity floor: this suite read the real registrar).
 *
 * No DATABASE_URL required — the db module is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rowsByTable: new Map<unknown, unknown[]>(),
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
}));

vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const select = () => {
    let table: unknown;
    const link: any = {
      from: (t: unknown) => {
        table = t;
        return link;
      },
      innerJoin: () => link,
      where: () => link,
      orderBy: () => link,
      then: (resolve: any, reject: any) =>
        Promise.resolve(h.rowsByTable.get(table) ?? []).then(resolve, reject),
    };
    return link;
  };
  const insert = (table: unknown) => {
    const link: any = {
      values: (values: Record<string, unknown>) => {
        h.inserts.push({ table, values });
        return link;
      },
      onConflictDoUpdate: () => link,
      onConflictDoNothing: () => link,
      returning: () => Promise.resolve([{ id: "rec-1", ...h.inserts[h.inserts.length - 1]?.values }]),
    };
    return link;
  };
  return { ...actual, db: { select, insert } };
});

import { registerRentLedgerRoutes } from "../../server/routes-rent-ledger";
import {
  camExpensePools,
  camReconciliations,
  leaseRentSchedule,
  propertyExpenses,
  rentCharges,
  rentalLeases,
} from "@shared/schema";

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

/** Every (VERB path) the real registrar mounts, mapped to its final handler. */
function registeredRoutes(): Map<string, Handler> {
  const routes = new Map<string, Handler>();
  const app: Record<string, unknown> = {};
  for (const verb of ["get", "post", "patch", "put", "delete"]) {
    app[verb] = (path: string, ...args: unknown[]) =>
      routes.set(`${verb.toUpperCase()} ${path}`, args[args.length - 1] as Handler);
  }
  registerRentLedgerRoutes(app as never);
  return routes;
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const ORG = 7;
function req(params: Record<string, string>, body: Record<string, unknown> = {}) {
  return {
    params,
    body,
    organization: { id: ORG, onboardingData: { businessType: "commercial" } },
    user: { id: "user-1" },
  };
}

const POOL = {
  id: "pool-1",
  organizationId: ORG,
  propertyId: 11,
  poolKind: "cam",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  recoverableCategories: ["repairs", "utilities"],
  totalRentableSqft: 10_000,
  adminFeeBps: null,
  grossUpPct: null,
};
const LEASE = {
  id: "lease-1",
  organizationId: ORG,
  propertyId: 11,
  startDate: "2025-01-01",
  endDate: null as string | null,
  monthlyRentCents: 1_000_000,
  rentableSqft: 2_000,
  camProRataBps: null,
  camBaseYearStopCents: null,
  leaseType: "nnn",
  // The lease DOES carry a monthly CAM estimate — the input the old fallback
  // multiplied by the pool's months and presented as what was billed.
  camEstimateMonthlyCents: 150_000,
};
const EXPENSES = [
  { category: "repairs", amountCents: 100_000, isOperating: true, incurredOn: "2026-03-15" },
  { category: "utilities", amountCents: 50_000, isOperating: true, incurredOn: "2026-06-10" },
];

const routes = registeredRoutes();
const generate = routes.get("POST /api/cam-pools/:poolId/reconciliations/generate")!;
const perSqft = routes.get("GET /api/leases/:id/per-sqft")!;

beforeEach(() => {
  h.rowsByTable.clear();
  h.inserts.length = 0;
  h.rowsByTable.set(camExpensePools, [POOL]);
  h.rowsByTable.set(rentalLeases, [LEASE]);
  h.rowsByTable.set(propertyExpenses, EXPENSES);
});

async function runGenerate(body: Record<string, unknown>) {
  const res = fakeRes();
  await generate(req({ poolId: POOL.id }, { leaseId: LEASE.id, ...body }), res);
  return res;
}

describe("POST /api/cam-pools/:poolId/reconciliations/generate — a record, or a refusal", () => {
  it("refuses (400, writes nothing) with no ledger CAM charges and no billed total — despite a lease CAM estimate", async () => {
    const res = await runGenerate({});
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/no record of the CAM estimates billed/);
    expect(h.inserts).toHaveLength(0);
  });

  it("freezes a statement on the landlord's stated total, and the statement says where it came from", async () => {
    const res = await runGenerate({ estimatedBilledCents: 25_000 });
    expect(res.statusCode).toBe(200);
    expect(h.inserts).toHaveLength(1);
    const frozen = h.inserts[0].values;
    expect(h.inserts[0].table).toBe(camReconciliations);
    expect(frozen.generatedBy).toBe("engine");
    expect(frozen.estimatedBilledBasis).toBe("operator_stated");
    expect(frozen.recoverableShareCents).toBe(30_000); // 150,000 × 2,000/10,000
    expect(frozen.deltaCents).toBe(5_000);
    expect(String(frozen.statementMarkdown)).toContain("as stated by the landlord");
  });

  it("uses the ledger's CAM charges when the period has any", async () => {
    h.rowsByTable.set(rentCharges, [{ amountCents: 20_000 }, { amountCents: 12_000 }]);
    const res = await runGenerate({});
    expect(res.statusCode).toBe(200);
    expect(h.inserts[0].values.estimatedBilledBasis).toBe("from_charges");
    expect(h.inserts[0].values.estimatedBilledCents).toBe(32_000);
  });

  it("refuses a stated total that contradicts the ledger, rather than pick one silently", async () => {
    h.rowsByTable.set(rentCharges, [{ amountCents: 20_000 }]);
    const res = await runGenerate({ estimatedBilledCents: 25_000 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/AcreOS reconciles against the ledger/);
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses a tenant whose lease began mid-period (the lease term reaches the engine)", async () => {
    h.rowsByTable.set(rentalLeases, [{ ...LEASE, startDate: "2026-07-01" }]);
    const res = await runGenerate({ estimatedBilledCents: 25_000 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/does not cover the whole pool period/);
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses when this lease is already reconciled for an overlapping category in an overlapping pool", async () => {
    h.rowsByTable.set(camReconciliations, [
      {
        poolKind: "all_in",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        recoverableCategories: ["utilities", "insurance"],
      },
    ]);
    const res = await runGenerate({ estimatedBilledCents: 25_000 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/would bill the same expense twice/);
    expect(h.inserts).toHaveLength(0);
  });
});

describe("GET /api/leases/:id/per-sqft — the rent in effect, from the lease's own steps", () => {
  it("quotes the escalated base rent, not the lease's starting rent", async () => {
    h.rowsByTable.set(leaseRentSchedule, [
      {
        effectiveMonth: "2020-01-01",
        stepType: "fixed_pct",
        amountCents: null,
        pctBps: 300,
        cpiIndexBase: null,
        cpiIndexCurrent: null,
        floorPctBps: null,
        ceilingPctBps: null,
      },
    ]);
    const res = fakeRes();
    await perSqft(req({ id: LEASE.id }), res);
    expect(res.statusCode).toBe(200);
    // $10,000 × 1.03 = $10,300/mo → × 12 ÷ 2,000 sqft = $61.80/sqft/yr.
    expect(res.body.perSqft.monthlyRentCentsUsed).toBe(1_030_000);
    expect(res.body.perSqft.baseRentPerSqftAnnualCents).toBe(6_180);
    // NNN with a recorded CAM estimate: occupancy = (10,300 + 1,500) × 12 ÷ 2,000.
    expect(res.body.perSqft.occupancyCostPerSqftAnnualCents).toBe(7_080);
  });
});

describe("registrations — the deleted writer is gone, the lit routes are all mounted", () => {
  it("no longer registers the Stage-1 operator-entered reconciliation writer", () => {
    expect(routes.has("POST /api/cam-pools/:poolId/reconciliations")).toBe(false);
  });

  it("still registers every commercial route the Commercial tab calls (vacuity floor)", () => {
    for (const key of [
      "PATCH /api/leases/:id/commercial-terms",
      "POST /api/properties/:propertyId/cam-pools",
      "GET /api/properties/:propertyId/cam-pools",
      "POST /api/cam-pools/:poolId/reconciliations/generate",
      "GET /api/cam-pools/:poolId/reconciliations",
      "POST /api/leases/:id/rent-schedule",
      "GET /api/leases/:id/rent-schedule",
      "GET /api/leases/:id/per-sqft",
    ]) {
      expect(routes.has(key), key).toBe(true);
    }
  });
});
