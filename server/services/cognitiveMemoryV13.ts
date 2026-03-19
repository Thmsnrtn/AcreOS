// @ts-nocheck
/**
 * Cognitive Memory Layer — Sovereign Company Protocol v13
 *
 * Three-tier memory architecture for autonomous agents: episodic (experiences),
 * semantic (extracted facts), and working (short-term key-value with TTL).
 * Includes consolidation ("sleep") for pattern extraction and memory decay.
 */

import { db } from "../db";
import {
  agentEpisodicMemory, agentSemanticMemory, agentWorkingMemoryV13, memoryAccessLog,
  type AgentEpisodicMemoryEntry, type AgentSemanticMemoryEntry, type AgentWorkingMemoryEntry,
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql, inArray, like } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecordEpisodeData {
  action: string;
  outcome: string;
  outcomeSuccess: boolean;
  context: Record<string, any>;
  emotionalValence?: number;
  relatedEntities?: Array<{ type: string; id: string; name?: string }>;
  tags?: string[];
  orgId?: number;
}

interface RecallEpisodesQuery {
  tags?: string[];
  entityType?: string;
  entityId?: string;
  minRelevance?: number;
  limit?: number;
}

interface ExtractFactData {
  fact: string;
  category: string;
  sourceEpisodes: string[];
  confidence?: number;
  orgId?: number;
}

interface QueryFactsQuery {
  category?: string;
  minConfidence?: number;
  includeShared?: boolean;
  limit?: number;
}

interface ConsolidationResult {
  factsCreated: number;
  episodesDecayed: number;
  episodesArchived: number;
}

interface MemoryStats {
  episodicCount: number;
  semanticCount: number;
  workingCount: number;
  avgRelevance: number;
  topCategories: Array<{ category: string; count: number }>;
  memoryByAgent?: Array<{
    agent: string;
    episodic: number;
    semantic: number;
    working: number;
  }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class CognitiveMemoryService {
  /** Store an episodic memory with a unique UUID episodeId. */
  async recordEpisode(agentCodename: string, data: RecordEpisodeData): Promise<AgentEpisodicMemoryEntry> {
    const [entry] = await db.insert(agentEpisodicMemory).values({
      agentCodename, episodeId: crypto.randomUUID(),
      action: data.action, outcome: data.outcome, outcomeSuccess: data.outcomeSuccess,
      context: data.context, emotionalValence: data.emotionalValence ?? 0,
      relatedEntities: data.relatedEntities ?? [], tags: data.tags ?? [],
      relevanceScore: 100, accessCount: 0, orgId: data.orgId,
    }).returning();
    return entry;
  }

  /** Find episodes matching filters, boost relevance, increment accessCount, log access. */
  async recallEpisodes(agentCodename: string, query: RecallEpisodesQuery): Promise<AgentEpisodicMemoryEntry[]> {
    const conditions = [eq(agentEpisodicMemory.agentCodename, agentCodename)];
    if (query.minRelevance) conditions.push(gte(agentEpisodicMemory.relevanceScore, query.minRelevance));

    let results = await db.select().from(agentEpisodicMemory)
      .where(and(...conditions))
      .orderBy(desc(agentEpisodicMemory.relevanceScore))
      .limit(query.limit ?? 50);

    // Filter by tags (JSONB array overlap — applied in-memory)
    if (query.tags?.length) {
      results = results.filter((ep) =>
        query.tags!.some((t) => (ep.tags as string[]).includes(t)));
    }
    // Filter by entity type/id
    if (query.entityType || query.entityId) {
      results = results.filter((ep) =>
        (ep.relatedEntities as Array<{ type: string; id: string }>).some((e) => {
          if (query.entityType && query.entityId) return e.type === query.entityType && e.id === query.entityId;
          return query.entityType ? e.type === query.entityType : e.id === query.entityId;
        }));
    }

    if (results.length > 0) {
      const ids = results.map((r) => r.id);
      await db.update(agentEpisodicMemory).set({
        relevanceScore: sql`${agentEpisodicMemory.relevanceScore} + 2`,
        accessCount: sql`${agentEpisodicMemory.accessCount} + 1`,
        lastAccessedAt: new Date(),
      }).where(inArray(agentEpisodicMemory.id, ids));

      await db.insert(memoryAccessLog).values(results.map((r) => ({
        agentCodename, memoryType: "episodic", memoryId: r.episodeId,
        query: JSON.stringify(query), relevanceReturned: r.relevanceScore,
      })));
    }
    return results;
  }

  /** Create or reinforce a semantic memory (same category + exact fact text = reinforce). */
  async extractFact(agentCodename: string, data: ExtractFactData): Promise<AgentSemanticMemoryEntry> {
    const [existing] = await db.select().from(agentSemanticMemory).where(and(
      eq(agentSemanticMemory.agentCodename, agentCodename),
      eq(agentSemanticMemory.category, data.category),
      eq(agentSemanticMemory.fact, data.fact),
    )).limit(1);

    if (existing) {
      const mergedSources = [...new Set([...(existing.sourceEpisodes as string[]), ...data.sourceEpisodes])];
      const newCount = existing.reinforcementCount + 1;
      const [updated] = await db.update(agentSemanticMemory).set({
        reinforcementCount: newCount,
        sourceEpisodes: mergedSources,
        confidence: Math.min(100, existing.confidence + Math.floor(10 / newCount)),
        updatedAt: new Date(),
      }).where(eq(agentSemanticMemory.id, existing.id)).returning();
      return updated;
    }

    const [entry] = await db.insert(agentSemanticMemory).values({
      agentCodename, factId: crypto.randomUUID(), fact: data.fact,
      category: data.category, confidence: data.confidence ?? 50,
      sourceEpisodes: data.sourceEpisodes, reinforcementCount: 1,
      contradictionCount: 0, decayScore: 100, isShared: false,
      sharedWithAgents: [], orgId: data.orgId,
    }).returning();
    return entry;
  }

  /** Query semantic memories. If includeShared, also return facts shared with this agent. */
  async queryFacts(agentCodename: string, query: QueryFactsQuery): Promise<AgentSemanticMemoryEntry[]> {
    const limit = query.limit ?? 50;
    const ownConditions = [eq(agentSemanticMemory.agentCodename, agentCodename)];
    if (query.category) ownConditions.push(eq(agentSemanticMemory.category, query.category));
    if (query.minConfidence) ownConditions.push(gte(agentSemanticMemory.confidence, query.minConfidence));

    const results = await db.select().from(agentSemanticMemory)
      .where(and(...ownConditions)).orderBy(desc(agentSemanticMemory.confidence)).limit(limit);

    if (query.includeShared) {
      const sharedConditions = [
        eq(agentSemanticMemory.isShared, true),
        sql`${agentSemanticMemory.sharedWithAgents}::jsonb @> ${JSON.stringify([agentCodename])}::jsonb`,
      ];
      if (query.category) sharedConditions.push(eq(agentSemanticMemory.category, query.category));
      if (query.minConfidence) sharedConditions.push(gte(agentSemanticMemory.confidence, query.minConfidence));

      const sharedFacts = await db.select().from(agentSemanticMemory)
        .where(and(...sharedConditions)).orderBy(desc(agentSemanticMemory.confidence)).limit(limit);

      const seenIds = new Set(results.map((r) => r.id));
      for (const fact of sharedFacts) {
        if (!seenIds.has(fact.id)) { results.push(fact); seenIds.add(fact.id); }
      }
    }

    if (results.length > 0) {
      await db.insert(memoryAccessLog).values(results.map((r) => ({
        agentCodename, memoryType: "semantic", memoryId: r.factId,
        query: JSON.stringify(query), relevanceReturned: r.confidence,
      })));
    }
    return results;
  }

  /** Mark a semantic memory as shared and add agents to sharedWithAgents. */
  async shareFact(factId: number, withAgents: string[]): Promise<AgentSemanticMemoryEntry | null> {
    const [existing] = await db.select().from(agentSemanticMemory)
      .where(eq(agentSemanticMemory.id, factId)).limit(1);
    if (!existing) return null;

    const merged = [...new Set([...(existing.sharedWithAgents as string[]), ...withAgents])];
    const [updated] = await db.update(agentSemanticMemory).set({
      isShared: true, sharedWithAgents: merged, updatedAt: new Date(),
    }).where(eq(agentSemanticMemory.id, factId)).returning();
    return updated;
  }

  /** Upsert a working memory entry. Calculate expiresAt from now + ttlSeconds. */
  async setWorkingMemory(
    agentCodename: string, key: string, value: any,
    ttlSeconds: number = 3600, sagaId?: string, orgId?: number,
  ): Promise<AgentWorkingMemoryEntry> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const conditions = [
      eq(agentWorkingMemoryV13.agentCodename, agentCodename),
      eq(agentWorkingMemoryV13.key, key),
    ];
    if (sagaId) conditions.push(eq(agentWorkingMemoryV13.sagaId, sagaId));

    const [existing] = await db.select().from(agentWorkingMemoryV13)
      .where(and(...conditions)).limit(1);

    if (existing) {
      const [updated] = await db.update(agentWorkingMemoryV13)
        .set({ value, ttlSeconds, expiresAt })
        .where(eq(agentWorkingMemoryV13.id, existing.id)).returning();
      return updated;
    }

    const [entry] = await db.insert(agentWorkingMemoryV13).values({
      agentCodename, key, value, ttlSeconds, expiresAt,
      sagaId: sagaId ?? null, orgId: orgId ?? null,
    }).returning();
    return entry;
  }

  /** Get working memory value. Return null if expired. */
  async getWorkingMemory(agentCodename: string, key: string, sagaId?: string): Promise<AgentWorkingMemoryEntry | null> {
    const conditions = [
      eq(agentWorkingMemoryV13.agentCodename, agentCodename),
      eq(agentWorkingMemoryV13.key, key),
    ];
    if (sagaId) conditions.push(eq(agentWorkingMemoryV13.sagaId, sagaId));

    const [entry] = await db.select().from(agentWorkingMemoryV13)
      .where(and(...conditions)).limit(1);
    if (!entry || new Date(entry.expiresAt) < new Date()) return null;
    return entry;
  }

  /** Delete all expired working memory entries. Return count deleted. */
  async clearExpiredWorkingMemory(): Promise<number> {
    const deleted = await db.delete(agentWorkingMemoryV13)
      .where(lte(agentWorkingMemoryV13.expiresAt, new Date())).returning();
    return deleted.length;
  }

  /** The "sleep" function — consolidate recent episodes into semantic facts, apply decay. */
  async consolidateMemories(agentCodename: string): Promise<ConsolidationResult> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let factsCreated = 0;

    // Find recent episodes and group by tags
    const recentEpisodes = await db.select().from(agentEpisodicMemory).where(and(
      eq(agentEpisodicMemory.agentCodename, agentCodename),
      gte(agentEpisodicMemory.createdAt, dayAgo),
    ));

    const tagGroups = new Map<string, AgentEpisodicMemoryEntry[]>();
    for (const ep of recentEpisodes) {
      for (const tag of (ep.tags as string[])) {
        if (!tagGroups.has(tag)) tagGroups.set(tag, []);
        tagGroups.get(tag)!.push(ep);
      }
    }

    // For groups of 3+ episodes with same tag, create a semantic fact
    for (const [tag, episodes] of tagGroups) {
      if (episodes.length < 3) continue;
      const successRate = Math.round((episodes.filter((e) => e.outcomeSuccess).length / episodes.length) * 100);
      const actions = [...new Set(episodes.map((e) => e.action))];

      await this.extractFact(agentCodename, {
        fact: `Pattern observed for "${tag}": ${episodes.length} episodes, ${successRate}% success rate. Common actions: ${actions.slice(0, 3).join(", ")}`,
        category: "auto_consolidated",
        sourceEpisodes: episodes.map((e) => e.episodeId),
        confidence: Math.min(90, 40 + successRate / 2),
      });
      factsCreated++;
    }

    // Decay: reduce relevanceScore by 5 for episodes older than 7 days
    const decayResult = await db.update(agentEpisodicMemory).set({
      relevanceScore: sql`${agentEpisodicMemory.relevanceScore} - 5`,
    }).where(and(
      eq(agentEpisodicMemory.agentCodename, agentCodename),
      lte(agentEpisodicMemory.createdAt, weekAgo),
    )).returning();

    // Archive (delete) episodes with relevanceScore below 10
    const archiveResult = await db.delete(agentEpisodicMemory).where(and(
      eq(agentEpisodicMemory.agentCodename, agentCodename),
      lte(agentEpisodicMemory.relevanceScore, 10),
    )).returning();

    return { factsCreated, episodesDecayed: decayResult.length, episodesArchived: archiveResult.length };
  }

  /** Return counts and stats for episodic/semantic/working memories. */
  async getMemoryStats(agentCodename?: string): Promise<MemoryStats> {
    const epFilter = agentCodename ? eq(agentEpisodicMemory.agentCodename, agentCodename) : undefined;
    const semFilter = agentCodename ? eq(agentSemanticMemory.agentCodename, agentCodename) : undefined;
    const wkFilter = agentCodename ? eq(agentWorkingMemoryV13.agentCodename, agentCodename) : undefined;

    const [episodicRow] = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentEpisodicMemory).where(epFilter);
    const [semanticRow] = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentSemanticMemory).where(semFilter);
    const [workingRow] = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentWorkingMemoryV13).where(wkFilter);
    const [relevanceRow] = await db.select({ avg: sql<number>`coalesce(avg(${agentEpisodicMemory.relevanceScore}), 0)::int` })
      .from(agentEpisodicMemory).where(epFilter);

    const topCategories = await db.select({
      category: agentSemanticMemory.category, count: sql<number>`count(*)::int`,
    }).from(agentSemanticMemory).where(semFilter)
      .groupBy(agentSemanticMemory.category).orderBy(sql`count(*) desc`).limit(10);

    const stats: MemoryStats = {
      episodicCount: episodicRow.count, semanticCount: semanticRow.count,
      workingCount: workingRow.count, avgRelevance: relevanceRow.avg, topCategories,
    };

    // Per-agent breakdown when no specific agent requested
    if (!agentCodename) {
      const epByAgent = await db.select({ agent: agentEpisodicMemory.agentCodename, count: sql<number>`count(*)::int` })
        .from(agentEpisodicMemory).groupBy(agentEpisodicMemory.agentCodename);
      const semByAgent = await db.select({ agent: agentSemanticMemory.agentCodename, count: sql<number>`count(*)::int` })
        .from(agentSemanticMemory).groupBy(agentSemanticMemory.agentCodename);
      const wkByAgent = await db.select({ agent: agentWorkingMemoryV13.agentCodename, count: sql<number>`count(*)::int` })
        .from(agentWorkingMemoryV13).groupBy(agentWorkingMemoryV13.agentCodename);

      const agentMap = new Map<string, { episodic: number; semantic: number; working: number }>();
      for (const r of epByAgent) agentMap.set(r.agent, { episodic: r.count, semantic: 0, working: 0 });
      for (const r of semByAgent) {
        const e = agentMap.get(r.agent) ?? { episodic: 0, semantic: 0, working: 0 };
        e.semantic = r.count; agentMap.set(r.agent, e);
      }
      for (const r of wkByAgent) {
        const e = agentMap.get(r.agent) ?? { episodic: 0, semantic: 0, working: 0 };
        e.working = r.count; agentMap.set(r.agent, e);
      }
      stats.memoryByAgent = Array.from(agentMap.entries()).map(([agent, counts]) => ({ agent, ...counts }));
    }
    return stats;
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const cognitiveMemoryService = new CognitiveMemoryService();
