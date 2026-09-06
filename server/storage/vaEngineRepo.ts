// VA-replacement-engine data layer: marketing lists, offer batches +
// offers, seller communications, ad postings, buyer prequalifications,
// collection sequences + enrollments, and county research. Extracted from
// the god-class server/storage.ts in the storage refactor. Methods are
// merged into DatabaseStorage.prototype at construction time; `this` refers
// to the full DatabaseStorage instance.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  marketingLists,
  offerBatches,
  offers,
  sellerCommunications,
  adPostings,
  buyerPrequalifications,
  collectionSequences,
  collectionEnrollments,
  countyResearch,
  type MarketingList,
  type OfferBatch,
  type Offer,
  type SellerCommunication,
  type AdPosting,
  type BuyerPrequalification,
  type CollectionSequence,
  type CollectionEnrollment,
  type CountyResearch,
  type InsertMarketingList,
  type InsertOfferBatch,
  type InsertOffer,
  type InsertSellerCommunication,
  type InsertAdPosting,
  type InsertBuyerPrequalification,
  type InsertCollectionSequence,
  type InsertCollectionEnrollment,
  type InsertCountyResearch,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";
import { assertWritablePatch } from "../utils/patch";

export const vaEngineRepo = {
  // VA REPLACEMENT ENGINE TABLES
  // ============================================

  // Marketing Lists
  async getMarketingLists(this: DatabaseStorage, orgId: number): Promise<MarketingList[]> {
    return await db.select().from(marketingLists)
      .where(eq(marketingLists.organizationId, orgId))
      .orderBy(desc(marketingLists.createdAt));
  },

  async getMarketingListById(this: DatabaseStorage, orgId: number, id: number): Promise<MarketingList | undefined> {
    const [list] = await db.select().from(marketingLists).where(and(eq(marketingLists.id, id), eq(marketingLists.organizationId, orgId)));
    return list;
  },

  async createMarketingList(this: DatabaseStorage, data: InsertMarketingList): Promise<MarketingList> {
    const [created] = await db.insert(marketingLists).values(data).returning();
    return created;
  },

  async updateMarketingList(this: DatabaseStorage, orgId: number, id: number, updates: Partial<InsertMarketingList>): Promise<MarketingList> {
    const [updated] = await db.update(marketingLists)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(marketingLists.id, id), eq(marketingLists.organizationId, orgId)))
      .returning();
    return updated;
  },

  async deleteMarketingList(this: DatabaseStorage, orgId: number, id: number): Promise<void> {
    await db.delete(marketingLists).where(and(eq(marketingLists.id, id), eq(marketingLists.organizationId, orgId)));
  },

  // Offer Batches
  async getOfferBatches(this: DatabaseStorage, orgId: number): Promise<OfferBatch[]> {
    return await db.select().from(offerBatches)
      .where(eq(offerBatches.organizationId, orgId))
      .orderBy(desc(offerBatches.createdAt));
  },

  async getOfferBatchById(this: DatabaseStorage, orgId: number, id: number): Promise<OfferBatch | undefined> {
    const [batch] = await db.select().from(offerBatches).where(and(eq(offerBatches.id, id), eq(offerBatches.organizationId, orgId)));
    return batch;
  },

  async createOfferBatch(this: DatabaseStorage, data: InsertOfferBatch): Promise<OfferBatch> {
    const [created] = await db.insert(offerBatches).values(data).returning();
    return created;
  },

  async updateOfferBatch(this: DatabaseStorage, orgId: number, id: number, updates: Partial<InsertOfferBatch>): Promise<OfferBatch> {
    const [updated] = await db.update(offerBatches)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(offerBatches.id, id), eq(offerBatches.organizationId, orgId)))
      .returning();
    return updated;
  },

  async deleteOfferBatch(this: DatabaseStorage, orgId: number, id: number): Promise<void> {
    await db.delete(offerBatches).where(and(eq(offerBatches.id, id), eq(offerBatches.organizationId, orgId)));
  },

  // Offers
  async getOffers(this: DatabaseStorage, orgId: number): Promise<Offer[]> {
    return await db.select().from(offers)
      .where(eq(offers.organizationId, orgId))
      .orderBy(desc(offers.createdAt));
  },

  async getOfferById(this: DatabaseStorage, orgId: number, id: number): Promise<Offer | undefined> {
    const [offer] = await db.select().from(offers).where(and(eq(offers.id, id), eq(offers.organizationId, orgId)));
    return offer;
  },

  async getOffersByBatch(this: DatabaseStorage, orgId: number, batchId: number): Promise<Offer[]> {
    return await db.select().from(offers)
      .where(and(eq(offers.batchId, batchId), eq(offers.organizationId, orgId)))
      .orderBy(desc(offers.createdAt));
  },

  async createOffer(this: DatabaseStorage, data: InsertOffer): Promise<Offer> {
    const [created] = await db.insert(offers).values(data).returning();
    return created;
  },

  async updateOffer(this: DatabaseStorage, orgId: number, id: number, updates: Partial<InsertOffer>): Promise<Offer> {
    const [updated] = await db.update(offers)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(offers.id, id), eq(offers.organizationId, orgId)))
      .returning();
    return updated;
  },

  async deleteOffer(this: DatabaseStorage, orgId: number, id: number): Promise<void> {
    await db.delete(offers).where(and(eq(offers.id, id), eq(offers.organizationId, orgId)));
  },

  // Seller Communications
  async getSellerCommunications(this: DatabaseStorage, orgId: number): Promise<SellerCommunication[]> {
    return await db.select().from(sellerCommunications)
      .where(eq(sellerCommunications.organizationId, orgId))
      .orderBy(desc(sellerCommunications.createdAt));
  },

  async getSellerCommunicationById(this: DatabaseStorage, orgId: number, id: number): Promise<SellerCommunication | undefined> {
    const [comm] = await db.select().from(sellerCommunications).where(and(eq(sellerCommunications.id, id), eq(sellerCommunications.organizationId, orgId)));
    return comm;
  },

  async getSellerCommunicationsByLead(this: DatabaseStorage, leadId: number): Promise<SellerCommunication[]> {
    return await db.select().from(sellerCommunications)
      .where(eq(sellerCommunications.leadId, leadId))
      .orderBy(desc(sellerCommunications.createdAt));
  },

  async createSellerCommunication(this: DatabaseStorage, data: InsertSellerCommunication): Promise<SellerCommunication> {
    const [created] = await db.insert(sellerCommunications).values(data).returning();
    return created;
  },

  async updateSellerCommunication(this: DatabaseStorage, id: number, updates: Partial<InsertSellerCommunication>, organizationId?: number): Promise<SellerCommunication> {
    const conditions = [eq(sellerCommunications.id, id)];
    if (organizationId) conditions.push(eq(sellerCommunications.organizationId, organizationId));
    const [updated] = await db.update(sellerCommunications)
      .set(assertWritablePatch(updates, "seller_communications.updateSellerCommunication"))
      .where(and(...conditions))
      .returning();
    return updated;
  },

  // Ad Postings
  async getAdPostings(this: DatabaseStorage, orgId: number): Promise<AdPosting[]> {
    return await db.select().from(adPostings)
      .where(eq(adPostings.organizationId, orgId))
      .orderBy(desc(adPostings.createdAt));
  },

  async getAdPostingById(this: DatabaseStorage, orgId: number, id: number): Promise<AdPosting | undefined> {
    const [posting] = await db.select().from(adPostings).where(and(eq(adPostings.id, id), eq(adPostings.organizationId, orgId)));
    return posting;
  },

  async getAdPostingsByProperty(this: DatabaseStorage, propertyId: number): Promise<AdPosting[]> {
    return await db.select().from(adPostings)
      .where(eq(adPostings.propertyId, propertyId))
      .orderBy(desc(adPostings.createdAt));
  },

  async createAdPosting(this: DatabaseStorage, data: InsertAdPosting): Promise<AdPosting> {
    const [created] = await db.insert(adPostings).values(data).returning();
    return created;
  },

  async updateAdPosting(this: DatabaseStorage, orgId: number, id: number, updates: Partial<InsertAdPosting>): Promise<AdPosting> {
    const [updated] = await db.update(adPostings)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(adPostings.id, id), eq(adPostings.organizationId, orgId)))
      .returning();
    return updated;
  },

  async deleteAdPosting(this: DatabaseStorage, orgId: number, id: number): Promise<void> {
    await db.delete(adPostings).where(and(eq(adPostings.id, id), eq(adPostings.organizationId, orgId)));
  },

  // Buyer Prequalifications
  async getBuyerPrequalifications(this: DatabaseStorage, orgId: number): Promise<BuyerPrequalification[]> {
    return await db.select().from(buyerPrequalifications)
      .where(eq(buyerPrequalifications.organizationId, orgId))
      .orderBy(desc(buyerPrequalifications.createdAt));
  },

  async getBuyerPrequalificationById(this: DatabaseStorage, orgId: number, id: number): Promise<BuyerPrequalification | undefined> {
    const [prequal] = await db.select().from(buyerPrequalifications).where(and(eq(buyerPrequalifications.id, id), eq(buyerPrequalifications.organizationId, orgId)));
    return prequal;
  },

  async getBuyerPrequalificationByLead(this: DatabaseStorage, leadId: number): Promise<BuyerPrequalification | undefined> {
    const [prequal] = await db.select().from(buyerPrequalifications)
      .where(eq(buyerPrequalifications.leadId, leadId))
      .orderBy(desc(buyerPrequalifications.createdAt))
      .limit(1);
    return prequal;
  },

  async createBuyerPrequalification(this: DatabaseStorage, data: InsertBuyerPrequalification): Promise<BuyerPrequalification> {
    const [created] = await db.insert(buyerPrequalifications).values(data).returning();
    return created;
  },

  async updateBuyerPrequalification(this: DatabaseStorage, orgId: number, id: number, updates: Partial<InsertBuyerPrequalification>): Promise<BuyerPrequalification> {
    const [updated] = await db.update(buyerPrequalifications)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(buyerPrequalifications.id, id), eq(buyerPrequalifications.organizationId, orgId)))
      .returning();
    return updated;
  },

  async deleteBuyerPrequalification(this: DatabaseStorage, orgId: number, id: number): Promise<void> {
    await db.delete(buyerPrequalifications).where(and(eq(buyerPrequalifications.id, id), eq(buyerPrequalifications.organizationId, orgId)));
  },

  // Collection Sequences
  async getCollectionSequences(this: DatabaseStorage, orgId: number): Promise<CollectionSequence[]> {
    return await db.select().from(collectionSequences)
      .where(eq(collectionSequences.organizationId, orgId))
      .orderBy(desc(collectionSequences.createdAt));
  },

  async getCollectionSequenceById(this: DatabaseStorage, orgId: number, id: number): Promise<CollectionSequence | undefined> {
    const [sequence] = await db.select().from(collectionSequences).where(and(eq(collectionSequences.id, id), eq(collectionSequences.organizationId, orgId)));
    return sequence;
  },

  async getActiveCollectionSequence(this: DatabaseStorage, orgId: number): Promise<CollectionSequence | undefined> {
    const [sequence] = await db.select().from(collectionSequences)
      .where(and(
        eq(collectionSequences.organizationId, orgId),
        eq(collectionSequences.isActive, true),
        eq(collectionSequences.isDefault, true)
      ))
      .limit(1);
    if (sequence) return sequence;
    
    const [fallback] = await db.select().from(collectionSequences)
      .where(and(
        eq(collectionSequences.organizationId, orgId),
        eq(collectionSequences.isActive, true)
      ))
      .limit(1);
    return fallback;
  },

  async createCollectionSequence(this: DatabaseStorage, data: InsertCollectionSequence): Promise<CollectionSequence> {
    const [created] = await db.insert(collectionSequences).values(data).returning();
    return created;
  },

  async updateCollectionSequence(this: DatabaseStorage, orgId: number, id: number, updates: Partial<InsertCollectionSequence>): Promise<CollectionSequence> {
    const [updated] = await db.update(collectionSequences)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(collectionSequences.id, id), eq(collectionSequences.organizationId, orgId)))
      .returning();
    return updated;
  },

  async deleteCollectionSequence(this: DatabaseStorage, orgId: number, id: number): Promise<void> {
    await db.delete(collectionSequences).where(and(eq(collectionSequences.id, id), eq(collectionSequences.organizationId, orgId)));
  },

  // Collection Enrollments
  async getCollectionEnrollments(this: DatabaseStorage, orgId: number): Promise<CollectionEnrollment[]> {
    return await db.select().from(collectionEnrollments)
      .where(eq(collectionEnrollments.organizationId, orgId))
      .orderBy(desc(collectionEnrollments.createdAt));
  },

  async getCollectionEnrollmentById(this: DatabaseStorage, orgId: number, id: number): Promise<CollectionEnrollment | undefined> {
    const [enrollment] = await db.select().from(collectionEnrollments).where(and(eq(collectionEnrollments.id, id), eq(collectionEnrollments.organizationId, orgId)));
    return enrollment;
  },

  async getCollectionEnrollmentsByNote(this: DatabaseStorage, noteId: number): Promise<CollectionEnrollment[]> {
    return await db.select().from(collectionEnrollments)
      .where(eq(collectionEnrollments.noteId, noteId))
      .orderBy(desc(collectionEnrollments.createdAt));
  },

  async getCollectionEnrollmentsBySequence(this: DatabaseStorage, sequenceId: number): Promise<CollectionEnrollment[]> {
    return await db.select().from(collectionEnrollments)
      .where(eq(collectionEnrollments.sequenceId, sequenceId))
      .orderBy(desc(collectionEnrollments.createdAt));
  },

  async createCollectionEnrollment(this: DatabaseStorage, data: InsertCollectionEnrollment): Promise<CollectionEnrollment> {
    const [created] = await db.insert(collectionEnrollments).values(data).returning();
    return created;
  },

  async updateCollectionEnrollment(this: DatabaseStorage, orgId: number, id: number, updates: Partial<InsertCollectionEnrollment>): Promise<CollectionEnrollment> {
    const [updated] = await db.update(collectionEnrollments)
      .set(assertWritablePatch(updates, "collection_enrollments.updateCollectionEnrollment"))
      .where(and(eq(collectionEnrollments.id, id), eq(collectionEnrollments.organizationId, orgId)))
      .returning();
    return updated;
  },

  // County Research
  async getCountyResearchList(this: DatabaseStorage): Promise<CountyResearch[]> {
    return await db.select().from(countyResearch)
      .orderBy(countyResearch.state, countyResearch.county);
  },

  async getCountyResearchById(this: DatabaseStorage, id: number): Promise<CountyResearch | undefined> {
    const [research] = await db.select().from(countyResearch).where(eq(countyResearch.id, id));
    return research;
  },

  async getCountyResearch(this: DatabaseStorage, state: string, county: string): Promise<CountyResearch | undefined> {
    const [research] = await db.select().from(countyResearch)
      .where(and(
        sql`UPPER(${countyResearch.state}) = UPPER(${state})`,
        sql`LOWER(${countyResearch.county}) = LOWER(${county})`
      ))
      .limit(1);
    return research;
  },

  async createCountyResearch(this: DatabaseStorage, data: InsertCountyResearch): Promise<CountyResearch> {
    const [created] = await db.insert(countyResearch).values(data).returning();
    return created;
  },

  async updateCountyResearch(this: DatabaseStorage, id: number, updates: Partial<InsertCountyResearch>): Promise<CountyResearch> {
    const [updated] = await db.update(countyResearch)
      .set({ ...updates, lastUpdatedAt: new Date() })
      .where(eq(countyResearch.id, id))
      .returning();
    return updated;
  },

};

export type VaEngineRepo = typeof vaEngineRepo;
