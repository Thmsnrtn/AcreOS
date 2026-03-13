import type { Deal } from "@shared/schema";
import { differenceInDays } from "date-fns";

export type DealNextAction = {
  action: string;
  priority: "low" | "medium" | "high";
  icon: "send" | "eye" | "phone" | "file" | "calendar" | "check" | "alert";
};

/**
 * Stage-specific guidance for land investors.
 * Each stage has a primary action that moves the deal forward.
 */
const stageActions: Record<string, DealNextAction> = {
  negotiating: {
    action: "Prepare offer",
    priority: "high",
    icon: "file",
  },
  offer_sent: {
    action: "Follow up",
    priority: "medium", 
    icon: "phone",
  },
  countered: {
    action: "Review counter",
    priority: "high",
    icon: "eye",
  },
  accepted: {
    action: "Order title",
    priority: "high",
    icon: "file",
  },
  in_escrow: {
    action: "Track closing",
    priority: "medium",
    icon: "calendar",
  },
  closed: {
    action: "Complete",
    priority: "low",
    icon: "check",
  },
  cancelled: {
    action: "Archived",
    priority: "low",
    icon: "check",
  },
};

/**
 * Returns the recommended next action for a deal based on its current stage.
 */
export function getDealNextAction(deal: Deal): DealNextAction {
  const baseAction = stageActions[deal.status] || stageActions.negotiating;
  return baseAction;
}

/**
 * Calculates how many days a deal has been in its current stage.
 * Uses updatedAt as a proxy for when the stage last changed.
 */
export function getDaysInStage(deal: Deal): number {
  if (!deal.updatedAt) return 0;
  const updatedDate = new Date(deal.updatedAt);
  return differenceInDays(new Date(), updatedDate);
}

/**
 * Thresholds for staleness warnings by stage (in days).
 * Deals in active stages should move faster than later stages.
 */
const stalenessThresholds: Record<string, number> = {
  negotiating: 7,
  offer_sent: 5,
  countered: 3,
  accepted: 5,
  in_escrow: 14,
  closed: Infinity,
  cancelled: Infinity,
};

/**
 * Determines if a deal is considered "stale" based on time in current stage.
 */
export function isDealStale(deal: Deal): boolean {
  const daysInStage = getDaysInStage(deal);
  const threshold = stalenessThresholds[deal.status] || 7;
  return daysInStage >= threshold;
}

/**
 * Returns urgency level based on staleness.
 * "warning" = approaching stale, "urgent" = past threshold
 */
export function getDealUrgency(deal: Deal): "normal" | "warning" | "urgent" {
  const daysInStage = getDaysInStage(deal);
  const threshold = stalenessThresholds[deal.status] || 7;
  
  if (deal.status === "closed" || deal.status === "cancelled") {
    return "normal";
  }
  
  if (daysInStage >= threshold) {
    return "urgent";
  }
  
  if (daysInStage >= threshold * 0.7) {
    return "warning";
  }
  
  return "normal";
}
