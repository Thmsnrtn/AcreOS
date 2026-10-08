/**
 * The platform AI ceiling must scale with the business, not cause an outage.
 *
 * A fixed $15/day fail-closed ceiling pauses AI for EVERY customer once their
 * summed, perfectly ordinary spend crosses it — at roughly 25-50 customers
 * (audit F-16-4). The default is now
 *
 *     max(PLATFORM_DAILY_CEILING_FLOOR_CENTS, floor(payingMrrCents / 30 × 0.75))
 *
 * These tests drive the ENFORCING function (assertWithinPlatformCostCeiling),
 * not just the helper, so a ceiling that computes the right number but is not
 * the one enforced goes red:
 *   1. grows with MRR (spend that trips the floor is allowed at higher MRR);
 *   2. never drops below the floor (tiny MRR still enforces at $15);
 *   3. fails CLOSED on an MRR read error (the floor, never a larger number);
 *   4. an explicit AI_PLATFORM_DAILY_CEILING_CENTS still wins;
 *   5. the surfaces that DISPLAY the ceiling consume the canonical function.
 */

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const mockWhere = vi.fn();
const liveMrrDetail = vi.fn();

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: any[]) => mockWhere(...args),
      }),
    }),
  },
}));
vi.mock("../../server/services/finance/runwayModel", () => ({ liveMrrDetail }));
vi.mock("@shared/schema", () => ({
  aiCostCeilingOverrides: { organizationId: "organizationId" },
  aiTelemetryEvents: {
    estimatedCostCents: "estimated_cost_cents",
    organizationId: "organization_id",
    createdAt: "created_at",
  },
  organizations: { id: "id", subscriptionTier: "subscription_tier" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ and: a }),
  eq: (c: any, v: any) => ({ eq: [c, v] }),
  gte: (c: any, v: any) => ({ gte: [c, v] }),
  sql: (strings: TemplateStringsArray, ...vals: any[]) => ({ sql: strings, vals }),
}));

import {
  assertWithinPlatformCostCeiling,
  getPlatformDailyCeiling,
  AiCostCeilingExceededError,
  PLATFORM_DAILY_CEILING_FLOOR_CENTS,
  __resetPlatformCeilingMrrCacheForTests,
} from "../../server/services/aiCostCeiling";

// Walks every server source file; the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ORIG_ENV = { ...process.env };
const spend = (cents: number) => mockWhere.mockResolvedValue([{ sum: String(cents) }]);
const mrr = (cents: number) => liveMrrDetail.mockResolvedValue({ cents, payingOrgs: 1 });

describe("platform AI ceiling scales with paying MRR (still fail-closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPlatformCeilingMrrCacheForTests();
    delete process.env.AI_PLATFORM_DAILY_CEILING_CENTS;
    delete process.env.AI_PLATFORM_CEILING_MRR_SHARE;
    delete process.env.AI_COST_CEILING_BYPASS;
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("the floor is $15/day", () => {
    expect(PLATFORM_DAILY_CEILING_FLOOR_CENTS).toBe(1500);
  });

  it("GROWS with MRR: 50 customers × $49 → 75% of a day's MRR", async () => {
    mrr(50 * 4900); // $2,450 MRR → $81.67/day → 75% = $61.25
    const c = await getPlatformDailyCeiling();
    expect(c.cents).toBe(Math.floor((50 * 4900) / 30 * 0.75));
    expect(c.source).toBe("mrr_scaled");

    // $30 of real spend: an outage under the fixed $15 rule, allowed now.
    spend(3000);
    await expect(assertWithinPlatformCostCeiling()).resolves.toBeUndefined();
    // …and still enforced at the scaled value.
    spend(c.cents);
    await expect(assertWithinPlatformCostCeiling()).rejects.toMatchObject({
      code: "AI_COST_CEILING_EXCEEDED",
      ceilingCents: c.cents,
    });
  });

  it("is monotone in MRR", async () => {
    let last = 0;
    for (const n of [0, 5, 10, 25, 50, 100, 500]) {
      __resetPlatformCeilingMrrCacheForTests();
      mrr(n * 4900);
      const { cents } = await getPlatformDailyCeiling();
      expect(cents).toBeGreaterThanOrEqual(last);
      last = cents;
    }
  });

  it("NEVER drops below the floor at small MRR", async () => {
    mrr(3 * 2000); // three Starter orgs → $2/day scaled
    const c = await getPlatformDailyCeiling();
    expect(c.cents).toBe(1500);
    expect(c.source).toBe("floor");
    spend(1500);
    await expect(assertWithinPlatformCostCeiling()).rejects.toBeInstanceOf(AiCostCeilingExceededError);
  });

  it("fails CLOSED on an MRR read error — the floor, never a larger number", async () => {
    liveMrrDetail.mockRejectedValue(new Error("db down"));
    const c = await getPlatformDailyCeiling();
    expect(c).toMatchObject({ cents: 1500, source: "floor" });
    spend(1500);
    await expect(assertWithinPlatformCostCeiling()).rejects.toBeInstanceOf(AiCostCeilingExceededError);
  });

  it("a non-finite MRR read is a read error, not a huge ceiling", async () => {
    liveMrrDetail.mockResolvedValue({ cents: Number.POSITIVE_INFINITY, payingOrgs: 1 });
    expect((await getPlatformDailyCeiling()).cents).toBe(1500);
  });

  it("the spend read is still fail-closed for autonomous callers", async () => {
    mrr(100 * 4900);
    mockWhere.mockRejectedValue(new Error("telemetry unreadable"));
    // Step past the 10-minute last-known-good window the earlier cases filled.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    try {
      await expect(assertWithinPlatformCostCeiling({ failClosed: true })).rejects.toBeInstanceOf(
        AiCostCeilingExceededError,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("an explicit env override still wins over the MRR-scaled default", async () => {
    mrr(100 * 4900);
    process.env.AI_PLATFORM_DAILY_CEILING_CENTS = "2000";
    const c = await getPlatformDailyCeiling();
    expect(c).toMatchObject({ cents: 2000, source: "env_override" });
    expect(liveMrrDetail).not.toHaveBeenCalled();
  });

  it("the MRR share is env-tunable within (0, 1]", async () => {
    mrr(100 * 4900);
    process.env.AI_PLATFORM_CEILING_MRR_SHARE = "0.5";
    expect((await getPlatformDailyCeiling()).cents).toBe(Math.floor((100 * 4900) / 30 * 0.5));
    __resetPlatformCeilingMrrCacheForTests();
    process.env.AI_PLATFORM_CEILING_MRR_SHARE = "7"; // nonsense → default
    expect((await getPlatformDailyCeiling()).cents).toBe(Math.floor((100 * 4900) / 30 * 0.75));
  });
});

describe("law 2 — the surfaces that show the ceiling consume the canonical function", () => {
  const ROOT = path.resolve(__dirname, "../..");
  // Every non-test server file that READS the env var (process.env.X or
  // env["X"]) is a consumer that could re-derive the rule. Only the canonical
  // module may read it. Message strings that merely name the variable are not reads.
  const offenders = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
          const code = stripComments(fs.readFileSync(p, "utf8"));
          if (/\benv\s*(?:\.\s*AI_PLATFORM_DAILY_CEILING_CENTS\b|\[\s*["'`]AI_PLATFORM_DAILY_CEILING_CENTS)/.test(code)) out.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, "server"));
    return out;
  })();

  it("only aiCostCeiling.ts reads AI_PLATFORM_DAILY_CEILING_CENTS in code", () => {
    // Vacuity: the canonical module itself must be found by the walker.
    expect(offenders).toContain("server/services/aiCostCeiling.ts");
    expect(offenders.filter((f) => f !== "server/services/aiCostCeiling.ts")).toEqual([]);
  });
});
