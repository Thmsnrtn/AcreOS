// Pax (the customer AI copilot) data layer: knowledge base, projects +
// project files, scheduled tasks, @-mention entity search, and connector
// instances. Extracted from the god-class server/storage.ts in the storage
// refactor. Methods are merged into DatabaseStorage.prototype at construction
// time; `this` refers to the full DatabaseStorage instance.

import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { forOrg } from "../utils/orgScopedDb";
import {
  paxKnowledgeFiles,
  paxProjects,
  paxProjectFiles,
  paxScheduledTasks,
  paxConnectorInstances,
  aiConversations,
  leads,
  properties,
  deals,
  type PaxKnowledgeFile,
  type PaxProject,
  type PaxProjectFile,
  type PaxScheduledTask,
  type PaxConnectorInstance,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const paxRepo = {
  // PAX KNOWLEDGE BASE
  async getActiveKnowledgeFiles(this: DatabaseStorage, orgId: number): Promise<PaxKnowledgeFile[]> {
    return db.select().from(paxKnowledgeFiles)
      .where(and(eq(paxKnowledgeFiles.organizationId, orgId), eq(paxKnowledgeFiles.isActive, true)))
      .orderBy(paxKnowledgeFiles.createdAt);
  },

  async getKnowledgeFiles(this: DatabaseStorage, orgId: number): Promise<PaxKnowledgeFile[]> {
    return db.select().from(paxKnowledgeFiles)
      .where(eq(paxKnowledgeFiles.organizationId, orgId))
      .orderBy(paxKnowledgeFiles.createdAt);
  },

  async createKnowledgeFile(this: DatabaseStorage, data: Omit<PaxKnowledgeFile, 'id' | 'createdAt' | 'usageCount' | 'lastUsedAt'>): Promise<PaxKnowledgeFile> {
    const [row] = await db.insert(paxKnowledgeFiles).values(data).returning();
    return row;
  },

  async updateKnowledgeFile(this: DatabaseStorage, id: number, updates: { isActive?: boolean; description?: string }, organizationId?: number): Promise<void> {
    const conditions = [eq(paxKnowledgeFiles.id, id)];
    if (organizationId) conditions.push(eq(paxKnowledgeFiles.organizationId, organizationId));
    await db.update(paxKnowledgeFiles).set(updates).where(and(...conditions));
  },

  async deleteKnowledgeFile(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(paxKnowledgeFiles.id, id)];
    if (organizationId) conditions.push(eq(paxKnowledgeFiles.organizationId, organizationId));
    await db.delete(paxKnowledgeFiles).where(and(...conditions));
  },

  async incrementKnowledgeFileUsage(this: DatabaseStorage, orgId: number): Promise<void> {
    await db.update(paxKnowledgeFiles)
      .set({ usageCount: sql`${paxKnowledgeFiles.usageCount} + 1`, lastUsedAt: new Date() })
      .where(and(eq(paxKnowledgeFiles.organizationId, orgId), eq(paxKnowledgeFiles.isActive, true)));
  },

  // PAX PROJECTS
  async getPaxProjects(this: DatabaseStorage, orgId: number): Promise<PaxProject[]> {
    return db.select().from(paxProjects)
      .where(eq(paxProjects.organizationId, orgId))
      .orderBy(desc(paxProjects.createdAt));
  },

  // Tier 1F: org-scoped by construction.
  async getPaxProject(this: DatabaseStorage, organizationId: number, id: number): Promise<PaxProject | null> {
    const row = await forOrg(organizationId).findById(paxProjects, id);
    return row ?? null;
  },

  async createPaxProject(this: DatabaseStorage, data: { organizationId: number; userId: string; name: string; description?: string; entityType?: string; entityId?: number }): Promise<PaxProject> {
    const [row] = await db.insert(paxProjects).values(data).returning();
    return row;
  },

  async updatePaxProject(this: DatabaseStorage, id: number, updates: { name?: string; description?: string; isActive?: boolean }, organizationId?: number): Promise<void> {
    const conditions = [eq(paxProjects.id, id)];
    if (organizationId) conditions.push(eq(paxProjects.organizationId, organizationId));
    await db.update(paxProjects).set(updates).where(and(...conditions));
  },

  async deletePaxProject(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    // Verify project belongs to org before deleting child records
    if (organizationId) {
      const [project] = await db.select().from(paxProjects)
        .where(and(eq(paxProjects.id, id), eq(paxProjects.organizationId, organizationId)));
      if (!project) return;
    }
    await db.delete(paxProjectFiles).where(eq(paxProjectFiles.projectId, id));
    const conditions = [eq(paxProjects.id, id)];
    if (organizationId) conditions.push(eq(paxProjects.organizationId, organizationId));
    await db.delete(paxProjects).where(and(...conditions));
  },

  async getPaxProjectFiles(this: DatabaseStorage, projectId: number): Promise<PaxProjectFile[]> {
    return db.select().from(paxProjectFiles)
      .where(eq(paxProjectFiles.projectId, projectId))
      .orderBy(paxProjectFiles.uploadedAt);
  },

  async createPaxProjectFile(this: DatabaseStorage, data: Omit<PaxProjectFile, 'id' | 'uploadedAt'>): Promise<PaxProjectFile> {
    const [row] = await db.insert(paxProjectFiles).values(data).returning();
    await db.update(paxProjects)
      .set({ fileCount: sql`${paxProjects.fileCount} + 1` })
      .where(eq(paxProjects.id, data.projectId));
    return row;
  },

  async deletePaxProjectFile(this: DatabaseStorage, fileId: number): Promise<void> {
    const [file] = await db.select().from(paxProjectFiles).where(eq(paxProjectFiles.id, fileId));
    if (file) {
      await db.delete(paxProjectFiles).where(eq(paxProjectFiles.id, fileId));
      await db.update(paxProjects)
        .set({ fileCount: sql`GREATEST(${paxProjects.fileCount} - 1, 0)` })
        .where(eq(paxProjects.id, file.projectId));
    }
  },

  async setConversationProject(this: DatabaseStorage, conversationId: number, projectId: number | null): Promise<void> {
    await db.update(aiConversations)
      .set({ activeProjectId: projectId, updatedAt: new Date() } as any)
      .where(eq(aiConversations.id, conversationId));
  },

  // PAX SCHEDULED TASKS
  async getPaxScheduledTasks(this: DatabaseStorage, orgId: number): Promise<PaxScheduledTask[]> {
    return db.select().from(paxScheduledTasks)
      .where(eq(paxScheduledTasks.organizationId, orgId))
      .orderBy(paxScheduledTasks.createdAt);
  },

  async getPaxScheduledTasksDue(this: DatabaseStorage, now: Date): Promise<PaxScheduledTask[]> {
    return db.select().from(paxScheduledTasks)
      .where(and(
        eq(paxScheduledTasks.isActive, true),
        lte(paxScheduledTasks.nextRunAt, now)
      ));
  },

  async createPaxScheduledTask(this: DatabaseStorage, data: { organizationId: number; userId: string; name: string; prompt: string; schedule: string; timezone?: string; nextRunAt: Date }): Promise<PaxScheduledTask> {
    const [row] = await db.insert(paxScheduledTasks).values(data).returning();
    return row;
  },

  async updatePaxScheduledTask(this: DatabaseStorage, id: number, updates: { isActive?: boolean; schedule?: string; lastRunAt?: Date; nextRunAt?: Date; lastRunConversationId?: number; lastRunStatus?: string; lastRunSummary?: string; runCount?: number; updatedAt?: Date }, organizationId?: number): Promise<void> {
    const conditions = [eq(paxScheduledTasks.id, id)];
    if (organizationId) conditions.push(eq(paxScheduledTasks.organizationId, organizationId));
    await db.update(paxScheduledTasks).set({ ...updates, updatedAt: new Date() }).where(and(...conditions));
  },

  async deletePaxScheduledTask(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(paxScheduledTasks.id, id)];
    if (organizationId) conditions.push(eq(paxScheduledTasks.organizationId, organizationId));
    await db.delete(paxScheduledTasks).where(and(...conditions));
  },

  async getPaxPendingTaskResults(this: DatabaseStorage, orgId: number, since: Date): Promise<PaxScheduledTask[]> {
    return db.select().from(paxScheduledTasks)
      .where(and(
        eq(paxScheduledTasks.organizationId, orgId),
        gte(paxScheduledTasks.lastRunAt, since),
        eq(paxScheduledTasks.lastRunStatus, 'success')
      ))
      .orderBy(desc(paxScheduledTasks.lastRunAt));
  },

  // PAX ENTITY SEARCH (for @ mentions)
  async searchPaxEntities(this: DatabaseStorage, orgId: number, query: string, type: string, limit: number): Promise<{ type: string; id: number; name: string; preview: string }[]> {
    const results: { type: string; id: number; name: string; preview: string }[] = [];
    const q = `%${query}%`;

    if (type === 'all' || type === 'lead') {
      const leadRows = await db.select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, status: leads.status })
        .from(leads)
        .where(and(
          eq(leads.organizationId, orgId),
          or(ilike(leads.firstName, q), ilike(leads.lastName, q), ilike(leads.email, q))
        ))
        .limit(limit);
      for (const r of leadRows) {
        results.push({ type: 'lead', id: r.id, name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(), preview: `${r.email ?? ''} · ${r.status ?? ''}` });
      }
    }

    if (type === 'all' || type === 'property') {
      const propRows = await db.select({ id: properties.id, address: properties.address, state: properties.state, status: properties.status })
        .from(properties)
        .where(and(eq(properties.organizationId, orgId), ilike(properties.address, q)))
        .limit(limit);
      for (const r of propRows) {
        results.push({ type: 'property', id: r.id, name: r.address ?? `Property #${r.id}`, preview: `${r.state ?? ''} · ${r.status ?? ''}` });
      }
    }

    if (type === 'all' || type === 'deal') {
      // TODO(tsc): the `deals` table has no `name`/`dealValue` columns (schema is
      // frozen). Search by `titleCompany` (closest text field) and derive value
      // from acceptedAmount ?? offerAmount. The previous code referenced
      // nonexistent columns and would have thrown at runtime.
      const dealRows = await db.select({
        id: deals.id,
        titleCompany: deals.titleCompany,
        status: deals.status,
        acceptedAmount: deals.acceptedAmount,
        offerAmount: deals.offerAmount,
      })
        .from(deals)
        .where(and(eq(deals.organizationId, orgId), ilike(deals.titleCompany, q)))
        .limit(limit);
      for (const r of dealRows) {
        const dealValue = Number(r.acceptedAmount ?? r.offerAmount ?? 0);
        results.push({ type: 'deal', id: r.id, name: r.titleCompany ?? `Deal #${r.id}`, preview: `$${dealValue.toLocaleString()} · ${r.status ?? ''}` });
      }
    }

    return results.slice(0, limit);
  },

  // PAX CONNECTOR INSTANCES
  async getPaxConnectors(this: DatabaseStorage, orgId: number): Promise<PaxConnectorInstance[]> {
    return db.select().from(paxConnectorInstances)
      .where(eq(paxConnectorInstances.organizationId, orgId))
      .orderBy(paxConnectorInstances.connectorId);
  },

  async getPaxConnector(this: DatabaseStorage, orgId: number, connectorId: string): Promise<PaxConnectorInstance | undefined> {
    const [row] = await db.select().from(paxConnectorInstances)
      .where(and(eq(paxConnectorInstances.organizationId, orgId), eq(paxConnectorInstances.connectorId, connectorId)));
    return row;
  },

  async upsertPaxConnector(this: DatabaseStorage, orgId: number, connectorId: string, updates: {
    status?: string;
    credentialsEncrypted?: string;
    settings?: Record<string, unknown>;
    lastTestedAt?: Date;
    lastErrorAt?: Date;
    errorMessage?: string;
  }): Promise<PaxConnectorInstance> {
    const existing = await this.getPaxConnector(orgId, connectorId);
    if (existing) {
      const [row] = await db.update(paxConnectorInstances)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(paxConnectorInstances.organizationId, orgId), eq(paxConnectorInstances.connectorId, connectorId)))
        .returning();
      return row;
    } else {
      const [row] = await db.insert(paxConnectorInstances)
        .values({ organizationId: orgId, connectorId, status: "disconnected", ...updates })
        .returning();
      return row;
    }
  },

  async deletePaxConnector(this: DatabaseStorage, orgId: number, connectorId: string): Promise<void> {
    await db.delete(paxConnectorInstances)
      .where(and(eq(paxConnectorInstances.organizationId, orgId), eq(paxConnectorInstances.connectorId, connectorId)));
  },

  async getConnectedConnectorIds(this: DatabaseStorage, orgId: number): Promise<string[]> {
    const rows = await db.select({ connectorId: paxConnectorInstances.connectorId })
      .from(paxConnectorInstances)
      .where(and(eq(paxConnectorInstances.organizationId, orgId), eq(paxConnectorInstances.status, "connected")));
    return rows.map(r => r.connectorId);
  },
};

export type PaxRepo = typeof paxRepo;
