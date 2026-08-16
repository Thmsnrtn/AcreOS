// ============================================================================
// SERVER/SERVICES/EMBEDDINGS/VOYAGECLIENT.TS
// ----------------------------------------------------------------------------
// Production embeddings client — Voyage AI (voyage-3-large, 1024-dim).
//
// Replaces the placeholder-feature-hash embedding used in L3.10 (learningLoop)
// + L3.14 (memoryRetrieval) + the two ingest scripts. The placeholder remains
// as a fail-open fallback so a transient Voyage outage / missing key / network
// hiccup never bricks the retrieval path.
//
// Credential discipline (feedback_credential_value_handling.md):
//   - VOYAGE_API_KEY is read at call-time; only `keyLen` ever logged.
//   - Texts sent to Voyage may contain user data; we sanitize obvious
//     credential-shaped substrings (sk_, pk_, phc_, phx_, ghp_, Bearer ,
//     AKIA, ASIA) before they leave the process.
//
// Surfaces:
//   - embedTexts(input)        — primary embedding call.
//   - estimateCost(tokens, $)  — pure helper for cost reporting.
//   - checkVoyageStatus()      — boot-time / founder visibility probe.
// ============================================================================

import { logger } from "../../utils/logger";

import { redactCredentials } from "../../utils/redactCredentials";
// ----------------------------------------------------------------------------
// Constants — env-overridable so the founder can swap model versions without
// a code change. Defaults reflect the shipped target (voyage-3-large @ 1024-d).
// ----------------------------------------------------------------------------

const VOYAGE_API_BASE =
  process.env.VOYAGE_API_BASE ?? "https://api.voyageai.com/v1";
const VOYAGE_MODEL = process.env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3-large";
export const VOYAGE_DIM = 1024;

/**
 * Resolved at call-time so tests + ops can flip the timeout via env without
 * re-importing the module.
 */
function getVoyageTimeoutMs(): number {
  const raw = process.env.VOYAGE_TIMEOUT_MS;
  if (!raw) return 30_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

// voyage-3-large pricing per Voyage's published rate card (USD per 1M tokens).
// Override via env if the founder negotiates a different rate or for tests.
const VOYAGE_PRICE_PER_M_TOKENS = (() => {
  const raw = process.env.VOYAGE_PRICE_PER_M_TOKENS;
  if (!raw) return 0.18;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.18;
})();

// In-memory canary cache: an `available=true` requires a successful embed
// within the last 24h. We avoid re-canarying on every status probe.
const CANARY_TTL_MS = 24 * 60 * 60 * 1000;
let lastCanaryAt: Date | null = null;
let lastCanaryModel: string | null = null;

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface EmbedInput {
  texts: string[];
  /**
   * Voyage distinguishes 'document' (corpus ingestion) from 'query' (search
   * input) — using the right value materially improves recall.
   */
  inputType?: "document" | "query";
}

export interface EmbedResult {
  embeddings: number[][];
  model: string;
  dim: number;
  inputTokens: number;
  /** Estimated USD cost based on `VOYAGE_PRICE_PER_M_TOKENS`. */
  totalCostUsd: number;
}

export interface VoyageStatus {
  available: boolean;
  hasApiKey: boolean;
  apiKeyLen?: number;
  lastVerifiedAt?: Date;
  detectedModel?: string;
}

// ----------------------------------------------------------------------------
// Credential-shaped substring sanitizer
// ----------------------------------------------------------------------------

const REDACTED_MARKER = "[redacted-credential]";

/**
 * Delegates to THE credential redactor (unit 120) with this module's own
 * marker preserved — the egress guard before text reaches the Voyage API is
 * the same concept as the audit-row redactors, and six independent pattern
 * lists disagreed about Slack tokens, JWTs and gho_ until they had one owner.
 */
export function sanitizeForVoyage(text: string): string {
  return redactCredentials(text, undefined, REDACTED_MARKER);
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

/**
 * Compute the estimated USD cost for `inputTokens` tokens at the configured
 * per-million-token rate. Rounds to 6 decimals (sub-cent precision).
 */
export function estimateCost(
  inputTokens: number,
  pricePerMTokens: number = VOYAGE_PRICE_PER_M_TOKENS,
): number {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return 0;
  const usd = (inputTokens / 1_000_000) * pricePerMTokens;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

function readApiKey(): string | null {
  const k = process.env.VOYAGE_API_KEY;
  return k && k.length > 0 ? k : null;
}

// ----------------------------------------------------------------------------
// embedTexts — primary surface
// ----------------------------------------------------------------------------

/**
 * Call the Voyage embeddings API. Throws on any failure; callers are
 * responsible for catching + degrading (the L3.10 / L3.14 services fall
 * back to the placeholder embedding; the ingest scripts fall back per-row).
 */
export async function embedTexts(input: EmbedInput): Promise<EmbedResult> {
  if (!Array.isArray(input.texts) || input.texts.length === 0) {
    throw new Error("[voyage] embedTexts: texts must be a non-empty array");
  }
  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error(
      "[voyage] embedTexts: VOYAGE_API_KEY not set — caller should fall back to placeholder",
    );
  }
  const inputType = input.inputType ?? "document";
  const sanitized = input.texts.map(sanitizeForVoyage);

  logger.info("[voyage] embedTexts.request", {
    metadata: {
      model: VOYAGE_MODEL,
      inputType,
      count: sanitized.length,
      keyLen: apiKey.length,
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getVoyageTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: sanitized,
        input_type: inputType,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `[voyage] embedTexts: request timed out after ${getVoyageTimeoutMs()}ms`,
      );
    }
    throw new Error(
      `[voyage] embedTexts: network error — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // ignore — best-effort body capture for the error message
    }
    // Do NOT log the request body (it can contain user data) and NEVER log
    // the API key. The status code is the most actionable signal.
    throw new Error(
      `[voyage] embedTexts: HTTP ${response.status} — ${bodyText.slice(0, 200)}`,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(
      `[voyage] embedTexts: malformed JSON response — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = (json as { data?: Array<{ embedding?: number[] }> } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error(
      "[voyage] embedTexts: malformed response — missing `data` array",
    );
  }
  if (data.length !== sanitized.length) {
    throw new Error(
      `[voyage] embedTexts: response length mismatch — expected ${sanitized.length}, got ${data.length}`,
    );
  }

  const embeddings: number[][] = [];
  for (let i = 0; i < data.length; i++) {
    const vec = data[i]?.embedding;
    if (!Array.isArray(vec)) {
      throw new Error(
        `[voyage] embedTexts: malformed response — data[${i}].embedding missing`,
      );
    }
    if (vec.length !== VOYAGE_DIM) {
      throw new Error(
        `[voyage] embedTexts: dim mismatch at data[${i}] — expected ${VOYAGE_DIM}, got ${vec.length}`,
      );
    }
    embeddings.push(vec);
  }

  const usage = (json as { usage?: { total_tokens?: number } } | null)?.usage;
  const inputTokens =
    typeof usage?.total_tokens === "number" ? usage.total_tokens : 0;
  const model =
    (json as { model?: string } | null)?.model ?? VOYAGE_MODEL;
  const totalCostUsd = estimateCost(inputTokens);

  // Refresh the canary cache on any successful embed.
  lastCanaryAt = new Date();
  lastCanaryModel = model;

  logger.info("[voyage] embedTexts.success", {
    metadata: {
      model,
      count: embeddings.length,
      inputTokens,
      totalCostUsd,
    },
  });

  return {
    embeddings,
    model,
    dim: VOYAGE_DIM,
    inputTokens,
    totalCostUsd,
  };
}

// ----------------------------------------------------------------------------
// checkVoyageStatus — health probe
// ----------------------------------------------------------------------------

/**
 * Returns the current status of the Voyage path. `available=true` requires
 * both an API key AND a successful canary embed within the last 24h. The
 * canary fires lazily — if the cached verification is stale, we run a tiny
 * embed("ping") call. Failures degrade gracefully to `available=false`.
 */
export async function checkVoyageStatus(): Promise<VoyageStatus> {
  const apiKey = readApiKey();
  if (!apiKey) {
    return { available: false, hasApiKey: false };
  }
  const base: VoyageStatus = {
    available: false,
    hasApiKey: true,
    apiKeyLen: apiKey.length,
  };
  // Cached canary still fresh?
  if (
    lastCanaryAt &&
    Date.now() - lastCanaryAt.getTime() < CANARY_TTL_MS &&
    lastCanaryModel
  ) {
    return {
      ...base,
      available: true,
      lastVerifiedAt: lastCanaryAt,
      detectedModel: lastCanaryModel,
    };
  }
  // Run a tiny canary embed. On any failure return `available=false`.
  try {
    const result = await embedTexts({ texts: ["ping"], inputType: "query" });
    return {
      ...base,
      available: true,
      lastVerifiedAt: lastCanaryAt ?? new Date(),
      detectedModel: result.model,
    };
  } catch (err) {
    logger.warn("[voyage] checkVoyageStatus.canary_failed", {
      metadata: {
        keyLen: apiKey.length,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return base;
  }
}

// ----------------------------------------------------------------------------
// Test-only helpers — exported so the test file can reset the canary cache.
// ----------------------------------------------------------------------------

/** @internal — test-only, do not call from production code paths. */
export function __resetVoyageCanaryForTests(): void {
  lastCanaryAt = null;
  lastCanaryModel = null;
}
