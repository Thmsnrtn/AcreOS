/**
 * FW-THEO-1 + FW-INDIRA-1 (push-forward 2026-05-08): AI eval harness v0.
 *
 * The harness reads test cases from `ai_test_cases`, runs each one
 * against a target model, and records pass/fail in `ai_test_runs`.
 * Pass criteria are content-based (not exact-match): every
 * expected-trait substring must appear in the output, AND no
 * forbidden-trait may appear.
 *
 * This is v0 — string-substring contains-checking. Future iterations
 * will add LLM-judge eval (a separate model evaluates whether the
 * output expresses each trait), but contains-check catches the
 * obvious regressions: "Pax mentioning a competitor we banned",
 * "compliance-AI omitting a required disclosure citation",
 * "executive surface leaking a codename like Forge".
 *
 * The harness is callable via:
 *   POST /api/founder/eval/run?surface=pax_inbox&modelKey=claude-opus-4-7
 *
 * It runs all active test cases for the surface against the named
 * model. `aiRouter` calls into this harness before promoting a new
 * model to default.
 */

import { db } from "../db";
import { aiTestCases, aiTestRuns } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Panel-300 G1 — eval-as-gate. Throws when a generated output fails
 * a critical-severity test case. Caller (route layer) catches and
 * returns 422 + actionable banner. Combined with the existing
 * complianceAI post-validator (FW-INDIRA-2), this is the reject-
 * on-fail surface the panel-300 synthesis prescribed.
 */
export class EvalGateRejectedError extends Error {
  readonly code = "EVAL_GATE_REJECTED" as const;
  constructor(
    public readonly surface: string,
    public readonly modelKey: string,
    public readonly failures: Array<{ testCaseId: string; name: string; reason: string }>,
  ) {
    super(
      `Eval gate rejected output on ${surface} (${modelKey}): ${failures.length} critical failures`,
    );
    this.name = "EvalGateRejectedError";
  }
}

/**
 * Synchronous gate variant — evaluate a single output against the
 * surface's CRITICAL-severity test cases and throw if any fail.
 * Intended to wrap a single AI generation, not a model-rollout
 * batch. The full runEvalSurface() above exists for batch eval.
 */
export async function gateOutputOrThrow(opts: {
  surface: string;
  modelKey: string;
  output: string;
}): Promise<void> {
  const cases = await db
    .select()
    .from(aiTestCases)
    .where(and(
      eq(aiTestCases.surface, opts.surface),
      eq(aiTestCases.isActive, true),
      eq(aiTestCases.severity, "critical"),
    ))
    .limit(50);
  if (cases.length === 0) return; // no gate cases seeded → no gate

  const lower = opts.output.toLowerCase();
  const failures: Array<{ testCaseId: string; name: string; reason: string }> = [];
  for (const tc of cases) {
    const expected = (tc.expectedTraits as string[] | null) ?? [];
    const forbidden = (tc.forbiddenTraits as string[] | null) ?? [];
    let reason: string | null = null;
    for (const trait of expected) {
      if (!lower.includes(trait.toLowerCase())) {
        reason = `Missing expected trait: "${trait}"`;
        break;
      }
    }
    if (!reason) {
      for (const trait of forbidden) {
        if (lower.includes(trait.toLowerCase())) {
          reason = `Contained forbidden trait: "${trait}"`;
          break;
        }
      }
    }
    if (reason) {
      failures.push({ testCaseId: tc.id, name: tc.name, reason });
    }
    // Persist the run regardless of pass/fail so the trend is visible.
    try {
      await db.insert(aiTestRuns).values({
        testCaseId: tc.id,
        modelKey: opts.modelKey,
        passed: !reason,
        output: opts.output.slice(0, 5000),
        failureReason: reason,
      });
    } catch {/* non-fatal */}
  }
  if (failures.length > 0) {
    throw new EvalGateRejectedError(opts.surface, opts.modelKey, failures);
  }
}

export interface EvalRunResult {
  surface: string;
  modelKey: string;
  totalCases: number;
  passed: number;
  failed: number;
  failures: Array<{ testCaseId: string; name: string; reason: string }>;
}

/**
 * Caller-supplied generator function — abstracts over which LLM we're
 * targeting. Returning {output, latencyMs, inputTokens, outputTokens,
 * costCents} lets the harness record telemetry alongside pass/fail.
 */
export type ModelGenerator = (prompt: string) => Promise<{
  output: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
}>;

function evaluateTraits(output: string, expected: string[], forbidden: string[]): {
  passed: boolean;
  reason: string | null;
} {
  const lower = output.toLowerCase();
  for (const trait of expected) {
    if (!lower.includes(trait.toLowerCase())) {
      return { passed: false, reason: `Missing expected trait: "${trait}"` };
    }
  }
  for (const trait of forbidden) {
    if (lower.includes(trait.toLowerCase())) {
      return { passed: false, reason: `Contained forbidden trait: "${trait}"` };
    }
  }
  return { passed: true, reason: null };
}

export async function runEvalSurface(opts: {
  surface: string;
  modelKey: string;
  generator: ModelGenerator;
}): Promise<EvalRunResult> {
  const cases = await db
    .select()
    .from(aiTestCases)
    .where(and(eq(aiTestCases.surface, opts.surface), eq(aiTestCases.isActive, true)))
    .limit(500);

  const failures: Array<{ testCaseId: string; name: string; reason: string }> = [];
  let passed = 0;
  let failed = 0;

  for (const tc of cases) {
    let result: Awaited<ReturnType<ModelGenerator>>;
    try {
      result = await opts.generator(tc.inputPrompt);
    } catch (err) {
      logger.warn(
        `[aiEvalHarness] generator threw on test case ${tc.id}`,
        err instanceof Error ? err : undefined,
      );
      const reason = err instanceof Error ? err.message : "generator threw";
      failures.push({ testCaseId: tc.id, name: tc.name, reason });
      failed++;
      try {
        await db.insert(aiTestRuns).values({
          testCaseId: tc.id,
          modelKey: opts.modelKey,
          passed: false,
          output: null,
          failureReason: reason,
        });
      } catch {/* non-fatal */}
      continue;
    }
    const expected = (tc.expectedTraits as string[] | null) ?? [];
    const forbidden = (tc.forbiddenTraits as string[] | null) ?? [];
    const evaluation = evaluateTraits(result.output, expected, forbidden);
    if (evaluation.passed) {
      passed++;
    } else {
      failed++;
      failures.push({
        testCaseId: tc.id,
        name: tc.name,
        reason: evaluation.reason ?? "unknown",
      });
    }
    try {
      await db.insert(aiTestRuns).values({
        testCaseId: tc.id,
        modelKey: opts.modelKey,
        passed: evaluation.passed,
        output: result.output.slice(0, 5000),
        failureReason: evaluation.reason,
        latencyMs: result.latencyMs ?? null,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        costCents: result.costCents != null ? String(result.costCents) : null,
      });
    } catch (err) {
      logger.warn(
        `[aiEvalHarness] write run failed for case ${tc.id}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  return {
    surface: opts.surface,
    modelKey: opts.modelKey,
    totalCases: cases.length,
    passed,
    failed,
    failures,
  };
}
