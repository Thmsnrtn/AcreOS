/**
 * Override Learner — Sovereign Company Protocol v4
 *
 * When the CEO rejects an agent recommendation (swipes left), this service:
 * 1. Analyzes WHY the recommendation was wrong
 * 2. Extracts a learnable pattern
 * 3. Stores it in agentOverrideLearnings for future reference
 * 4. Injects learned patterns into agent prompts to prevent repeats
 *
 * This closes the feedback loop: override → learn → improve → fewer overrides.
 */

import { db } from "../db";
import { agentOverrideLearnings, agentMemory } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";

import { sanitizePromptInline } from "../utils/sanitizePrompt";
interface OverrideContext {
  agentCodename: string;
  actionName: string;
  originalRecommendation: string;
  ceoOverrideAction?: string;
  ceoOverrideNotes?: string;
  decisionId?: number;
}

/**
 * Process a CEO override and extract a learning from it.
 */
export async function learnFromOverride(context: OverrideContext): Promise<{
  learnedPattern: string;
  patternCategory: string;
}> {
  // Use AI to analyze what went wrong and extract a pattern
  let learnedPattern: string;
  let patternCategory: string;

  try {
    const response = await routeAITask({
      taskType: "override_analysis",
      complexity: TaskComplexity.SIMPLE,
      messages: [
        {
          role: "system",
          content: `You analyze CEO override decisions to help AI agents learn. Given an agent's recommendation that was rejected, extract what the agent should learn.

Respond in JSON:
{
  "learnedPattern": "A concise, actionable lesson the agent should remember (max 2 sentences)",
  "patternCategory": "timing|scope|judgment|risk|communication"
}

Categories:
- timing: action was too early/late
- scope: action was too broad/narrow
- judgment: wrong assessment of the situation
- risk: underestimated/overestimated risk
- communication: wrong tone, audience, or channel`,
        },
        {
          role: "user",
          content: `Agent: ${context.agentCodename}
Action: ${context.actionName}
Agent's recommendation: ${context.originalRecommendation}
CEO's override action: ${context.ceoOverrideAction || "Rejected without specific action"}
CEO's notes: ${sanitizePromptInline(context.ceoOverrideNotes || "No notes provided")}

What should the agent learn from this rejection?`,
        },
      ],
      responseFormat: "json",
      temperature: 0.2,
    });

    const parsed = JSON.parse(response.content);
    learnedPattern = parsed.learnedPattern || "CEO preferred a different approach — observe and adapt.";
    patternCategory = parsed.patternCategory || "judgment";
  } catch {
    learnedPattern = `CEO rejected "${context.actionName}" — this action may need more context before recommending.`;
    patternCategory = "judgment";
  }

  // Check if a similar pattern already exists (same agent + action)
  const existing = await db.select()
    .from(agentOverrideLearnings)
    .where(and(
      eq(agentOverrideLearnings.agentCodename, context.agentCodename),
      eq(agentOverrideLearnings.actionName, context.actionName),
    ))
    .orderBy(desc(agentOverrideLearnings.createdAt))
    .limit(1);

  if (existing.length > 0) {
    // Increment occurrence count on existing pattern
    await db.update(agentOverrideLearnings)
      .set({
        occurrenceCount: sql`${agentOverrideLearnings.occurrenceCount} + 1`,
        learnedPattern, // Update with latest learning
        ceoOverrideAction: context.ceoOverrideAction,
        ceoOverrideNotes: context.ceoOverrideNotes,
      })
      .where(eq(agentOverrideLearnings.id, existing[0].id));
  } else {
    // Create new learning
    await db.insert(agentOverrideLearnings).values({
      agentCodename: context.agentCodename,
      decisionId: context.decisionId,
      actionName: context.actionName,
      originalRecommendation: context.originalRecommendation,
      ceoOverrideAction: context.ceoOverrideAction,
      ceoOverrideNotes: context.ceoOverrideNotes,
      learnedPattern,
      patternCategory,
    });
  }

  // Also store as an agent memory for prompt injection
  try {
    await db.insert(agentMemory).values({
      agentType: context.agentCodename,
      memoryType: "warning",
      key: `override:${context.actionName}`,
      content: learnedPattern,
      confidence: "0.8",
      usageCount: 0,
    } as any);
  } catch {
    // Memory might already exist — that's fine
  }

  return { learnedPattern, patternCategory };
}

/**
 * Get all learnings for an agent, formatted for injection into their system prompt.
 */
export async function getLearnedPatternsForPrompt(agentCodename: string): Promise<string> {
  const learnings = await db.select()
    .from(agentOverrideLearnings)
    .where(eq(agentOverrideLearnings.agentCodename, agentCodename))
    .orderBy(desc(agentOverrideLearnings.occurrenceCount))
    .limit(10);

  if (learnings.length === 0) return "";

  const lines = learnings.map(l =>
    `- ${l.learnedPattern} (${l.patternCategory}, occurred ${l.occurrenceCount}x)`
  );

  return `\n--- LESSONS FROM CEO FEEDBACK ---\nThe CEO has corrected you before. Incorporate these lessons:\n${lines.join("\n")}\n`;
}
