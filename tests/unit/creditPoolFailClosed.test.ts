/**
 * Tier 1I — credit pool fail-CLOSED tests (2026-06-10).
 *
 * The elevation blueprint flagged that `poolDebit` always returned
 * `allowed: true` and failed OPEN on any error — a broken ledger silently
 * un-metered every paid lane while a heavy Pro user could run ~$180/mo of
 * AI COGS against $49 revenue. These tests lock in the corrected
 * semantics:
 *
 *   1. gate mode + debit ERROR        → allowed:false, reason "pool_debit_error"
 *   2. record mode + debit ERROR      → allowed:true (post-hoc COGS recorder)
 *   3. founder                        → bypass, never blocked, no ledger write
 *   4. active BYOK channel for action → bypass, byokBypassed:true, no ledger write
 *   5. pool already exhausted (gate)  → allowed:false, reason "pool_exhausted",
 *                                       no ledger write
 *   6. normal debit under pool        → allowed:true with ledger row
 *   7. poolRefusalDetails             → 429 payload shape incl. byokAvailable
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state knobs (reset per test) ──────────────────────────────────────
const state = {
  orgRow: { subscriptionTier: "pro", isFounder: false } as any,
  usedAbsCents: 0,
  byokActive: false,
  insertThrows: false,
  insertCalls: 0,
};

function mockModules() {
  vi.doMock("@shared/schema", () => ({
    financialLedger: {
      id: "fl.id",
      organizationId: "fl.org",
      category: "fl.category",
      feature: "fl.feature",
      amountCents: "fl.amount",
      postedAt: "fl.posted_at",
      externalEventId: "fl.external_event_id",
    },
    organizations: {
      id: "org.id",
      subscriptionTier: "org.tier",
      isFounder: "org.is_founder",
    },
  }));

  vi.doMock("drizzle-orm", () => ({
    and: (...args: any[]) => ({ op: "and", args }),
    eq: (a: any, b: any) => ({ op: "eq", a, b }),
    gte: (a: any, b: any) => ({ op: "gte", a, b }),
    inArray: (a: any, b: any) => ({ op: "inArray", a, b }),
    sql: Object.assign((strings: TemplateStringsArray, ..._vals: any[]) => ({ op: "sql", strings }), {
      raw: (s: string) => ({ op: "sql.raw", s }),
    }),
  }));

  vi.doMock("../../server/db", () => {
    // One thenable-with-.limit shape serves both query styles:
    //   fetchOrgTier:        select().from().where().limit(1)  → await
    //   poolUsageThisMonth:  select().from().where()           → await
    const rows = () => {
      const r = [{ ...state.orgRow, usedAbsCents: state.usedAbsCents }];
      const thenable: any = {
        limit: (_n: number) => Promise.resolve(r),
        then: (resolve: any, reject: any) => Promise.resolve(r).then(resolve, reject),
      };
      return thenable;
    };
    return {
      db: {
        select: () => ({ from: () => ({ where: () => rows() }) }),
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => ({
              returning: () => {
                state.insertCalls += 1;
                if (state.insertThrows) return Promise.reject(new Error("ledger down"));
                return Promise.resolve([{ id: 42 }]);
              },
            }),
          }),
        }),
      },
    };
  });

  vi.doMock("../../server/services/byok/toggle", () => ({
    isByokEnabled: async () => state.byokActive,
  }));

  vi.doMock("@shared/billing/credit-weights", () => ({
    creditCost: async () => 1.5, // ai_turn_avg weight — ceil(1.5) = 2¢/turn
  }));

  vi.doMock("../../server/utils/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));
}

async function importPool() {
  mockModules();
  return await import("../../server/services/creditPool");
}

beforeEach(() => {
  vi.resetModules();
  state.orgRow = { subscriptionTier: "pro", isFounder: false };
  state.usedAbsCents = 0;
  state.byokActive = false;
  state.insertThrows = false;
  state.insertCalls = 0;
});

describe("poolDebit — fail-CLOSED semantics (Tier 1I)", () => {
  it("gate mode FAILS CLOSED on a debit error for non-founder orgs", async () => {
    state.insertThrows = true;
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "ai_turn_avg",
      units: 1,
      externalEventId: "t:err:1",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("pool_debit_error");
    expect(r.debitedCents).toBe(0);
    expect(r.remaining).toBe(0);
  });

  it("record mode stays allowed on a debit error (post-hoc COGS recorder)", async () => {
    state.insertThrows = true;
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "parcel_lookup_paid",
      units: 1,
      externalEventId: "t:err:2",
      enforce: "record",
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("founder orgs bypass entirely — no ledger write, never blocked", async () => {
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 1,
      action: "ai_turn_avg",
      units: 1,
      externalEventId: "t:founder:1",
      isFounder: true,
    });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(Number.POSITIVE_INFINITY);
    expect(state.insertCalls).toBe(0);
  });

  it("active AI BYOK channel bypasses the pool — no ledger write", async () => {
    state.byokActive = true;
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "ai_turn_avg",
      units: 1,
      externalEventId: "t:byok:1",
    });
    expect(r.allowed).toBe(true);
    expect(r.byokBypassed).toBe(true);
    expect(r.debitedCents).toBe(0);
    expect(state.insertCalls).toBe(0);
  });

  it("refuses with pool_exhausted when the pool is already fully spent (gate mode, no write)", async () => {
    state.usedAbsCents = 2500; // pro pool = 2500 credits — fully spent
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "ai_turn_avg",
      units: 1,
      externalEventId: "t:exhausted:1",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("pool_exhausted");
    expect(r.overPool).toBe(true);
    expect(state.insertCalls).toBe(0);
  });

  it("normal under-pool debit is allowed and writes a ledger row", async () => {
    state.usedAbsCents = 100;
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "ai_turn_avg",
      units: 1,
      externalEventId: "t:ok:1",
    });
    expect(r.allowed).toBe(true);
    expect(r.debitedCents).toBe(2); // ceil(1.5¢)
    expect(r.ledgerRowId).toBe(42);
    expect(state.insertCalls).toBe(1);
  });
});

describe("poolRefusalDetails — the 429 payload shape", () => {
  it("AI turns advertise the BYOK escape hatch", async () => {
    const { poolRefusalDetails, byokAvailableForAction } = await importPool();
    expect(byokAvailableForAction("ai_turn_avg")).toBe(true);
    const details = poolRefusalDetails("ai_turn_avg", {
      allowed: false,
      debitedCents: 0,
      remaining: 0,
      poolMonthly: 2500,
      ledgerRowId: null,
      overPool: true,
      reason: "pool_exhausted",
    });
    expect(details.reason).toBe("pool_exhausted");
    expect(details.resourceType).toBe("credit_pool");
    expect(details.byokAvailable).toBe(true);
    expect(details.byokSettingsUrl).toBe("/settings/byok");
    expect(details.message.length).toBeGreaterThan(0);
  });

  it("paid data lookups (platform contracts) do NOT advertise BYOK", async () => {
    const { byokAvailableForAction } = await importPool();
    expect(byokAvailableForAction("parcel_lookup_paid")).toBe(false);
    expect(byokAvailableForAction("comps_lookup")).toBe(false);
  });
});
