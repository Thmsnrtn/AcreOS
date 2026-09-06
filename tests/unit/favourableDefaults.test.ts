/**
 * When a value is missing, the default must not be the good news.
 *
 * Unit 92 found `compliance-badge` resolving
 * `checks.length > 0 ? deriveStatus(checks) : "compliant"`, so a failed read
 * rendered a green **Compliant** badge. The generalisable question — *is the
 * fallback the FAVOURABLE value?* — was then asked across `client/src`,
 * `server/` and `shared/`. Thirty-six `?? "low" | "ok" | "none" | …` defaults
 * turned up, and reading them one by one is what made the unit small:
 *
 *   - Most are **display placeholders or enum members**, and honest.
 *     `dunningStage ?? "none"` is a real stage in that enum; `${x ?? "none"}`
 *     inside a log line or a prompt is prose; `value={id ?? "none"}` is a
 *     select-box sentinel. None of them asserts a favourable fact.
 *   - **Two were real**, and both sit on surfaces where the favourable reading
 *     is exactly what someone acts on.
 *
 * **`maps.tsx` — `getRiskColor(intel.slopeRisk ?? "low")`.** A parcel whose slope
 * GRADE is known but whose RISK classification is missing had its number painted
 * `text-acr-pos` — green — on the parcel intelligence panel. The panel's own
 * header, two lines above the call, reads: *"Every value is real-or-honest: a
 * missing field renders 'Not yet pulled · Check now', never a fabricated number
 * or a default flood zone."* The component already knew: it hides the
 * `(low|moderate|high)` label when the field is absent, and coloured the number
 * favourably anyway. A customer deciding whether to buy should not read *"we
 * have not classified this slope"* as *"this slope is fine"*.
 *
 * **`syntheticChecks.ts` — `t.result?.status ?? "ok"`,** three times. Unreachable
 * today (`timeIt` only returns a null result alongside an error, which the
 * ternary catches first), and recorded as such rather than dressed up: the fix is
 * a one-word change of DIRECTION. A check that cannot report its status is not a
 * check that passed, and a monitoring default should fail toward attention.
 *
 * WHY THIS FILE IS NARROW ON PURPOSE. A regex for "favourable default" cannot
 * tell `dunningStage ?? "none"` from `slopeRisk ?? "low"` — one is an enum
 * member, the other is a verdict — so a sweep asserting zero would be wrong 34
 * times out of 36 and would be deleted within a week. What is pinned instead is
 * the two REAL cases, plus the property that makes them fixable: the risk helpers
 * ACCEPT `undefined` and answer neutrally, so no caller has to invent a band to
 * satisfy a type.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

const mapsRaw = fs.readFileSync(path.join(ROOT, "client/src/pages/maps.tsx"), "utf8");
/** Code only, for the caller sweep. */
const maps = stripComments(mapsRaw);
const checks = fs.readFileSync(
  path.join(ROOT, "server/services/syntheticChecks.ts"),
  "utf8",
);

describe("unknown risk renders neutral, never favourable", () => {
  it("no caller invents a risk band", () => {
    expect(
      maps,
      "a risk helper is being handed a default band again. `slopeRisk ?? \"low\"` " +
        "paints an unclassified slope green on the parcel intelligence panel — " +
        "on a page whose own header promises a missing field renders " +
        "'Not yet pulled', never a default.",
    ).not.toMatch(/getRisk(?:Color|Bg)\([^)]*\?\?\s*"(low|moderate)"/);
  });

  it("the helpers accept undefined, so nobody has to", () => {
    // The property that makes the rule keepable. If the signatures required a
    // band, the next caller with an optional field would add `?? "low"` back to
    // satisfy the type — and would be right to, given the choice.
    for (const fn of ["getRiskColor", "getRiskBg"]) {
      const at = maps.indexOf(`function ${fn}(`);
      expect(at, `${fn} is gone`).toBeGreaterThan(-1);
      const sig = maps.slice(at, maps.indexOf(")", at));
      expect(sig, `${fn} no longer accepts undefined`).toContain("undefined");
    }
  });

  it("undefined answers with the neutral token, not the positive one", () => {
    // `text-acr-pos` is the green. Reaching it from an absent value is the whole
    // defect, so the early return is asserted rather than assumed.
    const at = maps.indexOf("function getRiskColor(");
    const body = maps.slice(at, maps.indexOf("\n}", at));
    expect(body).toContain('if (!risk) return "text-muted-foreground";');
    expect(
      body.indexOf("if (!risk)"),
      "the favourable map is consulted before the unknown check",
    ).toBeLessThan(body.indexOf("text-acr-pos"));
  });

  it("the panel still promises real-or-honest, which is what this enforces", () => {
    // The rule's own source. If that promise is ever withdrawn, this check is
    // enforcing something the page no longer claims and should be re-argued.
    // Read from the RAW source: the promise is a JSX comment, which is exactly
    // what the sweep above strips.
    expect(mapsRaw).toMatch(/real-or-honest/i);
    expect(mapsRaw).toMatch(/never a\s+fabricated number or a default flood zone/i);
  });
});

describe("a check that cannot report its status has not passed", () => {
  it("the fallback fails toward attention", () => {
    expect(
      checks,
      "a synthetic check defaults to \"ok\" when it has no status. Unreachable " +
        "today, but the direction is the point: monitoring should fail toward " +
        "attention, not toward silence.",
    ).not.toContain('t.result?.status ?? "ok"');
    expect(
      [...checks.matchAll(/t\.result\?\.status \?\? "failing"/g)].length,
      "not every synthetic check carries the safe default",
    ).toBe(3);
  });

  it("the reasoning records that it is unreachable today", () => {
    // Honesty about the fix's own reach. Unit 74 catalogued "an empty input
    // space" as a kind of no-op change; this is one, and saying so keeps the
    // next reader from believing a live bug was closed.
    expect(checks).toMatch(/Unreachable today/i);
  });
});
