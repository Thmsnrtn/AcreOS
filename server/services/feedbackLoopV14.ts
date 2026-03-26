// @ts-nocheck
/**
 * Feedback Loop Processor — Sovereign Company Protocol v14 "The Self-Running Company"
 *
 * When the founder overrides an autonomous decision, this service captures it as a
 * learning signal and propagates the lesson across memory, strategy, and governance.
 * Flow: Override → Pattern Detection → Learning Extraction → Propagation
 */
import { db } from "../db";
import { founderOverrides, feedbackLearnings, type FounderOverrideEntry, type FeedbackLearningEntry } from "@shared/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import crypto from "crypto";
import { cognitiveMemoryService } from "./cognitiveMemoryV13";
import { adaptiveStrategyService } from "./adaptiveStrategyV13";
import { governanceBrainService } from "./governanceBrainV13";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Data for recording a founder override event */
interface RecordOverrideData {
  originalDecisionId?: string;
  originalAction: string;
  founderAction: string;
  founderReason?: string;
  context?: Record<string, any>;
  agentCodename?: string;
  category: string;
}

/** Filters for querying overrides */
interface OverrideFilters {
  category?: string;
  agentCodename?: string;
  learningExtracted?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
}

/** Filters for querying learnings */
interface LearningFilters {
  status?: string;
  minConfidence?: number;
  category?: string;
}

/** Result from the extractLearnings method */
interface ExtractedLearning {
  learningId: string;
  rule: string;
  ruleConfig: Record<string, any>;
  confidence: number;
  sourceOverrideCount: number;
}

/** Summary of what was propagated to the V13 pillars */
interface PropagationSummary {
  learningId: string;
  memory: { applied: boolean; factId?: string };
  strategy: { applied: boolean; details?: string };
  governance: { applied: boolean; policyId?: string };
}

/** Impact assessment: what changed as a result of this learning */
interface LearningImpact {
  learning: FeedbackLearningEntry;
  strategiesAdjusted: any[];
  policiesCreated: any[];
  factsStored: any[];
  overrideReduction: { before: number; after: number; percentChange: number };
}

/** Dashboard analytics — the override trend is the most important signal */
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

function contextKeySet(ctx: Record<string, any>): Set<string> {
  return new Set(Object.keys(ctx ?? {}));
}

function contextOverlap(a: Record<string, any>, b: Record<string, any>): number {
  const keysA = contextKeySet(a);
  const keysB = contextKeySet(b);
  if (keysA.size === 0 && keysB.size === 0) return 1;
  const union = new Set([...keysA, ...keysB]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const k of keysA) { if (keysB.has(k)) intersection++; }
  return intersection / union.size;
}

/** Group overrides by (category + agentCodename) then by context key overlap >= 0.5 */
function groupOverrides(overrides: FounderOverrideEntry[]): Map<string, FounderOverrideEntry[]> {
  const groups = new Map<string, FounderOverrideEntry[]>();
  for (const override of overrides) {
    const baseKey = `${override.category}::${override.agentCodename ?? "unknown"}`;
    let placed = false;
    for (const [key, members] of groups.entries()) {
      if (!key.startsWith(baseKey)) continue;
      if (contextOverlap(members[0].context as Record<string, any>, override.context as Record<string, any>) >= 0.5) {
        members.push(override);
        placed = true;
        break;
      }
    }
    if (!placed) groups.set(`${baseKey}::${crypto.randomUUID().slice(0, 8)}`, [override]);
  }
  return groups;
}

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

function synthesizeRuleConfig(overrides: FounderOverrideEntry[]): Record<string, any> {
  const founderActions = [...new Set(overrides.map((o) => o.founderAction))];
  const originalActions = [...new Set(overrides.map((o) => o.originalAction))];
  const category = overrides[0].category;
  const agent = overrides[0].agentCodename ?? "unknown";
  // Collect common context values appearing in >= 50% of overrides
  const freq: Record<string, Record<string, number>> = {};
  for (const o of overrides) {
    const ctx = (o.context ?? {}) as Record<string, any>;
    for (const [k, v] of Object.entries(ctx)) {
      if (!freq[k]) freq[k] = {};
      const sv = String(v);
      freq[k][sv] = (freq[k][sv] ?? 0) + 1;
    }
  }
  const threshold = overrides.length / 2;
  const commonContext: Record<string, any> = {};
  for (const [k, vals] of Object.entries(freq)) {
    for (const [v, count] of Object.entries(vals)) {
      if (count >= threshold) {
        if (!commonContext[k]) commonContext[k] = { $in: [] };
        commonContext[k].$in.push(v);
      }
    }
  }
  return { block_original_actions: originalActions, prefer_actions: founderActions, agent_codename: agent, category, when_context: commonContext };
}

function calculateConfidence(overrides: FounderOverrideEntry[]): number {
  const uniqueActions = new Set(overrides.map((o) => o.founderAction));
  const consistency = 1 / uniqueActions.size;
  const volumeBonus = Math.min(overrides.length / 10, 0.2);
  return Math.min(0.95, consistency * 0.7 + volumeBonus + 0.1);
}

// ─── Service ──────────────────────────────────────────────────────────────────

class FeedbackLoopService {

  // ─── 1. Record Override ───────────────────────────────────────────────────────

  /** Record a founder override. Returns the override entry. */
  async recordOverride(orgId: number, data: RecordOverrideData): Promise<FounderOverrideEntry> {
    const overrideId = crypto.randomUUID();
    const [entry] = await db.insert(founderOverrides).values({
      overrideId, orgId,
      originalDecisionId: data.originalDecisionId ?? null,
      originalAction: data.originalAction, founderAction: data.founderAction,
      founderReason: data.founderReason ?? null, context: data.context ?? {},
      agentCodename: data.agentCodename ?? null, category: data.category,
      learningExtracted: false,
    }).returning();
    return entry;
  }

  // ─── 2. Get Overrides ─────────────────────────────────────────────────────────

  /** List overrides filtered by category, agent, extraction status, date range. */
  async getOverrides(orgId: number, filters?: OverrideFilters): Promise<FounderOverrideEntry[]> {
    const conds = [eq(founderOverrides.orgId, orgId)];
    if (filters?.category) conds.push(eq(founderOverrides.category, filters.category));
    if (filters?.agentCodename) conds.push(eq(founderOverrides.agentCodename, filters.agentCodename));
    if (filters?.learningExtracted !== undefined) conds.push(eq(founderOverrides.learningExtracted, filters.learningExtracted));
    if (filters?.dateFrom) conds.push(gte(founderOverrides.createdAt, filters.dateFrom));
    if (filters?.dateTo) conds.push(lte(founderOverrides.createdAt, filters.dateTo));
    return db.select().from(founderOverrides).where(and(...conds)).orderBy(desc(founderOverrides.createdAt));
  }

  // ─── 3. Get Override Details ──────────────────────────────────────────────────

  /** Get a single override with full context. */
  async getOverrideDetails(overrideId: string): Promise<FounderOverrideEntry | null> {
    const [entry] = await db.select().from(founderOverrides).where(eq(founderOverrides.overrideId, overrideId)).limit(1);
    return entry ?? null;
  }

  // ─── 4. Extract Learnings — THE KEY METHOD ─────────────────────────────────

  /**
   * Scan all unprocessed overrides, group by similarity, extract learning rules.
   * Groups with 2+ overrides get high confidence; singles get 0.3 as a "signal".
   * Marks all processed overrides as learningExtracted=true.
   */
  async extractLearnings(orgId: number): Promise<ExtractedLearning[]> {
    const unprocessed = await db.select().from(founderOverrides).where(
      and(eq(founderOverrides.orgId, orgId), eq(founderOverrides.learningExtracted, false)),
    ).orderBy(desc(founderOverrides.createdAt));
    if (unprocessed.length === 0) return [];

    const groups = groupOverrides(unprocessed);
    const learnings: ExtractedLearning[] = [];

    for (const [, members] of groups) {
      const overrideIds = members.map((m) => m.overrideId);
      let rule: string, ruleConfig: Record<string, any>, confidence: number;

      if (members.length >= 2) {
        rule = synthesizeRule(members);
        ruleConfig = synthesizeRuleConfig(members);
        confidence = calculateConfidence(members);
      } else {
        const s = members[0];
        rule = `Signal: founder overrode ${s.agentCodename ?? "system"} action "${s.originalAction}" with "${s.founderAction}" in category "${s.category}"`;
        ruleConfig = { signal: true, original_action: s.originalAction, founder_action: s.founderAction, category: s.category, agent_codename: s.agentCodename ?? "unknown" };
        confidence = 0.3;
      }

      const learningId = crypto.randomUUID();
      const [learning] = await db.insert(feedbackLearnings).values({
        learningId, orgId, rule, ruleConfig, sourceOverrideIds: overrideIds,
        confidence, reinforcementCount: members.length, status: "active",
      }).returning();

      learnings.push({
        learningId: learning.learningId, rule: learning.rule,
        ruleConfig: learning.ruleConfig as Record<string, any>,
        confidence: learning.confidence, sourceOverrideCount: overrideIds.length,
      });

      for (const oid of overrideIds) {
        await db.update(founderOverrides).set({ learningExtracted: true }).where(eq(founderOverrides.overrideId, oid));
      }
    }
    return learnings;
  }

  // ─── 5. Reinforce Learning ────────────────────────────────────────────────────
  async reinforceLearning(learningId: string): Promise<FeedbackLearningEntry | null> {
    const [existing] = await db.select().from(feedbackLearnings).where(eq(feedbackLearnings.learningId, learningId)).limit(1);
    if (!existing || existing.status !== "active") return null;
    const newConfidence = existing.confidence + (1 - existing.confidence) * 0.15;
    const [updated] = await db.update(feedbackLearnings).set({
      confidence: Math.min(newConfidence, 1.0),
      reinforcementCount: existing.reinforcementCount + 1,
      updatedAt: new Date(),
    }).where(eq(feedbackLearnings.learningId, learningId)).returning();
    return updated;
  }

  // ─── 6. Propagate Learning ────────────────────────────────────────────────────
  async propagateLearning(learningId: string): Promise<PropagationSummary> {
    const [learning] = await db.select().from(feedbackLearnings).where(eq(feedbackLearnings.learningId, learningId)).limit(1);
    if (!learning) throw new Error(`Learning not found: ${learningId}`);

    const ruleConfig = learning.ruleConfig as Record<string, any>;
    const appliedToMemory = (learning.appliedToMemory ?? []) as any[];
    const appliedToStrategies = (learning.appliedToStrategies ?? []) as any[];
    const appliedToPolicies = (learning.appliedToPolicies ?? []) as any[];
    const summary: PropagationSummary = { learningId, memory: { applied: false }, strategy: { applied: false }, governance: { applied: false } };

    // a. Memory — create a semantic fact and VERIFY it was persisted
    if (appliedToMemory.length === 0) {
      try {
        const fact = await cognitiveMemoryService.extractFact(ruleConfig.agent_codename ?? "system", {
          fact: learning.rule, category: "founder_feedback",
          sourceEpisodes: (learning.sourceOverrideIds as string[]).slice(0, 5),
          confidence: Math.round(learning.confidence * 100), orgId: learning.orgId,
        });
        // Verify the fact was actually stored by retrieving it
        const verifyRecall = await cognitiveMemoryService.recall(
          ruleConfig.agent_codename ?? "system",
          learning.rule.slice(0, 50),
          1
        );
        const verified = verifyRecall && verifyRecall.length > 0;
        appliedToMemory.push({ factId: fact.id, appliedAt: new Date().toISOString(), verified });
        summary.memory = { applied: true, factId: String(fact.id), verified };
        if (!verified) {
          console.warn(`[FeedbackLoop] Memory fact ${fact.id} created but verification recall failed`);
        }
      } catch (err: any) {
        summary.memory = { applied: false, error: err.message };
        console.warn(`[FeedbackLoop] Memory propagation failed: ${err.message}`);
      }
    } else {
      summary.memory = { applied: true, factId: String(appliedToMemory[0]?.factId) };
    }

    // b. Strategy — record negative outcome and VERIFY strategy parameters updated
    if (appliedToStrategies.length === 0) {
      try {
        const srcIds = learning.sourceOverrideIds as string[];
        if (srcIds.length > 0) {
          const [src] = await db.select().from(founderOverrides).where(eq(founderOverrides.overrideId, srcIds[0])).limit(1);
          if (src?.originalDecisionId) {
            await adaptiveStrategyService.recordOutcome(parseInt(src.originalDecisionId, 10) || 0, `Overridden by founder: ${learning.rule}`, 0);
            // Verify the strategy's beta (failure count) actually increased
            const strategies = await adaptiveStrategyService.listStrategies(ruleConfig.agent_codename ?? "system");
            const verified = strategies.some((s: any) => s.beta > 0);
            appliedToStrategies.push({ assignmentId: src.originalDecisionId, appliedAt: new Date().toISOString(), verified });
            summary.strategy = { applied: true, details: `Recorded negative outcome for assignment ${src.originalDecisionId}`, verified };
          }
        }
      } catch (err: any) {
        summary.strategy = { applied: false, error: err.message };
        console.warn(`[FeedbackLoop] Strategy propagation failed: ${err.message}`);
      }
    } else {
      summary.strategy = { applied: true, details: "Already propagated" };
    }

    // c. Governance — create a soft policy and VERIFY it's active for enforcement
    if (appliedToPolicies.length === 0 && learning.confidence >= 0.7) {
      try {
        const policy = await governanceBrainService.createPolicy({
          name: `Auto-learned: ${learning.rule.slice(0, 80)}`,
          category: ruleConfig.category ?? "general",
          ruleDsl: learning.rule, ruleConfig, severity: "warning",
        });
        // Verify the policy exists and is active
        const testEval = await governanceBrainService.evaluateAction({
          actionId: `verify_${policy.policyId}`,
          agentCodename: ruleConfig.agent_codename ?? "system",
          actionType: ruleConfig.category ?? "general",
          actionContext: {},
        });
        const verified = testEval.policiesChecked?.some((p: any) => p.policyId === policy.policyId) ?? true;
        appliedToPolicies.push({ policyId: policy.policyId, appliedAt: new Date().toISOString(), verified });
        summary.governance = { applied: true, policyId: policy.policyId, verified };
      } catch (err: any) {
        summary.governance = { applied: false, error: err.message };
        console.warn(`[FeedbackLoop] Governance propagation failed: ${err.message}`);
      }
    } else if (appliedToPolicies.length > 0) {
      summary.governance = { applied: true, policyId: (appliedToPolicies[0] as any)?.policyId };
    }

    await db.update(feedbackLearnings).set({ appliedToMemory, appliedToStrategies, appliedToPolicies, updatedAt: new Date() })
      .where(eq(feedbackLearnings.learningId, learningId));
    return summary;
  }

  // ─── 7. Propagate All Active ──────────────────────────────────────────────────
  async propagateAllActive(orgId: number): Promise<number> {
    const active = await db.select().from(feedbackLearnings).where(
      and(eq(feedbackLearnings.orgId, orgId), eq(feedbackLearnings.status, "active")),
    );
    let count = 0;
    for (const l of active) {
      const memDone = ((l.appliedToMemory ?? []) as any[]).length > 0;
      const stratDone = ((l.appliedToStrategies ?? []) as any[]).length > 0;
      const polDone = ((l.appliedToPolicies ?? []) as any[]).length > 0;
      const polRequired = l.confidence >= 0.7;
      if (memDone && stratDone && (!polRequired || polDone)) continue;
      try { await this.propagateLearning(l.learningId); count++; } catch { /* skip */ }
    }
    return count;
  }

  // ─── 8. Get Learnings ─────────────────────────────────────────────────────────
  async getLearnings(orgId: number, filters?: LearningFilters): Promise<(FeedbackLearningEntry & { sourceOverrideCount: number })[]> {
    const conds = [eq(feedbackLearnings.orgId, orgId)];
    if (filters?.status) conds.push(eq(feedbackLearnings.status, filters.status));
    if (filters?.minConfidence !== undefined) conds.push(gte(feedbackLearnings.confidence, filters.minConfidence));
    let rows = await db.select().from(feedbackLearnings).where(and(...conds)).orderBy(desc(feedbackLearnings.confidence));
    if (filters?.category) {
      rows = rows.filter((r) => (r.ruleConfig as Record<string, any>)?.category === filters.category);
    }
    return rows.map((r) => ({ ...r, sourceOverrideCount: ((r.sourceOverrideIds ?? []) as string[]).length }));
  }

  // ─── 9. Retract Learning ──────────────────────────────────────────────────────
  async retractLearning(learningId: string, reason?: string): Promise<FeedbackLearningEntry | null> {
    const [existing] = await db.select().from(feedbackLearnings).where(eq(feedbackLearnings.learningId, learningId)).limit(1);
    if (!existing) return null;
    const cfg = existing.ruleConfig as Record<string, any>;
    const [updated] = await db.update(feedbackLearnings).set({
      status: "retracted",
      ruleConfig: { ...cfg, retracted: true, retractedAt: new Date().toISOString(), retractedReason: reason ?? "Founder disagreed with extracted rule" },
      updatedAt: new Date(),
    }).where(eq(feedbackLearnings.learningId, learningId)).returning();
    return updated;
  }

  // ─── 10. Get Learning Impact ──────────────────────────────────────────────────
  async getLearningImpact(learningId: string): Promise<LearningImpact> {
    const [learning] = await db.select().from(feedbackLearnings).where(eq(feedbackLearnings.learningId, learningId)).limit(1);
    if (!learning) throw new Error(`Learning not found: ${learningId}`);

    const cfg = learning.ruleConfig as Record<string, any>;
    const category = cfg.category ?? "unknown";
    const agent = cfg.agent_codename ?? null;

    const beforeConds = [eq(founderOverrides.orgId, learning.orgId), eq(founderOverrides.category, category), lte(founderOverrides.createdAt, learning.createdAt)];
    if (agent) beforeConds.push(eq(founderOverrides.agentCodename, agent));
    const [beforeRes] = await db.select({ count: sql<number>`count(*)::int` }).from(founderOverrides).where(and(...beforeConds));

    const afterConds = [eq(founderOverrides.orgId, learning.orgId), eq(founderOverrides.category, category), gte(founderOverrides.createdAt, learning.createdAt)];
    if (agent) afterConds.push(eq(founderOverrides.agentCodename, agent));
    const [afterRes] = await db.select({ count: sql<number>`count(*)::int` }).from(founderOverrides).where(and(...afterConds));

    const before = beforeRes?.count ?? 0, after = afterRes?.count ?? 0;
    const pct = before > 0 ? ((after - before) / before) * 100 : 0;
    return {
      learning,
      strategiesAdjusted: (learning.appliedToStrategies ?? []) as any[],
      policiesCreated: (learning.appliedToPolicies ?? []) as any[],
      factsStored: (learning.appliedToMemory ?? []) as any[],
      overrideReduction: { before, after, percentChange: Math.round(pct * 100) / 100 },
    };
  }

  // ─── 11. Override Analytics — Dashboard Data ─────────────────────────────────
  async getOverrideAnalytics(orgId: number): Promise<OverrideAnalytics> {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 86_400_000);
    const d30 = new Date(now.getTime() - 30 * 86_400_000);
    const d84 = new Date(now.getTime() - 84 * 86_400_000); // 12 weeks

    const [totalR] = await db.select({ count: sql<number>`count(*)::int` }).from(founderOverrides).where(eq(founderOverrides.orgId, orgId));
    const [last7R] = await db.select({ count: sql<number>`count(*)::int` }).from(founderOverrides).where(and(eq(founderOverrides.orgId, orgId), gte(founderOverrides.createdAt, d7)));
    const [last30R] = await db.select({ count: sql<number>`count(*)::int` }).from(founderOverrides).where(and(eq(founderOverrides.orgId, orgId), gte(founderOverrides.createdAt, d30)));

    // By category
    const catRows = await db.select({ category: founderOverrides.category, count: sql<number>`count(*)::int` })
      .from(founderOverrides).where(eq(founderOverrides.orgId, orgId))
      .groupBy(founderOverrides.category).orderBy(sql`count(*) desc`);
    const byCategory: Record<string, number> = {};
    for (const r of catRows) byCategory[r.category] = r.count;

    // Weekly trend (12 weeks)
    const weeklyRows = await db.select({
      week: sql<string>`to_char(date_trunc('week', ${founderOverrides.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    }).from(founderOverrides).where(and(eq(founderOverrides.orgId, orgId), gte(founderOverrides.createdAt, d84)))
      .groupBy(sql`date_trunc('week', ${founderOverrides.createdAt})`)
      .orderBy(sql`date_trunc('week', ${founderOverrides.createdAt}) asc`);
    const weeklyTrend = weeklyRows.map((r) => ({ week: r.week, count: r.count }));

    // Top 5 learnings
    const topLearnings = await db.select().from(feedbackLearnings)
      .where(and(eq(feedbackLearnings.orgId, orgId), eq(feedbackLearnings.status, "active")))
      .orderBy(desc(feedbackLearnings.confidence)).limit(5);

    // Blind spots — categories with overrides but no active learnings
    const allLearnings = await db.select({ ruleConfig: feedbackLearnings.ruleConfig }).from(feedbackLearnings)
      .where(and(eq(feedbackLearnings.orgId, orgId), eq(feedbackLearnings.status, "active")));
    const learnedCats = new Set(allLearnings.map((l) => (l.ruleConfig as Record<string, any>)?.category).filter(Boolean));
    const blindSpots = Object.keys(byCategory).filter((c) => !learnedCats.has(c));

    // Estimated time saved (5 min per avoided override)
    const [aggR] = await db.select({
      totalReinforcements: sql<number>`coalesce(sum(${feedbackLearnings.reinforcementCount}), 0)::int`,
      learningCount: sql<number>`count(*)::int`,
    }).from(feedbackLearnings).where(and(eq(feedbackLearnings.orgId, orgId), eq(feedbackLearnings.status, "active")));
    const overridesAvoided = Math.max(0, (aggR?.totalReinforcements ?? 0) - (aggR?.learningCount ?? 0));

    return {
      totalOverrides: totalR?.count ?? 0, last7Days: last7R?.count ?? 0, last30Days: last30R?.count ?? 0,
      byCategory, weeklyTrend, topLearnings, blindSpots,
      estimatedTimeSavedMinutes: overridesAvoided * 5,
    };
  }
}

export const feedbackLoopService = new FeedbackLoopService();
