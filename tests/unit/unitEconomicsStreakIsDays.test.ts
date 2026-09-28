/**
 * DEFECT-0133 — unit economics: the unprofitable streak counts DAYS, MRR is
 * only a paying org's, and the margin says it is gross of Stripe fees.
 *
 * The streak read the latest snapshot by computedAt, which after the first
 * run of the day is TODAY's own row, so each recompute added a "day". MRR was
 * the tier list price whatever the subscription status. And the breakdown
 * claimed stripe_fee was "netted at the revenue level" when nothing netted it.
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

const alerts = vi.hoisted(() => ({ created: [] as unknown[] }));
vi.mock("../../server/storage", () => ({
  storage: { createSystemAlert: async (a: unknown) => { alerts.created.push(a); return a; } },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { organizations, financialLedger, customerUnitEconomics } from "@shared/schema";
import { computeUnitEconomicsForOrg, maybeEmitUnprofitableAlert } from "../../server/services/unitEconomics";

const ORG_ID = 42;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

function world(opts: { status: string; tier?: string; prev: { computedDate: string; consecutiveUnprofitableDays: number } | null; costCents: number }) {
  dbState.resolve = (table: unknown) => {
    if (table === financialLedger) return [{ category: "ai_tokens", feature: "pax_chat", totalCents: -opts.costCents, rowCount: 1 }];
    if (table === organizations) {
      return [{ id: ORG_ID, name: "Org", subscriptionTier: opts.tier ?? "pro", subscriptionStatus: opts.status, billingInterval: "monthly" }];
    }
    if (table === customerUnitEconomics) return opts.prev ? [opts.prev] : [];
    return [];
  };
}

beforeEach(() => {
  dbState.resolve = () => [];
});

describe("DEFECT-0133 — the unprofitable streak is days", () => {
  it("a second run today does not add a day", async () => {
    world({ status: "active", prev: { computedDate: today, consecutiveUnprofitableDays: 5 }, costCents: 10_000_000 });
    const r = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 1 });
    expect(r.profitMarginUsd).toBeLessThan(0);
    expect(r.consecutiveUnprofitableDays).not.toBe(6);
  });

  it("yesterday's streak extends by one", async () => {
    world({ status: "active", prev: { computedDate: daysAgo(1), consecutiveUnprofitableDays: 5 }, costCents: 10_000_000 });
    const r = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 1 });
    expect(r.consecutiveUnprofitableDays).toBe(6);
  });

  it("a gap in the days restarts the count", async () => {
    world({ status: "active", prev: { computedDate: daysAgo(4), consecutiveUnprofitableDays: 5 }, costCents: 10_000_000 });
    const r = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 1 });
    expect(r.consecutiveUnprofitableDays).toBe(1);
  });
});

describe("DEFECT-0133 — revenue is a paying org's only, and gross of Stripe fees", () => {
  it("a trialing org on a paid tier has no MRR", async () => {
    world({ status: "trialing", prev: null, costCents: 0 });
    const r = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 1 });
    expect(r.mrrUsd).toBe(0);
  });

  it("an active org on the same tier does", async () => {
    world({ status: "active", prev: null, costCents: 0 });
    const r = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 1 });
    expect(r.mrrUsd).toBeGreaterThan(0);
  });

  it("the breakdown does not claim Stripe fees were netted", async () => {
    world({ status: "active", prev: null, costCents: 0 });
    const r = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 1 });
    const notes = (r.breakdown.notes ?? []).join(" ");
    expect(notes).not.toMatch(/netted|excluded by design/);
    expect(notes).toMatch(/gross of Stripe processing fees/i);
  });
});

describe("DEFECT-0133 (audit) — only a paying customer is an unprofitable customer", () => {
  it("a trialing org with costs files no 'review pricing' alert", async () => {
    world({ status: "trialing", prev: { computedDate: daysAgo(1), consecutiveUnprofitableDays: 60 }, costCents: 10_000 });
    const r = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 1 });
    expect(r.mrrUsd).toBe(0);
    expect(r.consecutiveUnprofitableDays).toBeGreaterThan(30);
    alerts.created.length = 0;
    await expect(maybeEmitUnprofitableAlert(r)).resolves.toBe(false);
    expect(alerts.created).toHaveLength(0);
  });

  it("a paying org in the same state still files one (anchor)", async () => {
    world({ status: "active", prev: { computedDate: daysAgo(1), consecutiveUnprofitableDays: 60 }, costCents: 10_000_000 });
    const r = await computeUnitEconomicsForOrg(ORG_ID, { activeCustomerCount: 1 });
    alerts.created.length = 0;
    await expect(maybeEmitUnprofitableAlert(r)).resolves.toBe(true);
    expect(alerts.created).toHaveLength(1);
  });
});
