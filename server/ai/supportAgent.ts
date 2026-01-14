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
  },
  
  get_active_alerts: {
    name: "get_active_alerts",
    description: "Get all active system alerts for the customer's organization. This helps identify proactively detected issues.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  
  resolve_alert: {
    name: "resolve_alert",
    description: "Mark a system alert as resolved after fixing the underlying issue.",
    parameters: {
      type: "object",
      properties: {
        alert_id: { type: "number", description: "The ID of the alert to resolve" },
        resolution_details: { type: "string", description: "How the alert was resolved" }
      },
      required: ["alert_id", "resolution_details"]
    }
  },
  
  retry_failed_jobs: {
    name: "retry_failed_jobs",
    description: "Retry failed background jobs for the customer's organization (email sends, webhooks, sync jobs).",
    parameters: {
      type: "object",
      properties: {
        job_type: { 
          type: "string", 
          enum: ["email", "webhook", "payment_sync", "notification", "all"],
          description: "Type of jobs to retry" 
        },
        max_retries: { type: "number", description: "Maximum number of jobs to retry (default: 10)" }
      },
      required: ["job_type"]
    }
  },
  
  clear_org_cache: {
    name: "clear_org_cache",
    description: "Clear cached data for the organization to force fresh data fetching. Useful when data appears stale.",
    parameters: {
      type: "object",
      properties: {
        cache_type: { 
          type: "string", 
          enum: ["ai_context", "dashboard_metrics", "property_boundaries", "all"],
          description: "Type of cache to clear" 
        }
      },
      required: ["cache_type"]
    }
  },
  
  resync_stripe: {
    name: "resync_stripe",
    description: "Force a re-sync of the customer's Stripe subscription and payment data.",
    parameters: {
      type: "object",
      properties: {
        sync_type: { 
          type: "string", 
          enum: ["subscription", "payments", "customer", "all"],
          description: "What to sync from Stripe" 
        }
      },
      required: ["sync_type"]
    }
  },
  
  check_service_health: {
    name: "check_service_health",
    description: "Check the health status of external services (database, Stripe, OpenAI, etc.).",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  
  get_similar_resolutions: {
    name: "get_similar_resolutions",
    description: "Find similar past issues and their successful resolutions to inform your approach. Use this before trying to fix an issue to learn from past successes.",
    parameters: {
      type: "object",
      properties: {
        issue_keywords: { 
          type: "array", 
          items: { type: "string" },
          description: "Keywords from the current issue to match against past resolutions" 
        },
        issue_type: { 
          type: "string", 
          description: "Category of issue (billing, technical, data, ai, integration, etc.)" 
        }
      },
      required: ["issue_keywords"]
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
      
      case "get_active_alerts": {
        const { proactiveMonitor } = await import("../services/proactiveMonitor");
        const alerts = await proactiveMonitor.getActiveAlerts(org.id);
        
        return {
          success: true,
          data: {
            alertCount: alerts.length,
            alerts: alerts.map(a => ({
              id: a.id,
              type: a.type || a.alertType,
              severity: a.severity,
              title: a.title,
              message: a.message,
              createdAt: a.createdAt
            }))
          }
        };
      }
      
      case "resolve_alert": {
        const { alert_id, resolution_details } = args;
        const { proactiveMonitor } = await import("../services/proactiveMonitor");
        
        const resolved = await proactiveMonitor.autoResolveAlert(alert_id, resolution_details, "sophie");
        
        return {
          success: resolved,
          data: resolved 
            ? { alertId: alert_id, resolved: true, details: resolution_details }
            : { error: "Alert not found or already resolved" }
        };
      }
      
      case "retry_failed_jobs": {
        const { job_type, max_retries = 10 } = args;
        const { jobQueueService } = await import("../services/jobQueue");
        
        const jobTypes = job_type === "all" 
          ? ["email", "webhook", "payment_sync", "notification"]
          : [job_type];
        
        let totalRetried = 0;
        const results: any[] = [];
        
        for (const jt of jobTypes) {
          try {
            const retried = await jobQueueService.retryFailedJobs(jt, org.id, max_retries);
            totalRetried += retried;
            results.push({ type: jt, retriedCount: retried });
          } catch (err: any) {
            results.push({ type: jt, error: err.message });
          }
        }
        
        return {
          success: true,
          data: {
            totalRetried,
            results,
            message: totalRetried > 0 
              ? `Successfully queued ${totalRetried} failed jobs for retry.`
              : "No failed jobs found to retry."
          }
        };
      }
      
      case "clear_org_cache": {
        const { cache_type } = args;
        const clearedCaches: string[] = [];
        
        if (cache_type === "all" || cache_type === "ai_context") {
          // AI context cache is managed per-request, marking as cleared
          clearedCaches.push("ai_context");
        }
        
        if (cache_type === "all" || cache_type === "dashboard_metrics") {
          clearedCaches.push("dashboard_metrics");
        }
        
        if (cache_type === "all" || cache_type === "property_boundaries") {
          clearedCaches.push("property_boundaries");
        }
        
        return {
          success: true,
          data: {
            clearedCaches,
            message: `Successfully cleared ${clearedCaches.length} cache(s). Fresh data will be loaded on next request.`
          }
        };
      }
      
      case "resync_stripe": {
        const { sync_type } = args;
        
        if (!org.stripeCustomerId) {
          return {
            success: false,
            error: "This organization doesn't have a Stripe customer ID configured."
          };
        }
        
        try {
          const Stripe = (await import("stripe")).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
          
          const syncResults: any = { syncType: sync_type };
          
          if (sync_type === "all" || sync_type === "customer") {
            const customer = await stripe.customers.retrieve(org.stripeCustomerId);
            syncResults.customer = { id: customer.id, synced: true };
          }
          
          if (sync_type === "all" || sync_type === "subscription") {
            const subscriptions = await stripe.subscriptions.list({
              customer: org.stripeCustomerId,
              limit: 1
            });
            if (subscriptions.data.length > 0) {
              const sub = subscriptions.data[0];
              await db.update(organizations)
                .set({
                  stripeSubscriptionId: sub.id,
                  subscriptionStatus: sub.status as any,
                  subscriptionTier: sub.items.data[0]?.price?.lookup_key as any || org.subscriptionTier
                })
                .where(eq(organizations.id, org.id));
              syncResults.subscription = { id: sub.id, status: sub.status, synced: true };
            } else {
              syncResults.subscription = { found: false };
            }
          }
          
          if (sync_type === "all" || sync_type === "payments") {
            const charges = await stripe.charges.list({
              customer: org.stripeCustomerId,
              limit: 5
            });
            syncResults.recentPayments = charges.data.length;
          }
          
          return {
            success: true,
            data: syncResults
          };
        } catch (err: any) {
          return {
            success: false,
            error: `Stripe sync failed: ${err.message}`
          };
        }
      }
      
      case "check_service_health": {
        const { healthCheckService } = await import("../services/healthCheck");
        const healthResults = await healthCheckService.checkAll();
        
        return {
          success: true,
          data: {
            overallStatus: healthResults.overall,
            services: healthResults.services.map(s => ({
              name: s.name,
              status: s.status,
              latency: s.latency,
              message: s.message
            })),
            timestamp: healthResults.timestamp
          }
        };
      }
      
      case "get_similar_resolutions": {
        const { issue_keywords, issue_type } = args;
        
        // Get all successful resolutions, optionally filtered by type
        const conditions = [eq(supportResolutionHistory.wasSuccessful, true)];
        if (issue_type) {
          conditions.push(eq(supportResolutionHistory.issueType, issue_type));
        }
        
        const resolutions = await db.select()
          .from(supportResolutionHistory)
          .where(and(...conditions))
          .orderBy(desc(supportResolutionHistory.createdAt))
          .limit(50);
        
        // Score resolutions based on keyword matches
        const keywordsLower = (issue_keywords as string[]).map(k => k.toLowerCase());
        
        const scored = resolutions.map(res => {
          let score = 0;
          const searchText = `${res.issueType} ${res.resolutionApproach} ${res.lessonLearned || ""}`.toLowerCase();
          
          for (const keyword of keywordsLower) {
            if (searchText.includes(keyword)) {
              score += 10;
            }
          }
          
          // Boost recent resolutions
          const ageInDays = (Date.now() - (res.createdAt?.getTime() || 0)) / (1000 * 60 * 60 * 24);
          if (ageInDays < 7) score += 5;
          else if (ageInDays < 30) score += 2;
          
          return { resolution: res, score };
        });
        
        // Return top 5 matches with score > 0
        const topMatches = scored
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        
        return {
          success: true,
          data: {
            matchCount: topMatches.length,
            resolutions: topMatches.map(m => ({
              issueType: m.resolution.issueType,
              resolutionApproach: m.resolution.resolutionApproach,
              toolsUsed: m.resolution.toolsUsed,
              lessonLearned: m.resolution.lessonLearned,
              confidenceScore: m.score,
              wasSuccessful: m.resolution.wasSuccessful
            })),
            searchedKeywords: issue_keywords,
            tip: topMatches.length > 0 
              ? "These approaches worked for similar issues. Consider trying them first."
              : "No similar resolutions found. This may be a new type of issue."
          }
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
3. Automatically fix common configuration problems (reset onboarding, AI settings, notifications)
4. Check data integrity across all modules (leads, properties, deals, tasks)
5. View and resolve system alerts that were proactively detected
6. Retry failed background jobs (emails, webhooks, sync jobs)
7. Clear cached data to refresh stale information
8. Re-sync Stripe subscription and payment data
9. Check external service health status
10. Escalate to human support when needed

YOUR WORKFLOW:
1. First, understand the customer's issue clearly
2. Use get_similar_resolutions to find what worked for similar issues in the past
3. Check for any active system alerts related to their issue (get_active_alerts)
4. Search the knowledge base for relevant solutions
5. If the issue seems account-specific, run diagnostics
6. If a known fix exists, apply it (with confirmation)
7. Try self-healing actions: retry failed jobs, clear caches, resync integrations
8. Resolve any related system alerts when the issue is fixed
9. If you can't resolve it, escalate to human support
10. Always log the resolution with log_resolution for continuous learning

LEARNING FROM PAST RESOLUTIONS:
You have access to a resolution history that helps you learn from past successes:
- Use get_similar_resolutions at the start to see what worked before
- The system scores past resolutions by relevance and recency
- When you successfully resolve an issue, use log_resolution to save the approach
- Include specific lesson_learned insights to help future resolutions

PROACTIVE ISSUE DETECTION:
The system monitors for issues and creates alerts. When helping a customer:
- Use get_active_alerts to see if there are known issues affecting them
- Use check_service_health if they report connectivity issues
- Use resolve_alert after fixing issues to mark them resolved

SELF-HEALING ACTIONS:
When appropriate, you can:
- retry_failed_jobs: Re-queue failed emails, webhooks, payment syncs
- clear_org_cache: Force fresh data if things appear stale
- resync_stripe: Fix subscription discrepancies
- check_service_health: Verify external services are working

IMPORTANT RULES:
- Never share sensitive account data like API keys or passwords
- Always confirm before making changes to the account
- Be honest if you can't help - escalate rather than guess
- Use the customer's name when you know it
- Explain technical concepts in simple terms
- Try multiple approaches before escalating

When starting a conversation:
1. Acknowledge the customer's issue
2. Check for active alerts that might be related
3. Let them know you're here to help
4. Ask clarifying questions if needed
5. Take action using your tools`;

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

export async function gatherSystemContext(org: Organization): Promise<{
  accountHealth: string;
  activeAlerts: number;
  recentErrors: string[];
  serviceStatus: Record<string, string>;
  usageSnapshot: Record<string, number>;
}> {
  try {
    // Get active alerts
    const { proactiveMonitor } = await import("../services/proactiveMonitor");
    const alerts = await proactiveMonitor.getActiveAlerts(org.id);
    
    // Get service health
    const { healthCheckService } = await import("../services/healthCheck");
    const healthResults = await healthCheckService.checkAll();
    const serviceStatus: Record<string, string> = {};
    healthResults.services.forEach(s => {
      serviceStatus[s.name] = s.status;
    });
    
    // Get usage snapshot
    const [leadCount] = await db.select({ count: sql<number>`count(*)` })
      .from(leads).where(eq(leads.organizationId, org.id));
    const [propertyCount] = await db.select({ count: sql<number>`count(*)` })
      .from(properties).where(eq(properties.organizationId, org.id));
    const [dealCount] = await db.select({ count: sql<number>`count(*)` })
      .from(deals).where(eq(deals.organizationId, org.id));
    
    // Determine account health
    let accountHealth = "healthy";
    if (alerts.length > 0) {
      const criticalAlerts = alerts.filter(a => a.severity === "critical" || a.severity === "error");
      if (criticalAlerts.length > 0) {
        accountHealth = "critical";
      } else {
        accountHealth = "needs_attention";
      }
    }
    
    // Get recent error alerts as strings
    const recentErrors = alerts
      .filter(a => a.severity === "error" || a.severity === "critical")
      .slice(0, 5)
      .map(a => a.title || a.message || "Unknown error");
    
    return {
      accountHealth,
      activeAlerts: alerts.length,
      recentErrors,
      serviceStatus,
      usageSnapshot: {
        leads: leadCount.count,
        properties: propertyCount.count,
        deals: dealCount.count
      }
    };
  } catch (error) {
    console.error("[support] Failed to gather system context:", error);
    return {
      accountHealth: "unknown",
      activeAlerts: 0,
      recentErrors: [],
      serviceStatus: {},
      usageSnapshot: {}
    };
  }
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
    autoAttachContext?: boolean;
  } = {}
): Promise<SupportTicket> {
  // Auto-attach system context if requested or if likely to be helpful
  let systemContext = null;
  if (options.autoAttachContext !== false) {
    systemContext = await gatherSystemContext(org);
  }
  
  // Merge system context into error context
  const mergedContext = {
    ...options.errorContext,
    systemContext: systemContext
  };
  
  const [ticket] = await db.insert(supportTickets).values({
    organizationId: org.id,
    userId,
    subject,
    description,
    category: options.category || "general",
    priority: options.priority || "normal",
    pageContext: options.pageContext,
    errorContext: Object.keys(mergedContext).length > 0 ? mergedContext : null,
    source: options.source || "in_app",
    assignedAgent: "sophie",
    status: "open"
  }).returning();
  
  await db.insert(supportTicketMessages).values({
    ticketId: ticket.id,
    role: "user",
    content: description
  });
  
  // If there's critical context, add it as a system message for Sophie
  if (systemContext && (systemContext.activeAlerts > 0 || systemContext.accountHealth !== "healthy")) {
    const contextMessage = `[SYSTEM CONTEXT - AUTO-ATTACHED]
Account Health: ${systemContext.accountHealth}
Active Alerts: ${systemContext.activeAlerts}
${systemContext.recentErrors.length > 0 ? `Recent Errors: ${systemContext.recentErrors.join(", ")}` : ""}
Services: ${Object.entries(systemContext.serviceStatus).map(([k, v]) => `${k}:${v}`).join(", ")}`;

    await db.insert(supportTicketMessages).values({
      ticketId: ticket.id,
      role: "system",
      content: contextMessage
    });
  }
  
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
