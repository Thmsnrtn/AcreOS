/**
 * Withdrawing a listing, whoever asks (DEFECT-0173 / DEFECT-0181).
 *
 * One transition rule for every path that takes a listing off the market:
 * the operator's unpublish, and a property that stops being held (sold,
 * deleted, back to prospect). A target that was live becomes
 * `withdrawal_requested` when it has a take-down API and a saved external id
 * — the per-channel take-down then verifies it with the provider — or
 * `manual_action_required` when someone must remove it by hand. A target
 * that never went out keeps its status. Nothing here claims "removed": only
 * a provider's 2xx on a take-down earns that.
 *
 * Before DEFECT-0181, a parcel that sold kept its listing "active" and live
 * on every channel it had reached; sync-all skipped it (DEFECT-0174) but
 * nothing ever asked for it to come down.
 */
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "../db";
import { propertyListings, type PropertyListing } from "@shared/schema";
import { TAKE_DOWN_PLATFORMS, canonicalPlatform } from "./listingSyndication";
import { offerabilityRefusal } from "./listability";
import { logger } from "../utils/logger";

type Targets = NonNullable<PropertyListing["syndicationTargets"]>;

/**
 * A channel holding a posting that may be live, or one still coming down.
 * Never post a second copy onto it, and never replace its record — the
 * saved external id is what take-down needs. One set for every route
 * (publish, syndicate, sync-all).
 */
export const OCCUPIED_TARGET_STATUSES: readonly string[] = [
  "active",
  "pending",
  "withdrawal_requested",
  "withdrawal_failed",
  "manual_action_required",
];

/**
 * A copy/paste channel (Craigslist) returns text for the operator to post by
 * hand — no external id, no confirmation it went up. That is recorded as
 * `manual_posting`, not `active`: AcreOS never claims a live posting it did
 * not make. It is re-postable (the text can be regenerated), and a
 * withdrawal asks the operator to remove it if they posted it.
 */
export const MANUAL_POSTING = "manual_posting";

export function withdrawnTargets(targets: PropertyListing["syndicationTargets"]): Targets {
  return (targets ?? []).map((target) => {
    if (target.status === MANUAL_POSTING) return { ...target, status: "manual_action_required" };
    if (target.status !== "active" && target.status !== "pending") return target;
    const apiRemovable = !!target.listingId && TAKE_DOWN_PLATFORMS.includes(canonicalPlatform(target.platform));
    return { ...target, status: apiRemovable ? "withdrawal_requested" : "manual_action_required" };
  });
}

/**
 * Take every open listing for a property off the market once the property is
 * no longer held. Returns how many listings were withdrawn. A held status is
 * a no-op, so callers may run it on any status change.
 */
export async function withdrawListingsForUnheldProperty(
  organizationId: number,
  propertyId: number,
  propertyStatus: string | null | undefined,
): Promise<number> {
  if (!offerabilityRefusal(propertyStatus)) return 0;
  const open = await db
    .select()
    .from(propertyListings)
    .where(
      and(
        eq(propertyListings.organizationId, organizationId),
        eq(propertyListings.propertyId, propertyId),
        notInArray(propertyListings.status, ["sold", "withdrawn"]),
      ),
    );
  for (const listing of open) {
    await db
      .update(propertyListings)
      .set({
        status: propertyStatus === "sold" ? "sold" : "withdrawn",
        syndicationTargets: withdrawnTargets(listing.syndicationTargets),
        updatedAt: new Date(),
      })
      .where(and(eq(propertyListings.id, listing.id), eq(propertyListings.organizationId, organizationId)));
  }
  if (open.length > 0) {
    logger.info("Listings withdrawn: property no longer held", {
      organizationId,
      propertyId,
      propertyStatus,
      listings: open.length,
    });
  }
  return open.length;
}
