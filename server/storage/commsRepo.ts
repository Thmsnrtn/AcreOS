// Communication-engagement records: campaign responses (+ tracking-code
// lookup/generation) and the activity-event timeline.
// Extracted from the god-class server/storage.ts in the storage refactor.
// Methods are merged into DatabaseStorage.prototype at construction time;
// `this` therefore refers to the full DatabaseStorage instance.

import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { forOrg } from "../utils/orgScopedDb";
import {
  campaignResponses,
  campaigns,
  activityEvents,
  type CampaignResponse,
  type InsertCampaignResponse,
  type Campaign,
  type ActivityEvent,
  type InsertActivityEvent,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const commsRepo = {
  // Campaign Responses CRUD
  async getCampaignResponses(this: DatabaseStorage, orgId: number, campaignId?: number): Promise<CampaignResponse[]> {
    const conditions = [eq(campaignResponses.organizationId, orgId)];
    if (campaignId) {
      conditions.push(eq(campaignResponses.campaignId, campaignId));
    }
    return await db.select().from(campaignResponses)
      .where(and(...conditions))
      .orderBy(desc(campaignResponses.responseDate));
  },

  // Tier 1F: org-scoped by construction.
  async getCampaignResponse(this: DatabaseStorage, organizationId: number, id: number): Promise<CampaignResponse | undefined> {
    return await forOrg(organizationId).findById(campaignResponses, id);
  },

  async createCampaignResponse(this: DatabaseStorage, data: InsertCampaignResponse): Promise<CampaignResponse> {
    const [response] = await db.insert(campaignResponses).values(data).returning();
    return response;
  },

  async updateCampaignResponse(this: DatabaseStorage, id: number, data: Partial<InsertCampaignResponse>, organizationId?: number): Promise<CampaignResponse> {
    const conditions = [eq(campaignResponses.id, id)];
    if (organizationId) conditions.push(eq(campaignResponses.organizationId, organizationId));
    const [response] = await db.update(campaignResponses)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return response;
  },

  async deleteCampaignResponse(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(campaignResponses.id, id)];
    if (organizationId) conditions.push(eq(campaignResponses.organizationId, organizationId));
    await db.delete(campaignResponses).where(and(...conditions));
  },

  async getCampaignByTrackingCode(this: DatabaseStorage, trackingCode: string): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns)
      .where(eq(campaigns.trackingCode, trackingCode));
    return campaign;
  },

  async getCampaignResponsesCount(this: DatabaseStorage, campaignId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(campaignResponses)
      .where(eq(campaignResponses.campaignId, campaignId));
    return result?.count || 0;
  },

  async getResponsesCountByOrg(this: DatabaseStorage, orgId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(campaignResponses)
      .where(eq(campaignResponses.organizationId, orgId));
    return result?.count || 0;
  },

  generateTrackingCode(this: DatabaseStorage): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'CAMP-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  },

  // Activity Events CRUD (Communication Timeline)
  async getActivityEvents(
    this: DatabaseStorage,
    orgId: number,
    entityType: string,
    entityId: number,
    eventTypes?: string[]
  ): Promise<ActivityEvent[]> {
    const conditions = [
      eq(activityEvents.organizationId, orgId),
      eq(activityEvents.entityType, entityType),
      eq(activityEvents.entityId, entityId),
    ];

    const query = db.select().from(activityEvents)
      .where(and(...conditions))
      .orderBy(desc(activityEvents.eventDate));

    const results = await query;

    if (eventTypes && eventTypes.length > 0) {
      return results.filter(e => eventTypes.includes(e.eventType));
    }

    return results;
  },

  async createActivityEvent(this: DatabaseStorage, data: InsertActivityEvent): Promise<ActivityEvent> {
    const [event] = await db.insert(activityEvents).values(data).returning();
    return event;
  },

  async getActivityEventsByEntity(
    this: DatabaseStorage,
    orgId: number,
    entityType: string,
    entityId: number,
    limit?: number
  ): Promise<ActivityEvent[]> {
    const query = db.select().from(activityEvents)
      .where(and(
        eq(activityEvents.organizationId, orgId),
        eq(activityEvents.entityType, entityType),
        eq(activityEvents.entityId, entityId)
      ))
      .orderBy(desc(activityEvents.eventDate));

    if (limit) {
      return await query.limit(limit);
    }

    return await query;
  },

  async getRecentActivityEvents(this: DatabaseStorage, orgId: number, limit: number = 50): Promise<ActivityEvent[]> {
    return await db.select().from(activityEvents)
      .where(eq(activityEvents.organizationId, orgId))
      .orderBy(desc(activityEvents.eventDate))
      .limit(limit);
  },
};

export type CommsRepo = typeof commsRepo;
