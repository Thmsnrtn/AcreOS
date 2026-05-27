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
  // Set when reconciliation passes; null otherwise. Callers should
  // only ship statements when this is present and `variances` is empty.
  reconciliation?: InvestorStatementReconciliation | null;
}

// ── Reconciliation gate (Rachel) ──────────────────────────────────────────
// Rachel: "Statements that don't reconcile to the underlying ledger are
// statements I have to chase down in February. Refuse to email anything
// when the per-LP sum diverges from what was actually paid to me. Rare
// functionality; harden it." See `reconcileInvestorStatements` below.
// ──────────────────────────────────────────────────────────────────────────
export interface ReconciliationVariance {
  noteId: string;
  noteNumber: string;
  payerName: string;
  notePaymentsInterestCents: number;   // SUM(notePayments.interestCents) in period
  totalLpBps: number;                  // SUM(role='lp' percentageBps) on the note
  expectedLpInterestCents: number;     // payments × totalLpBps / 10000
  actualLpInterestCents: number;       // SUM(per-LP shares we computed)
  varianceCents: number;               // actual - expected (signed)
  reason: string;
}

export interface InvestorStatementReconciliation {
  ok: boolean;
  toleranceCents: number;
  variances: ReconciliationVariance[];
  checkedNotes: number;
}

// Tolerance for per-note variance after the bps→cents rounding round-trip.
// Per-LP shares are `Math.round(noteInterest * bps / 10000)` so each note
// can drift by up to N-1 cents where N is the number of LPs on that note.
// We allow 5¢ per note as a practical headroom — anything beyond that is
// a real divergence (e.g. an unposted reversal, a stale split row).
const RECONCILIATION_TOLERANCE_CENTS_PER_NOTE = 5;

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

/**
 * Per-note reconciliation: for each note that has LP slices in `statements`,
 * the sum of per-LP interest cents should equal (notePaymentsInterest ×
 * totalLpBps / 10000), within a small rounding tolerance. If anything
 * drifts beyond that, we refuse to emit PDFs.
 *
 * Rachel: "If the LP statement doesn't tie to what was actually applied to
 * that note, I'm shipping a misstatement. Bigger funds get sued for that."
 */
export async function reconcileInvestorStatements(
  orgId: number,
  taxYear: number,
  statements: InvestorStatement[],
): Promise<InvestorStatementReconciliation> {
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Build expected-vs-actual map per note from the in-memory statements.
  // Actual: sum of investorShareCents across all LPs for the note.
  // Expected: notePaymentsInterestCents × totalLpBps / 10000.
  const actualByNote = new Map<string, { actual: number; payerName: string; noteNumber: string }>();
  for (const stmt of statements) {
    for (const line of stmt.perNote) {
      const cur = actualByNote.get(line.noteId) ?? {
        actual: 0,
        payerName: line.payerName,
        noteNumber: line.noteNumber,
      };
      cur.actual += line.investorShareCents;
      actualByNote.set(line.noteId, cur);
    }
  }

  if (actualByNote.size === 0) {
    return { ok: true, toleranceCents: 0, variances: [], checkedNotes: 0 };
  }

  // Pull authoritative per-note interest sums + total LP bps from the DB,
  // for ONLY the notes that have LP slices. We avoid trusting the join in
  // aggregateInvestorIncomeForYear() — the reconciler reads each side
  // independently so it can catch bugs in that aggregation, not validate
  // itself against itself.
  const noteIds = Array.from(actualByNote.keys());
  const sums = await db
    .select({
      noteId: acquiredNotes.id,
      noteNumber: acquiredNotes.noteNumber,
      payerName: acquiredNotes.payerName,
      interestSumCents: sql<number>`COALESCE(SUM(${notePayments.interestCents}), 0)::bigint`,
    })
    .from(acquiredNotes)
    .leftJoin(
      notePayments,
      and(
        eq(notePayments.noteId, acquiredNotes.id),
        sql`${notePayments.paymentDate} >= ${yearStart}`,
        sql`${notePayments.paymentDate} <= ${yearEnd}`,
      ),
    )
    .where(
      and(
        eq(acquiredNotes.organizationId, orgId),
        sql`${acquiredNotes.id} = ANY(${sql.raw(`ARRAY[${noteIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]`)}::varchar[])`,
      ),
    )
    .groupBy(acquiredNotes.id, acquiredNotes.noteNumber, acquiredNotes.payerName);

  const lpBpsRows = await db
    .select({
      noteId: noteOwnershipSplits.noteId,
      totalLpBps: sql<number>`COALESCE(SUM(${noteOwnershipSplits.percentageBps}), 0)::int`,
    })
    .from(noteOwnershipSplits)
    .where(
      and(
        eq(noteOwnershipSplits.organizationId, orgId),
        eq(noteOwnershipSplits.role, "lp"),
        sql`${noteOwnershipSplits.noteId} = ANY(${sql.raw(`ARRAY[${noteIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]`)}::varchar[])`,
      ),
    )
    .groupBy(noteOwnershipSplits.noteId);

  const lpBpsByNote = new Map<string, number>();
  for (const r of lpBpsRows) lpBpsByNote.set(r.noteId, Number(r.totalLpBps));

  const variances: ReconciliationVariance[] = [];
  let totalChecked = 0;

  for (const row of sums) {
    const actualEntry = actualByNote.get(row.noteId);
    if (!actualEntry) continue;
    totalChecked++;
    const notePaymentsInterestCents = Number(row.interestSumCents);
    const totalLpBps = lpBpsByNote.get(row.noteId) ?? 0;
    const expectedLpInterestCents = Math.round((notePaymentsInterestCents * totalLpBps) / 10_000);
    const varianceCents = actualEntry.actual - expectedLpInterestCents;
    if (Math.abs(varianceCents) > RECONCILIATION_TOLERANCE_CENTS_PER_NOTE) {
      let reason = "Per-LP sum diverges from note's applied interest";
      if (totalLpBps === 0) {
        // We have a statement for an LP on this note but the splits table
        // shows zero LP bps — the split row was deleted between
        // aggregation and reconciliation, or the role flipped to 'org'.
        reason = "Note has per-LP statement rows but no role='lp' splits";
      } else if (notePaymentsInterestCents === 0 && actualEntry.actual !== 0) {
        reason = "Statement attributes interest to LPs but note has no payments in period";
      }
      variances.push({
        noteId: row.noteId,
        noteNumber: row.noteNumber,
        payerName: row.payerName,
        notePaymentsInterestCents,
        totalLpBps,
        expectedLpInterestCents,
        actualLpInterestCents: actualEntry.actual,
        varianceCents,
        reason,
      });
    }
  }

  return {
    ok: variances.length === 0,
    toleranceCents: RECONCILIATION_TOLERANCE_CENTS_PER_NOTE,
    variances,
    checkedNotes: totalChecked,
  };
}

export async function generateInvestorStatementBatch(
  orgId: number,
  orgName: string,
  taxYear: number,
): Promise<InvestorStatementBatchResult> {
  const statements = await aggregateInvestorIncomeForYear(orgId, taxYear);
  const totalInvestorInterestCents = statements.reduce((s, x) => s + x.totalInterestCents, 0);

  // ── Reconciliation gate ───────────────────────────────────────────────
  // Rachel: refuse to render PDFs when the per-LP sum doesn't reconcile to
  // the underlying ledger. Surface the variance so the operator can fix
  // the split rows (or post the missing payment) before sending anything.
  const reconciliation = await reconcileInvestorStatements(orgId, taxYear, statements);
  if (!reconciliation.ok) {
    logger.error(
      "investorStatement.batch.reconciliation_failed",
      new Error(`Statement batch refused: ${reconciliation.variances.length} note(s) failed reconciliation`),
      {
        metadata: {
          orgId,
          taxYear,
          variances: reconciliation.variances.length,
          checkedNotes: reconciliation.checkedNotes,
          firstVariance: reconciliation.variances[0],
        },
      },
    );
    return {
      taxYear,
      statements,
      totalInvestorInterestCents,
      pdfs: [], // intentionally empty — caller MUST NOT email these.
      reconciliation,
    };
  }

  const pdfs = statements.map((stmt) => {
    const { pdfBase64 } = renderInvestorStatementPdf(taxYear, orgName, stmt);
    return {
      investorName: stmt.investorName,
      pdfBase64,
      totalCents: stmt.totalInterestCents,
    };
  });
  logger.info("investorStatement.batch.completed", {
    metadata: { orgId, taxYear, statements: statements.length, total: totalInvestorInterestCents, reconciledNotes: reconciliation.checkedNotes },
  });
  return { taxYear, statements, totalInvestorInterestCents, pdfs, reconciliation };
}
