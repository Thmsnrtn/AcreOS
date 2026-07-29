// ---------------------------------------------------------------------------
// Lead workflow-event emitters (Wave B "Wire the engine", 2026-07-29).
//
// `emitLeadEvent` has lived in the workflow engine since the engine shipped
// but had ZERO call sites, so every "New Lead Received" / "Lead Status
// Changed" automation a customer installed sat idle forever. This module is
// the ONE seam every lead write path goes through to make those events real.
//
// Three rules this module exists to enforce:
//
//   1. FIRE-AND-FORGET. A workflow failure must never fail a lead create or
//      update. `emitLeadEvent` is declared `void` but calls an async
//      `workflowEngine.emit()` internally; a synchronous throw (bad payload,
//      engine boot error) would otherwise propagate straight into the route
//      handler's try/catch and 500 a request that already succeeded. Every
//      helper here swallows and logs instead.
//
//   2. NEVER EMIT A NO-OP. `lead.updated` on a PUT that changed nothing would
//      fan every idle automation out over the whole table. `changedLeadFields`
//      is the shared diff so all call sites agree on what "material" means.
//
//   3. NO FABRICATION. The event payload is the real persisted row (or the
//      real values written), never a reconstructed guess. Callers that cannot
//      obtain the persisted row must not emit.
//
// When a new emit call site is added, `shared/workflow-live-triggers.ts`
// must list the event in the SAME change — tests/unit/workflowActionHonesty.ts
// pins that relationship.
// ---------------------------------------------------------------------------

import { emitLeadEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

export type LeadWorkflowEvent =
  | "lead.created"
  | "lead.updated"
  | "lead.status_changed";

/**
 * Fields whose change counts as a MATERIAL lead update — i.e. one worth
 * waking automations for. Deliberately excludes machine-written churn
 * (`score`, `scoreFactors`, `lastContactedAt`, `updatedAt`, enrichment
 * timestamps) so a nightly re-score does not carpet-bomb every workflow.
 */
export const MATERIAL_LEAD_UPDATE_FIELDS = [
  "status",
  "type",
  "firstName",
  "lastName",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zip",
  "apn",
  "source",
  "notes",
  "tags",
  "assignedTo",
  "doNotContact",
  "tcpaConsent",
] as const;

function normalizeForCompare(value: unknown): string {
  if (value === undefined || value === null) return "\u0000null";
  if (value instanceof Date) return `d:${value.getTime()}`;
  if (Array.isArray(value)) return `a:${JSON.stringify(value)}`;
  if (typeof value === "object") return `o:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
}

/**
 * Returns the subset of `attempted` keys whose value actually differs between
 * `before` and `after`. An empty array means the write was a no-op and NO
 * event should be emitted.
 *
 * Only keys the caller actually attempted to write are considered — a PUT
 * that sends `{ notes }` must not report `status` as changed just because a
 * concurrent writer touched it.
 */
export function changedLeadFields(
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
  attempted: readonly string[],
): string[] {
  if (!before || !after) return [];
  const material = new Set<string>(MATERIAL_LEAD_UPDATE_FIELDS as readonly string[]);
  const changed: string[] = [];
  for (const key of attempted) {
    if (!material.has(key)) continue;
    if (normalizeForCompare(before[key]) !== normalizeForCompare(after[key])) {
      changed.push(key);
    }
  }
  return changed;
}

/**
 * The one place `emitLeadEvent` is allowed to be called from outside the
 * engine. NEVER throws, never rejects, never blocks the caller.
 */
export function safeEmitLeadEvent(
  event: LeadWorkflowEvent,
  organizationId: number | null | undefined,
  leadId: number | null | undefined,
  data: Record<string, any>,
  previousData?: Record<string, any>,
): void {
  // Guard rather than fabricate: an event with a bogus org/entity id would
  // either match nothing or (worse) leak across tenants. Drop it loudly.
  if (
    typeof organizationId !== "number" ||
    !Number.isFinite(organizationId) ||
    typeof leadId !== "number" ||
    !Number.isFinite(leadId)
  ) {
    logger.warn("Skipped lead workflow event with missing org/lead id", {
      event,
      organizationId: typeof organizationId === "number" ? organizationId : undefined,
      metadata: { leadId },
    });
    return;
  }

  try {
    emitLeadEvent(event, organizationId, leadId, data, previousData);
  } catch (err) {
    logger.warn("Lead workflow event emit failed (non-fatal)", {
      event,
      organizationId,
      metadata: { leadId },
      error: err instanceof Error ? err : String(err),
    });
  }
}

/** Emit `lead.created` for a persisted lead row. Fire-and-forget. */
export function emitLeadCreated(
  organizationId: number | null | undefined,
  lead: Record<string, any> | null | undefined,
): void {
  if (!lead) return;
  safeEmitLeadEvent("lead.created", organizationId, lead.id, { ...lead });
}

/**
 * Emit the right event for a lead update:
 *   - status actually changed → `lead.status_changed` (carries previousData)
 *   - other material field changed → `lead.updated`
 *   - nothing changed → NOTHING is emitted
 *
 * Returns the event that was emitted (or null), which makes the no-op
 * contract directly assertable in tests.
 */
export function emitLeadUpdated(
  organizationId: number | null | undefined,
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
  attemptedFields: readonly string[],
): LeadWorkflowEvent | null {
  if (!before || !after) return null;
  const changed = changedLeadFields(before, after, attemptedFields);
  if (changed.length === 0) return null;

  const leadId = (after.id ?? before.id) as number | undefined;
  const event: LeadWorkflowEvent = changed.includes("status")
    ? "lead.status_changed"
    : "lead.updated";

  safeEmitLeadEvent(
    event,
    organizationId,
    leadId,
    { ...after, changedFields: changed },
    { ...before },
  );
  return event;
}
