import { db } from "../db";
import { 
  browserAutomationTemplates, 
  browserAutomationJobs, 
  browserSessionCredentials 
} from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

export interface AutomationStep {
  order: number;
  action: "navigate" | "click" | "type" | "select" | "wait" | "screenshot" | "extract" | "scroll";
  selector?: string;
  value?: string;
  waitTime?: number;
  extractAs?: string;
  description: string;
}

export interface AutomationTemplate {
  id: number;
  organizationId: number | null;
  name: string;
  description: string | null;
  category: string;
  targetDomain: string | null;
  steps: AutomationStep[];
  inputSchema: { name: string; type: string; required: boolean; description: string }[];
  outputSchema: { name: string; type: string; description: string }[];
  requiresAuth: boolean | null;
  estimatedDurationMs: number | null;
  isPublic: boolean | null;
  isEnabled: boolean | null;
}

export interface AutomationJob {
  id: number;
  organizationId: number;
  templateId: number | null;
  name: string;
  status: string;
  priority: number | null;
  inputData: Record<string, any> | null;
  outputData: Record<string, any> | null;
  screenshots: { name: string; url: string; capturedAt: string }[] | null;
  error: string | null;
  errorDetails: { step?: number; selector?: string; message: string; stack?: string } | null;
  retryCount: number | null;
  maxRetries: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  executionTimeMs: number | null;
  triggeredByAgentTaskId: number | null;
  triggeredByUserId: string | null;
  createdAt: Date | null;
}

export async function getSystemTemplates(): Promise<AutomationTemplate[]> {
  const templates = await db
    .select()
    .from(browserAutomationTemplates)
    .where(
      and(
        isNull(browserAutomationTemplates.organizationId),
        eq(browserAutomationTemplates.isEnabled, true)
      )
    )
    .orderBy(browserAutomationTemplates.category);
  
  return templates as AutomationTemplate[];
}

export async function getOrganizationTemplates(
  organizationId: number
): Promise<AutomationTemplate[]> {
  const templates = await db
    .select()
    .from(browserAutomationTemplates)
    .where(
      and(
        eq(browserAutomationTemplates.organizationId, organizationId),
        eq(browserAutomationTemplates.isEnabled, true)
      )
    )
    .orderBy(browserAutomationTemplates.category);
  
  return templates as AutomationTemplate[];
}

export async function createTemplate(
  template: Omit<AutomationTemplate, "id">
): Promise<AutomationTemplate> {
  const [created] = await db
    .insert(browserAutomationTemplates)
    .values({
      organizationId: template.organizationId,
      name: template.name,
      description: template.description,
      category: template.category,
      targetDomain: template.targetDomain,
      steps: template.steps,
      inputSchema: template.inputSchema,
      outputSchema: template.outputSchema,
      requiresAuth: template.requiresAuth,
      estimatedDurationMs: template.estimatedDurationMs,
      isPublic: template.isPublic,
      isEnabled: template.isEnabled ?? true,
    })
    .returning();
  
  return created as AutomationTemplate;
}

export async function createJob(
  organizationId: number,
  params: {
    templateId?: number;
    name: string;
    inputData?: Record<string, any>;
    priority?: number;
    triggeredByAgentTaskId?: number;
    triggeredByUserId?: string;
  }
): Promise<AutomationJob> {
  const [job] = await db
    .insert(browserAutomationJobs)
    .values({
      organizationId,
      templateId: params.templateId,
      name: params.name,
      inputData: params.inputData,
      priority: params.priority ?? 5,
      triggeredByAgentTaskId: params.triggeredByAgentTaskId,
      triggeredByUserId: params.triggeredByUserId,
      status: "queued",
    })
    .returning();
  
  return job as AutomationJob;
}

export async function getQueuedJobs(limit: number = 10): Promise<AutomationJob[]> {
  const jobs = await db
    .select()
    .from(browserAutomationJobs)
    .where(eq(browserAutomationJobs.status, "queued"))
    .orderBy(browserAutomationJobs.priority, browserAutomationJobs.createdAt)
    .limit(limit);
  
  return jobs as AutomationJob[];
}

export async function getJobById(jobId: number): Promise<AutomationJob | null> {
  const [job] = await db
    .select()
    .from(browserAutomationJobs)
    .where(eq(browserAutomationJobs.id, jobId))
    .limit(1);
  
  return (job as AutomationJob) || null;
}

export async function updateJobStatus(
  jobId: number,
  status: "queued" | "running" | "completed" | "failed" | "cancelled",
  updates?: {
    outputData?: Record<string, any>;
    screenshots?: { name: string; url: string; capturedAt: string }[];
    error?: string;
    errorDetails?: { step?: number; selector?: string; message: string; stack?: string };
    executionTimeMs?: number;
  }
): Promise<void> {
  const updateData: Record<string, any> = { status };
  
  if (status === "running") {
    updateData.startedAt = new Date();
  }
  
  if (status === "completed" || status === "failed") {
    updateData.completedAt = new Date();
  }
  
  if (updates) {
    if (updates.outputData !== undefined) updateData.outputData = updates.outputData;
    if (updates.screenshots !== undefined) updateData.screenshots = updates.screenshots;
    if (updates.error !== undefined) updateData.error = updates.error;
    if (updates.errorDetails !== undefined) updateData.errorDetails = updates.errorDetails;
    if (updates.executionTimeMs !== undefined) updateData.executionTimeMs = updates.executionTimeMs;
  }
  
  await db
    .update(browserAutomationJobs)
    .set(updateData)
    .where(eq(browserAutomationJobs.id, jobId));
}

export async function getOrganizationJobs(
  organizationId: number,
  options?: {
    status?: string;
    limit?: number;
  }
): Promise<AutomationJob[]> {
  let query = db
    .select()
    .from(browserAutomationJobs)
    .where(eq(browserAutomationJobs.organizationId, organizationId))
    .orderBy(desc(browserAutomationJobs.createdAt));
  
  if (options?.status) {
    query = db
      .select()
      .from(browserAutomationJobs)
      .where(
        and(
          eq(browserAutomationJobs.organizationId, organizationId),
          eq(browserAutomationJobs.status, options.status)
        )
      )
      .orderBy(desc(browserAutomationJobs.createdAt));
  }
  
  const jobs = await query.limit(options?.limit ?? 50);
  
  return jobs as AutomationJob[];
}

export async function cancelJob(jobId: number): Promise<void> {
  await db
    .update(browserAutomationJobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
    })
    .where(eq(browserAutomationJobs.id, jobId));
}

export async function saveCredentials(
  organizationId: number,
  domain: string,
  name: string,
  encryptedData: string
): Promise<number> {
  const [result] = await db
    .insert(browserSessionCredentials)
    .values({
      organizationId,
      domain,
      name,
      encryptedData,
      isValid: true,
    })
    .returning({ id: browserSessionCredentials.id });
  
  return result.id;
}

export async function getCredentialsForDomain(
  organizationId: number,
  domain: string
): Promise<{ id: number; name: string; isValid: boolean | null; lastUsedAt: Date | null } | null> {
  const [cred] = await db
    .select({
      id: browserSessionCredentials.id,
      name: browserSessionCredentials.name,
      isValid: browserSessionCredentials.isValid,
      lastUsedAt: browserSessionCredentials.lastUsedAt,
    })
    .from(browserSessionCredentials)
    .where(
      and(
        eq(browserSessionCredentials.organizationId, organizationId),
        eq(browserSessionCredentials.domain, domain)
      )
    )
    .limit(1);
  
  return cred || null;
}

export async function markCredentialUsed(credentialId: number): Promise<void> {
  await db
    .update(browserSessionCredentials)
    .set({
      lastUsedAt: new Date(),
      usageCount: 1, // Will be incremented in SQL
    })
    .where(eq(browserSessionCredentials.id, credentialId));
}

export async function seedSystemTemplates(): Promise<void> {
  const existingCount = await db
    .select()
    .from(browserAutomationTemplates)
    .where(isNull(browserAutomationTemplates.organizationId))
    .limit(1);
  
  if (existingCount.length > 0) {
    console.log("[browser-automation] System templates already seeded");
    return;
  }
  
  const systemTemplates: Omit<AutomationTemplate, "id">[] = [
    {
      organizationId: null,
      name: "County Assessor Lookup",
      description: "Look up property information on county assessor websites",
      category: "county_research",
      targetDomain: null,
      steps: [
        { order: 1, action: "navigate", value: "{{assessorUrl}}", description: "Navigate to county assessor website" },
        { order: 2, action: "wait", waitTime: 2000, description: "Wait for page load" },
        { order: 3, action: "type", selector: "{{apnFieldSelector}}", value: "{{apn}}", description: "Enter APN" },
        { order: 4, action: "click", selector: "{{searchButtonSelector}}", description: "Click search" },
        { order: 5, action: "wait", waitTime: 3000, description: "Wait for results" },
        { order: 6, action: "screenshot", value: "search_results", description: "Capture results" },
        { order: 7, action: "extract", selector: "{{ownerFieldSelector}}", extractAs: "ownerName", description: "Extract owner name" },
        { order: 8, action: "extract", selector: "{{valueFieldSelector}}", extractAs: "assessedValue", description: "Extract assessed value" },
      ],
      inputSchema: [
        { name: "assessorUrl", type: "string", required: true, description: "County assessor website URL" },
        { name: "apn", type: "string", required: true, description: "Assessor Parcel Number" },
        { name: "apnFieldSelector", type: "string", required: true, description: "CSS selector for APN input field" },
        { name: "searchButtonSelector", type: "string", required: true, description: "CSS selector for search button" },
        { name: "ownerFieldSelector", type: "string", required: false, description: "CSS selector for owner name" },
        { name: "valueFieldSelector", type: "string", required: false, description: "CSS selector for assessed value" },
      ],
      outputSchema: [
        { name: "ownerName", type: "string", description: "Property owner name" },
        { name: "assessedValue", type: "string", description: "Assessed property value" },
        { name: "screenshots", type: "array", description: "Captured screenshots" },
      ],
      requiresAuth: false,
      estimatedDurationMs: 15000,
      isPublic: true,
      isEnabled: true,
    },
    {
      organizationId: null,
      name: "Document Download",
      description: "Download documents from public records websites",
      category: "public_records",
      targetDomain: null,
      steps: [
        { order: 1, action: "navigate", value: "{{recordsUrl}}", description: "Navigate to records website" },
        { order: 2, action: "wait", waitTime: 2000, description: "Wait for page load" },
        { order: 3, action: "type", selector: "{{searchFieldSelector}}", value: "{{searchQuery}}", description: "Enter search query" },
        { order: 4, action: "click", selector: "{{searchButtonSelector}}", description: "Click search" },
        { order: 5, action: "wait", waitTime: 3000, description: "Wait for results" },
        { order: 6, action: "click", selector: "{{firstResultSelector}}", description: "Click first result" },
        { order: 7, action: "wait", waitTime: 2000, description: "Wait for document" },
        { order: 8, action: "screenshot", value: "document_preview", description: "Capture document preview" },
      ],
      inputSchema: [
        { name: "recordsUrl", type: "string", required: true, description: "Public records website URL" },
        { name: "searchQuery", type: "string", required: true, description: "Document search query" },
        { name: "searchFieldSelector", type: "string", required: true, description: "CSS selector for search field" },
        { name: "searchButtonSelector", type: "string", required: true, description: "CSS selector for search button" },
        { name: "firstResultSelector", type: "string", required: true, description: "CSS selector for first result" },
      ],
      outputSchema: [
        { name: "documentUrl", type: "string", description: "URL of the document" },
        { name: "screenshots", type: "array", description: "Captured screenshots" },
      ],
      requiresAuth: false,
      estimatedDurationMs: 20000,
      isPublic: true,
      isEnabled: true,
    },
    {
      organizationId: null,
      name: "Property Listing Screenshot",
      description: "Capture screenshots of property listings on various platforms",
      category: "listings",
      targetDomain: null,
      steps: [
        { order: 1, action: "navigate", value: "{{listingUrl}}", description: "Navigate to property listing" },
        { order: 2, action: "wait", waitTime: 3000, description: "Wait for page load" },
        { order: 3, action: "scroll", value: "0", description: "Scroll to top" },
        { order: 4, action: "screenshot", value: "listing_header", description: "Capture header" },
        { order: 5, action: "scroll", value: "500", description: "Scroll down" },
        { order: 6, action: "screenshot", value: "listing_details", description: "Capture details" },
        { order: 7, action: "scroll", value: "1000", description: "Scroll further" },
        { order: 8, action: "screenshot", value: "listing_description", description: "Capture description" },
      ],
      inputSchema: [
        { name: "listingUrl", type: "string", required: true, description: "Property listing URL" },
      ],
      outputSchema: [
        { name: "screenshots", type: "array", description: "Captured listing screenshots" },
      ],
      requiresAuth: false,
      estimatedDurationMs: 10000,
      isPublic: true,
      isEnabled: true,
    },
  ];
  
  for (const template of systemTemplates) {
    await createTemplate(template);
  }
  
  console.log("[browser-automation] Seeded system templates");
}
