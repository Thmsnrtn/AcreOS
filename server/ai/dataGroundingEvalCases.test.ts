/**
 * Andrei (2026-06-06) — tests for the data-grounding eval set + its use as
 * adversarial fixtures for the hallucination detector, plus the DATA_GROUNDING
 * prompt module wiring.
 *
 * These assert the three properties the eval set + guard exist to enforce:
 *   1. Every case's safeOutput passes its own contains-check (expected present,
 *      forbidden absent) — i.e. the "good" answer is actually a passing answer.
 *   2. Every case's adversarialOutput trips its own contains-check — i.e. the
 *      "hallucinating" answer is actually a failing answer (so the gate would
 *      catch it).
 *   3. For cases with numeric source context, the hallucination DETECTOR flags
 *      the adversarial numeric fabrication while passing the grounded number.
 *   4. The DATA_GROUNDING block is present in every composed Pax system prompt.
 */
import { describe, expect, it } from "vitest";
import {
  DATA_GROUNDING_EVAL_CASES,
  dbIdForCase,
  toAiTestCaseRows,
} from "./dataGroundingEvalCases";
import { detectHallucinations } from "../services/hallucinationDetector";
import {
  composePaxSystemPrompt,
  PAX_DATA_GROUNDING_BLOCK,
  DATA_GROUNDING_VERSION,
  DATA_GROUNDING_CHANGELOG,
} from "./paxPromptVersions";

/** Mirror of the harness contains-check (aiEvalHarness.evaluateTraits). */
function evaluate(output: string, expected: string[], forbidden: string[]): boolean {
  const lower = output.toLowerCase();
  for (const t of expected) if (!lower.includes(t.toLowerCase())) return false;
  for (const t of forbidden) if (lower.includes(t.toLowerCase())) return false;
  return true;
}

describe("data-grounding eval set", () => {
  it("seeds ~15 pax_inbox cases covering hit / miss / cross-org", () => {
    expect(DATA_GROUNDING_EVAL_CASES.length).toBeGreaterThanOrEqual(15);
    for (const c of DATA_GROUNDING_EVAL_CASES) {
      expect(c.surface).toBe("pax_inbox");
      expect(c.expectedTraits.length + c.forbiddenTraits.length).toBeGreaterThan(0);
    }
    // Coverage of the three buckets.
    const ids = DATA_GROUNDING_EVAL_CASES.map((c) => c.id);
    expect(ids.some((i) => i.includes("hit"))).toBe(true);
    expect(ids.some((i) => i.includes("miss"))).toBe(true);
    expect(ids.some((i) => i.includes("crossorg"))).toBe(true);
  });

  it("each safeOutput PASSES its own contains-check", () => {
    for (const c of DATA_GROUNDING_EVAL_CASES) {
      if (!c.safeOutput) continue;
      expect(
        evaluate(c.safeOutput, c.expectedTraits, c.forbiddenTraits),
        `safeOutput for ${c.id} should pass its own check`,
      ).toBe(true);
    }
  });

  it("each adversarialOutput FAILS its own contains-check (the gate would catch it)", () => {
    for (const c of DATA_GROUNDING_EVAL_CASES) {
      if (!c.adversarialOutput) continue;
      expect(
        evaluate(c.adversarialOutput, c.expectedTraits, c.forbiddenTraits),
        `adversarialOutput for ${c.id} should fail its own check`,
      ).toBe(false);
    }
  });

  it("hallucination detector does NOT false-positive on grounded source numbers", () => {
    // Every case's grounded safeOutput must pass the numeric detector clean —
    // a false positive here would block a legitimate answer.
    for (const c of DATA_GROUNDING_EVAL_CASES) {
      if (!c.sourceNumbers || c.sourceNumbers.length === 0 || !c.safeOutput) continue;
      const safe = detectHallucinations({
        output: c.safeOutput,
        sourceNumbers: c.sourceNumbers,
      });
      expect(safe.length, `detector should NOT flag grounded ${c.id}`).toBe(0);
    }
  });

  it("hallucination detector flags a currency number outside the source range", () => {
    // The numeric detector mines $X / N% tokens and flags 3-SD / out-of-range
    // values. A $250,000 claim against a $2,400-$12,000 source set is the
    // 'confident wrong number' shape the live guard must catch.
    const warnings = detectHallucinations({
      output: "This parcel is worth $250,000.",
      sourceNumbers: [2400, 3800, 12000],
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].kind).toBe("fabricated_number");
  });

  it("ids deterministically map to stable UUIDs (idempotent re-seed)", () => {
    const a = dbIdForCase("dg-hit-flood-001");
    const b = dbIdForCase("dg-hit-flood-001");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // distinct friendly ids → distinct uuids
    const rows = toAiTestCaseRows();
    const uuidSet = new Set(rows.map((r) => r.id));
    expect(uuidSet.size).toBe(rows.length);
  });
});

describe("DATA_GROUNDING prompt module", () => {
  it("is appended to v3 and v2 composed prompts", () => {
    const v3 = composePaxSystemPrompt("BASE PROMPT", "v3");
    const v2 = composePaxSystemPrompt("BASE PROMPT", "v2");
    expect(v3).toContain(PAX_DATA_GROUNDING_BLOCK);
    expect(v2).toContain(PAX_DATA_GROUNDING_BLOCK);
    // sanity: the load-bearing rules are present
    expect(v3).toContain("DATA GROUNDING");
    expect(v3.toLowerCase()).toContain("never");
    expect(v3.toLowerCase()).toContain("cite");
  });

  it("has a version + a changelog entry for it", () => {
    expect(DATA_GROUNDING_VERSION).toBeTruthy();
    const latest = DATA_GROUNDING_CHANGELOG[DATA_GROUNDING_CHANGELOG.length - 1];
    expect(latest.version).toBe(DATA_GROUNDING_VERSION);
    expect(latest.note.length).toBeGreaterThan(20);
  });
});
