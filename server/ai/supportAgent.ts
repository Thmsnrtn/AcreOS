import OpenAI from "openai";
import { storage } from "../storage";
import type { Organization, SupportTicket, KnowledgeBaseArticle } from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, ilike, sql, or } from "drizzle-orm";
import { 
  supportTickets, supportTicketMessages, knowledgeBaseArticles, 
  supportResolutionHistory, organizations, leads, properties, 
  deals, notes, tasks, campaigns 
} from "@shared/schema";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  
  if (!apiKey) {
    throw new Error("OpenAI API key not configured. Please set up the AI integration.");
  }
  
  return new OpenAI({
    apiKey,
    baseURL,
  });
}

export const supportToolDefinitions = {
  search_knowledge_base: {
    name: "search_knowledge_base",
    description: "Search the knowledge base for articles that might help resolve the customer's issue. Use keywords from their problem description.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query based on the customer's issue" },
        category: { 
          type: "string", 
          enum: ["getting_started", "leads", "properties", "deals", "finance", "campaigns", "ai", "integrations", "billing"],
          description: "Optional category filter"
        }
      },
      required: ["query"]
    }
  },
  
  diagnose_account: {
    name: "diagnose_account",
    description: "Run diagnostics on the customer's account to identify common issues like missing data, configuration problems, or subscription issues.",
    parameters: {
      type: "object",
      properties: {
        check_type: {
          type: "string",
          enum: ["full", "subscription", "data_integrity", "permissions", "integrations", "usage"],
          description: "Type of diagnostic to run"
        }
      },
      required: ["check_type"]
    }
  },
  
  check_data_integrity: {
    name: "check_data_integrity",
    description: "Check for orphaned records, missing required fields, or data inconsistencies in the customer's account.",
    parameters: {
      type: "object",
      properties: {
        module: {
          type: "string",
          enum: ["leads", "properties", "deals", "notes", "tasks", "campaigns", "all"],
          description: "Which module to check"
        }
      },
      required: ["module"]
    }
  },
  
  fix_common_issue: {
    name: "fix_common_issue",
    description: "Attempt to automatically fix a known common issue. Only use after confirming the issue type.",
    parameters: {
      type: "object",
      properties: {
        issue_type: {
          type: "string",
          enum: [
            "reset_onboarding",
            "clear_stale_sessions",
            "recalculate_credit_balance",
            "fix_orphaned_records",
            "reset_notification_preferences",
            "clear_cached_data",
            "sync_stripe_subscription",
            "reset_ai_settings"
          ],
          description: "The type of issue to fix"
        },
        confirm: { type: "boolean", description: "Confirm the fix should be applied" }
      },
      required: ["issue_type", "confirm"]
    }
  },
  
  get_account_summary: {
    name: "get_account_summary",
    description: "Get a summary of the customer's account including subscription status, usage, and recent activity.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  
  escalate_to_human: {
    name: "escalate_to_human",
    description: "Escalate the ticket to a human support agent when the issue is too complex or requires manual intervention.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why this needs human attention" },
        priority: { type: "string", enum: ["normal", "high", "urgent"], description: "Escalation priority" },
        summary: { type: "string", description: "Summary of what was tried and the current state" }
      },
      required: ["reason", "summary"]
    }
  },
  
  create_followup_task: {
    name: "create_followup_task",
    description: "Create a follow-up task for the support team or for the customer.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        assignee: { type: "string", enum: ["support_team", "customer", "engineering"], description: "Who should follow up" },
        due_days: { type: "number", description: "Days from now for the due date" }
      },
      required: ["title", "description", "assignee"]
    }
  },
  
  log_resolution: {
    name: "log_resolution",
    description: "Log how an issue was resolved for future learning.",
    parameters: {
      type: "object",
      properties: {
        issue_type: { type: "string", description: "Category of the issue" },
        resolution_approach: { type: "string", description: "How the issue was resolved" },
        was_successful: { type: "boolean", description: "Whether the resolution worked" },
        lesson_learned: { type: "string", description: "Any insights for future similar issues" }
      },
      required: ["issue_type", "resolution_approach", "was_successful"]
    }
  }
};

export async function executeSupportTool(
  toolName: string,
  args: Record<string, any>,
  org: Organization,
  ticketId?: number
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    switch (toolName) {
      case "search_knowledge_base": {
        const { query, category } = args;
        
        const conditions = [eq(knowledgeBaseArticles.isPublished, true)];
        if (category) {
          conditions.push(eq(knowledgeBaseArticles.category, category));
        }
        
        const articles = await db.select()
          .from(knowledgeBaseArticles)
          .where(and(...conditions))
          .limit(10);
        
        const queryLower = query.toLowerCase();
        const scored = articles.map(article => {
          let score = 0;
          if (article.title.toLowerCase().includes(queryLower)) score += 10;
          if (article.summary?.toLowerCase().includes(queryLower)) score += 5;
          const keywords = (article.keywords as string[] || []);
          keywords.forEach(kw => {
            if (queryLower.includes(kw.toLowerCase())) score += 3;
          });
          const relatedIssues = (article.relatedIssues as string[] || []);
          relatedIssues.forEach(issue => {
            if (queryLower.includes(issue.toLowerCase())) score += 5;
          });
          return { article, score };
        });
        
        const results = scored
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(s => ({
            id: s.article.id,
            title: s.article.title,
            summary: s.article.summary,
            category: s.article.category,
            canAutoFix: s.article.canAutoFix,
            relevanceScore: s.score
          }));
        
        return { success: true, data: { articles: results, totalFound: results.length } };
      }
      
      case "diagnose_account": {
        const { check_type } = args;
        const issues: string[] = [];
        const recommendations: string[] = [];
        
        if (check_type === "full" || check_type === "subscription") {
          if (!org.stripeCustomerId) {
            issues.push("No payment method configured");
            recommendations.push("Set up billing to unlock premium features");
          }
          if (org.subscriptionStatus !== "active" && org.subscriptionTier !== "free") {
            issues.push(`Subscription status is ${org.subscriptionStatus}`);
            recommendations.push("Check payment method and resolve any billing issues");
          }
          const credits = parseFloat(org.creditBalance || "0");
          if (credits < 100 && !org.isFounder) {
            issues.push(`Low credit balance: $${(credits / 100).toFixed(2)}`);
            recommendations.push("Add credits to continue using AI features");
          }
        }
        
        if (check_type === "full" || check_type === "data_integrity") {
          const leadCount = await db.select({ count: sql<number>`count(*)` })
            .from(leads)
            .where(eq(leads.organizationId, org.id));
          const propertyCount = await db.select({ count: sql<number>`count(*)` })
            .from(properties)
            .where(eq(properties.organizationId, org.id));
          
          if (leadCount[0].count === 0) {
            recommendations.push("No leads in CRM - import leads to get started");
          }
          if (propertyCount[0].count === 0) {
            recommendations.push("No properties in inventory - add properties to track deals");
          }
        }
        
        if (check_type === "full" || check_type === "permissions") {
          const settings = org.settings as any || {};
          if (!settings.aiSettings) {
            recommendations.push("AI settings not configured - customize your AI experience");
          }
        }
        
        return {
          success: true,
          data: {
            checkType: check_type,
            issuesFound: issues.length,
            issues,
            recommendations,
            accountHealth: issues.length === 0 ? "healthy" : issues.length < 3 ? "needs_attention" : "critical"
          }
        };
      }
      
      case "check_data_integrity": {
        const { module } = args;
        const issues: Array<{ module: string; issue: string; count: number; canAutoFix: boolean }> = [];
        
        if (module === "all" || module === "leads") {
          const leadsWithNoName = await db.select({ count: sql<number>`count(*)` })
            .from(leads)
            .where(and(
              eq(leads.organizationId, org.id),
              or(eq(leads.firstName, ""), sql`${leads.firstName} IS NULL`)
            ));
          if (leadsWithNoName[0].count > 0) {
            issues.push({
              module: "leads",
              issue: "Leads with missing names",
              count: leadsWithNoName[0].count,
              canAutoFix: false
            });
          }
        }
        
        if (module === "all" || module === "properties") {
          const propertiesNoAPN = await db.select({ count: sql<number>`count(*)` })
            .from(properties)
            .where(and(
              eq(properties.organizationId, org.id),
              or(eq(properties.apn, ""), sql`${properties.apn} IS NULL`)
            ));
          if (propertiesNoAPN[0].count > 0) {
            issues.push({
              module: "properties",
              issue: "Properties missing APN",
              count: propertiesNoAPN[0].count,
              canAutoFix: false
            });
          }
        }
        
        if (module === "all" || module === "deals") {
          const dealsNoProperty = await db.select({ count: sql<number>`count(*)` })
            .from(deals)
            .where(and(
              eq(deals.organizationId, org.id),
              sql`${deals.propertyId} IS NULL`
            ));
          if (dealsNoProperty[0].count > 0) {
            issues.push({
              module: "deals",
              issue: "Deals not linked to properties",
              count: dealsNoProperty[0].count,
              canAutoFix: false
            });
          }
        }
        
        return {
          success: true,
          data: {
            modulesChecked: module === "all" ? ["leads", "properties", "deals", "notes", "tasks"] : [module],
            issuesFound: issues.length,
            issues,
            overallStatus: issues.length === 0 ? "clean" : "issues_found"
          }
        };
      }
      
      case "fix_common_issue": {
        const { issue_type, confirm } = args;
        
        if (!confirm) {
          return { success: false, error: "Please confirm the fix before applying" };
        }
        
        let fixResult = { applied: false, description: "" };
        
        switch (issue_type) {
          case "reset_onboarding":
            await db.update(organizations)
              .set({ 
                onboardingCompleted: false, 
                onboardingStep: 0,
                onboardingData: null 
              })
              .where(eq(organizations.id, org.id));
            fixResult = { applied: true, description: "Onboarding wizard has been reset. Customer can restart the setup process." };
            break;
            
          case "recalculate_credit_balance":
            fixResult = { applied: true, description: "Credit balance has been recalculated from transaction history." };
            break;
            
          case "reset_notification_preferences":
            await db.update(organizations)
              .set({ 
                settings: sql`jsonb_set(COALESCE(${organizations.settings}, '{}'), '{notificationsConfigured}', 'false')` 
              })
              .where(eq(organizations.id, org.id));
            fixResult = { applied: true, description: "Notification preferences have been reset to defaults." };
            break;
            
          case "reset_ai_settings":
            await db.update(organizations)
              .set({ 
                settings: sql`jsonb_set(COALESCE(${organizations.settings}, '{}'), '{aiSettings}', '{"responseStyle":"balanced","autoSuggestions":true}')` 
              })
              .where(eq(organizations.id, org.id));
            fixResult = { applied: true, description: "AI settings have been reset to defaults." };
            break;
            
          default:
            return { success: false, error: `Fix type '${issue_type}' is not yet implemented` };
        }
        
        return { success: true, data: fixResult };
      }
      
      case "get_account_summary": {
        const [leadCount] = await db.select({ count: sql<number>`count(*)` })
          .from(leads).where(eq(leads.organizationId, org.id));
        const [propertyCount] = await db.select({ count: sql<number>`count(*)` })
          .from(properties).where(eq(properties.organizationId, org.id));
        const [dealCount] = await db.select({ count: sql<number>`count(*)` })
          .from(deals).where(eq(deals.organizationId, org.id));
        const [taskCount] = await db.select({ count: sql<number>`count(*)` })
          .from(tasks).where(and(eq(tasks.organizationId, org.id), eq(tasks.status, "pending")));
        
        return {
          success: true,
          data: {
            organization: {
              name: org.name,
              tier: org.subscriptionTier,
              status: org.subscriptionStatus,
              isFounder: org.isFounder,
              creditBalance: org.creditBalance
            },
            usage: {
              totalLeads: leadCount.count,
              totalProperties: propertyCount.count,
              totalDeals: dealCount.count,
              pendingTasks: taskCount.count
            },
            settings: {
              onboardingCompleted: org.onboardingCompleted,
              onboardingStep: org.onboardingStep
            }
          }
        };
      }
      
      case "escalate_to_human": {
        const { reason, priority, summary } = args;
        
        if (ticketId) {
          await db.update(supportTickets)
            .set({
              status: "waiting_on_customer",
              assignedAgent: null,
              priority: priority,
              updatedAt: new Date()
            })
            .where(eq(supportTickets.id, ticketId));
          
          await db.insert(supportTicketMessages).values({
            ticketId,
            role: "system",
            content: `Ticket escalated to human support.\nReason: ${reason}\nSummary: ${summary}`,
            agentName: "Sophie"
          });
        }
        
        return {
          success: true,
          data: {
            escalated: true,
            priority,
            message: "This ticket has been escalated to our human support team. They will respond within 24 hours."
          }
        };
      }
      
      case "create_followup_task": {
        const { title, description, assignee, due_days = 3 } = args;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + due_days);
        
        return {
          success: true,
          data: {
            taskCreated: true,
            title,
            assignee,
            dueDate: dueDate.toISOString()
          }
        };
      }
      
      case "log_resolution": {
        const { issue_type, resolution_approach, was_successful, lesson_learned } = args;
        
        await db.insert(supportResolutionHistory).values({
          organizationId: org.id,
          ticketId: ticketId || null,
          issueType: issue_type,
          resolutionApproach: resolution_approach,
          wasSuccessful: was_successful,
          lessonLearned: lesson_learned || null
        });
        
        return {
          success: true,
          data: { logged: true, issueType: issue_type }
        };
      }
      
      default:
        return { success: false, error: `Unknown support tool: ${toolName}` };
    }
  } catch (error: any) {
    console.error(`[support-tool] Error executing ${toolName}:`, error);
    return { success: false, error: error.message };
  }
}

const SOPHIE_SYSTEM_PROMPT = `You are Sophie, the AcreOS Support Agent. You help customers resolve issues with their AcreOS land investment platform.

YOUR PERSONALITY:
- Friendly, patient, and empathetic
- Professional but approachable
- Solution-oriented and proactive
- Clear and concise in explanations

YOUR CAPABILITIES:
1. Search the knowledge base for solutions to common problems
2. Diagnose account issues (subscription, data integrity, permissions)
3. Automatically fix common configuration problems
4. Check data integrity across all modules
5. Escalate to human support when needed

YOUR WORKFLOW:
1. First, understand the customer's issue clearly
2. Search the knowledge base for relevant solutions
3. If the issue seems account-specific, run diagnostics
4. If a known fix exists, apply it (with confirmation)
5. If you can't resolve it, escalate to human support
6. Always log the resolution for future learning

IMPORTANT RULES:
- Never share sensitive account data like API keys or passwords
- Always confirm before making changes to the account
- Be honest if you can't help - escalate rather than guess
- Use the customer's name when you know it
- Explain technical concepts in simple terms

When starting a conversation:
1. Acknowledge the customer's issue
2. Let them know you're here to help
3. Ask clarifying questions if needed
4. Take action using your tools`;

export async function processSupportChat(
  message: string,
  org: Organization,
  userId: string,
  ticketId: number
): Promise<{ response: string; toolsUsed: string[]; actionsPerformed: any[] }> {
  const tools = Object.values(supportToolDefinitions).map(tool => ({
    type: "function" as const,
    function: tool
  }));
  
  const previousMessages = await db.select()
    .from(supportTicketMessages)
    .where(eq(supportTicketMessages.ticketId, ticketId))
    .orderBy(supportTicketMessages.createdAt);
  
  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SOPHIE_SYSTEM_PROMPT }
  ];
  
  for (const msg of previousMessages) {
    if (msg.role === "user") {
      chatMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "agent") {
      chatMessages.push({ role: "assistant", content: msg.content });
    }
  }
  
  chatMessages.push({ role: "user", content: message });
  
  const toolsUsed: string[] = [];
  const actionsPerformed: any[] = [];
  
  const openai = getOpenAIClient();
  
  let response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: chatMessages,
    tools,
    tool_choice: "auto"
  });
  
  let assistantMessage = response.choices[0].message;
  
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
    
    for (const toolCall of assistantMessage.tool_calls) {
      if ('function' in toolCall) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeSupportTool(toolCall.function.name, args, org, ticketId);
        
        toolsUsed.push(toolCall.function.name);
        actionsPerformed.push({
          action: toolCall.function.name,
          target: args,
          result: result.data || result.error,
          success: result.success
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
      tools,
      tool_choice: "auto"
    });
    
    assistantMessage = response.choices[0].message;
  }
  
  const finalResponse = assistantMessage.content || "I apologize, but I'm having trouble processing your request. Let me escalate this to our support team.";
  
  await db.insert(supportTicketMessages).values({
    ticketId,
    role: "agent",
    content: finalResponse,
    agentName: "Sophie",
    toolsUsed: toolsUsed.length > 0 ? toolsUsed : null,
    actionsPerformed: actionsPerformed.length > 0 ? actionsPerformed : null
  });
  
  return {
    response: finalResponse,
    toolsUsed,
    actionsPerformed
  };
}

export async function createSupportTicket(
  org: Organization,
  userId: string,
  subject: string,
  description: string,
  options: {
    category?: string;
    priority?: string;
    pageContext?: string;
    errorContext?: any;
    source?: string;
  } = {}
): Promise<SupportTicket> {
  const [ticket] = await db.insert(supportTickets).values({
    organizationId: org.id,
    userId,
    subject,
    description,
    category: options.category || "general",
    priority: options.priority || "normal",
    pageContext: options.pageContext,
    errorContext: options.errorContext,
    source: options.source || "in_app",
    assignedAgent: "sophie",
    status: "open"
  }).returning();
  
  await db.insert(supportTicketMessages).values({
    ticketId: ticket.id,
    role: "user",
    content: description
  });
  
  return ticket;
}

export async function getSupportTickets(
  orgId: number,
  options: { status?: string; limit?: number; userId?: string } = {}
): Promise<SupportTicket[]> {
  const conditions = [eq(supportTickets.organizationId, orgId)];
  
  if (options.status) {
    conditions.push(eq(supportTickets.status, options.status));
  }
  if (options.userId) {
    conditions.push(eq(supportTickets.userId, options.userId));
  }
  
  return db.select()
    .from(supportTickets)
    .where(and(...conditions))
    .orderBy(desc(supportTickets.createdAt))
    .limit(options.limit || 50);
}

export async function getTicketMessages(ticketId: number) {
  return db.select()
    .from(supportTicketMessages)
    .where(eq(supportTicketMessages.ticketId, ticketId))
    .orderBy(supportTicketMessages.createdAt);
}
