/**
 * T126 — Cash Flow Forecaster Unit Tests
 *
 * Tests amortization math, payment generation, delinquency detection,
 * yield calculations, and portfolio-level aggregation logic.
 */

import { describe, it, expect } from "vitest";

// ── Pure financial math (mirrored from cashFlowForecaster.ts) ─────────────────

/**
 * Standard amortizing loan payment (PMT formula).
 * P = principal, r = annual rate (%), n = total months
 */
function calcMonthlyPayment(principal: number, annualRate: number, termMonths: number): number {
  if (annualRate === 0) return principal / termMonths;
  const monthlyRate = annualRate / 100 / 12;
  return (
    (principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
    (Math.pow(1 + monthlyRate, termMonths) - 1)
  );
}

/**
 * Build a monthly amortization schedule.
 */
function buildAmortizationSchedule(
  principal: number,
  annualRate: number,
  termMonths: number
): Array<{ month: number; payment: number; interest: number; principalPaid: number; balance: number }> {
  const payment = calcMonthlyPayment(principal, annualRate, termMonths);
  const monthlyRate = annualRate / 100 / 12;
  const schedule = [];
  let balance = principal;

  for (let month = 1; month <= termMonths; month++) {
    const interest = balance * monthlyRate;
    const principalPaid = Math.min(payment - interest, balance);
    balance = Math.max(0, balance - principalPaid);
    schedule.push({ month, payment: parseFloat(payment.toFixed(2)), interest: parseFloat(interest.toFixed(2)), principalPaid: parseFloat(principalPaid.toFixed(2)), balance: parseFloat(balance.toFixed(2)) });
  }

  return schedule;
}

/**
 * Calculate yield (annualised return) on a note.
 */
function calcNoteYield(
  principal: number,
  monthlyPayment: number,
  termMonths: number
): number {
  const totalReceived = monthlyPayment * termMonths;
  const totalInterest = totalReceived - principal;
  return parseFloat(((totalInterest / principal / (termMonths / 12)) * 100).toFixed(2));
}

/**
 * Detect delinquency level from missed payment count.
 */
function classifyDelinquency(missedPayments: number): "current" | "30dpd" | "60dpd" | "90dpd+" {
  if (missedPayments === 0) return "current";
  if (missedPayments === 1) return "30dpd";
  if (missedPayments === 2) return "60dpd";
  return "90dpd+";
}

/**
 * Project portfolio cash flows over N months.
 */
function projectPortfolioCashFlow(
  notes: Array<{ balance: number; monthlyPayment: number; remainingMonths: number }>,
  months: number
): number[] {
  return Array.from({ length: months }, (_, i) => {
    const month = i + 1;
    return notes
      .filter(n => n.remainingMonths >= month)
      .reduce((sum, n) => sum + n.monthlyPayment, 0);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Monthly Payment Calculation", () => {
  it("calculates standard 30-year mortgage payment", () => {
    // $100k at 6% for 30 years ≈ $599.55/mo
    const payment = calcMonthlyPayment(100_000, 6, 360);
    expect(payment).toBeCloseTo(599.55, 0);
  });

  it("calculates zero-interest payment", () => {
    const payment = calcMonthlyPayment(60_000, 0, 60);
    expect(payment).toBeCloseTo(1_000, 2);
  });

  it("calculates short-term balloon note", () => {
    // $50k at 8% for 12 months ≈ $4,349.42
    const payment = calcMonthlyPayment(50_000, 8, 12);
    expect(payment).toBeCloseTo(4_349.42, 0);
  });

  it("produces higher payment for higher interest rate", () => {
    const low = calcMonthlyPayment(100_000, 4, 120);
    const high = calcMonthlyPayment(100_000, 10, 120);
    expect(high).toBeGreaterThan(low);
  });

  it("produces higher payment for shorter term", () => {
    const long = calcMonthlyPayment(100_000, 6, 360);
    const short = calcMonthlyPayment(100_000, 6, 60);
    expect(short).toBeGreaterThan(long);
  });

  it("payment is always positive for positive inputs", () => {
    expect(calcMonthlyPayment(200_000, 5.5, 240)).toBeGreaterThan(0);
    expect(calcMonthlyPayment(1, 1, 1)).toBeGreaterThan(0);
  });
});

describe("Amortization Schedule", () => {
  const schedule = buildAmortizationSchedule(100_000, 6, 360);

  it("generates exactly N months of entries", () => {
    expect(schedule).toHaveLength(360);
  });

  it("first month interest is principal × monthly rate", () => {
    const monthlyRate = 6 / 100 / 12; // 0.5%
    expect(schedule[0].interest).toBeCloseTo(100_000 * monthlyRate, 1);
  });

  it("balance decreases each month", () => {
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].balance).toBeLessThanOrEqual(schedule[i - 1].balance);
    }
  });

  it("final balance is approximately 0", () => {
    expect(schedule[359].balance).toBeCloseTo(0, 0);
  });

  it("principal paid + interest equals payment", () => {
    for (const row of schedule.slice(0, 10)) {
      expect(row.principalPaid + row.interest).toBeCloseTo(row.payment, 1);
    }
  });

  it("early payments are mostly interest", () => {
    const first = schedule[0];
    expect(first.interest).toBeGreaterThan(first.principalPaid);
  });

  it("later payments are mostly principal", () => {
    const last = schedule[358];
    expect(last.principalPaid).toBeGreaterThan(last.interest);
  });
});

describe("Zero-Rate Amortization", () => {
  it("distributes principal equally across months", () => {
    const schedule = buildAmortizationSchedule(12_000, 0, 12);
    for (const row of schedule) {
      expect(row.payment).toBeCloseTo(1_000, 2);
      expect(row.interest).toBe(0);
    }
  });
});

describe("Note Yield Calculation", () => {
  it("returns a positive yield for interest-bearing note", () => {
    const payment = calcMonthlyPayment(50_000, 8, 60);
    const y = calcNoteYield(50_000, payment, 60);
    expect(y).toBeGreaterThan(0);
  });

  it("yield is a positive rate for standard amortizing notes", () => {
    const payment = calcMonthlyPayment(100_000, 8, 120);
    const y = calcNoteYield(100_000, payment, 120);
    // Amortizing note yield ≈ ~4.5% simple annualised (interest paid / principal / years)
    // because amortising reduces outstanding balance each month
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(10);
  });

  it("higher interest rate → higher yield", () => {
    const p1 = calcMonthlyPayment(100_000, 6, 120);
    const p2 = calcMonthlyPayment(100_000, 10, 120);
    const y1 = calcNoteYield(100_000, p1, 120);
    const y2 = calcNoteYield(100_000, p2, 120);
    expect(y2).toBeGreaterThan(y1);
  });
});

describe("Delinquency Classification", () => {
  it("classifies 0 missed payments as current", () => {
    expect(classifyDelinquency(0)).toBe("current");
  });

  it("classifies 1 missed payment as 30dpd", () => {
    expect(classifyDelinquency(1)).toBe("30dpd");
  });

  it("classifies 2 missed payments as 60dpd", () => {
    expect(classifyDelinquency(2)).toBe("60dpd");
  });

  it("classifies 3+ missed payments as 90dpd+", () => {
    expect(classifyDelinquency(3)).toBe("90dpd+");
    expect(classifyDelinquency(6)).toBe("90dpd+");
  });
});

describe("Portfolio Cash Flow Projection", () => {
  const notes = [
    { balance: 50_000, monthlyPayment: 600, remainingMonths: 12 },
    { balance: 30_000, monthlyPayment: 400, remainingMonths: 6 },
    { balance: 20_000, monthlyPayment: 300, remainingMonths: 24 },
  ];

  it("month 1 includes all notes", () => {
    const projection = projectPortfolioCashFlow(notes, 1);
    expect(projection[0]).toBe(1_300); // 600 + 400 + 300
  });

  it("month 7 excludes the 6-month note", () => {
    const projection = projectPortfolioCashFlow(notes, 7);
    // Month 7: 600 (12mo) + 300 (24mo) = 900
    expect(projection[6]).toBe(900);
  });

  it("month 13 excludes the 12-month note", () => {
    const projection = projectPortfolioCashFlow(notes, 13);
    // Month 13: only 300 (24mo)
    expect(projection[12]).toBe(300);
  });

  it("month 25 returns 0 (all notes expired)", () => {
    const projection = projectPortfolioCashFlow(notes, 25);
    expect(projection[24]).toBe(0);
  });

  it("projection length matches requested months", () => {
    const projection = projectPortfolioCashFlow(notes, 24);
    expect(projection).toHaveLength(24);
  });

  it("all values are non-negative", () => {
    const projection = projectPortfolioCashFlow(notes, 24);
    for (const cf of projection) {
      expect(cf).toBeGreaterThanOrEqual(0);
    }
  });
});
