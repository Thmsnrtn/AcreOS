/**
 * Decision Causality Graph — Sovereign Company Protocol v11
 *
 * Every decision linked in a directed acyclic graph:
 * - Decision A → triggers Decision B → triggers Decision C
 * - If C fails → trace back to root cause
 * - Rollback semantics: if A was wrong, which downstream to reverse?
 * - "Blast radius" calculation before executing
 * - Weekly report: deepest chains, most cascading decisions
 */

import { db } from "../db";
import { decisionCausalityNodes, type DecisionCausalityNode } from "@shared/schema";
import { eq, desc, gte, sql, count } from "drizzle-orm";

class DecisionCausalityService {

  /**
   * Record a decision node in the causality graph.
   */
  async recordDecision(params: {
    agentCodename: string;
    decisionType: string;
    decisionSummary: string;
    parentDecisionIds?: string[];
    rollbackEligible?: boolean;
  }): Promise<DecisionCausalityNode> {
    const decisionId = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const parentIds = params.parentDecisionIds || [];

    // Calculate depth from parents
    let depth = 0;
    if (parentIds.length > 0) {
      const parents = await db.select().from(decisionCausalityNodes)
        .where(sql`${decisionCausalityNodes.decisionId} = ANY(ARRAY[${sql.join(parentIds.map(id => sql`${id}`), sql`, `)}]::text[])`);
      depth = Math.max(...parents.map(p => p.depth), 0) + 1;
    }

    const [node] = await db.insert(decisionCausalityNodes).values({
      decisionId,
      agentCodename: params.agentCodename,
      decisionType: params.decisionType,
      decisionSummary: params.decisionSummary,
      parentDecisionIds: parentIds,
      depth,
      rollbackEligible: params.rollbackEligible || false,
    }).returning();

    // Update parents' child lists
    for (const parentId of parentIds) {
      const [parent] = await db.select().from(decisionCausalityNodes)
        .where(eq(decisionCausalityNodes.decisionId, parentId)).limit(1);
      if (parent) {
        const children = [...(parent.childDecisionIds || []), decisionId];
        await db.update(decisionCausalityNodes)
          .set({ childDecisionIds: children })
          .where(eq(decisionCausalityNodes.id, parent.id));
      }
    }

    // Update blast radius up the chain
    await this.recalculateBlastRadius(decisionId);

    return node;
  }

  /**
   * Record the outcome of a decision.
   */
  async recordOutcome(decisionId: string, outcome: "success" | "failure" | "rolled_back"): Promise<void> {
    await db.update(decisionCausalityNodes)
      .set({ outcome })
      .where(eq(decisionCausalityNodes.decisionId, decisionId));
  }

  /**
   * Calculate blast radius — how many downstream decisions would be affected.
   */
  async getBlastRadius(decisionId: string): Promise<{
    directChildren: number;
    totalDownstream: number;
    affectedAgents: string[];
    chain: DecisionCausalityNode[];
  }> {
    const chain: DecisionCausalityNode[] = [];
    const visited = new Set<string>();
    const agents = new Set<string>();

    const traverse = async (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const [node] = await db.select().from(decisionCausalityNodes)
        .where(eq(decisionCausalityNodes.decisionId, id)).limit(1);
      if (!node) return;

      chain.push(node);
      agents.add(node.agentCodename);

      for (const childId of (node.childDecisionIds || [])) {
        await traverse(childId);
      }
    };

    await traverse(decisionId);

    const root = chain.find(n => n.decisionId === decisionId);
    const directChildren = root?.childDecisionIds?.length || 0;

    return {
      directChildren,
      totalDownstream: chain.length - 1, // exclude root
      affectedAgents: Array.from(agents),
      chain,
    };
  }

  /**
   * Rollback a decision and optionally its downstream chain.
   */
  async rollback(decisionId: string, reason: string, cascading = false): Promise<{
    rolledBack: string[];
    skipped: string[];
  }> {
    const rolledBack: string[] = [];
    const skipped: string[] = [];

    const rollbackNode = async (id: string) => {
      const [node] = await db.select().from(decisionCausalityNodes)
        .where(eq(decisionCausalityNodes.decisionId, id)).limit(1);
      if (!node) return;

      if (node.rollbackEligible) {
        await db.update(decisionCausalityNodes)
          .set({ outcome: "rolled_back", rolledBackAt: new Date(), rollbackReason: reason })
          .where(eq(decisionCausalityNodes.id, node.id));
        rolledBack.push(id);

        if (cascading) {
          for (const childId of (node.childDecisionIds || [])) {
            await rollbackNode(childId);
          }
        }
      } else {
        skipped.push(id);
      }
    };

    await rollbackNode(decisionId);

    return { rolledBack, skipped };
  }

  /**
   * Trace the full chain from a leaf back to the root.
   */
  async traceToRoot(decisionId: string): Promise<DecisionCausalityNode[]> {
    const chain: DecisionCausalityNode[] = [];
    let currentId: string | null = decisionId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const [node] = await db.select().from(decisionCausalityNodes)
        .where(eq(decisionCausalityNodes.decisionId, currentId)).limit(1);
      if (!node) break;
      chain.push(node);
      currentId = (node.parentDecisionIds || [])[0] || null;
    }

    return chain.reverse();
  }

  /**
   * Get the deepest decision chains.
   */
  async getDeepestChains(limit = 10): Promise<DecisionCausalityNode[]> {
    return db.select().from(decisionCausalityNodes)
      .orderBy(desc(decisionCausalityNodes.depth))
      .limit(limit);
  }

  /**
   * Get decisions with the largest blast radius.
   */
  async getMostCascading(limit = 10): Promise<DecisionCausalityNode[]> {
    return db.select().from(decisionCausalityNodes)
      .orderBy(desc(decisionCausalityNodes.blastRadius))
      .limit(limit);
  }

  async getRecent(limit = 30): Promise<DecisionCausalityNode[]> {
    return db.select().from(decisionCausalityNodes)
      .orderBy(desc(decisionCausalityNodes.createdAt)).limit(limit);
  }

  async getByAgent(agentCodename: string, limit = 20): Promise<DecisionCausalityNode[]> {
    return db.select().from(decisionCausalityNodes)
      .where(eq(decisionCausalityNodes.agentCodename, agentCodename))
      .orderBy(desc(decisionCausalityNodes.createdAt)).limit(limit);
  }

  private async recalculateBlastRadius(decisionId: string): Promise<void> {
    const { totalDownstream } = await this.getBlastRadius(decisionId);
    await db.update(decisionCausalityNodes)
      .set({ blastRadius: totalDownstream })
      .where(eq(decisionCausalityNodes.decisionId, decisionId));

    // Also update parents
    const [node] = await db.select().from(decisionCausalityNodes)
      .where(eq(decisionCausalityNodes.decisionId, decisionId)).limit(1);
    if (node) {
      for (const parentId of (node.parentDecisionIds || [])) {
        await this.recalculateBlastRadius(parentId);
      }
    }
  }
}

export const decisionCausalityService = new DecisionCausalityService();
