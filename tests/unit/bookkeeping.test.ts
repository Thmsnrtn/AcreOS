/**
 * T270 — Bookkeeping Service Tests
 * Tests deal P&L calculations, ROI, holding period, and tax treatment classification.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type DealExpenseCategory =
  | "purchase"
  | "back_taxes"
  | "title"
  | "recording"
  | "improvement"
  | "marketing"
  | "legal"
  | "other";

interface DealExpense {
  category: DealExpenseCategory;
  amount: number; // cents
  description: string;
}

type TaxTreatment = "ordinary_income" | "capital_gain_short" | "capital_gain_long" | "installment_sale";

interface DealPnL {
  purchasePrice: number;
  sellingPrice: number;
  downPaymentReceived: number;
  acquisitionCosts: number;
  improvementCosts: number;
  marketingCosts: number;
  legalCosts: number;
  totalCosts: number;
  grossProfit: number;
  netProfit: number;
  roi: number;
  cashOnCashReturn: number;
  holdingDays: number;
  dealType: "flip" | "seller_finance" | "wholesale";
  taxTreatment: TaxTreatment;
  expenses: DealExpense[];
}

function calculateDealPnL(
  purchasePrice: number,
  sellingPrice: number,
  expenses: DealExpense[],
  purchaseDate: Date,
  saleDate: Date,
  dealType: "flip" | "seller_finance" | "wholesale",
  downPaymentReceived?: number
): DealPnL {
  const totalCosts = expenses.reduce((sum, e) => sum + e.amount, 0);
  const acquisitionCosts = expenses
    .filter(e => ["purchase", "back_taxes", "title", "recording"].includes(e.category))
    .reduce((sum, e) => sum + e.amount, 0);
  const improvementCosts = expenses
    .filter(e => e.category === "improvement")
    .reduce((sum, e) => sum + e.amount, 0);
  const marketingCosts = expenses
    .filter(e => e.category === "marketing")
    .reduce((sum, e) => sum + e.amount, 0);
  const legalCosts = expenses
    .filter(e => ["legal", "recording"].includes(e.category))
    .reduce((sum, e) => sum + e.amount, 0);

  const totalInvestment = purchasePrice + totalCosts;
  const grossProfit = sellingPrice - purchasePrice;
  const netProfit = sellingPrice - totalInvestment;
  const roi = totalInvestment > 0 ? (netProfit / totalInvestment) * 100 : 0;
  const cashInvested = purchasePrice + totalCosts - (downPaymentReceived || 0);
  const cashOnCashReturn = cashInvested > 0 ? (netProfit / cashInvested) * 100 : 0;
  const holdingDays = Math.floor(
    (saleDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  let taxTreatment: TaxTreatment = "ordinary_income";
  if (dealType === "seller_finance") {
    taxTreatment = "installment_sale";
  } else if (holdingDays > 365) {
    taxTreatment = "capital_gain_long";
  } else if (holdingDays > 0) {
    taxTreatment = "capital_gain_short";
  }

  return {
    purchasePrice,
    sellingPrice,
    downPaymentReceived: downPaymentReceived || 0,
    acquisitionCosts,
    improvementCosts,
    marketingCosts,
    legalCosts,
    totalCosts,
    grossProfit,
    netProfit,
    roi: Math.round(roi * 100) / 100,
    cashOnCashReturn: Math.round(cashOnCashReturn * 100) / 100,
    holdingDays,
    dealType,
    taxTreatment,
    expenses,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const baseExpenses: DealExpense[] = [
  { category: "title", amount: 50000, description: "Title search" },
  { category: "recording", amount: 10000, description: "Recording fee" },
  { category: "marketing", amount: 30000, description: "Online listing" },
];

describe("calculateDealPnL — basic P&L", () => {
  it("computes gross profit as selling - purchase", () => {
    const pnl = calculateDealPnL(
      100_000_00, 150_000_00, [],
      new Date("2024-01-01"), new Date("2024-06-01"), "flip"
    );
    expect(pnl.grossProfit).toBe(50_000_00);
  });

  it("computes net profit as selling - purchase - expenses", () => {
    const pnl = calculateDealPnL(
      100_000_00, 150_000_00, baseExpenses,
      new Date("2024-01-01"), new Date("2024-06-01"), "flip"
    );
    const totalExpenses = 50000 + 10000 + 30000; // 90000
    expect(pnl.netProfit).toBe(150_000_00 - 100_000_00 - totalExpenses);
    expect(pnl.totalCosts).toBe(90000);
  });

  it("computes ROI as netProfit / totalInvestment * 100", () => {
    const pnl = calculateDealPnL(
      100_000, 200_000, [],
      new Date("2024-01-01"), new Date("2024-12-01"), "flip"
    );
    // totalInvestment = 100k, netProfit = 100k, ROI = 100%
    expect(pnl.roi).toBe(100);
  });

  it("returns 0 ROI when no investment", () => {
    const pnl = calculateDealPnL(
      0, 10_000, [],
      new Date("2024-01-01"), new Date("2024-06-01"), "flip"
    );
    expect(pnl.roi).toBe(0);
  });
});

describe("calculateDealPnL — expense categorization", () => {
  it("separates acquisition vs improvement vs marketing costs", () => {
    const expenses: DealExpense[] = [
      { category: "title", amount: 50000, description: "Title" },
      { category: "improvement", amount: 200000, description: "Rehab" },
      { category: "marketing", amount: 30000, description: "Marketing" },
    ];
    const pnl = calculateDealPnL(
      500_000, 800_000, expenses,
      new Date("2024-01-01"), new Date("2024-06-01"), "flip"
    );
    expect(pnl.acquisitionCosts).toBe(50000);
    expect(pnl.improvementCosts).toBe(200000);
    expect(pnl.marketingCosts).toBe(30000);
  });

  it("includes recording in both acquisition and legal costs", () => {
    const expenses: DealExpense[] = [
      { category: "recording", amount: 10000, description: "Recording" },
      { category: "legal", amount: 20000, description: "Attorney" },
    ];
    const pnl = calculateDealPnL(
      100_000, 150_000, expenses,
      new Date("2024-01-01"), new Date("2024-06-01"), "flip"
    );
    expect(pnl.acquisitionCosts).toBe(10000); // recording is in acquisition
    expect(pnl.legalCosts).toBe(30000); // recording + legal both counted
  });
});

describe("calculateDealPnL — holding period", () => {
  it("calculates holding days", () => {
    const pnl = calculateDealPnL(
      100_000, 150_000, [],
      new Date("2024-01-01"), new Date("2024-04-01"), "flip"
    );
    expect(pnl.holdingDays).toBe(91); // Jan has 31, Feb 29 (2024 leap), Mar 31 = 91
  });

  it("long-term flip gets capital_gain_long treatment (>365 days)", () => {
    const pnl = calculateDealPnL(
      100_000, 150_000, [],
      new Date("2022-01-01"), new Date("2023-06-01"), "flip"
    );
    expect(pnl.holdingDays).toBeGreaterThan(365);
    expect(pnl.taxTreatment).toBe("capital_gain_long");
  });

  it("short-term flip gets capital_gain_short treatment", () => {
    const pnl = calculateDealPnL(
      100_000, 150_000, [],
      new Date("2024-01-01"), new Date("2024-06-01"), "flip"
    );
    expect(pnl.taxTreatment).toBe("capital_gain_short");
  });

  it("same-day flip returns ordinary_income", () => {
    const d = new Date("2024-01-01");
    const pnl = calculateDealPnL(100_000, 150_000, [], d, d, "flip");
    expect(pnl.holdingDays).toBe(0);
    expect(pnl.taxTreatment).toBe("ordinary_income");
  });
});

describe("calculateDealPnL — tax treatment", () => {
  it("seller_finance always gets installment_sale treatment", () => {
    const pnl = calculateDealPnL(
      100_000, 150_000, [],
      new Date("2020-01-01"), new Date("2024-01-01"), "seller_finance"
    );
    expect(pnl.taxTreatment).toBe("installment_sale");
  });
});

describe("calculateDealPnL — cash on cash return", () => {
  it("accounts for down payment in cash-on-cash return", () => {
    const pnl = calculateDealPnL(
      100_000, 150_000, [],
      new Date("2024-01-01"), new Date("2024-09-01"), "flip",
      20_000 // $20k down received
    );
    // cashInvested = 100k + 0 - 20k = 80k
    // netProfit = 50k
    // CoC = 50/80 = 62.5%
    expect(pnl.cashOnCashReturn).toBeCloseTo(62.5, 1);
    expect(pnl.downPaymentReceived).toBe(20_000);
  });
});
