// Analytics + reporting data layer: executive metrics, revenue / lead /
// deal / campaign metric rollups, deal velocity, pipeline value, and
// conversion rates. Extracted from the god-class server/storage.ts in the
// storage refactor. Methods are merged into DatabaseStorage.prototype at
// construction time; `this` refers to the full DatabaseStorage instance
// (the cross-repo self-call this.getActiveNotesValue resolves against the
// composed prototype — it lives in noteRepo).

import { and, count, eq, gte, lte, or, sql, sum } from "drizzle-orm";
import { db } from "../db";
import {
  campaigns,
  deals,
  leads,
  payments,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const analyticsRepo = {
  // Analytics & Reporting
  async getExecutiveMetrics(this: DatabaseStorage, orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const { startDate, endDate } = dateRange;
    const prevStartDate = new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()));
    
    const currentPayments = await db.select({ total: sum(payments.amount) })
      .from(payments)
      .where(and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, startDate),
        lte(payments.paymentDate, endDate)
      ));
    const totalRevenue = Number(currentPayments[0]?.total || 0);
    
    const prevPayments = await db.select({ total: sum(payments.amount) })
      .from(payments)
      .where(and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, prevStartDate),
        lte(payments.paymentDate, startDate)
      ));
    const prevRevenue = Number(prevPayments[0]?.total || 0);
    const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;
    
    const currentNotesValue = await this.getActiveNotesValue(orgId);
    
    const currentDeals = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        or(eq(deals.status, 'negotiation'), eq(deals.status, 'pending'), eq(deals.status, 'due_diligence'), eq(deals.status, 'under_contract'))
      ));
    const dealsInPipeline = Number(currentDeals[0]?.count || 0);
    
    const totalLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), gte(leads.createdAt, startDate)));
    const totalLeads = Number(totalLeadsResult[0]?.count || 0);
    
    const convertedLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.status, 'closed'),
        gte(leads.updatedAt, startDate)
      ));
    const convertedLeads = Number(convertedLeadsResult[0]?.count || 0);
    const leadConversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;
    
    return {
      totalRevenue,
      revenueChange: Number(revenueChange.toFixed(1)),
      activeNotesValue: currentNotesValue,
      notesValueChange: 0,
      dealsInPipeline,
      dealsChange: 0,
      leadConversionRate: Number(leadConversionRate.toFixed(1)),
      conversionChange: 0,
    };
  },

  async getRevenueMetrics(this: DatabaseStorage, orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const { startDate, endDate } = dateRange;
    
    const paymentResults = await db.select({
      date: sql<string>`DATE(${payments.paymentDate})`,
      revenue: sum(payments.amount),
    })
      .from(payments)
      .where(and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, startDate),
        lte(payments.paymentDate, endDate)
      ))
      .groupBy(sql`DATE(${payments.paymentDate})`)
      .orderBy(sql`DATE(${payments.paymentDate})`);
    
    const revenueOverTime = paymentResults.map(r => ({
      date: r.date,
      revenue: Number(r.revenue || 0),
    }));
    
    const totalRevenue = revenueOverTime.reduce((sum, r) => sum + r.revenue, 0);
    
    const dealCount = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        eq(deals.status, 'closed'),
        gte(deals.closingDate, startDate)
      ));
    const avgDealSize = Number(dealCount[0]?.count || 0) > 0 
      ? totalRevenue / Number(dealCount[0].count) 
      : 0;
    
    return {
      revenueOverTime,
      totalRevenue,
      avgDealSize: Number(avgDealSize.toFixed(2)),
      projectedRevenue: totalRevenue * 1.1,
    };
  },

  async getLeadMetrics(this: DatabaseStorage, orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const { startDate, endDate } = dateRange;
    
    const allLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(eq(leads.organizationId, orgId));
    const totalLeads = Number(allLeadsResult[0]?.count || 0);
    
    const newLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        gte(leads.createdAt, startDate),
        lte(leads.createdAt, endDate)
      ));
    const newLeads = Number(newLeadsResult[0]?.count || 0);
    
    const convertedResult = await db.select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.status, 'closed')
      ));
    const convertedLeads = Number(convertedResult[0]?.count || 0);
    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;
    
    const sourceResults = await db.select({
      source: leads.source,
      count: count(),
    })
      .from(leads)
      .where(eq(leads.organizationId, orgId))
      .groupBy(leads.source);
    
    const leadsBySource = sourceResults.map(r => ({
      source: r.source || 'Unknown',
      count: Number(r.count),
    }));
    
    const statusResults = await db.select({
      status: leads.status,
      count: count(),
    })
      .from(leads)
      .where(eq(leads.organizationId, orgId))
      .groupBy(leads.status);
    
    const leadsByStatus = statusResults.map(r => ({
      status: r.status,
      count: Number(r.count),
    }));
    
    return {
      totalLeads,
      newLeads,
      convertedLeads,
      conversionRate: Number(conversionRate.toFixed(1)),
      leadsBySource,
      leadsByStatus,
    };
  },

  async getDealMetrics(this: DatabaseStorage, orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const allDealsResult = await db.select({ count: count() })
      .from(deals)
      .where(eq(deals.organizationId, orgId));
    const totalDeals = Number(allDealsResult[0]?.count || 0);
    
    const wonDealsResult = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        eq(deals.status, 'closed')
      ));
    const wonDeals = Number(wonDealsResult[0]?.count || 0);
    
    const lostDealsResult = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        or(eq(deals.status, 'dead'), eq(deals.status, 'cancelled'))
      ));
    const lostDeals = Number(lostDealsResult[0]?.count || 0);
    
    const winRate = (wonDeals + lostDeals) > 0 ? (wonDeals / (wonDeals + lostDeals)) * 100 : 0;
    
    const stageResults = await db.select({
      stage: deals.status,
      count: count(),
      value: sum(deals.acceptedAmount),
    })
      .from(deals)
      .where(eq(deals.organizationId, orgId))
      .groupBy(deals.status);
    
    const dealsByStage = stageResults.map(r => ({
      stage: r.stage,
      count: Number(r.count),
      value: Number(r.value || 0),
    }));
    
    const totalValue = dealsByStage.reduce((sum, s) => sum + s.value, 0);
    const avgDealValue = totalDeals > 0 ? totalValue / totalDeals : 0;
    
    return {
      totalDeals,
      wonDeals,
      lostDeals,
      winRate: Number(winRate.toFixed(1)),
      dealsByStage,
      avgDealValue: Number(avgDealValue.toFixed(2)),
    };
  },

  async getCampaignMetrics(this: DatabaseStorage, orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const allCampaigns = await db.select()
      .from(campaigns)
      .where(eq(campaigns.organizationId, orgId));
    
    const campaignData = allCampaigns.map(c => ({
      id: c.id,
      name: c.name,
      sent: c.totalSent || 0,
      responses: c.totalResponded || 0,
      responseRate: (c.totalSent && c.totalSent > 0)
        ? Number((((c.totalResponded || 0) / c.totalSent) * 100).toFixed(1))
        : 0,
      roi: 0,
    }));
    
    const totalSent = campaignData.reduce((sum, c) => sum + c.sent, 0);
    const totalResponses = campaignData.reduce((sum, c) => sum + c.responses, 0);
    const avgResponseRate = totalSent > 0 ? (totalResponses / totalSent) * 100 : 0;
    
    return {
      campaigns: campaignData,
      totalSent,
      totalResponses,
      avgResponseRate: Number(avgResponseRate.toFixed(1)),
    };
  },

  async getDealVelocity(this: DatabaseStorage, orgId: number, _dateRange: { startDate: Date; endDate: Date }) {
    // Truth-immutable: report only what the data supports. We have
    // created_at and closing_date on closed deals, so the total
    // create→close cycle time is real. Per-stage durations are NOT
    // tracked (no stage-history table), so we return an empty per-stage
    // breakdown and no fabricated bottleneck rather than random numbers.
    const closedDeals = await db.select({
      createdAt: deals.createdAt,
      closingDate: deals.closingDate,
    })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        eq(deals.status, 'closed')
      ));

    const cycleDays = closedDeals
      .map((d) => {
        if (!d.createdAt || !d.closingDate) return null;
        const ms = new Date(d.closingDate).getTime() - new Date(d.createdAt).getTime();
        return ms >= 0 ? ms / 86_400_000 : null;
      })
      .filter((v): v is number => v !== null);

    const avgTotalDays = cycleDays.length > 0
      ? Math.round(cycleDays.reduce((sum, v) => sum + v, 0) / cycleDays.length)
      : 0;

    return {
      // Per-stage durations are not yet tracked — honest empty, not random.
      avgDaysPerStage: [] as { stage: string; avgDays: number }[],
      avgTotalDays,
      bottleneckStage: null as string | null,
      // Sample size so the client can show "not enough history yet".
      sampleSize: cycleDays.length,
    };
  },

  async getPipelineValue(this: DatabaseStorage, orgId: number) {
    const stageResults = await db.select({
      stage: deals.status,
      value: sum(deals.acceptedAmount),
      count: count(),
    })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        or(
          eq(deals.status, 'negotiation'),
          eq(deals.status, 'pending'),
          eq(deals.status, 'due_diligence'),
          eq(deals.status, 'under_contract')
        )
      ))
      .groupBy(deals.status);
    
    const stageValues = stageResults.map(r => ({
      stage: r.stage,
      value: Number(r.value || 0),
      count: Number(r.count),
    }));
    
    const totalValue = stageValues.reduce((sum, s) => sum + s.value, 0);
    
    return {
      stageValues,
      totalValue,
    };
  },

  async getConversionRates(this: DatabaseStorage, orgId: number, _dateRange: { startDate: Date; endDate: Date }) {
    // Truth-immutable: the overall win rate is computable from real
    // won/lost counts. Per-stage conversion rates and categorized loss
    // reasons are NOT tracked, so we return honest-empty for those rather
    // than fabricating per-stage rates or invented loss-reason tallies.
    const wonDeals = await db.select({ count: count() })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), eq(deals.status, 'closed')));
    const lostDeals = await db.select({ count: count() })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), or(eq(deals.status, 'dead'), eq(deals.status, 'cancelled'))));

    const won = Number(wonDeals[0]?.count || 0);
    const lost = Number(lostDeals[0]?.count || 0);
    const overallWinRate = (won + lost) > 0 ? (won / (won + lost)) * 100 : 0;

    return {
      // Per-stage conversion requires a stage-history table we don't have.
      stageConversions: [] as { fromStage: string; toStage: string; rate: number }[],
      overallWinRate: Number(overallWinRate.toFixed(1)),
      // Loss reasons are not captured as structured data — honest empty.
      lossReasons: [] as { reason: string; count: number }[],
      sampleSize: won + lost,
    };
  },
};

export type AnalyticsRepo = typeof analyticsRepo;
