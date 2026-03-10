/**
 * T46 — Portfolio P&L Dashboard Service
 *
 * The CFO view: unified profit & loss across the entire land investing business.
 *
 * Aggregates:
 *   - Total acquisition costs (closed deals)
 *   - Total sales proceeds (wholesale exits)
 *   - Total interest income (seller-financed notes)
 *   - Net profit by year and month
 *   - Cash-on-cash return and annualized IRR
 *   - Pipeline value at each stage
 *
 * Uses deals, notesReceivable, payments, and properties tables.
 */

import { db } from "../db";
import { deals, notes, payments, properties } from "@shared/schema";
import { eq, and, gte, lte, sql, sum, count } from "drizzle-orm";

export interface PnlPeriod {
  label: string; // "2025-Q3" or "2025-09"
  acquisitionCost: number;
  saleProceeds: number;
  interestIncome: number;
  otherIncome: number;
  totalRevenue: number;
  grossProfit: number;
  grossMargin: number; // 0–1
  dealsAcquired: number;
  dealsSold: number;
}

export interface PortfolioPnlReport {
  orgId: number;
  periods: PnlPeriod[];
  totals: {
    acquisitionCost: number;
    saleProceeds: number;
    interestIncome: number;
    totalRevenue: number;
    netProfit: number;
    cocReturn: number; // (netProfit / acquisitionCost)
    irr: number | null; // annualized IRR estimate
  };
  pipeline: {
    stage: string;
    count: number;
    totalValue: number;
  }[];
  notesReceivable: {
    outstanding: number;
    monthlyIncome: number;
    avgRate: number;
    count: number;
  };
  generatedAt: string;
}

function periodLabel(date: Date, granularity: "monthly" | "quarterly"): string {
  if (granularity === "quarterly") {
    const q = Math.floor(date.getMonth() / 3) + 1;
    return `${date.getFullYear()}-Q${q}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Simple Newton-Raphson IRR approximation
function calculateIrr(cashFlows: number[]): number | null {
  if (cashFlows.length < 2) return null;
  let rate = 0.1;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + rate, t);
      dnpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
    }
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < 1e-6) return newRate;
    rate = newRate;
  }
  return null;
}

export async function getPortfolioPnl(
  orgId: number,
  fromDate: Date,
  toDate: Date,
  granularity: "monthly" | "quarterly" = "quarterly"
): Promise<PortfolioPnlReport> {
  // Closed deals (acquisitions)
  const closedDeals = await db
    .select({
      purchasePrice: deals.offerAmount,
      salePrice: deals.acceptedAmount,
      closedAt: deals.closingDate,
      status: deals.status,
    })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, orgId),
        sql`${deals.status} in ('closed', 'closing')`,
        gte(deals.closingDate, fromDate),
        lte(deals.closingDate, toDate)
      )
    );

  // Interest income from note payments
  const notePayments = await db
    .select({
      amount: payments.amount,
      interestPortion: payments.interestAmount,
      principalPortion: payments.principalAmount,
      paidAt: payments.paymentDate,
    })
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, orgId),
        eq(payments.status, "completed"),
        gte(payments.paymentDate, fromDate),
        lte(payments.paymentDate, toDate)
      )
    );

  // Group by period
  const periodMap = new Map<string, PnlPeriod>();

  const ensurePeriod = (label: string): PnlPeriod => {
    if (!periodMap.has(label)) {
      periodMap.set(label, {
        label,
        acquisitionCost: 0,
        saleProceeds: 0,
        interestIncome: 0,
        otherIncome: 0,
        totalRevenue: 0,
        grossProfit: 0,
        grossMargin: 0,
        dealsAcquired: 0,
        dealsSold: 0,
      });
    }
    return periodMap.get(label)!;
  };

  const cashFlows: number[] = [];
  let totalAcquisition = 0;
  let totalSale = 0;

  for (const deal of closedDeals) {
    const date = deal.closedAt ? new Date(deal.closedAt) : new Date();
    const label = periodLabel(date, granularity);
    const period = ensurePeriod(label);

    const cost = Number(deal.purchasePrice ?? 0);
    const sale = Number(deal.salePrice ?? 0);
    period.acquisitionCost += cost;
    period.dealsAcquired++;
    totalAcquisition += cost;

    if (sale > 0) {
      period.saleProceeds += sale;
      period.dealsSold++;
      totalSale += sale;
    }

    cashFlows.push(-cost); // outflow
    if (sale > 0) cashFlows.push(sale); // inflow
  }

  let totalInterest = 0;
  for (const payment of notePayments) {
    const date = payment.paidAt ? new Date(payment.paidAt) : new Date();
    const label = periodLabel(date, granularity);
    const period = ensurePeriod(label);

    const interest = Number(payment.interestPortion ?? payment.amount ?? 0);
    period.interestIncome += interest;
    totalInterest += interest;
    cashFlows.push(interest);
  }

  // Compute period totals
  for (const period of periodMap.values()) {
    period.totalRevenue = period.saleProceeds + period.interestIncome + period.otherIncome;
    period.grossProfit = period.totalRevenue - period.acquisitionCost;
    period.grossMargin = period.totalRevenue > 0 ? period.grossProfit / period.totalRevenue : 0;
  }

  // Notes receivable summary
  const [noteSummary] = await db
    .select({
      outstanding: sum(notes.currentBalance),
      monthlyIncome: sum(notes.monthlyPayment),
      avgRate: sql<number>`avg(interest_rate)`,
      noteCount: count(),
    })
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));

  // Pipeline by stage
  const pipelineRows = await db
    .select({
      stage: deals.status,
      dealCount: count(),
      totalValue: sum(deals.offerAmount),
    })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, orgId),
        sql`${deals.status} not in ('closed', 'lost', 'cancelled')`
      )
    )
    .groupBy(deals.status);

  const netProfit = totalSale + totalInterest - totalAcquisition;
  const cocReturn = totalAcquisition > 0 ? netProfit / totalAcquisition : 0;
  const irr = cashFlows.length >= 2 ? calculateIrr(cashFlows) : null;

  return {
    orgId,
    periods: [...periodMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    totals: {
      acquisitionCost: totalAcquisition,
      saleProceeds: totalSale,
      interestIncome: totalInterest,
      totalRevenue: totalSale + totalInterest,
      netProfit,
      cocReturn,
      irr,
    },
    pipeline: pipelineRows.map(r => ({
      stage: r.stage ?? "unknown",
      count: Number(r.dealCount),
      totalValue: Number(r.totalValue ?? 0),
    })),
    notesReceivable: {
      outstanding: Number(noteSummary?.outstanding ?? 0),
      monthlyIncome: Number(noteSummary?.monthlyIncome ?? 0),
      avgRate: Number(noteSummary?.avgRate ?? 0),
      count: Number(noteSummary?.noteCount ?? 0),
    },
    generatedAt: new Date().toISOString(),
  };
}
