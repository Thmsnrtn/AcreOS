// @ts-nocheck
/**
 * Adaptive CEO Command Surface — Sovereign Company Protocol v10
 *
 * The dashboard stops being static pages. It becomes context-aware:
 * - Morning: Shows briefing, overnight actions, approval queue
 * - Crisis: Surfaces war room, relevant agents, real-time metrics
 * - Deep work: Minimizes interruptions, batches approvals
 * - End of week: Performance reviews, weekly chronicle, delegation progress
 * - Returning: What happened, what was auto-decided, what's waiting
 *
 * One intelligent surface with layers — not 27 separate components.
 */

import { db } from "../db";
import {
  dashboardContextStates, agentInitiatives, ceoBriefings,
  orgHeartbeatSnapshots,
  type DashboardContextState,
} from "@shared/schema";
import { eq, desc, gte, and, count, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";

// ─── Surface Layers ────────────────────────────────────────────────────────

export const SURFACE_LAYERS = {
  // Morning layers
  morning_briefing: "Morning CEO Briefing",
  overnight_actions: "Overnight Agent Actions",
  approval_queue: "Pending Approvals",

  // Always-available layers
  health_grade: "Organization Health Grade",
  active_goals: "Active Strategic Goals",
  agent_grid: "Agent Status Grid",

  // Crisis layers
  war_room: "War Room",
  crisis_metrics: "Real-Time Crisis Metrics",
  agent_focus: "Relevant Agent Deep-Dive",

  // Deep work layers
  batched_approvals: "Batched Low-Priority Approvals",
  minimal_alerts: "Critical-Only Alerts",

  // End of week layers
  performance_reviews: "Weekly Performance Reviews",
  weekly_chronicle: "Company Chronicle",
  delegation_progress: "Goal Delegation Progress",
  learning_digest: "Weekly Learning Digest",

  // Returning layers
  absence_summary: "While You Were Away Summary",
  auto_decisions: "Auto-Decided Items",
  waiting_queue: "Items Waiting For You",

  // v10 special layers
  scenario_results: "Recent Scenario Simulations",
  calibration_events: "Agent Self-Calibrations",
  decision_quality: "Decision Quality Trend",
  resilience_status: "System Resilience Score",
  nervous_system: "Live Nervous System Feed",
  learning_velocity: "Learning Velocity Chart",
} as const;

export type SurfaceLayer = keyof typeof SURFACE_LAYERS;

// ─── Context Mode Definitions ──────────────────────────────────────────────

const CONTEXT_MODE_CONFIGS: Record<string, {
  activeLayers: SurfaceLayer[];
  suppressedLayers: SurfaceLayer[];
}> = {
  morning: {
    activeLayers: [
      "morning_briefing", "overnight_actions", "approval_queue",
      "health_grade", "active_goals", "agent_grid",
    ],
    suppressedLayers: [
      "war_room", "crisis_metrics", "performance_reviews", "weekly_chronicle",
    ],
  },
  crisis: {
    activeLayers: [
      "war_room", "crisis_metrics", "agent_focus", "health_grade",
      "approval_queue", "nervous_system",
    ],
    suppressedLayers: [
      "morning_briefing", "weekly_chronicle", "delegation_progress",
      "learning_digest", "scenario_results",
    ],
  },
  deep_work: {
    activeLayers: [
      "minimal_alerts", "batched_approvals", "health_grade",
    ],
    suppressedLayers: [
      "morning_briefing", "overnight_actions", "war_room",
      "performance_reviews", "nervous_system", "learning_velocity",
    ],
  },
  end_of_week: {
    activeLayers: [
      "performance_reviews", "weekly_chronicle", "delegation_progress",
      "learning_digest", "decision_quality", "health_grade",
      "resilience_status", "learning_velocity",
    ],
    suppressedLayers: [
      "morning_briefing", "overnight_actions", "war_room",
      "crisis_metrics",
    ],
  },
  returning: {
    activeLayers: [
      "absence_summary", "auto_decisions", "waiting_queue",
      "health_grade", "approval_queue", "active_goals",
    ],
    suppressedLayers: [
      "morning_briefing", "deep_work", "end_of_week",
    ],
  },
  default: {
    activeLayers: [
      "health_grade", "active_goals", "agent_grid", "approval_queue",
      "nervous_system", "learning_velocity", "resilience_status",
      "calibration_events", "decision_quality",
    ],
    suppressedLayers: [],
  },
};

// ─── Service ───────────────────────────────────────────────────────────────

class AdaptiveSurfaceService {

  /**
   * Detect the current context and return the appropriate surface configuration.
   */
  async detectContext(): Promise<DashboardContextState> {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay(); // 0 = Sunday

    // Check for active crisis
    const [latestHeartbeat] = await db.select().from(orgHeartbeatSnapshots)
      .orderBy(desc(orgHeartbeatSnapshots.createdAt))
      .limit(1);

    const isCrisis = latestHeartbeat?.healthGrade === "F" ||
      latestHeartbeat?.healthGrade === "D" ||
      (latestHeartbeat?.anomalies as any[] || []).some((a: any) => a.severity === "critical");

    // Check for pending approvals piling up (returning from absence?)
    const pendingCount = await db.select({ count: count() }).from(agentInitiatives)
      .where(eq(agentInitiatives.status, "pending_approval"));
    const pending = Number(pendingCount[0]?.count || 0);
    const isReturning = pending > 15; // lots of stuff piled up

    // Determine context mode
    let contextMode: string;
    let triggerReason: string;

    if (isCrisis) {
      contextMode = "crisis";
      triggerReason = `System health at grade ${latestHeartbeat?.healthGrade} with critical anomalies`;
    } else if (isReturning) {
      contextMode = "returning";
      triggerReason = `${pending} pending approvals detected — likely returning from absence`;
    } else if (hour >= 6 && hour <= 9) {
      contextMode = "morning";
      triggerReason = `Morning hours (${hour}:00) — showing daily briefing`;
    } else if (dayOfWeek === 5 && hour >= 14) {
      contextMode = "end_of_week";
      triggerReason = "Friday afternoon — showing weekly summary";
    } else if (hour >= 10 && hour <= 16) {
      contextMode = "deep_work";
      triggerReason = `Core working hours (${hour}:00) — minimizing interruptions`;
    } else {
      contextMode = "default";
      triggerReason = "Standard operating context";
    }

    // Deactivate previous context
    await db.update(dashboardContextStates)
      .set({ isCurrent: false, activeUntil: now })
      .where(eq(dashboardContextStates.isCurrent, true));

    // Create new context state
    const config = CONTEXT_MODE_CONFIGS[contextMode] || CONTEXT_MODE_CONFIGS.default;

    const [state] = await db.insert(dashboardContextStates).values({
      contextMode,
      activeLayers: config.activeLayers,
      suppressedLayers: config.suppressedLayers,
      triggerReason,
      triggerData: {
        hour,
        dayOfWeek,
        pendingApprovals: pending,
        healthGrade: latestHeartbeat?.healthGrade || "unknown",
        anomalyCount: (latestHeartbeat?.anomalies as any[] || []).length,
      },
      isCurrent: true,
    }).returning();

    return state;
  }

  /**
   * Get the current active surface state.
   */
  async getCurrent(): Promise<DashboardContextState | null> {
    const [state] = await db.select().from(dashboardContextStates)
      .where(eq(dashboardContextStates.isCurrent, true))
      .orderBy(desc(dashboardContextStates.createdAt))
      .limit(1);
    return state || null;
  }

  /**
   * Force a specific context mode (CEO override).
   */
  async forceMode(mode: string, reason?: string): Promise<DashboardContextState> {
    const config = CONTEXT_MODE_CONFIGS[mode] || CONTEXT_MODE_CONFIGS.default;

    // Deactivate previous
    await db.update(dashboardContextStates)
      .set({ isCurrent: false, activeUntil: new Date() })
      .where(eq(dashboardContextStates.isCurrent, true));

    const [state] = await db.insert(dashboardContextStates).values({
      contextMode: mode,
      activeLayers: config.activeLayers,
      suppressedLayers: config.suppressedLayers,
      triggerReason: reason || `CEO forced mode: ${mode}`,
      triggerData: { forced: true },
      isCurrent: true,
    }).returning();

    return state;
  }

  /**
   * Get context history.
   */
  async getHistory(limit = 30): Promise<DashboardContextState[]> {
    return db.select().from(dashboardContextStates)
      .orderBy(desc(dashboardContextStates.createdAt))
      .limit(limit);
  }

  /**
   * Get available surface layers with descriptions.
   */
  getAvailableLayers(): Record<string, string> {
    return { ...SURFACE_LAYERS };
  }

  /**
   * Get available context modes.
   */
  getAvailableModes(): string[] {
    return Object.keys(CONTEXT_MODE_CONFIGS);
  }
}

export const adaptiveSurfaceService = new AdaptiveSurfaceService();
