/**
 * Two deposit registries, one statute, four different answers.
 *
 * `shared/governance/statuteRegister.ts` says this in its own words, and has said
 * it for a while:
 *
 *     TWO overlapping deposit registries exist (shared/regulatory/depositReturnRules.ts
 *     and SECURITY_DEPOSIT_RULES in server/services/landlordCompliance.ts).
 *     They can disagree, and nothing cross-checks them.
 *
 * This is that cross-check. The answer is **four states**, and each pair cites
 * the SAME statute while giving a different number of days:
 *
 *   | state | landlordCompliance | depositReturnRules |
 *   |-------|--------------------|--------------------|
 *   | FL    | 15 days            | 30 days            |
 *   | ME    | 30 days            | 21 days            |
 *   | MT    | 10 days            | 30 days            |
 *   | OK    | 45 days            | 30 days            |
 *
 * A security-deposit return deadline is a statutory obligation whose breach
 * carries penalties in most states — often multiple damages. Fifty states are in
 * both tables and forty-six agree, which is what makes the four worth pinning
 * rather than dismissing as noise: they are not a systematic offset, they are
 * four specific readings of four specific statutes that cannot both be right.
 *
 * **WHICH IS CORRECT IS NOT DECIDED HERE, deliberately.** Reading a statute and
 * picking a number is legal judgement, and getting a statutory deadline wrong is
 * worse than flagging that two of ours disagree. Recorded as **BLOCKERS B18** for
 * someone who can make that call; the assertion below just makes sure a FIFTH
 * cannot appear quietly, and that resolving one is locked in by the commit that
 * earns it.
 *
 * CONTEXT THAT MATTERS FOR WHOEVER RESOLVES IT. The two tables are not peers:
 *
 *   • `depositReturnRules.ts` is the LIVE one — the deposit clock, the
 *     disposition letter and the rent-ledger surface all read it. It is
 *     deliberately incomplete and returns `{ known: false, unknownReason }` for a
 *     state it does not encode, which is the honest posture.
 *   • `SECURITY_DEPOSIT_RULES` is COMPLETE (51 entries, every state plus DC) and
 *     carries citations — and **nothing imports `landlordCompliance.ts`**. It is
 *     a fuller table inside a module with no production caller, found by the same
 *     registry-ghost sweep that produced B17. It also parses its move-out date
 *     with a bare `new Date()` plus a NaN check, which is the rollover defect
 *     unit 99 fixed everywhere that is live.
 *
 * So the likely resolution is not "pick one per state" but "decide whether the
 * complete table should back the live one" — a bigger question than four numbers,
 * which is exactly why it is written down rather than guessed at.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SECURITY_DEPOSIT_RULES } from "../../server/services/landlordCompliance";
import { getDepositReturnRule } from "@shared/regulatory/depositReturnRules";

const ROOT = path.resolve(__dirname, "../..");

/** The disagreements as measured, `state: [landlordCompliance, depositReturnRules]`. */
const KNOWN_DISAGREEMENTS: Record<string, [number, number]> = {
  FL: [15, 30],
  ME: [30, 21],
  MT: [10, 30],
  OK: [45, 30],
};

function compare() {
  const overlap: string[] = [];
  const disagree: Record<string, [number, number]> = {};
  for (const code of Object.keys(SECURITY_DEPOSIT_RULES).sort()) {
    const a = SECURITY_DEPOSIT_RULES[code];
    const b = getDepositReturnRule(code);
    if (!b) continue;
    overlap.push(code);
    if (b.deadlineDays !== a.daysAfterMoveOut) {
      disagree[code] = [a.daysAfterMoveOut, b.deadlineDays];
    }
  }
  return { overlap, disagree };
}

describe("the two deposit registries are cross-checked, which they were not", () => {
  it("both tables are populated and overlap (vacuity guard)", () => {
    // Every assertion below is about a comparison. If either table were empty or
    // the lookup returned null for everything, "no new disagreements" would pass
    // while checking nothing at all.
    const { overlap } = compare();
    expect(Object.keys(SECURITY_DEPOSIT_RULES).length).toBeGreaterThanOrEqual(50);
    expect(overlap.length, "the two registries no longer overlap — is the lookup broken?")
      .toBeGreaterThanOrEqual(45);
  });

  it("no NEW state disagrees", () => {
    const { disagree } = compare();
    const unexpected = Object.keys(disagree).filter((s) => !(s in KNOWN_DISAGREEMENTS));
    expect(
      unexpected.map((s) => `${s}: landlordCompliance=${disagree[s][0]}d vs depositReturnRules=${disagree[s][1]}d`),
      "a new state now has two different statutory deposit deadlines in this " +
        "repo. Both tables cite the statute; they cannot both be right, and the " +
        "breach of a deposit deadline carries penalties in most states. Reconcile " +
        "it against the citation — do not add it to KNOWN_DISAGREEMENTS to make " +
        "this pass.",
    ).toEqual([]);
  });

  it("and a RESOLVED one is locked in", () => {
    // The other direction, same discipline as every ratchet here: fixing one
    // must lower the register in the commit that fixes it, or the next reader
    // believes a disagreement that no longer exists.
    const { disagree } = compare();
    const stale = Object.keys(KNOWN_DISAGREEMENTS).filter((s) => !(s in disagree));
    expect(
      stale,
      "these states no longer disagree — good news. Remove them from " +
        "KNOWN_DISAGREEMENTS here and from BLOCKERS B18 in the same commit.",
    ).toEqual([]);
  });

  it("the recorded day counts are the real ones", () => {
    // Pins the numbers, not just the state list: a table edited so the pair
    // changes (say FL becoming 15 vs 45) is a different finding and B18's
    // evidence would be stale.
    const { disagree } = compare();
    for (const [state, pair] of Object.entries(KNOWN_DISAGREEMENTS)) {
      expect(disagree[state], `${state}'s disagreement changed shape — re-read B18`).toEqual(pair);
    }
  });

  it("the forty-six that agree still agree", () => {
    // The measurement that makes the four meaningful. If agreement collapsed,
    // the two tables would have diverged wholesale and the four would no longer
    // be the story.
    const { overlap, disagree } = compare();
    const agreeing = overlap.length - Object.keys(disagree).length;
    expect(agreeing, "the registries diverged well beyond the four known states")
      .toBeGreaterThanOrEqual(45);
  });
});

describe("the statute register stops saying nothing checks them", () => {
  const register = fs.readFileSync(
    path.join(ROOT, "shared/governance/statuteRegister.ts"),
    "utf8",
  );

  it("its note points at this cross-check instead", () => {
    // The register's own sentence was true when written and is the thing this
    // unit retired. Leaving it would be a register asserting a fact about the
    // repo that the repo has since falsified — §6a's rule, applied to a
    // governance file.
    expect(
      register,
      "statuteRegister still claims nothing cross-checks the two deposit " +
        "registries. It does now — point the note at depositRegistriesAgree.test.ts.",
    ).not.toMatch(/They can disagree, and nothing cross-checks them\./);
    expect(register).toContain("depositRegistriesAgree");
  });

  it("and the blocker is written where the next session will find it", () => {
    const blockers = fs.readFileSync(path.join(ROOT, "docs/implementation/BLOCKERS.md"), "utf8");
    expect(blockers).toMatch(/## B18 —/);
  });
});
