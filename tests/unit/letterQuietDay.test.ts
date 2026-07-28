/**
 * Quiet-day mode lock (founder decision 2026-07-28, ruling #7).
 *
 * On green mornings The Letter renders three lines — needed-line · money
 * line · step-away line — with the full letter one tap away. This suite
 * locks the predicate and the rendering contract:
 *
 *   1. isQuietDay is quiet ONLY when ALL hold: needsYouCount === 0, misses
 *      empty, modelChangeNotice null, envelopeStatus a VERIFIED "green".
 *      Each disqualifier alone flips it false — and "unknown" (unreadable
 *      budget) is NOT quiet: unknown is never dressed up as green.
 *   2. buildFounderBrief carries quietDay computed from the same values the
 *      brief itself renders — a non-empty confession forces the full letter
 *      by definition (the absolute confession rule, pinned here).
 *   3. home.tsx source-shape: the quiet branch is keyed on brief.quietDay +
 *      the client-side "Read the full letter" toggle, renders the money line
 *      (real spend, linking to the costs hub), and StepAwayLine renders in
 *      BOTH modes. Quiet mode is subtraction only.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildFounderBrief,
  isQuietDay,
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

const quietBase = {
  needsYouCount: 0,
  misses: [] as ReadonlyArray<unknown>,
  modelChangeNotice: null as string | null,
  envelopeStatus: "green" as const,
};

const greenInputs: FounderBriefInputs = {
  partOfDay: "morning",
  founderName: "Tom",
  pulse: {
    mrr: 0,
    trials: 0,
    weeklySpendUsd: 12,
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

// ── 1. the pure predicate ───────────────────────────────────────────────────

describe("isQuietDay — quiet ONLY when everything is verified green", () => {
  it("a fully green morning is quiet", () => {
    expect(isQuietDay(quietBase)).toBe(true);
  });

  it("anything needing the founder disqualifies (needsYouCount > 0)", () => {
    expect(isQuietDay({ ...quietBase, needsYouCount: 1 })).toBe(false);
    expect(isQuietDay({ ...quietBase, needsYouCount: 17 })).toBe(false);
  });

  it("a non-empty confession disqualifies — misses always force the full letter", () => {
    expect(
      isQuietDay({ ...quietBase, misses: [{ atIso: null, line: "a miss", changed: null }] }),
    ).toBe(false);
  });

  it("a model-change notice disqualifies", () => {
    expect(isQuietDay({ ...quietBase, modelChangeNotice: "My brain changed." })).toBe(false);
  });

  it("amber and red budgets disqualify", () => {
    expect(isQuietDay({ ...quietBase, envelopeStatus: "amber" })).toBe(false);
    expect(isQuietDay({ ...quietBase, envelopeStatus: "red" })).toBe(false);
  });

  it('an UNKNOWN budget disqualifies — unreadable is never dressed up as green', () => {
    expect(isQuietDay({ ...quietBase, envelopeStatus: "unknown" })).toBe(false);
  });

  it("the predicate requires a verified green in source (never !== 'red' or similar)", () => {
    expect(narrateSrc).toMatch(/envelopeStatus\s*===\s*"green"/);
  });
});

// ── 2. the brief carries quietDay honestly ──────────────────────────────────

describe("buildFounderBrief — quietDay flows from the brief's own values", () => {
  it("a green, empty morning yields quietDay: true with the canonical needed-line", () => {
    const brief = buildFounderBrief(greenInputs);
    expect(brief.quietDay).toBe(true);
    expect(brief.neededLine).toBe("Nothing needs you today.");
  });

  it("open asks flip quietDay false", () => {
    const brief = buildFounderBrief({
      ...greenInputs,
      openAsks: [{ askId: 1, summary: "q", urgency: "normal", answerFormat: "yes/no" }],
    });
    expect(brief.quietDay).toBe(false);
  });

  it("queued decisions (the pulse side of the union) flip quietDay false", () => {
    const brief = buildFounderBrief({
      ...greenInputs,
      pulse: { ...greenInputs.pulse, decisionsWaitingCount: 3 },
    });
    expect(brief.quietDay).toBe(false);
  });

  it("misses non-empty forces the full letter — the confession rule is absolute", () => {
    const brief = buildFounderBrief({
      ...greenInputs,
      misses: [{ atIso: null, line: "a decision didn't turn out as predicted", changed: null }],
    });
    expect(brief.misses).toHaveLength(1);
    expect(brief.quietDay).toBe(false);
  });

  it("a model-change notice flips quietDay false", () => {
    const brief = buildFounderBrief({ ...greenInputs, modelChangeNotice: "My brain changed." });
    expect(brief.quietDay).toBe(false);
  });

  it("an unknown envelope flips quietDay false (never-dress-unknown-as-green)", () => {
    const brief = buildFounderBrief({
      ...greenInputs,
      pulse: { ...greenInputs.pulse, envelopeStatus: "unknown" },
    });
    expect(brief.quietDay).toBe(false);
  });

  it("amber and red envelopes flip quietDay false", () => {
    for (const envelopeStatus of ["amber", "red"] as const) {
      const brief = buildFounderBrief({
        ...greenInputs,
        pulse: { ...greenInputs.pulse, envelopeStatus },
      });
      expect(brief.quietDay).toBe(false);
    }
  });
});

// ── 3. home.tsx source-shape — the compact letter + the toggle ──────────────

describe("home.tsx — quiet-day renders three lines with the full letter one tap away", () => {
  it("the quiet branch is keyed on brief.quietDay AND the client-side toggle state", () => {
    expect(homeSrc).toMatch(/brief\.quietDay\s*&&\s*!showFullLetter/);
    expect(homeSrc).toMatch(/setShowFullLetter/);
  });

  it("carries the 'Read the full letter' toggle", () => {
    expect(homeSrc).toContain("Read the full letter");
    expect(homeSrc).toContain("letter-read-full-toggle");
    expect(homeSrc).toMatch(/setShowFullLetter\(true\)/);
  });

  it("the money line uses the REAL spend + budget values and links to the costs hub", () => {
    expect(homeSrc).toContain("letter-quiet-money-line");
    expect(homeSrc).toContain("tap for every charge");
    // Real values, not hardcoded prose: the same vitalSign fields the strip uses.
    const quietIdx = homeSrc.indexOf("letter-quiet-money-line");
    const moneyBlock = homeSrc.slice(quietIdx - 600, quietIdx + 600);
    expect(moneyBlock).toContain("brief.vitalSign.weeklySpendUsd");
    expect(moneyBlock).toContain("BUDGET_STATUS[brief.vitalSign.envelopeStatus]");
    expect(moneyBlock).toContain("/founder/admin/costs");
  });

  it("StepAwayLine renders in BOTH modes (quiet and full)", () => {
    const uses = homeSrc.match(/<StepAwayLine\s*\/>/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it("the quiet view renders the needed-line headline (the greeting + neededLine)", () => {
    const quietStart = homeSrc.indexOf("letter-quiet-day");
    const quietEnd = homeSrc.indexOf("letter-read-full-toggle");
    expect(quietStart).toBeGreaterThan(-1);
    const quietBlock = homeSrc.slice(quietStart, quietEnd);
    expect(quietBlock).toContain("brief.greeting");
    expect(quietBlock).toContain("brief.neededLine");
  });

  it("the full letter still carries the confession — quiet mode never removed it", () => {
    expect(homeSrc).toContain("LetterConfession");
    expect(homeSrc).toContain("brief.misses");
  });
});
