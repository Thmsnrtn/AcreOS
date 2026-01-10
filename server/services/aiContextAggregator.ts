import { storage } from "../storage";

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

  const [org, leads, properties, deals, notes, tasks, campaigns] = await Promise.all([
    storage.getOrganization(organizationId),
    storage.getLeads(organizationId),
    storage.getProperties(organizationId),
    storage.getDeals(organizationId),
    storage.getNotes(organizationId),
    storage.getTasks(organizationId),
    storage.getCampaigns(organizationId),
  ]);

  const recentLeads = leads.filter(l => new Date(l.createdAt || 0) > weekAgo);
  const recentProperties = properties.filter(p => new Date(p.createdAt || 0) > weekAgo);
  const recentDeals = deals.filter(d => new Date(d.createdAt || 0) > weekAgo);

  const activeNotes = notes.filter(n => n.status === "active");
  const monthlyCashflow = activeNotes.reduce((sum, n) => sum + Number(n.monthlyPayment || 0), 0);
  const totalOutstanding = activeNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);

  const pendingTasks = tasks.filter(t => t.status === "pending" || t.status === "in_progress");
  const overdueTasks = pendingTasks.filter(t => t.dueDate && new Date(t.dueDate) < now);

  const newLeads = leads.filter(l => l.status === "new");

  const leadsByStatus: Record<string, number> = {};
  leads.forEach(l => {
    leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1;
  });

  const propertiesByStatus: Record<string, number> = {};
  properties.forEach(p => {
    propertiesByStatus[p.status] = (propertiesByStatus[p.status] || 0) + 1;
  });

  const dealsByStatus: Record<string, number> = {};
  deals.forEach(d => {
    dealsByStatus[d.status] = (dealsByStatus[d.status] || 0) + 1;
  });

  const quickActions: string[] = [];
  if (newLeads.length > 0) quickActions.push(`Follow up with ${newLeads.length} new leads`);
  if (overdueTasks.length > 0) quickActions.push(`Complete ${overdueTasks.length} overdue tasks`);
  if (propertiesByStatus["prospect"] > 0) quickActions.push(`Research ${propertiesByStatus["prospect"]} prospect properties`);

  return {
    timestamp: now.toISOString(),
    organizationId,
    organizationName: org?.name || "Unknown",
    modules: {
      leads: {
        name: "Leads (CRM)",
        totalCount: leads.length,
        recentCount: recentLeads.length,
        keyStats: {
          byStatus: leadsByStatus,
          newThisWeek: recentLeads.length,
          sellers: leads.filter(l => l.type === "seller").length,
          buyers: leads.filter(l => l.type === "buyer").length,
        },
        recentItems: recentLeads.slice(0, 5).map(l => ({
          id: l.id,
          name: `${l.firstName} ${l.lastName}`,
          status: l.status,
          type: l.type,
        })),
      },
      properties: {
        name: "Property Inventory",
        totalCount: properties.length,
        recentCount: recentProperties.length,
        keyStats: {
          byStatus: propertiesByStatus,
          totalAcres: properties.reduce((sum, p) => sum + Number(p.sizeAcres || 0), 0),
          totalValue: properties.reduce((sum, p) => sum + Number(p.marketValue || 0), 0),
          owned: propertiesByStatus["owned"] || 0,
          listed: propertiesByStatus["listed"] || 0,
        },
        recentItems: recentProperties.slice(0, 5).map(p => ({
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
        totalCount: deals.length,
        recentCount: recentDeals.length,
        keyStats: {
          byStatus: dealsByStatus,
          acquisitions: deals.filter(d => d.type === "acquisition").length,
          dispositions: deals.filter(d => d.type === "disposition").length,
          totalPipelineValue: deals.reduce((sum, d) => sum + Number(d.offerAmount || 0), 0),
        },
        recentItems: recentDeals.slice(0, 5).map(d => ({
          id: d.id,
          propertyId: d.propertyId,
          status: d.status,
          type: d.type,
          amount: d.offerAmount,
        })),
      },
      notes: {
        name: "Seller Finance Notes",
        totalCount: notes.length,
        recentCount: 0,
        keyStats: {
          active: activeNotes.length,
          totalPrincipal: notes.reduce((sum, n) => sum + Number(n.originalPrincipal || 0), 0),
          currentBalance: totalOutstanding,
        },
        recentItems: activeNotes.slice(0, 5).map(n => ({
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
        activeNotesCount: activeNotes.length,
        totalOutstanding,
        upcomingPayments: 0,
      },
    },
    alerts: {
      lowCreditBalance: false,
      overduePayments: 0,
      pendingTasks: pendingTasks.length,
      newLeads: newLeads.length,
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
