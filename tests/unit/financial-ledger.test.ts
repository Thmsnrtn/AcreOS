/**
 * Financial Ledger service tests (Pillar 1).
 *
 * The service is database-heavy, so we mock `server/db` with an in-memory
 * row store that honours just enough of Drizzle's chaining API for these
 * specific call sites:
 *
 *   - insert(table).values(row).onConflictDoNothing({...}).returning()
 *   - select(...).from(table).where(...)
 *   - select(...).from(table).where(...).limit(N)
 *   - withTransaction((tx) => ...) — runs the closure with `tx === db`
 *
 * The store enforces the UNIQUE constraint on external_event_id so we can
 * exercise the idempotency behaviour the production schema guarantees.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory store ──────────────────────────────────────────────────────────

type LedgerRow = {
  id: number;
  organizationId: number | null;
  bucket: string;
  category: string;
  amountCents: number;
  feature: string | null;
  provider: string | null;
  externalEventId: string | null;
  invoiceId: number | null;
  campaignId: number | null;
  postedAt: Date;
  postedBy: string;
  notes: string | null;
  createdAt: Date;
};

const store: { rows: LedgerRow[]; nextId: number } = { rows: [], nextId: 1 };

function resetStore() {
  store.rows = [];
  store.nextId = 1;
}

// Mock @shared/billing/allocation-policy at default (no founder override).
// We rely on the real DEFAULT_ALLOCATION_POLICY values.

// Mock founderSettings.getSetting to return null (forces default policy).
vi.mock("../../server/services/founderSettings", () => ({
  getSetting: vi.fn(async () => null),
}));

// Mock logger so the service can call .warn without a real backend.
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the DB.
vi.mock("../../server/db", () => {
  // Pending state per chain — captured between method calls.
  type PendingInsert = {
    table: string;
    row: LedgerRow;
    conflictTarget?: unknown;
  };
  type PendingSelect = {
    table: string;
    aggregate?: "sum";
    aggregateField?: keyof LedgerRow;
    filter: (r: LedgerRow) => boolean;
    limitN?: number;
  };

  function buildDb() {
    const insert = (_table: any) => {
      let pending: PendingInsert | null = null;
      const chain = {
        values(row: any) {
          pending = {
            table: "financial_ledger",
            row: {
              id: store.nextId++,
              organizationId: row.organizationId ?? null,
              bucket: row.bucket,
              category: row.category,
              amountCents: row.amountCents,
              feature: row.feature ?? null,
              provider: row.provider ?? null,
              externalEventId: row.externalEventId ?? null,
              invoiceId: row.invoiceId ?? null,
              campaignId: row.campaignId ?? null,
              postedAt: row.postedAt ?? new Date(),
              postedBy: row.postedBy,
              notes: row.notes ?? null,
              createdAt: new Date(),
            },
          };
          return chain;
        },
        onConflictDoNothing(opts?: { target: unknown }) {
          if (pending) pending.conflictTarget = opts?.target;
          return chain;
        },
        async returning() {
          if (!pending) return [];
          const eid = pending.row.externalEventId;
          if (eid && store.rows.some((r) => r.externalEventId === eid)) {
            // Conflict — DO NOTHING.
            return [];
          }
          store.rows.push(pending.row);
          return [pending.row];
        },
      };
      return chain;
    };

    const select = (fields?: any) => {
      const isAggregate = fields && typeof fields === "object" && "total" in fields;
      let pending: PendingSelect = {
        table: "financial_ledger",
        filter: () => true,
      };
      if (isAggregate) {
        pending.aggregate = "sum";
        pending.aggregateField = "amountCents";
      }
      const chain = {
        from(_table: any) {
          return chain;
        },
        where(predicate: any) {
          // predicate is the SQL fragment from drizzle. We tag the fragments
          // in our own eq/and/gte stubs (below) so we can evaluate them.
          if (typeof predicate === "function") {
            pending.filter = predicate;
          } else if (predicate && typeof predicate.__predicate === "function") {
            pending.filter = predicate.__predicate;
          }
          return chain;
        },
        limit(n: number) {
          pending.limitN = n;
          return chain;
        },
        then(resolve: (v: any) => void, reject: (e: any) => void) {
          try {
            let matched = store.rows.filter(pending.filter);
            if (pending.limitN != null) matched = matched.slice(0, pending.limitN);
            if (pending.aggregate === "sum") {
              const total = matched.reduce(
                (acc, r) => acc + (r[pending.aggregateField!] as number),
                0,
              );
              resolve([{ total }]);
              return;
            }
            resolve(matched);
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    };

    return {
      insert,
      select,
      async transaction(fn: any) {
        return fn(buildDb());
      },
    };
  }

  const db = buildDb();
  return {
    db,
    withTransaction: async (fn: any) => fn(db),
    pool: {},
    replicaPool: {},
    dbReadOnly: db,
  };
});

// Mock drizzle-orm helpers used by the service to build predicates.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  // Build predicate functions over the in-memory row shape.
  const fieldKeyMap: Record<string, keyof LedgerRow> = {
    bucket: "bucket",
    category: "category",
    organization_id: "organizationId",
    posted_at: "postedAt",
    external_event_id: "externalEventId",
  };
  const colKey = (col: any): keyof LedgerRow => {
    const name = col?.name ?? col?.columnName ?? col?.fieldName;
    if (name && fieldKeyMap[name]) return fieldKeyMap[name];
    // Drizzle columns expose `.name` lowercase. Fallback: try direct.
    if (name && (name as keyof LedgerRow) in ({} as LedgerRow)) {
      return name as keyof LedgerRow;
    }
    // Last resort: parse drizzle Column toString.
    const s = String(col);
    if (s.includes("bucket")) return "bucket";
    if (s.includes("category")) return "category";
    if (s.includes("organization_id")) return "organizationId";
    if (s.includes("posted_at")) return "postedAt";
    if (s.includes("external_event_id")) return "externalEventId";
    return "id";
  };

  const wrap = (fn: (r: LedgerRow) => boolean): any => ({
    __predicate: fn,
  });

  return {
    ...actual,
    eq: (col: any, val: any) => wrap((r) => (r as any)[colKey(col)] === val),
    gte: (col: any, val: any) =>
      wrap((r) => {
        const v = (r as any)[colKey(col)];
        if (v instanceof Date && val instanceof Date) return v.getTime() >= val.getTime();
        return v >= val;
      }),
    and: (...preds: any[]) =>
      wrap((r) => preds.every((p) => (p?.__predicate ?? (() => true))(r))),
    sql: (...args: any[]) => {
      // The service uses sql`... LIKE ${prefix + "%"}` for finding the
      // existing split. We model it as a LIKE on externalEventId.
      const raw = String(args[0] ?? "");
      if (raw.includes("LIKE")) {
        const param = args[1]?.[1] ?? args[args.length - 1];
        const prefix = String(param).replace(/%$/, "");
        return wrap((r) => (r.externalEventId ?? "").startsWith(prefix));
      }
      return wrap(() => true);
    },
    sum: (_col: any) => ({
      mapWith: (_fn: any) => ({ __aggregate: "sum", __field: "amountCents" }),
    }),
  };
});

// ── Import under test (after mocks) ──────────────────────────────────────────

import {
  postRevenue,
  postOpexSpent,
  postRefund,
  getBucketBalance,
  getContributionMargin,
  resolveAllocationPolicy,
} from "../../server/services/financial-ledger";
import { DEFAULT_ALLOCATION_POLICY } from "../../shared/billing/allocation-policy";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("financial-ledger / allocation policy", () => {
  it("resolveAllocationPolicy falls back to the canonical default", async () => {
    const p = await resolveAllocationPolicy();
    expect(p).toEqual(DEFAULT_ALLOCATION_POLICY);
    expect(
      p.tax_reserve + p.refund_reserve + p.profit_reserve + p.owner_draw + p.opex_available,
    ).toBeCloseTo(1.0, 9);
  });
});

describe("postRevenue", () => {
  beforeEach(() => resetStore());

  it("splits a revenue posting into 5 bucket rows summing to the input", async () => {
    const result = await postRevenue({
      organizationId: 42,
      amountCents: 10_000, // $100
      externalEventId: "stripe:evt_test_001",
    });

    expect(result.inserted).toBe(true);
    expect(result.rows).toHaveLength(5);

    const total = result.rows.reduce((s, r) => s + r.amountCents, 0);
    expect(total).toBe(10_000);

    const byBucket = Object.fromEntries(result.rows.map((r) => [r.bucket, r.amountCents]));
    expect(byBucket.tax_reserve).toBe(2500);
    expect(byBucket.refund_reserve).toBe(1000);
    expect(byBucket.profit_reserve).toBe(500);
    expect(byBucket.owner_draw).toBe(500);
    expect(byBucket.opex_available).toBe(5500);

    // Every row is category=revenue and provider=stripe.
    for (const r of result.rows) {
      expect(r.category).toBe("revenue");
      expect(r.provider).toBe("stripe");
      expect(r.organizationId).toBe(42);
      expect(r.externalEventId).toMatch(/^stripe:evt_test_001:alloc-/);
    }
  });

  it("is idempotent: a second call with the same externalEventId creates no new rows", async () => {
    const first = await postRevenue({
      organizationId: 1,
      amountCents: 4900,
      externalEventId: "stripe:evt_dup",
    });
    expect(first.inserted).toBe(true);
    const countAfterFirst = store.rows.length;
    expect(countAfterFirst).toBe(5);

    const second = await postRevenue({
      organizationId: 1,
      amountCents: 4900,
      externalEventId: "stripe:evt_dup",
    });
    expect(second.inserted).toBe(false);
    expect(store.rows.length).toBe(countAfterFirst);
    // The "rows" returned on the dup path correspond to the original 5.
    expect(second.rows).toHaveLength(5);
  });

  it("rejects non-positive amounts", async () => {
    await expect(
      postRevenue({ organizationId: 1, amountCents: 0, externalEventId: "x" }),
    ).rejects.toThrow();
    await expect(
      postRevenue({ organizationId: 1, amountCents: -5, externalEventId: "x" }),
    ).rejects.toThrow();
  });
});

describe("postOpexSpent + postRefund", () => {
  beforeEach(() => resetStore());

  it("postOpexSpent writes a single negative row on opex_available", async () => {
    const r = await postOpexSpent({
      organizationId: 7,
      amountCents: 85, // 85 cents
      category: "opex_spent",
      feature: "mail",
      providerName: "lob",
      providerEventId: "lob_evt_001",
      externalEventId: "lob:lob_evt_001",
    });
    expect(r.inserted).toBe(true);
    expect(r.row?.amountCents).toBe(-85);
    expect(r.row?.bucket).toBe("opex_available");
    expect(r.row?.provider).toBe("lob");
  });

  it("postOpexSpent is idempotent", async () => {
    const a = await postOpexSpent({
      organizationId: 7,
      amountCents: 32,
      category: "opex_spent",
      feature: "mail",
      providerName: "lob",
      providerEventId: "evt_x",
      externalEventId: "lob:evt_x",
    });
    const b = await postOpexSpent({
      organizationId: 7,
      amountCents: 32,
      category: "opex_spent",
      feature: "mail",
      providerName: "lob",
      providerEventId: "evt_x",
      externalEventId: "lob:evt_x",
    });
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(store.rows.length).toBe(1);
  });

  it("postRefund debits refund_reserve with a negative row", async () => {
    const r = await postRefund({
      organizationId: 9,
      amountCents: 2000,
      externalEventId: "stripe:refund_001",
      originalRevenueEventId: "stripe:evt_orig",
    });
    expect(r.inserted).toBe(true);
    expect(r.row?.bucket).toBe("refund_reserve");
    expect(r.row?.amountCents).toBe(-2000);
    expect(r.row?.category).toBe("refund");
  });
});

describe("getBucketBalance", () => {
  beforeEach(() => resetStore());

  it("sums signed amounts for the requested bucket only", async () => {
    await postRevenue({
      organizationId: 1,
      amountCents: 10_000,
      externalEventId: "stripe:r1",
    });
    // Spend $7 against opex_available.
    await postOpexSpent({
      organizationId: 1,
      amountCents: 700,
      category: "opex_spent",
      feature: "ai",
      providerName: "openrouter",
      providerEventId: "or_001",
      externalEventId: "openrouter:or_001",
    });

    // opex_available = +5500 (revenue alloc) − 700 (spend) = 4800
    const opex = await getBucketBalance("opex_available");
    expect(opex).toBe(4800);

    // tax_reserve untouched: just the 2500 allocation.
    const tax = await getBucketBalance("tax_reserve");
    expect(tax).toBe(2500);

    // refund_reserve untouched.
    const refund = await getBucketBalance("refund_reserve");
    expect(refund).toBe(1000);

    // Sum across all five buckets equals (10_000 − 700) = 9_300.
    const all =
      (await getBucketBalance("tax_reserve")) +
      (await getBucketBalance("refund_reserve")) +
      (await getBucketBalance("profit_reserve")) +
      (await getBucketBalance("owner_draw")) +
      (await getBucketBalance("opex_available"));
    expect(all).toBe(9_300);
  });
});

describe("getContributionMargin", () => {
  beforeEach(() => resetStore());

  it("computes revenue minus opex per org, scoped by org", async () => {
    // Org 1: $100 revenue, $7 opex → margin = 9_300
    await postRevenue({
      organizationId: 1,
      amountCents: 10_000,
      externalEventId: "stripe:r_org1",
    });
    await postOpexSpent({
      organizationId: 1,
      amountCents: 700,
      category: "opex_spent",
      feature: "ai",
      providerName: "openrouter",
      providerEventId: "evt_1",
      externalEventId: "openrouter:evt_1",
    });

    // Org 2: $50 revenue, $40 opex → margin = 1000
    await postRevenue({
      organizationId: 2,
      amountCents: 5000,
      externalEventId: "stripe:r_org2",
    });
    await postOpexSpent({
      organizationId: 2,
      amountCents: 4000,
      category: "opex_spent",
      feature: "mail",
      providerName: "lob",
      providerEventId: "evt_2",
      externalEventId: "lob:evt_2",
    });

    const org1 = await getContributionMargin(1, 30);
    expect(org1.organizationId).toBe(1);
    expect(org1.revenueCents).toBe(10_000);
    expect(org1.opexCents).toBe(700);
    expect(org1.marginCents).toBe(9_300);

    const org2 = await getContributionMargin(2, 30);
    expect(org2.revenueCents).toBe(5_000);
    expect(org2.opexCents).toBe(4_000);
    expect(org2.marginCents).toBe(1_000);
  });
});
