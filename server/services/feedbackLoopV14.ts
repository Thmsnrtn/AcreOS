// @ts-nocheck
/**
 * Feedback Loop Processor — Sovereign Company Protocol v14
 *
 * "The Self-Running Company"
 *
 * When the founder overrides an autonomous decision, this service captures it
 * as a learning signal and propagates the lesson across memory, strategy, and
 * governance. The goal: every override teaches the system so the same mistake
 * is never repeated.
 *
 * Flow: Override → Pattern Detection → Learning Extraction → Propagation
 */

import { db } from "../db";
import {
  founderOverrides,
  feedbackLearnings,
  type FounderOverrideEntry,
  type FeedbackLearningEntry,
} from "@shared/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import crypto from "crypto";

import { cognitiveMemoryService } from "./cognitiveMemoryV13";
import { adaptiveStrategyService } from "./adaptiveStrategyV13";
import { governanceBrainService } from "./governanceBrainV13";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecordOverrideData {
  originalDecisionId?: string;
  originalAction: string;
  founderAction: string;
  founderReason?: string;
  context?: Record<string, any>;
  agentCodename?: string;
  category: string;
}

interface OverrideFilters {
  category?: string;
  agentCodename?: string;
  learningExtracted?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
}

interface LearningFilters {
  status?: string;
  minConfidence?: number;
  category?: string;
}

interface ExtractedLearning {
  learningId: string;
  rule: string;
  ruleConfig: Record<string, any>;
  confidence: number;
  sourceOverrideCount: number;
}

interface PropagationSummary {
  learningId: string;
  memory: { applied: boolean; factId?: string };
  strategy: { applied: boolean; details?: string };
  governance: { applied: boolean; policyId?: string };
}

interface LearningImpact {
  learning: FeedbackLearningEntry;
  strategiesAdjusted: any[];
  policiesCreated: any[];
  factsStored: any[];
  overrideReduction: { before: number; after: number; percentChange: number };
}

interface OverrideAnalytics {
  totalOverrides: number;
  last7Days: number;
  last30Days: number;
  byCategory: Record<string, number>;
  weeklyTrend: Array<{ week: string; count: number }>;
  topLearnings: FeedbackLearningEntry[];
  blindSpots: string[];
  estimatedTimeSavedMinutes: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the set of top-level keys from a context object.
 * Used as a lightweight similarity signal between overrides.
 */
function contextKeySet(ctx: Record<string, any>): Set<string> {
  return new Set(Object.keys(ctx ?? {}));
}

/**
 * Compute key-overlap ratio between two context objects.
 * Returns 0-1 where 1 means identical key sets.
 */
function contextOverlap(a: Record<string, any>, b: Record<string, any>): number {
  const keysA = contextKeySet(a);
  const keysB = contextKeySet(b);
  if (keysA.size === 0 && keysB.size === 0) return 1;
  const union = new Set([...keysA, ...keysB]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const k of keysA) {
    if (keysB.has(k)) intersection++;
  }
  return intersection / union.size;
}

/**
 * Group overrides by (category + agentCodename) and then by context similarity.
 * Two overrides are "similar" if they share category, agentCodename, and have
 * context key overlap >= 0.5.
 */
function groupOverrides(
  overrides: FounderOverrideEntry[],
): Map<string, FounderOverrideEntry[]> {
  const groups = new Map<string, FounderOverrideEntry[]>();

  for (const override of overrides) {
    const baseKey = `${override.category}::${override.agentCodename ?? "unknown"}`;
    let placed = false;

    // Try to place into an existing group with overlapping context
    for (const [key, members] of groups.entries()) {
      if (!key.startsWith(baseKey)) continue;
      const representative = members[0];
      const overlap = contextOverlap(
        representative.context as Record<string, any>,
        override.context as Record<string, any>,
      );
      if (overlap >= 0.5) {
        members.push(override);
        placed = true;
        break;
      }
    }

    if (!placed) {
      const groupKey = `${baseKey}::${crypto.randomUUID().slice(0, 8)}`;
      groups.set(groupKey, [override]);
    }
  }

  return groups;
}

/**
 * Generate a human-readable rule from a group of overrides.
 */
function synthesizeRule(overrides: FounderOverrideEntry[]): string {
  const category = overrides[0].category;
  const agent = overrides[0].agentCodename ?? "system";
  const founderActions = [...new Set(overrides.map((o) => o.founderAction))];
  const originalActions = [...new Set(overrides.map((o) => o.originalAction))];

  if (founderActions.length === 1) {
    return `Founder consistently overrides ${agent} in category "${category}": replaces "${originalActions[0]}" with "${founderActions[0]}"`;
  }
  return `Founder overrides ${agent} in category "${category}" — original actions (${originalActions.join(", ")}) are replaced with alternatives`;
}

/**
 * Generate a machine-readable ruleConfig from a group of overrides.
 */
function synthesizeRuleConfig(overrides: FounderOverrideEntry[]): Record<string, any> {
  const founderActions = [...new Set(overrides.map((o) => o.founderAction))];
  const originalActions = [...new Set(overrides.map((o) => o.originalAction))];
  const category = overrides[0].category;
  const agent = overrides[0].agentCodename ?? "unknown";

  // Collect common context keys and their most-frequent values
  const contextFrequency: Record<string, Record<string, number>> = {};
  for (const o of overrides) {
    const ctx = (o.context ?? {}) as Record<string, any>;
    for (const [k, v] of Object.entries(ctx)) {
      if (!contextFrequency[k]) contextFrequency[k] = {};
      const sv = String(v);
      contextFrequency[k][sv] = (contextFrequency[k][sv] ?? 0) + 1;
    }
  }

  // Pick context values that appear in >= 50% of overrides
  const threshold = overrides.length / 2;
  const commonContext: Record<string, any> = {};
  for (const [k, vals] of Object.entries(contextFrequency)) {
    for (const [v, count] of Object.entries(vals)) {
      if (count >= threshold) {
        if (!commonContext[k]) commonContext[k] = { $in: [] };
        commonContext[k].$in.push(v);
      }
    }
  }

  return {
    block_original_actions: originalActions,
    prefer_actions: founderActions,
    agent_codename: agent,
    category,
    when_context: commonContext,
  };
}

/**
 * Calculate confidence from override consistency.
 * All overrides with the same founderAction = highest confidence.
 */
function calculateConfidence(overrides: FounderOverrideEntry[]): number {
  const actions = overrides.map((o) => o.founderAction);
  const uniqueActions = new Set(actions);
  const consistency = 1 / uniqueActions.size;
  const volumeBonus = Math.min(overrides.length / 10, 0.2);
  return Math.min(0.95, consistency * 0.7 + volumeBonus + 0.1);
}

// ─── Service ──────────────────────────────────────────────────────────────────

class FeedbackLoopService {
  // ─── 1. Record Override ───────────────────────────────────────────────────────

  async recordOverride(
    orgId: number,
    data: RecordOverrideData,
  ): Promise<FounderOverrideEntry> {
    const overrideId = crypto.randomUUID();

    const [entry] = await db
      .insert(founderOverrides)
      .values({
        overrideId,
        orgId,
        originalDecisionId: data.originalDecisionId ?? null,
        originalAction: data.originalAction,
        founderAction: data.founderAction,
        founderReason: data.founderReason ?? null,
        context: data.context ?? {},
        agentCodename: data.agentCodename ?? null,
        category: data.category,
        learningExtracted: false,
      })
      .returning();

    return entry;
  }

  // ─── 2. Get Overrides ─────────────────────────────────────────────────────────

  async getOverrides(
    orgId: number,
    filters?: OverrideFilters,
  ): Promise<FounderOverrideEntry[]> {
    const conditions = [eq(founderOverrides.orgId, orgId)];

    if (filters?.category) {
      conditions.push(eq(founderOverrides.category, filters.category));
    }
    if (filters?.agentCodename) {
      conditions.push(eq(founderOverrides.agentCodename, filters.agentCodename));
    }
    if (filters?.learningExtracted !== undefined) {
      conditions.push(eq(founderOverrides.learningExtracted, filters.learningExtracted));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(founderOverrides.createdAt, filters.dateFrom));
    }
    if (filters?.dateTo) {
      conditions.push(lte(founderOverrides.createdAt, filters.dateTo));
    }

    return db
      .select()
      .from(founderOverrides)
      .where(and(...conditions))
      .orderBy(desc(founderOverrides.createdAt));
  }

  // ─── 3. Get Override Details ──────────────────────────────────────────────────

  async getOverrideDetails(overrideId: string): Promise<FounderOverrideEntry | null> {
    const [entry] = await db
      .select()
      .from(founderOverrides)
      .where(eq(founderOverrides.overrideId, overrideId))
      .limit(1);

    return entry ?? null;
  }

  // ─── 4. Extract Learnings ─────────────────────────────────────────────────────

  async extractLearnings(orgId: number): Promise<ExtractedLearning[]> {
    // Fetch all unprocessed overrides
    const unprocessed = await db
      .select()
      .from(founderOverrides)
      .where(
        and(
          eq(founderOverrides.orgId, orgId),
          eq(founderOverrides.learningExtracted, false),
        ),
      )
      .orderBy(desc(founderOverrides.createdAt));

    if (unprocessed.length === 0) return [];

    // Group by category + agentCodename + context similarity
    const groups = groupOverrides(unprocessed);
    const learnings: ExtractedLearning[] = [];

    for (const [, members] of groups) {
      const overrideIds = members.map((m) => m.overrideId);

      let rule: string;
      let ruleConfig: Record<string, any>;
      let confidence: number;

      if (members.length >= 2) {
        // Multi-override pattern: high-confidence learning
        rule = synthesizeRule(members);
        ruleConfig = synthesizeRuleConfig(members);
        confidence = calculateConfidence(members);
      } else {
        // Single override: low-confidence signal
        const single = members[0];
        rule = `Signal: founder overrode ${single.agentCodename ?? "system"} action "${single.originalAction}" with "${single.founderAction}" in category "${single.category}"`;
        ruleConfig = {
          signal: true,
          original_action: single.originalAction,
          founder_action: single.founderAction,
          category: single.category,
          agent_codename: single.agentCodename ?? "unknown",
        };
        confidence = 0.3;
      }

      const learningId = crypto.randomUUID();

      const [learning] = await db
        .insert(feedbackLearnings)
        .values({
          learningId,
          orgId,
          rule,
          ruleConfig,
          sourceOverrideIds: overrideIds,
          confidence,
          reinforcementCount: members.length,
          status: "active",
        })
        .returning();

      learnings.push({
        learningId: learning.learningId,
        rule: learning.rule,
        ruleConfig: learning.ruleConfig as Record<string, any>,
        confidence: learning.confidence,
        sourceOverrideCount: overrideIds.length,
      });

      // Mark all overrides in this group as extracted
      for (const oid of overrideIds) {
        await db
          .update(founderOverrides)
          .set({ learningExtracted: true })
          .where(eq(founderOverrides.overrideId, oid));
      }
    }

    return learnings;
  }

  // ─── 5. Reinforce Learning ────────────────────────────────────────────────────

  async reinforceLearning(learningId: string): Promise<FeedbackLearningEntry | null> {
    const [existing] = await db
      .select()
      .from(feedbackLearnings)
      .where(eq(feedbackLearnings.learningId, learningId))
      .limit(1);

    if (!existing || existing.status !== "active") return null;

    const newConfidence = existing.confidence + (1 - existing.confidence) * 0.15;
    const newCount = existing.reinforcementCount + 1;

    const [updated] = await db
      .update(feedbackLearnings)
      .set({
        confidence: Math.min(newConfidence, 1.0),
        reinforcementCount: newCount,
        updatedAt: new Date(),
      })
      .where(eq(feedbackLearnings.learningId, learningId))
      .returning();

    return updated;
  }

  // ─── 6. Propagate Learning ────────────────────────────────────────────────────

  async propagateLearning(learningId: string): Promise<PropagationSummary> {
    const [learning] = await db
      .select()
      .from(feedbackLearnings)
      .where(eq(feedbackLearnings.learningId, learningId))
      .limit(1);

    if (!learning) {
      throw new Error(`Learning not found: ${learningId}`);
    }

    const ruleConfig = learning.ruleConfig as Record<string, any>;
    const appliedToMemory = (learning.appliedToMemory ?? []) as any[];
    const appliedToStrategies = (learning.appliedToStrategies ?? []) as any[];
    const appliedToPolicies = (learning.appliedToPolicies ?? []) as any[];

    const summary: PropagationSummary = {
      learningId,
      memory: { applied: false },
      strategy: { applied: false },
      governance: { applied: false },
    };

    // a. Memory: create a semantic fact for the agent
    if (appliedToMemory.length === 0) {
      try {
        const agentCodename = ruleConfig.agent_codename ?? "system";
        const fact = await cognitiveMemoryService.extractFact(agentCodename, {
          fact: learning.rule,
          category: "founder_feedback",
          sourceEpisodes: (learning.sourceOverrideIds as string[]).slice(0, 5),
          confidence: Math.round(learning.confidence * 100),
          orgId: learning.orgId,
        });

        const newMemoryRef = { factId: fact.id, appliedAt: new Date().toISOString() };
        appliedToMemory.push(newMemoryRef);
        summary.memory = { applied: true, factId: String(fact.id) };
      } catch (err) {
        summary.memory = { applied: false };
      }
    } else {
      summary.memory = { applied: true, factId: String(appliedToMemory[0]?.factId) };
    }

    // b. Strategy: record a negative outcome for the overridden strategy
    if (appliedToStrategies.length === 0) {
      try {
        const sourceOverrideIds = learning.sourceOverrideIds as string[];
        if (sourceOverrideIds.length > 0) {
          const [sourceOverride] = await db
            .select()
            .from(founderOverrides)
            .where(eq(founderOverrides.overrideId, sourceOverrideIds[0]))
            .limit(1);

          if (sourceOverride?.originalDecisionId) {
            // The originalDecisionId might reference a strategy assignment
            const outcome = await adaptiveStrategyService.recordOutcome(
              parseInt(sourceOverride.originalDecisionId, 10) || 0,
              `Overridden by founder: ${learning.rule}`,
              0,
            );
            const stratRef = { assignmentId: sourceOverride.originalDecisionId, appliedAt: new Date().toISOString() };
            appliedToStrategies.push(stratRef);
            summary.strategy = { applied: true, details: `Recorded negative outcome for assignment ${sourceOverride.originalDecisionId}` };
          }
        }
      } catch (err) {
        summary.strategy = { applied: false };
      }
    } else {
      summary.strategy = { applied: true, details: "Already propagated" };
    }

    // c. Governance: create a soft policy if confidence is high enough
    if (appliedToPolicies.length === 0 && learning.confidence >= 0.7) {
      try {
        const category = ruleConfig.category ?? "general";
        const policy = await governanceBrainService.createPolicy({
          name: `Auto-learned: ${learning.rule.slice(0, 80)}`,
          category,
          ruleDsl: learning.rule,
          ruleConfig: ruleConfig,
          severity: "warning",
        });

        const policyRef = { policyId: policy.policyId, appliedAt: new Date().toISOString() };
        appliedToPolicies.push(policyRef);
        summary.governance = { applied: true, policyId: policy.policyId };
      } catch (err) {
        summary.governance = { applied: false };
      }
    } else if (appliedToPolicies.length > 0) {
      summary.governance = { applied: true, policyId: (appliedToPolicies[0] as any)?.policyId };
    }

    // Update the learning record with propagation references
    await db
      .update(feedbackLearnings)
      .set({
        appliedToMemory,
        appliedToStrategies,
        appliedToPolicies,
        updatedAt: new Date(),
      })
      .where(eq(feedbackLearnings.learningId, learningId));

    return summary;
  }

  // ─── 7. Propagate All Active ──────────────────────────────────────────────────

  async propagateAllActive(orgId: number): Promise<number> {
    // Find active learnings that haven't been fully propagated
    const activeLearnings = await db
      .select()
      .from(feedbackLearnings)
      .where(
        and(
          eq(feedbackLearnings.orgId, orgId),
          eq(feedbackLearnings.status, "active"),
        ),
      );

    let propagationCount = 0;

    for (const learning of activeLearnings) {
      const memoryDone = ((learning.appliedToMemory ?? []) as any[]).length > 0;
      const strategyDone = ((learning.appliedToStrategies ?? []) as any[]).length > 0;
      const policyDone = ((learning.appliedToPolicies ?? []) as any[]).length > 0;

      // Skip if fully propagated (memory done + policy done if confidence >= 0.7)
      const policyRequired = learning.confidence >= 0.7;
      if (memoryDone && strategyDone && (!policyRequired || policyDone)) {
        continue;
      }

      try {
        await this.propagateLearning(learning.learningId);
        propagationCount++;
      } catch {
        // Continue with next learning on failure
      }
    }

    return propagationCount;
  }

  // ─── 8. Get Learnings ─────────────────────────────────────────────────────────

  async getLearnings(
    orgId: number,
    filters?: LearningFilters,
  ): Promise<(FeedbackLearningEntry & { sourceOverrideCount: number })[]> {
    const conditions = [eq(feedbackLearnings.orgId, orgId)];

    if (filters?.status) {
      conditions.push(eq(feedbackLearnings.status, filters.status));
    }
    if (filters?.minConfidence !== undefined) {
      conditions.push(gte(feedbackLearnings.confidence, filters.minConfidence));
    }

    const rows = await db
      .select()
      .from(feedbackLearnings)
      .where(and(...conditions))
      .orderBy(desc(feedbackLearnings.confidence));

    // Filter by category if provided (category lives in ruleConfig)
    let filtered = rows;
    if (filters?.category) {
      filtered = rows.filter((r) => {
        const cfg = r.ruleConfig as Record<string, any>;
        return cfg?.category === filters.category;
      });
    }

    return filtered.map((r) => ({
      ...r,
      sourceOverrideCount: ((r.sourceOverrideIds ?? []) as string[]).length,
    }));
  }

  // ─── 9. Retract Learning ──────────────────────────────────────────────────────

  async retractLearning(
    learningId: string,
    reason?: string,
  ): Promise<FeedbackLearningEntry | null> {
    const [existing] = await db
      .select()
      .from(feedbackLearnings)
      .where(eq(feedbackLearnings.learningId, learningId))
      .limit(1);

    if (!existing) return null;

    const ruleConfig = existing.ruleConfig as Record<string, any>;
    const updatedConfig = {
      ...ruleConfig,
      retracted: true,
      retractedAt: new Date().toISOString(),
      retractedReason: reason ?? "Founder disagreed with extracted rule",
    };

    const [updated] = await db
      .update(feedbackLearnings)
      .set({
        status: "retracted",
        ruleConfig: updatedConfig,
        updatedAt: new Date(),
      })
      .where(eq(feedbackLearnings.learningId, learningId))
      .returning();

    return updated;
  }

  // ─── 10. Get Learning Impact ──────────────────────────────────────────────────

  async getLearningImpact(learningId: string): Promise<LearningImpact> {
    const [learning] = await db
      .select()
      .from(feedbackLearnings)
      .where(eq(feedbackLearnings.learningId, learningId))
      .limit(1);

    if (!learning) {
      throw new Error(`Learning not found: ${learningId}`);
    }

    const ruleConfig = learning.ruleConfig as Record<string, any>;
    const category = ruleConfig.category ?? "unknown";
    const agentCodename = ruleConfig.agent_codename ?? null;

    // Cross-reference: count overrides of this type before and after learning creation
    const beforeConditions = [
      eq(founderOverrides.orgId, learning.orgId),
      eq(founderOverrides.category, category),
      lte(founderOverrides.createdAt, learning.createdAt),
    ];
    if (agentCodename) {
      beforeConditions.push(eq(founderOverrides.agentCodename, agentCodename));
    }

    const [beforeCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(founderOverrides)
      .where(and(...beforeConditions));

    const afterConditions = [
      eq(founderOverrides.orgId, learning.orgId),
      eq(founderOverrides.category, category),
      gte(founderOverrides.createdAt, learning.createdAt),
    ];
    if (agentCodename) {
      afterConditions.push(eq(founderOverrides.agentCodename, agentCodename));
    }

    const [afterCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(founderOverrides)
      .where(and(...afterConditions));

    const before = beforeCount?.count ?? 0;
    const after = afterCount?.count ?? 0;
    const percentChange = before > 0 ? ((after - before) / before) * 100 : 0;

    return {
      learning,
      strategiesAdjusted: (learning.appliedToStrategies ?? []) as any[],
      policiesCreated: (learning.appliedToPolicies ?? []) as any[],
      factsStored: (learning.appliedToMemory ?? []) as any[],
      overrideReduction: {
        before,
        after,
        percentChange: Math.round(percentChange * 100) / 100,
      },
    };
  }

  // ─── 11. Override Analytics ───────────────────────────────────────────────────

  async getOverrideAnalytics(orgId: number): Promise<OverrideAnalytics> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Total overrides (all time)
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(founderOverrides)
      .where(eq(founderOverrides.orgId, orgId));

    // Last 7 days
    const [last7Result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(founderOverrides)
      .where(
        and(
          eq(founderOverrides.orgId, orgId),
          gte(founderOverrides.createdAt, sevenDaysAgo),
        ),
      );

    // Last 30 days
    const [last30Result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(founderOverrides)
      .where(
        and(
          eq(founderOverrides.orgId, orgId),
          gte(founderOverrides.createdAt, thirtyDaysAgo),
        ),
      );

    // Override rate by category
    const categoryRows = await db
      .select({
        category: founderOverrides.category,
        count: sql<number>`count(*)::int`,
      })
      .from(founderOverrides)
      .where(eq(founderOverrides.orgId, orgId))
      .groupBy(founderOverrides.category)
      .orderBy(sql`count(*) desc`);

    const byCategory: Record<string, number> = {};
    for (const row of categoryRows) {
      byCategory[row.category] = row.count;
    }

    // Weekly trend (last 12 weeks)
    const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
    const weeklyRows = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${founderOverrides.createdAt}), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(founderOverrides)
      .where(
        and(
          eq(founderOverrides.orgId, orgId),
          gte(founderOverrides.createdAt, twelveWeeksAgo),
        ),
      )
      .groupBy(sql`date_trunc('week', ${founderOverrides.createdAt})`)
      .orderBy(sql`date_trunc('week', ${founderOverrides.createdAt}) asc`);

    const weeklyTrend = weeklyRows.map((r) => ({
      week: r.week,
      count: r.count,
    }));

    // Top 5 learning rules by confidence
    const topLearnings = await db
      .select()
      .from(feedbackLearnings)
      .where(
        and(
          eq(feedbackLearnings.orgId, orgId),
          eq(feedbackLearnings.status, "active"),
        ),
      )
      .orderBy(desc(feedbackLearnings.confidence))
      .limit(5);

    // Categories with no learnings yet (blind spots)
    const allCategories = Object.keys(byCategory);
    const learnedCategories = new Set<string>();
    const allLearnings = await db
      .select({ ruleConfig: feedbackLearnings.ruleConfig })
      .from(feedbackLearnings)
      .where(
        and(
          eq(feedbackLearnings.orgId, orgId),
          eq(feedbackLearnings.status, "active"),
        ),
      );

    for (const l of allLearnings) {
      const cfg = l.ruleConfig as Record<string, any>;
      if (cfg?.category) learnedCategories.add(cfg.category);
    }

    const blindSpots = allCategories.filter((c) => !learnedCategories.has(c));

    // Estimated founder time saved
    // Assume each override takes 5 minutes of founder time.
    // Count active learnings' reinforcement count beyond initial as "overrides avoided".
    const activeLearnings = await db
      .select({
        totalReinforcements: sql<number>`coalesce(sum(${feedbackLearnings.reinforcementCount}), 0)::int`,
        learningCount: sql<number>`count(*)::int`,
      })
      .from(feedbackLearnings)
      .where(
        and(
          eq(feedbackLearnings.orgId, orgId),
          eq(feedbackLearnings.status, "active"),
        ),
      );

    const totalReinforcements = activeLearnings[0]?.totalReinforcements ?? 0;
    const learningCount = activeLearnings[0]?.learningCount ?? 0;
    // Each reinforcement beyond the initial learning creation represents a potential avoided override
    const overridesAvoided = Math.max(0, totalReinforcements - learningCount);
    const avgDecisionTimeMinutes = 5;
    const estimatedTimeSavedMinutes = overridesAvoided * avgDecisionTimeMinutes;

    return {
      totalOverrides: totalResult?.count ?? 0,
      last7Days: last7Result?.count ?? 0,
      last30Days: last30Result?.count ?? 0,
      byCategory,
      weeklyTrend,
      topLearnings,
      blindSpots,
      estimatedTimeSavedMinutes,
    };
  }
}

export const feedbackLoopService = new FeedbackLoopService();
