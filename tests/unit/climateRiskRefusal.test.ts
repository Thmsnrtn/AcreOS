/**
 * Climate risk — refuse, do not assert.
 *
 * The defect
 * ──────────
 * `CLIMATE_DATA` in `environmentalIntelligence.ts` covers TEN states
 * (AZ CA CO FL GA NC NM OR TX WA). Until 2026-08-18 `assessClimateRisk()`
 * answered for the other FORTY with:
 *
 *     overallRisk: "moderate"
 *     floodRisk / fireRisk / droughtRisk: { level: "moderate", score: 50 }
 *     hurricaneRisk:                      { level: "low",      score: 10 }
 *
 * — a measurement nobody made, in the exact shape of the ten states where the
 * same fields ARE measured, and therefore indistinguishable from them by any
 * consumer. That is fabrication under the standing rule, and it reached a
 * customer-facing artifact: the due-diligence PDF.
 *
 * What this file gates, and why each half is here
 * ───────────────────────────────────────────────
 * 1. THE SHAPE (`assessClimateRisk`): a state is either fully scored or fully
 *    unknown, never a mix, and an uncovered state can never produce a number.
 *    Written as an implication over all 50 state codes rather than a spot
 *    check on one, so restoring the fabricated default for ANY state fails —
 *    including via a differently-worded default (`"low"/25`, `"moderate"/50`,
 *    a per-hazard fallback). The forbidden BEHAVIOUR is "an uncovered state
 *    yields a number", not the literal 50.
 *
 * 2. THE PDF (`generateFullReport`): the section only ever printed on a
 *    drought/coastal HIT, so an unknown state printed NOTHING — and in a
 *    document titled "due diligence", printing nothing is read as "we checked
 *    and found nothing". Fixing the service alone would have moved the lie
 *    rather than removed it. This half asserts the rendered strings, captured
 *    off the real generator through a jsPDF spy, because the PDF is the only
 *    live consumer of `assessClimateRisk` (the environmental-intelligence card
 *    has no call site — see the deletion ledger).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assessClimateRisk } from "../../server/services/environmentalIntelligence";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

/** The states the module actually holds data for, as of 2026-08-18. */
const COVERED = ["AZ", "CA", "CO", "FL", "GA", "NC", "NM", "OR", "TX", "WA"];

const HAZARDS = ["floodRisk", "fireRisk", "droughtRisk", "hurricaneRisk"] as const;

describe("assessClimateRisk — an unmeasured state must say so", () => {
  it("vacuity guard: the population under test is all 50 states and is not empty", () => {
    expect(US_STATES).toHaveLength(50);
    expect(new Set(US_STATES).size).toBe(50);
    // If COVERED ever drifts to everything (or nothing) the implications below
    // would hold trivially. Both sides must stay populated.
    const uncovered = US_STATES.filter((s) => !COVERED.includes(s));
    expect(COVERED.length).toBeGreaterThan(0);
    expect(uncovered.length).toBeGreaterThan(0);
  });

  it("no state outside the covered set produces a numeric risk score", () => {
    const fabricating: string[] = [];
    for (const st of US_STATES) {
      if (COVERED.includes(st)) continue;
      const a = assessClimateRisk(st);
      for (const h of HAZARDS) {
        if (a[h].score !== null) fabricating.push(`${st}.${h}=${a[h].score}`);
      }
      if (a.overallRisk !== "unknown") fabricating.push(`${st}.overallRisk=${a.overallRisk}`);
    }
    expect(fabricating).toEqual([]);
  });

  it("every state is EITHER fully scored OR fully unknown — never a mix", () => {
    for (const st of US_STATES) {
      const a = assessClimateRisk(st);
      const scored = HAZARDS.filter((h) => a[h].score !== null).length;
      const known = HAZARDS.filter((h) => a[h].level !== "unknown").length;
      // level and score must agree per hazard: `unknown` <-> null.
      expect(scored, `${st}: score/level disagree`).toBe(known);
      // and the four hazards must agree with each other and with the overall.
      expect([0, 4], `${st}: partially scored (${scored}/4)`).toContain(scored);
      expect(a.overallRisk === "unknown", `${st}: overallRisk vs hazards`).toBe(scored === 0);
    }
  });

  it("the covered states still return real, distinct measurements", () => {
    // Guards the other direction: a fix that made EVERYTHING unknown would
    // pass the two tests above.
    for (const st of COVERED) {
      const a = assessClimateRisk(st);
      expect(a.overallRisk, `${st} lost its data`).not.toBe("unknown");
      for (const h of HAZARDS) {
        expect(typeof a[h].score, `${st}.${h}`).toBe("number");
        expect(a[h].level, `${st}.${h}`).not.toBe("unknown");
      }
    }
    // TX is the anchor: if these move, the data changed, not the contract.
    const tx = assessClimateRisk("TX");
    expect(tx.overallRisk).toBe("high");
    expect(tx.droughtRisk.score).toBe(85);
  });

  it("an unknown assessment explains itself in every field a consumer can render", () => {
    const oh = assessClimateRisk("OH", "Franklin");
    expect(oh.overallRisk).toBe("unknown");
    // The description is the only place the truth can travel to a renderer
    // that shows level + score. It must name the state and the absence.
    for (const h of HAZARDS) {
      expect(oh[h].level).toBe("unknown");
      expect(oh[h].score).toBeNull();
      expect(oh[h].description).toMatch(/no .* data on file for OH/i);
    }
    expect(oh.notes).toMatch(/no state-level climate data on file/i);
    // And it must NOT claim the county-level caveat that the scored branch
    // gives — there is no state-level assessment to caveat.
    expect(oh.notes).not.toMatch(/State-level assessment for/);
  });
});

// ── The live surface: the due-diligence PDF ────────────────────────────────

/**
 * The buffer the PDF mock is currently writing into.
 *
 * A single shared `printed` array made this file flaky in the FULL SUITE while
 * passing 6/6 in isolation — a late write from one render landing in the next
 * render's buffer. Rather than clearing harder and hoping, each render now gets
 * its OWN array and the pointer is moved to a quarantine buffer as soon as the
 * render returns. A late write therefore lands somewhere harmless AND is
 * detectable, which is the difference between fixing the flake and hiding it.
 */
let currentBuffer: string[] = [];
/** Anything written after a render was supposed to be finished. */
let lateWrites: string[] = [];

vi.mock("../../server/db", () => ({
  db: {
    query: {
      properties: {
        findFirst: vi.fn(async () => ({
          id: 1,
          state: process.env.__TEST_DD_STATE ?? "OH",
          county: "Franklin",
          latitude: "40.0",
          longitude: "-83.0",
          sizeAcres: "40",
          zip: "43004",
          address: "1 Test Rd",
        })),
      },
    },
  },
}));

vi.mock("jspdf", () => {
  class FakeDoc {
    text(str: string | string[]) {
      currentBuffer.push(Array.isArray(str) ? str.join(" ") : String(str));
      return this;
    }
    addPage() { return this; }
    line() { return this; }
    setDrawColor() { return this; }
    setFont() { return this; }
    setFontSize() { return this; }
    setLineWidth() { return this; }
    setTextColor() { return this; }
    output() { return new ArrayBuffer(8); }
  }
  return { jsPDF: FakeDoc };
});

describe("due-diligence PDF — silence is not a clean bill of health", () => {
  beforeEach(() => {
    lateWrites = [];
    currentBuffer = lateWrites;
  });

  afterEach(() => {
    // If this ever fires, the generator is still writing after its promise
    // resolved — the actual cause of the earlier flake, made visible instead
    // of being absorbed by a bigger buffer.
    expect(
      lateWrites,
      "the PDF generator wrote text AFTER generateFullReport resolved; those " +
        "writes used to land in the next test's buffer",
    ).toEqual([]);
  });

  /**
   * Each render is isolated.
   *
   * The first version shared one module instance and one `printed` array
   * across the three cases, resetting the array only in `beforeEach`. The
   * generator's `Promise.allSettled` branches all reject under these mocks
   * (no db), and `recordSnapshotAsync` is fire-and-forget — so a late write
   * from the PREVIOUS case could land in the next case's buffer. That produced
   * an intermittent failure where the TX render contained the OH render's
   * "Climate Risk: Not assessed" line, which reads as a real defect and is
   * not one.
   *
   * A flaky gate is a gate that gets ignored, so it is fixed rather than
   * retried: `vi.resetModules()` gives each render its own module instance,
   * the buffer is cleared immediately before the call, and the text is
   * snapshotted synchronously after the await.
   */
  async function renderFor(state: string): Promise<string> {
    vi.resetModules();
    process.env.__TEST_DD_STATE = state;
    const buffer: string[] = [];
    currentBuffer = buffer;
    const { generateFullReport } = await import(
      "../../server/services/dueDiligenceReportGenerator"
    );
    await generateFullReport(1, 1);
    // Anything the generator writes from here on is late, and must not be
    // able to reach the NEXT render's assertions.
    currentBuffer = lateWrites;
    const text = buffer.join("\n");
    // Guard the isolation itself: a render that produced nothing would make
    // every `not.toMatch` below pass vacuously.
    if (text.length < 200) {
      throw new Error(`the ${state} render produced almost no text (${text.length} chars)`);
    }
    return text;
  }

  it("an uncovered state gets an explicit 'not assessed', not an omission", async () => {
    const pdf = await renderFor("OH");
    expect(pdf).toMatch(/Climate Risk: Not assessed/);
    expect(pdf).toMatch(/no state-level climate data on file/i);
    // The disclaimer is the load-bearing sentence: without it the reader still
    // infers "checked, nothing flagged" from the absence of a warning below.
    expect(pdf).toMatch(/does not indicate absence of climate risk for OH/);
    // And it must not print an invented level or score anywhere.
    expect(pdf).not.toMatch(/Climate Risk: Drought-Prone/);
    expect(pdf).not.toMatch(/null\/100/);
  });

  it("a covered high-risk state still gets its real warning", async () => {
    const pdf = await renderFor("TX"); // drought very_high + hurricane high
    expect(pdf).toMatch(/Climate Risk: Drought-Prone & Coastal/);
    expect(pdf).toMatch(/Western TX chronic drought/);
    expect(pdf).not.toMatch(/Not assessed/);
  });

  it("a covered LOW-risk state prints neither warning nor 'not assessed'", async () => {
    // GA: drought moderate, hurricane moderate — neither trips the warning, so
    // the section legitimately stays silent. That silence is honest ONLY
    // because the state is assessed; this is the case the "not assessed" line
    // has to be distinguishable from, and the reason it was added.
    const pdf = await renderFor("GA");
    expect(pdf).not.toMatch(/Climate Risk: Not assessed/);
    expect(pdf).not.toMatch(/△ Climate Risk/);
  });
});
