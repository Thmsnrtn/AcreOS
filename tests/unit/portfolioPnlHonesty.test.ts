/**
 * DEFECT-0108 — the portfolio P&L reads which side of the trade a deal is,
 * dates its IRR, and counts only interest as interest.
 *
 * `getPortfolioPnl` read every closed deal as both a purchase (`offerAmount`)
 * and a sale (`acceptedAmount`), so an ACQUISITION's agreed price was counted
 * as sale proceeds; it discounted an undated cash-flow sequence by array
 * index and called it an annualised IRR; and it counted a whole payment as
 * interest whenever the interest split was absent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => {
  const mk = (op: string) => (...a: unknown[]) => ({ op, a });
  return {
    and: mk("and"), eq: mk("eq"), gte: mk("gte"), lte: mk("lte"), inArray: mk("inArray"),
    count: mk("count"), sum: mk("sum"),
    sql: Object.assign(mk("sql"), { raw: mk("sql") }),
  };
});
const T = vi.hoisted(() => ({
  deals: { __t: "deals", type: "d.type", status: "d.status", offerAmount: "d.offer", acceptedAmount: "d.accepted", closingDate: "d.close", organizationId: "d.org" },
  payments: { __t: "payments", amount: "p.amount", interestAmount: "p.int", principalAmount: "p.prin", paymentDate: "p.date", organizationId: "p.org", status: "p.status" },
  notes: { __t: "notes", currentBalance: "n.bal", monthlyPayment: "n.mp", organizationId: "n.org", status: "n.status" },
  properties: { __t: "properties" },
}));
vi.mock("@shared/schema", () => T);

const D = vi.hoisted(() => ({
  deals: [] as Array<Record<string, unknown>>,
  payments: [] as Array<Record<string, unknown>>,
}));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: () => {
          const rows =
            t.__t === "deals" ? D.deals : t.__t === "payments" ? D.payments : t.__t === "notes" ? [{ outstanding: "0", monthlyIncome: "0", avgRate: 0, noteCount: 0 }] : [];
          const p = Promise.resolve(rows) as Promise<unknown[]> & { groupBy: () => Promise<unknown[]> };
          p.groupBy = async () => []; // pipeline breakdown — not under test
          return p;
        },
      }),
    }),
  },
}));

const { getPortfolioPnl } = await import("../../server/services/portfolioPnl");
const FROM = new Date("2024-01-01T00:00:00Z");
const TO = new Date("2026-12-31T00:00:00Z");

beforeEach(() => {
  D.deals = [];
  D.payments = [];
});

describe("portfolio P&L (DEFECT-0108)", () => {
  it("an ACQUISITION's agreed price is a cost, never sale proceeds", async () => {
    D.deals = [{ type: "acquisition", offerAmount: "8000", acceptedAmount: "10000", closedAt: new Date("2025-03-01T00:00:00Z"), status: "closed" }];
    const r = await getPortfolioPnl(5, FROM, TO);
    expect(r.totals.acquisitionCost).toBe(10_000);
    expect(r.totals.saleProceeds).toBe(0);
  });

  it("a DISPOSITION is sale proceeds, never a cost", async () => {
    D.deals = [{ type: "disposition", offerAmount: null, acceptedAmount: "25000", closedAt: new Date("2025-09-01T00:00:00Z"), status: "closed" }];
    const r = await getPortfolioPnl(5, FROM, TO);
    expect(r.totals.saleProceeds).toBe(25_000);
    expect(r.totals.acquisitionCost).toBe(0);
  });

  it("IRR is annualised over the DATES: doubling money in one year is ~100%, in two years ~41%", async () => {
    D.deals = [
      { type: "acquisition", offerAmount: null, acceptedAmount: "10000", closedAt: new Date("2025-01-01T00:00:00Z"), status: "closed" },
      { type: "disposition", offerAmount: null, acceptedAmount: "20000", closedAt: new Date("2026-01-01T00:00:00Z"), status: "closed" },
    ];
    const oneYear = (await getPortfolioPnl(5, FROM, TO)).totals.irr!;
    expect(oneYear).toBeCloseTo(1.0, 2);

    D.deals[1] = { ...D.deals[1], closedAt: new Date("2027-01-01T00:00:00Z") };
    const twoYears = (await getPortfolioPnl(5, FROM, new Date("2027-12-31T00:00:00Z"))).totals.irr!;
    expect(twoYears).toBeCloseTo(Math.SQRT2 - 1, 2);
  });

  it("no return flow → no IRR (null), not a number", async () => {
    D.deals = [{ type: "acquisition", offerAmount: null, acceptedAmount: "10000", closedAt: new Date("2025-01-01T00:00:00Z"), status: "closed" }];
    expect((await getPortfolioPnl(5, FROM, TO)).totals.irr).toBeNull();
  });

  it("interest income is the interest portion only", async () => {
    D.payments = [
      { amount: "500", interestPortion: "50", principalPortion: "450", paidAt: new Date("2025-05-01T00:00:00Z") },
      { amount: "500", interestPortion: null, principalPortion: null, paidAt: new Date("2025-06-01T00:00:00Z") },
    ];
    const r = await getPortfolioPnl(5, FROM, TO);
    expect(r.totals.interestIncome).toBe(50);
  });
});
