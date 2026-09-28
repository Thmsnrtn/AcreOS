/**
 * DEFECT-0178 — age, disability and public-assistance income are never a
 * factor in who is scored, matched, qualified or offered terms.
 *
 * The 2026-09-28 practitioner supplement records a 2020 buyer-screening
 * transcript treating disability and Social Security income as signs of an
 * undesirable buyer, and asks that this never be encoded in buyer
 * qualification, terms eligibility, lead scores or agent prompts (ECOA
 * protects receipt of public assistance; age is a protected basis too).
 * At HEAD, `leadScoring.ts` still carried `calcOwnerAgeSignal` — "Owner age
 * >75 — estate/probate probability elevated (+75)" — unwired, one call from
 * live. It is deleted; this gate keeps the whole decision population clean.
 *
 * The POPULATION is enumerated, not globbed by convention: every module that
 * scores, matches, qualifies or prices a counterparty. Adding one means
 * adding it here. String literals are READ (prompts are strings); comments
 * are stripped, so a comment recording what was removed does not trip it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";

const DECISION_POPULATION = [
  "server/services/leadScoring.ts",
  "server/services/leadQualification.ts",
  "server/services/leadScoreDecay.ts",
  "server/services/buyerMatchingAI.ts",
  "server/services/buyerQualificationBot.ts",
  "server/services/sellerIntentPredictor.ts",
  "server/services/prospectIntelligence.ts",
  "server/services/landCredit.ts",
  "server/services/dealUnderwriting.ts",
];

/**
 * A protected trait used as an input: an age field or threshold, disability,
 * Social Security / SSI / SSDI, public assistance or welfare income.
 */
const FORBIDDEN =
  /\b(?:owner|buyer|borrower|seller|lead)?_?age\b\s*[<>]=?|\b(?:owner|buyer|borrower|seller)Age\b|\bdisabilit(?:y|ies)\b|\bSS(?:I|DI)\b|social\s+security|public\s+assistance|\bwelfare\b/i;

function protectedTraitHits(source: string): string[] {
  return stripComments(source)
    .split("\n")
    .filter((line) => FORBIDDEN.test(line));
}

describe("the gate itself (canaries)", () => {
  it.each([
    ["an owner-age threshold", "const s = ownerAge > 75 ? 75 : 0;"],
    ["a snake_case age input", "if (owner_age >= 65) score += 40;"],
    ["disability in a prompt", 'const prompt = "Flag buyers on disability as higher risk";'],
    ["SSI income", "if (income.source === 'SSI') reject();"],
    ["Social Security income", 'reasons.push("Income is Social Security only");'],
  ])("goes red on %s", (_label, line) => {
    expect(protectedTraitHits(line)).toHaveLength(1);
  });
  it("does not read a comment recording a removal", () => {
    expect(protectedTraitHits("// calcOwnerAgeSignal deleted: ownerAge > 75 is not a factor\nconst x = 1;")).toEqual([]);
  });
  it("does not trip on unrelated words", () => {
    expect(protectedTraitHits("const disabled = true; const disabledReason = 'x'; const page = 1; const average = 2; const ownerAgentCodename = 'a';")).toEqual(
      [],
    );
  });
});

describe("the decision population", () => {
  it.each(DECISION_POPULATION)("%s uses no protected trait as an input", (file) => {
    expect(existsSync(file)).toBe(true);
    const src = readFileSync(file, "utf8");
    // Vacuity floor: the file was actually read and has code in it.
    expect(stripComments(src).trim().length).toBeGreaterThan(200);
    expect(protectedTraitHits(src)).toEqual([]);
  });
});
