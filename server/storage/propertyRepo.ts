// Properties.
// Extracted from the god-class server/storage.ts.

import { and, desc, asc, eq, sql, count, inArray, ilike, ne, or } from "drizzle-orm";
import { omitProtectedFields } from "../utils/updatePayload";
import { assertWritableLandStatus } from "../utils/landStatus";
import { db } from "../db";
import {
  properties, deals,
  type Property, type InsertProperty,
} from "@shared/schema";
import { assertNotUnderLegalHold } from "../services/legalHold";
import { recordDealTransitionEvidence } from "../services/dealLifecycleEvents";
import type { DatabaseStorage, PaginationOptions, PaginatedResult } from "../storage";
import { LIST_READ_CAP, capListRead } from "./listCap";
import { clock } from "../utils/clock";

/** Search / lookup filters for the paginated property list (DEFECT-0168). */
interface PropertyListFilters {
  q?: string;
  ids?: number[];
  sellerIds?: number[];
  excludeStatus?: string;
}

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

  async getPropertiesPaginated(
    this: DatabaseStorage,
    orgId: number,
    options: PaginationOptions,
    filters?: PropertyListFilters,
  ): Promise<PaginatedResult<Property>> {
    const q = filters?.q?.trim();
    const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
    const whereClause = and(
      eq(properties.organizationId, orgId),
      sql`${properties.status} != 'deleted'`,
      like
        ? or(
            ilike(properties.apn, like),
            ilike(properties.county, like),
            ilike(properties.state, like),
            ilike(properties.address, like),
            ilike(properties.city, like),
            ilike(properties.zip, like),
          )
        : undefined,
      filters?.ids ? (filters.ids.length > 0 ? inArray(properties.id, filters.ids) : sql`false`) : undefined,
      filters?.sellerIds
        ? filters.sellerIds.length > 0
          ? inArray(properties.sellerId, filters.sellerIds)
          : sql`false`
        : undefined,
      filters?.excludeStatus ? ne(properties.status, filters.excludeStatus) : undefined,
    );
    const [{ count: total }] = await db.select({ count: count() }).from(properties).where(and(eq(properties.organizationId, orgId), whereClause));
    const totalNum = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalNum / options.pageSize));
    const offset = (options.page - 1) * options.pageSize;

    const sortColumn = (properties as any)[options.sortBy] ?? properties.createdAt;
    const orderFn = options.sortOrder === "asc" ? asc : desc;

    const data = await db.select().from(properties)
      .where(and(eq(properties.organizationId, orgId), whereClause))
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
    assertWritableLandStatus(property);
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
    assertWritableLandStatus(updates);
    const conditions = [eq(properties.id, id)];
    if (organizationId) conditions.push(eq(properties.organizationId, organizationId));
    const [updated] = await db.update(properties)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(...conditions))
      .returning();
    // Land that is no longer held comes off the market (DEFECT-0181).
    if (updated && updates.status !== undefined) {
      const { withdrawListingsForUnheldProperty } = await import("../services/listingWithdrawal");
      await withdrawListingsForUnheldProperty(updated.organizationId, updated.id, updated.status);
    }
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
      .set({ status: "deleted", updatedAt: clock.now() })
      .where(and(...conditions));
    if (organizationId !== undefined) {
      const { withdrawListingsForUnheldProperty } = await import("../services/listingWithdrawal");
      await withdrawListingsForUnheldProperty(organizationId, id, "deleted");
    }
    // Soft-delete any deals tied to this property so they also disappear from list views
    const dealConditions: any[] = [eq(deals.propertyId, id)];
    if (organizationId) dealConditions.push(eq(deals.organizationId, organizationId));
    // A deleted closed deal is not a sale: its recorded comp is retracted.
    const closedBefore = await db.select({ id: deals.id, organizationId: deals.organizationId })
      .from(deals)
      .where(and(...dealConditions, eq(deals.status, "closed")));
    await db.update(deals)
      .set({ status: "deleted", updatedAt: clock.now() })
      .where(and(...dealConditions));
    for (const d of closedBefore) {
      recordDealTransitionEvidence(d.organizationId, { status: "closed" }, { id: d.id, status: "deleted" });
    }
  },

  async getPropertyCount(this: DatabaseStorage, orgId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(properties).where(eq(properties.organizationId, orgId));
    return result?.count || 0;
  },

  async bulkDeleteProperties(this: DatabaseStorage, orgId: number, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    // Only this org's own properties (DEFECT-0183). This HARD-deleted
    // diligence rows, listings and deals by the request's ids with no org
    // predicate before the org-scoped property delete — so another tenant's
    // property id deleted that tenant's deals and listings — and it skipped
    // the legal-hold check. It now does exactly what the single delete does
    // (soft delete, legal hold, listings withdrawn), for owned ids only.
    const owned = (
      await db.select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.organizationId, orgId), inArray(properties.id, ids), ne(properties.status, "deleted")))
    ).map((r) => r.id);
    if (owned.length === 0) return 0;
    for (const id of owned) await assertNotUnderLegalHold(orgId, "property", id);
    await db.update(properties)
      .set({ status: "deleted", updatedAt: clock.now() })
      .where(and(eq(properties.organizationId, orgId), inArray(properties.id, owned)));
    const closedBefore = await db.select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), inArray(deals.propertyId, owned), eq(deals.status, "closed")));
    await db.update(deals)
      .set({ status: "deleted", updatedAt: clock.now() })
      .where(and(eq(deals.organizationId, orgId), inArray(deals.propertyId, owned)));
    for (const d of closedBefore) recordDealTransitionEvidence(orgId, { status: "closed" }, { id: d.id, status: "deleted" });
    const { withdrawListingsForUnheldProperty } = await import("../services/listingWithdrawal");
    for (const id of owned) await withdrawListingsForUnheldProperty(orgId, id, "deleted");
    return owned.length;
  },

  async bulkUpdateProperties(this: DatabaseStorage, orgId: number, ids: number[], updates: Partial<InsertProperty>): Promise<number> {
    if (ids.length === 0) return 0;
    assertWritableLandStatus(updates);
    const updated = await db.update(properties)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(eq(properties.organizationId, orgId), inArray(properties.id, ids)))
      .returning({ id: properties.id, status: properties.status });
    // A bulk status change that ends the holding withdraws the listings
    // (DEFECT-0181 audit: this path left sold land live).
    if (updates.status !== undefined) {
      const { withdrawListingsForUnheldProperty } = await import("../services/listingWithdrawal");
      for (const p of updated) await withdrawListingsForUnheldProperty(orgId, p.id, p.status);
    }
    return updated.length;
  },
};

export type PropertyRepo = typeof propertyRepo;
