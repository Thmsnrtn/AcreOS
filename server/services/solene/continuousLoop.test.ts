/**
 * Tests for Solene continuous-loop service (Phase 7).
 *
 * Coverage:
 *  - composeMorningPulse happy path with all sources returning values
 *  - composeMorningPulse graceful degradation when one source throws
 *  - renderOneLine canonical format correctness
 *  - persistMorningPulse + getLatestMorningPulse round-trip
 *  - runContinuousTick happy path counters
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Logger mock — silence noise from the safe-loader warnings.
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// In-memory db: pulse store + selectable rows for the per-source loaders.
// ---------------------------------------------------------------------------

interface PulseStoreRow {
  id: number;
  generatedAt: Date;
  snapshot: any;
}
const PULSE_STORE: PulseStoreRow[] = [];
let NEXT_PULSE_ID = 1;

function resetStores() {
  PULSE_STORE.length = 0;
  NEXT_PULSE_ID = 1;
}

// Per-source canned responses — tests flip these to simulate failures.
const SOURCES = {
  capital: {
    weeklyTotal: 12.34,
    envelopeStatus: "green" as "green" | "amber" | "red",
    throwWeekly: false,
    throwEnvelope: false,
  },
  founderCollab: {
    asks: [] as Array<{ urgency: string }>,
    throw: false,
  },
  dispatchActivity: {
    rows: [] as Array<{ queue: { status: string; completedAt: Date | null } }>,
    throw: false,
  },
  onboarding: {
    summary: {
      totalSignups: 5,
      totalFirstValue: 2,
      windowDays: 7,
      firstValueRate: 0.4,
      medianTimeToFirstValueSeconds: null,
      p50TimeToFirstValueSeconds: null,
      p90TimeToFirstValueSeconds: null,
      belowNinetySecondThreshold: 0,
      abandonmentByStep: {},
    },
    throw: false,
  },
  compliance: { openCount: 1, throw: false },
  agentActivity: {
    rows: [
      { agentRole: "iris", n: 3, last: new Date("2026-06-04T10:00:00Z") },
      { agentRole: "soren", n: 1, last: new Date("2026-06-04T09:30:00Z") },
    ],
    throw: false,
  },
  pendingReviews: { rows: [] as any[], throw: false },
};

// Mock the db module — we intercept enough select/insert/where chains to
// satisfy the service's read + write paths. The pulse table writes route
// to PULSE_STORE; everything else returns canned per-source responses.
vi.mock("../../db", () => {
  const matchesTable = (tableLike: any, name: string): boolean => {
    if (!tableLike) return false;
    // drizzle pgTable exposes a Symbol containing the table name.
    const sym = Object.getOwnPropertySymbols(tableLike).find((s) =>
      String(s).includes("Name"),
    );
    if (sym && typeof tableLike[sym] === "string") {
      return tableLike[sym] === name;
    }
    // Fallback: look for a `_` config object with the name.
    const cfg = (tableLike as any)._?.config ?? (tableLike as any)._?.table;
    if (cfg && cfg.name === name) return true;
    return false;
  };

  const buildSelectChain = (projection?: any) => {
    const chain: any = {
      _table: null as null | string,
      _where: null as any,
      _groupBy: null as any,
      _order: null as any,
      _limit: null as number | null,
      from(t: any) {
        if (matchesTable(t, "solene_morning_pulse")) this._table = "pulse";
        else if (matchesTable(t, "beatrice_reg_events")) this._table = "regwatch";
        else if (matchesTable(t, "solene_agent_identity_decisions"))
          this._table = "identity";
        else this._table = "unknown";
        return this;
      },
      where(w: any) {
        this._where = w;
        return this;
      },
      groupBy(g: any) {
        this._groupBy = g;
        return this;
      },
      orderBy(o: any) {
        this._order = o;
        return this;
      },
      limit(n: number) {
        this._limit = n;
        return this;
      },
      then(onFulfilled: (rows: any[]) => any, onRejected?: (e: any) => any) {
        return Promise.resolve(this._execute())
          .then(onFulfilled)
          .catch(onRejected);
      },
      _execute(): any[] {
        if (this._table === "pulse") {
          // Order desc by generatedAt, limit applied.
          const sorted = [...PULSE_STORE].sort(
            (a, b) => b.generatedAt.getTime() - a.generatedAt.getTime(),
          );
          const lim = this._limit ?? sorted.length;
          return sorted.slice(0, lim);
        }
        if (this._table === "regwatch") {
          if (SOURCES.compliance.throw) {
            throw new Error("regwatch simulated failure");
          }
          return [{ n: SOURCES.compliance.openCount }];
        }
        if (this._table === "identity") {
          if (SOURCES.agentActivity.throw) {
            throw new Error("identity simulated failure");
          }
          return SOURCES.agentActivity.rows.map((r) => ({
            agentRole: r.agentRole,
            decisionsRecorded: r.n,
            lastActivityAt: r.last,
          }));
        }
        return [];
      },
    };
    void projection;
    return chain;
  };

  const db = {
    select: (projection?: any) => buildSelectChain(projection),
    insert: (table: any) => ({
      values: (row: any) => ({
        returning: (_proj: any) => {
          if (matchesTable(table, "solene_morning_pulse")) {
            const id = NEXT_PULSE_ID++;
            PULSE_STORE.push({
              id,
              generatedAt: row.generatedAt ?? new Date(),
              snapshot: row.snapshot,
            });
            return Promise.resolve([{ id }]);
          }
          return Promise.resolve([{ id: 0 }]);
        },
      }),
    }),
  };
  return { db };
});

// ---------------------------------------------------------------------------
// Mock the per-source services. These are dynamically imported by the
// service so we mock the module specifiers.
// ---------------------------------------------------------------------------

vi.mock("./capitalTracker", () => ({
  getSpendSummary: vi.fn(async (_windowHours: number) => {
    if (SOURCES.capital.throwWeekly) {
      throw new Error("capital weekly simulated failure");
    }
    return {
      totalUsd: SOURCES.capital.weeklyTotal,
      byType: {},
      eventCount: 1,
    };
  }),
  getMonthlyEnvelopeStatus: vi.fn(async () => {
    if (SOURCES.capital.throwEnvelope) {
      throw new Error("capital envelope simulated failure");
    }
    return {
      envelopeUsd: 50,
      monthToDateUsd: 5,
      percentUsed: 10,
      daysIntoMonth: 1,
      projectedMonthlyUsd: 30,
      status: SOURCES.capital.envelopeStatus,
    };
  }),
}));

vi.mock("./founderCollab", () => ({
  listOpenAsks: vi.fn(async () => {
    if (SOURCES.founderCollab.throw) {
      throw new Error("collab simulated failure");
    }
    return SOURCES.founderCollab.asks;
  }),
}));

vi.mock("./dispatchQueue", () => ({
  listDispatches: vi.fn(async (_opts: any) => {
    if (SOURCES.dispatchActivity.throw) {
      throw new Error("dispatch simulated failure");
    }
    return SOURCES.dispatchActivity.rows;
  }),
}));

vi.mock("./codeReviewQueue", () => ({
  listPendingReviews: vi.fn(async () => {
    if (SOURCES.pendingReviews.throw) {
      throw new Error("reviews simulated failure");
    }
    return SOURCES.pendingReviews.rows;
  }),
}));

vi.mock("../onboarding/firstValueInstrumentation", () => ({
  getFunnelSummary: vi.fn(async (_w: number) => {
    if (SOURCES.onboarding.throw) {
      throw new Error("funnel simulated failure");
    }
    return SOURCES.onboarding.summary;
  }),
}));

// ---------------------------------------------------------------------------
// Per-test reset.
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStores();
  SOURCES.capital.weeklyTotal = 12.34;
  SOURCES.capital.envelopeStatus = "green";
  SOURCES.capital.throwWeekly = false;
  SOURCES.capital.throwEnvelope = false;
  SOURCES.founderCollab.asks = [];
  SOURCES.founderCollab.throw = false;
  SOURCES.dispatchActivity.rows = [];
  SOURCES.dispatchActivity.throw = false;
  SOURCES.onboarding.summary.totalSignups = 5;
  SOURCES.onboarding.summary.totalFirstValue = 2;
  SOURCES.onboarding.throw = false;
  SOURCES.compliance.openCount = 1;
  SOURCES.compliance.throw = false;
  SOURCES.agentActivity.rows = [
    { agentRole: "iris", n: 3, last: new Date("2026-06-04T10:00:00Z") },
    { agentRole: "soren", n: 1, last: new Date("2026-06-04T09:30:00Z") },
  ];
  SOURCES.agentActivity.throw = false;
  SOURCES.pendingReviews.rows = [];
  SOURCES.pendingReviews.throw = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// composeMorningPulse
// ---------------------------------------------------------------------------

describe("composeMorningPulse", () => {
  it("happy path: all sources return values; pulse is well-formed", async () => {
    SOURCES.founderCollab.asks = [
      { urgency: "urgent" },
      { urgency: "normal" },
      { urgency: "low" },
    ];
    const now = Date.now();
    SOURCES.dispatchActivity.rows = [
      {
        queue: { status: "completed", completedAt: new Date(now - 60_000) },
      },
      {
        queue: { status: "failed", completedAt: new Date(now - 120_000) },
      },
      // Stale (>24h) — should be excluded from the 24h counters.
      {
        queue: {
          status: "completed",
          completedAt: new Date(now - 30 * 60 * 60 * 1000),
        },
      },
    ];

    const { composeMorningPulse } = await import("./continuousLoop");
    const snap = await composeMorningPulse();

    expect(snap.weeklySpendUsd).toBeCloseTo(12.34, 2);
    expect(snap.envelopeStatus).toBe("green");
    expect(snap.asksOpenCount).toBe(3);
    expect(snap.asksUrgentCount).toBe(1);
    expect(snap.decisionsWaitingCount).toBe(3);
    expect(snap.dispatchesCompletedLast24h).toBe(1);
    expect(snap.dispatchesFlaggedLast24h).toBe(1);
    expect(snap.complianceOpenCount).toBe(1);
    expect(snap.trials).toBe(3); // 5 signups - 2 first-value
    expect(snap.agentActivity.length).toBe(2);
    expect(snap.agentActivity[0]).toMatchObject({
      agentRole: "iris",
      decisionsRecorded: 3,
    });
    expect(snap.oneLine).toContain("MRR");
    expect(snap.oneLine).toContain("trials");
    expect(snap.oneLine).toContain("uptime");
    // Kernel-restructure step 5: the constitutional decision budget rides on
    // every pulse; with no decision rows the consumption is an honest zero.
    expect(snap.founderDecisionsBudget).toBe(5);
    expect(snap.founderDecisionsUsedThisWeek).toBe(0);
    expect(snap.oneLine).toContain("0/5 decisions used");
    expect(snap.dayLabel).toMatch(/^[A-Z][a-z]{2} \d{4}-\d{2}-\d{2}$/);
  });

  it("graceful degradation: capital source throws → pulse uses defaults", async () => {
    SOURCES.capital.throwWeekly = true;
    SOURCES.capital.throwEnvelope = true;

    const { composeMorningPulse } = await import("./continuousLoop");
    const snap = await composeMorningPulse();

    // Capital loader catches and falls back to defaults — service should
    // never propagate the underlying error.
    expect(snap.weeklySpendUsd).toBe(0);
    expect(snap.envelopeStatus).toBe("green");
    // Other sources still produced their values.
    expect(snap.complianceOpenCount).toBe(1);
  });

  it("graceful degradation: compliance source throws → openCount=0", async () => {
    SOURCES.compliance.throw = true;

    const { composeMorningPulse } = await import("./continuousLoop");
    const snap = await composeMorningPulse();

    expect(snap.complianceOpenCount).toBe(0);
    // Other sources still good.
    expect(snap.weeklySpendUsd).toBeCloseTo(12.34, 2);
  });
});

// ---------------------------------------------------------------------------
// renderOneLine
// ---------------------------------------------------------------------------

describe("renderOneLine", () => {
  it("matches the canonical team_solene brief format", async () => {
    const { renderOneLine } = await import("./continuousLoop");
    const oneLine = renderOneLine({
      generatedAt: new Date("2026-06-04T12:00:00Z"),
      dayLabel: "Thu 2026-06-04",
      oneLine: "",
      mrr: 1234,
      trials: 3,
      uptimePct: 99.9,
      prodVersion: "abcd1234",
      complianceOpenCount: 0,
      weeklySpendUsd: 4.21,
      decisionsWaitingCount: 2,
      autonomyHorizonDays: 5,
      envelopeStatus: "green",
      founderDecisionsUsedThisWeek: 3,
      founderDecisionsBudget: 5,
      dispatchesCompletedLast24h: 0,
      dispatchesFlaggedLast24h: 0,
      asksOpenCount: 0,
      asksUrgentCount: 0,
      agentActivity: [],
    });
    expect(oneLine).toBe(
      "Thu 2026-06-04 · $1,234 MRR · +3 trials · 99.9% uptime · 0/0 compliance · $4.21 week-cost · 2 decisions waiting · 3/5 decisions used · Horizon: 5 days",
    );
  });

  it("HONESTY: unmeasured uptime reads 'uptime n/a' — never a fabricated 99.9%", async () => {
    const { renderOneLine } = await import("./continuousLoop");
    const oneLine = renderOneLine({
      generatedAt: new Date("2026-06-04T12:00:00Z"),
      dayLabel: "Thu 2026-06-04",
      oneLine: "",
      mrr: 0,
      trials: 0,
      uptimePct: null,
      prodVersion: "abcd1234",
      complianceOpenCount: 0,
      weeklySpendUsd: 0,
      decisionsWaitingCount: 0,
      autonomyHorizonDays: 7,
      envelopeStatus: "green",
      founderDecisionsUsedThisWeek: null,
      founderDecisionsBudget: 5,
      dispatchesCompletedLast24h: 0,
      dispatchesFlaggedLast24h: 0,
      asksOpenCount: 0,
      asksUrgentCount: 0,
      agentActivity: [],
    });
    expect(oneLine).toContain("uptime n/a");
    expect(oneLine).not.toContain("99.9");
    // Kernel-restructure step 5: an unmeasured decisions-used metric reads
    // n/a — never a fabricated 0/5.
    expect(oneLine).toContain("decisions used n/a");
    expect(oneLine).not.toContain("0/5 decisions used");
  });
});

// ---------------------------------------------------------------------------
// persistMorningPulse + getLatestMorningPulse
// ---------------------------------------------------------------------------

describe("persist + getLatest round-trip", () => {
  it("inserts and reads back the snapshot", async () => {
    const { composeMorningPulse, persistMorningPulse, getLatestMorningPulse } =
      await import("./continuousLoop");

    const snap = await composeMorningPulse();
    const { pulseId } = await persistMorningPulse(snap);
    expect(pulseId).toBeGreaterThan(0);

    const latest = await getLatestMorningPulse();
    expect(latest).not.toBeNull();
    expect(latest?.oneLine).toBe(snap.oneLine);
    expect(latest?.dayLabel).toBe(snap.dayLabel);
    expect(latest?.complianceOpenCount).toBe(snap.complianceOpenCount);
    expect(latest?.envelopeStatus).toBe(snap.envelopeStatus);
  });

  it("getLatestMorningPulse returns the most-recent of multiple rows", async () => {
    const { composeMorningPulse, persistMorningPulse, getLatestMorningPulse } =
      await import("./continuousLoop");

    const earlier = await composeMorningPulse();
    earlier.generatedAt = new Date("2026-06-03T12:00:00Z");
    earlier.dayLabel = "Wed 2026-06-03";
    await persistMorningPulse(earlier);

    const later = await composeMorningPulse();
    later.generatedAt = new Date("2026-06-04T12:00:00Z");
    later.dayLabel = "Thu 2026-06-04";
    await persistMorningPulse(later);

    const latest = await getLatestMorningPulse();
    expect(latest?.dayLabel).toBe("Thu 2026-06-04");
  });

  it("getLatestMorningPulse returns null when no rows", async () => {
    const { getLatestMorningPulse } = await import("./continuousLoop");
    const latest = await getLatestMorningPulse();
    expect(latest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runContinuousTick
// ---------------------------------------------------------------------------

describe("runContinuousTick", () => {
  it("happy path returns structured counters", async () => {
    SOURCES.founderCollab.asks = [
      { urgency: "urgent" },
      { urgency: "normal" },
    ];
    SOURCES.dispatchActivity.rows = [
      { queue: { status: "completed", completedAt: new Date() } },
    ];

    const { runContinuousTick } = await import("./continuousLoop");
    const result = await runContinuousTick();

    expect(result.ranAt).toBeInstanceOf(Date);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.errors).toBe(0);
    // 2 asks + 1 dispatch + 0 reviews = 3 signals scanned.
    expect(result.signalsScanned).toBe(3);
    // Only the urgent ask increments the founder-page counter.
    expect(result.asksFiredToFounder).toBe(1);
    // No pulse row exists yet → tick should refresh it.
    expect(result.morningPulseRefreshed).toBe(true);
  });

  it("increments error counter when a source throws", async () => {
    SOURCES.founderCollab.throw = true;
    SOURCES.dispatchActivity.throw = true;

    const { runContinuousTick } = await import("./continuousLoop");
    const result = await runContinuousTick();

    // Both throwing sources contribute one error each; pulse compose itself
    // tolerates the underlying source failures via safeLoad* wrappers, so
    // only the direct scan calls in runContinuousTick surface errors.
    expect(result.errors).toBeGreaterThanOrEqual(2);
  });
});
