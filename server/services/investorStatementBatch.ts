/**
 * Per-investor income statement batch generator.
 *
 * Linnea: "When three investors share a note 50/30/20, AcreOS computes
 * each investor's share of every payment, generates per-investor
 * 1099-INTs, and produces a per-investor basis schedule. Without this,
 * pool tracking lives in Excel forever."
 *
 * Note on the form choice: pool structure (multi-member LLC vs.
 * partnership-with-pass-through) determines whether the holder issues
 * 1099-INTs or K-1s to its LPs. We don't presume; the per-investor
 * statement here is shaped like a 1099-INT (interest income summary)
 * but labeled "Investor Statement" so the user / their CPA decides
 * the filing form. Both starting points carry the same numeric
 * content.
 *
 * Aggregation strategy:
 *   For each (note, year) with non-zero interest:
 *     For each ownership split row of that note:
 *       LP_interest_cents += note.year_interest * split.percentageBps / 10000
 *
 * Rolls up to one statement per (investor_email-or-name) per year, with
 * a per-note breakdown line.
 */

import { jsPDF } from "jspdf";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { acquiredNotes, notePayments, noteOwnershipSplits } from "@shared/schema";
import { logger } from "../utils/logger";

interface PerNoteLine {
  noteId: string;
  noteNumber: string;
  payerName: string;
  noteYearInterestCents: number;
  percentageBps: number;
  investorShareCents: number;
}

interface InvestorStatement {
  investorName: string;
  investorEmail: string | null;
  totalInterestCents: number;
  perNote: PerNoteLine[];
}

export interface InvestorStatementBatchResult {
  taxYear: number;
  statements: InvestorStatement[];
  totalInvestorInterestCents: number;
  pdfs: Array<{ investorName: string; pdfBase64: string; totalCents: number }>;
}

/**
 * Compute per-investor splits for an org / year. Returns one row per
 * investor (keyed by email when present, falling back to name) with a
 * per-note breakdown.
 */
export async function aggregateInvestorIncomeForYear(
  orgId: number,
  taxYear: number,
): Promise<InvestorStatement[]> {
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Pull all (split, note) pairs joined with the year's interest sum on
  // each note. Notes without splits don't contribute to LP statements;
  // they're 100% org-owned and the borrower 1099-INT covers the org's
  // bookkeeping. We only emit LP statements for notes that have at
  // least one split row with role='lp'.
  const rows = await db
    .select({
      investorName: noteOwnershipSplits.investorName,
      investorEmail: noteOwnershipSplits.investorEmail,
      role: noteOwnershipSplits.role,
      percentageBps: noteOwnershipSplits.percentageBps,
      noteId: acquiredNotes.id,
      noteNumber: acquiredNotes.noteNumber,
      payerName: acquiredNotes.payerName,
      noteYearInterestCents: sql<number>`COALESCE(SUM(${notePayments.interestCents}) OVER (PARTITION BY ${acquiredNotes.id}), 0)::bigint`,
    })
    .from(noteOwnershipSplits)
    .innerJoin(acquiredNotes, eq(acquiredNotes.id, noteOwnershipSplits.noteId))
    .leftJoin(
      notePayments,
      and(
        eq(notePayments.noteId, acquiredNotes.id),
        sql`${notePayments.paymentDate} >= ${yearStart}`,
        sql`${notePayments.paymentDate} <= ${yearEnd}`,
      ),
    )
    .where(eq(noteOwnershipSplits.organizationId, orgId));

  // Dedup the rows (the join with note_payments multiplies). The window
  // function makes noteYearInterestCents stable per note, so we can dedupe
  // on (noteId, splitId-shaped-key).
  const dedup = new Map<string, typeof rows[0]>();
  for (const r of rows) {
    const key = `${r.noteId}|${r.investorName}|${r.investorEmail ?? ""}|${r.percentageBps}`;
    if (!dedup.has(key)) dedup.set(key, r);
  }
  const uniqueRows = Array.from(dedup.values());

  // Group by investor (email-or-name).
  const byInvestor = new Map<string, InvestorStatement>();
  for (const r of uniqueRows) {
    if (r.role === "org") continue; // Org's own slice doesn't generate LP statement
    const investorInterest = Math.round(
      (Number(r.noteYearInterestCents) * r.percentageBps) / 10_000,
    );
    if (investorInterest === 0) continue;

    const key = r.investorEmail || r.investorName;
    let stmt = byInvestor.get(key);
    if (!stmt) {
      stmt = {
        investorName: r.investorName,
        investorEmail: r.investorEmail,
        totalInterestCents: 0,
        perNote: [],
      };
      byInvestor.set(key, stmt);
    }
    stmt.totalInterestCents += investorInterest;
    stmt.perNote.push({
      noteId: r.noteId,
      noteNumber: r.noteNumber,
      payerName: r.payerName,
      noteYearInterestCents: Number(r.noteYearInterestCents),
      percentageBps: r.percentageBps,
      investorShareCents: investorInterest,
    });
  }

  return Array.from(byInvestor.values()).sort((a, b) => b.totalInterestCents - a.totalInterestCents);
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Render a one-page statement PDF for a single investor. Same render
 * pattern as services/form1099Batch.ts and services/noteAssignmentPdf.ts
 * (jsPDF, base64 output).
 */
export function renderInvestorStatementPdf(
  taxYear: number,
  orgName: string,
  statement: InvestorStatement,
): { pdfBase64: string; bytes: number } {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`${taxYear} INVESTOR STATEMENT — INTEREST INCOME`, 306, 60, { align: "center" });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text(
    "Per-investor share of interest income for tax year. Use this with your CPA",
    306, 78, { align: "center" },
  );
  doc.text(
    "to file the appropriate form (1099-INT or K-1 depending on pool structure).",
    306, 92, { align: "center" },
  );

  let y = 120;
  const left = 60;
  const lineHeight = 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("ISSUED BY", left, y); y += lineHeight;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(orgName, left, y); y += lineHeight + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("ISSUED TO", left, y); y += lineHeight;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(statement.investorName, left, y); y += lineHeight;
  if (statement.investorEmail) {
    doc.text(statement.investorEmail, left, y);
    y += lineHeight;
  }
  y += 16;

  // Big total
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Total interest income (Tax Year ${taxYear})`, left, y); y += lineHeight;
  doc.setFontSize(20);
  doc.text(fmtUsd(statement.totalInterestCents), left, y);
  y += 30;

  // Per-note breakdown
  doc.setFontSize(11);
  doc.text("Per-note breakdown", left, y); y += lineHeight + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Note", left, y);
  doc.text("Borrower", left + 110, y);
  doc.text("Note YTD interest", left + 250, y);
  doc.text("Your share", left + 360, y);
  doc.text("Your interest", left + 430, y);
  y += lineHeight;
  doc.line(left, y - 4, left + 510, y - 4);

  doc.setFont("helvetica", "normal");
  for (const line of statement.perNote) {
    doc.text(line.noteNumber, left, y);
    doc.text(line.payerName.length > 20 ? line.payerName.slice(0, 20) + "…" : line.payerName, left + 110, y);
    doc.text(fmtUsd(line.noteYearInterestCents), left + 250, y);
    doc.text(fmtPct(line.percentageBps), left + 360, y);
    doc.text(fmtUsd(line.investorShareCents), left + 430, y);
    y += lineHeight;
    if (y > 720) {
      doc.addPage();
      y = 60;
    }
  }

  y += 12;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.text(
    "This statement reflects per-payment ledger data as of the issue date. Verify with your CPA before filing.",
    left, y,
  );

  const buffer: ArrayBuffer = doc.output("arraybuffer");
  const bytes = buffer.byteLength;
  const pdfBase64 = Buffer.from(buffer).toString("base64");
  return { pdfBase64, bytes };
}

export async function generateInvestorStatementBatch(
  orgId: number,
  orgName: string,
  taxYear: number,
): Promise<InvestorStatementBatchResult> {
  const statements = await aggregateInvestorIncomeForYear(orgId, taxYear);
  const totalInvestorInterestCents = statements.reduce((s, x) => s + x.totalInterestCents, 0);
  const pdfs = statements.map((stmt) => {
    const { pdfBase64 } = renderInvestorStatementPdf(taxYear, orgName, stmt);
    return {
      investorName: stmt.investorName,
      pdfBase64,
      totalCents: stmt.totalInterestCents,
    };
  });
  logger.info("investorStatement.batch.completed", {
    metadata: { orgId, taxYear, statements: statements.length, total: totalInvestorInterestCents },
  });
  return { taxYear, statements, totalInvestorInterestCents, pdfs };
}
