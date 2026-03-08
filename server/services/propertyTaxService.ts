/**
 * Property Tax Tracking & Escrow Service
 *
 * Mirrors GeekPay's property tax escrow feature:
 * - Collect pro-rated monthly tax from borrowers alongside loan payment
 * - Track escrow balance per note
 * - Alert investor when county taxes are due
 * - Record actual tax payments made from escrow
 * - Link to county tax payment portals
 */

import { db } from "../db";
import { notes, taxEscrowPayments, payments, properties, leads } from "@shared/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { addDays, addMonths, isAfter, isBefore, differenceInDays, format } from "date-fns";

// ============================================
// COUNTY TAX PORTAL DIRECTORY
// Well-known county online payment portals by state
// ============================================

const STATE_TAX_PORTAL_PATTERNS: Record<string, string> = {
  AZ: "https://mcassessor.maricopa.gov/",
  CA: "https://www.assessor.lacounty.gov/",
  TX: "https://www.dallascad.org/",
  FL: "https://www.bcpao.us/",
  NM: "https://www.bernco.gov/assessor/",
  NV: "https://www.clarkcountynv.gov/government/assessor/",
  UT: "https://slco.org/assessor/",
  CO: "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Assessors-Office",
  OR: "https://www.co.lane.or.us/assessor/",
  WA: "https://www.kingcounty.gov/services/gis/Maps/iMap.aspx",
  ID: "https://www.adacounty.id.gov/assessor/",
  MT: "https://mtrevenue.gov/taxes/",
  WY: "https://laramiecounty.com/government/departments/assessors-office/",
  SD: "https://dor.sd.gov/Taxes/Property_Taxes/",
  ND: "https://www.nd.gov/tax/",
  MN: "https://www.hennepin.us/residents/property/property-taxes",
  WI: "https://www.revenue.wi.gov/Pages/FAQS/ise-proptax.aspx",
  MI: "https://www.michigan.gov/taxes/0,4676,7-238-43535---,00.html",
  OH: "https://www.ohiotreasurer.gov/Portals/0/",
  IN: "https://www.in.gov/dlgf/",
  IL: "https://www.cookcountytreasurer.com/",
  MO: "https://dor.mo.gov/personal/ptc/",
  KS: "https://www.ksrevenue.gov/propertyiindex.html",
  NE: "https://revenue.nebraska.gov/about/faqs/real-property",
  IA: "https://tax.iowa.gov/property-tax",
  AR: "https://www.dfa.arkansas.gov/income-tax/individual-income-tax/",
  LA: "https://www.latax.state.la.us/",
  MS: "https://www.dor.ms.gov/Individual/Pages/Property-Tax-FAQ.aspx",
  AL: "https://www.revenue.alabama.gov/property-tax/",
  GA: "https://dor.georgia.gov/property-tax",
  SC: "https://www.sctax.org/NR/rdonlyres/property-taxes.htm",
  NC: "https://www.ncdor.gov/taxes-forms/property-tax",
  TN: "https://comptroller.tn.gov/boards/assessment-appeals/property-tax-resources.html",
  KY: "https://revenue.ky.gov/Property/Pages/Real-Property.aspx",
  VA: "https://www.tax.virginia.gov/real-estate-tax",
  WV: "https://tax.wv.gov/Business/PropertyTax/Pages/PropertyTax.aspx",
  MD: "https://dat.maryland.gov/realproperty/Pages/default.aspx",
  DE: "https://finance.delaware.gov/property-tax/",
  NJ: "https://www.nj.gov/treasury/taxation/lpt/lptoverview.shtml",
  NY: "https://www.tax.ny.gov/pit/property/default.htm",
  CT: "https://portal.ct.gov/OPM/IGPP-MAIN/Municipalities/Municipal-Taxation",
  RI: "https://www.providenceri.gov/assessor/",
  MA: "https://www.mass.gov/guides/property-taxes",
  VT: "https://tax.vermont.gov/property-owners",
  NH: "https://www.revenue.nh.gov/mun-prop/property/",
  ME: "https://www.maine.gov/revenue/taxes/property-tax",
  PA: "https://www.revenue.pa.gov/GeneralTaxInformation/PropertyTax/Pages/default.aspx",
};

export function getCountyTaxPortalUrl(state: string, county?: string): string {
  const stateCode = state.toUpperCase().trim();
  return STATE_TAX_PORTAL_PATTERNS[stateCode] || `https://www.google.com/search?q=${encodeURIComponent(`${county || ""} county ${stateCode} property tax payment online`)}`;
}

// ============================================
// ESCROW CALCULATION
// ============================================

export interface TaxEscrowSetup {
  annualPropertyTax: number;
  monthlyTaxEscrow: number;
  totalMonthlyPaymentWithEscrow: number;
  projectedEscrowBalance12Months: number;
  countyTaxPortalUrl: string;
}

export function calculateTaxEscrow(
  annualPropertyTax: number,
  currentMonthlyPayment: number,
  state: string,
  county?: string
): TaxEscrowSetup {
  const monthlyTaxEscrow = Math.ceil((annualPropertyTax / 12) * 100) / 100;
  return {
    annualPropertyTax,
    monthlyTaxEscrow,
    totalMonthlyPaymentWithEscrow: currentMonthlyPayment + monthlyTaxEscrow,
    projectedEscrowBalance12Months: monthlyTaxEscrow * 12,
    countyTaxPortalUrl: getCountyTaxPortalUrl(state, county),
  };
}

// ============================================
// ESCROW MANAGEMENT
// ============================================

export interface EscrowStatus {
  noteId: number;
  enabled: boolean;
  annualTax: number;
  monthlyEscrow: number;
  currentBalance: number;
  nextTaxDue: Date | null;
  isAdequate: boolean; // enough balance to cover upcoming tax payment
  shortfallAmount: number;
  lastPaymentDate: Date | null;
  countyPortalUrl: string | null;
  recommendation: string;
}

export async function getNoteEscrowStatus(noteId: number, orgId: number): Promise<EscrowStatus | null> {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.organizationId, orgId)));

  if (!note) return null;

  const annualTax = parseFloat(note.annualPropertyTax || "0");
  const monthlyEscrow = parseFloat(note.monthlyTaxEscrow || "0");
  const currentBalance = parseFloat(note.taxEscrowBalance || "0");
  const nextTaxDue = note.nextTaxDueDate;

  let isAdequate = true;
  let shortfallAmount = 0;
  let recommendation = "Escrow balance on track.";

  if (note.taxEscrowEnabled && nextTaxDue) {
    const daysUntilDue = differenceInDays(nextTaxDue, new Date());
    const expectedBalance = monthlyEscrow * Math.max(0, daysUntilDue / 30);

    if (currentBalance < annualTax) {
      shortfallAmount = annualTax - currentBalance;
      isAdequate = false;
      if (daysUntilDue < 60) {
        recommendation = `⚠️ Escrow shortfall of ${formatCurrency(shortfallAmount)} — taxes due in ${daysUntilDue} days. Consider a one-time deposit or increasing monthly escrow.`;
      } else {
        recommendation = `Escrow will be fully funded by ${format(nextTaxDue, "MMM yyyy")} at current rate.`;
      }
    } else if (currentBalance > annualTax * 1.5) {
      recommendation = `Escrow overfunded. Consider reducing monthly escrow by ${formatCurrency(monthlyEscrow * 0.25)}/month.`;
    }
  }

  if (!note.taxEscrowEnabled) {
    recommendation = "Tax escrow not enabled. Enable to automatically collect property taxes from borrower.";
  }

  return {
    noteId,
    enabled: note.taxEscrowEnabled || false,
    annualTax,
    monthlyEscrow,
    currentBalance,
    nextTaxDue,
    isAdequate,
    shortfallAmount,
    lastPaymentDate: note.lastTaxPaymentDate,
    countyPortalUrl: note.countyTaxPortalUrl,
    recommendation,
  };
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// ============================================
// ESCROW CREDITS — called when borrower makes monthly payment
// ============================================

export async function creditMonthlyTaxEscrow(noteId: number, orgId: number): Promise<void> {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.organizationId, orgId)));

  if (!note || !note.taxEscrowEnabled) return;

  const monthly = parseFloat(note.monthlyTaxEscrow || "0");
  const current = parseFloat(note.taxEscrowBalance || "0");

  await db
    .update(notes)
    .set({ taxEscrowBalance: String(current + monthly) })
    .where(eq(notes.id, noteId));
}

// ============================================
// RECORD A TAX PAYMENT FROM ESCROW
// ============================================

export interface RecordTaxPaymentInput {
  noteId: number;
  propertyId?: number;
  taxYear: number;
  installment?: "annual" | "first_half" | "second_half" | "quarterly";
  amountPaid: number;
  paymentDate: Date;
  countyConfirmationNumber?: string;
  paymentMethod?: "manual" | "portal" | "check";
  notes?: string;
  receiptUrl?: string;
}

export async function recordTaxPaymentFromEscrow(
  orgId: number,
  input: RecordTaxPaymentInput
): Promise<{ success: boolean; shortfall: number; newBalance: number }> {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, input.noteId), eq(notes.organizationId, orgId)));

  if (!note) throw new Error("Note not found");

  const currentBalance = parseFloat(note.taxEscrowBalance || "0");
  const escrowUsed = Math.min(currentBalance, input.amountPaid);
  const shortfall = Math.max(0, input.amountPaid - currentBalance);
  const excessRefunded = Math.max(0, currentBalance - input.amountPaid);
  const newBalance = currentBalance - escrowUsed;

  // Record the payment
  await db.insert(taxEscrowPayments).values({
    organizationId: orgId,
    noteId: input.noteId,
    propertyId: input.propertyId,
    taxYear: input.taxYear,
    installment: input.installment || "annual",
    amountPaid: String(input.amountPaid),
    escrowBalanceUsed: String(escrowUsed),
    shortfall: String(shortfall),
    excessRefunded: String(excessRefunded),
    paymentDate: input.paymentDate,
    countyConfirmationNumber: input.countyConfirmationNumber,
    paymentMethod: input.paymentMethod || "manual",
    countyTaxPortalUrl: note.countyTaxPortalUrl,
    notes: input.notes,
    receiptUrl: input.receiptUrl,
  });

  // Update note escrow balance and last payment date
  await db
    .update(notes)
    .set({
      taxEscrowBalance: String(newBalance),
      lastTaxPaymentDate: input.paymentDate,
      taxPaymentYear: input.taxYear,
    })
    .where(eq(notes.id, input.noteId));

  return { success: true, shortfall, newBalance };
}

// ============================================
// PORTFOLIO TAX OVERVIEW
// ============================================

export interface PortfolioTaxSummary {
  totalNotesWithEscrow: number;
  totalAnnualTaxExposure: number;
  totalEscrowBalance: number;
  notesWithShortfall: number;
  taxesDueIn30Days: number;
  taxesDueIn90Days: number;
  notes: {
    noteId: number;
    borrowerName: string;
    propertyAddress: string;
    annualTax: number;
    escrowBalance: number;
    nextTaxDue: string | null;
    status: "adequate" | "shortfall" | "due_soon" | "overdue";
  }[];
}

export async function getPortfolioTaxSummary(orgId: number): Promise<PortfolioTaxSummary> {
  const allNotes = await db
    .select({
      note: notes,
      property: properties,
      lead: leads,
    })
    .from(notes)
    .leftJoin(properties, eq(notes.propertyId, properties.id))
    .leftJoin(leads, eq(notes.borrowerId, leads.id))
    .where(and(eq(notes.organizationId, orgId), eq(notes.taxEscrowEnabled, true)));

  const now = new Date();
  const in30 = addDays(now, 30);
  const in90 = addDays(now, 90);

  let totalAnnualTax = 0;
  let totalBalance = 0;
  let shortfallCount = 0;
  let due30Count = 0;
  let due90Count = 0;

  const noteDetails = allNotes.map(({ note, property, lead }) => {
    const annualTax = parseFloat(note.annualPropertyTax || "0");
    const balance = parseFloat(note.taxEscrowBalance || "0");
    totalAnnualTax += annualTax;
    totalBalance += balance;

    const isShortfall = balance < annualTax;
    if (isShortfall) shortfallCount++;

    let status: "adequate" | "shortfall" | "due_soon" | "overdue" = "adequate";
    if (note.nextTaxDueDate) {
      if (isBefore(note.nextTaxDueDate, now)) {
        status = "overdue";
      } else if (isBefore(note.nextTaxDueDate, in30)) {
        status = "due_soon";
        due30Count++;
      } else if (isBefore(note.nextTaxDueDate, in90)) {
        due90Count++;
        if (isShortfall) status = "shortfall";
      } else if (isShortfall) {
        status = "shortfall";
      }
    } else if (isShortfall) {
      status = "shortfall";
    }

    const borrowerName = lead
      ? `${lead.firstName || ""} ${lead.lastName || ""}`.trim()
      : "Unknown Borrower";
    const propertyAddress = property?.address || "Unknown Property";

    return {
      noteId: note.id,
      borrowerName,
      propertyAddress,
      annualTax,
      escrowBalance: balance,
      nextTaxDue: note.nextTaxDueDate ? format(note.nextTaxDueDate, "yyyy-MM-dd") : null,
      status,
    };
  });

  return {
    totalNotesWithEscrow: allNotes.length,
    totalAnnualTaxExposure: totalAnnualTax,
    totalEscrowBalance: totalBalance,
    notesWithShortfall: shortfallCount,
    taxesDueIn30Days: due30Count,
    taxesDueIn90Days: due90Count,
    notes: noteDetails,
  };
}

// ============================================
// ENABLE ESCROW ON A NOTE
// ============================================

export async function enableTaxEscrow(
  orgId: number,
  noteId: number,
  annualTax: number,
  nextTaxDueDate: Date,
  countyTaxPortalUrl?: string
): Promise<void> {
  const monthlyEscrow = Math.ceil((annualTax / 12) * 100) / 100;

  await db
    .update(notes)
    .set({
      taxEscrowEnabled: true,
      annualPropertyTax: String(annualTax),
      monthlyTaxEscrow: String(monthlyEscrow),
      nextTaxDueDate,
      countyTaxPortalUrl: countyTaxPortalUrl || null,
      taxPaymentYear: nextTaxDueDate.getFullYear(),
    })
    .where(and(eq(notes.id, noteId), eq(notes.organizationId, orgId)));
}

export async function disableTaxEscrow(orgId: number, noteId: number): Promise<void> {
  await db
    .update(notes)
    .set({ taxEscrowEnabled: false })
    .where(and(eq(notes.id, noteId), eq(notes.organizationId, orgId)));
}
