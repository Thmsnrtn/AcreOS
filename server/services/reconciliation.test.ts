/**
 * REC-DEF-1 — reconciliation must never manufacture a divergence from
 * invoices it could not attribute.
 *
 * Defect (staging, 2026-11-19/20): fetchStripeMtdPaidTotal kept only paid
 * invoices whose Stripe customer resolved to an org. Two $49 sandbox
 * invoices whose customers did not resolve vanished silently, the Stripe
 * source total read $0 against $98/$99 on the AcreOS side, and the run
 * paged a false CRITICAL divergence. No real money was involved, but the
 * failure mode is environment-independent.
 *
 * Cure pinned here: unresolved-customer paid invoices are LOUD — counted
 * and totalled on the result and in the persisted run record — and any
 * unresolved amount makes the run `indeterminate` (source total is a
 * lower bound; no divergence assessed, no alert raised), never a silent
 * $0 divergence page. A fully-resolved genuine divergence still pages.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  stripeInvoices: [] as Array<{ id: string; customer: string | null; amount_paid: number }>,
  // customerId -> org id to resolve to; "THROW" simulates a resolver error.
  resolver: new Map<string, number | "THROW">(),
  selectQueue: [] as any[][],
  runRows: [] as any[],
  alerts: [] as any[],
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../utils/clock", () => ({
  clock: {
    now: () => new Date("2026-11-21T12:00:00.000Z"),
    nowMs: () => Date.parse("2026-11-21T12:00:00.000Z"),
  },
}));

vi.mock("../db", () => ({
  db: {
    select: (_projection?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_where: unknown) => Promise.resolve(H.selectQueue.shift() ?? []),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (v: unknown) => {
        H.runRows.push(v);
        return Promise.resolve();
      },
    }),
    update: (_table: unknown) => ({
      set: (_v: unknown) => ({ where: (_w: unknown) => Promise.resolve() }),
    }),
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getOrganizationByStripeCustomerId: async (customerId: string) => {
      const hit = H.resolver.get(customerId);
      if (hit === "THROW") throw new Error("resolver exploded");
      return hit ? { id: hit } : undefined;
    },
  },
}));

vi.mock("stripe", () => ({
  default: class MockStripe {
    invoices = {
      list: async () => ({ data: H.stripeInvoices, has_more: false }),
    };
  },
}));

vi.mock("./alertSpine", () => ({
  raiseAlert: async (a: unknown) => {
    H.alerts.push(a);
  },
}));

import { runReconciliation } from "./reconciliation";

const LEDGER_RULE = {
  id: "rule-ledger",
  sourceSystem: "stripe",
  entityType: "invoice",
  aggregationKey: "mtd_paid_ledger",
  toleranceDollars: "1.00",
  enabled: true,
};

/** Queue the two SELECTs one ledger-rule run performs: rules, then the AcreOS sum (cents as string). */
function primeRun(acreosSumCents: string) {
  H.selectQueue.push([LEDGER_RULE], [{ sum: acreosSumCents }]);
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic";
  H.stripeInvoices = [];
  H.resolver = new Map([["cus_ok", 107]]);
  H.selectQueue = [];
  H.runRows = [];
  H.alerts = [];
});

describe("REC-DEF-1: unresolved-customer Stripe invoices", () => {
  it("acceptance: synthetic unresolved-customer invoices make the run indeterminate — never a silent $0 divergence page", async () => {
    // The staging shape, synthetically: one resolved $99 invoice matching
    // the AcreOS side, plus two $49 invoices whose customer does not
    // resolve to any org (the sandbox fixtures that paged $0 vs $98/$99).
    H.stripeInvoices = [
      { id: "in_ok", customer: "cus_ok", amount_paid: 9900 },
      { id: "in_ghost_1", customer: "cus_ghost", amount_paid: 4900 },
      { id: "in_ghost_2", customer: "cus_ghost", amount_paid: 4900 },
    ];
    primeRun("9900"); // AcreOS ledger total $99.00

    const [result] = await runReconciliation();

    expect(result.status).toBe("indeterminate");
    // The resolved source total is reported as itself — not $0 (the old
    // silent collapse) and not $197 (unresolved money is never folded in).
    expect(result.sourceTotal).toBe(99);
    expect(result.unresolvedCount).toBe(2);
    expect(result.unresolvedCents).toBe(9800);
    // No difference is persisted for a lower-bound comparison.
    expect(result.differenceDollars).toBeNull();
    // Exclude-and-report: the run record itself explains the exclusion.
    expect(H.runRows).toHaveLength(1);
    expect(H.runRows[0].status).toBe("indeterminate");
    expect(H.runRows[0].errorMessage).toContain("2 paid Stripe invoice(s)");
    expect(H.runRows[0].errorMessage).toContain("$98.00");
    expect(H.runRows[0].errorMessage).toContain("EXCLUDED");
    // And crucially: no divergence page.
    expect(H.alerts).toHaveLength(0);
  });

  it("a resolver ERROR (not just a missing org) is also unresolved, not silently excluded", async () => {
    H.resolver.set("cus_boom", "THROW");
    H.stripeInvoices = [
      { id: "in_ok", customer: "cus_ok", amount_paid: 9900 },
      { id: "in_boom", customer: "cus_boom", amount_paid: 4900 },
    ];
    primeRun("9900");

    const [result] = await runReconciliation();

    expect(result.status).toBe("indeterminate");
    expect(result.unresolvedCount).toBe(1);
    expect(result.unresolvedCents).toBe(4900);
    expect(H.alerts).toHaveLength(0);
  });

  it("an invoice with no customer at all counts as unresolved", async () => {
    H.stripeInvoices = [
      { id: "in_ok", customer: "cus_ok", amount_paid: 9900 },
      { id: "in_anon", customer: null, amount_paid: 2500 },
    ];
    primeRun("9900");

    const [result] = await runReconciliation();

    expect(result.status).toBe("indeterminate");
    expect(result.unresolvedCents).toBe(2500);
  });

  it("zero-amount unresolved invoices are reported but do not block a clean verdict", async () => {
    H.stripeInvoices = [
      { id: "in_ok", customer: "cus_ok", amount_paid: 9900 },
      { id: "in_ghost_zero", customer: "cus_ghost", amount_paid: 0 },
    ];
    primeRun("9900");

    const [result] = await runReconciliation();

    expect(result.status).toBe("ok");
    expect(result.unresolvedCount).toBe(1);
    expect(result.unresolvedCents).toBe(0);
    expect(H.alerts).toHaveLength(0);
  });

  it("fully resolved and matching: ok", async () => {
    H.stripeInvoices = [{ id: "in_ok", customer: "cus_ok", amount_paid: 9900 }];
    primeRun("9900");

    const [result] = await runReconciliation();

    expect(result.status).toBe("ok");
    expect(result.unresolvedCount).toBe(0);
    expect(result.differenceDollars).toBe(0);
    expect(H.runRows[0].status).toBe("ok");
    expect(H.alerts).toHaveLength(0);
  });

  it("fully resolved genuine divergence still pages CRITICAL on the ledger rule (Tier 2B intact)", async () => {
    H.stripeInvoices = [{ id: "in_ok", customer: "cus_ok", amount_paid: 5000 }];
    primeRun("9900"); // Stripe collected $50, the spine shows $99

    const [result] = await runReconciliation();

    expect(result.status).toBe("divergent");
    expect(result.unresolvedCents).toBe(0);
    expect(H.alerts).toHaveLength(1);
    expect(H.alerts[0].severity).toBe("critical");
    expect(H.alerts[0].alertType).toBe("reconciliation_divergent");
  });
});
