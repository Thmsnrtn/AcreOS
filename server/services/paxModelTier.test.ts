/**
 * Tests for Batch 7 — Pax model tier gating.
 *
 * The SUT (paxModelTier.ts) does two reads:
 *   1. `organizations` → subscription_tier
 *   2. `ai_call_log` → count of feature='pax_chat' rows since start of month
 *
 * We mock the db module so each test queues the rows those reads should
 * return. The chain is `db.select(...).from(...).where(...).limit(?)` and
 * `db.select(...).from(...).where(...)` — both are awaitable (thenable) and
 * resolve to the next queued rows.
 *
 * Coverage:
 *   - free → Haiku (always)
 *   - pro <1000 msgs → Sonnet
 *   - pro >=1000 msgs → Haiku (downgrade)
 *   - scale <500 msgs → Opus
 *   - scale >=500 msgs → Sonnet (downgrade)
 *   - lookup error → Haiku (fail-open)
 *   - getPaxMonthlyUsage surfaces the right cap + downgrade flag
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock db (same shape as server/services/ai-telemetry.test.ts) ─────────────

const mocks = vi.hoisted(() => {
  // Each entry is the result of one awaited `db.select(...).from(...).where(...)`
  // chain. The SUT fires two selects per call (org tier + monthly count) via
  // Promise.all, so each test enqueues two rows-arrays.
  let selectQueue: Array<Array<Record<string, unknown>>> = [];
  let shouldThrow: Error | null = null;

  function nextSelectResult(): Promise<Array<Record<string, unknown>>> {
    if (shouldThrow) return Promise.reject(shouldThrow);
    return Promise.resolve(selectQueue.shift() ?? []);
  }

  function buildDbMock() {
    const select = vi.fn((_shape?: unknown) => {
      const chain: Record<string, unknown> = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        then: (
          onFulfilled: (rows: unknown) => unknown,
          onRejected?: (err: unknown) => unknown,
        ) => nextSelectResult().then(onFulfilled, onRejected),
      };
      return chain;
    });
    return { select };
  }

  const db = buildDbMock();

  return {
    db,
    setSelectQueue(q: Array<Array<Record<string, unknown>>>) {
      selectQueue.length = 0;
      selectQueue.push(...q);
    },
    setThrow(err: Error | null) {
      shouldThrow = err;
    },
  };
});

vi.mock("../db", () => ({ db: mocks.db }));

// Keep drizzle-orm real — only `eq`/`and`/`gte`/`sql` are used as argument tags
// inside the mocked chain, which ignores them.
vi.mock("drizzle-orm", async () => {
  return await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
});

// ── SUT ──────────────────────────────────────────────────────────────────────

import {
  pickPaxModelForOrg,
  getPaxMonthlyUsage,
  paxTierForSubscriptionTier,
  PAX_MODEL_HAIKU,
  PAX_MODEL_SONNET,
  PAX_MODEL_OPUS,
  MONTHLY_SOFT_CAP_PRO,
  MONTHLY_SOFT_CAP_SCALE,
} from "./paxModelTier";

beforeEach(() => {
  mocks.setSelectQueue([]);
  mocks.setThrow(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── paxTierForSubscriptionTier ───────────────────────────────────────────────

describe("paxTierForSubscriptionTier", () => {
  it("collapses raw subscription tier to Pax tier", () => {
    expect(paxTierForSubscriptionTier("free")).toBe("free");
    expect(paxTierForSubscriptionTier(null)).toBe("free");
    expect(paxTierForSubscriptionTier(undefined)).toBe("free");
    expect(paxTierForSubscriptionTier("")).toBe("free");
    expect(paxTierForSubscriptionTier("garbage")).toBe("free");

    expect(paxTierForSubscriptionTier("pro")).toBe("pro");
    expect(paxTierForSubscriptionTier("PRO")).toBe("pro");
    expect(paxTierForSubscriptionTier("operator")).toBe("pro"); // legacy alias
    expect(paxTierForSubscriptionTier("starter")).toBe("pro");
    expect(paxTierForSubscriptionTier("solo")).toBe("pro"); // legacy starter alias

    expect(paxTierForSubscriptionTier("scale")).toBe("scale");
    expect(paxTierForSubscriptionTier("empire")).toBe("scale"); // legacy alias
    expect(paxTierForSubscriptionTier("enterprise")).toBe("scale");
  });
});

// ── pickPaxModelForOrg ───────────────────────────────────────────────────────

describe("pickPaxModelForOrg", () => {
  it("free tier → Haiku regardless of usage", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "free" }],
      [{ n: 0 }],
    ]);
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_HAIKU);
    expect(choice.tier).toBe("free");
    expect(choice.reason).toBe("tier_default");
    expect(choice.isDowngraded).toBe(false);
    expect(choice.msgCountThisMonth).toBe(0);
  });

  it("pro tier under monthly cap → Sonnet", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "pro" }],
      [{ n: 999 }],
    ]);
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_SONNET);
    expect(choice.tier).toBe("pro");
    expect(choice.reason).toBe("tier_default");
    expect(choice.isDowngraded).toBe(false);
    expect(choice.msgCountThisMonth).toBe(999);
  });

  it("pro tier at monthly cap → Haiku downgrade", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "pro" }],
      [{ n: MONTHLY_SOFT_CAP_PRO }],
    ]);
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_HAIKU);
    expect(choice.tier).toBe("pro");
    expect(choice.reason).toBe("monthly_soft_cap_downgrade");
    expect(choice.isDowngraded).toBe(true);
  });

  it("pro tier over monthly cap → Haiku downgrade", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "pro" }],
      [{ n: 5000 }],
    ]);
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_HAIKU);
    expect(choice.isDowngraded).toBe(true);
  });

  it("scale tier under monthly cap → Opus", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "scale" }],
      [{ n: 499 }],
    ]);
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_OPUS);
    expect(choice.tier).toBe("scale");
    expect(choice.reason).toBe("tier_default");
    expect(choice.isDowngraded).toBe(false);
  });

  it("scale tier at monthly cap → Sonnet downgrade", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "scale" }],
      [{ n: MONTHLY_SOFT_CAP_SCALE }],
    ]);
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_SONNET);
    expect(choice.tier).toBe("scale");
    expect(choice.reason).toBe("monthly_soft_cap_downgrade");
    expect(choice.isDowngraded).toBe(true);
  });

  it("lookup error → Haiku fail-open", async () => {
    mocks.setThrow(new Error("db is angry"));
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_HAIKU);
    expect(choice.tier).toBe("free");
    expect(choice.reason).toBe("tier_default");
    expect(choice.isDowngraded).toBe(false);
    expect(choice.msgCountThisMonth).toBe(0);
  });

  it("missing org row → treated as free → Haiku", async () => {
    mocks.setSelectQueue([
      [],
      [{ n: 0 }],
    ]);
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_HAIKU);
    expect(choice.tier).toBe("free");
  });

  it("count returned as string (drizzle numeric quirk) is coerced", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "pro" }],
      [{ n: "1500" }], // numeric -> string in some pg-driver paths
    ]);
    const choice = await pickPaxModelForOrg(42);
    expect(choice.model).toBe(PAX_MODEL_HAIKU);
    expect(choice.msgCountThisMonth).toBe(1500);
    expect(choice.isDowngraded).toBe(true);
  });
});

// ── getPaxMonthlyUsage ───────────────────────────────────────────────────────

describe("getPaxMonthlyUsage", () => {
  it("free tier reports cap=25 (daily Free allowance)", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "free" }],
      [{ n: 7 }],
    ]);
    const usage = await getPaxMonthlyUsage(42);
    expect(usage).toEqual({ tier: "free", used: 7, cap: 25, downgraded: false });
  });

  it("pro tier under cap reports downgraded=false", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "pro" }],
      [{ n: 500 }],
    ]);
    const usage = await getPaxMonthlyUsage(42);
    expect(usage).toEqual({
      tier: "pro",
      used: 500,
      cap: MONTHLY_SOFT_CAP_PRO,
      downgraded: false,
    });
  });

  it("scale tier over cap reports downgraded=true", async () => {
    mocks.setSelectQueue([
      [{ subscriptionTier: "scale" }],
      [{ n: 501 }],
    ]);
    const usage = await getPaxMonthlyUsage(42);
    expect(usage).toEqual({
      tier: "scale",
      used: 501,
      cap: MONTHLY_SOFT_CAP_SCALE,
      downgraded: true,
    });
  });

  it("lookup error → safe Free defaults", async () => {
    mocks.setThrow(new Error("db unreachable"));
    const usage = await getPaxMonthlyUsage(42);
    expect(usage).toEqual({ tier: "free", used: 0, cap: 25, downgraded: false });
  });
});
