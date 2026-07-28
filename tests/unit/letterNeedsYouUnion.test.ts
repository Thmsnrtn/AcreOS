/**
 * The Letter's "needs you" union lock (trust-bug fix, 2026-07-27).
 *
 * The founder home (/founder, "The Letter") once keyed its all-clear card on
 * `brief.decision` alone while the headline (`neededLine`) read the UNION of
 * open asks + queued decisions — so with decisions queued but no asks open,
 * the headline said "N decisions are waiting" while the card below said
 * "Nothing needs you right now." A live contradiction on the one surface
 * whose thesis is "trust the one letter."
 *
 * This suite locks the resolution with source-shape contracts (same pattern
 * as mobileNavFixedDoors.test.ts):
 *   1. narrate.ts exposes `needsYouCount` computed from the SAME union the
 *      neededLine reads (asksCount + queueCount).
 *   2. home.tsx keys the all-clear rendering on needsYouCount — the all-clear
 *      string appears exactly once, inside the needsYouCount === 0 branch.
 *   3. Failed auxiliary checks are never pixel-identical to calm ones:
 *      PulseStrip renders an honest "Couldn't check…" line on query error
 *      (no bare return-null-on-error), and the StepAwayLine in home.tsx does
 *      the same for its check.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const narrateSrc = fs.readFileSync(
  path.join(ROOT, "server/services/autopilot/narrate.ts"),
  "utf-8",
);
const homeSrc = fs.readFileSync(
  path.join(ROOT, "client/src/pages/founder/home.tsx"),
  "utf-8",
);
const pulseStripSrc = fs.readFileSync(
  path.join(ROOT, "client/src/components/founder/PulseStrip.tsx"),
  "utf-8",
);

describe("narrate.ts — needsYouCount is the asks + queue union", () => {
  it("computes asksCount and queueCount from both stores", () => {
    expect(narrateSrc).toMatch(/asksCount\s*=\s*inp\.openAsks\.length/);
    expect(narrateSrc).toMatch(/queueCount\s*=\s*Math\.max\(\s*0\s*,\s*inp\.pulse\.decisionsWaitingCount\s*\)/);
  });

  it("needsYouCount is exactly asksCount + queueCount (the neededLine's union)", () => {
    expect(narrateSrc).toMatch(/needsYouCount\s*=\s*asksCount\s*\+\s*queueCount/);
  });

  it("needsYouCount is part of the brief payload (declared and returned)", () => {
    expect(narrateSrc).toMatch(/needsYouCount\s*:\s*number/);
    // Returned as a shorthand or explicit property in the composed brief.
    expect(narrateSrc).toMatch(/needsYouCount\s*[,}:]/);
  });
});

describe("home.tsx — the card block keys on needsYouCount, never on decision alone", () => {
  it("the all-clear string appears exactly once", () => {
    const matches = homeSrc.match(/Nothing needs you right now/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("reads needsYouCount and guards the all-clear on needsYouCount === 0", () => {
    expect(homeSrc).toContain("needsYouCount");
    expect(homeSrc).toMatch(/needsYouCount\s*===\s*0/);
  });

  it("the all-clear renders inside the needsYouCount === 0 branch", () => {
    // Source-shape: the zero-guard appears BEFORE the all-clear string, and
    // the all-clear must not precede the guard (i.e., it is not rendered
    // unconditionally or under a decision-null branch).
    const guardIdx = homeSrc.search(/needsYouCount\s*===\s*0/);
    const allClearIdx = homeSrc.indexOf("Nothing needs you right now");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(allClearIdx).toBeGreaterThan(guardIdx);
  });

  it("the queued-decisions overflow links to /founder/decisions (not the retired asks page)", () => {
    expect(homeSrc).toContain("/founder/decisions");
    expect(homeSrc).not.toContain("/founder/asks");
  });
});

describe("failed checks are never pixel-identical to calm ones", () => {
  it("PulseStrip renders an honest line on query error instead of returning null", () => {
    expect(pulseStripSrc).toContain("Couldn't check the heartbeat just now");
    expect(pulseStripSrc).toContain("isError");
    // The old combined comment/guard ("While loading (or on error) render
    // nothing") is gone — error is a distinct, visible state.
    expect(pulseStripSrc).not.toMatch(/loading\s*\(or on error\)/i);
  });

  it("home.tsx's StepAwayLine says so on a failed check", () => {
    expect(homeSrc).toContain("Couldn't run the step-away check just now");
    expect(homeSrc).toMatch(/isError/);
  });
});
