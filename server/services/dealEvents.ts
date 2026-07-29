// ---------------------------------------------------------------------------
// Deal workflow-event emitters (Wave B "Wire the engine", 2026-07-29).
//
// `emitDealEvent` has lived in the workflow engine since the engine shipped
// but had ZERO call sites, so every "Deal Closed" / "Deal Stage Advanced" /
// "Seller Finance Note Setup" automation a customer installed sat idle
// forever. This module is the ONE seam every deal write path goes through to
// make `deal.created` and `deal.stage_changed` real.
//
// Sibling of `leadEvents.ts` / `propertyEvents.ts`; same three rules:
//
//   1. FIRE-AND-FORGET. A workflow failure must never fail a deal write.
//      `emitDealEvent` is declared `void` but calls an async
//      `workflowEngine.emit()` internally; a synchronous throw would otherwise
//      propagate into the route handler's try/catch and 500 a request whose
//      write already committed. Every helper here swallows and logs.
//
//   2. NEVER EMIT A NO-OP. `deal.stage_changed` fires only on a GENUINE status
//      transition — a real pre-image and a real post-image whose statuses
//      differ. A field-only edit (price, notes, enrichment) is not a stage
//      change and must not wake a stage automation.
//
//   3. NO FABRICATION. The payload is built from the real persisted row.
//      `stage` / `newStage` are aliases of that row's own `status` — the
//      shipped `deal.stage_changed` templates express conditions as
//      `{ field: "stage" }` / `{ field: "newStage" }` and the engine's matcher
//      only reads `data[field]`, so aliasing the real status under those names
//      makes the templates match a true value. Nothing is invented; absent
//      columns are `null`.
//
// When a new emit call site is added, `shared/workflow-live-triggers.ts` must
// list the event in the SAME change — tests/unit/workflowActionHonesty.test.ts
// pins that relationship.
// ---------------------------------------------------------------------------

import { emitDealEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

/**
 * The slice of a deal row these emitters need. Duck-typed so callers can pass
 * a full `Deal`, a narrowed select, or a `{ ...before, status }` projection
 * without importing the schema types.
 */
export interface DealEventRow {
  id: number;
  type?: string | null;
  status?: string | null;
  propertyId?: number | null;
  offerAmount?: string | number | null;
  acceptedAmount?: string | number | null;
  closingDate?: Date | string | null;
}

/** Build the workflow payload for a deal row. Real columns only. */
export function buildDealEventData(deal: DealEventRow): Record<string, any> {
  const status = deal.status ?? null;
  return {
    dealId: deal.id,
    dealType: deal.type ?? null,
    status,
    // Deliberate aliases of the row's own status — see rule 3 above.
    stage: status,
    newStage: status,
    propertyId: deal.propertyId ?? null,
    offerAmount: deal.offerAmount ?? null,
    acceptedAmount: deal.acceptedAmount ?? null,
    closingDate: deal.closingDate ?? null,
  };
}

/**
 * True only when this is a GENUINE stage transition: both a real pre-image and
 * a real post-image exist and their statuses differ. Pure — exported so the
 * no-op rule is directly testable.
 */
export function isRealDealStageChange(
  before: { status?: string | null } | null | undefined,
  after: { status?: string | null } | null | undefined,
): boolean {
  if (!before || !after) return false;
  return (before.status ?? null) !== (after.status ?? null);
}

function swallow(event: string, dealId: number, organizationId: number, err: unknown): void {
  logger.warn("Deal workflow event emit failed (non-fatal)", {
    metadata: {
      event,
      dealId,
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    },
  });
}

/** `deal.created` — called by every real deal-creation path. */
export function emitDealCreated(
  organizationId: number,
  deal: DealEventRow | null | undefined,
): void {
  if (!deal) return;
  try {
    emitDealEvent("deal.created", organizationId, deal.id, buildDealEventData(deal));
  } catch (err) {
    swallow("deal.created", deal.id, organizationId, err);
  }
}

/**
 * `deal.stage_changed` — the pipeline's spine, and the highest-value trigger
 * in the set. `previousData` carries the payload built from the REAL
 * pre-update row, so the run log records an honest from→to. Emits nothing when
 * the status did not change or when there is no pre-image to compare against.
 */
export function emitDealStageChanged(
  organizationId: number,
  before: DealEventRow | null | undefined,
  after: DealEventRow | null | undefined,
): void {
  if (!isRealDealStageChange(before, after)) return;
  try {
    emitDealEvent(
      "deal.stage_changed",
      organizationId,
      after!.id,
      buildDealEventData(after!),
      buildDealEventData(before!),
    );
  } catch (err) {
    swallow("deal.stage_changed", after!.id, organizationId, err);
  }
}
