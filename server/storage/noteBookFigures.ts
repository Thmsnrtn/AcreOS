/**
 * Book-wide note figures for the note personas' widgets (W10.2b audit).
 *
 * The map strip and dashboard widgets summed GET /api/notes — the capped,
 * newest-5,000 list kept as the notes TABLE payload — into "outstanding",
 * "monthly income", "financed", a balance-weighted rate and "most
 * delinquent". Past 5,000 notes each figure silently left the oldest notes
 * out. These are the same figures as one SQL aggregate over every active
 * note of the org.
 *
 * Population: the org's notes with status 'active' — what the widgets
 * filtered /api/notes to. /api/notes applies no sample filter, so neither
 * does this; the figures stay the ones the widgets showed, made whole.
 *
 * The Finance hero (PersonaFinanceHero) summed the same capped list through
 * personaFinanceMetrics; its figures are here too, each over the population
 * the hero used — EVERY note (any status) for the originator's book and the
 * escrow sums, active notes for the rest.
 */
import { and, count, desc, asc, eq, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { leads, notes } from "@shared/schema";
import { liveLead } from "./liveLeads";
import { originationWindow, resolveTimeZone } from "./zonedMonths";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NoteBookFigures {
  activeCount: number;
  /** Σ currentBalance (dollars, as the notes carry it). */
  totalOutstanding: number;
  /** Σ monthlyPayment. */
  totalMonthly: number;
  /** Σ (originalPrincipal || currentBalance). */
  totalFinanced: number;
  /** Σ(balance × rate) / Σ balance over notes with balance > 0 and rate > 0; null when none. */
  weightedRate: number | null;
  /** Mean rate over notes with rate > 0; null when none. */
  averageRate: number | null;
  /** Mean term over notes with term > 0 (unrounded); null when none. */
  averageTermMonths: number | null;
  /** Off the "current" delinquency rung, or a whole day past the next due date. */
  delinquentCount: number;
  /** Σ serviceFee (monthly). */
  totalServiceFees: number;
  taxEscrowCount: number;
  /** The active note longest past its next due date (≥ 1 whole day), or null. */
  mostDelinquent: {
    id: number;
    borrowerId: number | null;
    borrowerName: string | null;
    nextPaymentDate: string;
    daysLate: number;
  } | null;

  // ── The Finance hero's figures ──
  /** Σ(interestRate × currentBalance) / Σ currentBalance over EVERY active note; null when Σ balance ≤ 0. */
  bookYield: number | null;
  /** Active notes with serviceFee > 0 — whether a fee schedule exists at all. */
  feeScheduledCount: number;
  /** Every note of the org, any status. */
  notesWritten: number;
  /** Σ originalPrincipal over every note. */
  capitalDeployed: number;
  /** Σ(interestRate × originalPrincipal) / Σ originalPrincipal over every note; null when Σ ≤ 0. */
  principalWeightedRate: number | null;
  /** Σ(termMonths × originalPrincipal) / Σ originalPrincipal over every note; null when Σ ≤ 0. */
  principalWeightedTermMonths: number | null;
  /** Every note with tax escrow enabled, and Σ of their escrow balances. */
  escrowAccounts: number;
  escrowUnderManagement: number;
  /** Σ originalPrincipal by created-at month — the trailing 12 months in `originationTimeZone`. */
  originationVolume: { month: string; amount: number }[];
  /** Notes created inside that window (0 → the strip is an honest empty). */
  originationsInWindow: number;
  /** The zone the months were cut in: the viewer's, or UTC when none/unknown was sent. */
  originationTimeZone: string;
}

function activeNotesOf(orgId: number): SQL {
  return and(eq(notes.organizationId, orgId), eq(notes.status, "active")) as SQL;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export async function noteBookFigures(orgId: number, now: Date, timeZone?: unknown): Promise<NoteBookFigures> {
  const tz = resolveTimeZone(timeZone);
  const months = originationWindow(now, tz);
  const inMonth = (from: string, to: string) =>
    sql`${notes.createdAt} >= ${from} and ${notes.createdAt} < ${to}`;
  // The client counted a note late when floor((now - due) / day) > 0, i.e.
  // due at least one whole day ago. Bound as the ISO string the column
  // helpers bind (UTC), never a raw Date (node-pg would format it local).
  const lateBefore = new Date(now.getTime() - DAY_MS);
  const rated = sql`${notes.currentBalance} > 0 and ${notes.interestRate} > 0`;
  const [[agg], worst, [book]] = await Promise.all([
    db
      .select({
        activeCount: count(),
        totalOutstanding: sql<string>`coalesce(sum(${notes.currentBalance}), 0)`,
        totalMonthly: sql<string>`coalesce(sum(${notes.monthlyPayment}), 0)`,
        // The widgets summed `originalPrincipal || currentBalance || 0`.
        // original_principal is NOT NULL numeric — a string client-side,
        // truthy even at "0" — so the || chain never fell through and
        // coalesce picks the same value.
        totalFinanced: sql<string>`coalesce(sum(coalesce(${notes.originalPrincipal}, ${notes.currentBalance}, 0)), 0)`,
        rateWeightedBalance: sql<string | null>`sum(${notes.currentBalance} * ${notes.interestRate}) filter (where ${rated})`,
        rateWeight: sql<string | null>`sum(${notes.currentBalance}) filter (where ${rated})`,
        averageRate: sql<string | null>`avg(${notes.interestRate}) filter (where ${notes.interestRate} > 0)`,
        averageTermMonths: sql<string | null>`avg(${notes.termMonths}) filter (where ${notes.termMonths} > 0)`,
        // The client's `delinquencyStatus && delinquencyStatus !== "current"`
        // (an empty status is not a rung) or a whole day past due.
        delinquentCount: sql<number>`count(*) filter (where coalesce(${notes.delinquencyStatus}, '') not in ('', 'current') or ${notes.nextPaymentDate} <= ${lateBefore.toISOString()})`,
        totalServiceFees: sql<string>`coalesce(sum(${notes.serviceFee}), 0)`,
        taxEscrowCount: sql<number>`count(*) filter (where ${notes.taxEscrowEnabled})`,
        // The hero's book yield weighted EVERY active note by its balance —
        // unlike rateWeightedBalance, no rate/balance > 0 filter.
        rateTimesBalance: sql<string | null>`sum(${notes.interestRate} * ${notes.currentBalance})`,
        feeScheduledCount: sql<number>`count(*) filter (where ${notes.serviceFee} > 0)`,
      })
      .from(notes)
      .where(activeNotesOf(orgId)),
    db
      .select({
        id: notes.id,
        borrowerId: notes.borrowerId,
        nextPaymentDate: notes.nextPaymentDate,
        borrowerFirstName: leads.firstName,
        borrowerLastName: leads.lastName,
      })
      .from(notes)
      .leftJoin(leads, and(eq(leads.id, notes.borrowerId), eq(leads.organizationId, orgId), liveLead()))
      .where(and(activeNotesOf(orgId), lte(notes.nextPaymentDate, lateBefore)) as SQL)
      // Oldest due date = most days late. Ties fall to the newest note, the
      // first one the client met walking its newest-first list.
      .orderBy(asc(notes.nextPaymentDate), desc(notes.createdAt), desc(notes.id))
      .limit(1),
    // The hero's every-note figures: no status filter — the originator's
    // "notes written" and capital deployed, and escrow held, counted every
    // note /api/notes returned, whatever its status.
    db
      .select({
        notesWritten: count(),
        capitalDeployed: sql<string>`coalesce(sum(${notes.originalPrincipal}), 0)`,
        rateTimesPrincipal: sql<string | null>`sum(${notes.interestRate} * ${notes.originalPrincipal})`,
        termTimesPrincipal: sql<string | null>`sum(${notes.termMonths} * ${notes.originalPrincipal})`,
        escrowAccounts: sql<number>`count(*) filter (where ${notes.taxEscrowEnabled})`,
        escrowUnderManagement: sql<string>`coalesce(sum(${notes.taxEscrowBalance}) filter (where ${notes.taxEscrowEnabled}), 0)`,
        ...Object.fromEntries(
          months.map((w, i) => [
            `volume${i}`,
            sql<string>`coalesce(sum(${notes.originalPrincipal}) filter (where ${inMonth(w.from, w.to)}), 0)`,
          ]),
        ),
        originationsInWindow: sql<number>`count(*) filter (where ${inMonth(months[0].from, months[11].to)})`,
      })
      .from(notes)
      .where(eq(notes.organizationId, orgId)),
  ]);

  const weight = numOrNull(agg?.rateWeight);
  const outstanding = num(agg?.totalOutstanding);
  const deployed = num(book?.capitalDeployed);
  const bookRow = (book ?? {}) as Record<string, unknown>;
  const w = worst[0];
  const due = w?.nextPaymentDate ? new Date(w.nextPaymentDate) : null;
  const name = [w?.borrowerFirstName, w?.borrowerLastName].filter(Boolean).join(" ");
  return {
    activeCount: num(agg?.activeCount),
    totalOutstanding: outstanding,
    totalMonthly: num(agg?.totalMonthly),
    totalFinanced: num(agg?.totalFinanced),
    weightedRate: weight !== null && weight > 0 ? num(agg?.rateWeightedBalance) / weight : null,
    averageRate: numOrNull(agg?.averageRate),
    averageTermMonths: numOrNull(agg?.averageTermMonths),
    delinquentCount: num(agg?.delinquentCount),
    totalServiceFees: num(agg?.totalServiceFees),
    taxEscrowCount: num(agg?.taxEscrowCount),
    mostDelinquent:
      w && due
        ? {
            id: w.id,
            borrowerId: w.borrowerId ?? null,
            borrowerName: name || null,
            nextPaymentDate: due.toISOString(),
            daysLate: Math.floor((now.getTime() - due.getTime()) / DAY_MS),
          }
        : null,
    bookYield: outstanding > 0 ? num(agg?.rateTimesBalance) / outstanding : null,
    feeScheduledCount: num(agg?.feeScheduledCount),
    notesWritten: num(book?.notesWritten),
    capitalDeployed: deployed,
    principalWeightedRate: deployed > 0 ? num(book?.rateTimesPrincipal) / deployed : null,
    principalWeightedTermMonths: deployed > 0 ? num(book?.termTimesPrincipal) / deployed : null,
    escrowAccounts: num(book?.escrowAccounts),
    escrowUnderManagement: num(book?.escrowUnderManagement),
    originationVolume: months.map((w, i) => ({ month: w.month, amount: num(bookRow[`volume${i}`]) })),
    originationsInWindow: num(book?.originationsInWindow),
    originationTimeZone: tz,
  };
}
