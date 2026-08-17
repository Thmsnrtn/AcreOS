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
import { form1099Batches, organizations } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { jsPDF } from "jspdf";
import {
  generate1099IntForms,
  TaxIdentityError,
  type Form1099Int,
  type PayerOrRecipientAddress,
} from "./bookkeeping";
import {
  buildFireFile,
  validateFireFile,
  type PayeeRecord,
  type TransmitterRecord,
  type IssuerRecord,
} from "./irsFireFormat";
import { logger } from "../utils/logger";
import { aggregateAcquiredNoteInterestForYear } from "../routes-notes";
import { decrypt as decryptField, isAnyEncryptedEnvelope } from "./fieldEncryption";

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
 * Look up an existing batch by jobId, PINNED TO THE OWNING ORG. Used by the
 * GET endpoint so the UI can poll and download artefacts.
 *
 * `organizationId` is not decoration: the jobId is a UUID that arrives
 * straight off a URL segment (`GET /api/accounting/1099-batch/:jobId`), and
 * the row it resolves carries a whole tax batch — recipient names, TINs,
 * per-note interest and the FIRE file. This used to be a bare-PK fetch whose
 * only tenancy guard was a hand-written `row.organizationId !== org.id`
 * compare in the one route that called it; the leak was closed at the caller
 * rather than by construction, so a second caller that forgot the compare
 * reopened it. Now a cross-tenant jobId resolves to null and there is nothing
 * left to remember.
 */
export async function getForm1099BatchStatus(organizationId: number, jobId: string) {
  const [row] = await db
    .select()
    .from(form1099Batches)
    .where(and(eq(form1099Batches.id, jobId), eq(form1099Batches.organizationId, organizationId)))
    .limit(1);
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

  // Note Investor vertical (Phase 5 §5) — union acquired-note interest.
  // generate1099IntForms() above only walks ORIGINATED notes (`notes` table).
  // For orgs that *acquired* notes from a previous holder, the interest
  // they collected lives in `note_payments` keyed by `acquired_notes.id`.
  // We aggregate that here and append to the form set so a single 1099-INT
  // batch covers both income sources.
  try {
    const acquiredForms = await buildFormsFromAcquiredNotes(orgId, taxYear);
    if (acquiredForms.length > 0) {
      // De-dup by recipientName + recipientTin in case the same payer
      // appears in both originated AND acquired sources (rare — would mean
      // we sold a note and bought it back). When that happens the interest
      // sums.
      forms = mergeFormsByRecipient(forms, acquiredForms);
    }
  } catch (err) {
    if (err instanceof TaxIdentityError) {
      errors.push(`tax_identity_missing:${err.code}:${err.message}`);
      throw err;
    }
    // Acquired-note aggregation is additive — if it fails, log and
    // continue with the originated-only set rather than failing the whole
    // batch. The error is surfaced so a follow-up regeneration can fix it.
    logger.error("form1099Batch.acquiredNotesAggregationFailed", err instanceof Error ? err : undefined);
    errors.push(`acquired_notes:${err instanceof Error ? err.message : String(err)}`);
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

// ─── Acquired-note 1099 assembly ──────────────────────────────────────────

/**
 * Build Form1099Int records from acquired-note interest aggregations.
 *
 * Mirrors generate1099IntForms() in shape but pulls income from the
 * note_payments ledger via aggregateAcquiredNoteInterestForYear(). Threshold
 * filter ($600 min for 1099-INT issuance) is applied here to match the
 * originated-note path; sub-threshold rows are dropped.
 *
 * Throws TaxIdentityError when payer (org) identity is missing — same
 * contract as generate1099IntForms() so the route handler's failure path
 * stays uniform.
 */
async function buildFormsFromAcquiredNotes(
  orgId: number,
  taxYear: number,
): Promise<Form1099Int[]> {
  const aggregations = await aggregateAcquiredNoteInterestForYear(orgId, taxYear);
  if (aggregations.length === 0) return [];

  // Resolve org / payer identity. Mirrors generate1099IntForms() — same
  // bail conditions, same encrypted-EIN decode path.
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) {
    throw new TaxIdentityError(
      "PAYER_NAME_MISSING",
      `Organization ${orgId} not found — cannot issue 1099-INTs.`,
      { orgId },
    );
  }
  const payerName = org.legalEntityName?.trim() || org.name?.trim();
  if (!payerName) {
    throw new TaxIdentityError(
      "PAYER_NAME_MISSING",
      `Organization ${orgId} has no legal entity name — required for 1099-INT.`,
      { orgId },
    );
  }
  if (!org.ein) {
    throw new TaxIdentityError(
      "PAYER_EIN_MISSING",
      `Organization ${orgId} has no EIN on file — capture it during onboarding before issuing 1099s.`,
      { orgId },
    );
  }
  const payerTin = isAnyEncryptedEnvelope(org.ein) ? decryptField(org.ein) : org.ein;
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

  const forms: Form1099Int[] = [];
  for (const a of aggregations) {
    const interestDollars = a.interestCents / 100;
    // 1099-INT threshold: only issue when interest paid is $600+. The
    // originated-note path applies the same threshold via
    // generateAnnualInterestReport().
    if (interestDollars < 600) continue;

    if (!a.payerEncryptedTin) {
      throw new TaxIdentityError(
        "RECIPIENT_TIN_MISSING",
        `Acquired note ${a.noteNumber} (payer "${a.payerName}") has no TIN — collect a W-9 before generating a 1099-INT.`,
        { orgId },
      );
    }
    const recipientTin = isAnyEncryptedEnvelope(a.payerEncryptedTin)
      ? decryptField(a.payerEncryptedTin)
      : a.payerEncryptedTin;
    const recipientTinType = (a.payerTinType as Form1099Int["recipientTinType"]) || "SSN";

    forms.push({
      taxYear,
      // Distinct prefix from originated NOTE-{id} so audit trails keep them
      // separable on the 1099 PDF + FIRE record.
      accountNumber: `ANOTE-${a.noteNumber}`,
      payerName,
      payerAddress,
      payerPhone,
      payerTin,
      payerTinType,
      recipientName: a.payerName,
      recipientAddress: {
        line1: a.payerAddress?.line1 || "",
        city: a.payerAddress?.city || "",
        state: a.payerAddress?.state || "",
        zip: a.payerAddress?.zip || "",
      },
      recipientTin,
      recipientTinType,
      box1_interestIncome: Math.round(interestDollars * 100) / 100,
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
    });
  }
  return forms;
}

/**
 * Merge two Form1099Int sets by (recipientName, recipientTin). When the
 * same recipient appears in both sources (rare — implies an org both
 * originated AND later re-acquired a note, OR has split portfolios where
 * the same borrower owes on multiple notes), interest sums into a single
 * form rather than emitting two 1099s for the same recipient.
 */
function mergeFormsByRecipient(
  originated: Form1099Int[],
  acquired: Form1099Int[],
): Form1099Int[] {
  const key = (f: Form1099Int) => `${f.recipientTin}::${f.recipientName.toLowerCase().trim()}`;
  const merged = new Map<string, Form1099Int>();
  for (const f of originated) merged.set(key(f), f);
  for (const f of acquired) {
    const existing = merged.get(key(f));
    if (existing) {
      existing.box1_interestIncome =
        Math.round((existing.box1_interestIncome + f.box1_interestIncome) * 100) / 100;
      // Append acquired account-number so the audit shows the combined
      // sources on the 1099 PDF.
      if (!existing.accountNumber.includes(f.accountNumber)) {
        existing.accountNumber = `${existing.accountNumber}+${f.accountNumber}`;
      }
    } else {
      merged.set(key(f), f);
    }
  }
  return Array.from(merged.values());
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
