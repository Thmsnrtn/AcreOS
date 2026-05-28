/**
 * War Room Service — Sovereign Company Protocol v6
 *
 * When something critical happens, agents auto-convene a war room:
 * a real-time collaborative thread where multiple agents analyze,
 * propose solutions, and take coordinated action.
 *
 * The CEO can watch the war room unfold in real-time or jump in
 * with directives. Think: Slack channel that opens itself when there's a fire.
 *
 * Convening rules:
 * - Critical system alert → Sentinel leads, Atlas + Crucible join
 * - High-value customer churning → Sophie leads, Forge + Oracle join
 * - Revenue anomaly → Forge leads, Oracle + Ledger join
 * - Compliance breach → Shield leads, all agents notified
 */

import { db } from "../db";
import {
  warRooms, warRoomMessages,
  type WarRoom, type WarRoomMessage,
} from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { wsServer } from "../websocket";

// ─── Convening Rules ─────────────────────────────────────────────────────────

interface ConveneRule {
  event: string;
  severity: "critical" | "high" | "medium";
  title: (data: any) => string;
  leadAgent: string;
  participants: string[];
  autoActions: string[];   // what the lead agent should immediately do
}

const CONVENE_RULES: ConveneRule[] = [
  {
    event: "critical_system_alert",
    severity: "critical",
    title: (d) => `System Emergency: ${d.alertMessage || "Critical infrastructure issue"}`,
    leadAgent: "sentinel_devops",
    participants: ["atlas_cto", "crucible_qa"],
    autoActions: ["diagnose_root_cause", "assess_impact", "propose_mitigation"],
  },
  {
    event: "high_value_churn",
    severity: "critical",
    title: (d) => `Churn Risk: ${d.customerName || "High-value customer"} showing exit signals`,
    leadAgent: "sophie_csm",
    participants: ["forge_revenue", "oracle_analytics"],
    autoActions: ["review_customer_history", "analyze_churn_factors", "prepare_retention_strategy"],
  },
  {
    event: "revenue_anomaly",
    severity: "high",
    title: (d) => `Revenue Anomaly: ${d.description || "Unexpected revenue pattern detected"}`,
    leadAgent: "forge_revenue",
    participants: ["oracle_analytics", "ledger_finance"],
    autoActions: ["quantify_impact", "identify_root_cause", "model_scenarios"],
  },
  {
    event: "compliance_breach",
    severity: "critical",
    title: (d) => `Compliance Alert: ${d.description || "Potential compliance violation"}`,
    leadAgent: "shield_legal",
    participants: ["atlas_cto", "sophie_csm", "sentinel_devops"],
    autoActions: ["assess_exposure", "identify_affected_data", "draft_response_plan"],
  },
  {
    event: "security_incident",
    severity: "critical",
    title: (d) => `Security Incident: ${d.description || "Security event requires investigation"}`,
    leadAgent: "sentinel_devops",
    participants: ["atlas_cto", "shield_legal", "crucible_qa"],
    autoActions: ["isolate_threat", "assess_data_exposure", "document_timeline"],
  },
  {
    event: "major_customer_escalation",
    severity: "high",
    title: (d) => `Customer Escalation: ${d.customerName || "Customer"} requests executive attention`,
    leadAgent: "sophie_csm",
    participants: ["forge_revenue", "compass_pm"],
    autoActions: ["review_ticket_history", "assess_account_health", "prepare_talking_points"],
  },
];

// ─── Service ─────────────────────────────────────────────────────────────────

class WarRoomService {

  /** Attempt to convene a war room for an event. Returns room ID or null. */
  async convene(eventName: string, eventData: Record<string, any>): Promise<number | null> {
    const rule = CONVENE_RULES.find(r => r.event === eventName);
    if (!rule) return null;

    // Don't create duplicate rooms for the same event within 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await db.query.warRooms.findFirst({
      where: and(
        eq(warRooms.triggerEvent, eventName),
        eq(warRooms.status, "active"),
        gte(warRooms.createdAt, oneHourAgo),
      ),
    });
    if (existing) return existing.id;

    const allParticipants = [rule.leadAgent, ...rule.participants];
    const title = rule.title(eventData);

    const [room] = await db.insert(warRooms).values({
      title,
      severity: rule.severity,
      triggerEvent: eventName,
      triggerData: eventData,
      participants: allParticipants,
      leadAgent: rule.leadAgent,
      status: "active",
    }).returning({ id: warRooms.id });

    // Post opening message from lead agent
    await this.addMessage(room.id, rule.leadAgent, "analysis",
      `War room convened. I'm leading the response to: ${title}. Let me start by analyzing the situation.`
    );

    // Generate initial analysis from each participant asynchronously
    this.runInitialAnalysis(room.id, rule, eventData).catch(() => {});

    // Broadcast to UI
    try {
      wsServer?.broadcast?.("war_room", "war_room_opened", {
        roomId: room.id,
        title,
        severity: rule.severity,
        participants: allParticipants,
      });
    } catch {}

    return room.id;
  }

  /** Run initial analysis from all participating agents */
  private async runInitialAnalysis(roomId: number, rule: ConveneRule, eventData: Record<string, any>): Promise<void> {
    const allParticipants = [rule.leadAgent, ...rule.participants];

    for (const agentCodename of allParticipants) {
      try {
        const agent = await companyAgentService.getByCodename(agentCodename);
        if (!agent) continue;

        const role = agentCodename === rule.leadAgent ? "lead coordinator" : "contributing analyst";
        const response = await routeAITask({
          taskType: "war_room_analysis",
          complexity: TaskComplexity.MODERATE,
          messages: [
            {
              role: "system",
              content: `${agent.personalityPrompt}\n\nYou are in a WAR ROOM — a real-time emergency collaboration session. Your role: ${role}. Be concise, actionable, and specific. No fluff.`,
            },
            {
              role: "user",
              content: `War room topic: ${rule.title(eventData)}\nSeverity: ${rule.severity}\nEvent data: ${JSON.stringify(eventData)}\n\nProvide your analysis in 2-3 sentences from your domain expertise. What do you see? What should we do?`,
            },
          ],
          maxTokens: 200,
          temperature: 0.3,
        });

        await this.addMessage(roomId, agentCodename, "analysis", response.content);

        // Small delay between agents for natural feel
        await new Promise(r => setTimeout(r, 500));
      } catch {}
    }

    // Lead agent synthesizes and proposes action plan
    try {
      const room = await this.getRoom(roomId);
      const messages = await this.getMessages(roomId);
      const analyses = messages.filter(m => m.messageType === "analysis").map(m => `${m.fromAgent}: ${m.content}`).join("\n");

      const leadAgent = await companyAgentService.getByCodename(rule.leadAgent);
      const response = await routeAITask({
        taskType: "war_room_synthesis",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `${leadAgent?.personalityPrompt || "You are the lead coordinator."}\n\nYou are LEADING this war room. Synthesize all analyses into a concrete action plan.`,
          },
          {
            role: "user",
            content: `Team analyses:\n${analyses}\n\nSynthesize into a 3-step action plan. Be specific about who does what. Format as:\n1. [Agent]: action\n2. [Agent]: action\n3. [Agent]: action`,
          },
        ],
        maxTokens: 200,
        temperature: 0.2,
      });

      await this.addMessage(roomId, rule.leadAgent, "proposal", response.content);
    } catch {}
  }

  /** Add a message to a war room */
  async addMessage(roomId: number, fromAgent: string, messageType: string, content: string, data?: Record<string, any>): Promise<number> {
    const [msg] = await db.insert(warRoomMessages).values({
      warRoomId: roomId,
      fromAgent,
      messageType,
      content,
      data,
    }).returning({ id: warRoomMessages.id });

    // Broadcast to UI
    try {
      wsServer?.broadcast?.("war_room", "war_room_message", {
        roomId,
        messageId: msg.id,
        fromAgent,
        messageType,
        content,
      });
    } catch {}

    return msg.id;
  }

  /** CEO joins a war room */
  async ceoJoin(roomId: number): Promise<void> {
    await db.update(warRooms)
      .set({ ceoJoined: true, updatedAt: new Date() })
      .where(eq(warRooms.id, roomId));

    await this.addMessage(roomId, "ceo", "ceo_directive", "CEO has joined the war room.");
  }

  /** CEO sends a directive to the war room */
  async ceoDirective(roomId: number, directive: string): Promise<void> {
    await this.addMessage(roomId, "ceo", "ceo_directive", directive);

    // Have the lead agent acknowledge and adjust
    const room = await this.getRoom(roomId);
    if (!room) return;

    try {
      const leadAgent = await companyAgentService.getByCodename(room.leadAgent);
      const response = await routeAITask({
        taskType: "war_room_response",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          {
            role: "system",
            content: `${leadAgent?.personalityPrompt || ""}\n\nYou are leading a war room. The CEO just gave a directive. Acknowledge it concisely and explain how you'll adjust the plan.`,
          },
          { role: "user", content: `CEO directive: ${directive}` },
        ],
        maxTokens: 100,
        temperature: 0.2,
      });

      await this.addMessage(roomId, room.leadAgent, "action_taken", response.content);
    } catch {}
  }

  /** Resolve a war room */
  async resolve(roomId: number, resolution: string, resolvedBy: string): Promise<void> {
    await db.update(warRooms)
      .set({
        status: "resolved",
        resolution,
        resolvedBy,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(warRooms.id, roomId));

    await this.addMessage(roomId, resolvedBy, "action_taken", `War room resolved: ${resolution}`);

    try {
      wsServer?.broadcast?.("war_room", "war_room_resolved", { roomId, resolution });
    } catch {}
  }

  /** Get a war room by ID */
  async getRoom(roomId: number): Promise<WarRoom | undefined> {
    return db.query.warRooms.findFirst({
      where: eq(warRooms.id, roomId),
    });
  }

  /** Get all active war rooms */
  async getActiveRooms(): Promise<WarRoom[]> {
    return db.query.warRooms.findMany({
      where: eq(warRooms.status, "active"),
      orderBy: [desc(warRooms.createdAt)],
    });
  }

  /** Get recent war rooms */
  async getRecentRooms(limit = 10): Promise<WarRoom[]> {
    return db.query.warRooms.findMany({
      orderBy: [desc(warRooms.createdAt)],
      limit,
    });
  }

  /** Get messages for a war room */
  async getMessages(roomId: number): Promise<WarRoomMessage[]> {
    return db.query.warRoomMessages.findMany({
      where: eq(warRoomMessages.warRoomId, roomId),
      orderBy: [warRoomMessages.createdAt],
    });
  }
}

export const warRoomService = new WarRoomService();
