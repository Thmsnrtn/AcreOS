// @ts-nocheck — ORM type refinement deferred; runtime-correct
/**
 * Revenue Operations Agent — monitors MRR, usage limits, payment failures, and upgrade opportunities.
 */

import { BaseAgent, type AgentDecision } from "./base-agent";
import { db } from "../storage";
import { sql } from "drizzle-orm";
import { TIER_LIMITS, type SubscriptionTier } from "../services/usageLimits";
import { logger } from "../utils/logger";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TIER_PRICES: Record<string, number> = {
  starter: 2000,
  pro: 4900,
  scale: 39900,
  enterprise: 79900,
};

export class RevenueAgent extends BaseAgent {
  readonly name = "revenue";
  readonly featureFlag = "agent_revenue";
  readonly intervalMs = 4 * HOUR; // Check every 4 hours

  async runOnce(): Promise<void> {
    await this.checkUsageLimits();
    await this.checkPaymentFailures();

    // Weekly revenue brief on Mondays
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() >= 8 && now.getHours() <= 10) {
      await this.generateWeeklyRevenueBrief();
    }
  }

  private async checkUsageLimits(): Promise<void> {
    // Find users at >80% of any tier limit
    const orgs = await db.execute(sql`
      SELECT o.id, o.name, o.owner_id, o.subscription_tier,
        (SELECT COUNT(*) FROM leads l WHERE l.organization_id = o.id) as lead_count,
        (SELECT COUNT(*) FROM properties p WHERE p.organization_id = o.id) as property_count,
        (SELECT COUNT(*) FROM notes n WHERE n.organization_id = o.id) as note_count
      FROM organizations o
      WHERE o.is_founder = false
        AND o.subscription_status = 'active'
        AND o.subscription_tier IN ('free', 'starter', 'pro')
      LIMIT 100
    `);

    for (const org of (orgs as any).rows ?? []) {
      const tier = org.subscription_tier as SubscriptionTier;
      const limits = TIER_LIMITS[tier];
      if (!limits) continue;

      const checks = [
        { resource: "leads", current: Number(org.lead_count), limit: limits.leads },
        { resource: "properties", current: Number(org.property_count), limit: limits.properties },
        { resource: "notes", current: Number(org.note_count), limit: limits.notes },
      ];

      for (const check of checks) {
        if (check.limit === null) continue;
        const pct = Math.round((check.current / check.limit) * 100);
        if (pct >= 80) {
          // Check if we already flagged this
          const existing = await db.execute(sql`
            SELECT 1 FROM founder_briefs
            WHERE agent_type = 'revenue'
              AND brief_type = 'upgrade_nudge'
              AND (content->>'orgId')::int = ${org.id}
              AND (content->>'resource') = ${check.resource}
              AND generated_at > ${new Date(Date.now() - 7 * DAY)}
            LIMIT 1
          `);
          if ((existing as any).rows?.length > 0) continue;

          const decision: AgentDecision = {
            agentName: this.name,
            action: "upgrade_nudge",
            reason: `${org.name} at ${pct}% of ${check.resource} limit (${check.current}/${check.limit})`,
            riskLevel: "low",
            autoApproved: false,
            data: { orgId: org.id, resource: check.resource, current: check.current, limit: check.limit, pct, tier },
            timestamp: new Date(),
          };
          await this.logDecision(decision);
          await this.storeBrief("upgrade_nudge", {
            orgId: org.id,
            resource: check.resource,
            current: check.current,
            limit: check.limit,
            pct,
          });
        }
      }
    }
  }

  private async checkPaymentFailures(): Promise<void> {
    const threeDaysAgo = new Date(Date.now() - 3 * DAY);

    const failures = await db.execute(sql`
      SELECT o.id, o.name, o.owner_id, o.last_payment_failed_at, o.dunning_stage
      FROM organizations o
      WHERE o.is_founder = false
        AND o.last_payment_failed_at IS NOT NULL
        AND o.last_payment_failed_at < ${threeDaysAgo}
        AND o.dunning_stage != 'none'
        AND NOT EXISTS (
          SELECT 1 FROM founder_briefs fb
          WHERE fb.agent_type = 'revenue'
            AND fb.brief_type = 'payment_failure_alert'
            AND (fb.content->>'orgId')::int = o.id
            AND fb.generated_at > ${threeDaysAgo}
        )
      LIMIT 10
    `);

    for (const org of (failures as any).rows ?? []) {
      const decision: AgentDecision = {
        agentName: this.name,
        action: "payment_failure_alert",
        reason: `Payment failed ${Math.round((Date.now() - new Date(org.last_payment_failed_at).getTime()) / DAY)} days ago, dunning: ${org.dunning_stage}`,
        riskLevel: "high",
        autoApproved: false,
        data: { orgId: org.id, orgName: org.name, dunningStage: org.dunning_stage },
        timestamp: new Date(),
      };
      await this.logDecision(decision);
      await this.storeBrief("payment_failure_alert", { orgId: org.id });
    }
  }

  private async generateWeeklyRevenueBrief(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await db.execute(sql`
      SELECT 1 FROM founder_briefs
      WHERE agent_type = 'revenue' AND brief_type = 'weekly' AND generated_at >= ${today}
      LIMIT 1
    `);
    if ((existing as any).rows?.length > 0) return;

    const paying = await db.execute(sql`
      SELECT subscription_tier, COUNT(*) as count
      FROM organizations
      WHERE is_founder = false AND subscription_status = 'active' AND subscription_tier != 'free'
      GROUP BY subscription_tier
    `);

    let mrr = 0;
    let payingCustomers = 0;
    for (const row of (paying as any).rows ?? []) {
      const price = TIER_PRICES[row.subscription_tier] || 0;
      const cnt = Number(row.count || 0);
      mrr += price * cnt;
      payingCustomers += cnt;
    }
    const arpu = payingCustomers > 0 ? Math.round(mrr / payingCustomers) : 0;

    const brief = {
      period: today.toISOString().split("T")[0],
      mrrCents: mrr,
      mrrFormatted: `$${(mrr / 100).toFixed(2)}`,
      payingCustomers,
      arpuCents: arpu,
      arpuFormatted: `$${(arpu / 100).toFixed(2)}`,
      tierBreakdown: ((paying as any).rows ?? []).map((r: any) => ({
        tier: r.subscription_tier,
        count: Number(r.count),
      })),
    };

    await this.storeBrief("weekly", brief);
    logger.info(`[${this.name}] Weekly revenue: MRR ${brief.mrrFormatted}, ${payingCustomers} paying`);
  }
}

export const revenueAgent = new RevenueAgent();
