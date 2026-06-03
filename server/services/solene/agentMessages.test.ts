/**
 * Tests for Solene inter-agent direct communication (Phase B / L2.5).
 *
 * Coverage:
 *  - Happy path: send + readInbox round-trip
 *  - Validation: subject > 200 chars is truncated (with trailing "…")
 *  - Validation: invalid toAgentRole throws
 *  - Validation: invalid fromAgentRole throws
 *  - Validation: empty subject + empty body throw
 *  - Reply chain: correlationId auto-propagates from inReplyToMessageId
 *  - Reply chain: explicit correlationId on reply is preserved
 *  - readInbox(unreadOnly=true) excludes already-read messages
 *  - readInbox priority filter works
 *  - readInbox enforces max limit
 *  - getThread returns conversation in chronological order
 *  - markAsRead is idempotent
 *  - recordResponseSent sets responded_at
 *
 * The DB is stubbed in-memory; no Postgres required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface MsgRow {
  id: number;
  sentAt: Date;
  fromAgentRole: string;
  toAgentRole: string;
  inReplyToMessageId: number | null;
  subject: string;
  body: string;
  priority: string;
  readAt: Date | null;
  respondedAt: Date | null;
  dispatchIdContext: number | null;
  correlationId: string | null;
}

const MESSAGES: MsgRow[] = [];
let nextId = 1;

// drizzle's eq/and/isNull return opaque clause objects in real code; we hand
// the mock a tagged-predicate form so we can re-execute it against rows.
type Pred = (row: MsgRow) => boolean;

interface ClauseEq {
  __kind: "eq";
  column: string;
  value: unknown;
}
interface ClauseIsNull {
  __kind: "isNull";
  column: string;
}
interface ClauseAnd {
  __kind: "and";
  parts: Clause[];
}
type Clause = ClauseEq | ClauseIsNull | ClauseAnd;

function columnNameFromRef(col: any): string {
  // The schema uses pgTable; drizzle exposes `.name` on each column proxy.
  // The mock falls back to the column key from our schema names.
  if (typeof col === "string") return col;
  if (col && typeof col === "object") {
    if (typeof col.name === "string") return col.name;
    // drizzle column proxy — has Symbol/_ structure; pull a known field.
    if (col.__col) return col.__col;
  }
  return "";
}

function clauseToPred(clause: Clause | undefined | null): Pred {
  if (!clause) return () => true;
  switch (clause.__kind) {
    case "eq":
      return (row) =>
        (row as unknown as Record<string, unknown>)[clause.column] ===
        clause.value;
    case "isNull":
      return (row) =>
        (row as unknown as Record<string, unknown>)[clause.column] === null;
    case "and": {
      const preds = clause.parts.map((p) => clauseToPred(p));
      return (row) => preds.every((p) => p(row));
    }
    default:
      return () => true;
  }
}

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: any, value: unknown): Clause => ({
      __kind: "eq",
      column: columnNameFromRef(col),
      value,
    }),
    isNull: (col: any): Clause => ({
      __kind: "isNull",
      column: columnNameFromRef(col),
    }),
    and: (...parts: Clause[]): Clause => ({
      __kind: "and",
      parts: parts.filter((p) => !!p),
    }),
    // We don't introspect order/asc clauses in the mock; the service applies
    // them after the mock returns the rows. The mock honors orderBy via the
    // chain builder below.
    desc: (col: any) => ({ __order: "desc", column: columnNameFromRef(col) }),
    asc: (col: any) => ({ __order: "asc", column: columnNameFromRef(col) }),
  };
});

vi.mock("@shared/schema/solene-agent-messages", async () => {
  // We need the real enums + constants, but the table proxy needs to expose
  // .name fields the mock can read. Use the real module and decorate.
  const real = await vi.importActual<
    typeof import("@shared/schema/solene-agent-messages")
  >("@shared/schema/solene-agent-messages");
  // Tag each column with a `.name` matching the camelCase row key for the
  // mock's columnNameFromRef. The real module's column proxies already have
  // `.name` set to the snake_case DB name (e.g. "to_agent_role"); we wrap
  // those into accessors keyed by the camelCase JS property the service uses
  // in row objects.
  const colNames: Record<string, string> = {
    id: "id",
    sentAt: "sentAt",
    fromAgentRole: "fromAgentRole",
    toAgentRole: "toAgentRole",
    inReplyToMessageId: "inReplyToMessageId",
    subject: "subject",
    body: "body",
    priority: "priority",
    readAt: "readAt",
    respondedAt: "respondedAt",
    dispatchIdContext: "dispatchIdContext",
    correlationId: "correlationId",
  };
  const decoratedTable: Record<string, unknown> = {};
  for (const [jsKey] of Object.entries(colNames)) {
    decoratedTable[jsKey] = { __col: jsKey, name: jsKey };
  }
  // Preserve schema metadata (drizzle uses Symbol-keyed fields) so other
  // imports still work; we only override the column proxies.
  return {
    ...real,
    agentMessages: decoratedTable,
  };
});

vi.mock("../../db", () => {
  // Tiny query-builder mock supporting:
  //   db.insert(table).values(row).returning({ id }) → [{ id }]
  //   db.select(...).from(table).where(clause).limit(n) → rows
  //   db.select().from(table).where(clause).orderBy(...).limit(n) → rows
  //   db.update(table).set(patch).where(clause) → undefined
  //
  // orderBy is honored — the mock sorts by sentAt asc/desc based on the
  // single column the service ever orders by in this surface.

  function chainSelect() {
    let table: any = null;
    let pred: Pred = () => true;
    let limitN: number | null = null;
    let orderField: string | null = null;
    let orderDir: "asc" | "desc" = "asc";
    const obj: any = {
      from(t: any) {
        table = t;
        return obj;
      },
      where(clause: any) {
        pred = clauseToPred(clause);
        return obj;
      },
      orderBy(spec: any) {
        if (spec && typeof spec === "object" && "__order" in spec) {
          orderDir = spec.__order === "desc" ? "desc" : "asc";
          orderField = spec.column;
        }
        return obj;
      },
      limit(n: number) {
        limitN = n;
        return run();
      },
      then(resolve: any, reject: any) {
        return run().then(resolve, reject);
      },
    };
    function run() {
      let out = MESSAGES.filter(pred);
      if (orderField) {
        out = [...out].sort((a, b) => {
          const av = (a as any)[orderField!];
          const bv = (b as any)[orderField!];
          if (av instanceof Date && bv instanceof Date) {
            return orderDir === "desc"
              ? bv.getTime() - av.getTime()
              : av.getTime() - bv.getTime();
          }
          if (typeof av === "number" && typeof bv === "number") {
            return orderDir === "desc" ? bv - av : av - bv;
          }
          return 0;
        });
      }
      if (limitN !== null) out = out.slice(0, limitN);
      // Return as a real array — drizzle returns a Promise-like, but the
      // service awaits the chained terminal, so a plain promise works.
      return Promise.resolve(out.map((r) => ({ ...r })));
    }
    return obj;
  }

  function chainInsert() {
    let row: any = null;
    const obj: any = {
      values(r: any) {
        row = r;
        return obj;
      },
      returning(_cols: any) {
        const inserted: MsgRow = {
          id: nextId++,
          sentAt: new Date(),
          fromAgentRole: row.fromAgentRole,
          toAgentRole: row.toAgentRole,
          inReplyToMessageId: row.inReplyToMessageId ?? null,
          subject: row.subject,
          body: row.body,
          priority: row.priority ?? "normal",
          readAt: null,
          respondedAt: null,
          dispatchIdContext: row.dispatchIdContext ?? null,
          correlationId: row.correlationId ?? null,
        };
        MESSAGES.push(inserted);
        return Promise.resolve([{ id: inserted.id }]);
      },
    };
    return obj;
  }

  function chainUpdate() {
    let patch: any = null;
    let pred: Pred = () => false;
    const obj: any = {
      set(p: any) {
        patch = p;
        return obj;
      },
      where(clause: any) {
        pred = clauseToPred(clause);
        // Terminal — apply now.
        for (const row of MESSAGES) {
          if (pred(row)) {
            if (patch.readAt !== undefined) row.readAt = patch.readAt;
            if (patch.respondedAt !== undefined)
              row.respondedAt = patch.respondedAt;
          }
        }
        return Promise.resolve();
      },
    };
    return obj;
  }

  const db = {
    insert: (_t: any) => chainInsert(),
    select: (_cols?: any) => chainSelect(),
    update: (_t: any) => chainUpdate(),
  };
  return { db };
});

beforeEach(() => {
  MESSAGES.length = 0;
  nextId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// sendAgentMessage + readInbox
// ============================================================================

describe("agentMessages.sendAgentMessage — validation", () => {
  it("rejects invalid toAgentRole", async () => {
    const { sendAgentMessage } = await import("./agentMessages");
    await expect(
      sendAgentMessage({
        fromAgentRole: "iris",
        // @ts-expect-error — intentionally invalid for the test
        toAgentRole: "not-a-real-agent",
        subject: "hi",
        body: "hello",
      }),
    ).rejects.toThrow(/invalid toAgentRole/);
  });

  it("rejects invalid fromAgentRole", async () => {
    const { sendAgentMessage } = await import("./agentMessages");
    await expect(
      sendAgentMessage({
        // @ts-expect-error — intentionally invalid for the test
        fromAgentRole: "nobody",
        toAgentRole: "beatrice",
        subject: "hi",
        body: "hello",
      }),
    ).rejects.toThrow(/invalid fromAgentRole/);
  });

  it("rejects empty subject", async () => {
    const { sendAgentMessage } = await import("./agentMessages");
    await expect(
      sendAgentMessage({
        fromAgentRole: "iris",
        toAgentRole: "beatrice",
        subject: "   ",
        body: "hello",
      }),
    ).rejects.toThrow(/subject must be non-empty/);
  });

  it("rejects empty body", async () => {
    const { sendAgentMessage } = await import("./agentMessages");
    await expect(
      sendAgentMessage({
        fromAgentRole: "iris",
        toAgentRole: "beatrice",
        subject: "hi",
        body: "",
      }),
    ).rejects.toThrow(/body must be non-empty/);
  });

  it("truncates subject > 200 chars (does not throw)", async () => {
    const { sendAgentMessage, readInbox } = await import("./agentMessages");
    const longSubject = "a".repeat(500);
    const { messageId } = await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: longSubject,
      body: "please review",
    });
    expect(messageId).toBeGreaterThan(0);

    const inbox = await readInbox("beatrice");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].subject.length).toBe(200);
    expect(inbox[0].subject.endsWith("…")).toBe(true);
  });
});

describe("agentMessages.sendAgentMessage — happy path", () => {
  it("sends a message Beatrice can read", async () => {
    const { sendAgentMessage, readInbox } = await import("./agentMessages");
    const { messageId } = await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "Compliance review needed on auth flow",
      body: "Quick check on PR #1234 — does the consent logging meet 1098 spec?",
      priority: "normal",
    });
    expect(messageId).toBe(1);

    const inbox = await readInbox("beatrice");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].fromAgentRole).toBe("iris");
    expect(inbox[0].toAgentRole).toBe("beatrice");
    expect(inbox[0].subject).toMatch(/Compliance review/);
    expect(inbox[0].priority).toBe("normal");
  });

  it("defaults priority to 'normal' when not specified", async () => {
    const { sendAgentMessage, readInbox } = await import("./agentMessages");
    await sendAgentMessage({
      fromAgentRole: "soren",
      toAgentRole: "krieger",
      subject: "Brand voice question",
      body: "Quick check on copy",
    });
    const inbox = await readInbox("krieger");
    expect(inbox[0].priority).toBe("normal");
  });
});

// ============================================================================
// Reply / correlation
// ============================================================================

describe("agentMessages — reply correlation", () => {
  it("auto-propagates correlationId from inReplyToMessageId when parent has one", async () => {
    const { sendAgentMessage, getThread } = await import("./agentMessages");
    const first = await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "Review #1",
      body: "first",
      correlationId: "thread-abc",
    });
    const second = await sendAgentMessage({
      fromAgentRole: "beatrice",
      toAgentRole: "iris",
      subject: "Re: Review #1",
      body: "reply",
      inReplyToMessageId: first.messageId,
    });
    expect(second.messageId).toBe(2);

    const thread = await getThread("thread-abc");
    expect(thread).toHaveLength(2);
    expect(thread[0].body).toBe("first");
    expect(thread[1].body).toBe("reply");
  });

  it("falls back to msg-<parentId> correlation when parent has no correlationId", async () => {
    const { sendAgentMessage, getThread } = await import("./agentMessages");
    const first = await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "Question",
      body: "no correlation set",
    });
    await sendAgentMessage({
      fromAgentRole: "beatrice",
      toAgentRole: "iris",
      subject: "Answer",
      body: "reply",
      inReplyToMessageId: first.messageId,
    });
    const thread = await getThread(`msg-${first.messageId}`);
    expect(thread).toHaveLength(1); // only the reply carries the synthetic id
    expect(thread[0].body).toBe("reply");
  });

  it("preserves explicit correlationId on reply (caller override wins)", async () => {
    const { sendAgentMessage, getThread } = await import("./agentMessages");
    const first = await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "P1",
      body: "parent",
      correlationId: "thread-parent",
    });
    await sendAgentMessage({
      fromAgentRole: "beatrice",
      toAgentRole: "iris",
      subject: "Re: P1",
      body: "reply",
      inReplyToMessageId: first.messageId,
      correlationId: "thread-override",
    });
    const inParent = await getThread("thread-parent");
    const inOverride = await getThread("thread-override");
    expect(inParent).toHaveLength(1);
    expect(inOverride).toHaveLength(1);
    expect(inOverride[0].body).toBe("reply");
  });
});

// ============================================================================
// Inbox filters
// ============================================================================

describe("agentMessages.readInbox — filters", () => {
  it("unreadOnly=true excludes already-read messages", async () => {
    const { sendAgentMessage, readInbox, markAsRead } = await import(
      "./agentMessages"
    );
    const a = await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "A",
      body: "a",
    });
    await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "B",
      body: "b",
    });
    await markAsRead(a.messageId);

    const unread = await readInbox("beatrice", { unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0].subject).toBe("B");

    const all = await readInbox("beatrice");
    expect(all).toHaveLength(2);
  });

  it("priority filter returns only matching messages", async () => {
    const { sendAgentMessage, readInbox } = await import("./agentMessages");
    await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "low",
      body: "x",
      priority: "low",
    });
    await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "urgent",
      body: "x",
      priority: "urgent",
    });
    await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "normal",
      body: "x",
    });

    const urgent = await readInbox("beatrice", { priority: "urgent" });
    expect(urgent).toHaveLength(1);
    expect(urgent[0].subject).toBe("urgent");
  });

  it("caps limit at AGENT_MESSAGE_MAX_INBOX_LIMIT", async () => {
    const { sendAgentMessage, readInbox } = await import("./agentMessages");
    for (let i = 0; i < 60; i++) {
      await sendAgentMessage({
        fromAgentRole: "iris",
        toAgentRole: "beatrice",
        subject: `m${i}`,
        body: "x",
      });
    }
    const huge = await readInbox("beatrice", { limit: 1000 });
    expect(huge.length).toBeLessThanOrEqual(50);
  });

  it("rejects invalid agentRole", async () => {
    const { readInbox } = await import("./agentMessages");
    await expect(
      // @ts-expect-error — intentionally invalid
      readInbox("nobody"),
    ).rejects.toThrow(/invalid agentRole/);
  });
});

// ============================================================================
// getThread
// ============================================================================

describe("agentMessages.getThread", () => {
  it("returns messages in chronological order (oldest first)", async () => {
    const { sendAgentMessage, getThread } = await import("./agentMessages");
    await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "1",
      body: "first",
      correlationId: "t1",
    });
    // ensure distinct sentAt
    await new Promise((r) => setTimeout(r, 2));
    await sendAgentMessage({
      fromAgentRole: "beatrice",
      toAgentRole: "iris",
      subject: "2",
      body: "second",
      correlationId: "t1",
    });
    await new Promise((r) => setTimeout(r, 2));
    await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "3",
      body: "third",
      correlationId: "t1",
    });

    const thread = await getThread("t1");
    expect(thread.map((m) => m.body)).toEqual(["first", "second", "third"]);
  });

  it("rejects empty correlationId", async () => {
    const { getThread } = await import("./agentMessages");
    await expect(getThread("")).rejects.toThrow(/non-empty/);
    await expect(getThread("   ")).rejects.toThrow(/non-empty/);
  });
});

// ============================================================================
// markAsRead — idempotent
// ============================================================================

describe("agentMessages.markAsRead", () => {
  it("is idempotent — second call does not change read_at", async () => {
    const { sendAgentMessage, readInbox, markAsRead } = await import(
      "./agentMessages"
    );
    const { messageId } = await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "S",
      body: "B",
    });
    await markAsRead(messageId);
    const inbox1 = await readInbox("beatrice");
    const firstReadAt = inbox1[0].readAt;
    expect(firstReadAt).toBeInstanceOf(Date);

    await new Promise((r) => setTimeout(r, 5));
    await markAsRead(messageId);
    const inbox2 = await readInbox("beatrice");
    expect(inbox2[0].readAt!.getTime()).toBe(firstReadAt!.getTime());
  });

  it("rejects invalid messageId", async () => {
    const { markAsRead } = await import("./agentMessages");
    await expect(markAsRead(0)).rejects.toThrow(/invalid messageId/);
    await expect(markAsRead(-1)).rejects.toThrow(/invalid messageId/);
    await expect(markAsRead(NaN)).rejects.toThrow(/invalid messageId/);
  });
});

// ============================================================================
// recordResponseSent
// ============================================================================

describe("agentMessages.recordResponseSent", () => {
  it("sets responded_at on the original message", async () => {
    const { sendAgentMessage, readInbox, recordResponseSent } = await import(
      "./agentMessages"
    );
    const orig = await sendAgentMessage({
      fromAgentRole: "iris",
      toAgentRole: "beatrice",
      subject: "Ping",
      body: "x",
    });
    const reply = await sendAgentMessage({
      fromAgentRole: "beatrice",
      toAgentRole: "iris",
      subject: "Pong",
      body: "y",
      inReplyToMessageId: orig.messageId,
    });
    await recordResponseSent(orig.messageId, reply.messageId);

    const inboxB = await readInbox("beatrice");
    const original = inboxB.find((m) => m.id === orig.messageId);
    expect(original?.respondedAt).toBeInstanceOf(Date);
  });

  it("validates both ids are positive", async () => {
    const { recordResponseSent } = await import("./agentMessages");
    await expect(recordResponseSent(0, 1)).rejects.toThrow(/invalid messageId/);
    await expect(recordResponseSent(1, 0)).rejects.toThrow(
      /invalid responseMessageId/,
    );
  });
});
