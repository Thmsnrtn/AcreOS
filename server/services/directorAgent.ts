/**
 * Director Agent — Master Orchestrator with ReAct Loop
 *
 * Architecture: ReAct (Reason + Act + Observe) pattern
 *
 * The director is the brain that:
 *  1. Receives a high-level goal from a user or the proactive monitor
 *  2. Reasons about what plan of action would best achieve it
 *  3. Selects and executes the right specialist agent / skill
 *  4. Observes the result and decides whether the goal is met or needs more steps
 *  5. Iterates up to MAX_ITERATIONS before synthesizing a final answer
 *
 * Why this matters for the user's passivity:
 *  - A single "close this deal" goal can automatically trigger research → valuation
 *    → offer generation → communications, with the director deciding the chain.
 *  - The user never has to specify sub-steps.  The director figures them out.
 *
 * Model routing:
 *  - Reasoning steps use DeepSeek-R1 (cheap, chain-of-thought at $0.55/$2.19/M)
 *  - Synthesis uses Claude Sonnet (best quality for final output)
 *  - Everything else stays on cheapest viable tier
 */

import { db } from "../db";
import { agentTasks, agentMemory } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  routeAITask,
  routeReasoningTask,
  TaskComplexity,
  AIProvider,
  MODEL_REASONING,
  MODEL_COMPLEX,
  MODEL_SIMPLE,
} from "./aiRouter";
import { executeAgentTask, type CoreAgentType } from "./core-agents";
import type { AgentContext } from "./core-agents";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DirectorGoal {
  goal: string;
  context: AgentContext;
  /** Optional: narrow which agents can be used */
  allowedAgents?: CoreAgentType[];
  /** Override max iterations (default 8) */
  maxIterations?: number;
  /** If true, do not actually execute actions — just return the plan */
  planOnly?: boolean;
}

export interface ReActStep {
  iteration: number;
  thought: string;                // Director's reasoning
  action: DirectorAction | null;  // What it decided to do (null = no action needed)
  observation: string;            // Result of the action
  goalMet: boolean;
}

export interface DirectorAction {
  agentType: CoreAgentType;
  action: string;
  parameters: Record<string, any>;
  rationale: string;
}

export interface DirectorResult {
  success: boolean;
  goalAchieved: boolean;
  steps: ReActStep[];
  finalSynthesis: string;
  iterationsUsed: number;
  totalCostEstimate: number;
  executionTimeMs: number;
}

// ─── Agent capability map (for director's awareness) ─────────────────────────

const AGENT_CAPABILITIES: Record<CoreAgentType, { description: string; actions: string[] }> = {
  research: {
    description: "Property research, due diligence, environmental risk, parcel lookups, investment analysis",
    actions: ["run_due_diligence", "lookup_environmental", "enrich_property", "analyze_investment", "research_query"],
  },
  deals: {
    description: "Offer generation, deal analysis, financing calculations, negotiation strategy",
    actions: ["generate_offer", "analyze_deal", "calculate_financing", "suggest_strategy"],
  },
  communications: {
    description: "Email/SMS composition, lead nurturing, campaign content, response drafting",
    actions: ["compose_email", "compose_sms", "nurture_lead", "generate_campaign_content", "draft_response"],
  },
  operations: {
    description: "Delinquency checks, campaign optimization, alerts, performance analysis, daily digests",
    actions: ["check_delinquencies", "optimize_campaign", "generate_alert", "run_digest", "analyze_performance"],
  },
};

function buildCapabilityManifest(allowed?: CoreAgentType[]): string {
  const agents = allowed || (Object.keys(AGENT_CAPABILITIES) as CoreAgentType[]);
  return agents.map(a => {
    const cap = AGENT_CAPABILITIES[a];
    return `AGENT: ${a}\n  Purpose: ${cap.description}\n  Actions: ${cap.actions.join(", ")}`;
  }).join("\n\n");
}

// ─── Director Agent ────────────────────────────────────────────────────────────

export class DirectorAgent {
  private readonly MAX_ITERATIONS = 8;
  private readonly GOAL_MET_TOKEN = "[[GOAL_MET]]";
  private readonly NO_ACTION_TOKEN = "[[NO_ACTION_NEEDED]]";

  /**
   * Main entry point: process a high-level goal through the ReAct loop.
   */
  async processGoal(input: DirectorGoal): Promise<DirectorResult> {
    const startTime = Date.now();
    const maxIter = input.maxIterations ?? this.MAX_ITERATIONS;
    const steps: ReActStep[] = [];
    const observationHistory: string[] = [];
    let totalCostEstimate = 0;

    console.log(`[Director] Processing goal: "${input.goal.slice(0, 80)}..."`);

    for (let i = 1; i <= maxIter; i++) {
      // ── REASON: decide what to do next ──────────────────────────────────────
      const thought = await this.reason(input, steps, observationHistory, i, maxIter);
      totalCostEstimate += 0.002; // ~DeepSeek-R1 cost per reasoning step

      const goalMet = thought.includes(this.GOAL_MET_TOKEN);
      const noAction = thought.includes(this.NO_ACTION_TOKEN);

      if (goalMet || noAction) {
        steps.push({ iteration: i, thought, action: null, observation: "Goal assessed as complete.", goalMet: true });
        break;
      }

      // ── ACT: parse which agent + action the director chose ──────────────────
      const action = this.parseAction(thought);
      if (!action) {
        steps.push({ iteration: i, thought, action: null, observation: "Director could not parse a clear action.", goalMet: false });
        continue;
      }

      // ── OBSERVE: execute and record result ───────────────────────────────────
      let observation = "";
      if (!input.planOnly) {
        try {
          const result = await executeAgentTask(action.agentType, {
            action: action.action,
            parameters: action.parameters,
            context: input.context,
          });
          observation = result.success
            ? `SUCCESS: ${JSON.stringify(result.data).slice(0, 600)}`
            : `FAILED: ${result.message}`;
          totalCostEstimate += 0.005;
        } catch (err: any) {
          observation = `ERROR: ${err.message}`;
        }
      } else {
        observation = `[PLAN_ONLY] Would execute: ${action.agentType}.${action.action}`;
      }

      observationHistory.push(`Step ${i} (${action.agentType}.${action.action}): ${observation}`);
      steps.push({ iteration: i, thought, action, observation, goalMet: false });

      console.log(`[Director] Step ${i}/${maxIter}: ${action.agentType}.${action.action} → ${observation.slice(0, 120)}`);
    }

    // ── SYNTHESIZE: produce a coherent final response ─────────────────────────
    const finalSynthesis = await this.synthesize(input.goal, steps);
    totalCostEstimate += 0.01;

    const goalAchieved = steps.some(s => s.goalMet) || steps.length >= maxIter;

    return {
      success: true,
      goalAchieved,
      steps,
      finalSynthesis,
      iterationsUsed: steps.length,
      totalCostEstimate,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * REASON step: given the goal and history, decide what to do next.
   * Uses DeepSeek-R1 for chain-of-thought reasoning (cheap + strong reasoning).
   */
  private async reason(
    input: DirectorGoal,
    steps: ReActStep[],
    observations: string[],
    iteration: number,
    maxIter: number
  ): Promise<string> {
    const historyBlock = observations.length > 0
      ? `\nPREVIOUS STEPS:\n${observations.join("\n")}`
      : "\nNo steps taken yet.";

    const systemPrompt = `You are a Director AI that orchestrates specialist agents for a land investment platform.
Your job: achieve the user's goal by selecting and sequencing agent actions.

AVAILABLE AGENTS:
${buildCapabilityManifest(input.allowedAgents)}

RULES:
1. Reason step by step about what needs to happen next.
2. If the goal is achieved or no further action is needed, end with "${this.GOAL_MET_TOKEN}".
3. If you need an action, output exactly this JSON block and nothing else after it:
   ACTION: {"agentType":"<type>","action":"<action>","parameters":{...},"rationale":"<why>"}
4. Keep parameters minimal and correct.
5. Never repeat an action that already succeeded.
6. You are on iteration ${iteration} of max ${maxIter}.`;

    const userPrompt = `GOAL: ${input.goal}

Context:
- Organization ID: ${input.context.organizationId}
- Related Lead: ${input.context.relatedLeadId ?? "none"}
- Related Property: ${input.context.relatedPropertyId ?? "none"}
- Related Deal: ${input.context.relatedDealId ?? "none"}
${historyBlock}

What should the next action be? Reason through it, then specify the ACTION JSON.`;

    const response = await routeReasoningTask("director_reasoning", systemPrompt, userPrompt, {
      orgId: input.context.organizationId,
    });

    return response.content;
  }

  /**
   * Parse the ACTION JSON from the director's reasoning output.
   */
  private parseAction(thought: string): DirectorAction | null {
    try {
      const match = thought.match(/ACTION:\s*(\{[\s\S]*?\})/);
      if (!match) return null;
      const parsed = JSON.parse(match[1]);
      if (!parsed.agentType || !parsed.action) return null;
      const validAgents: CoreAgentType[] = ["research", "deals", "communications", "operations"];
      if (!validAgents.includes(parsed.agentType)) return null;
      return {
        agentType: parsed.agentType as CoreAgentType,
        action: parsed.action,
        parameters: parsed.parameters || {},
        rationale: parsed.rationale || "",
      };
    } catch {
      return null;
    }
  }

  /**
   * SYNTHESIZE: produce a clean, actionable summary of everything that happened.
   * Uses Claude Sonnet for maximum quality output.
   */
  private async synthesize(goal: string, steps: ReActStep[]): Promise<string> {
    if (steps.length === 0) {
      return "No steps were executed. Please try again with a more specific goal.";
    }

    const stepsBlock = steps
      .filter(s => s.action)
      .map(s => `• ${s.action!.agentType}.${s.action!.action}: ${s.observation.slice(0, 300)}`)
      .join("\n");

    const systemPrompt = `You are a synthesis AI that consolidates agent execution results into clear, actionable summaries.
Be concise, highlight key findings, and tell the user what was done and what they should know.`;

    const userPrompt = `ORIGINAL GOAL: ${goal}

EXECUTION STEPS:
${stepsBlock || "Planning only — no actions executed."}

Synthesize the results into a clear, direct summary. Include:
1. What was accomplished
2. Key findings or generated content
3. Any items requiring the user's attention
4. Recommended next steps`;

    const response = await routeAITask({
      taskType: "synthesis",
      complexity: TaskComplexity.COMPLEX,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 800,
      temperature: 0.3,
    });

    return response.content;
  }

  /**
   * Quick planning pass — returns a plan without executing actions.
   * Cheap: uses DeepSeek Chat.
   */
  async planGoal(goal: string, context: AgentContext): Promise<string[]> {
    const systemPrompt = `You are a land investment AI director. Given a goal, list the minimal ordered sequence of agent actions needed.
Output as a JSON array of strings: ["step 1 description", "step 2 description", ...]`;

    const userPrompt = `Goal: ${goal}\n\nAvailable agents: research, deals, communications, operations\n\nList the steps:`;

    const response = await routeAITask({
      taskType: "planning",
      complexity: TaskComplexity.SIMPLE,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      responseFormat: "json",
      temperature: 0.1,
    });

    try {
      const parsed = JSON.parse(response.content);
      return Array.isArray(parsed) ? parsed : [response.content];
    } catch {
      return [response.content];
    }
  }
}

export const directorAgent = new DirectorAgent();

// ─── Convenience: queue a goal as an agent task in the DB ────────────────────

export async function queueDirectorGoal(
  organizationId: number,
  goal: string,
  context: Omit<AgentContext, "organizationId">,
  priority: number = 5
): Promise<number> {
  const [task] = await db.insert(agentTasks).values({
    organizationId,
    agentType: "research", // Director uses research queue by convention
    status: "pending",
    priority,
    input: {
      action: "director_goal",
      goal,
      ...context,
    } as any,
  }).returning({ id: agentTasks.id });

  console.log(`[Director] Queued goal task #${task.id}: "${goal.slice(0, 60)}"`);
  return task.id;
}
