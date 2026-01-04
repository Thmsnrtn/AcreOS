import { db } from "../storage";
import { organizations, leads, properties, notes, usageEvents } from "@shared/schema";
import { eq, and, gte, count, sum } from "drizzle-orm";

export type SubscriptionTier = "free" | "starter" | "pro" | "scale" | "enterprise";

export type ResourceType = "leads" | "properties" | "notes" | "ai_requests";

export interface TierLimits {
  leads: number | null;
  properties: number | null;
  notes: number | null;
  ai_requests: number | null;
  teamMembers: number | null;
  hasTeamMessaging: boolean;
}

export interface UsageLimitResult {
  allowed: boolean;
  current: number;
  limit: number | null;
  resourceType: ResourceType;
  tier: SubscriptionTier;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    leads: 50,
    properties: 10,
    notes: 5,
    ai_requests: 100,
    teamMembers: 1,
    hasTeamMessaging: false,
  },
  starter: {
    leads: 500,
    properties: 100,
    notes: 50,
    ai_requests: 1000,
    teamMembers: 2,
    hasTeamMessaging: false,
  },
  pro: {
    leads: 5000,
    properties: 1000,
    notes: 500,
    ai_requests: 10000,
    teamMembers: 10,
    hasTeamMessaging: false,
  },
  scale: {
    leads: null,
    properties: null,
    notes: null,
    ai_requests: null,
    teamMembers: 25,
    hasTeamMessaging: true,
  },
  enterprise: {
    leads: null,
    properties: null,
    notes: null,
    ai_requests: null,
    teamMembers: null,
    hasTeamMessaging: true,
  },
};

function normalizeTier(tier: string): SubscriptionTier {
  const normalized = tier.toLowerCase();
  if (normalized === "professional") return "pro";
  if (normalized in TIER_LIMITS) return normalized as SubscriptionTier;
  return "free";
}

async function getOrganizationTier(organizationId: number): Promise<SubscriptionTier> {
  const [org] = await db
    .select({ subscriptionTier: organizations.subscriptionTier })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  
  if (!org) return "free";
  return normalizeTier(org.subscriptionTier);
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

async function getDailyAiRequestCount(organizationId: number): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const [result] = await db
    .select({ total: sum(usageEvents.quantity) })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, organizationId),
        eq(usageEvents.eventType, "ai_request"),
        gte(usageEvents.createdAt, today)
      )
    );
  
  return Number(result?.total ?? 0);
}

export async function checkUsageLimit(
  organizationId: number,
  resourceType: ResourceType
): Promise<UsageLimitResult> {
  const tier = await getOrganizationTier(organizationId);
  const limits = TIER_LIMITS[tier];
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
      current = await getDailyAiRequestCount(organizationId);
      break;
    default:
      current = 0;
  }
  
  const allowed = limit === null || current < limit;
  
  return {
    allowed,
    current,
    limit,
    resourceType,
    tier,
  };
}

export async function getAllUsageLimits(organizationId: number): Promise<{
  tier: SubscriptionTier;
  usage: Record<ResourceType, { current: number; limit: number | null; percentage: number | null }>;
}> {
  const tier = await getOrganizationTier(organizationId);
  const limits = TIER_LIMITS[tier];
  
  const [leadCount, propertyCount, noteCount, aiRequestCount] = await Promise.all([
    getLeadCount(organizationId),
    getPropertyCount(organizationId),
    getNoteCount(organizationId),
    getDailyAiRequestCount(organizationId),
  ]);
  
  const calculatePercentage = (current: number, limit: number | null): number | null => {
    if (limit === null) return null;
    return Math.round((current / limit) * 100);
  };
  
  return {
    tier,
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
    },
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
      ? "daily AI requests" 
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
