import OpenAI from "openai";
import crypto from "crypto";

// ============================================
// AI RESPONSE CACHE (in-memory, TTL-based)
// ============================================

interface CacheEntry {
  content: string;
  provider: AIProvider;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  estimatedCost?: number;
  cachedAt: number;
}

const AI_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 500;

function getCacheKey(task: AITask): string {
  const payload = JSON.stringify({
    messages: task.messages,
    taskType: task.taskType,
    responseFormat: task.responseFormat,
    temperature: task.temperature,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
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
  // Evict oldest entries if cache is full
  if (AI_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = AI_CACHE.keys().next().value;
    if (oldestKey) AI_CACHE.delete(oldestKey);
  }
  AI_CACHE.set(key, entry);
}

// Cache stats for telemetry
let cacheHits = 0;
let cacheMisses = 0;

export function getAICacheStats() {
  return { size: AI_CACHE.size, hits: cacheHits, misses: cacheMisses, maxSize: MAX_CACHE_SIZE, ttlMs: CACHE_TTL_MS };
}

export function clearAICache() {
  AI_CACHE.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export enum TaskComplexity {
  SIMPLE = "simple",
  MODERATE = "moderate", 
  COMPLEX = "complex",
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
}

export interface AIRouterConfig {
  forceProvider?: AIProvider;
  forcePremium?: boolean;
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
  "legal_document",
  "negotiation_strategy",
  "market_valuation",
  "due_diligence",
  "contract_review",
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

const OPENROUTER_CHEAP_MODEL = "deepseek/deepseek-chat";
const OPENROUTER_REASONING_MODEL = "deepseek/deepseek-reasoner";
const OPENAI_PREMIUM_MODEL = "gpt-4o";
const OPENAI_FAST_MODEL = "gpt-4o-mini";

let openrouterClient: OpenAI | null = null;
let openaiClient: OpenAI | null = null;

function getOpenRouterClient(): OpenAI | null {
  if (!openrouterClient) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
    if (!apiKey || !baseURL) {
      return null;
    }
    openrouterClient = new OpenAI({
      apiKey,
      baseURL,
    });
  }
  return openrouterClient;
}

function getOpenAIClient(): OpenAI | null {
  if (!openaiClient) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    if (!apiKey) {
      return null;
    }
    openaiClient = new OpenAI({
      apiKey,
      baseURL,
    });
  }
  return openaiClient;
}

export function classifyTaskComplexity(taskType: string, contentLength?: number): TaskComplexity {
  const normalizedTask = taskType.toLowerCase().replace(/[-_\s]/g, "_");
  
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
  config: AIRouterConfig = {}
): { provider: AIProvider; model: string; client: OpenAI } {
  const openrouter = getOpenRouterClient();
  const openai = getOpenAIClient();
  
  if (config.forceProvider === AIProvider.OPENAI || config.forcePremium) {
    if (!openai) {
      throw new Error("OpenAI not available - AI_INTEGRATIONS_OPENAI_API_KEY not configured");
    }
    return {
      provider: AIProvider.OPENAI,
      model: complexity === TaskComplexity.COMPLEX ? OPENAI_PREMIUM_MODEL : OPENAI_FAST_MODEL,
      client: openai,
    };
  }
  
  if (config.forceProvider === AIProvider.OPENROUTER) {
    if (!openrouter) {
      throw new Error("OpenRouter not available - check AI_INTEGRATIONS_OPENROUTER_* env vars");
    }
    return {
      provider: AIProvider.OPENROUTER,
      model: complexity === TaskComplexity.COMPLEX ? OPENROUTER_REASONING_MODEL : OPENROUTER_CHEAP_MODEL,
      client: openrouter,
    };
  }
  
  if (complexity === TaskComplexity.COMPLEX) {
    if (openai) {
      return {
        provider: AIProvider.OPENAI,
        model: OPENAI_PREMIUM_MODEL,
        client: openai,
      };
    }
    if (openrouter) {
      return {
        provider: AIProvider.OPENROUTER,
        model: OPENROUTER_REASONING_MODEL,
        client: openrouter,
      };
    }
  }
  
  if (openrouter) {
    return {
      provider: AIProvider.OPENROUTER,
      model: OPENROUTER_CHEAP_MODEL,
      client: openrouter,
    };
  }
  
  if (openai) {
    return {
      provider: AIProvider.OPENAI,
      model: complexity === TaskComplexity.SIMPLE ? OPENAI_FAST_MODEL : OPENAI_PREMIUM_MODEL,
      client: openai,
    };
  }
  
  throw new Error("No AI providers available - configure OpenAI or OpenRouter");
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

const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  [OPENROUTER_CHEAP_MODEL]: { input: 0.14, output: 0.28 },
  [OPENROUTER_REASONING_MODEL]: { input: 0.55, output: 2.19 },
  [OPENAI_PREMIUM_MODEL]: { input: 2.50, output: 10.00 },
  [OPENAI_FAST_MODEL]: { input: 0.15, output: 0.60 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = COST_PER_MILLION_TOKENS[model] || { input: 1, output: 3 };
  return (promptTokens * costs.input + completionTokens * costs.output) / 1_000_000;
}

export async function routeAITask(
  task: AITask,
  config: AIRouterConfig = {}
): Promise<AIResponse> {
  // Check cache for non-complex, deterministic tasks (temperature <= 0.3)
  const isCacheable = task.complexity !== TaskComplexity.COMPLEX && (task.temperature ?? 0.7) <= 0.3;
  let cacheKey = '';
  
  if (isCacheable) {
    cacheKey = getCacheKey(task);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      cacheHits++;
      console.log(`[AIRouter] Cache HIT for ${task.taskType} (${task.complexity})`);
      // Record telemetry for cache hit
      recordAITelemetry({
        orgId: config.orgId,
        taskType: task.taskType,
        provider: cached.provider,
        model: cached.model,
        promptTokens: cached.usage?.promptTokens || 0,
        completionTokens: cached.usage?.completionTokens || 0,
        totalTokens: cached.usage?.totalTokens || 0,
        estimatedCostCents: 0, // No cost for cache hit
        latencyMs: 0,
        cacheHit: true,
        complexity: task.complexity,
        success: true,
      });
      return {
        content: cached.content,
        provider: cached.provider,
        model: cached.model,
        usage: cached.usage,
        estimatedCost: 0, // No cost for cache hit
      };
    }
    cacheMisses++;
  }

  const startTime = Date.now();
  const { provider, model, client } = selectProviderAndModel(task.complexity, config);
  
  console.log(`[AIRouter] Routing ${task.taskType} (${task.complexity}) -> ${provider}/${model}`);
  
  let content = '';
  let usage: any;
  let success = true;
  let errorMessage: string | undefined;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: task.messages,
      max_tokens: task.maxTokens || 4096,
      temperature: task.temperature ?? 0.7,
      ...(task.responseFormat === "json" && { response_format: { type: "json_object" } }),
    });
    
    content = response.choices[0]?.message?.content || "";
    usage = response.usage;
  } catch (err: any) {
    success = false;
    errorMessage = err.message;
    const latencyMs = Date.now() - startTime;
    recordAITelemetry({
      orgId: config.orgId,
      taskType: task.taskType,
      provider,
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostCents: 0,
      latencyMs,
      cacheHit: false,
      complexity: task.complexity,
      success: false,
      errorMessage: err.message,
    });
    throw err;
  }

  const latencyMs = Date.now() - startTime;
  const costEstimate = usage ? estimateCost(model, usage.prompt_tokens, usage.completion_tokens) : 0;
  
  const result: AIResponse = {
    content,
    provider,
    model,
    usage: usage ? {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    } : undefined,
    estimatedCost: costEstimate,
  };

  // Cache the result
  if (isCacheable && cacheKey && content) {
    setCachedResponse(cacheKey, {
      ...result,
      cachedAt: Date.now(),
    });
  }

  // Record telemetry (fire and forget)
  recordAITelemetry({
    orgId: config.orgId,
    taskType: task.taskType,
    provider,
    model,
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
