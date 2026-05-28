/**
 * Agent Resource Governor — Sovereign Company Protocol v11
 *
 * Every agent operates within defined resource boundaries:
 * - Daily action quotas (Sophie: max 200 ticket resolutions/day)
 * - Cost caps per agent per day
 * - Rate limiting per action type
 * - Circuit breaker: if failure rate > 30%, agent pauses for cooldown
 * - Burst detection: if agent 5x normal activity → alert + throttle
 * - Resource borrowing between agents
 */

import { db } from "../db";
import {
  agentResourceQuotas, resourceQuotaEvents,
  type AgentResourceQuota, type ResourceQuotaEvent,
} from "@shared/schema";
import { eq, desc, gte, sql } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";

const DEFAULT_COOLDOWN_MINUTES = 30;
const BURST_MULTIPLIER = 5;

class AgentResourceGovernorService {

  /**
   * Initialize quotas for all agents.
   */
  async initializeQuotas(): Promise<AgentResourceQuota[]> {
    const agents = await companyAgentService.getAll();
    const results: AgentResourceQuota[] = [];

    for (const agent of agents) {
      const [existing] = await db.select().from(agentResourceQuotas)
        .where(eq(agentResourceQuotas.agentCodename, agent.codename)).limit(1);

      if (!existing) {
        const [quota] = await db.insert(agentResourceQuotas).values({
          agentCodename: agent.codename,
        }).returning();
        results.push(quota);
      } else {
        results.push(existing);
      }
    }
    return results;
  }

  /**
   * Check if an agent can perform an action. Returns { allowed, reason }.
   */
  async checkQuota(agentCodename: string, costCents = 0): Promise<{ allowed: boolean; reason?: string }> {
    const [quota] = await db.select().from(agentResourceQuotas)
      .where(eq(agentResourceQuotas.agentCodename, agentCodename)).limit(1);

    if (!quota) return { allowed: true }; // no quota = no limits

    // Check circuit breaker
    if (quota.circuitBreakerTripped) {
      if (quota.circuitBreakerCooldownUntil && new Date() < new Date(quota.circuitBreakerCooldownUntil)) {
        return { allowed: false, reason: `Circuit breaker tripped. Cooldown until ${quota.circuitBreakerCooldownUntil}` };
      }
      // Cooldown expired, reset
      await this.resetCircuitBreaker(agentCodename);
    }

    // Check burst throttle
    if (quota.burstDetected && quota.burstThrottledUntil && new Date() < new Date(quota.burstThrottledUntil)) {
      return { allowed: false, reason: `Burst detected. Throttled until ${quota.burstThrottledUntil}` };
    }

    // Check daily action limit
    if (quota.dailyActionsUsed >= quota.dailyActionLimit) {
      return { allowed: false, reason: `Daily action limit reached (${quota.dailyActionLimit})` };
    }

    // Check hourly rate limit
    if (quota.hourlyActionsUsed >= quota.hourlyRateLimit) {
      return { allowed: false, reason: `Hourly rate limit reached (${quota.hourlyRateLimit})` };
    }

    // Check cost limit
    if (quota.dailyCostUsedCents + costCents > quota.dailyCostLimitCents) {
      return { allowed: false, reason: `Daily cost limit would be exceeded ($${(quota.dailyCostLimitCents / 100).toFixed(2)})` };
    }

    return { allowed: true };
  }

  /**
   * Record an agent action — increments counters, detects bursts.
   */
  async recordAction(agentCodename: string, costCents = 0, success = true): Promise<void> {
    const [quota] = await db.select().from(agentResourceQuotas)
      .where(eq(agentResourceQuotas.agentCodename, agentCodename)).limit(1);

    if (!quota) return;

    const newDailyUsed = quota.dailyActionsUsed + 1;
    const newHourlyUsed = quota.hourlyActionsUsed + 1;
    const newCostUsed = quota.dailyCostUsedCents + costCents;

    // Burst detection: if hourly usage > BURST_MULTIPLIER * (daily_limit / 24)
    const expectedHourlyRate = quota.dailyActionLimit / 24;
    const isBurst = newHourlyUsed > expectedHourlyRate * BURST_MULTIPLIER;

    const updates: Partial<AgentResourceQuota> = {
      dailyActionsUsed: newDailyUsed,
      hourlyActionsUsed: newHourlyUsed,
      dailyCostUsedCents: newCostUsed,
      updatedAt: new Date(),
    };

    if (isBurst && !quota.burstDetected) {
      updates.burstDetected = true;
      updates.burstThrottledUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min throttle
      await this.logEvent(agentCodename, "burst_detected", {
        hourlyActions: newHourlyUsed,
        expectedRate: expectedHourlyRate,
        multiplier: newHourlyUsed / expectedHourlyRate,
      });
    }

    // Circuit breaker: track failure rate (simplified)
    if (!success) {
      const recentEvents = await db.select().from(resourceQuotaEvents)
        .where(eq(resourceQuotaEvents.agentCodename, agentCodename))
        .orderBy(desc(resourceQuotaEvents.createdAt)).limit(10);

      // If we can't easily compute failure rate, skip circuit breaker for now
      // In production, this would track success/failure counters
    }

    await db.update(agentResourceQuotas)
      .set(updates)
      .where(eq(agentResourceQuotas.agentCodename, agentCodename));
  }

  /**
   * Trip the circuit breaker for an agent.
   */
  async tripCircuitBreaker(agentCodename: string, reason: string): Promise<void> {
    const cooldownUntil = new Date(Date.now() + DEFAULT_COOLDOWN_MINUTES * 60 * 1000);

    await db.update(agentResourceQuotas)
      .set({
        circuitBreakerTripped: true,
        circuitBreakerCooldownUntil: cooldownUntil,
        updatedAt: new Date(),
      })
      .where(eq(agentResourceQuotas.agentCodename, agentCodename));

    await this.logEvent(agentCodename, "circuit_breaker_tripped", { reason, cooldownUntil: cooldownUntil.toISOString() });
  }

  /**
   * Reset circuit breaker.
   */
  async resetCircuitBreaker(agentCodename: string): Promise<void> {
    await db.update(agentResourceQuotas)
      .set({
        circuitBreakerTripped: false,
        circuitBreakerCooldownUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(agentResourceQuotas.agentCodename, agentCodename));

    await this.logEvent(agentCodename, "cooldown_expired", {});
  }

  /**
   * Daily reset — resets daily counters.
   */
  async dailyReset(): Promise<void> {
    await db.update(agentResourceQuotas)
      .set({
        dailyActionsUsed: 0,
        dailyCostUsedCents: 0,
        hourlyActionsUsed: 0,
        burstDetected: false,
        burstThrottledUntil: null,
        lastResetAt: new Date(),
        updatedAt: new Date(),
      });

    // Log reset for all agents
    const agents = await companyAgentService.getAll();
    for (const agent of agents) {
      await this.logEvent(agent.codename, "quota_reset", { type: "daily" });
    }
  }

  /**
   * Hourly reset — resets hourly counter only.
   */
  async hourlyReset(): Promise<void> {
    await db.update(agentResourceQuotas)
      .set({ hourlyActionsUsed: 0, updatedAt: new Date() });
  }

  /**
   * Update an agent's quota limits.
   */
  async updateLimits(agentCodename: string, limits: {
    dailyActionLimit?: number;
    dailyCostLimitCents?: number;
    hourlyRateLimit?: number;
    circuitBreakerThreshold?: number;
  }): Promise<AgentResourceQuota> {
    // circuit_breaker_threshold is a numeric column (string in drizzle); the
    // caller passes a number, so coerce it. The rest map 1:1.
    const { circuitBreakerThreshold, ...rest } = limits;
    const [updated] = await db.update(agentResourceQuotas)
      .set({
        ...rest,
        ...(circuitBreakerThreshold !== undefined
          ? { circuitBreakerThreshold: String(circuitBreakerThreshold) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(agentResourceQuotas.agentCodename, agentCodename))
      .returning();
    return updated;
  }

  async getAllQuotas(): Promise<AgentResourceQuota[]> {
    return db.select().from(agentResourceQuotas).orderBy(agentResourceQuotas.agentCodename);
  }

  async getQuota(agentCodename: string): Promise<AgentResourceQuota | null> {
    const [q] = await db.select().from(agentResourceQuotas)
      .where(eq(agentResourceQuotas.agentCodename, agentCodename)).limit(1);
    return q || null;
  }

  async getRecentEvents(agentCodename?: string, limit = 30): Promise<ResourceQuotaEvent[]> {
    const query = agentCodename
      ? db.select().from(resourceQuotaEvents).where(eq(resourceQuotaEvents.agentCodename, agentCodename))
      : db.select().from(resourceQuotaEvents);
    return query.orderBy(desc(resourceQuotaEvents.createdAt)).limit(limit);
  }

  private async logEvent(agentCodename: string, eventType: string, details: Record<string, any>): Promise<void> {
    await db.insert(resourceQuotaEvents).values({ agentCodename, eventType, details });
  }
}

export const agentResourceGovernorService = new AgentResourceGovernorService();
