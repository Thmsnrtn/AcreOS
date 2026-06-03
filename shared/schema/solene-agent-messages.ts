// ============================================================================
// SHARED/SCHEMA/SOLENE-AGENT-MESSAGES.TS
// ----------------------------------------------------------------------------
// Solene — inter-agent direct communication (Phase B / L2.5).
//
// One row per direct message sent from one agent (Iris/Soren/Beatrice/Krieger/
// general-purpose) to another. Lets Iris ask Beatrice for a compliance review
// without round-tripping through Solene-as-router. Saves tokens (no Solene
// turn just to forward) and deepens cross-functional trust.
//
// Threading model:
//   - correlation_id      — free-form thread key (any string). When unset on
//                           a reply, sendAgentMessage auto-populates it from
//                           the parent message's correlation_id (or the
//                           parent's id stringified, if the parent has none).
//   - in_reply_to_message_id — FK to agent_messages.id; the message this is
//                              a direct reply to.
//
// Read tracking:
//   - read_at        — set by markAsRead when the recipient sees it.
//   - responded_at   — set by recordResponseSent when the recipient sends a
//                      reply via sendAgentMessage(..., inReplyToMessageId=N).
//
// dispatch_id_context (nullable) — the dispatch row id during which this
// message was sent, so the founder UI can answer "what messages did Iris
// send during dispatch 1234?".
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";

// ============================================
// AGENT_MESSAGES
// ============================================
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: serial("id").primaryKey(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    fromAgentRole: text("from_agent_role").notNull(),
    toAgentRole: text("to_agent_role").notNull(),
    inReplyToMessageId: integer("in_reply_to_message_id"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    priority: text("priority").notNull().default("normal"),
    readAt: timestamp("read_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    dispatchIdContext: integer("dispatch_id_context"),
    correlationId: text("correlation_id"),
  },
  (t) => [
    // Inbox pull: recent messages addressed to a given agent, newest first.
    index("agent_messages_to_role_sent_idx").on(t.toAgentRole, t.sentAt),
    // Unread inbox filter: recipient + read_at IS NULL.
    index("agent_messages_to_role_read_idx").on(t.toAgentRole, t.readAt),
    // Thread fetch by correlation_id.
    index("agent_messages_correlation_idx").on(t.correlationId),
    // Reply chain navigation.
    index("agent_messages_in_reply_to_idx").on(t.inReplyToMessageId),
  ],
);

export type AgentMessageRow = typeof agentMessages.$inferSelect;
export type InsertAgentMessageRow = typeof agentMessages.$inferInsert;

// ============================================
// ENUMS
// ============================================

export const AGENT_MESSAGE_PRIORITIES = ["urgent", "normal", "low"] as const;
export type AgentMessagePriority = (typeof AGENT_MESSAGE_PRIORITIES)[number];

// Limits — subject is short-form (cap so the inbox renders cleanly + indexes
// stay small); body is unbounded text. Documented here for service callers.
export const AGENT_MESSAGE_SUBJECT_MAX_LEN = 200;
export const AGENT_MESSAGE_DEFAULT_INBOX_LIMIT = 10;
export const AGENT_MESSAGE_MAX_INBOX_LIMIT = 50;
