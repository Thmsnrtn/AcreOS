import { db } from "./db";
export { db };
import { eq, and, desc, sql, count, sum, arrayContains, gte, lte, or } from "drizzle-orm";
import { aiConversations, aiMessages } from "@shared/schema";
import {
  organizations, teamMembers, leads, leadActivities, properties, deals,
  notes, payments, paymentReminders, campaigns, campaignOptimizations, campaignResponses, agentConfigs, agentTasks, conversations,
  messages, activityLog, usageEvents,
  aiAgentProfiles, aiToolDefinitions, aiExecutionRuns, aiMemory,
  vaAgents, vaActions, vaBriefings, vaCalendarEvents, vaTemplates,
  dueDiligenceTemplates, dueDiligenceItems, dueDiligenceChecklists,
  checklistTemplates, dealChecklists,
  usageRecords, creditTransactions,
  supportCases, supportMessages, supportActions, supportPlaybooks,
  dunningEvents, systemAlerts,
  verifiedEmailDomains, provisionedPhoneNumbers, organizationIntegrations,
  activityEvents,
  campaignSequences, sequenceSteps, sequenceEnrollments,
  abTests, abTestVariants,
  customFieldDefinitions, customFieldValues, savedViews, notificationPreferences, tasks,
  auditLog,
  targetCounties,
  offerLetters,
  offerTemplates,
  skipTraces,
  propertyListings,
  type Organization, type InsertOrganization,
  type TeamMember, type InsertTeamMember,
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
  type VerifiedEmailDomain, type InsertVerifiedEmailDomain,
  type ProvisionedPhoneNumber, type InsertProvisionedPhoneNumber,
  type OrganizationIntegration, type InsertOrganizationIntegration,
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
  type DocumentTemplate, type InsertDocumentTemplate,
  type GeneratedDocument, type InsertGeneratedDocument,
  documentTemplates, generatedDocuments,
  DEFAULT_DUE_DILIGENCE_TEMPLATES,
  DEFAULT_DEAL_CHECKLIST_TEMPLATES,
} from "@shared/schema";

// Helper to calculate amortization schedule
function calculateAmortizationSchedule(
  principal: number,
  annualRate: number,
  termMonths: number,
  monthlyPayment: number,
  startDate: Date
): Note["amortizationSchedule"] {
  const schedule: Note["amortizationSchedule"] = [];
  let balance = principal;
  const monthlyRate = annualRate / 100 / 12;
  
  for (let i = 1; i <= termMonths && balance > 0; i++) {
    const interestPayment = balance * monthlyRate;
    const principalPayment = Math.min(monthlyPayment - interestPayment, balance);
    balance = Math.max(0, balance - principalPayment);
    
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    
    schedule.push({
      paymentNumber: i,
      dueDate: dueDate.toISOString(),
      payment: monthlyPayment,
      principal: Number(principalPayment.toFixed(2)),
      interest: Number(interestPayment.toFixed(2)),
      balance: Number(balance.toFixed(2)),
      status: "pending",
    });
  }
  
  return schedule;
}

// Calculate monthly payment for a loan
export function calculateMonthlyPayment(principal: number, annualRate: number, termMonths: number): number {
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return principal / termMonths;
  const payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1);
  return Number(payment.toFixed(2));
}

export interface IStorage {
  // Organizations
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  getOrganizationByOwner(ownerId: string): Promise<Organization | undefined>;
  getOrganizationByStripeCustomerId(customerId: string): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, updates: Partial<InsertOrganization>): Promise<Organization>;
  
  // Team Members
  getTeamMembers(orgId: number): Promise<TeamMember[]>;
  getTeamMember(orgId: number, userId: string): Promise<TeamMember | undefined>;
  createTeamMember(member: InsertTeamMember): Promise<TeamMember>;
  updateTeamMember(id: number, updates: Partial<InsertTeamMember>): Promise<TeamMember>;
  
  // Leads
  getLeads(orgId: number): Promise<Lead[]>;
  getLead(orgId: number, id: number): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: number, updates: Partial<InsertLead>): Promise<Lead>;
  deleteLead(id: number): Promise<void>;
  getLeadCount(orgId: number): Promise<number>;
  
  // Lead Scoring & Nurturing
  getLeadsNeedingScoring(orgId: number, limit?: number): Promise<Lead[]>;
  getLeadsDueForFollowUp(orgId: number): Promise<Lead[]>;
  createLeadActivity(activity: InsertLeadActivity): Promise<LeadActivity>;
  getLeadActivities(leadId: number, limit?: number): Promise<LeadActivity[]>;
  updateLeadScore(leadId: number, score: number, scoreFactors: Lead["scoreFactors"]): Promise<Lead>;
  
  // Properties
  getProperties(orgId: number): Promise<Property[]>;
  getProperty(orgId: number, id: number): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(id: number, updates: Partial<InsertProperty>): Promise<Property>;
  deleteProperty(id: number): Promise<void>;
  getPropertyCount(orgId: number): Promise<number>;
  
  // Deals
  getDeals(orgId: number): Promise<Deal[]>;
  getDeal(orgId: number, id: number): Promise<Deal | undefined>;
  createDeal(deal: InsertDeal): Promise<Deal>;
  updateDeal(id: number, updates: Partial<InsertDeal>): Promise<Deal>;
  
  // Notes (Financing)
  getNotes(orgId: number): Promise<Note[]>;
  getNote(orgId: number, id: number): Promise<Note | undefined>;
  getNoteByAccessToken(accessToken: string): Promise<Note | undefined>;
  createNote(note: InsertNote): Promise<Note>;
  updateNote(id: number, updates: Partial<InsertNote>): Promise<Note>;
  deleteNote(id: number): Promise<void>;
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
  getConversations(orgId: number, leadId?: number): Promise<Conversation[]>;
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
  deleteAiMemory(id: number): Promise<void>;

  // AI Conversations (Command Center)
  getAiConversations(orgId: number): Promise<any[]>;
  getAiConversation(id: number): Promise<any | undefined>;
  createAiConversation(conv: any): Promise<any>;
  updateAiConversation(id: number, updates: any): Promise<any>;
  deleteAiConversation(id: number): Promise<void>;
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

  // Due Diligence Templates
  getDueDiligenceTemplates(orgId: number): Promise<DueDiligenceTemplate[]>;
  getDueDiligenceTemplate(id: number): Promise<DueDiligenceTemplate | undefined>;
  createDueDiligenceTemplate(template: InsertDueDiligenceTemplate): Promise<DueDiligenceTemplate>;
  updateDueDiligenceTemplate(id: number, updates: Partial<InsertDueDiligenceTemplate>): Promise<DueDiligenceTemplate>;
  deleteDueDiligenceTemplate(id: number): Promise<void>;
  initializeDefaultTemplates(orgId: number): Promise<DueDiligenceTemplate[]>;

  // Due Diligence Items (property checklist)
  getPropertyDueDiligence(propertyId: number): Promise<DueDiligenceItem[]>;
  createDueDiligenceItem(item: InsertDueDiligenceItem): Promise<DueDiligenceItem>;
  updateDueDiligenceItem(id: number, updates: Partial<InsertDueDiligenceItem>): Promise<DueDiligenceItem>;
  deleteDueDiligenceItem(id: number): Promise<void>;
  applyTemplateToProperty(propertyId: number, templateId: number): Promise<DueDiligenceItem[]>;

  // Deal Checklist Templates
  getChecklistTemplates(orgId: number): Promise<ChecklistTemplate[]>;
  getChecklistTemplate(id: number): Promise<ChecklistTemplate | undefined>;
  createChecklistTemplate(template: InsertChecklistTemplate): Promise<ChecklistTemplate>;
  updateChecklistTemplate(id: number, updates: Partial<InsertChecklistTemplate>): Promise<ChecklistTemplate>;
  deleteChecklistTemplate(id: number): Promise<void>;
  initializeDefaultChecklistTemplates(orgId: number): Promise<ChecklistTemplate[]>;

  // Deal Checklists
  getDealChecklist(dealId: number): Promise<DealChecklist | undefined>;
  createDealChecklist(checklist: InsertDealChecklist): Promise<DealChecklist>;
  updateDealChecklist(id: number, updates: Partial<InsertDealChecklist>): Promise<DealChecklist>;
  applyChecklistTemplateToDeal(dealId: number, templateId: number): Promise<DealChecklist>;
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
  getSupportCase(id: number): Promise<SupportCase | undefined>;
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
  updateSequenceStep(id: number, updates: Partial<InsertSequenceStep>): Promise<SequenceStep>;
  deleteSequenceStep(id: number): Promise<void>;
  reorderSequenceSteps(sequenceId: number, stepIds: number[]): Promise<void>;

  // Sequence Enrollments
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
  getDocumentTemplate(id: number): Promise<DocumentTemplate | undefined>;
  createDocumentTemplate(template: InsertDocumentTemplate): Promise<DocumentTemplate>;
  updateDocumentTemplate(id: number, updates: Partial<InsertDocumentTemplate>): Promise<DocumentTemplate>;
  deleteDocumentTemplate(id: number): Promise<void>;
  seedSystemTemplates(): Promise<void>;

  // Generated Documents
  getGeneratedDocuments(orgId: number, filters?: { dealId?: number; propertyId?: number; status?: string }): Promise<GeneratedDocument[]>;
  getGeneratedDocument(orgId: number, id: number): Promise<GeneratedDocument | undefined>;
  createGeneratedDocument(doc: InsertGeneratedDocument): Promise<GeneratedDocument>;
  updateGeneratedDocument(id: number, updates: Partial<InsertGeneratedDocument>): Promise<GeneratedDocument>;
}

export class DatabaseStorage implements IStorage {
  // Organizations
  async getOrganization(id: number) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }
  
  async getOrganizationBySlug(slug: string) {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
    return org;
  }
  
  async getOrganizationByOwner(ownerId: string) {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerId, ownerId));
    return org;
  }

  async getOrganizationByStripeCustomerId(customerId: string) {
    const [org] = await db.select().from(organizations).where(eq(organizations.stripeCustomerId, customerId));
    return org;
  }
  
  async createOrganization(org: InsertOrganization) {
    const [newOrg] = await db.insert(organizations).values(org).returning();
    return newOrg;
  }
  
  async updateOrganization(id: number, updates: Partial<InsertOrganization>) {
    const [updated] = await db.update(organizations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return updated;
  }
  
  // Team Members
  async getTeamMembers(orgId: number) {
    return await db.select().from(teamMembers).where(eq(teamMembers.organizationId, orgId));
  }
  
  async getTeamMember(orgId: number, userId: string) {
    const [member] = await db.select().from(teamMembers)
      .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.userId, userId)));
    return member;
  }
  
  async createTeamMember(member: InsertTeamMember) {
    const [newMember] = await db.insert(teamMembers).values(member).returning();
    return newMember;
  }
  
  async updateTeamMember(id: number, updates: Partial<InsertTeamMember>) {
    const [updated] = await db.update(teamMembers).set(updates).where(eq(teamMembers.id, id)).returning();
    return updated;
  }
  
  // Leads
  async getLeads(orgId: number) {
    return await db.select().from(leads)
      .where(eq(leads.organizationId, orgId))
      .orderBy(desc(leads.createdAt));
  }
  
  async getLead(orgId: number, id: number) {
    const [lead] = await db.select().from(leads)
      .where(and(eq(leads.organizationId, orgId), eq(leads.id, id)));
    return lead;
  }
  
  async createLead(lead: InsertLead) {
    const [newLead] = await db.insert(leads).values(lead).returning();
    await this.logActivity({
      organizationId: lead.organizationId,
      action: "created",
      entityType: "lead",
      entityId: newLead.id,
      description: `Lead ${newLead.firstName} ${newLead.lastName} created`,
    });
    return newLead;
  }
  
  async updateLead(id: number, updates: Partial<InsertLead>) {
    const [updated] = await db.update(leads)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    return updated;
  }
  
  async deleteLead(id: number) {
    await db.delete(leads).where(eq(leads.id, id));
  }
  
  async getLeadCount(orgId: number) {
    const [result] = await db.select({ count: count() }).from(leads).where(eq(leads.organizationId, orgId));
    return result?.count || 0;
  }
  
  // Lead Scoring & Nurturing
  async getLeadsNeedingScoring(orgId: number, limit: number = 50): Promise<Lead[]> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        sql`${leads.status} != 'dead'`,
        sql`${leads.status} != 'closed'`,
        or(
          sql`${leads.lastScoreAt} IS NULL`,
          lte(leads.lastScoreAt, oneDayAgo)
        )
      ))
      .orderBy(sql`${leads.lastScoreAt} NULLS FIRST`)
      .limit(limit);
  }
  
  async getLeadsDueForFollowUp(orgId: number): Promise<Lead[]> {
    const now = new Date();
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        sql`${leads.status} != 'dead'`,
        sql`${leads.status} != 'closed'`,
        lte(leads.nextFollowUpAt, now)
      ))
      .orderBy(leads.nextFollowUpAt)
      .limit(100);
  }
  
  async createLeadActivity(activity: InsertLeadActivity): Promise<LeadActivity> {
    const [newActivity] = await db.insert(leadActivities).values(activity).returning();
    return newActivity;
  }
  
  async getLeadActivities(leadId: number, limit: number = 50): Promise<LeadActivity[]> {
    return await db.select().from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt))
      .limit(limit);
  }
  
  async updateLeadScore(leadId: number, score: number, scoreFactors: Lead["scoreFactors"]): Promise<Lead> {
    const [updated] = await db.update(leads)
      .set({
        score,
        scoreFactors,
        lastScoreAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
      .returning();
    return updated;
  }
  
  // Properties
  async getProperties(orgId: number) {
    return await db.select().from(properties)
      .where(eq(properties.organizationId, orgId))
      .orderBy(desc(properties.createdAt));
  }
  
  async getProperty(orgId: number, id: number) {
    const [property] = await db.select().from(properties)
      .where(and(eq(properties.organizationId, orgId), eq(properties.id, id)));
    return property;
  }
  
  async createProperty(property: InsertProperty) {
    const [newProperty] = await db.insert(properties).values(property).returning();
    await this.logActivity({
      organizationId: property.organizationId,
      action: "created",
      entityType: "property",
      entityId: newProperty.id,
      description: `Property ${newProperty.apn} created`,
    });
    return newProperty;
  }
  
  async updateProperty(id: number, updates: Partial<InsertProperty>) {
    const [updated] = await db.update(properties)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(properties.id, id))
      .returning();
    return updated;
  }
  
  async deleteProperty(id: number) {
    await db.delete(properties).where(eq(properties.id, id));
  }
  
  async getPropertyCount(orgId: number) {
    const [result] = await db.select({ count: count() }).from(properties).where(eq(properties.organizationId, orgId));
    return result?.count || 0;
  }
  
  // Deals
  async getDeals(orgId: number) {
    return await db.select().from(deals)
      .where(eq(deals.organizationId, orgId))
      .orderBy(desc(deals.createdAt));
  }
  
  async getDeal(orgId: number, id: number) {
    const [deal] = await db.select().from(deals)
      .where(and(eq(deals.organizationId, orgId), eq(deals.id, id)));
    return deal;
  }
  
  async createDeal(deal: InsertDeal) {
    const [newDeal] = await db.insert(deals).values(deal).returning();
    return newDeal;
  }
  
  async updateDeal(id: number, updates: Partial<InsertDeal>) {
    const [updated] = await db.update(deals)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(deals.id, id))
      .returning();
    return updated;
  }
  
  // Notes (Financing)
  async getNotes(orgId: number) {
    return await db.select().from(notes)
      .where(eq(notes.organizationId, orgId))
      .orderBy(desc(notes.createdAt));
  }
  
  async getNote(orgId: number, id: number) {
    const [note] = await db.select().from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.id, id)));
    return note;
  }
  
  async getNoteByAccessToken(accessToken: string) {
    const [note] = await db.select().from(notes)
      .where(eq(notes.accessToken, accessToken));
    return note;
  }
  
  async createNote(noteData: InsertNote) {
    // Calculate amortization if not provided
    let amortization = noteData.amortizationSchedule;
    if (!amortization && noteData.originalPrincipal && noteData.interestRate && noteData.termMonths) {
      const principal = Number(noteData.originalPrincipal);
      const rate = Number(noteData.interestRate);
      const term = noteData.termMonths;
      const payment = Number(noteData.monthlyPayment) || calculateMonthlyPayment(principal, rate, term);
      amortization = calculateAmortizationSchedule(principal, rate, term, payment, new Date(noteData.startDate));
    }
    
    // Calculate maturity date
    const maturityDate = new Date(noteData.startDate);
    maturityDate.setMonth(maturityDate.getMonth() + noteData.termMonths);
    
    // Generate access token for borrower portal
    const accessToken = noteData.accessToken || `note_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    const [newNote] = await db.insert(notes).values({
      ...noteData,
      currentBalance: noteData.currentBalance || noteData.originalPrincipal,
      amortizationSchedule: amortization,
      maturityDate: maturityDate,
      nextPaymentDate: noteData.firstPaymentDate,
      accessToken,
    }).returning();
    
    await this.logActivity({
      organizationId: noteData.organizationId,
      action: "created",
      entityType: "note",
      entityId: newNote.id,
      description: `Note created for $${noteData.originalPrincipal}`,
    });
    
    return newNote;
  }
  
  async updateNote(id: number, updates: Partial<InsertNote>) {
    const [updated] = await db.update(notes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(notes.id, id))
      .returning();
    return updated;
  }
  
  async deleteNote(id: number) {
    await db.delete(notes).where(eq(notes.id, id));
  }
  
  async getNoteCount(orgId: number) {
    const [result] = await db.select({ count: count() }).from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
    return result?.count || 0;
  }
  
  async getActiveNotesValue(orgId: number) {
    const [result] = await db.select({ total: sum(notes.currentBalance) }).from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
    return Number(result?.total) || 0;
  }
  
  // Payments
  async getPayments(orgId: number, noteId?: number) {
    if (noteId) {
      return await db.select().from(payments)
        .where(and(eq(payments.organizationId, orgId), eq(payments.noteId, noteId)))
        .orderBy(desc(payments.paymentDate));
    }
    return await db.select().from(payments)
      .where(eq(payments.organizationId, orgId))
      .orderBy(desc(payments.paymentDate));
  }
  
  async createPayment(payment: InsertPayment) {
    const [newPayment] = await db.insert(payments).values(payment).returning();
    
    // Update note balance if payment completed
    if (payment.status === "completed") {
      const [note] = await db.select().from(notes).where(eq(notes.id, payment.noteId));
      if (note) {
        const newBalance = Number(note.currentBalance) - Number(payment.principalAmount);
        await db.update(notes).set({
          currentBalance: String(Math.max(0, newBalance)),
          status: newBalance <= 0 ? "paid_off" : "active",
          updatedAt: new Date(),
        }).where(eq(notes.id, payment.noteId));
      }
    }
    
    return newPayment;
  }
  
  async updatePayment(id: number, updates: Partial<InsertPayment>) {
    const [updated] = await db.update(payments).set(updates).where(eq(payments.id, id)).returning();
    return updated;
  }
  
  // Campaigns
  async getCampaigns(orgId: number) {
    return await db.select().from(campaigns)
      .where(eq(campaigns.organizationId, orgId))
      .orderBy(desc(campaigns.createdAt));
  }
  
  async getCampaign(orgId: number, id: number) {
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id)));
    return campaign;
  }
  
  async createCampaign(campaign: InsertCampaign) {
    const [newCampaign] = await db.insert(campaigns).values(campaign).returning();
    return newCampaign;
  }
  
  async updateCampaign(id: number, updates: Partial<InsertCampaign>) {
    const [updated] = await db.update(campaigns)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(campaigns.id, id))
      .returning();
    return updated;
  }
  
  // Campaign Optimizations
  async getCampaignOptimizations(campaignId: number) {
    return await db.select().from(campaignOptimizations)
      .where(eq(campaignOptimizations.campaignId, campaignId))
      .orderBy(desc(campaignOptimizations.createdAt));
  }
  
  async createCampaignOptimization(optimization: InsertCampaignOptimization) {
    const [newOptimization] = await db.insert(campaignOptimizations).values(optimization).returning();
    return newOptimization;
  }
  
  async markOptimizationImplemented(optimizationId: number, resultDelta: CampaignOptimization["resultDelta"]) {
    const [updated] = await db.update(campaignOptimizations)
      .set({ 
        implemented: true, 
        implementedAt: new Date(),
        resultDelta
      })
      .where(eq(campaignOptimizations.id, optimizationId))
      .returning();
    return updated;
  }
  
  async getCampaignsNeedingOptimization(orgId: number): Promise<Campaign[]> {
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
  }
  
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
  
  async updateAgentConfig(id: number, updates: Partial<InsertAgentConfig>) {
    const [updated] = await db.update(agentConfigs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(agentConfigs.id, id))
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
  
  async updateAgentTask(id: number, updates: Partial<InsertAgentTask>) {
    const [updated] = await db.update(agentTasks).set(updates).where(eq(agentTasks.id, id)).returning();
    return updated;
  }
  
  // Conversations & Messages
  async getConversations(orgId: number, leadId?: number) {
    if (leadId) {
      return await db.select().from(conversations)
        .where(and(eq(conversations.organizationId, orgId), eq(conversations.leadId, leadId)))
        .orderBy(desc(conversations.lastMessageAt));
    }
    return await db.select().from(conversations)
      .where(eq(conversations.organizationId, orgId))
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
  
  // AI Agent Profiles
  async getAiAgentProfiles() {
    return await db.select().from(aiAgentProfiles).where(eq(aiAgentProfiles.isActive, true));
  }
  
  async getAiAgentProfile(role: string) {
    const [profile] = await db.select().from(aiAgentProfiles)
      .where(and(eq(aiAgentProfiles.role, role), eq(aiAgentProfiles.isActive, true)));
    return profile;
  }
  
  // AI Tool Definitions
  async getAiToolDefinitions() {
    return await db.select().from(aiToolDefinitions);
  }
  
  async getAiToolsByRole(role: string) {
    const tools = await db.select().from(aiToolDefinitions);
    return tools.filter(tool => 
      tool.agentRoles === null || tool.agentRoles.includes(role)
    );
  }
  
  // AI Execution Runs
  async getAiExecutionRuns(orgId: number) {
    return await db.select().from(aiExecutionRuns)
      .where(eq(aiExecutionRuns.organizationId, orgId))
      .orderBy(desc(aiExecutionRuns.startedAt));
  }
  
  async createAiExecutionRun(run: InsertAiExecutionRun) {
    const [newRun] = await db.insert(aiExecutionRuns).values(run).returning();
    return newRun;
  }
  
  async updateAiExecutionRun(id: number, updates: Partial<AiExecutionRun>) {
    const [updated] = await db.update(aiExecutionRuns)
      .set(updates)
      .where(eq(aiExecutionRuns.id, id))
      .returning();
    return updated;
  }
  
  // AI Memory
  async getAiMemory(orgId: number) {
    return await db.select().from(aiMemory)
      .where(eq(aiMemory.organizationId, orgId))
      .orderBy(desc(aiMemory.createdAt));
  }
  
  async createAiMemory(memory: InsertAiMemory) {
    const [newMemory] = await db.insert(aiMemory).values(memory).returning();
    return newMemory;
  }
  
  async deleteAiMemory(id: number) {
    await db.delete(aiMemory).where(eq(aiMemory.id, id));
  }

  // AI Conversations (Command Center)
  async getAiConversations(orgId: number) {
    return await db.select().from(aiConversations)
      .where(eq(aiConversations.organizationId, orgId))
      .orderBy(desc(aiConversations.updatedAt));
  }

  async getAiConversation(id: number) {
    const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, id));
    return conv;
  }

  async createAiConversation(conv: { organizationId: number; userId: string; title: string; agentRole: string }) {
    const [newConv] = await db.insert(aiConversations).values(conv).returning();
    return newConv;
  }

  async updateAiConversation(id: number, updates: { title?: string }) {
    const [updated] = await db.update(aiConversations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(aiConversations.id, id))
      .returning();
    return updated;
  }

  async deleteAiConversation(id: number) {
    await db.delete(aiMessages).where(eq(aiMessages.conversationId, id));
    await db.delete(aiConversations).where(eq(aiConversations.id, id));
  }

  async getAiMessages(conversationId: number) {
    return await db.select().from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(aiMessages.createdAt);
  }

  async createAiMessage(message: { conversationId: number; role: string; content: string; toolCalls?: any[] }) {
    const [newMessage] = await db.insert(aiMessages).values(message).returning();
    return newMessage;
  }

  // ============================================
  // VA (Virtual Assistants) Implementation
  // ============================================

  async getVaAgents(orgId: number) {
    return await db.select().from(vaAgents)
      .where(eq(vaAgents.organizationId, orgId))
      .orderBy(vaAgents.agentType);
  }

  async getVaAgent(orgId: number, id: number) {
    const [agent] = await db.select().from(vaAgents)
      .where(and(eq(vaAgents.organizationId, orgId), eq(vaAgents.id, id)));
    return agent;
  }

  async getVaAgentByType(orgId: number, agentType: string) {
    const [agent] = await db.select().from(vaAgents)
      .where(and(eq(vaAgents.organizationId, orgId), eq(vaAgents.agentType, agentType)));
    return agent;
  }

  async createVaAgent(agent: InsertVaAgent) {
    const [newAgent] = await db.insert(vaAgents).values(agent).returning();
    return newAgent;
  }

  async updateVaAgent(id: number, updates: Partial<InsertVaAgent>) {
    const [updated] = await db.update(vaAgents)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vaAgents.id, id))
      .returning();
    return updated;
  }

  async initializeVaAgents(orgId: number): Promise<VaAgent[]> {
    const existingAgents = await this.getVaAgents(orgId);
    if (existingAgents.length > 0) {
      return existingAgents;
    }

    const defaultAgents: InsertVaAgent[] = [
      {
        organizationId: orgId,
        agentType: "executive",
        name: "Executive Assistant",
        avatar: "Briefcase",
        description: "Your personal executive assistant. Provides daily briefings, routes tasks to specialists, and keeps everything organized.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          notifyOnAction: true,
          autoApproveCategories: ["briefing", "summary", "reminder"],
          escalateToHuman: ["financial_decision", "legal_document", "large_expense"],
        },
      },
      {
        organizationId: orgId,
        agentType: "sales",
        name: "Sales VA",
        avatar: "MessageSquare",
        description: "Handles buyer inquiries, qualifies leads, schedules callbacks, and nurtures prospects toward closing.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          responseDelay: 5,
          autoApproveCategories: ["follow_up", "qualification"],
          escalateToHuman: ["price_negotiation", "contract_question"],
        },
      },
      {
        organizationId: orgId,
        agentType: "acquisitions",
        name: "Acquisitions VA",
        avatar: "Target",
        description: "Monitors seller leads, researches comps, drafts offers, and manages the acquisition pipeline.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          autoApproveCategories: ["research", "comp_analysis"],
          escalateToHuman: ["offer_submission", "contract_signing"],
        },
      },
      {
        organizationId: orgId,
        agentType: "marketing",
        name: "Marketing VA",
        avatar: "Megaphone",
        description: "Conducts market research, proposes campaigns, manages direct mail through Lob, and tracks marketing performance.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          autoApproveCategories: ["research", "report"],
          escalateToHuman: ["campaign_launch", "budget_increase"],
        },
      },
      {
        organizationId: orgId,
        agentType: "collections",
        name: "Collections VA",
        avatar: "DollarSign",
        description: "Monitors payment schedules, sends reminders, handles delinquencies, and manages note servicing.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          autoApproveCategories: ["reminder", "payment_confirmation"],
          escalateToHuman: ["default_notice", "legal_action"],
        },
      },
      {
        organizationId: orgId,
        agentType: "research",
        name: "Research VA",
        avatar: "Search",
        description: "Performs property due diligence, market analysis, zoning research, and gathers intelligence on opportunities.",
        isEnabled: true,
        autonomyLevel: "supervised",
        config: {
          autoApproveCategories: ["research", "report", "analysis"],
        },
      },
    ];

    const createdAgents: VaAgent[] = [];
    for (const agent of defaultAgents) {
      const created = await this.createVaAgent(agent);
      createdAgents.push(created);
    }
    
    return createdAgents;
  }

  // VA Actions
  async getVaActions(orgId: number, options?: { agentId?: number; status?: string; limit?: number }) {
    let query = db.select().from(vaActions)
      .where(eq(vaActions.organizationId, orgId))
      .orderBy(desc(vaActions.createdAt));
    
    const conditions = [eq(vaActions.organizationId, orgId)];
    if (options?.agentId) {
      conditions.push(eq(vaActions.agentId, options.agentId));
    }
    if (options?.status) {
      conditions.push(eq(vaActions.status, options.status));
    }
    
    const result = await db.select().from(vaActions)
      .where(and(...conditions))
      .orderBy(desc(vaActions.createdAt))
      .limit(options?.limit || 100);
    
    return result;
  }

  async getVaAction(id: number) {
    const [action] = await db.select().from(vaActions).where(eq(vaActions.id, id));
    return action;
  }

  async createVaAction(action: InsertVaAction) {
    const [newAction] = await db.insert(vaActions).values(action).returning();
    return newAction;
  }

  async updateVaAction(id: number, updates: Partial<VaAction>) {
    // Remove immutable fields from updates to prevent accidental modification
    const { 
      id: _id, 
      createdAt: _createdAt, 
      organizationId: _orgId,
      agentId: _agentId,
      ...safeUpdates 
    } = updates as any;
    const [updated] = await db.update(vaActions)
      .set({ ...safeUpdates, updatedAt: new Date() })
      .where(eq(vaActions.id, id))
      .returning();
    return updated;
  }

  async approveVaAction(id: number, userId: string) {
    const [updated] = await db.update(vaActions)
      .set({
        status: "approved",
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vaActions.id, id))
      .returning();
    return updated;
  }

  async rejectVaAction(id: number, reason: string) {
    const [updated] = await db.update(vaActions)
      .set({
        status: "rejected",
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(vaActions.id, id))
      .returning();
    return updated;
  }

  async getPendingActionsCount(orgId: number) {
    const [result] = await db.select({ count: count() }).from(vaActions)
      .where(and(
        eq(vaActions.organizationId, orgId),
        eq(vaActions.status, "proposed")
      ));
    return result?.count || 0;
  }

  // VA Briefings
  async getVaBriefings(orgId: number, limit: number = 10) {
    return await db.select().from(vaBriefings)
      .where(eq(vaBriefings.organizationId, orgId))
      .orderBy(desc(vaBriefings.createdAt))
      .limit(limit);
  }

  async getLatestBriefing(orgId: number) {
    const [briefing] = await db.select().from(vaBriefings)
      .where(eq(vaBriefings.organizationId, orgId))
      .orderBy(desc(vaBriefings.createdAt))
      .limit(1);
    return briefing;
  }

  async createVaBriefing(briefing: InsertVaBriefing) {
    const [newBriefing] = await db.insert(vaBriefings).values(briefing).returning();
    return newBriefing;
  }

  async markBriefingRead(id: number) {
    const [updated] = await db.update(vaBriefings)
      .set({ readAt: new Date() })
      .where(eq(vaBriefings.id, id))
      .returning();
    return updated;
  }

  // VA Calendar Events
  async getVaCalendarEvents(orgId: number, startDate?: Date, endDate?: Date) {
    const conditions = [eq(vaCalendarEvents.organizationId, orgId)];
    
    if (startDate) {
      conditions.push(gte(vaCalendarEvents.startTime, startDate));
    }
    if (endDate) {
      conditions.push(lte(vaCalendarEvents.startTime, endDate));
    }
    
    return await db.select().from(vaCalendarEvents)
      .where(and(...conditions))
      .orderBy(vaCalendarEvents.startTime);
  }

  async createVaCalendarEvent(event: InsertVaCalendarEvent) {
    const [newEvent] = await db.insert(vaCalendarEvents).values(event).returning();
    return newEvent;
  }

  async updateVaCalendarEvent(id: number, updates: Partial<InsertVaCalendarEvent>) {
    const [updated] = await db.update(vaCalendarEvents)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vaCalendarEvents.id, id))
      .returning();
    return updated;
  }

  async deleteVaCalendarEvent(id: number) {
    await db.delete(vaCalendarEvents).where(eq(vaCalendarEvents.id, id));
  }

  // VA Templates
  async getVaTemplates(orgId: number, category?: string) {
    const conditions = [eq(vaTemplates.organizationId, orgId)];
    if (category) {
      conditions.push(eq(vaTemplates.category, category));
    }
    
    return await db.select().from(vaTemplates)
      .where(and(...conditions))
      .orderBy(vaTemplates.name);
  }

  async createVaTemplate(template: InsertVaTemplate) {
    const [newTemplate] = await db.insert(vaTemplates).values(template).returning();
    return newTemplate;
  }

  async updateVaTemplate(id: number, updates: Partial<InsertVaTemplate>) {
    const [updated] = await db.update(vaTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vaTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteVaTemplate(id: number) {
    await db.delete(vaTemplates).where(eq(vaTemplates.id, id));
  }

  // Due Diligence Templates
  async getDueDiligenceTemplates(orgId: number) {
    return await db.select().from(dueDiligenceTemplates)
      .where(eq(dueDiligenceTemplates.organizationId, orgId))
      .orderBy(desc(dueDiligenceTemplates.isDefault), dueDiligenceTemplates.name);
  }

  async getDueDiligenceTemplate(id: number) {
    const [template] = await db.select().from(dueDiligenceTemplates)
      .where(eq(dueDiligenceTemplates.id, id));
    return template;
  }

  async createDueDiligenceTemplate(template: InsertDueDiligenceTemplate) {
    const [newTemplate] = await db.insert(dueDiligenceTemplates).values(template).returning();
    return newTemplate;
  }

  async updateDueDiligenceTemplate(id: number, updates: Partial<InsertDueDiligenceTemplate>) {
    const [updated] = await db.update(dueDiligenceTemplates)
      .set(updates)
      .where(eq(dueDiligenceTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteDueDiligenceTemplate(id: number) {
    await db.delete(dueDiligenceTemplates).where(eq(dueDiligenceTemplates.id, id));
  }

  async initializeDefaultTemplates(orgId: number) {
    const existing = await this.getDueDiligenceTemplates(orgId);
    if (existing.length > 0) {
      return existing;
    }

    const templates: DueDiligenceTemplate[] = [];
    for (const templateData of DEFAULT_DUE_DILIGENCE_TEMPLATES) {
      const template = await this.createDueDiligenceTemplate({
        organizationId: orgId,
        name: templateData.name,
        items: templateData.items as any,
        isDefault: true,
      });
      templates.push(template);
    }
    return templates;
  }

  // Due Diligence Items (property checklist)
  async getPropertyDueDiligence(propertyId: number) {
    return await db.select().from(dueDiligenceItems)
      .where(eq(dueDiligenceItems.propertyId, propertyId))
      .orderBy(dueDiligenceItems.category, dueDiligenceItems.itemName);
  }

  async createDueDiligenceItem(item: InsertDueDiligenceItem) {
    const [newItem] = await db.insert(dueDiligenceItems).values(item).returning();
    return newItem;
  }

  async updateDueDiligenceItem(id: number, updates: Partial<InsertDueDiligenceItem>) {
    const updateData: any = { ...updates };
    if (updates.completed === true && !updates.completedAt) {
      updateData.completedAt = new Date();
    }
    if (updates.completed === false) {
      updateData.completedAt = null;
      updateData.completedBy = null;
    }
    const [updated] = await db.update(dueDiligenceItems)
      .set(updateData)
      .where(eq(dueDiligenceItems.id, id))
      .returning();
    return updated;
  }

  async deleteDueDiligenceItem(id: number) {
    await db.delete(dueDiligenceItems).where(eq(dueDiligenceItems.id, id));
  }

  async applyTemplateToProperty(propertyId: number, templateId: number) {
    const template = await this.getDueDiligenceTemplate(templateId);
    if (!template) {
      throw new Error("Template not found");
    }

    await db.delete(dueDiligenceItems).where(eq(dueDiligenceItems.propertyId, propertyId));

    const items: DueDiligenceItem[] = [];
    for (const templateItem of template.items) {
      const item = await this.createDueDiligenceItem({
        propertyId,
        templateId,
        itemName: templateItem.name,
        category: templateItem.category,
        completed: false,
        notes: templateItem.description || null,
      });
      items.push(item);
    }
    return items;
  }

  // Deal Checklist Templates
  async getChecklistTemplates(orgId: number) {
    return await db.select().from(checklistTemplates)
      .where(eq(checklistTemplates.organizationId, orgId))
      .orderBy(checklistTemplates.name);
  }

  async getChecklistTemplate(id: number) {
    const [template] = await db.select().from(checklistTemplates)
      .where(eq(checklistTemplates.id, id));
    return template;
  }

  async createChecklistTemplate(template: InsertChecklistTemplate) {
    const [newTemplate] = await db.insert(checklistTemplates).values(template).returning();
    return newTemplate;
  }

  async updateChecklistTemplate(id: number, updates: Partial<InsertChecklistTemplate>) {
    const [updated] = await db.update(checklistTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(checklistTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteChecklistTemplate(id: number) {
    await db.delete(checklistTemplates).where(eq(checklistTemplates.id, id));
  }

  async initializeDefaultChecklistTemplates(orgId: number) {
    const existing = await this.getChecklistTemplates(orgId);
    if (existing.length > 0) {
      return existing;
    }

    const templates: ChecklistTemplate[] = [];
    for (const templateData of DEFAULT_DEAL_CHECKLIST_TEMPLATES) {
      const template = await this.createChecklistTemplate({
        organizationId: orgId,
        name: templateData.name,
        description: templateData.description,
        dealType: templateData.dealType,
        items: templateData.items,
      });
      templates.push(template);
    }
    return templates;
  }

  // Deal Checklists
  async getDealChecklist(dealId: number) {
    const [checklist] = await db.select().from(dealChecklists)
      .where(eq(dealChecklists.dealId, dealId));
    return checklist;
  }

  async createDealChecklist(checklist: InsertDealChecklist) {
    const [newChecklist] = await db.insert(dealChecklists).values(checklist).returning();
    return newChecklist;
  }

  async updateDealChecklist(id: number, updates: Partial<InsertDealChecklist>) {
    const [updated] = await db.update(dealChecklists)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dealChecklists.id, id))
      .returning();
    return updated;
  }

  async applyChecklistTemplateToDeal(dealId: number, templateId: number) {
    const template = await this.getChecklistTemplate(templateId);
    if (!template) {
      throw new Error("Template not found");
    }

    await db.delete(dealChecklists).where(eq(dealChecklists.dealId, dealId));

    const items: DealChecklistItem[] = template.items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      required: item.required,
      documentRequired: item.documentRequired,
    }));

    const checklist = await this.createDealChecklist({
      dealId,
      templateId,
      items,
    });
    return checklist;
  }

  async updateDealChecklistItem(
    dealId: number, 
    itemId: string, 
    updates: { checked?: boolean; documentUrl?: string; checkedBy?: string }
  ) {
    const checklist = await this.getDealChecklist(dealId);
    if (!checklist) {
      throw new Error("Checklist not found for this deal");
    }

    const updatedItems = checklist.items.map(item => {
      if (item.id === itemId) {
        const updatedItem = { ...item };
        if (updates.checked !== undefined) {
          if (updates.checked) {
            updatedItem.checkedAt = new Date().toISOString();
            updatedItem.checkedBy = updates.checkedBy;
          } else {
            updatedItem.checkedAt = undefined;
            updatedItem.checkedBy = undefined;
          }
        }
        if (updates.documentUrl !== undefined) {
          updatedItem.documentUrl = updates.documentUrl;
        }
        return updatedItem;
      }
      return item;
    });

    const allComplete = updatedItems.every(item => item.checkedAt);
    const completedAt = allComplete ? new Date() : null;

    return await this.updateDealChecklist(checklist.id, {
      items: updatedItems,
      completedAt,
    });
  }

  async checkStageGate(dealId: number): Promise<{ canAdvance: boolean; incompleteItems: DealChecklistItem[] }> {
    const checklist = await this.getDealChecklist(dealId);
    if (!checklist) {
      return { canAdvance: true, incompleteItems: [] };
    }

    const incompleteItems = checklist.items.filter(item => 
      item.required && !item.checkedAt
    );

    return {
      canAdvance: incompleteItems.length === 0,
      incompleteItems,
    };
  }

  // Usage Records
  async getUsageRecords(orgId: number, limit: number = 50) {
    return await db.select().from(usageRecords)
      .where(eq(usageRecords.organizationId, orgId))
      .orderBy(desc(usageRecords.createdAt))
      .limit(limit);
  }

  async getUsageSummaryByMonth(orgId: number, month: string) {
    const results = await db
      .select({
        actionType: usageRecords.actionType,
        count: sql<number>`SUM(${usageRecords.quantity})::int`,
        totalCost: sql<number>`SUM(${usageRecords.totalCostCents})::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, orgId),
          eq(usageRecords.billingMonth, month)
        )
      )
      .groupBy(usageRecords.actionType);
    
    return results;
  }

  // Credit Transactions
  async getCreditTransactions(orgId: number, limit: number = 50) {
    return await db.select().from(creditTransactions)
      .where(eq(creditTransactions.organizationId, orgId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit);
  }

  async getCreditBalance(orgId: number) {
    const [org] = await db.select().from(organizations)
      .where(eq(organizations.id, orgId));
    return Number(org?.creditBalance || 0);
  }

  // Support Cases
  async createSupportCase(input: InsertSupportCase) {
    const [newCase] = await db.insert(supportCases).values(input).returning();
    return newCase;
  }

  async getSupportCase(id: number) {
    const [supportCase] = await db.select().from(supportCases)
      .where(eq(supportCases.id, id));
    return supportCase;
  }

  async getSupportCases(organizationId: number, status?: string) {
    const conditions = [eq(supportCases.organizationId, organizationId)];
    if (status) {
      conditions.push(eq(supportCases.status, status));
    }
    return await db.select().from(supportCases)
      .where(and(...conditions))
      .orderBy(desc(supportCases.createdAt));
  }

  async updateSupportCase(id: number, data: Partial<InsertSupportCase>) {
    const [updated] = await db.update(supportCases)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(supportCases.id, id))
      .returning();
    return updated;
  }

  async getEscalatedCases() {
    return await db.select().from(supportCases)
      .where(eq(supportCases.status, "escalated"))
      .orderBy(desc(supportCases.createdAt));
  }

  // Support Messages
  async createSupportMessage(input: InsertSupportMessage) {
    const [newMessage] = await db.insert(supportMessages).values(input).returning();
    return newMessage;
  }

  async getSupportMessages(caseId: number) {
    return await db.select().from(supportMessages)
      .where(eq(supportMessages.caseId, caseId))
      .orderBy(supportMessages.createdAt);
  }

  // Support Actions
  async createSupportAction(input: InsertSupportAction) {
    const [newAction] = await db.insert(supportActions).values(input).returning();
    return newAction;
  }

  async getSupportActions(caseId: number) {
    return await db.select().from(supportActions)
      .where(eq(supportActions.caseId, caseId))
      .orderBy(desc(supportActions.createdAt));
  }

  // Support Playbooks
  async getSupportPlaybooks(category?: string) {
    if (category) {
      return await db.select().from(supportPlaybooks)
        .where(and(
          eq(supportPlaybooks.category, category),
          eq(supportPlaybooks.isActive, true)
        ))
        .orderBy(supportPlaybooks.name);
    }
    return await db.select().from(supportPlaybooks)
      .where(eq(supportPlaybooks.isActive, true))
      .orderBy(supportPlaybooks.name);
  }

  async getSupportPlaybook(slug: string) {
    const [playbook] = await db.select().from(supportPlaybooks)
      .where(eq(supportPlaybooks.slug, slug));
    return playbook;
  }

  async incrementPlaybookUsage(slug: string, success: boolean) {
    const playbook = await this.getSupportPlaybook(slug);
    if (playbook) {
      const currentUsage = playbook.timesUsed || 0;
      const currentRate = Number(playbook.successRate) || 0;
      const newUsage = currentUsage + 1;
      const newRate = success
        ? String((currentRate * currentUsage + 100) / newUsage)
        : String((currentRate * currentUsage) / newUsage);
      
      await db.update(supportPlaybooks)
        .set({
          timesUsed: newUsage,
          successRate: newRate,
          updatedAt: new Date(),
        })
        .where(eq(supportPlaybooks.slug, slug));
    }
  }

  // Dunning Events
  async createDunningEvent(event: InsertDunningEvent) {
    const [newEvent] = await db.insert(dunningEvents).values(event).returning();
    return newEvent;
  }

  async getDunningEvents(orgId: number, status?: string) {
    if (status) {
      return await db.select().from(dunningEvents)
        .where(and(
          eq(dunningEvents.organizationId, orgId),
          eq(dunningEvents.status, status)
        ))
        .orderBy(desc(dunningEvents.createdAt));
    }
    return await db.select().from(dunningEvents)
      .where(eq(dunningEvents.organizationId, orgId))
      .orderBy(desc(dunningEvents.createdAt));
  }

  async getPendingDunningEvent(orgId: number, stripeInvoiceId: string) {
    const [event] = await db.select().from(dunningEvents)
      .where(and(
        eq(dunningEvents.organizationId, orgId),
        eq(dunningEvents.stripeInvoiceId, stripeInvoiceId),
        or(
          eq(dunningEvents.status, "pending"),
          eq(dunningEvents.status, "scheduled_retry")
        )
      ));
    return event;
  }

  async updateDunningEvent(id: number, updates: Partial<InsertDunningEvent>) {
    const [updated] = await db.update(dunningEvents)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dunningEvents.id, id))
      .returning();
    return updated;
  }

  async resolveDunningEvents(orgId: number, stripeInvoiceId: string, resolutionType: string) {
    await db.update(dunningEvents)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolutionType,
        updatedAt: new Date(),
      })
      .where(and(
        eq(dunningEvents.organizationId, orgId),
        eq(dunningEvents.stripeInvoiceId, stripeInvoiceId),
        or(
          eq(dunningEvents.status, "pending"),
          eq(dunningEvents.status, "scheduled_retry")
        )
      ));
  }

  async getOrganizationsInDunning() {
    return await db.select().from(organizations)
      .where(and(
        sql`${organizations.dunningStage} IS NOT NULL`,
        sql`${organizations.dunningStage} != 'none'`
      ));
  }

  // System Alerts
  async createSystemAlert(alert: InsertSystemAlert) {
    const [newAlert] = await db.insert(systemAlerts).values(alert).returning();
    return newAlert;
  }

  async getSystemAlerts(orgId?: number, status?: string) {
    const conditions = [];
    if (orgId) conditions.push(eq(systemAlerts.organizationId, orgId));
    if (status) conditions.push(eq(systemAlerts.status, status));
    
    if (conditions.length > 0) {
      return await db.select().from(systemAlerts)
        .where(and(...conditions))
        .orderBy(desc(systemAlerts.createdAt));
    }
    return await db.select().from(systemAlerts)
      .orderBy(desc(systemAlerts.createdAt));
  }

  async updateSystemAlert(id: number, updates: Partial<InsertSystemAlert>) {
    const [updated] = await db.update(systemAlerts)
      .set(updates)
      .where(eq(systemAlerts.id, id))
      .returning();
    return updated;
  }

  async acknowledgeAlert(id: number) {
    const [updated] = await db.update(systemAlerts)
      .set({ status: "acknowledged", acknowledgedAt: new Date() })
      .where(eq(systemAlerts.id, id))
      .returning();
    return updated;
  }

  async resolveAlert(id: number) {
    const [updated] = await db.update(systemAlerts)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(systemAlerts.id, id))
      .returning();
    return updated;
  }

  async getAllOrganizations() {
    return await db.select().from(organizations)
      .orderBy(desc(organizations.createdAt));
  }

  async getAdminDashboardData() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const allOrgs = await db.select().from(organizations);
    const allTeamMembers = await db.select().from(teamMembers);
    
    const orgsByTier = allOrgs.reduce((acc, org) => {
      acc[org.subscriptionTier] = (acc[org.subscriptionTier] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const orgsInDunning = allOrgs.filter(org => org.dunningStage && org.dunningStage !== 'none');
    const dunningByStage = orgsInDunning.reduce((acc, org) => {
      acc[org.dunningStage!] = (acc[org.dunningStage!] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const activeUsers = allTeamMembers.filter(m => m.isActive).length;
    const newSignupsThisWeek = allOrgs.filter(org => 
      org.createdAt && new Date(org.createdAt) >= sevenDaysAgo
    ).length;

    const allAlerts = await this.getSystemAlerts();
    const unresolvedAlerts = allAlerts.filter(a => a.status !== 'resolved' && a.status !== 'dismissed');
    const alertsBySeverity = unresolvedAlerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const criticalAlerts = unresolvedAlerts.filter(a => a.severity === 'critical').slice(0, 5);

    const creditTransactionsThisMonth = await db.select().from(creditTransactions)
      .where(gte(creditTransactions.createdAt, startOfMonth));
    const creditSalesThisMonth = creditTransactionsThisMonth
      .filter(t => t.type === 'purchase')
      .reduce((sum, t) => sum + Number(t.amountCents || 0), 0);

    const totalMrr = allOrgs.reduce((sum, org) => {
      if (org.subscriptionStatus !== 'active') return sum;
      const tierPrices: Record<string, number> = { free: 0, starter: 4900, pro: 9900, scale: 19900 };
      return sum + (tierPrices[org.subscriptionTier] || 0);
    }, 0);

    const mrrAtRisk = orgsInDunning.reduce((sum, org) => {
      const tierPrices: Record<string, number> = { free: 0, starter: 4900, pro: 9900, scale: 19900 };
      return sum + (tierPrices[org.subscriptionTier] || 0);
    }, 0);

    const allAgentTasks = await db.select().from(agentTasks)
      .orderBy(desc(agentTasks.createdAt))
      .limit(500);

    const leadNurturerTasks = allAgentTasks.filter(t => t.agentType === 'lead_nurturing');
    const campaignOptimizerTasks = allAgentTasks.filter(t => t.agentType === 'campaign_optimizer');
    const financeAgentTasks = allAgentTasks.filter(t => t.agentType === 'finance_agent');

    const getAgentStatus = (tasks: typeof allAgentTasks) => {
      const completed = tasks.filter(t => t.status === 'completed');
      const pending = tasks.filter(t => t.status === 'pending' || t.status === 'queued');
      const failed = tasks.filter(t => t.status === 'failed');
      const lastRun = tasks.find(t => t.status === 'completed')?.completedAt;
      return {
        lastRun: lastRun ? new Date(lastRun).toISOString() : null,
        processed: completed.length,
        pending: pending.length,
        failed: failed.length,
        status: pending.length > 10 ? 'busy' : failed.length > 5 ? 'warning' : 'healthy'
      };
    };

    return {
      revenue: {
        mrr: totalMrr,
        creditSalesThisMonth,
        totalRevenueThisMonth: totalMrr + creditSalesThisMonth,
        mrrAtRisk
      },
      systemHealth: {
        activeOrganizations: allOrgs.length,
        totalUsers: allTeamMembers.length,
        activeUsers,
        uptime: 99.9
      },
      agents: {
        leadNurturer: getAgentStatus(leadNurturerTasks),
        campaignOptimizer: getAgentStatus(campaignOptimizerTasks),
        financeAgent: getAgentStatus(financeAgentTasks),
        apiQueue: {
          pending: allAgentTasks.filter(t => t.status === 'pending' || t.status === 'queued').length,
          failed: allAgentTasks.filter(t => t.status === 'failed').length
        }
      },
      alerts: {
        bySeverity: alertsBySeverity,
        total: unresolvedAlerts.length,
        critical: criticalAlerts
      },
      revenueAtRisk: {
        dunningByStage,
        totalMrrAtRisk: mrrAtRisk,
        orgsApproachingCreditExhaustion: allOrgs.filter(org => 
          Number(org.creditBalance || 0) < 500 && Number(org.creditBalance || 0) > 0
        ).length
      },
      userActivity: {
        activeUsers,
        newSignupsThisWeek,
        organizationsByTier: orgsByTier
      }
    };
  }

  // Payment Reminders (Finance Agent)
  async getDelinquentNotes(orgId: number) {
    const now = new Date();
    return await db.select().from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active"),
        lte(notes.nextPaymentDate, now)
      ))
      .orderBy(notes.nextPaymentDate);
  }

  async getPendingReminders(limit = 50) {
    const now = new Date();
    return await db.select().from(paymentReminders)
      .where(and(
        eq(paymentReminders.status, "scheduled"),
        lte(paymentReminders.scheduledFor, now)
      ))
      .orderBy(paymentReminders.scheduledFor)
      .limit(limit);
  }

  async getRemindersForNote(noteId: number) {
    return await db.select().from(paymentReminders)
      .where(eq(paymentReminders.noteId, noteId))
      .orderBy(desc(paymentReminders.createdAt));
  }

  async createPaymentReminder(reminder: InsertPaymentReminder) {
    const [newReminder] = await db.insert(paymentReminders).values(reminder).returning();
    return newReminder;
  }

  async updatePaymentReminder(id: number, updates: Partial<InsertPaymentReminder>) {
    const [updated] = await db.update(paymentReminders)
      .set(updates)
      .where(eq(paymentReminders.id, id))
      .returning();
    return updated;
  }

  async markReminderSent(id: number) {
    const [updated] = await db.update(paymentReminders)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(paymentReminders.id, id))
      .returning();
    return updated;
  }

  async getNotesNeedingReminders(orgId: number) {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    
    return await db.select().from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active"),
        lte(notes.nextPaymentDate, threeDaysFromNow),
        or(
          sql`${notes.lastReminderSentAt} IS NULL`,
          lte(notes.lastReminderSentAt, threeDaysAgo)
        )
      ))
      .orderBy(notes.nextPaymentDate);
  }

  async getNotesWithUpcomingPayments(orgId: number, daysAhead: number) {
    const now = new Date();
    const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    
    return await db.select().from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active"),
        gte(notes.nextPaymentDate, now),
        lte(notes.nextPaymentDate, futureDate)
      ))
      .orderBy(notes.nextPaymentDate);
  }

  async getFinancePortfolioHealth(orgId: number) {
    const activeNotes = await db.select().from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active")
      ));
    
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const remindersSent = await db.select({ count: count() })
      .from(paymentReminders)
      .where(and(
        eq(paymentReminders.organizationId, orgId),
        eq(paymentReminders.status, "sent"),
        gte(paymentReminders.sentAt, startOfMonth)
      ));
    
    const stats = {
      totalActiveNotes: activeNotes.length,
      totalBalance: activeNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0),
      currentNotes: 0,
      earlyDelinquent: 0,
      delinquent: 0,
      seriouslyDelinquent: 0,
      defaultCandidates: 0,
      remindersSentThisMonth: remindersSent[0]?.count || 0,
      collectionsThisMonth: 0,
    };
    
    for (const note of activeNotes) {
      const delinquencyStatus = note.delinquencyStatus || "current";
      switch (delinquencyStatus) {
        case "current":
          stats.currentNotes++;
          break;
        case "early_delinquent":
          stats.earlyDelinquent++;
          break;
        case "delinquent":
          stats.delinquent++;
          break;
        case "seriously_delinquent":
          stats.seriouslyDelinquent++;
          break;
        case "default_candidate":
          stats.defaultCandidates++;
          stats.collectionsThisMonth++;
          break;
      }
    }
    
    return stats;
  }

  // Organization Integrations CRUD
  async getOrganizationIntegrations(orgId: number): Promise<OrganizationIntegration[]> {
    return await db.select().from(organizationIntegrations)
      .where(eq(organizationIntegrations.organizationId, orgId))
      .orderBy(organizationIntegrations.provider);
  }

  async getOrganizationIntegration(orgId: number, provider: string): Promise<OrganizationIntegration | undefined> {
    const [integration] = await db.select().from(organizationIntegrations)
      .where(and(
        eq(organizationIntegrations.organizationId, orgId),
        eq(organizationIntegrations.provider, provider)
      ));
    return integration;
  }

  async upsertOrganizationIntegration(data: InsertOrganizationIntegration): Promise<OrganizationIntegration> {
    const existing = await this.getOrganizationIntegration(data.organizationId, data.provider);
    
    if (existing) {
      const [updated] = await db.update(organizationIntegrations)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(organizationIntegrations.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(organizationIntegrations).values(data).returning();
      return created;
    }
  }

  async deleteOrganizationIntegration(orgId: number, provider: string): Promise<void> {
    await db.delete(organizationIntegrations)
      .where(and(
        eq(organizationIntegrations.organizationId, orgId),
        eq(organizationIntegrations.provider, provider)
      ));
  }

  async updateIntegrationValidation(orgId: number, provider: string, validatedAt: Date | null, error: string | null): Promise<void> {
    await db.update(organizationIntegrations)
      .set({
        lastValidatedAt: validatedAt,
        validationError: error,
        updatedAt: new Date(),
      })
      .where(and(
        eq(organizationIntegrations.organizationId, orgId),
        eq(organizationIntegrations.provider, provider)
      ));
  }

  // Verified Email Domains CRUD
  async getVerifiedEmailDomains(orgId: number): Promise<VerifiedEmailDomain[]> {
    return await db.select().from(verifiedEmailDomains)
      .where(eq(verifiedEmailDomains.organizationId, orgId))
      .orderBy(desc(verifiedEmailDomains.isDefault), verifiedEmailDomains.domain);
  }

  async getVerifiedEmailDomain(id: number): Promise<VerifiedEmailDomain | undefined> {
    const [domain] = await db.select().from(verifiedEmailDomains)
      .where(eq(verifiedEmailDomains.id, id));
    return domain;
  }

  async createVerifiedEmailDomain(data: InsertVerifiedEmailDomain): Promise<VerifiedEmailDomain> {
    const [domain] = await db.insert(verifiedEmailDomains).values(data).returning();
    return domain;
  }

  async updateVerifiedEmailDomain(id: number, data: Partial<InsertVerifiedEmailDomain>): Promise<VerifiedEmailDomain> {
    const [domain] = await db.update(verifiedEmailDomains)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(verifiedEmailDomains.id, id))
      .returning();
    return domain;
  }

  async deleteVerifiedEmailDomain(id: number): Promise<void> {
    await db.delete(verifiedEmailDomains).where(eq(verifiedEmailDomains.id, id));
  }

  // Provisioned Phone Numbers CRUD
  async getProvisionedPhoneNumbers(orgId: number): Promise<ProvisionedPhoneNumber[]> {
    return await db.select().from(provisionedPhoneNumbers)
      .where(eq(provisionedPhoneNumbers.organizationId, orgId))
      .orderBy(desc(provisionedPhoneNumbers.isDefault), provisionedPhoneNumbers.phoneNumber);
  }

  async getProvisionedPhoneNumber(id: number): Promise<ProvisionedPhoneNumber | undefined> {
    const [phone] = await db.select().from(provisionedPhoneNumbers)
      .where(eq(provisionedPhoneNumbers.id, id));
    return phone;
  }

  async createProvisionedPhoneNumber(data: InsertProvisionedPhoneNumber): Promise<ProvisionedPhoneNumber> {
    const [phone] = await db.insert(provisionedPhoneNumbers).values(data).returning();
    return phone;
  }

  async updateProvisionedPhoneNumber(id: number, data: Partial<InsertProvisionedPhoneNumber>): Promise<ProvisionedPhoneNumber> {
    const [phone] = await db.update(provisionedPhoneNumbers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(provisionedPhoneNumbers.id, id))
      .returning();
    return phone;
  }

  async deleteProvisionedPhoneNumber(id: number): Promise<void> {
    await db.delete(provisionedPhoneNumbers).where(eq(provisionedPhoneNumbers.id, id));
  }

  // Campaign Responses CRUD
  async getCampaignResponses(orgId: number, campaignId?: number): Promise<CampaignResponse[]> {
    const conditions = [eq(campaignResponses.organizationId, orgId)];
    if (campaignId) {
      conditions.push(eq(campaignResponses.campaignId, campaignId));
    }
    return await db.select().from(campaignResponses)
      .where(and(...conditions))
      .orderBy(desc(campaignResponses.responseDate));
  }

  async getCampaignResponse(id: number): Promise<CampaignResponse | undefined> {
    const [response] = await db.select().from(campaignResponses)
      .where(eq(campaignResponses.id, id));
    return response;
  }

  async createCampaignResponse(data: InsertCampaignResponse): Promise<CampaignResponse> {
    const [response] = await db.insert(campaignResponses).values(data).returning();
    return response;
  }

  async updateCampaignResponse(id: number, data: Partial<InsertCampaignResponse>): Promise<CampaignResponse> {
    const [response] = await db.update(campaignResponses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(campaignResponses.id, id))
      .returning();
    return response;
  }

  async deleteCampaignResponse(id: number): Promise<void> {
    await db.delete(campaignResponses).where(eq(campaignResponses.id, id));
  }

  async getCampaignByTrackingCode(trackingCode: string): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns)
      .where(eq(campaigns.trackingCode, trackingCode));
    return campaign;
  }

  async getCampaignResponsesCount(campaignId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(campaignResponses)
      .where(eq(campaignResponses.campaignId, campaignId));
    return result?.count || 0;
  }

  async getResponsesCountByOrg(orgId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(campaignResponses)
      .where(eq(campaignResponses.organizationId, orgId));
    return result?.count || 0;
  }

  generateTrackingCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'CAMP-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Activity Events CRUD (Communication Timeline)
  async getActivityEvents(
    orgId: number, 
    entityType: string, 
    entityId: number,
    eventTypes?: string[]
  ): Promise<ActivityEvent[]> {
    const conditions = [
      eq(activityEvents.organizationId, orgId),
      eq(activityEvents.entityType, entityType),
      eq(activityEvents.entityId, entityId),
    ];
    
    let query = db.select().from(activityEvents)
      .where(and(...conditions))
      .orderBy(desc(activityEvents.eventDate));
    
    const results = await query;
    
    if (eventTypes && eventTypes.length > 0) {
      return results.filter(e => eventTypes.includes(e.eventType));
    }
    
    return results;
  }

  async createActivityEvent(data: InsertActivityEvent): Promise<ActivityEvent> {
    const [event] = await db.insert(activityEvents).values(data).returning();
    return event;
  }

  async getActivityEventsByEntity(
    orgId: number, 
    entityType: string, 
    entityId: number, 
    limit?: number
  ): Promise<ActivityEvent[]> {
    let query = db.select().from(activityEvents)
      .where(and(
        eq(activityEvents.organizationId, orgId),
        eq(activityEvents.entityType, entityType),
        eq(activityEvents.entityId, entityId)
      ))
      .orderBy(desc(activityEvents.eventDate));
    
    if (limit) {
      return await query.limit(limit);
    }
    
    return await query;
  }

  async getRecentActivityEvents(orgId: number, limit: number = 50): Promise<ActivityEvent[]> {
    return await db.select().from(activityEvents)
      .where(eq(activityEvents.organizationId, orgId))
      .orderBy(desc(activityEvents.eventDate))
      .limit(limit);
  }

  // Campaign Sequences
  async getSequences(orgId: number): Promise<CampaignSequence[]> {
    return await db.select().from(campaignSequences)
      .where(eq(campaignSequences.organizationId, orgId))
      .orderBy(desc(campaignSequences.createdAt));
  }

  async getSequence(orgId: number, id: number): Promise<CampaignSequence | undefined> {
    const [sequence] = await db.select().from(campaignSequences)
      .where(and(eq(campaignSequences.organizationId, orgId), eq(campaignSequences.id, id)));
    return sequence;
  }

  async createSequence(sequence: InsertCampaignSequence): Promise<CampaignSequence> {
    const [newSequence] = await db.insert(campaignSequences).values(sequence).returning();
    return newSequence;
  }

  async updateSequence(id: number, updates: Partial<InsertCampaignSequence>): Promise<CampaignSequence> {
    const [updated] = await db.update(campaignSequences)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(campaignSequences.id, id))
      .returning();
    return updated;
  }

  async deleteSequence(id: number): Promise<void> {
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, id));
    await db.delete(sequenceSteps).where(eq(sequenceSteps.sequenceId, id));
    await db.delete(campaignSequences).where(eq(campaignSequences.id, id));
  }

  // Sequence Steps
  async getSequenceSteps(sequenceId: number): Promise<SequenceStep[]> {
    return await db.select().from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, sequenceId))
      .orderBy(sequenceSteps.stepNumber);
  }

  async createSequenceStep(step: InsertSequenceStep): Promise<SequenceStep> {
    const [newStep] = await db.insert(sequenceSteps).values(step).returning();
    return newStep;
  }

  async updateSequenceStep(id: number, updates: Partial<InsertSequenceStep>): Promise<SequenceStep> {
    const [updated] = await db.update(sequenceSteps)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sequenceSteps.id, id))
      .returning();
    return updated;
  }

  async deleteSequenceStep(id: number): Promise<void> {
    await db.delete(sequenceSteps).where(eq(sequenceSteps.id, id));
  }

  async reorderSequenceSteps(sequenceId: number, stepIds: number[]): Promise<void> {
    for (let i = 0; i < stepIds.length; i++) {
      await db.update(sequenceSteps)
        .set({ stepNumber: i + 1, updatedAt: new Date() })
        .where(and(eq(sequenceSteps.id, stepIds[i]), eq(sequenceSteps.sequenceId, sequenceId)));
    }
  }

  // Sequence Enrollments
  async getSequenceEnrollments(sequenceId: number): Promise<SequenceEnrollment[]> {
    return await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.sequenceId, sequenceId))
      .orderBy(desc(sequenceEnrollments.enrolledAt));
  }

  async getLeadEnrollments(leadId: number): Promise<SequenceEnrollment[]> {
    return await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.leadId, leadId))
      .orderBy(desc(sequenceEnrollments.enrolledAt));
  }

  async getActiveEnrollments(orgId: number): Promise<(SequenceEnrollment & { sequence: CampaignSequence; lead: Lead })[]> {
    const results = await db.select({
      enrollment: sequenceEnrollments,
      sequence: campaignSequences,
      lead: leads,
    })
      .from(sequenceEnrollments)
      .innerJoin(campaignSequences, eq(sequenceEnrollments.sequenceId, campaignSequences.id))
      .innerJoin(leads, eq(sequenceEnrollments.leadId, leads.id))
      .where(and(
        eq(campaignSequences.organizationId, orgId),
        eq(sequenceEnrollments.status, "active")
      ))
      .orderBy(desc(sequenceEnrollments.enrolledAt));

    return results.map(r => ({ ...r.enrollment, sequence: r.sequence, lead: r.lead }));
  }

  async getEnrollmentsDueForProcessing(): Promise<(SequenceEnrollment & { sequence: CampaignSequence; lead: Lead })[]> {
    const now = new Date();
    const results = await db.select({
      enrollment: sequenceEnrollments,
      sequence: campaignSequences,
      lead: leads,
    })
      .from(sequenceEnrollments)
      .innerJoin(campaignSequences, eq(sequenceEnrollments.sequenceId, campaignSequences.id))
      .innerJoin(leads, eq(sequenceEnrollments.leadId, leads.id))
      .where(and(
        eq(sequenceEnrollments.status, "active"),
        eq(campaignSequences.isActive, true),
        lte(sequenceEnrollments.nextStepScheduledAt, now)
      ))
      .orderBy(sequenceEnrollments.nextStepScheduledAt);

    return results.map(r => ({ ...r.enrollment, sequence: r.sequence, lead: r.lead }));
  }

  async createSequenceEnrollment(enrollment: InsertSequenceEnrollment): Promise<SequenceEnrollment> {
    const [newEnrollment] = await db.insert(sequenceEnrollments).values(enrollment).returning();
    return newEnrollment;
  }

  async updateSequenceEnrollment(id: number, updates: Partial<InsertSequenceEnrollment>): Promise<SequenceEnrollment> {
    const [updated] = await db.update(sequenceEnrollments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sequenceEnrollments.id, id))
      .returning();
    return updated;
  }

  async pauseEnrollment(id: number, reason: string): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(id, { status: "paused", pauseReason: reason });
  }

  async resumeEnrollment(id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(id, { status: "active", pauseReason: null });
  }

  async cancelEnrollment(id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(id, { status: "cancelled" });
  }

  async completeEnrollment(id: number): Promise<SequenceEnrollment> {
    return this.updateSequenceEnrollment(id, { status: "completed", completedAt: new Date() });
  }

  async getSequenceStats(orgId: number): Promise<{ sequenceId: number; name: string; totalEnrollments: number; activeEnrollments: number; completedEnrollments: number }[]> {
    const sequences = await this.getSequences(orgId);
    const stats = [];

    for (const seq of sequences) {
      const enrollments = await this.getSequenceEnrollments(seq.id);
      stats.push({
        sequenceId: seq.id,
        name: seq.name,
        totalEnrollments: enrollments.length,
        activeEnrollments: enrollments.filter(e => e.status === "active").length,
        completedEnrollments: enrollments.filter(e => e.status === "completed").length,
      });
    }

    return stats;
  }

  // A/B Tests
  async getAbTests(orgId: number): Promise<AbTest[]> {
    return await db.select().from(abTests)
      .where(eq(abTests.organizationId, orgId))
      .orderBy(desc(abTests.createdAt));
  }

  async getAbTest(orgId: number, id: number): Promise<AbTest | undefined> {
    const [test] = await db.select().from(abTests)
      .where(and(eq(abTests.organizationId, orgId), eq(abTests.id, id)));
    return test;
  }

  async getAbTestByCampaign(campaignId: number): Promise<AbTest | undefined> {
    const [test] = await db.select().from(abTests)
      .where(eq(abTests.campaignId, campaignId));
    return test;
  }

  async createAbTest(test: InsertAbTest): Promise<AbTest> {
    const [newTest] = await db.insert(abTests).values(test).returning();
    return newTest;
  }

  async updateAbTest(id: number, updates: Partial<InsertAbTest>): Promise<AbTest> {
    const [updated] = await db.update(abTests)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(abTests.id, id))
      .returning();
    return updated;
  }

  async deleteAbTest(id: number): Promise<void> {
    await db.delete(abTestVariants).where(eq(abTestVariants.testId, id));
    await db.delete(abTests).where(eq(abTests.id, id));
  }

  // A/B Test Variants
  async getAbTestVariants(testId: number): Promise<AbTestVariant[]> {
    return await db.select().from(abTestVariants)
      .where(eq(abTestVariants.testId, testId))
      .orderBy(abTestVariants.id);
  }

  async createAbTestVariant(variant: InsertAbTestVariant): Promise<AbTestVariant> {
    const [newVariant] = await db.insert(abTestVariants).values(variant).returning();
    return newVariant;
  }

  async updateAbTestVariant(id: number, updates: Partial<InsertAbTestVariant>): Promise<AbTestVariant> {
    const [updated] = await db.update(abTestVariants)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(abTestVariants.id, id))
      .returning();
    return updated;
  }

  async deleteAbTestVariant(id: number): Promise<void> {
    await db.delete(abTestVariants).where(eq(abTestVariants.id, id));
  }

  async getAbTestWithVariants(orgId: number, testId: number): Promise<{ test: AbTest; variants: AbTestVariant[] } | undefined> {
    const test = await this.getAbTest(orgId, testId);
    if (!test) return undefined;
    const variants = await this.getAbTestVariants(testId);
    return { test, variants };
  }

  // Custom Field Definitions
  async getCustomFieldDefinitions(orgId: number, entityType?: string): Promise<CustomFieldDefinition[]> {
    if (entityType) {
      return await db.select().from(customFieldDefinitions)
        .where(and(
          eq(customFieldDefinitions.organizationId, orgId),
          eq(customFieldDefinitions.entityType, entityType)
        ))
        .orderBy(customFieldDefinitions.displayOrder, customFieldDefinitions.id);
    }
    return await db.select().from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.organizationId, orgId))
      .orderBy(customFieldDefinitions.displayOrder, customFieldDefinitions.id);
  }

  async getCustomFieldDefinition(orgId: number, id: number): Promise<CustomFieldDefinition | undefined> {
    const [definition] = await db.select().from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.organizationId, orgId), eq(customFieldDefinitions.id, id)));
    return definition;
  }

  async createCustomFieldDefinition(definition: InsertCustomFieldDefinition): Promise<CustomFieldDefinition> {
    const [newDefinition] = await db.insert(customFieldDefinitions).values(definition).returning();
    return newDefinition;
  }

  async updateCustomFieldDefinition(id: number, updates: Partial<InsertCustomFieldDefinition>): Promise<CustomFieldDefinition> {
    const [updated] = await db.update(customFieldDefinitions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(customFieldDefinitions.id, id))
      .returning();
    return updated;
  }

  async deleteCustomFieldDefinition(id: number): Promise<void> {
    await db.delete(customFieldValues).where(eq(customFieldValues.definitionId, id));
    await db.delete(customFieldDefinitions).where(eq(customFieldDefinitions.id, id));
  }

  // Custom Field Values
  async getCustomFieldValues(entityType: string, entityId: number): Promise<(CustomFieldValue & { definition: CustomFieldDefinition })[]> {
    const results = await db.select({
      value: customFieldValues,
      definition: customFieldDefinitions,
    })
      .from(customFieldValues)
      .innerJoin(customFieldDefinitions, eq(customFieldValues.definitionId, customFieldDefinitions.id))
      .where(and(
        eq(customFieldDefinitions.entityType, entityType),
        eq(customFieldValues.entityId, entityId)
      ))
      .orderBy(customFieldDefinitions.displayOrder, customFieldDefinitions.id);

    return results.map(r => ({ ...r.value, definition: r.definition }));
  }

  async setCustomFieldValue(definitionId: number, entityId: number, value: string | null): Promise<CustomFieldValue> {
    const [existing] = await db.select().from(customFieldValues)
      .where(and(
        eq(customFieldValues.definitionId, definitionId),
        eq(customFieldValues.entityId, entityId)
      ));

    if (existing) {
      const [updated] = await db.update(customFieldValues)
        .set({ value, updatedAt: new Date() })
        .where(eq(customFieldValues.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(customFieldValues)
        .values({ definitionId, entityId, value })
        .returning();
      return created;
    }
  }

  async deleteCustomFieldValuesForEntity(entityType: string, entityId: number): Promise<void> {
    const definitions = await this.getCustomFieldDefinitions(0, entityType);
    const definitionIds = definitions.map(d => d.id);
    if (definitionIds.length > 0) {
      await db.delete(customFieldValues)
        .where(and(
          eq(customFieldValues.entityId, entityId),
          sql`${customFieldValues.definitionId} = ANY(${definitionIds})`
        ));
    }
  }

  // Saved Views
  async getSavedViews(orgId: number, entityType?: string): Promise<SavedView[]> {
    if (entityType) {
      return await db.select().from(savedViews)
        .where(and(
          eq(savedViews.organizationId, orgId),
          eq(savedViews.entityType, entityType)
        ))
        .orderBy(desc(savedViews.isDefault), savedViews.name);
    }
    return await db.select().from(savedViews)
      .where(eq(savedViews.organizationId, orgId))
      .orderBy(desc(savedViews.isDefault), savedViews.name);
  }

  async getSavedView(orgId: number, id: number): Promise<SavedView | undefined> {
    const [view] = await db.select().from(savedViews)
      .where(and(eq(savedViews.organizationId, orgId), eq(savedViews.id, id)));
    return view;
  }

  async createSavedView(view: InsertSavedView): Promise<SavedView> {
    const [newView] = await db.insert(savedViews).values(view).returning();
    return newView;
  }

  async updateSavedView(id: number, updates: Partial<InsertSavedView>): Promise<SavedView> {
    const [updated] = await db.update(savedViews)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(savedViews.id, id))
      .returning();
    return updated;
  }

  async deleteSavedView(id: number): Promise<void> {
    await db.delete(savedViews).where(eq(savedViews.id, id));
  }

  async setDefaultView(orgId: number, entityType: string, viewId: number): Promise<SavedView> {
    await db.update(savedViews)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(
        eq(savedViews.organizationId, orgId),
        eq(savedViews.entityType, entityType)
      ));
    
    const [updated] = await db.update(savedViews)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(savedViews.id, viewId))
      .returning();
    return updated;
  }

  // Notification Preferences
  async getNotificationPreferences(userId: string, orgId: number): Promise<NotificationPreference[]> {
    return await db.select().from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.organizationId, orgId)
      ));
  }

  async upsertNotificationPreference(pref: InsertNotificationPreference): Promise<NotificationPreference> {
    const existing = await db.select().from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.userId, pref.userId),
        eq(notificationPreferences.organizationId, pref.organizationId),
        eq(notificationPreferences.eventType, pref.eventType)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      const [updated] = await db.update(notificationPreferences)
        .set({ ...pref, updatedAt: new Date() })
        .where(eq(notificationPreferences.id, existing[0].id))
        .returning();
      return updated;
    }
    
    const [created] = await db.insert(notificationPreferences).values(pref).returning();
    return created;
  }

  async updateNotificationPreference(id: number, updates: Partial<InsertNotificationPreference>): Promise<NotificationPreference> {
    const [updated] = await db.update(notificationPreferences)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(notificationPreferences.id, id))
      .returning();
    return updated;
  }

  // Tasks (17.1, 17.2)
  async getTasks(orgId: number, filters?: { status?: string; priority?: string; assignedTo?: number; entityType?: string; entityId?: number }): Promise<Task[]> {
    let conditions = [eq(tasks.organizationId, orgId)];
    
    if (filters?.status) {
      conditions.push(eq(tasks.status, filters.status));
    }
    if (filters?.priority) {
      conditions.push(eq(tasks.priority, filters.priority));
    }
    if (filters?.assignedTo !== undefined) {
      conditions.push(eq(tasks.assignedTo, filters.assignedTo));
    }
    if (filters?.entityType) {
      conditions.push(eq(tasks.entityType, filters.entityType));
    }
    if (filters?.entityId !== undefined) {
      conditions.push(eq(tasks.entityId, filters.entityId));
    }
    
    return await db.select().from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.dueDate), desc(tasks.priority));
  }

  async getTask(orgId: number, id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks)
      .where(and(eq(tasks.organizationId, orgId), eq(tasks.id, id)));
    return task;
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [newTask] = await db.insert(tasks).values(task).returning();
    await this.logActivity({
      organizationId: task.organizationId,
      action: "created",
      entityType: "task",
      entityId: newTask.id,
      description: `Task "${newTask.title}" created`,
    });
    return newTask;
  }

  async updateTask(id: number, updates: Partial<InsertTask>): Promise<Task> {
    const [updated] = await db.update(tasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return updated;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  async completeTask(id: number): Promise<Task> {
    const [completed] = await db.update(tasks)
      .set({ 
        status: "completed", 
        completedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(tasks.id, id))
      .returning();
    
    await this.logActivity({
      organizationId: completed.organizationId,
      action: "completed",
      entityType: "task",
      entityId: completed.id,
      description: `Task "${completed.title}" completed`,
    });
    
    return completed;
  }

  async getRecurringTasksDue(): Promise<Task[]> {
    return await db.select().from(tasks)
      .where(and(
        eq(tasks.isRecurring, true),
        eq(tasks.status, "completed"),
        lte(tasks.nextOccurrence, new Date())
      ));
  }

  async createNextRecurringTask(parentTask: Task): Promise<Task> {
    const nextDueDate = this.calculateNextOccurrence(parentTask.dueDate, parentTask.recurrenceRule as string);
    const nextNextOccurrence = this.calculateNextOccurrence(nextDueDate, parentTask.recurrenceRule as string);
    
    const newTask: InsertTask = {
      organizationId: parentTask.organizationId,
      title: parentTask.title,
      description: parentTask.description,
      dueDate: nextDueDate,
      priority: parentTask.priority as "low" | "medium" | "high" | "urgent",
      status: "pending",
      assignedTo: parentTask.assignedTo,
      createdBy: parentTask.createdBy,
      entityType: parentTask.entityType as "lead" | "property" | "deal" | "none",
      entityId: parentTask.entityId,
      isRecurring: true,
      recurrenceRule: parentTask.recurrenceRule,
      nextOccurrence: nextNextOccurrence,
      parentTaskId: parentTask.id,
    };
    
    const [created] = await db.insert(tasks).values(newTask).returning();
    
    await db.update(tasks)
      .set({ nextOccurrence: null })
      .where(eq(tasks.id, parentTask.id));
    
    return created;
  }

  private calculateNextOccurrence(date: Date | null, rule: string): Date {
    const baseDate = date ? new Date(date) : new Date();
    const nextDate = new Date(baseDate);
    
    switch (rule) {
      case "daily":
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case "weekly":
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case "monthly":
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case "yearly":
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }
    
    return nextDate;
  }

  // Audit Log (20.1)
  async createAuditLogEntry(entry: InsertAuditLog): Promise<AuditLogEntry> {
    const [created] = await db.insert(auditLog).values(entry).returning();
    return created;
  }

  async getAuditLogs(orgId: number, filters?: { 
    action?: string; 
    entityType?: string; 
    entityId?: number;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]> {
    let conditions = [eq(auditLog.organizationId, orgId)];
    
    if (filters?.action) {
      conditions.push(eq(auditLog.action, filters.action));
    }
    if (filters?.entityType) {
      conditions.push(eq(auditLog.entityType, filters.entityType));
    }
    if (filters?.entityId !== undefined) {
      conditions.push(eq(auditLog.entityId, filters.entityId));
    }
    if (filters?.userId) {
      conditions.push(eq(auditLog.userId, filters.userId));
    }
    if (filters?.startDate) {
      conditions.push(gte(auditLog.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(auditLog.createdAt, filters.endDate));
    }
    
    const limit = filters?.limit || 100;
    const offset = filters?.offset || 0;
    
    return await db.select().from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async getAuditLogCount(orgId: number, filters?: { 
    action?: string; 
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<number> {
    let conditions = [eq(auditLog.organizationId, orgId)];
    
    if (filters?.action) {
      conditions.push(eq(auditLog.action, filters.action));
    }
    if (filters?.entityType) {
      conditions.push(eq(auditLog.entityType, filters.entityType));
    }
    if (filters?.startDate) {
      conditions.push(gte(auditLog.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(auditLog.createdAt, filters.endDate));
    }
    
    const [result] = await db.select({ count: count() }).from(auditLog)
      .where(and(...conditions));
    return result?.count || 0;
  }

  // Data Retention (20.3)
  async purgeOldLeads(orgId: number, beforeDate: Date): Promise<number> {
    const result = await db.delete(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        lte(leads.createdAt, beforeDate),
        eq(leads.status, "dead")
      ))
      .returning({ id: leads.id });
    return result.length;
  }

  async purgeOldDeals(orgId: number, beforeDate: Date, status: string): Promise<number> {
    const result = await db.delete(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        lte(deals.createdAt, beforeDate),
        eq(deals.status, status)
      ))
      .returning({ id: deals.id });
    return result.length;
  }

  async purgeOldAuditLogs(orgId: number, beforeDate: Date): Promise<number> {
    const result = await db.delete(auditLog)
      .where(and(
        eq(auditLog.organizationId, orgId),
        lte(auditLog.createdAt, beforeDate)
      ))
      .returning({ id: auditLog.id });
    return result.length;
  }

  async purgeOldCommunications(orgId: number, beforeDate: Date): Promise<number> {
    const result = await db.delete(leadActivities)
      .where(and(
        eq(leadActivities.organizationId, orgId),
        lte(leadActivities.createdAt, beforeDate),
        or(
          eq(leadActivities.type, "communication_email"),
          eq(leadActivities.type, "communication_sms")
        )
      ))
      .returning({ id: leadActivities.id });
    return result.length;
  }

  // TCPA Compliance (20.2)
  async getLeadsWithoutConsent(orgId: number): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        or(
          eq(leads.tcpaConsent, false),
          sql`${leads.tcpaConsent} IS NULL`
        )
      ))
      .orderBy(desc(leads.createdAt));
  }

  async getLeadsOptedOut(orgId: number): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        eq(leads.doNotContact, true)
      ))
      .orderBy(desc(leads.optOutDate));
  }

  async updateLeadConsent(leadId: number, consent: { 
    tcpaConsent: boolean; 
    consentSource?: string;
    optOutReason?: string;
  }): Promise<Lead> {
    const updates: Partial<Lead> = {
      tcpaConsent: consent.tcpaConsent,
      updatedAt: new Date(),
    };
    
    if (consent.tcpaConsent) {
      updates.consentDate = new Date();
      updates.consentSource = consent.consentSource || "manual";
      updates.optOutDate = null;
      updates.optOutReason = null;
      updates.doNotContact = false;
    } else {
      updates.optOutDate = new Date();
      updates.optOutReason = consent.optOutReason;
      updates.doNotContact = true;
    }
    
    const [updated] = await db.update(leads)
      .set(updates)
      .where(eq(leads.id, leadId))
      .returning();
    return updated;
  }

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

  async updateTargetCounty(id: number, updates: Partial<InsertTargetCounty>) {
    const [updated] = await db.update(targetCounties).set({ ...updates, updatedAt: new Date() }).where(eq(targetCounties.id, id)).returning();
    return updated;
  }

  async deleteTargetCounty(id: number) {
    await db.delete(targetCounties).where(eq(targetCounties.id, id));
  }

  // Offer Letters
  async getOfferLetters(orgId: number, filters?: { status?: string; batchId?: string }) {
    let query = db.select().from(offerLetters).where(eq(offerLetters.organizationId, orgId));
    
    if (filters?.status) {
      query = query.where(and(eq(offerLetters.organizationId, orgId), eq(offerLetters.status, filters.status))) as any;
    }
    if (filters?.batchId) {
      query = query.where(and(eq(offerLetters.organizationId, orgId), eq(offerLetters.batchId, filters.batchId))) as any;
    }
    
    return query.orderBy(desc(offerLetters.createdAt));
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

  async updateOfferLetter(id: number, updates: Partial<InsertOfferLetter>) {
    const [updated] = await db.update(offerLetters)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(offerLetters.id, id))
      .returning();
    return updated;
  }

  async deleteOfferLetter(id: number) {
    await db.delete(offerLetters).where(eq(offerLetters.id, id));
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

  async updateOfferTemplate(id: number, updates: Partial<InsertOfferTemplate>) {
    const [updated] = await db.update(offerTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(offerTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteOfferTemplate(id: number) {
    await db.delete(offerTemplates).where(eq(offerTemplates.id, id));
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

  async updateDueDiligenceChecklist(id: number, updates: Partial<InsertDueDiligenceChecklist>) {
    if (updates.items) {
      const items = updates.items as any[];
      const completedCount = items.filter(i => i.status === "passed" || i.status === "failed" || i.status === "skipped").length;
      updates.completedPercent = Math.round((completedCount / items.length) * 100);
      if (updates.completedPercent === 100) {
        updates.status = "completed";
        updates.completedAt = new Date();
      }
    }
    const [updated] = await db.update(dueDiligenceChecklists)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dueDiligenceChecklists.id, id))
      .returning();
    return updated;
  }

  // Skip Traces
  async getSkipTraces(orgId: number) {
    return db.select().from(skipTraces)
      .where(eq(skipTraces.organizationId, orgId))
      .orderBy(desc(skipTraces.createdAt));
  }

  async getSkipTrace(orgId: number, id: number) {
    const [trace] = await db.select().from(skipTraces)
      .where(and(eq(skipTraces.id, id), eq(skipTraces.organizationId, orgId)));
    return trace;
  }

  async getSkipTraceByLead(orgId: number, leadId: number) {
    const [trace] = await db.select().from(skipTraces)
      .where(and(eq(skipTraces.organizationId, orgId), eq(skipTraces.leadId, leadId)))
      .orderBy(desc(skipTraces.createdAt));
    return trace;
  }

  async createSkipTrace(skipTrace: InsertSkipTrace) {
    const [created] = await db.insert(skipTraces).values(skipTrace).returning();
    return created;
  }

  async updateSkipTrace(id: number, updates: Partial<InsertSkipTrace>) {
    const [updated] = await db.update(skipTraces)
      .set(updates)
      .where(eq(skipTraces.id, id))
      .returning();
    return updated;
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

  async updatePropertyListing(id: number, updates: Partial<InsertPropertyListing>) {
    const [updated] = await db.update(propertyListings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(propertyListings.id, id))
      .returning();
    return updated;
  }

  async deletePropertyListing(id: number) {
    await db.delete(propertyListings).where(eq(propertyListings.id, id));
  }

  // Document Templates
  async getDocumentTemplates(orgId: number) {
    return db.select().from(documentTemplates)
      .where(or(
        eq(documentTemplates.organizationId, orgId),
        sql`${documentTemplates.organizationId} IS NULL`
      ))
      .orderBy(documentTemplates.isSystemTemplate, documentTemplates.name);
  }

  async getDocumentTemplate(id: number) {
    const [template] = await db.select().from(documentTemplates)
      .where(eq(documentTemplates.id, id));
    return template;
  }

  async createDocumentTemplate(template: InsertDocumentTemplate) {
    const [created] = await db.insert(documentTemplates).values(template).returning();
    return created;
  }

  async updateDocumentTemplate(id: number, updates: Partial<InsertDocumentTemplate>) {
    const [updated] = await db.update(documentTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(documentTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteDocumentTemplate(id: number) {
    await db.delete(documentTemplates).where(eq(documentTemplates.id, id));
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

  async updateGeneratedDocument(id: number, updates: Partial<InsertGeneratedDocument>) {
    const [updated] = await db.update(generatedDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(generatedDocuments.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
