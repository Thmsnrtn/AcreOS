import { db } from "../storage";
import { organizations, leads, properties, notes, campaigns, usageEvents } from "@shared/schema";
import { eq, and, gte, count, sum } from "drizzle-orm";
// Lens 3 (Pricing Coherence): tier limits live in shared/billing so the
// pricing page, upgrade modal, and server gate can never drift. Re-exported
// from this module for back-compat with existing imports.
import {
  TIER_LIMITS,
  FOUNDER_TIER_LIMITS,
  PRICING_FEATURE_FLAGS,
  AI_TURNS_BYOK_WARN_RATIO,
  isTierVisible,
  getVisibleTiers,
  type SubscriptionTier,
  type ResourceType,
  type TierLimits,
} from "@shared/billing/tier-limits";
import { logger } from "../utils/logger";

export {
  TIER_LIMITS,
  FOUNDER_TIER_LIMITS,
  PRICING_FEATURE_FLAGS,
  isTierVisible,
  getVisibleTiers,
};
export type { SubscriptionTier, ResourceType, TierLimits };

export interface UsageLimitResult {
  allowed: boolean;
  current: number;
  limit: number | null;
  resourceType: ResourceType;
  tier: SubscriptionTier;
}

function normalizeTier(tier: string): SubscriptionTier {
  const normalized = tier.toLowerCase();
  if (normalized === "professional") return "pro";
  if (normalized in TIER_LIMITS) return normalized as SubscriptionTier;
  return "free";
}

async function getOrganizationTierAndFounderStatus(organizationId: number): Promise<{ tier: SubscriptionTier; isFounder: boolean; isTrialing: boolean }> {
  const [org] = await db
    .select({
      subscriptionTier: organizations.subscriptionTier,
      subscriptionStatus: organizations.subscriptionStatus,
      isFounder: organizations.isFounder,
      trialEndsAt: organizations.trialEndsAt,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));

  if (!org) return { tier: "free", isFounder: false, isTrialing: false };

  const isTrialing = org.subscriptionStatus === "trialing" &&
    !!org.trialEndsAt && org.trialEndsAt > new Date();

  return {
    tier: normalizeTier(org.subscriptionTier),
    isFounder: org.isFounder || false,
    isTrialing,
  };
}

async function getLeadCount(organizationId: number): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(leads)
    .where(eq(leads.organizationId, organizationId));
  return result?.count ?? 0;
}

async function getPropertyCount(organizationId: number): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(properties)
    .where(eq(properties.organizationId, organizationId));
  return result?.count ?? 0;
}

async function getNoteCount(organizationId: number): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(notes)
    .where(eq(notes.organizationId, organizationId));
  return result?.count ?? 0;
}

async function getCampaignCount(organizationId: number): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(campaigns)
    .where(eq(campaigns.organizationId, organizationId));
  return result?.count ?? 0;
}

/**
 * Sum of Pax message turns ("ai_request" usage events) inside the current
 * calendar-month window.
 *
 * Window correction (2026-06-06): this used to be a daily window
 * (`getMonthlyAiRequestCount`) which combined with a 500/day Starter cap
 * produced a -980% gross margin (~$225/mo COGS at full utilization vs
 * $16.67/mo billed revenue). The window is now monthly to match the cap
 * semantics in `TIER_LIMITS[*].ai_requests` and the customer's mental
 * model of "messages per billing cycle". Rolling 30 days would be more
 * forgiving but billing cycles are anchored to calendar months on Stripe
 * subscriptions, so the calendar-month window keeps the two in sync.
 */
async function getMonthlyAiRequestCount(organizationId: number): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const [result] = await db
    .select({ total: sum(usageEvents.quantity) })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, organizationId),
        eq(usageEvents.eventType, "ai_request"),
        gte(usageEvents.createdAt, monthStart)
      )
    );

  return Number(result?.total ?? 0);
}

export interface UsageLimitOptions {
  isFounder?: boolean;
}

export async function checkUsageLimit(
  organizationId: number,
  resourceType: ResourceType,
  options: UsageLimitOptions = {}
): Promise<UsageLimitResult> {
  const { tier, isFounder: orgIsFounder } = await getOrganizationTierAndFounderStatus(organizationId);
  const isFounder = options.isFounder ?? orgIsFounder;
  
  // Founders have unlimited access
  const limits = isFounder ? FOUNDER_TIER_LIMITS : TIER_LIMITS[tier];
  const limit = limits[resourceType];
  
  let current: number;
  
  switch (resourceType) {
    case "leads":
      current = await getLeadCount(organizationId);
      break;
    case "properties":
      current = await getPropertyCount(organizationId);
      break;
    case "notes":
      current = await getNoteCount(organizationId);
      break;
    case "ai_requests":
      current = await getMonthlyAiRequestCount(organizationId);
      break;
    case "campaigns":
      // Without this counter `current` fell through to 0, so a campaigns
      // gate could never trip a paid tier's cap (WS1, 2026-07-07 — the same
      // pass that added the missing usageLimitGate to POST /api/campaigns).
      current = await getCampaignCount(organizationId);
      break;
    default:
      current = 0;
  }
  
  // Founders are always allowed
  let allowed = isFounder || limit === null || current < limit;

  // Tier 1I (Economics guardrail): an active AI BYOK credential lifts the
  // platform `ai_requests` cap entirely — those turns route through the
  // customer's own key (zero platform COGS), so capping them would punish
  // exactly the orgs that took the BYOK path. Checked lazily (only when the
  // cap would otherwise block) to keep the hot path one query lighter.
  if (!allowed && resourceType === "ai_requests") {
    try {
      const { getActiveAiByokChannel } = await import("./byok/aiByok");
      if (await getActiveAiByokChannel(organizationId)) {
        allowed = true;
      }
    } catch {
      // BYOK lookup failed — keep the cap (safe default).
    }
  }

  return {
    allowed,
    current,
    limit,
    resourceType,
    tier: isFounder ? "enterprise" : tier, // Show enterprise tier for founders
  };
}

export async function getAllUsageLimits(
  organizationId: number,
  options: UsageLimitOptions = {}
): Promise<{
  tier: SubscriptionTier;
  usage: Record<ResourceType, { current: number; limit: number | null; percentage: number | null }>;
  isFounder?: boolean;
  /**
   * Tier 1I — monthly AI-turn BYOK threshold snapshot for the client
   * (Pax banner at ≥80%, blocked state with a CTA to /settings/byok).
   */
  aiTurns: {
    current: number;
    threshold: number | null;
    percentage: number | null;
    /** True at ≥ AI_TURNS_BYOK_WARN_RATIO of the threshold (not blocked yet). */
    warning: boolean;
    /** True at/past the threshold without an active AI key. */
    blocked: boolean;
    byokActive: boolean;
    byokAvailable: boolean;
    byokSettingsUrl: string;
  };
}> {
  const { tier, isFounder: orgIsFounder } = await getOrganizationTierAndFounderStatus(organizationId);
  const isFounder = options.isFounder ?? orgIsFounder;
  const limits = isFounder ? FOUNDER_TIER_LIMITS : TIER_LIMITS[tier];

  const [leadCount, propertyCount, noteCount, aiRequestCount, campaignCount] = await Promise.all([
    getLeadCount(organizationId),
    getPropertyCount(organizationId),
    getNoteCount(organizationId),
    getMonthlyAiRequestCount(organizationId),
    getCampaignCount(organizationId),
  ]);

  // Tier 1I — BYOK threshold snapshot (reuses the same monthly turn count).
  let aiByokActive = false;
  if (!isFounder) {
    try {
      const { getActiveAiByokChannel } = await import("./byok/aiByok");
      aiByokActive = (await getActiveAiByokChannel(organizationId)) !== null;
    } catch {
      aiByokActive = false;
    }
  }
  const aiThreshold = limits.aiTurnsByokThreshold;
  const aiBlocked = !isFounder && !aiByokActive && aiThreshold !== null && aiRequestCount >= aiThreshold;
  const aiWarning = !isFounder && !aiByokActive && !aiBlocked && aiThreshold !== null
    && aiRequestCount >= aiThreshold * AI_TURNS_BYOK_WARN_RATIO;

  const calculatePercentage = (current: number, limit: number | null): number | null => {
    if (limit === null) return null;
    return Math.round((current / limit) * 100);
  };

  return {
    aiTurns: {
      current: aiRequestCount,
      threshold: aiThreshold,
      percentage: calculatePercentage(aiRequestCount, aiThreshold),
      warning: aiWarning,
      blocked: aiBlocked,
      byokActive: aiByokActive,
      byokAvailable: limits.byokSupport || tier === "starter",
      byokSettingsUrl: "/settings/byok",
    },
    tier: isFounder ? "enterprise" : tier,
    isFounder,
    usage: {
      leads: {
        current: leadCount,
        limit: limits.leads,
        percentage: calculatePercentage(leadCount, limits.leads),
      },
      properties: {
        current: propertyCount,
        limit: limits.properties,
        percentage: calculatePercentage(propertyCount, limits.properties),
      },
      notes: {
        current: noteCount,
        limit: limits.notes,
        percentage: calculatePercentage(noteCount, limits.notes),
      },
      ai_requests: {
        current: aiRequestCount,
        limit: limits.ai_requests,
        percentage: calculatePercentage(aiRequestCount, limits.ai_requests),
      },
      campaigns: {
        current: campaignCount,
        limit: limits.campaigns,
        percentage: calculatePercentage(campaignCount, limits.campaigns),
      },
    },
  };
}

// ============================================
// TIER 1I — AI-TURN BYOK THRESHOLD GATE (2026-06-10)
// ============================================
//
// Founder decision: mandatory BYOK past a generous monthly turn threshold —
// NOT a hard ceiling, NOT metered overage. Below the per-tier threshold
// (TIER_LIMITS[*].aiTurnsByokThreshold) Pax turns ride the platform key.
// Past it, the org must add their own AI key (Settings → Your provider
// keys) — and with a key configured, usage is unlimited at zero platform
// COGS. Existing drafts/conversations stay readable either way; only NEW
// AI turns are gated.

export interface AiTurnGateResult {
  allowed: boolean;
  /** Why a refusal happened. `byok_required` is the threshold wall. */
  reason?: "byok_required";
  /** How this org's AI calls are billed/routed right now. */
  mode: "founder" | "byok" | "platform";
  /** Pax turns consumed this calendar month. */
  current: number;
  /** The tier's BYOK threshold (null = no threshold for this tier). */
  threshold: number | null;
  /** True at ≥ AI_TURNS_BYOK_WARN_RATIO of the threshold (and not blocked). */
  warning: boolean;
  /** Whether this tier can self-serve a BYOK key for AI channels. */
  byokAvailable: boolean;
  /** Whether an active AI BYOK credential exists. */
  byokActive: boolean;
  tier: SubscriptionTier;
}

/**
 * Threshold-crossing telemetry — structured log + one system_alerts row per
 * org per calendar month (the growth machine consumes this signal). Best
 * effort: never throws into the gate.
 */
async function recordAiByokThresholdCrossing(args: {
  organizationId: number;
  tier: SubscriptionTier;
  current: number;
  threshold: number;
}): Promise<void> {
  const { organizationId, tier, current, threshold } = args;
  logger.warn("[ai-turns] org crossed monthly BYOK threshold", {
    organizationId,
    metadata: { tier, current, threshold, signal: "ai_byok_threshold_crossed" },
  });
  try {
    const { systemAlerts } = await import("@shared/schema");
    const { eq: eqOp, and: andOp, gte: gteOp } = await import("drizzle-orm");
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    // Dedup: one alert per org per month.
    const existing = await db
      .select({ id: systemAlerts.id })
      .from(systemAlerts)
      .where(
        andOp(
          eqOp(systemAlerts.organizationId, organizationId),
          eqOp(systemAlerts.type, "ai_byok_threshold_crossed"),
          gteOp(systemAlerts.createdAt, monthStart),
        ),
      );
    if (existing.length > 0) return;
    await db.insert(systemAlerts).values({
      type: "ai_byok_threshold_crossed",
      alertType: "revenue_at_risk",
      severity: "warning",
      title: "Org crossed monthly AI-turn BYOK threshold",
      message:
        `Org ${organizationId} (${tier}) used ${current} Pax turns this month — past the ` +
        `${threshold}-turn included allotment. Without BYOK their AI calls are paused; ` +
        `this is a prime BYOK-onboarding / expansion conversation.`,
      organizationId,
      relatedEntityType: "organization",
      relatedEntityId: organizationId,
      metadata: { tier, current, threshold },
    });
  } catch (err) {
    logger.warn(
      "[ai-turns] failed to write threshold-crossing alert (non-blocking)",
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * The Tier 1I gate every AI-turn route consults before spending platform
 * AI dollars. Resolution order:
 *
 *   founder            → allowed (mode "founder")
 *   active AI BYOK key → allowed, unlimited (mode "byok", their key/spend)
 *   tier threshold null→ allowed (the plain ai_requests cap governs)
 *   under threshold    → allowed; `warning` at ≥ 80%
 *   at/past threshold  → refused with reason "byok_required"
 */
export async function checkAiTurnGate(
  organizationId: number,
  options: UsageLimitOptions = {},
): Promise<AiTurnGateResult> {
  const { tier, isFounder: orgIsFounder } = await getOrganizationTierAndFounderStatus(organizationId);
  const isFounder = options.isFounder ?? orgIsFounder;
  const limits = isFounder ? FOUNDER_TIER_LIMITS : TIER_LIMITS[tier];
  const byokAvailable = limits.byokSupport || tier === "starter"; // AI channels open to all paid tiers
  const threshold = limits.aiTurnsByokThreshold;

  if (isFounder) {
    return {
      allowed: true,
      mode: "founder",
      current: 0,
      threshold: null,
      warning: false,
      byokAvailable: true,
      byokActive: false,
      tier: "enterprise",
    };
  }

  let byokActive = false;
  try {
    const { getActiveAiByokChannel } = await import("./byok/aiByok");
    byokActive = (await getActiveAiByokChannel(organizationId)) !== null;
  } catch {
    byokActive = false; // lookup hiccup → platform path (threshold applies)
  }

  const current = await getMonthlyAiRequestCount(organizationId);

  if (byokActive) {
    return {
      allowed: true,
      mode: "byok",
      current,
      threshold,
      warning: false,
      byokAvailable,
      byokActive: true,
      tier,
    };
  }

  if (threshold === null) {
    return {
      allowed: true,
      mode: "platform",
      current,
      threshold: null,
      warning: false,
      byokAvailable,
      byokActive: false,
      tier,
    };
  }

  const blocked = current >= threshold;
  const warning = !blocked && current >= threshold * AI_TURNS_BYOK_WARN_RATIO;

  if (blocked) {
    // Fire-and-forget — never let telemetry slow or fail the gate.
    void recordAiByokThresholdCrossing({ organizationId, tier, current, threshold });
  }

  return {
    allowed: !blocked,
    ...(blocked ? { reason: "byok_required" as const } : {}),
    mode: "platform",
    current,
    threshold,
    warning,
    byokAvailable,
    byokActive: false,
    tier,
  };
}

export class UsageLimitError extends Error {
  public statusCode = 429;
  public current: number;
  public limit: number;
  public resourceType: ResourceType;
  public tier: SubscriptionTier;
  
  constructor(result: UsageLimitResult) {
    const resourceLabel = result.resourceType === "ai_requests"
      ? "monthly Pax messages"
      : result.resourceType;
    
    super(
      `You have reached your ${resourceLabel} limit (${result.current}/${result.limit}). ` +
      `Upgrade your plan to continue adding ${resourceLabel}.`
    );
    
    this.current = result.current;
    this.limit = result.limit!;
    this.resourceType = result.resourceType;
    this.tier = result.tier;
  }
}

// ============================================
// SEAT MANAGEMENT
// ============================================

export interface SeatInfo {
  tier: SubscriptionTier;
  includedSeats: number;
  additionalSeats: number;
  totalSeats: number;
  maxSeats: number | null;
  usedSeats: number;
  availableSeats: number;
  canAddSeats: boolean;
  seatPriceCents: number | null;
  hasTeamMessaging: boolean;
}

async function getOrganizationSeatData(organizationId: number): Promise<{
  tier: SubscriptionTier;
  additionalSeats: number;
  isFounder: boolean;
}> {
  const [org] = await db
    .select({ 
      subscriptionTier: organizations.subscriptionTier,
      additionalSeats: organizations.additionalSeats,
      isFounder: organizations.isFounder 
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  
  if (!org) return { tier: "free", additionalSeats: 0, isFounder: false };
  return {
    tier: normalizeTier(org.subscriptionTier),
    additionalSeats: org.additionalSeats || 0,
    isFounder: org.isFounder || false,
  };
}

async function getTeamMemberCount(organizationId: number): Promise<number> {
  const { teamMembers } = await import("@shared/schema");
  const [result] = await db
    .select({ count: count() })
    .from(teamMembers)
    .where(eq(teamMembers.organizationId, organizationId));
  return result?.count ?? 0;
}

export async function getSeatInfo(
  organizationId: number,
  options: UsageLimitOptions = {}
): Promise<SeatInfo & { isFounder?: boolean }> {
  const { tier, additionalSeats, isFounder: orgIsFounder } = await getOrganizationSeatData(organizationId);
  const isFounder = options.isFounder ?? orgIsFounder;
  
  // Founders have unlimited access
  if (isFounder) {
    const usedSeats = await getTeamMemberCount(organizationId);
    return {
      tier: "enterprise",
      includedSeats: 1000,
      additionalSeats: 0,
      totalSeats: 1000,
      maxSeats: null,
      usedSeats,
      availableSeats: 1000 - usedSeats,
      canAddSeats: false, // Founders don't need to add seats
      seatPriceCents: null,
      hasTeamMessaging: true,
      isFounder: true,
    };
  }
  
  const limits = TIER_LIMITS[tier];
  const usedSeats = await getTeamMemberCount(organizationId);
  
  const includedSeats = limits.includedSeats;
  const totalSeats = includedSeats + additionalSeats;
  const maxSeats = limits.maxSeats;
  const availableSeats = totalSeats - usedSeats;
  const canAddSeats = limits.seatPriceCents !== null && (maxSeats === null || totalSeats < maxSeats);
  
  // Team messaging is available if the org has 2+ total seats
  const hasTeamMessaging = totalSeats >= 2;
  
  return {
    tier,
    includedSeats,
    additionalSeats,
    totalSeats,
    maxSeats,
    usedSeats,
    availableSeats,
    canAddSeats,
    seatPriceCents: limits.seatPriceCents,
    hasTeamMessaging,
  };
}

export async function checkTeamMessagingAccess(
  organizationId: number,
  options: UsageLimitOptions = {}
): Promise<boolean> {
  const seatInfo = await getSeatInfo(organizationId, options);
  // Founders always have team messaging access (handled in getSeatInfo)
  return seatInfo.hasTeamMessaging;
}

export async function canAddMoreSeats(organizationId: number, seatsToAdd: number = 1): Promise<{
  allowed: boolean;
  reason?: string;
  currentTotal: number;
  maxSeats: number | null;
}> {
  const seatInfo = await getSeatInfo(organizationId);
  
  if (seatInfo.seatPriceCents === null) {
    return {
      allowed: false,
      reason: "Your plan does not support additional seats. Please upgrade.",
      currentTotal: seatInfo.totalSeats,
      maxSeats: seatInfo.maxSeats,
    };
  }
  
  if (seatInfo.maxSeats !== null && seatInfo.totalSeats + seatsToAdd > seatInfo.maxSeats) {
    return {
      allowed: false,
      reason: `Adding ${seatsToAdd} seat(s) would exceed your plan's maximum of ${seatInfo.maxSeats} seats.`,
      currentTotal: seatInfo.totalSeats,
      maxSeats: seatInfo.maxSeats,
    };
  }
  
  return {
    allowed: true,
    currentTotal: seatInfo.totalSeats,
    maxSeats: seatInfo.maxSeats,
  };
}
