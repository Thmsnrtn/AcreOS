/**
 * Quality directive 2026-09-29 (money/demo truth) — the finance summary counts
 * what the customer earned, not the demonstration book, and names a fee as a
 * fee.
 *
 *  - "Try with sample data" seeds notes, payments and CLOSED deals; the
 *    portfolio summary counted them, so a demo workspace showed collected
 *    fees and a note portfolio no customer earned.
 *  - "Collected MTD" was the sum of closed deals' ACCEPTED AMOUNT — the
 *    contract price. A $60,000 contract read as a $60,000 assignment fee.
 *  - Unsold properties' LIST price counted as sale proceeds in the margin.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { contractAssignments } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const W = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts: unknown }>,
  deals: [] as unknown[],
  properties: [] as unknown[],
  assignments: [] as unknown[],
  lastWhere: null as unknown,
}));

vi.mock("../../server/storage/wholeBookReads", () => ({
  readAllNotes: async (_o: number, opts?: unknown) => (W.calls.push({ fn: "notes", opts }), []),
  readAllPayments: async (_o: number, opts?: unknown) => (W.calls.push({ fn: "payments", opts }), []),
  readAllDeals: async (_o: number, opts?: unknown) => (W.calls.push({ fn: "deals", opts }), W.deals),
  readAllProperties: async (_o: number, opts?: unknown) => (W.calls.push({ fn: "properties", opts }), W.properties),
}));
vi.mock("../../server/storage", () => ({
  storage: {},
  calculateMonthlyPayment: () => 0,
  db: {
    select: () => ({
      from: (t: unknown) => ({
        where: async () => (t === contractAssignments ? W.assignments : [{ c: 2 }]),
      }),
    }),
  },
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function summaryHandler(): Promise<Handler> {
  const { registerFinanceRoutes } = await import("../../server/routes-finance");
  const routes: Array<{ path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ path, args });
  }
  registerFinanceRoutes(app as never);
  const r = routes.find((x) => x.path === "/api/finance/portfolio-summary");
  if (!r) throw new Error("portfolio-summary not registered");
  return r.args[r.args.length - 1] as Handler;
}
async function run() {
  const res: { body?: Record<string, any>; statusCode: number; status: (c: number) => unknown; json: (b: any) => unknown } = {
    statusCode: 200,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  await (await summaryHandler())({ organization: { id: 5 }, user: { id: "u" } }, res);
  return res;
}

beforeEach(() => {
  W.calls = [];
  W.deals = [];
  W.properties = [];
  W.assignments = [];
});

describe("the summary reads the real book", () => {
  it("every whole-book read it makes asks for the real book only, and it says what it left out", async () => {
    const r = await run();
    expect(W.calls.map((c) => c.fn).sort()).toEqual(["deals", "notes", "payments", "properties"]);
    for (const c of W.calls) expect(c.opts, c.fn).toEqual({ realOnly: true });
    expect(r.body?.sampleExcluded).toEqual({ notes: 2, deals: 2, properties: 2 });
  });

});

describe("a fee is a fee", () => {
  it("a closed $60,000 deal with a $5,000 recorded assignment fee is $5,000 of fees — not $60,000", async () => {
    W.deals = [{ id: 1, status: "closed", acceptedAmount: "60000", closingDate: new Date(), updatedAt: new Date() }];
    W.assignments = [{ dealId: 1, feeCents: 500_000, status: "signed" }];
    const r = await run();
    expect(r.body?.assignmentFees).toMatchObject({ mtdClosedFees: 5000, closedCount: 1, avgFeePerClose: 5000 });
    expect(r.body?.assignmentFees).not.toHaveProperty("mtdCollected");
  });

  it("a closed deal with no recorded assignment contributes no fee", async () => {
    W.deals = [{ id: 1, status: "closed", acceptedAmount: "60000", closingDate: new Date(), updatedAt: new Date() }];
    const r = await run();
    expect(r.body?.assignmentFees.mtdClosedFees).toBe(0);
  });
});

describe("an asking price is not a sale", () => {
  it("an unsold property's list price is neither margin nor realized net — it is flagged projected", async () => {
    W.properties = [{ id: 3, county: "Llano", state: "TX", purchasePrice: "10000", listPrice: "30000", soldPrice: null, status: "listed" }];
    const r = await run();
    expect(r.body?.projects.grossMarginPct).toBe(0);
    expect(r.body?.projects.netMtd).toBe(0);
    expect(r.body?.projects.top[0]).toMatchObject({ id: 3, net: 20000, projected: true });
  });
});

// Last: it swaps the whole-book mock for the real module.
describe("the predicate is in the SQL, not only the option", () => {
  it("realOnly adds the sample-lineage predicate to the query itself", async () => {
    vi.resetModules();
    vi.doUnmock("../../server/storage/wholeBookReads");
    let where: unknown = null;
    vi.doMock("../../server/db", () => ({
      db: {
        select: () => {
          const q: Record<string, unknown> = {};
          q.from = () => q;
          q.where = (w: unknown) => ((where = w), q);
          q.orderBy = () => q;
          q.limit = async () => [];
          return q;
        },
      },
    }));
    const wb = await import("../../server/storage/wholeBookReads");
    const render = () => {
      const q = new PgDialect().sqlToQuery(where as never);
      return { sql: q.sql, params: q.params };
    };
    for (const read of [wb.readAllNotes, wb.readAllDeals, wb.readAllPayments, wb.readAllProperties]) {
      await read(5, { realOnly: true });
      const withSample = render();
      expect(withSample.params).toContain("SAMPLE-%");
      await read(5);
      expect(render().params).not.toContain("SAMPLE-%");
    }
    vi.doUnmock("../../server/db");
  });
});
