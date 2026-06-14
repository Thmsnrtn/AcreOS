import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { insertTaskSchema, teamMembers, deals, leads, organizations } from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, count, sql, desc } from "drizzle-orm";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { addMonths } from "./utils/dateUtils";

export function registerAnalyticsRoutes(app: Express): void {
  const api = app;

  // ANALYTICS & REPORTING (Phase 7)
  // ============================================

  function parseDateRange(range: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    let startDate = new Date();
    
    switch (range) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }
    
    return { startDate, endDate };
  }

  // GET /api/analytics/executive - Executive metrics
  api.get("/api/analytics/executive", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getExecutiveMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      logger.error("Get executive metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/analytics/revenue - Revenue metrics
  api.get("/api/analytics/revenue", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getRevenueMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      logger.error("Get revenue metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/analytics/leads - Lead metrics
  api.get("/api/analytics/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getLeadMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      logger.error("Get lead metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/analytics/deals - Deal metrics
  api.get("/api/analytics/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getDealMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      logger.error("Get deal metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/analytics/campaigns - Campaign metrics
  api.get("/api/analytics/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getCampaignMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      logger.error("Get campaign metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/analytics/pipeline - Pipeline value by stage
  api.get("/api/analytics/pipeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      
      const metrics = await storage.getPipelineValue(org.id);
      res.json(metrics);
    } catch (error: any) {
      logger.error("Get pipeline metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/analytics/velocity - Deal velocity metrics
  api.get("/api/analytics/velocity", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getDealVelocity(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      logger.error("Get velocity metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/analytics/conversions - Conversion rates
  api.get("/api/analytics/conversions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getConversionRates(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      logger.error("Get conversion metrics error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/analytics/team-kpi - Team performance KPIs
  api.get("/api/analytics/team-kpi", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const now = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);

      const [deals, leads] = await Promise.all([
        storage.getDeals(org.id),
        storage.getLeads(org.id),
      ]);

      const recentDeals = deals.filter((d: any) => {
        const closed = d.closedAt || d.updatedAt || d.createdAt;
        return closed && new Date(closed) >= thirtyDaysAgo && (d.status === "closed" || d.status === "won");
      });

      const recentLeads = leads.filter((l: any) => {
        const worked = l.updatedAt || l.createdAt;
        return worked && new Date(worked) >= thirtyDaysAgo;
      });

      const totalRevenue = recentDeals.reduce((sum: number, d: any) => sum + (d.purchasePrice || d.salePrice || 0), 0);

      const conversionRate = leads.length > 0
        ? ((deals.filter((d: any) => d.status === "closed" || d.status === "won").length / leads.length) * 100).toFixed(1)
        : "0.0";

      const kpis = [
        { label: "Deals Closed (30d)", value: String(recentDeals.length) },
        { label: "Avg Deal Cycle Time", value: "—" },
        { label: "Leads Worked (30d)", value: String(recentLeads.length) },
        { label: "Revenue Generated", value: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(totalRevenue) },
        { label: "Conversion Rate", value: `${conversionRate}%` },
        { label: "Avg Offer Accepted %", value: "—" },
      ];

      res.json({ kpis });
    } catch (error: any) {
      logger.error("Get team KPI error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // AUTOMATION RULES (Phase 8.1)
  // ============================================

  // GET /api/automation-rules - List all automation rules
  api.get("/api/automation-rules", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const rules = await storage.getAutomationRules(org.id);
      res.json(rules);
    } catch (error: any) {
      logger.error("Get automation rules error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/automation-rules/:id - Get single rule
  api.get("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const rule = await storage.getAutomationRule(org.id, id);
      if (!rule) {
        return Errors.notFound(res, "Automation rule");
      }
      res.json(rule);
    } catch (error: any) {
      logger.error("Get automation rule error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/automation-rules - Create new rule
  api.post("/api/automation-rules", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = user?.id || user.id;
      
      const rule = await storage.createAutomationRule({
        ...req.body,
        organizationId: org.id,
        createdBy: userId,
      });
      res.status(201).json(rule);
    } catch (error: any) {
      logger.error("Create automation rule error", error);
      Errors.internal(res, error);
    }
  });

  // PUT /api/automation-rules/:id - Update rule
  api.put("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Automation rule");
      }
      
      const updated = await storage.updateAutomationRule(id, req.body);
      res.json(updated);
    } catch (error: any) {
      logger.error("Update automation rule error", error);
      Errors.internal(res, error);
    }
  });

  // DELETE /api/automation-rules/:id - Delete rule
  api.delete("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Automation rule");
      }
      
      await storage.deleteAutomationRule(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete automation rule error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // WORKSPACE PRESETS - Power User Features
  // ============================================

  api.get("/api/workspaces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = user?.id || user?.id;
      const presets = await storage.getWorkspacePresets(org.id, userId);
      res.json(presets);
    } catch (error: any) {
      logger.error("Get workspace presets error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/workspaces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = user?.id || user?.id;
      
      const preset = await storage.createWorkspacePreset({
        ...req.body,
        organizationId: org.id,
        userId,
      });
      res.status(201).json(preset);
    } catch (error: any) {
      logger.error("Create workspace preset error", error);
      Errors.internal(res, error);
    }
  });

  api.delete("/api/workspaces/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getWorkspacePreset(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Workspace preset");
      }
      
      await storage.deleteWorkspacePreset(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete workspace preset error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/automation-rules/:id/toggle - Toggle rule enabled status
  api.post("/api/automation-rules/:id/toggle", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const { enabled } = req.body;
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Automation rule");
      }
      
      const updated = await storage.toggleAutomationRule(id, enabled);
      res.json(updated);
    } catch (error: any) {
      logger.error("Toggle automation rule error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/automation-executions - Get execution log
  api.get("/api/automation-executions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const ruleId = req.query.ruleId ? parseInt(req.query.ruleId as string) : undefined;
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      
      const executions = await storage.getAutomationExecutions(org.id, ruleId, limit);
      res.json(executions);
    } catch (error: any) {
      logger.error("Get automation executions error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // ENHANCED TASKS (Phase 8.2)
  // ============================================

  // GET /api/tasks/my - Get current user's tasks
  api.get("/api/tasks/my", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = user?.id || user.id;
      
      const tasks = await storage.getMyTasks(org.id, userId);
      res.json(tasks);
    } catch (error: any) {
      logger.error("Get my tasks error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/tasks/entity/:entityType/:entityId - Get tasks for entity
  api.get("/api/tasks/entity/:entityType/:entityId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { entityType, entityId } = req.params;
      
      const tasks = await storage.getTasksByEntity(org.id, entityType, parseInt(entityId));
      res.json(tasks);
    } catch (error: any) {
      logger.error("Get entity tasks error", error);
      Errors.internal(res, error);
    }
  });

  // PUT /api/tasks/:id/complete - Mark task as complete
  api.put("/api/tasks/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getTask(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Task");
      }
      
      const completed = await storage.completeTask(id);
      res.json(completed);
    } catch (error: any) {
      logger.error("Complete task error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // NOTIFICATIONS (Phase 8.3)
  // ============================================

  // GET /api/notifications - Get user's notifications
  api.get("/api/notifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = user?.id || user.id;
      const unreadOnly = req.query.unreadOnly === 'true';
      
      const notifications = await storage.getNotifications(org.id, userId, unreadOnly);
      res.json(notifications);
    } catch (error: any) {
      logger.error("Get notifications error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/notifications/count - Get unread notification count
  api.get("/api/notifications/count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = user?.id || user.id;
      
      const count = await storage.getUnreadNotificationCount(org.id, userId);
      res.json({ count });
    } catch (error: any) {
      logger.error("Get notification count error", error);
      Errors.internal(res, error);
    }
  });

  // PUT /api/notifications/:id/read - Mark notification as read
  api.put("/api/notifications/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const notification = await storage.markNotificationRead(id);
      res.json(notification);
    } catch (error: any) {
      logger.error("Mark notification read error", error);
      Errors.internal(res, error);
    }
  });

  // PUT /api/notifications/read-all - Mark all notifications as read
  api.put("/api/notifications/read-all", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = user?.id || user.id;
      
      await storage.markAllNotificationsRead(org.id, userId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Mark all notifications read error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================

  // -----------------------------------------------------------------------
  // Team Performance Leaderboard (T56)
  // -----------------------------------------------------------------------

  api.get("/api/analytics/team-leaderboard", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization || req.organization;
      const orgId: number = org.id;

      const since = req.query.since
        ? new Date(req.query.since as string)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1); // MTD default

      // Fetch all active team members
      const members = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.isActive, true)));

      // All deals this period
      const allDeals = await db
        .select()
        .from(deals)
        .where(and(eq(deals.organizationId, orgId), gte(deals.createdAt, since)));

      // All leads assigned during this period
      const allLeads = await db
        .select()
        .from(leads)
        .where(and(eq(leads.organizationId, orgId), gte(leads.createdAt, since)));

      const leaderboard = members.map((m) => {
        const memberDeals = allDeals.filter(
          (d) => d.assignedTo === m.id
        );
        const closedDeals = memberDeals.filter((d) => d.status === "closed");
        const activeDeals = memberDeals.filter(
          (d) => !["closed", "dead", "cancelled"].includes(d.status || "")
        );
        const offersOut = memberDeals.filter((d) =>
          ["offer_sent", "countered"].includes(d.status || "")
        );
        const revenueGenerated = closedDeals.reduce(
          (sum, d) => sum + Number(d.acceptedAmount || 0),
          0
        );
        const memberLeads = allLeads.filter(
          (l) => String(l.assignedTo) === m.userId
        );

        return {
          teamMemberId: m.id,
          displayName: m.displayName || m.email || `Member ${m.id}`,
          email: m.email,
          role: m.role,
          leadsAssigned: memberLeads.length,
          offersOut: offersOut.length,
          dealsUnderContract: activeDeals.length,
          dealsClosed: closedDeals.length,
          revenueGenerated,
          score:
            closedDeals.length * 10 +
            activeDeals.length * 3 +
            offersOut.length * 2 +
            memberLeads.length,
        };
      });

      // Sort descending by score
      leaderboard.sort((a, b) => b.score - a.score);

      res.json({
        since: since.toISOString(),
        leaderboard,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // T91 — COHORT ANALYSIS
  // Segment leads by source, state, campaign, import month/quarter
  // and track them through the conversion funnel over time.
  // ============================================

  api.get("/api/analytics/cohorts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const segmentBy = ((req.query.segmentBy as string) || "source") as any;
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const { buildCohortReport } = await import("./services/cohortAnalysis");
      const report = await buildCohortReport(org.id, segmentBy, from, to);
      res.json(report);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // COHORT RETENTION DASHBOARD
  // Groups organizations/leads by signup week/month,
  // computes retention curves, revenue per cohort,
  // and lead conversion rates.
  // ============================================

  api.get("/api/analytics/cohort-dashboard", isAuthenticated, getOrCreateOrg, async (req: any, res) => {
    try {
      const org = getOrganization(req as AuthenticatedRequest);
      const granularity = (req.query.granularity as string) || "week";
      const weeksBack = parseInt(req.query.weeksBack as string) || 12;

      const now = new Date();
      const cutoff = new Date(now);
      if (granularity === "month") {
        const adjusted = addMonths(cutoff, -weeksBack);
        cutoff.setTime(adjusted.getTime());
      } else {
        cutoff.setDate(cutoff.getDate() - weeksBack * 7);
      }

      // Truncation expression based on granularity
      const truncExpr = granularity === "month"
        ? sql`date_trunc('month', ${leads.createdAt})`
        : sql`date_trunc('week', ${leads.createdAt})`;

      // 1. Signup cohorts: leads grouped by created_at period
      const cohortSignups = await db
        .select({
          cohort: truncExpr.as("cohort"),
          total: count().as("total"),
        })
        .from(leads)
        .where(
          and(
            eq(leads.organizationId, org.id),
            gte(leads.createdAt, cutoff)
          )
        )
        .groupBy(sql`cohort`)
        .orderBy(sql`cohort`);

      // 2. Retention: leads that are still "active" (status != new and updated within each week bucket)
      // We measure retention by checking if leads were updated after their cohort start
      const retentionData = await db
        .select({
          cohort: truncExpr.as("cohort"),
          weeksAfter: sql<number>`
            FLOOR(EXTRACT(EPOCH FROM (${leads.updatedAt} - ${truncExpr})) / (7 * 86400))
          `.as("weeks_after"),
          activeCount: count().as("active_count"),
        })
        .from(leads)
        .where(
          and(
            eq(leads.organizationId, org.id),
            gte(leads.createdAt, cutoff),
            sql`${leads.updatedAt} > ${leads.createdAt}`
          )
        )
        .groupBy(sql`cohort`, sql`weeks_after`)
        .orderBy(sql`cohort`, sql`weeks_after`);

      // 3. Revenue per cohort: sum deals closed value grouped by the lead cohort period
      // Since deals don't directly link to leads, we use deal creation date mapped to the same cohort periods
      const dealTruncExpr = granularity === "month"
        ? sql`date_trunc('month', ${deals.createdAt})`
        : sql`date_trunc('week', ${deals.createdAt})`;

      const revenueByCohort = await db
        .select({
          cohort: dealTruncExpr.as("cohort"),
          totalRevenue: sql<string>`COALESCE(SUM(CAST(${deals.acceptedAmount} AS numeric)), 0)`.as("total_revenue"),
          closedDeals: count().as("closed_deals"),
        })
        .from(deals)
        .where(
          and(
            eq(deals.organizationId, org.id),
            eq(deals.status, "closed"),
            gte(deals.createdAt, cutoff)
          )
        )
        .groupBy(sql`cohort`)
        .orderBy(sql`cohort`);

      // 4. Lead conversion rates by cohort
      const conversionByCohort = await db
        .select({
          cohort: truncExpr.as("cohort"),
          totalLeads: count().as("total_leads"),
          contacted: sql<number>`COUNT(CASE WHEN ${leads.status} != 'new' THEN 1 END)`.as("contacted"),
          converted: sql<number>`COUNT(CASE WHEN ${leads.status} = 'closed' THEN 1 END)`.as("converted"),
        })
        .from(leads)
        .where(
          and(
            eq(leads.organizationId, org.id),
            gte(leads.createdAt, cutoff)
          )
        )
        .groupBy(sql`cohort`)
        .orderBy(sql`cohort`);

      // Build cohort labels and combine data
      const cohortMap = new Map<string, any>();

      for (const row of cohortSignups) {
        const label = new Date(row.cohort as string).toLocaleDateString("en-US", {
          month: "short",
          day: granularity === "week" ? "numeric" : undefined,
          year: "numeric",
        });
        cohortMap.set(String(row.cohort), {
          label,
          cohortDate: row.cohort,
          signups: Number(row.total),
          retention: [] as { week: number; active: number; rate: number }[],
          revenue: 0,
          closedDeals: 0,
          totalLeads: 0,
          contacted: 0,
          converted: 0,
          contactRate: 0,
          conversionRate: 0,
        });
      }

      // Merge retention data
      for (const row of retentionData) {
        const cohort = cohortMap.get(String(row.cohort));
        if (cohort) {
          const weekBucket = Math.floor(Number(row.weeksAfter));
          if (weekBucket >= 0 && weekBucket <= weeksBack) {
            cohort.retention.push({
              week: weekBucket,
              active: Number(row.activeCount),
              rate: cohort.signups > 0 ? Number(row.activeCount) / cohort.signups : 0,
            });
          }
        }
      }

      // Merge revenue data
      for (const row of revenueByCohort) {
        const cohort = cohortMap.get(String(row.cohort));
        if (cohort) {
          cohort.revenue = Number(row.totalRevenue);
          cohort.closedDeals = Number(row.closedDeals);
        }
      }

      // Merge conversion data
      for (const row of conversionByCohort) {
        const cohort = cohortMap.get(String(row.cohort));
        if (cohort) {
          cohort.totalLeads = Number(row.totalLeads);
          cohort.contacted = Number(row.contacted);
          cohort.converted = Number(row.converted);
          cohort.contactRate = cohort.totalLeads > 0 ? cohort.contacted / cohort.totalLeads : 0;
          cohort.conversionRate = cohort.totalLeads > 0 ? cohort.converted / cohort.totalLeads : 0;
        }
      }

      const cohorts = Array.from(cohortMap.values());

      res.json({
        granularity,
        weeksBack,
        cohorts,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Cohort dashboard error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // T92 — ATTRIBUTION ANALYTICS
  // Which campaigns, channels, and touch numbers convert leads?
  // Provides ROI scoring per campaign and channel.
  // ============================================

  api.get("/api/analytics/attribution", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 90 * 86400000);
      const to = req.query.to ? new Date(req.query.to as string) : new Date();
      const { getAttributionReport } = await import("./services/attributionService");
      const report = await getAttributionReport(org.id, from, to);
      res.json(report);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // T93 — OFFER BATCH ROUTES
  // Create and manage automated offer batches.
  // ============================================

  api.post("/api/offers/batch", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { createOfferBatch } = await import("./services/offerBatchService");
      const { parcels = [], ...configBody } = req.body ?? {};
      const userIdNum = parseInt(String(user.id), 10);
      const batch = await createOfferBatch(parcels, {
        ...configBody,
        orgId: org.id,
        userId: Number.isNaN(userIdNum) ? 0 : userIdNum,
      });
      res.json(batch);
    } catch (err: any) {
      Errors.badRequest(res, err.message ?? "Bad request");
    }
  });

  api.get("/api/offers/batch/:id/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getBatchStatus } = await import("./services/offerBatchService");
      const batch = await getBatchStatus(parseInt(req.params.id, 10), org.id);
      if (!batch) return Errors.notFound(res, "Batch");
      res.json(batch);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

}
