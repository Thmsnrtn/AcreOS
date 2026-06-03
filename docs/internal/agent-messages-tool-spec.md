# Agent Messages — dispatchToolExecutor integration spec

**Status:** spec'd; service + schema landed in Phase B / L2.5. Tool wiring
deferred to a follow-up wave because `dispatchToolExecutor.ts` is frozen for
the wave-1 territory and this wave only lands additive surface.

## Why this exists

Today, an Iris dispatch that needs a Beatrice compliance review has to:
  1. produce an output asking Solene "please ask Beatrice to review X"
  2. Solene receives, parses, enqueues a Beatrice dispatch
  3. Beatrice runs, produces output for Solene
  4. Solene routes Beatrice's verdict back into Iris's awareness on the
     next Iris dispatch

That's 3 Solene turns of pure routing-tax for one cross-functional ask.
L2.5 collapses this by giving every dispatched agent two tools:
`send_message_to_agent` and `read_agent_inbox`. Iris DMs Beatrice directly;
Beatrice reads her inbox at the start of her next dispatch and replies. Solene
stays out of the round-trip unless an immutable trips.

## Service surface (live)

The underlying service is `server/services/solene/agentMessages.ts`:

```ts
sendAgentMessage(input: SendAgentMessageInput): Promise<{ messageId: number }>;
readInbox(agentRole, opts): Promise<AgentMessageRow[]>;
markAsRead(messageId): Promise<void>;
recordResponseSent(messageId, responseMessageId): Promise<void>;
getThread(correlationId): Promise<AgentMessageRow[]>;
```

The persistence table is `agent_messages` (mirrored in
`shared/schema/solene-agent-messages.ts` + `scripts/migrate.mjs`).

## Tool 1 — `send_message_to_agent`

```
Tool name: send_message_to_agent
Tool description:
  Send a direct message to another team member (Iris/Soren/Beatrice/Krieger).
  They will read it on their next dispatch. Use for cross-functional requests
  (e.g., Iris asking Beatrice for compliance review on a PR before merge,
  or Soren asking Iris for a perf budget before launching a landing page).

  Prefer this over asking Solene to route your request — direct DMs save
  Solene's turn budget and are visible in the founder UI under the
  agent-messages surface.

Input schema:
  to_agent_role:
    type: enum
    values: [iris, soren, beatrice, krieger, general-purpose]
    required: true
  subject:
    type: string
    max_length: 200
    required: true
    note: longer subjects are auto-truncated with a trailing "…"
  body:
    type: string
    required: true
  priority:
    type: enum
    values: [urgent, normal, low]
    default: normal
  in_reply_to_message_id:
    type: integer
    required: false
    note: if set, correlation_id auto-inherits from the parent message

Output:
  { message_id: integer }   // -1 indicates a transient DB write failure
                            // (the caller's dispatch should continue).
```

Wiring (in the future `dispatchToolExecutor.ts` patch):

```ts
case "send_message_to_agent": {
  const { sendAgentMessage } = await import(
    "../../services/solene/agentMessages"
  );
  const { messageId } = await sendAgentMessage({
    fromAgentRole: dispatchAgentRole,  // from the dispatch row
    toAgentRole: input.to_agent_role,
    subject: input.subject,
    body: input.body,
    priority: input.priority ?? "normal",
    inReplyToMessageId: input.in_reply_to_message_id,
    dispatchIdContext: dispatchId,     // from the dispatch row
  });
  return { message_id: messageId };
}
```

## Tool 2 — `read_agent_inbox`

```
Tool name: read_agent_inbox
Tool description:
  Read your inbox of incoming messages from other team members. Defaults to
  unread only. Call this at the START of your dispatch so you don't miss a
  cross-functional ask. Mark messages read with `mark_message_read` after
  acting on them.

Input schema:
  unread_only:
    type: boolean
    default: true
  limit:
    type: integer
    default: 10
    max: 50
  priority:
    type: enum
    values: [urgent, normal, low]
    required: false

Output:
  {
    messages: [
      {
        id: integer,
        from_agent_role: string,
        subject: string,
        body: string,
        priority: string,
        sent_at: ISO-8601 timestamp,
        in_reply_to_message_id: integer | null,
        correlation_id: string | null,
        read_at: ISO-8601 timestamp | null,
        responded_at: ISO-8601 timestamp | null,
      }
    ]
  }
```

Wiring:

```ts
case "read_agent_inbox": {
  const { readInbox } = await import(
    "../../services/solene/agentMessages"
  );
  const rows = await readInbox(dispatchAgentRole, {
    unreadOnly: input.unread_only ?? true,
    limit: input.limit ?? 10,
    priority: input.priority,
  });
  return {
    messages: rows.map((r) => ({
      id: r.id,
      from_agent_role: r.fromAgentRole,
      subject: r.subject,
      body: r.body,
      priority: r.priority,
      sent_at: r.sentAt.toISOString(),
      in_reply_to_message_id: r.inReplyToMessageId,
      correlation_id: r.correlationId,
      read_at: r.readAt?.toISOString() ?? null,
      responded_at: r.respondedAt?.toISOString() ?? null,
    })),
  };
}
```

## Tool 3 — `mark_message_read` (follow-up)

Same wave will add a thin wrapper so agents explicitly close the loop:

```
Tool name: mark_message_read
Input:  { message_id: integer }
Output: {}
```

Wires to `markAsRead(input.message_id)` directly.

## System-prompt addendum (follow-up)

When wired, each dispatched agent's system prompt gains a short stanza:

> You have an inbox of direct messages from other team members. Call
> `read_agent_inbox` at the start of your dispatch. If a message is a
> cross-functional ask in your domain, reply with `send_message_to_agent`
> using `in_reply_to_message_id` so the thread is tracked. Mark messages
> read with `mark_message_read` once handled.

## Why this wave doesn't wire it

`dispatchToolExecutor.ts` is frozen for wave-1 territory and adding the three
tools means editing both that file and the dispatched-agent system-prompt
builder. Splitting the wiring into a focused follow-up keeps THIS wave's
diff narrow to the schema + service + tests.

When the wiring lands, it must also:
  - Add a per-dispatch cap (e.g. ≤ 10 inbox reads, ≤ 20 messages sent) so
    an agent loop can't spam its peers.
  - Surface inbox/sent-counts in the founder dispatch-detail UI.
  - Record cross-agent DM activity in `solene_decision_score_events`
    rationale so the token-economy scorer credits direct DMs as cheap.
