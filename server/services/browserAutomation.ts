import { db } from "../db";
import { 
  browserAutomationTemplates, 
  browserAutomationJobs, 
  browserSessionCredentials 
} from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import puppeteer, { Browser, Page } from "puppeteer-core";
import { execSync } from "child_process";
import dns from "dns/promises";

let chromiumPath: string | null = null;

function getChromiumPath(): string {
  if (chromiumPath) return chromiumPath;
  
  try {
    const nixProfileBin = process.env.HOME + "/.nix-profile/bin/chromium";
    try {
      execSync(`test -f "${nixProfileBin}"`, { stdio: "ignore" });
      chromiumPath = nixProfileBin;
      return chromiumPath;
    } catch {
      // Not in nix profile
    }
    
    const result = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo ''", { 
      encoding: "utf8" 
    }).trim();
    
    if (result) {
      chromiumPath = result;
      return chromiumPath;
    }
    
    const commonPaths = [
      "/nix/store/*/bin/chromium",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
    ];
    
    for (const pattern of commonPaths) {
      try {
        const found = execSync(`ls ${pattern} 2>/dev/null | head -1`, { encoding: "utf8" }).trim();
        if (found) {
          chromiumPath = found;
          return chromiumPath;
        }
      } catch {
        continue;
      }
    }
    
    throw new Error("Chromium not found in system. Please ensure chromium is installed.");
  } catch (error) {
    console.error("[browser-automation] Failed to find Chromium:", error);
    throw error;
  }
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = getChromiumPath();
  console.log(`[browser-automation] Launching browser from: ${executablePath}`);
  
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
    ],
  });
}

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

function interpolateVariables(
  value: string,
  inputData: Record<string, any>
): string {
  return value.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return inputData[key] !== undefined ? String(inputData[key]) : match;
  });
}

export interface ExecutionResult {
  success: boolean;
  outputData: Record<string, any>;
  screenshots: { name: string; data: string; capturedAt: string }[];
  error?: string;
  errorDetails?: { step?: number; selector?: string; message: string; stack?: string };
  executionTimeMs: number;
}

async function executeStep(
  page: Page,
  step: AutomationStep,
  inputData: Record<string, any>,
  extractedData: Record<string, any>,
  screenshots: { name: string; data: string; capturedAt: string }[]
): Promise<void> {
  const interpolatedSelector = step.selector 
    ? interpolateVariables(step.selector, inputData) 
    : undefined;
  const interpolatedValue = step.value 
    ? interpolateVariables(step.value, inputData) 
    : undefined;

  switch (step.action) {
    case "navigate":
      if (!interpolatedValue) throw new Error("Navigate action requires a URL");
      await page.goto(interpolatedValue, { waitUntil: "networkidle0", timeout: 30000 });
      break;

    case "click":
      if (!interpolatedSelector) throw new Error("Click action requires a selector");
      await page.waitForSelector(interpolatedSelector, { timeout: 10000 });
      await page.click(interpolatedSelector);
      break;

    case "type":
      if (!interpolatedSelector) throw new Error("Type action requires a selector");
      if (interpolatedValue === undefined) throw new Error("Type action requires a value");
      await page.waitForSelector(interpolatedSelector, { timeout: 10000 });
      await page.type(interpolatedSelector, interpolatedValue);
      break;

    case "select":
      if (!interpolatedSelector) throw new Error("Select action requires a selector");
      if (interpolatedValue === undefined) throw new Error("Select action requires a value");
      await page.waitForSelector(interpolatedSelector, { timeout: 10000 });
      await page.select(interpolatedSelector, interpolatedValue);
      break;

    case "wait":
      const waitTime = step.waitTime || 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      break;

    case "screenshot":
      const screenshotName = interpolatedValue || `screenshot_${screenshots.length + 1}`;
      const screenshotData = await page.screenshot({ encoding: "base64", fullPage: false });
      screenshots.push({
        name: screenshotName,
        data: `data:image/png;base64,${screenshotData}`,
        capturedAt: new Date().toISOString(),
      });
      break;

    case "extract":
      if (!interpolatedSelector) throw new Error("Extract action requires a selector");
      const extractAs = step.extractAs || `extracted_${Object.keys(extractedData).length + 1}`;
      try {
        await page.waitForSelector(interpolatedSelector, { timeout: 10000 });
        const element = await page.$(interpolatedSelector);
        if (element) {
          const text = await page.evaluate(el => el.textContent || "", element);
          extractedData[extractAs] = text.trim();
        }
      } catch {
        extractedData[extractAs] = null;
      }
      break;

    case "scroll":
      const scrollAmount = parseInt(interpolatedValue || "0", 10);
      await page.evaluate((y) => window.scrollTo(0, y), scrollAmount);
      break;

    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}

export async function executeJob(jobId: number): Promise<ExecutionResult> {
  const startTime = Date.now();
  const outputData: Record<string, any> = {};
  const screenshots: { name: string; data: string; capturedAt: string }[] = [];
  
  let browser: Browser | null = null;
  
  try {
    const job = await getJobById(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    
    await updateJobStatus(jobId, "running");
    
    let steps: AutomationStep[] = [];
    let inputData = job.inputData || {};
    
    if (job.templateId) {
      const [template] = await db
        .select()
        .from(browserAutomationTemplates)
        .where(eq(browserAutomationTemplates.id, job.templateId))
        .limit(1);
      
      if (!template) {
        throw new Error(`Template not found: ${job.templateId}`);
      }
      
      steps = template.steps as AutomationStep[];
    } else if (inputData.steps) {
      steps = inputData.steps as AutomationStep[];
    } else {
      throw new Error("No steps defined for job");
    }
    
    steps.sort((a, b) => a.order - b.order);
    
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    
    for (const step of steps) {
      try {
        console.log(`[browser-automation] Executing step ${step.order}: ${step.description}`);
        await executeStep(page, step, inputData, outputData, screenshots);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        await browser.close();
        
        const result: ExecutionResult = {
          success: false,
          outputData,
          screenshots,
          error: errorMessage,
          errorDetails: {
            step: step.order,
            selector: step.selector,
            message: errorMessage,
            stack: errorStack,
          },
          executionTimeMs: Date.now() - startTime,
        };
        
        await updateJobStatus(jobId, "failed", {
          outputData: result.outputData,
          screenshots: result.screenshots.map(s => ({ ...s, url: s.data })),
          error: result.error,
          errorDetails: result.errorDetails,
          executionTimeMs: result.executionTimeMs,
        });
        
        return result;
      }
    }
    
    await browser.close();
    
    const result: ExecutionResult = {
      success: true,
      outputData,
      screenshots,
      executionTimeMs: Date.now() - startTime,
    };
    
    await updateJobStatus(jobId, "completed", {
      outputData: result.outputData,
      screenshots: result.screenshots.map(s => ({ ...s, url: s.data })),
      executionTimeMs: result.executionTimeMs,
    });
    
    console.log(`[browser-automation] Job ${jobId} completed in ${result.executionTimeMs}ms`);
    
    return result;
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    const result: ExecutionResult = {
      success: false,
      outputData,
      screenshots,
      error: errorMessage,
      errorDetails: {
        message: errorMessage,
        stack: errorStack,
      },
      executionTimeMs: Date.now() - startTime,
    };
    
    await updateJobStatus(jobId, "failed", {
      outputData: result.outputData,
      error: result.error,
      errorDetails: result.errorDetails,
      executionTimeMs: result.executionTimeMs,
    });
    
    return result;
  }
}

export async function processJobQueue(): Promise<number> {
  const jobs = await getQueuedJobs(1);
  
  if (jobs.length === 0) {
    return 0;
  }
  
  for (const job of jobs) {
    console.log(`[browser-automation] Processing job: ${job.id} - ${job.name}`);
    await executeJob(job.id);
  }
  
  return jobs.length;
}

let isProcessingQueue = false;

export async function startJobProcessor(intervalMs: number = 30000): Promise<void> {
  console.log(`[browser-automation] Starting job processor (interval: ${intervalMs}ms)`);
  
  setInterval(async () => {
    if (isProcessingQueue) {
      console.log("[browser-automation] Queue processor already running, skipping");
      return;
    }
    
    isProcessingQueue = true;
    try {
      const processed = await processJobQueue();
      if (processed > 0) {
        console.log(`[browser-automation] Processed ${processed} job(s)`);
      }
    } catch (error) {
      console.error("[browser-automation] Error processing queue:", error);
    } finally {
      isProcessingQueue = false;
    }
  }, intervalMs);
}

export interface BrowseWebResult {
  success: boolean;
  url: string;
  title: string;
  content: string;
  links: { text: string; href: string }[];
  tables: string[];
  screenshot?: string;
  error?: string;
  loadTimeMs: number;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  
  if (parts[0] === 127) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  if (parts.every(p => p === 255)) return true;
  
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) {
    const ipv4Part = lower.slice(7);
    if (isPrivateIpv4(ipv4Part)) return true;
  }
  return false;
}

async function resolveAndCheckHost(hostname: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const parsed = new URL(`http://${hostname}`);
    const host = parsed.hostname;
    
    const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      if (isPrivateIpv4(host)) {
        return { allowed: false, reason: "Resolved to private IPv4 address" };
      }
      return { allowed: true };
    }
    
    try {
      const addresses = await dns.resolve4(host);
      for (const addr of addresses) {
        if (isPrivateIpv4(addr)) {
          console.log(`[SSRF] Blocked: ${hostname} resolves to private IP ${addr}`);
          return { allowed: false, reason: `Domain resolves to private IP (${addr})` };
        }
      }
    } catch {
      // DNS resolution failed for IPv4, try IPv6
    }
    
    try {
      const addresses6 = await dns.resolve6(host);
      for (const addr of addresses6) {
        if (isPrivateIpv6(addr)) {
          console.log(`[SSRF] Blocked: ${hostname} resolves to private IPv6 ${addr}`);
          return { allowed: false, reason: `Domain resolves to private IPv6 (${addr})` };
        }
      }
    } catch {
      // IPv6 resolution failed
    }
    
    return { allowed: true };
  } catch (err) {
    console.log(`[SSRF] DNS check error for ${hostname}:`, err);
    return { allowed: true };
  }
}

function isBlockedUrl(urlString: string): { blocked: boolean; reason?: string } {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { blocked: true, reason: "Only HTTP/HTTPS URLs are allowed" };
    }
    
    if (hostname.startsWith("[") || hostname.includes(":")) {
      return { blocked: true, reason: "IPv6 addresses are not allowed" };
    }
    
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match && isPrivateIpv4(hostname)) {
      return { blocked: true, reason: "Access to internal/private networks is not allowed" };
    }
    
    if (/^\d+$/.test(hostname)) {
      return { blocked: true, reason: "Numeric IP formats are not allowed" };
    }
    if (/^0x[0-9a-f]+$/i.test(hostname)) {
      return { blocked: true, reason: "Hex IP formats are not allowed" };
    }
    if (/^0[0-7]+$/.test(hostname)) {
      return { blocked: true, reason: "Octal IP formats are not allowed" };
    }
    
    const shortIpv4 = hostname.match(/^(\d+)\.(\d+)$/);
    if (shortIpv4) {
      return { blocked: true, reason: "Shorthand IPv4 formats are not allowed" };
    }
    const threePartIpv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (threePartIpv4) {
      return { blocked: true, reason: "Shorthand IPv4 formats are not allowed" };
    }
    
    if (/^0\d+\./.test(hostname) || /\.0\d+\./.test(hostname) || /\.0\d+$/.test(hostname)) {
      return { blocked: true, reason: "Octal IPv4 formats are not allowed" };
    }
    
    const blockedPatterns = [
      /^localhost$/i,
      /\.localhost$/i,
      /\.local$/i,
      /\.internal$/i,
      /^metadata\./i,
      /^instance-data\./i,
      /\.metadata\.google\.internal$/i,
    ];
    
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        return { blocked: true, reason: "Access to internal/private networks is not allowed" };
      }
    }
    
    return { blocked: false };
  } catch {
    return { blocked: true, reason: "Invalid URL format" };
  }
}

export async function browseWeb(url: string, options?: { 
  extractTables?: boolean; 
  captureScreenshot?: boolean;
  waitMs?: number;
}): Promise<BrowseWebResult> {
  const startTime = Date.now();
  let browser: Browser | null = null;
  
  const urlCheck = isBlockedUrl(url);
  if (urlCheck.blocked) {
    return {
      success: false,
      url,
      title: "",
      content: "",
      links: [],
      tables: [],
      error: urlCheck.reason || "URL blocked",
      loadTimeMs: Date.now() - startTime,
    };
  }
  
  const parsed = new URL(url);
  const dnsCheck = await resolveAndCheckHost(parsed.hostname);
  if (!dnsCheck.allowed) {
    return {
      success: false,
      url,
      title: "",
      content: "",
      links: [],
      tables: [],
      error: dnsCheck.reason || "DNS resolution blocked",
      loadTimeMs: Date.now() - startTime,
    };
  }
  
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const reqUrl = request.url();
      const check = isBlockedUrl(reqUrl);
      if (check.blocked) {
        console.log(`[browse_web] Blocked request (URL pattern): ${reqUrl}`);
        await request.abort("blockedbyclient");
        return;
      }
      
      try {
        const parsed = new URL(reqUrl);
        const hostname = parsed.hostname;
        
        const dnsCheck = await resolveAndCheckHost(hostname);
        if (!dnsCheck.allowed) {
          console.log(`[browse_web] Blocked request (DNS resolve): ${reqUrl} - ${dnsCheck.reason}`);
          await request.abort("blockedbyclient");
          return;
        }
        
        await request.continue();
      } catch (err) {
        console.log(`[browse_web] Request check error, allowing: ${reqUrl}`);
        await request.continue();
      }
    });
    
    await page.goto(url, { 
      waitUntil: "networkidle2",
      timeout: 20000 
    });
    
    if (options?.waitMs) {
      await new Promise(r => setTimeout(r, options.waitMs));
    }
    
    const title = await page.title();
    
    const content = await page.evaluate(() => {
      const removeElements = (selectors: string[]) => {
        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });
      };
      removeElements(["script", "style", "nav", "footer", "header", "aside", ".ad", ".advertisement", "#cookie-banner"]);
      
      const main = document.querySelector("main, article, .content, #content, .main") || document.body;
      return (main.textContent || "").replace(/\s+/g, " ").trim().substring(0, 15000);
    });
    
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      return anchors.slice(0, 20).map(a => ({
        text: (a.textContent || "").trim().substring(0, 100),
        href: a.getAttribute("href") || "",
      })).filter(l => l.text && l.href);
    });
    
    let tables: string[] = [];
    if (options?.extractTables !== false) {
      tables = await page.evaluate(() => {
        const tbls = Array.from(document.querySelectorAll("table")).slice(0, 3);
        return tbls.map(tbl => {
          const rows = Array.from(tbl.querySelectorAll("tr")).slice(0, 15);
          return rows.map(row => {
            const cells = Array.from(row.querySelectorAll("th, td"));
            return cells.map(c => (c.textContent || "").trim()).join(" | ");
          });
        }).flat();
      });
    }
    
    let screenshot: string | undefined;
    if (options?.captureScreenshot) {
      const screenshotBuffer = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 60 });
      screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
    }
    
    await browser.close();
    
    return {
      success: true,
      url,
      title,
      content,
      links,
      tables,
      screenshot,
      loadTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    if (browser) await browser.close().catch(() => {});
    return {
      success: false,
      url,
      title: "",
      content: "",
      links: [],
      tables: [],
      error: error.message,
      loadTimeMs: Date.now() - startTime,
    };
  }
}

export async function executeAdHocAutomation(
  organizationId: number,
  params: {
    name: string;
    url: string;
    actions?: AutomationStep[];
    captureScreenshot?: boolean;
  }
): Promise<ExecutionResult> {
  const defaultSteps: AutomationStep[] = params.actions || [
    { order: 1, action: "navigate", value: params.url, description: "Navigate to URL" },
    { order: 2, action: "wait", waitTime: 2000, description: "Wait for page load" },
  ];
  
  if (params.captureScreenshot !== false) {
    defaultSteps.push({
      order: defaultSteps.length + 1,
      action: "screenshot",
      value: "page_screenshot",
      description: "Capture page screenshot",
    });
  }
  
  const job = await createJob(organizationId, {
    name: params.name,
    inputData: { steps: defaultSteps },
  });
  
  return executeJob(job.id);
}
