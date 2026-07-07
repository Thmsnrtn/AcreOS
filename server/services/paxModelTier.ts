/**
 * paxModelTier — Customer Pax model selection gated by subscription tier.
 *
 * Batch 7 of the AI cost-efficiency program. Before this module existed,
 * every Pax chat in `server/ai/executive.ts` (processChat / processChatStream)
 * went through `getChatProviderAndModel(complexity)` which routes purely on
 * message complexity. A Free-tier customer could therefore hit Opus, and a
 * Scale customer could be silently downgraded to Haiku. Both wrong from a
 * unit-economics standpoint.
 *
 * This file is the single source of truth for "which model do we run Pax on
 * for org X right now?". The mapping is:
 *
 *   Free  → Haiku 4.5 (always; $0.80/M in)
 *   Pro   → Sonnet 4.6 default; downgrade to Haiku once the org has sent
 *           >= MONTHLY_SOFT_CAP_PRO Pax messages this calendar month
 *   Scale → Opus default; downgrade to Sonnet at MONTHLY_SOFT_CAP_SCALE and
 *           to Haiku at MONTHLY_HAIKU_FLOOR_SCALE messages this calendar
 *           month (two-stage 2026-07-07 margin guard — Scale's worst-case
 *           platform-key COGS previously exceeded its price)
 *
 * The Free daily cap (25 msg/day) is enforced elsewhere by the tier-limits
 * system — we don't re-enforce it here. The Pro/Scale soft caps are NOT
 * hard limits; the chat keeps working, just on a cheaper model for the
 * remainder of the billing period. This degrades gracefully rather than
 * erroring on the customer the moment they hit a number.
 *
 * Fail-open principle: every error in this file resolves to Haiku. We never
 * block a chat because a tier lookup or monthly-count query failed. The
 * worst case is a Pro/Scale customer briefly chats on Haiku — annoying, not
 * broken — versus a customer getting an error instead of an AI response.
 *
 * Counting basis: rows in `ai_call_log` filtered by `feature = 'pax_chat'`
 * within the current UTC calendar month. The Pax chat path emits one such
 * row per turn via the ai-telemetry layer (Pillar 7).
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { aiCallLog } from "@shared/schema";
import { organizations } from "@shared/schema";
import { logger } from "../utils/logger";
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

export interface PaxMonthlyUsage {
  tier: PaxTier;
  used: number;
  cap: number;
  downgraded: boolean;
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

function startOfCurrentUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

// ── Tier + usage lookup ──────────────────────────────────────────────────────

interface OrgTierAndCount {
  tier: PaxTier;
  msgCountThisMonth: number;
}

/**
 * Read the org's subscription tier + count its Pax messages this month.
 * Both reads are run in parallel. Failures bubble up; callers (this module
 * only) catch them and fail open to Haiku.
 */
async function loadOrgTierAndUsage(organizationId: number): Promise<OrgTierAndCount> {
  const monthStart = startOfCurrentUtcMonth();

  const [orgRows, countRows] = await Promise.all([
    db
      .select({ subscriptionTier: organizations.subscriptionTier })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiCallLog)
      .where(
        and(
          eq(aiCallLog.organizationId, organizationId),
          eq(aiCallLog.feature, "pax_chat"),
          gte(aiCallLog.createdAt, monthStart),
        ),
      ),
  ]);

  const rawTier = orgRows[0]?.subscriptionTier ?? null;
  const tier = paxTierForSubscriptionTier(rawTier);
  const n = countRows[0]?.n;
  const msgCountThisMonth = typeof n === "number" ? n : Number(n ?? 0);
  return { tier, msgCountThisMonth };
}

// ── pickPaxModelForOrg ───────────────────────────────────────────────────────

/**
 * Resolve the right Pax model for `organizationId` *right now*.
 *
 * Algorithm:
 *   1. Read the org's tier.
 *   2. Count its Pax messages this calendar month.
 *   3. Apply the tier → model + downgrade rules.
 *
 * Any thrown error short-circuits to a fail-open Haiku choice. Callers
 * therefore never need to wrap this function in try/catch.
 */
export async function pickPaxModelForOrg(
  organizationId: number,
): Promise<PaxModelChoice> {
  try {
    const { tier, msgCountThisMonth } = await loadOrgTierAndUsage(organizationId);

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
  } catch (err) {
    // Fail open: never block a chat on a tier-lookup hiccup.
    logger.warn("[pax-tier] pickPaxModelForOrg failed — falling back to Haiku", {
      metadata: {
        organizationId,
        detail: err instanceof Error ? err.message : String(err),
      },
    });
    return {
      model: PAX_MODEL_HAIKU,
      tier: "free",
      reason: "tier_default",
      isDowngraded: false,
      msgCountThisMonth: 0,
    };
  }
}

// ── getPaxMonthlyUsage ───────────────────────────────────────────────────────

/**
 * Surface the org's current Pax cap state for the founder dashboard.
 * Returns the soft cap that applies to the org's tier (Free reports 25 to
 * match the daily Free cap consumers expect to see as a "Pax allowance").
 */
export async function getPaxMonthlyUsage(
  organizationId: number,
): Promise<PaxMonthlyUsage> {
  try {
    const { tier, msgCountThisMonth } = await loadOrgTierAndUsage(organizationId);
    const cap =
      tier === "free"
        ? 25 // daily Free cap (informational here — the daily limiter enforces it)
        : tier === "pro"
        ? MONTHLY_SOFT_CAP_PRO
        : MONTHLY_SOFT_CAP_SCALE;
    const downgraded =
      (tier === "pro" && msgCountThisMonth >= MONTHLY_SOFT_CAP_PRO) ||
      (tier === "scale" && msgCountThisMonth >= MONTHLY_SOFT_CAP_SCALE);
    return { tier, used: msgCountThisMonth, cap, downgraded };
  } catch (err) {
    logger.warn("[pax-tier] getPaxMonthlyUsage failed — returning safe defaults", {
      metadata: {
        organizationId,
        detail: err instanceof Error ? err.message : String(err),
      },
    });
    return { tier: "free", used: 0, cap: 25, downgraded: false };
  }
}
