/**
 * Self-Assessment Agent
 *
 * Runs weekly (Sunday 3am) via the cron scheduler.
 * Uses Claude Opus via OpenRouter to identify capability gaps, generate structured
 * improvement proposals stored in `agentTasks`, and monitor the AI / proptech
 * landscape via a Technology Watch sub-function.
 */

import OpenAI from "openai";
import { db } from "../db";
import {
  agentTasks,
  aiMessages,
  agentRuns,
  paxCrossOrgLearnings,
} from "@shared/schema";
import { eq, desc, gte, sql, and, lt } from "drizzle-orm";
import { logger } from "../utils/logger";
import { MODELS } from "./models";

// ---------------------------------------------------------------------------
// OpenRouter client (Claude Opus for deep analysis, DeepSeek for cheap tasks)
// ---------------------------------------------------------------------------
const openrouterClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY!,
  baseURL:
    process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL ||
    "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://acreos.fly.dev",
    "X-Title": "AcreOS",
  },
});

const ASSESSMENT_MODEL = MODELS.OPUS;
const CHEAP_MODEL = MODELS.DEEPSEEK_CHAT;

// System org ID used for platform-wide agent tasks that are not tied to a
// specific customer organisation. org 1 is the founder / system org.
const SYSTEM_ORG_ID = 1;

const log = (msg: string, meta?: Record<string, unknown>) =>
  logger.info(JSON.stringify({
      level: "INFO",
      timestamp: new Date().toISOString(),
      source: "[self-assessment]",
      message: msg,
      ...meta,
    }));

const logError = (msg: string, meta?: Record<string, unknown>) =>
  logger.error(JSON.stringify({
      level: "ERROR",
      timestamp: new Date().toISOString(),
      source: "[self-assessment]",
      message: msg,
      ...meta,
    }));

// ---------------------------------------------------------------------------
// analyzeToolFailures
// ---------------------------------------------------------------------------

/**
 * Scans recent AI message failures and failed agent tasks, then asks Claude
 * Opus to identify the top 3 capability gaps and generate structured fix
 * proposals, which are stored as `agentTasks` rows.
 *
 * @returns The number of proposals created.
 */
export async function analyzeToolFailures(): Promise<number> {
  log("analyzeToolFailures — starting");

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Recent AI messages containing failure phrases
  const failureMessages = await db
    .select({
      id: aiMessages.id,
      content: aiMessages.content,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(
      and(
        gte(aiMessages.createdAt, thirtyDaysAgo),
        sql`(
          lower(${aiMessages.content}) like '%i can''t%'
          or lower(${aiMessages.content}) like '%i don''t have access%'
          or lower(${aiMessages.content}) like '%i''m unable%'
          or lower(${aiMessages.content}) like '%not available%'
        )`
      )
    )
    .orderBy(desc(aiMessages.createdAt))
    .limit(200);

  // 2. Failed agent tasks from the last 30 days
  const failedTasks = await db
    .select({
      id: agentTasks.id,
      agentType: agentTasks.agentType,
      error: agentTasks.error,
      input: agentTasks.input,
      createdAt: agentTasks.createdAt,
    })
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.status, "failed"),
        gte(agentTasks.createdAt, thirtyDaysAgo)
      )
    )
    .orderBy(desc(agentTasks.createdAt))
    .limit(50);

  log("analyzeToolFailures — data collected", {
    failureMessageCount: failureMessages.length,
    failedTaskCount: failedTasks.length,
  });

  // 3. Build Claude Opus prompt
  const messageSnippets = failureMessages
    .slice(0, 40)
    .map((m) => `[msg ${m.id}] ${String(m.content).slice(0, 200)}`)
    .join("\n");

  const taskSnippets = failedTasks
    .map(
      (t) =>
        `[task ${t.id}] type=${t.agentType} error=${String(t.error ?? "").slice(0, 150)}`
    )
    .join("\n");

  const prompt = `You are analyzing an AI assistant for a land investing platform.

## Failure messages from AI conversations (last 30 days, sample)
${messageSnippets || "(none)"}

## Failed background agent tasks (last 30 days)
${taskSnippets || "(none)"}

Based on these failure patterns, identify the top 3 capability gaps and for each propose a specific code fix.

Return a JSON array only — no prose, no markdown fences:
[
  {
    "category": "string — e.g. 'missing_tool', 'data_access', 'integration'",
    "description": "string — what is failing and why",
    "proposedFix": "string — concrete code change description",
    "estimatedImpact": "high" | "medium" | "low",
    "targetFile": "string — e.g. 'server/ai/tools.ts'",
    "codeLocation": "string — function or section within the file"
  }
]`;

  let rawContent = "";
  try {
    const completion = await openrouterClient.chat.completions.create({
      model: ASSESSMENT_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    });
    rawContent = completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    logError("analyzeToolFailures — OpenRouter call failed", {
      error: String(err),
    });
    return 0;
  }

  // 4. Parse proposals
  let proposals: Array<{
    category: string;
    description: string;
    proposedFix: string;
    estimatedImpact: "high" | "medium" | "low";
    targetFile: string;
    codeLocation: string;
  }> = [];

  try {
    // Strip markdown fences if the model added them despite instructions
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    proposals = JSON.parse(cleaned);
    if (!Array.isArray(proposals)) proposals = [];
  } catch (err) {
    logError("analyzeToolFailures — failed to parse JSON response", {
      raw: rawContent.slice(0, 500),
      error: String(err),
    });
    return 0;
  }

  // 5. Insert each proposal as an agentTask
  let created = 0;
  for (const proposal of proposals) {
    try {
      await db.insert(agentTasks).values({
        organizationId: SYSTEM_ORG_ID,
        agentType: "self_assessment",
        status: "pending",
        priority: 1,
        input: {
          source: "tool_failure_analysis",
          rawData: {
            failureMessageSample: failureMessages
              .slice(0, 10)
              .map((m) => ({ id: m.id, snippet: String(m.content).slice(0, 200) })),
            failedTaskSample: failedTasks
              .slice(0, 10)
              .map((t) => ({ id: t.id, agentType: t.agentType, error: t.error })),
          },
        },
        output: {
          category: proposal.category,
          description: proposal.description,
          proposedFix: proposal.proposedFix,
          estimatedImpact: proposal.estimatedImpact,
          targetFile: proposal.targetFile,
          codeLocation: proposal.codeLocation,
        },
      });
      created++;
      log("analyzeToolFailures — proposal created", {
        category: proposal.category,
        targetFile: proposal.targetFile,
        estimatedImpact: proposal.estimatedImpact,
      });
    } catch (insertErr) {
      logError("analyzeToolFailures — failed to insert proposal", {
        error: String(insertErr),
        category: proposal.category,
      });
    }
  }

  log("analyzeToolFailures — done", { proposalsCreated: created });
  return created;
}

// ---------------------------------------------------------------------------
// analyzeSystemHealth
// ---------------------------------------------------------------------------

/**
 * Reviews all background agent runs for error conditions and creates critical
 * priority agentTasks for any agent with more than 5 errors.
 *
 * @returns A health summary object.
 */
export async function analyzeSystemHealth(): Promise<{
  totalAgents: number;
  unhealthyAgents: number;
  criticalAgents: number;
  criticalTasksCreated: number;
  agents: Array<{ name: string; errorCount: number; lastError: string | null; severity: string }>;
}> {
  log("analyzeSystemHealth — starting");

  // 1. All agent runs that have at least one error
  const unhealthyRuns = await db
    .select()
    .from(agentRuns)
    .where(sql`${agentRuns.errorCount} > 0`);

  const allRuns = await db.select().from(agentRuns);

  log("analyzeSystemHealth — data collected", {
    totalAgents: allRuns.length,
    unhealthyAgents: unhealthyRuns.length,
  });

  // 2. Flag critical agents (errorCount > 5)
  const criticalRuns = unhealthyRuns.filter((r) => (r.errorCount ?? 0) > 5);
  let criticalTasksCreated = 0;

  for (const run of criticalRuns) {
    try {
      await db.insert(agentTasks).values({
        organizationId: SYSTEM_ORG_ID,
        agentType: "self_assessment",
        status: "pending",
        priority: 0, // critical
        input: {
          source: "system_health_check",
          agentName: run.agentName,
          errorCount: run.errorCount,
          lastError: run.lastError,
          lastRunAt: run.lastRunAt?.toISOString() ?? null,
        },
        output: {
          alert: `Agent '${run.agentName}' has ${run.errorCount} errors and requires immediate attention.`,
          recommendation: "Investigate logs, check downstream dependencies, and consider disabling until fixed.",
        },
      });
      criticalTasksCreated++;
      log("analyzeSystemHealth — critical agent flagged", {
        agentName: run.agentName,
        errorCount: run.errorCount,
      });
    } catch (insertErr) {
      logError("analyzeSystemHealth — failed to insert critical task", {
        agentName: run.agentName,
        error: String(insertErr),
      });
    }
  }

  const summary = {
    totalAgents: allRuns.length,
    unhealthyAgents: unhealthyRuns.length,
    criticalAgents: criticalRuns.length,
    criticalTasksCreated,
    agents: unhealthyRuns.map((r) => ({
      name: r.agentName,
      errorCount: r.errorCount ?? 0,
      lastError: r.lastError ?? null,
      severity: (r.errorCount ?? 0) > 5 ? "critical" : "warning",
    })),
  };

  log("analyzeSystemHealth — done", summary);
  return summary;
}

// ---------------------------------------------------------------------------
// watchTechnology
// ---------------------------------------------------------------------------

/**
 * Asks Claude Opus to surface the 5 most impactful AI / proptech developments
 * in the last 30 days and stores the results in `paxCrossOrgLearnings`.
 *
 * Note: The actual paxCrossOrgLearnings schema stores learnings as issue
 * pattern / resolution pairs.  Technology watch opportunities are mapped to
 * that schema so they are queryable alongside other platform-wide learnings.
 *
 * @returns The opportunities array returned by the model.
 */
export async function watchTechnology(): Promise<
  Array<{
    topic: string;
    description: string;
    relevanceToAcreOS: string;
    suggestedIntegration: string;
    priority: "high" | "medium" | "low";
  }>
> {
  log("watchTechnology — starting");

  const platformDescription = `AcreOS is a land investing SaaS platform.  Core capabilities:
- AI-powered CRM for land acquisition leads
- Deal pipeline and seller financing management
- Direct mail campaign orchestration
- Parcel research and mapping (ArcGIS, county assessors)
- AI virtual assistants (executive, sales, acquisitions)
- Market intelligence and comp analysis
- Seller intent prediction and lead scoring`;

  const prompt = `${platformDescription}

You are monitoring the AI and proptech landscape for AcreOS, a land investing platform.
What are the 5 most impactful developments in AI models, land real estate data APIs, proptech tools, or automation capabilities in the past 30 days that would improve this platform?

For each, provide:
{
  "topic": "string",
  "description": "string",
  "relevanceToAcreOS": "string",
  "suggestedIntegration": "string",
  "priority": "high" | "medium" | "low"
}

Return a JSON array only — no prose, no markdown fences.`;

  let rawContent = "";
  try {
    const completion = await openrouterClient.chat.completions.create({
      model: ASSESSMENT_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
    });
    rawContent = completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    logError("watchTechnology — OpenRouter call failed", {
      error: String(err),
    });
    return [];
  }

  let opportunities: Array<{
    topic: string;
    description: string;
    relevanceToAcreOS: string;
    suggestedIntegration: string;
    priority: "high" | "medium" | "low";
  }> = [];

  try {
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    opportunities = JSON.parse(cleaned);
    if (!Array.isArray(opportunities)) opportunities = [];
  } catch (err) {
    logError("watchTechnology — failed to parse JSON response", {
      raw: rawContent.slice(0, 500),
      error: String(err),
    });
    return [];
  }

  // Store results in paxCrossOrgLearnings, one row per opportunity.
  // The schema stores generalizable learnings; we map tech-watch items to the
  // closest semantic fit so they are discoverable alongside other learnings.
  const dateString = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  for (const opp of opportunities) {
    try {
      await db.insert(paxCrossOrgLearnings).values({
        issuePattern: `tech_watch_${dateString}_${opp.topic
          .toLowerCase()
          .replace(/\s+/g, "_")
          .slice(0, 60)}`,
        issueCategory: "technology_watch",
        resolutionApproach: opp.suggestedIntegration,
        lessonLearned: opp.relevanceToAcreOS,
        applicableCategories: ["ai", "proptech", "technology_watch"],
        keywords: [opp.topic, opp.priority, "tech_watch", dateString],
        isAutoFixable: false,
        autoFixAction: null,
        successCount: 0,
        failureCount: 0,
        contributingOrgs: 0,
      });
      log("watchTechnology — opportunity stored", {
        topic: opp.topic,
        priority: opp.priority,
      });
    } catch (insertErr) {
      logError("watchTechnology — failed to insert learning", {
        topic: opp.topic,
        error: String(insertErr),
      });
    }
  }

  log("watchTechnology — done", { opportunitiesFound: opportunities.length });
  return opportunities;
}

// ---------------------------------------------------------------------------
// runSelfAssessment  (master function)
// ---------------------------------------------------------------------------

/**
 * Master entry-point that orchestrates all three sub-functions, updates
 * `agentRuns` tracking for the 'self_assessment_agent', and returns a summary.
 *
 * Intended to be called by the weekly cron job (Sunday 3am).
 */
export async function runSelfAssessment(): Promise<{
  proposalsCreated: number;
  healthSummary: Awaited<ReturnType<typeof analyzeSystemHealth>>;
  techOpportunities: number;
  ranAt: string;
  errors: string[];
}> {
  const ranAt = new Date().toISOString();
  log("runSelfAssessment — starting weekly assessment");

  // Mark agent as running
  try {
    const [existing] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentName, "self_assessment_agent"));

    if (existing) {
      await db
        .update(agentRuns)
        .set({ status: "running", lastRunAt: new Date() })
        .where(eq(agentRuns.agentName, "self_assessment_agent"));
    } else {
      await db.insert(agentRuns).values({
        agentName: "self_assessment_agent",
        status: "running",
        lastRunAt: new Date(),
        processedCount: 0,
        errorCount: 0,
      });
    }
  } catch (err) {
    logError("runSelfAssessment — failed to update agentRuns (start)", {
      error: String(err),
    });
  }

  const errors: string[] = [];
  let proposalsCreated = 0;
  let healthSummary: Awaited<ReturnType<typeof analyzeSystemHealth>> = {
    totalAgents: 0,
    unhealthyAgents: 0,
    criticalAgents: 0,
    criticalTasksCreated: 0,
    agents: [],
  };
  let techOpportunitiesCount = 0;

  // Sub-function 1: Tool failure analysis
  try {
    proposalsCreated = await analyzeToolFailures();
  } catch (err) {
    const msg = `analyzeToolFailures failed: ${String(err)}`;
    logError(msg);
    errors.push(msg);
  }

  // Sub-function 2: System health check
  try {
    healthSummary = await analyzeSystemHealth();
  } catch (err) {
    const msg = `analyzeSystemHealth failed: ${String(err)}`;
    logError(msg);
    errors.push(msg);
  }

  // Sub-function 3: Technology watch
  try {
    const opportunities = await watchTechnology();
    techOpportunitiesCount = opportunities.length;
  } catch (err) {
    const msg = `watchTechnology failed: ${String(err)}`;
    logError(msg);
    errors.push(msg);
  }

  // Compute next run: next Sunday 3am
  const nextRun = new Date();
  const daysUntilSunday = (7 - nextRun.getDay()) % 7 || 7;
  nextRun.setDate(nextRun.getDate() + daysUntilSunday);
  nextRun.setHours(3, 0, 0, 0);

  // Update agentRuns to reflect completion
  try {
    await db
      .update(agentRuns)
      .set({
        status: errors.length > 0 ? "failed" : "completed",
        lastRunAt: new Date(),
        nextRunAt: nextRun,
        processedCount: sql`${agentRuns.processedCount} + ${proposalsCreated + techOpportunitiesCount}`,
        errorCount: sql`${agentRuns.errorCount} + ${errors.length}`,
        lastError: errors.length > 0 ? errors[errors.length - 1] : null,
      })
      .where(eq(agentRuns.agentName, "self_assessment_agent"));
  } catch (err) {
    logError("runSelfAssessment — failed to update agentRuns (finish)", {
      error: String(err),
    });
  }

  const summary = {
    proposalsCreated,
    healthSummary,
    techOpportunities: techOpportunitiesCount,
    ranAt,
    errors,
  };

  log("runSelfAssessment — complete", {
    proposalsCreated,
    criticalAgents: healthSummary.criticalAgents,
    techOpportunities: techOpportunitiesCount,
    errorsCount: errors.length,
  });

  return summary;
}
