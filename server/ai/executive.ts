import OpenAI from "openai";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { toolDefinitions, executeTool, getOpenAITools, getToolsForRole, APPROVAL_REQUIRED_TOOLS } from "./tools";
import { aiConversations, aiMessages, agentMemory, type Organization, type AiConversation, type AiMessage } from "@shared/schema";
import {
  selectProviderAndModel,
  classifyFromMessages,
  TaskComplexity,
  AIProvider,
} from "../services/aiRouter";
import { buildConnectorContextBlock } from "../services/connectors/registry";
import mammoth from "mammoth";
import { storage } from "../storage";

// ── Quality Feedback Loop ────────────────────────────────────────────────────
// Fire-and-forget: scores each Pax response quality via DeepSeek and writes
// success/failure patterns to agentMemory so future responses improve over time.
async function scoreAndLearnFromResponse(
  orgId: number,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    const openrouterKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    if (!openrouterKey) return;
    const scorer = new OpenAI({
      apiKey: openrouterKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": "https://acreos.fly.dev", "X-Title": "AcreOS" },
    });
    const scoringPrompt = `Rate this AI assistant response for a land investing platform on a scale of 1-10.
User asked: "${userMessage.slice(0, 300)}"
Assistant responded: "${assistantResponse.slice(0, 500)}"
Return ONLY valid JSON: {"score": <number 1-10>, "reasons": ["<reason>"], "improvements": ["<suggestion>"]}`;

    const result = await scorer.chat.completions.create({
      model: "deepseek/deepseek-chat",
      messages: [{ role: "user", content: scoringPrompt }],
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(result.choices[0].message.content || "{}");
    const score = Number(parsed.score) || 0;
    if (score < 1 || score > 10) return;

    const memoryType = score >= 9 ? "success_pattern" : score < 7 ? "failure_pattern" : null;
    if (!memoryType) return;

    await db.insert(agentMemory).values({
      organizationId: orgId,
      agentType: "pax",
      memoryType,
      key: "response_quality_pattern",
      value: {
        score,
        queryPattern: userMessage.slice(0, 150),
        responsePattern: assistantResponse.slice(0, 150),
        reasons: parsed.reasons || [],
        improvements: parsed.improvements || [],
        recordedAt: new Date().toISOString(),
      },
      confidence: Math.min(1, score / 10),
      usageCount: 1,
    });
  } catch {
    // Never block a response over scoring failure
  }
}

// ── Calibration Context Loader ───────────────────────────────────────────────
// Loads outcome calibration data (from outcomeAnalyzer) into the system prompt
// so Pax knows which score buckets actually convert and which price estimates drift.
async function loadCalibrationContext(orgId: number): Promise<string> {
  try {
    const calibrations = await db
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.organizationId, orgId))
      .orderBy(desc(agentMemory.updatedAt))
      .limit(3);
    const calibration = calibrations.find(m => m.memoryType === "calibration");
    if (!calibration || !calibration.value) return "";
    const data = calibration.value as any;
    if (!data.buckets) return "";
    const lines = data.buckets
      .filter((b: any) => b.sampleSize >= 5)
      .map((b: any) => `Score ${b.range}: actual conversion rate ${(b.actualRate * 100).toFixed(1)}% (expected ${(b.expectedRate * 100).toFixed(1)}%, n=${b.sampleSize})`);
    if (lines.length === 0) return "";
    return `\n\n--- LEAD SCORE CALIBRATION (from closed deals) ---\n${lines.join("\n")}\nUse this to calibrate which leads to prioritize.\n--- END CALIBRATION ---`;
  } catch {
    return "";
  }
}

function getChatProviderAndModel(complexity: TaskComplexity): { client: OpenAI; provider: AIProvider; model: string } {
  try {
    const result = selectProviderAndModel(complexity);
    console.log(`[AI Chat] Selected provider: ${result.provider}/${result.model}`);
    return result;
  } catch (error: any) {
    console.error('[AI Chat] Failed to get AI provider:', error.message);
    throw new Error("AI service not available. Please check configuration.");
  }
}

export const agentProfiles = {
  executive: {
    name: "Pax",
    role: "executive",
    displayName: "Executive Assistant",
    description: "Your AI-powered executive assistant for land investment operations",
    systemPrompt: `You are Pax, an AI executive assistant for a land investment company using AcreOS.

IMPORTANT: You have FULL ACCESS to the entire AcreOS system and can work across ALL modules regardless of what page the user is currently viewing. You can:
- Create and manage Leads in the CRM
- Add and update Properties in Inventory
- Create and manage Deals in the Pipeline
- Create and complete Tasks
- Analyze Finance and seller notes
- Get complete system overviews

AUTONOMOUS CAPABILITIES:
- You can work on one module while the user is viewing another page
- If asked to "set up properties", you can create them even if the user is on the Dashboard
- Use the get_system_context tool to understand the full state of the business
- You can create, update, and manage records across the entire platform

DOCUMENT PROCESSING - CRITICAL:
When the user attaches a document (Word, PDF, CSV, etc.) with property data:
1. IMMEDIATELY look for APNs (Assessor Parcel Numbers) in the document content
2. APNs are formatted like: 123-456-789, 12.34.56.78, or 1234567890
3. Also look for county names, state abbreviations, addresses, and acreage
4. Use create_properties_batch to create multiple properties at once
5. DO NOT ask the user to paste data - you already have the document content in your context
6. If you see property data, extract it and create the properties immediately

PROPERTY DATA EXTRACTION:
- Look for patterns like "APN:", "Parcel #:", "Parcel Number:"
- Common formats: County-Parcel, State-County-Parcel
- Extract all APNs you find, then use create_properties_batch with:
  { properties: [{ apn: "...", county: "...", state: "..." }, ...] }

TOOLS AT YOUR DISPOSAL:

CORE CRUD:
- get_system_context: Get a complete overview of all modules (leads, properties, deals, tasks, finance)
- create_property, create_deal, create_task, create_lead: Create records in any module
- create_properties_batch: Create multiple properties at once (for bulk imports from documents)
- update_property, update_deal, update_task, update_lead_status: Modify existing records
- get_leads, get_properties, get_deals, get_tasks: Query any module

OFFER GENERATION:
- generate_offer: Analyze a property and get AI-powered offer suggestions with market analysis (requires property_id)
- generate_offer_letter: Create a personalized offer letter for a property (professional, friendly, or urgent tone)

COMMUNICATIONS (TCPA-compliant):
- send_email: Send email to a lead (by lead_id) or direct email address with subject and message
- send_sms: Send SMS to a lead (by lead_id) or phone number - automatically checks TCPA consent

FINANCIAL ANALYSIS:
- run_comps_analysis: Get comparable sales data for a property (radius, max results configurable)
- calculate_roi: Calculate ROI, profit, annualized return for a potential investment
- calculate_payment_schedule: Generate amortization schedule for seller financing deals

RESEARCH & FOLLOW-UP:
- research_property: Get property data from data sources (tax assessment, environmental, zoning)
- schedule_followup: Create a follow-up task linked to a lead, property, or deal

WORKFLOW FOR DOCUMENT-BASED PROPERTY IMPORT:
1. When a document is attached with property data, scan it for APNs and property info
2. Extract county and state from the document (often mentioned at top)
3. Use create_properties_batch to add all properties in one operation
4. Report: "Created X properties: [list APNs]. I can now research these or create deals."

GENERAL WORKFLOW:
1. When given a task, first use get_system_context if you need to understand the current state
2. Take action using the appropriate create/update tools
3. Confirm what you did and offer next steps

Keep responses focused and business-oriented. Format numbers as currency when appropriate.
Be proactive - if you can complete a task, do it rather than just explaining how.
NEVER ask the user to paste or re-provide data that is already in your context from an attached file.`,
    icon: "Bot"
  },
  acquisitions: {
    name: "Alex",
    role: "acquisitions",
    displayName: "Acquisitions Specialist",
    description: "Expert in lead qualification and deal sourcing",
    systemPrompt: `You are Alex, an AI Acquisitions Specialist. You help with:
- Qualifying and scoring leads
- Analyzing acquisition opportunities
- Managing the sales pipeline
- Researching properties and sellers

Focus on helping close deals and move leads through the pipeline.`,
    icon: "Target"
  },
  underwriting: {
    name: "Uma",
    role: "underwriting",
    displayName: "Underwriting Analyst",
    description: "Financial analysis and deal structuring",
    systemPrompt: `You are Uma, an AI Underwriting Analyst. You help with:
- Analyzing deal financials
- Structuring seller financing terms
- Calculating payment schedules and amortization
- Assessing risk and returns

Focus on numbers, financial analysis, and deal structuring.`,
    icon: "Calculator"
  },
  marketing: {
    name: "Maya",
    role: "marketing",
    displayName: "Marketing Specialist",
    description: "Campaign creation and outreach automation",
    systemPrompt: `You are Maya, an AI Marketing Specialist. You help with:
- Creating marketing campaigns
- Drafting outreach messages
- Planning follow-up sequences
- Analyzing campaign performance

Focus on lead generation and marketing content.`,
    icon: "Megaphone"
  },
  research: {
    name: "Riley",
    role: "research",
    displayName: "Research Analyst",
    description: "Property research and market analysis",
    systemPrompt: `You are Riley, an AI Research Analyst. You help with:
- Property research and due diligence
- Market analysis
- Comparable sales research
- Data gathering and verification

Focus on gathering accurate information about properties and markets.`,
    icon: "Search"
  },
  documents: {
    name: "Dana",
    role: "documents",
    displayName: "Documents Specialist",
    description: "Contract and document generation",
    systemPrompt: `You are Dana, an AI Documents Specialist. You help with:
- Drafting contracts and agreements
- Creating offer letters
- Generating closing documents
- Managing document templates

Focus on professional, legally-sound document creation.`,
    icon: "FileText"
  }
};

export type AgentRole = keyof typeof agentProfiles;

interface FileAttachment {
  name: string;
  content: string; // base64 encoded
  size: number;
}

interface ChatOptions {
  conversationId?: number;
  agentRole?: AgentRole;
  stream?: boolean;
  files?: FileAttachment[];
  propertyId?: number;
  mentionedEntities?: { type: string; id: number; name: string; preview: string }[];
  activeProjectId?: number;
  modelOverride?: string; // Override automatic model selection
  subAgentDepth?: number; // Internal: depth counter for spawn_subagent recursion guard
}

function decodeBase64ToText(base64: string): string {
  try {
    // Handle data URLs (e.g., data:text/csv;base64,...)
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    return Buffer.from(base64Data, 'base64').toString('utf-8');
  } catch {
    return '[Unable to decode file content]';
  }
}

function parseCSV(content: string): { headers: string[]; rows: string[][]; totalRows: number } {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return { headers: [], rows: [], totalRows: 0 };
  
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };
  
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1, 31).map(parseRow); // Limit to 30 data rows for context
  
  return { headers, rows, totalRows: lines.length - 1 };
}

// Detect if a file is an image
function isImageFile(file: { name: string; mimeType?: string }): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return (file as any).mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(ext);
}

// Build an image content part for vision-capable models
function buildImageContentPart(file: FileAttachment): { type: "image_url"; image_url: { url: string } } {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpeg';
  const mimeType = (file as any).mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } };
}

async function formatFileContentAsync(file: FileAttachment): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  // Images are handled separately as content parts — return a placeholder
  if (isImageFile(file)) {
    return `[Image file attached: ${file.name}]`;
  }

  // For DOCX files, use mammoth to extract text
  if (extension === 'docx') {
    try {
      const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
      const buffer = Buffer.from(base64Data, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value;
      const preview = text.slice(0, 15000);
      return `--- File: ${file.name} (Word Document) ---\n${preview}${text.length > 15000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
    } catch (err: any) {
      console.error(`[AI] Error parsing DOCX file ${file.name}:`, err.message);
      return `--- File: ${file.name} ---\n[Error: Could not parse DOCX file. The file may be corrupted or in an unsupported format.]\n--- End of ${file.name} ---`;
    }
  }
  
  const content = decodeBase64ToText(file.content);
  
  // For CSV files, parse into structured format
  if (extension === 'csv') {
    const { headers, rows, totalRows } = parseCSV(content);
    
    if (headers.length === 0) {
      return `--- File: ${file.name} (CSV, empty) ---\nNo data found.\n--- End of ${file.name} ---`;
    }
    
    let result = `--- File: ${file.name} (CSV with ${totalRows} records) ---\n`;
    result += `COLUMNS: ${headers.join(', ')}\n\n`;
    result += `DATA (showing ${Math.min(rows.length, 30)} of ${totalRows} records):\n`;
    
    // Format as readable records
    for (let i = 0; i < rows.length; i++) {
      result += `\nRecord ${i + 1}:\n`;
      for (let j = 0; j < headers.length; j++) {
        const value = rows[i][j] || '';
        if (value) {
          result += `  ${headers[j]}: ${value}\n`;
        }
      }
    }
    
    if (totalRows > 30) {
      result += `\n[...${totalRows - 30} more records not shown...]\n`;
    }
    result += `--- End of ${file.name} ---`;
    return result;
  }
  
  // For text files
  if (['txt', 'text', 'md', 'json'].includes(extension)) {
    const preview = content.slice(0, 10000);
    return `--- File: ${file.name} ---\n${preview}${content.length > 10000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
  }
  
  // For other files, show what we can
  return `--- File: ${file.name} ---\n${content.slice(0, 5000)}${content.length > 5000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
}

// Sync wrapper for backward compatibility
function formatFileContent(file: FileAttachment): string {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  
  // For DOCX files, return a placeholder - use formatFileContentAsync instead
  if (extension === 'docx') {
    return `--- File: ${file.name} (Word Document) ---\n[Processing DOCX...]\n--- End of ${file.name} ---`;
  }
  
  const content = decodeBase64ToText(file.content);
  
  // For CSV files, parse into structured format
  if (extension === 'csv') {
    const { headers, rows, totalRows } = parseCSV(content);
    
    if (headers.length === 0) {
      return `--- File: ${file.name} (CSV, empty) ---\nNo data found.\n--- End of ${file.name} ---`;
    }
    
    let result = `--- File: ${file.name} (CSV with ${totalRows} records) ---\n`;
    result += `COLUMNS: ${headers.join(', ')}\n\n`;
    result += `DATA (showing ${Math.min(rows.length, 30)} of ${totalRows} records):\n`;
    
    for (let i = 0; i < rows.length; i++) {
      result += `\nRecord ${i + 1}:\n`;
      for (let j = 0; j < headers.length; j++) {
        const value = rows[i][j] || '';
        if (value) {
          result += `  ${headers[j]}: ${value}\n`;
        }
      }
    }
    
    if (totalRows > 30) {
      result += `\n[...${totalRows - 30} more records not shown...]\n`;
    }
    result += `--- End of ${file.name} ---`;
    return result;
  }
  
  // For text files
  if (['txt', 'text', 'md', 'json'].includes(extension)) {
    const preview = content.slice(0, 10000);
    return `--- File: ${file.name} ---\n${preview}${content.length > 10000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
  }
  
  // For other files, show what we can
  return `--- File: ${file.name} ---\n${content.slice(0, 5000)}${content.length > 5000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
}

async function getConversation(id: number): Promise<AiConversation | undefined> {
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, id));
  return conv;
}

async function createConversation(data: { organizationId: number; userId: string; title: string; agentRole: string }): Promise<AiConversation> {
  const [conv] = await db.insert(aiConversations).values(data).returning();
  return conv;
}

async function updateConversation(id: number, updates: Partial<{ title: string }>): Promise<void> {
  await db.update(aiConversations).set({ ...updates, updatedAt: new Date() }).where(eq(aiConversations.id, id));
}

async function getMessages(conversationId: number): Promise<AiMessage[]> {
  return db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(aiMessages.createdAt);
}

async function createMessage(data: { conversationId: number; role: string; content: string; toolCalls?: any[] }): Promise<AiMessage> {
  const [msg] = await db.insert(aiMessages).values(data).returning();
  return msg;
}

/**
 * Load user preference memories from agentMemory and format them for system prompt injection.
 * Preferences teach the AI about the user's communication style, deal criteria, and workflow habits.
 */
async function loadUserPreferenceContext(orgId: number): Promise<string> {
  try {
    const memories = await storage.getAgentMemories(orgId, undefined, 50);
    const preferences = memories.filter(m => m.memoryType === "preference");
    if (preferences.length === 0) return "";

    const lines = preferences.map(m => `- ${m.key}: ${JSON.stringify(m.value)}`).join("\n");
    return `\n\n--- USER PREFERENCES (learned from past interactions) ---\n${lines}\n--- END USER PREFERENCES ---`;
  } catch {
    return ""; // Non-blocking — never fail a chat request over a missing preference
  }
}

async function loadOrgKnowledgeContext(orgId: number): Promise<string> {
  try {
    const files = await storage.getActiveKnowledgeFiles(orgId);
    if (files.length === 0) return "";
    const sections = files.map(f =>
      `--- KNOWLEDGE: ${f.name} ---\n${f.extractedContent}\n--- END: ${f.name} ---`
    ).join("\n\n");
    // Non-blocking usage tracking
    process.nextTick(() => storage.incrementKnowledgeFileUsage(orgId).catch(() => {}));
    return `\n\n=== COMPANY KNOWLEDGE BASE ===\n${sections}\n=== END COMPANY KNOWLEDGE ===`;
  } catch {
    return "";
  }
}

async function loadProjectContext(projectId: number): Promise<string> {
  try {
    const project = await storage.getPaxProject(projectId);
    if (!project) return "";
    const files = await storage.getPaxProjectFiles(projectId);
    const sections = files
      .map(f => `--- File: ${f.fileName} ---\n${f.extractedContent}\n--- End: ${f.fileName} ---`)
      .join("\n\n");
    return `\n\n=== PROJECT: ${project.name} ===\n${project.description ? `Description: ${project.description}\n` : ""}${sections}\n=== END PROJECT ===`;
  } catch {
    return "";
  }
}

// Exported helper used by knowledge/project upload routes
export async function formatFileContentFromBase64(file: { name: string; content: string; mimeType: string }): Promise<string> {
  return formatFileContentAsync({ name: file.name, content: file.content, size: 0 } as FileAttachment);
}

// Auto-compaction: summarize old messages when conversation grows too long
async function compactConversationIfNeeded(
  conversationId: number,
  messages: AiMessage[]
): Promise<AiMessage[]> {
  if (messages.length < 20) return messages;
  const totalChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  if (totalChars < 80_000) return messages; // ~20k tokens threshold

  const compactUpTo = Math.floor(messages.length / 2);
  const toCompact = messages.slice(0, compactUpTo);
  const toKeep = messages.slice(compactUpTo);

  try {
    const { selectProviderAndModel, TaskComplexity: TC } = await import('../services/aiRouter');
    const { client: sc, model: sm } = selectProviderAndModel(TC.SIMPLE);
    const res = await sc.chat.completions.create({
      model: sm,
      messages: [
        { role: "system", content: "Summarize this conversation as concise bullet points. Preserve all property details, deal terms, decisions made, and action items. Be specific, not generic." },
        { role: "user", content: toCompact.map(m => `${m.role.toUpperCase()}: ${m.content?.slice(0, 600)}`).join('\n\n') }
      ],
      max_tokens: 1200
    });
    const summary = res.choices[0]?.message?.content || "";
    // Store summary async (non-blocking)
    process.nextTick(() => {
      db.update(aiConversations)
        .set({ contextSummary: summary } as any)
        .where(eq(aiConversations.id, conversationId))
        .catch(() => {});
    });
    console.log(`[AI] Auto-compacted ${compactUpTo} messages for conversation ${conversationId}`);
    return [
      { id: -1, conversationId, role: "assistant", content: `=== CONVERSATION SUMMARY (auto-compacted) ===\n${summary}\n=== END SUMMARY ===`, createdAt: new Date() } as AiMessage,
      ...toKeep
    ];
  } catch {
    return messages; // Non-blocking — if compaction fails, use original
  }
}

export async function getOrCreateConversation(
  orgId: number,
  userId: string,
  conversationId?: number
): Promise<AiConversation> {
  if (conversationId) {
    const conv = await getConversation(conversationId);
    if (conv && conv.organizationId === orgId) {
      return conv;
    }
  }

  return await createConversation({
    organizationId: orgId,
    userId,
    title: "New Conversation",
    agentRole: "executive"
  });
}

export async function processChat(
  message: string,
  org: Organization,
  userId: string,
  options: ChatOptions = {}
): Promise<{ response: string; toolCalls?: any[]; conversationId: number; model?: string; provider?: string; estimatedCost?: number; promptTokens?: number; completionTokens?: number }> {
  const { agentRole = "executive", files, propertyId } = options;
  // Map "assistant" to "executive" and fallback to executive for unknown roles
  const roleStr = agentRole as string;
  const normalizedRole = (roleStr === "assistant" || !agentProfiles[roleStr as keyof typeof agentProfiles]) 
    ? "executive" 
    : roleStr as keyof typeof agentProfiles;
  const profile = agentProfiles[normalizedRole];
  const tools = getToolsForRole(normalizedRole);

  const conversation = await getOrCreateConversation(org.id, userId, options.conversationId);

  // Build the full message including file contents for AI, but store only original message in DB
  let fullMessage = message;
  let displayMessage = message; // What we show in DB and chat history
  
  if (files && files.length > 0) {
    // Add file names to display message for reference
    const fileNames = files.map(f => f.name).join(', ');
    displayMessage = `${message}\n\n[Attached files: ${fileNames}]`;
    
    // Full message with content for AI processing (async for DOCX support)
    const fileContentsArray = await Promise.all(files.map(f => formatFileContentAsync(f)));
    const fileContents = fileContentsArray.join('\n\n');
    fullMessage = `${message}\n\nThe user has attached the following file(s). Please analyze and process them according to their request:\n\n${fileContents}`;
    console.log(`[AI Chat] Processing ${files.length} file attachment(s)`);
  }

  // Store only the display message (without binary content) in the database
  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: displayMessage
  });

  let messages = await getMessages(conversation.id);
  messages = await compactConversationIfNeeded(conversation.id, messages);

  // Inject property enrichment context into the system prompt when a property is open
  let _enrichCtx = "";
  const _pid = (options as ChatOptions).propertyId;
  if (_pid) {
    try {
      const _prop = await storage.getProperty(org.id, _pid);
      if (_prop) {
        const _ed = (_prop as any).enrichmentData;
        const _lines: string[] = [
          `\n\n--- ACTIVE PROPERTY CONTEXT (ID: ${_prop.id}) ---`,
          `Address: ${_prop.address || "N/A"}`,
          `Size: ${_prop.sizeAcres ? `${_prop.sizeAcres} acres` : "N/A"}`,
          `State: ${_prop.state || "N/A"}, County: ${_prop.county || "N/A"}`,
          `APN: ${_prop.apn || "N/A"}`,
        ];
        if (_ed) {
          _lines.push(`Enrichment Completeness: ${_ed.completenessScore ?? "?"}%`);
          if (_ed.hazards?.floodZone) _lines.push(`Flood Zone: ${_ed.hazards.floodZone}`);
          if (_ed.environment?.soilType) _lines.push(`Soil: ${_ed.environment.soilType}`);
          if (_ed.demographics?.population) _lines.push(`Tract Population: ${_ed.demographics.population}, Median Income: $${_ed.demographics.medianHouseholdIncome?.toLocaleString() ?? "N/A"}`);
          if (_ed.scores) _lines.push(`Scores: ${JSON.stringify(_ed.scores)}`);
          if (_ed.hazards?.wetlandsPresent !== undefined) _lines.push(`Wetlands Present: ${_ed.hazards.wetlandsPresent}`);
          if (_ed.elevation?.elevationFeet) _lines.push(`Elevation: ${_ed.elevation.elevationFeet} ft`);
          if (_ed.transportation?.nearestHighwayMiles !== undefined) _lines.push(`Nearest Highway: ${_ed.transportation.nearestHighwayMiles} mi`);
        } else {
          _lines.push("(No enrichment data yet — use research_property to fetch it.)");
        }
        _lines.push("--- END PROPERTY CONTEXT ---");
        _enrichCtx = _lines.join("\n");
      }
    } catch (_) { /* non-blocking */ }
  }

  // Inject learned user preferences into the system prompt (non-blocking)
  const _prefCtx = await loadUserPreferenceContext(org.id);
  const _knowledgeCtx = await loadOrgKnowledgeContext(org.id);
  const _projectCtx = options.activeProjectId ? await loadProjectContext(options.activeProjectId) : "";
  const _mentionCtx = options.mentionedEntities?.length
    ? `\n\n=== MENTIONED ENTITIES ===\n${options.mentionedEntities.map(e => `[${e.type.toUpperCase()}] ${e.name}: ${e.preview}`).join("\n")}\n=== END MENTIONED ENTITIES ===`
    : "";
  const _connectedIds = await storage.getConnectedConnectorIds(org.id);
  const _connectorCtx = buildConnectorContextBlock(_connectedIds);
  const _calibrationCtx = await loadCalibrationContext(org.id);
  const _systemContent = profile.systemPrompt + (_enrichCtx || "") + (_prefCtx || "") + (_calibrationCtx || "") + (_knowledgeCtx || "") + (_projectCtx || "") + (_mentionCtx || "") + (_connectorCtx || "");

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: _systemContent },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Replace the last message with full content (including file data) for AI processing
  if (files && files.length > 0 && chatMessages.length > 1) {
    chatMessages[chatMessages.length - 1] = { role: "user", content: fullMessage };
  }

  // Replace image files with vision content parts in the last user message
  const imageFiles = (files ?? []).filter(isImageFile);
  if (imageFiles.length > 0 && chatMessages.length > 1) {
    const textPart = { type: "text" as const, text: fullMessage };
    const imageParts = imageFiles.map(buildImageContentPart);
    chatMessages[chatMessages.length - 1] = { role: "user", content: [textPart, ...imageParts] };
  }

  const hasFileAttachments = files && files.length > 0;
  const complexity = classifyFromMessages("chat", chatMessages.map(m => ({
    role: m.role as string,
    content: typeof m.content === 'string' ? m.content : ''
  })), hasFileAttachments);

  let client: OpenAI;
  let provider: AIProvider;
  let model: string;

  try {
    const result = getChatProviderAndModel(complexity);
    client = result.client;
    provider = result.provider;
    // Apply model override if specified; force vision-capable model for image inputs
    model = options.modelOverride
      || (imageFiles.length > 0 && !result.model.includes('gpt-4o') && !result.model.includes('claude') ? 'openai/gpt-4o' : result.model);
  } catch (error: any) {
    console.error('[AI Chat] Failed to get AI provider:', error.message);
    throw new Error("AI service temporarily unavailable. Please try again.");
  }

  console.log(`[AI Chat] Routing chat (${complexity}) -> ${provider}/${model}`);

  let response: OpenAI.ChatCompletion;
  try {
    response = await client.chat.completions.create({
      model,
      messages: chatMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 2048
    });
  } catch (error: any) {
    console.error(`[AI Chat] ${provider} API error:`, error.message, error.status, error.code);
    throw new Error("AI request failed. Please try again in a moment.");
  }
  
  try {
    const { storage } = await import('../storage');
    const estimatedTokens = JSON.stringify(chatMessages).length / 4;
    const costMultiplier = model.includes('gpt-4o') ? 0.002 : 
                          model.includes('gpt-4o-mini') ? 0.00015 : 
                          model.includes('deepseek') ? 0.00014 : 0.001;
    const estimatedCostCents = Math.ceil(estimatedTokens * costMultiplier / 10);
    await storage.logApiUsage({
      organizationId: org.id,
      service: provider,
      action: 'chat_completion',
      count: 1,
      estimatedCostCents,
      metadata: { model, complexity, provider, estimatedTokens: Math.round(estimatedTokens) },
    });
  } catch (error) {
    console.error('[AI Chat] Failed to log API usage:', error);
  }

  let assistantMessage = response.choices[0].message;
  const toolCallsExecuted: any[] = [];

  // Read-only tool prefixes — safe to parallelize
  const READ_ONLY_PREFIXES = ["get_", "search_", "calculate_", "list_", "recall_", "browse_"];

  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    const validToolCalls = assistantMessage.tool_calls.filter((tc): tc is typeof tc & { id: string; function: { name: string; arguments: string } } => 'function' in tc);
    const allReadOnly = validToolCalls.every(tc => READ_ONLY_PREFIXES.some(p => tc.function.name.startsWith(p)));

    let toolResults: OpenAI.ChatCompletionToolMessageParam[];

    if (allReadOnly && validToolCalls.length > 1) {
      // Execute read-only tools in parallel for performance
      toolResults = await Promise.all(
        validToolCalls.map(async (toolCall) => {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeTool(toolCall.function.name, args, org);
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          return { role: "tool" as const, tool_call_id: toolCall.id, content: JSON.stringify(result) };
        })
      );
    } else {
      toolResults = [];
      for (const toolCall of validToolCalls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args, org);
        toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
        toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
    }

    chatMessages.push(assistantMessage as any);
    chatMessages.push(...toolResults);

    try {
      response = await client.chat.completions.create({
        model,
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 2048
      });
    } catch (error: any) {
      console.error(`[AI Chat] ${provider} API error during tool loop:`, error.message);
      throw new Error("AI request failed during processing. Please try again.");
    }

    assistantMessage = response.choices[0].message;
  }

  const finalContent = assistantMessage.content || "I processed your request.";

  await createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: finalContent,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined
  });

  if (messages.length <= 1) {
    const title = message.length > 50 ? message.substring(0, 50) + "..." : message;
    await updateConversation(conversation.id, { title });
  }

  const usage = response.usage;
  let estimatedCost: number | undefined;
  if (usage) {
    const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
      "deepseek/deepseek-chat": { input: 0.14, output: 0.28 },
      "deepseek/deepseek-reasoner": { input: 0.55, output: 2.19 },
      "gpt-4o": { input: 2.50, output: 10.00 },
      "gpt-4o-mini": { input: 0.15, output: 0.60 },
    };
    const costs = COST_PER_MILLION_TOKENS[model] || { input: 1, output: 3 };
    estimatedCost = (usage.prompt_tokens * costs.input + usage.completion_tokens * costs.output) / 1_000_000;
  }

  // Fire-and-forget quality scoring — never blocks the response
  process.nextTick(() => {
    scoreAndLearnFromResponse(org.id, message, finalContent).catch(() => {});
  });

  return {
    response: finalContent,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined,
    conversationId: conversation.id,
    model,
    provider,
    estimatedCost,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens
  };
}

export async function* processChatStream(
  message: string,
  org: Organization,
  userId: string,
  options: ChatOptions = {}
): AsyncGenerator<{ type: string; content?: string; toolCall?: any; done?: boolean; model?: string; provider?: string; estimatedCost?: number; promptTokens?: number; completionTokens?: number }> {
  const { agentRole = "executive", files } = options;
  // Map "assistant" to "executive" and fallback to executive for unknown roles
  const roleStr = agentRole as string;
  const normalizedRole = (roleStr === "assistant" || !agentProfiles[roleStr as keyof typeof agentProfiles]) 
    ? "executive" 
    : roleStr as keyof typeof agentProfiles;
  const profile = agentProfiles[normalizedRole];
  const tools = getToolsForRole(normalizedRole);

  const conversation = await getOrCreateConversation(org.id, userId, options.conversationId);

  // Build the full message including file contents for AI, but store only original message in DB
  let fullMessage = message;
  let displayMessage = message; // What we show in DB and chat history
  
  if (files && files.length > 0) {
    // Add file names to display message for reference
    const fileNames = files.map(f => f.name).join(', ');
    displayMessage = `${message}\n\n[Attached files: ${fileNames}]`;
    
    // Full message with content for AI processing (async for DOCX support)
    const fileContentsArray = await Promise.all(files.map(f => formatFileContentAsync(f)));
    const fileContents = fileContentsArray.join('\n\n');
    fullMessage = `${message}\n\nThe user has attached the following file(s). Please analyze and process them according to their request:\n\n${fileContents}`;
    console.log(`[AI Stream] Processing ${files.length} file attachment(s)`);
  }

  // Store only the display message (without binary content) in the database
  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: displayMessage
  });

  let messages = await getMessages(conversation.id);
  messages = await compactConversationIfNeeded(conversation.id, messages);

  // Inject property enrichment context into the system prompt when a property is open
  let _enrichCtx = "";
  const _pid = (options as ChatOptions).propertyId;
  if (_pid) {
    try {
      const _prop = await storage.getProperty(org.id, _pid);
      if (_prop) {
        const _ed = (_prop as any).enrichmentData;
        const _lines: string[] = [
          `\n\n--- ACTIVE PROPERTY CONTEXT (ID: ${_prop.id}) ---`,
          `Address: ${_prop.address || "N/A"}`,
          `Size: ${_prop.sizeAcres ? `${_prop.sizeAcres} acres` : "N/A"}`,
          `State: ${_prop.state || "N/A"}, County: ${_prop.county || "N/A"}`,
          `APN: ${_prop.apn || "N/A"}`,
        ];
        if (_ed) {
          _lines.push(`Enrichment Completeness: ${_ed.completenessScore ?? "?"}%`);
          if (_ed.hazards?.floodZone) _lines.push(`Flood Zone: ${_ed.hazards.floodZone}`);
          if (_ed.environment?.soilType) _lines.push(`Soil: ${_ed.environment.soilType}`);
          if (_ed.demographics?.population) _lines.push(`Tract Population: ${_ed.demographics.population}, Median Income: $${_ed.demographics.medianHouseholdIncome?.toLocaleString() ?? "N/A"}`);
          if (_ed.scores) _lines.push(`Scores: ${JSON.stringify(_ed.scores)}`);
          if (_ed.hazards?.wetlandsPresent !== undefined) _lines.push(`Wetlands Present: ${_ed.hazards.wetlandsPresent}`);
          if (_ed.elevation?.elevationFeet) _lines.push(`Elevation: ${_ed.elevation.elevationFeet} ft`);
          if (_ed.transportation?.nearestHighwayMiles !== undefined) _lines.push(`Nearest Highway: ${_ed.transportation.nearestHighwayMiles} mi`);
        } else {
          _lines.push("(No enrichment data yet — use research_property to fetch it.)");
        }
        _lines.push("--- END PROPERTY CONTEXT ---");
        _enrichCtx = _lines.join("\n");
      }
    } catch (_) { /* non-blocking */ }
  }

  // Inject learned user preferences into the system prompt (non-blocking)
  const _prefCtx = await loadUserPreferenceContext(org.id);
  const _knowledgeCtx = await loadOrgKnowledgeContext(org.id);
  const _projectCtx = options.activeProjectId ? await loadProjectContext(options.activeProjectId) : "";
  const _mentionCtx = options.mentionedEntities?.length
    ? `\n\n=== MENTIONED ENTITIES ===\n${options.mentionedEntities.map(e => `[${e.type.toUpperCase()}] ${e.name}: ${e.preview}`).join("\n")}\n=== END MENTIONED ENTITIES ===`
    : "";
  const _connectedIds = await storage.getConnectedConnectorIds(org.id);
  const _connectorCtx = buildConnectorContextBlock(_connectedIds);
  const _calibrationCtx = await loadCalibrationContext(org.id);
  const _systemContent = profile.systemPrompt + (_enrichCtx || "") + (_prefCtx || "") + (_calibrationCtx || "") + (_knowledgeCtx || "") + (_projectCtx || "") + (_mentionCtx || "") + (_connectorCtx || "");

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: _systemContent },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Handle image files — build vision content parts
  const streamImageFiles = (files ?? []).filter(isImageFile);
  if (streamImageFiles.length > 0 && chatMessages.length > 1) {
    const textPart = { type: "text" as const, text: fullMessage };
    const imageParts = streamImageFiles.map(buildImageContentPart);
    chatMessages[chatMessages.length - 1] = { role: "user", content: [textPart, ...imageParts] };
  } else if (files && files.length > 0 && chatMessages.length > 1) {
    chatMessages[chatMessages.length - 1] = { role: "user", content: fullMessage };
  }

  const hasFileAttachments = files && files.length > 0;
  const complexity = classifyFromMessages("chat", chatMessages.map(m => ({
    role: m.role as string,
    content: typeof m.content === 'string' ? m.content : ''
  })), hasFileAttachments);

  let client: OpenAI;
  let provider: AIProvider;
  let model: string;

  try {
    const result = getChatProviderAndModel(complexity);
    client = result.client;
    provider = result.provider;
    model = options.modelOverride
      || (streamImageFiles.length > 0 && !result.model.includes('gpt-4o') && !result.model.includes('claude') ? 'openai/gpt-4o' : result.model);
  } catch (error: any) {
    console.error('[AI Stream] Failed to get AI provider:', error.message);
    yield { type: "error", content: "AI service temporarily unavailable. Please try again." };
    return;
  }

  // Reasoning trace — for COMPLEX requests
  if (complexity === TaskComplexity.COMPLEX) {
    try {
      yield { type: "thinking_start" };
      let thinkingText = "";

      if (model.includes('claude')) {
        // Real Claude extended thinking via OpenRouter
        // Use a non-streaming call to get native thinking content blocks
        const thinkingResponse = await client.chat.completions.create({
          model,
          messages: chatMessages as any,
          max_tokens: 8000,
          // @ts-ignore — OpenRouter passes thinking param to Anthropic API
          thinking: { type: "enabled", budget_tokens: 6000 },
        } as any);
        const msgContent = (thinkingResponse as any).choices?.[0]?.message?.content;
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'thinking' && block.thinking) {
              // Stream thinking text in chunks for smooth UI
              const chunks = (block.thinking as string).match(/.{1,60}/gs) || [];
              for (const chunk of chunks) {
                thinkingText += chunk;
                yield { type: "thinking", content: chunk };
              }
            }
          }
        }
      } else {
        // Simulated thinking for non-Claude models
        const thinkingStream = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "You are planning how to answer a complex real estate question. Think step-by-step about what information you need, what tools to use, and what the user actually wants. Be brief but thorough. Max 3-4 sentences." },
            { role: "user", content: message }
          ],
          max_tokens: 300,
          stream: true,
        });
        for await (const chunk of thinkingStream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            thinkingText += delta;
            yield { type: "thinking", content: delta };
          }
        }
      }

      yield { type: "thinking_done" };
    } catch {
      // Non-blocking — ignore thinking errors
    }
  }

  console.log(`[AI Stream] Routing chat stream (${complexity}) -> ${provider}/${model}`);

  let fullResponse = "";
  const toolCallsExecuted: any[] = [];
  let continueLoop = true;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  while (continueLoop) {
    let stream;
    try {
      stream = await client.chat.completions.create({
        model,
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 2048,
        stream: true,
        stream_options: { include_usage: true }
      });
    } catch (error: any) {
      console.error(`[AI Stream] ${provider} API error:`, error.message);
      yield { type: "error", content: "AI request failed. Please try again." };
      return;
    }

    let currentToolCalls: any[] = [];
    let currentContent = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        currentContent += delta.content;
        yield { type: "content", content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined) {
            if (!currentToolCalls[tc.index]) {
              currentToolCalls[tc.index] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) currentToolCalls[tc.index].id = tc.id;
            if (tc.function?.name) currentToolCalls[tc.index].function.name = tc.function.name;
            if (tc.function?.arguments) currentToolCalls[tc.index].function.arguments += tc.function.arguments;
          }
        }
      }
      
      if (chunk.usage) {
        totalPromptTokens += chunk.usage.prompt_tokens || 0;
        totalCompletionTokens += chunk.usage.completion_tokens || 0;
      }
    }

    if (currentToolCalls.length > 0) {
      const ARTIFACT_TOOLS: Record<string, { type: "card" | "table" | "document"; title: string }> = {
        calculate_roi:            { type: "card",     title: "ROI Analysis" },
        calculate_amortization:   { type: "table",    title: "Amortization Schedule" },
        run_comps_analysis:       { type: "table",    title: "Comparable Sales" },
        generate_offer:           { type: "document", title: "Offer" },
        generate_offer_letter:    { type: "document", title: "Offer Letter" },
        get_cashflow_summary:     { type: "card",     title: "Cash Flow Summary" },
      };

      const STREAM_READ_ONLY = ["get_", "search_", "calculate_", "list_", "recall_", "browse_"];
      const streamAllReadOnly = currentToolCalls.every(tc => STREAM_READ_ONLY.some(p => tc.function.name.startsWith(p)));
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

      if (streamAllReadOnly && currentToolCalls.length > 1) {
        // Emit all tool_start events first (parallel signal to UI)
        for (const toolCall of currentToolCalls) {
          yield { type: "tool_start", toolCall: { name: toolCall.function.name } };
        }
        // Execute in parallel
        const parallelResults = await Promise.all(
          currentToolCalls.map(async (toolCall) => {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await executeTool(toolCall.function.name, args, org);
            return { toolCall, args, result };
          })
        );
        for (const { toolCall, args, result } of parallelResults) {
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          yield { type: "tool_result", toolCall: { name: toolCall.function.name, result } };
          const artifactMeta = ARTIFACT_TOOLS[toolCall.function.name];
          if (artifactMeta) {
            try {
              const parsed = typeof result === "string" ? JSON.parse(result) : result;
              const data = parsed?.data ?? parsed;
              if (data) yield { type: "artifact", artifactType: artifactMeta.type, title: artifactMeta.title, data };
            } catch {}
          }
          toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
        }
      } else {
        for (const toolCall of currentToolCalls) {
          yield { type: "tool_start", toolCall: { name: toolCall.function.name } };
          const args = JSON.parse(toolCall.function.arguments);

          // Pre-approval gate for communication/payment tools
          if (APPROVAL_REQUIRED_TOOLS.has(toolCall.function.name)) {
            yield { type: "approval_required", toolCallId: toolCall.id, toolName: toolCall.function.name, args };
            const syntheticResult = {
              success: false,
              requiresApproval: true,
              message: `This action requires your explicit approval before it can be sent. The user will confirm in the chat.`,
            };
            toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result: syntheticResult });
            yield { type: "tool_result", toolCall: { name: toolCall.function.name, result: syntheticResult } };
            toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(syntheticResult) });
            continue;
          }

          const result = await executeTool(toolCall.function.name, args, org);
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          yield { type: "tool_result", toolCall: { name: toolCall.function.name, result } };
          const artifactMeta = ARTIFACT_TOOLS[toolCall.function.name];
          if (artifactMeta) {
            try {
              const parsed = typeof result === "string" ? JSON.parse(result) : result;
              const data = parsed?.data ?? parsed;
              if (data) yield { type: "artifact", artifactType: artifactMeta.type, title: artifactMeta.title, data };
            } catch {}
          }
          toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
        }
      }

      chatMessages.push({
        role: "assistant",
        content: currentContent || null,
        tool_calls: currentToolCalls
      } as any);
      chatMessages.push(...toolResults);
    } else {
      fullResponse = currentContent;
      continueLoop = false;
    }
  }

  await createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: fullResponse,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined
  });

  if (messages.length <= 1) {
    const title = message.length > 50 ? message.substring(0, 50) + "..." : message;
    await updateConversation(conversation.id, { title });
  }

  let estimatedCost: number | undefined;
  if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
    const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
      "deepseek/deepseek-chat": { input: 0.14, output: 0.28 },
      "deepseek/deepseek-reasoner": { input: 0.55, output: 2.19 },
      "gpt-4o": { input: 2.50, output: 10.00 },
      "gpt-4o-mini": { input: 0.15, output: 0.60 },
    };
    const costs = COST_PER_MILLION_TOKENS[model] || { input: 1, output: 3 };
    estimatedCost = (totalPromptTokens * costs.input + totalCompletionTokens * costs.output) / 1_000_000;
  }

  yield { 
    type: "done", 
    done: true, 
    model, 
    provider, 
    estimatedCost,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens
  };
}

export { agentProfiles as agents };
