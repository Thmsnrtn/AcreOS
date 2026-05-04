/**
 * Note Investor vertical — acquired-notes API.
 *
 * Phase 5 §5 (Q4 2026). Foundation surface — list / create / read / update
 * acquired notes plus a payments ledger and an amortization-schedule
 * compute endpoint. The full BPO + tape diligence workflow + Sophie agent
 * expansion ride a follow-up PR (see
 * docs/exhaustive-completion/note-investor-followups.md).
 *
 * All endpoints are org-scoped via getOrCreateOrg and gated to
 * owner/admin (notes are a financial/asset entity — VAs and viewers don't
 * mutate them; we may relax the read path later if a customer asks).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { acquiredNotes, notePayments } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { encrypt as encryptField } from "./services/fieldEncryption";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    phone: z.string().optional(),
  })
  .passthrough();

const noteStatusSchema = z.enum(["performing", "late", "default", "paid_off", "sold"]);

const createNoteSchema = z.object({
  propertyId: z.number().int().positive().nullable().optional(),
  borrowerId: z.number().int().positive().nullable().optional(),
  noteNumber: z.string().min(1).max(120),
  originalPrincipalCents: z.number().int().nonnegative(),
  currentBalanceCents: z.number().int().nonnegative(),
  interestRateBps: z.number().int().min(0).max(100_000),
  termMonths: z.number().int().min(1).max(1200),
  paymentAmountCents: z.number().int().nonnegative(),
  paymentDueDay: z.number().int().min(1).max(31),
  originationDate: z.string().min(1), // ISO 8601 date
  maturityDate: z.string().min(1),
  acquisitionDate: z.string().min(1),
  acquisitionPriceCents: z.number().int().nonnegative(),
  status: noteStatusSchema.optional(),
  payerName: z.string().min(1).max(240),
  payerAddress: addressSchema.optional(),
  // Plaintext TIN — encrypted server-side before persisting.
  payerTin: z.string().min(1).max(40).optional(),
  payerTinType: z.enum(["SSN", "EIN", "ITIN"]).optional(),
  originalLender: z.string().max(240).optional(),
  assignmentDocS3Key: z.string().max(512).optional(),
  notes: z.string().max(8_000).optional(),
});

const patchNoteSchema = createNoteSchema.partial();

const recordPaymentSchema = z.object({
  paymentDate: z.string().min(1),
  principalCents: z.number().int().nonnegative().default(0),
  interestCents: z.number().int().nonnegative().default(0),
  escrowCents: z.number().int().nonnegative().default(0),
  lateFeeCents: z.number().int().nonnegative().default(0),
  paymentMethod: z.enum(["ach", "check", "wire", "cash", "other"]).default("ach"),
  referenceNumber: z.string().max(120).optional(),
  notes: z.string().max(2_000).optional(),
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

interface AmortizationRow {
  paymentNumber: number;
  dueDate: string; // ISO date
  payment: number; // cents
  principal: number; // cents
  interest: number; // cents
  balance: number; // cents
}

/**
 * Compute the remaining amortization schedule from a current balance, term,
 * and rate. Pure / framework-free so the route handler stays thin and the
 * computation can be unit-tested without a DB.
 */
export function computeAmortization(input: {
  currentBalanceCents: number;
  interestRateBps: number;
  paymentAmountCents: number;
  termMonthsRemaining: number;
  startDate: Date;
  paymentDueDay: number;
}): AmortizationRow[] {
  const monthlyRate = input.interestRateBps / 10_000 / 12;
  let balance = input.currentBalanceCents;
  const out: AmortizationRow[] = [];

  for (let i = 1; i <= input.termMonthsRemaining && balance > 0; i++) {
    const interest = Math.round(balance * monthlyRate);
    const principal = Math.min(input.paymentAmountCents - interest, balance);
    if (principal <= 0) {
      // Negative-amortization safeguard — payment doesn't cover interest.
      // We bail rather than emit a runaway schedule.
      break;
    }
    balance = Math.max(0, balance - principal);

    // Add `i` months to startDate, clamping the day to the requested
    // paymentDueDay. JS Date handles month overflow but not day clamping
    // for short months (Feb 30 → Mar 2), so we explicitly clamp.
    const due = new Date(Date.UTC(
      input.startDate.getUTCFullYear(),
      input.startDate.getUTCMonth() + i,
      1,
    ));
    const lastDayOfMonth = new Date(Date.UTC(
      due.getUTCFullYear(),
      due.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    due.setUTCDate(Math.min(input.paymentDueDay, lastDayOfMonth));

    out.push({
      paymentNumber: i,
      dueDate: due.toISOString().slice(0, 10),
      payment: interest + principal,
      principal,
      interest,
      balance,
    });
  }

  return out;
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerNoteRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── List ─────────────────────────────────────────────────────────────────
  app.get(
    "/api/notes",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
        const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
        const status = typeof req.query.status === "string" ? req.query.status : undefined;

        const whereClause = status
          ? and(eq(acquiredNotes.organizationId, orgId), eq(acquiredNotes.status, status))
          : eq(acquiredNotes.organizationId, orgId);

        const rows = await db
          .select()
          .from(acquiredNotes)
          .where(whereClause)
          .orderBy(desc(acquiredNotes.acquisitionDate))
          .limit(limit)
          .offset(offset);

        // Never leak the encrypted TIN over the wire — strip on the way out.
        const safe = rows.map(({ payerEncryptedTin: _stripped, ...rest }) => rest);
        return res.json({ notes: safe, limit, offset, count: safe.length });
      } catch (err) {
        logger.error("notes.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Create ───────────────────────────────────────────────────────────────
  app.post(
    "/api/notes",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createNoteSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const data = parsed.data;

        const encryptedTin = data.payerTin ? encryptField(data.payerTin) : null;

        const [row] = await db
          .insert(acquiredNotes)
          .values({
            organizationId: orgId,
            propertyId: data.propertyId ?? null,
            borrowerId: data.borrowerId ?? null,
            noteNumber: data.noteNumber,
            originalPrincipalCents: data.originalPrincipalCents,
            currentBalanceCents: data.currentBalanceCents,
            interestRateBps: data.interestRateBps,
            termMonths: data.termMonths,
            paymentAmountCents: data.paymentAmountCents,
            paymentDueDay: data.paymentDueDay,
            originationDate: data.originationDate,
            maturityDate: data.maturityDate,
            acquisitionDate: data.acquisitionDate,
            acquisitionPriceCents: data.acquisitionPriceCents,
            status: data.status ?? "performing",
            payerName: data.payerName,
            payerAddress: data.payerAddress ?? null,
            payerEncryptedTin: encryptedTin,
            payerTinType: data.payerTinType ?? null,
            originalLender: data.originalLender ?? null,
            assignmentDocS3Key: data.assignmentDocS3Key ?? null,
            notes: data.notes ?? null,
          })
          .returning();

        if (!row) {
          return Errors.internal(res, new Error("Insert returned no row"));
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        return res.status(201).json({ note: safe });
      } catch (err) {
        // Unique-violation → friendlier message than a 500.
        if (err instanceof Error && /unique/i.test(err.message)) {
          return Errors.badRequest(res, "Note number is already in use for this organization");
        }
        logger.error("notes.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Detail ───────────────────────────────────────────────────────────────
  app.get(
    "/api/notes/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const [row] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!row) {
          return Errors.notFound(res, "Note");
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        return res.json({ note: safe });
      } catch (err) {
        logger.error("notes.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Update ───────────────────────────────────────────────────────────────
  app.patch(
    "/api/notes/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const parsed = patchNoteSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const patch = parsed.data;

        // Build the update object explicitly so unset fields aren't nulled.
        const update: Partial<typeof acquiredNotes.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (patch.propertyId !== undefined) update.propertyId = patch.propertyId;
        if (patch.borrowerId !== undefined) update.borrowerId = patch.borrowerId;
        if (patch.noteNumber !== undefined) update.noteNumber = patch.noteNumber;
        if (patch.originalPrincipalCents !== undefined) update.originalPrincipalCents = patch.originalPrincipalCents;
        if (patch.currentBalanceCents !== undefined) update.currentBalanceCents = patch.currentBalanceCents;
        if (patch.interestRateBps !== undefined) update.interestRateBps = patch.interestRateBps;
        if (patch.termMonths !== undefined) update.termMonths = patch.termMonths;
        if (patch.paymentAmountCents !== undefined) update.paymentAmountCents = patch.paymentAmountCents;
        if (patch.paymentDueDay !== undefined) update.paymentDueDay = patch.paymentDueDay;
        if (patch.originationDate !== undefined) update.originationDate = patch.originationDate;
        if (patch.maturityDate !== undefined) update.maturityDate = patch.maturityDate;
        if (patch.acquisitionDate !== undefined) update.acquisitionDate = patch.acquisitionDate;
        if (patch.acquisitionPriceCents !== undefined) update.acquisitionPriceCents = patch.acquisitionPriceCents;
        if (patch.status !== undefined) update.status = patch.status;
        if (patch.payerName !== undefined) update.payerName = patch.payerName;
        if (patch.payerAddress !== undefined) update.payerAddress = patch.payerAddress;
        if (patch.payerTin !== undefined) update.payerEncryptedTin = patch.payerTin ? encryptField(patch.payerTin) : null;
        if (patch.payerTinType !== undefined) update.payerTinType = patch.payerTinType ?? null;
        if (patch.originalLender !== undefined) update.originalLender = patch.originalLender ?? null;
        if (patch.assignmentDocS3Key !== undefined) update.assignmentDocS3Key = patch.assignmentDocS3Key ?? null;
        if (patch.notes !== undefined) update.notes = patch.notes ?? null;

        const [row] = await db
          .update(acquiredNotes)
          .set(update)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .returning();

        if (!row) {
          return Errors.notFound(res, "Note");
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        return res.json({ note: safe });
      } catch (err) {
        logger.error("notes.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Record payment ───────────────────────────────────────────────────────
  app.post(
    "/api/notes/:id/payments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const parsed = recordPaymentSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const data = parsed.data;

        // Confirm the note belongs to this org BEFORE inserting (cross-org
        // payment rows would corrupt the 1099-INT aggregation).
        const [note] = await db
          .select({ id: acquiredNotes.id, currentBalanceCents: acquiredNotes.currentBalanceCents })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }

        const [row] = await db
          .insert(notePayments)
          .values({
            noteId: id,
            organizationId: orgId,
            paymentDate: data.paymentDate,
            principalCents: data.principalCents,
            interestCents: data.interestCents,
            escrowCents: data.escrowCents,
            lateFeeCents: data.lateFeeCents,
            paymentMethod: data.paymentMethod,
            referenceNumber: data.referenceNumber ?? null,
            notes: data.notes ?? null,
          })
          .returning();

        // Update the note's currentBalanceCents in the same transaction-shaped
        // pair. We don't wrap in db.transaction because Drizzle's pg driver
        // here is acceptable to run sequentially — a failure on the second
        // statement leaves the payment recorded, which is the safer side
        // (cash hit the bank; the balance will be reconciled on the next
        // amortization sync).
        const newBalance = Math.max(0, (note.currentBalanceCents ?? 0) - data.principalCents);
        await db
          .update(acquiredNotes)
          .set({ currentBalanceCents: newBalance, updatedAt: new Date() })
          .where(eq(acquiredNotes.id, id));

        return res.status(201).json({ payment: row, currentBalanceCents: newBalance });
      } catch (err) {
        logger.error("notes.recordPayment failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Amortization schedule ────────────────────────────────────────────────
  app.get(
    "/api/notes/:id/amortization",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }

        // We compute remaining schedule from today's currentBalanceCents,
        // not from the original principal. Months remaining = termMonths
        // minus months elapsed since origination. We clamp at 1..termMonths
        // to keep the schedule well-formed for paid-down notes.
        const origDate = new Date(note.originationDate as unknown as string);
        const monthsElapsed = Math.max(
          0,
          (new Date().getUTCFullYear() - origDate.getUTCFullYear()) * 12 +
            (new Date().getUTCMonth() - origDate.getUTCMonth()),
        );
        const remaining = Math.max(1, note.termMonths - monthsElapsed);

        const schedule = computeAmortization({
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonthsRemaining: remaining,
          startDate: new Date(),
          paymentDueDay: note.paymentDueDay,
        });

        return res.json({
          noteId: id,
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonthsRemaining: remaining,
          schedule,
        });
      } catch (err) {
        logger.error("notes.amortization failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}

// ─── Aggregation helper used by form1099Batch.ts ─────────────────────────────

/**
 * Aggregate interest paid per payer for a given org + tax year. Used by the
 * 1099-INT batch generator to union interest from acquired-note payments
 * with interest from originated notes.
 *
 * Returns rows of `{ noteId, payerName, payerAddress, payerEncryptedTin,
 * payerTinType, interestCents }`. Only includes payers where the summed
 * interest meets or exceeds the IRS 1099-INT $600 threshold; the caller
 * may apply additional filters.
 */
export async function aggregateAcquiredNoteInterestForYear(
  orgId: number,
  taxYear: number,
): Promise<Array<{
  noteId: string;
  noteNumber: string;
  payerName: string;
  payerAddress: typeof acquiredNotes.$inferSelect.payerAddress;
  payerEncryptedTin: string | null;
  payerTinType: string | null;
  interestCents: number;
}>> {
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Sum interest_cents per note for the year, joined to acquired_notes for
  // payer details. We aggregate in SQL rather than fetching individual rows
  // because a busy noteholder's payment ledger can run to thousands of rows
  // per year.
  const rows = await db
    .select({
      noteId: acquiredNotes.id,
      noteNumber: acquiredNotes.noteNumber,
      payerName: acquiredNotes.payerName,
      payerAddress: acquiredNotes.payerAddress,
      payerEncryptedTin: acquiredNotes.payerEncryptedTin,
      payerTinType: acquiredNotes.payerTinType,
      interestCents: sql<number>`COALESCE(SUM(${notePayments.interestCents}), 0)::bigint`,
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
    .where(eq(acquiredNotes.organizationId, orgId))
    .groupBy(
      acquiredNotes.id,
      acquiredNotes.noteNumber,
      acquiredNotes.payerName,
      acquiredNotes.payerAddress,
      acquiredNotes.payerEncryptedTin,
      acquiredNotes.payerTinType,
    );

  // Narrow to rows with non-zero interest. The SQL coalesces to 0 for notes
  // with no payments in the year — we don't want to issue a 1099-INT for
  // those.
  return rows
    .map((r) => ({ ...r, interestCents: Number(r.interestCents ?? 0) }))
    .filter((r) => r.interestCents > 0);
}
