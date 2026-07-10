// Workspace-customization data layer: custom field definitions + values,
// saved views (incl. default-view management), workspace presets, and
// notification preferences. Extracted from the god-class server/storage.ts
// in the storage refactor. Methods are merged into DatabaseStorage.prototype
// at construction time; `this` refers to the full DatabaseStorage instance.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customFieldDefinitions,
  customFieldValues,
  savedViews,
  workspacePresets,
  notificationPreferences,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type SavedView,
  type WorkspacePreset,
  type NotificationPreference,
  type InsertCustomFieldDefinition,
  type InsertSavedView,
  type InsertWorkspacePreset,
  type InsertNotificationPreference,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const customizationRepo = {
  // Custom Field Definitions
  async getCustomFieldDefinitions(this: DatabaseStorage, orgId: number, entityType?: string): Promise<CustomFieldDefinition[]> {
    if (entityType) {
      return await db.select().from(customFieldDefinitions)
        .where(and(
          eq(customFieldDefinitions.organizationId, orgId),
          eq(customFieldDefinitions.entityType, entityType)
        ))
        .orderBy(customFieldDefinitions.displayOrder, customFieldDefinitions.id);
    }
    return await db.select().from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.organizationId, orgId))
      .orderBy(customFieldDefinitions.displayOrder, customFieldDefinitions.id);
  },

  async getCustomFieldDefinition(this: DatabaseStorage, orgId: number, id: number): Promise<CustomFieldDefinition | undefined> {
    const [definition] = await db.select().from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.organizationId, orgId), eq(customFieldDefinitions.id, id)));
    return definition;
  },

  async createCustomFieldDefinition(this: DatabaseStorage, definition: InsertCustomFieldDefinition): Promise<CustomFieldDefinition> {
    const [newDefinition] = await db.insert(customFieldDefinitions).values(definition).returning();
    return newDefinition;
  },

  async updateCustomFieldDefinition(this: DatabaseStorage, id: number, updates: Partial<InsertCustomFieldDefinition>, organizationId?: number): Promise<CustomFieldDefinition> {
    const conditions = [eq(customFieldDefinitions.id, id)];
    if (organizationId) conditions.push(eq(customFieldDefinitions.organizationId, organizationId));
    const [updated] = await db.update(customFieldDefinitions)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteCustomFieldDefinition(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    // Verify definition belongs to org before deleting child records
    if (organizationId) {
      const [def] = await db.select().from(customFieldDefinitions)
        .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.organizationId, organizationId)));
      if (!def) return;
    }
    await db.delete(customFieldValues).where(eq(customFieldValues.definitionId, id));
    const conditions = [eq(customFieldDefinitions.id, id)];
    if (organizationId) conditions.push(eq(customFieldDefinitions.organizationId, organizationId));
    await db.delete(customFieldDefinitions).where(and(...conditions));
  },

  // Custom Field Values
  async getCustomFieldValues(this: DatabaseStorage, entityType: string, entityId: number): Promise<(CustomFieldValue & { definition: CustomFieldDefinition })[]> {
    const results = await db.select({
      value: customFieldValues,
      definition: customFieldDefinitions,
    })
      .from(customFieldValues)
      .innerJoin(customFieldDefinitions, eq(customFieldValues.definitionId, customFieldDefinitions.id))
      .where(and(
        eq(customFieldDefinitions.entityType, entityType),
        eq(customFieldValues.entityId, entityId)
      ))
      .orderBy(customFieldDefinitions.displayOrder, customFieldDefinitions.id);

    return results.map(r => ({ ...r.value, definition: r.definition }));
  },

  async setCustomFieldValue(this: DatabaseStorage, definitionId: number, entityId: number, value: string | null): Promise<CustomFieldValue> {
    const [existing] = await db.select().from(customFieldValues)
      .where(and(
        eq(customFieldValues.definitionId, definitionId),
        eq(customFieldValues.entityId, entityId)
      ));

    if (existing) {
      const [updated] = await db.update(customFieldValues)
        .set({ value, updatedAt: new Date() })
        .where(eq(customFieldValues.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(customFieldValues)
        .values({ definitionId, entityId, value })
        .returning();
      return created;
    }
  },

  async deleteCustomFieldValuesForEntity(this: DatabaseStorage, entityType: string, entityId: number): Promise<void> {
    const definitions = await this.getCustomFieldDefinitions(0, entityType);
    const definitionIds = definitions.map(d => d.id);
    if (definitionIds.length > 0) {
      await db.delete(customFieldValues)
        .where(and(
          eq(customFieldValues.entityId, entityId),
          sql`${customFieldValues.definitionId} = ANY(${definitionIds})`
        ));
    }
  },

  // Saved Views
  async getSavedViews(this: DatabaseStorage, orgId: number, entityType?: string): Promise<SavedView[]> {
    if (entityType) {
      return await db.select().from(savedViews)
        .where(and(
          eq(savedViews.organizationId, orgId),
          eq(savedViews.entityType, entityType)
        ))
        .orderBy(desc(savedViews.isDefault), savedViews.name);
    }
    return await db.select().from(savedViews)
      .where(eq(savedViews.organizationId, orgId))
      .orderBy(desc(savedViews.isDefault), savedViews.name);
  },

  async getSavedView(this: DatabaseStorage, orgId: number, id: number): Promise<SavedView | undefined> {
    const [view] = await db.select().from(savedViews)
      .where(and(eq(savedViews.organizationId, orgId), eq(savedViews.id, id)));
    return view;
  },

  async createSavedView(this: DatabaseStorage, view: InsertSavedView): Promise<SavedView> {
    const [newView] = await db.insert(savedViews).values(view).returning();
    return newView;
  },

  async updateSavedView(this: DatabaseStorage, id: number, updates: Partial<InsertSavedView>, organizationId?: number): Promise<SavedView> {
    const conditions = [eq(savedViews.id, id)];
    if (organizationId) conditions.push(eq(savedViews.organizationId, organizationId));
    const [updated] = await db.update(savedViews)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteSavedView(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(savedViews.id, id)];
    if (organizationId) conditions.push(eq(savedViews.organizationId, organizationId));
    await db.delete(savedViews).where(and(...conditions));
  },

  async setDefaultView(this: DatabaseStorage, orgId: number, entityType: string, viewId: number): Promise<SavedView> {
    await db.update(savedViews)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(
        eq(savedViews.organizationId, orgId),
        eq(savedViews.entityType, entityType)
      ));
    
    const [updated] = await db.update(savedViews)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(savedViews.id, viewId))
      .returning();
    return updated;
  },

  // Workspace Presets
  async getWorkspacePresets(this: DatabaseStorage, orgId: number, userId?: string): Promise<WorkspacePreset[]> {
    if (userId) {
      return await db.select().from(workspacePresets)
        .where(and(
          eq(workspacePresets.organizationId, orgId),
          eq(workspacePresets.userId, userId)
        ))
        .orderBy(workspacePresets.sortOrder, workspacePresets.name);
    }
    return await db.select().from(workspacePresets)
      .where(eq(workspacePresets.organizationId, orgId))
      .orderBy(workspacePresets.sortOrder, workspacePresets.name);
  },

  async getWorkspacePreset(this: DatabaseStorage, orgId: number, id: number): Promise<WorkspacePreset | undefined> {
    const [preset] = await db.select().from(workspacePresets)
      .where(and(eq(workspacePresets.organizationId, orgId), eq(workspacePresets.id, id)));
    return preset;
  },

  async createWorkspacePreset(this: DatabaseStorage, preset: InsertWorkspacePreset): Promise<WorkspacePreset> {
    const [newPreset] = await db.insert(workspacePresets).values(preset).returning();
    return newPreset;
  },

  async updateWorkspacePreset(this: DatabaseStorage, id: number, updates: Partial<InsertWorkspacePreset>, organizationId?: number): Promise<WorkspacePreset> {
    const conditions = [eq(workspacePresets.id, id)];
    if (organizationId) conditions.push(eq(workspacePresets.organizationId, organizationId));
    const [updated] = await db.update(workspacePresets)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteWorkspacePreset(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(workspacePresets.id, id)];
    if (organizationId) conditions.push(eq(workspacePresets.organizationId, organizationId));
    await db.delete(workspacePresets).where(and(...conditions));
  },

  // Notification Preferences
  async getNotificationPreferences(this: DatabaseStorage, userId: string, orgId: number): Promise<NotificationPreference[]> {
    return await db.select().from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.organizationId, orgId)
      ));
  },

  async upsertNotificationPreference(this: DatabaseStorage, pref: InsertNotificationPreference): Promise<NotificationPreference> {
    const existing = await db.select().from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.userId, pref.userId),
        eq(notificationPreferences.organizationId, pref.organizationId),
        eq(notificationPreferences.eventType, pref.eventType)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      const [updated] = await db.update(notificationPreferences)
        .set({ ...pref, updatedAt: new Date() })
        .where(eq(notificationPreferences.id, existing[0].id))
        .returning();
      return updated;
    }
    
    const [created] = await db.insert(notificationPreferences).values(pref).returning();
    return created;
  },

  async updateNotificationPreference(this: DatabaseStorage, id: number, updates: Partial<InsertNotificationPreference>, organizationId?: number): Promise<NotificationPreference> {
    const conditions = [eq(notificationPreferences.id, id)];
    if (organizationId) conditions.push(eq(notificationPreferences.organizationId, organizationId));
    const [updated] = await db.update(notificationPreferences)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },
};

export type CustomizationRepo = typeof customizationRepo;
