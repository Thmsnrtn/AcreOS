/**
 * Founder decisions of 2026-10-08 (docs/company/founder-decisions-2026-10-08.md)
 * — pinned as behaviour, each falsifiable by putting the old value back.
 *
 *   A. Scale's included credit pool is 3,000 for NEW Scale customers; orgs
 *      already on Scale keep 8,000 until their next renewal, recorded per org
 *      (credit_pool_grandfathers) and resolved through ONE function.
 *   B. Top-up packs sell at 1.5¢ per credit: same prices, fewer credits,
 *      rounded down — $10 → 666, $25 → 1,666, $50 → 3,333, $100 → 6,666.
 *   C. One shared monthly AI allowance per plan, in CENTS (turn threshold ×
 *      1.5¢). Every customer-triggered AI feature draws from it; past it the
 *      org's own key serves the call or it is refused recoverably; background
 *      work the org did not trigger never counts and is never walled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TIER_LIMITS, AI_TURNS_BYOK_THRESHOLDS, AI_ALLOWANCE_CENTS, AI_TURN_COST_CENTS } from "@shared/billing/tier-limits";
import { CREDIT_PACK_CATALOG, creditsForPackPrice, CREDIT_PRICE_CENTS } from "@shared/billing/credit-packs";
import { CREDIT_PACKS } from "@shared/schema";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ── A. Scale credit pool ─────────────────────────────────────────────────────

const poolDb = vi.hoisted(() => ({
  grandfatherRows: [] as unknown[],
  throwOnGrandfather: false,
  grandfatherReads: 0,
}));

vi.mock("../../server/db", async () => {
  const schema = await import("@shared/schema");
  const chain = (table: unknown) => {
    const c: any = {
      where: () => c,
      limit: async () => {
        if (table === schema.creditPoolGrandfathers) {
          poolDb.grandfatherReads++;
          if (poolDb.throwOnGrandfather) throw new Error("db down");
          return poolDb.grandfatherRows;
        }
        return [];
      },
    };
    return c;
  };
  return {
    db: { select: () => ({ from: (t: unknown) => chain(t) }) },
    withTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
  };
});
vi.mock("../../server/utils/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { resolveCreditPool, GRANDFATHERED_POOL_TIERS } from "../../server/services/creditPool";

describe("A — Scale's credit pool: 3,000 for new customers, 8,000 grandfathered to renewal", () => {
  beforeEach(() => {
    poolDb.grandfatherRows = [];
    poolDb.throwOnGrandfather = false;
    poolDb.grandfatherReads = 0;
  });

  it("the tier pool is 3,000 (other tiers unchanged)", () => {
    expect(TIER_LIMITS.scale.creditPool).toBe(3000);
    expect(TIER_LIMITS.starter.creditPool).toBe(750);
    expect(TIER_LIMITS.pro.creditPool).toBe(2500);
  });

  it("a NEW Scale org (no grandfather row) gets 3,000", async () => {
    expect((await resolveCreditPool(7, "scale")).poolMonthly).toBe(3000);
  });

  it("an existing Scale org keeps 8,000 while its grandfather is in force (end unknown or future)", async () => {
    poolDb.grandfatherRows = [{ creditPool: 8000, endsAt: null }];
    expect(await resolveCreditPool(7, "scale")).toMatchObject({ poolMonthly: 8000, grandfathered: true });
    poolDb.grandfatherRows = [{ creditPool: 8000, endsAt: new Date(Date.now() + 86_400_000) }];
    expect((await resolveCreditPool(7, "scale")).poolMonthly).toBe(8000);
  });

  it("after the renewal the org is on 3,000", async () => {
    poolDb.grandfatherRows = [{ creditPool: 8000, endsAt: new Date(Date.now() - 1000) }];
    expect(await resolveCreditPool(7, "scale")).toMatchObject({ poolMonthly: 3000, grandfathered: false });
  });

  it("a grandfather read failure resolves to the CURRENT tier pool, never the larger one", async () => {
    poolDb.throwOnGrandfather = true;
    expect((await resolveCreditPool(7, "scale")).poolMonthly).toBe(3000);
  });

  it("a grandfather applies only while the org is on the grandfathered tier", async () => {
    poolDb.grandfatherRows = [{ creditPool: 8000, endsAt: null }];
    expect((await resolveCreditPool(7, "pro")).poolMonthly).toBe(2500);
    expect(poolDb.grandfatherReads).toBe(0);
    expect([...GRANDFATHERED_POOL_TIERS]).toEqual(["scale"]);
  });

  it("every pool read in creditPool.ts goes through the resolver (no direct TIER_LIMITS[tier].creditPool)", () => {
    const code = stripComments(read("server/services/creditPool.ts"));
    const direct = code.match(/TIER_LIMITS\[tier\]\.creditPool/g) ?? [];
    // Exactly one: the resolver's own tier fallback.
    expect(direct).toHaveLength(1);
    expect(code).toMatch(/const tierPool = TIER_LIMITS\[tier\]\.creditPool;/);
  });

  it("the customer-visible pricing table reads the canonical tier limit", () => {
    const pricing = stripComments(read("client/src/pages/pricing.tsx"));
    expect(pricing).toContain("TIER_LIMITS.scale.creditPool");
    expect(pricing).not.toMatch(/\b8,?000\b/);
  });

  it("the backfill grandfathers EXISTING Scale orgs once — guarded against re-running on later deploys", () => {
    for (const f of ["migrations/0266_scale_credit_pool_grandfather.sql", "scripts/migrate.mjs"]) {
      const src = read(f);
      const i = src.indexOf("scale_credit_pool_2026_10_08");
      expect(i, `${f}: one-time guard key missing`).toBeGreaterThan(-1);
      expect(src).toMatch(/IF NOT EXISTS \(SELECT 1 FROM "billing_one_time_backfills" WHERE "key" = 'scale_credit_pool_2026_10_08'\)/);
      expect(src).toMatch(/SELECT "id", 8000, NULL/);
    }
  });
});

// ── B. Credit packs at 1.5¢ per credit ───────────────────────────────────────

describe("B — top-up packs: same prices, 1.5¢ per credit, rounded down", () => {
  it("grants exactly the decided counts", () => {
    expect(CREDIT_PRICE_CENTS).toBe(1.5);
    expect(CREDIT_PACK_CATALOG.pack_10).toMatchObject({ priceCents: 1000, credits: 666 });
    expect(CREDIT_PACK_CATALOG.pack_25).toMatchObject({ priceCents: 2500, credits: 1666 });
    expect(CREDIT_PACK_CATALOG.pack_50).toMatchObject({ priceCents: 5000, credits: 3333 });
    expect(CREDIT_PACK_CATALOG.pack_100).toMatchObject({ priceCents: 10000, credits: 6666 });
  });

  it("the webhook grant table (schema CREDIT_PACKS) IS the catalogue — prices unchanged", () => {
    for (const id of ["pack_10", "pack_25", "pack_50", "pack_100"] as const) {
      expect(CREDIT_PACKS[id].amountCents).toBe(CREDIT_PACK_CATALOG[id].credits);
      expect(CREDIT_PACKS[id].priceCents).toBe(CREDIT_PACK_CATALOG[id].priceCents);
    }
    expect([CREDIT_PACKS.pack_10.priceCents, CREDIT_PACKS.pack_25.priceCents, CREDIT_PACKS.pack_50.priceCents, CREDIT_PACKS.pack_100.priceCents]).toEqual([1000, 2500, 5000, 10000]);
  });

  it("never promises a credit the money doesn't cover, and never shorts a whole one", () => {
    for (let price = 1; price <= 30000; price += 7) {
      const c = creditsForPackPrice(price);
      expect(c * 1.5).toBeLessThanOrEqual(price);
      expect((c + 1) * 1.5).toBeGreaterThan(price);
    }
  });

  it("the purchase modal and the mail recharge cards read the canonical rule", () => {
    const modal = stripComments(read("client/src/components/credit-purchase-modal.tsx"));
    expect(modal).toContain("CREDIT_PACK_CATALOG");
    expect(modal).not.toMatch(/credits:\s*\d/);
    const mail = stripComments(read("client/src/pages/outreach/mail/credits.tsx"));
    expect(mail).toContain("creditsForPackPrice(");
    expect(mail).not.toMatch(/~?\d{1,2},\d{3} credits/);
  });
});

// ── C. One shared monthly AI allowance, in cents ─────────────────────────────

describe("C — the allowance is each plan's turn threshold priced at 1.5¢", () => {
  it("derives starter 1,125¢ · pro 2,250¢ · scale 9,000¢ · free/enterprise none", () => {
    expect(AI_TURN_COST_CENTS).toBe(1.5);
    expect(AI_ALLOWANCE_CENTS).toEqual({ free: null, starter: 1125, pro: 2250, scale: 9000, enterprise: null });
    for (const t of ["free", "starter", "pro", "scale", "enterprise"] as const) {
      const th = AI_TURNS_BYOK_THRESHOLDS[t];
      expect(AI_ALLOWANCE_CENTS[t]).toBe(th === null ? null : Math.floor(th * 1.5));
      expect(TIER_LIMITS[t].aiAllowanceCents).toBe(AI_ALLOWANCE_CENTS[t]);
    }
  });
});
