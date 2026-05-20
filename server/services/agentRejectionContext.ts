/**
 * Agent rejection context — RLHF-lite for every LLM-using agent.
 *
 * Generalizes the CMO agent's `cmo_rejection_notes` pattern (shipped
 * 2026-05-20) across every agent. When the founder rejects an agent's
 * proposal via the decisions inbox or any other surface, the note +
 * tags land in `agent_rejection_notes`. The next time the agent
 * generates content (LLM call), it pulls the last N relevant notes
 * into its system prompt as "things the founder has consistently
 * pushed back on — avoid these patterns."
 *
 * Usage:
 *   const context = await loadRejectionContext({ agentCodename: 'sophie', limit: 30 });
 *   // append `context.systemPromptBlock` to your system prompt
 *
 * Recording:
 *   await recordRejection({
 *     agentCodename: 'sophie',
 *     decisionsInboxItemId: 12345,
 *     tags: ['tone_off', 'overpromise'],
 *     note: 'Don\'t lead with "we noticed you're struggling" — feels presumptuous',
 *     rejectedBy: 'founder@acreos.io',
 *   });
 *
 * Lifecycle:
 *   - recordRejection() insert: append a row
 *   - loadRejectionContext() select: pull most recent N (by default 30)
 *     for the agent, mark them consumedAt so observability can answer
 *     "did the agent see this feedback?" The consumedAt write is best-
 *     effort and idempotent; it doesn't gate retrieval.
 */

import { db } from "../db";
import { agentRejectionNotes, type AgentRejectionNote } from "@shared/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const DEFAULT_LIMIT = 30;
const SYSTEM_PROMPT_LIMIT = 12; // we don't want to swamp the context window

export interface RecordRejectionArgs {
  agentCodename: string;
  decisionsInboxItemId?: number;
  tags?: string[];
  note?: string | null;
  rejectedBy: string;
}

export async function recordRejection(args: RecordRejectionArgs): Promise<AgentRejectionNote> {
  const [row] = await db
    .insert(agentRejectionNotes)
    .values({
      agentCodename: args.agentCodename,
      decisionsInboxItemId: args.decisionsInboxItemId ?? null,
      tags: args.tags ?? [],
      note: args.note ?? null,
      rejectedBy: args.rejectedBy,
    })
    .returning();
  logger.info(`[rejection] recorded for agent=${args.agentCodename} tags=[${(args.tags ?? []).join(",")}] note='${(args.note ?? "").slice(0, 60)}'`);
  return row;
}

export interface LoadRejectionContextArgs {
  agentCodename: string;
  /** Max number of notes to surface. Default 30 raw; only the most recent
   *  SYSTEM_PROMPT_LIMIT (12) are formatted into the system prompt block. */
  limit?: number;
  /** Optional tag filter; pulls only notes carrying any of these tags. */
  tags?: string[];
  /** If true, marks returned notes consumedAt=now() so observability can
   *  answer "did the agent see this feedback?" Default true. */
  markConsumed?: boolean;
}

export interface RejectionContext {
  notes: AgentRejectionNote[];
  /** Formatted block to append to an LLM system prompt. Empty string when
   *  there are no notes — caller can concatenate unconditionally. */
  systemPromptBlock: string;
}

export async function loadRejectionContext(args: LoadRejectionContextArgs): Promise<RejectionContext> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const markConsumed = args.markConsumed ?? true;

  const baseWhere = [eq(agentRejectionNotes.agentCodename, args.agentCodename)];
  // If tags filter provided, use array-overlap to find rows whose tags
  // array shares at least one element with the filter.
  if (args.tags && args.tags.length > 0) {
    baseWhere.push(sql`${agentRejectionNotes.tags} && ${args.tags}`);
  }

  const notes = await db
    .select()
    .from(agentRejectionNotes)
    .where(and(...baseWhere))
    .orderBy(desc(agentRejectionNotes.rejectedAt))
    .limit(limit);

  if (notes.length === 0) {
    return { notes: [], systemPromptBlock: "" };
  }

  const systemPromptBlock = buildSystemPromptBlock(notes.slice(0, SYSTEM_PROMPT_LIMIT));

  if (markConsumed) {
    const unconsumedIds = notes.filter((n) => n.consumedAt === null).map((n) => n.id);
    if (unconsumedIds.length > 0) {
      // Best-effort; don't block retrieval on the consumedAt write.
      void db
        .update(agentRejectionNotes)
        .set({ consumedAt: new Date() })
        .where(inArray(agentRejectionNotes.id, unconsumedIds))
        .catch((err) => {
          logger.warn(`[rejection] consumedAt mark failed for ${unconsumedIds.length} ids: ${err instanceof Error ? err.message : err}`);
        });
    }
  }

  return { notes, systemPromptBlock };
}

function buildSystemPromptBlock(notes: AgentRejectionNote[]): string {
  if (notes.length === 0) return "";

  const lines = notes.map((n, i) => {
    const tagPart = n.tags.length > 0 ? `[${n.tags.join(", ")}] ` : "";
    const notePart = n.note ?? "(no note — rejection only)";
    return `  ${i + 1}. ${tagPart}${notePart}`;
  });

  return [
    "",
    "RECENT FOUNDER REJECTIONS — these are patterns the founder has consistently pushed back on. Do not repeat these mistakes in your output.",
    ...lines,
    "",
  ].join("\n");
}

/**
 * Quick aggregate stats for the agent council view (Phase D). Returns
 * count + most-common tags + most-recent-note for one agent.
 */
export async function getRejectionSummary(agentCodename: string, windowDays = 30) {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      tags: agentRejectionNotes.tags,
      note: agentRejectionNotes.note,
      rejectedAt: agentRejectionNotes.rejectedAt,
    })
    .from(agentRejectionNotes)
    .where(
      and(
        eq(agentRejectionNotes.agentCodename, agentCodename),
        sql`${agentRejectionNotes.rejectedAt} >= ${cutoff}`,
      ),
    )
    .orderBy(desc(agentRejectionNotes.rejectedAt));

  const tagCounts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalCount: rows.length,
    windowDays,
    topTags,
    mostRecentNote: rows[0]?.note ?? null,
    mostRecentAt: rows[0]?.rejectedAt ?? null,
  };
}
