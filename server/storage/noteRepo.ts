// Notes (owner-financing) + payments.
// Extracted from the god-class server/storage.ts. The amortization
// helpers live in storage.ts (calculateAmortizationSchedule /
// calculateMonthlyPayment) — they're imported here.

import { randomBytes } from "crypto";
import { omitProtectedFields } from "../utils/updatePayload";
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
import { LIST_READ_CAP, capListRead } from "./listCap";
import { assertWritablePatch } from "../utils/patch";
import { clock } from "../utils/clock";
import { recordPostedPaymentApplication } from "../services/paymentApplication";
import { nextServicedStatus } from "@shared/notes/servicedStatus";

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

/** The would-be row, as the activation gate reads it. A draft has no id yet. */
function gateNoteFromDraft(noteData: InsertNote): import("../services/notes/originationGate").GateNote {
  return {
    id: null,
    owningEntity: noteData.owningEntity,
    startDate: new Date(noteData.startDate),
    atrDetermination: noteData.atrDetermination,
    atrDeterminationCompleted: noteData.atrDeterminationCompleted,
    atrExemptionCode: noteData.atrExemptionCode,
  };
}

/**
 * The pre-Leg-3 check, kept for a status → 'active' move that is NOT a first
 * activation (a cure or reactivation from late / delinquent / defaulted /
 * paid_off …), and for a row that does not exist (fails closed). Unchanged
 * semantics: an ATR flag or a recognized code on file (the update's own
 * values override the stored ones), else ATR_DETERMINATION_REQUIRED.
 */
function assertCureHasAtrBasis(
  existing: { atrDeterminationCompleted: boolean | null; atrExemptionCode: string | null } | undefined,
  updates: Partial<InsertNote>,
): void {
  const willHaveAtr =
    updates.atrDeterminationCompleted === true ||
    (updates.atrDeterminationCompleted === undefined && existing?.atrDeterminationCompleted === true);
  // drizzle-zod widens `updates.atrExemptionCode` to unknown (same gap that
  // requires the cast in updateNote's setValues). Narrow to string before the
  // membership check.
  const proposedExemptionRaw = updates.atrExemptionCode ?? existing?.atrExemptionCode ?? null;
  const proposedExemption = typeof proposedExemptionRaw === "string" ? proposedExemptionRaw : null;
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

export const noteRepo = {
  // Notes (Financing)
  async getNotes(this: DatabaseStorage, orgId: number): Promise<Note[]> {
    // Audit F-10-2: was unbounded (OOM risk on a large note book). Bounded with
    // a LOUD cap — truncation is logged, never silent.
    const rows = await db.select().from(notes)
      .where(eq(notes.organizationId, orgId))
      .orderBy(desc(notes.createdAt))
      .limit(LIST_READ_CAP + 1);
    return capListRead(rows, LIST_READ_CAP, "getNotes", orgId);
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

  async createNote(
    this: DatabaseStorage,
    noteData: InsertNote,
    opts?: {
      /**
       * The CSV book-import entry marker (ruling R1). ONLY importNotesFromCSV
       * (server/services/importExport.ts) sets it: it is the one path allowed
       * to land `legacy` — grandfathering the pre-0099 book by construction.
       */
      viaImport?: boolean;
      /** recorded_by on the activation_gate_passed record (the session user, when a route has one). */
      recordedBy?: string;
    },
  ): Promise<Note> {
    // Reg-Z §1026.43 hard gate (Workstream A), now the Notes V2 Leg 3
    // activation gate (server/services/notes/originationGate.ts).
    //
    // A note row inserted with status='active' must pass the gate for the
    // would-be row: an ATR determination that is ON RECORD (a payload that
    // passes validateAtrDetermination, with the completed flag exactly true —
    // the bare flag alone no longer passes, founder decision 2026-11-05 §3.2)
    // or an exemption code the facts support, plus the seller-scoped counter
    // and creditor-threshold checks. A draft has no id, so it cannot have an
    // origination-facts or RMLO record of its own: no exclusion is claimed on
    // create and the terms checks do not fire. On a pass, the note and its
    // activation_gate_passed record are written in ONE transaction.
    //
    // The DB CHECK constraint (notes_atr_origination_gate, migration 0099)
    // still backstops the ATR half at the data layer.
    //
    // 'legacy' (ruling R1) may only be newly written by the CSV book import
    // (opts.viaImport) — on ANY status, because a stored legacy code skips the
    // activation gate later (updateNote), so a pending legacy draft would be a
    // gate-free route to 'active'. Imported legacy rows never reach the gate.
    // Servicing surfaces still flag 'legacy' for retroactive review; it is not
    // evidence of compliance.
    const requestedStatus = noteData.status ?? "active";
    let gate: typeof import("../services/notes/originationGate") | null = null;
    let activationInstant: Date | null = null;
    if (noteData.atrExemptionCode === "legacy" && opts?.viaImport !== true) {
      const { ActivationRefused } = await import("../services/notes/originationGate");
      throw new ActivationRefused([
        {
          check: "legacy_claimed",
          element: "exemptionCode",
          message:
            "The legacy exemption code is reserved for notes imported from the pre-gate book. It cannot be claimed for a new note.",
          curingFact:
            "Record an ability-to-repay determination under 12 CFR 1026.43(c), or a raw_land, business_purpose or commercial_borrower exemption the recorded facts support.",
        },
      ]);
    }
    const grandfatheredImport = noteData.atrExemptionCode === "legacy" && opts?.viaImport === true;
    if (requestedStatus === "active" && !grandfatheredImport) {
      gate = await import("../services/notes/originationGate");
      activationInstant = clock.now();
      // Count-independent refusals (ATR basis, unknown codes, bare flag)
      // are decided here, before any database round-trip.
      gate.preflightActivation(
        gate.impliedGateFacts(noteData.organizationId, gateNoteFromDraft(noteData), activationInstant.toISOString()).facts,
      );
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
      updatedAt: clock.now(),
    };
    let newNote: Note;
    if (gate !== null && activationInstant !== null) {
      const activeGate = gate;
      const instant = activationInstant;
      newNote = await withTransaction(async (tx) => {
        const detail = await activeGate.evaluateActivation(tx, {
          organizationId: noteData.organizationId,
          note: gateNoteFromDraft(noteData),
          activationInstant: instant,
        });
        const [row] = await tx.insert(notes).values(insertValues).returning();
        await activeGate.recordActivationGatePassed(tx, {
          organizationId: noteData.organizationId,
          noteId: row.id,
          recordedBy: opts?.recordedBy?.trim() || "system:noteRepo.createNote",
          detail,
        });
        return row;
      });
    } else {
      [newNote] = await db.insert(notes).values(insertValues).returning();
    }

    await this.logActivity({
      organizationId: noteData.organizationId,
      action: "created",
      entityType: "note",
      entityId: newNote.id,
      description: `Note created for $${noteData.originalPrincipal}`,
    });

    return newNote;
  },

  async updateNote(
    this: DatabaseStorage,
    id: number,
    updates: Partial<InsertNote>,
    organizationId?: number,
    opts?: { /** recorded_by on the activation_gate_passed record. */ recordedBy?: string },
  ): Promise<Note> {
    const conditions = [eq(notes.id, id)];
    if (organizationId) conditions.push(eq(notes.organizationId, organizationId));

    // Ruling R1: `legacy` can never be newly claimed on an update — a stored
    // legacy code skips the activation gate, so writing one onto a pending
    // note would be a gate-free route to 'active'. (The PUT route's strict
    // schema already excludes every ATR field; this closes the repo method.)
    if (updates.atrExemptionCode === "legacy") {
      const [stored] = await db
        .select({ atrExemptionCode: notes.atrExemptionCode })
        .from(notes)
        .where(and(...conditions))
        .limit(1);
      if (stored?.atrExemptionCode !== "legacy") {
        const { ActivationRefused } = await import("../services/notes/originationGate");
        throw new ActivationRefused([
          {
            check: "legacy_claimed",
            element: "exemptionCode",
            message:
              "The legacy exemption code is reserved for notes imported from the pre-gate book. It cannot be newly claimed on an existing note.",
            curingFact:
              "Record an ability-to-repay determination under 12 CFR 1026.43(c), or a raw_land, business_purpose or commercial_borrower exemption the recorded facts support.",
          },
        ]);
      }
    }

    // Type the payload as drizzle's own update-set source. atrDetermination is
    // narrowed back to the column's type — see TODO(tsc) in createNote: a
    // drizzle-zod inference gap widens InsertNote['atrDetermination'] to `Json`.
    const setValues: PgUpdateSetSource<typeof notes> = {
      ...omitProtectedFields(updates),
      atrDetermination: updates.atrDetermination as typeof notes.$inferInsert["atrDetermination"],
      // Same drizzle-zod inference workaround as createNote — narrow to the
      // column's typed enum-or-null. Route-layer Zod validates before this.
      atrExemptionCode: updates.atrExemptionCode as typeof notes.$inferInsert["atrExemptionCode"],
      updatedAt: clock.now(),
    };

    // Reg-Z §1026.43 hard gate on status transitions to 'active'.
    //
    // FIRST activation (stored 'pending' → 'active') runs the Notes V2 Leg 3
    // activation gate on the would-be row, inside the same transaction as the
    // UPDATE (the row is locked FOR UPDATE; the activation_gate_passed record
    // commits or rolls back with it). A stored 'legacy' code is grandfathered
    // (R1) and skips the gate. Any other prior status moving to 'active' is a
    // servicing cure or reactivation, not a consummation: it keeps the
    // pre-Leg-3 check (an ATR flag or a recognized code on file) so the
    // failure is an actionable error instead of a Postgres 23514 violation.
    if (updates.status === "active") {
      return withTransaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(notes)
          .where(and(...conditions))
          .limit(1)
          .for("update");
        if (existing && existing.status === "pending") {
          const effectiveCode = updates.atrExemptionCode !== undefined ? updates.atrExemptionCode : existing.atrExemptionCode;
          if (!(effectiveCode === "legacy" && existing.atrExemptionCode === "legacy")) {
            const { assertActivationAllowed } = await import("../services/notes/originationGate");
            await assertActivationAllowed(tx, {
              organizationId: existing.organizationId,
              note: {
                id: existing.id,
                owningEntity: updates.owningEntity !== undefined ? updates.owningEntity : existing.owningEntity,
                startDate: updates.startDate !== undefined ? new Date(updates.startDate) : existing.startDate,
                atrDetermination: updates.atrDetermination !== undefined ? updates.atrDetermination : existing.atrDetermination,
                atrDeterminationCompleted:
                  updates.atrDeterminationCompleted !== undefined
                    ? updates.atrDeterminationCompleted
                    : existing.atrDeterminationCompleted,
                atrExemptionCode: effectiveCode,
              },
              recordedBy: opts?.recordedBy?.trim() || "system:noteRepo.updateNote",
              activationInstant: clock.now(),
            });
          }
        } else {
          assertCureHasAtrBasis(existing, updates);
        }
        const [updated] = await tx.update(notes)
          .set(setValues)
          .where(and(...conditions))
          .returning();
        return updated;
      });
    }

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

      // The Reg-Z application breakdown, in the SAME transaction (D4): the
      // periodic-statement generator sums `payment_applications` only and
      // refuses a statement whose posted payments have no breakdown there.
      // Mirror the split recorded on this payment row itself — the columns
      // are decimal-dollar strings; the residue (received but applied to
      // nothing, e.g. a payoff overage the split capped at the balance) is
      // derived from the row's own figures so the buckets sum to the amount.
      // Only the statuses the generator's probe treats as posted money
      // ('completed', 'processing') get a breakdown.
      if (payment.status === "completed" || payment.status === "processing") {
        const toCents = (v: string | number | null | undefined): number =>
          Math.round(Number(v ?? 0) * 100);
        const principalCents = toCents(payment.principalAmount);
        const interestCents = toCents(payment.interestAmount);
        const feesCents = toCents(payment.feeAmount) + toCents(payment.lateFeeAmount);
        const residueCents = Math.max(
          0,
          toCents(payment.amount) - principalCents - interestCents - feesCents,
        );
        await recordPostedPaymentApplication(tx, {
          organizationId: payment.organizationId,
          loanId: String(payment.noteId),
          loanType: "note",
          paymentId: String(newPayment.id),
          receivedAt: payment.paymentDate,
          appliedAt: payment.paymentDate,
          appliedToPrincipalCents: principalCents,
          appliedToInterestCents: interestCents,
          appliedToEscrowCents: 0,
          appliedToFeesCents: feesCents,
          appliedToSuspenseCents: residueCents,
        });
      }

      // Update note balance inside the same transaction with optimistic locking
      if (payment.status === "completed") {
        // SELECT FOR UPDATE locks the row until transaction commits
        // The note must belong to the SAME organization as the payment row.
        // `payments.organization_id` is forced to the caller's org upstream but
        // `noteId` arrives from the request body, and nothing in the DB ties the
        // two together (plain FKs to `organizations`/`notes`, no cross-column
        // CHECK). Without this predicate a member of org A could post a
        // "completed" payment against an org B note id and rewrite org B's
        // balance/status/version. Both queries below carry the org.
        const [note] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.id, payment.noteId), eq(notes.organizationId, payment.organizationId)))
          .for("update");

        if (note) {
          const newBalance = Number(note.currentBalance) - Number(payment.principalAmount);
          const updated = await tx
            .update(notes)
            .set({
              currentBalance: String(Math.max(0, newBalance)),
              // One rule for every payment path (shared/notes/servicedStatus.ts):
              // a payment never consummates a pending note, and a defaulted
              // note stays defaulted until paid off. Math.ceil keeps the sign of
              // the dollar balance exactly (a sub-cent positive residual stays
              // positive; NaN stays NaN), so only the helper's rule changes.
              status: nextServicedStatus(note.status, Math.ceil(newBalance * 100)),
              version: (note.version ?? 1) + 1,
              updatedAt: clock.now(),
            })
            .where(and(
              eq(notes.id, payment.noteId),
              eq(notes.organizationId, payment.organizationId),
              eq(notes.version, note.version ?? 1),
            ))
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
    const [updated] = await db.update(payments).set(assertWritablePatch(updates, "payments.updatePayment")).where(and(...conditions)).returning();
    return updated;
  },
};

export type NoteRepo = typeof noteRepo;
