// @ts-nocheck
/**
 * Trust Enforcement Layer — Sovereign Company Protocol v12: FOUNDATION
 *
 * Trust that actually PREVENTS unauthorized actions. Every agent action passes
 * through enforce() — the single gate. If trust is insufficient, the action is
 * blocked or queued for CEO approval. Success builds trust; failure erodes it.
 * Consecutive wins earn bonuses. Escalations carry heavy penalties.
 *
 * Trust auto-adjustment rules:
 *   success       → +2
 *   failure       → -5
 *   escalation    → -10
 *   5+ consecutive successes → bonus +3
 */

import { db } from "../db";
import {
  trustEnforcementLog,
  tenantAgentConfig,
  type TrustEnforcementLogEntry,
  type TenantAgentConfigEntry,
} from "@shared/schema";
import { eq, and, desc, sql, count, isNull } from "drizzle-orm";

const TRUST_ADJUSTMENTS = {
  success: 2,
  failure: -5,
  escalation: -10,
  consecutiveBonus: 3,
  consecutiveThreshold: 5,
} as const;

const DEFAULT_TRUST = 50;

class TrustEnforcementService {

  // ─── THE GATE ────────────────────────────────────────────────────────────────

  async enforce(
    agentCodename: string,
    actionType: string,
    requiredTrust: number,
    orgId?: number,
  ): Promise<{ allowed: boolean; decision: string; enforcementId: number }> {
    const actualTrust = await this.getTrust(agentCodename, orgId);
    let decision: string;

    if (actualTrust >= requiredTrust) {
      decision = "allowed";
    } else if (actualTrust >= requiredTrust - 15) {
      // Close enough — queue for approval rather than hard block
      decision = "pending_approval";
    } else {
      decision = "blocked";
    }

    const [entry] = await db.insert(trustEnforcementLog).values({
      agentCodename,
      actionType,
      requiredTrust,
      actualTrust,
      decision,
      orgId: orgId ?? null,
      approvalRequestedAt: decision === "pending_approval" ? new Date() : null,
    }).returning();

    return {
      allowed: decision === "allowed",
      decision,
      enforcementId: entry.id,
    };
  }

  // ─── Approve / Deny ─────────────────────────────────────────────────────────

  async approve(enforcementId: number, approvedBy: string): Promise<TrustEnforcementLogEntry> {
    const [entry] = await db.update(trustEnforcementLog)
      .set({
        decision: "approved",
        approvedBy,
        approvalResolvedAt: new Date(),
      })
      .where(and(
        eq(trustEnforcementLog.id, enforcementId),
        eq(trustEnforcementLog.decision, "pending_approval"),
      ))
      .returning();

    if (!entry) throw new Error(`Enforcement ${enforcementId} not found or not pending`);
    return entry;
  }

  async deny(enforcementId: number, reason: string): Promise<TrustEnforcementLogEntry> {
    const [entry] = await db.update(trustEnforcementLog)
      .set({
        decision: "denied",
        actionOutcome: reason,
        approvalResolvedAt: new Date(),
      })
      .where(and(
        eq(trustEnforcementLog.id, enforcementId),
        eq(trustEnforcementLog.decision, "pending_approval"),
      ))
      .returning();

    if (!entry) throw new Error(`Enforcement ${enforcementId} not found or not pending`);
    return entry;
  }

  // ─── Record Outcome & Auto-Adjust Trust ──────────────────────────────────────

  async recordOutcome(
    enforcementId: number,
    outcome: "success" | "failure" | "escalation",
  ): Promise<TrustEnforcementLogEntry> {
    const [entry] = await db
      .select()
      .from(trustEnforcementLog)
      .where(eq(trustEnforcementLog.id, enforcementId));

    if (!entry) throw new Error(`Enforcement ${enforcementId} not found`);

    let delta = TRUST_ADJUSTMENTS[outcome];

    // Check for consecutive success bonus
    if (outcome === "success") {
      const recent = await db
        .select()
        .from(trustEnforcementLog)
        .where(and(
          eq(trustEnforcementLog.agentCodename, entry.agentCodename),
          sql`${trustEnforcementLog.actionOutcome} IS NOT NULL`,
        ))
        .orderBy(desc(trustEnforcementLog.createdAt))
        .limit(TRUST_ADJUSTMENTS.consecutiveThreshold);

      const allSuccess = recent.length >= TRUST_ADJUSTMENTS.consecutiveThreshold
        && recent.every(r => r.actionOutcome === "success");

      if (allSuccess) {
        delta += TRUST_ADJUSTMENTS.consecutiveBonus;
      }
    }

    const [updated] = await db.update(trustEnforcementLog)
      .set({ actionOutcome: outcome, trustDelta: delta })
      .where(eq(trustEnforcementLog.id, enforcementId))
      .returning();

    // Apply trust adjustment
    await this.adjustTrust(entry.agentCodename, delta, `auto:${outcome}`, entry.orgId ?? undefined);

    return updated;
  }

  // ─── Manual Trust Adjustment ─────────────────────────────────────────────────

  async adjustTrust(
    agentCodename: string,
    delta: number,
    reason: string,
    orgId?: number,
  ): Promise<{ newTrust: number }> {
    if (orgId) {
      // Tenant-scoped trust
      const [config] = await db
        .select()
        .from(tenantAgentConfig)
        .where(and(
          eq(tenantAgentConfig.orgId, orgId),
          eq(tenantAgentConfig.agentCodename, agentCodename),
        ));

      if (config) {
        const newTrust = Math.max(
          config.trustFloor,
          Math.min(config.trustCeiling, config.trustScore + delta),
        );
        await db.update(tenantAgentConfig)
          .set({ trustScore: newTrust, updatedAt: new Date() })
          .where(eq(tenantAgentConfig.id, config.id));
        return { newTrust };
      }
    }

    // Log the adjustment for audit even without tenant config
    await db.insert(trustEnforcementLog).values({
      agentCodename,
      actionType: "trust_adjustment",
      requiredTrust: 0,
      actualTrust: delta,
      decision: "adjustment",
      actionOutcome: reason,
      trustDelta: delta,
      orgId: orgId ?? null,
    });

    return { newTrust: DEFAULT_TRUST + delta };
  }

  // ─── Get Trust ───────────────────────────────────────────────────────────────

  async getTrust(agentCodename: string, orgId?: number): Promise<number> {
    if (orgId) {
      const [config] = await db
        .select()
        .from(tenantAgentConfig)
        .where(and(
          eq(tenantAgentConfig.orgId, orgId),
          eq(tenantAgentConfig.agentCodename, agentCodename),
        ));
      if (config) return config.trustScore;
    }

    // Compute from enforcement history if no tenant config
    const recent = await db
      .select()
      .from(trustEnforcementLog)
      .where(and(
        eq(trustEnforcementLog.agentCodename, agentCodename),
        sql`${trustEnforcementLog.trustDelta} IS NOT NULL`,
      ))
      .orderBy(desc(trustEnforcementLog.createdAt))
      .limit(50);

    const totalDelta = recent.reduce((sum, r) => sum + (r.trustDelta ?? 0), 0);
    return Math.max(0, Math.min(100, DEFAULT_TRUST + totalDelta));
  }

  // ─── Pending Approvals ───────────────────────────────────────────────────────

  async getPendingApprovals(orgId?: number): Promise<TrustEnforcementLogEntry[]> {
    const conditions = [eq(trustEnforcementLog.decision, "pending_approval")];
    if (orgId) conditions.push(eq(trustEnforcementLog.orgId, orgId));

    return db
      .select()
      .from(trustEnforcementLog)
      .where(and(...conditions))
      .orderBy(desc(trustEnforcementLog.createdAt));
  }

  // ─── Enforcement History ─────────────────────────────────────────────────────

  async getEnforcementHistory(agentCodename?: string, limit: number = 50): Promise<TrustEnforcementLogEntry[]> {
    const conditions = [];
    if (agentCodename) conditions.push(eq(trustEnforcementLog.agentCodename, agentCodename));

    return db
      .select()
      .from(trustEnforcementLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(trustEnforcementLog.createdAt))
      .limit(limit);
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  async getStats(): Promise<{
    total: number;
    allowed: number;
    blocked: number;
    pending: number;
    approved: number;
    denied: number;
    avgTrustByAgent: { agentCodename: string; avgTrust: number }[];
  }> {
    const all = await db.select().from(trustEnforcementLog);

    const stats = {
      total: all.length,
      allowed: 0,
      blocked: 0,
      pending: 0,
      approved: 0,
      denied: 0,
    };

    for (const entry of all) {
      switch (entry.decision) {
        case "allowed": stats.allowed++; break;
        case "blocked": stats.blocked++; break;
        case "pending_approval": stats.pending++; break;
        case "approved": stats.approved++; break;
        case "denied": stats.denied++; break;
      }
    }

    // Average trust by agent from recent enforcements
    const agentTrusts: Record<string, number[]> = {};
    for (const entry of all) {
      if (!agentTrusts[entry.agentCodename]) agentTrusts[entry.agentCodename] = [];
      agentTrusts[entry.agentCodename].push(entry.actualTrust);
    }

    const avgTrustByAgent = Object.entries(agentTrusts).map(([agentCodename, trusts]) => ({
      agentCodename,
      avgTrust: Math.round(trusts.reduce((a, b) => a + b, 0) / trusts.length),
    }));

    return { ...stats, avgTrustByAgent };
  }
}

export const trustEnforcementService = new TrustEnforcementService();
