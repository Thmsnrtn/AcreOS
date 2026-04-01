/**
 * T32 — Follow-Up Sequence Attribution + ROI Scoring
 *
 * Answers: "Which campaign, sequence, touch number, and channel actually
 * converted a lead?" Aggregates conversion data from leadConversions,
 * sellerCommunications, and campaigns tables.
 *
 * Exposed via GET /api/analytics/attribution
 */

import { db } from "../db";
import {
  leadConversions,
  campaigns,
  sellerCommunications,
  leads,
  deals,
} from "@shared/schema";
import { eq, and, gte, lte, sql, count, avg, sum } from "drizzle-orm";

export interface AttributionRow {
  campaignId: number | null;
  campaignName: string;
  channel: string; // "email" | "sms" | "mail" | "direct"
  touchNumber: number | null;
  conversions: number;
  totalLeads: number;
  conversionRate: number; // 0–1
  avgTouchesToConvert: number | null;
  totalRevenue: number; // sum of deal values
  totalCost: number; // estimated campaign cost
  roi: number; // (revenue - cost) / cost, null if cost = 0
  avgDaysToConvert: number | null;
}

export interface AttributionReport {
  dateRange: { from: string; to: string };
  byCampaign: AttributionRow[];
  byChannel: AttributionRow[];
  byTouchNumber: {
    touchNumber: number;
    conversions: number;
    pct: number;
  }[];
  summary: {
    totalConversions: number;
    totalRevenue: number;
    bestCampaign: string | null;
    bestChannel: string | null;
    avgTouchesToConvert: number | null;
  };
}

function costPerChannel(channel: string, count: number): number {
  // Rough industry estimates
  const costPer: Record<string, number> = {
    mail: 0.85,   // direct mail ~$0.85/piece
    email: 0.003, // email ~$0.003/send
    sms: 0.015,   // SMS ~$0.015/message
    direct: 0,    // manual outreach — no tracked cost
  };
  return (costPer[channel] ?? 0) * count;
}

export async function getAttributionReport(
  orgId: number,
  fromDate: Date,
  toDate: Date
): Promise<AttributionReport> {
  // Fetch conversions in range
  const conversions = await db
    .select({
      id: leadConversions.id,
      leadId: leadConversions.leadId,
      campaignId: leadConversions.campaignId,
      touchNumber: leadConversions.touchNumber,
      channel: leadConversions.channel,
      convertedAt: leadConversions.convertedAt,
    })
    .from(leadConversions)
    .where(
      and(
        eq(leadConversions.organizationId, orgId),
        gte(leadConversions.convertedAt, fromDate),
        lte(leadConversions.convertedAt, toDate)
      )
    );

  // Fetch associated deals for revenue
  const dealsByLead = await db
    .select({ leadId: deals.leadId, purchasePrice: deals.purchasePrice, status: deals.status })
    .from(deals)
    .where(eq(deals.organizationId, orgId));

  const revenueByLead = new Map<number, number>();
  for (const d of dealsByLead) {
    if (d.leadId && (d.status === "closed" || d.status === "closing")) {
      revenueByLead.set(d.leadId, (revenueByLead.get(d.leadId) ?? 0) + Number(d.purchasePrice ?? 0));
    }
  }

  // Fetch campaign metadata
  const campaignList = await db
    .select({ id: campaigns.id, name: campaigns.name, channel: campaigns.channel })
    .from(campaigns)
    .where(eq(campaigns.organizationId, orgId));

  const campaignMap = new Map(campaignList.map(c => [c.id, c]));

  // Aggregate by campaign
  const byCampaignMap = new Map<string, AttributionRow>();
  const byChannelMap = new Map<string, AttributionRow>();
  const byTouchMap = new Map<number, number>(); // touchNumber → count

  for (const conv of conversions) {
    const campaign = conv.campaignId ? campaignMap.get(conv.campaignId) : null;
    const campKey = String(conv.campaignId ?? "none");
    const channel = conv.channel || campaign?.channel || "direct";
    const revenue = revenueByLead.get(conv.leadId ?? 0) ?? 0;

    // By campaign
    if (!byCampaignMap.has(campKey)) {
      byCampaignMap.set(campKey, {
        campaignId: conv.campaignId ?? null,
        campaignName: campaign?.name ?? "Uncampaigned",
        channel,
        touchNumber: null,
        conversions: 0,
        totalLeads: 0,
        conversionRate: 0,
        avgTouchesToConvert: null,
        totalRevenue: 0,
        totalCost: 0,
        roi: 0,
        avgDaysToConvert: null,
      });
    }
    const campRow = byCampaignMap.get(campKey)!;
    campRow.conversions++;
    campRow.totalRevenue += revenue;

    // By channel
    if (!byChannelMap.has(channel)) {
      byChannelMap.set(channel, {
        campaignId: null,
        campaignName: "All",
        channel,
        touchNumber: null,
        conversions: 0,
        totalLeads: 0,
        conversionRate: 0,
        avgTouchesToConvert: null,
        totalRevenue: 0,
        totalCost: 0,
        roi: 0,
        avgDaysToConvert: null,
      });
    }
    byChannelMap.get(channel)!.conversions++;
    byChannelMap.get(channel)!.totalRevenue += revenue;

    // By touch number
    if (conv.touchNumber != null) {
      byTouchMap.set(conv.touchNumber, (byTouchMap.get(conv.touchNumber) ?? 0) + 1);
    }
  }

  // Compute costs + ROI
  for (const [, row] of byCampaignMap) {
    row.totalCost = costPerChannel(row.channel, row.conversions * 3); // assume 3 touches avg
    row.roi = row.totalCost > 0 ? (row.totalRevenue - row.totalCost) / row.totalCost : 0;
    row.conversionRate = conversions.length > 0 ? row.conversions / conversions.length : 0;
  }
  for (const [channel, row] of byChannelMap) {
    row.totalCost = costPerChannel(channel, row.conversions * 3);
    row.roi = row.totalCost > 0 ? (row.totalRevenue - row.totalCost) / row.totalCost : 0;
    row.conversionRate = conversions.length > 0 ? row.conversions / conversions.length : 0;
  }

  const totalConversions = conversions.length;
  const totalRevenue = [...byCampaignMap.values()].reduce((s, r) => s + r.totalRevenue, 0);

  const sortedCampaigns = [...byCampaignMap.values()].sort((a, b) => b.conversions - a.conversions);
  const sortedChannels = [...byChannelMap.values()].sort((a, b) => b.conversions - a.conversions);

  const byTouchNumber = [...byTouchMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([touchNumber, count]) => ({
      touchNumber,
      conversions: count,
      pct: totalConversions > 0 ? (count / totalConversions) * 100 : 0,
    }));

  const avgTouches =
    byTouchNumber.length > 0
      ? byTouchNumber.reduce((s, r) => s + r.touchNumber * r.conversions, 0) / totalConversions
      : null;

  return {
    dateRange: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    },
    byCampaign: sortedCampaigns,
    byChannel: sortedChannels,
    byTouchNumber,
    summary: {
      totalConversions,
      totalRevenue,
      bestCampaign: sortedCampaigns[0]?.campaignName ?? null,
      bestChannel: sortedChannels[0]?.channel ?? null,
      avgTouchesToConvert: avgTouches != null ? Math.round(avgTouches * 10) / 10 : null,
    },
  };
}
