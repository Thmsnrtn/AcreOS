/**
 * Founder action-queue computation (F-D #3 extraction).
 *
 * Extracted from routes-admin.ts so both the legacy /api/founder/action-queue
 * endpoint AND the unified /api/founder/intelligence/todo can read from a
 * single source of truth.
 *
 * Per docs/archive/exhaustive-completion/founder-dashboard-extraction-queue.md
 * Extraction #3: "ActionQueuePanel inside founder-dashboard.tsx solves the
 * same problem with a different data source. Both should converge on
 * /founder/todo; ActionQueuePanel goes away."
 */

import { db } from "../db";
import {
  supportTickets,
  organizations,
  featureRequests,
  growthCampaigns,
} from "@shared/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";

export type ActionQueuePriority = "critical" | "high" | "medium" | "low";

export interface ActionQueueItem {
  id: string;
  type:
    | "support_escalation"
    | "dunning_critical"
    | "expiring_trial"
    | "feature_request"
    | "inactive_campaign";
  priority: ActionQueuePriority;
  title: string;
  description: string;
  estimatedMinutes: number;
  suggestedAction: string;
  data: Record<string, unknown>;
}

export interface ActionQueueResponse {
  items: ActionQueueItem[];
  totalEstimatedMinutes: number;
  counts: { critical: number; high: number; medium: number };
}

export async function getActionQueueItems(): Promise<ActionQueueResponse> {
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const items: ActionQueueItem[] = [];

  // 1. Escalated support tickets
  const escalatedTickets = await db.select({
    id: supportTickets.id,
    subject: supportTickets.subject,
    priority: supportTickets.priority,
    createdAt: supportTickets.createdAt,
    organizationId: supportTickets.organizationId,
  }).from(supportTickets)
    .where(and(
      eq(supportTickets.resolutionType as any, 'escalated' as any),
      or(eq(supportTickets.status, 'open' as any), eq(supportTickets.status, 'in_progress' as any)),
    ))
    .limit(5);
  for (const ticket of escalatedTickets) {
    items.push({
      id: `support-${ticket.id}`,
      type: "support_escalation",
      priority: ticket.priority === "urgent" ? "critical" : "high",
      title: `Support: ${ticket.subject}`,
      description: "Escalated ticket requiring human response",
      estimatedMinutes: 5,
      suggestedAction: "Review and reply with AI-drafted response",
      data: { ticketId: ticket.id, organizationId: ticket.organizationId },
    });
  }

  // 2. Orgs in critical dunning stages
  const criticalOrgs = await db.select({
    id: organizations.id,
    name: organizations.name,
    dunningStage: organizations.dunningStage,
    subscriptionTier: organizations.subscriptionTier,
  }).from(organizations)
    .where(or(
      eq(organizations.dunningStage, "suspended"),
      eq(organizations.dunningStage, "restricted"),
    ));
  for (const org of criticalOrgs) {
    items.push({
      id: `dunning-${org.id}`,
      type: "dunning_critical",
      priority: org.dunningStage === "suspended" ? "critical" : "high",
      title: `${org.name} — ${org.dunningStage}`,
      description: `${org.subscriptionTier} customer in ${org.dunningStage} dunning stage. Revenue at risk.`,
      estimatedMinutes: 2,
      suggestedAction: "Review payment history and consider direct outreach",
      data: { organizationId: org.id, dunningStage: org.dunningStage },
    });
  }

  // 3. Trials expiring in 3 days with no conversion
  const expiringTrials = await db.select({
    id: organizations.id,
    name: organizations.name,
    trialEndsAt: organizations.trialEndsAt,
    subscriptionTier: organizations.subscriptionTier,
  }).from(organizations)
    .where(and(
      sql`${organizations.trialEndsAt} IS NOT NULL`,
      sql`${organizations.trialEndsAt} <= ${in3Days}`,
      sql`${organizations.trialEndsAt} > ${now}`,
      eq(organizations.subscriptionTier, "free"),
    ));
  for (const org of expiringTrials) {
    const daysLeft = Math.ceil((new Date(org.trialEndsAt as any).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    items.push({
      id: `trial-${org.id}`,
      type: "expiring_trial",
      priority: daysLeft <= 1 ? "high" : "medium",
      title: `${org.name} — trial expires in ${daysLeft}d`,
      description: "Still on free tier. Trial ends soon — conversion opportunity.",
      estimatedMinutes: 2,
      suggestedAction: "Send personalized outreach or offer a discount to convert",
      data: { organizationId: org.id, trialEndsAt: org.trialEndsAt },
    });
  }

  // 4. High-vote unreviewed feature requests
  const hotFeatureRequests = await db.select({
    id: featureRequests.id,
    title: featureRequests.title,
    upvotes: featureRequests.upvotes,
  }).from(featureRequests)
    .where(and(
      eq(featureRequests.status, "submitted"),
      sql`${featureRequests.upvotes} >= 5`,
    ))
    .orderBy(desc(featureRequests.upvotes))
    .limit(3);
  for (const req of hotFeatureRequests) {
    items.push({
      id: `feature-${req.id}`,
      type: "feature_request",
      priority: (req.upvotes || 0) >= 10 ? "high" : "medium",
      title: `${req.upvotes} votes: ${req.title}`,
      description: "Popular feature request awaiting triage",
      estimatedMinutes: 1,
      suggestedAction: "Mark as planned / in_progress / declined with founder notes",
      data: { featureRequestId: req.id, upvotes: req.upvotes },
    });
  }

  // 5. Draft campaigns never activated
  const draftCampaigns = await db.select({
    id: growthCampaigns.id,
    name: growthCampaigns.name,
    createdAt: growthCampaigns.createdAt,
  }).from(growthCampaigns)
    .where(eq(growthCampaigns.status, "draft"));
  for (const campaign of draftCampaigns) {
    const daysOld = Math.floor((now.getTime() - new Date(campaign.createdAt as any).getTime()) / (1000 * 60 * 60 * 24));
    if (daysOld >= 1) {
      items.push({
        id: `campaign-${campaign.id}`,
        type: "inactive_campaign",
        priority: "medium",
        title: `Campaign "${campaign.name}" never activated`,
        description: `Created ${daysOld}d ago, still in draft. Activate in Meta Ads Manager to start spending.`,
        estimatedMinutes: 1,
        suggestedAction: "Activate in Meta Ads Manager or delete if no longer needed",
        data: { campaignId: campaign.id },
      });
    }
  }

  // Sort by priority weight
  const priorityWeight: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((a, b) => priorityWeight[a.priority] - priorityWeight[b.priority]);

  return {
    items,
    totalEstimatedMinutes: items.reduce((s, i) => s + (i.estimatedMinutes || 0), 0),
    counts: {
      critical: items.filter((i) => i.priority === "critical").length,
      high: items.filter((i) => i.priority === "high").length,
      medium: items.filter((i) => i.priority === "medium").length,
    },
  };
}

/**
 * Adapt action-queue items into the unified TodoItem shape so the
 * /api/founder/intelligence/todo merge keeps a single client-side renderer.
 *
 * Each item gets `source: 'action-queue'` for provenance.
 */
export interface ActionQueueAsTodoItem {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  urgency: number;
  estimatedImpactCents: number | null;
  actionUrl: string;
  createdAt: string;
  badge?: string;
  source: "action-queue";
  // Original payload for rich rendering downstream.
  rawType: ActionQueueItem["type"];
  rawData: Record<string, unknown>;
  estimatedMinutes: number;
  suggestedAction: string;
}

const PRIORITY_TO_URGENCY: Record<ActionQueuePriority, number> = {
  critical: 95,
  high: 75,
  medium: 50,
  low: 25,
};

const TYPE_TO_ROUTE: Record<ActionQueueItem["type"], (data: any) => string> = {
  // The old founder-dashboard monolith's ?tab= deep links died with the
  // monolith (see CLAUDE.md "Known monoliths"); its alias redirects to the
  // founder home and the params were consumed by nothing. rawData still
  // carries ticketId/featureRequestId/campaignId for downstream rendering.
  support_escalation: () => "/founder",
  dunning_critical: (d) => `/founder/customers?orgId=${d.organizationId ?? ""}`,
  expiring_trial: (d) => `/founder/customers?orgId=${d.organizationId ?? ""}`,
  feature_request: () => "/founder",
  inactive_campaign: () => "/founder",
};

export async function getActionQueueAsTodos(): Promise<ActionQueueAsTodoItem[]> {
  const queue = await getActionQueueItems();
  // Synthetic numeric ids — the unified TodoItem expects `id: number` but
  // action-queue ids are namespaced strings ("support-12"). Hash to a
  // stable positive integer so the React key remains stable.
  return queue.items.map((it, idx) => {
    const numericId = Math.abs(hashString(it.id)) || idx;
    return {
      type: `action_queue:${it.type}`,
      id: numericId,
      title: it.title,
      subtitle: it.description,
      urgency: PRIORITY_TO_URGENCY[it.priority] ?? 50,
      estimatedImpactCents: null,
      actionUrl: TYPE_TO_ROUTE[it.type](it.data ?? {}),
      createdAt: new Date().toISOString(),
      badge: it.type,
      source: "action-queue",
      rawType: it.type,
      rawData: it.data ?? {},
      estimatedMinutes: it.estimatedMinutes,
      suggestedAction: it.suggestedAction,
    };
  });
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
