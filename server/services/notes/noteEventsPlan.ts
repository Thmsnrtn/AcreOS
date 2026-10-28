/**
 * Note events from an imported tape row — V-Notes-1 N3 (hooks only). Pure.
 *
 *   - ONE outcome event per imported row: the payment performance the tape
 *     reports (status, paid-through date, balance), dated by the tape's as-of
 *     — or, when the operator stated none, by the import date, and the event
 *     says which. Kept for V-Notes-2's calibration; nothing reads it as a model.
 *   - A CALENDAR event for each dated term the tape STATES: maturity (always —
 *     it is required), the next payment due (monthly on the due day, until
 *     maturity), the balloon date, the next rate adjustment. A date the tape
 *     does not state is not registered: AcreOS never derives a next due date
 *     from the due day, because a derived date on a delinquent note is a
 *     confident lie (see acquiredNoteSchedule.ts).
 *
 * No alerting, no clocks, no comms — the registry only.
 */

import type { InsertNoteEvent } from "@shared/schema";
import type { NoteTapeFieldKey } from "@shared/notes/noteTapeFields";
import type { PreparedNote } from "./noteTapeImport";

export type PlannedNoteEvent = Omit<InsertNoteEvent, "organizationId" | "noteId" | "importId" | "recordedBy">;

export interface NoteEventContext {
  fileName: string;
  fileSha256: string;
  /** The tape's own as-of date, when the operator states it. */
  asOf: string | null;
  /** The date the import runs (YYYY-MM-DD). */
  importDate: string;
}

export function planNoteEvents(n: PreparedNote, ctx: NoteEventContext): PlannedNoteEvent[] {
  const cell = (k: NoteTapeFieldKey) => n.stated[k]?.source;
  const ref = (fields: NoteTapeFieldKey[]) => ({
    fileName: ctx.fileName,
    fileSha256: ctx.fileSha256,
    fileRow: n.fileRow,
    cells: Object.fromEntries(fields.filter((f) => cell(f)).map((f) => [f, { column: cell(f)!.column, raw: cell(f)!.raw }])),
  });
  // An event whose stated date the operator corrected carries that origin.
  const sourceOf = (fields: NoteTapeFieldKey[]) => (fields.some((f) => cell(f)?.origin === "operator_correction") ? ("operator_correction" as const) : ("note_tape" as const));

  const events: PlannedNoteEvent[] = [];
  const perf: NoteTapeFieldKey[] = ["status", "paidThroughDate", "currentBalance"];
  events.push({
    category: "outcome",
    eventType: "performance_reported",
    eventDate: ctx.asOf ?? ctx.importDate,
    detail: {
      status: n.status,
      paidThroughDate: n.paidThroughDate,
      currentBalanceCents: n.currentBalanceCents,
      dateBasis: ctx.asOf ? "the tape's as-of date" : "the tape states no as-of date; dated by the import",
    },
    source: sourceOf(perf),
    sourceRef: ref(perf),
  });

  events.push({ category: "calendar", eventType: "maturity", eventDate: n.maturityDate, detail: {}, source: sourceOf(["maturityDate"]), sourceRef: ref(["maturityDate"]) });
  // The validator refuses a next due date after maturity, so the recurrence
  // window is never empty (the table's CHECK backs that up).
  if (n.nextPaymentDate) {
    const f: NoteTapeFieldKey[] = ["nextPaymentDate", "paymentDueDay", "paymentAmount", "maturityDate"];
    events.push({
      category: "calendar",
      eventType: "payment_due",
      eventDate: n.nextPaymentDate,
      recurrence: "monthly",
      recurrenceUntil: n.maturityDate,
      detail: { dueDay: n.paymentDueDay, paymentAmountCents: n.paymentAmountCents },
      source: sourceOf(f),
      sourceRef: ref(f),
    });
  }
  if (n.balloonDate) {
    events.push({ category: "calendar", eventType: "balloon", eventDate: n.balloonDate, detail: { balloonAmountCents: n.balloonAmountCents }, source: sourceOf(["balloonDate", "balloonAmount"]), sourceRef: ref(["balloonDate", "balloonAmount"]) });
  }
  const adj = n.stated.rateAdjustmentDate?.value;
  if (typeof adj === "string") {
    events.push({ category: "calendar", eventType: "rate_adjustment", eventDate: adj, detail: {}, source: sourceOf(["rateAdjustmentDate"]), sourceRef: ref(["rateAdjustmentDate"]) });
  }
  return events;
}
