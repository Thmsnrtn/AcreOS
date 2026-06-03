/**
 * SOLENE — speculative execution service (Phase B L4.20).
 *
 * Agents pre-compute work they predict will be asked for soon, based on a
 * signal they observed. When the predicted ask actually arrives, Solene calls
 * findMatchingSpeculations() to surface candidates (token-overlap Jaccard
 * scoring on predicted_need, threshold 0.3, ordered by match score then
 * confidence) and consumeSpeculation() to mark the chosen one used.
 *
 * 5-state lifecycle: speculated → consumed | superseded | expired | discarded.
 * Default expiry: 30 days. supersedeSpeculation creates a NEW row linked back
 * via supersedes_speculation_id + flips the old one to 'superseded'.
 *
 * Credential discipline (inline — DON'T import constitutionalGuard, which
 * is frozen): triggered_by_signal + evidence_refs run through sanitizeText
 * BEFORE persistence. sk_live_/pk_/phc_/phx_/ghp_/AKIA/Bearer prefixes →
 * [REDACTED]. Three live credential leaks already happened across the team's
 * history; this layer must not become the fourth (per
 * feedback_credential_value_handling.md).
 *
 * Match score is exported as a pure function (jaccardScore + tokenize) for
 * testability.
 *
 * ----------------------------------------------------------------------------
 * TOOL SPEC — embed/wire-in follow-up.
 *
 * Tool name: record_speculation
 * Tool description: Pre-compute work you predict will be asked for soon,
 *   based on a signal you observed. Solene checks for matching speculations
 *   when actual asks arrive; if matched, your speculation is consumed
 *   (saving the duplicate-work cost).
 * Input schema:
 *   triggered_by_signal: string (what you observed — sanitized)
 *   predicted_need: string (what you think will be asked)
 *   speculative_output: string (the actual artifact)
 *   output_kind: enum(code_change_proposal, document_draft, data_artifact,
 *                     analysis, other)
 *   confidence: number (0-1)
 *   expires_in_days?: number (default 30)
 *   evidence_refs?: string[]
 * Output: { speculation_id }
 *
 * Tool name: find_matching_speculations
 * Tool description: Before doing a piece of work, check if a sibling agent
 *   already speculated on something matching. Returns top matches ordered by
 *   relevance + confidence.
 * Input schema:
 *   predicted_need_query: string
 *   output_kind?: enum(...)
 *   min_confidence?: number (default 0.5)
 * Output: { matches: [{ speculation_id, predicted_need, output_kind,
 *           confidence, match_score, age_minutes }] }
 * ----------------------------------------------------------------------------
 */

import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneSpeculations,
  SPECULATION_OUTPUT_KINDS,
  SPECULATION_TRIGGER_MAX,
  SPECULATION_DEFAULT_EXPIRES_DAYS,
  SPECULATION_MATCH_SCORE_THRESHOLD,
  type SpeculationOutputKind,
  type SpeculationRow,
} from "@shared/schema/solene-speculations";
import {
  DISPATCH_AGENT_ROLES,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================================================
// CREDENTIAL SANITIZATION — inline (don't import frozen constitutionalGuard).
// ============================================================================

const CREDENTIAL_PATTERNS: RegExp[] = [
  // Stripe secret/pub
  /\b(?:sk|pk)_(?:test|live)?_?[A-Za-z0-9]{8,}\b/g,
  // PostHog / posthog-style prefixes
  /\bphc_[A-Za-z0-9]{8,}\b/g,
  /\bphx_[A-Za-z0-9]{8,}\b/g,
  // GitHub PAT / OAuth
  /\bghp_[A-Za-z0-9]{8,}\b/g,
  /\bgho_[A-Za-z0-9]{8,}\b/g,
  // Bearer tokens
  /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/g,
  // AWS access keys
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
];

/**
 * Strip credential-looking substrings before persistence. Truncates over-long
 * inputs so a single rogue field can't blow up the row size.
 */
export function sanitizeText(s: string, maxLen = SPECULATION_TRIGGER_MAX): string {
  let out = String(s ?? "");
  for (const rx of CREDENTIAL_PATTERNS) {
    out = out.replace(rx, "[REDACTED]");
  }
  if (out.length > maxLen) {
    out = `${out.slice(0, maxLen)}... [truncated]`;
  }
  return out;
}

// ============================================================================
// JACCARD MATCH SCORE — pure functions, exported for testability.
// ============================================================================

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "with",
  "on",
  "is",
  "are",
  "be",
  "this",
  "that",
  "it",
]);

export function tokenize(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9_-]/g, ""))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

export function jaccardScore(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 0;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  const union = ta.size + tb.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

// ============================================================================
// createSpeculation
// ============================================================================

export interface CreateSpeculationInput {
  agentRole: SoleneDispatchAgentRole;
  triggeredBySignal: string;
  predictedNeed: string;
  speculativeOutput: string;
  outputKind: SpeculationOutputKind;
  confidence?: number;
  expiresInDays?: number;
  evidenceRefs?: string[];
  supersedesSpeculationId?: number;
}

export async function createSpeculation(
  input: CreateSpeculationInput,
): Promise<{ speculationId: number }> {
  if (!DISPATCH_AGENT_ROLES.includes(input.agentRole)) {
    throw new Error(
      `createSpeculation: invalid agentRole=${input.agentRole}`,
    );
  }
  if (
    typeof input.triggeredBySignal !== "string" ||
    input.triggeredBySignal.trim().length === 0
  ) {
    throw new Error("createSpeculation: triggeredBySignal must be non-empty");
  }
  if (
    typeof input.predictedNeed !== "string" ||
    input.predictedNeed.trim().length === 0
  ) {
    throw new Error("createSpeculation: predictedNeed must be non-empty");
  }
  if (
    typeof input.speculativeOutput !== "string" ||
    input.speculativeOutput.trim().length === 0
  ) {
    throw new Error("createSpeculation: speculativeOutput must be non-empty");
  }
  if (!SPECULATION_OUTPUT_KINDS.includes(input.outputKind)) {
    throw new Error(
      `createSpeculation: invalid outputKind=${input.outputKind}`,
    );
  }
  if (input.confidence !== undefined) {
    if (
      !Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1
    ) {
      throw new Error(
        `createSpeculation: confidence=${input.confidence} must be in [0,1]`,
      );
    }
  }

  const expiresInDays =
    input.expiresInDays ?? SPECULATION_DEFAULT_EXPIRES_DAYS;
  if (
    !Number.isFinite(expiresInDays) ||
    expiresInDays <= 0 ||
    !Number.isInteger(expiresInDays)
  ) {
    throw new Error(
      `createSpeculation: expiresInDays=${expiresInDays} must be a positive integer`,
    );
  }

  const triggeredBySignal = sanitizeText(input.triggeredBySignal);
  const evidenceRefs = (input.evidenceRefs ?? []).map((ref) =>
    sanitizeText(ref),
  );
  const expiresAt = new Date(
    Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
  );

  const [inserted] = await db
    .insert(soleneSpeculations)
    .values({
      createdByAgentRole: input.agentRole,
      triggeredBySignal,
      predictedNeed: input.predictedNeed,
      speculativeOutput: input.speculativeOutput,
      outputKind: input.outputKind,
      confidence:
        input.confidence !== undefined ? input.confidence.toFixed(4) : null,
      status: "speculated",
      expiresAt,
      supersedesSpeculationId: input.supersedesSpeculationId ?? null,
      evidenceRefs,
    })
    .returning({ id: soleneSpeculations.id });

  if (!inserted) {
    throw new Error("createSpeculation: insert returned no id");
  }

  logger.info(
    `[speculations] created id=${inserted.id} role=${input.agentRole} kind=${input.outputKind} conf=${input.confidence ?? "n/a"} expDays=${expiresInDays}`,
  );

  return { speculationId: inserted.id };
}

// ============================================================================
// consumeSpeculation
// ============================================================================

export interface ConsumeSpeculationInput {
  speculationId: number;
  consumedByDispatchId?: number;
  reason: string;
}

export async function consumeSpeculation(
  input: ConsumeSpeculationInput,
): Promise<void> {
  if (
    typeof input.reason !== "string" ||
    input.reason.trim().length === 0
  ) {
    throw new Error("consumeSpeculation: reason must be non-empty");
  }
  const existing = await getSpeculation(input.speculationId);
  if (!existing) {
    throw new Error(
      `consumeSpeculation: speculation id=${input.speculationId} not found`,
    );
  }
  if (existing.status !== "speculated") {
    throw new Error(
      `consumeSpeculation: speculation id=${input.speculationId} is status=${existing.status}; only 'speculated' can be consumed`,
    );
  }

  const now = new Date();
  await db
    .update(soleneSpeculations)
    .set({
      status: "consumed",
      consumedAt: now,
      consumedByDispatchId: input.consumedByDispatchId ?? null,
      consumedByReason: input.reason,
      updatedAt: now,
    })
    .where(eq(soleneSpeculations.id, input.speculationId));

  logger.info(
    `[speculations] consumed id=${input.speculationId} dispatchId=${input.consumedByDispatchId ?? "n/a"}`,
  );
}

// ============================================================================
// findMatchingSpeculations — Jaccard token overlap on predicted_need.
// ============================================================================

export interface MatchInput {
  agentRole?: SoleneDispatchAgentRole;
  predictedNeedQuery: string;
  outputKind?: SpeculationOutputKind;
  minConfidence?: number;
}

export interface MatchResult {
  speculationId: number;
  predictedNeed: string;
  outputKind: SpeculationOutputKind;
  confidence: number;
  matchScore: number;
  ageMinutes: number;
}

export async function findMatchingSpeculations(
  input: MatchInput,
): Promise<MatchResult[]> {
  if (
    typeof input.predictedNeedQuery !== "string" ||
    input.predictedNeedQuery.trim().length === 0
  ) {
    throw new Error(
      "findMatchingSpeculations: predictedNeedQuery must be non-empty",
    );
  }

  // Fetch active (status='speculated') candidates with optional pre-filters.
  // We score in-memory because Jaccard isn't a Postgres-native operator and
  // the active set is bounded (TTL'd to 30d default).
  const filters = [eq(soleneSpeculations.status, "speculated")];
  if (input.agentRole) {
    filters.push(eq(soleneSpeculations.createdByAgentRole, input.agentRole));
  }
  if (input.outputKind) {
    filters.push(eq(soleneSpeculations.outputKind, input.outputKind));
  }

  const rows = await db
    .select()
    .from(soleneSpeculations)
    .where(and(...filters));

  const minConfidence = input.minConfidence ?? 0;
  const now = Date.now();
  const scored: MatchResult[] = [];

  for (const row of rows) {
    const conf = row.confidence !== null ? Number(row.confidence) : 0;
    if (conf < minConfidence) continue;
    const score = jaccardScore(input.predictedNeedQuery, row.predictedNeed);
    if (score < SPECULATION_MATCH_SCORE_THRESHOLD) continue;
    scored.push({
      speculationId: row.id,
      predictedNeed: row.predictedNeed,
      outputKind: row.outputKind as SpeculationOutputKind,
      confidence: conf,
      matchScore: score,
      ageMinutes: Math.floor((now - row.createdAt.getTime()) / 60000),
    });
  }

  // Order by matchScore DESC, then confidence DESC.
  scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return b.confidence - a.confidence;
  });

  return scored;
}

// ============================================================================
// supersedeSpeculation — creates new row linked back + flips old to 'superseded'.
// ============================================================================

export async function supersedeSpeculation(
  originalId: number,
  newSpeculationInput: CreateSpeculationInput,
): Promise<{ newSpeculationId: number }> {
  const existing = await getSpeculation(originalId);
  if (!existing) {
    throw new Error(
      `supersedeSpeculation: original id=${originalId} not found`,
    );
  }
  if (existing.status !== "speculated") {
    throw new Error(
      `supersedeSpeculation: original id=${originalId} is status=${existing.status}; only 'speculated' can be superseded`,
    );
  }

  const created = await createSpeculation({
    ...newSpeculationInput,
    supersedesSpeculationId: originalId,
  });

  const now = new Date();
  await db
    .update(soleneSpeculations)
    .set({ status: "superseded", updatedAt: now })
    .where(eq(soleneSpeculations.id, originalId));

  logger.info(
    `[speculations] superseded id=${originalId} → newId=${created.speculationId}`,
  );

  return { newSpeculationId: created.speculationId };
}

// ============================================================================
// discardSpeculation — terminal with reason.
// ============================================================================

export async function discardSpeculation(
  speculationId: number,
  reason: string,
): Promise<void> {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("discardSpeculation: reason must be non-empty");
  }
  const existing = await getSpeculation(speculationId);
  if (!existing) {
    throw new Error(
      `discardSpeculation: speculation id=${speculationId} not found`,
    );
  }
  if (
    existing.status === "consumed" ||
    existing.status === "superseded" ||
    existing.status === "expired" ||
    existing.status === "discarded"
  ) {
    throw new Error(
      `discardSpeculation: id=${speculationId} is already terminal (${existing.status})`,
    );
  }

  const now = new Date();
  await db
    .update(soleneSpeculations)
    .set({
      status: "discarded",
      consumedByReason: reason,
      updatedAt: now,
    })
    .where(eq(soleneSpeculations.id, speculationId));

  logger.info(
    `[speculations] discarded id=${speculationId} reason="${reason.slice(0, 80)}"`,
  );
}

// ============================================================================
// expireStale — daily cron sweep. Flips overdue speculated rows to 'expired'.
// ============================================================================

export async function expireStale(): Promise<{ expired: number }> {
  const now = new Date();
  const expired = await db
    .update(soleneSpeculations)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(soleneSpeculations.status, "speculated"),
        isNotNull(soleneSpeculations.expiresAt),
        lte(soleneSpeculations.expiresAt, now),
      ),
    )
    .returning({ id: soleneSpeculations.id });

  if (expired.length > 0) {
    logger.info(`[speculations] expireStale flipped ${expired.length} rows`);
  }

  return { expired: expired.length };
}

// ============================================================================
// listActive — operational view for dashboards/audit.
// ============================================================================

export async function listActive(opts?: {
  agentRole?: SoleneDispatchAgentRole;
  outputKind?: SpeculationOutputKind;
  limit?: number;
}): Promise<SpeculationRow[]> {
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? 50)), 200);

  const filters = [eq(soleneSpeculations.status, "speculated")];
  if (opts?.agentRole) {
    filters.push(eq(soleneSpeculations.createdByAgentRole, opts.agentRole));
  }
  if (opts?.outputKind) {
    filters.push(eq(soleneSpeculations.outputKind, opts.outputKind));
  }

  return db
    .select()
    .from(soleneSpeculations)
    .where(and(...filters))
    .orderBy(desc(soleneSpeculations.createdAt))
    .limit(limit);
}

// ============================================================================
// getSpeculation — single row lookup.
// ============================================================================

export async function getSpeculation(
  speculationId: number,
): Promise<SpeculationRow | null> {
  const [row] = await db
    .select()
    .from(soleneSpeculations)
    .where(eq(soleneSpeculations.id, speculationId))
    .limit(1);
  return row ?? null;
}

// ============================================================================
// getStats — hit rate + average time-to-consume in a windowed view.
// ============================================================================

export interface SpeculationStats {
  totalCreated: number;
  consumed: number;
  superseded: number;
  expired: number;
  discarded: number;
  hitRate: number;
  averageTimeToConsumeMs: number | null;
}

export async function getStats(windowDays: number): Promise<SpeculationStats> {
  if (
    !Number.isFinite(windowDays) ||
    windowDays <= 0 ||
    !Number.isInteger(windowDays)
  ) {
    throw new Error(
      `getStats: windowDays=${windowDays} must be a positive integer`,
    );
  }
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(soleneSpeculations)
    .where(gte(soleneSpeculations.createdAt, cutoff));

  let consumed = 0;
  let superseded = 0;
  let expired = 0;
  let discarded = 0;
  let totalConsumeMs = 0;
  let consumeSamples = 0;

  for (const row of rows) {
    switch (row.status) {
      case "consumed":
        consumed++;
        if (row.consumedAt) {
          totalConsumeMs +=
            row.consumedAt.getTime() - row.createdAt.getTime();
          consumeSamples++;
        }
        break;
      case "superseded":
        superseded++;
        break;
      case "expired":
        expired++;
        break;
      case "discarded":
        discarded++;
        break;
      default:
        break;
    }
  }

  // Drop unused sql import warning by referencing it (no-op).
  void sql;

  const totalCreated = rows.length;
  const hitRate = totalCreated === 0 ? 0 : consumed / totalCreated;
  const averageTimeToConsumeMs =
    consumeSamples === 0 ? null : Math.round(totalConsumeMs / consumeSamples);

  return {
    totalCreated,
    consumed,
    superseded,
    expired,
    discarded,
    hitRate,
    averageTimeToConsumeMs,
  };
}
