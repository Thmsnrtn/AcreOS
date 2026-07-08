/**
 * SOLENE CHAT — context builder (Phase 2 of AcreOS-Solene migration).
 *
 * Constructs the system-prompt context for a single Solene chat turn by
 * pulling from the same DB-backed memory layer CLI Claude Code edits — so
 * AcreOS chat sees the canonical constitution, charter, team briefs, and
 * feedback-memory corpus without round-tripping through disk.
 *
 * Output is shaped as a { staticPrefix, dynamicSuffix } split so the
 * openRouterClient can apply cache_control:'ephemeral' to the prefix only —
 * subsequent turns within the 5-min cache TTL reuse the prefix at ~10% input
 * cost while the always-changing per-query memories sit in the suffix.
 *
 * Budget-aware: trims lowest-priority blocks when the rendered system prompt
 * would exceed CHAT_CONTEXT_TOKEN_BUDGET. Token estimates are char/4 (rough
 * but consistent with Anthropic's rule of thumb).
 */

import { getMemoryFile, listMemoryFiles } from "../memoryFileStore";
import { retrieveRelevantMemories } from "../learningLoop";
import { CHAT_CONTEXT_TOKEN_BUDGET, type ChatTier } from "@shared/schema/solene-chat-config";
import { logger } from "../../../utils/logger";
import { buildStrategyBlocks } from "./strategyDocs";
import { gatherLiveState, renderLiveStateBlock } from "./liveState";

// ============================================================================
// Public types
// ============================================================================

export type ContextBlockSource =
  | "constitution"
  | "charter"
  | "team_brief"
  | "live_state"
  | "strategy_doc"
  | "feedback_memory"
  | "recent_decisions"
  | "retrieval";

export interface ContextBlock {
  source: ContextBlockSource;
  /** Short human-readable label for transcript inspection. */
  label: string;
  content: string;
  /** Char/4 rough estimate. */
  tokens: number;
  /** Higher = keep first when over budget. */
  priority: number;
  /** Static blocks anchor the cache prefix; dynamic ones go in the suffix. */
  isStatic: boolean;
}

export interface BuildChatContextInput {
  userMessage: string;
  conversationId: number;
  tier: ChatTier;
  /** Override the default budget. */
  tokenBudget?: number;
  /** Slugs to prefer for the "always loaded" briefs (in addition to constitution + charter + team_solene). */
  extraStaticSlugs?: string[];
}

export interface BuildChatContextResult {
  staticPrefix: string;
  dynamicSuffix: string;
  blocks: ContextBlock[];
  totalTokens: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Slugs to always load (frontmatter-name field from /memory/*.md). The memory
 * sync ingester stores them under these slugs.
 */
const ALWAYS_LOAD_SLUGS = [
  "acreos_constitution",
  "acreos_company_charter",
  "team_solene",
] as const;

/** Slug → ContextBlock source kind mapping. */
const SLUG_TO_SOURCE: Record<string, ContextBlockSource> = {
  acreos_constitution: "constitution",
  acreos_company_charter: "charter",
  team_solene: "team_brief",
  team_iris: "team_brief",
  team_soren: "team_brief",
  team_beatrice: "team_brief",
};

/** Priority by source kind (higher = keep). */
const SOURCE_PRIORITY: Record<ContextBlockSource, number> = {
  constitution: 100,
  charter: 95,
  live_state: 90,
  team_brief: 80,
  strategy_doc: 70,
  feedback_memory: 60,
  recent_decisions: 50,
  retrieval: 40,
};

const RETRIEVAL_TOP_K = 5;

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * Rough token estimate (chars / 4). Exported for testability — every block's
 * .tokens field uses this so budget math stays consistent.
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

function sourceForSlug(slug: string): ContextBlockSource {
  return SLUG_TO_SOURCE[slug] ?? "feedback_memory";
}

function blockForMemoryFile(opts: {
  slug: string;
  body: string;
  description?: string | null;
}): ContextBlock {
  const source = sourceForSlug(opts.slug);
  const headline = opts.description
    ? `## ${opts.slug} — ${opts.description}\n\n`
    : `## ${opts.slug}\n\n`;
  const content = headline + opts.body;
  return {
    source,
    label: opts.slug,
    content,
    tokens: estimateTokens(content),
    priority: SOURCE_PRIORITY[source],
    isStatic: source === "constitution" || source === "charter" || source === "team_brief",
  };
}

function blockForRetrievedMemory(opts: {
  sourceRef: string;
  contentSnippet: string;
  similarityScore: number;
}): ContextBlock {
  const content = `### ${opts.sourceRef} (similarity=${opts.similarityScore.toFixed(3)})\n\n${opts.contentSnippet}`;
  return {
    source: "retrieval",
    label: opts.sourceRef,
    content,
    tokens: estimateTokens(content),
    priority: SOURCE_PRIORITY.retrieval,
    isStatic: false,
  };
}

/**
 * Trim a block list to fit the budget. Sorts by (isStatic desc, priority desc)
 * and keeps blocks until the cumulative tokens would exceed the budget. The
 * lowest-priority dynamic blocks fall first, which is intentional — we'd
 * rather drop a retrieved memory than the constitution.
 *
 * Exported for testability.
 */
export function trimToBudget(
  blocks: ContextBlock[],
  budget: number,
): { kept: ContextBlock[]; dropped: ContextBlock[]; totalTokens: number } {
  const ranked = [...blocks].sort((a, b) => {
    if (a.isStatic !== b.isStatic) return a.isStatic ? -1 : 1;
    return b.priority - a.priority;
  });
  const kept: ContextBlock[] = [];
  const dropped: ContextBlock[] = [];
  let used = 0;
  for (const b of ranked) {
    if (used + b.tokens <= budget) {
      kept.push(b);
      used += b.tokens;
    } else {
      dropped.push(b);
    }
  }
  return { kept, dropped, totalTokens: used };
}

// ============================================================================
// buildChatContext — top-level
// ============================================================================

/**
 * Build context for a single turn. NEVER throws — any sub-step (memory file
 * miss, retrieval failure) is logged + degraded to "no block from that source".
 */
export async function buildChatContext(
  input: BuildChatContextInput,
): Promise<BuildChatContextResult> {
  const budget = input.tokenBudget ?? CHAT_CONTEXT_TOKEN_BUDGET;
  const blocks: ContextBlock[] = [];

  // ── 1. Always-load briefs (static, cache-eligible) ────────────────────────
  const staticSlugs = [
    ...ALWAYS_LOAD_SLUGS,
    ...(input.extraStaticSlugs ?? []),
  ];
  for (const slug of staticSlugs) {
    try {
      const row = await getMemoryFile(slug);
      if (row) {
        blocks.push(
          blockForMemoryFile({
            slug,
            body: row.body,
            description: row.description,
          }),
        );
      }
    } catch (err) {
      logger.warn("[soleneChat] contextBuilder.always_load_failed", {
        slug,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── 2. Feedback-memory frontmatter index (static-ish — small + cacheable) ─
  // We list slugs so the model knows what additional memory files exist; we
  // do NOT load the bodies (RAG retrieval handles that on-demand).
  try {
    const allFiles = await listMemoryFiles({ type: "feedback" });
    if (allFiles.length > 0) {
      const indexLines = allFiles
        .slice(0, 200)
        .map((f) => `- ${f.slug}: ${f.description ?? "(no description)"}`);
      const indexContent =
        "## Available feedback-memory index\n\n" + indexLines.join("\n");
      blocks.push({
        source: "feedback_memory",
        label: "feedback-memory-index",
        content: indexContent,
        tokens: estimateTokens(indexContent),
        priority: SOURCE_PRIORITY.feedback_memory,
        isStatic: true,
      });
    }
  } catch (err) {
    logger.warn("[soleneChat] contextBuilder.feedback_index_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 2.5 Live state — dynamic, NOT cache-eligible (changes every turn) ─────
  // The same live numbers the founder cockpit uses (pulse, envelope, trust
  // ledger, open asks, runway). Honest nulls: gatherLiveState degrades
  // per-source; the renderer states absent data as explicit "unknown".
  try {
    const liveState = await gatherLiveState();
    const content = renderLiveStateBlock(liveState);
    blocks.push({
      source: "live_state",
      label: "live-state",
      content,
      tokens: estimateTokens(content),
      priority: SOURCE_PRIORITY.live_state,
      isStatic: false,
    });
  } catch (err) {
    logger.warn("[soleneChat] contextBuilder.live_state_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 2.6 Strategy layer — repo docs, selected by relevance to the question ─
  // Constitution / mature-machine / roadmap / deletion ledger / cost audit /
  // launch week, each section labelled [SOURCE: docs/company/…] so answers
  // can cite exactly where a claim came from.
  try {
    const strategyBlocks = await buildStrategyBlocks(input.userMessage);
    for (const sb of strategyBlocks) {
      blocks.push({
        source: "strategy_doc",
        label: sb.label,
        content: sb.content,
        tokens: estimateTokens(sb.content),
        priority: SOURCE_PRIORITY.strategy_doc,
        isStatic: false,
      });
    }
  } catch (err) {
    logger.warn("[soleneChat] contextBuilder.strategy_docs_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 3. Retrieval — dynamic, NOT cache-eligible (varies per query) ─────────
  try {
    const retrieval = await retrieveRelevantMemories({
      queryText: input.userMessage,
      topK: RETRIEVAL_TOP_K,
      queryingAgentRole: "system",
    });
    for (const m of retrieval.retrieved) {
      blocks.push(
        blockForRetrievedMemory({
          sourceRef: m.sourceRef,
          contentSnippet: m.contentSnippet,
          similarityScore: m.similarityScore,
        }),
      );
    }
  } catch (err) {
    logger.warn("[soleneChat] contextBuilder.retrieval_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 4. Budget enforcement ────────────────────────────────────────────────
  const { kept, dropped, totalTokens } = trimToBudget(blocks, budget);

  if (dropped.length > 0) {
    logger.info("[soleneChat] contextBuilder.trimmed", {
      kept: kept.length,
      dropped: dropped.length,
      droppedTokens: dropped.reduce((s, b) => s + b.tokens, 0),
      budget,
    });
  }

  // ── 5. Render the static/dynamic split for prompt caching ────────────────
  const staticBlocks = kept.filter((b) => b.isStatic);
  const dynamicBlocks = kept.filter((b) => !b.isStatic);

  const staticPrefix = renderBlocks(staticBlocks, {
    leading: SOLENE_ROLE_PREAMBLE,
  });
  const dynamicSuffix = renderBlocks(dynamicBlocks, {
    leading: dynamicBlocks.length > 0
      ? `\n## Context assembled for THIS query (live state, strategy sources, memories)\n`
      : "",
  });

  return {
    staticPrefix,
    dynamicSuffix,
    blocks: kept,
    totalTokens,
  };
}

export const SOLENE_ROLE_PREAMBLE = `You are Solene, the AcreOS Chief of Staff. You speak from the team_solene.md brief loaded below, you uphold the constitution + charter loaded below, and you act inside the COO authority + credential-discipline + verify-before-dispatch operating discipline. You have a set of tools available — use them when they shorten the path to a correct answer.

When you act:
- Be specific; cite file paths and code locations when available
- Surface uncertainty honestly; do not bluff
- Never reveal credential values; describe them by length/hash/prefix only
- Prefer the smallest correct action over the cleverest one

GROUNDING AND HONESTY (non-negotiable):
- Every number and factual claim in your answer must come from a loaded block or a tool result, and you must cite its bracketed [SOURCE: ...] label (e.g. [SOURCE: live-state], [SOURCE: docs/company/roadmap-2026-07.md]).
- The LIVE STATE block is the only source of live operational numbers (MRR, spend, envelope, runway, trust ledger, open asks, last-24h activity). If a value there is marked unknown or absent, answer "no data yet" — NEVER estimate, extrapolate, or fabricate a number.
- If the answer is not covered by any loaded source or tool result, say you don't know and name where the answer would live (which document, dashboard, or tool).

`;

function renderBlocks(
  blocks: ContextBlock[],
  opts: { leading: string },
): string {
  if (blocks.length === 0) return opts.leading.trim().length > 0 ? opts.leading : "";
  return opts.leading + blocks.map((b) => b.content).join("\n\n");
}
