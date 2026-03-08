/**
 * Bookkeeping & Tax Automation Service
 *
 * Tracks deal-level P&L and generates tax prep data:
 * - Per-deal profit/loss calculation (acquisition + costs + selling price)
 * - Interest income tracking across all active notes (Schedule E)
 * - 1099-INT generation for borrowers (IRS requirement when interest > $600)
 * - Annual portfolio P&L report
 * - QuickBooks Online sync via OAuth2 API
 * - Deal type classification: dealer inventory vs. investment property
 */

import { db } from "../db";
import { notes, payments, properties, leads, organizations } from "@shared/schema";
import { eq, and, gte, lte, sql, desc, sum } from "drizzle-orm";
import { format, startOfYear, endOfYear } from "date-fns";

// ============================================
// DEAL P&L CALCULATION
// ============================================

export interface DealExpense {
  category: "purchase" | "back_taxes" | "title" | "recording" | "improvement" | "marketing" | "legal" | "carrying" | "other";
  description: string;
  amount: number;
  date: string;
}

export interface DealPnL {
  dealId?: number;
  propertyId: number;
  propertyAddress: string;
  acreage: number;

  // Revenue
  purchasePrice: number;
  sellingPrice: number;
  downPaymentReceived: number;

  // Costs
  acquisitionCosts: number; // Back taxes, closing, title
  improvementCosts: number;
  marketingCosts: number;
  legalCosts: number;
  totalCosts: number;

  // P&L
  grossProfit: number;
  netProfit: number;
  roi: number; // % return
  cashOnCashReturn: number;
  holdingDays: number;

  // Classification
  dealType: "flip" | "seller_finance" | "wholesale";
  taxTreatment: "ordinary_income" | "capital_gain_short" | "capital_gain_long" | "installment_sale";

  expenses: DealExpense[];
}

export function calculateDealPnL(
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
    .filter((e) => ["purchase", "back_taxes", "title", "recording"].includes(e.category))
    .reduce((sum, e) => sum + e.amount, 0);
  const improvementCosts = expenses
    .filter((e) => e.category === "improvement")
    .reduce((sum, e) => sum + e.amount, 0);
  const marketingCosts = expenses
    .filter((e) => e.category === "marketing")
    .reduce((sum, e) => sum + e.amount, 0);
  const legalCosts = expenses
    .filter((e) => ["legal", "recording"].includes(e.category))
    .reduce((sum, e) => sum + e.amount, 0);

  const totalInvestment = purchasePrice + totalCosts;
  const grossProfit = sellingPrice - purchasePrice;
  const netProfit = sellingPrice - totalInvestment;
  const roi = totalInvestment > 0 ? (netProfit / totalInvestment) * 100 : 0;
  const cashInvested = purchasePrice + totalCosts - (downPaymentReceived || 0);
  const cashOnCashReturn = cashInvested > 0 ? (netProfit / cashInvested) * 100 : 0;
  const holdingDays = Math.floor((saleDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));

  // Tax treatment
  let taxTreatment: DealPnL["taxTreatment"] = "ordinary_income";
  if (dealType === "seller_finance") {
    taxTreatment = "installment_sale";
  } else if (holdingDays > 365) {
    taxTreatment = "capital_gain_long";
  } else if (holdingDays > 0) {
    taxTreatment = "capital_gain_short";
  }

  return {
    propertyId: 0,
    propertyAddress: "",
    acreage: 0,
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

// ============================================
// INTEREST INCOME — SCHEDULE E DATA
// ============================================

export interface NoteInterestSummary {
  noteId: number;
  borrowerName: string;
  borrowerEmail: string | null;
  propertyAddress: string;
  yearOpeningBalance: number;
  yearClosingBalance: number;
  principalCollected: number;
  interestCollected: number;
  lateFeeCollected: number;
  paymentsCount: number;
  requires1099: boolean; // true if interest > $600
}

export interface AnnualInterestReport {
  taxYear: number;
  organizationId: number;
  totalInterestIncome: number;
  totalPrincipalReceived: number;
  totalLateFeesCollected: number;
  notesWith1099Required: number;
  notes: NoteInterestSummary[];
  generatedAt: string;
}

export async function generateAnnualInterestReport(
  orgId: number,
  taxYear: number
): Promise<AnnualInterestReport> {
  const yearStart = startOfYear(new Date(taxYear, 0, 1));
  const yearEnd = endOfYear(new Date(taxYear, 0, 1));

  // Get all payments for the year
  const yearPayments = await db
    .select({
      payment: payments,
      note: notes,
      lead: leads,
      property: properties,
    })
    .from(payments)
    .innerJoin(notes, eq(payments.noteId, notes.id))
    .leftJoin(leads, eq(notes.borrowerId, leads.id))
    .leftJoin(properties, eq(notes.propertyId, properties.id))
    .where(
      and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, yearStart),
        lte(payments.paymentDate, yearEnd),
        eq(payments.status, "completed")
      )
    );

  // Group by note
  const noteMap = new Map<number, NoteInterestSummary>();

  for (const { payment, note, lead, property } of yearPayments) {
    if (!noteMap.has(note.id)) {
      noteMap.set(note.id, {
        noteId: note.id,
        borrowerName: lead
          ? `${lead.firstName || ""} ${lead.lastName || ""}`.trim()
          : "Unknown Borrower",
        borrowerEmail: lead?.email || null,
        propertyAddress: property?.address || "Unknown Property",
        yearOpeningBalance: parseFloat(note.originalPrincipal || "0"),
        yearClosingBalance: parseFloat(note.currentBalance || "0"),
        principalCollected: 0,
        interestCollected: 0,
        lateFeeCollected: 0,
        paymentsCount: 0,
        requires1099: false,
      });
    }

    const summary = noteMap.get(note.id)!;
    summary.principalCollected += parseFloat(payment.principalAmount || "0");
    summary.interestCollected += parseFloat(payment.interestAmount || "0");
    summary.lateFeeCollected += parseFloat(payment.lateFeeAmount || "0");
    summary.paymentsCount++;
    summary.requires1099 = summary.interestCollected >= 600;
  }

  const notes_array = Array.from(noteMap.values());
  const totalInterest = notes_array.reduce((sum, n) => sum + n.interestCollected, 0);
  const totalPrincipal = notes_array.reduce((sum, n) => sum + n.principalCollected, 0);
  const totalLateFees = notes_array.reduce((sum, n) => sum + n.lateFeeCollected, 0);

  return {
    taxYear,
    organizationId: orgId,
    totalInterestIncome: totalInterest,
    totalPrincipalReceived: totalPrincipal,
    totalLateFeesCollected: totalLateFees,
    notesWith1099Required: notes_array.filter((n) => n.requires1099).length,
    notes: notes_array,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// 1099-INT GENERATION
// ============================================

export interface Form1099Int {
  payerName: string;
  payerAddress: string;
  payerEin: string;
  payerPhone: string;
  recipientName: string;
  recipientAddress: string;
  recipientTin: string; // SSN or EIN
  accountNumber: string; // Note ID
  taxYear: number;
  box1InterestIncome: number; // Box 1: Interest income
  box4FederalWithholding: number; // Box 4: Federal income tax withheld (usually 0)
}

export async function generate1099IntForms(
  orgId: number,
  taxYear: number
): Promise<Form1099Int[]> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));

  const report = await generateAnnualInterestReport(orgId, taxYear);
  const qualifying = report.notes.filter((n) => n.requires1099);

  return qualifying.map((note) => ({
    payerName: org?.name || "Land Investor",
    payerAddress: "",
    payerEin: "00-0000000",
    payerPhone: "",
    recipientName: note.borrowerName,
    recipientAddress: "",
    recipientTin: "000-00-0000", // Collected during onboarding
    accountNumber: `NOTE-${note.noteId}`,
    taxYear,
    box1InterestIncome: Math.round(note.interestCollected * 100) / 100,
    box4FederalWithholding: 0,
  }));
}

// ============================================
// QUICKBOOKS ONLINE SYNC
// ============================================

export interface QboTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: string;
}

export interface QboSyncResult {
  synced: number;
  errors: number;
  lastSyncAt: string;
}

async function getQboAuthHeader(tokens: QboTokens): Promise<string> {
  return `Bearer ${tokens.accessToken}`;
}

function getQboBase(realmId: string): string {
  const isSandbox = process.env.QBO_SANDBOX === "true";
  return `https://${isSandbox ? "sandbox-" : ""}quickbooks.api.intuit.com/v3/company/${realmId}`;
}

export async function syncPaymentsToQbo(
  orgId: number,
  tokens: QboTokens,
  fromDate: Date
): Promise<QboSyncResult> {
  const base = getQboBase(tokens.realmId);
  const authHeader = await getQboAuthHeader(tokens);

  const recentPayments = await db
    .select({
      payment: payments,
      note: notes,
      lead: leads,
    })
    .from(payments)
    .innerJoin(notes, eq(payments.noteId, notes.id))
    .leftJoin(leads, eq(notes.borrowerId, leads.id))
    .where(
      and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, fromDate),
        eq(payments.status, "completed")
      )
    );

  let synced = 0;
  let errors = 0;

  for (const { payment, note, lead } of recentPayments) {
    try {
      // Create a QBO Income entry for interest income
      const interestAmt = parseFloat(payment.interestAmount || "0");
      if (interestAmt > 0) {
        await fetch(`${base}/salesreceipt`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            TxnDate: format(payment.paymentDate, "yyyy-MM-dd"),
            CustomerRef: {
              name: lead ? `${lead.firstName} ${lead.lastName}` : `Note #${note.id}`,
            },
            Line: [
              {
                Amount: interestAmt,
                DetailType: "SalesItemLineDetail",
                SalesItemLineDetail: {
                  ItemRef: { name: "Interest Income", value: "Interest" },
                  Qty: 1,
                  UnitPrice: interestAmt,
                },
                Description: `Interest — Note #${note.id}`,
              },
              ...(parseFloat(payment.principalAmount || "0") > 0
                ? [
                    {
                      Amount: parseFloat(payment.principalAmount || "0"),
                      DetailType: "SalesItemLineDetail",
                      SalesItemLineDetail: {
                        ItemRef: { name: "Principal Received", value: "Principal" },
                        Qty: 1,
                        UnitPrice: parseFloat(payment.principalAmount || "0"),
                      },
                      Description: `Principal — Note #${note.id}`,
                    },
                  ]
                : []),
            ],
            PrivateNote: `AcreOS Note #${note.id} | Payment #${payment.id}`,
          }),
        });
        synced++;
      }
    } catch {
      errors++;
    }
  }

  return { synced, errors, lastSyncAt: new Date().toISOString() };
}

// ============================================
// QUICKBOOKS OAUTH — initiate connection
// ============================================

export function getQboOAuthUrl(orgId: number): string {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI || `${process.env.APP_URL}/api/integrations/qbo/callback`;

  if (!clientId) throw new Error("QBO_CLIENT_ID not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri,
    state: `org_${orgId}`,
  });

  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

// ============================================
// PORTFOLIO ANNUAL SUMMARY
// ============================================

export interface PortfolioAnnualSummary {
  taxYear: number;
  totalInterestIncome: number;
  totalPrincipalReceived: number;
  totalLateFees: number;
  totalGrossRevenue: number;
  estimatedTaxLiability: number; // rough estimate at 25% effective rate
  activeNotesCount: number;
  paidOffNotesCount: number;
  portfolioYield: number; // weighted average interest rate
}

export async function getPortfolioAnnualSummary(
  orgId: number,
  taxYear: number
): Promise<PortfolioAnnualSummary> {
  const report = await generateAnnualInterestReport(orgId, taxYear);

  const allNotes = await db
    .select()
    .from(notes)
    .where(eq(notes.organizationId, orgId));

  const activeNotes = allNotes.filter((n) => n.status === "active");
  const paidOffNotes = allNotes.filter((n) => n.status === "paid_off");

  const totalBalance = activeNotes.reduce((sum, n) => sum + parseFloat(n.currentBalance || "0"), 0);
  const weightedRateSum = activeNotes.reduce(
    (sum, n) => sum + parseFloat(n.interestRate || "0") * parseFloat(n.currentBalance || "0"),
    0
  );
  const portfolioYield = totalBalance > 0 ? weightedRateSum / totalBalance : 0;

  const totalRevenue = report.totalInterestIncome + report.totalPrincipalReceived + report.totalLateFeesCollected;

  return {
    taxYear,
    totalInterestIncome: Math.round(report.totalInterestIncome * 100) / 100,
    totalPrincipalReceived: Math.round(report.totalPrincipalReceived * 100) / 100,
    totalLateFees: Math.round(report.totalLateFeesCollected * 100) / 100,
    totalGrossRevenue: Math.round(totalRevenue * 100) / 100,
    estimatedTaxLiability: Math.round(report.totalInterestIncome * 0.25 * 100) / 100,
    activeNotesCount: activeNotes.length,
    paidOffNotesCount: paidOffNotes.length,
    portfolioYield: Math.round(portfolioYield * 100) / 100,
  };
}
