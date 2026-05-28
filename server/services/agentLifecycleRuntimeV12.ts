/**
 * Agent Lifecycle Runtime — Sovereign Company Protocol v12
 *
 * Agents become stateful processes with lifecycle states, heartbeats, and
 * restart policies. Each agent transitions through well-defined states,
 * reports health via heartbeat, and can be restarted on failure.
 *
 * States: initializing → ready → thinking → acting → waiting → sleeping → crashed → terminated
 */

import { db } from "../db";
import {
  agentRuntimeState,
  type AgentRuntimeStateEntry,
} from "@shared/schema";
import { eq, desc, sql, and, lt } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";
import { logger } from "../utils/logger";

// ─── Lifecycle State Machine ──────────────────────────────────────────────────

type LifecycleState =
  | "initializing"
  | "ready"
  | "thinking"
  | "acting"
  | "waiting"
  | "sleeping"
  | "crashed"
  | "terminated";

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  initializing: ["ready", "crashed", "terminated"],
  ready: ["thinking", "acting", "waiting", "sleeping", "terminated"],
  thinking: ["ready", "acting", "waiting", "crashed", "terminated"],
  acting: ["ready", "thinking", "waiting", "crashed", "terminated"],
  waiting: ["ready", "thinking", "acting", "sleeping", "crashed", "terminated"],
  sleeping: ["ready", "initializing", "crashed", "terminated"],
  crashed: ["initializing", "terminated"],
  terminated: [],
};

// ─── Service ──────────────────────────────────────────────────────────────────

class AgentLifecycleRuntimeService {
  /**
   * Bootstrap runtime state rows for every registered agent.
   * Skips agents that already have a runtime entry.
   */
  async initializeAll(): Promise<{ initialized: number; skipped: number }> {
    const agents = await companyAgentService.getAllIncludingPaused();
    let initialized = 0;
    let skipped = 0;

    for (const agent of agents) {
      const existing = await db
        .select()
        .from(agentRuntimeState)
        .where(eq(agentRuntimeState.agentCodename, agent.codename))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(agentRuntimeState).values({
        agentCodename: agent.codename,
        lifecycleState: "initializing",
        persistentContext: {},
        lastHeartbeatAt: new Date(),
      });
      initialized++;
    }

    return { initialized, skipped };
  }

  /**
   * Transition an agent to a new lifecycle state.
   * Enforces the state machine — throws if the transition is invalid.
   */
  async transitionState(
    agentCodename: string,
    newState: LifecycleState,
    context?: Record<string, any>,
  ): Promise<AgentRuntimeStateEntry> {
    const current = await this.getState(agentCodename);
    if (!current) {
      throw new Error(`No runtime state found for agent: ${agentCodename}`);
    }

    const currentState = current.lifecycleState as LifecycleState;
    const allowed = VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition for ${agentCodename}: ${currentState} → ${newState}. ` +
          `Allowed: ${allowed.join(", ")}`,
      );
    }

    const updates: Record<string, any> = {
      lifecycleState: newState,
      updatedAt: new Date(),
    };

    if (context) {
      updates.persistentContext = { ...current.persistentContext, ...context };
    }

    // Clear waiting fields when leaving waiting state
    if (currentState === "waiting" && newState !== "waiting") {
      updates.waitingFor = null;
      updates.waitingSince = null;
    }

    // Reset failures when successfully reaching ready
    if (newState === "ready") {
      updates.consecutiveFailures = 0;
    }

    const [updated] = await db
      .update(agentRuntimeState)
      .set(updates)
      .where(eq(agentRuntimeState.agentCodename, agentCodename))
      .returning();

    return updated;
  }

  /**
   * Agent heartbeat — proves liveness, resets the heartbeat timer.
   */
  async heartbeat(agentCodename: string): Promise<void> {
    await db
      .update(agentRuntimeState)
      .set({
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeState.agentCodename, agentCodename));
  }

  /**
   * Health check — find agents that have missed their heartbeat window
   * and apply their restart policy.
   */
  async checkHealth(): Promise<{
    healthy: number;
    unhealthy: string[];
    restarted: string[];
  }> {
    const allStates = await this.getAllStates();
    const now = Date.now();
    const healthy: string[] = [];
    const unhealthy: string[] = [];
    const restarted: string[] = [];

    for (const agent of allStates) {
      // Skip terminated agents
      if (agent.lifecycleState === "terminated") continue;

      const lastBeat = new Date(agent.lastHeartbeatAt).getTime();
      const missedWindow = now - lastBeat > agent.heartbeatIntervalMs * 2;

      if (!missedWindow) {
        healthy.push(agent.agentCodename);
        continue;
      }

      unhealthy.push(agent.agentCodename);

      // Apply restart policy
      if (agent.restartPolicy === "restart" && agent.lifecycleState !== "crashed") {
        await this.transitionState(agent.agentCodename, "crashed", {
          crashReason: "heartbeat_timeout",
          crashedAt: new Date().toISOString(),
        });
        await this.restart(agent.agentCodename);
        restarted.push(agent.agentCodename);
      }
    }

    return { healthy: healthy.length, unhealthy, restarted };
  }

  /**
   * Get the runtime state entry for a single agent.
   */
  async getState(agentCodename: string): Promise<AgentRuntimeStateEntry | null> {
    const [row] = await db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentCodename, agentCodename))
      .limit(1);
    return row ?? null;
  }

  /**
   * Get all agent runtime states.
   */
  async getAllStates(): Promise<AgentRuntimeStateEntry[]> {
    return db.select().from(agentRuntimeState).orderBy(agentRuntimeState.agentCodename);
  }

  /**
   * Mark an agent as waiting for a specific dependency.
   */
  async setWaiting(agentCodename: string, waitingFor: string): Promise<void> {
    const current = await this.getState(agentCodename);
    if (!current) throw new Error(`No runtime state for: ${agentCodename}`);

    await this.transitionState(agentCodename, "waiting");
    await db
      .update(agentRuntimeState)
      .set({
        waitingFor,
        waitingSince: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeState.agentCodename, agentCodename));
  }

  /**
   * Clear the waiting state and return agent to ready.
   */
  async clearWaiting(agentCodename: string): Promise<void> {
    await this.transitionState(agentCodename, "ready");
  }

  /**
   * Record a failure for an agent. If consecutive failures exceed the
   * threshold, transition to crashed and apply restart policy.
   */
  async recordFailure(
    agentCodename: string,
    error: string,
  ): Promise<{ failures: number; restarted: boolean }> {
    const current = await this.getState(agentCodename);
    if (!current) throw new Error(`No runtime state for: ${agentCodename}`);

    const failures = current.consecutiveFailures + 1;

    await db
      .update(agentRuntimeState)
      .set({
        consecutiveFailures: failures,
        persistentContext: {
          ...current.persistentContext,
          lastError: error,
          lastErrorAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeState.agentCodename, agentCodename));

    let restarted = false;
    if (failures >= current.maxConsecutiveFailures) {
      await this.transitionState(agentCodename, "crashed", {
        crashReason: "max_failures_exceeded",
        finalError: error,
      });
      if (current.restartPolicy === "restart") {
        await this.restart(agentCodename);
        restarted = true;
      }
    }

    return { failures, restarted };
  }

  /**
   * Restart an agent — reset to initializing and increment restart count.
   */
  async restart(agentCodename: string): Promise<AgentRuntimeStateEntry> {
    const current = await this.getState(agentCodename);
    if (!current) throw new Error(`No runtime state for: ${agentCodename}`);

    const [updated] = await db
      .update(agentRuntimeState)
      .set({
        lifecycleState: "initializing",
        consecutiveFailures: 0,
        restartCount: current.restartCount + 1,
        lastRestartAt: new Date(),
        currentTask: null,
        currentTaskStartedAt: null,
        waitingFor: null,
        waitingSince: null,
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeState.agentCodename, agentCodename))
      .returning();

    logger.info(`[agent-lifecycle] Restarted ${agentCodename} (restart #${updated.restartCount})`);
    return updated;
  }

  /**
   * Merge a partial context update into an agent's persistent context.
   */
  async updateContext(
    agentCodename: string,
    contextUpdate: Record<string, any>,
  ): Promise<void> {
    const current = await this.getState(agentCodename);
    if (!current) throw new Error(`No runtime state for: ${agentCodename}`);

    await db
      .update(agentRuntimeState)
      .set({
        persistentContext: { ...current.persistentContext, ...contextUpdate },
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeState.agentCodename, agentCodename));
  }

  /**
   * Runtime dashboard — summary of agent fleet health.
   */
  async getRuntimeDashboard(): Promise<{
    totalAgents: number;
    byState: Record<string, number>;
    healthySince: Record<string, string>;
    restartCounts: Record<string, number>;
    crashedAgents: string[];
    waitingAgents: Array<{ codename: string; waitingFor: string; since: string }>;
  }> {
    const allStates = await this.getAllStates();

    const byState: Record<string, number> = {};
    const healthySince: Record<string, string> = {};
    const restartCounts: Record<string, number> = {};
    const crashedAgents: string[] = [];
    const waitingAgents: Array<{ codename: string; waitingFor: string; since: string }> = [];

    for (const agent of allStates) {
      byState[agent.lifecycleState] = (byState[agent.lifecycleState] ?? 0) + 1;
      healthySince[agent.agentCodename] = agent.lastHeartbeatAt?.toISOString?.() ?? "unknown";
      restartCounts[agent.agentCodename] = agent.restartCount;

      if (agent.lifecycleState === "crashed") {
        crashedAgents.push(agent.agentCodename);
      }
      if (agent.lifecycleState === "waiting" && agent.waitingFor) {
        waitingAgents.push({
          codename: agent.agentCodename,
          waitingFor: agent.waitingFor,
          since: agent.waitingSince?.toISOString?.() ?? "unknown",
        });
      }
    }

    return {
      totalAgents: allStates.length,
      byState,
      healthySince,
      restartCounts,
      crashedAgents,
      waitingAgents,
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const agentLifecycleRuntimeService = new AgentLifecycleRuntimeService();
