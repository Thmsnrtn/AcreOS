/**
 * Tests for L6.32 founder-collab service.
 *
 * Coverage:
 *  - askFounder happy path (urgency=urgent → pager fires)
 *  - askFounder urgency=low → no pager (just persists)
 *  - askFounder multi_choice without options → throws
 *  - askFounder questionSummary > 200 chars → truncates
 *  - askFounder pager throw → ask still persisted (non-fatal)
 *  - answerFounderAsk happy path each format
 *  - answerFounderAsk yes_no invalid → throws
 *  - answerFounderAsk multi_choice wrong option → throws
 *  - answerFounderAsk on already-answered → throws
 *  - pollForAnswer returns answer when answered
 *  - pollForAnswer returns 'open' when open
 *  - pollForAnswer throws when timed_out
 *  - expireOverdueAsks flips overdue + returns count
 *  - supersedeAsk sets status + reason
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

// ────────────────────────────────────────────────────────────────────────────
// In-memory db mock — replicates the small subset of drizzle calls used by
// founderCollab.ts. Each helper returns a chainable thenable that resolves
// to the appropriate result.
// ────────────────────────────────────────────────────────────────────────────

interface AskRow {
  id: number;
  askedAt: Date;
  askingAgentRole: string;
  askingDispatchId: number | null;
  questionSummary: string;
  questionBody: string;
  options: any;
  answerFormat: string;
  status: string;
  answeredAt: Date | null;
  answerText: string | null;
  answerChosenOptionId: string | null;
  pagerEventId: number | null;
  timeoutAt: Date | null;
  urgency: string;
}

const ASKS: AskRow[] = [];
let nextAskId = 1;

// The predicate decoder tracks what the current query is selecting/updating.
interface PendingPred {
  byId?: number;
  byStatus?: string;
  expireOverdue?: boolean;
}
let pending: PendingPred = {};

function resetPending() {
  pending = {};
}

function buildDbMock() {
  return {
    insert: (_table: unknown) => ({
      values: (row: any) => ({
        returning: async (_proj?: unknown) => {
          const created: AskRow = {
            id: nextAskId++,
            askedAt: row.askedAt ?? new Date(),
            askingAgentRole: row.askingAgentRole,
            askingDispatchId: row.askingDispatchId ?? null,
            questionSummary: row.questionSummary,
            questionBody: row.questionBody,
            options: row.options ?? null,
            answerFormat: row.answerFormat,
            status: row.status ?? "open",
            answeredAt: row.answeredAt ?? null,
            answerText: row.answerText ?? null,
            answerChosenOptionId: row.answerChosenOptionId ?? null,
            pagerEventId: row.pagerEventId ?? null,
            timeoutAt: row.timeoutAt ?? null,
            urgency: row.urgency ?? "normal",
          };
          ASKS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    select: (_proj?: unknown) => ({
      from: (_table: unknown) => {
        const builder: any = {
          where: (pred: any) => {
            decodePredicate(pred);
            return builder;
          },
          orderBy: (_o: unknown) => builder,
          limit: (n: number) => {
            const rows = applyFilter();
            resetPending();
            return Promise.resolve(rows.slice(0, n));
          },
          then: (resolve: any, reject: any) => {
            try {
              const rows = applyFilter();
              resetPending();
              return Promise.resolve(rows).then(resolve, reject);
            } catch (err) {
              return Promise.reject(err).then(resolve, reject);
            }
          },
        };
        return builder;
      },
    }),
    update: (_table: unknown) => ({
      set: (patch: any) => ({
        where: (pred: any) => {
          decodePredicate(pred);
          const apply = () => {
            const rows = applyFilter();
            for (const r of rows) Object.assign(r, patch);
            resetPending();
            return rows;
          };
          return {
            returning: async (_proj?: unknown) => apply().map((r) => ({ id: r.id })),
            then: (resolve: any, reject: any) => {
              try {
                apply();
                return Promise.resolve(undefined).then(resolve, reject);
              } catch (err) {
                return Promise.reject(err).then(resolve, reject);
              }
            },
          };
        },
      }),
    }),
  };
}

function applyFilter(): AskRow[] {
  const now = Date.now();
  return ASKS.filter((r) => {
    if (pending.byId !== undefined && r.id !== pending.byId) return false;
    if (pending.byStatus !== undefined && r.status !== pending.byStatus)
      return false;
    if (pending.expireOverdue) {
      if (r.status !== "open") return false;
      if (!r.timeoutAt) return false;
      if (r.timeoutAt.getTime() > now) return false;
    }
    return true;
  });
}

function decodePredicate(node: any): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) decodePredicate(child);
    return;
  }
  if (typeof node === "object") {
    if (node.op === "eq" && node.col === "id") pending.byId = node.val;
    else if (node.op === "eq" && node.col === "status")
      pending.byStatus = node.val;
    else if (node.op === "lte" && node.col === "timeout_at")
      pending.expireOverdue = true;
    else if (Array.isArray(node.preds)) {
      for (const p of node.preds) decodePredicate(p);
    }
  }
}

vi.mock("../../db", () => ({ db: buildDbMock() }));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  const colName = (col: any): string => {
    if (typeof col === "object" && col !== null && "name" in col)
      return (col as any).name;
    return "unknown";
  };
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ preds }),
    eq: (col: any, val: unknown) => ({ op: "eq", col: colName(col), val }),
    lte: (col: any, val: unknown) => ({ op: "lte", col: colName(col), val }),
    desc: (col: any) => ({ op: "desc", col: colName(col) }),
    sql: (() => {
      const tag: any = (
        _strings: TemplateStringsArray,
        ..._vals: unknown[]
      ) => ({ op: "raw_sql" });
      return tag;
    })(),
  };
});

// ────────────────────────────────────────────────────────────────────────────
// Pager mock — captures calls + can be toggled to throw.
// ────────────────────────────────────────────────────────────────────────────

interface PagerCall {
  severity: string;
  subject: string;
  body: string;
}
const PAGER_CALLS: PagerCall[] = [];
let pagerThrow = false;
let nextPagerEventId = 100;

vi.mock("./pagerService", () => ({
  sendSolenePage: vi.fn(async (input: PagerCall) => {
    PAGER_CALLS.push(input);
    if (pagerThrow) {
      throw new Error("simulated pager outage");
    }
    return {
      eventId: nextPagerEventId++,
      deliveryStatus: "delivered" as const,
      deliveryDetail: "ntfy HTTP 200",
    };
  }),
}));

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  ASKS.length = 0;
  PAGER_CALLS.length = 0;
  nextAskId = 1;
  nextPagerEventId = 100;
  pagerThrow = false;
  resetPending();
});

afterEach(() => {
  vi.clearAllMocks();
});

import {
  askFounder,
  answerFounderAsk,
  expireOverdueAsks,
  getAsk,
  listOpenAsks,
  pollForAnswer,
  supersedeAsk,
} from "./founderCollab";

describe("askFounder", () => {
  it("happy path with urgency=urgent → fires pager + persists", async () => {
    const result = await askFounder({
      askingAgentRole: "iris",
      askingDispatchId: 42,
      questionSummary: "Migrate or skip column?",
      questionBody: "Schema has a deprecated col foo. Migrate now or defer?",
      options: [
        { id: "migrate", label: "Migrate" },
        { id: "defer", label: "Defer to next sprint" },
      ],
      answerFormat: "multi_choice",
      urgency: "urgent",
    });
    expect(result.askId).toBe(1);
    expect(result.pagerFired).toBe(true);
    expect(result.pagerEventId).toBe(100);
    expect(PAGER_CALLS).toHaveLength(1);
    expect(PAGER_CALLS[0].severity).toBe("urgent");
    expect(PAGER_CALLS[0].subject).toBe("Migrate or skip column?");
    expect(ASKS).toHaveLength(1);
    expect(ASKS[0].status).toBe("open");
    expect(ASKS[0].pagerEventId).toBe(100);
    expect(ASKS[0].urgency).toBe("urgent");
  });

  it("urgency=low → no pager, just persists", async () => {
    const result = await askFounder({
      askingAgentRole: "soren",
      questionSummary: "Naming preference for new feature?",
      questionBody: "Should we call it X or Y?",
      answerFormat: "free_text",
      urgency: "low",
    });
    expect(result.pagerFired).toBe(false);
    expect(result.pagerEventId).toBeNull();
    expect(PAGER_CALLS).toHaveLength(0);
    expect(ASKS).toHaveLength(1);
    expect(ASKS[0].status).toBe("open");
  });

  it("multi_choice without options → throws", async () => {
    await expect(
      askFounder({
        askingAgentRole: "iris",
        questionSummary: "X?",
        questionBody: "X?",
        answerFormat: "multi_choice",
      }),
    ).rejects.toThrow(/multi_choice requires options/);
    expect(ASKS).toHaveLength(0);
  });

  it("multi_choice with only 1 option → throws", async () => {
    await expect(
      askFounder({
        askingAgentRole: "iris",
        questionSummary: "X?",
        questionBody: "X?",
        answerFormat: "multi_choice",
        options: [{ id: "a", label: "A" }],
      }),
    ).rejects.toThrow(/at least 2/);
  });

  it("questionSummary > 200 chars → truncates", async () => {
    const longSummary = "x".repeat(500);
    const result = await askFounder({
      askingAgentRole: "iris",
      questionSummary: longSummary,
      questionBody: "Body",
      answerFormat: "free_text",
      urgency: "normal",
    });
    expect(result.askId).toBe(1);
    expect(ASKS[0].questionSummary.length).toBe(200);
    // Pager receives the truncated summary.
    expect(PAGER_CALLS[0].subject.length).toBe(200);
  });

  it("pager throw → does NOT propagate; ask still persisted", async () => {
    pagerThrow = true;
    const result = await askFounder({
      askingAgentRole: "iris",
      questionSummary: "X?",
      questionBody: "Body",
      answerFormat: "free_text",
      urgency: "urgent",
    });
    // Persisted regardless.
    expect(result.askId).toBe(1);
    expect(ASKS).toHaveLength(1);
    expect(ASKS[0].pagerEventId).toBeNull();
    // pagerFired stays false because the call threw before we could record.
    expect(result.pagerFired).toBe(false);
  });

  it("rejects invalid timeoutHours", async () => {
    await expect(
      askFounder({
        askingAgentRole: "iris",
        questionSummary: "X?",
        questionBody: "Body",
        answerFormat: "free_text",
        timeoutHours: 0,
      }),
    ).rejects.toThrow(/timeoutHours/);
  });
});

describe("answerFounderAsk", () => {
  it("free_text happy path", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    await answerFounderAsk({ askId: 1, answerText: "go for it" });
    expect(ASKS[0].status).toBe("answered");
    expect(ASKS[0].answerText).toBe("go for it");
    expect(ASKS[0].answeredAt).toBeInstanceOf(Date);
  });

  it("multi_choice happy path", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Pick",
      questionBody: "Pick",
      answerFormat: "multi_choice",
      options: [
        { id: "a", label: "Option A" },
        { id: "b", label: "Option B" },
      ],
      urgency: "low",
    });
    await answerFounderAsk({ askId: 1, chosenOptionId: "b" });
    expect(ASKS[0].status).toBe("answered");
    expect(ASKS[0].answerChosenOptionId).toBe("b");
    expect(ASKS[0].answerText).toBe("Option B");
  });

  it("yes_no happy path (yes)", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Y/N?",
      questionBody: "Y/N?",
      answerFormat: "yes_no",
      urgency: "low",
    });
    await answerFounderAsk({ askId: 1, answerText: "YES" });
    expect(ASKS[0].status).toBe("answered");
    expect(ASKS[0].answerText).toBe("yes");
  });

  it("numeric happy path", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "How many?",
      questionBody: "How many?",
      answerFormat: "numeric",
      urgency: "low",
    });
    await answerFounderAsk({ askId: 1, answerText: "42.5" });
    expect(ASKS[0].status).toBe("answered");
    expect(ASKS[0].answerText).toBe("42.5");
  });

  it("yes_no with invalid answer → throws", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Y/N?",
      questionBody: "Y/N?",
      answerFormat: "yes_no",
      urgency: "low",
    });
    await expect(
      answerFounderAsk({ askId: 1, answerText: "maybe" }),
    ).rejects.toThrow(/yes_no/);
    expect(ASKS[0].status).toBe("open");
  });

  it("numeric with non-number → throws", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "N?",
      questionBody: "N?",
      answerFormat: "numeric",
      urgency: "low",
    });
    await expect(
      answerFounderAsk({ askId: 1, answerText: "not a number" }),
    ).rejects.toThrow(/numeric/);
  });

  it("multi_choice with wrong option id → throws", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Pick",
      questionBody: "Pick",
      answerFormat: "multi_choice",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      urgency: "low",
    });
    await expect(
      answerFounderAsk({ askId: 1, chosenOptionId: "z" }),
    ).rejects.toThrow(/not in stored options/);
  });

  it("answering an already-answered ask → throws", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    await answerFounderAsk({ askId: 1, answerText: "first" });
    await expect(
      answerFounderAsk({ askId: 1, answerText: "second" }),
    ).rejects.toThrow(/only 'open'/);
  });

  it("answering a non-existent ask → throws", async () => {
    await expect(
      answerFounderAsk({ askId: 999, answerText: "x" }),
    ).rejects.toThrow(/no ask/);
  });
});

describe("pollForAnswer", () => {
  it("returns answer when answered", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    await answerFounderAsk({ askId: 1, answerText: "go" });
    const result = await pollForAnswer(1);
    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.answerText).toBe("go");
      expect(result.chosenOptionId).toBeNull();
    }
  });

  it("returns 'open' when ask is open", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    const result = await pollForAnswer(1);
    expect(result.status).toBe("open");
  });

  it("throws when timed_out", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    // Force the row to timed_out directly in the mock store.
    ASKS[0].status = "timed_out";
    await expect(pollForAnswer(1)).rejects.toThrow(/timed out/);
  });

  it("throws when superseded", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    ASKS[0].status = "superseded";
    await expect(pollForAnswer(1)).rejects.toThrow(/superseded/);
  });
});

describe("expireOverdueAsks", () => {
  it("flips overdue open rows to timed_out + returns count", async () => {
    // Three asks: two overdue open, one fresh open, one already answered.
    const now = Date.now();
    ASKS.push(
      {
        id: nextAskId++,
        askedAt: new Date(now - 26 * 60 * 60 * 1000),
        askingAgentRole: "iris",
        askingDispatchId: null,
        questionSummary: "A",
        questionBody: "A",
        options: null,
        answerFormat: "free_text",
        status: "open",
        answeredAt: null,
        answerText: null,
        answerChosenOptionId: null,
        pagerEventId: null,
        timeoutAt: new Date(now - 60_000),
        urgency: "normal",
      },
      {
        id: nextAskId++,
        askedAt: new Date(now - 25 * 60 * 60 * 1000),
        askingAgentRole: "iris",
        askingDispatchId: null,
        questionSummary: "B",
        questionBody: "B",
        options: null,
        answerFormat: "free_text",
        status: "open",
        answeredAt: null,
        answerText: null,
        answerChosenOptionId: null,
        pagerEventId: null,
        timeoutAt: new Date(now - 1000),
        urgency: "normal",
      },
      {
        id: nextAskId++,
        askedAt: new Date(now),
        askingAgentRole: "iris",
        askingDispatchId: null,
        questionSummary: "C",
        questionBody: "C",
        options: null,
        answerFormat: "free_text",
        status: "open",
        answeredAt: null,
        answerText: null,
        answerChosenOptionId: null,
        pagerEventId: null,
        timeoutAt: new Date(now + 3600_000),
        urgency: "normal",
      },
      {
        id: nextAskId++,
        askedAt: new Date(now - 48 * 60 * 60 * 1000),
        askingAgentRole: "iris",
        askingDispatchId: null,
        questionSummary: "D",
        questionBody: "D",
        options: null,
        answerFormat: "free_text",
        status: "answered",
        answeredAt: new Date(),
        answerText: "x",
        answerChosenOptionId: null,
        pagerEventId: null,
        timeoutAt: new Date(now - 60_000),
        urgency: "normal",
      },
    );

    const { expired } = await expireOverdueAsks();
    expect(expired).toBe(2);
    const expiredA = ASKS.find((r) => r.questionSummary === "A");
    const expiredB = ASKS.find((r) => r.questionSummary === "B");
    const freshC = ASKS.find((r) => r.questionSummary === "C");
    const answeredD = ASKS.find((r) => r.questionSummary === "D");
    expect(expiredA?.status).toBe("timed_out");
    expect(expiredB?.status).toBe("timed_out");
    expect(freshC?.status).toBe("open");
    expect(answeredD?.status).toBe("answered");
  });
});

describe("supersedeAsk", () => {
  it("flips status to superseded + writes reason", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    await supersedeAsk(1, "branch was abandoned");
    expect(ASKS[0].status).toBe("superseded");
    expect(ASKS[0].answerText).toMatch(/\[superseded\] branch was abandoned/);
    expect(ASKS[0].answeredAt).toBeInstanceOf(Date);
  });

  it("rejects empty reason", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    await expect(supersedeAsk(1, "")).rejects.toThrow(/reason/);
  });

  it("throws when ask not open", async () => {
    await askFounder({
      askingAgentRole: "iris",
      questionSummary: "Q",
      questionBody: "Q",
      answerFormat: "free_text",
      urgency: "low",
    });
    await answerFounderAsk({ askId: 1, answerText: "answered" });
    await expect(supersedeAsk(1, "stale")).rejects.toThrow(/only 'open'/);
  });
});

describe("listOpenAsks + getAsk", () => {
  it("listOpenAsks sorts by urgency tier then askedAt", async () => {
    const baseTime = Date.now();
    ASKS.push(
      {
        id: nextAskId++,
        askedAt: new Date(baseTime - 5000),
        askingAgentRole: "iris",
        askingDispatchId: null,
        questionSummary: "low-old",
        questionBody: "x",
        options: null,
        answerFormat: "free_text",
        status: "open",
        answeredAt: null,
        answerText: null,
        answerChosenOptionId: null,
        pagerEventId: null,
        timeoutAt: null,
        urgency: "low",
      },
      {
        id: nextAskId++,
        askedAt: new Date(baseTime - 1000),
        askingAgentRole: "iris",
        askingDispatchId: null,
        questionSummary: "urgent-new",
        questionBody: "x",
        options: null,
        answerFormat: "free_text",
        status: "open",
        answeredAt: null,
        answerText: null,
        answerChosenOptionId: null,
        pagerEventId: null,
        timeoutAt: null,
        urgency: "urgent",
      },
      {
        id: nextAskId++,
        askedAt: new Date(baseTime - 3000),
        askingAgentRole: "iris",
        askingDispatchId: null,
        questionSummary: "normal-mid",
        questionBody: "x",
        options: null,
        answerFormat: "free_text",
        status: "open",
        answeredAt: null,
        answerText: null,
        answerChosenOptionId: null,
        pagerEventId: null,
        timeoutAt: null,
        urgency: "normal",
      },
    );
    const rows = await listOpenAsks();
    expect(rows.map((r) => r.urgency)).toEqual(["urgent", "normal", "low"]);
  });

  it("getAsk returns null for unknown id", async () => {
    const result = await getAsk(999);
    expect(result).toBeNull();
  });
});
