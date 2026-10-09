/**
 * Legacy tier names get the tier they pay for — everywhere the pool, the AI
 * allowance and the cost ceilings are computed.
 *
 * `organizations.subscription_tier` still holds pre-rename values on older
 * rows: "solo" (now Starter), "operator" (Pro), "empire" (Scale). MRR already
 * folds them (tier-pricing.tierForSubscriptionTier). The limit paths did not:
 * an "empire" org paying $79 for Scale resolved to the FREE tier's 50-credit
 * pool and to no ceiling default at all. limitsTierFor() is now the one fold,
 * and each computation below is driven with each legacy name.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { limitsTierFor, TIER_LIMITS } from "@shared/billing/tier-limits";

const LEGACY = [
  ["solo", "starter"],
  ["operator", "pro"],
  ["empire", "scale"],
] as const;

const st = vi.hoisted(() => ({ tier: "free" }));

vi.mock("../../server/utils/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// server/db — creditPool (pool) and aiCostCeiling (ceilings).
vi.mock("../../server/db", async () => {
  const schema = await import("@shared/schema");
  const chain = (table: unknown) => {
    const rows = () =>
      table === schema.organizations
        ? [{ subscriptionTier: st.tier, isFounder: false, creditPoolGrandfather: null, creditPoolGrandfatherEndsAt: null }]
        : table === schema.aiCostCeilingOverrides
          ? []
          : [{ usedAbsCents: 0 }];
    const c: any = {
      where: () => c,
      limit: async () => rows(),
      then: (ok: (r: unknown[]) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(rows()).then(ok, bad),
    };
    return c;
  };
  return { db: { select: () => ({ from: (t: unknown) => chain(t) }) }, withTransaction: async (fn: any) => fn({}) };
});

// server/storage db — usageLimits (the AI allowance gate).
vi.mock("../../server/storage", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [{ subscriptionTier: st.tier, subscriptionStatus: "active", isFounder: false, trialEndsAt: null, cents: "0", total: 0 }],
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  },
}));
vi.mock("../../server/services/byok/aiByok", () => ({ getActiveAiByokChannel: async () => null }));

import { poolSnapshot } from "../../server/services/creditPool";
import { getEffectiveCeilings } from "../../server/services/aiCostCeiling";
import { checkAiTurnGate } from "../../server/services/usageLimits";

beforeEach(() => {
  st.tier = "free";
});

describe("the fold", () => {
  it.each(LEGACY)("%s → %s (any case)", (legacy, canonical) => {
    expect(limitsTierFor(legacy)).toBe(canonical);
    expect(limitsTierFor(legacy.toUpperCase())).toBe(canonical);
  });
  it("canonical names, enterprise and unknowns", () => {
    for (const t of ["free", "starter", "pro", "scale", "enterprise"] as const) expect(limitsTierFor(t)).toBe(t);
    expect(limitsTierFor("platinum")).toBe("free");
    expect(limitsTierFor(null)).toBe("free");
  });
});

describe.each(LEGACY)("a legacy '%s' org gets %s everywhere", (legacy, canonical) => {
  it("credit pool", async () => {
    st.tier = legacy;
    expect((await poolSnapshot(7)).poolMonthly).toBe(TIER_LIMITS[canonical].creditPool);
  });
  it("AI allowance", async () => {
    st.tier = legacy;
    const g = await checkAiTurnGate(7);
    expect(g.tier).toBe(canonical);
    expect(g.threshold).toBe(TIER_LIMITS[canonical].aiAllowanceCents);
  });
  it("cost ceilings", async () => {
    st.tier = legacy;
    const c = await getEffectiveCeilings(7);
    expect(c.source).toBe("tier_default");
    st.tier = canonical;
    const expected = await getEffectiveCeilings(7);
    expect(c).toEqual(expected);
  });
});
