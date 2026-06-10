/**
 * AI-channel BYOK helpers — Tier 1I Economics guardrail (2026-06-10).
 *
 * Founder decision: mandatory BYOK past a generous monthly turn threshold
 * (NOT a hard ceiling, NOT metered overage). These helpers answer the two
 * questions every AI gate + router needs:
 *
 *   getActiveAiByokChannel(orgId)  → which AI channel (if any) has an
 *                                    active customer key — cheap, no decrypt
 *   resolveAiByokClient(orgId)     → a ready-to-use OpenAI-SDK client bound
 *                                    to the customer's key, plus a model
 *                                    mapper for the channel
 *
 * Billing rule (same as toggle.ts): when a call routes through a BYOK
 * client the CUSTOMER pays the provider directly — platform COGS is $0.
 * Callers must never debit the credit pool or count platform AI spend for
 * BYOK-routed calls.
 *
 * SECURITY: the decrypted key lives only inside the returned client. It
 * must NEVER be logged, serialized, or included in any error/telemetry
 * payload. Log fingerprints/channels only.
 */

import OpenAI from "openai";
import { inArray, and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { byokCredentials, type ByokChannel } from "@shared/schema";
import { getByokCredential } from "./key-vault";
import { logger } from "../../utils/logger";

/**
 * AI channels eligible to satisfy the BYOK threshold, in routing-priority
 * order. OpenRouter first (it serves every model the platform router can
 * pick), then Anthropic direct, then OpenAI direct.
 */
// `satisfies` (not a `readonly ByokChannel[]` annotation) so AiByokChannel
// stays the narrow three-literal union — the switches below are exhaustive
// by construction and tsc proves it.
export const AI_BYOK_CHANNELS = [
  "openrouter",
  "anthropic",
  "openai",
] as const satisfies readonly ByokChannel[];

export type AiByokChannel = (typeof AI_BYOK_CHANNELS)[number];

/**
 * Cheapest possible check: does the org hold ANY active AI-channel BYOK
 * credential? Returns the highest-priority channel or null. No decryption.
 */
export async function getActiveAiByokChannel(
  organizationId: number,
): Promise<AiByokChannel | null> {
  const rows = await db
    .select({ channel: byokCredentials.channel })
    .from(byokCredentials)
    .where(
      and(
        eq(byokCredentials.organizationId, organizationId),
        inArray(byokCredentials.channel, [...AI_BYOK_CHANNELS]),
        isNull(byokCredentials.revokedAt),
      ),
    );
  if (rows.length === 0) return null;
  const present = new Set(rows.map((r) => r.channel));
  for (const ch of AI_BYOK_CHANNELS) {
    if (present.has(ch)) return ch;
  }
  return null;
}

/**
 * Map the platform router's model id (OpenRouter namespace, e.g.
 * "anthropic/claude-sonnet-4-6") onto what the BYOK channel can serve.
 *
 *  - openrouter: same namespace — model id passes through unchanged.
 *  - anthropic:  Anthropic's OpenAI-compatible endpoint takes bare model
 *                ids ("claude-…"); non-Claude selections map to the bare
 *                Sonnet default — the customer's key can only serve Claude.
 *  - openai:     bare OpenAI ids; non-OpenAI selections map to gpt-4o.
 *
 * Pure function — unit-tested in tests/unit/aiByokThresholdGate.test.ts.
 */
export function mapModelForByokChannel(channel: AiByokChannel, model: string): string {
  switch (channel) {
    case "openrouter":
      return model;
    case "anthropic": {
      if (model.startsWith("anthropic/")) return model.slice("anthropic/".length);
      if (model.includes("claude")) return model;
      // Non-Claude selection on an Anthropic-only key → bare Sonnet default.
      return "claude-sonnet-4-6";
    }
    case "openai": {
      if (model.startsWith("openai/")) return model.slice("openai/".length);
      if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return model;
      return "gpt-4o";
    }
  }
}

export interface AiByokRouting {
  channel: AiByokChannel;
  /** OpenAI-SDK client bound to the CUSTOMER's key. Never log internals. */
  client: OpenAI;
  /** Map a platform (OpenRouter-namespace) model id for this channel. */
  mapModel: (model: string) => string;
}

/**
 * Resolve a ready-to-use chat client on the org's own AI key, or null when
 * the org has no active AI BYOK credential (or decryption failed — in that
 * case we fall back to platform routing rather than erroring the turn).
 */
export async function resolveAiByokClient(
  organizationId: number,
): Promise<AiByokRouting | null> {
  const channel = await getActiveAiByokChannel(organizationId);
  if (!channel) return null;

  const apiKey = await getByokCredential({ organizationId, channel }).catch(() => null);
  if (!apiKey) {
    logger.warn(
      `[ai-byok] active ${channel} credential for org=${organizationId} failed to resolve — falling back to platform key`,
    );
    return null;
  }

  const common = { apiKey, timeout: 30_000, maxRetries: 1 } as const;
  let client: OpenAI;
  switch (channel) {
    case "openrouter":
      client = new OpenAI({
        ...common,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: { "HTTP-Referer": "https://acreos.fly.dev", "X-Title": "AcreOS" },
      });
      break;
    case "anthropic":
      // Anthropic's OpenAI SDK compatibility layer (chat.completions).
      client = new OpenAI({ ...common, baseURL: "https://api.anthropic.com/v1/" });
      break;
    case "openai":
      client = new OpenAI(common);
      break;
  }

  return {
    channel,
    client,
    mapModel: (model: string) => mapModelForByokChannel(channel, model),
  };
}
