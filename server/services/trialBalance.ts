/**
 * Trial Balance generator — Lavender Week 10.
 *
 * Aggregates `account_ledger_entries` per chart_of_accounts row up to a
 * given as-of date. Returns:
 *
 *   - `accounts`: every active account with non-zero activity, with
 *     debit-side balance (debit > 0 ⇒ debit balance) or credit-side
 *     balance (credit > 0 ⇒ credit balance). The natural side is
 *     determined by the sign of `sum(debit) - sum(credit)`:
 *
 *       net > 0  ⇒ shown in `debit` column  (assets, expenses)
 *       net < 0  ⇒ shown in `credit` column (liabilities, equity, revenue)
 *       net = 0  ⇒ omitted (zero-balance accounts are not informative
 *                  for a trial balance; the underlying entries are still
 *                  in the GL).
 *
 *   - `totals`: sum of the debit column and sum of the credit column.
 *     `balance` = debit − credit; an internally-consistent ledger
 *     produces 0. We do NOT throw on imbalance — instead we surface the
 *     delta so the UI / CI can flag and operators can drill in.
 *
 * Why bigint cents only
 * ─────────────────────
 * Every number in this module is integer cents. We never coerce to
 * floats; the JS number type is enough for the largest realistic
 * balance (2^53 cents ≈ $90 trillion).
 */

import { db } from "../db";
import { accountLedgerEntries, chartOfAccounts, type AccountType } from "@shared/schema";
import { and, eq, lte, sql } from "drizzle-orm";

export interface TrialBalanceRow {
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountType: AccountType;
  /** Cents — only one of debit/credit is non-zero per row. */
  debit: number;
  credit: number;
}

export interface TrialBalanceTotals {
  /** Sum of the debit column, in cents. */
  debit: number;
  /** Sum of the credit column, in cents. */
  credit: number;
  /** debit − credit. Zero when the ledger is balanced. */
  balance: number;
  /** Convenience: true when `balance === 0`. */
  isBalanced: boolean;
}

export interface TrialBalance {
  organizationId: number;
  asOfDate: string; // ISO YYYY-MM-DD
  accounts: TrialBalanceRow[];
  totals: TrialBalanceTotals;
  generatedAt: string;
}

/**
 * Compute the trial balance for `orgId` as of `asOfDate` (inclusive).
 *
 * Performance: single SQL aggregation grouped by account; O(N) in the
 * number of ledger entries up to the date. For very large orgs this can
 * later be backed by a materialised view, but the query plan is clean
 * (group-by on indexed (org_id, booking_date)).
 */
export async function generateTrialBalance(
  orgId: number,
  asOfDate: Date | string,
): Promise<TrialBalance> {
  const asOf = typeof asOfDate === "string" ? asOfDate : asOfDate.toISOString().slice(0, 10);

  // Pull every account for the org so zero-balance accounts can still be
  // surfaced in the GL/PDF surface; we filter them out of the trial-
  // balance rows below.
  const accounts = await db
    .select()
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.organizationId, orgId));

  // Aggregate debits/credits per account up to as-of.
  const aggRows = await db
    .select({
      accountId: accountLedgerEntries.accountId,
      totalDebit: sql<string>`COALESCE(SUM(${accountLedgerEntries.debit}), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${accountLedgerEntries.credit}), 0)`,
    })
    .from(accountLedgerEntries)
    .where(
      and(
        eq(accountLedgerEntries.organizationId, orgId),
        lte(accountLedgerEntries.bookingDate, asOf),
      ),
    )
    .groupBy(accountLedgerEntries.accountId);

  const aggByAccount = new Map(
    aggRows.map((r) => [r.accountId, { d: Number(r.totalDebit), c: Number(r.totalCredit) }]),
  );

  const rows: TrialBalanceRow[] = [];
  for (const acc of accounts) {
    const agg = aggByAccount.get(acc.id) ?? { d: 0, c: 0 };
    const net = agg.d - agg.c;
    if (net === 0) continue;
    rows.push({
      accountId: acc.id,
      accountNumber: acc.accountNumber,
      accountName: acc.accountName,
      accountType: acc.accountType as AccountType,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
    });
  }

  // Ascending by accountNumber for the conventional trial-balance layout.
  rows.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const balance = totalDebit - totalCredit;

  return {
    organizationId: orgId,
    asOfDate: asOf,
    accounts: rows,
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      balance,
      isBalanced: balance === 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Strict variant — throws if the ledger is unbalanced. Used by the
 * monthly-close job to refuse to advance the period if the books are
 * off. The route handler uses the non-throwing variant so the UI can
 * still render the report and let the operator drill into the delta.
 */
export async function assertTrialBalanced(orgId: number, asOfDate: Date | string): Promise<TrialBalance> {
  const tb = await generateTrialBalance(orgId, asOfDate);
  if (!tb.totals.isBalanced) {
    throw new Error(
      `Trial balance not balanced for org ${orgId} as of ${tb.asOfDate}: ` +
        `debits=${tb.totals.debit} credits=${tb.totals.credit} delta=${tb.totals.balance}`,
    );
  }
  return tb;
}
