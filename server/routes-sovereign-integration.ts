// @ts-nocheck
/**
 * Sovereign Company Protocol — Integration Routes
 *
 * Phase A: Job Health API (founder visibility into background jobs)
 * Phase B: Event Mesh drain + WebSocket bridge
 * Phase D: Notification Dispatcher API
 * Phase E: Agent Collaboration endpoints
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { jobHealthLogs, agentMessages, agentEvents } from "@shared/schema";
import { eq, desc, sql, and, gte, inArray } from "drizzle-orm";
import { wsServer } from "./websocket";

export function registerSovereignIntegrationRoutes(app: Express) {
  // ─── Phase A: Job Health ───────────────────────────────────────────────────

  /**
   * GET /api/founder/job-health — Recent job health logs
   */
  app.get("/api/founder/job-health", async (req: Request, res: Response) => {
    try {
      const logs = await db
        .select()
        .from(jobHealthLogs)
        .orderBy(desc(jobHealthLogs.runCompletedAt))
        .limit(200);
      res.json(logs);
    } catch (err: any) {
      console.error("[job-health] Error fetching logs:", err.message);
      res.json([]);
    }
  });

  /**
   * POST /api/founder/job-health/trigger — Manually trigger a job
   */
  app.post("/api/founder/job-health/trigger", async (req: Request, res: Response) => {
    try {
      const { jobName } = req.body;
      if (!jobName) return res.status(400).json({ error: "jobName required" });

      // Log that a manual trigger was requested
      await db.insert(jobHealthLogs).values({
        jobName: `manual:${jobName}`,
        runStartedAt: new Date(),
        runCompletedAt: new Date(),
        durationMs: 0,
        status: "manual_trigger",
      });

      res.json({ success: true, message: `Manual trigger logged for ${jobName}` });
    } catch (err: any) {
      console.error("[job-health] Error triggering job:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Phase D: Notification Preferences & Dispatch ──────────────────────────

  /**
   * GET /api/notifications/events — Available notification event types
   */
  app.get("/api/notifications/events", async (_req: Request, res: Response) => {
    res.json({
      events: [
        { id: "deal:discovered", label: "New Deal Found", category: "deals", defaultChannel: "in_app" },
        { id: "deal:closed", label: "Deal Closed", category: "deals", defaultChannel: "email" },
        { id: "agent:escalation", label: "Agent Escalation", category: "agents", defaultChannel: "sms" },
        { id: "agent:decision", label: "Agent Decision Made", category: "agents", defaultChannel: "in_app" },
        { id: "approval:requested", label: "Approval Needed", category: "approvals", defaultChannel: "sms" },
        { id: "job:failed", label: "Background Job Failed", category: "system", defaultChannel: "in_app" },
        { id: "revenue:milestone", label: "Revenue Milestone", category: "finance", defaultChannel: "email" },
        { id: "briefing:ready", label: "Daily Briefing Ready", category: "system", defaultChannel: "in_app" },
        { id: "agent:conflict", label: "Agent Conflict Unresolved", category: "agents", defaultChannel: "sms" },
        { id: "market:alert", label: "Market Alert", category: "intelligence", defaultChannel: "in_app" },
      ],
    });
  });

  // ─── Phase D: Notification API ───────────────────────────────────────────

  /**
   * GET /api/notifications/history — In-app notification history
   */
  app.get("/api/notifications/history", async (req: Request, res: Response) => {
    try {
      const { notificationDispatcher } = await import("./services/notificationDispatcher");
      const limit = parseInt(req.query.limit as string) || 50;
      res.json(notificationDispatcher.getNotifications(limit));
    } catch (err: any) {
      res.json([]);
    }
  });

  /**
   * GET /api/notifications/unread-count — Unread notification count
   */
  app.get("/api/notifications/unread-count", async (_req: Request, res: Response) => {
    try {
      const { notificationDispatcher } = await import("./services/notificationDispatcher");
      res.json({ count: notificationDispatcher.getUnreadCount() });
    } catch (err: any) {
      res.json({ count: 0 });
    }
  });

  /**
   * POST /api/notifications/:id/read — Mark notification as read
   */
  app.post("/api/notifications/:id/read", async (req: Request, res: Response) => {
    try {
      const { notificationDispatcher } = await import("./services/notificationDispatcher");
      const success = notificationDispatcher.markAsRead(req.params.id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/notifications/test — Send a test notification (founder only)
   */
  app.post("/api/notifications/test", async (req: Request, res: Response) => {
    try {
      const { notificationDispatcher } = await import("./services/notificationDispatcher");
      await notificationDispatcher.dispatch({
        eventType: req.body.eventType ?? "briefing:ready",
        channel: "system:test",
        payload: { message: req.body.message ?? "This is a test notification" },
        priority: req.body.priority ?? 3,
        orgId: (req as any).organization?.id,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Phase E: Agent Collaboration ──────────────────────────────────────────

  /**
   * GET /api/founder/agent-collaboration/messages — Agent conversation history
   */
  app.get("/api/founder/agent-collaboration/messages", async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const messages = await db
        .select()
        .from(agentMessages)
        .orderBy(desc(agentMessages.createdAt))
        .limit(limit);
      res.json(messages);
    } catch (err: any) {
      console.error("[collaboration] Error fetching messages:", err.message);
      res.json([]);
    }
  });

  /**
   * POST /api/founder/agent-collaboration/override — Founder override an agent decision
   */
  app.post("/api/founder/agent-collaboration/override", async (req: Request, res: Response) => {
    try {
      const { agentCodename, decision, reason, overrideAction } = req.body;
      if (!agentCodename || !overrideAction) {
        return res.status(400).json({ error: "agentCodename and overrideAction required" });
      }

      // Log the override as an agent event
      const [event] = await db.insert(agentEvents).values({
        agentCodename,
        eventType: "founder_override",
        payload: {
          originalDecision: decision,
          overrideAction,
          reason: reason ?? "Founder override",
          overriddenAt: new Date().toISOString(),
        },
      }).returning();

      // Phase C: Broadcast override to WebSocket
      wsServer.broadcastFounderEvent("agent:override", {
        agent: agentCodename,
        action: overrideAction,
        reason,
      });

      res.json({ success: true, event });
    } catch (err: any) {
      console.error("[collaboration] Error recording override:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/founder/agent-collaboration/delegate — Founder delegates task to agent
   */
  app.post("/api/founder/agent-collaboration/delegate", async (req: Request, res: Response) => {
    try {
      const { fromAgent, toAgent, task, context } = req.body;
      if (!toAgent || !task) {
        return res.status(400).json({ error: "toAgent and task required" });
      }

      // Create delegation message
      const [message] = await db.insert(agentMessages).values({
        fromAgent: fromAgent ?? "founder",
        toAgent,
        subject: `Delegated: ${task}`,
        content: JSON.stringify({ task, context: context ?? {} }),
        messageType: "delegation",
        priority: "high",
        isRead: false,
      }).returning();

      // Also log as event
      await db.insert(agentEvents).values({
        agentCodename: toAgent,
        eventType: "task_delegated",
        payload: {
          from: fromAgent ?? "founder",
          task,
          messageId: message.id,
        },
      });

      // Phase C: Broadcast delegation to WebSocket
      wsServer.broadcastFounderEvent("agent:delegation", {
        from: fromAgent ?? "founder",
        to: toAgent,
        task,
      });

      res.json({ success: true, message });
    } catch (err: any) {
      console.error("[collaboration] Error delegating:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/founder/agent-collaboration/consensus — Start consensus vote
   */
  app.post("/api/founder/agent-collaboration/consensus", async (req: Request, res: Response) => {
    try {
      const { topic, options, participants } = req.body;
      if (!topic || !participants || !Array.isArray(participants)) {
        return res.status(400).json({ error: "topic and participants required" });
      }

      // Create consensus event
      const [event] = await db.insert(agentEvents).values({
        agentCodename: "system",
        eventType: "consensus_started",
        payload: {
          topic,
          options: options ?? ["approve", "reject"],
          participants,
          votes: {},
          startedAt: new Date().toISOString(),
          status: "voting",
        },
      }).returning();

      // Notify each participant
      for (const agent of participants) {
        await db.insert(agentMessages).values({
          fromAgent: "system",
          toAgent: agent,
          subject: `Vote requested: ${topic}`,
          content: JSON.stringify({ consensusId: event.id, topic, options }),
          messageType: "consensus_request",
          priority: "high",
          isRead: false,
        });
      }

      // Phase C: Broadcast consensus start to WebSocket
      wsServer.broadcastFounderEvent("agent:consensus_started", {
        topic: consensusTopic,
        participants,
        consensusId: event.id,
      });

      res.json({ success: true, consensusId: event.id, event });
    } catch (err: any) {
      console.error("[collaboration] Error starting consensus:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
