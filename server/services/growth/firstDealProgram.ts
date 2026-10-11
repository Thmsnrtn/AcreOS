/**
 * The org's REAL state for the first-deal program (shared/growth/firstDeal.ts).
 * Every number is a count of this org's rows, sample-book rows excluded
 * (onboarding/sampleFilters.ts):
 *
 *   leads            non-deleted, real leads
 *   outreach sent    mail pieces in shipments that LEFT (sending / sent /
 *                    partial_failed — a shipment still in its hold or cancelled
 *                    sent nothing) + campaign delivery events not failed or
 *                    bounced + outbound messages not failed
 *   replied leads    real leads with an inbound message, or whose status moved
 *                    to an engaged status (responded, negotiating, accepted…)
 *   accepted deal    the oldest real deal at accepted / in_escrow
 *   closed deals     real deals at a closed status
 */
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { campaignDeliveryEvents, campaigns, conversations, deals, leads, mailShipments, messages, organizations } from "@shared/schema";
import { CLOSED_DEAL_STATUSES, ENGAGED_LEAD_STATUSES } from "@shared/lifecycle/pipeline-status";
import { nextFirstDealStep, type FirstDealState, type FirstDealStep } from "@shared/growth/firstDeal";
import { realDeal, realLead } from "../onboarding/sampleFilters";
import { clock } from "../../utils/clock";

const n = (v: unknown) => Number(v ?? 0) || 0;

async function firstDealStateForOrg(organizationId: number): Promise<FirstDealState | null> {
  const [org] = await db
    .select({ createdAt: organizations.createdAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return null;

  const [leadRow, mailRow, campaignRow, outboundRow, repliedRow, closedRow, accepted] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), isNull(leads.deletedAt), realLead())),
    db
      .select({ c: sql<number>`coalesce(sum(${mailShipments.pieceCount}), 0)::int` })
      .from(mailShipments)
      .where(and(eq(mailShipments.organizationId, organizationId), inArray(mailShipments.status, ["sending", "sent", "partial_failed"]))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(campaignDeliveryEvents)
      .innerJoin(campaigns, eq(campaigns.id, campaignDeliveryEvents.campaignId))
      .where(and(eq(campaigns.organizationId, organizationId), notInArray(campaignDeliveryEvents.status, ["failed", "bounced"]))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.organizationId, organizationId), eq(messages.direction, "outbound"), sql`${messages.status} <> 'failed'`)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, organizationId),
          isNull(leads.deletedAt),
          realLead(),
          sql`(${inArray(leads.status, [...ENGAGED_LEAD_STATUSES])} OR EXISTS (
            SELECT 1 FROM ${conversations} JOIN ${messages} ON ${messages.conversationId} = ${conversations.id}
            WHERE ${conversations.leadId} = ${leads.id} AND ${conversations.organizationId} = ${organizationId}
              AND ${messages.direction} = 'inbound'))`,
        ),
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(deals)
      .where(and(eq(deals.organizationId, organizationId), inArray(deals.status, [...CLOSED_DEAL_STATUSES]), isNull(deals.deletedAt), realDeal())),
    db
      .select({
        id: deals.id,
        titleCompany: deals.titleCompany,
        escrowNumber: deals.escrowNumber,
        closingDate: deals.closingDate,
        documents: deals.documents,
        propertyId: deals.propertyId,
      })
      .from(deals)
      .where(and(eq(deals.organizationId, organizationId), inArray(deals.status, ["accepted", "in_escrow"]), isNull(deals.deletedAt), realDeal()))
      .orderBy(asc(deals.id))
      .limit(1),
  ]);

  let acceptedDeal: FirstDealState["acceptedDeal"] = null;
  if (accepted[0]) {
    const d = accepted[0];
    const { properties } = await import("@shared/schema");
    const [prop] = await db
      .select({ dd: properties.dueDiligenceData })
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), eq(properties.id, d.propertyId)))
      .limit(1);
    acceptedDeal = {
      id: d.id,
      titleCompany: d.titleCompany,
      escrowNumber: d.escrowNumber,
      closingDate: d.closingDate,
      documentCount: Array.isArray(d.documents) ? d.documents.length : 0,
      dueDiligenceDone: prop?.dd?.checklistCompleted ?? null,
    };
  }

  return {
    orgCreatedAt: org.createdAt ?? clock.now(),
    now: clock.now(),
    leadCount: n(leadRow[0]?.c),
    outreachSentCount: n(mailRow[0]?.c) + n(campaignRow[0]?.c) + n(outboundRow[0]?.c),
    repliedLeadCount: n(repliedRow[0]?.c),
    acceptedDeal,
    closedDealCount: n(closedRow[0]?.c),
  };
}

export async function firstDealStepForOrg(organizationId: number): Promise<FirstDealStep | null> {
  const state = await firstDealStateForOrg(organizationId);
  return state ? nextFirstDealStep(state) : null;
}
