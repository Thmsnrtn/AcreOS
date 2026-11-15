/**
 * The delinquency ladder — V-Notes-2 Leg 1 (acquired book). EVIDENCE AND RECORD
 * ONLY.
 *
 *   - Stage entries are written by the daily aging sweep, from the schedule
 *     service's own days-past-due (one derivation place): one row per entry,
 *     source 'aging_engine', with the full input snapshot. Re-running over an
 *     unchanged book writes nothing; exit and re-entry are new rows.
 *   - Default review is an OPERATOR act (founder decision 2026-11-05, ruling 1):
 *     recorded once, with its actor and time, source 'operator_recorded'. No
 *     aging run writes it at any age; the database binds that type to that
 *     source (migration 0302).
 *   - A note whose aging is not determinable enters no stage (unknown is not
 *     late). Terminal notes (paid off, sold) never enter or move.
 *   - THE NO-SENDS FENCE: nothing here writes a reminder, a notice, a letter,
 *     a message or an outbox row; nothing calls the legacy book's dunning
 *     ladder or borrowerNotices; nothing starts a clock against a borrower.
 *     The escalation bundle is assembled for the operator, on request, from
 *     recorded facts — it is not a borrower-facing document.
 *     (tests/unit/delinquencyLadder*.test.ts pin it at the module boundary.)
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { acquiredNotes, noteEvents, noteLossMitCases, notePayments, respaOutreachEvents } from "@shared/schema";
import {
  delinquencyIsDeterminable,
  ladderStageEscalates,
  ladderStageFor,
  LADDER_STAGE_LABEL,
  type LadderStage,
} from "@shared/notes/delinquency";
import { checkExtendAndPretend } from "@shared/notes/extendAndPretend";
import type { EscalationBundle, LadderView } from "@shared/notes/delinquencyLadderView";
import { db } from "../../db";
import { clock } from "../../utils/clock";

const TERMINAL = new Set(["paid_off", "sold"]);

/** The facts the sweep hands over for one determinable, non-terminal note. */
export interface LadderSweepInput {
  note: {
    id: string;
    organizationId: number;
    status: string;
    paymentDueDay: number | null;
    originationDate: string | null;
    maturityDate: string | null;
    acquisitionDate: string | null;
    firstPaymentDate: string | null;
    paidThroughDate: string | null;
  };
  plan: { daysDelinquent: number; delinquencyStatus: string; nextPaymentDate: string | null; skipReason: string | null };
  asOf: Date;
}

type Executor = Pick<typeof db, "select" | "insert">;

async function latestStageRow(organizationId: number, noteId: string, executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(noteEvents)
    .where(and(eq(noteEvents.organizationId, organizationId), eq(noteEvents.noteId, noteId), eq(noteEvents.eventType, "delinquency_stage_entered")))
    .orderBy(desc(noteEvents.recordedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Record a stage entry when the note's stage differs from the last one
 * recorded. Returns the stage written, or null when nothing was written.
 * A note that has only ever been current has no ladder history: its first row
 * is the first time it leaves current. The sweep passes its status
 * transaction as `executor`, so the stage entry commits or rolls back with the
 * status write it describes (DEFECT-0114's one-transaction rule).
 */
export async function recordLadderStageIfEntered(input: LadderSweepInput, executor: Executor = db): Promise<LadderStage | null> {
  const { note, plan, asOf } = input;
  if (TERMINAL.has(note.status)) return null;
  if (plan.skipReason || !delinquencyIsDeterminable(plan.nextPaymentDate)) return null;
  const stage = ladderStageFor(plan.daysDelinquent);
  const prior = await latestStageRow(note.organizationId, note.id, executor);
  const priorStage = (prior?.detail as { stage?: LadderStage } | undefined)?.stage ?? null;
  if (priorStage === stage) return null;
  if (priorStage === null && stage === "current") return null;
  const asOfDate = asOf.toISOString().slice(0, 10);
  await executor.insert(noteEvents).values({
    organizationId: note.organizationId,
    noteId: note.id,
    category: "delinquency",
    eventType: "delinquency_stage_entered",
    eventDate: asOfDate,
    detail: {
      stage,
      priorStage,
      daysDelinquent: plan.daysDelinquent,
      delinquencyBand: plan.delinquencyStatus,
      paidThroughDate: note.paidThroughDate,
      nextPaymentDate: plan.nextPaymentDate,
      schedule: {
        paymentDueDay: note.paymentDueDay,
        firstPaymentDate: note.firstPaymentDate,
        originationDate: note.originationDate,
        acquisitionDate: note.acquisitionDate,
        maturityDate: note.maturityDate,
      },
      agingRun: { job: "acquired_note_aging", asOf: asOf.toISOString() },
    },
    source: "aging_engine",
    sourceRef: { derivation: "acquiredNoteSchedule.computeNoteDelinquency", job: "acquired_note_aging", asOf: asOfDate },
    recordedBy: "system:acquired_note_aging",
  });
  return stage;
}

export class DefaultReviewRefused extends Error {}

/** The operator records default review. Once per note; terminal notes refuse. Null = not this org's note. */
export async function recordDefaultReview(params: { organizationId: number; noteId: string; userId: string; note: string | null }) {
  const [n] = await db
    .select({ id: acquiredNotes.id, status: acquiredNotes.status, daysDelinquent: acquiredNotes.daysDelinquent, nextPaymentDate: acquiredNotes.nextPaymentDate })
    .from(acquiredNotes)
    .where(and(eq(acquiredNotes.id, params.noteId), eq(acquiredNotes.organizationId, params.organizationId)))
    .limit(1);
  if (!n) return null;
  if (TERMINAL.has(n.status)) throw new DefaultReviewRefused(`This note is ${n.status.replace(/_/g, " ")}; it is off the ladder.`);
  const [existing] = await db
    .select({ id: noteEvents.id })
    .from(noteEvents)
    .where(and(eq(noteEvents.organizationId, params.organizationId), eq(noteEvents.noteId, params.noteId), eq(noteEvents.eventType, "default_review_recorded")))
    .limit(1);
  if (existing) throw new DefaultReviewRefused("Default review is already recorded for this note.");
  const latest = await latestStageRow(params.organizationId, params.noteId);
  const [row] = await db
    .insert(noteEvents)
    .values({
      organizationId: params.organizationId,
      noteId: params.noteId,
      category: "delinquency",
      eventType: "default_review_recorded",
      eventDate: clock.now().toISOString().slice(0, 10),
      detail: {
        operatorNote: params.note,
        daysDelinquentAtRecording: delinquencyIsDeterminable(n.nextPaymentDate) ? n.daysDelinquent : null,
        recordedStageAtRecording: (latest?.detail as { stage?: string } | undefined)?.stage ?? null,
      },
      source: "operator_recorded",
      sourceRef: { via: "POST /api/notes/:id/delinquency-ladder/default-review" },
      recordedBy: params.userId,
    })
    .returning();
  return row;
}

async function loadNote(organizationId: number, noteId: string) {
  const [n] = await db
    .select()
    .from(acquiredNotes)
    .where(and(eq(acquiredNotes.id, noteId), eq(acquiredNotes.organizationId, organizationId)))
    .limit(1);
  return n ?? null;
}

/** The ladder for one note, for its own org (null = not found / another org's). */
export async function buildLadderView(organizationId: number, noteId: string): Promise<LadderView | null> {
  const n = await loadNote(organizationId, noteId);
  if (!n) return null;
  const rows = await db
    .select()
    .from(noteEvents)
    .where(and(eq(noteEvents.organizationId, organizationId), eq(noteEvents.noteId, noteId), eq(noteEvents.category, "delinquency")))
    .orderBy(asc(noteEvents.recordedAt));
  const recorded = rows
    .filter((r) => r.eventType === "delinquency_stage_entered")
    .map((r) => {
      const d = r.detail as { stage: LadderStage; priorStage: LadderStage | null };
      return { id: r.id, stage: d.stage, label: LADDER_STAGE_LABEL[d.stage], priorStage: d.priorStage, eventDate: r.eventDate, recordedAt: r.recordedAt.toISOString(), snapshot: r.detail };
    });
  const dr = rows.find((r) => r.eventType === "default_review_recorded");
  const defaultReview = dr ? { recordedAt: dr.recordedAt.toISOString(), recordedBy: dr.recordedBy, operatorNote: ((dr.detail as { operatorNote?: string | null }).operatorNote ?? null) } : null;

  let reason: string | null = null;
  let current: LadderView["current"] = null;
  if (TERMINAL.has(n.status)) reason = `This note is ${n.status.replace(/_/g, " ")}; it is off the ladder.`;
  else if (!delinquencyIsDeterminable(n.nextPaymentDate)) reason = "Aging not determinable: the note has no derivable next payment date (missing schedule facts or paid through maturity). Unknown is not late.";
  else {
    const stage = ladderStageFor(n.daysDelinquent);
    current = { stage, label: LADDER_STAGE_LABEL[stage], daysDelinquent: n.daysDelinquent, nextPaymentDate: n.nextPaymentDate, paidThroughDate: n.paidThroughDate };
  }
  const last = recorded.at(-1) ?? null;
  const disagreement =
    current && last && last.stage !== current.stage
      ? { recordedStage: last.stage, currentStage: current.stage, note: "The note's stored aging facts now give a different stage than the last one recorded. The next aging run records the entry; until then both are shown." }
      : null;
  return { noteId, onLadder: current !== null, reason, current, recorded, disagreement, defaultReview, escalates: current !== null && ladderStageEscalates(current.stage) };
}

/**
 * The escalation evidence bundle, assembled on the operator's request for a
 * note at 30+ days. Recorded facts only. Not a borrower-facing document.
 */
export async function buildEscalationBundle(organizationId: number, noteId: string): Promise<EscalationBundle | { status: "not_escalated"; reason: string } | null> {
  const ladder = await buildLadderView(organizationId, noteId);
  if (!ladder) return null;
  if (!ladder.escalates) {
    return { status: "not_escalated", reason: ladder.reason ?? "The note is under 30 days past due; a bundle is assembled from 30 days." };
  }
  const n = (await loadNote(organizationId, noteId))!;
  const { buildNoteRecord } = await import("./noteRecord");
  const record = await buildNoteRecord(organizationId, noteId);
  const payments = await db
    .select({ paymentDate: notePayments.paymentDate, paymentType: notePayments.paymentType, principalCents: notePayments.principalCents, interestCents: notePayments.interestCents, unappliedCents: notePayments.unappliedCents })
    .from(notePayments)
    .where(and(eq(notePayments.organizationId, organizationId), eq(notePayments.noteId, noteId)))
    .orderBy(asc(notePayments.paymentDate));
  const [respa] = await db
    .select({ firedAt: respaOutreachEvents.firedAt, daysDelinquent: respaOutreachEvents.daysDelinquent, citation: respaOutreachEvents.citation })
    .from(respaOutreachEvents)
    .where(and(eq(respaOutreachEvents.organizationId, organizationId), eq(respaOutreachEvents.loanId, noteId), eq(respaOutreachEvents.loanType, "acquired_note"), eq(respaOutreachEvents.eventType, "early_intervention_36d")))
    .orderBy(desc(respaOutreachEvents.firedAt))
    .limit(1);
  const [lm] = await db
    .select()
    .from(noteLossMitCases)
    .where(and(eq(noteLossMitCases.organizationId, organizationId), eq(noteLossMitCases.noteId, noteId)))
    .orderBy(desc(noteLossMitCases.openedAt))
    .limit(1);
  const asOf = clock.now().toISOString().slice(0, 10);
  return {
    noteId,
    assembledAt: clock.now().toISOString(),
    ladder,
    paymentHistory: {
      payments: payments.map((p) => ({ ...p, paymentDate: String(p.paymentDate) })),
      performanceReported: (record?.outcomes ?? []).map((o) => ({ eventDate: o.eventDate, detail: o.detail, source: o.source })),
    },
    collateral: record?.collateral ?? null,
    documents: record?.documents ?? null,
    scope: {
      isConsumerPurpose: n.isConsumerPurpose,
      collateralIsDwelling: n.collateralIsDwelling,
      respaEarlyIntervention: respa ? { firedAt: respa.firedAt.toISOString(), daysDelinquent: respa.daysDelinquent ?? null, citation: respa.citation ?? null } : null,
      scra: lm ? { checkedAt: lm.scraCheckedAt?.toISOString() ?? null, activeDuty: lm.scraActiveDuty ?? null } : null,
    },
    extendAndPretend: checkExtendAndPretend(payments.map((p) => ({ ...p, paymentDate: String(p.paymentDate) })), asOf),
    lossMitCase: lm ? { id: lm.id, status: lm.status, openedAt: lm.openedAt.toISOString() } : null,
  };
}
