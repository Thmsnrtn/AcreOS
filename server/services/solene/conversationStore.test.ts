/**
 * Tests for Solene conversationStore (Phase 1 / shared-persistence layer).
 *
 * Coverage:
 *  - createConversation: validates surface; auto-titles from initialUserMessage;
 *    persists the initial user message; respects explicit title override.
 *  - appendMessage: validates conversationId + role + non-empty content array;
 *    inserts row + bumps last_message_at (fire-and-forget).
 *  - listConversations: founderUserId + archived + surface filters; limit cap.
 *  - getConversation: returns null on miss; returns rows ordered by sentAt asc.
 *  - archiveConversation + renameConversation.
 *  - autoTitleFromMessage: truncates > 60 chars; collapses whitespace;
 *    falls back to "Untitled" when no text block.
 *  - getConversationCostSummary: sums tokens + costs across messages.
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

interface ConvRow {
  id: number;
  startedAt: Date;
  startedSurface: string;
  title: string | null;
  lastMessageAt: Date;
  archived: boolean;
  founderUserId: string | null;
  metadata: Record<string, unknown>;
}

interface MsgRow {
  id: number;
  conversationId: number;
  sentAt: Date;
  role: string;
  content: unknown[];
  parentMessageId: number | null;
  toolCallId: string | null;
  modelUsed: string | null;
  usageInputTokens: number | null;
  usageOutputTokens: number | null;
  usageCacheReadTokens: number | null;
  estimatedCostUsd: string | null;
  errorMessage: string | null;
}

const CONVS: ConvRow[] = [];
const MSGS: MsgRow[] = [];
let nextConvId = 1;
let nextMsgId = 1;

type Pred = (row: any) => boolean;

interface ClauseEq {
  __kind: "eq";
  column: string;
  value: unknown;
}
interface ClauseAnd {
  __kind: "and";
  parts: Clause[];
}
type Clause = ClauseEq | ClauseAnd;

function colName(col: any): string {
  if (typeof col === "string") return col;
  if (col && typeof col === "object") {
    if (typeof col.__col === "string") return col.__col;
    if (typeof col.name === "string") return col.name;
  }
  return "";
}

function tableOf(col: any): string {
  return col && typeof col === "object" && typeof col.__table === "string"
    ? col.__table
    : "";
}

function clauseToPred(clause: Clause | undefined | null): Pred {
  if (!clause) return () => true;
  switch (clause.__kind) {
    case "eq":
      return (row) => row[clause.column] === clause.value;
    case "and": {
      const preds = clause.parts.map(clauseToPred);
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
      column: colName(col),
      value,
    }),
    and: (...parts: Clause[]): Clause => ({
      __kind: "and",
      parts: parts.filter((p) => !!p),
    }),
    desc: (col: any) => ({
      __order: "desc",
      column: colName(col),
    }),
    asc: (col: any) => ({
      __order: "asc",
      column: colName(col),
    }),
    sql: (() => {
      const fn: any = () => ({ __sql: true });
      return fn;
    })(),
  };
});

vi.mock("@shared/schema/solene-conversations", async () => {
  const real = await vi.importActual<
    typeof import("@shared/schema/solene-conversations")
  >("@shared/schema/solene-conversations");
  const convCols = [
    "id",
    "startedAt",
    "startedSurface",
    "title",
    "lastMessageAt",
    "archived",
    "founderUserId",
    "metadata",
  ];
  const msgCols = [
    "id",
    "conversationId",
    "sentAt",
    "role",
    "content",
    "parentMessageId",
    "toolCallId",
    "modelUsed",
    "usageInputTokens",
    "usageOutputTokens",
    "usageCacheReadTokens",
    "estimatedCostUsd",
    "errorMessage",
  ];
  const convTable: any = { __table: "conversations" };
  for (const c of convCols) {
    convTable[c] = { __col: c, __table: "conversations", name: c };
  }
  const msgTable: any = { __table: "messages" };
  for (const c of msgCols) {
    msgTable[c] = { __col: c, __table: "messages", name: c };
  }
  return {
    ...real,
    soleneConversations: convTable,
    soleneMessages: msgTable,
  };
});

vi.mock("../../db", () => {
  function chainSelect(projection?: any) {
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
      const source =
        table?.__table === "conversations" ? CONVS : MSGS;
      let out: any[] = (source as any[]).filter(pred);
      if (orderField) {
        out = [...out].sort((a, b) => {
          const av = a[orderField!];
          const bv = b[orderField!];
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
      // If projection is set, narrow each row to those keys.
      const projected =
        projection && typeof projection === "object"
          ? out.map((r) => {
              const o: any = {};
              for (const key of Object.keys(projection)) {
                o[key] = r[key];
              }
              return o;
            })
          : out.map((r) => ({ ...r }));
      return Promise.resolve(projected);
    }
    return obj;
  }

  function chainInsert(table: any) {
    let row: any = null;
    const obj: any = {
      values(r: any) {
        row = r;
        return obj;
      },
      returning(_cols: any) {
        if (table?.__table === "conversations") {
          const conv: ConvRow = {
            id: nextConvId++,
            startedAt: new Date(),
            startedSurface: row.startedSurface,
            title: row.title ?? null,
            lastMessageAt: new Date(),
            archived: row.archived ?? false,
            founderUserId: row.founderUserId ?? null,
            metadata: row.metadata ?? {},
          };
          CONVS.push(conv);
          return Promise.resolve([{ id: conv.id }]);
        }
        const msg: MsgRow = {
          id: nextMsgId++,
          conversationId: row.conversationId,
          sentAt: new Date(),
          role: row.role,
          content: row.content,
          parentMessageId: row.parentMessageId ?? null,
          toolCallId: row.toolCallId ?? null,
          modelUsed: row.modelUsed ?? null,
          usageInputTokens: row.usageInputTokens ?? null,
          usageOutputTokens: row.usageOutputTokens ?? null,
          usageCacheReadTokens: row.usageCacheReadTokens ?? null,
          estimatedCostUsd: row.estimatedCostUsd ?? null,
          errorMessage: row.errorMessage ?? null,
        };
        MSGS.push(msg);
        return Promise.resolve([{ id: msg.id }]);
      },
    };
    return obj;
  }

  function chainUpdate(table: any) {
    let patch: any = null;
    const obj: any = {
      set(p: any) {
        patch = p;
        return obj;
      },
      where(clause: any) {
        const pred = clauseToPred(clause);
        const source =
          table?.__table === "conversations" ? CONVS : MSGS;
        for (const row of source as any[]) {
          if (pred(row)) {
            for (const [k, v] of Object.entries(patch)) {
              row[k] = v;
            }
          }
        }
        return Promise.resolve();
      },
    };
    return obj;
  }

  const db = {
    insert: (t: any) => chainInsert(t),
    select: (projection?: any) => chainSelect(projection),
    update: (t: any) => chainUpdate(t),
  };
  return { db };
});

beforeEach(() => {
  CONVS.length = 0;
  MSGS.length = 0;
  nextConvId = 1;
  nextMsgId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// autoTitleFromMessage
// ============================================================================

describe("conversationStore.autoTitleFromMessage", () => {
  it("returns 'Untitled' when no text block", async () => {
    const { autoTitleFromMessage } = await import("./conversationStore");
    expect(
      autoTitleFromMessage([
        { type: "tool_use", id: "x", name: "noop", input: {} },
      ]),
    ).toBe("Untitled");
  });

  it("returns short text verbatim", async () => {
    const { autoTitleFromMessage } = await import("./conversationStore");
    expect(autoTitleFromMessage([{ type: "text", text: "Hello there" }])).toBe(
      "Hello there",
    );
  });

  it("truncates > 60 chars with trailing ellipsis (length === 60)", async () => {
    const { autoTitleFromMessage } = await import("./conversationStore");
    const title = autoTitleFromMessage([
      { type: "text", text: "x".repeat(200) },
    ]);
    expect(title.length).toBe(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("collapses whitespace", async () => {
    const { autoTitleFromMessage } = await import("./conversationStore");
    expect(
      autoTitleFromMessage([
        { type: "text", text: "  hello\n\n   world  " },
      ]),
    ).toBe("hello world");
  });
});

// ============================================================================
// createConversation
// ============================================================================

describe("conversationStore.createConversation", () => {
  it("rejects invalid surface", async () => {
    const { createConversation } = await import("./conversationStore");
    await expect(
      // @ts-expect-error — intentional bad input
      createConversation({ startedSurface: "telegram" }),
    ).rejects.toThrow(/invalid startedSurface/);
  });

  it("creates a conversation + returns id", async () => {
    const { createConversation } = await import("./conversationStore");
    const { conversationId } = await createConversation({
      startedSurface: "cli",
    });
    expect(conversationId).toBe(1);
    expect(CONVS).toHaveLength(1);
    expect(CONVS[0].startedSurface).toBe("cli");
  });

  it("auto-titles from the initial user message", async () => {
    const { createConversation } = await import("./conversationStore");
    await createConversation({
      startedSurface: "acreos",
      initialUserMessage: {
        content: [{ type: "text", text: "Help me debug the migration script" }],
      },
    });
    expect(CONVS[0].title).toBe("Help me debug the migration script");
    expect(MSGS).toHaveLength(1);
    expect(MSGS[0].role).toBe("user");
  });

  it("explicit title beats auto-title", async () => {
    const { createConversation } = await import("./conversationStore");
    await createConversation({
      startedSurface: "cli",
      title: "Hand-set",
      initialUserMessage: { content: [{ type: "text", text: "Other" }] },
    });
    expect(CONVS[0].title).toBe("Hand-set");
  });
});

// ============================================================================
// appendMessage
// ============================================================================

describe("conversationStore.appendMessage", () => {
  it("rejects invalid conversationId", async () => {
    const { appendMessage } = await import("./conversationStore");
    await expect(
      appendMessage({
        conversationId: 0,
        role: "user",
        content: [{ type: "text", text: "hi" }],
      }),
    ).rejects.toThrow(/invalid conversationId/);
  });

  it("rejects invalid role", async () => {
    const { appendMessage } = await import("./conversationStore");
    await expect(
      appendMessage({
        conversationId: 1,
        // @ts-expect-error — intentional bad input
        role: "narrator",
        content: [{ type: "text", text: "hi" }],
      }),
    ).rejects.toThrow(/invalid role/);
  });

  it("rejects empty content array", async () => {
    const { appendMessage } = await import("./conversationStore");
    await expect(
      appendMessage({ conversationId: 1, role: "user", content: [] }),
    ).rejects.toThrow(/non-empty array/);
  });

  it("inserts a row + returns id", async () => {
    const { createConversation, appendMessage } = await import(
      "./conversationStore"
    );
    const { conversationId } = await createConversation({
      startedSurface: "cli",
    });
    const { messageId } = await appendMessage({
      conversationId,
      role: "assistant",
      content: [{ type: "text", text: "ack" }],
      modelUsed: "claude-opus-4-7",
      usageInputTokens: 10,
      usageOutputTokens: 5,
    });
    expect(messageId).toBe(1);
    expect(MSGS).toHaveLength(1);
    expect(MSGS[0].modelUsed).toBe("claude-opus-4-7");
  });
});

// ============================================================================
// listConversations
// ============================================================================

describe("conversationStore.listConversations", () => {
  it("filters by founderUserId + archived + surface", async () => {
    const { createConversation, archiveConversation, listConversations } =
      await import("./conversationStore");

    await createConversation({
      startedSurface: "cli",
      founderUserId: "tom",
    });
    const second = await createConversation({
      startedSurface: "cli",
      founderUserId: "tom",
    });
    await createConversation({
      startedSurface: "acreos",
      founderUserId: "other",
    });
    await archiveConversation(second.conversationId);

    const toms = await listConversations({
      founderUserId: "tom",
      archived: false,
    });
    expect(toms).toHaveLength(1);
    expect(toms[0].founderUserId).toBe("tom");
    expect(toms[0].archived).toBe(false);

    const acreos = await listConversations({ surface: "acreos" });
    expect(acreos).toHaveLength(1);
  });
});

// ============================================================================
// getConversation
// ============================================================================

describe("conversationStore.getConversation", () => {
  it("returns null for a missing id", async () => {
    const { getConversation } = await import("./conversationStore");
    expect(await getConversation(999)).toBeNull();
  });

  it("returns the conversation + its messages, oldest first", async () => {
    const { createConversation, appendMessage, getConversation } = await import(
      "./conversationStore"
    );
    const { conversationId } = await createConversation({
      startedSurface: "cli",
      initialUserMessage: { content: [{ type: "text", text: "first" }] },
    });
    await appendMessage({
      conversationId,
      role: "assistant",
      content: [{ type: "text", text: "second" }],
    });
    const full = await getConversation(conversationId);
    expect(full).not.toBeNull();
    expect(full!.messages).toHaveLength(2);
    expect(full!.messages[0].role).toBe("user");
    expect(full!.messages[1].role).toBe("assistant");
  });
});

// ============================================================================
// archive + rename
// ============================================================================

describe("conversationStore.archive + rename", () => {
  it("archiveConversation sets archived=true", async () => {
    const { createConversation, archiveConversation } = await import(
      "./conversationStore"
    );
    const { conversationId } = await createConversation({
      startedSurface: "cli",
    });
    await archiveConversation(conversationId);
    expect(CONVS[0].archived).toBe(true);
  });

  it("renameConversation rejects empty title", async () => {
    const { renameConversation } = await import("./conversationStore");
    await expect(renameConversation(1, "   ")).rejects.toThrow(
      /title must be non-empty/,
    );
  });

  it("renameConversation updates the title", async () => {
    const { createConversation, renameConversation } = await import(
      "./conversationStore"
    );
    const { conversationId } = await createConversation({
      startedSurface: "cli",
    });
    await renameConversation(conversationId, "New title");
    expect(CONVS[0].title).toBe("New title");
  });
});

// ============================================================================
// getConversationCostSummary
// ============================================================================

describe("conversationStore.getConversationCostSummary", () => {
  it("sums tokens + costs across messages", async () => {
    const { createConversation, appendMessage, getConversationCostSummary } =
      await import("./conversationStore");
    const { conversationId } = await createConversation({
      startedSurface: "cli",
    });
    await appendMessage({
      conversationId,
      role: "assistant",
      content: [{ type: "text", text: "a" }],
      usageInputTokens: 100,
      usageOutputTokens: 50,
      usageCacheReadTokens: 200,
      estimatedCostUsd: 0.01,
    });
    await appendMessage({
      conversationId,
      role: "assistant",
      content: [{ type: "text", text: "b" }],
      usageInputTokens: 30,
      usageOutputTokens: 10,
      estimatedCostUsd: 0.005,
    });
    const summary = await getConversationCostSummary(conversationId);
    expect(summary.inputTokens).toBe(130);
    expect(summary.outputTokens).toBe(60);
    expect(summary.cacheReadTokens).toBe(200);
    expect(summary.totalCostUsd).toBeCloseTo(0.015, 6);
    expect(summary.messageCount).toBe(2);
  });

  it("returns zeros for an empty conversation", async () => {
    const { createConversation, getConversationCostSummary } = await import(
      "./conversationStore"
    );
    const { conversationId } = await createConversation({
      startedSurface: "cli",
    });
    const summary = await getConversationCostSummary(conversationId);
    expect(summary).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalCostUsd: 0,
      messageCount: 0,
    });
  });
});
