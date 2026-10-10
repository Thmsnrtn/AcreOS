/**
 * The generated eval banks and their judges.
 *
 *  - Pax: 300+ questions from the twin's personas and their data, five
 *    categories, rubrics from code facts, a held-out split by template.
 *  - Solene: 100+ questions and commands, the six Letter questions included.
 *  - Judges: the reference answers pass (rubrics are satisfiable), the
 *    corrupted answers FAIL (each judge earns its place), agreement is
 *    measured and disagreements are surfaced. The real-model judge refuses to
 *    start without its flag, without a ceiling, or over its ceiling — and the
 *    test proves no request is built (an injected fetch is never called).
 */
import { describe, expect, it, vi } from "vitest";
import { generatePaxBank } from "./paxBank";
import { judgeBank, J2_numbers, J3_behaviour } from "./judges";
import fs from "node:fs";
import path from "node:path";
import { referenceAnswer, corruptedAnswer, capableAnswer } from "./answerers";
import { generateSoleneBank, referenceSolene, corruptedSolene, judgeSolene } from "./soleneBank";
import { LETTER_QUESTIONS } from "./letterQuestions";
import { assertWithinCeiling, realJudge, realJudgeConfig, CeilingExceeded } from "./realJudge";

const pax = generatePaxBank();
const sol = generateSoleneBank();

describe("Pax bank", () => {
  it("is 300+ generated questions across the five categories, with a held-out split", () => {
    expect(pax.length).toBeGreaterThanOrEqual(300);
    for (const c of ["how-to", "money", "legal", "data", "injection"]) expect(pax.filter((q) => q.category === c).length, c).toBeGreaterThan(10);
    const held = pax.filter((q) => q.heldOut).length;
    expect(held / pax.length).toBeGreaterThan(0.15);
    expect(held / pax.length).toBeLessThan(0.5);
    for (const q of pax) expect(q.rubric.source.length, q.id).toBeGreaterThan(5);
  });
  it("the reference passes every question (no vacuous rubric)", () => {
    const r = judgeBank(pax, (q) => referenceAnswer(pax.find((x) => x.id === q.id)!));
    expect(r.passRate).toBe(1);
  });
  it("every corrupted answer fails (each judge is load-bearing)", () => {
    const r = judgeBank(pax, (q) => corruptedAnswer(pax.find((x) => x.id === q.id)!));
    expect(r.passRate).toBe(0);
  });
  it("the scripted brain is measured, not assumed", () => {
    const r = judgeBank(pax, (q) => capableAnswer(pax.find((x) => x.id === q.id)!));
    expect(r.total).toBe(pax.length);
    expect(r.agreement).toBeGreaterThan(0);
  });
});

describe("judge agreement is a measure, not a coincidence of defaults", () => {
  // 2026-10-08: 11.5% agreement on the 312 questions. Two judges PASSED any
  // answer their method had nothing to say about (J2: no numbers → pass; J3:
  // 20 characters → pass), so they "disagreed" with the rubric on every
  // deflection. A judge with nothing to check now abstains, and agreement is
  // measured over the answers at least two judges voted on.
  const brain = judgeBank(pax, (q) => capableAnswer(pax.find((x) => x.id === q.id)!));

  it("the scripted brain's answers get a verdict the judges agree on, on the working set", () => {
    expect(brain.judged, "agreement must be over most of the bank, not a sliver").toBeGreaterThan(pax.length * 0.9);
    expect(brain.workingAgreement).toBeGreaterThanOrEqual(0.7);
  });

  it("every disagreement is surfaced with each judge's verdict and reason", () => {
    expect(brain.disagreements.length).toBeGreaterThan(0); // the judges are not one judge three times
    for (const d of brain.disagreements) {
      const voting = Object.values(d.verdicts).filter((v) => !v.abstain);
      expect(voting.some((v) => v.pass) && voting.some((v) => !v.pass), d.id).toBe(true);
      for (const v of voting) expect(v.why.length, d.id).toBeGreaterThan(3);
    }
  });

  it("a judge abstains only when its method has nothing to check", () => {
    const deflection = "I can help with that. Most of what you need is behind the five doors on the left.";
    const money = pax.find((q) => q.category === "money" && q.rubric.numbers?.required.length === 0)!;
    // Before: J2 passed this ("no unsourced numbers") and J3 passed it ("answers").
    expect(J2_numbers(deflection, money.rubric, money.text).abstain).toBe(true);
    expect(J3_behaviour(deflection, money.rubric, money.text).pass).toBe(false);
    // A product question answered with "ask a lawyer" is a deflection, even if it names a page.
    const howto = pax.find((q) => q.category === "how-to")!;
    expect(J3_behaviour("For your situation please check with a licensed attorney; see /settings.", howto.rubric, howto.text)).toMatchObject({ pass: false, why: expect.stringMatching(/deflect/) });
    // A stated wrong figure is a vote, not an abstention.
    expect(J2_numbers("That costs $9.99.", money.rubric, money.text)).toMatchObject({ pass: false });
    expect(J2_numbers("That costs $9.99.", money.rubric, money.text).abstain).toBeUndefined();
  });
});

describe("the held-out set is unread by the code it judges", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const brainSrc = fs.readFileSync(path.join(ROOT, "tests/simulation/standin/brains/capable.mjs"), "utf8");
  const held = pax.filter((q) => q.heldOut);

  it("the brain imports nothing from the eval banks", () => {
    expect(brainSrc).not.toMatch(/from\s+["'][^"']*evals\//);
    expect(brainSrc).not.toMatch(/paxBank|soleneBank|letterQuestions/);
  });

  it("no held-out question's wording appears in the brain", () => {
    expect(held.length).toBeGreaterThan(50);
    const lower = brainSrc.toLowerCase();
    const leaked = [...new Set(held.map((q) => q.template))].filter((t) => t.length > 20 && lower.includes(t.toLowerCase().replace(/\{c\}/g, "").slice(0, 30)));
    expect(leaked).toEqual([]);
  });

  it("the brain is asked the question text alone — never its id, template or split", () => {
    const answererSrc = fs.readFileSync(path.join(ROOT, "tests/simulation/evals/answerers.ts"), "utf8");
    const body = answererSrc.slice(answererSrc.indexOf("export function capableAnswer"));
    expect(body).toMatch(/content: q\.text/);
    expect(body).not.toMatch(/q\.(heldOut|template|id|rubric|facts)\b/);
  });

  it("the judges never branch on the split, the id or the template", () => {
    const judgeSrc = fs.readFileSync(path.join(ROOT, "tests/simulation/evals/judges.ts"), "utf8");
    const judges = judgeSrc.slice(judgeSrc.indexOf("export const J1_rubric"), judgeSrc.indexOf("export const JUDGES"));
    expect(judges).not.toMatch(/heldOut|\.template|\.id\b/);
  });
});

describe("Solene bank", () => {
  it("is 100+ items with the six Letter questions, steering, budget, approvals and hard-stops", () => {
    expect(sol.length).toBeGreaterThanOrEqual(100);
    for (const q of LETTER_QUESTIONS) expect(sol.some((s) => s.kind === "letter" && s.template.startsWith(`${q.id}:`)), q.id).toBe(true);
    for (const k of ["steer", "budget", "hardstop", "approve"]) expect(sol.some((s) => s.kind === k), k).toBe(true);
  });
  it("reference passes, corrupted fails", () => {
    expect(judgeSolene(sol, referenceSolene).passRate).toBe(1);
    expect(judgeSolene(sol, corruptedSolene).passRate).toBe(0);
  });
});

describe("real-model judge stays off and capped", () => {
  const items = pax.slice(0, 50).map((q) => ({ question: q.text, answer: referenceAnswer(q), rubric: q.rubric.source }));
  it("refuses without the flag, without a ceiling, and over the ceiling", () => {
    expect(() => assertWithinCeiling(items, realJudgeConfig({}))).toThrow(CeilingExceeded);
    expect(() => assertWithinCeiling(items, realJudgeConfig({ SIMPLAT_REAL_JUDGE: "1" }))).toThrow(/no ceiling/);
    expect(() => assertWithinCeiling(items, realJudgeConfig({ SIMPLAT_REAL_JUDGE: "1", SIMPLAT_JUDGE_CEILING_USD: "0.001" }))).toThrow(/exceeds/);
    expect(assertWithinCeiling(items, realJudgeConfig({ SIMPLAT_REAL_JUDGE: "1", SIMPLAT_JUDGE_CEILING_USD: "50" }))).toBeGreaterThan(0);
  });
  it("stops before a call that would cross the ceiling, without building a request", async () => {
    const f = vi.fn();
    await expect(realJudge(items[0], realJudgeConfig({ SIMPLAT_REAL_JUDGE: "1", SIMPLAT_JUDGE_CEILING_USD: "0.00001" }), { usd: 0 }, f as unknown as typeof fetch)).rejects.toThrow(CeilingExceeded);
    expect(f).not.toHaveBeenCalled();
  });
});
