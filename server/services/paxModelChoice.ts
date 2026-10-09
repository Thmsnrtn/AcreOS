/**
 * The pure half of Pax's tier → model routing: constants, types and the rule.
 * server/services/paxModelTier.ts re-exports all of it and adds the two DB
 * reads; the eval harness (evals/servedPath.ts) imports THIS module, so the
 * model it measures is the model production resolves, without a database.
 */
import { MODELS } from "./models";

// ── Model constants ──────────────────────────────────────────────────────────
// Resolved through models.ts — the single source of truth — so this router can
// never drift from aiRouter again (it carried a stale Opus 4-7 pin until the
// 2026-07-03 model-pin centralization).

export const PAX_MODEL_HAIKU = MODELS.HAIKU;
export const PAX_MODEL_SONNET = MODELS.SONNET;
export const PAX_MODEL_OPUS = MODELS.OPUS;

// ── Soft caps (monthly Pax message counts) ──────────────────────────────────
// Free's HARD daily cap (25 msg/day) is enforced by shared/billing/tier-limits.ts
// — by the time a Free chat reaches `pickPaxModelForOrg` it has already passed
// (or is about to be denied by) that gate. We just always serve Haiku.

export const MONTHLY_SOFT_CAP_PRO = 1000;
// 2026-07-07 cost audit: was 500. At 500 Opus turns + 5,500 Sonnet turns the
// Scale tier's worst-case platform-key AI COGS (~$90) exceeded its $79 price —
// underwater at full utilization (tier-limits.ts margin notes). 200 keeps a
// real Opus window for the heavy-reasoning turns while capping the expensive
// exposure; the task-type floor router (server/ai/paxModelTier.ts) still
// sends hard multi-parcel turns to the best model the ceiling allows.
export const MONTHLY_SOFT_CAP_SCALE = 200;
// Second-stage downgrade (same graceful-degradation pattern): past this many
// Pax messages in a month, Scale serves Haiku until the 6,000-turn BYOK
// threshold moves the org onto its own key. Bounds worst-case Scale AI COGS
// at roughly $4.50 (Opus window) + ~$38 (Sonnet window) + ~$12 (Haiku tail)
// ≈ $54 on a $79 plan — above water at absolute full utilization, where the
// previous shape was not.
export const MONTHLY_HAIKU_FLOOR_SCALE = 3000;

// ── Types ────────────────────────────────────────────────────────────────────

export type PaxTier = "free" | "pro" | "scale";

export interface PaxModelChoice {
  model: string;
  tier: PaxTier;
  reason: "tier_default" | "monthly_soft_cap_downgrade" | "monthly_haiku_floor_downgrade" | "explicit_override";
  isDowngraded: boolean;
  msgCountThisMonth: number;
}

// ── Tier resolution helpers ──────────────────────────────────────────────────

/**
 * Collapse the raw `organizations.subscription_tier` column to one of the
 * three Pax-relevant tiers. Starter customers fold into Pro (same model
 * tier — Sonnet) because Pax doesn't differentiate at the model level.
 * Enterprise folds into Scale. Anything unrecognised is treated as Free.
 */
export function paxTierForSubscriptionTier(raw: string | null | undefined): PaxTier {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "pro" || value === "operator") return "pro";
  if (value === "starter" || value === "solo") return "pro";
  if (value === "scale" || value === "empire") return "scale";
  if (value === "enterprise") return "scale";
  return "free";
}

/**
 * Pure: the Pax model for a tier and this month's message count — THE rule
 * pickPaxModelForOrg applies after its two reads, and the one the eval
 * harness (evals/servedPath.ts) resolves its served model through.
 */
export function paxModelForTierAndUsage(tier: PaxTier, msgCountThisMonth: number): PaxModelChoice {
  if (tier === "free") {
    return {
      model: PAX_MODEL_HAIKU,
      tier,
      reason: "tier_default",
      isDowngraded: false,
      msgCountThisMonth,
    };
  }

  if (tier === "pro") {
    const overCap = msgCountThisMonth >= MONTHLY_SOFT_CAP_PRO;
    return {
      model: overCap ? PAX_MODEL_HAIKU : PAX_MODEL_SONNET,
      tier,
      reason: overCap ? "monthly_soft_cap_downgrade" : "tier_default",
      isDowngraded: overCap,
      msgCountThisMonth,
    };
  }

  // tier === "scale" — two-stage downgrade: Opus → Sonnet → Haiku.
  if (msgCountThisMonth >= MONTHLY_HAIKU_FLOOR_SCALE) {
    return {
      model: PAX_MODEL_HAIKU,
      tier,
      reason: "monthly_haiku_floor_downgrade",
      isDowngraded: true,
      msgCountThisMonth,
    };
  }
  const overCap = msgCountThisMonth >= MONTHLY_SOFT_CAP_SCALE;
  return {
    model: overCap ? PAX_MODEL_SONNET : PAX_MODEL_OPUS,
    tier,
    reason: overCap ? "monthly_soft_cap_downgrade" : "tier_default",
    isDowngraded: overCap,
    msgCountThisMonth,
  };
}

