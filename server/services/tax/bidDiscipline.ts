/**
 * Bid discipline — V-Tax-1 T3a. The max-bid decision record, pre-bid
 * discards, and how a logged bid stands against both. The arithmetic and the
 * record shapes are pure, in shared/tax/maxBid.ts; this file reads and writes
 * the listing, always scoped to the organization.
 */
import { and, eq } from "drizzle-orm";
import { taxSaleListings } from "@shared/schema";
import {
  bidAgainstMax,
  deriveMaxBid,
  isDiscarded,
  type BidAgainstMax,
  type DiscardReason,
  type DiscardRecord,
  type MaxBidRecord,
  type MaxBidScreen,
  type RightsStackInput,
} from "@shared/tax/maxBid";
import { clock } from "../../utils/clock";

async function loadListing(organizationId: number, listingId: number) {
  const { db } = await import("../../db");
  const [row] = await db
    .select({
      id: taxSaleListings.id,
      status: taxSaleListings.status,
      maxBidCents: taxSaleListings.maxBidCents,
      maxBidBasis: taxSaleListings.maxBidBasis,
      discard: taxSaleListings.discard,
    })
    .from(taxSaleListings)
    .where(and(eq(taxSaleListings.id, listingId), eq(taxSaleListings.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export type RecordMaxBidResult =
  | { status: "not_found" }
  | { status: "refused"; screen: Extract<MaxBidScreen, { status: "refused" }> }
  | { status: "recorded"; record: MaxBidRecord };

/** Derive the max from the stack and record it as the listing's max bid, with its basis. */
export async function recordMaxBid(organizationId: number, listingId: number, input: RightsStackInput, userId: string | null): Promise<RecordMaxBidResult> {
  const listing = await loadListing(organizationId, listingId);
  if (!listing) return { status: "not_found" };
  const screen = deriveMaxBid(input);
  if (screen.status === "refused") return { status: "refused", screen };
  const record: MaxBidRecord = {
    input,
    maxBidCents: screen.maxBidCents,
    leavesNothing: screen.leavesNothing,
    lines: screen.lines,
    recordedAt: clock.now().toISOString(),
    recordedByUserId: userId,
  };
  const { db } = await import("../../db");
  await db
    .update(taxSaleListings)
    .set({ maxBidCents: record.maxBidCents, maxBidBasis: record, updatedAt: clock.now() })
    .where(and(eq(taxSaleListings.id, listingId), eq(taxSaleListings.organizationId, organizationId)));
  return { status: "recorded", record };
}

/**
 * A max bid typed directly (the worksheet field) no longer matches the
 * recorded derivation, so the basis is dropped rather than left describing a
 * number it did not produce. The same number keeps its basis.
 */
export function basisAfterManualMax(current: MaxBidRecord | null, nextMaxBidCents: number | null): MaxBidRecord | null {
  if (!current) return null;
  return current.maxBidCents === nextMaxBidCents ? current : null;
}

export type DiscardResult = { status: "not_found" } | { status: "already_discarded"; discard: DiscardRecord } | { status: "discarded"; discard: DiscardRecord };

export async function discardLot(organizationId: number, listingId: number, reason: DiscardReason, note: string | null, userId: string | null): Promise<DiscardResult> {
  const listing = await loadListing(organizationId, listingId);
  if (!listing) return { status: "not_found" };
  if (isDiscarded(listing.discard)) return { status: "already_discarded", discard: listing.discard };
  const discard: DiscardRecord = {
    reason,
    note,
    discardedAt: clock.now().toISOString(),
    discardedByUserId: userId,
    priorStatus: listing.status,
    reopened: null,
  };
  const { db } = await import("../../db");
  await db
    .update(taxSaleListings)
    .set({ discard, status: "discarded", updatedAt: clock.now() })
    .where(and(eq(taxSaleListings.id, listingId), eq(taxSaleListings.organizationId, organizationId)));
  return { status: "discarded", discard };
}

export type ReopenResult = { status: "not_found" } | { status: "not_discarded" } | { status: "reopened"; discard: DiscardRecord };

/** Reopen a discarded lot. The discard stays on record with who reopened it and why. */
export async function reopenLot(organizationId: number, listingId: number, note: string | null, userId: string | null): Promise<ReopenResult> {
  const listing = await loadListing(organizationId, listingId);
  if (!listing) return { status: "not_found" };
  if (!isDiscarded(listing.discard)) return { status: "not_discarded" };
  const discard: DiscardRecord = { ...listing.discard, reopened: { at: clock.now().toISOString(), byUserId: userId, note } };
  const { db } = await import("../../db");
  await db
    .update(taxSaleListings)
    .set({ discard, status: listing.discard.priorStatus, updatedAt: clock.now() })
    .where(and(eq(taxSaleListings.id, listingId), eq(taxSaleListings.organizationId, organizationId)));
  return { status: "reopened", discard };
}

export type BidStanding =
  | { status: "not_found" }
  | { status: "discarded"; discard: DiscardRecord }
  | { status: "checked"; maxBidCents: number | null; against: BidAgainstMax };

/** How a bid or win of `amountCents` stands on this listing: discarded, or measured against its max. */
export async function bidStanding(organizationId: number, listingId: number, amountCents: number): Promise<BidStanding> {
  const listing = await loadListing(organizationId, listingId);
  if (!listing) return { status: "not_found" };
  if (isDiscarded(listing.discard)) return { status: "discarded", discard: listing.discard };
  return {
    status: "checked",
    maxBidCents: listing.maxBidCents ?? null,
    against: bidAgainstMax(amountCents, listing.maxBidCents ?? null, listing.maxBidBasis ?? null),
  };
}
