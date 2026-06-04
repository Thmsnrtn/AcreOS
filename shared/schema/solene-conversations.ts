// ============================================================================
// SHARED/SCHEMA/SOLENE-CONVERSATIONS.TS
// ----------------------------------------------------------------------------
// Phase 1 of the AcreOS-Solene migration: the shared-persistence layer.
//
// Two tables — solene_conversations (one row per thread) + solene_messages
// (one row per message in a thread) — that let CLI Claude Code + a future
// in-app AcreOS Solene chat read/write the same conversation state.
//
// Anthropic-shape content blocks live in solene_messages.content (jsonb). A
// single row may contain text + tool_use + tool_result blocks (matching the
// Anthropic Messages API shape verbatim) so we don't lose fidelity replaying
// a CLI session inside the app.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================
import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
  jsonb,
  numeric,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// ENUMS
// ============================================
export const CONVERSATION_SURFACES = ["cli", "acreos", "cron"] as const;
export type ConversationSurface = (typeof CONVERSATION_SURFACES)[number];

export const MESSAGE_ROLES = ["user", "assistant", "tool", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

// ============================================
// Anthropic-shape content blocks
// ============================================
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | ContentBlock[];
      is_error?: boolean;
    };

// ============================================
// solene_conversations — one row per thread
// ============================================
export const soleneConversations = pgTable(
  "solene_conversations",
  {
    id: serial("id").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedSurface: text("started_surface").notNull(), // cli | acreos | cron
    title: text("title"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archived: boolean("archived").notNull().default(false),
    // Clerk user id of the founder; null for system/cron-initiated.
    founderUserId: text("founder_user_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    // Recent threads first across all surfaces.
    index("solene_conversations_last_message_idx").on(t.lastMessageAt),
    // Founder inbox: their non-archived threads, newest first.
    index("solene_conversations_founder_archived_last_idx").on(
      t.founderUserId,
      t.archived,
      t.lastMessageAt,
    ),
    // Per-surface chronological scan.
    index("solene_conversations_surface_started_idx").on(
      t.startedSurface,
      t.startedAt,
    ),
  ],
);

export type SoleneConversationRow = typeof soleneConversations.$inferSelect;
export type InsertSoleneConversationRow =
  typeof soleneConversations.$inferInsert;

// ============================================
// solene_messages — one row per message in a thread
// ============================================
export const soleneMessages = pgTable(
  "solene_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    role: text("role").notNull(), // user | assistant | tool | system
    // Anthropic-style content blocks (text / tool_use / tool_result). Stored
    // as a jsonb ARRAY so a single message can carry multiple blocks (e.g.,
    // a text + tool_use combo on a single assistant turn).
    content: jsonb("content").$type<ContentBlock[]>().notNull(),
    // For edit/branch trees: nullable pointer to the parent message id.
    parentMessageId: integer("parent_message_id"),
    // For tool_use → tool_result pairing when role='tool'.
    toolCallId: text("tool_call_id"),
    // Model + usage attribution.
    modelUsed: text("model_used"),
    usageInputTokens: integer("usage_input_tokens"),
    usageOutputTokens: integer("usage_output_tokens"),
    usageCacheReadTokens: integer("usage_cache_read_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 10,
      scale: 6,
    }),
    errorMessage: text("error_message"),
  },
  (t) => [
    // Replay-in-order: all messages in a conversation, oldest first.
    index("solene_messages_conversation_sent_idx").on(
      t.conversationId,
      t.sentAt,
    ),
    // Edit/branch tree navigation.
    index("solene_messages_conversation_parent_idx").on(
      t.conversationId,
      t.parentMessageId,
    ),
    // tool_use → tool_result lookup. Partial index keeps it small.
    index("solene_messages_tool_call_idx").on(t.toolCallId),
  ],
);

export type SoleneMessageRow = typeof soleneMessages.$inferSelect;
export type InsertSoleneMessageRow = typeof soleneMessages.$inferInsert;
