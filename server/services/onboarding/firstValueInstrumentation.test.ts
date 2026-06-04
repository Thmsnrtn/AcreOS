/**
 * Tests for the Phase D2 first-value instrumentation.
 *
 *   - deriveFunnelSnapshot pure-function path (happy + tie-break + abandon)
 *   - percentile math (p50 / p90 / single / empty)
 *   - computeFunnelMetrics with an in-memory db mock (3 orgs:
 *     2 hit first value, 1 abandoned at step 3)
 *   - Idempotency: re-running upserts (no duplicates)
 *   - getFunnelSummary thresholds (90s + abandonment by step)
 *   - getOrgFunnelDetail null-when-no-row + populated-when-row-exists
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── In-memory tables ─────────────────────────────────────────────────────

interface FakeLifecycleEvent {
  organizationId: number | null;
  eventType: string;
  occurredAt: Date;
}
interface FakePaxContext {
  organizationId: string;
  vertical: string | null;
}
interface FakeFunnelRow {
  id: number;
  orgId: string;
  measuredDate: string;
  signupAt: Date;
  firstValueAt: Date | null;
  timeToFirstValueSeconds: number | null;
  firstValueAction: string | null;
  step1CompletedAt: Date | null;
  step2CompletedAt: Date | null;
  step3CompletedAt: Date | null;
  step4CompletedAt: Date | null;
  step5CompletedAt: Date | null;
  abandonedAtStep: number | null;
  abandonedReason: string | null;
  vertical: string | null;
  updatedAt: Date;
}

const LIFECYCLE: FakeLifecycleEvent[] = [];
const PAX_CONTEXT: FakePaxContext[] = [];
const FUNNEL_ROWS: FakeFunnelRow[] = [];
let nextFunnelId = 1;

// Predicate tree — emitted by our mocked drizzle-orm helpers.
type Pred = (row: any) => boolean;

vi.mock("../../db", () => {
  const tableName = (t: unknown): string => {
    if (typeof t === "object" && t !== null) {
      const drizzleName = (t as any)[Symbol.for("drizzle:Name")];
      if (typeof drizzleName === "string") return drizzleName;
    }
    return "";
  };

  let currentSelect: {
    table: string;
    whereFn: Pred | null;
    orderByFn: ((a: any, b: any) => number) | null;
    limitN: number | null;
  } = { table: "", whereFn: null, orderByFn: null, limitN: null };

  const tableRows = (t: string): any[] => {
    if (t === "lifecycle_events") return LIFECYCLE;
    if (t === "pax_user_context") return PAX_CONTEXT;
    if (t === "onboarding_funnel_metrics") return FUNNEL_ROWS;
    return [];
  };

  const runSelect = (): any[] => {
    const { table, whereFn, orderByFn, limitN } = currentSelect;
    let rows = tableRows(table).slice();
    if (whereFn) rows = rows.filter((r) => whereFn(r));
    if (orderByFn) rows.sort(orderByFn);
    if (limitN != null) rows = rows.slice(0, limitN);
    return rows;
  };

  const makeChain = (): any => {
    currentSelect = {
      table: "",
      whereFn: null,
      orderByFn: null,
      limitN: null,
    };
    const chain: any = {
      from(t: unknown) {
        currentSelect.table = tableName(t);
        return chain;
      },
      where(p: Pred) {
        currentSelect.whereFn = p;
        return chain;
      },
      orderBy(o: any) {
        // Our mocked asc/desc helpers return a comparator directly.
        currentSelect.orderByFn = typeof o === "function" ? o : null;
        return chain;
      },
      limit(n: number) {
        currentSelect.limitN = n;
        return Promise.resolve(runSelect());
      },
      then(resolve: any) {
        return Promise.resolve(runSelect()).then(resolve);
      },
    };
    return chain;
  };

  const db = {
    select(_proj?: unknown) {
      return makeChain();
    },
    insert(t: unknown) {
      const target = tableName(t);
      return {
        values(row: any) {
          let conflictUpdate: Record<string, any> | null = null;
          const builder = {
            onConflictDoUpdate(args: any) {
              conflictUpdate = args?.set ?? null;
              return Promise.resolve(performInsert());
            },
            then(resolve: any) {
              return Promise.resolve(performInsert()).then(resolve);
            },
          };
          const performInsert = () => {
            if (target !== "onboarding_funnel_metrics") return [];
            // Conflict key: (org_id, measured_date).
            const existing = FUNNEL_ROWS.find(
              (r) =>
                r.orgId === row.orgId && r.measuredDate === row.measuredDate,
            );
            if (existing) {
              if (conflictUpdate) {
                Object.assign(existing, conflictUpdate);
              }
              return [{ id: existing.id }];
            }
            const inserted: FakeFunnelRow = {
              id: nextFunnelId++,
              orgId: row.orgId,
              measuredDate: row.measuredDate,
              signupAt: row.signupAt,
              firstValueAt: row.firstValueAt ?? null,
              timeToFirstValueSeconds:
                row.timeToFirstValueSeconds ?? null,
              firstValueAction: row.firstValueAction ?? null,
              step1CompletedAt: row.step1CompletedAt ?? null,
              step2CompletedAt: row.step2CompletedAt ?? null,
              step3CompletedAt: row.step3CompletedAt ?? null,
              step4CompletedAt: row.step4CompletedAt ?? null,
              step5CompletedAt: row.step5CompletedAt ?? null,
              abandonedAtStep: row.abandonedAtStep ?? null,
              abandonedReason: row.abandonedReason ?? null,
              vertical: row.vertical ?? null,
              updatedAt: row.updatedAt ?? new Date(),
            };
            FUNNEL_ROWS.push(inserted);
            return [{ id: inserted.id }];
          };
          return builder;
        },
      };
    },
  };

  return { db };
});

// ─── drizzle-orm helpers ───────────────────────────────────────────────────

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const resolveColName = (col: any): string => {
    if (!col) return "";
    return (
      col?.name ??
      col?.fieldAlias ??
      col?.columnName ??
      col?.[Symbol.for("drizzle:Name")] ??
      ""
    );
  };
  const camel = (s: string): string =>
    s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  const valOf = (row: any, col: any): any => {
    const sqlName = resolveColName(col);
    if (!sqlName) return undefined;
    if (sqlName in row) return row[sqlName];
    const c = camel(sqlName);
    return row[c];
  };

  const eq = (col: any, value: any) => (row: any) => valOf(row, col) === value;
  const and =
    (...preds: any[]) =>
    (row: any) =>
      preds.every((p) => (typeof p === "function" ? p(row) : true));
  const gte = (col: any, value: any) => (row: any) => {
    const v = valOf(row, col);
    if (v instanceof Date && value instanceof Date) {
      return v.getTime() >= value.getTime();
    }
    return v >= value;
  };
  const inArray = (col: any, values: any[]) => (row: any) => {
    const v = valOf(row, col);
    return values.includes(v);
  };
  const desc = (col: any) => (a: any, b: any) => {
    const av = valOf(a, col);
    const bv = valOf(b, col);
    if (av instanceof Date && bv instanceof Date) {
      return bv.getTime() - av.getTime();
    }
    if (typeof av === "string" && typeof bv === "string") {
      return bv.localeCompare(av);
    }
    return (bv ?? 0) - (av ?? 0);
  };
  const asc = (col: any) => (a: any, b: any) => {
    const av = valOf(a, col);
    const bv = valOf(b, col);
    if (av instanceof Date && bv instanceof Date) {
      return av.getTime() - bv.getTime();
    }
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv);
    }
    return (av ?? 0) - (bv ?? 0);
  };
  return { ...actual, eq, and, gte, inArray, desc, asc };
});

// ─── Test bed reset ────────────────────────────────────────────────────────

beforeEach(() => {
  LIFECYCLE.length = 0;
  PAX_CONTEXT.length = 0;
  FUNNEL_ROWS.length = 0;
  nextFunnelId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// SUT — imported AFTER mocks so module init binds to the fakes.
import {
  computeFunnelMetrics,
  deriveFunnelSnapshot,
  getFunnelSummary,
  getOrgFunnelDetail,
  percentile,
} from "./firstValueInstrumentation";

// ─── deriveFunnelSnapshot ──────────────────────────────────────────────────

describe("deriveFunnelSnapshot", () => {
  const signupAt = new Date("2026-06-01T10:00:00Z");
  const now = new Date("2026-06-03T10:00:00Z");

  it("picks the EARLIER qualifying event when an org has multiple", () => {
    const events = [
      // pax.first_message at +60s
      {
        organizationId: 1,
        eventType: "pax.first_message",
        occurredAt: new Date("2026-06-01T10:01:00Z"),
      },
      // property.created at +30s — earlier, should win
      {
        organizationId: 1,
        eventType: "property.created",
        occurredAt: new Date("2026-06-01T10:00:30Z"),
      },
    ];
    const snap = deriveFunnelSnapshot({
      orgId: 1,
      signupAt,
      events,
      vertical: "land_investing",
      now,
    });
    expect(snap.firstValueAction).toBe("property.created");
    expect(snap.timeToFirstValueSeconds).toBe(30);
    expect(snap.vertical).toBe("land_investing");
    expect(snap.abandonedAtStep).toBeNull();
  });

  it("returns null TTFV when no qualifying events have fired", () => {
    const events = [
      {
        organizationId: 2,
        eventType: "onboarding.step_1_completed",
        occurredAt: new Date("2026-06-01T10:00:30Z"),
      },
    ];
    // now is only ~2 days after signup — under the 7-day abandonment window
    const snap = deriveFunnelSnapshot({
      orgId: 2,
      signupAt,
      events,
      vertical: null,
      now,
    });
    expect(snap.firstValueAt).toBeNull();
    expect(snap.timeToFirstValueSeconds).toBeNull();
    expect(snap.stepCompletedAt[1]).toEqual(
      new Date("2026-06-01T10:00:30Z"),
    );
    expect(snap.abandonedAtStep).toBeNull();
  });

  it("marks abandonment after the threshold window", () => {
    // Last activity: step 2 completed on 2026-05-25. now = 2026-06-03 → 9 days.
    const oldSignup = new Date("2026-05-24T10:00:00Z");
    const events = [
      {
        organizationId: 3,
        eventType: "onboarding.step_1_completed",
        occurredAt: new Date("2026-05-24T10:00:30Z"),
      },
      {
        organizationId: 3,
        eventType: "onboarding.step_2_completed",
        occurredAt: new Date("2026-05-25T10:00:00Z"),
      },
    ];
    const snap = deriveFunnelSnapshot({
      orgId: 3,
      signupAt: oldSignup,
      events,
      vertical: null,
      now,
    });
    expect(snap.abandonedAtStep).toBe(3);
    expect(snap.abandonedReason).toMatch(/no activity/);
  });

  it("clamps abandonedAtStep at 5 when step 4 was completed but step 5 was not", () => {
    const oldSignup = new Date("2026-05-24T10:00:00Z");
    const events = [
      {
        organizationId: 4,
        eventType: "onboarding.step_4_completed",
        occurredAt: new Date("2026-05-24T11:00:00Z"),
      },
    ];
    const snap = deriveFunnelSnapshot({
      orgId: 4,
      signupAt: oldSignup,
      events,
      vertical: null,
      now,
    });
    expect(snap.abandonedAtStep).toBe(5);
  });
});

// ─── percentile ────────────────────────────────────────────────────────────

describe("percentile", () => {
  it("returns null on empty input", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("returns the lone value on a single-element array", () => {
    expect(percentile([42], 0.9)).toBe(42);
  });

  it("computes p50 + p90 with linear interpolation (Postgres compat)", () => {
    // values = 10, 20, 30, 40, 50 → p50 = 30, p90 = 46
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.9)).toBe(46);
  });
});

// ─── computeFunnelMetrics ──────────────────────────────────────────────────

describe("computeFunnelMetrics", () => {
  it("processes 3 orgs: 2 hit first value, 1 abandoned at step 3", async () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // org 1: signup + property.created in 45s → first value
    LIFECYCLE.push({
      organizationId: 1,
      eventType: "signup.created",
      occurredAt: new Date(recent.getTime()),
    });
    LIFECYCLE.push({
      organizationId: 1,
      eventType: "property.created",
      occurredAt: new Date(recent.getTime() + 45_000),
    });

    // org 2: signup + step_5_completed in 600s → first value via full onboarding
    LIFECYCLE.push({
      organizationId: 2,
      eventType: "signup.created",
      occurredAt: new Date(recent.getTime()),
    });
    LIFECYCLE.push({
      organizationId: 2,
      eventType: "onboarding.step_5_completed",
      occurredAt: new Date(recent.getTime() + 600_000),
    });

    // org 3: signed up 10 days ago, only got through step 2 → abandoned at 3
    LIFECYCLE.push({
      organizationId: 3,
      eventType: "signup.created",
      occurredAt: longAgo,
    });
    LIFECYCLE.push({
      organizationId: 3,
      eventType: "onboarding.step_1_completed",
      occurredAt: new Date(longAgo.getTime() + 60_000),
    });
    LIFECYCLE.push({
      organizationId: 3,
      eventType: "onboarding.step_2_completed",
      occurredAt: new Date(longAgo.getTime() + 120_000),
    });

    // pax_user_context vertical for org 1.
    PAX_CONTEXT.push({ organizationId: "1", vertical: "land_investing" });

    const result = await computeFunnelMetrics({
      sinceDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    });

    expect(result.orgsProcessed).toBe(3);
    expect(result.metricsWritten).toBe(3);
    expect(result.errors).toBe(0);

    const byOrg = (id: string) =>
      FUNNEL_ROWS.find((r) => r.orgId === id)!;

    expect(byOrg("1").firstValueAction).toBe("property.created");
    expect(byOrg("1").timeToFirstValueSeconds).toBe(45);
    expect(byOrg("1").vertical).toBe("land_investing");
    expect(byOrg("1").abandonedAtStep).toBeNull();

    expect(byOrg("2").firstValueAction).toBe("onboarding.step_5_completed");
    expect(byOrg("2").timeToFirstValueSeconds).toBe(600);

    expect(byOrg("3").firstValueAt).toBeNull();
    expect(byOrg("3").abandonedAtStep).toBe(3);
    expect(byOrg("3").abandonedReason).toMatch(/no activity/);
  });

  it("is idempotent: re-running on the same day UPSERTs (no duplicates)", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 60 * 60 * 1000);

    LIFECYCLE.push({
      organizationId: 7,
      eventType: "signup.created",
      occurredAt: recent,
    });
    LIFECYCLE.push({
      organizationId: 7,
      eventType: "deal.created",
      occurredAt: new Date(recent.getTime() + 120_000),
    });

    await computeFunnelMetrics();
    await computeFunnelMetrics();

    const rowsForOrg = FUNNEL_ROWS.filter((r) => r.orgId === "7");
    expect(rowsForOrg).toHaveLength(1);
    expect(rowsForOrg[0].timeToFirstValueSeconds).toBe(120);
    expect(rowsForOrg[0].firstValueAction).toBe("deal.created");
  });
});

// ─── getFunnelSummary ──────────────────────────────────────────────────────

describe("getFunnelSummary", () => {
  it("computes p50 + p90 + 90-second threshold count correctly", async () => {
    const now = new Date();
    const today = formatYMD(now);

    // 5 orgs with known TTFV values: 30, 60, 120, 180, 600 seconds.
    // p50 = 120, p90 = 432.
    // belowNinetySecondThreshold should be 2 (the 30s + 60s orgs).
    const ttfvs = [30, 60, 120, 180, 600];
    ttfvs.forEach((s, i) => {
      FUNNEL_ROWS.push({
        id: i + 1,
        orgId: String(i + 1),
        measuredDate: today,
        signupAt: now,
        firstValueAt: new Date(now.getTime() + s * 1000),
        timeToFirstValueSeconds: s,
        firstValueAction: "property.created",
        step1CompletedAt: null,
        step2CompletedAt: null,
        step3CompletedAt: null,
        step4CompletedAt: null,
        step5CompletedAt: null,
        abandonedAtStep: null,
        abandonedReason: null,
        vertical: null,
        updatedAt: now,
      });
    });
    nextFunnelId = 6;

    // Plus 2 abandoned orgs at different steps.
    FUNNEL_ROWS.push({
      id: 6,
      orgId: "6",
      measuredDate: today,
      signupAt: now,
      firstValueAt: null,
      timeToFirstValueSeconds: null,
      firstValueAction: null,
      step1CompletedAt: null,
      step2CompletedAt: null,
      step3CompletedAt: null,
      step4CompletedAt: null,
      step5CompletedAt: null,
      abandonedAtStep: 2,
      abandonedReason: "no activity for 10 days",
      vertical: null,
      updatedAt: now,
    });
    FUNNEL_ROWS.push({
      id: 7,
      orgId: "7",
      measuredDate: today,
      signupAt: now,
      firstValueAt: null,
      timeToFirstValueSeconds: null,
      firstValueAction: null,
      step1CompletedAt: null,
      step2CompletedAt: null,
      step3CompletedAt: null,
      step4CompletedAt: null,
      step5CompletedAt: null,
      abandonedAtStep: 2,
      abandonedReason: "no activity for 10 days",
      vertical: null,
      updatedAt: now,
    });
    nextFunnelId = 8;

    const summary = await getFunnelSummary(30);
    expect(summary.totalSignups).toBe(7);
    expect(summary.totalFirstValue).toBe(5);
    expect(summary.firstValueRate).toBeCloseTo(5 / 7, 4);
    expect(summary.p50TimeToFirstValueSeconds).toBe(120);
    expect(summary.p90TimeToFirstValueSeconds).toBeCloseTo(432, 5);
    expect(summary.medianTimeToFirstValueSeconds).toBe(120);
    expect(summary.belowNinetySecondThreshold).toBe(2);
    expect(summary.abandonmentByStep[2]).toBe(2);
  });
});

// ─── getOrgFunnelDetail ────────────────────────────────────────────────────

describe("getOrgFunnelDetail", () => {
  it("returns null when org has no signup and no metric row", async () => {
    const detail = await getOrgFunnelDetail("999");
    expect(detail).toBeNull();
  });

  it("returns the qualifying event when org hit first value", async () => {
    const now = new Date();
    const today = formatYMD(now);
    const recent = new Date(now.getTime() - 60_000);
    const firstValue = new Date(now.getTime() - 30_000);

    FUNNEL_ROWS.push({
      id: 1,
      orgId: "42",
      measuredDate: today,
      signupAt: recent,
      firstValueAt: firstValue,
      timeToFirstValueSeconds: 30,
      firstValueAction: "property.created",
      step1CompletedAt: null,
      step2CompletedAt: null,
      step3CompletedAt: null,
      step4CompletedAt: null,
      step5CompletedAt: null,
      abandonedAtStep: null,
      abandonedReason: null,
      vertical: "land_investing",
      updatedAt: now,
    });
    LIFECYCLE.push({
      organizationId: 42,
      eventType: "signup.created",
      occurredAt: recent,
    });
    LIFECYCLE.push({
      organizationId: 42,
      eventType: "property.created",
      occurredAt: firstValue,
    });

    const detail = await getOrgFunnelDetail("42");
    expect(detail).not.toBeNull();
    expect(detail!.metric?.firstValueAction).toBe("property.created");
    expect(detail!.qualifyingEvent?.kind).toBe("property.created");
    expect(detail!.qualifyingEvent?.occurredAt).toEqual(firstValue);
    expect(detail!.recentEvents.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

function formatYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
