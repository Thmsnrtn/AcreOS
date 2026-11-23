/**
 * GET /api/wholesaler/dashboard — an "assignment fee" is an assignment fee.
 *
 * THE DEFECT: with no signed contract_assignments the route fell back to
 * sum(analysisResults.netProfit) over closed deals and returned it as
 * `assignmentFeesCents`, with no field saying so. A profit estimate presented
 * as assignment fees. Founder call B-6: REMOVE the proxy. No signed
 * assignment → fees are `null` / source "none" (zero and none are different
 * facts); the funnel and speed-to-close still read closed deals.
 *
 * The route runs against a stubbed db that answers selects in call order, so
 * the proxy can only reach the wire by being computed from the closed-deal rows
 * we seed with netProfit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let queue: unknown[][] = [];
let throwOnAssignments = false;

function chain(rows: unknown[]) {
  const c: any = {
    from: () => c,
    where: () => c,
    groupBy: () => c,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, bad),
  };
  return c;
}

vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      const rows = queue.shift();
      if (rows === undefined) throw new Error("unexpected extra select");
      if (rows === (THROW as unknown)) {
        const c: any = { from: () => c, where: () => Promise.reject(new Error('relation "contract_assignments" does not exist')) };
        return c;
      }
      return chain(rows);
    },
  },
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: vi.fn() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const THROW: unknown[] = [];
void throwOnAssignments;

import { registerWholesalerDashboardRoutes } from "../../server/routes-wholesaler-dashboard";

function handler() {
  let h: any;
  registerWholesalerDashboardRoutes({
    get: (_p: string, ...fns: any[]) => {
      h = fns[fns.length - 1];
    },
  } as any);
  return h;
}

async function call() {
  const res: any = { body: undefined, status: vi.fn(() => res), json: (b: unknown) => ((res.body = b), res) };
  await handler()({ organization: { id: 7 }, organizationId: 7 }, res);
  return res.body as Record<string, any>;
}

const closed = (netProfit: number) => ({
  offerDate: "2026-01-01",
  closingDate: "2026-01-11",
  analysisResults: { netProfit },
  acceptedAmount: 100000,
});
// select order in the route: closedDeals, assignments agg, buyer count,
// buyer engagement, lead count, deal counts by status.
const tail = (closedN: number) => [[{ totalBuyers: 0 }], [], [{ leadsCount: 0 }], [{ status: "closed", count: closedN }]];

beforeEach(() => {
  queue = [];
});

describe("assignment-fee provenance", () => {
  it("signed assignments → source 'assignments', exact cents, count", async () => {
    queue = [[closed(55555)], [{ total: "1500000", cnt: 2 }], ...tail(1)];
    const b = await call();
    expect(b.assignmentFeeSource).toBe("assignments");
    expect(b.signedAssignmentCount).toBe(2);
    expect(b.assignmentFeesCents).toBe(1_500_000);
    expect(b.avgAssignmentFeeCents).toBe(750_000);
  });

  it("no signed rows + closed deals WITH netProfit → null / 'none'; no proxy arithmetic on the wire", async () => {
    queue = [[closed(40000), closed(12345.67)], [{ total: "0", cnt: 0 }], ...tail(2)];
    const b = await call();
    expect(b.assignmentFeeSource).toBe("none");
    expect(b.signedAssignmentCount).toBe(0);
    expect(b.assignmentFeesCents).toBeNull();
    expect(b.avgAssignmentFeeCents).toBeNull();
    const wire = JSON.stringify(b);
    for (const proxied of ["4000000", "5234567", "1234567", "2617284", "2000000"]) {
      expect(wire).not.toContain(proxied);
    }
    // still has data and still reads closed deals for speed + funnel
    expect(b.hasData).toBe(true);
    expect(b.speedToCloseDays).toBe(10);
    expect(b.dealFunnel.find((s: any) => s.stage === "Closed").count).toBe(2);
  });

  it("the contract_assignments query throwing falls to 'none', never to a proxy", async () => {
    queue = [[closed(40000)], THROW, ...tail(1)];
    const b = await call();
    expect(b.assignmentFeeSource).toBe("none");
    expect(b.assignmentFeesCents).toBeNull();
    expect(b.avgAssignmentFeeCents).toBeNull();
    expect(b.signedAssignmentCount).toBe(0);
    expect(JSON.stringify(b)).not.toContain("4000000");
  });
});
