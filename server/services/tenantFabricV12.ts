// @ts-nocheck
/**
 * Tenant Context Fabric — Sovereign Company Protocol v12: FOUNDATION
 *
 * True multi-tenant agent isolation. Each organization gets its own agent
 * configurations with independent trust scores, quotas, permissions, and
 * personality overrides. Trust is bounded by configurable floor/ceiling per
 * tenant-agent pair. Initialization seeds configs for all known agents.
 */

import { db } from "../db";
import { tenantAgentConfig, type TenantAgentConfigEntry } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";

const DEFAULT_TRUST = 50;
const DEFAULT_TRUST_FLOOR = 20;
const DEFAULT_TRUST_CEILING = 100;

class TenantFabricService {

  // ─── Initialize Tenant ────────────────────────────────────────────────────────

  async initializeTenant(orgId: number): Promise<TenantAgentConfigEntry[]> {
    // Check if tenant already has configs
    const existing = await db
      .select()
      .from(tenantAgentConfig)
      .where(eq(tenantAgentConfig.orgId, orgId));

    if (existing.length > 0) {
      return existing;
    }

    // Get all registered agents
    const agents = await companyAgentService.getAll();
    const configs: TenantAgentConfigEntry[] = [];

    for (const agent of agents) {
      const [config] = await db.insert(tenantAgentConfig).values({
        orgId,
        agentCodename: agent.codename,
        trustScore: DEFAULT_TRUST,
        trustFloor: DEFAULT_TRUST_FLOOR,
        trustCeiling: DEFAULT_TRUST_CEILING,
        enabled: true,
        customPersonalityOverride: null,
        customQuotas: {},
        customPermissions: [],
      }).returning();

      configs.push(config);
    }

    return configs;
  }

  // ─── Get Tenant Config ────────────────────────────────────────────────────────

  async getTenantConfig(orgId: number, agentCodename: string): Promise<TenantAgentConfigEntry | null> {
    const [config] = await db
      .select()
      .from(tenantAgentConfig)
      .where(and(
        eq(tenantAgentConfig.orgId, orgId),
        eq(tenantAgentConfig.agentCodename, agentCodename),
      ))
      .limit(1);

    return config ?? null;
  }

  // ─── Update Tenant Config ─────────────────────────────────────────────────────

  async updateTenantConfig(
    orgId: number,
    agentCodename: string,
    updates: {
      trustScore?: number;
      trustFloor?: number;
      trustCeiling?: number;
      enabled?: boolean;
      customPersonalityOverride?: string | null;
      customQuotas?: Record<string, any>;
      customPermissions?: string[];
    },
  ): Promise<TenantAgentConfigEntry> {
    const config = await this.getTenantConfig(orgId, agentCodename);
    if (!config) throw new Error(`No config for org ${orgId} agent ${agentCodename}`);

    // Enforce trust bounds if trust score is being updated
    const setData: Record<string, any> = { updatedAt: new Date() };

    if (updates.trustFloor !== undefined) setData.trustFloor = updates.trustFloor;
    if (updates.trustCeiling !== undefined) setData.trustCeiling = updates.trustCeiling;
    if (updates.enabled !== undefined) setData.enabled = updates.enabled;
    if (updates.customPersonalityOverride !== undefined) setData.customPersonalityOverride = updates.customPersonalityOverride;
    if (updates.customQuotas !== undefined) setData.customQuotas = updates.customQuotas;
    if (updates.customPermissions !== undefined) setData.customPermissions = updates.customPermissions;

    if (updates.trustScore !== undefined) {
      const floor = updates.trustFloor ?? config.trustFloor;
      const ceiling = updates.trustCeiling ?? config.trustCeiling;
      setData.trustScore = Math.max(floor, Math.min(ceiling, updates.trustScore));
    }

    const [updated] = await db.update(tenantAgentConfig)
      .set(setData)
      .where(eq(tenantAgentConfig.id, config.id))
      .returning();

    return updated;
  }

  // ─── Enable / Disable Agent ───────────────────────────────────────────────────

  async enableAgent(orgId: number, agentCodename: string): Promise<TenantAgentConfigEntry> {
    return this.updateTenantConfig(orgId, agentCodename, { enabled: true });
  }

  async disableAgent(orgId: number, agentCodename: string): Promise<TenantAgentConfigEntry> {
    return this.updateTenantConfig(orgId, agentCodename, { enabled: false });
  }

  // ─── Tenant Trust ─────────────────────────────────────────────────────────────

  async getTenantTrust(orgId: number, agentCodename: string): Promise<number> {
    const config = await this.getTenantConfig(orgId, agentCodename);
    return config?.trustScore ?? DEFAULT_TRUST;
  }

  // ─── Adjust Tenant Trust ──────────────────────────────────────────────────────

  async adjustTenantTrust(
    orgId: number,
    agentCodename: string,
    delta: number,
  ): Promise<{ previousTrust: number; newTrust: number; floor: number; ceiling: number }> {
    const config = await this.getTenantConfig(orgId, agentCodename);
    if (!config) throw new Error(`No config for org ${orgId} agent ${agentCodename}`);

    const previousTrust = config.trustScore;
    const newTrust = Math.max(config.trustFloor, Math.min(config.trustCeiling, previousTrust + delta));

    await db.update(tenantAgentConfig)
      .set({ trustScore: newTrust, updatedAt: new Date() })
      .where(eq(tenantAgentConfig.id, config.id));

    return {
      previousTrust,
      newTrust,
      floor: config.trustFloor,
      ceiling: config.trustCeiling,
    };
  }

  // ─── Tenant Overview ──────────────────────────────────────────────────────────

  async getTenantOverview(orgId: number): Promise<{
    orgId: number;
    agents: TenantAgentConfigEntry[];
    enabledCount: number;
    disabledCount: number;
    avgTrust: number;
  }> {
    const agents = await db
      .select()
      .from(tenantAgentConfig)
      .where(eq(tenantAgentConfig.orgId, orgId))
      .orderBy(tenantAgentConfig.agentCodename);

    const enabledCount = agents.filter(a => a.enabled).length;
    const disabledCount = agents.length - enabledCount;
    const avgTrust = agents.length > 0
      ? Math.round(agents.reduce((sum, a) => sum + a.trustScore, 0) / agents.length)
      : 0;

    return { orgId, agents, enabledCount, disabledCount, avgTrust };
  }

  // ─── All Tenants ──────────────────────────────────────────────────────────────

  async getAllTenants(): Promise<{
    orgId: number;
    agentCount: number;
    enabledCount: number;
    avgTrust: number;
  }[]> {
    const allConfigs = await db
      .select()
      .from(tenantAgentConfig)
      .orderBy(tenantAgentConfig.orgId);

    const tenantMap: Record<number, TenantAgentConfigEntry[]> = {};
    for (const config of allConfigs) {
      if (!tenantMap[config.orgId]) tenantMap[config.orgId] = [];
      tenantMap[config.orgId].push(config);
    }

    return Object.entries(tenantMap).map(([orgIdStr, configs]) => {
      const orgId = parseInt(orgIdStr, 10);
      const enabledCount = configs.filter(c => c.enabled).length;
      const avgTrust = configs.length > 0
        ? Math.round(configs.reduce((sum, c) => sum + c.trustScore, 0) / configs.length)
        : 0;

      return { orgId, agentCount: configs.length, enabledCount, avgTrust };
    });
  }

  // ─── Set Trust Bounds ─────────────────────────────────────────────────────────

  async setTrustBounds(
    orgId: number,
    agentCodename: string,
    floor: number,
    ceiling: number,
  ): Promise<TenantAgentConfigEntry> {
    if (floor < 0 || floor > 100) throw new Error("Trust floor must be between 0 and 100");
    if (ceiling < 0 || ceiling > 100) throw new Error("Trust ceiling must be between 0 and 100");
    if (floor > ceiling) throw new Error("Trust floor cannot exceed ceiling");

    const config = await this.getTenantConfig(orgId, agentCodename);
    if (!config) throw new Error(`No config for org ${orgId} agent ${agentCodename}`);

    // Clamp existing trust score to new bounds
    const clampedTrust = Math.max(floor, Math.min(ceiling, config.trustScore));

    const [updated] = await db.update(tenantAgentConfig)
      .set({
        trustFloor: floor,
        trustCeiling: ceiling,
        trustScore: clampedTrust,
        updatedAt: new Date(),
      })
      .where(eq(tenantAgentConfig.id, config.id))
      .returning();

    return updated;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  async getStats(): Promise<{
    totalTenants: number;
    totalConfigs: number;
    avgAgentsEnabled: number;
    trustDistribution: {
      low: number;    // 0-33
      medium: number; // 34-66
      high: number;   // 67-100
    };
  }> {
    const allConfigs = await db.select().from(tenantAgentConfig);

    const tenantSet = new Set(allConfigs.map(c => c.orgId));
    const totalTenants = tenantSet.size;
    const enabledCount = allConfigs.filter(c => c.enabled).length;

    const trustDistribution = { low: 0, medium: 0, high: 0 };
    for (const config of allConfigs) {
      if (config.trustScore <= 33) trustDistribution.low++;
      else if (config.trustScore <= 66) trustDistribution.medium++;
      else trustDistribution.high++;
    }

    return {
      totalTenants,
      totalConfigs: allConfigs.length,
      avgAgentsEnabled: totalTenants > 0 ? Math.round(enabledCount / totalTenants) : 0,
      trustDistribution,
    };
  }
}

export const tenantFabricService = new TenantFabricService();
