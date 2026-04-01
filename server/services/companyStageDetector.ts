/**
 * Company Stage Detector — Determines the current company lifecycle stage
 * for adaptive Morning Briefing content and dashboard configuration.
 */

import { db } from "../db";
import { organizations } from "@shared/schema";
import { count, sql, gte, isNotNull } from "drizzle-orm";

export type CompanyStage = "pre_launch" | "beta" | "pmf_seeking" | "growth" | "established";

export interface StageInfo {
  stage: CompanyStage;
  totalUsers: number;
  payingUsers: number;
  mrr: number;
  daysActive: number;
  stageLabel: string;
  briefingFocus: string[];
}

const STAGE_LABELS: Record<CompanyStage, string> = {
  pre_launch: "Pre-Launch",
  beta: "Beta",
  pmf_seeking: "PMF Seeking",
  growth: "Growth",
  established: "Established",
};

const BRIEFING_FOCUS: Record<CompanyStage, string[]> = {
  pre_launch: ["deployment_status", "data_source_health", "launch_checklist"],
  beta: ["activation_funnel", "feedback_feed", "top_issues", "session_summaries"],
  pmf_seeking: ["retention_cohorts", "feature_adoption", "nps_proxy", "disappointment_signal"],
  growth: ["financial_dashboard", "channel_attribution", "cac_ltv", "churn", "expansion"],
  established: ["strategic_metrics", "competitive_intel", "market_position"],
};

export async function detectStage(): Promise<StageInfo> {
  try {
    // Count total organizations (users)
    const [totalResult] = await db.select({ count: count() }).from(organizations);
    const totalUsers = totalResult?.count || 0;

    // Count paying users (active subscription, not free tier)
    const [payingResult] = await db.select({ count: count() }).from(organizations)
      .where(sql`${organizations.subscriptionStatus} = 'active' AND ${organizations.subscriptionTier} != 'free'`);
    const payingUsers = payingResult?.count || 0;

    // Estimate MRR from paying users (starter=$20, pro=$49)
    const [starterCount] = await db.select({ count: count() }).from(organizations)
      .where(sql`${organizations.subscriptionTier} = 'starter' AND ${organizations.subscriptionStatus} = 'active'`);
    const [proCount] = await db.select({ count: count() }).from(organizations)
      .where(sql`${organizations.subscriptionTier} = 'pro' AND ${organizations.subscriptionStatus} = 'active'`);
    const mrr = ((starterCount?.count || 0) * 2000) + ((proCount?.count || 0) * 4900); // cents

    // Days since first user
    const [oldest] = await db.select({ created: sql<string>`MIN(${organizations.createdAt})` }).from(organizations);
    const firstSignup = oldest?.created ? new Date(oldest.created) : new Date();
    const daysActive = Math.floor((Date.now() - firstSignup.getTime()) / (24 * 60 * 60 * 1000));

    // Determine stage
    let stage: CompanyStage;
    if (totalUsers === 0) {
      stage = "pre_launch";
    } else if (totalUsers <= 10 && payingUsers === 0) {
      stage = "beta";
    } else if (totalUsers <= 50) {
      stage = "pmf_seeking";
    } else if (payingUsers <= 100) {
      stage = "growth";
    } else {
      stage = "established";
    }

    return {
      stage,
      totalUsers,
      payingUsers,
      mrr,
      daysActive,
      stageLabel: STAGE_LABELS[stage],
      briefingFocus: BRIEFING_FOCUS[stage],
    };
  } catch (err) {
    // Fallback to beta stage on error
    return {
      stage: "beta",
      totalUsers: 0,
      payingUsers: 0,
      mrr: 0,
      daysActive: 0,
      stageLabel: "Beta",
      briefingFocus: BRIEFING_FOCUS.beta,
    };
  }
}
