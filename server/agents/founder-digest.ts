/**
 * Founder Daily Digest Agent — aggregates all agent activity into a single daily briefing.
 */

import { BaseAgent } from "./base-agent";
import { db } from "../storage";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export class FounderDigestAgent extends BaseAgent {
  readonly name = "digest";
  readonly featureFlag = "agent_digest";
  readonly intervalMs = 1 * HOUR; // Check every hour, but only generate once daily

  async runOnce(): Promise<void> {
    const now = new Date();
    // Generate digest around 8am (configurable via org timezone later)
    if (now.getHours() < 7 || now.getHours() > 9) return;

    await this.generateDailyDigest();
  }

  private async generateDailyDigest(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if already generated today
    const existing = await db.execute(sql`
      SELECT 1 FROM founder_briefs
      WHERE agent_type = 'digest' AND brief_type = 'daily_digest' AND generated_at >= ${today}
      LIMIT 1
    `);
    if ((existing as any).rows?.length > 0) return;

    const yesterday = new Date(Date.now() - DAY);

    // Gather data from all agents
    const [growthBrief, revenueBrief, customerDecisions, opsBrief, pendingDecisions] = await Promise.all([
      this.getLatestBrief("growth", "daily"),
      this.getLatestBrief("revenue", "weekly"),
      this.getRecentDecisions("customer_success", yesterday),
      this.getLatestBrief("operations", "daily"),
      this.getPendingApprovals(),
    ]);

    // Gather org counts
    const [signups, activeUsers] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) as count FROM organizations
        WHERE is_founder = false AND created_at >= ${yesterday}
      `),
      db.execute(sql`
        SELECT COUNT(DISTINCT org_id) as count FROM user_sessions
        WHERE started_at >= ${yesterday}
      `),
    ]);

    const digest = {
      date: new Date().toISOString().split("T")[0],
      sections: {
        growth: {
          newSignups: Number((signups as any).rows?.[0]?.count ?? 0),
          activeUsers: Number((activeUsers as any).rows?.[0]?.count ?? 0),
          ...(growthBrief || {}),
        },
        revenue: revenueBrief || { message: "No revenue data yet" },
        customers: {
          decisions: customerDecisions,
          emailsSent: customerDecisions.filter((d: any) => d.autoApproved).length,
          emailsQueued: customerDecisions.filter((d: any) => !d.autoApproved).length,
        },
        operations: opsBrief || { message: "No ops data yet" },
        needsAttention: pendingDecisions,
      },
    };

    await this.storeBrief("daily_digest", digest);

    // Try to email the digest to the founder
    const founder = await db.execute(sql`
      SELECT o.owner_id, o.name FROM organizations o WHERE o.is_founder = true LIMIT 1
    `);

    if ((founder as any).rows?.length > 0) {
      const f = (founder as any).rows[0];
      const html = this.formatDigestEmail(digest);
      await this.trySendEmail({
        to: f.owner_id,
        subject: `AcreOS Daily Briefing — ${digest.date}`,
        html,
      });
    }

    logger.info(`[${this.name}] Daily digest generated for ${digest.date}`);
  }

  private async getLatestBrief(agentType: string, briefType: string): Promise<any> {
    const result = await db.execute(sql`
      SELECT content FROM founder_briefs
      WHERE agent_type = ${agentType} AND brief_type = ${briefType}
      ORDER BY generated_at DESC LIMIT 1
    `);
    return (result as any).rows?.[0]?.content || null;
  }

  private async getRecentDecisions(agentType: string, since: Date): Promise<any[]> {
    const result = await db.execute(sql`
      SELECT content FROM founder_briefs
      WHERE agent_type = ${agentType} AND brief_type = 'decision' AND generated_at >= ${since}
      ORDER BY generated_at DESC LIMIT 20
    `);
    return ((result as any).rows ?? []).map((r: any) => r.content);
  }

  private async getPendingApprovals(): Promise<any[]> {
    const result = await db.execute(sql`
      SELECT content FROM founder_briefs
      WHERE brief_type = 'decision'
        AND (content->>'autoApproved')::boolean = false
        AND generated_at > ${new Date(Date.now() - 7 * DAY)}
      ORDER BY generated_at DESC LIMIT 10
    `);
    return ((result as any).rows ?? []).map((r: any) => r.content);
  }

  private formatDigestEmail(digest: any): string {
    const g = digest.sections.growth;
    const r = digest.sections.revenue;
    const c = digest.sections.customers;
    const o = digest.sections.operations;
    const attn = digest.sections.needsAttention;

    return `
<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>AcreOS Daily Briefing — ${digest.date}</h2>

  <h3>GROWTH</h3>
  <ul>
    <li>${g.newSignups} new signup(s) yesterday</li>
    <li>${g.activeUsers} active user(s)</li>
  </ul>

  <h3>REVENUE</h3>
  <ul>
    <li>MRR: ${r.mrrFormatted || "N/A"}</li>
    <li>Paying customers: ${r.payingCustomers ?? "N/A"}</li>
  </ul>

  <h3>CUSTOMERS</h3>
  <ul>
    <li>${c.emailsSent} emails auto-sent</li>
    <li>${c.emailsQueued} emails queued for your approval</li>
  </ul>

  <h3>OPERATIONS</h3>
  <ul>
    <li>Data sources: ${o.dataSources || "N/A"}</li>
    <li>Services: ${o.services || "N/A"}</li>
  </ul>

  ${attn.length > 0 ? `
  <h3>NEEDS YOUR ATTENTION (${attn.length} items)</h3>
  <ul>
    ${attn.map((a: any) => `<li>[${a.action}] ${a.reason}</li>`).join("")}
  </ul>
  ` : ""}

  <p style="color: #666; font-size: 12px;">
    <a href="/founder/daily-digest">View Full Dashboard</a> |
    <a href="/founder/beta-analytics">View Analytics</a>
  </p>
</div>
    `.trim();
  }
}

export const founderDigestAgent = new FounderDigestAgent();
