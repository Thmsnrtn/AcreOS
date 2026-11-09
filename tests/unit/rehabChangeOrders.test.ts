/**
 * Change-order arithmetic (fix-and-flip package, Leg 4, §8.2 #10).
 *
 * Only APPROVED orders adjust anything: a proposed order is a request and a
 * rejected one is a record that the request was declined. The stored budget is
 * never an input that changes — `effective = budget + approved`.
 */
import { describe, expect, it } from "vitest";
import {
  approvedAmountByLine,
  approvedScheduleDays,
  effectiveEstimateCents,
  projectChangeOrderTotals,
  type ChangeOrderLike,
} from "../../shared/rehab/changeOrders";

let n = 0;
function order(
  lineItemId: string,
  amountCents: number,
  scheduleImpactDays: number,
  status: ChangeOrderLike["status"],
): ChangeOrderLike {
  n += 1;
  return {
    id: `co-${n}`,
    lineItemId,
    description: `order ${n}`,
    amountCents,
    scheduleImpactDays,
    status,
    decidedBy: status === "proposed" ? null : "u1",
    decidedAt: status === "proposed" ? null : "2026-10-01T00:00:00Z",
    recordedBy: "u1",
    createdAt: "2026-09-30T00:00:00Z",
  };
}

const ORDERS: ChangeOrderLike[] = [
  order("L1", 250_000, 6, "approved"),
  order("L1", 100_000, 2, "approved"),
  order("L1", 900_000, 30, "proposed"),
  order("L2", -50_000, -1, "approved"),
  order("L2", 700_000, 20, "rejected"),
  order("L3", 400_000, 9, "rejected"),
  order("L3", 123_456, 4, "proposed"),
];

describe("approvedAmountByLine", () => {
  it("sums approved orders only, per line", () => {
    const byLine = approvedAmountByLine(ORDERS);
    expect(byLine.get("L1")).toBe(350_000); // 250_000 + 100_000; the 900_000 proposal is excluded
    expect(byLine.get("L2")).toBe(-50_000); // the 700_000 rejection is excluded
  });

  it("gives a line with only proposed/rejected orders no entry at all", () => {
    const byLine = approvedAmountByLine(ORDERS);
    expect(byLine.has("L3")).toBe(false);
    expect([...byLine.keys()].sort()).toEqual(["L1", "L2"]);
  });

  it("is empty when nothing is approved, and for no orders", () => {
    expect(approvedAmountByLine([order("L1", 500, 1, "proposed"), order("L1", 900, 1, "rejected")]).size).toBe(0);
    expect(approvedAmountByLine([]).size).toBe(0);
  });
});

describe("approvedScheduleDays", () => {
  it("sums approved orders only", () => {
    // 6 + 2 + (−1) = 7; proposed 30 / rejected 20 / rejected 9 / proposed 4 contribute nothing.
    expect(approvedScheduleDays(ORDERS)).toBe(7);
  });

  it("is 0 when nothing is approved", () => {
    expect(approvedScheduleDays([order("L1", 500, 40, "proposed"), order("L1", 500, 40, "rejected")])).toBe(0);
    expect(approvedScheduleDays([])).toBe(0);
  });
});

describe("effectiveEstimateCents", () => {
  it("is the stored budget plus the approved amount", () => {
    expect(effectiveEstimateCents(1_500_000, 250_000)).toBe(1_750_000);
    expect(effectiveEstimateCents(1_500_000, -300_000)).toBe(1_200_000);
    expect(effectiveEstimateCents(1_500_000, 0)).toBe(1_500_000);
  });
});

describe("projectChangeOrderTotals", () => {
  const LINES = [
    { id: "L1", budgetCents: 1_000_000 },
    { id: "L2", budgetCents: 500_000 },
    { id: "L3", budgetCents: 250_000 },
  ];

  it("original = Σ budgets, approved = Σ approved amounts, effective = original + approved", () => {
    const t = projectChangeOrderTotals(LINES, ORDERS);
    expect(t.originalEstimateCents).toBe(1_750_000);
    expect(t.approvedChangeOrderCents).toBe(300_000); // 250_000 + 100_000 − 50_000
    expect(t.effectiveEstimateCents).toBe(2_050_000);
  });

  it("counts each status", () => {
    const t = projectChangeOrderTotals(LINES, ORDERS);
    expect(t.approvedCount).toBe(3);
    expect(t.proposedCount).toBe(2);
    expect(t.rejectedCount).toBe(2);
  });

  it("with no orders, effective equals original and every count is 0", () => {
    expect(projectChangeOrderTotals(LINES, [])).toEqual({
      originalEstimateCents: 1_750_000,
      approvedChangeOrderCents: 0,
      effectiveEstimateCents: 1_750_000,
      approvedCount: 0,
      proposedCount: 0,
      rejectedCount: 0,
    });
  });

  it("proposed and rejected orders alone adjust nothing", () => {
    const t = projectChangeOrderTotals(LINES, [order("L1", 999_999, 99, "proposed"), order("L2", 888_888, 88, "rejected")]);
    expect(t.approvedChangeOrderCents).toBe(0);
    expect(t.effectiveEstimateCents).toBe(t.originalEstimateCents);
    expect(t).toMatchObject({ approvedCount: 0, proposedCount: 1, rejectedCount: 1 });
  });
});
