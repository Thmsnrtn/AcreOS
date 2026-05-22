/**
 * Tests for Pillar 7 — AI cascade telemetry.
 *
 * We mock the db module + the financial-ledger module so we can assert the
 * exact insert payloads + ledger posts without spinning up Postgres.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock setup ───────────────────────────────────────────────────────────────
// vi.hoisted lets the mock factories reach these refs even though vi.mock is
// itself hoisted above the imports of the SUT.
const mocks = vi.hoisted(() => {
  // Captured aiCallLog rows for assertions
  const inserted: Array<Record<string, unknown>> = [];
  // Captured postOpexSpent calls
  const opexCalls: Array<Record<string, unknown>> = [];

  // Configurable shape returned by db.select(...).from(...).where(...) chains.
  // Tests overwrite this between cases.
  let selectQueueExact: Array<Array<Record<string, unknown>>> = [];

  function nextSelectResult(): Array<Record<string, unknown>> {
    return selectQueueExact.shift() ?? [];
  }

  function buildDbMock() {
    // db.insert(...).values(row) — capture the row.
    const insert = vi.fn((_table: unknown) => ({
      values: vi.fn(async (row: Record<string, unknown>) => {
        inserted.push(row);
        return [{ ...row, id: inserted.length }];
      }),
    }));

    // db.select(...).from(...).where(...).groupBy(...) chain.
    // Returns rows from the per-test queue. groupBy is optional (only model-
    // distribution uses it).
    const select = vi.fn((_shape?: unknown) => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        groupBy: vi.fn(() => chain),
        // thenable so `await db.select(...).from(...).where(...)` resolves
        // to the rows.
        then: (onFulfilled: (rows: unknown) => unknown) =>
          Promise.resolve(nextSelectResult()).then(onFulfilled),
      } as Record<string, unknown>;
      return chain;
    });

    return { insert, select };
  }

  const db = buildDbMock();

  return {
    inserted,
    opexCalls,
    selectQueueExact,
    setSelectQueue: (q: Array<Array<Record<string, unknown>>>) => {
      // Replace the underlying array in-place so mocks keep their reference.
      selectQueueExact.length = 0;
      selectQueueExact.push(...q);
    },
    db,
  };
});

vi.mock("../db", () => ({
  db: mocks.db,
  withTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(mocks.db),
}));

vi.mock("./financial-ledger", () => ({
  postOpexSpent: vi.fn(async (args: Record<string, unknown>) => {
    mocks.opexCalls.push(args);
    return { row: { id: 1 }, inserted: true };
  }),
}));

// Drizzle-orm helpers used by the SUT — minimal stubs so the imports don't blow up.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return actual; // we still need real sql tag / gte etc; the chain above ignores their args
});

// ── SUT imports (after mocks are set up) ─────────────────────────────────────

import {
  recordAiCall,
  getModelDistribution,
  getCacheHitRate,
  getPromptCacheAdoption,
  complexityClassFromTaskType,
  classifyError,
} from "./ai-telemetry";

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.opexCalls.length = 0;
  mocks.setSelectQueue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── recordAiCall ─────────────────────────────────────────────────────────────

describe("recordAiCall", () => {
  it("inserts a row with the expected fields for an upstream call", async () => {
    await recordAiCall({
      organizationId: 42,
      model: "anthropic/claude-haiku-4-5-20251001",
      complexityClass: "classification",
      feature: "lead_qualification",
      promptTokens: 1200,
      cachedInputTokens: 800,
      completionTokens: 150,
      costCents: 0.4321,
      latencyMs: 540,
      cacheHit: false,
      openrouterResponseId: "gen-abc123",
    });

    expect(mocks.inserted).toHaveLength(1);
    const row = mocks.inserted[0];
    expect(row.organizationId).toBe(42);
    expect(row.model).toBe("anthropic/claude-haiku-4-5-20251001");
    expect(row.complexityClass).toBe("classification");
    expect(row.feature).toBe("lead_qualification");
    expect(row.promptTokens).toBe(1200);
    expect(row.cachedInputTokens).toBe(800);
    expect(row.completionTokens).toBe(150);
    // fractional cents preserved as string per drizzle numeric semantics
    expect(row.costCents).toBe("0.4321");
    expect(row.latencyMs).toBe(540);
    expect(row.cacheHit).toBe(false);
    expect(row.errorClass).toBeNull();
  });

  it("posts a financial_ledger opex debit for non-cache upstream calls with response.id", async () => {
    await recordAiCall({
      organizationId: 7,
      model: "anthropic/claude-sonnet-4-6",
      complexityClass: "synthesis",
      feature: "pax_chat",
      promptTokens: 5000,
      completionTokens: 400,
      costCents: 12.34,
      latencyMs: 1100,
      cacheHit: false,
      openrouterResponseId: "gen-xyz789",
    });

    expect(mocks.opexCalls).toHaveLength(1);
    const call = mocks.opexCalls[0];
    expect(call.organizationId).toBe(7);
    expect(call.category).toBe("ai_tokens");
    expect(call.feature).toBe("pax_chat");
    expect(call.providerName).toBe("openrouter");
    expect(call.providerEventId).toBe("gen-xyz789");
    expect(call.externalEventId).toBe("openrouter:gen-xyz789");
    // 12.34 cents rounds up to 13 integer cents
    expect(call.amountCents).toBe(13);
  });

  it("does not post to financial_ledger for cache hits", async () => {
    await recordAiCall({
      organizationId: 1,
      model: "cache",
      complexityClass: "other",
      feature: "pax_chat",
      cacheHit: true,
      latencyMs: 2,
    });
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.opexCalls).toHaveLength(0);
  });

  it("does not post to financial_ledger when openrouterResponseId is missing", async () => {
    await recordAiCall({
      organizationId: 1,
      model: "anthropic/claude-haiku-4-5-20251001",
      complexityClass: "classification",
      feature: "lead_qualification",
      costCents: 0.5,
    });
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.opexCalls).toHaveLength(0);
  });
});

// ── getModelDistribution ─────────────────────────────────────────────────────

describe("getModelDistribution", () => {
  it("returns the correct percentage per model", async () => {
    mocks.setSelectQueue([
      [
        { model: "anthropic/claude-haiku-4-5-20251001", calls: 60 },
        { model: "anthropic/claude-sonnet-4-6", calls: 30 },
        { model: "deepseek/deepseek-chat", calls: 10 },
      ],
    ]);

    const dist = await getModelDistribution(7);
    expect(dist).toHaveLength(3);
    // Sorted by call count desc
    expect(dist[0]).toEqual({
      model: "anthropic/claude-haiku-4-5-20251001",
      calls: 60,
      percent: 60.0,
    });
    expect(dist[1]).toEqual({
      model: "anthropic/claude-sonnet-4-6",
      calls: 30,
      percent: 30.0,
    });
    expect(dist[2]).toEqual({
      model: "deepseek/deepseek-chat",
      calls: 10,
      percent: 10.0,
    });
  });

  it("returns an empty array when no calls exist", async () => {
    mocks.setSelectQueue([[]]);
    const dist = await getModelDistribution(7);
    expect(dist).toEqual([]);
  });
});

// ── getCacheHitRate ──────────────────────────────────────────────────────────

describe("getCacheHitRate", () => {
  it("returns a 0..1 fraction matching hits / total", async () => {
    mocks.setSelectQueue([[{ total: 200, hits: 50 }]]);
    const rate = await getCacheHitRate(7);
    expect(rate).toBeCloseTo(0.25, 5);
  });

  it("returns 0 when no calls exist", async () => {
    mocks.setSelectQueue([[{ total: 0, hits: 0 }]]);
    const rate = await getCacheHitRate(7);
    expect(rate).toBe(0);
  });
});

// ── getPromptCacheAdoption ───────────────────────────────────────────────────

describe("getPromptCacheAdoption", () => {
  it("weights by total prompt tokens, not by call count", async () => {
    // 1 call with 10k prompt tokens of which 9k cached, plus
    // 100 tiny calls (200 prompt tokens each, 0 cached) — by call count
    // adoption is ~1%, by token weight it's 9000 / (10000 + 20000) = 30%.
    // The aggregate row is what the SUT actually sees:
    //   promptSum  = 10000 + 100 * 200 = 30000
    //   cachedSum  = 9000
    mocks.setSelectQueue([[{ promptSum: 30000, cachedSum: 9000 }]]);
    const adoption = await getPromptCacheAdoption(7);
    expect(adoption).toBeCloseTo(0.3, 5);
  });

  it("returns 0 when prompt tokens are zero", async () => {
    mocks.setSelectQueue([[{ promptSum: 0, cachedSum: 0 }]]);
    expect(await getPromptCacheAdoption(7)).toBe(0);
  });

  it("returns 1.0 when every prompt token is a cache read", async () => {
    mocks.setSelectQueue([[{ promptSum: 5000, cachedSum: 5000 }]]);
    expect(await getPromptCacheAdoption(7)).toBe(1);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

describe("complexityClassFromTaskType", () => {
  it("maps task types to canonical complexity buckets", () => {
    expect(complexityClassFromTaskType("lead_qualification")).toBe("classification");
    expect(complexityClassFromTaskType("categorize")).toBe("classification");
    expect(complexityClassFromTaskType("extract_data")).toBe("extraction");
    expect(complexityClassFromTaskType("summarize")).toBe("synthesis");
    expect(complexityClassFromTaskType("script_generation")).toBe("synthesis");
    expect(complexityClassFromTaskType("pax_chat")).toBe("agent_tool");
    expect(complexityClassFromTaskType("director_reasoning")).toBe("agent_tool");
    expect(complexityClassFromTaskType("unrecognized")).toBe("other");
    expect(complexityClassFromTaskType(undefined)).toBe("other");
  });
});

describe("classifyError", () => {
  it("buckets common AI errors into canonical classes", () => {
    expect(classifyError(new Error("429 rate limit exceeded"))).toBe("rate_limit");
    expect(classifyError(new Error("Request timed out"))).toBe("timeout");
    expect(classifyError(new Error("ETIMEDOUT"))).toBe("timeout");
    expect(classifyError(new Error("context length exceeds maximum"))).toBe("ctx_overflow");
    expect(classifyError(new Error("401 Unauthorized"))).toBe("auth");
    expect(classifyError(new Error("invalid api key"))).toBe("auth");
    expect(classifyError(new Error("502 Bad Gateway"))).toBe("server_error");
    expect(classifyError(new Error("Something else"))).toBe("unknown");
  });
});
