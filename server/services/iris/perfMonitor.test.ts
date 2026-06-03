/**
 * Tests for Iris perf-monitor regression detection + percentile math.
 *
 * Pure-unit coverage — no real DB. We exercise:
 *   - computePercentiles: empty input + nearest-rank semantics
 *   - medianOf: even + odd lengths
 *   - evaluateRegression: 2× multiplier threshold, absolute ceiling,
 *     minimum-sample-count guard, both-fire case.
 *   - buildPerfRegressionFixPrompt: renders all inputs into the prompt text.
 *   - detectRegression auto-dispatch wire-in: persistence gate, idempotency,
 *     error-swallowing on enqueue failure.
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

// --- DB mock (used by detectRegression + idempotency check) ----------------
//
// The two queries we serve:
//   1. SELECT * FROM iris_perf_samples WHERE endpoint_path=? AND method=? AND
//      window_started_at >= ? ORDER BY window_started_at DESC
//   2. SELECT id FROM solene_dispatch_queue WHERE source_type='detector' AND
//      source_id LIKE 'iris-perf-regression:<path>:%' AND status IN
//      ('queued','in_progress') LIMIT 1
//
// Tests stage rows into PERF_SAMPLES_BY_KEY / IN_FLIGHT_BY_PATH and assert
// against ENQUEUE_CALLS captured from the mocked enqueueDispatch.

interface SampleRow {
  id: number;
  endpointPath: string;
  method: string;
  p95Ms: string;
  sampleCount: number;
  windowStartedAt: Date;
  windowEndedAt: Date;
}

const PERF_SAMPLES_BY_KEY = new Map<string, SampleRow[]>();
/** endpointPath -> existing queued/in_progress dispatch id (for idempotency). */
const IN_FLIGHT_BY_PATH = new Map<string, number>();

const sampleKey = (path: string, method: string) => `${method} ${path}`;

vi.mock("../../db", () => {
  // Two select shapes:
  //  - perfMonitor.detectRegression: db.select().from(irisPerfSamples).where(...).orderBy(desc).
  //  - tryEnqueuePerfRegressionDispatch: db.select({id: ...}).from(soleneDispatchQueue).where(...).limit(1).
  //
  // We inspect the first call to .from(table) by reading the table's marker
  // and branching. The `table` parameter in our drizzle-orm mock is a plain
  // object we tagged at vi.mock("@shared/schema/...") time.
  function buildChain(initialTableMarker: string) {
    let path: string | null = null;
    let method: string | null = null;
    let sourceIdPrefix: string | null = null;
    let statusFilter: string[] | null = null;

    const chain: any = {
      _table: initialTableMarker,
      from: (_t: unknown) => chain,
      where: (clause: any) => {
        // clause is an object produced by our and()/eq()/like()/inArray()
        // mocks; it carries the recognised filter shape.
        if (clause?.__perfSamplesFilter) {
          path = clause.path;
          method = clause.method;
        } else if (clause?.__dispatchIdemFilter) {
          sourceIdPrefix = clause.sourceIdPrefix;
          statusFilter = clause.statuses;
        }
        return chain;
      },
      orderBy: (_o: unknown) => chain,
      limit: (_n: number) => {
        if (chain._table === "iris_perf_samples") {
          if (!path || !method) return Promise.resolve([]);
          return Promise.resolve(
            PERF_SAMPLES_BY_KEY.get(sampleKey(path, method)) ?? [],
          );
        }
        if (chain._table === "solene_dispatch_queue") {
          // Idempotency lookup. Extract path from the prefix:
          // "iris-perf-regression:<path>:".
          if (!sourceIdPrefix) return Promise.resolve([]);
          const m = sourceIdPrefix.match(
            /^iris-perf-regression:(.+):$/,
          );
          if (!m) return Promise.resolve([]);
          const p = m[1];
          const existing = IN_FLIGHT_BY_PATH.get(p);
          // Status filter is satisfied by construction in our fixtures.
          void statusFilter;
          return existing
            ? Promise.resolve([{ id: existing }])
            : Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
      // For perf-samples branch detectRegression awaits after .orderBy() with
      // no .limit() — make the chain thenable.
      then: (resolve: (rows: any[]) => unknown) => {
        if (chain._table === "iris_perf_samples") {
          if (!path || !method) return Promise.resolve([]).then(resolve);
          return Promise.resolve(
            PERF_SAMPLES_BY_KEY.get(sampleKey(path, method)) ?? [],
          ).then(resolve);
        }
        return Promise.resolve([]).then(resolve);
      },
    };
    return chain;
  }

  const db = {
    select: (_cols?: any) => ({
      from: (t: any) => buildChain(t?.__tableName ?? "unknown"),
    }),
    insert: (_t: any) => ({ values: () => Promise.resolve([]) }),
  };
  return { db };
});

vi.mock("@shared/schema/iris-perf", async () => {
  const actual =
    await vi.importActual<typeof import("@shared/schema/iris-perf")>(
      "@shared/schema/iris-perf",
    );
  return {
    ...actual,
    irisPerfSamples: {
      __tableName: "iris_perf_samples",
      endpointPath: { __col: "endpoint_path" },
      method: { __col: "method" },
      windowStartedAt: { __col: "window_started_at" },
      p95Ms: { __col: "p95_ms" },
      sampleCount: { __col: "sample_count" },
    } as any,
    // Limit the tracked endpoints to keep test fixtures small.
    IRIS_TRACKED_ENDPOINTS: [
      { path: "/api/today", method: "GET" },
      { path: "/api/healthz", method: "GET" },
    ],
  };
});

vi.mock("@shared/schema/solene-dispatch", () => ({
  soleneDispatchQueue: {
    __tableName: "solene_dispatch_queue",
    id: { __col: "id" },
    sourceType: { __col: "source_type" },
    sourceId: { __col: "source_id" },
    status: { __col: "status" },
  } as any,
}));

// Capture enqueueDispatch calls.
const ENQUEUE_CALLS: Array<Record<string, unknown>> = [];
let ENQUEUE_THROWS: string | null = null;

vi.mock("../solene/dispatchQueue", () => ({
  enqueueDispatch: vi.fn(async (opts: Record<string, unknown>) => {
    ENQUEUE_CALLS.push(opts);
    if (ENQUEUE_THROWS !== null) throw new Error(ENQUEUE_THROWS);
    return 999;
  }),
}));

// drizzle-orm helper mocks — return tagged objects our DB mock understands.
vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");

  const eq = (col: any, val: any) => ({ __eq: true, col, val });
  const gte = (col: any, val: any) => ({ __gte: true, col, val });
  const desc = (col: any) => ({ __desc: true, col });
  const like = (col: any, val: any) => ({ __like: true, col, val });
  const inArray = (col: any, vals: any[]) => ({ __inArray: true, col, vals });

  const and = (...clauses: any[]) => {
    // Recognise the two filter shapes used by perfMonitor.
    const eqs = clauses.filter((c) => c?.__eq);
    const gtes = clauses.filter((c) => c?.__gte);
    const likes = clauses.filter((c) => c?.__like);
    const inArrays = clauses.filter((c) => c?.__inArray);

    const path = eqs.find((c) => c.col?.__col === "endpoint_path")?.val;
    const method = eqs.find((c) => c.col?.__col === "method")?.val;
    if (path && method && gtes.length > 0) {
      return { __perfSamplesFilter: true, path, method };
    }

    const sourceTypeEq = eqs.find((c) => c.col?.__col === "source_type");
    const likeClause = likes[0];
    const statusInArray = inArrays.find((c) => c.col?.__col === "status");
    if (sourceTypeEq && likeClause) {
      return {
        __dispatchIdemFilter: true,
        sourceIdPrefix: likeClause.val.replace(/%$/, ""),
        statuses: statusInArray?.vals ?? [],
      };
    }

    return { __and: true, clauses };
  };

  return {
    ...actual,
    eq,
    gte,
    desc,
    like,
    inArray,
    and,
  };
});

import {
  buildPerfRegressionFixPrompt,
  computePercentiles,
  detectRegression,
  evaluateRegression,
  medianOf,
  PERF_REGRESSION_DISPATCH_MAX_COST_USD,
  PERF_REGRESSION_DISPATCH_PRIORITY,
  PERF_REGRESSION_DISPATCH_TIMEOUT_MS,
} from "./perfMonitor";
import { IRIS_REGRESSION_THRESHOLDS } from "@shared/schema/iris-perf";

describe("computePercentiles", () => {
  it("returns zeros on empty input", () => {
    const r = computePercentiles([]);
    expect(r.p50).toBe(0);
    expect(r.p95).toBe(0);
    expect(r.p99).toBe(0);
  });

  it("nearest-rank percentile on a known distribution", () => {
    // 100 values, 1..100. p50 = 50, p95 = 95, p99 = 99.
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    const r = computePercentiles(xs);
    expect(r.p50).toBe(50);
    expect(r.p95).toBe(95);
    expect(r.p99).toBe(99);
  });

  it("handles a single observation (rank clamps to 1)", () => {
    const r = computePercentiles([42]);
    expect(r.p50).toBe(42);
    expect(r.p95).toBe(42);
    expect(r.p99).toBe(42);
  });

  it("does not mutate the caller's array", () => {
    const xs = [3, 1, 2];
    computePercentiles(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("medianOf", () => {
  it("returns 0 on empty input", () => {
    expect(medianOf([])).toBe(0);
  });

  it("returns the middle on odd length", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
  });

  it("averages the middle two on even length", () => {
    expect(medianOf([4, 2, 1, 3])).toBe(2.5);
  });

  it("is unaffected by input order", () => {
    expect(medianOf([1, 2, 3, 4, 5])).toBe(medianOf([5, 4, 3, 2, 1]));
  });
});

describe("evaluateRegression", () => {
  const minSamples = IRIS_REGRESSION_THRESHOLDS.minSampleCountForAlert;

  it("returns null when sample count is below the alert minimum", () => {
    // 10× baseline AND > absolute ceiling — but only 1 sample. No fire.
    const r = evaluateRegression({
      latestP95: 5000,
      baselineP95: 100,
      latestSampleCount: 1,
    });
    expect(r).toBeNull();
  });

  it("fires 'multiplier' when latest > 2× baseline but under absolute ceiling", () => {
    // baseline = 100ms, latest = 300ms (3× > 2× threshold), absolute
    // ceiling = 1000ms → only multiplier fires.
    const r = evaluateRegression({
      latestP95: 300,
      baselineP95: 100,
      latestSampleCount: minSamples,
    });
    expect(r).toBe("multiplier");
  });

  it("fires 'absolute' when latest > 1000ms but ratio is under 2×", () => {
    // baseline = 800ms, latest = 1200ms — ratio = 1.5× (below multiplier),
    // but 1200 > 1000ms absolute ceiling.
    const r = evaluateRegression({
      latestP95: 1200,
      baselineP95: 800,
      latestSampleCount: minSamples,
    });
    expect(r).toBe("absolute");
  });

  it("fires 'both' when both thresholds are triggered", () => {
    // baseline = 100ms, latest = 2500ms — 25× ratio AND > 1000ms.
    const r = evaluateRegression({
      latestP95: 2500,
      baselineP95: 100,
      latestSampleCount: minSamples,
    });
    expect(r).toBe("both");
  });

  it("returns null on a healthy window", () => {
    const r = evaluateRegression({
      latestP95: 120,
      baselineP95: 100,
      latestSampleCount: minSamples,
    });
    expect(r).toBeNull();
  });

  it("does not fire when baseline_p95 is 0 (insufficient history)", () => {
    // baseline 0 with a non-zero latest under the absolute ceiling: no fire.
    // (The multiplier check guards on baselineP95 > 0 so we don't divide
    // by zero or treat the first-ever sample as a regression.)
    const r = evaluateRegression({
      latestP95: 500,
      baselineP95: 0,
      latestSampleCount: minSamples,
    });
    expect(r).toBeNull();
  });

  it("still fires absolute when baseline 0 but latest exceeds 1000ms ceiling", () => {
    const r = evaluateRegression({
      latestP95: 1500,
      baselineP95: 0,
      latestSampleCount: minSamples,
    });
    expect(r).toBe("absolute");
  });

  it("respects the exact 2× multiplier threshold (not-equal-to is healthy)", () => {
    // 200 / 100 = 2.0 — the multiplier check is strictly greater-than.
    const r = evaluateRegression({
      latestP95: 200,
      baselineP95: 100,
      latestSampleCount: minSamples,
    });
    expect(r).toBeNull();
  });
});

// ============================================================================
// buildPerfRegressionFixPrompt — pure prompt composition.
// ============================================================================

describe("buildPerfRegressionFixPrompt", () => {
  it("renders endpoint + numbers + recent sample ids into the prompt", () => {
    const prompt = buildPerfRegressionFixPrompt({
      endpointPath: "/api/today",
      method: "GET",
      currentP95Ms: 1234,
      baselineP95Ms: 250,
      samplingWindowCount: 2,
      recentSampleIds: [10, 11, 12],
    });
    expect(prompt).toContain("GET /api/today");
    expect(prompt).toContain("1234ms");
    expect(prompt).toContain("250ms");
    expect(prompt).toContain("4.94"); // 1234/250 ≈ 4.94
    expect(prompt).toContain("2 consecutive sampling windows");
    expect(prompt).toContain("[10, 11, 12]");
    expect(prompt).toContain("root-cause");
    expect(prompt).toContain("escalate to Solene");
  });

  it("renders Infinity ratio when baseline is 0", () => {
    const prompt = buildPerfRegressionFixPrompt({
      endpointPath: "/api/healthz",
      currentP95Ms: 1500,
      baselineP95Ms: 0,
      samplingWindowCount: 3,
      recentSampleIds: [],
    });
    expect(prompt).toContain("Infinity");
    expect(prompt).toContain("(none)");
  });
});

// ============================================================================
// detectRegression → enqueueDispatch wire-in.
// ============================================================================

function makeSampleRow(
  partial: Partial<SampleRow> & {
    id: number;
    p95Ms: number | string;
    sampleCount: number;
  },
): SampleRow {
  const now = Date.now();
  return {
    endpointPath: partial.endpointPath ?? "/api/today",
    method: partial.method ?? "GET",
    p95Ms: String(partial.p95Ms),
    sampleCount: partial.sampleCount,
    windowStartedAt:
      partial.windowStartedAt ?? new Date(now - partial.id * 30 * 60 * 1000),
    windowEndedAt:
      partial.windowEndedAt ?? new Date(now - partial.id * 30 * 60 * 1000),
    id: partial.id,
  };
}

interface SampleRow {
  id: number;
  endpointPath: string;
  method: string;
  p95Ms: string;
  sampleCount: number;
  windowStartedAt: Date;
  windowEndedAt: Date;
}

describe("detectRegression auto-dispatch wire-in", () => {
  const minSamples = IRIS_REGRESSION_THRESHOLDS.minSampleCountForAlert;

  beforeEach(() => {
    PERF_SAMPLES_BY_KEY.clear();
    IN_FLIGHT_BY_PATH.clear();
    ENQUEUE_CALLS.length = 0;
    ENQUEUE_THROWS = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues a dispatch when a regression persists across 2 windows", async () => {
    // Latest two windows are both ~10× baseline → both fire vs. their tails.
    PERF_SAMPLES_BY_KEY.set(sampleKey("/api/today", "GET"), [
      makeSampleRow({ id: 100, p95Ms: 1200, sampleCount: minSamples }),
      makeSampleRow({ id: 99, p95Ms: 1100, sampleCount: minSamples }),
      makeSampleRow({ id: 98, p95Ms: 100, sampleCount: minSamples }),
      makeSampleRow({ id: 97, p95Ms: 100, sampleCount: minSamples }),
      makeSampleRow({ id: 96, p95Ms: 100, sampleCount: minSamples }),
    ]);

    const result = await detectRegression();

    expect(result.regressions.length).toBeGreaterThan(0);
    const reg = result.regressions.find(
      (r) => r.endpointPath === "/api/today",
    );
    expect(reg).toBeDefined();
    expect(reg!.persistedWindowCount).toBeGreaterThanOrEqual(2);
    expect(reg!.severity === "medium" || reg!.severity === "high").toBe(true);
    expect(result.dispatchesEnqueued).toBe(1);

    expect(ENQUEUE_CALLS).toHaveLength(1);
    const call = ENQUEUE_CALLS[0];
    expect(call.sourceType).toBe("detector");
    expect(call.agentRole).toBe("iris");
    expect(call.enqueuedBy).toBe("iris-perf-monitor");
    expect(call.maxCostUsd).toBe(PERF_REGRESSION_DISPATCH_MAX_COST_USD);
    expect(call.timeoutMs).toBe(PERF_REGRESSION_DISPATCH_TIMEOUT_MS);
    expect(call.priority).toBe(PERF_REGRESSION_DISPATCH_PRIORITY);
    expect(String(call.sourceId)).toMatch(
      /^iris-perf-regression:\/api\/today:\d+$/,
    );
    expect(String(call.promptText)).toContain("GET /api/today");
  });

  it("does NOT enqueue when the regression only fires on the latest window", async () => {
    // Latest fires (1200 vs baseline ~100), but window before it is healthy
    // (100 vs baseline 100) — persistence count = 1, gate requires 2.
    PERF_SAMPLES_BY_KEY.set(sampleKey("/api/today", "GET"), [
      makeSampleRow({ id: 100, p95Ms: 1200, sampleCount: minSamples }),
      makeSampleRow({ id: 99, p95Ms: 100, sampleCount: minSamples }),
      makeSampleRow({ id: 98, p95Ms: 100, sampleCount: minSamples }),
      makeSampleRow({ id: 97, p95Ms: 100, sampleCount: minSamples }),
    ]);

    const result = await detectRegression();

    const reg = result.regressions.find(
      (r) => r.endpointPath === "/api/today",
    );
    expect(reg).toBeDefined();
    expect(reg!.persistedWindowCount).toBe(1);
    expect(result.dispatchesEnqueued).toBe(0);
    expect(ENQUEUE_CALLS).toHaveLength(0);
  });

  it("skips enqueue when a dispatch is already in flight for this endpoint", async () => {
    PERF_SAMPLES_BY_KEY.set(sampleKey("/api/today", "GET"), [
      makeSampleRow({ id: 100, p95Ms: 1200, sampleCount: minSamples }),
      makeSampleRow({ id: 99, p95Ms: 1100, sampleCount: minSamples }),
      makeSampleRow({ id: 98, p95Ms: 100, sampleCount: minSamples }),
      makeSampleRow({ id: 97, p95Ms: 100, sampleCount: minSamples }),
    ]);
    // Pre-existing queued dispatch for the same endpoint.
    IN_FLIGHT_BY_PATH.set("/api/today", 55);

    const result = await detectRegression();

    expect(result.regressions.find((r) => r.endpointPath === "/api/today"))
      .toBeDefined();
    expect(result.dispatchesEnqueued).toBe(0);
    expect(ENQUEUE_CALLS).toHaveLength(0);
  });

  it("swallows enqueue errors without breaking the detector", async () => {
    PERF_SAMPLES_BY_KEY.set(sampleKey("/api/today", "GET"), [
      makeSampleRow({ id: 100, p95Ms: 1200, sampleCount: minSamples }),
      makeSampleRow({ id: 99, p95Ms: 1100, sampleCount: minSamples }),
      makeSampleRow({ id: 98, p95Ms: 100, sampleCount: minSamples }),
      makeSampleRow({ id: 97, p95Ms: 100, sampleCount: minSamples }),
    ]);
    ENQUEUE_THROWS = "simulated DB down";

    const result = await detectRegression();

    expect(result.regressions.find((r) => r.endpointPath === "/api/today"))
      .toBeDefined();
    expect(ENQUEUE_CALLS).toHaveLength(1);
    expect(result.dispatchesEnqueued).toBe(0);
  });
});
