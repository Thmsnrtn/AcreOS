/**
 * worstDay.test.ts — the founder's single worst-day number stays honest.
 *
 * composeWorstDayBound (server/services/autopilot/worstDay.ts) is the pure
 * composition of the REAL enforced caps:
 *
 *   boundCents = min(hardCapCents, spendRemainingCents) + aiDailyCeilingCents
 *
 * These tests lock in:
 *   1. The composition math against the real default constants
 *      (AI platform ceiling 1500¢/$15 · financial hard cap 2_500_000¢/$25,000).
 *   2. The no-fabrication contract: unreadable/absent inputs come back as
 *      honest nulls (with caveats), NEVER as zeros pretending to be real —
 *      and boundCents is null unless every component resolved.
 *   3. Caveats are always non-empty when a bound is shown (the model's
 *      limits ride along with the number).
 */

import { describe, it, expect } from "vitest";
import { composeWorstDayBound } from "../../server/services/autopilot/worstDay";

describe("composeWorstDayBound — composition math", () => {
  it("bound = min(hardCap, spendRemaining) + aiCeiling when envelopes < hard cap", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: 1500, // real platform default ($15/day)
      envelopeRemainingCents: [500_000, 300_000, 200_000, 100_000], // the four default envelopes, untouched
      hardCapCents: 2_500_000, // real default hard cap ($25,000)
    });
    expect(b.aiDailyCeilingCents).toBe(1500);
    expect(b.spendRemainingCents).toBe(1_100_000);
    expect(b.hardCapCents).toBe(2_500_000);
    // min(2_500_000, 1_100_000) + 1500
    expect(b.boundCents).toBe(1_101_500);
  });

  it("the hard cap binds when remaining envelopes exceed it", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: 1500,
      envelopeRemainingCents: [2_000_000, 2_000_000],
      hardCapCents: 2_500_000,
    });
    expect(b.spendRemainingCents).toBe(4_000_000);
    expect(b.boundCents).toBe(2_500_000 + 1500);
  });

  it("overspent (negative-remaining) envelopes contribute 0, not negative", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: 1500,
      envelopeRemainingCents: [-50_000, 100_000],
      hardCapCents: 2_500_000,
    });
    expect(b.spendRemainingCents).toBe(100_000);
    expect(b.boundCents).toBe(101_500);
  });

  it("all envelopes fully spent → bound is exactly the AI ceiling", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: 1500,
      envelopeRemainingCents: [0, 0],
      hardCapCents: 2_500_000,
    });
    expect(b.spendRemainingCents).toBe(0);
    expect(b.boundCents).toBe(1500);
  });
});

describe("composeWorstDayBound — honesty contract (nulls, never fake zeros)", () => {
  it("unreadable envelopes → spendRemaining null, bound null, caveat says so", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: 1500,
      envelopeRemainingCents: null,
      hardCapCents: 2_500_000,
    });
    expect(b.spendRemainingCents).toBeNull();
    expect(b.boundCents).toBeNull();
    expect(b.spendRemainingCents).not.toBe(0);
    expect(b.caveats.some((c) => /could not be read/i.test(c))).toBe(true);
  });

  it("EMPTY envelope list is unknowable (lazy-created defaults), not zero", () => {
    // Envelopes are created with default budgets on first spend, so an empty
    // month must never be presented as "$0 spendable".
    const b = composeWorstDayBound({
      aiDailyCeilingCents: 1500,
      envelopeRemainingCents: [],
      hardCapCents: 2_500_000,
    });
    expect(b.spendRemainingCents).toBeNull();
    expect(b.boundCents).toBeNull();
    expect(b.caveats.some((c) => /no agent budget envelopes exist/i.test(c))).toBe(true);
  });

  it("unreadable AI ceiling → null AI side, null bound", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: null,
      envelopeRemainingCents: [100_000],
      hardCapCents: 2_500_000,
    });
    expect(b.aiDailyCeilingCents).toBeNull();
    expect(b.boundCents).toBeNull();
    expect(b.caveats.length).toBeGreaterThan(0);
  });

  it("unreadable hard cap → null bound even with envelopes + ceiling present", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: 1500,
      envelopeRemainingCents: [100_000],
      hardCapCents: null,
    });
    expect(b.hardCapCents).toBeNull();
    expect(b.boundCents).toBeNull();
  });

  it("everything unreadable → all nulls, multiple honest caveats", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: null,
      envelopeRemainingCents: null,
      hardCapCents: null,
    });
    expect(b.aiDailyCeilingCents).toBeNull();
    expect(b.spendRemainingCents).toBeNull();
    expect(b.hardCapCents).toBeNull();
    expect(b.boundCents).toBeNull();
    expect(b.caveats.length).toBeGreaterThanOrEqual(3);
  });

  it("non-finite garbage inputs are treated as unreadable, not passed through", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: Number.NaN,
      envelopeRemainingCents: [Number.POSITIVE_INFINITY, 100_000],
      hardCapCents: Number.NEGATIVE_INFINITY,
    });
    expect(b.aiDailyCeilingCents).toBeNull();
    expect(b.hardCapCents).toBeNull();
    // The infinite envelope entry contributes 0 (unknowable), the finite one counts.
    expect(b.spendRemainingCents).toBe(100_000);
    expect(b.boundCents).toBeNull();
  });
});

describe("composeWorstDayBound — caveats ride along with the number", () => {
  it("a computed bound always carries non-empty caveats stating the model's limits", () => {
    const b = composeWorstDayBound({
      aiDailyCeilingCents: 1500,
      envelopeRemainingCents: [500_000],
      hardCapCents: 2_500_000,
    });
    expect(b.boundCents).not.toBeNull();
    expect(b.caveats.length).toBeGreaterThan(0);
    // The two limits the audit named explicitly:
    expect(b.caveats.some((c) => /no per-day cap/i.test(c))).toBe(true);
    expect(b.caveats.some((c) => /reset monthly/i.test(c))).toBe(true);
    // And the constitutional per-transaction stop:
    expect(b.caveats.some((c) => /\$500/.test(c))).toBe(true);
  });
});
