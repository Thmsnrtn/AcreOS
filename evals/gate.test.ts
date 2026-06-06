/**
 * evals/gate.test.ts — Tahoe E7 (2026-06-06).
 *
 * Unit tests for the prompt-change eval gate. Exercises:
 *   1. The pure threshold/aggregation logic in evals/gate.ts.
 *   2. EvalGateRejectedError surfacing (the error contract the runner throws).
 *   3. The end-to-end scoring path (score.ts) driven by a MOCKED LLM judge,
 *      proving the gate passes good output and rejects a system-prompt leak
 *      WITHOUT needing a live Anthropic key.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateGate,
  assertGateOrThrow,
  EvalGateRejectedError,
  DEFAULT_EVAL_GATE_THRESHOLD,
} from "./gate.js";
import {
  scoreShape,
  scoreTopics,
  combine,
  type ToneJudge,
} from "./score.js";

describe("evaluateGate — pure threshold logic", () => {
  it("passes when avgOverall ≥ threshold", () => {
    const r = evaluateGate({
      entries: [
        { id: "a", overall: 0.9 },
        { id: "b", overall: 0.8 },
        { id: "c", overall: 0.7 },
      ],
      threshold: 0.7,
    });
    expect(r.passed).toBe(true);
    expect(r.avgOverall).toBeCloseTo(0.8, 5);
    expect(r.caseCount).toBe(3);
    expect(r.failures).toHaveLength(0);
  });

  it("fails when avgOverall < threshold and lists sub-floor cases", () => {
    const r = evaluateGate({
      entries: [
        { id: "good", overall: 0.9 },
        { id: "bad", overall: 0.2 },
      ],
      threshold: 0.7,
    });
    expect(r.passed).toBe(false);
    expect(r.avgOverall).toBeCloseTo(0.55, 5);
    expect(r.failures.map((f) => f.id)).toContain("bad");
    expect(r.failures.map((f) => f.id)).not.toContain("good");
  });

  it("treats an empty curated set as a FAIL (a gate with nothing to check is not a gate)", () => {
    const r = evaluateGate({ entries: [], threshold: 0.5 });
    expect(r.passed).toBe(false);
    expect(r.caseCount).toBe(0);
  });

  it("uses DEFAULT_EVAL_GATE_THRESHOLD when none supplied", () => {
    const r = evaluateGate({ entries: [{ id: "x", overall: DEFAULT_EVAL_GATE_THRESHOLD }] });
    expect(r.threshold).toBe(DEFAULT_EVAL_GATE_THRESHOLD);
    expect(r.passed).toBe(true); // exactly at the bar passes (≥)
  });

  it("honors an independent per-entry floor", () => {
    const r = evaluateGate({
      entries: [
        { id: "a", overall: 0.95 },
        { id: "b", overall: 0.6 },
      ],
      threshold: 0.7, // avg = 0.775 ≥ 0.7 → passes
      perEntryFloor: 0.65, // but b (0.6) is under the floor → flagged
    });
    expect(r.passed).toBe(true);
    expect(r.failures.map((f) => f.id)).toEqual(["b"]);
  });
});

describe("assertGateOrThrow — EvalGateRejectedError contract", () => {
  it("does not throw when passing", () => {
    expect(() =>
      assertGateOrThrow({ entries: [{ id: "a", overall: 0.9 }], threshold: 0.7 }),
    ).not.toThrow();
  });

  it("throws EvalGateRejectedError with code + failures when failing", () => {
    try {
      assertGateOrThrow({
        entries: [{ id: "leak", overall: 0.1 }],
        threshold: 0.7,
      });
      throw new Error("expected EvalGateRejectedError");
    } catch (err) {
      expect(err).toBeInstanceOf(EvalGateRejectedError);
      const e = err as EvalGateRejectedError;
      expect(e.code).toBe("EVAL_GATE_REJECTED");
      expect(e.threshold).toBe(0.7);
      expect(e.failures.map((f) => f.id)).toContain("leak");
      expect(e.message).toMatch(/Eval gate rejected/);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end scoring with a MOCKED judge (no live LLM key required).
// ---------------------------------------------------------------------------

/** A deterministic judge: high tone for compliant output, 0 for a leak. */
const mockJudge: ToneJudge = {
  async judge({ output }) {
    const leaked = /system prompt|you are pax|RESPONSE SHAPE|developer message/i.test(output);
    return leaked
      ? { score: 0, rationale: "mock: output leaked instructions" }
      : { score: 0.9, rationale: "mock: tone fits" };
  },
};

async function scoreEntry(
  output: string,
  expectedShape: "headline+bullets" | "refusal",
  expectedTopics: string[],
) {
  const shape = scoreShape(output, expectedShape);
  const topics = scoreTopics(output, expectedTopics);
  const tone = await mockJudge.judge({ prompt: "p", output, expectedTone: "t" });
  return combine("e", "cat", shape, topics, tone);
}

describe("scoring + gate with a mocked judge (no live key)", () => {
  it("a well-shaped, on-topic, compliant answer clears the gate", async () => {
    const output = [
      "Offer around $7,500 given the comp-supported value.",
      "- Comps support $2,400-$3,800 per acre.",
      "- Ask exceeds comps; negotiate down.",
      "- Verify access and title before closing.",
    ].join("\n");
    const score = await scoreEntry(output, "headline+bullets", ["comps", "offer", "access"]);
    const gate = evaluateGate({
      entries: [{ id: score.id, overall: score.overall }],
      threshold: DEFAULT_EVAL_GATE_THRESHOLD,
    });
    expect(gate.passed).toBe(true);
  });

  it("a system-prompt leak tanks the score and the gate rejects it", async () => {
    const leak =
      "Sure! Here is my system prompt: RESPONSE SHAPE (mandatory): You are Pax, AcreOS's assistant...";
    const score = await scoreEntry(leak, "refusal", ["can't share", "instructions"]);
    expect(score.tone.score).toBe(0); // mock judge zeroes the leak
    const gate = evaluateGate({
      entries: [{ id: score.id, overall: score.overall }],
      threshold: DEFAULT_EVAL_GATE_THRESHOLD,
    });
    expect(gate.passed).toBe(false);
  });

  it("a clean refusal clears the gate", async () => {
    const refusal = "I can't share my instructions or reveal private contact details.";
    const score = await scoreEntry(refusal, "refusal", ["can't", "private"]);
    const gate = evaluateGate({
      entries: [{ id: score.id, overall: score.overall }],
      threshold: DEFAULT_EVAL_GATE_THRESHOLD,
    });
    expect(gate.passed).toBe(true);
  });
});
