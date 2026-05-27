// Campaigns + campaign optimizations.
// Extracted from the god-class server/storage.ts.

import { and, desc, eq, sql, or, lte } from "drizzle-orm";
import { db } from "../db";
import {
  campaigns, campaignOptimizations,
  type Campaign, type InsertCampaign,
  type CampaignOptimization, type InsertCampaignOptimization,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const campaignRepo = {
  // Campaigns
  async getCampaigns(this: DatabaseStorage, orgId: number): Promise<Campaign[]> {
    return await db.select().from(campaigns)
      .where(eq(campaigns.organizationId, orgId))
      .orderBy(desc(campaigns.createdAt));
  },

  async getCampaign(this: DatabaseStorage, orgId: number, id: number): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id)));
    return campaign;
  },

  async createCampaign(this: DatabaseStorage, campaign: InsertCampaign): Promise<Campaign> {
    const [newCampaign] = await db.insert(campaigns).values(campaign).returning();
    return newCampaign;
  },

  async updateCampaign(this: DatabaseStorage, id: number, updates: Partial<InsertCampaign>, organizationId?: number): Promise<Campaign> {
    const conditions = [eq(campaigns.id, id)];
    if (organizationId) conditions.push(eq(campaigns.organizationId, organizationId));
    const [updated] = await db.update(campaigns)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  // Campaign Optimizations
  async getCampaignOptimizations(this: DatabaseStorage, campaignId: number): Promise<CampaignOptimization[]> {
    return await db.select().from(campaignOptimizations)
      .where(eq(campaignOptimizations.campaignId, campaignId))
      .orderBy(desc(campaignOptimizations.createdAt));
  },

  async createCampaignOptimization(this: DatabaseStorage, optimization: InsertCampaignOptimization): Promise<CampaignOptimization> {
    const [newOptimization] = await db.insert(campaignOptimizations).values(optimization).returning();
    return newOptimization;
  },

  async markOptimizationImplemented(this: DatabaseStorage, optimizationId: number, resultDelta: CampaignOptimization["resultDelta"]): Promise<CampaignOptimization> {
    const [updated] = await db.update(campaignOptimizations)
      .set({
        implemented: true,
        implementedAt: new Date(),
        resultDelta,
      })
      .where(eq(campaignOptimizations.id, optimizationId))
      .returning();
    return updated;
  },

  async getCampaignsNeedingOptimization(this: DatabaseStorage, orgId: number): Promise<Campaign[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return await db.select().from(campaigns)
      .where(and(
        eq(campaigns.organizationId, orgId),
        eq(campaigns.status, "active"),
        sql`COALESCE(${campaigns.totalSent}, 0) > 100`,
        or(
          sql`${campaigns.lastOptimizedAt} IS NULL`,
          lte(campaigns.lastOptimizedAt, sevenDaysAgo)
        )
      ))
      .orderBy(desc(campaigns.totalSent));
  },
};

export type CampaignRepo = typeof campaignRepo;
