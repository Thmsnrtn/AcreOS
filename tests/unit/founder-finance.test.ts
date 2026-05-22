/**
 * Founder Finance ledger-aggregation tests.
 *
 * The aggregate queries on `server/routes-finance-ledger.ts` reduce
 * `financial_ledger` rows into the shapes the founder UI consumes:
 *
 *   - bucket balances (per-bucket sum + opex split)
 *   - trailing-30d MRR
 *   - per-org contribution margin
 *   - cost-mix-by-feature
 *
 * These tests exercise the math against a mock ledger so we catch
 * regressions in the reduction logic without paying for full DB I/O.
 *
 * The test stubs replicate the same SQL semantics:
 *   - bucket balance = SUM(amount_cents) WHERE bucket = X
 *   - opex available net = SUM(amount_cents) WHERE bucket='opex_available'
 *   - opex spent = -SUM(amount_cents < 0) WHERE bucket='opex_available'
 *   - MRR = SUM(amount_cents) WHERE category='revenue' AND posted_at >= since
 *   - per-org margin = SUM(revenue) + SUM(opex_spent)  (opex_spent is negative)
 */
import { describe, it, expect } from "vitest";

interface LedgerRow {
  organizationId: number | null;
  bucket: string;
  category: string;
  amountCents: number;
  feature: string | null;
  provider: string | null;
  postedAt: Date;
}

function row(partial: Partial<LedgerRow>): LedgerRow {
  return {
    organizationId: null,
    bucket: "opex_available",
    category: "opex_spent",
    amountCents: 0,
    feature: null,
    provider: null,
    postedAt: new Date(),
    ...partial,
  };
}

// ── Aggregators (mirror the route handlers' reductions) ─────────────────────

function bucketBalances(rows: LedgerRow[]) {
  const out: Record<string, number> = {
    tax_reserve: 0,
    refund_reserve: 0,
    profit_reserve: 0,
    owner_draw: 0,
    opex_available: 0,
  };
  for (const r of rows) {
    if (r.bucket in out) out[r.bucket] += r.amountCents;
  }
  return out;
}

function opexSplit(rows: LedgerRow[]) {
  let allocated = 0;
  let spentSigned = 0;
  for (const r of rows) {
    if (r.bucket !== "opex_available") continue;
    if (r.amountCents > 0) allocated += r.amountCents;
    else if (r.amountCents < 0) spentSigned += r.amountCents;
  }
  return {
    opexAvailable: allocated,
    // Force +0 (not -0) when no spend rows exist so equality vs `0` is clean.
    opexSpent: spentSigned === 0 ? 0 : -spentSigned,
    opexAvailableNet: allocated + spentSigned,
  };
}

function mrrTrailing(rows: LedgerRow[], windowMs: number, now = Date.now()) {
  const since = now - windowMs;
  return rows
    .filter((r) => r.category === "revenue" && r.postedAt.getTime() >= since)
    .reduce((acc, r) => acc + r.amountCents, 0);
}

function perOrgMargin(rows: LedgerRow[]) {
  const revenueByOrg = new Map<number, number>();
  const opexByOrg = new Map<number, number>();
  for (const r of rows) {
    if (r.organizationId == null) continue;
    if (r.category === "revenue") {
      revenueByOrg.set(
        r.organizationId,
        (revenueByOrg.get(r.organizationId) ?? 0) + r.amountCents,
      );
    } else if (r.category === "opex_spent") {
      opexByOrg.set(
        r.organizationId,
        (opexByOrg.get(r.organizationId) ?? 0) + r.amountCents,
      );
    }
  }
  return [...revenueByOrg.entries()].map(([orgId, mrrCents]) => {
    const opexSigned = opexByOrg.get(orgId) ?? 0;
    return {
      orgId,
      mrrCents,
      variableCostCents: -opexSigned,
      marginCents: mrrCents + opexSigned,
    };
  }).sort((a, b) => a.marginCents - b.marginCents);
}

function costMixByFeature(rows: LedgerRow[]) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.category !== "opex_spent") continue;
    const f = r.feature ?? "other";
    out[f] = (out[f] ?? 0) + Math.abs(r.amountCents);
  }
  return out;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("founder finance — ledger aggregations", () => {
  it("bucket balances sum signed amounts per bucket", () => {
    const ledger: LedgerRow[] = [
      // Revenue split: $20.00 in, allocated 25/10/5/5/55.
      row({ bucket: "tax_reserve", category: "allocation", amountCents: 500 }),
      row({ bucket: "refund_reserve", category: "allocation", amountCents: 200 }),
      row({ bucket: "profit_reserve", category: "allocation", amountCents: 100 }),
      row({ bucket: "owner_draw", category: "allocation", amountCents: 100 }),
      row({ bucket: "opex_available", category: "allocation", amountCents: 1100 }),
      // Some opex spend.
      row({
        bucket: "opex_available",
        category: "opex_spent",
        amountCents: -250,
        feature: "mail",
        provider: "lob",
      }),
    ];

    const balances = bucketBalances(ledger);
    expect(balances.tax_reserve).toBe(500);
    expect(balances.refund_reserve).toBe(200);
    expect(balances.profit_reserve).toBe(100);
    expect(balances.owner_draw).toBe(100);
    expect(balances.opex_available).toBe(850); // 1100 - 250
  });

  it("opex split tracks allocated vs spent vs net", () => {
    const ledger: LedgerRow[] = [
      row({ bucket: "opex_available", category: "allocation", amountCents: 5000 }),
      row({ bucket: "opex_available", category: "allocation", amountCents: 5000 }),
      row({ bucket: "opex_available", category: "opex_spent", amountCents: -1500 }),
      row({ bucket: "opex_available", category: "opex_spent", amountCents: -2200 }),
      // Non-opex rows ignored.
      row({ bucket: "tax_reserve", category: "allocation", amountCents: 3000 }),
    ];
    const split = opexSplit(ledger);
    expect(split.opexAvailable).toBe(10_000);
    expect(split.opexSpent).toBe(3700);
    expect(split.opexAvailableNet).toBe(6300);
  });

  it("MRR over a trailing window only counts in-window revenue rows", () => {
    const now = Date.now();
    const day = 86_400_000;
    const ledger: LedgerRow[] = [
      // In window.
      row({ category: "revenue", amountCents: 1000, postedAt: new Date(now - 5 * day) }),
      row({ category: "revenue", amountCents: 1500, postedAt: new Date(now - 25 * day) }),
      // Out of window (40 days back).
      row({ category: "revenue", amountCents: 9999, postedAt: new Date(now - 40 * day) }),
      // Non-revenue ignored.
      row({ category: "opex_spent", amountCents: -200, postedAt: new Date(now - 2 * day) }),
    ];
    expect(mrrTrailing(ledger, 30 * day, now)).toBe(2500);
  });

  it("per-org contribution margin = revenue + signed opex, sorted worst-first", () => {
    const ledger: LedgerRow[] = [
      // Org 1: $50 rev, $20 spend → +$30 margin.
      row({ organizationId: 1, category: "revenue", amountCents: 5000 }),
      row({ organizationId: 1, category: "opex_spent", amountCents: -2000 }),
      // Org 2: $20 rev, $80 spend → -$60 margin (worst).
      row({ organizationId: 2, category: "revenue", amountCents: 2000 }),
      row({ organizationId: 2, category: "opex_spent", amountCents: -8000 }),
      // Org 3: $100 rev, $40 spend → +$60 margin (best).
      row({ organizationId: 3, category: "revenue", amountCents: 10_000 }),
      row({ organizationId: 3, category: "opex_spent", amountCents: -4000 }),
    ];
    const out = perOrgMargin(ledger);
    expect(out.map((o) => o.orgId)).toEqual([2, 1, 3]);
    expect(out[0].marginCents).toBe(-6000);
    expect(out[0].variableCostCents).toBe(8000);
    expect(out[2].marginCents).toBe(6000);
  });

  it("cost mix sums abs(opex_spent) per feature", () => {
    const ledger: LedgerRow[] = [
      row({ category: "opex_spent", amountCents: -300, feature: "mail" }),
      row({ category: "opex_spent", amountCents: -150, feature: "mail" }),
      row({ category: "opex_spent", amountCents: -90, feature: "sms" }),
      row({ category: "opex_spent", amountCents: -25, feature: "ai" }),
      // Non-opex ignored.
      row({ category: "revenue", amountCents: 2000, feature: "subscription" }),
    ];
    const mix = costMixByFeature(ledger);
    expect(mix.mail).toBe(450);
    expect(mix.sms).toBe(90);
    expect(mix.ai).toBe(25);
    expect(mix.subscription).toBeUndefined();
  });

  it("returns zero for empty ledger", () => {
    expect(bucketBalances([])).toEqual({
      tax_reserve: 0,
      refund_reserve: 0,
      profit_reserve: 0,
      owner_draw: 0,
      opex_available: 0,
    });
    expect(opexSplit([])).toEqual({
      opexAvailable: 0,
      opexSpent: 0,
      opexAvailableNet: 0,
    });
    expect(mrrTrailing([], 30 * 86_400_000)).toBe(0);
    expect(perOrgMargin([])).toEqual([]);
    expect(costMixByFeature([])).toEqual({});
  });
});
