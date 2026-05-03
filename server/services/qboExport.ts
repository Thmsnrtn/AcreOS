/**
 * QuickBooks / IIF journal-entry export — Lavender Week 10.
 *
 * Exports `account_ledger_entries` rows in two formats:
 *
 *   IIF — Intuit Interchange Format. Tab-separated text file QuickBooks
 *         Desktop (and many QBO importers) can ingest as a journal
 *         transaction batch. Each entry is a TRNS / SPL / ENDTRNS triple
 *         keyed on (organizationId, referenceType, referenceId).
 *
 *   JSON — A QBO-importable journal-entry payload (one batch row per
 *          ledger pair, with `Line.JournalEntryLineDetail.PostingType`
 *          either Debit or Credit). Useful for orgs that import via the
 *          QBO API connector rather than IIF upload.
 *
 * Mapping
 * ───────
 * AcreOS keeps the customer's `accountNumber` verbatim; the IIF/JSON
 * payload uses the account name as the QBO account name. AccountType is
 * mapped to the QBO taxonomy:
 *
 *   asset           → Asset / Bank
 *   liability       → Liability / OtherCurrentLiability
 *   equity          → Equity
 *   revenue         → Income
 *   expense         → Expense
 *   contra_asset    → Asset (with negative sign already in the cents)
 *   contra_revenue  → Income (likewise)
 *
 * The mapping is intentionally pragmatic: a customer who has already
 * mirrored their CPA's chart in AcreOS gets a round-trip-clean import.
 */

import { db } from "../db";
import { accountLedgerEntries, chartOfAccounts, type AccountType } from "@shared/schema";
import { and, asc, eq, gte, lte } from "drizzle-orm";

export interface QboJournalEntryLine {
  Description?: string;
  Amount: number; // dollars (QBO API uses dollars not cents)
  DetailType: "JournalEntryLineDetail";
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { name: string; value: string }; // value = account number
  };
}

export interface QboJournalEntry {
  TxnDate: string; // YYYY-MM-DD
  PrivateNote?: string;
  DocNumber?: string;
  Line: QboJournalEntryLine[];
}

interface ExportRow {
  bookingDate: string;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  debitCents: number;
  creditCents: number;
  accountNumber: string;
  accountName: string;
  accountType: AccountType;
}

function qboAccountTypeFor(t: AccountType): string {
  switch (t) {
    case "asset":
      return "Bank";
    case "liability":
      return "OtherCurrentLiability";
    case "equity":
      return "Equity";
    case "revenue":
    case "contra_revenue":
      return "Income";
    case "expense":
      return "Expense";
    case "contra_asset":
      return "Asset";
  }
}

async function fetchRange(orgId: number, fromIso: string, toIso: string): Promise<ExportRow[]> {
  const rows = await db
    .select({
      bookingDate: accountLedgerEntries.bookingDate,
      description: accountLedgerEntries.description,
      referenceType: accountLedgerEntries.referenceType,
      referenceId: accountLedgerEntries.referenceId,
      debitCents: accountLedgerEntries.debit,
      creditCents: accountLedgerEntries.credit,
      accountNumber: chartOfAccounts.accountNumber,
      accountName: chartOfAccounts.accountName,
      accountType: chartOfAccounts.accountType,
    })
    .from(accountLedgerEntries)
    .innerJoin(chartOfAccounts, eq(accountLedgerEntries.accountId, chartOfAccounts.id))
    .where(
      and(
        eq(accountLedgerEntries.organizationId, orgId),
        gte(accountLedgerEntries.bookingDate, fromIso),
        lte(accountLedgerEntries.bookingDate, toIso),
      ),
    )
    .orderBy(asc(accountLedgerEntries.bookingDate), asc(accountLedgerEntries.postedAt));

  return rows.map((r) => ({
    bookingDate: r.bookingDate as unknown as string,
    description: r.description,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    debitCents: Number(r.debitCents),
    creditCents: Number(r.creditCents),
    accountNumber: r.accountNumber,
    accountName: r.accountName,
    accountType: r.accountType as AccountType,
  }));
}

/** Group rows into journal-entry batches by (referenceType, referenceId). */
function groupByReference(rows: ExportRow[]): Map<string, ExportRow[]> {
  const out = new Map<string, ExportRow[]>();
  for (const r of rows) {
    const key = `${r.referenceType ?? "manual"}:${r.referenceId ?? `${r.bookingDate}-${r.accountNumber}`}`;
    const list = out.get(key) ?? [];
    list.push(r);
    out.set(key, list);
  }
  return out;
}

/**
 * Emit IIF (Intuit Interchange Format) text. The format uses tab as the
 * separator and three header sections at the top:
 *
 *   !ACCNT  NAME  ACCNTTYPE
 *   !TRNS   TRNSID  TRNSTYPE  DATE  ACCNT  AMOUNT  DOCNUM  MEMO
 *   !SPL    SPLID   TRNSTYPE  DATE  ACCNT  AMOUNT  DOCNUM  MEMO
 *   !ENDTRNS
 *
 * Each ledger pair becomes one TRNS row (the first line, debit-side) +
 * one SPL row (the credit-side or remaining legs) + an ENDTRNS marker.
 *
 * IIF expects amounts in dollars with two decimal places.
 */
export async function exportLedgerAsIIF(
  orgId: number,
  fromDate: Date | string,
  toDate: Date | string,
): Promise<string> {
  const fromIso = typeof fromDate === "string" ? fromDate : fromDate.toISOString().slice(0, 10);
  const toIso = typeof toDate === "string" ? toDate : toDate.toISOString().slice(0, 10);

  const rows = await fetchRange(orgId, fromIso, toIso);
  const groups = groupByReference(rows);

  const lines: string[] = [];
  // Account list header — collect distinct accounts from the range.
  const accounts = new Map<string, { name: string; type: AccountType }>();
  for (const r of rows) {
    accounts.set(r.accountNumber, { name: r.accountName, type: r.accountType });
  }
  lines.push(["!ACCNT", "NAME", "ACCNTTYPE"].join("\t"));
  for (const [num, a] of accounts) {
    lines.push(["ACCNT", `${num} ${a.name}`, qboAccountTypeFor(a.type)].join("\t"));
  }

  lines.push(
    ["!TRNS", "TRNSTYPE", "DATE", "ACCNT", "AMOUNT", "DOCNUM", "MEMO"].join("\t"),
  );
  lines.push(
    ["!SPL", "TRNSTYPE", "DATE", "ACCNT", "AMOUNT", "DOCNUM", "MEMO"].join("\t"),
  );
  lines.push("!ENDTRNS");

  for (const [refKey, legs] of groups) {
    if (legs.length === 0) continue;
    const first = legs[0]!;
    const date = (first.bookingDate as string).split("-").reverse().join("/"); // QBO IIF prefers MM/DD/YYYY
    // Convert YYYY-MM-DD → MM/DD/YYYY explicitly.
    const [y, m, d] = (first.bookingDate as string).split("-");
    const iifDate = `${m}/${d}/${y}`;

    const memo = (first.description ?? refKey).replace(/\t/g, " ");

    // First leg is the TRNS row — IIF convention uses the debit-side as the
    // TRNS leg if present, otherwise falls back to the first leg.
    const debitLeg = legs.find((l) => l.debitCents > 0) ?? first;
    const otherLegs = legs.filter((l) => l !== debitLeg);

    const trnsAmt = (debitLeg.debitCents - debitLeg.creditCents) / 100;
    lines.push(
      [
        "TRNS",
        "GENERAL JOURNAL",
        iifDate,
        `${debitLeg.accountNumber} ${debitLeg.accountName}`,
        trnsAmt.toFixed(2),
        refKey,
        memo,
      ].join("\t"),
    );
    for (const l of otherLegs) {
      const splAmt = (l.debitCents - l.creditCents) / 100;
      lines.push(
        [
          "SPL",
          "GENERAL JOURNAL",
          iifDate,
          `${l.accountNumber} ${l.accountName}`,
          splAmt.toFixed(2),
          refKey,
          memo,
        ].join("\t"),
      );
    }
    lines.push("ENDTRNS");
  }

  // IIF files use CRLF line endings — Windows QuickBooks Desktop is
  // historically picky.
  return lines.join("\r\n") + "\r\n";
}

/**
 * Emit a QBO-API-shaped JSON payload (array of JournalEntry resources).
 * Each entry has matched debit + credit lines summing to zero. Customers
 * can POST these to /v3/company/{realmId}/journalentry directly via the
 * QBO API or paste them into a 3rd-party importer.
 */
export async function exportLedgerAsQBOJournal(
  orgId: number,
  fromDate: Date | string,
  toDate: Date | string,
): Promise<{ entries: QboJournalEntry[]; totalEntries: number; totalLines: number }> {
  const fromIso = typeof fromDate === "string" ? fromDate : fromDate.toISOString().slice(0, 10);
  const toIso = typeof toDate === "string" ? toDate : toDate.toISOString().slice(0, 10);

  const rows = await fetchRange(orgId, fromIso, toIso);
  const groups = groupByReference(rows);

  const entries: QboJournalEntry[] = [];
  let totalLines = 0;

  for (const [refKey, legs] of groups) {
    if (legs.length === 0) continue;
    const first = legs[0]!;
    const txnDate = first.bookingDate as string;

    const Line: QboJournalEntryLine[] = legs.map((l) => ({
      Description: l.description ?? undefined,
      Amount: (l.debitCents > 0 ? l.debitCents : l.creditCents) / 100,
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: {
        PostingType: l.debitCents > 0 ? "Debit" : "Credit",
        AccountRef: { name: l.accountName, value: l.accountNumber },
      },
    }));
    totalLines += Line.length;
    entries.push({
      TxnDate: txnDate,
      DocNumber: refKey.slice(0, 21), // QBO DocNumber max 21 chars
      PrivateNote: refKey,
      Line,
    });
  }

  return { entries, totalEntries: entries.length, totalLines };
}
