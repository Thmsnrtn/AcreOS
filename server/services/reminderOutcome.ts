/**
 * What happened to a borrower reminder — the one reading every caller shares.
 *
 * `financeAgentService.sendManualReminder` returns `success: true` whenever it
 * created the reminder ROW; what happened to it is in `status`. Three outcomes:
 *   - DELIVERED: a rail accepted it (`sent`).
 *   - QUEUED: not out yet, but still in the dispatcher's hands — the sweep
 *     (paymentRemindersRepo.getDispatchableReminders) will send it
 *     (`scheduled`, `queued`). Not a failure: treating it as one released a
 *     Pax ask for retry, and the re-tap created a SECOND reminder row, so the
 *     borrower got duplicate notices once the queue drained.
 *   - NOT SENT: anything else (failed, blocked, unavailable, awaiting
 *     approval, cancelled, or document_ready — a letter prepared, never mailed).
 * The dunning routes and the Pax ask replay both read through this, so "sent"
 * cannot mean "a row exists" on one surface and "delivered" on another.
 */
export const REMINDER_STATUS = {
  scheduled: "scheduled",
  queued: "queued",
  awaitingApproval: "awaiting_approval",
  blocked: "blocked",
  unavailable: "unavailable",
  documentReady: "document_ready",
  sent: "sent",
  failed: "failed",
  cancelled: "cancelled",
} as const;

/** Statuses the dispatch sweep still picks up and sends. */
export const DISPATCHABLE_REMINDER_STATUSES = [REMINDER_STATUS.scheduled, REMINDER_STATUS.queued] as const;

export type ReminderOutcome = "delivered" | "queued" | "not_sent";

export function reminderOutcome(result: { status?: string | null }): ReminderOutcome {
  if (result.status === REMINDER_STATUS.sent) return "delivered";
  if ((DISPATCHABLE_REMINDER_STATUSES as readonly string[]).includes(result.status ?? "")) return "queued";
  return "not_sent";
}
