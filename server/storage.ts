import { db } from "./db";
export { db };
import { eq, and, desc, sql, count, sum, arrayContains, gte, lte, or } from "drizzle-orm";
import { aiConversations, aiMessages } from "@shared/schema";
import {
  organizations, teamMembers, leads, leadActivities, properties, deals,
  notes, payments, paymentReminders, campaigns, campaignOptimizations, agentConfigs, agentTasks, conversations,
  messages, activityLog, usageEvents,
  aiAgentProfiles, aiToolDefinitions, aiExecutionRuns, aiMemory,
  vaAgents, vaActions, vaBriefings, vaCalendarEvents, vaTemplates,
  dueDiligenceTemplates, dueDiligenceItems,
  usageRecords, creditTransactions,
  supportCases, supportMessages, supportActions, supportPlaybooks,
  dunningEvents, systemAlerts,
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
  type UsageRecord,
  type CreditTransaction,
  type InsertSupportCase, type SupportCase,
  type InsertSupportMessage, type SupportMessage,
  type InsertSupportAction, type SupportAction,
  type SupportPlaybook,
  type DunningEvent, type InsertDunningEvent,
  type SystemAlert, type InsertSystemAlert,
  DEFAULT_DUE_DILIGENCE_TEMPLATES,
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
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

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
}

export const storage = new DatabaseStorage();
