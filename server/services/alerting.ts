import { db } from '../db';
import { systemAlerts, organizations, type IrSeverity, coerceIrSeverity } from '@shared/schema';
import { eq, and, gte, sql, ne, isNotNull, like } from 'drizzle-orm';
import { logger } from "../utils/logger";
import { getPaxControls } from "./paxControls";
import {
  agingLeadCount,
  leadStageFigures,
  mostUrgentAgingLeads,
  newlyDelinquentNoteIds,
  noteRiskTotals,
  recentlyInactiveNoteTotals,
} from "../storage/wholeOrgReadsG";

export interface AgingLead {
  id: number;
  firstName: string;
  lastName: string;
  nurturingStage: string;
  score: number | null;
  lastContactedAt: Date | null;
  daysSinceContact: number;
  urgency: 'urgent' | 'warning' | 'info';
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  /** Locked to the IR severity ladder (shared/schema/ir-severity.ts). */
  severity: IrSeverity;
  check: (orgId: number) => Promise<AlertResult | null>;
}

export interface AlertResult {
  alertType: string;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

const alertRules: AlertRule[] = [
  {
    id: 'revenue_drop',
    name: 'Revenue Drop Alert',
    description: 'Detects notes becoming inactive or defaulting that reduce MRR',
    severity: 'warning',
    check: async (orgId: number): Promise<AlertResult | null> => {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      // Whole book in SQL (DEFECT-0171): the capped newest-5,000 list
      // undercounted the notes that went inactive this week.
      const { count: lostNotes, monthlyLost: lostRevenue } = await recentlyInactiveNoteTotals(orgId, oneWeekAgo);

      if (lostNotes >= 2) {
        return {
          alertType: 'revenue_drop',
          title: 'Revenue Decline Detected',
          message: `${lostNotes} notes became inactive this week, reducing monthly revenue by $${lostRevenue.toFixed(2)}.`,
          metadata: { lostNotes, lostRevenue },
        };
      }
      return null;
    },
  },
  {
    id: 'mass_delinquency',
    name: 'Mass Delinquency Alert',
    description: 'More than 5 notes become delinquent in a day',
    severity: 'critical',
    check: async (orgId: number): Promise<AlertResult | null> => {
      const noteIds = await newlyDelinquentNoteIds(orgId);

      if (noteIds.length >= 5) {
        return {
          alertType: 'mass_delinquency',
          title: 'Multiple Notes Became Delinquent',
          message: `${noteIds.length} notes became delinquent today. Review and take action.`,
          metadata: { noteIds, count: noteIds.length },
        };
      }
      return null;
    },
  },
  {
    id: 'low_credits',
    name: 'Low Credit Balance',
    description: 'Organization balance drops below $1',
    severity: 'warning',
    check: async (orgId: number): Promise<AlertResult | null> => {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
      if (!org) return null;
      
      const balance = parseInt(org.creditBalance || '0');
      if (balance < 100) {
        return {
          alertType: 'low_credits',
          title: 'Low Credit Balance',
          message: `Organization has less than $1.00 in credits (${(balance / 100).toFixed(2)} remaining).`,
          metadata: { balance, organizationId: orgId },
        };
      }
      return null;
    },
  },
  {
    id: 'conversion_drop',
    name: 'Lead Quality Alert',
    description: 'High volume of cold or dead leads indicating poor lead quality',
    severity: 'warning',
    check: async (orgId: number): Promise<AlertResult | null> => {
      const { total: totalLeads, byStage } = await leadStageFigures(orgId);

      if (totalLeads < 10) return null;

      const coldOrDead = (byStage['cold'] ?? 0) + (byStage['dead'] ?? 0);
      const coldDeadRate = (coldOrDead / totalLeads) * 100;

      if (coldDeadRate > 50) {
        return {
          alertType: 'conversion_drop',
          title: 'Lead Quality Issue',
          message: `${coldDeadRate.toFixed(0)}% of leads (${coldOrDead}) are cold or dead. Consider improving lead sources or follow-up timing.`,
          metadata: { totalLeads, coldOrDead, coldDeadRate },
        };
      }
      return null;
    },
  },
  {
    id: 'high_churn_risk',
    name: 'High Churn Risk',
    description: 'Multiple notes at risk of default',
    severity: 'warning',
    check: async (orgId: number): Promise<AlertResult | null> => {
      const { activeCount, atRiskCount, atRiskBalance: atRiskAmount } = await noteRiskTotals(orgId);

      if (activeCount > 0) {
        const riskPercentage = (atRiskCount / activeCount) * 100;
        if (riskPercentage > 10) {
          return {
            alertType: 'high_churn_risk',
            title: 'High Portfolio Risk',
            message: `${riskPercentage.toFixed(1)}% of notes (${atRiskCount}) are at serious risk. $${atRiskAmount.toFixed(2)} at risk.`,
            metadata: { atRiskCount, atRiskAmount, riskPercentage },
          };
        }
      }
      return null;
    },
  },
];

export class AlertingService {
  async checkAlerts(organizationId: number): Promise<void> {
    for (const rule of alertRules) {
      try {
        const result = await rule.check(organizationId);
        if (result) {
          await this.createAlert(organizationId, rule.severity, result);
        }
      } catch (error) {
        logger.error(`[Alerting] Error checking rule ${rule.id}`, error);
      }
    }
  }

  async createAlert(
    organizationId: number | null,
    severity: IrSeverity,
    alert: AlertResult
  ): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const existing = await db
      .select()
      .from(systemAlerts)
      .where(
        and(
          organizationId ? eq(systemAlerts.organizationId, organizationId) : sql`1=1`,
          eq(systemAlerts.alertType, alert.alertType),
          ne(systemAlerts.status, 'resolved'),
          gte(systemAlerts.createdAt, today)
        )
      );

    if (existing.length > 0) {
      return false;
    }

    const [created] = await db.insert(systemAlerts).values({
      type: alert.alertType,
      alertType: alert.alertType,
      severity,
      organizationId,
      title: alert.title,
      message: alert.message,
      metadata: alert.metadata,
      status: 'new',
    }).returning();

    logger.info(`[Alerting] Created ${severity} alert: ${alert.title}`);

    // Route alert through escalation-only policy (P0-P3)
    try {
      const { alertPolicyService } = await import("./alertPolicy");
      await alertPolicyService.routeAlert(created.id);
    } catch (policyErr) {
      logger.error("[Alerting] Alert policy routing failed", policyErr);
    }

    // Sovereign Company Protocol — Sentinel broadcasts to incidents channel.
    // The locked IR ladder tops out at "critical" (there is no "high" rung),
    // so the broadcast fires on critical alerts only.
    if (severity === "critical") {
      try {
        const { agentCommsService } = await import("./agentComms");
        await agentCommsService.broadcast({
          from: "sentinel_devops",
          channel: "incidents",
          priority: "critical",
          subject: `Alert: ${alert.title}`,
          body: alert.message,
          data: { alertType: alert.alertType, severity, organizationId },
        });
      } catch {}
    }
    return true;
  }

  async getAlerts(filters?: {
    organizationId?: number;
    severity?: string;
    status?: string;
    limit?: number;
  }) {
    let query = db.select().from(systemAlerts);
    
    const conditions = [];
    if (filters?.organizationId) {
      conditions.push(eq(systemAlerts.organizationId, filters.organizationId));
    }
    if (filters?.severity) {
      conditions.push(eq(systemAlerts.severity, filters.severity));
    }
    if (filters?.status) {
      conditions.push(eq(systemAlerts.status, filters.status));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }

    return query;
  }

  async resolveAlert(id: number): Promise<void> {
    await db
      .update(systemAlerts)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(eq(systemAlerts.id, id));
  }

  async runDailyAlertCheck(): Promise<{ checked: number; alertsCreated: number }> {
    const orgs = await db
      .select()
      .from(organizations)
      .where(ne(organizations.subscriptionStatus, 'cancelled'));

    let checked = 0;
    let alertsCreated = 0;

    for (const org of orgs) {
      try {
        // ── Pax controls: the one reader (AUTONOMY_SPEC.md §4.4) ──────────
        // Alerts are cards. A paused org gets no new ones this tick (the
        // page says "no new cards until the pause lifts"); nothing is marked
        // failed and the next tick re-checks. Fails CLOSED on a failed read.
        const controls = await getPaxControls(org.id);
        if (controls.paused) {
          logger.info(`[Alerting] Skipping org ${org.id} — Pax is paused`, {
            metadata: {
              reason: "skipped_paused",
              organizationId: org.id,
              pausedUntil: controls.pausedUntil?.toISOString() ?? null,
              checkFailed: controls.checkFailed,
            },
          });
          continue;
        }

        // Per-org delta: count THIS org's alerts before and after, so the
        // tally is the org's own and the read is org-scoped.
        const beforeCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(systemAlerts)
          .where(eq(systemAlerts.organizationId, org.id));
        
        await this.checkAlerts(org.id);
        await this.checkLeadAging(org.id);
        
        const afterCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(systemAlerts)
          .where(eq(systemAlerts.organizationId, org.id));
        
        alertsCreated += (afterCount[0]?.count || 0) - (beforeCount[0]?.count || 0);
        checked++;
      } catch (error) {
        logger.error(`[Alerting] Error checking org ${org.id}`, error);
      }
    }

    return { checked, alertsCreated };
  }

  /**
   * Raise lead-aging alerts for at most AGING_ALERTS_PER_DAY leads a day — the
   * most urgent, stalest first — and, when more qualify, ONE summary alert
   * with the true count. The cap is per DAY, not per run: the nurturing job
   * runs every 15 minutes, so a per-run cap of 50 was up to 4,800 a day
   * (W10.2b re-audit). It used to raise one alert per aging lead (two queries
   * each); over the whole book (DEFECT-0171) that is tens of thousands of
   * alerts per org per night, which no one reads.
   *
   * `agingLeads` is the alerted top of the list, not the whole set;
   * `agingTotal` is the whole-book count of aging leads.
   */
  async checkLeadAging(organizationId: number): Promise<{
    agingLeads: AgingLead[];
    agingTotal: number;
    alertsCreated: number;
  }> {
    const now = new Date();
    // Leads already alerted today are skipped in SQL, and whatever today's
    // earlier runs raised is spent from the day's cap.
    const { unresolvedIds: alertedToday, raisedToday } = await this.agingAlertsToday(organizationId);
    const room = Math.max(0, AGING_ALERTS_PER_DAY - raisedToday);
    const [top, pending, agingTotal] = await Promise.all([
      room > 0 ? mostUrgentAgingLeads(organizationId, { limit: room, now, excludeIds: alertedToday }) : Promise.resolve([]),
      agingLeadCount(organizationId, now, alertedToday),
      agingLeadCount(organizationId, now),
    ]);
    const agingLeads = top.map((lead) => toAgingLead(lead, now.getTime()));
    let alertsCreated = 0;

    const severityMap: Record<AgingLead['urgency'], IrSeverity> = {
      urgent: 'critical',
      warning: 'warning',
      info: 'info',
    };
    const titleMap = {
      urgent: 'Hot Lead Going Cold',
      warning: 'Warm Lead Needs Attention',
      info: 'Lead Going Stale',
    };

    for (const lead of agingLeads) {
      const name = `${lead.firstName} ${lead.lastName}`;
      const created = await this.createAlert(organizationId, severityMap[lead.urgency], {
        alertType: `lead_aging_${lead.id}`,
        title: titleMap[lead.urgency],
        message: `${name} (${lead.nurturingStage} lead) hasn't been contacted in ${lead.daysSinceContact} days. Score: ${lead.score ?? 'N/A'}.`,
        metadata: {
          leadId: lead.id,
          leadName: name,
          nurturingStage: lead.nurturingStage,
          score: lead.score,
          daysSinceContact: lead.daysSinceContact,
          lastContactedAt: lead.lastContactedAt,
          urgency: lead.urgency,
        },
      });
      if (created) alertsCreated++;
    }

    // More leads qualify than today's cap alerts on: say so once, with the
    // counted figure — never one card per lead, never an estimate.
    const unalerted = pending - agingLeads.length;
    if (unalerted > 0) {
      const created = await this.createAlert(organizationId, 'warning', {
        alertType: 'lead_aging_summary',
        title: 'Leads Going Stale',
        message:
          `${agingTotal} leads are past their follow-up window (hot 3+ days, warm 7+ days, any 14+ days without contact). ` +
          `Individual alerts cover the most urgent; ${unalerted} more have none today.`,
        metadata: { agingTotal, alertedThisRun: agingLeads.length, unalerted, perDayCap: AGING_ALERTS_PER_DAY },
      });
      if (created) alertsCreated++;
    }

    return { agingLeads, agingTotal, alertsCreated };
  }

  /**
   * Today's per-lead aging alerts: the ids of leads whose alert is still
   * unresolved (not raised again), and how many were raised in any status
   * (what the day's cap has spent).
   */
  private async agingAlertsToday(organizationId: number): Promise<{ unresolvedIds: number[]; raisedToday: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = await db
      .select({ alertType: systemAlerts.alertType, status: systemAlerts.status })
      .from(systemAlerts)
      .where(
        and(
          eq(systemAlerts.organizationId, organizationId),
          like(systemAlerts.alertType, 'lead_aging_%'),
          gte(systemAlerts.createdAt, today)
        )
      );

    const unresolvedIds: number[] = [];
    let raisedToday = 0;
    for (const r of rows) {
      const m = /^lead_aging_(\d+)$/.exec(r.alertType ?? '');
      if (!m) continue;
      raisedToday++;
      if (r.status !== 'resolved') unresolvedIds.push(Number(m[1]));
    }
    return { unresolvedIds, raisedToday };
  }

  /**
   * The AGING_LIST_LIMIT most urgent aging leads (urgent, then warning, then
   * info; stalest first within each), chosen in SQL, and the whole-book count
   * of aging leads — the list is bounded, the total is not.
   */
  async getAgingLeads(organizationId: number): Promise<{ agingLeads: AgingLead[]; total: number }> {
    const now = new Date();
    const [top, total] = await Promise.all([
      mostUrgentAgingLeads(organizationId, { limit: AGING_LIST_LIMIT, now }),
      agingLeadCount(organizationId, now),
    ]);
    return { agingLeads: top.map((lead) => toAgingLead(lead, now.getTime())), total };
  }
}

/** Per-day cap on individual lead-aging alerts; the rest get one summary. */
const AGING_ALERTS_PER_DAY = 50;
/** GET /api/leads/aging lists at most this many; X-Total-Count carries the rest. */
const AGING_LIST_LIMIT = 100;

function toAgingLead(
  lead: Awaited<ReturnType<typeof mostUrgentAgingLeads>>[number],
  now: number,
): AgingLead {
  const daysSinceContact = lead.lastTouch
    ? Math.floor((now - new Date(lead.lastTouch).getTime()) / (1000 * 60 * 60 * 24))
    : 999;
  return {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName || '',
    nurturingStage: lead.nurturingStage,
    score: lead.score,
    lastContactedAt: lead.lastTouch ? new Date(lead.lastTouch) : null,
    daysSinceContact,
    urgency: lead.urgency,
  };
}

export const alertingService = new AlertingService();
