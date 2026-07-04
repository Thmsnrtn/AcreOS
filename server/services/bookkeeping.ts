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
import { notes, payments, properties, leads, organizations, trustLedger } from "@shared/schema";
import { eq, and, gte, lte, sql, desc, sum, asc } from "drizzle-orm";
import { format, startOfYear, endOfYear } from "date-fns";
import { decryptValue } from "./configManager";
import { centsFromDecimal, sumCents } from "@shared/finance/cents";

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
  // W3.3: sum expense categories in integer cents; the dollar fields on the
  // returned P&L are exact 2-decimal values instead of drifted floats.
  const totalCosts = sumCents(expenses.map((e) => e.amount)) / 100;
  const acquisitionCosts = sumCents(
    expenses.filter((e) => ["purchase", "back_taxes", "title", "recording"].includes(e.category)).map((e) => e.amount),
  ) / 100;
  const improvementCosts = sumCents(
    expenses.filter((e) => e.category === "improvement").map((e) => e.amount),
  ) / 100;
  const marketingCosts = sumCents(
    expenses.filter((e) => e.category === "marketing").map((e) => e.amount),
  ) / 100;
  const legalCosts = sumCents(
    expenses.filter((e) => ["legal", "recording"].includes(e.category)).map((e) => e.amount),
  ) / 100;

  const totalInvestment = (centsFromDecimal(purchasePrice) + centsFromDecimal(totalCosts)) / 100;
  const grossProfit = (centsFromDecimal(sellingPrice) - centsFromDecimal(purchasePrice)) / 100;
  const netProfit = (centsFromDecimal(sellingPrice) - centsFromDecimal(totalInvestment)) / 100;
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
  borrowerId: number | null;
  borrowerName: string;
  borrowerEmail: string | null;
  borrowerAddress: {
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  /** Ciphertext from leads.taxId — decrypt at the point of 1099 emission. */
  borrowerTaxIdCiphertext: string | null;
  borrowerTaxIdType: string | null;
  propertyAddress: string;
  yearOpeningBalance: number;
  yearClosingBalance: number;
  principalCollected: number;
  interestCollected: number;
  lateFeeCollected: number;
  paymentsCount: number;
  requires1099: boolean; // true if interest >= $600 (IRS 1099-INT threshold)
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
        borrowerId: lead?.id ?? null,
        borrowerName: lead
          ? `${lead.firstName || ""} ${lead.lastName || ""}`.trim()
          : "Unknown Borrower",
        borrowerEmail: lead?.email || null,
        borrowerAddress: lead
          ? {
              street: lead.address ?? null,
              city: lead.city ?? null,
              state: lead.state ?? null,
              zip: lead.zip ?? null,
            }
          : null,
        borrowerTaxIdCiphertext: lead?.taxId ?? null,
        borrowerTaxIdType: lead?.taxIdType ?? null,
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

    // W3.3 (2026-07 audit): accumulate in INTEGER CENTS. This is an IRS
    // reporting path — the old float `+=` drifted across a year of
    // payments, and the $600 1099 threshold was tested against the drifted
    // float. The acquired-note path (routes-notes.ts, SUM(interest_cents))
    // already did this right; this adopts the same model. The summary
    // fields hold cents during the loop and convert to dollars ONCE below.
    const summary = noteMap.get(note.id)!;
    summary.principalCollected += centsFromDecimal(payment.principalAmount);
    summary.interestCollected += centsFromDecimal(payment.interestAmount);
    summary.lateFeeCollected += centsFromDecimal(payment.lateFeeAmount);
    summary.paymentsCount++;
  }

  const notes_array = Array.from(noteMap.values());
  let totalInterestCents = 0;
  let totalPrincipalCents = 0;
  let totalLateFeeCents = 0;
  for (const n of notes_array) {
    totalInterestCents += n.interestCollected;
    totalPrincipalCents += n.principalCollected;
    totalLateFeeCents += n.lateFeeCollected;
    // IRS 1099-INT threshold: $600.00 = 60,000 cents, compared exactly.
    n.requires1099 = n.interestCollected >= 60_000;
    // Convert the per-note cents to dollars at the report edge.
    n.principalCollected = n.principalCollected / 100;
    n.interestCollected = n.interestCollected / 100;
    n.lateFeeCollected = n.lateFeeCollected / 100;
  }

  return {
    taxYear,
    organizationId: orgId,
    totalInterestIncome: totalInterestCents / 100,
    totalPrincipalReceived: totalPrincipalCents / 100,
    totalLateFeesCollected: totalLateFeeCents / 100,
    notesWith1099Required: notes_array.filter((n) => n.requires1099).length,
    notes: notes_array,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// 1099-INT GENERATION
// ============================================
// Conforms to IRS Form 1099-INT (2025 box layout). Each property is named
// after the box it populates so downstream PDF / e-file emitters can map
// fields without ambiguity. The earlier shape was 1098-style and produced
// invalid filings — see Phineas-IRS §3 / Olympia §1 / Hilda §3 / Martin §1
// audits in docs/exhaustive-completion/elite-team-deeper-2026-05-01/.

/** IRS-valid taxpayer identification placeholders we must never emit. */
const PLACEHOLDER_PAYER_TIN = "00-0000000";
const PLACEHOLDER_RECIPIENT_TIN_SSN = "000-00-0000";
const PLACEHOLDER_RECIPIENT_TIN_EIN = "00-0000000";

/** Errors that block 1099 generation when payer/recipient identity is missing. */
export class TaxIdentityError extends Error {
  readonly code: "PAYER_EIN_MISSING" | "RECIPIENT_TIN_MISSING" | "PAYER_NAME_MISSING";
  readonly orgId?: number;
  readonly noteId?: number;
  constructor(
    code: TaxIdentityError["code"],
    message: string,
    ctx: { orgId?: number; noteId?: number } = {}
  ) {
    super(message);
    this.name = "TaxIdentityError";
    this.code = code;
    this.orgId = ctx.orgId;
    this.noteId = ctx.noteId;
  }
}

/** Tax address shape used for both payer (org) and recipient (lead). */
export interface PayerOrRecipientAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

/**
 * IRS Form 1099-INT — 2025 layout.
 * Box 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 13 are the populated fields most
 * relevant to a seller-financed-note payer. We emit the full structure so
 * downstream e-filers (FIRE, IRIS) get a complete record, even when many
 * boxes are zero.
 */
export interface Form1099Int {
  // ── Header / parties ────────────────────────────────────────────────────
  taxYear: number;
  /** Account number per IRS instructions (we use NOTE-{id}). */
  accountNumber: string;

  payerName: string;
  payerAddress: PayerOrRecipientAddress;
  payerPhone: string;
  /** Payer's federal TIN. EIN format ##-####### or SSN format ###-##-####. */
  payerTin: string;
  payerTinType: "EIN" | "SSN" | "ITIN";

  recipientName: string;
  recipientAddress: PayerOrRecipientAddress;
  /** Recipient's TIN. SSN ###-##-####, EIN ##-#######, or ITIN 9##-##-####. */
  recipientTin: string;
  recipientTinType: "SSN" | "EIN" | "ITIN";

  // ── Form boxes (IRS Form 1099-INT, 2025) ────────────────────────────────
  /** Box 1 — Interest income (other than from US savings bonds / Treasury). */
  box1_interestIncome: number;
  /** Box 2 — Early withdrawal penalty. */
  box2_earlyWithdrawalPenalty: number;
  /** Box 3 — Interest on US savings bonds and Treasury obligations. */
  box3_usSavingsBondInterest: number;
  /** Box 4 — Federal income tax withheld (backup withholding). */
  box4_federalIncomeTaxWithheld: number;
  /** Box 5 — Investment expenses. */
  box5_investmentExpenses: number;
  /** Box 6 — Foreign tax paid. */
  box6_foreignTaxPaid: number;
  /** Box 7 — Foreign country or US possession. */
  box7_foreignCountry: string;
  /** Box 8 — Tax-exempt interest. */
  box8_taxExemptInterest: number;
  /** Box 9 — Specified private activity bond interest. */
  box9_privateActivityBondInterest: number;
  /** Box 10 — Market discount. */
  box10_marketDiscount: number;
  /** Box 11 — Bond premium. */
  box11_bondPremium: number;
  /** Box 12 — Bond premium on Treasury obligations. */
  box12_bondPremiumOnTreasury: number;
  /** Box 13 — Bond premium on tax-exempt bond. */
  box13_bondPremiumOnTaxExempt: number;
  /** Box 14 — Tax-exempt and tax credit bond CUSIP no. */
  box14_taxExemptBondCusip: string;
  /** Boxes 15-17 — State tax withholding (state, state ID, state tax withheld). */
  box15_state: string;
  box16_statePayerStateNumber: string;
  box17_stateTaxWithheld: number;
  /** FATCA filing requirement checkbox. */
  fatcaFilingRequirement: boolean;
  /** "2nd TIN not." checkbox (IRS notified payer twice in 3 years). */
  secondTinNotice: boolean;
}

/**
 * Decrypt a stored TIN ciphertext. If the value already looks like
 * plaintext (no encrypted format markers) we return it unchanged so legacy
 * rows written before encryption rolled out don't crash 1099 generation.
 */
function decryptStoredTin(ciphertext: string): string {
  // Accept both encrypted envelope shapes:
  //   • legacy 3-segment hex ("iv:tag:enc") from configManager.encryptValue
  //   • canonical "enc:v1:<base64>" envelope (post encryption-consolidation)
  // Plaintext rows (legacy un-encrypted) are returned unchanged.
  const isCanonical = ciphertext.startsWith("enc:v1:");
  const isLegacy3Seg = ciphertext.split(":").length === 3 && /^[0-9a-f:]+$/i.test(ciphertext);
  if (isCanonical || isLegacy3Seg) {
    try {
      return decryptValue(ciphertext);
    } catch {
      // fall through — surface the raw value rather than crash; downstream
      // validation will reject placeholders anyway.
      return ciphertext;
    }
  }
  return ciphertext;
}

/** Throw if the TIN matches a known placeholder pattern. */
function assertNonPlaceholderTin(
  tin: string,
  kind: "payer" | "recipient",
  ctx: { orgId?: number; noteId?: number }
): void {
  const stripped = tin.replace(/[\s-]/g, "");
  if (
    !tin ||
    tin === PLACEHOLDER_PAYER_TIN ||
    tin === PLACEHOLDER_RECIPIENT_TIN_SSN ||
    tin === PLACEHOLDER_RECIPIENT_TIN_EIN ||
    stripped === "000000000" ||
    /^0{8,9}$/.test(stripped)
  ) {
    throw new TaxIdentityError(
      kind === "payer" ? "PAYER_EIN_MISSING" : "RECIPIENT_TIN_MISSING",
      kind === "payer"
        ? `Cannot generate 1099-INT: payer EIN is missing or placeholder for org ${ctx.orgId}. Capture it during onboarding.`
        : `Cannot generate 1099-INT: recipient TIN is missing or placeholder for note ${ctx.noteId}. Collect a W-9 from the borrower.`,
      ctx
    );
  }
}

export async function generate1099IntForms(
  orgId: number,
  taxYear: number
): Promise<Form1099Int[]> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));

  if (!org) {
    throw new TaxIdentityError(
      "PAYER_NAME_MISSING",
      `Organization ${orgId} not found — cannot issue 1099-INTs.`,
      { orgId }
    );
  }

  // ── Resolve payer identity from org row (no fallbacks). ─────────────────
  const payerName = org.legalEntityName?.trim() || org.name?.trim();
  if (!payerName) {
    throw new TaxIdentityError(
      "PAYER_NAME_MISSING",
      `Organization ${orgId} has no legal entity name — required for 1099-INT.`,
      { orgId }
    );
  }

  if (!org.ein) {
    throw new TaxIdentityError(
      "PAYER_EIN_MISSING",
      `Organization ${orgId} has no EIN on file — capture it during onboarding before issuing 1099s.`,
      { orgId }
    );
  }
  const payerTin = decryptStoredTin(org.ein);
  assertNonPlaceholderTin(payerTin, "payer", { orgId });

  const payerTinType = (org.taxIdType as Form1099Int["payerTinType"]) || "EIN";

  const payerAddress: PayerOrRecipientAddress = {
    line1: org.taxAddress?.line1 || "",
    line2: org.taxAddress?.line2,
    city: org.taxAddress?.city || "",
    state: org.taxAddress?.state || "",
    zip: org.taxAddress?.zip || "",
    country: org.taxAddress?.country,
  };
  const payerPhone = org.taxAddress?.phone || "";

  // ── Build form per qualifying note. ────────────────────────────────────
  const report = await generateAnnualInterestReport(orgId, taxYear);
  const qualifying = report.notes.filter((n) => n.requires1099);

  return qualifying.map((note): Form1099Int => {
    if (!note.borrowerTaxIdCiphertext) {
      throw new TaxIdentityError(
        "RECIPIENT_TIN_MISSING",
        `Note ${note.noteId} (${note.borrowerName}) has no TIN — collect a W-9 before generating a 1099-INT.`,
        { orgId, noteId: note.noteId }
      );
    }
    const recipientTin = decryptStoredTin(note.borrowerTaxIdCiphertext);
    assertNonPlaceholderTin(recipientTin, "recipient", { orgId, noteId: note.noteId });

    const recipientTinType = (note.borrowerTaxIdType as Form1099Int["recipientTinType"]) || "SSN";

    return {
      taxYear,
      accountNumber: `NOTE-${note.noteId}`,

      payerName,
      payerAddress,
      payerPhone,
      payerTin,
      payerTinType,

      recipientName: note.borrowerName,
      recipientAddress: {
        line1: note.borrowerAddress?.street || "",
        city: note.borrowerAddress?.city || "",
        state: note.borrowerAddress?.state || "",
        zip: note.borrowerAddress?.zip || "",
      },
      recipientTin,
      recipientTinType,

      // Box 1: total interest income paid this tax year.
      box1_interestIncome: Math.round(note.interestCollected * 100) / 100,
      // Boxes 2–17: AcreOS does not currently track these for seller-finance
      // notes; emit zeros / empty strings so the IRS record is well-formed.
      box2_earlyWithdrawalPenalty: 0,
      box3_usSavingsBondInterest: 0,
      box4_federalIncomeTaxWithheld: 0,
      box5_investmentExpenses: 0,
      box6_foreignTaxPaid: 0,
      box7_foreignCountry: "",
      box8_taxExemptInterest: 0,
      box9_privateActivityBondInterest: 0,
      box10_marketDiscount: 0,
      box11_bondPremium: 0,
      box12_bondPremiumOnTreasury: 0,
      box13_bondPremiumOnTaxExempt: 0,
      box14_taxExemptBondCusip: "",
      box15_state: "",
      box16_statePayerStateNumber: "",
      box17_stateTaxWithheld: 0,
      fatcaFilingRequirement: false,
      secondTinNotice: false,
    };
  });
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
      // W3.3: round at the cents boundary BEFORE building the QBO payload —
      // parseFloat could push a 2-decimal `numeric` through float
      // representation error straight into the ledger of record.
      const interestAmt = centsFromDecimal(payment.interestAmount) / 100;
      const principalAmt = centsFromDecimal(payment.principalAmount) / 100;
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
              ...(principalAmt > 0
                ? [
                    {
                      Amount: principalAmt,
                      DetailType: "SalesItemLineDetail",
                      SalesItemLineDetail: {
                        ItemRef: { name: "Principal Received", value: "Principal" },
                        Qty: 1,
                        UnitPrice: principalAmt,
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

// ============================================
// TRUST LEDGER — DOUBLE-ENTRY JOURNAL ENTRIES
// Every financial event in the org produces one entry (+ running balance).
// Entry types follow a chart of accounts pattern:
//   income_*   — revenue (positive)
//   expense_*  — costs (negative)
//   transfer_* — internal movement (neutral)
// ============================================

export type LedgerEntryType =
  | 'income_deal_sale'
  | 'income_note_payment_interest'
  | 'income_note_payment_principal'
  | 'income_late_fee'
  | 'income_down_payment'
  | 'expense_acquisition'
  | 'expense_direct_mail'
  | 'expense_subscription'
  | 'expense_recording_fees'
  | 'expense_title'
  | 'expense_back_taxes'
  | 'expense_improvement'
  | 'expense_marketing'
  | 'expense_legal'
  | 'expense_other'
  | 'transfer_escrow_in'
  | 'transfer_escrow_out'
  | 'adjustment';

export interface LedgerJournalEntry {
  organizationId: number;
  noteId?: number;
  entryType: LedgerEntryType;
  /** Positive = income/asset increase, Negative = expense/liability increase */
  amount: number;
  description: string;
  referenceId?: string;
  referenceType?: string;
}

/**
 * Record a financial event in the trust ledger.
 * Automatically computes running balance.
 */
export async function recordLedgerEntry(entry: LedgerJournalEntry): Promise<void> {
  // Get current running balance for this org
  const [latest] = await db
    .select({ runningBalance: trustLedger.runningBalance })
    .from(trustLedger)
    .where(eq(trustLedger.organizationId, entry.organizationId))
    .orderBy(desc(trustLedger.createdAt))
    .limit(1);

  const prevBalance = parseFloat(latest?.runningBalance ?? '0');
  const newBalance = prevBalance + entry.amount;

  await db.insert(trustLedger).values({
    organizationId: entry.organizationId,
    noteId: entry.noteId ?? null,
    entryType: entry.entryType,
    amount: String(entry.amount),
    runningBalance: String(newBalance),
    description: entry.description,
    referenceId: entry.referenceId ?? null,
    referenceType: entry.referenceType ?? null,
  });
}

/**
 * Record a note payment received. Creates two entries:
 * principal (balance reduction) + interest (income).
 */
export async function recordNotePayment(
  organizationId: number,
  noteId: number,
  principalAmount: number,
  interestAmount: number,
  lateFeeAmount: number,
  paymentId: number
): Promise<void> {
  if (principalAmount > 0) {
    await recordLedgerEntry({
      organizationId,
      noteId,
      entryType: 'income_note_payment_principal',
      amount: principalAmount,
      description: `Note #${noteId} — principal payment`,
      referenceId: String(paymentId),
      referenceType: 'payment',
    });
  }
  if (interestAmount > 0) {
    await recordLedgerEntry({
      organizationId,
      noteId,
      entryType: 'income_note_payment_interest',
      amount: interestAmount,
      description: `Note #${noteId} — interest income`,
      referenceId: String(paymentId),
      referenceType: 'payment',
    });
  }
  if (lateFeeAmount > 0) {
    await recordLedgerEntry({
      organizationId,
      noteId,
      entryType: 'income_late_fee',
      amount: lateFeeAmount,
      description: `Note #${noteId} — late fee`,
      referenceId: String(paymentId),
      referenceType: 'payment',
    });
  }
}

/**
 * Record a deal acquisition expense.
 */
export async function recordDealAcquisition(
  organizationId: number,
  dealId: number,
  acquisitionPrice: number,
  additionalCosts: number = 0
): Promise<void> {
  await recordLedgerEntry({
    organizationId,
    entryType: 'expense_acquisition',
    amount: -(acquisitionPrice + additionalCosts),
    description: `Deal #${dealId} — property acquisition`,
    referenceId: String(dealId),
    referenceType: 'deal',
  });
}

/**
 * Record a deal sale / disposition.
 */
export async function recordDealSale(
  organizationId: number,
  dealId: number,
  salePrice: number
): Promise<void> {
  await recordLedgerEntry({
    organizationId,
    entryType: 'income_deal_sale',
    amount: salePrice,
    description: `Deal #${dealId} — property sale proceeds`,
    referenceId: String(dealId),
    referenceType: 'deal',
  });
}

export interface ProfitLossStatement {
  organizationId: number;
  fromDate: Date;
  toDate: Date;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  breakdown: Record<string, number>;
  openingBalance: number;
  closingBalance: number;
}

/**
 * Generate a P&L statement for a date range from trust ledger entries.
 */
export async function generateProfitLoss(
  organizationId: number,
  fromDate: Date,
  toDate: Date
): Promise<ProfitLossStatement> {
  const entries = await db
    .select()
    .from(trustLedger)
    .where(
      and(
        eq(trustLedger.organizationId, organizationId),
        gte(trustLedger.createdAt, fromDate),
        lte(trustLedger.createdAt, toDate)
      )
    )
    .orderBy(asc(trustLedger.createdAt));

  // W3.3: ledger totals accumulate in integer cents (breakdownCents keys
  // convert once at the return edge below).
  const breakdownCents: Record<string, number> = {};
  let totalIncomeCents = 0;
  let totalExpensesCents = 0;

  for (const entry of entries) {
    const amountCents = centsFromDecimal(entry.amount);
    breakdownCents[entry.entryType] = (breakdownCents[entry.entryType] || 0) + amountCents;
    if (amountCents > 0) totalIncomeCents += amountCents;
    else totalExpensesCents += Math.abs(amountCents);
  }
  const totalIncome = totalIncomeCents / 100;
  const totalExpenses = totalExpensesCents / 100;
  const breakdown: Record<string, number> = Object.fromEntries(
    Object.entries(breakdownCents).map(([k, v]) => [k, v / 100]),
  );

  // Opening balance = latest entry BEFORE fromDate
  const [openingEntry] = await db
    .select({ runningBalance: trustLedger.runningBalance })
    .from(trustLedger)
    .where(
      and(
        eq(trustLedger.organizationId, organizationId),
        lte(trustLedger.createdAt, fromDate)
      )
    )
    .orderBy(desc(trustLedger.createdAt))
    .limit(1);

  const openingBalanceCents = centsFromDecimal(openingEntry?.runningBalance);
  const closingBalanceCents = openingBalanceCents + totalIncomeCents - totalExpensesCents;

  return {
    organizationId,
    fromDate,
    toDate,
    totalIncome,
    totalExpenses,
    netIncome: (totalIncomeCents - totalExpensesCents) / 100,
    breakdown,
    openingBalance: openingBalanceCents / 100,
    closingBalance: closingBalanceCents / 100,
  };
}
