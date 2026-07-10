// Acquisition-targeting data layer: target counties, offer letters (incl.
// batch creation), offer templates, and the enhanced per-property due-
// diligence checklist (get-or-create + update). Extracted from the
// god-class server/storage.ts in the storage refactor. Methods are merged
// into DatabaseStorage.prototype at construction time; `this` refers to the
// full DatabaseStorage instance.

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  targetCounties,
  offerLetters,
  offerTemplates,
  dueDiligenceChecklists,
  type InsertTargetCounty,
  type InsertOfferLetter,
  type InsertOfferTemplate,
  type InsertDueDiligenceChecklist,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const acquisitionRepo = {
  // Target Counties
  async getTargetCounties(this: DatabaseStorage, orgId: number) {
    return db.select().from(targetCounties).where(eq(targetCounties.organizationId, orgId)).orderBy(targetCounties.priority, targetCounties.name);
  },

  async getTargetCounty(this: DatabaseStorage, orgId: number, id: number) {
    const [county] = await db.select().from(targetCounties).where(and(eq(targetCounties.id, id), eq(targetCounties.organizationId, orgId)));
    return county;
  },

  async createTargetCounty(this: DatabaseStorage, county: InsertTargetCounty) {
    const [created] = await db.insert(targetCounties).values(county).returning();
    return created;
  },

  async updateTargetCounty(this: DatabaseStorage, id: number, updates: Partial<InsertTargetCounty>, organizationId?: number) {
    const conditions = [eq(targetCounties.id, id)];
    if (organizationId) conditions.push(eq(targetCounties.organizationId, organizationId));
    const [updated] = await db.update(targetCounties).set({ ...updates, updatedAt: new Date() }).where(and(...conditions)).returning();
    return updated;
  },

  async deleteTargetCounty(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(targetCounties.id, id)];
    if (organizationId) conditions.push(eq(targetCounties.organizationId, organizationId));
    await db.delete(targetCounties).where(and(...conditions));
  },

  // Offer Letters
  async getOfferLetters(this: DatabaseStorage, orgId: number, filters?: { status?: string; batchId?: string }) {
    const conditions = [eq(offerLetters.organizationId, orgId)];
    if (filters?.status) {
      conditions.push(eq(offerLetters.status, filters.status));
    }
    if (filters?.batchId) {
      conditions.push(eq(offerLetters.batchId, filters.batchId));
    }

    return db.select().from(offerLetters)
      .where(and(...conditions))
      .orderBy(desc(offerLetters.createdAt));
  },

  async getOfferLetter(this: DatabaseStorage, orgId: number, id: number) {
    const [letter] = await db.select().from(offerLetters)
      .where(and(eq(offerLetters.id, id), eq(offerLetters.organizationId, orgId)));
    return letter;
  },

  async createOfferLetter(this: DatabaseStorage, letter: InsertOfferLetter) {
    const [created] = await db.insert(offerLetters).values(letter).returning();
    return created;
  },

  async createOfferLettersBatch(this: DatabaseStorage, letters: InsertOfferLetter[]) {
    if (letters.length === 0) return [];
    const created = await db.insert(offerLetters).values(letters).returning();
    return created;
  },

  async updateOfferLetter(this: DatabaseStorage, id: number, updates: Partial<InsertOfferLetter>, organizationId?: number) {
    const conditions = [eq(offerLetters.id, id)];
    if (organizationId) conditions.push(eq(offerLetters.organizationId, organizationId));
    const [updated] = await db.update(offerLetters)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteOfferLetter(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(offerLetters.id, id)];
    if (organizationId) conditions.push(eq(offerLetters.organizationId, organizationId));
    await db.delete(offerLetters).where(and(...conditions));
  },

  // Offer Templates
  async getOfferTemplates(this: DatabaseStorage, orgId: number) {
    return db.select().from(offerTemplates)
      .where(eq(offerTemplates.organizationId, orgId))
      .orderBy(desc(offerTemplates.isDefault), offerTemplates.name);
  },

  async getOfferTemplate(this: DatabaseStorage, orgId: number, id: number) {
    const [template] = await db.select().from(offerTemplates)
      .where(and(eq(offerTemplates.id, id), eq(offerTemplates.organizationId, orgId)));
    return template;
  },

  async createOfferTemplate(this: DatabaseStorage, template: InsertOfferTemplate) {
    const [created] = await db.insert(offerTemplates).values(template).returning();
    return created;
  },

  async updateOfferTemplate(this: DatabaseStorage, id: number, updates: Partial<InsertOfferTemplate>, organizationId?: number) {
    const conditions = [eq(offerTemplates.id, id)];
    if (organizationId) conditions.push(eq(offerTemplates.organizationId, organizationId));
    const [updated] = await db.update(offerTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteOfferTemplate(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(offerTemplates.id, id)];
    if (organizationId) conditions.push(eq(offerTemplates.organizationId, organizationId));
    await db.delete(offerTemplates).where(and(...conditions));
  },

  // Due Diligence Checklists (Enhanced)
  async getDueDiligenceChecklist(this: DatabaseStorage, propertyId: number) {
    const [checklist] = await db.select().from(dueDiligenceChecklists)
      .where(eq(dueDiligenceChecklists.propertyId, propertyId));
    return checklist;
  },

  async getOrCreateDueDiligenceChecklist(this: DatabaseStorage, orgId: number, propertyId: number) {
    const existing = await this.getDueDiligenceChecklist(propertyId);
    if (existing) return existing;

    const defaultItems = [
      { id: "env-flood", category: "environmental", name: "Flood Zone Check", status: "pending", dataSource: "FEMA" },
      { id: "env-wetlands", category: "environmental", name: "Wetlands Assessment", status: "pending", dataSource: "NWI" },
      { id: "env-soil", category: "environmental", name: "Soil Analysis", status: "pending", dataSource: "USDA NRCS" },
      { id: "env-epa", category: "environmental", name: "EPA Superfund Sites", status: "pending", dataSource: "EPA TRI" },
      { id: "tax-history", category: "taxes", name: "Tax History Review", status: "pending", dataSource: "County Records" },
      { id: "tax-back", category: "taxes", name: "Back Taxes Check", status: "pending", dataSource: "County Treasurer" },
      { id: "tax-sale", category: "taxes", name: "Tax Sale Status", status: "pending", dataSource: "County Records" },
      { id: "legal-hoa", category: "legal", name: "HOA/POA Check", status: "pending", dataSource: "Title Search" },
      { id: "legal-deed", category: "legal", name: "Deed Restrictions", status: "pending", dataSource: "County Recorder" },
      { id: "legal-easements", category: "legal", name: "Easements Review", status: "pending", dataSource: "Title Search" },
      { id: "access-legal", category: "access", name: "Legal Access Verification", status: "pending", dataSource: "Survey/Plat" },
      { id: "access-road", category: "access", name: "Road Type Assessment", status: "pending", dataSource: "Site Visit" },
      { id: "access-maintenance", category: "access", name: "Road Maintenance Responsibility", status: "pending", dataSource: "County/HOA" },
      { id: "util-electric", category: "utilities", name: "Electric Availability", status: "pending", dataSource: "Utility Provider" },
      { id: "util-water", category: "utilities", name: "Water Access", status: "pending", dataSource: "Utility/Well Records" },
      { id: "util-sewer", category: "utilities", name: "Sewer/Septic Status", status: "pending", dataSource: "Health Dept" },
      { id: "util-internet", category: "utilities", name: "Internet Availability", status: "pending", dataSource: "ISP Check" },
    ];

    const [checklist] = await db.insert(dueDiligenceChecklists).values({
      organizationId: orgId,
      propertyId,
      status: "in_progress",
      completedPercent: 0,
      items: defaultItems,
    }).returning();
    return checklist;
  },

  async updateDueDiligenceChecklist(this: DatabaseStorage, id: number, updates: Partial<InsertDueDiligenceChecklist>, organizationId?: number) {
    if (updates.items) {
      const items = updates.items as any[];
      const completedCount = items.filter(i => i.status === "passed" || i.status === "failed" || i.status === "skipped").length;
      updates.completedPercent = Math.round((completedCount / items.length) * 100);
      if (updates.completedPercent === 100) {
        updates.status = "completed";
        updates.completedAt = new Date();
      }
    }
    const conditions = [eq(dueDiligenceChecklists.id, id)];
    if (organizationId) conditions.push(eq(dueDiligenceChecklists.organizationId, organizationId));
    const [updated] = await db.update(dueDiligenceChecklists)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },
};

export type AcquisitionRepo = typeof acquisitionRepo;
