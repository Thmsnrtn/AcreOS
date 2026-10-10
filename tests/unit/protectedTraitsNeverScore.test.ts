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
 * live. It is deleted; this gate keeps it from coming back anywhere.
 *
 * POPULATION (widened after an independent audit found the first version a
 * hand list): EVERY non-test module under server/services and server/ai —
 * scorers, qualifiers, pricing, and the prompts agents run on — with a
 * floor on the count. A file that legitimately says "age" about TIME, or a
 * compliance checker that names a protected class in order to REFUSE it,
 * sits in EXEMPT with its reason; an exemption that no longer matches fails,
 * so the register can't rot into headroom.
 *
 * String literals (prompts) are read; comments are stripped, so the record
 * of a removal does not trip it.
 */
import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { stripComments } from "../helpers/stripComments";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

/** An age input, a birth date, disability, SSI/SSDI or public-assistance income. */
const FORBIDDEN_I =
  /\b(?:owner|buyer|borrower|seller|lead)?_?age\b\s*(?:[<>]=?|===?)|(?:[<>]=?|===?)\s*(?:\w+\.)?age\b|\b\w*(?:owner|buyer|borrower|seller)_?age(?:years)?\b|\bbirth_?(?:year|date)\b|\bdate_?of_?birth\b|\bdob\b|\byears_?old\b|\bdisabilit(?:y|ies)\b|\bis_?disabled\b|\bSS(?:I|DI)\b|ss(?:di|i)_?income|social[\s_-]*security|public[\s_-]*assistance|\bwelfare\b|\bmedicaid\b/i;
/** Benefit program acronyms — case-sensitive, or "snap" (a snapshot) matches. */
const FORBIDDEN_CS = /\bSNAP\b|\bTANF\b/;

function protectedTraitHits(source: string): string[] {
  return stripComments(source)
    .split("\n")
    .filter((line) => FORBIDDEN_I.test(line) || FORBIDDEN_CS.test(line));
}

/**
 * Each exemption is pinned to its EXACT number of matching lines: the
 * exemption covers those lines, not the file. A new protected-trait line in
 * an exempt file (paxExecutivePrompt.ts is a prompt file) raises the count and fails.
 */
const EXEMPT: Record<string, { reason: string; lines: number }> = {
  // Moved with the executive prompt on 2026-10-09 (executive.ts -> paxExecutivePrompt.ts).
  "server/ai/paxExecutivePrompt.ts": { reason: "portfolio note AGE in months (a loan's age), not a person's", lines: 1 },
  "server/services/andrei/confidenceBand.ts": { reason: "age of a data point in days (staleness)", lines: 2 },
  "server/services/autopilot/dealActions.ts": { reason: "days since first contact", lines: 1 },
  "server/services/autopilot/loopStall.ts": { reason: "milliseconds since dispatch", lines: 2 },
  "server/services/contextProfile.ts": { reason: "cache entry age", lines: 1 },
  "server/services/fcraAttestation.ts": { reason: "attestation TTL", lines: 1 },
  "server/services/founder-chat/providers/fly.ts": { reason: "machine/deploy age", lines: 1 },
  "server/services/founder/taxEngine.ts": { reason: "the founder's own self-employment tax (Social Security wage base)", lines: 2 },
  "server/services/founder/taxRules.ts": { reason: "the founder's own self-employment tax (Social Security wage base)", lines: 3 },
  "server/services/landlordCompliance.ts": { reason: "fair-housing checker: names protected classes in order to REFUSE them", lines: 3 },
};

const POPULATION = [
  ...new Set(
    execSync("git ls-files 'server/services/*.ts' 'server/services/**/*.ts' 'server/ai/*.ts' 'server/ai/**/*.ts'")
      .toString()
      .trim()
      .split("\n")
      .filter((f) => f && !/\.test\.ts$|\.spec\.ts$/.test(f)),
  ),
];

/** The modules that decide who is scored, matched, qualified or priced. */
const DECISION_CORE = [
  "server/services/leadScoring.ts",
  "server/services/leadQualification.ts",
  "server/services/buyerMatchingAI.ts",
  "server/services/buyerQualificationBot.ts",
  "server/services/sellerIntentPredictor.ts",
  "server/services/sellerMotivationEngine.ts",
  "server/services/sellerPsychologyStrategy.ts",
  "server/services/prospectIntelligence.ts",
  "server/services/landCredit.ts",
  "server/services/dealUnderwriting.ts",
  "server/ai/vaService.ts",
];

describe("the gate itself (canaries)", () => {
  it.each([
    ["an owner-age threshold", "const s = ownerAge > 75 ? 75 : 0;"],
    ["a snake_case age input", "if (owner_age >= 65) score += 40;"],
    ["a reversed comparison", "if (65 <= owner.age) score += 40;"],
    ["an estimated owner age field", "const a = parcel.estimatedOwnerAge;"],
    ["a birth year", "const y = enrichment.birthYear;"],
    ["a date of birth", "const d = person.dateOfBirth;"],
    ["disability in a prompt", 'const prompt = "Flag buyers on disability as higher risk";'],
    ["an isDisabled flag", "if (buyer.isDisabled) reject();"],
    ["SSI income", "if (income.source === 'SSI') reject();"],
    ["ssiIncome", "const x = profile.ssiIncome;"],
    ["Social Security income", 'reasons.push("Income is Social Security only");'],
    ["public assistance", 'const q = "receives public assistance";'],
    ["SNAP", 'if (benefits.includes("SNAP")) score -= 10;'],
  ])("goes red on %s", (_label, line) => {
    expect(protectedTraitHits(line)).toHaveLength(1);
  });
  it("does not read a comment recording a removal", () => {
    expect(protectedTraitHits("// calcOwnerAgeSignal deleted: ownerAge > 75 is not a factor\nconst x = 1;")).toEqual([]);
  });
  it("does not trip on unrelated words", () => {
    expect(
      protectedTraitHits(
        "const disabled = true; const disabledReason = 'x'; const page = 1; const average = 2; const ownerAgentCodename = 'a'; const snap = s; const usage = 3;",
      ),
    ).toEqual([]);
  });
});

describe("the population", () => {
  it("is every service and AI module (floor), and includes the decision core", () => {
    expect(POPULATION.length).toBeGreaterThan(800);
    for (const f of DECISION_CORE) expect(POPULATION).toContain(f);
  });

  it("no module outside the exemption register uses a protected trait", () => {
    const offenders = POPULATION.filter((f) => !(f in EXEMPT)).flatMap((f) =>
      protectedTraitHits(readFileSync(f, "utf8")).map((line) => `${f}: ${line.trim().slice(0, 120)}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each(Object.keys(EXEMPT))("the exemption for %s covers exactly its pinned lines (no stale headroom, no new hits)", (f) => {
    expect(POPULATION).toContain(f);
    expect(protectedTraitHits(readFileSync(f, "utf8")).length).toBe(EXEMPT[f].lines);
  });

  it.each(DECISION_CORE)("%s was read and has code in it (vacuity floor)", (f) => {
    expect(stripComments(readFileSync(f, "utf8")).trim().length).toBeGreaterThan(200);
  });
});

/**
 * Founder ruling 2026-09-29 (#4, docs/company/founder-decisions-2026-09-29.md):
 * seller-motivation scoring may not use HEALTH (a disability proxy: "medical
 * bills", "hospital", "can't maintain") or RETIREMENT (an age proxy:
 * "retiring", "downsizing"). "Divorce" is held pending counsel and is NOT
 * forbidden here. The population is every module that scores or coaches on
 * seller motivation.
 */
const SELLER_SCORING = [
  "server/services/sellerIntentPredictor.ts",
  "server/services/sellerPsychologyStrategy.ts",
  "server/services/sellerMotivationEngine.ts",
  "server/services/prospectIntelligence.ts",
  "server/services/leadScoring.ts",
  "server/services/leadIntelligenceEngine.ts",
];
const SELLER_PROXY = /\bhealth\s*:|medical bills|hospital|can't maintain|\bretir(?:ing|ement)\b|downsizing/i;

describe("seller motivation never reads health or retirement (ruling #4)", () => {
  it("the proxy pattern sees each shape (canaries)", () => {
    expect(SELLER_PROXY.test('  health: ["medical bills"],')).toBe(true);
    expect(SELLER_PROXY.test('retirement: ["retiring", "downsizing"],')).toBe(true);
    expect(SELLER_PROXY.test('} else if (profile.lifeEvent === "retirement") {')).toBe(true);
    expect(SELLER_PROXY.test('divorce: ["divorce", "separated"],')).toBe(false);
  });
  it.each(SELLER_SCORING)("%s carries no health or retirement signal", (f) => {
    const code = stripComments(readFileSync(f, "utf8"));
    expect(code.trim().length).toBeGreaterThan(200);
    expect(code.split("\n").filter((l) => SELLER_PROXY.test(l))).toEqual([]);
  });
});
