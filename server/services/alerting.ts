import { db } from '../db';
import { systemAlerts, organizations, leads, type Lead } from '@shared/schema';
import { eq, and, gte, sql, ne, isNotNull } from 'drizzle-orm';
import { storage } from '../storage';

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
  severity: 'critical' | 'warning' | 'info';
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
      const notes = await storage.getNotes(orgId);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      const recentlyInactiveNotes = notes.filter(n => {
        if (n.status !== 'paid_off' && n.status !== 'defaulted') return false;
        const updated = n.updatedAt ? new Date(n.updatedAt) : new Date();
        return updated >= oneWeekAgo;
      });
      
      if (recentlyInactiveNotes.length >= 2) {
        const lostRevenue = recentlyInactiveNotes.reduce((sum, n) => sum + Number(n.monthlyPayment || 0), 0);
        return {
          alertType: 'revenue_drop',
          title: 'Revenue Decline Detected',
          message: `${recentlyInactiveNotes.length} notes became inactive this week, reducing monthly revenue by $${lostRevenue.toFixed(2)}.`,
          metadata: { lostNotes: recentlyInactiveNotes.length, lostRevenue },
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
      const notes = await storage.getNotes(orgId);
      const recentDelinquent = notes.filter(n => {
        if (!n.daysDelinquent || n.daysDelinquent === 0) return false;
        return n.daysDelinquent <= 1;
      });
      
      if (recentDelinquent.length >= 5) {
        return {
          alertType: 'mass_delinquency',
          title: 'Multiple Notes Became Delinquent',
          message: `${recentDelinquent.length} notes became delinquent today. Review and take action.`,
          metadata: { noteIds: recentDelinquent.map(n => n.id), count: recentDelinquent.length },
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
      const leads = await storage.getLeads(orgId);
      
      if (leads.length < 10) return null;
      
      const coldOrDead = leads.filter(l => 
        l.nurturingStage === 'cold' || l.nurturingStage === 'dead'
      );
      const coldDeadRate = (coldOrDead.length / leads.length) * 100;
      
      if (coldDeadRate > 50) {
        return {
          alertType: 'conversion_drop',
          title: 'Lead Quality Issue',
          message: `${coldDeadRate.toFixed(0)}% of leads (${coldOrDead.length}) are cold or dead. Consider improving lead sources or follow-up timing.`,
          metadata: { totalLeads: leads.length, coldOrDead: coldOrDead.length, coldDeadRate },
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
      const notes = await storage.getNotes(orgId);
      const activeNotes = notes.filter(n => n.status === 'active');
      const seriouslyDelinquent = notes.filter(n => 
        n.delinquencyStatus === 'seriously_delinquent' || n.delinquencyStatus === 'default_candidate'
      );
      
      if (activeNotes.length > 0) {
        const riskPercentage = (seriouslyDelinquent.length / activeNotes.length) * 100;
        if (riskPercentage > 10) {
          const atRiskAmount = seriouslyDelinquent.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);
          return {
            alertType: 'high_churn_risk',
            title: 'High Portfolio Risk',
            message: `${riskPercentage.toFixed(1)}% of notes (${seriouslyDelinquent.length}) are at serious risk. $${atRiskAmount.toFixed(2)} at risk.`,
            metadata: { atRiskCount: seriouslyDelinquent.length, atRiskAmount, riskPercentage },
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
        console.error(`[Alerting] Error checking rule ${rule.id}:`, error);
      }
    }
  }

  async createAlert(
    organizationId: number | null,
    severity: string,
    alert: AlertResult
  ): Promise<void> {
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
      return;
    }

    await db.insert(systemAlerts).values({
      type: alert.alertType,
      alertType: alert.alertType,
      severity,
      organizationId,
      title: alert.title,
      message: alert.message,
      metadata: alert.metadata,
      status: 'new',
    });

    console.log(`[Alerting] Created ${severity} alert: ${alert.title}`);
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

  async acknowledgeAlert(id: number): Promise<void> {
    await db
      .update(systemAlerts)
      .set({ status: 'acknowledged', acknowledgedAt: new Date() })
      .where(eq(systemAlerts.id, id));
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
        const beforeCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(systemAlerts);
        
        await this.checkAlerts(org.id);
        await this.checkLeadAging(org.id);
        
        const afterCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(systemAlerts);
        
        alertsCreated += (afterCount[0]?.count || 0) - (beforeCount[0]?.count || 0);
        checked++;
      } catch (error) {
        console.error(`[Alerting] Error checking org ${org.id}:`, error);
      }
    }

    return { checked, alertsCreated };
  }

  async checkLeadAging(organizationId: number): Promise<{ agingLeads: AgingLead[]; alertsCreated: number }> {
    const allLeads = await storage.getLeads(organizationId);
    const agingLeads: AgingLead[] = [];
    let alertsCreated = 0;

    const now = Date.now();

    for (const lead of allLeads) {
      if (lead.status === 'dead' || lead.status === 'closed' || lead.status === 'converted') {
        continue;
      }

      const lastContact = lead.lastContactedAt || lead.createdAt;
      const daysSinceContact = lastContact
        ? Math.floor((now - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const stage = lead.nurturingStage || 'new';
      let urgency: 'urgent' | 'warning' | 'info' | null = null;

      if (stage === 'hot' && daysSinceContact >= 3) {
        urgency = 'urgent';
      } else if (stage === 'warm' && daysSinceContact >= 7) {
        urgency = 'warning';
      } else if (daysSinceContact >= 14) {
        urgency = 'info';
      }

      if (urgency) {
        agingLeads.push({
          id: lead.id,
          firstName: lead.firstName,
          lastName: lead.lastName || '',
          nurturingStage: stage,
          score: lead.score,
          lastContactedAt: lastContact ? new Date(lastContact) : null,
          daysSinceContact,
          urgency,
        });

        const alertType = `lead_aging_${lead.id}`;
        const existingAlert = await this.getExistingLeadAgingAlert(organizationId, lead.id);
        
        if (!existingAlert) {
          const severityMap = { urgent: 'critical', warning: 'warning', info: 'info' };
          const titleMap = {
            urgent: 'Hot Lead Going Cold',
            warning: 'Warm Lead Needs Attention',
            info: 'Lead Going Stale',
          };

          await this.createAlert(organizationId, severityMap[urgency], {
            alertType,
            title: titleMap[urgency],
            message: `${lead.firstName} ${lead.lastName || ''} (${stage} lead) hasn't been contacted in ${daysSinceContact} days. Score: ${lead.score ?? 'N/A'}.`,
            metadata: {
              leadId: lead.id,
              leadName: `${lead.firstName} ${lead.lastName || ''}`,
              nurturingStage: stage,
              score: lead.score,
              daysSinceContact,
              lastContactedAt: lastContact,
              urgency,
            },
          });
          alertsCreated++;
        }
      }
    }

    return { agingLeads, alertsCreated };
  }

  private async getExistingLeadAgingAlert(organizationId: number, leadId: number): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await db
      .select()
      .from(systemAlerts)
      .where(
        and(
          eq(systemAlerts.organizationId, organizationId),
          eq(systemAlerts.alertType, `lead_aging_${leadId}`),
          ne(systemAlerts.status, 'resolved'),
          gte(systemAlerts.createdAt, today)
        )
      );

    return existing.length > 0;
  }

  async getAgingLeads(organizationId: number): Promise<AgingLead[]> {
    const allLeads = await storage.getLeads(organizationId);
    const agingLeads: AgingLead[] = [];
    const now = Date.now();

    for (const lead of allLeads) {
      if (lead.status === 'dead' || lead.status === 'closed' || lead.status === 'converted') {
        continue;
      }

      const lastContact = lead.lastContactedAt || lead.createdAt;
      const daysSinceContact = lastContact
        ? Math.floor((now - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const stage = lead.nurturingStage || 'new';
      let urgency: 'urgent' | 'warning' | 'info' | null = null;

      if (stage === 'hot' && daysSinceContact >= 3) {
        urgency = 'urgent';
      } else if (stage === 'warm' && daysSinceContact >= 7) {
        urgency = 'warning';
      } else if (daysSinceContact >= 14) {
        urgency = 'info';
      }

      if (urgency) {
        agingLeads.push({
          id: lead.id,
          firstName: lead.firstName,
          lastName: lead.lastName || '',
          nurturingStage: stage,
          score: lead.score,
          lastContactedAt: lastContact ? new Date(lastContact) : null,
          daysSinceContact,
          urgency,
        });
      }
    }

    return agingLeads.sort((a, b) => {
      const urgencyOrder = { urgent: 0, warning: 1, info: 2 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
  }
}

export const alertingService = new AlertingService();
