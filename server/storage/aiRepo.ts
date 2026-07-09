// AI command-center data layer: agent profiles, tool definitions, execution
// runs, memory, and conversations + messages. Extracted from the god-class
// server/storage.ts in the storage refactor. Methods are merged into
// DatabaseStorage.prototype at construction time; `this` refers to the full
// DatabaseStorage instance.

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { forOrg } from "../utils/orgScopedDb";
import {
  aiAgentProfiles,
  aiToolDefinitions,
  aiExecutionRuns,
  aiMemory,
  aiConversations,
  aiMessages,
  type AiExecutionRun,
  type InsertAiExecutionRun,
  type InsertAiMemory,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const aiRepo = {
  // AI Agent Profiles
  async getAiAgentProfiles(this: DatabaseStorage) {
    return await db.select().from(aiAgentProfiles).where(eq(aiAgentProfiles.isActive, true));
  },

  async getAiAgentProfile(this: DatabaseStorage, role: string) {
    const [profile] = await db.select().from(aiAgentProfiles)
      .where(and(eq(aiAgentProfiles.role, role), eq(aiAgentProfiles.isActive, true)));
    return profile;
  },

  // AI Tool Definitions
  async getAiToolDefinitions(this: DatabaseStorage) {
    return await db.select().from(aiToolDefinitions);
  },

  async getAiToolsByRole(this: DatabaseStorage, role: string) {
    const tools = await db.select().from(aiToolDefinitions);
    return tools.filter(tool =>
      tool.agentRoles === null || tool.agentRoles.includes(role)
    );
  },

  // AI Execution Runs
  async getAiExecutionRuns(this: DatabaseStorage, orgId: number) {
    return await db.select().from(aiExecutionRuns)
      .where(eq(aiExecutionRuns.organizationId, orgId))
      .orderBy(desc(aiExecutionRuns.startedAt));
  },

  async createAiExecutionRun(this: DatabaseStorage, run: InsertAiExecutionRun) {
    const [newRun] = await db.insert(aiExecutionRuns).values(run).returning();
    return newRun;
  },

  async updateAiExecutionRun(this: DatabaseStorage, id: number, updates: Partial<AiExecutionRun>, organizationId?: number) {
    const conditions = [eq(aiExecutionRuns.id, id)];
    if (organizationId) conditions.push(eq(aiExecutionRuns.organizationId, organizationId));
    const [updated] = await db.update(aiExecutionRuns)
      .set(updates)
      .where(and(...conditions))
      .returning();
    return updated;
  },

  // AI Memory
  async getAiMemory(this: DatabaseStorage, orgId: number) {
    return await db.select().from(aiMemory)
      .where(eq(aiMemory.organizationId, orgId))
      .orderBy(desc(aiMemory.createdAt));
  },

  async createAiMemory(this: DatabaseStorage, memory: InsertAiMemory) {
    const [newMemory] = await db.insert(aiMemory).values(memory).returning();
    return newMemory;
  },

  async deleteAiMemory(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(aiMemory.id, id)];
    if (organizationId) conditions.push(eq(aiMemory.organizationId, organizationId));
    await db.delete(aiMemory).where(and(...conditions));
  },

  // AI Conversations (Command Center)
  async getAiConversations(this: DatabaseStorage, orgId: number) {
    return await db.select().from(aiConversations)
      .where(eq(aiConversations.organizationId, orgId))
      .orderBy(desc(aiConversations.updatedAt));
  },

  // Tier 1F: org-scoped by construction — fetch-by-bare-id no longer typechecks.
  async getAiConversation(this: DatabaseStorage, organizationId: number, id: number) {
    return await forOrg(organizationId).findById(aiConversations, id);
  },

  async createAiConversation(this: DatabaseStorage, conv: { organizationId: number; userId: string; title: string; agentRole: string }) {
    const [newConv] = await db.insert(aiConversations).values(conv).returning();
    return newConv;
  },

  async updateAiConversation(this: DatabaseStorage, id: number, updates: { title?: string }, organizationId?: number) {
    const conditions = [eq(aiConversations.id, id)];
    if (organizationId) conditions.push(eq(aiConversations.organizationId, organizationId));
    const [updated] = await db.update(aiConversations)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteAiConversation(this: DatabaseStorage, id: number, organizationId?: number) {
    // First verify conversation belongs to org before deleting messages
    if (organizationId) {
      const [conv] = await db.select().from(aiConversations)
        .where(and(eq(aiConversations.id, id), eq(aiConversations.organizationId, organizationId)));
      if (!conv) return;
    }
    await db.delete(aiMessages).where(eq(aiMessages.conversationId, id));
    const conditions = [eq(aiConversations.id, id)];
    if (organizationId) conditions.push(eq(aiConversations.organizationId, organizationId));
    await db.delete(aiConversations).where(and(...conditions));
  },

  async getAiMessages(this: DatabaseStorage, conversationId: number) {
    return await db.select().from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(aiMessages.createdAt);
  },

  async createAiMessage(this: DatabaseStorage, message: { conversationId: number; role: string; content: string; toolCalls?: any[]; mentionedEntities?: any[]; thinkingContent?: string }) {
    const [newMessage] = await db.insert(aiMessages).values(message).returning();
    return newMessage;
  },
};

export type AiRepo = typeof aiRepo;
