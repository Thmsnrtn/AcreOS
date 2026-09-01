import { describe, it, expect } from "vitest";
import {
  buildFounderBrief,
  partOfDayFromHour,
  type FounderBriefInputs,
} from "../../server/services/autopilot/narrate";

const base = (over: Partial<FounderBriefInputs> = {}): FounderBriefInputs => ({
  frozenSends: null,
  partOfDay: "morning",
  founderName: "Tom",
  pulse: {
    mrr: 0,
    trials: 0,
    weeklySpendUsd: 0,
    envelopeStatus: "green",
    uptimePct: 99.9,
    dispatchesCompletedLast24h: 0,
    dispatchesFlaggedLast24h: 0,
    decisionsWaitingCount: 0,
  },
  openAsks: [],
  plannedFocus: null,
  operatingMode: null,
  trustLedger: [],
  ...over,
});

describe("autopilot narration engine — the Voice", () => {
  it("UNION: never says 'nothing needs you' while decisions wait in the queue (2026-07 panel finding)", () => {
    const b = buildFounderBrief(
      base({ pulse: { ...base().pulse, decisionsWaitingCount: 17 } }),
    );
    expect(b.isFounderNeeded).toBe(true);
    expect(b.neededLine).not.toMatch(/Nothing needs you/i);
    expect(b.neededLine).toMatch(/17 decisions are waiting for you in Decisions/);
  });

  it("UNION: asks + queued decisions combine into one honest count", () => {
    const b = buildFounderBrief(
      base({
        pulse: { ...base().pulse, decisionsWaitingCount: 2 },
        openAsks: [
          { askId: 1, summary: "Approve budget?", urgency: "normal", answerFormat: "yes_no" },
        ],
      }),
    );
    expect(b.isFounderNeeded).toBe(true);
    expect(b.neededLine).toMatch(/3 things need your call/);
    expect(b.neededLine).toMatch(/1 question below/);
    expect(b.neededLine).toMatch(/2 decisions waiting in Decisions/);
  });

  it("UNION: never says 'nothing needs you' while sends sit frozen awaiting a tap (2026-09-01)", () => {
    const b = buildFounderBrief(
      base({ frozenSends: { proposed: 3, tappedByFounder: 0, autoWitnessed: 0, expiredUnseen: 0, pendingNow: 3 } }),
    );
    expect(b.isFounderNeeded).toBe(true);
    expect(b.neededLine).not.toMatch(/Nothing needs you/i);
    expect(b.neededLine).toMatch(/3 sends are frozen until you approve/);
    const mixed = buildFounderBrief(
      base({
        pulse: { ...base().pulse, decisionsWaitingCount: 2 },
        frozenSends: { proposed: 1, tappedByFounder: 0, autoWitnessed: 0, expiredUnseen: 0, pendingNow: 1 },
      }),
    );
    expect(mixed.neededLine).toMatch(/3 things need your call/);
    expect(mixed.neededLine).toMatch(/1 send frozen until you approve/);
  });

  it("on a calm all-green day the letter says you're free, and needs nobody", () => {
    const b = buildFounderBrief(base());
    expect(b.greeting).toBe("Good morning, Tom.");
    expect(b.isFounderNeeded).toBe(false);
    expect(b.neededLine).toBe("Nothing needs you today.");
    expect(b.decision).toBeNull();
    expect(b.theWord).toMatch(/Nothing needs you today\.$/);
  });

  it("HONESTY: with the hands dormant (0 completed) it says it WATCHED — never claims work it didn't do", () => {
    const b = buildFounderBrief(base({ pulse: { ...base().pulse, dispatchesCompletedLast24h: 0 } }));
    expect(b.theWord).toMatch(/kept watch/i);
    expect(b.theWord).not.toMatch(/completed/i);
    expect(b.theWord).not.toMatch(/shipped|published|launched/i);
  });

  it("once work genuinely ran, it reports the real completed count", () => {
    const b = buildFounderBrief(base({ pulse: { ...base().pulse, dispatchesCompletedLast24h: 3 } }));
    expect(b.theWord).toMatch(/completed 3 tasks/i);
  });

  it("decision scoring (Horizon A4): one honest sentence when dispatches were genuinely scored today", () => {
    const b = buildFounderBrief(
      base({ scoring: { totalScored: 4, averageScore: 0.575, deferredCount: 1 } }),
    );
    expect(b.theWord).toContain(
      "I scored 4 prospective dispatches against expected value today (average score 0.57, 1 deferred).",
    );
  });

  it("decision scoring: with nothing scored (or the summary unreadable) the sentence is OMITTED — never invented", () => {
    const zero = buildFounderBrief(
      base({ scoring: { totalScored: 0, averageScore: 0, deferredCount: 0 } }),
    );
    expect(zero.theWord).not.toMatch(/scored/i);
    const unreadable = buildFounderBrief(base({ scoring: null }));
    expect(unreadable.theWord).not.toMatch(/scored/i);
    const legacy = buildFounderBrief(base());
    expect(legacy.theWord).not.toMatch(/scored/i);
  });

  it("HONESTY: never invents revenue — $0 MRR reads as 'No revenue yet'", () => {
    const b = buildFounderBrief(base({ pulse: { ...base().pulse, mrr: 0 } }));
    expect(b.theWord).toMatch(/No revenue yet/i);
    const b2 = buildFounderBrief(base({ pulse: { ...base().pulse, mrr: 250 } }));
    expect(b2.theWord).toMatch(/\$250 MRR/);
  });

  it("a single open ask becomes the one hero decision + flips the needed-line", () => {
    const b = buildFounderBrief(
      base({
        openAsks: [{ askId: 7, summary: "Approve the Texas outreach batch", urgency: "normal", answerFormat: "yes_no" }],
      }),
    );
    expect(b.isFounderNeeded).toBe(true);
    expect(b.neededLine).toBe("One thing needs your call — below.");
    expect(b.decision?.askId).toBe(7);
    expect(b.theWord).toMatch(/needs your call/i);
  });

  it("multiple asks pluralize the needed-line and the highest-urgency one leads", () => {
    const b = buildFounderBrief(
      base({
        openAsks: [
          { askId: 1, summary: "urgent one", urgency: "urgent", answerFormat: "yes_no" },
          { askId: 2, summary: "normal one", urgency: "normal", answerFormat: "yes_no" },
        ],
      }),
    );
    expect(b.neededLine).toBe("2 things need your call — below.");
    expect(b.decision?.askId).toBe(1);
  });

  it("a RED envelope is surfaced honestly in the narrative, not buried", () => {
    const b = buildFounderBrief(base({ pulse: { ...base().pulse, envelopeStatus: "red" } }));
    expect(b.theWord).toMatch(/runway needs attention|constrained/i);
  });

  it("flagged items are surfaced, not hidden", () => {
    const b = buildFounderBrief(base({ pulse: { ...base().pulse, dispatchesFlaggedLast24h: 2 } }));
    expect(b.theWord).toMatch(/2 items were flagged/i);
  });

  it("the brain's focus appears in plain language when present", () => {
    const b = buildFounderBrief(
      base({ plannedFocus: { priority: 5, domain: "ops", kind: "optimize", rationale: "tighten a playbook" } }),
    );
    expect(b.focusLine).toMatch(/tighten a playbook/);
  });

  it("HONESTY: in observe-only mode (dispatch off) the focus line says nothing executes — never reads as operation", () => {
    const b = buildFounderBrief(
      base({
        plannedFocus: { priority: 5, domain: "ops", kind: "optimize", rationale: "tighten a playbook" },
        operatingMode: { dispatchEnabled: false, cognitionEnabled: false },
      }),
    );
    expect(b.focusLine).toMatch(/observe-only/i);
    expect(b.focusLine).toMatch(/enable Dispatch in Controls/i);
    expect(b.focusLine).toMatch(/tighten a playbook/);
  });

  it("with dispatch ON the focus line reads as active operation, no observe-only caveat", () => {
    const b = buildFounderBrief(
      base({
        plannedFocus: { priority: 5, domain: "ops", kind: "optimize", rationale: "tighten a playbook" },
        operatingMode: { dispatchEnabled: true, cognitionEnabled: true },
      }),
    );
    expect(b.focusLine).toMatch(/^Right now I'm focused on/);
    expect(b.focusLine).not.toMatch(/observe-only/i);
  });

  it("when the mode is UNREADABLE (null) the focus line stays neutral — never claims a mode", () => {
    const b = buildFounderBrief(
      base({ plannedFocus: { priority: 5, domain: "ops", kind: "optimize", rationale: "tighten a playbook" } }),
    );
    expect(b.focusLine).not.toMatch(/observe-only/i);
  });

  it("vitalSign mirrors the real pulse figures exactly", () => {
    const b = buildFounderBrief(base({ pulse: { ...base().pulse, mrr: 480, trials: 5, weeklySpendUsd: 12.5 } }));
    expect(b.vitalSign).toMatchObject({ mrr: 480, trials: 5, weeklySpendUsd: 12.5 });
  });

  it("surfaces what's working (learning) when present, empty otherwise", () => {
    expect(buildFounderBrief(base()).learning).toEqual([]);
    const withLearning = buildFounderBrief(
      base({ learning: [{ playId: "parcel-check-explainer", rate: 0.83, n: 4 }] }),
    );
    expect(withLearning.learning).toHaveLength(1);
    expect(withLearning.learning[0]).toMatchObject({ playId: "parcel-check-explainer", n: 4 });
  });

  it("carries calibration through (the system's self-measured accuracy), null otherwise", () => {
    expect(buildFounderBrief(base()).calibration).toBeNull();
    const withCal = buildFounderBrief(base({ calibration: { grade: "well-calibrated", n: 24, brier: 0.09 } }));
    expect(withCal.calibration).toMatchObject({ grade: "well-calibrated", n: 24 });
  });

  it("carries real runway weeks + WoW-MRR trend through to the vital sign, null when absent", () => {
    // Absent (a young system with no prior datapoint / not burning) → omitted, never faked.
    const blank = buildFounderBrief(base());
    expect(blank.vitalSign.runwayWeeks).toBeNull();
    expect(blank.vitalSign.mrrWowPct).toBeNull();
    // Present → mirrored exactly (the gatherer derives these from real ledger + persisted pulse).
    const withTrend = buildFounderBrief(base({ runwayWeeks: 11, mrrWowPct: 3 }));
    expect(withTrend.vitalSign.runwayWeeks).toBe(11);
    expect(withTrend.vitalSign.mrrWowPct).toBe(3);
    const declining = buildFounderBrief(base({ mrrWowPct: -2 }));
    expect(declining.vitalSign.mrrWowPct).toBe(-2);
  });

  it("wedge/error-rate/version pass through exactly; absent ⇒ null, never zero-faked", () => {
    const blank = buildFounderBrief(base());
    expect(blank.vitalSign.wedge).toBeNull();
    expect(blank.vitalSign.errorRatePct).toBeNull();
    expect(blank.vitalSign.prodVersion).toBeNull();
    const withWedge = buildFounderBrief(
      base({
        wedge: { outreachSent7d: 42, replies7d: 6, offers7d: 2 },
        errorRatePct: 0.3,
        prodVersion: "abcd1234",
      }),
    );
    expect(withWedge.vitalSign.wedge).toEqual({ outreachSent7d: 42, replies7d: 6, offers7d: 2 });
    expect(withWedge.vitalSign.errorRatePct).toBe(0.3);
    expect(withWedge.vitalSign.prodVersion).toBe("abcd1234");
  });

  it("HONESTY: an unreadable pulse yields 'unknown' budget + null uptime — never a guessed green or 99.9%", () => {
    const b = buildFounderBrief(
      base({ pulse: { ...base().pulse, envelopeStatus: "unknown", uptimePct: null } }),
    );
    expect(b.vitalSign.envelopeStatus).toBe("unknown");
    expect(b.vitalSign.uptimePct).toBeNull();
    // The narrative admits it can't read the ledger instead of claiming budget health.
    expect(b.theWord).toMatch(/can't read the spend ledger/i);
    expect(b.theWord).not.toMatch(/within budget/i);
  });

  it("partOfDayFromHour maps ET hours to the right greeting word", () => {
    expect(partOfDayFromHour(8)).toBe("morning");
    expect(partOfDayFromHour(14)).toBe("afternoon");
    expect(partOfDayFromHour(21)).toBe("evening");
  });
});

describe("the Letter's frozen-send line (stage-4 turn 5, OD-9)", () => {
  it("stays silent when the counters were unreadable (null) or the lane is quiet", () => {
    expect(buildFounderBrief(base({ frozenSends: null })).theWord).not.toMatch(/Witnessed sends/);
    expect(
      buildFounderBrief(base({ frozenSends: { proposed: 0, tappedByFounder: 0, autoWitnessed: 0, expiredUnseen: 0, pendingNow: 0 } })).theWord,
    ).not.toMatch(/Witnessed sends/);
  });

  it("renders the week's counts when the lane saw traffic", () => {
    const { theWord: body } = buildFounderBrief(
      base({ frozenSends: { proposed: 8, tappedByFounder: 2, autoWitnessed: 6, expiredUnseen: 0, pendingNow: 0 } }),
    );
    expect(body).toMatch(/Witnessed sends this week: 8 frozen/);
    expect(body).toMatch(/6 released by your grants/);
    expect(body).toMatch(/none expired/);
  });

  it("calls out expiries LOUDLY — a send dying unseen is the failure grants-for-all must keep visible", () => {
    const { theWord: body } = buildFounderBrief(
      base({ frozenSends: { proposed: 5, tappedByFounder: 0, autoWitnessed: 2, expiredUnseen: 3, pendingNow: 0 } }),
    );
    expect(body).toMatch(/3 EXPIRED unseen/);
    expect(body).toMatch(/check the grant budgets/);
  });
});
