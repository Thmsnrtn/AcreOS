import { db } from "../storage";
import { organizations } from "@shared/schema";
import { eq, and, lt, isNotNull, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

const TRIAL_DURATION_DAYS = 14;

export interface TrialStatus {
  isTrialing: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  daysRemaining: number;
  trialUsed: boolean;
  eligible: boolean; // Can start a trial (hasn't used one yet)
}

/**
 * Computes trial status for an organization.
 */
export async function getTrialStatus(organizationId: number): Promise<TrialStatus> {
  const [org] = await db
    .select({
      trialStartedAt: organizations.trialStartedAt,
      trialEndsAt: organizations.trialEndsAt,
      trialUsed: organizations.trialUsed,
      subscriptionTier: organizations.subscriptionTier,
      subscriptionStatus: organizations.subscriptionStatus,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));

  if (!org) {
    return { isTrialing: false, trialStartedAt: null, trialEndsAt: null, daysRemaining: 0, trialUsed: true, eligible: false };
  }

  const now = new Date();
  const isTrialing = !!(org.trialEndsAt && org.trialEndsAt > now && org.subscriptionStatus === "trialing");
  const daysRemaining = org.trialEndsAt
    ? Math.max(0, Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    isTrialing,
    trialStartedAt: org.trialStartedAt,
    trialEndsAt: org.trialEndsAt,
    daysRemaining: isTrialing ? daysRemaining : 0,
    trialUsed: org.trialUsed || false,
    eligible: !org.trialUsed && org.subscriptionTier === "free",
  };
}

/**
 * Starts a 14-day trial for an organization. Sets subscription to "trialing" with the
 * chosen tier (starter or pro) so usageLimits gives them elevated access.
 */
export async function startTrial(
  organizationId: number,
  tier: "starter" | "pro" = "starter"
): Promise<TrialStatus> {
  const status = await getTrialStatus(organizationId);
  if (status.trialUsed) {
    throw new Error("This organization has already used its free trial.");
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await db
    .update(organizations)
    .set({
      trialStartedAt: now,
      trialEndsAt: endsAt,
      trialUsed: true,
      subscriptionTier: tier,
      subscriptionStatus: "trialing",
    })
    .where(eq(organizations.id, organizationId));

  return {
    isTrialing: true,
    trialStartedAt: now,
    trialEndsAt: endsAt,
    daysRemaining: TRIAL_DURATION_DAYS,
    trialUsed: true,
    eligible: false,
  };
}

/**
 * Expires all organizations whose trial has ended. Resets them to free tier.
 * Should be called periodically (e.g. by the operations agent or a cron).
 */
export async function expireTrials(): Promise<number> {
  const now = new Date();

  const result = await db
    .update(organizations)
    .set({
      subscriptionTier: "free",
      subscriptionStatus: "active",
    })
    .where(
      and(
        eq(organizations.subscriptionStatus, "trialing"),
        lt(organizations.trialEndsAt, now)
      )
    );

  const count = (result as any).rowCount ?? 0;
  if (count > 0) {
    console.log(`[trialService] Expired ${count} trial(s)`);
  }
  return count;
}

export const trialService = {
  getTrialStatus,
  startTrial,
  expireTrials,
  TRIAL_DURATION_DAYS,
};
