// Due-diligence + deal-checklist data layer: DD templates (with default
// seeding), per-property DD items, deal checklist templates, and deal
// checklists (incl. stage-gate checks). Extracted from the god-class
// server/storage.ts in the storage refactor. Methods are merged into
// DatabaseStorage.prototype at construction time; `this` refers to the full
// DatabaseStorage instance (the many in-cluster self-calls resolve against
// the composed prototype).

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { forOrg } from "../utils/orgScopedDb";
import {
  dueDiligenceTemplates,
  dueDiligenceItems,
  checklistTemplates,
  dealChecklists,
  DEFAULT_DUE_DILIGENCE_TEMPLATES,
  DEFAULT_DEAL_CHECKLIST_TEMPLATES,
  type DueDiligenceTemplate,
  type DueDiligenceItem,
  type ChecklistTemplate,
  type DealChecklistItem,
  type InsertDueDiligenceTemplate,
  type InsertDueDiligenceItem,
  type InsertChecklistTemplate,
  type InsertDealChecklist,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const dueDiligenceRepo = {
  // Due Diligence Templates
  async getDueDiligenceTemplates(this: DatabaseStorage, orgId: number) {
    return await db.select().from(dueDiligenceTemplates)
      .where(eq(dueDiligenceTemplates.organizationId, orgId))
      .orderBy(desc(dueDiligenceTemplates.isDefault), dueDiligenceTemplates.name);
  },

  // Tier 1F: org-scoped by construction.
  async getDueDiligenceTemplate(this: DatabaseStorage, organizationId: number, id: number) {
    return await forOrg(organizationId).findById(dueDiligenceTemplates, id);
  },

  async createDueDiligenceTemplate(this: DatabaseStorage, template: InsertDueDiligenceTemplate) {
    const [newTemplate] = await db.insert(dueDiligenceTemplates).values(template).returning();
    return newTemplate;
  },

  async updateDueDiligenceTemplate(this: DatabaseStorage, id: number, updates: Partial<InsertDueDiligenceTemplate>, organizationId?: number) {
    const conditions = [eq(dueDiligenceTemplates.id, id)];
    if (organizationId) conditions.push(eq(dueDiligenceTemplates.organizationId, organizationId));
    const [updated] = await db.update(dueDiligenceTemplates)
      .set(updates)
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteDueDiligenceTemplate(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(dueDiligenceTemplates.id, id)];
    if (organizationId) conditions.push(eq(dueDiligenceTemplates.organizationId, organizationId));
    await db.delete(dueDiligenceTemplates).where(and(...conditions));
  },

  async initializeDefaultTemplates(this: DatabaseStorage, orgId: number) {
    const existing = await this.getDueDiligenceTemplates(orgId);
    if (existing.length > 0) {
      return existing;
    }

    const templates: DueDiligenceTemplate[] = [];
    for (const templateData of DEFAULT_DUE_DILIGENCE_TEMPLATES) {
      const template = await this.createDueDiligenceTemplate({
        organizationId: orgId,
        name: templateData.name,
        items: templateData.items as any,
        isDefault: true,
      });
      templates.push(template);
    }
    return templates;
  },

  // Due Diligence Items (property checklist)
  async getPropertyDueDiligence(this: DatabaseStorage, propertyId: number) {
    return await db.select().from(dueDiligenceItems)
      .where(eq(dueDiligenceItems.propertyId, propertyId))
      .orderBy(dueDiligenceItems.category, dueDiligenceItems.itemName);
  },

  async createDueDiligenceItem(this: DatabaseStorage, item: InsertDueDiligenceItem) {
    const [newItem] = await db.insert(dueDiligenceItems).values(item).returning();
    return newItem;
  },

  async updateDueDiligenceItem(this: DatabaseStorage, id: number, updates: Partial<InsertDueDiligenceItem>) {
    const updateData: any = { ...updates };
    if (updates.completed === true && !updates.completedAt) {
      updateData.completedAt = new Date();
    }
    if (updates.completed === false) {
      updateData.completedAt = null;
      updateData.completedBy = null;
    }
    const [updated] = await db.update(dueDiligenceItems)
      .set(updateData)
      .where(eq(dueDiligenceItems.id, id))
      .returning();
    return updated;
  },

  async deleteDueDiligenceItem(this: DatabaseStorage, id: number) {
    await db.delete(dueDiligenceItems).where(eq(dueDiligenceItems.id, id));
  },

  async applyTemplateToProperty(this: DatabaseStorage, organizationId: number, propertyId: number, templateId: number) {
    const template = await this.getDueDiligenceTemplate(organizationId, templateId);
    if (!template) {
      throw new Error("Template not found");
    }

    await db.delete(dueDiligenceItems).where(eq(dueDiligenceItems.propertyId, propertyId));

    const items: DueDiligenceItem[] = [];
    for (const templateItem of template.items) {
      const item = await this.createDueDiligenceItem({
        propertyId,
        templateId,
        itemName: templateItem.name,
        category: templateItem.category,
        completed: false,
        notes: templateItem.description || null,
      });
      items.push(item);
    }
    return items;
  },

  // Deal Checklist Templates
  async getChecklistTemplates(this: DatabaseStorage, orgId: number) {
    return await db.select().from(checklistTemplates)
      .where(eq(checklistTemplates.organizationId, orgId))
      .orderBy(checklistTemplates.name);
  },

  // Tier 1F: org-scoped by construction.
  async getChecklistTemplate(this: DatabaseStorage, organizationId: number, id: number) {
    return await forOrg(organizationId).findById(checklistTemplates, id);
  },

  async createChecklistTemplate(this: DatabaseStorage, template: InsertChecklistTemplate) {
    const [newTemplate] = await db.insert(checklistTemplates).values(template).returning();
    return newTemplate;
  },

  async updateChecklistTemplate(this: DatabaseStorage, id: number, updates: Partial<InsertChecklistTemplate>, organizationId?: number) {
    const conditions = [eq(checklistTemplates.id, id)];
    if (organizationId) conditions.push(eq(checklistTemplates.organizationId, organizationId));
    const [updated] = await db.update(checklistTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteChecklistTemplate(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(checklistTemplates.id, id)];
    if (organizationId) conditions.push(eq(checklistTemplates.organizationId, organizationId));
    await db.delete(checklistTemplates).where(and(...conditions));
  },

  async initializeDefaultChecklistTemplates(this: DatabaseStorage, orgId: number) {
    const existing = await this.getChecklistTemplates(orgId);
    if (existing.length > 0) {
      return existing;
    }

    const templates: ChecklistTemplate[] = [];
    for (const templateData of DEFAULT_DEAL_CHECKLIST_TEMPLATES) {
      const template = await this.createChecklistTemplate({
        organizationId: orgId,
        name: templateData.name,
        description: templateData.description,
        dealType: templateData.dealType,
        items: templateData.items,
      });
      templates.push(template);
    }
    return templates;
  },

  // Deal Checklists
  async getDealChecklist(this: DatabaseStorage, dealId: number) {
    const [checklist] = await db.select().from(dealChecklists)
      .where(eq(dealChecklists.dealId, dealId));
    return checklist;
  },

  async createDealChecklist(this: DatabaseStorage, checklist: InsertDealChecklist) {
    const [newChecklist] = await db.insert(dealChecklists).values(checklist).returning();
    return newChecklist;
  },

  async updateDealChecklist(this: DatabaseStorage, id: number, updates: Partial<InsertDealChecklist>) {
    const [updated] = await db.update(dealChecklists)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dealChecklists.id, id))
      .returning();
    return updated;
  },

  async applyChecklistTemplateToDeal(this: DatabaseStorage, organizationId: number, dealId: number, templateId: number) {
    const template = await this.getChecklistTemplate(organizationId, templateId);
    if (!template) {
      throw new Error("Template not found");
    }

    await db.delete(dealChecklists).where(eq(dealChecklists.dealId, dealId));

    const items: DealChecklistItem[] = template.items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      required: item.required,
      documentRequired: item.documentRequired,
    }));

    const checklist = await this.createDealChecklist({
      dealId,
      templateId,
      items,
    });
    return checklist;
  },

  async updateDealChecklistItem(this: DatabaseStorage, 
    dealId: number, 
    itemId: string, 
    updates: { checked?: boolean; documentUrl?: string; checkedBy?: string }
  ) {
    const checklist = await this.getDealChecklist(dealId);
    if (!checklist) {
      throw new Error("Checklist not found for this deal");
    }

    const updatedItems = checklist.items.map(item => {
      if (item.id === itemId) {
        const updatedItem = { ...item };
        if (updates.checked !== undefined) {
          if (updates.checked) {
            updatedItem.checkedAt = new Date().toISOString();
            updatedItem.checkedBy = updates.checkedBy;
          } else {
            updatedItem.checkedAt = undefined;
            updatedItem.checkedBy = undefined;
          }
        }
        if (updates.documentUrl !== undefined) {
          updatedItem.documentUrl = updates.documentUrl;
        }
        return updatedItem;
      }
      return item;
    });

    const allComplete = updatedItems.every(item => item.checkedAt);
    const completedAt = allComplete ? new Date() : null;

    return await this.updateDealChecklist(checklist.id, {
      items: updatedItems,
      completedAt,
    });
  },

  async checkStageGate(this: DatabaseStorage, dealId: number): Promise<{ canAdvance: boolean; incompleteItems: DealChecklistItem[] }> {
    const checklist = await this.getDealChecklist(dealId);
    if (!checklist) {
      return { canAdvance: true, incompleteItems: [] };
    }

    const incompleteItems = checklist.items.filter(item => 
      item.required && !item.checkedAt
    );

    return {
      canAdvance: incompleteItems.length === 0,
      incompleteItems,
    };
  },
};

export type DueDiligenceRepo = typeof dueDiligenceRepo;
