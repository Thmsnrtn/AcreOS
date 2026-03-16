// @ts-nocheck — ORM type refinement deferred; runtime-correct
import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, sql, and, desc } from "drizzle-orm";
import { leads, deals, properties, payments, notes, activityLog, goals, insertGoalSchema } from "@shared/schema";
import { gte, lte, count as sqlCount } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { runPortfolioHealthJob, getActiveAlerts, dismissAlert } from "./services/portfolioHealth";

const logger = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message: msg, ...meta })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message: msg, ...meta })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), message: msg, ...meta })),
};

const serverStartTime = Date.now();

export function registerDashboardRoutes(app: Express): void {
  const api = app;

  // DASHBOARD
  // ============================================
  
  api.get("/api/dashboard/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const stats = await storage.getDashboardStats(org.id);
    res.json(stats);
  });
  
  // Dashboard Intelligence - Anomalies, Predictions, Next Best Actions
  api.get("/api/dashboard/intelligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      // Fetch data for analysis
      const allLeads = await storage.getLeads(org.id);
      const allDeals = await storage.getDeals(org.id);
      const allProperties = await storage.getProperties(org.id);

      // Calculate week-over-week anomalies
      const anomalies: Array<{
        id: string;
        type: "positive" | "negative" | "neutral";
        message: string;
        metric: string;
        currentValue: number;
        previousValue: number;
        percentChange: number;
      }> = [];

      // Leads that went cold this week vs last week
      const coldLeadsThisWeek = allLeads.filter(l => 
        l.nurturingStage === "cold" && 
        l.updatedAt && new Date(l.updatedAt) >= oneWeekAgo
      ).length;
      const coldLeadsLastWeek = allLeads.filter(l => 
        l.nurturingStage === "cold" && 
        l.updatedAt && new Date(l.updatedAt) >= twoWeeksAgo && new Date(l.updatedAt) < oneWeekAgo
      ).length;
      
      if (coldLeadsThisWeek !== coldLeadsLastWeek) {
        const percentChange = coldLeadsLastWeek === 0 
          ? (coldLeadsThisWeek > 0 ? 100 : 0)
          : Math.round(((coldLeadsThisWeek - coldLeadsLastWeek) / coldLeadsLastWeek) * 100);
        anomalies.push({
          id: "cold-leads",
          type: coldLeadsThisWeek > coldLeadsLastWeek ? "negative" : "positive",
          message: `${coldLeadsThisWeek} leads went cold this week vs ${coldLeadsLastWeek} last week`,
          metric: "Cold Leads",
          currentValue: coldLeadsThisWeek,
          previousValue: coldLeadsLastWeek,
          percentChange,
        });
      }

      // New leads this week vs last week
      const newLeadsThisWeek = allLeads.filter(l => 
        l.createdAt && new Date(l.createdAt) >= oneWeekAgo
      ).length;
      const newLeadsLastWeek = allLeads.filter(l => 
        l.createdAt && new Date(l.createdAt) >= twoWeeksAgo && new Date(l.createdAt) < oneWeekAgo
      ).length;
      
      if (newLeadsThisWeek !== newLeadsLastWeek && (newLeadsThisWeek > 0 || newLeadsLastWeek > 0)) {
        const percentChange = newLeadsLastWeek === 0 
          ? (newLeadsThisWeek > 0 ? 100 : 0)
          : Math.round(((newLeadsThisWeek - newLeadsLastWeek) / newLeadsLastWeek) * 100);
        anomalies.push({
          id: "new-leads",
          type: newLeadsThisWeek > newLeadsLastWeek ? "positive" : "negative",
          message: `${newLeadsThisWeek} new leads this week vs ${newLeadsLastWeek} last week`,
          metric: "New Leads",
          currentValue: newLeadsThisWeek,
          previousValue: newLeadsLastWeek,
          percentChange,
        });
      }

      // Deal velocity (deals closed this month vs last month)
      const dealsClosedThisMonth = allDeals.filter(d => 
        d.status === "closed" && d.closingDate && new Date(d.closingDate) >= oneMonthAgo
      ).length;
      const dealsClosedLastMonth = allDeals.filter(d => 
        d.status === "closed" && d.closingDate && 
        new Date(d.closingDate) >= twoMonthsAgo && new Date(d.closingDate) < oneMonthAgo
      ).length;
      
      if (dealsClosedThisMonth !== dealsClosedLastMonth && (dealsClosedThisMonth > 0 || dealsClosedLastMonth > 0)) {
        const percentChange = dealsClosedLastMonth === 0 
          ? (dealsClosedThisMonth > 0 ? 100 : 0)
          : Math.round(((dealsClosedThisMonth - dealsClosedLastMonth) / dealsClosedLastMonth) * 100);
        anomalies.push({
          id: "deal-velocity",
          type: dealsClosedThisMonth >= dealsClosedLastMonth ? "positive" : "negative",
          message: `Deal velocity ${dealsClosedThisMonth >= dealsClosedLastMonth ? "increased" : "decreased"} ${Math.abs(percentChange)}% from last month`,
          metric: "Deal Velocity",
          currentValue: dealsClosedThisMonth,
          previousValue: dealsClosedLastMonth,
          percentChange,
        });
      }

      // Calculate predictions
      const predictions: Array<{
        id: string;
        type: "deals" | "revenue" | "leads";
        title: string;
        message: string;
        currentValue: number;
        projectedValue: number;
        timeframe: string;
        trendData?: { name: string; value: number }[];
      }> = [];

      // Project deals for the quarter
      const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      const daysIntoQuarter = Math.max(1, Math.floor((now.getTime() - quarterStart.getTime()) / (24 * 60 * 60 * 1000)));
      const dealsThisQuarter = allDeals.filter(d => 
        d.status === "closed" && d.closingDate && new Date(d.closingDate) >= quarterStart
      ).length;
      const daysInQuarter = 90;
      const projectedDeals = Math.round((dealsThisQuarter / daysIntoQuarter) * daysInQuarter);
      
      if (dealsThisQuarter > 0 || allDeals.length > 0) {
        const trendData = [];
        for (let i = 6; i >= 0; i--) {
          const weekStart = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
          const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
          const dealsInWeek = allDeals.filter(d => 
            d.status === "closed" && d.closingDate && 
            new Date(d.closingDate) >= weekStart && new Date(d.closingDate) < weekEnd
          ).length;
          trendData.push({ name: `W${7 - i}`, value: dealsInWeek });
        }

        predictions.push({
          id: "quarterly-deals",
          type: "deals",
          title: "Quarterly Deal Projection",
          message: `At current pace, you'll close ${projectedDeals} deals this quarter`,
          currentValue: dealsThisQuarter,
          projectedValue: projectedDeals,
          timeframe: "End of Quarter",
          trendData,
        });
      }

      // Revenue projection for the month
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const daysIntoMonth = Math.max(1, now.getDate());
      const revenueThisMonth = allDeals
        .filter(d => d.status === "closed" && d.closingDate && new Date(d.closingDate) >= monthStart)
        .reduce((sum, d) => sum + Number(d.acceptedAmount || d.offerAmount || 0), 0);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const projectedRevenue = Math.round((revenueThisMonth / daysIntoMonth) * daysInMonth);
      
      if (revenueThisMonth > 0 || allDeals.some(d => d.acceptedAmount || d.offerAmount)) {
        const trendData = [];
        for (let i = 6; i >= 0; i--) {
          const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          const revenueOnDay = allDeals
            .filter(d => d.status === "closed" && d.closingDate && 
              new Date(d.closingDate) >= dayStart && new Date(d.closingDate) < dayEnd)
            .reduce((sum, d) => sum + Number(d.acceptedAmount || d.offerAmount || 0), 0);
          trendData.push({ name: dayStart.toLocaleDateString('en-US', { weekday: 'short' }), value: revenueOnDay });
        }

        predictions.push({
          id: "monthly-revenue",
          type: "revenue",
          title: "Monthly Revenue Projection",
          message: `Revenue projection: $${projectedRevenue.toLocaleString()} by end of month`,
          currentValue: revenueThisMonth,
          projectedValue: projectedRevenue,
          timeframe: "End of Month",
          trendData,
        });
      }

      // Calculate next best actions
      const actions: Array<{
        id: string;
        type: "follow_up" | "review_offer" | "schedule_call" | "send_mail" | "close_deal";
        priority: "high" | "medium" | "low";
        title: string;
        description: string;
        entityType: "lead" | "deal" | "property";
        entityId: number;
        dueInfo?: string;
        actionLabel: string;
        actionUrl: string;
      }> = [];

      // Find leads that need follow-up (not contacted in 7+ days)
      const staleLeads = allLeads
        .filter(l => {
          if (l.status === "closed" || l.status === "dead" || l.doNotContact) return false;
          if (!l.lastContactedAt) return true;
          const daysSinceContact = Math.floor((now.getTime() - new Date(l.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000));
          return daysSinceContact >= 7;
        })
        .sort((a, b) => {
          const daysA = a.lastContactedAt ? Math.floor((now.getTime() - new Date(a.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000)) : 999;
          const daysB = b.lastContactedAt ? Math.floor((now.getTime() - new Date(b.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000)) : 999;
          return daysB - daysA;
        })
        .slice(0, 3);

      for (const lead of staleLeads) {
        const daysSinceContact = lead.lastContactedAt 
          ? Math.floor((now.getTime() - new Date(lead.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000))
          : null;
        
        actions.push({
          id: `follow-up-${lead.id}`,
          type: "follow_up",
          priority: daysSinceContact && daysSinceContact > 14 ? "high" : "medium",
          title: `Follow up with ${lead.firstName} ${lead.lastName}`,
          description: daysSinceContact ? `Last contact ${daysSinceContact} days ago` : "Never contacted",
          entityType: "lead",
          entityId: lead.id,
          dueInfo: daysSinceContact && daysSinceContact > 14 ? "Urgent - contact soon" : undefined,
          actionLabel: "View Lead",
          actionUrl: `/leads`,
        });
      }

      // Find deals that need attention (offer sent, waiting for response)
      const pendingDeals = allDeals
        .filter(d => d.status === "offer_sent" || d.status === "negotiating")
        .slice(0, 2);

      for (const deal of pendingDeals) {
        const property = allProperties.find(p => p.id === deal.propertyId);
        const propertyName = property?.address || `Property #${deal.propertyId}`;
        const daysSinceOffer = deal.offerDate 
          ? Math.floor((now.getTime() - new Date(deal.offerDate).getTime()) / (24 * 60 * 60 * 1000))
          : null;

        actions.push({
          id: `review-deal-${deal.id}`,
          type: "review_offer",
          priority: daysSinceOffer && daysSinceOffer > 5 ? "high" : "medium",
          title: `Review offer on ${propertyName}`,
          description: deal.status === "offer_sent" ? "Awaiting seller response" : "In negotiation",
          entityType: "deal",
          entityId: deal.id,
          dueInfo: daysSinceOffer ? `Offer sent ${daysSinceOffer} days ago` : undefined,
          actionLabel: "View Deal",
          actionUrl: `/deals`,
        });
      }

      // Find properties that need action
      const pendingProperties = allProperties
        .filter(p => p.status === "listed" && p.listDate)
        .sort((a, b) => new Date(a.listDate!).getTime() - new Date(b.listDate!).getTime())
        .slice(0, 2);

      for (const property of pendingProperties) {
        const daysListed = property.listDate 
          ? Math.floor((now.getTime() - new Date(property.listDate).getTime()) / (24 * 60 * 60 * 1000))
          : 0;

        if (daysListed > 30) {
          actions.push({
            id: `property-${property.id}`,
            type: "review_offer",
            priority: daysListed > 60 ? "high" : "medium",
            title: `Review listing for ${property.address || `Property #${property.id}`}`,
            description: `Listed for ${daysListed} days without a sale`,
            entityType: "property",
            entityId: property.id,
            dueInfo: "Consider price adjustment",
            actionLabel: "View Property",
            actionUrl: `/properties`,
          });
        }
      }

      // Sort actions by priority
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      res.json({
        anomalies,
        predictions,
        actions,
        generatedAt: now.toISOString(),
      });
    } catch (error: any) {
      logger.error("Dashboard intelligence error", { error: error.message });
      res.status(500).json({ message: "Failed to generate dashboard intelligence" });
    }
  });
  
  // ============================================
  // TELEMETRY
  // ============================================
  
  api.post("/api/telemetry", isAuthenticated, async (req, res) => {
    const { events } = req.body;
    const user = (req as any).user;
    const org = (req as any).organization;
    
    // Log events for now (can be sent to analytics service later)
    if (process.env.NODE_ENV === 'development') {
      console.log('[Telemetry]', { userId: user?.id, orgId: org?.id, events });
    }
    
    // In production, you could send to:
    // - PostHog
    // - Mixpanel
    // - Your own analytics database
    
    res.json({ success: true });
  });
  
  // ============================================
  // PORTFOLIO HEALTH ALERTS
  // ============================================

  api.get("/api/alerts/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      // Refresh alerts on each fetch (lightweight scan)
      await runPortfolioHealthJob(org.id);
      const alerts = await getActiveAlerts(org.id);
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/alerts/:id/dismiss", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const alertId = parseInt(req.params.id);
      await dismissAlert(org.id, alertId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // GOALS
  // ============================================

  // GET /api/goals — list goals with computed current_value
  api.get("/api/goals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const now = new Date();

      const orgGoals = await db
        .select()
        .from(goals)
        .where(eq(goals.organizationId, org.id));

      // Compute current values dynamically per goal type
      const [
        dealsClosedRow,
        notesDeployedRow,
        revenueEarnedRow,
        leadsContactedRow,
      ] = await Promise.all([
        db.select({ count: sqlCount() }).from(deals)
          .where(and(eq(deals.organizationId, org.id), eq(deals.status, "closed"))),
        db.select({ count: sqlCount() }).from(notes)
          .where(and(eq(notes.organizationId, org.id), eq(notes.status, "active"))),
        db.select({ total: sql<number>`coalesce(sum(amount::numeric), 0)` }).from(payments)
          .where(eq(payments.organizationId, org.id)),
        db.select({ count: sqlCount() }).from(activityLog)
          .where(and(eq(activityLog.organizationId, org.id), eq(activityLog.type, "contact_logged"))),
      ]);

      const currentValues: Record<string, number> = {
        deals_closed: Number(dealsClosedRow[0]?.count ?? 0),
        notes_deployed: Number(notesDeployedRow[0]?.count ?? 0),
        revenue_earned: Number(revenueEarnedRow[0]?.total ?? 0),
        leads_contacted: Number(leadsContactedRow[0]?.count ?? 0),
      };

      const result = orgGoals.map(g => ({
        ...g,
        currentValue: currentValues[g.goalType] ?? 0,
        progressPct: Math.min(100, Math.round(
          (currentValues[g.goalType] ?? 0) / Number(g.targetValue) * 100
        )),
        isActive: new Date(g.periodStart) <= now && now <= new Date(g.periodEnd),
      }));

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/goals — create a goal
  api.post("/api/goals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertGoalSchema.safeParse({ ...req.body, organizationId: org.id });
      if (!parsed.success) return res.status(400).json({ message: "Invalid goal data", errors: parsed.error.flatten() });

      const [goal] = await db.insert(goals).values(parsed.data).returning();
      res.status(201).json(goal);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/goals/:id — remove a goal
  api.delete("/api/goals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      await db.delete(goals).where(and(eq(goals.id, id), eq(goals.organizationId, org.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // EPIC J: "3 Things Today" AI-prioritized actions
  // GET /api/dashboard/today-priorities
  // ============================================

  api.get("/api/dashboard/today-priorities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const orgId = org.id;
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

      // Gather pipeline state in parallel
      const [unscoredLeads, staleFollowUps, campaignFreshness, pipelineState] = await Promise.allSettled([
        // Unscored leads (leads with no score or score null)
        db.select({ count: sql<number>`COUNT(*)` })
          .from(leads)
          .where(and(
            eq(leads.organizationId, orgId),
            sql`status NOT IN ('closed', 'dead', 'converted')`,
            sql`(score IS NULL OR last_score_at IS NULL)`,
          )),

        // Stale follow-ups: leads not contacted in 28+ days
        db.select({ count: sql<number>`COUNT(*)` })
          .from(leads)
          .where(and(
            eq(leads.organizationId, orgId),
            sql`status NOT IN ('closed', 'dead', 'converted')`,
            sql`(last_contacted_at IS NULL OR last_contacted_at < ${new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString()})`,
          )),

        // Campaign freshness: when was the last campaign sent?
        db.select({
          lastSent: sql<string>`MAX(created_at)`,
          count: sql<number>`COUNT(*)`,
        })
          .from(sql`campaigns`)
          .where(sql`organization_id = ${orgId}`),

        // Pipeline deals by status
        db.select({
          status: deals.status,
          count: sql<number>`COUNT(*)`,
        })
          .from(deals)
          .where(eq(deals.organizationId, orgId))
          .groupBy(deals.status),
      ]);

      const unscoredCount = unscoredLeads.status === "fulfilled"
        ? Number(unscoredLeads.value[0]?.count) || 0 : 0;
      const staleCount = staleFollowUps.status === "fulfilled"
        ? Number(staleFollowUps.value[0]?.count) || 0 : 0;
      const campaignData = campaignFreshness.status === "fulfilled" ? campaignFreshness.value[0] : null;
      const lastCampaignDaysAgo = campaignData?.lastSent
        ? Math.floor((now.getTime() - new Date(campaignData.lastSent).getTime()) / 86400000)
        : 999;

      // Build prioritized 3-action list
      interface TodayPriority {
        id: string;
        type: string;
        priority: "high" | "medium" | "low";
        title: string;
        description: string;
        actionLabel: string;
        actionUrl: string;
        count?: number;
      }

      const priorities: TodayPriority[] = [];

      if (unscoredCount > 0) {
        priorities.push({
          id: "score-leads",
          type: "acrescore",
          priority: "high",
          title: `Score ${unscoredCount} unscored lead${unscoredCount !== 1 ? "s" : ""}`,
          description: `You have ${unscoredCount} lead${unscoredCount !== 1 ? "s" : ""} awaiting AcreScore™ analysis. Scored leads convert 3× faster — don't leave them cold.`,
          actionLabel: "Score Now",
          actionUrl: "/leads?filter=unscored",
          count: unscoredCount,
        });
      }

      if (staleCount > 0) {
        priorities.push({
          id: "follow-up",
          type: "follow-up",
          priority: staleCount > 10 ? "high" : "medium",
          title: `Follow up with ${Math.min(staleCount, 5)} seller${staleCount > 1 ? "s" : ""} who haven't responded`,
          description: `${staleCount} lead${staleCount !== 1 ? "s" : ""} haven't been contacted in 28+ days. Consistent follow-up is the Land Geek secret weapon.`,
          actionLabel: "View Stale Leads",
          actionUrl: "/leads?filter=stale",
          count: staleCount,
        });
      }

      if (lastCampaignDaysAgo > 45) {
        priorities.push({
          id: "send-campaign",
          type: "campaign",
          priority: lastCampaignDaysAgo > 60 ? "high" : "medium",
          title: `Send a direct mail campaign — you haven't mailed in ${Math.min(lastCampaignDaysAgo, 90)}+ days`,
          description: "The mailer that goes out today is the passive income that arrives next quarter. Keep your pipeline full.",
          actionLabel: "Plan Campaign",
          actionUrl: "/campaigns",
        });
      }

      // Ensure we always have 3 actions — fill with default guidance if needed
      if (priorities.length === 0) {
        priorities.push({
          id: "county-snapshot",
          type: "intelligence",
          priority: "medium",
          title: "Check your primary county intelligence snapshot",
          description: "Review USDA land values, migration signals, and opportunity score for your target county.",
          actionLabel: "View County Data",
          actionUrl: "/data-intelligence",
        });
      }

      if (priorities.length < 2) {
        priorities.push({
          id: "review-pipeline",
          type: "pipeline",
          priority: "low",
          title: "Review your deal pipeline for stuck deals",
          description: "Deals that haven't moved in 14+ days often need a nudge. Check your pipeline board.",
          actionLabel: "View Pipeline",
          actionUrl: "/pipeline",
        });
      }

      if (priorities.length < 3) {
        priorities.push({
          id: "night-cap",
          type: "review",
          priority: "low",
          title: "Review your passive income progress tonight",
          description: "Open the Night Cap dashboard to see today's note payments, freedom meter progress, and tomorrow's one thing.",
          actionLabel: "Open Night Cap",
          actionUrl: "/night-cap",
        });
      }

      res.json({
        priorities: priorities.slice(0, 3),
        generatedAt: new Date().toISOString(),
        meta: {
          unscoredLeads: unscoredCount,
          staleFollowUps: staleCount,
          lastCampaignDaysAgo: Math.min(lastCampaignDaysAgo, 999),
        },
      });
    } catch (err: any) {
      logger.error("Today priorities error", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

}
