/**
 * reconciliationLedgerDivergence.test.ts — Tier 2B: Stripe reconciliation
 * against the financial_ledger money spine.
 *
 * Covers:
 *   - the mtd_paid_ledger rule compares Stripe MTD-paid invoices vs the sum
 *     of financial_ledger category='revenue' rows;
 *   - divergence beyond tolerance on the LEDGER rule raises a CRITICAL
 *     alert through the 1D spine regardless of dollar size (the other rules
 *     keep the $100 critical threshold);
 *   - within-tolerance runs stay quiet (status='ok', no alert);
 *   - ensureDefaultRules provisions BOTH Stripe rules (activation — the
 *     rules table was never seeded before, so the daily cron was a no-op).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  rules: [] as any[],
  ledgerSumCents: 0,
  runInserts: [] as any[],
  ruleInserts: [] as any[],
  stripeInvoices: [] as Array<{ id: string; amount_paid: number }>,
}));

vi.mock("../../server/db", () => {
  // Tables are matched lazily by drizzle table name to avoid import-order
  // games in the mock factory.
  function tableName(t: any): string {
    try {
      const sym = Object.getOwnPropertySymbols(t).find((s) => s.description === "drizzle:Name");
      return sym ? t[sym] : String(t);
    } catch {
      return String(t);
    }
  }
  function selectBuilder() {
    const b: any = {
      _table: undefined as any,
      from(t: any) { b._table = t; return b; },
      where() { return b; },
      then(onFulfilled: (rows: unknown[]) => unknown) {
        const name = tableName(b._table);
        if (name === "reconciliation_rules") return Promise.resolve(onFulfilled(state.rules));
        if (name === "financial_ledger") {
          return Promise.resolve(onFulfilled([{ sum: String(state.ledgerSumCents) }]));
        }
        return Promise.resolve(onFulfilled([]));
      },
    };
    return b;
  }
  return {
    db: {
      select: () => selectBuilder(),
      insert: (t: any) => ({
        values: (v: any) => {
          const name = tableName(t);
          const sink = name === "reconciliation_rules" ? state.ruleInserts : state.runInserts;
          const rows = Array.isArray(v) ? v : [v];
          const chain = {
            onConflictDoNothing: () => { sink.push(...rows); return Promise.resolve(); },
            then: (onFulfilled: (x: unknown) => unknown) => {
              sink.push(...rows);
              return Promise.resolve(onFulfilled(undefined));
            },
          };
          return chain;
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    withTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
  };
});

// Stripe SDK — paginated invoices.list.
vi.mock("stripe", () => ({
  default: class StripeMock {
    invoices = {
      list: vi.fn(async () => ({ data: state.stripeInvoices, has_more: false })),
    };
  },
}));

const raiseAlert = vi.hoisted(() => vi.fn(async () => ({ paged: true, findingRecorded: true, systemAlertWritten: true })));
vi.mock("../../server/services/alertSpine", () => ({ raiseAlert }));

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  runReconciliation,
  ensureDefaultRules,
  LEDGER_AGGREGATION_KEY,
} from "../../server/services/reconciliation";

const PRIOR_STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

function ledgerRule(overrides: Partial<any> = {}) {
  return {
    id: "rule-ledger-1",
    sourceSystem: "stripe",
    entityType: "invoice",
    aggregationKey: LEDGER_AGGREGATION_KEY,
    toleranceDollars: "1.00",
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  state.rules = [];
  state.ledgerSumCents = 0;
  state.runInserts = [];
  state.ruleInserts = [];
  state.stripeInvoices = [];
  raiseAlert.mockClear();
  // Dummy test-only value; never logged or asserted on by content.
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_unit_tests";
});

afterAll(() => {
  if (PRIOR_STRIPE_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = PRIOR_STRIPE_KEY;
});

describe("Stripe-truth vs financial_ledger reconciliation", () => {
  it("raises CRITICAL via the alert spine on beyond-tolerance divergence — even a small one", async () => {
    state.rules = [ledgerRule()];
    // Stripe truth: $49.00 collected. Ledger: only $46.50 landed (diff $2.50 —
    // under the old $100 critical threshold, but the ledger rule always pages).
    state.stripeInvoices = [{ id: "in_1", amount_paid: 4900 }];
    state.ledgerSumCents = 4650;

    const results = await runReconciliation();

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("divergent");
    expect(results[0].sourceTotal).toBe(49);
    expect(results[0].acreosTotal).toBe(46.5);
    expect(results[0].differenceDollars).toBeCloseTo(2.5, 6);

    // Run row persisted as divergent.
    expect(state.runInserts).toHaveLength(1);
    expect(state.runInserts[0].status).toBe("divergent");

    // CRITICAL through the 1D spine (critical pages the founder).
    expect(raiseAlert).toHaveBeenCalledTimes(1);
    const input = raiseAlert.mock.calls[0][0] as any;
    expect(input.severity).toBe("critical");
    expect(input.source).toBe("reconciliation");
    expect(input.domain).toBe("finance");
    expect(input.dedupeKey).toBe(`divergent:stripe:invoice:${LEDGER_AGGREGATION_KEY}`);
  });

  it("stays quiet when Stripe and the ledger agree within tolerance", async () => {
    state.rules = [ledgerRule()];
    state.stripeInvoices = [{ id: "in_1", amount_paid: 4900 }];
    state.ledgerSumCents = 4900; // exact match — every posting landed

    const results = await runReconciliation();

    expect(results[0].status).toBe("ok");
    expect(state.runInserts[0].status).toBe("ok");
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("records status=failing (no alert) when the Stripe credential is absent", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    state.rules = [ledgerRule()];
    state.ledgerSumCents = 4900;

    const results = await runReconciliation();

    expect(results[0].status).toBe("failing");
    expect(raiseAlert).not.toHaveBeenCalled();
  });
});

describe("ensureDefaultRules (activation)", () => {
  it("provisions both Stripe rules, including the money-spine rule", async () => {
    await ensureDefaultRules();
    const keys = state.ruleInserts.map((r) => r.aggregationKey).sort();
    expect(keys).toEqual(["mtd_paid", LEDGER_AGGREGATION_KEY].sort());
    for (const r of state.ruleInserts) {
      expect(r.sourceSystem).toBe("stripe");
      expect(r.enabled).toBe(true);
    }
  });
});
