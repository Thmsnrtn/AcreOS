/**
 * Pillar R — Trust graduation per (agent, action_category).
 *
 * Pure functions + thin DB wrappers. The autonomous decision executor
 * calls `shouldAutoExecute(agent, category)` before each proposal; the
 * graduation tier short-circuits the existing confidence-threshold gate.
 *
 * THE LAW: auto-promotion stops at notify-only; silent execution requires
 * the founder's explicit override; demotion is always automatic.
 *
 * Promotion rules (consecutive same-tier acceptances):
 *   manual       → notify_only after 10
 *   notify_only  → (ceiling — never auto-promotes; at 50 consecutive
 *                  acceptances the pair is logged as silent-ELIGIBLE, and
 *                  only the founder's force_silent override grants silent)
 *
 * Demotion rules (tighten-only automation — always allowed):
 *   silent       → notify_only on first retract
 *   notify_only  → manual on first retract
 *   manual       → suspended after 3 consecutive retracts
 *
 * Founder overrides win over the auto-rules — `force_silent` is the ONLY
 * path to silent (Sovereign Principle 10: no agent may unilaterally expand
 * its own authority); `freeze_manual` pins to manual regardless of
 * acceptance streak.
 */

import { db } from "../db";
import { agentActionGraduations, type AgentActionGraduation } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";

export type GraduationTier = "manual" | "notify_only" | "silent" | "suspended";

export interface AutoExecuteDecision {
  tier: GraduationTier;
  autoExecute: boolean;
  notify: boolean;
  reason: string;
}

// Auto-promotion CEILING: notify_only's next tier is null on purpose.
// "silent" is reachable ONLY via overrideTier(force_silent) — the founder's
// explicit tap. Automation may loosen supervision to notify-only at most.
export const PROMOTE_THRESHOLDS: Record<Exclude<GraduationTier, "suspended">, GraduationTier | null> = {
  manual: "notify_only",
  notify_only: null,
  silent: null,
};
const PROMOTE_AT: Record<string, number> = {
  manual: 10,
  notify_only: 50,
};
const SUSPENSION_THRESHOLD = 3; // consecutive retracts at manual

async function readOrCreate(
  agentCodename: string,
  actionCategory: string,
): Promise<AgentActionGraduation> {
  const [existing] = await db
    .select()
    .from(agentActionGraduations)
    .where(
      and(
        eq(agentActionGraduations.agentCodename, agentCodename),
        eq(agentActionGraduations.actionCategory, actionCategory),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(agentActionGraduations)
    .values({ agentCodename, actionCategory })
    .returning();
  return created;
}

/**
 * Called by the autonomous decision executor before each proposal.
 * Tells the caller whether to auto-execute and whether to notify the
 * founder afterward.
 */
export async function shouldAutoExecute(
  agentCodename: string,
  actionCategory: string,
): Promise<AutoExecuteDecision> {
  const grad = await readOrCreate(agentCodename, actionCategory);
  switch (grad.graduationTier as GraduationTier) {
    case "manual":
      return { tier: "manual", autoExecute: false, notify: true, reason: "Tier=manual — founder approval required." };
    case "notify_only":
      return { tier: "notify_only", autoExecute: true, notify: true, reason: `Tier=notify_only (${grad.consecutiveAccepted} consecutive accepted).` };
    case "silent":
      return { tier: "silent", autoExecute: true, notify: false, reason: `Tier=silent (${grad.totalAccepted} total accepted).` };
    case "suspended":
      return { tier: "suspended", autoExecute: false, notify: true, reason: "Tier=suspended — explicit founder re-enable required." };
    default:
      return { tier: "manual", autoExecute: false, notify: true, reason: "Unknown tier — defaulting to manual." };
  }
}

/**
 * Record a successful proposal — moves the counters and possibly
 * promotes the tier. Called when the proposal merges + observation
 * window closes clean.
 */
export async function recordAcceptance(
  agentCodename: string,
  actionCategory: string,
): Promise<{ tierChanged: boolean; newTier: GraduationTier }> {
  const grad = await readOrCreate(agentCodename, actionCategory);

  // Founder override pins tier — only update counters.
  if (grad.founderOverride === "freeze_manual") {
    await db
      .update(agentActionGraduations)
      .set({
        consecutiveAccepted: grad.consecutiveAccepted + 1,
        consecutiveRetracted: 0,
        totalAccepted: grad.totalAccepted + 1,
        updatedAt: new Date(),
      })
      .where(eq(agentActionGraduations.id, grad.id));
    return { tierChanged: false, newTier: grad.graduationTier as GraduationTier };
  }

  const tier = grad.graduationTier as GraduationTier;
  const consecutiveAfter = grad.consecutiveAccepted + 1;
  const promotionThreshold = PROMOTE_AT[tier as keyof typeof PROMOTE_AT];
  const nextTier = PROMOTE_THRESHOLDS[tier as keyof typeof PROMOTE_THRESHOLDS];

  let newTier: GraduationTier = tier;
  let tierChanged = false;
  if (promotionThreshold && nextTier && consecutiveAfter >= promotionThreshold) {
    newTier = nextTier;
    tierChanged = true;
    logger.info(`[trust-graduation] ${agentCodename}:${actionCategory} promoted ${tier} → ${nextTier} (${consecutiveAfter} consecutive accepted)`);
  } else if (promotionThreshold && !nextTier && consecutiveAfter >= promotionThreshold) {
    // Ceiling reached: the pair has EARNED silent eligibility, but auto-
    // promotion stops at notify-only (Sovereign Principle 10). Only the
    // founder's explicit force_silent override (overrideTier) grants silent.
    logger.info(`[trust-graduation] ${agentCodename}:${actionCategory} is silent-ELIGIBLE (${consecutiveAfter} consecutive accepted at ${tier}) — awaiting founder force_silent override; not auto-promoting`);
  }

  await db
    .update(agentActionGraduations)
    .set({
      consecutiveAccepted: tierChanged ? 0 : consecutiveAfter,
      consecutiveRetracted: 0,
      totalAccepted: grad.totalAccepted + 1,
      graduationTier: newTier,
      tierChangedAt: tierChanged ? new Date() : grad.tierChangedAt,
      updatedAt: new Date(),
    })
    .where(eq(agentActionGraduations.id, grad.id));

  return { tierChanged, newTier };
}

/**
 * Record a retract — demote the tier and reset the streak. The
 * cron in agentRetractObservations.ts calls this on regression.
 */
export async function recordRetract(
  agentCodename: string,
  actionCategory: string,
): Promise<{ tierChanged: boolean; newTier: GraduationTier; suspended: boolean }> {
  const grad = await readOrCreate(agentCodename, actionCategory);
  const tier = grad.graduationTier as GraduationTier;

  let newTier: GraduationTier = tier;
  let suspended = false;
  let tierChanged = false;

  if (tier === "silent") {
    newTier = "notify_only";
    tierChanged = true;
  } else if (tier === "notify_only") {
    newTier = "manual";
    tierChanged = true;
  } else if (tier === "manual" && grad.consecutiveRetracted + 1 >= SUSPENSION_THRESHOLD) {
    newTier = "suspended";
    tierChanged = true;
    suspended = true;
  }

  await db
    .update(agentActionGraduations)
    .set({
      consecutiveAccepted: 0,
      consecutiveRetracted: grad.consecutiveRetracted + 1,
      totalRetracted: grad.totalRetracted + 1,
      graduationTier: newTier,
      tierChangedAt: tierChanged ? new Date() : grad.tierChangedAt,
      updatedAt: new Date(),
    })
    .where(eq(agentActionGraduations.id, grad.id));

  logger.warn(`[trust-graduation] ${agentCodename}:${actionCategory} retract recorded; tier ${tier} → ${newTier}${suspended ? " (SUSPENDED)" : ""}`);
  return { tierChanged, newTier, suspended };
}

/**
 * Founder explicitly sets a tier (e.g. force_silent for a category
 * they've watched succeed many times outside the system).
 */
export async function overrideTier(
  agentCodename: string,
  actionCategory: string,
  tier: GraduationTier,
  override: "force_silent" | "freeze_manual" | null = null,
): Promise<void> {
  const grad = await readOrCreate(agentCodename, actionCategory);
  await db
    .update(agentActionGraduations)
    .set({
      graduationTier: tier,
      founderOverride: override,
      tierChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentActionGraduations.id, grad.id));
  logger.info(`[trust-graduation] founder set ${agentCodename}:${actionCategory} to ${tier}${override ? ` (override=${override})` : ""}`);
}

/**
 * One-shot re-collar: demote every pair sitting at "silent" WITHOUT the
 * founder's explicit force_silent override back to "notify_only". These
 * rows were auto-graduated by the old ladder (notify_only → silent at 50),
 * which violated Sovereign Principle 10 — silent execution must be a
 * founder grant, never an earned default. Counters are left untouched so
 * the streak evidence survives for a future eligibility surface.
 */
export async function reconcileSilentTiers(): Promise<{ demoted: number }> {
  const silentRows = await db
    .select()
    .from(agentActionGraduations)
    .where(eq(agentActionGraduations.graduationTier, "silent"));

  let demoted = 0;
  for (const row of silentRows) {
    if (row.founderOverride === "force_silent") continue; // founder-granted — stands
    await db
      .update(agentActionGraduations)
      .set({
        graduationTier: "notify_only",
        tierChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentActionGraduations.id, row.id));
    logger.info(`[trust-graduation] re-collar: ${row.agentCodename}:${row.actionCategory} demoted silent → notify_only (auto-graduated without founder force_silent; silent now requires explicit founder override)`);
    demoted += 1;
  }
  return { demoted };
}
