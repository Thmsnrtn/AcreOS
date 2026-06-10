/**
 * Atlas chat-stream API.
 *
 * Phase B: the only new founder-side HTTP surface. Everything else
 * (40 tools, executor, registry) lives behind this endpoint.
 *
 *   POST /api/founder/chat/stream      — SSE streaming turn
 *   GET  /api/founder/chat/threads     — list founder threads (scope='founder')
 *   POST /api/founder/chat/threads     — create a new topic thread
 *   GET  /api/founder/chat/threads/:id/messages?cursor=
 *   POST /api/founder/chat/confirm/:requestId
 *   POST /api/founder/chat/cancel/:requestId
 *   POST /api/founder/chat/voice       — proxy to /api/ai/voice/transcribe
 *
 * SSE event shape mirrors Pax conventions:
 *   message_start | tool_call_start | tool_call_complete | artifact |
 *   text_delta | text_complete | message_end | error
 *
 * The Atlas turn is an agentic loop:
 *   1. Build system prompts via loadAtlasContext + buildAtlasSystemMessage.
 *   2. Call the LLM with tool inventory.
 *   3. For each tool_call → runTool() (audit + verifyFn + cooldown).
 *   4. Re-invoke until LLM emits text-only OR state.canCallMoreTools()=false.
 *   5. If state.shouldInjectRetryGuidance() → inject the block.
 *   6. If state.shouldEscalateToFounder() → emit pause-and-ask text_delta.
 */

import type { Express, Response } from "express";
import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { and, asc, desc, eq, lt } from "drizzle-orm";

import { db } from "./db";
import { zodToJsonSchema } from "./utils/zodToJsonSchema";
import {
  aiConversations,
  aiMessages,
  chatSecretPasteRequests,
  founderAudit,
} from "@shared/schema";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId, getOrganizationId } from "./types/request";

import { buildAtlasSystemMessage } from "./services/founder-chat/atlas-persona";
import { loadAtlasContext } from "./services/founder-chat/context-loader";
import { buildFounderToolContext } from "./services/founder-chat/context-resolver";
import {
  listTools,
  type FounderTool,
} from "./services/founder-chat/tool-registry";
import {
  runTool,
  confirmPendingToolCall,
  cancelPendingToolCall,
} from "./services/founder-chat/executor";
import {
  TurnState,
  buildRetryGuidanceBlock,
  readAgenticLoopBudget,
} from "./services/founder-chat/agentic-loop";
import {
  selectModelForTurn,
  parseOverrideFromMessage,
} from "./services/founder-chat/model-selector";
// Tier 1B (elevation blueprint): the founder-side counterpart of the Pax
// untrusted envelope — the <untrusted_data> doctrine in atlas-persona.ts is
// now mechanically enforced by wrapping customer-content fields in tool
// artifacts before they re-enter the model channel.
import { wrapUntrustedFields } from "./ai/untrustedEnvelope";

// Ensure tool side-effect registration on module import.
import "./services/founder-chat/tools";

// Phase D — the chat client sends a structured pageContext (currentPath
// plus already-resolved entity hints from useFounderChat/use-page-context).
// All fields optional; the server's buildFounderToolContext re-derives
// hints from currentPath for the legacy code path, then the explicit
// fields below override / augment.
const pageContextSchema = z.object({
  currentPath: z.string().max(500).optional(),
  currentOrgId: z.number().int().positive().optional(),
  currentShipmentId: z.number().int().positive().optional(),
  currentLedgerEventId: z.number().int().positive().optional(),
  currentProviderName: z.string().max(120).optional(),
  currentDialCategory: z.string().max(120).optional(),
}).partial();

const streamSchema = z.object({
  message: z.string().min(1).max(8000),
  threadId: z.number().int().positive().optional(),
  /** Legacy field — pre-Phase-D clients only sent currentPath. */
  currentPath: z.string().max(500).optional(),
  /** Phase D — structured page-context hints from the Atlas dock. */
  pageContext: pageContextSchema.optional(),
});

const createThreadSchema = z.object({
  threadTitle: z.string().min(1).max(200),
});

// ─── helpers ────────────────────────────────────────────────────────────────

// Zod → JSON-Schema conversion is shared with the App Intent registry; see
// server/utils/zodToJsonSchema.ts. Imported above.

function toolToOpenAITool(t: FounderTool): OpenAI.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.schema) as Record<string, unknown>,
    },
  };
}

function getOpenRouterClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || "missing",
    baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://acreos.io/founder",
      "X-Title": "AcreOS Atlas",
    },
  });
}

function sse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function getOrCreateDefaultFounderThread(userId: string, orgId: number): Promise<number> {
  const [existing] = await db.select().from(aiConversations)
    .where(and(eq(aiConversations.userId, userId), eq(aiConversations.scope, "founder"), eq(aiConversations.isDefault, true)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(aiConversations).values({
    organizationId: orgId,
    userId,
    title: "Atlas — daily check-in",
    threadTitle: "Atlas — daily check-in",
    agentRole: "atlas",
    scope: "founder",
    isDefault: true,
  } as any).returning({ id: aiConversations.id });
  return created.id;
}

// ─── router ─────────────────────────────────────────────────────────────────

const router = Router();

router.get("/threads", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const threads = await db.select().from(aiConversations)
      .where(and(eq(aiConversations.userId, userId), eq(aiConversations.scope, "founder")))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(100);
    res.json({ threads });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/threads", async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = createThreadSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    const userId = getUserId(req);
    const orgId = getOrganizationId(req);
    const [created] = await db.insert(aiConversations).values({
      organizationId: orgId,
      userId,
      title: parsed.data.threadTitle,
      threadTitle: parsed.data.threadTitle,
      agentRole: "atlas",
      scope: "founder",
      isDefault: false,
    } as any).returning({ id: aiConversations.id, threadTitle: aiConversations.threadTitle });
    res.json({ thread: created });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/threads/:id/messages", async (req: AuthenticatedRequest, res) => {
  try {
    const threadId = Number(req.params.id);
    if (!Number.isFinite(threadId)) return Errors.badRequest(res, "invalid thread id");
    const userId = getUserId(req);
    const [thread] = await db.select().from(aiConversations)
      .where(and(eq(aiConversations.id, threadId), eq(aiConversations.userId, userId)))
      .limit(1);
    if (!thread) return Errors.notFound(res, "Thread");
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const rows = cursor
      ? await db.select().from(aiMessages)
          .where(and(eq(aiMessages.conversationId, threadId), lt(aiMessages.id, cursor)))
          .orderBy(desc(aiMessages.id)).limit(50)
      : await db.select().from(aiMessages)
          .where(eq(aiMessages.conversationId, threadId))
          .orderBy(desc(aiMessages.id)).limit(50);
    res.json({ messages: rows.reverse(), nextCursor: rows.length === 50 ? rows[0]?.id : null });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/confirm/:requestId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const orgId = getOrganizationId(req);
    const ctx = await buildFounderToolContext({
      founderUserId: userId, organizationId: orgId, threadId: 0,
    });
    const result = await confirmPendingToolCall(req.params.requestId, ctx);
    res.json({ result });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/cancel/:requestId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const orgId = getOrganizationId(req);
    const ctx = await buildFounderToolContext({
      founderUserId: userId, organizationId: orgId, threadId: 0,
    });
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const result = await cancelPendingToolCall(req.params.requestId, ctx, reason);
    res.json({ result });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * Sealed-paste endpoint — the ONLY code path that ever sees a secret value.
 *
 * Atlas's fly_secret_set tool emits a `secret_paste` artifact carrying a
 * one-time-use requestId. The chat client renders a sealed input; on
 * submit, this endpoint:
 *   1. validates the request row exists, hasn't expired, hasn't been
 *      consumed, and matches the calling founder
 *   2. calls fly setSecret(keyName, value)
 *   3. stamps consumedAt
 *   4. writes ONLY a SHA-256 fingerprint to founder_audit — never the value
 *
 * The value never enters the LLM context, never lands in chat history,
 * and never appears in any log line in plaintext.
 */
const secretPasteSchema = z.object({
  value: z.string().min(1).max(8000),
});

router.post("/secret-paste/:requestId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const parsed = secretPasteSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

    const [row] = await db
      .select()
      .from(chatSecretPasteRequests)
      .where(eq(chatSecretPasteRequests.id, req.params.requestId))
      .limit(1);

    if (!row) return Errors.notFound(res, "Sealed paste request");
    if (row.founderUserId !== userId) return Errors.forbidden(res, "Paste request belongs to a different founder");
    if (row.consumedAt) return Errors.badRequest(res, "Paste request already consumed");
    if (row.expiresAt.getTime() < Date.now()) return Errors.badRequest(res, "Paste request expired");

    // Lazy-import so the fly provider isn't loaded at module-eval time
    // for environments without FLY_API_TOKEN.
    const { setSecret } = await import("./services/founder-chat/providers/fly");
    let fingerprint: string;
    try {
      const result = await setSecret(row.keyName, parsed.data.value);
      fingerprint = result.fingerprint;
    } catch (err) {
      logger.warn("[founder-chat] secret-paste setSecret failed", {
        metadata: {
          keyName: row.keyName,
          requestId: row.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return Errors.badRequest(res, "setSecret failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Stamp consumedAt (single-use).
    await db
      .update(chatSecretPasteRequests)
      .set({ consumedAt: new Date() as any })
      .where(eq(chatSecretPasteRequests.id, row.id));

    // Audit: ONLY the fingerprint — never the value.
    try {
      await db.insert(founderAudit).values({
        founderId: userId,
        area: "atlas.tool_call",
        action: `tool_call:${row.toolName}`,
        targetType: "fly_secret",
        targetId: row.keyName,
        after: {
          fingerprint,
          requestId: row.id,
          consumedAt: new Date().toISOString(),
          rollbackRecipe: {
            // The reverse is: paste the prior value again — but we have
            // ONLY the fingerprint, not the value. So this is a no-undo
            // recipe with a human label that says exactly that.
            humanLabel: `Re-paste prior ${row.keyName} value (fingerprint preserved in audit).`,
          },
        } as any,
        note: `thread=${row.threadId ?? "—"}`,
      } as any);
    } catch (err) {
      logger.warn("[founder-chat] secret-paste audit insert failed", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    return res.json({
      ok: true,
      evidence: {
        keyName: row.keyName,
        fingerprint,
        fingerprintShort: fingerprint.slice(0, 12),
      },
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/voice", async (req: AuthenticatedRequest, res) => {
  // Phase B stub: real implementation forwards multipart audio to the
  // /api/ai/voice/transcribe handler. For now we acknowledge — the chat
  // UI continues to call /api/ai/voice/transcribe directly until the
  // founder side wants its own per-thread voice surface.
  res.json({ ok: true, note: "Use /api/ai/voice/transcribe directly for now." });
});

router.post("/stream", async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = streamSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    const userId = getUserId(req);
    const orgId = getOrganizationId(req);

    let threadId = parsed.data.threadId;
    if (!threadId) threadId = await getOrCreateDefaultFounderThread(userId, orgId);

    // Parse /opus /sonnet /etc. override from user's prompt.
    const { override, cleanedMessage } = parseOverrideFromMessage(parsed.data.message);
    const userMessage = cleanedMessage || parsed.data.message;

    // Persist the user message before streaming so it's in history if we crash mid-turn.
    await db.insert(aiMessages).values({
      conversationId: threadId, role: "user", content: userMessage,
    } as any);

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const messageId = `atlas-msg-${Date.now()}`;
    sse(res, "message_start", { messageId, threadId });

    // Build context.
    const [contextSections, history, budget] = await Promise.all([
      loadAtlasContext({ founderUserId: userId }),
      db.select().from(aiMessages).where(eq(aiMessages.conversationId, threadId))
        .orderBy(asc(aiMessages.id)).limit(40),
      readAgenticLoopBudget(),
    ]);

    const toolCtx = await buildFounderToolContext({
      founderUserId: userId, organizationId: orgId, threadId,
      currentPath: parsed.data.currentPath,
      pageContext: parsed.data.pageContext,
      recentMessages: history.map((m: any) => ({ role: m.role, content: m.content, toolCalls: m.toolCalls })),
    });

    const atlasSystemMessage = buildAtlasSystemMessage(toolCtx);
    const { model } = selectModelForTurn({ intent: "reasoning", override });

    const turnState = new TurnState(budget);

    const allTools = listTools().map(toolToOpenAITool);
    const client = getOpenRouterClient();

    type ChatMsg = OpenAI.ChatCompletionMessageParam;
    const chatMessages: ChatMsg[] = [
      { role: "system", content: atlasSystemMessage },
      { role: "system", content: `# User memory\n${contextSections.userMemory}` },
      { role: "system", content: `# Project memory\n${contextSections.projectMemory}` },
      { role: "system", content: `# Recent audit\n${contextSections.recentAudit}` },
      ...history.map((m: any): ChatMsg => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content ?? "",
      })),
    ];

    let assistantText = "";
    let loop = true;
    let lastError: string | undefined;
    const accumulatedToolCalls: any[] = [];

    while (loop && turnState.canCallMoreTools()) {
      // Inject retry-guidance block if state says so.
      const guidance = turnState.shouldInjectRetryGuidance();
      if (guidance) {
        chatMessages.push({ role: "system", content: buildRetryGuidanceBlock(guidance) });
      }
      if (turnState.shouldEscalateToFounder()) {
        sse(res, "text_delta", { delta: "Hitting a wall — want me to dig deeper or want to look yourself?" });
        assistantText += "Hitting a wall — want me to dig deeper or want to look yourself?";
        break;
      }

      let completion: OpenAI.ChatCompletion;
      try {
        completion = await client.chat.completions.create({
          model,
          messages: chatMessages,
          tools: allTools.length > 0 ? allTools : undefined,
          max_tokens: 2048,
        });
      } catch (err: any) {
        lastError = String(err);
        logger.error("[founder-chat] LLM call failed", err);
        sse(res, "error", { message: lastError });
        break;
      }

      const choice = completion.choices?.[0];
      if (!choice) {
        sse(res, "error", { message: "no completion choice" });
        break;
      }
      const msg = choice.message;

      if (msg.content) {
        sse(res, "text_delta", { delta: msg.content });
        assistantText += msg.content;
      }

      const toolCalls = (msg as any).tool_calls as any[] | undefined;
      if (!toolCalls || toolCalls.length === 0) {
        // No more tool calls — done.
        loop = false;
        break;
      }

      // Push assistant message into history (with tool_calls so subsequent calls can reference).
      chatMessages.push(msg as ChatMsg);

      for (const tc of toolCalls) {
        const toolName = tc.function?.name as string;
        let toolArgs: unknown = {};
        try {
          toolArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          toolArgs = {};
        }
        sse(res, "tool_call_start", { toolName, args: toolArgs, toolCallId: tc.id });

        try {
          const outcome = await runTool({ toolName, args: toolArgs, ctx: toolCtx });
          sse(res, "artifact", { toolCallId: tc.id, artifact: outcome.artifact, verification: outcome.verification });
          sse(res, "tool_call_complete", { toolCallId: tc.id, ok: true, requiresConfirmation: outcome.requiresConfirmation ?? false });
          accumulatedToolCalls.push({ name: toolName, args: toolArgs, artifact: outcome.artifact });
          turnState.recordToolRun({ toolName, success: true });

          // If a confirmation was returned, exit the loop — wait for the founder.
          if (outcome.requiresConfirmation) {
            loop = false;
            break;
          }

          // Feed the tool result back into the chat history for the next LLM pass.
          // Customer-content fields (notes, descriptions, bodies, …) inside the
          // artifact are wrapped in the untrusted envelope first.
          chatMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              artifact: wrapUntrustedFields(outcome.artifact, `tool:${toolName}`),
              followUp: outcome.followUp ?? null,
            }),
          } as ChatMsg);
        } catch (err: any) {
          const errMsg = String(err?.message ?? err);
          sse(res, "tool_call_complete", { toolCallId: tc.id, ok: false, error: errMsg });
          turnState.recordToolRun({ toolName, success: false, errorClass: classifyError(errMsg) });
          chatMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ error: errMsg }),
          } as ChatMsg);
        }
      }
    }

    if (loop && !turnState.canCallMoreTools()) {
      sse(res, "text_delta", { delta: `\n\n(Tool-call budget exhausted; ${turnState.toolCallCount} calls.)` });
      assistantText += `\n\n(Tool-call budget exhausted; ${turnState.toolCallCount} calls.)`;
    }

    // Persist assistant turn (text + tool calls).
    try {
      await db.insert(aiMessages).values({
        conversationId: threadId, role: "assistant",
        content: assistantText,
        toolCalls: accumulatedToolCalls as any,
      } as any);
      await db.update(aiConversations).set({ updatedAt: new Date() } as any).where(eq(aiConversations.id, threadId));
    } catch (persistErr) {
      logger.warn("[founder-chat] failed to persist assistant turn", { metadata: { err: String(persistErr) } });
    }

    sse(res, "text_complete", { text: assistantText });
    sse(res, "message_end", { messageId, threadId, toolCallCount: turnState.toolCallCount });
    res.end();
  } catch (err) {
    logger.error("[founder-chat] stream error", err instanceof Error ? err : undefined);
    try {
      sse(res, "error", { message: err instanceof Error ? err.message : String(err) });
    } catch {
      /* socket may already be closed */
    }
    res.end();
  }
});

function classifyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("not found")) return "not_found";
  if (m.includes("validation")) return "validation";
  if (m.includes("permission") || m.includes("forbidden")) return "permission";
  if (m.includes("timeout")) return "timeout";
  return "unknown";
}

// ─── mount ──────────────────────────────────────────────────────────────────

export function registerFounderChatRoutes(app: Express): void {
  app.use(
    "/api/founder/chat",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    router,
  );
}

export default router;
