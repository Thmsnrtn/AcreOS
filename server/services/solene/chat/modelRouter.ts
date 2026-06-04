/**
 * SOLENE CHAT — model router (Phase 2 of AcreOS-Solene migration).
 *
 * Decides which tier a user query lands on: strategic / conversational / fast
 * / code. The router runs inline shortcut rules first (no upstream call) and
 * only falls through to a FAST-tier classifier when the rules don't match.
 *
 * Cost discipline: even when the classifier IS invoked, it's a single
 * Haiku-tier turn at <$0.01 per query — cheap enough to be a routing tax,
 * not a feature cost.
 *
 * NEVER throws. On classifier failure / no API key, falls back to
 * 'conversational' tier (the safe default — won't accidentally over-spend on
 * Opus, won't accidentally under-deliver on Haiku).
 */

import {
  CHAT_MODELS,
  CHAT_PRICING_PER_M_TOKENS,
  modelForTier,
  type ChatTier,
} from "@shared/schema/solene-chat-config";
import { streamChatCompletion } from "./openRouterClient";
import { logger } from "../../../utils/logger";

// ============================================================================
// Public types
// ============================================================================

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  textContent: string;
  modelUsed?: string | null;
}

export interface RouteDecision {
  tier: ChatTier;
  model: string;
  rationale: string;
  estimatedCostUsd: number;
  fastClassificationLatencyMs: number;
}

export interface RouteQueryInput {
  userMessage: string;
  conversationHistory: ConversationMessage[];
  hint?: ChatTier;
}

// ============================================================================
// Inline shortcut rules
// ============================================================================

/** Phrases that strongly indicate a strategic-tier (action with consequences). */
const STRATEGIC_KEYWORDS = [
  "deploy",
  "fly deploy",
  "ship to prod",
  "ship it",
  "push to main",
  "force push",
  "drop the database",
  "delete the database",
  "rollback",
  "production",
];

/** File-extension / fenced-code patterns that signal a code-tier query. */
const CODE_SIGNALS = [
  /\.[tj]sx?\b/, // .ts .tsx .js .jsx
  /\.py\b/,
  /\.go\b/,
  /\.rs\b/,
  /\.sql\b/,
  /```/, // fenced code block
  /\bfunction\s+\w+\(/,
  /\bclass\s+\w+/,
  /\bimport\s+.+from\s+['"]/,
  /\brefactor\b/i,
  /\bgrep\b/,
];

const FAST_LOOKUP_WORD_THRESHOLD = 8;

// ============================================================================
// Routing
// ============================================================================

function countWords(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function matchesAny(s: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(s));
}

function containsAnyKeyword(s: string, keywords: string[]): boolean {
  const lower = s.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Choose a tier when no shortcut rule fires AND there's no classifier
 * available. Picks 'conversational' — the safe default.
 */
function defaultTier(): ChatTier {
  return "conversational";
}

/**
 * Pure function: apply shortcut rules. Returns null if no rule fires.
 * Exported for tests.
 */
export function applyShortcutRules(
  userMessage: string,
  history: ConversationMessage[],
): { tier: ChatTier; rationale: string } | null {
  const trimmed = userMessage.trim();
  if (trimmed.length === 0) {
    return { tier: "fast", rationale: "empty message — fast default" };
  }

  if (containsAnyKeyword(trimmed, STRATEGIC_KEYWORDS)) {
    return {
      tier: "strategic",
      rationale:
        "Strategic keyword detected (deploy / push / production). Routed to strategic tier for higher-quality reasoning on actions with consequences.",
    };
  }

  if (matchesAny(trimmed, CODE_SIGNALS)) {
    return {
      tier: "code",
      rationale:
        "Code signals detected (file extension / fenced block / refactor / grep). Routed to code tier.",
    };
  }

  const wordCount = countWords(trimmed);
  if (wordCount < FAST_LOOKUP_WORD_THRESHOLD && !trimmed.includes("?")) {
    return {
      tier: "fast",
      rationale: `Short imperative (${wordCount} words, no question mark). Routed to fast tier for low-latency lookup.`,
    };
  }

  // Long conversations stick with the prior model used (sticky routing).
  if (history.length > 4) {
    const lastAssistant = [...history]
      .reverse()
      .find((m) => m.role === "assistant" && m.modelUsed);
    if (lastAssistant?.modelUsed) {
      const tier = tierFromModelName(lastAssistant.modelUsed);
      if (tier) {
        return {
          tier,
          rationale: `Sticky routing: ${history.length} prior turns, last assistant used ${lastAssistant.modelUsed} (tier=${tier}).`,
        };
      }
    }
  }

  return null;
}

/**
 * Reverse-lookup: model id → tier. Used for sticky-routing in long convos.
 * Returns null when the model name doesn't match any tier (e.g. an override
 * env points at a non-Anthropic model).
 */
export function tierFromModelName(model: string): ChatTier | null {
  if (model === CHAT_MODELS.STRATEGIC) return "strategic";
  if (model === CHAT_MODELS.CONVERSATIONAL) return "conversational";
  if (model === CHAT_MODELS.FAST) return "fast";
  if (model === CHAT_MODELS.CODE) return "code";
  return null;
}

// ============================================================================
// estimateCost
// ============================================================================

/**
 * Estimate the dollar cost of a single turn at the given tier. Pure helper —
 * no external calls. Used both pre-flight (for routing decisions) and
 * post-flight (for capital tracking).
 */
export function estimateCost(opts: {
  tier: ChatTier;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  cachedInputTokens?: number;
}): number {
  const pricing = CHAT_PRICING_PER_M_TOKENS[opts.tier];
  const cached = Math.max(0, opts.cachedInputTokens ?? 0);
  const billableInput = Math.max(0, opts.estimatedInputTokens - cached);
  const inputCost = (billableInput / 1_000_000) * pricing.input;
  const cachedCost = (cached / 1_000_000) * pricing.cachedInput;
  const outputCost = (opts.estimatedOutputTokens / 1_000_000) * pricing.output;
  return inputCost + cachedCost + outputCost;
}

// ============================================================================
// routeQuery — top-level entry.
// ============================================================================

export async function routeQuery(input: RouteQueryInput): Promise<RouteDecision> {
  // Hint short-circuits everything else.
  if (input.hint) {
    return makeDecision(
      input.hint,
      `Caller-provided tier hint: ${input.hint}.`,
      0,
      estimateOutputTokens(input.userMessage),
      input.userMessage,
    );
  }

  const ruleHit = applyShortcutRules(
    input.userMessage,
    input.conversationHistory,
  );
  if (ruleHit) {
    return makeDecision(
      ruleHit.tier,
      ruleHit.rationale,
      0,
      estimateOutputTokens(input.userMessage),
      input.userMessage,
    );
  }

  // No rule matched — invoke the FAST-tier classifier.
  const t0 = Date.now();
  let classified: ChatTier | null = null;
  try {
    classified = await classifyWithFastModel(input.userMessage);
  } catch (err) {
    logger.warn("[soleneChat] modelRouter.classifier_error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  const latency = Date.now() - t0;

  const tier = classified ?? defaultTier();
  const rationale = classified
    ? `Classifier (${CHAT_MODELS.CLASSIFIER}) selected ${tier} (${latency}ms).`
    : `Classifier unavailable; defaulted to ${tier}.`;
  return makeDecision(
    tier,
    rationale,
    latency,
    estimateOutputTokens(input.userMessage),
    input.userMessage,
  );
}

function estimateOutputTokens(userMessage: string): number {
  // Rough: longer queries tend to get longer answers; bounded.
  const inputTokens = Math.max(50, Math.floor(userMessage.length / 4));
  return Math.min(2048, Math.max(150, Math.floor(inputTokens * 1.5)));
}

function makeDecision(
  tier: ChatTier,
  rationale: string,
  fastClassificationLatencyMs: number,
  estOutputTokens: number,
  userMessage: string,
): RouteDecision {
  const estInput = Math.max(100, Math.floor(userMessage.length / 4));
  return {
    tier,
    model: modelForTier(tier),
    rationale,
    estimatedCostUsd: estimateCost({
      tier,
      estimatedInputTokens: estInput,
      estimatedOutputTokens: estOutputTokens,
    }),
    fastClassificationLatencyMs,
  };
}

// ============================================================================
// Classifier
// ============================================================================

const CLASSIFIER_SYSTEM_PROMPT = `You are a routing classifier for an AI assistant. Given a user message, output EXACTLY one of these tokens with no other text:

STRATEGIC — high-stakes decisions, multi-step planning, complex strategy
CONVERSATIONAL — most chat, drafting, explanations, general questions
FAST — lookups, classifications, short factual queries
CODE — refactors, deep code reading, multi-file code questions

Output one token only.`;

/**
 * Streams the FAST classifier model + returns the chosen tier. Never throws.
 * Returns null if the classifier produces an unrecognizable token.
 *
 * Exported for tests (which stub streamChatCompletion).
 */
export async function classifyWithFastModel(
  userMessage: string,
): Promise<ChatTier | null> {
  let buffer = "";
  for await (const event of streamChatCompletion({
    model: CHAT_MODELS.CLASSIFIER,
    system: CLASSIFIER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: userMessage.slice(0, 4000) }],
      },
    ],
    max_tokens: 16,
    temperature: 0,
  })) {
    if (event.type === "text_delta") {
      buffer += event.delta;
    } else if (event.type === "error") {
      logger.warn("[soleneChat] classifier.stream_error", {
        message: event.message,
      });
      return null;
    } else if (event.type === "message_done") {
      break;
    }
  }
  const token = buffer.trim().toUpperCase();
  if (token.startsWith("STRATEGIC")) return "strategic";
  if (token.startsWith("CONVERSATIONAL")) return "conversational";
  if (token.startsWith("FAST")) return "fast";
  if (token.startsWith("CODE")) return "code";
  return null;
}
