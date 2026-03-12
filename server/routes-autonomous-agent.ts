/**
 * Autonomous Agent API Routes
 *
 * Endpoints for managing the autonomous agent system:
 *   - GET  /api/autonomous/agents              — list all agents + status
 *   - GET  /api/autonomous/agents/:type        — single agent status
 *   - PUT  /api/autonomous/agents/:type/config — update autonomy config
 *   - GET  /api/autonomous/tasks               — list tasks (with filters)
 *   - POST /api/autonomous/tasks               — queue a new task manually
 *   - POST /api/autonomous/tasks/:id/approve   — approve escalated task
 *   - POST /api/autonomous/tasks/:id/reject    — reject escalated task
 *   - POST /api/autonomous/tasks/:id/run       — run a task immediately
 *   - GET  /api/autonomous/tasks/pending-approval — tasks awaiting review
 *   - GET  /api/autonomous/decisions           — decision log
 *   - POST /api/autonomous/evaluate            — evaluate a hypothetical action
 */

import type { Express } from "express";
import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { agentTasks, agentConfigs } from "@shared/schema";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { autonomousAgentEngine, type AutonomyLevel, type ActionCategory } from "./services/autonomousAgentEngine";
import {
  queueAgentTask,
  approveEscalatedTask,
  rejectEscalatedTask,
  runOnce,
} from "./jobs/autonomousTaskProcessor";
import { executeAgentTask, type CoreAgentType } from "./services/core-agents";

const CORE_AGENT_TYPES: CoreAgentType[] = ["research", "deals", "communications", "operations"];

// ─── Validation schemas ────────────────────────────────────────────────────────

const autonomyConfigSchema = z.object({
  autonomyLevel: z.enum(["full_auto", "supervised", "manual"]).optional(),
  autoApproveCategories: z
    .array(
      z.enum([
        "research", "draft", "data_write", "scheduling",
        "external_api", "communication", "financial", "offer", "contract",
      ])
    )
    .optional(),
  escalateToHuman: z
    .array(
      z.enum([
        "research", "draft", "data_write", "scheduling",
        "external_api", "communication", "financial", "offer", "contract",
      ])
    )
    .optional(),
  maxActionsPerDay: z.number().int().min(1).max(1000).optional(),
  notifyOnAction: z.boolean().optional(),
  customInstructions: z.string().max(2000).optional(),
});

const queueTaskSchema = z.object({
  agentType: z.enum(["research", "deals", "communications", "operations"]),
  action: z.string().min(1),
  parameters: z.record(z.any()).optional(),
  relatedLeadId: z.number().int().optional(),
  relatedPropertyId: z.number().int().optional(),
  relatedDealId: z.number().int().optional(),
  priority: z.number().int().min(1).max(10).optional(),
});

const evaluateActionSchema = z.object({
  agentType: z.enum(["research", "deals", "communications", "operations"]),
  actionDescription: z.string().min(1),
  parameters: z.record(z.any()).optional(),
  category: z
    .enum([
      "research", "draft", "data_write", "scheduling",
      "external_api", "communication", "financial", "offer", "contract",
    ])
    .optional(),
  financialImpact: z.number().optional(),
  isExternal: z.boolean().optional(),
  isIrreversible: z.boolean().optional(),
});

// ─── Route registration ────────────────────────────────────────────────────────

export function registerAutonomousAgentRoutes(app: Express): void {
  const router = Router();

  // All routes require auth + org resolution
  router.use(isAuthenticated, getOrCreateOrg);

  // ── GET /agents ─────────────────────────────────────────────────────────────
  router.get("/agents", async (req, res) => {
    try {
      const org = (req as any).organization;
      const statuses = await Promise.all(
        CORE_AGENT_TYPES.map(type => autonomousAgentEngine.getAgentStatus(org.id, type))
      );
      res.json(statuses);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /agents/:type ───────────────────────────────────────────────────────
  router.get("/agents/:type", async (req, res) => {
    try {
      const org = (req as any).organization;
      const { type } = req.params;

      if (!CORE_AGENT_TYPES.includes(type as CoreAgentType)) {
        return res.status(400).json({ message: "Invalid agent type" });
      }

      const status = await autonomousAgentEngine.getAgentStatus(org.id, type);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PUT /agents/:type/config ────────────────────────────────────────────────
  router.put("/agents/:type/config", async (req, res) => {
    try {
      const org = (req as any).organization;
      const { type } = req.params;

      if (!CORE_AGENT_TYPES.includes(type as CoreAgentType)) {
        return res.status(400).json({ message: "Invalid agent type" });
      }

      const parsed = autonomyConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid config", errors: parsed.error.errors });
      }

      await autonomousAgentEngine.updateAgentConfig(org.id, type, {
        autonomyLevel: parsed.data.autonomyLevel as AutonomyLevel | undefined,
        autoApproveCategories: parsed.data.autoApproveCategories as ActionCategory[] | undefined,
        escalateToHuman: parsed.data.escalateToHuman as ActionCategory[] | undefined,
        maxActionsPerDay: parsed.data.maxActionsPerDay,
        notifyOnAction: parsed.data.notifyOnAction,
        customInstructions: parsed.data.customInstructions,
      });

      const updated = await autonomousAgentEngine.getAgentStatus(org.id, type);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /tasks ──────────────────────────────────────────────────────────────
  router.get("/tasks", async (req, res) => {
    try {
      const org = (req as any).organization;
      const {
        status,
        agentType,
        requiresReview,
        limit = "50",
        offset = "0",
      } = req.query as Record<string, string>;

      let query = db
        .select()
        .from(agentTasks)
        .where(eq(agentTasks.organizationId, org.id))
        .orderBy(desc(agentTasks.createdAt))
        .limit(Math.min(parseInt(limit) || 50, 100))
        .offset(parseInt(offset) || 0);

      // Apply filters by rewriting query with conditions
      const conditions = [eq(agentTasks.organizationId, org.id)];
      if (status) conditions.push(eq(agentTasks.status, status));
      if (agentType) conditions.push(eq(agentTasks.agentType, agentType));
      if (requiresReview === "true") conditions.push(eq(agentTasks.requiresReview, true));
      if (requiresReview === "false") conditions.push(eq(agentTasks.requiresReview, false));

      const tasks = await db
        .select()
        .from(agentTasks)
        .where(and(...conditions))
        .orderBy(desc(agentTasks.createdAt))
        .limit(Math.min(parseInt(limit) || 50, 100))
        .offset(parseInt(offset) || 0);

      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /tasks/pending-approval ─────────────────────────────────────────────
  router.get("/tasks/pending-approval", async (req, res) => {
    try {
      const org = (req as any).organization;

      const tasks = await db
        .select()
        .from(agentTasks)
        .where(
          and(
            eq(agentTasks.organizationId, org.id),
            eq(agentTasks.requiresReview, true),
            eq(agentTasks.status, "pending")
          )
        )
        .orderBy(agentTasks.priority, agentTasks.createdAt)
        .limit(100);

      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /tasks ─────────────────────────────────────────────────────────────
  router.post("/tasks", async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = queueTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid task", errors: parsed.error.errors });
      }

      const taskId = await queueAgentTask(
        org.id,
        parsed.data.agentType,
        parsed.data.action,
        parsed.data.parameters || {},
        {
          relatedLeadId: parsed.data.relatedLeadId,
          relatedPropertyId: parsed.data.relatedPropertyId,
          relatedDealId: parsed.data.relatedDealId,
        },
        parsed.data.priority || 5
      );

      res.status(201).json({ taskId, message: "Task queued for autonomous processing" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /tasks/:id/approve ─────────────────────────────────────────────────
  router.post("/tasks/:id/approve", async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const taskId = parseInt(req.params.id);
      const { notes } = req.body;

      // Verify task belongs to org
      const [task] = await db
        .select()
        .from(agentTasks)
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.organizationId, org.id)))
        .limit(1);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      await approveEscalatedTask(taskId, user.id, notes);

      // Immediately trigger the processor to pick it up
      runOnce().catch(err => console.error("[autonomous] Immediate run failed:", err));

      res.json({ message: "Task approved and queued for execution" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /tasks/:id/reject ──────────────────────────────────────────────────
  router.post("/tasks/:id/reject", async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const taskId = parseInt(req.params.id);
      const { notes } = req.body;

      const [task] = await db
        .select()
        .from(agentTasks)
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.organizationId, org.id)))
        .limit(1);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      await rejectEscalatedTask(taskId, user.id, notes);
      res.json({ message: "Task rejected" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /tasks/:id/run ─────────────────────────────────────────────────────
  // Execute a specific task immediately (bypass queue)
  router.post("/tasks/:id/run", async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const taskId = parseInt(req.params.id);

      const [task] = await db
        .select()
        .from(agentTasks)
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.organizationId, org.id)))
        .limit(1);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      if (!["pending", "failed"].includes(task.status)) {
        return res.status(400).json({ message: `Cannot run task in status: ${task.status}` });
      }

      const input = task.input as Record<string, any>;

      // Mark as running
      await db
        .update(agentTasks)
        .set({ status: "processing", startedAt: new Date(), requiresReview: false })
        .where(eq(agentTasks.id, taskId));

      const startTime = Date.now();

      const result = await executeAgentTask(task.agentType as CoreAgentType, {
        action: input.action,
        parameters: input.parameters || {},
        context: {
          organizationId: org.id,
          userId: String(user.id),
          relatedLeadId: task.relatedLeadId ?? undefined,
          relatedPropertyId: task.relatedPropertyId ?? undefined,
          relatedDealId: task.relatedDealId ?? undefined,
        },
      });

      const executionTimeMs = Date.now() - startTime;

      await db
        .update(agentTasks)
        .set({
          status: result.success ? "completed" : "failed",
          output: result as any,
          error: result.success ? null : (result.message || "Unknown error"),
          completedAt: new Date(),
          executionTimeMs,
          requiresReview: !!result.requiresApproval,
          reviewedBy: user.id,
          reviewedAt: new Date(),
        })
        .where(eq(agentTasks.id, taskId));

      res.json({ result, executionTimeMs });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /evaluate ──────────────────────────────────────────────────────────
  // Evaluate a hypothetical action before queuing it
  router.post("/evaluate", async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = evaluateActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { agentType, actionDescription, parameters } = parsed.data;

      let profile;
      if (parsed.data.category) {
        // User provided explicit risk profile
        profile = {
          category: parsed.data.category as ActionCategory,
          financialImpact: parsed.data.financialImpact || 0,
          isExternal: parsed.data.isExternal || false,
          isIrreversible: parsed.data.isIrreversible || false,
          description: actionDescription,
        };
      } else {
        // AI classifies the action
        profile = await autonomousAgentEngine.classifyAction(
          actionDescription,
          agentType,
          parameters || {},
          org.id
        );
      }

      const decision = await autonomousAgentEngine.evaluate(org.id, agentType, profile);

      res.json({
        profile,
        decision,
        summary: await autonomousAgentEngine.generateDecisionSummary(
          agentType,
          actionDescription,
          profile,
          decision
        ),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /trigger-processor ─────────────────────────────────────────────────
  // Manually trigger a processor run (admin/debug)
  router.post("/trigger-processor", async (req, res) => {
    try {
      // Fire and forget
      runOnce().catch(err => console.error("[autonomous] Manual trigger failed:", err));
      res.json({ message: "Processor triggered" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.use("/api/autonomous", router);
}
