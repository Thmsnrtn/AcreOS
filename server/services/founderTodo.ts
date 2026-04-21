/**
 * Founder Todo — the unified "what needs you right now" feed.
 *
 * The platform now has eight separate inboxes. Each serves a purpose
 * but the founder's actual question is simpler: "what am I behind on?"
 * This service aggregates across all of them into one ranked list so
 * the monthly 1-hour session has a single starting point.
 *
 * Sources folded in:
 *   - decisions_inbox_items where status='pending' or 'deferred'
 *   - agent_prompt_evolutions where status='proposed'
 *   - strategic_proposals where status IN ('proposed', 'synthesized')
 *   - tool_proposals where status='proposed'
 *   - expansion_candidates where status='proposed'
 *   - onboarding_journeys where founder_flag='escalate'
 *   - decisions_inbox_items with recommendedAction='experiment_promote_winner'
 *     (surface these distinctly as "experiment winner ready to promote")
 *
 * Urgency computation: each item gets a 0-100 urgency score so the
 * founder sees the most-leveraged items first. Weights reflect
 * business impact (money first, people second, pure polish last).
 */

import { db } from "../db";
import {
  decisionsInboxItems,
  agentPromptEvolutions,
  strategicProposals,
  toolProposals,
  expansionCandidates,
  onboardingJourneys,
  organizations,
  companyAgents,
} from "@shared/schema";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";

export type TodoType =
  | "decision"                 // operational decision awaiting approval
  | "prompt_evolution"         // agent prompt-revision proposal
  | "strategic_move"           // strategic proposal from synthesis
  | "tool_proposal"            // capability-growth proposal
  | "expansion_candidate"      // upsell-ready customer
  | "onboarding_rescue"        // customer onboarding stalled
  | "experiment_promotion";    // a/b experiment winner to promote

export interface TodoItem {
  type: TodoType;
  id: number;
  title: string;
  subtitle: string;
  urgency: number; // 0-100
  estimatedImpactCents: number | null;
  actionUrl: string;           // where to go to resolve it
  createdAt: string;           // ISO
  badge?: string;              // small label (e.g. agent codename)
}

export interface FounderTodoResponse {
  generatedAt: string;
  total: number;
  byType: Record<TodoType, number>;
  items: TodoItem[];
}

export async function getFounderTodos(
  limit: number = 100,
): Promise<FounderTodoResponse> {
  const [
    decisions,
    promptEvolutions,
    strategicItems,
    toolItems,
    expansionItems,
    onboardingItems,
    experimentPromotions,
  ] = await Promise.all([
    fetchDecisions(),
    fetchPromptEvolutions(),
    fetchStrategicProposals(),
    fetchToolProposals(),
    fetchExpansionCandidates(),
    fetchOnboardingFlagged(),
    fetchExperimentPromotions(),
  ]);

  const all: TodoItem[] = [
    ...decisions,
    ...promptEvolutions,
    ...strategicItems,
    ...toolItems,
    ...expansionItems,
    ...onboardingItems,
    ...experimentPromotions,
  ];

  // Sort: urgency desc, then $impact desc, then newest first
  all.sort((a, b) => {
    if (a.urgency !== b.urgency) return b.urgency - a.urgency;
    const aImpact = Math.abs(a.estimatedImpactCents ?? 0);
    const bImpact = Math.abs(b.estimatedImpactCents ?? 0);
    if (aImpact !== bImpact) return bImpact - aImpact;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const byType: Record<TodoType, number> = {
    decision: 0,
    prompt_evolution: 0,
    strategic_move: 0,
    tool_proposal: 0,
    expansion_candidate: 0,
    onboarding_rescue: 0,
    experiment_promotion: 0,
  };
  for (const it of all) byType[it.type]++;

  return {
    generatedAt: new Date().toISOString(),
    total: all.length,
    byType,
    items: all.slice(0, limit),
  };
}

// ── Per-source fetchers ─────────────────────────────────────────────

async function fetchDecisions(): Promise<TodoItem[]> {
  const rows = await db
    .select()
    .from(decisionsInboxItems)
    .where(
      and(
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        )!,
        // Experiment-promotion items are surfaced separately below, so
        // exclude them here to avoid double-counting.
        sql`${decisionsInboxItems.recommendedAction} IS DISTINCT FROM 'experiment_promote_winner'`,
      ),
    )
    .orderBy(desc(decisionsInboxItems.urgencyScore))
    .limit(50);
  return rows.map((r) => ({
    type: "decision" as const,
    id: r.id,
    title: r.recommendedActionLabel,
    subtitle: `${r.itemType} · ${r.riskLevel} risk · ${r.ownerAgentCodename ?? "agent"}`,
    urgency: r.urgencyScore,
    estimatedImpactCents: r.estimatedImpactCents,
    actionUrl: `/founder/decisions?id=${r.id}`,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    badge: r.ownerAgentCodename ?? undefined,
  }));
}

async function fetchPromptEvolutions(): Promise<TodoItem[]> {
  const rows = await db
    .select()
    .from(agentPromptEvolutions)
    .where(eq(agentPromptEvolutions.status, "proposed"))
    .orderBy(desc(agentPromptEvolutions.createdAt))
    .limit(20);
  return rows.map((r) => ({
    type: "prompt_evolution" as const,
    id: r.id,
    title: `Prompt revision for ${r.agentCodename}`,
    subtitle: r.proposalReason.slice(0, 140),
    urgency: 45, // medium — review benefits compound but nothing is on fire
    estimatedImpactCents: null,
    actionUrl: `/founder/prompt-evolutions`,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    badge: r.agentCodename,
  }));
}

async function fetchStrategicProposals(): Promise<TodoItem[]> {
  const rows = await db
    .select()
    .from(strategicProposals)
    .where(
      sql`${strategicProposals.status} IN ('proposed', 'synthesized')`,
    )
    .orderBy(desc(strategicProposals.confidence))
    .limit(20);
  return rows.map((r) => ({
    type: "strategic_move" as const,
    id: r.id,
    title: r.title,
    subtitle: `${r.category} · ${r.confidence}% confidence · ${r.proposedBy}`,
    urgency: r.status === "synthesized" ? 55 : 35,
    estimatedImpactCents: r.estimatedImpactCents,
    actionUrl: `/founder/strategy`,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    badge: r.category,
  }));
}

async function fetchToolProposals(): Promise<TodoItem[]> {
  const rows = await db
    .select()
    .from(toolProposals)
    .where(eq(toolProposals.status, "proposed"))
    .orderBy(desc(toolProposals.createdAt))
    .limit(15);
  return rows.map((r) => ({
    type: "tool_proposal" as const,
    id: r.id,
    title: r.title,
    subtitle: `${r.category} · ${r.estimatedComplexity} complexity`,
    urgency: 30,
    estimatedImpactCents: r.estimatedImpactCents,
    actionUrl: `/founder/tools`,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    badge: r.proposedBy,
  }));
}

async function fetchExpansionCandidates(): Promise<TodoItem[]> {
  const rows = await db
    .select({
      id: expansionCandidates.id,
      organizationId: expansionCandidates.organizationId,
      currentTier: expansionCandidates.currentTier,
      proposedTier: expansionCandidates.proposedTier,
      score: expansionCandidates.score,
      estimatedMrrLiftCents: expansionCandidates.estimatedMrrLiftCents,
      createdAt: expansionCandidates.createdAt,
      orgName: organizations.name,
    })
    .from(expansionCandidates)
    .leftJoin(organizations, eq(organizations.id, expansionCandidates.organizationId))
    .where(eq(expansionCandidates.status, "proposed"))
    .orderBy(desc(expansionCandidates.score))
    .limit(10);
  return rows.map((r) => ({
    type: "expansion_candidate" as const,
    id: r.id,
    title: `Upgrade ${r.orgName ?? `Org #${r.organizationId}`}: ${r.currentTier} → ${r.proposedTier}`,
    subtitle: `Readiness score ${r.score}/100`,
    urgency: 40 + Math.round((r.score / 100) * 20), // 40-60
    estimatedImpactCents: r.estimatedMrrLiftCents,
    actionUrl: `/founder/expansion`,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    badge: "forge_revenue",
  }));
}

async function fetchOnboardingFlagged(): Promise<TodoItem[]> {
  const rows = await db
    .select({
      id: onboardingJourneys.id,
      organizationId: onboardingJourneys.organizationId,
      currentStepKey: onboardingJourneys.currentStepKey,
      startedAt: onboardingJourneys.startedAt,
      createdAt: onboardingJourneys.createdAt,
      activationStatus: onboardingJourneys.activationStatus,
      orgName: organizations.name,
    })
    .from(onboardingJourneys)
    .leftJoin(organizations, eq(organizations.id, onboardingJourneys.organizationId))
    .where(eq(onboardingJourneys.founderFlag, "escalate"))
    .limit(15);
  return rows.map((r) => ({
    type: "onboarding_rescue" as const,
    id: r.id,
    title: `Rescue onboarding for ${r.orgName ?? `Org #${r.organizationId}`}`,
    subtitle: `Currently at ${r.currentStepKey} · activation=${r.activationStatus}`,
    urgency: 75, // high — customer is actively at risk
    estimatedImpactCents: -100000, // ~$1k LTV risk per churn
    actionUrl: `/founder/onboarding`,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    badge: "sophie_csm",
  }));
}

async function fetchExperimentPromotions(): Promise<TodoItem[]> {
  const rows = await db
    .select()
    .from(decisionsInboxItems)
    .where(
      and(
        eq(decisionsInboxItems.status, "pending"),
        eq(decisionsInboxItems.recommendedAction, "experiment_promote_winner"),
      ),
    )
    .orderBy(desc(decisionsInboxItems.createdAt))
    .limit(10);
  return rows.map((r) => ({
    type: "experiment_promotion" as const,
    id: r.id,
    title: r.recommendedActionLabel,
    subtitle: r.sophieAnalysis.slice(0, 140),
    urgency: 50, // medium — winner locked in but not urgent
    estimatedImpactCents: r.estimatedImpactCents,
    actionUrl: `/founder/experiments`,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    badge: "oracle_analytics",
  }));
}
