// @ts-nocheck
/**
 * CEO Command Bridge — Sovereign Company Protocol v5
 *
 * The missing link between natural language and agent execution.
 * CEO says "pause all marketing" → Beacon pauses all active campaigns.
 * CEO says "show me what Sophie did" → queries activity log, returns summary.
 *
 * This is NOT a chat system. It's a command interpreter that maps
 * natural language to concrete system actions via AI classification.
 */

import { db } from "../db";
import {
  campaigns, organizations, agentActionLog, agentGoals,
  companyAgents, churnRiskScores,
} from "@shared/schema";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { executeAction } from "./agentActionExecutors";
import { createPriority } from "./strategicCompass";
import { setQuietHours } from "./quietHours";
import { createGoal } from "./agentGoalManager";

interface CommandResult {
  understood: boolean;
  action: string;
  result: string;
  data?: any;
}

// Command categories the AI classifier can return
type CommandCategory =
  | "pause_marketing"
  | "resume_marketing"
  | "agent_activity_summary"
  | "set_priority"
  | "set_quiet_hours"
  | "assign_goal"
  | "customer_status"
  | "financial_summary"
  | "pause_agent"
  | "resume_agent"
  | "show_forecast"
  | "show_customer_health"
  | "set_reminder"
  | "unknown";

/**
 * Process a CEO natural language command.
 * Returns structured result with what was done.
 */
export async function processCEOCommand(input: string): Promise<CommandResult> {
  // Step 1: Classify the command using AI
  const classification = await classifyCommand(input);

  // Step 2: Execute the classified command
  switch (classification.category) {
    case "pause_marketing":
      return await handlePauseMarketing(classification.params);

    case "resume_marketing":
      return await handleResumeMarketing(classification.params);

    case "agent_activity_summary":
      return await handleAgentSummary(classification.params);

    case "set_priority":
      return await handleSetPriority(classification.params);

    case "set_quiet_hours":
      return await handleSetQuietHours(classification.params);

    case "assign_goal":
      return await handleAssignGoal(classification.params);

    case "customer_status":
      return await handleCustomerStatus(classification.params);

    case "financial_summary":
      return await handleFinancialSummary();

    case "pause_agent":
      return await handlePauseAgent(classification.params);

    case "resume_agent":
      return await handleResumeAgent(classification.params);

    case "show_forecast":
      return await handleShowForecast();

    case "show_customer_health":
      return await handleShowCustomerHealth(classification.params);

    case "set_reminder":
      return await handleSetReminder(classification.params);

    default:
      return {
        understood: false,
        action: "unknown",
        result: "I didn't understand that as a command. Try something like 'pause all marketing', 'what did Sophie do this week', or 'focus on retention'.",
      };
  }
}

async function classifyCommand(input: string): Promise<{ category: CommandCategory; params: Record<string, any> }> {
  try {
    const response = await routeAITask({
      taskType: "command_classification",
      complexity: TaskComplexity.SIMPLE,
      messages: [
        {
          role: "system",
          content: `You classify CEO commands into action categories. Respond with JSON only.

Categories:
- pause_marketing: CEO wants to stop/pause campaigns. Params: { scope: "all" | campaignName }
- resume_marketing: CEO wants to restart campaigns. Params: { scope: "all" | campaignName }
- agent_activity_summary: CEO wants to know what an agent did. Params: { agent: codename, period: "today"|"week"|"month" }
- set_priority: CEO sets a company priority. Params: { priority: string, weight: 1-10 }
- set_quiet_hours: CEO wants to set notification quiet hours. Params: { startHour: number, endHour: number, isActive: boolean }
- assign_goal: CEO assigns a task to an agent. Params: { agent: codename, goal: string, priority: "low"|"medium"|"high"|"critical" }
- customer_status: CEO asks about a specific customer. Params: { customerName: string }
- financial_summary: CEO asks about finances/revenue/MRR. Params: {}
- pause_agent: CEO wants to pause an agent. Params: { agent: codename }
- resume_agent: CEO wants to resume an agent. Params: { agent: codename }
- show_forecast: CEO asks about MRR forecast, projections, runway. Params: {}
- show_customer_health: CEO asks about customer health overview. Params: { customerName?: string }
- set_reminder: CEO wants to be reminded of something. Params: { message: string, when: string }
- unknown: Can't classify. Params: {}

Agent codenames: atlas_cto, sophie_csm, forge_revenue, beacon_marketing, sentinel_devops, ledger_finance, shield_legal, oracle_analytics, compass_pm, crucible_qa

Respond: {"category": "...", "params": {...}}`,
        },
        { role: "user", content: input },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.1,
    });

    return JSON.parse(response.content);
  } catch {
    return { category: "unknown", params: {} };
  }
}

// --- Command Handlers ---

async function handlePauseMarketing(params: any): Promise<CommandResult> {
  const activeCampaigns = await db.select()
    .from(campaigns)
    .where(eq(campaigns.status, "active"))
    .limit(20);

  let paused = 0;
  for (const campaign of activeCampaigns) {
    await executeAction({
      agentCodename: "beacon_marketing",
      actionName: "pause_campaign",
      input: { campaignId: campaign.id, reason: "CEO command: pause all marketing" },
      triggeredBy: "approval",
    });
    paused++;
  }

  return {
    understood: true,
    action: "pause_marketing",
    result: paused > 0
      ? `Done. Paused ${paused} active campaign${paused > 1 ? "s" : ""}. Say "resume marketing" when you're ready to restart.`
      : "No active campaigns to pause.",
    data: { paused },
  };
}

async function handleResumeMarketing(params: any): Promise<CommandResult> {
  const pausedCampaigns = await db.select()
    .from(campaigns)
    .where(eq(campaigns.status, "paused"))
    .limit(20);

  let resumed = 0;
  for (const campaign of pausedCampaigns) {
    await db.update(campaigns)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(campaigns.id, campaign.id));
    resumed++;
  }

  return {
    understood: true,
    action: "resume_marketing",
    result: resumed > 0
      ? `Done. Resumed ${resumed} campaign${resumed > 1 ? "s" : ""}. Beacon is back in action.`
      : "No paused campaigns to resume.",
    data: { resumed },
  };
}

async function handleAgentSummary(params: any): Promise<CommandResult> {
  const agentCodename = params.agent || "sophie_csm";
  const daysBack = params.period === "month" ? 30 : params.period === "week" ? 7 : 1;
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const actions = await db.select({
    actionName: agentActionLog.actionName,
    outcome: agentActionLog.outcome,
    total: count(),
  })
    .from(agentActionLog)
    .where(and(
      eq(agentActionLog.agentCodename, agentCodename),
      gte(agentActionLog.createdAt, since),
    ))
    .groupBy(agentActionLog.actionName, agentActionLog.outcome);

  const recentDetails = await db.select()
    .from(agentActionLog)
    .where(and(
      eq(agentActionLog.agentCodename, agentCodename),
      gte(agentActionLog.createdAt, since),
    ))
    .orderBy(desc(agentActionLog.createdAt))
    .limit(10);

  const totalActions = actions.reduce((sum, a) => sum + Number(a.total), 0);
  const succeeded = actions.filter(a => a.outcome === "success").reduce((sum, a) => sum + Number(a.total), 0);

  const agentName = agentCodename.split("_")[0];
  const periodLabel = params.period === "month" ? "this month" : params.period === "week" ? "this week" : "today";

  // Use AI to summarize
  let summary: string;
  try {
    const response = await routeAITask({
      taskType: "agent_summary",
      complexity: TaskComplexity.SIMPLE,
      messages: [
        { role: "system", content: `Summarize what an AI agent did in 2-3 sentences. Be specific with numbers. Speak as if briefing a CEO.` },
        { role: "user", content: `Agent: ${agentName} (${agentCodename})\nPeriod: ${periodLabel}\nTotal actions: ${totalActions}\nSucceeded: ${succeeded}\nRecent actions:\n${recentDetails.map(d => `- ${d.actionName}: ${d.outcome}`).join("\n")}` },
      ],
      maxTokens: 100,
      temperature: 0.3,
    });
    summary = response.content;
  } catch {
    summary = `${agentName} took ${totalActions} action${totalActions !== 1 ? "s" : ""} ${periodLabel}. ${succeeded} succeeded.`;
  }

  return {
    understood: true,
    action: "agent_activity_summary",
    result: summary,
    data: { agent: agentCodename, totalActions, succeeded, period: periodLabel },
  };
}

async function handleSetPriority(params: any): Promise<CommandResult> {
  if (!params.priority) {
    return { understood: true, action: "set_priority", result: "What priority would you like to set? Try: 'focus on keeping customers happy'" };
  }

  const id = await createPriority({
    priority: params.priority,
    weight: params.weight || 7,
    setBy: "ceo",
  });

  return {
    understood: true,
    action: "set_priority",
    result: `Got it. "${params.priority}" is now a company-wide priority. All agents will factor this into their decisions.`,
    data: { priorityId: id },
  };
}

async function handleSetQuietHours(params: any): Promise<CommandResult> {
  await setQuietHours({
    startHour: params.startHour || 22,
    endHour: params.endHour || 7,
    isActive: params.isActive !== false,
  });

  return {
    understood: true,
    action: "set_quiet_hours",
    result: `Quiet hours set: ${params.startHour || 22}:00 to ${params.endHour || 7}:00. No notifications during this window unless there's an emergency.`,
  };
}

async function handleAssignGoal(params: any): Promise<CommandResult> {
  if (!params.agent || !params.goal) {
    return { understood: true, action: "assign_goal", result: "Please specify an agent and goal. Example: 'Tell Sophie to check in with all at-risk customers'" };
  }

  try {
    const goalId = await createGoal({
      assignedAgent: params.agent,
      assignedBy: "ceo",
      goal: params.goal,
      priority: params.priority || "medium",
    });

    const agentName = params.agent.split("_")[0];
    return {
      understood: true,
      action: "assign_goal",
      result: `Assigned to ${agentName}: "${params.goal}". They're working on it now.`,
      data: { goalId },
    };
  } catch (err: any) {
    return { understood: true, action: "assign_goal", result: `Couldn't assign goal: ${err.message}` };
  }
}

async function handleCustomerStatus(params: any): Promise<CommandResult> {
  if (!params.customerName) {
    return { understood: true, action: "customer_status", result: "Which customer? Try: 'How is Acme Corp doing?'" };
  }

  const org = await db.query.organizations.findFirst({
    where: sql`lower(${organizations.name}) LIKE lower(${"%" + params.customerName + "%"})`,
  });

  if (!org) {
    return { understood: true, action: "customer_status", result: `Couldn't find a customer matching "${params.customerName}".` };
  }

  // Get churn risk
  const risk = await db.select()
    .from(churnRiskScores)
    .where(eq(churnRiskScores.orgId, org.id))
    .orderBy(desc(churnRiskScores.calculatedAt))
    .limit(1);

  const riskScore = risk[0]?.riskScore || "unknown";
  const lastLogin = org.lastLoginAt ? new Date(org.lastLoginAt).toLocaleDateString() : "never";

  return {
    understood: true,
    action: "customer_status",
    result: `${org.name}: Churn risk ${riskScore}/100. Last login: ${lastLogin}. Plan: ${org.plan || "unknown"}.`,
    data: { orgId: org.id, name: org.name, riskScore, lastLogin },
  };
}

async function handleFinancialSummary(): Promise<CommandResult> {
  const { resolveAgentData } = await import("./agentDataResolvers");
  const forgeData = await resolveAgentData("forge_revenue").catch(() => ({}));
  const ledgerData = await resolveAgentData("ledger_finance").catch(() => ({}));

  const mrrDollars = ((forgeData as any).mrrCents || 0) / 100;
  const mrrGrowth = (forgeData as any).mrrGrowthPct || 0;
  const aiSpend = (ledgerData as any).aiSpend7dDollars || "unknown";
  const atRisk = (forgeData as any).criticalChurnOrgs || 0;

  return {
    understood: true,
    action: "financial_summary",
    result: `MRR: $${mrrDollars.toLocaleString()}${mrrGrowth ? ` (${mrrGrowth > 0 ? "+" : ""}${mrrGrowth.toFixed(1)}% growth)` : ""}. AI spend this week: $${aiSpend}. At-risk accounts: ${atRisk}.`,
    data: { mrrDollars, mrrGrowth, aiSpend, atRisk },
  };
}

async function handlePauseAgent(params: any): Promise<CommandResult> {
  if (!params.agent) return { understood: true, action: "pause_agent", result: "Which agent? Try: 'pause Beacon'" };

  const { companyAgentService } = await import("./companyAgents");
  await companyAgentService.setStatus(params.agent, "paused");
  const name = params.agent.split("_")[0];

  return {
    understood: true,
    action: "pause_agent",
    result: `${name} is paused. They won't take any actions until you say "resume ${name}".`,
  };
}

async function handleResumeAgent(params: any): Promise<CommandResult> {
  if (!params.agent) return { understood: true, action: "resume_agent", result: "Which agent? Try: 'resume Beacon'" };

  const { companyAgentService } = await import("./companyAgents");
  await companyAgentService.setStatus(params.agent, "active");
  const name = params.agent.split("_")[0];

  return {
    understood: true,
    action: "resume_agent",
    result: `${name} is back online and ready to work.`,
  };
}

async function handleShowForecast(): Promise<CommandResult> {
  const { projectMRR, calculateRunway, calculateUnitEconomics } = await import("./financialForecaster");
  const [mrr, runway, unit] = await Promise.all([
    projectMRR(),
    calculateRunway(),
    calculateUnitEconomics(),
  ]);

  const lines = [
    `Current MRR: $${mrr.currentMRR.toLocaleString()} (${mrr.growthRatePct > 0 ? "+" : ""}${mrr.growthRatePct}% monthly growth)`,
    "",
    "Projections:",
    ...mrr.projections.slice(0, 3).map(p => `  ${p.month}: $${p.projected.toLocaleString()} ($${p.low.toLocaleString()} - $${p.high.toLocaleString()})`),
  ];

  if (mrr.milestones.length > 0) {
    lines.push("", "Milestones:");
    for (const m of mrr.milestones.slice(0, 3)) {
      lines.push(`  $${m.target.toLocaleString()}: ${m.estimatedDate || "Not on current trajectory"} (${m.confidence} confidence)`);
    }
  }

  lines.push("", runway.recommendation, "", unit.summary);

  return {
    understood: true,
    action: "show_forecast",
    result: lines.join("\n"),
    data: { mrr, runway, unitEconomics: unit },
  };
}

async function handleShowCustomerHealth(params: any): Promise<CommandResult> {
  if (params.customerName) {
    // Single customer lookup (reuse handleCustomerStatus logic)
    return handleCustomerStatus(params);
  }

  const { getHealthSummary, getAllCustomerHealth } = await import("./customerHealthScoring");
  const [summary, customers] = await Promise.all([
    getHealthSummary(),
    getAllCustomerHealth(10),
  ]);

  const lines = [summary.summary, ""];

  if (customers.length > 0) {
    lines.push("Top concerns:");
    for (const c of customers.slice(0, 5)) {
      const trendIcon = c.trend === "improving" ? "+" : c.trend === "declining" ? "-" : "=";
      lines.push(`  ${trendIcon} ${c.orgName}: ${c.healthScore}/100 (${c.trend}) — ${c.details.plan}, last login ${c.details.daysSinceLastLogin}d ago`);
    }
  }

  return {
    understood: true,
    action: "show_customer_health",
    result: lines.join("\n"),
    data: { summary, topCustomers: customers.slice(0, 5) },
  };
}

async function handleSetReminder(params: any): Promise<CommandResult> {
  if (!params.message) {
    return { understood: true, action: "set_reminder", result: "What should I remind you about? Try: 'remind me to check on Acme Corp Tuesday'" };
  }

  const { createReminder, parseRelativeDate } = await import("./ceoReminders");
  const dueDate = parseRelativeDate(params.when || "tomorrow");

  const reminder = await createReminder({
    message: params.message,
    dueDate,
  });

  const dateStr = dueDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return {
    understood: true,
    action: "set_reminder",
    result: `Got it. I'll remind you: "${params.message}" on ${dateStr}.`,
    data: { reminderId: reminder.id, dueDate: dueDate.toISOString() },
  };
}
