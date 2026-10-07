/**
 * Which plan may connect which bring-your-own key — ONE rule.
 *
 * It lived inline in `server/routes-byok.ts → requireByokTier`, which is the
 * gate that enforces it. Pax's product facts must be able to say "connecting
 * your own Twilio number needs the Pro plan" without restating the rule, so
 * the rule moved here and the route now asks this function. The answer Pax
 * gives and the answer the route enforces are the same call.
 *
 * Tier 1I (2026-06-10): AI channels are open to every PAID tier, because BYOK
 * is the continuation path past the monthly AI-turn threshold and Starter has
 * a threshold too. Every other channel (SMS, mail, email, data lanes) is Pro
 * and above. Free gets none.
 */
import type { Tier } from "./tier-pricing";

/** The channels a Starter plan may connect. Everything else is Pro+. */
export const BYOK_AI_CHANNELS: readonly string[] = ["anthropic", "openrouter", "openai"];

/** Tiers (in `Tier` vocabulary) on which any BYOK channel may be connected. */
const BYOK_ALL_CHANNEL_TIERS: readonly Tier[] = ["pro", "scale"];

/**
 * May an org on `tier` connect a key for `channel`? `channel` undefined means
 * "no particular channel" (the listing), which any paid tier may read.
 * `tier` null is Free / unknown.
 */
export function byokTierAllows(tier: Tier | null, channel?: string): boolean {
  if (tier && BYOK_ALL_CHANNEL_TIERS.includes(tier)) return true;
  const isPaid = tier === "starter" || tier === "pro" || tier === "scale";
  const aiChannelScope = channel === undefined || BYOK_AI_CHANNELS.includes(channel);
  return isPaid && aiChannelScope;
}
