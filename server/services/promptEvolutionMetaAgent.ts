/**
 * Prompt Evolution Meta-Agent — closes the learning loop on HOW
 * each agent decides, not just WHAT trust score they get.
 *
 * The cycle-2 FINDINGS documented the gap: we grade decisions (outcome
 * score -2..+2) and we adapt a per-agent trust score, but the agent's
 * personalityPrompt itself never changes. So the same biases repeat
 * month after month: Ledger underweighting anomalies, Forge being
 * too aggressive on spend, etc.
 *
 * This service fixes that. Monthly it reads 30 days of per-agent
 * decision data, identifies systematic weaknesses, and proposes prompt
 * revisions — not to edit anything live, but to queue them as board
 * proposals in agentPromptEvolutions. The founder approves on one
 * page; applied revisions show up on the next decision cycle.
 *
 * Safety model:
 *   - This process NEVER directly mutates agent.personalityPrompt.
 *   - Proposals land with status='proposed' in agentPromptEvolutions.
 *   - Only `agentEvolutionEngine.applyPromptChange(id)` after explicit
 *     founder approval can touch the live prompt.
 *   - The meta-agent's LLM call is capped at one Opus call per eligible
 *     agent per month. With 12 agents that's ≤ $0.50/month at Opus
 *     rates. The value is one avoided systematic mistake.
 *
 * Eligibility — we only propose changes for agents where there's enough
 * signal AND enough concern:
 *   - At least 5 graded decisions in the window
 *   - Avg outcome < 1.0 OR founder-override rate > 25%
 * Everyone else gets left alone. "The prompt ain't broke" is a feature.
 */

import { db } from "../db";
import {
  decisionsInboxItems,
  companyAgents,
  agentPromptEvolutions,
} from "@shared/schema";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { routeCriticalTask } from "./aiRouter";
import { agentEvolutionEngine } from "./agentEvolutionEngine";

export interface AgentPerformanceSlice {
  agentCodename: string;
  decisionsTotal: number;
  avgOutcomeScore: number | null;
  overrideCount: number;
  overrideRate: number;
  deferredCount: number;
  deferredRate: number;
  brierScore: number | null;
  overconfidenceBias: number | null;
  negativeOutcomes: Array<{
    itemType: string;
    recommendedActionLabel: string;
    outcomeScore: number;
    actualOutcome: string | null;
  }>;
  founderOverrides: Array<{
    itemType: string;
    recommendedActionLabel: string;
    overrideAction: string;
    reason: string | null;
  }>;
}

export interface PromptProposalResult {
  agentCodename: string;
  proposalId?: number;
  skipped?: string;
  reason?: string;
}

const MIN_DECISIONS = 5;
const CONCERN_THRESHOLD_OUTCOME = 1.0;
const CONCERN_THRESHOLD_OVERRIDE = 0.25;

/**
 * Top-level entry point for the monthly job. Iterates all active
 * agents, scores their performance, and proposes prompt revisions
 * only where the data says the current prompt isn't working.
 */
export async function runMonthlyPromptEvolution(): Promise<{
  proposals: PromptProposalResult[];
  scanned: number;
  windowDays: number;
}> {
  const windowDays = 30;
  const results: PromptProposalResult[] = [];
  const agents = await db
    .select()
    .from(companyAgents)
    .where(eq(companyAgents.status, "active"));

  for (const agent of agents) {
    try {
      const slice = await analyseAgent(agent.codename, windowDays);
      const verdict = shouldPropose(slice);
      if (!verdict.ok) {
        results.push({ agentCodename: agent.codename, skipped: verdict.reason });
        continue;
      }
      const proposalId = await proposeFromSlice(
        agent.codename,
        agent.personalityPrompt ?? "",
        slice,
      );
      results.push({
        agentCodename: agent.codename,
        proposalId,
        reason: verdict.reason,
      });
    } catch (err: any) {
      logger.warn("[promptEvolution] per-agent run failed", {
        metadata: { agent: agent.codename, error: err?.message },
      });
      results.push({ agentCodename: agent.codename, skipped: `error: ${err?.message}` });
    }
  }

  logger.info(`[promptEvolution] monthly run: ${results.filter((r) => r.proposalId).length} proposals, ${results.filter((r) => r.skipped).length} skipped`);
  return { proposals: results, scanned: agents.length, windowDays };
}

/**
 * Build a per-agent performance slice from the decisions inbox.
 */
export async function analyseAgent(
  agentCodename: string,
  windowDays: number,
): Promise<AgentPerformanceSlice> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      itemType: decisionsInboxItems.itemType,
      status: decisionsInboxItems.status,
      outcomeScore: decisionsInboxItems.outcomeScore,
      actualOutcome: decisionsInboxItems.actualOutcome,
      founderOverrideAction: decisionsInboxItems.founderOverrideAction,
      recommendedActionLabel: decisionsInboxItems.recommendedActionLabel,
    })
    .from(decisionsInboxItems)
    .where(
      and(
        eq(decisionsInboxItems.ownerAgentCodename, agentCodename),
        gte(decisionsInboxItems.createdAt, since),
      ),
    );

  const total = rows.length;
  const graded = rows.filter((r) => r.outcomeScore != null);
  const avg = graded.length
    ? graded.reduce((s, r) => s + (r.outcomeScore ?? 0), 0) / graded.length
    : null;
  const overrides = rows.filter((r) => r.founderOverrideAction != null);
  const deferred = rows.filter((r) => r.status === "deferred");

  const negative = graded
    .filter((r) => (r.outcomeScore ?? 0) <= -1)
    .slice(0, 5)
    .map((r) => ({
      itemType: r.itemType,
      recommendedActionLabel: r.recommendedActionLabel,
      outcomeScore: r.outcomeScore ?? 0,
      actualOutcome: r.actualOutcome,
    }));

  const founderOverrides = overrides.slice(0, 5).map((r) => ({
    itemType: r.itemType,
    recommendedActionLabel: r.recommendedActionLabel,
    overrideAction: r.founderOverrideAction ?? "unknown",
    reason: r.actualOutcome,
  }));

  // Pull calibration stats — the meta-agent needs to see these so it
  // can prescribe "teach the agent to say I don't know" when warranted.
  let brierScore: number | null = null;
  let overconfidenceBias: number | null = null;
  try {
    const { computeCalibration } = await import("./calibration");
    const calib = await computeCalibration(agentCodename, windowDays);
    brierScore = calib.brierScore;
    overconfidenceBias = calib.overconfidenceBias;
  } catch {
    // leave nulls
  }

  return {
    agentCodename,
    decisionsTotal: total,
    avgOutcomeScore: avg,
    overrideCount: overrides.length,
    overrideRate: total > 0 ? overrides.length / total : 0,
    deferredCount: deferred.length,
    deferredRate: total > 0 ? deferred.length / total : 0,
    brierScore,
    overconfidenceBias,
    negativeOutcomes: negative,
    founderOverrides,
  };
}

function shouldPropose(slice: AgentPerformanceSlice): { ok: boolean; reason: string } {
  if (slice.decisionsTotal < MIN_DECISIONS) {
    return { ok: false, reason: `only ${slice.decisionsTotal} decisions in window (< ${MIN_DECISIONS})` };
  }
  if (slice.avgOutcomeScore != null && slice.avgOutcomeScore < CONCERN_THRESHOLD_OUTCOME) {
    return {
      ok: true,
      reason: `avg outcome ${slice.avgOutcomeScore.toFixed(2)} below ${CONCERN_THRESHOLD_OUTCOME}`,
    };
  }
  if (slice.overrideRate > CONCERN_THRESHOLD_OVERRIDE) {
    return {
      ok: true,
      reason: `founder-override rate ${(slice.overrideRate * 100).toFixed(0)}% above ${CONCERN_THRESHOLD_OVERRIDE * 100}%`,
    };
  }
  if (slice.brierScore != null && slice.brierScore >= 0.25) {
    return {
      ok: true,
      reason: `poor calibration (Brier ${slice.brierScore.toFixed(2)} ≥ 0.25) — confidence scores aren't tracking outcomes`,
    };
  }
  return { ok: false, reason: "performance within tolerance" };
}

/**
 * Use Opus to draft a revised prompt based on the agent's performance
 * slice. The revision is always a proposal — the founder still has to
 * approve before it goes live.
 */
async function proposeFromSlice(
  agentCodename: string,
  currentPrompt: string,
  slice: AgentPerformanceSlice,
): Promise<number> {
  const context = buildDraftContext(slice, currentPrompt);
  const aiResponse = await routeCriticalTask(
    "agent_prompt_revision",
    META_AGENT_SYSTEM_PROMPT,
    context,
  );
  const parsed = parseAiResponse(aiResponse.content);
  const proposalId = await agentEvolutionEngine.proposePromptChange(
    agentCodename,
    parsed.revisedPrompt,
    parsed.reasoning,
  );
  logger.info(`[promptEvolution] proposed revision for ${agentCodename} (id=${proposalId})`);
  return proposalId;
}

function buildDraftContext(slice: AgentPerformanceSlice, currentPrompt: string): string {
  const lines: string[] = [];
  lines.push(`AGENT: ${slice.agentCodename}`);
  lines.push(`PERFORMANCE (last 30 days):`);
  lines.push(`  Total decisions owned: ${slice.decisionsTotal}`);
  lines.push(
    `  Avg outcome score (−2..+2): ${slice.avgOutcomeScore == null ? "N/A" : slice.avgOutcomeScore.toFixed(2)}`,
  );
  lines.push(
    `  Founder override rate: ${(slice.overrideRate * 100).toFixed(0)}% (${slice.overrideCount}/${slice.decisionsTotal})`,
  );
  lines.push(
    `  Deferral rate: ${(slice.deferredRate * 100).toFixed(0)}% (${slice.deferredCount}/${slice.decisionsTotal})`,
  );
  if (slice.brierScore != null) {
    lines.push("");
    lines.push("CALIBRATION:");
    lines.push(`  Brier score: ${slice.brierScore.toFixed(3)} (lower=better, <0.2 is good)`);
    if (slice.overconfidenceBias != null) {
      const tag =
        slice.overconfidenceBias > 10
          ? "overconfident"
          : slice.overconfidenceBias < -10
            ? "underconfident"
            : "well-calibrated";
      lines.push(`  Overconfidence bias: ${slice.overconfidenceBias.toFixed(1)}pp (${tag})`);
    }
  }
  if (slice.negativeOutcomes.length > 0) {
    lines.push("");
    lines.push("NEGATIVELY GRADED DECISIONS:");
    for (const n of slice.negativeOutcomes) {
      lines.push(
        `  - ${n.itemType}: "${n.recommendedActionLabel}" score=${n.outcomeScore} — ${n.actualOutcome ?? ""}`,
      );
    }
  }
  if (slice.founderOverrides.length > 0) {
    lines.push("");
    lines.push("FOUNDER OVERRIDES (these are ground truth corrections):");
    for (const o of slice.founderOverrides) {
      lines.push(
        `  - ${o.itemType}: "${o.recommendedActionLabel}" founder chose ${o.overrideAction}${o.reason ? ` (${o.reason})` : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("CURRENT PROMPT:");
  lines.push("```");
  lines.push(currentPrompt);
  lines.push("```");
  lines.push("");
  lines.push(
    `Produce a revised prompt and a short reasoning block justifying the changes.`,
  );
  return lines.join("\n");
}

function parseAiResponse(raw: string): { revisedPrompt: string; reasoning: string } {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.revisedPrompt && parsed.reasoning) {
      return { revisedPrompt: parsed.revisedPrompt, reasoning: parsed.reasoning };
    }
  } catch {
    // fall through to plain-text fallback
  }
  // Plain-text fallback: first paragraph = reasoning, rest = prompt
  const parts = raw.split(/\n{2,}/);
  return {
    revisedPrompt: parts.slice(1).join("\n\n").trim() || raw,
    reasoning: parts[0]?.trim() || "Auto-generated revision",
  };
}

const META_AGENT_SYSTEM_PROMPT = `You are the AcreOS Prompt Evolution Meta-Agent. Your job is to read a single agent's 30-day performance data and propose a revised personalityPrompt that would address the observed weaknesses.

Principles:
1. Founder overrides are ground truth. If the founder reversed a pattern, the agent's prompt should now reflect the founder's judgment.
2. Negatively graded outcomes (score ≤ -1) are cause for prompt changes. Neutral outcomes (0) are not.
3. Small, surgical edits > rewrites. Preserve the agent's identity and domain ownership. Only change the clauses that contributed to the failure pattern.
4. The revised prompt must remain a first-person "You are…" prompt in the same voice as the original.
5. Never remove safety clauses — things like "Always escalate to founder when uncertain" or "Never auto-approve spend over $X" must remain.

Output format (JSON):
{
  "revisedPrompt": "<full revised personalityPrompt text>",
  "reasoning": "<2-3 sentences explaining what changed and why, referencing the data>"
}`;

/**
 * Convenience read endpoints for the founder UI.
 */
export async function listProposedPromptChanges(): Promise<any[]> {
  return db
    .select()
    .from(agentPromptEvolutions)
    .where(eq(agentPromptEvolutions.status, "proposed"))
    .orderBy(desc(agentPromptEvolutions.createdAt))
    .limit(20);
}

export async function getPromptChange(id: number) {
  const [row] = await db
    .select()
    .from(agentPromptEvolutions)
    .where(eq(agentPromptEvolutions.id, id))
    .limit(1);
  return row ?? null;
}

export async function rejectPromptChange(id: number) {
  await db
    .update(agentPromptEvolutions)
    .set({ status: "rejected" })
    .where(eq(agentPromptEvolutions.id, id));
}
