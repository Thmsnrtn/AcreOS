import { db } from "./db";
import {
  leads, properties, notes, agentTasks,
  type CreateLeadRequest, type UpdateLeadRequest,
  type CreatePropertyRequest, type UpdatePropertyRequest,
  type CreateNoteRequest, type UpdateNoteRequest,
  type CreateAgentTaskRequest
} from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Leads
  getLeads(): Promise<typeof leads.$inferSelect[]>;
  getLead(id: number): Promise<typeof leads.$inferSelect | undefined>;
  createLead(lead: CreateLeadRequest): Promise<typeof leads.$inferSelect>;
  updateLead(id: number, updates: UpdateLeadRequest): Promise<typeof leads.$inferSelect>;
  
  // Properties
  getProperties(): Promise<typeof properties.$inferSelect[]>;
  getProperty(id: number): Promise<typeof properties.$inferSelect | undefined>;
  createProperty(property: CreatePropertyRequest): Promise<typeof properties.$inferSelect>;
  
  // Notes
  getNotes(): Promise<typeof notes.$inferSelect[]>;
  createNote(note: CreateNoteRequest): Promise<typeof notes.$inferSelect>;
  
  // Agent Tasks
  getAgentTasks(): Promise<typeof agentTasks.$inferSelect[]>;
  createAgentTask(task: CreateAgentTaskRequest): Promise<typeof agentTasks.$inferSelect>;
}

export class DatabaseStorage implements IStorage {
  // Leads
  async getLeads() {
    return await db.select().from(leads);
  }
  async getLead(id: number) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    return lead;
  }
  async createLead(lead: CreateLeadRequest) {
    const [newLead] = await db.insert(leads).values(lead).returning();
    return newLead;
  }
  async updateLead(id: number, updates: UpdateLeadRequest) {
    const [updated] = await db.update(leads).set(updates).where(eq(leads.id, id)).returning();
    return updated;
  }

  // Properties
  async getProperties() {
    return await db.select().from(properties);
  }
  async getProperty(id: number) {
    const [property] = await db.select().from(properties).where(eq(properties.id, id));
    return property;
  }
  async createProperty(property: CreatePropertyRequest) {
    const [newProperty] = await db.insert(properties).values(property).returning();
    return newProperty;
  }

  // Notes
  async getNotes() {
    return await db.select().from(notes);
  }
  async createNote(note: CreateNoteRequest) {
    const [newNote] = await db.insert(notes).values(note).returning();
    return newNote;
  }

  // Agent Tasks
  async getAgentTasks() {
    return await db.select().from(agentTasks);
  }
  async createAgentTask(task: CreateAgentTaskRequest) {
    const [newTask] = await db.insert(agentTasks).values(task).returning();
    return newTask;
  }
}

export const storage = new DatabaseStorage();
