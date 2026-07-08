// Notes (owner-financing) + payments.
// Extracted from the god-class server/storage.ts. The amortization
// helpers live in storage.ts (calculateAmortizationSchedule /
// calculateMonthlyPayment) — they're imported here.

import { randomBytes } from "crypto";
import { and, desc, eq, count, sum } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
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
    // Reg-Z §1026.43 hard gate (Workstream A).
    //
    // A note row may not be inserted with status='active' unless either
    //   (a) atrDeterminationCompleted=true (ATR determination on file), or
    //   (b) atrExemptionCode is one of the recognized exemption codes.
    //
    // The DB CHECK constraint (notes_atr_origination_gate, migration 0099)
    // backstops this at the data layer — this app-layer guard exists so the
    // failure surfaces as an actionable error before the round-trip and so
    // any new insert path inherits the same gate without needing the DB error.
    //
    // 'legacy' is permitted on create so CSV / spreadsheet imports of
    // pre-AcreOS originated notes can land — the ATR analysis happened
    // before the loan tape ever reached us. Servicing surfaces still flag
    // 'legacy' for retroactive review; it is not evidence of compliance.
    const hasAtr = noteData.atrDeterminationCompleted === true;
    // drizzle-zod widens the `$type<...>` enum-or-null column to unknown in
    // InsertNote (same gap that requires the cast in `insertValues` below).
    // Narrow to string before the membership check.
    const exemptionCode =
      typeof noteData.atrExemptionCode === "string" ? noteData.atrExemptionCode : null;
    const hasExemption =
      exemptionCode !== null &&
      ["raw_land", "business_purpose", "commercial_borrower", "legacy"].includes(exemptionCode);
    const requestedStatus = noteData.status ?? "active";
    if (requestedStatus === "active" && !hasAtr && !hasExemption) {
      const err: Error & { code?: string } = new Error(
        "Cannot create note with status='active' without an ATR determination or exemption code. " +
          "Per Reg Z §1026.43(c), creditors must make an ATR determination at or before consummation. " +
          "Either pass atrDeterminationCompleted=true (after calling persistAtrDetermination) or " +
          "set atrExemptionCode to one of: raw_land, business_purpose, commercial_borrower.",
      );
      err.code = "ATR_DETERMINATION_REQUIRED";
      throw err;
    }

    // Calculate amortization if not provided
    let amortization: typeof notes.$inferInsert["amortizationSchedule"] = noteData.amortizationSchedule;
    if (!amortization && noteData.originalPrincipal && noteData.interestRate && noteData.termMonths) {
      const principal = Number(noteData.originalPrincipal);
      const rate = Number(noteData.interestRate);
      const term = noteData.termMonths;
      const payment = Number(noteData.monthlyPayment) || calculateMonthlyPayment(principal, rate, term);
      amortization = calculateAmortizationSchedule(principal, rate, term, payment, new Date(noteData.startDate));
    }

    // Calculate maturity date
    const maturityDate = addMonths(new Date(noteData.startDate), noteData.termMonths);

    // Generate access token for borrower portal. SECURITY (2026-07 audit):
    // this token is the borrower portal's primary authenticator (loan PII,
    // balances, payments) — it MUST be CSPRNG. The old Date.now() +
    // Math.random() form was predictable/enumerable.
    const accessToken = noteData.accessToken || `note_${randomBytes(32).toString("hex")}`;

    // updatedAt has a DB default but drizzle's $inferInsert types it as
    // required; set it explicitly (equivalent to the default) so the value
    // object satisfies the insert type.
    // TODO(tsc): drizzle-zod (0.8) mis-infers the `atrDetermination` jsonb
    // column (its $type is `{…} | null`) as the loose recursive `Json` type
    // instead of the column's `$type` shape, so InsertNote['atrDetermination']
    // is wider than the column accepts. Schema is frozen; narrow back to the
    // column's own insert type (the runtime value already conforms — it is
    // validated by insertNoteSchema before reaching here).
    const insertValues: typeof notes.$inferInsert = {
      ...noteData,
      atrDetermination: noteData.atrDetermination as typeof notes.$inferInsert["atrDetermination"],
      // Same drizzle-zod inference gap as atrDetermination — narrow back to
      // the column's typed enum-or-null. Runtime values are validated by the
      // route-layer Zod schema before reaching the repo.
      atrExemptionCode: noteData.atrExemptionCode as typeof notes.$inferInsert["atrExemptionCode"],
      currentBalance: noteData.currentBalance || noteData.originalPrincipal,
      amortizationSchedule: amortization,
      maturityDate: maturityDate,
      nextPaymentDate: noteData.firstPaymentDate,
      accessToken,
      updatedAt: new Date(),
    };
    const [newNote] = await db.insert(notes).values(insertValues).returning();

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

    // Reg-Z §1026.43 hard gate on status transitions to 'active' (Workstream A).
    //
    // If the caller is moving status -> 'active', verify the row has an ATR
    // determination on file (or has a valid exemption code) BEFORE we hit the
    // DB CHECK constraint. This produces a clean, actionable error instead of
    // a Postgres 23514 violation.
    if (updates.status === "active") {
      const [existing] = await db
        .select({
          atrDeterminationCompleted: notes.atrDeterminationCompleted,
          atrExemptionCode: notes.atrExemptionCode,
        })
        .from(notes)
        .where(and(...conditions))
        .limit(1);
      const willHaveAtr =
        updates.atrDeterminationCompleted === true ||
        (updates.atrDeterminationCompleted === undefined && existing?.atrDeterminationCompleted === true);
      // drizzle-zod widens `updates.atrExemptionCode` to unknown (same gap
      // that requires the cast in setValues below). Narrow to string before
      // the membership check.
      const proposedExemptionRaw =
        updates.atrExemptionCode ?? existing?.atrExemptionCode ?? null;
      const proposedExemption =
        typeof proposedExemptionRaw === "string" ? proposedExemptionRaw : null;
      const willHaveExemption =
        proposedExemption !== null &&
        ["raw_land", "business_purpose", "commercial_borrower", "legacy"].includes(proposedExemption);
      if (!willHaveAtr && !willHaveExemption) {
        const err: Error & { code?: string } = new Error(
          "Cannot transition note.status to 'active' without an ATR determination or exemption code. " +
            "Per Reg Z §1026.43(c), creditors must make an ATR determination at or before consummation. " +
            "Call persistAtrDetermination first, or set atrExemptionCode to one of: " +
            "raw_land, business_purpose, commercial_borrower.",
        );
        err.code = "ATR_DETERMINATION_REQUIRED";
        throw err;
      }
    }

    // Type the payload as drizzle's own update-set source. atrDetermination is
    // narrowed back to the column's type — see TODO(tsc) in createNote: a
    // drizzle-zod inference gap widens InsertNote['atrDetermination'] to `Json`.
    const setValues: PgUpdateSetSource<typeof notes> = {
      ...updates,
      atrDetermination: updates.atrDetermination as typeof notes.$inferInsert["atrDetermination"],
      // Same drizzle-zod inference workaround as createNote — narrow to the
      // column's typed enum-or-null. Route-layer Zod validates before this.
      atrExemptionCode: updates.atrExemptionCode as typeof notes.$inferInsert["atrExemptionCode"],
      updatedAt: new Date(),
    };
    const [updated] = await db.update(notes)
      .set(setValues)
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
