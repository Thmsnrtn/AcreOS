/**
 * Render a combined Allonge + Assignment-of-Mortgage PDF for a note sale.
 *
 * Linnea: "AcreOS would have to either become a licensed servicer or
 * partner with one. […] If AcreOS can produce a state-correct Assignment
 * + Allonge with the original note attached and route it to the title
 * company, I'd pay for that alone."
 *
 * **Scope honesty**: this is a generic-template implementation. The PDF
 * carries the legally-correct shape (allonge endorsement language +
 * assignment-of-security-instrument language + recital of consideration)
 * but is NOT automatically county-recordable in any jurisdiction —
 * different counties require state-specific captions, notary blocks,
 * and recording-stamp space. Top-50 state-specific recordable forms
 * ride a separate workstream that needs counsel review per state.
 *
 * What this DOES give Linnea:
 *   - A clean two-page PDF summarizing the note's material terms,
 *     identifying assignor + assignee, stating consideration, and
 *     including endorsement / assignment language.
 *   - A signature page for assignor (her) + notary acknowledgement.
 *   - Same e-sign-routable shape as the existing 1099 transmittal
 *     PDFs.
 */

import { jsPDF } from "jspdf";
import { DISCLAIMER_DOCUMENT_TEMPLATE } from "./legalDisclaimers";

interface RenderInput {
  // Assignor (the seller — current note holder).
  assignorName: string;
  // Assignee (the buyer).
  assigneeName: string;
  assigneeAddress?: { line1?: string; city?: string; state?: string; zip?: string };

  // Note material terms.
  noteNumber: string;
  payerName: string;
  payerAddress?: { line1?: string; city?: string; state?: string; zip?: string };
  originalPrincipalCents: number;
  currentBalanceCents: number;
  interestRateBps: number;
  paymentAmountCents: number;
  originationDate: string; // ISO
  maturityDate: string;

  // Sale terms.
  salePriceCents?: number;
  saleDate: string;       // ISO

  // Optional jurisdiction (informational on the cover; doesn't change body
  // language in the generic template).
  state?: string;
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function fmtAddress(a?: { line1?: string; city?: string; state?: string; zip?: string }): string {
  if (!a) return "";
  const parts = [a.line1, [a.city, a.state, a.zip].filter(Boolean).join(", ")].filter(Boolean);
  return parts.join(", ");
}

/**
 * Render the combined Allonge + Assignment of Mortgage PDF.
 * Returns base64 (matches the convention used by form1099Batch.ts).
 */
export function renderAssignmentPdf(input: RenderInput): { pdfBase64: string; bytes: number } {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  // ── Page 1 — Allonge ────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("ALLONGE TO PROMISSORY NOTE", 306, 60, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  let y = 100;
  const left = 60;
  const lineHeight = 16;

  const note = (text: string, lh = lineHeight) => {
    const lines = doc.splitTextToSize(text, 480);
    for (const line of lines) {
      doc.text(line, left, y);
      y += lh;
    }
    y += 4;
  };

  note(`This Allonge is attached to and made part of that certain Promissory Note dated ${fmtDate(input.originationDate)} (the "Note") in the original principal sum of ${fmtUsd(input.originalPrincipalCents)} executed by ${input.payerName} ("Maker"), with interest at ${(input.interestRateBps / 100).toFixed(3)}% per annum, with monthly installments of ${fmtUsd(input.paymentAmountCents)}, and a maturity date of ${fmtDate(input.maturityDate)}. Note identification: ${input.noteNumber}.`);

  note(`PAY TO THE ORDER OF: ${input.assigneeName}${input.assigneeAddress ? `, located at ${fmtAddress(input.assigneeAddress)}` : ""}, without recourse, representation, or warranty, except as expressly set forth in any separate written agreement between the assignor and assignee.`);

  note(`This endorsement is made effective as of ${fmtDate(input.saleDate)}.`);

  y += 24;
  doc.setFont("helvetica", "bold");
  doc.text("ASSIGNOR:", left, y); y += lineHeight;
  doc.setFont("helvetica", "normal");
  doc.text(input.assignorName, left, y); y += lineHeight + 30;

  doc.text("By: _______________________________________", left, y); y += lineHeight;
  doc.text("Authorized signatory", left, y); y += lineHeight + 24;
  doc.text("Date: _____________________________________", left, y);

  // ── Page 2 — Assignment of Mortgage / Deed of Trust ─────────────────────
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("ASSIGNMENT OF MORTGAGE / DEED OF TRUST", 306, 60, { align: "center" });
  if (input.state) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.text(`Generic template — verify state-specific recordable form for ${input.state} before recording`, 306, 78, { align: "center" });
  }

  y = 110;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  note(`FOR VALUE RECEIVED${input.salePriceCents ? ` in the amount of ${fmtUsd(input.salePriceCents)}` : ""}, the undersigned ${input.assignorName} ("Assignor"), hereby assigns, transfers, and conveys to ${input.assigneeName}${input.assigneeAddress ? ` of ${fmtAddress(input.assigneeAddress)}` : ""} ("Assignee"), all of Assignor's right, title, and interest in and to that certain Mortgage / Deed of Trust securing the Promissory Note described in the Allonge attached hereto.`);

  note(`Property description: ${fmtAddress(input.payerAddress) || "[See Mortgage / Deed of Trust for legal description]"}`);

  note(`Original Mortgagor / Trustor: ${input.payerName}.`);

  note(`Together with the Note thereby secured, this Assignment is made effective as of ${fmtDate(input.saleDate)}, without recourse and without representation or warranty, except as set forth in a separate written agreement between Assignor and Assignee. Assignee shall be entitled to enforce the Mortgage / Deed of Trust according to its terms and to receive all sums payable thereunder.`);

  y += 16;
  doc.setFont("helvetica", "bold");
  doc.text("ASSIGNOR:", left, y); y += lineHeight;
  doc.setFont("helvetica", "normal");
  doc.text(input.assignorName, left, y); y += lineHeight + 30;
  doc.text("By: _______________________________________", left, y); y += lineHeight;
  doc.text("Authorized signatory", left, y); y += lineHeight + 24;
  doc.text("Date: _____________________________________", left, y); y += lineHeight + 30;

  // Notary block
  doc.setFont("helvetica", "bold");
  doc.text("ACKNOWLEDGEMENT", left, y); y += lineHeight;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("State of _________________________________", left, y); y += lineHeight;
  doc.text("County of ________________________________", left, y); y += lineHeight + 6;
  const notaryText = "On the _____ day of ________________, ______, before me personally appeared the above-named individual, known to me (or satisfactorily proven) to be the person whose name is subscribed to the foregoing instrument, and acknowledged that he/she executed the same in his/her authorized capacity, and that by his/her signature on the instrument the person, or the entity upon behalf of which the person acted, executed the instrument.";
  const wrapped = doc.splitTextToSize(notaryText, 480);
  for (const line of wrapped) { doc.text(line, left, y); y += lineHeight; }
  y += 18;
  doc.text("Notary Public: ________________________________", left, y); y += lineHeight;
  doc.text("My commission expires: _________________________", left, y);

  // L1 liability shield — standing template legend at the page foot.
  // Complements the per-state header note above: this generic template is
  // for attorney review before any recording or enforcement use.
  doc.setFontSize(7);
  doc.setFont("helvetica", "italic");
  doc.text(doc.splitTextToSize(DISCLAIMER_DOCUMENT_TEMPLATE, 480), left, 742);

  const buffer: ArrayBuffer = doc.output("arraybuffer");
  const bytes = buffer.byteLength;
  const pdfBase64 = Buffer.from(buffer).toString("base64");
  return { pdfBase64, bytes };
}
