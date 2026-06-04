/**
 * SOLENE — conversation persistence (Phase 1 / shared-persistence layer).
 *
 * One row per conversation thread in `solene_conversations`; one row per
 * message in `solene_messages`. Content is stored as an Anthropic-shape
 * jsonb array (text / tool_use / tool_result blocks) so a CLI session can
 * be replayed inside the AcreOS Solene chat without lossy translation.
 *
 * appendMessage updates the parent conversation's last_message_at; the
 * timestamp update is fire-and-forget on the message insert so a transient
 * DB blip on the timestamp doesn't fail the message write.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneConversations,
  soleneMessages,
  CONVERSATION_SURFACES,
  MESSAGE_ROLES,
  type ContentBlock,
  type ConversationSurface,
  type MessageRole,
  type SoleneConversationRow,
  type SoleneMessageRow,
} from "@shared/schema/solene-conversations";
import { logger } from "../../utils/logger";

// ============================================
// Types
// ============================================

export interface CreateConversationInput {
  startedSurface: ConversationSurface;
  founderUserId?: string;
  title?: string;
  initialUserMessage?: { content: ContentBlock[] };
  metadata?: Record<string, unknown>;
}

export interface CreateConversationResult {
  conversationId: number;
}

export interface AppendMessageInput {
  conversationId: number;
  role: MessageRole;
  content: ContentBlock[];
  parentMessageId?: number;
  toolCallId?: string;
  modelUsed?: string;
  usageInputTokens?: number;
  usageOutputTokens?: number;
  usageCacheReadTokens?: number;
  estimatedCostUsd?: number;
  errorMessage?: string;
}

export interface AppendMessageResult {
  messageId: number;
}

export interface ListConversationsOpts {
  founderUserId?: string;
  archived?: boolean;
  limit?: number;
  surface?: ConversationSurface;
}

export interface ConversationWithMessages {
  conversation: SoleneConversationRow;
  messages: SoleneMessageRow[];
}

export interface ConversationCostSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
  messageCount: number;
}

// ============================================
// Constants
// ============================================

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;
const AUTO_TITLE_MAX_LEN = 60;

// ============================================
// Helpers
// ============================================

function isKnownSurface(s: string): s is ConversationSurface {
  return (CONVERSATION_SURFACES as readonly string[]).includes(s);
}

function isKnownRole(r: string): r is MessageRole {
  return (MESSAGE_ROLES as readonly string[]).includes(r);
}

/**
 * Auto-title from the first user message — uses the first text-block content,
 * stripped + truncated to AUTO_TITLE_MAX_LEN chars. Returns "Untitled" if no
 * text block is found.
 */
export function autoTitleFromMessage(content: ContentBlock[]): string {
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      const trimmed = block.text.replace(/\s+/g, " ").trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length <= AUTO_TITLE_MAX_LEN) return trimmed;
      // Reserve 1 char for the ellipsis so the wire length never exceeds the cap.
      return trimmed.slice(0, AUTO_TITLE_MAX_LEN - 1) + "…";
    }
  }
  return "Untitled";
}

// ============================================
// createConversation
// ============================================

export async function createConversation(
  input: CreateConversationInput,
): Promise<CreateConversationResult> {
  if (!input.startedSurface || !isKnownSurface(input.startedSurface)) {
    throw new Error(
      `createConversation: invalid startedSurface=${String(input.startedSurface)}`,
    );
  }

  // If the caller didn't pass a title but did pass an initial user message,
  // auto-title from it.
  let title: string | null = input.title ?? null;
  if (!title && input.initialUserMessage) {
    title = autoTitleFromMessage(input.initialUserMessage.content);
  }

  const [inserted] = await db
    .insert(soleneConversations)
    .values({
      startedSurface: input.startedSurface,
      founderUserId: input.founderUserId ?? null,
      title,
      metadata: input.metadata ?? {},
    })
    .returning({ id: soleneConversations.id });

  if (!inserted) {
    throw new Error("createConversation: insert returned no id");
  }

  const conversationId = inserted.id;

  // If the caller passed an initial user message, append it now.
  if (input.initialUserMessage) {
    try {
      await appendMessage({
        conversationId,
        role: "user",
        content: input.initialUserMessage.content,
      });
    } catch (err) {
      logger.warn(
        `[conversationStore] initial-message append failed conv=${conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  logger.info(
    `[conversationStore] created conversation id=${conversationId} surface=${input.startedSurface}`,
  );

  return { conversationId };
}

// ============================================
// appendMessage
// ============================================

export async function appendMessage(
  input: AppendMessageInput,
): Promise<AppendMessageResult> {
  if (!Number.isFinite(input.conversationId) || input.conversationId <= 0) {
    throw new Error(
      `appendMessage: invalid conversationId=${input.conversationId}`,
    );
  }
  if (!input.role || !isKnownRole(input.role)) {
    throw new Error(`appendMessage: invalid role=${String(input.role)}`);
  }
  if (!Array.isArray(input.content) || input.content.length === 0) {
    throw new Error("appendMessage: content must be a non-empty array");
  }

  const estimatedCostUsd =
    input.estimatedCostUsd !== undefined
      ? input.estimatedCostUsd.toString()
      : null;

  const [inserted] = await db
    .insert(soleneMessages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      parentMessageId: input.parentMessageId ?? null,
      toolCallId: input.toolCallId ?? null,
      modelUsed: input.modelUsed ?? null,
      usageInputTokens: input.usageInputTokens ?? null,
      usageOutputTokens: input.usageOutputTokens ?? null,
      usageCacheReadTokens: input.usageCacheReadTokens ?? null,
      estimatedCostUsd,
      errorMessage: input.errorMessage ?? null,
    })
    .returning({ id: soleneMessages.id });

  if (!inserted) {
    throw new Error("appendMessage: insert returned no id");
  }

  // Fire-and-forget: bump last_message_at on the parent conversation. Don't
  // block the caller (or fail the message write) on a transient timestamp
  // update blip.
  void (async () => {
    try {
      await db
        .update(soleneConversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(soleneConversations.id, input.conversationId));
    } catch (err) {
      logger.warn(
        `[conversationStore] last_message_at bump failed conv=${input.conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  })();

  return { messageId: inserted.id };
}

// ============================================
// listConversations
// ============================================

export async function listConversations(
  opts: ListConversationsOpts = {},
): Promise<SoleneConversationRow[]> {
  const limit = Math.min(
    Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIST_LIMIT)),
    MAX_LIST_LIMIT,
  );

  const conditions = [];
  if (opts.founderUserId !== undefined) {
    conditions.push(
      eq(soleneConversations.founderUserId, opts.founderUserId),
    );
  }
  if (opts.archived !== undefined) {
    conditions.push(eq(soleneConversations.archived, opts.archived));
  }
  if (opts.surface !== undefined) {
    if (!isKnownSurface(opts.surface)) {
      throw new Error(
        `listConversations: invalid surface=${String(opts.surface)}`,
      );
    }
    conditions.push(eq(soleneConversations.startedSurface, opts.surface));
  }

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  const q = db.select().from(soleneConversations);
  const rows = await (where ? q.where(where) : q)
    .orderBy(desc(soleneConversations.lastMessageAt))
    .limit(limit);

  return rows;
}

// ============================================
// getConversation
// ============================================

export async function getConversation(
  conversationId: number,
): Promise<ConversationWithMessages | null> {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    throw new Error(
      `getConversation: invalid conversationId=${conversationId}`,
    );
  }

  const [conversation] = await db
    .select()
    .from(soleneConversations)
    .where(eq(soleneConversations.id, conversationId))
    .limit(1);

  if (!conversation) return null;

  const messages = await db
    .select()
    .from(soleneMessages)
    .where(eq(soleneMessages.conversationId, conversationId))
    .orderBy(asc(soleneMessages.sentAt));

  return { conversation, messages };
}

// ============================================
// archiveConversation
// ============================================

export async function archiveConversation(
  conversationId: number,
): Promise<void> {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    throw new Error(
      `archiveConversation: invalid conversationId=${conversationId}`,
    );
  }
  await db
    .update(soleneConversations)
    .set({ archived: true })
    .where(eq(soleneConversations.id, conversationId));
}

// ============================================
// renameConversation
// ============================================

export async function renameConversation(
  conversationId: number,
  title: string,
): Promise<void> {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    throw new Error(
      `renameConversation: invalid conversationId=${conversationId}`,
    );
  }
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("renameConversation: title must be non-empty");
  }
  await db
    .update(soleneConversations)
    .set({ title })
    .where(eq(soleneConversations.id, conversationId));
}

// ============================================
// getConversationCostSummary
// ============================================

export async function getConversationCostSummary(
  conversationId: number,
): Promise<ConversationCostSummary> {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    throw new Error(
      `getConversationCostSummary: invalid conversationId=${conversationId}`,
    );
  }

  const rows = await db
    .select({
      usageInputTokens: soleneMessages.usageInputTokens,
      usageOutputTokens: soleneMessages.usageOutputTokens,
      usageCacheReadTokens: soleneMessages.usageCacheReadTokens,
      estimatedCostUsd: soleneMessages.estimatedCostUsd,
    })
    .from(soleneMessages)
    .where(eq(soleneMessages.conversationId, conversationId));

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let totalCostUsd = 0;

  for (const row of rows) {
    if (typeof row.usageInputTokens === "number") {
      inputTokens += row.usageInputTokens;
    }
    if (typeof row.usageOutputTokens === "number") {
      outputTokens += row.usageOutputTokens;
    }
    if (typeof row.usageCacheReadTokens === "number") {
      cacheReadTokens += row.usageCacheReadTokens;
    }
    if (row.estimatedCostUsd !== null && row.estimatedCostUsd !== undefined) {
      const asNum =
        typeof row.estimatedCostUsd === "number"
          ? row.estimatedCostUsd
          : parseFloat(String(row.estimatedCostUsd));
      if (Number.isFinite(asNum)) totalCostUsd += asNum;
    }
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    totalCostUsd,
    messageCount: rows.length,
  };
}

// Re-export underlying row types for caller convenience.
export type { SoleneConversationRow, SoleneMessageRow, ContentBlock };
// Silence unused import warning for sql — kept available for future
// percentile aggregates.
void sql;
