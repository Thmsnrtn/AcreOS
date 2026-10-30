/**
 * G10 (2026-10-30) — the AI cost-ceiling gate and the quota gate behave BY
 * DESIGN under a metering outage, not by a caller swallowing a raw DB error.
 *
 * Method mirrors the G10 staging run: a real pg pool pointed at an unreachable
 * host (postgres://127.0.0.1:1/g10dead), a fresh module graph per test, no
 * mocked database. Nothing here reaches a provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

const ORIGINAL_ENV = { ...process.env };
const warn = vi.fn();
const error = vi.fn();

async function loadDead() {
  vi.resetModules();
  process.env.DATABASE_URL = "postgres://127.0.0.1:1/g10dead";
  delete process.env.DATABASE_REPLICA_URL;
  delete process.env.AI_COST_CEILING_BYPASS;
  delete process.env.AI_PLATFORM_DAILY_CEILING_CENTS;
  vi.doMock("../../server/utils/logger", () => ({
    logger: { warn, error, info: vi.fn(), debug: vi.fn() },
  }));
  return {
    ceiling: await import("../../server/services/aiCostCeiling"),
    quota: await import("../../server/services/aiQuotaService"),
  };
}

describe("G10 — gates under a dead metering database", () => {
  beforeEach(() => {
    warn.mockClear();
    error.mockClear();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("customer call with dead DB returns allow, not throw", async () => {
    const { ceiling } = await loadDead();
    await expect(ceiling.assertWithinAiCostCeiling(23)).resolves.toBeUndefined();
    const warned = warn.mock.calls.map((c) => String(c[0]));
    expect(warned.some((m) => m.includes("ai_cost_ceiling_overrides unreadable"))).toBe(true);
  });

  it("customer call through the aiSpendGuard entry proceeds to the provider", async () => {
    const { } = await loadDead();
    vi.doMock("../../server/services/aiAllowance", () => ({ enforceAiAllowance: async () => null }));
    const guard = await import("../../server/services/aiSpendGuard");
    const create = vi.fn().mockResolvedValue({ id: "stub", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const res = await guard.meteredChatCompletion(
      { chat: { completions: { create } } },
      { model: "gpt-4o", messages: [{ role: "user", content: "q" }] },
      { taskType: "g10_probe", orgId: 23, origin: "customer" },
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.id).toBe("stub");
  });

  it("an unreadable overrides table falls back to the tier default ceilings", async () => {
    const { ceiling } = await loadDead();
    const eff = await ceiling.getEffectiveCeilings(23);
    expect(eff).toMatchObject({ dailyCents: 200, monthlyCents: 2000, source: "tier_default" });
  });

  it("background call with dead DB still fails closed at the 70% bucket", async () => {
    const { ceiling } = await loadDead();
    const err = await ceiling.assertWithinAiCostCeiling(23, { failClosed: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ceiling.AiCostCeilingExceededError);
    expect(err.ceilingCents).toBe(1050); // floor(1500 × 0.7) of the $15 floor
    expect(err.currentCents).toBe(-1);
    expect(
      error.mock.calls.some((c) =>
        String(c[0]).includes("platform ceiling unreadable; failing CLOSED for autonomous caller"),
      ),
    ).toBe(true);
  });

  it("quota gate under metering outage throws a designed refusal, not a raw DB error", async () => {
    const { quota } = await loadDead();
    const err = await quota.checkQuota(23, 50).catch((e) => e);
    expect(err).toBeInstanceOf(quota.AIQuotaUnavailable);
    expect(err.code).toBe("AI_QUOTA_UNAVAILABLE");
    expect(err.statusCode).toBe(503);
    expect(err.message).not.toMatch(/select|from "|Failed query|ai_usage_daily|ECONNREFUSED/i);
  });
});
