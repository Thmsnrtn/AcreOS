import { db } from '../db';
import { digestSubscriptions, organizations, leads, campaigns, notes, payments, teamMembers, pendingActions } from '@shared/schema';
import { eq, and, gte, lte, sql, isNull, or, lt, gt } from 'drizzle-orm';
import { storage } from '../storage';
import { logger } from "../utils/logger";
import { addMonths } from "../utils/dateUtils";
import { formatPaxTime, PAX_LABELS } from "@shared/pax-glossary";
import { countPaxEffects } from "./paxReceiptsReader";

/** Absolute base for the digest's deep links (same source as dunning.ts). */
const APP_URL = process.env.APP_URL || "https://app.acreos.io";

export interface DigestData {
  organizationId: number;
  period: { start: Date; end: Date };
  leads: {
    new: number;
    bySegment: Record<string, number>;
    topSources: Array<{ source: string; count: number }>;
  };
  campaigns: {
    sent: number;
    delivered: number;
    opened: number;
    responded: number;
    openRate: number;
    responseRate: number;
  };
  finance: {
    paymentsReceived: number;
    totalCollected: number;
    delinquentNotes: number;
    atRiskAmount: number;
  };
  agents: {
    leadsProcessed: number;
    campaignsOptimized: number;
    remindersScheduled: number;
  };
  /**
   * "Waiting for your tap" (AUTONOMY_SPEC.md §4.5): the org's live asks —
   * pending_actions rows still parked and unexpired — and the soonest expiry
   * among them. Both from the rows at generation time; null when none.
   */
  paxWaiting: { count: number; oldestExpiresAt: Date | null };
  /**
   * "What Pax did" over the period — three COUNTS over activity_log receipts
   * (agent_type = 'pax') and the append-only pax_sends audit; never a tally.
   */
  paxDid: { recordChanges: number; rulesRan: number; approvedSends: number };
  /** The org's IANA zone, for printing the expiry line; null when unknown. */
  timeZone: string | null;
  recommendations: string[];
}

export class DigestService {
  async getSubscription(userId: string, organizationId: number) {
    const [sub] = await db
      .select()
      .from(digestSubscriptions)
      .where(
        and(
          eq(digestSubscriptions.userId, userId),
          eq(digestSubscriptions.organizationId, organizationId)
        )
      );
    return sub;
  }

  async createSubscription(userId: string, organizationId: number, frequency: string = 'weekly') {
    const [sub] = await db
      .insert(digestSubscriptions)
      .values({
        userId,
        organizationId,
        frequency,
        emailEnabled: true,
        createdAt: new Date(),
      })
      .returning();
    return sub;
  }

  // updateSubscription deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

  async getSubscriptionsNeedingDigest(frequency: string): Promise<Array<{ userId: string; organizationId: number }>> {
    const now = new Date();
    const cutoff = new Date();
    
    if (frequency === 'daily') {
      cutoff.setDate(cutoff.getDate() - 1);
    } else if (frequency === 'weekly') {
      cutoff.setDate(cutoff.getDate() - 7);
    } else if (frequency === 'monthly') {
      const adjusted = addMonths(cutoff, -1);
      cutoff.setTime(adjusted.getTime());
    }

    const subs = await db
      .select()
      .from(digestSubscriptions)
      .where(
        and(
          eq(digestSubscriptions.frequency, frequency),
          eq(digestSubscriptions.emailEnabled, true),
          or(
            isNull(digestSubscriptions.lastSentAt),
            lt(digestSubscriptions.lastSentAt, cutoff)
          )
        )
      );

    return subs.map(s => ({ userId: s.userId, organizationId: s.organizationId! }));
  }

  async generateWeeklyDigest(organizationId: number): Promise<DigestData> {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);

    const allLeads = await storage.getLeads(organizationId);
    const newLeads = allLeads.filter(l => l.createdAt && new Date(l.createdAt) >= start);
    
    const segmentCounts: Record<string, number> = {};
    for (const lead of allLeads) {
      const stage = lead.nurturingStage || 'new';
      segmentCounts[stage] = (segmentCounts[stage] || 0) + 1;
    }

    const sourceCounts: Record<string, number> = {};
    for (const lead of newLeads) {
      const source = lead.source || 'unknown';
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    }
    const topSources = Object.entries(sourceCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const allCampaigns = await storage.getCampaigns(organizationId);
    const campaignStats = allCampaigns.reduce(
      (acc, c) => ({
        sent: acc.sent + (c.totalSent || 0),
        delivered: acc.delivered + (c.totalDelivered || 0),
        opened: acc.opened + (c.totalOpened || 0),
        responded: acc.responded + (c.totalResponded || 0),
      }),
      { sent: 0, delivered: 0, opened: 0, responded: 0 }
    );

    const allNotes = await storage.getNotes(organizationId);
    const delinquentNotes = allNotes.filter(n => (n.daysDelinquent || 0) > 0);
    const atRiskAmount = delinquentNotes.reduce(
      (sum, n) => sum + parseFloat(n.currentBalance || '0'),
      0
    );

    const allPayments = await storage.getPayments(organizationId);
    const weekPayments = allPayments.filter(p => p.paymentDate && new Date(p.paymentDate) >= start);
    const totalCollected = weekPayments.reduce(
      (sum, p) => sum + parseFloat(p.amount || '0'),
      0
    );

    // Pax: what is waiting on a tap right now, and what Pax / the org's rules
    // did over the period — every number a query over real rows.
    const now = new Date();
    const [waitingRow] = await db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<Date | null>`min(${pendingActions.expiresAt})`,
      })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.organizationId, organizationId),
          eq(pendingActions.status, "pending"),
          gt(pendingActions.expiresAt, now),
        ),
      );
    const paxWaiting = {
      count: Number(waitingRow?.count ?? 0),
      oldestExpiresAt: waitingRow?.oldest instanceof Date ? waitingRow.oldest : null,
    };
    const paxDid = await countPaxEffects(organizationId, start);
    const [orgRow] = await db
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    const timeZone = typeof orgRow?.timezone === "string" && orgRow.timezone ? orgRow.timezone : null;

    const recommendations: string[] = [];
    if (segmentCounts['cold'] > segmentCounts['hot'] * 2) {
      recommendations.push('Consider running a re-engagement campaign for cold leads');
    }
    if (campaignStats.sent > 0 && campaignStats.opened / campaignStats.sent < 0.15) {
      recommendations.push('Your open rates are below average - try testing new subject lines');
    }
    if (delinquentNotes.length > 0) {
      recommendations.push(`${delinquentNotes.length} note(s) are delinquent - review and follow up`);
    }

    return {
      organizationId,
      period: { start, end },
      leads: {
        new: newLeads.length,
        bySegment: segmentCounts,
        topSources,
      },
      campaigns: {
        ...campaignStats,
        openRate: campaignStats.sent > 0 ? (campaignStats.opened / campaignStats.sent) * 100 : 0,
        responseRate: campaignStats.sent > 0 ? (campaignStats.responded / campaignStats.sent) * 100 : 0,
      },
      finance: {
        paymentsReceived: weekPayments.length,
        totalCollected,
        delinquentNotes: delinquentNotes.length,
        atRiskAmount,
      },
      agents: {
        leadsProcessed: allLeads.filter(l => l.lastScoreAt && new Date(l.lastScoreAt) >= start).length,
        campaignsOptimized: allCampaigns.filter(c => c.lastOptimizedAt && new Date(c.lastOptimizedAt) >= start).length,
        remindersScheduled: 0,
      },
      paxWaiting,
      paxDid,
      timeZone,
      recommendations,
    };
  }

  /**
   * "Waiting for your tap (3, oldest expires Thu 9:14 am)" — the digest's
   * one line about the queue. Zero renders as zero; no expiry, no clause.
   */
  formatPaxWaitingLine(digest: Pick<DigestData, "paxWaiting" | "timeZone">): string {
    const { count, oldestExpiresAt } = digest.paxWaiting;
    const oldest =
      count > 0 && oldestExpiresAt
        ? `, oldest expires ${formatPaxTime(oldestExpiresAt, digest.timeZone ?? undefined)}`
        : "";
    return `${PAX_LABELS.queue} (${count}${oldest})`;
  }

  formatDigestEmail(digest: DigestData): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #D2691E, #CD853F); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .section { background: #f9f9f9; padding: 15px; margin: 10px 0; border-radius: 4px; }
    .stat { display: inline-block; margin-right: 20px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #D2691E; }
    .stat-label { font-size: 12px; color: #666; }
    .recommendation { background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; margin: 5px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Weekly Digest</h1>
      <p>${digest.period.start.toLocaleDateString()} - ${digest.period.end.toLocaleDateString()}</p>
    </div>
    
    <div class="section">
      <h2>Leads</h2>
      <div class="stat">
        <div class="stat-value">${digest.leads.new}</div>
        <div class="stat-label">New Leads</div>
      </div>
      <div class="stat">
        <div class="stat-value">${digest.leads.bySegment['hot'] || 0}</div>
        <div class="stat-label">Hot Leads</div>
      </div>
    </div>
    
    <div class="section">
      <h2>Campaigns</h2>
      <div class="stat">
        <div class="stat-value">${digest.campaigns.sent}</div>
        <div class="stat-label">Sent</div>
      </div>
      <div class="stat">
        <div class="stat-value">${digest.campaigns.openRate.toFixed(1)}%</div>
        <div class="stat-label">Open Rate</div>
      </div>
    </div>
    
    <div class="section">
      <h2>Finance</h2>
      <div class="stat">
        <div class="stat-value">$${digest.finance.totalCollected.toFixed(2)}</div>
        <div class="stat-label">Collected</div>
      </div>
      <div class="stat">
        <div class="stat-value">${digest.finance.delinquentNotes}</div>
        <div class="stat-label">Delinquent</div>
      </div>
    </div>
    
    <div class="section">
      <h2>Pax</h2>
      <p><a href="${APP_URL}/today">${this.formatPaxWaitingLine(digest)}</a></p>
      <div class="stat">
        <div class="stat-value">${digest.paxDid.recordChanges}</div>
        <div class="stat-label">Record changes on its own</div>
      </div>
      <div class="stat">
        <div class="stat-value">${digest.paxDid.rulesRan}</div>
        <div class="stat-label">Rules ran</div>
      </div>
      <div class="stat">
        <div class="stat-value">${digest.paxDid.approvedSends}</div>
        <div class="stat-label">Sends you approved</div>
      </div>
      <p><a href="${APP_URL}/today">${PAX_LABELS.receipts} →</a></p>
    </div>

    ${digest.recommendations.length > 0 ? `
    <div class="section">
      <h2>Recommendations</h2>
      ${digest.recommendations.map(r => `<div class="recommendation">${r}</div>`).join('')}
    </div>
    ` : ''}
  </div>
</body>
</html>
    `;
  }

  async markDigestSent(userId: string, organizationId: number): Promise<void> {
    await db
      .update(digestSubscriptions)
      .set({ lastSentAt: new Date() })
      .where(
        and(
          eq(digestSubscriptions.userId, userId),
          eq(digestSubscriptions.organizationId, organizationId)
        )
      );
  }

  /**
   * Process due weekly digests.
   *
   * Honesty contract (Wave A, "Nothing lies"): a digest is counted `sent` and
   * stamped delivered (lastSentAt) ONLY when the email provider actually
   * accepted it. An unconfigured/failed send is counted `failed` with the
   * reason logged and the subscription left unstamped so it retries on the
   * next run. A subscriber with no email address is `skipped` (nothing to
   * send to) and also left unstamped.
   */
  async processWeeklyDigests(): Promise<{ sent: number; failed: number; skipped: number }> {
    const subscriptions = await this.getSubscriptionsNeedingDigest('weekly');
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const sub of subscriptions) {
      try {
        const digest = await this.generateWeeklyDigest(sub.organizationId);
        const html = this.formatDigestEmail(digest);
        
        const [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, sub.organizationId));
        
        if (org) {
          const { emailService } = await import('./emailService');
          
          // Get user email from team members table using userId
          const [teamMember] = await db
            .select()
            .from(teamMembers)
            .where(
              and(
                eq(teamMembers.userId, sub.userId),
                eq(teamMembers.organizationId, sub.organizationId)
              )
            );
          const email = teamMember?.email;
          
          if (email) {
            const result = await emailService.sendEmail({
              to: email,
              subject: `Your Weekly Digest - ${digest.period.start.toLocaleDateString()}`,
              html,
            });
            
            if (result.success) {
              logger.info(`[Digest] Sent weekly digest to ${email} for org ${sub.organizationId}`);
              await this.markDigestSent(sub.userId, sub.organizationId);
              sent++;
            } else {
              // NOT sent, NOT stamped — an unconfigured provider or a failed
              // send must never be recorded as a delivery. Leaving lastSentAt
              // untouched means this subscription is retried next run.
              logger.warn(
                `[Digest] Weekly digest NOT delivered for org ${sub.organizationId} (user ${sub.userId}): ${result.error || 'No email provider configured'} — will retry next run`
              );
              failed++;
            }
          } else {
            logger.warn(`[Digest] Skipped weekly digest for org ${sub.organizationId}: no email address for user ${sub.userId}`);
            skipped++;
          }
        } else {
          logger.warn(`[Digest] Skipped weekly digest: organization ${sub.organizationId} not found`);
          skipped++;
        }
      } catch (error) {
        logger.error(`[Digest] Failed for org ${sub.organizationId}`, error);
        failed++;
      }
    }

    return { sent, failed, skipped };
  }
}

export const digestService = new DigestService();
