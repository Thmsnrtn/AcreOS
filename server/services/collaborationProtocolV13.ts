/**
 * Agent Collaboration Protocol — Sovereign Company Protocol v13
 *
 * Manages multi-agent dialogues with consensus mechanisms, task delegation
 * with SLA enforcement, reputation tracking, and skill-based agent discovery.
 */

import { db } from "../db";
import {
  agentDialogues,
  dialogueMessages,
  agentDelegations,
  agentReputationVotes,
  agentSkillRegistry,
} from "@shared/schema";
import { eq, and, desc, sql, gte, count } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpenDialogueInput {
  topic: string;
  participants: string[];
  consensusMechanism?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  orgId?: number;
}

interface AddMessageInput {
  fromAgent: string;
  messageType: string;
  content: string;
  evidence?: Record<string, any>;
  vote?: string;
  confidence?: number;
}

interface DelegateInput {
  fromAgent: string;
  toAgent: string;
  task: string;
  taskContext?: Record<string, any>;
  slaDeadline?: Date;
  slaQualityThreshold?: number;
  orgId?: number;
}

interface UpdateDelegationInput {
  status: string;
  result?: Record<string, any>;
  qualityScore?: number;
}

interface RateAgentInput {
  voterAgent: string;
  subjectAgent: string;
  dimension: string;
  score: number;
  evidence?: string;
  dialogueId?: string;
  delegationId?: string;
  orgId?: number;
}

interface RegisterSkillInput {
  agentCodename: string;
  skillName: string;
  skillDescription: string;
  proficiency?: number;
}

interface ConsensusResult {
  reached: boolean;
  resolution?: string;
  votes: Record<string, string>;
}

interface ReputationBreakdown {
  agentCodename: string;
  overallAverage: number;
  totalVotes: number;
  dimensions: Record<string, { average: number; count: number }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class CollaborationProtocolService {
  // ── Dialogues ─────────────────────────────────────────────────────────────

  /**
   * Open a new multi-agent dialogue with a specified consensus mechanism.
   */
  async openDialogue(data: OpenDialogueInput) {
    const dialogueId = crypto.randomUUID();

    const [dialogue] = await db
      .insert(agentDialogues)
      .values({
        dialogueId,
        topic: data.topic,
        participants: data.participants,
        consensusMechanism: data.consensusMechanism ?? "majority",
        status: "open",
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        orgId: data.orgId,
      })
      .returning();

    return dialogue;
  }

  /**
   * Add a message to an existing dialogue. If the message is a vote,
   * automatically check whether consensus has been reached.
   */
  async addMessage(dialogueId: string, data: AddMessageInput) {
    // Fetch the dialogue to validate participant membership
    const [dialogue] = await db
      .select()
      .from(agentDialogues)
      .where(eq(agentDialogues.dialogueId, dialogueId))
      .limit(1);

    if (!dialogue) {
      throw new Error(`Dialogue not found: ${dialogueId}`);
    }

    if (dialogue.status !== "open") {
      throw new Error(`Dialogue ${dialogueId} is not open (status: ${dialogue.status})`);
    }

    // Validate that fromAgent is a participant
    const participants = dialogue.participants as string[];
    if (!participants.includes(data.fromAgent)) {
      throw new Error(
        `Agent "${data.fromAgent}" is not a participant in dialogue ${dialogueId}`
      );
    }

    // Insert the message
    const [message] = await db
      .insert(dialogueMessages)
      .values({
        dialogueId,
        fromAgent: data.fromAgent,
        messageType: data.messageType,
        content: data.content,
        evidence: data.evidence,
        vote: data.vote,
        confidence: data.confidence,
      })
      .returning();

    // If this is a vote, check if all participants have voted and evaluate consensus
    if (data.messageType === "vote") {
      const voteMessages = await db
        .select()
        .from(dialogueMessages)
        .where(
          and(
            eq(dialogueMessages.dialogueId, dialogueId),
            eq(dialogueMessages.messageType, "vote")
          )
        );

      // Deduplicate: keep only the latest vote per agent
      const latestVotes = new Map<string, string>();
      for (const vm of voteMessages) {
        latestVotes.set(vm.fromAgent, vm.vote ?? "abstain");
      }

      // Check if all participants have voted
      const allVoted = participants.every((p) => latestVotes.has(p));

      if (allVoted) {
        const consensus = this.evaluateConsensus(
          dialogue.consensusMechanism,
          latestVotes,
          participants
        );

        if (consensus.reached && consensus.resolution) {
          await this.resolveDialogue(dialogueId, consensus.resolution);
        } else if (dialogue.consensusMechanism === "ceo_tiebreak") {
          // Check for 50/50 split → escalate
          const voteCounts = new Map<string, number>();
          for (const v of latestVotes.values()) {
            voteCounts.set(v, (voteCounts.get(v) ?? 0) + 1);
          }
          const counts = [...voteCounts.values()];
          const isTied = counts.length === 2 && counts[0] === counts[1];
          if (isTied) {
            await db
              .update(agentDialogues)
              .set({ status: "escalated" })
              .where(eq(agentDialogues.dialogueId, dialogueId));
          }
        }
      }
    }

    return message;
  }

  /**
   * Evaluate consensus for a dialogue based on its mechanism.
   */
  private evaluateConsensus(
    mechanism: string,
    votes: Map<string, string>,
    participants: string[]
  ): ConsensusResult {
    const voteRecord: Record<string, string> = {};
    for (const [agent, vote] of votes.entries()) {
      voteRecord[agent] = vote;
    }

    const voteValues = [...votes.values()].filter((v) => v !== "abstain");
    if (voteValues.length === 0) {
      return { reached: false, votes: voteRecord };
    }

    // Count occurrences of each vote value
    const tallies = new Map<string, number>();
    for (const v of voteValues) {
      tallies.set(v, (tallies.get(v) ?? 0) + 1);
    }

    switch (mechanism) {
      case "majority": {
        // >50% of non-abstain votes must be the same
        const threshold = voteValues.length / 2;
        for (const [value, count] of tallies.entries()) {
          if (count > threshold) {
            return { reached: true, resolution: value, votes: voteRecord };
          }
        }
        return { reached: false, votes: voteRecord };
      }

      case "weighted": {
        // Weighted by simple average (equal weight for now)
        // Same as majority until trust scores are integrated
        const threshold = voteValues.length / 2;
        for (const [value, count] of tallies.entries()) {
          if (count > threshold) {
            return { reached: true, resolution: value, votes: voteRecord };
          }
        }
        return { reached: false, votes: voteRecord };
      }

      case "unanimous": {
        // All non-abstain votes must be the same
        if (tallies.size === 1) {
          const resolution = voteValues[0];
          return { reached: true, resolution, votes: voteRecord };
        }
        return { reached: false, votes: voteRecord };
      }

      case "ceo_tiebreak": {
        // Majority rules, but ties are escalated (handled in addMessage)
        const threshold = voteValues.length / 2;
        for (const [value, count] of tallies.entries()) {
          if (count > threshold) {
            return { reached: true, resolution: value, votes: voteRecord };
          }
        }
        return { reached: false, votes: voteRecord };
      }

      default:
        return { reached: false, votes: voteRecord };
    }
  }

  /**
   * Check consensus status for a dialogue without side effects.
   */
  async checkConsensus(dialogueId: string): Promise<ConsensusResult> {
    const [dialogue] = await db
      .select()
      .from(agentDialogues)
      .where(eq(agentDialogues.dialogueId, dialogueId))
      .limit(1);

    if (!dialogue) {
      throw new Error(`Dialogue not found: ${dialogueId}`);
    }

    const participants = dialogue.participants as string[];

    const voteMessages = await db
      .select()
      .from(dialogueMessages)
      .where(
        and(
          eq(dialogueMessages.dialogueId, dialogueId),
          eq(dialogueMessages.messageType, "vote")
        )
      );

    const latestVotes = new Map<string, string>();
    for (const vm of voteMessages) {
      latestVotes.set(vm.fromAgent, vm.vote ?? "abstain");
    }

    return this.evaluateConsensus(
      dialogue.consensusMechanism,
      latestVotes,
      participants
    );
  }

  /**
   * Resolve a dialogue with a final resolution string.
   */
  async resolveDialogue(dialogueId: string, resolution: string) {
    const [updated] = await db
      .update(agentDialogues)
      .set({
        status: "consensus_reached",
        resolution,
        resolvedAt: new Date(),
      })
      .where(eq(agentDialogues.dialogueId, dialogueId))
      .returning();

    if (!updated) {
      throw new Error(`Dialogue not found: ${dialogueId}`);
    }

    return updated;
  }

  // ── Delegations ───────────────────────────────────────────────────────────

  /**
   * Create a task delegation from one agent to another with optional SLA constraints.
   */
  async delegate(data: DelegateInput) {
    const delegationId = crypto.randomUUID();

    const [delegation] = await db
      .insert(agentDelegations)
      .values({
        delegationId,
        fromAgent: data.fromAgent,
        toAgent: data.toAgent,
        task: data.task,
        taskContext: data.taskContext ?? {},
        slaDeadline: data.slaDeadline,
        slaQualityThreshold: data.slaQualityThreshold,
        status: "pending",
        orgId: data.orgId,
      })
      .returning();

    return delegation;
  }

  /**
   * Update delegation status. Flags quality violations when score is below SLA threshold.
   */
  async updateDelegation(delegationId: string, data: UpdateDelegationInput) {
    // Fetch the current delegation to check SLA threshold
    const [existing] = await db
      .select()
      .from(agentDelegations)
      .where(eq(agentDelegations.delegationId, delegationId))
      .limit(1);

    if (!existing) {
      throw new Error(`Delegation not found: ${delegationId}`);
    }

    const updatePayload: Record<string, any> = {
      status: data.status,
    };

    if (data.result !== undefined) {
      updatePayload.result = data.result;
    }

    if (data.qualityScore !== undefined) {
      updatePayload.qualityScore = data.qualityScore;
    }

    if (data.status === "completed") {
      updatePayload.completedAt = new Date();
    }

    const [updated] = await db
      .update(agentDelegations)
      .set(updatePayload)
      .where(eq(agentDelegations.delegationId, delegationId))
      .returning();

    // Flag quality SLA violations
    let slaViolation = false;
    if (
      data.qualityScore !== undefined &&
      existing.slaQualityThreshold !== null &&
      data.qualityScore < existing.slaQualityThreshold
    ) {
      slaViolation = true;
      logger.warn(`[collaboration] SLA quality violation on delegation ${delegationId}: ` +
        `score ${data.qualityScore} < threshold ${existing.slaQualityThreshold}`);
    }

    return { ...updated, slaViolation };
  }

  // ── Reputation ────────────────────────────────────────────────────────────

  /**
   * Submit a reputation vote for an agent on a specific dimension.
   */
  async rateAgent(data: RateAgentInput) {
    const [vote] = await db
      .insert(agentReputationVotes)
      .values({
        voterAgent: data.voterAgent,
        subjectAgent: data.subjectAgent,
        dimension: data.dimension,
        score: data.score,
        evidence: data.evidence,
        dialogueId: data.dialogueId,
        delegationId: data.delegationId,
        orgId: data.orgId,
      })
      .returning();

    return vote;
  }

  /**
   * Get aggregated reputation scores for an agent across all dimensions.
   */
  async getAgentReputation(agentCodename: string): Promise<ReputationBreakdown> {
    const votes = await db
      .select()
      .from(agentReputationVotes)
      .where(eq(agentReputationVotes.subjectAgent, agentCodename));

    if (votes.length === 0) {
      return {
        agentCodename,
        overallAverage: 0,
        totalVotes: 0,
        dimensions: {},
      };
    }

    // Build per-dimension breakdown
    const dimensionMap = new Map<string, { total: number; count: number }>();
    let overallSum = 0;

    for (const v of votes) {
      overallSum += v.score;
      const existing = dimensionMap.get(v.dimension);
      if (existing) {
        existing.total += v.score;
        existing.count += 1;
      } else {
        dimensionMap.set(v.dimension, { total: v.score, count: 1 });
      }
    }

    const dimensions: Record<string, { average: number; count: number }> = {};
    for (const [dim, stats] of dimensionMap.entries()) {
      dimensions[dim] = {
        average: Math.round((stats.total / stats.count) * 100) / 100,
        count: stats.count,
      };
    }

    return {
      agentCodename,
      overallAverage: Math.round((overallSum / votes.length) * 100) / 100,
      totalVotes: votes.length,
      dimensions,
    };
  }

  // ── Skill Registry ────────────────────────────────────────────────────────

  /**
   * Register or update a skill entry for an agent.
   */
  async registerSkill(data: RegisterSkillInput) {
    // Check if skill already exists for this agent
    const [existing] = await db
      .select()
      .from(agentSkillRegistry)
      .where(
        and(
          eq(agentSkillRegistry.agentCodename, data.agentCodename),
          eq(agentSkillRegistry.skillName, data.skillName)
        )
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(agentSkillRegistry)
        .set({
          skillDescription: data.skillDescription,
          proficiency: data.proficiency ?? existing.proficiency,
          updatedAt: new Date(),
        })
        .where(eq(agentSkillRegistry.id, existing.id))
        .returning();

      return updated;
    }

    const [skill] = await db
      .insert(agentSkillRegistry)
      .values({
        agentCodename: data.agentCodename,
        skillName: data.skillName,
        skillDescription: data.skillDescription,
        proficiency: data.proficiency ?? 50,
        isAdvertised: true,
      })
      .returning();

    return skill;
  }

  /**
   * Find the best agent(s) for a given skill, sorted by proficiency descending.
   */
  async findAgentForSkill(skillName: string, minProficiency?: number) {
    const threshold = minProficiency ?? 30;

    const agents = await db
      .select()
      .from(agentSkillRegistry)
      .where(
        and(
          eq(agentSkillRegistry.skillName, skillName),
          eq(agentSkillRegistry.isAdvertised, true),
          gte(agentSkillRegistry.proficiency, threshold)
        )
      )
      .orderBy(desc(agentSkillRegistry.proficiency));

    return agents;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Get all open dialogues, optionally filtered by org, with message counts.
   */
  async getActiveDialogues(orgId?: number) {
    const conditions = [eq(agentDialogues.status, "open")];
    if (orgId !== undefined) {
      conditions.push(eq(agentDialogues.orgId, orgId));
    }

    const dialogues = await db
      .select({
        id: agentDialogues.id,
        dialogueId: agentDialogues.dialogueId,
        topic: agentDialogues.topic,
        participants: agentDialogues.participants,
        consensusMechanism: agentDialogues.consensusMechanism,
        status: agentDialogues.status,
        relatedEntityType: agentDialogues.relatedEntityType,
        relatedEntityId: agentDialogues.relatedEntityId,
        orgId: agentDialogues.orgId,
        createdAt: agentDialogues.createdAt,
        messageCount: sql<number>`cast(count(${dialogueMessages.id}) as int)`,
      })
      .from(agentDialogues)
      .leftJoin(
        dialogueMessages,
        eq(agentDialogues.dialogueId, dialogueMessages.dialogueId)
      )
      .where(and(...conditions))
      .groupBy(
        agentDialogues.id,
        agentDialogues.dialogueId,
        agentDialogues.topic,
        agentDialogues.participants,
        agentDialogues.consensusMechanism,
        agentDialogues.status,
        agentDialogues.relatedEntityType,
        agentDialogues.relatedEntityId,
        agentDialogues.orgId,
        agentDialogues.createdAt
      )
      .orderBy(desc(agentDialogues.createdAt));

    return dialogues;
  }

  /**
   * Get aggregate stats for the collaboration protocol.
   */
  async getStats(orgId?: number) {
    const orgFilter = orgId !== undefined;

    // Active dialogues count
    const dialogueConditions = [eq(agentDialogues.status, "open")];
    if (orgFilter) {
      dialogueConditions.push(eq(agentDialogues.orgId, orgId!));
    }
    const [{ activeDialogues }] = await db
      .select({ activeDialogues: sql<number>`cast(count(*) as int)` })
      .from(agentDialogues)
      .where(and(...dialogueConditions));

    // Total delegations + average quality
    const delegationConditions = orgFilter
      ? [eq(agentDelegations.orgId, orgId!)]
      : [];
    const [delegationStats] = await db
      .select({
        totalDelegations: sql<number>`cast(count(*) as int)`,
        avgQuality: sql<number>`round(avg(${agentDelegations.qualityScore})::numeric, 2)`,
      })
      .from(agentDelegations)
      .where(delegationConditions.length > 0 ? and(...delegationConditions) : undefined);

    // Reputation vote count
    const reputationConditions = orgFilter
      ? [eq(agentReputationVotes.orgId, orgId!)]
      : [];
    const [{ reputationVoteCount }] = await db
      .select({ reputationVoteCount: sql<number>`cast(count(*) as int)` })
      .from(agentReputationVotes)
      .where(reputationConditions.length > 0 ? and(...reputationConditions) : undefined);

    // Skills registered (global, not org-scoped)
    const [{ skillsRegistered }] = await db
      .select({ skillsRegistered: sql<number>`cast(count(*) as int)` })
      .from(agentSkillRegistry);

    return {
      activeDialogues,
      totalDelegations: delegationStats.totalDelegations,
      avgDelegationQuality: delegationStats.avgQuality ?? 0,
      reputationVoteCount,
      skillsRegistered,
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const collaborationProtocolService = new CollaborationProtocolService();
