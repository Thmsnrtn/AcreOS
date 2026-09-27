import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// DEFECT-0111 — the semantic cache layer matched on org + word overlap only.
// Harness copied from aiRouterCacheOrgScope.test.ts (T0-4).
//
// T0-4 (2026-06-10) — AI response cache must be partitioned by org.
//
// Before this fix the dual-layer cache in aiRouter had NO org dimension:
//   - the exact-match SHA-256 key hashed only the messages payload, and
//   - findSemanticCacheHit scanned ALL entries at Jaccard ≥ 0.72,
// so one org's cached answer (which can embed org-specific lead/deal data)
// could be replayed verbatim to a different org.
//
// These tests prove the partition holds:
//   (a) two orgs with identical prompts get SEPARATE cache entries
//       (second org = cache miss → its own model call);
//   (b) the semantic layer fires within the same org but NEVER across orgs,
//       even for near-identical paraphrases;
//   (c) platform-level (no-org) requests never hit org entries, and org
//       requests never hit platform entries — but the platform bucket still
//       caches for itself.
// ============================================================================

// Mock the OpenAI client constructor so routeAITask uses our fake completion.
const createMock = vi.fn();
vi.mock("openai", () => {
  return {
    default: class FakeOpenAI {
      chat = { completions: { create: createMock } };
      constructor() {}
    },
  };
});

// Module re-imports after vi.resetModules() can be slow under vite-ssr; give
// each test generous headroom so a slow transform never bleeds a hung
// routeAITask continuation into the next test's call counts.
vi.setConfig({ testTimeout: 60_000 });

describe("routeAITask semantic cache — same task, same shape (DEFECT-0111)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    createMock.mockReset();
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    // Disable the quality cascade so every routeAITask call maps to exactly
    // one model call — makes hit/miss accounting unambiguous.
    process.env.AI_CASCADE_ENABLED = "false";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  async function loadRouter() {
    vi.resetModules();
    // Stub the gate modules routeAITask dynamically imports so no DB is touched.
    vi.doMock("../../server/services/aiCostCeiling", () => ({
      assertWithinAiCostCeiling: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../server/services/intelligence/budget", () => ({
      categoryFor: () => "test",
      checkBudget: vi
        .fn()
        .mockResolvedValue({ withinBudget: true, capCents: 1000, spentCents: 0 }),
      BudgetExceededError: class extends Error {},
    }));
    // Stub the cascade-telemetry sink (statically imported by aiRouter) so the
    // fire-and-forget recordCascadeCall never touches the DB or rejects.
    vi.doMock("../../server/services/ai-telemetry", () => ({
      recordAiCall: vi.fn().mockResolvedValue(undefined),
      complexityClassFromTaskType: () => "simple",
      classifyError: () => "unknown",
    }));
    // No routing overrides / db model configs. Stub @shared/schema too — the
    // real schema module is enormous and re-transforming it after every
    // resetModules dominates test time.
    vi.doMock("@shared/schema", () => ({
      aiRoutingOverrides: { active: "active", taskType: "taskType" },
      aiModelConfigs: { enabled: "enabled", weight: "weight" },
      aiTelemetryEvents: {},
    }));
    vi.doMock("../../server/db", () => ({
      db: {
        select: () => ({ from: () => ({ where: () => [] }) }),
        insert: () => ({ values: async () => undefined }),
      },
    }));
    const mod = await import("../../server/services/aiRouter");
    mod.clearAICache();
    return mod;
  }

  function mockModelResponse(answer: string) {
    createMock.mockResolvedValue({
      id: "resp_cache_test",
      choices: [{ message: { content: answer } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  }

  // Cacheable: SIMPLE complexity + temperature ≤ 0.3.
  function task(content: string) {
    return {
      taskType: "simple_qa",
      complexity: "simple" as any,
      messages: [{ role: "user" as const, content }],
      temperature: 0.2,
    };
  }

  function taskOf(taskType: string, content: string, responseFormat?: "text" | "json") {
    return {
      taskType,
      complexity: "simple" as any,
      messages: [{ role: "user" as const, content }],
      temperature: 0.2,
      ...(responseFormat ? { responseFormat } : {}),
    };
  }

  // Token sets overlap 8/10 → Jaccard 0.8, above the 0.72 threshold.
  const A = "alpha bravo charlie delta echo foxtrot golf hotel india";
  const B = "alpha bravo charlie delta echo foxtrot golf hotel juliet";

  it("a near-identical prompt of the SAME task type is a semantic hit (vacuity: the layer still works)", async () => {
    const router = await loadRouter();
    mockModelResponse("answer one");
    await router.routeAITask(taskOf("classify_lead", A), { orgId: 1, skipQuota: true, skipBudget: true });
    await router.routeAITask(taskOf("classify_lead", B), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(router.getAICacheStats().semanticHits).toBe(1);
  });

  it("the same words under a DIFFERENT task type are not served the other task's answer", async () => {
    const router = await loadRouter();
    mockModelResponse("answer one");
    await router.routeAITask(taskOf("classify_lead", A), { orgId: 1, skipQuota: true, skipBudget: true });
    await router.routeAITask(taskOf("draft_outreach_message", B), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(router.getAICacheStats().semanticHits).toBe(0);
  });

  it("the same task with a DIFFERENT response format is not served a differently-shaped answer", async () => {
    const router = await loadRouter();
    mockModelResponse('{"ok":true}');
    await router.routeAITask(taskOf("classify_lead", A, "json"), { orgId: 1, skipQuota: true, skipBudget: true });
    await router.routeAITask(taskOf("classify_lead", B), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("a failed or scoreless quality grade is 'not checked', never a fabricated 8", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../../server/services/aiRouter.ts"), "utf8");
    const at = src.indexOf("async function checkResponseQuality(");
    const body = src.slice(at, src.indexOf("export enum TaskComplexity", at));
    expect(body.length, "vacuity: grader body not found").toBeGreaterThan(300);
    expect(body).not.toMatch(/score:\s*8/);
    expect(body).not.toMatch(/\|\|\s*8\b/);
    expect(body).toMatch(/score:\s*null/);
  });
});
