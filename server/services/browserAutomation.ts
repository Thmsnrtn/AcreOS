import { db } from "../db";
import { 
  browserAutomationTemplates, 
  browserAutomationJobs, 
  browserSessionCredentials 
} from "@shared/schema";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import puppeteer, { Browser, Page } from "puppeteer-core";
import { execSync } from "child_process";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";
import {
  isBlockedBrowseUrl,
  resolveAndCheckBrowseHost,
  evaluateBrowseRequest,
} from "./browseRequestGate";
import { isPrivateIPv4 as isPrivateIpv4, isPrivateIPv6 as isPrivateIpv6 } from "../middleware/fileUploadSecurity";
import { plainRefusal } from "@shared/refusal/plainRefusal";
import {
  checkRobots,
  takeBrowseVisit,
  ROBOTS_MAX_BYTES,
  type RobotsFetchResult,
} from "./browseRobots";
import { checkBrowseDomainPolicy } from "../utils/browsePolicy";
import type { BrowseDnsDeps } from "./browseRequestGate";
// NOTE (merge of R-14 + PX-1): main's in-file dnsResolve4 / resolveAndCheckHost /
// isBlockedUrl implementations are NOT carried over — R-14 replaced them with
// aliases to browseRequestGate (see below), which PX-1's fetchRobotsTxt binds to.

// ── Chromium launch hardening (R-14 / F-1) ──────────────────────────────────
// Operator escape hatch: ONLY the exact value "1" re-opens the no-sandbox
// launch. Lives here (not in the gate module) because it is launch policy.
export function isChromiumSandboxDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ACREOS_CHROMIUM_NO_SANDBOX === "1";
}

const BROWSER_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "TMPDIR",
  "PUPPETEER_EXECUTABLE_PATH",
  "PUPPETEER_SKIP_DOWNLOAD",
  "PUPPETEER_CACHE_DIR",
  "CHROME_BIN",
  "CHROMIUM_FLAGS",
] as const;

// Allowlist ONLY — Chromium (which renders attacker-influenced pages) must not
// inherit FIELD_ENCRYPTION_KEY, DATABASE_URL or any other app secret.
export function scrubbedBrowserEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BROWSER_ENV_ALLOWLIST) {
    const value = source[key];
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  // Chromium needs a writable HOME to create its profile dir; the runtime user
  // is `node`, whose home is /home/node.
  if (!out.HOME) out.HOME = "/home/node";
  return out;
}

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
    logger.error("[browser-automation] Failed to find Chromium", error);
    throw error;
  }
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = getChromiumPath();
  logger.info(`[browser-automation] Launching browser from: ${executablePath}`);
  
  const args = ["--disable-dev-shm-usage", "--disable-gpu"];
  if (isChromiumSandboxDisabled()) {
    logger.warn(
      "[browser-automation] ACREOS_CHROMIUM_NO_SANDBOX=1 — Chromium sandbox DISABLED by operator choice; the R-14/F-1 exposure is re-opened",
    );
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  return puppeteer.launch({
    executablePath,
    headless: true,
    args,
    env: scrubbedBrowserEnv(),
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
  inputSchema: { name: string; type: "string" | "number" | "boolean"; required: boolean; description: string }[];
  outputSchema: { name: string; type: "string" | "number" | "boolean" | "array" | "object"; description: string }[];
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
  // Verify template ownership AT THE WRITE, not at execution. The route
  // (routes-misc.ts POST /api/browser-automation/jobs) passes req.body
  // .templateId straight through, and executeJob loads whatever template the
  // stored id names — so an unverified id here is a stored cross-org template
  // execution waiting for the queue processor to be wired (rule-1 service
  // wave, 2026-08-27). A template is usable if it is a system template
  // (organizationId null) or belongs to the creating org.
  if (params.templateId !== undefined && params.templateId !== null) {
    // The ownership predicate lives IN the query (system template = org null,
    // else the creating org's own), so a foreign org's row is never even read.
    const [template] = await db
      .select({ id: browserAutomationTemplates.id })
      .from(browserAutomationTemplates)
      .where(and(
        eq(browserAutomationTemplates.id, params.templateId),
        or(
          isNull(browserAutomationTemplates.organizationId),
          eq(browserAutomationTemplates.organizationId, organizationId),
        ),
      ));
    if (!template) {
      throw new Error("Template not found");
    }
  }
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

// The job-QUEUE chain (getQueuedJobs, processJobQueue, startJobProcessor,
// and its isProcessingQueue flag) was deleted 2026-08-30 — nothing ever
// STARTED the processor, so queued jobs never ran in the product's whole
// life; adversarially verified zero callers (dynamic, string-keyed, boot,
// cron, tests). The live thirds of this file stay: browseWeb (Pax's
// browse_web tool), executeAdHocAutomation/createJob/executeJob and the
// template reads (browserResearchSkill runs jobs INLINE, never via a queue).
// The /api/browser-automation/* queue routes retired in the same commit —
// zero client callers, and their receipts promised processing that never
// existed.

async function getJobById(jobId: number): Promise<AutomationJob | null> {
  const [job] = await db
    .select()
    .from(browserAutomationJobs)
    .where(eq(browserAutomationJobs.id, jobId))
    .limit(1);
  
  return (job as AutomationJob) || null;
}

async function updateJobStatus(
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
    updateData.startedAt = clock.now();
  }
  
  if (status === "completed" || status === "failed") {
    updateData.completedAt = clock.now();
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

// markCredentialUsed deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

export async function seedSystemTemplates(): Promise<void> {
  const existingCount = await db
    .select()
    .from(browserAutomationTemplates)
    .where(isNull(browserAutomationTemplates.organizationId))
    .limit(1);
  
  if (existingCount.length > 0) {
    logger.info("[browser-automation] System templates already seeded");
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
  
  logger.info("[browser-automation] Seeded system templates");
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
        capturedAt: clock.now().toISOString(),
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
  const startTime = clock.nowMs();
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
        logger.info(`[browser-automation] Executing step ${step.order}: ${step.description}`);
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
          executionTimeMs: clock.nowMs() - startTime,
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
      executionTimeMs: clock.nowMs() - startTime,
    };
    
    await updateJobStatus(jobId, "completed", {
      outputData: result.outputData,
      screenshots: result.screenshots.map(s => ({ ...s, url: s.data })),
      executionTimeMs: result.executionTimeMs,
    });
    
    logger.info(`[browser-automation] Job ${jobId} completed in ${result.executionTimeMs}ms`);
    
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
      executionTimeMs: clock.nowMs() - startTime,
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
  /** PX-1: the site's robots.txt disallows this path for automated visitors; nothing was fetched. */
  robotsDisallowed?: boolean;
  /** PX-1: robots.txt could not be read (server error / timeout), so the visit was refused rather than guessed. */
  robotsUnverified?: boolean;
  /** PX-1: too many visits to this host by this org in the window; nothing was fetched. */
  rateLimited?: boolean;
}

// ── ONE IMPLEMENTATION OF "IS THIS ADDRESS REACHABLE" ───────────────────────
// These were a local pair, and they had drifted from the ones in
// fileUploadSecurity: the IPv6 half here matched `::ffff:` only when the
// mapping was written in DOTTED form, so `::ffff:a9fe:a9fe` — the AWS metadata
// endpoint in hex — passed; it anchored link-local on `fe80:` rather than the
// fe80::/10 range, so `febf::1` passed; and it modelled neither NAT64 nor
// multicast nor the uncompressed spelling of loopback.
//
// Two implementations of one security rule is a rule as strong as whichever
// one an attacker reaches. Re-exported under the local names so the call sites
// below read unchanged, and so a future reader sees that the definition is
// somewhere else on purpose.

// R-14: the pattern and DNS checks now live in ./browseRequestGate (pure,
// fail-closed, testable); the local names are kept so browseWeb's pre-flight
// call sites read unchanged.
//
// browseWeb ALSO applies the canonical private-address helpers (imported
// above from fileUploadSecurity) directly — to the literal host and to every
// address the DNS check resolved — as its own final check before Chromium
// launches. This file is the one that navigates, so its pre-flight does not
// rest solely on the gate's internals: if the gate's checks are ever
// bypassed or change, a private destination is still rejected here.
const resolveAndCheckHost = resolveAndCheckBrowseHost;
const isBlockedUrl = isBlockedBrowseUrl;

/** How long the robots.txt fetch may take before the site counts as unverified. */
const ROBOTS_FETCH_TIMEOUT_MS = 5000;
/** Redirect hops followed for robots.txt — each hop re-passes the SSRF checks. */
const ROBOTS_MAX_REDIRECTS = 3;

/**
 * The network half of the robots check. It passes the SAME address checks as
 * the page itself, on every redirect hop (redirects are followed by hand so a
 * robots.txt cannot bounce us to an internal address). 4xx → no rules; anything
 * else that is not a readable 2xx → "error" (the caller refuses — fail-closed).
 */
async function fetchRobotsTxt(robotsUrl: string): Promise<RobotsFetchResult> {
  try {
    let current = robotsUrl;
    for (let hop = 0; hop <= ROBOTS_MAX_REDIRECTS; hop++) {
      const blocked = isBlockedUrl(current);
      if (blocked.blocked) return { status: "error" };
      const dns = await resolveAndCheckHost(new URL(current).hostname);
      if (!dns.allowed) return { status: "error" };

      const res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "acreos-browse (+robots-check)", Accept: "text/plain,*/*;q=0.5" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { status: "error" };
        current = new URL(loc, current).toString();
        continue;
      }
      if (res.status >= 400 && res.status < 500) return { status: "none" };
      if (!res.ok) return { status: "error" };
      const body = await res.text();
      return { status: "ok", body: body.slice(0, ROBOTS_MAX_BYTES) };
    }
    return { status: "error" };
  } catch (err) {
    logger.info("[browse_web] robots.txt could not be read", { metadata: { robotsUrl, err: err instanceof Error ? err.name : "error" } });
    return { status: "error" };
  }
}

export async function browseWeb(url: string, options?: {
  extractTables?: boolean;
  captureScreenshot?: boolean;
  waitMs?: number;
  /** Who is browsing — the per-org half of the visit rate limit. Absent = limited per host alone. */
  orgId?: number;
}): Promise<BrowseWebResult> {
  const startTime = clock.nowMs();
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
      loadTimeMs: clock.nowMs() - startTime,
    };
  }
  
  const parsed = new URL(url);

  // Direct private-address check on the literal host, with the canonical
  // helpers: a dotted-quad host is judged by isPrivateIpv4, a bracketed /
  // colon host by isPrivateIpv6. The gate's pattern check blocks these too;
  // browseWeb applies the rule itself because it is the navigating consumer.
  const literalHost = parsed.hostname.toLowerCase();
  const isPrivateLiteralHost =
    literalHost.startsWith("[") || literalHost.includes(":")
      ? isPrivateIpv6(literalHost)
      : /^\d+\.\d+\.\d+\.\d+$/.test(literalHost) && isPrivateIpv4(literalHost);
  if (isPrivateLiteralHost) {
    return {
      success: false,
      url,
      title: "",
      content: "",
      links: [],
      tables: [],
      error: plainRefusal({
        what: "The page was not opened",
        why: "That link names an internal or private network address directly, and I never open those",
        unlock: "Ask about a public website address instead",
      }),
      loadTimeMs: clock.nowMs() - startTime,
    };
  }

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
      loadTimeMs: clock.nowMs() - startTime,
    };
  }

  // Re-validate every resolved address with the canonical helpers before
  // launching Chromium: these are the addresses this navigation will
  // actually reach, and browseWeb rejects a private one itself rather than
  // trusting that the gate's internals never change.
  for (const addr of dnsCheck.resolvedAddresses ?? []) {
    const isPrivateResolved = addr.includes(":") ? isPrivateIpv6(addr) : isPrivateIpv4(addr);
    if (isPrivateResolved) {
      return {
        success: false,
        url,
        title: "",
        content: "",
        links: [],
        tables: [],
        error: plainRefusal({
          what: "The page was not opened",
          why: `That website's name resolves to a private or internal address (${addr}), and I never open those`,
          unlock: "Ask about a public website address instead",
        }),
        loadTimeMs: clock.nowMs() - startTime,
      };
    }
  }
  // PX-1 — honour the site's robots.txt before anything is fetched.
  const robots = await checkRobots(parsed, fetchRobotsTxt, clock.nowMs());
  if (robots === "disallowed") {
    return {
      success: false,
      url,
      title: "",
      content: "",
      links: [],
      tables: [],
      error: plainRefusal({
        what: "The page was not opened",
        why: "That website's robots.txt asks automated visitors to stay out of this page",
        unlock: "Open it yourself in your browser, or ask about a different page",
      }),
      loadTimeMs: clock.nowMs() - startTime,
      robotsDisallowed: true,
    };
  }
  if (robots === "unverified") {
    return {
      success: false,
      url,
      title: "",
      content: "",
      links: [],
      tables: [],
      error: plainRefusal({
        what: "The page was not opened",
        why: "I could not read that website's rules for automated visitors, so I did not guess",
        unlock: "Try again in a minute, or open it yourself in your browser",
      }),
      loadTimeMs: clock.nowMs() - startTime,
      robotsUnverified: true,
    };
  }

  // PX-1 — pace visits: a limit per org per host.
  if (!takeBrowseVisit(options?.orgId, parsed.hostname, clock.nowMs()).allowed) {
    return {
      success: false,
      url,
      title: "",
      content: "",
      links: [],
      tables: [],
      error: plainRefusal({
        what: "The page was not opened",
        why: "There have been a lot of visits to this website in the last few minutes, and I pace them so it is not overloaded",
        unlock: "Wait a few minutes and ask again",
      }),
      loadTimeMs: clock.nowMs() - startTime,
      rateLimited: true,
    };
  }

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    
    await page.setRequestInterception(true);
    // FAIL CLOSED (R-14 / F-2): the only path to request.continue() is a
    // positive "continue" from evaluateBrowseRequest. Any error — including
    // continue() itself failing — ends in abort, never in continue.
    // Residual: Chromium re-resolves the host after this check and
    // puppeteer-core interception cannot pin the connection to the addresses
    // validated here, so a DNS-rebinding window remains (PX-10 closes it).
    page.on("request", async (request) => {
      let reqUrl = "";
      try {
        reqUrl = request.url();
        const decision = await evaluateBrowseRequest(reqUrl);
        if (decision.action === "continue") {
          await request.continue();
          return;
        }
        logger.info(`[browse_web] Blocked request: ${reqUrl} - ${decision.reason}`);
        await request.abort("blockedbyclient");
      } catch (err) {
        logger.warn(`[browse_web] Request handler error, blocking: ${reqUrl}`);
        try {
          await request.abort("blockedbyclient");
        } catch {
          // already handled (e.g. continue() raced) — nothing left to abort
        }
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
      loadTimeMs: clock.nowMs() - startTime,
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
      loadTimeMs: clock.nowMs() - startTime,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PX-7 — the navigation primitive behind Pax's bounded public-search sessions
// (server/services/paxBrowseSearch.ts). Two pieces, both deliberately small:
//
//   preflightBrowseNavigation  the SAME stack browseWeb runs before it fetches
//                              anything, as one callable, so a search session
//                              can re-pass it on EVERY navigation:
//                              isBlockedUrl → private literal → operator domain
//                              policy → DNS/private addresses → the R-14
//                              request gate → robots.txt → the PX-1 per-org /
//                              per-host rate limit. It calls the same functions
//                              browseWeb calls (no second copy of any rule).
//   openBrowseNavSession       one Chromium page that can ONLY navigate to a
//                              URL it is handed and snapshot what it landed on.
//                              It exposes no click, no typing, no scripting, no
//                              download. Every request the page makes passes the
//                              R-14 gate, only GET/HEAD requests are let through
//                              (no POST body, ever), and a main-frame navigation
//                              (a redirect included) to a host the session may
//                              not visit is aborted.
//
// browseWeb itself is untouched on purpose: its refusals are counted by the
// plain-words ratchet (tests/unit/refusalsArePlainWords.test.ts), and this
// block therefore reports outcomes as `kind`-tagged unions, never as
// `{ success: false, error }` objects. paxBrowseSearchGate.test.ts pins that
// preflightBrowseNavigation and browseWeb reach the same gate functions.
// ════════════════════════════════════════════════════════════════════════════

/** Why a navigation was refused before anything was fetched. Internal vocabulary — never shown to a person. */
export type BrowseNavRefusalReason =
  | "address_blocked"
  | "private_address"
  | "unresolvable"
  | "site_policy"
  | "request_blocked"
  | "robots_disallowed"
  | "robots_unverified"
  | "rate_limited";

export type BrowsePreflightOutcome =
  | { kind: "clear"; url: URL }
  | { kind: "refused"; reason: BrowseNavRefusalReason; detail: string };

/** Test seams for the preflight: the DNS resolvers and the robots.txt fetch. */
export interface BrowsePreflightDeps {
  dns?: BrowseDnsDeps;
  fetchRobots?: (robotsUrl: string) => Promise<RobotsFetchResult>;
}

export async function preflightBrowseNavigation(
  url: string,
  options: {
    orgId?: number;
    /** Count this navigation against the per-org/per-host visit limit. Default true; a re-check of a redirect's landing URL passes false. */
    takeVisit?: boolean;
    deps?: BrowsePreflightDeps;
  } = {},
): Promise<BrowsePreflightOutcome> {
  const refuse = (reason: BrowseNavRefusalReason, detail: string): BrowsePreflightOutcome => ({ kind: "refused", reason, detail });

  const urlCheck = isBlockedUrl(url);
  if (urlCheck.blocked) return refuse("address_blocked", urlCheck.reason ?? "URL blocked");
  const parsed = new URL(url);

  const literalHost = parsed.hostname.toLowerCase();
  const isPrivateLiteralHost =
    literalHost.startsWith("[") || literalHost.includes(":")
      ? isPrivateIpv6(literalHost)
      : /^\d+\.\d+\.\d+\.\d+$/.test(literalHost) && isPrivateIpv4(literalHost);
  if (isPrivateLiteralHost) return refuse("private_address", "literal private host");

  // The operator's domain allow/deny policy (BROWSE_WEB_DOMAIN_*), which the
  // browse_web tool applies at its own boundary — applied here on every hop.
  const policy = checkBrowseDomainPolicy(parsed.hostname);
  if (!policy.allowed) return refuse("site_policy", policy.reason ?? "blocked by policy");

  const dnsCheck = await resolveAndCheckHost(parsed.hostname, options.deps?.dns);
  if (!dnsCheck.allowed) {
    return refuse(/private|internal/i.test(dnsCheck.reason ?? "") ? "private_address" : "unresolvable", dnsCheck.reason ?? "DNS resolution blocked");
  }
  for (const addr of dnsCheck.resolvedAddresses ?? []) {
    const isPrivateResolved = addr.includes(":") ? isPrivateIpv6(addr) : isPrivateIpv4(addr);
    if (isPrivateResolved) return refuse("private_address", `resolves to ${addr}`);
  }

  // The R-14 gate, exactly as it judges each sub-request the browser makes.
  const gate = await evaluateBrowseRequest(url, options.deps?.dns);
  if (gate.action !== "continue") return refuse("request_blocked", gate.reason ?? "request gate");

  const robots = await checkRobots(parsed, options.deps?.fetchRobots ?? fetchRobotsTxt, clock.nowMs());
  if (robots === "disallowed") return refuse("robots_disallowed", "robots.txt disallows this path");
  if (robots === "unverified") return refuse("robots_unverified", "robots.txt could not be read");

  if (options.takeVisit !== false && !takeBrowseVisit(options.orgId, parsed.hostname, clock.nowMs()).allowed) {
    return refuse("rate_limited", "visit rate limit");
  }
  return { kind: "clear", url: parsed };
}

/** One control inside a form, as the page presented it. Plain data — the judge reads it, nothing executes it. */
export interface BrowseFormField {
  tag: "input" | "textarea" | "select" | "button";
  /** input type lower-cased (text, search, password, hidden, checkbox, …); the tag name for non-inputs. */
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  /** The control's current/default value (a select's selected option). */
  value: string;
  checked: boolean;
  /** type=hidden, or not rendered (display:none / visibility:hidden). */
  hidden: boolean;
  disabled: boolean;
}

export interface BrowseFormDescriptor {
  /** The declared method, lower-cased; "get" when the attribute is absent. */
  method: string;
  /** The form's action resolved against the page; "" when it could not be resolved. */
  action: string;
  fields: BrowseFormField[];
}

/** A link on the page (an <a href> or a <link rel=next>), for the next-page finder. */
export interface BrowseAnchorDescriptor {
  text: string;
  href: string;
  rel: string;
}

/** What one navigation landed on: browseWeb's extraction, plus the raw signals the search judge reads. */
export interface BrowseNavPage {
  /** The URL the browser ended on (after redirects). */
  url: string;
  title: string;
  content: string;
  /** The first 20 links, exactly as browseWeb extracts them (raw href attributes). */
  links: { text: string; href: string }[];
  tables: string[];
  httpStatus: number | null;
  /** The page's HTML (capped), read ONLY by challenge detection — never returned to a model. */
  html: string;
  forms: BrowseFormDescriptor[];
  anchors: BrowseAnchorDescriptor[];
}

export type BrowseNavOutcome =
  | { kind: "page"; page: BrowseNavPage }
  | { kind: "refused"; reason: "left_site" | "not_a_web_page" | "timed_out" | "did_not_load"; detail: string };

export interface BrowseNavSession {
  /** Go to `url` (the caller has ALREADY passed it through preflightBrowseNavigation) and snapshot the page. */
  navigate(url: string): Promise<BrowseNavOutcome>;
  /** Close Chromium. Safe to call twice. */
  close(): Promise<void>;
}

export interface BrowseNavSessionOptions {
  /** May a main-frame navigation (including a redirect) land on this host? */
  allowNavigationHost: (hostname: string) => boolean;
  /** Per-navigation timeout. */
  navTimeoutMs: number;
}

const BROWSE_NAV_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BROWSE_NAV_HTML_CAP = 300_000;

export async function openBrowseNavSession(options: BrowseNavSessionOptions): Promise<BrowseNavSession> {
  const browser = await launchBrowser();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser.close().catch(() => {});
  };

  let page: Page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(BROWSE_NAV_USER_AGENT);

    // Downloads are never wanted. Best effort on top of the content-type check
    // in navigate(): a page that cannot be told to refuse them is still only
    // ever sent to URLs the search judge chose.
    try {
      const cdp = await page.createCDPSession();
      await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
    } catch (err) {
      logger.warn("[browse_search] Could not set download behaviour to deny", { metadata: { err: err instanceof Error ? err.name : "error" } });
    }

    await page.setRequestInterception(true);
    // FAIL CLOSED, same as browseWeb: the only path to continue() is a positive
    // decision; any error ends in abort. Plus the two search-session rules:
    // only GET/HEAD (no POST body, ever) and no main-frame hop to a host the
    // session may not visit.
    page.on("request", async (request) => {
      let reqUrl = "";
      try {
        reqUrl = request.url();
        const method = request.method().toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          await request.abort("blockedbyclient");
          return;
        }
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          if (!options.allowNavigationHost(new URL(reqUrl).hostname)) {
            logger.info(`[browse_search] Blocked navigation off the session's site: ${reqUrl}`);
            await request.abort("blockedbyclient");
            return;
          }
        }
        const decision = await evaluateBrowseRequest(reqUrl);
        if (decision.action === "continue") {
          await request.continue();
          return;
        }
        logger.info(`[browse_search] Blocked request: ${reqUrl} - ${decision.reason}`);
        await request.abort("blockedbyclient");
      } catch {
        logger.warn(`[browse_search] Request handler error, blocking: ${reqUrl}`);
        try {
          await request.abort("blockedbyclient");
        } catch {
          // already handled — nothing left to abort
        }
      }
    });
  } catch (err) {
    await close();
    throw err;
  }

  const navigate = async (url: string): Promise<BrowseNavOutcome> => {
    try {
      const response = await page.goto(url, { waitUntil: "networkidle2", timeout: options.navTimeoutMs });
      const httpStatus = response ? response.status() : null;
      const contentType = String(response?.headers()["content-type"] ?? "");
      if (contentType && !/^(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
        return { kind: "refused", reason: "not_a_web_page", detail: contentType.slice(0, 80) };
      }

      const finalUrl = page.url();
      let finalHost = "";
      try {
        finalHost = new URL(finalUrl).hostname;
      } catch {
        finalHost = "";
      }
      if (!finalHost || !options.allowNavigationHost(finalHost)) {
        return { kind: "refused", reason: "left_site", detail: finalHost };
      }

      const title = await page.title();
      const html = (await page.content()).slice(0, BROWSE_NAV_HTML_CAP);

      // Forms and links are read BEFORE the content pass below, which removes
      // nav/header/footer/aside from the DOM — a site's search box and its
      // pager live in exactly those elements.
      const forms = await page.evaluate((): BrowseFormDescriptor[] => {
        const isRendered = (el: Element): boolean => {
          const style = window.getComputedStyle(el as HTMLElement);
          return style.display !== "none" && style.visibility !== "hidden";
        };
        return Array.from(document.querySelectorAll("form"))
          .slice(0, 10)
          .map((form) => {
            let action = "";
            try {
              action = new URL(form.getAttribute("action") ?? "", document.baseURI).href;
            } catch {
              action = "";
            }
            const fields = Array.from(form.querySelectorAll("input, textarea, select, button"))
              .slice(0, 60)
              .map((el) => {
                const tag = el.tagName.toLowerCase() as BrowseFormField["tag"];
                const input = el as HTMLInputElement;
                const type = tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : tag === "button" ? (el.getAttribute("type") || "submit").toLowerCase() : tag;
                return {
                  tag,
                  type,
                  name: (el.getAttribute("name") || "").slice(0, 100),
                  id: (el.getAttribute("id") || "").slice(0, 100),
                  placeholder: (el.getAttribute("placeholder") || "").slice(0, 100),
                  ariaLabel: (el.getAttribute("aria-label") || "").slice(0, 100),
                  value: String((el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value ?? "").slice(0, 500),
                  checked: tag === "input" ? Boolean(input.checked) : false,
                  hidden: type === "hidden" || !isRendered(el),
                  disabled: Boolean((el as HTMLInputElement).disabled),
                };
              });
            return { method: (form.getAttribute("method") || "get").toLowerCase(), action, fields };
          });
      });

      const anchors = await page.evaluate((): BrowseAnchorDescriptor[] =>
        Array.from(document.querySelectorAll("a[href], link[rel~='next'][href]"))
          .slice(0, 300)
          .map((a) => ({
            text: (a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "").trim().replace(/\s+/g, " ").substring(0, 100),
            href: a.getAttribute("href") || "",
            rel: (a.getAttribute("rel") || "").toLowerCase(),
          }))
          .filter((a) => a.href),
      );

      // The same three extractions browseWeb performs, with the same caps.
      const content = await page.evaluate(() => {
        const removeElements = (selectors: string[]) => {
          selectors.forEach((sel) => {
            document.querySelectorAll(sel).forEach((el) => el.remove());
          });
        };
        removeElements(["script", "style", "nav", "footer", "header", "aside", ".ad", ".advertisement", "#cookie-banner"]);
        const main = document.querySelector("main, article, .content, #content, .main") || document.body;
        return (main.textContent || "").replace(/\s+/g, " ").trim().substring(0, 15000);
      });
      const links = await page.evaluate(() => {
        const found = Array.from(document.querySelectorAll("a[href]"));
        return found
          .slice(0, 20)
          .map((a) => ({
            text: (a.textContent || "").trim().substring(0, 100),
            href: a.getAttribute("href") || "",
          }))
          .filter((l) => l.text && l.href);
      });
      const tables = await page.evaluate(() => {
        const tbls = Array.from(document.querySelectorAll("table")).slice(0, 3);
        return tbls
          .map((tbl) => {
            const rows = Array.from(tbl.querySelectorAll("tr")).slice(0, 15);
            return rows.map((row) => {
              const cells = Array.from(row.querySelectorAll("th, td"));
              return cells.map((c) => (c.textContent || "").trim()).join(" | ");
            });
          })
          .flat();
      });

      return { kind: "page", page: { url: finalUrl, title, content, links, tables, httpStatus, html, forms, anchors } };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      return { kind: "refused", reason: timedOut ? "timed_out" : "did_not_load", detail: err instanceof Error ? err.name : "error" };
    }
  };

  return { navigate, close };
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
