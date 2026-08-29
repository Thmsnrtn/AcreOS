/**
 * The Letter's trust-evidence lock (trust audit, 2026-07-28).
 *
 * A trust audit found the brief API already computed trustLedger,
 * calibration and learning — and home.tsx dropped all of it; there was no
 * "what I got wrong" section; and nothing showed what the autopilot would
 * do NEXT. This suite locks the resolution with source-shape contracts
 * (same pattern as mobileNavFixedDoors.test.ts / letterNeedsYouUnion.test.ts)
 * plus direct unit tests of the pure wording helpers in narrate.ts:
 *
 *   1. home.tsx renders the track-record card and the confession section
 *      FROM BRIEF FIELDS (never client-side re-derivation).
 *   2. narrate.ts carries the small-n guard — below CALIBRATION_MIN_N the
 *      calibration sentence says "Too early to score", never a grade.
 *   3. home.tsx carries the up-next error-state string (a failed check is
 *      never pixel-identical to an empty queue), and the hold route goes
 *      through the queued-only cancel path with NO un-hold.
 *   4. The pure helpers never overstate: raw counts only, small samples
 *      labeled, misses capped at MAX_MISSES (oldest dropped).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildFounderBrief,
  calibrationLine,
  trackRecordLine,
  learningLine,
  CALIBRATION_MIN_N,
  MAX_MISSES,
  type FounderBriefInputs,
} from "../../server/services/autopilot/narrate";

const ROOT = path.resolve(__dirname, "../..");
const narrateSrc = fs.readFileSync(
  path.join(ROOT, "server/services/autopilot/narrate.ts"),
  "utf-8",
);
const homeSrc = fs.readFileSync(
  path.join(ROOT, "client/src/pages/founder/home.tsx"),
  "utf-8",
);
const trackRecordSrc = fs.readFileSync(
  path.join(ROOT, "client/src/components/founder/LetterTrackRecord.tsx"),
  "utf-8",
);
const confessionSrc = fs.readFileSync(
  path.join(ROOT, "client/src/components/founder/LetterConfession.tsx"),
  "utf-8",
);
const routesSrc = fs.readFileSync(path.join(ROOT, "server/routes-autopilot.ts"), "utf-8");

const baseInputs: FounderBriefInputs = {
  frozenSends: null,
  partOfDay: "morning",
  founderName: "Tom",
  pulse: {
    mrr: 0,
    trials: 0,
    weeklySpendUsd: 0,
    envelopeStatus: "green",
    uptimePct: null,
    dispatchesCompletedLast24h: 0,
    dispatchesFlaggedLast24h: 0,
    decisionsWaitingCount: 0,
  },
  openAsks: [],
  plannedFocus: null,
  operatingMode: null,
  trustLedger: [],
};

// ── 1. home.tsx renders the new sections from brief fields ──────────────────

describe("home.tsx — track record + confession render from brief fields", () => {
  it("renders LetterTrackRecord from brief.trackRecord / trustLedger / calibrationLine / learningLines", () => {
    expect(homeSrc).toContain("LetterTrackRecord");
    expect(homeSrc).toContain("brief.trackRecord");
    expect(homeSrc).toContain("brief.trustLedger");
    expect(homeSrc).toContain("brief.calibrationLine");
    expect(homeSrc).toContain("brief.learningLines");
  });

  it("renders LetterConfession from brief.misses", () => {
    expect(homeSrc).toContain("LetterConfession");
    expect(homeSrc).toContain("brief.misses");
  });

  it("the track-record card is collapsed by default ('tap to open')", () => {
    expect(trackRecordSrc).toContain("Track record — tap to open");
    expect(trackRecordSrc).toMatch(/useState\(false\)/);
  });

  it("the confession is silent when empty — no celebratory padding", () => {
    expect(confessionSrc).toContain("Since last week — what went wrong");
    // Empty → render nothing at all.
    expect(confessionSrc).toMatch(/misses\.length\s*===\s*0\)\s*return null/);
    // No fake reassurance anywhere in the section.
    expect(confessionSrc).not.toMatch(/nothing went wrong/i);
    expect(confessionSrc).not.toMatch(/all good/i);
  });
});

// ── 2. narrate.ts — the small-n guard ───────────────────────────────────────

describe("narrate.ts — calibration small-n guard", () => {
  it("the 'too early' string exists in narrate.ts", () => {
    expect(narrateSrc).toContain("Too early to score");
  });

  it("below CALIBRATION_MIN_N the line says 'too early' with the real count — never a grade", () => {
    const line = calibrationLine({ grade: "unproven", n: 4, brier: null });
    expect(line).toContain("Too early to score");
    expect(line).toContain("4 checked so far");
    expect(line).not.toContain("well-calibrated");
  });

  it("even a claimed grade below the minimum is refused (wording can't outrun scoring)", () => {
    const line = calibrationLine({ grade: "well-calibrated", n: CALIBRATION_MIN_N - 1, brier: 0.1 });
    expect(line).toContain("Too early to score");
  });

  it("unreadable calibration renders NOTHING (null), never a guess", () => {
    expect(calibrationLine(null)).toBeNull();
  });

  it("over-confidence is stated at full severity, with n and the basis labeled", () => {
    const line = calibrationLine({ grade: "over-confident", n: 25, brier: 0.3 })!;
    expect(line).toContain("over-confident");
    expect(line).toContain("25");
    expect(line).toContain("not your judgment");
  });

  it("a well-calibrated grade at sufficient n does not say 'too early'", () => {
    const line = calibrationLine({ grade: "well-calibrated", n: 12, brier: 0.1 })!;
    expect(line).not.toContain("Too early");
    expect(line).toContain("12");
  });
});

// ── 3. up next — error state + queued-only hold ─────────────────────────────

describe("up next — armed intent with one-tap hold", () => {
  it("home.tsx carries the up-next error-state string (a broken check says so)", () => {
    expect(homeSrc).toContain("Couldn't check what's queued");
  });

  it("home.tsx calls the up-next endpoints", () => {
    expect(homeSrc).toContain("/api/founder/autopilot/up-next");
    expect(homeSrc).toMatch(/up-next\/\$\{id\}\/hold/);
  });

  it("routes-autopilot.ts serves the listing + hold and routes hold through the queued-only cancel path", () => {
    expect(routesSrc).toContain('"/api/founder/autopilot/up-next"');
    expect(routesSrc).toContain('"/api/founder/autopilot/up-next/:id/hold"');
    expect(routesSrc).toContain("cancelQueuedDispatch");
  });

  it("there is deliberately NO un-hold route (holding is tightening)", () => {
    expect(routesSrc).not.toContain("unhold");
    expect(routesSrc).not.toContain("un-hold/");
    expect(routesSrc).not.toContain("up-next/:id/release");
    expect(routesSrc).not.toContain("up-next/:id/resume");
  });
});

// ── 4. pure helpers — never overstate ───────────────────────────────────────

describe("trackRecordLine — plain counts, small samples labeled", () => {
  it("reads as a plain per-domain sentence with real counts", () => {
    const line = trackRecordLine({ domain: "growth", n: 14, good: 12, bad: 2 });
    expect(line).toContain("Growth");
    expect(line).toContain("14 actions");
    expect(line).toContain("12 turned out fine");
    expect(line).toContain("2 went wrong");
  });

  it("singular grammar at n=1 and the small-sample label below 5", () => {
    const line = trackRecordLine({ domain: "support", n: 1, good: 0, bad: 1 });
    expect(line).toContain("1 action");
    expect(line).toContain("small sample");
  });

  it("a clean record still says 'so far' — never a blanket claim", () => {
    const line = trackRecordLine({ domain: "ops", n: 6, good: 6, bad: 0 });
    expect(line).toContain("so far");
  });
});

describe("learningLine — raw counts, never the posterior rate", () => {
  it("states successes out of recorded tries", () => {
    const line = learningLine("welcome-email", 3, 1);
    expect(line).toContain("3 of 4 recorded tries");
    expect(line).toContain("small sample");
  });

  it("drops the small-sample label at n >= 5 and keeps singular grammar at n=1", () => {
    expect(learningLine("guide-post", 5, 1)).not.toContain("small sample");
    expect(learningLine("guide-post", 1, 0)).toContain("1 of 1 recorded try");
  });
});

describe("buildFounderBrief — the new fields flow through honestly", () => {
  it("without the new inputs the brief carries empty arrays / null line (back-compat)", () => {
    const brief = buildFounderBrief(baseInputs);
    expect(brief.trackRecord).toEqual([]);
    expect(brief.misses).toEqual([]);
    expect(brief.learningLines).toEqual([]);
    expect(brief.calibrationLine).toBeNull();
  });

  it("trackRecord entries get a pre-worded line; zero-n entries are dropped", () => {
    const brief = buildFounderBrief({
      ...baseInputs,
      trackRecord: [
        { domain: "growth", n: 14, good: 12, bad: 2 },
        { domain: "finance", n: 0, good: 0, bad: 0 },
      ],
    });
    expect(brief.trackRecord).toHaveLength(1);
    expect(brief.trackRecord[0].line).toContain("Growth: 14 actions");
  });

  it(`misses are capped at MAX_MISSES (${MAX_MISSES}) — newest kept, oldest dropped`, () => {
    const misses = Array.from({ length: 8 }, (_, i) => ({
      atIso: new Date(Date.UTC(2026, 6, 28 - i)).toISOString(), // newest first
      line: `miss ${i}`,
      changed: null,
    }));
    const brief = buildFounderBrief({ ...baseInputs, misses });
    expect(brief.misses).toHaveLength(MAX_MISSES);
    expect(brief.misses[0].line).toBe("miss 0"); // newest survives
    expect(brief.misses.map((m) => m.line)).not.toContain("miss 7"); // oldest dropped
  });

  it("the confession lines are passed through verbatim — 'causality uncertain' survives", () => {
    const brief = buildFounderBrief({
      ...baseInputs,
      misses: [
        {
          atIso: null,
          line: "The intervention did not hold (causality uncertain).",
          changed: null,
        },
      ],
    });
    expect(brief.misses[0].line).toContain("causality uncertain");
  });
});
