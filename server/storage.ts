import { db } from "./db";
export { db };
import { eq, and, desc, sql, count, sum, arrayContains, gte, lte, or } from "drizzle-orm";
import { aiConversations, aiMessages } from "@shared/schema";
import {
  organizations, teamMembers, leads, leadActivities, properties, deals,
  notes, payments, campaigns, agentConfigs, agentTasks, conversations,
  messages, activityLog, usageEvents,
  aiAgentProfiles, aiToolDefinitions, aiExecutionRuns, aiMemory,
  vaAgents, vaActions, vaBriefings, vaCalendarEvents, vaTemplates,
  type Organization, type InsertOrganization,
  type TeamMember, type InsertTeamMember,
  type Lead, type InsertLead,
  type Property, type InsertProperty,
  type Deal, type InsertDeal,
  type Note, type InsertNote,
  type Payment, type InsertPayment,
  type Campaign, type InsertCampaign,
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
    
    const [newNote] = await db.insert(notes).values({
      ...noteData,
      currentBalance: noteData.currentBalance || noteData.originalPrincipal,
      amortizationSchedule: amortization,
      maturityDate: maturityDate,
      nextPaymentDate: noteData.firstPaymentDate,
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
    // Remove id and createdAt from updates to prevent accidental modification
    const { id: _id, createdAt: _createdAt, ...safeUpdates } = updates as any;
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
}

export const storage = new DatabaseStorage();
