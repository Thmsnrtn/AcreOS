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
  // v6: Self-Running Company
  | "activate_absence"
  | "deactivate_absence"
  | "convene_war_room"
  | "run_workflow"
  | "generate_reviews"
  | "show_initiatives"
  // v7: The Learning Company
  | "what_if"
  | "draft_communication"
  | "show_focus"
  | "discover_patterns"
  | "show_autopilot"
  // v8: The Living Organization
  | "switch_mode"
  | "start_debate"
  | "check_wellbeing"
  | "write_chronicle"
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

    // v6: Self-Running Company commands
    case "activate_absence":
      return await handleActivateAbsence(classification.params);

    case "deactivate_absence":
      return await handleDeactivateAbsence();

    case "convene_war_room":
      return await handleConveneWarRoom(classification.params);

    case "run_workflow":
      return await handleRunWorkflow(classification.params);

    case "generate_reviews":
      return await handleGenerateReviews();

    case "show_initiatives":
      return await handleShowInitiatives();

    // v7: The Learning Company commands
    case "what_if":
      return await handleWhatIf(classification.params);

    case "draft_communication":
      return await handleDraftCommunication(classification.params);

    case "show_focus":
      return await handleShowFocus();

    case "discover_patterns":
      return await handleDiscoverPatterns();

    case "show_autopilot":
      return await handleShowAutopilot();

    // v8: The Living Organization commands
    case "switch_mode":
      return await handleSwitchMode(classification.params);

    case "start_debate":
      return await handleStartDebate(classification.params);

    case "check_wellbeing":
      return await handleCheckWellbeing();

    case "write_chronicle":
      return await handleWriteChronicle(classification.params);

    default:
      return {
        understood: false,
        action: "unknown",
        result: "I didn't understand that as a command. Try 'switch to growth mode', 'debate: should we raise prices?', 'how am I doing?', 'write this week's chronicle', or 'what if we hire 3 engineers?'.",
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
- activate_absence: CEO is going away/offline/vacation. Params: { durationHours: number }
- deactivate_absence: CEO is back/returned. Params: {}
- convene_war_room: CEO wants to start a war room for a critical issue. Params: { event: string, description: string }
- run_workflow: CEO wants to trigger a workflow/pipeline. Params: { workflowName: string }
- generate_reviews: CEO wants to run performance reviews for agents. Params: {}
- show_initiatives: CEO wants to see agent initiative proposals. Params: {}
- what_if: CEO asks "what if" scenario question. Params: { hypothesis: string }
- draft_communication: CEO wants to draft investor update, board report, customer response, team announcement. Params: { draftType: "investor_update"|"board_report"|"customer_response"|"team_announcement", topic?: string }
- show_focus: CEO asks where to focus, what matters today. Params: {}
- discover_patterns: CEO wants to analyze/discover operational patterns. Params: {}
- show_autopilot: CEO asks about decision autopilot status. Params: {}
- switch_mode: CEO wants to switch company mode/season (growth, efficiency, crisis, exploration). Params: { mode: string, reason?: string }
- start_debate: CEO wants agents to debate a proposition before deciding. Params: { proposition: string }
- check_wellbeing: CEO asks about their own wellbeing/energy/stress/how they're doing. Params: {}
- write_chronicle: CEO wants to generate company chronicle/history. Params: { periodType: "week"|"month"|"quarter" }
- unknown: Can't classify. Params: {}

Agent codenames: atlas_cto, sophie_csm, forge_revenue, beacon_marketing, sentinel_devops, ledger_finance, shield_legal, oracle_analytics, compass_pm, crucible_qa

Respond: {"category": "...", "params": {...}}`,
        },
        { role: "user", content: input },
      ],
      responseFormat: "json",
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
        { role: "system", content: `Summarize what an AI agent did in 2-3 sentences. Be specific with numbers. Speak as if briefing the CEO of a land investment platform.` },
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
    .where(eq(churnRiskScores.organizationId, org.id))
    .orderBy(desc(churnRiskScores.scoredAt))
    .limit(1);

  const riskScore = risk[0]?.riskScore || "unknown";
  // Uses the churn score's precomputed daysSinceLastActive (ultimately derived
  // from organizations.lastActiveAt, stamped by the getOrCreateOrg heartbeat).
  const daysSinceActive = risk[0]?.daysSinceLastActive;
  const lastLogin = daysSinceActive != null ? `${daysSinceActive}d ago` : "never";

  return {
    understood: true,
    action: "customer_status",
    result: `${org.name}: Churn risk ${riskScore}/100. Last login: ${lastLogin}. Plan: ${org.subscriptionTier || "unknown"}.`,
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

// ─── v6: Self-Running Company Command Handlers ──────────────────────────────

async function handleActivateAbsence(params: any): Promise<CommandResult> {
  const { ceoAbsenceService } = await import("./ceoAbsenceMode");
  const hours = params.durationHours || 72;

  const id = await ceoAbsenceService.activate({ durationHours: hours });
  const days = Math.round(hours / 24);

  return {
    understood: true,
    action: "activate_absence",
    result: `Absence mode activated for ${days} day${days !== 1 ? "s" : ""}. Your AI team is running things autonomously. Trust scores boosted. Only emergencies will break through. Say "I'm back" when you return.`,
    data: { absenceId: id, durationHours: hours },
  };
}

async function handleDeactivateAbsence(): Promise<CommandResult> {
  const { ceoAbsenceService } = await import("./ceoAbsenceMode");
  const briefing = await ceoAbsenceService.deactivate();

  return {
    understood: true,
    action: "deactivate_absence",
    result: briefing
      ? `Welcome back! Here's your return briefing:\n\n${briefing}`
      : "Welcome back! Absence mode wasn't active, but you're all set.",
    data: { returnBriefing: briefing },
  };
}

async function handleConveneWarRoom(params: any): Promise<CommandResult> {
  const { warRoomService } = await import("./warRoomService");

  const event = params.event || "ceo_initiated";
  const roomId = await warRoomService.convene(event, {
    description: params.description || "CEO-initiated war room",
    initiatedBy: "ceo",
  });

  if (!roomId) {
    // If no matching rule, create a generic critical war room
    const { db } = await import("../db");
    const { warRooms } = await import("@shared/schema");
    const [room] = await db.insert(warRooms).values({
      title: params.description || "CEO-Initiated War Room",
      severity: "high",
      triggerEvent: "ceo_initiated",
      triggerData: params,
      participants: ["atlas_cto", "sophie_csm", "forge_revenue", "sentinel_devops"],
      leadAgent: "atlas_cto",
      status: "active",
    }).returning({ id: warRooms.id });

    return {
      understood: true,
      action: "convene_war_room",
      result: `War room opened. Atlas is leading, with Sophie, Forge, and Sentinel joining. Check the dashboard for real-time updates.`,
      data: { roomId: room.id },
    };
  }

  return {
    understood: true,
    action: "convene_war_room",
    result: `War room convened. Agents are gathering and analyzing the situation. Check the dashboard for real-time updates.`,
    data: { roomId },
  };
}

async function handleRunWorkflow(params: any): Promise<CommandResult> {
  const { workflowEngine } = await import("./agentWorkflowEngine");
  const workflows = await workflowEngine.getAll();

  if (params.workflowName) {
    const match = workflows.find(w =>
      w.name.toLowerCase().includes(params.workflowName.toLowerCase())
    );
    if (match) {
      const runId = await workflowEngine.triggerManual(match.id);
      return {
        understood: true,
        action: "run_workflow",
        result: `Running "${match.name}" pipeline (${match.steps?.length || 0} steps). Watch progress on the dashboard.`,
        data: { runId, workflowId: match.id },
      };
    }
  }

  const names = workflows.map(w => w.name).join(", ");
  return {
    understood: true,
    action: "run_workflow",
    result: `Available pipelines: ${names || "None configured yet"}. Which one should I run?`,
  };
}

async function handleGenerateReviews(): Promise<CommandResult> {
  const { performanceReviewService } = await import("./agentPerformanceReviews");
  const ids = await performanceReviewService.generateAllReviews();

  return {
    understood: true,
    action: "generate_reviews",
    result: `Generated ${ids.length} performance review${ids.length !== 1 ? "s" : ""}. Check the Performance Reviews section on the dashboard.`,
    data: { reviewIds: ids },
  };
}

async function handleShowInitiatives(): Promise<CommandResult> {
  const { agentInitiativeService } = await import("./agentInitiatives");
  const pending = await agentInitiativeService.getPending();

  if (pending.length === 0) {
    return {
      understood: true,
      action: "show_initiatives",
      result: "No pending initiative proposals from your agents. They'll pitch ideas when they spot opportunities.",
    };
  }

  const lines = pending.map((i: any) =>
    `- ${i.title} (proposed by ${i.proposedBy.split("_")[0]}): ${i.thesis?.slice(0, 100)}...`
  );

  return {
    understood: true,
    action: "show_initiatives",
    result: `${pending.length} initiative${pending.length !== 1 ? "s" : ""} waiting for your decision:\n\n${lines.join("\n")}\n\nReview them on the dashboard to approve, reject, or shelve.`,
    data: { count: pending.length, initiatives: pending },
  };
}

// ─── v7: The Learning Company Command Handlers ─────────────────────────────

async function handleWhatIf(params: any): Promise<CommandResult> {
  const { scenarioEngineService } = await import("./scenarioEngine");

  if (!params.hypothesis) {
    return {
      understood: true,
      action: "what_if",
      result: "What scenario do you want to explore? Try: 'what if we raise prices 20%?' or 'what if we hire 3 engineers?'",
    };
  }

  const id = await scenarioEngineService.simulate(params.hypothesis);

  return {
    understood: true,
    action: "what_if",
    result: `Running simulation: "${params.hypothesis}"\n\nYour AI team is analyzing this from every angle — revenue, churn, operations, legal. Check the Scenario Engine on the dashboard for real-time results.`,
    data: { simulationId: id },
  };
}

async function handleDraftCommunication(params: any): Promise<CommandResult> {
  const { founderTwinService } = await import("./founderTwin");

  const draftType = params.draftType || "investor_update";
  const id = await founderTwinService.generateDraft({
    draftType,
    topic: params.topic,
  });

  const typeLabels: Record<string, string> = {
    investor_update: "investor update",
    board_report: "board report",
    customer_response: "customer response",
    team_announcement: "team announcement",
  };

  return {
    understood: true,
    action: "draft_communication",
    result: `Drafting your ${typeLabels[draftType] || draftType} now. Your Digital Twin is pulling live data from your AI team and writing in your voice. Check the dashboard to review and edit.`,
    data: { draftId: id },
  };
}

async function handleShowFocus(): Promise<CommandResult> {
  const { attentionOptimizerService } = await import("./attentionOptimizer");
  const focusCard = await attentionOptimizerService.generateFocusCard();

  return {
    understood: true,
    action: "show_focus",
    result: focusCard,
  };
}

async function handleDiscoverPatterns(): Promise<CommandResult> {
  const { institutionalMemoryService } = await import("./institutionalMemory");
  const discovered = await institutionalMemoryService.discoverPatterns();

  return {
    understood: true,
    action: "discover_patterns",
    result: discovered > 0
      ? `Discovered ${discovered} new operational pattern${discovered !== 1 ? "s" : ""}. These will compound over time as agents execute them. Check Institutional Memory on the dashboard.`
      : "No new patterns discovered this time. The system learns from every agent action — patterns emerge naturally over time.",
    data: { discovered },
  };
}

async function handleShowAutopilot(): Promise<CommandResult> {
  const { decisionAutopilotService } = await import("./decisionAutopilot");
  const stats = await decisionAutopilotService.getAccuracyStats();
  const suggestions = await decisionAutopilotService.getSuggestions();

  const lines = [
    `Decision Autopilot Status:`,
    `- ${stats.totalPatterns} decision patterns tracked`,
    `- ${stats.activeAutopilots} on autopilot`,
    `- ${stats.overallAccuracy}% shadow prediction accuracy`,
  ];

  if (suggestions.length > 0) {
    lines.push(`\n${suggestions.length} pattern${suggestions.length !== 1 ? "s" : ""} ready to go on autopilot:`);
    for (const s of suggestions.slice(0, 3)) {
      lines.push(`  - ${s.description} (${Math.round(Number(s.predictionConfidence || 0) * 100)}% confidence)`);
    }
    lines.push(`\nEnable them on the dashboard.`);
  }

  return {
    understood: true,
    action: "show_autopilot",
    result: lines.join("\n"),
    data: { stats, suggestions: suggestions.length },
  };
}

// ─── v8: The Living Organization Command Handlers ───────────────────────────

async function handleSwitchMode(params: any): Promise<CommandResult> {
  const { strategicCompassV8Service } = await import("./strategicCompassV8");
  const { companySeasonService } = await import("./companySeasons");

  const mode = params.mode || "balanced";
  const validModes = ["growth", "efficiency", "crisis", "exploration", "balanced"];

  if (!validModes.includes(mode)) {
    return {
      understood: true,
      action: "switch_mode",
      result: `Available modes: ${validModes.join(", ")}. Which one?`,
    };
  }

  await strategicCompassV8Service.switchMode(mode, params.reason);
  await companySeasonService.activate(mode, params.reason);

  const modeDescriptions: Record<string, string> = {
    growth: "Revenue over efficiency. Aggressive acquisition. Ship fast.",
    efficiency: "Margin over growth. Tighten budgets. Retain and expand.",
    crisis: "Survive. Protect cash. Maximum agent autonomy for speed.",
    exploration: "Experiment boldly. Failure is data. Find the next big thing.",
    balanced: "Steady growth. Healthy margins. Sustainable pace.",
  };

  return {
    understood: true,
    action: "switch_mode",
    result: `Switched to **${mode}** mode. ${modeDescriptions[mode] || ""}\n\nAll agent risk tolerances, spend authorities, approval thresholds, and focus areas have been adjusted. The entire organization is now aligned.`,
    data: { mode },
  };
}

async function handleStartDebate(params: any): Promise<CommandResult> {
  const { agentDebateService } = await import("./agentDebates");

  if (!params.proposition) {
    return {
      understood: true,
      action: "start_debate",
      result: "What should your agents debate? Try: 'debate: should we build a mobile app?' or 'debate: should we raise prices?'",
    };
  }

  const id = await agentDebateService.initiate(params.proposition);

  return {
    understood: true,
    action: "start_debate",
    result: `Debate initiated: "${params.proposition}"\n\nAgents are preparing opening arguments, rebuttals, and final votes. Check the Debate Panel on the dashboard when they're ready for your decision.`,
    data: { debateId: id },
  };
}

async function handleCheckWellbeing(): Promise<CommandResult> {
  const { founderWellbeingService } = await import("./founderWellbeing");
  await founderWellbeingService.assess();
  const latest = await founderWellbeingService.getLatest();

  if (!latest) {
    return { understood: true, action: "check_wellbeing", result: "No wellbeing data available yet." };
  }

  const metrics = latest.metrics as any;
  const insights = (latest.insights as any[]) || [];
  const energyScore = latest.energyScore || 50;

  const lines = [`Your energy score: ${energyScore}/100`];
  for (const insight of insights) {
    const prefix = insight.type === "celebration" ? "🎉" : insight.type === "warning" ? "⚠️" : insight.type === "milestone" ? "🏆" : "💡";
    lines.push(`${prefix} ${insight.message}`);
  }

  return {
    understood: true,
    action: "check_wellbeing",
    result: lines.join("\n\n"),
    data: { energyScore, insights: insights.length },
  };
}

async function handleWriteChronicle(params: any): Promise<CommandResult> {
  const { companyChronicleService } = await import("./companyChronicle");
  const periodType = params.periodType || "week";
  const id = await companyChronicleService.generateEntry(periodType);

  return {
    understood: true,
    action: "write_chronicle",
    result: `Generated ${periodType}ly chronicle entry. It captures the narrative of what happened, key highlights, and lessons learned. Check the Company Chronicle on the dashboard.`,
    data: { entryId: id },
  };
}
