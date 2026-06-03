/**
 * SOLENE — L6.32 real-time founder collaboration.
 *
 * Surface for dispatched agents that hit an ambiguous decision they can't
 * resolve mid-flight. The agent calls askFounder() with the question +
 * answer-format expectations; this service persists the ask, fires the
 * existing pager to Tom (urgency-mapped), and exposes pollForAnswer() for
 * the asking agent to wait on.
 *
 * Pager dependency: this service CALLS sendSolenePage() — it does NOT
 * extend pagerService. urgency='urgent' → urgent page, urgency='normal' →
 * normal-priority page (mapped to ntfy 'urgent' severity since pagerService
 * only has urgent|critical; we use 'urgent' for both), urgency='low' →
 * no pager, just persists.
 *
 * 4 answer formats with validation:
 *   - free_text      — accepts any non-empty answerText
 *   - multi_choice   — requires options + chosenOptionId matching one
 *   - yes_no         — answerText must be 'yes' or 'no' (case-insensitive)
 *   - numeric        — answerText must parse as a number
 *
 * Default timeout: 24h. expireOverdueAsks() runs daily to flip open->timed_out.
 */

import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneFounderAsks,
  FOUNDER_ASK_DEFAULT_TIMEOUT_HOURS,
  FOUNDER_ASK_SUMMARY_MAX_CHARS,
  type SoleneFounderAsk,
  type SoleneFounderAskFormat,
  type SoleneFounderAskUrgency,
} from "@shared/schema/solene-founder-collab";
import type { SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";
import { sendSolenePage } from "./pagerService";
import { logger } from "../../utils/logger";

// ============================================
// Types
// ============================================

export interface AskFounderInput {
  askingAgentRole: SoleneDispatchAgentRole;
  askingDispatchId?: number;
  questionSummary: string;
  questionBody: string;
  options?: Array<{ id: string; label: string; description?: string }>;
  answerFormat: SoleneFounderAskFormat;
  urgency?: SoleneFounderAskUrgency;
  /** Default 24h. Set lower for time-sensitive asks. */
  timeoutHours?: number;
}

export interface AskFounderResult {
  askId: number;
  pagerFired: boolean;
  pagerEventId: number | null;
}

export interface AnswerFounderInput {
  askId: number;
  answerText?: string;
  chosenOptionId?: string;
}

export type FounderAskRow = SoleneFounderAsk;

// ============================================
// askFounder
// ============================================

/**
 * Persist the ask + fire the pager (urgency-mapped). Validation:
 *  - questionSummary > 200 chars is truncated (not rejected — agents shouldn't
 *    fail an entire dispatch over a long summary).
 *  - multi_choice requires options[] with at least 2 entries.
 *  - timeoutHours must be > 0 when set.
 *
 * Pager fan-out is fire-and-forget — a pager failure does not block the ask
 * from being recorded. The ask persists either way.
 */
export async function askFounder(
  input: AskFounderInput,
): Promise<AskFounderResult> {
  if (!input.questionSummary || input.questionSummary.trim().length === 0) {
    throw new Error("askFounder: questionSummary must be non-empty");
  }
  if (!input.questionBody || input.questionBody.trim().length === 0) {
    throw new Error("askFounder: questionBody must be non-empty");
  }
  if (input.answerFormat === "multi_choice") {
    if (!input.options || input.options.length < 2) {
      throw new Error(
        "askFounder: multi_choice requires options[] with at least 2 entries",
      );
    }
    const ids = new Set<string>();
    for (const opt of input.options) {
      if (!opt.id || !opt.label) {
        throw new Error(
          "askFounder: every option requires { id, label }",
        );
      }
      if (ids.has(opt.id)) {
        throw new Error(
          `askFounder: duplicate option id=${opt.id}`,
        );
      }
      ids.add(opt.id);
    }
  }
  if (
    input.timeoutHours !== undefined &&
    (!Number.isFinite(input.timeoutHours) || input.timeoutHours <= 0)
  ) {
    throw new Error(
      `askFounder: invalid timeoutHours=${input.timeoutHours} (must be > 0)`,
    );
  }

  const urgency: SoleneFounderAskUrgency = input.urgency ?? "normal";
  const summary = input.questionSummary.slice(
    0,
    FOUNDER_ASK_SUMMARY_MAX_CHARS,
  );
  const timeoutHours =
    input.timeoutHours ?? FOUNDER_ASK_DEFAULT_TIMEOUT_HOURS;
  const askedAt = new Date();
  const timeoutAt = new Date(askedAt.getTime() + timeoutHours * 60 * 60 * 1000);

  // Fire pager first so we can persist its event id with the ask. urgency
  // 'low' skips paging entirely (just persists for review).
  let pagerFired = false;
  let pagerEventId: number | null = null;
  if (urgency !== "low") {
    try {
      const result = await sendSolenePage({
        // pagerService only supports urgent|critical. We map both 'urgent'
        // and 'normal' founder-ask urgencies to 'urgent' pager severity —
        // 'critical' is reserved for production incidents per page
        // discipline, not interactive collaboration requests.
        severity: "urgent",
        subject: summary,
        body: input.questionBody,
      });
      pagerFired = true;
      pagerEventId = result.eventId;
    } catch (err) {
      // Pager throw is non-fatal — the ask still persists. Log + continue.
      logger.warn(
        "[founderCollab] pager send threw — ask will persist without pager link",
        err instanceof Error ? err : undefined,
      );
    }
  }

  const [inserted] = await db
    .insert(soleneFounderAsks)
    .values({
      askedAt,
      askingAgentRole: input.askingAgentRole,
      askingDispatchId: input.askingDispatchId ?? null,
      questionSummary: summary,
      questionBody: input.questionBody,
      options: input.options ?? null,
      answerFormat: input.answerFormat,
      status: "open",
      pagerEventId,
      timeoutAt,
      urgency,
    })
    .returning({ id: soleneFounderAsks.id });

  if (!inserted) {
    throw new Error("askFounder: insert returned no id");
  }

  logger.info("[founderCollab] ask recorded", {
    askId: inserted.id,
    askingAgentRole: input.askingAgentRole,
    askingDispatchId: input.askingDispatchId ?? null,
    urgency,
    answerFormat: input.answerFormat,
    pagerFired,
    pagerEventId,
    timeoutAt: timeoutAt.toISOString(),
  });

  return {
    askId: inserted.id,
    pagerFired,
    pagerEventId,
  };
}

// ============================================
// answerFounderAsk
// ============================================

/**
 * Record Tom's answer. Validates format-specific shape:
 *  - multi_choice: chosenOptionId required + must match one of the stored options.
 *  - yes_no:       answerText must be 'yes' or 'no' (case-insensitive).
 *  - numeric:      answerText must be parseable as a number.
 *  - free_text:    answerText required + non-empty.
 *
 * Throws when the ask doesn't exist OR isn't status='open'.
 */
export async function answerFounderAsk(
  input: AnswerFounderInput,
): Promise<void> {
  const ask = await getAsk(input.askId);
  if (!ask) {
    throw new Error(`answerFounderAsk: no ask with id=${input.askId}`);
  }
  if (ask.status !== "open") {
    throw new Error(
      `answerFounderAsk: ask ${input.askId} is status=${ask.status} (only 'open' is answerable)`,
    );
  }

  const format = ask.answerFormat as SoleneFounderAskFormat;
  const trimmedAnswer = input.answerText?.trim() ?? "";
  let answerText: string | null = null;
  let chosenOptionId: string | null = null;

  if (format === "multi_choice") {
    if (!input.chosenOptionId) {
      throw new Error(
        "answerFounderAsk: multi_choice requires chosenOptionId",
      );
    }
    const opts = (ask.options ?? []) as Array<{ id: string; label: string }>;
    const match = opts.find((o) => o.id === input.chosenOptionId);
    if (!match) {
      throw new Error(
        `answerFounderAsk: chosenOptionId=${input.chosenOptionId} not in stored options`,
      );
    }
    chosenOptionId = match.id;
    // Use the option label as the canonical text answer for downstream readers.
    answerText = trimmedAnswer.length > 0 ? trimmedAnswer : match.label;
  } else if (format === "yes_no") {
    if (!trimmedAnswer) {
      throw new Error("answerFounderAsk: yes_no requires answerText");
    }
    const normalized = trimmedAnswer.toLowerCase();
    if (normalized !== "yes" && normalized !== "no") {
      throw new Error(
        `answerFounderAsk: yes_no answer must be 'yes' or 'no' (got '${trimmedAnswer}')`,
      );
    }
    answerText = normalized;
  } else if (format === "numeric") {
    if (!trimmedAnswer) {
      throw new Error("answerFounderAsk: numeric requires answerText");
    }
    const parsed = Number(trimmedAnswer);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        `answerFounderAsk: numeric answer not parseable as number (got '${trimmedAnswer}')`,
      );
    }
    answerText = trimmedAnswer;
  } else {
    // free_text
    if (!trimmedAnswer) {
      throw new Error("answerFounderAsk: free_text requires non-empty answerText");
    }
    answerText = trimmedAnswer;
  }

  await db
    .update(soleneFounderAsks)
    .set({
      status: "answered",
      answeredAt: new Date(),
      answerText,
      answerChosenOptionId: chosenOptionId,
    })
    .where(
      and(
        eq(soleneFounderAsks.id, input.askId),
        eq(soleneFounderAsks.status, "open"),
      ),
    );

  logger.info("[founderCollab] ask answered", {
    askId: input.askId,
    answerFormat: format,
    chosenOptionId,
  });
}

// ============================================
// getAsk / pollForAnswer / listOpenAsks
// ============================================

export async function getAsk(askId: number): Promise<FounderAskRow | null> {
  const [row] = await db
    .select()
    .from(soleneFounderAsks)
    .where(eq(soleneFounderAsks.id, askId))
    .limit(1);
  return row ?? null;
}

/**
 * Poll for the answer (used by a waiting agent). Returns:
 *   - { status: 'answered', answerText, chosenOptionId } when answered
 *   - { status: 'open' } when still open + not overdue
 * Throws when ask is timed_out, superseded, or not found.
 */
export async function pollForAnswer(
  askId: number,
): Promise<
  | { status: "answered"; answerText: string; chosenOptionId: string | null }
  | { status: "open" }
> {
  const ask = await getAsk(askId);
  if (!ask) {
    throw new Error(`pollForAnswer: no ask with id=${askId}`);
  }
  if (ask.status === "answered") {
    return {
      status: "answered",
      answerText: ask.answerText ?? "",
      chosenOptionId: ask.answerChosenOptionId ?? null,
    };
  }
  if (ask.status === "timed_out") {
    throw new Error(`pollForAnswer: ask ${askId} timed out`);
  }
  if (ask.status === "superseded") {
    throw new Error(`pollForAnswer: ask ${askId} was superseded`);
  }
  return { status: "open" };
}

/**
 * Founder inbox of open asks. Ordered urgent → normal → low, then by
 * asked_at ascending (oldest unanswered first within each tier).
 */
export async function listOpenAsks(): Promise<FounderAskRow[]> {
  const rows = await db
    .select()
    .from(soleneFounderAsks)
    .where(eq(soleneFounderAsks.status, "open"));

  // Sort in-memory: urgency tier (urgent < normal < low) then askedAt asc.
  const urgencyRank: Record<string, number> = {
    urgent: 0,
    normal: 1,
    low: 2,
  };
  return [...rows].sort((a, b) => {
    const ua = urgencyRank[a.urgency] ?? 99;
    const ub = urgencyRank[b.urgency] ?? 99;
    if (ua !== ub) return ua - ub;
    return a.askedAt.getTime() - b.askedAt.getTime();
  });
}

// ============================================
// expireOverdueAsks (daily cron)
// ============================================

/**
 * Daily cron sweeper. Flips status='open' rows whose timeout_at < now() to
 * 'timed_out'. Never throws (logs on internal error + returns 0).
 *
 * NOTE: not yet wired into runScheduledJobs.ts (that file is frozen during
 * Phase B). Solene wires in follow-up.
 */
export async function expireOverdueAsks(): Promise<{ expired: number }> {
  try {
    const now = new Date();
    const result = await db
      .update(soleneFounderAsks)
      .set({ status: "timed_out" })
      .where(
        and(
          eq(soleneFounderAsks.status, "open"),
          lte(soleneFounderAsks.timeoutAt, now),
        ),
      )
      .returning({ id: soleneFounderAsks.id });

    if (result.length > 0) {
      logger.info("[founderCollab] expired overdue asks", {
        count: result.length,
      });
    }
    return { expired: result.length };
  } catch (err) {
    logger.error(
      "[founderCollab] expireOverdueAsks failed",
      err instanceof Error ? err : undefined,
    );
    return { expired: 0 };
  }
}

// ============================================
// supersedeAsk
// ============================================

/**
 * Mark an ask superseded with a stated reason. Used when the original
 * situation changed and the question is no longer relevant — the asking
 * agent's poll throws, signalling "abandon this branch."
 */
export async function supersedeAsk(
  askId: number,
  reason: string,
): Promise<void> {
  if (!reason || reason.trim().length === 0) {
    throw new Error("supersedeAsk: reason must be non-empty");
  }
  const ask = await getAsk(askId);
  if (!ask) {
    throw new Error(`supersedeAsk: no ask with id=${askId}`);
  }
  if (ask.status !== "open") {
    throw new Error(
      `supersedeAsk: ask ${askId} is status=${ask.status} (only 'open' is supersedable)`,
    );
  }

  // Reason is stored in answer_text so it lands in the same column the
  // founder inbox already reads. The 'superseded' status flag is what
  // distinguishes it from a genuine answer.
  await db
    .update(soleneFounderAsks)
    .set({
      status: "superseded",
      answeredAt: new Date(),
      answerText: `[superseded] ${reason}`.slice(0, 4000),
    })
    .where(eq(soleneFounderAsks.id, askId));

  logger.info("[founderCollab] ask superseded", { askId, reason });
}

// Unused-import guard for tree-shaker.
void sql;
void desc;
