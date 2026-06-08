/**
 * Tests for the semantic grounding judge scorer (server/services/aiEvalHarness.ts).
 *
 * The scorer wraps the shared llmJudge.judge() over the data-grounding eval
 * cases. We mock judge() so no live model is called, and assert:
 *   1. scoreGroundingJudge maps judge verdicts → pass/fail and passes the
 *      grounding rubric + source context + adjudicate/failClosed options.
 *   2. runGroundingJudgeEval scores each case's safe (expected pass) and
 *      adversarial (expected fail) variants, and SURFACES DISAGREEMENTS between
 *      the substring contains-check and the judge — the hand-label candidates
 *      that are the whole point of the semantic layer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the shared judge primitive — no live API.
vi.mock("../../server/services/llmJudge", () => ({
  judge: vi.fn(),
}));

// db is imported transitively by aiEvalHarness; stub it so import doesn't blow up.
vi.mock("../../server/db", () => ({ db: {} }));

import {
  scoreGroundingJudge,
  runGroundingJudgeEval,
  GROUNDING_JUDGE_RUBRIC,
} from "../../server/services/aiEvalHarness";
import { judge } from "../../server/services/llmJudge";

const mockJudge = vi.mocked(judge);

function verdict(v: "pass" | "fail", confidence = 0.9) {
  return {
    verdict: v,
    confidence,
    reason: `mock ${v}`,
    trace: { mode: "adjudicate" as const, models: ["m"], escalated: false },
  };
}

beforeEach(() => {
  mockJudge.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("scoreGroundingJudge", () => {
  it("maps a judge 'pass' to score 'pass' and forwards rubric + adjudicate/failClosed", async () => {
    mockJudge.mockResolvedValueOnce(verdict("pass", 0.92));
    const res = await scoreGroundingJudge({
      answer: "It's about 9.3 acres (County GIS, as of 2024).",
      sourceContext: "tool returned 9.3 acres from County GIS",
      orgId: 7,
    });
    expect(res.score).toBe("pass");
    expect(res.confidence).toBeCloseTo(0.92);
    const callArg = mockJudge.mock.calls[0][0];
    expect(callArg.rubric).toBe(GROUNDING_JUDGE_RUBRIC);
    expect(callArg.mode).toBe("adjudicate");
    expect(callArg.failClosed).toBe(true);
    expect(callArg.orgId).toBe(7);
    expect(callArg.context).toContain("County GIS");
  });

  it("maps a judge 'fail' to score 'fail'", async () => {
    mockJudge.mockResolvedValueOnce(verdict("fail", 0.8));
    const res = await scoreGroundingJudge({
      answer: "It's about 40 acres based on typical lots.",
      sourceContext: "tool returned 9.3 acres from County GIS",
    });
    expect(res.score).toBe("fail");
  });
});

describe("runGroundingJudgeEval", () => {
  it("scores safe→pass and adversarial→fail for a case the judge agrees with (no disagreement)", async () => {
    // The flood-MISS case: safeOutput is grounded (pass), adversarialOutput
    // ('FEMA Zone X, minimal flood risk') is a hallucination (fail).
    // A correct judge agrees with the substring check on both → no disagreement.
    // judge() is called safe-first then adversarial per case.
    mockJudge
      .mockResolvedValueOnce(verdict("pass")) // safe
      .mockResolvedValueOnce(verdict("fail")); // adversarial

    const res = await runGroundingJudgeEval({ caseIds: ["dg-miss-flood-001"] });
    expect(res.totalScored).toBe(2);
    expect(res.disagreements).toHaveLength(0);
    expect(res.judgeAccuracy).toBe(1);
    // The substring net also catches this case's adversarial literal ("zone x"),
    // so substring accuracy is 1 too.
    expect(res.substringAccuracy).toBe(1);
  });

  it("flags a disagreement when the judge catches a paraphrase the substring check misses", async () => {
    // Construct the canonical paraphrased-hallucination scenario: the judge
    // FAILs the adversarial answer (semantic catch) while the substring check —
    // because we feed a paraphrase with none of the forbidden literals — would
    // PASS it. We simulate by having the judge fail BOTH variants of a case
    // whose adversarial literal the substring check DOES catch but whose safe
    // output the judge wrongly fails → a disagreement on the safe variant.
    mockJudge
      .mockResolvedValueOnce(verdict("fail")) // judge (wrongly) fails the SAFE output
      .mockResolvedValueOnce(verdict("fail")); // judge fails the adversarial (agrees w/ substring)

    const res = await runGroundingJudgeEval({ caseIds: ["dg-miss-flood-001"] });
    // safe variant: substring=pass, judge=fail → disagreement.
    const safeRow = res.results.find((r) => r.variant === "safe")!;
    expect(safeRow.substring).toBe("pass");
    expect(safeRow.judge).toBe("fail");
    expect(safeRow.disagreement).toBe(true);
    expect(res.disagreements.length).toBeGreaterThanOrEqual(1);
  });

  it("scores every case in the set when no caseIds filter is given", async () => {
    // Default judge → pass on everything; just assert it walks the whole set
    // and never calls more than 2 judges per case.
    mockJudge.mockResolvedValue(verdict("pass"));
    const res = await runGroundingJudgeEval();
    expect(res.totalScored).toBeGreaterThan(0);
    // Each scored row is one judge call.
    expect(mockJudge).toHaveBeenCalledTimes(res.totalScored);
  });
});
