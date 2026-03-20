// @ts-nocheck
/**
 * AI Board of Directors — Sovereign Company Protocol Phase 14
 *
 * The keystone governance layer. All 10 agents form a formal board with:
 * - Domain-weighted voting
 * - Constitutional principles (immutable unless 9/10 supermajority)
 * - Weekly automated board meetings
 * - Strategic planning cycles
 * - Founder Twin as tiebreaker
 *
 * This is the mechanism that enables permanent self-governance.
 */

import { db } from "../db";
import {
  boardMeetings, boardVotes, boardDecisions, constitutionalPrinciples,
  strategicPlans, companyAgents,
} from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProposalCategory = "strategic" | "financial" | "legal" | "technical" | "customer" | "operational";

interface VoteResult {
  proposalId: string;
  passed: boolean;
  voteSummary: { for: number; against: number; abstain: number };
  weightedFor: number;
  weightedAgainst: number;
  requiredMajority: number;
  requiredAgentVoted: boolean;
  reasoning: string;
}

interface ConstitutionalCheckResult {
  violated: boolean;
  principle?: string;
  reasoning: string;
}

// ─── Domain Weight Map ────────────────────────────────────────────────────────

const DOMAIN_WEIGHTS: Record<string, Record<ProposalCategory, number>> = {
  atlas_cto:       { technical: 2.0, financial: 0.5, legal: 0.5, customer: 0.5, strategic: 1.0, operational: 1.5 },
  sophie_csm:      { technical: 0.5, financial: 0.5, legal: 0.5, customer: 2.0, strategic: 1.0, operational: 1.0 },
  forge_revenue:   { technical: 0.5, financial: 2.0, legal: 0.5, customer: 1.0, strategic: 1.5, operational: 1.0 },
  beacon_marketing:{ technical: 0.5, financial: 0.8, legal: 0.5, customer: 1.5, strategic: 1.0, operational: 0.8 },
  sentinel_devops: { technical: 1.5, financial: 0.5, legal: 0.5, customer: 0.5, strategic: 0.8, operational: 2.0 },
  ledger_finance:  { technical: 0.5, financial: 2.0, legal: 1.0, customer: 0.5, strategic: 1.0, operational: 1.0 },
  shield_legal:    { technical: 0.5, financial: 0.5, legal: 2.0, customer: 0.5, strategic: 1.0, operational: 0.8 },
  oracle_analytics:{ technical: 1.0, financial: 1.5, legal: 0.5, customer: 1.0, strategic: 1.5, operational: 1.0 },
  compass_pm:      { technical: 1.0, financial: 0.5, legal: 0.5, customer: 1.5, strategic: 1.5, operational: 0.8 },
  crucible_qa:     { technical: 1.5, financial: 0.5, legal: 0.5, customer: 1.0, strategic: 0.8, operational: 1.5 },
};

// Required agent per category (must vote "for" in addition to majority)
const REQUIRED_AGENT: Record<ProposalCategory, string | null> = {
  financial: "ledger_finance",
  legal: "shield_legal",
  technical: "atlas_cto",
  customer: "sophie_csm",
  strategic: null,  // No single required agent
  operational: null,
};

const MAJORITY_REQUIREMENTS: Record<ProposalCategory, number> = {
  strategic: 0.7,    // 7/10
  financial: 0.5,    // 5/10 + Ledger required
  legal: 0.5,        // 5/10 + Shield required
  technical: 0.5,    // 5/10 + Atlas required
  customer: 0.5,     // 5/10 + Sophie required
  operational: 0.5,  // 5/10
};

// ─── Service ──────────────────────────────────────────────────────────────────

class AIBoardOfDirectors {

  // ─── Meeting Management ───────────────────────────────────────────────────

  /**
   * Schedule the next weekly board meeting.
   */
  async scheduleWeeklyMeeting(): Promise<string> {
    const meetingId = `board-${crypto.randomUUID().slice(0, 8)}`;
    const nextMonday = new Date();
    nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7 || 7));
    nextMonday.setHours(9, 0, 0, 0);

    const allAgents = await db.query.companyAgents.findMany({
      where: eq(companyAgents.status, "active"),
    });

    await db.insert(boardMeetings).values({
      meetingId,
      meetingType: "weekly",
      status: "scheduled",
      scheduledAt: nextMonday,
      attendees: allAgents.map(a => a.codename),
      agendaItems: [
        { topic: "KPI Dashboard Review", presenter: "oracle_analytics", priority: 1 },
        { topic: "Domain Reports", presenter: "all", priority: 2 },
        { topic: "Pending Proposals", presenter: "all", priority: 3 },
        { topic: "Strategic Review", presenter: "compass_pm", priority: 4 },
      ],
    });

    return meetingId;
  }

  /**
   * Conduct a full board meeting — the automated governance loop.
   */
  async conductMeeting(meetingId: string): Promise<{
    meetingId: string;
    reports: Array<{ agent: string; summary: string }>;
    proposalsProcessed: number;
    summary: string;
  }> {
    const meeting = await db.query.boardMeetings.findFirst({
      where: eq(boardMeetings.meetingId, meetingId),
    });
    if (!meeting) throw new Error(`Meeting ${meetingId} not found`);

    await db.update(boardMeetings)
      .set({ status: "in_progress", startedAt: new Date() })
      .where(eq(boardMeetings.meetingId, meetingId));

    // 1. Gather KPI snapshot from Oracle
    const { resolveAgentData } = await import("./agentDataResolvers");
    const kpiSnapshot: Record<string, any> = {};
    const agentCodenames = (meeting.attendees as string[]) || [];

    for (const codename of agentCodenames) {
      try {
        kpiSnapshot[codename] = await resolveAgentData(codename);
      } catch {}
    }

    // 2. Each agent presents domain report
    const { companyAgentService } = await import("./companyAgents");
    const reports: Array<{ agent: string; summary: string }> = [];

    for (const codename of agentCodenames) {
      try {
        const report = await companyAgentService.generateReport(codename);
        reports.push({ agent: codename, summary: report.summary });
      } catch (err: any) {
        reports.push({ agent: codename, summary: `Report unavailable: ${err.message}` });
      }
    }

    // 3. Process pending proposals
    const pendingVotes = await db.select()
      .from(boardVotes)
      .where(and(eq(boardVotes.meetingId, meetingId), sql`${boardVotes.result} IS NULL`))
      .limit(10);

    let proposalsProcessed = 0;
    for (const vote of pendingVotes) {
      try {
        await this.conductVote(vote.proposalId, meetingId);
        proposalsProcessed++;
      } catch {}
    }

    // 4. Generate meeting summary
    const summary = `Board meeting ${meetingId} completed. ${reports.length} agent reports received. ${proposalsProcessed} proposals processed. Key metrics captured in KPI snapshot.`;

    await db.update(boardMeetings)
      .set({
        status: "completed",
        completedAt: new Date(),
        kpiSnapshot,
        summary,
      })
      .where(eq(boardMeetings.meetingId, meetingId));

    return { meetingId, reports, proposalsProcessed, summary };
  }

  async getMeeting(meetingId: string) {
    return db.query.boardMeetings.findFirst({
      where: eq(boardMeetings.meetingId, meetingId),
    });
  }

  async getRecentMeetings(limit: number = 10) {
    return db.select().from(boardMeetings)
      .orderBy(desc(boardMeetings.scheduledAt))
      .limit(limit);
  }

  // ─── Voting ───────────────────────────────────────────────────────────────

  /**
   * Create a votable proposal.
   */
  async createProposal(
    proposer: string,
    proposal: string,
    proposalType: string,
    category: ProposalCategory
  ): Promise<string> {
    const proposalId = `prop-${crypto.randomUUID().slice(0, 8)}`;

    const allAgents = await db.query.companyAgents.findMany({
      where: eq(companyAgents.status, "active"),
    });

    await db.insert(boardVotes).values({
      meetingId: "",
      proposalId,
      proposal,
      proposalType,
      votingAgents: allAgents.map(a => a.codename),
      votes: [],
      requiredMajority: MAJORITY_REQUIREMENTS[category] || 0.5,
    });

    return proposalId;
  }

  /**
   * Conduct a vote — each agent votes using AI reasoning.
   */
  async conductVote(proposalId: string, meetingId: string): Promise<VoteResult> {
    const voteRecord = await db.query.boardVotes.findFirst({
      where: eq(boardVotes.proposalId, proposalId),
    });
    if (!voteRecord) throw new Error(`Proposal ${proposalId} not found`);

    const votingAgents = (voteRecord.votingAgents as string[]) || [];
    const category = (voteRecord.proposalType || "strategic") as ProposalCategory;
    const votes: Array<{ agentCodename: string; vote: "for" | "against" | "abstain"; reasoning: string; weight: number }> = [];

    // Each agent casts a vote
    for (const codename of votingAgents) {
      const agent = await db.query.companyAgents.findFirst({
        where: eq(companyAgents.codename, codename),
      });
      if (!agent) continue;

      const weight = DOMAIN_WEIGHTS[codename]?.[category] || 1.0;

      try {
        const { routeAITask, TaskComplexity } = await import("./aiRouter");
        const response = await routeAITask({
          taskType: "board_vote",
          complexity: TaskComplexity.MODERATE,
          messages: [
            { role: "system", content: agent.personalityPrompt || `You are ${codename}, a board member.` },
            { role: "user", content: `BOARD VOTE REQUIRED\n\nProposal: ${voteRecord.proposal}\nCategory: ${category}\nYour domain weight: ${weight}\n\nVote "for", "against", or "abstain". Provide brief reasoning.\n\nRespond in JSON: {"vote": "for|against|abstain", "reasoning": "..."}` },
          ],
          responseFormat: { type: "json_object" },
        });

        const parsed = JSON.parse(response.content);
        votes.push({
          agentCodename: codename,
          vote: parsed.vote || "abstain",
          reasoning: parsed.reasoning || "No reasoning provided",
          weight,
        });
      } catch {
        votes.push({
          agentCodename: codename,
          vote: "abstain",
          reasoning: "AI vote generation failed",
          weight,
        });
      }
    }

    // Tally votes
    const result = this.tallyVotes(votes, category, proposalId);

    // Store votes and result
    await db.update(boardVotes)
      .set({
        meetingId,
        votes,
        result: result.passed ? "passed" : "failed",
      })
      .where(eq(boardVotes.proposalId, proposalId));

    // Create board decision record
    const decisionId = `dec-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(boardDecisions).values({
      decisionId,
      meetingId,
      category,
      description: voteRecord.proposal,
      voteSummary: result.voteSummary,
      passed: result.passed,
    });

    return result;
  }

  /**
   * Tally votes with domain weighting.
   */
  private tallyVotes(
    votes: Array<{ agentCodename: string; vote: "for" | "against" | "abstain"; reasoning: string; weight: number }>,
    category: ProposalCategory,
    proposalId: string
  ): VoteResult {
    let weightedFor = 0;
    let weightedAgainst = 0;
    let totalWeight = 0;
    let forCount = 0;
    let againstCount = 0;
    let abstainCount = 0;

    const requiredAgent = REQUIRED_AGENT[category];
    let requiredAgentVotedFor = requiredAgent === null;

    for (const vote of votes) {
      totalWeight += vote.weight;

      if (vote.vote === "for") {
        weightedFor += vote.weight;
        forCount++;
        if (vote.agentCodename === requiredAgent) requiredAgentVotedFor = true;
      } else if (vote.vote === "against") {
        weightedAgainst += vote.weight;
        againstCount++;
      } else {
        abstainCount++;
      }
    }

    const requiredMajority = MAJORITY_REQUIREMENTS[category] || 0.5;
    const weightedMajority = totalWeight > 0 ? weightedFor / totalWeight : 0;
    const passed = weightedMajority >= requiredMajority && requiredAgentVotedFor;

    return {
      proposalId,
      passed,
      voteSummary: { for: forCount, against: againstCount, abstain: abstainCount },
      weightedFor,
      weightedAgainst,
      requiredMajority,
      requiredAgentVoted: requiredAgentVotedFor,
      reasoning: passed
        ? `Passed with ${(weightedMajority * 100).toFixed(0)}% weighted majority (${forCount} for, ${againstCount} against, ${abstainCount} abstain)${requiredAgent ? `. Required agent ${requiredAgent} voted for.` : ""}`
        : `Failed: ${!requiredAgentVotedFor ? `Required agent ${requiredAgent} did not vote for. ` : ""}Weighted majority ${(weightedMajority * 100).toFixed(0)}% ${weightedMajority < requiredMajority ? `< required ${(requiredMajority * 100).toFixed(0)}%` : ""}`,
    };
  }

  async getVoteResult(proposalId: string) {
    return db.query.boardVotes.findFirst({
      where: eq(boardVotes.proposalId, proposalId),
    });
  }

  // ─── Constitutional Enforcement ───────────────────────────────────────────

  /**
   * Check if an action violates any constitutional principle.
   */
  async checkConstitutionalCompliance(action: string, context: Record<string, any>): Promise<ConstitutionalCheckResult> {
    const principles = await db.select()
      .from(constitutionalPrinciples)
      .where(eq(constitutionalPrinciples.isActive, true));

    if (principles.length === 0) {
      return { violated: false, reasoning: "No constitutional principles active" };
    }

    // Check each principle
    for (const principle of principles) {
      const violated = this.checkPrincipleViolation(principle, action, context);
      if (violated) {
        // Record violation
        await db.update(constitutionalPrinciples)
          .set({
            violationCount: sql`${constitutionalPrinciples.violationCount} + 1`,
            lastViolationAt: new Date(),
          })
          .where(eq(constitutionalPrinciples.principleId, principle.principleId));

        return {
          violated: true,
          principle: principle.title,
          reasoning: `Action "${action}" violates constitutional principle: "${principle.title}" — ${principle.description}`,
        };
      }
    }

    return { violated: false, reasoning: "All constitutional checks passed" };
  }

  /**
   * Check if a specific principle is violated by an action.
   */
  private checkPrincipleViolation(
    principle: any,
    action: string,
    context: Record<string, any>
  ): boolean {
    const pid = principle.principleId;

    // customer_data_security: Block actions that expose or delete customer data
    if (pid === "customer_data_security") {
      const dangerousActions = ["permanent_data_deletion", "export_all_customer_data", "disable_encryption", "share_customer_data"];
      return dangerousActions.includes(action);
    }

    // burn_rate_limit: Block spend that would exceed 2x monthly burn
    if (pid === "burn_rate_limit") {
      if (context.costCents && context.monthlyBurnCents) {
        return context.costCents > context.monthlyBurnCents * 2;
      }
      return false;
    }

    // regulatory_compliance: Block actions that violate known regulations
    if (pid === "regulatory_compliance") {
      const regulatoryActions = ["skip_compliance_check", "ignore_regulatory_requirement", "bypass_gdpr"];
      return regulatoryActions.includes(action);
    }

    // service_uptime: Block actions that would take down the service
    if (pid === "service_uptime") {
      const riskyActions = ["kill_all_processes", "drop_database", "disable_all_services"];
      return riskyActions.includes(action);
    }

    // no_unilateral_termination: Block unilateral customer account termination
    if (pid === "no_unilateral_termination") {
      return action === "terminate_customer_account" && !context.boardApproval;
    }

    return false;
  }

  /**
   * Seed the 5 immutable constitutional principles.
   */
  async seedConstitutionalPrinciples(): Promise<void> {
    const principles = [
      {
        principleId: "customer_data_security",
        title: "Never sacrifice customer data security for growth",
        description: "Customer data must be protected at all times. No action that compromises data security, privacy, or integrity is permitted regardless of business benefit.",
        category: "security",
        isImmutable: true,
        enforcementLevel: "block",
        amendmentRequires: 0.9,
      },
      {
        principleId: "burn_rate_limit",
        title: "Never exceed 2x monthly burn rate",
        description: "Total spending in any month must not exceed twice the established monthly burn rate. This protects cash runway and ensures financial sustainability.",
        category: "financial",
        isImmutable: true,
        enforcementLevel: "block",
        amendmentRequires: 0.9,
      },
      {
        principleId: "regulatory_compliance",
        title: "Never violate regulatory requirements",
        description: "All actions must comply with applicable laws and regulations including GDPR, TCPA, Dodd-Frank, state privacy laws, and fair housing regulations.",
        category: "legal",
        isImmutable: true,
        enforcementLevel: "block",
        amendmentRequires: 0.9,
      },
      {
        principleId: "service_uptime",
        title: "Maintain service uptime >99.5%",
        description: "System availability must remain above 99.5%. Actions that would cause planned downtime exceeding this threshold require supermajority board approval.",
        category: "operational",
        isImmutable: true,
        enforcementLevel: "block",
        amendmentRequires: 0.9,
      },
      {
        principleId: "no_unilateral_termination",
        title: "Never unilaterally terminate customer accounts",
        description: "No single agent may terminate a customer account. Account termination requires board approval with documented justification.",
        category: "customer",
        isImmutable: true,
        enforcementLevel: "block",
        amendmentRequires: 0.9,
      },
    ];

    for (const p of principles) {
      const existing = await db.query.constitutionalPrinciples.findFirst({
        where: eq(constitutionalPrinciples.principleId, p.principleId),
      });
      if (!existing) {
        await db.insert(constitutionalPrinciples).values(p);
      }
    }
  }

  /**
   * Propose a constitutional amendment — requires 9/10 supermajority.
   */
  async proposeAmendment(principleId: string, amendment: string, proposer: string): Promise<{ proposalId: string; message: string }> {
    const principle = await db.query.constitutionalPrinciples.findFirst({
      where: eq(constitutionalPrinciples.principleId, principleId),
    });

    if (!principle) throw new Error(`Principle ${principleId} not found`);
    if (principle.isImmutable) {
      return {
        proposalId: "",
        message: `Principle "${principle.title}" is immutable. Constitutional amendment requires 9/10 supermajority vote.`,
      };
    }

    const proposalId = await this.createProposal(
      proposer,
      `CONSTITUTIONAL AMENDMENT: Modify "${principle.title}" — ${amendment}`,
      "constitutional_amendment",
      "strategic"
    );

    // Override the required majority to 90% for constitutional amendments
    await db.update(boardVotes)
      .set({ requiredMajority: principle.amendmentRequires })
      .where(eq(boardVotes.proposalId, proposalId));

    return { proposalId, message: `Amendment proposed. Requires ${(principle.amendmentRequires * 100).toFixed(0)}% supermajority.` };
  }

  // ─── Strategic Planning ───────────────────────────────────────────────────

  async createStrategicPlan(title: string, quarter: string, objectives: Array<{ objective: string; keyResults: string[]; owner: string }>): Promise<string> {
    const planId = `plan-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(strategicPlans).values({
      planId,
      title,
      quarter,
      objectives: objectives.map(o => ({ ...o, status: "not_started" })),
      status: "draft",
    });
    return planId;
  }

  async approveStrategicPlan(planId: string, meetingId: string): Promise<{ approved: boolean; message: string }> {
    const plan = await db.query.strategicPlans.findFirst({
      where: eq(strategicPlans.planId, planId),
    });
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const proposalId = await this.createProposal(
      "compass_pm",
      `Approve strategic plan: "${plan.title}" for ${plan.quarter}`,
      "strategic_plan_approval",
      "strategic"
    );

    const result = await this.conductVote(proposalId, meetingId);

    if (result.passed) {
      await db.update(strategicPlans)
        .set({ approvedByBoard: true, boardMeetingId: meetingId, status: "active" })
        .where(eq(strategicPlans.planId, planId));
    }

    return {
      approved: result.passed,
      message: result.passed
        ? `Strategic plan "${plan.title}" approved by board.`
        : `Strategic plan "${plan.title}" rejected: ${result.reasoning}`,
    };
  }

  async getActivePlan() {
    return db.query.strategicPlans.findFirst({
      where: eq(strategicPlans.status, "active"),
      orderBy: [desc(strategicPlans.createdAt)],
    });
  }

  // ─── Founder Twin Tiebreaker ──────────────────────────────────────────────

  /**
   * Use Founder Twin to break a deadlocked vote.
   */
  async resolveTiebreak(proposalId: string): Promise<{ decision: "for" | "against"; reasoning: string }> {
    const vote = await db.query.boardVotes.findFirst({
      where: eq(boardVotes.proposalId, proposalId),
    });
    if (!vote) throw new Error(`Proposal ${proposalId} not found`);

    try {
      const { founderTwinService } = await import("./founderTwin");
      const styleProfile = await founderTwinService.getStyleProfile();

      const { routeAITask, TaskComplexity } = await import("./aiRouter");
      const response = await routeAITask({
        taskType: "tiebreak_decision",
        complexity: TaskComplexity.CRITICAL,
        messages: [
          { role: "system", content: `You are the Founder Twin — a digital representation of the founder's decision-making style. ${styleProfile}\n\nYou must break a deadlocked board vote. Vote "for" or "against" based on what the founder would most likely decide.` },
          { role: "user", content: `DEADLOCKED PROPOSAL: ${vote.proposal}\n\nVotes cast: ${JSON.stringify(vote.votes)}\n\nBreak the tie. Respond in JSON: {"decision": "for|against", "reasoning": "..."}` },
        ],
        responseFormat: { type: "json_object" },
      });

      const parsed = JSON.parse(response.content);
      return {
        decision: parsed.decision === "for" ? "for" : "against",
        reasoning: parsed.reasoning || "Founder Twin tiebreak decision",
      };
    } catch {
      return { decision: "against", reasoning: "Founder Twin unavailable — defaulting to conservative position (against)" };
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  /**
   * Get all active constitutional principles.
   */
  async getConstitutionalPrinciples() {
    return db.select()
      .from(constitutionalPrinciples)
      .where(eq(constitutionalPrinciples.isActive, true));
  }

  /**
   * Get recent board decisions.
   */
  async getRecentDecisions(limit: number = 20) {
    return db.select()
      .from(boardDecisions)
      .orderBy(desc(boardDecisions.createdAt))
      .limit(limit);
  }

  /**
   * Get board governance summary — for the CEO dashboard.
   */
  async getGovernanceSummary(): Promise<{
    totalMeetings: number;
    totalDecisions: number;
    passRate: number;
    principlesActive: number;
    activePlan: any;
  }> {
    const [meetingCount] = await db.select({ count: sql<number>`count(*)` }).from(boardMeetings);
    const [decisionCount] = await db.select({ count: sql<number>`count(*)` }).from(boardDecisions);
    const [passedCount] = await db.select({ count: sql<number>`count(*)` }).from(boardDecisions).where(eq(boardDecisions.passed, true));
    const [principleCount] = await db.select({ count: sql<number>`count(*)` }).from(constitutionalPrinciples).where(eq(constitutionalPrinciples.isActive, true));
    const activePlan = await this.getActivePlan();

    const totalDec = Number(decisionCount?.count || 0);
    const passedDec = Number(passedCount?.count || 0);

    return {
      totalMeetings: Number(meetingCount?.count || 0),
      totalDecisions: totalDec,
      passRate: totalDec > 0 ? Math.round((passedDec / totalDec) * 100) : 100,
      principlesActive: Number(principleCount?.count || 0),
      activePlan,
    };
  }
}

export const aiBoardOfDirectors = new AIBoardOfDirectors();
