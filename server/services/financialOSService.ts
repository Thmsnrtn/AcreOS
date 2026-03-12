// @ts-nocheck
/**
 * Financial Operating System (EPIC 7 — Land's QuickBooks)
 *
 * Land investors have zero good tools for their financial back office.
 * AcreOS should own this entirely.
 *
 * Expert land investing financial wisdom:
 *
 * THE FINANCIAL SYSTEMS EVERY LAND INVESTOR NEEDS:
 *
 * 1. DEAL TRACKING (what you paid, what you sold for, what your net was)
 *    - Purchase price + closing costs = total acquisition cost
 *    - Sale price - closing costs - direct mail costs = gross profit
 *    - Net profit = gross profit - G&A overhead allocation
 *    - ROI = net profit / acquisition cost
 *    Expert insight: Most land investors don't track their true cost per deal.
 *    They forget to include: mailing cost, due diligence, holding costs, closing fees.
 *
 * 2. 1031 EXCHANGE MANAGEMENT
 *    - 45-day identification window from sale closing
 *    - 180-day exchange window from sale closing
 *    - Must be "like-kind" property (land → land, or land → commercial = fine)
 *    - Must use a Qualified Intermediary (cannot touch the funds yourself)
 *    Expert insight: Every land flip over ~$50K should evaluate 1031.
 *    Deferring capital gains = more capital to deploy = faster wealth building.
 *
 * 3. NOTE SERVICING (for seller-financed deals)
 *    - Monthly payment schedule with amortization
 *    - Annual 1098 mortgage interest statements for buyers
 *    - Late payment tracking and notice process
 *    - Payoff calculation on demand
 *    Expert insight: Owner-financed notes are the most passive income
 *    in real estate. Set it up correctly from day one — collect forever.
 *
 * 4. TAX OPTIMIZATION
 *    - Land held < 1 year = ordinary income
 *    - Land held > 1 year = long-term capital gains (lower rate)
 *    - Dealer vs. investor classification matters enormously
 *    - Schedule D vs. Schedule C treatment
 *    Expert insight: Many active land investors are classified as "dealers"
 *    by the IRS — this means ordinary income rates (up to 37%) on ALL gains.
 *    1031 exchanges and note income can help restructure this.
 */

import { db } from "../db";
import { deals, notes, payments, organizations } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { addDays, addMonths, format, differenceInDays } from "date-fns";

// ---------------------------------------------------------------------------
// 1031 Exchange Clock
//
// After a land sale closes, a 1031 exchange gives you 45 days to identify
// replacement property and 180 days to close. Missing these deadlines
// means you owe ALL deferred capital gains taxes immediately.
// ---------------------------------------------------------------------------

export interface Exchange1031 {
  id: string;
  organizationId: number;
  relinquishedDealId: number; // The deal that was sold (triggering the exchange)
  relinquishedClosingDate: Date;
  salePrice: number;
  adjustedBasis: number; // Cost basis in the sold property
  capitalGainDeferred: number; // Estimated gain being deferred
  qualifiedIntermediaryName?: string;
  qualifiedIntermediaryContact?: string;

  // Key dates
  identificationDeadline: Date; // Day 45 from closing
  exchangeDeadline: Date; // Day 180 from closing
  daysToIdentification: number; // Days remaining
  daysToExchange: number; // Days remaining

  // Identified properties (up to 3 properties, or 200% rule, or 95% rule)
  identifiedProperties: Array<{
    address: string;
    county: string;
    state: string;
    acquisitionPriceTarget: number;
    isUnderContract: boolean;
    isAcquired: boolean;
  }>;

  status:
    | "active_identification"
    | "identified"
    | "exchange_in_progress"
    | "completed"
    | "failed"
    | "cancelled";

  alertLevel: "green" | "yellow" | "orange" | "red"; // Based on days remaining
}

export function computeExchange1031Status(exchange: {
  relinquishedClosingDate: Date;
  identifiedProperties?: Exchange1031["identifiedProperties"];
}): {
  identificationDeadline: Date;
  exchangeDeadline: Date;
  daysToIdentification: number;
  daysToExchange: number;
  alertLevel: Exchange1031["alertLevel"];
  statusMessage: string;
  urgencyActions: string[];
} {
  const closingDate = new Date(exchange.relinquishedClosingDate);
  const identificationDeadline = addDays(closingDate, 45);
  const exchangeDeadline = addDays(closingDate, 180);
  const now = new Date();

  const daysToIdentification = Math.max(0, differenceInDays(identificationDeadline, now));
  const daysToExchange = Math.max(0, differenceInDays(exchangeDeadline, now));

  const hasIdentified = (exchange.identifiedProperties?.length || 0) > 0;
  const urgencyActions: string[] = [];

  let alertLevel: Exchange1031["alertLevel"] = "green";
  let statusMessage = "";

  if (daysToIdentification > 0 && !hasIdentified) {
    // In identification window
    if (daysToIdentification <= 3) {
      alertLevel = "red";
      statusMessage = `🚨 CRITICAL: ${daysToIdentification} day(s) left to identify replacement property!`;
      urgencyActions.push("IMMEDIATELY identify at least 1 replacement property in writing");
      urgencyActions.push("Contact your Qualified Intermediary today");
      urgencyActions.push("Submit written identification to QI by midnight on Day 45");
    } else if (daysToIdentification <= 10) {
      alertLevel = "red";
      statusMessage = `⚡ URGENT: ${daysToIdentification} days left to identify — act now!`;
      urgencyActions.push("Search Deal Hunter for replacement properties in your target counties");
      urgencyActions.push("You can identify up to 3 properties (no purchase obligation until Day 180)");
    } else if (daysToIdentification <= 20) {
      alertLevel = "orange";
      statusMessage = `⚠️ ${daysToIdentification} days to identify replacement property`;
      urgencyActions.push("Begin seriously evaluating replacement properties");
      urgencyActions.push("Tip: You can identify 3 properties and only purchase one — use this flexibility");
    } else {
      alertLevel = "yellow";
      statusMessage = `${daysToIdentification} days remain in identification window`;
      urgencyActions.push("Start evaluating replacement property options using Deal Hunter");
    }
  } else if (hasIdentified && daysToExchange > 0) {
    // In exchange window, property identified
    if (daysToExchange <= 10) {
      alertLevel = "red";
      statusMessage = `🚨 ${daysToExchange} days to CLOSE replacement property!`;
      urgencyActions.push("Confirm closing date with title company — must close by Day 180");
      urgencyActions.push("Wire purchase funds through your Qualified Intermediary ONLY");
    } else if (daysToExchange <= 30) {
      alertLevel = "orange";
      statusMessage = `⚠️ ${daysToExchange} days to close replacement property`;
      urgencyActions.push("Confirm closing is scheduled and all contingencies are cleared");
    } else {
      alertLevel = "green";
      statusMessage = `✅ Property identified. ${daysToExchange} days to close`;
    }
  } else if (daysToIdentification === 0 && !hasIdentified) {
    alertLevel = "red";
    statusMessage = "❌ Identification window closed without identifying property — capital gains now due";
  } else if (daysToExchange === 0 && hasIdentified) {
    const allAcquired = exchange.identifiedProperties?.every((p) => p.isAcquired) || false;
    if (allAcquired) {
      alertLevel = "green";
      statusMessage = "✅ 1031 Exchange completed successfully";
    } else {
      alertLevel = "red";
      statusMessage = "❌ Exchange deadline passed — unacquired properties trigger capital gains";
    }
  }

  return {
    identificationDeadline,
    exchangeDeadline,
    daysToIdentification,
    daysToExchange,
    alertLevel,
    statusMessage,
    urgencyActions,
  };
}

// ---------------------------------------------------------------------------
// Note Amortization & Servicing
//
// Expert note structure for seller-financed land:
// Down: 10% | Rate: 9.9% | Term: 60 months | No balloon
// "Simple interest, monthly payments, one late fee (5% or $50, whichever is greater)"
// ---------------------------------------------------------------------------

export interface NoteAmortizationSchedule {
  paymentNumber: number;
  dueDate: Date;
  principalPayment: number;
  interestPayment: number;
  totalPayment: number;
  remainingBalance: number;
}

export function generateAmortizationSchedule(params: {
  principal: number;
  annualInterestRate: number; // e.g., 0.099 for 9.9%
  termMonths: number;
  firstPaymentDate: Date;
}): NoteAmortizationSchedule[] {
  const { principal, annualInterestRate, termMonths, firstPaymentDate } = params;
  const monthlyRate = annualInterestRate / 12;

  // Monthly payment: P * r * (1+r)^n / ((1+r)^n - 1)
  const monthlyPayment =
    (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
    (Math.pow(1 + monthlyRate, termMonths) - 1);

  const schedule: NoteAmortizationSchedule[] = [];
  let balance = principal;

  for (let i = 1; i <= termMonths; i++) {
    const interestPayment = balance * monthlyRate;
    const principalPayment = monthlyPayment - interestPayment;
    balance = Math.max(0, balance - principalPayment);

    schedule.push({
      paymentNumber: i,
      dueDate: addMonths(firstPaymentDate, i - 1),
      principalPayment: Math.round(principalPayment * 100) / 100,
      interestPayment: Math.round(interestPayment * 100) / 100,
      totalPayment: Math.round(monthlyPayment * 100) / 100,
      remainingBalance: Math.round(balance * 100) / 100,
    });
  }

  return schedule;
}

export function calculateNotePayoff(params: {
  originalPrincipal: number;
  annualInterestRate: number;
  termMonths: number;
  firstPaymentDate: Date;
  payoffDate: Date;
  paymentsReceived: number;
}): {
  principalBalance: number;
  accruedInterest: number;
  totalPayoff: number;
  payoffDateStr: string;
} {
  const schedule = generateAmortizationSchedule({
    principal: params.originalPrincipal,
    annualInterestRate: params.annualInterestRate,
    termMonths: params.termMonths,
    firstPaymentDate: params.firstPaymentDate,
  });

  const lastPayment = schedule[params.paymentsReceived - 1];
  const principalBalance = lastPayment?.remainingBalance || params.originalPrincipal;

  // Accrued interest from last payment date to payoff date
  const daysSinceLastPayment = differenceInDays(
    params.payoffDate,
    lastPayment?.dueDate || params.firstPaymentDate
  );
  const dailyRate = params.annualInterestRate / 365;
  const accruedInterest = principalBalance * dailyRate * Math.max(0, daysSinceLastPayment);

  return {
    principalBalance: Math.round(principalBalance * 100) / 100,
    accruedInterest: Math.round(accruedInterest * 100) / 100,
    totalPayoff: Math.round((principalBalance + accruedInterest) * 100) / 100,
    payoffDateStr: format(params.payoffDate, "MMMM d, yyyy"),
  };
}

// ---------------------------------------------------------------------------
// Deal P&L Calculator
//
// Expert-validated formula for land deal profitability:
// True profit accounts for ALL costs, not just purchase vs. sale price
// ---------------------------------------------------------------------------

export interface DealPnLInput {
  // Acquisition costs
  purchasePrice: number;
  closingCostsAtPurchase: number; // Title insurance, recording fees
  dueDiligenceCosts: number; // Skip trace, title search, survey
  mailingCosts: number; // Letters sent to find this deal
  travelCosts: number; // Site visits

  // Holding costs
  holdingMonths: number;
  annualTaxes: number; // Property taxes during hold
  insuranceCost: number; // If any
  lienPayoffs: number; // Any liens cleared at acquisition

  // Sale/financing costs
  salePrice: number;
  closingCostsAtSale: number;
  agentCommission: number; // If sold through agent
  marketingCosts: number; // Signs, ads for resale

  // Financing (if any debt used)
  loanAmount: number;
  interestPaid: number;

  // For owner-finance: projected future income
  isOwnerFinanced: boolean;
  downPaymentReceived?: number;
  monthlyPayment?: number;
  termMonths?: number;
  annualInterestRate?: number;
}

export function calculateDealPnL(input: DealPnLInput): {
  totalAcquisitionCost: number;
  totalHoldingCost: number;
  totalDispositionCost: number;
  netSaleProceeds: number;
  grossProfit: number;
  netProfit: number;
  roi: number; // %
  annualizedRoi: number; // %
  cashOnCash: number; // % for financed deals
  holdingMonths: number;
  profitPerMonth: number;

  // For owner-finance
  ownerFinanceProjection?: {
    downPayment: number;
    totalMonthlyPayments: number;
    totalCollected: number;
    totalInterestEarned: number;
    totalProfitProjected: number;
    projectedRoi: number;
  };

  breakdown: Array<{ category: string; amount: number; type: "cost" | "income" }>;
} {
  const totalAcquisitionCost =
    input.purchasePrice +
    input.closingCostsAtPurchase +
    input.dueDiligenceCosts +
    input.mailingCosts +
    input.travelCosts +
    input.lienPayoffs;

  const holdingTaxes = (input.annualTaxes / 12) * input.holdingMonths;
  const totalHoldingCost = holdingTaxes + input.insuranceCost + input.interestPaid;

  const totalDispositionCost =
    input.closingCostsAtSale + input.agentCommission + input.marketingCosts;

  const netSaleProceeds = input.salePrice - totalDispositionCost;
  const totalCosts = totalAcquisitionCost + totalHoldingCost;
  const grossProfit = input.salePrice - totalAcquisitionCost;
  const netProfit = netSaleProceeds - totalAcquisitionCost - totalHoldingCost;

  const cashInvested =
    totalAcquisitionCost - input.loanAmount + totalHoldingCost;
  const roi = cashInvested > 0 ? (netProfit / cashInvested) * 100 : 0;
  const annualizedRoi =
    input.holdingMonths > 0 ? roi / (input.holdingMonths / 12) : roi;
  const cashOnCash =
    cashInvested > 0 ? (netProfit / cashInvested) * 100 : 0;
  const profitPerMonth =
    input.holdingMonths > 0 ? netProfit / input.holdingMonths : 0;

  // Owner finance projection
  let ownerFinanceProjection: ReturnType<typeof calculateDealPnL>["ownerFinanceProjection"];
  if (
    input.isOwnerFinanced &&
    input.monthlyPayment &&
    input.termMonths &&
    input.downPaymentReceived !== undefined
  ) {
    const totalMonthlyPayments = input.monthlyPayment * input.termMonths;
    const totalCollected = input.downPaymentReceived + totalMonthlyPayments;
    const totalInterestEarned =
      totalCollected - (input.salePrice - input.downPaymentReceived);
    const totalProfitProjected = totalCollected - totalAcquisitionCost - totalHoldingCost;
    const projectedRoi =
      cashInvested > 0 ? (totalProfitProjected / cashInvested) * 100 : 0;

    ownerFinanceProjection = {
      downPayment: input.downPaymentReceived,
      totalMonthlyPayments,
      totalCollected,
      totalInterestEarned,
      totalProfitProjected,
      projectedRoi,
    };
  }

  const breakdown: ReturnType<typeof calculateDealPnL>["breakdown"] = [
    { category: "Purchase Price", amount: -input.purchasePrice, type: "cost" },
    { category: "Closing Costs (Purchase)", amount: -input.closingCostsAtPurchase, type: "cost" },
    { category: "Due Diligence", amount: -input.dueDiligenceCosts, type: "cost" },
    { category: "Direct Mail / Marketing", amount: -input.mailingCosts, type: "cost" },
    { category: "Property Taxes (Hold)", amount: -holdingTaxes, type: "cost" },
    { category: "Interest Paid", amount: -input.interestPaid, type: "cost" },
    { category: "Sale Price", amount: input.salePrice, type: "income" },
    { category: "Agent Commission", amount: -input.agentCommission, type: "cost" },
    { category: "Closing Costs (Sale)", amount: -input.closingCostsAtSale, type: "cost" },
  ].filter((item) => item.amount !== 0);

  return {
    totalAcquisitionCost,
    totalHoldingCost,
    totalDispositionCost,
    netSaleProceeds,
    grossProfit,
    netProfit,
    roi,
    annualizedRoi,
    cashOnCash,
    holdingMonths: input.holdingMonths,
    profitPerMonth,
    ownerFinanceProjection,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Schedule E / Schedule D Tax Report Generator
// Helps land investors prepare for tax season
// ---------------------------------------------------------------------------

export interface TaxableTransaction {
  dealId: number;
  propertyDescription: string;
  county: string;
  state: string;
  acquiredDate: string;
  soldDate: string;
  purchasePrice: number;
  salePrice: number;
  closingCostsTotal: number;
  improvementsAdded: number;
  adjustedBasis: number; // purchasePrice + closingCosts + improvements
  grossSaleProceeds: number; // salePrice - selling costs
  gainOrLoss: number; // grossSaleProceeds - adjustedBasis
  holdingPeriodMonths: number;
  isLongTerm: boolean; // > 12 months
  taxTreatment: "schedule_d_long" | "schedule_d_short" | "schedule_c_dealer";
}

export async function generateTaxReport(
  organizationId: number,
  taxYear: number
): Promise<{
  shortTermGains: number;
  longTermGains: number;
  dealerIncome: number; // If classified as dealer
  totalTaxableGain: number;
  transactions: TaxableTransaction[];
  summaryNarrative: string;
  recommendedTaxActions: string[];
}> {
  const yearStart = new Date(taxYear, 0, 1);
  const yearEnd = new Date(taxYear, 11, 31);

  const closedDeals = await db
    .select()
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, organizationId),
        eq(deals.status, "closed"),
        gte(deals.closedDate as any, yearStart.toISOString().split("T")[0])
      )
    );

  const filteredDeals = closedDeals.filter((d) => {
    const closedDate = new Date(d.closedDate || "");
    return closedDate <= yearEnd;
  });

  let shortTermGains = 0;
  let longTermGains = 0;
  const transactions: TaxableTransaction[] = [];

  for (const deal of filteredDeals) {
    const acquired = new Date(deal.contractDate || deal.createdAt || yearStart);
    const sold = new Date(deal.closedDate || yearEnd);
    const holdingMonths = Math.max(
      0,
      Math.floor((sold.getTime() - acquired.getTime()) / (30 * 24 * 60 * 60 * 1000))
    );
    const isLongTerm = holdingMonths >= 12;

    const purchasePrice = parseFloat(deal.purchasePrice || "0");
    const salePrice = parseFloat(deal.listPrice || "0");
    const adjustedBasis = purchasePrice * 1.03; // Rough: add ~3% for closing costs
    const grossSaleProceeds = salePrice * 0.96; // Rough: subtract ~4% for selling costs
    const gainOrLoss = grossSaleProceeds - adjustedBasis;

    if (isLongTerm) {
      longTermGains += gainOrLoss;
    } else {
      shortTermGains += gainOrLoss;
    }

    transactions.push({
      dealId: deal.id,
      propertyDescription: `Land - ${deal.title || "Vacant Land"}`,
      county: (deal as any).county || "",
      state: (deal as any).state || "",
      acquiredDate: format(acquired, "MM/dd/yyyy"),
      soldDate: format(sold, "MM/dd/yyyy"),
      purchasePrice,
      salePrice,
      closingCostsTotal: purchasePrice * 0.03,
      improvementsAdded: 0,
      adjustedBasis,
      grossSaleProceeds,
      gainOrLoss,
      holdingPeriodMonths: holdingMonths,
      isLongTerm,
      taxTreatment: isLongTerm ? "schedule_d_long" : "schedule_d_short",
    });
  }

  const totalTaxableGain = shortTermGains + longTermGains;

  const recommendedTaxActions: string[] = [];
  if (shortTermGains > 10000) {
    recommendedTaxActions.push("Consider holding future acquisitions 12+ months before selling to achieve long-term capital gains rates");
  }
  if (totalTaxableGain > 50000) {
    recommendedTaxActions.push("Evaluate 1031 exchange for current open transactions to defer capital gains");
    recommendedTaxActions.push("Consult a CPA who specializes in real estate to review dealer vs. investor classification");
  }
  if (filteredDeals.length > 10) {
    recommendedTaxActions.push("High transaction volume may trigger IRS 'dealer' classification — discuss with your CPA immediately");
  }

  const summaryNarrative = `
Tax Year ${taxYear} Land Investing Summary for Organization ${organizationId}:
  - Total closed transactions: ${transactions.length}
  - Short-term capital gains (held < 12 mo): $${shortTermGains.toLocaleString()}
  - Long-term capital gains (held 12+ mo): $${longTermGains.toLocaleString()}
  - Total net gain/loss: $${totalTaxableGain.toLocaleString()}

IMPORTANT: This report is for informational purposes only.
Consult a licensed CPA or tax professional for official tax advice.
Land investors with high transaction volume may be classified as "dealers"
by the IRS, which changes the tax treatment significantly.
  `.trim();

  return {
    shortTermGains,
    longTermGains,
    dealerIncome: 0,
    totalTaxableGain,
    transactions,
    summaryNarrative,
    recommendedTaxActions,
  };
}

export default {
  computeExchange1031Status,
  generateAmortizationSchedule,
  calculateNotePayoff,
  calculateDealPnL,
  generateTaxReport,
};
