import { db, withTransaction } from "./db";
import { forOrg, unscopedForPlatformOps } from "./utils/orgScopedDb";
import { addMonths } from "./utils/dateUtils";
export { db };
import { eq, and, desc, asc, sql, count, sum, arrayContains, gte, lte, lt, or, inArray, ne, ilike, type SQL } from "drizzle-orm";
import {
  encryptSkipTracePayload,
  decryptSkipTraceRow,
} from "./services/skipTraceEncryption";
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
  dueDiligenceChecklists, dueDiligenceDossiers,
  activityEvents,
  tasks,
  targetCounties,
  offerLetters,
  offerTemplates,
  skipTraces,
  propertyListings,
  parcelSnapshots,
  fieldScoutVisits, fieldScoutPhotos,
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
  signatures,
  documentVersions,
  documentPackages,
  type AutomationRule, type InsertAutomationRule,
  type AutomationExecution, type InsertAutomationExecution,
  type Notification, type InsertNotification,
  type ActivityLogEntry,
  documentTemplates, generatedDocuments,
  type JobCursor,
  jobLocks,
  type JobLock, type InsertJobLock,
  type EmailSenderIdentity, type InsertEmailSenderIdentity,
  type InboxMessage, type InsertInboxMessage,
  type MailSenderIdentity, type InsertMailSenderIdentity,
  type MailingOrder, type InsertMailingOrder,
  type MailingOrderPiece, type InsertMailingOrderPiece,
  featureRequests,
  type FeatureRequest, type InsertFeatureRequest,
  apiUsageLogs,
  type ApiUsageLog, type InsertApiUsageLog,
  agentRuns,
  type AgentRun,
  borrowerSessions,
  type BorrowerSession, type InsertBorrowerSession,
  borrowerMessages,
  type BorrowerMessage, type InsertBorrowerMessage,
  dataSources,
  type DataSource, type InsertDataSource,
  dataSourceCache,
  type DataSourceCache, type InsertDataSourceCache,
  subscriptionEvents,
  type SubscriptionEvent, type InsertSubscriptionEvent,
  discoveredEndpoints,
  type DiscoveredEndpoint, type InsertDiscoveredEndpoint,
  agentMemory,
  type AgentMemory, type InsertAgentMemory,
  agentFeedback,
  type AgentFeedback, type InsertAgentFeedback,
  workflows,
  workflowRuns,
  type Workflow, type InsertWorkflow,
  type WorkflowRun, type InsertWorkflowRun,
  scheduledTasks,
  type ScheduledTask, type InsertScheduledTask,
  marketingLists,
  offerBatches,
  offers,
  sellerCommunications,
  adPostings,
  buyerPrequalifications,
  collectionSequences,
  collectionEnrollments,
  countyResearch,
  type MarketingList, type InsertMarketingList,
  type OfferBatch, type InsertOfferBatch,
  type Offer, type InsertOffer,
  type SellerCommunication, type InsertSellerCommunication,
  type AdPosting, type InsertAdPosting,
  type BuyerPrequalification, type InsertBuyerPrequalification,
  type CollectionSequence, type InsertCollectionSequence,
  type CollectionEnrollment, type InsertCollectionEnrollment,
  type CountyResearch, type InsertCountyResearch,
  buyerReservations,
  type BuyerReservation, type InsertBuyerReservation,
  escrowChecklists,
  type EscrowChecklist, type InsertEscrowChecklist,
  closingPackets,
  type ClosingPacket, type InsertClosingPacket,
  autopayEnrollments,
  type AutopayEnrollment, type InsertAutopayEnrollment,
  payoffQuotes,
  type PayoffQuote, type InsertPayoffQuote,
  trustLedger,
  type TrustLedgerEntry, type InsertTrustLedger,
  delinquencyEscalations,
  type DelinquencyEscalation, type InsertDelinquencyEscalation,
  playbookInstances,
  type PlaybookInstance, type InsertPlaybookInstance,
  ddAssignments,
  type DdAssignment, type InsertDdAssignment,
  swotReports,
  type SwotReport, type InsertSwotReport,
  goNogoMemos,
  type GoNogoMemo, type InsertGoNogoMemo,
  platformFeatureFlags,
  type PlatformFeatureFlag, type InsertPlatformFeatureFlag,
  pricingConfig,
  type PricingConfig, type InsertPricingConfig,
  founderAdAccounts,
  type FounderAdAccount, type InsertFounderAdAccount,
  growthCampaigns,
  type GrowthCampaign, type InsertGrowthCampaign,
  adCreativeBundles,
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

  // Automation Rules (8.1)
  getAutomationRules(orgId: number): Promise<AutomationRule[]>;
  getAutomationRule(orgId: number, id: number): Promise<AutomationRule | undefined>;
  createAutomationRule(rule: InsertAutomationRule): Promise<AutomationRule>;
  updateAutomationRule(id: number, updates: Partial<InsertAutomationRule>): Promise<AutomationRule>;
  deleteAutomationRule(id: number): Promise<void>;
  toggleAutomationRule(id: number, enabled: boolean): Promise<AutomationRule>;
  
  // Automation Executions
  getAutomationExecutions(orgId: number, ruleId?: number, limit?: number): Promise<AutomationExecution[]>;
  createAutomationExecution(execution: InsertAutomationExecution): Promise<AutomationExecution>;

  // Enhanced Tasks (8.2)
  getMyTasks(orgId: number, userId: string): Promise<Task[]>;
  getTasksByEntity(orgId: number, entityType: string, entityId: number): Promise<Task[]>;

  // Notifications (8.3)
  getNotifications(orgId: number, userId: string, unreadOnly?: boolean): Promise<Notification[]>;
  getUnreadNotificationCount(orgId: number, userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationRead(id: number): Promise<Notification>;
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

  // Target Counties
  async getTargetCounties(orgId: number) {
    return db.select().from(targetCounties).where(eq(targetCounties.organizationId, orgId)).orderBy(targetCounties.priority, targetCounties.name);
  }

  async getTargetCounty(orgId: number, id: number) {
    const [county] = await db.select().from(targetCounties).where(and(eq(targetCounties.id, id), eq(targetCounties.organizationId, orgId)));
    return county;
  }

  async createTargetCounty(county: InsertTargetCounty) {
    const [created] = await db.insert(targetCounties).values(county).returning();
    return created;
  }

  async updateTargetCounty(id: number, updates: Partial<InsertTargetCounty>, organizationId?: number) {
    const conditions = [eq(targetCounties.id, id)];
    if (organizationId) conditions.push(eq(targetCounties.organizationId, organizationId));
    const [updated] = await db.update(targetCounties).set({ ...updates, updatedAt: new Date() }).where(and(...conditions)).returning();
    return updated;
  }

  async deleteTargetCounty(id: number, organizationId?: number) {
    const conditions = [eq(targetCounties.id, id)];
    if (organizationId) conditions.push(eq(targetCounties.organizationId, organizationId));
    await db.delete(targetCounties).where(and(...conditions));
  }

  // Offer Letters
  async getOfferLetters(orgId: number, filters?: { status?: string; batchId?: string }) {
    const conditions = [eq(offerLetters.organizationId, orgId)];
    if (filters?.status) {
      conditions.push(eq(offerLetters.status, filters.status));
    }
    if (filters?.batchId) {
      conditions.push(eq(offerLetters.batchId, filters.batchId));
    }

    return db.select().from(offerLetters)
      .where(and(...conditions))
      .orderBy(desc(offerLetters.createdAt));
  }

  async getOfferLetter(orgId: number, id: number) {
    const [letter] = await db.select().from(offerLetters)
      .where(and(eq(offerLetters.id, id), eq(offerLetters.organizationId, orgId)));
    return letter;
  }

  async createOfferLetter(letter: InsertOfferLetter) {
    const [created] = await db.insert(offerLetters).values(letter).returning();
    return created;
  }

  async createOfferLettersBatch(letters: InsertOfferLetter[]) {
    if (letters.length === 0) return [];
    const created = await db.insert(offerLetters).values(letters).returning();
    return created;
  }

  async updateOfferLetter(id: number, updates: Partial<InsertOfferLetter>, organizationId?: number) {
    const conditions = [eq(offerLetters.id, id)];
    if (organizationId) conditions.push(eq(offerLetters.organizationId, organizationId));
    const [updated] = await db.update(offerLetters)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async deleteOfferLetter(id: number, organizationId?: number) {
    const conditions = [eq(offerLetters.id, id)];
    if (organizationId) conditions.push(eq(offerLetters.organizationId, organizationId));
    await db.delete(offerLetters).where(and(...conditions));
  }

  // Offer Templates
  async getOfferTemplates(orgId: number) {
    return db.select().from(offerTemplates)
      .where(eq(offerTemplates.organizationId, orgId))
      .orderBy(desc(offerTemplates.isDefault), offerTemplates.name);
  }

  async getOfferTemplate(orgId: number, id: number) {
    const [template] = await db.select().from(offerTemplates)
      .where(and(eq(offerTemplates.id, id), eq(offerTemplates.organizationId, orgId)));
    return template;
  }

  async createOfferTemplate(template: InsertOfferTemplate) {
    const [created] = await db.insert(offerTemplates).values(template).returning();
    return created;
  }

  async updateOfferTemplate(id: number, updates: Partial<InsertOfferTemplate>, organizationId?: number) {
    const conditions = [eq(offerTemplates.id, id)];
    if (organizationId) conditions.push(eq(offerTemplates.organizationId, organizationId));
    const [updated] = await db.update(offerTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async deleteOfferTemplate(id: number, organizationId?: number) {
    const conditions = [eq(offerTemplates.id, id)];
    if (organizationId) conditions.push(eq(offerTemplates.organizationId, organizationId));
    await db.delete(offerTemplates).where(and(...conditions));
  }

  // Due Diligence Checklists (Enhanced)
  async getDueDiligenceChecklist(propertyId: number) {
    const [checklist] = await db.select().from(dueDiligenceChecklists)
      .where(eq(dueDiligenceChecklists.propertyId, propertyId));
    return checklist;
  }

  async getOrCreateDueDiligenceChecklist(orgId: number, propertyId: number) {
    const existing = await this.getDueDiligenceChecklist(propertyId);
    if (existing) return existing;

    const defaultItems = [
      { id: "env-flood", category: "environmental", name: "Flood Zone Check", status: "pending", dataSource: "FEMA" },
      { id: "env-wetlands", category: "environmental", name: "Wetlands Assessment", status: "pending", dataSource: "NWI" },
      { id: "env-soil", category: "environmental", name: "Soil Analysis", status: "pending", dataSource: "USDA NRCS" },
      { id: "env-epa", category: "environmental", name: "EPA Superfund Sites", status: "pending", dataSource: "EPA TRI" },
      { id: "tax-history", category: "taxes", name: "Tax History Review", status: "pending", dataSource: "County Records" },
      { id: "tax-back", category: "taxes", name: "Back Taxes Check", status: "pending", dataSource: "County Treasurer" },
      { id: "tax-sale", category: "taxes", name: "Tax Sale Status", status: "pending", dataSource: "County Records" },
      { id: "legal-hoa", category: "legal", name: "HOA/POA Check", status: "pending", dataSource: "Title Search" },
      { id: "legal-deed", category: "legal", name: "Deed Restrictions", status: "pending", dataSource: "County Recorder" },
      { id: "legal-easements", category: "legal", name: "Easements Review", status: "pending", dataSource: "Title Search" },
      { id: "access-legal", category: "access", name: "Legal Access Verification", status: "pending", dataSource: "Survey/Plat" },
      { id: "access-road", category: "access", name: "Road Type Assessment", status: "pending", dataSource: "Site Visit" },
      { id: "access-maintenance", category: "access", name: "Road Maintenance Responsibility", status: "pending", dataSource: "County/HOA" },
      { id: "util-electric", category: "utilities", name: "Electric Availability", status: "pending", dataSource: "Utility Provider" },
      { id: "util-water", category: "utilities", name: "Water Access", status: "pending", dataSource: "Utility/Well Records" },
      { id: "util-sewer", category: "utilities", name: "Sewer/Septic Status", status: "pending", dataSource: "Health Dept" },
      { id: "util-internet", category: "utilities", name: "Internet Availability", status: "pending", dataSource: "ISP Check" },
    ];

    const [checklist] = await db.insert(dueDiligenceChecklists).values({
      organizationId: orgId,
      propertyId,
      status: "in_progress",
      completedPercent: 0,
      items: defaultItems,
    }).returning();
    return checklist;
  }

  async updateDueDiligenceChecklist(id: number, updates: Partial<InsertDueDiligenceChecklist>, organizationId?: number) {
    if (updates.items) {
      const items = updates.items as any[];
      const completedCount = items.filter(i => i.status === "passed" || i.status === "failed" || i.status === "skipped").length;
      updates.completedPercent = Math.round((completedCount / items.length) * 100);
      if (updates.completedPercent === 100) {
        updates.status = "completed";
        updates.completedAt = new Date();
      }
    }
    const conditions = [eq(dueDiligenceChecklists.id, id)];
    if (organizationId) conditions.push(eq(dueDiligenceChecklists.organizationId, organizationId));
    const [updated] = await db.update(dueDiligenceChecklists)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  // Skip Traces
  // R3: input_data and results carry PII (DOB hints, last-4 SSN, phones,
  // prior addresses, relatives). They are AES-256-GCM encrypted at the
  // application layer via skipTraceEncryption.* helpers. Reads are tolerant
  // of legacy plaintext rows (mirrors decryptStoredTin in bookkeeping.ts).
  async getSkipTraces(orgId: number) {
    const rows = await db.select().from(skipTraces)
      .where(eq(skipTraces.organizationId, orgId))
      .orderBy(desc(skipTraces.createdAt));
    return rows.map((r) => decryptSkipTraceRow(r)!);
  }

  async getSkipTrace(orgId: number, id: number) {
    const [trace] = await db.select().from(skipTraces)
      .where(and(eq(skipTraces.id, id), eq(skipTraces.organizationId, orgId)));
    // decryptSkipTraceRow widens to `| null`; `trace` is only ever undefined when
    // absent, so normalize null→undefined to match the IStorage contract.
    return decryptSkipTraceRow(trace) ?? undefined;
  }

  async getSkipTraceByLead(orgId: number, leadId: number) {
    const [trace] = await db.select().from(skipTraces)
      .where(and(eq(skipTraces.organizationId, orgId), eq(skipTraces.leadId, leadId)))
      .orderBy(desc(skipTraces.createdAt));
    return decryptSkipTraceRow(trace) ?? undefined;
  }

  async createSkipTrace(skipTrace: InsertSkipTrace) {
    const payload: InsertSkipTrace = {
      ...skipTrace,
      // Cast through `any` because the column type is the structured PII
      // shape, but on disk we store an encryption envelope. The shape is
      // restored by decryptSkipTraceRow on read.
      inputData: encryptSkipTracePayload(skipTrace.inputData) as any,
      results: encryptSkipTracePayload(skipTrace.results) as any,
    };
    const [created] = await db.insert(skipTraces).values(payload).returning();
    return decryptSkipTraceRow(created)!;
  }

  async updateSkipTrace(id: number, updates: Partial<InsertSkipTrace>, organizationId?: number) {
    const conditions = [eq(skipTraces.id, id)];
    if (organizationId) conditions.push(eq(skipTraces.organizationId, organizationId));

    const encrypted: Partial<InsertSkipTrace> = { ...updates };
    if ("inputData" in updates) {
      encrypted.inputData = encryptSkipTracePayload(updates.inputData) as any;
    }
    if ("results" in updates) {
      encrypted.results = encryptSkipTracePayload(updates.results) as any;
    }

    const [updated] = await db.update(skipTraces)
      .set(encrypted)
      .where(and(...conditions))
      .returning();
    return decryptSkipTraceRow(updated)!;
  }

  // Property Listings
  async getPropertyListings(orgId: number, filters?: { status?: string }) {
    if (filters?.status) {
      return db.select().from(propertyListings)
        .where(and(eq(propertyListings.organizationId, orgId), eq(propertyListings.status, filters.status)))
        .orderBy(desc(propertyListings.createdAt));
    }
    return db.select().from(propertyListings)
      .where(eq(propertyListings.organizationId, orgId))
      .orderBy(desc(propertyListings.createdAt));
  }

  async getPropertyListing(orgId: number, id: number) {
    const [listing] = await db.select().from(propertyListings)
      .where(and(eq(propertyListings.id, id), eq(propertyListings.organizationId, orgId)));
    return listing;
  }

  async getPropertyListingByPropertyId(orgId: number, propertyId: number) {
    const [listing] = await db.select().from(propertyListings)
      .where(and(eq(propertyListings.propertyId, propertyId), eq(propertyListings.organizationId, orgId)));
    return listing;
  }

  async createPropertyListing(listing: InsertPropertyListing) {
    const [created] = await db.insert(propertyListings).values(listing).returning();
    return created;
  }

  async updatePropertyListing(id: number, updates: Partial<InsertPropertyListing>, organizationId?: number) {
    const conditions = [eq(propertyListings.id, id)];
    if (organizationId) conditions.push(eq(propertyListings.organizationId, organizationId));
    const [updated] = await db.update(propertyListings)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async deletePropertyListing(id: number, organizationId?: number) {
    const conditions = [eq(propertyListings.id, id)];
    if (organizationId) conditions.push(eq(propertyListings.organizationId, organizationId));
    await db.delete(propertyListings).where(and(...conditions));
  }

  // Document Templates
  async getDocumentTemplates(orgId: number) {
    return db.select().from(documentTemplates)
      .where(and(
        or(
          eq(documentTemplates.organizationId, orgId),
          sql`${documentTemplates.organizationId} IS NULL`
        ),
        eq(documentTemplates.isActive, true)
      ))
      .orderBy(documentTemplates.isSystemTemplate, documentTemplates.name);
  }

  // Tier 1F: org-scoped by construction. System templates (isSystemTemplate)
  // are platform-shared and stay readable by every org; everything else is
  // pinned to the caller's tenant.
  async getDocumentTemplate(organizationId: number, id: number) {
    const [template] = await db.select().from(documentTemplates)
      .where(and(
        eq(documentTemplates.id, id),
        or(
          eq(documentTemplates.organizationId, organizationId),
          eq(documentTemplates.isSystemTemplate, true),
        ),
      ));
    return template;
  }

  async createDocumentTemplate(template: InsertDocumentTemplate) {
    const [created] = await db.insert(documentTemplates).values(template).returning();
    return created;
  }

  // Tier 1F: organizationId is now REQUIRED — bare-id updates no longer typecheck.
  async updateDocumentTemplate(organizationId: number, id: number, updates: Partial<InsertDocumentTemplate>) {
    const existing = await this.getDocumentTemplate(organizationId, id);
    const currentVersion = existing?.version || 1;

    const conditions = [eq(documentTemplates.id, id), eq(documentTemplates.organizationId, organizationId)];
    const [updated] = await db.update(documentTemplates)
      .set({
        ...updates,
        version: currentVersion + 1,
        updatedAt: new Date()
      })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async deleteDocumentTemplate(id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(documentTemplates.id, id)];
    if (organizationId) conditions.push(eq(documentTemplates.organizationId, organizationId));
    await db.update(documentTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(...conditions));
  }

  async seedSystemTemplates() {
    const existing = await db.select().from(documentTemplates)
      .where(eq(documentTemplates.isSystemTemplate, true));
    
    if (existing.length > 0) return;

    const systemTemplates: InsertDocumentTemplate[] = [
      {
        name: "Purchase Agreement",
        type: "purchase_agreement",
        category: "closing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>REAL ESTATE PURCHASE AGREEMENT</h1>

<p>This Purchase Agreement ("Agreement") is entered into as of <strong>{{closing_date}}</strong>, by and between:</p>

<p><strong>SELLER:</strong> {{seller_name}}<br/>
<strong>BUYER:</strong> {{buyer_name}}</p>

<h2>1. PROPERTY DESCRIPTION</h2>
<p>The Seller agrees to sell, and the Buyer agrees to purchase, the following described real property:</p>
<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}<br/>
<strong>County:</strong> {{county}}, <strong>State:</strong> {{state}}</p>

<h2>2. PURCHASE PRICE</h2>
<p>The total purchase price for the Property shall be <strong>{{purchase_price}}</strong> ("Purchase Price"), payable as follows:</p>
<ul>
<li>Down Payment: {{down_payment}}</li>
<li>Balance due at closing or per financing terms</li>
</ul>

<h2>3. CLOSING</h2>
<p>The closing of this transaction shall take place on or before <strong>{{closing_date}}</strong>.</p>

<h2>4. SIGNATURES</h2>
<p>IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.</p>

<p>____________________________<br/>
Seller: {{seller_name}}<br/>
Date: _____________</p>

<p>____________________________<br/>
Buyer: {{buyer_name}}<br/>
Date: _____________</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the buyer", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the seller", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "purchase_price", description: "Total purchase price", type: "currency", required: true },
          { name: "down_payment", description: "Down payment amount", type: "currency", required: false, defaultValue: "$0" },
          { name: "closing_date", description: "Expected closing date", type: "date", required: true },
        ],
      },
      {
        name: "Quit Claim Deed",
        type: "quit_claim_deed",
        category: "closing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>QUIT CLAIM DEED</h1>

<p><strong>Recording Requested By:</strong><br/>
{{buyer_name}}</p>

<p><strong>When Recorded Mail To:</strong><br/>
{{buyer_name}}<br/>
{{buyer_address}}</p>

<hr/>

<p>FOR VALUABLE CONSIDERATION, the receipt of which is hereby acknowledged,</p>

<p><strong>{{seller_name}}</strong> ("Grantor")</p>

<p>does hereby REMISE, RELEASE, and QUIT CLAIM to</p>

<p><strong>{{buyer_name}}</strong> ("Grantee")</p>

<p>the following described real property situated in <strong>{{county}}</strong> County, State of <strong>{{state}}</strong>:</p>

<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}</p>

<p><strong>Legal Description:</strong><br/>
{{legal_description}}</p>

<p>Dated: {{closing_date}}</p>

<p>____________________________<br/>
{{seller_name}}, Grantor</p>

<p><strong>STATE OF {{state}}</strong><br/>
<strong>COUNTY OF {{county}}</strong></p>

<p>On {{closing_date}}, before me, a Notary Public, personally appeared {{seller_name}}, who proved to me on the basis of satisfactory evidence to be the person(s) whose name(s) is/are subscribed to the within instrument and acknowledged to me that he/she/they executed the same in his/her/their authorized capacity(ies), and that by his/her/their signature(s) on the instrument the person(s), or the entity upon behalf of which the person(s) acted, executed the instrument.</p>

<p>____________________________<br/>
Notary Public</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the grantee (buyer)", type: "text", required: true },
          { name: "buyer_address", description: "Mailing address of the grantee", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the grantor (seller)", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "legal_description", description: "Full legal description from deed", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "closing_date", description: "Date of execution", type: "date", required: true },
        ],
      },
      {
        name: "Assignment Contract",
        type: "assignment",
        category: "closing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>ASSIGNMENT OF REAL ESTATE CONTRACT</h1>

<p>This Assignment of Real Estate Contract ("Assignment") is made and entered into as of <strong>{{closing_date}}</strong>, by and between:</p>

<p><strong>ASSIGNOR:</strong> {{seller_name}}<br/>
<strong>ASSIGNEE:</strong> {{buyer_name}}</p>

<h2>RECITALS</h2>

<p>WHEREAS, Assignor entered into a Real Estate Purchase Agreement dated {{original_contract_date}} ("Original Contract") for the purchase of real property located at:</p>

<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}<br/>
<strong>County:</strong> {{county}}, <strong>State:</strong> {{state}}</p>

<p>WHEREAS, Assignor desires to assign all of Assignor's right, title, and interest in the Original Contract to Assignee;</p>

<h2>ASSIGNMENT</h2>

<p>NOW, THEREFORE, in consideration of the sum of <strong>{{assignment_fee}}</strong> ("Assignment Fee") and other good and valuable consideration, the receipt and sufficiency of which is hereby acknowledged, Assignor hereby assigns, transfers, and conveys to Assignee all of Assignor's right, title, and interest in and to the Original Contract.</p>

<h2>PURCHASE PRICE</h2>
<p>The original purchase price under the Contract is <strong>{{purchase_price}}</strong>.</p>

<h2>SIGNATURES</h2>

<p>____________________________<br/>
Assignor: {{seller_name}}<br/>
Date: _____________</p>

<p>____________________________<br/>
Assignee: {{buyer_name}}<br/>
Date: _____________</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the assignee", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the assignor", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "purchase_price", description: "Original purchase price", type: "currency", required: true },
          { name: "assignment_fee", description: "Assignment fee amount", type: "currency", required: true },
          { name: "closing_date", description: "Date of assignment", type: "date", required: true },
          { name: "original_contract_date", description: "Date of original purchase contract", type: "date", required: true },
        ],
      },
      {
        name: "Promissory Note",
        type: "promissory_note",
        category: "financing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>PROMISSORY NOTE</h1>

<p><strong>Principal Amount:</strong> {{principal_amount}}<br/>
<strong>Date:</strong> {{note_date}}<br/>
<strong>Maturity Date:</strong> {{maturity_date}}</p>

<hr/>

<p>FOR VALUE RECEIVED, the undersigned <strong>{{borrower_name}}</strong> ("Borrower"), whose address is {{borrower_address}}, hereby promises to pay to the order of <strong>{{lender_name}}</strong> ("Lender"), or assigns, at {{lender_address}}, or such other place as the holder hereof may designate in writing, the principal sum of <strong>{{principal_amount}}</strong>, together with interest thereon at the rate of <strong>{{interest_rate}}</strong> percent per annum, in lawful money of the United States of America.</p>

<h2>PAYMENT TERMS</h2>

<p>This Note shall be payable as follows:</p>
<ul>
<li><strong>Down Payment:</strong> {{down_payment}} paid upon execution of this Note</li>
<li><strong>Monthly Payments:</strong> {{monthly_payment}} due on the {{payment_day}} day of each month</li>
<li><strong>First Payment Due:</strong> {{first_payment_date}}</li>
<li><strong>Number of Payments:</strong> {{term_months}} monthly payments</li>
<li><strong>Final Payment Due:</strong> {{maturity_date}}</li>
</ul>

<h2>SECURITY</h2>

<p>This Note is secured by a deed of trust or mortgage on the following real property:</p>
<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}<br/>
<strong>County:</strong> {{county}}, <strong>State:</strong> {{state}}</p>

<h2>LATE CHARGES</h2>

<p>If any payment is not received within {{grace_period_days}} days after its due date, Borrower shall pay a late charge of {{late_fee_amount}} or {{late_fee_percentage}}% of the overdue payment, whichever is greater.</p>

<h2>PREPAYMENT</h2>

<p>Borrower may prepay this Note in whole or in part at any time without penalty.</p>

<h2>DEFAULT</h2>

<p>Upon default in the payment of any installment when due, or upon breach of any condition of the deed of trust or mortgage securing this Note, the entire unpaid principal balance, together with all accrued interest, shall, at the option of the holder, become immediately due and payable.</p>

<h2>SIGNATURES</h2>

<p>____________________________<br/>
Borrower: {{borrower_name}}<br/>
Date: _____________</p>

<p>____________________________<br/>
Lender: {{lender_name}}<br/>
Date: _____________</p>`,
        variables: [
          { name: "borrower_name", description: "Full legal name of the borrower", type: "text", required: true },
          { name: "borrower_address", description: "Mailing address of the borrower", type: "text", required: true },
          { name: "lender_name", description: "Full legal name of the lender", type: "text", required: true },
          { name: "lender_address", description: "Mailing address of the lender", type: "text", required: true },
          { name: "principal_amount", description: "Total loan amount", type: "currency", required: true },
          { name: "interest_rate", description: "Annual interest rate (e.g., 8.5)", type: "number", required: true },
          { name: "down_payment", description: "Down payment amount", type: "currency", required: false, defaultValue: "$0" },
          { name: "monthly_payment", description: "Monthly payment amount", type: "currency", required: true },
          { name: "payment_day", description: "Day of month payment is due", type: "number", required: true, defaultValue: "1" },
          { name: "term_months", description: "Total number of monthly payments", type: "number", required: true },
          { name: "note_date", description: "Date of the promissory note", type: "date", required: true },
          { name: "first_payment_date", description: "Date of first payment", type: "date", required: true },
          { name: "maturity_date", description: "Final payment due date", type: "date", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "grace_period_days", description: "Number of grace period days", type: "number", required: false, defaultValue: "10" },
          { name: "late_fee_amount", description: "Late fee flat amount", type: "currency", required: false, defaultValue: "$25" },
          { name: "late_fee_percentage", description: "Late fee percentage", type: "number", required: false, defaultValue: "5" },
        ],
      },
      {
        name: "Warranty Deed",
        type: "warranty_deed",
        category: "closing",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>WARRANTY DEED</h1>

<p><strong>Recording Requested By:</strong><br/>
{{buyer_name}}</p>

<p><strong>When Recorded Mail To:</strong><br/>
{{buyer_name}}<br/>
{{buyer_address}}</p>

<p><strong>Mail Tax Statements To:</strong><br/>
{{buyer_name}}<br/>
{{buyer_address}}</p>

<hr/>

<p><strong>APN:</strong> {{parcel_number}}</p>

<h2>WARRANTY DEED</h2>

<p>FOR VALUABLE CONSIDERATION, receipt of which is hereby acknowledged,</p>

<p><strong>{{seller_name}}</strong>, Grantor(s),</p>

<p>hereby GRANT(S), BARGAIN(S), SELL(S), and CONVEY(S) to</p>

<p><strong>{{buyer_name}}</strong>, Grantee(s),</p>

<p>the following described real property in the County of <strong>{{county}}</strong>, State of <strong>{{state}}</strong>:</p>

<p><strong>Property Address:</strong> {{property_address}}</p>

<p><strong>Legal Description:</strong><br/>
{{legal_description}}</p>

<p>TOGETHER WITH all and singular the tenements, hereditaments, and appurtenances thereunto belonging or in anywise appertaining, and the reversion and reversions, remainder and remainders, rents, issues, and profits thereof.</p>

<p>TO HAVE AND TO HOLD the said premises unto the said Grantee(s), and Grantee's heirs and assigns forever.</p>

<p>AND THE SAID GRANTOR(S) hereby covenant(s) with the said Grantee(s), and Grantee's heirs and assigns, that Grantor(s) is/are seized of an indefeasible estate in fee simple in and to said premises; that Grantor(s) has/have good right to convey the same; that the premises are free from all encumbrances, except as noted herein; and that Grantor(s) will warrant and defend said premises against the lawful claims of all persons whomsoever.</p>

<p><strong>CONSIDERATION:</strong> {{purchase_price}}</p>

<p>Dated: {{closing_date}}</p>

<p>____________________________<br/>
{{seller_name}}, Grantor</p>

<h2>ACKNOWLEDGMENT</h2>

<p><strong>STATE OF {{state}}</strong><br/>
<strong>COUNTY OF {{county}}</strong></p>

<p>On {{closing_date}}, before me, a Notary Public in and for said State, personally appeared {{seller_name}}, known to me (or proved to me on the basis of satisfactory evidence) to be the person(s) whose name(s) is/are subscribed to the within instrument and acknowledged to me that he/she/they executed the same in his/her/their authorized capacity(ies), and that by his/her/their signature(s) on the instrument the person(s), or the entity upon behalf of which the person(s) acted, executed the instrument.</p>

<p>WITNESS my hand and official seal.</p>

<p>____________________________<br/>
Notary Public</p>

<p>My Commission Expires: _____________</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the grantee (buyer)", type: "text", required: true },
          { name: "buyer_address", description: "Mailing address of the grantee", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the grantor (seller)", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "legal_description", description: "Full legal description from deed", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "purchase_price", description: "Purchase price/consideration", type: "currency", required: true },
          { name: "closing_date", description: "Date of execution", type: "date", required: true },
        ],
      },
      {
        name: "Offer Letter",
        type: "offer_letter",
        category: "acquisition",
        isSystemTemplate: true,
        isActive: true,
        content: `<h1>OFFER TO PURCHASE REAL PROPERTY</h1>

<p><strong>Date:</strong> {{offer_date}}</p>

<p><strong>To:</strong> {{seller_name}}</p>

<p><strong>From:</strong> {{buyer_name}}<br/>
{{buyer_address}}<br/>
{{buyer_phone}}<br/>
{{buyer_email}}</p>

<hr/>

<p>Dear {{seller_name}},</p>

<p>I am writing to express my interest in purchasing your property located at:</p>

<p><strong>Property Address:</strong> {{property_address}}<br/>
<strong>Parcel Number:</strong> {{parcel_number}}<br/>
<strong>County:</strong> {{county}}, <strong>State:</strong> {{state}}</p>

<h2>OFFER TERMS</h2>

<p>I am prepared to make the following offer for the above-referenced property:</p>

<ul>
<li><strong>Purchase Price:</strong> {{purchase_price}} (Cash offer)</li>
<li><strong>Earnest Money Deposit:</strong> {{earnest_money}}</li>
<li><strong>Proposed Closing Date:</strong> {{closing_date}}</li>
<li><strong>Offer Expiration:</strong> {{offer_expiration_date}}</li>
</ul>

<h2>CONDITIONS</h2>

<p>This offer is contingent upon:</p>
<ul>
<li>Clear and marketable title</li>
<li>Property inspection satisfactory to Buyer (if applicable)</li>
<li>Standard title insurance</li>
</ul>

<h2>BENEFITS OF THIS OFFER</h2>

<ul>
<li>All-cash offer with quick closing</li>
<li>No financing contingencies</li>
<li>Flexible closing date</li>
<li>Property purchased as-is</li>
</ul>

<p>I believe this offer represents fair value for your property and I am committed to a smooth, hassle-free transaction. Please feel free to contact me at {{buyer_phone}} or {{buyer_email}} to discuss this offer further.</p>

<p>I look forward to hearing from you.</p>

<p>Sincerely,</p>

<p>____________________________<br/>
{{buyer_name}}</p>

<p>This offer expires on {{offer_expiration_date}} at 11:59 PM local time.</p>`,
        variables: [
          { name: "buyer_name", description: "Full legal name of the buyer", type: "text", required: true },
          { name: "buyer_address", description: "Mailing address of the buyer", type: "text", required: true },
          { name: "buyer_phone", description: "Buyer's phone number", type: "text", required: true },
          { name: "buyer_email", description: "Buyer's email address", type: "text", required: true },
          { name: "seller_name", description: "Full legal name of the seller", type: "text", required: true },
          { name: "property_address", description: "Full street address of the property", type: "text", required: true },
          { name: "parcel_number", description: "APN/Parcel number", type: "text", required: true },
          { name: "county", description: "County where property is located", type: "text", required: true },
          { name: "state", description: "State where property is located", type: "text", required: true },
          { name: "purchase_price", description: "Offered purchase price", type: "currency", required: true },
          { name: "earnest_money", description: "Earnest money deposit amount", type: "currency", required: false, defaultValue: "$100" },
          { name: "offer_date", description: "Date of the offer letter", type: "date", required: true },
          { name: "closing_date", description: "Proposed closing date", type: "date", required: true },
          { name: "offer_expiration_date", description: "Date when offer expires", type: "date", required: true },
        ],
      },
    ];

    await db.insert(documentTemplates).values(systemTemplates);
  }

  // Generated Documents
  async getGeneratedDocuments(orgId: number, filters?: { dealId?: number; propertyId?: number; status?: string }) {
    let conditions = [eq(generatedDocuments.organizationId, orgId)];
    
    if (filters?.dealId) {
      conditions.push(eq(generatedDocuments.dealId, filters.dealId));
    }
    if (filters?.propertyId) {
      conditions.push(eq(generatedDocuments.propertyId, filters.propertyId));
    }
    if (filters?.status) {
      conditions.push(eq(generatedDocuments.status, filters.status));
    }
    
    return db.select().from(generatedDocuments)
      .where(and(...conditions))
      .orderBy(desc(generatedDocuments.createdAt));
  }

  async getGeneratedDocument(orgId: number, id: number) {
    const [doc] = await db.select().from(generatedDocuments)
      .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.organizationId, orgId)));
    return doc;
  }

  async createGeneratedDocument(doc: InsertGeneratedDocument) {
    const [created] = await db.insert(generatedDocuments).values(doc).returning();
    return created;
  }

  async updateGeneratedDocument(id: number, updates: Partial<InsertGeneratedDocument>, organizationId?: number) {
    const conditions = [eq(generatedDocuments.id, id)];
    if (organizationId) conditions.push(eq(generatedDocuments.organizationId, organizationId));
    const [updated] = await db.update(generatedDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  // Native E-Signatures
  async getSignatures(orgId: number, documentId?: number) {
    let conditions = [eq(signatures.organizationId, orgId)];
    if (documentId) {
      conditions.push(eq(signatures.documentId, documentId));
    }
    return db.select().from(signatures)
      .where(and(...conditions))
      .orderBy(desc(signatures.signedAt));
  }

  async getSignature(orgId: number, id: number) {
    const [sig] = await db.select().from(signatures)
      .where(and(eq(signatures.id, id), eq(signatures.organizationId, orgId)));
    return sig;
  }

  async createSignature(signature: InsertSignature) {
    const [created] = await db.insert(signatures).values(signature).returning();
    return created;
  }

  async getDocumentSignatures(documentId: number) {
    return db.select().from(signatures)
      .where(eq(signatures.documentId, documentId))
      .orderBy(signatures.signedAt);
  }

  // Document Version History
  async createDocumentVersion(version: InsertDocumentVersion) {
    const [created] = await db.insert(documentVersions).values(version).returning();
    return created;
  }

  async getDocumentVersions(orgId: number, documentId: number, documentType: string) {
    return db.select().from(documentVersions)
      .where(and(
        eq(documentVersions.organizationId, orgId),
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.documentType, documentType)
      ))
      .orderBy(desc(documentVersions.version));
  }

  // Tier 1F: org-scoped by construction.
  async getDocumentVersion(organizationId: number, id: number) {
    return await forOrg(organizationId).findById(documentVersions, id);
  }

  async restoreDocumentVersion(orgId: number, versionId: number): Promise<{ success: boolean; message: string }> {
    // Tier 1F: the fetch itself is org-pinned — a cross-org versionId resolves
    // to "not found" by construction.
    const version = await this.getDocumentVersion(orgId, versionId);
    if (!version) {
      return { success: false, message: "Version not found" };
    }

    if (version.documentType === "template") {
      const template = await this.getDocumentTemplate(orgId, version.documentId);
      if (!template) {
        return { success: false, message: "Template not found" };
      }
      
      const currentVersion = template.version || 1;
      await this.createDocumentVersion({
        organizationId: orgId,
        documentId: template.id,
        documentType: "template",
        version: currentVersion,
        content: template.content,
        variables: template.variables,
        changes: `Auto-saved before restoring to version ${version.version}`,
        createdBy: version.createdBy,
      });
      
      await this.updateDocumentTemplate(orgId, template.id, {
        content: version.content,
        variables: version.variables as any,
        version: currentVersion + 1,
      });
      
      return { success: true, message: `Restored to version ${version.version}` };
    } else if (version.documentType === "generated") {
      const doc = await this.getGeneratedDocument(orgId, version.documentId);
      if (!doc) {
        return { success: false, message: "Document not found" };
      }
      
      const versions = await this.getDocumentVersions(orgId, doc.id, "generated");
      const currentVersionNum = versions.length > 0 ? Math.max(...versions.map(v => v.version)) : 0;
      
      await this.createDocumentVersion({
        organizationId: orgId,
        documentId: doc.id,
        documentType: "generated",
        version: currentVersionNum + 1,
        content: doc.content || "",
        changes: `Auto-saved before restoring to version ${version.version}`,
        createdBy: version.createdBy,
      });
      
      await this.updateGeneratedDocument(doc.id, {
        content: version.content,
      });
      
      return { success: true, message: `Restored to version ${version.version}` };
    }

    return { success: false, message: "Invalid document type" };
  }

  // Document Packages
  async getDocumentPackages(orgId: number, filters?: { dealId?: number; propertyId?: number; status?: string }) {
    let conditions = [eq(documentPackages.organizationId, orgId)];
    
    if (filters?.dealId) {
      conditions.push(eq(documentPackages.dealId, filters.dealId));
    }
    if (filters?.propertyId) {
      conditions.push(eq(documentPackages.propertyId, filters.propertyId));
    }
    if (filters?.status) {
      conditions.push(eq(documentPackages.status, filters.status));
    }
    
    return db.select().from(documentPackages)
      .where(and(...conditions))
      .orderBy(desc(documentPackages.createdAt));
  }

  async getDocumentPackage(orgId: number, id: number) {
    const [pkg] = await db.select().from(documentPackages)
      .where(and(eq(documentPackages.id, id), eq(documentPackages.organizationId, orgId)));
    return pkg;
  }

  async createDocumentPackage(pkg: InsertDocumentPackage) {
    const [created] = await db.insert(documentPackages).values(pkg).returning();
    return created;
  }

  async updateDocumentPackage(id: number, updates: Partial<InsertDocumentPackage>, organizationId?: number) {
    const conditions = [eq(documentPackages.id, id)];
    if (organizationId) conditions.push(eq(documentPackages.organizationId, organizationId));
    const [updated] = await db.update(documentPackages)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async deleteDocumentPackage(orgId: number, id: number) {
    const [deleted] = await db.delete(documentPackages)
      .where(and(eq(documentPackages.id, id), eq(documentPackages.organizationId, orgId)))
      .returning();
    return deleted;
  }

  async getPackagesByDeal(orgId: number, dealId: number) {
    return db.select().from(documentPackages)
      .where(and(
        eq(documentPackages.organizationId, orgId),
        eq(documentPackages.dealId, dealId)
      ))
      .orderBy(desc(documentPackages.createdAt));
  }

  async getPackagesByProperty(orgId: number, propertyId: number) {
    return db.select().from(documentPackages)
      .where(and(
        eq(documentPackages.organizationId, orgId),
        eq(documentPackages.propertyId, propertyId)
      ))
      .orderBy(desc(documentPackages.createdAt));
  }

  // Analytics & Reporting
  async getExecutiveMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const { startDate, endDate } = dateRange;
    const prevStartDate = new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()));
    
    const currentPayments = await db.select({ total: sum(payments.amount) })
      .from(payments)
      .where(and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, startDate),
        lte(payments.paymentDate, endDate)
      ));
    const totalRevenue = Number(currentPayments[0]?.total || 0);
    
    const prevPayments = await db.select({ total: sum(payments.amount) })
      .from(payments)
      .where(and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, prevStartDate),
        lte(payments.paymentDate, startDate)
      ));
    const prevRevenue = Number(prevPayments[0]?.total || 0);
    const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;
    
    const currentNotesValue = await this.getActiveNotesValue(orgId);
    
    const currentDeals = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        or(eq(deals.status, 'negotiation'), eq(deals.status, 'pending'), eq(deals.status, 'due_diligence'), eq(deals.status, 'under_contract'))
      ));
    const dealsInPipeline = Number(currentDeals[0]?.count || 0);
    
    const totalLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), gte(leads.createdAt, startDate)));
    const totalLeads = Number(totalLeadsResult[0]?.count || 0);
    
    const convertedLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.status, 'closed'),
        gte(leads.updatedAt, startDate)
      ));
    const convertedLeads = Number(convertedLeadsResult[0]?.count || 0);
    const leadConversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;
    
    return {
      totalRevenue,
      revenueChange: Number(revenueChange.toFixed(1)),
      activeNotesValue: currentNotesValue,
      notesValueChange: 0,
      dealsInPipeline,
      dealsChange: 0,
      leadConversionRate: Number(leadConversionRate.toFixed(1)),
      conversionChange: 0,
    };
  }

  async getRevenueMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const { startDate, endDate } = dateRange;
    
    const paymentResults = await db.select({
      date: sql<string>`DATE(${payments.paymentDate})`,
      revenue: sum(payments.amount),
    })
      .from(payments)
      .where(and(
        eq(payments.organizationId, orgId),
        gte(payments.paymentDate, startDate),
        lte(payments.paymentDate, endDate)
      ))
      .groupBy(sql`DATE(${payments.paymentDate})`)
      .orderBy(sql`DATE(${payments.paymentDate})`);
    
    const revenueOverTime = paymentResults.map(r => ({
      date: r.date,
      revenue: Number(r.revenue || 0),
    }));
    
    const totalRevenue = revenueOverTime.reduce((sum, r) => sum + r.revenue, 0);
    
    const dealCount = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        eq(deals.status, 'closed'),
        gte(deals.closingDate, startDate)
      ));
    const avgDealSize = Number(dealCount[0]?.count || 0) > 0 
      ? totalRevenue / Number(dealCount[0].count) 
      : 0;
    
    return {
      revenueOverTime,
      totalRevenue,
      avgDealSize: Number(avgDealSize.toFixed(2)),
      projectedRevenue: totalRevenue * 1.1,
    };
  }

  async getLeadMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const { startDate, endDate } = dateRange;
    
    const allLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(eq(leads.organizationId, orgId));
    const totalLeads = Number(allLeadsResult[0]?.count || 0);
    
    const newLeadsResult = await db.select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        gte(leads.createdAt, startDate),
        lte(leads.createdAt, endDate)
      ));
    const newLeads = Number(newLeadsResult[0]?.count || 0);
    
    const convertedResult = await db.select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.status, 'closed')
      ));
    const convertedLeads = Number(convertedResult[0]?.count || 0);
    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;
    
    const sourceResults = await db.select({
      source: leads.source,
      count: count(),
    })
      .from(leads)
      .where(eq(leads.organizationId, orgId))
      .groupBy(leads.source);
    
    const leadsBySource = sourceResults.map(r => ({
      source: r.source || 'Unknown',
      count: Number(r.count),
    }));
    
    const statusResults = await db.select({
      status: leads.status,
      count: count(),
    })
      .from(leads)
      .where(eq(leads.organizationId, orgId))
      .groupBy(leads.status);
    
    const leadsByStatus = statusResults.map(r => ({
      status: r.status,
      count: Number(r.count),
    }));
    
    return {
      totalLeads,
      newLeads,
      convertedLeads,
      conversionRate: Number(conversionRate.toFixed(1)),
      leadsBySource,
      leadsByStatus,
    };
  }

  async getDealMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const allDealsResult = await db.select({ count: count() })
      .from(deals)
      .where(eq(deals.organizationId, orgId));
    const totalDeals = Number(allDealsResult[0]?.count || 0);
    
    const wonDealsResult = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        eq(deals.status, 'closed')
      ));
    const wonDeals = Number(wonDealsResult[0]?.count || 0);
    
    const lostDealsResult = await db.select({ count: count() })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        or(eq(deals.status, 'dead'), eq(deals.status, 'cancelled'))
      ));
    const lostDeals = Number(lostDealsResult[0]?.count || 0);
    
    const winRate = (wonDeals + lostDeals) > 0 ? (wonDeals / (wonDeals + lostDeals)) * 100 : 0;
    
    const stageResults = await db.select({
      stage: deals.status,
      count: count(),
      value: sum(deals.acceptedAmount),
    })
      .from(deals)
      .where(eq(deals.organizationId, orgId))
      .groupBy(deals.status);
    
    const dealsByStage = stageResults.map(r => ({
      stage: r.stage,
      count: Number(r.count),
      value: Number(r.value || 0),
    }));
    
    const totalValue = dealsByStage.reduce((sum, s) => sum + s.value, 0);
    const avgDealValue = totalDeals > 0 ? totalValue / totalDeals : 0;
    
    return {
      totalDeals,
      wonDeals,
      lostDeals,
      winRate: Number(winRate.toFixed(1)),
      dealsByStage,
      avgDealValue: Number(avgDealValue.toFixed(2)),
    };
  }

  async getCampaignMetrics(orgId: number, dateRange: { startDate: Date; endDate: Date }) {
    const allCampaigns = await db.select()
      .from(campaigns)
      .where(eq(campaigns.organizationId, orgId));
    
    const campaignData = allCampaigns.map(c => ({
      id: c.id,
      name: c.name,
      sent: c.totalSent || 0,
      responses: c.totalResponded || 0,
      responseRate: (c.totalSent && c.totalSent > 0)
        ? Number((((c.totalResponded || 0) / c.totalSent) * 100).toFixed(1))
        : 0,
      roi: 0,
    }));
    
    const totalSent = campaignData.reduce((sum, c) => sum + c.sent, 0);
    const totalResponses = campaignData.reduce((sum, c) => sum + c.responses, 0);
    const avgResponseRate = totalSent > 0 ? (totalResponses / totalSent) * 100 : 0;
    
    return {
      campaigns: campaignData,
      totalSent,
      totalResponses,
      avgResponseRate: Number(avgResponseRate.toFixed(1)),
    };
  }

  async getDealVelocity(orgId: number, _dateRange: { startDate: Date; endDate: Date }) {
    // Truth-immutable: report only what the data supports. We have
    // created_at and closing_date on closed deals, so the total
    // create→close cycle time is real. Per-stage durations are NOT
    // tracked (no stage-history table), so we return an empty per-stage
    // breakdown and no fabricated bottleneck rather than random numbers.
    const closedDeals = await db.select({
      createdAt: deals.createdAt,
      closingDate: deals.closingDate,
    })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        eq(deals.status, 'closed')
      ));

    const cycleDays = closedDeals
      .map((d) => {
        if (!d.createdAt || !d.closingDate) return null;
        const ms = new Date(d.closingDate).getTime() - new Date(d.createdAt).getTime();
        return ms >= 0 ? ms / 86_400_000 : null;
      })
      .filter((v): v is number => v !== null);

    const avgTotalDays = cycleDays.length > 0
      ? Math.round(cycleDays.reduce((sum, v) => sum + v, 0) / cycleDays.length)
      : 0;

    return {
      // Per-stage durations are not yet tracked — honest empty, not random.
      avgDaysPerStage: [] as { stage: string; avgDays: number }[],
      avgTotalDays,
      bottleneckStage: null as string | null,
      // Sample size so the client can show "not enough history yet".
      sampleSize: cycleDays.length,
    };
  }

  async getPipelineValue(orgId: number) {
    const stageResults = await db.select({
      stage: deals.status,
      value: sum(deals.acceptedAmount),
      count: count(),
    })
      .from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        or(
          eq(deals.status, 'negotiation'),
          eq(deals.status, 'pending'),
          eq(deals.status, 'due_diligence'),
          eq(deals.status, 'under_contract')
        )
      ))
      .groupBy(deals.status);
    
    const stageValues = stageResults.map(r => ({
      stage: r.stage,
      value: Number(r.value || 0),
      count: Number(r.count),
    }));
    
    const totalValue = stageValues.reduce((sum, s) => sum + s.value, 0);
    
    return {
      stageValues,
      totalValue,
    };
  }

  async getConversionRates(orgId: number, _dateRange: { startDate: Date; endDate: Date }) {
    // Truth-immutable: the overall win rate is computable from real
    // won/lost counts. Per-stage conversion rates and categorized loss
    // reasons are NOT tracked, so we return honest-empty for those rather
    // than fabricating per-stage rates or invented loss-reason tallies.
    const wonDeals = await db.select({ count: count() })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), eq(deals.status, 'closed')));
    const lostDeals = await db.select({ count: count() })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), or(eq(deals.status, 'dead'), eq(deals.status, 'cancelled'))));

    const won = Number(wonDeals[0]?.count || 0);
    const lost = Number(lostDeals[0]?.count || 0);
    const overallWinRate = (won + lost) > 0 ? (won / (won + lost)) * 100 : 0;

    return {
      // Per-stage conversion requires a stage-history table we don't have.
      stageConversions: [] as { fromStage: string; toStage: string; rate: number }[],
      overallWinRate: Number(overallWinRate.toFixed(1)),
      // Loss reasons are not captured as structured data — honest empty.
      lossReasons: [] as { reason: string; count: number }[],
      sampleSize: won + lost,
    };
  }

  // Automation + workflow data layer (automation rules + executions /
  // enhanced tasks / notifications / activity feed / job cursors)
  // extracted to server/storage/automationRepo.ts (mixed into the
  // prototype below).

  // Mail + messaging data layer (email sender identities / unified inbox /
  // mail sender identities / mailing orders + pieces) extracted to
  // server/storage/mailRepo.ts (mixed into the prototype below).


  // Feature Requests
  async getFeatureRequests(organizationId?: number): Promise<FeatureRequest[]> {
    if (organizationId !== undefined) {
      return await db.select()
        .from(featureRequests)
        .where(eq(featureRequests.organizationId, organizationId))
        .orderBy(desc(featureRequests.createdAt));
    }
    return await db.select()
      .from(featureRequests)
      .orderBy(desc(featureRequests.createdAt));
  }

  async createFeatureRequest(request: InsertFeatureRequest): Promise<FeatureRequest> {
    const [newRequest] = await db.insert(featureRequests)
      .values(request)
      .returning();
    return newRequest;
  }

  async updateFeatureRequest(id: number, updates: Partial<FeatureRequest>, organizationId?: number): Promise<FeatureRequest> {
    const conditions = [eq(featureRequests.id, id)];
    if (organizationId) conditions.push(eq(featureRequests.organizationId, organizationId));
    const [updated] = await db.update(featureRequests)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async getAllFeatureRequestsForFounder(): Promise<FeatureRequest[]> {
    return await db.select()
      .from(featureRequests)
      .orderBy(desc(featureRequests.createdAt));
  }

  // API Usage Logs
  async logApiUsage(log: InsertApiUsageLog): Promise<void> {
    await db.insert(apiUsageLogs).values(log);
  }

  async getApiUsageStats(startDate?: Date, endDate?: Date): Promise<{
    totalCostCents: number;
    byService: {
      lob: { count: number; costCents: number };
      regrid: { count: number; costCents: number };
      openai: { count: number; costCents: number };
    };
    recentUsage: Array<{ date: string; costCents: number }>;
  }> {
    const now = new Date();
    const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate || now;
    
    const conditions = [
      gte(apiUsageLogs.createdAt, start),
      lte(apiUsageLogs.createdAt, end),
    ];
    
    const logs = await db.select()
      .from(apiUsageLogs)
      .where(and(...conditions));
    
    const byService = {
      lob: { count: 0, costCents: 0 },
      regrid: { count: 0, costCents: 0 },
      openai: { count: 0, costCents: 0 },
    };
    
    let totalCostCents = 0;
    
    for (const log of logs) {
      const costCents = log.estimatedCostCents || 0;
      const logCount = log.count || 1;
      totalCostCents += costCents;
      
      if (log.service === 'lob') {
        byService.lob.count += logCount;
        byService.lob.costCents += costCents;
      } else if (log.service === 'regrid') {
        byService.regrid.count += logCount;
        byService.regrid.costCents += costCents;
      } else if (log.service === 'openai') {
        byService.openai.count += logCount;
        byService.openai.costCents += costCents;
      }
    }
    
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentLogs = await db.select()
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, sevenDaysAgo));
    
    const dailyCosts: Record<string, number> = {};
    for (const log of recentLogs) {
      if (log.createdAt) {
        const dateStr = log.createdAt.toISOString().split('T')[0];
        dailyCosts[dateStr] = (dailyCosts[dateStr] || 0) + (log.estimatedCostCents || 0);
      }
    }
    
    const recentUsage: Array<{ date: string; costCents: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      recentUsage.push({ date: dateStr, costCents: dailyCosts[dateStr] || 0 });
    }
    
    return { totalCostCents, byService, recentUsage };
  }

  // Agent Runs (background agent status tracking)
  async getAgentStatuses(): Promise<AgentRun[]> {
    return await db.select().from(agentRuns).orderBy(agentRuns.agentName);
  }

  async updateAgentStatus(agentName: string, updates: Partial<AgentRun>): Promise<AgentRun> {
    const [existing] = await db.select().from(agentRuns).where(eq(agentRuns.agentName, agentName));
    
    if (existing) {
      const [updated] = await db.update(agentRuns)
        .set(updates)
        .where(eq(agentRuns.agentName, agentName))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(agentRuns)
        .values({ agentName, ...updates })
        .returning();
      return created;
    }
  }

  // Borrower Sessions
  async createBorrowerSession(data: InsertBorrowerSession): Promise<BorrowerSession> {
    const [session] = await db.insert(borrowerSessions).values(data).returning();
    return session;
  }

  async getBorrowerSession(token: string): Promise<BorrowerSession | undefined> {
    const [session] = await db.select()
      .from(borrowerSessions)
      .where(eq(borrowerSessions.sessionToken, token));
    return session;
  }

  async updateBorrowerSessionAccess(token: string): Promise<BorrowerSession | undefined> {
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    const [updated] = await db.update(borrowerSessions)
      .set({ 
        lastAccessedAt: now,
        expiresAt: newExpiresAt, // Sliding expiration
      })
      .where(eq(borrowerSessions.sessionToken, token))
      .returning();
    return updated;
  }

  async deleteBorrowerSession(token: string): Promise<void> {
    await db.delete(borrowerSessions)
      .where(eq(borrowerSessions.sessionToken, token));
  }

  async cleanExpiredBorrowerSessions(): Promise<number> {
    const now = new Date();
    const result = await db.delete(borrowerSessions)
      .where(lt(borrowerSessions.expiresAt, now))
      .returning();
    return result.length;
  }

  // Job Locks (prevent duplicate execution in multi-instance deployment)
  //
  // 2026-06-05 Iris reliability audit fix: the previous implementation read
  // the existing row, branched on its expiresAt, then issued an UPDATE
  // without a guard — two workers racing past expiration both saw the same
  // expired row and both UPDATE'd, both returning true, both running the
  // job. Could double-fire paid AI work. Rewritten as a single atomic
  // UPSERT-with-conditional-WHERE: the UPDATE only succeeds for callers
  // that either own the lock OR find it expired, and we trust the
  // 0-vs-non-0 rowcount as the acquire signal.
  async acquireJobLock(jobName: string, instanceId: string, ttlSeconds: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    try {
      // Atomic conditional UPDATE: succeeds only if (lock expired OR we
      // already own it). Returns 1 row on win, 0 rows otherwise. Drizzle
      // exposes .returning() to detect that.
      const updated = await db
        .update(jobLocks)
        .set({ lockedBy: instanceId, lockedAt: now, expiresAt })
        .where(
          and(
            eq(jobLocks.jobName, jobName),
            or(
              lt(jobLocks.expiresAt, now),
              eq(jobLocks.lockedBy, instanceId),
            ),
          ),
        )
        .returning({ id: jobLocks.id });
      if (updated.length > 0) return true;

      // No existing row matched. Try to insert a fresh row.
      try {
        await db.insert(jobLocks).values({
          jobName,
          lockedBy: instanceId,
          expiresAt,
        });
        return true;
      } catch (err: any) {
        // 23505 = unique violation → they own the lock. drizzle wraps the pg
        // error, so the code may live on err.cause (WS5 drill, 2026-07-08).
        if (err?.code === "23505" || err?.cause?.code === "23505") return false;
        throw err;
      }
    } catch (error: any) {
      if (error?.code === "23505" || error?.cause?.code === "23505") return false;
      throw error;
    }
  }

  async releaseJobLock(jobName: string, instanceId: string): Promise<void> {
    await db.delete(jobLocks)
      .where(and(
        eq(jobLocks.jobName, jobName),
        eq(jobLocks.lockedBy, instanceId)
      ));
  }

  async cleanExpiredJobLocks(): Promise<void> {
    const now = new Date();
    await db.delete(jobLocks).where(lt(jobLocks.expiresAt, now));
  }

  // County GIS Endpoints
  async getCountyGisEndpoint(id: number): Promise<any> {
    const { countyGisEndpoints } = await import('@shared/schema');
    const [endpoint] = await db.select().from(countyGisEndpoints).where(eq(countyGisEndpoints.id, id));
    return endpoint;
  }

  async updateCountyGisEndpoint(id: number, updates: { isVerified?: boolean; errorCount?: number; lastVerified?: Date; isActive?: boolean; lastError?: string | null }): Promise<any> {
    const { countyGisEndpoints } = await import('@shared/schema');
    const [updated] = await db.update(countyGisEndpoints)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(countyGisEndpoints.id, id))
      .returning();
    return updated;
  }

  async bulkCreateCountyGisEndpoints(endpoints: Array<{ state: string; county: string; baseUrl: string; endpointType: string; fipsCode?: string | null; confidenceScore?: number }>): Promise<{ added: number; skipped: number }> {
    const { countyGisEndpoints } = await import('@shared/schema');
    // SSRF guard (Beatrice item 5): these baseUrls are auto-contributed by the
    // discovery scan and fetched server-side. Skip private/loopback/non-https.
    const { checkOperatorUrl } = await import('./services/providers/ssrf-guard');
    let added = 0;
    let skipped = 0;

    const existing = await db.select({ state: countyGisEndpoints.state, county: countyGisEndpoints.county, baseUrl: countyGisEndpoints.baseUrl }).from(countyGisEndpoints);
    const existingSet = new Set(existing.map(e => `${e.state.toUpperCase()}|${e.county.toLowerCase()}|${e.baseUrl.toLowerCase()}`));

    for (const ep of endpoints) {
      const key = `${ep.state.toUpperCase()}|${ep.county.toLowerCase()}|${ep.baseUrl.toLowerCase()}`;
      if (existingSet.has(key)) {
        skipped++;
        continue;
      }

      if (!checkOperatorUrl(ep.baseUrl).ok) {
        skipped++;
        continue;
      }

      try {
        await db.insert(countyGisEndpoints).values({
          state: ep.state.toUpperCase(),
          county: ep.county,
          baseUrl: ep.baseUrl,
          endpointType: ep.endpointType || "arcgis_rest",
          fipsCode: ep.fipsCode || null,
          isActive: true,
          isVerified: false,
          contributedBy: "scan",
          notes: ep.confidenceScore ? `Confidence: ${ep.confidenceScore}%` : undefined,
        });
        added++;
        existingSet.add(key);
      } catch (err: any) {
        if (err.code === '23505') {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    return { added, skipped };
  }

  // Data Sources (Free Data Endpoint Registry)
  async getDataSources(filters?: { category?: string; isEnabled?: boolean }): Promise<DataSource[]> {
    let query = db.select().from(dataSources);
    const conditions: any[] = [];
    
    if (filters?.category) {
      conditions.push(eq(dataSources.category, filters.category));
    }
    if (filters?.isEnabled !== undefined) {
      conditions.push(eq(dataSources.isEnabled, filters.isEnabled));
    }
    
    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(dataSources.priority, dataSources.title);
    }
    return await query.orderBy(dataSources.priority, dataSources.title);
  }

  async getDataSource(id: number): Promise<DataSource | undefined> {
    const [source] = await db.select().from(dataSources).where(eq(dataSources.id, id));
    return source;
  }

  async getDataSourceByKey(key: string): Promise<DataSource | undefined> {
    const [source] = await db.select().from(dataSources).where(eq(dataSources.key, key));
    return source;
  }

  async createDataSource(data: InsertDataSource): Promise<DataSource> {
    const [created] = await db.insert(dataSources).values(data).returning();
    return created;
  }

  async updateDataSource(id: number, updates: Partial<InsertDataSource>): Promise<DataSource> {
    const [updated] = await db.update(dataSources)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dataSources.id, id))
      .returning();
    return updated;
  }

  async deleteDataSource(id: number): Promise<void> {
    await db.delete(dataSources).where(eq(dataSources.id, id));
  }

  async getDataSourceStats(): Promise<{ total: number; enabled: number; verified: number; byCategory: Record<string, number> }> {
    const sources = await db.select().from(dataSources);
    const byCategory: Record<string, number> = {};
    let enabled = 0;
    let verified = 0;
    
    for (const source of sources) {
      byCategory[source.category] = (byCategory[source.category] || 0) + 1;
      if (source.isEnabled) enabled++;
      if (source.isVerified) verified++;
    }
    
    return { total: sources.length, enabled, verified, byCategory };
  }

  // Data Source Cache
  async getDataSourceCacheEntry(lookupKey: string, dataSourceId?: number): Promise<DataSourceCache | undefined> {
    const conditions = [eq(dataSourceCache.lookupKey, lookupKey)];
    if (dataSourceId !== undefined) {
      conditions.push(eq(dataSourceCache.dataSourceId, dataSourceId));
    }
    
    const [entry] = await db.select()
      .from(dataSourceCache)
      .where(and(...conditions))
      .orderBy(desc(dataSourceCache.fetchedAt));
    return entry;
  }

  async createDataSourceCacheEntry(data: InsertDataSourceCache): Promise<DataSourceCache> {
    const [created] = await db.insert(dataSourceCache).values(data).returning();
    return created;
  }

  async invalidateDataSourceCache(dataSourceId: number): Promise<void> {
    await db.delete(dataSourceCache).where(eq(dataSourceCache.dataSourceId, dataSourceId));
  }

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
  // DISCOVERED ENDPOINTS (Live GIS Discovery)
  // ============================================

  async createDiscoveredEndpoint(data: InsertDiscoveredEndpoint): Promise<DiscoveredEndpoint> {
    const [created] = await db.insert(discoveredEndpoints).values(data).returning();
    return created;
  }

  async getDiscoveredEndpoints(filters?: { status?: string; state?: string }): Promise<DiscoveredEndpoint[]> {
    const conditions: any[] = [];
    
    if (filters?.status) {
      conditions.push(eq(discoveredEndpoints.status, filters.status));
    }
    if (filters?.state) {
      conditions.push(eq(discoveredEndpoints.state, filters.state.toUpperCase()));
    }
    
    if (conditions.length > 0) {
      return await db.select()
        .from(discoveredEndpoints)
        .where(and(...conditions))
        .orderBy(desc(discoveredEndpoints.discoveryDate));
    }
    return await db.select()
      .from(discoveredEndpoints)
      .orderBy(desc(discoveredEndpoints.discoveryDate));
  }

  async getDiscoveredEndpoint(id: number): Promise<DiscoveredEndpoint | undefined> {
    const [endpoint] = await db.select().from(discoveredEndpoints).where(eq(discoveredEndpoints.id, id));
    return endpoint;
  }

  async updateDiscoveredEndpoint(id: number, updates: Partial<InsertDiscoveredEndpoint>): Promise<DiscoveredEndpoint> {
    const [updated] = await db.update(discoveredEndpoints)
      .set(updates)
      .where(eq(discoveredEndpoints.id, id))
      .returning();
    return updated;
  }

  async bulkCreateDiscoveredEndpoints(endpoints: Array<InsertDiscoveredEndpoint>): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;

    const existing = await db.select({ 
      state: discoveredEndpoints.state, 
      county: discoveredEndpoints.county, 
      baseUrl: discoveredEndpoints.baseUrl 
    }).from(discoveredEndpoints);
    const existingSet = new Set(existing.map(e => `${e.state.toUpperCase()}|${e.county.toLowerCase()}|${e.baseUrl.toLowerCase()}`));

    const { countyGisEndpoints } = await import('@shared/schema');
    const existingGis = await db.select({ 
      state: countyGisEndpoints.state, 
      county: countyGisEndpoints.county, 
      baseUrl: countyGisEndpoints.baseUrl 
    }).from(countyGisEndpoints);
    const gisSet = new Set(existingGis.map(e => `${e.state.toUpperCase()}|${e.county.toLowerCase()}|${e.baseUrl.toLowerCase()}`));

    for (const ep of endpoints) {
      const key = `${ep.state.toUpperCase()}|${ep.county.toLowerCase()}|${ep.baseUrl.toLowerCase()}`;
      if (existingSet.has(key) || gisSet.has(key)) {
        skipped++;
        continue;
      }

      try {
        await db.insert(discoveredEndpoints).values({
          ...ep,
          state: ep.state.toUpperCase(),
        });
        added++;
        existingSet.add(key);
      } catch (err: any) {
        if (err.code === '23505') {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    return { added, skipped };
  }

  async approveDiscoveredEndpoint(id: number): Promise<{ success: boolean; message: string }> {
    const endpoint = await this.getDiscoveredEndpoint(id);
    if (!endpoint) {
      return { success: false, message: "Endpoint not found" };
    }

    if (endpoint.status === "added") {
      return { success: false, message: "Endpoint already added" };
    }

    const { countyGisEndpoints } = await import('@shared/schema');
    
    const [existingGis] = await db.select()
      .from(countyGisEndpoints)
      .where(and(
        eq(countyGisEndpoints.state, endpoint.state),
        sql`LOWER(${countyGisEndpoints.county}) = LOWER(${endpoint.county})`,
        sql`LOWER(${countyGisEndpoints.baseUrl}) = LOWER(${endpoint.baseUrl})`
      ));

    if (existingGis) {
      await this.updateDiscoveredEndpoint(id, { status: "added" });
      return { success: false, message: "Endpoint already exists in GIS registry" };
    }

    await db.insert(countyGisEndpoints).values({
      state: endpoint.state,
      county: endpoint.county,
      baseUrl: endpoint.baseUrl,
      endpointType: endpoint.endpointType,
      isActive: true,
      isVerified: endpoint.healthCheckPassed || false,
      contributedBy: "discovery",
      notes: endpoint.serviceName ? `Service: ${endpoint.serviceName}` : undefined,
    });

    await this.updateDiscoveredEndpoint(id, { status: "added" });
    return { success: true, message: "Endpoint added to GIS registry" };
  }

  async rejectDiscoveredEndpoint(id: number): Promise<DiscoveredEndpoint> {
    return await this.updateDiscoveredEndpoint(id, { status: "rejected" });
  }

  // Parcel Snapshots (Cache)
  async getParcelSnapshot(apn: string, state: string, county: string, maxAgeDays: number = 30): Promise<ParcelSnapshot | undefined> {
    const normalizedApn = apn.replace(/[-\s]/g, "").toLowerCase();
    const normalizedState = state.toUpperCase();
    const normalizedCounty = county.toLowerCase().replace(/ county$/i, "").trim();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    const [snapshot] = await db
      .select()
      .from(parcelSnapshots)
      .where(
        and(
          sql`LOWER(REPLACE(REPLACE(${parcelSnapshots.apn}, '-', ''), ' ', '')) = ${normalizedApn}`,
          eq(parcelSnapshots.state, normalizedState),
          sql`LOWER(REPLACE(${parcelSnapshots.county}, ' County', '')) = ${normalizedCounty}`,
          gte(parcelSnapshots.fetchedAt, cutoffDate)
        )
      )
      .orderBy(desc(parcelSnapshots.fetchedAt))
      .limit(1);
    
    return snapshot;
  }

  async upsertParcelSnapshot(data: InsertParcelSnapshot): Promise<ParcelSnapshot> {
    const normalizedApn = data.apn.replace(/[-\s]/g, "");
    const normalizedState = data.state.toUpperCase();
    const normalizedCounty = data.county.toLowerCase().replace(/ county$/i, "").trim();
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    const [existing] = await db
      .select()
      .from(parcelSnapshots)
      .where(
        and(
          sql`LOWER(REPLACE(REPLACE(${parcelSnapshots.apn}, '-', ''), ' ', '')) = ${normalizedApn.toLowerCase()}`,
          eq(parcelSnapshots.state, normalizedState),
          sql`LOWER(REPLACE(${parcelSnapshots.county}, ' County', '')) = ${normalizedCounty}`
        )
      )
      .limit(1);
    
    if (existing) {
      const [updated] = await db
        .update(parcelSnapshots)
        .set({
          ...data,
          state: normalizedState,
          fetchedAt: new Date(),
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(parcelSnapshots.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(parcelSnapshots)
        .values({
          ...data,
          state: normalizedState,
          fetchedAt: new Date(),
          expiresAt,
        })
        .returning();
      return created;
    }
  }

  // Agent Memory
  async createAgentMemory(memory: InsertAgentMemory): Promise<AgentMemory> {
    const [created] = await db.insert(agentMemory).values(memory).returning();
    return created;
  }

  async getAgentMemories(orgId: number, agentType?: string, limit: number = 50): Promise<AgentMemory[]> {
    let query = db.select().from(agentMemory).where(eq(agentMemory.organizationId, orgId));
    if (agentType) {
      query = db.select().from(agentMemory).where(
        and(eq(agentMemory.organizationId, orgId), eq(agentMemory.agentType, agentType))
      );
    }
    return await query.orderBy(desc(agentMemory.usageCount)).limit(limit);
  }

  async updateAgentMemoryUsage(id: number, organizationId?: number): Promise<AgentMemory> {
    const conditions = [eq(agentMemory.id, id)];
    if (organizationId) conditions.push(eq(agentMemory.organizationId, organizationId));
    const [updated] = await db.update(agentMemory)
      .set({
        usageCount: sql`${agentMemory.usageCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async deleteAgentMemory(id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(agentMemory.id, id)];
    if (organizationId) conditions.push(eq(agentMemory.organizationId, organizationId));
    await db.delete(agentMemory).where(and(...conditions));
  }

  // Agent Feedback
  async createAgentFeedback(feedback: InsertAgentFeedback): Promise<AgentFeedback> {
    const [created] = await db.insert(agentFeedback).values(feedback).returning();
    return created;
  }

  async getAgentFeedbackStats(orgId: number, agentType?: string): Promise<{
    totalFeedback: number;
    averageRating: number;
    helpfulCount: number;
    unhelpfulCount: number;
    byRating: { rating: number; count: number }[];
  }> {
    let feedbackQuery = db.select().from(agentFeedback)
      .innerJoin(agentTasks, eq(agentFeedback.agentTaskId, agentTasks.id))
      .where(eq(agentFeedback.organizationId, orgId));

    if (agentType) {
      feedbackQuery = db.select().from(agentFeedback)
        .innerJoin(agentTasks, eq(agentFeedback.agentTaskId, agentTasks.id))
        .where(and(
          eq(agentFeedback.organizationId, orgId),
          eq(agentTasks.agentType, agentType)
        ));
    }

    const feedbackList = await feedbackQuery;
    
    const totalFeedback = feedbackList.length;
    const avgRating = totalFeedback > 0 
      ? feedbackList.reduce((sum, f) => sum + f.agent_feedback.rating, 0) / totalFeedback 
      : 0;
    const helpfulCount = feedbackList.filter(f => f.agent_feedback.helpful).length;
    const unhelpfulCount = totalFeedback - helpfulCount;

    const ratingCounts = [1, 2, 3, 4, 5].map(rating => ({
      rating,
      count: feedbackList.filter(f => f.agent_feedback.rating === rating).length
    }));

    return {
      totalFeedback,
      averageRating: Number(avgRating.toFixed(2)),
      helpfulCount,
      unhelpfulCount,
      byRating: ratingCounts,
    };
  }

  async getAgentFeedbackByTask(taskId: number): Promise<AgentFeedback | undefined> {
    const [feedback] = await db.select().from(agentFeedback).where(eq(agentFeedback.agentTaskId, taskId));
    return feedback;
  }

  // Workflows
  async getWorkflows(orgId: number): Promise<Workflow[]> {
    return await db.select().from(workflows)
      .where(eq(workflows.organizationId, orgId))
      .orderBy(desc(workflows.createdAt));
  }

  async getWorkflow(orgId: number, id: number): Promise<Workflow | undefined> {
    const [workflow] = await db.select().from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.organizationId, orgId)));
    return workflow;
  }

  async getActiveWorkflowsByTrigger(orgId: number, event: string): Promise<Workflow[]> {
    const allWorkflows = await db.select().from(workflows)
      .where(and(
        eq(workflows.organizationId, orgId),
        eq(workflows.isActive, true)
      ));
    return allWorkflows.filter(w => w.trigger?.event === event);
  }

  async createWorkflow(workflow: InsertWorkflow): Promise<Workflow> {
    const [created] = await db.insert(workflows).values(workflow).returning();
    return created;
  }

  async updateWorkflow(id: number, updates: Partial<InsertWorkflow>, organizationId?: number): Promise<Workflow> {
    const conditions = [eq(workflows.id, id)];
    if (organizationId) conditions.push(eq(workflows.organizationId, organizationId));
    const [updated] = await db.update(workflows)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async deleteWorkflow(id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(workflows.id, id)];
    if (organizationId) conditions.push(eq(workflows.organizationId, organizationId));
    await db.delete(workflows).where(and(...conditions));
  }

  async toggleWorkflow(orgId: number, id: number, isActive: boolean): Promise<Workflow> {
    const [updated] = await db.update(workflows)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(workflows.id, id), eq(workflows.organizationId, orgId)))
      .returning();
    return updated;
  }

  // Workflow Runs
  async getWorkflowRuns(workflowId: number, limit: number = 50): Promise<WorkflowRun[]> {
    return await db.select().from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(limit);
  }

  async getWorkflowRun(id: number): Promise<WorkflowRun | undefined> {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    return run;
  }

  async createWorkflowRun(run: InsertWorkflowRun): Promise<WorkflowRun> {
    const [created] = await db.insert(workflowRuns).values(run as any).returning();
    return created;
  }

  async updateWorkflowRun(id: number, updates: Partial<InsertWorkflowRun>): Promise<WorkflowRun> {
    const [updated] = await db.update(workflowRuns)
      .set(updates as any)
      .where(eq(workflowRuns.id, id))
      .returning();
    return updated;
  }

  // Scheduled Tasks CRUD
  async getScheduledTasks(orgId: number): Promise<ScheduledTask[]> {
    return await db.select().from(scheduledTasks)
      .where(eq(scheduledTasks.organizationId, orgId))
      .orderBy(desc(scheduledTasks.createdAt));
  }

  async getScheduledTask(id: number): Promise<ScheduledTask | undefined> {
    const [task] = await db.select().from(scheduledTasks)
      .where(eq(scheduledTasks.id, id));
    return task;
  }

  async getScheduledTaskByOrg(orgId: number, id: number): Promise<ScheduledTask | undefined> {
    const [task] = await db.select().from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.organizationId, orgId)));
    return task;
  }

  async getDueScheduledTasks(now: Date): Promise<ScheduledTask[]> {
    return await db.select().from(scheduledTasks)
      .where(and(
        eq(scheduledTasks.status, "active"),
        lte(scheduledTasks.nextRunAt, now)
      ))
      .orderBy(scheduledTasks.nextRunAt);
  }

  async createScheduledTask(task: InsertScheduledTask): Promise<ScheduledTask> {
    const [created] = await db.insert(scheduledTasks).values(task as any).returning();
    return created;
  }

  async updateScheduledTask(id: number, updates: Partial<InsertScheduledTask>, organizationId?: number): Promise<ScheduledTask | undefined> {
    const conditions = [eq(scheduledTasks.id, id)];
    if (organizationId) conditions.push(eq(scheduledTasks.organizationId, organizationId));
    const [updated] = await db.update(scheduledTasks)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async deleteScheduledTask(id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(scheduledTasks.id, id)];
    if (organizationId) conditions.push(eq(scheduledTasks.organizationId, organizationId));
    await db.delete(scheduledTasks).where(and(...conditions));
  }

  // ============================================
  // VA REPLACEMENT ENGINE TABLES
  // ============================================

  // Marketing Lists
  async getMarketingLists(orgId: number): Promise<MarketingList[]> {
    return await db.select().from(marketingLists)
      .where(eq(marketingLists.organizationId, orgId))
      .orderBy(desc(marketingLists.createdAt));
  }

  async getMarketingListById(orgId: number, id: number): Promise<MarketingList | undefined> {
    const [list] = await db.select().from(marketingLists).where(and(eq(marketingLists.id, id), eq(marketingLists.organizationId, orgId)));
    return list;
  }

  async createMarketingList(data: InsertMarketingList): Promise<MarketingList> {
    const [created] = await db.insert(marketingLists).values(data).returning();
    return created;
  }

  async updateMarketingList(orgId: number, id: number, updates: Partial<InsertMarketingList>): Promise<MarketingList> {
    const [updated] = await db.update(marketingLists)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(marketingLists.id, id), eq(marketingLists.organizationId, orgId)))
      .returning();
    return updated;
  }

  async deleteMarketingList(orgId: number, id: number): Promise<void> {
    await db.delete(marketingLists).where(and(eq(marketingLists.id, id), eq(marketingLists.organizationId, orgId)));
  }

  // Offer Batches
  async getOfferBatches(orgId: number): Promise<OfferBatch[]> {
    return await db.select().from(offerBatches)
      .where(eq(offerBatches.organizationId, orgId))
      .orderBy(desc(offerBatches.createdAt));
  }

  async getOfferBatchById(orgId: number, id: number): Promise<OfferBatch | undefined> {
    const [batch] = await db.select().from(offerBatches).where(and(eq(offerBatches.id, id), eq(offerBatches.organizationId, orgId)));
    return batch;
  }

  async createOfferBatch(data: InsertOfferBatch): Promise<OfferBatch> {
    const [created] = await db.insert(offerBatches).values(data).returning();
    return created;
  }

  async updateOfferBatch(orgId: number, id: number, updates: Partial<InsertOfferBatch>): Promise<OfferBatch> {
    const [updated] = await db.update(offerBatches)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(offerBatches.id, id), eq(offerBatches.organizationId, orgId)))
      .returning();
    return updated;
  }

  async deleteOfferBatch(orgId: number, id: number): Promise<void> {
    await db.delete(offerBatches).where(and(eq(offerBatches.id, id), eq(offerBatches.organizationId, orgId)));
  }

  // Offers
  async getOffers(orgId: number): Promise<Offer[]> {
    return await db.select().from(offers)
      .where(eq(offers.organizationId, orgId))
      .orderBy(desc(offers.createdAt));
  }

  async getOfferById(orgId: number, id: number): Promise<Offer | undefined> {
    const [offer] = await db.select().from(offers).where(and(eq(offers.id, id), eq(offers.organizationId, orgId)));
    return offer;
  }

  async getOffersByBatch(orgId: number, batchId: number): Promise<Offer[]> {
    return await db.select().from(offers)
      .where(and(eq(offers.batchId, batchId), eq(offers.organizationId, orgId)))
      .orderBy(desc(offers.createdAt));
  }

  async createOffer(data: InsertOffer): Promise<Offer> {
    const [created] = await db.insert(offers).values(data).returning();
    return created;
  }

  async updateOffer(orgId: number, id: number, updates: Partial<InsertOffer>): Promise<Offer> {
    const [updated] = await db.update(offers)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(offers.id, id), eq(offers.organizationId, orgId)))
      .returning();
    return updated;
  }

  async deleteOffer(orgId: number, id: number): Promise<void> {
    await db.delete(offers).where(and(eq(offers.id, id), eq(offers.organizationId, orgId)));
  }

  // Seller Communications
  async getSellerCommunications(orgId: number): Promise<SellerCommunication[]> {
    return await db.select().from(sellerCommunications)
      .where(eq(sellerCommunications.organizationId, orgId))
      .orderBy(desc(sellerCommunications.createdAt));
  }

  async getSellerCommunicationById(orgId: number, id: number): Promise<SellerCommunication | undefined> {
    const [comm] = await db.select().from(sellerCommunications).where(and(eq(sellerCommunications.id, id), eq(sellerCommunications.organizationId, orgId)));
    return comm;
  }

  async getSellerCommunicationsByLead(leadId: number): Promise<SellerCommunication[]> {
    return await db.select().from(sellerCommunications)
      .where(eq(sellerCommunications.leadId, leadId))
      .orderBy(desc(sellerCommunications.createdAt));
  }

  async createSellerCommunication(data: InsertSellerCommunication): Promise<SellerCommunication> {
    const [created] = await db.insert(sellerCommunications).values(data).returning();
    return created;
  }

  async updateSellerCommunication(id: number, updates: Partial<InsertSellerCommunication>, organizationId?: number): Promise<SellerCommunication> {
    const conditions = [eq(sellerCommunications.id, id)];
    if (organizationId) conditions.push(eq(sellerCommunications.organizationId, organizationId));
    const [updated] = await db.update(sellerCommunications)
      .set(updates)
      .where(and(...conditions))
      .returning();
    return updated;
  }

  // Ad Postings
  async getAdPostings(orgId: number): Promise<AdPosting[]> {
    return await db.select().from(adPostings)
      .where(eq(adPostings.organizationId, orgId))
      .orderBy(desc(adPostings.createdAt));
  }

  async getAdPostingById(orgId: number, id: number): Promise<AdPosting | undefined> {
    const [posting] = await db.select().from(adPostings).where(and(eq(adPostings.id, id), eq(adPostings.organizationId, orgId)));
    return posting;
  }

  async getAdPostingsByProperty(propertyId: number): Promise<AdPosting[]> {
    return await db.select().from(adPostings)
      .where(eq(adPostings.propertyId, propertyId))
      .orderBy(desc(adPostings.createdAt));
  }

  async createAdPosting(data: InsertAdPosting): Promise<AdPosting> {
    const [created] = await db.insert(adPostings).values(data).returning();
    return created;
  }

  async updateAdPosting(orgId: number, id: number, updates: Partial<InsertAdPosting>): Promise<AdPosting> {
    const [updated] = await db.update(adPostings)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(adPostings.id, id), eq(adPostings.organizationId, orgId)))
      .returning();
    return updated;
  }

  async deleteAdPosting(orgId: number, id: number): Promise<void> {
    await db.delete(adPostings).where(and(eq(adPostings.id, id), eq(adPostings.organizationId, orgId)));
  }

  // Buyer Prequalifications
  async getBuyerPrequalifications(orgId: number): Promise<BuyerPrequalification[]> {
    return await db.select().from(buyerPrequalifications)
      .where(eq(buyerPrequalifications.organizationId, orgId))
      .orderBy(desc(buyerPrequalifications.createdAt));
  }

  async getBuyerPrequalificationById(orgId: number, id: number): Promise<BuyerPrequalification | undefined> {
    const [prequal] = await db.select().from(buyerPrequalifications).where(and(eq(buyerPrequalifications.id, id), eq(buyerPrequalifications.organizationId, orgId)));
    return prequal;
  }

  async getBuyerPrequalificationByLead(leadId: number): Promise<BuyerPrequalification | undefined> {
    const [prequal] = await db.select().from(buyerPrequalifications)
      .where(eq(buyerPrequalifications.leadId, leadId))
      .orderBy(desc(buyerPrequalifications.createdAt))
      .limit(1);
    return prequal;
  }

  async createBuyerPrequalification(data: InsertBuyerPrequalification): Promise<BuyerPrequalification> {
    const [created] = await db.insert(buyerPrequalifications).values(data).returning();
    return created;
  }

  async updateBuyerPrequalification(orgId: number, id: number, updates: Partial<InsertBuyerPrequalification>): Promise<BuyerPrequalification> {
    const [updated] = await db.update(buyerPrequalifications)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(buyerPrequalifications.id, id), eq(buyerPrequalifications.organizationId, orgId)))
      .returning();
    return updated;
  }

  async deleteBuyerPrequalification(orgId: number, id: number): Promise<void> {
    await db.delete(buyerPrequalifications).where(and(eq(buyerPrequalifications.id, id), eq(buyerPrequalifications.organizationId, orgId)));
  }

  // Collection Sequences
  async getCollectionSequences(orgId: number): Promise<CollectionSequence[]> {
    return await db.select().from(collectionSequences)
      .where(eq(collectionSequences.organizationId, orgId))
      .orderBy(desc(collectionSequences.createdAt));
  }

  async getCollectionSequenceById(orgId: number, id: number): Promise<CollectionSequence | undefined> {
    const [sequence] = await db.select().from(collectionSequences).where(and(eq(collectionSequences.id, id), eq(collectionSequences.organizationId, orgId)));
    return sequence;
  }

  async getActiveCollectionSequence(orgId: number): Promise<CollectionSequence | undefined> {
    const [sequence] = await db.select().from(collectionSequences)
      .where(and(
        eq(collectionSequences.organizationId, orgId),
        eq(collectionSequences.isActive, true),
        eq(collectionSequences.isDefault, true)
      ))
      .limit(1);
    if (sequence) return sequence;
    
    const [fallback] = await db.select().from(collectionSequences)
      .where(and(
        eq(collectionSequences.organizationId, orgId),
        eq(collectionSequences.isActive, true)
      ))
      .limit(1);
    return fallback;
  }

  async createCollectionSequence(data: InsertCollectionSequence): Promise<CollectionSequence> {
    const [created] = await db.insert(collectionSequences).values(data).returning();
    return created;
  }

  async updateCollectionSequence(orgId: number, id: number, updates: Partial<InsertCollectionSequence>): Promise<CollectionSequence> {
    const [updated] = await db.update(collectionSequences)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(collectionSequences.id, id), eq(collectionSequences.organizationId, orgId)))
      .returning();
    return updated;
  }

  async deleteCollectionSequence(orgId: number, id: number): Promise<void> {
    await db.delete(collectionSequences).where(and(eq(collectionSequences.id, id), eq(collectionSequences.organizationId, orgId)));
  }

  // Collection Enrollments
  async getCollectionEnrollments(orgId: number): Promise<CollectionEnrollment[]> {
    return await db.select().from(collectionEnrollments)
      .where(eq(collectionEnrollments.organizationId, orgId))
      .orderBy(desc(collectionEnrollments.createdAt));
  }

  async getCollectionEnrollmentById(orgId: number, id: number): Promise<CollectionEnrollment | undefined> {
    const [enrollment] = await db.select().from(collectionEnrollments).where(and(eq(collectionEnrollments.id, id), eq(collectionEnrollments.organizationId, orgId)));
    return enrollment;
  }

  async getCollectionEnrollmentsByNote(noteId: number): Promise<CollectionEnrollment[]> {
    return await db.select().from(collectionEnrollments)
      .where(eq(collectionEnrollments.noteId, noteId))
      .orderBy(desc(collectionEnrollments.createdAt));
  }

  async getCollectionEnrollmentsBySequence(sequenceId: number): Promise<CollectionEnrollment[]> {
    return await db.select().from(collectionEnrollments)
      .where(eq(collectionEnrollments.sequenceId, sequenceId))
      .orderBy(desc(collectionEnrollments.createdAt));
  }

  async createCollectionEnrollment(data: InsertCollectionEnrollment): Promise<CollectionEnrollment> {
    const [created] = await db.insert(collectionEnrollments).values(data).returning();
    return created;
  }

  async updateCollectionEnrollment(orgId: number, id: number, updates: Partial<InsertCollectionEnrollment>): Promise<CollectionEnrollment> {
    const [updated] = await db.update(collectionEnrollments)
      .set(updates)
      .where(and(eq(collectionEnrollments.id, id), eq(collectionEnrollments.organizationId, orgId)))
      .returning();
    return updated;
  }

  // County Research
  async getCountyResearchList(): Promise<CountyResearch[]> {
    return await db.select().from(countyResearch)
      .orderBy(countyResearch.state, countyResearch.county);
  }

  async getCountyResearchById(id: number): Promise<CountyResearch | undefined> {
    const [research] = await db.select().from(countyResearch).where(eq(countyResearch.id, id));
    return research;
  }

  async getCountyResearch(state: string, county: string): Promise<CountyResearch | undefined> {
    const [research] = await db.select().from(countyResearch)
      .where(and(
        sql`UPPER(${countyResearch.state}) = UPPER(${state})`,
        sql`LOWER(${countyResearch.county}) = LOWER(${county})`
      ))
      .limit(1);
    return research;
  }

  async createCountyResearch(data: InsertCountyResearch): Promise<CountyResearch> {
    const [created] = await db.insert(countyResearch).values(data).returning();
    return created;
  }

  async updateCountyResearch(id: number, updates: Partial<InsertCountyResearch>): Promise<CountyResearch> {
    const [updated] = await db.update(countyResearch)
      .set({ ...updates, lastUpdatedAt: new Date() })
      .where(eq(countyResearch.id, id))
      .returning();
    return updated;
  }

  // ============================================
  // PHASE 4: CLOSING & SERVICING AUTOMATION
  // ============================================

  // Buyer Reservations
  async getBuyerReservations(organizationId: number): Promise<BuyerReservation[]> {
    return await db.select().from(buyerReservations)
      .where(eq(buyerReservations.organizationId, organizationId))
      .orderBy(desc(buyerReservations.createdAt));
  }

  async getBuyerReservationById(organizationId: number, id: number): Promise<BuyerReservation | undefined> {
    const [reservation] = await db.select().from(buyerReservations)
      .where(and(eq(buyerReservations.id, id), eq(buyerReservations.organizationId, organizationId)));
    return reservation;
  }

  async getBuyerReservationsByProperty(organizationId: number, propertyId: number): Promise<BuyerReservation[]> {
    return await db.select().from(buyerReservations)
      .where(and(eq(buyerReservations.propertyId, propertyId), eq(buyerReservations.organizationId, organizationId)))
      .orderBy(desc(buyerReservations.createdAt));
  }

  async createBuyerReservation(data: InsertBuyerReservation): Promise<BuyerReservation> {
    const [created] = await db.insert(buyerReservations).values(data).returning();
    return created;
  }

  async updateBuyerReservation(organizationId: number, id: number, data: Partial<InsertBuyerReservation>): Promise<BuyerReservation | undefined> {
    const [updated] = await db.update(buyerReservations)
      .set(data)
      .where(and(eq(buyerReservations.id, id), eq(buyerReservations.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deleteBuyerReservation(organizationId: number, id: number): Promise<boolean> {
    const result = await db.delete(buyerReservations)
      .where(and(eq(buyerReservations.id, id), eq(buyerReservations.organizationId, organizationId)));
    return true;
  }

  // Escrow Checklists
  async getEscrowChecklists(organizationId: number): Promise<EscrowChecklist[]> {
    return await db.select().from(escrowChecklists)
      .where(eq(escrowChecklists.organizationId, organizationId))
      .orderBy(desc(escrowChecklists.createdAt));
  }

  async getEscrowChecklistById(organizationId: number, id: number): Promise<EscrowChecklist | undefined> {
    const [checklist] = await db.select().from(escrowChecklists)
      .where(and(eq(escrowChecklists.id, id), eq(escrowChecklists.organizationId, organizationId)));
    return checklist;
  }

  async getEscrowChecklistByDeal(organizationId: number, dealId: number): Promise<EscrowChecklist | undefined> {
    const [checklist] = await db.select().from(escrowChecklists)
      .where(and(eq(escrowChecklists.dealId, dealId), eq(escrowChecklists.organizationId, organizationId)))
      .limit(1);
    return checklist;
  }

  async createEscrowChecklist(data: InsertEscrowChecklist): Promise<EscrowChecklist> {
    const [created] = await db.insert(escrowChecklists).values(data).returning();
    return created;
  }

  async updateEscrowChecklist(organizationId: number, id: number, data: Partial<InsertEscrowChecklist>): Promise<EscrowChecklist | undefined> {
    const [updated] = await db.update(escrowChecklists)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(escrowChecklists.id, id), eq(escrowChecklists.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deleteEscrowChecklist(organizationId: number, id: number): Promise<boolean> {
    await db.delete(escrowChecklists)
      .where(and(eq(escrowChecklists.id, id), eq(escrowChecklists.organizationId, organizationId)));
    return true;
  }

  // Closing Packets
  async getClosingPackets(organizationId: number): Promise<ClosingPacket[]> {
    return await db.select().from(closingPackets)
      .where(eq(closingPackets.organizationId, organizationId))
      .orderBy(desc(closingPackets.createdAt));
  }

  async getClosingPacketById(organizationId: number, id: number): Promise<ClosingPacket | undefined> {
    const [packet] = await db.select().from(closingPackets)
      .where(and(eq(closingPackets.id, id), eq(closingPackets.organizationId, organizationId)));
    return packet;
  }

  async getClosingPacketsByDeal(organizationId: number, dealId: number): Promise<ClosingPacket[]> {
    return await db.select().from(closingPackets)
      .where(and(eq(closingPackets.dealId, dealId), eq(closingPackets.organizationId, organizationId)))
      .orderBy(desc(closingPackets.createdAt));
  }

  async createClosingPacket(data: InsertClosingPacket): Promise<ClosingPacket> {
    const [created] = await db.insert(closingPackets).values(data).returning();
    return created;
  }

  async updateClosingPacket(organizationId: number, id: number, data: Partial<InsertClosingPacket>): Promise<ClosingPacket | undefined> {
    const [updated] = await db.update(closingPackets)
      .set(data)
      .where(and(eq(closingPackets.id, id), eq(closingPackets.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deleteClosingPacket(organizationId: number, id: number): Promise<boolean> {
    await db.delete(closingPackets)
      .where(and(eq(closingPackets.id, id), eq(closingPackets.organizationId, organizationId)));
    return true;
  }

  // Autopay Enrollments
  async getAutopayEnrollments(organizationId: number): Promise<AutopayEnrollment[]> {
    return await db.select().from(autopayEnrollments)
      .where(eq(autopayEnrollments.organizationId, organizationId))
      .orderBy(desc(autopayEnrollments.createdAt));
  }

  async getAutopayEnrollmentById(organizationId: number, id: number): Promise<AutopayEnrollment | undefined> {
    const [enrollment] = await db.select().from(autopayEnrollments)
      .where(and(eq(autopayEnrollments.id, id), eq(autopayEnrollments.organizationId, organizationId)));
    return enrollment;
  }

  async getAutopayEnrollmentByNote(organizationId: number, noteId: number): Promise<AutopayEnrollment | undefined> {
    const [enrollment] = await db.select().from(autopayEnrollments)
      .where(and(eq(autopayEnrollments.noteId, noteId), eq(autopayEnrollments.organizationId, organizationId)))
      .limit(1);
    return enrollment;
  }

  async getActiveAutopayEnrollments(organizationId: number): Promise<AutopayEnrollment[]> {
    return await db.select().from(autopayEnrollments)
      .where(and(
        eq(autopayEnrollments.organizationId, organizationId),
        eq(autopayEnrollments.status, "active")
      ))
      .orderBy(desc(autopayEnrollments.createdAt));
  }

  async createAutopayEnrollment(data: InsertAutopayEnrollment): Promise<AutopayEnrollment> {
    const [created] = await db.insert(autopayEnrollments).values(data).returning();
    return created;
  }

  async updateAutopayEnrollment(organizationId: number, id: number, data: Partial<InsertAutopayEnrollment>): Promise<AutopayEnrollment | undefined> {
    const [updated] = await db.update(autopayEnrollments)
      .set(data)
      .where(and(eq(autopayEnrollments.id, id), eq(autopayEnrollments.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deleteAutopayEnrollment(organizationId: number, id: number): Promise<boolean> {
    await db.delete(autopayEnrollments)
      .where(and(eq(autopayEnrollments.id, id), eq(autopayEnrollments.organizationId, organizationId)));
    return true;
  }

  // Payoff Quotes
  async getPayoffQuotes(organizationId: number): Promise<PayoffQuote[]> {
    return await db.select().from(payoffQuotes)
      .where(eq(payoffQuotes.organizationId, organizationId))
      .orderBy(desc(payoffQuotes.createdAt));
  }

  async getPayoffQuoteById(organizationId: number, id: number): Promise<PayoffQuote | undefined> {
    const [quote] = await db.select().from(payoffQuotes)
      .where(and(eq(payoffQuotes.id, id), eq(payoffQuotes.organizationId, organizationId)));
    return quote;
  }

  async getPayoffQuotesByNote(organizationId: number, noteId: number): Promise<PayoffQuote[]> {
    return await db.select().from(payoffQuotes)
      .where(and(eq(payoffQuotes.noteId, noteId), eq(payoffQuotes.organizationId, organizationId)))
      .orderBy(desc(payoffQuotes.createdAt));
  }

  async createPayoffQuote(data: InsertPayoffQuote): Promise<PayoffQuote> {
    const [created] = await db.insert(payoffQuotes).values(data).returning();
    return created;
  }

  async updatePayoffQuote(organizationId: number, id: number, data: Partial<InsertPayoffQuote>): Promise<PayoffQuote | undefined> {
    const [updated] = await db.update(payoffQuotes)
      .set(data)
      .where(and(eq(payoffQuotes.id, id), eq(payoffQuotes.organizationId, organizationId)))
      .returning();
    return updated;
  }

  // Trust Ledger
  async getTrustLedgerEntries(organizationId: number): Promise<TrustLedgerEntry[]> {
    return await db.select().from(trustLedger)
      .where(eq(trustLedger.organizationId, organizationId))
      .orderBy(desc(trustLedger.createdAt));
  }

  async getTrustLedgerByNote(organizationId: number, noteId: number): Promise<TrustLedgerEntry[]> {
    return await db.select().from(trustLedger)
      .where(and(eq(trustLedger.noteId, noteId), eq(trustLedger.organizationId, organizationId)))
      .orderBy(desc(trustLedger.createdAt));
  }

  async createTrustLedgerEntry(data: InsertTrustLedger): Promise<TrustLedgerEntry> {
    const [created] = await db.insert(trustLedger).values(data).returning();
    return created;
  }

  async getTrustBalance(organizationId: number): Promise<string> {
    const [latest] = await db.select({ runningBalance: trustLedger.runningBalance })
      .from(trustLedger)
      .where(eq(trustLedger.organizationId, organizationId))
      .orderBy(desc(trustLedger.createdAt))
      .limit(1);
    return latest?.runningBalance ?? "0";
  }

  // Delinquency Escalations
  async getDelinquencyEscalations(organizationId: number): Promise<DelinquencyEscalation[]> {
    return await db.select().from(delinquencyEscalations)
      .where(eq(delinquencyEscalations.organizationId, organizationId))
      .orderBy(desc(delinquencyEscalations.createdAt));
  }

  async getDelinquencyEscalationById(organizationId: number, id: number): Promise<DelinquencyEscalation | undefined> {
    const [escalation] = await db.select().from(delinquencyEscalations)
      .where(and(eq(delinquencyEscalations.id, id), eq(delinquencyEscalations.organizationId, organizationId)));
    return escalation;
  }

  async getDelinquencyEscalationByNote(organizationId: number, noteId: number): Promise<DelinquencyEscalation | undefined> {
    const [escalation] = await db.select().from(delinquencyEscalations)
      .where(and(eq(delinquencyEscalations.noteId, noteId), eq(delinquencyEscalations.organizationId, organizationId)))
      .limit(1);
    return escalation;
  }

  async getActiveDelinquencyEscalations(organizationId: number): Promise<DelinquencyEscalation[]> {
    return await db.select().from(delinquencyEscalations)
      .where(and(
        eq(delinquencyEscalations.organizationId, organizationId),
        eq(delinquencyEscalations.status, "active")
      ))
      .orderBy(desc(delinquencyEscalations.createdAt));
  }

  async createDelinquencyEscalation(data: InsertDelinquencyEscalation): Promise<DelinquencyEscalation> {
    const [created] = await db.insert(delinquencyEscalations).values(data).returning();
    return created;
  }

  async updateDelinquencyEscalation(organizationId: number, id: number, data: Partial<InsertDelinquencyEscalation>): Promise<DelinquencyEscalation | undefined> {
    const [updated] = await db.update(delinquencyEscalations)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(delinquencyEscalations.id, id), eq(delinquencyEscalations.organizationId, organizationId)))
      .returning();
    return updated;
  }

  // DD Assignments
  async getDDAssignments(organizationId: number): Promise<DdAssignment[]> {
    return await db.select().from(ddAssignments)
      .where(eq(ddAssignments.organizationId, organizationId))
      .orderBy(desc(ddAssignments.createdAt));
  }

  async getDDAssignmentById(organizationId: number, id: number): Promise<DdAssignment | undefined> {
    const [assignment] = await db.select().from(ddAssignments)
      .where(and(eq(ddAssignments.id, id), eq(ddAssignments.organizationId, organizationId)));
    return assignment;
  }

  async getDDAssignmentsByProperty(organizationId: number, propertyId: number): Promise<DdAssignment[]> {
    return await db.select().from(ddAssignments)
      .where(and(eq(ddAssignments.propertyId, propertyId), eq(ddAssignments.organizationId, organizationId)))
      .orderBy(desc(ddAssignments.createdAt));
  }

  async getPendingDDAssignments(organizationId: number): Promise<DdAssignment[]> {
    return await db.select().from(ddAssignments)
      .where(and(
        eq(ddAssignments.organizationId, organizationId),
        eq(ddAssignments.status, "pending")
      ))
      .orderBy(desc(ddAssignments.createdAt));
  }

  async createDDAssignment(data: InsertDdAssignment): Promise<DdAssignment> {
    const [created] = await db.insert(ddAssignments).values(data).returning();
    return created;
  }

  async updateDDAssignment(organizationId: number, id: number, data: Partial<InsertDdAssignment>): Promise<DdAssignment | undefined> {
    const [updated] = await db.update(ddAssignments)
      .set(data)
      .where(and(eq(ddAssignments.id, id), eq(ddAssignments.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deleteDDAssignment(organizationId: number, id: number): Promise<boolean> {
    await db.delete(ddAssignments)
      .where(and(eq(ddAssignments.id, id), eq(ddAssignments.organizationId, organizationId)));
    return true;
  }

  // SWOT Reports
  async getSwotReports(organizationId: number): Promise<SwotReport[]> {
    return await db.select().from(swotReports)
      .where(eq(swotReports.organizationId, organizationId))
      .orderBy(desc(swotReports.createdAt));
  }

  async getSwotReportById(organizationId: number, id: number): Promise<SwotReport | undefined> {
    const [report] = await db.select().from(swotReports)
      .where(and(eq(swotReports.id, id), eq(swotReports.organizationId, organizationId)));
    return report;
  }

  async getSwotReportByProperty(organizationId: number, propertyId: number): Promise<SwotReport | undefined> {
    const [report] = await db.select().from(swotReports)
      .where(and(eq(swotReports.propertyId, propertyId), eq(swotReports.organizationId, organizationId)))
      .orderBy(desc(swotReports.createdAt))
      .limit(1);
    return report;
  }

  async createSwotReport(data: InsertSwotReport): Promise<SwotReport> {
    const [created] = await db.insert(swotReports).values(data).returning();
    return created;
  }

  async updateSwotReport(organizationId: number, id: number, data: Partial<InsertSwotReport>): Promise<SwotReport | undefined> {
    const [updated] = await db.update(swotReports)
      .set(data)
      .where(and(eq(swotReports.id, id), eq(swotReports.organizationId, organizationId)))
      .returning();
    return updated;
  }

  // Go/No-Go Memos
  async getGoNogoMemos(organizationId: number): Promise<GoNogoMemo[]> {
    return await db.select().from(goNogoMemos)
      .where(eq(goNogoMemos.organizationId, organizationId))
      .orderBy(desc(goNogoMemos.createdAt));
  }

  async getGoNogoMemoById(organizationId: number, id: number): Promise<GoNogoMemo | undefined> {
    const [memo] = await db.select().from(goNogoMemos)
      .where(and(eq(goNogoMemos.id, id), eq(goNogoMemos.organizationId, organizationId)));
    return memo;
  }

  async getGoNogoMemoByProperty(organizationId: number, propertyId: number): Promise<GoNogoMemo | undefined> {
    const [memo] = await db.select().from(goNogoMemos)
      .where(and(eq(goNogoMemos.propertyId, propertyId), eq(goNogoMemos.organizationId, organizationId)))
      .orderBy(desc(goNogoMemos.createdAt))
      .limit(1);
    return memo;
  }

  async createGoNogoMemo(data: InsertGoNogoMemo): Promise<GoNogoMemo> {
    const [created] = await db.insert(goNogoMemos).values(data).returning();
    return created;
  }

  async updateGoNogoMemo(organizationId: number, id: number, data: Partial<InsertGoNogoMemo>): Promise<GoNogoMemo | undefined> {
    const [updated] = await db.update(goNogoMemos)
      .set(data)
      .where(and(eq(goNogoMemos.id, id), eq(goNogoMemos.organizationId, organizationId)))
      .returning();
    return updated;
  }

  // Playbook Instances
  async getPlaybookInstances(organizationId: number): Promise<PlaybookInstance[]> {
    return await db.select().from(playbookInstances)
      .where(eq(playbookInstances.organizationId, organizationId))
      .orderBy(desc(playbookInstances.createdAt));
  }

  async getPlaybookInstanceById(organizationId: number, id: number): Promise<PlaybookInstance | undefined> {
    const [instance] = await db.select().from(playbookInstances)
      .where(and(eq(playbookInstances.id, id), eq(playbookInstances.organizationId, organizationId)));
    return instance;
  }

  async getPlaybookInstanceByTemplate(organizationId: number, templateId: string): Promise<PlaybookInstance | undefined> {
    const [instance] = await db.select().from(playbookInstances)
      .where(and(
        eq(playbookInstances.organizationId, organizationId),
        eq(playbookInstances.templateId, templateId),
        eq(playbookInstances.status, "in_progress")
      ))
      .orderBy(desc(playbookInstances.createdAt))
      .limit(1);
    return instance;
  }

  async getActivePlaybookInstances(organizationId: number): Promise<PlaybookInstance[]> {
    return await db.select().from(playbookInstances)
      .where(and(
        eq(playbookInstances.organizationId, organizationId),
        eq(playbookInstances.status, "in_progress")
      ))
      .orderBy(desc(playbookInstances.createdAt));
  }

  async createPlaybookInstance(data: InsertPlaybookInstance): Promise<PlaybookInstance> {
    const [created] = await db.insert(playbookInstances).values(data).returning();
    return created;
  }

  async updatePlaybookInstance(organizationId: number, id: number, data: Partial<InsertPlaybookInstance>): Promise<PlaybookInstance | undefined> {
    const [updated] = await db.update(playbookInstances)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(playbookInstances.id, id), eq(playbookInstances.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deletePlaybookInstance(organizationId: number, id: number): Promise<boolean> {
    await db.delete(playbookInstances)
      .where(and(eq(playbookInstances.id, id), eq(playbookInstances.organizationId, organizationId)));
    return true;
  }

  // ─── Platform Feature Flags ───────────────────────────────────────────────
  async getAllFeatureFlags(): Promise<PlatformFeatureFlag[]> {
    return await db.select().from(platformFeatureFlags).orderBy(platformFeatureFlags.label);
  }

  async getEnabledFeatureFlags(): Promise<PlatformFeatureFlag[]> {
    return await db.select().from(platformFeatureFlags)
      .where(eq(platformFeatureFlags.enabled, true));
  }

  async updateFeatureFlag(key: string, enabled: boolean): Promise<PlatformFeatureFlag | undefined> {
    const [updated] = await db.update(platformFeatureFlags)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(platformFeatureFlags.key, key))
      .returning();
    return updated;
  }

  // ─── Pricing Config ───────────────────────────────────────────────────────
  async getAllPricingConfig(): Promise<PricingConfig[]> {
    return await db.select().from(pricingConfig).orderBy(pricingConfig.tier);
  }

  async getPricingConfigForTier(tier: string): Promise<PricingConfig | undefined> {
    const [row] = await db.select().from(pricingConfig)
      .where(eq(pricingConfig.tier, tier));
    return row;
  }

  async updatePricingConfig(tier: string, data: Partial<InsertPricingConfig>): Promise<PricingConfig | undefined> {
    const [updated] = await db.update(pricingConfig)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(pricingConfig.tier, tier))
      .returning();
    return updated;
  }

  async clearPricingPromo(tier: string): Promise<void> {
    await db.update(pricingConfig)
      .set({ promoLabel: null, promoDiscountPercent: null, promoEndsAt: null, stripeCouponId: null, updatedAt: new Date() })
      .where(eq(pricingConfig.tier, tier));
  }

  // ─── Founder Ad Accounts ──────────────────────────────────────────────────
  async getFounderAdAccount(platform: string = "meta"): Promise<FounderAdAccount | undefined> {
    const [row] = await db.select().from(founderAdAccounts)
      .where(and(eq(founderAdAccounts.platform, platform), eq(founderAdAccounts.isActive, true)));
    return row;
  }

  async upsertFounderAdAccount(data: InsertFounderAdAccount): Promise<FounderAdAccount> {
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
  }

  // ─── Growth Campaigns ─────────────────────────────────────────────────────
  async getGrowthCampaigns(): Promise<GrowthCampaign[]> {
    return await db.select().from(growthCampaigns).orderBy(desc(growthCampaigns.createdAt));
  }

  async getGrowthCampaign(id: number): Promise<GrowthCampaign | undefined> {
    const [row] = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, id));
    return row;
  }

  async createGrowthCampaign(data: InsertGrowthCampaign): Promise<GrowthCampaign> {
    const [created] = await db.insert(growthCampaigns).values(data).returning();
    return created;
  }

  async updateGrowthCampaign(id: number, data: Partial<InsertGrowthCampaign>): Promise<GrowthCampaign | undefined> {
    const [updated] = await db.update(growthCampaigns)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(growthCampaigns.id, id))
      .returning();
    return updated;
  }

  // ─── Ad Creative Bundles ───────────────────────────────────────────────────

  async createAdCreativeBundle(data: {
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
  }

  async getAdCreativeBundle(id: string): Promise<AdCreativeBundle | undefined> {
    const [row] = await db.select().from(adCreativeBundles).where(eq(adCreativeBundles.id, id));
    return row;
  }

  async updateAdCreativeBundle(id: string, data: Partial<{
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
  }

  // ─── Recent Signups with UTM Attribution ──────────────────────────────────
  async getRecentSignupsWithAttribution(limit: number = 50) {
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
  }

  // ─── Borrower Messages ────────────────────────────────────────────────────
  async createBorrowerMessage(data: InsertBorrowerMessage): Promise<BorrowerMessage> {
    const [msg] = await db.insert(borrowerMessages).values(data).returning();
    return msg;
  }

  async getBorrowerMessages(noteId: number): Promise<BorrowerMessage[]> {
    return await db.select().from(borrowerMessages)
      .where(eq(borrowerMessages.noteId, noteId))
      .orderBy(borrowerMessages.createdAt);
  }

  async markBorrowerMessagesRead(noteId: number, senderType: string): Promise<void> {
    await db.update(borrowerMessages)
      .set({ readAt: new Date() })
      .where(and(
        eq(borrowerMessages.noteId, noteId),
        eq(borrowerMessages.senderType, senderType),
        sql`${borrowerMessages.readAt} IS NULL`
      ));
  }

  async countUnreadBorrowerMessages(noteId: number, senderType: string): Promise<number> {
    const [result] = await db
      .select({ cnt: count() })
      .from(borrowerMessages)
      .where(and(
        eq(borrowerMessages.noteId, noteId),
        eq(borrowerMessages.senderType, senderType),
        sql`${borrowerMessages.readAt} IS NULL`
      ));
    return Number(result?.cnt ?? 0);
  }

  // ─── Field Scout Visits ─────────────────────────────────────────────────────

  async createFieldScoutVisit(data: InsertFieldScoutVisit): Promise<FieldScoutVisit> {
    const [created] = await db.insert(fieldScoutVisits).values(data).returning();
    return created;
  }

  async getFieldScoutVisit(id: number): Promise<FieldScoutVisit | undefined> {
    const [row] = await db.select().from(fieldScoutVisits).where(eq(fieldScoutVisits.id, id));
    return row;
  }

  async getFieldScoutVisits(visitorId: string, limit: number = 50, offset: number = 0): Promise<FieldScoutVisit[]> {
    return await db.select().from(fieldScoutVisits)
      .where(eq(fieldScoutVisits.visitorId, visitorId))
      .orderBy(desc(fieldScoutVisits.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async countFieldScoutVisits(visitorId: string): Promise<number> {
    const [result] = await db
      .select({ cnt: count() })
      .from(fieldScoutVisits)
      .where(eq(fieldScoutVisits.visitorId, visitorId));
    return Number(result?.cnt ?? 0);
  }

  // ─── Field Scout Photos ─────────────────────────────────────────────────────

  async createFieldScoutPhoto(data: InsertFieldScoutPhoto): Promise<FieldScoutPhoto> {
    const [created] = await db.insert(fieldScoutPhotos).values(data).returning();
    return created;
  }

  async getFieldScoutPhotosByVisit(visitId: number): Promise<FieldScoutPhoto[]> {
    return await db.select().from(fieldScoutPhotos)
      .where(eq(fieldScoutPhotos.visitId, visitId))
      .orderBy(desc(fieldScoutPhotos.createdAt));
  }

  async getFieldScoutPhotosByLead(leadId: number): Promise<FieldScoutPhoto[]> {
    return await db.select().from(fieldScoutPhotos)
      .where(eq(fieldScoutPhotos.leadId, leadId))
      .orderBy(desc(fieldScoutPhotos.createdAt));
  }

  // Phase 8 Mo 12 — Yara §1 dedup. Backed by the partial index
  // `fsp_org_hash_idx (organization_id, image_hash) WHERE image_hash IS NOT NULL`
  // (migration 0067) so this is O(log n) on every upload.
  async findFieldScoutPhotoByHash(
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
  }
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

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DatabaseStorage extends OrgRepo, TeamRepo, LeadRepo, PropertyRepo, DealRepo, NoteRepo, CampaignRepo, AuditRepo, IntegrationsRepo, CommsRepo, PaxRepo, AiRepo, AutomationRepo, MailRepo, VaRepo, DueDiligenceRepo, SupportOpsRepo, SequencesRepo, CustomizationRepo, PaymentRemindersRepo, TasksRepo {}

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
);

export const storage = new DatabaseStorage();
