// Leads + lead-activity + soft-delete/recovery + scoring + dedup.
// Extracted from the god-class server/storage.ts.

import { and, asc, desc, eq, sql, count, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  leads, leadActivities, activityLog,
  type Lead, type InsertLead,
  type LeadActivity, type InsertLeadActivity,
} from "@shared/schema";
import { assertNotUnderLegalHold, filterOutHeldIds } from "../services/legalHold";
import type { DatabaseStorage, PaginationOptions, PaginatedResult } from "../storage";

export const leadRepo = {
  // Leads
  async getLeads(this: DatabaseStorage, orgId: number, filters?: { assignedTo?: number | null }): Promise<Lead[]> {
    const conditions: any[] = [eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`];
    if (filters?.assignedTo === null) {
      conditions.push(sql`${leads.assignedTo} IS NULL`);
    } else if (filters?.assignedTo !== undefined) {
      conditions.push(eq(leads.assignedTo, filters.assignedTo));
    }
    return await db.select().from(leads)
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt))
      .limit(5000);
  },

  async getLeadsPaginated(this: DatabaseStorage, orgId: number, options: PaginationOptions, filters?: { assignedTo?: number | null }): Promise<PaginatedResult<Lead>> {
    const conditions: any[] = [eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`];
    if (filters?.assignedTo === null) {
      conditions.push(sql`${leads.assignedTo} IS NULL`);
    } else if (filters?.assignedTo !== undefined) {
      conditions.push(eq(leads.assignedTo, filters.assignedTo));
    }
    const whereClause = and(...conditions);
    const [{ count: total }] = await db.select({ count: count() }).from(leads).where(whereClause);
    const totalNum = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalNum / options.pageSize));
    const offset = (options.page - 1) * options.pageSize;

    const sortColumn = (leads as any)[options.sortBy] ?? leads.createdAt;
    const orderFn = options.sortOrder === "asc" ? asc : desc;

    const data = await db.select().from(leads)
      .where(whereClause)
      .orderBy(orderFn(sortColumn))
      .limit(options.pageSize)
      .offset(offset);

    return { data, total: totalNum, page: options.page, pageSize: options.pageSize, totalPages };
  },

  async getLead(this: DatabaseStorage, orgId: number, id: number): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads)
      .where(and(eq(leads.organizationId, orgId), eq(leads.id, id)));
    return lead;
  },

  // organizationId is omitted from InsertLead (set server-side) but the DB
  // column is NOT NULL — callers supply it, so it is required here.
  async createLead(this: DatabaseStorage, lead: InsertLead & { organizationId: number }): Promise<Lead> {
    const [newLead] = await db.insert(leads).values(lead).returning();
    await this.logActivity({
      organizationId: lead.organizationId,
      action: "created",
      entityType: "lead",
      entityId: newLead.id,
      description: `Lead ${newLead.firstName} ${newLead.lastName} created`,
    });
    return newLead;
  },

  async createLeadsBatch(this: DatabaseStorage, leadsData: (InsertLead & { organizationId: number })[]): Promise<Lead[]> {
    if (leadsData.length === 0) return [];
    // Batch insert all leads in a single query instead of N individual inserts
    const newLeads = await db.insert(leads).values(leadsData).returning();
    // Batch-log activity for all created leads
    if (newLeads.length > 0) {
      const activityEntries = newLeads.map((lead) => ({
        organizationId: lead.organizationId,
        action: "created" as const,
        entityType: "lead" as const,
        entityId: lead.id,
        description: `Lead ${lead.firstName} ${lead.lastName} created (batch import)`,
      }));
      await db.insert(activityLog).values(activityEntries);
    }
    return newLeads;
  },

  async updateLead(this: DatabaseStorage, id: number, updates: Partial<InsertLead>, organizationId?: number): Promise<Lead> {
    const conditions = [eq(leads.id, id)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));
    const [updated] = await db.update(leads)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteLead(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    // Task 223: Soft delete — set status='deleted' instead of hard-deleting so the
    // record is preserved for audit purposes.
    // Phase 3 Week 11 (legal-hold): even soft-delete is blocked while a hold
    // is active — operators must explicitly release the hold first to make
    // the audit trail of deletion-attempts unambiguous.
    if (organizationId !== undefined) {
      await assertNotUnderLegalHold(organizationId, "lead", id);
    }
    const conditions = [eq(leads.id, id)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));
    await db.update(leads)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(...conditions));
  },

  async getLeadCount(this: DatabaseStorage, orgId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(leads)
      .where(and(eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`));
    return result?.count || 0;
  },

  async bulkDeleteLeads(this: DatabaseStorage, orgId: number, ids: number[], _userId?: string): Promise<number> {
    // Task 223: Soft delete — set status='deleted' rather than hard-deleting
    // Legal-hold (Phase 3 Week 11): drop held ids from the batch before delete.
    if (ids.length === 0) return 0;
    const allowed = await filterOutHeldIds(orgId, "lead", ids);
    if (allowed.length === 0) return 0;
    await db.update(leads)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(eq(leads.organizationId, orgId), inArray(leads.id, allowed)));
    return allowed.length;
  },

  async bulkUpdateLeads(this: DatabaseStorage, orgId: number, ids: number[], updates: Partial<InsertLead>): Promise<number> {
    if (ids.length === 0) return 0;
    await db.update(leads)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, ids),
        sql`${leads.deletedAt} IS NULL` // Only update active leads
      ));
    return ids.length;
  },

  // Lead Soft-Delete & Recovery methods
  async getDeletedLeads(this: DatabaseStorage, orgId: number): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        sql`${leads.deletedAt} IS NOT NULL`
      ))
      .orderBy(desc(leads.deletedAt))
      .limit(5000);
  },

  async restoreLeads(this: DatabaseStorage, orgId: number, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    await db.update(leads)
      .set({
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date()
      })
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, ids),
        sql`${leads.deletedAt} IS NOT NULL`
      ));
    return ids.length;
  },

  async permanentlyDeleteLeads(this: DatabaseStorage, orgId: number, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    // Hard delete - only for already soft-deleted leads
    // Legal-hold (Phase 3 Week 11): permadelete is the destructive path
    // FRCP 37(e) targets — every held id is filtered out before DELETE.
    const allowed = await filterOutHeldIds(orgId, "lead", ids);
    if (allowed.length === 0) return 0;
    await db.delete(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, allowed),
        sql`${leads.deletedAt} IS NOT NULL`
      ));
    return allowed.length;
  },

  async getLeadsByIds(this: DatabaseStorage, orgId: number, ids: number[]): Promise<Lead[]> {
    if (ids.length === 0) return [];
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, ids),
        sql`${leads.deletedAt} IS NULL`
      ));
  },

  async findDuplicateLeads(this: DatabaseStorage, orgId: number, criteria: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
  }): Promise<Lead[]> {
    const conditions: SQL[] = [eq(leads.organizationId, orgId)];

    const orConditions: SQL[] = [];

    if (criteria.email) {
      orConditions.push(ilike(leads.email, criteria.email.trim()));
    }

    if (criteria.phone) {
      const normalizedPhone = criteria.phone.replace(/\D/g, "");
      if (normalizedPhone.length >= 10) {
        orConditions.push(sql`REPLACE(REPLACE(REPLACE(${leads.phone}, '-', ''), ' ', ''), '(', '') LIKE '%' || ${normalizedPhone.slice(-10)} || '%'`);
      }
    }

    if (criteria.firstName && criteria.lastName) {
      orConditions.push(
        and(
          ilike(leads.firstName, criteria.firstName.trim()),
          ilike(leads.lastName, criteria.lastName.trim())
        )!
      );
    }

    if (criteria.address) {
      const cleanAddress = criteria.address.trim().toLowerCase();
      orConditions.push(sql`LOWER(${leads.address}) LIKE '%' || ${cleanAddress} || '%'`);
    }

    if (orConditions.length === 0) {
      return [];
    }

    conditions.push(or(...orConditions)!);

    return await db.select().from(leads)
      .where(and(...conditions))
      .limit(20);
  },

  async mergeLeads(this: DatabaseStorage, orgId: number, primaryId: number, duplicateId: number): Promise<Lead> {
    const [primary, duplicate] = await Promise.all([
      this.getLead(orgId, primaryId),
      this.getLead(orgId, duplicateId),
    ]);

    if (!primary || !duplicate) {
      throw new Error("Lead not found");
    }

    const mergedData: Partial<InsertLead> = {};
    const fieldsToMerge: (keyof InsertLead)[] = [
      "email", "phone", "address", "city", "state", "zip", "notes", "source",
    ];

    for (const field of fieldsToMerge) {
      const primaryVal = primary[field as keyof Lead];
      const duplicateVal = duplicate[field as keyof Lead];
      if (!primaryVal && duplicateVal) {
        (mergedData as any)[field] = duplicateVal;
      }
    }

    if (duplicate.notes && primary.notes) {
      mergedData.notes = `${primary.notes}\n\n--- Merged from duplicate lead ---\n${duplicate.notes}`;
    } else if (duplicate.notes && !primary.notes) {
      mergedData.notes = duplicate.notes;
    }

    const updated = await this.updateLead(primaryId, mergedData);
    await this.deleteLead(duplicateId);

    await this.logActivity({
      organizationId: orgId,
      action: "merged",
      entityType: "lead",
      entityId: primaryId,
      description: `Merged duplicate lead #${duplicateId} into lead #${primaryId}`,
    });

    return updated;
  },

  // Lead Scoring & Nurturing
  async getLeadsNeedingScoring(this: DatabaseStorage, orgId: number, limit: number = 50): Promise<Lead[]> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        sql`${leads.status} != 'dead'`,
        sql`${leads.status} != 'closed'`,
        or(
          sql`${leads.lastScoreAt} IS NULL`,
          lte(leads.lastScoreAt, oneDayAgo)
        )
      ))
      .orderBy(sql`${leads.lastScoreAt} NULLS FIRST`)
      .limit(limit);
  },

  async getLeadsDueForFollowUp(this: DatabaseStorage, orgId: number): Promise<Lead[]> {
    const now = new Date();
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        sql`${leads.status} != 'dead'`,
        sql`${leads.status} != 'closed'`,
        lte(leads.nextFollowUpAt, now)
      ))
      .orderBy(leads.nextFollowUpAt)
      .limit(100);
  },

  async createLeadActivity(this: DatabaseStorage, activity: InsertLeadActivity): Promise<LeadActivity> {
    const [newActivity] = await db.insert(leadActivities).values(activity).returning();
    return newActivity;
  },

  async getLeadActivities(this: DatabaseStorage, leadId: number, limit: number = 50): Promise<LeadActivity[]> {
    return await db.select().from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt))
      .limit(limit);
  },

  async updateLeadScore(this: DatabaseStorage, leadId: number, score: number, scoreFactors: Lead["scoreFactors"], organizationId?: number): Promise<Lead> {
    const conditions = [eq(leads.id, leadId)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));
    const [updated] = await db.update(leads)
      .set({
        score,
        scoreFactors,
        lastScoreAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return updated;
  },
};

export type LeadRepo = typeof leadRepo;
