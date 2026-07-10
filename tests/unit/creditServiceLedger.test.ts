/**
 * Track A — CreditService purchased-credit ledger contract.
 *
 * Every call site mocks these methods (webhook.test, stripeWebhooks.test,
 * the S1c pool-overflow lane), so until now the methods THEMSELVES had no
 * direct coverage. These are the semantics the mocks assume:
 *
 *   applyCreditPackPurchase (P1-SWEEP3-002)
 *     - unknown pack id throws (a webhook with junk metadata must not
 *       silently credit anything);
 *     - balance bump + "purchase" transaction row happen inside ONE
 *       withTransaction, row carries the REAL pack amount, the Stripe
 *       session/paymentIntent ids, and metadata.creditPackId;
 *     - a ledger-row insert failure PROPAGATES (withTransaction rolls the
 *       balance bump back — never balance-without-row).
 *
 *   deductCredits (S1c overflow lane depends on this)
 *     - the balance guard is the UPDATE's WHERE (balance >= amount): when
 *       no row matches, returns null and writes NO transaction row;
 *     - a successful deduct writes a NEGATIVE-amount "debit" row with the
 *       post-deduct balance;
 *     - founder orgs bypass: zero-amount row tagged founderBypass, no
 *       balance touch, no transaction wrapper.
 *
 *   applyMonthlyAllowance (DEFECT-0007)
 *     - the (organization_id, allowance_month) unique index is the
 *       double-grant lock: on conflict the balance bump is explicitly
 *       reversed inside the same transaction and the call returns null;
 *     - an unknown tier grants nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  founderRow: { isFounder: false } as any,
  /** rows returned by tx.update(...).returning() — the balance bump. */
  txUpdateRows: [{ newBalance: 5000 }] as any[],
  /** guarded deduct: the WHERE matched no row (insufficient balance). */
  txUpdateNoRow: false,
  txUpdateCalls: 0,
  txInsertValues: [] as any[],
  txInsertThrows: false,
  /** applyMonthlyAllowance: simulate the unique-index conflict (no row back). */
  allowanceConflict: false,
  txCount: 0,
  /** non-transactional db.insert rows (the founder-bypass debit). */
  dbInsertValues: [] as any[],
};

vi.mock("../../server/db", () => {
  const tx = {
    update: (_table: any) => {
      state.txUpdateCalls += 1;
      const rows = state.txUpdateNoRow ? [] : state.txUpdateRows;
      // Two call shapes: the balance bump awaits .returning(); the
      // DEFECT-0007 reversal awaits .where(...) directly — so the where()
      // result is a thenable that also carries .returning().
      const whereResult: any = {
        returning: (_projection?: any) => Promise.resolve(rows),
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
      };
      return { set: (_v: any) => ({ where: (_w: any) => whereResult }) };
    },
    insert: (_table: any) => ({
      values: (v: any) => {
        state.txInsertValues.push(v);
        return {
          returning: () =>
            state.txInsertThrows
              ? Promise.reject(new Error("ledger insert down"))
              : Promise.resolve([{ id: 1, ...v }]),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(state.allowanceConflict ? [] : [{ id: 1, ...v }]),
          }),
        };
      },
    }),
  };
  return {
    db: {
      query: {
        organizations: {
          findFirst: async () => state.founderRow,
        },
      },
      insert: (_table: any) => ({
        values: (v: any) => ({
          returning: () => {
            state.dbInsertValues.push(v);
            return Promise.resolve([{ id: 2, ...v }]);
          },
        }),
      }),
    },
    withTransaction: async (fn: (t: any) => Promise<any>) => {
      state.txCount += 1;
      return fn(tx);
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { creditService } from "../../server/services/credits";

beforeEach(() => {
  state.founderRow = { isFounder: false };
  state.txUpdateRows = [{ newBalance: 5000 }];
  state.txUpdateNoRow = false;
  state.txUpdateCalls = 0;
  state.txInsertValues = [];
  state.txInsertThrows = false;
  state.allowanceConflict = false;
  state.txCount = 0;
  state.dbInsertValues = [];
});

describe("applyCreditPackPurchase — one transaction, real pack amounts", () => {
  it("an unknown pack id throws — junk webhook metadata credits NOTHING", async () => {
    await expect(
      creditService.applyCreditPackPurchase(7, "pack_9999" as any, "cs_1"),
    ).rejects.toThrow(/Invalid credit pack/);
    expect(state.txCount).toBe(0);
    expect(state.txInsertValues).toHaveLength(0);
  });

  it("credits the REAL pack amount and writes the purchase row in one transaction", async () => {
    const row = await creditService.applyCreditPackPurchase(7, "pack_25", "cs_1", "pi_1");
    expect(state.txCount).toBe(1);
    expect(state.txUpdateCalls).toBe(1); // the balance bump
    expect(state.txInsertValues).toHaveLength(1);
    expect(state.txInsertValues[0]).toMatchObject({
      organizationId: 7,
      type: "purchase",
      amountCents: 2500, // pack_25 from the REAL CREDIT_PACKS table — not a guess
      balanceAfterCents: 5000, // the post-bump balance the UPDATE returned
      stripeCheckoutSessionId: "cs_1",
      stripePaymentIntentId: "pi_1",
      metadata: { creditPackId: "pack_25" },
    });
    expect(row).toMatchObject({ type: "purchase", amountCents: 2500 });
  });

  it("a ledger-row insert failure PROPAGATES so the transaction rolls the balance back", async () => {
    state.txInsertThrows = true;
    await expect(
      creditService.applyCreditPackPurchase(7, "pack_10", "cs_2"),
    ).rejects.toThrow("ledger insert down");
    // The whole point of P1-SWEEP3-002: never balance-without-row. The
    // error must reach withTransaction (rollback), not be swallowed.
  });
});

describe("deductCredits — the WHERE-guarded debit the overflow lane relies on", () => {
  it("insufficient balance → null, and NO transaction row is written", async () => {
    state.txUpdateNoRow = true; // WHERE balance >= amount matched nothing
    const result = await creditService.deductCredits(7, 300, "postcard overflow");
    expect(result).toBeNull();
    expect(state.txInsertValues).toHaveLength(0);
  });

  it("a successful deduct writes a NEGATIVE debit row with the post-deduct balance", async () => {
    const result = await creditService.deductCredits(7, 300, "postcard overflow");
    expect(result).toMatchObject({ type: "debit", amountCents: -300, balanceAfterCents: 5000 });
    expect(state.txCount).toBe(1);
  });

  it("founder orgs bypass — zero-amount row tagged founderBypass, no balance touch", async () => {
    state.founderRow = { isFounder: true };
    const result = await creditService.deductCredits(1, 300, "founder action");
    expect(result).toMatchObject({ amountCents: 0, balanceAfterCents: 999999999 });
    expect(state.dbInsertValues[0].metadata).toMatchObject({ founderBypass: true });
    expect(state.dbInsertValues[0].description).toContain("[Founder]");
    expect(state.txCount).toBe(0); // never entered the guarded-debit transaction
    expect(state.txUpdateCalls).toBe(0);
  });
});

describe("applyMonthlyAllowance — DEFECT-0007 double-grant lock", () => {
  it("grants once: balance bump + allowance row keyed to the current month", async () => {
    const row = await creditService.applyMonthlyAllowance(7, "free");
    expect(row).not.toBeNull();
    expect(state.txUpdateCalls).toBe(1); // bump only — no reversal
    expect(state.txInsertValues[0]).toMatchObject({
      type: "monthly_allowance",
      amountCents: 100, // free tier's monthlyCredits from the REAL tier table
      allowanceMonth: new Date().toISOString().slice(0, 7),
    });
  });

  it("on the unique-index conflict, REVERSES the balance bump and returns null", async () => {
    state.allowanceConflict = true; // another instance already granted this month
    const row = await creditService.applyMonthlyAllowance(7, "free");
    expect(row).toBeNull();
    // Two updates inside the same transaction: the bump, then the explicit
    // reversal — the org must NOT keep a double allowance.
    expect(state.txUpdateCalls).toBe(2);
    expect(state.txCount).toBe(1);
  });

  it("an unknown tier grants nothing", async () => {
    const row = await creditService.applyMonthlyAllowance(7, "bogus" as any);
    expect(row).toBeNull();
    expect(state.txCount).toBe(0);
  });
});
