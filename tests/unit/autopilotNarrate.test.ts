import { describe, it, expect } from "vitest";
import {
  buildFounderBrief,
  partOfDayFromHour,
  type FounderBriefInputs,
} from "../../server/services/autopilot/narrate";

const base = (over: Partial<FounderBriefInputs> = {}): FounderBriefInputs => ({
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
  trustLedger: [],
  ...over,
});

describe("autopilot narration engine — the Voice", () => {
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

  it("vitalSign mirrors the real pulse figures exactly", () => {
    const b = buildFounderBrief(base({ pulse: { ...base().pulse, mrr: 480, trials: 5, weeklySpendUsd: 12.5 } }));
    expect(b.vitalSign).toMatchObject({ mrr: 480, trials: 5, weeklySpendUsd: 12.5 });
  });

  it("partOfDayFromHour maps ET hours to the right greeting word", () => {
    expect(partOfDayFromHour(8)).toBe("morning");
    expect(partOfDayFromHour(14)).toBe("afternoon");
    expect(partOfDayFromHour(21)).toBe("evening");
  });
});
