/**
 * deal-lifecycle — extracted from the shared/schema.ts monolith on 2026-09-28
 * (DEFECT-0048) and re-exported through that barrel, so every
 * `import { … } from "@shared/schema"` is unchanged. Sections, verbatim:
 *   - LEAD SCORING (Betty-style)
 *   - DEAL CHECKLISTS (Stage Gate Due Diligence)
 *   - ACQUISITION: OFFER LETTERS & BLIND OFFERS
 *   - ACQUISITION: SKIP TRACING
 *   - DISPOSITION: LISTINGS & SYNDICATION
 *   - DOCUMENT VERSION HISTORY
 *   - DOCUMENT PACKAGES
 *   - BORROWER SESSIONS (Session-based auth for borrower portal)
 *   - BORROWER MESSAGES (Self-service messaging thread)
 *   - PHASE 4: CLOSING & SERVICING AUTOMATION
 *   - LEAD QUALIFICATION & ESCALATION
 *   - PHASE 4: NEGOTIATION, SEQUENCES, VOICE/CALL AI
 *   - PLAYBOOKS - Guided Workflows
 *
 * Monolith tables are imported from "../schema" and used only lazily
 * (inside references(() => …)); the barrel's `export *` is hoisted, so this
 * module evaluates before the monolith's body and must never read one eagerly.
 */
import { pgTable, text, serial, integer, boolean, timestamp, numeric, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "../db/createInsertSchema";
import { z } from "zod";
import { conversations, deals, leads, notes, organizations, properties } from "../schema";

// ============================================
// LEAD SCORING (Betty-style)
// ============================================

// Scoring profiles - configurable weights per organization
export const leadScoringProfiles = pgTable("lead_scoring_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull().default("Default"),
  isActive: boolean("is_active").default(true),
  
  // Property-based factor weights (sum to ~40%)
  ownershipDurationWeight: integer("ownership_duration_weight").default(15),
  taxDelinquencyWeight: integer("tax_delinquency_weight").default(20),
  absenteeOwnerWeight: integer("absentee_owner_weight").default(15),
  propertySizeWeight: integer("property_size_weight").default(10),
  assessedValueWeight: integer("assessed_value_weight").default(10),
  
  // Owner-based factor weights (sum to ~30%)
  corporateOwnerWeight: integer("corporate_owner_weight").default(10),
  multiplePropertiesWeight: integer("multiple_properties_weight").default(10),
  inheritanceIndicatorWeight: integer("inheritance_indicator_weight").default(15),
  outOfStateWeight: integer("out_of_state_weight").default(15),
  
  // Market/Location factor weights (sum to ~15%)
  floodZoneWeight: integer("flood_zone_weight").default(10),
  marketActivityWeight: integer("market_activity_weight").default(15),
  developmentPotentialWeight: integer("development_potential_weight").default(10),
  
  // Engagement factor weights (sum to ~15%)
  responseRecencyWeight: integer("response_recency_weight").default(25),
  emailEngagementWeight: integer("email_engagement_weight").default(15),
  campaignTouchesWeight: integer("campaign_touches_weight").default(10),
  
  // Thresholds
  hotThreshold: integer("hot_threshold").default(70),
  warmThreshold: integer("warm_threshold").default(40),
  coldThreshold: integer("cold_threshold").default(20),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Lead score history - tracks score changes over time
export const leadScoreHistory = pgTable("lead_score_history", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  profileId: integer("profile_id").references(() => leadScoringProfiles.id),
  
  // Score (-400 to +400 Betty-style range, stored as integer)
  score: integer("score").notNull(),
  previousScore: integer("previous_score"),
  
  // Factor breakdown
  factors: jsonb("factors").$type<{
    // Property factors
    ownershipDuration?: { value: number; score: number; yearsOwned?: number };
    taxDelinquency?: { value: number; score: number; delinquentAmount?: number };
    absenteeOwner?: { value: boolean; score: number };
    propertySize?: { value: number; score: number; acres?: number };
    assessedValue?: { value: number; score: number; assessedAmount?: number };
    
    // Owner factors
    corporateOwner?: { value: boolean; score: number; entityType?: string };
    multipleProperties?: { value: boolean; score: number; count?: number };
    inheritanceIndicator?: { value: boolean; score: number; indicator?: string };
    outOfState?: { value: boolean; score: number; ownerState?: string };
    
    // Market/Location factors
    floodZone?: { value: string; score: number };
    marketActivity?: { value: number; score: number; recentSales?: number };
    developmentPotential?: { value: number; score: number };
    
    // Engagement factors
    responseRecency?: { value: number; score: number; daysSinceResponse?: number };
    emailEngagement?: { value: number; score: number; openRate?: number };
    campaignTouches?: { value: number; score: number; touchCount?: number };
    
    // Computed
    totalRawScore?: number;
    normalizedScore?: number;
    recommendation?: "mail" | "maybe" | "skip";
  }>(),
  
  // Enrichment data used
  enrichmentData: jsonb("enrichment_data").$type<{
    parcelData?: any;
    floodData?: any;
    censusData?: any;
    taxData?: any;
    marketData?: any;
    lastEnriched?: string;
  }>(),
  
  triggerSource: text("trigger_source"), // manual, scheduled, import, campaign
  scoredAt: timestamp("scored_at").defaultNow(),
});

// Lead conversion tracking - for training the model
export const leadConversions = pgTable("lead_conversions", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // What happened
  conversionType: text("conversion_type").notNull(), // responded, negotiating, accepted, closed, dead
  scoreAtConversion: integer("score_at_conversion"),
  
  // Campaign attribution
  campaignId: integer("campaign_id"),
  campaignType: text("campaign_type"), // direct_mail, email, sms, cold_call
  touchNumber: integer("touch_number"), // Which touch in the sequence led to conversion
  
  // Timing
  daysFromFirstTouch: integer("days_from_first_touch"),
  daysFromScore: integer("days_from_score"),
  
  // Outcome value
  dealValue: integer("deal_value"), // If closed, what was the deal value
  profitMargin: integer("profit_margin"), // Percentage profit
  
  convertedAt: timestamp("converted_at").defaultNow(),
});

export const insertLeadScoringProfileSchema = createInsertSchema(leadScoringProfiles).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type LeadScoringProfile = typeof leadScoringProfiles.$inferSelect;
export type InsertLeadScoringProfile = z.infer<typeof insertLeadScoringProfileSchema>;

export const insertLeadScoreHistorySchema = createInsertSchema(leadScoreHistory).omit({ 
  id: true, 
  scoredAt: true 
});
export type LeadScoreHistory = typeof leadScoreHistory.$inferSelect;
export type InsertLeadScoreHistory = z.infer<typeof insertLeadScoreHistorySchema>;

export const insertLeadConversionSchema = createInsertSchema(leadConversions).omit({ 
  id: true, 
  convertedAt: true 
});
export type LeadConversion = typeof leadConversions.$inferSelect;
export type InsertLeadConversion = z.infer<typeof insertLeadConversionSchema>;

// ============================================
// DEAL CHECKLISTS (Stage Gate Due Diligence)
// ============================================

// Type for checklist template items
export type ChecklistTemplateItem = {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  documentRequired: boolean;
};

// Type for deal checklist items (includes completion state)
export type DealChecklistItem = {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  documentRequired: boolean;
  checkedAt?: string;
  checkedBy?: string;
  documentUrl?: string;
  // The closing generator writes its items into the SAME row with its own
  // vocabulary (DEFECT-0176) — declared here so every reader sees them:
  // `completed` is its done-flag, and "fraud_gate" marks the wire interlock.
  category?: string;
  critical?: boolean;
  phase?: string;
  completed?: boolean;
  completedAt?: string;
  /** The wire-fraud step's attestation: who confirmed which number, how, when. */
  verification?: {
    phoneNumber: string;
    numberSource: string;
    spokeWith: string;
    confirmedBy: string | null;
    confirmedAt: string;
  };
};

// Checklist templates table
export const checklistTemplates = pgTable("checklist_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  dealType: text("deal_type").notNull().default("all"), // cash, terms, wholesale, all
  items: jsonb("items").$type<ChecklistTemplateItem[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Deal checklists table (applied to specific deals)
export const dealChecklists = pgTable("deal_checklists", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  templateId: integer("template_id").references(() => checklistTemplates.id),
  items: jsonb("items").$type<DealChecklistItem[]>().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas
export const insertChecklistTemplateSchema = createInsertSchema(checklistTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDealChecklistSchema = createInsertSchema(dealChecklists).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type InsertChecklistTemplate = z.infer<typeof insertChecklistTemplateSchema>;
export type DealChecklist = typeof dealChecklists.$inferSelect;
export type InsertDealChecklist = z.infer<typeof insertDealChecklistSchema>;

// Default deal checklist templates
export const DEFAULT_DEAL_CHECKLIST_TEMPLATES: Array<{
  name: string;
  description: string;
  dealType: "cash" | "terms" | "wholesale" | "all";
  items: ChecklistTemplateItem[];
}> = [
  {
    name: "Cash Purchase Checklist",
    description: "Standard checklist for cash land purchases",
    dealType: "cash",
    items: [
      { id: "cash-1", title: "Title search completed", description: "Verify clear title with no liens or encumbrances", required: true, documentRequired: true },
      { id: "cash-2", title: "Survey review", description: "Review or order property survey", required: false, documentRequired: false },
      { id: "cash-3", title: "Property photos obtained", description: "Get current photos of the property", required: true, documentRequired: false },
      { id: "cash-4", title: "Purchase agreement signed", description: "Both parties have signed the purchase agreement", required: true, documentRequired: true },
      { id: "cash-5", title: "Funds verified", description: "Confirm buyer funds are available and verified", required: true, documentRequired: false },
      { id: "cash-6", title: "Closing scheduled", description: "Closing date and location confirmed", required: true, documentRequired: false },
    ],
  },
  {
    name: "Seller Financing (Terms) Checklist",
    description: "Checklist for seller-financed deals with payment terms",
    dealType: "terms",
    items: [
      { id: "terms-1", title: "Title search completed", description: "Verify clear title with no liens or encumbrances", required: true, documentRequired: true },
      { id: "terms-2", title: "Survey review", description: "Review or order property survey", required: false, documentRequired: false },
      { id: "terms-3", title: "Property photos obtained", description: "Get current photos of the property", required: true, documentRequired: false },
      { id: "terms-4", title: "Purchase agreement signed", description: "Both parties have signed the purchase agreement", required: true, documentRequired: true },
      { id: "terms-5", title: "Promissory note drafted", description: "Create and review promissory note terms", required: true, documentRequired: true },
      { id: "terms-6", title: "Down payment received", description: "Confirm down payment has been received", required: true, documentRequired: false },
      { id: "terms-7", title: "Payment schedule confirmed", description: "Finalize monthly payment schedule with buyer", required: true, documentRequired: false },
      { id: "terms-8", title: "Closing scheduled", description: "Closing date and location confirmed", required: true, documentRequired: false },
    ],
  },
  {
    name: "Wholesale Deal Checklist",
    description: "Checklist for wholesale/assignment deals",
    dealType: "wholesale",
    items: [
      { id: "ws-1", title: "Assignment contract prepared", description: "Create assignment of contract document", required: true, documentRequired: true },
      { id: "ws-2", title: "End buyer verified", description: "Confirm end buyer identity and ability to close", required: true, documentRequired: false },
      { id: "ws-3", title: "Earnest money deposited", description: "Earnest money received from end buyer", required: true, documentRequired: false },
      { id: "ws-4", title: "Assignment fee confirmed", description: "Assignment fee amount agreed upon", required: true, documentRequired: false },
      { id: "ws-5", title: "Original contract assignable", description: "Verify original purchase contract allows assignment", required: true, documentRequired: false },
      { id: "ws-6", title: "Closing coordinated", description: "Coordinate closing with title company and all parties", required: true, documentRequired: false },
    ],
  },
];

// ============================================
// ACQUISITION: OFFER LETTERS & BLIND OFFERS
// ============================================

export const offerLetters = pgTable("offer_letters", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  offerAmount: numeric("offer_amount").notNull(),
  offerPercent: numeric("offer_percent"), // Percentage of assessed value
  assessedValue: numeric("assessed_value"),
  
  expirationDays: integer("expiration_days").default(30),
  expirationDate: timestamp("expiration_date"),
  
  templateId: text("template_id"),
  letterContent: text("letter_content"),
  
  status: text("status").notNull().default("draft"), // draft, queued, sent, delivered, responded, accepted, rejected, expired
  
  deliveryMethod: text("delivery_method").default("direct_mail"), // direct_mail, email, both
  lobMailingId: text("lob_mailing_id"),
  trackingNumber: text("tracking_number"),
  
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  respondedAt: timestamp("responded_at"),
  responseNotes: text("response_notes"),
  
  batchId: text("batch_id"), // Groups offers sent together
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOfferLetterSchema = createInsertSchema(offerLetters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOfferLetter = z.infer<typeof insertOfferLetterSchema>;
export type OfferLetter = typeof offerLetters.$inferSelect;

// Offer letter templates
export const offerTemplates = pgTable("offer_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("blind_offer"), // blind_offer, follow_up, final_offer
  subject: text("subject"),
  content: text("content").notNull(),
  isDefault: boolean("is_default").default(false),
  variables: jsonb("variables").$type<string[]>(), // Available merge fields
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOfferTemplateSchema = createInsertSchema(offerTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOfferTemplate = z.infer<typeof insertOfferTemplateSchema>;
export type OfferTemplate = typeof offerTemplates.$inferSelect;

// ============================================
// ACQUISITION: SKIP TRACING
// ============================================

export const skipTraces = pgTable("skip_traces", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),

  inputData: jsonb("input_data").$type<{
    name?: string;
    address?: string;
    apn?: string;
    mailingAddress?: string;
  }>(),

  results: jsonb("results").$type<{
    phones?: { number: string; type: string; verified: boolean }[];
    emails?: { email: string; verified: boolean }[];
    addresses?: { address: string; type: string; current: boolean }[];
    relatives?: { name: string; relationship?: string }[];
    employer?: { name: string; address?: string };
    ageRange?: string;
  }>(),

  provider: text("provider"), // realskip, tloxp, batchskip
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed, no_results

  costCents: integer("cost_cents"),
  requestedAt: timestamp("requested_at").defaultNow(),
  completedAt: timestamp("completed_at"),

  createdAt: timestamp("created_at").defaultNow(),

  // FW-WYNNE-1 (push-forward 2026-05-08): permissible-purpose gate.
  // Wynne-Ohaegbu §1: skip-trace is FCRA-adjacent under §1681b(a)(3)(F)
  // legitimate-business-need but the AcreOS operator must claim a purpose
  // and a justification at query time. Gate at route entry, persist here
  // for class-action defense audit trail.
  purposeOfUse: text("purpose_of_use"), // collection|legitimate_business_need|written_consent|account_review
  justification: text("justification"), // free-text, ≥10 chars
  attestingUserId: text("attesting_user_id"),
  attestationVersion: text("attestation_version"),
});

export const insertSkipTraceSchema = createInsertSchema(skipTraces).omit({
  id: true,
  createdAt: true,
});
export type InsertSkipTrace = z.infer<typeof insertSkipTraceSchema>;
export type SkipTrace = typeof skipTraces.$inferSelect;

// ============================================
// DISPOSITION: LISTINGS & SYNDICATION
// ============================================

export const propertyListings = pgTable("property_listings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  title: text("title").notNull(),
  description: text("description"),
  askingPrice: numeric("asking_price").notNull(),
  minimumPrice: numeric("minimum_price"),
  
  sellerFinancingAvailable: boolean("seller_financing_available").default(true),
  downPaymentMin: numeric("down_payment_min"),
  monthlyPaymentMin: numeric("monthly_payment_min"),
  interestRate: numeric("interest_rate"),
  termMonths: integer("term_months"),
  
  photos: jsonb("photos").$type<{
    url: string;
    caption?: string;
    isPrimary?: boolean;
    order?: number;
  }[]>(),
  
  status: text("status").notNull().default("draft"), // draft, active, pending, sold, withdrawn
  
  syndicationTargets: jsonb("syndication_targets").$type<{
    platform: string; // landwatch, landandfarm, lands_of_america, facebook_marketplace, craigslist
    listingId?: string;
    listingUrl?: string;
    status: string; // pending, active, failed, removed, manual_posting, withdrawal_requested, withdrawal_failed, manual_action_required
    postedAt?: string;
    expiresAt?: string;
    error?: string;
    /** Who established the removal: the provider's 2xx, or the operator's word for a manual channel. */
    removalSource?: "provider" | "operator";
    removedAt?: string;
    removedBy?: string;
  }[]>(),
  
  viewCount: integer("view_count").default(0),
  inquiryCount: integer("inquiry_count").default(0),
  
  publishedAt: timestamp("published_at"),
  expiresAt: timestamp("expires_at"),
  soldAt: timestamp("sold_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPropertyListingSchema = createInsertSchema(propertyListings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPropertyListing = z.infer<typeof insertPropertyListingSchema>;
export type PropertyListing = typeof propertyListings.$inferSelect;

// Per-org on/off + sync bookkeeping for each syndication channel (founder
// decision D7, 2026-07-11: build the syndication backend now). The channel
// CATALOG lives in code (listingSyndication.PLATFORMS — names, env keys,
// API availability); this table stores only what varies per org: whether
// the channel is enabled, when it last synced, and the last honest error.
// One row per (org, channel); channels with no row are disabled.
// Migration 0200. Mirrors scripts/migrate.mjs.
export const syndicationChannelStates = pgTable("syndication_channel_states", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  channelId: text("channel_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("syndication_channel_states_org_channel_idx").on(table.organizationId, table.channelId),
]);

export type SyndicationChannelState = typeof syndicationChannelStates.$inferSelect;
export type InsertSyndicationChannelState = typeof syndicationChannelStates.$inferInsert;

// ============================================
// DOCUMENT VERSION HISTORY
// ============================================

export const documentVersions = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  documentId: integer("document_id").notNull(), // ID of the template or generated document
  documentType: text("document_type").notNull(), // "template" or "generated"
  version: integer("version").notNull(), // 1, 2, 3...
  content: text("content").notNull(), // Snapshot of content at this version
  variables: jsonb("variables").$type<Record<string, any>>(), // Variables snapshot (for templates)
  changes: text("changes"), // Description of what changed
  createdBy: text("created_by"), // userId who created this version
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentVersionSchema = createInsertSchema(documentVersions).omit({
  id: true,
  createdAt: true,
});
export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;
export type DocumentVersion = typeof documentVersions.$inferSelect;

// ============================================
// DOCUMENT PACKAGES
// ============================================

export const DOCUMENT_PACKAGE_STATUSES = ["draft", "complete", "sent", "signed"] as const;
export type DocumentPackageStatus = typeof DOCUMENT_PACKAGE_STATUSES[number];

export const documentPackages = pgTable("document_packages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  dealId: integer("deal_id").references(() => deals.id),
  propertyId: integer("property_id").references(() => properties.id),
  status: text("status").notNull().default("draft"),
  documents: jsonb("documents").$type<{
    documentId?: number;
    templateId: number;
    order: number;
    status: string;
    name?: string;
  }[]>().default([]),
  createdBy: text("created_by"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentPackageSchema = createInsertSchema(documentPackages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDocumentPackage = z.infer<typeof insertDocumentPackageSchema>;
export type DocumentPackage = typeof documentPackages.$inferSelect;

// ============================================
// BORROWER SESSIONS (Session-based auth for borrower portal)
// ============================================

export const borrowerSessions = pgTable("borrower_sessions", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  // SEC (Lens 23): pin the originating organization at session-create so
  // every read can re-assert note.organizationId === session.organizationId.
  // Without this, a note that ever migrates across orgs would silently
  // carry an active borrower session into the new org. Backfilled from
  // notes.organization_id by migration 0081.
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  email: text("email").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  lastAccessedAt: timestamp("last_accessed_at").defaultNow(),
});

export const insertBorrowerSessionSchema = createInsertSchema(borrowerSessions).omit({ 
  id: true, 
  createdAt: true, 
  lastAccessedAt: true 
});
export type InsertBorrowerSession = z.infer<typeof insertBorrowerSessionSchema>;
export type BorrowerSession = typeof borrowerSessions.$inferSelect;

// ============================================
// BORROWER MESSAGES (Self-service messaging thread)
// ============================================

export const borrowerMessages = pgTable("borrower_messages", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  orgId: integer("org_id").references(() => organizations.id).notNull(),
  senderType: text("sender_type").notNull(), // 'borrower' | 'lender'
  content: text("content").notNull(),
  readAt: timestamp("read_at"), // null = unread
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Leading-org composite (added 2026-09-04). The Drizzle declaration carried
  // no index callback at all, so this table was invisible to every reader that
  // works from the schema — and invisible to check-org-leading-index.mjs for a
  // second reason besides: that gate required the tenant key to be spelled
  // `organizationId`/`organization_id`, and this one is `orgId`/`org_id`.
  // The DB is not un-indexed — migrations/0013 creates single-column
  // idx_borrower_messages_note_id and idx_borrower_messages_org_id — but two
  // single-column indexes are not a tenant-leading composite, which is the
  // shard-readiness property the gate exists to hold.
  // Column order follows the three live queries, all of which filter noteId
  // inside one org and read in created order: getBorrowerMessages,
  // markBorrowerMessagesRead and countUnreadBorrowerMessages.
  index("borrower_messages_org_note_created_idx").on(table.orgId, table.noteId, table.createdAt),
]);

export const insertBorrowerMessageSchema = createInsertSchema(borrowerMessages).omit({ id: true, createdAt: true });
export type InsertBorrowerMessage = z.infer<typeof insertBorrowerMessageSchema>;
export type BorrowerMessage = typeof borrowerMessages.$inferSelect;

// ============================================
// PHASE 4: CLOSING & SERVICING AUTOMATION
// ============================================

// ----------------------------------------
// DISPOSITION AUTOMATION TABLES
// ----------------------------------------

// Buyer Reservations - Track property reservations by buyers
export const buyerReservations = pgTable("buyer_reservations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  buyerId: integer("buyer_id").references(() => leads.id),
  buyerName: text("buyer_name").notNull(),
  buyerEmail: text("buyer_email"),
  buyerPhone: text("buyer_phone"),
  reservationAmount: numeric("reservation_amount"),
  reservationDate: timestamp("reservation_date").defaultNow(),
  expirationDate: timestamp("expiration_date"),
  status: text("status").notNull().default("pending"),
  paymentMethod: text("payment_method"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBuyerReservationSchema = createInsertSchema(buyerReservations).omit({ id: true, createdAt: true });
export type InsertBuyerReservation = z.infer<typeof insertBuyerReservationSchema>;
export type BuyerReservation = typeof buyerReservations.$inferSelect;

// Escrow Checklists - Track closing steps
export const escrowChecklists = pgTable("escrow_checklists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  title: text("title").notNull(),
  items: jsonb("items").$type<Array<{
    id: string;
    label: string;
    completed: boolean;
    completedAt?: string;
    completedBy?: string;
    required: boolean;
    notes?: string;
  }>>().default([]),
  status: text("status").notNull().default("in_progress"),
  targetCloseDate: timestamp("target_close_date"),
  actualCloseDate: timestamp("actual_close_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEscrowChecklistSchema = createInsertSchema(escrowChecklists).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEscrowChecklist = z.infer<typeof insertEscrowChecklistSchema>;
export type EscrowChecklist = typeof escrowChecklists.$inferSelect;

// Closing Packets - Generated document bundles
export const closingPackets = pgTable("closing_packets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  type: text("type").notNull(),
  documents: jsonb("documents").$type<Array<{
    name: string;
    type: string;
    url?: string;
    generatedAt?: string;
    signed?: boolean;
    signedAt?: string;
  }>>().default([]),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertClosingPacketSchema = createInsertSchema(closingPackets).omit({ id: true, createdAt: true });
export type InsertClosingPacket = z.infer<typeof insertClosingPacketSchema>;
export type ClosingPacket = typeof closingPackets.$inferSelect;

// ----------------------------------------
// NOTE SERVICING TABLES
// ----------------------------------------

// Autopay Enrollments - Recurring payment setup
export const autopayEnrollments = pgTable("autopay_enrollments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  borrowerName: text("borrower_name").notNull(),
  borrowerEmail: text("borrower_email"),
  paymentMethod: text("payment_method").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  amount: numeric("amount").notNull(),
  dayOfMonth: integer("day_of_month").notNull().default(1),
  status: text("status").notNull().default("active"),
  lastPaymentDate: timestamp("last_payment_date"),
  nextPaymentDate: timestamp("next_payment_date"),
  failureCount: integer("failure_count").default(0),
  lastFailureReason: text("last_failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAutopayEnrollmentSchema = createInsertSchema(autopayEnrollments).omit({ id: true, createdAt: true });
export type InsertAutopayEnrollment = z.infer<typeof insertAutopayEnrollmentSchema>;
export type AutopayEnrollment = typeof autopayEnrollments.$inferSelect;

// Legacy `payoff_quotes` RETIRED 2026-09-29 (founder ruling #9a). It had no
// writer since DEFECT-0100 and no client reader; every payoff quote lives in
// `note_payoff_quotes` (shared/schema/notes-vertical.ts). The table's rows are
// exported and the table dropped by scripts/data/export-and-drop-payoff-quotes.ts.

// Trust Ledger - Accounting entries for trust accounts
export const trustLedger = pgTable("trust_ledger", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id),
  entryType: text("entry_type").notNull(),
  amount: numeric("amount").notNull(),
  runningBalance: numeric("running_balance").notNull(),
  description: text("description"),
  referenceId: text("reference_id"),
  referenceType: text("reference_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTrustLedgerSchema = createInsertSchema(trustLedger).omit({ id: true, createdAt: true });
export type InsertTrustLedger = z.infer<typeof insertTrustLedgerSchema>;
export type TrustLedgerEntry = typeof trustLedger.$inferSelect;

// Delinquency Escalations - Track and automate collection steps
export const delinquencyEscalations = pgTable("delinquency_escalations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  daysDelinquent: integer("days_delinquent").notNull(),
  escalationLevel: integer("escalation_level").notNull().default(1),
  amountDue: numeric("amount_due").notNull(),
  lastContactDate: timestamp("last_contact_date"),
  lastContactMethod: text("last_contact_method"),
  nextActionDate: timestamp("next_action_date"),
  nextAction: text("next_action"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("delinquency_escalations_org_idx").on(table.organizationId),
  index("delinquency_escalations_status_idx").on(table.status),
  index("delinquency_escalations_next_action_idx").on(table.nextActionDate),
]);

export const insertDelinquencyEscalationSchema = createInsertSchema(delinquencyEscalations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDelinquencyEscalation = z.infer<typeof insertDelinquencyEscalationSchema>;
export type DelinquencyEscalation = typeof delinquencyEscalations.$inferSelect;

// ----------------------------------------
// DUE DILIGENCE OPS TABLES
// ----------------------------------------

// DD Assignments - Assign DD tasks to team/vendors
export const ddAssignments = pgTable("dd_assignments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  assigneeType: text("assignee_type").notNull(),
  assigneeId: integer("assignee_id"),
  vendorName: text("vendor_name"),
  vendorEmail: text("vendor_email"),
  taskType: text("task_type").notNull(),
  dueDate: timestamp("due_date"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").default("normal"),
  cost: numeric("cost"),
  result: text("result"),
  resultNotes: text("result_notes"),
  attachments: jsonb("attachments").$type<string[]>().default([]),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDdAssignmentSchema = createInsertSchema(ddAssignments).omit({ id: true, createdAt: true });
export type InsertDdAssignment = z.infer<typeof insertDdAssignmentSchema>;
export type DdAssignment = typeof ddAssignments.$inferSelect;

// SWOT Reports - Property analysis reports
export const swotReports = pgTable("swot_reports", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  strengths: jsonb("strengths").$type<string[]>().default([]),
  weaknesses: jsonb("weaknesses").$type<string[]>().default([]),
  opportunities: jsonb("opportunities").$type<string[]>().default([]),
  threats: jsonb("threats").$type<string[]>().default([]),
  overallScore: integer("overall_score"),
  recommendation: text("recommendation"),
  aiGenerated: boolean("ai_generated").default(false),
  generatedBy: text("generated_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSwotReportSchema = createInsertSchema(swotReports).omit({ id: true, createdAt: true });
export type InsertSwotReport = z.infer<typeof insertSwotReportSchema>;
export type SwotReport = typeof swotReports.$inferSelect;

// Go/No-Go Memos - Investment decision documents
export const goNogoMemos = pgTable("go_nogo_memos", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id),
  decision: text("decision").notNull(),
  decisionDate: timestamp("decision_date").defaultNow(),
  decisionBy: text("decision_by"),
  maxOfferPrice: numeric("max_offer_price"),
  targetProfit: numeric("target_profit"),
  riskLevel: text("risk_level"),
  keyFindings: jsonb("key_findings").$type<string[]>().default([]),
  conditions: jsonb("conditions").$type<string[]>().default([]),
  attachedReports: jsonb("attached_reports").$type<Array<{type: string; id: number}>>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGoNogoMemoSchema = createInsertSchema(goNogoMemos).omit({ id: true, createdAt: true });
export type InsertGoNogoMemo = z.infer<typeof insertGoNogoMemoSchema>;
export type GoNogoMemo = typeof goNogoMemos.$inferSelect;

// ============================================
// LEAD QUALIFICATION & ESCALATION
// ============================================

// Lead qualification signals - tracks buyer readiness indicators
export const leadQualificationSignals = pgTable("lead_qualification_signals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  conversationId: integer("conversation_id").references(() => conversations.id),
  
  // Signal details
  signalType: text("signal_type").notNull(), // price_inquiry, timeline_mention, financing_question, viewing_request, comparison_shopping, urgency, objection, negotiation
  confidence: numeric("confidence").notNull(), // 0-1 confidence score
  extractedText: text("extracted_text"), // the text that triggered this signal
  
  // Buyer intent scoring
  intentScore: integer("intent_score"), // 0-100 how ready to buy
  
  metadata: jsonb("metadata").$type<{
    mentionedPrice?: number;
    mentionedTimeline?: string;
    propertyId?: number;
    channel?: string;
  }>(),
  
  detectedAt: timestamp("detected_at").defaultNow(),
});

export const insertLeadQualificationSignalSchema = createInsertSchema(leadQualificationSignals).omit({ 
  id: true, 
  detectedAt: true 
});
export type InsertLeadQualificationSignal = z.infer<typeof insertLeadQualificationSignalSchema>;
export type LeadQualificationSignal = typeof leadQualificationSignals.$inferSelect;

// Escalation alerts - notifies user when action needed
export const escalationAlerts = pgTable("escalation_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  conversationId: integer("conversation_id").references(() => conversations.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  // Alert details
  alertType: text("alert_type").notNull(), // hot_lead, ready_to_buy, price_negotiation, urgent_response, escalation_requested
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  title: text("title").notNull(),
  description: text("description"),
  
  // Recommended action
  suggestedAction: text("suggested_action"),
  suggestedResponse: text("suggested_response"), // AI-drafted response
  
  // Status
  status: text("status").notNull().default("pending"), // pending, acknowledged, actioned, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  actionTaken: text("action_taken"),
  
  // Auto-dismiss rules
  expiresAt: timestamp("expires_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEscalationAlertSchema = createInsertSchema(escalationAlerts).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertEscalationAlert = z.infer<typeof insertEscalationAlertSchema>;
export type EscalationAlert = typeof escalationAlerts.$inferSelect;

// ============================================
// PHASE 4: NEGOTIATION, SEQUENCES, VOICE/CALL AI
// ============================================

// Negotiation Sessions - AI-assisted negotiation tracking
// negotiation_sessions DROPPED (founder drop order, picker 2026-09-01;
// OD-8 tranche 0249). The retired negotiation copilot's session table —
// zero production readers/writers since the feature was removed; the
// migrate.mjs od8-ledger prints the program verdict each release.

// Message Sequence Performance - which messages work best
export const sequencePerformance = pgTable("sequence_performance", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Sequence identification
  sequenceId: integer("sequence_id"), // links to marketingSequences if applicable
  sequenceName: text("sequence_name").notNull(),
  channel: text("channel").notNull(), // email, sms, mail
  
  // Message details
  messagePosition: integer("message_position").notNull(), // 1st, 2nd, 3rd etc.
  templateContent: text("template_content"),
  subjectLine: text("subject_line"),
  
  // Performance metrics
  totalSent: integer("total_sent").default(0),
  delivered: integer("delivered").default(0),
  opened: integer("opened").default(0),
  clicked: integer("clicked").default(0),
  replied: integer("replied").default(0),
  converted: integer("converted").default(0),
  unsubscribed: integer("unsubscribed").default(0),
  bounced: integer("bounced").default(0),
  
  // Calculated rates
  openRate: numeric("open_rate"),
  clickRate: numeric("click_rate"),
  replyRate: numeric("reply_rate"),
  conversionRate: numeric("conversion_rate"),
  
  // A/B testing
  variant: text("variant"), // A, B, control
  isWinner: boolean("is_winner"),
  
  // AI optimization suggestions
  optimizationSuggestions: jsonb("optimization_suggestions").$type<{
    subjectLineSuggestions?: string[];
    timingSuggestions?: string[];
    contentSuggestions?: string[];
    segmentSuggestions?: string[];
    confidence?: number;
    lastOptimizedAt?: string;
  }>(),
  
  // Best performing segments
  bestPerformingSegments: jsonb("best_performing_segments").$type<Array<{
    segment: string;
    replyRate: number;
    sampleSize: number;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Call Transcripts - voice/call AI integration
export const callTranscripts = pgTable("call_transcripts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id),
  
  // Call metadata
  callId: text("call_id"), // external call system ID
  direction: text("direction").notNull(), // inbound, outbound
  callType: text("call_type").notNull(), // initial_contact, follow_up, negotiation, closing
  callerPhone: text("caller_phone"),
  duration: integer("duration"), // seconds
  callStartedAt: timestamp("call_started_at"),
  callEndedAt: timestamp("call_ended_at"),
  
  // Transcription
  transcriptRaw: text("transcript_raw"),
  transcriptFormatted: jsonb("transcript_formatted").$type<Array<{
    speaker: string;
    text: string;
    startTime: number;
    endTime: number;
    confidence?: number;
  }>>(),
  transcriptionProvider: text("transcription_provider"), // whisper, assembly, deepgram
  transcriptionConfidence: numeric("transcription_confidence"),
  
  // AI Analysis
  summary: text("summary"),
  sentiment: text("sentiment"), // positive, negative, neutral, mixed
  sentimentScore: numeric("sentiment_score"), // -1 to 1
  
  // Action items extracted
  actionItems: jsonb("action_items").$type<Array<{
    id: string;
    description: string;
    assignedTo?: string;
    dueDate?: string;
    priority: string;
    completed: boolean;
    completedAt?: string;
    createdFromCall: boolean;
  }>>(),
  
  // Key information extracted
  extractedData: jsonb("extracted_data").$type<{
    pricesMentioned?: number[];
    datesMentioned?: string[];
    namesMentioned?: string[];
    objectionsRaised?: string[];
    commitmentsMade?: string[];
    questionsAsked?: string[];
    nextSteps?: string[];
  }>(),
  
  // Coaching insights
  coachingInsights: jsonb("coaching_insights").$type<{
    talkToListenRatio?: number;
    questionCount?: number;
    objectionHandlingScore?: number;
    rapportScore?: number;
    closingEffectiveness?: number;
    improvementAreas?: string[];
    strengths?: string[];
  }>(),
  
  // CRM updates made
  crmUpdatesApplied: jsonb("crm_updates_applied").$type<Array<{
    field: string;
    oldValue: string;
    newValue: string;
    appliedAt: string;
    automated: boolean;
  }>>(),
  
  // Audio storage
  audioUrl: text("audio_url"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});


export const insertSequencePerformanceSchema = createInsertSchema(sequencePerformance).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSequencePerformance = z.infer<typeof insertSequencePerformanceSchema>;
export type SequencePerformance = typeof sequencePerformance.$inferSelect;

export const insertCallTranscriptSchema = createInsertSchema(callTranscripts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCallTranscript = z.infer<typeof insertCallTranscriptSchema>;
export type CallTranscript = typeof callTranscripts.$inferSelect;

// ============================================
// PLAYBOOKS - Guided Workflows
// ============================================

export const PLAYBOOK_TEMPLATES = {
  acquisition_sprint: "acquisition_sprint",
  due_diligence: "due_diligence", 
  disposition_launch: "disposition_launch",
} as const;

export type PlaybookTemplateType = typeof PLAYBOOK_TEMPLATES[keyof typeof PLAYBOOK_TEMPLATES];

export const playbookInstances = pgTable("playbook_instances", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  templateId: text("template_id").notNull(), // acquisition_sprint, due_diligence, disposition_launch
  name: text("name").notNull(),
  status: text("status").notNull().default("in_progress"), // in_progress, completed, cancelled
  
  linkedDealId: integer("linked_deal_id").references(() => deals.id),
  linkedPropertyId: integer("linked_property_id").references(() => properties.id),
  linkedLeadId: integer("linked_lead_id").references(() => leads.id),
  
  completedSteps: jsonb("completed_steps").$type<string[]>().default([]),
  stepData: jsonb("step_data").$type<Record<string, any>>(),
  
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPlaybookInstanceSchema = createInsertSchema(playbookInstances).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlaybookInstance = z.infer<typeof insertPlaybookInstanceSchema>;
export type PlaybookInstance = typeof playbookInstances.$inferSelect;

// Playbook step types for frontend
export interface PlaybookStep {
  id: string;
  title: string;
  description: string;
  actionType: "navigate" | "create_lead" | "create_property" | "create_deal" | "link_entity" | "manual";
  actionLabel: string;
  actionUrl?: string;
  icon: string;
  estimatedMinutes?: number;
}

export interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  category: "acquisition" | "due_diligence" | "disposition";
  estimatedDuration: string;
  steps: PlaybookStep[];
}

