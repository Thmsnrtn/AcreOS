/**
 * unitEconomicsFromLedger.test.ts — Tier 2B (one money spine).
 *
 * Asserts that customer unit economics is computed from `financial_ledger`
 * sums (the system of record) instead of the old parallel tables
 * (ai_usage_daily / mailing_orders / messages / skip_traces) and the old
 * hardcoded Twilio/SendGrid per-message rates:
 *
 *   - the category → output-column mapping (ai_tokens + voice → AI; mail /
 *     sms / email / skip_trace → their columns; stripe_fee never queried);
 *   - signed-cents handling (opex rows are negative; costs are abs);
 *   - smsCostUsd = actual ledger cents, NOT count × $0.0079;
 *   - the totalCogsUsd invariant (sum of the six cost columns) and the
 *     stable public shape of UnitEconomicsResult.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  // Set per-test: receives the drizzle table object a query selected FROM,
  // returns the rows the query should resolve to.
  resolve: (_table: unknown): unknown[] => [],
}));

vi.mock("../../server/db", () => {
  function builder() {
    const b: any = {
      _table: undefined as unknown,
      from(t: unknown) { b._table = t; return b; },
      where() { return b; },
      groupBy() { return b; },
      orderBy() { return b; },
      innerJoin() { return b; },
      limit() { return b; },
      then(onFulfilled: (rows: unknown[]) => unknown, onRejected?: (err: unknown) => unknown) {
        try {
          return Promise.resolve(onFulfilled(dbState.resolve(b._table)));
        } catch (err) {
          if (onRejected) return Promise.resolve(onRejected(err));
          return Promise.reject(err);
        }
      },
    };
    return b;
  }
  return {
    db: {
      select: () => builder(),
      insert: () => { throw new Error("insert not expected in these tests"); },
      execute: () => { throw new Error("execute not expected in these tests"); },
    },
    withTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
  };
});

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  organizations,
  financialLedger,
  customerUnitEconomics,
  FIXED_COST_INPUTS_USD_MONTHLY,
} from "@shared/schema";
import {
  ledgerCostsFor,
  computeUnitEconomicsForOrg,
} from "../../server/services/unitEconomics";

const ORG_ID = 42;

/** Grouped (category, feature, totalCents, rowCount) rows the ledger query returns. */
function setLedgerRows(rows: Array<{ category: string; feature: string | null; totalCents: number; rowCount: number }>) {
  dbState.resolve = (table: unknown) => {
    if (table === financialLedger) return rows;
    if (table === organizations) {
      return [{
        id: ORG_ID,
        name: "Test Org",
        subscriptionTier: "free",
        subscriptionStatus: "inactive",
        billingInterval: "monthly",
      }];
    }
    if (table === customerUnitEconomics) return []; // no previous snapshot
    return [];
  };
}

beforeEach(() => {
  dbState.resolve = () => [];
});

// ── ledgerCostsFor mapping ───────────────────────────────────────────────────

describe("ledgerCostsFor (financial_ledger is the one cost source)", () => {
  it("maps categories to the six cost columns and folds voice into AI", async () => {
    setLedgerRows([
      { category: "ai_tokens", feature: "pax_chat", totalCents: -1250, rowCount: 10 },
      { category: "ai_tokens", feature: "lead_scoring", totalCents: -750, rowCount: 5 },
      { category: "voice", feature: "voice", totalCents: -300, rowCount: 2 },
      { category: "mail", feature: "postcard_4x6", totalCents: -8400, rowCount: 12 },
      { category: "sms", feature: "sms", totalCents: -24, rowCount: 3 },
      { category: "email", feature: "email", totalCents: -2, rowCount: 20 },
      { category: "skip_trace", feature: "skip_trace", totalCents: -500, rowCount: 4 },
    ]);

    const r = await ledgerCostsFor(ORG_ID, new Date(Date.now() - 30 * 86_400_000));

    // AI = ai_tokens (12.50 + 7.50) + voice (3.00) = 23.00
    expect(r.aiCostUsd).toBe(23);
    expect(r.aiCallCount).toBe(17); // 10 + 5 + 2
    expect(r.aiByFeature.pax_chat).toEqual({ usd: 12.5, calls: 10 });
    expect(r.aiByFeature.lead_scoring).toEqual({ usd: 7.5, calls: 5 });
    expect(r.aiByFeature.voice).toEqual({ usd: 3, calls: 2 });

    expect(r.directMailCostUsd).toBe(84);
    expect(r.directMailPieces).toBe(12);
    expect(r.smsCostUsd).toBe(0.24);
    expect(r.smsCount).toBe(3);
    expect(r.emailCostUsd).toBe(0.02);
    expect(r.emailCount).toBe(20);
    expect(r.skipTraceCostUsd).toBe(5);
    expect(r.skipTraceCount).toBe(4);
  });

  it("uses actual ledger cents for SMS — not the old count × $0.0079 estimate", async () => {
    // 3 SMS at Twilio's real billed 8¢ each = -24 cents.
    setLedgerRows([{ category: "sms", feature: "sms", totalCents: -24, rowCount: 3 }]);
    const r = await ledgerCostsFor(ORG_ID, new Date());
    expect(r.smsCostUsd).toBe(0.24);
    // The pre-2B hardcoded estimate would have produced 3 × 0.0079:
    expect(r.smsCostUsd).not.toBeCloseTo(3 * 0.0079, 6);
  });

  it("returns all-zero rollup for an org with no ledger rows (e.g. BYOK)", async () => {
    setLedgerRows([]);
    const r = await ledgerCostsFor(ORG_ID, new Date());
    expect(r.aiCostUsd).toBe(0);
    expect(r.directMailCostUsd).toBe(0);
    expect(r.smsCostUsd).toBe(0);
    expect(r.emailCostUsd).toBe(0);
    expect(r.skipTraceCostUsd).toBe(0);
    expect(r.aiCallCount + r.smsCount + r.emailCount + r.directMailPieces + r.skipTraceCount).toBe(0);
  });
});

// ── computeUnitEconomicsForOrg shape + invariants ────────────────────────────

describe("computeUnitEconomicsForOrg (ledger-rebased)", () => {
  it("keeps the public shape and the totalCogs = Σ(six columns) invariant", async () => {
    setLedgerRows([
      { category: "ai_tokens", feature: "pax_chat", totalCents: -1000, rowCount: 8 },
      { category: "mail", feature: "letter_10", totalCents: -4200, rowCount: 6 },
      { category: "sms", feature: "sms", totalCents: -16, rowCount: 2 },
      { category: "skip_trace", feature: "skip_trace", totalCents: -250, rowCount: 2 },
    ]);

    const result = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 5 });

    // Stable public shape.
    expect(result.organizationId).toBe(ORG_ID);
    expect(result.windowDays).toBe(30);
    for (const key of [
      "mrrUsd", "aiCostUsd", "directMailCostUsd", "smsCostUsd", "emailCostUsd",
      "skipTraceCostUsd", "fixedCostShareUsd", "totalCogsUsd", "profitMarginUsd",
      "profitMarginPct", "aiCallCount", "smsCount", "emailCount",
      "directMailPieces", "skipTraceCount", "consecutiveUnprofitableDays",
    ] as const) {
      expect(result[key], key).toBeTypeOf("number");
    }
    expect(result.breakdown.aiByFeature).toBeDefined();
    expect(result.breakdown.fixedCostInputs?.flyMonthlyUsd).toBe(FIXED_COST_INPUTS_USD_MONTHLY.fly);

    // Ledger-sourced values.
    expect(result.aiCostUsd).toBe(10);
    expect(result.directMailCostUsd).toBe(42);
    expect(result.smsCostUsd).toBe(0.16);
    expect(result.emailCostUsd).toBe(0);
    expect(result.skipTraceCostUsd).toBe(2.5);

    // Free / inactive org: no fixed-cost share, zero MRR.
    expect(result.fixedCostShareUsd).toBe(0);
    expect(result.mrrUsd).toBe(0);

    // Invariant: totalCogs is recomputed from the six columns.
    const expectedCogs =
      result.aiCostUsd + result.directMailCostUsd + result.smsCostUsd +
      result.emailCostUsd + result.skipTraceCostUsd + result.fixedCostShareUsd;
    expect(result.totalCogsUsd).toBeCloseTo(expectedCogs, 6);
    expect(result.profitMarginUsd).toBeCloseTo(result.mrrUsd - result.totalCogsUsd, 6);

    // Unprofitable (0 MRR, positive costs) starts/extends the streak.
    expect(result.consecutiveUnprofitableDays).toBe(1);
  });
});
