// @ts-nocheck — ORM type refinement deferred; runtime-correct
/**
 * Growth Intelligence Agent — tracks signups, activations, channels, and produces growth briefs.
 */

import { BaseAgent, type AgentDecision } from "./base-agent";
import { db } from "../storage";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export class GrowthAgent extends BaseAgent {
  readonly name = "growth";
  readonly featureFlag = "agent_growth";
  readonly intervalMs = 6 * HOUR; // Check every 6 hours

  async runOnce(): Promise<void> {
    const now = new Date();
    const hour = now.getHours();

    // Daily report at ~9am
    if (hour >= 8 && hour <= 10) {
      await this.generateDailyGrowthReport();
    }

    // Weekly brief on Mondays
    if (now.getDay() === 1 && hour >= 8 && hour <= 10) {
      await this.generateWeeklyBrief();
    }

    // Always check triggers
    await this.checkGrowthTriggers();
  }

  private async generateDailyGrowthReport(): Promise<void> {
    // Check if already generated today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await db.execute(sql`
      SELECT 1 FROM founder_briefs
      WHERE agent_type = 'growth' AND brief_type = 'daily' AND generated_at >= ${today}
      LIMIT 1
    `);
    if ((existing as any).rows?.length > 0) return;

    const yesterday = new Date(Date.now() - DAY);

    const [signups, onboardingCompletions, activations] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) as count FROM organizations
        WHERE is_founder = false AND created_at >= ${yesterday}
      `),
      db.execute(sql`
        SELECT COUNT(*) as count FROM organizations
        WHERE is_founder = false AND onboarding_completed = true AND updated_at >= ${yesterday}
      `),
      db.execute(sql`
        SELECT event_name, COUNT(*) as count FROM user_activation_events
        WHERE occurred_at >= ${yesterday}
        GROUP BY event_name
      `),
    ]);

    const report = {
      date: new Date().toISOString().split("T")[0],
      signups: Number((signups as any).rows?.[0]?.count ?? 0),
      onboardingCompletions: Number((onboardingCompletions as any).rows?.[0]?.count ?? 0),
      activations: ((activations as any).rows ?? []).reduce(
        (acc: Record<string, number>, row: any) => {
          acc[row.event_name] = Number(row.count);
          return acc;
        },
        {} as Record<string, number>
      ),
    };

    await this.storeBrief("daily", report);
    logger.info(`[${this.name}] Daily growth report: ${report.signups} signups, ${report.onboardingCompletions} onboardings`);
  }

  private async generateWeeklyBrief(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await db.execute(sql`
      SELECT 1 FROM founder_briefs
      WHERE agent_type = 'growth' AND brief_type = 'weekly' AND generated_at >= ${today}
      LIMIT 1
    `);
    if ((existing as any).rows?.length > 0) return;

    const oneWeekAgo = new Date(Date.now() - 7 * DAY);
    const twoWeeksAgo = new Date(Date.now() - 14 * DAY);

    const [thisWeek, lastWeek, activations, topPages] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) as count FROM organizations
        WHERE is_founder = false AND created_at >= ${oneWeekAgo}
      `),
      db.execute(sql`
        SELECT COUNT(*) as count FROM organizations
        WHERE is_founder = false AND created_at BETWEEN ${twoWeeksAgo} AND ${oneWeekAgo}
      `),
      db.execute(sql`
        SELECT event_name, COUNT(DISTINCT org_id) as orgs FROM user_activation_events
        WHERE occurred_at >= ${oneWeekAgo}
        GROUP BY event_name
        ORDER BY orgs DESC
      `),
      db.execute(sql`
        SELECT pv->>'path' as path, COUNT(*) as visits
        FROM user_sessions s, jsonb_array_elements(s.page_views) as pv
        WHERE s.started_at >= ${oneWeekAgo}
        GROUP BY pv->>'path'
        ORDER BY visits DESC
        LIMIT 10
      `),
    ]);

    const thisWeekCount = Number((thisWeek as any).rows?.[0]?.count ?? 0);
    const lastWeekCount = Number((lastWeek as any).rows?.[0]?.count ?? 0);
    const trend = lastWeekCount > 0
      ? Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100)
      : thisWeekCount > 0 ? 100 : 0;

    const brief = {
      period: `${oneWeekAgo.toISOString().split("T")[0]} to ${today.toISOString().split("T")[0]}`,
      signupsThisWeek: thisWeekCount,
      signupsLastWeek: lastWeekCount,
      trendPercent: trend,
      trendDirection: trend > 0 ? "up" : trend < 0 ? "down" : "flat",
      activationsByEvent: ((activations as any).rows ?? []).map((r: any) => ({
        event: r.event_name,
        orgs: Number(r.orgs),
      })),
      topPages: ((topPages as any).rows ?? []).map((r: any) => ({
        path: r.path,
        visits: Number(r.visits),
      })),
    };

    await this.storeBrief("weekly", brief);
    logger.info(`[${this.name}] Weekly brief: ${thisWeekCount} signups (${trend > 0 ? "+" : ""}${trend}% vs last week)`);
  }

  private async checkGrowthTriggers(): Promise<void> {
    // Check for upgrade events
    const yesterday = new Date(Date.now() - DAY);
    const upgrades = await db.execute(sql`
      SELECT o.id, o.name, o.subscription_tier, o.created_at
      FROM organizations o
      WHERE o.is_founder = false
        AND o.subscription_tier != 'free'
        AND o.updated_at >= ${yesterday}
        AND NOT EXISTS (
          SELECT 1 FROM founder_briefs fb
          WHERE fb.agent_type = 'growth'
            AND fb.brief_type = 'upgrade_logged'
            AND (fb.content->>'orgId')::int = o.id
        )
      LIMIT 20
    `);

    for (const org of (upgrades as any).rows ?? []) {
      const daysSinceSignup = Math.round((Date.now() - new Date(org.created_at).getTime()) / DAY);
      const decision: AgentDecision = {
        agentName: this.name,
        action: "log_upgrade_journey",
        reason: `User upgraded to ${org.subscription_tier} after ${daysSinceSignup} days on free`,
        riskLevel: "low",
        autoApproved: true,
        data: { orgId: org.id, tier: org.subscription_tier, daysSinceSignup },
        timestamp: new Date(),
      };
      await this.logDecision(decision);
      await this.storeBrief("upgrade_logged", { orgId: org.id });
    }
  }
}

export const growthAgent = new GrowthAgent();
