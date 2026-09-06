// Enrichment + listings data layer: skip traces (PII-bearing — see the R3
// encryption note carried with the methods) and property listings.
// Extracted from the god-class server/storage.ts in the storage refactor.
// Methods are merged into DatabaseStorage.prototype at construction time;
// `this` refers to the full DatabaseStorage instance.

import { and, desc, eq } from "drizzle-orm";
import {
  encryptSkipTracePayload,
  decryptSkipTraceRow,
} from "../services/skipTraceEncryption";
import { db } from "../db";
import {
  skipTraces,
  propertyListings,
  type InsertSkipTrace,
  type InsertPropertyListing,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";
import { assertWritablePatch } from "../utils/patch";

export const enrichmentRepo = {
  // Skip Traces
  // R3: input_data and results carry PII (DOB hints, last-4 SSN, phones,
  // prior addresses, relatives). They are AES-256-GCM encrypted at the
  // application layer via skipTraceEncryption.* helpers. Reads are tolerant
  // of legacy plaintext rows (mirrors decryptStoredTin in bookkeeping.ts).
  async getSkipTraces(this: DatabaseStorage, orgId: number) {
    const rows = await db.select().from(skipTraces)
      .where(eq(skipTraces.organizationId, orgId))
      .orderBy(desc(skipTraces.createdAt));
    return rows.map((r) => decryptSkipTraceRow(r)!);
  },

  async getSkipTrace(this: DatabaseStorage, orgId: number, id: number) {
    const [trace] = await db.select().from(skipTraces)
      .where(and(eq(skipTraces.id, id), eq(skipTraces.organizationId, orgId)));
    // decryptSkipTraceRow widens to `| null`; `trace` is only ever undefined when
    // absent, so normalize null→undefined to match the IStorage contract.
    return decryptSkipTraceRow(trace) ?? undefined;
  },

  async getSkipTraceByLead(this: DatabaseStorage, orgId: number, leadId: number) {
    const [trace] = await db.select().from(skipTraces)
      .where(and(eq(skipTraces.organizationId, orgId), eq(skipTraces.leadId, leadId)))
      .orderBy(desc(skipTraces.createdAt));
    return decryptSkipTraceRow(trace) ?? undefined;
  },

  async createSkipTrace(this: DatabaseStorage, skipTrace: InsertSkipTrace) {
    const payload: InsertSkipTrace = {
      ...skipTrace,
      // Cast through `any` because the column type is the structured PII
      // shape, but on disk we store an encryption envelope. The shape is
      // restored by decryptSkipTraceRow on read.
      inputData: encryptSkipTracePayload(skipTrace.inputData) as any,
      results: encryptSkipTracePayload(skipTrace.results) as any,
    };
    const [created] = await db.insert(skipTraces).values(payload).returning();
    return decryptSkipTraceRow(created)!;
  },

  async updateSkipTrace(this: DatabaseStorage, id: number, updates: Partial<InsertSkipTrace>, organizationId?: number) {
    const conditions = [eq(skipTraces.id, id)];
    if (organizationId) conditions.push(eq(skipTraces.organizationId, organizationId));

    const encrypted: Partial<InsertSkipTrace> = { ...updates };
    if ("inputData" in updates) {
      encrypted.inputData = encryptSkipTracePayload(updates.inputData) as any;
    }
    if ("results" in updates) {
      encrypted.results = encryptSkipTracePayload(updates.results) as any;
    }

    const [updated] = await db.update(skipTraces)
      .set(assertWritablePatch(encrypted, "skip_traces.updateSkipTrace"))
      .where(and(...conditions))
      .returning();
    return decryptSkipTraceRow(updated)!;
  },

  // Property Listings
  async getPropertyListings(this: DatabaseStorage, orgId: number, filters?: { status?: string }) {
    if (filters?.status) {
      return db.select().from(propertyListings)
        .where(and(eq(propertyListings.organizationId, orgId), eq(propertyListings.status, filters.status)))
        .orderBy(desc(propertyListings.createdAt));
    }
    return db.select().from(propertyListings)
      .where(eq(propertyListings.organizationId, orgId))
      .orderBy(desc(propertyListings.createdAt));
  },

  async getPropertyListing(this: DatabaseStorage, orgId: number, id: number) {
    const [listing] = await db.select().from(propertyListings)
      .where(and(eq(propertyListings.id, id), eq(propertyListings.organizationId, orgId)));
    return listing;
  },

  async getPropertyListingByPropertyId(this: DatabaseStorage, orgId: number, propertyId: number) {
    const [listing] = await db.select().from(propertyListings)
      .where(and(eq(propertyListings.propertyId, propertyId), eq(propertyListings.organizationId, orgId)));
    return listing;
  },

  async createPropertyListing(this: DatabaseStorage, listing: InsertPropertyListing) {
    const [created] = await db.insert(propertyListings).values(listing).returning();
    return created;
  },

  async updatePropertyListing(this: DatabaseStorage, id: number, updates: Partial<InsertPropertyListing>, organizationId?: number) {
    const conditions = [eq(propertyListings.id, id)];
    if (organizationId) conditions.push(eq(propertyListings.organizationId, organizationId));
    const [updated] = await db.update(propertyListings)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deletePropertyListing(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(propertyListings.id, id)];
    if (organizationId) conditions.push(eq(propertyListings.organizationId, organizationId));
    await db.delete(propertyListings).where(and(...conditions));
  },
};

export type EnrichmentRepo = typeof enrichmentRepo;
