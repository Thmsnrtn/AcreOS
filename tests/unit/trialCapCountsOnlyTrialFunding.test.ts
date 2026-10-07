/**
 * The FRAUD-011 trial cap counts only what the TRIAL paid for.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * During a trial, `hasEnoughCredits` ignored the balance and summed every
 * "debit" credit transaction since the trial began against a $5 cap. A debit
 * row is only written when the org's OWN balance covers the charge — so the
 * cap counted exactly the credits the customer had BOUGHT. After spending $5 of
 * their own credit, a trial customer with a healthy balance was refused, and
 * Pax (which gates on `hasEnoughCredits`) locked.
 *
 * ── THE RULE NOW ────────────────────────────────────────────────────────────
 *  - the org's own balance pays first and is never capped by the trial;
 *  - when it cannot pay, an active trial's free allowance pays, up to $5, and
 *    that usage is RECORDED (usage_records, metadata.fundedBy =
 *    "trial_allowance") — the only thing the cap sums.
 *
 * The cap's WHERE is rendered to SQL and checked for the fundedBy predicate;
 * the rest drive the service against a mocked db whose aggregate answers BOTH the old and the
 * new projection with the same number, so the old implementation sees the same
 * world and goes red on the first case.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { usageRecords } from "@shared/schema";

const S = vi.hoisted(() => ({
  org: {} as Record<string, unknown>,
  /** What the cap aggregate reports — trial-funded cents (new) / debit cents (old). */
  capSum: 0,
  balance: 0,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  aggregateTables: [] as unknown[],
  aggregateWheres: [] as unknown[],
}));

vi.mock("../../server/db", () => {
  const tx = {
    update: () => ({
      set: () => ({
        where: () => ({
          // Guarded deduct: no row when balance < amount.
          returning: async () => [] as unknown[],
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
  };
  return {
    db: {
      query: {
        organizations: { findFirst: async () => ({ ...S.org, creditBalance: String(S.balance) }) },
        usageRates: { findFirst: async () => ({ unitCostCents: 2 }) },
      },
      select: () => ({
        from: (t: unknown) => ({
          where: async (w: unknown) => (
            S.aggregateTables.push(t),
            S.aggregateWheres.push(w),
            [{ trialFundedCents: S.capSum, totalDebits: S.capSum }]
          ),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => (S.inserts.push({ table, values }), [{ id: 7, ...values }]),
        }),
      }),
    },
    withTransaction: async (fn: (t: unknown) => unknown) => fn(tx),
  };
});
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { creditService, usageMeteringService } from "../../server/services/credits";

const inTrial = () => ({ isFounder: false, trialEndsAt: new Date(Date.now() + 5 * 864e5).toISOString() });

beforeEach(() => {
  S.org = inTrial();
  S.capSum = 0;
  S.balance = 0;
  S.inserts = [];
  S.aggregateTables = [];
  S.aggregateWheres = [];
});

describe("hasEnoughCredits during a trial", () => {
  it("a customer's own balance pays even after $5 of their own credits were spent", async () => {
    S.balance = 2000; // $20 of purchased credit left
    S.capSum = 500; // the OLD query's view: $5 of (purchased) debits this trial
    expect(await creditService.hasEnoughCredits(7, 2)).toBe(true);
  });

  it("with no balance, the free trial allowance pays up to the $5 cap — a cent over refused", async () => {
    S.capSum = 498;
    expect(await creditService.hasEnoughCredits(7, 2)).toBe(true);
    S.capSum = 499;
    expect(await creditService.hasEnoughCredits(7, 2)).toBe(false);
  });

  it("the cap sums trial-funded USAGE, not credit-transaction debits", async () => {
    S.capSum = 0;
    await creditService.hasEnoughCredits(7, 2);
    expect(S.aggregateTables).toEqual([usageRecords]);
  });

  it("the cap's WHERE keeps only trial-funded rows of this org (no purchased-credit usage)", async () => {
    await creditService.hasEnoughCredits(7, 2);
    expect(S.aggregateWheres).toHaveLength(1);
    const q = new PgDialect().sqlToQuery(S.aggregateWheres[0] as SQL);
    // Rendered SQL, not source text: dropping the fundedBy predicate (so the
    // cap sums every usage row, purchased ones included) turns this red.
    expect(q.sql).toMatch(/"usage_records"\."metadata"->>'fundedBy' = \$\d+/);
    expect(q.params).toContain("trial_allowance");
    expect(q.sql).toMatch(/"usage_records"\."organization_id" = \$\d+/);
    expect(q.params).toContain(7);
  });

  it("outside a trial it is a plain balance check", async () => {
    S.org = { isFounder: false, trialEndsAt: null };
    S.balance = 1;
    expect(await creditService.hasEnoughCredits(7, 2)).toBe(false);
  });
});

describe("recordUsage records trial-funded usage so the cap can count it", () => {
  it("balance cannot pay, trial has room → recorded as trial_allowance, not insufficient", async () => {
    const r = await usageMeteringService.recordUsage(7, "ai_chat", 1, { feature: "pax" });
    expect(r.insufficientCredits).toBe(false);
    expect(r.deducted).toBe(false);
    expect(S.inserts).toEqual([
      expect.objectContaining({
        table: usageRecords,
        values: expect.objectContaining({
          totalCostCents: 2,
          metadata: expect.objectContaining({ feature: "pax", fundedBy: "trial_allowance" }),
        }),
      }),
    ]);
  });

  it("trial allowance used up → insufficient, nothing recorded", async () => {
    S.capSum = 500;
    const r = await usageMeteringService.recordUsage(7, "ai_chat", 1);
    expect(r.insufficientCredits).toBe(true);
    expect(S.inserts).toEqual([]);
  });

  it("no trial → insufficient, nothing recorded", async () => {
    S.org = { isFounder: false, trialEndsAt: null };
    const r = await usageMeteringService.recordUsage(7, "ai_chat", 1);
    expect(r.insufficientCredits).toBe(true);
    expect(S.inserts).toEqual([]);
  });
});
