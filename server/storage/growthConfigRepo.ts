// Growth + platform-config data layer: playbook instances, platform
// feature flags, pricing config (data access only — pricing VALUES remain a
// founder hard-stop enforced at the routes), the founder ad account +
// growth campaigns + ad creative bundles + signup attribution, borrower
// messages, and field-scout visits/photos (incl. the photo-hash dedup
// lookup). Extracted from the god-class server/storage.ts in the storage
// refactor. Methods are merged into DatabaseStorage.prototype at
// construction time; `this` refers to the full DatabaseStorage instance.

import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  playbookInstances,
  platformFeatureFlags,
  pricingConfig,
  founderAdAccounts,
  growthCampaigns,
  adCreativeBundles,
  organizations,
  borrowerMessages,
  fieldScoutVisits,
  fieldScoutPhotos,
  type PlaybookInstance,
  type PlatformFeatureFlag,
  type PricingConfig,
  type FounderAdAccount,
  type GrowthCampaign,
  type AdCreativeBundle,
  type BorrowerMessage,
  type FieldScoutVisit,
  type FieldScoutPhoto,
  type InsertPlaybookInstance,
  type InsertPricingConfig,
  type InsertFounderAdAccount,
  type InsertGrowthCampaign,
  type InsertBorrowerMessage,
  type InsertFieldScoutVisit,
  type InsertFieldScoutPhoto,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const growthConfigRepo = {
  // Playbook Instances
  async getPlaybookInstances(this: DatabaseStorage, organizationId: number): Promise<PlaybookInstance[]> {
    return await db.select().from(playbookInstances)
      .where(eq(playbookInstances.organizationId, organizationId))
      .orderBy(desc(playbookInstances.createdAt));
  },

  async getPlaybookInstanceById(this: DatabaseStorage, organizationId: number, id: number): Promise<PlaybookInstance | undefined> {
    const [instance] = await db.select().from(playbookInstances)
      .where(and(eq(playbookInstances.id, id), eq(playbookInstances.organizationId, organizationId)));
    return instance;
  },

  async getPlaybookInstanceByTemplate(this: DatabaseStorage, organizationId: number, templateId: string): Promise<PlaybookInstance | undefined> {
    const [instance] = await db.select().from(playbookInstances)
      .where(and(
        eq(playbookInstances.organizationId, organizationId),
        eq(playbookInstances.templateId, templateId),
        eq(playbookInstances.status, "in_progress")
      ))
      .orderBy(desc(playbookInstances.createdAt))
      .limit(1);
    return instance;
  },

  async getActivePlaybookInstances(this: DatabaseStorage, organizationId: number): Promise<PlaybookInstance[]> {
    return await db.select().from(playbookInstances)
      .where(and(
        eq(playbookInstances.organizationId, organizationId),
        eq(playbookInstances.status, "in_progress")
      ))
      .orderBy(desc(playbookInstances.createdAt));
  },

  async createPlaybookInstance(this: DatabaseStorage, data: InsertPlaybookInstance): Promise<PlaybookInstance> {
    const [created] = await db.insert(playbookInstances).values(data).returning();
    return created;
  },

  async updatePlaybookInstance(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertPlaybookInstance>): Promise<PlaybookInstance | undefined> {
    const [updated] = await db.update(playbookInstances)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(playbookInstances.id, id), eq(playbookInstances.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deletePlaybookInstance(this: DatabaseStorage, organizationId: number, id: number): Promise<boolean> {
    await db.delete(playbookInstances)
      .where(and(eq(playbookInstances.id, id), eq(playbookInstances.organizationId, organizationId)));
    return true;
  },

  // ─── Platform Feature Flags ───────────────────────────────────────────────
  async getAllFeatureFlags(this: DatabaseStorage): Promise<PlatformFeatureFlag[]> {
    return await db.select().from(platformFeatureFlags).orderBy(platformFeatureFlags.label);
  },

  /**
   * Reads the CANONICAL column. This filtered on `enabled` alone, which is the
   * back-compat mirror — a flag set to a targeted state (`beta`, `tier:pro`)
   * through featureFlagService has `enabled: false` and is genuinely on for
   * somebody, and this read called it off.
   *
   * `state <> 'off'` rather than `state = 'on'` deliberately: this method
   * answers "which flags are not fully off", and a targeted flag belongs in that
   * answer. Its only caller is the founder growth console.
   */
  async getEnabledFeatureFlags(this: DatabaseStorage): Promise<PlatformFeatureFlag[]> {
    return await db.select().from(platformFeatureFlags)
      .where(ne(platformFeatureFlags.state, "off"));
  },

  /**
   * WRITES BOTH COLUMNS. `enabled` is back-compat; `state` is canonical —
   * `featureFlags.rowToFlag` reads `state` and falls back to `enabled` only when
   * `state` is NULL, which no row written since the migration is. Setting
   * `enabled` alone therefore changed nothing any consumer reads, while
   * returning a row that said otherwise.
   *
   * The direction that mattered: `enabled: false` on a flag whose `state` is
   * "on" left the feature ON for every customer while the console reported it
   * off. `feature_marketplace` and `feature_capital_markets` sit behind
   * `requireLadderFlag`, so that is a founder believing they closed an expansion
   * gate that is still open.
   */
  async updateFeatureFlag(this: DatabaseStorage, key: string, enabled: boolean): Promise<PlatformFeatureFlag | undefined> {
    const [updated] = await db.update(platformFeatureFlags)
      .set({ enabled, state: enabled ? "on" : "off", updatedAt: new Date() })
      .where(eq(platformFeatureFlags.key, key))
      .returning();
    return updated;
  },

  // ─── Pricing Config ───────────────────────────────────────────────────────
  async getAllPricingConfig(this: DatabaseStorage): Promise<PricingConfig[]> {
    return await db.select().from(pricingConfig).orderBy(pricingConfig.tier);
  },

  async getPricingConfigForTier(this: DatabaseStorage, tier: string): Promise<PricingConfig | undefined> {
    const [row] = await db.select().from(pricingConfig)
      .where(eq(pricingConfig.tier, tier));
    return row;
  },

  async updatePricingConfig(this: DatabaseStorage, tier: string, data: Partial<InsertPricingConfig>): Promise<PricingConfig | undefined> {
    const [updated] = await db.update(pricingConfig)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(pricingConfig.tier, tier))
      .returning();
    return updated;
  },

  async clearPricingPromo(this: DatabaseStorage, tier: string): Promise<void> {
    await db.update(pricingConfig)
      .set({ promoLabel: null, promoDiscountPercent: null, promoEndsAt: null, stripeCouponId: null, updatedAt: new Date() })
      .where(eq(pricingConfig.tier, tier));
  },

  // ─── Founder Ad Accounts ──────────────────────────────────────────────────
  async getFounderAdAccount(this: DatabaseStorage, platform: string = "meta"): Promise<FounderAdAccount | undefined> {
    const [row] = await db.select().from(founderAdAccounts)
      .where(and(eq(founderAdAccounts.platform, platform), eq(founderAdAccounts.isActive, true)));
    return row;
  },

  async upsertFounderAdAccount(this: DatabaseStorage, data: InsertFounderAdAccount): Promise<FounderAdAccount> {
    const existing = await this.getFounderAdAccount(data.platform);
    if (existing) {
      const [updated] = await db.update(founderAdAccounts)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(founderAdAccounts.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(founderAdAccounts).values(data).returning();
    return created;
  },

  // ─── Growth Campaigns ─────────────────────────────────────────────────────
  async getGrowthCampaigns(this: DatabaseStorage): Promise<GrowthCampaign[]> {
    return await db.select().from(growthCampaigns).orderBy(desc(growthCampaigns.createdAt));
  },

  async getGrowthCampaign(this: DatabaseStorage, id: number): Promise<GrowthCampaign | undefined> {
    const [row] = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, id));
    return row;
  },

  async createGrowthCampaign(this: DatabaseStorage, data: InsertGrowthCampaign): Promise<GrowthCampaign> {
    const [created] = await db.insert(growthCampaigns).values(data).returning();
    return created;
  },

  async updateGrowthCampaign(this: DatabaseStorage, id: number, data: Partial<InsertGrowthCampaign>): Promise<GrowthCampaign | undefined> {
    const [updated] = await db.update(growthCampaigns)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(growthCampaigns.id, id))
      .returning();
    return updated;
  },

  // ─── Ad Creative Bundles ───────────────────────────────────────────────────

  async createAdCreativeBundle(this: DatabaseStorage, data: {
    templateKey: string;
    campaignId?: number;
    status?: string;
    copies?: any[];
    images?: any[];
    error?: string;
    model?: string;
  }): Promise<AdCreativeBundle> {
    const [created] = await db.insert(adCreativeBundles).values({
      templateKey: data.templateKey,
      campaignId: data.campaignId ?? null,
      status: data.status ?? "generating",
      copies: data.copies ?? null,
      images: data.images ?? null,
      error: data.error ?? null,
      model: data.model ?? "gpt-4o",
    }).returning();
    return created;
  },

  async getAdCreativeBundle(this: DatabaseStorage, id: string): Promise<AdCreativeBundle | undefined> {
    const [row] = await db.select().from(adCreativeBundles).where(eq(adCreativeBundles.id, id));
    return row;
  },

  async updateAdCreativeBundle(this: DatabaseStorage, id: string, data: Partial<{
    status: string;
    copies: any[];
    images: any[];
    campaignId: number;
    error: string;
  }>): Promise<AdCreativeBundle | undefined> {
    const [updated] = await db.update(adCreativeBundles)
      .set(data)
      .where(eq(adCreativeBundles.id, id))
      .returning();
    return updated;
  },

  // ─── Recent Signups with UTM Attribution ──────────────────────────────────
  async getRecentSignupsWithAttribution(this: DatabaseStorage, limit: number = 50) {
    return await db.select({
      organizationId: organizations.id,
      name: organizations.name,
      subscriptionTier: organizations.subscriptionTier,
      utmSource: organizations.utmSource,
      utmMedium: organizations.utmMedium,
      utmCampaign: organizations.utmCampaign,
      utmContent: organizations.utmContent,
      createdAt: organizations.createdAt,
    })
      .from(organizations)
      .orderBy(desc(organizations.createdAt))
      .limit(limit);
  },

  // ─── Borrower Messages ────────────────────────────────────────────────────
  async createBorrowerMessage(this: DatabaseStorage, data: InsertBorrowerMessage): Promise<BorrowerMessage> {
    const [msg] = await db.insert(borrowerMessages).values(data).returning();
    return msg;
  },

  async getBorrowerMessages(this: DatabaseStorage, noteId: number): Promise<BorrowerMessage[]> {
    return await db.select().from(borrowerMessages)
      .where(eq(borrowerMessages.noteId, noteId))
      .orderBy(borrowerMessages.createdAt);
  },

  async markBorrowerMessagesRead(this: DatabaseStorage, noteId: number, senderType: string): Promise<void> {
    await db.update(borrowerMessages)
      .set({ readAt: new Date() })
      .where(and(
        eq(borrowerMessages.noteId, noteId),
        eq(borrowerMessages.senderType, senderType),
        sql`${borrowerMessages.readAt} IS NULL`
      ));
  },

  async countUnreadBorrowerMessages(this: DatabaseStorage, noteId: number, senderType: string): Promise<number> {
    const [result] = await db
      .select({ cnt: count() })
      .from(borrowerMessages)
      .where(and(
        eq(borrowerMessages.noteId, noteId),
        eq(borrowerMessages.senderType, senderType),
        sql`${borrowerMessages.readAt} IS NULL`
      ));
    return Number(result?.cnt ?? 0);
  },

  // ─── Field Scout Visits ─────────────────────────────────────────────────────

  async createFieldScoutVisit(this: DatabaseStorage, data: InsertFieldScoutVisit): Promise<FieldScoutVisit> {
    const [created] = await db.insert(fieldScoutVisits).values(data).returning();
    return created;
  },

  async getFieldScoutVisit(this: DatabaseStorage, id: number): Promise<FieldScoutVisit | undefined> {
    const [row] = await db.select().from(fieldScoutVisits).where(eq(fieldScoutVisits.id, id));
    return row;
  },

  async getFieldScoutVisits(this: DatabaseStorage, visitorId: string, limit: number = 50, offset: number = 0): Promise<FieldScoutVisit[]> {
    return await db.select().from(fieldScoutVisits)
      .where(eq(fieldScoutVisits.visitorId, visitorId))
      .orderBy(desc(fieldScoutVisits.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async countFieldScoutVisits(this: DatabaseStorage, visitorId: string): Promise<number> {
    const [result] = await db
      .select({ cnt: count() })
      .from(fieldScoutVisits)
      .where(eq(fieldScoutVisits.visitorId, visitorId));
    return Number(result?.cnt ?? 0);
  },

  // ─── Field Scout Photos ─────────────────────────────────────────────────────

  async createFieldScoutPhoto(this: DatabaseStorage, data: InsertFieldScoutPhoto): Promise<FieldScoutPhoto> {
    const [created] = await db.insert(fieldScoutPhotos).values(data).returning();
    return created;
  },

  async getFieldScoutPhotosByVisit(this: DatabaseStorage, visitId: number): Promise<FieldScoutPhoto[]> {
    return await db.select().from(fieldScoutPhotos)
      .where(eq(fieldScoutPhotos.visitId, visitId))
      .orderBy(desc(fieldScoutPhotos.createdAt));
  },

  async getFieldScoutPhotosByLead(this: DatabaseStorage, leadId: number): Promise<FieldScoutPhoto[]> {
    return await db.select().from(fieldScoutPhotos)
      .where(eq(fieldScoutPhotos.leadId, leadId))
      .orderBy(desc(fieldScoutPhotos.createdAt));
  },

  // Phase 8 Mo 12 — Yara §1 dedup. Backed by the partial index
  // `fsp_org_hash_idx (organization_id, image_hash) WHERE image_hash IS NOT NULL`
  // (migration 0067) so this is O(log n) on every upload.
  async findFieldScoutPhotoByHash(this: DatabaseStorage, 
    organizationId: number,
    imageHash: string,
  ): Promise<FieldScoutPhoto | undefined> {
    const [existing] = await db
      .select()
      .from(fieldScoutPhotos)
      .where(
        and(
          eq(fieldScoutPhotos.organizationId, organizationId),
          eq(fieldScoutPhotos.imageHash, imageHash),
        ),
      )
      .limit(1);
    return existing;
  },
};

export type GrowthConfigRepo = typeof growthConfigRepo;
