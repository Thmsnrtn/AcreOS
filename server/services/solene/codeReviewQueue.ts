/**
 * SOLENE — multi-agent code review (L2.8).
 *
 * Every code-producing dispatch's terminal commit gets reviewed by a sibling
 * dispatch with agentRole='code-reviewer' before Solene treats the work as
 * landed. Catches the "Iris sub-agent committed without review" failure class.
 *
 * Wiring:
 *   dispatchQueue.completeDispatch()
 *     └─ if commits produced and dispatch is not itself a review
 *        └─ enqueueReviewDispatch(originalDispatchId)
 *             ├─ enqueue a NEW dispatch (agentRole='code-reviewer',
 *             │   sourceType='code_review', sourceId='dispatch:<id>',
 *             │   maxCostUsd = half the original's cap)
 *             ├─ stamp original_dispatch_id on the new row (links it back)
 *             ├─ stamp original's review_status='pending' +
 *             │   reviewed_by_dispatch_id=<new id>
 *             └─ return { reviewDispatchId, skipped: false }
 *
 *   When the review-dispatch itself completes, the worker layer (a follow-up
 *   wave) will parse its result for "VERDICT: passed | flagged" and call
 *   recordReviewOutcome() to update the original's review_status.
 *
 * Recursion guard: an enqueueReviewDispatch call against a dispatch that IS
 * already a review (original_dispatch_id IS NOT NULL or agentRole='code-reviewer')
 * is rejected — reviews never trigger reviews of themselves.
 */

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDispatchQueue,
  soleneDispatchResults,
  type SoleneDispatchReviewStatus,
} from "@shared/schema/solene-dispatch";
import { enqueueDispatch } from "./dispatchQueue";
import { logger } from "../../utils/logger";

// ----------------------------------------------------------------------------
// REVIEW_PROMPT_TEMPLATE
// ----------------------------------------------------------------------------
// Substitutions:
//   {ORIGINAL_ID}             — numeric dispatch id of the work being reviewed
//   {SHAS}                    — space-separated commit SHAs
//   {ORIGINAL_ROLE}           — agentRole of the original dispatch
//   {ORIGINAL_PROMPT_SUMMARY} — first 500 chars of the original's prompt
// ----------------------------------------------------------------------------
export const REVIEW_PROMPT_TEMPLATE = `You are a code reviewer dispatched to review the diff produced by dispatch #{ORIGINAL_ID}.

The original dispatch's commits: {SHAS}
The original dispatch's role: {ORIGINAL_ROLE}
The original dispatch's prompt summary (first 500 chars): {ORIGINAL_PROMPT_SUMMARY}

Your task:
1. Run \`git show {SHA}\` for each SHA and read the full diff.
2. Run \`npm run check\` and report whether tsc is clean.
3. Identify: correctness bugs, security issues, missed test coverage on changed lines, scope drift (changes outside what the original prompt asked for), and any violations of CLAUDE.md engineering standards (AuthenticatedRequest, Errors.*, structured logger, no \`as any\`).
4. End your turn with a single structured verdict block:

   VERDICT: passed | flagged
   FINDINGS:
   - <bullet 1>
   - <bullet 2>
   ...

Do NOT modify any files. Do NOT commit. Read-only review.`;

function renderReviewPrompt(args: {
  originalId: number;
  shas: string[];
  originalRole: string;
  originalPrompt: string;
}): string {
  return REVIEW_PROMPT_TEMPLATE.replace(
    /\{ORIGINAL_ID\}/g,
    String(args.originalId),
  )
    .replace(/\{SHAS\}/g, args.shas.join(" "))
    .replace(/\{ORIGINAL_ROLE\}/g, args.originalRole)
    .replace(
      /\{ORIGINAL_PROMPT_SUMMARY\}/g,
      args.originalPrompt.slice(0, 500),
    );
}

// ----------------------------------------------------------------------------
// enqueueReviewDispatch
// ----------------------------------------------------------------------------

export type EnqueueReviewSkipReason =
  | "no_commits"
  | "already_review"
  | "original_not_found"
  | "already_reviewed";

export interface EnqueueReviewResult {
  reviewDispatchId: number | null;
  skipped: boolean;
  skipReason?: EnqueueReviewSkipReason;
}

export interface EnqueueReviewOpts {
  /** Override the default review-prompt text entirely. */
  promptOverride?: string;
  /**
   * Override the review's cost cap. When omitted, defaults to half the
   * original dispatch's cap (reviews are lighter than the work being reviewed).
   */
  maxCostUsd?: number;
}

/**
 * Enqueue a code-review dispatch for the commits produced by dispatch
 * `originalDispatchId`. Returns `{ skipped: true, skipReason: ... }` and does
 * NOT enqueue when:
 *   - the original dispatch produced no commits ('no_commits')
 *   - the original is itself a review ('already_review')
 *   - the original doesn't exist ('original_not_found')
 *   - a review was already enqueued for this original ('already_reviewed')
 * Otherwise enqueues, stamps both rows, and returns the new dispatch id.
 */
export async function enqueueReviewDispatch(
  originalDispatchId: number,
  opts: EnqueueReviewOpts = {},
): Promise<EnqueueReviewResult> {
  // 1. Load the original dispatch row.
  const [original] = await db
    .select({
      id: soleneDispatchQueue.id,
      agentRole: soleneDispatchQueue.agentRole,
      promptText: soleneDispatchQueue.promptText,
      maxCostUsd: soleneDispatchQueue.maxCostUsd,
      originalDispatchId: soleneDispatchQueue.originalDispatchId,
      reviewedByDispatchId: soleneDispatchQueue.reviewedByDispatchId,
      reviewStatus: soleneDispatchQueue.reviewStatus,
    })
    .from(soleneDispatchQueue)
    .where(eq(soleneDispatchQueue.id, originalDispatchId))
    .limit(1);

  if (!original) {
    logger.warn(
      `[codeReviewQueue] enqueueReviewDispatch: original id=${originalDispatchId} not found`,
    );
    return {
      reviewDispatchId: null,
      skipped: true,
      skipReason: "original_not_found",
    };
  }

  // 2. Recursion guard — reviews never trigger reviews of themselves.
  if (
    original.agentRole === "code-reviewer" ||
    original.originalDispatchId !== null
  ) {
    logger.info(
      `[codeReviewQueue] skip — dispatch id=${originalDispatchId} IS a review; not recursing`,
    );
    return {
      reviewDispatchId: null,
      skipped: true,
      skipReason: "already_review",
    };
  }

  // 3. Idempotency — don't double-enqueue.
  if (original.reviewedByDispatchId !== null) {
    logger.info(
      `[codeReviewQueue] skip — dispatch id=${originalDispatchId} already has review id=${original.reviewedByDispatchId}`,
    );
    return {
      reviewDispatchId: null,
      skipped: true,
      skipReason: "already_reviewed",
    };
  }

  // 4. Pull the commits from the result row. If none, mark skipped + bail.
  const [resultRow] = await db
    .select({
      commitsReferenced: soleneDispatchResults.commitsReferenced,
    })
    .from(soleneDispatchResults)
    .where(eq(soleneDispatchResults.dispatchId, originalDispatchId))
    .orderBy(desc(soleneDispatchResults.recordedAt))
    .limit(1);

  const shas: string[] = Array.isArray(resultRow?.commitsReferenced)
    ? resultRow!.commitsReferenced.filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      )
    : [];

  if (shas.length === 0) {
    // Stamp the original as 'skipped' so the founder surface can distinguish
    // "no review needed" from "review pending".
    await db
      .update(soleneDispatchQueue)
      .set({ reviewStatus: "skipped" satisfies SoleneDispatchReviewStatus })
      .where(eq(soleneDispatchQueue.id, originalDispatchId));
    logger.info(
      `[codeReviewQueue] skip — dispatch id=${originalDispatchId} produced no commits; marked review_status=skipped`,
    );
    return {
      reviewDispatchId: null,
      skipped: true,
      skipReason: "no_commits",
    };
  }

  // 5. Cost cap — default to half the original's cap. The original is stored
  //    as a numeric(10,2) string; parse defensively.
  const originalCap = Number(original.maxCostUsd);
  const defaultReviewCap =
    Number.isFinite(originalCap) && originalCap > 0
      ? Math.max(0.01, originalCap / 2)
      : undefined;
  const maxCostUsd = opts.maxCostUsd ?? defaultReviewCap;

  // 6. Render the prompt.
  const promptText =
    opts.promptOverride ??
    renderReviewPrompt({
      originalId: originalDispatchId,
      shas,
      originalRole: original.agentRole,
      originalPrompt: original.promptText,
    });

  // 7. Enqueue the review dispatch.
  const reviewDispatchId = await enqueueDispatch({
    sourceType: "code_review",
    sourceId: `dispatch:${originalDispatchId}`,
    agentRole: "code-reviewer",
    promptText,
    maxCostUsd,
    enqueuedBy: `code-review:auto:${originalDispatchId}`,
  });

  // 8. Stamp the back-pointer on the review row + the forward pointer +
  //    review_status='pending' on the original row.
  await db
    .update(soleneDispatchQueue)
    .set({ originalDispatchId })
    .where(eq(soleneDispatchQueue.id, reviewDispatchId));

  await db
    .update(soleneDispatchQueue)
    .set({
      reviewStatus: "pending" satisfies SoleneDispatchReviewStatus,
      reviewedByDispatchId: reviewDispatchId,
    })
    .where(eq(soleneDispatchQueue.id, originalDispatchId));

  logger.info(
    `[codeReviewQueue] enqueued review id=${reviewDispatchId} for original id=${originalDispatchId} (shas=${shas.length}, cap=$${maxCostUsd})`,
  );

  return { reviewDispatchId, skipped: false };
}

// ----------------------------------------------------------------------------
// recordReviewOutcome
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// parseReviewVerdict — CP1 of Jarvis Phase 1 (Verified Act-and-Confirm).
// ----------------------------------------------------------------------------
// The review prompt ends with a structured block:
//   VERDICT: passed | flagged
//   FINDINGS:
//   - ...
// This parses the LAST verdict in the text (the model may quote the template
// earlier) plus everything after the following FINDINGS: marker. Pure and
// exported so the contract is unit-testable. Returns null when no verdict is
// parseable — the caller logs loudly and leaves review_status pending, which
// listPendingReviews() surfaces; an unparseable review NEVER counts as
// passed.

export interface ParsedReviewVerdict {
  outcome: "passed" | "flagged";
  findings?: string;
}

export function parseReviewVerdict(text: string): ParsedReviewVerdict | null {
  const matches = [...text.matchAll(/VERDICT:\s*(passed|flagged)\b/gi)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const outcome = last[1].toLowerCase() as "passed" | "flagged";

  let findings: string | undefined;
  const tail = text.slice((last.index ?? 0) + last[0].length);
  const fm = tail.match(/FINDINGS:\s*\n?([\s\S]*)/i);
  if (fm) {
    const body = fm[1].trim();
    if (body.length > 0) findings = body.slice(0, 4000);
  }
  return { outcome, findings };
}

/**
 * Update the ORIGINAL dispatch's review_status once the review-dispatch
 * (identified by reviewDispatchId) concludes. Findings, if supplied, are
 * appended to the original's result_summary so the founder surface shows
 * the review verdict alongside the original work's summary.
 */
export async function recordReviewOutcome(
  reviewDispatchId: number,
  outcome: "passed" | "flagged",
  findings?: string,
): Promise<void> {
  // Look up which original this review belongs to.
  const [reviewRow] = await db
    .select({
      id: soleneDispatchQueue.id,
      originalDispatchId: soleneDispatchQueue.originalDispatchId,
    })
    .from(soleneDispatchQueue)
    .where(eq(soleneDispatchQueue.id, reviewDispatchId))
    .limit(1);

  if (!reviewRow) {
    logger.warn(
      `[codeReviewQueue] recordReviewOutcome: review id=${reviewDispatchId} not found`,
    );
    return;
  }
  if (reviewRow.originalDispatchId === null) {
    logger.warn(
      `[codeReviewQueue] recordReviewOutcome: review id=${reviewDispatchId} has no original_dispatch_id`,
    );
    return;
  }

  await db
    .update(soleneDispatchQueue)
    .set({
      reviewStatus: outcome satisfies SoleneDispatchReviewStatus,
    })
    .where(eq(soleneDispatchQueue.id, reviewRow.originalDispatchId));

  logger.info(
    `[codeReviewQueue] review id=${reviewDispatchId} verdict=${outcome} -> original id=${reviewRow.originalDispatchId}${
      findings ? ` (findings: ${findings.slice(0, 200)})` : ""
    }`,
  );

  // CP3 of Jarvis Phase 1 (Verified Act-and-Confirm) — a review verdict is
  // VERIFIED evidence for the original dispatch's domain in the Trust Ledger:
  // passed → verified clean cycle; flagged → the existing circuit-breaker
  // demotion. applyVerifiedTrustEvidence maps dispatch→domain honestly (skips
  // with a debug log when the original carries no known autopilot domain) and
  // never throws. Fire-and-forget so this function's no-throw contract and
  // the verdict write above are never at risk. Observe-only for the action:
  // trust moves; the reviewed work is not blocked or rolled back.
  {
    const targetId = reviewRow.originalDispatchId;
    import("./verifyQueue")
      .then(({ applyVerifiedTrustEvidence }) =>
        applyVerifiedTrustEvidence({
          targetDispatchId: targetId,
          outcome,
          verdictDispatchId: reviewDispatchId,
          via: "code_review",
          findings,
        }),
      )
      .catch((err) =>
        logger.warn(
          `[codeReviewQueue] trust-evidence import failed for original=${targetId}`,
          err,
        ),
      );
  }

  // L3.13 — self-debugging. When a review flags the original, call the
  // original agent back to introspect on the findings. Fire-and-forget so
  // recordReviewOutcome's contract (no throw) is preserved.
  if (outcome === "flagged") {
    const originalId = reviewRow.originalDispatchId;
    const findingsText = findings ?? "";
    import("./selfDebug")
      .then(({ enqueueSelfDebugDispatch }) =>
        enqueueSelfDebugDispatch({
          originalDispatchId: originalId,
          reviewDispatchId,
          findings: findingsText,
        }).catch((err) =>
          logger.warn(
            `[codeReviewQueue] self-debug failed for original=${originalId}`,
            err,
          ),
        ),
      )
      .catch((err) =>
        logger.warn(
          `[codeReviewQueue] self-debug import failed for original=${originalId}`,
          err,
        ),
      );
  }
}

// ----------------------------------------------------------------------------
// listPendingReviews — founder visibility surface.
// ----------------------------------------------------------------------------

export interface PendingReviewRow {
  originalDispatchId: number;
  originalAgentRole: string;
  originalCompletedAt: Date | null;
  reviewDispatchId: number;
  reviewStatus: string;
  reviewQueuedAt: Date;
}

/**
 * List all dispatches whose code-review is still in-flight (review_status =
 * 'pending'). Ordered by the original dispatch's completion time DESC so
 * the most recently-finished work surfaces first.
 */
export async function listPendingReviews(): Promise<PendingReviewRow[]> {
  const original = soleneDispatchQueue;
  const review = sql`solene_dispatch_queue_review`;
  // Single-table self-join via SQL — simpler than aliasing through drizzle.
  const rows = await db.execute<{
    original_id: number;
    original_agent_role: string;
    original_completed_at: Date | null;
    review_id: number;
    review_status: string;
    review_queued_at: Date;
  }>(sql`
    SELECT
      o.id AS original_id,
      o.agent_role AS original_agent_role,
      o.completed_at AS original_completed_at,
      r.id AS review_id,
      o.review_status AS review_status,
      r.queued_at AS review_queued_at
    FROM solene_dispatch_queue o
    JOIN solene_dispatch_queue r
      ON r.original_dispatch_id = o.id
    WHERE o.review_status = 'pending'
    ORDER BY o.completed_at DESC NULLS LAST
    LIMIT 200
  `);

  const list: any[] = Array.isArray(rows)
    ? (rows as any[])
    : ((rows as any)?.rows ?? []);

  return list.map((r) => ({
    originalDispatchId: r.original_id,
    originalAgentRole: r.original_agent_role,
    originalCompletedAt: r.original_completed_at,
    reviewDispatchId: r.review_id,
    reviewStatus: r.review_status,
    reviewQueuedAt: r.review_queued_at,
  }));
}

// Quiet unused-import warnings for symbols kept for forward use.
void and;
void isNotNull;
void isNull;
