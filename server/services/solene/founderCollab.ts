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
 * Duplicate suppression: askFounder() returns the id of an already-open ask
 * with the same (role, summary, body) rather than creating a second one, and
 * fires no pager when it does. Reminding the founder about an unanswered ask
 * is runAskEscalationLadder()'s job, on a per-urgency backoff.
 *
 * Lifecycle closer: runAskEscalationLadder() (below), invoked on the
 * continuous loop's 30-minute tick (continuousLoop.ts). It re-pages open asks
 * and auto-resolves ONLY yes/no asks to timed_out — the safe side — at
 * AUTO_RESOLVE_HOURS by urgency (urgent 24h / normal 72h / low 168h,
 * escalationLadder.ts). Free-text, multi-choice, and numeric asks stay open
 * until the founder answers or supersedes them. The timeout_at column and
 * expireOverdueAsks() are NOT enforced — the sweeper has zero production
 * callers (see its NOTE below and the corrected founder_ask record in
 * shared/decisions/doNothing.ts).
 */

import { createHash } from "node:crypto";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
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
  /**
   * Set when a YES to this ask ACTS (enqueues a move): the exact proposal that
   * runs on approval. Such an ask folds only into the same proposal, never by
   * summary, and its body is never rewritten after the founder can see it.
   * `chatApprovable` is set only by server code (planAndAct) for a
   * server-authored catalog move on the allow-list.
   */
  acts?: { moveKind: string; domain: string; rationale: string; chatApprovable: boolean };
}

/** The version of a card: sha256 of the body the founder reads. Pure. */
function askBodyHash(body: string): string {
  return createHash("sha256").update(body ?? "", "utf8").digest("hex");
}

/** The identity of an acting proposal (kind + domain + rationale). Pure. */
function actsKeyOf(a: { moveKind: string; domain: string; rationale: string }): string {
  return createHash("sha256").update(`${a.moveKind}\u0000${a.domain}\u0000${a.rationale}`, "utf8").digest("hex");
}

export interface AskFounderResult {
  askId: number;
  pagerFired: boolean;
  pagerEventId: number | null;
  /**
   * True when this call matched an ask that is ALREADY OPEN and returned its
   * id instead of creating a second one. The caller's contract is unchanged —
   * it gets an askId it can poll — but no row was written and no pager fired.
   */
  deduped: boolean;
}

export interface AnswerFounderInput {
  askId: number;
  /**
   * The body_hash of the card the founder (or the chat, reading it) saw. A YES
   * to an ask that acts is refused without it, and any answer is refused when
   * it no longer matches the stored card.
   */
  expectedBodyHash?: string;
  /** Set by the chat: the guarded update then also requires chat_approvable. */
  viaChat?: boolean;
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

  // ── Duplicate suppression, BEFORE the pager ──────────────────────────────
  //
  // The autopilot loop ticks every 30 minutes and re-selects the moves that
  // are still pending. Three escalation paths in planAndAct call ask() with no
  // memory of having asked: the risk-tier check, the pre-mortem veto, and the
  // gate escalation. The ActContext idempotencyKey does not help — its own
  // doc says it seals the OUTWARD EFFECT, and it is forwarded only to
  // enqueue(), never consulted here. So one unanswered question became a new
  // row and a new page to Tom's phone every half hour, and the Decisions door
  // — the one door he is required to use — filled with copies of it.
  //
  // Re-paging an open ask is a real need, and it is already handled properly
  // by runAskEscalationLadder(): "Still waiting on you", on a per-urgency
  // backoff (REPAGE_HOURS), not every tick. Creating a duplicate row was never
  // the mechanism for it.
  //
  // The key was (role, summary, body) among OPEN asks — exact, on the theory
  // that a repeated escalation reproduces its summary and body verbatim. It
  // does not (see S13 below), so the key is now the summary alone.
  //
  // HONEST LIMIT: this is read-then-insert, not an atomic seal. Two ticks
  // racing could still both insert. The loop is single-tick and 30 minutes
  // apart so that race is not the observed failure; closing it properly needs
  // a unique index, which needs a migration. Stated rather than implied.
  //
  // S13 (Stage 2) — FOLD on the summary alone. The exact (role, summary, body)
  // key still let the same question open twice: a re-raised escalation carries
  // a fresh forecast/simulation line in its BODY, so the founder simulation
  // found 4 same-summary asks open at once. The summary is what the founder
  // reads on the card; two open cards with the same words are one question.
  // The repeat folds into the open ask: fold_count +1, the body refreshed to
  // the newest facts, NO new row and NO page. The original timeout stands, so
  // the escalation ladder still bounds the pile.
  // Asks whose YES acts fold ONLY into the same proposal (acts_key), and the
  // fold never rewrites the card: what the founder reads is what runs.
  // Informational asks keep the S13 summary fold (body refreshed).
  const bodyHash = askBodyHash(input.questionBody);
  const actsKey = input.acts ? actsKeyOf(input.acts) : null;
  const [duplicate] = await db
    .select({
      id: soleneFounderAsks.id,
      askedAt: soleneFounderAsks.askedAt,
      questionSummary: soleneFounderAsks.questionSummary,
      bodyHash: soleneFounderAsks.bodyHash,
      chatApprovable: soleneFounderAsks.chatApprovable,
    })
    .from(soleneFounderAsks)
    .where(
      actsKey
        ? and(eq(soleneFounderAsks.status, "open"), eq(soleneFounderAsks.actsKey, actsKey))
        : and(
            eq(soleneFounderAsks.status, "open"),
            eq(soleneFounderAsks.questionSummary, summary),
            isNull(soleneFounderAsks.actsKey),
          ),
    )
    .orderBy(soleneFounderAsks.id)
    .limit(1);

  if (duplicate) {
    const incomingChat = input.acts?.chatApprovable === true;
    const sameCard = duplicate.questionSummary === summary && duplicate.bodyHash === bodyHash;
    // An acting ask can only LOSE chat-approvability on a fold (existing AND
    // incoming): a later tick that brings an objection, a risk flag or a
    // failed check can never be laundered into a card the chat may approve.
    const chatApprovable = actsKey ? duplicate.chatApprovable === true && incomingChat : false;
    // An acting card that comes back DIFFERENT is replaced and its version
    // bumped (body_hash), so any yes given to the old card is stale. When the
    // difference is an objection — a different card (pre-mortem veto, higher
    // risk) or chat-approvability lost — the founder is paged: an objection
    // never arrives silently.
    const objection = !!actsKey && (duplicate.questionSummary !== summary || (duplicate.chatApprovable === true && !incomingChat));
    await db
      .update(soleneFounderAsks)
      .set({
        foldCount: sql`${soleneFounderAsks.foldCount} + 1`,
        lastFoldedAt: askedAt,
        chatApprovable,
        ...(sameCard ? {} : { questionSummary: summary, questionBody: input.questionBody, bodyHash }),
      })
      .where(and(eq(soleneFounderAsks.id, duplicate.id), eq(soleneFounderAsks.status, "open")));
    let pagerFired = false;
    let pagerEventId: number | null = null;
    if (objection && urgency !== "low") {
      try {
        const page = await sendSolenePage({ severity: "urgent", subject: summary, body: input.questionBody });
        pagerFired = true;
        pagerEventId = page.eventId;
      } catch (err) {
        logger.warn("[founderCollab] pager send threw on a replaced card", err instanceof Error ? err : undefined);
      }
    }
    logger.info("[founderCollab] ask folded — the same question is already open", {
      metadata: {
        askId: duplicate.id,
        askingAgentRole: input.askingAgentRole,
        replaced: !sameCard,
        objection,
        openForHours: Math.floor((askedAt.getTime() - duplicate.askedAt.getTime()) / 3_600_000),
      },
    });
    return { askId: duplicate.id, pagerFired, pagerEventId, deduped: true };
  }

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
      bodyHash,
      actsKey,
      actsPayload: input.acts ? { moveKind: input.acts.moveKind, domain: input.acts.domain, rationale: input.acts.rationale } : null,
      chatApprovable: input.acts?.chatApprovable === true,
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
    deduped: false,
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

  // Version binding: an answer names the card it answers. A stale card is
  // refused; a YES to an ask that ACTS must name it.
  const storedHash = (ask as { bodyHash?: string | null }).bodyHash ?? null;
  const acts = (ask as { actsPayload?: { moveKind: string; domain: string; rationale: string } | null }).actsPayload ?? null;
  if (input.expectedBodyHash != null && input.expectedBodyHash !== storedHash) {
    throw new Error(`answerFounderAsk: ask ${input.askId} changed since it was shown — reload it and review the current version`);
  }
  // Every yes/no answer to a versioned card must name the version shown — an
  // approval acts (a move, a budget ramp, a policy), and so can a decline.
  if (
    (acts || (storedHash && ask.answerFormat === "yes_no")) &&
    input.expectedBodyHash == null
  ) {
    throw new Error(`answerFounderAsk: ask ${input.askId} must be answered against the version that was shown`);
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

  // The guarded UPDATE is the decision: only the answer whose UPDATE hit the
  // row (still open, still the card it names) runs any side effect. A losing
  // concurrent answer — the founder's tap racing the chat — throws here,
  // before the verdict, the enqueue or a policy proposal is touched.
  const won = await db
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
        // The card answered is the card stored — a body rewritten between the
        // read above and this write leaves the ask open.
        ...(input.expectedBodyHash != null ? [eq(soleneFounderAsks.bodyHash, input.expectedBodyHash)] : []),
        // A chat answer lands only on a card that is STILL chat-approvable at
        // the instant of the write (a fold may have revoked it since the read).
        ...(input.viaChat ? [eq(soleneFounderAsks.chatApprovable, true)] : []),
      ),
    )
    .returning({ id: soleneFounderAsks.id });
  if (!Array.isArray(won) || won.length === 0) {
    throw new Error(`answerFounderAsk: ask ${input.askId} changed or was answered elsewhere — nothing was recorded; reload and review`);
  }

  logger.info("[founderCollab] ask answered", {
    askId: input.askId,
    answerFormat: format,
    chosenOptionId,
  });

  // Learning-loop feedback: a yes/no answer to an autopilot ask is the founder's
  // verdict (approve/decline) — accrete it onto the Experience Log. No-op for
  // non-autopilot asks (no matching experience row). Best-effort.
  if (format === "yes_no") {
    const approved = answerText === "yes";
    try {
      const { recordFounderVerdict } = await import("../autopilot/experienceLog");
      await recordFounderVerdict(input.askId, approved ? "approved" : "declined");
    } catch (err) {
      logger.warn(
        "[founderCollab] autopilot verdict accrete failed",
        err instanceof Error ? err : undefined,
      );
    }
    // An approved autopilot move ACTUALLY RUNS: enqueue the drafted move,
    // exactly once (idempotency key per ask). Before this, approving recorded
    // the verdict and nothing else, while the ask said "Approve to let it
    // proceed". A decline or timeout never enqueues. No-op for asks that were
    // not an autopilot move. A failure is logged loudly and surfaced to the
    // caller rather than reading as done.
    if (approved) {
      const { enqueueApprovedMove, AUTOPILOT_DISPATCH_MAX_COST_USD } = await import("../autopilot/act");
      const { findEscalatedMoveForAsk, linkExperienceDispatch } = await import("../autopilot/experienceLog");
      const { enqueueDispatch } = await import("./dispatchQueue");
      try {
        const out = await enqueueApprovedMove(input.askId, {
          proposal: acts,
          findEscalatedMove: findEscalatedMoveForAsk,
          enqueue: enqueueDispatch,
          linkDispatch: linkExperienceDispatch,
          maxCostUsd: AUTOPILOT_DISPATCH_MAX_COST_USD,
        });
        if (out.status === "hard_stop_refused") {
          logger.warn("[founderCollab] approval of a hard-stop move recorded; the move was NOT enqueued (founder-only, forever)", {
            metadata: { askId: input.askId },
          });
        } else if (out.status === "not_bound") {
          logger.warn("[founderCollab] approval recorded, but the ask is not bound to a proposal (or names another move) — nothing was enqueued; the move will be raised again", {
            metadata: { askId: input.askId },
          });
        } else if (out.status !== "not_a_move") {
          logger.info("[founderCollab] approved move enqueued", {
            metadata: { askId: input.askId, status: out.status, dispatchId: out.dispatchId },
          });
        }
      } catch (err) {
        logger.error(
          `[founderCollab] approved ask ${input.askId}: the move could NOT be enqueued`,
          err instanceof Error ? err : undefined,
        );
        throw new Error(
          `answerFounderAsk: approval recorded, but the approved action could not be queued (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
    // If this ask was a policy-induction proposal, resolve + apply it (write a
    // standing order on stop-approval, bump autonomy on trust-approval). No-op
    // otherwise.
    try {
      const { resolvePolicyProposalForAsk } = await import("../autopilot/policyInducer");
      await resolvePolicyProposalForAsk(input.askId, approved);
    } catch (err) {
      logger.warn(
        "[founderCollab] policy proposal resolution failed",
        err instanceof Error ? err : undefined,
      );
    }
  }
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

/**
 * The escalation ladder (wire-for-real: escalationLadder.ladderAction was dead).
 * "Absence fails safe, never stuck": for each OPEN ask, the urgency+age+kind
 * ladder decides wait / re-page / auto-resolve-to-the-safe-side. Only a
 * DECISION (a yes/no go-no-go) auto-resolves — and only to TIMED_OUT (the safe
 * side: the system did NOT act on an unapproved decision). A draft/proposal
 * never auto-resolves (an unanswered draft is harmless — it just waits/re-pages).
 *
 * Re-page is debounced to fire ONCE as an ask crosses its re-page threshold this
 * tick (no per-ask "last paged" column needed): re-page when
 * repageHours ≤ ageHours < repageHours + tickWindowHours. Best-effort + total.
 */
export async function runAskEscalationLadder(
  tickWindowHours = 0.5,
): Promise<{ repaged: number; autoResolved: number }> {
  let repaged = 0;
  let autoResolved = 0;
  try {
    const { ladderAction, REPAGE_HOURS } = await import("../autopilot/escalationLadder");
    const now = Date.now();
    const open = await listOpenAsks();
    for (const ask of open) {
      const ageHours = (now - ask.askedAt.getTime()) / 3_600_000;
      const urgency = (ask.urgency ?? "normal") as "urgent" | "normal" | "low";
      const kind = ask.answerFormat === "yes_no" ? "decision" : "proposal";
      const action = ladderAction({ urgency, ageHours, kind });
      if (action.step === "auto_resolve_safe") {
        await db
          .update(soleneFounderAsks)
          .set({ status: "timed_out" })
          .where(eq(soleneFounderAsks.id, ask.id));
        autoResolved += 1;
        logger.info("[founderCollab] ask auto-resolved to safe side (escalation ladder)", {
          metadata: { askId: ask.id, urgency, ageHours: Math.floor(ageHours), reason: action.reason },
        });
      } else if (action.step === "repage") {
        const repageHours = REPAGE_HOURS[urgency] ?? 12;
        if (ageHours >= repageHours && ageHours < repageHours + tickWindowHours) {
          await sendSolenePage({
            severity: urgency === "urgent" ? "critical" : "urgent",
            subject: `Still waiting on you: ${ask.questionSummary.slice(0, 80)}`,
            body: action.reason,
          }).catch(() => {});
          repaged += 1;
        }
      }
    }
    if (repaged || autoResolved) {
      logger.info("[founderCollab] escalation ladder tick", { metadata: { repaged, autoResolved } });
    }
  } catch (err) {
    logger.warn("[founderCollab] runAskEscalationLadder failed", err instanceof Error ? err : undefined);
  }
  return { repaged, autoResolved };
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
