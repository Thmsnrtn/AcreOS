/**
 * GET /api/today — consolidated Today-screen payload.
 *
 * Replaces the ~6 parallel client fetches the Today screen used to fan out
 * (/api/dashboard/today-priorities, /api/tasks, /api/alerts/active,
 * /api/dashboard/intelligence, /api/pax/insights, /api/pax/pax-suggestions)
 * with a single server-side gather + merge + rank. The screen can now paint
 * from one round-trip instead of waiting on the slowest of six.
 *
 * IMPORTANT — behavior-preserving: the merge + ranking here mirror exactly the
 * client-side logic that previously lived in client/src/pages/today.tsx. We
 * call the SAME storage methods and services the original endpoints used
 * (storage.getLeads/getDeals/getProperties/getNotes/getTasks, portfolioHealth,
 * the paxObservations table) — no business logic is re-invented.
 *
 * Sources merged server-side:
 *   - Pax priorities    (mirrors /api/dashboard/today-priorities)
 *   - Today's tasks     (mirrors /api/tasks, filtered to today/overdue)
 *   - Portfolio alerts  (mirrors /api/alerts/active)
 *   - Pax noticed       (mirrors /api/pax/insights observations/stale/expiring)
 *   - Pax suggests      (mirrors /api/pax/pax-suggestions)
 *   - AI action queue   (mirrors /api/dashboard/intelligence .actions)
 *
 * The Activity feed is intentionally NOT merged here: it is an independent
 * infinite-scroll surface (client/src/components/activity-feed.tsx) with its
 * own pagination, so folding it into a one-shot payload would break scroll.
 * It stays a separate client query — `activity` is returned as [] for shape
 * parity and the client renders <TodayActivityFeed /> as before.
 */

import { Router, type Response } from "express";
import { and, desc, eq, gte, gt, sql } from "drizzle-orm";
import { paxObservations, leads as leadsTable, deals as dealsTable, properties as propertiesTable } from "@shared/schema";
import { db, storage } from "./storage";
import { runPortfolioHealthJob, getActiveAlerts } from "./services/portfolioHealth";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };

type DecisionSource =
  | "pax-priority"
  | "pax-suggests"
  | "pax-noticed"
  | "ai-queue"
  | "portfolio-alert";

interface DecisionItem {
  id: string;
  source: DecisionSource;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  rank: number;
  confidence?: number | null;
}

const alertHrefByType: Record<string, string> = {
  note_overdue: "/money",
  stale_leads: "/pipeline#leads",
  stuck_deals: "/pipeline#board",
  stale_avm: "/pipeline#properties",
};

const alertLinkLabelByType: Record<string, string> = {
  note_overdue: "View notes",
  stale_leads: "View leads",
  stuck_deals: "View deals",
  stale_avm: "View properties",
};

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days: number, from: Date) {
  return new Date(from.getTime() - days * DAY_MS);
}
function isOverdue(due: Date, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due < startOfToday;
}
function isTodayOrOverdue(due: Date, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY_MS);
  return due < startOfTomorrow;
}

// ── Pax priorities: mirrors /api/dashboard/today-priorities ────────────────
async function gatherPaxPriorities(orgId: number, now: Date): Promise<DecisionItem[]> {
  const [unscoredLeads, staleFollowUps, campaignFreshness] = await Promise.allSettled([
    db.select({ count: sql<number>`COUNT(*)` })
      .from(leadsTable)
      .where(and(
        eq(leadsTable.organizationId, orgId),
        sql`status NOT IN ('closed', 'dead', 'converted')`,
        sql`(score IS NULL OR last_score_at IS NULL)`,
      )),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(leadsTable)
      .where(and(
        eq(leadsTable.organizationId, orgId),
        sql`status NOT IN ('closed', 'dead', 'converted')`,
        sql`(last_contacted_at IS NULL OR last_contacted_at < ${daysAgo(28, now).toISOString()})`,
      )),
    db.select({ lastSent: sql<string>`MAX(created_at)` })
      .from(sql`campaigns`)
      .where(sql`organization_id = ${orgId}`),
  ]);

  const unscoredCount = unscoredLeads.status === "fulfilled" ? Number(unscoredLeads.value[0]?.count) || 0 : 0;
  const staleCount = staleFollowUps.status === "fulfilled" ? Number(staleFollowUps.value[0]?.count) || 0 : 0;
  const lastSent = campaignFreshness.status === "fulfilled" ? campaignFreshness.value[0]?.lastSent : null;
  const lastCampaignDaysAgo = lastSent
    ? Math.floor((now.getTime() - new Date(lastSent).getTime()) / DAY_MS)
    : 999;

  type Priority = { id: string; priority: "high" | "medium" | "low"; title: string; description: string; actionLabel: string; actionUrl: string };
  const priorities: Priority[] = [];

  if (unscoredCount > 0) {
    priorities.push({
      id: "score-leads",
      priority: "high",
      title: `Score ${unscoredCount} unscored lead${unscoredCount !== 1 ? "s" : ""}`,
      description: `You have ${unscoredCount} lead${unscoredCount !== 1 ? "s" : ""} awaiting AcreScore™ analysis. Scored leads convert 3× faster — don't leave them cold.`,
      actionLabel: "Score Now",
      actionUrl: "/leads?filter=unscored",
    });
  }
  if (staleCount > 0) {
    priorities.push({
      id: "follow-up",
      priority: staleCount > 10 ? "high" : "medium",
      title: `Follow up with ${Math.min(staleCount, 5)} seller${staleCount > 1 ? "s" : ""} who haven't responded`,
      description: `${staleCount} lead${staleCount !== 1 ? "s" : ""} haven't been contacted in 28+ days. Consistent follow-up is the key to conversion.`,
      actionLabel: "View Stale Leads",
      actionUrl: "/leads?filter=stale",
    });
  }
  if (lastCampaignDaysAgo > 45) {
    priorities.push({
      id: "send-campaign",
      priority: lastCampaignDaysAgo > 60 ? "high" : "medium",
      title: `Send a direct mail campaign — you haven't mailed in ${Math.min(lastCampaignDaysAgo, 90)}+ days`,
      description: "The mailer that goes out today is the passive income that arrives next quarter. Keep your pipeline full.",
      actionLabel: "Plan Campaign",
      actionUrl: "/campaigns",
    });
  }
  if (priorities.length === 0) {
    priorities.push({
      id: "county-snapshot",
      priority: "medium",
      title: "Check your primary county intelligence snapshot",
      description: "Review USDA land values, migration signals, and opportunity score for your target county.",
      actionLabel: "View County Data",
      actionUrl: "/data-intelligence",
    });
  }
  if (priorities.length < 2) {
    priorities.push({
      id: "review-pipeline",
      priority: "low",
      title: "Review your deal pipeline for stuck deals",
      description: "Deals that haven't moved in 14+ days often need a nudge. Check your pipeline board.",
      actionLabel: "View Pipeline",
      actionUrl: "/pipeline",
    });
  }
  if (priorities.length < 3) {
    priorities.push({
      id: "evening-review",
      priority: "low",
      title: "Review your passive income progress tonight",
      description: "Open the Evening Review dashboard to see today's note payments, freedom meter progress, and tomorrow's one thing.",
      actionLabel: "Open Evening Review",
      actionUrl: "/evening-review",
    });
  }

  return priorities.slice(0, 3).map((p, idx) => ({
    id: `priority-${p.id}`,
    source: "pax-priority" as const,
    priority: p.priority,
    title: p.title,
    description: p.description,
    actionLabel: p.actionLabel,
    actionUrl: p.actionUrl,
    rank: idx,
  }));
}

// ── Pax noticed: mirrors /api/pax/insights (observations/stale/expiring) ───
async function gatherPaxNoticed(orgId: number, now: Date): Promise<DecisionItem[]> {
  const items: DecisionItem[] = [];

  // Observations (status=detected), re-sorted by severity then recency, top 10.
  const rawObservations = await db
    .select({
      id: paxObservations.id,
      severity: paxObservations.severity,
      title: paxObservations.title,
      description: paxObservations.description,
      createdAt: paxObservations.createdAt,
    })
    .from(paxObservations)
    .where(and(
      eq(paxObservations.organizationId, orgId),
      eq(paxObservations.status, "detected"),
    ))
    .orderBy(desc(paxObservations.createdAt))
    .limit(50);

  const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1, info: 0 };
  rawObservations
    .sort((a, b) => {
      const rankDiff = (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    })
    .slice(0, 10)
    .forEach((obs) => {
      const sev: "high" | "medium" | "low" =
        obs.severity === "high" ? "high" : obs.severity === "medium" ? "medium" : "low";
      items.push({
        id: `obs-${obs.id}`,
        source: "pax-noticed",
        priority: sev,
        title: obs.title,
        description: obs.description,
        actionLabel: "Review",
        actionUrl: "/pax#insights",
        rank: 300 + priorityRank[sev],
      });
    });

  // Stale leads: not contacted in > 21 days.
  const twentyOneDaysAgo = daysAgo(21, now);
  const allActiveLeads = await db
    .select({
      id: leadsTable.id,
      firstName: leadsTable.firstName,
      lastName: leadsTable.lastName,
      lastContactedAt: leadsTable.lastContactedAt,
      status: leadsTable.status,
      doNotContact: leadsTable.doNotContact,
    })
    .from(leadsTable)
    .where(eq(leadsTable.organizationId, orgId));

  allActiveLeads
    .filter((l) => {
      if (l.status === "closed" || l.status === "dead") return false;
      if (l.doNotContact) return false;
      if (!l.lastContactedAt) return true;
      return new Date(l.lastContactedAt).getTime() < twentyOneDaysAgo.getTime();
    })
    .map((l) => ({
      id: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      daysSinceContact: l.lastContactedAt
        ? Math.floor((now.getTime() - new Date(l.lastContactedAt).getTime()) / DAY_MS)
        : 999,
    }))
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
    .forEach((lead) => {
      items.push({
        id: `stale-lead-${lead.id}`,
        source: "pax-noticed",
        priority: "medium",
        title: `${lead.firstName} ${lead.lastName} hasn't been contacted`,
        description: lead.daysSinceContact >= 999
          ? "Never contacted"
          : `${lead.daysSinceContact} days since last contact`,
        actionLabel: "Follow up",
        actionUrl: "/leads",
        rank: 310,
      });
    });

  // Expiring offers: deals with offerDate within the last 72 hours.
  const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);
  const recentDeals = await db
    .select({
      id: dealsTable.id,
      propertyId: dealsTable.propertyId,
      offerDate: dealsTable.offerDate,
    })
    .from(dealsTable)
    .where(and(
      eq(dealsTable.organizationId, orgId),
      gte(dealsTable.offerDate, seventyTwoHoursAgo),
    ))
    .orderBy(desc(dealsTable.offerDate));

  const propertyIds = [...new Set(recentDeals.map((d) => d.propertyId).filter(Boolean))];
  const propertyMap: Record<number, string> = {};
  if (propertyIds.length > 0) {
    const props = await db
      .select({ id: propertiesTable.id, address: propertiesTable.address })
      .from(propertiesTable)
      .where(eq(propertiesTable.organizationId, orgId));
    for (const p of props) {
      if (propertyIds.includes(p.id)) {
        propertyMap[p.id] = p.address ?? `Property #${p.id}`;
      }
    }
  }

  recentDeals.forEach((d) => {
    const title = propertyMap[d.propertyId] ?? `Deal #${d.id}`;
    const offerExpiresAt = d.offerDate
      ? new Date(new Date(d.offerDate).getTime() + 72 * 60 * 60 * 1000)
      : null;
    items.push({
      id: `expiring-offer-${d.id}`,
      source: "pax-noticed",
      priority: "high",
      title,
      description: `Offer expires ${offerExpiresAt
        ? offerExpiresAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "soon"}`,
      actionLabel: "View deal",
      actionUrl: "/deals",
      rank: 250,
    });
  });

  return items;
}

// ── Pax suggests: mirrors /api/pax/pax-suggestions ─────────────────────────
async function gatherPaxSuggests(orgId: number, now: Date): Promise<DecisionItem[]> {
  const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);

  const recentObs = await db
    .select({
      id: paxObservations.id,
      type: paxObservations.type,
      title: paxObservations.title,
      description: paxObservations.description,
      confidenceScore: paxObservations.confidenceScore,
      metadata: paxObservations.metadata,
    })
    .from(paxObservations)
    .where(and(
      eq(paxObservations.organizationId, orgId),
      eq(paxObservations.status, "detected"),
      gte(paxObservations.detectedAt, seventyTwoHoursAgo),
      gt(paxObservations.confidenceScore, 70),
    ))
    .orderBy(desc(paxObservations.confidenceScore), desc(paxObservations.detectedAt))
    .limit(20);

  type Suggestion = {
    id: string; suggestion: string; rationale: string; actionLabel: string; actionUrl: string; confidence: number;
  };
  const suggestions: Suggestion[] = [];

  for (const obs of recentObs) {
    if (suggestions.length >= 3) break;
    const confidence = (obs.confidenceScore ?? 0) / 100;
    const entityId = (obs.metadata as any)?.relatedEntityId;
    let actionLabel = "Review";
    let actionUrl = "/today";
    if (obs.type === "activity_drop" || obs.type === "anomaly") {
      actionLabel = "Create Task"; actionUrl = "/pipeline";
    } else if (obs.type === "opportunity" || obs.type === "optimization") {
      actionLabel = "View Lead"; actionUrl = entityId ? `/leads?highlight=${entityId}` : "/leads";
    } else if (obs.type === "quota_warning" || obs.type === "performance") {
      actionLabel = "View Analytics"; actionUrl = "/analytics";
    } else if (obs.type === "data_issue" || obs.type === "error_pattern") {
      actionLabel = "Review"; actionUrl = "/settings";
    } else if (obs.type === "usage_spike") {
      actionLabel = "View Dashboard"; actionUrl = "/";
    }
    suggestions.push({
      id: `obs-${obs.id}`,
      suggestion: obs.title,
      rationale: obs.description,
      actionLabel,
      actionUrl,
      confidence,
    });
  }

  // Fill remaining slots from stale leads (up to 3 total).
  if (suggestions.length < 3) {
    const twentyOneDaysAgo = daysAgo(21, now);
    const staleLeads = await db
      .select({
        id: leadsTable.id,
        firstName: leadsTable.firstName,
        lastName: leadsTable.lastName,
        lastContactedAt: leadsTable.lastContactedAt,
        status: leadsTable.status,
        email: leadsTable.email,
      })
      .from(leadsTable)
      .where(eq(leadsTable.organizationId, orgId))
      .orderBy(leadsTable.lastContactedAt)
      .limit(50);

    const staleFiltered = staleLeads
      .filter((l) => {
        if (["closed", "dead"].includes(l.status ?? "")) return false;
        if (!l.lastContactedAt) return true;
        return new Date(l.lastContactedAt).getTime() < twentyOneDaysAgo.getTime();
      })
      .slice(0, 5);

    for (const lead of staleFiltered) {
      if (suggestions.length >= 3) break;
      const daysSince = lead.lastContactedAt
        ? Math.floor((now.getTime() - new Date(lead.lastContactedAt).getTime()) / DAY_MS)
        : null;
      const daysText = daysSince != null ? `${daysSince} days ago` : "never";
      suggestions.push({
        id: `stale-${lead.id}`,
        suggestion: `Follow up with ${lead.firstName} ${lead.lastName}`,
        rationale: `Last contacted ${daysText}. Re-engaging stale leads improves conversion rates.`,
        actionLabel: lead.email ? "Send Email" : "Create Task",
        actionUrl: `/leads?highlight=${lead.id}`,
        confidence: 0.82,
      });
    }
  }

  return suggestions.slice(0, 3).map((s) => ({
    id: `suggest-${s.id}`,
    source: "pax-suggests" as const,
    priority: s.confidence >= 0.85 ? "high" : s.confidence >= 0.7 ? "medium" : "low",
    title: s.suggestion,
    description: s.rationale,
    actionLabel: s.actionLabel,
    actionUrl: s.actionUrl,
    rank: 400 + (1 - s.confidence) * 10,
    confidence: s.confidence,
  }));
}

// ── AI action queue: mirrors the .actions slice of /api/dashboard/intelligence
async function gatherAiQueue(
  orgId: number,
  now: Date,
  allLeads: Awaited<ReturnType<typeof storage.getLeads>>,
  allDeals: Awaited<ReturnType<typeof storage.getDeals>>,
  allProperties: Awaited<ReturnType<typeof storage.getProperties>>,
): Promise<DecisionItem[]> {
  type Action = { id: string; priority: "high" | "medium" | "low"; title: string; description: string; actionLabel: string; actionUrl: string };
  const actions: Action[] = [];

  const staleLeads = allLeads
    .filter((l) => {
      if (l.status === "closed" || l.status === "dead" || l.doNotContact) return false;
      if (!l.lastContactedAt) return true;
      const days = Math.floor((now.getTime() - new Date(l.lastContactedAt).getTime()) / DAY_MS);
      return days >= 7;
    })
    .sort((a, b) => {
      const da = a.lastContactedAt ? Math.floor((now.getTime() - new Date(a.lastContactedAt).getTime()) / DAY_MS) : 999;
      const dbb = b.lastContactedAt ? Math.floor((now.getTime() - new Date(b.lastContactedAt).getTime()) / DAY_MS) : 999;
      return dbb - da;
    })
    .slice(0, 3);

  for (const lead of staleLeads) {
    const daysSinceContact = lead.lastContactedAt
      ? Math.floor((now.getTime() - new Date(lead.lastContactedAt).getTime()) / DAY_MS)
      : null;
    actions.push({
      id: `follow-up-${lead.id}`,
      priority: daysSinceContact && daysSinceContact > 14 ? "high" : "medium",
      title: `Follow up with ${lead.firstName} ${lead.lastName}`,
      description: daysSinceContact ? `Last contact ${daysSinceContact} days ago` : "Never contacted",
      actionLabel: "View Lead",
      actionUrl: "/leads",
    });
  }

  const pendingDeals = allDeals
    .filter((d) => d.status === "offer_sent" || d.status === "negotiating")
    .slice(0, 2);
  for (const deal of pendingDeals) {
    const property = allProperties.find((p) => p.id === deal.propertyId);
    const propertyName = property?.address || `Property #${deal.propertyId}`;
    const daysSinceOffer = deal.offerDate
      ? Math.floor((now.getTime() - new Date(deal.offerDate).getTime()) / DAY_MS)
      : null;
    actions.push({
      id: `review-deal-${deal.id}`,
      priority: daysSinceOffer && daysSinceOffer > 5 ? "high" : "medium",
      title: `Review offer on ${propertyName}`,
      description: deal.status === "offer_sent" ? "Awaiting seller response" : "In negotiation",
      actionLabel: "View Deal",
      actionUrl: "/deals",
    });
  }

  const pendingProperties = allProperties
    .filter((p) => p.status === "listed" && p.updatedAt)
    .sort((a, b) => new Date(a.updatedAt!).getTime() - new Date(b.updatedAt!).getTime())
    .slice(0, 2);
  for (const property of pendingProperties) {
    const daysListed = property.updatedAt
      ? Math.floor((now.getTime() - new Date(property.updatedAt).getTime()) / DAY_MS)
      : 0;
    if (daysListed > 30) {
      actions.push({
        id: `property-${property.id}`,
        priority: daysListed > 60 ? "high" : "medium",
        title: `Review listing for ${property.address || `Property #${property.id}`}`,
        description: `Listed for ${daysListed} days without a sale`,
        actionLabel: "View Property",
        actionUrl: "/properties",
      });
    }
  }

  actions.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

  return actions.slice(0, 5).map((a) => ({
    id: `ai-${a.id}`,
    source: "ai-queue" as const,
    priority: a.priority,
    title: a.title,
    description: a.description,
    actionLabel: a.actionLabel,
    actionUrl: a.actionUrl,
    rank: 500 + priorityRank[a.priority],
  }));
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const orgId = org.id;
    const now = new Date();

    // Refresh portfolio alerts the same way /api/alerts/active does.
    await runPortfolioHealthJob(orgId).catch((e) =>
      logger.warn("Today: portfolio health refresh failed", { error: e instanceof Error ? e.message : String(e) }),
    );

    const [
      paxPriorities,
      tasks,
      activeAlerts,
      paxNoticed,
      paxSuggests,
      allLeads,
      allDeals,
      allProperties,
      allNotes,
    ] = await Promise.all([
      gatherPaxPriorities(orgId, now),
      storage.getTasks(orgId),
      getActiveAlerts(orgId),
      gatherPaxNoticed(orgId, now),
      gatherPaxSuggests(orgId, now),
      storage.getLeads(orgId),
      storage.getDeals(orgId),
      storage.getProperties(orgId),
      storage.getNotes(orgId),
    ]);

    // Today's tasks → ai-queue rows (mirrors today.tsx todayActions block).
    const taskItems: DecisionItem[] = tasks
      .filter((t) => {
        if (t.status === "completed" || t.status === "done") return false;
        if (!t.dueDate) return false;
        return isTodayOrOverdue(new Date(t.dueDate), now);
      })
      .map((t) => {
        const overdue = t.dueDate ? isOverdue(new Date(t.dueDate), now) : false;
        return {
          id: `task-${t.id}`,
          source: "ai-queue" as const,
          priority: (t.priority as "high" | "medium" | "low") ?? "medium",
          title: t.title,
          description: t.dueDate
            ? `${overdue ? "Overdue · " : ""}Due ${new Date(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
            : (t.description ?? ""),
          actionLabel: "Open task",
          actionUrl: "/pipeline",
          rank: 100 + (overdue ? 0 : 10) + (priorityRank[t.priority] ?? 1),
        };
      });

    // Portfolio alerts → portfolio-alert rows.
    const alertItems: DecisionItem[] = activeAlerts.map((a: any) => {
      const sev: "high" | "medium" | "low" =
        a.severity === "critical" ? "high" : a.severity === "warning" ? "medium" : "low";
      return {
        id: `alert-${a.id}`,
        source: "portfolio-alert" as const,
        priority: sev,
        title: a.title,
        description: a.message,
        actionLabel: alertLinkLabelByType[a.type] ?? "View",
        actionUrl: alertHrefByType[a.type] ?? "/",
        rank: 200 + priorityRank[sev],
      };
    });

    const aiQueue = await gatherAiQueue(orgId, now, allLeads, allDeals, allProperties);

    const queue: DecisionItem[] = [
      ...paxPriorities,
      ...taskItems,
      ...alertItems,
      ...paxNoticed,
      ...paxSuggests,
      ...aiQueue,
    ].sort((a, b) => a.rank - b.rank);

    // ── Cash strip aggregates (mirrors today.tsx cashAggregates/pipeline) ──
    const activeDeals = allDeals.filter((d) => !["closed", "cancelled"].includes(d.status));
    const pipelineValue = activeDeals.reduce(
      (sum, d) => sum + parseFloat(String((d as any).purchasePrice ?? (d as any).offerAmount ?? "0") || "0"),
      0,
    );

    const activeNotes = allNotes.filter(
      (n) => n.status === "active" || n.status === "late" || n.status === "delinquent",
    );
    const lateCount = allNotes.filter((n) => n.status === "late" || n.status === "delinquent").length;
    const within = (days: number) =>
      activeNotes.filter((n) => {
        if (!n.nextPaymentDate) return false;
        const diff = (new Date(n.nextPaymentDate).getTime() - now.getTime()) / DAY_MS;
        return diff >= 0 && diff <= days;
      });
    const sumPayments = (arr: typeof activeNotes) =>
      arr.reduce((s, n) => s + parseFloat(String(n.monthlyPayment ?? "0") || "0"), 0);

    const projected30 = sumPayments(within(30));
    const projected90 = sumPayments(within(90));

    // pendingDecisionCount feeds the hero badge (mirrors today.tsx).
    const stalledLeads = allLeads.filter((l) => {
      if (["closed", "dead", "converted"].includes(l.status)) return false;
      if (!l.lastContactedAt) return true;
      return new Date(l.lastContactedAt) < daysAgo(14, now);
    }).length;
    const waitingCounters = allDeals.filter((d) => {
      if (d.status !== "offer_sent") return false;
      if (!d.offerDate) return false;
      return new Date(d.offerDate) < daysAgo(7, now);
    }).length;
    const stuckDeals = allDeals.filter((d) => {
      if (["closed", "cancelled", "offer_sent"].includes(d.status)) return false;
      if (!d.updatedAt) return false;
      return new Date(d.updatedAt) < daysAgo(14, now);
    }).length;
    const pendingDecisionCount = stalledLeads + waitingCounters + stuckDeals;

    const hasAnyData = allLeads.length > 0 || allProperties.length > 0 || allDeals.length > 0;

    res.json({
      queue,
      cash: {
        cashOnHand: projected90,
        openDealsValue: pipelineValue,
        openDealsCount: activeDeals.length,
        pendingPayments30: projected30,
        lateCount,
      },
      // Activity intentionally not merged (see file header) — kept for shape parity.
      activity: [],
      meta: {
        pendingDecisionCount,
        hasAnyData,
        generatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Today consolidated endpoint error", error instanceof Error ? error : undefined);
    Errors.internal(res, error);
  }
});

export default router;
