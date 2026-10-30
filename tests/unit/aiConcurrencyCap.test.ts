/**
 * G10 (2026-10-30) — the per-org bound on AI tasks in flight.
 *
 * Provider is stubbed (a held promise); no real spend. The cap is exercised
 * through BOTH metered entry points to prove they share one counter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
    constructor() {}
  },
}));

const ORIGINAL_ENV = { ...process.env };

async function load() {
  vi.resetModules();
  vi.doMock("../../server/services/aiCostCeiling", () => ({ assertWithinAiCostCeiling: vi.fn().mockResolvedValue(undefined) }));
  vi.doMock("../../server/services/intelligence/budget", () => ({
    categoryFor: () => "test",
    checkBudget: vi.fn().mockResolvedValue({ withinBudget: true, capCents: 1000, spentCents: 0 }),
    BudgetExceededError: class extends Error {},
  }));
  vi.doMock("../../server/services/ai-telemetry", () => ({
    recordAiCall: vi.fn().mockResolvedValue(undefined),
    complexityClassFromTaskType: () => "other",
    classifyError: () => "unknown",
  }));
  vi.doMock("../../server/services/aiQuotaService", () => ({
    checkQuota: vi.fn(), recordUsage: vi.fn(), getOrgQuotaCap: vi.fn().mockResolvedValue(0), AIQuotaExceeded: class extends Error {},
  }));
  vi.doMock("../../server/services/aiAllowance", () => ({ enforceAiAllowance: async () => null }));
  vi.doMock("@shared/schema", () => ({
    aiRoutingOverrides: { active: "active", taskType: "taskType" },
    aiModelConfigs: { enabled: "enabled", weight: "weight" },
    aiTelemetryEvents: {},
  }));
  vi.doMock("../../server/db", () => ({
    db: {
      select: () => ({ from: () => ({ where: () => [] }) }),
      insert: () => ({ values: async () => {} }),
    },
  }));
  const router = await import("../../server/services/aiRouter");
  router.clearAICache();
  const conc = await import("../../server/services/aiConcurrency");
  const guard = await import("../../server/services/aiSpendGuard");
  return { router, conc, guard };
}

const ok = { id: "gen", choices: [{ message: { content: "An answer of reasonable length." } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
const tick = () => new Promise((r) => setTimeout(r, 5));
/** Wait until `n` provider calls are actually held open (not merely admitted). */
async function until(n: number) {
  for (let i = 0; i < 400 && createMock.mock.calls.length < n; i++) await tick();
  expect(createMock.mock.calls.length).toBeGreaterThanOrEqual(n);
}

/** A provider call that stays in flight until released. */
function holdProvider() {
  const releases: Array<(v?: unknown) => void> = [];
  const failures: Array<(e: Error) => void> = [];
  createMock.mockImplementation(
    () => new Promise((resolve, reject) => { releases.push(() => resolve(ok)); failures.push(reject); }),
  );
  return { releases, failures };
}

describe("G10 — per-org AI concurrency cap", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    process.env.AI_CASCADE_ENABLED = "false";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  const task = (r: any, i = 0) => ({ taskType: "draft_email", complexity: r.TaskComplexity.MODERATE, messages: [{ role: "user" as const, content: `q${i}` }] });

  it("concurrency cap trips at 5 per org", async () => {
    const { router, conc } = await load();
    expect(conc.AI_ORG_CONCURRENCY_CAP).toBe(5);
    const held = holdProvider();

    const first5 = Array.from({ length: 5 }, (_, i) => router.routeAITask(task(router, i), { orgId: 7 }));
    await until(5);
    expect(conc.aiConcurrencyInFlight(7)).toBe(5);

    const sixth = await router.routeAITask(task(router, 6), { orgId: 7 }).catch((e) => e);
    expect(sixth).toBeInstanceOf(conc.AIConcurrencyExceeded);
    expect(sixth).toMatchObject({ statusCode: 429, code: "AI_CONCURRENCY_EXCEEDED" });
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);

    // A different org in the same window is unaffected.
    const other = router.routeAITask(task(router, 9), { orgId: 8 });
    await until(6);
    expect(conc.aiConcurrencyInFlight(8)).toBe(1);

    held.releases.forEach((r) => r());
    await Promise.all([...first5, other]);
    expect(conc.aiConcurrencyInFlight(7)).toBe(0);
    expect(conc.aiConcurrencyInFlight(8)).toBe(0);

    // No leak: five fresh calls are admitted again.
    createMock.mockResolvedValue(ok);
    await Promise.all(Array.from({ length: 5 }, (_, i) => router.routeAITask(task(router, 20 + i), { orgId: 7 })));
  });

  it("concurrency slots free on throw", async () => {
    const { router, conc } = await load();
    createMock.mockRejectedValue(new Error("provider exploded"));
    for (let i = 0; i < 8; i++) {
      await expect(router.routeAITask(task(router, i), { orgId: 7 })).rejects.toThrow();
      expect(conc.aiConcurrencyInFlight(7)).toBe(0);
    }
    createMock.mockReset();
    createMock.mockResolvedValue(ok);
    await expect(router.routeAITask(task(router, 99), { orgId: 7 })).resolves.toBeTruthy();
  });

  it("routeAITask and the aiSpendGuard raw path share ONE counter", async () => {
    const { router, conc, guard } = await load();
    const held = holdProvider();
    const viaRouter = Array.from({ length: 3 }, (_, i) => router.routeAITask(task(router, i), { orgId: 7 }));
    const viaGuard = Array.from({ length: 2 }, () =>
      guard.meteredChatCompletion(
        { chat: { completions: { create: createMock as never } } },
        { model: "gpt-4o", messages: [{ role: "user", content: "q" }] },
        { taskType: "g10_probe", orgId: 7, origin: "customer" },
      ),
    );
    await until(5);
    expect(conc.aiConcurrencyInFlight(7)).toBe(5);

    // The 6th, on EITHER path, is refused.
    await expect(router.routeAITask(task(router, 50), { orgId: 7 })).rejects.toMatchObject({ code: "AI_CONCURRENCY_EXCEEDED" });
    await expect(
      guard.meteredChatCompletion(
        { chat: { completions: { create: createMock as never } } },
        { model: "gpt-4o", messages: [{ role: "user", content: "q" }] },
        { taskType: "g10_probe", orgId: 7, origin: "customer" },
      ),
    ).rejects.toMatchObject({ code: "AI_CONCURRENCY_EXCEEDED" });

    held.releases.forEach((r) => r());
    await Promise.all([...viaRouter, ...viaGuard]);
    expect(conc.aiConcurrencyInFlight(7)).toBe(0);
  });

  it("a caller with no org is not bounded (platform-internal)", async () => {
    const { conc } = await load();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => conc.withAiConcurrencySlot(null, async () => "ok")),
    );
    expect(results).toHaveLength(12);
  });

  it("the terminal handler turns the refusal into a 429 with Retry-After and the named code", async () => {
    const { conc } = await load();
    const { terminalErrorHandler } = await import("../../server/middleware/terminalErrorHandler");
    const headers: Record<string, string> = {};
    let status = 0;
    let body: any;
    const res: any = {
      headersSent: false,
      setHeader: (k: string, v: string) => { headers[k] = v; },
      getHeader: () => undefined,
      status(s: number) { status = s; return this; },
      json(b: unknown) { body = b; return this; },
    };
    terminalErrorHandler(new conc.AIConcurrencyExceeded(5), {} as any, res, () => {});
    expect(status).toBe(429);
    expect(headers["Retry-After"]).toBe("2");
    expect(body).toMatchObject({ error: "AI_CONCURRENCY_EXCEEDED", statusCode: 429 });
  });
});
