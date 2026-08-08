// ---------------------------------------------------------------------------
// Residential-wholesaler deal workflow-event emitters (audit Wave 1, beta→core).
//
// `emitWholesaleDealEvent` has lived in the workflow engine but had ZERO call
// sites, so the wholesaler templates a customer installed
// (tpl_wholesaler_contract_signed_buyer_broadcast /
// tpl_wholesaler_assignment_pending) sat idle forever — the whole
// contract→assignment automation lane was dead. This module is the ONE seam the
// wholesaler deal lifecycle goes through to make `deal.contract_signed` and
// `deal.assignment_pending` real, wired onto two operator write-paths that
// already exist:
//   - a deal genuinely entering escrow (accepted → in_escrow) = a signed
//     purchase agreement       → deal.contract_signed
//   - a contract_assignments row genuinely reaching "sent_for_signature"
//                               → deal.assignment_pending
//
// The third wholesaler template (tpl_wholesaler_occupied_cash_for_keys, event
// deal.occupied) is deliberately NOT wired: no occupancy/occupant/cash-for-keys
// column or table exists on the deal/property path, so it cannot be made honest.
// It stays installable but honestly badged "not live" (deal.occupied is not in
// LIVE_WORKFLOW_TRIGGER_EVENTS) until an occupancy schema ships.
//
// Sibling of subdivisionEvents.ts / certificateEvents.ts / rehabEvents.ts; same
// rules:
//   1. FIRE-AND-FORGET. A workflow failure must never fail a deal/assignment
//      write. Every function wraps its emit in try/catch and never throws.
//   2. NEVER EMIT A NO-OP where a transition is required. Each event fires ONLY
//      on a genuine status transition INTO the target state (the real pre-image
//      status was NOT already that state, the post-image status IS).
//   3. NO FABRICATION. The payload carries ONLY columns the row genuinely holds
//      plus context the route resolves from real columns (the deal→property
//      join for the address/state). The two fabricated template placeholders
//      were corrected in the same change: the broadcast task dropped
//      {{askingPrice}}/{{assignmentFee}}/{{compArv}} (a wholesaler has no comps
//      plane and no assignment fee at contract-signing time) and now prompts the
//      operator to pull fresh comps; the assignment task dropped
//      {{buyerEntity}}/{{buyerPrice}} (no column supplies either). Every nullable
//      field passes through as its real value or null, never a placeholder 0.
//
// entityType/entityId: both events hang off a real deal, so entityType is "deal"
// and entityId is the deals.id (deal.contract_signed) or the assignment's
// dealId (deal.assignment_pending). The route handler resolves propertyAddress /
// state from the deal→property join and passes them in via `ctx`; this service
// NEVER imports from routes-*.ts, so there is no import cycle.
//
// When an emit call site is added, shared/workflow-live-triggers.ts must list
// the event in the SAME change — tests/unit/workflowActionHonesty.test.ts pins
// that relationship (it derives the live set from these call sites).
// ---------------------------------------------------------------------------

import { emitWholesaleDealEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

/** The slice of a deals row this emitter needs. Real columns only. */
export interface WholesaleDealEventRow {
  id: number;
  organizationId: number;
  status: string;
  // The accepted purchase price = the wholesaler's contract price. numeric
  // columns come back as strings, so this is string|null.
  acceptedAmount?: string | number | null;
  // timestamp column — Date | ISO string | null.
  closingDate?: Date | string | null;
}

/**
 * Context the route resolves for a contract-signed deal. propertyAddress is
 * computed in the route (which holds the deal→property join); it is genuinely
 * nullable (properties.address is nullable) and passes through as its real value
 * or null — never a fabricated address.
 */
export interface ContractSignedContext {
  propertyAddress: string | null;
}

/** The slice of a contract_assignments row this emitter needs. Real columns only. */
export interface AssignmentEventRow {
  id: number;
  organizationId: number;
  dealId: number;
  status: string;
  assignmentFeeCents?: number | null;
  endBuyerName?: string | null;
  originalContractDate?: string | null;
}

/**
 * Context the route resolves for a pending assignment. propertyAddress + state
 * are computed in the route from the deal→property join; both are genuinely
 * nullable and pass through as their real value or null — never fabricated.
 */
export interface AssignmentPendingContext {
  propertyAddress: string | null;
  state: string | null;
}

const dollars = (cents: number | null | undefined): number | null =>
  cents == null ? null : Math.round(cents) / 100;

const num = (v: string | number | null | undefined): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A timestamp column → an ISO day string, or null. Never a wall-clock guess. */
const isoDayOf = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const isoDay = (): string => new Date().toISOString().slice(0, 10);

/**
 * Emit deal.contract_signed ONLY on a genuine transition of a deal INTO
 * "in_escrow" (pre-image status was NOT already "in_escrow", post-image status
 * IS). Per DEAL_STATUS_TRANSITIONS the only path in is accepted → in_escrow, so
 * a signed purchase agreement IS the deal entering escrow. Any other deal edit
 * is a no-op. Fire-and-forget: never throws.
 */
export function emitContractSigned(
  beforeStatus: string | null | undefined,
  deal: WholesaleDealEventRow,
  ctx: ContractSignedContext,
): void {
  try {
    if (beforeStatus === "in_escrow" || deal.status !== "in_escrow") return; // no genuine transition
    emitWholesaleDealEvent(
      "deal.contract_signed",
      deal.organizationId,
      deal.id,
      {
        dealId: deal.id,
        propertyAddress: ctx.propertyAddress,
        contractPrice: num(deal.acceptedAmount), // the accepted purchase price
        closingDate: isoDayOf(deal.closingDate),
        contractDate: isoDay(), // the transition IS happening now
      },
    );
  } catch (err) {
    logger.warn(
      `[wholesaleEvents] emit deal.contract_signed failed for deal ${deal.id}`,
      { metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}

/**
 * Emit deal.assignment_pending ONLY on a genuine transition of a
 * contract_assignments row INTO "sent_for_signature" (pre-image status was NOT
 * already "sent_for_signature", post-image status IS). Any other assignment edit
 * is a no-op. Fire-and-forget: never throws.
 */
export function emitAssignmentPending(
  beforeStatus: string | null | undefined,
  assignment: AssignmentEventRow,
  ctx: AssignmentPendingContext,
): void {
  try {
    if (beforeStatus === "sent_for_signature" || assignment.status !== "sent_for_signature") {
      return; // no genuine transition
    }
    emitWholesaleDealEvent(
      "deal.assignment_pending",
      assignment.organizationId,
      assignment.dealId, // entityId is the DEAL the assignment hangs off
      {
        assignmentId: assignment.id,
        dealId: assignment.dealId,
        propertyAddress: ctx.propertyAddress,
        state: ctx.state,
        assignmentFee: dollars(assignment.assignmentFeeCents),
        // end_buyer_name is nullable (an end buyer may be a linked profile with
        // no free-text name) — pass the real value or null, never a placeholder.
        buyerName: assignment.endBuyerName ?? null,
        originalContractDate: assignment.originalContractDate ?? null,
      },
    );
  } catch (err) {
    logger.warn(
      `[wholesaleEvents] emit deal.assignment_pending failed for assignment ${assignment.id}`,
      { metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}
