// ---------------------------------------------------------------------------
// LIVE workflow trigger events — the single source of truth for which
// workflow trigger events actually FIRE at runtime today.
//
// Wave A "Nothing lies" (2026-07-29): the workflow engine declares dozens of
// trigger events (shared WORKFLOW_TRIGGER_EVENTS plus the engine's local
// ExtendedTriggerEvent escape hatch), but only the events listed here have a
// real emit call site anywhere in the server (parcelDeltaDetector.persistDelta
// → emitParcelEvent). A workflow installed on any other trigger sits idle —
// it will never run until its event's emitter ships.
//
// The UI (workflow builder trigger picker, template gallery, installed
// workflow list) badges every non-live trigger with TRIGGER_NOT_LIVE_MESSAGE
// so customers are never left believing an automation is running when its
// event never fires. Installing/saving such workflows stays allowed — they
// activate the day the event ships — but the badge persists until then.
//
// When you wire a new emitter (next wave), add its event here in the SAME
// change; tests/unit/workflowActionHonesty.test.ts pins that every entry in
// this list has a real emit call site.
// ---------------------------------------------------------------------------

export const LIVE_WORKFLOW_TRIGGER_EVENTS = [
  "parcel.owner_changed",
  "parcel.tax_status_changed",
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
