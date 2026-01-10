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

TOOLS AT YOUR DISPOSAL:
- get_system_context: Get a complete overview of all modules (leads, properties, deals, tasks, finance)
- create_property, create_deal, create_task, create_lead: Create records in any module
- update_property, update_deal, update_task, update_lead_status: Modify existing records
- get_leads, get_properties, get_deals, get_tasks: Query any module

WORKFLOW:
1. When given a task, first use get_system_context if you need to understand the current state
2. Take action using the appropriate create/update tools
3. Confirm what you did and offer next steps

Keep responses focused and business-oriented. Format numbers as currency when appropriate.
Be proactive - if you can complete a task, do it rather than just explaining how.`,
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

interface ChatOptions {
  conversationId?: number;
  agentRole?: AgentRole;
  stream?: boolean;
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
): Promise<{ response: string; toolCalls?: any[]; conversationId: number; model?: string }> {
  const { agentRole = "executive" } = options;
  const profile = agentProfiles[agentRole];
  const tools = getToolsForRole(agentRole);

  const conversation = await getOrCreateConversation(org.id, userId, options.conversationId);

  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: message
  });

  const messages = await getMessages(conversation.id);
  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: profile.systemPrompt },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  const complexity = classifyFromMessages("chat", chatMessages.map(m => ({ 
    role: m.role as string, 
    content: typeof m.content === 'string' ? m.content : '' 
  })));
  
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

  return {
    response: finalContent,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined,
    conversationId: conversation.id,
    model
  };
}

export async function* processChatStream(
  message: string,
  org: Organization,
  userId: string,
  options: ChatOptions = {}
): AsyncGenerator<{ type: string; content?: string; toolCall?: any; done?: boolean; model?: string }> {
  const { agentRole = "executive" } = options;
  const profile = agentProfiles[agentRole];
  const tools = getToolsForRole(agentRole);

  const conversation = await getOrCreateConversation(org.id, userId, options.conversationId);

  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: message
  });

  const messages = await getMessages(conversation.id);
  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: profile.systemPrompt },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  const complexity = classifyFromMessages("chat", chatMessages.map(m => ({ 
    role: m.role as string, 
    content: typeof m.content === 'string' ? m.content : '' 
  })));
  
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

  while (continueLoop) {
    let stream;
    try {
      stream = await client.chat.completions.create({
        model,
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 2048,
        stream: true
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

  yield { type: "done", done: true };
}

export { agentProfiles as agents };
