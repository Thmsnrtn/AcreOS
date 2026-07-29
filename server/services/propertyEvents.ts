// ---------------------------------------------------------------------------
// Property workflow-event emitters (Wave B "Wire the engine", 2026-07-29).
//
// `emitPropertyEvent` has lived in the workflow engine since the engine
// shipped but had ZERO call sites, so any automation a customer built on
// `property.created` / `property.status_changed` sat idle forever. This module
// is the ONE seam every property write path goes through to make those events
// real.
//
// Sibling of `leadEvents.ts` / `dealEvents.ts`; same three rules:
//
//   1. FIRE-AND-FORGET. A workflow failure must never fail a property write.
//      Every helper here swallows and logs.
//   2. NEVER EMIT A NO-OP. `property.status_changed` fires only on a GENUINE
//      pipeline-status transition (prospect → due_diligence → offer_sent →
//      under_contract → owned → listed → sold). An edit that never touched
//      `status` emits nothing.
//   3. NO FABRICATION. The payload is built from the real persisted row;
//      absent columns are `null`.
//
// Deliberately NOT wired to `landStatus` (the fee / trust / restricted-fee
// determination on PATCH /api/properties/:id/land-status). That is a
// regulatory classification, not the pipeline status the `property.*` trigger
// family describes — emitting a status_changed for it would tell customers
// their pipeline moved when it did not.
//
// When a new emit call site is added, `shared/workflow-live-triggers.ts` must
// list the event in the SAME change — tests/unit/workflowActionHonesty.test.ts
// pins that relationship.
// ---------------------------------------------------------------------------

import { emitPropertyEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

/**
 * The slice of a property row these emitters need. Duck-typed so callers can
 * pass a full `Property`, a narrowed select, or a `{ ...before, status }`
 * projection without importing the schema types.
 */
export interface PropertyEventRow {
  id: number;
  status?: string | null;
  apn?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
  sizeAcres?: string | number | null;
  listPrice?: string | number | null;
  marketValue?: string | number | null;
  purchasePrice?: string | number | null;
}

/** Build the workflow payload for a property row. Real columns only. */
export function buildPropertyEventData(property: PropertyEventRow): Record<string, any> {
  const status = property.status ?? null;
  return {
    propertyId: property.id,
    status,
    // Alias of the row's own status under the condition-field name the
    // workflow builder offers. Not an invented value.
    newStatus: status,
    apn: property.apn ?? null,
    propertyAddress: property.address ?? null,
    city: property.city ?? null,
    county: property.county ?? null,
    state: property.state ?? null,
    zip: property.zip ?? null,
    sizeAcres: property.sizeAcres ?? null,
    listPrice: property.listPrice ?? null,
    marketValue: property.marketValue ?? null,
    purchasePrice: property.purchasePrice ?? null,
  };
}

/**
 * True only when this is a GENUINE status transition: both a real pre-image
 * and a real post-image exist and their statuses differ. Pure — exported so
 * the no-op rule is directly testable.
 */
export function isRealPropertyStatusChange(
  before: { status?: string | null } | null | undefined,
  after: { status?: string | null } | null | undefined,
): boolean {
  if (!before || !after) return false;
  return (before.status ?? null) !== (after.status ?? null);
}

function swallow(event: string, propertyId: number, organizationId: number, err: unknown): void {
  logger.warn("Property workflow event emit failed (non-fatal)", {
    metadata: {
      event,
      propertyId,
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    },
  });
}

/** `property.created` — called by every real property-creation path. */
export function emitPropertyCreated(
  organizationId: number,
  property: PropertyEventRow | null | undefined,
): void {
  if (!property) return;
  try {
    emitPropertyEvent(
      "property.created",
      organizationId,
      property.id,
      buildPropertyEventData(property),
    );
  } catch (err) {
    swallow("property.created", property.id, organizationId, err);
  }
}

/**
 * `property.status_changed` — `previousData` carries the payload built from
 * the REAL pre-update row. Emits nothing on a no-op.
 */
export function emitPropertyStatusChanged(
  organizationId: number,
  before: PropertyEventRow | null | undefined,
  after: PropertyEventRow | null | undefined,
): void {
  if (!isRealPropertyStatusChange(before, after)) return;
  try {
    emitPropertyEvent(
      "property.status_changed",
      organizationId,
      after!.id,
      buildPropertyEventData(after!),
      buildPropertyEventData(before!),
    );
  } catch (err) {
    swallow("property.status_changed", after!.id, organizationId, err);
  }
}
