/**
 * Agent Memory Consolidation — the long-term memory layer.
 *
 * Company Mind gives agents a 14-day signal window. That's good for
 * recent context but thin on durable wisdom — patterns an agent
 * learned two months ago fall out of the context window entirely.
 *
 * This service closes that gap. Weekly, for each active agent:
 *   1. Pull the last 7 days of the agent's activity: decisions made,
 *      outcome scores, founder overrides.
 *   2. Ask Opus to distill it into a short prose "what I learned this
 *      week" + explicit wins + losses + self-recommendations.
 *   3. Persist as an agent_memory_notes row.
 *
 * Company Mind then reads the 4 most recent notes per agent and
 * includes the patternsLearned text in the cross-wing context block.
 * Over 12 weeks an agent accumulates ~12 notes = ~3 months of
 * distilled wisdom that's compact enough to include in every
 * decision prompt.
 *
 * Skip conditions:
 *   - Agents with <3 graded decisions in the window get no note
 *     (not enough signal to summarize)
 *   - Agents that already have a note for the current weekKey get
 *     skipped (idempotent)
 *
 * Cost: ~$0.04 per LLM call × 12 agents × weekly = ~$2/month. Cheap
 * for durable memory.
 */

import { db } from "../db";
import {
  agentMemoryNotes,
  companyAgents,
  decisionsInboxItems,
} from "@shared/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { routeCriticalTask } from "./aiRouter";

interface AgentWeekSlice {
  agentCodename: string;
  decisionsAnalyzed: number;
  positivelyGraded: Array<{ label: string; outcome: string | null }>;
  negativelyGraded: Array<{ label: string; outcome: string | null; reversal: string | null }>;
  deferrals: Array<{ label: string }>;
}

export interface ConsolidationResult {
  weekKey: string;
  agentsScanned: number;
  notesWritten: number;
  skipped: Array<{ agent: string; reason: string }>;
}

const MIN_DECISIONS_FOR_NOTE = 3;

export async function runWeeklyMemoryConsolidation(): Promise<ConsolidationResult> {
  const weekKey = isoWeekKey(new Date());
  const agents = await db
    .select()
    .from(companyAgents)
    .where(eq(companyAgents.status, "active"));

  const skipped: ConsolidationResult["skipped"] = [];
  let notesWritten = 0;

  for (const agent of agents) {
    // Skip if a note already exists for this agent for this week.
    const existing = await db
      .select({ id: agentMemoryNotes.id })
      .from(agentMemoryNotes)
      .where(
        and(
          eq(agentMemoryNotes.agentCodename, agent.codename),
          eq(agentMemoryNotes.weekKey, weekKey),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      skipped.push({ agent: agent.codename, reason: "already noted for this week" });
      continue;
    }

    const slice = await buildAgentWeekSlice(agent.codename);
    if (slice.decisionsAnalyzed < MIN_DECISIONS_FOR_NOTE) {
      skipped.push({
        agent: agent.codename,
        reason: `only ${slice.decisionsAnalyzed} decisions (< ${MIN_DECISIONS_FOR_NOTE})`,
      });
      continue;
    }

    try {
      const note = await distill(slice);
      await db.insert(agentMemoryNotes).values({
        agentCodename: agent.codename,
        weekKey,
        patternsLearned: note.patternsLearned.slice(0, 3000),
        wins: note.wins,
        losses: note.losses,
        selfRecommendations: note.selfRecommendations.slice(0, 1000),
        decisionsAnalyzed: slice.decisionsAnalyzed,
      });
      notesWritten++;
    } catch (err: any) {
      skipped.push({ agent: agent.codename, reason: `error: ${err?.message ?? err}` });
      logger.warn("[agentMemory] consolidation failed", {
        metadata: { agent: agent.codename, error: err?.message },
      });
    }
  }

  logger.info(
    `[agentMemory] week ${weekKey}: ${notesWritten} notes, ${skipped.length} skipped`,
  );
  return { weekKey, agentsScanned: agents.length, notesWritten, skipped };
}

async function buildAgentWeekSlice(agentCodename: string): Promise<AgentWeekSlice> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      label: decisionsInboxItems.recommendedActionLabel,
      outcomeScore: decisionsInboxItems.outcomeScore,
      outcome: decisionsInboxItems.actualOutcome,
      status: decisionsInboxItems.status,
      override: decisionsInboxItems.founderOverrideAction,
    })
    .from(decisionsInboxItems)
    .where(
      and(
        eq(decisionsInboxItems.ownerAgentCodename, agentCodename),
        gte(decisionsInboxItems.createdAt, since),
      ),
    );

  const positivelyGraded = rows
    .filter((r) => r.outcomeScore != null && r.outcomeScore > 0)
    .slice(0, 5)
    .map((r) => ({ label: r.label, outcome: r.outcome }));
  const negativelyGraded = rows
    .filter((r) => (r.outcomeScore != null && r.outcomeScore < 0) || r.override != null)
    .slice(0, 5)
    .map((r) => ({ label: r.label, outcome: r.outcome, reversal: r.override }));
  const deferrals = rows
    .filter((r) => r.status === "deferred")
    .slice(0, 5)
    .map((r) => ({ label: r.label }));

  return {
    agentCodename,
    decisionsAnalyzed: rows.length,
    positivelyGraded,
    negativelyGraded,
    deferrals,
  };
}

async function distill(slice: AgentWeekSlice): Promise<{
  patternsLearned: string;
  wins: string[];
  losses: string[];
  selfRecommendations: string;
}> {
  const lines: string[] = [];
  lines.push(`AGENT: ${slice.agentCodename}`);
  lines.push(`DECISIONS ANALYZED (last 7 days): ${slice.decisionsAnalyzed}`);
  lines.push("");
  if (slice.positivelyGraded.length > 0) {
    lines.push(`POSITIVELY GRADED:`);
    for (const p of slice.positivelyGraded) {
      lines.push(`  - "${p.label.slice(0, 100)}" — ${p.outcome ?? ""}`);
    }
  }
  if (slice.negativelyGraded.length > 0) {
    lines.push("");
    lines.push(`NEGATIVELY GRADED / FOUNDER-REVERSED:`);
    for (const n of slice.negativelyGraded) {
      lines.push(
        `  - "${n.label.slice(0, 100)}" — ${n.outcome ?? ""}${n.reversal ? ` (founder: ${n.reversal})` : ""}`,
      );
    }
  }
  if (slice.deferrals.length > 0) {
    lines.push("");
    lines.push(`DEFERRED (low-confidence):`);
    for (const d of slice.deferrals) {
      lines.push(`  - "${d.label.slice(0, 100)}"`);
    }
  }
  lines.push("");
  lines.push(
    `Distill this week into a short memory note this agent will read before deciding in future weeks. Return JSON { patternsLearned, wins, losses, selfRecommendations }.`,
  );
  const context = lines.join("\n");

  const response = await routeCriticalTask(
    "agent_memory_note",
    MEMORY_SYSTEM_PROMPT,
    context,
  );
  return parseMemoryResponse(response.content);
}

function parseMemoryResponse(raw: string): {
  patternsLearned: string;
  wins: string[];
  losses: string[];
  selfRecommendations: string;
} {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      patternsLearned: String(parsed.patternsLearned ?? "").slice(0, 3000),
      wins: Array.isArray(parsed.wins) ? parsed.wins.map(String).slice(0, 5) : [],
      losses: Array.isArray(parsed.losses) ? parsed.losses.map(String).slice(0, 5) : [],
      selfRecommendations: String(parsed.selfRecommendations ?? "").slice(0, 1000),
    };
  } catch {
    return {
      patternsLearned: raw.slice(0, 3000),
      wins: [],
      losses: [],
      selfRecommendations: "",
    };
  }
}

/**
 * Recent memory notes for a given agent, newest first. Read by
 * Company Mind when assembling cross-wing context, and by the
 * prompt-evolution meta-agent when prescribing revisions.
 */
export async function getRecentNotesForAgent(
  agentCodename: string,
  limit: number = 4,
) {
  return db
    .select()
    .from(agentMemoryNotes)
    .where(eq(agentMemoryNotes.agentCodename, agentCodename))
    .orderBy(desc(agentMemoryNotes.createdAt))
    .limit(limit);
}

export async function listAllNotes(limit: number = 50) {
  return db
    .select()
    .from(agentMemoryNotes)
    .orderBy(desc(agentMemoryNotes.createdAt))
    .limit(limit);
}

function isoWeekKey(d: Date): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${target.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

const MEMORY_SYSTEM_PROMPT = `You are distilling one AcreOS agent's week of decisions into a short memory note that THE SAME AGENT will read before deciding next week.

Purpose: give the agent durable knowledge of what worked, what didn't, and what to do differently — at a level deeper than just "this decision was wrong." Think of it as the agent's journal entry.

Rules:
- Write patternsLearned in the agent's own voice: "I noticed that…", "I'm finding that…"
- Wins and losses are terse bullet points (1 sentence each, no more).
- selfRecommendations are 1-2 concrete adjustments to make next week.
- Reference specifics from the data. Don't generalize to "be more careful" — name the situation.
- Land Investors terminology; no emojis; no competitor references.

Output JSON (no code fences):
{
  "patternsLearned": "<2-4 sentences of agent-voice prose>",
  "wins": ["<short bullet>", "<short bullet>", ...],
  "losses": ["<short bullet>", ...],
  "selfRecommendations": "<1-2 concrete adjustments>"
}`;
