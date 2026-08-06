// Properties.
// Extracted from the god-class server/storage.ts.

import { and, desc, asc, eq, sql, count, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  properties, deals,
  dueDiligenceDossiers, dueDiligenceChecklists, dueDiligenceItems,
  propertyListings,
  type Property, type InsertProperty,
} from "@shared/schema";
import { assertNotUnderLegalHold } from "../services/legalHold";
import type { DatabaseStorage, PaginationOptions, PaginatedResult } from "../storage";
import { LIST_READ_CAP, capListRead } from "./listCap";

export const propertyRepo = {
  async getProperties(this: DatabaseStorage, orgId: number): Promise<Property[]> {
    // Task 223: exclude soft-deleted properties from list queries
    // Audit F-10-2: loud cap — truncation past the cap is logged, not silent.
    const rows = await db.select().from(properties)
      .where(and(eq(properties.organizationId, orgId), sql`${properties.status} != 'deleted'`))
      .orderBy(desc(properties.createdAt))
      .limit(LIST_READ_CAP + 1);
    return capListRead(rows, LIST_READ_CAP, "getProperties", orgId);
  },

  async getPropertiesPaginated(this: DatabaseStorage, orgId: number, options: PaginationOptions): Promise<PaginatedResult<Property>> {
    const whereClause = and(eq(properties.organizationId, orgId), sql`${properties.status} != 'deleted'`);
    const [{ count: total }] = await db.select({ count: count() }).from(properties).where(whereClause);
    const totalNum = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalNum / options.pageSize));
    const offset = (options.page - 1) * options.pageSize;

    const sortColumn = (properties as any)[options.sortBy] ?? properties.createdAt;
    const orderFn = options.sortOrder === "asc" ? asc : desc;

    const data = await db.select().from(properties)
      .where(whereClause)
      .orderBy(orderFn(sortColumn))
      .limit(options.pageSize)
      .offset(offset);

    return { data, total: totalNum, page: options.page, pageSize: options.pageSize, totalPages };
  },

  async getProperty(this: DatabaseStorage, orgId: number, id: number): Promise<Property | undefined> {
    const [property] = await db.select().from(properties)
      .where(and(eq(properties.organizationId, orgId), eq(properties.id, id)));
    return property;
  },

  // organizationId is omitted from InsertProperty (set server-side) but the DB
  // column is NOT NULL — callers supply it, so it is required here.
  async createProperty(this: DatabaseStorage, property: InsertProperty & { organizationId: number }): Promise<Property> {
    const [newProperty] = await db.insert(properties).values(property).returning();
    await this.logActivity({
      organizationId: property.organizationId,
      action: "created",
      entityType: "property",
      entityId: newProperty.id,
      description: `Property ${newProperty.apn} created`,
    });
    return newProperty;
  },

  async updateProperty(this: DatabaseStorage, id: number, updates: Partial<InsertProperty>, organizationId?: number): Promise<Property> {
    const conditions = [eq(properties.id, id)];
    if (organizationId) conditions.push(eq(properties.organizationId, organizationId));
    const [updated] = await db.update(properties)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteProperty(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    // Task 223: Soft delete — set status='deleted' on the property (and cascade soft-delete
    // dependent deals) so records are preserved for audit purposes.
    // Legal-hold (Phase 3 Week 11): blocks even soft-delete while a hold covers
    // the property (org_wide or property_specific).
    if (organizationId !== undefined) {
      await assertNotUnderLegalHold(organizationId, "property", id);
    }
    const conditions = [eq(properties.id, id)];
    if (organizationId) conditions.push(eq(properties.organizationId, organizationId));
    await db.update(properties)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(...conditions));
    // Soft-delete any deals tied to this property so they also disappear from list views
    const dealConditions: any[] = [eq(deals.propertyId, id)];
    if (organizationId) dealConditions.push(eq(deals.organizationId, organizationId));
    await db.update(deals)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(...dealConditions));
  },

  async getPropertyCount(this: DatabaseStorage, orgId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(properties).where(eq(properties.organizationId, orgId));
    return result?.count || 0;
  },

  async bulkDeleteProperties(this: DatabaseStorage, orgId: number, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;

    // Delete all related records first to avoid foreign key constraints
    await db.delete(dueDiligenceDossiers).where(inArray(dueDiligenceDossiers.propertyId, ids));
    await db.delete(dueDiligenceChecklists).where(inArray(dueDiligenceChecklists.propertyId, ids));
    await db.delete(dueDiligenceItems).where(inArray(dueDiligenceItems.propertyId, ids));
    await db.delete(propertyListings).where(inArray(propertyListings.propertyId, ids));
    await db.delete(deals).where(inArray(deals.propertyId, ids));

    // Now delete the properties
    await db.delete(properties)
      .where(and(eq(properties.organizationId, orgId), inArray(properties.id, ids)));
    return ids.length;
  },

  async bulkUpdateProperties(this: DatabaseStorage, orgId: number, ids: number[], updates: Partial<InsertProperty>): Promise<number> {
    if (ids.length === 0) return 0;
    await db.update(properties)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(properties.organizationId, orgId), inArray(properties.id, ids)));
    return ids.length;
  },
};

export type PropertyRepo = typeof propertyRepo;
