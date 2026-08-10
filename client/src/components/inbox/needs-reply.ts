/**
 * Needs-reply derivation for the Inbox door (Wave 1.3, handoff P1 §4.4
 * move 1, first slice).
 *
 * The ideal predicate is "latest message inbound AND no outbound after
 * it". What the repo's data can actually support, verified at HEAD:
 *
 *   - SMS: `messages` rows carry direction (inbound/outbound), but the
 *     unified inbox list (/api/inbox/unified) returns only `conversations`
 *     rows — no per-message direction — so the SMS side of the list CANNOT
 *     honestly answer "does this thread need a reply?" without N+1
 *     fetches. `threadNeedsReply` below implements the full predicate for
 *     surfaces that DO hold a thread's messages; the Inbox list view
 *     excludes SMS from its Needs-reply filter and says so on screen.
 *
 *   - Email: `inbox_messages` stores INBOUND mail only. Outbound replies
 *     (POST /api/send-email) are not recorded as thread messages, so "no
 *     outbound after it" is unknowable from any loaded data. The honest
 *     degradation: the LATEST inbound message of each thread, while it
 *     stays unarchived, is treated as awaiting a reply — archiving is the
 *     existing "I'm done with this" verb and clears it. Older messages of
 *     the same thread are superseded by the newer one and never counted
 *     twice.
 *
 * Pure module — unit-tested against thread fixtures in
 * tests/unit/doorInteractions.test.tsx.
 */

// ── The full predicate (message-level, both directions available) ────────

export interface ThreadMessageLike {
  direction: "inbound" | "outbound" | string;
  /** Message timestamp — Date, ISO string, or epoch ms. */
  at: Date | string | number | null | undefined;
}

function toTime(at: ThreadMessageLike["at"]): number {
  if (at == null) return 0;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * "Latest message inbound + no outbound after it." An outbound message
 * sharing the exact latest timestamp counts as a reply (ties resolve to
 * "answered" — never over-claim that someone is waiting). Empty → false.
 */
export function threadNeedsReply(messages: ReadonlyArray<ThreadMessageLike>): boolean {
  if (messages.length === 0) return false;
  let latestInbound = -1;
  let latestOutbound = -1;
  for (const msg of messages) {
    const t = toTime(msg.at);
    if (msg.direction === "inbound") {
      if (t > latestInbound) latestInbound = t;
    } else if (msg.direction === "outbound") {
      if (t > latestOutbound) latestOutbound = t;
    }
  }
  if (latestInbound < 0) return false; // nothing inbound → nothing to answer
  return latestInbound > latestOutbound;
}

// ── Email degradation (inbound-only rows, thread-grouped) ────────────────

export interface InboxEmailLike {
  id: number;
  senderEmail: string;
  subject?: string | null;
  conversationId?: number | null;
  isArchived?: boolean | null;
  receivedAt?: Date | string | null;
}

/**
 * Thread key for an inbound email row: the server-assigned conversation
 * when present, else sender + subject normalized through reply/forward
 * prefixes — "RE: Re: 40 acres" and "40 acres" from the same sender are
 * one thread.
 */
export function emailThreadKey(email: InboxEmailLike): string {
  if (email.conversationId != null) return `conv:${email.conversationId}`;
  const subject = (email.subject ?? "")
    .replace(/^(\s*(re|fwd?|aw)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
  return `addr:${email.senderEmail.trim().toLowerCase()}|${subject}`;
}

/**
 * The email ids the Needs-reply view shows: for each thread, the single
 * LATEST inbound message, provided it isn't archived. (All rows are
 * inbound by construction — see the module header for why outbound can't
 * participate.) A thread whose latest message is archived is considered
 * handled, even if older rows remain unarchived.
 */
export function deriveNeedsReplyEmailIds(
  emails: ReadonlyArray<InboxEmailLike>,
): Set<number> {
  const latestByThread = new Map<string, InboxEmailLike>();
  for (const email of emails) {
    const key = emailThreadKey(email);
    const current = latestByThread.get(key);
    if (!current || toTime(email.receivedAt) > toTime(current.receivedAt)) {
      latestByThread.set(key, email);
    }
  }
  const ids = new Set<number>();
  for (const latest of latestByThread.values()) {
    if (!latest.isArchived) ids.add(latest.id);
  }
  return ids;
}
