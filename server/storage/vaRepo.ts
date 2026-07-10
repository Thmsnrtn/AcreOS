// VA (virtual assistants) data layer: VA agents, actions (with the
// approve/reject flow), briefings, calendar events, and templates. Extracted
// from the god-class server/storage.ts in the storage refactor. Methods are
// merged into DatabaseStorage.prototype at construction time; `this` refers
// to the full DatabaseStorage instance (self-calls like this.getVaAgents
// resolve against the composed prototype).

import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import {
  vaAgents,
  vaActions,
  vaBriefings,
  vaCalendarEvents,
  vaTemplates,
  type VaAgent,
  type VaAction,
  type InsertVaAgent,
  type InsertVaAction,
  type InsertVaBriefing,
  type InsertVaCalendarEvent,
  type InsertVaTemplate,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const vaRepo = {
  // ============================================
  // VA (Virtual Assistants) Implementation
  // ============================================

  async getVaAgents(this: DatabaseStorage, orgId: number) {
    return await db.select().from(vaAgents)
      .where(eq(vaAgents.organizationId, orgId))
      .orderBy(vaAgents.agentType);
  },

  async getVaAgent(this: DatabaseStorage, orgId: number, id: number) {
    const [agent] = await db.select().from(vaAgents)
      .where(and(eq(vaAgents.organizationId, orgId), eq(vaAgents.id, id)));
    return agent;
  },

  async getVaAgentByType(this: DatabaseStorage, orgId: number, agentType: string) {
    const [agent] = await db.select().from(vaAgents)
      .where(and(eq(vaAgents.organizationId, orgId), eq(vaAgents.agentType, agentType)));
    return agent;
  },

  async createVaAgent(this: DatabaseStorage, agent: InsertVaAgent) {
    const [newAgent] = await db.insert(vaAgents).values(agent).returning();
    return newAgent;
  },

  async updateVaAgent(this: DatabaseStorage, id: number, updates: Partial<InsertVaAgent>, organizationId?: number) {
    const conditions = [eq(vaAgents.id, id)];
    if (organizationId) conditions.push(eq(vaAgents.organizationId, organizationId));
    const [updated] = await db.update(vaAgents)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async initializeVaAgents(this: DatabaseStorage, orgId: number): Promise<VaAgent[]> {
    const existingAgents = await this.getVaAgents(orgId);
    if (existingAgents.length > 0) {
      return existingAgents;
    }

    const defaultAgents: InsertVaAgent[] = [
      {
        organizationId: orgId,
        agentType: "executive",
        name: "Executive Assistant",
        avatar: "Briefcase",
        description: "Your personal executive assistant. Provides daily briefings, routes tasks to specialists, and keeps everything organized.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          notifyOnAction: true,
          autoApproveCategories: ["briefing", "summary", "reminder"],
          escalateToHuman: ["financial_decision", "legal_document", "large_expense"],
        },
      },
      {
        organizationId: orgId,
        agentType: "sales",
        name: "Sales VA",
        avatar: "MessageSquare",
        description: "Handles buyer inquiries, qualifies leads, schedules callbacks, and nurtures prospects toward closing.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          responseDelay: 5,
          autoApproveCategories: ["follow_up", "qualification"],
          escalateToHuman: ["price_negotiation", "contract_question"],
        },
      },
      {
        organizationId: orgId,
        agentType: "acquisitions",
        name: "Acquisitions VA",
        avatar: "Target",
        description: "Monitors seller leads, researches comps, drafts offers, and manages the acquisition pipeline.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          autoApproveCategories: ["research", "comp_analysis"],
          escalateToHuman: ["offer_submission", "contract_signing"],
        },
      },
      {
        organizationId: orgId,
        agentType: "marketing",
        name: "Marketing VA",
        avatar: "Megaphone",
        description: "Conducts market research, proposes campaigns, manages direct mail through Lob, and tracks marketing performance.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          autoApproveCategories: ["research", "report"],
          escalateToHuman: ["campaign_launch", "budget_increase"],
        },
      },
      {
        organizationId: orgId,
        agentType: "collections",
        name: "Collections VA",
        avatar: "DollarSign",
        description: "Monitors payment schedules, sends reminders, handles delinquencies, and manages note servicing.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          autoApproveCategories: ["reminder", "payment_confirmation"],
          escalateToHuman: ["default_notice", "legal_action"],
        },
      },
      {
        organizationId: orgId,
        agentType: "research",
        name: "Research VA",
        avatar: "Search",
        description: "Performs property due diligence, market analysis, zoning research, and gathers intelligence on opportunities.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          autoApproveCategories: ["research", "report", "analysis"],
        },
      },
    ];

    const createdAgents: VaAgent[] = [];
    for (const agent of defaultAgents) {
      const created = await this.createVaAgent(agent);
      createdAgents.push(created);
    }
    
    return createdAgents;
  },

  // VA Actions
  async getVaActions(this: DatabaseStorage, orgId: number, options?: { agentId?: number; status?: string; limit?: number }) {
    let query = db.select().from(vaActions)
      .where(eq(vaActions.organizationId, orgId))
      .orderBy(desc(vaActions.createdAt));
    
    const conditions = [eq(vaActions.organizationId, orgId)];
    if (options?.agentId) {
      conditions.push(eq(vaActions.agentId, options.agentId));
    }
    if (options?.status) {
      conditions.push(eq(vaActions.status, options.status));
    }
    
    const result = await db.select().from(vaActions)
      .where(and(...conditions))
      .orderBy(desc(vaActions.createdAt))
      .limit(options?.limit || 100);
    
    return result;
  },

  async getVaAction(this: DatabaseStorage, id: number) {
    const [action] = await db.select().from(vaActions).where(eq(vaActions.id, id));
    return action;
  },

  async createVaAction(this: DatabaseStorage, action: InsertVaAction) {
    const [newAction] = await db.insert(vaActions).values(action).returning();
    return newAction;
  },

  async updateVaAction(this: DatabaseStorage, id: number, updates: Partial<VaAction>, organizationId?: number) {
    // Remove immutable fields from updates to prevent accidental modification
    const {
      id: _id,
      createdAt: _createdAt,
      organizationId: _orgId,
      agentId: _agentId,
      ...safeUpdates
    } = updates as any;
    const conditions = [eq(vaActions.id, id)];
    if (organizationId) conditions.push(eq(vaActions.organizationId, organizationId));
    const [updated] = await db.update(vaActions)
      .set({ ...safeUpdates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async approveVaAction(this: DatabaseStorage, id: number, userId: string, organizationId?: number) {
    const conditions = [eq(vaActions.id, id)];
    if (organizationId) conditions.push(eq(vaActions.organizationId, organizationId));
    const [updated] = await db.update(vaActions)
      .set({
        status: "approved",
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async rejectVaAction(this: DatabaseStorage, id: number, reason: string, organizationId?: number) {
    const conditions = [eq(vaActions.id, id)];
    if (organizationId) conditions.push(eq(vaActions.organizationId, organizationId));
    const [updated] = await db.update(vaActions)
      .set({
        status: "rejected",
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async getPendingActionsCount(this: DatabaseStorage, orgId: number) {
    const [result] = await db.select({ count: count() }).from(vaActions)
      .where(and(
        eq(vaActions.organizationId, orgId),
        eq(vaActions.status, "proposed")
      ));
    return result?.count || 0;
  },

  // VA Briefings
  async getVaBriefings(this: DatabaseStorage, orgId: number, limit: number = 10) {
    return await db.select().from(vaBriefings)
      .where(eq(vaBriefings.organizationId, orgId))
      .orderBy(desc(vaBriefings.createdAt))
      .limit(limit);
  },

  async getLatestBriefing(this: DatabaseStorage, orgId: number) {
    const [briefing] = await db.select().from(vaBriefings)
      .where(eq(vaBriefings.organizationId, orgId))
      .orderBy(desc(vaBriefings.createdAt))
      .limit(1);
    return briefing;
  },

  async createVaBriefing(this: DatabaseStorage, briefing: InsertVaBriefing) {
    const [newBriefing] = await db.insert(vaBriefings).values(briefing).returning();
    return newBriefing;
  },

  async markBriefingRead(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(vaBriefings.id, id)];
    if (organizationId) conditions.push(eq(vaBriefings.organizationId, organizationId));
    const [updated] = await db.update(vaBriefings)
      .set({ readAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  // VA Calendar Events
  async getVaCalendarEvents(this: DatabaseStorage, orgId: number, startDate?: Date, endDate?: Date) {
    const conditions = [eq(vaCalendarEvents.organizationId, orgId)];
    
    if (startDate) {
      conditions.push(gte(vaCalendarEvents.startTime, startDate));
    }
    if (endDate) {
      conditions.push(lte(vaCalendarEvents.startTime, endDate));
    }
    
    return await db.select().from(vaCalendarEvents)
      .where(and(...conditions))
      .orderBy(vaCalendarEvents.startTime);
  },

  async createVaCalendarEvent(this: DatabaseStorage, event: InsertVaCalendarEvent) {
    const [newEvent] = await db.insert(vaCalendarEvents).values(event).returning();
    return newEvent;
  },

  async updateVaCalendarEvent(this: DatabaseStorage, id: number, updates: Partial<InsertVaCalendarEvent>, organizationId?: number) {
    const conditions = [eq(vaCalendarEvents.id, id)];
    if (organizationId) conditions.push(eq(vaCalendarEvents.organizationId, organizationId));
    const [updated] = await db.update(vaCalendarEvents)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteVaCalendarEvent(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(vaCalendarEvents.id, id)];
    if (organizationId) conditions.push(eq(vaCalendarEvents.organizationId, organizationId));
    await db.delete(vaCalendarEvents).where(and(...conditions));
  },

  // VA Templates
  async getVaTemplates(this: DatabaseStorage, orgId: number, category?: string) {
    const conditions = [eq(vaTemplates.organizationId, orgId)];
    if (category) {
      conditions.push(eq(vaTemplates.category, category));
    }
    
    return await db.select().from(vaTemplates)
      .where(and(...conditions))
      .orderBy(vaTemplates.name);
  },

  async createVaTemplate(this: DatabaseStorage, template: InsertVaTemplate) {
    const [newTemplate] = await db.insert(vaTemplates).values(template).returning();
    return newTemplate;
  },

  async updateVaTemplate(this: DatabaseStorage, id: number, updates: Partial<InsertVaTemplate>, organizationId?: number) {
    const conditions = [eq(vaTemplates.id, id)];
    if (organizationId) conditions.push(eq(vaTemplates.organizationId, organizationId));
    const [updated] = await db.update(vaTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteVaTemplate(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(vaTemplates.id, id)];
    if (organizationId) conditions.push(eq(vaTemplates.organizationId, organizationId));
    await db.delete(vaTemplates).where(and(...conditions));
  },
};

export type VaRepo = typeof vaRepo;
