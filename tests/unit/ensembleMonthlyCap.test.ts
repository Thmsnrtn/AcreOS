/**
 * Pre-dispatch ensemble cap tests (2026-06-08 — Lena, bound-ensemble-cost).
 *
 * The multi-agent ensemble (Claude Code agent dispatches) is the single
 * largest cash cost and was the only AI spend with NO pre-call cap —
 * recordCapitalEvent persisted agent_dispatch cost only AFTER the run.
 *
 * These tests lock in the new hard pre-dispatch gate in
 * server/services/solene/capitalTracker.ts:
 *   1. A dispatch over the monthly cap THROWS EnsembleCapExceededError.
 *   2. Under the cap, it does NOT throw.
 *   3. founderOverride bypasses the cap (explicit per-dispatch escape hatch).
 *   4. The gate fails CLOSED on a DB error (the largest cash cost can never be
 *      silently unbounded by a transient DB hiccup).
 *   5. The cap is env-overridable via ENSEMBLE_MONTHLY_CAP_USD.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the DB layer ──────────────────────────────────────────────────────
// Chain used by getMonthToDateSpendForType: db.select().from().where() → rows
const mockWhere = vi.fn();

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: any[]) => mockWhere(...args),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ and: a }),
  eq: (c: any, v: any) => ({ eq: [c, v] }),
  gte: (c: any, v: any) => ({ gte: [c, v] }),
  sql: (strings: TemplateStringsArray, ...vals: any[]) => ({ sql: strings, vals }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────
import {
  assertWithinEnsembleCap,
  getEnsembleMonthlyCapUsd,
  EnsembleCapExceededError,
  EnsembleCapReadFailedError,
} from "../../server/services/solene/capitalTracker";

/** Make the MTD query resolve to a given agent_dispatch USD sum. */
function mtdReturns(sumUsd: number) {
  mockWhere.mockResolvedValue([{ sum: String(sumUsd) }]);
}

const ORIG_ENV = { ...process.env };

describe("ensemble monthly cap — pre-dispatch enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENSEMBLE_MONTHLY_CAP_USD;
    delete process.env.SOLENE_MONTHLY_ENVELOPE_USD;
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("defaults the cap to the $50 Solene envelope", () => {
    expect(getEnsembleMonthlyCapUsd()).toBe(50);
  });

  it("honors ENSEMBLE_MONTHLY_CAP_USD override", () => {
    process.env.ENSEMBLE_MONTHLY_CAP_USD = "120";
    expect(getEnsembleMonthlyCapUsd()).toBe(120);
  });

  it("throws when MTD agent_dispatch spend is at/over the RED threshold (90% of cap)", async () => {
    // cap = $50, red = $45. $46 MTD → over.
    mtdReturns(46);
    await expect(assertWithinEnsembleCap()).rejects.toBeInstanceOf(
      EnsembleCapExceededError,
    );
  });

  it("does NOT throw when MTD spend is below the RED threshold", async () => {
    // cap = $50, red = $45. $40 MTD → under.
    mtdReturns(40);
    await expect(assertWithinEnsembleCap()).resolves.toBeUndefined();
  });

  it("throws exactly at the RED threshold boundary", async () => {
    mtdReturns(45); // == red threshold
    await expect(assertWithinEnsembleCap()).rejects.toBeInstanceOf(
      EnsembleCapExceededError,
    );
  });

  it("founderOverride bypasses the cap even when over the threshold", async () => {
    mtdReturns(9999);
    await expect(
      assertWithinEnsembleCap({ founderOverride: true }),
    ).resolves.toBeUndefined();
    // Override short-circuits before any DB read.
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it("fails CLOSED on a DB error (re-audit it.2: refuse rather than risk an unbounded overspend)", async () => {
    // The ensemble dispatch is the largest cash lever. A refused dispatch is
    // fully recoverable (the row stays queued / re-enqueues); an overspend is
    // not. So an unreadable MTD spend → throw, not proceed. (The DISPLAY path,
    // getEnsembleCapStatus, still fails soft via readFailed so the dashboard
    // never crashes — only the GATE fails closed.) The founder can still force a
    // dispatch via founderOverride if the DB is degraded.
    mockWhere.mockRejectedValue(new Error("connection reset"));
    await expect(assertWithinEnsembleCap()).rejects.toBeInstanceOf(
      EnsembleCapReadFailedError,
    );
  });

  it("respects a higher env cap (more headroom before tripping)", async () => {
    process.env.ENSEMBLE_MONTHLY_CAP_USD = "100"; // red = $90
    mtdReturns(80); // under the new red threshold
    await expect(assertWithinEnsembleCap()).resolves.toBeUndefined();
    mtdReturns(95); // over
    await expect(assertWithinEnsembleCap()).rejects.toBeInstanceOf(
      EnsembleCapExceededError,
    );
  });
});
