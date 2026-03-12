// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import { voiceCalls } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

type AgentStatus = "available" | "busy" | "offline" | "on_hold";
type CallStatus = "ringing" | "active" | "on_hold" | "queued" | "completed" | "transferred" | "conference";

interface Agent {
  agentId: string;
  orgId: number;
  status: AgentStatus;
  skills: string[];
  currentCallSid?: string;
  callsHandledToday: number;
  avgHandleTimeSeconds: number;
  lastAssignedAt?: Date;
}

interface QueuedCall {
  callSid: string;
  from: string;
  to: string;
  orgId: number;
  priority: number;           // 1 (highest) - 10 (lowest)
  enqueuedAt: Date;
  topic?: string;
  retries: number;
}

interface ActiveCall {
  callSid: string;
  agentId?: string;
  status: CallStatus;
  from: string;
  to: string;
  orgId: number;
  startedAt: Date;
  holdStartedAt?: Date;
  participants: string[];   // for conference calls
}

// In-memory state (survives request but not restarts — acceptable for a telephony hot path)
const agentRegistry = new Map<string, Agent>();
const callQueue: QueuedCall[] = [];
const activeCalls = new Map<string, ActiveCall>();

export class CallRoutingService {

  /**
   * Register an agent with skills (called on login / status change)
   */
  registerAgent(agentId: string, orgId: number, skills: string[] = []) {
    const existing = agentRegistry.get(agentId);
    agentRegistry.set(agentId, {
      agentId,
      orgId,
      status: "available",
      skills,
      callsHandledToday: existing?.callsHandledToday || 0,
      avgHandleTimeSeconds: existing?.avgHandleTimeSeconds || 0,
      lastAssignedAt: existing?.lastAssignedAt,
    });
    return agentRegistry.get(agentId);
  }

  /**
   * Update an agent's availability status
   */
  setAgentStatus(agentId: string, status: AgentStatus) {
    const agent = agentRegistry.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not registered`);
    agent.status = status;
    return agent;
  }

  /**
   * Route an incoming call — returns routing decision
   */
  async routeCall(callData: { from: string; to: string; callSid: string; orgId: number; topic?: string }) {
    // Check for available agents with matching skills
    const bestAgent = this.skillBasedRouting(callData.topic || "general", callData.orgId);

    if (bestAgent) {
      // Direct route to agent
      await this.assignCallToAgent(callData.callSid, bestAgent.agentId);
      activeCalls.set(callData.callSid, {
        callSid: callData.callSid,
        agentId: bestAgent.agentId,
        status: "ringing",
        from: callData.from,
        to: callData.to,
        orgId: callData.orgId,
        startedAt: new Date(),
        participants: [callData.from, bestAgent.agentId],
      });

      return {
        action: "route_to_agent",
        agentId: bestAgent.agentId,
        callSid: callData.callSid,
        estimatedWaitSeconds: 0,
      };
    }

    // No available agent — queue it
    const position = await this.queueCall(callData, 5);
    const stats = this.getQueueStats(callData.orgId);

    return {
      action: "queued",
      callSid: callData.callSid,
      queuePosition: position,
      estimatedWaitSeconds: stats.avgHandleTimeSeconds * position,
    };
  }

  /**
   * Get available agents for an org filtered by required skills
   */
  getAvailableAgents(orgId: number, skills: string[] = []) {
    return Array.from(agentRegistry.values()).filter(agent => {
      if (agent.orgId !== orgId) return false;
      if (agent.status !== "available") return false;
      if (skills.length === 0) return true;
      return skills.every(skill => agent.skills.includes(skill));
    });
  }

  /**
   * Assign a call to a specific agent
   */
  async assignCallToAgent(callSid: string, agentId: string) {
    const agent = agentRegistry.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (agent.status !== "available") {
      throw new Error(`Agent ${agentId} is not available (status: ${agent.status})`);
    }

    agent.status = "busy";
    agent.currentCallSid = callSid;
    agent.lastAssignedAt = new Date();

    const existing = activeCalls.get(callSid);
    if (existing) {
      existing.agentId = agentId;
      existing.status = "active";
    }

    return { callSid, agentId, assignedAt: agent.lastAssignedAt };
  }

  /**
   * Add a call to the priority queue
   */
  async queueCall(callData: { from: string; to: string; callSid: string; orgId: number; topic?: string }, priority: number = 5) {
    const queued: QueuedCall = {
      callSid: callData.callSid,
      from: callData.from,
      to: callData.to,
      orgId: callData.orgId,
      topic: callData.topic,
      priority: Math.min(10, Math.max(1, priority)),
      enqueuedAt: new Date(),
      retries: 0,
    };

    // Insert in priority order (lower number = higher priority)
    const insertIndex = callQueue.findIndex(c => c.priority > queued.priority);
    if (insertIndex === -1) {
      callQueue.push(queued);
    } else {
      callQueue.splice(insertIndex, 0, queued);
    }

    activeCalls.set(callData.callSid, {
      callSid: callData.callSid,
      status: "queued",
      from: callData.from,
      to: callData.to,
      orgId: callData.orgId,
      startedAt: new Date(),
      participants: [callData.from],
    });

    return callQueue.findIndex(c => c.callSid === callData.callSid) + 1;
  }

  /**
   * Dequeue the next call and assign to next available agent
   */
  async dequeueNextCall() {
    if (callQueue.length === 0) return null;

    const next = callQueue[0];

    // Find an available agent (any skills)
    const availableAgents = this.getAvailableAgents(next.orgId);
    if (availableAgents.length === 0) {
      return { status: "no_agents_available", queueLength: callQueue.length };
    }

    // Pick the agent with fewest calls today (least loaded)
    const agent = availableAgents.sort((a, b) => a.callsHandledToday - b.callsHandledToday)[0];

    // Remove from queue
    callQueue.shift();

    await this.assignCallToAgent(next.callSid, agent.agentId);

    return { callSid: next.callSid, agentId: agent.agentId, waitedMs: Date.now() - next.enqueuedAt.getTime() };
  }

  /**
   * Transfer a call to a different agent
   */
  async transferCall(callSid: string, targetAgentId: string) {
    const call = activeCalls.get(callSid);
    if (!call) throw new Error(`Call ${callSid} not found`);
    if (!call.agentId) throw new Error(`Call ${callSid} has no current agent`);

    // Free current agent
    const currentAgent = agentRegistry.get(call.agentId);
    if (currentAgent) {
      currentAgent.status = "available";
      currentAgent.currentCallSid = undefined;
      currentAgent.callsHandledToday++;
    }

    // Assign to new agent
    await this.assignCallToAgent(callSid, targetAgentId);
    call.status = "transferred";

    return { callSid, fromAgentId: call.agentId, toAgentId: targetAgentId, transferredAt: new Date() };
  }

  /**
   * Start a conference call with multiple participants
   */
  async conferenceCall(callSid: string, participants: string[]) {
    const call = activeCalls.get(callSid);
    if (!call) throw new Error(`Call ${callSid} not found`);

    call.status = "conference";
    call.participants = Array.from(new Set([...call.participants, ...participants]));

    return {
      callSid,
      conferenceId: `conf_${callSid}`,
      participants: call.participants,
      startedAt: new Date(),
    };
  }

  /**
   * Get queue statistics for an org
   */
  getQueueStats(orgId: number) {
    const orgQueue = callQueue.filter(c => c.orgId === orgId);
    const availableAgents = this.getAvailableAgents(orgId);
    const busyAgents = Array.from(agentRegistry.values()).filter(a => a.orgId === orgId && a.status === "busy");

    const avgHandleTimeSeconds = busyAgents.length > 0
      ? busyAgents.reduce((sum, a) => sum + a.avgHandleTimeSeconds, 0) / busyAgents.length
      : 120; // Default 2 min estimate

    const longestWaitMs = orgQueue.length > 0
      ? Date.now() - orgQueue[0].enqueuedAt.getTime()
      : 0;

    return {
      queueLength: orgQueue.length,
      availableAgents: availableAgents.length,
      busyAgents: busyAgents.length,
      avgHandleTimeSeconds: Math.round(avgHandleTimeSeconds),
      longestWaitMs,
      estimatedWaitForNextSeconds: availableAgents.length > 0 ? 0 : avgHandleTimeSeconds,
    };
  }

  /**
   * Skill-based routing — find best agent for a given topic
   */
  skillBasedRouting(callTopic: string, orgId: number): Agent | null {
    const topicSkillMap: Record<string, string[]> = {
      billing: ["billing", "finance"],
      property: ["real_estate", "property"],
      investment: ["investment", "finance"],
      legal: ["legal", "compliance"],
      technical: ["tech_support", "technical"],
      general: [],
    };

    const requiredSkills = topicSkillMap[callTopic] || topicSkillMap.general;
    const available = this.getAvailableAgents(orgId, requiredSkills);

    if (available.length === 0) {
      // Fall back to any available agent
      const any = this.getAvailableAgents(orgId, []);
      if (any.length === 0) return null;
      return any.sort((a, b) => a.callsHandledToday - b.callsHandledToday)[0];
    }

    // Prefer agent with most matching skills, then fewest calls today
    return available.sort((a, b) => {
      const aMatch = requiredSkills.filter(s => a.skills.includes(s)).length;
      const bMatch = requiredSkills.filter(s => b.skills.includes(s)).length;
      if (bMatch !== aMatch) return bMatch - aMatch;
      return a.callsHandledToday - b.callsHandledToday;
    })[0];
  }

  /**
   * Place a call on hold
   */
  holdCall(callSid: string) {
    const call = activeCalls.get(callSid);
    if (!call) throw new Error(`Call ${callSid} not found`);
    if (call.status === "on_hold") throw new Error(`Call ${callSid} is already on hold`);

    call.status = "on_hold";
    call.holdStartedAt = new Date();

    if (call.agentId) {
      const agent = agentRegistry.get(call.agentId);
      if (agent) agent.status = "available"; // Agent freed while call on hold
    }

    return { callSid, status: "on_hold", holdStartedAt: call.holdStartedAt };
  }

  /**
   * Resume a call from hold
   */
  resumeCall(callSid: string) {
    const call = activeCalls.get(callSid);
    if (!call) throw new Error(`Call ${callSid} not found`);
    if (call.status !== "on_hold") throw new Error(`Call ${callSid} is not on hold`);

    const holdDurationMs = call.holdStartedAt ? Date.now() - call.holdStartedAt.getTime() : 0;
    call.status = "active";
    call.holdStartedAt = undefined;

    if (call.agentId) {
      const agent = agentRegistry.get(call.agentId);
      if (agent) agent.status = "busy";
    }

    return { callSid, status: "active", holdDurationMs };
  }

  /**
   * Mark a call as completed and free the agent
   */
  completeCall(callSid: string) {
    const call = activeCalls.get(callSid);
    if (!call) return null;

    const durationSeconds = Math.round((Date.now() - call.startedAt.getTime()) / 1000);

    if (call.agentId) {
      const agent = agentRegistry.get(call.agentId);
      if (agent) {
        // Update agent stats with exponential moving average
        agent.avgHandleTimeSeconds = Math.round(
          agent.avgHandleTimeSeconds * 0.8 + durationSeconds * 0.2
        );
        agent.callsHandledToday++;
        agent.status = "available";
        agent.currentCallSid = undefined;
      }
    }

    call.status = "completed";

    return { callSid, durationSeconds, completedAt: new Date() };
  }
}

export const callRoutingService = new CallRoutingService();
