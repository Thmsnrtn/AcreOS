/**
 * DEFECT-0175 — the cash-flow forecast projects what contracts say.
 *
 * From the 2026-09-28 practitioner supplement (fourth cycle), re-verified at
 * HEAD:
 *  - every owned parcel with a market value "earned" 0.8% of value a month
 *    in rent (weighted 0.7) with no lease — a $20,000 vacant parcel, $112;
 *  - a listed parcel "sold" at list price in month 3 (p=0.4), outside the
 *    requested window too;
 *  - a DECLINING payer's collection weight was floored at 0.3, which RAISED
 *    it whenever the base was already below 0.3.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  property: null as null | Record<string, unknown>,
  leases: [] as Array<Record<string, unknown>>,
  note: null as null | Record<string, unknown>,
}));

vi.mock("../../server/db", () => {
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: Parameters<typeof getTableName>[0]) => {
      table = getTableName(t);
      return q;
    };
    q.where = async () =>
      table === "properties" ? [h.property] : table === "rental_leases" ? h.leases : table === "notes" ? [h.note] : [];
    return q;
  };
  return { db: { select } };
});
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: vi.fn().mockReturnValue(null) }));

import { cashFlowForecasterService as svc } from "../../server/services/cashFlowForecaster";

const monthsAhead = (n: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + n, 1).toISOString().slice(0, 10);
};

beforeEach(() => {
  h.leases = [];
  h.property = null;
  h.note = null;
  vi.restoreAllMocks();
});

describe("DEFECT-0175 — property income is a lease, not a guess", () => {
  it("an owned $20,000 vacant parcel with no lease projects NOTHING (was $160/mo × 0.7)", async () => {
    h.property = { id: 3, status: "owned", marketValue: "20000" };
    expect(await svc.projectPropertyIncome(3, 7, 12)).toEqual([]);
  });

  it("a listed parcel is not a month-3 sale (was list price at p=0.4, even past the window)", async () => {
    h.property = { id: 3, status: "listed", listPrice: "45000" };
    expect(await svc.projectPropertyIncome(3, 7, 1)).toEqual([]);
  });

  it("an active lease is scheduled rent, inside its own dates and the window", async () => {
    h.property = { id: 3, status: "owned", marketValue: "20000" };
    h.leases = [{ id: "L1", startDate: monthsAhead(-2), endDate: monthsAhead(2), monthlyRentCents: 120_000 }];
    const p = await svc.projectPropertyIncome(3, 7, 6);
    expect(p).toHaveLength(3); // this month and the next two; the lease ends in month 2
    expect(p.every((x) => x.expectedAmount === 1200 && x.probability === 1 && x.source === "rent")).toBe(true);
  });
});

describe("DEFECT-0175 — a worsening payer never becomes more collectible", () => {
  it("declining with a base below 0.3 stays at or under the base", async () => {
    h.note = { id: 1, monthlyPayment: "300", interestRate: "10", currentBalance: "20000", nextPaymentDate: new Date() };
    vi.spyOn(svc, "analyzePaymentHealth").mockResolvedValue({
      defaultProbability: 0.8,
      paymentPattern: "declining",
    } as Awaited<ReturnType<typeof svc.analyzePaymentHealth>>);
    const p = await svc.projectNoteIncome(1, 7, 6);
    expect(p.length).toBe(6);
    for (const x of p) expect(x.probability).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(p[5].probability).toBeLessThan(p[0].probability);
  });
});
