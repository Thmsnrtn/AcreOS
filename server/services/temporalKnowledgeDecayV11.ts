// @ts-nocheck
/**
 * Temporal Knowledge Decay — Sovereign Company Protocol v11
 *
 * Institutional memory gets a freshness score:
 * - Patterns decay over time (configurable half-life: 90 days default)
 * - High-confidence patterns decay slower
 * - "Zombie pattern detection" — still being used but not validated in 6+ months
 * - Seasonal awareness — Q4 patterns don't decay during Q4
 * - Knowledge lineage: which patterns evolved from which
 */

import { db } from "../db";
import { knowledgeFreshness, type KnowledgeFreshnessEntry } from "@shared/schema";
import { eq, desc, and, lte, gte, sql, count } from "drizzle-orm";

class TemporalKnowledgeDecayService {

  /**
   * Register a pattern for freshness tracking.
   */
  async registerPattern(params: {
    patternId: string;
    patternName: string;
    sourceAgent: string;
    halfLifeDays?: number;
    seasonalTags?: string[];
    lineageParentId?: string;
  }): Promise<KnowledgeFreshnessEntry> {
    const [entry] = await db.insert(knowledgeFreshness).values({
      patternId: params.patternId,
      patternName: params.patternName,
      sourceAgent: params.sourceAgent,
      halfLifeDays: params.halfLifeDays || 90,
      seasonalTags: params.seasonalTags || [],
      lineageParentId: params.lineageParentId || null,
      freshnessScore: "100",
    }).returning();
    return entry;
  }

  /**
   * Run the decay cycle — update all patterns' freshness scores.
   */
  async runDecayCycle(): Promise<{ decayed: number; zombiesDetected: number; archived: number }> {
    const patterns = await db.select().from(knowledgeFreshness)
      .where(sql`${knowledgeFreshness.status} IN ('active', 'decaying')`);

    const now = new Date();
    const currentQuarter = `Q${Math.ceil((now.getMonth() + 1) / 3)}`;
    let decayed = 0;
    let zombiesDetected = 0;
    let archived = 0;

    for (const pattern of patterns) {
      // Check seasonal protection
      const isSeasonallyProtected = (pattern.seasonalTags || []).includes(currentQuarter);
      if (isSeasonallyProtected) continue;

      // Calculate decay
      const daysSinceValidation = (now.getTime() - new Date(pattern.lastValidatedAt).getTime()) / 86400000;
      const halfLife = pattern.halfLifeDays;

      // Exponential decay: freshness = 100 * (0.5 ^ (days / halfLife))
      const newFreshness = Math.round(100 * Math.pow(0.5, daysSinceValidation / halfLife) * 10) / 10;

      // Determine new status
      let newStatus = pattern.status;
      if (newFreshness < 20) {
        newStatus = "stale";
        if (newFreshness < 5) {
          newStatus = "archived";
          archived++;
        }
      } else if (newFreshness < 50) {
        newStatus = "decaying";
      }

      // Zombie detection: used recently but not validated in 6+ months
      const daysSinceLastUse = pattern.lastUsedAt
        ? (now.getTime() - new Date(pattern.lastUsedAt).getTime()) / 86400000
        : Infinity;
      const isZombie = daysSinceValidation > 180 && daysSinceLastUse < 30;
      if (isZombie && !pattern.isZombie) zombiesDetected++;

      if (newFreshness !== Number(pattern.freshnessScore) || isZombie !== pattern.isZombie || newStatus !== pattern.status) {
        await db.update(knowledgeFreshness)
          .set({
            freshnessScore: String(newFreshness),
            status: newStatus,
            isZombie,
            updatedAt: now,
          })
          .where(eq(knowledgeFreshness.id, pattern.id));
        decayed++;
      }
    }

    return { decayed, zombiesDetected, archived };
  }

  /**
   * Record that a pattern was used (resets usage tracking, not freshness).
   */
  async recordUsage(patternId: string): Promise<void> {
    const [pattern] = await db.select().from(knowledgeFreshness)
      .where(eq(knowledgeFreshness.patternId, patternId)).limit(1);
    if (!pattern) return;

    await db.update(knowledgeFreshness)
      .set({
        lastUsedAt: new Date(),
        usageCount: pattern.usageCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeFreshness.id, pattern.id));
  }

  /**
   * Revalidate a pattern — resets freshness to 100.
   */
  async revalidate(patternId: string): Promise<void> {
    await db.update(knowledgeFreshness)
      .set({
        freshnessScore: "100",
        lastValidatedAt: new Date(),
        status: "active",
        isZombie: false,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeFreshness.patternId, patternId));
  }

  /**
   * Get zombie patterns — still used but not validated.
   */
  async getZombiePatterns(): Promise<KnowledgeFreshnessEntry[]> {
    return db.select().from(knowledgeFreshness)
      .where(eq(knowledgeFreshness.isZombie, true))
      .orderBy(desc(knowledgeFreshness.usageCount));
  }

  /**
   * Get stale patterns needing revalidation.
   */
  async getStalePatterns(): Promise<KnowledgeFreshnessEntry[]> {
    return db.select().from(knowledgeFreshness)
      .where(eq(knowledgeFreshness.status, "stale"))
      .orderBy(knowledgeFreshness.freshnessScore);
  }

  /**
   * Get pattern lineage tree.
   */
  async getLineage(patternId: string): Promise<KnowledgeFreshnessEntry[]> {
    const lineage: KnowledgeFreshnessEntry[] = [];
    let currentId: string | null = patternId;

    while (currentId) {
      const [pattern] = await db.select().from(knowledgeFreshness)
        .where(eq(knowledgeFreshness.patternId, currentId)).limit(1);
      if (!pattern) break;
      lineage.push(pattern);
      currentId = pattern.lineageParentId;
    }

    return lineage.reverse();
  }

  async getAll(limit = 50): Promise<KnowledgeFreshnessEntry[]> {
    return db.select().from(knowledgeFreshness)
      .orderBy(desc(knowledgeFreshness.updatedAt)).limit(limit);
  }

  async getByAgent(agentCodename: string): Promise<KnowledgeFreshnessEntry[]> {
    return db.select().from(knowledgeFreshness)
      .where(eq(knowledgeFreshness.sourceAgent, agentCodename))
      .orderBy(desc(knowledgeFreshness.freshnessScore));
  }

  async getStats(): Promise<{
    total: number; active: number; decaying: number; stale: number;
    archived: number; zombies: number; avgFreshness: number;
  }> {
    const all = await db.select().from(knowledgeFreshness);
    const active = all.filter(p => p.status === "active").length;
    const decaying = all.filter(p => p.status === "decaying").length;
    const stale = all.filter(p => p.status === "stale").length;
    const archived = all.filter(p => p.status === "archived").length;
    const zombies = all.filter(p => p.isZombie).length;
    const avgFreshness = all.length > 0
      ? Math.round(all.reduce((s, p) => s + Number(p.freshnessScore), 0) / all.length)
      : 0;

    return { total: all.length, active, decaying, stale, archived, zombies, avgFreshness };
  }
}

export const temporalKnowledgeDecayService = new TemporalKnowledgeDecayService();
