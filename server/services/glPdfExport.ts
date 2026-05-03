/**
 * General-Ledger PDF Export — Lavender Week 10.
 *
 * Renders the GL grouped by account with a running balance per account.
 * Uses jsPDF (the project's existing PDF stack — see
 * server/services/reportPdfService.ts for the precedent on
 * imports + colour palette). Returns a Buffer suitable for an
 * Express `res.send(buf)` with `Content-Type: application/pdf`.
 *
 * Layout
 * ──────
 *   Page header   — org name, "General Ledger", date range
 *   Per-account block:
 *     • account number + name (bold)
 *     • columns: Date | Description | Reference | Debit | Credit | Balance
 *     • zebra-striped rows
 *     • account-end totals
 *
 * Performance
 * ───────────
 * Single SQL pull of every entry in range, joined with chart_of_accounts
 * for display fields. We sort + group in-process so we don't have to push
 * SQL window functions through Drizzle.
 */

import { jsPDF } from "jspdf";
import { db } from "../db";
import { accountLedgerEntries, chartOfAccounts } from "@shared/schema";
import { and, asc, eq, gte, lte } from "drizzle-orm";

interface GLEntry {
  bookingDate: string;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  debitCents: number;
  creditCents: number;
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountType: string;
}

const PALETTE = {
  green: [30, 58, 30] as [number, number, number],
  gray: [80, 80, 80] as [number, number, number],
  dark: [40, 40, 40] as [number, number, number],
  light: [240, 240, 240] as [number, number, number],
  gold: [180, 160, 120] as [number, number, number],
};

function fmtCents(cents: number): string {
  if (cents === 0) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtCentsSigned(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Build the PDF buffer for the given org + date range.
 */
export async function generateGeneralLedgerPdf(args: {
  organizationId: number;
  organizationName: string;
  fromDate: Date | string;
  toDate: Date | string;
}): Promise<Buffer> {
  const fromIso =
    typeof args.fromDate === "string" ? args.fromDate : args.fromDate.toISOString().slice(0, 10);
  const toIso =
    typeof args.toDate === "string" ? args.toDate : args.toDate.toISOString().slice(0, 10);

  // Pull every entry in range with display fields. ORDER BY accountNumber
  // then bookingDate so the per-account block is sorted by date.
  const rows = await db
    .select({
      accountId: chartOfAccounts.id,
      accountNumber: chartOfAccounts.accountNumber,
      accountName: chartOfAccounts.accountName,
      accountType: chartOfAccounts.accountType,
      bookingDate: accountLedgerEntries.bookingDate,
      description: accountLedgerEntries.description,
      referenceType: accountLedgerEntries.referenceType,
      referenceId: accountLedgerEntries.referenceId,
      debitCents: accountLedgerEntries.debit,
      creditCents: accountLedgerEntries.credit,
    })
    .from(accountLedgerEntries)
    .innerJoin(chartOfAccounts, eq(accountLedgerEntries.accountId, chartOfAccounts.id))
    .where(
      and(
        eq(accountLedgerEntries.organizationId, args.organizationId),
        gte(accountLedgerEntries.bookingDate, fromIso),
        lte(accountLedgerEntries.bookingDate, toIso),
      ),
    )
    .orderBy(asc(chartOfAccounts.accountNumber), asc(accountLedgerEntries.bookingDate));

  const entries: GLEntry[] = rows.map((r) => ({
    accountId: r.accountId,
    accountNumber: r.accountNumber,
    accountName: r.accountName,
    accountType: r.accountType,
    bookingDate: r.bookingDate as unknown as string,
    description: r.description,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    debitCents: Number(r.debitCents),
    creditCents: Number(r.creditCents),
  }));

  // Group by account — preserve insertion order which is already sorted
  // by accountNumber thanks to the ORDER BY above.
  const byAccount = new Map<string, GLEntry[]>();
  for (const e of entries) {
    const list = byAccount.get(e.accountId) ?? [];
    list.push(e);
    byAccount.set(e.accountId, list);
  }

  // ── Render ────────────────────────────────────────────────────────────
  // Letter, portrait, inches.
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 0.5;
  let y = margin;

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PALETTE.green);
  doc.text("General Ledger", margin, y + 0.18);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...PALETTE.gray);
  doc.text(args.organizationName, margin, y + 0.42);
  doc.text(`${fromIso} — ${toIso}`, margin, y + 0.6);

  doc.setDrawColor(...PALETTE.gold);
  doc.setLineWidth(0.015);
  doc.line(margin, y + 0.75, pageW - margin, y + 0.75);
  y += 0.95;

  // Column layout (inches from left)
  const colDate = margin;
  const colDesc = margin + 0.85;
  const colRef = margin + 3.7;
  const colDebit = margin + 5.0;
  const colCredit = margin + 5.9;
  const colBalance = margin + 6.85;

  const ensureSpace = (need: number) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  for (const [accountId, accEntries] of byAccount) {
    const a = accEntries[0]!;
    ensureSpace(0.6);

    // Account header bar
    doc.setFillColor(...PALETTE.light);
    doc.rect(margin, y - 0.05, pageW - 2 * margin, 0.28, "F");
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...PALETTE.green);
    doc.text(`${a.accountNumber} — ${a.accountName}`, margin + 0.05, y + 0.13);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...PALETTE.gray);
    doc.text(a.accountType, pageW - margin - 0.05, y + 0.13, { align: "right" });
    y += 0.32;

    // Column headers
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...PALETTE.dark);
    doc.text("Date", colDate, y);
    doc.text("Description", colDesc, y);
    doc.text("Reference", colRef, y);
    doc.text("Debit", colDebit, y, { align: "right" });
    doc.text("Credit", colCredit, y, { align: "right" });
    doc.text("Balance", colBalance, y, { align: "right" });
    y += 0.16;

    let runningBalance = 0;
    let i = 0;
    for (const e of accEntries) {
      ensureSpace(0.18);
      // Zebra
      if (i % 2 === 1) {
        doc.setFillColor(248, 248, 248);
        doc.rect(margin, y - 0.12, pageW - 2 * margin, 0.16, "F");
      }
      runningBalance += e.debitCents - e.creditCents;
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...PALETTE.dark);
      doc.text(e.bookingDate, colDate, y);
      // Description column — truncated if oversize.
      const desc = (e.description ?? "").slice(0, 40);
      doc.text(desc, colDesc, y);
      const ref = `${e.referenceType ?? ""}:${e.referenceId ?? ""}`.slice(0, 20);
      doc.text(ref, colRef, y);
      doc.text(fmtCents(e.debitCents), colDebit, y, { align: "right" });
      doc.text(fmtCents(e.creditCents), colCredit, y, { align: "right" });
      doc.text(fmtCentsSigned(runningBalance), colBalance, y, { align: "right" });
      y += 0.16;
      i++;
    }

    // Account totals
    const accDebit = accEntries.reduce((s, e) => s + e.debitCents, 0);
    const accCredit = accEntries.reduce((s, e) => s + e.creditCents, 0);
    ensureSpace(0.25);
    doc.setDrawColor(...PALETTE.gray);
    doc.setLineWidth(0.005);
    doc.line(margin + 4.5, y - 0.1, pageW - margin, y - 0.1);
    doc.setFont("helvetica", "bold");
    doc.text("Totals", colRef, y);
    doc.text(fmtCents(accDebit), colDebit, y, { align: "right" });
    doc.text(fmtCents(accCredit), colCredit, y, { align: "right" });
    doc.text(fmtCentsSigned(accDebit - accCredit), colBalance, y, { align: "right" });
    y += 0.4;
    void accountId;
  }

  // jsPDF.output("arraybuffer") gives us bytes we can wrap as Buffer.
  const ab = doc.output("arraybuffer") as ArrayBuffer;
  return Buffer.from(ab);
}
