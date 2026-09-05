/**
 * Adaptive Strategy Engine — Sovereign Company Protocol v13
 *
 * Agents evolve their own strategies through Thompson Sampling, contextual
 * weighting, and lineage tracking. Strategies compete for selection,
 * accumulate outcomes, and spawn mutations via proposals.
 *
 * Key concepts:
 *  - Thompson Sampling: Beta(alpha, beta) sampling for explore/exploit balance
 *  - Context Weights: dot-product similarity to bias strategy selection
 *  - Lineage: strategies can descend from parents, forming evolutionary trees
 *  - Proposals: agents propose new strategies for human/agent review
 */

import { db } from "../db";
import {
  agentStrategies,
  strategyAssignments,
  strategyProposals,
  type AgentStrategyEntry,
  type StrategyAssignmentEntry,
  type StrategyProposalEntry,
} from "@shared/schema";
import { eq, and, desc, sql, isNull, asc } from "drizzle-orm";
import crypto from "crypto";

// ─── Beta Distribution Sampling ─────────────────────────────────────────────

/**
 * Sample from a Beta distribution using the Joehnk algorithm.
 * Returns a value in [0, 1] representing the sampled success probability.
 */
function sampleBeta(alpha: number, beta: number): number {
  // Simple approximation using the gamma-ratio method via rejection sampling
  // For integer-ish alpha/beta common in Thompson Sampling, this is sufficient
  const a = alpha > 0 ? alpha : 1;
  const b = beta > 0 ? beta : 1;

  let u1: number, u2: number, s: number;
  do {
    u1 = Math.pow(Math.random(), 1 / a);
    u2 = Math.pow(Math.random(), 1 / b);
    s = u1 + u2;
  } while (s === 0 || s > 1);

  return u1 / s;
}

/**
 * Compute dot-product similarity between a context vector and a weight vector.
 * Keys present in weights but not context contribute 0; extra context keys are ignored.
 */
function contextSimilarity(
  context: Record<string, any>,
  weights: Record<string, number>,
): number {
  if (!weights || Object.keys(weights).length === 0) return 1;

  let dot = 0;
  let weightMag = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const contextVal = typeof context[key] === "number" ? context[key] : 0;
    dot += contextVal * weight;
    weightMag += weight * weight;
  }

  if (weightMag === 0) return 1;
  return Math.max(0, dot / Math.sqrt(weightMag));
}

// ─── Adaptive Strategy Service ──────────────────────────────────────────────

class AdaptiveStrategyService {
  // ── Strategy CRUD ───────────────────────────────────────────────────────

  /**
   * Create a new strategy for an agent with initial Thompson priors.
   */
  async createStrategy(
    agentCodename: string,
    data: {
      name: string;
      description: string;
      config: Record<string, any>;
      contextWeights?: Record<string, number>;
      minTrialsBeforeCompare?: number;
      parentStrategyId?: string;
      mutationDescription?: string;
      orgId?: number;
    },
  ): Promise<AgentStrategyEntry> {
    const strategyId = crypto.randomUUID();

    const [strategy] = await db
      .insert(agentStrategies)
      .values({
        strategyId,
        agentCodename,
        name: data.name,
        description: data.description,
        config: data.config,
        contextWeights: data.contextWeights ?? {},
        thompsonAlpha: 1,
        thompsonBeta: 1,
        minTrialsBeforeCompare: data.minTrialsBeforeCompare ?? 10,
        parentStrategyId: data.parentStrategyId ?? null,
        mutationDescription: data.mutationDescription ?? null,
        orgId: data.orgId ?? null,
      })
      .returning();

    return strategy;
  }

  // ── Thompson Sampling Selection ─────────────────────────────────────────

  /**
   * Select the best strategy for an agent given current context using
   * Thompson Sampling weighted by context similarity.
   */
  async selectStrategy(
    agentCodename: string,
    context: Record<string, any>,
    orgId?: number,
  ): Promise<AgentStrategyEntry | null> {
    const conditions = [
      eq(agentStrategies.agentCodename, agentCodename),
      eq(agentStrategies.isActive, true),
    ];
    if (orgId !== undefined) {
      conditions.push(eq(agentStrategies.orgId, orgId));
    }

    const strategies = await db
      .select()
      .from(agentStrategies)
      .where(and(...conditions));

    if (strategies.length === 0) return null;

    let bestStrategy: AgentStrategyEntry | null = null;
    let bestScore = -Infinity;

    for (const strategy of strategies) {
      // Sample from Beta(alpha, beta) — Thompson Sampling
      const sample = sampleBeta(strategy.thompsonAlpha, strategy.thompsonBeta);

      // Weight by context similarity
      const similarity = contextSimilarity(context, strategy.contextWeights);
      const weightedScore = sample * (0.5 + 0.5 * similarity);

      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestStrategy = strategy;
      }
    }

    return bestStrategy;
  }

  // ── Strategy Assignment ─────────────────────────────────────────────────

  /**
   * Assign a strategy to a specific entity (lead, deal, property, etc.).
   */
  async assignStrategy(
    strategyId: string,
    data: {
      agentCodename: string;
      entityType: string;
      entityId: string;
      contextSnapshot: Record<string, any>;
      orgId?: number;
    },
  ): Promise<StrategyAssignmentEntry> {
    const [assignment] = await db
      .insert(strategyAssignments)
      .values({
        strategyId,
        agentCodename: data.agentCodename,
        entityType: data.entityType,
        entityId: data.entityId,
        contextSnapshot: data.contextSnapshot,
        orgId: data.orgId ?? null,
      })
      .returning();

    return assignment;
  }

  // ── Outcome Recording ──────────────────────────────────────────────────

  /**
   * Record the outcome of a strategy assignment and update Thompson parameters.
   * Success is determined by positive outcomeValue or outcome string containing "success".
   */
  async recordOutcome(
    assignmentId: number,
    outcome: string,
    outcomeValue: number | undefined,
    orgId: number | null,
  ): Promise<StrategyAssignmentEntry> {
    // `assignmentId` is a bare serial primary key — an id space every tenant
    // shares — and both writes below take it on trust. `orgId` is the caller's
    // lane and is required for that reason; `null` means the platform lane and
    // matches only rows with no org tag, never "any org".
    const [assignment] = await db
      .update(strategyAssignments)
      .set({
        outcome,
        outcomeValue: outcomeValue !== undefined ? String(outcomeValue) : null,
        outcomeRecordedAt: new Date(),
      })
      .where(and(
        eq(strategyAssignments.id, assignmentId),
        orgId == null ? isNull(strategyAssignments.orgId) : eq(strategyAssignments.orgId, orgId),
      ))
      .returning();

    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    // Determine success
    const isSuccess =
      (outcomeValue !== undefined && outcomeValue > 0) ||
      outcome.toLowerCase().includes("success");

    // Fetch current strategy state
    const [strategy] = await db
      .select()
      .from(agentStrategies)
      .where(and(
        eq(agentStrategies.strategyId, assignment.strategyId),
        orgId == null ? isNull(agentStrategies.orgId) : eq(agentStrategies.orgId, orgId),
      ));

    if (!strategy) {
      return assignment;
    }

    // Compute updated aggregates
    const newTrialCount = strategy.trialCount + 1;
    const newSuccessCount = strategy.successCount + (isSuccess ? 1 : 0);
    const newSuccessRate = newTrialCount > 0
      ? (newSuccessCount / newTrialCount).toFixed(4)
      : "0";

    // Running average for outcome value
    const currentAvg = parseFloat(strategy.avgOutcomeValue as string) || 0;
    const val = outcomeValue ?? 0;
    const newAvg = ((currentAvg * strategy.trialCount + val) / newTrialCount).toFixed(4);

    // Update Thompson parameters
    const newAlpha = strategy.thompsonAlpha + (isSuccess ? 1 : 0);
    const newBeta = strategy.thompsonBeta + (isSuccess ? 0 : 1);

    await db
      .update(agentStrategies)
      .set({
        trialCount: newTrialCount,
        successCount: newSuccessCount,
        successRate: newSuccessRate,
        avgOutcomeValue: newAvg,
        thompsonAlpha: newAlpha,
        thompsonBeta: newBeta,
        updatedAt: new Date(),
      })
      .where(and(
        eq(agentStrategies.strategyId, assignment.strategyId),
        orgId == null ? isNull(agentStrategies.orgId) : eq(agentStrategies.orgId, orgId),
      ));

    return assignment;
  }

  // ── Strategy Proposals ─────────────────────────────────────────────────

  /**
   * Agent proposes a new strategy for review.
   */
  async proposeStrategy(
    agentCodename: string,
    data: {
      name: string;
      config: Record<string, any>;
      rationale: string;
      evidenceEpisodes?: string[];
      parentStrategyId?: string;
      orgId?: number;
    },
  ): Promise<StrategyProposalEntry> {
    const proposalId = crypto.randomUUID();

    const [proposal] = await db
      .insert(strategyProposals)
      .values({
        proposalId,
        agentCodename,
        proposedName: data.name,
        proposedConfig: data.config,
        rationale: data.rationale,
        evidenceEpisodes: data.evidenceEpisodes ?? [],
        parentStrategyId: data.parentStrategyId ?? null,
        status: "pending",
        orgId: data.orgId ?? null,
      })
      .returning();

    return proposal;
  }

  /**
   * Review a strategy proposal. If approved, create the real strategy.
   */
  async reviewProposal(
    proposalId: string,
    decision: "approved" | "rejected",
    reviewedBy: string,
    reviewNotes?: string,
  ): Promise<{
    proposal: StrategyProposalEntry;
    strategy?: AgentStrategyEntry;
  }> {
    const [proposal] = await db
      .update(strategyProposals)
      .set({
        status: decision,
        reviewedBy,
        reviewNotes: reviewNotes ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(strategyProposals.proposalId, proposalId))
      .returning();

    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    let strategy: AgentStrategyEntry | undefined;

    if (decision === "approved") {
      strategy = await this.createStrategy(proposal.agentCodename, {
        name: proposal.proposedName,
        description: `Created from approved proposal ${proposalId}`,
        config: proposal.proposedConfig,
        parentStrategyId: proposal.parentStrategyId ?? undefined,
        mutationDescription: `Proposed: ${proposal.rationale}`,
        orgId: proposal.orgId ?? undefined,
      });
    }

    return { proposal, strategy };
  }

  // ── Performance & Analytics ────────────────────────────────────────────

  /**
   * Get all strategies for an agent with performance metrics and ranking.
   */
  async getStrategyPerformance(
    agentCodename: string,
    orgId?: number,
  ): Promise<{
    strategies: Array<
      AgentStrategyEntry & { rank: number }
    >;
  }> {
    const conditions = [eq(agentStrategies.agentCodename, agentCodename)];
    if (orgId !== undefined) {
      conditions.push(eq(agentStrategies.orgId, orgId));
    }

    const strategies = await db
      .select()
      .from(agentStrategies)
      .where(and(...conditions))
      .orderBy(desc(agentStrategies.successRate));

    const ranked = strategies.map((s, idx) => ({
      ...s,
      rank: idx + 1,
    }));

    return { strategies: ranked };
  }

  // ── Strategy Lineage ───────────────────────────────────────────────────

  /**
   * Trace the ancestry of a strategy through parentStrategyId chain.
   * Returns array from oldest ancestor to current strategy.
   */
  async getStrategyLineage(
    strategyId: string,
  ): Promise<AgentStrategyEntry[]> {
    const lineage: AgentStrategyEntry[] = [];
    let currentId: string | null = strategyId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break; // prevent cycles
      visited.add(currentId);

      const [strategy] = await db
        .select()
        .from(agentStrategies)
        .where(eq(agentStrategies.strategyId, currentId));

      if (!strategy) break;

      lineage.unshift(strategy); // prepend — ancestors first
      currentId = strategy.parentStrategyId;
    }

    return lineage;
  }

  // ── Deactivation ──────────────────────────────────────────────────────

  /**
   * Deactivate a strategy so it is no longer selected.
   */
  async deactivateStrategy(strategyId: string): Promise<AgentStrategyEntry> {
    const [strategy] = await db
      .update(agentStrategies)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(agentStrategies.strategyId, strategyId))
      .returning();

    if (!strategy) {
      throw new Error(`Strategy ${strategyId} not found`);
    }

    return strategy;
  }

  // ── Dashboard Stats ────────────────────────────────────────────────────

  /**
   * Aggregate stats across all strategies, assignments, and proposals.
   */
  async getStats(orgId?: number): Promise<{
    totalStrategies: number;
    activeStrategies: number;
    totalAssignments: number;
    pendingProposals: number;
    avgSuccessRate: number;
    topStrategy: AgentStrategyEntry | null;
  }> {
    const stratConditions = orgId !== undefined
      ? [eq(agentStrategies.orgId, orgId)]
      : [];

    const assignConditions = orgId !== undefined
      ? [eq(strategyAssignments.orgId, orgId)]
      : [];

    const proposalConditions = orgId !== undefined
      ? [eq(strategyProposals.orgId, orgId), eq(strategyProposals.status, "pending")]
      : [eq(strategyProposals.status, "pending")];

    // Run queries in parallel
    const [allStrategies, activeResult, assignResult, proposalResult] =
      await Promise.all([
        db
          .select()
          .from(agentStrategies)
          .where(
            stratConditions.length > 0
              ? and(...stratConditions)
              : undefined,
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(agentStrategies)
          .where(
            and(
              eq(agentStrategies.isActive, true),
              ...(stratConditions),
            ),
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(strategyAssignments)
          .where(
            assignConditions.length > 0
              ? and(...assignConditions)
              : undefined,
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(strategyProposals)
          .where(and(...proposalConditions)),
      ]);

    const totalStrategies = allStrategies.length;
    const activeStrategies = Number(activeResult[0]?.count ?? 0);
    const totalAssignments = Number(assignResult[0]?.count ?? 0);
    const pendingProposals = Number(proposalResult[0]?.count ?? 0);

    // Compute average success rate
    let avgSuccessRate = 0;
    if (allStrategies.length > 0) {
      const sum = allStrategies.reduce(
        (acc, s) => acc + parseFloat(s.successRate as string),
        0,
      );
      avgSuccessRate = parseFloat((sum / allStrategies.length).toFixed(4));
    }

    // Top performing strategy by success rate (with minimum trials)
    const eligible = allStrategies
      .filter((s) => s.trialCount >= s.minTrialsBeforeCompare && s.isActive)
      .sort(
        (a, b) =>
          parseFloat(b.successRate as string) -
          parseFloat(a.successRate as string),
      );

    const topStrategy = eligible.length > 0 ? eligible[0] : null;

    return {
      totalStrategies,
      activeStrategies,
      totalAssignments,
      pendingProposals,
      avgSuccessRate,
      topStrategy,
    };
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const adaptiveStrategyService = new AdaptiveStrategyService();
