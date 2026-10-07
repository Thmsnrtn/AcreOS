/**
 * Every number the founder's Letter SAYS is a number the Letter CARRIES.
 *
 * The year simulation (2026-10-07) found the Letter saying "Overnight I
 * completed 4 tasks" while neither its own payload nor the persisted morning
 * pulse the founder can open carried a 4 — the live count was composed into
 * the sentence and dropped. The rule is the simulation's own invariant
 * (tests/simulation/invariants/registry.ts every-number-has-a-source), run
 * over the real composer with the screen extraction the simulation uses.
 */
import { describe, expect, it } from "vitest";
import { buildFounderBrief, type FounderBriefInputs } from "../../server/services/autopilot/narrate";
import { INVARIANTS, freshState } from "../simulation/invariants/registry";
import { letterScreen } from "../simulation/invariants/screens";

const base = (over: Partial<FounderBriefInputs> = {}): FounderBriefInputs => ({
  frozenSends: null,
  partOfDay: "morning",
  founderName: "Tom",
  pulse: { mrr: 1234, trials: 3, weeklySpendUsd: 41.5, envelopeStatus: "green", uptimePct: 99.9, dispatchesCompletedLast24h: 4, dispatchesFlaggedLast24h: 1, decisionsWaitingCount: 2 },
  openAsks: [],
  plannedFocus: null,
  operatingMode: null,
  trustLedger: [],
  ...over,
});

const check = INVARIANTS.find((i) => i.id === "every-number-has-a-source")!;

describe("the Letter's numbers have fields", () => {
  const cases: Array<[string, FounderBriefInputs]> = [
    ["tasks completed overnight", base()],
    ["one task", base({ pulse: { ...base().pulse, dispatchesCompletedLast24h: 1 } })],
    ["seventeen decisions waiting", base({ pulse: { ...base().pulse, decisionsWaitingCount: 17 } })],
    ["one question plus frozen sends", base({ openAsks: [{ askId: 7, summary: "Approve the county guide?", body: "x", urgency: "normal", answerFormat: "yes_no" } as any], frozenSends: { proposed: 5, tappedByFounder: 1, autoWitnessed: 2, expiredUnseen: 1, pendingNow: 2 } })],
    ["quiet morning", base({ pulse: { ...base().pulse, dispatchesCompletedLast24h: 0, decisionsWaitingCount: 0, trials: 0 } })],
  ];
  for (const [name, inp] of cases) {
    it(name, () => {
      const b = buildFounderBrief(inp);
      const screen = letterScreen(b);
      expect(screen.texts.length).toBeGreaterThan(0);
      expect(check.check({ tick: 1, at: "x", screens: [screen] }, freshState())).toEqual([]);
    });
  }
});
