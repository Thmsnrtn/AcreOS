import { pgTable, text, serial, integer, boolean, timestamp, numeric, varchar, jsonb } from "drizzle-orm/pg-core";
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
  }>(),
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
  provider: text("provider").notNull(), // sendgrid, twilio, lob
  isEnabled: boolean("is_enabled").default(true),
  credentials: jsonb("credentials").$type<{
    encrypted?: string; // Encrypted JSON blob containing apiKey and other secrets
    apiKey?: string;
    accountSid?: string; // Twilio
    authToken?: string; // Twilio
    fromEmail?: string; // SendGrid default sender
    fromName?: string; // SendGrid default sender name
    fromPhoneNumber?: string; // Twilio default sender
  }>(),
  settings: jsonb("settings").$type<{
    testMode?: boolean;
    webhookSecret?: string;
    defaultTemplateId?: string;
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
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
  
  notes: text("notes"),
  assignedTo: integer("assigned_to"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
  paymentMethod: text("payment_method"), // ach, card, manual
  paymentAccountId: text("payment_account_id"), // Reference to stored payment method
  autoPayEnabled: boolean("auto_pay_enabled").default(false),
  
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
});

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
});

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
});

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
});

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
  starter: {
    name: "Starter",
    price: 49,
    limits: {
      leads: 500,
      properties: 100,
      notes: 50,
      teamMembers: 2,
      aiRequestsPerMonth: 1000,
      campaigns: 10,
      monthlyCredits: 1000, // $10.00
    },
    features: ["basic_crm", "basic_inventory", "basic_notes", "ai_due_diligence", "email_campaigns"],
  },
  pro: {
    name: "Pro",
    price: 149,
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
      "payment_processing", "reporting"
    ],
  },
  scale: {
    name: "Scale",
    price: 399,
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
      "priority_support", "custom_branding", "team_messaging"
    ],
  },
  enterprise: {
    name: "Enterprise",
    price: 799,
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
      "white_label_portal", "dedicated_support", "compliance_exports", "custom_integrations"
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
  
  name: text("name").notNull(),
  type: text("type").notNull(),
  content: text("content"), // Generated content
  pdfUrl: text("pdf_url"),
  
  variables: jsonb("variables").$type<Record<string, string | number>>(),
  
  status: text("status").notNull().default("draft"), // draft, pending_signature, partially_signed, signed, cancelled
  
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
  expiresAt: timestamp("expires_at"),
  
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
