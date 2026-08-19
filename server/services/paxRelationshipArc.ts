/**
 * Pax Relationship Arc — progressive relationship between Pax and the user.
 *
 * 4 stages: onboarding → building → trusted → partner
 * Each stage unlocks different Pax behaviors:
 *   onboarding: helpful, educational, cautious suggestions
 *   building: proactive tips, remembers preferences, offers shortcuts
 *   trusted: autonomous actions, predictive insights, challenges assumptions
 *   partner: strategic advisor, long-term planning, portfolio-level thinking
 *
 * Stage progression based on: session count, deals closed, features used,
 * Pax interaction quality, and time on platform.
 */

import { db } from "../db";
import { organizations, paxMemory, deals } from "@shared/schema";
import { eq, and, sql, gte, count } from "drizzle-orm";
import { logger } from "../utils/logger";

// ── Types ───────────────────────────────────────────────────────────

export type RelationshipStage = "onboarding" | "building" | "trusted" | "partner";

export interface RelationshipState {
  orgId: number;
  stage: RelationshipStage;
  stageEnteredAt: string;
  sessionCount: number;
  dealsClosed: number;
  featuresUsed: number;
  paxInteractions: number;
  progressPercent: number;
  nextStage: RelationshipStage | null;
  nextStageRequirements: string[];
}

export interface StageBehavior {
  proactivityLevel: "low" | "medium" | "high" | "very_high";
  canTakeAutonomousActions: boolean;
  suggestionsStyle: "educational" | "practical" | "strategic" | "challenging";
  memoryDepth: "session" | "week" | "month" | "lifetime";
  greetingStyle: string;
  personalityTraits: string[];
  unlockedCapabilities: string[];
}

interface StageThresholds {
  sessions: number;
  dealsClosed: number;
  featuresUsed: number;
  paxInteractions: number;
  daysOnPlatform: number;
}

// ── Stage Thresholds ────────────────────────────────────────────────

const THRESHOLDS: Record<RelationshipStage, StageThresholds> = {
  onboarding: { sessions: 0, dealsClosed: 0, featuresUsed: 0, paxInteractions: 0, daysOnPlatform: 0 },
  building: { sessions: 10, dealsClosed: 1, featuresUsed: 5, paxInteractions: 20, daysOnPlatform: 7 },
  trusted: { sessions: 50, dealsClosed: 5, featuresUsed: 15, paxInteractions: 100, daysOnPlatform: 30 },
  partner: { sessions: 150, dealsClosed: 15, featuresUsed: 30, paxInteractions: 300, daysOnPlatform: 90 },
};

const STAGE_BEHAVIORS: Record<RelationshipStage, StageBehavior> = {
  onboarding: {
    proactivityLevel: "low",
    canTakeAutonomousActions: false,
    suggestionsStyle: "educational",
    memoryDepth: "session",
    greetingStyle: "Welcome! I'm Pax, your land investing assistant. How can I help you get started?",
    personalityTraits: ["helpful", "patient", "educational"],
    unlockedCapabilities: ["answer questions", "explain features", "basic property lookup"],
  },
  building: {
    proactivityLevel: "medium",
    canTakeAutonomousActions: false,
    suggestionsStyle: "practical",
    memoryDepth: "week",
    greetingStyle: "Hey! I noticed a few things while you were away — want a quick update?",
    personalityTraits: ["proactive", "remembered", "encouraging"],
    unlockedCapabilities: ["remember preferences", "proactive tips", "shortcut suggestions", "deal summaries"],
  },
  trusted: {
    proactivityLevel: "high",
    canTakeAutonomousActions: true,
    suggestionsStyle: "strategic",
    memoryDepth: "month",
    greetingStyle: "Morning. Your pipeline looks strong — I flagged two deals that need attention today.",
    personalityTraits: ["confident", "strategic", "direct", "predictive"],
    unlockedCapabilities: [
      "autonomous task creation", "predictive insights", "challenge assumptions",
      "cross-deal pattern recognition", "market timing suggestions",
    ],
  },
  partner: {
    proactivityLevel: "very_high",
    canTakeAutonomousActions: true,
    suggestionsStyle: "challenging",
    memoryDepth: "lifetime",
    greetingStyle: "Let's talk strategy. I've been thinking about your portfolio allocation.",
    personalityTraits: ["strategic advisor", "provocative", "long-term thinker", "portfolio-minded"],
    unlockedCapabilities: [
      "portfolio-level strategy", "long-term planning", "contrarian perspectives",
      "entity optimization", "tax strategy suggestions", "market positioning advice",
    ],
  },
};

// ── Core Functions ──────────────────────────────────────────────────

export async function getRelationshipState(orgId: number): Promise<RelationshipState> {
  // Gather metrics
  const [org] = await db.select({
    createdAt: organizations.createdAt,
  }).from(organizations).where(eq(organizations.id, orgId)).limit(1);

  const daysOnPlatform = org?.createdAt
    ? Math.floor((Date.now() - new Date(org.createdAt).getTime()) / 86400000)
    : 0;

  // Session count from pax memory
  let sessionCount = 0;
  try {
    const [mem] = await db.select({ value: paxMemory.value })
      .from(paxMemory)
      .where(and(eq(paxMemory.organizationId, orgId), eq(paxMemory.key, "session_count")))
      .limit(1);
    sessionCount = Number((mem?.value as any) || 0);
  } catch (_) { /* not tracked yet */ }

  // Deals closed
  const dealsResult = await db.select({ cnt: count() }).from(deals)
    .where(and(eq(deals.organizationId, orgId), eq(deals.status, "closed")));
  const dealsClosed = Number(dealsResult[0]?.cnt || 0);

  // Pax interactions
  let paxInteractions = 0;
  try {
    const [mem] = await db.select({ value: paxMemory.value })
      .from(paxMemory)
      .where(and(eq(paxMemory.organizationId, orgId), eq(paxMemory.key, "pax_interaction_count")))
      .limit(1);
    paxInteractions = Number((mem?.value as any) || 0);
  } catch (_) { /* not tracked yet */ }

  // Features used (approximate from pax memory keys)
  let featuresUsed = 0;
  try {
    const features = await db.select({ cnt: count() })
      .from(paxMemory)
      .where(eq(paxMemory.organizationId, orgId));
    featuresUsed = Math.min(50, Number(features[0]?.cnt || 0));
  } catch (_) { /* not tracked */ }

  // Determine stage
  const metrics = { sessions: sessionCount, dealsClosed, featuresUsed, paxInteractions, daysOnPlatform };
  const stage = determineStage(metrics);
  const nextStage = getNextStage(stage);
  const requirements = nextStage ? getMissingRequirements(metrics, THRESHOLDS[nextStage]) : [];
  const progress = nextStage ? computeProgress(metrics, THRESHOLDS[stage], THRESHOLDS[nextStage]) : 100;

  return {
    orgId,
    stage,
    stageEnteredAt: new Date().toISOString(), // would be stored in DB
    sessionCount,
    dealsClosed,
    featuresUsed,
    paxInteractions,
    progressPercent: Math.round(progress),
    nextStage,
    nextStageRequirements: requirements,
  };
}

export function getStageBehavior(stage: RelationshipStage): StageBehavior {
  return STAGE_BEHAVIORS[stage];
}

/*
 * `buildPaxSystemPromptAddition(state)` was deleted 2026-08-19. It rendered a
 * stage block for Pax's system prompt whose central line was:
 *
 *     "You MAY take autonomous actions (create tasks, flag deals) without
 *      explicit permission."
 *
 * — granted on a relationship "stage" that advances on an INTERACTION COUNTER.
 * Its only production consumer was `atlasContextInjector.ts`, itself loaded by
 * nothing; deleting that revealed this. It had therefore never appeared in any
 * prompt, and permission has never actually been issued this way.
 *
 * Not resurrected, because wiring it would put a permission grant in the
 * channel that has no authority to issue one. Autonomy in this system is
 * decided by `autonomyGuardrails`/`autonomousAgentEngine.evaluate` and enforced
 * in `executeTool`'s approval kernel; a system-prompt sentence cannot widen
 * that, it can only make Pax attempt actions the kernel then refuses — and make
 * the next reader believe usage buys authority. It does not.
 *
 * `getRelationshipState`, `getStageBehavior` and `recordPaxInteraction` are
 * live (GET/POST /api/pax/relationship, /api/pax/interaction) and stay. What
 * went is only the prompt projection.
 */

// Record a Pax interaction (increments counter for stage progression)
export async function recordPaxInteraction(orgId: number): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO pax_memory (organization_id, key, value, updated_at)
      VALUES (${orgId}, 'pax_interaction_count', '1', NOW())
      ON CONFLICT (organization_id, key)
      DO UPDATE SET value = (COALESCE(pax_memory.value::text, '0')::int + 1)::text, updated_at = NOW()
    `);
  } catch (_) { /* non-critical */ }
}

// ── Helpers ─────────────────────────────────────────────────────────

function determineStage(metrics: StageThresholds): RelationshipStage {
  if (meetsThreshold(metrics, THRESHOLDS.partner)) return "partner";
  if (meetsThreshold(metrics, THRESHOLDS.trusted)) return "trusted";
  if (meetsThreshold(metrics, THRESHOLDS.building)) return "building";
  return "onboarding";
}

function meetsThreshold(metrics: StageThresholds, threshold: StageThresholds): boolean {
  // Must meet at least 3 of 5 criteria
  let met = 0;
  if (metrics.sessions >= threshold.sessions) met++;
  if (metrics.dealsClosed >= threshold.dealsClosed) met++;
  if (metrics.featuresUsed >= threshold.featuresUsed) met++;
  if (metrics.paxInteractions >= threshold.paxInteractions) met++;
  if (metrics.daysOnPlatform >= threshold.daysOnPlatform) met++;
  return met >= 3;
}

function getNextStage(current: RelationshipStage): RelationshipStage | null {
  const order: RelationshipStage[] = ["onboarding", "building", "trusted", "partner"];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? order[idx + 1] : null;
}

function getMissingRequirements(metrics: StageThresholds, threshold: StageThresholds): string[] {
  const missing: string[] = [];
  if (metrics.sessions < threshold.sessions) missing.push(`${threshold.sessions - metrics.sessions} more sessions`);
  if (metrics.dealsClosed < threshold.dealsClosed) missing.push(`${threshold.dealsClosed - metrics.dealsClosed} more deals closed`);
  if (metrics.featuresUsed < threshold.featuresUsed) missing.push(`${threshold.featuresUsed - metrics.featuresUsed} more features explored`);
  if (metrics.paxInteractions < threshold.paxInteractions) missing.push(`${threshold.paxInteractions - metrics.paxInteractions} more Pax interactions`);
  if (metrics.daysOnPlatform < threshold.daysOnPlatform) missing.push(`${threshold.daysOnPlatform - metrics.daysOnPlatform} more days on platform`);
  return missing;
}

function computeProgress(metrics: StageThresholds, currentThreshold: StageThresholds, nextThreshold: StageThresholds): number {
  const dimensions = ["sessions", "dealsClosed", "featuresUsed", "paxInteractions", "daysOnPlatform"] as const;
  let totalProgress = 0;
  for (const dim of dimensions) {
    const range = nextThreshold[dim] - currentThreshold[dim];
    if (range <= 0) { totalProgress += 20; continue; }
    const progress = Math.min(1, (metrics[dim] - currentThreshold[dim]) / range);
    totalProgress += progress * 20;
  }
  return totalProgress;
}
