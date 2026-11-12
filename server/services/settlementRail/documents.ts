/**
 * Settlement & Documents Rail — money-moment document generation.
 *
 * The document ENGINE was never the gap (server/services/documents.ts, the
 * contract chain, the assignment PDF all exist); the gap was the specific
 * documents the money moments need (sweep (c) §9, component 1). This module
 * is where those documents live, one generator per RAIL_DOCUMENT_KINDS
 * entry, each a pure function of a model the caller assembled from the
 * record of truth:
 *
 *   payoff_letter — rendered from a RECORDED `note_payoff_quotes` row and
 *                   nothing else, so the letter can never disagree with the
 *                   quote the borrower was given (the same discipline as
 *                   routes-borrower.ts's quote PDF — the letter is the
 *                   formal, deliverable artifact built on that row).
 *   lien_release  — the satisfaction / release that frees the title when a
 *                   note pays off, generated from the note + collateral
 *                   record; its recording life is tracked by the rail's
 *                   recording-status component, not by this generator.
 *
 * Every generator returns BOTH the letter HTML (the mail lanes print HTML —
 * the house lane renders, counts and charges for exactly that HTML) and a
 * PDF (the download artifact). Both render the same model, so their figures
 * cannot diverge. Nothing here sends, charges, or writes a row.
 */

import { jsPDF } from "jspdf";
import type { NotePayoffQuote } from "@shared/schema";
import { RAIL_DOCUMENT_KINDS, RAIL_DOCUMENT_LABELS, type RailDocumentKind } from "@shared/settlement-rail";
import { clock } from "../../utils/clock";

export interface RailDocumentArtifact {
  kind: RailDocumentKind;
  filename: string;
  /** The letter HTML the physical-mail lanes print. */
  html: string;
  /** The download artifact. */
  pdf: Buffer;
}

const dollars = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const escapeHtml = (t: string): string =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function pdfFromLines(title: string, lines: string[]): Buffer {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(title, 20, 20);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  let y = 34;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, 170) as string[];
    for (const w of wrapped) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(w, 20, y);
      y += 6;
    }
    y += 2;
  }
  return Buffer.from(doc.output("arraybuffer"));
}

/** Which kinds the rail can generate — the registry the routes resolve against. */
const RAIL_DOCUMENT_GENERATORS: Readonly<Record<RailDocumentKind, { label: string; recordable: boolean }>> = {
  payoff_letter: { label: RAIL_DOCUMENT_LABELS.payoff_letter, recordable: false },
  lien_release: { label: RAIL_DOCUMENT_LABELS.lien_release, recordable: true },
};

// The registry must cover the shared vocabulary exactly: a kind added to
// shared/settlement-rail.ts without a generator fails at module load, not
// on a user's money moment. (The unit suite pins the same equality.)
for (const kind of RAIL_DOCUMENT_KINDS) {
  if (!RAIL_DOCUMENT_GENERATORS[kind]) {
    throw new Error(`settlement rail: no generator registered for document kind "${kind}"`);
  }
}

// ── Payoff letter (sweep item N-1) ───────────────────────────────────────────

export interface PayoffLetterModel {
  /** The recorded quote — the ONLY source of figures on the letter. */
  quote: NotePayoffQuote;
  /** The lender/servicer name on the letterhead and signature block. */
  lenderName: string;
  /** Addressee. Falls back to the quote's recorded payer name. */
  borrowerName: string | null;
  /** Collateral address line, when the note's property is known. */
  propertyAddress: string | null;
  /** Where payoff funds go, as the lender instructs — never AcreOS. */
  paymentInstructions: string | null;
}

export function buildPayoffLetter(model: PayoffLetterModel): RailDocumentArtifact {
  const q = model.quote;
  const borrower = model.borrowerName ?? q.payerName ?? "Borrower";
  const letterDate = clock.now().toISOString().slice(0, 10);
  const breakdown: Array<[string, string]> = [
    ["Remaining principal", dollars(q.principalBalanceCents)],
    [
      `Accrued interest (${q.daysAccrued} days from ${q.accrualStartDate}, ${q.dayCountConvention})`,
      dollars(q.accruedInterestCents),
    ],
    ...(q.unappliedCreditCents > 0 ? [["Unapplied credit", `-${dollars(q.unappliedCreditCents)}`] as Array<[string, string]>] : []),
    ["Late fees owed", dollars(q.lateFeesOutstandingCents)],
    ["Payoff fee", dollars(q.payoffFeeCents)],
  ];
  const lines = [
    `${model.lenderName}`,
    ``,
    `${letterDate}`,
    ``,
    `${borrower}`,
    ...(model.propertyAddress ? [`Property: ${model.propertyAddress}`] : []),
    `Note reference: ${q.noteNumber ?? q.noteRef}`,
    `Quote reference: ${q.id}`,
    ``,
    `Dear ${borrower},`,
    ``,
    `This letter states the amount required to pay your note in full on ${q.payoffDate}. ` +
      `The total below is good through ${q.goodThroughDate}. Interest accrues at ${dollars(q.perDiemInterestCents)} ` +
      `per day after that date; contact us for an updated quote if you will pay later.`,
    ``,
    ...breakdown.map(([k, v]) => `${k}:  ${v}`),
    ``,
    `Total payoff amount:  ${dollars(q.totalPayoffCents)}`,
    ``,
    model.paymentInstructions
      ? `Payment instructions: ${model.paymentInstructions}`
      : `Payment instructions: please contact your lender for wire transfer or payment instructions. ` +
        `Funds are payable to your lender directly — AcreOS does not receive or hold payoff funds.`,
    ``,
    `When the payoff is received, the lien securing this note will be released of record.`,
    ``,
    `Sincerely,`,
    `${model.lenderName}`,
  ];
  const rowsHtml = breakdown.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v}</td></tr>`).join("");
  const html =
    `<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; line-height: 1.5;">` +
    `<h2>${escapeHtml(model.lenderName)}</h2>` +
    `<p>${letterDate}</p>` +
    `<p>${escapeHtml(borrower)}<br>` +
    (model.propertyAddress ? `Property: ${escapeHtml(model.propertyAddress)}<br>` : "") +
    `Note reference: ${escapeHtml(q.noteNumber ?? q.noteRef)}<br>Quote reference: ${escapeHtml(q.id)}</p>` +
    `<p>Dear ${escapeHtml(borrower)},</p>` +
    `<p>This letter states the amount required to pay your note in full on ${q.payoffDate}. ` +
    `The total below is good through ${q.goodThroughDate}. Interest accrues at ${dollars(q.perDiemInterestCents)} ` +
    `per day after that date; contact us for an updated quote if you will pay later.</p>` +
    `<table style="width:100%; border-collapse: collapse;">${rowsHtml}` +
    `<tr><td><strong>Total payoff amount</strong></td><td style="text-align:right"><strong>${dollars(q.totalPayoffCents)}</strong></td></tr></table>` +
    (model.paymentInstructions
      ? `<p>Payment instructions: ${escapeHtml(model.paymentInstructions)}</p>`
      : `<p>Payment instructions: please contact your lender for wire transfer or payment instructions. ` +
        `Funds are payable to your lender directly — AcreOS does not receive or hold payoff funds.</p>`) +
    `<p>When the payoff is received, the lien securing this note will be released of record.</p>` +
    `<p>Sincerely,<br>${escapeHtml(model.lenderName)}</p></div>`;
  return {
    kind: "payoff_letter",
    filename: `payoff-letter-${q.noteRef}-${q.id}.pdf`,
    html,
    pdf: pdfFromLines("Payoff Letter", lines),
  };
}

// ── Lien release / satisfaction (sweep item N-2) ─────────────────────────────

export interface LienReleaseModel {
  /** The mortgagee/beneficiary releasing the lien (the lender of record). */
  lenderName: string;
  /** The mortgagor/grantor whose lien is released. */
  borrowerName: string;
  propertyAddress: string | null;
  legalDescription: string | null;
  county: string | null;
  state: string | null;
  /** The instrument number of the mortgage / deed of trust being released, when it was recorded. */
  originalInstrumentNumber: string | null;
  /** The date that instrument was recorded (ISO date), when known. */
  originalRecordingDate: string | null;
  /** The note's own date (ISO date), when known. */
  noteDate: string | null;
  /** The date the note was satisfied in full (ISO date). */
  payoffDate: string;
}

export function buildLienRelease(model: LienReleaseModel): RailDocumentArtifact {
  const releaseDate = clock.now().toISOString().slice(0, 10);
  const where = [model.county ? `${model.county} County` : null, model.state].filter(Boolean).join(", ");
  const lines = [
    `SATISFACTION OF MORTGAGE / RELEASE OF LIEN`,
    ``,
    `Prepared by and return to: ${model.lenderName}`,
    `Date: ${releaseDate}`,
    ``,
    `The undersigned, ${model.lenderName}, certifies that the mortgage / deed of trust ` +
      `executed by ${model.borrowerName}` +
      (model.noteDate ? `, dated ${model.noteDate}` : ``) +
      (model.originalRecordingDate ? `, recorded ${model.originalRecordingDate}` : ``) +
      (model.originalInstrumentNumber ? ` as Instrument No. ${model.originalInstrumentNumber}` : ``) +
      (where ? ` in the records of ${where}` : ``) +
      `, securing a note that has been SATISFIED IN FULL (payoff received ${model.payoffDate}), ` +
      `is hereby RELEASED, and the Clerk / Recorder is directed to discharge it of record.`,
    ``,
    ...(model.propertyAddress ? [`Property: ${model.propertyAddress}`] : []),
    ...(model.legalDescription ? [`Legal description: ${model.legalDescription}`] : []),
    ``,
    `___________________________________`,
    `${model.lenderName}`,
    `Date: ${releaseDate}`,
    ``,
    `State of ______________  County of ______________`,
    `Subscribed and sworn before me on ____________ by ______________________________.`,
    `Notary Public: ______________________________  My commission expires: ____________`,
  ];
  const html =
    `<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; line-height: 1.5;">` +
    `<h3>SATISFACTION OF MORTGAGE / RELEASE OF LIEN</h3>` +
    lines.slice(2).map((l) => (l === "" ? `<br>` : `<p>${escapeHtml(l)}</p>`)).join("") +
    `</div>`;
  return {
    kind: "lien_release",
    filename: `lien-release-${releaseDate}.pdf`,
    html,
    pdf: pdfFromLines("Satisfaction of Mortgage / Release of Lien", lines),
  };
}
