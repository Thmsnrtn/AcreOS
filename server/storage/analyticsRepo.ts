// Analytics + reporting data layer: executive metrics, revenue / lead /
// deal / campaign metric rollups, deal velocity, pipeline value, and
// conversion rates. Extracted from the god-class server/storage.ts in the
// storage refactor. Methods are merged into DatabaseStorage.prototype at
// construction time; `this` refers to the full DatabaseStorage instance
// (the cross-repo self-call this.getActiveNotesValue resolves against the
// composed prototype — it lives in noteRepo).

import { and, count, eq, gte, inArray, lt, lte, or, sql, sum } from "drizzle-orm";
import { ACTIVE_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
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
    // `: 0` was here. A customer with no revenue in the prior window is not a
    // customer whose revenue held flat — the KPI card renders `change >= 0` as
    // a green up-arrow and a '+' prefix, so a zero read as "+0.0% from last
    // period" on a period nobody measured. `undefined` is the honest answer and
    // KPICard already omits the row for it.
    const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : undefined;
    
    const currentNotesValue = await this.getActiveNotesValue(orgId);
    
    const currentDeals = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        // Canonical, not spelled again. The four literals that used to be
        // here — 'negotiation', 'pending', 'due_diligence', 'under_contract' —
        // are NONE of them members of DEAL_STATUSES, and 'negotiation' is a
        // typo for the schema default 'negotiating'. routes.ts validates every
        // write against DEAL_STATUSES, so this card read 0 for every
        // organization, forever (2026-09-04).
        inArray(deals.status, ACTIVE_DEAL_STATUSES)
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

    // The prior window's conversion rate, measured exactly the way the current
    // one is (leads created in the window as the denominator, leads reaching
    // 'closed' during it as the numerator) so the delta compares like with
    // like. `conversionChange: 0` used to sit here as a literal.
    const prevTotalLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        gte(leads.createdAt, prevStartDate),
        lt(leads.createdAt, startDate),
      ));
    const prevTotalLeads = Number(prevTotalLeadsResult[0]?.count || 0);
    const prevConvertedResult = await db.select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.status, 'closed'),
        gte(leads.updatedAt, prevStartDate),
        lt(leads.updatedAt, startDate),
      ));
    const prevConverted = Number(prevConvertedResult[0]?.count || 0);
    const prevConversionRate = prevTotalLeads > 0 ? (prevConverted / prevTotalLeads) * 100 : undefined;
    const conversionChange =
      prevConversionRate !== undefined && prevConversionRate > 0
        ? ((leadConversionRate - prevConversionRate) / prevConversionRate) * 100
        : undefined;

    const round1 = (n: number | undefined) => (n === undefined ? undefined : Number(n.toFixed(1)));

    return {
      totalRevenue,
      revenueChange: round1(revenueChange),
      activeNotesValue: currentNotesValue,
      // NOT MEASURED, and now says so instead of saying zero.
      //
      // `notesValueChange: 0` and `dealsChange: 0` were hardcoded literals, and
      // KPICard renders any defined `change` as a trend row where `change >= 0`
      // selects the positive colour, a TrendingUp icon and a '+' prefix. Active
      // Notes Value and Deals in Pipeline therefore painted a green
      // "+0.0% from last period" on every load, for every customer, forever —
      // and handleExportReport pushed both into the customer's CSV as
      // measurements (2026-09-04 review; the no-fabrication hard-stop).
      //
      // Both are POINT-IN-TIME quantities: getActiveNotesValue sums the notes
      // that are active NOW, and dealsInPipeline counts the deals in an active
      // status NOW. Neither has a historical snapshot to compare against, so
      // there is no honest delta to compute here — only one to invent. They are
      // omitted, which KPICard and the CSV both already handle, until something
      // stores the history that would make them real.
      notesValueChange: undefined as number | undefined,
      dealsInPipeline,
      dealsChange: undefined as number | undefined,
      leadConversionRate: Number(leadConversionRate.toFixed(1)),
      conversionChange: round1(conversionChange),
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
      // `projectedRevenue: totalRevenue * 1.1` was here and is deleted. A flat
      // 10% growth multiplier is not a projection — it is an assumption wearing
      // one, and it was exported to the customer's CSV as "Projected revenue".
      // The standard already exists 200 lines below in this same file:
      // getConversionRates returns honest-empty with the comment "are NOT
      // tracked, so we return honest-empty rather than fabricating".
      // The client's ProjectedMRRCard derives its own figure from the observed
      // revenueOverTime series, which is a defensible method; this field was
      // reachable only through the export, and a fabricated number in a
      // downloadable report is still fabricated.
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
        // 'dead' is a LEAD status (pipeline-status.ts LEAD_STATUSES), never a
        // deal one, so it matched nothing and the win-rate denominator was
        // short by every cancelled-but-not-'dead' deal. 'cancelled' is the
        // deal vocabulary's only loss terminal.
        eq(deals.status, 'cancelled')
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
        // Same canonical list as getExecutiveMetrics — the pipeline-value
        // chart repeated the identical four non-canonical literals and was
        // structurally empty for the same reason.
        inArray(deals.status, ACTIVE_DEAL_STATUSES)
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
      .where(and(eq(deals.organizationId, orgId), eq(deals.status, 'cancelled')));

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
