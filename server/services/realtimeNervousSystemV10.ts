// @ts-nocheck
/**
 * Real-Time Nervous System — Sovereign Company Protocol v10
 *
 * Wire every agent action through typed WebSocket events:
 * - agent.thinking — agent is running a thinking cycle
 * - agent.action.started — agent began executing
 * - agent.action.completed — result with metrics
 * - agent.escalation — something needs CEO attention NOW
 * - goal.progress — delegated goal progress tick
 * - kpi.shifted — an agent's action moved a KPI
 * - briefing.ready — morning briefing compiled
 * - system.heartbeat — organizational pulse every 60s
 *
 * The CEO dashboard becomes a living surface. You don't refresh — it breathes.
 */

import { db } from "../db";
import { realtimeEventLog, type RealtimeEvent } from "@shared/schema";
import { eq, desc, gte, and, count, sql } from "drizzle-orm";
import { wsServer } from "../websocket";
import { logger } from "../utils/logger";

// ─── Event Type Registry ───────────────────────────────────────────────────

export type NervousSystemEventType =
  | "agent.thinking"
  | "agent.action.started"
  | "agent.action.completed"
  | "agent.escalation"
  | "agent.calibrated"
  | "goal.progress"
  | "goal.completed"
  | "kpi.shifted"
  | "learning.propagated"
  | "briefing.ready"
  | "scenario.started"
  | "scenario.completed"
  | "resilience.tested"
  | "heartbeat.snapshot"
  | "system.heartbeat"
  | "system.anomaly"
  ;

interface NervousSystemEvent {
  type: NervousSystemEventType;
  agentCodename?: string;
  payload: Record<string, any>;
}

// ─── Service ───────────────────────────────────────────────────────────────

class RealtimeNervousSystemService {

  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Emit a nervous system event — broadcasts via WebSocket and logs to DB.
   */
  async emit(event: NervousSystemEvent): Promise<void> {
    const channel = "founder:activity";

    // Broadcast via WebSocket (non-blocking)
    try {
      wsServer.broadcast(channel, event.type, {
        ...event.payload,
        agentCodename: event.agentCodename,
        _ts: new Date().toISOString(),
      });
    } catch (err) {
      logger.error("[NervousSystem] WebSocket broadcast failed", err);
    }

    // Log to database (fire-and-forget for non-critical events)
    try {
      await db.insert(realtimeEventLog).values({
        eventType: event.type,
        agentCodename: event.agentCodename || null,
        channel,
        payload: event.payload,
      });
    } catch (err) {
      logger.error("[NervousSystem] Event log failed", err);
    }
  }

  // ─── Convenience emitters ─────────────────────────────────────────────

  async emitAgentThinking(agentCodename: string, context: string): Promise<void> {
    await this.emit({
      type: "agent.thinking",
      agentCodename,
      payload: { context, status: "thinking" },
    });
  }

  async emitAgentActionStarted(agentCodename: string, action: string, details?: Record<string, any>): Promise<void> {
    await this.emit({
      type: "agent.action.started",
      agentCodename,
      payload: { action, ...details },
    });
  }

  async emitAgentActionCompleted(agentCodename: string, action: string, result: Record<string, any>): Promise<void> {
    await this.emit({
      type: "agent.action.completed",
      agentCodename,
      payload: { action, ...result },
    });
  }

  async emitEscalation(agentCodename: string, summary: string, urgency: string, details?: Record<string, any>): Promise<void> {
    await this.emit({
      type: "agent.escalation",
      agentCodename,
      payload: { summary, urgency, ...details },
    });
  }

  async emitAgentCalibrated(agentCodename: string, calibration: {
    parameterName: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }): Promise<void> {
    await this.emit({
      type: "agent.calibrated",
      agentCodename,
      payload: calibration,
    });
  }

  async emitGoalProgress(goalId: number, agentCodename: string, progress: number, update: string): Promise<void> {
    await this.emit({
      type: "goal.progress",
      agentCodename,
      payload: { goalId, progress, update },
    });
  }

  async emitGoalCompleted(goalId: number, agentCodename: string, summary: string): Promise<void> {
    await this.emit({
      type: "goal.completed",
      agentCodename,
      payload: { goalId, summary },
    });
  }

  async emitKPIShifted(agentCodename: string, kpi: string, oldValue: number, newValue: number, attribution: string): Promise<void> {
    await this.emit({
      type: "kpi.shifted",
      agentCodename,
      payload: { kpi, oldValue, newValue, delta: newValue - oldValue, attribution },
    });
  }

  async emitLearningPropagated(sourceAgent: string, learning: string, targetAgents: string[]): Promise<void> {
    await this.emit({
      type: "learning.propagated",
      agentCodename: sourceAgent,
      payload: { learning, targetAgents, targetCount: targetAgents.length },
    });
  }

  async emitBriefingReady(briefingId: number, overallStatus: string, itemCount: number): Promise<void> {
    await this.emit({
      type: "briefing.ready",
      payload: { briefingId, overallStatus, itemCount },
    });
  }

  async emitScenarioStarted(scenarioId: number, title: string): Promise<void> {
    await this.emit({
      type: "scenario.started",
      payload: { scenarioId, title },
    });
  }

  async emitScenarioCompleted(scenarioId: number, title: string, recommendation: string): Promise<void> {
    await this.emit({
      type: "scenario.completed",
      payload: { scenarioId, title, recommendation },
    });
  }

  async emitResilienceTested(testType: string, score: number, spofCount: number): Promise<void> {
    await this.emit({
      type: "resilience.tested",
      payload: { testType, score, spofCount },
    });
  }

  async emitSystemAnomaly(anomaly: { type: string; description: string; severity: string }): Promise<void> {
    await this.emit({
      type: "system.anomaly",
      payload: anomaly,
    });
  }

  async emitSystemHeartbeat(healthGrade: string, metrics: Record<string, any>): Promise<void> {
    await this.emit({
      type: "system.heartbeat",
      payload: { healthGrade, ...metrics },
    });
  }

  // ─── Heartbeat timer ──────────────────────────────────────────────────

  startHeartbeat(intervalMs = 60_000): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.emitSystemHeartbeat("pulse", {
          connectionCount: wsServer.getConnectionCount(),
          timestamp: new Date().toISOString(),
        });
      } catch {
        // non-critical
      }
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ─── Event log queries ────────────────────────────────────────────────

  async getRecentEvents(limit = 50): Promise<RealtimeEvent[]> {
    return db.select().from(realtimeEventLog)
      .orderBy(desc(realtimeEventLog.createdAt))
      .limit(limit);
  }

  async getEventsByType(eventType: string, limit = 30): Promise<RealtimeEvent[]> {
    return db.select().from(realtimeEventLog)
      .where(eq(realtimeEventLog.eventType, eventType))
      .orderBy(desc(realtimeEventLog.createdAt))
      .limit(limit);
  }

  async getAgentEvents(agentCodename: string, limit = 30): Promise<RealtimeEvent[]> {
    return db.select().from(realtimeEventLog)
      .where(eq(realtimeEventLog.agentCodename, agentCodename))
      .orderBy(desc(realtimeEventLog.createdAt))
      .limit(limit);
  }

  async getEventStats(hours = 24): Promise<Record<string, number>> {
    const events = await db.select({
      eventType: realtimeEventLog.eventType,
      count: count(),
    }).from(realtimeEventLog)
      .where(gte(realtimeEventLog.createdAt, sql`NOW() - INTERVAL '${hours} hours'`))
      .groupBy(realtimeEventLog.eventType);

    const stats: Record<string, number> = {};
    for (const e of events) {
      stats[e.eventType] = Number(e.count);
    }
    return stats;
  }
}

export const realtimeNervousSystemService = new RealtimeNervousSystemService();
