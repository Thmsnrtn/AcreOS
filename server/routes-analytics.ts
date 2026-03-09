import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { insertTaskSchema, teamMembers, deals, leads } from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, count, sql } from "drizzle-orm";

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
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getExecutiveMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get executive metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch executive metrics" });
    }
  });

  // GET /api/analytics/revenue - Revenue metrics
  api.get("/api/analytics/revenue", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getRevenueMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get revenue metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch revenue metrics" });
    }
  });

  // GET /api/analytics/leads - Lead metrics
  api.get("/api/analytics/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getLeadMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get lead metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch lead metrics" });
    }
  });

  // GET /api/analytics/deals - Deal metrics
  api.get("/api/analytics/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getDealMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get deal metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch deal metrics" });
    }
  });

  // GET /api/analytics/campaigns - Campaign metrics
  api.get("/api/analytics/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getCampaignMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get campaign metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch campaign metrics" });
    }
  });

  // GET /api/analytics/pipeline - Pipeline value by stage
  api.get("/api/analytics/pipeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const metrics = await storage.getPipelineValue(org.id);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get pipeline metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch pipeline metrics" });
    }
  });

  // GET /api/analytics/velocity - Deal velocity metrics
  api.get("/api/analytics/velocity", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getDealVelocity(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get velocity metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch velocity metrics" });
    }
  });

  // GET /api/analytics/conversions - Conversion rates
  api.get("/api/analytics/conversions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getConversionRates(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get conversion metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch conversion metrics" });
    }
  });

  // ============================================
  // AUTOMATION RULES (Phase 8.1)
  // ============================================

  // GET /api/automation-rules - List all automation rules
  api.get("/api/automation-rules", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const rules = await storage.getAutomationRules(org.id);
      res.json(rules);
    } catch (error: any) {
      console.error("Get automation rules error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch automation rules" });
    }
  });

  // GET /api/automation-rules/:id - Get single rule
  api.get("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const rule = await storage.getAutomationRule(org.id, id);
      if (!rule) {
        return res.status(404).json({ message: "Automation rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      console.error("Get automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch automation rule" });
    }
  });

  // POST /api/automation-rules - Create new rule
  api.post("/api/automation-rules", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const rule = await storage.createAutomationRule({
        ...req.body,
        organizationId: org.id,
        createdBy: userId,
      });
      res.status(201).json(rule);
    } catch (error: any) {
      console.error("Create automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to create automation rule" });
    }
  });

  // PUT /api/automation-rules/:id - Update rule
  api.put("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Automation rule not found" });
      }
      
      const updated = await storage.updateAutomationRule(id, req.body);
      res.json(updated);
    } catch (error: any) {
      console.error("Update automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to update automation rule" });
    }
  });

  // DELETE /api/automation-rules/:id - Delete rule
  api.delete("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Automation rule not found" });
      }
      
      await storage.deleteAutomationRule(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to delete automation rule" });
    }
  });

  // ============================================
  // WORKSPACE PRESETS - Power User Features
  // ============================================

  api.get("/api/workspaces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      const presets = await storage.getWorkspacePresets(org.id, userId);
      res.json(presets);
    } catch (error: any) {
      console.error("Get workspace presets error:", error);
      res.status(500).json({ message: error.message || "Failed to get workspace presets" });
    }
  });

  api.post("/api/workspaces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      
      const preset = await storage.createWorkspacePreset({
        ...req.body,
        organizationId: org.id,
        userId,
      });
      res.status(201).json(preset);
    } catch (error: any) {
      console.error("Create workspace preset error:", error);
      res.status(500).json({ message: error.message || "Failed to create workspace preset" });
    }
  });

  api.delete("/api/workspaces/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getWorkspacePreset(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Workspace preset not found" });
      }
      
      await storage.deleteWorkspacePreset(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete workspace preset error:", error);
      res.status(500).json({ message: error.message || "Failed to delete workspace preset" });
    }
  });

  // POST /api/automation-rules/:id/toggle - Toggle rule enabled status
  api.post("/api/automation-rules/:id/toggle", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const { enabled } = req.body;
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Automation rule not found" });
      }
      
      const updated = await storage.toggleAutomationRule(id, enabled);
      res.json(updated);
    } catch (error: any) {
      console.error("Toggle automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to toggle automation rule" });
    }
  });

  // GET /api/automation-executions - Get execution log
  api.get("/api/automation-executions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const ruleId = req.query.ruleId ? parseInt(req.query.ruleId as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      
      const executions = await storage.getAutomationExecutions(org.id, ruleId, limit);
      res.json(executions);
    } catch (error: any) {
      console.error("Get automation executions error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch automation executions" });
    }
  });

  // ============================================
  // ENHANCED TASKS (Phase 8.2)
  // ============================================

  // GET /api/tasks/my - Get current user's tasks
  api.get("/api/tasks/my", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const tasks = await storage.getMyTasks(org.id, userId);
      res.json(tasks);
    } catch (error: any) {
      console.error("Get my tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tasks" });
    }
  });

  // GET /api/tasks/entity/:entityType/:entityId - Get tasks for entity
  api.get("/api/tasks/entity/:entityType/:entityId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { entityType, entityId } = req.params;
      
      const tasks = await storage.getTasksByEntity(org.id, entityType, parseInt(entityId));
      res.json(tasks);
    } catch (error: any) {
      console.error("Get entity tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tasks" });
    }
  });

  // PUT /api/tasks/:id/complete - Mark task as complete
  api.put("/api/tasks/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getTask(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const completed = await storage.completeTask(id);
      res.json(completed);
    } catch (error: any) {
      console.error("Complete task error:", error);
      res.status(500).json({ message: error.message || "Failed to complete task" });
    }
  });

  // ============================================
  // NOTIFICATIONS (Phase 8.3)
  // ============================================

  // GET /api/notifications - Get user's notifications
  api.get("/api/notifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const unreadOnly = req.query.unreadOnly === 'true';
      
      const notifications = await storage.getNotifications(org.id, userId, unreadOnly);
      res.json(notifications);
    } catch (error: any) {
      console.error("Get notifications error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch notifications" });
    }
  });

  // GET /api/notifications/count - Get unread notification count
  api.get("/api/notifications/count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const count = await storage.getUnreadNotificationCount(org.id, userId);
      res.json({ count });
    } catch (error: any) {
      console.error("Get notification count error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch notification count" });
    }
  });

  // PUT /api/notifications/:id/read - Mark notification as read
  api.put("/api/notifications/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const notification = await storage.markNotificationRead(id);
      res.json(notification);
    } catch (error: any) {
      console.error("Mark notification read error:", error);
      res.status(500).json({ message: error.message || "Failed to mark notification as read" });
    }
  });

  // PUT /api/notifications/read-all - Mark all notifications as read
  api.put("/api/notifications/read-all", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      await storage.markAllNotificationsRead(org.id, userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Mark all notifications read error:", error);
      res.status(500).json({ message: error.message || "Failed to mark notifications as read" });
    }
  });

  // ============================================

  // -----------------------------------------------------------------------
  // Team Performance Leaderboard (T56)
  // -----------------------------------------------------------------------

  api.get("/api/analytics/team-leaderboard", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization || (req as any).org;
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
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // T91 — COHORT ANALYSIS
  // Segment leads by source, state, campaign, import month/quarter
  // and track them through the conversion funnel over time.
  // ============================================

  api.get("/api/analytics/cohorts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const segmentBy = ((req.query.segmentBy as string) || "source") as any;
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const { buildCohortReport } = await import("./services/cohortAnalysis");
      const report = await buildCohortReport(org.id, segmentBy, from, to);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // T92 — ATTRIBUTION ANALYTICS
  // Which campaigns, channels, and touch numbers convert leads?
  // Provides ROI scoring per campaign and channel.
  // ============================================

  api.get("/api/analytics/attribution", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 90 * 86400000);
      const to = req.query.to ? new Date(req.query.to as string) : new Date();
      const { getAttributionReport } = await import("./services/attributionService");
      const report = await getAttributionReport(org.id, from, to);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // T93 — OFFER BATCH ROUTES
  // Create and manage automated offer batches.
  // ============================================

  api.post("/api/offers/batch", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { createOfferBatch } = await import("./services/offerBatchService");
      const batch = await createOfferBatch({
        ...req.body,
        orgId: org.id,
        userId: user.id,
      });
      res.json(batch);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  api.get("/api/offers/batch/:id/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { getBatchStatus } = await import("./services/offerBatchService");
      const batch = await getBatchStatus(parseInt(req.params.id, 10), org.id);
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      res.json(batch);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}
