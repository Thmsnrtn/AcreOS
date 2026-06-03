/**
 * SOLENE — reasoning over evidence weights (L6.30).
 *
 * When agents face conflicting sources on the same topic (regulatory text vs.
 * UpCounsel commentary vs. internal compliance note), call assessEvidence()
 * with the array of evidence items. The service:
 *
 *   1. Scores each item via computeWeights() →
 *        weight = base_by_kind × authority_factor × recency_factor
 *      Normalized so all weights sum to 1.0.
 *
 *      base_by_kind     regulation=1.0, case_law=0.9, internal_doc=0.7,
 *                       live_data=0.8, secondary=0.5, expert_opinion=0.4
 *      authority_factor 1.0 - (authorityTier - 1) * 0.15
 *                       (tier 1 → 1.0, tier 5 → 0.4)
 *      recency_factor   <=365d→1.0, <=3y→0.7, >3y→0.4, 'unknown'→0.3
 *
 *   2. Picks a winner via pickConclusion() — top item's weight must beat
 *      the next-highest by >=0.15 (CHOSEN_SOURCE_MIN_GAP). Otherwise
 *      returns null + "Sources conflict; manual review required."
 *
 *   3. Computes confidence = 1 - normalized_entropy(weights). One source
 *      with weight 1.0 → confidence 1.0; uniform distribution → ~0.
 *
 *   4. Persists the full assessment to solene_evidence_assessments for
 *      the audit trail.
 *
 * Pure helpers (no DB, no IO) are exported for tests + dry-runs:
 *   computeWeights, pickConclusion, computeConfidence.
 *
 * ----------------------------------------------------------------------------
 * Tool integration spec — wired in a follow-up Solene commit:
 *
 *   Tool name: assess_evidence
 *   Tool description: When you have multiple conflicting sources on the same
 *     topic, call this with the evidence items and a topic identifier.
 *     Returns a weighted aggregate + a chosen source (if clear) + rationale.
 *     Persists the assessment to the audit trail.
 *
 *   Input schema:
 *     topic: string
 *     evidence_items: Array<{ id, source_kind, source_ref, claim, recency,
 *                             authority_tier }>
 *     decision_id?: number (the decision this assessment supports)
 *     custom_weights?: Record<string, number> (override default scorer)
 *
 *   Output: { assessment_id, weight_assignments, chosen_source_id,
 *             aggregate_conclusion, rationale, confidence }
 * ----------------------------------------------------------------------------
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneEvidenceAssessments,
  EVIDENCE_BASE_WEIGHT_BY_KIND,
  AUTHORITY_PENALTY_PER_TIER,
  RECENCY_FACTOR_RECENT,
  RECENCY_FACTOR_MID,
  RECENCY_FACTOR_OLD,
  RECENCY_FACTOR_UNKNOWN,
  RECENCY_DAYS_RECENT,
  RECENCY_DAYS_MID,
  CHOSEN_SOURCE_MIN_GAP,
  CONFLICT_CONCLUSION_MESSAGE,
  type EvidenceSourceKind,
  type SoleneEvidenceAssessmentRow,
} from "@shared/schema/solene-evidence-weights";
import { type SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export type AuthorityTier = 1 | 2 | 3 | 4 | 5;

export interface EvidenceItem {
  id: string;
  sourceKind: EvidenceSourceKind;
  sourceRef: string;
  claim: string;
  /** ISO date string OR the literal "unknown". */
  recency?: string;
  authorityTier: AuthorityTier;
}

export interface AssessmentInput {
  agentRole: SoleneDispatchAgentRole;
  topic: string;
  decisionId?: number;
  evidenceItems: EvidenceItem[];
  /** Optional override — skips the default scorer. Weights are normalized. */
  customWeights?: Record<string, number>;
}

export interface AssessmentResult {
  assessmentId: number;
  weightAssignments: Record<string, number>;
  chosenSourceId: string | null;
  aggregateConclusion: string;
  rationale: string;
  confidence: number;
}

// ============================================================================
// PURE: computeWeights
// ============================================================================

/**
 * Score each evidence item, then normalize so weights sum to 1.0.
 *
 * Returns an empty object when items is empty. Items with the same id
 * collide — caller is responsible for ensuring unique ids; last write
 * wins in the output map.
 */
export function computeWeights(
  items: EvidenceItem[],
  now: Date = new Date(),
): Record<string, number> {
  if (!Array.isArray(items) || items.length === 0) {
    return {};
  }

  const raw: Record<string, number> = {};
  let total = 0;

  for (const item of items) {
    const base = EVIDENCE_BASE_WEIGHT_BY_KIND[item.sourceKind] ?? 0;
    const authority = computeAuthorityFactor(item.authorityTier);
    const recency = computeRecencyFactor(item.recency, now);
    const score = base * authority * recency;
    raw[item.id] = score;
    total += score;
  }

  if (total <= 0) {
    // All items scored to 0 — fall back to uniform so the caller has a
    // valid distribution.
    const uniform = 1 / items.length;
    for (const item of items) raw[item.id] = uniform;
    return raw;
  }

  const normalized: Record<string, number> = {};
  for (const id of Object.keys(raw)) {
    normalized[id] = raw[id] / total;
  }
  return normalized;
}

function computeAuthorityFactor(tier: number): number {
  // Clamp tier into [1,5] then apply linear penalty.
  const safeTier = clampInt(tier, 1, 5);
  const factor = 1.0 - (safeTier - 1) * AUTHORITY_PENALTY_PER_TIER;
  // Floor at 0 just in case constants change later.
  return factor < 0 ? 0 : factor;
}

function computeRecencyFactor(
  recency: string | undefined,
  now: Date,
): number {
  if (!recency || recency === "unknown") {
    return RECENCY_FACTOR_UNKNOWN;
  }
  const parsed = Date.parse(recency);
  if (!Number.isFinite(parsed)) {
    return RECENCY_FACTOR_UNKNOWN;
  }
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - parsed) / (24 * 60 * 60 * 1000)),
  );
  if (ageDays <= RECENCY_DAYS_RECENT) return RECENCY_FACTOR_RECENT;
  if (ageDays <= RECENCY_DAYS_MID) return RECENCY_FACTOR_MID;
  return RECENCY_FACTOR_OLD;
}

// ============================================================================
// PURE: pickConclusion
// ============================================================================

/**
 * Pick the winning source. Returns chosenSourceId + aggregateConclusion:
 *
 *   - 0 items     → (null, conflict-message)
 *   - 1 item      → (that item's id, that item's claim)
 *   - top - 2nd >  CHOSEN_SOURCE_MIN_GAP → (top.id, top.claim)
 *   - otherwise   → (null, conflict-message)
 */
export function pickConclusion(
  items: EvidenceItem[],
  weights: Record<string, number>,
): { chosenSourceId: string | null; aggregateConclusion: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      chosenSourceId: null,
      aggregateConclusion: CONFLICT_CONCLUSION_MESSAGE,
    };
  }

  const sorted = items
    .map((item) => ({ item, weight: weights[item.id] ?? 0 }))
    .sort((a, b) => b.weight - a.weight);

  const top = sorted[0];

  if (sorted.length === 1) {
    return {
      chosenSourceId: top.item.id,
      aggregateConclusion: top.item.claim,
    };
  }

  const second = sorted[1];
  const gap = top.weight - second.weight;

  // Gap must EXCEED CHOSEN_SOURCE_MIN_GAP. Spec: ">=0.15 gap declares a
  // winner." But the conflict case is "<=0.15." Treat the boundary as
  // conflict per the spec wording: "no clear winner — Solene must read
  // all sources" when the difference is <=0.15.
  if (gap > CHOSEN_SOURCE_MIN_GAP) {
    return {
      chosenSourceId: top.item.id,
      aggregateConclusion: top.item.claim,
    };
  }

  return {
    chosenSourceId: null,
    aggregateConclusion: CONFLICT_CONCLUSION_MESSAGE,
  };
}

// ============================================================================
// PURE: computeConfidence
// ============================================================================

/**
 * Confidence from the weight distribution's entropy.
 *
 *   normalized_entropy = -sum(p * log2(p)) / log2(n)   (for n > 1)
 *   confidence         = 1 - normalized_entropy
 *
 * One source w=1.0 → entropy 0 → confidence 1.0.
 * Uniform distribution → normalized_entropy 1.0 → confidence 0.
 * Single-source (n=1) → confidence 1.0 by definition.
 */
export function computeConfidence(weights: Record<string, number>): number {
  const values = Object.values(weights).filter(
    (v) => Number.isFinite(v) && v > 0,
  );
  if (values.length === 0) return 0;
  if (values.length === 1) return 1;

  // Re-normalize defensively in case caller passed non-normalized values.
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const p = values.map((v) => v / total);

  let entropy = 0;
  for (const pi of p) {
    if (pi > 0) entropy += -pi * Math.log2(pi);
  }
  const maxEntropy = Math.log2(values.length);
  if (maxEntropy <= 0) return 1;
  const normalized = entropy / maxEntropy;
  const confidence = 1 - normalized;
  // Clamp to [0,1] — floating-point can drift slightly.
  if (confidence < 0) return 0;
  if (confidence > 1) return 1;
  return confidence;
}

// ============================================================================
// SERVICE: assessEvidence
// ============================================================================

/**
 * Score + persist an evidence assessment. Returns the inserted row's id
 * plus the computed weights / chosen source / rationale / confidence.
 */
export async function assessEvidence(
  input: AssessmentInput,
): Promise<AssessmentResult> {
  const now = new Date();
  const items = input.evidenceItems ?? [];

  // 1. Compute weights (default or custom).
  let weightAssignments: Record<string, number>;
  if (input.customWeights) {
    weightAssignments = normalizeWeights(input.customWeights, items);
  } else {
    weightAssignments = computeWeights(items, now);
  }

  // 2. Pick winner.
  const { chosenSourceId, aggregateConclusion } = pickConclusion(
    items,
    weightAssignments,
  );

  // 3. Confidence.
  const confidence = computeConfidence(weightAssignments);

  // 4. Rationale.
  const rationale = buildRationale(
    items,
    weightAssignments,
    chosenSourceId,
    input.customWeights !== undefined,
    now,
  );

  // 5. Persist. Failure is logged but still returns the computed result
  // with assessmentId=-1 so callers can dry-run via the pure helpers in
  // tests without a live DB.
  let assessmentId = -1;
  try {
    const [inserted] = await db
      .insert(soleneEvidenceAssessments)
      .values({
        agentRole: input.agentRole,
        topic: input.topic,
        decisionId: input.decisionId ?? null,
        evidenceItems: serializeEvidenceItems(items),
        chosenSourceId,
        weightAssignments,
        aggregateConclusion,
        rationale,
        confidence: confidence.toFixed(4),
      })
      .returning({ id: soleneEvidenceAssessments.id });
    if (inserted) {
      assessmentId = inserted.id;
      logger.info(
        `[evidenceWeights] assessed id=${assessmentId} role=${input.agentRole} topic="${input.topic}" chosen=${chosenSourceId ?? "none"} confidence=${confidence.toFixed(4)}`,
      );
    } else {
      logger.warn(
        `[evidenceWeights] insert returned no id for topic="${input.topic}"`,
      );
    }
  } catch (err) {
    logger.warn(
      "[evidenceWeights] assessEvidence persist failed",
      err instanceof Error ? err : undefined,
    );
  }

  return {
    assessmentId,
    weightAssignments,
    chosenSourceId,
    aggregateConclusion,
    rationale,
    confidence,
  };
}

// ============================================================================
// SERVICE: listAssessmentsByTopic
// ============================================================================

export async function listAssessmentsByTopic(
  topic: string,
  limit: number = 20,
): Promise<SoleneEvidenceAssessmentRow[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  try {
    const rows = await db
      .select()
      .from(soleneEvidenceAssessments)
      .where(eq(soleneEvidenceAssessments.topic, topic))
      .orderBy(desc(soleneEvidenceAssessments.assessedAt))
      .limit(safeLimit);
    return rows;
  } catch (err) {
    logger.warn(
      `[evidenceWeights] listAssessmentsByTopic failed for topic="${topic}"`,
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function clampInt(n: number, lo: number, hi: number): number {
  const v = Math.floor(n);
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Normalize a custom weights map. Filters non-finite + negative values,
 * adds zero entries for any item missing from the map, then re-scales
 * so the result sums to 1.0. Returns uniform on degenerate input.
 */
function normalizeWeights(
  weights: Record<string, number>,
  items: EvidenceItem[],
): Record<string, number> {
  if (items.length === 0) return {};
  const out: Record<string, number> = {};
  let total = 0;
  for (const item of items) {
    const v = weights[item.id];
    const safe = Number.isFinite(v) && v > 0 ? v : 0;
    out[item.id] = safe;
    total += safe;
  }
  if (total <= 0) {
    const uniform = 1 / items.length;
    for (const item of items) out[item.id] = uniform;
    return out;
  }
  for (const id of Object.keys(out)) out[id] = out[id] / total;
  return out;
}

function serializeEvidenceItems(items: EvidenceItem[]): unknown {
  return items.map((item) => ({
    id: item.id,
    source_kind: item.sourceKind,
    source_ref: item.sourceRef,
    claim: item.claim,
    recency: item.recency ?? "unknown",
    authority_tier: item.authorityTier,
  }));
}

function buildRationale(
  items: EvidenceItem[],
  weights: Record<string, number>,
  chosenSourceId: string | null,
  isCustom: boolean,
  now: Date,
): string {
  const lines: string[] = [];
  lines.push(
    isCustom
      ? "Weights provided by caller (default scorer skipped); breakdown:"
      : "Default scorer: weight = base_by_kind × authority_factor × recency_factor (normalized).",
  );
  for (const item of items) {
    const w = weights[item.id] ?? 0;
    const base = EVIDENCE_BASE_WEIGHT_BY_KIND[item.sourceKind] ?? 0;
    const auth = computeAuthorityFactor(item.authorityTier);
    const rec = computeRecencyFactor(item.recency, now);
    lines.push(
      `- [${item.id}] kind=${item.sourceKind} tier=${item.authorityTier} recency=${item.recency ?? "unknown"} → base=${base.toFixed(2)} × authority=${auth.toFixed(2)} × recency=${rec.toFixed(2)} → normalized weight=${w.toFixed(4)}`,
    );
  }
  if (chosenSourceId) {
    lines.push(
      `Conclusion: chose source ${chosenSourceId} (weight gap >${CHOSEN_SOURCE_MIN_GAP.toFixed(2)} vs. next-highest).`,
    );
  } else {
    lines.push(
      `Conclusion: ${CONFLICT_CONCLUSION_MESSAGE} (no source's weight beats the next by >${CHOSEN_SOURCE_MIN_GAP.toFixed(2)}).`,
    );
  }
  return lines.join("\n");
}

// Quiet unused-import warning for `and` kept for future filter chains
// (e.g. listAssessmentsByTopic + agentRole).
void and;
