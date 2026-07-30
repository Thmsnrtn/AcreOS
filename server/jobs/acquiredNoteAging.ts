/**
 * Acquired-note aging sweep — the daily job that gives the acquired book an
 * aging truth it has never had.
 *
 * WHAT WAS BROKEN
 * ---------------
 * Nothing in this repo ever wrote `'late'` or `'default'` to
 * `acquired_notes.status`. The ONLY automatic status write anywhere was
 * `paid_off` in server/routes-notes.ts (the payoff branch of the payment
 * recorder). So a note six months down and a note paid current rendered
 * identically on every surface — same badge, same colour, same list position.
 * The delinquency columns existed and stayed at their defaults forever.
 *
 * WHAT THIS JOB DOES, PER NOTE
 * ----------------------------
 *   1. Recomputes `nextPaymentDate` from the note's OWN facts via
 *      `deriveNextPaymentDate` (paid-through, first-payment anchor, due day,
 *      maturity cap). Deliberately keeps a PAST date past — being overdue is
 *      the signal, and rolling it forward is the fabrication this whole
 *      structural build exists to remove.
 *   2. Recomputes `daysDelinquent` + `delinquencyStatus` via
 *      `computeNoteDelinquency` (grace-aware).
 *   3. Derives `status` from the band: performing ⇄ late ⇄ default.
 *   4. Writes back ONLY the fields that actually changed, and skips the UPDATE
 *      entirely when nothing did. A no-op write per note per day is pure write
 *      amplification on a table the whole book reads.
 *   5. Emits `payment.missed` (the existing typed workflow emitter) on a REAL
 *      worsening transition — never on a re-run, never on a recovery.
 *   6. Calls `flagEarlyIntervention` at the RESPA §1024.39 day-36 gate. That
 *      module was correct and had ZERO production callers because nothing in
 *      the system could hand it a `daysDelinquent`. This job is its caller.
 *   7. Computes the late-fee ADVISORY and counts it. Charges nothing.
 *
 * THREE RULES THAT ARE NOT NEGOTIABLE
 * -----------------------------------
 *   • TERMINAL STATES ARE TERMINAL. A `paid_off` or `sold` note is never
 *     touched — not its status, not its delinquency, not its dates. The book
 *     is done with it and an aging sweep resurrecting a sold note as "late"
 *     would be a fabricated obligation against a borrower who owes us nothing.
 *   • UNKNOWN IS NOT LATE. When `deriveNextPaymentDate` returns null it means
 *     "we do not know" (bad/absent import facts) or "paid through maturity".
 *     Neither is delinquency. We clear the unsupported stored date so the UI
 *     renders an honest blank, and we assert NOTHING about delinquency or
 *     status — the delinquency columns are NOT NULL and have no "unknown"
 *     value, so the least-wrong action is to leave the last thing we actually
 *     knew in place rather than stamp "current" over a note we cannot read.
 *   • NO MONEY MOVES. Founder ruling #15 (be the rail, not the provider) plus
 *     the rentals precedent: a late fee is a PROPOSAL an operator confirms on
 *     their own rails, never an automatic charge. This job inserts no fee row,
 *     touches no ledger, and moves nothing. `lateFeeAdvisories` in the summary
 *     is a count of notes where a fee WOULD be assessable — that is all.
 *
 * A NOTE ON THE JOB ROSTER (deliberate, and a follow-up)
 * -----------------------------------------------------
 * This module owns its own process/start pair on the shared runtime, the same
 * convention as achAutopayRun.ts / workflowDelayResume.ts, because
 * runScheduledJobs.ts is under a strictly-DOWN line-count ratchet. It takes the
 * job lock under the literal `"acquired_note_aging"`. That name is NOT yet in
 * `JOB_ROSTER` (server/jobs/jobRegistry.ts) and this file is not yet in
 * jobRosterCoverage.test.ts's SCANNED_FILES — both files are outside this
 * change's file set. Until a follow-up adds the roster row, the deadman cannot
 * page on this job going dark. Said out loud here rather than left to be
 * discovered.
 */

import { and, asc, eq, inArray, not } from "drizzle-orm";
import { db } from "../db";
import { acquiredNotes } from "@shared/schema/notes-vertical";
import { logger } from "../utils/logger";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import {
  computeNoteDelinquency,
  deriveNextPaymentDate,
  lateFeeAssessable,
  type AcquiredNoteScheduleFacts,
  type NoteDelinquencyStatus,
} from "../services/notes/acquiredNoteSchedule";
import {
  EARLY_INTERVENTION_TRIGGER_DAY,
  flagEarlyIntervention,
} from "../services/respa/earlyIntervention";
import { emitPaymentEvent } from "../services/workflow-engine";

/** The lock / roster key. */
export const ACQUIRED_NOTE_AGING_JOB_NAME = "acquired_note_aging";

/**
 * Statuses the sweep refuses to touch. A note here is out of the servicing
 * lifecycle; re-aging it would invent an obligation.
 */
export const TERMINAL_NOTE_STATUSES = ["paid_off", "sold"] as const;

/** The three statuses this job is allowed to move a note between. */
export const AGEABLE_NOTE_STATUSES = ["performing", "late", "default"] as const;
export type AgeableNoteStatus = (typeof AGEABLE_NOTE_STATUSES)[number];

/**
 * Band → status. `late` once the borrower is past grace at all; `default`
 * only at `default_candidate` (31+ days past grace), which is the same
 * threshold the originated book uses. Shared with the payment path in
 * server/routes-notes.ts so a payment that clears arrears and the nightly
 * sweep can never disagree about what "late" means.
 */
export function noteStatusForDelinquency(
  band: NoteDelinquencyStatus,
): AgeableNoteStatus {
  if (band === "current") return "performing";
  if (band === "default_candidate") return "default";
  return "late";
}

/** True when a status transition is a WORSENING one (the only kind we announce). */
export function isWorseningTransition(
  from: string,
  to: AgeableNoteStatus,
): boolean {
  const rank: Record<string, number> = { performing: 0, late: 1, default: 2 };
  const a = rank[from];
  const b = rank[to];
  if (a === undefined || b === undefined) return false;
  return b > a;
}

/** The columns the sweep reads. Narrow on purpose — no TINs, no jsonb. */
export interface AgingNoteRow {
  id: string;
  organizationId: number;
  noteNumber: string | null;
  status: string;
  paymentDueDay: number | null;
  originationDate: string | null;
  maturityDate: string | null;
  /** NOT NULL on the table, but nullable here so a malformed row is skipped
   *  rather than throwing mid-sweep. It is load-bearing: a note acquired long
   *  after origination has servicing history AcreOS never saw, and the
   *  schedule module refuses a date rather than inventing one. */
  acquisitionDate: string | null;
  firstPaymentDate: string | null;
  paidThroughDate: string | null;
  nextPaymentDate: string | null;
  gracePeriodDays: number | null;
  lateFeeCents: number | null;
  daysDelinquent: number | null;
  delinquencyStatus: string | null;
}

export interface AgingWriteback {
  nextPaymentDate?: string | null;
  daysDelinquent?: number;
  delinquencyStatus?: NoteDelinquencyStatus;
  status?: AgeableNoteStatus;
}

export interface AgingPlan {
  /** Non-null when the sweep declines to act, with the reason. */
  skipReason: string | null;
  /** Fields that genuinely differ from what is stored. Empty ⇒ no UPDATE. */
  changes: AgingWriteback;
  /** True when `changes` is non-empty. */
  changed: boolean;
  /** The derived due date (null = we do not know / paid through maturity). */
  nextPaymentDate: string | null;
  daysDelinquent: number;
  delinquencyStatus: NoteDelinquencyStatus;
  /** Post-sweep status. Equals the stored status when nothing flips. */
  status: string;
  /** Set only on a REAL status change. */
  transition: { from: string; to: AgeableNoteStatus; worsening: boolean } | null;
  lateFeeAdvisory: { assessable: boolean; reason: string } | null;
}

/**
 * The whole decision, as a pure function. No db, no clock, no logger — so
 * every rule above is directly testable and `asOf` is an argument rather than
 * a mocked global.
 */
export function planNoteAging(note: AgingNoteRow, asOf: Date): AgingPlan {
  const stored = {
    daysDelinquent: note.daysDelinquent ?? 0,
    delinquencyStatus: (note.delinquencyStatus ??
      "current") as NoteDelinquencyStatus,
    status: note.status,
    nextPaymentDate: note.nextPaymentDate ?? null,
  };
  const inert: AgingPlan = {
    skipReason: null,
    changes: {},
    changed: false,
    nextPaymentDate: stored.nextPaymentDate,
    daysDelinquent: stored.daysDelinquent,
    delinquencyStatus: stored.delinquencyStatus,
    status: stored.status,
    transition: null,
    lateFeeAdvisory: null,
  };

  // RULE 1 — terminal states are terminal.
  if ((TERMINAL_NOTE_STATUSES as readonly string[]).includes(note.status)) {
    return { ...inert, skipReason: `terminal status '${note.status}'` };
  }

  // The schedule module needs coherent facts; a note missing origination,
  // maturity or a due day cannot produce a date and must not produce a guess.
  if (
    note.paymentDueDay == null ||
    note.originationDate == null ||
    note.maturityDate == null ||
    note.acquisitionDate == null
  ) {
    return { ...inert, skipReason: "note is missing schedule facts" };
  }

  const facts: AcquiredNoteScheduleFacts = {
    paymentDueDay: note.paymentDueDay,
    firstPaymentDate: note.firstPaymentDate,
    originationDate: note.originationDate,
    maturityDate: note.maturityDate,
    paidThroughDate: note.paidThroughDate,
    // Acquisition is load-bearing, not decoration: a note bought years after
    // it was originated carries servicing history AcreOS never saw, and the
    // schedule module refuses a date rather than asserting one.
    acquisitionDate: note.acquisitionDate,
  };

  const nextPaymentDate = deriveNextPaymentDate(facts, asOf);
  const changes: AgingWriteback = {};

  // RULE 2 — unknown is not late. Clear an unsupported stored date so the UI
  // renders an honest blank, then assert nothing about delinquency or status.
  if (nextPaymentDate === null) {
    if (stored.nextPaymentDate !== null) changes.nextPaymentDate = null;
    return {
      ...inert,
      skipReason: "no derivable next payment date — unknown is not late",
      changes,
      changed: Object.keys(changes).length > 0,
      nextPaymentDate: null,
    };
  }

  const gracePeriodDays = note.gracePeriodDays ?? 0;
  const { daysDelinquent, delinquencyStatus } = computeNoteDelinquency({
    nextPaymentDate,
    gracePeriodDays,
    asOf,
  });

  // The sweep only moves a note between the three ageable statuses. Anything
  // else stored (a value some future migration introduces) is left alone
  // rather than force-fitted into a band this job invented.
  const ageable = (AGEABLE_NOTE_STATUSES as readonly string[]).includes(
    note.status,
  );
  const targetStatus = noteStatusForDelinquency(delinquencyStatus);
  const statusChanged = ageable && targetStatus !== note.status;

  if (nextPaymentDate !== stored.nextPaymentDate) {
    changes.nextPaymentDate = nextPaymentDate;
  }
  if (daysDelinquent !== stored.daysDelinquent) {
    changes.daysDelinquent = daysDelinquent;
  }
  if (delinquencyStatus !== stored.delinquencyStatus) {
    changes.delinquencyStatus = delinquencyStatus;
  }
  if (statusChanged) changes.status = targetStatus;

  return {
    skipReason: null,
    changes,
    changed: Object.keys(changes).length > 0,
    nextPaymentDate,
    daysDelinquent,
    delinquencyStatus,
    status: statusChanged ? targetStatus : note.status,
    transition: statusChanged
      ? {
          from: note.status,
          to: targetStatus,
          worsening: isWorseningTransition(note.status, targetStatus),
        }
      : null,
    lateFeeAdvisory: lateFeeAssessable({
      nextPaymentDate,
      gracePeriodDays,
      lateFeeCents: note.lateFeeCents ?? 0,
      asOf,
    }),
  };
}

export interface AcquiredNoteAgingSummary {
  scanned: number;
  updated: number;
  transitioned: number;
  earlyInterventionFlagged: number;
  lateFeeAdvisories: number;
  /** Notes whose facts could not produce a due date — surfaced, not hidden. */
  undeterminable: number;
  errors: number;
  organizations: number;
}

const EMPTY_SUMMARY = (): AcquiredNoteAgingSummary => ({
  scanned: 0,
  updated: 0,
  transitioned: 0,
  earlyInterventionFlagged: 0,
  lateFeeAdvisories: 0,
  undeterminable: 0,
  errors: 0,
  organizations: 0,
});

/**
 * `payment.missed` for a note that aged into a worse status. Fire-and-forget:
 * a workflow fault must never fail the sweep, and it must never suppress the
 * status write (which has already committed by the time we get here).
 *
 * `entityId` is 0 because `acquired_notes` is uuid-keyed while
 * `emitPaymentEvent`'s entityId is numeric — the same convention as
 * server/routes-notes.ts. The real key travels as `data.noteId`.
 *
 * Only WORSENING transitions are announced. A recovery to `performing` is not
 * a `payment.received`: no money arrived in this job, and emitting a receipt
 * for a payment nobody made is exactly the fabrication the constitution bans.
 */
const UUID_KEYED_NOTE_ENTITY_ID = 0;

export function emitAgingTransitionEvent(
  note: AgingNoteRow,
  plan: AgingPlan,
): void {
  if (!plan.transition || !plan.transition.worsening) return;
  try {
    emitPaymentEvent("payment.missed", note.organizationId, UUID_KEYED_NOTE_ENTITY_ID, {
      source: "acquired_note_aging",
      noteId: note.id,
      noteNumber: note.noteNumber ?? null,
      dueDate: plan.nextPaymentDate,
      daysLate: plan.daysDelinquent,
      delinquencyStatus: plan.delinquencyStatus,
      previousStatus: plan.transition.from,
      noteStatus: plan.transition.to,
    });
  } catch (err) {
    logger.warn("[acquiredNoteAging] workflow emit failed (swallowed)", {
      metadata: {
        noteId: note.id,
        organizationId: note.organizationId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * One sweep over every non-terminal acquired note, ordered by org so the log
 * and any future per-org batching read naturally.
 *
 * `asOf` is injectable so "what does the book look like on 2026-03-01?" is a
 * test rather than a mocked clock.
 */
export async function runAcquiredNoteAgingSweep(options?: {
  asOf?: Date;
}): Promise<AcquiredNoteAgingSummary> {
  const asOf = options?.asOf ?? new Date();
  const summary = EMPTY_SUMMARY();

  const rows: AgingNoteRow[] = await db
    .select({
      id: acquiredNotes.id,
      organizationId: acquiredNotes.organizationId,
      noteNumber: acquiredNotes.noteNumber,
      status: acquiredNotes.status,
      paymentDueDay: acquiredNotes.paymentDueDay,
      originationDate: acquiredNotes.originationDate,
      maturityDate: acquiredNotes.maturityDate,
      acquisitionDate: acquiredNotes.acquisitionDate,
      firstPaymentDate: acquiredNotes.firstPaymentDate,
      paidThroughDate: acquiredNotes.paidThroughDate,
      nextPaymentDate: acquiredNotes.nextPaymentDate,
      gracePeriodDays: acquiredNotes.gracePeriodDays,
      lateFeeCents: acquiredNotes.lateFeeCents,
      daysDelinquent: acquiredNotes.daysDelinquent,
      delinquencyStatus: acquiredNotes.delinquencyStatus,
    })
    .from(acquiredNotes)
    // Terminal notes are excluded in SQL as well as in `planNoteAging` — the
    // pure guard is the correctness boundary, this is the cost one.
    .where(not(inArray(acquiredNotes.status, [...TERMINAL_NOTE_STATUSES])))
    .orderBy(asc(acquiredNotes.organizationId));

  const orgs = new Set<number>();

  for (const note of rows) {
    summary.scanned++;
    orgs.add(note.organizationId);
    try {
      const plan = planNoteAging(note, asOf);

      if (plan.changed) {
        await db
          .update(acquiredNotes)
          .set({ ...plan.changes, updatedAt: new Date() })
          .where(
            and(
              eq(acquiredNotes.id, note.id),
              eq(acquiredNotes.organizationId, note.organizationId),
            ),
          );
        summary.updated++;
      }

      if (plan.skipReason) {
        if (plan.nextPaymentDate === null) summary.undeterminable++;
        continue;
      }

      if (plan.transition) {
        summary.transitioned++;
        // AFTER the write commits — a workflow must never observe a status
        // this job has not yet persisted.
        emitAgingTransitionEvent(note, plan);
        logger.info("[acquiredNoteAging] status transition", {
          metadata: {
            organizationId: note.organizationId,
            noteId: note.id,
            from: plan.transition.from,
            to: plan.transition.to,
            daysDelinquent: plan.daysDelinquent,
          },
        });
      }

      // RESPA §1024.39(a): the servicer must attempt live contact no later
      // than the 36th day of delinquency. The module enforces the gate itself
      // (and its own per-cycle idempotency); we pre-gate on the SAME exported
      // constant so a sub-36-day note costs zero queries.
      if (plan.daysDelinquent >= EARLY_INTERVENTION_TRIGGER_DAY) {
        const outcome = await flagEarlyIntervention({
          organizationId: note.organizationId,
          loanId: note.id,
          loanType: "acquired_note",
          daysDelinquent: plan.daysDelinquent,
          cycleAnchor: asOf,
        });
        if (outcome.fired) summary.earlyInterventionFlagged++;
      }

      // ADVISORY ONLY — counted, never charged. No fee row is inserted, no
      // ledger is touched, no money moves (founder ruling #15).
      if (plan.lateFeeAdvisory?.assessable) summary.lateFeeAdvisories++;
    } catch (err) {
      summary.errors++;
      logger.error(
        "[acquiredNoteAging] note failed",
        err instanceof Error ? err : undefined,
        { noteId: note.id, organizationId: note.organizationId },
      );
    }
  }

  summary.organizations = orgs.size;
  logger.info("[acquiredNoteAging] sweep complete", { metadata: { ...summary } });
  return summary;
}

// ── Scheduling ──────────────────────────────────────────────────────────────
// Daily: delinquency moves in days, and the day-36 RESPA gate is a day gate.
// An hourly sweep would re-read the whole book 24× to observe the same answer.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** Under the daily interval so a crashed run cannot wedge the lane. */
const AGING_LOCK_TTL_SECONDS = 23 * 60 * 60;
/** Past the minute-cadence jobs, so a boot loop cannot hammer the book. */
const AGING_STARTUP_DELAY_MS = 180_000;

async function processAcquiredNoteAging(): Promise<void> {
  try {
    const s = await runAcquiredNoteAgingSweep();
    log(
      `Acquired-note aging: scanned=${s.scanned}, updated=${s.updated}, ` +
        `transitioned=${s.transitioned}, earlyIntervention=${s.earlyInterventionFlagged}, ` +
        `lateFeeAdvisories=${s.lateFeeAdvisories}, undeterminable=${s.undeterminable}, ` +
        `errors=${s.errors}`,
      "note-aging",
    );
  } catch (err) {
    // Never rethrow: withJobLock records the failure, and a throw here would
    // only make the interval lane noisy without aging anything.
    log(`Acquired-note aging error: ${err}`, "note-aging");
    logger.error(
      "[acquiredNoteAging] sweep failed",
      err instanceof Error ? err : undefined,
    );
  }
}

/** Registered from runScheduledJobs.ts. Daily, single-flight via the job lock. */
export function startAcquiredNoteAgingJob(): void {
  log("Starting acquired-note aging sweep (daily)", "note-aging");

  setTimeout(() => {
    withJobLock(
      "acquired_note_aging",
      AGING_LOCK_TTL_SECONDS,
      processAcquiredNoteAging,
    ).catch((err) => log(`Initial acquired-note aging failed: ${err}`, "note-aging"));
  }, AGING_STARTUP_DELAY_MS);

  trackInterval(() => {
    withJobLock(
      "acquired_note_aging",
      AGING_LOCK_TTL_SECONDS,
      processAcquiredNoteAging,
    ).catch((err) => log(`Acquired-note aging failed: ${err}`, "note-aging"));
  }, ONE_DAY_MS);
}
