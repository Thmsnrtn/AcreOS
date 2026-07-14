/**
 * SOLENE — Horizon A3: letter replies as directives.
 *
 * The founder replies to The Letter in plain language. The reply is parsed
 * into one of four kinds — {ruling | directive | question | noise} — and the
 * parse is SHOWN BACK for one-tap confirmation before anything durable
 * happens.
 *
 * THE WITNESSED-ADMISSION INVARIANT (structural, not advisory):
 *
 *   parseLetterReply / handleLetterReply write NOTHING to precedent memory
 *   and NOTHING to the dispatch queue. They only persist a PENDING
 *   decisions_inbox_items card (itemType 'letter_reply_confirm') carrying
 *   the parse + the confirm options. The ONLY code path that touches
 *   recordFounderPrecedent or enqueueDispatch is confirmLetterReply, which
 *   runs exclusively on a founder tap against the shown-back parse.
 *
 * Persistence choice: the pending parse is a decisions_inbox_items row (no
 * new table, survives server restarts, and naturally shows up in the
 * decisions inbox as acceptable redundancy). The row is inserted DIRECTLY,
 * deliberately bypassing arbitrateFounderInterrupt: the founder just typed
 * this reply, so the card is the echo of their own action — not a
 * machine-initiated interrupt. Routing it through the arbiter would let the
 * Class-B budget defer/suppress the founder's own echo and create an
 * interrupt-noise loop. For the same reason the card carries NO outcome
 * prediction (attachPrediction is not called): it is bookkeeping of the
 * founder's own words, not a prediction-bearing agent decision, and the
 * outcome ledger only scores rows carrying a checkInDate.
 *
 * Counting: a confirm resolves the row with resolvedBy 'founder' and status
 * approved/rejected, so countFounderDecisionsThisWeek counts it — a confirm
 * IS a founder decision, deliberately left inside the weekly budget count.
 *
 * Honesty: a parse that fails, or a ruling/directive below MIN_PARSE_CONFIDENCE,
 * is downgraded to 'question'/'noise' and says so — a confident ruling is
 * never invented from an ambiguous reply.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { decisionsInboxItems } from "@shared/schema";
import {
  DISPATCH_AGENT_ROLES,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";
import { routeAITask, TaskComplexity } from "../aiRouter";
import type { DecisionCardOption } from "../decisionsInbox";
import { recordCapitalEvent } from "./capitalTracker";
import { recordFounderPrecedent } from "./founderPrecedent";
import { enqueueDispatch } from "./dispatchQueue";

// ============================================================================
// Public types + constants
// ============================================================================

export const LETTER_REPLY_ITEM_TYPE = "letter_reply_confirm";

/** Below this the model's ruling/directive read is a guess, not a parse. */
export const MIN_PARSE_CONFIDENCE = 0.5;

/** Directive dispatch priority band — founder-initiated work jumps the
 *  auto-dispatch queue (default 1.0) but is clamped so a model suggestion
 *  can never exceed the founder_bypass band. */
export const DIRECTIVE_PRIORITY_MIN = 3;
export const DIRECTIVE_PRIORITY_MAX = 5;

/** Roles a confirmed directive may target. code-reviewer is the review
 *  lane's instrument, never a directive target — anything unknown lands on
 *  general-purpose rather than failing the founder's confirm. */
export const DIRECTIVE_AGENT_ROLES = DISPATCH_AGENT_ROLES.filter(
  (r) => r !== "code-reviewer",
) as readonly SoleneDispatchAgentRole[];

export type LetterReplyKind = "ruling" | "directive" | "question" | "noise";

export interface LetterReplyParse {
  kind: LetterReplyKind;
  confidence: number;
  /** One-sentence plain-language restatement shown back to the founder. */
  restatement: string;
  ruling?: { situation: string; decision: string; why: string };
  directive?: { agentRole: string; brief: string; suggestedPriority?: number };
}

export type ConfirmLetterReplyOutcome =
  | "stored_precedent"
  | "queued_directive"
  | "sent_to_chat"
  | "discarded"
  | "already_resolved";

export interface ConfirmLetterReplyResult {
  outcome: ConfirmLetterReplyOutcome;
  itemId: number;
  dispatchId?: number;
  precedentAdmitted?: boolean;
}

/** Typed failure so routes can map codes to the right Errors.* helper. */
export class LetterReplyError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "not_a_letter_reply"
      | "unknown_option"
      | "malformed_card",
    message: string,
  ) {
    super(message);
    this.name = "LetterReplyError";
  }
}

// ============================================================================
// Parse — zod validation + honesty normalization
// ============================================================================

const rulingSchema = z.object({
  situation: z.string().min(1),
  decision: z.string().min(1),
  why: z.string().min(1),
});

const directiveSchema = z.object({
  agentRole: z.string().min(1),
  brief: z.string().min(1),
  suggestedPriority: z.number().optional(),
});

const rawParseSchema = z.object({
  kind: z.enum(["ruling", "directive", "question", "noise"]),
  confidence: z.number().min(0).max(1),
  restatement: z.string().min(1),
  ruling: rulingSchema.nullish(),
  directive: directiveSchema.nullish(),
});

const RESTATEMENT_MAX_CHARS = 500;

function noiseFallback(): LetterReplyParse {
  return {
    kind: "noise",
    confidence: 0,
    restatement: "Could not parse — nothing stored.",
  };
}

/**
 * Validate a raw model output into an honest LetterReplyParse. Pure —
 * exported for tests. Downgrades rather than invents:
 *   - schema failure                          → noise ("Could not parse")
 *   - ruling/directive missing its payload    → question
 *   - ruling/directive below MIN_PARSE_CONFIDENCE → question, and says so
 */
export function normalizeParse(raw: unknown): LetterReplyParse {
  const parsed = rawParseSchema.safeParse(raw);
  if (!parsed.success) return noiseFallback();

  let { kind } = parsed.data;
  let restatement = parsed.data.restatement.trim().slice(0, RESTATEMENT_MAX_CHARS);
  const { confidence, ruling, directive } = parsed.data;

  // A confirmable kind without its payload cannot be confirmed — honest
  // downgrade, never a fabricated payload.
  if (kind === "ruling" && !ruling) kind = "question";
  if (kind === "directive" && !directive) kind = "question";

  if ((kind === "ruling" || kind === "directive") && confidence < MIN_PARSE_CONFIDENCE) {
    kind = "question";
    restatement = `${restatement} (low-confidence parse — treated as a question; nothing is stored automatically)`.slice(
      0,
      RESTATEMENT_MAX_CHARS,
    );
  }

  return {
    kind,
    confidence,
    restatement,
    // Payloads travel only with the kind that can confirm them — a
    // downgraded parse must not carry a confirmable ruling/directive.
    ...(kind === "ruling" && ruling ? { ruling } : {}),
    ...(kind === "directive" && directive ? { directive } : {}),
  };
}

const PARSE_SYSTEM_PROMPT = `You classify the founder's plain-language reply to their monthly operations letter into exactly one of four kinds:

- "ruling": a reusable rule or precedent — the founder is settling a class of question ("always X when Y", "never do Z", a decision plus the reasoning behind it).
- "directive": a concrete task the founder wants an agent to go do ("go fix X", "investigate Y", "draft Z").
- "question": the founder is asking something, or the reply is too ambiguous to act on.
- "noise": pleasantries, acknowledgements, or content with no actionable signal.

Output STRICT JSON, no code fences, exactly this shape:
{
  "kind": "ruling" | "directive" | "question" | "noise",
  "confidence": <number 0..1 — how sure you are of the classification AND the extracted payload>,
  "restatement": "<ONE plain-language sentence restating what you understood, addressed to the founder>",
  "ruling": { "situation": "...", "decision": "...", "why": "..." },   // ONLY when kind is "ruling"
  "directive": { "agentRole": "<one of: ${DIRECTIVE_AGENT_ROLES.join(" | ")}>", "brief": "<self-contained task brief>", "suggestedPriority": <number 3..5> }   // ONLY when kind is "directive"
}

Rules:
- NEVER invent a confident ruling or directive from an ambiguous reply. When unsure, use "question" or "noise" with low confidence and say so in the restatement.
- The restatement must restate only what the founder actually said — no additions.
- Use only facts present in the reply and the provided letter context.`;

function buildParseUserPrompt(input: {
  replyText: string;
  monthKey: string;
  pendingDecisionText?: string | null;
}): string {
  const lines = [
    `LETTER MONTH: ${input.monthKey}`,
    input.pendingDecisionText
      ? `THE LETTER'S PENDING FOUNDER DECISION (context only): ${input.pendingDecisionText}`
      : `THE LETTER'S PENDING FOUNDER DECISION: (none recorded)`,
    "",
    `FOUNDER'S REPLY (verbatim):`,
    input.replyText,
  ];
  return lines.join("\n");
}

function stripCodeFences(raw: string): string {
  return raw.replace(/```json\n?|```/g, "").trim();
}

/**
 * Parse one founder reply. NEVER throws to the route — any failure returns
 * the honest noise shape with a logged warning. Writes NOTHING durable
 * (witnessed admission — see module doc).
 */
export async function parseLetterReply(input: {
  replyText: string;
  monthKey: string;
  pendingDecisionText?: string | null;
}): Promise<LetterReplyParse> {
  try {
    const response = await routeAITask({
      taskType: "letter_reply_parse",
      complexity: TaskComplexity.SIMPLE,
      responseFormat: "json",
      temperature: 0.2,
      maxTokens: 800,
      messages: [
        { role: "system", content: PARSE_SYSTEM_PROMPT },
        { role: "user", content: buildParseUserPrompt(input) },
      ],
    });

    // Cost attribution — fail-open by design inside recordCapitalEvent.
    void recordCapitalEvent(
      "anthropic_api",
      response.estimatedCost ?? 0,
      `letter_reply_parse (${input.monthKey})`,
    );

    let raw: unknown;
    try {
      raw = JSON.parse(stripCodeFences(response.content));
    } catch {
      logger.warn("[letterReply] parse output was not JSON — honest noise, nothing stored", {
        metadata: { monthKey: input.monthKey },
      });
      return noiseFallback();
    }

    const parse = normalizeParse(raw);
    if (parse.kind === "noise" && parse.confidence === 0) {
      logger.warn("[letterReply] parse output failed validation — honest noise, nothing stored", {
        metadata: { monthKey: input.monthKey },
      });
    }
    return parse;
  } catch (err) {
    logger.warn("[letterReply] parse call failed — honest noise, nothing stored", {
      metadata: {
        monthKey: input.monthKey,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return noiseFallback();
  }
}

// ============================================================================
// Confirm options — served with the card so key validation fails closed
// ============================================================================

/** The confirm options for a parse kind. Pure — exported for tests. */
export function confirmOptionsForKind(kind: LetterReplyKind): DecisionCardOption[] {
  switch (kind) {
    case "ruling":
      return [
        { key: "confirm_ruling", label: "Store as precedent" },
        { key: "discard", label: "Discard" },
      ];
    case "directive":
      return [
        { key: "confirm_directive", label: "Queue for Solene" },
        { key: "discard", label: "Discard" },
      ];
    case "question":
      return [
        { key: "send_to_chat", label: "Ask Solene in chat" },
        { key: "discard", label: "Discard" },
      ];
    case "noise":
      return [{ key: "discard", label: "Discard" }];
  }
}

// ============================================================================
// handleLetterReply — parse + persist the PENDING card (nothing else)
// ============================================================================

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export interface HandleLetterReplyResult {
  itemId: number;
  parse: LetterReplyParse;
  options: DecisionCardOption[];
}

/**
 * Parse the reply and persist the shown-back parse as a PENDING inbox card.
 *
 * WITNESSED ADMISSION: this function stores ONLY the pending parse. It never
 * touches precedent memory or the dispatch queue — those writes exist solely
 * inside confirmLetterReply, behind the founder's tap.
 */
export async function handleLetterReply(input: {
  replyText: string;
  monthKey: string;
  pendingDecisionText?: string | null;
}): Promise<HandleLetterReplyResult> {
  const parse = await parseLetterReply(input);
  const options = confirmOptionsForKind(parse.kind);

  // Direct insert, deliberately BYPASSING arbitrateFounderInterrupt: the
  // founder just initiated this by typing the reply — the card is the echo
  // of their own action, not a machine-initiated interrupt, so the Class-B
  // budget must not be able to defer/suppress it (that would be an
  // interrupt-noise loop against the founder's own words).
  const [item] = await db
    .insert(decisionsInboxItems)
    .values({
      itemType: LETTER_REPLY_ITEM_TYPE,
      riskLevel: "low",
      urgencyScore: 40,
      sophieAnalysis: `Reply to the ${input.monthKey} letter: "${truncate(input.replyText, 240)}" — parsed as ${parse.kind}.`,
      sophieConfidenceScore: Math.round(parse.confidence * 100),
      recommendedAction: parse.restatement,
      recommendedActionLabel: truncate(parse.restatement, 140),
      // Structural safety: NO action payload — even if the generic approve
      // path were ever hit, its executor has nothing to run.
      actionPayload: null,
      organizationId: null,
      ownerAgentCodename: "solene",
      contextBundle: {
        parse,
        replyText: input.replyText,
        monthKey: input.monthKey,
        options,
      },
      status: "pending",
      deferredUntil: null,
    })
    .returning();

  logger.info("[letterReply] pending parse card created — awaiting founder confirmation", {
    metadata: { itemId: item.id, monthKey: input.monthKey, kind: parse.kind },
  });

  return { itemId: item.id, parse, options };
}

// ============================================================================
// confirmLetterReply — THE ONLY path to precedent memory / dispatch queue
// ============================================================================

/** Clamp a model-suggested priority into the founder-directive band. Pure —
 *  exported for tests. Non-finite/missing suggestions land on the floor. */
export function clampDirectivePriority(suggested?: number): number {
  if (typeof suggested !== "number" || !Number.isFinite(suggested)) {
    return DIRECTIVE_PRIORITY_MIN;
  }
  return Math.min(DIRECTIVE_PRIORITY_MAX, Math.max(DIRECTIVE_PRIORITY_MIN, suggested));
}

/** Normalize a model-suggested agent role to a real dispatch role. Pure —
 *  exported for tests. Unknown roles (and code-reviewer, which is the review
 *  lane's instrument) land on general-purpose. */
export function normalizeDirectiveAgentRole(role: unknown): SoleneDispatchAgentRole {
  const cleaned = typeof role === "string" ? role.trim().toLowerCase() : "";
  const match = DIRECTIVE_AGENT_ROLES.find((r) => r === cleaned);
  return match ?? "general-purpose";
}

function buildDirectivePrompt(params: {
  brief: string;
  replyText: string;
  monthKey: string;
}): string {
  return [
    `Founder directive, confirmed by the founder on the shown-back parse of their reply to the ${params.monthKey} founder letter.`,
    "",
    `BRIEF: ${params.brief}`,
    "",
    `FOUNDER'S REPLY (verbatim, for context): ${params.replyText}`,
  ].join("\n");
}

/**
 * Apply the founder's tap on a shown-back letter-reply parse.
 *
 * - Validates the chosen key against the STORED options (fail closed — an
 *   unknown key throws; nothing resolves, nothing is written).
 * - confirm_ruling    → recordFounderPrecedent (the witnessed admission).
 * - confirm_directive → enqueueDispatch, idempotencyKey 'letter-reply:<id>'
 *   so a double-tap can never double-enqueue. An enqueue failure (ensemble
 *   cap, cost cap) propagates and leaves the card PENDING for retry/discard.
 * - send_to_chat / discard → resolve only; nothing durable beyond the row.
 * - Double-confirm is idempotent: an already-resolved card returns
 *   'already_resolved' without any writes.
 *
 * All outcomes resolve the row with resolvedBy 'founder' (approved for
 * confirms/send_to_chat, rejected for discard). These resolves are REAL
 * founder decisions and deliberately remain inside
 * countFounderDecisionsThisWeek's weekly budget count.
 */
export async function confirmLetterReply(
  itemId: number,
  chosenKey: string,
): Promise<ConfirmLetterReplyResult> {
  const rows = await db
    .select()
    .from(decisionsInboxItems)
    .where(eq(decisionsInboxItems.id, itemId))
    .limit(1);
  // Filter re-applied in process so unit tests pin the semantics
  // independent of the SQL layer (module convention).
  const item = rows.find((r) => r.id === itemId);

  if (!item) {
    throw new LetterReplyError("not_found", `letter-reply card #${itemId} not found`);
  }
  if (item.itemType !== LETTER_REPLY_ITEM_TYPE) {
    throw new LetterReplyError(
      "not_a_letter_reply",
      `item #${itemId} is '${item.itemType}', not a letter-reply card`,
    );
  }

  // Idempotent double-confirm: a resolved card never re-executes its effect.
  if (item.status !== "pending" && item.status !== "deferred") {
    logger.info("[letterReply] confirm on an already-resolved card — idempotent no-op", {
      metadata: { itemId, status: item.status },
    });
    return { outcome: "already_resolved", itemId };
  }

  // Fail-closed key validation against the STORED options — never the
  // client's copy of them.
  const storedOptions = item.contextBundle?.options;
  const chosen = Array.isArray(storedOptions)
    ? storedOptions.find(
        (o: any) => o && o.key === chosenKey && typeof o.label === "string",
      )
    : undefined;
  if (!chosen) {
    throw new LetterReplyError(
      "unknown_option",
      `unknown chosenOption '${chosenKey}' for letter-reply card #${itemId}`,
    );
  }

  const parse = item.contextBundle?.parse as LetterReplyParse | undefined;

  let outcome: ConfirmLetterReplyOutcome;
  let dispatchId: number | undefined;
  let precedentAdmitted: boolean | undefined;

  if (chosenKey === "confirm_ruling") {
    const ruling = parse?.kind === "ruling" ? parse.ruling : undefined;
    if (!ruling?.decision || !ruling?.why) {
      // Options said ruling but the stored parse can't back it — fail
      // closed rather than storing a precedent the founder never saw.
      throw new LetterReplyError(
        "malformed_card",
        `letter-reply card #${itemId} offers confirm_ruling but carries no ruling payload`,
      );
    }
    // WITNESSED ADMISSION — the one and only write to precedent memory for
    // a letter reply, and it happens strictly on the founder's tap.
    const result = await recordFounderPrecedent({
      itemId,
      itemType: "letter_reply",
      sourceKind: "letter_reply",
      question: ruling.situation?.trim() || parse!.restatement,
      answer: {
        outcome: "override",
        reason: `${ruling.decision} — ${ruling.why}`,
      },
    });
    precedentAdmitted = result.admitted;
    outcome = "stored_precedent";
  } else if (chosenKey === "confirm_directive") {
    const directive = parse?.kind === "directive" ? parse.directive : undefined;
    if (!directive?.brief) {
      throw new LetterReplyError(
        "malformed_card",
        `letter-reply card #${itemId} offers confirm_directive but carries no directive payload`,
      );
    }
    // WITNESSED ADMISSION — the one and only enqueue for a letter reply,
    // strictly on the founder's tap. Throws (ensemble cap / validation)
    // propagate: the card stays pending so the founder can retry or discard.
    dispatchId = await enqueueDispatch({
      sourceType: "letter_reply",
      sourceId: `letter-reply:${itemId}`,
      agentRole: normalizeDirectiveAgentRole(directive.agentRole),
      promptText: buildDirectivePrompt({
        brief: directive.brief,
        replyText: String(item.contextBundle?.replyText ?? ""),
        monthKey: String(item.contextBundle?.monthKey ?? ""),
      }),
      priority: clampDirectivePriority(directive.suggestedPriority),
      idempotencyKey: `letter-reply:${itemId}`,
      enqueuedBy: "founder_letter_reply",
    });
    outcome = "queued_directive";
  } else if (chosenKey === "send_to_chat") {
    // Resolves with a pointer only — never auto-opens chat, stores nothing.
    outcome = "sent_to_chat";
  } else if (chosenKey === "discard") {
    outcome = "discarded";
  } else {
    // Stored options carry a key this build doesn't understand — fail closed.
    throw new LetterReplyError(
      "unknown_option",
      `letter-reply option '${chosenKey}' has no confirm handler`,
    );
  }

  // Resolve AFTER the effect so a failed precedent-write/enqueue leaves the
  // card pending (retappable); the effects themselves are idempotent
  // (precedent upserts on sourceRef; dispatch dedupes on idempotencyKey),
  // so a retap can never double-fire.
  const now = new Date();
  await db
    .update(decisionsInboxItems)
    .set({
      status: chosenKey === "discard" ? "rejected" : "approved",
      resolvedAt: now,
      resolvedBy: "founder",
      founderOverrideAction: `option:${chosen.key} — ${chosen.label}`,
      updatedAt: now,
    })
    .where(eq(decisionsInboxItems.id, itemId));

  logger.info("[letterReply] confirm resolved", {
    metadata: { itemId, chosenKey, outcome, dispatchId, precedentAdmitted },
  });

  return {
    outcome,
    itemId,
    ...(dispatchId != null ? { dispatchId } : {}),
    ...(precedentAdmitted != null ? { precedentAdmitted } : {}),
  };
}
