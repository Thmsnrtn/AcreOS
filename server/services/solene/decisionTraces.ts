/**
 * SOLENE — fine-grain decision rationale traces (Layer 3 capability L3.16).
 *
 * Builds on the L1.4 agent identity ledger. Where L1.4 captures a *summary* +
 * rationale for a load-bearing decision, L3.16 captures the full step-by-step
 * reasoning that produced it: observations, hypotheses, evidence weighed,
 * alternatives, the final choice, and uncertainty markers. Together they form
 * a complete audit trail of how an agent reached a decision — useful for
 * founder inspection, post-hoc analysis, and future fine-tuning.
 *
 * Five entrypoints:
 *
 *   addTraceStep(input)
 *     Append a single reasoning step. Fire-and-forget; never throws.
 *     step_number computed server-side as MAX+1 (or 1 if first).
 *
 *   addTraceSteps(decisionId, steps[])
 *     Bulk-insert multiple steps in one transaction, preserving order.
 *     Useful for agents that record their full reasoning sequence at the
 *     end of a task instead of streaming step-by-step.
 *
 *   loadTrace(decisionId)
 *     Load every step for a decision in step_number order. Empty array if
 *     no steps recorded (not null).
 *
 *   renderTraceAsMarkdown(decisionId)
 *     Render the trace as a founder-readable markdown document — header per
 *     step, with optional evidence / alternatives / chosen-path sections.
 *
 *   getTraceSummary(decisionId)
 *     Aggregate stats — step count, breakdown by kind, average confidence,
 *     whether any uncertainty markers were recorded.
 *
 * ----------------------------------------------------------------------------
 * INTENDED TOOL EXPOSURE (Solene wires in a follow-up commit)
 * ----------------------------------------------------------------------------
 * A future `record_decision_trace` tool will be added to dispatchToolExecutor
 * so agents can stream fine-grain reasoning mid-dispatch:
 *
 *   Tool name: record_decision_trace
 *   Tool description: Append a fine-grained reasoning step to your current
 *     decision's audit trail. Use throughout your work —
 *     observation→hypothesis→evidence→alternative→choice cycles.
 *
 *   Input schema:
 *     decision_id: number
 *     step_kind: enum(observation, hypothesis, evidence, alternative,
 *                     choice, uncertainty)
 *     step_text: string (≤2000 chars)
 *     evidence_refs: string[] (file paths, URLs, prior decision IDs)
 *     alternatives_considered: string[] (other options on the table)
 *     chosen_path_reason: string (when step_kind=choice)
 *     confidence_at_step: number (0-1)
 *
 *   Output: { trace_id, step_number }
 *
 * The executor wrapper calls addTraceStep() with decision_id resolved from
 * the runner's active-decision context. dispatchToolExecutor.ts is frozen
 * for this wave; the wiring lands in a follow-up Solene commit.
 * ----------------------------------------------------------------------------
 */

import { asc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDecisionTraces,
  DECISION_TRACE_STEP_KINDS,
  DECISION_TRACE_STEP_TEXT_MAX_CHARS,
  DECISION_TRACE_TRUNCATION_SUFFIX,
  type DecisionTraceStepKind,
  type SoleneDecisionTrace,
} from "@shared/schema/solene-decision-traces";
import { soleneAgentIdentityDecisions } from "@shared/schema/solene-agent-identity";
import { logger } from "../../utils/logger";

// ============================================================================
// Types
// ============================================================================

export interface AddTraceStepInput {
  decisionId: number;
  stepKind: DecisionTraceStepKind;
  stepText: string;
  evidenceRefs?: string[];
  alternativesConsidered?: string[];
  chosenPathReason?: string;
  confidenceAtStep?: number;
}

export type DecisionTraceRow = SoleneDecisionTrace;

export interface AddTraceStepResult {
  traceId: number;
  stepNumber: number;
}

export interface AddTraceStepsResult {
  stepsAdded: number;
  firstStepNumber: number;
  lastStepNumber: number;
}

export interface TraceSummary {
  stepCount: number;
  kindBreakdown: Record<DecisionTraceStepKind, number>;
  averageConfidence: number | null;
  hasUncertaintyMarkers: boolean;
}

// Sentinel returned when a precondition fails (e.g. decision does not exist).
const INVALID_TRACE_ID = -1;

// ============================================================================
// addTraceStep — append a single reasoning step.
// ============================================================================

export async function addTraceStep(
  input: AddTraceStepInput,
): Promise<AddTraceStepResult> {
  try {
    // ── Validate decisionId existence ─────────────────────────────────────
    const decisionExists = await checkDecisionExists(input.decisionId);
    if (!decisionExists) {
      logger.warn(
        `[decisionTraces] addTraceStep: decisionId=${input.decisionId} does not exist; skipping`,
      );
      return { traceId: INVALID_TRACE_ID, stepNumber: 0 };
    }

    // ── Validate step kind ─────────────────────────────────────────────────
    const stepKind = isKnownStepKind(input.stepKind)
      ? input.stepKind
      : null;
    if (!stepKind) {
      logger.warn(
        `[decisionTraces] addTraceStep: unknown stepKind=${input.stepKind}; skipping`,
      );
      return { traceId: INVALID_TRACE_ID, stepNumber: 0 };
    }

    // ── Validate + truncate step text ─────────────────────────────────────
    const rawText = typeof input.stepText === "string" ? input.stepText : "";
    if (rawText.length === 0) {
      logger.warn(
        `[decisionTraces] addTraceStep: empty stepText for decisionId=${input.decisionId}; skipping`,
      );
      return { traceId: INVALID_TRACE_ID, stepNumber: 0 };
    }
    const stepText = truncateWithSuffix(
      rawText,
      DECISION_TRACE_STEP_TEXT_MAX_CHARS,
    );

    // ── Clamp confidence ──────────────────────────────────────────────────
    const confidence = clampConfidence(input.confidenceAtStep);

    // ── Validate chosen_path_reason ───────────────────────────────────────
    if (
      input.chosenPathReason &&
      input.chosenPathReason.length > 0 &&
      stepKind !== "choice"
    ) {
      logger.warn(
        `[decisionTraces] addTraceStep: chosenPathReason set on stepKind=${stepKind} (only valid for 'choice'); allowing anyway`,
      );
    }

    // ── Compute next step_number ──────────────────────────────────────────
    const nextStepNumber = await nextStepNumberFor(input.decisionId);

    // ── Insert ────────────────────────────────────────────────────────────
    const [inserted] = await db
      .insert(soleneDecisionTraces)
      .values({
        decisionId: input.decisionId,
        stepNumber: nextStepNumber,
        stepKind,
        stepText,
        evidenceRefs: input.evidenceRefs ?? null,
        alternativesConsidered: input.alternativesConsidered ?? null,
        chosenPathReason: input.chosenPathReason ?? null,
        confidenceAtStep: confidence !== null ? String(confidence) : null,
      })
      .returning({ id: soleneDecisionTraces.id });

    if (!inserted) {
      logger.warn(
        `[decisionTraces] addTraceStep: insert returned no id for decisionId=${input.decisionId}`,
      );
      return { traceId: INVALID_TRACE_ID, stepNumber: 0 };
    }

    return { traceId: inserted.id, stepNumber: nextStepNumber };
  } catch (err) {
    logger.warn(
      "[decisionTraces] addTraceStep swallow",
      err instanceof Error ? err : undefined,
    );
    return { traceId: INVALID_TRACE_ID, stepNumber: 0 };
  }
}

// ============================================================================
// addTraceSteps — bulk insert multiple steps in order.
// ============================================================================

export async function addTraceSteps(
  decisionId: number,
  steps: Omit<AddTraceStepInput, "decisionId">[],
): Promise<AddTraceStepsResult> {
  const empty: AddTraceStepsResult = {
    stepsAdded: 0,
    firstStepNumber: 0,
    lastStepNumber: 0,
  };
  try {
    if (!Array.isArray(steps) || steps.length === 0) {
      return empty;
    }
    const decisionExists = await checkDecisionExists(decisionId);
    if (!decisionExists) {
      logger.warn(
        `[decisionTraces] addTraceSteps: decisionId=${decisionId} does not exist; skipping ${steps.length} steps`,
      );
      return empty;
    }

    const startStep = await nextStepNumberFor(decisionId);
    const rows = [];
    let offset = 0;
    for (const step of steps) {
      const stepKind = isKnownStepKind(step.stepKind) ? step.stepKind : null;
      if (!stepKind) {
        logger.warn(
          `[decisionTraces] addTraceSteps: unknown stepKind=${step.stepKind}; skipping this entry`,
        );
        continue;
      }
      const rawText = typeof step.stepText === "string" ? step.stepText : "";
      if (rawText.length === 0) {
        logger.warn(
          `[decisionTraces] addTraceSteps: empty stepText at offset ${offset}; skipping`,
        );
        continue;
      }
      const stepText = truncateWithSuffix(
        rawText,
        DECISION_TRACE_STEP_TEXT_MAX_CHARS,
      );
      const confidence = clampConfidence(step.confidenceAtStep);
      rows.push({
        decisionId,
        stepNumber: startStep + offset,
        stepKind,
        stepText,
        evidenceRefs: step.evidenceRefs ?? null,
        alternativesConsidered: step.alternativesConsidered ?? null,
        chosenPathReason: step.chosenPathReason ?? null,
        confidenceAtStep: confidence !== null ? String(confidence) : null,
      });
      offset += 1;
    }

    if (rows.length === 0) {
      return empty;
    }

    await db.insert(soleneDecisionTraces).values(rows);

    return {
      stepsAdded: rows.length,
      firstStepNumber: rows[0].stepNumber,
      lastStepNumber: rows[rows.length - 1].stepNumber,
    };
  } catch (err) {
    logger.warn(
      "[decisionTraces] addTraceSteps swallow",
      err instanceof Error ? err : undefined,
    );
    return empty;
  }
}

// ============================================================================
// loadTrace — every step for a decision, in step_number order.
// ============================================================================

export async function loadTrace(
  decisionId: number,
): Promise<DecisionTraceRow[]> {
  try {
    const rows = await db
      .select()
      .from(soleneDecisionTraces)
      .where(eq(soleneDecisionTraces.decisionId, decisionId))
      .orderBy(asc(soleneDecisionTraces.stepNumber));
    return rows;
  } catch (err) {
    logger.warn(
      `[decisionTraces] loadTrace query failed for decisionId=${decisionId}`,
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

// ============================================================================
// renderTraceAsMarkdown — founder-readable markdown render.
// ============================================================================

export async function renderTraceAsMarkdown(
  decisionId: number,
): Promise<string> {
  const rows = await loadTrace(decisionId);
  const header = `# Decision trace — #${decisionId}`;
  if (rows.length === 0) {
    return `${header}\n\n_No trace recorded._`;
  }

  const sections: string[] = [header, ""];
  for (const row of rows) {
    const confidence = parseConfidenceFromRow(row.confidenceAtStep);
    const confidencePart =
      confidence !== null
        ? ` (confidence: ${formatConfidence(confidence)})`
        : "";
    sections.push(
      `## Step ${row.stepNumber}: ${row.stepKind}${confidencePart}`,
    );
    sections.push(row.stepText);

    const evidence = (row.evidenceRefs ?? []).filter(
      (r) => typeof r === "string" && r.length > 0,
    );
    if (evidence.length > 0) {
      sections.push("");
      sections.push("**Evidence:**");
      for (const ref of evidence) {
        sections.push(`- ${ref}`);
      }
    }

    const alternatives = (row.alternativesConsidered ?? []).filter(
      (a) => typeof a === "string" && a.length > 0,
    );
    if (alternatives.length > 0) {
      sections.push("");
      sections.push("**Alternatives on the table:**");
      for (const alt of alternatives) {
        sections.push(`- ${alt}`);
      }
    }

    if (
      row.stepKind === "choice" &&
      typeof row.chosenPathReason === "string" &&
      row.chosenPathReason.length > 0
    ) {
      sections.push("");
      sections.push(`**Chosen because:** ${row.chosenPathReason}`);
    }
    sections.push("");
  }

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

// ============================================================================
// getTraceSummary — aggregate stats for the founder inspector.
// ============================================================================

export async function getTraceSummary(
  decisionId: number,
): Promise<TraceSummary> {
  const empty: TraceSummary = {
    stepCount: 0,
    kindBreakdown: emptyKindBreakdown(),
    averageConfidence: null,
    hasUncertaintyMarkers: false,
  };
  const rows = await loadTrace(decisionId);
  if (rows.length === 0) return empty;

  const breakdown = emptyKindBreakdown();
  let confidenceSum = 0;
  let confidenceCount = 0;
  let hasUncertainty = false;

  for (const row of rows) {
    if (isKnownStepKind(row.stepKind)) {
      breakdown[row.stepKind] += 1;
    }
    if (row.stepKind === "uncertainty") {
      hasUncertainty = true;
    }
    const c = parseConfidenceFromRow(row.confidenceAtStep);
    if (c !== null) {
      confidenceSum += c;
      confidenceCount += 1;
    }
  }

  return {
    stepCount: rows.length,
    kindBreakdown: breakdown,
    averageConfidence:
      confidenceCount > 0 ? confidenceSum / confidenceCount : null,
    hasUncertaintyMarkers: hasUncertainty,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

function isKnownStepKind(kind: string): kind is DecisionTraceStepKind {
  return (DECISION_TRACE_STEP_KINDS as readonly string[]).includes(kind);
}

function truncateWithSuffix(s: string, max: number): string {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  const room = Math.max(0, max - DECISION_TRACE_TRUNCATION_SUFFIX.length);
  return s.slice(0, room) + DECISION_TRACE_TRUNCATION_SUFFIX;
}

function clampConfidence(c: number | undefined): number | null {
  if (c === undefined || c === null) return null;
  if (typeof c !== "number" || Number.isNaN(c)) {
    logger.warn(
      `[decisionTraces] non-numeric confidenceAtStep=${String(c)}; dropping`,
    );
    return null;
  }
  if (c < 0 || c > 1) {
    const clamped = Math.max(0, Math.min(1, c));
    logger.warn(
      `[decisionTraces] confidenceAtStep=${c} out of [0,1]; clamping to ${clamped}`,
    );
    return clamped;
  }
  return c;
}

function parseConfidenceFromRow(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function formatConfidence(c: number): string {
  // Two-decimal display; matches the example in the spec doc.
  return c.toFixed(2);
}

function emptyKindBreakdown(): Record<DecisionTraceStepKind, number> {
  const out = {} as Record<DecisionTraceStepKind, number>;
  for (const k of DECISION_TRACE_STEP_KINDS) {
    out[k] = 0;
  }
  return out;
}

async function checkDecisionExists(decisionId: number): Promise<boolean> {
  if (
    typeof decisionId !== "number" ||
    !Number.isFinite(decisionId) ||
    decisionId <= 0
  ) {
    return false;
  }
  try {
    const rows = await db
      .select({ id: soleneAgentIdentityDecisions.id })
      .from(soleneAgentIdentityDecisions)
      .where(eq(soleneAgentIdentityDecisions.id, decisionId))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn(
      `[decisionTraces] checkDecisionExists query failed for decisionId=${decisionId}`,
      err instanceof Error ? err : undefined,
    );
    return false;
  }
}

async function nextStepNumberFor(decisionId: number): Promise<number> {
  try {
    const rows = await db
      .select({
        maxStep: sql<number | null>`MAX(${soleneDecisionTraces.stepNumber})`,
      })
      .from(soleneDecisionTraces)
      .where(eq(soleneDecisionTraces.decisionId, decisionId));
    const max = rows[0]?.maxStep ?? null;
    const maxNum = typeof max === "number" ? max : Number(max);
    if (!Number.isFinite(maxNum) || maxNum <= 0) return 1;
    return maxNum + 1;
  } catch (err) {
    logger.warn(
      `[decisionTraces] nextStepNumberFor query failed for decisionId=${decisionId}`,
      err instanceof Error ? err : undefined,
    );
    return 1;
  }
}
