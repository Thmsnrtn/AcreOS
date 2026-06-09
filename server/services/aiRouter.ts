import OpenAI from "openai";
import crypto from "crypto";
import { logger } from "../utils/logger";
import { computeCostUsd } from "./aiCostRates";
// Single source of truth for model IDs + their token prices. aiRouter no longer
// hard-codes model strings or a private cost table — both come from here so the
// router and paxModelTier can never disagree on which Opus is "best" again.
import { MODELS, priceFor, isKnownModel } from "./models";
import { checkQuota, recordUsage, AIQuotaExceeded } from "./aiQuotaService";
import {
  recordAiCall as recordCascadeCall,
  complexityClassFromTaskType,
  classifyError as classifyAiError,
} from "./ai-telemetry";

// ============================================
// AI RESPONSE CACHE — Dual-layer
//   Layer 1: Exact-match SHA-256 (existing, fast)
//   Layer 2: Semantic dedup via token-overlap similarity (new)
//            Catches ~25-40% more cache hits for paraphrased queries
// ============================================

interface CacheEntry {
  content: string;
  provider: AIProvider;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  estimatedCost?: number;
  cachedAt: number;
  // For semantic dedup
  queryTokens?: Set<string>;
}

const AI_CACHE = new Map<string, CacheEntry>();
// In-process response cache for low-temperature (≤0.3), non-COMPLEX queries.
// 2026-06-05 cost audit O11: raised from 15min → 60min. The cache key is an
// exact hash of the messages array — entries are only reusable for identical
// queries, so the longer TTL just amortizes the same answer over more
// requests. Memory bound is MAX_CACHE_SIZE entries (eviction LRU).
// Override via AI_CACHE_TTL_MINUTES env without a deploy.
const CACHE_TTL_MS = (() => {
  const fromEnv = process.env.AI_CACHE_TTL_MINUTES;
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) return n * 60 * 1000;
  }
  return 60 * 60 * 1000;
})();
const MAX_CACHE_SIZE = 500;

// Semantic similarity threshold: entries with Jaccard similarity ≥ this score are considered equivalent.
// 0.72 balances precision vs recall well for domain-specific queries.
const SEMANTIC_SIMILARITY_THRESHOLD = 0.72;

function getCacheKey(task: AITask): string {
  const payload = JSON.stringify({
    messages: task.messages,
    taskType: task.taskType,
    responseFormat: task.responseFormat,
    temperature: task.temperature,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Tokenize a query for semantic similarity comparison.
 * Normalizes, removes stop words, keeps domain-significant terms.
 */
function tokenize(text: string): Set<string> {
  const STOP_WORDS = new Set([
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "is","are","was","were","be","been","being","have","has","had","do","does",
    "did","will","would","could","should","may","might","shall","can","this",
    "that","these","those","it","its","i","you","he","she","we","they","me",
    "him","her","us","them","my","your","his","our","their","what","which",
    "who","how","when","where","why","if","then","than","so","as","by","from",
    "up","about","into","through","during","before","after","above","below",
    "between","out","off","over","under","again","further","please","provide",
    "give","tell","list","show","return","output","respond","only","just","also",
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t))
  );
}

/**
 * Jaccard similarity between two token sets.
 * Fast, no external deps, works surprisingly well for domain-specific text.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find a semantically equivalent cached response.
 * Only used for SIMPLE/MODERATE tasks with temperature ≤ 0.3 (deterministic).
 */
function findSemanticCacheHit(task: AITask): CacheEntry | null {
  const queryText = (task.messages ?? []).map(m => m.content).join(" ");
  const queryTokens = tokenize(queryText);
  const now = Date.now();

  for (const [key, entry] of AI_CACHE.entries()) {
    // Skip expired
    if (now - entry.cachedAt > CACHE_TTL_MS) { AI_CACHE.delete(key); continue; }
    // Skip entries without token index
    if (!entry.queryTokens || entry.queryTokens.size === 0) continue;

    const similarity = jaccardSimilarity(queryTokens, entry.queryTokens);
    if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
      return entry;
    }
  }
  return null;
}

function getCachedResponse(key: string): CacheEntry | null {
  const entry = AI_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    AI_CACHE.delete(key);
    return null;
  }
  return entry;
}

function setCachedResponse(key: string, entry: CacheEntry): void {
  if (AI_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = AI_CACHE.keys().next().value;
    if (oldestKey) AI_CACHE.delete(oldestKey);
  }
  AI_CACHE.set(key, entry);
}

// Cache stats for telemetry
let cacheHits = 0;
let semanticCacheHits = 0;
let cacheMisses = 0;

export function getAICacheStats() {
  return {
    size: AI_CACHE.size,
    hits: cacheHits,
    semanticHits: semanticCacheHits,
    misses: cacheMisses,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL_MS,
    semanticThreshold: SEMANTIC_SIMILARITY_THRESHOLD,
  };
}

export function clearAICache() {
  AI_CACHE.clear();
  cacheHits = 0;
  semanticCacheHits = 0;
  cacheMisses = 0;
}

// ============================================
// MODEL CASCADE — Quality-Gated Escalation
//
// Problem: static routing trusts complexity classification blindly.
// If DeepSeek gives a poor answer to what looked like a simple task,
// we silently return bad output.
//
// Solution: after generating with the initial model, run a fast
// quality-check prompt (using DeepSeek — ~$0.002 per check) to score
// the response on coherence, completeness, and relevance (1-10).
// If score < QUALITY_THRESHOLD → escalate to the next tier and retry.
//
// Expected behavior:
//   SIMPLE + bad DeepSeek answer → retry with Haiku   (~$0.004 overhead)
//   MODERATE + bad Haiku answer  → retry with Sonnet  (~$0.008 overhead)
//   COMPLEX  → always use Sonnet (no cascade needed)
//
// Net effect: fewer bad outputs, ~5-15% cost increase on escalated calls,
// but the calls that escalate would have required human re-work anyway.
// ============================================

// ── Cost-control levers (default to CURRENT behavior; no-op unless set) ───────
// AI_CASCADE_ENABLED  — when "false"/"0"/"off"/"no", disables the quality-cascade
//                       escalation entirely. Default (unset) → true → today's
//                       behavior, unchanged.
// AI_QUALITY_THRESHOLD — integer 1-10; the cascade fires when the quality-check
//                       score falls *below* this. Default (unset/invalid) → 6,
//                       exactly today's constant. Pure lever, behavior identical
//                       when unset.
function isCascadeEnabled(): boolean {
  const raw = (process.env.AI_CASCADE_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "no";
}

function getQualityThreshold(): number {
  const raw = process.env.AI_QUALITY_THRESHOLD;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n;
  }
  return 6; // unchanged default
}

// NOTE: the cascade-enabled flag and quality threshold are now read LIVE via
// isCascadeEnabled() / getQualityThreshold() so the AI_CASCADE_ENABLED and
// AI_QUALITY_THRESHOLD env knobs take effect without a redeploy. Defaults are
// true / 6 respectively — identical to the prior hard-coded behavior.

interface QualityCheckResult {
  score: number;       // 1-10
  reason: string;
  shouldEscalate: boolean;
}

async function checkResponseQuality(
  task: AITask,
  response: string,
  client: OpenAI
): Promise<QualityCheckResult> {
  // Use a small, targeted prompt with DeepSeek (cheapest model)
  const checkPrompt = `Rate this AI response on a scale of 1-10 for quality.
Task type: ${task.taskType}
User request (abbreviated): ${(task.messages ?? [])[(task.messages ?? []).length - 1]?.content?.slice(0, 200)}

AI Response: ${response.slice(0, 500)}

Score criteria:
- 9-10: Complete, accurate, well-structured, directly answers the request
- 7-8: Good but could be more detailed or slightly off-target
- 5-6: Partially answers but misses key aspects or is vague
- 3-4: Mostly off-target or too generic
- 1-2: Wrong, incoherent, or refused to answer

Respond with JSON only: {"score": <1-10>, "reason": "<one sentence>"}`;

  try {
    const check = await client.chat.completions.create({
      model: MODEL_SIMPLE, // Always use cheapest for quality check
      messages: [
        { role: "system", content: "You are a response quality evaluator. Respond only with valid JSON." },
        { role: "user", content: checkPrompt },
      ],
      max_tokens: 80,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(check.choices[0]?.message?.content || '{"score":8,"reason":"ok"}');
    const score = Math.max(1, Math.min(10, parsed.score || 8));
    return { score, reason: parsed.reason || "", shouldEscalate: score < getQualityThreshold() };
  } catch {
    // On quality-check failure, assume response is good (fail open)
    return { score: 8, reason: "quality check failed — assuming adequate", shouldEscalate: false };
  }
}

export enum TaskComplexity {
  SIMPLE = "simple",
  MODERATE = "moderate",
  COMPLEX = "complex",
  CRITICAL = "critical", // Opus (current best, claude-opus-4-8) — highest-stakes only
}

// ============================================
// TASK TIER (Wave 8 — Haiku default routing)
//
// Tiers are an *intent-based* routing axis, distinct from `complexity`.
// Complexity guesses how hard a task is from its content; tier is what the
// caller asserts about the customer impact of getting it right.
//
//   critical    → customer-facing, quality-sensitive surfaces.
//                 Default model: Sonnet 4.6. We do NOT downgrade these
//                 unless the founder flips AI_HAIKU_DEFAULT_ENABLED=false
//                 (that flag forces *every* tier back to Sonnet — used as
//                 a single emergency rollback lever).
//   standard    → default for most internal-but-customer-adjacent work.
//                 Default model: Haiku 4.5. 60-80% cost reduction vs Sonnet.
//   background  → internal classification, summarization, extraction.
//                 Default model: Haiku 4.5. Same as standard today, but
//                 separated so we can route to a cheaper micro-model later
//                 (e.g. DeepSeek) without touching callsites again.
//
// Cost projection (Anthropic public prices, 2026-05):
//   Sonnet 4.6: $3 / $15 per M tokens
//   Haiku  4.5: $0.80 / $4 per M tokens (≈73% cheaper)
//
// Caller convention: every routeAITask / generateWithAutoRouting callsite
// SHOULD pass `taskTier` explicitly. Passing it through `config.taskTier`
// (router config) or `task.taskTier` both work — config wins if both set.
// ============================================

export type TaskTier = "critical" | "standard" | "background";

/**
 * AI_HAIKU_DEFAULT_ENABLED — single env var to flip every standard/background
 * call back to Sonnet if quality regressions appear in the wild. Defaults to
 * true; set to "false" or "0" to disable the Haiku default.
 */
function isHaikuDefaultEnabled(): boolean {
  const raw = (process.env.AI_HAIKU_DEFAULT_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "no";
}

/**
 * Resolve a tier to a concrete model id, honoring the AI_HAIKU_DEFAULT_ENABLED
 * kill-switch. When the flag is disabled, every tier falls through to Sonnet
 * — gives the founder a single env var to flip if quality regresses in prod.
 *
 * Implemented as a function so MODEL_* constants (declared later in this
 * file) are in scope by the time any caller invokes us at request time.
 */
export function modelForTier(tier: TaskTier): string {
  if (!isHaikuDefaultEnabled()) {
    return MODEL_COMPLEX; // Sonnet for everything when kill-switch flipped
  }
  switch (tier) {
    case "critical":   return MODEL_COMPLEX;   // Sonnet 4.6
    case "standard":   return MODEL_MODERATE;  // Haiku 4.5
    case "background": return MODEL_MODERATE;  // Haiku 4.5
  }
}

/** Public for tests + founder dashboard. */
export function getTierToModelMap(): Record<TaskTier, string> {
  if (!isHaikuDefaultEnabled()) {
    return { critical: MODEL_COMPLEX, standard: MODEL_COMPLEX, background: MODEL_COMPLEX };
  }
  return {
    critical:   MODEL_COMPLEX,
    standard:   MODEL_MODERATE,
    background: MODEL_MODERATE,
  };
}

// ============================================
// AI ROUTING OVERRIDES (eval-gated rollback)
// ============================================

interface RoutingOverride {
  taskType: string;
  overrideTier: TaskTier;
  overrideModel: string | null;
  reason: string;
}

interface OverrideCache {
  byTaskType: Map<string, RoutingOverride>;
  loadedAt: number;
}

let overrideCache: OverrideCache | null = null;
const OVERRIDE_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadRoutingOverrides(): Promise<OverrideCache> {
  if (overrideCache && Date.now() - overrideCache.loadedAt < OVERRIDE_CACHE_TTL_MS) {
    return overrideCache;
  }
  try {
    const { db } = await import("../db");
    const { aiRoutingOverrides } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(aiRoutingOverrides).where(eq(aiRoutingOverrides.active, true));
    const map = new Map<string, RoutingOverride>();
    for (const r of rows) {
      // Skip expired overrides — defensive even though active=false should be set
      if (r.expiresAt && new Date(r.expiresAt).getTime() < Date.now()) continue;
      map.set(r.taskType, {
        taskType: r.taskType,
        overrideTier: r.overrideTier as TaskTier,
        overrideModel: r.overrideModel,
        reason: r.reason,
      });
    }
    overrideCache = { byTaskType: map, loadedAt: Date.now() };
    return overrideCache;
  } catch (err) {
    logger.warn("[AIRouter] failed to load routing overrides — proceeding without", {
      metadata: { detail: err instanceof Error ? err.message : err },
    });
    return { byTaskType: new Map(), loadedAt: Date.now() };
  }
}

export function invalidateRoutingOverrideCache(): void {
  overrideCache = null;
}

export enum AIProvider {
  OPENROUTER = "openrouter",
  OPENAI = "openai",
}

export interface AITask {
  taskType?: string;
  complexity: TaskComplexity;
  /**
   * Wave 8 — tier-based routing. When set, takes precedence over
   * `complexity` for model selection (unless an override row pins it back).
   * See TaskTier docs for tier semantics.
   */
  taskTier?: TaskTier;
  /**
   * Shorthand for the single-turn case: pass a raw prompt string instead
   * of building messages. The router converts it to
   * `[{ role: "user", content: task }]` automatically before sending.
   * Mutually exclusive with `messages` in practice; if both are set,
   * `messages` wins.
   */
  task?: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json";
  // Prompt caching: set true when system prompt is large and repeated (agents, legal docs).
  // OpenRouter passes cache_control to Anthropic — 70-90% cost reduction on cached portion.
  enablePromptCaching?: boolean;
  // Extended thinking: set true for multi-step mathematical/legal reasoning.
  // Uses claude-sonnet-4-6 with thinking tokens. Best quality for valuation models.
  useExtendedThinking?: boolean;
  thinkingBudget?: number; // max thinking tokens, default 8000
  /**
   * Model self-reported confidence (PRIMARY confidence signal).
   *
   * When true, the router:
   *   1. Forces JSON response mode and appends a schema instruction asking the
   *      model to include a top-level `confidence` field (a number in 0..1)
   *      reflecting how sure it is of its own answer, as part of generation.
   *   2. Parses that field back out of the response and exposes it on
   *      `AIResponse.confidence` (0..1). If the model omits or malforms it,
   *      `confidence` is `null` — an honest "not measured", never a constant.
   *
   * This is the real, model-derived confidence signal that replaces the
   * hand-coded Pax confidence constants. Callers that don't set this flag get
   * `confidence: undefined` (feature off) — behavior unchanged.
   */
  requestConfidence?: boolean;
}

export interface AIRouterConfig {
  forceProvider?: AIProvider;
  forcePremium?: boolean;
  forceModel?: string;     // pin to a specific OpenRouter model ID
  useVision?: boolean;     // route to vision-capable model (gpt-4o via OpenRouter)
  useReasoning?: boolean;  // route to deep-reasoning model (DeepSeek R1)
  useCritical?: boolean;   // force Opus 4.8 (highest-stakes tasks only)
  orgId?: number;
  /**
   * Phase 3 Week 9: per-org daily AI cost cap.
   * When orgId is set AND skipQuota is false, routeAITask will:
   *   1. Read the org's organizations.org_ai_quota_daily_usd cap.
   *   2. Sum today's ai_usage_daily.totalUsd for the org.
   *   3. Throw AIQuotaExceeded (HTTP 429) if used >= cap.
   *   4. Record costUsd into ai_usage_daily after a successful call.
   * Founder orgs and internal-system tasks (cron jobs, cascade quality
   * checks) should pass `skipQuota: true` to bypass enforcement.
   */
  skipQuota?: boolean;
  /**
   * Frugal Autonomy (Phase 2.1, 2026-05-25): platform-wide per-category
   * daily AI budget gate. When unset (default), every routeAITask call
   * checks today's spend in the category for task.taskType against the
   * configured cap and throws BudgetExceededError if exhausted. Set
   * `skipBudget: true` ONLY for interactive founder-facing calls that
   * should never be silently refused (e.g. founder typing into Atlas).
   */
  skipBudget?: boolean;
  /**
   * Per-org daily cap in USD. When provided, this value is used directly and
   * the DB lookup is skipped. Useful for callers that already have the org
   * row in hand.  When undefined, the router queries organizations.
   */
  orgQuotaCapUsd?: number;
  /**
   * Wave 8 — tier-based override. When set, this wins over task.taskTier
   * (router-config wins). Useful for routes that want to force-pin tier
   * without mutating the AITask object.
   */
  taskTier?: TaskTier;
}

const SIMPLE_TASKS = [
  "summarize",
  "extract_data",
  "draft_email",
  "format_text",
  "simple_qa",
  "categorize",
  "translate",
  "basic_analysis",
  "greeting",
  "lookup",
  "list",
  "count",
  "status_check",
];

const COMPLEX_TASKS = [
  "deal_analysis",
  "negotiation_strategy",
  "market_valuation",
  "due_diligence",
  "risk_assessment",
  "financial_modeling",
  "multi_step",
  "reasoning",
  "strategy",
  "recommendation",
  "evaluation",
  "comparison",
  "prediction",
  "forecasting",
  "planning",
  "optimization",
  "creative",
];

// CRITICAL tasks: routed to Opus (current best, claude-opus-4-8) — reserved for
// the <2% of requests where the highest possible reasoning quality is worth the
// cost premium over Sonnet.
// Rule: only use Opus when a wrong answer has real financial or legal consequences.
const CRITICAL_TASKS = [
  "contract_review",       // Legal document with binding consequences
  "legal_document",        // Drafting legally-binding documents
  "capital_allocation",    // Portfolio-level capital deployment decisions
  "note_securitization",   // Structuring seller-financed note portfolios
  "regulatory_compliance", // Compliance determinations with legal exposure
  "fraud_detection",       // Financial fraud analysis — false negatives costly
  // NOTE: "executive_decision" was removed 2026-05-25 — the autonomous
  // decision executor was sending 940+ items/day through this label,
  // 98% of which were routine agent housekeeping (initiatives, dlq
  // replays, agent recommendations) that don't need Opus. Real
  // high-stakes founder strategy still gets Opus by passing
  // `complexity: TaskComplexity.CRITICAL` explicitly; the executor now
  // tiers per item_type via inferExecutorComplexity() in
  // autonomousDecisionExecutor.ts. See $30/day → $1/day cost fix.
];

// ============================================
// OPENROUTER-ONLY CLIENTS
// All AI requests route through OpenRouter's OpenAI-compatible endpoint.
// This includes Claude, GPT-4o, Gemini, DeepSeek — all via one API key.
// ============================================

// ============================================
// MODEL CATALOG — all accessed via OpenRouter
// Ordered by cost tier within each quality band.
//
// ROUTING PHILOSOPHY (2026):
//   T1  DeepSeek Chat      — micro tasks, templated ops, $0.14/$0.28
//   T2  Haiku 4.5          — balanced reasoning, medium tasks, $0.80/$4.00
//   T3  Sonnet 4.6         — complex analysis, deal decisions, $3.00/$15.00
//   T3r DeepSeek Reasoner  — long-form step-by-step math/logic, $0.55/$2.19
//   T4  Opus 4.8           — highest-stakes decisions only (<2% of volume), $5/$25
//
// TARGET DISTRIBUTION: 60% T1, 30% T2, 7% T3, 1% T3r, 2% T4
// This achieves ~85% cost reduction vs all-Opus while preserving Opus-quality
// output on the tasks that genuinely need it.
//
// PROMPT CACHING: For tasks with large repeated system prompts (agents, legal),
// OpenRouter passes `cache_control` to Anthropic — 70-90% cost reduction on
// the cached portion. Applied automatically when system prompt ≥ 1024 tokens.
// ============================================

// Model IDs come from the SINGLE source of truth in ./models.ts. These exported
// aliases are kept for the many call-sites that already import MODEL_* — they are
// now thin re-exports, not independent definitions, so they can never drift from
// paxModelTier or the cost table.
// Tier 1 — Micro (cheapest, fast, good for simple templated tasks)
export const MODEL_SIMPLE    = MODELS.DEEPSEEK_CHAT;     // $0.14/$0.28 per M tokens
// Tier 2 — Balanced (good reasoning, moderate cost)
export const MODEL_MODERATE  = MODELS.HAIKU;            // $0.80/$4.00 per M tokens (OpenRouter)
// Tier 3 — Premium (best reasoning for complex land investment decisions)
export const MODEL_COMPLEX   = MODELS.SONNET;          // $3.00/$15.00 per M tokens
// Tier 3R — Deep reasoning (step-by-step for valuation/financial models)
export const MODEL_REASONING = MODELS.DEEPSEEK_REASONER; // $0.55/$2.19 per M tokens
// Tier 4 — Opus (highest-stakes only: contract review, capital allocation, legal)
// Pinned to the CURRENT best Opus (claude-opus-4-8) via models.ts.
export const MODEL_CRITICAL  = MODELS.OPUS;            // $5.00/$25.00 per M tokens
// Tier V — Vision/Docs (multimodal, used for satellite/document parsing)
export const MODEL_VISION    = MODELS.VISION;          // $2.50/$10.00 per M tokens

// Legacy aliases kept for backward compat
const OPENROUTER_CHEAP_MODEL     = MODEL_SIMPLE;
const OPENROUTER_REASONING_MODEL = MODEL_REASONING;
const OPENAI_PREMIUM_MODEL       = MODEL_COMPLEX;
const OPENAI_FAST_MODEL          = MODEL_MODERATE;

// Model presets for in-rail model selector
export const MODEL_PRESETS = {
  auto: null, // Use automatic routing
  fast: MODELS.DEEPSEEK_CHAT,
  balanced: "openai/gpt-4o-mini",
  powerful: MODELS.VISION,
  reasoning: MODELS.DEEPSEEK_REASONER,
  claude: MODELS.SONNET,
  claude_opus: MODELS.OPUS,
} as const;

export type ModelPreset = keyof typeof MODEL_PRESETS;

export function isClaudeModel(model: string): boolean {
  return model.includes('claude') || model.startsWith('anthropic/');
}

let openrouterClient: OpenAI | null = null;
let openaiClient: OpenAI | null = null;  // Kept for backward compat but routes to OpenRouter

function getOpenRouterClient(): OpenAI | null {
  if (!openrouterClient) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    if (!apiKey) {
      return null;
    }
    openrouterClient = new OpenAI({
      apiKey,
      baseURL,
      // 30s per request + 1 retry. The SDK default is 10 minutes / 2 retries
      // — under any provider stall that holds the Node socket for up to
      // 30 minutes per request, exhausting the connection pool. Surfaced by
      // the 2026-06-05 Iris reliability audit. The failover path in
      // server/services/solene/chat/providerSelector.ts handles the rest of
      // resilience; this bound is the per-call hard ceiling.
      timeout: 30_000,
      maxRetries: 1,
      defaultHeaders: {
        "HTTP-Referer": "https://acreos.fly.dev",
        "X-Title": "AcreOS",
      },
    });
  }
  return openrouterClient;
}

function getOpenAIClient(): OpenAI | null {
  // OpenAI direct client — used as fallback only
  if (!openaiClient) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    if (!apiKey) {
      return null;
    }
    openaiClient = new OpenAI({ apiKey, baseURL, timeout: 30_000, maxRetries: 1 });
  }
  return openaiClient;
}

// ============================================
// DB-DRIVEN MODEL CONFIG CACHE
// ============================================

interface DbModelConfig {
  modelId: string;
  displayName: string;
  taskTypes: string[];
  weight: number;
  maxTokens: number;
}

interface DbModelCache {
  simple: DbModelConfig | null;
  moderate: DbModelConfig | null;
  complex: DbModelConfig | null;
  loadedAt: number;
}

let dbModelCache: DbModelCache | null = null;
const DB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadDbModelConfigs(): Promise<DbModelCache> {
  if (dbModelCache && Date.now() - dbModelCache.loadedAt < DB_CACHE_TTL_MS) {
    return dbModelCache;
  }
  try {
    const { db } = await import('../db');
    const { aiModelConfigs } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const configs = await db.select().from(aiModelConfigs).where(eq(aiModelConfigs.enabled, true));

    const findBestForTask = (tasks: string[]): DbModelConfig | null => {
      let best: DbModelConfig | null = null;
      let bestWeight = -1;
      for (const cfg of configs) {
        const types = cfg.taskTypes || [];
        const matches = tasks.some(t => types.includes(t)) || types.length === 0;
        if (matches && (cfg.weight || 0) > bestWeight) {
          bestWeight = cfg.weight || 0;
          best = {
            modelId: cfg.modelId,
            displayName: cfg.displayName,
            taskTypes: types,
            weight: cfg.weight || 50,
            maxTokens: cfg.maxTokens || 4096,
          };
        }
      }
      return best;
    };

    dbModelCache = {
      simple: findBestForTask(SIMPLE_TASKS),
      moderate: findBestForTask(["basic_analysis", "draft_email"]),
      complex: findBestForTask(COMPLEX_TASKS),
      loadedAt: Date.now(),
    };
    return dbModelCache;
  } catch {
    return { simple: null, moderate: null, complex: null, loadedAt: Date.now() };
  }
}

export function invalidateDbModelCache(): void {
  dbModelCache = null;
}

export function classifyTaskComplexity(taskType: string, contentLength?: number): TaskComplexity {
  const normalizedTask = taskType.toLowerCase().replace(/[-_\s]/g, "_");

  // CRITICAL check first — Opus 4.8 for highest-stakes tasks only
  if (CRITICAL_TASKS.some(t => normalizedTask.includes(t))) {
    return TaskComplexity.CRITICAL;
  }

  if (SIMPLE_TASKS.some(t => normalizedTask.includes(t))) {
    return TaskComplexity.SIMPLE;
  }

  if (COMPLEX_TASKS.some(t => normalizedTask.includes(t))) {
    return TaskComplexity.COMPLEX;
  }

  if (contentLength !== undefined) {
    if (contentLength < 500) {
      return TaskComplexity.SIMPLE;
    }
    if (contentLength > 3000) {
      return TaskComplexity.COMPLEX;
    }
  }

  return TaskComplexity.MODERATE;
}

export function classifyFromMessages(
  taskType: string,
  messages: Array<{ role: string; content: string }>,
  hasFileAttachments: boolean = false
): TaskComplexity {
  const totalContent = messages.map(m => m.content).join(" ");
  const contentLength = totalContent.length;
  
  // Document-based tasks with file attachments are always COMPLEX
  // This ensures GPT-4o is used for better document understanding
  if (hasFileAttachments) {
    const documentActionIndicators = [
      /add.*propert/i,
      /create.*propert/i,
      /import/i,
      /extract/i,
      /parse/i,
      /set.*up/i,
      /upload/i,
      /process.*file/i,
      /from.*document/i,
      /from.*file/i,
      /attached/i,
      /inventory/i,
    ];
    
    if (documentActionIndicators.some(pattern => pattern.test(totalContent))) {
      return TaskComplexity.COMPLEX;
    }
  }
  
  // Check for file content markers in the message
  if (totalContent.includes("--- File:") || totalContent.includes("[Attached files:")) {
    return TaskComplexity.COMPLEX;
  }
  
  const complexIndicators = [
    /analyze.*multiple/i,
    /compare.*options/i,
    /evaluate.*risk/i,
    /develop.*strategy/i,
    /assess.*value/i,
    /create.*plan/i,
    /recommend.*best/i,
    /explain.*reasoning/i,
    /step.*by.*step/i,
    /comprehensive/i,
    /detailed.*analysis/i,
    /bulk.*import/i,
    /batch.*create/i,
    /multiple.*properties/i,
    /these.*\d+.*properties/i,
  ];
  
  const isComplexContent = complexIndicators.some(pattern => pattern.test(totalContent));
  
  if (isComplexContent) {
    return TaskComplexity.COMPLEX;
  }
  
  return classifyTaskComplexity(taskType, contentLength);
}

export function selectProviderAndModel(
  complexity: TaskComplexity,
  config: AIRouterConfig = {},
  dbModel?: string
): { provider: AIProvider; model: string; client: OpenAI } {
  // All requests go through OpenRouter by default
  const openrouter = getOpenRouterClient();
  const openai = getOpenAIClient();

  // Use DB-driven model if provided
  if (dbModel && openrouter) {
    return { provider: AIProvider.OPENROUTER, model: dbModel, client: openrouter };
  }

  // Pin to a specific model (useful for vision / reasoning overrides)
  if (config.forceModel && openrouter) {
    return { provider: AIProvider.OPENROUTER, model: config.forceModel, client: openrouter };
  }
  if (config.useCritical && openrouter) {
    return { provider: AIProvider.OPENROUTER, model: MODEL_CRITICAL, client: openrouter };
  }
  if (config.useVision && openrouter) {
    return { provider: AIProvider.OPENROUTER, model: MODEL_VISION, client: openrouter };
  }
  if (config.useReasoning && openrouter) {
    return { provider: AIProvider.OPENROUTER, model: MODEL_REASONING, client: openrouter };
  }

  // forcePremium → Sonnet 4.6 via OpenRouter
  if (config.forceProvider === AIProvider.OPENAI || config.forcePremium) {
    if (openrouter) {
      return {
        provider: AIProvider.OPENROUTER,
        model: complexity === TaskComplexity.CRITICAL ? MODEL_CRITICAL
             : complexity === TaskComplexity.COMPLEX  ? MODEL_COMPLEX
             : MODEL_MODERATE,
        client: openrouter,
      };
    }
    if (openai) {
      return {
        provider: AIProvider.OPENAI,
        model: complexity === TaskComplexity.SIMPLE ? "gpt-4o-mini" : "gpt-4o",
        client: openai,
      };
    }
    throw new Error("No AI provider available");
  }

  // Default routing:
  //   CRITICAL → Opus 4.8     (highest-stakes: contracts, legal, capital allocation)
  //   COMPLEX  → Sonnet 4.6   (complex analysis, deals, valuations)
  //   MODERATE → Haiku 4.5    (balanced: analysis, drafting, research)
  //   SIMPLE   → DeepSeek     (templates, lookups, formatting)
  if (openrouter) {
    const model = complexity === TaskComplexity.CRITICAL
      ? MODEL_CRITICAL
      : complexity === TaskComplexity.COMPLEX
      ? MODEL_COMPLEX
      : complexity === TaskComplexity.MODERATE
      ? MODEL_MODERATE
      : MODEL_SIMPLE;
    return { provider: AIProvider.OPENROUTER, model, client: openrouter };
  }

  // Final fallback: direct OpenAI
  if (openai) {
    return {
      provider: AIProvider.OPENAI,
      model: complexity === TaskComplexity.SIMPLE ? "gpt-4o-mini" : "gpt-4o",
      client: openai,
    };
  }

  throw new Error("No AI providers available - configure OPENROUTER_API_KEY or OPENAI_API_KEY");
}

export async function selectProviderAndModelAsync(
  complexity: TaskComplexity,
  taskType: string,
  config: AIRouterConfig = {}
): Promise<{ provider: AIProvider; model: string; client: OpenAI; maxTokens: number }> {
  // Load DB model configs
  const dbConfig = await loadDbModelConfigs();
  // CRITICAL bypasses DB config — always uses MODEL_CRITICAL (Opus 4.8)
  const dbModel = complexity === TaskComplexity.CRITICAL
    ? null
    : complexity === TaskComplexity.COMPLEX
    ? dbConfig.complex
    : complexity === TaskComplexity.SIMPLE
    ? dbConfig.simple
    : dbConfig.moderate;

  const { provider, model, client } = selectProviderAndModel(
    complexity,
    config,
    dbModel?.modelId
  );
  return { provider, model, client, maxTokens: dbModel?.maxTokens || 4096 };
}

export interface AIResponse {
  content: string;
  provider: AIProvider;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  estimatedCost?: number;
  /**
   * Phase 4 W21-22 — prompt versioning A/B harness (Nadia-AI §2.A).
   * Stamped onto every response when the caller used routeWithRegisteredPrompt.
   * Tells downstream observers (eval harness, analytics) which prompt version
   * served the request so A/B deltas can be computed.
   */
  promptVersion?: { promptName: string; version: string; hash: string; isCandidate: boolean };
  /**
   * Model self-reported confidence in its own answer, in [0, 1].
   *
   * - A `number` 0..1 means the model populated a real `confidence` field as
   *   part of generation (requires the caller to set `task.requestConfidence`).
   * - `null` means confidence was REQUESTED but the model omitted or malformed
   *   it — an honest "not measured", never a fabricated constant.
   * - `undefined` means the caller never requested it (feature off).
   *
   * This is the primary, model-derived confidence signal that replaces the
   * hand-coded Pax confidence constants.
   */
  confidence?: number | null;
}

/**
 * Instruction appended to the system prompt when a caller requests model
 * self-reported confidence. Kept terse so it costs few tokens.
 */
export const CONFIDENCE_SCHEMA_INSTRUCTION =
  "Return your answer as a single JSON object. In addition to your normal " +
  "fields, include a top-level numeric field \"confidence\" in the range 0.0 to " +
  "1.0 expressing how confident you are that your answer is correct and " +
  "complete (1.0 = certain, 0.0 = pure guess). Base it on the strength of the " +
  "evidence you actually used, not on politeness. Output JSON only.";

/**
 * Pure extraction of a model self-reported confidence value from a raw
 * response body. Returns:
 *   - a number in [0, 1] when the model emitted a valid `confidence` field,
 *   - `null` when confidence was requested but is absent/malformed/out-of-range
 *     (honest "not measured" — never a constant).
 *
 * Exported for direct unit testing of the parse contract.
 */
export function extractModelConfidence(content: string): number | null {
  if (!content) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    // Tolerate a JSON object embedded in surrounding prose.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      raw = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>).confidence;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

/**
 * Estimate the USD cost of a call. Prices come from the single source of truth
 * (models.priceFor → aiCostRates.AI_COST_RATES) — the same table computeCostUsd
 * uses for the authoritative ledger, so an estimate and the later actual can
 * only differ on token-count accuracy, never on pricing.
 *
 * The OLD private table here was keyed to stale Opus pricing ($15/$75 vs the
 * real $5/$25 — 3× wrong) and unkeyed models fell back to a silent
 * {input:1,output:3}. Now: known models (every id in models.MODELS) get their
 * real rate; an UNKNOWN model is logged once (so a routing bug surfaces) and
 * still costed via the central conservative DEFAULT_RATE — never a private,
 * separately-maintained guess.
 */
export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedInputTokens: number = 0,
): number {
  if (model && model !== "cache" && !isKnownModel(model)) {
    logger.warn("[AIRouter] estimateCost: unknown model — costing via central DEFAULT_RATE", {
      metadata: { model },
    });
  }
  if (!Number.isFinite(promptTokens) || promptTokens < 0) promptTokens = 0;
  if (!Number.isFinite(completionTokens) || completionTokens < 0) completionTokens = 0;
  if (!Number.isFinite(cachedInputTokens) || cachedInputTokens < 0) cachedInputTokens = 0;

  const costs = priceFor(model);
  // Mirror computeCostUsd: the cached portion of the prompt bills at the
  // discounted Anthropic prompt-cache READ rate (~0.1× input). Without this,
  // cache-warmed calls were charged all prompt tokens at the full input rate —
  // up to ~8× overcharge on heavily-cached calls.
  const freshInput = Math.max(0, promptTokens - cachedInputTokens);
  const cachedRate = costs.cachedInput ?? costs.input;
  const inputUsd = (freshInput * costs.input + cachedInputTokens * cachedRate) / 1_000_000;
  const outputUsd = (completionTokens * costs.output) / 1_000_000;
  return inputUsd + outputUsd;
}

export async function routeAITask(
  task: AITask,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  // Shorthand: callers that pass `task: "prompt string"` instead of building
  // a messages array get auto-converted to a single-turn user message.
  // taskType defaults to "ad_hoc" when not set so cache + telemetry keys
  // don't break.
  if (!task.messages || task.messages.length === 0) {
    const promptText = (task as AITask & { task?: string }).task;
    task = {
      ...task,
      messages: promptText ? [{ role: "user", content: promptText }] : (task.messages ?? []),
      taskType: task.taskType ?? "ad_hoc",
    };
  }

  // ── Phase 3 Week 9: per-org daily AI USD quota gate ─────────────────────────
  // Runs BEFORE the cache check so that even cached responses respect the cap
  // (a $0 cached call still counts as a call, but does not advance spend).
  // Specifically the cache hit cost is 0, so we only need to check — not record.
  if (config.orgId && !config.skipQuota) {
    let cap = config.orgQuotaCapUsd;
    if (cap === undefined) {
      try {
        const { getOrgQuotaCap } = await import("./aiQuotaService");
        cap = await getOrgQuotaCap(config.orgId);
      } catch (err) {
        logger.warn("[AIRouter] failed to read org AI quota cap — allowing call", {
          metadata: { orgId: config.orgId, detail: err instanceof Error ? err.message : err },
        });
        cap = 0; // fail-open: treat as unlimited if DB lookup blew up
      }
    }
    if (cap && cap > 0) {
      try {
        await checkQuota(config.orgId, cap);
      } catch (err) {
        if (err instanceof AIQuotaExceeded) {
          logger.warn("[AIRouter] org hit daily AI quota", {
            metadata: { orgId: config.orgId, used: err.usedUsdToday, cap: err.capUsd },
          });
        }
        throw err;
      }
    }
  }

  // ── Platform-wide AI cost ceiling (the outer envelope) ─────────────────────
  // Sums all `ai_telemetry_events.estimated_cost_cents` in the last 24h and
  // throws AiCostCeilingExceededError if past AI_PLATFORM_DAILY_CEILING_CENTS
  // (default $15/day — set just above the summed soft budgets so it remains
  // the binding master limit when those gates fail open under DB load). This
  // is the hard fail-CLOSED backstop that prevents the runaway $30/day
  // scenario regardless of which surface initiated the call, and ALWAYS runs
  // (no skipBudget bypass). Per-org ceiling also enforced when orgId is set.
  if (!config.skipQuota) {
    try {
      const { assertWithinAiCostCeiling } = await import("./aiCostCeiling");
      await assertWithinAiCostCeiling(config.orgId ?? null);
    } catch (err) {
      if ((err as { code?: string })?.code === "AI_COST_CEILING_EXCEEDED") throw err;
      logger.warn("[AIRouter] cost ceiling check failed — allowing call", {
        metadata: { detail: err instanceof Error ? err.message : err },
      });
    }
  }

  // ── Frugal Autonomy: platform-wide per-category daily budget gate ───────────
  // Sits in front of the cache check so even cache misses get blocked when
  // the day's spend has exhausted the category. Fail-open on DB hiccups —
  // see intelligence/budget.ts. Callers (autonomous jobs) catch
  // BudgetExceededError and defer the work; interactive calls bubble up
  // and let the founder see what was refused.
  if (!config.skipBudget) {
    try {
      const { categoryFor, checkBudget, BudgetExceededError } = await import(
        "./intelligence/budget"
      );
      const category = categoryFor(task.taskType ?? "ad_hoc");
      const { withinBudget, capCents, spentCents } = await checkBudget(category);
      if (!withinBudget) {
        throw new BudgetExceededError(category, capCents, spentCents);
      }
    } catch (err) {
      // Re-throw budget errors so callers can defer; swallow any other
      // unexpected error so the platform doesn't deadlock on a budget
      // module bug.
      if ((err as { name?: string })?.name === "BudgetExceededError") {
        throw err;
      }
      logger.warn("[AIRouter] budget check failed — allowing call", {
        metadata: { taskType: task.taskType, detail: err instanceof Error ? err.message : err },
      });
    }
  }

  // ── Layer 1: Exact-match cache ───────────────────────────────────────────────
  const isCacheable = task.complexity !== TaskComplexity.COMPLEX
    && task.complexity !== TaskComplexity.CRITICAL
    && (task.temperature ?? 0.7) <= 0.3;
  let cacheKey = '';
  const cacheCheckStart = Date.now();

  if (isCacheable) {
    cacheKey = getCacheKey(task);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      cacheHits++;
      const cacheHitLatency = Date.now() - cacheCheckStart;
      logger.info(`[AIRouter] Cache HIT (exact) for ${task.taskType}`);
      recordAITelemetry({ orgId: config.orgId, taskType: task.taskType ?? "unknown", provider: cached.provider, model: cached.model, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostCents: 0, latencyMs: cacheHitLatency, cacheHit: true, complexity: task.complexity, success: true });
      // Pillar 7 — cascade telemetry: cache hits are model="cache".
      void recordCascadeCall({
        organizationId: config.orgId ?? null,
        model: "cache",
        complexityClass: complexityClassFromTaskType(task.taskType),
        feature: task.taskType || "unknown",
        promptTokens: 0,
        cachedInputTokens: 0,
        completionTokens: 0,
        costCents: 0,
        latencyMs: cacheHitLatency,
        cacheHit: true,
      });
      return { content: cached.content, provider: cached.provider, model: cached.model, usage: cached.usage, estimatedCost: 0, confidence: task.requestConfidence ? extractModelConfidence(cached.content) : undefined };
    }

    // ── Layer 2: Semantic dedup cache (catches paraphrased queries) ────────────
    const semanticHit = findSemanticCacheHit(task);
    if (semanticHit) {
      semanticCacheHits++;
      const semanticLatency = Date.now() - cacheCheckStart;
      logger.info(`[AIRouter] Cache HIT (semantic) for ${task.taskType}`);
      recordAITelemetry({ orgId: config.orgId, taskType: task.taskType ?? "unknown", provider: semanticHit.provider, model: semanticHit.model, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostCents: 0, latencyMs: semanticLatency, cacheHit: true, complexity: task.complexity, success: true });
      void recordCascadeCall({
        organizationId: config.orgId ?? null,
        model: "cache",
        complexityClass: complexityClassFromTaskType(task.taskType),
        feature: task.taskType || "unknown",
        promptTokens: 0,
        cachedInputTokens: 0,
        completionTokens: 0,
        costCents: 0,
        latencyMs: semanticLatency,
        cacheHit: true,
      });
      return { content: semanticHit.content, provider: semanticHit.provider, model: semanticHit.model, usage: semanticHit.usage, estimatedCost: 0, confidence: task.requestConfidence ? extractModelConfidence(semanticHit.content) : undefined };
    }

    cacheMisses++;
  }

  // ── Model selection ──────────────────────────────────────────────────────────
  const startTime = Date.now();
  let { provider, model, client, maxTokens: dbMaxTokens } = await selectProviderAndModelAsync(task.complexity, task.taskType ?? "ad_hoc", config);

  // ── Wave 8 — Tier-based override ───────────────────────────────────────────
  // Resolution order:
  //   1. Hard pins win (forceModel, useCritical, useVision, useReasoning,
  //      forcePremium, useExtendedThinking) — leave model unchanged.
  //   2. ai_routing_overrides table — eval-gated rollback wins over caller tier.
  //   3. config.taskTier — router-config tier (callsite wrapper).
  //   4. task.taskTier — task-level tier.
  // Tier 'critical' → Sonnet 4.6, 'standard'/'background' → Haiku 4.5.
  // The AI_HAIKU_DEFAULT_ENABLED env var can force every tier to Sonnet.
  const hasHardPin = !!(config.forceModel || config.useCritical || config.useVision
    || config.useReasoning || config.forcePremium || task.useExtendedThinking);
  if (!hasHardPin) {
    const overrides = await loadRoutingOverrides();
    const override = overrides.byTaskType.get(task.taskType ?? "ad_hoc");
    if (override) {
      const overrideModel = override.overrideModel || modelForTier(override.overrideTier);
      logger.info(`[AIRouter] Tier override active for ${task.taskType}: ${override.reason} → ${overrideModel}`);
      model = overrideModel;
    } else {
      const tier = config.taskTier ?? task.taskTier;
      if (tier) {
        model = modelForTier(tier);
      }
    }
  }
  logger.info(`[AIRouter] Routing ${task.taskType} (${task.complexity}) → ${provider}/${model}`);

  // ── Primary generation ───────────────────────────────────────────────────────
  let content = '';
  let usage: any;
  let finalModel = model;
  let openrouterResponseId: string | null = null;
  let cachedInputTokens = 0;
  // Tracks whether the caller asked for model self-reported confidence AND we
  // were able to ask for it (extended thinking disables it). Confidence is
  // extracted from the FINAL content (post-cascade) below.
  let confidenceRequested = false;

  try {
    // ── Prompt caching: annotate system message with cache_control when eligible ─
    // OpenRouter passes this to Anthropic's prompt caching API.
    // Eligible: Anthropic models, system prompt ≥ ~1024 *tokens* (~4096 chars).
    // Wave 8: caching is now AUTO-ENABLED on every Anthropic call whose system
    // prompt clears the threshold — no callsite needs to opt in. Callsites
    // can still force-disable by setting enablePromptCaching === false.
    // Cache discount: ~90% on the cached portion (write: 1.25× base, read: 0.1× base).
    //
    // Token estimate: Anthropic's tokenizer averages ~3.7 chars/token for
    // English; we use 4 as a conservative ceiling, so 4096 chars ≈ 1024 tokens.
    const isAnthropicModel = model.startsWith("anthropic/");
    const systemMsg = task.messages?.find(m => m.role === "system");
    const systemLength = systemMsg?.content?.length || 0;
    const ANTHROPIC_CACHE_MIN_CHARS = 4096; // ≈ 1024 tokens at 4 chars/token
    const cacheEligible = isAnthropicModel && systemLength >= ANTHROPIC_CACHE_MIN_CHARS;
    // Honor explicit opt-out (false) but otherwise auto-enable when eligible.
    const shouldCache = task.enablePromptCaching === false
      ? false
      : cacheEligible;

    // ── Extended thinking: for valuation/financial/legal reasoning ──────────────
    // Uses Sonnet 4.6's extended thinking mode for deeper chain-of-thought.
    // Only applies to Anthropic models that support it.
    const useThinking = task.useExtendedThinking && isAnthropicModel;
    const thinkingBudget = task.thinkingBudget || 8000;

    // ── Model self-reported confidence (PRIMARY confidence signal) ──────────────
    // When requested, append a schema instruction asking the model to emit a
    // top-level `confidence` (0..1) as part of generation, and force JSON mode
    // so it's parseable. Incompatible with extended thinking (no response_format
    // there) — in that case we skip augmentation and surface honest-null below.
    const wantsConfidence = task.requestConfidence === true && !useThinking;
    confidenceRequested = task.requestConfidence === true;
    let baseMessages = task.messages ?? [];
    if (wantsConfidence) {
      const sysIdx = baseMessages.findIndex(m => m.role === "system");
      if (sysIdx >= 0) {
        baseMessages = baseMessages.map((m, i) =>
          i === sysIdx
            ? { ...m, content: `${m.content}\n\n${CONFIDENCE_SCHEMA_INSTRUCTION}` }
            : m,
        );
      } else {
        baseMessages = [
          { role: "system" as const, content: CONFIDENCE_SCHEMA_INSTRUCTION },
          ...baseMessages,
        ];
      }
    }

    const messagesPayload = shouldCache
      ? baseMessages.map(m =>
          m.role === "system"
            ? { ...m, cache_control: { type: "ephemeral" } }
            : m
        )
      : baseMessages;

    const requestBody: any = {
      model,
      messages: messagesPayload,
      max_tokens: task.maxTokens || dbMaxTokens || (useThinking ? 16000 : 4096),
      temperature: useThinking ? 1 : (task.temperature ?? 0.7), // thinking requires temp=1
      // Confidence requests force JSON mode so the `confidence` field is parseable.
      ...((task.responseFormat === "json" || wantsConfidence) && !useThinking && { response_format: { type: "json_object" } }),
      ...(useThinking && { thinking: { type: "enabled", budget_tokens: thinkingBudget } }),
    };

    const response = await client.chat.completions.create(requestBody);
    // Extended thinking returns content blocks — extract text block
    const rawContent = response.choices[0]?.message?.content;
    if (Array.isArray(rawContent)) {
      content = rawContent
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
    } else {
      content = rawContent || "";
    }
    usage = response.usage;
    openrouterResponseId = (response as any).id ?? null;
    // OpenRouter passes Anthropic prompt-cache token counts through under
    // prompt_tokens_details.cached_tokens (OpenAI-compatible field).
    cachedInputTokens =
      (usage as any)?.prompt_tokens_details?.cached_tokens
      ?? (usage as any)?.cache_read_input_tokens
      ?? 0;
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    recordAITelemetry({ orgId: config.orgId, taskType: task.taskType ?? "unknown", provider, model, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostCents: 0, latencyMs, cacheHit: false, complexity: task.complexity, success: false, errorMessage: err.message });
    void recordCascadeCall({
      organizationId: config.orgId ?? null,
      model,
      complexityClass: complexityClassFromTaskType(task.taskType),
      feature: task.taskType || "unknown",
      latencyMs,
      cacheHit: false,
      errorClass: classifyAiError(err),
    });
    throw err;
  }

  // ── Model cascade: quality-gate escalation ───────────────────────────────────
  // Only cascade on non-complex tasks where we used a cheap model and the user
  // hasn't explicitly pinned a model.  Skipped when CASCADE_ENABLED = false.
  if (
    isCascadeEnabled() &&
    task.complexity !== TaskComplexity.COMPLEX &&
    task.complexity !== TaskComplexity.CRITICAL && // already top tier
    !config.forceModel && !config.forcePremium && !config.useVision && !config.useReasoning && !config.useCritical &&
    content.length > 20 // don't bother checking trivially short responses
  ) {
    const quality = await checkResponseQuality(task, content, client);

    if (quality.shouldEscalate) {
      // Determine the next tier model
      // Cascade: DeepSeek → Haiku → Sonnet (never auto-escalate to Opus — too costly)
      const escalatedModel =
        model === MODEL_SIMPLE   ? MODEL_MODERATE :
        model === MODEL_MODERATE ? MODEL_COMPLEX  :
        null; // Sonnet is the ceiling for auto-cascade; Opus requires explicit routing

      if (escalatedModel) {
        logger.info(`[AIRouter] Cascade escalating ${task.taskType}: score=${quality.score}/10 "${quality.reason}" → ${escalatedModel}`);
        try {
          // Re-augment with the confidence instruction so the escalated model
          // also emits a `confidence` field when the caller requested it.
          const escalatedMessages = (() => {
            const base = task.messages ?? [];
            if (!confidenceRequested) return base;
            const sysIdx = base.findIndex(m => m.role === "system");
            if (sysIdx >= 0) {
              return base.map((m, i) =>
                i === sysIdx
                  ? { ...m, content: `${m.content}\n\n${CONFIDENCE_SCHEMA_INSTRUCTION}` }
                  : m,
              );
            }
            return [{ role: "system" as const, content: CONFIDENCE_SCHEMA_INSTRUCTION }, ...base];
          })();
          const escalatedResponse = await client.chat.completions.create({
            model: escalatedModel,
            messages: escalatedMessages,
            max_tokens: task.maxTokens || dbMaxTokens || 4096,
            temperature: task.temperature ?? 0.7,
            ...((task.responseFormat === "json" || confidenceRequested) && { response_format: { type: "json_object" } }),
          });
          const escalatedContent = escalatedResponse.choices[0]?.message?.content || "";
          if (escalatedContent.length > content.length * 0.5) {
            content = escalatedContent;
            usage = escalatedResponse.usage;
            finalModel = escalatedModel;
            // The escalated call carries no cache_control, so its prompt is
            // billed entirely fresh. Read the escalated cached count (normally
            // 0) rather than leaking the primary model's cache discount onto a
            // different model that never warmed it.
            cachedInputTokens =
              (escalatedResponse.usage as any)?.prompt_tokens_details?.cached_tokens
              ?? (escalatedResponse.usage as any)?.cache_read_input_tokens
              ?? 0;
          }
        } catch (escalationErr) {
          logger.warn(`[AIRouter] Cascade escalation failed, using original response`, { metadata: { detail: escalationErr } });
          // Stick with original content — fail gracefully
        }
      }
    }
  }

  // ── Build result ─────────────────────────────────────────────────────────────
  const latencyMs = Date.now() - startTime;
  const costEstimate = usage ? estimateCost(finalModel, usage.prompt_tokens, usage.completion_tokens, cachedInputTokens) : 0;

  // Extract the model self-reported confidence from the FINAL content (after
  // any cascade replacement). When requested but absent/malformed → honest null.
  // When not requested → undefined (feature off).
  const modelConfidence: number | null | undefined = confidenceRequested
    ? extractModelConfidence(content)
    : undefined;

  const result: AIResponse = {
    content,
    provider,
    model: finalModel,
    usage: usage ? {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    } : undefined,
    estimatedCost: costEstimate,
    confidence: modelConfidence,
  };

  // ── Store in both cache layers ───────────────────────────────────────────────
  if (isCacheable && cacheKey && content) {
    const queryText = (task.messages ?? []).map(m => m.content).join(" ");
    setCachedResponse(cacheKey, {
      ...result,
      cachedAt: Date.now(),
      queryTokens: tokenize(queryText),
    });
  }

  recordAITelemetry({
    orgId: config.orgId,
    taskType: task.taskType ?? "unknown",
    provider,
    model: finalModel,
    promptTokens: usage?.prompt_tokens || 0,
    completionTokens: usage?.completion_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
    estimatedCostCents: Math.round(costEstimate * 100),
    latencyMs,
    cacheHit: false,
    complexity: task.complexity,
    success: true,
  });
  // Structured per-call cost line — `[ai-cost]` is the canonical grep
  // prefix for cost forensics in Fly logs. Tom can `fly logs | grep
  // [ai-cost]` to see every paid call in real time. Surface tag lets him
  // attribute spend by surface/provider/model at a glance.
  logger.info("[ai-cost]", {
    metadata: {
      surface: "aiRouter",
      taskType: task.taskType ?? "unknown",
      provider,
      model: finalModel,
      orgId: config.orgId ?? null,
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      costUsd: Number(costEstimate.toFixed(4)),
      latencyMs,
    },
  });

  // Pillar 7 — cascade telemetry + financial_ledger debit. Fire-and-forget;
  // any failure logs inside ai-telemetry.ts but never breaks the caller.
  void recordCascadeCall({
    organizationId: config.orgId ?? null,
    model: finalModel,
    complexityClass: complexityClassFromTaskType(task.taskType),
    feature: task.taskType || "unknown",
    promptTokens: usage?.prompt_tokens ?? 0,
    cachedInputTokens,
    completionTokens: usage?.completion_tokens ?? 0,
    costCents: costEstimate * 100,
    latencyMs,
    cacheHit: false,
    openrouterResponseId,
  });

  // ── Phase 3 Week 9: increment per-org daily usage ───────────────────────────
  // Use the central aiCostRates calculator for consistency with the founder
  // dashboard rollups. Token-level cost is the source of truth — `costEstimate`
  // above is computed from the same per-million rates and only differs when an
  // unknown model falls back to the conservative DEFAULT_RATE.
  if (config.orgId && !config.skipQuota && usage) {
    const usdAuthoritative = computeCostUsd(
      finalModel,
      usage.prompt_tokens || 0,
      usage.completion_tokens || 0,
      cachedInputTokens,
    );
    // Fire-and-forget; recordUsage swallows its own errors.
    void recordUsage(config.orgId, usdAuthoritative, task.taskType ?? "unknown");
  }

  return result;
}

export async function routeSimpleTask(
  systemPrompt: string,
  userPrompt: string,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  return routeAITask({
    taskType: "simple_task",
    complexity: TaskComplexity.SIMPLE,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, config);
}

export async function routeComplexTask(
  systemPrompt: string,
  userPrompt: string,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  return routeAITask({
    taskType: "complex_task",
    complexity: TaskComplexity.COMPLEX,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, config);
}

export async function generateWithAutoRouting(
  taskType: string,
  systemPrompt: string,
  userPrompt: string,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];
  const complexity = classifyFromMessages(taskType, messages);
  return routeAITask({
    taskType,
    complexity,
    messages,
  }, config);
}

/** Route a task that requires vision (e.g. satellite imagery, document parsing). */
export async function routeVisionTask(
  systemPrompt: string,
  userPrompt: string,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  return routeAITask({
    taskType: "vision_analysis",
    complexity: TaskComplexity.COMPLEX,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, { ...config, useVision: true });
}

/** Route a task that requires deep chain-of-thought reasoning (DeepSeek R1). */
export async function routeReasoningTask(
  taskType: string,
  systemPrompt: string,
  userPrompt: string,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  return routeAITask({
    taskType,
    complexity: TaskComplexity.COMPLEX,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, { ...config, useReasoning: true });
}

/**
 * Route a CRITICAL task to Opus 4.8 — highest-stakes decisions only.
 * Use for: contract review, legal document drafting, capital allocation,
 * note securitization, regulatory compliance determinations.
 *
 * COST WARNING: Opus 4.8 ($5/$25 per 1M) is ~1.7× the cost of Sonnet 4.6
 * ($3/$15). Only use when the quality ceiling genuinely matters.
 */
export async function routeCriticalTask(
  taskType: string,
  systemPrompt: string,
  userPrompt: string,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  return routeAITask({
    taskType,
    complexity: TaskComplexity.CRITICAL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    enablePromptCaching: systemPrompt.length >= 1024, // cache large system prompts
  }, { ...config, useCritical: true });
}

/**
 * Route a task using Claude Sonnet 4.6 extended thinking.
 * Best for: multi-step financial modeling, valuation cross-checks,
 * legal reasoning, complex deal structuring.
 *
 * Extended thinking uses a scratchpad of reasoning tokens (not billed to output)
 * before producing the final answer — dramatically better on hard reasoning tasks.
 */
export async function routeExtendedThinkingTask(
  taskType: string,
  systemPrompt: string,
  userPrompt: string,
  thinkingBudget: number = 8000,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  return routeAITask({
    taskType,
    complexity: TaskComplexity.COMPLEX,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    useExtendedThinking: true,
    thinkingBudget,
    enablePromptCaching: systemPrompt.length >= 1024,
  }, config);
}

export function getAvailableProviders(): AIProvider[] {
  const providers: AIProvider[] = [];
  if (getOpenRouterClient()) providers.push(AIProvider.OPENROUTER);
  if (getOpenAIClient()) providers.push(AIProvider.OPENAI);
  return providers;
}

export function getProviderStatus(): Record<AIProvider, boolean> {
  return {
    [AIProvider.OPENROUTER]: !!getOpenRouterClient(),
    [AIProvider.OPENAI]: !!getOpenAIClient(),
  };
}

/** Return DB model configs for founder dashboard display */
export async function getDbModelConfigs() {
  try {
    const { db } = await import('../db');
    const { aiModelConfigs } = await import('@shared/schema');
    return db.select().from(aiModelConfigs).orderBy(aiModelConfigs.weight);
  } catch {
    return [];
  }
}

// ============================================
// AI TELEMETRY (async, non-blocking)
// ============================================

interface TelemetryPayload {
  orgId?: number;
  taskType: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCents: number;
  latencyMs: number;
  cacheHit: boolean;
  complexity: string;
  success: boolean;
  errorMessage?: string;
}

// ============================================
// EVAL QUALITY GATE — Wave 8
//
// When the eval harness scores a tier-routing change <95% match against the
// previous run's scores, applyEvalQualityGate auto-rollbacks the tier change
// for the affected callsite by writing to ai_routing_overrides.
//
// The hook is defensive: any DB failure logs and returns gracefully so the
// eval harness itself never blocks on a rollback write.
// ============================================

export interface EvalGateInput {
  taskType: string;
  originalTier: TaskTier;
  newTier: TaskTier;
  previousScore: number; // 0-1
  newScore: number;      // 0-1
  /** Match-ratio threshold below which we auto-rollback. Default 0.95. */
  threshold?: number;
}

export interface EvalGateResult {
  rolledBack: boolean;
  reason: string;
  ratio: number;
}

export async function applyEvalQualityGate(input: EvalGateInput): Promise<EvalGateResult> {
  const threshold = input.threshold ?? 0.95;
  if (input.previousScore <= 0) {
    return { rolledBack: false, reason: "no previous score baseline", ratio: 1 };
  }
  const ratio = input.newScore / input.previousScore;
  if (ratio >= threshold) {
    return { rolledBack: false, reason: `quality preserved (${ratio.toFixed(3)} ≥ ${threshold})`, ratio };
  }

  const reason = `eval_quality_regression:${input.newScore.toFixed(3)}/${input.previousScore.toFixed(3)} ratio=${ratio.toFixed(3)}`;
  try {
    const { db } = await import("../db");
    const { aiRoutingOverrides } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    // Retire any active override for this taskType so the unique index holds.
    await db.update(aiRoutingOverrides)
      .set({ active: false })
      .where(eq(aiRoutingOverrides.taskType, input.taskType));
    await db.insert(aiRoutingOverrides).values({
      id: crypto.randomUUID(),
      taskType: input.taskType,
      originalTier: input.newTier,         // the tier that just regressed
      overrideTier: input.originalTier,    // pin back to the safer prior tier
      overrideModel: null,
      reason,
      previousEvalScore: input.previousScore.toFixed(4),
      newEvalScore: input.newScore.toFixed(4),
      active: true,
    });
    invalidateRoutingOverrideCache();
    logger.warn(`[AIRouter] Eval quality gate rolled back ${input.taskType}: ${reason}`);
    return { rolledBack: true, reason, ratio };
  } catch (err) {
    logger.error(`[AIRouter] Eval quality gate write failed for ${input.taskType}`, err as Error);
    return { rolledBack: false, reason: `db_error:${(err as Error)?.message || "unknown"}`, ratio };
  }
}

// ============================================================================
// Phase 4 W21-22 — prompt-versioning A/B harness (Nadia-AI §2.A).
// Wires the promptRegistry into routeAITask so callsites that opt in get a
// weighted-random version pick + a `promptVersion` stamp on the response.
// ============================================================================

/**
 * Route an AI task using a *registered* prompt name. The registry rolls
 * weighted dice across the active versions for `promptName` and uses the
 * chosen version's `system` text in place of the caller's. The chosen
 * version is stamped onto the response so downstream eval / analytics can
 * compute per-version score deltas.
 *
 * Falls back to the builtin baseline if the registry is empty for that name.
 */
export async function routeWithRegisteredPrompt(
  promptName: string,
  taskType: string,
  userPrompt: string,
  config: AIRouterConfig = {},
): Promise<AIResponse> {
  const { selectVersion } = await import("./promptRegistry");
  const pick = await selectVersion(promptName);
  const messages = [
    { role: "system" as const, content: pick.version.system },
    { role: "user" as const, content: userPrompt },
  ];
  const complexity = classifyFromMessages(taskType, messages);
  const response = await routeAITask(
    {
      taskType,
      complexity,
      messages,
      taskTier: pick.version.tier,
    },
    config,
  );
  return { ...response, promptVersion: pick.stamp };
}

function recordAITelemetry(payload: TelemetryPayload): void {
  // Fire-and-forget: don't block the response
  (async () => {
    try {
      const { db } = await import('../db');
      const { aiTelemetryEvents } = await import('@shared/schema');
      await db.insert(aiTelemetryEvents).values({
        organizationId: payload.orgId || null,
        taskType: payload.taskType,
        provider: payload.provider,
        model: payload.model,
        promptTokens: payload.promptTokens,
        completionTokens: payload.completionTokens,
        totalTokens: payload.totalTokens,
        estimatedCostCents: payload.estimatedCostCents.toString(),
        latencyMs: payload.latencyMs,
        cacheHit: payload.cacheHit,
        complexity: payload.complexity,
        success: payload.success,
        errorMessage: payload.errorMessage || null,
      });
    } catch (err) {
      // Telemetry is non-critical — log and continue
      logger.warn('[AIRouter] Failed to record telemetry', { metadata: { detail: err } });
    }
  })();
}
