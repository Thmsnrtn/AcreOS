// Support-ops data layer: usage-record + credit-transaction reads, the
// support desk (cases / messages / actions / playbooks), dunning events,
// system alerts, and the platform-admin dashboard reads. Extracted from the
// god-class server/storage.ts in the storage refactor. Methods are merged
// into DatabaseStorage.prototype at construction time; `this` refers to the
// full DatabaseStorage instance.

import { and, desc, eq, gte, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { forOrg, unscopedForPlatformOps } from "../utils/orgScopedDb";
import {
  usageRecords,
  creditTransactions,
  supportCases,
  supportMessages,
  supportActions,
  supportPlaybooks,
  dunningEvents,
  systemAlerts,
  organizations,
  teamMembers,
  agentTasks,
  type InsertSupportCase,
  type InsertSupportMessage,
  type InsertSupportAction,
  type InsertDunningEvent,
  type InsertSystemAlert,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";
import { assertWritablePatch } from "../utils/patch";

export const supportOpsRepo = {
  // Usage Records
  async getUsageRecords(this: DatabaseStorage, orgId: number, limit: number = 50) {
    return await db.select().from(usageRecords)
      .where(eq(usageRecords.organizationId, orgId))
      .orderBy(desc(usageRecords.createdAt))
      .limit(limit);
  },

  async getUsageSummaryByMonth(this: DatabaseStorage, orgId: number, month: string) {
    const results = await db
      .select({
        actionType: usageRecords.actionType,
        count: sql<number>`SUM(${usageRecords.quantity})::int`,
        totalCost: sql<number>`SUM(${usageRecords.totalCostCents})::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, orgId),
          eq(usageRecords.billingMonth, month)
        )
      )
      .groupBy(usageRecords.actionType);
    
    return results;
  },

  // Credit Transactions
  async getCreditTransactions(this: DatabaseStorage, orgId: number, limit: number = 50) {
    return await db.select().from(creditTransactions)
      .where(eq(creditTransactions.organizationId, orgId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit);
  },

  async getCreditBalance(this: DatabaseStorage, orgId: number) {
    const [org] = await db.select().from(organizations)
      .where(eq(organizations.id, orgId));
    return Number(org?.creditBalance || 0);
  },

  // Support Cases
  async createSupportCase(this: DatabaseStorage, input: InsertSupportCase) {
    const [newCase] = await db.insert(supportCases).values(input).returning();
    return newCase;
  },

  // Tier 1F: org-scoped by construction.
  async getSupportCase(this: DatabaseStorage, organizationId: number, id: number) {
    return await forOrg(organizationId).findById(supportCases, id);
  },

  // Tier 1F escape hatch: the founder support desk legitimately operates
  // across tenants (responding to ANY org's escalated case). Callers MUST be
  // founder-gated before reaching this. Greppable + logged via
  // unscopedForPlatformOps.
  async getSupportCaseForPlatformOps(this: DatabaseStorage, id: number) {
    const platformDb = unscopedForPlatformOps(
      "founder support desk: load escalated support case across tenants",
    );
    const [supportCase] = await platformDb.select().from(supportCases)
      .where(eq(supportCases.id, id));
    return supportCase;
  },

  async getSupportCases(this: DatabaseStorage, organizationId: number, status?: string) {
    const conditions = [eq(supportCases.organizationId, organizationId)];
    if (status) {
      conditions.push(eq(supportCases.status, status));
    }
    return await db.select().from(supportCases)
      .where(and(...conditions))
      .orderBy(desc(supportCases.createdAt));
  },

  async updateSupportCase(this: DatabaseStorage, id: number, data: Partial<InsertSupportCase>, organizationId?: number) {
    const conditions = [eq(supportCases.id, id)];
    if (organizationId) conditions.push(eq(supportCases.organizationId, organizationId));
    const [updated] = await db.update(supportCases)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async getEscalatedCases(this: DatabaseStorage) {
    return await db.select().from(supportCases)
      .where(eq(supportCases.status, "escalated"))
      .orderBy(desc(supportCases.createdAt));
  },

  // Support Messages
  async createSupportMessage(this: DatabaseStorage, input: InsertSupportMessage) {
    const [newMessage] = await db.insert(supportMessages).values(input).returning();
    return newMessage;
  },

  async getSupportMessages(this: DatabaseStorage, caseId: number) {
    return await db.select().from(supportMessages)
      .where(eq(supportMessages.caseId, caseId))
      .orderBy(supportMessages.createdAt);
  },

  // Support Actions
  async createSupportAction(this: DatabaseStorage, input: InsertSupportAction) {
    const [newAction] = await db.insert(supportActions).values(input).returning();
    return newAction;
  },

  async getSupportActions(this: DatabaseStorage, caseId: number) {
    return await db.select().from(supportActions)
      .where(eq(supportActions.caseId, caseId))
      .orderBy(desc(supportActions.createdAt));
  },

  // Support Playbooks
  async getSupportPlaybooks(this: DatabaseStorage, category?: string) {
    if (category) {
      return await db.select().from(supportPlaybooks)
        .where(and(
          eq(supportPlaybooks.category, category),
          eq(supportPlaybooks.isActive, true)
        ))
        .orderBy(supportPlaybooks.name);
    }
    return await db.select().from(supportPlaybooks)
      .where(eq(supportPlaybooks.isActive, true))
      .orderBy(supportPlaybooks.name);
  },

  async getSupportPlaybook(this: DatabaseStorage, slug: string) {
    const [playbook] = await db.select().from(supportPlaybooks)
      .where(eq(supportPlaybooks.slug, slug));
    return playbook;
  },

  async incrementPlaybookUsage(this: DatabaseStorage, slug: string, success: boolean) {
    const playbook = await this.getSupportPlaybook(slug);
    if (playbook) {
      const currentUsage = playbook.timesUsed || 0;
      const currentRate = Number(playbook.successRate) || 0;
      const newUsage = currentUsage + 1;
      const newRate = success
        ? String((currentRate * currentUsage + 100) / newUsage)
        : String((currentRate * currentUsage) / newUsage);
      
      await db.update(supportPlaybooks)
        .set({
          timesUsed: newUsage,
          successRate: newRate,
          updatedAt: new Date(),
        })
        .where(eq(supportPlaybooks.slug, slug));
    }
  },

  // Dunning Events
  async createDunningEvent(this: DatabaseStorage, event: InsertDunningEvent) {
    const [newEvent] = await db.insert(dunningEvents).values(event).returning();
    return newEvent;
  },

  async getDunningEvents(this: DatabaseStorage, orgId: number, status?: string) {
    if (status) {
      return await db.select().from(dunningEvents)
        .where(and(
          eq(dunningEvents.organizationId, orgId),
          eq(dunningEvents.status, status)
        ))
        .orderBy(desc(dunningEvents.createdAt));
    }
    return await db.select().from(dunningEvents)
      .where(eq(dunningEvents.organizationId, orgId))
      .orderBy(desc(dunningEvents.createdAt));
  },

  async getPendingDunningEvent(this: DatabaseStorage, orgId: number, stripeInvoiceId: string) {
    const [event] = await db.select().from(dunningEvents)
      .where(and(
        eq(dunningEvents.organizationId, orgId),
        eq(dunningEvents.stripeInvoiceId, stripeInvoiceId),
        or(
          eq(dunningEvents.status, "pending"),
          eq(dunningEvents.status, "scheduled_retry")
        )
      ));
    return event;
  },

  async updateDunningEvent(this: DatabaseStorage, id: number, updates: Partial<InsertDunningEvent>, organizationId?: number) {
    const conditions = [eq(dunningEvents.id, id)];
    if (organizationId) conditions.push(eq(dunningEvents.organizationId, organizationId));
    const [updated] = await db.update(dunningEvents)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async resolveDunningEvents(this: DatabaseStorage, orgId: number, stripeInvoiceId: string, resolutionType: string) {
    await db.update(dunningEvents)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolutionType,
        updatedAt: new Date(),
      })
      .where(and(
        eq(dunningEvents.organizationId, orgId),
        eq(dunningEvents.stripeInvoiceId, stripeInvoiceId),
        or(
          eq(dunningEvents.status, "pending"),
          eq(dunningEvents.status, "scheduled_retry")
        )
      ));
  },

  async getOrganizationsInDunning(this: DatabaseStorage) {
    return await db.select().from(organizations)
      .where(and(
        sql`${organizations.dunningStage} IS NOT NULL`,
        sql`${organizations.dunningStage} != 'none'`
      ));
  },

  // System Alerts
  async createSystemAlert(this: DatabaseStorage, alert: InsertSystemAlert) {
    const [newAlert] = await db.insert(systemAlerts).values(alert).returning();
    return newAlert;
  },

  async getSystemAlerts(this: DatabaseStorage, orgId?: number, status?: string) {
    const conditions = [];
    if (orgId) conditions.push(eq(systemAlerts.organizationId, orgId));
    if (status) conditions.push(eq(systemAlerts.status, status));
    
    if (conditions.length > 0) {
      return await db.select().from(systemAlerts)
        .where(and(...conditions))
        .orderBy(desc(systemAlerts.createdAt));
    }
    return await db.select().from(systemAlerts)
      .orderBy(desc(systemAlerts.createdAt));
  },

  async updateSystemAlert(this: DatabaseStorage, id: number, updates: Partial<InsertSystemAlert>) {
    const [updated] = await db.update(systemAlerts)
      .set(assertWritablePatch(updates, "system_alerts.updateSystemAlert"))
      .where(eq(systemAlerts.id, id))
      .returning();
    return updated;
  },

  async acknowledgeAlert(this: DatabaseStorage, id: number) {
    const [updated] = await db.update(systemAlerts)
      .set({ status: "acknowledged", acknowledgedAt: new Date() })
      .where(eq(systemAlerts.id, id))
      .returning();
    return updated;
  },

  async resolveAlert(this: DatabaseStorage, id: number) {
    const [updated] = await db.update(systemAlerts)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(systemAlerts.id, id))
      .returning();
    return updated;
  },

  async acknowledgeAllAlerts(this: DatabaseStorage) {
    const result = await db.update(systemAlerts)
      .set({ status: "acknowledged", acknowledgedAt: new Date() })
      .where(and(
        ne(systemAlerts.status, "resolved"),
        ne(systemAlerts.status, "acknowledged")
      ))
      .returning();
    return result.length;
  },

  async resolveAllAlerts(this: DatabaseStorage) {
    const result = await db.update(systemAlerts)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(ne(systemAlerts.status, "resolved"))
      .returning();
    return result.length;
  },

  async getAllOrganizations(this: DatabaseStorage) {
    return await db.select().from(organizations)
      .orderBy(desc(organizations.createdAt))
      .limit(10000);
  },

  async getAdminDashboardData(this: DatabaseStorage) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const allOrgs = await db.select().from(organizations).limit(10000);
    const allTeamMembers = await db.select().from(teamMembers).limit(50000);
    
    const orgsByTier = allOrgs.reduce((acc, org) => {
      acc[org.subscriptionTier] = (acc[org.subscriptionTier] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const orgsInDunning = allOrgs.filter(org => org.dunningStage && org.dunningStage !== 'none');
    const dunningByStage = orgsInDunning.reduce((acc, org) => {
      acc[org.dunningStage!] = (acc[org.dunningStage!] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const activeUsers = allTeamMembers.filter(m => m.isActive).length;
    const newSignupsThisWeek = allOrgs.filter(org => 
      org.createdAt && new Date(org.createdAt) >= sevenDaysAgo
    ).length;

    const allAlerts = await this.getSystemAlerts();
    const unresolvedAlerts = allAlerts.filter(a => a.status !== 'resolved' && a.status !== 'dismissed');
    const alertsBySeverity = unresolvedAlerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const criticalAlerts = unresolvedAlerts.filter(a => a.severity === 'critical').slice(0, 5);

    const creditTransactionsThisMonth = await db.select().from(creditTransactions)
      .where(gte(creditTransactions.createdAt, startOfMonth));
    const creditSalesThisMonth = creditTransactionsThisMonth
      .filter(t => t.type === 'purchase')
      .reduce((sum, t) => sum + Number(t.amountCents || 0), 0);

    const totalMrr = allOrgs.reduce((sum, org) => {
      if (org.subscriptionStatus !== 'active') return sum;
      const tierPrices: Record<string, number> = { free: 0, starter: 4900, pro: 9900, scale: 19900 };
      return sum + (tierPrices[org.subscriptionTier] || 0);
    }, 0);

    const mrrAtRisk = orgsInDunning.reduce((sum, org) => {
      const tierPrices: Record<string, number> = { free: 0, starter: 4900, pro: 9900, scale: 19900 };
      return sum + (tierPrices[org.subscriptionTier] || 0);
    }, 0);

    const allAgentTasks = await db.select().from(agentTasks)
      .orderBy(desc(agentTasks.createdAt))
      .limit(500);

    const leadNurturerTasks = allAgentTasks.filter(t => t.agentType === 'lead_nurturing');
    const campaignOptimizerTasks = allAgentTasks.filter(t => t.agentType === 'campaign_optimizer');
    const financeAgentTasks = allAgentTasks.filter(t => t.agentType === 'finance_agent');

    const getAgentStatus = (tasks: typeof allAgentTasks) => {
      const completed = tasks.filter(t => t.status === 'completed');
      const pending = tasks.filter(t => t.status === 'pending' || t.status === 'queued');
      const failed = tasks.filter(t => t.status === 'failed');
      const lastRun = tasks.find(t => t.status === 'completed')?.completedAt;
      return {
        lastRun: lastRun ? new Date(lastRun).toISOString() : null,
        processed: completed.length,
        pending: pending.length,
        failed: failed.length,
        status: pending.length > 10 ? 'busy' : failed.length > 5 ? 'warning' : 'healthy'
      };
    };

    return {
      revenue: {
        mrr: totalMrr,
        creditSalesThisMonth,
        totalRevenueThisMonth: totalMrr + creditSalesThisMonth,
        mrrAtRisk
      },
      systemHealth: {
        activeOrganizations: allOrgs.length,
        totalUsers: allTeamMembers.length,
        activeUsers,
        uptime: 99.9
      },
      agents: {
        leadNurturer: getAgentStatus(leadNurturerTasks),
        campaignOptimizer: getAgentStatus(campaignOptimizerTasks),
        financeAgent: getAgentStatus(financeAgentTasks),
        apiQueue: {
          pending: allAgentTasks.filter(t => t.status === 'pending' || t.status === 'queued').length,
          failed: allAgentTasks.filter(t => t.status === 'failed').length
        }
      },
      alerts: {
        bySeverity: alertsBySeverity,
        total: unresolvedAlerts.length,
        critical: criticalAlerts
      },
      revenueAtRisk: {
        dunningByStage,
        totalMrrAtRisk: mrrAtRisk,
        orgsApproachingCreditExhaustion: allOrgs.filter(org => 
          Number(org.creditBalance || 0) < 500 && Number(org.creditBalance || 0) > 0
        ).length
      },
      userActivity: {
        activeUsers,
        newSignupsThisWeek,
        organizationsByTier: orgsByTier
      }
    };
  },
};

export type SupportOpsRepo = typeof supportOpsRepo;
