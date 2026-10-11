/**
 * Reads the REAL records behind the customer outcome metric
 * (shared/outcomes/customerOutcome.ts): closed, non-deleted deals; the
 * properties they closed on; and which of those properties carry a seller-
 * financed note. Nothing else feeds the number.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { deals, notes, properties } from "@shared/schema";
import { CLOSED_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
import {
  aggregateCustomerOutcomes,
  computeCustomerOutcome,
  type CustomerOutcome,
  type PlatformOutcomeAggregate,
} from "@shared/outcomes/customerOutcome";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { realDeal } from "../onboarding/sampleFilters";

export async function customerOutcomeForOrg(organizationId: number): Promise<CustomerOutcome> {
  const closedDeals = await db
    .select({
      id: deals.id,
      type: deals.type,
      propertyId: deals.propertyId,
      acceptedAmount: deals.acceptedAmount,
      closingCosts: deals.closingCosts,
      closingDate: deals.closingDate,
    })
    .from(deals)
    // Real records only: the "Try with sample data" book is not an outcome.
    .where(and(eq(deals.organizationId, organizationId), inArray(deals.status, [...CLOSED_DEAL_STATUSES]), isNull(deals.deletedAt), realDeal()));
  const propertyIds = Array.from(new Set(closedDeals.map((d) => d.propertyId)));
  const [props, noted] = propertyIds.length
    ? await Promise.all([
        db
          .select({ id: properties.id, purchasePrice: properties.purchasePrice, soldPrice: properties.soldPrice })
          .from(properties)
          .where(and(eq(properties.organizationId, organizationId), inArray(properties.id, propertyIds))),
        db
          .select({ propertyId: notes.propertyId })
          .from(notes)
          .where(and(eq(notes.organizationId, organizationId), inArray(notes.propertyId, propertyIds))),
      ])
    : [[], []];
  return computeCustomerOutcome({
    closedDeals,
    properties: props,
    ownerFinancedPropertyIds: noted.map((n) => n.propertyId).filter((x): x is number => x != null),
  });
}

/**
 * The founder Letter's aggregate. Cross-organization by design (founder-only
 * route); computes each org's outcome with the SAME function the customer
 * sees, then sums — no organization id leaves this function.
 */
export async function platformCustomerOutcomes(): Promise<PlatformOutcomeAggregate> {
  const orgRows = await unscopedForPlatformOps("founder Letter: customer outcome totals across organizations, no org ids returned")
    .selectDistinct({ organizationId: deals.organizationId })
    .from(deals)
    .where(and(inArray(deals.status, [...CLOSED_DEAL_STATUSES]), isNull(deals.deletedAt), realDeal()));
  const perOrg: CustomerOutcome[] = [];
  for (const r of orgRows) perOrg.push(await customerOutcomeForOrg(r.organizationId));
  return aggregateCustomerOutcomes(perOrg);
}
