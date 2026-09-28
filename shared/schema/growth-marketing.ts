/**
 * Growth / ad marketing — AcreOS's OWN customer acquisition (founder-only).
 *
 * Extracted verbatim from the shared/schema.ts monolith on 2026-09-28
 * (DEFECT-0048) and re-exported through that barrel, so every existing
 * `import { founderAdAccounts } from "@shared/schema"` is unchanged. These
 * tables reference only each other. founder_ad_accounts secrets are sealed at
 * rest by server/services/founderAdAccountSecrets.ts (DEFECT-0054).
 */
import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";


// Stores founder-level Meta ad account credentials for AcreOS growth campaigns
export const founderAdAccounts = pgTable("founder_ad_accounts", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull().default("meta"), // 'meta' | 'google'
  adAccountId: text("ad_account_id").notNull(),
  accessToken: text("access_token").notNull(),
  pixelId: text("pixel_id"),           // Meta pixel for conversion reporting
  appId: text("app_id"),               // Meta app ID
  appSecret: text("app_secret"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFounderAdAccountSchema = createInsertSchema(founderAdAccounts).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type FounderAdAccount = typeof founderAdAccounts.$inferSelect;
export type InsertFounderAdAccount = z.infer<typeof insertFounderAdAccountSchema>;

// Growth campaigns launched by founder for AcreOS marketing
export const growthCampaigns = pgTable("growth_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull().default("meta"),
  templateKey: text("template_key").notNull(), // 'land_investors_signup' | 'retargeting' etc.
  externalCampaignId: text("external_campaign_id"), // Meta campaign ID once created
  status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'paused' | 'completed'
  dailyBudgetCents: integer("daily_budget_cents").notNull().default(2000), // $20/day default
  targetCountries: jsonb("target_countries").$type<string[]>().notNull().default(["US"]),
  totalSpendCents: integer("total_spend_cents").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  signups: integer("signups").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGrowthCampaignSchema = createInsertSchema(growthCampaigns).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type GrowthCampaign = typeof growthCampaigns.$inferSelect;
export type InsertGrowthCampaign = z.infer<typeof insertGrowthCampaignSchema>;

// UTM attribution on organization signup
// (columns added to organizations table via migration; tracked here as a view-friendly type)
export type SignupAttribution = {
  organizationId: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  createdAt: Date;
};

// AI-generated ad creative bundles — copy variants + images, produced before campaign deployment
export const adCreativeBundles = pgTable("ad_creative_bundles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateKey: text("template_key").notNull(),
  campaignId: integer("campaign_id").references(() => growthCampaigns.id, { onDelete: "set null" }),
  status: text("status").notNull().default("generating"), // 'generating' | 'ready' | 'error' | 'deployed'
  copies: jsonb("copies").$type<any[]>(),   // AdCopyVariant[]
  images: jsonb("images").$type<any[]>(),   // GeneratedAdImage[]
  error: text("error"),
  generatedAt: timestamp("generated_at").defaultNow(),
  model: text("model").default("gpt-4o"),
});
export type AdCreativeBundle = typeof adCreativeBundles.$inferSelect;
