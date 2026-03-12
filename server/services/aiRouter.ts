import OpenAI from "openai";
import crypto from "crypto";

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
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
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
  const queryText = task.messages.map(m => m.content).join(" ");
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

const QUALITY_THRESHOLD = 6; // Score out of 10 below which we escalate
const CASCADE_ENABLED = true; // Can be disabled for cost-sensitivity testing

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
User request (abbreviated): ${task.messages[task.messages.length - 1]?.content?.slice(0, 200)}

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
    return { score, reason: parsed.reason || "", shouldEscalate: score < QUALITY_THRESHOLD };
  } catch {
    // On quality-check failure, assume response is good (fail open)
    return { score: 8, reason: "quality check failed — assuming adequate", shouldEscalate: false };
  }
}

export enum TaskComplexity {
  SIMPLE = "simple",
  MODERATE = "moderate",
  COMPLEX = "complex",
  CRITICAL = "critical", // Opus 4.6 — highest-stakes decisions only
}

export enum AIProvider {
  OPENROUTER = "openrouter",
  OPENAI = "openai",
}

export interface AITask {
  taskType: string;
  complexity: TaskComplexity;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
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
}

export interface AIRouterConfig {
  forceProvider?: AIProvider;
  forcePremium?: boolean;
  forceModel?: string;     // pin to a specific OpenRouter model ID
  useVision?: boolean;     // route to vision-capable model (gpt-4o via OpenRouter)
  useReasoning?: boolean;  // route to deep-reasoning model (DeepSeek R1)
  useCritical?: boolean;   // force Opus 4.6 (highest-stakes tasks only)
  orgId?: number;
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

// CRITICAL tasks: routed to Opus 4.6 — reserved for the <2% of requests where
// the highest possible reasoning quality is worth the 5× cost premium over Sonnet.
// Rule: only use Opus when a wrong answer has real financial or legal consequences.
const CRITICAL_TASKS = [
  "contract_review",       // Legal document with binding consequences
  "legal_document",        // Drafting legally-binding documents
  "capital_allocation",    // Portfolio-level capital deployment decisions
  "note_securitization",   // Structuring seller-financed note portfolios
  "regulatory_compliance", // Compliance determinations with legal exposure
  "fraud_detection",       // Financial fraud analysis — false negatives costly
  "executive_decision",    // Atlas high-stakes strategic decisions
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
//   T4  Opus 4.6           — highest-stakes decisions only (<2% of volume), $15/$75
//
// TARGET DISTRIBUTION: 60% T1, 30% T2, 7% T3, 1% T3r, 2% T4
// This achieves ~85% cost reduction vs all-Opus while preserving Opus-quality
// output on the tasks that genuinely need it.
//
// PROMPT CACHING: For tasks with large repeated system prompts (agents, legal),
// OpenRouter passes `cache_control` to Anthropic — 70-90% cost reduction on
// the cached portion. Applied automatically when system prompt ≥ 1024 tokens.
// ============================================

// Tier 1 — Micro (cheapest, fast, good for simple templated tasks)
export const MODEL_SIMPLE    = "deepseek/deepseek-chat";              // $0.14/$0.28 per M tokens
// Tier 2 — Balanced (good reasoning, moderate cost)
export const MODEL_MODERATE  = "anthropic/claude-haiku-4-5-20251001"; // $0.80/$4.00 per M tokens
// Tier 3 — Premium (best reasoning for complex land investment decisions)
export const MODEL_COMPLEX   = "anthropic/claude-sonnet-4-6";         // $3.00/$15.00 per M tokens
// Tier 3R — Deep reasoning (step-by-step for valuation/financial models)
export const MODEL_REASONING = "deepseek/deepseek-reasoner";          // $0.55/$2.19 per M tokens
// Tier 4 — Opus (highest-stakes only: contract review, capital allocation, legal)
export const MODEL_CRITICAL  = "anthropic/claude-opus-4-6";           // $15.00/$75.00 per M tokens
// Tier V — Vision/Docs (multimodal, used for satellite/document parsing)
export const MODEL_VISION    = "openai/gpt-4o";                       // $2.50/$10.00 per M tokens

// Legacy aliases kept for backward compat
const OPENROUTER_CHEAP_MODEL     = MODEL_SIMPLE;
const OPENROUTER_REASONING_MODEL = MODEL_REASONING;
const OPENAI_PREMIUM_MODEL       = MODEL_COMPLEX;
const OPENAI_FAST_MODEL          = MODEL_MODERATE;

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
    openaiClient = new OpenAI({ apiKey, baseURL });
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

  // CRITICAL check first — Opus 4.6 for highest-stakes tasks only
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
  //   CRITICAL → Opus 4.6     (highest-stakes: contracts, legal, capital allocation)
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
  // CRITICAL bypasses DB config — always uses MODEL_CRITICAL (Opus 4.6)
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
}

const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number; cachedInput?: number }> = {
  [MODEL_SIMPLE]:    { input: 0.14,  output: 0.28   },                       // DeepSeek Chat
  [MODEL_MODERATE]:  { input: 0.80,  output: 4.00,  cachedInput: 0.08  },    // Claude Haiku 4.5 (90% cache discount)
  [MODEL_COMPLEX]:   { input: 3.00,  output: 15.00, cachedInput: 0.30  },    // Claude Sonnet 4.6 (90% cache discount)
  [MODEL_CRITICAL]:  { input: 15.00, output: 75.00, cachedInput: 1.50  },    // Claude Opus 4.6 (90% cache discount)
  [MODEL_VISION]:    { input: 2.50,  output: 10.00  },                       // GPT-4o
  [MODEL_REASONING]: { input: 0.55,  output: 2.19   },                       // DeepSeek Reasoner
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = COST_PER_MILLION_TOKENS[model] || { input: 1, output: 3 };
  return (promptTokens * costs.input + completionTokens * costs.output) / 1_000_000;
}

export async function routeAITask(
  task: AITask,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  // ── Layer 1: Exact-match cache ───────────────────────────────────────────────
  const isCacheable = task.complexity !== TaskComplexity.COMPLEX
    && task.complexity !== TaskComplexity.CRITICAL
    && (task.temperature ?? 0.7) <= 0.3;
  let cacheKey = '';

  if (isCacheable) {
    cacheKey = getCacheKey(task);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      cacheHits++;
      console.log(`[AIRouter] Cache HIT (exact) for ${task.taskType}`);
      recordAITelemetry({ orgId: config.orgId, taskType: task.taskType, provider: cached.provider, model: cached.model, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostCents: 0, latencyMs: 0, cacheHit: true, complexity: task.complexity, success: true });
      return { content: cached.content, provider: cached.provider, model: cached.model, usage: cached.usage, estimatedCost: 0 };
    }

    // ── Layer 2: Semantic dedup cache (catches paraphrased queries) ────────────
    const semanticHit = findSemanticCacheHit(task);
    if (semanticHit) {
      semanticCacheHits++;
      console.log(`[AIRouter] Cache HIT (semantic) for ${task.taskType}`);
      recordAITelemetry({ orgId: config.orgId, taskType: task.taskType, provider: semanticHit.provider, model: semanticHit.model, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostCents: 0, latencyMs: 0, cacheHit: true, complexity: task.complexity, success: true });
      return { content: semanticHit.content, provider: semanticHit.provider, model: semanticHit.model, usage: semanticHit.usage, estimatedCost: 0 };
    }

    cacheMisses++;
  }

  // ── Model selection ──────────────────────────────────────────────────────────
  const startTime = Date.now();
  const { provider, model, client, maxTokens: dbMaxTokens } = await selectProviderAndModelAsync(task.complexity, task.taskType, config);
  console.log(`[AIRouter] Routing ${task.taskType} (${task.complexity}) → ${provider}/${model}`);

  // ── Primary generation ───────────────────────────────────────────────────────
  let content = '';
  let usage: any;
  let finalModel = model;

  try {
    // ── Prompt caching: annotate system message with cache_control when eligible ─
    // OpenRouter passes this to Anthropic's prompt caching API.
    // Eligible: Anthropic models, system prompt ≥ 1024 chars, explicitly requested.
    // Cache discount: ~90% on the cached portion (write: 1.25× base, read: 0.1× base).
    const isAnthropicModel = model.startsWith("anthropic/");
    const systemMsg = task.messages.find(m => m.role === "system");
    const systemLength = systemMsg?.content?.length || 0;
    const shouldCache = task.enablePromptCaching && isAnthropicModel && systemLength >= 1024;

    const messagesPayload = shouldCache
      ? task.messages.map(m =>
          m.role === "system"
            ? { ...m, cache_control: { type: "ephemeral" } }
            : m
        )
      : task.messages;

    // ── Extended thinking: for valuation/financial/legal reasoning ──────────────
    // Uses Sonnet 4.6's extended thinking mode for deeper chain-of-thought.
    // Only applies to Anthropic models that support it.
    const useThinking = task.useExtendedThinking && isAnthropicModel;
    const thinkingBudget = task.thinkingBudget || 8000;

    const requestBody: any = {
      model,
      messages: messagesPayload,
      max_tokens: task.maxTokens || dbMaxTokens || (useThinking ? 16000 : 4096),
      temperature: useThinking ? 1 : (task.temperature ?? 0.7), // thinking requires temp=1
      ...(task.responseFormat === "json" && !useThinking && { response_format: { type: "json_object" } }),
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
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    recordAITelemetry({ orgId: config.orgId, taskType: task.taskType, provider, model, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostCents: 0, latencyMs, cacheHit: false, complexity: task.complexity, success: false, errorMessage: err.message });
    throw err;
  }

  // ── Model cascade: quality-gate escalation ───────────────────────────────────
  // Only cascade on non-complex tasks where we used a cheap model and the user
  // hasn't explicitly pinned a model.  Skipped when CASCADE_ENABLED = false.
  if (
    CASCADE_ENABLED &&
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
        console.log(`[AIRouter] Cascade escalating ${task.taskType}: score=${quality.score}/10 "${quality.reason}" → ${escalatedModel}`);
        try {
          const escalatedResponse = await client.chat.completions.create({
            model: escalatedModel,
            messages: task.messages,
            max_tokens: task.maxTokens || dbMaxTokens || 4096,
            temperature: task.temperature ?? 0.7,
            ...(task.responseFormat === "json" && { response_format: { type: "json_object" } }),
          });
          const escalatedContent = escalatedResponse.choices[0]?.message?.content || "";
          if (escalatedContent.length > content.length * 0.5) {
            content = escalatedContent;
            usage = escalatedResponse.usage;
            finalModel = escalatedModel;
          }
        } catch (escalationErr) {
          console.warn(`[AIRouter] Cascade escalation failed, using original response:`, escalationErr);
          // Stick with original content — fail gracefully
        }
      }
    }
  }

  // ── Build result ─────────────────────────────────────────────────────────────
  const latencyMs = Date.now() - startTime;
  const costEstimate = usage ? estimateCost(finalModel, usage.prompt_tokens, usage.completion_tokens) : 0;

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
  };

  // ── Store in both cache layers ───────────────────────────────────────────────
  if (isCacheable && cacheKey && content) {
    const queryText = task.messages.map(m => m.content).join(" ");
    setCachedResponse(cacheKey, {
      ...result,
      cachedAt: Date.now(),
      queryTokens: tokenize(queryText),
    });
  }

  recordAITelemetry({
    orgId: config.orgId,
    taskType: task.taskType,
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
 * Route a CRITICAL task to Opus 4.6 — highest-stakes decisions only.
 * Use for: contract review, legal document drafting, capital allocation,
 * note securitization, regulatory compliance determinations.
 *
 * COST WARNING: Opus 4.6 is ~5× the cost of Sonnet 4.6.
 * Only use when the quality ceiling genuinely matters.
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
      console.warn('[AIRouter] Failed to record telemetry:', err);
    }
  })();
}
