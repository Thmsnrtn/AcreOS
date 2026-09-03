/**
 * Autonomous Agent API Routes
 *
 * Endpoints for managing the autonomous agent system:
 *   - GET  /api/autonomous/agents              — list all agents + status
 *   - GET  /api/autonomous/agents/:type        — single agent status
 *   - PUT  /api/autonomous/agents/:type/config — update config (FOUNDER-ONLY)
 *   - GET  /api/autonomous/tasks               — list tasks (with filters)
 *   - POST /api/autonomous/tasks/:id/run       — run a task immediately (FOUNDER-ONLY)
 *   - GET  /api/autonomous/tasks/pending-approval — tasks awaiting review
 *   - POST /api/autonomous/evaluate            — evaluate a hypothetical action
 *
 * Customer autonomy clarity program (2026-09-02, founder decision 7,
 * AUTONOMY_SPEC.md §3d): the customer's ONE control is Settings → Pax
 * (organizations.pax_controls, PATCH /api/pax/controls). This router was the
 * undocumented place a signed-in customer could set `full_auto` on an
 * engine and queue tasks for a processor that escalated every one of them.
 * The processor (server/jobs/autonomousTaskProcessor.ts) is deleted, so
 * POST /tasks, /tasks/:id/approve, /tasks/:id/reject and /trigger-processor —
 * which only ever fed it — are gone with it; the two routes that still
 * change or execute anything (PUT config, POST /tasks/:id/run) are
 * founder-gated. The read-only task lists stay (the table has other live
 * writers), as does the inert /evaluate preview.
 */

import type { Express } from "express";
import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { agentTasks, agentConfigs } from "@shared/schema";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { autonomousAgentEngine, type AutonomyLevel, type ActionCategory } from "./services/autonomousAgentEngine";
import { executeAgentTask, type CoreAgentType } from "./services/core-agents";
import { Errors } from "./utils/errors";

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

const evaluateActionSchema = z.object({
  agentType: z.enum(["research", "deals", "communications", "operations"]),
  actionDescription: z.string().min(1),
  parameters: z.record(z.string(), z.any()).optional(),
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
      const org = req.organization;
      const statuses = await Promise.all(
        CORE_AGENT_TYPES.map(type => autonomousAgentEngine.getAgentStatus(org.id, type))
      );
      res.json(statuses);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ── GET /agents/:type ───────────────────────────────────────────────────────
  router.get("/agents/:type", async (req, res) => {
    try {
      const org = req.organization;
      const { type } = req.params;

      if (!CORE_AGENT_TYPES.includes(type as CoreAgentType)) {
        return Errors.badRequest(res, "Invalid agent type");
      }

      const status = await autonomousAgentEngine.getAgentStatus(org.id, type);
      res.json(status);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ── PUT /agents/:type/config — FOUNDER-ONLY ──────────────────────────────
  router.put("/agents/:type/config", requireFounder, async (req, res) => {
    try {
      const org = req.organization;
      const { type } = req.params;

      if (!CORE_AGENT_TYPES.includes(type as CoreAgentType)) {
        return Errors.badRequest(res, "Invalid agent type");
      }

      const parsed = autonomyConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
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
      Errors.internal(res, err);
    }
  });

  // ── GET /tasks ──────────────────────────────────────────────────────────────
  router.get("/tasks", async (req, res) => {
    try {
      const org = req.organization;
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
      Errors.internal(res, err);
    }
  });

  // ── GET /tasks/pending-approval ─────────────────────────────────────────────
  router.get("/tasks/pending-approval", async (req, res) => {
    try {
      const org = req.organization;

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
      Errors.internal(res, err);
    }
  });

  // ── POST /tasks/:id/run — FOUNDER-ONLY ───────────────────────────────────
  // Execute a specific task immediately (bypass queue)
  router.post("/tasks/:id/run", requireFounder, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const taskId = parseInt(req.params.id);

      const [task] = await db
        .select()
        .from(agentTasks)
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.organizationId, org.id)))
        .limit(1);

      if (!task) {
        return Errors.notFound(res, "Task");
      }

      if (!["pending", "failed"].includes(task.status)) {
        return Errors.badRequest(res, `Cannot run task in status: ${task.status}`);
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
          reviewedBy: Number.isNaN(parseInt(String(user.id), 10)) ? null : parseInt(String(user.id), 10),
          reviewedAt: new Date(),
        })
        .where(eq(agentTasks.id, taskId));

      res.json({ result, executionTimeMs });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ── POST /evaluate ──────────────────────────────────────────────────────────
  // Evaluate a hypothetical action before queuing it
  router.post("/evaluate", async (req, res) => {
    try {
      const org = req.organization;
      const parsed = evaluateActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }

      const { agentType, actionDescription, parameters } = parsed.data;

      let profile;
      if (parsed.data.category) {
        // The caller states the category, and this endpoint SIMULATES it.
        //
        // A caller cannot declare its own safety, so `classified: true` here
        // would be indefensible on any path that executes. This route executes
        // nothing — it returns { profile, decision, summary } for the approval
        // UI to show — so the honest reading is a hypothetical: "IF this action
        // is a `contract` action, here is what the engine would decide." Without
        // the flag the engine escalates every explicit category before reaching
        // the score bands, which made the preview answer a different question
        // from the one the processor answers, for every category including
        // `research`.
        //
        // The load-bearing condition is that nothing downstream of here acts:
        // `autonomousEvaluatePreviewIsInert` in autonomyRiskClassification.test.ts
        // pins it. If this handler ever gains an execution path, this flag has
        // to go with it.
        profile = {
          category: parsed.data.category as ActionCategory,
          financialImpact: parsed.data.financialImpact || 0,
          isExternal: parsed.data.isExternal || false,
          isIrreversible: parsed.data.isIrreversible || false,
          classified: true,
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
      Errors.internal(res, err);
    }
  });

  app.use("/api/autonomous", router);
}
