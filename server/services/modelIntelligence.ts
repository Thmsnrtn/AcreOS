import OpenAI from "openai";
import { db } from "../db";
import { openrouterModelCatalog, aiModelConfigs } from "@shared/schema";
import { invalidateDbModelCache } from "./aiRouter";
import { eq, sql } from "drizzle-orm";
import { logger } from '../utils/logger';

// ============================================
// MODEL INTELLIGENCE SERVICE
// Weekly job that syncs the OpenRouter model catalog,
// benchmarks newly discovered models, and auto-promotes winners
// into aiModelConfigs when they outperform the current active model.
// ============================================

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_NEW_MODELS_PER_RUN = 3;
const AUTO_PROMOTE_SCORE_THRESHOLD = 8.5;
const AUTO_PROMOTE_COST_HEADROOM = 1.2; // 120% of current model's cost

// Benchmark prompts, one per complexity tier
const BENCHMARK_PROMPTS = {
  simple:
    "Summarize this land investing strategy in 2 sentences: 'We identify tax-delinquent absentee owners and send direct mail offers at 30% of assessed value.'",
  moderate:
    "A 5-acre rural parcel in Henderson County, TX listed at $25,000. Comparable sales show $4,500-$5,200 per acre. Analyze if this is a good acquisition.",
  complex:
    "Develop a complete negotiation strategy for a seller who wants $85,000 for a 12-acre parcel we've valued at $60,000 based on comps. Include opening offer, concession points, and walk-away criteria.",
} as const;

type ComplexityTier = keyof typeof BENCHMARK_PROMPTS;

// ============================================
// OPENROUTER API TYPES
// ============================================

interface OpenRouterModelPricing {
  prompt: string; // cost per token as decimal string
  completion: string;
}

interface OpenRouterModelTopProvider {
  is_moderated: boolean;
}

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: OpenRouterModelPricing;
  context_length: number;
  top_provider?: OpenRouterModelTopProvider;
  description?: string;
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

// ============================================
// HELPERS
// ============================================

function getOpenRouterApiKey(): string {
  const key = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "AI_INTEGRATIONS_OPENROUTER_API_KEY environment variable is not set"
    );
  }
  return key;
}

function getOpenRouterClient(): OpenAI {
  return new OpenAI({
    apiKey: getOpenRouterApiKey(),
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://acreos.fly.dev",
      "X-Title": "AcreOS",
    },
  });
}

/**
 * Converts OpenRouter per-token pricing (decimal string) to per-million cost (number).
 * OpenRouter reports pricing as cost-per-token: e.g. "0.000001" = $0.000001/token = $1/million.
 */
function toPerMillionCost(perTokenStr: string): number {
  const perToken = parseFloat(perTokenStr || "0");
  return perToken * 1_000_000;
}

// ============================================
// SYNC OPENROUTER CATALOG
// ============================================

export interface SyncResult {
  discovered: number;
  updated: number;
  deprecated: number;
}

/**
 * Fetches all models from OpenRouter's /models endpoint and upserts them
 * into openrouterModelCatalog. Marks removed models as isActive=false.
 */
export async function syncOpenRouterCatalog(): Promise<SyncResult> {
  logger.info("[model-intelligence] Starting OpenRouter catalog sync...");

  const apiKey = getOpenRouterApiKey();

  // 1. Fetch model list from OpenRouter
  let apiModels: OpenRouterModel[];
  try {
    const resp = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://acreos.fly.dev",
        "X-Title": "AcreOS",
      },
    });

    if (!resp.ok) {
      throw new Error(`OpenRouter /models returned HTTP ${resp.status}: ${await resp.text()}`);
    }

    const body = (await resp.json()) as OpenRouterModelsResponse;
    apiModels = body.data ?? [];
  } catch (err) {
    logger.error("[model-intelligence] Failed to fetch OpenRouter models", err);
    throw err;
  }

  logger.info("[model-intelligence] Fetched models from OpenRouter", { metadata: { count: apiModels.length } });

  const apiModelIds = new Set(apiModels.map((m) => m.id));

  // 2. Load existing catalog entries
  const existingRows = await db
    .select({ id: openrouterModelCatalog.id, modelId: openrouterModelCatalog.modelId })
    .from(openrouterModelCatalog);

  const existingIds = new Set(existingRows.map((r) => r.modelId));

  let discovered = 0;
  let updated = 0;

  // 3. Upsert each model from API response
  for (const model of apiModels) {
    const inputCost = toPerMillionCost(model.pricing?.prompt ?? "0").toFixed(6);
    const outputCost = toPerMillionCost(model.pricing?.completion ?? "0").toFixed(6);
    const isNew = !existingIds.has(model.id);

    try {
      await db
        .insert(openrouterModelCatalog)
        .values({
          modelId: model.id,
          displayName: model.name ?? model.id,
          inputCostPerMillion: inputCost,
          outputCostPerMillion: outputCost,
          contextWindow: model.context_length ?? null,
          capabilities: [],
          isNew: true,
          isActive: true,
          discoveredAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: openrouterModelCatalog.modelId,
          set: {
            displayName: model.name ?? model.id,
            inputCostPerMillion: inputCost,
            outputCostPerMillion: outputCost,
            contextWindow: model.context_length ?? null,
            isActive: true,
            updatedAt: new Date(),
          },
        });

      if (isNew) {
        discovered++;
      } else {
        updated++;
      }
    } catch (err) {
      logger.error("[model-intelligence] Failed to upsert model", err, { metadata: { modelId: model.id } });
    }
  }

  // 4. Mark models NOT in API response as isActive=false (deprecated)
  let deprecated = 0;
  for (const existing of existingRows) {
    if (!apiModelIds.has(existing.modelId)) {
      try {
        await db
          .update(openrouterModelCatalog)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(openrouterModelCatalog.id, existing.id));
        deprecated++;
      } catch (err) {
        logger.error("[model-intelligence] Failed to deprecate model", err, { metadata: { modelId: existing.modelId } });
      }
    }
  }

  logger.info("[model-intelligence] Sync complete", { metadata: { discovered, updated, deprecated } });

  return { discovered, updated, deprecated };
}

// ============================================
// BENCHMARK NEW MODELS
// ============================================

interface BenchmarkTierResult {
  tier: ComplexityTier;
  latencyMs: number;
  score: number | null;
  error?: string;
}

interface BenchmarkRunResult {
  modelId: string;
  results: BenchmarkTierResult[];
  scoreSimple: number | null;
  scoreModerate: number | null;
  scoreComplex: number | null;
  promoted: boolean;
}

export interface BenchmarkSummary {
  modelsAttempted: number;
  modelsCompleted: number;
  modelsPromoted: number;
  details: BenchmarkRunResult[];
}

/**
 * Runs a single benchmark prompt against a model, then self-scores the response.
 * Returns { latencyMs, score } where score is 1-10 or null on failure.
 */
async function runSingleBenchmark(
  client: OpenAI,
  modelId: string,
  tier: ComplexityTier
): Promise<BenchmarkTierResult> {
  const prompt = BENCHMARK_PROMPTS[tier];
  const start = Date.now();

  try {
    // Step 1: Get the model's response
    const response = await client.chat.completions.create({
      model: modelId,
      messages: [
        {
          role: "system",
          content:
            "You are an expert land investing analyst. Provide concise, accurate, and actionable responses.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const latencyMs = Date.now() - start;
    const content = response.choices[0]?.message?.content ?? "";

    if (!content) {
      return { tier, latencyMs, score: null, error: "Empty response from model" };
    }

    // Step 2: Self-score the response (same model grades its own output)
    let score: number | null = null;
    try {
      const scoringResponse = await client.chat.completions.create({
        model: modelId,
        messages: [
          {
            role: "system",
            content:
              'You are an objective evaluator. Score the following response on a scale of 1-10 for accuracy, completeness, and usefulness for land investing professionals. Respond ONLY with valid JSON: {"score": N}',
          },
          {
            role: "user",
            content: `Original question: ${prompt}\n\nResponse to evaluate:\n${content}`,
          },
        ],
        max_tokens: 64,
        temperature: 0,
        response_format: { type: "json_object" },
      });

      const scoreText = scoringResponse.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(scoreText) as { score?: number };
      const rawScore = parsed.score;

      if (typeof rawScore === "number" && rawScore >= 1 && rawScore <= 10) {
        score = rawScore;
      } else {
        logger.warn("[model-intelligence] Model returned invalid score", { metadata: { modelId, tier, parsed } });
      }
    } catch (scoreErr) {
      logger.warn("[model-intelligence] Self-scoring failed", { metadata: { modelId, tier, error: scoreErr } });
    }

    return { tier, latencyMs, score };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn("[model-intelligence] Benchmark failed", { metadata: { modelId, tier, error: errMsg } });
    return { tier, latencyMs, score: null, error: errMsg };
  }
}

/**
 * Gets the current active model's cost-per-million-input for a given tier
 * by looking at the highest-weight enabled config. Used for cost comparison
 * when deciding whether to auto-promote a new model.
 */
async function getCurrentActiveModelCost(
  tier: ComplexityTier
): Promise<number | null> {
  try {
    const configs = await db
      .select({
        costPerMillionInput: aiModelConfigs.costPerMillionInput,
        weight: aiModelConfigs.weight,
      })
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.enabled, true));

    if (configs.length === 0) return null;

    // Sort by weight descending, take the top config
    configs.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const cost = configs[0].costPerMillionInput;
    return cost !== null && cost !== undefined ? parseFloat(cost) : null;
  } catch (err) {
    logger.warn("[model-intelligence] Could not fetch current model cost", { metadata: { error: err } });
    return null;
  }
}

/**
 * Auto-promotes a model into aiModelConfigs if it beats the score threshold
 * and costs within the allowed headroom of the current active model.
 */
async function maybePromoteModel(
  modelId: string,
  displayName: string,
  inputCostPerMillion: string | null,
  outputCostPerMillion: string | null,
  tier: ComplexityTier,
  score: number
): Promise<boolean> {
  if (score <= AUTO_PROMOTE_SCORE_THRESHOLD) return false;

  const currentCost = await getCurrentActiveModelCost(tier);
  const newCost = inputCostPerMillion ? parseFloat(inputCostPerMillion) : null;

  if (currentCost !== null && newCost !== null) {
    if (newCost > currentCost * AUTO_PROMOTE_COST_HEADROOM) {
      logger.info("[model-intelligence] Model passes threshold but cost too high, not promoting", { metadata: { modelId, score, newCost, currentCost, costHeadroomPct: AUTO_PROMOTE_COST_HEADROOM * 100 } });
      return false;
    }
  }

  // Upsert into aiModelConfigs with weight 80
  try {
    const existing = await db
      .select({ id: aiModelConfigs.id })
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.modelId, modelId));

    if (existing.length > 0) {
      await db
        .update(aiModelConfigs)
        .set({
          weight: 80,
          enabled: true,
          updatedAt: new Date(),
        })
        .where(eq(aiModelConfigs.id, existing[0].id));
    } else {
      await db.insert(aiModelConfigs).values({
        provider: "openrouter",
        modelId,
        displayName,
        costPerMillionInput: inputCostPerMillion,
        costPerMillionOutput: outputCostPerMillion,
        maxTokens: 4096,
        taskTypes: [],
        weight: 80,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    invalidateDbModelCache();
    logger.info("[model-intelligence] Auto-promoted model to aiModelConfigs", { metadata: { modelId, weight: 80, tier, score } });
    return true;
  } catch (err) {
    logger.error("[model-intelligence] Failed to promote model to aiModelConfigs", err, { metadata: { modelId } });
    return false;
  }
}

/**
 * Finds new, un-benchmarked models in the catalog and runs benchmark prompts
 * against each. Limits to MAX_NEW_MODELS_PER_RUN per execution to control cost.
 */
export async function benchmarkNewModels(): Promise<BenchmarkSummary> {
  logger.info("[model-intelligence] Scanning for new models to benchmark...");

  // 1. Find new models with no benchmark yet
  const newModels = await db
    .select({
      id: openrouterModelCatalog.id,
      modelId: openrouterModelCatalog.modelId,
      displayName: openrouterModelCatalog.displayName,
      inputCostPerMillion: openrouterModelCatalog.inputCostPerMillion,
      outputCostPerMillion: openrouterModelCatalog.outputCostPerMillion,
    })
    .from(openrouterModelCatalog)
    .where(
      sql`${openrouterModelCatalog.isNew} = true and ${openrouterModelCatalog.lastBenchmarkedAt} is null`
    )
    .limit(MAX_NEW_MODELS_PER_RUN);

  if (newModels.length === 0) {
    logger.info("[model-intelligence] No new models pending benchmarking.");
    return {
      modelsAttempted: 0,
      modelsCompleted: 0,
      modelsPromoted: 0,
      details: [],
    };
  }

  logger.info("[model-intelligence] Benchmarking new model(s)", { metadata: { count: newModels.length, modelIds: newModels.map((m) => m.modelId).join(", ") } });

  const client = getOpenRouterClient();
  const details: BenchmarkRunResult[] = [];
  let modelsCompleted = 0;
  let modelsPromoted = 0;

  // 2. Benchmark each model
  for (const catalogEntry of newModels) {
    const { modelId, displayName, inputCostPerMillion, outputCostPerMillion } =
      catalogEntry;
    logger.info("[model-intelligence] Benchmarking model", { metadata: { modelId } });

    const tierResults: BenchmarkTierResult[] = [];

    // 3. Run all three benchmark prompts
    for (const tier of Object.keys(BENCHMARK_PROMPTS) as ComplexityTier[]) {
      logger.debug("[model-intelligence] Running benchmark tier", { metadata: { tier } });
      const result = await runSingleBenchmark(client, modelId, tier);
      tierResults.push(result);
    }

    const scoreSimple =
      tierResults.find((r) => r.tier === "simple")?.score ?? null;
    const scoreModerate =
      tierResults.find((r) => r.tier === "moderate")?.score ?? null;
    const scoreComplex =
      tierResults.find((r) => r.tier === "complex")?.score ?? null;

    // 4. Persist benchmark results to the catalog row
    try {
      await db
        .update(openrouterModelCatalog)
        .set({
          benchmarkScoreSimple:
            scoreSimple !== null ? scoreSimple.toFixed(2) : null,
          benchmarkScoreModerate:
            scoreModerate !== null ? scoreModerate.toFixed(2) : null,
          benchmarkScoreComplex:
            scoreComplex !== null ? scoreComplex.toFixed(2) : null,
          lastBenchmarkedAt: new Date(),
          isNew: false,
          updatedAt: new Date(),
        })
        .where(eq(openrouterModelCatalog.id, catalogEntry.id));

      modelsCompleted++;
    } catch (err) {
      logger.error("[model-intelligence] Failed to save benchmark results", err, { metadata: { modelId } });
    }

    // 5. Check auto-promotion eligibility per tier
    let promoted = false;
    const tierScoreMap: Record<ComplexityTier, number | null> = {
      simple: scoreSimple,
      moderate: scoreModerate,
      complex: scoreComplex,
    };

    for (const [tier, score] of Object.entries(tierScoreMap) as [
      ComplexityTier,
      number | null
    ][]) {
      if (score !== null && score > AUTO_PROMOTE_SCORE_THRESHOLD) {
        const wasPromoted = await maybePromoteModel(
          modelId,
          displayName,
          inputCostPerMillion ?? null,
          outputCostPerMillion ?? null,
          tier,
          score
        );
        if (wasPromoted) {
          promoted = true;
          modelsPromoted++;
        }
      }
    }

    details.push({
      modelId,
      results: tierResults,
      scoreSimple,
      scoreModerate,
      scoreComplex,
      promoted,
    });

    logger.info("[model-intelligence] Model benchmarking done", { metadata: { modelId, scoreSimple, scoreModerate, scoreComplex, promoted } });
  }

  logger.info("[model-intelligence] Benchmarking complete", { metadata: { modelsCompleted, modelsAttempted: newModels.length, modelsPromoted } });

  return {
    modelsAttempted: newModels.length,
    modelsCompleted,
    modelsPromoted,
    details,
  };
}

// ============================================
// CATALOG STATS (ADMIN DASHBOARD)
// ============================================

export interface ModelCatalogStats {
  models: Array<{
    modelId: string;
    displayName: string;
    inputCostPerMillion: string | null;
    outputCostPerMillion: string | null;
    contextWindow: number | null;
    isNew: boolean | null;
    isActive: boolean | null;
    lastBenchmarkedAt: Date | null;
    benchmarkScoreSimple: string | null;
    benchmarkScoreModerate: string | null;
    benchmarkScoreComplex: string | null;
    discoveredAt: Date;
    updatedAt: Date | null;
  }>;
  totalActive: number;
  totalBenchmarked: number;
  pendingBenchmark: number;
  generatedAt: string;
}

/**
 * Returns all catalog entries with benchmark scores for the admin dashboard.
 */
export async function getModelCatalogStats(): Promise<ModelCatalogStats> {
  const models = await db
    .select({
      modelId: openrouterModelCatalog.modelId,
      displayName: openrouterModelCatalog.displayName,
      inputCostPerMillion: openrouterModelCatalog.inputCostPerMillion,
      outputCostPerMillion: openrouterModelCatalog.outputCostPerMillion,
      contextWindow: openrouterModelCatalog.contextWindow,
      isNew: openrouterModelCatalog.isNew,
      isActive: openrouterModelCatalog.isActive,
      lastBenchmarkedAt: openrouterModelCatalog.lastBenchmarkedAt,
      benchmarkScoreSimple: openrouterModelCatalog.benchmarkScoreSimple,
      benchmarkScoreModerate: openrouterModelCatalog.benchmarkScoreModerate,
      benchmarkScoreComplex: openrouterModelCatalog.benchmarkScoreComplex,
      discoveredAt: openrouterModelCatalog.discoveredAt,
      updatedAt: openrouterModelCatalog.updatedAt,
    })
    .from(openrouterModelCatalog)
    .orderBy(sql`${openrouterModelCatalog.discoveredAt} desc`);

  const totalActive = models.filter((m) => m.isActive).length;
  const totalBenchmarked = models.filter(
    (m) => m.lastBenchmarkedAt !== null
  ).length;
  const pendingBenchmark = models.filter(
    (m) => m.isNew && m.lastBenchmarkedAt === null
  ).length;

  return {
    models,
    totalActive,
    totalBenchmarked,
    pendingBenchmark,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// MASTER RUNNER
// ============================================

export interface ModelIntelligenceResult {
  sync: SyncResult;
  benchmark: BenchmarkSummary;
  completedAt: string;
}

/**
 * Master function. Syncs catalog then benchmarks new models.
 * Called by the weekly scheduler.
 */
export async function runModelIntelligence(): Promise<ModelIntelligenceResult> {
  logger.info("[model-intelligence] Starting weekly model intelligence run...");

  let sync: SyncResult = { discovered: 0, updated: 0, deprecated: 0 };
  let benchmark: BenchmarkSummary = {
    modelsAttempted: 0,
    modelsCompleted: 0,
    modelsPromoted: 0,
    details: [],
  };

  try {
    sync = await syncOpenRouterCatalog();
  } catch (err) {
    logger.error("[model-intelligence] Catalog sync failed", err);
    // Continue to benchmarking — there may still be un-benchmarked models from prior syncs
  }

  try {
    benchmark = await benchmarkNewModels();
  } catch (err) {
    logger.error("[model-intelligence] Benchmarking run failed", err);
  }

  const completedAt = new Date().toISOString();
  logger.info("[model-intelligence] Weekly run complete", { metadata: { completedAt, syncDiscovered: sync.discovered, syncUpdated: sync.updated, syncDeprecated: sync.deprecated, benchmarkCompleted: benchmark.modelsCompleted, benchmarkPromoted: benchmark.modelsPromoted } });

  return { sync, benchmark, completedAt };
}
