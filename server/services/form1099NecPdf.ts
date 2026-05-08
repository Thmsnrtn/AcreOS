/**
 * 1099-NEC PDF generator (FF-3).
 *
 * Devon §4: "1099-NEC for every sub I paid >$600 — Fail. […] No
 * contractor entity, no W-9 storage, no YTD totals, no form generator.
 * This is my single biggest tax workflow and it's missing." Plus:
 * "1099-MISC is the wrong form for contractor labor — that's been
 * 1099-NEC since 2020. The compliance page is dated."
 *
 * IRS Form 1099-NEC (2025 box layout):
 *   Box 1: Nonemployee compensation
 *   Box 4: Federal income tax withheld
 *   Box 5: State tax withheld (free text)
 *   Box 6: State / Payer's state no.
 *   Box 7: State income
 *
 * This v1 generator emits a "Recipient Copy B" style PDF — not the
 * pre-printed-form-aligned Copy A used for paper IRS filing. Copy A
 * filing requires the official red-ink 1096 transmittal forms or e-file
 * via the IRS FIRE system (or IRIS for 2024+). The existing
 * server/services/form1099Batch.ts FIRE pipeline can be extended to
 * NEC in a follow-on workstream; this PR ships the recipient-copy PDF +
 * batch generator so flippers can mail copies to their subs in January.
 */

import { jsPDF } from "jspdf";

export interface Nec1099Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface Nec1099Payer {
  name: string;
  address: Nec1099Address;
  phone?: string;
  taxIdMasked: string;            // "XX-XXXX1234" — last 4 only
}

export interface Nec1099Recipient {
  name: string;
  legalEntityName?: string;       // Box 1 line 1 if business
  address: Nec1099Address;
  taxIdMasked: string;            // "XXX-XX-1234"
}

export interface Nec1099Form {
  taxYear: number;
  payer: Nec1099Payer;
  recipient: Nec1099Recipient;
  nonemployeeCompensationCents: number;  // Box 1
  federalTaxWithheldCents?: number;      // Box 4
  stateTaxWithheldCents?: number;        // Box 5
  payerStateNumber?: string;             // Box 6
  stateIncomeCents?: number;             // Box 7
  accountNumber?: string;
  isCorrected?: boolean;
}

function fmtUsd(cents: number | undefined): string {
  if (!cents && cents !== 0) return "0.00";
  const dollars = cents / 100;
  return dollars.toFixed(2);
}

function addAddressBlock(doc: jsPDF, address: Nec1099Address, x: number, y: number): number {
  const lines = [
    address.line1,
    address.line2 ?? "",
    `${address.city}, ${address.state} ${address.zip}`,
  ].filter(Boolean);
  for (const line of lines) {
    doc.text(line, x, y);
    y += 4;
  }
  return y;
}

/**
 * Generate a single 1099-NEC PDF as a Buffer. Format approximates the
 * IRS Copy B (recipient copy) layout — for record-keeping and recipient
 * mailing, NOT for paper filing with the IRS (which requires the red-ink
 * Copy A scannable form).
 */
export function generate1099NecPdf(form: Nec1099Form): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const margin = 12;
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(`Form 1099-NEC ${form.taxYear}`, margin, margin + 6);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Nonemployee Compensation", margin, margin + 11);
  doc.text("Copy B — For Recipient", pageWidth - margin, margin + 11, { align: "right" });

  if (form.isCorrected) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 0, 0);
    doc.text("CORRECTED", pageWidth - margin, margin + 6, { align: "right" });
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
  }

  // Payer block
  let y = margin + 22;
  doc.setFont("helvetica", "bold");
  doc.text("PAYER:", margin, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text(form.payer.name, margin, y); y += 4;
  y = addAddressBlock(doc, form.payer.address, margin, y);
  if (form.payer.phone) { doc.text(`Phone: ${form.payer.phone}`, margin, y); y += 4; }
  doc.text(`Payer's TIN: ${form.payer.taxIdMasked}`, margin, y); y += 6;

  // Recipient block — right column
  let yR = margin + 22;
  doc.setFont("helvetica", "bold");
  doc.text("RECIPIENT:", pageWidth / 2 + 5, yR);
  yR += 4;
  doc.setFont("helvetica", "normal");
  doc.text(form.recipient.legalEntityName ?? form.recipient.name, pageWidth / 2 + 5, yR); yR += 4;
  if (form.recipient.legalEntityName && form.recipient.legalEntityName !== form.recipient.name) {
    doc.text(form.recipient.name, pageWidth / 2 + 5, yR); yR += 4;
  }
  yR = addAddressBlock(doc, form.recipient.address, pageWidth / 2 + 5, yR);
  doc.text(`Recipient's TIN: ${form.recipient.taxIdMasked}`, pageWidth / 2 + 5, yR); yR += 4;
  if (form.accountNumber) { doc.text(`Account #: ${form.accountNumber}`, pageWidth / 2 + 5, yR); yR += 4; }

  // Boxes — single column, labeled
  y = Math.max(y, yR) + 8;
  doc.setDrawColor(0);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Box 1 — Nonemployee compensation:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(`$${fmtUsd(form.nonemployeeCompensationCents)}`, pageWidth - margin, y, { align: "right" });
  y += 6;

  if (form.federalTaxWithheldCents !== undefined) {
    doc.setFont("helvetica", "bold");
    doc.text("Box 4 — Federal income tax withheld:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(`$${fmtUsd(form.federalTaxWithheldCents)}`, pageWidth - margin, y, { align: "right" });
    y += 6;
  }

  if (form.stateTaxWithheldCents !== undefined) {
    doc.setFont("helvetica", "bold");
    doc.text("Box 5 — State tax withheld:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(`$${fmtUsd(form.stateTaxWithheldCents)}`, pageWidth - margin, y, { align: "right" });
    y += 6;
  }

  if (form.payerStateNumber) {
    doc.setFont("helvetica", "bold");
    doc.text("Box 6 — State/Payer's state no.:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(form.payerStateNumber, pageWidth - margin, y, { align: "right" });
    y += 6;
  }

  if (form.stateIncomeCents !== undefined) {
    doc.setFont("helvetica", "bold");
    doc.text("Box 7 — State income:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(`$${fmtUsd(form.stateIncomeCents)}`, pageWidth - margin, y, { align: "right" });
    y += 6;
  }

  // Footer disclaimer
  y += 10;
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(
    "This is the recipient copy. It is not valid for filing with the IRS — paper filing requires the red-ink Copy A scannable form, or use IRS FIRE / IRIS for electronic filing.",
    margin, y, { maxWidth: pageWidth - 2 * margin },
  );
  y += 6;
  doc.text(
    `Generated by AcreOS for tax year ${form.taxYear}. Verify all figures match your books before filing.`,
    margin, y, { maxWidth: pageWidth - 2 * margin },
  );

  return Buffer.from(doc.output("arraybuffer"));
}
