import { pgTable, text, serial, integer, boolean, timestamp, numeric } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import Auth and Chat models to ensure they are included in schema
export * from "./models/auth";
export * from "./models/chat";

// === TABLE DEFINITIONS ===

// CRM: Leads/Customers
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  status: text("status").notNull().default("new"), // new, contacting, negotiation, closed, dead
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Inventory: Properties
export const properties = pgTable("properties", {
  id: serial("id").primaryKey(),
  apn: text("apn").notNull(), // Assessor's Parcel Number
  county: text("county").notNull(),
  state: text("state").notNull(),
  sizeAcres: numeric("size_acres").notNull(),
  status: text("status").notNull().default("available"), // available, under_contract, sold
  purchasePrice: numeric("purchase_price"),
  marketValue: numeric("market_value"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Finance: Notes (Geekpay replacement)
export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id),
  borrowerId: integer("borrower_id").references(() => leads.id),
  originalPrincipal: numeric("original_principal").notNull(),
  interestRate: numeric("interest_rate").notNull(),
  termMonths: integer("term_months").notNull(),
  monthlyPayment: numeric("monthly_payment").notNull(),
  startDate: timestamp("start_date").notNull(),
  status: text("status").notNull().default("active"), // active, paid_off, defaulted
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Agents: Tasks for automation
export const agentTasks = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  agentType: text("agent_type").notNull(), // research, marketing, negotiation
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  input: text("input").notNull(),
  output: text("output"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===
export const propertiesRelations = relations(properties, ({ one, many }) => ({
  notes: many(notes),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  property: one(properties, {
    fields: [notes.propertyId],
    references: [properties.id],
  }),
  borrower: one(leads, {
    fields: [notes.borrowerId],
    references: [leads.id],
  }),
}));


// === BASE SCHEMAS ===
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export const insertPropertySchema = createInsertSchema(properties).omit({ id: true, createdAt: true });
export const insertNoteSchema = createInsertSchema(notes).omit({ id: true, createdAt: true });
export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({ id: true, createdAt: true, output: true });

// === EXPLICIT API CONTRACT TYPES ===

// Leads
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type CreateLeadRequest = InsertLead;
export type UpdateLeadRequest = Partial<InsertLead>;

// Properties
export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type CreatePropertyRequest = InsertProperty;
export type UpdatePropertyRequest = Partial<InsertProperty>;

// Notes
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type CreateNoteRequest = InsertNote;
export type UpdateNoteRequest = Partial<InsertNote>;

// Agent Tasks
export type AgentTask = typeof agentTasks.$inferSelect;
export type CreateAgentTaskRequest = z.infer<typeof insertAgentTaskSchema>;
