/**
 * Rehab change orders — a priced scope change, decided once (fix-and-flip
 * package, Leg 4, §4.2).
 *
 * A change order is a scope change after work has started: it carries an
 * amount (cents, signed) and a schedule impact (days, signed), and it is
 * priced BEFORE the work it covers starts. It is decided once — proposed →
 * approved or rejected — and the decision records who and when.
 *
 * ONLY APPROVED ORDERS ADJUST ANYTHING. A proposed order is a request, a
 * rejected order is a record that the request was declined; neither moves a
 * budget or a schedule by a cent or a day.
 *
 * THE STORED BUDGET IS NEVER MODIFIED. The original budget column stays
 * byte-identical for the life of the project, because the estimate is what
 * variance is measured against. An approved order adjusts the EFFECTIVE
 * budget instead: `effective = budget + approved amount`, a figure computed
 * here on read and never written back anywhere.
 *
 * No server imports — these functions take plain rows and return plain values,
 * so the same arithmetic can be tested without a database.
 */

/** A change-order row, narrowed to the fields the arithmetic reads. */
export interface ChangeOrderLike {
  id: string;
  lineItemId: string;
  description: string;
  amountCents: number;
  scheduleImpactDays: number;
  status: "proposed" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface ChangeOrderTotals {
  originalEstimateCents: number;
  approvedChangeOrderCents: number;
  effectiveEstimateCents: number;
  approvedCount: number;
  proposedCount: number;
  rejectedCount: number;
}

/** Sum of amountCents per lineItemId over APPROVED orders only. */
export function approvedAmountByLine(
  orders: readonly ChangeOrderLike[],
): Map<string, number> {
  const byLine = new Map<string, number>();
  for (const o of orders) {
    if (o.status !== "approved") continue;
    byLine.set(o.lineItemId, (byLine.get(o.lineItemId) ?? 0) + o.amountCents);
  }
  return byLine;
}

/** Sum of scheduleImpactDays over APPROVED orders only. */
export function approvedScheduleDays(orders: readonly ChangeOrderLike[]): number {
  let days = 0;
  for (const o of orders) {
    if (o.status === "approved") days += o.scheduleImpactDays;
  }
  return days;
}

/** The effective budget: stored budget + approved change-order amount. Computed, never stored. */
export function effectiveEstimateCents(
  budgetCents: number,
  approvedAmountCents: number,
): number {
  return budgetCents + approvedAmountCents;
}

export function projectChangeOrderTotals(
  lines: readonly { id: string; budgetCents: number }[],
  orders: readonly ChangeOrderLike[],
): ChangeOrderTotals {
  let originalEstimateCents = 0;
  for (const l of lines) originalEstimateCents += l.budgetCents;

  let approvedChangeOrderCents = 0;
  let approvedCount = 0;
  let proposedCount = 0;
  let rejectedCount = 0;
  for (const o of orders) {
    if (o.status === "approved") {
      approvedCount += 1;
      approvedChangeOrderCents += o.amountCents;
    } else if (o.status === "proposed") {
      proposedCount += 1;
    } else if (o.status === "rejected") {
      rejectedCount += 1;
    }
  }

  return {
    originalEstimateCents,
    approvedChangeOrderCents,
    effectiveEstimateCents: effectiveEstimateCents(
      originalEstimateCents,
      approvedChangeOrderCents,
    ),
    approvedCount,
    proposedCount,
    rejectedCount,
  };
}
