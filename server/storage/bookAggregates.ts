/**
 * Book-wide counts and sums in SQL (DEFECT-0171).
 *
 * Pax's cash-flow and pipeline tools summed getNotes() / getLeads() — the
 * 5000-row capped lists — and stated the result to the customer as their
 * whole book. These answer the same questions over every row.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, notes } from "@shared/schema";

export async function activeNoteTotals(orgId: number): Promise<{
  activeNotesCount: number;
  totalOutstandingBalance: number;
  monthlyCashflow: number;
}> {
  const [row] = await db
    .select({
      n: count(),
      balance: sql<string>`coalesce(sum(${notes.currentBalance}), 0)`,
      monthly: sql<string>`coalesce(sum(${notes.monthlyPayment}), 0)`,
    })
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
  return {
    activeNotesCount: Number(row?.n ?? 0),
    totalOutstandingBalance: Number(row?.balance ?? 0),
    monthlyCashflow: Number(row?.monthly ?? 0),
  };
}

export async function leadCountsByStatusAndType(orgId: number): Promise<{
  totalLeads: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}> {
  const rows = await db
    .select({ status: leads.status, type: leads.type, n: count() })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`))
    .groupBy(leads.status, leads.type);
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let totalLeads = 0;
  for (const r of rows) {
    const n = Number(r.n);
    totalLeads += n;
    byStatus[String(r.status)] = (byStatus[String(r.status)] ?? 0) + n;
    byType[String(r.type)] = (byType[String(r.type)] ?? 0) + n;
  }
  return { totalLeads, byStatus, byType };
}
