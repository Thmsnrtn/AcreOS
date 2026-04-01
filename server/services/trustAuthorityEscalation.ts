/**
 * Trust-Based Authority Escalation
 *
 * Closes the gap where trust score increases are decorative.
 * When trust evolution detects a threshold crossing, this service
 * ACTUALLY unlocks new capabilities for the agent:
 *
 * Trust 0-59:  Level 0 — Can only recommend, all actions escalate to founder
 * Trust 60-74: Level 1 — Auto-execute low-risk actions (follow-ups, reports, alerts)
 * Trust 75-89: Level 2 — Auto-execute medium actions (task creation, status changes, lead updates)
 * Trust 90+:   Level 3 — Auto-execute high-value actions (deal advancement, financial flags)
 *
 * When trust crosses a threshold, this service:
 * 1. Updates the agent's authority configuration
 * 2. Publishes a trust:threshold_crossed event (triggers reaction chain)
 * 3. Broadcasts to WebSocket for real-time visibility
 * 4. Records in cognitive memory so the agent "knows" its new abilities
 */

import { db } from "../db";
import { agentEvents } from "@shared/schema";
import { wsServer } from "../websocket";
import { logger } from "../utils/logger";

// ─── Authority Tier Definitions ──────────────────────────────────────────────

const AUTHORITY_TIERS: Record<number, { level: number; label: string; allowedActions: string[] }> = {
  0: {
    level: 0,
    label: "Observer — Recommend Only",
    allowedActions: ["generate_report", "store_learning"],
  },
  60: {
    level: 1,
    label: "Assistant — Low-Risk Autonomy",
    allowedActions: [
      "generate_report", "store_learning", "send_alert", "send_follow_up",
      "create_task", "complete_task",
    ],
  },
  75: {
    level: 2,
    label: "Operator — Medium Autonomy",
    allowedActions: [
      "generate_report", "store_learning", "send_alert", "send_follow_up",
      "create_task", "complete_task", "update_lead_status", "send_churn_intervention",
      "restart_failed_job",
    ],
  },
  90: {
    level: 3,
    label: "Director — Full Autonomy",
    allowedActions: [
      "generate_report", "store_learning", "send_alert", "send_follow_up",
      "create_task", "complete_task", "update_lead_status", "send_churn_intervention",
      "restart_failed_job", "advance_deal_stage", "flag_deal_risk",
      "activate_degradation_mode", "deactivate_degradation_mode",
    ],
  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

class TrustAuthorityEscalation {
  /**
   * Get the authority tier for a given trust score.
   */
  getTier(trustScore: number): { level: number; label: string; allowedActions: string[] } {
    if (trustScore >= 90) return AUTHORITY_TIERS[90];
    if (trustScore >= 75) return AUTHORITY_TIERS[75];
    if (trustScore >= 60) return AUTHORITY_TIERS[60];
    return AUTHORITY_TIERS[0];
  }

  /**
   * Check if an agent is allowed to perform an action based on their trust score.
   */
  isActionAllowed(trustScore: number, action: string): boolean {
    const tier = this.getTier(trustScore);
    return tier.allowedActions.includes(action);
  }

  /**
   * Called by trust evolution when a threshold is crossed.
   * Actually unlocks the new authority level.
   */
  async onThresholdCrossed(
    agentCodename: string,
    oldScore: number,
    newScore: number,
  ): Promise<void> {
    const oldTier = this.getTier(oldScore);
    const newTier = this.getTier(newScore);

    // Only act on promotions (upward crossings)
    if (newTier.level <= oldTier.level) return;

    const newActions = newTier.allowedActions.filter(
      (a) => !oldTier.allowedActions.includes(a),
    );

    logger.info(`[trust-authority] ${agentCodename} promoted: Level ${oldTier.level} → ${newTier.level} (${oldScore} → ${newScore}). Unlocked: ${newActions.join(", ")}`);

    // 1. Record the promotion event
    await db.insert(agentEvents).values({
      agentCodename,
      eventType: "authority_promotion",
      payload: {
        oldLevel: oldTier.level,
        newLevel: newTier.level,
        oldScore,
        newScore,
        newLabel: newTier.label,
        unlockedActions: newActions,
        promotedAt: new Date().toISOString(),
      },
    });

    // 2. Publish to event mesh (triggers "Agent Trust Promotion → Unlock Authority" chain)
    try {
      const { eventMeshPublisher } = await import("./eventMeshPublisher");
      await eventMeshPublisher.publish(
        "trust:lifecycle",
        "trust:threshold_crossed",
        {
          agent: agentCodename,
          oldLevel: oldTier.level,
          newLevel: newTier.level,
          newLabel: newTier.label,
          unlockedActions: newActions,
        },
        { publisher: "trust-evolution", priority: 3 },
      );
    } catch {}

    // 3. Broadcast to WebSocket for real-time founder visibility
    wsServer.broadcastFounderEvent("trust_promotion", {
      agent: agentCodename,
      oldLevel: oldTier.level,
      newLevel: newTier.level,
      label: newTier.label,
      unlockedActions: newActions,
    });

    // 4. Store in cognitive memory so agent "knows" its new abilities
    try {
      const { cognitiveMemoryService } = await import("./cognitiveMemoryV13");
      await cognitiveMemoryService.store({
        type: "semantic",
        agent: agentCodename,
        content: `Promoted to ${newTier.label} (Level ${newTier.level}). New abilities: ${newActions.join(", ")}`,
        tags: ["authority", "promotion", `level_${newTier.level}`],
        strength: 1.0,
      });
    } catch {}
  }
}

export const trustAuthorityEscalation = new TrustAuthorityEscalation();
