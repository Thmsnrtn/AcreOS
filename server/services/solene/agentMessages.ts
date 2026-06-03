/**
 * SOLENE — inter-agent direct communication (Phase B / L2.5).
 *
 * Cross-functional shortcut: Iris can DM Beatrice for a compliance review
 * without round-tripping the request through Solene-as-router. The dispatch
 * tool surface gains `send_message_to_agent` + `read_agent_inbox` in a
 * follow-up wave (dispatchToolExecutor is frozen this wave — see
 * docs/internal/agent-messages-tool-spec.md). The service + schema land
 * first so the wiring is a small, focused change later.
 *
 * Five public entrypoints:
 *
 *   sendAgentMessage(input)
 *     Validate + insert. Subject is truncated at AGENT_MESSAGE_SUBJECT_MAX_LEN
 *     (200) chars; body has no hard cap. If inReplyToMessageId is provided,
 *     look up the parent and inherit its correlation_id (or fall back to the
 *     parent id stringified) when the caller didn't pass one. Returns the
 *     new message id.
 *
 *     Truncation vs throw: subject ≤ 200 → kept verbatim; subject > 200 →
 *     truncated to 200 with a trailing "…" marker (the recipient still gets
 *     a meaningful preview, but the wire-format invariant holds).
 *
 *   readInbox(agentRole, opts)
 *     Pull recent messages addressed to a specific agent, newest first.
 *     Defaults: unreadOnly=false, limit=10 (capped at 50). Optional priority
 *     filter.
 *
 *   markAsRead(messageId)
 *     Idempotent — sets read_at if null, else no-op.
 *
 *   recordResponseSent(messageId, responseMessageId)
 *     Marks the original message as responded_to (responded_at = now) so
 *     the recipient's "still-needs-reply" filter can exclude it.
 *
 *   getThread(correlationId)
 *     Returns the full conversation in chronological order (oldest first).
 *
 * HONEST CONSTRAINTS:
 *  - Fire-and-forget on the wire — sendAgentMessage never throws when the
 *    DB write itself fails; it logs and returns { messageId: -1 }. Validation
 *    errors (bad role / empty subject / empty body) DO throw, because those
 *    are caller bugs the caller should see immediately.
 *  - The recipient doesn't get a synchronous push notification; the
 *    follow-up wave wires `read_agent_inbox` into the dispatched agent's
 *    system prompt so the inbox is polled at dispatch start.
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  agentMessages,
  AGENT_MESSAGE_DEFAULT_INBOX_LIMIT,
  AGENT_MESSAGE_MAX_INBOX_LIMIT,
  AGENT_MESSAGE_PRIORITIES,
  AGENT_MESSAGE_SUBJECT_MAX_LEN,
  type AgentMessagePriority,
  type AgentMessageRow,
} from "@shared/schema/solene-agent-messages";
import {
  DISPATCH_AGENT_ROLES,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================
// Types
// ============================================

export interface SendAgentMessageInput {
  fromAgentRole: SoleneDispatchAgentRole;
  toAgentRole: SoleneDispatchAgentRole;
  subject: string;
  body: string;
  priority?: AgentMessagePriority;
  inReplyToMessageId?: number;
  dispatchIdContext?: number;
  correlationId?: string;
}

export interface SendAgentMessageResult {
  messageId: number;
}

export interface ReadInboxOpts {
  unreadOnly?: boolean;
  limit?: number;
  priority?: AgentMessagePriority;
}

// ============================================
// Internal helpers
// ============================================

function isKnownAgentRole(role: string): role is SoleneDispatchAgentRole {
  return (DISPATCH_AGENT_ROLES as readonly string[]).includes(role);
}

function isKnownPriority(p: string): p is AgentMessagePriority {
  return (AGENT_MESSAGE_PRIORITIES as readonly string[]).includes(p);
}

function truncateSubject(subject: string): string {
  if (subject.length <= AGENT_MESSAGE_SUBJECT_MAX_LEN) return subject;
  // Reserve 1 char for the truncation marker so the wire length never exceeds
  // AGENT_MESSAGE_SUBJECT_MAX_LEN.
  return subject.slice(0, AGENT_MESSAGE_SUBJECT_MAX_LEN - 1) + "…";
}

// ============================================
// sendAgentMessage
// ============================================

export async function sendAgentMessage(
  input: SendAgentMessageInput,
): Promise<SendAgentMessageResult> {
  // Validation — these throw because the caller is buggy if any of these
  // happen. The wire-write is fire-and-forget, but the contract isn't.
  if (!input.fromAgentRole || !isKnownAgentRole(input.fromAgentRole)) {
    throw new Error(
      `sendAgentMessage: invalid fromAgentRole=${String(input.fromAgentRole)}`,
    );
  }
  if (!input.toAgentRole || !isKnownAgentRole(input.toAgentRole)) {
    throw new Error(
      `sendAgentMessage: invalid toAgentRole=${String(input.toAgentRole)}`,
    );
  }
  if (!input.subject || input.subject.trim().length === 0) {
    throw new Error("sendAgentMessage: subject must be non-empty");
  }
  if (!input.body || input.body.trim().length === 0) {
    throw new Error("sendAgentMessage: body must be non-empty");
  }
  const priority: AgentMessagePriority = input.priority ?? "normal";
  if (!isKnownPriority(priority)) {
    throw new Error(`sendAgentMessage: invalid priority=${String(priority)}`);
  }

  const subject = truncateSubject(input.subject);

  // If this is a reply, look up the parent so we can inherit correlation_id
  // when the caller didn't supply one. We do this BEFORE the insert so the
  // child row's correlation_id is set atomically with its other fields.
  let correlationId: string | null = input.correlationId ?? null;
  if (input.inReplyToMessageId !== undefined && correlationId === null) {
    try {
      const [parent] = await db
        .select({
          id: agentMessages.id,
          correlationId: agentMessages.correlationId,
        })
        .from(agentMessages)
        .where(eq(agentMessages.id, input.inReplyToMessageId))
        .limit(1);
      if (parent) {
        correlationId =
          parent.correlationId ?? `msg-${parent.id}`;
      }
    } catch (err) {
      // Don't let parent-lookup failure block sending the reply — log + fall
      // through with a synthetic correlation_id from the parent id.
      logger.warn(
        `[agentMessages] reply parent lookup failed for id=${input.inReplyToMessageId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      correlationId = `msg-${input.inReplyToMessageId}`;
    }
  }

  try {
    const [inserted] = await db
      .insert(agentMessages)
      .values({
        fromAgentRole: input.fromAgentRole,
        toAgentRole: input.toAgentRole,
        subject,
        body: input.body,
        priority,
        inReplyToMessageId: input.inReplyToMessageId ?? null,
        dispatchIdContext: input.dispatchIdContext ?? null,
        correlationId,
      })
      .returning({ id: agentMessages.id });

    if (!inserted) {
      logger.warn(
        `[agentMessages] insert returned no id from=${input.fromAgentRole} to=${input.toAgentRole}`,
      );
      return { messageId: -1 };
    }

    logger.info(
      `[agentMessages] sent id=${inserted.id} from=${input.fromAgentRole} to=${input.toAgentRole} priority=${priority} subjectLen=${subject.length}`,
    );

    return { messageId: inserted.id };
  } catch (err) {
    // Fire-and-forget: log + return sentinel id rather than blowing up the
    // caller's dispatch turn over a transient DB error.
    logger.warn(
      `[agentMessages] DB write failed from=${input.fromAgentRole} to=${input.toAgentRole}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { messageId: -1 };
  }
}

// ============================================
// readInbox
// ============================================

export async function readInbox(
  agentRole: SoleneDispatchAgentRole,
  opts: ReadInboxOpts = {},
): Promise<AgentMessageRow[]> {
  if (!isKnownAgentRole(agentRole)) {
    throw new Error(`readInbox: invalid agentRole=${String(agentRole)}`);
  }

  const limit = Math.min(
    Math.max(1, Math.floor(opts.limit ?? AGENT_MESSAGE_DEFAULT_INBOX_LIMIT)),
    AGENT_MESSAGE_MAX_INBOX_LIMIT,
  );

  if (opts.priority !== undefined && !isKnownPriority(opts.priority)) {
    throw new Error(`readInbox: invalid priority=${String(opts.priority)}`);
  }

  const conditions = [eq(agentMessages.toAgentRole, agentRole)];
  if (opts.unreadOnly) {
    conditions.push(isNull(agentMessages.readAt));
  }
  if (opts.priority !== undefined) {
    conditions.push(eq(agentMessages.priority, opts.priority));
  }

  const rows = await db
    .select()
    .from(agentMessages)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(desc(agentMessages.sentAt))
    .limit(limit);

  return rows;
}

// ============================================
// markAsRead — idempotent
// ============================================

export async function markAsRead(messageId: number): Promise<void> {
  if (!Number.isFinite(messageId) || messageId <= 0) {
    throw new Error(`markAsRead: invalid messageId=${messageId}`);
  }
  try {
    // Only set read_at if it's null — idempotent on re-mark.
    await db
      .update(agentMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(agentMessages.id, messageId),
          isNull(agentMessages.readAt),
        ),
      );
  } catch (err) {
    logger.warn(
      `[agentMessages] markAsRead failed for id=${messageId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// ============================================
// recordResponseSent
// ============================================

export async function recordResponseSent(
  messageId: number,
  responseMessageId: number,
): Promise<void> {
  if (!Number.isFinite(messageId) || messageId <= 0) {
    throw new Error(`recordResponseSent: invalid messageId=${messageId}`);
  }
  if (!Number.isFinite(responseMessageId) || responseMessageId <= 0) {
    throw new Error(
      `recordResponseSent: invalid responseMessageId=${responseMessageId}`,
    );
  }
  try {
    await db
      .update(agentMessages)
      .set({ respondedAt: new Date() })
      .where(eq(agentMessages.id, messageId));
    logger.info(
      `[agentMessages] response recorded original=${messageId} response=${responseMessageId}`,
    );
  } catch (err) {
    logger.warn(
      `[agentMessages] recordResponseSent failed original=${messageId} response=${responseMessageId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// ============================================
// getThread — full conversation by correlation_id, oldest first
// ============================================

export async function getThread(
  correlationId: string,
): Promise<AgentMessageRow[]> {
  if (!correlationId || correlationId.trim().length === 0) {
    throw new Error("getThread: correlationId must be non-empty");
  }
  const rows = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.correlationId, correlationId))
    .orderBy(asc(agentMessages.sentAt));
  return rows;
}

// Re-export of the underlying row type for caller convenience.
export type { AgentMessageRow };
