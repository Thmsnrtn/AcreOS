// ---------------------------------------------------------------------------
// Buyer-match workflow-event emitter (audit Wave 1, beta→core).
//
// `emitBuyerEvent` has lived in the workflow engine but had ZERO call sites, so
// the tpl_buyer_match_found template a customer installed sat idle forever — the
// buyer↔property match automation lane was dead. This module is the ONE seam the
// buyer matcher goes through to make `buyer.match_created` real, wired onto the
// AI matcher's fresh-insert branch (buyerMatchingAI.matchPropertyToBuyers /
// matchBuyerToProperties) — NEVER the update-existing branch, so a re-run of the
// matcher never re-fires an event for a match that already existed.
//
// Sibling of wholesaleEvents.ts / subdivisionEvents.ts / rehabEvents.ts; same
// rules:
//   1. FIRE-AND-FORGET. A workflow failure must never fail a match write. The
//      emit is wrapped in try/catch and never throws.
//   2. NEVER EMIT A NO-OP. It fires ONLY when the caller inserts a genuinely NEW
//      match row.
//   3. NO FABRICATION. The payload carries ONLY real values: the match row's own
//      columns plus the buyer contact the caller resolves from
//      buyer_profiles.leadId → leads (email / firstName / firstName+lastName)
//      and the property address. When the buyer profile has NO linked lead, the
//      contact fields pass through as null — never a fabricated address/name.
//      The tpl_buyer_match_found send_email targets {{buyerEmail}}: a null email
//      renders blank, so the engine's counterparty mail rail refuses rather than
//      sending to an invented recipient.
//
// entityType/entityId: the event is about the BUYER, so entityType is "buyer"
// and entityId is the buyer_profiles.id the match belongs to (a real numeric id;
// the property id + match id ride in `data`). The caller resolves the contact +
// property address and passes them in via `ctx`; this service does NO DB access,
// so its test stays pure (mock the engine helper only).
//
// When an emit call site is added, shared/workflow-live-triggers.ts must list
// the event in the SAME change — tests/unit/workflowActionHonesty.test.ts pins
// that relationship (it derives the live set from these call sites).
// ---------------------------------------------------------------------------

import { emitBuyerEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

/** The slice of a buyer_property_matches row this emitter needs. Real columns only. */
export interface BuyerMatchEventRow {
  id: number;
  organizationId: number;
  buyerProfileId: number;
  propertyId: number;
}

/**
 * The real buyer contact + property address the caller resolves. Every field is
 * genuinely nullable (a buyer profile may have no linked lead; a property's
 * address column is nullable) and passes through as its real value or null —
 * never a fabricated recipient/name/address.
 */
export interface BuyerMatchContext {
  propertyAddress: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  buyerFirstName: string | null;
}

/**
 * Emit buyer.match_created for a genuinely NEW buyer↔property match. The caller
 * invokes this ONLY on its fresh-insert branch (never the update-existing
 * branch). Fire-and-forget: never throws.
 */
export function emitBuyerMatchCreated(
  match: BuyerMatchEventRow,
  ctx: BuyerMatchContext,
): void {
  try {
    emitBuyerEvent(
      "buyer.match_created",
      match.organizationId,
      match.buyerProfileId, // entityId is the buyer_profiles.id the match is for
      {
        matchId: match.id,
        buyerProfileId: match.buyerProfileId,
        propertyId: match.propertyId,
        propertyAddress: ctx.propertyAddress,
        buyerEmail: ctx.buyerEmail,
        buyerName: ctx.buyerName,
        buyerFirstName: ctx.buyerFirstName,
      },
    );
  } catch (err) {
    logger.warn(
      `[buyerEvents] emit buyer.match_created failed for match ${match.id}`,
      { metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}
