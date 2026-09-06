/**
 * One deposit registry. There used to be two, and they disagreed about four states.
 *
 * `shared/governance/statuteRegister.ts` warned about this in its own words, and
 * had for a while:
 *
 *     TWO overlapping deposit registries exist (shared/regulatory/depositReturnRules.ts
 *     and SECURITY_DEPOSIT_RULES in server/services/landlordCompliance.ts).
 *     They can disagree, and nothing cross-checks them.
 *
 * Unit 105 ran the check. Fifty states appeared in both, forty-six agreed, and
 * **four gave different statutory deadlines while citing the same statute:**
 *
 *   | state | landlordCompliance | depositReturnRules |
 *   |-------|--------------------|--------------------|
 *   | FL    | 15 days            | 30 days            |
 *   | ME    | 30 days            | 21 days            |
 *   | MT    | 10 days            | 30 days            |
 *   | OK    | 45 days            | 30 days            |
 *
 * **Founder ruling (picker, 2026-08-14): retire the dead duplicate.** Unit 108
 * removed `SECURITY_DEPOSIT_RULES` and `computeSecurityDepositDeadline` from
 * `landlordCompliance.ts` — a module NOTHING IMPORTED — leaving
 * `depositReturnRules.ts`, which the deposit clock, the disposition letter and the
 * rent-ledger surface actually read, as the single owner.
 *
 * WHY REMOVAL RATHER THAN RECONCILIATION. Deciding which reading of Fla. Stat.
 * §83.49 is right is legal judgement. The live registry is deliberately incomplete
 * and says so — a state it does not encode returns `{ known: false, unknownReason }`
 * and the caller surfaces that sentence — so removing the second table costs
 * coverage the product was never actually using, and buys the guarantee that two
 * numbers cannot both be shown as the law. **A confident wrong deadline is worse
 * than an honest gap.** Widening the live registry is separate, reviewable work,
 * still open in B18.
 *
 * The rollover defect went with it: `computeSecurityDepositDeadline` parsed with a
 * bare `new Date()` plus a NaN check, so `"2026-02-30"` became March 2 — the exact
 * shape unit 99 removed from everything live.
 *
 * SO THIS FILE CHANGED JOB rather than being deleted. It used to pin the four
 * disagreements in both directions; it now asserts the property that makes a
 * disagreement impossible — **one owner** — and that the live one kept the honest
 * refusal that made it the right survivor.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getDepositReturnRule } from "@shared/regulatory/depositReturnRules";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

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

describe("there is exactly one deposit registry", () => {
  it("the duplicate table is gone", () => {
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/services/landlordCompliance.ts"), "utf8"),
    );
    expect(
      src,
      "SECURITY_DEPOSIT_RULES is back in landlordCompliance.ts. It disagreed with " +
        "the live registry about FL, ME, MT and OK while citing the same statutes " +
        "(B18). One owner, or two numbers can both be shown as the law.",
    ).not.toContain("SECURITY_DEPOSIT_RULES");
    expect(src).not.toContain("computeSecurityDepositDeadline");
  });

  it("and no second deposit-deadline table exists anywhere", () => {
    // Not a path check. The same 51 entries pasted into another module would be
    // the same defect, so this looks for the SHAPE: a state-keyed map of
    // move-out day counts.
    // Two exclusions, both deliberate. The live registry is the owner, so it is
    // not a rival. And `statuteRegister.ts` is DOCUMENTATION IN CODE FORM — its
    // job is to name statutes and the code that implements them, so its note
    // about this very removal quotes the retired symbol. That is a string in
    // CODE, which comment-stripping cannot reach: the twelfth time in this
    // program that prose has tripped a check meant for code, and the second where
    // the prose lives in a string literal rather than a comment.
    const EXEMPT = new Set([
      "shared/regulatory/depositReturnRules.ts",
      "shared/governance/statuteRegister.ts",
    ]);
    const offenders = productionFiles().filter((rel) => {
      if (EXEMPT.has(rel)) return false;
      const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      return /daysAfterMoveOut|SECURITY_DEPOSIT_RULES/.test(code);
    });
    expect(
      offenders,
      "a second security-deposit deadline table appeared. shared/regulatory/" +
        "depositReturnRules.ts is the one the deposit clock, the disposition " +
        "letter and the rent-ledger surface read — widen THAT, with the citation " +
        "checked, rather than starting a rival.",
    ).toEqual([]);
  }, REPO_SWEEP_TIMEOUT_MS);

  it("the detector would notice one (guard against a vacuous pass)", () => {
    // The assertion above passes trivially if the pattern is broken.
    expect(/daysAfterMoveOut|SECURITY_DEPOSIT_RULES/.test("daysAfterMoveOut: 21")).toBe(true);
  });

  it("the scan sees production files at all (vacuity guard)", () => {
    expect(productionFiles().length).toBeGreaterThan(1000);
  });
});

describe("the survivor kept the posture that made it the right one", () => {
  it("refuses a state it does not encode, instead of inventing a number", () => {
    // THE REASON removal was safe. Losing the wider table costs coverage; it does
    // not cost honesty, because the live registry never guessed in the first
    // place. If this ever starts returning a default, the deletion becomes a real
    // loss and B18 has to be reopened.
    expect(getDepositReturnRule("ZZ")).toBeNull();
    expect(getDepositReturnRule(null)).toBeNull();
    expect(getDepositReturnRule(undefined)).toBeNull();
  });

  it("still answers for the states it does encode", () => {
    // Vacuity guard: a registry that returned null for everything would satisfy
    // the assertion above and break every deposit surface.
    const ca = getDepositReturnRule("CA");
    expect(ca, "the live registry answers nothing at all").not.toBeNull();
    expect(ca!.deadlineDays).toBeGreaterThan(0);
    expect(ca!.citation.length).toBeGreaterThan(5);
  });

  it("and the four disputed states are still encoded by the survivor", () => {
    // Removing the duplicate must not have removed COVERAGE of the states the
    // dispute was about — otherwise the disagreement was "resolved" by dropping
    // the question.
    for (const s of ["FL", "ME", "MT", "OK"]) {
      const r = getDepositReturnRule(s);
      expect(r, `${s} lost its deadline when the duplicate went`).not.toBeNull();
      expect(r!.deadlineDays).toBeGreaterThan(0);
    }
  });
});

describe("the statute register records what happened", () => {
  const register = fs.readFileSync(
    path.join(ROOT, "shared/governance/statuteRegister.ts"),
    "utf8",
  );

  it("no longer claims two registries exist", () => {
    expect(
      register,
      "statuteRegister still describes two overlapping deposit registries. There " +
        "is one; the duplicate was retired under B18.",
    ).not.toMatch(/TWO overlapping deposit registries exist/);
  });

  it("and points at this file for the single-ownership guarantee", () => {
    expect(register).toContain("depositRegistriesAgree");
  });
});
