// @ts-nocheck
/**
 * T41 — Cohort Analysis for Lead Conversion
 *
 * Segments leads by source, import date, state/county, campaign.
 * Tracks them through the funnel over time.
 *
 * Answers:
 *   - Of leads imported in Q4 2025, what % closed within 90 days?
 *   - Which source produces the most conversions?
 *   - What's the average time from import to close by market?
 *
 * Exposed via GET /api/analytics/cohorts
 */

import { db } from "../db";
import {
  leads,
  deals,
  campaigns,
  leadConversions,
  leadActivities,
} from "@shared/schema";
import { eq, and, gte, lte, sql, count, avg } from "drizzle-orm";

export type CohortSegment =
  | "source"
  | "state"
  | "county"
  | "campaign"
  | "import_month"
  | "import_quarter";

export interface CohortRow {
  segment: string;
  totalLeads: number;
  contacted: number;
  offerSent: number;
  underContract: number;
  closed: number;
  contactedRate: number;
  offerRate: number;
  closedRate: number;
  avgDaysToClose: number | null;
  avgOfferToListRatio: number | null; // offer / estimated value
}

export interface CohortReport {
  segmentBy: CohortSegment;
  cohorts: CohortRow[];
  totalLeads: number;
  overallClosedRate: number;
  generatedAt: string;
}

function quarterLabel(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `Q${q} ${date.getFullYear()}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

export async function buildCohortReport(
  orgId: number,
  segmentBy: CohortSegment,
  fromDate?: Date,
  toDate?: Date
): Promise<CohortReport> {
  const whereDate =
    fromDate && toDate
      ? and(
          eq(leads.organizationId, orgId),
          gte(leads.createdAt, fromDate),
          lte(leads.createdAt, toDate)
        )
      : eq(leads.organizationId, orgId);

  const allLeads = await db
    .select({
      id: leads.id,
      status: leads.status,
      source: leads.source,
      state: leads.state,
      county: leads.county,
      createdAt: leads.createdAt,
      campaignId: leads.campaignId,
    })
    .from(leads)
    .where(whereDate);

  // Fetch deals for these leads to get close data
  const leadIds = allLeads.map(l => l.id);

  const allDeals = leadIds.length
    ? await db
        .select({
          leadId: deals.leadId,
          status: deals.status,
          purchasePrice: deals.purchasePrice,
          closedAt: deals.closedAt,
          createdAt: deals.createdAt,
        })
        .from(deals)
        .where(
          and(
            eq(deals.organizationId, orgId),
            sql`${deals.leadId} = ANY(${sql`ARRAY[${sql.join(leadIds.map(id => sql`${id}`), sql`, `)}]::int[]`})`
          )
        )
    : [];

  const dealByLead = new Map<number, typeof allDeals[0]>();
  for (const d of allDeals) {
    if (d.leadId) dealByLead.set(d.leadId, d);
  }

  // Fetch campaign names
  const campaignList = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.organizationId, orgId));
  const campaignMap = new Map(campaignList.map(c => [c.id, c.name]));

  // Segment leads
  const cohortMap = new Map<string, typeof allLeads>();

  for (const lead of allLeads) {
    let key: string;
    switch (segmentBy) {
      case "source":
        key = lead.source || "Unknown";
        break;
      case "state":
        key = lead.state || "Unknown";
        break;
      case "county":
        key = lead.county ? `${lead.county}, ${lead.state || ""}` : "Unknown";
        break;
      case "campaign":
        key = lead.campaignId ? (campaignMap.get(lead.campaignId) ?? `Campaign #${lead.campaignId}`) : "No Campaign";
        break;
      case "import_month":
        key = lead.createdAt ? monthLabel(new Date(lead.createdAt)) : "Unknown";
        break;
      case "import_quarter":
        key = lead.createdAt ? quarterLabel(new Date(lead.createdAt)) : "Unknown";
        break;
      default:
        key = "All";
    }

    if (!cohortMap.has(key)) cohortMap.set(key, []);
    cohortMap.get(key)!.push(lead);
  }

  const cohorts: CohortRow[] = [];

  for (const [segment, segLeads] of cohortMap) {
    const total = segLeads.length;
    let contacted = 0;
    let offerSent = 0;
    let underContract = 0;
    let closed = 0;
    let totalDaysToClose = 0;
    let closedWithDays = 0;

    for (const lead of segLeads) {
      const status = lead.status || "new";
      if (["contacted", "offer_sent", "negotiating", "under_contract", "closed"].includes(status)) contacted++;
      if (["offer_sent", "negotiating", "under_contract", "closed"].includes(status)) offerSent++;
      if (["under_contract", "closed"].includes(status)) underContract++;

      const deal = dealByLead.get(lead.id);
      if (deal && (deal.status === "closed" || deal.status === "closing")) {
        closed++;
        if (deal.closedAt && lead.createdAt) {
          const days = (new Date(deal.closedAt).getTime() - new Date(lead.createdAt).getTime()) / 86400000;
          if (days > 0) {
            totalDaysToClose += days;
            closedWithDays++;
          }
        }
      }
    }

    cohorts.push({
      segment,
      totalLeads: total,
      contacted,
      offerSent,
      underContract,
      closed,
      contactedRate: total > 0 ? contacted / total : 0,
      offerRate: total > 0 ? offerSent / total : 0,
      closedRate: total > 0 ? closed / total : 0,
      avgDaysToClose: closedWithDays > 0 ? Math.round(totalDaysToClose / closedWithDays) : null,
      avgOfferToListRatio: null, // computed when AVM data is present
    });
  }

  // Sort by totalLeads descending
  cohorts.sort((a, b) => b.totalLeads - a.totalLeads);

  const totalClosed = cohorts.reduce((s, c) => s + c.closed, 0);
  const totalAll = allLeads.length;

  return {
    segmentBy,
    cohorts,
    totalLeads: totalAll,
    overallClosedRate: totalAll > 0 ? totalClosed / totalAll : 0,
    generatedAt: new Date().toISOString(),
  };
}
