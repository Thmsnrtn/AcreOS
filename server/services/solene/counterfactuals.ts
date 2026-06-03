/**
 * SOLENE — counterfactual reasoning on past decisions (Phase B L4.21).
 *
 * For decisions in `solene_agent_identity_decisions`, agents can record one or
 * more counterfactual analyses — "what would have happened if we'd chosen the
 * OTHER option?". Each row attaches an alternative path, rationale for why it
 * was plausible, predicted outcome, comparison to what actually happened, and
 * (optionally) a lesson learned.
 *
 * Five entrypoints:
 *
 *   recordCounterfactual(input)
 *     Persist a single alternative-path analysis tied to a source decision.
 *     Confidence clamped to [0,1] with warn on out-of-range. Returns
 *     { counterfactualId } where counterfactualId = -1 if insert was skipped.
 *
 *   listCounterfactualsForDecision(sourceDecisionId)
 *     Return all counterfactual rows for a given decision, in analyzed_at
 *     ascending order. Empty array (not null) if none.
 *
 *   getCounterfactual(id)
 *     Look up a single row by primary key. Returns null if not found.
 *
 *   buildCounterfactualPrompt(opts)
 *     Pure helper. Produces the analysis prompt for an agent dispatched
 *     specifically to do counterfactual analysis on a past decision. The
 *     prompt asks the agent to (1) read the decision, (2) identify 1-3
 *     plausible alternative paths, (3) predict outcome for each, (4) compare
 *     to actual, (5) extract a lesson — and ends with structured output
 *     blocks ready for recordCounterfactual calls.
 *
 *   summarizeLessons(rows)
 *     Pure helper. Produces a founder-readable markdown bullet list of
 *     lessons grouped by decision id, with an aggregate confidence header.
 *     Rows with a null lesson_learned are omitted from the bullet list but
 *     still count toward "Alternative paths examined".
 *
 *   aggregateConfidence(rows)
 *     Pure helper. Simple mean of non-null row confidences. Returns 0 when
 *     the input is empty or every row's confidence is null.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneCounterfactualAnalyses,
  type CounterfactualAnalysisRow,
} from "@shared/schema/solene-counterfactuals";
import {
  DISPATCH_AGENT_ROLES,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================================================
// Types
// ============================================================================

export interface RecordCounterfactualInput {
  sourceDecisionId: number;
  analyzingAgentRole: SoleneDispatchAgentRole;
  alternativePath: string;
  alternativeRationale: string;
  predictedOutcome: string;
  comparisonToActual: string;
  lessonLearned?: string;
  confidence: number; // 0-1
}

export interface RecordCounterfactualResult {
  counterfactualId: number;
}

export type CounterfactualRow = CounterfactualAnalysisRow;

export interface BuildCounterfactualPromptOptions {
  sourceDecisionId: number;
  decisionSummary: string;
  decisionRationale: string;
  decisionKind: string;
  decisionReferencedFiles: string[];
  actualOutcomeNotes?: string;
}

// Sentinel returned when a precondition fails or the insert is skipped.
const INVALID_COUNTERFACTUAL_ID = -1;

// ============================================================================
// recordCounterfactual
// ============================================================================

export async function recordCounterfactual(
  input: RecordCounterfactualInput,
): Promise<RecordCounterfactualResult> {
  try {
    // ── Validate sourceDecisionId ─────────────────────────────────────────
    if (
      typeof input.sourceDecisionId !== "number" ||
      !Number.isFinite(input.sourceDecisionId) ||
      input.sourceDecisionId <= 0
    ) {
      logger.warn(
        `[counterfactuals] recordCounterfactual: invalid sourceDecisionId=${String(
          input.sourceDecisionId,
        )}; skipping`,
      );
      return { counterfactualId: INVALID_COUNTERFACTUAL_ID };
    }

    // ── Validate agent role ───────────────────────────────────────────────
    if (
      !input.analyzingAgentRole ||
      !isKnownAgentRole(input.analyzingAgentRole)
    ) {
      logger.warn(
        `[counterfactuals] recordCounterfactual: invalid analyzingAgentRole=${String(
          input.analyzingAgentRole,
        )}; skipping`,
      );
      return { counterfactualId: INVALID_COUNTERFACTUAL_ID };
    }

    // ── Validate text fields (non-empty) ──────────────────────────────────
    const textFields: Array<[string, string | undefined]> = [
      ["alternativePath", input.alternativePath],
      ["alternativeRationale", input.alternativeRationale],
      ["predictedOutcome", input.predictedOutcome],
      ["comparisonToActual", input.comparisonToActual],
    ];
    for (const [name, value] of textFields) {
      if (typeof value !== "string" || value.trim().length === 0) {
        logger.warn(
          `[counterfactuals] recordCounterfactual: empty ${name}; skipping`,
        );
        return { counterfactualId: INVALID_COUNTERFACTUAL_ID };
      }
    }

    // ── Clamp confidence ──────────────────────────────────────────────────
    const confidence = clampConfidence(input.confidence);

    // ── Normalize optional lesson ─────────────────────────────────────────
    const lesson =
      typeof input.lessonLearned === "string" &&
      input.lessonLearned.trim().length > 0
        ? input.lessonLearned
        : null;

    // ── Insert ────────────────────────────────────────────────────────────
    const [inserted] = await db
      .insert(soleneCounterfactualAnalyses)
      .values({
        sourceDecisionId: input.sourceDecisionId,
        analyzingAgentRole: input.analyzingAgentRole,
        alternativePath: input.alternativePath,
        alternativeRationale: input.alternativeRationale,
        predictedOutcome: input.predictedOutcome,
        comparisonToActual: input.comparisonToActual,
        lessonLearned: lesson,
        confidence: confidence !== null ? String(confidence) : null,
      })
      .returning({ id: soleneCounterfactualAnalyses.id });

    if (!inserted) {
      logger.warn(
        `[counterfactuals] recordCounterfactual: insert returned no id for sourceDecisionId=${input.sourceDecisionId}`,
      );
      return { counterfactualId: INVALID_COUNTERFACTUAL_ID };
    }

    return { counterfactualId: inserted.id };
  } catch (err) {
    logger.warn(
      "[counterfactuals] recordCounterfactual swallow",
      err instanceof Error ? err : undefined,
    );
    return { counterfactualId: INVALID_COUNTERFACTUAL_ID };
  }
}

// ============================================================================
// listCounterfactualsForDecision
// ============================================================================

export async function listCounterfactualsForDecision(
  sourceDecisionId: number,
): Promise<CounterfactualRow[]> {
  try {
    const rows = await db
      .select()
      .from(soleneCounterfactualAnalyses)
      .where(
        eq(soleneCounterfactualAnalyses.sourceDecisionId, sourceDecisionId),
      )
      .orderBy(asc(soleneCounterfactualAnalyses.analyzedAt));
    return rows;
  } catch (err) {
    logger.warn(
      `[counterfactuals] listCounterfactualsForDecision query failed for sourceDecisionId=${sourceDecisionId}`,
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

// ============================================================================
// getCounterfactual
// ============================================================================

export async function getCounterfactual(
  id: number,
): Promise<CounterfactualRow | null> {
  try {
    const rows = await db
      .select()
      .from(soleneCounterfactualAnalyses)
      .where(eq(soleneCounterfactualAnalyses.id, id))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    logger.warn(
      `[counterfactuals] getCounterfactual query failed for id=${id}`,
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

// ============================================================================
// buildCounterfactualPrompt — pure helper
// ============================================================================

export function buildCounterfactualPrompt(
  opts: BuildCounterfactualPromptOptions,
): string {
  const refs = Array.isArray(opts.decisionReferencedFiles)
    ? opts.decisionReferencedFiles.filter(
        (f) => typeof f === "string" && f.length > 0,
      )
    : [];
  const refsBlock =
    refs.length > 0
      ? refs.map((f) => `  - ${f}`).join("\n")
      : "  _(no referenced files recorded)_";

  const actualBlock =
    typeof opts.actualOutcomeNotes === "string" &&
    opts.actualOutcomeNotes.trim().length > 0
      ? opts.actualOutcomeNotes.trim()
      : "_(no actual-outcome notes recorded — your comparison will be speculative)_";

  return [
    `# Counterfactual analysis — decision #${opts.sourceDecisionId}`,
    "",
    "You are dispatched to reason about the road NOT taken on a past decision.",
    "Surfacing what would have happened with a different choice is deeper than",
    "after-the-fact confirmation that what we did happened to work.",
    "",
    "## The original decision",
    "",
    `**Kind:** ${opts.decisionKind}`,
    "",
    "**Summary:**",
    opts.decisionSummary,
    "",
    "**Rationale at the time:**",
    opts.decisionRationale,
    "",
    "**Referenced files:**",
    refsBlock,
    "",
    "## What actually happened",
    "",
    actualBlock,
    "",
    "## Your task",
    "",
    "1. Read the original decision above carefully.",
    "2. Identify 1-3 plausible alternative paths that were on the table",
    "   (or could reasonably have been on the table).",
    "3. For each alternative, predict the outcome it would have produced.",
    "4. Compare each predicted outcome to what actually happened.",
    "5. Extract a lesson learned — or explicitly say",
    `   "no clear lesson — counterfactual is too speculative".`,
    "",
    "## Output format",
    "",
    "Emit one block per alternative analyzed, ready for `recordCounterfactual`:",
    "",
    "```",
    "ALTERNATIVE 1:",
    "  alternativePath: <one-line description of the road not taken>",
    "  alternativeRationale: <why it was plausible at the time>",
    "  predictedOutcome: <what would have happened>",
    "  comparisonToActual: <how it would have differed from what we got>",
    "  lessonLearned: <extracted lesson, or empty>",
    "  confidence: <0..1, in this counterfactual prediction>",
    "```",
    "",
    "Repeat for ALTERNATIVE 2, ALTERNATIVE 3 if appropriate.",
  ].join("\n");
}

// ============================================================================
// summarizeLessons — pure helper
// ============================================================================

export function summarizeLessons(rows: CounterfactualRow[]): string {
  const safeRows = Array.isArray(rows) ? rows : [];
  const total = safeRows.length;
  const avg = aggregateConfidence(safeRows);
  const pct = Math.round(avg * 100);

  const header = [
    `## Counterfactual lessons (${total} ${total === 1 ? "analysis" : "analyses"})`,
    "",
    `**Alternative paths examined:** ${total}`,
    `**Average confidence in counterfactuals:** ${pct}%`,
    "",
  ];

  const withLessons = safeRows
    .filter(
      (r) =>
        typeof r?.lessonLearned === "string" &&
        r.lessonLearned.trim().length > 0,
    )
    .sort((a, b) => {
      const ad = a.sourceDecisionId ?? 0;
      const bd = b.sourceDecisionId ?? 0;
      if (ad !== bd) return ad - bd;
      const at = a.analyzedAt ? new Date(a.analyzedAt).getTime() : 0;
      const bt = b.analyzedAt ? new Date(b.analyzedAt).getTime() : 0;
      return at - bt;
    });

  const bullets = withLessons.map(
    (r) =>
      `- (decision #${r.sourceDecisionId}) Lesson: ${String(
        r.lessonLearned,
      ).trim()}`,
  );

  const footer = [
    "",
    "_When no lesson was extractable for a counterfactual, it's omitted._",
  ];

  return [...header, ...bullets, ...footer].join("\n");
}

// ============================================================================
// aggregateConfidence — pure helper
// ============================================================================

export function aggregateConfidence(rows: CounterfactualRow[]): number {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    const c = parseConfidenceFromRow(r?.confidence);
    if (c !== null) {
      sum += c;
      count += 1;
    }
  }
  if (count === 0) return 0;
  return sum / count;
}

// ============================================================================
// Internal helpers
// ============================================================================

function isKnownAgentRole(role: string): role is SoleneDispatchAgentRole {
  return (DISPATCH_AGENT_ROLES as readonly string[]).includes(role);
}

function clampConfidence(c: number | undefined | null): number | null {
  if (c === undefined || c === null) return null;
  if (typeof c !== "number" || Number.isNaN(c)) {
    logger.warn(
      `[counterfactuals] non-numeric confidence=${String(c)}; dropping`,
    );
    return null;
  }
  if (c < 0 || c > 1) {
    const clamped = Math.max(0, Math.min(1, c));
    logger.warn(
      `[counterfactuals] confidence=${c} out of [0,1]; clamping to ${clamped}`,
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
