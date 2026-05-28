/**
 * Finance Enhancements — Items 86-105
 * Payment calendar, late reminders, note modifications, stress tests, etc.
 */

import { db } from "../db";
import { notes, payments } from "@shared/schema";
import { eq, and, sql, gte, lte, desc, count, sum } from "drizzle-orm";

// Item 86: Payment calendar data
export async function getPaymentCalendar(orgId: number, year: number, month: number): Promise<Array<{
  day: number;
  noteId: number;
  borrowerName: string;
  amount: number;
  status: "upcoming" | "received" | "late";
}>> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const allNotes = await db.select()
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), sql`${notes.status} = 'active'`));

  const calendar = [];
  for (const note of allNotes) {
    // TODO(tsc): notes has no paymentDueDay column; derive the due day-of-month from firstPaymentDate.
    const dueDay = note.firstPaymentDate ? new Date(note.firstPaymentDate).getDate() : 1;
    if (dueDay >= 1 && dueDay <= endDate.getDate()) {
      calendar.push({
        day: dueDay,
        noteId: note.id,
        borrowerName: (note as any).borrowerName || `Note #${note.id}`,
        amount: Number(note.monthlyPayment) || 0,
        status: new Date(year, month - 1, dueDay) < new Date() ? "late" : "upcoming" as any,
      });
    }
  }

  return calendar;
}

// Item 92: Note portfolio stress test
export async function stressTestPortfolio(orgId: number, defaultRate: number = 0.2): Promise<{
  totalMonthlyIncome: number;
  stressedIncome: number;
  incomeReduction: number;
  notesAtRisk: number;
  totalNotes: number;
}> {
  const activeNotes = await db.select()
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), sql`${notes.status} = 'active'`));

  const totalMonthlyIncome = activeNotes.reduce((sum, n) => sum + (Number(n.monthlyPayment) || 0), 0);
  const notesAtRisk = Math.ceil(activeNotes.length * defaultRate);
  const atRiskIncome = activeNotes
    .sort((a, b) => (Number(b.monthlyPayment) || 0) - (Number(a.monthlyPayment) || 0))
    .slice(0, notesAtRisk)
    .reduce((sum, n) => sum + (Number(n.monthlyPayment) || 0), 0);

  return {
    totalMonthlyIncome: Math.round(totalMonthlyIncome),
    stressedIncome: Math.round(totalMonthlyIncome - atRiskIncome),
    incomeReduction: Math.round(atRiskIncome),
    notesAtRisk,
    totalNotes: activeNotes.length,
  };
}

// Item 94: Note collection rate
export async function getCollectionRate(orgId: number, months: number = 6): Promise<{
  overallRate: number;
  monthlyRates: Array<{ month: string; rate: number }>;
}> {
  const monthlyRates: Array<{ month: string; rate: number }> = [];
  const now = new Date();

  for (let i = 0; i < months; i++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthLabel = monthStart.toLocaleDateString("en-US", { year: "numeric", month: "short" });

    const [received] = await db.select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, monthStart),
        lte(payments.paymentDate, monthEnd),
      ));

    // Estimate expected from active notes
    const [noteCount] = await db.select({ count: count() })
      .from(notes)
      .where(and(eq(notes.organizationId, orgId), sql`${notes.status} = 'active'`));

    const expected = (noteCount?.count || 0) * 500; // rough average
    const rate = expected > 0 ? Math.min(100, Math.round((Number(received?.total || 0) / expected) * 100)) : 0;

    monthlyRates.push({ month: monthLabel, rate });
  }

  const overallRate = monthlyRates.length > 0
    ? Math.round(monthlyRates.reduce((s, m) => s + m.rate, 0) / monthlyRates.length)
    : 0;

  return { overallRate, monthlyRates };
}

// Item 97: Note seasoning tracker
export async function getNoteSeasoning(orgId: number): Promise<Array<{ noteId: number; borrowerName: string; monthsSeasoned: number; onTimePayments: number; totalPayments: number }>> {
  const activeNotes = await db.select()
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), sql`${notes.status} = 'active'`))
    .limit(50);

  return activeNotes.map(note => {
    const created = note.createdAt ? new Date(note.createdAt) : new Date();
    const monthsSeasoned = Math.floor((Date.now() - created.getTime()) / (30 * 24 * 60 * 60 * 1000));

    return {
      noteId: note.id,
      borrowerName: (note as any).borrowerName || `Note #${note.id}`,
      monthsSeasoned,
      onTimePayments: monthsSeasoned, // Simplified — would query payment history
      totalPayments: monthsSeasoned,
    };
  });
}

// Item 100: Multi-note discount calculator
export function calculateBundleDiscount(notes: Array<{ balance: number; rate: number; monthsRemaining: number }>): {
  totalBalance: number;
  discountedPrice: number;
  yield: number;
} {
  const totalBalance = notes.reduce((s, n) => s + n.balance, 0);
  const avgRate = notes.reduce((s, n) => s + n.rate, 0) / notes.length;
  const avgMonths = notes.reduce((s, n) => s + n.monthsRemaining, 0) / notes.length;

  // Standard note pool discount: 15-25% depending on seasoning and quality
  const discountPercent = 0.80; // 20% discount
  const discountedPrice = Math.round(totalBalance * discountPercent);

  return {
    totalBalance: Math.round(totalBalance),
    discountedPrice,
    yield: Math.round(avgRate * 1.25 * 100) / 100, // Buyer gets higher yield due to discount
  };
}
