/**
 * Note payment due-date detector (Jarvis 2.1 — deal-shaped perception, audit G2).
 *
 * The note-investor vertical's payment schedule (notes.next_payment_date) was
 * invisible to the brain: nothing turned "a borrower payment is due Thursday"
 * or "this payment is overdue" into a signal. This daily scan makes due-dates
 * first-class:
 *
 *   (a) one mesh event per NEW finding on the `note:payments` channel —
 *       deduped by a deterministic key (note + due-date + classification)
 *       checked against the mesh's own ledger, so a rerun never re-publishes
 *       the same fact. Overdue publishes at priority 3 (crosses the
 *       notification-router's ≤3 dispatch threshold — money that didn't
 *       arrive is worth a notification); due-soon at 4 (visible, not paged).
 *   (b) an aggregate outward sense per classification (counts only — no
 *       borrower data, constitutional) via perception.recordSense, so the
 *       Solene tick SEES payment pressure the same way it sees Stripe
 *       dunning events.
 *
 * Observe-only: events + senses. No actions, no direct notifications beyond
 * what the existing notification-router already does with priority.
 */
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { eventMeshEvents, notes } from "@shared/schema";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { logger } from "../utils/logger";
import { recordSense } from "./autopilot/perception";
import { eventMeshPublisher } from "./eventMeshPublisher";
import { emitPaymentEvent } from "./workflow-engine";
import {
  BALLOON_WINDOW_DAYS,
  emitNoteBalloonApproaching,
  type NoteBalloonRow,
} from "./noteEvents";

export const NOTE_PAYMENT_CHANNEL = "note:payments";
export const DUE_SOON_WINDOW_DAYS = 7;

// audit Wave 1 (creative_finance beta→core): the balloon-approaching lane is
// folded into THIS daily scan — no new job, no new scheduler line (the
// run-scheduled-jobs line ratchet only shrinks). A separate mesh channel keeps
// its dedupe ledger distinct from the payment-due findings. Module-private (used
// only inside this scan) so it never adds an unreached export to the reachability
// ratchet — mirrors how the channel is consumed nowhere but here.
const NOTE_BALLOON_CHANNEL = "note:balloons";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PaymentDueClassification = "due_soon" | "overdue";

export interface NotePaymentRow {
  id: number;
  organizationId: number;
  nextPaymentDate: Date | null;
}

export interface PaymentDueFinding {
  noteId: number;
  orgId: number;
  /** Due date as YYYY-MM-DD (UTC) — part of the idempotency key. */
  dueDate: string;
  classification: PaymentDueClassification;
  /** Whole days until due (negative = days overdue). */
  daysUntilDue: number;
  /** Deterministic idempotency key: same note + due-date + classification
   * never publishes twice, while a due-soon finding that later turns overdue
   * IS a new fact and publishes once more. */
  dedupeKey: string;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure window + classification logic. A note whose next payment is strictly
 * in the past is overdue; within the next `windowDays` (inclusive) is
 * due-soon; further out (or unknown) is no finding. Deterministic + total.
 */
export function classifyPaymentsDue(
  rows: NotePaymentRow[],
  now: Date,
  windowDays: number = DUE_SOON_WINDOW_DAYS,
): PaymentDueFinding[] {
  const findings: PaymentDueFinding[] = [];
  for (const row of rows) {
    if (!row.nextPaymentDate) continue; // honest: no schedule, no signal
    const due = row.nextPaymentDate.getTime();
    if (!Number.isFinite(due)) continue;
    const deltaMs = due - now.getTime();
    if (deltaMs > windowDays * DAY_MS) continue; // outside the window
    const classification: PaymentDueClassification = deltaMs < 0 ? "overdue" : "due_soon";
    const dueDate = isoDay(row.nextPaymentDate);
    findings.push({
      noteId: row.id,
      orgId: row.organizationId,
      dueDate,
      classification,
      daysUntilDue: Math.floor(deltaMs / DAY_MS),
      dedupeKey: `note-payment:${row.id}:${dueDate}:${classification}`,
    });
  }
  return findings;
}

/**
 * Wave B ("wire the engine") — this scan is the ONLY delinquency-detection
 * path in the repo, so it is the emit site for the workflow engine's
 * `payment.missed` trigger (the note-servicing dunning automations).
 *
 * Exactly-once is inherited from the scan's existing dedupe ledger: we emit
 * only for an OVERDUE finding whose mesh event we just published for the
 * first time. A rerun sees the dedupeKey on the channel, skips the publish,
 * and therefore skips the emit too — one event per (note, due date) going
 * overdue, no matter how many times the job runs.
 *
 * Fire-and-forget: wrapped so a workflow fault can never fail the scan or
 * suppress the mesh signal. `entityId` is the note id (there is no payment
 * row for a payment that never arrived).
 */
export function emitPaymentMissedForFinding(f: PaymentDueFinding): void {
  try {
    emitPaymentEvent("payment.missed", f.orgId, f.noteId, {
      source: "note_payment_due_detector",
      noteId: f.noteId,
      dueDate: f.dueDate,
      // daysUntilDue is negative for overdue findings; publish the positive
      // lateness so workflow conditions read naturally (daysLate > 30).
      daysLate: Math.abs(f.daysUntilDue),
      daysUntilDue: f.daysUntilDue,
      classification: f.classification,
      dedupeKey: f.dedupeKey,
    });
  } catch (err) {
    logger.warn(
      `[notePaymentDueDetector] workflow emit failed for ${f.dedupeKey} (swallowed)`,
      err instanceof Error ? err : undefined,
    );
  }
}

export interface NotePaymentScanResult {
  scanned: number;
  dueSoon: number;
  overdue: number;
  published: number;
  errors: number;
  // Balloon-approaching lane (audit Wave 1, creative_finance beta→core), folded
  // into this scan: notes ~90 days from maturity with a positive balance.
  balloonApproaching: number;
  balloonPublished: number;
}

/**
 * Daily scan: read active notes with a payment due inside the window (or
 * already past), publish one mesh event per NEW finding, and record the
 * aggregate counts as outward senses. Best-effort throughout — a failure
 * degrades to fewer signals, never to a crash or an invented value.
 */
export async function runNotePaymentDueScan(now: Date = new Date()): Promise<NotePaymentScanResult> {
  const result: NotePaymentScanResult = {
    scanned: 0,
    dueSoon: 0,
    overdue: 0,
    published: 0,
    errors: 0,
    balloonApproaching: 0,
    balloonPublished: 0,
  };

  let findings: PaymentDueFinding[] = [];
  try {
    const horizon = new Date(now.getTime() + DUE_SOON_WINDOW_DAYS * DAY_MS);
    // PLATFORM SWEEP, said out loud — same shape as leaseExpiryDetector. A
    // daily scheduled job (server/jobs/expiryDetectorJobs.ts) reads EVERY
    // organization's active notes and publishes a per-org mesh event per
    // finding. A per-org predicate here would make the job scan nothing.
    const rows = await unscopedForPlatformOps(
      "note payment-due daily sweep: a scheduled platform job that scans every organization's active notes and publishes one per-org mesh event per finding",
    )
      .select({ id: notes.id, organizationId: notes.organizationId, nextPaymentDate: notes.nextPaymentDate })
      .from(notes)
      .where(and(eq(notes.status, "active"), isNull(notes.deletedAt), lte(notes.nextPaymentDate, horizon)));
    result.scanned = rows.length;
    findings = classifyPaymentsDue(rows, now);
  } catch (err) {
    result.errors += 1;
    logger.warn(
      "[notePaymentDueDetector] notes read failed; scan degraded to none",
      err instanceof Error ? err : undefined,
    );
    return result;
  }

  result.dueSoon = findings.filter((f) => f.classification === "due_soon").length;
  result.overdue = findings.filter((f) => f.classification === "overdue").length;

  // Ledger dedupe: the mesh itself is the record of what was already
  // published. A finding whose dedupeKey exists on the channel is old news.
  let alreadyPublished = new Set<string>();
  if (findings.length > 0) {
    try {
      const keys = findings.map((f) => f.dedupeKey);
      // READ AND VERIFIED 2026-09-04. Every dedupeKey is
      // `note-payment:${note.id}:${dueDate}:${classification}` and `notes.id`
      // is a serial PRIMARY KEY — globally unique, not per-org — so this asks
      // "which of MY OWN keys are already on the channel". A cross-org row can
      // only match by carrying an id that cannot collide, and the SELECT
      // returns nothing but keys the caller already holds.
      const existing = await unscopedForPlatformOps(
        "note payment dedupe ledger: matches globally-unique note-id keys the caller already holds against the mesh channel, returning only those keys",
      )
        .select({ key: sql<string>`${eventMeshEvents.payload} ->> 'dedupeKey'` })
        .from(eventMeshEvents)
        .where(
          and(
            eq(eventMeshEvents.channel, NOTE_PAYMENT_CHANNEL),
            sql`${eventMeshEvents.payload} ->> 'dedupeKey' IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`,
          ),
        );
      alreadyPublished = new Set(existing.map((r) => r.key));
    } catch (err) {
      result.errors += 1;
      // Fail CLOSED on publishing (skip all) rather than risk duplicate
      // events every day the ledger read is broken — the senses below still
      // record the honest aggregate counts either way.
      alreadyPublished = new Set(findings.map((f) => f.dedupeKey));
      logger.warn(
        "[notePaymentDueDetector] dedupe ledger read failed; skipping event publish this run",
        err instanceof Error ? err : undefined,
      );
    }
  }

  for (const f of findings) {
    if (alreadyPublished.has(f.dedupeKey)) continue;
    try {
      await eventMeshPublisher.publish(
        NOTE_PAYMENT_CHANNEL,
        f.classification === "overdue" ? "note:payment_overdue" : "note:payment_due_soon",
        {
          noteId: f.noteId,
          dueDate: f.dueDate,
          daysUntilDue: f.daysUntilDue,
          dedupeKey: f.dedupeKey,
        },
        {
          publisher: "note-payment-detector",
          // Overdue crosses the notification-router's ≤3 threshold; due-soon
          // stays routine (visible in the mesh/tick, no notification).
          priority: f.classification === "overdue" ? 3 : 4,
          orgId: f.orgId,
        },
      );
      result.published += 1;

      // The mesh event is now the ledger entry that makes this finding "old
      // news" on every later run, so emitting here — after a SUCCESSFUL
      // publish — gives the workflow engine exactly one `payment.missed`
      // per note per due date. A publish failure skips the emit so the next
      // run can retry both together.
      if (f.classification === "overdue") {
        emitPaymentMissedForFinding(f);
      }
    } catch (err) {
      result.errors += 1;
      logger.warn(
        `[notePaymentDueDetector] publish failed for ${f.dedupeKey} (swallowed)`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  // Aggregate outward senses — counts only (constitutional: no borrower PII
  // in senses). The value is the CURRENT total pressure, recorded once per
  // run, so the tick reads `latest` rather than summing across runs.
  if (result.dueSoon > 0) {
    void recordSense("note_payment_due_soon", result.dueSoon, { newFindings: result.published });
  }
  if (result.overdue > 0) {
    void recordSense("note_payment_overdue", result.overdue, { newFindings: result.published });
  }

  // ── Balloon-approaching lane (audit Wave 1, creative_finance beta→core) ──────
  // Folded into this daily scan (no new job / no new scheduler line): active
  // notes whose maturityDate is within the next ~90 days with a positive
  // outstanding balance. Same mesh-ledger dedupe shape as the payment sweep
  // above — one emit per (note, maturityDate), a rerun re-reads the ledger and
  // skips — and no migration. emitNoteBalloonApproaching (noteEvents.ts) is
  // self-guarding and fire-and-forget, so a workflow fault never fails the scan.
  let balloonRows: NoteBalloonRow[] = [];
  try {
    const balloonHorizon = new Date(now.getTime() + BALLOON_WINDOW_DAYS * DAY_MS);
    balloonRows = await unscopedForPlatformOps(
      "balloon-payment daily sweep: the same scheduled platform job, scanning every organization's notes for an approaching balloon date",
    )
      .select({
        id: notes.id,
        organizationId: notes.organizationId,
        propertyId: notes.propertyId,
        borrowerId: notes.borrowerId,
        status: notes.status,
        maturityDate: notes.maturityDate,
        currentBalance: notes.currentBalance,
      })
      .from(notes)
      .where(
        and(
          eq(notes.status, "active"),
          isNull(notes.deletedAt),
          gte(notes.maturityDate, now),
          lte(notes.maturityDate, balloonHorizon),
          sql`${notes.currentBalance} > 0`,
        ),
      );
  } catch (err) {
    result.errors += 1;
    logger.warn(
      "[notePaymentDueDetector] balloon notes read failed; balloon lane degraded to none",
      err instanceof Error ? err : undefined,
    );
    balloonRows = [];
  }

  result.balloonApproaching = balloonRows.length;

  if (balloonRows.length > 0) {
    const balloonKey = (r: NoteBalloonRow): string =>
      `note-balloon:${r.id}:${r.maturityDate ? isoDay(r.maturityDate) : "none"}`;

    // Ledger dedupe: the mesh event IS the durable record of what already
    // emitted, so a note that fired once for this maturityDate is old news on
    // every later run. No initializer: the try assigns from the ledger read and
    // the catch fails closed, so the value is always assigned before it is read
    // in the loop below (the dead initial Set was flagged by CodeQL).
    let alreadyBallooned: Set<string>;
    try {
      const keys = balloonRows.map(balloonKey);
      // READ AND VERIFIED 2026-09-04. Every dedupeKey is
      // `note-payment:${note.id}:${dueDate}:${classification}` and `notes.id`
      // is a serial PRIMARY KEY — globally unique, not per-org — so this asks
      // "which of MY OWN keys are already on the channel". A cross-org row can
      // only match by carrying an id that cannot collide, and the SELECT
      // returns nothing but keys the caller already holds.
      const existing = await unscopedForPlatformOps(
        "note payment dedupe ledger: matches globally-unique note-id keys the caller already holds against the mesh channel, returning only those keys",
      )
        .select({ key: sql<string>`${eventMeshEvents.payload} ->> 'dedupeKey'` })
        .from(eventMeshEvents)
        .where(
          and(
            eq(eventMeshEvents.channel, NOTE_BALLOON_CHANNEL),
            sql`${eventMeshEvents.payload} ->> 'dedupeKey' IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`,
          ),
        );
      alreadyBallooned = new Set(existing.map((r) => r.key));
    } catch (err) {
      result.errors += 1;
      // Fail CLOSED (skip all) rather than risk re-emitting every day the ledger
      // read is broken.
      alreadyBallooned = new Set(balloonRows.map(balloonKey));
      logger.warn(
        "[notePaymentDueDetector] balloon dedupe ledger read failed; skipping balloon emits this run",
        err instanceof Error ? err : undefined,
      );
    }

    for (const r of balloonRows) {
      const dedupeKey = balloonKey(r);
      if (alreadyBallooned.has(dedupeKey)) continue;
      try {
        await eventMeshPublisher.publish(
          NOTE_BALLOON_CHANNEL,
          "note:balloon_approaching",
          {
            noteId: r.id,
            maturityDate: r.maturityDate ? isoDay(r.maturityDate) : null,
            dedupeKey,
          },
          {
            publisher: "note-balloon-detector",
            priority: 4,
            orgId: r.organizationId,
          },
        );
        result.balloonPublished += 1;

        // The mesh event just published is the ledger entry that makes this note
        // "old news" next run, so emitting HERE — after a SUCCESSFUL publish —
        // gives the engine exactly one note.balloon_approaching per (note,
        // maturityDate), however many times the job runs.
        emitNoteBalloonApproaching(r, now);
      } catch (err) {
        result.errors += 1;
        logger.warn(
          `[notePaymentDueDetector] balloon publish failed for ${dedupeKey} (swallowed)`,
          err instanceof Error ? err : undefined,
        );
      }
    }
  }

  return result;
}
