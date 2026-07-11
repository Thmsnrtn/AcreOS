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
 *
 * W1.8 (2026-07 audit) — the gate is now a single atomic conditional
 * INSERT (db.execute) instead of SELECT-then-INSERT, and BYOK lookup
 * failures refuse instead of silently drawing the pool:
 *
 *   8. gate + zero rows + existing externalEventId row → idempotent replay,
 *      allowed:true with zero debit
 *   9. BYOK lookup error (gate)   → allowed:false, "pool_debit_error",
 *      never guesses the payer, no ledger write
 *  10. BYOK lookup error (record) → proceeds, COGS row still recorded
 *
 * Track A (2026-07) — refundPoolDebit reversal semantics: positive row keyed
 * `${originalEventId}:refund`, onConflictDoNothing idempotency on the
 * external_event_id unique index, silent no-op on junk amounts, never throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state knobs (reset per test) ──────────────────────────────────────
const state = {
  orgRow: { subscriptionTier: "pro", isFounder: false } as any,
  usedAbsCents: 0,
  byokActive: false,
  byokThrows: false,
  insertThrows: false,
  insertCalls: 0,
  /** Simulates a pre-existing financial_ledger row for the externalEventId
   *  (the idempotent-replay disambiguation SELECT in the atomic gate). */
  replayRowExists: false,
  /** Purchased-credit overflow (S1c): does creditBalance cover the debit? */
  purchasedCreditsCover: false,
  deductCalls: 0,
  /** Rows passed to db.insert(...).values(...) — refund-shape assertions. */
  insertedValues: [] as any[],
  /** `target` passed to onConflictDoNothing — pins the idempotency column. */
  conflictTargets: [] as any[],
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
      // The atomic gate builds its feature filter with sql.join (the raw
      // `= ANY(${arr})` form binds a record param Postgres rejects).
      join: (chunks: unknown[], sep: unknown) => ({ op: "sql.join", chunks, sep }),
    }),
  }));

  vi.doMock("../../server/db", () => {
    // One thenable-with-.limit shape serves all three select styles. The
    // projection keys tell us which caller we're serving:
    //   fetchOrgTier:        select({subscriptionTier,...}) → org row
    //   poolUsageThisMonth:  select({usedAbsCents})         → usage agg
    //   gate replay check:   select({id})                   → ledger-by-eventId
    const rows = (projection?: Record<string, unknown>) => {
      let r: any[];
      if (projection && "id" in projection && Object.keys(projection).length === 1) {
        r = state.replayRowExists ? [{ id: 42 }] : [];
      } else {
        r = [{ ...state.orgRow, usedAbsCents: state.usedAbsCents }];
      }
      const thenable: any = {
        limit: (_n: number) => Promise.resolve(r),
        then: (resolve: any, reject: any) => Promise.resolve(r).then(resolve, reject),
      };
      return thenable;
    };
    return {
      db: {
        select: (projection?: Record<string, unknown>) => ({
          from: () => ({ where: () => rows(projection) }),
        }),
        // W1.8 atomic gate — INSERT ... SELECT ... WHERE used < pool.
        // Mirrors Postgres: throws on ledger failure, inserts nothing when
        // the pool is spent, returns the new row id otherwise.
        execute: (_q: unknown) => {
          if (state.insertThrows) return Promise.reject(new Error("ledger down"));
          const poolMonthly = 2500; // pro tier in TIER_LIMITS
          if (state.usedAbsCents >= poolMonthly || state.replayRowExists) {
            return Promise.resolve({ rows: [] });
          }
          state.insertCalls += 1;
          return Promise.resolve({ rows: [{ id: 42 }] });
        },
        insert: () => ({
          values: (v: any) => ({
            // Two call shapes share this chain: the record-mode debit awaits
            // .onConflictDoNothing().returning(), while refundPoolDebit
            // awaits .onConflictDoNothing({target}) DIRECTLY — so the return
            // must be a thenable that also carries .returning().
            onConflictDoNothing: (conflictOpts?: { target?: unknown }) => {
              const chain: any = {
                returning: () => {
                  state.insertCalls += 1;
                  if (state.insertThrows) return Promise.reject(new Error("ledger down"));
                  return Promise.resolve([{ id: 42 }]);
                },
                then: (resolve: any, reject: any) => {
                  if (state.insertThrows) {
                    return Promise.reject(new Error("ledger down")).then(resolve, reject);
                  }
                  state.insertCalls += 1;
                  state.insertedValues.push(v);
                  state.conflictTargets.push(conflictOpts?.target);
                  return Promise.resolve().then(resolve, reject);
                },
              };
              return chain;
            },
          }),
        }),
      },
    };
  });

  // S1c purchased-credit overflow — poolDebit dynamic-imports this on a
  // gate refusal to try the org's purchased creditBalance before refusing.
  vi.doMock("../../server/services/credits", () => ({
    creditService: {
      deductCredits: async () => {
        state.deductCalls += 1;
        return state.purchasedCreditsCover ? { id: 9 } : null;
      },
    },
  }));

  vi.doMock("../../server/services/byok/toggle", () => ({
    isByokEnabled: async () => {
      if (state.byokThrows) throw new Error("byok lookup down");
      return state.byokActive;
    },
  }));

  // Tier 1C moved creditCost out of shared/ into server/services/creditCost
  // (it reaches into server settings). Mock the server module — creditPool
  // imports it from there now.
  vi.doMock("../../server/services/creditCost", () => ({
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
  state.byokThrows = false;
  state.insertThrows = false;
  state.insertCalls = 0;
  state.replayRowExists = false;
  state.purchasedCreditsCover = false;
  state.deductCalls = 0;
  state.insertedValues = [];
  state.conflictTargets = [];
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
    // S1c: the purchased-credit overflow lane was TRIED before refusing.
    expect(state.deductCalls).toBe(1);
  });

  it("pool exhausted + purchased credits cover it → allowed, fundedBy purchased_credits, COGS row written", async () => {
    // S1c — the two credit ledgers finally reconcile: a customer who bought a
    // credit pack is no longer blocked by the exhausted monthly pool.
    state.usedAbsCents = 2500;
    state.purchasedCreditsCover = true;
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "ai_turn_avg",
      units: 1,
      externalEventId: "t:overflow:1",
    });
    expect(r.allowed).toBe(true);
    expect(r.fundedBy).toBe("purchased_credits");
    expect(r.overPool).toBe(true);
    expect(r.debitedCents).toBe(2);
    expect(state.deductCalls).toBe(1);
    expect(state.insertCalls).toBe(1); // opex row still recorded — COGS stays honest
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

describe("poolDebit — W1.8 atomic gate + BYOK payer integrity", () => {
  it("zero rows from the gate + an existing eventId row = idempotent replay, not a refusal", async () => {
    state.usedAbsCents = 100;
    state.replayRowExists = true; // retry of an already-debited externalEventId
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "ai_turn_avg",
      units: 1,
      externalEventId: "t:replay:1",
    });
    expect(r.allowed).toBe(true);
    expect(r.debitedCents).toBe(0); // no new spend on a replay
    expect(r.reason).toBeUndefined();
    expect(state.insertCalls).toBe(0);
  });

  it("BYOK lookup failure in gate mode refuses — never guesses the payer", async () => {
    state.byokThrows = true;
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "ai_turn_avg", // has BYOK channels → lookup runs
      units: 1,
      externalEventId: "t:byokerr:1",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("pool_debit_error");
    expect(state.insertCalls).toBe(0); // the pool was NOT silently drawn
  });

  it("BYOK lookup failure in record mode still records the COGS row", async () => {
    state.byokThrows = true;
    const { poolDebit } = await importPool();
    const r = await poolDebit({
      organizationId: 7,
      action: "sms_outbound", // BYOK-capable, but the spend already happened
      units: 1,
      externalEventId: "t:byokerr:2",
      enforce: "record",
    });
    expect(r.allowed).toBe(true);
    expect(state.insertCalls).toBe(1); // ledger stays honest
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
    // S1c: the refusal now advertises the credit-pack purchase path too.
    expect(details.purchaseAvailable).toBe(true);
    expect(details.purchaseUrl).toBe("/usage");
    expect(details.message.length).toBeGreaterThan(0);
  });

  it("paid data lookups (platform contracts) do NOT advertise BYOK", async () => {
    const { byokAvailableForAction } = await importPool();
    expect(byokAvailableForAction("parcel_lookup_paid")).toBe(false);
    expect(byokAvailableForAction("comps_lookup")).toBe(false);
  });
});

describe("refundPoolDebit — Track A reversal semantics", () => {
  // Callers (mail queue, mailFlusher) refund AFTER a provider submit fails
  // mid-flight: the reversal must restore the pool balance (positive row),
  // collapse on retries (unique externalEventId), and NEVER add a second
  // failure to an already-failing request path.

  it("writes a POSITIVE reversal row keyed `${originalEventId}:refund`", async () => {
    const { refundPoolDebit } = await importPool();
    await refundPoolDebit({
      organizationId: 7,
      originalEventId: "mail:queue:abc",
      amountCents: 150,
      reason: "postgrid submit failed",
    });
    expect(state.insertedValues).toHaveLength(1);
    expect(state.insertedValues[0]).toMatchObject({
      organizationId: 7,
      bucket: "opex_available",
      category: "opex_spent",
      amountCents: 150, // positive — reverses the negative debit on the gauge SUM
      feature: "refund",
      externalEventId: "mail:queue:abc:refund",
      postedBy: "system:credit-pool:refund",
      notes: "postgrid submit failed",
    });
    expect(state.insertedValues[0].amountCents).toBeGreaterThan(0);
  });

  it("retry-idempotency is wired through onConflictDoNothing on externalEventId", async () => {
    const { refundPoolDebit } = await importPool();
    await refundPoolDebit({
      organizationId: 7,
      originalEventId: "mail:queue:abc",
      amountCents: 150,
      reason: "retry",
    });
    // The unique index on external_event_id is what makes a double refund a
    // no-op in Postgres — pin that the conflict target is exactly that column.
    expect(state.conflictTargets).toEqual(["fl.external_event_id"]);
  });

  it("non-positive or non-finite amounts are a silent no-op (no ledger write)", async () => {
    const { refundPoolDebit } = await importPool();
    for (const amountCents of [0, -25, NaN, Number.POSITIVE_INFINITY]) {
      await refundPoolDebit({
        organizationId: 7,
        originalEventId: "mail:queue:bad",
        amountCents,
        reason: "bogus amount",
      });
    }
    expect(state.insertedValues).toHaveLength(0);
    expect(state.insertCalls).toBe(0);
  });

  it("NEVER throws — a ledger failure is swallowed (logged), the caller's original error stays primary", async () => {
    state.insertThrows = true;
    const { refundPoolDebit } = await importPool();
    await expect(
      refundPoolDebit({
        organizationId: 7,
        originalEventId: "mail:queue:down",
        amountCents: 150,
        reason: "ledger down during refund",
      }),
    ).resolves.toBeUndefined();
  });
});
