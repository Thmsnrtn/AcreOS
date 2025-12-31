import OpenAI from "openai";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { toolDefinitions, executeTool, getOpenAITools, getToolsForRole } from "./tools";
import { aiConversations, aiMessages, type Organization, type AiConversation, type AiMessage } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export const agentProfiles = {
  executive: {
    name: "Atlas",
    role: "executive",
    displayName: "Executive Assistant",
    description: "Your AI-powered executive assistant for land investment operations",
    systemPrompt: `You are Atlas, an AI executive assistant for a land investment company using AcreOS.

You help with:
- Managing leads and the CRM pipeline
- Tracking property inventory
- Analyzing seller financing notes and calculating payments
- Providing business insights and analytics

You have access to tools to query and modify the business data. Always be helpful, concise, and action-oriented.

When users ask about leads, properties, notes, or analytics, use the appropriate tools to get real data.
When performing calculations (like loan amortization), use the calculate_amortization tool.
When creating or updating records, confirm the action was successful.

Keep responses focused and business-oriented. Format numbers as currency when appropriate.`,
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
): Promise<{ response: string; toolCalls?: any[]; conversationId: number }> {
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

  let response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: chatMessages,
    tools: tools.length > 0 ? tools : undefined,
    max_tokens: 2048
  });

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

    response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: chatMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 2048
    });

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
    conversationId: conversation.id
  };
}

export async function* processChatStream(
  message: string,
  org: Organization,
  userId: string,
  options: ChatOptions = {}
): AsyncGenerator<{ type: string; content?: string; toolCall?: any; done?: boolean }> {
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

  let fullResponse = "";
  const toolCallsExecuted: any[] = [];
  let continueLoop = true;

  while (continueLoop) {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: chatMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 2048,
      stream: true
    });

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
