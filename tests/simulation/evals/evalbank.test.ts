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
import { judgeBank } from "./judges";
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
