import { storage } from "../storage";
import {
  dealTallies,
  leadTallies,
  listDealsNewestFirst,
  listLeadsNewestFirst,
  listNotesNewestFirst,
  listPropertiesNewestFirst,
  NO_NOTES,
  noteTallies,
  propertyTallies,
} from "../storage/wholeOrgReadsE";

export interface ModuleSnapshot {
  name: string;
  totalCount: number;
  recentCount: number;
  keyStats: Record<string, any>;
  recentItems: any[];
}

export interface SystemContext {
  timestamp: string;
  organizationId: number;
  organizationName: string;
  modules: {
    leads: ModuleSnapshot;
    properties: ModuleSnapshot;
    deals: ModuleSnapshot;
    notes: ModuleSnapshot;
    tasks: ModuleSnapshot;
    campaigns: ModuleSnapshot;
    finance: {
      monthlyCashflow: number;
      activeNotesCount: number;
      totalOutstanding: number;
      upcomingPayments: number;
    };
  };
  alerts: {
    lowCreditBalance: boolean;
    overduePayments: number;
    pendingTasks: number;
    newLeads: number;
  };
  quickActions: string[];
}

const CACHE_TTL_MS = 60000;
/** How many of the newest records each module lists for Pax. */
const RECENT_ITEMS = 5;
const contextCache = new Map<number, { context: SystemContext; fetchedAt: number }>();

export async function getSystemContext(organizationId: number): Promise<SystemContext> {
  const cached = contextCache.get(organizationId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.context;
  }

  const context = await buildSystemContext(organizationId);
  contextCache.set(organizationId, { context, fetchedAt: Date.now() });
  return context;
}

export function invalidateContextCache(organizationId: number): void {
  contextCache.delete(organizationId);
}

async function buildSystemContext(organizationId: number): Promise<SystemContext> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // The counts, sums and by-status maps are SQL aggregates over the whole
  // book, and the "recent items" the five newest of the week in SQL
  // (DEFECT-0171): every figure here was computed from the newest 5000 rows
  // of each kind and handed to Pax as the customer's totals.
  const [
    org, leadT, propertyT, dealT, noteT,
    recentLeads, recentProperties, recentDeals, recentActiveNotes,
    tasks, campaigns,
  ] = await Promise.all([
    storage.getOrganization(organizationId),
    leadTallies(organizationId, weekAgo),
    propertyTallies(organizationId, weekAgo),
    dealTallies(organizationId, weekAgo),
    noteTallies(organizationId, now),
    listLeadsNewestFirst(organizationId, { createdAfter: weekAgo }, RECENT_ITEMS),
    listPropertiesNewestFirst(organizationId, { createdAfter: weekAgo }, RECENT_ITEMS),
    listDealsNewestFirst(organizationId, { createdAfter: weekAgo }, RECENT_ITEMS),
    listNotesNewestFirst(organizationId, { status: "active" }, RECENT_ITEMS),
    storage.getTasks(organizationId),
    storage.getCampaigns(organizationId),
  ]);

  const activeNotes = noteT.byStatus["active"] ?? NO_NOTES;
  const monthlyCashflow = activeNotes.monthlyPayment;
  const totalOutstanding = activeNotes.currentBalance;

  const pendingTasks = tasks.filter(t => t.status === "pending" || t.status === "in_progress");
  const overdueTasks = pendingTasks.filter(t => t.dueDate && new Date(t.dueDate) < now);

  const newLeadsCount = leadT.byStatus["new"] ?? 0;
  const leadsByStatus = leadT.byStatus;
  const propertiesByStatus = propertyT.byStatus;
  const dealsByStatus = dealT.byStatus;

  const quickActions: string[] = [];
  if (newLeadsCount > 0) quickActions.push(`Follow up with ${newLeadsCount} new leads`);
  if (overdueTasks.length > 0) quickActions.push(`Complete ${overdueTasks.length} overdue tasks`);
  if (propertiesByStatus["prospect"] > 0) quickActions.push(`Research ${propertiesByStatus["prospect"]} prospect properties`);

  return {
    timestamp: now.toISOString(),
    organizationId,
    organizationName: org?.name || "Unknown",
    modules: {
      leads: {
        name: "Leads (CRM)",
        totalCount: leadT.total,
        recentCount: leadT.createdSince,
        keyStats: {
          byStatus: leadsByStatus,
          newThisWeek: leadT.createdSince,
          sellers: leadT.byType["seller"] ?? 0,
          buyers: leadT.byType["buyer"] ?? 0,
        },
        recentItems: recentLeads.map(l => ({
          id: l.id,
          name: `${l.firstName} ${l.lastName}`,
          status: l.status,
          type: l.type,
        })),
      },
      properties: {
        name: "Property Inventory",
        totalCount: propertyT.total,
        recentCount: propertyT.createdSince,
        keyStats: {
          byStatus: propertiesByStatus,
          totalAcres: propertyT.totalAcres,
          totalValue: propertyT.totalMarketValue,
          owned: propertiesByStatus["owned"] || 0,
          listed: propertiesByStatus["listed"] || 0,
        },
        recentItems: recentProperties.map(p => ({
          id: p.id,
          address: p.address,
          county: p.county,
          state: p.state,
          status: p.status,
          sizeAcres: p.sizeAcres,
        })),
      },
      deals: {
        name: "Deal Pipeline",
        totalCount: dealT.total,
        recentCount: dealT.createdSince,
        keyStats: {
          byStatus: dealsByStatus,
          acquisitions: dealT.byType["acquisition"] ?? 0,
          dispositions: dealT.byType["disposition"] ?? 0,
          totalPipelineValue: dealT.offerSum,
        },
        recentItems: recentDeals.map(d => ({
          id: d.id,
          propertyId: d.propertyId,
          status: d.status,
          type: d.type,
          amount: d.offerAmount,
        })),
      },
      notes: {
        name: "Seller Finance Notes",
        totalCount: noteT.total,
        recentCount: 0,
        keyStats: {
          active: activeNotes.count,
          totalPrincipal: noteT.totalOriginalPrincipal,
          currentBalance: totalOutstanding,
        },
        recentItems: recentActiveNotes.map(n => ({
          id: n.id,
          balance: n.currentBalance,
          payment: n.monthlyPayment,
          status: n.status,
        })),
      },
      tasks: {
        name: "Tasks",
        totalCount: tasks.length,
        recentCount: pendingTasks.length,
        keyStats: {
          pending: pendingTasks.length,
          overdue: overdueTasks.length,
          completed: tasks.filter(t => t.status === "completed").length,
        },
        recentItems: pendingTasks.slice(0, 5).map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dueDate: t.dueDate,
          priority: t.priority,
        })),
      },
      campaigns: {
        name: "Marketing Campaigns",
        totalCount: campaigns.length,
        recentCount: campaigns.filter(c => c.status === "active").length,
        keyStats: {
          active: campaigns.filter(c => c.status === "active").length,
          draft: campaigns.filter(c => c.status === "draft").length,
          completed: campaigns.filter(c => c.status === "completed").length,
        },
        recentItems: campaigns.slice(0, 5).map(c => ({
          id: c.id,
          name: c.name,
          type: c.type,
          status: c.status,
        })),
      },
      finance: {
        monthlyCashflow,
        activeNotesCount: activeNotes.count,
        totalOutstanding,
        upcomingPayments: 0,
      },
    },
    alerts: {
      lowCreditBalance: false,
      overduePayments: 0,
      pendingTasks: pendingTasks.length,
      newLeads: newLeadsCount,
    },
    quickActions,
  };
}

export function formatContextForAI(context: SystemContext): string {
  const { modules, alerts, quickActions } = context;
  
  let summary = `## Current System State (as of ${new Date(context.timestamp).toLocaleString()})\n\n`;
  
  summary += `### Leads (CRM)\n`;
  summary += `- Total: ${modules.leads.totalCount} leads\n`;
  summary += `- New this week: ${modules.leads.recentCount}\n`;
  summary += `- Sellers: ${modules.leads.keyStats.sellers}, Buyers: ${modules.leads.keyStats.buyers}\n`;
  summary += `- By status: ${Object.entries(modules.leads.keyStats.byStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}\n\n`;

  summary += `### Properties\n`;
  summary += `- Total: ${modules.properties.totalCount} properties\n`;
  summary += `- Total acreage: ${modules.properties.keyStats.totalAcres.toLocaleString()} acres\n`;
  summary += `- Owned: ${modules.properties.keyStats.owned}, Listed: ${modules.properties.keyStats.listed}\n`;
  summary += `- By status: ${Object.entries(modules.properties.keyStats.byStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}\n\n`;

  summary += `### Deals\n`;
  summary += `- Total: ${modules.deals.totalCount} deals\n`;
  summary += `- Pipeline value: $${modules.deals.keyStats.totalPipelineValue.toLocaleString()}\n`;
  summary += `- Acquisitions: ${modules.deals.keyStats.acquisitions}, Dispositions: ${modules.deals.keyStats.dispositions}\n\n`;

  summary += `### Finance\n`;
  summary += `- Active notes: ${modules.finance.activeNotesCount}\n`;
  summary += `- Monthly cashflow: $${modules.finance.monthlyCashflow.toLocaleString()}\n`;
  summary += `- Outstanding balance: $${modules.finance.totalOutstanding.toLocaleString()}\n\n`;

  summary += `### Tasks\n`;
  summary += `- Pending: ${modules.tasks.keyStats.pending}\n`;
  summary += `- Overdue: ${modules.tasks.keyStats.overdue}\n\n`;

  if (alerts.newLeads > 0 || alerts.pendingTasks > 0) {
    summary += `### Alerts\n`;
    if (alerts.newLeads > 0) summary += `- ${alerts.newLeads} new leads need attention\n`;
    if (alerts.pendingTasks > 0) summary += `- ${alerts.pendingTasks} pending tasks\n`;
    summary += `\n`;
  }

  if (quickActions.length > 0) {
    summary += `### Suggested Actions\n`;
    quickActions.forEach(a => summary += `- ${a}\n`);
  }

  return summary;
}
