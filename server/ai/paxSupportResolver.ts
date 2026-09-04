/**
 * Pax-Support resolution variant — Tahoe E4
 * ===========================================
 *
 * A specialized customer-support *resolution* agent built on the existing
 * supportAgent.ts substrate (shared OpenRouter client wrapper, shared support
 * tool catalog, shared executeSupportTool runtime). It is the SAME Pax identity
 * to the customer — never a different name. What differs from the conversational
 * `processSupportChat` is the *intent*: this variant runs a ticket end-to-end
 * toward a single decision — auto-resolve or escalate to a human — and gates
 * that decision on a confidence threshold.
 *
 * Differences from processSupportChat:
 *   - Specialized system prompt tuned for resolution (not open chat): diagnose,
 *     search KB, propose a single resolution, and self-assess confidence.
 *   - Narrowed, resolution-focused tool scope (read/diagnose + draft + escalate)
 *     instead of the full self-healing/mutation catalog. Keeps the loop tight
 *     and the auto-resolve decision auditable.
 *   - Forces a terminal `draft_customer_response` so every run yields a
 *     confidence score + a customer-facing reply.
 *   - Confidence gate:
 *       confidence >= threshold  → AUTO-RESOLVE (reply persisted as Pax, ticket
 *                                  marked resolved/auto)
 *       confidence <  threshold  → ESCALATE (optionally try the Opus
 *                                  second-opinion path, then mark escalated)
 *
 * Reuse, not reinvention:
 *   - getOpenAIClient() — the SAME OpenRouter-backed client wrapper the rest of
 *     the support stack uses. We do NOT instantiate a new Anthropic/OpenAI SDK
 *     client here.
 *   - supportToolDefinitions / executeSupportTool — the SAME tool catalog and
 *     runtime, just a curated subset.
 */

import type OpenAI from "openai";
import { eq } from "drizzle-orm";
import { db } from "../db";
import type { Organization } from "@shared/schema";
import { supportTickets, supportTicketMessages } from "@shared/schema";
import { logger } from "../utils/logger";
import {
  getOpenAIClient,
  supportToolDefinitions,
  executeSupportTool,
  PAX_SYSTEM_PROMPT,
} from "./supportAgent";
import { serializeToolResultForModel } from "./untrustedEnvelope";
import { recordSupportResolveDecision } from "../services/andrei/supportResolverCalibration";

const MAX_RESOLVE_ITERATIONS = 8;

// Confidence at/above this auto-resolves; below escalates. Mirrors the
// SOPHIE_CONFIDENCE_MODE ladder used by customerSupportAutoResolver so the two
// paths agree on what "confident enough" means. Billing is held to a stricter
// bar (auto-resolving a billing ticket wrongly is high-blast-radius).
const RESOLVE_CONFIDENCE_THRESHOLDS: Record<string, number> = {
  conservative: 90,
  balanced: 70,
  aggressive: 60,
};

export function getResolveConfidenceThreshold(category?: string): number {
  const mode = process.env.SOPHIE_CONFIDENCE_MODE ?? "balanced";
  const base = RESOLVE_CONFIDENCE_THRESHOLDS[mode] ?? 70;
  // Billing must clear a hard 90 regardless of mode.
  return category === "billing" ? Math.max(base, 90) : base;
}

/**
 * Tier 2D — the EFFECTIVE threshold the gate acts on: founder-configured base
 * plus the calibration grader's bounded offset (raised on drift, lowered on
 * recovery — see services/andrei/resolverThresholdAdjustment.ts). The offset
 * is clamped to [0, +15] at write AND read, and base + offset is capped at
 * EFFECTIVE_THRESHOLD_CEILING so adjustment can never silently disable
 * auto-resolve. Fail-safe: any offset-read problem degrades to the base.
 */
export async function getEffectiveResolveConfidenceThreshold(
  category?: string,
): Promise<number> {
  const base = getResolveConfidenceThreshold(category);
  try {
    const { getActiveResolveThresholdOffset, EFFECTIVE_THRESHOLD_CEILING } =
      await import("../services/andrei/resolverThresholdAdjustment");
    const offset = await getActiveResolveThresholdOffset();
    return Math.min(EFFECTIVE_THRESHOLD_CEILING, base + offset);
  } catch {
    return base; // calibration plumbing must never break a support turn
  }
}

// Resolution-focused subset of the support tool catalog. Read / diagnose /
// decide only — the broad self-healing mutators (bulk fixes, stripe resync,
// session invalidation, etc.) stay in the interactive agent. A resolution run
// should *propose* a resolution and escalate when it can't, not silently mutate
// account state inside an autonomous loop.
const RESOLVER_TOOL_NAMES = [
  "search_knowledge_base",
  "search_resolved_tickets",
  "get_similar_resolutions",
  "get_troubleshooting_steps",
  "diagnose_account",
  "check_data_integrity",
  "get_account_summary",
  "query_user_data",
  "get_user_activity",
  "estimate_resolution_confidence",
  "recall_user_memory",
  "draft_customer_response",
  "escalate_to_human",
] as const;

const PAX_RESOLVER_SYSTEM_PROMPT = `${PAX_SYSTEM_PROMPT}

────────────────────────────────────────────────────────
RESOLUTION MODE (autonomous)
You are running in autonomous resolution mode on a single support ticket. There
is no live customer to ask follow-up questions — you must reach a decision from
the ticket and the tools available.

Run this loop, then STOP:
1. Recall any prior context (recall_user_memory) and search the knowledge base /
   past resolutions for the issue (search_knowledge_base, get_similar_resolutions).
2. Diagnose with read-only tools as needed (diagnose_account, query_user_data,
   check_data_integrity, get_user_activity).
3. Decide ONE outcome and call draft_customer_response EXACTLY ONCE as your final
   tool call:
      - response_text: the full customer-facing reply, signed as Pax / AcreOS
        Support. Never use any internal codename.
      - confidence_score: 0-100, your honest confidence that this reply RESOLVES
        the ticket. Be calibrated — over-confidence sends a wrong answer to a
        customer; under-confidence wastes a human's time.
      - resolution_type: answer_question | apply_fix | escalate_phone |
        apply_credit | custom.
4. If you genuinely cannot resolve it (needs account access you don't have, a
   bug, anything ambiguous or risky), still call draft_customer_response with a
   LOW confidence_score and a holding reply — the system will route it to a human.

Do NOT call account-mutating tools. Propose; do not change account state.
Do NOT promise refunds, credits, or legal/tax advice — escalate those.`;

export interface PaxResolveResult {
  /** true → reply sent to customer and ticket resolved; false → escalated to human */
  autoResolved: boolean;
  confidence: number;
  /** the customer-facing reply the variant produced (sent if auto-resolved) */
  response: string;
  resolutionType?: string;
  toolsUsed: string[];
  escalated: boolean;
  /** populated when the Opus second-opinion path resolved a borderline ticket */
  geniusResolved?: boolean;
}

/**
 * Minimal shape of the chat-completions call this variant depends on. Defaults
 * to the shared getOpenAIClient() at call time; injectable so tests can drive
 * the confidence gate with a mocked model and no network.
 */
export type ChatCompletionFn = (
  params: OpenAI.ChatCompletionCreateParamsNonStreaming,
) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

function defaultCompletionFn(): ChatCompletionFn {
  const client = getOpenAIClient();
  return (params) => client.chat.completions.create(params);
}

/**
 * Run a support ticket through the Pax-Support resolution variant and apply the
 * confidence gate.
 *
 * @param ticketId   ticket to resolve
 * @param org        the ticket's organization (for tool execution scope)
 * @param opts.createCompletion  inject a model fn (tests); defaults to the
 *                               shared OpenRouter client
 * @param opts.tryGeniusOnEscalate  on escalate, attempt the Opus second-opinion
 *                               path via customerSupportAutoResolver (default true)
 */
export async function resolveTicketWithPax(
  ticketId: number,
  org: Organization,
  opts: {
    createCompletion?: ChatCompletionFn;
    tryGeniusOnEscalate?: boolean;
    /**
     * The signed-in person who ASKED for this resolution, when a human did.
     *
     * Distinct from the ticket's author, and the distinction is the point: the
     * permission ladder is checked against BOTH, so a caller cannot borrow the
     * author's authority. `POST /api/support/tickets/:id/pax-resolve`
     * authorises the organization and nothing else, and `/api/support/` is
     * exempt from the viewer read-only gate.
     *
     * Omitted for machine-initiated resolutions, where there is no second
     * human and the author alone is the subject.
     */
    requestedByUserId?: string | null;
  } = {},
): Promise<PaxResolveResult> {
  const createCompletion = opts.createCompletion ?? defaultCompletionFn();
  const tryGenius = opts.tryGeniusOnEscalate ?? true;

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, ticketId),
  });
  if (!ticket) {
    throw new Error(`Ticket #${ticketId} not found`);
  }

  const category = ticket.category ?? "general";
  // Tier 2D: base threshold + the calibration grader's bounded offset.
  const threshold = await getEffectiveResolveConfidenceThreshold(category);

  const tools = RESOLVER_TOOL_NAMES.map((name) => ({
    type: "function" as const,
    function: (supportToolDefinitions as Record<string, any>)[name],
  }));

  const previousMessages = await db
    .select()
    .from(supportTicketMessages)
    .where(eq(supportTicketMessages.ticketId, ticketId))
    .orderBy(supportTicketMessages.createdAt);

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: PAX_RESOLVER_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Resolve support ticket #${ticketId}.\n` +
        `Subject: ${ticket.subject ?? "(none)"}\n` +
        `Category: ${category}\n` +
        `Description: ${ticket.description ?? "(none)"}`,
    },
  ];
  for (const msg of previousMessages) {
    if (msg.role === "user") {
      chatMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "agent") {
      chatMessages.push({ role: "assistant", content: msg.content });
    }
  }

  const toolsUsed: string[] = [];
  let draft: { response: string; confidence: number; resolutionType?: string } | null = null;

  let response = await createCompletion({
    model: "openai/gpt-4o",
    messages: chatMessages,
    tools,
    tool_choice: "auto",
  });
  let assistantMessage = response.choices[0].message;

  let iterations = 0;
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    if (++iterations > MAX_RESOLVE_ITERATIONS) {
      logger.warn(
        `[paxSupportResolver] ticket #${ticketId} exceeded ${MAX_RESOLVE_ITERATIONS} iterations — escalating`,
      );
      break;
    }

    const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
    for (const toolCall of assistantMessage.tool_calls) {
      if (!("function" in toolCall)) continue;
      const name = toolCall.function.name;
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        args = {};
      }
      toolsUsed.push(name);

      // Capture the terminal decision without mutating account state.
      // draft_customer_response and escalate_to_human are decision signals,
      // not side-effecting fixes, so we short-circuit them here.
      if (name === "draft_customer_response") {
        draft = {
          response: String(args.response_text ?? ""),
          confidence: Math.max(0, Math.min(100, Number(args.confidence_score) || 0)),
          resolutionType: args.resolution_type,
        };
        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: true, recorded: true }),
        });
        continue;
      }
      if (name === "escalate_to_human") {
        // Honor an explicit escalate by recording a zero-confidence draft so the
        // gate routes to a human.
        draft = {
          response: String(args.summary ?? "Escalating to a human specialist."),
          confidence: 0,
          resolutionType: "escalate_phone",
        };
        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: true, escalated: true }),
        });
        continue;
      }

      // The permission ladder is checked against the person whose ticket this
      // is (supportAgent.ts's scope gate, 2026-09-04). Pax resolving a ticket
      // acts on their behalf and must never be able to do more for them than
      // they could do themselves — without this the resolver would be an
      // unidentified caller and every side-effecting tool would refuse.
      const result = await executeSupportTool(name, args, org, ticketId, {
        origin: "support",
        userId: ticket.userId,
        alsoRequireUserId: opts.requestedByUserId ?? null,
      });
      toolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        // Tier 1B: customer-content fields wrapped in the untrusted
        // envelope before re-entering the model channel.
        content: serializeToolResultForModel(name, result),
      });
    }

    // Once a terminal decision is captured, stop looping.
    if (draft) break;

    chatMessages.push(assistantMessage as any);
    chatMessages.push(...toolResults);

    response = await createCompletion({
      model: "openai/gpt-4o",
      messages: chatMessages,
      tools,
      tool_choice: "auto",
    });
    assistantMessage = response.choices[0].message;
  }

  // No structured draft emerged — treat the assistant's free text (if any) as a
  // low-confidence draft so we escalate rather than silently drop the ticket.
  if (!draft) {
    draft = {
      response:
        assistantMessage.content ??
        "Thanks for reaching out — a specialist will follow up shortly.",
      confidence: 0,
      resolutionType: "custom",
    };
  }

  const confidence = draft.confidence;
  const meetsBar = confidence >= threshold && draft.response.trim().length > 0;

  if (meetsBar) {
    // AUTO-RESOLVE — persist the reply as Pax (never an internal codename) and
    // mark the ticket resolved by the auto path.
    await db.insert(supportTicketMessages).values({
      ticketId,
      role: "agent",
      agentName: "Pax",
      content: draft.response,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : null,
    });
    await db
      .update(supportTickets)
      .set({
        status: "resolved",
        resolution: draft.response,
        resolutionType: "auto_fixed",
        resolvedBy: "pax",
        resolvedAt: new Date(),
        aiHandled: true,
        aiConfidenceScore: String(confidence),
        aiResolutionAttempts: (ticket.aiResolutionAttempts ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, ticketId));

    logger.info(
      `[paxSupportResolver] ticket #${ticketId} auto-resolved by Pax (confidence ${confidence}%, threshold ${threshold}%)`,
    );
    // Andrei — close the calibration loop. Record the autonomous-resolve DECISION
    // (stated confidence + path tag + confidence-band observation) so the outcome
    // can later be graded against reopen/CSAT. Fail-soft: never blocks the resolve.
    await recordSupportResolveDecision({
      ticketId,
      organizationId: org.id,
      confidence,
      decision: "auto_resolve",
      category,
      threshold,
    });
    return {
      autoResolved: true,
      confidence,
      response: draft.response,
      resolutionType: draft.resolutionType,
      toolsUsed,
      escalated: false,
    };
  }

  // BELOW THRESHOLD → escalate. First, optionally try the Opus second-opinion
  // path on the existing auto-resolver substrate for borderline tickets.
  if (tryGenius) {
    try {
      const { customerSupportAutoResolver } = await import(
        "../services/customerSupportAutoResolver"
      );
      const genius = await customerSupportAutoResolver.attemptResolution(ticketId, {
        draftResponse: draft.response,
        confidenceScore: confidence,
        category,
      });
      if (genius.autoResolved) {
        logger.info(
          `[paxSupportResolver] ticket #${ticketId} resolved via Opus second opinion`,
        );
        // The Opus second opinion still ends in an autonomous customer-facing
        // resolve — record it on the calibration loop too.
        await recordSupportResolveDecision({
          ticketId,
          organizationId: org.id,
          confidence,
          decision: "auto_resolve",
          category,
          threshold,
        });
        return {
          autoResolved: true,
          confidence,
          response: genius.geniusResponse ?? draft.response,
          resolutionType: draft.resolutionType,
          toolsUsed,
          escalated: false,
          geniusResolved: true,
        };
      }
    } catch (err) {
      logger.warn("[paxSupportResolver] genius second-opinion path failed", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // Escalate to a human.
  await db
    .update(supportTickets)
    .set({
      status: "open",
      resolutionType: "escalated",
      assignedAgent: null,
      aiHandled: true,
      aiConfidenceScore: String(confidence),
      aiResolutionAttempts: (ticket.aiResolutionAttempts ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, ticketId));

  logger.info(
    `[paxSupportResolver] ticket #${ticketId} escalated to human (confidence ${confidence}% < threshold ${threshold}%)`,
  );
  // Andrei — record the escalate DECISION on the calibration loop too, so the
  // plot can filter the full autonomous path (both gate outcomes), not just the
  // auto-resolves. Fail-soft.
  await recordSupportResolveDecision({
    ticketId,
    organizationId: org.id,
    confidence,
    decision: "escalate",
    category,
    threshold,
  });
  return {
    autoResolved: false,
    confidence,
    response: draft.response,
    resolutionType: draft.resolutionType,
    toolsUsed,
    escalated: true,
  };
}
