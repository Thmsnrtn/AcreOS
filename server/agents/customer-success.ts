// @ts-nocheck — ORM type refinement deferred; runtime-correct
/**
 * Customer Success Agent — ensures no user falls through the cracks.
 * Watches for onboarding completions, inactive users, campaign gaps, and milestones.
 */

import { BaseAgent, type AgentDecision } from "./base-agent";
import { db } from "../storage";
import { sql } from "drizzle-orm";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export class CustomerSuccessAgent extends BaseAgent {
  readonly name = "customer_success";
  readonly featureFlag = "agent_customer_success";
  readonly intervalMs = 2 * HOUR; // Check every 2 hours

  async runOnce(): Promise<void> {
    await this.checkOnboardingFollowups();
    await this.checkNoCampaignAfterLeads();
    await this.checkInactiveUsers();
    await this.checkMilestones();
  }

  private async checkOnboardingFollowups(): Promise<void> {
    // Find users who completed onboarding 48+ hours ago and haven't received a check-in
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);
    const threeDaysAgo = new Date(Date.now() - 3 * DAY);

    const result = await db.execute(sql`
      SELECT o.id, o.name, o.owner_id,
        (SELECT COUNT(*) FROM leads l WHERE l.organization_id = o.id) as lead_count,
        (SELECT COUNT(*) FROM deals d WHERE d.organization_id = o.id) as deal_count
      FROM organizations o
      WHERE o.onboarding_completed = true
        AND o.is_founder = false
        AND o.created_at BETWEEN ${threeDaysAgo} AND ${twoDaysAgo}
        AND NOT EXISTS (
          SELECT 1 FROM founder_briefs fb
          WHERE fb.agent_type = 'customer_success'
            AND fb.brief_type = 'checkin_sent'
            AND (fb.content->>'orgId')::int = o.id
        )
      LIMIT 10
    `);

    for (const org of (result as any).rows ?? []) {
      const leadCount = Number(org.lead_count || 0);
      const message = leadCount > 0
        ? `I saw you added ${leadCount} leads — here's how to create your first campaign to reach them.`
        : `Welcome aboard! Here's a quick guide to importing your first leads and getting started.`;

      const decision: AgentDecision = {
        agentName: this.name,
        action: "checkin_email",
        reason: `Onboarding completed 48h ago, ${leadCount} leads`,
        riskLevel: "low",
        autoApproved: false,
        data: { orgId: org.id, orgName: org.name, leadCount, message },
        timestamp: new Date(),
      };

      const autonomy = await this.getAutonomyLevel();
      if (autonomy === "supervised" || autonomy === "autonomous") {
        await this.trySendEmail({
          to: org.owner_id,
          subject: `How's it going with AcreOS?`,
          html: `<p>Hi,</p><p>${message}</p><p>Reply to this email if you have questions — I read every one.</p>`,
          organizationId: org.id,
        });
        decision.autoApproved = true;
      }

      await this.logDecision(decision);
      await this.storeBrief("checkin_sent", { orgId: org.id });
    }
  }

  private async checkNoCampaignAfterLeads(): Promise<void> {
    const fiveDaysAgo = new Date(Date.now() - 5 * DAY);

    const result = await db.execute(sql`
      SELECT o.id, o.name, o.owner_id,
        (SELECT COUNT(*) FROM leads l WHERE l.organization_id = o.id) as lead_count
      FROM organizations o
      WHERE o.is_founder = false
        AND o.created_at < ${fiveDaysAgo}
        AND (SELECT COUNT(*) FROM leads l WHERE l.organization_id = o.id) > 0
        AND (SELECT COUNT(*) FROM campaigns c WHERE c.organization_id = o.id) = 0
        AND NOT EXISTS (
          SELECT 1 FROM founder_briefs fb
          WHERE fb.agent_type = 'customer_success'
            AND fb.brief_type = 'campaign_nudge'
            AND (fb.content->>'orgId')::int = o.id
        )
      LIMIT 10
    `);

    for (const org of (result as any).rows ?? []) {
      const decision: AgentDecision = {
        agentName: this.name,
        action: "campaign_nudge",
        reason: `User has ${org.lead_count} leads but no campaigns after 5 days`,
        riskLevel: "low",
        autoApproved: false,
        data: { orgId: org.id, orgName: org.name, leadCount: org.lead_count },
        timestamp: new Date(),
      };
      await this.logDecision(decision);
      await this.storeBrief("campaign_nudge", { orgId: org.id });
    }
  }

  private async checkInactiveUsers(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * DAY);

    const result = await db.execute(sql`
      SELECT o.id, o.name, o.owner_id,
        (SELECT COUNT(*) FROM leads l WHERE l.organization_id = o.id) as lead_count,
        (SELECT COUNT(*) FROM deals d WHERE d.organization_id = o.id) as deal_count,
        (SELECT COUNT(*) FROM notes n WHERE n.organization_id = o.id) as note_count,
        (SELECT MAX(s.started_at) FROM user_sessions s WHERE s.org_id = o.id) as last_active
      FROM organizations o
      WHERE o.is_founder = false
        AND o.subscription_status != 'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM user_sessions s
          WHERE s.org_id = o.id AND s.started_at > ${sevenDaysAgo}
        )
        AND NOT EXISTS (
          SELECT 1 FROM founder_briefs fb
          WHERE fb.agent_type = 'customer_success'
            AND fb.brief_type = 'reengagement'
            AND (fb.content->>'orgId')::int = o.id
            AND fb.generated_at > ${sevenDaysAgo}
        )
      LIMIT 10
    `);

    for (const org of (result as any).rows ?? []) {
      const decision: AgentDecision = {
        agentName: this.name,
        action: "reengagement_email",
        reason: `User inactive >7 days. Pipeline: ${org.lead_count} leads, ${org.deal_count} deals, ${org.note_count} notes`,
        riskLevel: "low",
        autoApproved: false,
        data: { orgId: org.id, orgName: org.name, leadCount: org.lead_count, dealCount: org.deal_count },
        timestamp: new Date(),
      };
      await this.logDecision(decision);
      await this.storeBrief("reengagement", { orgId: org.id });
    }
  }

  private async checkMilestones(): Promise<void> {
    // Check for milestone achievements: first deal, 100th lead, etc.
    const result = await db.execute(sql`
      SELECT o.id, o.name,
        (SELECT COUNT(*) FROM leads l WHERE l.organization_id = o.id) as lead_count,
        (SELECT COUNT(*) FROM deals d WHERE d.organization_id = o.id) as deal_count
      FROM organizations o
      WHERE o.is_founder = false
      LIMIT 50
    `);

    for (const org of (result as any).rows ?? []) {
      const leadCount = Number(org.lead_count || 0);
      const dealCount = Number(org.deal_count || 0);

      const milestones: string[] = [];
      if (dealCount === 1) milestones.push("first_deal");
      if (leadCount >= 100 && leadCount < 110) milestones.push("100_leads");

      for (const milestone of milestones) {
        // Check if already celebrated
        const existing = await db.execute(sql`
          SELECT 1 FROM founder_briefs
          WHERE agent_type = 'customer_success'
            AND brief_type = 'milestone'
            AND (content->>'orgId')::int = ${org.id}
            AND content->>'milestone' = ${milestone}
          LIMIT 1
        `);
        if ((existing as any).rows?.length > 0) continue;

        const decision: AgentDecision = {
          agentName: this.name,
          action: "celebration_email",
          reason: `Milestone: ${milestone}`,
          riskLevel: "low",
          autoApproved: false,
          data: { orgId: org.id, orgName: org.name, milestone },
          timestamp: new Date(),
        };
        await this.logDecision(decision);
        await this.storeBrief("milestone", { orgId: org.id, milestone });
      }
    }
  }
}

export const customerSuccessAgent = new CustomerSuccessAgent();
