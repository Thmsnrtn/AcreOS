/**
 * evals/gate.ts — Tahoe E7 (2026-06-06).
 *
 * Pure, dependency-free threshold logic for the prompt-change eval gate.
 * Kept separate from evals/run-eval.ts (which does I/O + model calls) and from
 * evals/judge.ts (which reaches the network) so the gate decision is unit-
 * testable with a mocked judge and zero side effects.
 *
 * Relationship to server/services/aiEvalHarness.ts:
 *   - aiEvalHarness.ts owns the RUNTIME gate: gateOutputOrThrow() wraps a single
 *     live AI generation against CRITICAL test cases in the DB and throws
 *     EvalGateRejectedError to the route layer (→ 422). It imports server/db,
 *     so it cannot be pulled into a DB-less CI script.
 *   - This file owns the CI / prompt-change gate: it scores a curated golden
 *     set with the LLM judge and throws a structurally-compatible
 *     EvalGateRejectedError (same `code` discriminant) when the aggregate score
 *     drops below an ABSOLUTE threshold. Both surface the same error contract.
 */

/** Absolute pass bar for the curated set, overridable via EVAL_GATE_THRESHOLD. */
export const DEFAULT_EVAL_GATE_THRESHOLD = 0.65;

export interface GateFailure {
  id: string;
  reason: string;
}

/**
 * Thrown when the eval gate rejects a prompt change. Mirrors the `code`
 * discriminant of server/services/aiEvalHarness.ts:EvalGateRejectedError so
 * both the runtime gate and the CI gate present the same error contract — but
 * defined here with zero dependencies so it can run in a CI script that has no
 * DB pool.
 */
export class EvalGateRejectedError extends Error {
  readonly code = "EVAL_GATE_REJECTED" as const;
  constructor(
    public readonly avgOverall: number,
    public readonly threshold: number,
    public readonly failures: GateFailure[],
  ) {
    super(
      `Eval gate rejected prompt change: avgOverall=${avgOverall.toFixed(3)} < threshold=${threshold.toFixed(3)} ` +
        `(${failures.length} case(s) under bar)`,
    );
    this.name = "EvalGateRejectedError";
  }
}

export interface EntryLike {
  id: string;
  overall: number;
}

export interface GateInput {
  entries: EntryLike[];
  threshold?: number;
  /** Per-entry floor; entries below this are listed as the cause. Default = threshold. */
  perEntryFloor?: number;
}

export interface GateResult {
  passed: boolean;
  avgOverall: number;
  threshold: number;
  caseCount: number;
  failures: GateFailure[];
}

/** Round to 4 dp to keep stored / logged numbers stable. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Pure gate decision. Computes the aggregate score over the curated entries and
 * compares it to the absolute threshold. Also collects the entries that fell
 * below the per-entry floor as the human-readable cause list. Does NOT throw —
 * callers decide whether to throw EvalGateRejectedError (so tests can assert on
 * the result object directly).
 */
export function evaluateGate(input: GateInput): GateResult {
  const threshold = input.threshold ?? DEFAULT_EVAL_GATE_THRESHOLD;
  const floor = input.perEntryFloor ?? threshold;
  const entries = input.entries;
  const caseCount = entries.length;
  const avgOverall =
    caseCount === 0 ? 0 : round4(entries.reduce((a, e) => a + e.overall, 0) / caseCount);

  const failures: GateFailure[] = entries
    .filter((e) => e.overall < floor)
    .map((e) => ({
      id: e.id,
      reason: `overall ${e.overall.toFixed(3)} < per-case floor ${floor.toFixed(3)}`,
    }));

  // An empty curated set must FAIL — a gate with nothing to check is not a gate.
  const passed = caseCount > 0 && avgOverall >= threshold;

  return { passed, avgOverall, threshold, caseCount, failures };
}

/** Convenience: run the gate and throw EvalGateRejectedError on failure. */
export function assertGateOrThrow(input: GateInput): GateResult {
  const result = evaluateGate(input);
  if (!result.passed) {
    throw new EvalGateRejectedError(result.avgOverall, result.threshold, result.failures);
  }
  return result;
}
