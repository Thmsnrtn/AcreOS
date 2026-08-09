// ---------------------------------------------------------------------------
// Short-term-rental (STR) workflow-event emitter (STR Wave A).
//
// The STR nightly-stay lane had no primitive at all until this wave — STR rode
// the monthly-lease stack, so there was nothing a workflow could fire on when a
// guest checked out. Now a reservation is its own row (shared/schema/rental.ts),
// and this module is the ONE seam the checkout lifecycle goes through to make
// `reservation.checkout` real, wired onto a write-path that already exists:
//   - a reservation's status flips to 'checked_out'   → reservation.checkout
//     (server/routes-rent-ledger.ts PATCH /api/reservations/:id/status)
//
// Sibling of rentalEvents.ts / noteEvents.ts; same rules:
//   1. FIRE-AND-FORGET. A workflow failure must never fail the status write.
//      The emitter swallows its own errors and never throws.
//   2. NO FABRICATION. The payload carries ONLY columns the reservation row
//      genuinely holds plus context resolved from real joins (the property
//      address, the unit label when a unitId is set, the org name). Every
//      nullable field passes through as its real value or null, never a
//      fabricated placeholder. There is NO guest email and NO guest mail on the
//      platform sender — the template creates a turnover task + notification
//      only (counterparty/guest mail requires the org's own connected identity,
//      which STR does not wire here).
//
// entityType/entityId: a reservation hangs off a real PROPERTY
// (reservations.propertyId is a non-null FK to properties.id), so emitStrEvent
// uses entityType "property" and entityId is that properties.id. The reservation
// id + the guest/stay fields ride in `data`.
//
// When this emit call site changes, shared/workflow-live-triggers.ts must list
// the event in the SAME change — tests/unit/workflowActionHonesty.test.ts
// DERIVES the live set from these call sites and pins both directions.
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { properties, organizations, rentalUnits } from "@shared/schema";
import { emitStrEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

/** properties.address (genuinely nullable) or null. Never a fabricated street. */
async function resolvePropertyAddress(
  organizationId: number,
  propertyId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ address: properties.address })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return row?.address ?? null;
}

/** The org's display name, or null. Rides the turnover task/notification copy. */
async function resolveOrgName(organizationId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.name ?? null;
}

/** rental_units.label for the stay's slot, or null when the stay has no unitId. */
async function resolveUnitLabel(
  organizationId: number,
  unitId: string | null,
): Promise<string | null> {
  if (!unitId) return null;
  const [row] = await db
    .select({ label: rentalUnits.label })
    .from(rentalUnits)
    .where(and(eq(rentalUnits.id, unitId), eq(rentalUnits.organizationId, organizationId)))
    .limit(1);
  return row?.label ?? null;
}

export interface ReservationCheckoutInput {
  organizationId: number;
  reservationId: string;
  /** reservations.propertyId — the numeric entity handle (properties.id). */
  propertyId: number;
  unitId: string | null;
  guestName: string | null;
  /** reservations.checkOut (YYYY-MM-DD). */
  checkOut: string;
  /** reservations.channel recorded label, or null. */
  channel: string | null;
}

/**
 * The turnover-cleaning payload. Drives tpl_str_turnover_cleaning — every
 * placeholder it interpolates is bound here to a real reservation column or a
 * real join, or null. No guest email, no market rate, no fabricated field.
 */
function buildReservationCheckoutPayload(
  ctx: ReservationCheckoutInput & { propertyAddress: string | null; unitLabel: string | null; orgName: string | null },
): Record<string, any> {
  return {
    reservationId: ctx.reservationId,
    propertyAddress: ctx.propertyAddress,
    unitLabel: ctx.unitLabel,
    guestName: ctx.guestName,
    checkOutDate: ctx.checkOut,
    channel: ctx.channel,
    orgName: ctx.orgName,
  };
}

/**
 * Emit reservation.checkout for a stay whose status has ALREADY been committed
 * to 'checked_out'. Fire-and-forget: resolves the property/unit/org context off
 * the request path and never throws back into the response.
 */
export function emitReservationCheckout(input: ReservationCheckoutInput): void {
  void (async () => {
    const [propertyAddress, unitLabel, orgName] = await Promise.all([
      resolvePropertyAddress(input.organizationId, input.propertyId),
      resolveUnitLabel(input.organizationId, input.unitId),
      resolveOrgName(input.organizationId),
    ]);
    emitStrEvent(
      "reservation.checkout",
      input.organizationId,
      input.propertyId,
      buildReservationCheckoutPayload({ ...input, propertyAddress, unitLabel, orgName }),
    );
  })().catch((err) => {
    logger.warn(`[strEvents] emit reservation.checkout failed for reservation ${input.reservationId}`, {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  });
}
