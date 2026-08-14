/**
 * A tax engine that invents tax rates, and the guard that fires if anyone uses it.
 *
 * `server/services/taxOptimizationEngine.ts` is 423 lines with **zero production
 * importers**. It also fabricates, repeatedly, on a surface where a fabricated
 * number reads as advice:
 *
 *   • `stateCapGainsRates` lists TWENTY states under the comment "representative
 *     sample, 2024", and the lookup ends `?? 0.05`. **The other thirty get an
 *     invented 5%.** The comment shows the gap was known; the `??` is what turns
 *     a known gap into a confident number.
 *   • The note beneath it states tax law FALSELY for exactly those states:
 *     `stateCapGainsRates[s] === 0 ? "no state capital gains tax" : "taxes
 *     capital gains as ordinary income"`. `undefined === 0` is `false`, so an
 *     unlisted state takes the ELSE branch — ask about Tennessee, which has no
 *     state income tax on capital gains, and it answers that TN taxes them as
 *     ordinary income AND applies 5%. Both false, in a sentence a reader takes
 *     as legal fact.
 *   • `calculate1031Benefits` does `replacementValue * 0.3 // assume 30%
 *     appreciation` and returns `deferralBenefit` as a rounded dollar figure.
 *   • The federal constants assume the TOP bracket for every taxpayer.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FIX. Deleting a named 423-line service is
 * the same class as the negotiation-copilot KILL and the SCP/voice/vision
 * deletions — all founder rulings — and "tidying" the constants of dead code is
 * the change most likely to be wasted (B10's standing note about the legacy
 * note-payment writers). A more credible-looking fabrication is also worse than
 * an obvious one. So the decision is recorded as **BLOCKERS B17** and the engine
 * is left exactly as it is.
 *
 * WHAT IS NOT LEFT ALONE is the fact that nothing would notice. `lint-reachability.mjs`
 * counts string literals as uses — by design, and by its own documentation:
 * *"prose and registries resurrect corpses"*. The only occurrence of
 * `taxOptimizationEngine` outside its own file is the STRING inside an
 * `ownedServices` array in `companyAgents.ts`. **So a dead subsystem that
 * fabricates tax figures is invisible to the one gate built to find dead
 * subsystems.**
 *
 * This is therefore an INVERTED assertion, in the idiom of
 * `vaWorkflowBounds.test.ts`: it pins the engine as unimported and **fails the
 * day someone imports it**, so wiring it up forces B17 to be answered first
 * instead of shipping the 5% alongside it. The work announces itself rather than
 * sitting in prose.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const ENGINE = "server/services/taxOptimizationEngine.ts";

/** Comments stripped: a note naming the module must not read as an import. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Does this source IMPORT the named module?
 *
 * ONE definition, used by both the sweep and the guard below. It was two — an
 * inline regex in each — and a mutation proved why that is wrong: breaking the
 * sweep's copy made "nothing imports it" trivially true while the guard, testing
 * its own separate copy, still passed. Same predicate or no measurement, which is
 * the rule this session recorded in NEXT_UP §7 for sweeps over source and applies
 * just as well to a test's own internals.
 */
function importsModule(code: string, moduleName: string): boolean {
  const rx = new RegExp(
    `(?:import|require)\\s*(?:[^;]*?from\\s*)?["'][^"']*${moduleName}["']`,
  );
  return rx.test(code);
}

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
      out.push(path.relative(ROOT, full));
    }
  };
  for (const tree of ["server", "client/src", "shared"]) walk(path.join(ROOT, tree));
  return out.sort();
}

describe("the tax engine stays unreached until B17 is decided", () => {
  it("nothing imports it", () => {
    // An IMPORT, not a mention. The string "taxOptimizationEngine" in
    // companyAgents.ts's ownedServices array is what makes the reachability
    // linter think this module is alive, so a mention must not satisfy this.
    const importers = productionFiles().filter((rel) => {
      if (rel === ENGINE) return false;
      const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      return importsModule(code, "taxOptimizationEngine");
    });
    expect(
      importers,
      "taxOptimizationEngine now has a production importer. Before wiring it up, " +
        "answer BLOCKERS B17: it applies an invented 5% capital-gains rate to the " +
        "thirty states missing from its table, and tells the caller those states " +
        "'tax capital gains as ordinary income' — a false statement of law, " +
        "because `undefined === 0` is false. Delete it, make it refuse, or fix " +
        "it; do not ship it as-is.",
    ).toEqual([]);
  });

  it("the fabrications are still exactly the ones B17 describes", () => {
    // If the engine changes, the blocker's evidence is stale and must be re-read
    // before it is acted on — §6a's rule about this program's own notes.
    const src = fs.readFileSync(path.join(ROOT, ENGINE), "utf8");
    expect(src, "the invented state rate is gone — re-read B17").toContain("?? 0.05");
    expect(src, "the false-law note is gone — re-read B17").toContain(
      "taxes capital gains as ordinary income",
    );
    expect(src, "the assumed-appreciation path is gone — re-read B17").toMatch(
      /replacementValue \* 0\.3/,
    );
  });

  it("and the blocker is written down where the next session will find it", () => {
    const blockers = fs.readFileSync(
      path.join(ROOT, "docs/implementation/BLOCKERS.md"),
      "utf8",
    );
    expect(blockers).toMatch(/## B17 —/);
    expect(blockers).toContain("taxOptimizationEngine");
  });

  it("the scan can see production files at all (vacuity guard)", () => {
    // "No importers" passes trivially if the walk returns nothing.
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain(ENGINE);
  });

  it("and it would notice a real import (detector guard)", () => {
    // The detector is asserted against a known-live pair, so a broken regex
    // cannot make the inverted assertion pass by matching nothing.
    const known = stripComments(
      fs.readFileSync(path.join(ROOT, "server/services/notes/acquiredNoteSchedule.ts"), "utf8"),
    );
    expect(
      importsModule(known, "dates/calendar"),
      "the import detector no longer matches a real import",
    ).toBe(true);
  });
});
