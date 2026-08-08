// ---------------------------------------------------------------------------
// LIVE workflow trigger events — the single source of truth for which
// workflow trigger events actually FIRE at runtime today.
//
// Wave A "Nothing lies" (2026-07-29): the workflow engine declares dozens of
// trigger events (shared WORKFLOW_TRIGGER_EVENTS plus the engine's local
// ExtendedTriggerEvent escape hatch), but only the events listed here have a
// real emit call site anywhere in the server. A workflow installed on any
// other trigger sits idle — it will never run until its event's emitter ships.
//
// Wave B "Wire the engine" (2026-07-29) added the lead, property, deal and
// payment lanes. Every entry below names the module that actually calls an
// engine `emit*Event` helper — that call site IS the reason it is listed:
//
//   parcel.owner_changed / parcel.tax_status_changed
//       server/services/parcelDeltaDetector.ts → emitParcelEvent
//   lead.created / lead.updated / lead.status_changed
//       server/services/leadEvents.ts (emitLeadCreated / emitLeadUpdated →
//       safeEmitLeadEvent → emitLeadEvent), called from server/routes-leads.ts
//       (single + bulk create, update, bulk update, import),
//       server/services/importExport.ts and server/ai/tools.ts.
//   property.created / property.status_changed
//       server/services/propertyEvents.ts → emitPropertyEvent, called from
//       server/routes-properties.ts (create, update, bulk status) and
//       server/ai/tools.ts.
//   deal.created / deal.stage_changed
//       server/services/dealEvents.ts → emitDealEvent, called from
//       server/routes-deals.ts (create, update, bulk status, close) and
//       server/ai/tools.ts.
//   payment.received / payment.missed
//       server/routes-notes.ts, server/routes-rent-ledger.ts,
//       server/routes-borrower.ts and
//       server/services/notePaymentDueDetector.ts → emitPaymentEvent.
//   rehab.milestone / rehab.punch_list_complete (audit Wave 1, fix-and-flip)
//       server/services/rehabEvents.ts → emitRehabStatusChange → emitRehabEvent,
//       called from server/routes-rehabs.ts (PATCH status transition). Fires
//       rehab.milestone when demo completes and rehab.punch_list_complete when
//       the rehab reaches "listed".
//   cert.acquired / cert.redemption_period_60d / cert.foreclosure_eligible /
//   cert.redeemed (audit Wave 1, tax-lien / deed)
//       server/services/certificateEvents.ts → emitCertEvent, called from
//       server/routes-tax-certificates.ts (cert.acquired on create; cert.redeemed
//       on a genuine active→redeemed PATCH), server/routes-tax-researcher.ts
//       (cert.acquired on the won-bid→certificate handoff), and
//       server/jobs/redemptionClockRefresh.ts (the nightly clock fires
//       cert.redemption_period_60d in the 60-day window and
//       cert.foreclosure_eligible once the deadline has lapsed).
//
// `property.updated` and `deal.updated` are deliberately ABSENT: their emit
// helpers declare them, but no call site ever passes them, so a workflow on
// either still sits idle and must still be badged.
//
// The UI (workflow builder trigger picker, template gallery, installed
// workflow list) badges every non-live trigger with TRIGGER_NOT_LIVE_MESSAGE
// so customers are never left believing an automation is running when its
// event never fires. Installing/saving such workflows stays allowed — they
// activate the day the event ships — but the badge persists until then.
//
// When you wire a new emitter, add its event here in the SAME change.
// tests/unit/workflowActionHonesty.test.ts DERIVES the true set by scanning
// server/ for emit call sites and asserts it equals this list exactly — in
// both directions. Listing an event nothing emits fails; emitting an event
// that is not listed fails. There is no hardcoded expected list to edit.
// ---------------------------------------------------------------------------

export const LIVE_WORKFLOW_TRIGGER_EVENTS = [
  "parcel.owner_changed",
  "parcel.tax_status_changed",
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "property.created",
  "property.status_changed",
  "deal.created",
  "deal.stage_changed",
  "payment.received",
  "payment.missed",
  "rehab.milestone",
  "rehab.punch_list_complete",
  "cert.acquired",
  "cert.redemption_period_60d",
  "cert.foreclosure_eligible",
  "cert.redeemed",
] as const;

export type LiveWorkflowTriggerEvent =
  (typeof LIVE_WORKFLOW_TRIGGER_EVENTS)[number];

const LIVE_EVENT_SET: ReadonlySet<string> = new Set(
  LIVE_WORKFLOW_TRIGGER_EVENTS,
);

/** True when the given trigger event has a real runtime emitter today. */
export function isLiveWorkflowTriggerEvent(event: string): boolean {
  return LIVE_EVENT_SET.has(event);
}

/** Honest copy shown wherever a not-yet-firing trigger appears in the UI. */
export const TRIGGER_NOT_LIVE_MESSAGE =
  "Not yet live — this trigger will activate when its event ships. Until then, workflows on it will not run.";
