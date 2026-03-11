/**
 * Autonomous Agent Engine
 *
 * Decides whether an agent action should:
 *   - AUTO_EXECUTE  — run immediately without human review
 *   - ESCALATE      — queue for human approval before executing
 *   - DENY          — block entirely (safety guardrail)
 *
 * Autonomy is configured per-agent via the `vaAgents` table.
 * Each action carries a RiskProfile that the engine scores against
 * the org's configured autonomy level and thresholds.
 */

import { db } from "../db";
import { vaAgents, agentTasks } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutonomyLevel = "full_auto" | "supervised" | "manual";

export type ActionCategory =
  | "research"        // data lookups, due diligence — always safe
  | "draft"           // generate content but don't send — safe
  | "communication"   // send email/SMS to external parties — medium risk
  | "scheduling"      // schedule calls, follow-ups — medium risk
  | "financial"       // make or commit to financial decisions — high risk
  | "offer"           // send purchase offers — high risk
  | "contract"        // generate/sign contracts — high risk
  | "data_write"      // update CRM records — low-medium risk
  | "external_api";   // call external services — medium risk

export interface ActionRiskProfile {
  category: ActionCategory;
  /** Dollar value at stake (0 if non-financial) */
  financialImpact: number;
  /** True if action contacts external parties (leads, buyers) */
  isExternal: boolean;
  /** True if action is irreversible once taken */
  isIrreversible: boolean;
  /** Human-readable description for the approval UI */
  description: string;
  /** Entity IDs for context */
  relatedLeadId?: number;
  relatedPropertyId?: number;
  relatedDealId?: number;
}

export type AutonomyDecision = "auto_execute" | "escalate" | "deny";

export interface DecisionResult {
  decision: AutonomyDecision;
  reason: string;
  riskScore: number;        // 0–100
  autonomyLevel: AutonomyLevel;
  requiresApproval: boolean;
}

// ─── Risk Scoring ─────────────────────────────────────────────────────────────

const CATEGORY_BASE_RISK: Record<ActionCategory, number> = {
  research:    5,
  draft:       10,
  data_write:  20,
  scheduling:  25,
  external_api:30,
  communication:40,
  financial:   70,
  offer:       80,
  contract:    90,
};

function scoreRisk(profile: ActionRiskProfile): number {
  let score = CATEGORY_BASE_RISK[profile.category];

  // Boost for financial impact
  if (profile.financialImpact > 0) {
    if (profile.financialImpact >= 100_000) score += 25;
    else if (profile.financialImpact >= 10_000) score += 15;
    else if (profile.financialImpact >= 1_000) score += 8;
    else score += 3;
  }

  // Boost for external communication
  if (profile.isExternal) score += 10;

  // Boost for irreversibility
  if (profile.isIrreversible) score += 15;

  return Math.min(score, 100);
}

// ─── Thresholds by autonomy level ────────────────────────────────────────────

/**
 * If riskScore ≤ autoThreshold  → auto_execute
 * If riskScore ≤ escalateThreshold → escalate (show in approval queue)
 * Else → deny (blocked, user must initiate manually)
 */
const THRESHOLDS: Record<AutonomyLevel, { auto: number; escalate: number }> = {
  full_auto:  { auto: 85, escalate: 95 }, // auto-executes almost everything
  supervised: { auto: 25, escalate: 75 }, // auto-executes only research/drafts
  manual:     { auto: 0,  escalate: 30 }, // never auto-executes; most still escalatable
};

// ─── Engine ───────────────────────────────────────────────────────────────────

export class AutonomousAgentEngine {

  /**
   * Evaluate whether an action should be auto-executed, escalated, or denied.
   */
  async evaluate(
    organizationId: number,
    agentType: string,
    profile: ActionRiskProfile
  ): Promise<DecisionResult> {
    const level = await this.getAutonomyLevel(organizationId, agentType);
    const autoApproveCategories = await this.getAutoApproveCategories(organizationId, agentType);
    const escalateCategories = await this.getEscalateCategories(organizationId, agentType);

    const riskScore = scoreRisk(profile);
    const thresholds = THRESHOLDS[level];

    // Hard-coded escalation categories take priority
    if (escalateCategories.includes(profile.category)) {
      return {
        decision: "escalate",
        reason: `Category "${profile.category}" is configured to always require approval`,
        riskScore,
        autonomyLevel: level,
        requiresApproval: true,
      };
    }

    // Explicitly auto-approved categories
    if (autoApproveCategories.includes(profile.category)) {
      return {
        decision: "auto_execute",
        reason: `Category "${profile.category}" is in the auto-approve list`,
        riskScore,
        autonomyLevel: level,
        requiresApproval: false,
      };
    }

    // Score-based decision
    if (riskScore <= thresholds.auto) {
      return {
        decision: "auto_execute",
        reason: `Risk score ${riskScore} is within auto-execute threshold (${thresholds.auto}) for ${level} mode`,
        riskScore,
        autonomyLevel: level,
        requiresApproval: false,
      };
    }

    if (riskScore <= thresholds.escalate) {
      return {
        decision: "escalate",
        reason: `Risk score ${riskScore} requires human approval in ${level} mode`,
        riskScore,
        autonomyLevel: level,
        requiresApproval: true,
      };
    }

    return {
      decision: "deny",
      reason: `Risk score ${riskScore} exceeds maximum allowed threshold (${thresholds.escalate}) for ${level} mode`,
      riskScore,
      autonomyLevel: level,
      requiresApproval: false,
    };
  }

  /**
   * Use AI to intelligently classify an agent action into a risk profile.
   * Call this when the action type is ambiguous.
   */
  async classifyAction(
    actionDescription: string,
    agentType: string,
    parameters: Record<string, any>,
    organizationId: number
  ): Promise<ActionRiskProfile> {
    const prompt = `You are a risk assessment AI for a land investment platform.
Classify this agent action into a risk profile (respond with JSON only):

Agent: ${agentType}
Action: ${actionDescription}
Parameters: ${JSON.stringify(parameters, null, 2)}

Respond with exactly this JSON structure:
{
  "category": "<research|draft|data_write|scheduling|external_api|communication|financial|offer|contract>",
  "financialImpact": <number in USD, 0 if none>,
  "isExternal": <true|false>,
  "isIrreversible": <true|false>,
  "description": "<one sentence human-readable description for approval UI>"
}`;

    try {
      const response = await routeAITask({
        taskType: "categorize",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          { role: "system", content: "You are a risk classification assistant. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        responseFormat: "json",
        temperature: 0.1,
      });

      const parsed = JSON.parse(response.content);
      return {
        category: parsed.category || "data_write",
        financialImpact: parsed.financialImpact || 0,
        isExternal: parsed.isExternal || false,
        isIrreversible: parsed.isIrreversible || false,
        description: parsed.description || actionDescription,
      };
    } catch {
      // Fallback to conservative profile
      return {
        category: "data_write",
        financialImpact: 0,
        isExternal: false,
        isIrreversible: false,
        description: actionDescription,
      };
    }
  }

  /**
   * Generate an intelligent summary of what the agent decided to do and why.
   * Used in the approval queue and activity feed.
   */
  async generateDecisionSummary(
    agentType: string,
    action: string,
    profile: ActionRiskProfile,
    decision: DecisionResult,
    outcome?: { success: boolean; details?: string }
  ): Promise<string> {
    if (!outcome) {
      // Pre-execution summary for escalation queue
      const verb = decision.decision === "auto_execute" ? "will automatically" : "wants to";
      return `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} agent ${verb} ${profile.description}. Risk level: ${decision.riskScore}/100.`;
    }

    // Post-execution summary
    const status = outcome.success ? "successfully completed" : "failed to complete";
    return `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} agent ${status}: ${profile.description}${outcome.details ? `. ${outcome.details}` : ""}.`;
  }

  // ─── Config helpers ─────────────────────────────────────────────────────────

  private async getAgentConfig(organizationId: number, agentType: string) {
    const configs = await db
      .select()
      .from(vaAgents)
      .where(
        and(
          eq(vaAgents.organizationId, organizationId),
          eq(vaAgents.agentType, agentType),
          eq(vaAgents.isEnabled, true)
        )
      )
      .limit(1);
    return configs[0] || null;
  }

  async getAutonomyLevel(organizationId: number, agentType: string): Promise<AutonomyLevel> {
    const config = await this.getAgentConfig(organizationId, agentType);
    if (!config) return "supervised"; // safe default
    return (config.autonomyLevel as AutonomyLevel) || "supervised";
  }

  async setAutonomyLevel(
    organizationId: number,
    agentType: string,
    level: AutonomyLevel
  ): Promise<void> {
    const existing = await this.getAgentConfig(organizationId, agentType);
    if (existing) {
      await db
        .update(vaAgents)
        .set({ autonomyLevel: level, updatedAt: new Date() })
        .where(eq(vaAgents.id, existing.id));
    } else {
      await db.insert(vaAgents).values({
        organizationId,
        agentType,
        name: `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} Agent`,
        autonomyLevel: level,
        isEnabled: true,
        isActive: false,
      });
    }
  }

  private async getAutoApproveCategories(
    organizationId: number,
    agentType: string
  ): Promise<ActionCategory[]> {
    const config = await this.getAgentConfig(organizationId, agentType);
    const cfgData = config?.config as any;
    return (cfgData?.autoApproveCategories as ActionCategory[]) || [];
  }

  private async getEscalateCategories(
    organizationId: number,
    agentType: string
  ): Promise<ActionCategory[]> {
    const config = await this.getAgentConfig(organizationId, agentType);
    const cfgData = config?.config as any;
    return (cfgData?.escalateToHuman as ActionCategory[]) || [];
  }

  async updateAgentConfig(
    organizationId: number,
    agentType: string,
    updates: {
      autonomyLevel?: AutonomyLevel;
      autoApproveCategories?: ActionCategory[];
      escalateToHuman?: ActionCategory[];
      maxActionsPerDay?: number;
      notifyOnAction?: boolean;
      customInstructions?: string;
    }
  ): Promise<void> {
    const existing = await this.getAgentConfig(organizationId, agentType);
    const existingCfg = (existing?.config as any) || {};

    const newConfig = {
      ...existingCfg,
      ...(updates.autoApproveCategories !== undefined && { autoApproveCategories: updates.autoApproveCategories }),
      ...(updates.escalateToHuman !== undefined && { escalateToHuman: updates.escalateToHuman }),
      ...(updates.maxActionsPerDay !== undefined && { maxActionsPerDay: updates.maxActionsPerDay }),
      ...(updates.notifyOnAction !== undefined && { notifyOnAction: updates.notifyOnAction }),
      ...(updates.customInstructions !== undefined && { customInstructions: updates.customInstructions }),
    };

    if (existing) {
      await db
        .update(vaAgents)
        .set({
          ...(updates.autonomyLevel && { autonomyLevel: updates.autonomyLevel }),
          config: newConfig,
          updatedAt: new Date(),
        })
        .where(eq(vaAgents.id, existing.id));
    } else {
      await db.insert(vaAgents).values({
        organizationId,
        agentType,
        name: `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} Agent`,
        autonomyLevel: updates.autonomyLevel || "supervised",
        isEnabled: true,
        isActive: false,
        config: newConfig,
      });
    }
  }

  async getAgentStatus(organizationId: number, agentType: string) {
    const config = await this.getAgentConfig(organizationId, agentType);
    const cfgData = config?.config as any;

    // Count pending tasks
    const pendingTasks = await db
      .select()
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.organizationId, organizationId),
          eq(agentTasks.agentType, agentType),
          eq(agentTasks.status, "pending")
        )
      );

    const reviewTasks = pendingTasks.filter(t => t.requiresReview);

    return {
      agentType,
      name: config?.name || `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} Agent`,
      isEnabled: config?.isEnabled ?? true,
      isActive: config?.isActive ?? false,
      autonomyLevel: (config?.autonomyLevel as AutonomyLevel) || "supervised",
      lastActiveAt: config?.lastActiveAt,
      pendingTaskCount: pendingTasks.length,
      pendingApprovalCount: reviewTasks.length,
      metrics: config?.metrics || { totalActions: 0, successfulActions: 0, pendingApproval: 0, lastDayActions: 0 },
      config: {
        autoApproveCategories: cfgData?.autoApproveCategories || [],
        escalateToHuman: cfgData?.escalateToHuman || [],
        maxActionsPerDay: cfgData?.maxActionsPerDay || 50,
        notifyOnAction: cfgData?.notifyOnAction ?? true,
        customInstructions: cfgData?.customInstructions || "",
      },
    };
  }

  /** Record that an action was executed and update agent metrics. */
  async recordAction(
    organizationId: number,
    agentType: string,
    success: boolean
  ): Promise<void> {
    const config = await this.getAgentConfig(organizationId, agentType);
    if (!config) return;

    const existingMetrics = (config.metrics as any) || { totalActions: 0, successfulActions: 0, pendingApproval: 0, lastDayActions: 0 };
    await db
      .update(vaAgents)
      .set({
        lastActiveAt: new Date(),
        metrics: {
          totalActions: (existingMetrics.totalActions || 0) + 1,
          successfulActions: (existingMetrics.successfulActions || 0) + (success ? 1 : 0),
          pendingApproval: existingMetrics.pendingApproval || 0,
          lastDayActions: (existingMetrics.lastDayActions || 0) + 1,
        },
        updatedAt: new Date(),
      })
      .where(eq(vaAgents.id, config.id));
  }
}

export const autonomousAgentEngine = new AutonomousAgentEngine();
