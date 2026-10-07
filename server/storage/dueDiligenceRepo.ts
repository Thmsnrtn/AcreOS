// Due-diligence + deal-checklist data layer: DD templates (with default
// seeding), per-property DD items, deal checklist templates, and deal
// checklists (incl. stage-gate checks). Extracted from the god-class
// server/storage.ts in the storage refactor. Methods are merged into
// DatabaseStorage.prototype at construction time; `this` refers to the full
// DatabaseStorage instance (the many in-cluster self-calls resolve against
// the composed prototype).

import { and, desc, eq, inArray } from "drizzle-orm";
import { omitProtectedFields } from "../utils/updatePayload";
import { db } from "../db";
import { forOrg } from "../utils/orgScopedDb";
import {
  dueDiligenceTemplates,
  dueDiligenceItems,
  checklistTemplates,
  dealChecklists,
  properties,
  deals,
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
import { assertWritablePatch } from "../utils/patch";
import { clock } from "../utils/clock";

// due_diligence_items and deal_checklists carry no organization column: the
// owning organization is the parent property's / deal's. The reads, updates
// and deletes below that address one of those rows by its own id or by its
// parent id constrain the parent to the caller's organization in the same
// statement, through these subqueries. The INSERTS (createDueDiligenceItem,
// createDealChecklist) take no organization: their callers prove the parent
// first — applyTemplateToProperty and applyChecklistTemplateToDeal do so
// inside this file, and the routes do so with getProperty / getDeal.
function orgPropertyIds(organizationId: number, propertyId?: number) {
  return db.select({ id: properties.id }).from(properties).where(
    propertyId === undefined
      ? eq(properties.organizationId, organizationId)
      : and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
  );
}

function orgDealIds(organizationId: number, dealId?: number) {
  return db.select({ id: deals.id }).from(deals).where(
    dealId === undefined
      ? eq(deals.organizationId, organizationId)
      : and(eq(deals.id, dealId), eq(deals.organizationId, organizationId)),
  );
}

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

  async updateDueDiligenceTemplate(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertDueDiligenceTemplate>) {
    const [updated] = await db.update(dueDiligenceTemplates)
      .set(assertWritablePatch(updates, "due_diligence_templates.updateDueDiligenceTemplate"))
      .where(and(eq(dueDiligenceTemplates.id, id), eq(dueDiligenceTemplates.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteDueDiligenceTemplate(this: DatabaseStorage, organizationId: number, id: number) {
    await db.delete(dueDiligenceTemplates)
      .where(and(eq(dueDiligenceTemplates.id, id), eq(dueDiligenceTemplates.organizationId, organizationId)));
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
  async getPropertyDueDiligence(this: DatabaseStorage, organizationId: number, propertyId: number) {
    return await db.select().from(dueDiligenceItems)
      .where(and(
        eq(dueDiligenceItems.propertyId, propertyId),
        inArray(dueDiligenceItems.propertyId, orgPropertyIds(organizationId, propertyId)),
      ))
      .orderBy(dueDiligenceItems.category, dueDiligenceItems.itemName);
  },

  async createDueDiligenceItem(this: DatabaseStorage, item: InsertDueDiligenceItem) {
    const [newItem] = await db.insert(dueDiligenceItems).values(item).returning();
    return newItem;
  },

  async updateDueDiligenceItem(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertDueDiligenceItem>) {
    const updateData: any = { ...updates };
    if (updates.completed === true && !updates.completedAt) {
      updateData.completedAt = clock.now();
    }
    if (updates.completed === false) {
      updateData.completedAt = null;
      updateData.completedBy = null;
    }
    const [updated] = await db.update(dueDiligenceItems)
      .set(assertWritablePatch(updateData, "due_diligence_items.updateDueDiligenceItem"))
      .where(and(
        eq(dueDiligenceItems.id, id),
        inArray(dueDiligenceItems.propertyId, orgPropertyIds(organizationId)),
      ))
      .returning();
    return updated;
  },

  async deleteDueDiligenceItem(this: DatabaseStorage, organizationId: number, id: number) {
    await db.delete(dueDiligenceItems).where(and(
      eq(dueDiligenceItems.id, id),
      inArray(dueDiligenceItems.propertyId, orgPropertyIds(organizationId)),
    ));
  },

  async applyTemplateToProperty(this: DatabaseStorage, organizationId: number, propertyId: number, templateId: number) {
    const template = await this.getDueDiligenceTemplate(organizationId, templateId);
    if (!template) {
      throw new Error("Template not found");
    }
    const [property] = await orgPropertyIds(organizationId, propertyId);
    if (!property) {
      throw new Error("Property not found");
    }

    await db.delete(dueDiligenceItems).where(and(
      eq(dueDiligenceItems.propertyId, propertyId),
      inArray(dueDiligenceItems.propertyId, orgPropertyIds(organizationId, propertyId)),
    ));

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

  async updateChecklistTemplate(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertChecklistTemplate>) {
    const [updated] = await db.update(checklistTemplates)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteChecklistTemplate(this: DatabaseStorage, organizationId: number, id: number) {
    await db.delete(checklistTemplates)
      .where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.organizationId, organizationId)));
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
  async getDealChecklist(this: DatabaseStorage, organizationId: number, dealId: number) {
    const [checklist] = await db.select().from(dealChecklists)
      .where(and(
        eq(dealChecklists.dealId, dealId),
        inArray(dealChecklists.dealId, orgDealIds(organizationId, dealId)),
      ));
    return checklist;
  },

  async createDealChecklist(this: DatabaseStorage, checklist: InsertDealChecklist) {
    const [newChecklist] = await db.insert(dealChecklists).values(checklist).returning();
    return newChecklist;
  },

  async updateDealChecklist(this: DatabaseStorage, organizationId: number, id: number, updates: Partial<InsertDealChecklist>) {
    const [updated] = await db.update(dealChecklists)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(
        eq(dealChecklists.id, id),
        inArray(dealChecklists.dealId, orgDealIds(organizationId)),
      ))
      .returning();
    return updated;
  },

  async applyChecklistTemplateToDeal(this: DatabaseStorage, organizationId: number, dealId: number, templateId: number) {
    const template = await this.getChecklistTemplate(organizationId, templateId);
    if (!template) {
      throw new Error("Template not found");
    }

    const templateItems: DealChecklistItem[] = template.items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      required: item.required,
      documentRequired: item.documentRequired,
    }));

    // MERGE, never wipe (DEFECT-0176). This deleted the deal's checklist row
    // outright — the closing checklist (which shares the row) and every
    // completed item with it. Kept: the closing generator's items and any
    // item with progress; added: template items not already present.
    const existing = await this.getDealChecklist(organizationId, dealId);
    if (!existing) {
      const [deal] = await orgDealIds(organizationId, dealId);
      if (!deal) {
        throw new Error("Deal not found");
      }
      return await this.createDealChecklist({ dealId, templateId, items: templateItems });
    }
    const kept = existing.items.filter((i) => i.phase || i.checkedAt || i.completed);
    const keptIds = new Set(kept.map((i) => i.id));
    const items = [...kept, ...templateItems.filter((i) => !keptIds.has(i.id))];
    return await this.updateDealChecklist(organizationId, existing.id, { templateId, items });
  },

  async updateDealChecklistItem(this: DatabaseStorage,
    organizationId: number,
    dealId: number,
    itemId: string,
    updates: { checked?: boolean; documentUrl?: string; checkedBy?: string; verification?: DealChecklistItem["verification"] }
  ) {
    const checklist = await this.getDealChecklist(organizationId, dealId);
    if (!checklist) {
      throw new Error("Checklist not found for this deal");
    }

    const updatedItems = checklist.items.map(item => {
      if (item.id === itemId) {
        const updatedItem = { ...item };
        if (updates.checked !== undefined) {
          if (updates.checked) {
            updatedItem.checkedAt = clock.now().toISOString();
            updatedItem.checkedBy = updates.checkedBy;
          } else {
            // Untick clears BOTH vocabularies and the evidence (DEFECT-0176
            // audit): the closing route's `completed` otherwise kept the item
            // "done" for the stage gate after the deal page unticked it.
            updatedItem.checkedAt = undefined;
            updatedItem.checkedBy = undefined;
            updatedItem.completed = false;
            updatedItem.completedAt = undefined;
            updatedItem.verification = undefined;
          }
        }
        if (updates.documentUrl !== undefined) {
          updatedItem.documentUrl = updates.documentUrl;
        }
        if (updates.verification) {
          updatedItem.verification = updates.verification;
        }
        return updatedItem;
      }
      return item;
    });

    const allComplete = updatedItems.every(item => item.checkedAt || item.completed);
    const completedAt = allComplete ? clock.now() : null;

    return await this.updateDealChecklist(organizationId, checklist.id, {
      items: updatedItems,
      completedAt,
    });
  },

  async checkStageGate(
    this: DatabaseStorage,
    organizationId: number,
    dealId: number,
    toStage?: string,
  ): Promise<{ canAdvance: boolean; incompleteItems: DealChecklistItem[] }> {
    // Cancelling is never blocked by unfinished work.
    if (toStage === "cancelled") return { canAdvance: true, incompleteItems: [] };
    const checklist = await this.getDealChecklist(organizationId, dealId);
    if (!checklist) {
      return { canAdvance: true, incompleteItems: [] };
    }

    // A closing item blocks only the stages its phase must precede
    // (DEFECT-0180 audit): the gate was phase-blind, so a deal holding the
    // ~30 closing items — post-closing recording steps due weeks AFTER
    // closing among them — could not move at all without `force`.
    // Template items (no phase) keep the original rule.
    const phasesBefore: Record<string, string[]> = {
      offer_sent: [],
      countered: [],
      accepted: ["pre_contract"],
      // Title order, EMD, survey and lien search are escrow work: they must
      // be done by closing, not before escrow opens.
      in_escrow: ["pre_contract"],
      closed: ["pre_contract", "under_contract", "pre_closing", "closing_day"],
    };
    const blocking = toStage && Object.hasOwn(phasesBefore, toStage)
      ? new Set(phasesBefore[toStage])
      : new Set(["pre_contract", "under_contract", "pre_closing", "closing_day"]);

    // Either vocabulary counts as done (DEFECT-0176): the closing
    // checklist marks `completed`, the deal page marks `checkedAt`.
    const incompleteItems = checklist.items.filter(item =>
      item.required && !item.checkedAt && !item.completed && (!item.phase || blocking.has(item.phase))
    );

    return {
      canAdvance: incompleteItems.length === 0,
      incompleteItems,
    };
  },
};

export type DueDiligenceRepo = typeof dueDiligenceRepo;
