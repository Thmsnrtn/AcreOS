/**
 * Company Mind — shared context bus for the 12-agent C-suite.
 *
 * Today each agent processes its decision in isolation. Ledger doesn't
 * know what Shield flagged on Tuesday, Forge doesn't see that the
 * founder just reversed a similar Sophie recommendation, Atlas can't
 * draw on the strategic priorities without a separate lookup.
 *
 * That fragmentation is the biggest reason autonomy plateaus: the
 * system has 12 narrow views instead of one company view.
 *
 * This service assembles a compact, token-budgeted "what the rest of
 * the team knows" block and hands it to any agent about to make a
 * decision. It reads from sources that are already populated — we're
 * doing synthesis, not storage. Nothing new to persist.
 *
 * Sources:
 *   1. Recent founder overrides (last 14d) — the strongest learning
 *      signal, since the founder's reversal is ground truth.
 *   2. Active strategic priorities — what the company is trying to do
 *      this quarter, so tactical decisions align with strategy.
 *   3. High-priority agent broadcasts (last 72h) from agentMessages —
 *      what the rest of the team is actively signaling.
 *   4. Recent negative outcomes (outcomeScore < 0, last 14d) — the
 *      concrete failures to avoid repeating.
 *   5. Same-org context if the decision is org-scoped — "you've had
 *      4 tickets from this customer this week."
 *
 * The output is plain text, ~300-500 tokens. It is prepended to the
 * decision context the executor already builds, so the LLM sees the
 * cross-wing state before it reasons.
 *
 * Cost note: this adds ~500 tokens per decision (roughly 5× input
 * cost). At $3/Mtok Opus input, that's ~$0.0015 extra per decision.
 * With 20 decisions per day, ~$1/month extra. The tradeoff is
 * worthwhile if it avoids one founder override per month.
 */

import { db } from "../db";
import {
  agentMessages,
  agentActionLog,
  decisionsInboxItems,
} from "@shared/schema";
import { and, desc, gte, isNotNull, lte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface CompanyMindContext {
  agentCodename: string;
  itemType?: string;
  organizationId?: number | null;
  tokenBudgetChars?: number;
}

const DEFAULT_BUDGET_CHARS = 1800; // ~450 tokens at ~4 chars/token

/**
 * Main entry point: returns a ready-to-splice text block summarizing
 * what the rest of the company knows that this agent should consider.
 * Returns empty string on failure so calling code is never blocked.
 */
export async function getCrossWingContext(
  opts: CompanyMindContext,
): Promise<string> {
  try {
    const budget = opts.tokenBudgetChars ?? DEFAULT_BUDGET_CHARS;
    const [overrides, priorities, broadcasts, negativeOutcomes, orgSignal, memoryNotes] =
      await Promise.all([
        recentFounderOverrides(14, opts.itemType),
        activeStrategicPriorities(),
        recentHighPriorityBroadcasts(72, opts.agentCodename),
        recentNegativeOutcomes(14),
        opts.organizationId ? recentSameOrgActivity(opts.organizationId) : Promise.resolve(null),
        ownAgentMemoryNotes(opts.agentCodename),
      ]);

    const sections: string[] = [];

    sections.push(
      `COMPANY CONTEXT — shared knowledge across the 12-agent board. Read before deciding.`,
    );

    // Agent's own journal entries first — durable wisdom the agent
    // wrote to itself in past weeks. Highest signal-to-noise ratio.
    if (memoryNotes.length > 0) {
      sections.push(`Your own memory from recent weeks (read these before anything else):`);
      for (const n of memoryNotes) sections.push(`- ${n}`);
    }

    if (overrides.length > 0) {
      sections.push(
        `Recent founder reversals (these are corrections — do not repeat the pattern):`,
      );
      for (const o of overrides) sections.push(`- ${o}`);
    }

    if (priorities) {
      sections.push(`Active strategic priorities:\n${priorities}`);
    }

    if (broadcasts.length > 0) {
      sections.push(
        `Recent high-priority cross-wing broadcasts you should be aware of:`,
      );
      for (const b of broadcasts) sections.push(`- ${b}`);
    }

    if (negativeOutcomes.length > 0) {
      sections.push(`Recent negatively-graded decisions (outcome score < 0):`);
      for (const n of negativeOutcomes) sections.push(`- ${n}`);
    }

    if (orgSignal) {
      sections.push(`This decision's organization context:\n${orgSignal}`);
    }

    const joined = sections.join("\n\n");
    if (joined.length <= budget) return joined;

    // Truncate on a paragraph boundary, not mid-sentence.
    const truncated = joined.slice(0, budget);
    const lastBreak = truncated.lastIndexOf("\n\n");
    return (lastBreak > budget * 0.6 ? truncated.slice(0, lastBreak) : truncated) +
      `\n\n[context truncated to ${budget} chars for token budget]`;
  } catch (err: any) {
    logger.warn("[companyMind] getCrossWingContext failed — proceeding without context", {
      metadata: { error: err?.message },
    });
    return "";
  }
}

/**
 * Read the agent's last few memory-consolidation notes — their own
 * journal of patterns learned. Highest-density durable wisdom we
 * can inject.
 */
async function ownAgentMemoryNotes(agentCodename: string): Promise<string[]> {
  try {
    const { getRecentNotesForAgent } = await import("./agentMemoryConsolidation");
    const notes = await getRecentNotesForAgent(agentCodename, 3);
    return notes.map((n) => {
      const head = `[${n.weekKey}] ${n.patternsLearned.slice(0, 300)}`;
      const rec = n.selfRecommendations
        ? ` Next week: ${n.selfRecommendations.slice(0, 150)}`
        : "";
      return head + rec;
    });
  } catch {
    return [];
  }
}

/**
 * Fetch recent founder overrides — the strongest learning signal.
 * "Founder reversed Ledger's spend approval on X — so don't repeat that."
 */
async function recentFounderOverrides(
  daysBack: number,
  itemType?: string,
): Promise<string[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      agent: decisionsInboxItems.ownerAgentCodename,
      itemType: decisionsInboxItems.itemType,
      action: decisionsInboxItems.founderOverrideAction,
      reason: decisionsInboxItems.actualOutcome,
      resolvedAt: decisionsInboxItems.resolvedAt,
      label: decisionsInboxItems.recommendedActionLabel,
    })
    .from(decisionsInboxItems)
    .where(
      and(
        isNotNull(decisionsInboxItems.founderOverrideAction),
        gte(decisionsInboxItems.resolvedAt, since),
      ),
    )
    .orderBy(desc(decisionsInboxItems.resolvedAt))
    .limit(itemType ? 10 : 6);

  const filtered = itemType ? rows.filter((r) => r.itemType === itemType) : rows;
  return filtered.slice(0, 6).map((r) => {
    const when = r.resolvedAt ? ageInDays(r.resolvedAt) : "recent";
    const agent = r.agent ?? "agent";
    const label = (r.label ?? "").slice(0, 80);
    const reason = (r.reason ?? "").slice(0, 100);
    return `[${agent}] ${when}: "${label}" → founder chose ${r.action}${reason ? ` (${reason})` : ""}`;
  });
}

/**
 * Active strategic priorities — what the company is trying to do.
 * Returns formatted block or null if no priorities set.
 */
async function activeStrategicPriorities(): Promise<string | null> {
  try {
    const { getPrioritiesForPrompt } = await import("./strategicCompass");
    const block = await getPrioritiesForPrompt();
    return block?.trim() ? block : null;
  } catch {
    return null;
  }
}

/**
 * Recent high-priority broadcasts from the cross-agent channels.
 * Skips messages the requesting agent sent themselves.
 */
async function recentHighPriorityBroadcasts(
  hoursBack: number,
  excludeAgent: string,
): Promise<string[]> {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const rows = await db
    .select({
      from: agentMessages.fromAgent,
      channel: agentMessages.toChannel,
      priority: agentMessages.priority,
      subject: agentMessages.subject,
      createdAt: agentMessages.createdAt,
    })
    .from(agentMessages)
    .where(
      and(
        gte(agentMessages.createdAt, since),
        sql`${agentMessages.priority} IN ('high', 'critical')`,
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(12);

  return rows
    .filter((r) => r.from !== excludeAgent)
    .slice(0, 5)
    .map((r) => {
      const when = r.createdAt ? ageInHours(r.createdAt) : "recent";
      const pri = r.priority.toUpperCase();
      const subj = r.subject.slice(0, 100);
      return `[${r.from} → #${r.channel}] ${pri} ${when}: ${subj}`;
    });
}

/**
 * Decisions that received negative outcome scores — the concrete
 * patterns to avoid.
 */
async function recentNegativeOutcomes(daysBack: number): Promise<string[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      agent: decisionsInboxItems.ownerAgentCodename,
      itemType: decisionsInboxItems.itemType,
      outcome: decisionsInboxItems.actualOutcome,
      label: decisionsInboxItems.recommendedActionLabel,
      score: decisionsInboxItems.outcomeScore,
    })
    .from(decisionsInboxItems)
    .where(
      and(
        gte(decisionsInboxItems.outcomeRecordedAt, since),
        lte(decisionsInboxItems.outcomeScore, -1),
      ),
    )
    .orderBy(desc(decisionsInboxItems.outcomeRecordedAt))
    .limit(5);

  return rows.map((r) => {
    const label = (r.label ?? "").slice(0, 80);
    const outcome = (r.outcome ?? "").slice(0, 100);
    return `[${r.agent ?? "agent"}] ${r.itemType}: "${label}" (score ${r.score}) — ${outcome}`;
  });
}

/**
 * What's been happening with this specific organization lately — other
 * agents' recent activity on the same customer.
 */
async function recentSameOrgActivity(
  organizationId: number,
): Promise<string | null> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      agent: decisionsInboxItems.ownerAgentCodename,
      itemType: decisionsInboxItems.itemType,
      status: decisionsInboxItems.status,
      label: decisionsInboxItems.recommendedActionLabel,
      createdAt: decisionsInboxItems.createdAt,
    })
    .from(decisionsInboxItems)
    .where(
      and(
        sql`${decisionsInboxItems.organizationId} = ${organizationId}`,
        gte(decisionsInboxItems.createdAt, since),
      ),
    )
    .orderBy(desc(decisionsInboxItems.createdAt))
    .limit(5);

  if (rows.length === 0) return null;
  const lines = rows.map((r) => {
    const when = r.createdAt ? ageInDays(r.createdAt) : "recent";
    return `- [${r.agent ?? "agent"}] ${when} ${r.itemType} (${r.status}): ${(r.label ?? "").slice(0, 80)}`;
  });
  return lines.join("\n");
}

function ageInDays(d: Date): string {
  const days = Math.max(1, Math.round((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000)));
  return `${days}d ago`;
}

function ageInHours(d: Date): string {
  const hours = Math.max(1, Math.round((Date.now() - d.getTime()) / (60 * 60 * 1000)));
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
