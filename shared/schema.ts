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
  
  notes: text("notes"),
  assignedTo: integer("assigned_to"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================
// FINANCE: NOTES & PAYMENTS (GeekPay Replacement)
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
  
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
  id: true, createdAt: true, updatedAt: true 
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

// AI Command Center
export const insertAiAgentProfileSchema = createInsertSchema(aiAgentProfiles).omit({ id: true });
export const insertAiToolDefinitionSchema = createInsertSchema(aiToolDefinitions).omit({ id: true });
export const insertAiExecutionRunSchema = createInsertSchema(aiExecutionRuns).omit({ id: true });
export const insertAiMemorySchema = createInsertSchema(aiMemory).omit({ id: true });

export const insertAiConversationSchema = createInsertSchema(aiConversations).omit({ id: true });
export const insertAiMessageSchema = createInsertSchema(aiMessages).omit({ id: true });

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
      teamMembers: -1,
      aiRequestsPerMonth: -1,
      campaigns: -1,
    },
    features: [
      "advanced_crm", "advanced_inventory", "advanced_notes",
      "ai_due_diligence", "ai_marketing", "ai_buyer_communication", "ai_custom_agents",
      "email_campaigns", "sms_campaigns", "direct_mail", "marketplace_syndication",
      "payment_processing", "advanced_reporting", "api_access", "webhooks",
      "priority_support", "custom_branding"
    ],
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;
