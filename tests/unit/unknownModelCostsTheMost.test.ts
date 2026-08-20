/**
 * An unrecognised model must never be the cheapest thing in the ledger.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `DEFAULT_RATE` — the price applied to any model id the platform does not
 * recognise — was hand-set to `{ input: 1.0, output: 3.0 }` beneath a comment
 * reading "Conservative fallback … better to slightly overcount than to
 * silently $0 a real call". It sat BELOW ten of the table's rows on input and
 * twelve on output: one fifth of Opus input, one eighth of Opus output. The
 * comment described the posture the file wanted; the number implemented the
 * opposite one.
 *
 * ── WHY IT IS NOT A DISPLAY BUG ─────────────────────────────────────────────
 * `computeCostUsd` writes this figure into `ai_telemetry_events`, and
 * `aiCostCeiling.sumCostCentsSince` SUMS that column to decide whether an org
 * has hit its daily and monthly AI ceiling. So an unknown model drew down a
 * FREE org's $2/day allowance at a fifth of its real rate — on the order of
 * $16/day of true Opus-equivalent COGS before the gate tripped — while every
 * gate in the stack reported green. `predictCostCents` reads the same table to
 * forecast whether the next call fits under the ceiling, so the unrecognised
 * model also looked like the cheap one to route to.
 *
 * ── AND IT HAD ALREADY SURVIVED ITS OWN FIX ─────────────────────────────────
 * `aiRouter.estimateCost` once kept a private cost table. Its docblock still
 * records the repair: "unkeyed models fell back to a silent {input:1,output:3}.
 * Now … costed via the central conservative DEFAULT_RATE." The central
 * DEFAULT_RATE *was* `{input:1, output:3}` — the identical value, reached by a
 * different route, under a word that asserted the opposite. That is CLAUDE.md's
 * first law arriving on schedule: the centralisation was real, and the semantic
 * defect crossed it unchanged.
 *
 * ── WHAT THIS FILE PINS ─────────────────────────────────────────────────────
 * Not a number. The RULE: whatever the table says, the unknown-model price is
 * at least the dearest row on each axis — checked through the function that
 * writes the ledger, not just the constant — and it stays that way when someone
 * adds a dearer model, because it is DERIVED rather than set.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AI_COST_RATES,
  DEFAULT_RATE,
  computeCostUsd,
  getRate,
} from "../../server/services/aiCostRates";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const KNOWN = Object.entries(AI_COST_RATES);
const UNKNOWN_ID = "totally/not-a-model-anyone-ships";

describe("vacuity — the population this rule is about actually exists", () => {
  it("the rate table is real, and the id used as 'unknown' really is unknown", () => {
    expect(KNOWN.length, "the rate table is empty — every assertion below is free").
      toBeGreaterThan(8);
    expect(UNKNOWN_ID in AI_COST_RATES).toBe(false);
    expect(getRate(UNKNOWN_ID)).toEqual(DEFAULT_RATE);
  });

  it("the table contains rows dearer than the old hand-set $1/$3", () => {
    // Without this the rule could be satisfied by a table where nothing costs
    // more than the old default, and the regression would be invisible.
    const dearerOnInput = KNOWN.filter(([, r]) => r.input > 1.0);
    const dearerOnOutput = KNOWN.filter(([, r]) => r.output > 3.0);
    expect(dearerOnInput.length, "no row costs more than $1/1M input").toBeGreaterThan(5);
    expect(dearerOnOutput.length, "no row costs more than $3/1M output").toBeGreaterThan(5);
  });
});

describe("the unknown resolves toward caution", () => {
  it("DEFAULT_RATE is at least the dearest row, on each axis independently", () => {
    const dearestInput = Math.max(...KNOWN.map(([, r]) => r.input));
    const dearestOutput = Math.max(...KNOWN.map(([, r]) => r.output));
    expect(
      DEFAULT_RATE.input,
      `an unknown model's input is priced below ${dearestInput}/1M, which some ` +
        `real model in this table charges`,
    ).toBeGreaterThanOrEqual(dearestInput);
    expect(DEFAULT_RATE.output).toBeGreaterThanOrEqual(dearestOutput);
  });

  it("no known model can be metered dearer than an unknown one, at any token mix", () => {
    // Through computeCostUsd — the function whose output lands in
    // ai_telemetry_events and gets summed by the ceiling. Asserting on the
    // constant alone would not cover the cached-input path, where a known
    // model's discounted rate is what actually bills.
    const MIXES: Array<[number, number, number]> = [
      [1_000_000, 0, 0],
      [0, 1_000_000, 0],
      [1_000_000, 1_000_000, 0],
      [1_000_000, 0, 1_000_000], // fully cache-warmed: the cheapest a known row gets
      [500_000, 250_000, 400_000],
      [7, 3, 1],
    ];
    for (const [pt, ct, cached] of MIXES) {
      const unknownCost = computeCostUsd(UNKNOWN_ID, pt, ct, cached);
      for (const [id] of KNOWN) {
        expect(
          unknownCost,
          `${id} at (${pt} in / ${ct} out / ${cached} cached) meters dearer than an ` +
            `unrecognised model — the ceiling would let the unknown one run longer`,
        ).toBeGreaterThanOrEqual(computeCostUsd(id, pt, ct, cached));
      }
    }
  });

  it("an unknown model has no cached-input discount", () => {
    // We cannot know an unrecognised model supports prompt caching, so its
    // cached portion must bill at the full input rate. A discount here would
    // reintroduce the undercount on exactly the calls that carry the most
    // cached tokens.
    expect(DEFAULT_RATE.cachedInput).toBeUndefined();
    const warm = computeCostUsd(UNKNOWN_ID, 1_000_000, 0, 1_000_000);
    const cold = computeCostUsd(UNKNOWN_ID, 1_000_000, 0, 0);
    expect(warm).toBeCloseTo(cold, 6);
  });

  it("and it is still never $0", () => {
    expect(computeCostUsd(UNKNOWN_ID, 1_000, 1_000)).toBeGreaterThan(0);
  });
});

describe("it cannot drift back", () => {
  it("DEFAULT_RATE is DERIVED from the table, not a literal beside it", () => {
    // The equality above holds today whether the value is derived or a lucky
    // literal. This is the half that survives someone adding a dearer model
    // tomorrow: a literal cannot follow the table, and the whole history of
    // this constant is a literal that stopped following it.
    //
    // Comments stripped, because the note ON this constant quotes the old
    // `{ input: 1.0, output: 3.0 }` verbatim — a source scan that reads prose
    // matches the explanation of the defect and calls it the defect.
    const src = stripCommentsPreservingLines(
      readFileSync(resolve(__dirname, "../../server/services/aiCostRates.ts"), "utf8"),
    );
    const i = src.indexOf("export const DEFAULT_RATE");
    expect(i, "DEFAULT_RATE was renamed or removed").toBeGreaterThan(-1);
    const decl = src.slice(i, src.indexOf(";", i) + 1);
    expect(
      decl,
      "DEFAULT_RATE no longer reads the table. A hand-set number is how this " +
        "was wrong for months while its own comment called it conservative.",
    ).toContain("Math.max");
    expect(decl).toContain("AI_COST_RATES");
    expect(
      decl,
      "DEFAULT_RATE carries a hardcoded per-million figure again",
    ).not.toMatch(/(input|output)\s*:\s*[\d.]/);
  });

  it("the declaration sits AFTER the table it derives from", () => {
    // Ordering is load-bearing here and silently fatal if broken: a
    // `Math.max(...Object.values(AI_COST_RATES))` evaluated above the table
    // reads a TDZ error at import, or — if the table were a `var`/hoisted
    // shape — an empty spread, and `Math.max()` of nothing is -Infinity, which
    // would price every unknown model at NEGATIVE cost and read as a credit.
    const src = readFileSync(
      resolve(__dirname, "../../server/services/aiCostRates.ts"),
      "utf8",
    );
    expect(src.indexOf("export const AI_COST_RATES")).toBeLessThan(
      src.indexOf("export const DEFAULT_RATE"),
    );
    expect(Number.isFinite(DEFAULT_RATE.input)).toBe(true);
    expect(DEFAULT_RATE.input).toBeGreaterThan(0);
  });
});
