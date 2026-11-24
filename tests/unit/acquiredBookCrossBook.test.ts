/**
 * H-DEF-4 — shared money surfaces (Finance, Today) cover the serviced
 * book only; the acquired book is invisible.
 *
 * Walk evidence (journey-walk-hybrid-2026-11.md, org 126): portfolio-
 * summary read totalNotes 2 (serviced only) while an acquired note held
 * $17,850; delinquency read totalDelinquentNotes 0 while that note stood
 * early_delinquent; Today carried zero note items while it was past due.
 *
 * These tests pin the cure at the pure-helper layer (the established
 * pattern for these surfaces) plus source pins that the routes actually
 * wire the helpers in:
 *  - the acquired book appears in the summary/delinquency figures,
 *    labelled with its book discriminator, never merged unlabelled;
 *  - delinquency is derived LIVE from nextPaymentDate — the walk note's
 *    stored columns said current/0 (H-DEF-3's stale shape) and the cure
 *    must still see it past due;
 *  - a past-due acquired note raises a Today queue item naming the
 *    acquired book; an undeterminable due date raises nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  summarizeAcquiredBook,
  acquiredDelinquency,
  delinquentAcquiredNotes,
  type AcquiredBookNote,
  type AcquiredBookPayment,
} from "../../server/services/finance/acquiredBook";
import { buildAcquiredDelinquencyQueueItems } from "../../server/routes-today";

// The walk date: 2026-11-20. The acquired note's payment advanced its
// next due date to 2026-11-19 — exactly 1 day past due at walk time.
const NOW = new Date("2026-11-20T12:00:00Z");

function walkNote(overrides: Partial<AcquiredBookNote> = {}): AcquiredBookNote {
  return {
    id: "a7e02da0-e186-4382-99f2-f6204216a7c2",
    noteNumber: "HYB-NOTE-001",
    payerName: "HYB Acquired Borrower",
    status: "performing",
    originalPrincipalCents: 1_800_000,
    currentBalanceCents: 1_785_000, // $17,850 after the walk's payment
    paymentAmountCents: 24_266,
    interestRateBps: 800,
    nextPaymentDate: "2026-11-19",
    ...overrides,
  };
}

const walkPayment: AcquiredBookPayment = {
  paymentDate: "2026-11-20",
  principalCents: 15_000,
  interestCents: 9_266,
  lateFeeCents: 0,
};

describe("summarizeAcquiredBook — the acquired book is visible, labelled", () => {
  it("carries the walk note's figures under the acquired book label", () => {
    const s = summarizeAcquiredBook([walkNote()], [walkPayment], NOW);
    expect(s.book).toBe("acquired");
    expect(s.totalNotes).toBe(1);
    expect(s.activeNotes).toBe(1);
    expect(s.totalPortfolioValue).toBe(17850);
    expect(s.totalOriginalPrincipal).toBe(18000);
    expect(s.totalMonthlyPayment).toBe(242.66);
    expect(s.averageInterestRate).toBe(8);
  });

  it("counts the walk note delinquent from its live due date", () => {
    const s = summarizeAcquiredBook([walkNote()], [], NOW);
    expect(s.delinquentCount).toBe(1);
    expect(s.delinquencyRate).toBe(100);
  });

  it("paid-off and sold notes are not active and carry no portfolio value", () => {
    const s = summarizeAcquiredBook(
      [walkNote({ status: "paid_off" }), walkNote({ id: "x", status: "sold" })],
      [],
      NOW,
    );
    expect(s.totalNotes).toBe(2);
    expect(s.activeNotes).toBe(0);
    expect(s.totalPortfolioValue).toBe(0);
    expect(s.delinquentCount).toBe(0);
  });

  it("monthly cash flow nets the walk payment into the walk month", () => {
    const s = summarizeAcquiredBook([walkNote()], [walkPayment], NOW);
    const nov = s.monthlyCashFlow.find((m) => m.month === "2026-11");
    expect(nov?.amount).toBe(242.66);
    const breakdown = s.monthlyBreakdownByType.find((m) => m.month === "2026-11");
    expect(breakdown).toMatchObject({ principal: 150, interest: 92.66, total: 242.66 });
    expect(s.netInflowMtd).toBe(242.66);
  });

  it("an undeterminable due date is neither delinquent nor hidden", () => {
    const s = summarizeAcquiredBook([walkNote({ nextPaymentDate: null })], [], NOW);
    expect(s.delinquentCount).toBe(0);
    expect(s.undeterminableCount).toBe(1);
  });

  it("empty book reads as an honest zero book, still labelled", () => {
    const s = summarizeAcquiredBook([], [], NOW);
    expect(s).toMatchObject({ book: "acquired", totalNotes: 0, totalPortfolioValue: 0, delinquentCount: 0 });
  });
});

describe("acquiredDelinquency — live aging buckets", () => {
  it("the walk note lands in days30 with its balance at risk", () => {
    const d = acquiredDelinquency([walkNote()], [walkPayment], NOW);
    expect(d.book).toBe("acquired");
    expect(d.totalDelinquentNotes).toBe(1);
    expect(d.agingBuckets.days30).toEqual({ count: 1, value: 17850 });
    expect(d.atRiskAmount).toBe(17850);
    expect(d.delinquencyRate).toBe(100);
  });

  it("buckets split on live days: current / 30 / 60 / 90+", () => {
    const rows = [
      walkNote({ id: "a", nextPaymentDate: "2026-11-25" }), // current
      walkNote({ id: "b", nextPaymentDate: "2026-11-19" }), // 1 day
      walkNote({ id: "c", nextPaymentDate: "2026-10-10" }), // 41 days
      walkNote({ id: "d", nextPaymentDate: "2026-08-01" }), // 111 days
    ];
    const d = acquiredDelinquency(rows, [], NOW);
    expect(d.agingBuckets.current.count).toBe(1);
    expect(d.agingBuckets.days30.count).toBe(1);
    expect(d.agingBuckets.days60.count).toBe(1);
    expect(d.agingBuckets.days90Plus.count).toBe(1);
    expect(d.totalDelinquentNotes).toBe(3);
  });

  it("collected totals come from the acquired payment ledger, in dollars", () => {
    const d = acquiredDelinquency([walkNote()], [walkPayment], NOW);
    expect(d.totalPrincipalCollected).toBe(150);
    expect(d.totalInterestCollected).toBe(92.66);
  });
});

describe("Today — a past-due acquired note raises an item", () => {
  it("the walk note raises exactly one item naming the acquired book", () => {
    const items = buildAcquiredDelinquencyQueueItems([walkNote()], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("acquired-note-delinquent-a7e02da0-e186-4382-99f2-f6204216a7c2");
    expect(items[0].title).toContain("HYB-NOTE-001");
    expect(items[0].title).toContain("1 day past due");
    expect(items[0].description).toContain("acquired book");
    expect(items[0].description).toContain("17,850.00");
    expect(items[0].urgency).toBe("money");
  });

  it("current, paid-off and undeterminable notes raise nothing", () => {
    const items = buildAcquiredDelinquencyQueueItems(
      [
        walkNote({ id: "a", nextPaymentDate: "2026-12-19" }),
        walkNote({ id: "b", status: "paid_off", nextPaymentDate: "2026-10-19" }),
        walkNote({ id: "c", nextPaymentDate: null }),
      ],
      NOW,
    );
    expect(items).toHaveLength(0);
  });

  it("worst-first and capped at 3", () => {
    const rows = [1, 5, 40, 90].map((days, i) => {
      const due = new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
      return walkNote({ id: `n${i}`, nextPaymentDate: due.toISOString().slice(0, 10) });
    });
    const items = buildAcquiredDelinquencyQueueItems(rows, NOW);
    expect(items).toHaveLength(3);
    expect(items[0].title).toContain("90 days past due");
    expect(delinquentAcquiredNotes(rows, NOW)[0].daysDelinquent).toBe(90);
  });
});

describe("route wiring — the surfaces actually serve the acquired book", () => {
  const finance = readFileSync(join(__dirname, "../../server/routes-finance.ts"), "utf8");
  const today = readFileSync(join(__dirname, "../../server/routes-today.ts"), "utf8");

  it("portfolio-summary and delinquency attach a labelled byBook breakdown", () => {
    expect(finance).toContain("summarizeAcquiredBook(acquiredRows, acquiredPayments, now)");
    expect(finance).toContain("acquiredDelinquency(acquiredRowsD, acquiredPaymentsD, now)");
    expect(finance).toContain("book: SELLER_FINANCE_BOOK_ID");
    // The acquired read is org-scoped on both endpoints.
    expect(finance).toContain("eq(acquiredNotesTable.organizationId, org.id)");
    expect(finance).toContain("eq(acquiredNotePaymentsTable.organizationId, org.id)");
  });

  it("Today merges the acquired delinquency items into the queue", () => {
    expect(today).toContain("buildAcquiredDelinquencyQueueItems(acquiredRows, now)");
    expect(today).toContain("...acquiredItems,");
    expect(today).toContain("eq(acquiredNotesTable.organizationId, orgId)");
  });
});
