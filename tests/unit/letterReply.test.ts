/**
 * Horizon A3 — letter replies as directives.
 *
 * Pins the WITNESSED-ADMISSION invariant end to end:
 *
 *   1. Parse honesty — bad JSON / schema failures are honest noise; a
 *      ruling/directive below the confidence floor (or missing its payload)
 *      downgrades to question; a confident ruling is never invented.
 *   2. handleLetterReply persists ONLY a pending inbox card with the
 *      correct confirm options per kind — it writes NOTHING to precedent
 *      memory and NOTHING to the dispatch queue.
 *   3. confirmLetterReply is the sole path to those stores: fail-closed key
 *      validation, admission-passing precedent shape, idempotent dispatch
 *      enqueue with a clamped priority, idempotent double-confirm, and
 *      discard/send_to_chat storing nothing.
 *
 * Mock pattern follows tests/unit/outcomeLedger.test.ts: reads return whole
 * in-memory stores and the service re-applies its filters in process.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── AI router mock — each test sets AI_CONTENT / AI_THROWS ─────────────────

let AI_CONTENT = "{}";
let AI_THROWS: Error | null = null;
const AI_CALLS: any[] = [];

vi.mock("../../server/services/aiRouter", () => ({
  TaskComplexity: { SIMPLE: "simple", MODERATE: "moderate", COMPLEX: "complex", CRITICAL: "critical" },
  routeAITask: vi.fn(async (task: any) => {
    AI_CALLS.push(task);
    if (AI_THROWS) throw AI_THROWS;
    return { content: AI_CONTENT, provider: "test", model: "test", estimatedCost: 0.001 };
  }),
}));

// ─── Effect-store mocks — the witnessed-admission assertion surface ─────────

const PRECEDENT_CALLS: any[] = [];
vi.mock("../../server/services/solene/founderPrecedent", () => ({
  recordFounderPrecedent: vi.fn(async (input: any) => {
    PRECEDENT_CALLS.push(input);
    return { admitted: true, skippedUnchanged: false, reason: "inserted" };
  }),
}));

const DISPATCH_CALLS: any[] = [];
let DISPATCH_THROWS: Error | null = null;
vi.mock("../../server/services/solene/dispatchQueue", () => ({
  enqueueDispatch: vi.fn(async (opts: any) => {
    if (DISPATCH_THROWS) throw DISPATCH_THROWS;
    DISPATCH_CALLS.push(opts);
    return 777;
  }),
}));

const CAPITAL_CALLS: any[] = [];
vi.mock("../../server/services/solene/capitalTracker", () => ({
  recordCapitalEvent: vi.fn(async (type: string, costUsd: number, contextSummary: string) => {
    CAPITAL_CALLS.push({ type, costUsd, contextSummary });
  }),
}));

// ─── DB mock — in-memory stores; WHERE re-applied in process by the service ─

const ITEMS: any[] = [];
const INSERTED: any[] = [];
const UPDATES: Array<{ set: any }> = [];
let nextId = 500;

vi.mock("../../server/db", () => {
  const db = {
    select: () => ({
      from() {
        return this;
      },
      where() {
        return this;
      },
      limit() {
        return this;
      },
      then(onFulfilled: (rows: any[]) => any, onRejected?: (e: any) => any) {
        return Promise.resolve([...ITEMS]).then(onFulfilled, onRejected);
      },
    }),
    insert: () => ({
      values: (row: Record<string, any>) => ({
        returning: () => {
          const withId = { id: nextId++, ...row };
          INSERTED.push(withId);
          return Promise.resolve([withId]);
        },
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => {
          UPDATES.push({ set: v });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

import {
  clampDirectivePriority,
  confirmLetterReply,
  confirmOptionsForKind,
  handleLetterReply,
  LetterReplyError,
  normalizeDirectiveAgentRole,
  normalizeParse,
  parseLetterReply,
  LETTER_REPLY_ITEM_TYPE,
} from "../../server/services/solene/letterReply";
import { recordFounderPrecedent } from "../../server/services/solene/founderPrecedent";
import { enqueueDispatch } from "../../server/services/solene/dispatchQueue";

const REPLY_INPUT = {
  replyText: "From now on, never discount annual plans below 20% — it trains customers to wait.",
  monthKey: "2026-06",
  pendingDecisionText: "Approve the Q3 pricing experiment?",
};

const CONFIDENT_RULING = {
  kind: "ruling",
  confidence: 0.9,
  restatement: "Never discount annual plans below 20 percent.",
  ruling: {
    situation: "Discounting policy for annual plans",
    decision: "Never discount annual plans below 20%",
    why: "Deeper discounts train customers to wait for sales.",
  },
};

const CONFIDENT_DIRECTIVE = {
  kind: "directive",
  confidence: 0.85,
  restatement: "Investigate why churn spiked in June and report back.",
  directive: {
    agentRole: "iris",
    brief: "Investigate the June churn spike and produce a root-cause summary.",
    suggestedPriority: 4,
  },
};

beforeEach(() => {
  ITEMS.length = 0;
  INSERTED.length = 0;
  UPDATES.length = 0;
  AI_CALLS.length = 0;
  PRECEDENT_CALLS.length = 0;
  DISPATCH_CALLS.length = 0;
  CAPITAL_CALLS.length = 0;
  AI_CONTENT = "{}";
  AI_THROWS = null;
  DISPATCH_THROWS = null;
  nextId = 500;
  vi.clearAllMocks();
});

// ─── 1. Parse honesty ────────────────────────────────────────────────────────

describe("normalizeParse — honesty rules, never a fabricated confident ruling", () => {
  it("schema failure → honest noise", () => {
    expect(normalizeParse({ nonsense: true })).toEqual({
      kind: "noise",
      confidence: 0,
      restatement: "Could not parse — nothing stored.",
    });
  });

  it("a valid confident ruling passes through with its payload", () => {
    const p = normalizeParse(CONFIDENT_RULING);
    expect(p.kind).toBe("ruling");
    expect(p.ruling).toEqual(CONFIDENT_RULING.ruling);
  });

  it("a ruling below the confidence floor downgrades to question, says so, and DROPS the payload", () => {
    const p = normalizeParse({ ...CONFIDENT_RULING, confidence: 0.3 });
    expect(p.kind).toBe("question");
    expect(p.restatement).toContain("low-confidence parse");
    expect(p.ruling).toBeUndefined();
  });

  it("a directive below the confidence floor downgrades to question", () => {
    const p = normalizeParse({ ...CONFIDENT_DIRECTIVE, confidence: 0.49 });
    expect(p.kind).toBe("question");
    expect(p.directive).toBeUndefined();
  });

  it("a ruling/directive missing its payload downgrades to question — never a fabricated payload", () => {
    expect(normalizeParse({ kind: "ruling", confidence: 0.9, restatement: "r" }).kind).toBe("question");
    expect(normalizeParse({ kind: "directive", confidence: 0.9, restatement: "r" }).kind).toBe("question");
  });
});

describe("parseLetterReply — never throws to the route", () => {
  it("non-JSON model output → honest noise", async () => {
    AI_CONTENT = "I think this is probably a ruling about discounts.";
    const p = await parseLetterReply(REPLY_INPUT);
    expect(p).toEqual({
      kind: "noise",
      confidence: 0,
      restatement: "Could not parse — nothing stored.",
    });
  });

  it("a thrown router error → honest noise, no exception", async () => {
    AI_THROWS = new Error("provider down");
    const p = await parseLetterReply(REPLY_INPUT);
    expect(p.kind).toBe("noise");
  });

  it("records a capital event with the letter_reply_parse context", async () => {
    AI_CONTENT = JSON.stringify(CONFIDENT_RULING);
    await parseLetterReply(REPLY_INPUT);
    expect(CAPITAL_CALLS).toEqual([
      { type: "anthropic_api", costUsd: 0.001, contextSummary: "letter_reply_parse (2026-06)" },
    ]);
  });

  it("sends the reply, monthKey, and pending decision as context; asks for JSON", async () => {
    AI_CONTENT = JSON.stringify(CONFIDENT_RULING);
    await parseLetterReply(REPLY_INPUT);
    expect(AI_CALLS[0].responseFormat).toBe("json");
    const user = AI_CALLS[0].messages.find((m: any) => m.role === "user").content;
    expect(user).toContain(REPLY_INPUT.replyText);
    expect(user).toContain("2026-06");
    expect(user).toContain("Approve the Q3 pricing experiment?");
  });
});

// ─── 2. The pending card — confirm options per kind, nothing else stored ────

describe("handleLetterReply — pending card only (witnessed admission)", () => {
  it("WITNESSED ADMISSION: parse + card creation write NOTHING to precedents or dispatch", async () => {
    AI_CONTENT = JSON.stringify(CONFIDENT_RULING);
    await handleLetterReply(REPLY_INPUT);
    AI_CONTENT = JSON.stringify(CONFIDENT_DIRECTIVE);
    await handleLetterReply(REPLY_INPUT);

    expect(INSERTED).toHaveLength(2); // two pending cards…
    expect(recordFounderPrecedent).not.toHaveBeenCalled(); // …and zero precedents
    expect(enqueueDispatch).not.toHaveBeenCalled(); // …and zero dispatches
    expect(UPDATES).toHaveLength(0); // nothing resolved either
  });

  it("creates a pending letter_reply_confirm card with the parse, reply, and options in contextBundle", async () => {
    AI_CONTENT = JSON.stringify(CONFIDENT_RULING);
    const result = await handleLetterReply(REPLY_INPUT);

    const card = INSERTED[0];
    expect(result.itemId).toBe(card.id);
    expect(card).toMatchObject({
      itemType: LETTER_REPLY_ITEM_TYPE,
      status: "pending",
      riskLevel: "low",
      actionPayload: null, // structural: the generic executor has nothing to run
      organizationId: null,
      ownerAgentCodename: "solene",
      recommendedAction: CONFIDENT_RULING.restatement,
      recommendedActionLabel: CONFIDENT_RULING.restatement,
    });
    expect(card.contextBundle.replyText).toBe(REPLY_INPUT.replyText);
    expect(card.contextBundle.monthKey).toBe("2026-06");
    expect(card.contextBundle.parse.kind).toBe("ruling");
    expect(card.contextBundle.options).toEqual(result.options);
    // No prediction columns — the outcome ledger never scores this card.
    expect(card.expectedOutcome).toBeUndefined();
    expect(card.checkInDate).toBeUndefined();
  });

  it("confirm options per kind", () => {
    expect(confirmOptionsForKind("ruling")).toEqual([
      { key: "confirm_ruling", label: "Store as precedent" },
      { key: "discard", label: "Discard" },
    ]);
    expect(confirmOptionsForKind("directive")).toEqual([
      { key: "confirm_directive", label: "Queue for Solene" },
      { key: "discard", label: "Discard" },
    ]);
    expect(confirmOptionsForKind("question")).toEqual([
      { key: "send_to_chat", label: "Ask Solene in chat" },
      { key: "discard", label: "Discard" },
    ]);
    expect(confirmOptionsForKind("noise")).toEqual([{ key: "discard", label: "Discard" }]);
  });
});

// ─── 3. confirmLetterReply — the only path to the effect stores ─────────────

function pendingCard(overrides: Record<string, any> = {}) {
  return {
    id: 42,
    itemType: LETTER_REPLY_ITEM_TYPE,
    status: "pending",
    contextBundle: {
      parse: CONFIDENT_RULING,
      replyText: REPLY_INPUT.replyText,
      monthKey: "2026-06",
      options: confirmOptionsForKind("ruling"),
    },
    ...overrides,
  };
}

function pendingDirectiveCard(overrides: Record<string, any> = {}) {
  return pendingCard({
    contextBundle: {
      parse: CONFIDENT_DIRECTIVE,
      replyText: REPLY_INPUT.replyText,
      monthKey: "2026-06",
      options: confirmOptionsForKind("directive"),
    },
    ...overrides,
  });
}

describe("confirmLetterReply", () => {
  it("confirm_ruling → recordFounderPrecedent with an admission-passing shape, row approved", async () => {
    ITEMS.push(pendingCard());

    const r = await confirmLetterReply(42, "confirm_ruling");

    expect(r).toMatchObject({ outcome: "stored_precedent", itemId: 42, precedentAdmitted: true });
    expect(PRECEDENT_CALLS).toHaveLength(1);
    const call = PRECEDENT_CALLS[0];
    expect(call).toMatchObject({
      itemId: 42,
      itemType: "letter_reply",
      sourceKind: "letter_reply",
      question: "Discounting policy for annual plans",
    });
    expect(call.answer.outcome).toBe("override");
    expect(call.answer.reason).toBe(
      "Never discount annual plans below 20% — Deeper discounts train customers to wait for sales.",
    );
    // Passes founderPrecedent admission control: override + reason ≥ 20 chars.
    expect(call.answer.reason.length).toBeGreaterThanOrEqual(20);

    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].set).toMatchObject({
      status: "approved",
      resolvedBy: "founder",
      founderOverrideAction: "option:confirm_ruling — Store as precedent",
    });
    expect(enqueueDispatch).not.toHaveBeenCalled();
  });

  it("confirm_directive → enqueueDispatch with idempotency key, letter_reply source, clamped priority; row approved", async () => {
    ITEMS.push(pendingDirectiveCard());

    const r = await confirmLetterReply(42, "confirm_directive");

    expect(r).toMatchObject({ outcome: "queued_directive", itemId: 42, dispatchId: 777 });
    expect(DISPATCH_CALLS).toHaveLength(1);
    expect(DISPATCH_CALLS[0]).toMatchObject({
      sourceType: "letter_reply",
      sourceId: "letter-reply:42",
      idempotencyKey: "letter-reply:42",
      agentRole: "iris",
      priority: 4,
      enqueuedBy: "founder_letter_reply",
    });
    expect(DISPATCH_CALLS[0].promptText).toContain(CONFIDENT_DIRECTIVE.directive.brief);
    expect(DISPATCH_CALLS[0].promptText).toContain(REPLY_INPUT.replyText);
    expect(UPDATES[0].set.status).toBe("approved");
    expect(recordFounderPrecedent).not.toHaveBeenCalled();
  });

  it("a failed enqueue leaves the card PENDING (no resolve write) so the founder can retry or discard", async () => {
    ITEMS.push(pendingDirectiveCard());
    DISPATCH_THROWS = new Error("ensemble cap exceeded");

    await expect(confirmLetterReply(42, "confirm_directive")).rejects.toThrow("ensemble cap exceeded");
    expect(UPDATES).toHaveLength(0);
  });

  it("unknown chosenOption fails CLOSED — throws, nothing written, nothing resolved", async () => {
    ITEMS.push(pendingCard());

    await expect(confirmLetterReply(42, "confirm_directive")).rejects.toThrow(LetterReplyError);
    await expect(confirmLetterReply(42, "sounds_great")).rejects.toThrow(LetterReplyError);
    expect(PRECEDENT_CALLS).toHaveLength(0);
    expect(DISPATCH_CALLS).toHaveLength(0);
    expect(UPDATES).toHaveLength(0);
  });

  it("a card offering confirm_ruling without a ruling payload fails CLOSED (malformed_card)", async () => {
    ITEMS.push(
      pendingCard({
        contextBundle: {
          parse: { kind: "ruling", confidence: 0.9, restatement: "r" }, // no ruling payload
          options: confirmOptionsForKind("ruling"),
        },
      }),
    );

    await expect(confirmLetterReply(42, "confirm_ruling")).rejects.toMatchObject({
      code: "malformed_card",
    });
    expect(PRECEDENT_CALLS).toHaveLength(0);
    expect(UPDATES).toHaveLength(0);
  });

  it("double-confirm is idempotent: a resolved card returns already_resolved with NO second write", async () => {
    ITEMS.push(pendingCard({ status: "approved" }));

    const r = await confirmLetterReply(42, "confirm_ruling");

    expect(r).toEqual({ outcome: "already_resolved", itemId: 42 });
    expect(PRECEDENT_CALLS).toHaveLength(0);
    expect(DISPATCH_CALLS).toHaveLength(0);
    expect(UPDATES).toHaveLength(0);
  });

  it("discard resolves the row rejected and stores NOTHING", async () => {
    ITEMS.push(pendingDirectiveCard());

    const r = await confirmLetterReply(42, "discard");

    expect(r).toMatchObject({ outcome: "discarded", itemId: 42 });
    expect(PRECEDENT_CALLS).toHaveLength(0);
    expect(DISPATCH_CALLS).toHaveLength(0);
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].set).toMatchObject({ status: "rejected", resolvedBy: "founder" });
  });

  it("send_to_chat resolves approved with a pointer only — no chat opened, nothing stored", async () => {
    ITEMS.push(
      pendingCard({
        contextBundle: {
          parse: { kind: "question", confidence: 0.4, restatement: "Asking about churn" },
          options: confirmOptionsForKind("question"),
        },
      }),
    );

    const r = await confirmLetterReply(42, "send_to_chat");

    expect(r).toMatchObject({ outcome: "sent_to_chat", itemId: 42 });
    expect(PRECEDENT_CALLS).toHaveLength(0);
    expect(DISPATCH_CALLS).toHaveLength(0);
    expect(UPDATES[0].set).toMatchObject({
      status: "approved",
      founderOverrideAction: "option:send_to_chat — Ask Solene in chat",
    });
  });

  it("missing card → not_found; a non-letter card → not_a_letter_reply (never handled here)", async () => {
    await expect(confirmLetterReply(42, "discard")).rejects.toMatchObject({ code: "not_found" });

    ITEMS.push(pendingCard({ itemType: "outcome_check_in" }));
    await expect(confirmLetterReply(42, "discard")).rejects.toMatchObject({
      code: "not_a_letter_reply",
    });
    expect(UPDATES).toHaveLength(0);
  });
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe("clampDirectivePriority — founder-directive band [3, 5]", () => {
  it("clamps into the band and floors missing/invalid suggestions", () => {
    expect(clampDirectivePriority(4)).toBe(4);
    expect(clampDirectivePriority(9)).toBe(5);
    expect(clampDirectivePriority(1)).toBe(3);
    expect(clampDirectivePriority(undefined)).toBe(3);
    expect(clampDirectivePriority(Number.NaN)).toBe(3);
  });
});

describe("normalizeDirectiveAgentRole", () => {
  it("keeps known roles, normalizes case/whitespace, and lands unknowns on general-purpose", () => {
    expect(normalizeDirectiveAgentRole("iris")).toBe("iris");
    expect(normalizeDirectiveAgentRole("  Soren ")).toBe("soren");
    expect(normalizeDirectiveAgentRole("marketing_guru")).toBe("general-purpose");
    expect(normalizeDirectiveAgentRole(undefined)).toBe("general-purpose");
    // The review lane's instrument is never a directive target.
    expect(normalizeDirectiveAgentRole("code-reviewer")).toBe("general-purpose");
  });
});
