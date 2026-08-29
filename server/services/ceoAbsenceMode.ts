/**
 * CEO Absence Mode — Sovereign Company Protocol v6
 *
 * "I'm away for 3 days." Everything changes:
 * - Agent trust scores temporarily boosted (they can do more autonomously)
 * - Non-urgent decisions batched (no notification spam)
 * - Only true emergencies break through
 * - When CEO returns: comprehensive summary of everything that happened
 *
 * This is the ultimate test of the self-running company.
 * If your AI team can't run things for 3 days, the system isn't ready.
 */

import { db } from "../db";
import { ceoAbsenceMode, companyAgents, agentActionLog, decisionsInboxItems, warRooms } from "@shared/schema";
import { eq, desc, gte, and, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { logger } from "../utils/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AbsenceConfig {
  durationHours: number;
  trustBoost?: number;       // default 15
  emergencyOnly?: boolean;   // only break through for critical
  smartBoost?: boolean;      // default true — per-agent trust boosting based on performance
}

interface AbsenceSuggestion {
  safe: boolean;
  confidence: number;
  reason: string;
  suggestedDuration: number;
  blockers: string[];
}

interface SafetyReport {
  safetyScore: number;
  emergencies: number;
  batchedByPriority: Record<string, number>;
  hoursRemaining: number;
  recommendation: string;
}

interface BatchedItem {
  type: string;
  summary: string;
  agentCodename: string;
  priority: string;
  timestamp: string;
  data?: any;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class CEOAbsenceService {

  /** Activate absence mode */
  async activate(config: AbsenceConfig): Promise<number> {
    // Deactivate any existing absence mode
    await this.deactivate();

    const endsAt = new Date(Date.now() + config.durationHours * 60 * 60 * 1000);
    const trustBoost = config.trustBoost || 15;
    const useSmartBoost = config.smartBoost !== false;

    let perAgentBoosts: Record<string, number> = {};

    // ⚠ BEFORE WIRING THIS: the grant is MATERIALISED INTO THE AUTHORITY FIELD.
    //
    // The boost is applied by mutating each agent's permanent `trustScore`
    // (below), and `agentAuthorityGate` promotes an action's level from that
    // same score. So a time-boxed grant is written into the field the gate
    // reads, and the only thing that takes it back is `deactivate()` — which
    // nothing calls. Two further consequences: two activations STACK, and a
    // reversal subtracts a fixed delta from a score outcome-learning may have
    // moved in between, so it does not restore the original.
    //
    // The correct shape is to leave the score alone and have the gate ADD the
    // active grant at check time, so expiry needs no cleanup. That refactor is
    // deliberately not done here: this path has no production caller, and
    // rebuilding an unreachable authority mechanism is how speculative
    // machinery gets built. `getCurrent()` now expires on `endsAt`, so a wired
    // caller at least cannot leave absence mode on forever.
    if (useSmartBoost) {
      // Smart trust boosting — per-agent scoring based on recent performance
      perAgentBoosts = await this.calculateSmartTrustBoosts(trustBoost);
    } else {
      // Uniform trust boost for all agents
      const agents = await companyAgentService.getAll();
      for (const agent of agents) {
        perAgentBoosts[agent.codename] = trustBoost;
      }
    }

    const [absence] = await db.insert(ceoAbsenceMode).values({
      isActive: true,
      startedAt: new Date(),
      endsAt,
      trustBoost,
      batchedItems: [],
      emergencyBreaks: [],
      perAgentBoosts,
    } as any).returning({ id: ceoAbsenceMode.id });

    // The boosts are NOT written to companyAgents.trustScore.
    //
    // They used to be, and that made a time-boxed grant permanent by
    // construction. `getCurrent()` returns null once `endsAt` has passed, so
    // `deactivate()` — which is the only thing that subtracts the boost — could
    // never run after natural expiry: the absence ended and the authority it
    // conveyed stayed. Worse, `activate()` begins by calling `deactivate()`, so
    // a second activation after an expired first one added a boost on top of one
    // that was never taken away. Three "I'm away" commands walked an agent from
    // Observer (50) through Assistant and Operator to Director (95), unlocking
    // real customer contact, with no way back. `updateTrustScore` also clamps at
    // 100, so even a reversal that DID run returned less than it took.
    //
    // The boost is now DERIVED at the point of authority instead — see
    // `activeTrustBoosts()` below and `effectiveTrustScore()` in companyAgents.
    // Expiry then needs no reversal to work, which is the only kind of expiry
    // worth having.
    return absence.id;
  }

  /**
   * The trust boosts an ACTIVE, UNEXPIRED absence currently confers.
   *
   * The single source of the elevation. Returns `{}` when no absence is running,
   * which is what makes expiry automatic: `getCurrent()` already refuses an
   * absence whose `endsAt` has passed, so the boost disappears at the same
   * moment the absence does, with nothing to remember to run.
   *
   * Fails to `{}` on any error. An elevation that cannot be read is not an
   * elevation that applies — the same rule the execution engine's safety gates
   * use for a check that cannot run.
   */
  async activeTrustBoosts(): Promise<Record<string, number>> {
    try {
      // `getCurrent()` is typed `any` (it predates this method); narrow to the
      // two fields actually read rather than casting at each use, so a rename
      // on the row is a type error here instead of a silent `undefined`.
      const current: {
        perAgentBoosts?: Record<string, number> | null;
        trustBoost?: number | null;
      } | null = await this.getCurrent();
      if (!current) return {};
      const per = current.perAgentBoosts;
      if (per && Object.keys(per).length > 0) return per;
      const uniform = current.trustBoost ?? 15;
      const agents: Array<{ codename: string }> = await companyAgentService.getAll();
      return Object.fromEntries(agents.map((a) => [a.codename, uniform]));
    } catch {
      return {};
    }
  }

  /** Deactivate absence mode and generate return briefing */
  async deactivate(): Promise<string | null> {
    const current = await this.getCurrent();
    if (!current) return null;

    // Nothing to restore. The boost was never written to the agent row, so
    // marking this absence inactive is the whole reversal — the same code path
    // that natural expiry takes, rather than a second one that has to be
    // remembered.

    // Generate return briefing
    const briefing = await this.generateReturnBriefing(current);

    await db.update(ceoAbsenceMode)
      .set({
        isActive: false,
        returnBriefing: briefing,
        updatedAt: new Date(),
      })
      .where(eq(ceoAbsenceMode.id, current.id));

    return briefing;
  }

  /** Check if absence mode is currently active */
  async isActive(): Promise<boolean> {
    const current = await this.getCurrent();
    if (!current) return false;

    // Auto-deactivate if past end time
    if (current.endsAt && new Date() > new Date(current.endsAt)) {
      await this.deactivate();
      return false;
    }

    return true;
  }

  /** Get current absence mode record */
  async getCurrent(): Promise<any | null> {
    // A TIME-BOXED GRANT MUST EXPIRE BY CONSTRUCTION.
    //
    // This selected on `isActive` alone. `endsAt` was written at activation and
    // then consulted by nobody: no job calls `deactivate()`, no route does, and
    // this read ignored it — so absence mode, once switched on, was active
    // forever and the elevated authority it conveys had no end. An expiry
    // enforced only by somebody remembering to revoke it is not an expiry.
    //
    // NOT CURRENTLY LIVE, and that is why this is the whole fix rather than a
    // refactor: `activate()` has no production caller (the only consumer,
    // founderWellbeing, calls `getLatest()` to read history). See the warning
    // on `activate` before wiring it.
    const row = await db.query.ceoAbsenceMode.findFirst({
      where: eq(ceoAbsenceMode.isActive, true),
      orderBy: [desc(ceoAbsenceMode.createdAt)],
    });
    if (!row) return null;
    if (row.endsAt && new Date(row.endsAt).getTime() <= Date.now()) return null;
    return row;
  }

  /** Get the most recent absence record (active or not) */
  async getLatest(): Promise<any | null> {
    return db.query.ceoAbsenceMode.findFirst({
      orderBy: [desc(ceoAbsenceMode.createdAt)],
    });
  }

  /** Batch a non-urgent item for when the CEO returns */
  async batchItem(item: BatchedItem): Promise<void> {
    const current = await this.getCurrent();
    if (!current) return;

    const batchedItems = [...((current.batchedItems as BatchedItem[]) || []), item];

    await db.update(ceoAbsenceMode)
      .set({ batchedItems, updatedAt: new Date() })
      .where(eq(ceoAbsenceMode.id, current.id));
  }

  /** Record an emergency break (something so critical it had to interrupt) */
  async recordEmergencyBreak(agentCodename: string, reason: string, actionTaken: string): Promise<void> {
    const current = await this.getCurrent();
    if (!current) return;

    const emergencyBreaks = [...((current.emergencyBreaks as any[]) || []), {
      agentCodename,
      reason,
      timestamp: new Date().toISOString(),
      actionTaken,
    }];

    await db.update(ceoAbsenceMode)
      .set({ emergencyBreaks, updatedAt: new Date() })
      .where(eq(ceoAbsenceMode.id, current.id));
  }

  /** Should a notification break through absence mode? */
  shouldBreakThrough(priority: string, severity: string): boolean {
    // Only critical/emergency items break through
    return priority === "critical" || severity === "critical";
  }

  /** Calculate smart per-agent trust boosts based on recent performance */
  async calculateSmartTrustBoosts(configBoost: number = 15): Promise<Record<string, number>> {
    const agents = await companyAgentService.getAll();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const boosts: Record<string, number> = {};

    for (const agent of agents) {
      // Get recent action log entries for this agent
      const actions = await db.select({
        outcome: agentActionLog.outcome,
      })
        .from(agentActionLog)
        .where(
          and(
            eq(agentActionLog.agentCodename, agent.codename),
            gte(agentActionLog.createdAt, thirtyDaysAgo),
          )
        );

      if (actions.length === 0) {
        // No data — give the standard boost
        boosts[agent.codename] = configBoost;
        continue;
      }

      const successCount = actions.filter(a => a.outcome === "success").length;
      const successRate = (successCount / actions.length) * 100;

      if (successRate > 90) {
        // High performer — extra boost
        boosts[agent.codename] = configBoost + 10;
      } else if (successRate >= 70) {
        // Medium performer — standard boost
        boosts[agent.codename] = configBoost;
      } else {
        // Low performer — reduced boost, minimum 0
        boosts[agent.codename] = Math.max(0, configBoost - 10);
      }
    }

    return boosts;
  }

  /** Suggest whether it's safe to activate absence mode */
  async suggestAbsenceWindow(): Promise<AbsenceSuggestion> {
    const blockers: string[] = [];

    // Check pending critical decisions inbox items
    const pendingCritical = await db.select({ count: sql<number>`count(*)` })
      .from(decisionsInboxItems)
      .where(
        and(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.riskLevel, "critical"),
        )
      );
    const criticalCount = Number(pendingCritical[0]?.count ?? 0);

    if (criticalCount > 0) {
      blockers.push(`${criticalCount} critical decision(s) pending in inbox`);
    }

    // Check active war rooms
    const activeWarRooms = await db.select({ count: sql<number>`count(*)` })
      .from(warRooms)
      .where(eq(warRooms.status, "active"));
    const warRoomCount = Number(activeWarRooms[0]?.count ?? 0);

    if (warRoomCount > 0) {
      blockers.push(`${warRoomCount} active war room(s)`);
    }

    // Check overall agent success rate (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const allActions = await db.select({
      outcome: agentActionLog.outcome,
    })
      .from(agentActionLog)
      .where(gte(agentActionLog.createdAt, thirtyDaysAgo));

    const totalActions = allActions.length;
    const successActions = allActions.filter(a => a.outcome === "success").length;
    const successRate = totalActions > 0 ? (successActions / totalActions) * 100 : 0;

    // Decision logic
    if (criticalCount > 0 || warRoomCount > 0) {
      return {
        safe: false,
        confidence: 0.9,
        reason: `Cannot recommend absence: ${blockers.join("; ")}`,
        suggestedDuration: 0,
        blockers,
      };
    }

    if (successRate > 85) {
      return {
        safe: true,
        confidence: Math.min(0.95, successRate / 100),
        reason: `Agent success rate is strong at ${successRate.toFixed(1)}%. System is running well.`,
        suggestedDuration: 72,
        blockers,
      };
    }

    if (successRate >= 70) {
      return {
        safe: true,
        confidence: Math.min(0.75, successRate / 100),
        reason: `Agent success rate is moderate at ${successRate.toFixed(1)}%. Shorter absence recommended.`,
        suggestedDuration: 48,
        blockers,
      };
    }

    blockers.push(`Low agent success rate: ${successRate.toFixed(1)}%`);
    return {
      safe: false,
      confidence: 0.8,
      reason: `Agent success rate is too low at ${successRate.toFixed(1)}% for safe absence.`,
      suggestedDuration: 0,
      blockers,
    };
  }

  /** Generate a safety report during an active absence */
  async generateSafetyReport(): Promise<SafetyReport> {
    const current = await this.getCurrent();
    if (!current) {
      return {
        safetyScore: 0,
        emergencies: 0,
        batchedByPriority: {},
        hoursRemaining: 0,
        recommendation: "No active absence mode.",
      };
    }

    const batchedItems = (current.batchedItems as BatchedItem[]) || [];
    const emergencyBreaks = (current.emergencyBreaks as any[]) || [];

    // Count batched items by priority
    const batchedByPriority: Record<string, number> = {};
    for (const item of batchedItems) {
      const priority = item.priority || "unknown";
      batchedByPriority[priority] = (batchedByPriority[priority] || 0) + 1;
    }

    const emergencies = emergencyBreaks.length;
    const criticalBatched = batchedByPriority["critical"] || 0;

    // Safety score: 100 - 10*emergencies - 5*criticalBatched (clamped to 0-100)
    const safetyScore = Math.max(0, Math.min(100, 100 - 10 * emergencies - 5 * criticalBatched));

    // Calculate hours remaining
    const endsAt = current.endsAt ? new Date(current.endsAt).getTime() : Date.now();
    const hoursRemaining = Math.max(0, Math.round((endsAt - Date.now()) / (1000 * 60 * 60)));

    let recommendation: string;
    if (safetyScore >= 90) {
      recommendation = "System running smoothly. No intervention needed.";
    } else if (safetyScore >= 70) {
      recommendation = "Minor issues detected. Monitor when convenient.";
    } else if (safetyScore >= 50) {
      recommendation = "Several issues accumulating. Consider checking in early.";
    } else {
      recommendation = "Significant issues detected. Recommend ending absence early.";
    }

    return {
      safetyScore,
      emergencies,
      batchedByPriority,
      hoursRemaining,
      recommendation,
    };
  }

  /** Auto-extend absence if the system is running smoothly */
  async autoExtend(additionalHours: number): Promise<{ extended: boolean; reason: string; newEndsAt?: Date }> {
    const current = await this.getCurrent();
    if (!current) {
      return { extended: false, reason: "No active absence mode to extend." };
    }

    const report = await this.generateSafetyReport();

    if (report.safetyScore <= 80) {
      return {
        extended: false,
        reason: `Safety score too low (${report.safetyScore}/100). ${report.recommendation}`,
      };
    }

    const currentEndsAt = current.endsAt ? new Date(current.endsAt) : new Date();
    const newEndsAt = new Date(currentEndsAt.getTime() + additionalHours * 60 * 60 * 1000);

    await db.update(ceoAbsenceMode)
      .set({ endsAt: newEndsAt, updatedAt: new Date() })
      .where(eq(ceoAbsenceMode.id, current.id));

    return {
      extended: true,
      reason: `Safety score is ${report.safetyScore}/100. Extended absence by ${additionalHours} hours.`,
      newEndsAt,
    };
  }

  /** Generate the return briefing — everything that happened while CEO was away */
  private async generateReturnBriefing(absence: any): Promise<string> {
    const batchedItems = (absence.batchedItems as BatchedItem[]) || [];
    const emergencyBreaks = (absence.emergencyBreaks as any[]) || [];
    const startedAt = new Date(absence.startedAt);
    const hoursAway = Math.round((Date.now() - startedAt.getTime()) / (1000 * 60 * 60));

    // Get agent reports for the period
    const agents = await companyAgentService.getAll();
    const agentSummaries: string[] = [];
    for (const agent of agents.slice(0, 5)) { // Top 5 by trust
      try {
        const report = await companyAgentService.generateReport(agent.codename);
        agentSummaries.push(`${agent.title}: ${report.summary}`);
      } catch {}
    }

    try {
      const response = await routeAITask({
        taskType: "return_briefing",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are generating a "Welcome Back" briefing for a CEO who was away. Be concise, organized, and highlight what matters most. Use sections.`,
          },
          {
            role: "user",
            content: `Generate a return briefing for a CEO who was away for ${hoursAway} hours.

Emergencies that occurred (${emergencyBreaks.length}):
${emergencyBreaks.map(e => `- ${e.agentCodename}: ${e.reason} → ${e.actionTaken}`).join("\n") || "None — all clear."}

Batched items waiting for review (${batchedItems.length}):
${batchedItems.slice(0, 10).map(i => `- [${i.priority}] ${i.agentCodename}: ${i.summary}`).join("\n") || "None."}
${batchedItems.length > 10 ? `... and ${batchedItems.length - 10} more` : ""}

Agent status reports:
${agentSummaries.join("\n")}

Write a brief, scannable return briefing. Start with the most important thing. Use plain language.`,
          },
        ],
        maxTokens: 500,
        temperature: 0.3,
      });

      return response.content;
    } catch {
      return `Welcome back. You were away for ${hoursAway} hours. ${emergencyBreaks.length} emergencies handled. ${batchedItems.length} items batched for your review.`;
    }
  }

  // ─── Phase 20: Mission Mode Transition ──────────────────────────────────

  // transitionToMissionMode was DELETED 2026-08-28 (stage-4 turn 2): zero callers anywhere
  // in server/ or client/. The capability it claimed belongs to the incumbent
  // plane's governed paths.

}

export const ceoAbsenceService = new CEOAbsenceService();
