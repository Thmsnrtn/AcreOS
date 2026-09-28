/**
 * crm-workspace — extracted from the shared/schema.ts monolith on 2026-09-28
 * (DEFECT-0048) and re-exported through that barrel, so every
 * `import { … } from "@shared/schema"` is unchanged. Sections, verbatim:
 *   - A/B TESTING FRAMEWORK
 *   - CUSTOM FIELDS SYSTEM (10.1)
 *   - SAVED VIEWS / FILTERS (10.2)
 *   - UI STATE (Tahoe E6 — server-backed useUiState)
 *   - TEAM MESSAGING SYSTEM
 *   - WORKSPACE PRESETS - Power User Features
 *
 * Monolith tables are imported from "../schema" and used only lazily
 * (inside references(() => …)); the barrel's `export *` is hoisted, so this
 * module evaluates before the monolith's body and must never read one eagerly.
 */
import { pgTable, text, serial, integer, boolean, timestamp, numeric, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { campaigns, organizations } from "../schema";

// ============================================
// A/B TESTING FRAMEWORK
// ============================================

// A/B Tests table - split testing for campaigns
export const abTests = pgTable("ab_tests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  campaignId: integer("campaign_id").references(() => campaigns.id).notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft, running, completed
  testType: text("test_type").notNull(), // subject, content, offer
  
  // Test configuration
  sampleSizePercent: integer("sample_size_percent").default(20), // Percent of total audience for testing
  winningMetric: text("winning_metric").notNull().default("response_rate"), // open_rate, click_rate, response_rate
  minSampleSize: integer("min_sample_size").default(100), // Minimum sample per variant
  
  // Timing
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  autoCompleteOnSignificance: boolean("auto_complete_on_significance").default(true),
  
  // Winner
  winnerId: integer("winner_id"), // ID of winning variant
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// A/B Test Variants table - individual test variations
export const abTestVariants = pgTable("ab_test_variants", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").references(() => abTests.id).notNull(),
  name: text("name").notNull(), // e.g., "Variant A", "Variant B"
  isControl: boolean("is_control").default(false), // Is this the control group?
  
  // Content variations
  subject: text("subject"),
  content: text("content"),
  offerAmount: numeric("offer_amount"),
  
  // Sample allocation
  sampleSize: integer("sample_size").default(0), // Number of recipients allocated
  
  // Performance metrics
  sent: integer("sent").default(0),
  delivered: integer("delivered").default(0),
  opened: integer("opened").default(0),
  clicked: integer("clicked").default(0),
  responded: integer("responded").default(0),
  converted: integer("converted").default(0),
  
  // Calculated metrics
  deliveryRate: numeric("delivery_rate"),
  openRate: numeric("open_rate"),
  clickRate: numeric("click_rate"),
  responseRate: numeric("response_rate"),
  conversionRate: numeric("conversion_rate"),
  confidenceLevel: numeric("confidence_level"), // Statistical significance level
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schemas
export const insertAbTestSchema = createInsertSchema(abTests).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAbTestVariantSchema = createInsertSchema(abTestVariants).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type AbTest = typeof abTests.$inferSelect;
export type InsertAbTest = z.infer<typeof insertAbTestSchema>;
export type AbTestVariant = typeof abTestVariants.$inferSelect;
export type InsertAbTestVariant = z.infer<typeof insertAbTestVariantSchema>;

// Type aliases for A/B testing
export type AbTestStatus = "draft" | "running" | "completed";
export type AbTestType = "subject" | "content" | "offer";
export type AbTestWinningMetric = "open_rate" | "click_rate" | "response_rate";

// Statistical significance thresholds
export const CONFIDENCE_THRESHOLDS = {
  low: 0.90,    // 90% confidence
  medium: 0.95, // 95% confidence
  high: 0.99,   // 99% confidence
} as const;

// Z-scores for confidence levels
export const Z_SCORES = {
  0.90: 1.645,
  0.95: 1.96,
  0.99: 2.576,
} as const;

// ============================================
// CUSTOM FIELDS SYSTEM (10.1)
// ============================================

// Field types for custom fields
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "checkbox"] as const;
export type CustomFieldType = typeof CUSTOM_FIELD_TYPES[number];

// Entity types that support custom fields
export const CUSTOM_FIELD_ENTITY_TYPES = ["lead", "property", "deal"] as const;
export type CustomFieldEntityType = typeof CUSTOM_FIELD_ENTITY_TYPES[number];

// Custom Field Definitions - defines the schema of custom fields
export const customFieldDefinitions = pgTable("custom_field_definitions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  entityType: text("entity_type").notNull(), // lead, property, deal
  fieldName: text("field_name").notNull(), // internal name (snake_case)
  fieldLabel: text("field_label").notNull(), // display label
  fieldType: text("field_type").notNull(), // text, number, date, select, checkbox
  options: jsonb("options").$type<string[]>(), // for select type - array of option values
  isRequired: boolean("is_required").default(false),
  displayOrder: integer("display_order").default(0),
  placeholder: text("placeholder"), // placeholder text for input
  helpText: text("help_text"), // helper text displayed under the field
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Custom Field Values - stores actual values for entities
export const customFieldValues = pgTable("custom_field_values", {
  id: serial("id").primaryKey(),
  definitionId: integer("definition_id").references(() => customFieldDefinitions.id).notNull(),
  entityId: integer("entity_id").notNull(), // ID of the lead/property/deal
  value: text("value"), // stored as text, parsed based on field type
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schemas
export const insertCustomFieldDefinitionSchema = createInsertSchema(customFieldDefinitions).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export const insertCustomFieldValueSchema = createInsertSchema(customFieldValues).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

// Types
export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type InsertCustomFieldDefinition = z.infer<typeof insertCustomFieldDefinitionSchema>;
export type CustomFieldValue = typeof customFieldValues.$inferSelect;
export type InsertCustomFieldValue = z.infer<typeof insertCustomFieldValueSchema>;

// ============================================
// SAVED VIEWS / FILTERS (10.2)
// ============================================

// Saved Views - stores user-defined table views and filter presets
export const savedViews = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  entityType: text("entity_type").notNull(), // lead, property, deal
  name: text("name").notNull(),
  filters: jsonb("filters").$type<{
    field: string;
    operator: string; // equals, contains, gt, lt, gte, lte, in, not_in
    value: string | number | boolean | string[];
  }[]>(),
  sortBy: text("sort_by"),
  sortOrder: text("sort_order").default("desc"), // asc, desc
  columns: jsonb("columns").$type<string[]>(), // visible column names
  isDefault: boolean("is_default").default(false),
  isShared: boolean("is_shared").default(false), // shared with team
  createdBy: text("created_by"), // user ID who created the view
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schema
export const insertSavedViewSchema = createInsertSchema(savedViews).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

// Types
export type SavedView = typeof savedViews.$inferSelect;
export type InsertSavedView = z.infer<typeof insertSavedViewSchema>;

// Type aliases for saved views
export type SavedViewFilter = NonNullable<SavedView["filters"]>[number];
export type FilterOperator = "equals" | "not_equals" | "contains" | "gt" | "lt" | "gte" | "lte" | "in" | "not_in" | "is_empty" | "is_not_empty";

// ============================================
// UI STATE (Tahoe E6 — server-backed useUiState)
// ============================================

// Server-backed UI preferences keyed by (organization_id, user_id, key).
// Today most ephemeral UI state — collapsed panels, view toggles, dismissed
// banners — lives only in localStorage, so it does not follow a user across
// devices (Tom uses iOS AND desktop). This table is the durable home for
// that state. The `value` is an opaque jsonb blob; each consumer owns its
// own shape via the `useUiState<T>` hook. Keys are namespaced "scope:field"
// (e.g. "sidebar:collapsed", "pax-rail:open") to match the localStorage key
// conventions in use-local-storage-state.ts.
export const uiState = pgTable("ui_state", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Leading-org composite uniqueness — one row per (org, user, key). The
  // hook upserts on this constraint; the leading org column also satisfies
  // the L3 shard-readiness lint (check-org-leading-index.mjs).
  uniqueIndex("ui_state_org_user_key_idx").on(table.organizationId, table.userId, table.key),
]);

export type UiState = typeof uiState.$inferSelect;
export type InsertUiState = typeof uiState.$inferInsert;

// ============================================
// TEAM MESSAGING SYSTEM
// ============================================

// Team conversations (direct messages or group chats)
export const teamConversations = pgTable("team_conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name"), // null for direct messages, set for group chats
  isDirect: boolean("is_direct").notNull().default(true), // true for 1-on-1, false for group
  createdBy: text("created_by").notNull(), // Replit user ID
  participantIds: jsonb("participant_ids").$type<string[]>().notNull(), // Array of Replit user IDs
  status: text("status").notNull().default("active"), // active, archived
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTeamConversationSchema = createInsertSchema(teamConversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
});
export type InsertTeamConversation = z.infer<typeof insertTeamConversationSchema>;
export type TeamConversation = typeof teamConversations.$inferSelect;

// Team messages within conversations
export const teamMessages = pgTable("team_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => teamConversations.id).notNull(),
  senderId: text("sender_id").notNull(), // Replit user ID
  body: text("body").notNull(),
  attachments: jsonb("attachments").$type<{
    type: string;
    url: string;
    name: string;
    size?: number;
  }[]>(),
  readBy: jsonb("read_by").$type<{ 
    userId: string; 
    readAt: string; 
  }[]>().default([]),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTeamMessageSchema = createInsertSchema(teamMessages).omit({
  id: true,
  createdAt: true,
  readBy: true,
  isDeleted: true,
});
export type InsertTeamMessage = z.infer<typeof insertTeamMessageSchema>;
export type TeamMessage = typeof teamMessages.$inferSelect;

// Team member presence/status for online indicators
export const teamMemberPresence = pgTable("team_member_presence", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID
  status: text("status").notNull().default("offline"), // online, away, offline
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  deviceInfo: text("device_info"), // desktop, mobile, etc.
});

export const insertTeamMemberPresenceSchema = createInsertSchema(teamMemberPresence).omit({
  id: true,
});
export type InsertTeamMemberPresence = z.infer<typeof insertTeamMemberPresenceSchema>;
export type TeamMemberPresence = typeof teamMemberPresence.$inferSelect;

// ============================================
// WORKSPACE PRESETS - Power User Features
// ============================================

export const workspacePresets = pgTable("workspace_presets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  layout: jsonb("layout").$type<{
    route: string;
    sidebarCollapsed?: boolean;
    openPanels?: string[];
    filters?: Record<string, any>;
    sortBy?: string;
    viewMode?: string;
  }>().notNull(),
  icon: text("icon"),
  color: text("color"),
  isDefault: boolean("is_default").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("workspace_presets_org_idx").on(table.organizationId),
  index("workspace_presets_user_idx").on(table.userId),
]);

export const insertWorkspacePresetSchema = createInsertSchema(workspacePresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WorkspacePreset = typeof workspacePresets.$inferSelect;
export type InsertWorkspacePreset = z.infer<typeof insertWorkspacePresetSchema>;

