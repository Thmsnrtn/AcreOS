/**
 * AI Cascade Telemetry (Pillar 7).
 *
 * Wraps every aiRouter invocation in a single record-and-forget call so we
 * can answer cascade-distribution and prompt-cache-adoption questions
 * without re-aggregating raw provider telemetry. Two side-effects per call:
 *
 *   1. Insert a row into `ai_call_log` (always — both cache hits and
 *      upstream calls).
 *   2. For NON-cache upstream calls only: post a corresponding debit row
 *      to `financial_ledger` via postOpexSpent so the per-org contribution
 *      margin picks up AI token spend automatically. Idempotency on the
 *      ledger side is keyed on OpenRouter's response.id (passed through as
 *      `externalEventId`) so a retried emission can't double-charge.
 *
 * Telemetry is fire-and-forget: every public function swallows its own
 * errors and logs at warn level. AI calls must never fail because the
 * telemetry insert failed.
 *
 * Query helpers:
 *   - getModelDistribution(sinceDays) — share of calls per model
 *   - getCacheHitRate(sinceDays)      — % of calls served from cache
 *   - getPromptCacheAdoption(sinceDays) — % of prompt tokens that were
 *     cache reads (cached_input_tokens / prompt_tokens, summed across all
 *     calls in the window so heavy-prompt calls dominate the average).
 *
 * The plan calls for a daily materialized view ai_model_distribution_daily;
 * we defer that until query volume justifies it and serve the same
 * answers from these helpers today.
 */

import { and, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { aiCallLog, type InsertAiCallLogRow } from "@shared/schema";
import { logger } from "../utils/logger";
import { postOpexSpent } from "./financial-ledger";

// ── Types ────────────────────────────────────────────────────────────────────

export type ComplexityClass =
  | "classification"
  | "extraction"
  | "synthesis"
  | "agent_tool"
  | "other";

export type ErrorClass =
  | "rate_limit"
  | "timeout"
  | "ctx_overflow"
  | "auth"
  | "server_error"
  | "unknown";

export interface RecordAiCallOpts {
  organizationId?: number | null;
  /** Provider model id, e.g. "anthropic/claude-haiku-4-5-20251001", or "cache" for in-process cache hits. */
  model: string;
  complexityClass: ComplexityClass;
  /** Caller tag — feature attribution. e.g. "pax_chat", "lead_scoring", "cmo_script_gen". */
  feature: string;
  promptTokens?: number;
  /** Anthropic prompt-cache READ tokens. promptTokens INCLUDES these — they're not additive. */
  cachedInputTokens?: number;
  completionTokens?: number;
  /** Fractional cents — supports sub-cent AI calls. */
  costCents?: number;
  latencyMs?: number;
  cacheHit?: boolean;
  errorClass?: ErrorClass | null;
  /**
   * OpenRouter response.id when known. Used as the financial_ledger
   * externalEventId for idempotency on the opex debit. When omitted (cache
   * hits, errors before response), no ledger row is posted.
   */
  openrouterResponseId?: string | null;
}

// ── recordAiCall ─────────────────────────────────────────────────────────────

/**
 * Insert one row into ai_call_log. For non-cache calls with both an
 * organizationId AND a positive costCents AND an openrouterResponseId, also
 * post a financial_ledger opex debit so per-org contribution margin
 * captures AI spend.
 *
 * Fully fire-and-forget — every failure is logged but never rethrown.
 */
export async function recordAiCall(opts: RecordAiCallOpts): Promise<void> {
  const row: InsertAiCallLogRow = {
    organizationId: opts.organizationId ?? null,
    model: opts.model,
    complexityClass: opts.complexityClass,
    feature: opts.feature,
    promptTokens: opts.promptTokens ?? 0,
    cachedInputTokens: opts.cachedInputTokens ?? 0,
    completionTokens: opts.completionTokens ?? 0,
    // numeric columns accept strings via drizzle-orm — preserves fractional precision.
    costCents: (opts.costCents ?? 0).toFixed(4),
    latencyMs: opts.latencyMs ?? 0,
    cacheHit: !!opts.cacheHit,
    errorClass: opts.errorClass ?? null,
  };

  try {
    await db.insert(aiCallLog).values(row);
  } catch (err) {
    logger.warn("[ai-telemetry] failed to insert ai_call_log row", {
      metadata: { detail: err instanceof Error ? err.message : err },
    });
    // Don't post to ledger if we couldn't even record telemetry — the
    // ledger insert won't break, but if telemetry is misbehaving the
    // ledger is probably misbehaving too and we want consistent skip.
    return;
  }

  // Ledger debit: only for non-cache upstream calls with attributable cost
  // and an idempotency key.
  if (
    !opts.cacheHit &&
    opts.organizationId &&
    opts.openrouterResponseId &&
    (opts.costCents ?? 0) > 0
  ) {
    try {
      // costCents on the row is fractional; ledger requires positive integer
      // cents. Round up so we never under-debit fractional AI spend.
      const integerCents = Math.max(1, Math.ceil(opts.costCents!));
      await postOpexSpent({
        organizationId: opts.organizationId,
        amountCents: integerCents,
        category: "ai_tokens",
        feature: opts.feature,
        providerName: "openrouter",
        providerEventId: opts.openrouterResponseId,
        externalEventId: `openrouter:${opts.openrouterResponseId}`,
      });
    } catch (err) {
      logger.warn("[ai-telemetry] failed to post AI opex debit to financial_ledger", {
        metadata: {
          orgId: opts.organizationId,
          feature: opts.feature,
          detail: err instanceof Error ? err.message : err,
        },
      });
    }
  }
}

// ── Query helpers ────────────────────────────────────────────────────────────

function sinceDate(sinceDays: number): Date {
  return new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
}

export interface ModelDistributionEntry {
  model: string;
  calls: number;
  percent: number;
}

/**
 * Share of calls by model over the trailing window. Sorted descending by
 * call count; percentages sum to 100 (modulo float rounding).
 */
export async function getModelDistribution(sinceDays = 7): Promise<ModelDistributionEntry[]> {
  const since = sinceDate(sinceDays);
  const rows = await db
    .select({
      model: aiCallLog.model,
      calls: sql<number>`count(*)`.mapWith(Number),
    })
    .from(aiCallLog)
    .where(gte(aiCallLog.createdAt, since))
    .groupBy(aiCallLog.model);

  const total = rows.reduce((sum, r) => sum + r.calls, 0);
  if (total === 0) return [];

  return rows
    .map((r) => ({
      model: r.model,
      calls: r.calls,
      percent: Math.round((r.calls / total) * 10000) / 100, // 2-decimal rounding
    }))
    .sort((a, b) => b.calls - a.calls);
}

/**
 * Cache-hit rate (fraction of calls served from aiRouter's in-process cache).
 * Returned as a 0..1 float; multiply by 100 for display.
 */
export async function getCacheHitRate(sinceDays = 7): Promise<number> {
  const since = sinceDate(sinceDays);
  const [row] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      hits: sql<number>`sum(case when ${aiCallLog.cacheHit} then 1 else 0 end)`.mapWith(Number),
    })
    .from(aiCallLog)
    .where(gte(aiCallLog.createdAt, since));

  const total = row?.total ?? 0;
  const hits = row?.hits ?? 0;
  return total === 0 ? 0 : hits / total;
}

/**
 * Prompt-cache adoption: fraction of prompt tokens that were Anthropic
 * cache reads. Weighted by total prompt tokens across the window so a few
 * heavy-prompt calls dominate over many tiny ones (which is the correct
 * shape — we want to know if our hot paths have caching wired up, not
 * whether trivial classifications happen to be uncached).
 *
 * Returned as a 0..1 float. Excludes cache_hit rows (which have 0 prompt
 * tokens by construction).
 */
export async function getPromptCacheAdoption(sinceDays = 7): Promise<number> {
  const since = sinceDate(sinceDays);
  const [row] = await db
    .select({
      promptSum: sql<number>`coalesce(sum(${aiCallLog.promptTokens}), 0)`.mapWith(Number),
      cachedSum: sql<number>`coalesce(sum(${aiCallLog.cachedInputTokens}), 0)`.mapWith(Number),
    })
    .from(aiCallLog)
    .where(and(gte(aiCallLog.createdAt, since), sql`${aiCallLog.cacheHit} = false`));

  const promptSum = row?.promptSum ?? 0;
  const cachedSum = row?.cachedSum ?? 0;
  return promptSum === 0 ? 0 : cachedSum / promptSum;
}

// ── Helpers (exported for callers that classify tasks themselves) ────────────

/**
 * Best-effort mapping from a TaskComplexity / heuristic string to one of
 * the canonical complexity_class buckets the matview will eventually pivot
 * on. Unknown inputs fall through to "other".
 */
export function complexityClassFromTaskType(taskType: string | undefined): ComplexityClass {
  if (!taskType) return "other";
  const t = taskType.toLowerCase();
  if (t.includes("classif") || t.includes("categor") || t.includes("score") || t.includes("qualif")) {
    return "classification";
  }
  if (t.includes("extract") || t.includes("parse") || t.includes("structure")) {
    return "extraction";
  }
  if (
    t.includes("synth") ||
    t.includes("summar") ||
    t.includes("generat") ||
    t.includes("script") ||
    t.includes("draft") ||
    t.includes("writ")
  ) {
    return "synthesis";
  }
  if (t.includes("tool") || t.includes("agent") || t.includes("director") || t.includes("pax")) {
    return "agent_tool";
  }
  return "other";
}

/**
 * Map an Error or arbitrary thrown value to a stable error_class label.
 * Used by aiRouter when emitting telemetry for failed calls.
 */
export function classifyError(err: unknown): ErrorClass {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) return "rate_limit";
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) return "timeout";
  if (lower.includes("context") && (lower.includes("length") || lower.includes("overflow") || lower.includes("exceeds"))) {
    return "ctx_overflow";
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("api key")) {
    return "auth";
  }
  if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("504")) {
    return "server_error";
  }
  return "unknown";
}
