/**
 * SOLENE — self-debugging (L3.13).
 *
 * When a code-review marks an original dispatch as 'flagged', the ORIGINAL
 * agent is called back to introspect on the reviewer's findings, diagnose
 * the root cause, and propose a fix (not blindly re-implement). This closes
 * the feedback loop without Solene-in-the-middle.
 *
 * Wiring:
 *   codeReviewQueue.recordReviewOutcome(reviewId, 'flagged', findings)
 *     └─ fire-and-forget call to enqueueSelfDebugDispatch({
 *          originalDispatchId, reviewDispatchId, findings,
 *        })
 *          ├─ idempotency: skip if a self_debug dispatch already exists for
 *          │   this (originalId, reviewId) tuple (and isn't failed/cancelled)
 *          ├─ load original's agentRole + promptText + maxCostUsd
 *          ├─ render the self-debug INTROSPECTION prompt
 *          └─ enqueue a new dispatch: sourceType='self_debug',
 *             sourceId='flagged:<originalId>:by:<reviewId>',
 *             same agentRole as original,
 *             maxCostUsd = max($5, original/2),
 *             timeout = 5min, priority = 1.5.
 *
 * Non-recursion: self_debug dispatches themselves never produce another
 * self_debug — they don't enter the code-review path (code-review only fires
 * for the original work-producing dispatch classes), and even if they did,
 * recordReviewOutcome's flagged-branch only fires when there's a populated
 * original_dispatch_id, which self_debug dispatches don't carry.
 *
 * This service NEVER throws — it catches enqueueDispatch errors and surfaces
 * them on the result object so the caller (a fire-and-forget hook) doesn't
 * need a top-level try/catch.
 */

import { and, eq, inArray, not } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDispatchQueue,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { enqueueDispatch } from "./dispatchQueue";
import { logger } from "../../utils/logger";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface SelfDebugInput {
  originalDispatchId: number;
  reviewDispatchId: number;
  /** The review's flagged findings, raw text. */
  findings: string;
  /** When true, return what would be enqueued without actually enqueueing. */
  dryRun?: boolean;
}

export interface SelfDebugResult {
  enqueued: boolean;
  selfDebugDispatchId: number | null;
  /** Populated when enqueued=false. */
  reason?: string;
  /** Always populated — useful for dry-run + observability. */
  promptPreview: string;
}

// ----------------------------------------------------------------------------
// Self-debug prompt template
// ----------------------------------------------------------------------------

export const SELF_DEBUG_PROMPT_TEMPLATE = `You are {ORIGINAL_AGENT_ROLE}. Your prior work on dispatch #{ORIGINAL_ID}
was reviewed by dispatch #{REVIEW_ID} and FLAGGED with the following
findings:

{REVIEW_FINDINGS}

Your original prompt summary:
{ORIGINAL_PROMPT_SUMMARY}

Your task is NOT to immediately re-implement. Your task is to:

1. INTROSPECT. Read the findings carefully. What did you actually do? What
   did the reviewer expect? Where did your interpretation diverge?

2. DIAGNOSE. Identify the root cause — the smallest hypothesis that
   explains the gap between your output and the expected output.

3. PROPOSE. Write a 1-2 paragraph proposed fix. Do NOT change any code yet.
   Just describe the fix: what file(s), what line(s) of reasoning, what
   the new behavior should be.

End your turn with a structured PROPOSAL block:

  ROOT_CAUSE: <one sentence>
  PROPOSED_FIX: <concrete description, file:line if known>
  CONFIDENCE: <0-100>%

Solene reads this proposal and decides whether to dispatch a fix or escalate.`;

/**
 * Builds the self-debug prompt — exported for tests + dry-run preview.
 */
export function buildSelfDebugPrompt(opts: {
  originalDispatchId: number;
  reviewDispatchId: number;
  originalAgentRole: SoleneDispatchAgentRole;
  /** First 500 chars of the original's promptText. */
  originalPromptSummary: string;
  reviewFindings: string;
}): string {
  return SELF_DEBUG_PROMPT_TEMPLATE.replace(
    /\{ORIGINAL_ID\}/g,
    String(opts.originalDispatchId),
  )
    .replace(/\{REVIEW_ID\}/g, String(opts.reviewDispatchId))
    .replace(/\{ORIGINAL_AGENT_ROLE\}/g, opts.originalAgentRole)
    .replace(
      /\{ORIGINAL_PROMPT_SUMMARY\}/g,
      opts.originalPromptSummary.slice(0, 500),
    )
    .replace(/\{REVIEW_FINDINGS\}/g, opts.reviewFindings);
}

// ----------------------------------------------------------------------------
// enqueueSelfDebugDispatch
// ----------------------------------------------------------------------------

const SELF_DEBUG_COST_FLOOR_USD = 5;
const SELF_DEBUG_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SELF_DEBUG_PRIORITY = 1.5;

function buildSelfDebugSourceId(
  originalDispatchId: number,
  reviewDispatchId: number,
): string {
  return `flagged:${originalDispatchId}:by:${reviewDispatchId}`;
}

/**
 * When a code-review marks an original dispatch as 'flagged', enqueue a
 * self-debug dispatch back to the ORIGINAL agent. See module header for
 * the full contract.
 *
 * Returns { enqueued: true, selfDebugDispatchId } on success.
 * Returns { enqueued: false, reason } when:
 *   - 'original_not_found' — the original dispatch row doesn't exist
 *   - 'already_debugging' — a non-failed/non-cancelled self_debug dispatch
 *     for this (originalId, reviewId) tuple already exists
 *   - 'dry_run' — caller passed dryRun=true
 *   - 'enqueue_failed: <msg>' — enqueueDispatch threw (never re-thrown)
 *
 * Never throws.
 */
export async function enqueueSelfDebugDispatch(
  input: SelfDebugInput,
): Promise<SelfDebugResult> {
  const { originalDispatchId, reviewDispatchId, findings, dryRun } = input;
  const sourceId = buildSelfDebugSourceId(originalDispatchId, reviewDispatchId);

  // 1. Load the original dispatch row — we need agentRole + promptText +
  //    maxCostUsd to render the prompt + set the cost cap.
  let original: {
    agentRole: string;
    promptText: string;
    maxCostUsd: string;
  } | undefined;
  try {
    const rows = await db
      .select({
        agentRole: soleneDispatchQueue.agentRole,
        promptText: soleneDispatchQueue.promptText,
        maxCostUsd: soleneDispatchQueue.maxCostUsd,
      })
      .from(soleneDispatchQueue)
      .where(eq(soleneDispatchQueue.id, originalDispatchId))
      .limit(1);
    original = rows[0];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[selfDebug] failed to load original id=${originalDispatchId}: ${msg}`,
    );
    return {
      enqueued: false,
      selfDebugDispatchId: null,
      reason: `enqueue_failed: ${msg}`,
      promptPreview: "",
    };
  }

  if (!original) {
    logger.warn(
      `[selfDebug] original id=${originalDispatchId} not found; skipping`,
    );
    return {
      enqueued: false,
      selfDebugDispatchId: null,
      reason: "original_not_found",
      promptPreview: "",
    };
  }

  const promptPreview = buildSelfDebugPrompt({
    originalDispatchId,
    reviewDispatchId,
    originalAgentRole: original.agentRole as SoleneDispatchAgentRole,
    originalPromptSummary: original.promptText,
    reviewFindings: findings,
  });

  // 2. Idempotency — skip if a self_debug dispatch for this tuple already
  //    exists and isn't terminally-dead (failed / cancelled).
  try {
    const existing = await db
      .select({ id: soleneDispatchQueue.id })
      .from(soleneDispatchQueue)
      .where(
        and(
          eq(soleneDispatchQueue.sourceType, "self_debug"),
          eq(soleneDispatchQueue.sourceId, sourceId),
          not(inArray(soleneDispatchQueue.status, ["failed", "cancelled"])),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      logger.info(
        `[selfDebug] already_debugging — self_debug exists for ${sourceId} (id=${existing[0].id})`,
      );
      return {
        enqueued: false,
        selfDebugDispatchId: null,
        reason: "already_debugging",
        promptPreview,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[selfDebug] idempotency check failed: ${msg}`);
    return {
      enqueued: false,
      selfDebugDispatchId: null,
      reason: `enqueue_failed: ${msg}`,
      promptPreview,
    };
  }

  // 3. Cost cap — half the original, floored at $5.
  const originalCap = Number(original.maxCostUsd);
  const halfCap =
    Number.isFinite(originalCap) && originalCap > 0
      ? originalCap / 2
      : SELF_DEBUG_COST_FLOOR_USD;
  const maxCostUsd = Math.max(SELF_DEBUG_COST_FLOOR_USD, halfCap);

  // 4. Dry-run short-circuit — no enqueue.
  if (dryRun) {
    return {
      enqueued: false,
      selfDebugDispatchId: null,
      reason: "dry_run",
      promptPreview,
    };
  }

  // 5. Enqueue.
  try {
    const selfDebugDispatchId = await enqueueDispatch({
      sourceType: "self_debug",
      sourceId,
      agentRole: original.agentRole as SoleneDispatchAgentRole,
      promptText: promptPreview,
      maxCostUsd,
      timeoutMs: SELF_DEBUG_TIMEOUT_MS,
      priority: SELF_DEBUG_PRIORITY,
      enqueuedBy: "selfDebug",
    });

    logger.info(
      `[selfDebug] enqueued id=${selfDebugDispatchId} for ${sourceId} (role=${original.agentRole}, cap=$${maxCostUsd.toFixed(2)})`,
    );

    return {
      enqueued: true,
      selfDebugDispatchId,
      promptPreview,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[selfDebug] enqueueDispatch failed for ${sourceId}: ${msg}`);
    return {
      enqueued: false,
      selfDebugDispatchId: null,
      reason: `enqueue_failed: ${msg}`,
      promptPreview,
    };
  }
}
