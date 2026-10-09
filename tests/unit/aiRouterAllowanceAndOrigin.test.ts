/**
 * routeAITask honours the shared monthly AI allowance and records who
 * triggered each call (founder decision 2026-10-08).
 *
 *   - default origin: 'customer', or 'background' when skipQuota is set (the
 *     existing convention for cron/internal callers); an explicit origin wins;
 *   - a customer-triggered org call consults the allowance and, past it, runs
 *     on the org's own key (recorded at $0) or is refused before any model call;
 *   - background and platform calls never consult it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
    constructor() {}
  },
}));
vi.setConfig({ testTimeout: 60_000 });

const ORIGINAL_ENV = { ...process.env };
const rows: Record<string, unknown>[] = [];
const allowance = { calls: 0, result: null as unknown, throws: null as Error | null };

async function loadRouter() {
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
  vi.doMock("../../server/services/aiAllowance", () => ({
    enforceAiAllowance: async () => {
      allowance.calls++;
      if (allowance.throws) throw allowance.throws;
      return allowance.result;
    },
  }));
  vi.doMock("@shared/schema", () => ({
    aiRoutingOverrides: { active: "active", taskType: "taskType" },
    aiModelConfigs: { enabled: "enabled", weight: "weight" },
    aiTelemetryEvents: {},
  }));
  vi.doMock("../../server/db", () => ({
    db: {
      select: () => ({ from: () => ({ where: () => [] }) }),
      insert: () => ({ values: async (v: Record<string, unknown>) => { rows.push(v); } }),
    },
  }));
  const mod = await import("../../server/services/aiRouter");
  mod.clearAICache();
  return mod;
}

const ok = { id: "gen", choices: [{ message: { content: "An answer of reasonable length." } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("routeAITask — allowance + origin", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue(ok);
    rows.length = 0;
    allowance.calls = 0;
    allowance.result = null;
    allowance.throws = null;
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    process.env.AI_CASCADE_ENABLED = "false";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  const task = (r: any) => ({ taskType: "draft_email", complexity: r.TaskComplexity.MODERATE, messages: [{ role: "user" as const, content: "q" }] });

  it("an org call defaults to origin 'customer' and consults the allowance", async () => {
    const r = await loadRouter();
    await r.routeAITask(task(r), { orgId: 7 });
    await flush();
    expect(allowance.calls).toBe(1);
    expect(rows.at(-1)).toMatchObject({ organizationId: 7, origin: "customer" });
  });

  it("skipQuota (the cron convention) defaults to 'background' and never consults it", async () => {
    const r = await loadRouter();
    await r.routeAITask(task(r), { orgId: 7, skipQuota: true });
    await flush();
    expect(allowance.calls).toBe(0);
    expect(rows.at(-1)).toMatchObject({ origin: "background" });
  });

  it("an explicit origin wins over the default", async () => {
    const r = await loadRouter();
    await r.routeAITask(task(r), { orgId: 7, skipQuota: true, origin: "customer" });
    await flush();
    expect(allowance.calls).toBe(1);
  });

  it("past the allowance without a key: refused before any model call", async () => {
    const r = await loadRouter();
    allowance.throws = Object.assign(new Error("byok"), { code: "AI_ALLOWANCE_BYOK_REQUIRED" });
    await expect(r.routeAITask(task(r), { orgId: 7 })).rejects.toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("past the allowance with a key: the org's key serves it at $0", async () => {
    const r = await loadRouter();
    const byokCreate = vi.fn().mockResolvedValue(ok);
    allowance.result = { channel: "openrouter", client: { chat: { completions: { create: byokCreate } } }, mapModel: (m: string) => m };
    const res = await r.routeAITask(task(r), { orgId: 7 });
    expect(byokCreate).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    expect(res.estimatedCost).toBe(0);
  });

  it("a platform call (no org) has no allowance and no origin", async () => {
    const r = await loadRouter();
    await r.routeAITask(task(r), {});
    await flush();
    expect(allowance.calls).toBe(0);
    expect(rows.at(-1)).toMatchObject({ origin: null });
  });
});
