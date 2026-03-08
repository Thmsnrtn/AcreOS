import OpenAI from "openai";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { toolDefinitions, executeTool, getOpenAITools, getToolsForRole } from "./tools";
import { aiConversations, aiMessages, type Organization, type AiConversation, type AiMessage } from "@shared/schema";
import {
  selectProviderAndModel,
  classifyFromMessages,
  TaskComplexity,
  AIProvider,
} from "../services/aiRouter";
import mammoth from "mammoth";
import { storage } from "../storage";

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
    name: "Atlas",
    role: "executive",
    displayName: "Executive Assistant",
    description: "Your AI-powered executive assistant for land investment operations",
    systemPrompt: `You are Atlas, an AI executive assistant for a land investment company using AcreOS.

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

async function formatFileContentAsync(file: FileAttachment): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  
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

  const messages = await getMessages(conversation.id);

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

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: _enrichCtx ? profile.systemPrompt + _enrichCtx : profile.systemPrompt },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Replace the last message with full content (including file data) for AI processing
  if (files && files.length > 0 && chatMessages.length > 1) {
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
    model = result.model;
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

  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

    for (const toolCall of assistantMessage.tool_calls) {
      if ('function' in toolCall) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args, org);

        toolCallsExecuted.push({
          name: toolCall.function.name,
          arguments: args,
          result
        });

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
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

  const messages = await getMessages(conversation.id);

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

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: _enrichCtx ? profile.systemPrompt + _enrichCtx : profile.systemPrompt },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Replace the last message with full content (including file data) for AI processing
  if (files && files.length > 0 && chatMessages.length > 1) {
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
    model = result.model;
  } catch (error: any) {
    console.error('[AI Stream] Failed to get AI provider:', error.message);
    yield { type: "error", content: "AI service temporarily unavailable. Please try again." };
    return;
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
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

      for (const toolCall of currentToolCalls) {
        yield { type: "tool_start", toolCall: { name: toolCall.function.name } };

        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args, org);

        toolCallsExecuted.push({
          name: toolCall.function.name,
          arguments: args,
          result
        });

        yield { type: "tool_result", toolCall: { name: toolCall.function.name, result } };

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
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
