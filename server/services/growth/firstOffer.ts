/**
 * Has this org made an offer? Real rows only: sample-book rows and soft-deleted
 * deals are excluded, every read is scoped to the org. See
 * shared/growth/firstOffer.ts for what counts and what deliberately does not.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { deals, offers, properties } from "@shared/schema";
import {
  OFFER_MADE_DEAL_STATUSES,
  OFFER_MADE_OFFER_STATUSES,
  OFFER_MADE_PROPERTY_STATUSES,
} from "@shared/growth/firstOffer";
import { realDeal, realOffer, realProperty } from "../onboarding/sampleFilters";

export async function orgHasMadeAnOffer(organizationId: number): Promise<boolean> {
  const [dealRows, offerRows, propertyRows] = await Promise.all([
    db
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(
          eq(deals.organizationId, organizationId),
          inArray(deals.status, [...OFFER_MADE_DEAL_STATUSES]),
          isNull(deals.deletedAt),
          realDeal(),
        ),
      )
      .limit(1),
    db
      .select({ id: offers.id })
      .from(offers)
      .where(
        and(
          eq(offers.organizationId, organizationId),
          inArray(offers.status, [...OFFER_MADE_OFFER_STATUSES]),
          realOffer(),
        ),
      )
      .limit(1),
    db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, organizationId),
          inArray(properties.status, [...OFFER_MADE_PROPERTY_STATUSES]),
          realProperty(),
        ),
      )
      .limit(1),
  ]);
  return dealRows.length + offerRows.length + propertyRows.length > 0;
}
