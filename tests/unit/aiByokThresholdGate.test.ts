/**
 * Tier 1I — AI-turn BYOK threshold gate tests (2026-06-10).
 *
 * Founder decision: mandatory BYOK past a generous monthly turn threshold —
 * NOT a hard ceiling, NOT metered overage. These tests lock in:
 *
 *   1. Threshold constants stay generous AND margin-positive per tier.
 *   2. checkAiTurnGate: under-threshold allowed; warning at ≥80%;
 *      at/past threshold without BYOK → blocked with reason "byok_required";
 *      with an active AI key → allowed/unlimited (mode "byok"); founders
 *      are never gated.
 *   3. checkUsageLimit lifts the ai_requests cap when an AI BYOK key is
 *      active (those turns are the customer's spend, zero platform COGS).
 *   4. mapModelForByokChannel maps OpenRouter-namespace model ids onto what
 *      each BYOK channel can actually serve.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TIER_LIMITS,
  AI_TURNS_BYOK_THRESHOLDS,
  AI_TURNS_BYOK_WARN_RATIO,
} from "@shared/billing/tier-limits";

// ── 1. Threshold constants ─────────────────────────────────────────────────

describe("AI_TURNS_BYOK_THRESHOLDS — tunable economics constants", () => {
  it("paid self-serve tiers have thresholds; free + enterprise do not", () => {
    expect(AI_TURNS_BYOK_THRESHOLDS.free).toBeNull();
    expect(AI_TURNS_BYOK_THRESHOLDS.starter).toBe(750);
    expect(AI_TURNS_BYOK_THRESHOLDS.pro).toBe(1500);
    expect(AI_TURNS_BYOK_THRESHOLDS.scale).toBe(6000);
    expect(AI_TURNS_BYOK_THRESHOLDS.enterprise).toBeNull();
  });

  it("tier table mirrors the constants (single source of truth)", () => {
    for (const tier of ["free", "starter", "pro", "scale", "enterprise"] as const) {
      expect(TIER_LIMITS[tier].aiTurnsByokThreshold).toBe(AI_TURNS_BYOK_THRESHOLDS[tier]);
    }
  });

  it("included COGS at threshold stays under monthly price (margin-positive)", () => {
    // ~1.5¢/turn worst case. Starter $29, Pro $49, Scale $199.
    expect(750 * 1.5).toBeLessThan(2900);
    expect(1500 * 1.5).toBeLessThan(4900);
    expect(6000 * 1.5).toBeLessThan(19900);
  });

  it("warn ratio is 80%", () => {
    expect(AI_TURNS_BYOK_WARN_RATIO).toBe(0.8);
  });
});

// ── 2/3. Gate behavior (mocked DB) ─────────────────────────────────────────

const state = {
  orgRow: { subscriptionTier: "pro", subscriptionStatus: "active", isFounder: false, trialEndsAt: null } as any,
  monthlyTurns: 0,
  byokChannel: null as string | null,
  alertInserts: 0,
};

function mockModules() {
  vi.doMock("@shared/schema", () => ({
    organizations: { id: "org.id", subscriptionTier: "org.tier", subscriptionStatus: "org.status", isFounder: "org.founder", trialEndsAt: "org.trial" },
    leads: { organizationId: "leads.org" },
    properties: { organizationId: "props.org" },
    notes: { organizationId: "notes.org" },
    usageEvents: { organizationId: "ue.org", eventType: "ue.type", quantity: "ue.qty", createdAt: "ue.created" },
    systemAlerts: { id: "sa.id", organizationId: "sa.org", type: "sa.type", createdAt: "sa.created" },
  }));

  vi.doMock("drizzle-orm", () => ({
    eq: (a: any, b: any) => ({ op: "eq", a, b }),
    and: (...args: any[]) => ({ op: "and", args }),
    gte: (a: any, b: any) => ({ op: "gte", a, b }),
    count: () => ({ op: "count" }),
    sum: () => ({ op: "sum" }),
    inArray: (a: any, b: any) => ({ op: "inArray", a, b }),
    isNull: (a: any) => ({ op: "isNull", a }),
  }));

  vi.doMock("../../server/storage", () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                ...state.orgRow,
                total: state.monthlyTurns,
                count: state.monthlyTurns,
              },
            ]),
        }),
      }),
      insert: () => ({
        values: () => {
          state.alertInserts += 1;
          return Promise.resolve();
        },
      }),
    },
  }));

  // checkAiTurnGate + checkUsageLimit lazily import the AI BYOK helper.
  vi.doMock("../../server/services/byok/aiByok", () => ({
    getActiveAiByokChannel: async () => state.byokChannel,
  }));
}

async function importGate() {
  mockModules();
  return await import("../../server/services/usageLimits");
}

beforeEach(() => {
  vi.resetModules();
  state.orgRow = { subscriptionTier: "pro", subscriptionStatus: "active", isFounder: false, trialEndsAt: null };
  state.monthlyTurns = 0;
  state.byokChannel = null;
  state.alertInserts = 0;
});

describe("checkAiTurnGate — the Tier 1I gate", () => {
  it("under threshold → allowed, mode platform, no warning", async () => {
    state.monthlyTurns = 100;
    const { checkAiTurnGate } = await importGate();
    const r = await checkAiTurnGate(1);
    expect(r.allowed).toBe(true);
    expect(r.mode).toBe("platform");
    expect(r.warning).toBe(false);
    expect(r.threshold).toBe(1500);
  });

  it("at ≥80% of threshold → allowed with warning flag", async () => {
    state.monthlyTurns = 1200; // exactly 80% of pro's 1500
    const { checkAiTurnGate } = await importGate();
    const r = await checkAiTurnGate(1);
    expect(r.allowed).toBe(true);
    expect(r.warning).toBe(true);
  });

  it("at/past threshold WITHOUT BYOK → blocked with reason byok_required", async () => {
    state.monthlyTurns = 1500;
    const { checkAiTurnGate } = await importGate();
    const r = await checkAiTurnGate(1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("byok_required");
    expect(r.byokAvailable).toBe(true); // Pro can self-serve a key
    expect(r.byokActive).toBe(false);
  });

  it("Starter is also BYOK-eligible when blocked (AI channels open to all paid tiers)", async () => {
    state.orgRow.subscriptionTier = "starter";
    state.monthlyTurns = 750;
    const { checkAiTurnGate } = await importGate();
    const r = await checkAiTurnGate(1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("byok_required");
    expect(r.byokAvailable).toBe(true);
  });

  it("past threshold WITH an active AI key → allowed, unlimited, mode byok", async () => {
    state.monthlyTurns = 99999;
    state.byokChannel = "anthropic";
    const { checkAiTurnGate } = await importGate();
    const r = await checkAiTurnGate(1);
    expect(r.allowed).toBe(true);
    expect(r.mode).toBe("byok");
    expect(r.byokActive).toBe(true);
  });

  it("free tier has no BYOK threshold — the plain ai_requests cap governs", async () => {
    state.orgRow.subscriptionTier = "free";
    state.monthlyTurns = 70;
    const { checkAiTurnGate } = await importGate();
    const r = await checkAiTurnGate(1);
    expect(r.allowed).toBe(true);
    expect(r.threshold).toBeNull();
  });

  it("founders are never gated", async () => {
    state.monthlyTurns = 999999;
    const { checkAiTurnGate } = await importGate();
    const r = await checkAiTurnGate(1, { isFounder: true });
    expect(r.allowed).toBe(true);
    expect(r.mode).toBe("founder");
  });
});

describe("checkUsageLimit — BYOK lifts the ai_requests cap", () => {
  it("over the monthly cap WITHOUT BYOK → blocked", async () => {
    state.orgRow.subscriptionTier = "starter"; // cap 1500/mo
    state.monthlyTurns = 1600;
    const { checkUsageLimit } = await importGate();
    const r = await checkUsageLimit(1, "ai_requests");
    expect(r.allowed).toBe(false);
  });

  it("over the monthly cap WITH an active AI key → allowed (their spend, not our COGS)", async () => {
    state.orgRow.subscriptionTier = "starter";
    state.monthlyTurns = 1600;
    state.byokChannel = "openrouter";
    const { checkUsageLimit } = await importGate();
    const r = await checkUsageLimit(1, "ai_requests");
    expect(r.allowed).toBe(true);
  });
});

// ── 4. Model mapping (pure function) ───────────────────────────────────────

describe("mapModelForByokChannel — channel model-id mapping", () => {
  async function importMapper() {
    // The gate tests above mock the whole aiByok module — undo that so we
    // exercise the REAL pure mapper here.
    vi.doUnmock("../../server/services/byok/aiByok");
    // aiByok imports the real db module at top level — stub it out.
    vi.doMock("../../server/db", () => ({ db: {} }));
    vi.doMock("../../server/services/byok/key-vault", () => ({
      getByokCredential: async () => null,
    }));
    vi.doMock("@shared/schema", () => ({ byokCredentials: {} }));
    vi.doMock("drizzle-orm", () => ({
      inArray: () => ({}),
      and: () => ({}),
      eq: () => ({}),
      isNull: () => ({}),
    }));
    vi.doMock("../../server/utils/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    const mod = await import("../../server/services/byok/aiByok");
    return mod;
  }

  beforeEach(() => vi.resetModules());

  it("openrouter passes platform model ids through unchanged", async () => {
    const { mapModelForByokChannel } = await importMapper();
    expect(mapModelForByokChannel("openrouter", "anthropic/claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
    expect(mapModelForByokChannel("openrouter", "openai/gpt-4o")).toBe("openai/gpt-4o");
  });

  it("anthropic strips the namespace and maps non-Claude to bare Sonnet", async () => {
    const { mapModelForByokChannel } = await importMapper();
    expect(mapModelForByokChannel("anthropic", "anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(mapModelForByokChannel("anthropic", "claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(mapModelForByokChannel("anthropic", "openai/gpt-4o")).toBe("claude-sonnet-4-6");
  });

  it("openai strips its namespace and maps non-OpenAI to gpt-4o", async () => {
    const { mapModelForByokChannel } = await importMapper();
    expect(mapModelForByokChannel("openai", "openai/gpt-4o")).toBe("gpt-4o");
    expect(mapModelForByokChannel("openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(mapModelForByokChannel("openai", "anthropic/claude-sonnet-4-6")).toBe("gpt-4o");
  });
});
