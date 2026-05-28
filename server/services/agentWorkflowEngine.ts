/**
 * Agent Workflow Engine — Sovereign Company Protocol v6
 *
 * Multi-agent pipelines that run autonomously.
 * "New lead arrives" → Oracle scores → Forge prices → Sophie reaches out → Beacon nurtures.
 * The CEO watches the factory floor, not every assembly step.
 *
 * Workflows are defined as ordered steps. Each step is owned by an agent,
 * produces output that feeds into the next step, and has a failure strategy.
 */

import { db } from "../db";
import {
  agentWorkflows, agentWorkflowRuns,
  type AgentWorkflow, type AgentWorkflowRun,
} from "@shared/schema";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import { executeAction } from "./agentActionExecutors";
import { companyAgentService } from "./companyAgents";
import { agentCommsService } from "./agentComms";
import { wsServer } from "../websocket";
import { logger } from "../utils/logger";

// ─── Built-in Workflow Templates ─────────────────────────────────────────────

const WORKFLOW_TEMPLATES: Array<Omit<AgentWorkflow, "id" | "createdAt" | "updatedAt" | "totalRuns" | "successRate" | "avgDurationMs">> = [
  {
    name: "New Lead Pipeline",
    description: "Full processing pipeline when a new lead enters the system",
    triggerType: "event",
    triggerConfig: { event: "new_lead" },
    steps: [
      {
        order: 0,
        agentCodename: "oracle_analytics",
        action: "score_lead",
        description: "Oracle analyzes lead quality and assigns a score",
        inputMapping: { leadId: "trigger.leadId" },
        failureStrategy: "skip",
      },
      {
        order: 1,
        agentCodename: "forge_revenue",
        action: "estimate_deal_value",
        description: "Forge estimates potential deal value and pricing strategy",
        inputMapping: { leadId: "trigger.leadId", leadScore: "step.0.score" },
        failureStrategy: "skip",
      },
      {
        order: 2,
        agentCodename: "shield_legal",
        action: "compliance_check",
        description: "Shield runs compliance pre-check on the lead",
        inputMapping: { leadId: "trigger.leadId" },
        failureStrategy: "skip",
      },
      {
        order: 3,
        agentCodename: "sophie_csm",
        action: "send_welcome",
        description: "Sophie sends personalized welcome outreach",
        inputMapping: { leadId: "trigger.leadId", dealValue: "step.1.estimatedValue" },
        failureStrategy: "retry",
      },
      {
        order: 4,
        agentCodename: "beacon_marketing",
        action: "add_to_nurture",
        description: "Beacon adds lead to appropriate nurture sequence",
        inputMapping: { leadId: "trigger.leadId", score: "step.0.score" },
        failureStrategy: "skip",
      },
    ],
    isActive: true,
    createdBy: "system",
  },
  {
    name: "Churn Rescue Protocol",
    description: "Coordinated response when a customer shows churn signals",
    triggerType: "event",
    triggerConfig: { event: "churn_signal" },
    steps: [
      {
        order: 0,
        agentCodename: "oracle_analytics",
        action: "analyze_churn_factors",
        description: "Oracle identifies the root causes of churn risk",
        inputMapping: { orgId: "trigger.orgId" },
        failureStrategy: "abort",
      },
      {
        order: 1,
        agentCodename: "sophie_csm",
        action: "check_support_history",
        description: "Sophie reviews recent support interactions for context",
        inputMapping: { orgId: "trigger.orgId", churnFactors: "step.0.factors" },
        failureStrategy: "skip",
      },
      {
        order: 2,
        agentCodename: "forge_revenue",
        action: "prepare_retention_offer",
        description: "Forge prepares a targeted retention offer if appropriate",
        inputMapping: { orgId: "trigger.orgId", churnFactors: "step.0.factors", supportContext: "step.1.context" },
        failureStrategy: "skip",
      },
      {
        order: 3,
        agentCodename: "sophie_csm",
        action: "send_retention_outreach",
        description: "Sophie reaches out with empathetic, personalized retention message",
        inputMapping: { orgId: "trigger.orgId", offer: "step.2.offer", factors: "step.0.factors" },
        failureStrategy: "retry",
      },
    ],
    isActive: true,
    createdBy: "system",
  },
  {
    name: "Payment Overdue Escalation",
    description: "Graduated response to overdue payments",
    triggerType: "event",
    triggerConfig: { event: "payment_overdue" },
    steps: [
      {
        order: 0,
        agentCodename: "ledger_finance",
        action: "assess_payment_situation",
        description: "Ledger assesses the full payment situation and history",
        inputMapping: { orgId: "trigger.orgId", amount: "trigger.amount" },
        failureStrategy: "abort",
      },
      {
        order: 1,
        agentCodename: "sophie_csm",
        action: "send_gentle_reminder",
        description: "Sophie sends a friendly payment reminder",
        inputMapping: { orgId: "trigger.orgId", assessment: "step.0.assessment" },
        failureStrategy: "retry",
      },
      {
        order: 2,
        agentCodename: "forge_revenue",
        action: "flag_revenue_risk",
        description: "Forge flags the revenue risk and updates forecasts",
        inputMapping: { orgId: "trigger.orgId", amount: "trigger.amount" },
        failureStrategy: "skip",
      },
    ],
    isActive: true,
    createdBy: "system",
  },
  {
    name: "Weekly Health Audit",
    description: "Comprehensive weekly system and business health check",
    triggerType: "schedule",
    triggerConfig: { schedule: "0 6 * * 1" }, // Monday 6 AM
    steps: [
      {
        order: 0,
        agentCodename: "sentinel_devops",
        action: "system_health_audit",
        description: "Sentinel runs comprehensive infrastructure health check",
        inputMapping: {},
        failureStrategy: "skip",
      },
      {
        order: 1,
        agentCodename: "crucible_qa",
        action: "quality_report",
        description: "Crucible generates quality metrics and regression analysis",
        inputMapping: {},
        failureStrategy: "skip",
      },
      {
        order: 2,
        agentCodename: "oracle_analytics",
        action: "weekly_metrics_summary",
        description: "Oracle summarizes all key metrics and anomalies",
        inputMapping: { systemHealth: "step.0.health", qualityReport: "step.1.report" },
        failureStrategy: "skip",
      },
      {
        order: 3,
        agentCodename: "forge_revenue",
        action: "weekly_revenue_report",
        description: "Forge reports on MRR, churn, and revenue pipeline",
        inputMapping: {},
        failureStrategy: "skip",
      },
      {
        order: 4,
        agentCodename: "atlas_cto",
        action: "compile_weekly_brief",
        description: "Atlas compiles everything into a cohesive CEO weekly brief",
        inputMapping: {
          systemHealth: "step.0.health",
          quality: "step.1.report",
          metrics: "step.2.summary",
          revenue: "step.3.report",
        },
        failureStrategy: "skip",
      },
    ],
    isActive: true,
    createdBy: "system",
  },
];

// ─── Engine ──────────────────────────────────────────────────────────────────

class WorkflowEngine {

  /** Seed built-in workflow templates on startup */
  async seedWorkflows(): Promise<void> {
    for (const template of WORKFLOW_TEMPLATES) {
      const existing = await db.query.agentWorkflows.findFirst({
        where: eq(agentWorkflows.name, template.name),
      });
      if (!existing) {
        await db.insert(agentWorkflows).values(template as any);
      }
    }
  }

  /** Get all workflows */
  async getAll(): Promise<AgentWorkflow[]> {
    return db.query.agentWorkflows.findMany({
      orderBy: [desc(agentWorkflows.createdAt)],
    });
  }

  /** Get active runs */
  async getActiveRuns(): Promise<AgentWorkflowRun[]> {
    return db.query.agentWorkflowRuns.findMany({
      where: eq(agentWorkflowRuns.status, "running"),
      orderBy: [desc(agentWorkflowRuns.startedAt)],
    });
  }

  /** Get recent runs (last 20) */
  async getRecentRuns(limit = 20): Promise<AgentWorkflowRun[]> {
    return db.query.agentWorkflowRuns.findMany({
      orderBy: [desc(agentWorkflowRuns.startedAt)],
      limit,
    });
  }

  /** Trigger a workflow by event name */
  async triggerByEvent(eventName: string, data: Record<string, any>): Promise<number | null> {
    const workflow = await db.query.agentWorkflows.findFirst({
      where: and(
        eq(agentWorkflows.isActive, true),
        sql`${agentWorkflows.triggerConfig}->>'event' = ${eventName}`,
      ),
    });

    if (!workflow) return null;
    return this.startRun(workflow.id, `event:${eventName}`, data);
  }

  /** Manually trigger a workflow */
  async triggerManual(workflowId: number, data?: Record<string, any>): Promise<number> {
    return this.startRun(workflowId, "ceo", data || {});
  }

  /** Start a workflow run */
  private async startRun(workflowId: number, triggeredBy: string, triggerData: Record<string, any>): Promise<number> {
    const workflow = await db.query.agentWorkflows.findFirst({
      where: eq(agentWorkflows.id, workflowId),
    });
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    const steps = (workflow.steps as any[]) || [];
    const initialResults = steps.map((s: any, i: number) => ({
      step: i,
      agentCodename: s.agentCodename,
      action: s.action,
      status: "pending" as const,
    }));

    const [run] = await db.insert(agentWorkflowRuns).values({
      workflowId,
      status: "running",
      triggeredBy,
      triggerData,
      currentStep: 0,
      stepResults: initialResults,
    }).returning({ id: agentWorkflowRuns.id });

    // Update workflow run count
    await db.update(agentWorkflows)
      .set({ totalRuns: sql`${agentWorkflows.totalRuns} + 1`, updatedAt: new Date() })
      .where(eq(agentWorkflows.id, workflowId));

    // Execute asynchronously
    this.executeRun(run.id, workflow).catch(err => {
      logger.error(`[WorkflowEngine] Run ${run.id} failed`, err);
    });

    return run.id;
  }

  /** Execute a workflow run step by step */
  private async executeRun(runId: number, workflow: AgentWorkflow): Promise<void> {
    const steps = (workflow.steps as any[]) || [];
    const stepOutputs: Record<number, any> = {};

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Update current step
      await this.updateRunStep(runId, i, "running");

      // Broadcast progress via WebSocket
      try {
        wsServer?.broadcast?.("founder:activity", "workflow_progress", {
          runId,
          workflowName: workflow.name,
          step: i,
          totalSteps: steps.length,
          agentCodename: step.agentCodename,
          action: step.action,
          status: "running",
        });
      } catch {}

      // Resolve inputs from previous steps and trigger data
      const resolvedInput = this.resolveInputMapping(step.inputMapping || {}, stepOutputs, i);

      // Record activity for the agent
      await companyAgentService.recordActivity(step.agentCodename).catch(() => {});

      const startTime = Date.now();
      try {
        const result = await executeAction({
          agentCodename: step.agentCodename,
          actionName: step.action,
          input: resolvedInput,
          triggeredBy: `workflow:${workflow.name}`,
        });

        const durationMs = Date.now() - startTime;
        stepOutputs[i] = result.metrics || { success: result.success, detail: result.detail };

        await this.updateRunStep(runId, i, "completed", stepOutputs[i], undefined, durationMs);
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const errorMsg = err.message || "Unknown error";

        if (step.failureStrategy === "abort") {
          await this.updateRunStep(runId, i, "failed", undefined, errorMsg, durationMs);
          await this.completeRun(runId, "failed");
          return;
        } else if (step.failureStrategy === "retry") {
          // One retry attempt
          try {
            const retryResult = await executeAction({
              agentCodename: step.fallbackAgent || step.agentCodename,
              actionName: step.action,
              input: resolvedInput,
              triggeredBy: `workflow:${workflow.name}:retry`,
            });
            stepOutputs[i] = retryResult.metrics || {};
            await this.updateRunStep(runId, i, "completed", stepOutputs[i], undefined, Date.now() - startTime);
          } catch {
            await this.updateRunStep(runId, i, "failed", undefined, errorMsg, durationMs);
          }
        } else {
          // skip
          await this.updateRunStep(runId, i, "skipped", undefined, errorMsg, durationMs);
        }
      }
    }

    await this.completeRun(runId, "completed");
  }

  /** Resolve step input mappings */
  private resolveInputMapping(
    mapping: Record<string, string>,
    stepOutputs: Record<number, any>,
    currentStep: number,
  ): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, source] of Object.entries(mapping)) {
      if (source.startsWith("trigger.")) {
        // Will be populated from triggerData at execution time
        resolved[key] = source;
      } else if (source.startsWith("step.")) {
        const parts = source.split(".");
        const stepNum = parseInt(parts[1], 10);
        const field = parts.slice(2).join(".");
        const output = stepOutputs[stepNum];
        if (output && field) {
          resolved[key] = output[field] ?? output;
        } else {
          resolved[key] = output;
        }
      } else {
        resolved[key] = source;
      }
    }
    return resolved;
  }

  /** Update a single step's status in a run */
  private async updateRunStep(
    runId: number,
    stepIndex: number,
    status: string,
    output?: any,
    error?: string,
    durationMs?: number,
  ): Promise<void> {
    const run = await db.query.agentWorkflowRuns.findFirst({
      where: eq(agentWorkflowRuns.id, runId),
    });
    if (!run) return;

    const results = [...((run.stepResults as any[]) || [])];
    if (results[stepIndex]) {
      results[stepIndex] = {
        ...results[stepIndex],
        status,
        output,
        error,
        durationMs,
        ...(status === "running" ? { startedAt: new Date().toISOString() } : {}),
        ...(status !== "running" && status !== "pending" ? { completedAt: new Date().toISOString() } : {}),
      };
    }

    await db.update(agentWorkflowRuns)
      .set({
        currentStep: stepIndex,
        stepResults: results,
      })
      .where(eq(agentWorkflowRuns.id, runId));
  }

  /** Mark a run as completed/failed */
  private async completeRun(runId: number, status: "completed" | "failed"): Promise<void> {
    const run = await db.query.agentWorkflowRuns.findFirst({
      where: eq(agentWorkflowRuns.id, runId),
    });
    if (!run) return;

    const durationMs = Date.now() - new Date(run.startedAt).getTime();

    await db.update(agentWorkflowRuns)
      .set({
        status,
        completedAt: new Date(),
        durationMs,
      })
      .where(eq(agentWorkflowRuns.id, runId));

    // Broadcast completion
    try {
      wsServer?.broadcast?.("founder:activity", "workflow_complete", { runId, status, durationMs });
    } catch {}
  }
}

export const workflowEngine = new WorkflowEngine();
