/**
 * Tests for Solene capital tracker.
 *
 * Coverage:
 *  - recordCapitalEvent never throws (DB failure, invalid input)
 *  - getSpendSummary returns rolled-up totals by type
 *  - getMonthlyEnvelopeStatus envelope + amber/red thresholds + projection
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

interface CapitalEventRow {
  id: number;
  occurredAt: Date;
  eventType: string;
  costUsd: string; // numeric stored as string by drizzle
  contextSummary: string;
  sessionToken: string | null;
}

const EVENTS: CapitalEventRow[] = [];
let nextEventId = 1;
let throwOnInsert = false;

vi.mock("../../db", () => {
  const db = {
    insert: (_table: unknown) => ({
      values: (row: any) => {
        if (throwOnInsert) {
          return Promise.reject(new Error("simulated db failure"));
        }
        EVENTS.push({
          id: nextEventId++,
          occurredAt: row.occurredAt ?? new Date(),
          eventType: row.eventType,
          costUsd: String(row.costUsd),
          contextSummary: row.contextSummary,
          sessionToken: row.sessionToken ?? null,
        });
        return Promise.resolve();
      },
    }),
    select: (projection?: any) => {
      const step: any = {
        _isGrouped: false,
        _projection: projection,
        from(_t: unknown) {
          return step;
        },
        where(_pred: unknown) {
          return step;
        },
        groupBy(..._: unknown[]) {
          step._isGrouped = true;
          return step;
        },
        then(onFulfilled: any, onRejected: any) {
          // Determine query shape: grouped (getSpendSummary) vs single sum (envelope)
          if (step._isGrouped) {
            // Group by event_type
            const byType = new Map<string, { sum: number; count: number }>();
            for (const e of EVENTS) {
              const bucket = byType.get(e.eventType) ?? { sum: 0, count: 0 };
              bucket.sum += Number(e.costUsd);
              bucket.count += 1;
              byType.set(e.eventType, bucket);
            }
            const rows = Array.from(byType.entries()).map(([k, v]) => ({
              eventType: k,
              sum: String(v.sum),
              count: v.count,
            }));
            return Promise.resolve(rows).then(onFulfilled, onRejected);
          }
          // Single sum query
          const sum = EVENTS.reduce((acc, e) => acc + Number(e.costUsd), 0);
          return Promise.resolve([{ sum: String(sum) }]).then(onFulfilled, onRejected);
        },
      };
      return step;
    },
  };
  return { db };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...preds: unknown[]) => preds,
    gte: (col: unknown, val: unknown) => ({ op: "gte", col, val }),
    sql: (() => {
      const tag: any = (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({ op: "sql" });
      return tag;
    })(),
  };
});

import {
  recordCapitalEvent,
  getSpendSummary,
  getMonthlyEnvelopeStatus,
  statusForPercent,
} from "./capitalTracker";

beforeEach(() => {
  EVENTS.length = 0;
  nextEventId = 1;
  throwOnInsert = false;
  delete process.env.SOLENE_MONTHLY_ENVELOPE_USD;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// recordCapitalEvent
// ────────────────────────────────────────────────────────────────────────────

describe("recordCapitalEvent", () => {
  it("inserts a row with the right shape", async () => {
    await recordCapitalEvent("agent_dispatch", 0.123, "ran sub-agent");
    expect(EVENTS).toHaveLength(1);
    expect(EVENTS[0].eventType).toBe("agent_dispatch");
    expect(Number(EVENTS[0].costUsd)).toBeCloseTo(0.123, 4);
    expect(EVENTS[0].contextSummary).toBe("ran sub-agent");
  });

  it("never throws on db failure", async () => {
    throwOnInsert = true;
    await expect(
      recordCapitalEvent("anthropic_api", 0.05, "ctx"),
    ).resolves.toBeUndefined();
    expect(EVENTS).toHaveLength(0);
  });

  it("skips invalid cost values silently", async () => {
    await recordCapitalEvent("other", NaN, "bad");
    await recordCapitalEvent("other", -1, "negative");
    expect(EVENTS).toHaveLength(0);
  });

  it("truncates context summary to 500 chars", async () => {
    await recordCapitalEvent("other", 0.01, "x".repeat(700));
    expect(EVENTS[0].contextSummary.length).toBe(500);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getSpendSummary
// ────────────────────────────────────────────────────────────────────────────

describe("getSpendSummary", () => {
  it("rolls up cost by type", async () => {
    await recordCapitalEvent("agent_dispatch", 0.5, "a");
    await recordCapitalEvent("agent_dispatch", 0.25, "b");
    await recordCapitalEvent("anthropic_api", 0.1, "c");
    await recordCapitalEvent("fly_deploy", 0.05, "d");
    const summary = await getSpendSummary(24);
    expect(summary.totalUsd).toBeCloseTo(0.9, 4);
    expect(summary.byType.agent_dispatch).toBeCloseTo(0.75, 4);
    expect(summary.byType.anthropic_api).toBeCloseTo(0.1, 4);
    expect(summary.byType.fly_deploy).toBeCloseTo(0.05, 4);
    expect(summary.eventCount).toBe(4);
  });

  it("returns zero summary on empty ledger", async () => {
    const summary = await getSpendSummary(24);
    expect(summary.totalUsd).toBe(0);
    expect(summary.eventCount).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getMonthlyEnvelopeStatus + statusForPercent
// ────────────────────────────────────────────────────────────────────────────

describe("statusForPercent", () => {
  it("returns green below 70%", () => {
    expect(statusForPercent(0)).toBe("green");
    expect(statusForPercent(69.9)).toBe("green");
  });
  it("returns amber at 70-89%", () => {
    expect(statusForPercent(70)).toBe("amber");
    expect(statusForPercent(89.9)).toBe("amber");
  });
  it("returns red at 90%+", () => {
    expect(statusForPercent(90)).toBe("red");
    expect(statusForPercent(100)).toBe("red");
    expect(statusForPercent(150)).toBe("red");
  });
});

describe("getMonthlyEnvelopeStatus", () => {
  it("uses the default envelope when env unset", async () => {
    const status = await getMonthlyEnvelopeStatus();
    expect(status.envelopeUsd).toBe(50);
    expect(status.monthToDateUsd).toBe(0);
    expect(status.percentUsed).toBe(0);
    expect(status.status).toBe("green");
  });

  it("reads SOLENE_MONTHLY_ENVELOPE_USD override", async () => {
    process.env.SOLENE_MONTHLY_ENVELOPE_USD = "100";
    const status = await getMonthlyEnvelopeStatus();
    expect(status.envelopeUsd).toBe(100);
  });

  it("computes percent + amber status when 70-89% used", async () => {
    process.env.SOLENE_MONTHLY_ENVELOPE_USD = "10";
    await recordCapitalEvent("agent_dispatch", 7, "burst");
    const status = await getMonthlyEnvelopeStatus();
    expect(status.monthToDateUsd).toBe(7);
    expect(status.percentUsed).toBe(70);
    expect(status.status).toBe("amber");
  });

  it("computes red status when 90%+ used", async () => {
    process.env.SOLENE_MONTHLY_ENVELOPE_USD = "10";
    await recordCapitalEvent("agent_dispatch", 9.5, "burst");
    const status = await getMonthlyEnvelopeStatus();
    expect(status.percentUsed).toBe(95);
    expect(status.status).toBe("red");
  });

  it("projects monthly spend from days-into-month rate", async () => {
    process.env.SOLENE_MONTHLY_ENVELOPE_USD = "100";
    await recordCapitalEvent("agent_dispatch", 5, "today");
    const status = await getMonthlyEnvelopeStatus();
    expect(status.projectedMonthlyUsd).toBeGreaterThan(0);
    expect(status.daysIntoMonth).toBeGreaterThan(0);
  });
});
