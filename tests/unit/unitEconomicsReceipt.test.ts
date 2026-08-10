// @vitest-environment jsdom
/**
 * O6 (P5 §5) — the unit-economics receipt in the Letter + the infra-curve panel.
 *
 * The engine (server/services/unitEconomics.ts) already existed and is not
 * under test here; what is under test is the SURFACE and the HONESTY OF WHAT
 * IT SAYS. Five pins, each falsifiable at the pre-slice HEAD (the two client
 * components, the read helpers and the endpoint did not exist):
 *
 *  1. DERIVED, NOT DECLARED — every figure the receipt reports is recomputed
 *     independently in this suite from the snapshot fixture. Attributable cost
 *     is the five ledger-sourced COGS columns and EXCLUDES the allocated fixed
 *     share; contribution is revenue − attributable; a percentage with a zero
 *     denominator is null, never 0.
 *
 *  2. NO FABRICATED ZEROS — with the engine returning nothing (no snapshots,
 *     no orgs, no series), every money/percent figure is null with a reason,
 *     `belowFloor` is null (an unmeasurable margin neither passes nor fails a
 *     gate), and the RENDERED section contains no "$0.00" anywhere.
 *
 *  3. THE COMPONENT RENDERS THE ENGINE'S NUMBERS — the section is mounted
 *     twice against two DIFFERENT payloads and asserted to move with them. A
 *     hardcoded figure in UnitEconomicsReceipt.tsx fails BY NAME here (the
 *     failing expectation names the field it stopped tracking).
 *
 *  4. THE CURVE REFUSES TO DRAW — below `minPointsRequired` snapshot days the
 *     panel renders the refusal, not a chart; a day with zero billed work has
 *     an UNDEFINED cost-per-unit, not $0.
 *
 *  5. WIRED — the Letter renders the section, the /founder/admin/costs hub
 *     renders the panel, the endpoint sits behind isAuthenticated +
 *     requireFounder, and no new /founder route was minted for either.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Infra mocks (house pattern: unitEconomicsFromLedger.test.ts) ────────────

/**
 * db.execute() is resolved by matching the raw SQL text, NOT by call order —
 * the endpoint runs the two readers concurrently under Promise.all, so an
 * order-based mock would be a coin flip.
 */
const dbState = vi.hoisted(() => ({
  execute: {
    latest: [] as unknown[],
    trend: [] as unknown[],
    counts: [] as unknown[],
    series: [] as unknown[],
  },
  /** Rows a db.select(...).from(table) chain resolves to. */
  selectRows: [] as unknown[],
}));

vi.mock("../../server/db", () => {
  /** Flatten a drizzle SQL template back to searchable text. */
  function sqlText(query: any): string {
    const chunks = query?.queryChunks ?? [];
    return chunks
      .map((c: any) =>
        Array.isArray(c?.value) && c.value.every((v: unknown) => typeof v === "string")
          ? c.value.join("")
          : "",
      )
      .join(" ");
  }
  function builder() {
    const b: any = {
      from() { return b; },
      where() { return b; },
      groupBy() { return b; },
      orderBy() { return b; },
      innerJoin() { return b; },
      leftJoin() { return b; },
      limit() { return b; },
      then(onFulfilled: (rows: unknown[]) => unknown) {
        return Promise.resolve(onFulfilled(dbState.selectRows));
      },
    };
    return b;
  }
  return {
    db: {
      select: () => builder(),
      insert: () => { throw new Error("insert not expected in these tests"); },
      execute: async (query: any) => {
        const text = sqlText(query);
        if (text.includes("units_of_work")) return { rows: dbState.execute.series };
        if (text.includes("billed_events")) return { rows: dbState.execute.counts };
        if (text.includes("gross_margin_usd")) return { rows: dbState.execute.trend };
        if (text.includes("DISTINCT ON (cue.organization_id)")) return { rows: dbState.execute.latest };
        throw new Error(`unmocked db.execute in this suite: ${text.slice(0, 120)}`);
      },
    },
    withTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
  };
});

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { requireFounderSpy } = vi.hoisted(() => ({
  requireFounderSpy: vi.fn((_req: any, _res: any, next: () => void) => next()),
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "founder-1", claims: { sub: "founder-1" } };
    next();
  },
  requireFounder: requireFounderSpy,
  getOrCreateOrg: (req: any, _res: any, next: any) => next(),
  clerkMiddleware: (_req: any, _res: any, next: any) => next(),
}));

// Heavy neighbours of the money-routes file that this endpoint does not touch.
vi.mock("../../server/services/finance/runwayModel", () => ({ computeRunway: async () => ({}) }));
vi.mock("../../server/services/financial-ledger", () => ({
  getContributionMargin: async () => ({ marginCents: 0 }),
}));
vi.mock("../../server/services/paidDataEvalHarness", () => ({ getLatestEvalRun: async () => null }));
vi.mock("../../server/services/providers/regrid-provider", () => ({
  regridProvider: { displayName: "Regrid", minMonthlyCommitCents: 0 },
}));
vi.mock("../../server/services/marketingSpend", () => ({
  MARKETING_CHANNELS: ["other"],
  computeCac: async () => ({ cacUsd: null, windowDays: 90, spendCents: 0, newPayingCustomers: 0 }),
  listMarketingSpend: async () => [],
  marketingSpendSummary: async () => ({}),
  recordMarketingSpend: async () => ({}),
}));

import { FIXED_COST_INPUTS_USD_MONTHLY } from "@shared/schema";
import {
  readUnitEconomicsReceipt,
  readInfraCurve,
  RECEIPT_MARGIN_FLOOR_PCT,
  RECEIPT_DIRECTION_MIN_POINTS,
  RECEIPT_DIRECTION_MIN_SPAN_DAYS,
  INFRA_CURVE_MIN_POINTS,
  type UnitEconomicsReceipt,
  type InfraCurve,
} from "../../server/services/unitEconomics";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

// ── Fixture builders — the RAW row shapes the SQL returns ──────────────────

interface SnapshotSeed {
  organization_id: number;
  organization_name: string;
  subscription_tier: string;
  mrr_usd: number;
  ai_cost_usd: number;
  direct_mail_cost_usd: number;
  sms_cost_usd: number;
  email_cost_usd: number;
  skip_trace_cost_usd: number;
  fixed_cost_share_usd: number;
  billed_events: number;
}

function snapshotRow(seed: SnapshotSeed) {
  const totalCogs =
    seed.ai_cost_usd +
    seed.direct_mail_cost_usd +
    seed.sms_cost_usd +
    seed.email_cost_usd +
    seed.skip_trace_cost_usd +
    seed.fixed_cost_share_usd;
  return {
    organization_id: seed.organization_id,
    computed_at: "2026-08-10T00:00:00.000Z",
    mrr_usd: String(seed.mrr_usd),
    ai_cost_usd: String(seed.ai_cost_usd),
    direct_mail_cost_usd: String(seed.direct_mail_cost_usd),
    sms_cost_usd: String(seed.sms_cost_usd),
    email_cost_usd: String(seed.email_cost_usd),
    skip_trace_cost_usd: String(seed.skip_trace_cost_usd),
    fixed_cost_share_usd: String(seed.fixed_cost_share_usd),
    total_cogs_usd: String(totalCogs),
    profit_margin_usd: String(seed.mrr_usd - totalCogs),
    profit_margin_pct: "0",
    consecutive_unprofitable_days: 0,
    organization_name: seed.organization_name,
    subscription_tier: seed.subscription_tier,
  };
}

/** Ten consecutive snapshot days — enough for both the direction and the curve. */
function seriesRows(count: number, opts: { unitsOnLastDay?: number } = {}) {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = String(i + 1).padStart(2, "0");
    const isLast = i === count - 1;
    const units = isLast && opts.unitsOnLastDay !== undefined ? opts.unitsOnLastDay : 100 + i;
    rows.push({
      date: `2026-08-${day}`,
      org_count: 2,
      window_days: 30,
      mrr_usd: String(300 + i),
      variable_cost_usd: String(20 + i),
      fixed_share_usd: "126",
      total_cogs_usd: String(146 + i),
      units_of_work: String(units),
    });
  }
  return rows;
}

const PAYING = snapshotRow({
  organization_id: 1,
  organization_name: "Cedar Ridge Land",
  subscription_tier: "professional",
  mrr_usd: 299,
  ai_cost_usd: 12.5,
  direct_mail_cost_usd: 4,
  sms_cost_usd: 1.25,
  email_cost_usd: 0.5,
  skip_trace_cost_usd: 2,
  fixed_cost_share_usd: 63,
  billed_events: 412,
});

const FREE = snapshotRow({
  organization_id: 2,
  organization_name: "Sandy Flats Holdings",
  subscription_tier: "free",
  mrr_usd: 0,
  ai_cost_usd: 3,
  direct_mail_cost_usd: 0,
  sms_cost_usd: 0,
  email_cost_usd: 0,
  skip_trace_cost_usd: 0,
  fixed_cost_share_usd: 0,
  billed_events: 0,
});

/**
 * Point every query readUnitEconomicsReceipt / readInfraCurve issue at its
 * fixture: latest-per-org · 90d trend · per-org billed-event counts · the
 * daily series · the organizations table.
 */
function primeReceipt(opts: {
  snapshots: ReturnType<typeof snapshotRow>[];
  counts: Array<{ organization_id: number; window_days: number; billed_events: number }>;
  orgs: Array<{ id: number; name: string }>;
  series: Record<string, unknown>[];
}) {
  dbState.execute.latest = opts.snapshots;
  dbState.execute.trend = [];
  dbState.execute.counts = opts.counts;
  dbState.execute.series = opts.series;
  dbState.selectRows = opts.orgs;
}

beforeEach(() => {
  dbState.execute = { latest: [], trend: [], counts: [], series: [] };
  dbState.selectRows = [];
  requireFounderSpy.mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The receipt is DERIVED from the snapshots — nothing declared
// ═══════════════════════════════════════════════════════════════════════════

describe("readUnitEconomicsReceipt — every figure traces to an engine field", () => {
  async function fullReceipt(): Promise<UnitEconomicsReceipt> {
    primeReceipt({
      snapshots: [PAYING, FREE],
      counts: [
        { organization_id: 1, window_days: 30, billed_events: 412 },
        { organization_id: 2, window_days: 30, billed_events: 0 },
      ],
      // Three orgs exist; only two have a snapshot.
      orgs: [
        { id: 1, name: "Cedar Ridge Land" },
        { id: 2, name: "Sandy Flats Holdings" },
        { id: 3, name: "Juniper Creek Capital" },
      ],
      series: seriesRows(10),
    });
    return readUnitEconomicsReceipt();
  }

  it("attributable cost is the five LEDGER columns and EXCLUDES the allocated fixed share", async () => {
    const receipt = await fullReceipt();
    const row = receipt.customers.find((c) => c.organizationId === 1)!;
    // Recomputed here from the fixture, independent of the service.
    const expectedAttributable = 12.5 + 4 + 1.25 + 0.5 + 2;
    expect(row.attributableCostUsd).toBe(expectedAttributable);
    // The allocation is reported, but never folded in.
    expect(row.allocatedFixedShareUsd).toBe(63);
    expect(row.attributableCostUsd).not.toBe(expectedAttributable + 63);
  });

  it("contribution is revenue − attributable cost, per customer and in the roll-up", async () => {
    const receipt = await fullReceipt();
    const paying = receipt.customers.find((c) => c.organizationId === 1)!;
    expect(paying.contributionUsd).toBe(299 - (12.5 + 4 + 1.25 + 0.5 + 2));
    expect(paying.contributionPct).toBe(
      Math.round((paying.contributionUsd / 299) * 10000) / 100,
    );

    const revenue = receipt.customers.reduce((s, c) => s + c.mrrUsd, 0);
    const attributable = receipt.customers.reduce((s, c) => s + c.attributableCostUsd, 0);
    expect(receipt.rollup.revenueUsd.value).toBe(revenue);
    expect(receipt.rollup.attributableCostUsd.value).toBe(attributable);
    expect(receipt.rollup.contributionUsd.value).toBe(revenue - attributable);
    expect(receipt.rollup.contributionPct.value).toBe(
      Math.round(((revenue - attributable) / revenue) * 10000) / 100,
    );
  });

  it("a percentage with a zero denominator is null, not 0% (the free-tier org)", async () => {
    const receipt = await fullReceipt();
    const free = receipt.customers.find((c) => c.organizationId === 2)!;
    expect(free.mrrUsd).toBe(0);
    expect(free.contributionPct).toBeNull();
    // The persisted profit_margin_pct column stores "0" here; the receipt
    // deliberately does NOT reuse it.
    expect(free.contributionPct).not.toBe(0);
  });

  it("a $0 cost carries its evidence — billed-event counts, not a bare zero", async () => {
    const receipt = await fullReceipt();
    const paying = receipt.customers.find((c) => c.organizationId === 1)!;
    const free = receipt.customers.find((c) => c.organizationId === 2)!;
    expect(paying.billedEvents).toBe(412);
    expect(paying.costEvidence).toBe("billed");
    expect(free.billedEvents).toBe(0);
    expect(free.costEvidence).toBe("no_billed_events");
  });

  it("every figure names its source and a place to go and check it", async () => {
    const receipt = await fullReceipt();
    for (const [key, fig] of Object.entries(receipt.rollup)) {
      expect(fig.source, `${key} must name its source`).toBeTruthy();
      expect(fig.href, `${key} must link to what produced it`).toMatch(/^\/founder\//);
      // absent is populated if and only if the value is missing.
      if (fig.value === null) expect(fig.absent, `${key} absence reason`).toBeTruthy();
      else expect(fig.absent).toBeNull();
    }
    for (const row of receipt.customers) {
      expect(row.source).toBeTruthy();
      expect(row.href).toMatch(/^\/founder\//);
    }
  });

  it("orgs with no snapshot are EXCLUDED and named — never averaged in as zeros", async () => {
    const receipt = await fullReceipt();
    expect(receipt.coverage.organizationsTotal).toBe(3);
    expect(receipt.coverage.withSnapshot).toBe(2);
    expect(receipt.coverage.withoutSnapshot).toBe(1);
    expect(receipt.coverage.missing.map((m) => m.organizationId)).toEqual([3]);
    expect(receipt.coverage.line).toContain("3");
    expect(receipt.customers.map((c) => c.organizationId)).not.toContain(3);
  });

  it("the margin floor is DECLARED and is judged on GROSS margin, never on contribution", async () => {
    const receipt = await fullReceipt();
    expect(receipt.marginFloorPct).toBe(RECEIPT_MARGIN_FLOOR_PCT);

    // Gross margin includes the allocated fixed share; contribution does not,
    // so contribution ALWAYS reads higher. Judging the floor on contribution
    // would flatter the company by exactly the size of the allocation.
    const gross = receipt.rollup.grossMarginPct.value!;
    const contribution = receipt.rollup.contributionPct.value!;
    expect(gross).toBeLessThan(contribution);
    expect(receipt.belowFloor).toBe(gross < RECEIPT_MARGIN_FLOOR_PCT);
  });

  it("a customer that straddles the floor fails it — using contribution would have passed it", async () => {
    // Fixed share tuned so gross margin lands UNDER the floor while
    // contribution margin sits comfortably over it: the exact shape where
    // reporting the wrong percentage turns a failing month into a green one.
    primeReceipt({
      snapshots: [
        snapshotRow({
          organization_id: 1,
          organization_name: "Cedar Ridge Land",
          subscription_tier: "professional",
          mrr_usd: 299,
          ai_cost_usd: 12.5,
          direct_mail_cost_usd: 4,
          sms_cost_usd: 1.25,
          email_cost_usd: 0.5,
          skip_trace_cost_usd: 2,
          fixed_cost_share_usd: 80,
          billed_events: 412,
        }),
      ],
      counts: [{ organization_id: 1, window_days: 30, billed_events: 412 }],
      orgs: [{ id: 1, name: "Cedar Ridge Land" }],
      series: seriesRows(10),
    });
    const receipt = await readUnitEconomicsReceipt();
    expect(receipt.rollup.grossMarginPct.value).toBeLessThan(RECEIPT_MARGIN_FLOOR_PCT);
    expect(receipt.rollup.contributionPct.value).toBeGreaterThan(RECEIPT_MARGIN_FLOOR_PCT);
    expect(receipt.belowFloor).toBe(true);
  });

  it("says how current the figures are — a stale roll-up is not a statement about today", async () => {
    const receipt = await fullReceipt();
    expect(receipt.freshness.newestComputedAt).toBe("2026-08-10T00:00:00.000Z");
    expect(receipt.freshness.line).toContain("2026-08-10");
  });

  it("states a direction only with enough points AND enough span", async () => {
    const receipt = await fullReceipt();
    expect(receipt.direction.available).toBe(true);
    expect(receipt.direction.pointCount).toBeGreaterThanOrEqual(RECEIPT_DIRECTION_MIN_POINTS);
    expect(receipt.direction.spanDays).toBeGreaterThanOrEqual(RECEIPT_DIRECTION_MIN_SPAN_DAYS);
    // Endpoint values recomputed from the fixture: (mrr − variable) ÷ orgs.
    expect(receipt.direction.fromContributionPerCustomerUsd).toBe((300 - 20) / 2);
    expect(receipt.direction.toContributionPerCustomerUsd).toBe((300 + 9 - (20 + 9)) / 2);
    expect(receipt.direction.deltaUsd).toBe(
      receipt.direction.toContributionPerCustomerUsd! -
        receipt.direction.fromContributionPerCustomerUsd!,
    );
  });

  it("refuses a direction when the series is too short, and says why", async () => {
    primeReceipt({
      snapshots: [PAYING],
      counts: [{ organization_id: 1, window_days: 30, billed_events: 412 }],
      orgs: [{ id: 1, name: "Cedar Ridge Land" }],
      series: seriesRows(2),
    });
    const receipt = await readUnitEconomicsReceipt();
    expect(receipt.direction.available).toBe(false);
    expect(receipt.direction.deltaUsd).toBeNull();
    expect(receipt.direction.reason).toContain(String(RECEIPT_DIRECTION_MIN_POINTS));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Engine down / empty — honest absence, no fabricated zeros
// ═══════════════════════════════════════════════════════════════════════════

describe("readUnitEconomicsReceipt — the honest-absence path", () => {
  it("returns nulls with reasons, not zeros, when nothing has ever been computed", async () => {
    primeReceipt({ snapshots: [], counts: [], orgs: [], series: [] });
    const receipt = await readUnitEconomicsReceipt();

    // The COUNT of customers with a snapshot is a true zero — that is a fact.
    expect(receipt.rollup.customersWithSnapshot.value).toBe(0);

    // Every money/percent figure is absent, with a reason, and is NOT 0.
    for (const key of [
      "revenueUsd",
      "attributableCostUsd",
      "contributionUsd",
      "contributionPct",
      "allocatedFixedShareUsd",
      "grossMarginPct",
    ] as const) {
      const fig = receipt.rollup[key];
      expect(fig.value, `${key} must be null, not a fabricated zero`).toBeNull();
      expect(fig.absent, `${key} must say why`).toBeTruthy();
    }

    expect(receipt.customers).toEqual([]);
    // An unmeasurable margin neither passes nor fails the declared gate.
    expect(receipt.belowFloor).toBeNull();
    expect(receipt.direction.available).toBe(false);
    expect(receipt.direction.reason.length).toBeGreaterThan(0);
    // No as-of date is invented for figures that were never computed.
    expect(receipt.freshness.newestComputedAt).toBeNull();
  });

  it("does not claim full coverage when there are no organizations at all", async () => {
    primeReceipt({ snapshots: [], counts: [], orgs: [], series: [] });
    const receipt = await readUnitEconomicsReceipt();
    // "Every organization has a snapshot" is vacuously true and therefore a
    // lie on an empty cluster — the line must not imply complete coverage.
    expect(receipt.coverage.organizationsTotal).toBe(0);
    expect(receipt.coverage.line).not.toMatch(/every organization/i);
    expect(receipt.coverage.line).toMatch(/no organizations/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The infra curve refuses to draw on thin history
// ═══════════════════════════════════════════════════════════════════════════

describe("readInfraCurve", () => {
  async function curveWith(rows: Record<string, unknown>[]): Promise<InfraCurve> {
    dbState.execute.series = rows;
    return readInfraCurve(90);
  }

  it("refuses to draw below the declared minimum, and names the real counts", async () => {
    const curve = await curveWith(seriesRows(2));
    expect(curve.sufficient).toBe(false);
    expect(curve.minPointsRequired).toBe(INFRA_CURVE_MIN_POINTS);
    expect(curve.reason).toContain(String(INFRA_CURVE_MIN_POINTS));
    expect(curve.reason).toContain("2");
    // The two real points are still returned — refusing to draw is not
    // refusing to report.
    expect(curve.points).toHaveLength(2);
  });

  it("says so plainly when there is no history at all", async () => {
    const curve = await curveWith([]);
    expect(curve.sufficient).toBe(false);
    expect(curve.points).toEqual([]);
    expect(curve.latest).toBeNull();
    expect(curve.reason.toLowerCase()).toContain("no history");
  });

  it("draws once enough snapshot days with billed work exist", async () => {
    const curve = await curveWith(seriesRows(INFRA_CURVE_MIN_POINTS + 3));
    expect(curve.sufficient).toBe(true);
    expect(curve.points.length).toBe(INFRA_CURVE_MIN_POINTS + 3);
    const p = curve.points[0];
    // Cost per unit is DERIVED: variable cost ÷ billed events.
    expect(p.costPerUnitUsd).toBe(Math.round((20 / 100) * 1_000_000) / 1_000_000);
    expect(p.variableCostPerOrgUsd).toBe(20 / 2);
  });

  it("a day with zero billed work has an UNDEFINED unit cost, not $0", async () => {
    const curve = await curveWith(seriesRows(INFRA_CURVE_MIN_POINTS + 3, { unitsOnLastDay: 0 }));
    const last = curve.points[curve.points.length - 1];
    expect(last.unitsOfWork).toBe(0);
    expect(last.costPerUnitUsd).toBeNull();
    expect(last.costPerUnitUsd).not.toBe(0);
  });

  it("labels the fixed inputs as DECLARED constants and names what nothing meters", async () => {
    const curve = await curveWith(seriesRows(INFRA_CURVE_MIN_POINTS));
    expect(curve.declaredFixedInputsUsdMonthly.fly).toBe(FIXED_COST_INPUTS_USD_MONTHLY.fly);
    expect(curve.declaredFixedInputsUsdMonthly.postgres).toBe(FIXED_COST_INPUTS_USD_MONTHLY.postgres);
    expect(curve.declaredFixedInputsUsdMonthly.clerk).toBe(FIXED_COST_INPUTS_USD_MONTHLY.clerk);
    expect(curve.declaredFixedInputsUsdMonthly.sentry).toBe(FIXED_COST_INPUTS_USD_MONTHLY.sentry);
    expect(curve.declaredFixedInputsUsdMonthly.total).toBe(
      FIXED_COST_INPUTS_USD_MONTHLY.fly +
        FIXED_COST_INPUTS_USD_MONTHLY.postgres +
        FIXED_COST_INPUTS_USD_MONTHLY.clerk +
        FIXED_COST_INPUTS_USD_MONTHLY.sentry,
    );
    expect(curve.notMeasured.length).toBeGreaterThan(0);
    expect(curve.notMeasured.join(" ")).toMatch(/egress/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The endpoint is founder-gated
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/founder/money/unit-economics-receipt", () => {
  it("serves the receipt + curve through isAuthenticated + requireFounder", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { registerFounderMoneyRoutes } = await import("../../server/routes-founder-money");

    const app = express();
    registerFounderMoneyRoutes(app);

    primeReceipt({
      snapshots: [PAYING],
      counts: [{ organization_id: 1, window_days: 30, billed_events: 412 }],
      orgs: [{ id: 1, name: "Cedar Ridge Land" }],
      series: seriesRows(10),
    });
    const res = await request(app).get("/api/founder/money/unit-economics-receipt");
    expect(res.status).toBe(200);
    expect(requireFounderSpy).toHaveBeenCalledTimes(1);
    expect(res.body.receipt).toBeDefined();
    expect(res.body.curve).toBeDefined();
    expect(res.body.receipt.rollup.contributionUsd.value).toBe(299 - (12.5 + 4 + 1.25 + 0.5 + 2));
  });

  it("a non-founder never reaches the handler", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { registerFounderMoneyRoutes } = await import("../../server/routes-founder-money");

    requireFounderSpy.mockImplementationOnce((_req: any, res: any) => {
      res.status(403).json({ error: "forbidden" });
    });
    const app = express();
    registerFounderMoneyRoutes(app);
    // Deliberately prime NOTHING: if the gate leaked, the handler would run.
    dbState.execute = { latest: [], trend: [], counts: [], series: [] };

    const res = await request(app).get("/api/founder/money/unit-economics-receipt");
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The components render the ENGINE's numbers — and its absences
// ═══════════════════════════════════════════════════════════════════════════

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(React.createElement(QueryClientProvider, { client }, node));
  });
  return container;
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })),
  );
}

/** Build a receipt payload straight off the engine, so nothing is hand-typed. */
async function engineReceipt(seed: {
  snapshots: ReturnType<typeof snapshotRow>[];
  counts: Array<{ organization_id: number; window_days: number; billed_events: number }>;
  orgs: Array<{ id: number; name: string }>;
  series: Record<string, unknown>[];
}) {
  primeReceipt(seed);
  const receipt = await readUnitEconomicsReceipt();
  const curve = await readInfraCurve(90);
  return { receipt, curve };
}

describe("UnitEconomicsReceiptSection — renders the engine, never a constant", () => {
  it("moves with the engine's numbers across two different payloads", async () => {
    const { UnitEconomicsReceiptSection } = await import(
      "../../client/src/components/founder/UnitEconomicsReceipt"
    );
    const { usd } = await import("../../client/src/lib/format");

    const payloadA = await engineReceipt({
      snapshots: [PAYING],
      counts: [{ organization_id: 1, window_days: 30, billed_events: 412 }],
      orgs: [{ id: 1, name: "Cedar Ridge Land" }],
      series: seriesRows(10),
    });
    stubFetch(payloadA);
    let el = mount(React.createElement(UnitEconomicsReceiptSection));
    await flush();
    const textA = el.textContent ?? "";
    expect(textA).toContain(usd(payloadA.receipt.rollup.contributionUsd.value));
    expect(textA).toContain(usd(payloadA.receipt.rollup.revenueUsd.value));
    expect(textA).toContain(usd(payloadA.receipt.rollup.attributableCostUsd.value));
    expect(textA).toContain(`${payloadA.receipt.rollup.contributionPct.value}%`);
    expect(textA).toContain(payloadA.receipt.coverage.line);

    act(() => root!.unmount());
    root = null;
    container!.remove();
    container = null;

    // A DIFFERENT engine reading. A hardcoded figure in the component would
    // still show payload A's numbers here and fail by name below.
    const payloadB = await engineReceipt({
      snapshots: [
        snapshotRow({
          organization_id: 7,
          organization_name: "Blackwater Farms",
          subscription_tier: "starter",
          mrr_usd: 99,
          ai_cost_usd: 40,
          direct_mail_cost_usd: 11,
          sms_cost_usd: 3,
          email_cost_usd: 1,
          skip_trace_cost_usd: 5,
          fixed_cost_share_usd: 63,
          billed_events: 90,
        }),
      ],
      counts: [{ organization_id: 7, window_days: 30, billed_events: 90 }],
      orgs: [{ id: 7, name: "Blackwater Farms" }],
      series: seriesRows(10),
    });
    stubFetch(payloadB);
    el = mount(React.createElement(UnitEconomicsReceiptSection));
    await flush();
    const textB = el.textContent ?? "";
    expect(textB).toContain(usd(payloadB.receipt.rollup.contributionUsd.value));
    expect(textB).toContain(usd(payloadB.receipt.rollup.attributableCostUsd.value));
    expect(textB).not.toContain(usd(payloadA.receipt.rollup.contributionUsd.value));
    expect(textB).toContain("Blackwater Farms");
  });

  it("renders the engine's absence sentences and NO fabricated zeros when nothing is computed", async () => {
    const { UnitEconomicsReceiptSection } = await import(
      "../../client/src/components/founder/UnitEconomicsReceipt"
    );
    const empty = await engineReceipt({ snapshots: [], counts: [], orgs: [], series: [] });
    expect(empty.receipt.rollup.revenueUsd.value).toBeNull();

    stubFetch(empty);
    const el = mount(React.createElement(UnitEconomicsReceiptSection));
    await flush();
    const text = el.textContent ?? "";

    // The absence sentences the engine wrote are what the founder reads.
    expect(text).toContain(empty.receipt.rollup.revenueUsd.absent);
    expect(text).toContain(empty.receipt.direction.reason);
    // Not one dollar figure is invented.
    expect(text).not.toContain("$0.00");
    expect(text).not.toMatch(/\$\d/);
    expect(el.querySelector('[data-testid="receipt-revenue"]')).toBeNull();
    expect(el.querySelector('[data-testid="receipt-revenue-absent"]')).not.toBeNull();
    // An unmeasurable margin renders no pass/fail verdict against the floor.
    expect(el.querySelector('[data-testid="receipt-floor-line"]')).toBeNull();
  });

  it("a failed read says so — never pixel-identical to a healthy section", async () => {
    const { UnitEconomicsReceiptSection } = await import(
      "../../client/src/components/founder/UnitEconomicsReceipt"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    const el = mount(React.createElement(UnitEconomicsReceiptSection));
    await flush();
    expect(el.querySelector('[data-testid="letter-unit-economics-error"]')).not.toBeNull();
  });
});

describe("InfraCurvePanel — the refusal is the feature", () => {
  it("renders the refusal, not a chart, on thin history", async () => {
    const { InfraCurvePanel } = await import(
      "../../client/src/components/founder/InfraCurvePanel"
    );
    const thin = await engineReceipt({
      snapshots: [PAYING],
      counts: [{ organization_id: 1, window_days: 30, billed_events: 412 }],
      orgs: [{ id: 1, name: "Cedar Ridge Land" }],
      series: seriesRows(2),
    });
    expect(thin.curve.sufficient).toBe(false);

    stubFetch(thin);
    const el = mount(React.createElement(InfraCurvePanel));
    await flush();
    expect(el.querySelector('[data-testid="infra-curve-chart"]')).toBeNull();
    expect(el.querySelector('[data-testid="infra-curve-insufficient"]')).not.toBeNull();
    expect(el.textContent).toContain(thin.curve.reason);
  });

  it("draws only when the engine says the history supports it", async () => {
    const { InfraCurvePanel } = await import(
      "../../client/src/components/founder/InfraCurvePanel"
    );
    const thick = await engineReceipt({
      snapshots: [PAYING],
      counts: [{ organization_id: 1, window_days: 30, billed_events: 412 }],
      orgs: [{ id: 1, name: "Cedar Ridge Land" }],
      series: seriesRows(INFRA_CURVE_MIN_POINTS + 3),
    });
    expect(thick.curve.sufficient).toBe(true);

    stubFetch(thick);
    const el = mount(React.createElement(InfraCurvePanel));
    await flush();
    expect(el.querySelector('[data-testid="infra-curve-chart"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="infra-curve-insufficient"]')).toBeNull();
    // The declared fixed inputs are labelled as declared, not billed.
    const declared = el.querySelector('[data-testid="infra-curve-declared"]')!;
    expect(declared.textContent).toContain("declared in code");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Wiring — built things must be reached
// ═══════════════════════════════════════════════════════════════════════════

describe("O6 surfaces are wired", () => {
  it("the Letter renders the receipt section", () => {
    const home = read("client/src/pages/founder/home.tsx");
    expect(home).toContain('from "@/components/founder/UnitEconomicsReceipt"');
    expect(home).toContain("<UnitEconomicsReceiptSection />");
  });

  it("the /founder/admin/costs hub renders the infra-curve panel", () => {
    const costs = read("client/src/pages/founder/admin/costs.tsx");
    expect(costs).toContain('from "@/components/founder/InfraCurvePanel"');
    expect(costs).toContain("<InfraCurvePanel />");
  });

  it("the endpoint is registered behind isAuthenticated + requireFounder", () => {
    const routes = read("server/routes-founder-money.ts");
    const idx = routes.indexOf('"/api/founder/money/unit-economics-receipt"');
    expect(idx).toBeGreaterThan(-1);
    const registration = routes.slice(idx, idx + 200);
    expect(registration).toContain("isAuthenticated");
    expect(registration).toContain("requireFounder");
  });

  it("no new top-level founder route was minted for either surface", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toContain("InfraCurvePanel");
    expect(app).not.toContain("UnitEconomicsReceipt");
    expect(app).not.toContain('path="/founder/infra');
  });

  it("the endpoint is the ONLY server owner of these reads (one definition)", () => {
    const routes = read("server/routes-founder-money.ts");
    expect(routes).toContain("readUnitEconomicsReceipt");
    expect(routes).toContain("readInfraCurve");
    // No second copy of the margin math in the route layer.
    expect(routes.slice(routes.indexOf("unit-economics-receipt"))).not.toMatch(/mrrUsd\s*-\s*/);
  });
});

// ─── Fleet-9 verifier catches — each fix pinned ─────────────────────────────

describe("fleet-9 catch — the receipt states org vs paying, and evidences its zero", () => {
  it("carries a paying-customer figure beside the org count", () => {
    const src = read("server/services/unitEconomics.ts");
    // computeAllOrgs snapshots EVERY org, so the snapshot count includes free
    // tiers, trials and the demo org — calling it "customers" overstated it.
    expect(src).toMatch(/payingCustomers: figure\(/);
    expect(src).toContain("count of ORGS with a latest snapshot (includes free/trial)");
    const cmp = read("client/src/components/founder/UnitEconomicsReceipt.tsx");
    expect(cmp).toContain('label="Orgs with a snapshot"');
    expect(cmp).toMatch(/paying`/);
  });

  it("the roll-up cost carries its billed-event evidence, and unknown is not zero", () => {
    const src = read("server/services/unitEconomics.ts");
    expect(src).toMatch(/billedEvents: figure\(/);
    // Null when no org row carried a readable count — "nothing billed" and
    // "we could not read what was billed" are different facts.
    expect(src).toMatch(/countsByOrg\.size === 0\s*\n?\s*\?\s*null/);
    const cmp = read("client/src/components/founder/UnitEconomicsReceipt.tsx");
    expect(cmp).toMatch(/across \$\{rollup\.billedEvents\.value\.toLocaleString\(\)\} billed events/);
    expect(cmp).toContain("billed-event count unavailable");
  });
});

describe("fleet-9 catch — stale arithmetic stops speaking in the present tense", () => {
  it("freshness carries an AGE and a declared staleness threshold", () => {
    const src = read("server/services/unitEconomics.ts");
    expect(src).toMatch(/export const RECEIPT_STALE_AFTER_DAYS = \d+;/);
    expect(src).toMatch(/ageDays: number \| null;/);
    expect(src).toMatch(/stale: boolean;/);
    expect(src).toMatch(/const stale = ageDays !== null && ageDays > RECEIPT_STALE_AFTER_DAYS;/);
  });

  it("the pass/fail floor verdict is suppressed once the roll-up is stale", () => {
    const cmp = read("client/src/components/founder/UnitEconomicsReceipt.tsx");
    // A verdict against the margin floor is a present-tense claim; months-old
    // snapshots cannot back it.
    expect(cmp).toMatch(/receipt\.belowFloor !== null && !receipt\.freshness\.stale/);
  });
});

describe("fleet-9 catch — the not-measured list names what is actually billed", () => {
  it("map-tile serving names the vendor billing today, not only the unshipped plan", () => {
    const src = read("server/services/unitEconomics.ts");
    // PMTiles is unshipped, but Mapbox ships TODAY and its tile loads are a
    // real incurred cost that posts nothing to financial_ledger.
    expect(src).toContain("Mapbox is the default engine today");
    expect(src).not.toMatch(/map-tile serving \(PMTiles bet — not yet shipped, so not yet billed\)/);
  });
});
