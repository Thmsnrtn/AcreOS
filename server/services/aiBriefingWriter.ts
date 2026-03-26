// @ts-nocheck
/**
 * AI Briefing Writer — Sovereign Company Protocol v4
 *
 * Replaces template-string briefings with genuine AI-generated prose.
 * Each agent "speaks" their update using their personality prompt + live metrics.
 *
 * Cost: ~$0.001 per briefing via DeepSeek Chat (cheapest viable model).
 * Cached in companyBriefingCache so it's only generated once per day.
 */

import { routeAITask, TaskComplexity } from "./aiRouter";
import { getPrioritiesForPrompt } from "./strategicCompass";
import { getLearnedPatternsForPrompt } from "./overrideLearner";
import { getSharedKnowledgeForPrompt } from "./agentKnowledgeGraph";

interface AgentBriefingInput {
  codename: string;
  title: string;
  role: string;
  personalityPrompt: string;
  metrics: Record<string, any>;
  recentActions: { total: number; succeeded: number };
  trustScore: number;
}

interface AgentBriefingOutput {
  agent: string;
  role: string;
  message: string;
  hasActivity: boolean;
}

/**
 * Generate AI-written briefing updates for all agents.
 * Each agent speaks in their own voice about what matters right now.
 */
export async function generateBriefingUpdates(
  agents: AgentBriefingInput[]
): Promise<AgentBriefingOutput[]> {
  // Get strategic context for all agents
  const strategicContext = await getPrioritiesForPrompt();

  const results = await Promise.allSettled(
    agents.map(agent => generateSingleBriefing(agent, strategicContext))
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    // Fallback to simple template if AI fails
    return {
      agent: agents[i].codename,
      role: agents[i].role,
      message: `Systems operational. ${agents[i].recentActions.succeeded || 0} actions completed.`,
      hasActivity: agents[i].recentActions.total > 0,
    };
  });
}

async function generateSingleBriefing(
  agent: AgentBriefingInput,
  strategicContext: string
): Promise<AgentBriefingOutput> {
  // Get agent-specific context
  const [learnedPatterns, sharedKnowledge] = await Promise.all([
    getLearnedPatternsForPrompt(agent.codename).catch(() => ""),
    getSharedKnowledgeForPrompt(agent.codename).catch(() => ""),
  ]);

  const metricsStr = Object.entries(agent.metrics)
    .filter(([_, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const response = await routeAITask({
    taskType: "agent_briefing",
    complexity: TaskComplexity.SIMPLE, // Use cheapest model
    messages: [
      {
        role: "system",
        content: `${agent.personalityPrompt}

You are writing your morning briefing for the CEO. Keep it to 1-2 sentences max. Be specific with numbers. Sound natural, not robotic. Never use jargon the CEO won't understand. Never mention trust scores or authority levels — those are internal.
${strategicContext}${learnedPatterns}${sharedKnowledge}`,
      },
      {
        role: "user",
        content: `Write your morning update. Here's what you know:

Your metrics:
${metricsStr || "No specific metrics available"}

Your actions in the last 24h: ${agent.recentActions.total} total, ${agent.recentActions.succeeded} succeeded

Write 1-2 sentences in your characteristic voice. Be specific. Lead with the most important thing.`,
      },
    ],
    maxTokens: 150,
    temperature: 0.6,
  });

  return {
    agent: agent.codename,
    role: agent.role,
    message: response.content.replace(/^["']|["']$/g, "").trim(),
    hasActivity: agent.recentActions.total > 0,
  };
}

/**
 * Generate a single insight sentence about what the CEO should know.
 * Used for the headline of the morning briefing.
 */
export async function generateHeadlineInsight(metrics: {
  mrrDollars: number;
  pendingDecisions: number;
  totalAgentActions: number;
  atRiskAccounts: number;
}): Promise<string> {
  try {
    const response = await routeAITask({
      taskType: "briefing_headline",
      complexity: TaskComplexity.SIMPLE,
      messages: [
        {
          role: "system",
          content: "Write a single headline sentence summarizing the CEO's morning. Be warm but factual. Example: 'Quiet night — your team handled 12 actions autonomously and MRR is healthy at $4,500.'",
        },
        {
          role: "user",
          content: `MRR: $${metrics.mrrDollars.toLocaleString()}, Pending decisions: ${metrics.pendingDecisions}, Agent actions overnight: ${metrics.totalAgentActions}, At-risk accounts: ${metrics.atRiskAccounts}. Write the headline.`,
        },
      ],
      maxTokens: 60,
      temperature: 0.5,
    });
    return response.content.replace(/^["']|["']$/g, "").trim();
  } catch {
    return metrics.pendingDecisions > 0
      ? `${metrics.pendingDecisions} decision${metrics.pendingDecisions > 1 ? "s" : ""} waiting for you.`
      : "All quiet — your team is running smoothly.";
  }
}
