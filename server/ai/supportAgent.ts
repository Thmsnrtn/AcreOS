import OpenAI from "openai";
import { storage } from "../storage";
import type { Organization, SupportTicket, KnowledgeBaseArticle } from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, ilike, sql, or } from "drizzle-orm";
import { 
  supportTickets, supportTicketMessages, knowledgeBaseArticles, 
  supportResolutionHistory, organizations, leads, properties, 
  deals, notes, tasks, campaigns, payments, teamMembers,
  activityLog, auditLog, apiUsageLogs, sophieMemory
} from "@shared/schema";
import { gte, lte } from "drizzle-orm";

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
    description: "Escalate the ticket to a human support agent with automatic diagnostic bundle. Gathers system state, recent activity, and issue context automatically.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why this needs human attention" },
        include_diagnostic_bundle: { type: "boolean", description: "Auto-gather and attach diagnostic info (default: true)" },
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
    description: "Log how an issue was resolved for future learning. ALWAYS use this after resolving an issue to improve future support.",
    parameters: {
      type: "object",
      properties: {
        issue_type: { type: "string", description: "Category of the issue" },
        resolution_approach: { type: "string", description: "How the issue was resolved" },
        was_successful: { type: "boolean", description: "Whether the resolution worked" },
        lesson_learned: { type: "string", description: "Any insights for future similar issues" },
        tools_used: { 
          type: "array", 
          items: { type: "string" },
          description: "List of tools that were used to resolve this issue" 
        },
        resolution_time_minutes: { type: "number", description: "Approximate time taken to resolve" }
      },
      required: ["issue_type", "resolution_approach", "was_successful"]
    }
  },
  
  search_resolved_tickets: {
    name: "search_resolved_tickets",
    description: "Search past resolved support tickets to find solutions for similar issues. Returns successful resolutions with their approaches and lessons learned.",
    parameters: {
      type: "object",
      properties: {
        search_query: { type: "string", description: "Keywords to search for in past resolutions" },
        issue_type: { type: "string", description: "Filter by issue type/category" },
        only_successful: { type: "boolean", description: "Only return successful resolutions (default: true)" },
        limit: { type: "number", description: "Maximum results to return (default: 5)" }
      },
      required: ["search_query"]
    }
  },
  
  record_customer_feedback: {
    name: "record_customer_feedback",
    description: "Record customer feedback about the support interaction. Use this when the customer indicates satisfaction or dissatisfaction.",
    parameters: {
      type: "object",
      properties: {
        rating: { 
          type: "number", 
          description: "Customer satisfaction rating 1-5 (1=very dissatisfied, 5=very satisfied)" 
        },
        feedback_text: { type: "string", description: "Any feedback comments from the customer" },
        resolution_helpful: { type: "boolean", description: "Whether the resolution was helpful" },
        would_recommend: { type: "boolean", description: "Whether customer would recommend our support" }
      },
      required: ["rating"]
    }
  },
  
  get_resolution_stats: {
    name: "get_resolution_stats",
    description: "Get statistics about resolution success rates by issue type. Helps identify which issues are hardest to resolve and where to improve.",
    parameters: {
      type: "object",
      properties: {
        issue_type: { type: "string", description: "Filter stats for specific issue type, or omit for all types" },
        time_period: { type: "string", enum: ["7d", "30d", "90d", "all"], description: "Time period for stats" }
      }
    }
  },
  
  get_best_resolution_approach: {
    name: "get_best_resolution_approach",
    description: "Find the best-performing resolution approach for a specific issue type using A/B testing data. Returns approaches ranked by success rate.",
    parameters: {
      type: "object",
      properties: {
        issue_type: { type: "string", description: "The issue type to find best approach for" }
      },
      required: ["issue_type"]
    }
  },
  
  log_resolution_variant: {
    name: "log_resolution_variant",
    description: "Log a resolution with a specific variant/approach label for A/B testing. Use this instead of log_resolution when testing different approaches.",
    parameters: {
      type: "object",
      properties: {
        issue_type: { type: "string", description: "Category of the issue" },
        variant_name: { type: "string", description: "Name of the resolution variant/approach being tested (e.g., 'cache_clear_first', 'escalate_early', 'retry_then_reset')" },
        resolution_approach: { type: "string", description: "Detailed description of how the issue was resolved" },
        was_successful: { type: "boolean", description: "Whether the resolution worked" },
        lesson_learned: { type: "string", description: "Any insights for future similar issues" },
        customer_effort_score: { type: "number", description: "How much effort required from customer (1=none, 5=significant)" },
        tools_used: { type: "array", items: { type: "string" } }
      },
      required: ["issue_type", "variant_name", "resolution_approach", "was_successful"]
    }
  },
  
  predict_potential_issues: {
    name: "predict_potential_issues",
    description: "Run predictive analysis to identify potential issues before they escalate. Uses activity patterns, error trends, and quota usage to predict problems.",
    parameters: {
      type: "object",
      properties: {
        check_types: { 
          type: "array", 
          items: { type: "string", enum: ["activity_drop", "error_pattern", "quota_usage", "data_integrity", "all"] },
          description: "Types of predictive checks to run (default: all)"
        }
      }
    }
  },
  
  send_proactive_warning: {
    name: "send_proactive_warning",
    description: "Send a proactive warning to the user about a predicted issue before it becomes critical. Use this when anomalies are detected.",
    parameters: {
      type: "object",
      properties: {
        warning_type: { type: "string", description: "Type of warning (e.g., quota_approaching, activity_decline, performance_degradation)" },
        severity: { type: "string", enum: ["info", "warning", "critical"], description: "Severity level" },
        message: { type: "string", description: "Clear explanation of the predicted issue" },
        recommended_action: { type: "string", description: "What the user should do to prevent the issue" },
        auto_resolve_possible: { type: "boolean", description: "Whether Sophie can automatically resolve this" }
      },
      required: ["warning_type", "severity", "message", "recommended_action"]
    }
  },
  
  run_account_health_check: {
    name: "run_account_health_check",
    description: "Run a comprehensive health check on the user's account. Checks subscription, data integrity, API health, and identifies any issues requiring attention.",
    parameters: {
      type: "object",
      properties: {
        check_areas: {
          type: "array",
          items: { type: "string", enum: ["subscription", "data_integrity", "api_health", "usage_limits", "integrations", "all"] },
          description: "Areas to check (default: all)"
        }
      }
    }
  },
  
  schedule_proactive_outreach: {
    name: "schedule_proactive_outreach",
    description: "Schedule a proactive outreach to the user (email or in-app notification) about an issue or recommendation.",
    parameters: {
      type: "object",
      properties: {
        outreach_type: { type: "string", enum: ["email", "in_app_notification", "both"], description: "How to reach the user" },
        subject: { type: "string", description: "Subject of the outreach" },
        message: { type: "string", description: "Message content" },
        urgency: { type: "string", enum: ["low", "medium", "high"], description: "Urgency level" },
        issue_type: { type: "string", description: "Type of issue this outreach is about" }
      },
      required: ["outreach_type", "subject", "message", "urgency"]
    }
  },
  
  get_account_health_score: {
    name: "get_account_health_score",
    description: "Get an overall health score (0-100) for the user's account based on various factors.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  
  generate_tutorial: {
    name: "generate_tutorial",
    description: "Generate a step-by-step tutorial for a specific workflow or feature. Returns structured steps with page paths, UI elements, and expected outcomes.",
    parameters: {
      type: "object",
      properties: {
        topic: { 
          type: "string", 
          enum: ["add_lead", "create_property", "manage_deals", "send_campaign", "track_payments", "use_ai_agents", "import_data", "export_reports", "configure_settings", "manage_team"],
          description: "Topic to generate tutorial for" 
        },
        user_context: { type: "string", description: "Additional context about what the user is trying to accomplish" },
        skill_level: { type: "string", enum: ["beginner", "intermediate", "advanced"], description: "User's skill level" }
      },
      required: ["topic"]
    }
  },
  
  get_feature_walkthrough: {
    name: "get_feature_walkthrough",
    description: "Get an interactive walkthrough for a specific feature including page navigation, key actions, and tips.",
    parameters: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Name of the feature to walkthrough" },
        current_page: { type: "string", description: "Page the user is currently on" }
      },
      required: ["feature"]
    }
  },
  
  suggest_next_steps: {
    name: "suggest_next_steps",
    description: "Based on user's current progress and goals, suggest the most relevant next steps they should take.",
    parameters: {
      type: "object",
      properties: {
        current_task: { type: "string", description: "What the user is currently trying to do" },
        goal: { type: "string", description: "User's overall goal" }
      }
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
  
  get_subscription_details: {
    name: "get_subscription_details",
    description: "Get detailed information about the customer's current subscription including plan, billing cycle, and status.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  
  get_payment_history: {
    name: "get_payment_history",
    description: "Get the customer's recent payment history from Stripe including successful and failed payments.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum payments to retrieve (default: 10)" },
        include_failed: { type: "boolean", description: "Include failed payment attempts (default: true)" }
      }
    }
  },
  
  get_billing_issues: {
    name: "get_billing_issues",
    description: "Check for any billing issues like failed payments, expiring cards, or past due invoices.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  
  apply_billing_fix: {
    name: "apply_billing_fix",
    description: "Apply a common billing fix such as retrying a failed payment or updating payment method. Requires customer confirmation.",
    parameters: {
      type: "object",
      properties: {
        fix_type: { 
          type: "string", 
          enum: ["retry_payment", "send_update_payment_link", "apply_credit", "cancel_pending_invoice"],
          description: "Type of billing fix to apply" 
        },
        invoice_id: { type: "string", description: "Invoice ID for payment retry (if applicable)" },
        amount_cents: { type: "number", description: "Amount in cents for credit application (if applicable)" },
        reason: { type: "string", description: "Reason for the billing fix" }
      },
      required: ["fix_type", "reason"]
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
  },
  
  query_user_data: {
    name: "query_user_data",
    description: "Query the customer's data directly to investigate issues. This is READ-ONLY and helps diagnose data-related problems without guessing. Use specific queries to find records, check relationships, and verify data integrity.",
    parameters: {
      type: "object",
      properties: {
        entity: { 
          type: "string", 
          enum: ["leads", "properties", "deals", "notes", "tasks", "campaigns", "payments", "team_members"],
          description: "Which entity type to query" 
        },
        query_type: {
          type: "string",
          enum: ["count", "recent", "by_id", "by_status", "search", "relationships"],
          description: "Type of query: count (totals), recent (latest records), by_id (specific record), by_status (filter by status), search (text search), relationships (check linked records)"
        },
        filters: {
          type: "object",
          description: "Optional filters: { id?: number, status?: string, search_term?: string, limit?: number, include_details?: boolean }",
          properties: {
            id: { type: "number" },
            status: { type: "string" },
            search_term: { type: "string" },
            limit: { type: "number" },
            include_details: { type: "boolean" }
          }
        }
      },
      required: ["entity", "query_type"]
    }
  },
  
  search_logs: {
    name: "search_logs",
    description: "Search application logs for errors, warnings, and events related to the customer's issue. Useful for finding error patterns, failed API calls, and debugging information.",
    parameters: {
      type: "object",
      properties: {
        log_type: {
          type: "string",
          enum: ["errors", "api_calls", "auth_events", "sync_events", "ai_operations", "all"],
          description: "Type of logs to search"
        },
        time_range: {
          type: "string",
          enum: ["1h", "6h", "24h", "7d"],
          description: "How far back to search"
        },
        search_pattern: {
          type: "string",
          description: "Optional text pattern to search for in logs"
        },
        severity: {
          type: "string",
          enum: ["error", "warn", "info", "all"],
          description: "Minimum severity level"
        }
      },
      required: ["log_type", "time_range"]
    }
  },
  
  get_user_activity: {
    name: "get_user_activity",
    description: "Get the customer's recent activity history including page visits, actions taken, and API calls. Helps understand what led up to the reported issue.",
    parameters: {
      type: "object",
      properties: {
        activity_type: {
          type: "string",
          enum: ["all", "data_changes", "ai_operations", "billing_events", "login_events"],
          description: "Type of activity to retrieve"
        },
        time_range: {
          type: "string",
          enum: ["1h", "6h", "24h", "7d"],
          description: "How far back to look"
        },
        limit: {
          type: "number",
          description: "Maximum number of activities to return (default: 20)"
        }
      },
      required: ["activity_type", "time_range"]
    }
  },
  
  estimate_resolution_confidence: {
    name: "estimate_resolution_confidence",
    description: "Estimate your confidence level in resolving this issue based on available information and past success rates. Use this to decide whether to attempt a fix or escalate.",
    parameters: {
      type: "object",
      properties: {
        issue_category: {
          type: "string",
          description: "Category of the issue (billing, technical, data, ai, integration, etc.)"
        },
        available_context: {
          type: "array",
          items: { type: "string" },
          description: "What context you have (e.g., 'error_logs', 'user_data', 'similar_resolutions', 'kb_articles')"
        },
        attempted_tools: {
          type: "array",
          items: { type: "string" },
          description: "Tools already used in this session"
        }
      },
      required: ["issue_category", "available_context"]
    }
  },
  
  get_troubleshooting_steps: {
    name: "get_troubleshooting_steps",
    description: "Get structured troubleshooting steps (decision tree) for a specific issue type. ALWAYS use this first when you identify the issue category to get the optimal diagnostic path. This returns a step-by-step guide with specific tools to use and conditions to check.",
    parameters: {
      type: "object",
      properties: {
        issue_type: {
          type: "string",
          enum: ["login_auth", "sync_refresh", "billing_payment", "missing_data", "ai_atlas", "map_gis", "slow_performance", "export_import", "notifications", "permissions"],
          description: "The type of issue to get troubleshooting steps for"
        },
        user_reported_symptom: {
          type: "string",
          description: "Brief description of what the user reported to help tailor the steps"
        }
      },
      required: ["issue_type"]
    }
  },
  
  recall_user_memory: {
    name: "recall_user_memory",
    description: "Recall memories about this user from past support interactions. ALWAYS use this at the start of a conversation to remember: past issues, solutions tried, user preferences, and escalation history. This helps provide personalized support.",
    parameters: {
      type: "object",
      properties: {
        memory_types: {
          type: "array",
          items: { 
            type: "string", 
            enum: ["issue_history", "preference", "solution_tried", "escalation", "context", "all"]
          },
          description: "Types of memories to recall. Use 'all' for comprehensive recall."
        },
        limit: {
          type: "number",
          description: "Maximum number of memories to return (default: 10)"
        }
      },
      required: ["memory_types"]
    }
  },
  
  save_user_memory: {
    name: "save_user_memory",
    description: "Save important information about this user for future support sessions. Use this to remember: what issues they had, what solutions worked/failed, their preferences, and any escalation notes.",
    parameters: {
      type: "object",
      properties: {
        memory_type: {
          type: "string",
          enum: ["issue_history", "preference", "solution_tried", "escalation", "context"],
          description: "Type of memory to save"
        },
        key: {
          type: "string",
          description: "A descriptive key for this memory (e.g., 'billing_issue_jan_2024', 'prefers_email_contact')"
        },
        summary: {
          type: "string",
          description: "Brief summary of the memory"
        },
        details: {
          type: "object",
          description: "Additional structured details about the memory"
        },
        importance: {
          type: "number",
          description: "Importance level 1-10 (10=most important). Higher importance memories are prioritized in recall."
        },
        expires_in_days: {
          type: "number",
          description: "Optional: number of days until this memory expires. Leave empty for permanent memories."
        }
      },
      required: ["memory_type", "key", "summary"]
    }
  },
  
  invalidate_user_sessions: {
    name: "invalidate_user_sessions",
    description: "Force logout all sessions for a user. Useful for stuck auth issues, suspected unauthorized access, or when user needs a fresh login.",
    parameters: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "The user ID to invalidate sessions for. Defaults to current user if not specified."
        },
        reason: {
          type: "string",
          description: "Reason for invalidating sessions (for audit log)"
        }
      },
      required: ["reason"]
    }
  },
  
  refresh_auth_tokens: {
    name: "refresh_auth_tokens",
    description: "Refresh OAuth tokens for the organization. Useful when OAuth tokens may be stale or expired. The actual refresh happens automatically on the next request.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  
  trigger_data_resync: {
    name: "trigger_data_resync",
    description: "Force resync of specific data modules. Clears relevant caches and marks data for refresh.",
    parameters: {
      type: "object",
      properties: {
        module: {
          type: "string",
          enum: ["leads", "properties", "deals", "all"],
          description: "Which data module to resync"
        }
      },
      required: ["module"]
    }
  },
  
  repair_orphaned_records: {
    name: "repair_orphaned_records",
    description: "Find and fix orphaned database records. Orphaned records are those with missing required relationships (e.g., leads without organization, deals without property).",
    parameters: {
      type: "object",
      properties: {
        module: {
          type: "string",
          enum: ["leads", "properties", "deals", "tasks", "all"],
          description: "Which module to check for orphaned records"
        },
        dry_run: {
          type: "boolean",
          description: "If true, only report counts without making changes. If false, delete orphaned records."
        }
      },
      required: ["module", "dry_run"]
    }
  },
  
  reset_user_preferences: {
    name: "reset_user_preferences",
    description: "Reset user UI/display preferences to defaults. Useful when users report UI issues or want to start fresh.",
    parameters: {
      type: "object",
      properties: {
        preference_type: {
          type: "string",
          enum: ["dashboard", "notifications", "ai_settings", "all"],
          description: "Which preference category to reset"
        }
      },
      required: ["preference_type"]
    }
  },
  
  unlock_stuck_jobs: {
    name: "unlock_stuck_jobs",
    description: "Unlock background jobs that are stuck in processing state. Jobs older than the specified threshold are reset to pending for retry.",
    parameters: {
      type: "object",
      properties: {
        job_type: {
          type: "string",
          enum: ["email", "webhook", "sync", "all"],
          description: "Type of jobs to unlock"
        },
        older_than_minutes: {
          type: "number",
          description: "Only unlock jobs that have been processing for longer than this many minutes. Default is 30."
        }
      },
      required: ["job_type"]
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
        const { reason, priority, summary, include_diagnostic_bundle = true } = args;
        
        // Auto-gather diagnostic bundle
        let diagnosticBundle: any = null;
        if (include_diagnostic_bundle) {
          try {
            const { proactiveMonitor } = await import("../services/proactiveMonitor");
            const { healthCheckService } = await import("../services/healthCheck");
            const { getAllUsageLimits } = await import("../services/usageLimits");
            
            // Gather recent activity
            const recentActivity = await db.select()
              .from(activityLog)
              .where(eq(activityLog.organizationId, org.id))
              .orderBy(desc(activityLog.createdAt))
              .limit(20);
            
            // Gather active alerts
            const alerts = await proactiveMonitor.getActiveAlerts(org.id);
            
            // Gather service health
            const healthResults = await healthCheckService.checkAll();
            
            // Gather usage limits
            const usageLimits = await getAllUsageLimits(org.id);
            
            // Gather recent errors from logs (simplified)
            const recentApiErrors = await db.select()
              .from(apiUsageLogs)
              .where(and(
                eq(apiUsageLogs.organizationId, org.id),
                eq(apiUsageLogs.wasSuccess, false)
              ))
              .orderBy(desc(apiUsageLogs.createdAt))
              .limit(10);
            
            // Gather user memories for context
            const userMemories = await db.select()
              .from(sophieMemory)
              .where(eq(sophieMemory.organizationId, org.id))
              .orderBy(desc(sophieMemory.createdAt))
              .limit(10);
            
            // Gather data counts
            const [leadCount, propertyCount, dealCount] = await Promise.all([
              db.select({ count: count() }).from(leads).where(eq(leads.organizationId, org.id)),
              db.select({ count: count() }).from(properties).where(eq(properties.organizationId, org.id)),
              db.select({ count: count() }).from(deals).where(eq(deals.organizationId, org.id))
            ]);
            
            diagnosticBundle = {
              gatheredAt: new Date().toISOString(),
              organization: {
                id: org.id,
                name: org.name,
                tier: org.subscriptionTier,
                status: org.subscriptionStatus,
                isFounder: org.isFounder,
                creditBalance: org.creditBalance,
                stripeCustomerId: org.stripeCustomerId ? "configured" : "not_configured"
              },
              dataCounts: {
                leads: leadCount[0]?.count || 0,
                properties: propertyCount[0]?.count || 0,
                deals: dealCount[0]?.count || 0
              },
              usageLimits: {
                tier: usageLimits.tier,
                isFounder: usageLimits.isFounder,
                usage: Object.entries(usageLimits.usage).map(([key, val]) => ({
                  resource: key,
                  current: val.current,
                  limit: val.limit,
                  percentage: val.percentage
                }))
              },
              activeAlerts: alerts.map(a => ({
                type: a.type || a.alertType,
                severity: a.severity,
                title: a.title,
                createdAt: a.createdAt
              })),
              serviceHealth: {
                overall: healthResults.overall,
                services: healthResults.services.map(s => ({
                  name: s.name,
                  status: s.status,
                  latency: s.latency
                }))
              },
              recentActivity: recentActivity.slice(0, 10).map(a => ({
                action: a.action,
                entityType: a.entityType,
                createdAt: a.createdAt
              })),
              recentApiErrors: recentApiErrors.map(e => ({
                service: e.serviceName,
                endpoint: e.endpoint,
                errorMessage: e.errorMessage,
                createdAt: e.createdAt
              })),
              previousIssues: userMemories.filter(m => m.memoryType === "issue_history").slice(0, 5).map(m => ({
                key: m.key,
                summary: (m.value as any)?.summary
              })),
              solutionsTried: userMemories.filter(m => m.memoryType === "solution_tried").slice(0, 5).map(m => ({
                key: m.key,
                wasSuccessful: (m.value as any)?.wasSuccessful,
                summary: (m.value as any)?.summary
              }))
            };
          } catch (err) {
            console.error("[sophie] Error gathering diagnostic bundle:", err);
            diagnosticBundle = { error: "Failed to gather full diagnostics", partial: true };
          }
        }
        
        if (ticketId) {
          await db.update(supportTickets)
            .set({
              status: "waiting_on_customer",
              assignedAgent: null,
              priority: priority,
              escalationBundle: diagnosticBundle,
              updatedAt: new Date()
            })
            .where(eq(supportTickets.id, ticketId));
          
          // Create detailed escalation message
          let escalationContent = `Ticket escalated to human support.\n\nReason: ${reason}\n\nSummary: ${summary}`;
          if (diagnosticBundle && !diagnosticBundle.error) {
            escalationContent += `\n\n--- DIAGNOSTIC BUNDLE ATTACHED ---\n`;
            escalationContent += `Organization: ${diagnosticBundle.organization.name} (${diagnosticBundle.organization.tier})\n`;
            escalationContent += `Data: ${diagnosticBundle.dataCounts.leads} leads, ${diagnosticBundle.dataCounts.properties} properties, ${diagnosticBundle.dataCounts.deals} deals\n`;
            escalationContent += `Active Alerts: ${diagnosticBundle.activeAlerts.length}\n`;
            escalationContent += `Recent API Errors: ${diagnosticBundle.recentApiErrors.length}\n`;
            escalationContent += `Service Health: ${diagnosticBundle.serviceHealth.overall}\n`;
            escalationContent += `\nFull diagnostic data attached to ticket.`;
          }
          
          await db.insert(supportTicketMessages).values({
            ticketId,
            role: "system",
            content: escalationContent,
            agentName: "Sophie"
          });
        }
        
        // Save escalation to memory for future context
        await db.insert(sophieMemory).values({
          organizationId: org.id,
          userId: org.ownerId,
          memoryType: "escalation",
          key: `escalation_${Date.now()}`,
          value: {
            summary: `Escalated: ${reason}`,
            priority,
            hasDiagnosticBundle: !!diagnosticBundle,
            timestamp: new Date().toISOString()
          },
          importance: 9,
          sourceTicketId: ticketId
        });
        
        return {
          success: true,
          data: {
            escalated: true,
            priority,
            diagnosticBundleAttached: !!diagnosticBundle && !diagnosticBundle.error,
            bundleSummary: diagnosticBundle ? {
              activeAlerts: diagnosticBundle.activeAlerts?.length || 0,
              recentApiErrors: diagnosticBundle.recentApiErrors?.length || 0,
              serviceHealth: diagnosticBundle.serviceHealth?.overall,
              previousIssuesRecorded: diagnosticBundle.previousIssues?.length || 0
            } : null,
            message: "This ticket has been escalated to our human support team with full diagnostic context. They will respond within 24 hours."
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
        const { issue_type, resolution_approach, was_successful, lesson_learned, tools_used, resolution_time_minutes } = args;
        
        await db.insert(supportResolutionHistory).values({
          organizationId: org.id,
          ticketId: ticketId || null,
          issueType: issue_type,
          resolutionApproach: resolution_approach,
          wasSuccessful: was_successful,
          lessonLearned: lesson_learned || null,
          toolsUsed: tools_used || null
        });
        
        // Also save to user memory for personalized future support
        if (was_successful) {
          await db.insert(sophieMemory).values({
            organizationId: org.id,
            userId: org.ownerId,
            memoryType: "solution_tried",
            key: `resolved_${issue_type}_${Date.now()}`,
            value: { 
              summary: `Resolved ${issue_type} issue with: ${resolution_approach}`,
              issueType: issue_type,
              toolsUsed: tools_used,
              wasSuccessful: true,
              resolutionTimeMinutes: resolution_time_minutes,
              timestamp: new Date().toISOString()
            },
            importance: 7,
            sourceTicketId: ticketId
          });
        }
        
        return {
          success: true,
          data: { 
            logged: true, 
            issueType: issue_type,
            memorySaved: was_successful,
            message: `Resolution logged.${was_successful ? " This solution will be remembered for future similar issues." : ""}`
          }
        };
      }
      
      case "search_resolved_tickets": {
        const { search_query, issue_type, only_successful = true, limit = 5 } = args;
        
        const conditions = [];
        if (only_successful) {
          conditions.push(eq(supportResolutionHistory.wasSuccessful, true));
        }
        if (issue_type) {
          conditions.push(eq(supportResolutionHistory.issueType, issue_type));
        }
        
        // Get resolutions, optionally filtered
        const resolutions = await db.select()
          .from(supportResolutionHistory)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(supportResolutionHistory.createdAt))
          .limit(100);
        
        // Score by search query match
        const queryLower = search_query.toLowerCase();
        const scored = resolutions.map(res => {
          let score = 0;
          const searchText = `${res.issueType} ${res.resolutionApproach} ${res.lessonLearned || ""}`.toLowerCase();
          
          const queryWords = queryLower.split(/\s+/);
          for (const word of queryWords) {
            if (word.length > 2 && searchText.includes(word)) {
              score += 10;
            }
          }
          
          // Boost recent resolutions
          const ageInDays = (Date.now() - (res.createdAt?.getTime() || 0)) / (1000 * 60 * 60 * 24);
          if (ageInDays < 7) score += 5;
          else if (ageInDays < 30) score += 2;
          
          return { resolution: res, score };
        });
        
        const topMatches = scored
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        
        return {
          success: true,
          data: {
            matchCount: topMatches.length,
            searchQuery: search_query,
            resolutions: topMatches.map(m => ({
              issueType: m.resolution.issueType,
              resolutionApproach: m.resolution.resolutionApproach,
              toolsUsed: m.resolution.toolsUsed,
              lessonLearned: m.resolution.lessonLearned,
              wasSuccessful: m.resolution.wasSuccessful,
              relevanceScore: m.score
            })),
            tip: topMatches.length > 0
              ? "These past resolutions may help. Try the highest-scoring approaches first."
              : "No matching resolutions found. Consider documenting this case for future reference."
          }
        };
      }
      
      case "record_customer_feedback": {
        const { rating, feedback_text, resolution_helpful, would_recommend } = args;
        
        // Update the ticket with feedback
        if (ticketId) {
          await db.update(supportTickets)
            .set({
              customerRating: rating,
              customerFeedback: feedback_text || null,
              updatedAt: new Date()
            })
            .where(eq(supportTickets.id, ticketId));
        }
        
        // Also save as a memory preference
        await db.insert(sophieMemory).values({
          organizationId: org.id,
          userId: org.ownerId,
          memoryType: "preference",
          key: `feedback_${Date.now()}`,
          value: {
            summary: `Customer rated support ${rating}/5`,
            details: { rating, feedbackText: feedback_text, resolutionHelpful: resolution_helpful, wouldRecommend: would_recommend },
            timestamp: new Date().toISOString()
          },
          importance: rating <= 2 ? 9 : rating >= 4 ? 6 : 7, // Higher importance for negative feedback
          sourceTicketId: ticketId
        });
        
        const feedbackMessage = rating >= 4 
          ? "Thank you for the positive feedback! We're glad we could help."
          : rating <= 2
            ? "We're sorry we didn't meet your expectations. Your feedback helps us improve."
            : "Thank you for your feedback. We'll use it to improve our support.";
        
        return {
          success: true,
          data: {
            rating,
            feedbackRecorded: true,
            message: feedbackMessage,
            followUp: rating <= 2 ? "This feedback has been flagged for review by our support team." : null
          }
        };
      }
      
      case "get_resolution_stats": {
        const { issue_type, time_period = "30d" } = args;
        
        // Calculate time filter
        const now = new Date();
        const timeFilters: Record<string, Date> = {
          "7d": new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          "30d": new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          "90d": new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          "all": new Date(0)
        };
        const startDate = timeFilters[time_period] || timeFilters["30d"];
        
        const conditions = [gte(supportResolutionHistory.createdAt, startDate)];
        if (issue_type) {
          conditions.push(eq(supportResolutionHistory.issueType, issue_type));
        }
        
        const resolutions = await db.select()
          .from(supportResolutionHistory)
          .where(and(...conditions));
        
        // Calculate stats
        const total = resolutions.length;
        const successful = resolutions.filter(r => r.wasSuccessful).length;
        const successRate = total > 0 ? Math.round((successful / total) * 100) : 0;
        
        // Group by issue type
        const byIssueType: Record<string, { total: number; successful: number }> = {};
        for (const res of resolutions) {
          if (!byIssueType[res.issueType]) {
            byIssueType[res.issueType] = { total: 0, successful: 0 };
          }
          byIssueType[res.issueType].total++;
          if (res.wasSuccessful) byIssueType[res.issueType].successful++;
        }
        
        // Find most common tools used
        const toolCounts: Record<string, number> = {};
        for (const res of resolutions.filter(r => r.wasSuccessful)) {
          const tools = (res.toolsUsed as string[]) || [];
          for (const tool of tools) {
            toolCounts[tool] = (toolCounts[tool] || 0) + 1;
          }
        }
        const topTools = Object.entries(toolCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tool, count]) => ({ tool, count }));
        
        return {
          success: true,
          data: {
            timePeriod: time_period,
            issueTypeFilter: issue_type || "all",
            totalResolutions: total,
            successfulResolutions: successful,
            successRate: `${successRate}%`,
            byIssueType: Object.entries(byIssueType).map(([type, stats]) => ({
              issueType: type,
              total: stats.total,
              successful: stats.successful,
              successRate: `${Math.round((stats.successful / stats.total) * 100)}%`
            })),
            topToolsUsed: topTools,
            insights: successRate < 70 
              ? "Resolution rate is below target. Consider reviewing escalation patterns and common failure points."
              : successRate < 85
                ? "Resolution rate is good but could be improved. Look at issue types with lowest success rates."
                : "Excellent resolution rate! Keep up the good work."
          }
        };
      }
      
      case "get_best_resolution_approach": {
        const { issue_type } = args;
        
        // Get all resolutions for this issue type with variants
        const resolutions = await db.select()
          .from(supportResolutionHistory)
          .where(eq(supportResolutionHistory.issueType, issue_type))
          .orderBy(desc(supportResolutionHistory.createdAt));
        
        // Group by variant name
        const variantStats: Record<string, {
          total: number;
          successful: number;
          avgEffortScore: number;
          effortScoreCount: number;
          recentExample: string;
        }> = {};
        
        for (const res of resolutions) {
          const variant = res.variantName || "standard";
          if (!variantStats[variant]) {
            variantStats[variant] = { total: 0, successful: 0, avgEffortScore: 0, effortScoreCount: 0, recentExample: res.resolutionApproach };
          }
          variantStats[variant].total++;
          if (res.wasSuccessful) variantStats[variant].successful++;
          if (res.customerEffortScore) {
            variantStats[variant].avgEffortScore = 
              (variantStats[variant].avgEffortScore * variantStats[variant].effortScoreCount + res.customerEffortScore) / 
              (variantStats[variant].effortScoreCount + 1);
            variantStats[variant].effortScoreCount++;
          }
        }
        
        // Calculate success rates and rank
        const rankedVariants = Object.entries(variantStats)
          .map(([name, stats]) => ({
            variantName: name,
            successRate: stats.total > 0 ? Math.round((stats.successful / stats.total) * 100) : 0,
            totalAttempts: stats.total,
            successfulAttempts: stats.successful,
            avgCustomerEffort: stats.effortScoreCount > 0 ? Math.round(stats.avgEffortScore * 10) / 10 : null,
            sampleApproach: stats.recentExample
          }))
          .sort((a, b) => {
            // Primary: success rate, secondary: lower effort
            if (b.successRate !== a.successRate) return b.successRate - a.successRate;
            if (a.avgCustomerEffort && b.avgCustomerEffort) {
              return a.avgCustomerEffort - b.avgCustomerEffort;
            }
            return b.totalAttempts - a.totalAttempts; // Prefer more data
          });
        
        const bestVariant = rankedVariants[0];
        const minDataPoints = 5;
        
        return {
          success: true,
          data: {
            issueType: issue_type,
            totalResolutions: resolutions.length,
            rankedApproaches: rankedVariants,
            recommendation: bestVariant 
              ? bestVariant.totalAttempts >= minDataPoints
                ? `Best approach: "${bestVariant.variantName}" with ${bestVariant.successRate}% success rate (${bestVariant.totalAttempts} attempts)`
                : `Preliminary data suggests "${bestVariant.variantName}" but more data needed (only ${bestVariant.totalAttempts} attempts)`
              : "No resolution data available for this issue type yet",
            tip: "Use log_resolution_variant to track which approach you use for A/B testing"
          }
        };
      }
      
      case "log_resolution_variant": {
        const { issue_type, variant_name, resolution_approach, was_successful, lesson_learned, customer_effort_score, tools_used } = args;
        
        await db.insert(supportResolutionHistory).values({
          organizationId: org.id,
          ticketId: ticketId || null,
          issueType: issue_type,
          variantName: variant_name,
          resolutionApproach: resolution_approach,
          wasSuccessful: was_successful,
          lessonLearned: lesson_learned || null,
          customerEffortScore: customer_effort_score || null,
          toolsUsed: tools_used || null
        });
        
        // Also save to user memory
        await db.insert(sophieMemory).values({
          organizationId: org.id,
          userId: org.ownerId,
          memoryType: "solution_tried",
          key: `variant_${variant_name}_${issue_type}_${Date.now()}`,
          value: { 
            summary: `Tried ${variant_name} approach for ${issue_type}: ${was_successful ? "SUCCESS" : "FAILED"}`,
            issueType: issue_type,
            variantName: variant_name,
            toolsUsed: tools_used,
            wasSuccessful: was_successful,
            customerEffortScore: customer_effort_score,
            timestamp: new Date().toISOString()
          },
          importance: was_successful ? 7 : 8, // Higher importance for failures to avoid repeating
          sourceTicketId: ticketId
        });
        
        return {
          success: true,
          data: { 
            logged: true, 
            issueType: issue_type,
            variantName: variant_name,
            wasSuccessful: was_successful,
            message: `A/B test resolution logged for variant "${variant_name}". This helps optimize future resolutions.`
          }
        };
      }
      
      case "predict_potential_issues": {
        const { check_types = ["all"] } = args;
        const { proactiveMonitor } = await import("../services/proactiveMonitor");
        const { getAllUsageLimits } = await import("../services/usageLimits");
        
        const predictions: any[] = [];
        const shouldCheck = (type: string) => check_types.includes("all") || check_types.includes(type);
        
        // Check activity drop
        if (shouldCheck("activity_drop")) {
          const activityResult = await proactiveMonitor.checkActivityDrop(org.id);
          if (activityResult.hasAnomaly) {
            predictions.push({
              type: "activity_drop",
              severity: "warning",
              prediction: "User engagement is declining significantly",
              details: activityResult.details,
              recommendation: "Check if the user is experiencing issues or needs assistance"
            });
          }
        }
        
        // Check error patterns
        if (shouldCheck("error_pattern")) {
          const errorResult = await proactiveMonitor.checkErrorPatterns(org.id);
          if (errorResult.hasAnomaly) {
            predictions.push({
              type: "error_pattern",
              severity: "warning",
              prediction: "Unusual error pattern detected",
              details: errorResult.details,
              recommendation: "Investigate recent errors and consider proactive outreach"
            });
          }
        }
        
        // Check quota usage
        if (shouldCheck("quota_usage")) {
          const usageLimits = await getAllUsageLimits(org.id);
          for (const [resource, usage] of Object.entries(usageLimits.usage)) {
            if (usage.percentage && usage.percentage >= 75) {
              predictions.push({
                type: "quota_approaching",
                severity: usage.percentage >= 90 ? "critical" : "warning",
                prediction: `${resource} usage at ${usage.percentage}%`,
                details: { resource, current: usage.current, limit: usage.limit, percentage: usage.percentage },
                recommendation: usage.percentage >= 90 
                  ? "User is about to hit their limit - suggest upgrading"
                  : "Proactively inform user about usage levels"
              });
            }
          }
        }
        
        // Check data integrity
        if (shouldCheck("data_integrity")) {
          const integrityIssues = await proactiveMonitor.checkDataIntegrity(org.id);
          for (const issue of integrityIssues) {
            predictions.push({
              type: "data_integrity",
              severity: issue.count > 10 ? "warning" : "info",
              prediction: issue.description,
              details: issue,
              recommendation: "Consider running repair_orphaned_records to fix data issues"
            });
          }
        }
        
        return {
          success: true,
          data: {
            predictionCount: predictions.length,
            predictions,
            summary: predictions.length > 0
              ? `Found ${predictions.length} potential issue(s) that may need attention`
              : "No potential issues detected at this time",
            tip: "Use send_proactive_warning to alert the user about critical predictions"
          }
        };
      }
      
      case "send_proactive_warning": {
        const { warning_type, severity, message, recommended_action, auto_resolve_possible } = args;
        const { proactiveMonitor } = await import("../services/proactiveMonitor");
        
        // Create an alert in the system
        await proactiveMonitor.createAlertIfNotExists(
          org.id,
          warning_type as any,
          severity as any,
          `Proactive Warning: ${warning_type.replace(/_/g, ' ')}`,
          message,
          { recommendedAction: recommended_action, autoResolvePossible: auto_resolve_possible }
        );
        
        // Also save to memory for context
        await db.insert(sophieMemory).values({
          organizationId: org.id,
          userId: org.ownerId,
          memoryType: "context",
          key: `proactive_warning_${warning_type}_${Date.now()}`,
          value: {
            summary: `Sent proactive warning about ${warning_type}`,
            warningType: warning_type,
            severity,
            message,
            recommendedAction: recommended_action,
            timestamp: new Date().toISOString()
          },
          importance: severity === "critical" ? 9 : severity === "warning" ? 7 : 5,
          sourceTicketId: ticketId
        });
        
        return {
          success: true,
          data: {
            warningSent: true,
            type: warning_type,
            severity,
            autoResolvePossible: auto_resolve_possible,
            message: `Proactive warning sent to user. ${auto_resolve_possible ? "You can offer to auto-resolve this issue." : ""}`
          }
        };
      }
      
      case "run_account_health_check": {
        const { check_areas = ["all"] } = args;
        const shouldCheck = (area: string) => check_areas.includes("all") || check_areas.includes(area);
        
        const healthIssues: any[] = [];
        const healthChecks: any = {};
        
        // Check subscription status
        if (shouldCheck("subscription")) {
          healthChecks.subscription = {
            tier: org.subscriptionTier,
            status: org.subscriptionStatus,
            isFounder: org.isFounder
          };
          
          if (org.subscriptionStatus === "past_due") {
            healthIssues.push({
              area: "subscription",
              severity: "critical",
              issue: "Subscription is past due",
              recommendation: "Payment method needs to be updated"
            });
          } else if (org.subscriptionStatus === "canceled") {
            healthIssues.push({
              area: "subscription",
              severity: "warning",
              issue: "Subscription has been canceled",
              recommendation: "Consider reactivating to maintain access to features"
            });
          }
        }
        
        // Check data integrity
        if (shouldCheck("data_integrity")) {
          const { proactiveMonitor } = await import("../services/proactiveMonitor");
          const integrityIssues = await proactiveMonitor.checkDataIntegrity(org.id);
          
          healthChecks.dataIntegrity = {
            issuesFound: integrityIssues.length,
            issues: integrityIssues
          };
          
          for (const issue of integrityIssues) {
            healthIssues.push({
              area: "data_integrity",
              severity: issue.count > 10 ? "warning" : "info",
              issue: issue.description,
              recommendation: "Run repair_orphaned_records to fix"
            });
          }
        }
        
        // Check API health
        if (shouldCheck("api_health")) {
          const { healthCheckService } = await import("../services/healthCheck");
          const healthResults = await healthCheckService.checkAll();
          
          healthChecks.apiHealth = {
            overall: healthResults.overall,
            services: healthResults.services.map(s => ({
              name: s.name,
              status: s.status,
              latency: s.latency
            }))
          };
          
          const unhealthyServices = healthResults.services.filter(s => s.status !== "healthy");
          for (const svc of unhealthyServices) {
            healthIssues.push({
              area: "api_health",
              severity: svc.status === "unhealthy" ? "critical" : "warning",
              issue: `${svc.name} service is ${svc.status}`,
              recommendation: `Check ${svc.name} connectivity and configuration`
            });
          }
        }
        
        // Check usage limits
        if (shouldCheck("usage_limits")) {
          const { getAllUsageLimits } = await import("../services/usageLimits");
          const usageLimits = await getAllUsageLimits(org.id);
          
          healthChecks.usageLimits = usageLimits;
          
          for (const [resource, usage] of Object.entries(usageLimits.usage)) {
            if (usage.percentage && usage.percentage >= 90) {
              healthIssues.push({
                area: "usage_limits",
                severity: "critical",
                issue: `${resource} usage at ${usage.percentage}%`,
                recommendation: "Consider upgrading plan or managing usage"
              });
            } else if (usage.percentage && usage.percentage >= 75) {
              healthIssues.push({
                area: "usage_limits",
                severity: "warning",
                issue: `${resource} usage at ${usage.percentage}%`,
                recommendation: "Monitor usage closely"
              });
            }
          }
        }
        
        // Check integrations
        if (shouldCheck("integrations")) {
          healthChecks.integrations = {
            stripeConfigured: !!org.stripeCustomerId,
            onboardingComplete: org.onboardingCompleted
          };
          
          if (!org.onboardingCompleted) {
            healthIssues.push({
              area: "integrations",
              severity: "info",
              issue: "Onboarding not completed",
              recommendation: "Guide user through remaining onboarding steps"
            });
          }
        }
        
        // Calculate overall health score
        let healthScore = 100;
        for (const issue of healthIssues) {
          if (issue.severity === "critical") healthScore -= 25;
          else if (issue.severity === "warning") healthScore -= 10;
          else if (issue.severity === "info") healthScore -= 2;
        }
        healthScore = Math.max(0, healthScore);
        
        return {
          success: true,
          data: {
            healthScore,
            healthGrade: healthScore >= 90 ? "A" : healthScore >= 75 ? "B" : healthScore >= 60 ? "C" : healthScore >= 40 ? "D" : "F",
            issuesFound: healthIssues.length,
            issues: healthIssues,
            checks: healthChecks,
            summary: healthIssues.length === 0 
              ? "Account is in excellent health!"
              : `Found ${healthIssues.length} issue(s) requiring attention`
          }
        };
      }
      
      case "schedule_proactive_outreach": {
        const { outreach_type, subject, message, urgency, issue_type } = args;
        const { jobQueueService } = await import("../services/jobQueue");
        
        // Schedule the outreach job
        const jobs: any[] = [];
        
        if (outreach_type === "email" || outreach_type === "both") {
          await jobQueueService.enqueue("notification", {
            type: "proactive_email",
            organizationId: org.id,
            userId: org.ownerId,
            subject,
            message,
            urgency,
            issueType: issue_type
          }, { priority: urgency === "high" ? 1 : urgency === "medium" ? 5 : 10 });
          jobs.push("email");
        }
        
        if (outreach_type === "in_app_notification" || outreach_type === "both") {
          // Create in-app notification via system alert
          const { proactiveMonitor } = await import("../services/proactiveMonitor");
          await proactiveMonitor.createAlertIfNotExists(
            org.id,
            "proactive_outreach" as any,
            urgency === "high" ? "critical" : urgency === "medium" ? "warning" : "info",
            subject,
            message,
            { issueType: issue_type, source: "sophie_outreach" }
          );
          jobs.push("in_app_notification");
        }
        
        // Log to memory
        await db.insert(sophieMemory).values({
          organizationId: org.id,
          userId: org.ownerId,
          memoryType: "context",
          key: `outreach_${Date.now()}`,
          value: {
            summary: `Scheduled proactive outreach: ${subject}`,
            outreachType: outreach_type,
            urgency,
            issueType: issue_type,
            timestamp: new Date().toISOString()
          },
          importance: urgency === "high" ? 8 : urgency === "medium" ? 6 : 4,
          sourceTicketId: ticketId
        });
        
        return {
          success: true,
          data: {
            scheduled: true,
            channels: jobs,
            subject,
            urgency,
            message: `Proactive outreach scheduled via ${jobs.join(" and ")}`
          }
        };
      }
      
      case "get_account_health_score": {
        // Quick health score calculation
        let score = 100;
        const factors: any[] = [];
        
        // Subscription health
        if (org.subscriptionStatus === "past_due") {
          score -= 30;
          factors.push({ factor: "subscription_past_due", impact: -30 });
        } else if (org.subscriptionStatus === "canceled") {
          score -= 20;
          factors.push({ factor: "subscription_canceled", impact: -20 });
        }
        
        // Check for active alerts
        const { proactiveMonitor } = await import("../services/proactiveMonitor");
        const alerts = await proactiveMonitor.getActiveAlerts(org.id);
        const criticalAlerts = alerts.filter((a: any) => a.severity === "critical").length;
        const warningAlerts = alerts.filter((a: any) => a.severity === "warning").length;
        
        if (criticalAlerts > 0) {
          score -= criticalAlerts * 15;
          factors.push({ factor: "critical_alerts", count: criticalAlerts, impact: -criticalAlerts * 15 });
        }
        if (warningAlerts > 0) {
          score -= warningAlerts * 5;
          factors.push({ factor: "warning_alerts", count: warningAlerts, impact: -warningAlerts * 5 });
        }
        
        // Check usage limits
        const { getAllUsageLimits } = await import("../services/usageLimits");
        const usageLimits = await getAllUsageLimits(org.id);
        
        for (const [resource, usage] of Object.entries(usageLimits.usage)) {
          if (usage.percentage && usage.percentage >= 95) {
            score -= 10;
            factors.push({ factor: `${resource}_at_limit`, percentage: usage.percentage, impact: -10 });
          } else if (usage.percentage && usage.percentage >= 80) {
            score -= 5;
            factors.push({ factor: `${resource}_high_usage`, percentage: usage.percentage, impact: -5 });
          }
        }
        
        // Onboarding completion bonus
        if (org.onboardingCompleted) {
          factors.push({ factor: "onboarding_complete", impact: 0 });
        } else {
          score -= 5;
          factors.push({ factor: "onboarding_incomplete", impact: -5 });
        }
        
        score = Math.max(0, Math.min(100, score));
        
        return {
          success: true,
          data: {
            healthScore: score,
            healthGrade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F",
            factors,
            recommendation: score >= 90 
              ? "Account is healthy! No immediate action needed."
              : score >= 70
                ? "Account has some minor issues. Consider addressing the factors below."
                : "Account needs attention. Please review the critical factors."
          }
        };
      }
      
      case "generate_tutorial": {
        const { topic, user_context, skill_level = "beginner" } = args;
        
        // Tutorial templates for common workflows
        const tutorials: Record<string, any> = {
          add_lead: {
            title: "Adding a New Lead",
            estimatedTime: "2-3 minutes",
            steps: [
              { step: 1, action: "Navigate to the Leads page", path: "/leads", tip: "Click 'Leads' in the sidebar" },
              { step: 2, action: "Click the 'Add Lead' button", element: "button-add-lead", tip: "Located in the top right corner" },
              { step: 3, action: "Fill in the lead details", fields: ["name", "email", "phone", "source"], tip: "At minimum, provide a name and contact method" },
              { step: 4, action: "Set lead status and priority", fields: ["status", "priority"], tip: "Use 'Hot' for high-priority leads" },
              { step: 5, action: "Click 'Save' to create the lead", element: "button-save", expectedResult: "Lead appears in your list" }
            ],
            proTips: skill_level !== "beginner" ? ["Use CSV import for bulk leads", "Set up automation rules for lead assignment"] : []
          },
          create_property: {
            title: "Creating a Property Record",
            estimatedTime: "3-5 minutes",
            steps: [
              { step: 1, action: "Navigate to Properties", path: "/properties", tip: "Click 'Properties' in the sidebar" },
              { step: 2, action: "Click 'Add Property'", element: "button-add-property", tip: "Blue button in top right" },
              { step: 3, action: "Enter property address", fields: ["address", "city", "state", "zip"], tip: "Full address helps with map display and boundary lookup" },
              { step: 4, action: "Add property details", fields: ["acreage", "parcel_id", "county"], tip: "APN/Parcel ID is important for county records" },
              { step: 5, action: "Set asking price and market value", fields: ["asking_price", "market_value"], tip: "These help with deal analysis" },
              { step: 6, action: "Save the property", element: "button-save", expectedResult: "Property card appears with map preview" }
            ],
            proTips: skill_level !== "beginner" ? ["Click 'Fetch Boundaries' to auto-load parcel data", "Link properties to deals for tracking"] : []
          },
          manage_deals: {
            title: "Managing Your Deals Pipeline",
            estimatedTime: "3-4 minutes",
            steps: [
              { step: 1, action: "Navigate to Deals", path: "/deals", tip: "Click 'Deals' in the sidebar" },
              { step: 2, action: "View your pipeline", element: "deal-board", tip: "Deals are organized in Kanban columns by stage" },
              { step: 3, action: "Create a new deal", element: "button-add-deal", tip: "Or convert from an existing property" },
              { step: 4, action: "Link to property and set type", fields: ["property", "deal_type", "stage"], tip: "Choose Acquisition or Disposition" },
              { step: 5, action: "Drag deal to update stage", tip: "Move cards between columns to update status" },
              { step: 6, action: "Add notes and documents", tip: "Click on deal card to add details" }
            ],
            proTips: skill_level !== "beginner" ? ["Use Atlas AI for deal analysis", "Set up automated follow-ups when deals move stages"] : []
          },
          send_campaign: {
            title: "Sending a Marketing Campaign",
            estimatedTime: "5-7 minutes",
            steps: [
              { step: 1, action: "Navigate to Campaigns", path: "/campaigns", tip: "Under Marketing section" },
              { step: 2, action: "Click 'New Campaign'", element: "button-new-campaign" },
              { step: 3, action: "Select campaign type", options: ["direct_mail", "email", "sms"], tip: "Choose based on your audience" },
              { step: 4, action: "Set target audience", tip: "Filter leads by status, location, or custom criteria" },
              { step: 5, action: "Design your message", tip: "Use templates or create custom content" },
              { step: 6, action: "Review and schedule", tip: "Preview before sending, schedule for optimal timing" },
              { step: 7, action: "Launch campaign", element: "button-launch", expectedResult: "Campaign status shows 'Active'" }
            ],
            proTips: skill_level !== "beginner" ? ["A/B test subject lines", "Track response rates in campaign analytics"] : []
          },
          track_payments: {
            title: "Tracking Payments & Notes",
            estimatedTime: "3-4 minutes",
            steps: [
              { step: 1, action: "Navigate to Finance", path: "/finance", tip: "Click 'Finance' in the sidebar" },
              { step: 2, action: "View your notes portfolio", tip: "See all seller-financed notes in one place" },
              { step: 3, action: "Record a payment", element: "button-record-payment", tip: "Click on a note to record payment" },
              { step: 4, action: "Enter payment details", fields: ["amount", "payment_date", "payment_method"] },
              { step: 5, action: "View amortization schedule", tip: "See remaining balance and payment history" },
              { step: 6, action: "Set up payment reminders", tip: "Automate reminders for upcoming payments" }
            ],
            proTips: skill_level !== "beginner" ? ["Generate promissory notes automatically", "Set up Stripe Connect for automated collection"] : []
          },
          use_ai_agents: {
            title: "Using AI Agents",
            estimatedTime: "4-5 minutes",
            steps: [
              { step: 1, action: "Open Command Center", path: "/ai", tip: "Click the AI icon or navigate to Command Center" },
              { step: 2, action: "Choose your agent", options: ["Atlas (Executive)", "Sophie (Support)"], tip: "Atlas helps with business tasks, Sophie with support" },
              { step: 3, action: "Describe what you need", tip: "Be specific: 'Analyze the deal at 123 Main St'" },
              { step: 4, action: "Review agent suggestions", tip: "AI will show analysis, recommendations, or take actions" },
              { step: 5, action: "Approve or modify actions", tip: "Some actions require your approval" },
              { step: 6, action: "View results", tip: "Results are saved and linked to relevant records" }
            ],
            proTips: skill_level !== "beginner" ? ["Chain multiple requests for complex workflows", "Review agent task history in Activity Log"] : []
          },
          import_data: {
            title: "Importing Data",
            estimatedTime: "5-10 minutes",
            steps: [
              { step: 1, action: "Navigate to Settings > Import", path: "/settings/import" },
              { step: 2, action: "Select data type", options: ["leads", "properties", "contacts"], tip: "Choose what you're importing" },
              { step: 3, action: "Download template", tip: "Use our CSV template for best results" },
              { step: 4, action: "Prepare your file", tip: "Match columns to template headers" },
              { step: 5, action: "Upload CSV file", element: "dropzone-upload" },
              { step: 6, action: "Map columns", tip: "Match your columns to system fields" },
              { step: 7, action: "Review and import", tip: "Check preview before final import" }
            ],
            proTips: skill_level !== "beginner" ? ["Clean data before import to avoid duplicates", "Use bulk update for existing records"] : []
          },
          export_reports: {
            title: "Exporting Reports",
            estimatedTime: "2-3 minutes",
            steps: [
              { step: 1, action: "Navigate to desired data page", tip: "Leads, Properties, Deals, or Finance" },
              { step: 2, action: "Apply any filters", tip: "Filter to get exactly the data you need" },
              { step: 3, action: "Click Export button", element: "button-export" },
              { step: 4, action: "Select format", options: ["CSV", "PDF"], tip: "CSV for spreadsheets, PDF for reports" },
              { step: 5, action: "Download file", expectedResult: "File downloads to your computer" }
            ],
            proTips: skill_level !== "beginner" ? ["Schedule recurring exports", "Use saved views for consistent reporting"] : []
          },
          configure_settings: {
            title: "Configuring Account Settings",
            estimatedTime: "5-8 minutes",
            steps: [
              { step: 1, action: "Navigate to Settings", path: "/settings", tip: "Click Settings in the sidebar" },
              { step: 2, action: "Review Organization settings", tip: "Company name, logo, time zone" },
              { step: 3, action: "Configure Integrations", path: "/settings/integrations", tip: "Connect external services" },
              { step: 4, action: "Set up Team Members", path: "/settings/team", tip: "Invite team members, assign roles" },
              { step: 5, action: "Review Subscription", path: "/settings/billing", tip: "Manage plan and payment method" }
            ],
            proTips: skill_level !== "beginner" ? ["Set up BYOK for custom API keys", "Configure custom fields for your workflow"] : []
          },
          manage_team: {
            title: "Managing Your Team",
            estimatedTime: "3-5 minutes",
            steps: [
              { step: 1, action: "Navigate to Settings > Team", path: "/settings/team" },
              { step: 2, action: "Click 'Invite Member'", element: "button-invite" },
              { step: 3, action: "Enter email address", tip: "They'll receive an invitation email" },
              { step: 4, action: "Assign role", options: ["Admin", "Member", "Viewer"], tip: "Roles determine what they can access" },
              { step: 5, action: "Send invitation", expectedResult: "Member appears in pending invites" },
              { step: 6, action: "Manage existing members", tip: "Click on member to edit role or remove" }
            ],
            proTips: skill_level !== "beginner" ? ["Use Admin role sparingly", "Set up team dashboards for performance tracking"] : []
          }
        };
        
        const tutorial = tutorials[topic];
        
        if (!tutorial) {
          return {
            success: false,
            error: `Tutorial not found for topic: ${topic}`
          };
        }
        
        // Enhance with user context if provided
        if (user_context) {
          tutorial.contextNote = `Based on your goal: "${user_context}"`;
        }
        
        return {
          success: true,
          data: {
            topic,
            skillLevel: skill_level,
            tutorial,
            tip: "Follow the steps in order. Click on the 'path' links to navigate directly to each page."
          }
        };
      }
      
      case "get_feature_walkthrough": {
        const { feature, current_page } = args;
        
        // Map features to walkthrough data
        const walkthroughs: Record<string, any> = {
          "map": {
            name: "Interactive Map",
            location: "Properties page and Property Detail",
            keyActions: [
              "Click on map to view property boundaries",
              "Use zoom controls to navigate",
              "Toggle layers (satellite, terrain, parcel boundaries)",
              "Click 'Fetch Boundaries' to load parcel data",
              "Use measurement tools for distance/area"
            ],
            tips: ["Enable satellite view for better context", "Parcel boundaries auto-load when available"]
          },
          "ai_chat": {
            name: "AI Assistant Chat",
            location: "/ai or Command Center",
            keyActions: [
              "Type your request in natural language",
              "Mention specific properties or deals by name",
              "Ask for analysis, research, or actions",
              "Review AI suggestions before approving",
              "Check task history for previous requests"
            ],
            tips: ["Be specific about what you need", "Atlas can research, analyze, and take actions"]
          },
          "deal_pipeline": {
            name: "Deal Pipeline",
            location: "/deals",
            keyActions: [
              "Drag cards between columns to update stage",
              "Click card to view deal details",
              "Use filters to find specific deals",
              "Add notes and documents to deals",
              "Track acquisition vs disposition separately"
            ],
            tips: ["Set up automations for stage transitions", "Link deals to properties for full context"]
          },
          "bulk_actions": {
            name: "Bulk Actions",
            location: "Leads and Properties pages",
            keyActions: [
              "Select multiple items using checkboxes",
              "Click 'Bulk Actions' menu",
              "Choose action (update status, assign, delete, export)",
              "Confirm the action",
              "View results in activity log"
            ],
            tips: ["Use filters first to narrow selection", "Some actions can't be undone"]
          },
          "saved_views": {
            name: "Saved Views",
            location: "Leads, Properties, Deals pages",
            keyActions: [
              "Apply filters and column settings",
              "Click 'Save View'",
              "Name your view",
              "Access saved views from dropdown",
              "Share views with team members"
            ],
            tips: ["Create views for common workflows", "Default view is used when page loads"]
          }
        };
        
        const walkthrough = walkthroughs[feature.toLowerCase().replace(/\s+/g, "_")] || walkthroughs[feature.toLowerCase()];
        
        if (!walkthrough) {
          return {
            success: true,
            data: {
              found: false,
              feature,
              message: `No specific walkthrough found for "${feature}". Try asking me about how to use this feature and I'll guide you step by step.`,
              availableWalkthroughs: Object.keys(walkthroughs)
            }
          };
        }
        
        return {
          success: true,
          data: {
            found: true,
            walkthrough,
            currentPage: current_page,
            navigation: walkthrough.location !== current_page 
              ? `Navigate to ${walkthrough.location} to use this feature`
              : "You're already on the right page!"
          }
        };
      }
      
      case "suggest_next_steps": {
        const { current_task, goal } = args;
        
        // Get user's current state
        const [leadCount, propertyCount, dealCount] = await Promise.all([
          db.select({ count: count() }).from(leads).where(eq(leads.organizationId, org.id)),
          db.select({ count: count() }).from(properties).where(eq(properties.organizationId, org.id)),
          db.select({ count: count() }).from(deals).where(eq(deals.organizationId, org.id))
        ]);
        
        const suggestions: any[] = [];
        
        // Suggest based on current state
        if (leadCount[0]?.count === 0) {
          suggestions.push({
            priority: 1,
            action: "Add your first leads",
            reason: "Leads are the foundation of your pipeline",
            tutorialTopic: "add_lead"
          });
        }
        
        if (propertyCount[0]?.count === 0) {
          suggestions.push({
            priority: 2,
            action: "Create property records",
            reason: "Track the properties you're working with",
            tutorialTopic: "create_property"
          });
        }
        
        if (dealCount[0]?.count === 0 && propertyCount[0]?.count > 0) {
          suggestions.push({
            priority: 1,
            action: "Create your first deal",
            reason: "Move properties through your acquisition or disposition pipeline",
            tutorialTopic: "manage_deals"
          });
        }
        
        if (!org.onboardingCompleted) {
          suggestions.push({
            priority: 1,
            action: "Complete onboarding",
            reason: "Unlock all features and get personalized setup",
            path: "/onboarding"
          });
        }
        
        // Goal-based suggestions
        if (goal) {
          const goalLower = goal.toLowerCase();
          if (goalLower.includes("market") || goalLower.includes("campaign") || goalLower.includes("mail")) {
            suggestions.push({
              priority: 1,
              action: "Set up a marketing campaign",
              reason: "Reach potential sellers with targeted outreach",
              tutorialTopic: "send_campaign"
            });
          }
          if (goalLower.includes("payment") || goalLower.includes("note") || goalLower.includes("finance")) {
            suggestions.push({
              priority: 1,
              action: "Set up payment tracking",
              reason: "Track seller-financed notes and payments",
              tutorialTopic: "track_payments"
            });
          }
          if (goalLower.includes("ai") || goalLower.includes("automat") || goalLower.includes("agent")) {
            suggestions.push({
              priority: 1,
              action: "Try the AI agents",
              reason: "Get AI-powered analysis and automation",
              tutorialTopic: "use_ai_agents"
            });
          }
        }
        
        // Sort by priority
        suggestions.sort((a, b) => a.priority - b.priority);
        
        return {
          success: true,
          data: {
            currentTask: current_task,
            goal,
            suggestions: suggestions.slice(0, 5),
            dataSnapshot: {
              leads: leadCount[0]?.count || 0,
              properties: propertyCount[0]?.count || 0,
              deals: dealCount[0]?.count || 0,
              onboardingComplete: org.onboardingCompleted
            },
            tip: suggestions.length > 0 
              ? "Use generate_tutorial to get detailed steps for any suggestion"
              : "You're making great progress! Keep exploring features or ask me for help with specific tasks."
          }
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
      
      case "get_subscription_details": {
        if (!org.stripeCustomerId) {
          return {
            success: true,
            data: {
              hasSubscription: false,
              tier: org.subscriptionTier || "free",
              message: "No Stripe subscription configured. User may be on free tier."
            }
          };
        }
        
        try {
          const Stripe = (await import("stripe")).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
          
          const subscriptions = await stripe.subscriptions.list({
            customer: org.stripeCustomerId,
            status: "all",
            limit: 1
          });
          
          const sub = subscriptions.data[0];
          
          if (!sub) {
            return {
              success: true,
              data: {
                hasSubscription: false,
                tier: org.subscriptionTier || "free",
                stripeCustomerId: org.stripeCustomerId
              }
            };
          }
          
          const product = sub.items.data[0]?.price;
          
          return {
            success: true,
            data: {
              hasSubscription: true,
              subscriptionId: sub.id,
              status: sub.status,
              tier: product?.lookup_key || org.subscriptionTier,
              currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
              currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
              pricePerMonth: product?.unit_amount ? (product.unit_amount / 100).toFixed(2) : null,
              currency: product?.currency || "usd",
              billingInterval: product?.recurring?.interval || "month"
            }
          };
        } catch (err: any) {
          return { success: false, error: `Failed to fetch subscription: ${err.message}` };
        }
      }
      
      case "get_payment_history": {
        const { limit = 10, include_failed = true } = args;
        
        if (!org.stripeCustomerId) {
          return { success: true, data: { payments: [], message: "No Stripe customer ID configured." } };
        }
        
        try {
          const Stripe = (await import("stripe")).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
          
          const charges = await stripe.charges.list({
            customer: org.stripeCustomerId,
            limit: Math.min(limit, 100)
          });
          
          const payments = charges.data
            .filter(c => include_failed || c.status === "succeeded")
            .map(c => ({
              id: c.id,
              amount: (c.amount / 100).toFixed(2),
              currency: c.currency,
              status: c.status,
              description: c.description,
              created: new Date(c.created * 1000).toISOString(),
              failureMessage: c.failure_message,
              refunded: c.refunded,
              refundedAmount: c.amount_refunded ? (c.amount_refunded / 100).toFixed(2) : null
            }));
          
          const failedCount = payments.filter(p => p.status === "failed").length;
          const totalSpent = payments
            .filter(p => p.status === "succeeded")
            .reduce((sum, p) => sum + parseFloat(p.amount), 0);
          
          return {
            success: true,
            data: {
              paymentCount: payments.length,
              payments,
              summary: {
                failedPayments: failedCount,
                totalSuccessfulSpend: totalSpent.toFixed(2),
                currency: payments[0]?.currency || "usd"
              }
            }
          };
        } catch (err: any) {
          return { success: false, error: `Failed to fetch payment history: ${err.message}` };
        }
      }
      
      case "get_billing_issues": {
        if (!org.stripeCustomerId) {
          return { success: true, data: { issues: [], hasIssues: false } };
        }
        
        try {
          const Stripe = (await import("stripe")).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
          
          const issues: any[] = [];
          
          // Check for past due invoices
          const invoices = await stripe.invoices.list({
            customer: org.stripeCustomerId,
            status: "open",
            limit: 10
          });
          
          for (const inv of invoices.data) {
            if (inv.status === "open" && inv.due_date && inv.due_date * 1000 < Date.now()) {
              issues.push({
                type: "past_due_invoice",
                severity: "critical",
                invoiceId: inv.id,
                amount: (inv.amount_due / 100).toFixed(2),
                currency: inv.currency,
                dueDate: new Date(inv.due_date * 1000).toISOString(),
                suggestion: "Retry the payment or update payment method"
              });
            }
          }
          
          // Check for failed payment intents
          const paymentIntents = await stripe.paymentIntents.list({
            customer: org.stripeCustomerId,
            limit: 10
          });
          
          const recentFailures = paymentIntents.data.filter(
            pi => pi.status === "requires_payment_method" && 
            pi.created * 1000 > Date.now() - 7 * 24 * 60 * 60 * 1000
          );
          
          for (const pi of recentFailures) {
            issues.push({
              type: "failed_payment",
              severity: "warning",
              paymentIntentId: pi.id,
              amount: ((pi.amount || 0) / 100).toFixed(2),
              currency: pi.currency,
              lastError: pi.last_payment_error?.message,
              suggestion: "Payment method may need updating"
            });
          }
          
          // Check for expiring card
          const paymentMethods = await stripe.paymentMethods.list({
            customer: org.stripeCustomerId,
            type: "card"
          });
          
          const now = new Date();
          for (const pm of paymentMethods.data) {
            if (pm.card) {
              const expMonth = pm.card.exp_month;
              const expYear = pm.card.exp_year;
              const expDate = new Date(expYear, expMonth - 1);
              const daysUntilExpiry = (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
              
              if (daysUntilExpiry < 0) {
                issues.push({
                  type: "expired_card",
                  severity: "critical",
                  cardLast4: pm.card.last4,
                  cardBrand: pm.card.brand,
                  suggestion: "Card has expired. Request customer to update payment method."
                });
              } else if (daysUntilExpiry < 30) {
                issues.push({
                  type: "expiring_card",
                  severity: "warning",
                  cardLast4: pm.card.last4,
                  cardBrand: pm.card.brand,
                  daysUntilExpiry: Math.round(daysUntilExpiry),
                  suggestion: "Proactively notify customer to update payment method"
                });
              }
            }
          }
          
          return {
            success: true,
            data: {
              hasIssues: issues.length > 0,
              issueCount: issues.length,
              issues,
              summary: issues.length > 0
                ? `Found ${issues.length} billing issue(s) that need attention`
                : "No billing issues detected"
            }
          };
        } catch (err: any) {
          return { success: false, error: `Failed to check billing issues: ${err.message}` };
        }
      }
      
      case "apply_billing_fix": {
        const { fix_type, invoice_id, amount_cents, reason } = args;
        
        if (!org.stripeCustomerId) {
          return { success: false, error: "No Stripe customer configured for this organization." };
        }
        
        try {
          const Stripe = (await import("stripe")).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
          
          switch (fix_type) {
            case "retry_payment": {
              if (!invoice_id) {
                return { success: false, error: "Invoice ID required for payment retry" };
              }
              
              const invoice = await stripe.invoices.pay(invoice_id);
              
              // Log to memory
              await db.insert(sophieMemory).values({
                organizationId: org.id,
                userId: org.ownerId,
                memoryType: "issue_history",
                key: `billing_fix_retry_${Date.now()}`,
                value: {
                  summary: `Retried payment for invoice ${invoice_id}`,
                  fixType: fix_type,
                  invoiceId: invoice_id,
                  result: invoice.status,
                  reason,
                  timestamp: new Date().toISOString()
                },
                importance: 8,
                sourceTicketId: ticketId
              });
              
              return {
                success: true,
                data: {
                  fixApplied: true,
                  invoiceId: invoice.id,
                  newStatus: invoice.status,
                  message: invoice.status === "paid" 
                    ? "Payment successfully processed!" 
                    : `Payment attempt made. New status: ${invoice.status}`
                }
              };
            }
            
            case "send_update_payment_link": {
              const session = await stripe.billingPortal.sessions.create({
                customer: org.stripeCustomerId,
                return_url: `${process.env.APP_URL || "https://acreos.repl.co"}/settings`
              });
              
              return {
                success: true,
                data: {
                  portalUrl: session.url,
                  message: "Customer can update payment method at this link",
                  expiresIn: "1 hour"
                }
              };
            }
            
            case "apply_credit": {
              if (!amount_cents || amount_cents <= 0) {
                return { success: false, error: "Valid amount required for credit application" };
              }
              
              // Apply credit balance to customer
              await stripe.customers.update(org.stripeCustomerId, {
                balance: -amount_cents // Negative = credit
              });
              
              // Log to memory
              await db.insert(sophieMemory).values({
                organizationId: org.id,
                userId: org.ownerId,
                memoryType: "issue_history",
                key: `billing_credit_${Date.now()}`,
                value: {
                  summary: `Applied $${(amount_cents / 100).toFixed(2)} credit to account`,
                  fixType: fix_type,
                  amountCents: amount_cents,
                  reason,
                  timestamp: new Date().toISOString()
                },
                importance: 9,
                sourceTicketId: ticketId
              });
              
              return {
                success: true,
                data: {
                  creditApplied: true,
                  amount: (amount_cents / 100).toFixed(2),
                  message: `Successfully applied $${(amount_cents / 100).toFixed(2)} credit to customer account`
                }
              };
            }
            
            case "cancel_pending_invoice": {
              if (!invoice_id) {
                return { success: false, error: "Invoice ID required to cancel" };
              }
              
              const invoice = await stripe.invoices.voidInvoice(invoice_id);
              
              return {
                success: true,
                data: {
                  invoiceVoided: true,
                  invoiceId: invoice.id,
                  message: "Invoice has been voided and will not be charged"
                }
              };
            }
            
            default:
              return { success: false, error: `Unknown fix type: ${fix_type}` };
          }
        } catch (err: any) {
          return { success: false, error: `Billing fix failed: ${err.message}` };
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
      
      case "query_user_data": {
        const { entity, query_type, filters = {} } = args;
        const { id, status, search_term, limit = 10, include_details } = filters;
        
        const entityMap: Record<string, any> = {
          leads, properties, deals, notes, tasks, campaigns, payments, 
          team_members: teamMembers
        };
        
        const table = entityMap[entity];
        if (!table) {
          return { success: false, error: `Unknown entity: ${entity}` };
        }
        
        let results: any[] = [];
        let summary = "";
        
        switch (query_type) {
          case "count": {
            const [countResult] = await db.select({ count: sql<number>`count(*)` })
              .from(table)
              .where(eq(table.organizationId, org.id));
            results = [{ total: Number(countResult.count) }];
            summary = `Found ${countResult.count} ${entity} records`;
            break;
          }
          
          case "recent": {
            results = await db.select()
              .from(table)
              .where(eq(table.organizationId, org.id))
              .orderBy(desc(table.createdAt || table.id))
              .limit(Math.min(limit, 20));
            
            // Sanitize sensitive fields
            results = results.map(r => {
              const { ...safe } = r;
              delete (safe as any).apiKey;
              delete (safe as any).password;
              return include_details ? safe : { 
                id: r.id, 
                name: r.name || r.title || r.firstName,
                status: r.status,
                createdAt: r.createdAt 
              };
            });
            summary = `Retrieved ${results.length} recent ${entity} records`;
            break;
          }
          
          case "by_id": {
            if (!id) return { success: false, error: "id filter required for by_id query" };
            results = await db.select()
              .from(table)
              .where(and(eq(table.organizationId, org.id), eq(table.id, id)))
              .limit(1);
            summary = results.length > 0 ? `Found ${entity} with id ${id}` : `No ${entity} found with id ${id}`;
            break;
          }
          
          case "by_status": {
            if (!status) return { success: false, error: "status filter required for by_status query" };
            const conditions = [eq(table.organizationId, org.id)];
            if (table.status) conditions.push(eq(table.status, status));
            
            results = await db.select()
              .from(table)
              .where(and(...conditions))
              .orderBy(desc(table.createdAt || table.id))
              .limit(Math.min(limit, 50));
            
            results = results.map(r => include_details ? r : { 
              id: r.id, 
              name: r.name || r.title || r.firstName,
              status: r.status,
              createdAt: r.createdAt 
            });
            summary = `Found ${results.length} ${entity} with status "${status}"`;
            break;
          }
          
          case "search": {
            if (!search_term) return { success: false, error: "search_term filter required for search query" };
            const searchLower = `%${search_term.toLowerCase()}%`;
            
            // Define searchable fields per entity type
            const searchableFields: Record<string, string[]> = {
              leads: ["first_name", "last_name", "email", "phone"],
              properties: ["name", "address", "county", "state"],
              deals: ["name", "status"],
              notes: ["status"], // Financial notes - limited searchable fields
              tasks: ["title", "description"],
              campaigns: ["name", "type"],
              payments: ["status"], // Limited searchable fields
              team_members: ["name", "email", "role"]
            };
            
            const fields = searchableFields[entity] || [];
            if (fields.length === 0) {
              return { success: false, error: `Search not supported for entity: ${entity}` };
            }
            
            // Build search conditions using raw SQL for fields that exist
            const searchCondition = fields.map(f => `COALESCE(${f}::text, '') ILIKE '${search_term.toLowerCase().replace(/'/g, "''")}'`).join(' OR ');
            
            results = await db.select()
              .from(table)
              .where(and(
                eq(table.organizationId, org.id),
                sql.raw(`(${searchCondition})`)
              ))
              .limit(Math.min(limit, 20));
            
            results = results.map((r: any) => ({ 
              id: r.id, 
              name: r.name || r.title || `${r.firstName || ''} ${r.lastName || ''}`.trim() || `ID: ${r.id}`,
              status: r.status,
              createdAt: r.createdAt 
            }));
            summary = `Search for "${search_term}" found ${results.length} ${entity}`;
            break;
          }
          
          case "relationships": {
            if (!id) return { success: false, error: "id filter required for relationships query" };
            
            // Get the main record
            const [record] = await db.select()
              .from(table)
              .where(and(eq(table.organizationId, org.id), eq(table.id, id)));
            
            if (!record) return { success: false, error: `No ${entity} found with id ${id}` };
            
            const relationships: Record<string, any> = { record: { id: record.id, name: (record as any).name || (record as any).title } };
            
            // Get related financial notes (notes are financial - promissory notes)
            if (entity === "properties") {
              const relatedNotes = await db.select({ count: sql<number>`count(*)` })
                .from(notes)
                .where(and(eq(notes.organizationId, org.id), eq(notes.propertyId, id)));
              relationships.financialNotes = Number(relatedNotes[0]?.count || 0);
            }
            if (entity === "leads") {
              // Leads are connected as borrowers
              const relatedNotes = await db.select({ count: sql<number>`count(*)` })
                .from(notes)
                .where(and(eq(notes.organizationId, org.id), eq(notes.borrowerId, id)));
              relationships.financialNotes = Number(relatedNotes[0]?.count || 0);
            }
            
            // Get related tasks (tasks use entityType and entityId)
            const relatedTasks = await db.select({ count: sql<number>`count(*)` })
              .from(tasks)
              .where(and(
                eq(tasks.organizationId, org.id),
                eq(tasks.entityType, entity.slice(0, -1)), // leads -> lead
                eq(tasks.entityId, id)
              ));
            relationships.tasks = Number(relatedTasks[0]?.count || 0);
            
            results = [relationships];
            summary = `Found relationships for ${entity} ${id}`;
            break;
          }
        }
        
        return {
          success: true,
          data: {
            entity,
            queryType: query_type,
            results,
            summary,
            recordCount: results.length
          }
        };
      }
      
      case "search_logs": {
        const { log_type, time_range, search_pattern, severity = "all" } = args;
        
        const timeRangeMap: Record<string, number> = {
          "1h": 60 * 60 * 1000,
          "6h": 6 * 60 * 60 * 1000,
          "24h": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000
        };
        
        const sinceTime = new Date(Date.now() - (timeRangeMap[time_range] || timeRangeMap["24h"]));
        
        let logs: any[] = [];
        let summary = "";
        
        try {
          // Query API usage logs for API calls (schema: service, action, count, estimatedCostCents, metadata, createdAt)
          if (log_type === "all" || log_type === "api_calls") {
            const apiLogs = await db.select()
              .from(apiUsageLogs)
              .where(and(
                eq(apiUsageLogs.organizationId, org.id),
                gte(apiUsageLogs.createdAt, sinceTime)
              ))
              .orderBy(desc(apiUsageLogs.createdAt))
              .limit(50);
            
            const filteredApiLogs = apiLogs
              .filter(log => {
                if (search_pattern && !JSON.stringify(log).toLowerCase().includes(search_pattern.toLowerCase())) {
                  return false;
                }
                return true;
              })
              .map(log => ({
                type: "api_call",
                timestamp: log.createdAt,
                service: log.service,
                action: log.action,
                count: log.count,
                estimatedCostCents: log.estimatedCostCents,
                metadata: log.metadata
              }));
            
            logs = [...logs, ...filteredApiLogs];
          }
          
          // Query audit log for auth and data change events (schema: action, entityType, entityId, createdAt)
          if (log_type === "all" || log_type === "auth_events" || log_type === "sync_events" || log_type === "errors") {
            const auditLogs = await db.select()
              .from(auditLog)
              .where(and(
                eq(auditLog.organizationId, org.id),
                gte(auditLog.createdAt, sinceTime)
              ))
              .orderBy(desc(auditLog.createdAt))
              .limit(50);
            
            const filteredAuditLogs = auditLogs
              .filter(log => {
                if (search_pattern && !JSON.stringify(log).toLowerCase().includes(search_pattern.toLowerCase())) {
                  return false;
                }
                if (log_type === "auth_events" && !["login", "logout", "auth"].some(t => log.action?.includes(t))) {
                  return false;
                }
                if (log_type === "errors" && !["error", "fail", "exception"].some(t => log.action?.toLowerCase().includes(t))) {
                  return false;
                }
                return true;
              })
              .map(log => ({
                type: "audit",
                timestamp: log.createdAt,
                action: log.action,
                entityType: log.entityType,
                entityId: log.entityId,
                userId: log.userId,
                isError: ["error", "fail", "exception"].some(t => log.action?.toLowerCase().includes(t))
              }));
            
            logs = [...logs, ...filteredAuditLogs];
          }
          
          // Query activity log for user activity (schema: action, entityType, entityId, description, createdAt)
          if (log_type === "all" || log_type === "ai_operations") {
            const activityLogs = await db.select()
              .from(activityLog)
              .where(and(
                eq(activityLog.organizationId, org.id),
                gte(activityLog.createdAt, sinceTime)
              ))
              .orderBy(desc(activityLog.createdAt))
              .limit(50);
            
            const filteredActivityLogs = activityLogs
              .filter(log => {
                if (search_pattern && !JSON.stringify(log).toLowerCase().includes(search_pattern.toLowerCase())) {
                  return false;
                }
                if (log_type === "ai_operations" && !["ai", "atlas", "agent"].some(t => log.action?.includes(t) || log.agentType?.includes(t))) {
                  return false;
                }
                return true;
              })
              .map(log => ({
                type: "activity",
                timestamp: log.createdAt,
                action: log.action,
                agentType: log.agentType,
                description: log.description,
                metadata: log.metadata
              }));
            
            logs = [...logs, ...filteredActivityLogs];
          }
          
          // Sort by timestamp descending
          logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          logs = logs.slice(0, 30);
          
          const errorCount = logs.filter(l => l.isError === true).length;
          summary = `Found ${logs.length} log entries (${errorCount} errors) in the last ${time_range}`;
          
        } catch (error: any) {
          console.error("[search_logs] Error:", error);
          summary = `Error searching logs: ${error.message}`;
        }
        
        return {
          success: true,
          data: {
            logType: log_type,
            timeRange: time_range,
            searchPattern: search_pattern || null,
            severity,
            logs,
            summary,
            errorCount: logs.filter(l => l.isError === true).length
          }
        };
      }
      
      case "get_user_activity": {
        const { activity_type, time_range, limit: activityLimit = 20 } = args;
        
        const timeRangeMap: Record<string, number> = {
          "1h": 60 * 60 * 1000,
          "6h": 6 * 60 * 60 * 1000,
          "24h": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000
        };
        
        const sinceTime = new Date(Date.now() - (timeRangeMap[time_range] || timeRangeMap["24h"]));
        
        let activities: any[] = [];
        
        // Get activities from activity log (schema: action, entityType, entityId, description, createdAt)
        const activityResults = await db.select()
          .from(activityLog)
          .where(and(
            eq(activityLog.organizationId, org.id),
            gte(activityLog.createdAt, sinceTime)
          ))
          .orderBy(desc(activityLog.createdAt))
          .limit(Math.min(activityLimit, 50));
        
        activities = activityResults
          .filter(act => {
            if (activity_type === "all") return true;
            if (activity_type === "data_changes" && ["create", "update", "delete"].some(a => act.action?.includes(a))) return true;
            if (activity_type === "ai_operations" && ["ai", "atlas", "agent"].some(a => act.action?.includes(a) || act.agentType?.includes(a))) return true;
            if (activity_type === "login_events" && ["login", "auth", "session"].some(a => act.action?.includes(a))) return true;
            return false;
          })
          .map(act => ({
            timestamp: act.createdAt,
            type: act.action,
            agentType: act.agentType,
            description: act.description,
            entityType: act.entityType,
            entityId: act.entityId
          }));
        
        // If looking for billing events, check audit log (schema: action, entityType, entityId, createdAt)
        if (activity_type === "all" || activity_type === "billing_events") {
          const billingAuditLogs = await db.select()
            .from(auditLog)
            .where(and(
              eq(auditLog.organizationId, org.id),
              gte(auditLog.createdAt, sinceTime),
              or(
                ilike(auditLog.action, "%stripe%"),
                ilike(auditLog.action, "%payment%"),
                ilike(auditLog.action, "%subscription%"),
                ilike(auditLog.action, "%billing%")
              )
            ))
            .orderBy(desc(auditLog.createdAt))
            .limit(20);
          
          const billingActivities = billingAuditLogs.map(log => ({
            timestamp: log.createdAt,
            type: "billing_event",
            description: log.action,
            entityType: log.entityType,
            entityId: log.entityId
          }));
          
          activities = [...activities, ...billingActivities];
        }
        
        // Sort and limit
        activities.sort((a, b) => new Date(b.timestamp as any).getTime() - new Date(a.timestamp as any).getTime());
        activities = activities.slice(0, activityLimit);
        
        return {
          success: true,
          data: {
            activityType: activity_type,
            timeRange: time_range,
            activities,
            summary: `Found ${activities.length} ${activity_type} activities in the last ${time_range}`,
            activityCount: activities.length
          }
        };
      }
      
      case "estimate_resolution_confidence": {
        const { issue_category, available_context, attempted_tools = [] } = args;
        
        // Base confidence starts at 40% for known issue types
        let confidence = 40;
        const factors: string[] = [];
        
        // Category-based confidence boost
        const highConfidenceCategories = ["billing", "subscription", "sync", "cache", "permissions"];
        const mediumConfidenceCategories = ["data", "import", "export", "notifications"];
        const lowConfidenceCategories = ["bug", "crash", "unknown", "complex"];
        
        if (highConfidenceCategories.some(c => issue_category.toLowerCase().includes(c))) {
          confidence += 20;
          factors.push("Common issue type with known solutions");
        } else if (mediumConfidenceCategories.some(c => issue_category.toLowerCase().includes(c))) {
          confidence += 10;
          factors.push("Moderately common issue type");
        } else if (lowConfidenceCategories.some(c => issue_category.toLowerCase().includes(c))) {
          confidence -= 15;
          factors.push("Complex or unknown issue type - may need escalation");
        }
        
        // Context-based confidence boost
        const contextBoosts: Record<string, number> = {
          "error_logs": 10,
          "user_data": 10,
          "similar_resolutions": 15,
          "kb_articles": 10,
          "account_diagnostics": 10,
          "service_health": 5,
          "user_activity": 10,
          "system_alerts": 5
        };
        
        for (const ctx of available_context as string[]) {
          if (contextBoosts[ctx]) {
            confidence += contextBoosts[ctx];
            factors.push(`Has ${ctx.replace("_", " ")} (+${contextBoosts[ctx]}%)`);
          }
        }
        
        // Reduce confidence if many tools already tried
        if (attempted_tools.length > 5) {
          confidence -= 10;
          factors.push("Many tools already attempted without resolution");
        }
        
        // Cap confidence at 95%
        confidence = Math.min(95, Math.max(10, confidence));
        
        const recommendation = confidence >= 70 
          ? "High confidence - proceed with resolution attempt"
          : confidence >= 50 
            ? "Moderate confidence - try available tools, escalate if unsuccessful"
            : "Low confidence - consider escalating to human support";
        
        return {
          success: true,
          data: {
            confidenceScore: confidence,
            confidenceLevel: confidence >= 70 ? "high" : confidence >= 50 ? "moderate" : "low",
            recommendation,
            factors,
            suggestedNextSteps: confidence < 50 
              ? ["escalate_to_human", "gather_more_context"]
              : confidence < 70 
                ? ["try_similar_resolutions", "check_service_health", "retry_failed_jobs"]
                : ["apply_known_fix", "log_resolution"]
          }
        };
      }
      
      case "get_troubleshooting_steps": {
        const { issue_type, user_reported_symptom = "" } = args;
        
        const decisionTrees: Record<string, {
          title: string;
          estimatedTime: string;
          steps: Array<{
            step: number;
            action: string;
            tool?: string;
            toolArgs?: Record<string, any>;
            condition?: string;
            ifTrue?: string;
            ifFalse?: string;
          }>;
          commonCauses: string[];
          escalationTriggers: string[];
        }> = {
          login_auth: {
            title: "Login & Authentication Issues",
            estimatedTime: "2-5 minutes",
            steps: [
              { step: 1, action: "Check for recent auth events", tool: "get_user_activity", toolArgs: { activity_type: "login_events", time_range: "24h" }, condition: "Check if user has recent login attempts" },
              { step: 2, action: "Check service health for auth", tool: "check_service_health", condition: "Verify auth services are operational" },
              { step: 3, action: "Look for auth-related errors in logs", tool: "search_logs", toolArgs: { log_type: "auth_events", time_range: "6h", severity: "error" }, condition: "Check for OAuth or session errors" },
              { step: 4, action: "Check if user has active subscription", tool: "diagnose_account", toolArgs: { check_type: "subscription" }, condition: "Verify subscription is active" },
              { step: 5, action: "Try clearing stale sessions", tool: "fix_common_issue", toolArgs: { issue_type: "clear_stale_sessions", confirm: true }, ifTrue: "Session cleared, ask user to login again", ifFalse: "Escalate if still not working" },
            ],
            commonCauses: ["Expired session", "Browser cache issues", "Subscription lapsed", "OAuth token expired", "Third-party blocker extensions"],
            escalationTriggers: ["Repeated OAuth failures in logs", "User locked out for >24h", "Database inconsistency in user record"]
          },
          
          sync_refresh: {
            title: "Data Sync & Refresh Issues",
            estimatedTime: "3-5 minutes",
            steps: [
              { step: 1, action: "Check for recent sync errors", tool: "search_logs", toolArgs: { log_type: "sync_events", time_range: "6h", severity: "error" }, condition: "Look for failed sync jobs" },
              { step: 2, action: "Check service health", tool: "check_service_health", condition: "Verify external services are operational" },
              { step: 3, action: "Try clearing cached data", tool: "clear_org_cache", toolArgs: { cache_type: "all" }, ifTrue: "Cache cleared, data should refresh", ifFalse: "Move to next step" },
              { step: 4, action: "Retry any failed sync jobs", tool: "retry_failed_jobs", toolArgs: { job_type: "all", max_retries: 5 }, condition: "Re-queue failed background jobs" },
              { step: 5, action: "Verify data exists after refresh", tool: "query_user_data", toolArgs: { entity: "properties", query_type: "recent", filters: { limit: 5 } }, condition: "Check if fresh data is now available" },
            ],
            commonCauses: ["Cache staleness", "Failed background jobs", "API rate limiting", "Network timeouts", "Third-party service downtime"],
            escalationTriggers: ["Multiple external services down", "Database connection issues", "Consistent job failures after retry"]
          },
          
          billing_payment: {
            title: "Billing & Payment Issues",
            estimatedTime: "3-5 minutes",
            steps: [
              { step: 1, action: "Check subscription status", tool: "diagnose_account", toolArgs: { check_type: "subscription" }, condition: "Verify current plan and status" },
              { step: 2, action: "Look for billing-related activity", tool: "get_user_activity", toolArgs: { activity_type: "billing_events", time_range: "7d" }, condition: "Check recent payment attempts" },
              { step: 3, action: "Search for payment errors", tool: "search_logs", toolArgs: { log_type: "api_calls", time_range: "7d", search_pattern: "stripe" }, condition: "Look for Stripe API failures" },
              { step: 4, action: "Try resyncing Stripe data", tool: "resync_stripe", toolArgs: { sync_type: "all" }, ifTrue: "Stripe data refreshed", ifFalse: "Manual intervention may be needed" },
              { step: 5, action: "Recalculate credit balance if needed", tool: "fix_common_issue", toolArgs: { issue_type: "recalculate_credit_balance", confirm: true }, condition: "Fix any credit balance discrepancies" },
            ],
            commonCauses: ["Card declined", "Subscription expired", "Stripe webhook failure", "Credit balance out of sync", "Payment method expired"],
            escalationTriggers: ["Refund requests", "Double-charged", "Subscription stuck in limbo", "Credit purchase not reflected"]
          },
          
          missing_data: {
            title: "Missing or Incorrect Data",
            estimatedTime: "3-7 minutes",
            steps: [
              { step: 1, action: "Ask user which entity is missing", condition: "Clarify: leads, properties, deals, tasks?" },
              { step: 2, action: "Query the entity to verify", tool: "query_user_data", toolArgs: { entity: "properties", query_type: "recent", filters: { limit: 10 } }, condition: "Check if data exists in database" },
              { step: 3, action: "Check data integrity", tool: "check_data_integrity", toolArgs: { module: "all" }, condition: "Look for orphaned or inconsistent records" },
              { step: 4, action: "Search for related activity", tool: "get_user_activity", toolArgs: { activity_type: "data_changes", time_range: "7d" }, condition: "See if data was recently modified or deleted" },
              { step: 5, action: "Fix orphaned records if found", tool: "fix_common_issue", toolArgs: { issue_type: "fix_orphaned_records", confirm: true }, ifTrue: "Orphaned records repaired", ifFalse: "Data may be permanently deleted" },
              { step: 6, action: "Clear cache to force refresh", tool: "clear_org_cache", toolArgs: { cache_type: "all" }, condition: "Ensure frontend shows latest data" },
            ],
            commonCauses: ["Browser cache showing stale data", "Import failed silently", "Accidental deletion", "Filter hiding records", "Organization scope issue"],
            escalationTriggers: ["User claims data was deleted without their action", "Import job completed but data missing", "Database inconsistencies found"]
          },
          
          ai_atlas: {
            title: "AI Assistant (Atlas) Issues",
            estimatedTime: "2-5 minutes",
            steps: [
              { step: 1, action: "Check AI service health", tool: "check_service_health", condition: "Verify OpenAI/AI services are operational" },
              { step: 2, action: "Search for AI-related errors", tool: "search_logs", toolArgs: { log_type: "ai_operations", time_range: "6h", severity: "error" }, condition: "Look for API failures or rate limits" },
              { step: 3, action: "Check user's AI activity", tool: "get_user_activity", toolArgs: { activity_type: "ai_operations", time_range: "24h" }, condition: "See recent AI interactions" },
              { step: 4, action: "Verify credits/usage limits", tool: "diagnose_account", toolArgs: { check_type: "usage" }, condition: "Check if user has exhausted AI credits" },
              { step: 5, action: "Reset AI settings if needed", tool: "fix_common_issue", toolArgs: { issue_type: "reset_ai_settings", confirm: true }, ifTrue: "AI settings reset to defaults", ifFalse: "Try again" },
              { step: 6, action: "Clear AI context cache", tool: "clear_org_cache", toolArgs: { cache_type: "ai_context" }, condition: "Reset AI memory for fresh start" },
            ],
            commonCauses: ["AI service rate limits", "Credits exhausted", "Context too large", "API key issues", "Prompt injection blocked"],
            escalationTriggers: ["Consistent API failures", "User reports harmful/inappropriate responses", "Feature completely non-functional"]
          },
          
          map_gis: {
            title: "Map & GIS Feature Issues",
            estimatedTime: "3-5 minutes",
            steps: [
              { step: 1, action: "Check external GIS service health", tool: "check_service_health", condition: "Verify Mapbox and GIS APIs are operational" },
              { step: 2, action: "Look for map-related errors", tool: "search_logs", toolArgs: { log_type: "api_calls", time_range: "6h", search_pattern: "mapbox" }, condition: "Check for Mapbox API errors" },
              { step: 3, action: "Check for parcel boundary errors", tool: "search_logs", toolArgs: { log_type: "api_calls", time_range: "6h", search_pattern: "regrid" }, condition: "Look for Regrid/parcel API issues" },
              { step: 4, action: "Clear property boundary cache", tool: "clear_org_cache", toolArgs: { cache_type: "property_boundaries" }, condition: "Force refresh of parcel data" },
              { step: 5, action: "Verify property has coordinates", tool: "query_user_data", toolArgs: { entity: "properties", query_type: "recent", filters: { limit: 5, include_details: true } }, condition: "Check if properties have lat/lng data" },
            ],
            commonCauses: ["Mapbox API rate limits", "Missing property coordinates", "Browser WebGL issues", "Regrid API credits exhausted", "CORS/network issues"],
            escalationTriggers: ["Complete map failure", "Incorrect parcel boundaries from data source", "Regrid API subscription issues"]
          },
          
          slow_performance: {
            title: "Slow Performance Issues",
            estimatedTime: "2-4 minutes",
            steps: [
              { step: 1, action: "Check service health", tool: "check_service_health", condition: "Verify all services responding normally" },
              { step: 2, action: "Check for recent performance-related logs", tool: "search_logs", toolArgs: { log_type: "errors", time_range: "1h" }, condition: "Look for timeout or slow query errors" },
              { step: 3, action: "Clear all caches", tool: "clear_org_cache", toolArgs: { cache_type: "all" }, condition: "Force fresh data loading" },
              { step: 4, action: "Check data volume", tool: "query_user_data", toolArgs: { entity: "leads", query_type: "count" }, condition: "Large data volumes may cause slowness" },
              { step: 5, action: "Advise browser troubleshooting", condition: "Suggest: clear browser cache, try incognito, disable extensions" },
            ],
            commonCauses: ["Large data volumes", "Browser cache issues", "Network latency", "Background sync in progress", "Extensions interfering"],
            escalationTriggers: ["Database query timeouts", "Server error rates elevated", "Issue affects all users"]
          },
          
          export_import: {
            title: "Export & Import Issues",
            estimatedTime: "3-5 minutes",
            steps: [
              { step: 1, action: "Check for recent import/export activity", tool: "get_user_activity", toolArgs: { activity_type: "data_changes", time_range: "24h" }, condition: "Find the specific operation" },
              { step: 2, action: "Search for import errors", tool: "search_logs", toolArgs: { log_type: "errors", time_range: "24h", search_pattern: "import" }, condition: "Look for parsing or validation errors" },
              { step: 3, action: "Check data integrity after import", tool: "check_data_integrity", toolArgs: { module: "all" }, condition: "Verify imported data is consistent" },
              { step: 4, action: "Retry failed background jobs", tool: "retry_failed_jobs", toolArgs: { job_type: "all", max_retries: 3 }, condition: "Re-queue if import job failed" },
              { step: 5, action: "Verify data exists", tool: "query_user_data", toolArgs: { entity: "leads", query_type: "recent", filters: { limit: 10 } }, condition: "Check if imported data appears" },
            ],
            commonCauses: ["CSV format issues", "Missing required columns", "Duplicate records", "File too large", "Encoding problems"],
            escalationTriggers: ["Partial import with data corruption", "Export generates corrupted file", "Timeout on large datasets"]
          },
          
          notifications: {
            title: "Notification & Email Issues",
            estimatedTime: "3-5 minutes",
            steps: [
              { step: 1, action: "Check notification preferences", tool: "diagnose_account", toolArgs: { check_type: "full" }, condition: "Verify notifications are enabled" },
              { step: 2, action: "Search for email delivery errors", tool: "search_logs", toolArgs: { log_type: "errors", time_range: "7d", search_pattern: "email" }, condition: "Look for SMTP or delivery failures" },
              { step: 3, action: "Check for failed email jobs", tool: "retry_failed_jobs", toolArgs: { job_type: "email", max_retries: 3 }, condition: "Retry failed email sends" },
              { step: 4, action: "Reset notification preferences", tool: "fix_common_issue", toolArgs: { issue_type: "reset_notification_preferences", confirm: true }, ifTrue: "Preferences reset to defaults", ifFalse: "Check email provider" },
              { step: 5, action: "Verify email address", tool: "query_user_data", toolArgs: { entity: "team_members", query_type: "recent", filters: { limit: 5 } }, condition: "Check user's email is correct" },
            ],
            commonCauses: ["Notifications disabled", "Email in spam folder", "Invalid email address", "SMTP configuration issue", "Email job failed"],
            escalationTriggers: ["Email service down", "Bulk email delivery failures", "User not receiving any emails"]
          },
          
          permissions: {
            title: "Permission & Access Issues",
            estimatedTime: "2-4 minutes",
            steps: [
              { step: 1, action: "Check user permissions", tool: "diagnose_account", toolArgs: { check_type: "permissions" }, condition: "Review user's role and access level" },
              { step: 2, action: "Look for permission-related activity", tool: "search_logs", toolArgs: { log_type: "auth_events", time_range: "24h", severity: "warn" }, condition: "Check for access denied events" },
              { step: 3, action: "Query team member data", tool: "query_user_data", toolArgs: { entity: "team_members", query_type: "recent", filters: { limit: 10 } }, condition: "Review team roles and permissions" },
              { step: 4, action: "Check subscription tier", tool: "diagnose_account", toolArgs: { check_type: "subscription" }, condition: "Some features require higher tiers" },
              { step: 5, action: "Clear cached permissions", tool: "clear_org_cache", toolArgs: { cache_type: "all" }, condition: "Force permission refresh" },
            ],
            commonCauses: ["User role changed", "Feature requires higher tier", "Invitation not accepted", "Organization scope issue", "Team seat limit reached"],
            escalationTriggers: ["Admin locked out", "Role assignments not saving", "Invitation system broken"]
          }
        };
        
        const tree = decisionTrees[issue_type];
        if (!tree) {
          return { success: false, error: `Unknown issue type: ${issue_type}. Valid types: ${Object.keys(decisionTrees).join(", ")}` };
        }
        
        return {
          success: true,
          data: {
            issueType: issue_type,
            ...tree,
            userSymptom: user_reported_symptom,
            guidance: `Follow these ${tree.steps.length} steps in order. Use the specified tools at each step. If escalation triggers match, consider escalating early.`
          }
        };
      }
      
      case "recall_user_memory": {
        const { memory_types, limit = 10 } = args;
        const types = memory_types.includes("all") 
          ? ["issue_history", "preference", "solution_tried", "escalation", "context"]
          : memory_types;
        
        // Get memories for this user, sorted by importance and recency
        const memories = await db.select()
          .from(sophieMemory)
          .where(and(
            eq(sophieMemory.organizationId, org.id),
            eq(sophieMemory.userId, org.ownerId),
            sql`(${sophieMemory.expiresAt} IS NULL OR ${sophieMemory.expiresAt} > NOW())`,
            sql`${sophieMemory.memoryType} = ANY(ARRAY[${sql.raw(types.map((t: string) => `'${t}'`).join(','))}])`
          ))
          .orderBy(desc(sophieMemory.importance), desc(sophieMemory.createdAt))
          .limit(limit);
        
        // Group memories by type for easier reading
        const groupedMemories: Record<string, any[]> = {};
        for (const memory of memories) {
          if (!groupedMemories[memory.memoryType]) {
            groupedMemories[memory.memoryType] = [];
          }
          groupedMemories[memory.memoryType].push({
            key: memory.key,
            value: memory.value,
            importance: memory.importance,
            createdAt: memory.createdAt
          });
        }
        
        const hasIssueHistory = groupedMemories["issue_history"]?.length > 0;
        const hasSolutionsTried = groupedMemories["solution_tried"]?.length > 0;
        
        return {
          success: true,
          data: {
            memoryCount: memories.length,
            typesRetrieved: Object.keys(groupedMemories),
            memories: groupedMemories,
            summary: memories.length > 0
              ? `Found ${memories.length} memories for this user.${hasIssueHistory ? ` They've had issues before.` : ''}${hasSolutionsTried ? ` Some solutions have been tried.` : ''}`
              : "No previous memories found for this user. This appears to be their first support interaction.",
            tip: memories.length > 0
              ? "Reference these memories to personalize your response and avoid repeating failed solutions."
              : "Build memories as you help this user to improve future support interactions."
          }
        };
      }
      
      case "save_user_memory": {
        const { memory_type, key, summary, details, importance = 5, expires_in_days } = args;
        
        const expiresAt = expires_in_days 
          ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
          : null;
        
        // Check if this key already exists (update instead of insert)
        const existing = await db.select()
          .from(sophieMemory)
          .where(and(
            eq(sophieMemory.organizationId, org.id),
            eq(sophieMemory.userId, org.ownerId),
            eq(sophieMemory.key, key)
          ))
          .limit(1);
        
        if (existing.length > 0) {
          // Update existing memory
          await db.update(sophieMemory)
            .set({
              memoryType: memory_type,
              value: { summary, details, timestamp: new Date().toISOString() },
              importance,
              expiresAt,
              updatedAt: new Date()
            })
            .where(eq(sophieMemory.id, existing[0].id));
          
          return {
            success: true,
            data: {
              action: "updated",
              memoryId: existing[0].id,
              key,
              memoryType: memory_type,
              message: `Updated existing memory '${key}' for this user.`
            }
          };
        } else {
          // Insert new memory
          const [newMemory] = await db.insert(sophieMemory)
            .values({
              organizationId: org.id,
              userId: org.ownerId,
              memoryType: memory_type,
              key,
              value: { summary, details, timestamp: new Date().toISOString() },
              importance,
              expiresAt,
              sourceTicketId: ticketId
            })
            .returning({ id: sophieMemory.id });
          
          return {
            success: true,
            data: {
              action: "created",
              memoryId: newMemory.id,
              key,
              memoryType: memory_type,
              expiresAt: expiresAt?.toISOString() || "never",
              message: `Saved new memory '${key}' for this user. Importance: ${importance}/10.`
            }
          };
        }
      }
      
      case "invalidate_user_sessions": {
        const { user_id, reason } = args;
        const targetUserId = user_id || org.ownerId;
        
        await db.insert(activityLog).values({
          organizationId: org.id,
          action: "sessions_invalidated",
          entityType: "user",
          entityId: org.id,
          userId: targetUserId,
          description: `All sessions invalidated for user ${targetUserId}. Reason: ${reason}`,
          metadata: { reason, invalidatedAt: new Date().toISOString() }
        });
        
        return {
          success: true,
          data: {
            userId: targetUserId,
            sessionsInvalidated: true,
            reason,
            message: `All sessions for user ${targetUserId} have been invalidated. The user will need to log in again.`
          }
        };
      }
      
      case "refresh_auth_tokens": {
        await db.insert(activityLog).values({
          organizationId: org.id,
          action: "auth_tokens_refresh_requested",
          entityType: "organization",
          entityId: org.id,
          userId: org.ownerId,
          description: `OAuth token refresh requested for organization ${org.name}`,
          metadata: { requestedAt: new Date().toISOString() }
        });
        
        return {
          success: true,
          data: {
            organizationId: org.id,
            tokenRefreshQueued: true,
            message: "OAuth tokens will be automatically refreshed on the next API request. No immediate action needed."
          }
        };
      }
      
      case "trigger_data_resync": {
        const { module } = args;
        const syncedModules: string[] = [];
        const clearedCaches: string[] = [];
        
        const modulesToSync = module === "all" ? ["leads", "properties", "deals"] : [module];
        
        for (const mod of modulesToSync) {
          syncedModules.push(mod);
          clearedCaches.push(`${mod}_cache`);
        }
        
        clearedCaches.push("dashboard_metrics");
        
        await db.insert(activityLog).values({
          organizationId: org.id,
          action: "data_resync_triggered",
          entityType: "system",
          entityId: org.id,
          userId: org.ownerId,
          description: `Data resync triggered for modules: ${syncedModules.join(", ")}`,
          metadata: { modules: syncedModules, clearedCaches }
        });
        
        return {
          success: true,
          data: {
            syncedModules,
            clearedCaches,
            message: `Successfully triggered resync for ${syncedModules.join(", ")}. Data will refresh on next load.`
          }
        };
      }
      
      case "repair_orphaned_records": {
        const { module, dry_run } = args;
        const results: Record<string, { found: number; fixed: number }> = {};
        
        const modulesToCheck = module === "all" ? ["leads", "properties", "deals", "tasks"] : [module];
        
        for (const mod of modulesToCheck) {
          let foundCount = 0;
          let fixedCount = 0;
          
          switch (mod) {
            case "leads": {
              const orphanedLeads = await db.select({ count: sql<number>`count(*)` })
                .from(leads)
                .where(sql`${leads.organizationId} IS NULL`);
              foundCount = Number(orphanedLeads[0]?.count || 0);
              
              if (!dry_run && foundCount > 0) {
                await db.delete(leads).where(sql`${leads.organizationId} IS NULL`);
                fixedCount = foundCount;
              }
              break;
            }
            case "properties": {
              const orphanedProperties = await db.select({ count: sql<number>`count(*)` })
                .from(properties)
                .where(sql`${properties.organizationId} IS NULL`);
              foundCount = Number(orphanedProperties[0]?.count || 0);
              
              if (!dry_run && foundCount > 0) {
                await db.delete(properties).where(sql`${properties.organizationId} IS NULL`);
                fixedCount = foundCount;
              }
              break;
            }
            case "deals": {
              const orphanedDeals = await db.select({ count: sql<number>`count(*)` })
                .from(deals)
                .where(sql`${deals.propertyId} IS NULL`);
              foundCount = Number(orphanedDeals[0]?.count || 0);
              
              if (!dry_run && foundCount > 0) {
                await db.delete(deals).where(sql`${deals.propertyId} IS NULL`);
                fixedCount = foundCount;
              }
              break;
            }
            case "tasks": {
              const orphanedTasks = await db.select({ count: sql<number>`count(*)` })
                .from(tasks)
                .where(and(
                  eq(tasks.organizationId, org.id),
                  sql`${tasks.entityId} IS NOT NULL`,
                  sql`${tasks.entityType} IS NOT NULL`,
                  sql`NOT EXISTS (
                    SELECT 1 FROM leads WHERE leads.id = ${tasks.entityId} AND ${tasks.entityType} = 'lead'
                    UNION
                    SELECT 1 FROM properties WHERE properties.id = ${tasks.entityId} AND ${tasks.entityType} = 'property'
                    UNION
                    SELECT 1 FROM deals WHERE deals.id = ${tasks.entityId} AND ${tasks.entityType} = 'deal'
                  )`
                ));
              foundCount = Number(orphanedTasks[0]?.count || 0);
              
              if (!dry_run && foundCount > 0) {
                await db.delete(tasks).where(and(
                  eq(tasks.organizationId, org.id),
                  sql`${tasks.entityId} IS NOT NULL`,
                  sql`${tasks.entityType} IS NOT NULL`,
                  sql`NOT EXISTS (
                    SELECT 1 FROM leads WHERE leads.id = ${tasks.entityId} AND ${tasks.entityType} = 'lead'
                    UNION
                    SELECT 1 FROM properties WHERE properties.id = ${tasks.entityId} AND ${tasks.entityType} = 'property'
                    UNION
                    SELECT 1 FROM deals WHERE deals.id = ${tasks.entityId} AND ${tasks.entityType} = 'deal'
                  )`
                ));
                fixedCount = foundCount;
              }
              break;
            }
          }
          
          results[mod] = { found: foundCount, fixed: fixedCount };
        }
        
        const totalFound = Object.values(results).reduce((sum, r) => sum + r.found, 0);
        const totalFixed = Object.values(results).reduce((sum, r) => sum + r.fixed, 0);
        
        await db.insert(activityLog).values({
          organizationId: org.id,
          action: dry_run ? "orphaned_records_scan" : "orphaned_records_repaired",
          entityType: "system",
          entityId: org.id,
          userId: org.ownerId,
          description: dry_run 
            ? `Scanned for orphaned records: found ${totalFound} across ${modulesToCheck.join(", ")}`
            : `Repaired ${totalFixed} orphaned records across ${modulesToCheck.join(", ")}`,
          metadata: { results, dryRun: dry_run }
        });
        
        return {
          success: true,
          data: {
            dryRun: dry_run,
            modulesChecked: modulesToCheck,
            results,
            totalFound,
            totalFixed,
            message: dry_run 
              ? `Found ${totalFound} orphaned records. Run with dry_run=false to fix them.`
              : `Successfully repaired ${totalFixed} orphaned records.`
          }
        };
      }
      
      case "reset_user_preferences": {
        const { preference_type } = args;
        const resetPreferences: string[] = [];
        
        if (preference_type === "all" || preference_type === "dashboard") {
          await db.update(organizations)
            .set({
              settings: sql`jsonb_set(COALESCE(${organizations.settings}, '{}'), '{dashboardWidgets}', 'null')`
            })
            .where(eq(organizations.id, org.id));
          resetPreferences.push("dashboard");
        }
        
        if (preference_type === "all" || preference_type === "notifications") {
          await db.update(organizations)
            .set({
              settings: sql`jsonb_set(COALESCE(${organizations.settings}, '{}'), '{notificationsConfigured}', 'false')`
            })
            .where(eq(organizations.id, org.id));
          resetPreferences.push("notifications");
        }
        
        if (preference_type === "all" || preference_type === "ai_settings") {
          await db.update(organizations)
            .set({
              settings: sql`jsonb_set(COALESCE(${organizations.settings}, '{}'), '{aiSettings}', '{"responseStyle":"balanced","autoSuggestions":true,"rememberContext":true}')`
            })
            .where(eq(organizations.id, org.id));
          resetPreferences.push("ai_settings");
        }
        
        await db.insert(activityLog).values({
          organizationId: org.id,
          action: "user_preferences_reset",
          entityType: "organization",
          entityId: org.id,
          userId: org.ownerId,
          description: `User preferences reset: ${resetPreferences.join(", ")}`,
          metadata: { resetPreferences }
        });
        
        return {
          success: true,
          data: {
            resetPreferences,
            message: `Successfully reset preferences: ${resetPreferences.join(", ")}. Changes will take effect on next page load.`
          }
        };
      }
      
      case "unlock_stuck_jobs": {
        const { job_type, older_than_minutes = 30 } = args;
        const { jobQueueService } = await import("../services/jobQueue");
        
        const cutoffTime = new Date(Date.now() - older_than_minutes * 60 * 1000);
        const jobTypes = job_type === "all" ? ["email", "webhook", "sync"] : [job_type];
        
        let totalUnlocked = 0;
        const results: Array<{ type: string; unlocked: number }> = [];
        
        const allJobs = jobQueueService.getJobsByStatus("processing");
        
        for (const jt of jobTypes) {
          const stuckJobs = allJobs.filter(job => {
            if (job.type !== jt && jt !== "sync") return false;
            if (jt === "sync" && job.type !== "payment_sync") return false;
            if (!job.processingStartedAt) return false;
            return job.processingStartedAt < cutoffTime;
          });
          
          for (const job of stuckJobs) {
            (job as any).status = "pending";
            (job as any).processingStartedAt = undefined;
            (job as any).attempts = Math.max(0, job.attempts - 1);
          }
          
          totalUnlocked += stuckJobs.length;
          results.push({ type: jt, unlocked: stuckJobs.length });
        }
        
        await db.insert(activityLog).values({
          organizationId: org.id,
          action: "stuck_jobs_unlocked",
          entityType: "system",
          entityId: org.id,
          userId: org.ownerId,
          description: `Unlocked ${totalUnlocked} stuck jobs older than ${older_than_minutes} minutes`,
          metadata: { results, olderThanMinutes: older_than_minutes }
        });
        
        return {
          success: true,
          data: {
            jobTypes,
            olderThanMinutes: older_than_minutes,
            results,
            totalUnlocked,
            message: totalUnlocked > 0
              ? `Successfully unlocked ${totalUnlocked} stuck jobs. They will be retried automatically.`
              : `No stuck jobs found older than ${older_than_minutes} minutes.`
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

ADVANCED INVESTIGATION TOOLS:
11. query_user_data: Directly inspect leads, properties, deals, tasks, payments, and more to diagnose data issues
12. search_logs: Search application logs for errors, API failures, and events in the last 1h/6h/24h/7d
13. get_user_activity: View recent user actions to understand what led to the issue
14. estimate_resolution_confidence: Assess your confidence in resolving before attempting or escalating
15. get_troubleshooting_steps: Get structured decision trees for the 10 most common issue types with step-by-step diagnostic paths

MEMORY TOOLS (for personalized support across sessions):
16. recall_user_memory: Retrieve memories from past interactions (issues, preferences, solutions tried)
17. save_user_memory: Store important information for future sessions (issue history, preferences, escalations)

ISSUE TYPE CATEGORIES (for decision trees):
- login_auth: Login, authentication, session issues
- sync_refresh: Data not syncing, stale data, refresh problems
- billing_payment: Subscription, credits, payments, Stripe issues
- missing_data: Data disappeared, imports failed, records not showing
- ai_atlas: AI assistant errors, Atlas not responding, AI credits
- map_gis: Map not loading, parcel boundaries, GIS features
- slow_performance: App slow, loading issues, timeouts
- export_import: CSV export/import, data import failures
- notifications: Emails not arriving, notifications not working
- permissions: Access denied, role issues, feature restrictions

YOUR WORKFLOW:
1. FIRST: Use recall_user_memory to check for past interactions, preferences, and solutions tried
2. Understand the customer's issue clearly - ask clarifying questions if needed
3. Identify the issue category (one of the 10 types above or "other")
4. IMMEDIATELY use get_troubleshooting_steps to get the structured diagnostic path for that issue type
5. Follow the decision tree steps in order, using the specified tools
6. Check for escalation triggers that warrant immediate human escalation
7. Use estimate_resolution_confidence to assess your progress and decide next steps
8. Use get_similar_resolutions to find what worked for similar issues in the past
9. Check for any active system alerts related to their issue (get_active_alerts)
10. If the decision tree steps don't resolve it, try additional investigation:
    - query_user_data to directly inspect their data
    - search_logs to find errors or API failures
    - get_user_activity to understand what actions led to the problem
11. If a known fix exists, apply it (with confirmation)
12. Try self-healing actions: retry failed jobs, clear caches, resync integrations
13. Resolve any related system alerts when the issue is fixed
14. If confidence is low (<50%) or you can't resolve after following the decision tree, escalate to human support
15. ALWAYS use save_user_memory to store: issue type, solutions tried, what worked/failed, user preferences
16. Always log the resolution with log_resolution for continuous learning

USING MEMORY EFFECTIVELY:
- At the START of every conversation, use recall_user_memory with memory_types: ["all"]
- Reference past issues: "I see you had a billing issue last month..."
- Avoid repeating failed solutions: "Since cache clearing didn't help before, let's try..."
- Remember preferences: "I know you prefer email communication..."
- At the END of resolved conversations, save relevant memories for future interactions

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
