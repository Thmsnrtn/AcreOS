/**
 * Revenue Attribution Graph — Sovereign Company Protocol v11
 *
 * Every agent action gets a correlation ID. When revenue arrives, walk the
 * causal chain backwards to attribute credit. Each agent's contribution
 * quantified. Monthly report: which agents generate ROI.
 */

import { db } from "../db";
import {
  revenueAttributionNodes, revenueAttributionReports,
  type RevenueAttributionNode, type RevenueAttributionReport,
} from "@shared/schema";
import { eq, desc, gte, and, sql, count } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";

class RevenueAttributionService {

  /**
   * Record an agent action in the attribution chain.
   */
  async recordAction(params: {
    correlationId: string;
    agentCodename: string;
    actionType: string;
    actionDescription: string;
    upstreamNodeId?: number;
    metadata?: Record<string, any>;
  }): Promise<RevenueAttributionNode> {
    const [node] = await db.insert(revenueAttributionNodes).values({
      correlationId: params.correlationId,
      agentCodename: params.agentCodename,
      actionType: params.actionType,
      actionDescription: params.actionDescription,
      upstreamNodeId: params.upstreamNodeId || null,
      metadata: params.metadata || {},
    }).returning();

    // Link to upstream node's downstream list
    if (params.upstreamNodeId) {
      const [upstream] = await db.select().from(revenueAttributionNodes)
        .where(eq(revenueAttributionNodes.id, params.upstreamNodeId)).limit(1);
      if (upstream) {
        const downstreamIds = [...(upstream.downstreamNodeIds || []), node.id];
        await db.update(revenueAttributionNodes)
          .set({ downstreamNodeIds: downstreamIds })
          .where(eq(revenueAttributionNodes.id, params.upstreamNodeId));
      }
    }

    return node;
  }

  /**
   * Attribute revenue to a chain. Walks the chain and distributes attribution.
   */
  async attributeRevenue(params: {
    correlationId: string;
    totalRevenueCents: number;
  }): Promise<RevenueAttributionNode[]> {
    // Get all nodes in the chain
    const nodes = await db.select().from(revenueAttributionNodes)
      .where(eq(revenueAttributionNodes.correlationId, params.correlationId))
      .orderBy(revenueAttributionNodes.createdAt);

    if (nodes.length === 0) return [];

    // AI-driven attribution weighting
    const prompt = `Distribute revenue attribution across these agent actions in a causal chain:

TOTAL REVENUE: $${(params.totalRevenueCents / 100).toFixed(2)}

ACTIONS IN CHAIN:
${nodes.map((n, i) => `${i + 1}. [${n.agentCodename}] ${n.actionType}: ${n.actionDescription}`).join("\n")}

Assign attribution weights (must sum to 1.0). Consider:
- Actions closer to the revenue event get more weight
- But originating actions (lead generation, market signals) deserve credit too
- Customer-facing actions (support, outreach) vs. internal (analytics, compliance)

Respond in JSON:
{ "weights": [0.3, 0.25, 0.25, 0.2] }`;

    let weights: number[] = nodes.map(() => 1 / nodes.length); // default equal split
    try {
      const result = await routeAITask({ task: prompt, complexity: TaskComplexity.MODERATE, responseFormat: "json" });
      const parsed = JSON.parse(result.content);
      if (parsed.weights && parsed.weights.length === nodes.length) {
        weights = parsed.weights;
      }
    } catch { /* use equal split */ }

    // Normalize weights
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    weights = weights.map(w => w / totalWeight);

    // Update nodes with attribution
    const updated: RevenueAttributionNode[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const revenueCents = Math.round(params.totalRevenueCents * weights[i]);
      const [u] = await db.update(revenueAttributionNodes)
        .set({
          revenueImpactCents: revenueCents,
          attributionWeight: String(Math.round(weights[i] * 1000) / 1000),
        })
        .where(eq(revenueAttributionNodes.id, nodes[i].id))
        .returning();
      updated.push(u);
    }

    return updated;
  }

  /**
   * Generate a periodic attribution report.
   */
  async generateReport(period: "weekly" | "monthly"): Promise<RevenueAttributionReport> {
    const daysBack = period === "weekly" ? 7 : 30;
    const periodStart = new Date(Date.now() - daysBack * 86400000);
    const periodEnd = new Date();

    const nodes = await db.select().from(revenueAttributionNodes)
      .where(gte(revenueAttributionNodes.createdAt, periodStart));

    // Aggregate by agent
    const agentMap = new Map<string, { totalRevenue: number; actionCount: number; weights: number[] }>();
    for (const node of nodes) {
      const existing = agentMap.get(node.agentCodename) || { totalRevenue: 0, actionCount: 0, weights: [] };
      existing.totalRevenue += node.revenueImpactCents || 0;
      existing.actionCount++;
      existing.weights.push(Number(node.attributionWeight) || 0);
      agentMap.set(node.agentCodename, existing);
    }

    const agentContributions = Array.from(agentMap.entries()).map(([agentCodename, data]) => ({
      agentCodename,
      totalRevenue: data.totalRevenue,
      actionCount: data.actionCount,
      avgAttribution: data.weights.length > 0 ? Math.round((data.weights.reduce((s, w) => s + w, 0) / data.weights.length) * 100) : 0,
      roi: data.totalRevenue, // simplified — in production would factor in agent cost
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Find top chains
    const chainMap = new Map<string, { totalRevenue: number; agents: Set<string>; nodeCount: number }>();
    for (const node of nodes) {
      const existing = chainMap.get(node.correlationId) || { totalRevenue: 0, agents: new Set(), nodeCount: 0 };
      existing.totalRevenue += node.revenueImpactCents || 0;
      existing.agents.add(node.agentCodename);
      existing.nodeCount++;
      chainMap.set(node.correlationId, existing);
    }

    const topChains = Array.from(chainMap.entries())
      .filter(([_, data]) => data.totalRevenue > 0)
      .map(([correlationId, data]) => ({
        correlationId,
        totalRevenue: data.totalRevenue,
        chainLength: data.nodeCount,
        agents: Array.from(data.agents),
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);

    const totalAttributedRevenue = agentContributions.reduce((s, a) => s + a.totalRevenue, 0);

    const [report] = await db.insert(revenueAttributionReports).values({
      reportPeriod: period,
      periodStart,
      periodEnd,
      agentContributions,
      topChains,
      totalAttributedRevenue,
    }).returning();

    return report;
  }

  async getChain(correlationId: string): Promise<RevenueAttributionNode[]> {
    return db.select().from(revenueAttributionNodes)
      .where(eq(revenueAttributionNodes.correlationId, correlationId))
      .orderBy(revenueAttributionNodes.createdAt);
  }

  async getAgentNodes(agentCodename: string, limit = 30): Promise<RevenueAttributionNode[]> {
    return db.select().from(revenueAttributionNodes)
      .where(eq(revenueAttributionNodes.agentCodename, agentCodename))
      .orderBy(desc(revenueAttributionNodes.createdAt)).limit(limit);
  }

  async getRecentReports(limit = 10): Promise<RevenueAttributionReport[]> {
    return db.select().from(revenueAttributionReports)
      .orderBy(desc(revenueAttributionReports.createdAt)).limit(limit);
  }
}

export const revenueAttributionService = new RevenueAttributionService();
