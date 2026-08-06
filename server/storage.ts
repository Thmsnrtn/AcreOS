import { db, withTransaction } from "./db";
import { forOrg, unscopedForPlatformOps } from "./utils/orgScopedDb";
import { addMonths } from "./utils/dateUtils";
export { db };
import { eq, and, desc, asc, sql, count, sum, arrayContains, gte, lte, lt, or, inArray, ne, ilike, type SQL } from "drizzle-orm";
import {
  assertNotUnderLegalHold,
  filterOutHeldIds,
} from "./services/legalHold";

export interface PaginationOptions {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
import {
  organizations, teamMembers, orgCoOwners, leads, leadActivities, properties, deals,
  notes, payments, campaigns, campaignOptimizations, campaignResponses, agentConfigs, agentTasks, conversations,
  messages, activityLog, usageEvents,
  dueDiligenceDossiers,
  activityEvents,
  tasks,
  type Organization, type InsertOrganization,
  type TeamMember, type InsertTeamMember,
  type OrgCoOwner, type InsertOrgCoOwner,
  type Lead, type InsertLead,
  type LeadActivity, type InsertLeadActivity,
  type Property, type InsertProperty,
  type Deal, type InsertDeal,
  type Note, type InsertNote,
  type Payment, type InsertPayment,
  type PaymentReminder, type InsertPaymentReminder,
  type Campaign, type InsertCampaign,
  type CampaignOptimization, type InsertCampaignOptimization,
  type CampaignResponse, type InsertCampaignResponse,
  type AgentConfig, type InsertAgentConfig,
  type AgentTask, type InsertAgentTask,
  type Conversation, type InsertConversation,
  type Message, type InsertMessage,
  type AiAgentProfile, type InsertAiAgentProfile,
  type AiToolDefinition, type InsertAiToolDefinition,
  type AiExecutionRun, type InsertAiExecutionRun,
  type AiMemory, type InsertAiMemory,
  type VaAgent, type InsertVaAgent,
  type VaAction, type InsertVaAction,
  type VaBriefing, type InsertVaBriefing,
  type VaCalendarEvent, type InsertVaCalendarEvent,
  type VaTemplate, type InsertVaTemplate,
  type DueDiligenceTemplate, type InsertDueDiligenceTemplate,
  type DueDiligenceItem, type InsertDueDiligenceItem,
  type ChecklistTemplate, type InsertChecklistTemplate,
  type DealChecklist, type InsertDealChecklist,
  type DealChecklistItem,
  type UsageRecord,
  type CreditTransaction,
  type InsertSupportCase, type SupportCase,
  type InsertSupportMessage, type SupportMessage,
  type InsertSupportAction, type SupportAction,
  type SupportPlaybook,
  type DunningEvent, type InsertDunningEvent,
  type SystemAlert, type InsertSystemAlert,
  type ActivityEvent, type InsertActivityEvent,
  type CampaignSequence, type InsertCampaignSequence,
  type SequenceStep, type InsertSequenceStep,
  type SequenceEnrollment, type InsertSequenceEnrollment,
  type AbTest, type InsertAbTest,
  type AbTestVariant, type InsertAbTestVariant,
  type CustomFieldDefinition, type InsertCustomFieldDefinition,
  type CustomFieldValue, type InsertCustomFieldValue,
  type SavedView, type InsertSavedView,
  type NotificationPreference, type InsertNotificationPreference,
  type Task, type InsertTask,
  type AuditLogEntry, type InsertAuditLog,
  type TargetCounty, type InsertTargetCounty,
  type OfferLetter, type InsertOfferLetter,
  type OfferTemplate, type InsertOfferTemplate,
  type DueDiligenceChecklist, type InsertDueDiligenceChecklist,
  type SkipTrace, type InsertSkipTrace,
  type PropertyListing, type InsertPropertyListing,
  type WorkspacePreset, type InsertWorkspacePreset,
  type ParcelSnapshot, type InsertParcelSnapshot,
  type DocumentTemplate, type InsertDocumentTemplate,
  type GeneratedDocument, type InsertGeneratedDocument,
  type Signature, type InsertSignature,
  type DocumentVersion, type InsertDocumentVersion,
  type DocumentPackage, type InsertDocumentPackage,
  type Notification, type InsertNotification,
  type ActivityLogEntry,
  type JobCursor,
  type JobLock, type InsertJobLock,
  type EmailSenderIdentity, type InsertEmailSenderIdentity,
  type InboxMessage, type InsertInboxMessage,
  type MailSenderIdentity, type InsertMailSenderIdentity,
  type MailingOrder, type InsertMailingOrder,
  type MailingOrderPiece, type InsertMailingOrderPiece,
  type FeatureRequest, type InsertFeatureRequest,
  type ApiUsageLog, type InsertApiUsageLog,
  type AgentRun,
  type BorrowerSession, type InsertBorrowerSession,
  type BorrowerMessage, type InsertBorrowerMessage,
  type DataSource, type InsertDataSource,
  type DataSourceCache, type InsertDataSourceCache,
  subscriptionEvents,
  type SubscriptionEvent, type InsertSubscriptionEvent,
  type DiscoveredEndpoint, type InsertDiscoveredEndpoint,
  type AgentMemory, type InsertAgentMemory,
  type AgentFeedback, type InsertAgentFeedback,
  type Workflow, type InsertWorkflow,
  type WorkflowRun, type InsertWorkflowRun,
  type ScheduledTask, type InsertScheduledTask,
  type MarketingList, type InsertMarketingList,
  type OfferBatch, type InsertOfferBatch,
  type Offer, type InsertOffer,
  type SellerCommunication, type InsertSellerCommunication,
  type AdPosting, type InsertAdPosting,
  type BuyerPrequalification, type InsertBuyerPrequalification,
  type CollectionSequence, type InsertCollectionSequence,
  type CollectionEnrollment, type InsertCollectionEnrollment,
  type CountyResearch, type InsertCountyResearch,
  type BuyerReservation, type InsertBuyerReservation,
  type EscrowChecklist, type InsertEscrowChecklist,
  type ClosingPacket, type InsertClosingPacket,
  type AutopayEnrollment, type InsertAutopayEnrollment,
  type PayoffQuote, type InsertPayoffQuote,
  type TrustLedgerEntry, type InsertTrustLedger,
  type DelinquencyEscalation, type InsertDelinquencyEscalation,
  type PlaybookInstance, type InsertPlaybookInstance,
  type DdAssignment, type InsertDdAssignment,
  type SwotReport, type InsertSwotReport,
  type GoNogoMemo, type InsertGoNogoMemo,
  type PlatformFeatureFlag, type InsertPlatformFeatureFlag,
  type PricingConfig, type InsertPricingConfig,
  type FounderAdAccount, type InsertFounderAdAccount,
  type GrowthCampaign, type InsertGrowthCampaign,
  type AdCreativeBundle,
  type FieldScoutVisit, type InsertFieldScoutVisit,
  type FieldScoutPhoto, type InsertFieldScoutPhoto,
} from "@shared/schema";

// Amortization helpers now live in server/storage/noteRepo.ts (co-located
// with note creation, the only caller). Re-exported here so the public
// `calculateMonthlyPayment` import surface stays unchanged.
export { calculateMonthlyPayment } from "./storage/noteRepo";

export interface IStorage {
  // Organizations
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  getOrganizationByOwner(ownerId: string): Promise<Organization | undefined>;
  getOrganizationByStripeCustomerId(customerId: string): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, updates: Partial<InsertOrganization>): Promise<Organization>;
  updateOrganizationAISettings(orgId: number, aiSettings: {
    responseStyle?: "concise" | "detailed" | "balanced";
    defaultAgent?: string;
    autoSuggestions?: boolean;
    rememberContext?: boolean;
  }): Promise<void>;
  consumeTrialToken(orgId: number): Promise<{ success: boolean; remaining: number }>;
  getTrialTokens(orgId: number): Promise<number>;
  
  // Team Members
  getTeamMembers(orgId: number): Promise<TeamMember[]>;
  getTeamMember(orgId: number, userId: string): Promise<TeamMember | undefined>;
  getTeamMemberByEmail(orgId: number, email: string): Promise<TeamMember | undefined>;
  createTeamMember(member: InsertTeamMember): Promise<TeamMember>;
  updateTeamMember(id: number, updates: Partial<InsertTeamMember>): Promise<TeamMember>;

  // Org Co-Owners (Blanco §1)
  listOrgCoOwners(orgId: number): Promise<OrgCoOwner[]>;
  addOrgCoOwner(input: InsertOrgCoOwner): Promise<OrgCoOwner | undefined>;
  removeOrgCoOwner(orgId: number, userId: string): Promise<void>;

  // Leads
  getLeads(orgId: number, filters?: { assignedTo?: number | null }): Promise<Lead[]>;
  getLead(orgId: number, id: number): Promise<Lead | undefined>;
  createLead(lead: InsertLead & { organizationId: number }): Promise<Lead>;
  createLeadsBatch(leadsData: (InsertLead & { organizationId: number })[]): Promise<Lead[]>;
  updateLead(id: number, updates: Partial<InsertLead>, organizationId?: number): Promise<Lead>;
  deleteLead(id: number, organizationId?: number): Promise<void>;
  getLeadCount(orgId: number): Promise<number>;
  bulkDeleteLeads(orgId: number, ids: number[], userId?: string): Promise<number>;
  bulkUpdateLeads(orgId: number, ids: number[], updates: Partial<InsertLead>): Promise<number>;
  
  // Lead Soft-Delete & Recovery
  getDeletedLeads(orgId: number): Promise<Lead[]>;
  restoreLeads(orgId: number, ids: number[]): Promise<number>;
  permanentlyDeleteLeads(orgId: number, ids: number[]): Promise<number>;
  getLeadsByIds(orgId: number, ids: number[]): Promise<Lead[]>;
  
  // Lead Duplicate Detection
  findDuplicateLeads(orgId: number, criteria: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
  }): Promise<Lead[]>;
  mergeLeads(orgId: number, primaryId: number, duplicateId: number): Promise<Lead>;

  // Lead Scoring & Nurturing
  getLeadsNeedingScoring(orgId: number, limit?: number): Promise<Lead[]>;
  getLeadsDueForFollowUp(orgId: number): Promise<Lead[]>;
  createLeadActivity(activity: InsertLeadActivity): Promise<LeadActivity>;
  getLeadActivities(leadId: number, limit?: number): Promise<LeadActivity[]>;
  updateLeadScore(leadId: number, score: number, scoreFactors: Lead["scoreFactors"]): Promise<Lead>;
  
  // Paginated Leads (W5.3 SQL-scored stage/cursor variants live on LeadRepo)
  getLeadsPaginated(orgId: number, options: PaginationOptions, filters?: { assignedTo?: number | null; q?: string }): Promise<PaginatedResult<Lead>>;

  // Properties
  getProperties(orgId: number): Promise<Property[]>;
  getProperty(orgId: number, id: number): Promise<Property | undefined>;
  createProperty(property: InsertProperty & { organizationId: number }): Promise<Property>;
  updateProperty(id: number, updates: Partial<InsertProperty>, organizationId?: number): Promise<Property>;
  deleteProperty(id: number, organizationId?: number): Promise<void>;
  getPropertyCount(orgId: number): Promise<number>;
  bulkDeleteProperties(orgId: number, ids: number[]): Promise<number>;
  bulkUpdateProperties(orgId: number, ids: number[], updates: Partial<InsertProperty>): Promise<number>;
  
  // Paginated Properties
  getPropertiesPaginated(orgId: number, options: PaginationOptions): Promise<PaginatedResult<Property>>;

  // Deals
  getDeals(orgId: number): Promise<Deal[]>;
  getDeal(orgId: number, id: number): Promise<Deal | undefined>;
  getDealsByIds(orgId: number, ids: number[]): Promise<Deal[]>;
  createDeal(deal: InsertDeal & { organizationId: number }): Promise<Deal>;
  updateDeal(id: number, updates: Partial<InsertDeal>, expectedUpdatedAt?: Date): Promise<Deal>;
  bulkDeleteDeals(orgId: number, ids: number[]): Promise<number>;
  bulkUpdateDeals(orgId: number, ids: number[], updates: Partial<InsertDeal>): Promise<number>;
  
  // Paginated Deals
  getDealsPaginated(orgId: number, options: PaginationOptions): Promise<PaginatedResult<Deal>>;

  // Notes (Financing)
  getNotes(orgId: number): Promise<Note[]>;
  getNote(orgId: number, id: number): Promise<Note | undefined>;
  getNoteByAccessToken(accessToken: string): Promise<Note | undefined>;
  createNote(note: InsertNote): Promise<Note>;
  updateNote(id: number, updates: Partial<InsertNote>, organizationId?: number): Promise<Note>;
  deleteNote(id: number, organizationId?: number): Promise<void>;
  getNoteCount(orgId: number): Promise<number>;
  getActiveNotesValue(orgId: number): Promise<number>;
  
  // Payments
  getPayments(orgId: number, noteId?: number): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: number, updates: Partial<InsertPayment>): Promise<Payment>;
  
  // Campaigns
  getCampaigns(orgId: number): Promise<Campaign[]>;
  getCampaign(orgId: number, id: number): Promise<Campaign | undefined>;
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  updateCampaign(id: number, updates: Partial<InsertCampaign>): Promise<Campaign>;
  
  // Campaign Optimizations
  getCampaignOptimizations(campaignId: number): Promise<CampaignOptimization[]>;
  createCampaignOptimization(optimization: InsertCampaignOptimization): Promise<CampaignOptimization>;
  markOptimizationImplemented(optimizationId: number, resultDelta: CampaignOptimization["resultDelta"]): Promise<CampaignOptimization>;
  getCampaignsNeedingOptimization(orgId: number): Promise<Campaign[]>;
  
  // Agent Configs
  getAgentConfigs(orgId: number): Promise<AgentConfig[]>;
  getAgentConfig(orgId: number, id: number): Promise<AgentConfig | undefined>;
  createAgentConfig(config: InsertAgentConfig): Promise<AgentConfig>;
  updateAgentConfig(id: number, updates: Partial<InsertAgentConfig>): Promise<AgentConfig>;
  
  // Agent Tasks
  getAgentTasks(orgId: number): Promise<AgentTask[]>;
  getAgentTask(orgId: number, id: number): Promise<AgentTask | undefined>;
  createAgentTask(task: InsertAgentTask): Promise<AgentTask>;
  updateAgentTask(id: number, updates: Partial<InsertAgentTask>): Promise<AgentTask>;
  
  // Conversations & Messages
  getConversations(orgId: number, filters?: { leadId?: number; channel?: string }): Promise<Conversation[]>;
  getConversation(orgId: number, id: number): Promise<Conversation | undefined>;
  createConversation(conv: InsertConversation): Promise<Conversation>;
  getMessages(conversationId: number): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  
  // Dashboard Stats
  getDashboardStats(orgId: number): Promise<{
    totalLeads: number;
    activeProperties: number;
    activeNotes: number;
    monthlyRevenue: number;
    recentActivity: any[];
  }>;
  
  // Activity Log
  logActivity(entry: {
    organizationId: number;
    userId?: string;
    teamMemberId?: number;
    agentType?: string;
    action: string;
    entityType: string;
    entityId: number;
    description?: string;
    changes?: any;
    metadata?: any;
  }): Promise<void>;
  
  // Usage tracking
  trackUsage(orgId: number, eventType: string, quantity?: number, metadata?: any): Promise<void>;
  
  // AI Agent Profiles
  getAiAgentProfiles(): Promise<AiAgentProfile[]>;
  getAiAgentProfile(role: string): Promise<AiAgentProfile | undefined>;

  // AI Tool Definitions  
  getAiToolDefinitions(): Promise<AiToolDefinition[]>;
  getAiToolsByRole(role: string): Promise<AiToolDefinition[]>;

  // AI Execution Runs
  getAiExecutionRuns(orgId: number): Promise<AiExecutionRun[]>;
  createAiExecutionRun(run: InsertAiExecutionRun): Promise<AiExecutionRun>;
  updateAiExecutionRun(id: number, updates: Partial<AiExecutionRun>): Promise<AiExecutionRun>;

  // AI Memory
  getAiMemory(orgId: number): Promise<AiMemory[]>;
  createAiMemory(memory: InsertAiMemory): Promise<AiMemory>;
  deleteAiMemory(id: number, organizationId?: number): Promise<void>;

  // AI Conversations (Command Center)
  getAiConversations(orgId: number): Promise<any[]>;
  getAiConversation(organizationId: number, id: number): Promise<any | undefined>;
  createAiConversation(conv: any): Promise<any>;
  updateAiConversation(id: number, updates: any, organizationId?: number): Promise<any>;
  deleteAiConversation(id: number, organizationId?: number): Promise<void>;
  getAiMessages(conversationId: number): Promise<any[]>;
  createAiMessage(message: any): Promise<any>;

  // VA (Virtual Assistants)
  getVaAgents(orgId: number): Promise<VaAgent[]>;
  getVaAgent(orgId: number, id: number): Promise<VaAgent | undefined>;
  getVaAgentByType(orgId: number, agentType: string): Promise<VaAgent | undefined>;
  createVaAgent(agent: InsertVaAgent): Promise<VaAgent>;
  updateVaAgent(id: number, updates: Partial<InsertVaAgent>): Promise<VaAgent>;
  initializeVaAgents(orgId: number): Promise<VaAgent[]>;

  // VA Actions
  getVaActions(orgId: number, options?: { agentId?: number; status?: string; limit?: number }): Promise<VaAction[]>;
  getVaAction(id: number): Promise<VaAction | undefined>;
  createVaAction(action: InsertVaAction): Promise<VaAction>;
  updateVaAction(id: number, updates: Partial<VaAction>): Promise<VaAction>;
  approveVaAction(id: number, userId: string): Promise<VaAction>;
  rejectVaAction(id: number, reason: string): Promise<VaAction>;
  getPendingActionsCount(orgId: number): Promise<number>;

  // VA Briefings
  getVaBriefings(orgId: number, limit?: number): Promise<VaBriefing[]>;
  getLatestBriefing(orgId: number): Promise<VaBriefing | undefined>;
  createVaBriefing(briefing: InsertVaBriefing): Promise<VaBriefing>;
  markBriefingRead(id: number): Promise<VaBriefing>;

  // VA Calendar Events
  getVaCalendarEvents(orgId: number, startDate?: Date, endDate?: Date): Promise<VaCalendarEvent[]>;
  createVaCalendarEvent(event: InsertVaCalendarEvent): Promise<VaCalendarEvent>;
  updateVaCalendarEvent(id: number, updates: Partial<InsertVaCalendarEvent>): Promise<VaCalendarEvent>;
  deleteVaCalendarEvent(id: number): Promise<void>;

  // VA Templates
  getVaTemplates(orgId: number, category?: string): Promise<VaTemplate[]>;
  createVaTemplate(template: InsertVaTemplate): Promise<VaTemplate>;
  updateVaTemplate(id: number, updates: Partial<InsertVaTemplate>): Promise<VaTemplate>;
  deleteVaTemplate(id: number): Promise<void>;

  // VA Replacement Engine Tables
  // Marketing Lists
  getMarketingLists(orgId: number): Promise<MarketingList[]>;
  getMarketingListById(orgId: number, id: number): Promise<MarketingList | undefined>;
  createMarketingList(data: InsertMarketingList): Promise<MarketingList>;
  updateMarketingList(orgId: number, id: number, updates: Partial<InsertMarketingList>): Promise<MarketingList>;
  deleteMarketingList(orgId: number, id: number): Promise<void>;

  // Offer Batches
  getOfferBatches(orgId: number): Promise<OfferBatch[]>;
  getOfferBatchById(orgId: number, id: number): Promise<OfferBatch | undefined>;
  createOfferBatch(data: InsertOfferBatch): Promise<OfferBatch>;
  updateOfferBatch(orgId: number, id: number, updates: Partial<InsertOfferBatch>): Promise<OfferBatch>;
  deleteOfferBatch(orgId: number, id: number): Promise<void>;

  // Offers
  getOffers(orgId: number): Promise<Offer[]>;
  getOfferById(orgId: number, id: number): Promise<Offer | undefined>;
  getOffersByBatch(orgId: number, batchId: number): Promise<Offer[]>;
  createOffer(data: InsertOffer): Promise<Offer>;
  updateOffer(orgId: number, id: number, updates: Partial<InsertOffer>): Promise<Offer>;
  deleteOffer(orgId: number, id: number): Promise<void>;

  // Seller Communications
  getSellerCommunications(orgId: number): Promise<SellerCommunication[]>;
  getSellerCommunicationById(orgId: number, id: number): Promise<SellerCommunication | undefined>;
  getSellerCommunicationsByLead(leadId: number): Promise<SellerCommunication[]>;
  createSellerCommunication(data: InsertSellerCommunication): Promise<SellerCommunication>;
  updateSellerCommunication(id: number, updates: Partial<InsertSellerCommunication>): Promise<SellerCommunication>;

  // Ad Postings
  getAdPostings(orgId: number): Promise<AdPosting[]>;
  getAdPostingById(orgId: number, id: number): Promise<AdPosting | undefined>;
  getAdPostingsByProperty(propertyId: number): Promise<AdPosting[]>;
  createAdPosting(data: InsertAdPosting): Promise<AdPosting>;
  updateAdPosting(orgId: number, id: number, updates: Partial<InsertAdPosting>): Promise<AdPosting>;
  deleteAdPosting(orgId: number, id: number): Promise<void>;

  // Buyer Prequalifications
  getBuyerPrequalifications(orgId: number): Promise<BuyerPrequalification[]>;
  getBuyerPrequalificationById(orgId: number, id: number): Promise<BuyerPrequalification | undefined>;
  getBuyerPrequalificationByLead(leadId: number): Promise<BuyerPrequalification | undefined>;
  createBuyerPrequalification(data: InsertBuyerPrequalification): Promise<BuyerPrequalification>;
  updateBuyerPrequalification(orgId: number, id: number, updates: Partial<InsertBuyerPrequalification>): Promise<BuyerPrequalification>;
  deleteBuyerPrequalification(orgId: number, id: number): Promise<void>;

  // Collection Sequences
  getCollectionSequences(orgId: number): Promise<CollectionSequence[]>;
  getCollectionSequenceById(orgId: number, id: number): Promise<CollectionSequence | undefined>;
  getActiveCollectionSequence(orgId: number): Promise<CollectionSequence | undefined>;
  createCollectionSequence(data: InsertCollectionSequence): Promise<CollectionSequence>;
  updateCollectionSequence(orgId: number, id: number, updates: Partial<InsertCollectionSequence>): Promise<CollectionSequence>;
  deleteCollectionSequence(orgId: number, id: number): Promise<void>;

  // Collection Enrollments
  getCollectionEnrollments(orgId: number): Promise<CollectionEnrollment[]>;
  getCollectionEnrollmentById(orgId: number, id: number): Promise<CollectionEnrollment | undefined>;
  getCollectionEnrollmentsByNote(noteId: number): Promise<CollectionEnrollment[]>;
  getCollectionEnrollmentsBySequence(sequenceId: number): Promise<CollectionEnrollment[]>;
  createCollectionEnrollment(data: InsertCollectionEnrollment): Promise<CollectionEnrollment>;
  updateCollectionEnrollment(orgId: number, id: number, updates: Partial<InsertCollectionEnrollment>): Promise<CollectionEnrollment>;

  // County Research
  getCountyResearchList(): Promise<CountyResearch[]>;
  getCountyResearchById(id: number): Promise<CountyResearch | undefined>;
  getCountyResearch(state: string, county: string): Promise<CountyResearch | undefined>;
  createCountyResearch(data: InsertCountyResearch): Promise<CountyResearch>;
  updateCountyResearch(id: number, updates: Partial<InsertCountyResearch>): Promise<CountyResearch>;

  // Due Diligence Templates
  getDueDiligenceTemplates(orgId: number): Promise<DueDiligenceTemplate[]>;
  getDueDiligenceTemplate(organizationId: number, id: number): Promise<DueDiligenceTemplate | undefined>;
  createDueDiligenceTemplate(template: InsertDueDiligenceTemplate): Promise<DueDiligenceTemplate>;
  updateDueDiligenceTemplate(id: number, updates: Partial<InsertDueDiligenceTemplate>): Promise<DueDiligenceTemplate>;
  deleteDueDiligenceTemplate(id: number): Promise<void>;
  initializeDefaultTemplates(orgId: number): Promise<DueDiligenceTemplate[]>;

  // Due Diligence Items (property checklist)
  getPropertyDueDiligence(propertyId: number): Promise<DueDiligenceItem[]>;
  createDueDiligenceItem(item: InsertDueDiligenceItem): Promise<DueDiligenceItem>;
  updateDueDiligenceItem(id: number, updates: Partial<InsertDueDiligenceItem>): Promise<DueDiligenceItem>;
  deleteDueDiligenceItem(id: number): Promise<void>;
  applyTemplateToProperty(organizationId: number, propertyId: number, templateId: number): Promise<DueDiligenceItem[]>;

  // Deal Checklist Templates
  getChecklistTemplates(orgId: number): Promise<ChecklistTemplate[]>;
  getChecklistTemplate(organizationId: number, id: number): Promise<ChecklistTemplate | undefined>;
  createChecklistTemplate(template: InsertChecklistTemplate): Promise<ChecklistTemplate>;
  updateChecklistTemplate(id: number, updates: Partial<InsertChecklistTemplate>): Promise<ChecklistTemplate>;
  deleteChecklistTemplate(id: number): Promise<void>;
  initializeDefaultChecklistTemplates(orgId: number): Promise<ChecklistTemplate[]>;

  // Deal Checklists
  getDealChecklist(dealId: number): Promise<DealChecklist | undefined>;
  createDealChecklist(checklist: InsertDealChecklist): Promise<DealChecklist>;
  updateDealChecklist(id: number, updates: Partial<InsertDealChecklist>): Promise<DealChecklist>;
  applyChecklistTemplateToDeal(organizationId: number, dealId: number, templateId: number): Promise<DealChecklist>;
  updateDealChecklistItem(dealId: number, itemId: string, updates: { checked?: boolean; documentUrl?: string; checkedBy?: string }): Promise<DealChecklist>;
  checkStageGate(dealId: number): Promise<{ canAdvance: boolean; incompleteItems: DealChecklistItem[] }>;

  // Usage Records
  getUsageRecords(orgId: number, limit?: number): Promise<UsageRecord[]>;
  getUsageSummaryByMonth(orgId: number, month: string): Promise<{ actionType: string; count: number; totalCost: number }[]>;

  // Credit Transactions
  getCreditTransactions(orgId: number, limit?: number): Promise<CreditTransaction[]>;
  getCreditBalance(orgId: number): Promise<number>;

  // Support Cases
  createSupportCase(input: InsertSupportCase): Promise<SupportCase>;
  getSupportCase(organizationId: number, id: number): Promise<SupportCase | undefined>;
  getSupportCaseForPlatformOps(id: number): Promise<SupportCase | undefined>;
  getSupportCases(organizationId: number, status?: string): Promise<SupportCase[]>;
  updateSupportCase(id: number, data: Partial<InsertSupportCase>): Promise<SupportCase | undefined>;
  getEscalatedCases(): Promise<SupportCase[]>;

  // Support Messages
  createSupportMessage(input: InsertSupportMessage): Promise<SupportMessage>;
  getSupportMessages(caseId: number): Promise<SupportMessage[]>;

  // Support Actions
  createSupportAction(input: InsertSupportAction): Promise<SupportAction>;
  getSupportActions(caseId: number): Promise<SupportAction[]>;

  // Support Playbooks
  getSupportPlaybooks(category?: string): Promise<SupportPlaybook[]>;
  getSupportPlaybook(slug: string): Promise<SupportPlaybook | undefined>;
  incrementPlaybookUsage(slug: string, success: boolean): Promise<void>;

  // Dunning Events
  createDunningEvent(event: InsertDunningEvent): Promise<DunningEvent>;
  getDunningEvents(orgId: number, status?: string): Promise<DunningEvent[]>;
  getPendingDunningEvent(orgId: number, stripeInvoiceId: string): Promise<DunningEvent | undefined>;
  updateDunningEvent(id: number, updates: Partial<InsertDunningEvent>): Promise<DunningEvent>;
  resolveDunningEvents(orgId: number, stripeInvoiceId: string, resolutionType: string): Promise<void>;
  getOrganizationsInDunning(): Promise<Organization[]>;

  // System Alerts
  createSystemAlert(alert: InsertSystemAlert): Promise<SystemAlert>;
  getSystemAlerts(orgId?: number, status?: string): Promise<SystemAlert[]>;
  updateSystemAlert(id: number, updates: Partial<InsertSystemAlert>): Promise<SystemAlert>;

  // Payment Reminders (Finance Agent)
  getDelinquentNotes(orgId: number): Promise<Note[]>;
  getPendingReminders(limit?: number): Promise<PaymentReminder[]>;
  getRemindersForNote(noteId: number): Promise<PaymentReminder[]>;
  createPaymentReminder(reminder: InsertPaymentReminder): Promise<PaymentReminder>;
  updatePaymentReminder(id: number, updates: Partial<InsertPaymentReminder>): Promise<PaymentReminder>;
  markReminderSent(id: number): Promise<PaymentReminder>;
  getNotesNeedingReminders(orgId: number): Promise<Note[]>;
  getNotesWithUpcomingPayments(orgId: number, daysAhead: number): Promise<Note[]>;
  getFinancePortfolioHealth(orgId: number): Promise<{
    totalActiveNotes: number;
    totalBalance: number;
    currentNotes: number;
    earlyDelinquent: number;
    delinquent: number;
    seriouslyDelinquent: number;
    defaultCandidates: number;
    remindersSentThisMonth: number;
    collectionsThisMonth: number;
  }>;

  // Campaign Sequences
  getSequences(orgId: number): Promise<CampaignSequence[]>;
  getSequence(orgId: number, id: number): Promise<CampaignSequence | undefined>;
  createSequence(sequence: InsertCampaignSequence): Promise<CampaignSequence>;
  updateSequence(id: number, updates: Partial<InsertCampaignSequence>): Promise<CampaignSequence>;
  deleteSequence(id: number): Promise<void>;

  // Sequence Steps
  getSequenceSteps(sequenceId: number): Promise<SequenceStep[]>;
  createSequenceStep(step: InsertSequenceStep): Promise<SequenceStep>;
  updateSequenceStep(id: number, updates: Partial<InsertSequenceStep>, sequenceId?: number): Promise<SequenceStep>;
  deleteSequenceStep(id: number, sequenceId?: number): Promise<void>;
  reorderSequenceSteps(sequenceId: number, stepIds: number[]): Promise<void>;

  // Sequence Enrollments
  getSequenceEnrollment(id: number): Promise<SequenceEnrollment | undefined>;
  getSequenceEnrollments(sequenceId: number): Promise<SequenceEnrollment[]>;
  getLeadEnrollments(leadId: number): Promise<SequenceEnrollment[]>;
  getActiveEnrollments(orgId: number): Promise<(SequenceEnrollment & { sequence: CampaignSequence; lead: Lead })[]>;
  getEnrollmentsDueForProcessing(): Promise<(SequenceEnrollment & { sequence: CampaignSequence; lead: Lead })[]>;
  createSequenceEnrollment(enrollment: InsertSequenceEnrollment): Promise<SequenceEnrollment>;
  updateSequenceEnrollment(id: number, updates: Partial<InsertSequenceEnrollment>): Promise<SequenceEnrollment>;
  pauseEnrollment(id: number, reason: string): Promise<SequenceEnrollment>;
  resumeEnrollment(id: number): Promise<SequenceEnrollment>;
  cancelEnrollment(id: number): Promise<SequenceEnrollment>;
  completeEnrollment(id: number): Promise<SequenceEnrollment>;
  getSequenceStats(orgId: number): Promise<{ sequenceId: number; name: string; totalEnrollments: number; activeEnrollments: number; completedEnrollments: number }[]>;

  // A/B Tests
  getAbTests(orgId: number): Promise<AbTest[]>;
  getAbTest(orgId: number, id: number): Promise<AbTest | undefined>;
  getAbTestByCampaign(campaignId: number): Promise<AbTest | undefined>;
  createAbTest(test: InsertAbTest): Promise<AbTest>;
  updateAbTest(id: number, updates: Partial<InsertAbTest>): Promise<AbTest>;
  deleteAbTest(id: number): Promise<void>;

  // A/B Test Variants
  getAbTestVariants(testId: number): Promise<AbTestVariant[]>;
  createAbTestVariant(variant: InsertAbTestVariant): Promise<AbTestVariant>;
  updateAbTestVariant(id: number, updates: Partial<InsertAbTestVariant>): Promise<AbTestVariant>;
  deleteAbTestVariant(id: number): Promise<void>;
  getAbTestWithVariants(orgId: number, testId: number): Promise<{ test: AbTest; variants: AbTestVariant[] } | undefined>;

  // Custom Field Definitions
  getCustomFieldDefinitions(orgId: number, entityType?: string): Promise<CustomFieldDefinition[]>;
  getCustomFieldDefinition(orgId: number, id: number): Promise<CustomFieldDefinition | undefined>;
  createCustomFieldDefinition(definition: InsertCustomFieldDefinition): Promise<CustomFieldDefinition>;
  updateCustomFieldDefinition(id: number, updates: Partial<InsertCustomFieldDefinition>): Promise<CustomFieldDefinition>;
  deleteCustomFieldDefinition(id: number): Promise<void>;

  // Custom Field Values
  getCustomFieldValues(entityType: string, entityId: number): Promise<(CustomFieldValue & { definition: CustomFieldDefinition })[]>;
  setCustomFieldValue(definitionId: number, entityId: number, value: string | null): Promise<CustomFieldValue>;
  deleteCustomFieldValuesForEntity(entityType: string, entityId: number): Promise<void>;

  // Saved Views
  getSavedViews(orgId: number, entityType?: string): Promise<SavedView[]>;
  getSavedView(orgId: number, id: number): Promise<SavedView | undefined>;
  createSavedView(view: InsertSavedView): Promise<SavedView>;
  updateSavedView(id: number, updates: Partial<InsertSavedView>): Promise<SavedView>;
  deleteSavedView(id: number): Promise<void>;
  setDefaultView(orgId: number, entityType: string, viewId: number): Promise<SavedView>;

  // Workspace Presets
  getWorkspacePresets(orgId: number, userId?: string): Promise<WorkspacePreset[]>;
  getWorkspacePreset(orgId: number, id: number): Promise<WorkspacePreset | undefined>;
  createWorkspacePreset(preset: InsertWorkspacePreset): Promise<WorkspacePreset>;
  updateWorkspacePreset(id: number, updates: Partial<InsertWorkspacePreset>): Promise<WorkspacePreset>;
  deleteWorkspacePreset(id: number): Promise<void>;

  // Playbook Instances
  getPlaybookInstances(organizationId: number): Promise<PlaybookInstance[]>;
  getPlaybookInstanceById(organizationId: number, id: number): Promise<PlaybookInstance | undefined>;
  getPlaybookInstanceByTemplate(organizationId: number, templateId: string): Promise<PlaybookInstance | undefined>;
  getActivePlaybookInstances(organizationId: number): Promise<PlaybookInstance[]>;
  createPlaybookInstance(data: InsertPlaybookInstance): Promise<PlaybookInstance>;
  updatePlaybookInstance(organizationId: number, id: number, data: Partial<InsertPlaybookInstance>): Promise<PlaybookInstance | undefined>;
  deletePlaybookInstance(organizationId: number, id: number): Promise<boolean>;

  // Notification Preferences
  getNotificationPreferences(userId: string, orgId: number): Promise<NotificationPreference[]>;
  upsertNotificationPreference(pref: InsertNotificationPreference): Promise<NotificationPreference>;
  updateNotificationPreference(id: number, updates: Partial<InsertNotificationPreference>): Promise<NotificationPreference>;

  // Tasks (17.1, 17.2)
  getTasks(orgId: number, filters?: { status?: string; priority?: string; assignedTo?: number; entityType?: string; entityId?: number }): Promise<Task[]>;
  getTask(orgId: number, id: number): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, updates: Partial<InsertTask>): Promise<Task>;
  deleteTask(id: number): Promise<void>;
  completeTask(id: number): Promise<Task>;
  getRecurringTasksDue(): Promise<Task[]>;
  createNextRecurringTask(parentTask: Task): Promise<Task>;

  // Audit Log (20.1)
  createAuditLogEntry(entry: InsertAuditLog): Promise<AuditLogEntry>;
  getAuditLogs(orgId: number, filters?: { 
    action?: string; 
    entityType?: string; 
    entityId?: number;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]>;
  getAuditLogCount(orgId: number, filters?: { 
    action?: string; 
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<number>;

  // Data Retention (20.3)
  purgeOldLeads(orgId: number, beforeDate: Date): Promise<number>;
  purgeOldDeals(orgId: number, beforeDate: Date, status: string): Promise<number>;
  purgeOldAuditLogs(orgId: number, beforeDate: Date): Promise<number>;
  purgeOldCommunications(orgId: number, beforeDate: Date): Promise<number>;

  // TCPA Compliance (20.2)
  getLeadsWithoutConsent(orgId: number): Promise<Lead[]>;
  getLeadsOptedOut(orgId: number): Promise<Lead[]>;
  updateLeadConsent(leadId: number, consent: { 
    tcpaConsent: boolean; 
    consentSource?: string;
    optOutReason?: string;
  }): Promise<Lead>;

  // Target Counties
  getTargetCounties(orgId: number): Promise<TargetCounty[]>;
  getTargetCounty(orgId: number, id: number): Promise<TargetCounty | undefined>;
  createTargetCounty(county: InsertTargetCounty): Promise<TargetCounty>;
  updateTargetCounty(id: number, updates: Partial<InsertTargetCounty>): Promise<TargetCounty>;
  deleteTargetCounty(id: number): Promise<void>;

  // Offer Letters
  getOfferLetters(orgId: number, filters?: { status?: string; batchId?: string }): Promise<OfferLetter[]>;
  getOfferLetter(orgId: number, id: number): Promise<OfferLetter | undefined>;
  createOfferLetter(letter: InsertOfferLetter): Promise<OfferLetter>;
  createOfferLettersBatch(letters: InsertOfferLetter[]): Promise<OfferLetter[]>;
  updateOfferLetter(id: number, updates: Partial<InsertOfferLetter>): Promise<OfferLetter>;
  deleteOfferLetter(id: number): Promise<void>;

  // Offer Templates
  getOfferTemplates(orgId: number): Promise<OfferTemplate[]>;
  getOfferTemplate(orgId: number, id: number): Promise<OfferTemplate | undefined>;
  createOfferTemplate(template: InsertOfferTemplate): Promise<OfferTemplate>;
  updateOfferTemplate(id: number, updates: Partial<InsertOfferTemplate>): Promise<OfferTemplate>;
  deleteOfferTemplate(id: number): Promise<void>;

  // Due Diligence Checklists (Enhanced)
  getDueDiligenceChecklist(propertyId: number): Promise<DueDiligenceChecklist | undefined>;
  getOrCreateDueDiligenceChecklist(orgId: number, propertyId: number): Promise<DueDiligenceChecklist>;
  updateDueDiligenceChecklist(id: number, updates: Partial<InsertDueDiligenceChecklist>): Promise<DueDiligenceChecklist>;

  // Skip Traces
  getSkipTraces(orgId: number): Promise<SkipTrace[]>;
  getSkipTrace(orgId: number, id: number): Promise<SkipTrace | undefined>;
  getSkipTraceByLead(orgId: number, leadId: number): Promise<SkipTrace | undefined>;
  createSkipTrace(skipTrace: InsertSkipTrace): Promise<SkipTrace>;
  updateSkipTrace(id: number, updates: Partial<InsertSkipTrace>): Promise<SkipTrace>;

  // Property Listings
  getPropertyListings(orgId: number, filters?: { status?: string }): Promise<PropertyListing[]>;
  getPropertyListing(orgId: number, id: number): Promise<PropertyListing | undefined>;
  getPropertyListingByPropertyId(orgId: number, propertyId: number): Promise<PropertyListing | undefined>;
  createPropertyListing(listing: InsertPropertyListing): Promise<PropertyListing>;
  updatePropertyListing(id: number, updates: Partial<InsertPropertyListing>): Promise<PropertyListing>;
  deletePropertyListing(id: number): Promise<void>;

  // Document Templates
  getDocumentTemplates(orgId: number): Promise<DocumentTemplate[]>;
  getDocumentTemplate(organizationId: number, id: number): Promise<DocumentTemplate | undefined>;
  createDocumentTemplate(template: InsertDocumentTemplate): Promise<DocumentTemplate>;
  updateDocumentTemplate(organizationId: number, id: number, updates: Partial<InsertDocumentTemplate>): Promise<DocumentTemplate>;
  deleteDocumentTemplate(id: number): Promise<void>;
  seedSystemTemplates(): Promise<void>;

  // Generated Documents
  getGeneratedDocuments(orgId: number, filters?: { dealId?: number; propertyId?: number; status?: string }): Promise<GeneratedDocument[]>;
  getGeneratedDocument(orgId: number, id: number): Promise<GeneratedDocument | undefined>;
  createGeneratedDocument(doc: InsertGeneratedDocument): Promise<GeneratedDocument>;
  updateGeneratedDocument(id: number, updates: Partial<InsertGeneratedDocument>): Promise<GeneratedDocument>;

  // Native E-Signatures
  getSignatures(orgId: number, documentId?: number): Promise<Signature[]>;
  getSignature(orgId: number, id: number): Promise<Signature | undefined>;
  createSignature(signature: InsertSignature): Promise<Signature>;
  getDocumentSignatures(documentId: number): Promise<Signature[]>;

  // Document Version History
  createDocumentVersion(version: InsertDocumentVersion): Promise<DocumentVersion>;
  getDocumentVersions(orgId: number, documentId: number, documentType: string): Promise<DocumentVersion[]>;
  getDocumentVersion(organizationId: number, id: number): Promise<DocumentVersion | undefined>;
  restoreDocumentVersion(orgId: number, versionId: number): Promise<{ success: boolean; message: string }>;

  // Analytics & Reporting
  getExecutiveMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }): Promise<{
    totalRevenue: number;
    revenueChange: number;
    activeNotesValue: number;
    notesValueChange: number;
    dealsInPipeline: number;
    dealsChange: number;
    leadConversionRate: number;
    conversionChange: number;
  }>;
  getRevenueMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }): Promise<{
    revenueOverTime: { date: string; revenue: number }[];
    totalRevenue: number;
    avgDealSize: number;
    projectedRevenue: number;
  }>;
  getLeadMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }): Promise<{
    totalLeads: number;
    newLeads: number;
    convertedLeads: number;
    conversionRate: number;
    leadsBySource: { source: string; count: number }[];
    leadsByStatus: { status: string; count: number }[];
  }>;
  getDealMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }): Promise<{
    totalDeals: number;
    wonDeals: number;
    lostDeals: number;
    winRate: number;
    dealsByStage: { stage: string; count: number; value: number }[];
    avgDealValue: number;
  }>;
  getCampaignMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }): Promise<{
    campaigns: { id: number; name: string; sent: number; responses: number; responseRate: number; roi: number }[];
    totalSent: number;
    totalResponses: number;
    avgResponseRate: number;
  }>;
  getDealVelocity(orgId: number, dateRange: { startDate: Date; endDate: Date }): Promise<{
    avgDaysPerStage: { stage: string; avgDays: number }[];
    avgTotalDays: number;
    bottleneckStage: string | null;
  }>;
  getPipelineValue(orgId: number): Promise<{
    stageValues: { stage: string; value: number; count: number }[];
    totalValue: number;
  }>;
  getConversionRates(orgId: number, dateRange: { startDate: Date; endDate: Date }): Promise<{
    stageConversions: { fromStage: string; toStage: string; rate: number }[];
    overallWinRate: number;
    lossReasons: { reason: string; count: number }[];
  }>;

  // Automation Rules (8.1) — REMOVED (Wave A "Nothing lies", 2026-07-29):
  // dead parallel /automation surface; rules could never run (no engine).
  // The real automation data layer is workflows/workflow_runs below.

  // Enhanced Tasks (8.2)
  getMyTasks(orgId: number, userId: string): Promise<Task[]>;
  getTasksByEntity(orgId: number, entityType: string, entityId: number): Promise<Task[]>;

  // Notifications (8.3)
  getNotifications(orgId: number, userId: string, unreadOnly?: boolean): Promise<Notification[]>;
  getUnreadNotificationCount(orgId: number, userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationRead(id: number, organizationId?: number): Promise<Notification>;
  markAllNotificationsRead(orgId: number, userId: string): Promise<void>;

  // Activity Feed (8.3)
  getActivityFeed(orgId: number, filters?: { entityType?: string; limit?: number; offset?: number }): Promise<ActivityLogEntry[]>;

  // Job Cursors (prevent duplicate processing on restart)
  getJobCursor(jobType: string): Promise<JobCursor | undefined>;
  updateJobCursor(jobType: string, lastProcessedId: number | null, status: string): Promise<JobCursor>;
  setJobStatus(jobType: string, status: string): Promise<JobCursor>;

  // Mail Sender Identities
  getMailSenderIdentities(orgId: number): Promise<MailSenderIdentity[]>;
  getMailSenderIdentity(organizationId: number, id: number): Promise<MailSenderIdentity | undefined>;
  getDefaultMailSenderIdentity(orgId: number): Promise<MailSenderIdentity | undefined>;
  createMailSenderIdentity(data: InsertMailSenderIdentity): Promise<MailSenderIdentity>;
  updateMailSenderIdentity(id: number, data: Partial<MailSenderIdentity>): Promise<MailSenderIdentity>;
  setDefaultMailSenderIdentity(orgId: number, id: number): Promise<void>;
  deleteMailSenderIdentity(id: number): Promise<void>;

  // Mailing Orders
  getMailingOrders(orgId: number, filters?: { campaignId?: number; status?: string }): Promise<MailingOrder[]>;
  getMailingOrder(organizationId: number, id: number): Promise<MailingOrder | undefined>;
  createMailingOrder(data: InsertMailingOrder): Promise<MailingOrder>;
  updateMailingOrder(id: number, data: Partial<MailingOrder>): Promise<MailingOrder>;
  incrementMailingOrderPieces(id: number, type: 'sent' | 'failed'): Promise<void>;

  // Mailing Order Pieces
  getMailingOrderPieces(orderId: number): Promise<MailingOrderPiece[]>;
  createMailingOrderPiece(data: InsertMailingOrderPiece): Promise<MailingOrderPiece>;
  updateMailingOrderPiece(id: number, data: Partial<MailingOrderPiece>): Promise<MailingOrderPiece>;

  // Feature Requests
  getFeatureRequests(organizationId?: number): Promise<FeatureRequest[]>;
  createFeatureRequest(request: InsertFeatureRequest): Promise<FeatureRequest>;
  updateFeatureRequest(id: number, updates: Partial<FeatureRequest>): Promise<FeatureRequest>;
  getAllFeatureRequestsForFounder(): Promise<FeatureRequest[]>;

  // API Usage Logs
  logApiUsage(log: InsertApiUsageLog): Promise<void>;
  getApiUsageStats(startDate?: Date, endDate?: Date): Promise<{
    totalCostCents: number;
    byService: {
      lob: { count: number; costCents: number };
      regrid: { count: number; costCents: number };
      openai: { count: number; costCents: number };
    };
    recentUsage: Array<{ date: string; costCents: number }>;
  }>;

  // Agent Runs (background agent status tracking)
  getAgentStatuses(): Promise<AgentRun[]>;
  updateAgentStatus(agentName: string, updates: Partial<AgentRun>): Promise<AgentRun>;

  // Borrower Sessions
  createBorrowerSession(data: InsertBorrowerSession): Promise<BorrowerSession>;
  getBorrowerSession(token: string): Promise<BorrowerSession | undefined>;
  updateBorrowerSessionAccess(token: string): Promise<BorrowerSession | undefined>;
  deleteBorrowerSession(token: string): Promise<void>;
  cleanExpiredBorrowerSessions(): Promise<number>;

  // Job Locks (prevent duplicate execution in multi-instance deployment)
  acquireJobLock(jobName: string, instanceId: string, ttlSeconds: number): Promise<boolean>;
  releaseJobLock(jobName: string, instanceId: string): Promise<void>;
  cleanExpiredJobLocks(): Promise<void>;

  // County GIS Endpoints
  updateCountyGisEndpoint(id: number, updates: { isVerified?: boolean; errorCount?: number; lastVerified?: Date; isActive?: boolean; lastError?: string | null }): Promise<any>;
  getCountyGisEndpoint(id: number): Promise<any>;
  bulkCreateCountyGisEndpoints(endpoints: Array<{ state: string; county: string; baseUrl: string; endpointType: string; fipsCode?: string | null; confidenceScore?: number }>): Promise<{ added: number; skipped: number }>;

  // Data Sources (Free Data Endpoint Registry)
  getDataSources(filters?: { category?: string; isEnabled?: boolean }): Promise<DataSource[]>;
  getDataSource(id: number): Promise<DataSource | undefined>;
  getDataSourceByKey(key: string): Promise<DataSource | undefined>;
  createDataSource(data: InsertDataSource): Promise<DataSource>;
  updateDataSource(id: number, updates: Partial<InsertDataSource>): Promise<DataSource>;
  deleteDataSource(id: number): Promise<void>;
  getDataSourceStats(): Promise<{ total: number; enabled: number; verified: number; byCategory: Record<string, number> }>;
  
  // Data Source Cache
  getDataSourceCacheEntry(lookupKey: string, dataSourceId?: number): Promise<DataSourceCache | undefined>;
  createDataSourceCacheEntry(data: InsertDataSourceCache): Promise<DataSourceCache>;
  invalidateDataSourceCache(dataSourceId: number): Promise<void>;

  // Subscription Events (Analytics)
  logSubscriptionEvent(event: InsertSubscriptionEvent): Promise<SubscriptionEvent>;
  getSubscriptionEvents(options?: { orgId?: number; limit?: number }): Promise<SubscriptionEvent[]>;
  getSubscriptionStats(): Promise<{
    upgrades30d: number;
    downgrades30d: number;
    cancellations30d: number;
    reactivations30d: number;
    signups30d: number;
    totalEvents: number;
  }>;
  getAllOrganizationsWithDetails(): Promise<Array<{
    id: number;
    name: string;
    ownerId: string;
    tier: string;
    subscriptionStatus: string;
    createdAt: Date | null;
    updatedAt: Date | null;
  }>>;

  // Parcel Snapshots (Cache)
  getParcelSnapshot(apn: string, state: string, county: string, maxAgeDays?: number): Promise<ParcelSnapshot | undefined>;
  upsertParcelSnapshot(data: InsertParcelSnapshot): Promise<ParcelSnapshot>;

  // Agent Memory
  createAgentMemory(memory: InsertAgentMemory): Promise<AgentMemory>;
  getAgentMemories(orgId: number, agentType?: string, limit?: number): Promise<AgentMemory[]>;
  updateAgentMemoryUsage(id: number): Promise<AgentMemory>;
  deleteAgentMemory(id: number): Promise<void>;

  // Agent Feedback
  createAgentFeedback(feedback: InsertAgentFeedback): Promise<AgentFeedback>;
  getAgentFeedbackStats(orgId: number, agentType?: string): Promise<{
    totalFeedback: number;
    averageRating: number;
    helpfulCount: number;
    unhelpfulCount: number;
    byRating: { rating: number; count: number }[];
  }>;
  getAgentFeedbackByTask(taskId: number): Promise<AgentFeedback | undefined>;

  // Workflows
  getWorkflows(orgId: number): Promise<Workflow[]>;
  getWorkflow(orgId: number, id: number): Promise<Workflow | undefined>;
  getActiveWorkflowsByTrigger(orgId: number, event: string): Promise<Workflow[]>;
  createWorkflow(workflow: InsertWorkflow): Promise<Workflow>;
  updateWorkflow(id: number, updates: Partial<InsertWorkflow>): Promise<Workflow>;
  deleteWorkflow(id: number): Promise<void>;
  toggleWorkflow(orgId: number, id: number, isActive: boolean): Promise<Workflow>;

  // Workflow Runs
  getWorkflowRuns(workflowId: number, limit?: number): Promise<WorkflowRun[]>;
  getWorkflowRun(id: number): Promise<WorkflowRun | undefined>;
  createWorkflowRun(run: InsertWorkflowRun): Promise<WorkflowRun>;
  updateWorkflowRun(id: number, updates: Partial<InsertWorkflowRun>): Promise<WorkflowRun>;

  // ============================================
  // PHASE 4: CLOSING & SERVICING AUTOMATION
  // ============================================

  // Buyer Reservations
  getBuyerReservations(organizationId: number): Promise<BuyerReservation[]>;
  getBuyerReservationById(organizationId: number, id: number): Promise<BuyerReservation | undefined>;
  getBuyerReservationsByProperty(organizationId: number, propertyId: number): Promise<BuyerReservation[]>;
  createBuyerReservation(data: InsertBuyerReservation): Promise<BuyerReservation>;
  updateBuyerReservation(organizationId: number, id: number, data: Partial<InsertBuyerReservation>): Promise<BuyerReservation | undefined>;
  deleteBuyerReservation(organizationId: number, id: number): Promise<boolean>;

  // Escrow Checklists
  getEscrowChecklists(organizationId: number): Promise<EscrowChecklist[]>;
  getEscrowChecklistById(organizationId: number, id: number): Promise<EscrowChecklist | undefined>;
  getEscrowChecklistByDeal(organizationId: number, dealId: number): Promise<EscrowChecklist | undefined>;
  createEscrowChecklist(data: InsertEscrowChecklist): Promise<EscrowChecklist>;
  updateEscrowChecklist(organizationId: number, id: number, data: Partial<InsertEscrowChecklist>): Promise<EscrowChecklist | undefined>;
  deleteEscrowChecklist(organizationId: number, id: number): Promise<boolean>;

  // Closing Packets
  getClosingPackets(organizationId: number): Promise<ClosingPacket[]>;
  getClosingPacketById(organizationId: number, id: number): Promise<ClosingPacket | undefined>;
  getClosingPacketsByDeal(organizationId: number, dealId: number): Promise<ClosingPacket[]>;
  createClosingPacket(data: InsertClosingPacket): Promise<ClosingPacket>;
  updateClosingPacket(organizationId: number, id: number, data: Partial<InsertClosingPacket>): Promise<ClosingPacket | undefined>;
  deleteClosingPacket(organizationId: number, id: number): Promise<boolean>;

  // Autopay Enrollments
  getAutopayEnrollments(organizationId: number): Promise<AutopayEnrollment[]>;
  getAutopayEnrollmentById(organizationId: number, id: number): Promise<AutopayEnrollment | undefined>;
  getAutopayEnrollmentByNote(organizationId: number, noteId: number): Promise<AutopayEnrollment | undefined>;
  getActiveAutopayEnrollments(organizationId: number): Promise<AutopayEnrollment[]>;
  createAutopayEnrollment(data: InsertAutopayEnrollment): Promise<AutopayEnrollment>;
  updateAutopayEnrollment(organizationId: number, id: number, data: Partial<InsertAutopayEnrollment>): Promise<AutopayEnrollment | undefined>;
  deleteAutopayEnrollment(organizationId: number, id: number): Promise<boolean>;

  // Payoff Quotes
  getPayoffQuotes(organizationId: number): Promise<PayoffQuote[]>;
  getPayoffQuoteById(organizationId: number, id: number): Promise<PayoffQuote | undefined>;
  getPayoffQuotesByNote(organizationId: number, noteId: number): Promise<PayoffQuote[]>;
  createPayoffQuote(data: InsertPayoffQuote): Promise<PayoffQuote>;
  updatePayoffQuote(organizationId: number, id: number, data: Partial<InsertPayoffQuote>): Promise<PayoffQuote | undefined>;

  // Trust Ledger
  getTrustLedgerEntries(organizationId: number): Promise<TrustLedgerEntry[]>;
  getTrustLedgerByNote(organizationId: number, noteId: number): Promise<TrustLedgerEntry[]>;
  createTrustLedgerEntry(data: InsertTrustLedger): Promise<TrustLedgerEntry>;
  getTrustBalance(organizationId: number): Promise<string>;

  // Delinquency Escalations
  getDelinquencyEscalations(organizationId: number): Promise<DelinquencyEscalation[]>;
  getDelinquencyEscalationById(organizationId: number, id: number): Promise<DelinquencyEscalation | undefined>;
  getDelinquencyEscalationByNote(organizationId: number, noteId: number): Promise<DelinquencyEscalation | undefined>;
  getActiveDelinquencyEscalations(organizationId: number): Promise<DelinquencyEscalation[]>;
  createDelinquencyEscalation(data: InsertDelinquencyEscalation): Promise<DelinquencyEscalation>;
  updateDelinquencyEscalation(organizationId: number, id: number, data: Partial<InsertDelinquencyEscalation>): Promise<DelinquencyEscalation | undefined>;

  // DD Assignments
  getDDAssignments(organizationId: number): Promise<DdAssignment[]>;
  getDDAssignmentById(organizationId: number, id: number): Promise<DdAssignment | undefined>;
  getDDAssignmentsByProperty(organizationId: number, propertyId: number): Promise<DdAssignment[]>;
  getPendingDDAssignments(organizationId: number): Promise<DdAssignment[]>;
  createDDAssignment(data: InsertDdAssignment): Promise<DdAssignment>;
  updateDDAssignment(organizationId: number, id: number, data: Partial<InsertDdAssignment>): Promise<DdAssignment | undefined>;
  deleteDDAssignment(organizationId: number, id: number): Promise<boolean>;

  // SWOT Reports
  getSwotReports(organizationId: number): Promise<SwotReport[]>;
  getSwotReportById(organizationId: number, id: number): Promise<SwotReport | undefined>;
  getSwotReportByProperty(organizationId: number, propertyId: number): Promise<SwotReport | undefined>;
  createSwotReport(data: InsertSwotReport): Promise<SwotReport>;
  updateSwotReport(organizationId: number, id: number, data: Partial<InsertSwotReport>): Promise<SwotReport | undefined>;

  // Go/No-Go Memos
  getGoNogoMemos(organizationId: number): Promise<GoNogoMemo[]>;
  getGoNogoMemoById(organizationId: number, id: number): Promise<GoNogoMemo | undefined>;
  getGoNogoMemoByProperty(organizationId: number, propertyId: number): Promise<GoNogoMemo | undefined>;
  createGoNogoMemo(data: InsertGoNogoMemo): Promise<GoNogoMemo>;
  updateGoNogoMemo(organizationId: number, id: number, data: Partial<InsertGoNogoMemo>): Promise<GoNogoMemo | undefined>;

  // Borrower Messages
  createBorrowerMessage(data: InsertBorrowerMessage): Promise<BorrowerMessage>;
  getBorrowerMessages(noteId: number): Promise<BorrowerMessage[]>;
  markBorrowerMessagesRead(noteId: number, senderType: string): Promise<void>;
  countUnreadBorrowerMessages(noteId: number, senderType: string): Promise<number>;

  // Field Scout Visits
  createFieldScoutVisit(data: InsertFieldScoutVisit): Promise<FieldScoutVisit>;
  getFieldScoutVisit(id: number): Promise<FieldScoutVisit | undefined>;
  getFieldScoutVisits(visitorId: string, limit?: number, offset?: number): Promise<FieldScoutVisit[]>;
  countFieldScoutVisits(visitorId: string): Promise<number>;

  // Field Scout Photos
  createFieldScoutPhoto(data: InsertFieldScoutPhoto): Promise<FieldScoutPhoto>;
  getFieldScoutPhotosByVisit(visitId: number): Promise<FieldScoutPhoto[]>;
  getFieldScoutPhotosByLead(leadId: number): Promise<FieldScoutPhoto[]>;
  // Phase 8 Mo 12 — Yara §1: reverse-image dedup. Returns the existing
  // record for an org+hash pair so callers can short-circuit re-uploads
  // of identical content.
  findFieldScoutPhotoByHash(organizationId: number, imageHash: string): Promise<FieldScoutPhoto | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Organizations + trial tokens — moved to server/storage/orgRepo.ts.
  // Methods are merged into DatabaseStorage.prototype below.

  // Team members + org co-owners — moved to server/storage/teamRepo.ts.

  // Leads (+ activities, soft-delete, scoring, dedup) — moved to server/storage/leadRepo.ts.

  // Properties — moved to server/storage/propertyRepo.ts.

  // Deals — moved to server/storage/dealRepo.ts.

  // Notes + payments — moved to server/storage/noteRepo.ts.

  // Campaigns + optimizations — moved to server/storage/campaignRepo.ts.

  // Agent Configs
  async getAgentConfigs(orgId: number) {
    return await db.select().from(agentConfigs)
      .where(eq(agentConfigs.organizationId, orgId));
  }
  
  async getAgentConfig(orgId: number, id: number) {
    const [config] = await db.select().from(agentConfigs)
      .where(and(eq(agentConfigs.organizationId, orgId), eq(agentConfigs.id, id)));
    return config;
  }
  
  async createAgentConfig(config: InsertAgentConfig) {
    const [newConfig] = await db.insert(agentConfigs).values(config).returning();
    return newConfig;
  }
  
  async updateAgentConfig(id: number, updates: Partial<InsertAgentConfig>, organizationId?: number) {
    const conditions = [eq(agentConfigs.id, id)];
    if (organizationId) conditions.push(eq(agentConfigs.organizationId, organizationId));
    const [updated] = await db.update(agentConfigs)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }
  
  // Agent Tasks
  async getAgentTasks(orgId: number) {
    return await db.select().from(agentTasks)
      .where(eq(agentTasks.organizationId, orgId))
      .orderBy(desc(agentTasks.createdAt));
  }
  
  async getAgentTask(orgId: number, id: number) {
    const [task] = await db.select().from(agentTasks)
      .where(and(eq(agentTasks.organizationId, orgId), eq(agentTasks.id, id)));
    return task;
  }
  
  async createAgentTask(task: InsertAgentTask) {
    const [newTask] = await db.insert(agentTasks).values(task).returning();
    await this.trackUsage(task.organizationId, "ai_request");
    return newTask;
  }
  
  async updateAgentTask(id: number, updates: Partial<InsertAgentTask>, organizationId?: number) {
    const conditions = [eq(agentTasks.id, id)];
    if (organizationId) conditions.push(eq(agentTasks.organizationId, organizationId));
    const [updated] = await db.update(agentTasks).set(updates).where(and(...conditions)).returning();
    return updated;
  }
  
  // Conversations & Messages
  async getConversations(orgId: number, filters?: { leadId?: number; channel?: string }) {
    const conditions = [eq(conversations.organizationId, orgId)];
    
    if (filters?.leadId) {
      conditions.push(eq(conversations.leadId, filters.leadId));
    }
    if (filters?.channel) {
      conditions.push(eq(conversations.channel, filters.channel));
    }
    
    return await db.select().from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt));
  }
  
  async getConversation(orgId: number, id: number) {
    const [conv] = await db.select().from(conversations)
      .where(and(eq(conversations.organizationId, orgId), eq(conversations.id, id)));
    return conv;
  }
  
  async createConversation(conv: InsertConversation) {
    const [newConv] = await db.insert(conversations).values(conv).returning();
    return newConv;
  }
  
  async getMessages(conversationId: number) {
    return await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }
  
  async createMessage(message: InsertMessage) {
    const [newMessage] = await db.insert(messages).values(message).returning();
    
    // Update conversation last message time
    await db.update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, message.conversationId));
    
    return newMessage;
  }
  
  // Dashboard Stats
  async getDashboardStats(orgId: number) {
    const [leadCount] = await db.select({ count: count() }).from(leads).where(eq(leads.organizationId, orgId));
    const [propertyCount] = await db.select({ count: count() }).from(properties)
      .where(and(eq(properties.organizationId, orgId), eq(properties.status, "owned")));
    const [noteCount] = await db.select({ count: count() }).from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
    
    // Calculate monthly revenue from active notes
    const activeNotes = await db.select().from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
    const monthlyRevenue = activeNotes.reduce((sum, note) => sum + Number(note.monthlyPayment || 0), 0);
    
    // Get recent activity
    const recentActivity = await db.select().from(activityLog)
      .where(eq(activityLog.organizationId, orgId))
      .orderBy(desc(activityLog.createdAt))
      .limit(10);
    
    return {
      totalLeads: leadCount?.count || 0,
      activeProperties: propertyCount?.count || 0,
      activeNotes: noteCount?.count || 0,
      monthlyRevenue,
      recentActivity,
    };
  }
  
  // Activity Log
  async logActivity(entry: {
    organizationId: number;
    userId?: string;
    teamMemberId?: number;
    agentType?: string;
    action: string;
    entityType: string;
    entityId: number;
    description?: string;
    changes?: any;
    metadata?: any;
  }) {
    await db.insert(activityLog).values(entry);
  }
  
  // Usage tracking
  async trackUsage(orgId: number, eventType: string, quantity = 1, metadata?: any) {
    await db.insert(usageEvents).values({
      organizationId: orgId,
      eventType,
      quantity,
      metadata,
    });
  }
  
  // AI command-center data layer (agent profiles / tool definitions /
  // execution runs / memory / conversations + messages) extracted to
  // server/storage/aiRepo.ts (mixed into the prototype below).

  // Pax data layer (knowledge base / projects / scheduled tasks / entity
  // search / connector instances) extracted to server/storage/paxRepo.ts
  // (mixed into the prototype below).

  // VA (virtual assistants) data layer (agents / actions / briefings /
  // calendar events / templates) extracted to server/storage/vaRepo.ts
  // (mixed into the prototype below).


  // Due-diligence + deal-checklist data layer (DD templates / DD items /
  // checklist templates / deal checklists) extracted to
  // server/storage/dueDiligenceRepo.ts (mixed into the prototype below).


  // Support-ops data layer (usage/credit reads / support desk / dunning
  // events / system alerts / admin dashboard) extracted to
  // server/storage/supportOpsRepo.ts (mixed into the prototype below).


  // Finance-agent payment-reminders data layer extracted to
  // server/storage/paymentRemindersRepo.ts (mixed into the prototype below).


  // Organization Integrations / Verified Email Domains / Provisioned Phone
  // Numbers CRUD extracted to server/storage/integrationsRepo.ts (mixed into
  // the prototype below).

  // Campaign Responses CRUD (+ tracking-code lookup/generation) and Activity
  // Events (Communication Timeline) extracted to server/storage/commsRepo.ts
  // (mixed into the prototype below).

  // Outreach-sequences data layer (campaign sequences / steps / enrollments /
  // A/B tests + variants) extracted to server/storage/sequencesRepo.ts
  // (mixed into the prototype below).


  // Workspace-customization data layer (custom fields / saved views /
  // workspace presets / notification preferences) extracted to
  // server/storage/customizationRepo.ts (mixed into the prototype below).


  // Task-management data layer (task CRUD / recurring engine) extracted to
  // server/storage/tasksRepo.ts (mixed into the prototype below).


  // Audit Log (20.1), Data Retention (20.3) and TCPA Compliance (20.2) live in
  // server/storage/auditRepo.ts and are mixed into DatabaseStorage.prototype
  // via the Object.assign wiring at the bottom of this file.

  // Team Performance Aggregation (SQL-based)
  async getTeamLeadMetrics(orgId: number, _periodStart: Date): Promise<Array<{
    assignedTo: number | null;
    leadsAssigned: number;
    leadsContacted: number;
    leadsConverted: number;
  }>> {
    const result = await db.select({
      assignedTo: leads.assignedTo,
      leadsAssigned: count(),
      leadsContacted: sql<number>`COUNT(CASE WHEN ${leads.lastContactedAt} IS NOT NULL THEN 1 END)`,
      leadsConverted: sql<number>`COUNT(CASE WHEN ${leads.status} IN ('closed', 'accepted') THEN 1 END)`,
    })
    .from(leads)
    .where(eq(leads.organizationId, orgId))
    .groupBy(leads.assignedTo);
    
    return result.map(r => ({
      assignedTo: r.assignedTo,
      leadsAssigned: Number(r.leadsAssigned) || 0,
      leadsContacted: Number(r.leadsContacted) || 0,
      leadsConverted: Number(r.leadsConverted) || 0,
    }));
  }

  async getTeamDealMetrics(orgId: number, periodStart: Date): Promise<Array<{
    assignedTo: number | null;
    dealsClosed: number;
    revenue: number;
    avgDaysToClose: number;
  }>> {
    const result = await db.select({
      assignedTo: deals.assignedTo,
      dealsClosed: sql<number>`COUNT(CASE WHEN ${deals.status} = 'closed' AND ${deals.closingDate} IS NOT NULL AND ${deals.closingDate} >= ${periodStart} THEN 1 END)`,
      revenue: sql<number>`COALESCE(SUM(CASE WHEN ${deals.status} = 'closed' AND ${deals.closingDate} IS NOT NULL AND ${deals.closingDate} >= ${periodStart} THEN CAST(COALESCE(${deals.acceptedAmount}, ${deals.offerAmount}, '0') AS NUMERIC) END), 0)`,
      avgDaysToClose: sql<number>`COALESCE(AVG(CASE WHEN ${deals.status} = 'closed' AND ${deals.closingDate} IS NOT NULL AND ${deals.closingDate} >= ${periodStart} AND ${deals.createdAt} IS NOT NULL THEN EXTRACT(EPOCH FROM (${deals.closingDate} - ${deals.createdAt})) / 86400 END), 0)`,
    })
    .from(deals)
    .where(eq(deals.organizationId, orgId))
    .groupBy(deals.assignedTo);
    
    return result.map(r => ({
      assignedTo: r.assignedTo,
      dealsClosed: Number(r.dealsClosed) || 0,
      revenue: Number(r.revenue) || 0,
      avgDaysToClose: Number(r.avgDaysToClose) || 0,
    }));
  }

  async getTeamTaskMetrics(orgId: number, periodStart: Date): Promise<Array<{
    assignedTo: number | null;
    tasksCompleted: number;
    tasksPending: number;
  }>> {
    const result = await db.select({
      assignedTo: tasks.assignedTo,
      tasksCompleted: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'completed' AND ${tasks.completedAt} >= ${periodStart} THEN 1 END)`,
      tasksPending: sql<number>`COUNT(CASE WHEN ${tasks.status} IN ('pending', 'in_progress') THEN 1 END)`,
    })
    .from(tasks)
    .where(eq(tasks.organizationId, orgId))
    .groupBy(tasks.assignedTo);
    
    return result.map(r => ({
      assignedTo: r.assignedTo,
      tasksCompleted: Number(r.tasksCompleted) || 0,
      tasksPending: Number(r.tasksPending) || 0,
    }));
  }

  async getTeamActivityTrends(orgId: number, periodStart: Date, periodCount: number = 7): Promise<Array<{
    assignedTo: number | null;
    periods: Array<{ leads: number; deals: number }>;
  }>> {
    const now = new Date();
    const periodLengthMs = Math.floor((now.getTime() - periodStart.getTime()) / periodCount);
    
    const activityResults = await db.select({
      performedBy: leadActivities.performedBy,
      createdAt: leadActivities.createdAt,
    })
    .from(leadActivities)
    .where(and(
      eq(leadActivities.organizationId, orgId),
      sql`${leadActivities.createdAt} IS NOT NULL`,
      gte(leadActivities.createdAt, periodStart)
    ));
    
    const dealResults = await db.select({
      assignedTo: deals.assignedTo,
      closingDate: deals.closingDate,
    })
    .from(deals)
    .where(and(
      eq(deals.organizationId, orgId),
      eq(deals.status, 'closed'),
      sql`${deals.closingDate} IS NOT NULL`,
      gte(deals.closingDate, periodStart)
    ));
    
    const memberTrends = new Map<number | null, Array<{ leads: number; deals: number }>>();
    
    for (const activity of activityResults) {
      if (!activity.createdAt) continue;
      const periodIndex = Math.min(
        Math.floor((new Date(activity.createdAt).getTime() - periodStart.getTime()) / periodLengthMs),
        periodCount - 1
      );
      if (periodIndex < 0) continue;
      
      if (!memberTrends.has(activity.performedBy)) {
        memberTrends.set(activity.performedBy, Array(periodCount).fill(null).map(() => ({ leads: 0, deals: 0 })));
      }
      memberTrends.get(activity.performedBy)![periodIndex].leads++;
    }
    
    for (const deal of dealResults) {
      if (!deal.closingDate) continue;
      const periodIndex = Math.min(
        Math.floor((new Date(deal.closingDate).getTime() - periodStart.getTime()) / periodLengthMs),
        periodCount - 1
      );
      if (periodIndex < 0) continue;
      
      if (!memberTrends.has(deal.assignedTo)) {
        memberTrends.set(deal.assignedTo, Array(periodCount).fill(null).map(() => ({ leads: 0, deals: 0 })));
      }
      memberTrends.get(deal.assignedTo)![periodIndex].deals++;
    }
    
    return Array.from(memberTrends.entries()).map(([assignedTo, periods]) => ({
      assignedTo,
      periods,
    }));
  }
  
  async getTeamLeadResponseTimes(orgId: number, periodStart: Date, limitPerMember: number = 5000): Promise<Array<{
    assignedTo: number | null;
    avgResponseTimeHours: number | null;
  }>> {
    const result = await db.execute(sql`
      WITH ranked_leads AS (
        SELECT 
          assigned_to,
          last_contacted_at,
          created_at,
          ROW_NUMBER() OVER (PARTITION BY assigned_to ORDER BY created_at DESC) as rn
        FROM leads
        WHERE organization_id = ${orgId}
          AND last_contacted_at IS NOT NULL
          AND created_at IS NOT NULL
          AND last_contacted_at >= ${periodStart}
      )
      SELECT 
        assigned_to as "assignedTo",
        AVG(EXTRACT(EPOCH FROM (last_contacted_at - created_at)) / 3600) as "avgResponseTime"
      FROM ranked_leads
      WHERE rn <= ${limitPerMember}
      GROUP BY assigned_to
    `);
    
    return (result.rows as any[]).map(r => ({
      assignedTo: r.assignedTo as number | null,
      avgResponseTimeHours: r.avgResponseTime ? Math.round(Number(r.avgResponseTime) * 10) / 10 : null,
    }));
  }

  // Acquisition-targeting data layer (target counties / offer letters +
  // templates / enhanced DD checklist) extracted to
  // server/storage/acquisitionRepo.ts (mixed into the prototype below).


  // Enrichment + listings data layer (skip traces / property listings)
  // extracted to server/storage/enrichmentRepo.ts (mixed into the
  // prototype below).


  // Documents data layer (templates + system seeder / generated documents /
  // e-signatures / version history / packages) extracted to
  // server/storage/documentsRepo.ts (mixed into the prototype below).


  // Analytics + reporting data layer (executive / revenue / lead / deal /
  // campaign metrics, velocity, pipeline value, conversion rates)
  // extracted to server/storage/analyticsRepo.ts (mixed into the
  // prototype below).


  // Automation + workflow data layer (automation rules + executions /
  // enhanced tasks / notifications / activity feed / job cursors)
  // extracted to server/storage/automationRepo.ts (mixed into the
  // prototype below).

  // Mail + messaging data layer (email sender identities / unified inbox /
  // mail sender identities / mailing orders + pieces) extracted to
  // server/storage/mailRepo.ts (mixed into the prototype below).


  // Platform-ops data layer (feature requests / API usage logs / agent-run
  // status / borrower sessions / job locks) extracted to
  // server/storage/platformOpsRepo.ts (mixed into the prototype below).


  // County GIS endpoints / data-source registry + cache extracted to
  // server/storage/gisRepo.ts (mixed into the prototype below).


  // Subscription Events (Analytics)
  async logSubscriptionEvent(event: InsertSubscriptionEvent): Promise<SubscriptionEvent> {
    const [created] = await db.insert(subscriptionEvents).values(event).returning();
    return created;
  }

  async getSubscriptionEvents(options?: { orgId?: number; limit?: number }): Promise<SubscriptionEvent[]> {
    const conditions: any[] = [];
    if (options?.orgId) {
      conditions.push(eq(subscriptionEvents.organizationId, options.orgId));
    }
    
    let query = db.select().from(subscriptionEvents);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    const results = await query
      .orderBy(desc(subscriptionEvents.createdAt))
      .limit(options?.limit || 100);
    return results;
  }

  async getSubscriptionStats(): Promise<{
    upgrades30d: number;
    downgrades30d: number;
    cancellations30d: number;
    reactivations30d: number;
    signups30d: number;
    totalEvents: number;
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const events = await db.select()
      .from(subscriptionEvents)
      .where(gte(subscriptionEvents.createdAt, thirtyDaysAgo));
    
    let upgrades30d = 0;
    let downgrades30d = 0;
    let cancellations30d = 0;
    let reactivations30d = 0;
    let signups30d = 0;
    
    for (const event of events) {
      switch (event.eventType) {
        case 'upgrade': upgrades30d++; break;
        case 'downgrade': downgrades30d++; break;
        case 'cancel': cancellations30d++; break;
        case 'reactivate': reactivations30d++; break;
        case 'signup': signups30d++; break;
      }
    }
    
    const [totalResult] = await db.select({ count: count() }).from(subscriptionEvents);
    
    return {
      upgrades30d,
      downgrades30d,
      cancellations30d,
      reactivations30d,
      signups30d,
      totalEvents: totalResult?.count || 0,
    };
  }

  async getAllOrganizationsWithDetails(): Promise<Array<{
    id: number;
    name: string;
    ownerId: string;
    tier: string;
    subscriptionStatus: string;
    createdAt: Date | null;
    updatedAt: Date | null;
  }>> {
    const orgs = await db.select({
      id: organizations.id,
      name: organizations.name,
      ownerId: organizations.ownerId,
      tier: organizations.subscriptionTier,
      subscriptionStatus: organizations.subscriptionStatus,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt))
    .limit(10000);

    return orgs;
  }

  // ============================================
  // Live GIS discovery + parcel snapshots extracted to
  // server/storage/gisRepo.ts (mixed into the prototype below).


  // Agent-workflows data layer (agent memory / feedback / workflows +
  // runs / scheduled tasks) extracted to
  // server/storage/agentWorkflowsRepo.ts (mixed into the prototype below).

  // ============================================
  // VA-replacement-engine data layer (marketing lists / offer batches +
  // offers / seller communications / ad postings / buyer prequals /
  // collections / county research) extracted to
  // server/storage/vaEngineRepo.ts (mixed into the prototype below).

  // ============================================
  // PHASE 4: CLOSING & SERVICING AUTOMATION
  // ============================================

  // Closing + servicing data layer (buyer reservations / escrow checklists /
  // closing packets / autopay / payoff quotes / trust ledger / delinquency
  // escalations) extracted to server/storage/closingServicingRepo.ts
  // (mixed into the prototype below).


  // Property-evaluation data layer (DD assignments / SWOT reports /
  // go/no-go memos) extracted to server/storage/evaluationRepo.ts
  // (mixed into the prototype below).


  // Growth + platform-config data layer (playbooks / feature flags /
  // pricing config / founder ads + growth campaigns / borrower messages /
  // field scout) extracted to server/storage/growthConfigRepo.ts
  // (mixed into the prototype below).

}

// ─── Per-domain repo composition ────────────────────────────────────────
// Each repo module exports a plain object of methods; we mix them into the
// DatabaseStorage prototype so `this.<method>` and the IStorage contract
// keep working unchanged. Declaration-merging interfaces below let
// TypeScript see the mixed-in methods as if they were declared in the class
// body.
import { orgRepo, type OrgRepo } from "./storage/orgRepo";
import { teamRepo, type TeamRepo } from "./storage/teamRepo";
import { leadRepo, type LeadRepo } from "./storage/leadRepo";
import { propertyRepo, type PropertyRepo } from "./storage/propertyRepo";
import { dealRepo, type DealRepo } from "./storage/dealRepo";
import { noteRepo, type NoteRepo } from "./storage/noteRepo";
import { campaignRepo, type CampaignRepo } from "./storage/campaignRepo";
import { auditRepo, type AuditRepo } from "./storage/auditRepo";
import { integrationsRepo, type IntegrationsRepo } from "./storage/integrationsRepo";
import { commsRepo, type CommsRepo } from "./storage/commsRepo";
import { paxRepo, type PaxRepo } from "./storage/paxRepo";
import { aiRepo, type AiRepo } from "./storage/aiRepo";
import { automationRepo, type AutomationRepo } from "./storage/automationRepo";
import { mailRepo, type MailRepo } from "./storage/mailRepo";
import { vaRepo, type VaRepo } from "./storage/vaRepo";
import { dueDiligenceRepo, type DueDiligenceRepo } from "./storage/dueDiligenceRepo";
import { supportOpsRepo, type SupportOpsRepo } from "./storage/supportOpsRepo";
import { sequencesRepo, type SequencesRepo } from "./storage/sequencesRepo";
import { customizationRepo, type CustomizationRepo } from "./storage/customizationRepo";
import { paymentRemindersRepo, type PaymentRemindersRepo } from "./storage/paymentRemindersRepo";
import { tasksRepo, type TasksRepo } from "./storage/tasksRepo";
import { acquisitionRepo, type AcquisitionRepo } from "./storage/acquisitionRepo";
import { documentsRepo, type DocumentsRepo } from "./storage/documentsRepo";
import { enrichmentRepo, type EnrichmentRepo } from "./storage/enrichmentRepo";
import { analyticsRepo, type AnalyticsRepo } from "./storage/analyticsRepo";
import { platformOpsRepo, type PlatformOpsRepo } from "./storage/platformOpsRepo";
import { gisRepo, type GisRepo } from "./storage/gisRepo";
import { agentWorkflowsRepo, type AgentWorkflowsRepo } from "./storage/agentWorkflowsRepo";
import { vaEngineRepo, type VaEngineRepo } from "./storage/vaEngineRepo";
import { closingServicingRepo, type ClosingServicingRepo } from "./storage/closingServicingRepo";
import { evaluationRepo, type EvaluationRepo } from "./storage/evaluationRepo";
import { growthConfigRepo, type GrowthConfigRepo } from "./storage/growthConfigRepo";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DatabaseStorage extends OrgRepo, TeamRepo, LeadRepo, PropertyRepo, DealRepo, NoteRepo, CampaignRepo, AuditRepo, IntegrationsRepo, CommsRepo, PaxRepo, AiRepo, AutomationRepo, MailRepo, VaRepo, DueDiligenceRepo, SupportOpsRepo, SequencesRepo, CustomizationRepo, PaymentRemindersRepo, TasksRepo, AcquisitionRepo, DocumentsRepo, EnrichmentRepo, AnalyticsRepo, PlatformOpsRepo, GisRepo, AgentWorkflowsRepo, VaEngineRepo, ClosingServicingRepo, EvaluationRepo, GrowthConfigRepo {}

Object.assign(
  DatabaseStorage.prototype,
  orgRepo,
  teamRepo,
  leadRepo,
  propertyRepo,
  dealRepo,
  noteRepo,
  campaignRepo,
  auditRepo,
  integrationsRepo,
  commsRepo,
  paxRepo,
  aiRepo,
  automationRepo,
  mailRepo,
  vaRepo,
  dueDiligenceRepo,
  supportOpsRepo,
  sequencesRepo,
  customizationRepo,
  paymentRemindersRepo,
  tasksRepo,
  acquisitionRepo,
  documentsRepo,
  enrichmentRepo,
  analyticsRepo,
  platformOpsRepo,
  gisRepo,
  agentWorkflowsRepo,
  vaEngineRepo,
  closingServicingRepo,
  evaluationRepo,
  growthConfigRepo,
);

export const storage = new DatabaseStorage();
