import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
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

describe("routeAITask cache — org partition (T0-4 cross-tenant fix)", () => {
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

  it("(a) identical prompts from two orgs get separate cache entries — second org is a MISS", async () => {
    const router = await loadRouter();
    mockModelResponse("Org-specific answer with lead data for whoever asked");

    const prompt = "Summarize my top three active leads in Travis County";

    // Org 1, first call → model call #1, entry cached under org 1.
    await router.routeAITask(task(prompt), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(1);

    // Org 1, identical prompt → exact-match HIT, no new model call.
    await router.routeAITask(task(prompt), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(1);

    // Org 2, identical prompt → MUST be a miss (its own model call), never
    // org 1's cached answer.
    await router.routeAITask(task(prompt), { orgId: 2, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(2);

    const stats = router.getAICacheStats();
    expect(stats.size).toBe(2); // one entry per org — separate slots
    expect(stats.hits).toBe(1); // only the same-org repeat hit
    expect(stats.misses).toBe(2); // org 1 first call + org 2 first call
  });

  it("(b) semantic hit fires within the same org but NOT across orgs at high similarity", async () => {
    const router = await loadRouter();
    mockModelResponse("Average parcel pricing answer derived from org 1 data");

    // Token sets overlap 8/10 → Jaccard 0.8, above the 0.72 threshold.
    const original = "average price per acre Travis County Texas land parcels";
    const paraphrase = "average price per acre Travis County Texas land lots";

    // Org 1 seeds the cache → model call #1.
    await router.routeAITask(task(original), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(1);

    // Org 1 paraphrase → exact key differs, but SEMANTIC hit within the org.
    await router.routeAITask(task(paraphrase), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(router.getAICacheStats().semanticHits).toBe(1);

    // Org 2 sends the SAME paraphrase → must NOT match org 1's entry, even
    // though similarity is well above threshold. Fresh model call.
    await router.routeAITask(task(paraphrase), { orgId: 2, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(router.getAICacheStats().semanticHits).toBe(1); // unchanged
  });

  it("(c) platform-level (no-org) requests never hit org entries, and vice versa", async () => {
    const router = await loadRouter();
    mockModelResponse("Answer that may contain org-private context");

    const prompt = "List the standard due diligence checklist items for rural land";

    // Org 1 caches the answer.
    await router.routeAITask(task(prompt), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(1);

    // Platform-level call (no orgId): identical prompt — exact key differs
    // (platform bucket) and the semantic layer skips org entries → model call.
    await router.routeAITask(task(prompt), { skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(2);

    // Platform bucket still caches for itself: repeat platform call = HIT.
    await router.routeAITask(task(prompt), { skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(2);

    // And an org never hits the platform entry: org 2 same prompt → miss.
    await router.routeAITask(task(prompt), { orgId: 2, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(3);

    const stats = router.getAICacheStats();
    expect(stats.size).toBe(3); // org 1 + platform + org 2
  });

  it("(c2) platform paraphrases never semantically match org entries", async () => {
    const router = await loadRouter();
    mockModelResponse("Org 1 comparable-sales answer");

    const original = "average price per acre Travis County Texas land parcels";
    const paraphrase = "average price per acre Travis County Texas land lots";

    // Org 1 seeds.
    await router.routeAITask(task(original), { orgId: 1, skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(1);

    // Platform-level paraphrase (Jaccard 0.8 vs org 1's entry) → must miss.
    await router.routeAITask(task(paraphrase), { skipQuota: true, skipBudget: true });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(router.getAICacheStats().semanticHits).toBe(0);
  });
});
