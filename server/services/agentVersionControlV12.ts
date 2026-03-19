// @ts-nocheck
/**
 * Agent Version Control — Sovereign Company Protocol v12: FOUNDATION
 *
 * Deploy agent changes like code. Every personality prompt tweak, behavior config
 * change, or service ownership update is versioned. Canary deployments let you
 * roll out changes to a percentage of traffic before going full. Rollback is
 * instant. Performance tracking ties metrics to specific versions.
 */

import { db } from "../db";
import { agentVersions, type AgentVersion } from "@shared/schema";
import { eq, and, desc, sql, gt } from "drizzle-orm";

class AgentVersionControlService {

  // ─── Create Version ──────────────────────────────────────────────────────────

  async createVersion(agentCodename: string, params: {
    personalityPrompt: string;
    behaviorConfig: Record<string, any>;
    changeDescription: string;
    ownedServices?: string[];
    createdBy?: string;
  }): Promise<AgentVersion> {
    const latest = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(${agentVersions.versionNumber}), 0)` })
      .from(agentVersions)
      .where(eq(agentVersions.agentCodename, agentCodename));

    const nextVersion = (latest[0]?.maxVersion ?? 0) + 1;

    const [version] = await db.insert(agentVersions).values({
      agentCodename,
      versionNumber: nextVersion,
      personalityPrompt: params.personalityPrompt,
      behaviorConfig: params.behaviorConfig,
      changeDescription: params.changeDescription,
      ownedServices: params.ownedServices ?? [],
      createdBy: params.createdBy ?? "system",
      isActive: false,
      canaryWeight: 0,
    }).returning();

    return version;
  }

  // ─── Deploy ──────────────────────────────────────────────────────────────────

  async deploy(versionId: number, canaryWeight?: number): Promise<AgentVersion> {
    const [version] = await db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, versionId));

    if (!version) throw new Error(`Version ${versionId} not found`);

    const weight = canaryWeight ?? 100;
    if (weight < 10 || weight > 100) {
      throw new Error("Canary weight must be between 10 and 100");
    }

    // If full deploy (100%), deactivate all other versions for this agent
    if (weight === 100) {
      await db.update(agentVersions)
        .set({ isActive: false, canaryWeight: 0 })
        .where(and(
          eq(agentVersions.agentCodename, version.agentCodename),
          eq(agentVersions.isActive, true),
        ));
    }

    const [deployed] = await db.update(agentVersions)
      .set({
        isActive: true,
        canaryWeight: weight,
        deployedAt: new Date(),
        rolledBackAt: null,
      })
      .where(eq(agentVersions.id, versionId))
      .returning();

    // If canary, adjust the primary version's weight to fill the remainder
    if (weight < 100) {
      const active = await db
        .select()
        .from(agentVersions)
        .where(and(
          eq(agentVersions.agentCodename, version.agentCodename),
          eq(agentVersions.isActive, true),
          eq(agentVersions.canaryWeight, 100),
        ));

      if (active.length > 0) {
        await db.update(agentVersions)
          .set({ canaryWeight: 100 - weight })
          .where(eq(agentVersions.id, active[0].id));
      }
    }

    return deployed;
  }

  // ─── Rollback ────────────────────────────────────────────────────────────────

  async rollback(agentCodename: string): Promise<AgentVersion> {
    const activeVersions = await db
      .select()
      .from(agentVersions)
      .where(and(
        eq(agentVersions.agentCodename, agentCodename),
        eq(agentVersions.isActive, true),
      ))
      .orderBy(desc(agentVersions.versionNumber));

    if (activeVersions.length === 0) {
      throw new Error(`No active version found for ${agentCodename}`);
    }

    const current = activeVersions[0];

    // Deactivate current
    await db.update(agentVersions)
      .set({ isActive: false, canaryWeight: 0, rolledBackAt: new Date() })
      .where(eq(agentVersions.id, current.id));

    // Find the previous version (most recent before current that was deployed)
    const [previous] = await db
      .select()
      .from(agentVersions)
      .where(and(
        eq(agentVersions.agentCodename, agentCodename),
        sql`${agentVersions.versionNumber} < ${current.versionNumber}`,
      ))
      .orderBy(desc(agentVersions.versionNumber))
      .limit(1);

    if (!previous) {
      throw new Error(`No previous version to rollback to for ${agentCodename}`);
    }

    const [restored] = await db.update(agentVersions)
      .set({ isActive: true, canaryWeight: 100, deployedAt: new Date() })
      .where(eq(agentVersions.id, previous.id))
      .returning();

    return restored;
  }

  // ─── Get Active Version ──────────────────────────────────────────────────────

  async getActiveVersion(agentCodename: string): Promise<AgentVersion | null> {
    const [version] = await db
      .select()
      .from(agentVersions)
      .where(and(
        eq(agentVersions.agentCodename, agentCodename),
        eq(agentVersions.isActive, true),
        eq(agentVersions.canaryWeight, 100),
      ))
      .limit(1);

    return version ?? null;
  }

  // ─── Version History ─────────────────────────────────────────────────────────

  async getVersionHistory(agentCodename: string, limit: number = 20): Promise<AgentVersion[]> {
    return db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentCodename, agentCodename))
      .orderBy(desc(agentVersions.versionNumber))
      .limit(limit);
  }

  // ─── Compare Versions ────────────────────────────────────────────────────────

  async compareVersions(versionId1: number, versionId2: number): Promise<{
    v1: AgentVersion;
    v2: AgentVersion;
    promptChanged: boolean;
    configChanged: boolean;
    promptDiff: { v1: string; v2: string };
    configDiff: { v1: Record<string, any>; v2: Record<string, any> };
    servicesChanged: boolean;
    servicesDiff: { added: string[]; removed: string[] };
  }> {
    const [v1] = await db.select().from(agentVersions).where(eq(agentVersions.id, versionId1));
    const [v2] = await db.select().from(agentVersions).where(eq(agentVersions.id, versionId2));

    if (!v1 || !v2) throw new Error("One or both versions not found");

    const s1 = new Set(v1.ownedServices ?? []);
    const s2 = new Set(v2.ownedServices ?? []);

    return {
      v1,
      v2,
      promptChanged: v1.personalityPrompt !== v2.personalityPrompt,
      configChanged: JSON.stringify(v1.behaviorConfig) !== JSON.stringify(v2.behaviorConfig),
      promptDiff: { v1: v1.personalityPrompt, v2: v2.personalityPrompt },
      configDiff: { v1: v1.behaviorConfig, v2: v2.behaviorConfig },
      servicesChanged: JSON.stringify([...s1].sort()) !== JSON.stringify([...s2].sort()),
      servicesDiff: {
        added: [...s2].filter(s => !s1.has(s)),
        removed: [...s1].filter(s => !s2.has(s)),
      },
    };
  }

  // ─── Update Canary Weight ────────────────────────────────────────────────────

  async updateCanaryWeight(versionId: number, weight: number): Promise<AgentVersion> {
    if (weight < 10 || weight > 100) {
      throw new Error("Canary weight must be between 10 and 100");
    }

    const [version] = await db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, versionId));

    if (!version) throw new Error(`Version ${versionId} not found`);
    if (!version.isActive) throw new Error("Cannot adjust weight on inactive version");

    const [updated] = await db.update(agentVersions)
      .set({ canaryWeight: weight })
      .where(eq(agentVersions.id, versionId))
      .returning();

    // Adjust the complementary active version's weight
    const others = await db
      .select()
      .from(agentVersions)
      .where(and(
        eq(agentVersions.agentCodename, version.agentCodename),
        eq(agentVersions.isActive, true),
        sql`${agentVersions.id} != ${versionId}`,
      ));

    if (others.length > 0) {
      await db.update(agentVersions)
        .set({ canaryWeight: 100 - weight })
        .where(eq(agentVersions.id, others[0].id));
    }

    return updated;
  }

  // ─── Promote Canary ──────────────────────────────────────────────────────────

  async promoteCanary(versionId: number): Promise<AgentVersion> {
    const [version] = await db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, versionId));

    if (!version) throw new Error(`Version ${versionId} not found`);

    // Deactivate all other versions for this agent
    await db.update(agentVersions)
      .set({ isActive: false, canaryWeight: 0 })
      .where(and(
        eq(agentVersions.agentCodename, version.agentCodename),
        eq(agentVersions.isActive, true),
        sql`${agentVersions.id} != ${versionId}`,
      ));

    const [promoted] = await db.update(agentVersions)
      .set({ canaryWeight: 100 })
      .where(eq(agentVersions.id, versionId))
      .returning();

    return promoted;
  }

  // ─── Record Performance ──────────────────────────────────────────────────────

  async recordPerformance(versionId: number, metrics: Record<string, any>): Promise<AgentVersion> {
    const [version] = await db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, versionId));

    if (!version) throw new Error(`Version ${versionId} not found`);

    const merged = { ...version.performanceMetrics, ...metrics, lastUpdated: new Date().toISOString() };

    const [updated] = await db.update(agentVersions)
      .set({ performanceMetrics: merged })
      .where(eq(agentVersions.id, versionId))
      .returning();

    return updated;
  }

  // ─── Canary Status ───────────────────────────────────────────────────────────

  async getCanaryStatus(): Promise<{
    agentCodename: string;
    versions: { id: number; versionNumber: number; canaryWeight: number }[];
  }[]> {
    const canaries = await db
      .select()
      .from(agentVersions)
      .where(and(
        eq(agentVersions.isActive, true),
        sql`${agentVersions.canaryWeight} > 0`,
        sql`${agentVersions.canaryWeight} < 100`,
      ));

    const byAgent: Record<string, { id: number; versionNumber: number; canaryWeight: number }[]> = {};
    for (const v of canaries) {
      if (!byAgent[v.agentCodename]) byAgent[v.agentCodename] = [];
      byAgent[v.agentCodename].push({
        id: v.id,
        versionNumber: v.versionNumber,
        canaryWeight: v.canaryWeight,
      });
    }

    return Object.entries(byAgent).map(([agentCodename, versions]) => ({
      agentCodename,
      versions,
    }));
  }

  // ─── Select Version (respects canary weights) ────────────────────────────────

  async selectVersion(agentCodename: string): Promise<AgentVersion | null> {
    const activeVersions = await db
      .select()
      .from(agentVersions)
      .where(and(
        eq(agentVersions.agentCodename, agentCodename),
        eq(agentVersions.isActive, true),
      ))
      .orderBy(desc(agentVersions.canaryWeight));

    if (activeVersions.length === 0) return null;
    if (activeVersions.length === 1) return activeVersions[0];

    // Weighted random selection based on canary weights
    const totalWeight = activeVersions.reduce((sum, v) => sum + v.canaryWeight, 0);
    if (totalWeight === 0) return activeVersions[0];

    let random = Math.random() * totalWeight;
    for (const version of activeVersions) {
      random -= version.canaryWeight;
      if (random <= 0) return version;
    }

    return activeVersions[0];
  }
}

export const agentVersionControlService = new AgentVersionControlService();
