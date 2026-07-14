/**
 * gradeRecentDecisions ownership split (Horizon A1).
 *
 * The 3-7-day heuristic grader must SKIP any item that carries a
 * prediction (checkInDate set) — those belong to the outcome ledger's
 * 30/90-day scorer — and must never grade the ledger's own
 * outcome_check_in cards. Legacy items without predictions keep the
 * heuristic behavior. The skip is applied both in SQL and in process;
 * this mock ignores WHERE clauses, so the assertions pin the in-process
 * guard (the repo's test-pinning convention).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/decisionExperiments", () => ({
  recordExperimentOutcome: vi.fn(async () => {}),
}));

const ROWS: any[] = [];
const UPDATES: Array<{ set: any; whereValue: unknown }> = [];

vi.mock("../../server/db", () => {
  const eqValue = (w: any): unknown => {
    const chunks: any[] = w?.queryChunks ?? [];
    for (const c of chunks) {
      if (c && typeof c === "object" && "encoder" in c && "value" in c) return c.value;
    }
    return undefined;
  };
  const db = {
    select: (_proj?: any) => ({
      from(_t: any) {
        return this;
      },
      where(_w: any) {
        return this;
      },
      groupBy(..._g: any[]) {
        return this;
      },
      then(onFulfilled: (rows: any[]) => any, onRejected?: (e: any) => any) {
        return Promise.resolve([...ROWS]).then(onFulfilled, onRejected);
      },
    }),
    update: (_t: any) => ({
      set: (v: any) => ({
        where: (w: any) => {
          UPDATES.push({ set: v, whereValue: eqValue(w) });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

import { gradeRecentDecisions } from "../../server/services/autonomyHealth";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

// Rows resolve via the founder-resolved branch (score +1) so grading needs
// no secondary recurrence query.
function legacyRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    itemType: "support_escalation",
    status: "approved",
    resolvedBy: "founder",
    resolvedAt: daysAgo(4),
    founderOverrideAction: null,
    organizationId: null,
    outcomeScore: null,
    checkInDate: null,
    ...overrides,
  };
}

beforeEach(() => {
  ROWS.length = 0;
  UPDATES.length = 0;
});

describe("gradeRecentDecisions — Horizon A1 ownership split", () => {
  it("skips prediction-bearing items (checkInDate set) — the outcome ledger owns those", async () => {
    ROWS.push(
      legacyRow({ id: 1 }),
      legacyRow({ id: 2, checkInDate: daysAgo(-26) }), // ledger-owned: 30d check-in ahead
      legacyRow({ id: 3, checkInDate: daysAgo(1) }), // ledger-owned even when overdue
    );

    const { graded } = await gradeRecentDecisions();

    expect(graded).toBe(1);
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].whereValue).toBe(1);
    expect(UPDATES[0].set.outcomeScore).toBe(1);
  });

  it("never grades the ledger's own outcome_check_in cards", async () => {
    ROWS.push(
      legacyRow({ id: 4, itemType: "outcome_check_in", contextBundle: { outcomeCheckInFor: 1 } }),
    );

    const { graded } = await gradeRecentDecisions();

    expect(graded).toBe(0);
    expect(UPDATES).toHaveLength(0);
  });

  it("legacy items without predictions keep the heuristic behavior", async () => {
    ROWS.push(legacyRow({ id: 5, founderOverrideAction: "reverse" }));

    const { graded } = await gradeRecentDecisions();

    expect(graded).toBe(1);
    expect(UPDATES[0].set.outcomeScore).toBe(-2);
    expect(UPDATES[0].set.actualOutcome).toContain("Founder reversed");
  });
});
