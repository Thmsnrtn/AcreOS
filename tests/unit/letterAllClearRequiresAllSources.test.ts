/**
 * DEFECT-0129 — "Nothing needs you today." is a claim about three sources.
 *
 * The Letter composes its needs-you count from open asks, the Decisions queue
 * (the pulse) and frozen sends. A failed read of any of them collapsed to
 * zero, so a founder who was away was told nothing needed him when the system
 * simply could not check. The all-clear now requires every source READ.
 */
import { describe, it, expect } from "vitest";
import { buildFounderBrief, isQuietDay, type FounderBriefInputs } from "../../server/services/autopilot/narrate";

const green: FounderBriefInputs = {
  frozenSends: { proposed: 0, tappedByFounder: 0, autoWitnessed: 0, expiredUnseen: 0, pendingNow: 0 },
  partOfDay: "morning",
  founderName: "Tom",
  pulse: {
    mrr: 0, trials: 0, weeklySpendUsd: 12, envelopeStatus: "green", uptimePct: null,
    dispatchesCompletedLast24h: 0, dispatchesFlaggedLast24h: 0, decisionsWaitingCount: 0,
  },
  openAsks: [],
  plannedFocus: null,
  operatingMode: null,
  trustLedger: [],
};

const text = (b: unknown) => JSON.stringify(b);

describe("DEFECT-0129 — the all-clear needs every source read", () => {
  it("all three read and empty: says nothing needs you", () => {
    expect(text(buildFounderBrief(green))).toContain("Nothing needs you today.");
  });

  for (const source of ["your open questions", "the Decisions queue", "frozen sends"]) {
    it(`an unread ${source} is never reported as an all-clear`, () => {
      const brief = buildFounderBrief({ ...green, unreadSources: [source] });
      expect(text(brief)).not.toContain("Nothing needs you today.");
      expect(text(brief)).toContain(`couldn't check ${source}`);
    });
  }

  it("an unread source is never a quiet day", () => {
    const base = { needsYouCount: 0, misses: [], modelChangeNotice: null, envelopeStatus: "green" as const };
    expect(isQuietDay(base)).toBe(true);
    expect(isQuietDay({ ...base, unreadSourceCount: 1 })).toBe(false);
  });
});
