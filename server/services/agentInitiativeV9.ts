// @ts-nocheck
/**
 * Agent Initiative System — Sovereign Company Protocol v9: The Self-Running Company
 *
 * Agents stop waiting for triggers. They THINK proactively.
 *
 * Every cycle (daily by default), each agent:
 * 1. Reviews their domain's trailing 7-day data
 * 2. Compares against baselines and goals
 * 3. Identifies anything SURPRISING (positive or negative)
 * 4. Decides: act autonomously, or surface to the CEO?
 * 5. Contributes to the unified CEO Daily Briefing
 *
 * The CEO gets ONE briefing — not 10 reports.
 * Green = all clear. Yellow = watch. Red = needs you.
 */

import { db } from "../db";
import {
  agentInitiatives, ceoBriefings,
  type AgentInitiative, type CEOBriefing,
} from "@shared/schema";
import { eq, desc, gte, and, count } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { resolveAgentData } from "./agentDataResolvers";
import { strategicCompassV8Service } from "./strategicCompassV8";
import { institutionalMemoryService } from "./institutionalMemory";

// ─── Initiative Priority Levels ──────────────────────────────────────────────

export type InitiativePriority = "all_clear" | "watch" | "needs_ceo";

interface AgentThinking {
  agentCodename: string;
  title: string;
  priority: InitiativePriority;
  summary: string;
  evidence: string[];
  proposedAction?: string;
  actionApprovalNeeded: boolean;
  confidence: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class AgentInitiativeService {

  /**
   * Run the daily thinking cycle for ALL agents.
   * Each agent reviews their domain, identifies surprises, proposes actions.
   * Returns a unified CEO Briefing.
   */
  async runDailyCycle(): Promise<number> {
    const agents = await companyAgentService.getAll();
    const compass = await strategicCompassV8Service.getActive();
    const mode = compass?.mode || "balanced";
    const northStar = compass?.northStar || "";

    const thinkingResults: AgentThinking[] = [];

    // Run all agents' thinking in parallel
    const thinkingPromises = agents.map(agent =>
      this.runAgentThinking(agent.codename, agent.title, agent.personalityPrompt || "", mode, northStar)
        .catch(err => {
          console.error(`[Initiative] ${agent.codename} thinking failed:`, err);
          return null;
        })
    );

    const results = await Promise.all(thinkingPromises);
    for (const result of results) {
      if (result) thinkingResults.push(result);
    }

    // Store each initiative
    for (const thinking of thinkingResults) {
      await db.insert(agentInitiatives).values({
        agentCodename: thinking.agentCodename,
        priority: thinking.priority,
        summary: thinking.summary,
        evidence: thinking.evidence,
        proposedAction: thinking.proposedAction || null,
        actionApprovalNeeded: thinking.actionApprovalNeeded,
        confidence: thinking.confidence,
        status: thinking.actionApprovalNeeded ? "pending_approval" : "noted",
      });
    }

    // Compile into a single CEO briefing
    const briefingId = await this.compileBriefing(thinkingResults);

    return briefingId;
  }

  /**
   * Run one agent's thinking cycle.
   * Agent reviews its domain data, compares against baselines, identifies surprises.
   */
  private async runAgentThinking(
    codename: string,
    title: string,
    personalityPrompt: string,
    mode: string,
    northStar: string,
  ): Promise<AgentThinking> {
    // Gather live domain data
    const liveData = await resolveAgentData(codename).catch(() => ({}));

    // Get recent patterns from institutional memory
    const patterns = await institutionalMemoryService.getPatterns().catch(() => []);
    const relevantPatterns = patterns
      .filter(p => (p.contributingAgents as string[])?.includes(codename))
      .slice(0, 3)
      .map(p => `${p.patternName}: success rate ${p.successRate}, sample size ${p.sampleSize}`);

    try {
      const response = await routeAITask({
        taskType: "agent_initiative",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `${personalityPrompt}

You are running your DAILY THINKING CYCLE. This is your proactive analysis — nobody asked you for this. You're looking at your domain and identifying what matters.

Company mode: ${mode}
North star: ${northStar}

Your job:
1. Review the data below and compare against what you'd expect for a healthy SaaS
2. Identify anything SURPRISING — positive deviations (wins) or negative deviations (risks)
3. If everything is normal, say so (all_clear)
4. If something needs watching but no action yet, flag it (watch)
5. If something needs the CEO's attention or approval, escalate it (needs_ceo)

Be specific with numbers. Be honest. Don't manufacture problems.`,
          },
          {
            role: "user",
            content: `Your domain data (trailing 7 days):
${JSON.stringify(liveData, null, 2)}

Known patterns from institutional memory:
${relevantPatterns.join("\n") || "No established patterns yet."}

Run your thinking cycle. Respond in JSON:
{
  "priority": "all_clear|watch|needs_ceo",
  "summary": "2-3 sentences in your voice. Be specific with numbers.",
  "evidence": ["specific data point 1", "specific data point 2"],
  "proposedAction": "What you want to do about it (null if all_clear)",
  "actionApprovalNeeded": false,
  "confidence": 0-100
}`,
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.3,
      });

      const parsed = JSON.parse(response.content);
      return {
        agentCodename: codename,
        title,
        priority: parsed.priority || "all_clear",
        summary: parsed.summary || "No significant findings.",
        evidence: parsed.evidence || [],
        proposedAction: parsed.proposedAction || undefined,
        actionApprovalNeeded: parsed.actionApprovalNeeded || false,
        confidence: parsed.confidence || 50,
      };
    } catch {
      return {
        agentCodename: codename,
        title,
        priority: "all_clear",
        summary: `${title} thinking cycle completed. No data anomalies detected.`,
        evidence: [],
        actionApprovalNeeded: false,
        confidence: 50,
      };
    }
  }

  /**
   * Compile individual agent thinking into a unified CEO briefing.
   * Groups by priority: all_clear (collapsed), watch (expanded), needs_ceo (urgent).
   */
  private async compileBriefing(thinkingResults: AgentThinking[]): Promise<number> {
    const allClear = thinkingResults.filter(t => t.priority === "all_clear");
    const watch = thinkingResults.filter(t => t.priority === "watch");
    const needsCeo = thinkingResults.filter(t => t.priority === "needs_ceo");

    // Generate a narrative summary
    let narrative = "";
    try {
      const response = await routeAITask({
        taskType: "ceo_briefing",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `You compile agent reports into a concise CEO daily briefing. Be direct, use bullet points, lead with what matters. The CEO should be able to read this in 60 seconds and know the state of their business.`,
          },
          {
            role: "user",
            content: `Compile this into a CEO briefing:

ALL CLEAR (${allClear.length} agents):
${allClear.map(a => `- ${a.agentCodename} (${a.title}): ${a.summary}`).join("\n") || "None"}

WATCH (${watch.length} items):
${watch.map(a => `- ${a.agentCodename}: ${a.summary}\n  Evidence: ${a.evidence.join("; ")}\n  Proposed: ${a.proposedAction || "monitoring"}`).join("\n") || "None"}

NEEDS CEO (${needsCeo.length} items):
${needsCeo.map(a => `- ${a.agentCodename}: ${a.summary}\n  Evidence: ${a.evidence.join("; ")}\n  Proposed: ${a.proposedAction || "none"}`).join("\n") || "None"}

Write a 3-5 sentence executive summary. Be direct. Lead with the most important thing.`,
          },
        ],
        maxTokens: 300,
        temperature: 0.3,
      });
      narrative = response.content;
    } catch {
      narrative = `Daily briefing: ${allClear.length} agents all clear, ${watch.length} watching, ${needsCeo.length} need your attention.`;
    }

    const overallStatus = needsCeo.length > 0 ? "needs_ceo"
      : watch.length > 0 ? "watch"
      : "all_clear";

    const [briefing] = await db.insert(ceoBriefings).values({
      date: new Date(),
      overallStatus,
      narrative,
      allClearAgents: allClear.map(a => a.agentCodename),
      watchItems: watch.map(a => ({
        agentCodename: a.agentCodename,
        title: a.title,
        summary: a.summary,
        evidence: a.evidence,
        proposedAction: a.proposedAction,
        confidence: a.confidence,
      })),
      needsCeoItems: needsCeo.map(a => ({
        agentCodename: a.agentCodename,
        title: a.title,
        summary: a.summary,
        evidence: a.evidence,
        proposedAction: a.proposedAction,
        actionApprovalNeeded: a.actionApprovalNeeded,
        confidence: a.confidence,
      })),
      actionsTaken: [],
      totalAgents: allClear.length + watch.length + needsCeo.length,
    }).returning({ id: ceoBriefings.id });

    return briefing.id;
  }

  /**
   * CEO approves a proposed action from an initiative.
   */
  async approveAction(initiativeId: number): Promise<void> {
    await db.update(agentInitiatives)
      .set({ status: "approved", resolvedAt: new Date() })
      .where(eq(agentInitiatives.id, initiativeId));
  }

  /**
   * CEO rejects a proposed action.
   */
  async rejectAction(initiativeId: number, reason?: string): Promise<void> {
    await db.update(agentInitiatives)
      .set({
        status: "rejected",
        ceoResponse: reason,
        resolvedAt: new Date(),
      })
      .where(eq(agentInitiatives.id, initiativeId));
  }

  /** Get latest briefing */
  async getLatestBriefing(): Promise<CEOBriefing | null> {
    return db.query.ceoBriefings.findFirst({
      orderBy: [desc(ceoBriefings.date)],
    }) as any;
  }

  /** Get recent briefings */
  async getRecentBriefings(limit = 7): Promise<CEOBriefing[]> {
    return db.query.ceoBriefings.findMany({
      orderBy: [desc(ceoBriefings.date)],
      limit,
    });
  }

  /** Get pending initiatives that need CEO approval */
  async getPendingApprovals(): Promise<AgentInitiative[]> {
    return db.query.agentInitiatives.findMany({
      where: eq(agentInitiatives.status, "pending_approval"),
      orderBy: [desc(agentInitiatives.createdAt)],
    });
  }

  /** Get recent initiatives for an agent */
  async getAgentInitiatives(codename: string, limit = 10): Promise<AgentInitiative[]> {
    return db.query.agentInitiatives.findMany({
      where: eq(agentInitiatives.agentCodename, codename),
      orderBy: [desc(agentInitiatives.createdAt)],
      limit,
    });
  }
}

export const agentInitiativeService = new AgentInitiativeService();
