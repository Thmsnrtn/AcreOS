/**
 * Confidence Cascade — Sovereign Company Protocol v14 — "The Self-Running Company"
 *
 * When an agent is uncertain about a decision, this service exhausts every
 * system resource before bothering the founder. Five cascade layers are
 * attempted in order: Memory Lookup, Strategy Consult, Peer Review,
 * Governance Check, and finally Founder Escalation.
 */

import { db } from "../db";
import { cascadeResolutions, type CascadeResolutionEntry } from "@shared/schema";
import { eq, and, desc, sql, gte, lte, isNull, count } from "drizzle-orm";
import crypto from "crypto";

import { cognitiveMemoryService } from "./cognitiveMemoryV13";
import { adaptiveStrategyService } from "./adaptiveStrategyV13";
import { collaborationProtocolService } from "./collaborationProtocolV13";
import { governanceBrainService } from "./governanceBrainV13";
import { selfHealingMeshService } from "./selfHealingMeshV13";
import { logger } from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CascadeRequest {
  triggerType: string;
  triggerContext: Record<string, any>;
  originAgent: string;
  decisionNeeded: string;
  currentConfidence: number;
  confidenceThreshold?: number;
}

interface LayerAttempt {
  layer: string;
  layerIndex: number;
  status: "resolved" | "skipped" | "failed" | "blocked";
  confidenceBefore: number;
  confidenceBoost: number;
  confidenceAfter: number;
  details: Record<string, any>;
  durationMs: number;
}

interface CascadeResult {
  resolutionId: string;
  status: "resolved" | "escalated" | "governance-blocked";
  resolvedAtLayer: string | null;
  layersAttempted: LayerAttempt[];
  finalDecision: string;
  finalConfidence: number;
  founderEscalated: boolean;
  totalDurationMs: number;
}

interface ResolutionFilters {
  originAgent?: string;
  triggerType?: string;
  founderEscalated?: boolean;
  resolvedAtLayer?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

interface CascadeEfficiency {
  totalResolutions: number;
  resolutionRateByLayer: Record<string, { count: number; percentage: number }>;
  averageCascadeDepth: number;
  founderEscalationRate: number;
  averageTimeByLayer: Record<string, number>;
  confidenceBoostDistribution: Record<string, { avgBoost: number; maxBoost: number; timesContributed: number }>;
}

interface AgentCascadeProfile {
  agentCodename: string;
  totalResolutions: number;
  escalationRate: number;
  layerReliance: Record<string, number>;
  averageConfidenceGain: number;
  weakestDecisionTypes: Array<{ triggerType: string; escalationRate: number; count: number }>;
}

interface LayerConfigEntry {
  name: string;
  index: number;
  enabled: boolean;
  timeoutMs: number;
  maxConfidenceBoost: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LAYER_NAMES = ["memory_lookup", "strategy_consult", "peer_review", "governance_check", "founder_escalation"] as const;

const LAYER_TIMEOUTS: Record<string, number> = {
  memory_lookup: 2000,
  strategy_consult: 1000,
  peer_review: 3000,
  governance_check: 2000,
};

const MAX_CONFIDENCE = 95;

// ─── Service ──────────────────────────────────────────────────────────────────

class ConfidenceCascadeService {
  // ─── 1. resolve — THE MAIN METHOD ───────────────────────────────────────────

  async resolve(orgId: number, request: CascadeRequest): Promise<CascadeResult> {
    const startTime = Date.now();
    const resolutionId = crypto.randomUUID();
    const threshold = request.confidenceThreshold ?? 75;
    let confidence = request.currentConfidence;
    const layersAttempted: LayerAttempt[] = [];
    let resolvedAtLayer: string | null = null;
    let status: "resolved" | "escalated" | "governance-blocked" = "escalated";

    // Create initial tracking record
    await db.insert(cascadeResolutions).values({
      resolutionId,
      orgId,
      triggerType: request.triggerType,
      triggerContext: request.triggerContext,
      originAgent: request.originAgent,
      layersAttempted: [],
      founderEscalated: false,
      createdAt: new Date(),
    });

    // ── Layer 1: Memory Lookup ──────────────────────────────────────────────
    const memoryResult = await this.attemptMemoryLookup(request, confidence);
    layersAttempted.push(memoryResult);
    confidence = Math.min(confidence + memoryResult.confidenceBoost, MAX_CONFIDENCE);

    if (confidence >= threshold) {
      resolvedAtLayer = "memory_lookup";
      status = "resolved";
    }

    // ── Layer 2: Strategy Consult ───────────────────────────────────────────
    if (status !== "resolved") {
      const strategyResult = await this.attemptStrategyConsult(request, confidence, orgId);
      layersAttempted.push(strategyResult);
      confidence = Math.min(confidence + strategyResult.confidenceBoost, MAX_CONFIDENCE);

      if (confidence >= threshold) {
        resolvedAtLayer = "strategy_consult";
        status = "resolved";
      }
    }

    // ── Layer 3: Peer Review ────────────────────────────────────────────────
    if (status !== "resolved") {
      const peerResult = await this.attemptPeerReview(request, confidence, orgId, threshold);
      layersAttempted.push(peerResult);
      confidence = Math.min(confidence + peerResult.confidenceBoost, MAX_CONFIDENCE);

      if (confidence >= threshold) {
        resolvedAtLayer = "peer_review";
        status = "resolved";
      }
    }

    // ── Layer 4: Governance Check ───────────────────────────────────────────
    if (status !== "resolved") {
      const govResult = await this.attemptGovernanceCheck(request, confidence, orgId);
      layersAttempted.push(govResult);

      if (govResult.status === "blocked") {
        status = "governance-blocked";
        resolvedAtLayer = "governance_check";
        confidence = Math.min(confidence + govResult.confidenceBoost, MAX_CONFIDENCE);
      } else {
        confidence = Math.min(confidence + govResult.confidenceBoost, MAX_CONFIDENCE);
        if (confidence >= threshold) {
          resolvedAtLayer = "governance_check";
          status = "resolved";
        }
      }
    }

    // ── Layer 5: Founder Escalation ─────────────────────────────────────────
    let founderEscalated = false;
    if (status === "escalated") {
      founderEscalated = true;
      layersAttempted.push({
        layer: "founder_escalation",
        layerIndex: 4,
        status: "skipped",
        confidenceBefore: confidence,
        confidenceBoost: 0,
        confidenceAfter: confidence,
        details: {
          reason: "All automated layers exhausted — escalating to founder",
          cascadeContext: {
            decisionNeeded: request.decisionNeeded,
            threshold,
            confidenceAfterCascade: confidence,
            layersSummary: layersAttempted.map((l) => ({
              layer: l.layer,
              boost: l.confidenceBoost,
              status: l.status,
            })),
          },
        },
        durationMs: 0,
      });
    }

    const totalDurationMs = Date.now() - startTime;

    // Persist final state
    await db
      .update(cascadeResolutions)
      .set({
        layersAttempted,
        resolvedAtLayer,
        finalDecision: status === "governance-blocked"
          ? `BLOCKED: ${request.decisionNeeded}`
          : request.decisionNeeded,
        finalConfidence: confidence,
        founderEscalated,
        totalDurationMs,
        resolvedAt: status !== "escalated" ? new Date() : null,
      })
      .where(eq(cascadeResolutions.resolutionId, resolutionId));

    return {
      resolutionId,
      status,
      resolvedAtLayer,
      layersAttempted,
      finalDecision: status === "governance-blocked"
        ? `BLOCKED: ${request.decisionNeeded}`
        : request.decisionNeeded,
      finalConfidence: confidence,
      founderEscalated,
      totalDurationMs,
    };
  }

  // ─── Layer Implementations ──────────────────────────────────────────────────

  private async attemptMemoryLookup(
    request: CascadeRequest,
    currentConfidence: number,
  ): Promise<LayerAttempt> {
    const start = Date.now();
    try {
      const tags = this.extractTagsFromContext(request.triggerContext, request.decisionNeeded);

      // Query both episodic memory and institutional chronicle in parallel
      const [episodes, chronicleEntries] = await Promise.race([
        Promise.all([
          cognitiveMemoryService.recallEpisodes(request.originAgent, { tags, limit: 20 }),
          import("./companyChronicle").then((mod) =>
            mod.companyChronicleService.search(request.decisionNeeded),
          ).catch(() => [] as any[]),
        ]),
        this.timeout(LAYER_TIMEOUTS.memory_lookup).then(() => [null, []] as const),
      ]) as [any[] | null, any[]];

      const hasEpisodes = episodes && Array.isArray(episodes) && episodes.length > 0;
      const hasChronicle = chronicleEntries && Array.isArray(chronicleEntries) && chronicleEntries.length > 0;

      if (!hasEpisodes && !hasChronicle) {
        return this.buildLayerResult("memory_lookup", 0, currentConfidence, start, "skipped", {
          reason: "No matching episodic memories or chronicle entries found",
        });
      }

      // Look for episodes with similar action+context and successful outcomes
      const relevant = hasEpisodes
        ? episodes.filter((ep: any) => ep.outcomeSuccess === true)
        : [];
      const negative = hasEpisodes
        ? episodes.filter((ep: any) => ep.outcomeSuccess === false)
        : [];
      const successRate = hasEpisodes && episodes.length > 0
        ? relevant.length / episodes.length
        : 0;

      // Check for strong positive precedent (>70% success) — auto-boost 25
      const hasWarningFlag = negative.length > 0;

      if (relevant.length >= 3 && successRate > 0.7) {
        // Precedent with positive outcome — auto-boost 25 instead of default
        const precedentBoost = 25;
        return this.buildLayerResult("memory_lookup", 0, currentConfidence, start, "resolved", {
          matchingEpisodes: hasEpisodes ? episodes.length : 0,
          successfulEpisodes: relevant.length,
          negativeEpisodes: negative.length,
          successRate,
          boost: precedentBoost,
          chronicleEntriesFound: hasChronicle ? chronicleEntries.length : 0,
          chronicleContext: hasChronicle
            ? chronicleEntries.slice(0, 3).map((e: any) => e.searchableText || e.title || "entry")
            : [],
          precedentMatch: true,
          ...(hasWarningFlag && {
            warningFlag: true,
            warningDetail: `${negative.length} past episode(s) with negative outcomes detected alongside positive precedent`,
          }),
        }, Math.min(precedentBoost, 30));
      }

      // Partial signal — some relevant memories but not enough for a strong boost
      if (relevant.length > 0) {
        const partialBoost = Math.round(relevant.length * 3);
        return this.buildLayerResult("memory_lookup", 0, currentConfidence, start, "resolved", {
          matchingEpisodes: hasEpisodes ? episodes.length : 0,
          successfulEpisodes: relevant.length,
          negativeEpisodes: negative.length,
          successRate,
          boost: partialBoost,
          note: "Partial memory signal — insufficient for full boost",
          chronicleEntriesFound: hasChronicle ? chronicleEntries.length : 0,
          chronicleContext: hasChronicle
            ? chronicleEntries.slice(0, 3).map((e: any) => e.searchableText || e.title || "entry")
            : [],
          ...(hasWarningFlag && {
            warningFlag: true,
            warningDetail: `${negative.length} past episode(s) with negative outcomes detected`,
          }),
        }, Math.min(partialBoost, 20));
      }

      // Chronicle-only signal — no successful episodes but chronicle has context
      if (hasChronicle && !hasEpisodes) {
        return this.buildLayerResult("memory_lookup", 0, currentConfidence, start, "resolved", {
          matchingEpisodes: 0,
          successfulEpisodes: 0,
          chronicleEntriesFound: chronicleEntries.length,
          chronicleContext: chronicleEntries.slice(0, 3).map((e: any) => e.searchableText || e.title || "entry"),
          boost: 5,
          note: "Chronicle-only signal — institutional context found but no episodic precedent",
        }, 5);
      }

      return this.buildLayerResult("memory_lookup", 0, currentConfidence, start, "skipped", {
        matchingEpisodes: hasEpisodes ? episodes.length : 0,
        successfulEpisodes: 0,
        negativeEpisodes: negative.length,
        chronicleEntriesFound: hasChronicle ? chronicleEntries.length : 0,
        reason: "No successful outcome memories matched",
        ...(hasWarningFlag && {
          warningFlag: true,
          warningDetail: `${negative.length} past episode(s) with negative outcomes — no positive precedent found`,
        }),
      });
    } catch (err: any) {
      return this.buildLayerResult("memory_lookup", 0, currentConfidence, start, "failed", {
        error: err.message ?? "Memory lookup failed",
      });
    }
  }

  private async attemptStrategyConsult(
    request: CascadeRequest,
    currentConfidence: number,
    orgId: number,
  ): Promise<LayerAttempt> {
    const start = Date.now();
    try {
      const strategy = await Promise.race([
        adaptiveStrategyService.selectStrategy(request.originAgent, request.triggerContext, orgId),
        this.timeout(LAYER_TIMEOUTS.strategy_consult),
      ]);

      if (!strategy) {
        return this.buildLayerResult("strategy_consult", 1, currentConfidence, start, "skipped", {
          reason: "No active strategy found for this agent/context",
        });
      }

      const alpha = strategy.thompsonAlpha ?? 1;
      const beta = strategy.thompsonBeta ?? 1;
      const winRate = alpha / (alpha + beta);

      if (winRate > 0.7) {
        return this.buildLayerResult("strategy_consult", 1, currentConfidence, start, "resolved", {
          strategyId: strategy.strategyId,
          strategyName: strategy.name,
          thompsonAlpha: alpha,
          thompsonBeta: beta,
          winRate,
          boost: 15,
        }, 15);
      }

      return this.buildLayerResult("strategy_consult", 1, currentConfidence, start, "skipped", {
        strategyId: strategy.strategyId,
        strategyName: strategy.name,
        winRate,
        reason: `Win rate ${(winRate * 100).toFixed(1)}% below 70% threshold`,
      });
    } catch (err: any) {
      return this.buildLayerResult("strategy_consult", 1, currentConfidence, start, "failed", {
        error: err.message ?? "Strategy consult failed",
      });
    }
  }

  private async attemptPeerReview(
    request: CascadeRequest,
    currentConfidence: number,
    orgId: number,
    threshold: number,
  ): Promise<LayerAttempt> {
    const start = Date.now();
    try {
      // Find agents with relevant skills via collaboration protocol
      const relevantSkill = request.triggerType;
      const delegation = await Promise.race([
        collaborationProtocolService.delegate({
          fromAgent: request.originAgent,
          toAgent: "__peer_review_probe__",
          task: `Confidence review: ${request.decisionNeeded}`,
          taskContext: {
            ...request.triggerContext,
            cascadePeerReview: true,
            decisionNeeded: request.decisionNeeded,
          },
          orgId,
        }),
        this.timeout(LAYER_TIMEOUTS.peer_review),
      ]);

      if (!delegation) {
        return this.buildLayerResult("peer_review", 2, currentConfidence, start, "skipped", {
          reason: "No suitable peer agent available for review",
        });
      }

      // Simulate peer confidence based on delegation result
      const peerConfidence = (delegation as any).qualityScore ?? 0;
      if (peerConfidence > threshold) {
        return this.buildLayerResult("peer_review", 2, currentConfidence, start, "resolved", {
          peerAgent: (delegation as any).toAgent,
          delegationId: (delegation as any).delegationId,
          peerConfidence,
          boost: 15,
        }, 15);
      }

      return this.buildLayerResult("peer_review", 2, currentConfidence, start, "skipped", {
        peerAgent: (delegation as any).toAgent,
        delegationId: (delegation as any).delegationId,
        peerConfidence,
        reason: `Peer confidence ${peerConfidence} below threshold ${threshold}`,
      });
    } catch (err: any) {
      return this.buildLayerResult("peer_review", 2, currentConfidence, start, "failed", {
        error: err.message ?? "Peer review failed",
      });
    }
  }

  private async attemptGovernanceCheck(
    request: CascadeRequest,
    currentConfidence: number,
    orgId: number,
  ): Promise<LayerAttempt> {
    const start = Date.now();
    try {
      const evaluation = await Promise.race([
        governanceBrainService.evaluateAction({
          actionId: crypto.randomUUID(),
          agentCodename: request.originAgent,
          actionType: request.triggerType,
          actionContext: {
            ...request.triggerContext,
            decisionNeeded: request.decisionNeeded,
          },
          orgId,
        }),
        this.timeout(LAYER_TIMEOUTS.governance_check),
      ]);

      if (!evaluation) {
        return this.buildLayerResult("governance_check", 3, currentConfidence, start, "skipped", {
          reason: "No governance evaluation returned",
        });
      }

      const result = (evaluation as any).overallResult ?? (evaluation as any).result;

      if (result === "blocked") {
        return this.buildLayerResult("governance_check", 3, currentConfidence, start, "blocked", {
          evaluationId: (evaluation as any).evaluationId,
          result: "blocked",
          explanation: (evaluation as any).explanation,
          reason: "Governance policy blocks this action — not escalating to founder",
        });
      }

      if (result === "pass") {
        const hasWarnings = ((evaluation as any).policiesChecked ?? []).some(
          (p: any) => p.result === "warning",
        );
        if (!hasWarnings) {
          return this.buildLayerResult("governance_check", 3, currentConfidence, start, "resolved", {
            evaluationId: (evaluation as any).evaluationId,
            result: "pass",
            boost: 10,
          }, 10);
        }

        return this.buildLayerResult("governance_check", 3, currentConfidence, start, "skipped", {
          evaluationId: (evaluation as any).evaluationId,
          result: "pass_with_warnings",
          reason: "Governance passed but with warnings — no confidence boost",
        });
      }

      return this.buildLayerResult("governance_check", 3, currentConfidence, start, "skipped", {
        evaluationId: (evaluation as any).evaluationId,
        result,
        reason: `Governance result '${result}' — no confidence boost`,
      });
    } catch (err: any) {
      return this.buildLayerResult("governance_check", 3, currentConfidence, start, "failed", {
        error: err.message ?? "Governance check failed",
      });
    }
  }

  // ─── 2. resolveFounderEscalation ──────────────────────────────────────────

  async resolveFounderEscalation(
    resolutionId: string,
    founderDecision: string,
  ): Promise<CascadeResolutionEntry> {
    const [updated] = await db
      .update(cascadeResolutions)
      .set({
        founderResolution: founderDecision,
        finalDecision: founderDecision,
        finalConfidence: MAX_CONFIDENCE,
        resolvedAt: new Date(),
      })
      .where(eq(cascadeResolutions.resolutionId, resolutionId))
      .returning();

    // Feed this back to memory for future cascade resolutions
    if (updated) {
      try {
        await cognitiveMemoryService.recordEpisode(updated.originAgent, {
          action: `cascade_founder_resolution:${updated.triggerType}`,
          outcome: founderDecision,
          outcomeSuccess: true,
          context: {
            triggerType: updated.triggerType,
            triggerContext: updated.triggerContext,
            layersAttempted: updated.layersAttempted,
            founderDecision,
          },
          tags: ["cascade_resolution", "founder_decision", updated.triggerType],
          orgId: updated.orgId,
        });
      } catch (_err) {
        // Non-critical — log but don't fail the resolution
        logger.warn(`[cascade] Failed to record founder resolution to memory: ${(_err as Error).message}`);
      }
    }

    return updated;
  }

  // ─── 3. bulkResolve ───────────────────────────────────────────────────────

  async bulkResolve(orgId: number, requests: CascadeRequest[]): Promise<CascadeResult[]> {
    const results: CascadeResult[] = [];
    for (const request of requests) {
      const result = await this.resolve(orgId, request);
      results.push(result);
    }
    return results;
  }

  // ─── 4. getResolutions ────────────────────────────────────────────────────

  async getResolutions(orgId: number, filters?: ResolutionFilters) {
    const conditions = [eq(cascadeResolutions.orgId, orgId)];

    if (filters?.originAgent) {
      conditions.push(eq(cascadeResolutions.originAgent, filters.originAgent));
    }
    if (filters?.triggerType) {
      conditions.push(eq(cascadeResolutions.triggerType, filters.triggerType));
    }
    if (filters?.founderEscalated !== undefined) {
      conditions.push(eq(cascadeResolutions.founderEscalated, filters.founderEscalated));
    }
    if (filters?.resolvedAtLayer) {
      conditions.push(eq(cascadeResolutions.resolvedAtLayer, filters.resolvedAtLayer));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(cascadeResolutions.createdAt, filters.dateFrom));
    }
    if (filters?.dateTo) {
      conditions.push(lte(cascadeResolutions.createdAt, filters.dateTo));
    }

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const rows = await db
      .select()
      .from(cascadeResolutions)
      .where(and(...conditions))
      .orderBy(desc(cascadeResolutions.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(cascadeResolutions)
      .where(and(...conditions));

    return { resolutions: rows, total, limit, offset };
  }

  // ─── 5. getResolutionDetails ──────────────────────────────────────────────

  async getResolutionDetails(resolutionId: string): Promise<CascadeResolutionEntry | null> {
    const [row] = await db
      .select()
      .from(cascadeResolutions)
      .where(eq(cascadeResolutions.resolutionId, resolutionId))
      .limit(1);

    return row ?? null;
  }

  // ─── 6. getCascadeEfficiency ──────────────────────────────────────────────

  async getCascadeEfficiency(orgId: number, dateRange?: { from: Date; to: Date }): Promise<CascadeEfficiency> {
    const conditions = [eq(cascadeResolutions.orgId, orgId)];
    if (dateRange?.from) conditions.push(gte(cascadeResolutions.createdAt, dateRange.from));
    if (dateRange?.to) conditions.push(lte(cascadeResolutions.createdAt, dateRange.to));

    const rows = await db
      .select()
      .from(cascadeResolutions)
      .where(and(...conditions));

    const totalResolutions = rows.length;
    if (totalResolutions === 0) {
      return {
        totalResolutions: 0,
        resolutionRateByLayer: {},
        averageCascadeDepth: 0,
        founderEscalationRate: 0,
        averageTimeByLayer: {},
        confidenceBoostDistribution: {},
      };
    }

    // Resolution rate per layer
    const layerCounts: Record<string, number> = {};
    let totalDepth = 0;
    let founderCount = 0;
    const layerTimes: Record<string, number[]> = {};
    const layerBoosts: Record<string, number[]> = {};

    for (const row of rows) {
      if (row.resolvedAtLayer) {
        layerCounts[row.resolvedAtLayer] = (layerCounts[row.resolvedAtLayer] ?? 0) + 1;
      }
      if (row.founderEscalated) founderCount++;

      const layers = (row.layersAttempted ?? []) as LayerAttempt[];
      totalDepth += layers.length;

      for (const layer of layers) {
        if (!layerTimes[layer.layer]) layerTimes[layer.layer] = [];
        layerTimes[layer.layer].push(layer.durationMs);

        if (!layerBoosts[layer.layer]) layerBoosts[layer.layer] = [];
        layerBoosts[layer.layer].push(layer.confidenceBoost);
      }
    }

    const resolutionRateByLayer: Record<string, { count: number; percentage: number }> = {};
    for (const [layer, cnt] of Object.entries(layerCounts)) {
      resolutionRateByLayer[layer] = {
        count: cnt,
        percentage: Math.round((cnt / totalResolutions) * 10000) / 100,
      };
    }

    const averageTimeByLayer: Record<string, number> = {};
    for (const [layer, times] of Object.entries(layerTimes)) {
      averageTimeByLayer[layer] = Math.round(
        times.reduce((a, b) => a + b, 0) / times.length,
      );
    }

    const confidenceBoostDistribution: Record<string, { avgBoost: number; maxBoost: number; timesContributed: number }> = {};
    for (const [layer, boosts] of Object.entries(layerBoosts)) {
      const contributed = boosts.filter((b) => b > 0);
      confidenceBoostDistribution[layer] = {
        avgBoost: boosts.length > 0
          ? Math.round((boosts.reduce((a, b) => a + b, 0) / boosts.length) * 100) / 100
          : 0,
        maxBoost: Math.max(...boosts, 0),
        timesContributed: contributed.length,
      };
    }

    return {
      totalResolutions,
      resolutionRateByLayer,
      averageCascadeDepth: Math.round((totalDepth / totalResolutions) * 100) / 100,
      founderEscalationRate: Math.round((founderCount / totalResolutions) * 10000) / 100,
      averageTimeByLayer,
      confidenceBoostDistribution,
    };
  }

  // ─── 7. getFounderQueue ───────────────────────────────────────────────────

  async getFounderQueue(orgId: number) {
    const rows = await db
      .select()
      .from(cascadeResolutions)
      .where(
        and(
          eq(cascadeResolutions.orgId, orgId),
          eq(cascadeResolutions.founderEscalated, true),
          isNull(cascadeResolutions.founderResolution),
        ),
      )
      .orderBy(cascadeResolutions.createdAt);

    // Enrich each item with cascade context so the founder sees why the system couldn't decide
    return rows.map((row) => {
      const layers = (row.layersAttempted ?? []) as LayerAttempt[];
      return {
        ...row,
        cascadeSummary: {
          layersAttempted: layers.length,
          layerResults: layers.map((l) => ({
            layer: l.layer,
            status: l.status,
            confidenceBoost: l.confidenceBoost,
            durationMs: l.durationMs,
            details: l.details,
          })),
          confidenceGap: (row.finalConfidence ?? 0) < 75
            ? 75 - (row.finalConfidence ?? 0)
            : 0,
          waitingMinutes: Math.round(
            (Date.now() - new Date(row.createdAt).getTime()) / 60000,
          ),
        },
      };
    });
  }

  // ─── 8. getAgentCascadeProfile ────────────────────────────────────────────

  async getAgentCascadeProfile(orgId: number, agentCodename: string): Promise<AgentCascadeProfile> {
    const rows = await db
      .select()
      .from(cascadeResolutions)
      .where(
        and(
          eq(cascadeResolutions.orgId, orgId),
          eq(cascadeResolutions.originAgent, agentCodename),
        ),
      );

    const totalResolutions = rows.length;
    const escalated = rows.filter((r) => r.founderEscalated).length;
    const escalationRate = totalResolutions > 0
      ? Math.round((escalated / totalResolutions) * 10000) / 100
      : 0;

    // Layer reliance — which layer resolves things most for this agent
    const layerReliance: Record<string, number> = {};
    let totalConfidenceGain = 0;

    for (const row of rows) {
      if (row.resolvedAtLayer) {
        layerReliance[row.resolvedAtLayer] = (layerReliance[row.resolvedAtLayer] ?? 0) + 1;
      }
      const layers = (row.layersAttempted ?? []) as LayerAttempt[];
      for (const layer of layers) {
        totalConfidenceGain += layer.confidenceBoost;
      }
    }

    // Weakest decision types — highest escalation rate by trigger type
    const byTrigger: Record<string, { total: number; escalated: number }> = {};
    for (const row of rows) {
      const tt = row.triggerType;
      if (!byTrigger[tt]) byTrigger[tt] = { total: 0, escalated: 0 };
      byTrigger[tt].total++;
      if (row.founderEscalated) byTrigger[tt].escalated++;
    }

    const weakestDecisionTypes = Object.entries(byTrigger)
      .map(([triggerType, stats]) => ({
        triggerType,
        escalationRate: Math.round((stats.escalated / stats.total) * 10000) / 100,
        count: stats.total,
      }))
      .sort((a, b) => b.escalationRate - a.escalationRate)
      .slice(0, 5);

    return {
      agentCodename,
      totalResolutions,
      escalationRate,
      layerReliance,
      averageConfidenceGain: totalResolutions > 0
        ? Math.round((totalConfidenceGain / totalResolutions) * 100) / 100
        : 0,
      weakestDecisionTypes,
    };
  }

  // ─── 9. getLayerConfig ────────────────────────────────────────────────────

  getLayerConfig(): LayerConfigEntry[] {
    return [
      { name: "memory_lookup", index: 0, enabled: true, timeoutMs: 2000, maxConfidenceBoost: 30 },
      { name: "strategy_consult", index: 1, enabled: true, timeoutMs: 1000, maxConfidenceBoost: 15 },
      { name: "peer_review", index: 2, enabled: true, timeoutMs: 3000, maxConfidenceBoost: 15 },
      { name: "governance_check", index: 3, enabled: true, timeoutMs: 2000, maxConfidenceBoost: 10 },
      { name: "founder_escalation", index: 4, enabled: true, timeoutMs: 0, maxConfidenceBoost: 0 },
    ];
  }

  // ─── 10. getCascadeStats ──────────────────────────────────────────────────

  async getCascadeStats(orgId: number) {
    const rows = await db
      .select()
      .from(cascadeResolutions)
      .where(eq(cascadeResolutions.orgId, orgId));

    const totalResolutions = rows.length;
    if (totalResolutions === 0) {
      return {
        totalResolutions: 0,
        avgLayersPerResolution: 0,
        mostEffectiveLayer: null,
        agentEscalationRates: [],
      };
    }

    let totalLayers = 0;
    const layerResolveCount: Record<string, number> = {};
    const agentStats: Record<string, { total: number; escalated: number }> = {};

    for (const row of rows) {
      const layers = (row.layersAttempted ?? []) as LayerAttempt[];
      totalLayers += layers.length;

      if (row.resolvedAtLayer) {
        layerResolveCount[row.resolvedAtLayer] = (layerResolveCount[row.resolvedAtLayer] ?? 0) + 1;
      }

      const agent = row.originAgent;
      if (!agentStats[agent]) agentStats[agent] = { total: 0, escalated: 0 };
      agentStats[agent].total++;
      if (row.founderEscalated) agentStats[agent].escalated++;
    }

    // Most effective layer — the one that resolves the most decisions
    let mostEffectiveLayer: string | null = null;
    let maxResolves = 0;
    for (const [layer, cnt] of Object.entries(layerResolveCount)) {
      if (cnt > maxResolves) {
        maxResolves = cnt;
        mostEffectiveLayer = layer;
      }
    }

    // Agent escalation rates sorted — highest first (most problematic)
    const agentEscalationRates = Object.entries(agentStats)
      .map(([agent, stats]) => ({
        agentCodename: agent,
        totalResolutions: stats.total,
        escalationRate: Math.round((stats.escalated / stats.total) * 10000) / 100,
      }))
      .sort((a, b) => b.escalationRate - a.escalationRate);

    return {
      totalResolutions,
      avgLayersPerResolution: Math.round((totalLayers / totalResolutions) * 100) / 100,
      mostEffectiveLayer,
      agentEscalationRates,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildLayerResult(
    layer: string,
    layerIndex: number,
    confidenceBefore: number,
    startTime: number,
    status: "resolved" | "skipped" | "failed" | "blocked",
    details: Record<string, any>,
    boost: number = 0,
  ): LayerAttempt {
    return {
      layer,
      layerIndex,
      status,
      confidenceBefore,
      confidenceBoost: boost,
      confidenceAfter: Math.min(confidenceBefore + boost, MAX_CONFIDENCE),
      details,
      durationMs: Date.now() - startTime,
    };
  }

  private extractTagsFromContext(
    context: Record<string, any>,
    decisionNeeded: string,
  ): string[] {
    const tags: string[] = [];
    if (context.type) tags.push(String(context.type));
    if (context.domain) tags.push(String(context.domain));
    if (context.category) tags.push(String(context.category));
    // Extract keywords from the decision description
    const words = decisionNeeded.toLowerCase().split(/\s+/);
    const keywords = words.filter((w) => w.length > 4).slice(0, 3);
    tags.push(...keywords);
    return tags;
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Layer timeout after ${ms}ms`)), ms),
    );
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const confidenceCascadeService = new ConfidenceCascadeService();
