/**
 * 1099-INT Batch Generator — Olympia Week 10.
 *
 * Walks every borrower with > $600 interest income in a tax year and
 * produces:
 *
 *   • One PDF per recipient — IRS Form 1099-INT (2025 layout)
 *   • One 1096 transmittal-summary PDF
 *   • One FIRE-format text file (IRS Pub 1220) for electronic filing
 *   • A consolidated batch result row in `form_1099_batches`
 *
 * The route handler returns the batch jobId; a follow-up GET fetches the
 * stored `result_blob` (with PDF buffers as base64 + the FIRE text).
 *
 * Why the work happens in a service rather than inline
 * ────────────────────────────────────────────────────
 * Generating ~hundreds of 1099 PDFs + a FIRE file can take a few seconds
 * for a busy noteholder. We persist a job row, return immediately, and
 * let `runForm1099Batch` execute either inline (for small orgs) or on a
 * worker (for large orgs). Status moves queued → running → success|failure.
 */

import { db } from "../db";
import { form1099Batches } from "@shared/schema";
import { eq } from "drizzle-orm";
import { jsPDF } from "jspdf";
import {
  generate1099IntForms,
  TaxIdentityError,
  type Form1099Int,
} from "./bookkeeping";
import {
  buildFireFile,
  validateFireFile,
  type PayeeRecord,
  type TransmitterRecord,
  type IssuerRecord,
} from "./irsFireFormat";
import { logger } from "../utils/logger";

export interface BatchResult {
  jobId: string;
  status: "success" | "failure";
  formCount: number;
  totalInterestCents: number;
  fireFileBytes: number;
  fireRecordCounts: { T: number; A: number; B: number; C: number; F: number };
  /** Individual PDFs are returned as base64 strings keyed by recipient name. */
  recipientPdfs: Array<{ recipientName: string; noteId: number; pdfBase64: string; box1Cents: number }>;
  /** The 1096 transmittal-summary PDF (base64). */
  transmittalPdfBase64: string;
  /** Full FIRE text (validated via validateFireFile before commit). */
  fireFile: string;
  errors?: string[];
}

/**
 * Public entry. Creates the batch job row, kicks off generation
 * synchronously (small/medium orgs), and returns the BatchResult.
 *
 * We choose synchronous-by-default because the data volumes are small
 * (a noteholder with 100 active borrowers is already on the high end of
 * AcreOS's customer base). The route handler still returns a jobId so the
 * UI can poll `/api/accounting/1099-batch/:jobId` for any later
 * regeneration.
 */
export async function generate1099Batch(
  orgId: number,
  taxYear: number,
): Promise<BatchResult> {
  // Create a queued row first so the route handler can return jobId
  // immediately when this is invoked async.
  const [batch] = await db
    .insert(form1099Batches)
    .values({
      organizationId: orgId,
      taxYear,
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: form1099Batches.id });
  const jobId = batch!.id;

  try {
    const result = await runForm1099Batch(jobId, orgId, taxYear);
    await db
      .update(form1099Batches)
      .set({
        status: result.status,
        formCount: result.formCount,
        totalInterestCents: result.totalInterestCents,
        completedAt: new Date(),
        resultBlob: {
          forms: result.recipientPdfs.map((r) => ({
            noteId: r.noteId,
            recipientName: r.recipientName,
            box1Cents: r.box1Cents,
          })),
          fireFile: result.fireFile,
          summary:
            `${result.formCount} 1099-INT forms, ` +
            `$${(result.totalInterestCents / 100).toFixed(2)} total interest, ` +
            `FIRE file ${result.fireFileBytes} bytes`,
        },
      })
      .where(eq(form1099Batches.id, jobId));
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(form1099Batches)
      .set({
        status: "failure",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(form1099Batches.id, jobId));
    throw err;
  }
}

/**
 * Look up an existing batch by jobId. Used by the GET endpoint so the
 * UI can poll and download artefacts.
 */
export async function getForm1099BatchStatus(jobId: string) {
  const [row] = await db.select().from(form1099Batches).where(eq(form1099Batches.id, jobId)).limit(1);
  return row ?? null;
}

// ─── Implementation ───────────────────────────────────────────────────────

async function runForm1099Batch(
  jobId: string,
  orgId: number,
  taxYear: number,
): Promise<BatchResult> {
  const errors: string[] = [];

  let forms: Form1099Int[];
  try {
    forms = await generate1099IntForms(orgId, taxYear);
  } catch (err) {
    if (err instanceof TaxIdentityError) {
      errors.push(`tax_identity_missing:${err.code}:${err.message}`);
      // Re-throw so the caller marks the batch as failure with the
      // human-readable reason. The error includes orgId / noteId so the
      // recovery UI can deeplink to the missing-W-9 surface.
      throw err;
    }
    throw err;
  }

  // ── Per-recipient 1099-INT PDFs ───────────────────────────────────────
  const recipientPdfs = forms.map((f) => ({
    recipientName: f.recipientName,
    noteId: parseInt(f.accountNumber.replace(/\D/g, ""), 10) || 0,
    box1Cents: Math.round(f.box1_interestIncome * 100),
    pdfBase64: render1099IntPdf(f).toString("base64"),
  }));

  // ── 1096 transmittal summary ──────────────────────────────────────────
  const transmittalPdf = render1096TransmittalPdf(forms, taxYear);

  // ── FIRE-format file ──────────────────────────────────────────────────
  const fire = forms.length > 0 ? buildFireFromForms(forms, taxYear) : null;
  const fireFile = fire?.text ?? "";
  const fireFileBytes = fire?.bytes ?? 0;
  const recordCounts = fire?.recordCounts ?? { T: 0, A: 0, B: 0, C: 0, F: 0 };

  if (fire) {
    const validationErrors = validateFireFile(fire.text);
    if (validationErrors.length > 0) {
      logger.error("form1099Batch.fireValidationFailed", new Error(validationErrors.join("; ")));
      errors.push(...validationErrors.map((e) => `fire_validation:${e}`));
    }
  }

  const totalInterestCents = forms.reduce((s, f) => s + Math.round(f.box1_interestIncome * 100), 0);

  return {
    jobId,
    status: errors.length === 0 ? "success" : "failure",
    formCount: forms.length,
    totalInterestCents,
    fireFileBytes,
    fireRecordCounts: recordCounts,
    recipientPdfs,
    transmittalPdfBase64: transmittalPdf.toString("base64"),
    fireFile,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ─── PDF renderers ────────────────────────────────────────────────────────

/**
 * Render a single Form 1099-INT as a 1-page PDF. Layout matches the IRS
 * 2025 paper form closely enough that recipients receive a familiar
 * artefact; we are NOT rendering on the official red-ink Copy A pre-
 * printed form (that is mailed by IRS-approved vendors only).
 */
function render1099IntPdf(f: Form1099Int): Buffer {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.5;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Form 1099-INT", margin, y + 0.2);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Tax Year: ${f.taxYear}`, 6.5, y + 0.2);
  y += 0.5;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("PAYER", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(f.payerName, margin, y + 0.18);
  doc.text(f.payerAddress.line1, margin, y + 0.34);
  doc.text(`${f.payerAddress.city}, ${f.payerAddress.state} ${f.payerAddress.zip}`, margin, y + 0.5);
  doc.text(`TIN: ${f.payerTin} (${f.payerTinType})`, margin, y + 0.66);

  doc.setFont("helvetica", "bold");
  doc.text("RECIPIENT", 4.5, y);
  doc.setFont("helvetica", "normal");
  doc.text(f.recipientName, 4.5, y + 0.18);
  doc.text(f.recipientAddress.line1, 4.5, y + 0.34);
  doc.text(`${f.recipientAddress.city}, ${f.recipientAddress.state} ${f.recipientAddress.zip}`, 4.5, y + 0.5);
  doc.text(`TIN: ${f.recipientTin} (${f.recipientTinType})`, 4.5, y + 0.66);
  y += 1.0;

  doc.setFont("helvetica", "normal");
  doc.text(`Account Number: ${f.accountNumber}`, margin, y);
  y += 0.3;

  // Box layout — rendered as a simple table.
  const boxes: Array<[string, string]> = [
    ["1. Interest income", `$${f.box1_interestIncome.toFixed(2)}`],
    ["2. Early withdrawal penalty", `$${f.box2_earlyWithdrawalPenalty.toFixed(2)}`],
    ["3. Interest on US savings bonds & Treasury obligations", `$${f.box3_usSavingsBondInterest.toFixed(2)}`],
    ["4. Federal income tax withheld", `$${f.box4_federalIncomeTaxWithheld.toFixed(2)}`],
    ["5. Investment expenses", `$${f.box5_investmentExpenses.toFixed(2)}`],
    ["6. Foreign tax paid", `$${f.box6_foreignTaxPaid.toFixed(2)}`],
    ["7. Foreign country", f.box7_foreignCountry || "—"],
    ["8. Tax-exempt interest", `$${f.box8_taxExemptInterest.toFixed(2)}`],
    ["9. Specified private activity bond interest", `$${f.box9_privateActivityBondInterest.toFixed(2)}`],
    ["10. Market discount", `$${f.box10_marketDiscount.toFixed(2)}`],
    ["11. Bond premium", `$${f.box11_bondPremium.toFixed(2)}`],
    ["12. Bond premium on Treasury obligations", `$${f.box12_bondPremiumOnTreasury.toFixed(2)}`],
    ["13. Bond premium on tax-exempt bond", `$${f.box13_bondPremiumOnTaxExempt.toFixed(2)}`],
    ["14. Tax-exempt and tax credit bond CUSIP no.", f.box14_taxExemptBondCusip || "—"],
    ["15. State", f.box15_state || "—"],
    ["16. State payer's state no.", f.box16_statePayerStateNumber || "—"],
    ["17. State tax withheld", `$${f.box17_stateTaxWithheld.toFixed(2)}`],
  ];
  for (const [label, value] of boxes) {
    doc.text(label, margin, y);
    doc.text(value, 6.5, y, { align: "right" });
    y += 0.18;
  }

  y += 0.2;
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  if (f.fatcaFilingRequirement) {
    doc.text("FATCA filing requirement: ☑", margin, y);
    y += 0.16;
  }
  if (f.secondTinNotice) {
    doc.text("2nd TIN notice: ☑", margin, y);
    y += 0.16;
  }

  const ab = doc.output("arraybuffer") as ArrayBuffer;
  return Buffer.from(ab);
}

/**
 * Render the 1096 transmittal summary. The 1096 accompanies a paper-
 * filed batch of 1099s and reports the totals across the batch.
 */
function render1096TransmittalPdf(forms: Form1099Int[], taxYear: number): Buffer {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.5;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Form 1096 — Annual Summary and Transmittal", margin, y + 0.25);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Tax Year: ${taxYear}`, 6.5, y + 0.25);
  y += 0.7;

  if (forms.length > 0) {
    const f = forms[0]!;
    doc.setFont("helvetica", "bold");
    doc.text("Filer", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(f.payerName, margin, y + 0.18);
    doc.text(f.payerAddress.line1, margin, y + 0.34);
    doc.text(`${f.payerAddress.city}, ${f.payerAddress.state} ${f.payerAddress.zip}`, margin, y + 0.5);
    doc.text(`Federal TIN: ${f.payerTin} (${f.payerTinType})`, margin, y + 0.66);
    y += 1.0;
  }

  const totalBox1 = forms.reduce((s, f) => s + f.box1_interestIncome, 0);
  const totalBox4 = forms.reduce((s, f) => s + f.box4_federalIncomeTaxWithheld, 0);

  doc.setFont("helvetica", "bold");
  doc.text("Box 3. Total number of forms", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(String(forms.length), 6.5, y, { align: "right" });
  y += 0.25;

  doc.setFont("helvetica", "bold");
  doc.text("Box 4. Federal income tax withheld", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(`$${totalBox4.toFixed(2)}`, 6.5, y, { align: "right" });
  y += 0.25;

  doc.setFont("helvetica", "bold");
  doc.text("Box 5. Total amount reported (Box 1 of 1099-INT)", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(`$${totalBox1.toFixed(2)}`, 6.5, y, { align: "right" });
  y += 0.4;

  doc.setFont("helvetica", "bold");
  doc.text("Form being transmitted: 1099-INT", margin, y);
  y += 0.5;

  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(
    "This 1096 is generated by AcreOS. For paper filing, print on red-ink Copy A pre-printed forms.",
    margin,
    y,
  );

  const ab = doc.output("arraybuffer") as ArrayBuffer;
  return Buffer.from(ab);
}

// ─── FIRE assembly ────────────────────────────────────────────────────────

function nameControlOf(name: string): string {
  // Pub 1220 §3.1 — name control = first 4 letters of surname (or first
  // 4 alphas of entity name). We strip non-alphas and uppercase.
  const cleaned = name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return cleaned.slice(0, 4);
}

function buildFireFromForms(forms: Form1099Int[], taxYear: number) {
  const f0 = forms[0]!;
  const transmitter: TransmitterRecord = {
    taxYear,
    tcc: process.env.IRS_TCC ?? "00000",
    transmitterTin: f0.payerTin,
    transmitterName: f0.payerName,
    transmitterAddress: f0.payerAddress.line1,
    city: f0.payerAddress.city,
    state: f0.payerAddress.state,
    zip: f0.payerAddress.zip,
    contactName: f0.payerName,
    contactPhone: f0.payerPhone,
    contactEmail: process.env.IRS_CONTACT_EMAIL ?? "",
    testIndicator: process.env.IRS_FIRE_TEST === "true" ? "T" : " ",
  };

  const issuer: IssuerRecord = {
    taxYear,
    payerTin: f0.payerTin,
    nameControl: nameControlOf(f0.payerName),
    payerName: f0.payerName,
    payerAddress: f0.payerAddress.line1,
    payerCity: f0.payerAddress.city,
    payerState: f0.payerAddress.state,
    payerZip: f0.payerAddress.zip,
    payerPhone: f0.payerPhone,
    returnType: "INT",
    amountCodes: "1", // Box 1 (interest income) is the only box AcreOS populates today.
  };

  const payees: PayeeRecord[] = forms.map((f) => ({
    taxYear,
    box1IntCents: Math.round(f.box1_interestIncome * 100),
    box2EarlyWithdrawalCents: Math.round(f.box2_earlyWithdrawalPenalty * 100),
    box3UsBondCents: Math.round(f.box3_usSavingsBondInterest * 100),
    box4FedTaxWithheldCents: Math.round(f.box4_federalIncomeTaxWithheld * 100),
    recipientTin: f.recipientTin,
    recipientTinType: f.recipientTinType,
    accountNumber: f.accountNumber,
    recipientName: f.recipientName,
    recipientAddress: f.recipientAddress.line1,
    recipientCity: f.recipientAddress.city,
    recipientState: f.recipientAddress.state,
    recipientZip: f.recipientAddress.zip,
    nameControl: nameControlOf(f.recipientName.split(" ").slice(-1)[0] || f.recipientName),
    fatca: f.fatcaFilingRequirement,
    secondTinNotice: f.secondTinNotice,
  }));

  return buildFireFile({ transmitter, issuer, payees });
}
