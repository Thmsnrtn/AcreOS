/**
 * Agent Playbooks — Sovereign Company Protocol v6
 *
 * Codified SOPs that agents propose and execute.
 * "When churn risk > 80: Step 1 Sophie reviews, Step 2 Forge offers discount, Step 3 Oracle monitors."
 *
 * Playbooks are:
 * - Proposed by agents based on patterns they observe
 * - Approved by the CEO (trust gate — approve once, execute forever)
 * - Executed automatically when trigger conditions are met
 * - Tracked for success rate and refined over time
 *
 * Think: runbooks that write themselves.
 */

import { db } from "../db";
import { agentPlaybooks, type AgentPlaybook } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { executeAction } from "./agentActionExecutors";

// ─── Built-in Playbook Templates ─────────────────────────────────────────────

const SEED_PLAYBOOKS: Array<Partial<AgentPlaybook>> = [
  {
    name: "High Churn Risk Response",
    description: "Coordinated response when a customer's churn risk exceeds 80",
    ownerAgent: "sophie_csm",
    triggerCondition: "When churn risk score > 80 for any customer",
    triggerConfig: { metric: "churn_risk_score", operator: "gt", value: 80 },
    steps: [
      { order: 0, agentCodename: "sophie_csm", action: "review_customer_history", description: "Review recent support tickets and activity" },
      { order: 1, agentCodename: "oracle_analytics", action: "analyze_usage_drop", description: "Identify which features they stopped using" },
      { order: 2, agentCodename: "forge_revenue", action: "prepare_retention_offer", description: "Prepare targeted retention offer based on usage" },
      { order: 3, agentCodename: "sophie_csm", action: "send_retention_outreach", description: "Send personalized retention email with offer", delayMs: 3600000 },
    ],
    isApproved: false,
    isActive: false,
    createdBy: "sophie_csm",
  },
  {
    name: "Failed Payment Recovery",
    description: "Graduated escalation for failed payments",
    ownerAgent: "ledger_finance",
    triggerCondition: "When a payment fails for any customer",
    triggerConfig: { event: "payment_failed" },
    steps: [
      { order: 0, agentCodename: "ledger_finance", action: "assess_payment_situation", description: "Check payment method, history, and amount" },
      { order: 1, agentCodename: "sophie_csm", action: "send_gentle_reminder", description: "Send friendly payment update notification" },
      { order: 2, agentCodename: "forge_revenue", action: "flag_revenue_risk", description: "Update revenue forecasts with at-risk amount" },
      { order: 3, agentCodename: "sophie_csm", action: "send_followup", description: "Follow up if payment still not resolved", delayMs: 86400000, condition: "payment_still_failed" },
    ],
    isApproved: false,
    isActive: false,
    createdBy: "ledger_finance",
  },
  {
    name: "New Feature Launch Rollout",
    description: "Coordinated feature launch across all teams",
    ownerAgent: "compass_pm",
    triggerCondition: "When a new feature is flagged for launch",
    triggerConfig: { event: "feature_launch" },
    steps: [
      { order: 0, agentCodename: "crucible_qa", action: "run_test_suite", description: "Run full test suite and quality gates" },
      { order: 1, agentCodename: "atlas_cto", action: "approve_deployment", description: "Technical sign-off on the release" },
      { order: 2, agentCodename: "beacon_marketing", action: "prepare_announcement", description: "Draft feature announcement and update changelog" },
      { order: 3, agentCodename: "sophie_csm", action: "update_knowledge_base", description: "Add help docs and support guides" },
      { order: 4, agentCodename: "beacon_marketing", action: "send_announcement", description: "Send announcement to customers" },
    ],
    isApproved: false,
    isActive: false,
    createdBy: "compass_pm",
  },
  {
    name: "Weekly Revenue Optimization",
    description: "Weekly review and optimization of revenue metrics",
    ownerAgent: "forge_revenue",
    triggerCondition: "Every Monday at 9 AM",
    triggerConfig: { event: "weekly_monday" },
    steps: [
      { order: 0, agentCodename: "forge_revenue", action: "weekly_revenue_report", description: "Generate comprehensive revenue analysis" },
      { order: 1, agentCodename: "oracle_analytics", action: "identify_growth_levers", description: "Find opportunities in the data" },
      { order: 2, agentCodename: "beacon_marketing", action: "optimize_campaigns", description: "Adjust campaigns based on revenue data" },
    ],
    isApproved: false,
    isActive: false,
    createdBy: "forge_revenue",
  },
];

// ─── Service ─────────────────────────────────────────────────────────────────

class PlaybookService {

  /** Seed built-in playbook templates */
  async seedPlaybooks(): Promise<void> {
    for (const template of SEED_PLAYBOOKS) {
      const existing = await db.query.agentPlaybooks.findFirst({
        where: eq(agentPlaybooks.name, template.name!),
      });
      if (!existing) {
        await db.insert(agentPlaybooks).values(template as any);
      }
    }
  }

  /** Get all playbooks */
  async getAll(): Promise<AgentPlaybook[]> {
    return db.query.agentPlaybooks.findMany({
      orderBy: [desc(agentPlaybooks.updatedAt)],
    });
  }

  /** Get active, approved playbooks */
  async getActive(): Promise<AgentPlaybook[]> {
    return db.query.agentPlaybooks.findMany({
      where: and(
        eq(agentPlaybooks.isApproved, true),
        eq(agentPlaybooks.isActive, true),
      ),
      orderBy: [desc(agentPlaybooks.updatedAt)],
    });
  }

  /** Get playbooks awaiting approval */
  async getPendingApproval(): Promise<AgentPlaybook[]> {
    return db.query.agentPlaybooks.findMany({
      where: eq(agentPlaybooks.isApproved, false),
      orderBy: [desc(agentPlaybooks.createdAt)],
    });
  }

  /** Get playbook by ID */
  async getById(id: number): Promise<AgentPlaybook | undefined> {
    return db.query.agentPlaybooks.findFirst({
      where: eq(agentPlaybooks.id, id),
    });
  }

  /** CEO approves a playbook — it becomes active */
  async approve(playbookId: number): Promise<void> {
    await db.update(agentPlaybooks)
      .set({
        isApproved: true,
        isActive: true,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentPlaybooks.id, playbookId));
  }

  /** CEO deactivates a playbook */
  async deactivate(playbookId: number): Promise<void> {
    await db.update(agentPlaybooks)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(agentPlaybooks.id, playbookId));
  }

  /** CEO reactivates a playbook */
  async activate(playbookId: number): Promise<void> {
    await db.update(agentPlaybooks)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(agentPlaybooks.id, playbookId));
  }

  /** Execute a playbook */
  async execute(playbookId: number, triggerData?: Record<string, any>): Promise<{
    success: boolean;
    stepsCompleted: number;
    totalSteps: number;
    errors: string[];
  }> {
    const playbook = await this.getById(playbookId);
    if (!playbook) return { success: false, stepsCompleted: 0, totalSteps: 0, errors: ["Playbook not found"] };
    if (!playbook.isApproved || !playbook.isActive) {
      return { success: false, stepsCompleted: 0, totalSteps: 0, errors: ["Playbook not approved or inactive"] };
    }

    const steps = (playbook.steps as any[]) || [];
    let stepsCompleted = 0;
    const errors: string[] = [];

    for (const step of steps) {
      try {
        // Optional delay before step
        if (step.delayMs && step.delayMs > 0) {
          // For real production: schedule via job queue. For now, cap at 5s for immediate execution.
          await new Promise(r => setTimeout(r, Math.min(step.delayMs, 5000)));
        }

        await executeAction({
          agentCodename: step.agentCodename,
          actionName: step.action,
          input: { ...triggerData, ...(step.params || {}) },
          triggeredBy: `playbook:${playbook.name}`,
        });

        stepsCompleted++;
        await companyAgentService.recordActivity(step.agentCodename).catch(() => {});
      } catch (err: any) {
        errors.push(`Step ${step.order} (${step.agentCodename}:${step.action}): ${err.message}`);
      }
    }

    // Update execution stats
    const totalExecutions = (playbook.totalExecutions || 0) + 1;
    const oldSuccessRate = parseFloat(String(playbook.successRate || "0"));
    const thisSuccess = errors.length === 0 ? 1 : 0;
    const newSuccessRate = ((oldSuccessRate * (totalExecutions - 1)) + thisSuccess * 100) / totalExecutions;

    await db.update(agentPlaybooks)
      .set({
        totalExecutions,
        successRate: newSuccessRate.toFixed(1),
        lastExecutedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentPlaybooks.id, playbookId));

    return {
      success: errors.length === 0,
      stepsCompleted,
      totalSteps: steps.length,
      errors,
    };
  }

  /** Check if any playbook should trigger for a given event */
  async checkTriggers(eventName: string, eventData?: Record<string, any>): Promise<void> {
    const activePlaybooks = await this.getActive();

    for (const playbook of activePlaybooks) {
      const config = playbook.triggerConfig as any;
      if (!config) continue;

      if (config.event === eventName) {
        this.execute(playbook.id, eventData).catch(() => {});
      }
    }
  }

  /** Agent proposes a new playbook based on a pattern it observed */
  async proposePlaybook(agentCodename: string, observation: string): Promise<number | null> {
    const agent = await companyAgentService.getByCodename(agentCodename);
    if (!agent) return null;

    try {
      const response = await routeAITask({
        taskType: "playbook_proposal",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `${agent.personalityPrompt}\n\nYou are proposing a new SOP (playbook) based on a pattern you've observed. The playbook should be a repeatable sequence of agent actions that can run automatically when a trigger condition is met.`,
          },
          {
            role: "user",
            content: `Based on this observation: "${observation}"

Propose a playbook in JSON:
{
  "name": "Short name for the playbook",
  "description": "What this playbook does and why",
  "triggerCondition": "Human-readable trigger description",
  "triggerConfig": { "event": "event_name" },
  "steps": [
    { "order": 0, "agentCodename": "agent", "action": "action_name", "description": "what this step does" }
  ]
}`,
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.3,
      });

      const parsed = JSON.parse(response.content);

      const [playbook] = await db.insert(agentPlaybooks).values({
        name: parsed.name,
        description: parsed.description,
        ownerAgent: agentCodename,
        triggerCondition: parsed.triggerCondition,
        triggerConfig: parsed.triggerConfig,
        steps: parsed.steps || [],
        isApproved: false,
        isActive: false,
        createdBy: agentCodename,
      }).returning({ id: agentPlaybooks.id });

      return playbook.id;
    } catch {
      return null;
    }
  }
}

export const playbookService = new PlaybookService();
