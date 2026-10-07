/**
 * autonomy-ops — extracted from the shared/schema.ts monolith on 2026-09-28
 * (DEFECT-0048) and re-exported through that barrel, so every
 * `import { … } from "@shared/schema"` is unchanged. Sections, verbatim:
 *   - PAX CONNECTORS — per-org connector instances
 *   - PAX SCHEDULED TASK RUN HISTORY
 *   - CUSTOM AUTONOMY RULES
 *   - AUTOMATION RULES ENGINE (8.1)
 *   - WRITING STYLE PROFILES
 *   - BROWSER AUTOMATION
 *
 * Monolith tables are imported from "../schema" and used only lazily
 * (inside references(() => …)); the barrel's `export *` is hoisted, so this
 * module evaluates before the monolith's body and must never read one eagerly.
 */
import { pgTable, text, serial, integer, boolean, timestamp, numeric, jsonb, index, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "../db/createInsertSchema";
import { z } from "zod";
import { agentTasks, organizations } from "../schema";

// ============================================
// PAX CONNECTORS — per-org connector instances
// ============================================

export const paxConnectorInstances = pgTable("pax_connector_instances", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  connectorId: text("connector_id").notNull(), // 'gmail' | 'google_drive' | 'stripe' | etc.
  status: text("status").notNull().default("disconnected"), // 'disconnected' | 'connected' | 'error'
  // Encrypted credentials JSON (access_token, refresh_token, api_key, webhook_url, etc.)
  credentialsEncrypted: text("credentials_encrypted"),
  settings: jsonb("settings").$type<Record<string, any>>(),
  lastTestedAt: timestamp("last_tested_at"),
  lastErrorAt: timestamp("last_error_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("pax_ci_org_idx").on(t.organizationId),
  index("pax_ci_connector_idx").on(t.organizationId, t.connectorId),
]);
export type PaxConnectorInstance = typeof paxConnectorInstances.$inferSelect;

export const paxKnowledgeFiles = pgTable("pax_knowledge_files", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  extractedContent: text("extracted_content").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("pax_kb_org_idx").on(t.organizationId),
  index("pax_kb_active_idx").on(t.isActive),
]);
export type PaxKnowledgeFile = typeof paxKnowledgeFiles.$inferSelect;

export const paxProjects = pgTable("pax_projects", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  isActive: boolean("is_active").notNull().default(true),
  fileCount: integer("file_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("pax_proj_org_idx").on(t.organizationId),
  index("pax_proj_entity_idx").on(t.entityType, t.entityId),
]);
export type PaxProject = typeof paxProjects.$inferSelect;

export const paxProjectFiles = pgTable("pax_project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  extractedContent: text("extracted_content").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
}, (t) => [index("pax_pf_proj_idx").on(t.projectId)]);
export type PaxProjectFile = typeof paxProjectFiles.$inferSelect;

export const paxScheduledTasks = pgTable("pax_scheduled_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  agentRole: text("agent_role").notNull().default("executive"),
  schedule: text("schedule").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastRunConversationId: integer("last_run_conversation_id"),
  lastRunStatus: text("last_run_status"),
  lastRunSummary: text("last_run_summary"),
  runCount: integer("run_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("pax_tasks_org_idx").on(t.organizationId),
  index("pax_tasks_next_run_idx").on(t.nextRunAt),
]);
export type PaxScheduledTask = typeof paxScheduledTasks.$inferSelect;

// ============================================
// PAX SCHEDULED TASK RUN HISTORY
// ============================================
export const paxScheduledTaskRuns = pgTable("pax_scheduled_task_runs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  runAt: timestamp("run_at").defaultNow().notNull(),
  status: text("status").notNull(), // "success" | "error"
  summary: text("summary"),
  conversationId: integer("conversation_id"),
  durationMs: integer("duration_ms"),
}, (t) => [
  index("pax_task_runs_task_idx").on(t.taskId),
  index("pax_task_runs_org_idx").on(t.organizationId),
]);
export type PaxScheduledTaskRun = typeof paxScheduledTaskRuns.$inferSelect;

// ============================================
// CUSTOM AUTONOMY RULES
// ============================================

// Natural language rules for agent autonomy (e.g., "Never auto-email California leads")
export const customAutonomyRules = pgTable("custom_autonomy_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  ruleText: text("rule_text").notNull(),
  ruleType: text("rule_type").notNull().default("scope"), // scope, temporal
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // nullable — null means never expires
}, (table) => [
  index("idx_autonomy_rules_org").on(table.organizationId),
  index("idx_autonomy_rules_active").on(table.organizationId, table.isActive),
]);

export const insertCustomAutonomyRuleSchema = createInsertSchema(customAutonomyRules).omit({
  id: true,
  createdAt: true,
});

export type CustomAutonomyRule = typeof customAutonomyRules.$inferSelect;
export type InsertCustomAutonomyRule = z.infer<typeof insertCustomAutonomyRuleSchema>;

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
}, (table) => [
  index("automation_rules_org_idx").on(table.organizationId),
  index("automation_rules_active_idx").on(table.isEnabled),
]);

export const insertAutomationRuleSchema = createInsertSchema(automationRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  executionCount: true,
  lastExecutedAt: true,
});
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = typeof automationRules.$inferSelect;

// automation_executions — DROPPED 2026-08-16 (migration 0236, founder ruling
// "Triage 3 ways, drop only experiment residue"). The /automation rules twin
// was deleted 2026-07-29 (deletion ledger) because it had NO EXECUTION ENGINE:
// `createAutomationExecution` had ZERO call sites, so this log could never hold
// a row, and that ledger entry itself recorded the table as "pending a drop
// migration (execution rule 2)". `automationRules` above is deliberately KEPT —
// its rows are customer-AUTHORED (name, description, conditions, actions), and
// deleting customer data is a founder-only hard stop this ruling did not touch.

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

