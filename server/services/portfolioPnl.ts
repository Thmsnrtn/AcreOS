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
import { and, count, eq, gte, inArray, lte, sql, sum } from "drizzle-orm";
import { centsFromDecimal } from "@shared/finance/cents";

import { ACTIVE_DEAL_STATUSES, CLOSED_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
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

/**
 * Annualised IRR over DATED cash flows (XIRR), or null (DEFECT-0108).
 *
 * The previous version discounted by array index — every flow one "period"
 * after the one before, with no dates — so a sale that closed a week after
 * its purchase and one that closed after five years produced the same
 * "annualised" number. It also mixed interest receipts into the same undated
 * sequence. Null when there are fewer than two flows, when the flows do not
 * change sign (no investment/return pair), or when the solver does not
 * converge: an IRR the data cannot support is not reported.
 */
function xirr(flows: Array<{ amount: number; at: Date }>): number | null {
  if (flows.length < 2) return null;
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = Math.min(...flows.map((f) => f.at.getTime()));
  const years = flows.map((f) => (f.at.getTime() - t0) / (365 * 86_400_000));
  let rate = 0.1;
  for (let iter = 0; iter < 200; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (let i = 0; i < flows.length; i++) {
      const d = Math.pow(1 + rate, years[i]);
      npv += flows[i].amount / d;
      dnpv -= (years[i] * flows[i].amount) / (d * (1 + rate));
    }
    if (dnpv === 0 || !Number.isFinite(dnpv)) return null;
    const next = rate - npv / dnpv;
    if (!Number.isFinite(next) || next <= -0.9999) return null;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next;
  }
  return null;
}

export async function getPortfolioPnl(
  orgId: number,
  fromDate: Date,
  toDate: Date,
  granularity: "monthly" | "quarterly" = "quarterly"
): Promise<PortfolioPnlReport> {
  // Closed deals. `deals.type` says which side of the trade each one is
  // (DEFECT-0108): an ACQUISITION is money out at its agreed price, a
  // DISPOSITION is money in. This used to read every closed deal as both —
  // `offerAmount` as the purchase and `acceptedAmount` as the sale of the SAME
  // deal — so an acquisition's agreed price was counted as sale proceeds.
  const closedDeals = await db
    .select({
      type: deals.type,
      offerAmount: deals.offerAmount,
      acceptedAmount: deals.acceptedAmount,
      closedAt: deals.closingDate,
      status: deals.status,
    })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, orgId),
        inArray(deals.status, [...CLOSED_DEAL_STATUSES]),
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

  // W3.3: all money accumulates in INTEGER CENTS; the period/report fields
  // convert to dollars exactly once after the loops. The old float `+=`
  // drifted across periods (and the IRR cash-flow series inherited it).
  const cashFlows: Array<{ amount: number; at: Date }> = [];
  let totalAcquisitionCents = 0;
  let totalSaleCents = 0;

  for (const deal of closedDeals) {
    // The date range filters on closingDate, so a row here has one; a null
    // would be skipped rather than dated "today".
    if (!deal.closedAt) continue;
    const date = new Date(deal.closedAt);
    const label = periodLabel(date, granularity);
    const period = ensurePeriod(label);
    // The agreed price is `acceptedAmount`; a closed deal without one falls
    // back to the recorded offer (both are figures on the deal record).
    const priceCents = centsFromDecimal(deal.acceptedAmount ?? deal.offerAmount);
    if (priceCents <= 0) continue;

    if (deal.type === "acquisition") {
      period.acquisitionCost += priceCents;
      period.dealsAcquired++;
      totalAcquisitionCents += priceCents;
      cashFlows.push({ amount: -priceCents / 100, at: date });
    } else if (deal.type === "disposition") {
      period.saleProceeds += priceCents;
      period.dealsSold++;
      totalSaleCents += priceCents;
      cashFlows.push({ amount: priceCents / 100, at: date });
    }
  }

  let totalInterestCents = 0;
  for (const payment of notePayments) {
    if (!payment.paidAt) continue;
    const date = new Date(payment.paidAt);
    const label = periodLabel(date, granularity);
    const period = ensurePeriod(label);

    // Interest is the INTEREST portion. `?? payment.amount` counted a whole
    // payment — principal included — as interest income whenever the split
    // was missing (the column is NOT NULL, so a missing split is a data
    // problem to surface, not to paper over).
    if (payment.interestPortion == null) continue;
    const interestCents = centsFromDecimal(payment.interestPortion);
    period.interestIncome += interestCents;
    totalInterestCents += interestCents;
    cashFlows.push({ amount: interestCents / 100, at: date });
  }

  // Compute period totals — converting the accumulated cents to dollars.
  for (const period of periodMap.values()) {
    const revenueCents = period.saleProceeds + period.interestIncome + period.otherIncome;
    const profitCents = revenueCents - period.acquisitionCost;
    period.grossMargin = revenueCents > 0 ? profitCents / revenueCents : 0;
    period.acquisitionCost = period.acquisitionCost / 100;
    period.saleProceeds = period.saleProceeds / 100;
    period.interestIncome = period.interestIncome / 100;
    period.otherIncome = period.otherIncome / 100;
    period.totalRevenue = revenueCents / 100;
    period.grossProfit = profitCents / 100;
  }
  const totalAcquisition = totalAcquisitionCents / 100;
  const totalSale = totalSaleCents / 100;
  const totalInterest = totalInterestCents / 100;

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
        // `lost` is not a deal status; the terminals are `closed` and
        // `cancelled`. Derived so the open-pipeline breakdown cannot drift
        // from the vocabulary again.
        inArray(deals.status, ACTIVE_DEAL_STATUSES)
      )
    )
    .groupBy(deals.status);

  const netProfit = totalSale + totalInterest - totalAcquisition;
  const cocReturn = totalAcquisition > 0 ? netProfit / totalAcquisition : 0;
  const irr = xirr(cashFlows);

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
