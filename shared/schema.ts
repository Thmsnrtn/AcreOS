import { pgTable, text, serial, integer, boolean, timestamp, numeric, varchar, jsonb, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import Auth and Chat models
export * from "./models/auth";
export * from "./models/chat";

// ============================================
// ORGANIZATIONS & TEAM MANAGEMENT
// ============================================

// Organizations (tenants for multi-tenancy)
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id").notNull(), // Replit user ID
  subscriptionTier: text("subscription_tier").notNull().default("free"), // free, starter, pro, scale
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  creditBalance: numeric("credit_balance").default("0"), // prepaid credit balance in cents
  // Dunning state
  dunningStage: text("dunning_stage").default("none"), // none, grace_period, warning, restricted, suspended, cancelled
  dunningStartedAt: timestamp("dunning_started_at"),
  lastPaymentFailedAt: timestamp("last_payment_failed_at"),
  // Auto top-up settings
  autoTopUpEnabled: boolean("auto_top_up_enabled").default(false),
  autoTopUpThresholdCents: integer("auto_top_up_threshold_cents").default(200), // Trigger when below $2
  autoTopUpAmountCents: integer("auto_top_up_amount_cents").default(2500), // Add $25
  // Seat management
  additionalSeats: integer("additional_seats").default(0), // Extra seats purchased beyond tier limit
  // Founder status - bypasses all limits and credit checks
  isFounder: boolean("is_founder").default(false),
  // Onboarding wizard state
  onboardingCompleted: boolean("onboarding_completed").default(false),
  onboardingStep: integer("onboarding_step").default(0),
  onboardingData: jsonb("onboarding_data").$type<{
    businessType?: "land_flipper" | "note_investor" | "hybrid";
    dataImported?: boolean;
    stripeConnected?: boolean;
    campaignCreated?: boolean;
    completedSteps?: number[];
    skippedSteps?: number[];
    aiTips?: string[];
  }>(),
  settings: jsonb("settings").$type<{
    timezone?: string;
    currency?: string;
    defaultInterestRate?: number;
    defaultTermMonths?: number;
    companyAddress?: string;
    companyPhone?: string;
    companyEmail?: string;
    onboardingCompleted?: boolean;
    showTips?: boolean;
    checklistDismissed?: boolean;
    notificationsConfigured?: boolean;
    mailMode?: "test" | "live";
    // Data Retention Policies (20.3)
    retentionPolicies?: {
      leads?: { enabled: boolean; retentionDays: number };
      closedDeals?: { enabled: boolean; retentionDays: number };
      auditLogs?: { enabled: boolean; retentionDays: number };
      communications?: { enabled: boolean; retentionDays: number };
    };
    // AI Settings
    aiSettings?: {
      responseStyle?: "concise" | "detailed" | "balanced";
      defaultAgent?: string;
      autoSuggestions?: boolean;
      rememberContext?: boolean;
    };
    // Dashboard Widget Settings
    dashboardWidgets?: {
      order: string[];
      visibility: Record<string, boolean>;
    };
  }>(),
  // Free trial tracking
  trialStartedAt: timestamp("trial_started_at"), // When trial began
  trialEndsAt: timestamp("trial_ends_at"), // When trial expires (7 days from start)
  trialUsed: boolean("trial_used").default(false), // True once trial has been used (prevents repeat trials)
  // Trial tokens for sampling premium actions (free tier users)
  trialTokens: integer("trial_tokens").default(5), // Free tokens to try premium actions
  trialTokensGrantedAt: timestamp("trial_tokens_granted_at").defaultNow(), // When tokens were last granted
  // Sophie proactive notification settings
  proactiveNotificationLevel: varchar("proactive_notification_level", { length: 50 }).default("balanced"), // minimal, balanced, proactive, off
  // UTM attribution for customer acquisition tracking
  utmSource: text("utm_source"),     // e.g. 'meta', 'google', 'organic'
  utmMedium: text("utm_medium"),     // e.g. 'cpc', 'social', 'email'
  utmCampaign: text("utm_campaign"), // e.g. 'land-investors-q1'
  utmContent: text("utm_content"),   // e.g. 'carousel-ad-1'
  // Referral program credit balance (in cents)
  referralCredits: integer("referral_credits").notNull().default(0),
  // Churn risk scoring (0-100, 100 = highest risk)
  churnRiskScore: integer("churn_risk_score").notNull().default(0),
  churnRiskUpdatedAt: timestamp("churn_risk_updated_at"),
  churnRescueSentAt: timestamp("churn_rescue_sent_at"),
  // Milestone tracking for self-promotion nudges
  milestonesReached: jsonb("milestones_reached").$type<string[]>().default([]),
  referralNudgeSentAt: timestamp("referral_nudge_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Team members within an organization
export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID
  email: text("email"),
  displayName: text("display_name"),
  role: text("role").notNull().default("member"), // owner, admin, acquisitions, marketing, finance, member
  permissions: jsonb("permissions").$type<string[]>(),
  isActive: boolean("is_active").notNull().default(true),
  invitedAt: timestamp("invited_at").defaultNow(),
  joinedAt: timestamp("joined_at"),
});

// ============================================
// VERIFIED SENDERS (Email & SMS)
// ============================================

// Verified email domains for SendGrid
export const verifiedEmailDomains = pgTable("verified_email_domains", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  domain: text("domain").notNull(), // e.g., "mycompany.com"
  sendgridDomainId: text("sendgrid_domain_id"), // SendGrid's domain ID
  status: text("status").notNull().default("pending"), // pending, verified, failed
  dnsRecords: jsonb("dns_records").$type<{
    type: string; // CNAME, TXT, MX
    host: string;
    data: string;
    valid: boolean;
  }[]>(),
  fromEmail: text("from_email"), // Default from email, e.g., "noreply@mycompany.com"
  fromName: text("from_name"), // Default from name, e.g., "My Company"
  isDefault: boolean("is_default").default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Provisioned phone numbers for Twilio SMS
export const provisionedPhoneNumbers = pgTable("provisioned_phone_numbers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  phoneNumber: text("phone_number").notNull(), // E.164 format, e.g., "+15551234567"
  twilioSid: text("twilio_sid"), // Twilio's phone number SID
  friendlyName: text("friendly_name"), // Display name for the number
  capabilities: jsonb("capabilities").$type<{
    sms: boolean;
    mms: boolean;
    voice: boolean;
  }>(),
  status: text("status").notNull().default("active"), // active, released, pending
  isDefault: boolean("is_default").default(false),
  monthlyRentalCost: numeric("monthly_rental_cost"), // Cost in cents
  purchasedAt: timestamp("purchased_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertVerifiedEmailDomainSchema = createInsertSchema(verifiedEmailDomains).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVerifiedEmailDomain = z.infer<typeof insertVerifiedEmailDomainSchema>;
export type VerifiedEmailDomain = typeof verifiedEmailDomains.$inferSelect;

export const insertProvisionedPhoneNumberSchema = createInsertSchema(provisionedPhoneNumbers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProvisionedPhoneNumber = z.infer<typeof insertProvisionedPhoneNumberSchema>;
export type ProvisionedPhoneNumber = typeof provisionedPhoneNumbers.$inferSelect;

// Organization integrations for storing per-org API credentials
export const organizationIntegrations = pgTable("organization_integrations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  provider: text("provider").notNull(), // sendgrid, twilio, lob, stripe_connect
  isEnabled: boolean("is_enabled").default(true),
  credentials: jsonb("credentials").$type<{
    encrypted?: string; // Encrypted JSON blob containing apiKey and other secrets
    apiKey?: string;
    accountSid?: string; // Twilio
    authToken?: string; // Twilio
    fromEmail?: string; // SendGrid default sender
    fromName?: string; // SendGrid default sender name
    fromPhoneNumber?: string; // Twilio default sender
    // Stripe Connect fields
    stripeConnectAccountId?: string; // Connected account ID (acct_xxx)
    stripeConnectAccessToken?: string; // OAuth access token (if using OAuth flow)
    stripeConnectRefreshToken?: string; // OAuth refresh token
  }>(),
  settings: jsonb("settings").$type<{
    testMode?: boolean;
    webhookSecret?: string;
    defaultTemplateId?: string;
    // Stripe Connect settings
    stripeConnectCapabilities?: {
      cardPayments?: boolean;
      transfers?: boolean;
      achPayments?: boolean;
    };
    stripeConnectOnboardingComplete?: boolean;
    stripeConnectPayoutsEnabled?: boolean;
    stripeConnectChargesEnabled?: boolean;
    stripeConnectDefaultCurrency?: string;
    stripeApplicationFeePercent?: number; // Platform fee percentage (e.g., 2.5)
  }>(),
  lastValidatedAt: timestamp("last_validated_at"),
  validationError: text("validation_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrganizationIntegrationSchema = createInsertSchema(organizationIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrganizationIntegration = z.infer<typeof insertOrganizationIntegrationSchema>;
export type OrganizationIntegration = typeof organizationIntegrations.$inferSelect;

// White-label tenant configurations — persisted so configs survive server restarts
export const whiteLabelConfigs = pgTable("white_label_configs", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull().unique(), // UUID assigned on create
  organizationId: integer("organization_id").references(() => organizations.id).notNull().unique(),
  parentOrganizationId: integer("parent_organization_id").references(() => organizations.id).notNull(),
  brandName: text("brand_name").notNull(),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: text("primary_color").notNull().default("#2563eb"),
  accentColor: text("accent_color").notNull().default("#16a34a"),
  customDomain: text("custom_domain").unique(),
  supportEmail: text("support_email").notNull(),
  supportPhone: text("support_phone"),
  footerText: text("footer_text").notNull().default("Powered by AcreOS"),
  features: jsonb("features").$type<{
    marketplace: boolean; academy: boolean; dealHunter: boolean; voiceAI: boolean;
    visionAI: boolean; capitalMarkets: boolean; negotiationCopilot: boolean;
    portfolioOptimizer: boolean; complianceAI: boolean; taxResearcher: boolean;
  }>().notNull(),
  revenueShare: jsonb("revenue_share").$type<{ platformFeePercent: number; resellerFeePercent: number }>().notNull(),
  limits: jsonb("limits").$type<{ maxUsers: number; maxLeads: number; maxProperties: number; maxCampaigns: number }>().notNull(),
  plan: text("plan").notNull().default("starter"), // starter | professional | enterprise
  billingEmail: text("billing_email").notNull(),
  status: text("status").notNull().default("active"), // active | suspended | cancelled
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Borrower payment profiles - maps borrowers to Stripe Customer IDs for connected accounts
export const borrowerPaymentProfiles = pgTable("borrower_payment_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id), // Borrower/buyer lead
  noteId: integer("note_id"), // Associated note (if for note payments)
  
  // Stripe Customer on the connected account
  stripeCustomerId: text("stripe_customer_id").notNull(), // cus_xxx on connected account
  stripeConnectAccountId: text("stripe_connect_account_id").notNull(), // acct_xxx
  
  // Payment method storage
  defaultPaymentMethodId: text("default_payment_method_id"), // pm_xxx
  paymentMethodType: text("payment_method_type"), // card, us_bank_account
  paymentMethodLast4: text("payment_method_last4"),
  paymentMethodBrand: text("payment_method_brand"), // visa, mastercard, etc.
  
  // Autopay settings
  autopayEnabled: boolean("autopay_enabled").default(false),
  autopayDay: integer("autopay_day"), // Day of month for autopay (1-28)
  
  // Contact info for payment notifications
  email: text("email"),
  phone: text("phone"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBorrowerPaymentProfileSchema = createInsertSchema(borrowerPaymentProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBorrowerPaymentProfile = z.infer<typeof insertBorrowerPaymentProfileSchema>;
export type BorrowerPaymentProfile = typeof borrowerPaymentProfiles.$inferSelect;

// ============================================
// CRM: LEADS & CONTACTS
// ============================================

// Leads (sellers and buyers)
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  type: text("type").notNull().default("seller"), // seller, buyer
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  status: text("status").notNull().default("new"), 
  // Seller statuses: new, mailed, responded, negotiating, accepted, closed, dead
  // Buyer statuses: new, interested, qualified, under_contract, closed, dead
  source: text("source"), // tax_list, referral, website, facebook, craigslist, etc.
  campaignId: integer("campaign_id"),
  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>(),
  assignedTo: integer("assigned_to"), // team member ID
  lastContactedAt: timestamp("last_contacted_at"),
  
  // Campaign attribution tracking
  sourceTrackingCode: text("source_tracking_code"), // Links to campaign.trackingCode
  sourceCampaignId: integer("source_campaign_id"), // Links to the campaign that generated this lead
  sourceMailPieceId: integer("source_mail_piece_id"), // FK to mailingOrderPieces — direct mail attribution
  
  // Lead Scoring & Nurturing
  score: integer("score"), // 0-100 lead score
  scoreFactors: jsonb("score_factors").$type<{
    responseRecency?: number;
    emailEngagement?: number;
    sourceBonus?: number;
    statusBonus?: number;
    recencyPenalty?: number;
    total?: number;
  }>(),
  lastScoreAt: timestamp("last_score_at"),
  emailOpens: integer("email_opens").default(0),
  emailClicks: integer("email_clicks").default(0),
  responses: integer("responses").default(0),
  nurturingStage: text("nurturing_stage").default("new"), // hot, warm, cold, dead, new
  nextFollowUpAt: timestamp("next_follow_up_at"),
  lastAIMessageAt: timestamp("last_ai_message_at"),
  
  // TCPA Compliance (20.2)
  tcpaConsent: boolean("tcpa_consent").default(false),
  consentDate: timestamp("consent_date"),
  consentSource: text("consent_source"), // website, phone, written, imported
  optOutDate: timestamp("opt_out_date"),
  optOutReason: text("opt_out_reason"),
  doNotContact: boolean("do_not_contact").default(false),
  
  // Soft delete support for safe bulk operations with recovery
  deletedAt: timestamp("deleted_at"), // null = active, timestamp = soft deleted
  deletedBy: text("deleted_by"), // user ID who performed the deletion
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("leads_org_idx").on(table.organizationId),
  index("leads_status_idx").on(table.status),
  index("leads_created_at_idx").on(table.createdAt),
  index("leads_email_idx").on(table.email),
  index("leads_deleted_at_idx").on(table.deletedAt),
]);

// Lead activity/interactions log
export const leadActivities = pgTable("lead_activities", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  type: text("type").notNull(), // email_sent, sms_sent, call_made, note_added, status_changed, offer_sent
  description: text("description"),
  metadata: jsonb("metadata"),
  performedBy: integer("performed_by"), // team member ID or null for automated
  createdAt: timestamp("created_at").defaultNow(),
});

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
// INVENTORY: PROPERTIES & DEALS
// ============================================

// Properties in inventory
export const properties = pgTable("properties", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Core property info
  apn: text("apn").notNull(), // Assessor's Parcel Number
  legalDescription: text("legal_description"),
  county: text("county").notNull(),
  state: text("state").notNull(),
  address: text("address"),
  city: text("city"),
  zip: text("zip"),
  subdivision: text("subdivision"),
  lotNumber: text("lot_number"),
  
  // Size & Characteristics
  sizeAcres: numeric("size_acres").notNull(),
  zoning: text("zoning"),
  terrain: text("terrain"), // flat, rolling, mountainous
  roadAccess: text("road_access"), // paved, gravel, dirt, none
  utilities: jsonb("utilities").$type<{
    electric?: boolean;
    water?: boolean;
    sewer?: boolean;
    gas?: boolean;
  }>(),
  
  // Status & Pipeline
  status: text("status").notNull().default("prospect"), 
  // prospect, due_diligence, offer_sent, under_contract, owned, listed, sold
  
  // Financial
  assessedValue: numeric("assessed_value"),
  marketValue: numeric("market_value"),
  purchasePrice: numeric("purchase_price"),
  purchaseDate: timestamp("purchase_date"),
  listPrice: numeric("list_price"),
  soldPrice: numeric("sold_price"),
  soldDate: timestamp("sold_date"),
  
  // Seller info (if applicable)
  sellerId: integer("seller_id").references(() => leads.id),
  buyerId: integer("buyer_id").references(() => leads.id),
  
  // Due diligence
  dueDiligenceStatus: text("due_diligence_status").default("pending"),
  dueDiligenceData: jsonb("due_diligence_data").$type<{
    titleClear?: boolean;
    noLiens?: boolean;
    noEnvironmentalIssues?: boolean;
    accessVerified?: boolean;
    taxesCurrent?: boolean;
    checklistCompleted?: boolean;
    notes?: string;
  }>(),
  
  // Marketing
  description: text("description"),
  highlights: jsonb("highlights").$type<string[]>(),
  photos: jsonb("photos").$type<string[]>(),
  virtualTourUrl: text("virtual_tour_url"),
  
  // GPS coordinates
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  
  // Parcel boundary data (GeoJSON polygon from Regrid)
  parcelBoundary: jsonb("parcel_boundary").$type<{
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  }>(),
  parcelCentroid: jsonb("parcel_centroid").$type<{
    lat: number;
    lng: number;
  }>(),
  parcelData: jsonb("parcel_data").$type<{
    regridId?: string;
    owner?: string;
    ownerAddress?: string;
    taxAmount?: string;
    lastUpdated?: string;
  }>(),
  
  // Enrichment data (from PropertyEnrichmentService - free public data sources)
  enrichmentData: jsonb("enrichment_data"),
  enrichmentStatus: text("enrichment_status"), // pending, processing, complete, failed
  enrichedAt: timestamp("enriched_at"),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("properties_org_idx").on(table.organizationId),
  index("properties_status_idx").on(table.status),
  index("properties_apn_idx").on(table.apn),
  index("properties_created_at_idx").on(table.createdAt),
]);

// Deals/Transactions (acquisition or disposition)
export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  type: text("type").notNull(), // acquisition, disposition
  status: text("status").notNull().default("negotiating"),
  // negotiating, offer_sent, countered, accepted, in_escrow, closed, cancelled
  
  // Offer details
  offerAmount: numeric("offer_amount"),
  offerDate: timestamp("offer_date"),
  counterAmount: numeric("counter_amount"),
  acceptedAmount: numeric("accepted_amount"),
  
  // Closing details
  closingDate: timestamp("closing_date"),
  closingCosts: numeric("closing_costs"),
  titleCompany: text("title_company"),
  escrowNumber: text("escrow_number"),
  
  // Documents
  documents: jsonb("documents").$type<{
    name: string;
    url: string;
    type: string;
    uploadedAt: string;
  }[]>(),
  
  // ROI Analysis Results
  analysisResults: jsonb("analysis_results").$type<{
    purchasePrice: number;
    downPayment: number;
    financedAmount: number;
    interestRate: number;
    holdingCostsMonthly: number;
    holdingPeriodMonths: number;
    improvementCosts: number;
    expectedSalePrice: number;
    totalInvestment: number;
    totalCost: number;
    grossProfit: number;
    netProfit: number;
    roiPercent: number;
    annualizedRoi: number;
    cashOnCashReturn: number;
    calculatedAt: string;
  }>(),
  
  // Property enrichment data (flood zones, hazards, demographics, etc.)
  enrichmentData: jsonb("enrichment_data").$type<{
    enrichedAt?: string;
    lookupTimeMs?: number;
    hazards?: {
      floodZone?: string;
      floodRisk?: "low" | "medium" | "high";
      wetlandsPresent?: boolean;
      wetlandsPercentage?: number;
      earthquakeRisk?: "low" | "medium" | "high";
      wildfireRisk?: "low" | "medium" | "high";
      overallRiskScore?: number;
      overallRiskLevel?: "low" | "medium" | "high";
    };
    environment?: {
      soilType?: string;
      soilSuitability?: string;
      epaFacilitiesNearby?: number;
      epaRiskLevel?: "low" | "medium" | "high";
    };
    infrastructure?: {
      nearestHospitalMiles?: number;
      nearestFireStationMiles?: number;
      nearestSchoolMiles?: number;
      accessScore?: number;
    };
    demographics?: {
      population?: number;
      medianIncome?: number;
      medianHomeValue?: number;
    };
    scores?: {
      investmentScore?: number;
      developmentScore?: number;
      riskScore?: number;
      overallScore?: number;
    };
    errors?: Record<string, string>;
  }>(),
  enrichmentStatus: text("enrichment_status"), // pending, completed, failed
  enrichedAt: timestamp("enriched_at"),
  
  notes: text("notes"),
  assignedTo: integer("assigned_to"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("deals_org_idx").on(table.organizationId),
  index("deals_status_idx").on(table.status),
  index("deals_created_at_idx").on(table.createdAt),
]);

// ============================================
// FINANCE: NOTES & PAYMENTS
// ============================================

// Seller-financed notes
export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  borrowerId: integer("borrower_id").references(() => leads.id),
  
  // Note terms
  originalPrincipal: numeric("original_principal").notNull(),
  currentBalance: numeric("current_balance").notNull(),
  interestRate: numeric("interest_rate").notNull(), // Annual percentage
  termMonths: integer("term_months").notNull(),
  monthlyPayment: numeric("monthly_payment").notNull(),
  
  // Additional fees
  serviceFee: numeric("service_fee").default("0"), // Monthly note servicing fee
  lateFee: numeric("late_fee").default("0"),
  gracePeriodDays: integer("grace_period_days").default(10),

  // Property Tax Escrow (GeekPay parity)
  // Collects pro-rated property taxes monthly from borrower alongside loan payment
  taxEscrowEnabled: boolean("tax_escrow_enabled").default(false),
  annualPropertyTax: numeric("annual_property_tax").default("0"), // Annual tax amount for this property
  monthlyTaxEscrow: numeric("monthly_tax_escrow").default("0"), // = annualPropertyTax / 12
  taxEscrowBalance: numeric("tax_escrow_balance").default("0"), // Accumulated escrow balance
  taxEscrowAccountId: text("tax_escrow_account_id"), // Reference to escrow account
  lastTaxPaymentDate: timestamp("last_tax_payment_date"), // Last time taxes were paid from escrow
  nextTaxDueDate: timestamp("next_tax_due_date"), // Next county tax due date
  taxPaymentYear: integer("tax_payment_year"), // Tax year currently being escrowed
  countyTaxPortalUrl: text("county_tax_portal_url"), // Direct link to county payment portal
  
  // Dates
  startDate: timestamp("start_date").notNull(),
  firstPaymentDate: timestamp("first_payment_date").notNull(),
  nextPaymentDate: timestamp("next_payment_date"),
  maturityDate: timestamp("maturity_date"),
  
  // Status
  status: text("status").notNull().default("active"), 
  // pending, active, paid_off, defaulted, foreclosed
  
  // Down payment tracking
  downPayment: numeric("down_payment").default("0"),
  downPaymentReceived: boolean("down_payment_received").default(false),
  
  // Payment method info (for automation)
  paymentMethod: text("payment_method"), // ach_actum, ach_authorize, card_stripe, card_authorize, manual
  paymentAccountId: text("payment_account_id"), // Reference to stored payment method (primary)
  autoPayEnabled: boolean("auto_pay_enabled").default(false),

  // Fallback payment cascade (GeekPay parity)
  // If primary payment fails, system tries fallback accounts in order
  fallbackPaymentAccounts: jsonb("fallback_payment_accounts").$type<{
    profileId: string;
    method: "ach_actum" | "ach_authorize" | "card_stripe" | "card_authorize";
    last4?: string;
    bankName?: string;
    order: number; // 1 = first fallback, 2 = second, etc.
    isActive: boolean;
  }[]>(),
  
  // Amortization schedule stored as JSON
  amortizationSchedule: jsonb("amortization_schedule").$type<{
    paymentNumber: number;
    dueDate: string;
    payment: number;
    principal: number;
    interest: number;
    balance: number;
    status: string; // pending, paid, late, missed
  }[]>(),
  
  // Portal access token for borrowers
  accessToken: text("access_token").unique(),
  
  // Pending checkout session ID for webhook verification
  pendingCheckoutSessionId: text("pending_checkout_session_id"),
  
  // Delinquency tracking
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  reminderCount: integer("reminder_count").default(0),
  daysDelinquent: integer("days_delinquent").default(0),
  delinquencyStatus: text("delinquency_status").default("current"), // current, early_delinquent, delinquent, seriously_delinquent, default_candidate
  
  notes: text("notes_text"), // Renamed to avoid conflict with table name
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("notes_org_idx").on(table.organizationId),
  index("notes_status_idx").on(table.status),
  index("notes_borrower_idx").on(table.borrowerId),
]);

// Payment transactions
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  
  // Payment details
  amount: numeric("amount").notNull(),
  principalAmount: numeric("principal_amount").notNull(),
  interestAmount: numeric("interest_amount").notNull(),
  feeAmount: numeric("fee_amount").default("0"),
  lateFeeAmount: numeric("late_fee_amount").default("0"),
  
  // Payment info
  paymentDate: timestamp("payment_date").notNull(),
  dueDate: timestamp("due_date").notNull(),
  paymentMethod: text("payment_method"), // ach, card, check, cash
  transactionId: text("transaction_id"), // External processor transaction ID
  
  // Status
  status: text("status").notNull().default("pending"),
  // pending, processing, completed, failed, refunded
  
  failureReason: text("failure_reason"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("payments_note_idx").on(table.noteId),
  index("payments_status_idx").on(table.status),
  index("payments_due_date_idx").on(table.dueDate),
]);

// Property tax escrow payments — tracks actual county tax payments made from escrow
export const taxEscrowPayments = pgTable("tax_escrow_payments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),

  taxYear: integer("tax_year").notNull(),
  installment: text("installment").default("annual"), // annual, first_half, second_half, quarterly
  amountPaid: numeric("amount_paid").notNull(),
  escrowBalanceUsed: numeric("escrow_balance_used").notNull(),
  shortfall: numeric("shortfall").default("0"), // if escrow insufficient
  excessRefunded: numeric("excess_refunded").default("0"),

  paymentDate: timestamp("payment_date").notNull(),
  countyConfirmationNumber: text("county_confirmation_number"),
  paymentMethod: text("payment_method").default("manual"), // manual, portal, check
  countyTaxPortalUrl: text("county_tax_portal_url"),

  notes: text("notes"),
  receiptUrl: text("receipt_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTaxEscrowPaymentSchema = createInsertSchema(taxEscrowPayments).omit({ id: true, createdAt: true });
export type InsertTaxEscrowPayment = z.infer<typeof insertTaxEscrowPaymentSchema>;
export type TaxEscrowPayment = typeof taxEscrowPayments.$inferSelect;

// Payment reminders for automated delinquency management
export const paymentReminders = pgTable("payment_reminders", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  borrowerId: integer("borrower_id").references(() => leads.id),
  
  // Reminder type and timing
  type: text("type").notNull(), // upcoming, due, late, final_warning
  scheduledFor: timestamp("scheduled_for").notNull(),
  sentAt: timestamp("sent_at"),
  
  // Delivery settings
  channel: text("channel").notNull().default("email"), // email, sms, both
  content: text("content"), // Generated message content
  
  // Status tracking
  status: text("status").notNull().default("scheduled"), // scheduled, sent, failed, cancelled
  failureReason: text("failure_reason"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaymentReminderSchema = createInsertSchema(paymentReminders).omit({ id: true, createdAt: true });
export type InsertPaymentReminder = z.infer<typeof insertPaymentReminderSchema>;
export type PaymentReminder = typeof paymentReminders.$inferSelect;

// ============================================
// MARKETING CAMPAIGNS
// ============================================

// Marketing campaigns (direct mail, email, SMS)
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // direct_mail, email, sms, multi_channel
  status: text("status").notNull().default("draft"), // draft, scheduled, active, paused, completed
  
  // Unique tracking code for attribution (e.g., "CAMP-ABC123")
  trackingCode: text("tracking_code").unique(),
  
  // Target audience
  targetCriteria: jsonb("target_criteria").$type<{
    states?: string[];
    counties?: string[];
    leadStatus?: string[];
    leadType?: string[];
    tags?: string[];
  }>(),
  
  // Content
  subject: text("subject"),
  content: text("content"),
  templateId: text("template_id"),
  
  // Schedule
  scheduledDate: timestamp("scheduled_date"),
  completedDate: timestamp("completed_date"),
  
  // Metrics
  totalSent: integer("total_sent").default(0),
  totalDelivered: integer("total_delivered").default(0),
  totalOpened: integer("total_opened").default(0),
  totalClicked: integer("total_clicked").default(0),
  totalResponded: integer("total_responded").default(0),
  
  budget: numeric("budget"),
  spent: numeric("spent").default("0"),
  
  // Optimization tracking
  lastOptimizedAt: timestamp("last_optimized_at"),
  optimizationScore: integer("optimization_score"), // 0-100
  
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaigns_org_idx").on(table.organizationId),
  index("campaigns_status_idx").on(table.status),
]);

// Campaign optimizations (AI-powered suggestions)
export const campaignOptimizations = pgTable("campaign_optimizations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  campaignId: integer("campaign_id").references(() => campaigns.id).notNull(),
  
  type: text("type").notNull(), // content, timing, audience, budget
  suggestion: text("suggestion").notNull(),
  reasoning: text("reasoning").notNull(),
  priority: text("priority").notNull().default("medium"), // high, medium, low
  
  implemented: boolean("implemented").default(false),
  implementedAt: timestamp("implemented_at"),
  resultDelta: jsonb("result_delta").$type<{
    before?: {
      openRate?: number;
      clickRate?: number;
      responseRate?: number;
      costPerResponse?: number;
    };
    after?: {
      openRate?: number;
      clickRate?: number;
      responseRate?: number;
      costPerResponse?: number;
    };
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCampaignOptimizationSchema = createInsertSchema(campaignOptimizations).omit({ id: true, createdAt: true });
export type InsertCampaignOptimization = z.infer<typeof insertCampaignOptimizationSchema>;
export type CampaignOptimization = typeof campaignOptimizations.$inferSelect;

// Campaign responses (inbound responses for attribution tracking)
export const campaignResponses = pgTable("campaign_responses", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  
  // Response details
  channel: text("channel").notNull(), // call, text, email, webform
  responseDate: timestamp("response_date").notNull().defaultNow(),
  content: text("content"), // Message content or call notes
  
  // Attribution tracking
  trackingCode: text("tracking_code"), // The tracking code provided by the responder
  isAttributed: boolean("is_attributed").default(false), // Whether we successfully linked to a campaign
  
  // Contact info if no existing lead
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  
  // Metadata
  metadata: jsonb("metadata").$type<{
    callDuration?: number;
    sentiment?: string;
    followUpRequired?: boolean;
    notes?: string;
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCampaignResponseSchema = createInsertSchema(campaignResponses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampaignResponse = z.infer<typeof insertCampaignResponseSchema>;
export type CampaignResponse = typeof campaignResponses.$inferSelect;

// ============================================
// AI AGENTS & AUTOMATION
// ============================================

// AI Agent configurations
export const agentConfigs = pgTable("agent_configs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentType: text("agent_type").notNull(), 
  // due_diligence, marketing_writer, buyer_communicator, offer_generator, research
  
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  
  // Configuration
  config: jsonb("config").$type<{
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    channels?: string[]; // For buyer_communicator: email, sms, facebook, etc.
    autoReply?: boolean;
    workingHours?: { start: string; end: string };
    responseTemplates?: { trigger: string; response: string }[];
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI Agent tasks/jobs
export const agentTasks = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentConfigId: integer("agent_config_id").references(() => agentConfigs.id),
  agentType: text("agent_type").notNull(),
  
  // Task details
  status: text("status").notNull().default("pending"), 
  // pending, queued, processing, completed, failed, cancelled
  priority: integer("priority").default(5), // 1-10, lower is higher priority
  
  // Input/Output
  input: jsonb("input").notNull(),
  output: jsonb("output"),
  error: text("error"),
  
  // Related entities
  relatedLeadId: integer("related_lead_id").references(() => leads.id),
  relatedPropertyId: integer("related_property_id").references(() => properties.id),
  relatedDealId: integer("related_deal_id").references(() => deals.id),
  
  // Execution
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  executionTimeMs: integer("execution_time_ms"),
  
  // Human review
  requiresReview: boolean("requires_review").default(false),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("agent_tasks_org_idx").on(table.organizationId),
  index("agent_tasks_status_idx").on(table.status),
  index("agent_tasks_created_at_idx").on(table.createdAt),
]);

// Background Agent Runs (tracking status of automated agents)
export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  agentName: text("agent_name").notNull().unique(), // lead_nurturer, campaign_optimizer, finance_agent, sequence_processor, alerting_service, digest_service
  status: text("status").notNull().default("idle"), // idle, running, completed, failed
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  processedCount: integer("processed_count").default(0),
  errorCount: integer("error_count").default(0),
  lastError: text("last_error"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
});

// Agent Memory - stores learned patterns, facts, and preferences
export const agentMemory = pgTable("agent_memory", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentType: text("agent_type").notNull(), // research, deals, communications, operations
  memoryType: text("memory_type").notNull(), // fact, preference, success_pattern, failure_pattern
  key: text("key").notNull(), // unique identifier for the memory
  value: jsonb("value").$type<Record<string, any>>().notNull(), // the actual memory data
  confidence: numeric("confidence").default("0.5"), // 0-1 confidence score
  usageCount: integer("usage_count").default(0), // how often this memory has been used
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentMemorySchema = createInsertSchema(agentMemory).omit({
  id: true,
  createdAt: true,
  usageCount: true,
  lastUsedAt: true,
});
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemory = typeof agentMemory.$inferSelect;

// Agent Feedback - user ratings and feedback on agent task outputs
export const agentFeedback = pgTable("agent_feedback", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentTaskId: integer("agent_task_id").references(() => agentTasks.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID
  rating: integer("rating").notNull(), // 1-5 star rating
  helpful: boolean("helpful").notNull(), // was the output helpful?
  feedback: text("feedback"), // optional text feedback
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentFeedbackSchema = createInsertSchema(agentFeedback).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentFeedback = z.infer<typeof insertAgentFeedbackSchema>;
export type AgentFeedback = typeof agentFeedback.$inferSelect;

// ============================================
// MULTI-AGENT ORCHESTRATION
// ============================================

// Agent Sessions - Multi-agent collaboration sessions
export const agentSessions = pgTable("agent_sessions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  sessionType: text("session_type").notNull(), // due_diligence_pod, acquisition_research, deal_analysis, etc.
  status: text("status").notNull().default("active"), // active, completed, failed, cancelled
  
  // Shared context that all agents in this session can access
  sharedContext: jsonb("shared_context").$type<{
    targetEntity?: { type: string; id: number };
    inputs?: Record<string, any>;
    intermediateResults?: Record<string, any>;
    decisions?: Array<{ agentType: string; decision: string; reasoning: string; timestamp: string }>;
  }>().default({}),
  
  // Session configuration
  config: jsonb("config").$type<{
    maxSteps?: number;
    timeout?: number;
    requireHumanApproval?: string[];
    participatingAgents?: string[];
  }>(),
  
  // Tracking
  initiatedBy: text("initiated_by"), // user ID or 'system'
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentSessionSchema = createInsertSchema(agentSessions).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});
export type InsertAgentSession = z.infer<typeof insertAgentSessionSchema>;
export type AgentSession = typeof agentSessions.$inferSelect;

// Agent Session Steps - Steps within a multi-agent session
export const agentSessionSteps = pgTable("agent_session_steps", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => agentSessions.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  stepNumber: integer("step_number").notNull(),
  agentType: text("agent_type").notNull(),
  skillUsed: text("skill_used"),
  
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, skipped
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  
  // Execution tracking
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  executionTimeMs: integer("execution_time_ms"),
  
  // Dependencies
  dependsOnSteps: integer("depends_on_steps").array(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentSessionStepSchema = createInsertSchema(agentSessionSteps).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  executionTimeMs: true,
});
export type InsertAgentSessionStep = z.infer<typeof insertAgentSessionStepSchema>;
export type AgentSessionStep = typeof agentSessionSteps.$inferSelect;

// Event Subscriptions - Agent event subscriptions
export const eventSubscriptions = pgTable("event_subscriptions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  subscriberType: text("subscriber_type").notNull(), // agent, workflow, webhook
  subscriberId: text("subscriber_id").notNull(), // agent type or workflow ID
  
  eventType: text("event_type").notNull(), // property_value_change, lead_created, deadline_approaching, market_shift, etc.
  eventFilter: jsonb("event_filter").$type<{
    entityType?: string;
    entityId?: number;
    conditions?: Record<string, any>;
  }>(),
  
  isActive: boolean("is_active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEventSubscriptionSchema = createInsertSchema(eventSubscriptions).omit({
  id: true,
  createdAt: true,
  lastTriggeredAt: true,
  triggerCount: true,
});
export type InsertEventSubscription = z.infer<typeof insertEventSubscriptionSchema>;
export type EventSubscription = typeof eventSubscriptions.$inferSelect;

// Agent Events - Event log for agent system
export const agentEvents = pgTable("agent_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  eventType: text("event_type").notNull(),
  eventSource: text("event_source").notNull(), // system, user, agent, external
  
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  
  // Related entities
  relatedEntityType: text("related_entity_type"), // lead, property, deal, etc.
  relatedEntityId: integer("related_entity_id"),
  
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentEventSchema = createInsertSchema(agentEvents).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});
export type InsertAgentEvent = z.infer<typeof insertAgentEventSchema>;
export type AgentEvent = typeof agentEvents.$inferSelect;

// Outcome Telemetry - Track outcomes for AI learning
export const outcomeTelemetry = pgTable("outcome_telemetry", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  outcomeType: text("outcome_type").notNull(), // deal_won, deal_lost, lead_converted, offer_accepted, etc.
  
  // What happened
  outcome: jsonb("outcome").$type<{
    success: boolean;
    value?: number;
    details?: Record<string, any>;
  }>().notNull(),
  
  // What led to this outcome (for learning)
  contributingFactors: jsonb("contributing_factors").$type<{
    agentActions?: Array<{ agentType: string; action: string; timestamp: string }>;
    messagesSent?: number;
    offerAmount?: number;
    responseTime?: number;
    sequenceUsed?: string;
    marketConditions?: Record<string, any>;
  }>(),
  
  // Related entities
  relatedLeadId: integer("related_lead_id").references(() => leads.id),
  relatedPropertyId: integer("related_property_id").references(() => properties.id),
  relatedDealId: integer("related_deal_id").references(() => deals.id),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOutcomeTelemetrySchema = createInsertSchema(outcomeTelemetry).omit({
  id: true,
  createdAt: true,
});
export type InsertOutcomeTelemetry = z.infer<typeof insertOutcomeTelemetrySchema>;
export type OutcomeTelemetry = typeof outcomeTelemetry.$inferSelect;

// Conversations (for buyer communication agent)
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  
  channel: text("channel").notNull(), // email, sms, facebook, whatsapp
  externalId: text("external_id"), // External thread/conversation ID
  
  status: text("status").notNull().default("active"), // active, closed, escalated
  assignedAgentId: integer("assigned_agent_id").references(() => agentConfigs.id),
  assignedHumanId: integer("assigned_human_id").references(() => teamMembers.id),
  
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Messages within conversations
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  direction: text("direction").notNull(), // inbound, outbound
  sender: text("sender").notNull(), // lead, agent, human
  content: text("content").notNull(),
  
  // For AI-generated messages
  generatedByAgent: boolean("generated_by_agent").default(false),
  agentTaskId: integer("agent_task_id").references(() => agentTasks.id),
  
  // Delivery status
  status: text("status").notNull().default("sent"), // pending, sent, delivered, read, failed
  externalId: text("external_id"),
  
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// ACTIVITY LOG & AUDIT
// ============================================

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Who/What
  userId: text("user_id"),
  teamMemberId: integer("team_member_id").references(() => teamMembers.id),
  agentType: text("agent_type"),
  
  // Action
  action: text("action").notNull(), // created, updated, deleted, status_changed, etc.
  entityType: text("entity_type").notNull(), // lead, property, note, payment, etc.
  entityId: integer("entity_id").notNull(),
  
  // Details
  description: text("description"),
  changes: jsonb("changes"), // { field: { old: value, new: value } }
  metadata: jsonb("metadata"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// USAGE & BILLING
// ============================================

export const usageEvents = pgTable("usage_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  eventType: text("event_type").notNull(), // ai_request, sms_sent, email_sent, etc.
  quantity: integer("quantity").notNull().default(1),
  
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Usage Records - tracks billable actions
export const usageRecords = pgTable("usage_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  actionType: text("action_type").notNull(), // email_sent, sms_sent, ai_chat, ai_image, pdf_generated, comps_query, direct_mail
  quantity: integer("quantity").notNull().default(1),
  unitCostCents: integer("unit_cost_cents").notNull(), // cost per unit in cents
  totalCostCents: integer("total_cost_cents").notNull(), // quantity * unitCostCents
  metadata: jsonb("metadata").$type<{
    campaignId?: number;
    recipientEmail?: string;
    recipientPhone?: string;
    documentType?: string;
    aiModel?: string;
    propertyId?: number;
    [key: string]: unknown;
  }>(),
  billingMonth: text("billing_month").notNull(), // Format: "2025-01"
  createdAt: timestamp("created_at").defaultNow(),
});

// Credit Transactions - tracks credit purchases/debits
export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  type: text("type").notNull(), // purchase, debit, refund, bonus, monthly_allowance
  amountCents: integer("amount_cents").notNull(), // positive for credits, negative for debits
  balanceAfterCents: integer("balance_after_cents").notNull(),
  description: text("description").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"), // for purchases
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  metadata: jsonb("metadata").$type<{
    creditPackId?: string;
    usageRecordIds?: number[];
    [key: string]: unknown;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Usage Rates - configurable pricing per action type
export const usageRates = pgTable("usage_rates", {
  id: serial("id").primaryKey(),
  actionType: text("action_type").notNull().unique(), // email_sent, sms_sent, ai_chat, etc.
  displayName: text("display_name").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(), // cost per action in cents
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================
// AI COMMAND CENTER
// ============================================

// AI Agent Profiles - predefined specialist agents
export const aiAgentProfiles = pgTable("ai_agent_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // "Alex", "Uma", "Maya", etc.
  role: text("role").notNull(), // "acquisitions", "underwriting", "marketing", "research", "documents"
  displayName: text("display_name").notNull(), // "Acquisitions Specialist"
  description: text("description").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  capabilities: text("capabilities").array().notNull(), // ["analyze_leads", "score_opportunities"]
  icon: text("icon").notNull(), // lucide icon name
  isActive: boolean("is_active").default(true),
});

// AI Tool Definitions - available tools for agents
export const aiToolDefinitions = pgTable("ai_tool_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // "get_leads", "create_note"
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // "crm", "finance", "marketing", "research"
  parameters: jsonb("parameters").notNull(), // JSON schema for parameters
  requiresApproval: boolean("requires_approval").default(false), // high-risk actions
  agentRoles: text("agent_roles").array(), // which agents can use this tool
});

// AI Execution Runs - tracks agent task executions
export const aiExecutionRuns = pgTable("ai_execution_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  conversationId: integer("conversation_id"),
  agentRole: text("agent_role").notNull(),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, requires_approval
  input: jsonb("input").notNull(),
  output: jsonb("output"),
  toolCalls: jsonb("tool_calls"), // array of tool calls made
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  error: text("error"),
});

// AI Memory/Context - stores important facts and preferences
export const aiMemory = pgTable("ai_memory", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  memoryType: text("memory_type").notNull(), // "fact", "preference", "procedure"
  content: text("content").notNull(),
  source: text("source"), // where this memory came from
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// AI Conversations - chat history with AI agents
export const aiConversations = pgTable("ai_conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  agentRole: text("agent_role").notNull().default("executive"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI Messages - individual messages in conversations
export const aiMessages = pgTable("ai_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // user, assistant, system
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls").$type<any[]>(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// AI VIRTUAL ASSISTANTS (Enhanced Agent System)
// ============================================

// VA Agent Registry - tracks each VA employee with their settings
export const vaAgents = pgTable("va_agents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentType: text("agent_type").notNull(), 
  // executive, sales, acquisitions, marketing, collections, research
  name: text("name").notNull(),
  avatar: text("avatar"), // URL or lucide icon name
  description: text("description"),
  
  // Status & Activity
  isEnabled: boolean("is_enabled").notNull().default(true),
  isActive: boolean("is_active").notNull().default(false), // currently processing something
  lastActiveAt: timestamp("last_active_at"),
  
  // Behavior Settings
  autonomyLevel: text("autonomy_level").notNull().default("supervised"),
  // full_auto: takes action without asking
  // supervised: proposes actions, waits for approval on important ones
  // manual: only acts when explicitly asked
  
  // Agent-specific configuration
  config: jsonb("config").$type<{
    systemPrompt?: string;
    workingHours?: { start: string; end: string; timezone: string };
    responseDelay?: number; // minutes to wait before auto-responding
    maxActionsPerDay?: number;
    notifyOnAction?: boolean;
    autoApproveCategories?: string[]; // action categories that don't need approval
    escalateToHuman?: string[]; // triggers that should escalate to human
    customInstructions?: string;
  }>(),
  
  // Performance metrics
  metrics: jsonb("metrics").$type<{
    totalActions: number;
    successfulActions: number;
    pendingApproval: number;
    lastDayActions: number;
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// VA Action Queue - tracks all proposed and completed actions
export const vaActions = pgTable("va_actions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentId: integer("agent_id").references(() => vaAgents.id).notNull(),
  
  // Action details
  actionType: text("action_type").notNull(),
  // Common actions: send_email, send_sms, update_lead, create_offer, 
  // schedule_callback, propose_campaign, record_payment, send_reminder, etc.
  category: text("category").notNull(),
  // crm, marketing, finance, communication, research, admin
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Status tracking
  status: text("status").notNull().default("proposed"),
  // proposed: waiting for approval
  // approved: ready to execute
  // executing: currently running
  // completed: successfully finished
  // failed: execution failed
  // rejected: user rejected the action
  // cancelled: cancelled before execution
  
  priority: integer("priority").notNull().default(5), // 1=urgent, 5=normal, 10=low
  
  // Action payload
  input: jsonb("input").notNull(), // parameters for the action
  output: jsonb("output"), // result of execution
  error: text("error"),
  
  // Related entities
  relatedLeadId: integer("related_lead_id").references(() => leads.id),
  relatedPropertyId: integer("related_property_id").references(() => properties.id),
  relatedNoteId: integer("related_note_id").references(() => notes.id),
  relatedCampaignId: integer("related_campaign_id").references(() => campaigns.id),
  
  // Approval tracking
  requiresApproval: boolean("requires_approval").notNull().default(true),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  
  // Timing
  scheduledFor: timestamp("scheduled_for"), // when to execute (for scheduled actions)
  executedAt: timestamp("executed_at"),
  executionTimeMs: integer("execution_time_ms"),
  
  // Context
  reasoning: text("reasoning"), // AI's explanation for why this action
  confidence: numeric("confidence"), // 0-100 confidence score
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// VA Daily Briefings - generated summaries and insights
export const vaBriefings = pgTable("va_briefings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  briefingType: text("briefing_type").notNull(), // daily, weekly, monthly, alert
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  
  // Sections of the briefing
  sections: jsonb("sections").$type<{
    title: string;
    content: string;
    priority: number;
    actionItems?: { text: string; actionId?: number }[];
  }[]>(),
  
  // Key metrics snapshot
  metrics: jsonb("metrics").$type<{
    newLeads: number;
    activeDeals: number;
    paymentsReceived: number;
    overduePayments: number;
    pendingActions: number;
    campaignsActive: number;
  }>(),
  
  // Recommended actions
  recommendations: jsonb("recommendations").$type<{
    text: string;
    priority: number;
    agentType: string;
    actionType?: string;
  }[]>(),
  
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// VA Calendar Events - scheduled tasks and reminders
export const vaCalendarEvents = pgTable("va_calendar_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentId: integer("agent_id").references(() => vaAgents.id),
  
  eventType: text("event_type").notNull(),
  // callback, follow_up, campaign_launch, payment_due, task_deadline, review_needed
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Timing
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  allDay: boolean("all_day").default(false),
  
  // Recurrence
  recurring: boolean("recurring").default(false),
  recurrenceRule: text("recurrence_rule"), // iCal RRULE format
  
  // Related entities
  relatedLeadId: integer("related_lead_id").references(() => leads.id),
  relatedPropertyId: integer("related_property_id").references(() => properties.id),
  relatedActionId: integer("related_action_id").references(() => vaActions.id),
  
  // Status
  status: text("status").notNull().default("scheduled"),
  // scheduled, completed, cancelled, rescheduled
  completedAt: timestamp("completed_at"),
  
  // Notifications
  reminderMinutes: integer("reminder_minutes").default(30),
  reminded: boolean("reminded").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// VA Templates - reusable templates for common actions
export const vaTemplates = pgTable("va_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  category: text("category").notNull(), // email, sms, offer, campaign, document
  agentTypes: text("agent_types").array(), // which agents can use this template
  
  subject: text("subject"), // for emails
  content: text("content").notNull(),
  
  // Variables that can be substituted
  variables: jsonb("variables").$type<{
    name: string;
    description: string;
    defaultValue?: string;
  }[]>(),
  
  isActive: boolean("is_active").default(true),
  usageCount: integer("usage_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================
// VA REPLACEMENT ENGINE (Dirt Rich 2 Methodology)
// ============================================

// Marketing Lists - imported lead lists for mail campaigns
export const marketingLists = pgTable("marketing_lists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  source: text("source").notNull(), // datatree, propstream, county_records, custom
  status: text("status").notNull().default("pending"), // pending, processing, ready, scrubbed, archived
  
  totalRecords: integer("total_records").default(0),
  validRecords: integer("valid_records").default(0),
  duplicatesRemoved: integer("duplicates_removed").default(0),
  invalidAddresses: integer("invalid_addresses").default(0),
  
  filters: jsonb("filters").$type<{
    states?: string[];
    counties?: string[];
    acreageMin?: number;
    acreageMax?: number;
    priceMin?: number;
    priceMax?: number;
    zoning?: string[];
    ownerType?: string[]; // individual, llc, trust, estate
    yearsOwned?: number;
    taxDelinquent?: boolean;
  }>(),
  
  uploadedFileName: text("uploaded_file_name"),
  scrubSettings: jsonb("scrub_settings").$type<{
    removeDuplicates: boolean;
    validateAddresses: boolean;
    skipExistingLeads: boolean;
    enrichParcelData: boolean;
  }>(),
  
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Offer Batches - bulk offer generation with pricing matrix
export const offerBatches = pgTable("offer_batches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft, generating, ready, sent, archived
  
  // Pricing matrix
  pricingMatrix: jsonb("pricing_matrix").$type<{
    targetMargin: number; // e.g., 0.25 for 25% of market value
    minOfferAmount: number;
    maxOfferAmount: number;
    roundTo: number; // round to nearest $100, $500, $1000
    adjustments: {
      factor: string; // wetlands, flood_zone, road_access, utilities
      adjustment: number; // percentage to add/subtract
    }[];
  }>().notNull(),
  
  // Terms for seller financing offers
  termsConfig: jsonb("terms_config").$type<{
    downPaymentPercent: number;
    interestRate: number;
    termMonths: number;
    documentFee: number;
  }>(),
  
  // Source filters
  sourceListId: integer("source_list_id").references(() => marketingLists.id),
  leadFilters: jsonb("lead_filters").$type<{
    status?: string[];
    source?: string[];
    states?: string[];
    counties?: string[];
    acreageMin?: number;
    acreageMax?: number;
  }>(),
  
  totalOffers: integer("total_offers").default(0),
  offersGenerated: integer("offers_generated").default(0),
  offersSent: integer("offers_sent").default(0),
  offersAccepted: integer("offers_accepted").default(0),
  
  generatedAt: timestamp("generated_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Individual offers within a batch
export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  batchId: integer("batch_id").references(() => offerBatches.id),
  leadId: integer("lead_id").references(() => leads.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  status: text("status").notNull().default("draft"), // draft, approved, sent, viewed, accepted, rejected, expired, countered
  
  // Offer amounts
  cashOffer: numeric("cash_offer"),
  termsOffer: numeric("terms_offer"),
  downPayment: numeric("down_payment"),
  monthlyPayment: numeric("monthly_payment"),
  interestRate: numeric("interest_rate"),
  termMonths: integer("term_months"),
  
  // Calculated values
  estimatedMarketValue: numeric("estimated_market_value"),
  offerPercentage: numeric("offer_percentage"), // percentage of market value
  
  // Seller response
  counterOffer: numeric("counter_offer"),
  sellerNotes: text("seller_notes"),
  respondedAt: timestamp("responded_at"),
  
  // Tracking
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  expiresAt: timestamp("expires_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Seller Communications - track all seller interactions
export const sellerCommunications = pgTable("seller_communications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  offerId: integer("offer_id").references(() => offers.id),
  
  channel: text("channel").notNull(), // email, sms, call, mail, facebook
  direction: text("direction").notNull(), // inbound, outbound
  
  subject: text("subject"),
  content: text("content").notNull(),
  
  // For calls
  callDuration: integer("call_duration"), // seconds
  callNotes: text("call_notes"),
  callOutcome: text("call_outcome"), // interested, not_interested, callback, voicemail, wrong_number
  
  // For mail
  trackingNumber: text("tracking_number"),
  deliveryStatus: text("delivery_status"), // pending, sent, delivered, returned
  
  // Sentiment analysis
  sentiment: text("sentiment"), // positive, neutral, negative
  urgencyScore: integer("urgency_score"), // 1-10
  
  // AI-generated flag
  aiGenerated: boolean("ai_generated").default(false),
  aiAgentId: integer("ai_agent_id").references(() => vaAgents.id),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Ad Postings - multi-platform marketing ads
export const adPostings = pgTable("ad_postings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  platform: text("platform").notNull(), // facebook, craigslist, lands_of_america, land_watch, zillow, land_com
  status: text("status").notNull().default("draft"), // draft, scheduled, posted, active, expired, removed
  
  // Ad content
  title: text("title").notNull(),
  description: text("description").notNull(),
  headline: text("headline"),
  storyContent: text("story_content"), // Mark Podolsky story-style ad copy
  
  // Pricing
  listingPrice: numeric("listing_price").notNull(),
  termsPrice: numeric("terms_price"),
  downPayment: numeric("down_payment"),
  monthlyPayment: numeric("monthly_payment"),
  
  // Media
  imageUrls: text("image_urls").array(),
  videoUrl: text("video_url"),
  
  // Platform-specific
  externalListingId: text("external_listing_id"),
  externalUrl: text("external_url"),
  
  // Performance
  views: integer("views").default(0),
  inquiries: integer("inquiries").default(0),
  clicks: integer("clicks").default(0),
  
  // AI-generated
  aiGenerated: boolean("ai_generated").default(false),
  
  postedAt: timestamp("posted_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Buyer Prequalifications - scoring and qualifying buyers
export const buyerPrequalifications = pgTable("buyer_prequalifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  
  status: text("status").notNull().default("pending"), // pending, qualified, disqualified, needs_info
  
  // Basic info
  intendedUse: text("intended_use"), // residential, recreation, investment, farming
  budgetMin: numeric("budget_min"),
  budgetMax: numeric("budget_max"),
  prefersCash: boolean("prefers_cash").default(false),
  prefersTerms: boolean("prefers_terms").default(false),
  
  // Financial qualification
  downPaymentAvailable: numeric("down_payment_available"),
  monthlyPaymentCapacity: numeric("monthly_payment_capacity"),
  employmentStatus: text("employment_status"), // employed, self_employed, retired, other
  creditRangeReported: text("credit_range_reported"), // excellent, good, fair, poor
  
  // Scoring
  qualificationScore: integer("qualification_score"), // 1-100
  scoreFactors: jsonb("score_factors").$type<{
    factor: string;
    score: number;
    notes: string;
  }[]>(),
  
  // Follow-up
  lastContactAt: timestamp("last_contact_at"),
  nextFollowUpAt: timestamp("next_follow_up_at"),
  followUpNotes: text("follow_up_notes"),
  
  // AI assessment
  aiAssessment: text("ai_assessment"),
  aiRecommendation: text("ai_recommendation"), // proceed, more_info, decline
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Collection Sequences - automated payment reminder sequences
export const collectionSequences = pgTable("collection_sequences", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  isDefault: boolean("is_default").default(false),
  
  // Sequence steps
  steps: jsonb("steps").$type<{
    stepNumber: number;
    daysAfterDue: number; // negative = before due, positive = after due
    channel: "email" | "sms" | "call" | "mail";
    templateId?: number;
    subject?: string;
    content?: string;
    escalationLevel: "reminder" | "warning" | "urgent" | "final";
  }[]>().notNull(),
  
  // Automation settings
  autoStart: boolean("auto_start").default(true), // automatically start sequence when payment becomes overdue
  pauseOnPayment: boolean("pause_on_payment").default(true),
  pauseOnContact: boolean("pause_on_contact").default(false),
  
  // Metrics
  totalEnrolled: integer("total_enrolled").default(0),
  paymentsRecovered: integer("payments_recovered").default(0),
  totalRecoveredAmount: numeric("total_recovered_amount").default("0"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Collection enrollments - notes enrolled in collection sequences
export const collectionEnrollments = pgTable("collection_enrollments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  sequenceId: integer("sequence_id").references(() => collectionSequences.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  paymentId: integer("payment_id"), // specific overdue payment if applicable
  
  status: text("status").notNull().default("active"), // active, paused, completed, cancelled
  currentStep: integer("current_step").default(0),
  
  // Tracking
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastStepAt: timestamp("last_step_at"),
  nextStepAt: timestamp("next_step_at"),
  completedAt: timestamp("completed_at"),
  
  // Outcome
  outcome: text("outcome"), // paid, partial_paid, no_response, escalated, cancelled
  amountRecovered: numeric("amount_recovered").default("0"),
  
  // History
  stepHistory: jsonb("step_history").$type<{
    step: number;
    executedAt: string;
    channel: string;
    result: string;
  }[]>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// County Research Cache - cached research results for counties
export const countyResearch = pgTable("county_research", {
  id: serial("id").primaryKey(),
  
  state: text("state").notNull(),
  county: text("county").notNull(),
  
  // Contact info
  assessorPhone: text("assessor_phone"),
  assessorEmail: text("assessor_email"),
  assessorWebsite: text("assessor_website"),
  recorderPhone: text("recorder_phone"),
  recorderEmail: text("recorder_email"),
  recorderWebsite: text("recorder_website"),
  treasurerPhone: text("treasurer_phone"),
  treasurerEmail: text("treasurer_email"),
  treasurerWebsite: text("treasurer_website"),
  
  // GIS info
  gisPortalUrl: text("gis_portal_url"),
  gisApiEndpoint: text("gis_api_endpoint"),
  hasOnlineMaps: boolean("has_online_maps").default(false),
  
  // Fees and processes
  transferTax: numeric("transfer_tax"),
  recordingFee: numeric("recording_fee"),
  titleSearchCost: numeric("title_search_cost"),
  closingProcess: text("closing_process"),
  
  // Market data
  medianLandPrice: numeric("median_land_price"),
  avgDaysOnMarket: integer("avg_days_on_market"),
  salesVolumeLast12Mo: integer("sales_volume_last_12mo"),
  
  // AI-gathered insights
  marketNotes: text("market_notes"),
  investorFriendly: boolean("investor_friendly"),
  competitionLevel: text("competition_level"), // low, medium, high
  
  // Freshness
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  dataSource: text("data_source"), // manual, ai_research, api
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas for VA Replacement Engine tables
export const insertMarketingListSchema = createInsertSchema(marketingLists).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOfferBatchSchema = createInsertSchema(offerBatches).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOfferSchema = createInsertSchema(offers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSellerCommunicationSchema = createInsertSchema(sellerCommunications).omit({ id: true, createdAt: true });
export const insertAdPostingSchema = createInsertSchema(adPostings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBuyerPrequalificationSchema = createInsertSchema(buyerPrequalifications).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCollectionSequenceSchema = createInsertSchema(collectionSequences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCollectionEnrollmentSchema = createInsertSchema(collectionEnrollments).omit({ id: true, createdAt: true });
export const insertCountyResearchSchema = createInsertSchema(countyResearch).omit({ id: true, createdAt: true });

// Type exports for VA Replacement Engine
export type MarketingList = typeof marketingLists.$inferSelect;
export type InsertMarketingList = z.infer<typeof insertMarketingListSchema>;

export type OfferBatch = typeof offerBatches.$inferSelect;
export type InsertOfferBatch = z.infer<typeof insertOfferBatchSchema>;

export type Offer = typeof offers.$inferSelect;
export type InsertOffer = z.infer<typeof insertOfferSchema>;

export type SellerCommunication = typeof sellerCommunications.$inferSelect;
export type InsertSellerCommunication = z.infer<typeof insertSellerCommunicationSchema>;

export type AdPosting = typeof adPostings.$inferSelect;
export type InsertAdPosting = z.infer<typeof insertAdPostingSchema>;

export type BuyerPrequalification = typeof buyerPrequalifications.$inferSelect;
export type InsertBuyerPrequalification = z.infer<typeof insertBuyerPrequalificationSchema>;

export type CollectionSequence = typeof collectionSequences.$inferSelect;
export type InsertCollectionSequence = z.infer<typeof insertCollectionSequenceSchema>;

export type CollectionEnrollment = typeof collectionEnrollments.$inferSelect;
export type InsertCollectionEnrollment = z.infer<typeof insertCollectionEnrollmentSchema>;

export type CountyResearch = typeof countyResearch.$inferSelect;
export type InsertCountyResearch = z.infer<typeof insertCountyResearchSchema>;

// ============================================
// RELATIONS
// ============================================

export const organizationsRelations = relations(organizations, ({ many }) => ({
  teamMembers: many(teamMembers),
  leads: many(leads),
  properties: many(properties),
  notes: many(notes),
  campaigns: many(campaigns),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [properties.organizationId],
    references: [organizations.id],
  }),
  seller: one(leads, {
    fields: [properties.sellerId],
    references: [leads.id],
  }),
  notes: many(notes),
  deals: many(deals),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [notes.organizationId],
    references: [organizations.id],
  }),
  property: one(properties, {
    fields: [notes.propertyId],
    references: [properties.id],
  }),
  borrower: one(leads, {
    fields: [notes.borrowerId],
    references: [leads.id],
  }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  note: one(notes, {
    fields: [payments.noteId],
    references: [notes.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [leads.organizationId],
    references: [organizations.id],
  }),
  activities: many(leadActivities),
  conversations: many(conversations),
}));

// ============================================
// INSERT SCHEMAS
// ============================================

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ 
  id: true, invitedAt: true, joinedAt: true 
});
export const insertLeadSchema = createInsertSchema(leads).omit({ 
  id: true, createdAt: true, updatedAt: true, lastScoreAt: true 
});
export const insertLeadActivitySchema = createInsertSchema(leadActivities).omit({ 
  id: true, createdAt: true 
});
export const insertPropertySchema = createInsertSchema(properties).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertDealSchema = createInsertSchema(deals).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertNoteSchema = createInsertSchema(notes).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertPaymentSchema = createInsertSchema(payments).omit({ 
  id: true, createdAt: true 
});
export const insertCampaignSchema = createInsertSchema(campaigns).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertAgentConfigSchema = createInsertSchema(agentConfigs).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({ 
  id: true, createdAt: true, startedAt: true, completedAt: true 
});
export const insertAgentRunSchema = createInsertSchema(agentRuns).omit({ 
  id: true 
});
export const insertConversationSchema = createInsertSchema(conversations).omit({ 
  id: true, createdAt: true 
});
export const insertMessageSchema = createInsertSchema(messages).omit({ 
  id: true, createdAt: true 
});

// Usage Metering & Credits
export const insertUsageRecordSchema = createInsertSchema(usageRecords).omit({ 
  id: true, createdAt: true 
});
export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({ 
  id: true, createdAt: true 
});
export const insertUsageRateSchema = createInsertSchema(usageRates).omit({ 
  id: true, updatedAt: true 
});

// AI Command Center
export const insertAiAgentProfileSchema = createInsertSchema(aiAgentProfiles).omit({ id: true });
export const insertAiToolDefinitionSchema = createInsertSchema(aiToolDefinitions).omit({ id: true });
export const insertAiExecutionRunSchema = createInsertSchema(aiExecutionRuns).omit({ id: true });
export const insertAiMemorySchema = createInsertSchema(aiMemory).omit({ id: true });

export const insertAiConversationSchema = createInsertSchema(aiConversations).omit({ id: true });
export const insertAiMessageSchema = createInsertSchema(aiMessages).omit({ id: true });

// VA (Virtual Assistant) System
export const insertVaAgentSchema = createInsertSchema(vaAgents).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertVaActionSchema = createInsertSchema(vaActions).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertVaBriefingSchema = createInsertSchema(vaBriefings).omit({ 
  id: true, createdAt: true 
});
export const insertVaCalendarEventSchema = createInsertSchema(vaCalendarEvents).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertVaTemplateSchema = createInsertSchema(vaTemplates).omit({ 
  id: true, createdAt: true, updatedAt: true 
});

// ============================================
// TYPE EXPORTS
// ============================================

// Organizations
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

// Team Members
export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;

// Leads
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

// Lead Activities
export type LeadActivity = typeof leadActivities.$inferSelect;
export type InsertLeadActivity = z.infer<typeof insertLeadActivitySchema>;

// Nurturing Stage Type
export type NurturingStage = "hot" | "warm" | "cold" | "dead" | "new";

// Properties
export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;

// Deals
export type Deal = typeof deals.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;

// Notes
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

// Payments
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

// Campaigns
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;

// Agent Configs
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type InsertAgentConfig = z.infer<typeof insertAgentConfigSchema>;

// Agent Tasks
export type AgentTask = typeof agentTasks.$inferSelect;
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;

// Agent Runs (background agent status)
export type AgentRun = typeof agentRuns.$inferSelect;
export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;

// Conversations
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;

// Messages
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// Activity Log
export type ActivityLogEntry = typeof activityLog.$inferSelect;

// Usage Events
export type UsageEvent = typeof usageEvents.$inferSelect;

// Usage Records
export type UsageRecord = typeof usageRecords.$inferSelect;
export type InsertUsageRecord = z.infer<typeof insertUsageRecordSchema>;

// Credit Transactions
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;

// Usage Rates
export type UsageRate = typeof usageRates.$inferSelect;
export type InsertUsageRate = z.infer<typeof insertUsageRateSchema>;

// AI Agent Profiles
export type AiAgentProfile = typeof aiAgentProfiles.$inferSelect;
export type InsertAiAgentProfile = z.infer<typeof insertAiAgentProfileSchema>;

// AI Tool Definitions
export type AiToolDefinition = typeof aiToolDefinitions.$inferSelect;
export type InsertAiToolDefinition = z.infer<typeof insertAiToolDefinitionSchema>;

// AI Execution Runs
export type AiExecutionRun = typeof aiExecutionRuns.$inferSelect;
export type InsertAiExecutionRun = z.infer<typeof insertAiExecutionRunSchema>;

// AI Memory
export type AiMemory = typeof aiMemory.$inferSelect;
export type InsertAiMemory = z.infer<typeof insertAiMemorySchema>;

export type AiConversation = typeof aiConversations.$inferSelect;
export type InsertAiConversation = z.infer<typeof insertAiConversationSchema>;

export type AiMessage = typeof aiMessages.$inferSelect;
export type InsertAiMessage = z.infer<typeof insertAiMessageSchema>;

// VA (Virtual Assistant) System
export type VaAgent = typeof vaAgents.$inferSelect;
export type InsertVaAgent = z.infer<typeof insertVaAgentSchema>;

export type VaAction = typeof vaActions.$inferSelect;
export type InsertVaAction = z.infer<typeof insertVaActionSchema>;

export type VaBriefing = typeof vaBriefings.$inferSelect;
export type InsertVaBriefing = z.infer<typeof insertVaBriefingSchema>;

export type VaCalendarEvent = typeof vaCalendarEvents.$inferSelect;
export type InsertVaCalendarEvent = z.infer<typeof insertVaCalendarEventSchema>;

export type VaTemplate = typeof vaTemplates.$inferSelect;
export type InsertVaTemplate = z.infer<typeof insertVaTemplateSchema>;

// VA Agent Types
export type VaAgentType = "executive" | "sales" | "acquisitions" | "marketing" | "collections" | "research";
export type VaAutonomyLevel = "full_auto" | "supervised" | "manual";
export type VaActionStatus = "proposed" | "approved" | "executing" | "completed" | "failed" | "rejected" | "cancelled";

// ============================================
// DUE DILIGENCE CHECKLISTS
// ============================================

// Checklist item type for templates
export type DueDiligenceChecklistItem = {
  id: string;
  category: string;
  name: string;
  description?: string;
  required: boolean;
};

// Due diligence templates
export const dueDiligenceTemplates = pgTable("due_diligence_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  items: jsonb("items").$type<DueDiligenceChecklistItem[]>().notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Due diligence items for tracking completion on individual properties
export const dueDiligenceItems = pgTable("due_diligence_items", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  templateId: integer("template_id").references(() => dueDiligenceTemplates.id),
  itemName: text("item_name").notNull(),
  category: text("category").notNull(),
  completed: boolean("completed").notNull().default(false),
  completedBy: text("completed_by"), // user ID who completed
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertDueDiligenceTemplateSchema = createInsertSchema(dueDiligenceTemplates).omit({ id: true, createdAt: true });
export const insertDueDiligenceItemSchema = createInsertSchema(dueDiligenceItems).omit({ id: true, createdAt: true });

// Types
export type DueDiligenceTemplate = typeof dueDiligenceTemplates.$inferSelect;
export type InsertDueDiligenceTemplate = z.infer<typeof insertDueDiligenceTemplateSchema>;
export type DueDiligenceItem = typeof dueDiligenceItems.$inferSelect;
export type InsertDueDiligenceItem = z.infer<typeof insertDueDiligenceItemSchema>;

// Default templates for land investment due diligence
export const DEFAULT_DUE_DILIGENCE_TEMPLATES = [
  {
    name: "Standard Land Due Diligence",
    items: [
      { id: "title-1", category: "Title Search", name: "Clear title verified", description: "Confirm property has clear title with no disputes", required: true },
      { id: "title-2", category: "Title Search", name: "No liens on property", description: "Check for any outstanding liens", required: true },
      { id: "title-3", category: "Title Search", name: "No encumbrances", description: "Verify no restrictive encumbrances", required: true },
      { id: "title-4", category: "Title Search", name: "Back taxes paid", description: "Confirm all property taxes are current", required: true },
      { id: "physical-1", category: "Physical", name: "Access road verified", description: "Legal access to property confirmed", required: true },
      { id: "physical-2", category: "Physical", name: "Utilities available", description: "Check availability of electric, water, sewer", required: false },
      { id: "physical-3", category: "Physical", name: "Topography assessed", description: "Evaluate terrain and buildability", required: false },
      { id: "physical-4", category: "Physical", name: "Flood zone check", description: "Verify FEMA flood zone status", required: true },
      { id: "physical-5", category: "Physical", name: "Environmental review", description: "Check for environmental issues or wetlands", required: true },
      { id: "legal-1", category: "Legal", name: "Zoning verified", description: "Confirm current zoning and allowed uses", required: true },
      { id: "legal-2", category: "Legal", name: "Restrictions reviewed", description: "Check deed restrictions and HOA rules", required: false },
      { id: "legal-3", category: "Legal", name: "Easements identified", description: "Locate and review all easements", required: true },
      { id: "legal-4", category: "Legal", name: "Mineral rights confirmed", description: "Verify mineral rights status", required: false },
      { id: "financial-1", category: "Financial", name: "Tax assessment reviewed", description: "Review current tax assessment value", required: true },
      { id: "financial-2", category: "Financial", name: "Market comps analyzed", description: "Compare to recent sales in area", required: true },
      { id: "financial-3", category: "Financial", name: "ROI calculation completed", description: "Calculate expected return on investment", required: false },
    ],
  },
] as const;

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
// USAGE ACTION TYPES & PRICING
// ============================================

export const USAGE_ACTION_TYPES = {
  email_sent: { name: "Email Sent", defaultCostCents: 1 }, // $0.01
  sms_sent: { name: "SMS Sent", defaultCostCents: 3 }, // $0.03
  ai_chat: { name: "AI Chat Request", defaultCostCents: 2 }, // $0.02
  ai_image: { name: "AI Image Generation", defaultCostCents: 25 }, // $0.25
  pdf_generated: { name: "PDF Document", defaultCostCents: 5 }, // $0.05
  comps_query: { name: "Comps Analysis", defaultCostCents: 10 }, // $0.10
  direct_mail: { name: "Direct Mail Piece", defaultCostCents: 75 }, // $0.75
} as const;

export type UsageActionType = keyof typeof USAGE_ACTION_TYPES;

// ============================================
// CREDIT PACKS
// ============================================

export const CREDIT_PACKS = {
  pack_10: { name: "$10 Credit Pack", amountCents: 1000, priceCents: 1000 },
  pack_25: { name: "$25 Credit Pack", amountCents: 2500, priceCents: 2500 },
  pack_50: { name: "$50 Credit Pack", amountCents: 5000, priceCents: 5000 },
  pack_100: { name: "$100 Credit Pack", amountCents: 10000, priceCents: 10000 },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

// ============================================
// SUBSCRIPTION TIERS CONFIGURATION
// ============================================

export const SUBSCRIPTION_TIERS = {
  free: {
    name: "Free",
    price: 0,
    tagline: "Explore the platform",
    limits: {
      leads: 50,
      properties: 10,
      notes: 5,
      teamMembers: 1,
      aiRequestsPerMonth: 100,
      campaigns: 1,
      monthlyCredits: 100, // $1.00
    },
    features: ["basic_crm", "basic_inventory", "basic_notes"],
  },
  sprout: {
    name: "Sprout",
    price: 20,
    tagline: "Plant your first seeds",
    badge: "Best to start",
    limits: {
      leads: 250,
      properties: 50,
      notes: 25,
      teamMembers: 1,
      aiRequestsPerMonth: 500,
      campaigns: 5,
      monthlyCredits: 500, // $5.00
    },
    features: [
      "basic_crm", "basic_inventory", "basic_notes",
      "ai_due_diligence", "email_campaigns",
      "night_cap_dashboard", "deal_calculator",
      "tax_delinquent_import", "direct_mail_basic"
    ],
    // Superpowers unlocked at this tier (shown to free users as preview)
    unlocks: [
      "AI-powered due diligence on every parcel",
      "Tax delinquent list import & processing",
      "Night Cap passive income dashboard",
      "Blind offer calculation wizard",
      "Direct mail campaign builder",
      "Deal & ROI calculator",
    ],
  },
  starter: {
    name: "Starter",
    price: 49,
    tagline: "Build momentum",
    badge: "Most popular solo",
    limits: {
      leads: 500,
      properties: 100,
      notes: 50,
      teamMembers: 2,
      aiRequestsPerMonth: 1000,
      campaigns: 10,
      monthlyCredits: 1000, // $10.00
    },
    features: [
      "basic_crm", "basic_inventory", "basic_notes",
      "ai_due_diligence", "email_campaigns",
      "night_cap_dashboard", "deal_calculator",
      "tax_delinquent_import", "direct_mail_basic",
      "atlas_ai_assistant", "seller_intent", "comps_analysis",
      "skip_tracing_basic", "avm_basic"
    ],
    unlocks: [
      "Atlas AI executive assistant",
      "Seller intent prediction",
      "Automated comps analysis",
      "Basic skip tracing",
      "Automated Valuation Model (AVM)",
      "Email drip sequences",
      "2 team member seats",
    ],
  },
  pro: {
    name: "Pro",
    price: 149,
    tagline: "Scale your operation",
    badge: "Best value for growth",
    limits: {
      leads: 5000,
      properties: 1000,
      notes: 500,
      teamMembers: 10,
      aiRequestsPerMonth: 10000,
      campaigns: 100,
      monthlyCredits: 5000, // $50.00
    },
    features: [
      "advanced_crm", "advanced_inventory", "advanced_notes",
      "ai_due_diligence", "ai_marketing", "ai_buyer_communication",
      "email_campaigns", "sms_campaigns", "direct_mail",
      "payment_processing", "reporting",
      "atlas_ai_assistant", "seller_intent", "comps_analysis",
      "skip_tracing_full", "avm_full", "deal_hunter", "portfolio_health",
      "owner_financing_manager", "buyer_network", "negotiation_copilot",
      "market_intelligence", "deal_patterns", "acquisition_radar"
    ],
    unlocks: [
      "Full skip tracing suite",
      "Deal Hunter AI (finds opportunities automatically)",
      "Negotiation Copilot",
      "Owner financing management & note portfolio",
      "Buyer network access",
      "Portfolio health monitoring",
      "Market intelligence reports",
      "Acquisition Radar (proactive deal alerts)",
      "SMS campaigns",
      "Up to 10 team members",
    ],
  },
  scale: {
    name: "Scale",
    price: 399,
    tagline: "Operate like a fund",
    badge: "For serious operators",
    limits: {
      leads: -1, // unlimited
      properties: -1,
      notes: -1,
      teamMembers: 25,
      aiRequestsPerMonth: -1,
      campaigns: -1,
      monthlyCredits: 25000, // $250.00
    },
    features: [
      "advanced_crm", "advanced_inventory", "advanced_notes",
      "ai_due_diligence", "ai_marketing", "ai_buyer_communication", "ai_custom_agents",
      "email_campaigns", "sms_campaigns", "direct_mail", "marketplace_syndication",
      "payment_processing", "advanced_reporting", "api_access", "webhooks",
      "priority_support", "custom_branding", "team_messaging",
      "atlas_ai_assistant", "seller_intent", "comps_analysis",
      "skip_tracing_full", "avm_full", "deal_hunter", "portfolio_health",
      "owner_financing_manager", "buyer_network", "negotiation_copilot",
      "market_intelligence", "deal_patterns", "acquisition_radar",
      "portfolio_optimizer", "portfolio_sentinel", "capital_markets",
      "va_management", "cohort_analysis", "territory_manager",
      "vision_ai", "voice_ai", "exchange_1031", "tax_optimization"
    ],
    unlocks: [
      "Unlimited leads, properties & notes",
      "Portfolio Optimizer & Sentinel (AI-managed portfolio)",
      "Capital markets access",
      "VA management system",
      "Voice AI for calls",
      "Vision AI for parcel analysis",
      "1031 Exchange tracker",
      "Tax optimization engine",
      "Full API access & webhooks",
      "Up to 25 team members",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price: 799,
    tagline: "White-label your empire",
    badge: "For funds & teams",
    limits: {
      leads: -1, // unlimited
      properties: -1,
      notes: -1,
      teamMembers: -1, // unlimited seats
      aiRequestsPerMonth: -1,
      campaigns: -1,
      monthlyCredits: 50000, // $500.00
    },
    features: [
      "advanced_crm", "advanced_inventory", "advanced_notes",
      "ai_due_diligence", "ai_marketing", "ai_buyer_communication", "ai_custom_agents",
      "email_campaigns", "sms_campaigns", "direct_mail", "marketplace_syndication",
      "payment_processing", "advanced_reporting", "api_access", "webhooks",
      "priority_support", "custom_branding", "team_messaging",
      "white_label_portal", "dedicated_support", "compliance_exports", "custom_integrations",
      "atlas_ai_assistant", "seller_intent", "comps_analysis",
      "skip_tracing_full", "avm_full", "deal_hunter", "portfolio_health",
      "owner_financing_manager", "buyer_network", "negotiation_copilot",
      "market_intelligence", "deal_patterns", "acquisition_radar",
      "portfolio_optimizer", "portfolio_sentinel", "capital_markets",
      "va_management", "cohort_analysis", "territory_manager",
      "vision_ai", "voice_ai", "exchange_1031", "tax_optimization",
      "reseller_dashboard", "multi_org_management", "sso", "audit_logs_export"
    ],
    unlocks: [
      "White-label portal for your brand",
      "Multi-organization management",
      "SSO & enterprise authentication",
      "Dedicated account support",
      "Full compliance export suite",
      "Custom integrations",
      "Reseller dashboard",
      "Unlimited team members",
    ],
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// ============================================
// AI CUSTOMER SUPPORT SYSTEM
// ============================================

// Support case categories and priorities
export const SUPPORT_CATEGORIES = {
  billing: { name: "Billing & Payments", priority: 2 },
  technical: { name: "Technical Issue", priority: 2 },
  account: { name: "Account Settings", priority: 1 },
  feature: { name: "Feature Question", priority: 1 },
  bug: { name: "Bug Report", priority: 3 },
  data: { name: "Data & Import/Export", priority: 2 },
  integration: { name: "Integration Help", priority: 2 },
  other: { name: "Other", priority: 1 },
} as const;

export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;

// Support case statuses
export const SUPPORT_STATUSES = {
  open: { name: "Open", color: "blue" },
  ai_handling: { name: "AI Handling", color: "purple" },
  awaiting_user: { name: "Awaiting User Response", color: "yellow" },
  escalated: { name: "Escalated to Human", color: "red" },
  resolved: { name: "Resolved", color: "green" },
  closed: { name: "Closed", color: "gray" },
} as const;

export type SupportStatus = keyof typeof SUPPORT_STATUSES;

// SLA targets by priority level (hours to first response)
// Priority scale: 1=low, 2=normal, 3=medium, 4=high, 5=critical
export const SLA_HOURS = {
  5: 1,   // critical → 1 hour
  4: 4,   // high → 4 hours
  3: 24,  // medium → 24 hours
  2: 48,  // normal → 48 hours
  1: 72,  // low → 72 hours
} as const;

export type SlaStatus = "on_track" | "at_risk" | "breached";

export interface SlaInfo {
  slaDeadline: Date;
  slaStatus: SlaStatus;
  hoursUntilBreached: number; // negative = already breached
}

/** Compute SLA metadata for a support case given its priority and createdAt. */
export function computeSla(priority: number, createdAt: Date | string): SlaInfo {
  const p = (priority in SLA_HOURS ? priority : 1) as keyof typeof SLA_HOURS;
  const slaHours = SLA_HOURS[p] ?? 72;
  const created = new Date(createdAt);
  const slaDeadline = new Date(created.getTime() + slaHours * 60 * 60 * 1000);
  const now = new Date();
  const msUntil = slaDeadline.getTime() - now.getTime();
  const hoursUntilBreached = msUntil / (60 * 60 * 1000);
  let slaStatus: SlaStatus;
  if (hoursUntilBreached < 0) {
    slaStatus = "breached";
  } else if (hoursUntilBreached < slaHours * 0.25) {
    slaStatus = "at_risk";
  } else {
    slaStatus = "on_track";
  }
  return { slaDeadline, slaStatus, hoursUntilBreached };
}

// Support cases (tickets)
export const supportCases = pgTable("support_cases", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID who created the case
  
  // Case details
  subject: text("subject").notNull(),
  category: text("category").notNull().default("other"), // billing, technical, account, feature, bug, data, integration, other
  status: text("status").notNull().default("open"), // open, ai_handling, awaiting_user, escalated, resolved, closed
  priority: integer("priority").notNull().default(1), // 1-5 (1=low, 5=critical)
  
  // AI classification
  aiClassification: jsonb("ai_classification").$type<{
    category: string;
    confidence: number;
    suggestedPlaybook?: string;
    sentiment?: "positive" | "neutral" | "negative" | "frustrated";
    urgency?: "low" | "medium" | "high" | "critical";
  }>(),
  
  // Resolution tracking
  resolvedAt: timestamp("resolved_at"),
  resolutionSummary: text("resolution_summary"),
  resolutionType: text("resolution_type"), // auto_resolved, user_resolved, escalated_resolved, closed_no_action
  
  // Escalation
  escalatedAt: timestamp("escalated_at"),
  escalationReason: text("escalation_reason"),
  assignedTo: text("assigned_to"), // admin user ID if escalated
  
  // Metrics
  aiAttempts: integer("ai_attempts").default(0), // how many times AI tried to resolve
  userSatisfaction: integer("user_satisfaction"), // 1-5 rating after resolution
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSupportCaseSchema = createInsertSchema(supportCases).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupportCase = z.infer<typeof insertSupportCaseSchema>;
export type SupportCase = typeof supportCases.$inferSelect;

// Support messages within a case
export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => supportCases.id).notNull(),
  
  // Message details
  role: text("role").notNull(), // user, ai_support, human_support, system
  content: text("content").notNull(),
  
  // AI-specific fields
  aiModel: text("ai_model"), // which model generated the response
  aiConfidence: numeric("ai_confidence"), // confidence in the response (0-1)
  playbookUsed: text("playbook_used"), // which playbook was applied
  
  // Action tracking
  actionsAttempted: jsonb("actions_attempted").$type<Array<{
    action: string;
    success: boolean;
    details?: string;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupportMessageSchema = createInsertSchema(supportMessages).omit({ id: true, createdAt: true });
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;
export type SupportMessage = typeof supportMessages.$inferSelect;

// Support actions (what AI can do to resolve issues)
export const supportActions = pgTable("support_actions", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => supportCases.id).notNull(),
  messageId: integer("message_id").references(() => supportMessages.id),
  
  // Action details
  actionType: text("action_type").notNull(), // credit_adjustment, settings_change, password_reset, data_export, etc.
  actionDetails: jsonb("action_details").$type<Record<string, any>>(),
  
  // Outcome
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  resultDetails: jsonb("result_details").$type<Record<string, any>>(),
  
  // Audit trail
  performedBy: text("performed_by").notNull(), // 'ai_support' or admin user ID
  approvedBy: text("approved_by"), // if action required approval
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupportActionSchema = createInsertSchema(supportActions).omit({ id: true, createdAt: true });
export type InsertSupportAction = z.infer<typeof insertSupportActionSchema>;
export type SupportAction = typeof supportActions.$inferSelect;

// Support playbooks (automated resolution scripts)
export const supportPlaybooks = pgTable("support_playbooks", {
  id: serial("id").primaryKey(),
  
  // Playbook identity
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  category: text("category").notNull(), // matches support categories
  
  // Trigger conditions
  triggerPatterns: jsonb("trigger_patterns").$type<string[]>(), // keywords/patterns to match
  triggerConditions: jsonb("trigger_conditions").$type<{
    requiredContext?: string[];
    excludePatterns?: string[];
    minConfidence?: number;
  }>(),
  
  // Actions to take
  steps: jsonb("steps").$type<Array<{
    stepNumber: number;
    actionType: string;
    actionParams: Record<string, any>;
    successMessage: string;
    failureMessage: string;
    continueOnFailure: boolean;
  }>>(),
  
  // Response templates
  initialResponse: text("initial_response"), // first message to user
  successResponse: text("success_response"), // if all steps succeed
  failureResponse: text("failure_response"), // if steps fail
  escalationResponse: text("escalation_response"), // if escalating
  
  // Guardrails
  maxCreditAdjustment: integer("max_credit_adjustment"), // max cents AI can adjust
  requiresApproval: boolean("requires_approval").default(false),
  canEscalate: boolean("can_escalate").default(true),
  
  // Metrics
  timesUsed: integer("times_used").default(0),
  successRate: numeric("success_rate"),
  
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSupportPlaybookSchema = createInsertSchema(supportPlaybooks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupportPlaybook = z.infer<typeof insertSupportPlaybookSchema>;
export type SupportPlaybook = typeof supportPlaybooks.$inferSelect;

// Default playbooks for common issues
export const DEFAULT_SUPPORT_PLAYBOOKS = [
  {
    name: "Credit Balance Inquiry",
    slug: "credit_balance_inquiry",
    description: "Help users understand their credit balance and usage",
    category: "billing",
    triggerPatterns: ["credit balance", "credits", "how many credits", "usage", "charged", "balance"],
    steps: [
      { stepNumber: 1, actionType: "get_credit_balance", actionParams: {}, successMessage: "Retrieved your credit balance", failureMessage: "Could not retrieve balance", continueOnFailure: false },
      { stepNumber: 2, actionType: "get_recent_usage", actionParams: { days: 30 }, successMessage: "Retrieved your recent usage", failureMessage: "Could not retrieve usage", continueOnFailure: true },
    ],
    initialResponse: "Let me check your credit balance and recent usage for you.",
    successResponse: "Here's your current credit information. Is there anything specific you'd like to understand better?",
    maxCreditAdjustment: 0,
    canEscalate: true,
  },
  {
    name: "Courtesy Credit Request",
    slug: "courtesy_credit",
    description: "Issue small courtesy credits for minor issues",
    category: "billing",
    triggerPatterns: ["refund", "credit", "compensation", "not working", "error", "failed", "issue"],
    steps: [
      { stepNumber: 1, actionType: "check_recent_issues", actionParams: {}, successMessage: "Checked for recent issues", failureMessage: "Could not check issues", continueOnFailure: false },
      { stepNumber: 2, actionType: "issue_courtesy_credit", actionParams: { maxCents: 500 }, successMessage: "Issued courtesy credit", failureMessage: "Could not issue credit", continueOnFailure: false },
    ],
    initialResponse: "I understand you've had an issue. Let me look into this and see what I can do to help.",
    successResponse: "I've added a courtesy credit to your account. Is there anything else I can help with?",
    maxCreditAdjustment: 500, // $5 max
    canEscalate: true,
  },
  {
    name: "Feature Explanation",
    slug: "feature_explanation",
    description: "Explain how features work",
    category: "feature",
    triggerPatterns: ["how do i", "how does", "what is", "explain", "help with", "tutorial"],
    steps: [
      { stepNumber: 1, actionType: "identify_feature", actionParams: {}, successMessage: "Identified the feature", failureMessage: "Could not identify feature", continueOnFailure: false },
      { stepNumber: 2, actionType: "generate_explanation", actionParams: {}, successMessage: "Generated explanation", failureMessage: "Could not generate explanation", continueOnFailure: false },
    ],
    initialResponse: "I'd be happy to help explain that feature!",
    successResponse: "Does this help answer your question? Let me know if you'd like more details.",
    maxCreditAdjustment: 0,
    canEscalate: true,
  },
  {
    name: "Technical Troubleshooting",
    slug: "technical_troubleshooting",
    description: "Diagnose and resolve technical issues",
    category: "technical",
    triggerPatterns: ["not working", "error", "broken", "bug", "problem", "can't", "won't", "stuck"],
    steps: [
      { stepNumber: 1, actionType: "run_diagnostics", actionParams: {}, successMessage: "Ran system diagnostics", failureMessage: "Could not run diagnostics", continueOnFailure: false },
      { stepNumber: 2, actionType: "check_known_issues", actionParams: {}, successMessage: "Checked known issues", failureMessage: "Could not check issues", continueOnFailure: true },
      { stepNumber: 3, actionType: "attempt_fix", actionParams: {}, successMessage: "Applied fix", failureMessage: "Could not apply fix", continueOnFailure: true },
    ],
    initialResponse: "I'm sorry to hear you're having trouble. Let me run some diagnostics to see what's happening.",
    successResponse: "I've identified the issue and applied a fix. Please try again and let me know if you're still having problems.",
    failureResponse: "I wasn't able to resolve this automatically. Let me escalate this to our team for a closer look.",
    maxCreditAdjustment: 0,
    canEscalate: true,
  },
] as const;

// ============================================
// FEATURE REQUESTS
// ============================================

export const featureRequests = pgTable("feature_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // enhancement, new_feature, integration, ux
  priority: text("priority").default("medium"), // low, medium, high
  status: text("status").default("submitted"), // submitted, under_review, planned, in_progress, completed, declined
  founderNotes: text("founder_notes"), // Internal notes from founder
  upvotes: integer("upvotes").default(0),
  aiTriage: jsonb("ai_triage").$type<{
    estimatedRevImpactCents: number;
    priorityScore: number;
    duplicateOfId: number | null;
    analysisReason: string;
    autoDisposed: boolean;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFeatureRequestSchema = createInsertSchema(featureRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  founderNotes: true,
  upvotes: true,
});
export type InsertFeatureRequest = z.infer<typeof insertFeatureRequestSchema>;
export type FeatureRequest = typeof featureRequests.$inferSelect;

// ============================================
// DUNNING & PAYMENT RECOVERY
// ============================================

// Dunning stages for progressive enforcement
export const DUNNING_STAGES = {
  none: { name: "Active", accessLevel: "full" },
  grace_period: { name: "Grace Period", accessLevel: "full" },
  warning: { name: "Payment Warning", accessLevel: "full" },
  restricted: { name: "Restricted", accessLevel: "limited" },
  suspended: { name: "Suspended", accessLevel: "none" },
  cancelled: { name: "Cancelled", accessLevel: "none" },
} as const;

export type DunningStage = keyof typeof DUNNING_STAGES;

// Dunning events track each payment failure and recovery attempt
export const dunningEvents = pgTable("dunning_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Stripe references
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeCustomerId: text("stripe_customer_id"),
  
  // Event details
  eventType: text("event_type").notNull(), // payment_failed, payment_succeeded, subscription_cancelled, etc.
  attemptNumber: integer("attempt_number").notNull().default(1),
  amountDueCents: integer("amount_due_cents"),
  amountPaidCents: integer("amount_paid_cents"),
  
  // Status tracking
  status: text("status").notNull().default("pending"), // pending, scheduled_retry, resolved, failed_final, escalated
  dunningStage: text("dunning_stage").notNull().default("grace_period"), // current stage at time of event
  
  // Retry scheduling
  nextRetryAt: timestamp("next_retry_at"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(4),
  
  // Notifications
  notificationsSent: jsonb("notifications_sent").$type<Array<{
    type: string;
    sentAt: string;
    channel: string;
  }>>(),
  
  // Resolution
  resolvedAt: timestamp("resolved_at"),
  resolutionType: text("resolution_type"), // auto_recovered, manual_payment, subscription_cancelled, escalated
  
  // Metadata
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  errorMessage: text("error_message"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDunningEventSchema = createInsertSchema(dunningEvents).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDunningEvent = z.infer<typeof insertDunningEventSchema>;
export type DunningEvent = typeof dunningEvents.$inferSelect;

// Default dunning configuration per tier
export const DUNNING_CONFIG = {
  retryScheduleDays: [3, 5, 7, 14], // Days after initial failure to retry
  gracePeriodDays: 3, // Full access for first 3 days
  warningPeriodDays: 7, // Warning stage days 4-7
  restrictedPeriodDays: 14, // Restricted access days 8-14
  finalCancellationDays: 21, // Cancel subscription after 21 days
  notificationSchedule: [
    { dayOffset: 0, type: "payment_failed", channel: "email" },
    { dayOffset: 2, type: "reminder", channel: "email" },
    { dayOffset: 6, type: "warning", channel: "email" },
    { dayOffset: 13, type: "final_notice", channel: "email" },
  ],
} as const;

// ============================================
// FOUNDER ALERTS & SYSTEM NOTIFICATIONS
// ============================================

export const systemAlerts = pgTable("system_alerts", {
  id: serial("id").primaryKey(),
  
  // Alert classification (type is the legacy column, alertType is the newer one)
  type: varchar("type", { length: 255 }).notNull(),
  alertType: text("alert_type"), // revenue_at_risk, high_churn, system_error, escalation, milestone
  severity: text("severity").notNull().default("info"), // info, warning, critical
  
  // Content
  title: text("title").notNull(),
  message: text("message").notNull(),
  
  // Context
  organizationId: integer("organization_id").references(() => organizations.id),
  relatedEntityType: text("related_entity_type"), // organization, support_case, subscription, etc.
  relatedEntityId: integer("related_entity_id"),
  
  // Status
  status: text("status").notNull().default("new"), // new, acknowledged, resolved, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  
  // Auto-resolution
  autoResolvable: boolean("auto_resolvable").default(false),
  autoResolveAction: text("auto_resolve_action"),
  
  // Metadata
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSystemAlertSchema = createInsertSchema(systemAlerts).omit({ id: true, createdAt: true });
export type InsertSystemAlert = z.infer<typeof insertSystemAlertSchema>;
export type SystemAlert = typeof systemAlerts.$inferSelect;

// ============================================
// SOPHIE OBSERVATIONS (Proactive Detection)
// ============================================

// Sophie proactive observation types
export const SOPHIE_OBSERVATION_TYPES = [
  'anomaly',           // Unusual patterns detected
  'performance',       // Performance degradation
  'error_pattern',     // Repeated errors
  'usage_spike',       // Unusual usage patterns
  'quota_warning',     // Approaching quota limits
  'data_issue',        // Data integrity issues
  'activity_drop',     // Sudden drop in user activity
  'service_health',    // External service issues
  'opportunity',       // Positive opportunity detected
  'optimization',      // Optimization suggestion
] as const;

export type SophieObservationType = typeof SOPHIE_OBSERVATION_TYPES[number];

// Notification level options for organizations
export const PROACTIVE_NOTIFICATION_LEVELS = ['minimal', 'balanced', 'proactive', 'off'] as const;
export type ProactiveNotificationLevel = typeof PROACTIVE_NOTIFICATION_LEVELS[number];

// Sophie observations table - graceful proactive detection
export const sophieObservations = pgTable("sophie_observations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id"), // Nullable - may be org-wide observation

  // Classification
  type: text("type").notNull(), // anomaly, performance, error_pattern, usage_spike, etc.
  confidenceScore: integer("confidence_score").notNull(), // 0-100
  severity: text("severity").notNull().default("info"), // info, low, medium, high

  // Content - using soft language framing
  title: text("title").notNull(), // e.g., "Quick tip", "Something to check", "Heads up"
  description: text("description").notNull(),
  metadata: jsonb("metadata").$type<{
    // Context about the observation
    source?: string;
    relatedEntityType?: string;
    relatedEntityId?: number;
    suggestedAction?: string;
    dataPoints?: Record<string, any>;
    batchKey?: string; // For grouping similar observations
    previousOccurrences?: number;
  }>(),

  // Status tracking
  status: text("status").notNull().default("detected"), // detected, acknowledged, dismissed, escalated, auto_resolved

  // Timestamps
  detectedAt: timestamp("detected_at").defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  escalatedAt: timestamp("escalated_at"),
  resolvedAt: timestamp("resolved_at"),

  // Notification tracking
  notificationSent: boolean("notification_sent").default(false),
  notificationType: text("notification_type").default("none"), // none, passive, active

  // Auto-resolution tracking
  autoResolveAttempted: boolean("auto_resolve_attempted").default(false),
  autoResolveSuccess: boolean("auto_resolve_success").default(false),
  autoResolveDetails: text("auto_resolve_details"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("sophie_obs_org_idx").on(table.organizationId),
  index("sophie_obs_status_idx").on(table.status),
  index("sophie_obs_type_idx").on(table.type),
  index("sophie_obs_detected_at_idx").on(table.detectedAt),
]);

export const insertSophieObservationSchema = createInsertSchema(sophieObservations).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  detectedAt: true 
});
export type InsertSophieObservation = z.infer<typeof insertSophieObservationSchema>;
export type SophieObservation = typeof sophieObservations.$inferSelect;

// ============================================
// API JOB QUEUE
// ============================================

export const apiJobs = pgTable("api_jobs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  type: text("type").notNull(), // openai, stripe, lob, sendgrid, twilio
  operation: text("operation").notNull(),
  payload: jsonb("payload"),
  status: text("status").notNull().default("pending"), // pending, processing, retrying, completed, failed
  retries: integer("retries").default(0),
  maxRetries: integer("max_retries").default(3),
  nextRetryAt: timestamp("next_retry_at"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertApiJobSchema = createInsertSchema(apiJobs).omit({ createdAt: true, completedAt: true });
export type InsertApiJob = z.infer<typeof insertApiJobSchema>;
export type ApiJob = typeof apiJobs.$inferSelect;

// ============================================
// DIGEST SUBSCRIPTIONS
// ============================================

export const digestSubscriptions = pgTable("digest_subscriptions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  frequency: text("frequency").notNull().default("weekly"), // daily, weekly, monthly
  emailEnabled: boolean("email_enabled").default(true),
  lastSentAt: timestamp("last_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDigestSubscriptionSchema = createInsertSchema(digestSubscriptions).omit({ id: true, createdAt: true });
export type InsertDigestSubscription = z.infer<typeof insertDigestSubscriptionSchema>;
export type DigestSubscription = typeof digestSubscriptions.$inferSelect;

// ============================================
// ACTIVITY EVENTS (Communication History Timeline)
// ============================================

// Event types for communication timeline
export const ACTIVITY_EVENT_TYPES = {
  email_sent: { name: "Email Sent", icon: "Mail", color: "blue" },
  email_opened: { name: "Email Opened", icon: "MailOpen", color: "green" },
  email_clicked: { name: "Email Clicked", icon: "MousePointer", color: "purple" },
  sms_sent: { name: "SMS Sent", icon: "MessageSquare", color: "cyan" },
  sms_delivered: { name: "SMS Delivered", icon: "MessageCircle", color: "green" },
  mail_sent: { name: "Direct Mail Sent", icon: "FileText", color: "orange" },
  mail_delivered: { name: "Direct Mail Delivered", icon: "Package", color: "green" },
  call_made: { name: "Call Made", icon: "PhoneOutgoing", color: "blue" },
  call_received: { name: "Call Received", icon: "PhoneIncoming", color: "green" },
  note_added: { name: "Note Added", icon: "StickyNote", color: "yellow" },
  stage_changed: { name: "Stage Changed", icon: "ArrowRightCircle", color: "purple" },
  payment_received: { name: "Payment Received", icon: "DollarSign", color: "green" },
  document_uploaded: { name: "Document Uploaded", icon: "Upload", color: "slate" },
  task_created: { name: "Task Created", icon: "ListTodo", color: "blue" },
  task_updated: { name: "Task Updated", icon: "ClipboardEdit", color: "amber" },
  task_completed: { name: "Task Completed", icon: "CheckCircle2", color: "green" },
} as const;

export type ActivityEventType = keyof typeof ACTIVITY_EVENT_TYPES;

// Activity Events table - unified timeline for leads, properties, and deals
export const activityEvents = pgTable("activity_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Entity reference (polymorphic)
  entityType: text("entity_type").notNull(), // lead, property, deal
  entityId: integer("entity_id").notNull(),
  
  // Event details
  eventType: text("event_type").notNull(), // email_sent, sms_sent, mail_sent, call_made, note_added, stage_changed, payment_received, etc.
  description: text("description").notNull(),
  
  // Metadata for event-specific details
  metadata: jsonb("metadata").$type<{
    subject?: string;
    recipient?: string;
    amount?: number;
    previousStage?: string;
    newStage?: string;
    campaignName?: string;
    paymentMethod?: string;
    documentName?: string;
    documentUrl?: string;
    callDuration?: number;
    templateUsed?: string;
    [key: string]: unknown;
  }>(),
  
  // Attribution
  userId: text("user_id"), // User who triggered the event (null for automated)
  campaignId: integer("campaign_id").references(() => campaigns.id),
  
  // Timestamp
  eventDate: timestamp("event_date").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertActivityEventSchema = createInsertSchema(activityEvents).omit({ id: true, createdAt: true });
export type InsertActivityEvent = z.infer<typeof insertActivityEventSchema>;
export type ActivityEvent = typeof activityEvents.$inferSelect;

// ============================================
// DRIP CAMPAIGN SEQUENCES (Multi-Touch Automation)
// ============================================

// Campaign Sequences - multi-touch drip campaigns
export const campaignSequences = pgTable("campaign_sequences", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  enrollmentTrigger: text("enrollment_trigger").notNull().default("manual"), // manual, new_lead, stage_change
  enrollmentCriteria: jsonb("enrollment_criteria").$type<{
    leadStatus?: string[];
    leadSource?: string[];
    leadTags?: string[];
    triggerStage?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sequence Steps - individual touches in a sequence
export const sequenceSteps = pgTable("sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => campaignSequences.id).notNull(),
  stepNumber: integer("step_number").notNull(),
  delayDays: integer("delay_days").notNull().default(0), // days to wait after previous step
  channel: text("channel").notNull(), // direct_mail, email, sms
  templateId: text("template_id"),
  subject: text("subject"),
  content: text("content").notNull(),
  conditionType: text("condition_type").notNull().default("always"), // always, no_response, responded
  conditionDays: integer("condition_days"), // days to check for response condition
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sequence Enrollments - leads enrolled in sequences
export const sequenceEnrollments = pgTable("sequence_enrollments", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => campaignSequences.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  status: text("status").notNull().default("active"), // active, paused, completed, cancelled
  currentStep: integer("current_step").notNull().default(0),
  enrolledAt: timestamp("enrolled_at").defaultNow(),
  lastStepSentAt: timestamp("last_step_sent_at"),
  nextStepScheduledAt: timestamp("next_step_scheduled_at"),
  pauseReason: text("pause_reason"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schemas
export const insertCampaignSequenceSchema = createInsertSchema(campaignSequences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSequenceStepSchema = createInsertSchema(sequenceSteps).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSequenceEnrollmentSchema = createInsertSchema(sequenceEnrollments).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type CampaignSequence = typeof campaignSequences.$inferSelect;
export type InsertCampaignSequence = z.infer<typeof insertCampaignSequenceSchema>;
export type SequenceStep = typeof sequenceSteps.$inferSelect;
export type InsertSequenceStep = z.infer<typeof insertSequenceStepSchema>;
export type SequenceEnrollment = typeof sequenceEnrollments.$inferSelect;
export type InsertSequenceEnrollment = z.infer<typeof insertSequenceEnrollmentSchema>;

// Type aliases for sequence-related types
export type EnrollmentTrigger = "manual" | "new_lead" | "stage_change";
export type SequenceStepChannel = "direct_mail" | "email" | "sms";
export type SequenceConditionType = "always" | "no_response" | "responded";
export type SequenceEnrollmentStatus = "active" | "paused" | "completed" | "cancelled";

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
// NOTIFICATION PREFERENCES (15.2)
// ============================================

export const NOTIFICATION_EVENT_TYPES = [
  "lead_created",
  "lead_updated", 
  "lead_stage_changed",
  "property_created",
  "property_updated",
  "deal_created",
  "deal_updated",
  "deal_stage_changed",
  "payment_received",
  "payment_overdue",
  "campaign_started",
  "campaign_completed",
  "email_sent",
  "sms_sent",
  "mail_sent",
] as const;

export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number];

export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  eventType: text("event_type").notNull(), // One of NOTIFICATION_EVENT_TYPES
  emailEnabled: boolean("email_enabled").default(true),
  pushEnabled: boolean("push_enabled").default(false),
  inAppEnabled: boolean("in_app_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;

// ============================================
// TASK MANAGEMENT SYSTEM (17.1, 17.2)
// ============================================

// Priority levels for tasks
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

// Status values for tasks
export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

// Entity types that tasks can be linked to
export const TASK_ENTITY_TYPES = ["lead", "property", "deal", "none"] as const;
export type TaskEntityType = typeof TASK_ENTITY_TYPES[number];

// Recurrence rules for recurring tasks
export const TASK_RECURRENCE_RULES = ["daily", "weekly", "monthly", "yearly"] as const;
export type TaskRecurrenceRule = typeof TASK_RECURRENCE_RULES[number];

// Tasks table
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Core task fields
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  status: text("status").notNull().default("pending"), // pending, in_progress, completed, cancelled
  
  // Assignment
  assignedTo: integer("assigned_to").references(() => teamMembers.id),
  createdBy: text("created_by").notNull(), // User ID who created the task
  
  // Entity linking (optional)
  entityType: text("entity_type").notNull().default("none"), // lead, property, deal, none
  entityId: integer("entity_id"), // ID of the linked entity
  
  // Recurring task fields (17.2)
  isRecurring: boolean("is_recurring").default(false),
  recurrenceRule: text("recurrence_rule"), // daily, weekly, monthly, yearly
  nextOccurrence: timestamp("next_occurrence"),
  parentTaskId: integer("parent_task_id"), // Reference to the original recurring task
  
  // Timestamps
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schema
export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

// Types
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

// ============================================
// COMPLIANCE: AUDIT LOG (20.1)
// ============================================

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id"), // Replit user ID or null for system actions
  action: text("action").notNull(), // create, update, delete, login, export, import, etc.
  entityType: text("entity_type").notNull(), // lead, property, deal, note, campaign, etc.
  entityId: integer("entity_id"), // ID of the affected entity
  changes: jsonb("changes").$type<{
    before?: Record<string, any>;
    after?: Record<string, any>;
    fields?: string[];
  }>(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, any>>(), // Additional context
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schema
export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  createdAt: true,
});

// Types
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// Audit action types
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "login",
  "logout",
  "export",
  "import",
  "consent_granted",
  "consent_revoked",
  "data_purge",
] as const;
export type AuditAction = typeof AUDIT_ACTIONS[number];

// Entity types that can be audited
export const AUDITABLE_ENTITIES = [
  "lead",
  "property", 
  "deal",
  "note",
  "payment",
  "campaign",
  "user",
  "organization",
  "settings",
] as const;
export type AuditableEntity = typeof AUDITABLE_ENTITIES[number];

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
// ACQUISITION: TARGET COUNTIES & DATA SOURCES
// ============================================

export const targetCounties = pgTable("target_counties", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  fipsCode: text("fips_code"),
  population: integer("population"),
  medianHomeValue: numeric("median_home_value"),
  averageLotPrice: numeric("average_lot_price"),
  status: text("status").notNull().default("researching"), // researching, active, paused, exhausted
  priority: integer("priority").default(1), // 1-5, 1 being highest
  notes: text("notes"),
  dataSources: jsonb("data_sources").$type<{
    name: string;
    type: string; // tax_delinquent, probate, vacant, absentee
    lastPulled?: string;
    recordCount?: number;
    cost?: number;
    url?: string;
  }[]>(),
  metrics: jsonb("metrics").$type<{
    leadsGenerated?: number;
    dealsCompleted?: number;
    responseRate?: number;
    averageProfit?: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTargetCountySchema = createInsertSchema(targetCounties).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTargetCounty = z.infer<typeof insertTargetCountySchema>;
export type TargetCounty = typeof targetCounties.$inferSelect;

// ============================================
// COUNTY GIS ENDPOINTS (Free Parcel Data Sources)
// ============================================

// Global registry of county GIS endpoints for free parcel lookups
export const countyGisEndpoints = pgTable("county_gis_endpoints", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(), // 2-letter state code (TX, NM, AZ, etc.)
  county: text("county").notNull(), // County name
  fipsCode: text("fips_code"), // 5-digit FIPS code
  
  // Endpoint configuration
  endpointType: text("endpoint_type").notNull().default("arcgis_rest"), // arcgis_rest, arcgis_feature, wfs, direct_api
  baseUrl: text("base_url").notNull(), // Base URL for the GIS service
  layerId: text("layer_id"), // Layer ID for ArcGIS services
  
  // Query configuration
  apnField: text("apn_field").default("APN"), // Field name for parcel number
  ownerField: text("owner_field").default("OWNER"), // Field name for owner
  geometryField: text("geometry_field"), // Geometry field if different from default
  additionalParams: jsonb("additional_params").$type<Record<string, string>>(), // Extra query parameters
  
  // Field mappings (map county fields to our standard schema)
  fieldMappings: jsonb("field_mappings").$type<{
    apn?: string;
    owner?: string;
    address?: string;
    acres?: string;
    assessedValue?: string;
    taxAmount?: string;
    legalDescription?: string;
    zoning?: string;
  }>(),
  
  // Status
  isVerified: boolean("is_verified").default(false), // Has this endpoint been verified to work?
  lastVerified: timestamp("last_verified"),
  isActive: boolean("is_active").default(true),
  errorCount: integer("error_count").default(0), // Track failures
  lastError: text("last_error"),
  
  // Attribution
  sourceUrl: text("source_url"), // URL to the county's GIS website
  notes: text("notes"),
  contributedBy: text("contributed_by"), // Who added this endpoint
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCountyGisEndpointSchema = createInsertSchema(countyGisEndpoints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCountyGisEndpoint = z.infer<typeof insertCountyGisEndpointSchema>;
export type CountyGisEndpoint = typeof countyGisEndpoints.$inferSelect;

// ============================================
// PARCEL SNAPSHOTS (Centralized Parcel Cache)
// ============================================

export const parcelSnapshots = pgTable("parcel_snapshots", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = global/shared cache
  
  // Parcel identification
  apn: text("apn").notNull(),
  state: text("state").notNull(), // 2-letter state code
  county: text("county").notNull(),
  fipsCode: text("fips_code"),
  
  // Data source
  source: text("source").notNull().default("regrid"), // county_gis, regrid, manual
  sourceId: text("source_id"), // External ID from the source (regrid_id, etc)
  
  // Geometry
  boundary: jsonb("boundary").$type<{
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  }>(),
  centroid: jsonb("centroid").$type<{ lat: number; lng: number }>(),
  
  // Property information
  owner: text("owner"),
  ownerAddress: text("owner_address"),
  mailingAddress: text("mailing_address"),
  siteAddress: text("site_address"),
  
  // Parcel details
  acres: numeric("acres"),
  legalDescription: text("legal_description"),
  zoning: text("zoning"),
  landUse: text("land_use"),
  propertyType: text("property_type"),
  
  // Valuation
  assessedValue: numeric("assessed_value"),
  marketValue: numeric("market_value"),
  taxAmount: numeric("tax_amount"),
  taxYear: integer("tax_year"),
  
  // Sales history
  lastSalePrice: numeric("last_sale_price"),
  lastSaleDate: timestamp("last_sale_date"),
  
  // Raw data from source
  rawData: jsonb("raw_data").$type<Record<string, unknown>>(),
  
  // Cache management
  fetchedAt: timestamp("fetched_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertParcelSnapshotSchema = createInsertSchema(parcelSnapshots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertParcelSnapshot = z.infer<typeof insertParcelSnapshotSchema>;
export type ParcelSnapshot = typeof parcelSnapshots.$inferSelect;

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
});

export const insertSkipTraceSchema = createInsertSchema(skipTraces).omit({
  id: true,
  createdAt: true,
});
export type InsertSkipTrace = z.infer<typeof insertSkipTraceSchema>;
export type SkipTrace = typeof skipTraces.$inferSelect;

// ============================================
// DUE DILIGENCE: CHECKLISTS & RESEARCH
// ============================================

export const dueDiligenceChecklists = pgTable("due_diligence_checklists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  status: text("status").notNull().default("in_progress"), // in_progress, completed, failed
  completedPercent: integer("completed_percent").default(0),
  
  items: jsonb("items").$type<{
    id: string;
    category: string; // title, environmental, zoning, access, utilities, taxes
    name: string;
    status: string; // pending, passed, failed, warning, skipped
    notes?: string;
    dataSource?: string;
    verifiedAt?: string;
    verifiedBy?: string;
    autoVerified?: boolean;
    requiresManualReview?: boolean;
  }[]>(),
  
  floodZone: jsonb("flood_zone").$type<{
    zone?: string; // A, AE, X, etc.
    inFloodplain?: boolean;
    panelNumber?: string;
    effectiveDate?: string;
    source?: string;
  }>(),
  
  wetlands: jsonb("wetlands").$type<{
    hasWetlands?: boolean;
    wetlandType?: string;
    acresAffected?: number;
    source?: string;
    verified?: boolean;
  }>(),
  
  taxInfo: jsonb("tax_info").$type<{
    annualTaxAmount?: number;
    backTaxesOwed?: number;
    taxSaleScheduled?: boolean;
    taxSaleDate?: string;
    assessedValue?: number;
    taxRate?: number;
    paymentHistory?: { year: number; amount: number; status: string }[];
  }>(),
  
  hoaInfo: jsonb("hoa_info").$type<{
    hasHOA?: boolean;
    hoaName?: string;
    monthlyDues?: number;
    specialAssessments?: number;
    restrictions?: string[];
    contactInfo?: string;
  }>(),
  
  deedRestrictions: jsonb("deed_restrictions").$type<{
    hasRestrictions?: boolean;
    restrictions?: string[];
    easements?: string[];
    rightOfWay?: string;
  }>(),
  
  accessInfo: jsonb("access_info").$type<{
    hasLegalAccess?: boolean;
    accessType?: string; // paved, dirt, easement, none
    roadName?: string;
    maintenanceResponsibility?: string;
  }>(),
  
  utilitiesInfo: jsonb("utilities_info").$type<{
    electric?: { available: boolean; provider?: string; distanceFeet?: number };
    water?: { available: boolean; type?: string; provider?: string };
    sewer?: { available: boolean; type?: string };
    gas?: { available: boolean; provider?: string };
    internet?: { available: boolean; providers?: string[] };
  }>(),
  
  assignedTo: integer("assigned_to"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDueDiligenceChecklistSchema = createInsertSchema(dueDiligenceChecklists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDueDiligenceChecklist = z.infer<typeof insertDueDiligenceChecklistSchema>;
export type DueDiligenceChecklist = typeof dueDiligenceChecklists.$inferSelect;

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
    status: string; // pending, active, failed, removed
    postedAt?: string;
    expiresAt?: string;
    error?: string;
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

// ============================================
// DOCUMENTS: TEMPLATES & E-SIGNATURES
// ============================================

export const documentTemplates = pgTable("document_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // purchase_agreement, quit_claim_deed, warranty_deed, assignment_contract, promissory_note, offer_letter
  category: text("category").notNull().default("closing"), // acquisition, closing, financing
  content: text("content").notNull(), // HTML/Markdown template with merge fields
  variables: jsonb("variables").$type<{
    name: string;
    description: string;
    type: string; // text, number, date, currency
    required: boolean;
    defaultValue?: string;
  }[]>(),
  isSystemTemplate: boolean("is_system_template").default(false),
  isActive: boolean("is_active").default(true),
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;

export const generatedDocuments = pgTable("generated_documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  templateId: integer("template_id").references(() => documentTemplates.id),
  dealId: integer("deal_id").references(() => deals.id),
  propertyId: integer("property_id").references(() => properties.id),
  leadId: integer("lead_id").references(() => leads.id),
  
  name: text("name").notNull(),
  type: text("type").notNull(),
  content: text("content"), // Generated content
  pdfUrl: text("pdf_url"),
  
  variables: jsonb("variables").$type<Record<string, string | number>>(),
  
  status: text("status").notNull().default("draft"), // draft, pending_signature, partially_signed, signed, final, archived, cancelled
  
  signers: jsonb("signers").$type<{
    id: string;
    name: string;
    email: string;
    role: string; // buyer, seller, witness, notary
    signedAt?: string;
    signatureUrl?: string;
    order?: number;
  }[]>(),
  
  esignProvider: text("esign_provider"), // docusign, hellosign, none
  esignEnvelopeId: text("esign_envelope_id"),
  esignStatus: text("esign_status"),
  
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  signedAt: timestamp("signed_at"),
  expiresAt: timestamp("expires_at"),
  
  generatedBy: text("generated_by"), // userId who generated the document
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGeneratedDocumentSchema = createInsertSchema(generatedDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGeneratedDocument = z.infer<typeof insertGeneratedDocumentSchema>;
export type GeneratedDocument = typeof generatedDocuments.$inferSelect;

// ============================================
// NATIVE E-SIGNATURES
// ============================================

export const signatures = pgTable("signatures", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  documentId: integer("document_id").references(() => generatedDocuments.id),
  
  signerName: text("signer_name").notNull(),
  signerEmail: text("signer_email"),
  signerRole: text("signer_role").notNull().default("signer"), // buyer, seller, witness, notary, signer
  
  // Base64 encoded PNG signature image from HTML5 Canvas
  signatureData: text("signature_data").notNull(),
  signatureType: text("signature_type").notNull().default("drawn"), // drawn, typed, uploaded
  
  // IP and device info for audit trail
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  // Legal consent
  consentGiven: boolean("consent_given").notNull().default(true),
  consentText: text("consent_text"),
  
  signedAt: timestamp("signed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSignatureSchema = createInsertSchema(signatures).omit({
  id: true,
  signedAt: true,
  createdAt: true,
});
export type InsertSignature = z.infer<typeof insertSignatureSchema>;
export type Signature = typeof signatures.$inferSelect;

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
// AUTOMATION RULES ENGINE (8.1)
// ============================================

export const AUTOMATION_TRIGGERS = [
  "lead_created",
  "lead_status_changed",
  "deal_stage_changed",
  "payment_received",
  "payment_missed",
  "task_completed",
  "note_created",
  "property_added",
] as const;
export type AutomationTrigger = typeof AUTOMATION_TRIGGERS[number];

export const AUTOMATION_CONDITIONS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
] as const;
export type AutomationCondition = typeof AUTOMATION_CONDITIONS[number];

export const AUTOMATION_ACTIONS = [
  "send_email",
  "send_sms",
  "create_task",
  "add_tag",
  "remove_tag",
  "change_lead_status",
  "change_deal_stage",
  "notify_team",
  "assign_to",
  "add_note",
] as const;
export type AutomationAction = typeof AUTOMATION_ACTIONS[number];

export const automationRules = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  description: text("description"),
  
  trigger: text("trigger").notNull(), // One of AUTOMATION_TRIGGERS
  
  conditions: jsonb("conditions").$type<{
    field: string;
    operator: string; // One of AUTOMATION_CONDITIONS
    value: string;
    logicalOperator?: "and" | "or";
  }[]>(),
  
  actions: jsonb("actions").$type<{
    type: string; // One of AUTOMATION_ACTIONS
    config: Record<string, any>;
  }[]>().notNull(),
  
  isEnabled: boolean("is_enabled").default(true),
  
  executionCount: integer("execution_count").default(0),
  lastExecutedAt: timestamp("last_executed_at"),
  
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAutomationRuleSchema = createInsertSchema(automationRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  executionCount: true,
  lastExecutedAt: true,
});
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = typeof automationRules.$inferSelect;

// Automation rule execution log
export const automationExecutions = pgTable("automation_executions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  ruleId: integer("rule_id").references(() => automationRules.id).notNull(),
  
  trigger: text("trigger").notNull(),
  triggerData: jsonb("trigger_data").$type<Record<string, any>>(),
  
  conditionsMet: boolean("conditions_met").default(true),
  conditionsResult: jsonb("conditions_result").$type<{
    field: string;
    passed: boolean;
    actual: any;
    expected: any;
  }[]>(),
  
  actionsExecuted: jsonb("actions_executed").$type<{
    type: string;
    success: boolean;
    result?: any;
    error?: string;
  }[]>(),
  
  status: text("status").notNull().default("completed"), // pending, running, completed, failed
  error: text("error"),
  
  executedAt: timestamp("executed_at").defaultNow(),
});

export const insertAutomationExecutionSchema = createInsertSchema(automationExecutions).omit({
  id: true,
  executedAt: true,
});
export type InsertAutomationExecution = z.infer<typeof insertAutomationExecutionSchema>;
export type AutomationExecution = typeof automationExecutions.$inferSelect;

// ============================================
// NOTIFICATIONS SYSTEM (8.3)
// ============================================

export const NOTIFICATION_TYPES = [
  "task_assigned",
  "task_due",
  "task_overdue",
  "deal_update",
  "deal_stage_changed",
  "payment_received",
  "payment_missed",
  "lead_response",
  "lead_assigned",
  "team_mention",
  "automation_triggered",
  "system_alert",
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Recipient user ID
  
  type: text("type").notNull(), // One of NOTIFICATION_TYPES
  title: text("title").notNull(),
  message: text("message"),
  
  entityType: text("entity_type"), // lead, property, deal, task, payment
  entityId: integer("entity_id"),
  
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  isRead: true,
  readAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ============================================
// JOB CURSORS (Prevent duplicate processing on restart)
// ============================================

export const jobCursors = pgTable("job_cursors", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull().unique(),
  lastProcessedId: integer("last_processed_id"),
  lastRunAt: timestamp("last_run_at"),
  status: text("status").default('idle'),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertJobCursorSchema = createInsertSchema(jobCursors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJobCursor = z.infer<typeof insertJobCursorSchema>;
export type JobCursor = typeof jobCursors.$inferSelect;

// ============================================
// JOB LOCKS (Prevent duplicate execution in multi-instance deployment)
// ============================================

export const jobLocks = pgTable("job_locks", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull().unique(),
  lockedBy: text("locked_by").notNull(),
  lockedAt: timestamp("locked_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertJobLockSchema = createInsertSchema(jobLocks).omit({
  id: true,
  lockedAt: true,
});
export type InsertJobLock = z.infer<typeof insertJobLockSchema>;
export type JobLock = typeof jobLocks.$inferSelect;

// ============================================
// EMAIL SENDER IDENTITIES
// ============================================

export const emailSenderIdentities = pgTable("email_sender_identities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  teamMemberId: integer("team_member_id").references(() => teamMembers.id),
  
  type: text("type").notNull(), // platform_alias, custom_domain
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name").notNull(),
  replyToEmail: text("reply_to_email"), // Where replies should go if forwarding
  
  replyRoutingMode: text("reply_routing_mode").notNull().default("in_app"), // in_app, forward, both
  
  status: text("status").notNull().default("pending"), // pending, verified, failed
  verificationToken: text("verification_token"),
  verifiedAt: timestamp("verified_at"),
  
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  
  dnsRecords: jsonb("dns_records").$type<{
    dkim?: Array<{ name: string; type: string; value: string; verified: boolean }>;
    spf?: { name: string; type: string; value: string; verified: boolean };
    dmarc?: { name: string; type: string; value: string; verified: boolean };
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEmailSenderIdentitySchema = createInsertSchema(emailSenderIdentities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
});
export type InsertEmailSenderIdentity = z.infer<typeof insertEmailSenderIdentitySchema>;
export type EmailSenderIdentity = typeof emailSenderIdentities.$inferSelect;

// ============================================
// INBOX MESSAGES (Inbound Email Replies)
// ============================================

export const inboxMessages = pgTable("inbox_messages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name"),
  recipientEmail: text("recipient_email").notNull(), // The @acreage.pro or custom domain address
  
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  
  leadId: integer("lead_id").references(() => leads.id),
  conversationId: integer("conversation_id").references(() => conversations.id),
  
  inReplyToMessageId: text("in_reply_to_message_id"), // Email Message-ID header for threading
  messageId: text("message_id"), // This email's Message-ID header
  
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  readBy: text("read_by"), // User ID who marked as read
  
  isArchived: boolean("is_archived").default(false),
  isStarred: boolean("is_starred").default(false),
  
  forwardedToEmail: text("forwarded_to_email"),
  forwardedAt: timestamp("forwarded_at"),
  
  rawHeaders: jsonb("raw_headers").$type<Record<string, string>>(),
  attachments: jsonb("attachments").$type<Array<{
    filename: string;
    contentType: string;
    size: number;
    storageKey?: string;
  }>>(),
  
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInboxMessageSchema = createInsertSchema(inboxMessages).omit({
  id: true,
  createdAt: true,
  isRead: true,
  readAt: true,
  readBy: true,
  isArchived: true,
  isStarred: true,
});
export type InsertInboxMessage = z.infer<typeof insertInboxMessageSchema>;
export type InboxMessage = typeof inboxMessages.$inferSelect;

// ============================================
// MAIL SENDER IDENTITIES (Direct Mail Return Addresses)
// ============================================

export const mailSenderIdentities = pgTable("mail_sender_identities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(), // Display name e.g. "Main Office", "Marketing HQ"
  companyName: text("company_name").notNull(),
  addressLine1: text("address_line_1").notNull(),
  addressLine2: text("address_line_2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zipCode: text("zip_code").notNull(),
  country: text("country").notNull().default("US"),
  
  lobAddressId: text("lob_address_id"), // Lob's address object ID after verification
  
  status: text("status").notNull().default("draft"), // draft, pending_verification, verified, failed
  verificationDetails: jsonb("verification_details").$type<{
    deliverability?: string;
    deliverabilityAnalysis?: {
      dpvConfirmation?: string;
      dpvCmra?: string;
      dpvVacant?: string;
      dpvFootnotes?: string[];
    };
    components?: {
      primaryNumber?: string;
      streetPredirection?: string;
      streetName?: string;
      streetSuffix?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      zipCodePlus4?: string;
    };
    errorMessage?: string;
  }>(),
  verifiedAt: timestamp("verified_at"),
  
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMailSenderIdentitySchema = createInsertSchema(mailSenderIdentities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
  lobAddressId: true,
  verificationDetails: true,
});
export type InsertMailSenderIdentity = z.infer<typeof insertMailSenderIdentitySchema>;
export type MailSenderIdentity = typeof mailSenderIdentities.$inferSelect;

// ============================================
// MAILING ORDERS (Direct Mail Campaign Orders)
// ============================================

export const mailingOrders = pgTable("mailing_orders", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  
  mailSenderIdentityId: integer("mail_sender_identity_id").references(() => mailSenderIdentities.id),
  
  returnAddressSnapshot: jsonb("return_address_snapshot").$type<{
    companyName: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  }>(),
  
  mailType: text("mail_type").notNull(), // letter, postcard, check
  templateId: text("template_id"), // Lob template ID if using templates
  
  totalPieces: integer("total_pieces").notNull().default(0),
  sentPieces: integer("sent_pieces").notNull().default(0),
  failedPieces: integer("failed_pieces").notNull().default(0),
  
  costPerPiece: integer("cost_per_piece").notNull().default(0), // In cents
  totalCost: integer("total_cost").notNull().default(0), // In cents
  creditsUsed: integer("credits_used").notNull().default(0),
  
  status: text("status").notNull().default("draft"), // draft, processing, sending, completed, failed, cancelled
  
  lobJobIds: jsonb("lob_job_ids").$type<string[]>(),
  
  errorMessage: text("error_message"),
  
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMailingOrderSchema = createInsertSchema(mailingOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentPieces: true,
  failedPieces: true,
  startedAt: true,
  completedAt: true,
  lobJobIds: true,
});
export type InsertMailingOrder = z.infer<typeof insertMailingOrderSchema>;
export type MailingOrder = typeof mailingOrders.$inferSelect;

// ============================================
// MAILING ORDER PIECES (Individual Mail Pieces)
// ============================================

export const mailingOrderPieces = pgTable("mailing_order_pieces", {
  id: serial("id").primaryKey(),
  mailingOrderId: integer("mailing_order_id").references(() => mailingOrders.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  
  recipientName: text("recipient_name").notNull(),
  recipientAddressLine1: text("recipient_address_line_1").notNull(),
  recipientAddressLine2: text("recipient_address_line_2"),
  recipientCity: text("recipient_city").notNull(),
  recipientState: text("recipient_state").notNull(),
  recipientZipCode: text("recipient_zip_code").notNull(),
  
  lobMailId: text("lob_mail_id"), // Lob's letter/postcard ID
  lobUrl: text("lob_url"), // Preview URL from Lob

  // Attribution tracking — unique 8-char code tied to this mail piece
  trackingCode: text("tracking_code").unique(),

  status: text("status").notNull().default("pending"), // pending, processing, mailed, in_transit, delivered, returned, failed
  
  trackingEvents: jsonb("tracking_events").$type<Array<{
    type: string;
    name: string;
    location?: string;
    timestamp: string;
  }>>(),
  
  expectedDeliveryDate: timestamp("expected_delivery_date"),
  
  errorMessage: text("error_message"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMailingOrderPieceSchema = createInsertSchema(mailingOrderPieces).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lobMailId: true,
  lobUrl: true,
  trackingEvents: true,
  expectedDeliveryDate: true,
});
export type InsertMailingOrderPiece = z.infer<typeof insertMailingOrderPieceSchema>;
export type MailingOrderPiece = typeof mailingOrderPieces.$inferSelect;

// ============================================
// API USAGE LOGS (Cost Tracking)
// ============================================

export const apiUsageLogs = pgTable("api_usage_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  service: text("service").notNull(), // lob, regrid, openai
  action: text("action").notNull(), // e.g., "send_postcard", "parcel_lookup", "chat_completion"
  count: integer("count").default(1),
  estimatedCostCents: integer("estimated_cost_cents").default(0),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertApiUsageLogSchema = createInsertSchema(apiUsageLogs).omit({ id: true, createdAt: true });
export type InsertApiUsageLog = z.infer<typeof insertApiUsageLogSchema>;
export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;

// ============================================
// BORROWER SESSIONS (Session-based auth for borrower portal)
// ============================================

export const borrowerSessions = pgTable("borrower_sessions", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
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
});

export const insertBorrowerMessageSchema = createInsertSchema(borrowerMessages).omit({ id: true, createdAt: true });
export type InsertBorrowerMessage = z.infer<typeof insertBorrowerMessageSchema>;
export type BorrowerMessage = typeof borrowerMessages.$inferSelect;

// ============================================
// DATA SOURCES (Free Data Endpoint Registry)
// ============================================

export const dataSources = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  description: text("description"),
  
  portalUrl: text("portal_url"),
  apiUrl: text("api_url"),
  coverage: text("coverage"),
  
  accessLevel: text("access_level").notNull().default("free"),
  authRequirements: text("auth_requirements"),
  rateLimitNotes: text("rate_limit_notes"),
  costPerCall: integer("cost_per_call").default(0),
  
  dataTypes: text("data_types").array(),
  
  endpointType: text("endpoint_type"),
  queryParams: jsonb("query_params").$type<Record<string, string>>(),
  fieldMappings: jsonb("field_mappings").$type<Record<string, string>>(),
  
  isEnabled: boolean("is_enabled").default(true),
  isVerified: boolean("is_verified").default(false),
  lastVerifiedAt: timestamp("last_verified_at"),
  lastStatus: text("last_status"),
  lastStatusMessage: text("last_status_message"),
  
  freshnessdays: integer("freshness_days").default(30),
  priority: integer("priority").default(100),
  
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDataSourceSchema = createInsertSchema(dataSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDataSource = z.infer<typeof insertDataSourceSchema>;
export type DataSource = typeof dataSources.$inferSelect;

// ============================================
// SUBSCRIPTION EVENTS (Tier change tracking for analytics)
// ============================================

export const subscriptionEvents = pgTable("subscription_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  eventType: text("event_type").notNull(), // 'signup', 'upgrade', 'downgrade', 'cancel', 'reactivate', 'trial_start', 'trial_end'
  fromTier: text("from_tier"), // null for signup
  toTier: text("to_tier"), // null for cancel
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSubscriptionEventSchema = createInsertSchema(subscriptionEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertSubscriptionEvent = z.infer<typeof insertSubscriptionEventSchema>;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;

// ============================================
// DATA SOURCE CACHE (Cached lookups from free sources)
// ============================================

export const dataSourceCache = pgTable("data_source_cache", {
  id: serial("id").primaryKey(),
  dataSourceId: integer("data_source_id").references(() => dataSources.id),
  
  lookupKey: text("lookup_key").notNull(),
  state: text("state"),
  county: text("county"),
  
  data: jsonb("data").$type<Record<string, any>>(),
  
  fetchedAt: timestamp("fetched_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  
  successfulFetch: boolean("successful_fetch").default(true),
  errorMessage: text("error_message"),
});

export const insertDataSourceCacheSchema = createInsertSchema(dataSourceCache).omit({
  id: true,
  fetchedAt: true,
});
export type InsertDataSourceCache = z.infer<typeof insertDataSourceCacheSchema>;
export type DataSourceCache = typeof dataSourceCache.$inferSelect;

// ============================================
// DISCOVERED ENDPOINTS (Live GIS Discovery Results)
// ============================================

export const discoveredEndpoints = pgTable("discovered_endpoints", {
  id: serial("id").primaryKey(),
  
  // Location info
  state: text("state").notNull(), // 2-letter state code
  county: text("county").notNull(),
  
  // Endpoint info
  baseUrl: text("base_url").notNull(),
  endpointType: text("endpoint_type").notNull().default("arcgis_rest"),
  serviceName: text("service_name"), // Name from discovery source
  
  // Discovery metadata
  discoverySource: text("discovery_source").notNull(), // 'arcgis_online', 'open_data_catalog', 'manual'
  discoveryDate: timestamp("discovery_date").defaultNow().notNull(),
  lastChecked: timestamp("last_checked"),
  
  // Validation
  status: text("status").notNull().default("pending"), // pending, validated, rejected, added
  healthCheckPassed: boolean("health_check_passed"),
  healthCheckMessage: text("health_check_message"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  // Additional metadata from discovery
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDiscoveredEndpointSchema = createInsertSchema(discoveredEndpoints).omit({
  id: true,
  createdAt: true,
});
export type InsertDiscoveredEndpoint = z.infer<typeof insertDiscoveredEndpointSchema>;
export type DiscoveredEndpoint = typeof discoveredEndpoints.$inferSelect;

// ============================================
// WORKFLOW AUTOMATION
// ============================================

// Trigger event types for workflows
export const WORKFLOW_TRIGGER_EVENTS = [
  "lead.created",
  "lead.updated", 
  "lead.status_changed",
  "property.created",
  "property.updated",
  "property.status_changed",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "payment.received",
  "payment.missed",
] as const;

export type WorkflowTriggerEvent = typeof WORKFLOW_TRIGGER_EVENTS[number];

// Action types for workflows
export const WORKFLOW_ACTION_TYPES = [
  "send_email",
  "create_task",
  "update_record",
  "run_agent_skill",
  "send_notification",
  "delay",
] as const;

export type WorkflowActionType = typeof WORKFLOW_ACTION_TYPES[number];

// Workflow trigger configuration
export type WorkflowTrigger = {
  event: WorkflowTriggerEvent;
  conditions?: {
    field: string;
    operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "in" | "not_in";
    value: any;
  }[];
};

// Workflow action configuration
export type WorkflowAction = {
  id: string;
  type: WorkflowActionType;
  config: {
    // send_email
    to?: string;
    subject?: string;
    body?: string;
    templateId?: string;
    // create_task
    title?: string;
    description?: string;
    priority?: "low" | "medium" | "high";
    assignedTo?: number;
    dueInDays?: number;
    // update_record
    entityType?: "lead" | "property" | "deal";
    updates?: Record<string, any>;
    // run_agent_skill
    skillId?: string;
    skillParams?: Record<string, any>;
    // send_notification
    message?: string;
    notificationType?: "info" | "warning" | "success";
    // delay
    delayMinutes?: number;
  };
};

// Workflow run statuses
export const WORKFLOW_RUN_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type WorkflowRunStatus = typeof WORKFLOW_RUN_STATUSES[number];

// Workflows table
export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  trigger: jsonb("trigger").$type<WorkflowTrigger>().notNull(),
  actions: jsonb("actions").$type<WorkflowAction[]>().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkflowSchema = createInsertSchema(workflows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflows.$inferSelect;

// Workflow execution log entry
export type WorkflowExecutionLogEntry = {
  actionId: string;
  actionType: WorkflowActionType;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  result?: any;
  error?: string;
};

// Workflow runs table (execution history)
export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflows.id).notNull(),
  status: text("status").$type<WorkflowRunStatus>().notNull().default("pending"),
  triggerData: jsonb("trigger_data").$type<{
    event: WorkflowTriggerEvent;
    entityId?: number;
    entityType?: string;
    data?: Record<string, any>;
    previousData?: Record<string, any>;
  }>(),
  executionLog: jsonb("execution_log").$type<WorkflowExecutionLogEntry[]>(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  error: text("error"),
});

export const insertWorkflowRunSchema = createInsertSchema(workflowRuns).omit({
  id: true,
});
export type InsertWorkflowRun = z.infer<typeof insertWorkflowRunSchema>;
export type WorkflowRun = typeof workflowRuns.$inferSelect;

// ============================================
// SCHEDULED TASKS (Automation with Retry Logic)
// ============================================

// Task types
export const SCHEDULED_TASK_TYPES = ["workflow", "agent_skill", "custom"] as const;
export type ScheduledTaskType = typeof SCHEDULED_TASK_TYPES[number];

// Task statuses
export const SCHEDULED_TASK_STATUSES = ["active", "paused", "failed"] as const;
export type ScheduledTaskStatus = typeof SCHEDULED_TASK_STATUSES[number];

// Simple schedule types
export const SIMPLE_SCHEDULE_TYPES = ["hourly", "daily", "weekly", "monthly"] as const;
export type SimpleScheduleType = typeof SIMPLE_SCHEDULE_TYPES[number];

// Scheduled tasks table
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  type: text("type").$type<ScheduledTaskType>().notNull(), // workflow, agent_skill, custom
  config: jsonb("config").$type<{
    workflowId?: number;
    skillId?: string;
    skillParams?: Record<string, any>;
    customHandler?: string;
    customParams?: Record<string, any>;
  }>().notNull(),
  schedule: text("schedule").notNull(), // cron expression or simple: daily, weekly, hourly, monthly
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  status: text("status").$type<ScheduledTaskStatus>().notNull().default("active"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  retryDelayMinutes: integer("retry_delay_minutes").notNull().default(5),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertScheduledTaskSchema = createInsertSchema(scheduledTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScheduledTask = z.infer<typeof insertScheduledTaskSchema>;
export type ScheduledTask = typeof scheduledTasks.$inferSelect;

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

// Payoff Quotes - Calculate and track payoff amounts
export const payoffQuotes = pgTable("payoff_quotes", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  requestedBy: text("requested_by"),
  principalBalance: numeric("principal_balance").notNull(),
  accruedInterest: numeric("accrued_interest").notNull(),
  fees: numeric("fees").default("0"),
  totalPayoff: numeric("total_payoff").notNull(),
  goodThroughDate: timestamp("good_through_date").notNull(),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayoffQuoteSchema = createInsertSchema(payoffQuotes).omit({ id: true, createdAt: true });
export type InsertPayoffQuote = z.infer<typeof insertPayoffQuoteSchema>;
export type PayoffQuote = typeof payoffQuotes.$inferSelect;

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
});

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
// WRITING STYLE PROFILES
// ============================================

// User writing style profiles - stores learned communication patterns
export const writingStyleProfiles = pgTable("writing_style_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID
  name: text("name").notNull().default("Default Style"),
  isDefault: boolean("is_default").default(true),
  
  // Tone and style characteristics (analyzed from samples)
  toneAnalysis: jsonb("tone_analysis").$type<{
    formality: "casual" | "semi-formal" | "formal"; // detected formality level
    warmth: number; // 0-100 warmth score
    directness: number; // 0-100 how direct vs indirect
    enthusiasm: number; // 0-100 enthusiasm level
    humor: boolean; // uses humor
    empathy: number; // 0-100 empathy level
  }>(),
  
  // Common phrases and patterns
  patterns: jsonb("patterns").$type<{
    greetings: string[]; // common greetings used
    closings: string[]; // common sign-offs
    transitionPhrases: string[]; // how they move between topics
    emphasisStyle: string; // how they emphasize (caps, exclamation, etc.)
    questionStyle: string; // how they ask questions
    commonPhrases: string[]; // frequently used expressions
  }>(),
  
  // Sample messages for few-shot learning
  sampleMessages: jsonb("sample_messages").$type<{
    id: string;
    context: string; // what kind of message (initial outreach, follow-up, negotiation, etc.)
    content: string;
    sentiment: "positive" | "neutral" | "negative";
    addedAt: string;
  }[]>(),
  
  // Preferences
  preferences: jsonb("preferences").$type<{
    maxLength?: number; // preferred message length
    usesEmoji: boolean;
    signatureLine?: string;
    preferredChannels?: string[];
  }>(),
  
  // Training metadata
  totalSamples: integer("total_samples").default(0),
  lastTrainedAt: timestamp("last_trained_at"),
  confidenceScore: numeric("confidence_score").default("0"), // 0-1 how confident in style match
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWritingStyleProfileSchema = createInsertSchema(writingStyleProfiles).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertWritingStyleProfile = z.infer<typeof insertWritingStyleProfileSchema>;
export type WritingStyleProfile = typeof writingStyleProfiles.$inferSelect;

// ============================================
// BROWSER AUTOMATION
// ============================================

// Browser automation job templates - reusable automation recipes
export const browserAutomationTemplates = pgTable("browser_automation_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"), // null = system template
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // county_research, listings, public_records, data_entry
  targetDomain: text("target_domain"), // e.g., "recorder.maricopa.gov"
  
  // Step definitions
  steps: jsonb("steps").$type<{
    order: number;
    action: "navigate" | "click" | "type" | "select" | "wait" | "screenshot" | "extract" | "scroll";
    selector?: string;
    value?: string;
    waitTime?: number;
    extractAs?: string; // variable name to store extracted data
    description: string;
  }[]>(),
  
  // Input/output schema
  inputSchema: jsonb("input_schema").$type<{
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
  }[]>(),
  outputSchema: jsonb("output_schema").$type<{
    name: string;
    type: "string" | "number" | "boolean" | "array" | "object";
    description: string;
  }[]>(),
  
  // Settings
  requiresAuth: boolean("requires_auth").default(false),
  estimatedDurationMs: integer("estimated_duration_ms"),
  isPublic: boolean("is_public").default(false),
  isEnabled: boolean("is_enabled").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBrowserAutomationTemplateSchema = createInsertSchema(browserAutomationTemplates).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertBrowserAutomationTemplate = z.infer<typeof insertBrowserAutomationTemplateSchema>;
export type BrowserAutomationTemplate = typeof browserAutomationTemplates.$inferSelect;

// Browser automation jobs - queued/running automation tasks
export const browserAutomationJobs = pgTable("browser_automation_jobs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  templateId: integer("template_id").references(() => browserAutomationTemplates.id),
  
  // Job details
  name: text("name").notNull(),
  status: text("status").notNull().default("queued"), // queued, running, completed, failed, cancelled
  priority: integer("priority").default(5), // 1-10, lower is higher priority
  
  // Input/output
  inputData: jsonb("input_data").$type<Record<string, any>>(),
  outputData: jsonb("output_data").$type<Record<string, any>>(),
  screenshots: jsonb("screenshots").$type<{
    name: string;
    url: string;
    capturedAt: string;
  }[]>(),
  
  // Error handling
  error: text("error"),
  errorDetails: jsonb("error_details").$type<{
    step?: number;
    selector?: string;
    message: string;
    stack?: string;
  }>(),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  
  // Execution
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  executionTimeMs: integer("execution_time_ms"),
  
  // Agent integration
  triggeredByAgentTaskId: integer("triggered_by_agent_task_id").references(() => agentTasks.id),
  triggeredByUserId: text("triggered_by_user_id"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBrowserAutomationJobSchema = createInsertSchema(browserAutomationJobs).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertBrowserAutomationJob = z.infer<typeof insertBrowserAutomationJobSchema>;
export type BrowserAutomationJob = typeof browserAutomationJobs.$inferSelect;

// Browser session credentials - securely stored credentials for automation
export const browserSessionCredentials = pgTable("browser_session_credentials", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  domain: text("domain").notNull(), // e.g., "facebook.com"
  name: text("name").notNull(), // friendly name
  
  // Encrypted credential storage
  encryptedData: text("encrypted_data"), // encrypted JSON with login details
  
  // Session state
  lastValidatedAt: timestamp("last_validated_at"),
  isValid: boolean("is_valid").default(true),
  validationError: text("validation_error"),
  
  // Usage tracking
  lastUsedAt: timestamp("last_used_at"),
  usageCount: integer("usage_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBrowserSessionCredentialSchema = createInsertSchema(browserSessionCredentials).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertBrowserSessionCredential = z.infer<typeof insertBrowserSessionCredentialSchema>;
export type BrowserSessionCredential = typeof browserSessionCredentials.$inferSelect;

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
// ACQUISITION RADAR - OPPORTUNITY SCORING
// ============================================

// Opportunity types for acquisition radar
export const OPPORTUNITY_TYPES = {
  undervalued: { name: "Undervalued", description: "Listed well below market value", color: "green" },
  motivated_seller: { name: "Motivated Seller", description: "Signs of urgency (estate, divorce, tax issues)", color: "orange" },
  off_market: { name: "Off-Market", description: "Not listed but shows potential (tax delinquent, inherited)", color: "purple" },
  market_shift: { name: "Market Shift", description: "Area experiencing value growth", color: "blue" },
} as const;

export type OpportunityType = keyof typeof OPPORTUNITY_TYPES;

// Radar configuration per organization
export const radarConfigs = pgTable("radar_configs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull().default("Default"),
  isActive: boolean("is_active").default(true),
  
  // Scoring weights (sum to 100)
  weights: jsonb("weights").$type<{
    priceVsAssessed: number; // Weight for price vs assessed value comparison
    daysOnMarket: number; // Weight for DOM scoring
    sellerMotivation: number; // Weight for motivation signals
    marketVelocity: number; // Weight for market activity
    comparableSpreads: number; // Weight for comp analysis
    environmentalRisk: number; // Negative weight for flood/wetland risk
    ownerSignals: number; // Weight for out-of-state, inherited, corporate
  }>().default({
    priceVsAssessed: 25,
    daysOnMarket: 15,
    sellerMotivation: 20,
    marketVelocity: 15,
    comparableSpreads: 15,
    environmentalRisk: -10,
    ownerSignals: 20,
  }),
  
  // Thresholds
  thresholds: jsonb("thresholds").$type<{
    hotOpportunity: number; // Score threshold for "hot" opportunities (default 80)
    goodOpportunity: number; // Score threshold for "good" opportunities (default 60)
    minimumScore: number; // Minimum score to surface (default 40)
    maxDaysOnMarket: number; // Maximum DOM to consider (default 365)
    minPriceDiscount: number; // Minimum discount % below assessed (default 10)
    maxFloodRisk: number; // Maximum flood risk score to accept (default 50)
  }>().default({
    hotOpportunity: 80,
    goodOpportunity: 60,
    minimumScore: 40,
    maxDaysOnMarket: 365,
    minPriceDiscount: 10,
    maxFloodRisk: 50,
  }),
  
  // Target criteria
  targetCriteria: jsonb("target_criteria").$type<{
    states?: string[];
    counties?: string[];
    minAcres?: number;
    maxAcres?: number;
    minPrice?: number;
    maxPrice?: number;
    zoning?: string[];
    opportunityTypes?: OpportunityType[];
  }>(),
  
  // Alert settings
  alertSettings: jsonb("alert_settings").$type<{
    enabled: boolean;
    topNPerMarket: number; // How many top opportunities to alert on per market
    autoTriggerDueDiligence: boolean;
    notifyOnHotOnly: boolean; // Only alert for hot opportunities
    digestFrequency: "realtime" | "hourly" | "daily" | "weekly";
  }>().default({
    enabled: true,
    topNPerMarket: 10,
    autoTriggerDueDiligence: false,
    notifyOnHotOnly: false,
    digestFrequency: "daily",
  }),
  
  // Scanner settings
  scannerSettings: jsonb("scanner_settings").$type<{
    batchSize: number; // Parcels to process per batch
    scanIntervalMinutes: number; // How often to scan
    priorityCounties?: string[]; // Counties to scan more frequently
  }>().default({
    batchSize: 100,
    scanIntervalMinutes: 60,
  }),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRadarConfigSchema = createInsertSchema(radarConfigs).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
});
export type InsertRadarConfig = z.infer<typeof insertRadarConfigSchema>;
export type RadarConfig = typeof radarConfigs.$inferSelect;

// Opportunity scores - stored scored opportunities with explanation
export const opportunityScores = pgTable("opportunity_scores", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  radarConfigId: integer("radar_config_id").references(() => radarConfigs.id),
  
  // Property reference
  propertyId: integer("property_id").references(() => properties.id),
  apn: text("apn"),
  county: text("county"),
  state: text("state"),
  
  // Opportunity classification
  opportunityType: text("opportunity_type").notNull(), // undervalued, motivated_seller, off_market, market_shift
  
  // Overall score (0-100)
  score: integer("score").notNull(),
  previousScore: integer("previous_score"),
  scoreChange: integer("score_change"),
  rank: integer("rank"), // Rank within market/county
  
  // Score breakdown with explainability
  scoreFactors: jsonb("score_factors").$type<{
    priceVsAssessed?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        listPrice?: number;
        assessedValue?: number;
        discountPercent?: number;
        explanation: string;
      };
    };
    daysOnMarket?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        dom: number;
        averageDom?: number;
        explanation: string;
      };
    };
    sellerMotivation?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        signals: string[];
        explanation: string;
      };
    };
    marketVelocity?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        recentSales?: number;
        absorptionRate?: number;
        priceChangePercent?: number;
        explanation: string;
      };
    };
    comparableSpreads?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        avgCompPrice?: number;
        pricePerAcre?: number;
        spreadPercent?: number;
        explanation: string;
      };
    };
    environmentalRisk?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        floodZone?: string;
        wetlandsPercent?: number;
        riskLevel: "low" | "medium" | "high";
        explanation: string;
      };
    };
    ownerSignals?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        isOutOfState?: boolean;
        isInherited?: boolean;
        isTaxDelinquent?: boolean;
        isCorporate?: boolean;
        ownershipYears?: number;
        explanation: string;
      };
    };
  }>(),
  
  // Human-readable explanation
  explanation: text("explanation"), // AI-generated summary of why this is an opportunity
  
  // Data sources used
  dataSources: jsonb("data_sources").$type<{
    sourceId: number;
    sourceName: string;
    fetchedAt: string;
    dataType: string;
  }[]>(),
  
  // Enrichment data snapshot
  enrichmentData: jsonb("enrichment_data").$type<{
    parcelData?: any;
    marketData?: any;
    ownerData?: any;
    environmentalData?: any;
    lastEnriched?: string;
  }>(),
  
  // Action tracking
  status: text("status").notNull().default("new"), // new, reviewed, contacted, in_progress, acquired, passed, expired
  alertSent: boolean("alert_sent").default(false),
  alertSentAt: timestamp("alert_sent_at"),
  dueDiligenceTriggered: boolean("due_diligence_triggered").default(false),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  
  // Validity
  expiresAt: timestamp("expires_at"), // When this score should be recalculated
  isStale: boolean("is_stale").default(false),
  
  scoredAt: timestamp("scored_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOpportunityScoreSchema = createInsertSchema(opportunityScores).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
  scoredAt: true,
});
export type InsertOpportunityScore = z.infer<typeof insertOpportunityScoreSchema>;
export type OpportunityScore = typeof opportunityScores.$inferSelect;

// ============================================
// MARKET INTELLIGENCE - METRICS & PREDICTIONS
// ============================================

// Market health status types
export const MARKET_STATUS = {
  heating: { name: "Heating", description: "Prices rising, high demand", color: "red" },
  stable: { name: "Stable", description: "Balanced market conditions", color: "green" },
  cooling: { name: "Cooling", description: "Prices declining, low demand", color: "blue" },
  volatile: { name: "Volatile", description: "Unpredictable market fluctuations", color: "orange" },
} as const;

export type MarketStatus = keyof typeof MARKET_STATUS;

// Historical market metrics - store market data points over time
export const marketMetrics = pgTable("market_metrics", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  
  // Location
  county: text("county").notNull(),
  state: text("state").notNull(),
  
  // Time period
  metricDate: timestamp("metric_date").notNull(),
  periodType: text("period_type").notNull().default("monthly"), // daily, weekly, monthly, quarterly, yearly
  
  // Sales velocity metrics
  salesVolume: integer("sales_volume"), // Number of sales in period
  averageDaysOnMarket: numeric("average_days_on_market"),
  medianDaysOnMarket: numeric("median_days_on_market"),
  inventoryCount: integer("inventory_count"), // Active listings
  absorptionRate: numeric("absorption_rate"), // Months of inventory
  
  // Price metrics
  medianPricePerAcre: numeric("median_price_per_acre"),
  averagePricePerAcre: numeric("average_price_per_acre"),
  medianSalePrice: numeric("median_sale_price"),
  averageSalePrice: numeric("average_sale_price"),
  priceChangePercent: numeric("price_change_percent"), // Period over period
  yearOverYearChangePercent: numeric("year_over_year_change_percent"),
  
  // Listing metrics
  newListingsCount: integer("new_listings_count"),
  priceReductionsCount: integer("price_reductions_count"),
  withdrawnListingsCount: integer("withdrawn_listings_count"),
  expiredListingsCount: integer("expired_listings_count"),
  
  // Growth indicators
  permitData: jsonb("permit_data").$type<{
    residentialPermits?: number;
    commercialPermits?: number;
    totalPermitValue?: number;
    permitTrend?: "increasing" | "stable" | "decreasing";
  }>(),
  
  populationData: jsonb("population_data").$type<{
    currentPopulation?: number;
    populationChange?: number;
    populationChangePercent?: number;
    migrationRate?: number;
  }>(),
  
  infrastructureData: jsonb("infrastructure_data").$type<{
    newRoadsPlanned?: boolean;
    utilityExpansion?: boolean;
    publicTransitProjects?: boolean;
    majorDevelopments?: string[];
    infrastructureScore?: number;
  }>(),
  
  economicData: jsonb("economic_data").$type<{
    unemploymentRate?: number;
    medianHouseholdIncome?: number;
    jobGrowthRate?: number;
    majorEmployers?: string[];
  }>(),
  
  // Computed scores
  marketHealthScore: integer("market_health_score"), // 0-100
  growthPotentialScore: integer("growth_potential_score"), // 0-100
  investmentScore: integer("investment_score"), // 0-100
  marketStatus: text("market_status"), // heating, cooling, stable, volatile
  
  // Data sources used
  dataSources: jsonb("data_sources").$type<{
    sourceId: number;
    sourceName: string;
    fetchedAt: string;
  }[]>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMarketMetricSchema = createInsertSchema(marketMetrics).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
});
export type InsertMarketMetric = z.infer<typeof insertMarketMetricSchema>;
export type MarketMetric = typeof marketMetrics.$inferSelect;

// Market predictions - store predictions with accuracy tracking
export const marketPredictions = pgTable("market_predictions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  
  // Location
  county: text("county").notNull(),
  state: text("state").notNull(),
  
  // Prediction details
  predictionType: text("prediction_type").notNull(), // price_direction, market_status, growth_potential
  predictionDate: timestamp("prediction_date").notNull().defaultNow(),
  targetDate: timestamp("target_date").notNull(), // When prediction is for
  horizonMonths: integer("horizon_months").notNull(), // 3, 6, 12 months
  
  // Predictions
  predictedValue: numeric("predicted_value"), // Numeric prediction (e.g., price per acre)
  predictedDirection: text("predicted_direction"), // up, down, stable
  predictedChangePercent: numeric("predicted_change_percent"),
  predictedMarketStatus: text("predicted_market_status"), // heating, cooling, stable
  confidenceScore: integer("confidence_score"), // 0-100
  
  // Prediction factors
  predictionFactors: jsonb("prediction_factors").$type<{
    historicalTrend?: {
      weight: number;
      value: number;
      direction: string;
    };
    salesVelocity?: {
      weight: number;
      value: number;
      trend: string;
    };
    inventoryLevels?: {
      weight: number;
      value: number;
      trend: string;
    };
    pricePerAcreTrend?: {
      weight: number;
      value: number;
      trend: string;
    };
    growthIndicators?: {
      weight: number;
      permitScore: number;
      populationScore: number;
      infrastructureScore: number;
    };
    economicFactors?: {
      weight: number;
      unemploymentTrend: string;
      incomeGrowth: number;
    };
    seasonalAdjustment?: {
      weight: number;
      factor: number;
    };
  }>(),
  
  // Model info
  modelVersion: text("model_version").default("v1"),
  algorithmUsed: text("algorithm_used"), // weighted_average, regression, ml_ensemble
  
  // Accuracy tracking (filled in when prediction period ends)
  actualValue: numeric("actual_value"),
  actualDirection: text("actual_direction"),
  actualChangePercent: numeric("actual_change_percent"),
  predictionError: numeric("prediction_error"), // Difference between predicted and actual
  accuracyScore: integer("accuracy_score"), // 0-100 accuracy rating
  
  // Status
  status: text("status").notNull().default("active"), // active, expired, verified
  verifiedAt: timestamp("verified_at"),
  
  // Alert tracking
  alertTriggered: boolean("alert_triggered").default(false),
  alertTriggeredAt: timestamp("alert_triggered_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMarketPredictionSchema = createInsertSchema(marketPredictions).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
});
export type InsertMarketPrediction = z.infer<typeof insertMarketPredictionSchema>;
export type MarketPrediction = typeof marketPredictions.$inferSelect;

// ============================================
// TAX SALE RESEARCH
// ============================================

// Tax Sale Types
export const TAX_SALE_TYPES = {
  lien: { name: "Tax Lien", description: "Purchase of tax debt, property may be redeemed" },
  deed: { name: "Tax Deed", description: "Direct property ownership after foreclosure" },
  redeemable_deed: { name: "Redeemable Tax Deed", description: "Deed purchase with redemption period" },
  hybrid: { name: "Hybrid", description: "State with both lien and deed options" },
} as const;

export type TaxSaleType = keyof typeof TAX_SALE_TYPES;

// Redemption risk levels
export const REDEMPTION_RISK_LEVELS = {
  very_low: { name: "Very Low", description: "Owner unlikely to redeem", score: [0, 20] },
  low: { name: "Low", description: "Low chance of redemption", score: [21, 40] },
  moderate: { name: "Moderate", description: "Moderate redemption chance", score: [41, 60] },
  high: { name: "High", description: "High chance owner will redeem", score: [61, 80] },
  very_high: { name: "Very High", description: "Owner very likely to redeem", score: [81, 100] },
} as const;

export type RedemptionRiskLevel = keyof typeof REDEMPTION_RISK_LEVELS;

// Tax Sale Auctions - store auction calendar data
export const taxSaleAuctions = pgTable("tax_sale_auctions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  
  county: text("county").notNull(),
  state: text("state").notNull(),
  
  auctionType: text("auction_type").notNull(), // lien, deed, redeemable_deed
  auctionDate: timestamp("auction_date").notNull(),
  auctionEndDate: timestamp("auction_end_date"),
  registrationDeadline: timestamp("registration_deadline"),
  
  auctionFormat: text("auction_format").notNull().default("in_person"), // in_person, online, sealed_bid
  auctionUrl: text("auction_url"),
  venueAddress: text("venue_address"),
  venueName: text("venue_name"),
  
  minimumBid: numeric("minimum_bid"),
  depositRequired: numeric("deposit_required"),
  premiumRate: numeric("premium_rate"),
  interestRate: numeric("interest_rate"),
  redemptionPeriodMonths: integer("redemption_period_months"),
  
  parcelCount: integer("parcel_count"),
  totalTaxOwed: numeric("total_tax_owed"),
  
  contactInfo: jsonb("contact_info").$type<{
    name?: string;
    phone?: string;
    email?: string;
    website?: string;
  }>(),
  
  requirements: jsonb("requirements").$type<{
    registrationRequired?: boolean;
    depositAmount?: number;
    acceptedPaymentMethods?: string[];
    residencyRequired?: boolean;
    disclaimers?: string[];
  }>(),
  
  sourceUrl: text("source_url"),
  lastScrapedAt: timestamp("last_scraped_at"),
  scrapeStatus: text("scrape_status").default("pending"), // pending, success, failed, stale
  
  status: text("status").notNull().default("scheduled"), // scheduled, in_progress, completed, cancelled, postponed
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Tax Sale Listings - store individual tax sale opportunities
export const taxSaleListings = pgTable("tax_sale_listings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  auctionId: integer("auction_id").references(() => taxSaleAuctions.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  apn: text("apn").notNull(),
  county: text("county").notNull(),
  state: text("state").notNull(),
  
  address: text("address"),
  city: text("city"),
  zip: text("zip"),
  legalDescription: text("legal_description"),
  
  saleType: text("sale_type").notNull(), // lien, deed, redeemable_deed
  
  taxYearsDelinquent: text("tax_years_delinquent").array(),
  totalTaxOwed: numeric("total_tax_owed").notNull(),
  penalties: numeric("penalties"),
  interest: numeric("interest"),
  fees: numeric("fees"),
  totalAmountDue: numeric("total_amount_due"),
  
  minimumBid: numeric("minimum_bid"),
  openingBid: numeric("opening_bid"),
  winningBid: numeric("winning_bid"),
  
  assessedValue: numeric("assessed_value"),
  marketValue: numeric("market_value"),
  acreage: numeric("acreage"),
  propertyType: text("property_type"), // vacant_land, residential, commercial, agricultural
  zoning: text("zoning"),
  
  ownerName: text("owner_name"),
  ownerAddress: text("owner_address"),
  ownerIsOutOfState: boolean("owner_is_out_of_state"),
  ownerIsCorporate: boolean("owner_is_corporate"),
  
  redemptionPeriodMonths: integer("redemption_period_months"),
  redemptionDeadline: timestamp("redemption_deadline"),
  interestRate: numeric("interest_rate"),
  
  redemptionRiskScore: integer("redemption_risk_score"), // 0-100
  redemptionRiskLevel: text("redemption_risk_level"), // very_low, low, moderate, high, very_high
  redemptionFactors: jsonb("redemption_factors").$type<{
    propertyValueVsTax?: { score: number; ratio: number; explanation: string };
    ownerIndicators?: { score: number; signals: string[]; explanation: string };
    propertyType?: { score: number; type: string; explanation: string };
    countyRedemptionRate?: { score: number; rate: number; explanation: string };
    timeRemaining?: { score: number; months: number; explanation: string };
    overallExplanation: string;
  }>(),
  
  estimatedRoi: numeric("estimated_roi"),
  roiCalculation: jsonb("roi_calculation").$type<{
    investmentAmount: number;
    interestIfRedeemed: number;
    propertyValueIfNotRedeemed: number;
    estimatedHoldingCosts: number;
    bestCaseRoi: number;
    worstCaseRoi: number;
    expectedRoi: number;
    assumptions: string[];
  }>(),
  
  opportunityScore: integer("opportunity_score"), // 0-100 overall score
  opportunityFactors: jsonb("opportunity_factors").$type<{
    roiPotential?: { score: number; explanation: string };
    riskLevel?: { score: number; explanation: string };
    propertyQuality?: { score: number; explanation: string };
    marketConditions?: { score: number; explanation: string };
  }>(),
  
  status: text("status").notNull().default("available"), // available, watching, bid_placed, won, lost, redeemed, acquired
  watchlistAddedAt: timestamp("watchlist_added_at"),
  bidAmount: numeric("bid_amount"),
  bidDate: timestamp("bid_date"),
  
  sourceUrl: text("source_url"),
  certificateNumber: text("certificate_number"),
  
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Tax Sale Alerts - subscription to tax sale opportunities
export const taxSaleAlerts = pgTable("tax_sale_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true),
  
  criteria: jsonb("criteria").$type<{
    states?: string[];
    counties?: string[];
    saleTypes?: TaxSaleType[];
    minAssessedValue?: number;
    maxAssessedValue?: number;
    maxTaxOwed?: number;
    minAcreage?: number;
    maxAcreage?: number;
    propertyTypes?: string[];
    maxRedemptionRisk?: RedemptionRiskLevel;
    minEstimatedRoi?: number;
    auctionDateRange?: { start: string; end: string };
  }>(),
  
  notificationPreferences: jsonb("notification_preferences").$type<{
    email?: boolean;
    sms?: boolean;
    inApp?: boolean;
    frequency?: "immediate" | "daily" | "weekly";
  }>(),
  
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Historical redemption rates by county - for prediction
export const countyRedemptionRates = pgTable("county_redemption_rates", {
  id: serial("id").primaryKey(),
  
  county: text("county").notNull(),
  state: text("state").notNull(),
  year: integer("year").notNull(),
  
  saleType: text("sale_type").notNull(), // lien, deed
  
  totalSales: integer("total_sales"),
  totalRedemptions: integer("total_redemptions"),
  redemptionRate: numeric("redemption_rate"),
  
  averageRedemptionMonths: numeric("average_redemption_months"),
  averageTaxAmount: numeric("average_tax_amount"),
  averagePropertyValue: numeric("average_property_value"),
  
  dataSource: text("data_source"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTaxSaleAuctionSchema = createInsertSchema(taxSaleAuctions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTaxSaleAuction = z.infer<typeof insertTaxSaleAuctionSchema>;
export type TaxSaleAuction = typeof taxSaleAuctions.$inferSelect;

export const insertTaxSaleListingSchema = createInsertSchema(taxSaleListings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTaxSaleListing = z.infer<typeof insertTaxSaleListingSchema>;
export type TaxSaleListing = typeof taxSaleListings.$inferSelect;

export const insertTaxSaleAlertSchema = createInsertSchema(taxSaleAlerts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTaxSaleAlert = z.infer<typeof insertTaxSaleAlertSchema>;
export type TaxSaleAlert = typeof taxSaleAlerts.$inferSelect;

export const insertCountyRedemptionRateSchema = createInsertSchema(countyRedemptionRates).omit({
  id: true,
  createdAt: true,
});
export type InsertCountyRedemptionRate = z.infer<typeof insertCountyRedemptionRateSchema>;
export type CountyRedemptionRate = typeof countyRedemptionRates.$inferSelect;

// ============================================
// PHASE 3: DUE DILIGENCE, INTENT, PRICING, PATTERNS
// ============================================

// Due Diligence Dossiers - investor-ready property reports
export const dueDiligenceDossiers = pgTable("due_diligence_dossiers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Request details
  requestedBy: integer("requested_by"), // team member who requested
  priority: text("priority").notNull().default("normal"), // urgent, high, normal, low
  
  // Pod execution tracking
  status: text("status").notNull().default("queued"), // queued, running, completed, failed
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  
  // Multi-agent pod assignment
  agentsAssigned: jsonb("agents_assigned").$type<{
    titleSearch?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    taxAnalysis?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    environmentalCheck?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    zoningReview?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    accessAnalysis?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    marketComps?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    ownerResearch?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
  }>(),
  
  // Aggregated findings
  findings: jsonb("findings").$type<{
    titleStatus?: { clear: boolean; issues?: string[]; liens?: string[]; encumbrances?: string[] };
    taxStatus?: { current: boolean; amountDue?: number; yearsDelinquent?: number; specialAssessments?: string[] };
    environmental?: { clean: boolean; concerns?: string[]; wetlands?: boolean; floodZone?: string };
    zoning?: { current: string; allowedUses?: string[]; restrictions?: string[]; overlays?: string[] };
    access?: { type: string; legal: boolean; easements?: string[]; roadMaintenance?: string };
    comps?: { medianPrice?: number; pricePerAcre?: number; salesCount?: number; trend?: string };
    owner?: { name: string; type: string; contactInfo?: string; motivationSignals?: string[] };
  }>(),
  
  // Scores and recommendations
  investabilityScore: integer("investability_score"), // 0-100 overall score
  riskScore: integer("risk_score"), // 0-100 (higher = more risky)
  
  scoreBreakdown: jsonb("score_breakdown").$type<{
    titleScore: number;
    taxScore: number;
    environmentalScore: number;
    zoningScore: number;
    accessScore: number;
    marketScore: number;
    ownerScore: number;
  }>(),
  
  recommendation: text("recommendation"), // strong_buy, buy, hold, pass, avoid
  recommendationReasoning: text("recommendation_reasoning"),
  
  // Red flags and highlights
  redFlags: jsonb("red_flags").$type<string[]>(),
  greenFlags: jsonb("green_flags").$type<string[]>(),
  
  // AI-generated summary
  executiveSummary: text("executive_summary"),
  detailedReport: text("detailed_report"),
  
  // Cost tracking
  apiCostsIncurred: numeric("api_costs_incurred"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Seller Intent Predictions - score likelihood of accepting offers
export const sellerIntentPredictions = pgTable("seller_intent_predictions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  
  // Overall intent score
  intentScore: integer("intent_score").notNull(), // 0-100
  intentLevel: text("intent_level").notNull(), // very_high, high, moderate, low, very_low
  
  // Prediction confidence
  confidence: numeric("confidence").notNull(), // 0-1
  
  // Signal breakdown
  signals: jsonb("signals").$type<{
    // Urgency signals
    urgency?: {
      score: number;
      indicators: string[];
      mentions?: string[]; // "need to sell fast", "relocating", etc.
    };
    // Financial motivation
    financial?: {
      score: number;
      indicators: string[];
      taxDelinquent?: boolean;
      estimatedEquity?: number;
    };
    // Emotional/personal signals
    emotional?: {
      score: number;
      indicators: string[];
      lifeEvent?: string; // divorce, inheritance, retirement
    };
    // Engagement signals
    engagement?: {
      score: number;
      responseRate?: number;
      responseSpeed?: number; // avg hours to respond
      questionTypes?: string[];
    };
    // Price flexibility signals
    priceFlexibility?: {
      score: number;
      hasCountered?: boolean;
      counterPattern?: string;
      anchorAcceptance?: number;
    };
    // Competitive signals
    competition?: {
      score: number;
      otherOffersmentioned?: boolean;
      marketingProperty?: boolean;
    };
  }>(),
  
  // Historical accuracy (for learning)
  actualOutcome: text("actual_outcome"), // accepted, rejected, countered, no_response, withdrew
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
  predictionAccurate: boolean("prediction_accurate"),
  
  // Recommended approach
  recommendedApproach: text("recommended_approach"), // aggressive, standard, patient, walk_away
  approachReasoning: text("approach_reasoning"),
  suggestedOfferRange: jsonb("suggested_offer_range").$type<{
    min: number;
    optimal: number;
    max: number;
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Price Recommendations - optimal offer/list price suggestions
export const priceRecommendations = pgTable("price_recommendations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Type of recommendation
  recommendationType: text("recommendation_type").notNull(), // acquisition_offer, disposition_list, counter_offer
  
  // Price recommendations
  recommendedPrice: numeric("recommended_price").notNull(),
  priceRangeMin: numeric("price_range_min").notNull(),
  priceRangeMax: numeric("price_range_max").notNull(),
  
  // Confidence
  confidence: numeric("confidence").notNull(), // 0-1
  
  // Analysis inputs
  comparablesSummary: jsonb("comparables_summary").$type<{
    count: number;
    medianPricePerAcre: number;
    avgDaysOnMarket?: number;
    recentTrend?: string;
    comps?: Array<{
      apn: string;
      salePrice: number;
      acres: number;
      pricePerAcre: number;
      saleDate: string;
      distance?: number;
      similarityScore?: number;
    }>;
  }>(),
  
  // Adjustment factors
  adjustments: jsonb("adjustments").$type<{
    sizeAdjustment?: { factor: number; reason: string };
    accessAdjustment?: { factor: number; reason: string };
    zoningAdjustment?: { factor: number; reason: string };
    utilitiesAdjustment?: { factor: number; reason: string };
    terrainAdjustment?: { factor: number; reason: string };
    marketTrendAdjustment?: { factor: number; reason: string };
    sellerMotivationAdjustment?: { factor: number; reason: string };
    holdingCostAdjustment?: { factor: number; reason: string };
  }>(),
  
  // Strategic factors
  strategy: jsonb("strategy").$type<{
    targetMargin?: number; // desired profit margin
    competitionLevel?: string;
    marketTiming?: string;
    negotiationRoom?: number; // % buffer for negotiation
    quickSaleDiscount?: number; // discount for faster sale
  }>(),
  
  // AI reasoning
  reasoning: text("reasoning"),
  
  // Outcome tracking
  actualPrice: numeric("actual_price"),
  priceAccepted: boolean("price_accepted"),
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Deal Patterns - historical patterns for similarity matching
export const dealPatterns = pgTable("deal_patterns", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  
  // Pattern fingerprint for similarity matching
  fingerprint: jsonb("fingerprint").$type<{
    // Property characteristics
    property: {
      acreage: number;
      county: string;
      state: string;
      zoning?: string;
      terrain?: string;
      roadAccess?: string;
      utilities?: string[];
    };
    // Deal metrics
    deal: {
      type: string; // acquisition/disposition
      offerToAskRatio?: number;
      daysToClose?: number;
      negotiationRounds?: number;
      finalMargin?: number;
    };
    // Seller characteristics
    seller?: {
      type?: string; // individual, corporate, estate
      motivation?: string[];
      responsePattern?: string;
    };
    // Market context
    market?: {
      pricePerAcre: number;
      marketTrend?: string;
      competitionLevel?: string;
    };
  }>(),
  
  // Outcome
  outcome: text("outcome").notNull(), // success, partial_success, failure
  profitAmount: numeric("profit_amount"),
  roiPercent: numeric("roi_percent"),
  daysToComplete: integer("days_to_complete"),
  
  // Lessons learned
  successFactors: jsonb("success_factors").$type<string[]>(),
  challengesFaced: jsonb("challenges_faced").$type<string[]>(),
  lessonsLearned: jsonb("lessons_learned").$type<string[]>(),
  
  // Pattern usage tracking
  timesMatched: integer("times_matched").default(0),
  matchSuccessRate: numeric("match_success_rate"),
  
  // Embedding for similarity search (vector representation)
  embeddingVector: jsonb("embedding_vector").$type<number[]>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Deal Pattern Matches - when we find similar deals
export const dealPatternMatches = pgTable("deal_pattern_matches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Current property/deal being analyzed
  targetPropertyId: integer("target_property_id").references(() => properties.id),
  targetDealId: integer("target_deal_id").references(() => deals.id),
  
  // Matched historical pattern
  patternId: integer("pattern_id").references(() => dealPatterns.id).notNull(),
  
  // Similarity metrics
  similarityScore: numeric("similarity_score").notNull(), // 0-1
  matchedDimensions: jsonb("matched_dimensions").$type<{
    propertyMatch: number;
    dealMatch: number;
    sellerMatch: number;
    marketMatch: number;
  }>(),
  
  // Insights derived
  insights: jsonb("insights").$type<{
    recommendedOffer?: number;
    expectedNegotiationRounds?: number;
    estimatedDaysToClose?: number;
    suggestedApproach?: string;
    watchOutFor?: string[];
    leveragePoints?: string[];
  }>(),
  
  // Outcome tracking
  insightsApplied: boolean("insights_applied").default(false),
  actualOutcome: text("actual_outcome"),
  insightHelpful: boolean("insight_helpful"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDueDiligenceDossierSchema = createInsertSchema(dueDiligenceDossiers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDueDiligenceDossier = z.infer<typeof insertDueDiligenceDossierSchema>;
export type DueDiligenceDossier = typeof dueDiligenceDossiers.$inferSelect;

export const insertSellerIntentPredictionSchema = createInsertSchema(sellerIntentPredictions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSellerIntentPrediction = z.infer<typeof insertSellerIntentPredictionSchema>;
export type SellerIntentPrediction = typeof sellerIntentPredictions.$inferSelect;

export const insertPriceRecommendationSchema = createInsertSchema(priceRecommendations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPriceRecommendation = z.infer<typeof insertPriceRecommendationSchema>;
export type PriceRecommendation = typeof priceRecommendations.$inferSelect;

export const insertDealPatternSchema = createInsertSchema(dealPatterns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDealPattern = z.infer<typeof insertDealPatternSchema>;
export type DealPattern = typeof dealPatterns.$inferSelect;

export const insertDealPatternMatchSchema = createInsertSchema(dealPatternMatches).omit({
  id: true,
  createdAt: true,
});
export type InsertDealPatternMatch = z.infer<typeof insertDealPatternMatchSchema>;
export type DealPatternMatch = typeof dealPatternMatches.$inferSelect;

// ============================================
// PHASE 4: NEGOTIATION, SEQUENCES, VOICE/CALL AI
// ============================================

// Negotiation Sessions - AI-assisted negotiation tracking
export const negotiationSessions = pgTable("negotiation_sessions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  
  status: text("status").notNull().default("active"), // active, paused, won, lost, stalled
  
  // Current negotiation state
  currentOfferAmount: numeric("current_offer_amount"),
  sellerAskAmount: numeric("seller_ask_amount"),
  lastCounterAmount: numeric("last_counter_amount"),
  negotiationRound: integer("negotiation_round").default(1),
  
  // Objection handling
  objections: jsonb("objections").$type<Array<{
    id: string;
    text: string;
    category: string; // price, timing, trust, emotional, competitive
    detectedAt: string;
    responseUsed?: string;
    resolved: boolean;
    effectiveness?: number;
  }>>(),
  
  // AI-generated responses
  suggestedResponses: jsonb("suggested_responses").$type<Array<{
    id: string;
    text: string;
    strategy: string; // empathy, logic, urgency, anchor, silence
    confidence: number;
    generatedAt: string;
    used: boolean;
    outcome?: string;
  }>>(),
  
  // Counter-offer history
  counterOfferHistory: jsonb("counter_offer_history").$type<Array<{
    round: number;
    ourOffer: number;
    theirCounter?: number;
    timestamp: string;
    notes?: string;
  }>>(),
  
  // Sentiment tracking
  sentimentHistory: jsonb("sentiment_history").$type<Array<{
    timestamp: string;
    score: number; // -1 to 1
    indicators: string[];
  }>>(),
  
  // Outcome tracking
  outcome: text("outcome"), // accepted, rejected, walked_away, ghosted
  finalAmount: numeric("final_amount"),
  profitMargin: numeric("profit_margin"),
  lessonsLearned: text("lessons_learned"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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

export const insertNegotiationSessionSchema = createInsertSchema(negotiationSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNegotiationSession = z.infer<typeof insertNegotiationSessionSchema>;
export type NegotiationSession = typeof negotiationSessions.$inferSelect;

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
// PHASE 5: PORTFOLIO, DOCUMENTS, CASH FLOW, COMPLIANCE
// ============================================

// Portfolio Monitoring Alerts - proactive alerts for owned properties
export const portfolioAlerts = pgTable("portfolio_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  alertType: text("alert_type").notNull(), // tax_due, market_change, competitor_activity, maintenance, document_expiring, compliance
  severity: text("severity").notNull().default("medium"), // low, medium, high, critical
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Alert details
  triggeredBy: text("triggered_by"), // system, scheduled, market_event
  triggerData: jsonb("trigger_data").$type<{
    previousValue?: any;
    currentValue?: any;
    threshold?: any;
    changePercent?: number;
    source?: string;
  }>(),
  
  // Status
  status: text("status").notNull().default("active"), // active, acknowledged, resolved, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: integer("acknowledged_by"),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"),
  
  // Suggested actions
  suggestedActions: jsonb("suggested_actions").$type<Array<{
    action: string;
    priority: string;
    estimatedImpact?: string;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Document Intelligence - parsed documents
export const documentAnalysis = pgTable("document_analysis", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  dealId: integer("deal_id").references(() => deals.id),
  
  // Document info
  documentType: text("document_type").notNull(), // deed, contract, title_report, survey, note, mortgage, tax_bill, closing_statement
  documentName: text("document_name").notNull(),
  fileUrl: text("file_url"),
  fileHash: text("file_hash"), // for deduplication
  
  // Extraction status
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  processedAt: timestamp("processed_at"),
  
  // Raw content
  rawText: text("raw_text"),
  ocrConfidence: numeric("ocr_confidence"),
  
  // Extracted data (varies by document type)
  extractedData: jsonb("extracted_data").$type<{
    // For deeds
    grantorName?: string;
    granteeName?: string;
    legalDescription?: string;
    recordingInfo?: { book?: string; page?: string; date?: string };
    considerationAmount?: number;
    
    // For contracts
    buyerName?: string;
    sellerName?: string;
    purchasePrice?: number;
    closingDate?: string;
    contingencies?: string[];
    deadlines?: Array<{ name: string; date: string }>;
    
    // For notes/mortgages
    principalAmount?: number;
    interestRate?: number;
    term?: number;
    paymentAmount?: number;
    maturityDate?: string;
    collateralDescription?: string;
    
    // For tax bills
    taxYear?: number;
    assessedValue?: number;
    taxAmount?: number;
    dueDate?: string;
    exemptions?: string[];
    
    // Common
    parties?: Array<{ name: string; role: string }>;
    dates?: Array<{ label: string; date: string }>;
    amounts?: Array<{ label: string; amount: number }>;
    signatures?: string[];
  }>(),
  
  // Key terms/clauses extracted
  keyTerms: jsonb("key_terms").$type<Array<{
    term: string;
    value: string;
    importance: string;
    pageNumber?: number;
  }>>(),
  
  // Risk analysis
  riskFlags: jsonb("risk_flags").$type<Array<{
    issue: string;
    severity: string;
    recommendation: string;
  }>>(),
  
  // Version tracking
  version: integer("version").default(1),
  previousVersionId: integer("previous_version_id"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Cash Flow Forecasts - projected income/expenses
export const cashFlowForecasts = pgTable("cash_flow_forecasts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  // Forecast period
  forecastDate: timestamp("forecast_date").notNull(),
  forecastPeriodMonths: integer("forecast_period_months").notNull().default(12),
  
  // Income projections
  projectedIncome: jsonb("projected_income").$type<Array<{
    month: string;
    expectedAmount: number;
    probability: number;
    source: string; // note_payment, interest, sale_proceeds
    notes?: string;
  }>>(),
  
  // Expense projections
  projectedExpenses: jsonb("projected_expenses").$type<Array<{
    month: string;
    amount: number;
    category: string; // taxes, insurance, maintenance, legal, marketing
    notes?: string;
  }>>(),
  
  // Summary metrics
  totalProjectedIncome: numeric("total_projected_income"),
  totalProjectedExpenses: numeric("total_projected_expenses"),
  netCashFlow: numeric("net_cash_flow"),
  
  // Risk analysis
  paymentRiskScore: integer("payment_risk_score"), // 0-100 (higher = more risky)
  riskFactors: jsonb("risk_factors").$type<Array<{
    factor: string;
    impact: string;
    mitigation?: string;
  }>>(),
  
  // Payment health for notes
  paymentHealth: jsonb("payment_health").$type<{
    onTimePayments: number;
    latePayments: number;
    missedPayments: number;
    averageDaysLate?: number;
    paymentPattern?: string; // consistent, declining, improving, erratic
    defaultProbability?: number;
  }>(),
  
  // AI insights
  insights: jsonb("insights").$type<Array<{
    type: string;
    message: string;
    urgency: string;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Compliance Rules - county-specific regulations
export const complianceRules = pgTable("compliance_rules", {
  id: serial("id").primaryKey(),
  
  // Jurisdiction
  state: text("state").notNull(),
  county: text("county"),
  municipality: text("municipality"),
  
  // Rule details
  ruleType: text("rule_type").notNull(), // subdivision, building, zoning, environmental, disclosure, recording, tax
  ruleName: text("rule_name").notNull(),
  ruleDescription: text("rule_description"),
  
  // Requirements
  requirements: jsonb("requirements").$type<Array<{
    requirement: string;
    mandatory: boolean;
    deadline?: string;
    fee?: number;
    authority?: string;
  }>>(),
  
  // Thresholds and triggers
  triggers: jsonb("triggers").$type<{
    acreageMin?: number;
    acreageMax?: number;
    transactionType?: string[];
    propertyType?: string[];
    useType?: string[];
    priceThreshold?: number;
  }>(),
  
  // Penalties
  penalties: jsonb("penalties").$type<{
    description: string;
    fineRange?: { min: number; max: number };
    otherConsequences?: string[];
  }>(),
  
  // References
  sourceUrl: text("source_url"),
  lastVerified: timestamp("last_verified"),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
  
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Compliance Checks - property-specific compliance status
export const complianceChecks = pgTable("compliance_checks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  ruleId: integer("rule_id").references(() => complianceRules.id),
  
  // Check details
  checkType: text("check_type").notNull(),
  checkDescription: text("check_description"),
  
  // Status
  status: text("status").notNull().default("pending"), // pending, compliant, non_compliant, not_applicable, needs_review
  
  // Findings
  findings: jsonb("findings").$type<{
    isCompliant: boolean;
    issues?: string[];
    requiredActions?: string[];
    estimatedCost?: number;
    deadline?: string;
  }>(),
  
  // Resolution
  resolvedAt: timestamp("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  
  // Review info
  lastCheckedAt: timestamp("last_checked_at"),
  nextCheckDue: timestamp("next_check_due"),
  checkedBy: text("checked_by"), // system or user id
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPortfolioAlertSchema = createInsertSchema(portfolioAlerts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPortfolioAlert = z.infer<typeof insertPortfolioAlertSchema>;
export type PortfolioAlert = typeof portfolioAlerts.$inferSelect;

export const insertDocumentAnalysisSchema = createInsertSchema(documentAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDocumentAnalysis = z.infer<typeof insertDocumentAnalysisSchema>;
export type DocumentAnalysis = typeof documentAnalysis.$inferSelect;

export const insertCashFlowForecastSchema = createInsertSchema(cashFlowForecasts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCashFlowForecast = z.infer<typeof insertCashFlowForecastSchema>;
export type CashFlowForecast = typeof cashFlowForecasts.$inferSelect;

export const insertComplianceRuleSchema = createInsertSchema(complianceRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertComplianceRule = z.infer<typeof insertComplianceRuleSchema>;
export type ComplianceRule = typeof complianceRules.$inferSelect;

export const insertComplianceCheckSchema = createInsertSchema(complianceChecks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertComplianceCheck = z.infer<typeof insertComplianceCheckSchema>;
export type ComplianceCheck = typeof complianceChecks.$inferSelect;

// ============================================
// PHASE 6: BUYER MATCHING, QUALIFICATION, DISPOSITION
// ============================================

// Buyer Profiles - ideal buyer characteristics for matching
export const buyerProfiles = pgTable("buyer_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  
  // Profile type
  profileType: text("profile_type").notNull().default("individual"), // individual, investor, developer, builder
  
  // Property preferences
  preferences: jsonb("preferences").$type<{
    minAcreage?: number;
    maxAcreage?: number;
    minPrice?: number;
    maxPrice?: number;
    states?: string[];
    counties?: string[];
    zoningTypes?: string[];
    useTypes?: string[]; // residential, commercial, agricultural, recreational
    roadAccess?: string[];
    utilities?: string[];
    terrainTypes?: string[];
    waterFeatures?: boolean;
  }>(),
  
  // Financial capacity
  financialInfo: jsonb("financial_info").$type<{
    budget?: number;
    preApproved?: boolean;
    preApprovalAmount?: number;
    financingType?: string; // cash, owner_finance, conventional, hard_money
    downPaymentCapacity?: number;
    monthlyPaymentCapacity?: number;
    creditScoreRange?: string;
  }>(),
  
  // Buyer intent
  intent: jsonb("intent").$type<{
    purchaseTimeline?: string; // immediate, 1_month, 3_months, 6_months, just_looking
    primaryUse?: string;
    investmentGoal?: string; // flip, hold, develop, recreation
    urgency?: number; // 1-10
    previousPurchases?: number;
  }>(),
  
  // Engagement history
  engagement: jsonb("engagement").$type<{
    propertiesViewed?: number[];
    propertiesFavorited?: number[];
    inquiriesMade?: number;
    lastContactDate?: string;
    preferredContactMethod?: string;
    responsiveness?: string; // high, medium, low
  }>(),
  
  // AI-computed scores
  qualificationScore: integer("qualification_score"), // 0-100
  matchConfidence: integer("match_confidence"), // 0-100 overall match quality
  
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Buyer-Property Matches - AI-generated matches
export const buyerPropertyMatches = pgTable("buyer_property_matches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  buyerProfileId: integer("buyer_profile_id").references(() => buyerProfiles.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Match quality
  matchScore: integer("match_score").notNull(), // 0-100
  matchFactors: jsonb("match_factors").$type<{
    priceMatch: number; // 0-100
    sizeMatch: number;
    locationMatch: number;
    zoningMatch: number;
    featureMatch: number;
    financingMatch: number;
  }>(),
  
  // Match details
  matchReasons: jsonb("match_reasons").$type<string[]>(),
  potentialConcerns: jsonb("potential_concerns").$type<string[]>(),
  suggestedPitch: text("suggested_pitch"),
  
  // Status
  status: text("status").notNull().default("pending"), // pending, presented, interested, not_interested, purchased
  presentedAt: timestamp("presented_at"),
  buyerResponse: text("buyer_response"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Buyer Qualifications - pre-screening results
export const buyerQualifications = pgTable("buyer_qualifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  buyerProfileId: integer("buyer_profile_id").references(() => buyerProfiles.id).notNull(),
  
  // Qualification checks
  checks: jsonb("checks").$type<{
    financialVerified?: boolean;
    identityVerified?: boolean;
    proofOfFunds?: boolean;
    preApprovalLetter?: boolean;
    references?: boolean;
    backgroundCheck?: boolean;
  }>(),
  
  // Financing readiness
  financingReadiness: jsonb("financing_readiness").$type<{
    cashAvailable?: number;
    preApprovalStatus?: string;
    creditStatus?: string;
    debtToIncome?: number;
    downPaymentReady?: boolean;
    ownerFinanceEligible?: boolean;
  }>(),
  
  // AI assessment
  assessment: jsonb("assessment").$type<{
    overallScore: number;
    strengths: string[];
    concerns: string[];
    recommendations: string[];
    riskLevel: string;
    closingProbability: number;
  }>(),
  
  // Qualification status
  status: text("status").notNull().default("pending"), // pending, qualified, conditionally_qualified, not_qualified
  qualifiedAt: timestamp("qualified_at"),
  qualifiedBy: text("qualified_by"), // system or user
  
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Disposition Recommendations - optimal selling strategies
export const dispositionRecommendations = pgTable("disposition_recommendations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Recommended strategy
  strategy: text("strategy").notNull(), // list_retail, sell_wholesale, owner_finance, auction, hold
  confidence: integer("confidence").notNull(), // 0-100
  
  // Price recommendations
  pricing: jsonb("pricing").$type<{
    recommendedPrice: number;
    priceRange: { min: number; max: number };
    marketComps: Array<{ address: string; price: number; soldDate?: string }>;
    pricePerAcre: number;
    daysToSellEstimate: number;
  }>(),
  
  // Channel recommendations
  channels: jsonb("channels").$type<Array<{
    channel: string; // mls, facebook, craigslist, landwatch, direct_mail, buyer_list
    priority: number;
    estimatedReach: number;
    estimatedCost: number;
    notes?: string;
  }>>(),
  
  // Timing recommendations
  timing: jsonb("timing").$type<{
    optimalListDate: string;
    seasonality: string;
    marketTrend: string;
    urgencyScore: number;
    holdRecommendation?: string;
  }>(),
  
  // Target buyer profile
  targetBuyer: jsonb("target_buyer").$type<{
    profileType: string;
    likelyUseCase: string;
    financingPreference: string;
    keyFeaturesToHighlight: string[];
  }>(),
  
  // Owner financing terms if recommended
  ownerFinanceTerms: jsonb("owner_finance_terms").$type<{
    downPaymentPercent: number;
    interestRate: number;
    termMonths: number;
    monthlyPayment: number;
    totalValue: number;
  }>(),
  
  // ROI analysis
  roiAnalysis: jsonb("roi_analysis").$type<{
    acquisitionCost: number;
    holdingCosts: number;
    sellingCosts: number;
    netProfit: number;
    roi: number;
    annualizedReturn: number;
  }>(),
  
  // Alternative strategies
  alternatives: jsonb("alternatives").$type<Array<{
    strategy: string;
    expectedValue: number;
    pros: string[];
    cons: string[];
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBuyerProfileSchema = createInsertSchema(buyerProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBuyerProfile = z.infer<typeof insertBuyerProfileSchema>;
export type BuyerProfile = typeof buyerProfiles.$inferSelect;

export const insertBuyerPropertyMatchSchema = createInsertSchema(buyerPropertyMatches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBuyerPropertyMatch = z.infer<typeof insertBuyerPropertyMatchSchema>;
export type BuyerPropertyMatch = typeof buyerPropertyMatches.$inferSelect;

export const insertBuyerQualificationSchema = createInsertSchema(buyerQualifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBuyerQualification = z.infer<typeof insertBuyerQualificationSchema>;
export type BuyerQualification = typeof buyerQualifications.$inferSelect;

export const insertDispositionRecommendationSchema = createInsertSchema(dispositionRecommendations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDispositionRecommendation = z.infer<typeof insertDispositionRecommendationSchema>;
export type DispositionRecommendation = typeof dispositionRecommendations.$inferSelect;

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

// ============================================
// SUPPORT TICKETS & KNOWLEDGE BASE
// ============================================

export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  
  // Ticket details
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("general"), // general, billing, technical, feature_request, bug_report
  priority: text("priority").notNull().default("normal"), // low, normal, high, urgent
  status: text("status").notNull().default("open"), // open, in_progress, waiting_on_customer, resolved, closed
  
  // AI handling
  assignedAgent: text("assigned_agent"), // sophie (Support Agent), atlas, or null for human
  aiHandled: boolean("ai_handled").default(false),
  aiConfidenceScore: numeric("ai_confidence_score"), // 0-100 confidence in resolution
  aiResolutionAttempts: integer("ai_resolution_attempts").default(0),
  
  // Resolution details
  resolution: text("resolution"),
  resolutionType: text("resolution_type"), // auto_fixed, knowledge_base, escalated, manual
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"), // user_id or agent name
  
  // Customer satisfaction
  customerRating: integer("customer_rating"), // 1-5 stars
  customerFeedback: text("customer_feedback"),
  
  // Context for AI
  pageContext: text("page_context"), // Which page user was on
  errorContext: jsonb("error_context").$type<{
    errorMessage?: string;
    stackTrace?: string;
    browserInfo?: string;
    screenSize?: string;
  }>(),
  
  // Escalation diagnostic bundle (auto-gathered when escalating)
  escalationBundle: jsonb("escalation_bundle").$type<{
    gatheredAt: string;
    organization: any;
    dataCounts: any;
    usageLimits: any;
    activeAlerts: any[];
    serviceHealth: any;
    recentActivity: any[];
    recentApiErrors: any[];
    previousIssues: any[];
    solutionsTried: any[];
  }>(),
  
  // Metadata
  source: text("source").notNull().default("in_app"), // in_app, email, chat
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("support_tickets_org_idx").on(table.organizationId),
  index("support_tickets_status_idx").on(table.status),
  index("support_tickets_user_idx").on(table.userId),
]);

export const supportTicketMessages = pgTable("support_ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").references(() => supportTickets.id).notNull(),
  
  role: text("role").notNull(), // user, agent, system
  content: text("content").notNull(),
  agentName: text("agent_name"), // Sophie, Atlas, or human agent name
  
  // For AI messages
  toolsUsed: jsonb("tools_used").$type<string[]>(),
  actionsPerformed: jsonb("actions_performed").$type<Array<{
    action: string;
    target: string;
    result: string;
    success: boolean;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("support_ticket_messages_ticket_idx").on(table.ticketId),
]);

export const knowledgeBaseArticles = pgTable("knowledge_base_articles", {
  id: serial("id").primaryKey(),
  
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  content: text("content").notNull(), // Markdown content
  summary: text("summary"), // Short summary for search results
  
  category: text("category").notNull(), // getting_started, leads, properties, deals, finance, campaigns, ai, integrations, billing
  tags: jsonb("tags").$type<string[]>().default([]),
  
  // For AI matching
  keywords: jsonb("keywords").$type<string[]>().default([]),
  relatedIssues: jsonb("related_issues").$type<string[]>().default([]), // Common error messages or issues this solves
  
  // Troubleshooting steps
  troubleshootingSteps: jsonb("troubleshooting_steps").$type<Array<{
    step: number;
    instruction: string;
    expectedResult: string;
  }>>(),
  
  // Auto-fix capability
  canAutoFix: boolean("can_auto_fix").default(false),
  autoFixToolName: text("auto_fix_tool_name"), // Tool the AI can call to fix this
  autoFixParameters: jsonb("auto_fix_parameters").$type<Record<string, any>>(),
  
  // Analytics
  viewCount: integer("view_count").default(0),
  helpfulCount: integer("helpful_count").default(0),
  notHelpfulCount: integer("not_helpful_count").default(0),
  
  isPublished: boolean("is_published").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("kb_articles_category_idx").on(table.category),
  index("kb_articles_slug_idx").on(table.slug),
]);

// Track AI resolution history for learning
export const supportResolutionHistory = pgTable("support_resolution_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  ticketId: integer("ticket_id").references(() => supportTickets.id),
  
  issueType: text("issue_type").notNull(),
  issuePattern: text("issue_pattern"), // Regex or keyword pattern
  
  variantName: text("variant_name"), // For A/B testing different resolution approaches
  resolutionApproach: text("resolution_approach").notNull(),
  toolsUsed: jsonb("tools_used").$type<string[]>(),
  customerEffortScore: integer("customer_effort_score"), // 1-5 how much effort from customer
  
  wasSuccessful: boolean("was_successful").notNull(),
  customerSatisfied: boolean("customer_satisfied"),
  
  // For improving AI
  lessonLearned: text("lesson_learned"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("resolution_history_issue_type_idx").on(table.issueType),
]);

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;

export const insertSupportTicketMessageSchema = createInsertSchema(supportTicketMessages).omit({
  id: true,
  createdAt: true,
});
export type InsertSupportTicketMessage = z.infer<typeof insertSupportTicketMessageSchema>;
export type SupportTicketMessage = typeof supportTicketMessages.$inferSelect;

export const insertKnowledgeBaseArticleSchema = createInsertSchema(knowledgeBaseArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertKnowledgeBaseArticle = z.infer<typeof insertKnowledgeBaseArticleSchema>;
export type KnowledgeBaseArticle = typeof knowledgeBaseArticles.$inferSelect;

export const insertSupportResolutionHistorySchema = createInsertSchema(supportResolutionHistory).omit({
  id: true,
  createdAt: true,
});
export type InsertSupportResolutionHistory = z.infer<typeof insertSupportResolutionHistorySchema>;
export type SupportResolutionHistory = typeof supportResolutionHistory.$inferSelect;

// Multi-session memory for Sophie - stores context across conversations
export const sophieMemory = pgTable("sophie_memory", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  
  // Memory type for different kinds of remembered information
  memoryType: text("memory_type").notNull(), // issue_history, preference, solution_tried, escalation, context
  
  // The remembered information
  key: text("key").notNull(), // e.g., "last_billing_issue", "preferred_contact_method", "tried_cache_clear"
  value: jsonb("value").$type<{
    summary?: string;
    details?: any;
    issueType?: string;
    toolsUsed?: string[];
    resolution?: string;
    wasSuccessful?: boolean;
    timestamp?: string;
  }>(),
  
  // Relevance and expiry
  importance: integer("importance").default(5), // 1-10 scale, higher = more important to remember
  expiresAt: timestamp("expires_at"), // Optional expiry for temporary memories
  
  // Source tracking
  sourceTicketId: integer("source_ticket_id").references(() => supportTickets.id),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("sophie_memory_org_user_idx").on(table.organizationId, table.userId),
  index("sophie_memory_type_idx").on(table.memoryType),
  index("sophie_memory_key_idx").on(table.key),
]);

export const insertSophieMemorySchema = createInsertSchema(sophieMemory).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSophieMemory = z.infer<typeof insertSophieMemorySchema>;
export type SophieMemory = typeof sophieMemory.$inferSelect;

// Track self-healing fix attempts with retry logic
export const fixAttempts = pgTable("fix_attempts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  issuePattern: text("issue_pattern").notNull(),
  fixAction: text("fix_action").notNull(),
  
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending, success, failed, escalated
  
  errorMessage: text("error_message"),
  result: jsonb("result").$type<{
    success: boolean;
    details?: string;
    fixedAt?: string;
    retryAfter?: string;
  }>(),
  
  sourceObservationId: integer("source_observation_id").references(() => sophieObservations.id),
  sourceTicketId: integer("source_ticket_id").references(() => supportTickets.id),
  escalatedAt: timestamp("escalated_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("fix_attempts_org_idx").on(table.organizationId),
  index("fix_attempts_pattern_idx").on(table.issuePattern),
  index("fix_attempts_status_idx").on(table.status),
]);

export const insertFixAttemptSchema = createInsertSchema(fixAttempts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFixAttempt = z.infer<typeof insertFixAttemptSchema>;
export type FixAttempt = typeof fixAttempts.$inferSelect;

// Cross-org learning patterns - learnings that apply across all organizations
export const sophieCrossOrgLearnings = pgTable("sophie_cross_org_learnings", {
  id: serial("id").primaryKey(),
  
  issuePattern: text("issue_pattern").notNull(),
  issueCategory: text("issue_category").notNull(), // billing, ai, leads, properties, etc.
  
  resolutionApproach: text("resolution_approach").notNull(),
  lessonLearned: text("lesson_learned"),
  
  applicableCategories: jsonb("applicable_categories").$type<string[]>().default([]),
  keywords: jsonb("keywords").$type<string[]>().default([]),
  
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  successRate: numeric("success_rate").default("0"),
  
  isAutoFixable: boolean("is_auto_fixable").default(false),
  autoFixAction: text("auto_fix_action"),
  
  sourceTicketIds: jsonb("source_ticket_ids").$type<number[]>().default([]),
  contributingOrgIds: jsonb("contributing_org_ids").$type<number[]>().default([]),
  contributingOrgs: integer("contributing_orgs").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("cross_org_learnings_category_idx").on(table.issueCategory),
  index("cross_org_learnings_pattern_idx").on(table.issuePattern),
]);

export const insertSophieCrossOrgLearningSchema = createInsertSchema(sophieCrossOrgLearnings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSophieCrossOrgLearning = z.infer<typeof insertSophieCrossOrgLearningSchema>;
export type SophieCrossOrgLearning = typeof sophieCrossOrgLearnings.$inferSelect;

// ============================================
// PHASE 1: INTELLIGENCE AMPLIFICATION
// ============================================
// (Tables already defined above - reusing existing definitions)

// Market Indicators - Aggregated economic and real estate signals (DUPLICATE - ALREADY EXISTS)
// Using existing marketPredictions table definition from earlier in file
export const marketIndicatorsDuplicate = pgTable("market_indicators_temp", {
  id: serial("id").primaryKey(),
  
  indicatorDate: timestamp("indicator_date").notNull().defaultNow(),
  
  // Interest rates
  federalFundsRate: numeric("federal_funds_rate"),
  mortgageRate30Yr: numeric("mortgage_rate_30_yr"),
  
  // Economic
  gdpGrowthRate: numeric("gdp_growth_rate"),
  inflationRate: numeric("inflation_rate"),
  unemploymentRate: numeric("unemployment_rate"),
  
  // Real estate specific
  nationalHomePriceIndex: numeric("national_home_price_index"),
  landDemandIndex: numeric("land_demand_index"), // custom calculation
  
  // Sentiment
  consumerConfidenceIndex: numeric("consumer_confidence_index"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMarketIndicatorSchema = createInsertSchema(marketIndicatorsDuplicate).omit({ id: true, createdAt: true });
export type InsertMarketIndicator = z.infer<typeof insertMarketIndicatorSchema>;
export type MarketIndicator = typeof marketIndicatorsDuplicate.$inferSelect;

// Alias for imports expecting "marketIndicators"
export const marketIndicators = marketIndicatorsDuplicate;

// Price Trends - Historical price movements by property type and location
export const priceTrends = pgTable("price_trends", {
  id: serial("id").primaryKey(),
  
  // Location
  state: text("state").notNull(),
  county: text("county").notNull(),
  
  // Property characteristics
  propertyType: text("property_type").notNull(), // raw_land, recreational, agricultural, residential_lot, commercial
  acreageRange: text("acreage_range"), // 0-1, 1-5, 5-10, 10-40, 40+
  
  // Time period
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  // Pricing data
  avgPricePerAcre: numeric("avg_price_per_acre").notNull(),
  medianPricePerAcre: numeric("median_price_per_acre"),
  minPrice: numeric("min_price"),
  maxPrice: numeric("max_price"),
  
  // Volume
  transactionCount: integer("transaction_count").notNull(),
  totalAcresSold: numeric("total_acres_sold"),
  
  // Velocity
  avgDaysOnMarket: integer("avg_days_on_market"),
  
  // Comparison to previous period
  priceChange: numeric("price_change"), // percentage
  volumeChange: numeric("volume_change"), // percentage
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("price_trends_state_county_idx").on(table.state, table.county),
  index("price_trends_type_idx").on(table.propertyType),
  index("price_trends_period_idx").on(table.periodStart, table.periodEnd),
]);

export const insertPriceTrendSchema = createInsertSchema(priceTrends).omit({ id: true, createdAt: true });
export type InsertPriceTrend = z.infer<typeof insertPriceTrendSchema>;
export type PriceTrend = typeof priceTrends.$inferSelect;

// Scraped Deals - Opportunities found through automation
export const scrapedDeals = pgTable("scraped_deals", {
  id: serial("id").primaryKey(),
  
  // Source information
  sourceId: integer("source_id"), // references dealSources
  sourceType: text("source_type").notNull(), // tax_auction, foreclosure, probate, expired_listing, fsbo
  sourceUrl: text("source_url"),
  
  // Property details
  apn: text("apn"),
  address: text("address"),
  city: text("city"),
  county: text("county").notNull(),
  state: text("state").notNull(),
  zip: text("zip"),
  
  // Property characteristics
  sizeAcres: numeric("size_acres"),
  zoning: text("zoning"),
  
  // Pricing
  listPrice: numeric("list_price"),
  assessedValue: numeric("assessed_value"),
  taxesOwed: numeric("taxes_owed"),
  minimumBid: numeric("minimum_bid"),
  
  // Auction/sale details
  auctionDate: timestamp("auction_date"),
  auctionStatus: text("auction_status"), // upcoming, live, sold, unsold, cancelled
  
  // Owner information
  ownerName: text("owner_name"),
  ownerAddress: text("owner_address"),
  ownerType: text("owner_type"), // individual, corporate, estate, government
  
  // Distress signals
  distressScore: integer("distress_score"), // 0-100
  distressFactors: jsonb("distress_factors").$type<{
    taxDelinquent?: boolean;
    yearsDelinquent?: number;
    foreclosureStage?: string;
    probateStatus?: string;
    vacantLand?: boolean;
    absenteeOwner?: boolean;
    ownershipDuration?: number;
  }>(),
  
  // Processing status
  status: text("status").notNull().default("new"), // new, reviewed, contacted, added_to_crm, passed, archived
  convertedToLeadId: integer("converted_to_lead_id"),
  convertedToPropertyId: integer("converted_to_property_id"),
  
  // Scraping metadata
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
  lastVerified: timestamp("last_verified"),
  
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("scraped_deals_state_county_idx").on(table.state, table.county),
  index("scraped_deals_status_idx").on(table.status),
  index("scraped_deals_auction_date_idx").on(table.auctionDate),
  index("scraped_deals_distress_idx").on(table.distressScore),
]);

export const insertScrapedDealSchema = createInsertSchema(scrapedDeals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScrapedDeal = z.infer<typeof insertScrapedDealSchema>;
export type ScrapedDeal = typeof scrapedDeals.$inferSelect;

// Deal Sources - Registry of county websites and data sources for scraping
export const dealSources = pgTable("deal_sources", {
  id: serial("id").primaryKey(),
  
  // Source identification
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(), // county_website, auction_site, foreclosure_tracker, mls
  
  // Location
  state: text("state").notNull(),
  county: text("county"),
  
  // URL and scraping config
  baseUrl: text("base_url").notNull(),
  scrapingConfig: jsonb("scraping_config").$type<{
    scraperType: string; // puppeteer, api, rss
    selectors?: Record<string, string>;
    apiEndpoint?: string;
    apiKey?: string;
    updateFrequency?: string; // daily, weekly, realtime
    customHeaders?: Record<string, string>;
  }>(),
  
  // Status
  isActive: boolean("is_active").default(true),
  lastScraped: timestamp("last_scraped"),
  lastSuccessful: timestamp("last_successful"),
  consecutiveFailures: integer("consecutive_failures").default(0),
  
  // Performance
  avgDealsPerScrape: numeric("avg_deals_per_scrape"),
  totalDealsFound: integer("total_deals_found").default(0),
  conversionRate: numeric("conversion_rate"), // scraped deals to actual deals
  
  // Priority
  priority: integer("priority").default(50), // 0-100, higher = more important
  
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("deal_sources_state_county_idx").on(table.state, table.county),
  index("deal_sources_active_idx").on(table.isActive),
]);

export const insertDealSourceSchema = createInsertSchema(dealSources).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDealSource = z.infer<typeof insertDealSourceSchema>;
export type DealSource = typeof dealSources.$inferSelect;

// Auto-Bid Rules - User-defined parameters for automatic bidding
export const autoBidRules = pgTable("auto_bid_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true),
  
  // Geographic filters
  states: jsonb("states").$type<string[]>(),
  counties: jsonb("counties").$type<string[]>(),
  
  // Property filters
  minAcres: numeric("min_acres"),
  maxAcres: numeric("max_acres"),
  propertyTypes: jsonb("property_types").$type<string[]>(),
  
  // Price parameters
  maxBidAmount: numeric("max_bid_amount").notNull(),
  bidStrategy: text("bid_strategy").notNull(), // percentage_of_value, fixed_amount, incremental
  bidPercentage: numeric("bid_percentage"), // if percentage_of_value
  incrementAmount: numeric("increment_amount"), // if incremental
  
  // Distress criteria
  minDistressScore: integer("min_distress_score"),
  requireTaxDelinquent: boolean("require_tax_delinquent").default(false),
  
  // Approval workflow
  requiresApproval: boolean("requires_approval").default(true),
  approvalThreshold: numeric("approval_threshold"), // bids above this require approval
  
  // Budget controls
  monthlyBudget: numeric("monthly_budget"),
  currentMonthSpent: numeric("current_month_spent").default("0"),
  
  // Stats
  bidsPlaced: integer("bids_placed").default(0),
  bidsWon: integer("bids_won").default(0),
  totalSpent: numeric("total_spent").default("0"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("auto_bid_rules_org_idx").on(table.organizationId),
  index("auto_bid_rules_active_idx").on(table.isActive),
]);

export const insertAutoBidRuleSchema = createInsertSchema(autoBidRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAutoBidRule = z.infer<typeof insertAutoBidRuleSchema>;
export type AutoBidRule = typeof autoBidRules.$inferSelect;

// Deal Alerts - Notifications for matching deals
export const dealAlerts = pgTable("deal_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  scrapedDealId: integer("scraped_deal_id").references(() => scrapedDeals.id).notNull(),
  autoBidRuleId: integer("auto_bid_rule_id").references(() => autoBidRules.id),
  
  alertType: text("alert_type").notNull(), // match, bid_placed, bid_won, bid_lost, auction_soon
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  
  message: text("message").notNull(),
  actionRequired: boolean("action_required").default(false),
  actionUrl: text("action_url"),
  
  // Delivery
  sentAt: timestamp("sent_at"),
  readAt: timestamp("read_at"),
  dismissedAt: timestamp("dismissed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("deal_alerts_org_idx").on(table.organizationId),
  index("deal_alerts_type_idx").on(table.alertType),
  index("deal_alerts_read_idx").on(table.readAt),
]);

export const insertDealAlertSchema = createInsertSchema(dealAlerts).omit({ id: true, createdAt: true });
export type InsertDealAlert = z.infer<typeof insertDealAlertSchema>;
export type DealAlert = typeof dealAlerts.$inferSelect;

// Negotiation Threads - Track negotiation conversations
export const negotiationThreads = pgTable("negotiation_threads", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  dealId: integer("deal_id"),
  
  status: text("status").notNull().default("active"), // active, stalled, closed_won, closed_lost, archived
  
  // Current state
  currentOfferAmount: numeric("current_offer_amount"),
  targetPrice: numeric("target_price"),
  walkawayPrice: numeric("walkaway_price"),
  
  // Psychology profile
  sellerProfile: jsonb("seller_profile").$type<{
    communicationStyle?: string; // responsive, slow, aggressive, friendly
    motivationLevel?: string; // high, medium, low
    urgency?: string; // immediate, flexible, no_rush
    priceFlexibility?: string; // firm, somewhat_flexible, very_flexible
    keyMotivators?: string[]; // cash, speed, terms, family, tax
  }>(),
  
  // Sentiment analysis
  overallSentiment: text("overall_sentiment"), // positive, neutral, negative, frustrated
  sentimentTrend: text("sentiment_trend"), // improving, stable, declining
  
  // AI strategy
  currentStrategy: text("current_strategy"), // anchor_low, meet_middle, add_terms, wait_and_watch
  strategyConfidence: numeric("strategy_confidence"), // 0-1
  
  // Stats
  totalExchanges: integer("total_exchanges").default(0),
  avgResponseTimeHours: numeric("avg_response_time_hours"),
  daysInNegotiation: integer("days_in_negotiation"),
  
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("negotiation_threads_org_idx").on(table.organizationId),
  index("negotiation_threads_lead_idx").on(table.leadId),
  index("negotiation_threads_status_idx").on(table.status),
]);

export const insertNegotiationThreadSchema = createInsertSchema(negotiationThreads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNegotiationThread = z.infer<typeof insertNegotiationThreadSchema>;
export type NegotiationThread = typeof negotiationThreads.$inferSelect;

// Negotiation Moves - Individual offers and counter-offers
export const negotiationMoves = pgTable("negotiation_moves", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").references(() => negotiationThreads.id).notNull(),
  
  moveNumber: integer("move_number").notNull(),
  moveType: text("move_type").notNull(), // initial_offer, counter_offer, acceptance, rejection, terms_change
  party: text("party").notNull(), // buyer, seller
  
  // Offer details
  offerAmount: numeric("offer_amount"),
  terms: text("terms"),
  reasoning: text("reasoning"), // AI's reasoning for this move
  
  // AI generation
  generatedByAI: boolean("generated_by_ai").default(false),
  aiModel: text("ai_model"),
  aiConfidence: numeric("ai_confidence"),
  alternativeStrategies: jsonb("alternative_strategies").$type<Array<{
    strategy: string;
    amount: number;
    reasoning: string;
    confidence: number;
  }>>(),
  
  // Response
  responseReceived: boolean("response_received").default(false),
  responseTime: integer("response_time"), // hours
  responseType: text("response_type"), // accepted, rejected, countered, no_response
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("negotiation_moves_thread_idx").on(table.threadId),
  index("negotiation_moves_party_idx").on(table.party),
]);

export const insertNegotiationMoveSchema = createInsertSchema(negotiationMoves).omit({ id: true, createdAt: true });
export type InsertNegotiationMove = z.infer<typeof insertNegotiationMoveSchema>;
export type NegotiationMove = typeof negotiationMoves.$inferSelect;

// Negotiation Outcomes - Learning data for AI improvement
export const negotiationOutcomes = pgTable("negotiation_outcomes", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").references(() => negotiationThreads.id).notNull(),
  
  outcome: text("outcome").notNull(), // deal_closed, seller_walked, buyer_walked, stalled
  
  // Final terms
  finalPrice: numeric("final_price"),
  initialOffer: numeric("initial_offer"),
  targetPrice: numeric("target_price"),
  negotiationDiscount: numeric("negotiation_discount"), // percentage saved from initial ask
  
  // Performance metrics
  totalDays: integer("total_days"),
  totalMoves: integer("total_moves"),
  strategyUsed: text("strategy_used"),
  strategyEffectiveness: integer("strategy_effectiveness"), // 1-10
  
  // Learnings
  keyFactors: jsonb("key_factors").$type<string[]>(), // what made this succeed/fail
  lessonsLearned: text("lessons_learned"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("negotiation_outcomes_outcome_idx").on(table.outcome),
]);

export const insertNegotiationOutcomeSchema = createInsertSchema(negotiationOutcomes).omit({ id: true, createdAt: true });
export type InsertNegotiationOutcome = z.infer<typeof insertNegotiationOutcomeSchema>;
export type NegotiationOutcome = typeof negotiationOutcomes.$inferSelect;

// Negotiation Strategies - A/B test variants
export const negotiationStrategies = pgTable("negotiation_strategies", {
  id: serial("id").primaryKey(),
  
  name: text("name").notNull(),
  description: text("description"),
  
  strategyType: text("strategy_type").notNull(), // anchor_low, anchor_high, meet_middle, terms_heavy, cash_heavy
  
  // Parameters
  initialOfferPercentage: numeric("initial_offer_percentage"), // % of target
  incrementStrategy: text("increment_strategy"), // fixed, percentage, adaptive
  maxMoves: integer("max_moves"),
  
  // Performance tracking
  timesUsed: integer("times_used").default(0),
  successRate: numeric("success_rate"),
  avgDiscount: numeric("avg_discount"), // avg % saved
  avgDaysToClose: numeric("avg_days_to_close"),
  
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNegotiationStrategySchema = createInsertSchema(negotiationStrategies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNegotiationStrategy = z.infer<typeof insertNegotiationStrategySchema>;
export type NegotiationStrategy = typeof negotiationStrategies.$inferSelect;

// ============================================
// PHASE 2: NETWORK EFFECTS & MARKETPLACE
// ============================================

// Marketplace Listings - Properties for sale between AcreOS users
export const marketplaceListings = pgTable("marketplace_listings", {
  id: serial("id").primaryKey(),
  
  // Seller info
  sellerOrganizationId: integer("seller_organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Listing details
  listingType: text("listing_type").notNull(), // wholesale, assignment, partnership, note_sale
  title: text("title").notNull(),
  description: text("description"),
  
  // Pricing
  askingPrice: numeric("asking_price").notNull(),
  minAcceptablePrice: numeric("min_acceptable_price"), // private, not shown
  
  // Terms
  closingTimelineDays: integer("closing_timeline_days"),
  isNegotiable: boolean("is_negotiable").default(true),
  acceptsPartnership: boolean("accepts_partnership").default(false),
  partnershipTerms: text("partnership_terms"),
  
  // Visibility
  visibility: text("visibility").notNull().default("public"), // public, private, verified_only
  isPremiumPlacement: boolean("is_premium_placement").default(false),
  premiumExpiresAt: timestamp("premium_expires_at"),
  
  // Status
  status: text("status").notNull().default("active"), // active, under_offer, sold, expired, cancelled
  
  // Metrics
  views: integer("views").default(0),
  favorites: integer("favorites").default(0),
  inquiries: integer("inquiries").default(0),
  
  // Deal protection
  exclusivityPeriod: integer("exclusivity_period"), // hours for accepted offer
  
  expiresAt: timestamp("expires_at"),
  soldAt: timestamp("sold_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("marketplace_listings_seller_idx").on(table.sellerOrganizationId),
  index("marketplace_listings_status_idx").on(table.status),
  index("marketplace_listings_type_idx").on(table.listingType),
]);

export const insertMarketplaceListingSchema = createInsertSchema(marketplaceListings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketplaceListing = z.infer<typeof insertMarketplaceListingSchema>;
export type MarketplaceListing = typeof marketplaceListings.$inferSelect;

// Marketplace Bids - Offers on marketplace listings
export const marketplaceBids = pgTable("marketplace_bids", {
  id: serial("id").primaryKey(),
  
  listingId: integer("listing_id").references(() => marketplaceListings.id).notNull(),
  bidderOrganizationId: integer("bidder_organization_id").references(() => organizations.id).notNull(),
  
  bidAmount: numeric("bid_amount").notNull(),
  message: text("message"),
  proposedTerms: text("proposed_terms"),
  
  // Bid type
  bidType: text("bid_type").notNull().default("purchase"), // purchase, partnership, assignment
  partnershipSplit: numeric("partnership_split"), // percentage if partnership
  
  status: text("status").notNull().default("pending"), // pending, accepted, rejected, countered, expired, withdrawn
  
  // Seller response
  sellerResponse: text("seller_response"),
  counterOffer: numeric("counter_offer"),
  respondedAt: timestamp("responded_at"),
  
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("marketplace_bids_listing_idx").on(table.listingId),
  index("marketplace_bids_bidder_idx").on(table.bidderOrganizationId),
  index("marketplace_bids_status_idx").on(table.status),
]);

export const insertMarketplaceBidSchema = createInsertSchema(marketplaceBids).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketplaceBid = z.infer<typeof insertMarketplaceBidSchema>;
export type MarketplaceBid = typeof marketplaceBids.$inferSelect;

// Investor Profiles - Public profiles for marketplace trust
export const investorProfiles = pgTable("investor_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull().unique(),
  
  // Public info
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  location: text("location"),
  website: text("website"),
  
  // Specialization
  specialties: jsonb("specialties").$type<string[]>(), // raw_land, recreational, agricultural
  preferredStates: jsonb("preferred_states").$type<string[]>(),
  investmentRange: jsonb("investment_range").$type<{ min: number; max: number }>(),
  
  // Verification
  isVerified: boolean("is_verified").default(false),
  verifiedAt: timestamp("verified_at"),
  verificationDocuments: jsonb("verification_documents").$type<string[]>(),
  
  // Reputation
  dealsClosed: integer("deals_closed").default(0),
  avgResponseTimeHours: numeric("avg_response_time_hours"),
  reliabilityScore: numeric("reliability_score"), // 0-100
  rating: numeric("rating"), // 0-5
  reviewCount: integer("review_count").default(0),
  
  // Activity
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("investor_profiles_verified_idx").on(table.isVerified),
  index("investor_profiles_org_idx").on(table.organizationId),
]);

export const insertInvestorProfileSchema = createInsertSchema(investorProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestorProfile = z.infer<typeof insertInvestorProfileSchema>;
export type InvestorProfile = typeof investorProfiles.$inferSelect;

// Deal Rooms - Private collaboration spaces
export const dealRooms = pgTable("deal_rooms", {
  id: serial("id").primaryKey(),
  
  listingId: integer("listing_id").references(() => marketplaceListings.id),
  
  // Participants
  participants: jsonb("participants").$type<Array<{
    organizationId: number;
    role: string; // seller, buyer, partner
    joinedAt: string;
  }>>().notNull(),
  
  // Deal details
  dealType: text("deal_type"), // purchase, partnership, joint_venture
  agreedPrice: numeric("agreed_price"),
  dealTerms: text("deal_terms"),
  
  status: text("status").notNull().default("active"), // active, closed, cancelled
  
  // Documents
  sharedDocuments: jsonb("shared_documents").$type<Array<{
    name: string;
    url: string;
    uploadedBy: number;
    uploadedAt: string;
  }>>(),
  
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDealRoomSchema = createInsertSchema(dealRooms).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDealRoom = z.infer<typeof insertDealRoomSchema>;
export type DealRoom = typeof dealRooms.$inferSelect;

// Marketplace Transactions - Completed deals with fees
export const marketplaceTransactions = pgTable("marketplace_transactions", {
  id: serial("id").primaryKey(),
  
  listingId: integer("listing_id").references(() => marketplaceListings.id).notNull(),
  sellerOrganizationId: integer("seller_organization_id").references(() => organizations.id).notNull(),
  buyerOrganizationId: integer("buyer_organization_id").references(() => organizations.id).notNull(),
  
  transactionType: text("transaction_type").notNull(), // wholesale, partnership, assignment
  
  // Financial details
  salePrice: numeric("sale_price").notNull(),
  platformFeePercent: numeric("platform_fee_percent").notNull().default("1.5"),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  
  // Payment processing
  sellerPayoutStatus: text("seller_payout_status").notNull().default("pending"), // pending, processing, completed, failed
  sellerPayoutAmount: numeric("seller_payout_amount"),
  sellerStripeTransferId: text("seller_stripe_transfer_id"),
  
  // Status
  status: text("status").notNull().default("pending"), // pending, completed, refunded, disputed
  
  closingDate: timestamp("closing_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("marketplace_transactions_seller_idx").on(table.sellerOrganizationId),
  index("marketplace_transactions_buyer_idx").on(table.buyerOrganizationId),
  index("marketplace_transactions_status_idx").on(table.status),
]);

export const insertMarketplaceTransactionSchema = createInsertSchema(marketplaceTransactions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketplaceTransaction = z.infer<typeof insertMarketplaceTransactionSchema>;
export type MarketplaceTransaction = typeof marketplaceTransactions.$inferSelect;

// Buyer Behavior Events - Anonymized tracking for intelligence network
export const buyerBehaviorEvents = pgTable("buyer_behavior_events", {
  id: serial("id").primaryKey(),
  
  // Anonymized identifier (NOT organizationId)
  anonymousId: text("anonymous_id").notNull(), // hash of orgId
  
  eventType: text("event_type").notNull(), // view, favorite, inquiry, bid, purchase
  
  // Property characteristics (NOT specific property)
  propertyType: text("property_type"),
  acreageRange: text("acreage_range"),
  priceRange: text("price_range"),
  
  // Location (county level only)
  state: text("state"),
  county: text("county"),
  
  eventDate: timestamp("event_date").notNull().defaultNow(),
  
  // Aggregate only, no PII
  metadata: jsonb("metadata").$type<{
    timeOnPage?: number;
    deviceType?: string;
  }>(),
}, (table) => [
  index("buyer_behavior_state_county_idx").on(table.state, table.county),
  index("buyer_behavior_type_idx").on(table.eventType),
  index("buyer_behavior_date_idx").on(table.eventDate),
]);

export const insertBuyerBehaviorEventSchema = createInsertSchema(buyerBehaviorEvents).omit({ id: true });
export type InsertBuyerBehaviorEvent = z.infer<typeof insertBuyerBehaviorEventSchema>;
export type BuyerBehaviorEvent = typeof buyerBehaviorEvents.$inferSelect;

// Demand Heatmaps - Pre-computed geographic demand
export const demandHeatmaps = pgTable("demand_heatmaps", {
  id: serial("id").primaryKey(),
  
  state: text("state").notNull(),
  county: text("county").notNull(),
  
  // Time period
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  // Demand metrics
  demandScore: integer("demand_score").notNull(), // 0-100
  viewCount: integer("view_count").default(0),
  inquiryCount: integer("inquiry_count").default(0),
  bidCount: integer("bid_count").default(0),
  purchaseCount: integer("purchase_count").default(0),
  
  // Price insights
  avgBidToAskRatio: numeric("avg_bid_to_ask_ratio"),
  competitionLevel: text("competition_level"), // low, medium, high
  
  // Trends
  demandTrend: text("demand_trend"), // increasing, stable, decreasing
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("demand_heatmaps_state_county_idx").on(table.state, table.county),
  index("demand_heatmaps_score_idx").on(table.demandScore),
]);

export const insertDemandHeatmapSchema = createInsertSchema(demandHeatmaps).omit({ id: true, createdAt: true });
export type InsertDemandHeatmap = z.infer<typeof insertDemandHeatmapSchema>;
export type DemandHeatmap = typeof demandHeatmaps.$inferSelect;

// ============================================
// PHASE 3: FINANCIAL INTELLIGENCE
// ============================================

// Portfolio Simulations - Monte Carlo analysis results
export const portfolioSimulations = pgTable("portfolio_simulations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  description: text("description"),
  
  // Simulation parameters
  iterations: integer("iterations").notNull().default(10000),
  timeHorizonMonths: integer("time_horizon_months").notNull(),
  
  assumptions: jsonb("assumptions").$type<{
    appreciationRate?: { min: number; max: number; likely: number };
    dispositionRate?: { min: number; max: number; likely: number };
    defaultRate?: { min: number; max: number; likely: number };
    marketVolatility?: number;
  }>(),
  
  // Results
  results: jsonb("results").$type<{
    portfolioValue: { p10: number; p50: number; p90: number };
    totalReturn: { p10: number; p50: number; p90: number };
    cashFlow: { p10: number; p50: number; p90: number };
    riskOfLoss: number; // percentage
  }>(),
  
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("portfolio_simulations_org_idx").on(table.organizationId),
  index("portfolio_simulations_status_idx").on(table.status),
]);

export const insertPortfolioSimulationSchema = createInsertSchema(portfolioSimulations).omit({ id: true, createdAt: true });
export type InsertPortfolioSimulation = z.infer<typeof insertPortfolioSimulationSchema>;
export type PortfolioSimulation = typeof portfolioSimulations.$inferSelect;

// Optimization Recommendations - AI suggestions for portfolio
export const optimizationRecommendations = pgTable("optimization_recommendations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  recommendationType: text("recommendation_type").notNull(), // diversification, tax_optimization, cash_flow, risk_reduction
  title: text("title").notNull(),
  description: text("description").notNull(),
  reasoning: text("reasoning").notNull(),
  
  priority: text("priority").notNull().default("medium"), // low, medium, high, critical
  
  // Estimated impact
  estimatedImpact: jsonb("estimated_impact").$type<{
    returnIncrease?: number; // percentage
    riskReduction?: number; // percentage
    taxSavings?: number; // dollars
    cashFlowImprovement?: number; // dollars per month
  }>(),
  
  // Action items
  actionItems: jsonb("action_items").$type<Array<{
    action: string;
    propertyId?: number;
    estimatedCost?: number;
  }>>(),
  
  status: text("status").notNull().default("new"), // new, reviewed, implemented, dismissed
  
  reviewedAt: timestamp("reviewed_at"),
  implementedAt: timestamp("implemented_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("optimization_recommendations_org_idx").on(table.organizationId),
  index("optimization_recommendations_type_idx").on(table.recommendationType),
  index("optimization_recommendations_status_idx").on(table.status),
]);

export const insertOptimizationRecommendationSchema = createInsertSchema(optimizationRecommendations).omit({ id: true, createdAt: true });
export type InsertOptimizationRecommendation = z.infer<typeof insertOptimizationRecommendationSchema>;
export type OptimizationRecommendation = typeof optimizationRecommendations.$inferSelect;

// Transaction Training Data - Anonymized for valuation model
export const transactionTraining = pgTable("transaction_training", {
  id: serial("id").primaryKey(),
  
  // Anonymized (no orgId)
  transactionHash: text("transaction_hash").notNull().unique(),
  
  // Location
  state: text("state").notNull(),
  county: text("county").notNull(),
  
  // Property characteristics
  propertyType: text("property_type").notNull(),
  sizeAcres: numeric("size_acres").notNull(),
  zoning: text("zoning"),
  
  // Features (from DataSourceBroker)
  hasRoadAccess: boolean("has_road_access"),
  hasUtilities: boolean("has_utilities"),
  hasWater: boolean("has_water"),
  floodZone: text("flood_zone"),
  hasWetlands: boolean("has_wetlands"),
  soilQuality: text("soil_quality"),
  
  // Economic context
  countyMedianIncome: numeric("county_median_income"),
  populationDensity: numeric("population_density"),
  distanceToMetro: numeric("distance_to_metro"), // miles
  
  // Transaction
  salePrice: numeric("sale_price").notNull(),
  pricePerAcre: numeric("price_per_acre").notNull(),
  saleDate: timestamp("sale_date").notNull(),
  
  // Quality indicators
  dataQuality: text("data_quality").notNull(), // high, medium, low
  isOutlier: boolean("is_outlier").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("transaction_training_state_county_idx").on(table.state, table.county),
  index("transaction_training_type_idx").on(table.propertyType),
  index("transaction_training_date_idx").on(table.saleDate),
]);

export const insertTransactionTrainingSchema = createInsertSchema(transactionTraining).omit({ id: true, createdAt: true });
export type InsertTransactionTraining = z.infer<typeof insertTransactionTrainingSchema>;
export type TransactionTraining = typeof transactionTraining.$inferSelect;

// Valuation Predictions - Cached AcreOS Market Value predictions
export const valuationPredictions = pgTable("valuation_predictions", {
  id: serial("id").primaryKey(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Prediction
  predictedValue: numeric("predicted_value").notNull(),
  confidenceScore: numeric("confidence_score").notNull(), // 0-100
  valueRange: jsonb("value_range").$type<{ low: number; high: number }>(),
  
  // Model info
  modelVersion: text("model_version").notNull(),
  featuresUsed: jsonb("features_used").$type<string[]>(),
  
  // Comparables
  comparableCount: integer("comparable_count"),
  
  validUntil: timestamp("valid_until").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("valuation_predictions_property_idx").on(table.propertyId),
  index("valuation_predictions_valid_idx").on(table.validUntil),
]);

export const insertValuationPredictionSchema = createInsertSchema(valuationPredictions).omit({ id: true, createdAt: true });
export type InsertValuationPrediction = z.infer<typeof insertValuationPredictionSchema>;
export type ValuationPrediction = typeof valuationPredictions.$inferSelect;

// Land Credit Scores - Multi-dimensional property scoring
export const landCreditScores = pgTable("land_credit_scores", {
  id: serial("id").primaryKey(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Core scores (0-100)
  liquidityScore: integer("liquidity_score").notNull(),
  riskScore: integer("risk_score").notNull(),
  developmentPotentialScore: integer("development_potential_score").notNull(),
  marketabilityScore: integer("marketability_score").notNull(),
  
  // Overall grade
  overallScore: integer("overall_score").notNull(),
  grade: text("grade").notNull(), // A+, A, B+, B, C+, C, D, F
  
  // Detailed breakdown
  scoreBreakdown: jsonb("score_breakdown").$type<{
    location: number;
    characteristics: number;
    marketDemand: number;
    economicFactors: number;
    timeOnMarket: number;
  }>(),
  
  modelVersion: text("model_version").notNull(),
  validUntil: timestamp("valid_until").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("land_credit_scores_property_idx").on(table.propertyId),
  index("land_credit_scores_grade_idx").on(table.grade),
]);

export const insertLandCreditScoreSchema = createInsertSchema(landCreditScores).omit({ id: true, createdAt: true });
export type InsertLandCreditScore = z.infer<typeof insertLandCreditScoreSchema>;
export type LandCreditScore = typeof landCreditScores.$inferSelect;

// ===========================
// PHASE 3: CAPITAL MARKETS
// ===========================

// Note Securities - Seller financing securitization
export const noteSecurities = pgTable("note_securities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  propertyId: integer("property_id").references(() => properties.id),
  
  // Note details
  principalAmount: numeric("principal_amount").notNull(),
  interestRate: numeric("interest_rate").notNull(),
  termMonths: integer("term_months").notNull(),
  monthlyPayment: numeric("monthly_payment").notNull(),
  
  // Securitization
  isSecuritized: boolean("is_securitized").default(false),
  securitizationDate: timestamp("securitization_date"),
  investorId: text("investor_id"),
  purchasePrice: numeric("purchase_price"),
  discount: numeric("discount"), // % discount from face value
  
  // Performance
  paymentsReceived: integer("payments_received").default(0),
  totalPaymentsDue: integer("total_payments_due"),
  currentBalance: numeric("current_balance"),
  delinquentDays: integer("delinquent_days").default(0),
  
  status: text("status").notNull(), // performing, delinquent, default, paid_off
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("note_securities_org_idx").on(table.organizationId),
  index("note_securities_investor_idx").on(table.investorId),
  index("note_securities_status_idx").on(table.status),
]);

export const insertNoteSecuritySchema = createInsertSchema(noteSecurities).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNoteSecurity = z.infer<typeof insertNoteSecuritySchema>;
export type NoteSecurity = typeof noteSecurities.$inferSelect;

// Lender Network - Connect with institutional lenders
export const lenderNetwork = pgTable("lender_network", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  lenderName: text("lender_name").notNull(),
  lenderType: text("lender_type").notNull(), // bank, private_lender, hard_money, institutional
  
  // Lending criteria
  minLoanAmount: numeric("min_loan_amount"),
  maxLoanAmount: numeric("max_loan_amount"),
  maxLTV: numeric("max_ltv"), // Loan-to-value %
  minCreditScore: integer("min_credit_score"),
  
  // Terms
  interestRateRange: jsonb("interest_rate_range").$type<{ min: number; max: number }>(),
  typicalTermMonths: integer("typical_term_months"),
  
  // Specializations
  propertyTypes: jsonb("property_types").$type<string[]>(),
  states: jsonb("states").$type<string[]>(),
  
  // Contact
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  
  // Performance
  loansIssued: integer("loans_issued").default(0),
  avgClosingDays: integer("avg_closing_days"),
  approvalRate: numeric("approval_rate"),
  
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("lender_network_org_idx").on(table.organizationId),
  index("lender_network_type_idx").on(table.lenderType),
]);

export const insertLenderNetworkSchema = createInsertSchema(lenderNetwork).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLenderNetwork = z.infer<typeof insertLenderNetworkSchema>;
export type LenderNetwork = typeof lenderNetwork.$inferSelect;

// Capital Raises - Syndication and fund raising
export const capitalRaises = pgTable("capital_raises", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Raise details
  targetAmount: numeric("target_amount").notNull(),
  raisedAmount: numeric("raised_amount").default("0"),
  minInvestment: numeric("min_investment").notNull(),
  
  // Terms
  offeringType: text("offering_type").notNull(), // equity, debt, preferred
  returnStructure: text("return_structure"), // profit_share, interest, appreciation
  targetReturn: numeric("target_return"),
  holdPeriod: integer("hold_period"), // months
  
  // Properties
  propertyIds: jsonb("property_ids").$type<number[]>(),
  
  // Investors
  investorCount: integer("investor_count").default(0),
  investors: jsonb("investors").$type<{ userId: number; amount: number; date: string }[]>(),
  
  status: text("status").notNull(), // draft, active, funded, closed
  
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("capital_raises_org_idx").on(table.organizationId),
  index("capital_raises_status_idx").on(table.status),
]);

export const insertCapitalRaiseSchema = createInsertSchema(capitalRaises).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCapitalRaise = z.infer<typeof insertCapitalRaiseSchema>;
export type CapitalRaise = typeof capitalRaises.$inferSelect;

// ===========================
// PHASE 4: VOICE & VISUAL AI
// ===========================

// Voice Calls - AI voice agent call logs
export const voiceCalls = pgTable("voice_calls", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Call details
  callSid: text("call_sid").unique(),
  direction: text("direction").notNull(), // inbound, outbound
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  
  // Contact
  contactId: integer("contact_id"),
  leadId: integer("lead_id"),
  propertyId: integer("property_id"),
  
  // Call metrics
  durationSeconds: integer("duration_seconds"),
  callStatus: text("call_status"), // ringing, in-progress, completed, failed
  
  // AI agent
  agentType: text("agent_type").notNull(), // sophie, atlas, custom
  agentObjective: text("agent_objective"), // qualify_lead, schedule_showing, answer_questions
  
  // Results
  wasAnswered: boolean("was_answered"),
  sentimentScore: numeric("sentiment_score"), // -1 to 1
  motivationScore: numeric("motivation_score"), // 0 to 1 — seller motivation confidence
  objectiveAchieved: boolean("objective_achieved"),
  
  // Follow-up
  actionItems: jsonb("action_items").$type<string[]>(),
  scheduledAppointment: timestamp("scheduled_appointment"),
  
  recordingUrl: text("recording_url"),
  transcriptId: integer("transcript_id"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("voice_calls_org_idx").on(table.organizationId),
  index("voice_calls_contact_idx").on(table.contactId),
  index("voice_calls_date_idx").on(table.createdAt),
]);

export const insertVoiceCallSchema = createInsertSchema(voiceCalls).omit({ id: true, createdAt: true });
export type InsertVoiceCall = z.infer<typeof insertVoiceCallSchema>;
export type VoiceCall = typeof voiceCalls.$inferSelect;

// Call Transcripts - Full conversation transcription (DUPLICATE - ALREADY EXISTS ABOVE)
// Using existing callTranscripts table definition from earlier in file

// Property Photos - Visual assets for properties
export const propertyPhotos = pgTable("property_photos", {
  id: serial("id").primaryKey(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Image details
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  storageKey: text("storage_key").notNull(),
  
  // Metadata
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  width: integer("width"),
  height: integer("height"),
  
  // Organization
  sortOrder: integer("sort_order").default(0),
  isPrimary: boolean("is_primary").default(false),
  category: text("category"), // aerial, street, feature, misc
  
  // Capture info
  capturedAt: timestamp("captured_at"),
  capturedBy: text("captured_by"), // drone, camera, satellite, street_view
  gpsCoordinates: jsonb("gps_coordinates").$type<{ lat: number; lng: number }>(),
  
  // AI analysis
  hasAnalysis: boolean("has_analysis").default(false),
  analysisId: integer("analysis_id"),
  
  uploadedBy: text("uploaded_by"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("property_photos_property_idx").on(table.propertyId),
  index("property_photos_primary_idx").on(table.isPrimary),
]);

export const insertPropertyPhotoSchema = createInsertSchema(propertyPhotos).omit({ id: true, createdAt: true });
export type InsertPropertyPhoto = z.infer<typeof insertPropertyPhotoSchema>;
export type PropertyPhoto = typeof propertyPhotos.$inferSelect;

// Photo Analysis - OpenAI Vision API analysis
export const photoAnalysis = pgTable("photo_analysis", {
  id: serial("id").primaryKey(),
  
  photoId: integer("photo_id").references(() => propertyPhotos.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Vision API results
  detectedFeatures: jsonb("detected_features").$type<string[]>(),
  landscapeType: text("landscape_type"), // forest, grassland, desert, mixed
  buildingDetected: boolean("building_detected"),
  roadDetected: boolean("road_detected"),
  waterDetected: boolean("water_detected"),
  
  // Quality assessment
  photoQuality: text("photo_quality"), // excellent, good, fair, poor
  isUsableForMarketing: boolean("is_usable_for_marketing"),
  
  // Detailed analysis
  aiDescription: text("ai_description"),
  estimatedAcreageVisible: numeric("estimated_acreage_visible"),
  vegetationDensity: numeric("vegetation_density"), // 0-100
  
  // Comparison
  similarPhotos: jsonb("similar_photos").$type<number[]>(), // Other photo IDs
  
  modelVersion: text("model_version"),
  confidence: numeric("confidence"), // 0-100
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("photo_analysis_photo_idx").on(table.photoId),
  index("photo_analysis_property_idx").on(table.propertyId),
]);

export const insertPhotoAnalysisSchema = createInsertSchema(photoAnalysis).omit({ id: true, createdAt: true });
export type InsertPhotoAnalysis = z.infer<typeof insertPhotoAnalysisSchema>;
export type PhotoAnalysis = typeof photoAnalysis.$inferSelect;

// Satellite Snapshots - Regular satellite imagery monitoring
export const satelliteSnapshots = pgTable("satellite_snapshots", {
  id: serial("id").primaryKey(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Imagery
  imageUrl: text("image_url").notNull(),
  provider: text("provider"), // google, mapbox, sentinel
  resolution: numeric("resolution"), // meters per pixel
  
  // Timing
  captureDate: timestamp("capture_date").notNull(),
  cloudCoverage: numeric("cloud_coverage"), // %
  
  // Analysis
  changeDetected: boolean("change_detected").default(false),
  changeType: text("change_type"), // vegetation, construction, clearing
  changeSeverity: text("change_severity"), // minor, moderate, major
  
  // Comparison
  comparedToSnapshotId: integer("compared_to_snapshot_id"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("satellite_snapshots_property_idx").on(table.propertyId),
  index("satellite_snapshots_date_idx").on(table.captureDate),
]);

export const insertSatelliteSnapshotSchema = createInsertSchema(satelliteSnapshots).omit({ id: true, createdAt: true });
export type InsertSatelliteSnapshot = z.infer<typeof insertSatelliteSnapshotSchema>;
export type SatelliteSnapshot = typeof satelliteSnapshots.$inferSelect;

// ===========================
// PHASE 5: ACREOS ACADEMY
// ===========================

// Courses - Educational content
export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  
  // Content
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(), // beginner, intermediate, advanced, specialty
  difficultyLevel: integer("difficulty_level"), // 1-5
  
  // Media
  thumbnailUrl: text("thumbnail_url"),
  previewVideoUrl: text("preview_video_url"),
  
  // Structure
  moduleCount: integer("module_count").default(0),
  totalDurationMinutes: integer("total_duration_minutes"),
  
  // Pricing
  price: numeric("price").notNull(),
  discountedPrice: numeric("discounted_price"),
  
  // Instructor
  instructorName: text("instructor_name"),
  instructorBio: text("instructor_bio"),
  
  // Status
  isPublished: boolean("is_published").default(false),
  publishedAt: timestamp("published_at"),
  
  // Analytics
  enrollmentCount: integer("enrollment_count").default(0),
  completionRate: numeric("completion_rate"),
  avgRating: numeric("avg_rating"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("courses_category_idx").on(table.category),
  index("courses_published_idx").on(table.isPublished),
]);

export const insertCourseSchema = createInsertSchema(courses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;

// Course Modules - Lessons within courses
export const courseModules = pgTable("course_modules", {
  id: serial("id").primaryKey(),
  
  courseId: integer("course_id").references(() => courses.id).notNull(),
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Content
  contentType: text("content_type").notNull(), // video, text, quiz, interactive
  videoUrl: text("video_url"),
  content: text("content"),
  
  // Structure
  sortOrder: integer("sort_order").notNull(),
  durationMinutes: integer("duration_minutes"),
  
  // Requirements
  isPreview: boolean("is_preview").default(false), // Free preview
  requiredScore: integer("required_score"), // For quizzes
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("course_modules_course_idx").on(table.courseId),
]);

export const insertCourseModuleSchema = createInsertSchema(courseModules).omit({ id: true, createdAt: true });
export type InsertCourseModule = z.infer<typeof insertCourseModuleSchema>;
export type CourseModule = typeof courseModules.$inferSelect;

// Course Enrollments - Student registrations
export const courseEnrollments = pgTable("course_enrollments", {
  id: serial("id").primaryKey(),
  
  userId: text("user_id").notNull(),
  courseId: integer("course_id").references(() => courses.id).notNull(),
  
  // Progress
  completedModules: jsonb("completed_modules").$type<number[]>(),
  progressPercentage: numeric("progress_percentage").default("0"),
  
  // Completion
  isCompleted: boolean("is_completed").default(false),
  completedAt: timestamp("completed_at"),
  
  // Certificate
  certificateIssued: boolean("certificate_issued").default(false),
  certificateUrl: text("certificate_url"),
  
  // Payment
  amountPaid: numeric("amount_paid"),
  paymentStatus: text("payment_status"), // pending, paid, refunded
  
  // Engagement
  lastAccessedAt: timestamp("last_accessed_at"),
  totalTimeMinutes: integer("total_time_minutes").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("course_enrollments_user_idx").on(table.userId),
  index("course_enrollments_course_idx").on(table.courseId),
]);

export const insertCourseEnrollmentSchema = createInsertSchema(courseEnrollments).omit({ id: true, createdAt: true });
export type InsertCourseEnrollment = z.infer<typeof insertCourseEnrollmentSchema>;
export type CourseEnrollment = typeof courseEnrollments.$inferSelect;

// Tutor Sessions - AI tutor interactions
export const tutorSessions = pgTable("tutor_sessions", {
  id: serial("id").primaryKey(),
  
  userId: text("user_id").notNull(),
  courseId: integer("course_id").references(() => courses.id),
  
  // Session
  topic: text("topic"),
  messages: jsonb("messages").$type<{ role: string; content: string; timestamp: string }[]>(),
  
  // Metrics
  messageCount: integer("message_count").default(0),
  durationMinutes: integer("duration_minutes"),
  
  // Outcomes
  questionAnswered: boolean("question_answered"),
  satisfactionRating: integer("satisfaction_rating"), // 1-5
  
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("tutor_sessions_user_idx").on(table.userId),
]);

export const insertTutorSessionSchema = createInsertSchema(tutorSessions).omit({ id: true, createdAt: true });
export type InsertTutorSession = z.infer<typeof insertTutorSessionSchema>;
export type TutorSession = typeof tutorSessions.$inferSelect;

// ===========================
// PHASE 5: REGULATORY AI
// ===========================

// Regulatory Changes - Zoning & compliance monitoring
export const regulatoryChanges = pgTable("regulatory_changes", {
  id: serial("id").primaryKey(),
  
  // Location
  state: text("state").notNull(),
  county: text("county").notNull(),
  municipality: text("municipality"),
  
  // Change details
  changeType: text("change_type").notNull(), // zoning, tax, environmental, building_code
  title: text("title").notNull(),
  description: text("description"),
  
  // Impact
  impactLevel: text("impact_level"), // high, medium, low
  affectedProperties: jsonb("affected_properties").$type<number[]>(),
  
  // Timing
  effectiveDate: timestamp("effective_date"),
  proposedDate: timestamp("proposed_date"),
  
  // Source
  sourceUrl: text("source_url"),
  sourceDocument: text("source_document"),
  
  // Status
  status: text("status"), // proposed, approved, active, repealed
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("regulatory_changes_location_idx").on(table.state, table.county),
  index("regulatory_changes_type_idx").on(table.changeType),
  index("regulatory_changes_date_idx").on(table.effectiveDate),
]);

export const insertRegulatoryChangeSchema = createInsertSchema(regulatoryChanges).omit({ id: true, createdAt: true });
export type InsertRegulatoryChange = z.infer<typeof insertRegulatoryChangeSchema>;
export type RegulatoryChange = typeof regulatoryChanges.$inferSelect;

// Compliance Alerts - Property-specific alerts
export const complianceAlerts = pgTable("compliance_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  regulatoryChangeId: integer("regulatory_change_id").references(() => regulatoryChanges.id),
  
  // Alert
  alertType: text("alert_type").notNull(), // action_required, informational, deadline
  severity: text("severity").notNull(), // critical, high, medium, low
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Action
  actionRequired: text("action_required"),
  deadline: timestamp("deadline"),
  
  // Status
  status: text("status").default('pending'), // pending, acknowledged, resolved, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  resolvedAt: timestamp("resolved_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("compliance_alerts_org_idx").on(table.organizationId),
  index("compliance_alerts_property_idx").on(table.propertyId),
  index("compliance_alerts_status_idx").on(table.status),
]);

export const insertComplianceAlertSchema = createInsertSchema(complianceAlerts).omit({ id: true, createdAt: true });
export type InsertComplianceAlert = z.infer<typeof insertComplianceAlertSchema>;
export type ComplianceAlert = typeof complianceAlerts.$inferSelect;

// ===========================
// PHASE 5: WHITE-LABEL
// ===========================

// White-label Tenants - Enterprise customers
export const whitelabelTenants = pgTable("whitelabel_tenants", {
  id: serial("id").primaryKey(),
  
  // Tenant info
  tenantName: text("tenant_name").notNull(),
  subdomain: text("subdomain").notNull().unique(),
  customDomain: text("custom_domain").unique(),
  
  // Branding
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  
  // Features enabled
  features: jsonb("features").$type<string[]>(),
  
  // Limits
  maxUsers: integer("max_users"),
  maxProperties: integer("max_properties"),
  maxStorage: integer("max_storage"), // GB
  
  // Billing
  plan: text("plan").notNull(), // starter, professional, enterprise
  monthlyFee: numeric("monthly_fee").notNull(),
  
  // Admin
  adminUserId: text("admin_user_id"),
  adminEmail: text("admin_email"),
  
  // Status
  isActive: boolean("is_active").default(true),
  suspendedAt: timestamp("suspended_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("whitelabel_tenants_subdomain_idx").on(table.subdomain),
]);

export const insertWhitelabelTenantSchema = createInsertSchema(whitelabelTenants).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWhitelabelTenant = z.infer<typeof insertWhitelabelTenantSchema>;
export type WhitelabelTenant = typeof whitelabelTenants.$inferSelect;

// ===========================
// STRIPE WEBHOOK DEDUP
// ===========================

// Tracks processed Stripe events for idempotency
export const stripeProcessedEvents = pgTable("stripe_processed_events", {
  id: serial("id").primaryKey(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at").defaultNow(),
}, (table) => [
  index("stripe_processed_events_event_id_idx").on(table.stripeEventId),
]);

// ===========================
// AI TELEMETRY
// ===========================

// Tracks AI request metrics for cost optimization and observability
export const aiTelemetryEvents = pgTable("ai_telemetry_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  taskType: text("task_type").notNull(),
  provider: text("provider").notNull(), // openai, openrouter
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCostCents: numeric("estimated_cost_cents"),
  latencyMs: integer("latency_ms"),
  cacheHit: boolean("cache_hit").default(false),
  complexity: text("complexity"), // simple, moderate, complex
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("ai_telemetry_org_idx").on(table.organizationId),
  index("ai_telemetry_created_idx").on(table.createdAt),
  index("ai_telemetry_provider_idx").on(table.provider),
]);

// ─── User Map Layer Preferences ──────────────────────────────────────────────
// Persists per-user map layer toggle/opacity settings across devices.
export const userMapLayerPreferences = pgTable("user_map_layer_preferences", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  layerId: integer("layer_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  opacity: numeric("opacity", { precision: 4, scale: 2 }).notNull().default("0.70"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("user_map_layer_prefs_user_idx").on(table.userId),
  index("user_map_layer_prefs_unique_idx").on(table.userId, table.layerId),
]);

// ─── AI Model Configurations ─────────────────────────────────────────────────
// Founder-managed table of available AI models with routing weights per task type.
export const aiModelConfigs = pgTable("ai_model_configs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("openrouter"),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull(),
  costPerMillionInput: numeric("cost_per_million_input", { precision: 10, scale: 4 }),
  costPerMillionOutput: numeric("cost_per_million_output", { precision: 10, scale: 4 }),
  maxTokens: integer("max_tokens").default(4096),
  taskTypes: text("task_types").array().default([]),
  weight: integer("weight").default(50),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("ai_model_configs_enabled_idx").on(table.enabled),
]);

// ─── System API Keys ──────────────────────────────────────────────────────────
// Founder-managed system-wide API keys. Users' BYOK keys override these.
export const systemApiKeys = pgTable("system_api_keys", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  displayName: text("display_name").notNull(),
  apiKey: text("api_key"),
  isActive: boolean("is_active").default(true),
  lastValidatedAt: timestamp("last_validated_at"),
  validationStatus: text("validation_status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Goals ───────────────────────────────────────────────────────────────────
// Acquisition / revenue targets for the org.
// current_value is computed dynamically — not stored here.
export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  label: text("label").notNull(),
  goalType: text("goal_type").notNull(), // deals_closed | notes_deployed | revenue_earned | leads_contacted
  targetValue: numeric("target_value", { precision: 14, scale: 2 }).notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGoalSchema = createInsertSchema(goals).omit({ id: true, createdAt: true, updatedAt: true });
export type Goal = typeof goals.$inferSelect;

// ─── Background Jobs ──────────────────────────────────────────────────────────
// Persistent backing store for the in-memory JobQueueService.
// Jobs are dual-written here so they survive server restarts.
export const backgroundJobs = pgTable("background_jobs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // email | webhook | payment_sync | notification
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | completed | failed
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  scheduledFor: timestamp("scheduled_for").notNull(),
  error: text("error"),
  result: jsonb("result").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertBackgroundJobSchema = createInsertSchema(backgroundJobs).omit({
  id: true,
  createdAt: true,
});
export type InsertBackgroundJob = z.infer<typeof insertBackgroundJobSchema>;
export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type InsertGoal = typeof goals.$inferInsert;

// ============================================
// INVESTOR VERIFICATION
// ============================================

// KYC document uploads for investor verification
export const investorVerificationDocuments = pgTable("investor_verification_documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id).notNull(),
  documentType: text("document_type").notNull(), // passport | drivers_license | articles_of_org | proof_of_funds | accreditation_docs
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  status: text("status").notNull().default("pending"), // pending | reviewing | approved | rejected
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("investor_ver_docs_org_idx").on(table.organizationId),
  index("investor_ver_docs_profile_idx").on(table.investorProfileId),
  index("investor_ver_docs_status_idx").on(table.status),
]);

export const insertInvestorVerificationDocumentSchema = createInsertSchema(investorVerificationDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestorVerificationDocument = z.infer<typeof insertInvestorVerificationDocumentSchema>;
export type InvestorVerificationDocument = typeof investorVerificationDocuments.$inferSelect;

// Audit trail for verification state changes
export const investorVerificationHistory = pgTable("investor_verification_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id).notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),
  changedBy: text("changed_by").notNull(), // admin user id
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("investor_ver_history_org_idx").on(table.organizationId),
  index("investor_ver_history_profile_idx").on(table.investorProfileId),
  index("investor_ver_history_created_idx").on(table.createdAt),
]);

export const insertInvestorVerificationHistorySchema = createInsertSchema(investorVerificationHistory).omit({ id: true, createdAt: true });
export type InsertInvestorVerificationHistory = z.infer<typeof insertInvestorVerificationHistorySchema>;
export type InvestorVerificationHistory = typeof investorVerificationHistory.$inferSelect;

// Third-party background check results
export const backgroundCheckResults = pgTable("background_check_results", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id).notNull(),
  provider: text("provider").notNull(), // stripe_identity | persona
  externalId: text("external_id"),
  status: text("status").notNull().default("pending"), // pending | completed | failed
  riskLevel: text("risk_level"), // low | medium | high
  reportData: jsonb("report_data").$type<Record<string, any>>(),
  checkedAt: timestamp("checked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("background_checks_org_idx").on(table.organizationId),
  index("background_checks_profile_idx").on(table.investorProfileId),
  index("background_checks_status_idx").on(table.status),
]);

export const insertBackgroundCheckResultSchema = createInsertSchema(backgroundCheckResults).omit({ id: true, createdAt: true });
export type InsertBackgroundCheckResult = z.infer<typeof insertBackgroundCheckResultSchema>;
export type BackgroundCheckResult = typeof backgroundCheckResults.$inferSelect;

// ============================================
// FEE MANAGEMENT
// ============================================

// Fee collection / escrow / payout records
export const transactionFeeSettlements = pgTable("transaction_fee_settlements", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  transactionId: integer("transaction_id").references(() => marketplaceTransactions.id).notNull(),
  feeType: text("fee_type").notNull(), // platform_fee | buyer_fee | seller_fee
  feeAmount: numeric("fee_amount").notNull(),
  feePercent: numeric("fee_percent"),
  status: text("status").notNull().default("pending"), // pending | held | released | refunded
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeTransferIds: text("stripe_transfer_ids").array(),
  heldUntil: timestamp("held_until"),
  releasedAt: timestamp("released_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("fee_settlements_org_idx").on(table.organizationId),
  index("fee_settlements_transaction_idx").on(table.transactionId),
  index("fee_settlements_status_idx").on(table.status),
]);

export const insertTransactionFeeSettlementSchema = createInsertSchema(transactionFeeSettlements).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTransactionFeeSettlement = z.infer<typeof insertTransactionFeeSettlementSchema>;
export type TransactionFeeSettlement = typeof transactionFeeSettlements.$inferSelect;

// Automated payout scheduling config
export const feePayoutSchedules = pgTable("fee_payout_schedules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  cadence: text("cadence").notNull(), // daily | weekly | biweekly | monthly
  minimumPayoutAmount: numeric("minimum_payout_amount").default("0"),
  stripeConnectedAccountId: text("stripe_connected_account_id"),
  nextPayoutAt: timestamp("next_payout_at"),
  lastPayoutAt: timestamp("last_payout_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("fee_payout_schedules_org_idx").on(table.organizationId),
  index("fee_payout_schedules_next_payout_idx").on(table.nextPayoutAt),
]);

export const insertFeePayoutScheduleSchema = createInsertSchema(feePayoutSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeePayoutSchedule = z.infer<typeof insertFeePayoutScheduleSchema>;
export type FeePayoutSchedule = typeof feePayoutSchedules.$inferSelect;

// Immutable ledger of all fee events
export const feeAuditLog = pgTable("fee_audit_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  settlementId: integer("settlement_id").references(() => transactionFeeSettlements.id),
  eventType: text("event_type").notNull(), // fee_collected | escrow_held | payout_sent | refund_issued
  amount: numeric("amount").notNull(),
  balanceBefore: numeric("balance_before").notNull(),
  balanceAfter: numeric("balance_after").notNull(),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  performedBy: text("performed_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("fee_audit_log_org_idx").on(table.organizationId),
  index("fee_audit_log_settlement_idx").on(table.settlementId),
  index("fee_audit_log_created_idx").on(table.createdAt),
]);

export const insertFeeAuditLogSchema = createInsertSchema(feeAuditLog).omit({ id: true, createdAt: true });
export type InsertFeeAuditLog = z.infer<typeof insertFeeAuditLogSchema>;
export type FeeAuditLog = typeof feeAuditLog.$inferSelect;

// ============================================
// TAX & COST BASIS
// ============================================

// Cost basis per property for tax purposes
export const costBasis = pgTable("cost_basis", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  acquisitionDate: timestamp("acquisition_date"),
  acquisitionPrice: numeric("acquisition_price"),
  acquisitionCosts: numeric("acquisition_costs"),
  improvementCosts: numeric("improvement_costs"),
  adjustedBasis: numeric("adjusted_basis"),
  dispositionDate: timestamp("disposition_date"),
  dispositionPrice: numeric("disposition_price"),
  gainLoss: numeric("gain_loss"),
  holdingPeriod: text("holding_period"), // short | long
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("cost_basis_org_idx").on(table.organizationId),
  index("cost_basis_property_idx").on(table.propertyId),
]);

export const insertCostBasisSchema = createInsertSchema(costBasis).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCostBasis = z.infer<typeof insertCostBasisSchema>;
export type CostBasis = typeof costBasis.$inferSelect;

// Depreciation tracking per property
export const depreciationSchedules = pgTable("depreciation_schedules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  method: text("method").notNull(), // straight_line | accelerated | bonus
  landValue: numeric("land_value"),
  improvementValue: numeric("improvement_value"),
  totalCost: numeric("total_cost"),
  usefulLifeYears: integer("useful_life_years"),
  annualDepreciation: numeric("annual_depreciation"),
  accumulatedDepreciation: numeric("accumulated_depreciation"),
  remainingBasis: numeric("remaining_basis"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  scheduleData: jsonb("schedule_data").$type<Array<{ year: number; depreciation: number; cumulativeDepreciation: number }>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("depreciation_schedules_org_idx").on(table.organizationId),
  index("depreciation_schedules_property_idx").on(table.propertyId),
]);

export const insertDepreciationScheduleSchema = createInsertSchema(depreciationSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDepreciationSchedule = z.infer<typeof insertDepreciationScheduleSchema>;
export type DepreciationSchedule = typeof depreciationSchedules.$inferSelect;

// OZ investment tracking
export const opportunityZoneHoldings = pgTable("opportunity_zone_holdings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  ozFundName: text("oz_fund_name"),
  ozTractId: text("oz_tract_id"),
  investmentDate: timestamp("investment_date"),
  initialInvestment: numeric("initial_investment"),
  deferredGainRollover: numeric("deferred_gain_rollover"),
  qualifiedOpportunityFund: text("qualified_opportunity_fund"),
  holdingYears: integer("holding_years"),
  stepUpBasis: numeric("step_up_basis"),
  estimatedTaxSavings: numeric("estimated_tax_savings"),
  exitDate: timestamp("exit_date"),
  exitValue: numeric("exit_value"),
  status: text("status").notNull().default("active"), // active | exited
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("oz_holdings_org_idx").on(table.organizationId),
  index("oz_holdings_property_idx").on(table.propertyId),
  index("oz_holdings_status_idx").on(table.status),
]);

export const insertOpportunityZoneHoldingSchema = createInsertSchema(opportunityZoneHoldings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOpportunityZoneHolding = z.infer<typeof insertOpportunityZoneHoldingSchema>;
export type OpportunityZoneHolding = typeof opportunityZoneHoldings.$inferSelect;

// AI-generated tax strategy recommendations
export const taxStrategies = pgTable("tax_strategies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  strategyType: text("strategy_type").notNull(), // 1031_exchange | oz_investment | depreciation | cost_segregation | installment_sale | harvest_losses
  title: text("title").notNull(),
  description: text("description"),
  estimatedTaxSavings: numeric("estimated_tax_savings"),
  implementationCost: numeric("implementation_cost"),
  timeframe: text("timeframe"),
  riskLevel: text("risk_level"), // low | medium | high
  requirements: jsonb("requirements").$type<Record<string, any>>(),
  applicableProperties: integer("applicable_properties").array(),
  status: text("status").notNull().default("recommended"), // recommended | implementing | completed | dismissed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tax_strategies_org_idx").on(table.organizationId),
  index("tax_strategies_type_idx").on(table.strategyType),
  index("tax_strategies_status_idx").on(table.status),
]);

export const insertTaxStrategySchema = createInsertSchema(taxStrategies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxStrategy = z.infer<typeof insertTaxStrategySchema>;
export type TaxStrategy = typeof taxStrategies.$inferSelect;

// Multi-year tax planning scenarios
export const taxForecastScenarios = pgTable("tax_forecast_scenarios", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  scenarioName: text("scenario_name").notNull(),
  holdYears: integer("hold_years"),
  scenarioType: text("scenario_type").notNull(), // hold | sell | exchange | develop
  propertyIds: integer("property_ids").array(),
  projectedSalePrice: numeric("projected_sale_price"),
  projectedCapGain: numeric("projected_cap_gain"),
  projectedTaxLiability: numeric("projected_tax_liability"),
  projectedNetProceeds: numeric("projected_net_proceeds"),
  assumptions: jsonb("assumptions").$type<Record<string, any>>(),
  yearlyBreakdown: jsonb("yearly_breakdown").$type<Array<Record<string, any>>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tax_forecast_scenarios_org_idx").on(table.organizationId),
  index("tax_forecast_scenarios_type_idx").on(table.scenarioType),
]);

export const insertTaxForecastScenarioSchema = createInsertSchema(taxForecastScenarios).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxForecastScenario = z.infer<typeof insertTaxForecastScenarioSchema>;
export type TaxForecastScenario = typeof taxForecastScenarios.$inferSelect;

// ============================================
// VOICE & RECORDING
// ============================================

// Call recording storage metadata
export const voiceCallRecordings = pgTable("voice_call_recordings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  voiceCallId: integer("voice_call_id").references(() => voiceCalls.id).notNull(),
  audioFileUrl: text("audio_file_url"),
  audioFileBucket: text("audio_file_bucket"),
  audioFileKey: text("audio_file_key"),
  durationSeconds: integer("duration_seconds"),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: text("mime_type"),
  encryptionKeyId: text("encryption_key_id"),
  tcpaConsentObtained: boolean("tcpa_consent_obtained").default(false),
  disclosurePlayedAt: timestamp("disclosure_played_at"),
  recordingStartedAt: timestamp("recording_started_at"),
  transcriptionStatus: text("transcription_status").notNull().default("pending"), // pending | processing | completed | failed
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("voice_call_recordings_org_idx").on(table.organizationId),
  index("voice_call_recordings_call_idx").on(table.voiceCallId),
  index("voice_call_recordings_status_idx").on(table.transcriptionStatus),
]);

export const insertVoiceCallRecordingSchema = createInsertSchema(voiceCallRecordings).omit({ id: true, createdAt: true });
export type InsertVoiceCallRecording = z.infer<typeof insertVoiceCallRecordingSchema>;
export type VoiceCallRecording = typeof voiceCallRecordings.$inferSelect;

// ============================================
// SATELLITE ANALYSIS
// ============================================

// Satellite change detection results
export const satelliteAnalysis = pgTable("satellite_analysis", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  baselineSnapshotId: integer("baseline_snapshot_id"),
  comparisonSnapshotId: integer("comparison_snapshot_id"),
  analysisDate: timestamp("analysis_date").notNull(),
  changeScore: numeric("change_score"), // 0–100
  vegetationChangePct: numeric("vegetation_change_pct"),
  structureChangePct: numeric("structure_change_pct"),
  boundaryChangePct: numeric("boundary_change_pct"),
  detectedChanges: jsonb("detected_changes").$type<Array<Record<string, any>>>(),
  diffImageUrl: text("diff_image_url"),
  ndviBaseline: numeric("ndvi_baseline"),
  ndviCurrent: numeric("ndvi_current"),
  analysisMetadata: jsonb("analysis_metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("satellite_analysis_org_idx").on(table.organizationId),
  index("satellite_analysis_property_idx").on(table.propertyId),
  index("satellite_analysis_date_idx").on(table.analysisDate),
]);

export const insertSatelliteAnalysisSchema = createInsertSchema(satelliteAnalysis).omit({ id: true, createdAt: true });
export type InsertSatelliteAnalysis = z.infer<typeof insertSatelliteAnalysisSchema>;
export type SatelliteAnalysis = typeof satelliteAnalysis.$inferSelect;

// ============================================
// ML MODEL REGISTRY
// ============================================

// ML model version registry
export const modelVersions = pgTable("model_versions", {
  id: serial("id").primaryKey(),
  modelType: text("model_type").notNull(), // valuation | credit_score | demand_prediction
  version: text("version").notNull(),
  gitHash: text("git_hash"),
  trainedAt: timestamp("trained_at"),
  deployedAt: timestamp("deployed_at"),
  retiredAt: timestamp("retired_at"),
  status: text("status").notNull().default("training"), // training | staging | production | retired
  trainingSamples: integer("training_samples"),
  validationSamples: integer("validation_samples"),
  primaryMetric: text("primary_metric"),
  primaryMetricValue: numeric("primary_metric_value"),
  isActive: boolean("is_active").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("model_versions_type_idx").on(table.modelType),
  index("model_versions_status_idx").on(table.status),
  index("model_versions_active_idx").on(table.isActive),
]);

export const insertModelVersionSchema = createInsertSchema(modelVersions).omit({ id: true, createdAt: true });
export type InsertModelVersion = z.infer<typeof insertModelVersionSchema>;
export type ModelVersion = typeof modelVersions.$inferSelect;

// ML training run metrics
export const trainingMetrics = pgTable("training_metrics", {
  id: serial("id").primaryKey(),
  modelVersionId: integer("model_version_id").references(() => modelVersions.id).notNull(),
  metricName: text("metric_name").notNull(), // mae | rmse | mape | r2 | accuracy
  metricValue: numeric("metric_value").notNull(),
  splitType: text("split_type").notNull(), // train | validation | test
  state: text("state"),
  propertyType: text("property_type"),
  sampleCount: integer("sample_count"),
  computedAt: timestamp("computed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("training_metrics_model_version_idx").on(table.modelVersionId),
  index("training_metrics_metric_name_idx").on(table.metricName),
  index("training_metrics_split_type_idx").on(table.splitType),
]);

export const insertTrainingMetricSchema = createInsertSchema(trainingMetrics).omit({ id: true, createdAt: true });
export type InsertTrainingMetric = z.infer<typeof insertTrainingMetricSchema>;
export type TrainingMetric = typeof trainingMetrics.$inferSelect;

// ============================================
// REGULATORY COMPLIANCE
// ============================================

// State/county disclosure law database
export const regulatoryRequirements = pgTable("regulatory_requirements", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(),
  county: text("county"),
  requirementType: text("requirement_type").notNull(), // disclosure | filing | recording | escrow | licensing
  title: text("title").notNull(),
  description: text("description"),
  legalCitation: text("legal_citation"),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
  jurisdictionLevel: text("jurisdiction_level").notNull(), // state | county | city
  transactionTypes: text("transaction_types").array(),
  requiredDocuments: text("required_documents").array(),
  penalties: text("penalties"),
  isActive: boolean("is_active").default(true),
  lastVerified: timestamp("last_verified"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("regulatory_requirements_state_idx").on(table.state),
  index("regulatory_requirements_type_idx").on(table.requirementType),
  index("regulatory_requirements_active_idx").on(table.isActive),
]);

export const insertRegulatoryRequirementSchema = createInsertSchema(regulatoryRequirements).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRegulatoryRequirement = z.infer<typeof insertRegulatoryRequirementSchema>;
export type RegulatoryRequirement = typeof regulatoryRequirements.$inferSelect;

// Per-transaction compliance checklist
export const complianceChecklistItems = pgTable("compliance_checklist_items", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id"),
  requirementId: integer("requirement_id").references(() => regulatoryRequirements.id),
  itemTitle: text("item_title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"), // pending | completed | waived | na
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("compliance_checklist_org_idx").on(table.organizationId),
  index("compliance_checklist_deal_idx").on(table.dealId),
  index("compliance_checklist_status_idx").on(table.status),
]);

export const insertComplianceChecklistItemSchema = createInsertSchema(complianceChecklistItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertComplianceChecklistItem = z.infer<typeof insertComplianceChecklistItemSchema>;
export type ComplianceChecklistItem = typeof complianceChecklistItems.$inferSelect;

// ============================================
// CERTIFICATE VERIFICATION
// ============================================

// Public tamper-proof cert verification
export const certificateVerification = pgTable("certificate_verification", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  certificationId: integer("certification_id"),
  recipientName: text("recipient_name").notNull(),
  recipientEmail: text("recipient_email"),
  certType: text("cert_type").notNull(),
  issuedAt: timestamp("issued_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  publicUrl: text("public_url"),
  verificationHash: text("verification_hash").unique(),
  isRevoked: boolean("is_revoked").default(false),
  revokedAt: timestamp("revoked_at"),
  revokedReason: text("revoked_reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("cert_verification_org_idx").on(table.organizationId),
  index("cert_verification_hash_idx").on(table.verificationHash),
  index("cert_verification_recipient_idx").on(table.recipientEmail),
]);

export const insertCertificateVerificationSchema = createInsertSchema(certificateVerification).omit({ id: true, createdAt: true });
export type InsertCertificateVerification = z.infer<typeof insertCertificateVerificationSchema>;
export type CertificateVerification = typeof certificateVerification.$inferSelect;

// ============================================
// TENANT USAGE METERING
// ============================================

// Per-tenant usage metering
export const tenantMetrics = pgTable("tenant_metrics", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => whitelabelTenants.id).notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  activeUsers: integer("active_users").default(0),
  totalApiCalls: integer("total_api_calls").default(0),
  aiCreditsConsumed: numeric("ai_credits_consumed").default("0"),
  storageUsedMb: integer("storage_used_mb").default(0),
  voiceMinutesUsed: integer("voice_minutes_used").default(0),
  revenueGenerated: numeric("revenue_generated").default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tenant_metrics_tenant_idx").on(table.tenantId),
  index("tenant_metrics_period_idx").on(table.periodStart, table.periodEnd),
]);

export const insertTenantMetricSchema = createInsertSchema(tenantMetrics).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenantMetric = z.infer<typeof insertTenantMetricSchema>;
export type TenantMetric = typeof tenantMetrics.$inferSelect;

// ============================================
// DEAL ROOM MESSAGES & DOCUMENTS (Tasks 45-52)
// ============================================

// Deal Room Messages — real-time chat within a deal room
export const dealRoomMessages = pgTable("deal_room_messages", {
  id: serial("id").primaryKey(),
  dealRoomId: integer("deal_room_id").references(() => dealRooms.id).notNull(),
  senderId: text("sender_id").notNull(), // user/org ID string
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  messageType: text("message_type").notNull().default("text"), // text | system | document
  attachmentUrl: text("attachment_url"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("deal_room_messages_room_idx").on(table.dealRoomId),
  index("deal_room_messages_created_idx").on(table.createdAt),
]);

export const insertDealRoomMessageSchema = createInsertSchema(dealRoomMessages).omit({ id: true, createdAt: true });
export type InsertDealRoomMessage = z.infer<typeof insertDealRoomMessageSchema>;
export type DealRoomMessage = typeof dealRoomMessages.$inferSelect;

// Deal Room Documents — versioned file storage per deal room
export const dealRoomDocuments = pgTable("deal_room_documents", {
  id: serial("id").primaryKey(),
  dealRoomId: integer("deal_room_id").references(() => dealRooms.id).notNull(),
  uploadedBy: text("uploaded_by").notNull(), // user/org ID string
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"), // bytes
  mimeType: text("mime_type"),
  version: integer("version").notNull().default(1),
  previousVersionId: integer("previous_version_id"), // self-reference via ID for version chain
  accessControl: jsonb("access_control").$type<{ allowedUserIds: string[] }>().notNull().default({ allowedUserIds: [] }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("deal_room_documents_room_idx").on(table.dealRoomId),
  index("deal_room_documents_file_idx").on(table.dealRoomId, table.fileName),
]);

export const insertDealRoomDocumentSchema = createInsertSchema(dealRoomDocuments).omit({ id: true, createdAt: true });
export type InsertDealRoomDocument = z.infer<typeof insertDealRoomDocumentSchema>;
export type DealRoomDocument = typeof dealRoomDocuments.$inferSelect;

// ============================================
// PASSIVE COMMAND CENTER — FOUNDER INTELLIGENCE
// ============================================

// Decisions Inbox — pre-analyzed items requiring human judgment
export const decisionsInboxItems = pgTable("decisions_inbox_items", {
  id: serial("id").primaryKey(),
  itemType: text("item_type").notNull(), // support_escalation | critical_alert | feature_request_flagged | churn_risk_intervention | dunning_recovery
  riskLevel: text("risk_level").notNull().default("medium"), // low | medium | high | critical
  urgencyScore: integer("urgency_score").notNull().default(50), // 0-100
  estimatedImpactCents: integer("estimated_impact_cents"),
  sophieAnalysis: text("sophie_analysis").notNull(),
  sophieConfidenceScore: integer("sophie_confidence_score"),
  recommendedAction: text("recommended_action").notNull(),
  recommendedActionLabel: text("recommended_action_label").notNull(),
  actionPayload: jsonb("action_payload").$type<Record<string, any>>(),
  sourceTicketId: integer("source_ticket_id").references(() => supportTickets.id),
  sourceAlertId: integer("source_alert_id").references(() => systemAlerts.id),
  sourceFeatureRequestId: integer("source_feature_request_id").references(() => featureRequests.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | deferred | auto_resolved
  deferredUntil: timestamp("deferred_until"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  founderOverrideAction: text("founder_override_action"),
  contextBundle: jsonb("context_bundle").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("decisions_inbox_status_idx").on(table.status),
  index("decisions_inbox_urgency_idx").on(table.urgencyScore),
  index("decisions_inbox_org_idx").on(table.organizationId),
]);

export const insertDecisionsInboxItemSchema = createInsertSchema(decisionsInboxItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDecisionsInboxItem = z.infer<typeof insertDecisionsInboxItemSchema>;
export type DecisionsInboxItem = typeof decisionsInboxItems.$inferSelect;

// Churn Risk Scores — per-org composite risk scoring
export const churnRiskScores = pgTable("churn_risk_scores", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  riskScore: integer("risk_score").notNull(), // 0-100
  riskBand: text("risk_band").notNull(), // green | yellow | red | critical
  loginFrequencyScore: integer("login_frequency_score"),    // 0-25
  featureUsageScore: integer("feature_usage_score"),        // 0-25
  supportTicketScore: integer("support_ticket_score"),      // 0-20
  dunningStateScore: integer("dunning_state_score"),        // 0-20
  engagementTrendScore: integer("engagement_trend_score"),  // 0-10
  daysSinceLastActive: integer("days_since_last_active"),
  loginsLast14d: integer("logins_last_14d"),
  ticketsLast30d: integer("tickets_last_30d"),
  dunningStage: text("dunning_stage"),
  featureUsageTrend: text("feature_usage_trend"), // increasing | stable | declining
  lastInterventionAt: timestamp("last_intervention_at"),
  lastInterventionType: text("last_intervention_type"),
  interventionCount: integer("intervention_count").default(0),
  nextInterventionAt: timestamp("next_intervention_at"),
  nextInterventionType: text("next_intervention_type"),
  scoredAt: timestamp("scored_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("churn_risk_org_idx").on(table.organizationId),
  index("churn_risk_band_idx").on(table.riskBand),
  index("churn_risk_score_idx").on(table.riskScore),
]);

export const insertChurnRiskScoreSchema = createInsertSchema(churnRiskScores).omit({ id: true, createdAt: true });
export type InsertChurnRiskScore = z.infer<typeof insertChurnRiskScoreSchema>;
export type ChurnRiskScore = typeof churnRiskScores.$inferSelect;

// Job Health Logs — execution records for all background jobs
export const jobHealthLogs = pgTable("job_health_logs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  runStartedAt: timestamp("run_started_at").notNull(),
  runCompletedAt: timestamp("run_completed_at"),
  durationMs: integer("duration_ms"),
  status: text("status").notNull(), // success | failed | timeout | skipped_lock
  errorMessage: text("error_message"),
  runMetrics: jsonb("run_metrics").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("job_health_job_name_idx").on(table.jobName),
  index("job_health_status_idx").on(table.status),
  index("job_health_started_idx").on(table.runStartedAt),
]);

export const insertJobHealthLogSchema = createInsertSchema(jobHealthLogs).omit({ id: true, createdAt: true });
export type InsertJobHealthLog = z.infer<typeof insertJobHealthLogSchema>;
export type JobHealthLog = typeof jobHealthLogs.$inferSelect;

// Revenue Protection Interventions — automated churn/dunning outreach log
export const revenueProtectionInterventions = pgTable("revenue_protection_interventions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  interventionType: text("intervention_type").notNull(), // checkin_email | retention_offer | dunning_recovery | founder_decision
  triggerRiskScore: integer("trigger_risk_score").notNull(),
  triggerRiskBand: text("trigger_risk_band").notNull(),
  executedBy: text("executed_by").notNull().default("sophie"),
  sophieMessageSubject: text("sophie_message_subject"),
  sophieMessageBody: text("sophie_message_body"),
  emailSentAt: timestamp("email_sent_at"),
  emailDeliveryStatus: text("email_delivery_status"),
  outcome: text("outcome"), // pending | customer_responded | payment_recovered | churned | no_response
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
  revenueRecoveredCents: integer("revenue_recovered_cents"),
  decisionsInboxItemId: integer("decisions_inbox_item_id").references(() => decisionsInboxItems.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("rev_protection_org_idx").on(table.organizationId),
  index("rev_protection_type_idx").on(table.interventionType),
  index("rev_protection_created_idx").on(table.createdAt),
]);

export const insertRevenueProtectionInterventionSchema = createInsertSchema(revenueProtectionInterventions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRevenueProtectionIntervention = z.infer<typeof insertRevenueProtectionInterventionSchema>;
export type RevenueProtectionIntervention = typeof revenueProtectionInterventions.$inferSelect;

// Founder Digest History — daily automated briefing records
export const founderDigestHistory = pgTable("founder_digest_history", {
  id: serial("id").primaryKey(),
  digestDate: timestamp("digest_date").notNull(),
  deliveredAt: timestamp("delivered_at"),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  revenueBullet: text("revenue_bullet"),
  systemHealthBullet: text("system_health_bullet"),
  supportActivityBullet: text("support_activity_bullet"),
  topAtRiskBullet: text("top_at_risk_bullet"),
  recommendedActionBullet: text("recommended_action_bullet"),
  dataSnapshot: jsonb("data_snapshot").$type<Record<string, any>>(),
  mrrCents: integer("mrr_cents"),
  openDecisions: integer("open_decisions"),
  sophieAutoResolved24h: integer("sophie_auto_resolved_24h"),
  jobFailures24h: integer("job_failures_24h"),
  atRiskOrgs: integer("at_risk_orgs"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("founder_digest_date_idx").on(table.digestDate),
  index("founder_digest_status_idx").on(table.deliveryStatus),
]);

export const insertFounderDigestHistorySchema = createInsertSchema(founderDigestHistory).omit({ id: true, createdAt: true });
export type InsertFounderDigestHistory = z.infer<typeof insertFounderDigestHistorySchema>;
export type FounderDigestHistory = typeof founderDigestHistory.$inferSelect;

// Platform Config — encrypted key-value store for founder-managed credentials
// Values are AES-256 encrypted at rest. The configManager service merges these
// into process.env at startup so all existing code continues to work unchanged.
export const platformConfig = pgTable("platform_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),           // e.g. "STRIPE_SECRET_KEY"
  encryptedValue: text("encrypted_value"),        // AES-256-GCM encrypted, null = delete
  service: text("service").notNull(),             // e.g. "stripe" | "aws" | "openrouter"
  label: text("label").notNull(),                 // Human-readable label
  isSecret: boolean("is_secret").notNull().default(true),
  isRequired: boolean("is_required").notNull().default(false),
  validatedAt: timestamp("validated_at"),         // last time this credential was verified OK
  validationStatus: text("validation_status"),    // "ok" | "error" | null
  validationMessage: text("validation_message"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("platform_config_key_idx").on(table.key),
  index("platform_config_service_idx").on(table.service),
]);

export const insertPlatformConfigSchema = createInsertSchema(platformConfig).omit({ id: true, createdAt: true });
export type InsertPlatformConfig = z.infer<typeof insertPlatformConfigSchema>;
export type PlatformConfig = typeof platformConfig.$inferSelect;

// ============================================
// PLATFORM FEATURE FLAGS (Founder-controlled feature visibility)
// ============================================

export const platformFeatureFlags = pgTable("platform_feature_flags", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),            // e.g. "feature_academy"
  label: text("label").notNull(),                  // human-readable name
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  // which nav items this flag controls (JSON array of hrefs like ["/academy"])
  controlledRoutes: jsonb("controlled_routes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPlatformFeatureFlagSchema = createInsertSchema(platformFeatureFlags).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PlatformFeatureFlag = typeof platformFeatureFlags.$inferSelect;
export type InsertPlatformFeatureFlag = z.infer<typeof insertPlatformFeatureFlagSchema>;

// ============================================
// PRICING CONFIG (Founder-controlled pricing + promotions)
// ============================================

export const pricingConfig = pgTable("pricing_config", {
  id: serial("id").primaryKey(),
  tier: text("tier").notNull().unique(),           // 'pro', 'growth', 'enterprise'
  displayPriceMonthly: integer("display_price_monthly").notNull(), // cents
  displayPriceYearly: integer("display_price_yearly").notNull(),   // cents (per month, billed annually)
  // Active promotion (null = no promo)
  promoLabel: text("promo_label"),                 // e.g. "Spring Sale"
  promoDiscountPercent: integer("promo_discount_percent"), // 0-100
  promoEndsAt: timestamp("promo_ends_at"),
  // Stripe coupon ID (created on-the-fly when promo is set)
  stripeCouponId: text("stripe_coupon_id"),
  // Allow user-entered promo codes at checkout
  allowPromoCodes: boolean("allow_promo_codes").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPricingConfigSchema = createInsertSchema(pricingConfig).omit({
  id: true, updatedAt: true,
});
export type PricingConfig = typeof pricingConfig.$inferSelect;
export type InsertPricingConfig = z.infer<typeof insertPricingConfigSchema>;

// ============================================
// GROWTH / AD MARKETING (AcreOS own customer acquisition)
// ============================================

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

// ============================================
// AUTONOMOUS OBSERVATORY
// ============================================

// System activity log: every meaningful autonomous action the system takes
export const systemActivity = pgTable("system_activity", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "set null" }),
  jobName: text("job_name").notNull(),   // 'finance_agent', 'sophie', 'dunning', etc.
  action: text("action").notNull(),      // 'payment_reminder_sent', 'ticket_resolved', etc.
  summary: text("summary").notNull(),    // human-readable narrative
  entityType: text("entity_type"),       // 'note', 'lead', 'campaign', 'support_case'
  entityId: text("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("IDX_sysact_created").on(table.createdAt),
  index("IDX_sysact_org").on(table.orgId, table.createdAt),
  index("IDX_sysact_job").on(table.jobName, table.createdAt),
]);
export type SystemActivity = typeof systemActivity.$inferSelect;

// System meta: key-value store for operational state
export const systemMeta = pgTable("system_meta", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type SystemMeta = typeof systemMeta.$inferSelect;

// ============================================
// CAMPAIGN VARIANTS (A/B Test Framework)
// ============================================

// Lightweight per-campaign variant table for A/B split testing
export const campaignVariants = pgTable("campaign_variants", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => campaigns.id).notNull(),
  name: text("name").notNull(), // "Variant A", "Variant B"
  subject: text("subject"),
  body: text("body"),
  trafficSplit: integer("traffic_split").default(50), // percentage of audience (0-100)
  sentCount: integer("sent_count").default(0),
  openCount: integer("open_count").default(0),
  clickCount: integer("click_count").default(0),
  responseCount: integer("response_count").default(0),
  isWinner: boolean("is_winner").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCampaignVariantSchema = createInsertSchema(campaignVariants).omit({ id: true, createdAt: true });
export type CampaignVariant = typeof campaignVariants.$inferSelect;
export type InsertCampaignVariant = z.infer<typeof insertCampaignVariantSchema>;

// ============================================
// ORGANIZATION API KEYS
// ============================================
// Per-org API keys allowing external integrations to authenticate with AcreOS.
// The raw key is only returned once at creation; we store a SHA-256 hash.
export const orgApiKeys = pgTable("org_api_keys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),

  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(), // SHA-256 hex of the actual key
  keyPrefix: text("key_prefix").notNull(), // First 8 chars for display ("acos_XXXX...")
  scope: text("scope").notNull().default("read"), // read | write | admin

  expiresAt: timestamp("expires_at"), // null = never

  lastUsedAt: timestamp("last_used_at"),
  isRevoked: boolean("is_revoked").notNull().default(false),

  createdBy: integer("created_by"), // team member ID
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("org_api_keys_org_idx").on(table.organizationId),
]);

export const insertOrgApiKeySchema = createInsertSchema(orgApiKeys).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
  isRevoked: true,
});
export type OrgApiKey = typeof orgApiKeys.$inferSelect;
export type InsertOrgApiKey = z.infer<typeof insertOrgApiKeySchema>;
