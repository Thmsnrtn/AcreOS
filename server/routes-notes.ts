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

const paymentTypeSchema = z.enum([
  "regular",
  "partial",
  "extra_principal",
  "payoff",
  "nsf_reversal",
  "unapplied_apply",
]);

const recordPaymentSchema = z.object({
  paymentDate: z.string().min(1),
  // Per-bucket cents. NSF reversals supply negative values; everything else
  // requires non-negative. Validated server-side after type is known.
  principalCents: z.number().int().default(0),
  interestCents: z.number().int().default(0),
  escrowCents: z.number().int().default(0),
  lateFeeCents: z.number().int().default(0),
  unappliedCents: z.number().int().default(0),
  paymentType: paymentTypeSchema.default("regular"),
  originalPaymentId: z.string().min(1).max(64).optional(),
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

// ─── Yield math ──────────────────────────────────────────────────────────────

/**
 * Newton-Raphson IRR. Returns the discount rate that zeroes NPV of the
 * given cash-flow series. Same algorithm as client/src/components/IRRCalculator.tsx
 * (1e-7 tolerance, 1000 iter ceiling). Cash flows are in cents; the period
 * unit (annual vs monthly) is whatever the caller's stream is in — caller
 * converts to annual.
 */
function calcIRR(cashFlows: number[], guess = 0.05): number | null {
  const MAX_ITER = 1000;
  const TOLERANCE = 1e-7;
  let rate = guess;
  for (let i = 0; i < MAX_ITER; i++) {
    let npv = 0;
    let dNpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashFlows[t] / denom;
      if (t > 0) dNpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(dNpv) < 1e-12) return null;
    const newRate = rate - npv / dNpv;
    if (Math.abs(newRate - rate) < TOLERANCE) return newRate;
    rate = newRate;
  }
  return null;
}

interface ComputeYieldsInput {
  acquisitionPriceCents: number;
  currentBalanceCents: number;
  interestRateBps: number;
  paymentAmountCents: number;
  termMonths: number;
  acquisitionDate: string; // ISO
  payments: Array<{ paymentDate: string; principalCents: number; interestCents: number }>;
}

interface ComputeYieldsResult {
  // Decimals (0.085 = 8.5%). Null when the IRR didn't converge.
  currentYield: number;
  ytmAtAcquisition: number | null;
  irrToDate: number | null;
  effectiveNetYield: number | null;
  // Servicing-cost assumption used in the effective-net calc. Null when
  // we don't have enough data to estimate; see implementation notes.
  effectiveNetServicingAssumption: { annualBps: number; note: string } | null;
}

/**
 * Compute the four yield metrics Linnea wants on every note detail page.
 * Pure / unit-testable; called by GET /api/notes/:id/yield.
 */
export function computeYields(input: ComputeYieldsInput): ComputeYieldsResult {
  const {
    acquisitionPriceCents,
    currentBalanceCents,
    interestRateBps,
    paymentAmountCents,
    termMonths,
    acquisitionDate,
    payments,
  } = input;

  // ── Current yield ───────────────────────────────────────────────────────
  // running coupon on basis: (annual interest payment / acquisition price)
  // Approximation: rate * currentBalance / acquisitionPrice.
  const annualInterestCents = (interestRateBps / 10_000) * currentBalanceCents;
  const currentYield = acquisitionPriceCents > 0
    ? annualInterestCents / acquisitionPriceCents
    : 0;

  // ── YTM at acquisition ──────────────────────────────────────────────────
  // IRR over the original projected cash flows: -acquisitionPrice at t=0,
  // then paymentAmountCents per month for termMonths. We compute the
  // monthly IRR, then convert to annual via (1+r_m)^12 - 1.
  const ytmFlowsMonthly: number[] = [-acquisitionPriceCents];
  for (let m = 0; m < termMonths; m++) ytmFlowsMonthly.push(paymentAmountCents);
  const ytmMonthly = calcIRR(ytmFlowsMonthly, 0.005);
  const ytmAtAcquisition = ytmMonthly === null ? null : Math.pow(1 + ytmMonthly, 12) - 1;

  // ── IRR-to-date ─────────────────────────────────────────────────────────
  // Actual cash flows from the payment ledger, plus a terminal "if it pays
  // off today" cash flow equal to the current balance. Periods are months
  // from acquisition. We bucket by month-from-acquisition so a borrower's
  // partial-then-make-whole behavior nets correctly within a month.
  const acqDate = new Date(acquisitionDate);
  const monthsFromAcquisition = (iso: string): number => {
    const d = new Date(iso);
    return (d.getUTCFullYear() - acqDate.getUTCFullYear()) * 12 +
      (d.getUTCMonth() - acqDate.getUTCMonth());
  };
  const monthlyCashIn = new Map<number, number>();
  let maxMonth = 0;
  for (const p of payments) {
    const m = Math.max(0, monthsFromAcquisition(p.paymentDate));
    const cash = p.principalCents + p.interestCents;
    monthlyCashIn.set(m, (monthlyCashIn.get(m) ?? 0) + cash);
    if (m > maxMonth) maxMonth = m;
  }
  const irrFlowsMonthly: number[] = [-acquisitionPriceCents];
  for (let m = 1; m <= Math.max(1, maxMonth); m++) {
    irrFlowsMonthly.push(monthlyCashIn.get(m) ?? 0);
  }
  // Add today's "if-paid-off" terminal value at the next-month bucket.
  irrFlowsMonthly.push(currentBalanceCents);
  const irrMonthly = calcIRR(irrFlowsMonthly, 0.005);
  const irrToDate = irrMonthly === null ? null : Math.pow(1 + irrMonthly, 12) - 1;

  // ── Effective net yield ─────────────────────────────────────────────────
  // Linnea: "net of servicing costs and tax escrow float."
  // We don't track servicing costs as structured data yet — this is the
  // PR-9 / pool-tracking surface where investor-level cost allocation
  // lives. Until then, apply the documented industry-typical 25 bps
  // assumption and label it as such so the user can correct it in their
  // CPA flow. When we add a per-org servicing-cost field, swap the
  // hardcoded value for the org's setting.
  const SERVICING_BPS_DEFAULT = 25; // 0.25% — small-balance secondary market typical
  const effectiveNetYield = irrToDate === null
    ? null
    : Math.max(0, irrToDate - SERVICING_BPS_DEFAULT / 10_000);
  const effectiveNetServicingAssumption = irrToDate === null
    ? null
    : { annualBps: SERVICING_BPS_DEFAULT, note: "industry-typical default; will read from org setting once configurable" };

  return {
    currentYield,
    ytmAtAcquisition,
    irrToDate,
    effectiveNetYield,
    effectiveNetServicingAssumption,
  };
}

// ─── Basis schedule (IRS Pub 1212 — market-discount accretion) ───────────────

interface BasisScheduleRow {
  year: number;
  startingBasisCents: number;
  accretedDiscountCents: number;
  principalReceivedCents: number;
  endingBasisCents: number;
}

interface BasisScheduleInput {
  acquisitionPriceCents: number;
  originalPrincipalCents: number; // face value at acquisition
  acquisitionDate: string;
  maturityDate: string;
  payments: Array<{ paymentDate: string; principalCents: number }>;
  // Method per Pub 1212. 'ratable' = straight-line over remaining term.
  // 'constant_yield' = bond-accounting style; not yet implemented (the
  // ratable election is what most non-bond note investors use).
  method?: "ratable" | "constant_yield";
}

/**
 * Compute the per-year basis schedule for a purchased note.
 *
 * For notes bought at a discount (face > acquisition), the IRS requires
 * market-discount accretion as ordinary income over the remaining life
 * (Pub 1212). Without this, basis at sale is wrong, gain/loss is wrong,
 * and Linnea gets an IRS letter — her exact concern.
 *
 * Ratable method (the default): each year accrues
 *   total_discount × (months_in_year / total_months_remaining_at_acquisition)
 * with months capped to the term ending at maturity.
 */
export function computeBasisSchedule(input: BasisScheduleInput): BasisScheduleRow[] {
  const {
    acquisitionPriceCents,
    originalPrincipalCents,
    acquisitionDate,
    maturityDate,
    payments,
  } = input;

  const totalDiscountCents = originalPrincipalCents - acquisitionPriceCents;

  // Premium (acquisition > face) is a separate code path — bond premium
  // amortization elections under §171 — we don't auto-accrete in that
  // direction; just flat-line the basis.
  if (totalDiscountCents <= 0) {
    return [];
  }

  const acqDate = new Date(acquisitionDate);
  const matDate = new Date(maturityDate);
  const totalMonthsRemainingAtAcquisition = Math.max(
    1,
    (matDate.getUTCFullYear() - acqDate.getUTCFullYear()) * 12 +
      (matDate.getUTCMonth() - acqDate.getUTCMonth()),
  );

  // For each year between acquisition and maturity (inclusive), compute
  // the months that fell in that year. Multiply by per-month accretion.
  const accretionPerMonthCents = totalDiscountCents / totalMonthsRemainingAtAcquisition;

  // Bucket payments by year (only principal — interest is already taxed).
  const principalByYear = new Map<number, number>();
  for (const p of payments) {
    const y = new Date(p.paymentDate).getUTCFullYear();
    principalByYear.set(y, (principalByYear.get(y) ?? 0) + p.principalCents);
  }

  const rows: BasisScheduleRow[] = [];
  let runningBasis = acquisitionPriceCents;

  const startYear = acqDate.getUTCFullYear();
  const endYear = matDate.getUTCFullYear();

  for (let y = startYear; y <= endYear; y++) {
    // Months of this year that fall within (acqDate, matDate].
    const yearStart = new Date(Date.UTC(y, 0, 1));
    const yearEnd = new Date(Date.UTC(y, 11, 31));
    const periodStart = acqDate > yearStart ? acqDate : yearStart;
    const periodEnd = matDate < yearEnd ? matDate : yearEnd;
    const monthsInYear = Math.max(
      0,
      (periodEnd.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 +
        (periodEnd.getUTCMonth() - periodStart.getUTCMonth()) +
        1, // inclusive
    );

    const accretedThisYearCents = Math.round(accretionPerMonthCents * monthsInYear);
    const principalReceivedThisYear = principalByYear.get(y) ?? 0;
    const startingBasis = runningBasis;
    const endingBasis = Math.max(
      0,
      startingBasis + accretedThisYearCents - principalReceivedThisYear,
    );

    rows.push({
      year: y,
      startingBasisCents: startingBasis,
      accretedDiscountCents: accretedThisYearCents,
      principalReceivedCents: principalReceivedThisYear,
      endingBasisCents: endingBasis,
    });

    runningBasis = endingBasis;
  }

  return rows;
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

  // ── List payments (ledger) ───────────────────────────────────────────────
  app.get(
    "/api/notes/:id/payments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        // Confirm the note belongs to this org first.
        const [note] = await db
          .select({ id: acquiredNotes.id })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }
        const rows = await db
          .select()
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(desc(notePayments.paymentDate), desc(notePayments.createdAt));
        return res.json({ payments: rows });
      } catch (err) {
        logger.error("notes.listPayments failed", err instanceof Error ? err : undefined);
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
          .select({
            id: acquiredNotes.id,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
            unappliedBalanceCents: acquiredNotes.unappliedBalanceCents,
            status: acquiredNotes.status,
          })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }

        // Per-type validation. The zod schema accepts negative cents on
        // every type so NSF reversals can pass; here we tighten for the
        // common cases.
        const isReversal = data.paymentType === "nsf_reversal";
        const isUnappliedApply = data.paymentType === "unapplied_apply";
        const allowNegative = isReversal || isUnappliedApply;
        for (const [field, val] of [
          ["principalCents", data.principalCents],
          ["interestCents", data.interestCents],
          ["escrowCents", data.escrowCents],
          ["lateFeeCents", data.lateFeeCents],
        ] as const) {
          if (!allowNegative && val < 0) {
            return Errors.badRequest(res, `${field} must be non-negative for ${data.paymentType} payments`);
          }
        }

        if (isReversal && !data.originalPaymentId) {
          return Errors.badRequest(res, "originalPaymentId is required for nsf_reversal");
        }

        // For 'partial' payments — no principal/interest applied, all into
        // unapplied. We force the buckets to zero so callers can't sneak
        // a regular split through under the partial label.
        if (data.paymentType === "partial") {
          if (data.unappliedCents <= 0) {
            return Errors.badRequest(res, "partial payments must supply a positive unappliedCents");
          }
          if (data.principalCents !== 0 || data.interestCents !== 0) {
            return Errors.badRequest(res, "partial payments don't apply to principal/interest — use 'unapplied_apply' to consume held funds");
          }
        }

        // Extra-principal: principal-only, no other buckets.
        if (data.paymentType === "extra_principal") {
          if (data.principalCents <= 0) {
            return Errors.badRequest(res, "extra_principal must supply a positive principalCents");
          }
          if (data.interestCents !== 0 || data.escrowCents !== 0 || data.lateFeeCents !== 0) {
            return Errors.badRequest(res, "extra_principal payments must be principal-only — clear the other buckets");
          }
        }

        // Unapplied-apply: consumes from unapplied, must be a draw-down.
        if (isUnappliedApply) {
          if (data.unappliedCents >= 0) {
            return Errors.badRequest(res, "unapplied_apply must supply negative unappliedCents (the amount being consumed from the held balance)");
          }
          const drawDown = -data.unappliedCents;
          if (drawDown > (note.unappliedBalanceCents ?? 0)) {
            return Errors.badRequest(res, `unapplied_apply draw of ${drawDown}¢ exceeds available unapplied balance of ${note.unappliedBalanceCents ?? 0}¢`);
          }
        }

        // Insert payment row. Drizzle handles the bigint serialization.
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
            unappliedCents: data.unappliedCents,
            paymentType: data.paymentType,
            originalPaymentId: data.originalPaymentId ?? null,
            paymentMethod: data.paymentMethod,
            referenceNumber: data.referenceNumber ?? null,
            notes: data.notes ?? null,
          })
          .returning();

        // Update denormalized running balances on the note.
        // currentBalance: subtract principal applied (negative principal on
        //   reversal restores balance).
        // unappliedBalance: add unapplied delta (positive on partial,
        //   negative on unapplied_apply or unapplied-restoring reversal).
        // status flips to 'paid_off' on a payoff that zeroes the balance.
        const newCurrentBalance = Math.max(
          0,
          (note.currentBalanceCents ?? 0) - data.principalCents,
        );
        const newUnappliedBalance = Math.max(
          0,
          (note.unappliedBalanceCents ?? 0) + data.unappliedCents,
        );
        const updates: Partial<typeof acquiredNotes.$inferInsert> = {
          currentBalanceCents: newCurrentBalance,
          unappliedBalanceCents: newUnappliedBalance,
          updatedAt: new Date(),
        };
        if (data.paymentType === "payoff" && newCurrentBalance === 0) {
          updates.status = "paid_off";
        }
        await db
          .update(acquiredNotes)
          .set(updates)
          .where(eq(acquiredNotes.id, id));

        return res.status(201).json({
          payment: row,
          currentBalanceCents: newCurrentBalance,
          unappliedBalanceCents: newUnappliedBalance,
          status: updates.status ?? note.status,
        });
      } catch (err) {
        logger.error("notes.recordPayment failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Basis schedule (Pub 1212 market-discount accretion) ──────────────────
  app.get(
    "/api/notes/:id/basis",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const method = (req.query.method === "constant_yield" ? "constant_yield" : "ratable") as
          | "ratable"
          | "constant_yield";

        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        const payments = await db
          .select({
            paymentDate: notePayments.paymentDate,
            principalCents: notePayments.principalCents,
          })
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(notePayments.paymentDate);

        const schedule = computeBasisSchedule({
          acquisitionPriceCents: note.acquisitionPriceCents,
          originalPrincipalCents: note.originalPrincipalCents,
          acquisitionDate: note.acquisitionDate as unknown as string,
          maturityDate: note.maturityDate as unknown as string,
          payments: payments.map((p) => ({
            paymentDate: p.paymentDate as unknown as string,
            principalCents: p.principalCents,
          })),
          method,
        });

        const totalDiscountCents = note.originalPrincipalCents - note.acquisitionPriceCents;
        return res.json({
          noteId: id,
          method,
          totalDiscountCents,
          isPremium: totalDiscountCents < 0,
          schedule,
        });
      } catch (err) {
        logger.error("notes.basis failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Yield panel (current / YTM / IRR-to-date / effective net) ────────────
  // Linnea: "every note's detail page should show all four yield metrics
  // computed live from its actual payment history. That's table stakes."
  app.get(
    "/api/notes/:id/yield",
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
        if (!note) return Errors.notFound(res, "Note");

        const payments = await db
          .select()
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(notePayments.paymentDate);

        const yields = computeYields({
          acquisitionPriceCents: note.acquisitionPriceCents,
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonths: note.termMonths,
          acquisitionDate: note.acquisitionDate as unknown as string,
          payments: payments.map((p) => ({
            paymentDate: p.paymentDate as unknown as string,
            principalCents: p.principalCents,
            interestCents: p.interestCents,
            // Escrow + late fee don't reduce the asset, so they're excluded
            // from the IRR cash-flow stream from Linnea's perspective.
          })),
        });

        return res.json({ noteId: id, ...yields });
      } catch (err) {
        logger.error("notes.yield failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Payoff calculator ────────────────────────────────────────────────────
  // GET /api/notes/:id/payoff?date=YYYY-MM-DD
  // Returns the dollar amount required to fully settle the note as of the
  // requested close date — principal + accrued interest through that date
  // − unapplied funds held. Linnea: "Borrower calls Tuesday. 'What's my
  // payoff if I close Friday at 2 PM?' I need a payoff calculator. One
  // button." This is the one-button.
  app.get(
    "/api/notes/:id/payoff",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const dateParam = (req.query.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
        const closeDate = new Date(dateParam);
        if (isNaN(closeDate.getTime())) {
          return Errors.badRequest(res, "date must be a valid ISO date (YYYY-MM-DD)");
        }

        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }

        // Find the most recent payment that included an interest component;
        // accrued-interest base = days since that payment * daily rate *
        // current balance. If no prior payments, accrue from origination.
        const lastInterestRow = await db
          .select({ paymentDate: notePayments.paymentDate })
          .from(notePayments)
          .where(and(eq(notePayments.noteId, id), sql`${notePayments.interestCents} > 0`))
          .orderBy(desc(notePayments.paymentDate))
          .limit(1);

        const accrualStart = new Date(
          lastInterestRow[0]?.paymentDate
            ? (lastInterestRow[0].paymentDate as unknown as string)
            : (note.originationDate as unknown as string),
        );
        const daysAccrued = Math.max(
          0,
          Math.round((closeDate.getTime() - accrualStart.getTime()) / 86_400_000),
        );

        // Daily interest = balance * (annualRateBps / 10000) / 365
        const annualRate = note.interestRateBps / 10_000;
        const dailyRateCents = (note.currentBalanceCents * annualRate) / 365;
        const accruedInterestCents = Math.round(dailyRateCents * daysAccrued);

        const principalCents = note.currentBalanceCents;
        const unappliedCreditCents = note.unappliedBalanceCents ?? 0;
        // Late fees outstanding: track by summing lateFeeCents and netting
        // off any reversed/applied. For now, lateFeeCents on the ledger sums.
        const lateFeeRows = await db
          .select({ sum: sql<number>`COALESCE(SUM(${notePayments.lateFeeCents}), 0)::bigint` })
          .from(notePayments)
          .where(eq(notePayments.noteId, id));
        const lateFeesAppliedCents = Number(lateFeeRows[0]?.sum ?? 0);

        const totalPayoffCents =
          principalCents + accruedInterestCents - unappliedCreditCents;

        return res.json({
          asOf: dateParam,
          principalCents,
          accruedInterestCents,
          unappliedCreditCents,
          lateFeesAppliedToDateCents: lateFeesAppliedCents,
          totalPayoffCents: Math.max(0, totalPayoffCents),
          daysAccrued,
          accrualStart: accrualStart.toISOString().slice(0, 10),
          dailyInterestCents: Math.round(dailyRateCents),
        });
      } catch (err) {
        logger.error("notes.payoff failed", err instanceof Error ? err : undefined);
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
