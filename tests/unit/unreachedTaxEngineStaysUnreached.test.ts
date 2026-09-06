/**
 * The tax engine that invented tax rates is deleted. This keeps it deleted.
 *
 * `server/services/taxOptimizationEngine.ts` was 423 lines with zero production
 * importers, and it fabricated on a surface where a fabricated number reads as
 * advice:
 *
 *   • `stateCapGainsRates` listed TWENTY states under the comment "representative
 *     sample, 2024" and ended `?? 0.05`, so the other **thirty received an
 *     invented 5%**. The comment shows the gap was known; the `??` is what turned
 *     a known gap into a confident number.
 *   • The note beneath it stated tax law FALSELY for exactly those states:
 *     `rates[s] === 0 ? "no state capital gains tax" : "taxes capital gains as
 *     ordinary income"`. `undefined === 0` is `false`, so an unlisted state took
 *     the ELSE branch — asked about Tennessee, which has no state income tax on
 *     capital gains, it answered that TN taxes them as ordinary income AND
 *     applied 5%.
 *   • `calculate1031Benefits` did `replacementValue * 0.3 // assume 30%
 *     appreciation` and returned `deferralBenefit` as a rounded dollar figure.
 *
 * **Founder ruling, this date: delete it** (BLOCKERS B17). On this program's own
 * test — *does removing it remove a capability or a lie?* — it removed a lie.
 *
 * THIS FILE USED TO BE AN INVERTED ASSERTION that failed the day anyone IMPORTED
 * the engine, so the decision could not be skipped by wiring it up. That
 * invariant has not gone away, it has moved: the thing to protect now is that the
 * fabrication does not come back, by resurrection or by reimplementation. Per
 * CLAUDE.md's wave rule the assertion is rewritten to the new truth rather than
 * deleted — the original question ("may this ship?") still has the same answer.
 *
 * WHY A REIMPLEMENTATION CHECK AND NOT JUST A FILE-ABSENCE ONE. Deleting a file
 * is easy to undo by accident: the same table, pasted into a different module,
 * would be invisible to a check that only looks for the old path. So this also
 * asserts that no production file carries a state→capital-gains-rate map with a
 * numeric fallback. If a tax surface is ever genuinely wanted, it should be built
 * against real rate data and refuse the states it does not have — not resurrected
 * from a "representative sample".
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const ENGINE = "server/services/taxOptimizationEngine.ts";

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

describe("the fabricating tax engine stays deleted", () => {
  it("the file is gone", () => {
    expect(
      fs.existsSync(path.join(ROOT, ENGINE)),
      "taxOptimizationEngine.ts is back. It applied an invented 5% capital-gains " +
        "rate to thirty states and told callers those states 'tax capital gains " +
        "as ordinary income' — a false statement of law. Deleted by founder " +
        "ruling; see the deletion ledger and BLOCKERS B17.",
    ).toBe(false);
  });

  it("and nothing references it", () => {
    // Including the STRING in companyAgents.ts's ownedServices array, which is
    // what made the reachability linter treat the module as alive for as long as
    // it existed. A dangling name in a registry is how the next reader concludes
    // something is missing and rebuilds it.
    const referrers = productionFiles().filter((rel) =>
      /taxOptimizationEngine/.test(stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"))),
    );
    expect(referrers, "a dangling reference to the deleted engine remains").toEqual([]);
  });

  it("no state→capital-gains map with a numeric fallback exists anywhere", () => {
    // THE REIMPLEMENTATION CHECK. File absence alone is weak: the same twenty
    // states pasted into another module, still ending `?? 0.05`, would pass a
    // path-only assertion and be exactly the defect again.
    const offenders: string[] = [];
    for (const rel of productionFiles()) {
      const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      if (!/capGains|capitalGains|CAP_GAINS/i.test(code)) continue;
      // A rate lookup that falls back to a number rather than refusing.
      if (/\]\s*\?\?\s*0?\.\d+/.test(code)) offenders.push(rel);
    }
    expect(
      offenders,
      "a capital-gains rate table falls back to a numeric default again. A state " +
        "the table does not encode must REFUSE — `{ known: false, reason }`, the " +
        "way computeDepositDeadline does — never a plausible number.",
    ).toEqual([]);
  });

  it("the detector would notice one (guard against a vacuous pass)", () => {
    // The assertion above passes trivially if the pattern is broken, so it is
    // exercised against the shape it is meant to catch.
    const sample = 'const r: Record<string, number> = { CA: 0.133 };\nconst x = r[s] ?? 0.05;';
    expect(/capGains|capitalGains|CAP_GAINS/i.test("stateCapGainsRates")).toBe(true);
    expect(/\]\s*\?\?\s*0?\.\d+/.test(sample)).toBe(true);
  });

  it("the scan can see production files at all (vacuity guard)", () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(1000);
  });

  it("the deletion is recorded where the next session will look", () => {
    const ledger = fs.readFileSync(path.join(ROOT, "docs/company/deletion-ledger.md"), "utf8");
    expect(ledger).toContain("taxOptimizationEngine.ts");
    // The two tables it was the only writer of are NOT dropped — a production
    // DROP TABLE is a founder-only hard stop — so they must stay queued rather
    // than quietly forgotten.
    expect(ledger, "the deletion-revealed tables lost their queue entry").toContain(
      "tax_forecast_scenarios",
    );
  });
});
