import { storage } from "../storage";
import { clock } from "../utils/clock";
import {
  listAcquiredNotesForPax,
  summarizeAcquiredBook,
  buildNotesCoverageStatement,
} from "./notes/acquiredBookRead";

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
      acquiredLiveNotesCount: number;
      acquiredMonthlyCashflow: number;
      acquiredTotalOutstanding: number;
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
  if (cached && clock.nowMs() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.context;
  }

  const context = await buildSystemContext(organizationId);
  contextCache.set(organizationId, { context, fetchedAt: clock.nowMs() });
  return context;
}

export function invalidateContextCache(organizationId: number): void {
  contextCache.delete(organizationId);
}

async function buildSystemContext(organizationId: number): Promise<SystemContext> {
  const now = clock.now();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [org, leads, properties, deals, notes, tasks, campaigns, acquiredNotes] = await Promise.all([
    storage.getOrganization(organizationId),
    storage.getLeads(organizationId),
    storage.getProperties(organizationId),
    storage.getDeals(organizationId),
    storage.getNotes(organizationId),
    storage.getTasks(organizationId),
    storage.getCampaigns(organizationId),
    // HYB-DEF-5: the acquired book is part of Pax's notes coverage. Before
    // this read existed, this context presented the serviced book alone
    // as the whole book, with no coverage statement.
    listAcquiredNotesForPax(organizationId),
  ]);
  const acquiredSummary = summarizeAcquiredBook(acquiredNotes);
  const notesCoverage = buildNotesCoverageStatement(notes.length, acquiredNotes.length);
  // Closed deals are a fact of record, not pipeline: the pipeline figures
  // below count open work, and a zero there must never be stated as
  // "no deals closed" (HYB-DEF-5).
  const closedDeals = deals.filter(d => d.status === "closed").length;

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
          closed: closedDeals,
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
        name: "Notes (serviced + acquired books)",
        totalCount: notes.length + acquiredNotes.length,
        recentCount: 0,
        keyStats: {
          coverage: notesCoverage,
          serviced: {
            count: notes.length,
            active: activeNotes.length,
            totalPrincipal: notes.reduce((sum, n) => sum + Number(n.originalPrincipal || 0), 0),
            currentBalance: totalOutstanding,
          },
          acquired: {
            count: acquiredSummary.count,
            live: acquiredSummary.liveCount,
            totalBalance: acquiredSummary.totalBalance,
            monthlyPayments: acquiredSummary.monthlyPayments,
            delinquent: acquiredSummary.delinquentCount,
          },
          // Legacy serviced-only keys, kept for existing consumers of the
          // raw context. The formatted summary labels them as the serviced
          // book; the slices above are the labelled truth.
          active: activeNotes.length,
          totalPrincipal: notes.reduce((sum, n) => sum + Number(n.originalPrincipal || 0), 0),
          currentBalance: totalOutstanding,
        },
        recentItems: [
          ...activeNotes.slice(0, 5).map(n => ({
            id: n.id,
            book: "serviced",
            balance: n.currentBalance,
            payment: n.monthlyPayment,
            status: n.status,
          })),
          ...acquiredNotes.slice(0, 5).map(n => ({
            id: n.id,
            book: "acquired",
            noteNumber: n.noteNumber,
            balance: n.currentBalanceCents / 100,
            payment: n.paymentAmountCents / 100,
            status: n.status,
            delinquencyStatus: n.delinquencyStatus,
          })),
        ],
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
        // Serviced-book figures (the pre-existing fields). The acquired
        // book rides alongside, labelled — never folded in silently.
        monthlyCashflow,
        activeNotesCount: activeNotes.length,
        totalOutstanding,
        acquiredLiveNotesCount: acquiredSummary.liveCount,
        acquiredMonthlyCashflow: acquiredSummary.monthlyPayments,
        acquiredTotalOutstanding: acquiredSummary.totalBalance,
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
  summary += `- Closed: ${modules.deals.keyStats.closed} deals closed (a fact of record — an empty open pipeline never means no deals have closed)\n`;
  summary += `- By status: ${Object.entries(modules.deals.keyStats.byStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}\n`;
  summary += `- Pipeline value (open deals): $${modules.deals.keyStats.totalPipelineValue.toLocaleString()}\n`;
  summary += `- Acquisitions: ${modules.deals.keyStats.acquisitions}, Dispositions: ${modules.deals.keyStats.dispositions}\n\n`;

  summary += `### Notes\n`;
  summary += `- ${modules.notes.keyStats.coverage}\n`;
  summary += `- Serviced book (originated, seller-financed): ${modules.notes.keyStats.serviced.count} notes, ${modules.notes.keyStats.serviced.active} active, $${Number(modules.notes.keyStats.serviced.currentBalance).toLocaleString()} outstanding\n`;
  summary += `- Acquired book (bought notes): ${modules.notes.keyStats.acquired.count} notes, ${modules.notes.keyStats.acquired.live} live, $${Number(modules.notes.keyStats.acquired.totalBalance).toLocaleString()} outstanding, ${modules.notes.keyStats.acquired.delinquent} delinquent\n\n`;

  summary += `### Finance\n`;
  summary += `- Active notes (serviced book): ${modules.finance.activeNotesCount}\n`;
  summary += `- Monthly cashflow (serviced book): $${modules.finance.monthlyCashflow.toLocaleString()}\n`;
  summary += `- Outstanding balance (serviced book): $${modules.finance.totalOutstanding.toLocaleString()}\n`;
  summary += `- Live notes (acquired book): ${modules.finance.acquiredLiveNotesCount}\n`;
  summary += `- Monthly payments (acquired book): $${modules.finance.acquiredMonthlyCashflow.toLocaleString()}\n`;
  summary += `- Outstanding balance (acquired book): $${modules.finance.acquiredTotalOutstanding.toLocaleString()}\n\n`;

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
