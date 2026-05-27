// Notes (owner-financing) + payments.
// Extracted from the god-class server/storage.ts. The amortization
// helpers live in storage.ts (calculateAmortizationSchedule /
// calculateMonthlyPayment) — they're imported here.

import { and, desc, eq, count, sum } from "drizzle-orm";
import { db, withTransaction } from "../db";
import {
  notes, payments,
  type Note, type InsertNote,
  type Payment, type InsertPayment,
} from "@shared/schema";
import { addMonths } from "../utils/dateUtils";
import type { DatabaseStorage } from "../storage";

// Amortization helpers — co-located with notes since they're only used
// inside createNote. Original implementations lived in server/storage.ts
// pre-refactor; behavior is preserved verbatim.
function calculateAmortizationSchedule(
  principal: number,
  annualRate: number,
  termMonths: number,
  monthlyPayment: number,
  startDate: Date,
): Note["amortizationSchedule"] {
  const schedule: Note["amortizationSchedule"] = [];
  let balance = principal;
  const monthlyRate = annualRate / 100 / 12;

  for (let i = 1; i <= termMonths && balance > 0; i++) {
    const interestPayment = balance * monthlyRate;
    const principalPayment = Math.min(monthlyPayment - interestPayment, balance);
    balance = Math.max(0, balance - principalPayment);

    const dueDate = addMonths(new Date(startDate), i);

    schedule.push({
      paymentNumber: i,
      dueDate: dueDate.toISOString(),
      payment: monthlyPayment,
      principal: Number(principalPayment.toFixed(2)),
      interest: Number(interestPayment.toFixed(2)),
      balance: Number(balance.toFixed(2)),
      status: "pending",
    });
  }

  return schedule;
}

export function calculateMonthlyPayment(principal: number, annualRate: number, termMonths: number): number {
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return principal / termMonths;
  const payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1);
  return Number(payment.toFixed(2));
}

export const noteRepo = {
  // Notes (Financing)
  async getNotes(this: DatabaseStorage, orgId: number): Promise<Note[]> {
    return await db.select().from(notes)
      .where(eq(notes.organizationId, orgId))
      .orderBy(desc(notes.createdAt));
  },

  async getNote(this: DatabaseStorage, orgId: number, id: number): Promise<Note | undefined> {
    const [note] = await db.select().from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.id, id)));
    return note;
  },

  async getNoteByAccessToken(this: DatabaseStorage, accessToken: string): Promise<Note | undefined> {
    const [note] = await db.select().from(notes)
      .where(eq(notes.accessToken, accessToken));
    return note;
  },

  async createNote(this: DatabaseStorage, noteData: InsertNote): Promise<Note> {
    // Calculate amortization if not provided
    let amortization = noteData.amortizationSchedule;
    if (!amortization && noteData.originalPrincipal && noteData.interestRate && noteData.termMonths) {
      const principal = Number(noteData.originalPrincipal);
      const rate = Number(noteData.interestRate);
      const term = noteData.termMonths;
      const payment = Number(noteData.monthlyPayment) || calculateMonthlyPayment(principal, rate, term);
      amortization = calculateAmortizationSchedule(principal, rate, term, payment, new Date(noteData.startDate));
    }

    // Calculate maturity date
    const maturityDate = addMonths(new Date(noteData.startDate), noteData.termMonths);

    // Generate access token for borrower portal
    const accessToken = noteData.accessToken || `note_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    const [newNote] = await db.insert(notes).values({
      ...noteData,
      currentBalance: noteData.currentBalance || noteData.originalPrincipal,
      amortizationSchedule: amortization,
      maturityDate: maturityDate,
      nextPaymentDate: noteData.firstPaymentDate,
      accessToken,
    }).returning();

    await this.logActivity({
      organizationId: noteData.organizationId,
      action: "created",
      entityType: "note",
      entityId: newNote.id,
      description: `Note created for $${noteData.originalPrincipal}`,
    });

    return newNote;
  },

  async updateNote(this: DatabaseStorage, id: number, updates: Partial<InsertNote>, organizationId?: number): Promise<Note> {
    const conditions = [eq(notes.id, id)];
    if (organizationId) conditions.push(eq(notes.organizationId, organizationId));
    const [updated] = await db.update(notes)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteNote(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(notes.id, id)];
    if (organizationId) conditions.push(eq(notes.organizationId, organizationId));
    await db.delete(notes).where(and(...conditions));
  },

  async getNoteCount(this: DatabaseStorage, orgId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
    return result?.count || 0;
  },

  async getActiveNotesValue(this: DatabaseStorage, orgId: number): Promise<number> {
    const [result] = await db.select({ total: sum(notes.currentBalance) }).from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
    return Number(result?.total) || 0;
  },

  // Payments
  async getPayments(this: DatabaseStorage, orgId: number, noteId?: number): Promise<Payment[]> {
    if (noteId) {
      return await db.select().from(payments)
        .where(and(eq(payments.organizationId, orgId), eq(payments.noteId, noteId)))
        .orderBy(desc(payments.paymentDate))
        .limit(2000);
    }
    return await db.select().from(payments)
      .where(eq(payments.organizationId, orgId))
      .orderBy(desc(payments.paymentDate))
      .limit(5000);
  },

  async createPayment(this: DatabaseStorage, payment: InsertPayment): Promise<Payment> {
    return withTransaction(async (tx) => {
      // Insert payment — unique transactionId constraint prevents double-inserts
      const [newPayment] = await tx.insert(payments).values(payment).returning();

      // Update note balance inside the same transaction with optimistic locking
      if (payment.status === "completed") {
        // SELECT FOR UPDATE locks the row until transaction commits
        const [note] = await tx
          .select()
          .from(notes)
          .where(eq(notes.id, payment.noteId))
          .for("update");

        if (note) {
          const newBalance = Number(note.currentBalance) - Number(payment.principalAmount);
          const updated = await tx
            .update(notes)
            .set({
              currentBalance: String(Math.max(0, newBalance)),
              status: newBalance <= 0 ? "paid_off" : "active",
              version: (note.version ?? 1) + 1,
              updatedAt: new Date(),
            })
            .where(and(eq(notes.id, payment.noteId), eq(notes.version, note.version ?? 1)))
            .returning();

          if (updated.length === 0) {
            throw new Error(`Optimistic lock conflict on note ${payment.noteId} — concurrent update detected`);
          }
        }
      }

      return newPayment;
    });
  },

  async updatePayment(this: DatabaseStorage, id: number, updates: Partial<InsertPayment>, organizationId?: number): Promise<Payment> {
    const conditions = [eq(payments.id, id)];
    if (organizationId) conditions.push(eq(payments.organizationId, organizationId));
    const [updated] = await db.update(payments).set(updates).where(and(...conditions)).returning();
    return updated;
  },
};

export type NoteRepo = typeof noteRepo;
