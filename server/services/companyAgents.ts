// @ts-nocheck
/**
 * Company Agents — Sovereign Company Protocol
 *
 * Named AI personas that coordinate existing services into a virtual C-suite.
 * Each agent is a coordination layer — not a replacement for existing services.
 * Agents own sets of services, have communication styles, and report to the CEO Briefing.
 *
 * This is the agent registry: seed, query, update trust, generate reports.
 */

import { db } from "../db";
import { companyAgents, agentMemory, type InsertCompanyAgent, type CompanyAgent } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { resolveAgentData } from "./agentDataResolvers";
import { executeWithAuthority, checkAuthority } from "./agentAuthorityGate";

// ─── Core Agent Mapping ─────────────────────────────────────────────────────
// Maps company agent codenames to the 4 core agent types for skill/goal routing

export const CORE_AGENT_MAP: Record<string, string> = {
  atlas_cto: "operations",
  sophie_csm: "communications",
  forge_revenue: "deals",
  beacon_marketing: "communications",
  sentinel_devops: "operations",
  ledger_finance: "operations",
  shield_legal: "research",
  oracle_analytics: "research",
  compass_pm: "research",
  crucible_qa: "operations",
};

// ─── Agent Persona Definitions ──────────────────────────────────────────────

export interface AgentPersona {
  codename: string;
  title: string;
  wing: "product" | "growth" | "ops";
  personalityPrompt: string;
  ownedServices: string[];
  ownedJobs: string[];
  ownedRoutes: string[];
  authorityConfig: {
    level0Actions: string[];
    level1Actions: string[];
    level2Actions: string[];
    level3Actions: string[];
  };
}

const AGENT_ROSTER: AgentPersona[] = [
  {
    codename: "atlas_cto",
    title: "Chief Technology Officer",
    wing: "product",
    personalityPrompt: `You are Atlas, AcreOS's CTO. You are pragmatic, precise, and quality-obsessed. You speak in short, factual sentences. You care about system reliability, test coverage, code quality, and technical debt. When reporting, lead with the most important metric. Example: "Test coverage dropped 2% this week. Here's where the gaps are." Never use marketing language — you deal in facts and engineering reality.`,
    ownedServices: ["healthCheck", "proactiveMonitor", "externalStatusMonitor", "jobSupervisor", "dataQuality", "dataQualityMonitor", "gisValidation", "dataSourceValidationJob"],
    ownedJobs: ["autonomousHealthMonitor", "indexAnalyzer"],
    ownedRoutes: ["/api/health", "/api/system"],
    authorityConfig: {
      level0Actions: ["run_health_check", "clear_cache", "restart_background_job"],
      level1Actions: ["apply_dependency_patch", "toggle_feature_flag"],
      level2Actions: ["major_dependency_upgrade", "schema_migration"],
      level3Actions: ["infrastructure_scaling", "database_migration"],
    },
  },
  {
    codename: "sophie_csm",
    title: "Customer Success Manager",
    wing: "ops",
    personalityPrompt: `You are Sophie, AcreOS's Customer Success Manager. You are empathetic, warm, and proactive. You care deeply about customer happiness and always advocate for the user. You track onboarding completion, support ticket patterns, and customer health scores. When reporting, highlight human impact. Example: "8 support tickets auto-resolved today. One customer struggling with bulk imports — I've sent a guided walkthrough." Use warm but professional language.`,
    ownedServices: ["sophieObserver", "sophieLearning", "sophiePrivacyGuard", "supportBrain", "onboarding", "supportAgent"],
    ownedJobs: ["decisionsInbox"],
    ownedRoutes: ["/api/support", "/api/onboarding"],
    authorityConfig: {
      level0Actions: ["auto_resolve_support_ticket", "send_onboarding_tip", "log_observation"],
      level1Actions: ["send_retention_email", "escalate_ticket"],
      level2Actions: ["offer_discount_for_retention", "change_customer_tier"],
      level3Actions: ["refund_customer", "suspend_account"],
    },
  },
  {
    codename: "forge_revenue",
    title: "Revenue & Growth Lead",
    wing: "growth",
    personalityPrompt: `You are Forge, AcreOS's Revenue & Growth Lead. You are metrics-obsessed and pipeline-focused. You track MRR, churn, expansion revenue, and unit economics with surgical precision. When reporting, always lead with the number. Example: "MRR crossed $X overnight. Churn risk: 2 accounts flagged, both with rescue emails already sent." You are optimistic but grounded in data.`,
    ownedServices: ["stripeService", "stripeConnect", "revenueProtection", "dunning", "churnEngine", "tenantMetering", "credits", "transactionFeeService"],
    ownedJobs: ["growthAutomation", "churnEngine"],
    ownedRoutes: ["/api/billing", "/api/stripe", "/api/revenue"],
    authorityConfig: {
      level0Actions: ["track_mrr", "calculate_churn_risk", "send_dunning_email"],
      level1Actions: ["apply_credit", "extend_grace_period", "send_upsell_email"],
      level2Actions: ["change_pricing_tier", "offer_annual_discount"],
      level3Actions: ["process_refund_over_500", "modify_pricing_plans"],
    },
  },
  {
    codename: "beacon_marketing",
    title: "Marketing & Content Lead",
    wing: "growth",
    personalityPrompt: `You are Beacon, AcreOS's Marketing & Content Lead. You are creative, narrative-focused, and data-driven. You think in stories and conversions. When reporting, connect content to pipeline impact. Example: "Our 'tax delinquent strategy' keyword is ranking #14 — with a targeted post, we can crack page 1. Campaign optimizer adjusted 3 ad sets overnight, CPL down 8%." You balance creativity with measurable outcomes.`,
    ownedServices: ["campaignOptimizer", "adCreativeService", "metaAdsService", "growthAdService", "directMailService", "emailService", "smsService", "writingStyle", "listingSyndication"],
    ownedJobs: ["campaignOptimizer", "leadNurturer"],
    ownedRoutes: ["/api/campaigns", "/api/marketing"],
    authorityConfig: {
      level0Actions: ["optimize_ad_bid", "adjust_email_sequence", "generate_content_draft"],
      level1Actions: ["publish_blog_post", "launch_email_campaign", "adjust_ad_budget_under_100"],
      level2Actions: ["launch_new_ad_campaign", "adjust_ad_budget_over_100"],
      level3Actions: ["brand_messaging_change", "pricing_page_update"],
    },
  },
  {
    codename: "sentinel_devops",
    title: "DevOps & Infrastructure Lead",
    wing: "ops",
    personalityPrompt: `You are Sentinel, AcreOS's DevOps & Infrastructure Lead. You are vigilant, reliability-focused, and terse. You deal in uptime percentages, job health, and system metrics. When reporting, be brief and structured. Example: "99.97% uptime trailing 30 days. All 19 background jobs healthy. Redis pub/sub active. No anomalies." You never use flowery language — status reports only.`,
    ownedServices: ["realtimeAlerts", "cache", "jobSupervisor", "websocket"],
    ownedJobs: ["autonomousHealthMonitor", "realtimeAlerts"],
    ownedRoutes: ["/api/health", "/api/jobs"],
    authorityConfig: {
      level0Actions: ["acknowledge_alert", "restart_failed_job", "clear_redis_cache"],
      level1Actions: ["scale_worker_count", "rotate_api_key"],
      level2Actions: ["trigger_deployment", "database_failover"],
      level3Actions: ["infrastructure_downgrade", "data_center_migration"],
    },
  },
  {
    codename: "ledger_finance",
    title: "Finance & Billing Lead",
    wing: "ops",
    personalityPrompt: `You are Ledger, AcreOS's Finance & Billing Lead. You are precise, conservative, and thorough. You track burn rate, runway, AI spend, and billing anomalies. When reporting, always include dollar amounts and trends. Example: "AI spend this week: $X.XX, down 12% from last week. Semantic cache hit rate: 34%. No billing anomalies detected." You are cautious and always flag risk.`,
    ownedServices: ["financeAgent", "financialOSService", "bookkeeping", "cashFlowForecaster", "costBasisTracker", "depreciationService", "taxOptimizationEngine"],
    ownedJobs: ["financeAgent"],
    ownedRoutes: ["/api/finance", "/api/billing"],
    authorityConfig: {
      level0Actions: ["record_transaction", "categorize_expense", "calculate_metrics"],
      level1Actions: ["send_invoice_reminder", "flag_billing_anomaly"],
      level2Actions: ["adjust_billing_cycle", "apply_credit_over_100"],
      level3Actions: ["process_large_refund", "change_payment_processor"],
    },
  },
  {
    codename: "shield_legal",
    title: "Legal & Compliance Advisor",
    wing: "ops",
    personalityPrompt: `You are Shield, AcreOS's Legal & Compliance Advisor. You are cautious, thorough, and risk-aware. You monitor regulatory changes, audit data handling, and flag compliance gaps. When reporting, categorize by risk level. Example: "3 new state-level data privacy updates this month. GDPR endpoint coverage: complete. TCPA compliance: no violations. ToS last reviewed: 47 days ago — recommend refresh." You always err on the side of caution.`,
    ownedServices: ["complianceAI", "complianceGuardian", "regulatoryIntelligence", "gdprService", "tcpaCompliance", "doddFrankChecker", "usuryCeiling"],
    ownedJobs: ["regulatoryComplianceCheck"],
    ownedRoutes: ["/api/compliance", "/api/gdpr"],
    authorityConfig: {
      level0Actions: ["scan_regulatory_updates", "audit_data_handling", "check_compliance_status"],
      level1Actions: ["flag_compliance_gap", "generate_compliance_report"],
      level2Actions: ["update_privacy_policy_draft", "modify_data_retention"],
      level3Actions: ["legal_document_change", "regulatory_filing"],
    },
  },
  {
    codename: "oracle_analytics",
    title: "Analytics & Intelligence Lead",
    wing: "growth",
    personalityPrompt: `You are Oracle, AcreOS's Analytics & Intelligence Lead. You are pattern-obsessed and hypothesis-driven. You detect anomalies, run correlations, and surface leading indicators. When reporting, always propose a hypothesis. Example: "Trial-to-paid conversion is up 12% this week. Hypothesis: correlates with the new onboarding wizard shipped Thursday. Monitoring for confirmation over next 7 days." You think in cause-and-effect.`,
    ownedServices: ["cohortAnalysis", "learningAnalytics", "abTestEngine", "kpiStreamingService", "attributionService", "dataIntelligenceEngine"],
    ownedJobs: ["kpiStreaming"],
    ownedRoutes: ["/api/analytics", "/api/kpi"],
    authorityConfig: {
      level0Actions: ["run_cohort_analysis", "detect_anomaly", "calculate_attribution"],
      level1Actions: ["start_ab_test", "flag_metric_anomaly"],
      level2Actions: ["end_ab_test_with_winner", "change_kpi_thresholds"],
      level3Actions: ["modify_tracking_infrastructure", "change_attribution_model"],
    },
  },
  {
    codename: "compass_pm",
    title: "Product Manager",
    wing: "product",
    personalityPrompt: `You are Compass, AcreOS's Product Manager. You are user-obsessed and ruthlessly prioritize. You aggregate feature requests, track adoption, and synthesize user feedback into actionable insights. When reporting, always rank by impact. Example: "17 feature requests this week. Top 3 by volume: bulk lead import improvements (9), mobile push notifications (5), custom report builder (3). Recommending: prioritize bulk import — highest user pain." You are decisive and advocate for the user.`,
    ownedServices: ["betaProgram", "configManager"],
    ownedJobs: [],
    ownedRoutes: ["/api/beta", "/api/feature-requests"],
    authorityConfig: {
      level0Actions: ["categorize_feature_request", "track_adoption_metric", "generate_feedback_summary"],
      level1Actions: ["update_roadmap_priority", "toggle_beta_feature"],
      level2Actions: ["write_prd_draft", "deprecate_feature"],
      level3Actions: ["major_feature_removal", "pricing_tier_restructure"],
    },
  },
  {
    codename: "crucible_qa",
    title: "QA & Quality Lead",
    wing: "product",
    personalityPrompt: `You are Crucible, AcreOS's QA & Quality Lead. You are meticulous, skeptical, and detail-oriented. You track test coverage, regression risk, error rates, and quality gates. When reporting, be precise with numbers. Example: "1,658 tests passing. 3 flaky tests identified in e2e suite. Error rate: 0.02% trailing 7 days. Zero regressions since last deployment." You question everything and trust nothing without evidence.`,
    ownedServices: ["dataQuality", "dataQualityMonitor"],
    ownedJobs: [],
    ownedRoutes: ["/api/quality"],
    authorityConfig: {
      level0Actions: ["run_test_suite", "check_error_rates", "validate_data_quality"],
      level1Actions: ["flag_regression", "create_bug_report"],
      level2Actions: ["block_deployment", "mark_feature_unstable"],
      level3Actions: ["rollback_deployment", "disable_feature_in_production"],
    },
  },
];

// ─── Service Class ──────────────────────────────────────────────────────────

class CompanyAgentService {
  /**
   * Seed all 10 agents on startup. Upserts — safe to call repeatedly.
   */
  async seedAgents(): Promise<void> {
    for (const persona of AGENT_ROSTER) {
      const existing = await db.query.companyAgents.findFirst({
        where: eq(companyAgents.codename, persona.codename),
      });

      if (existing) {
        // Update personality and service mappings (they may evolve), but preserve trust/metrics
        await db.update(companyAgents)
          .set({
            title: persona.title,
            wing: persona.wing,
            personalityPrompt: persona.personalityPrompt,
            ownedServices: persona.ownedServices,
            ownedJobs: persona.ownedJobs,
            ownedRoutes: persona.ownedRoutes,
            authorityConfig: persona.authorityConfig,
            updatedAt: new Date(),
          })
          .where(eq(companyAgents.codename, persona.codename));
      } else {
        await db.insert(companyAgents).values({
          codename: persona.codename,
          title: persona.title,
          wing: persona.wing,
          personalityPrompt: persona.personalityPrompt,
          ownedServices: persona.ownedServices,
          ownedJobs: persona.ownedJobs,
          ownedRoutes: persona.ownedRoutes,
          authorityConfig: persona.authorityConfig,
          trustScore: 50,
          status: "active",
          metrics: {
            decisionsTotal: 0,
            decisionsCorrect: 0,
            escalationsCount: 0,
            avgConfidence: 0,
            lastWeekActions: 0,
          },
        });
      }
    }
  }

  /** Fetch all active agents */
  async getAll(): Promise<CompanyAgent[]> {
    return db.query.companyAgents.findMany({
      where: eq(companyAgents.status, "active"),
      orderBy: [desc(companyAgents.trustScore)],
    });
  }

  /** Fetch all agents regardless of status */
  async getAllIncludingPaused(): Promise<CompanyAgent[]> {
    return db.query.companyAgents.findMany({
      orderBy: [desc(companyAgents.trustScore)],
    });
  }

  /** Fetch a single agent by codename */
  async getByCodename(codename: string): Promise<CompanyAgent | undefined> {
    return db.query.companyAgents.findFirst({
      where: eq(companyAgents.codename, codename),
    });
  }

  /** Fetch agents by wing */
  async getByWing(wing: string): Promise<CompanyAgent[]> {
    return db.query.companyAgents.findMany({
      where: and(
        eq(companyAgents.wing, wing),
        eq(companyAgents.status, "active"),
      ),
    });
  }

  /** Update trust score with clamping */
  async updateTrustScore(codename: string, delta: number): Promise<number> {
    const agent = await this.getByCodename(codename);
    if (!agent) throw new Error(`Agent ${codename} not found`);

    const newScore = Math.max(0, Math.min(100, agent.trustScore + delta));
    await db.update(companyAgents)
      .set({ trustScore: newScore, updatedAt: new Date() })
      .where(eq(companyAgents.codename, codename));

    return newScore;
  }

  /** Update agent metrics after a decision */
  async updateMetrics(codename: string, updates: Partial<CompanyAgent["metrics"]>): Promise<void> {
    const agent = await this.getByCodename(codename);
    if (!agent) return;

    const currentMetrics = (agent.metrics as any) || {
      decisionsTotal: 0,
      decisionsCorrect: 0,
      escalationsCount: 0,
      avgConfidence: 0,
      lastWeekActions: 0,
    };

    await db.update(companyAgents)
      .set({
        metrics: { ...currentMetrics, ...updates },
        updatedAt: new Date(),
      })
      .where(eq(companyAgents.codename, codename));
  }

  /** Set agent status (active/paused/disabled) */
  async setStatus(codename: string, status: "active" | "paused" | "disabled"): Promise<void> {
    await db.update(companyAgents)
      .set({ status, updatedAt: new Date() })
      .where(eq(companyAgents.codename, codename));
  }

  /** Record activity timestamp */
  async recordActivity(codename: string): Promise<void> {
    await db.update(companyAgents)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(companyAgents.codename, codename));
  }

  /**
   * Generate a persona-voiced report for a single agent.
   * Queries owned services for metrics, then calls AI router to produce a summary.
   */
  async generateReport(codename: string, contextData?: Record<string, any>): Promise<{
    codename: string;
    title: string;
    wing: string;
    healthScore: number;
    summary: string;
    metrics: Record<string, number | string>;
    alerts: { level: string; message: string }[];
  }> {
    const agent = await this.getByCodename(codename);
    if (!agent) throw new Error(`Agent ${codename} not found`);

    const agentMetrics = (agent.metrics as any) || {};

    // v2: Resolve LIVE data from agent's owned services
    const liveData = await resolveAgentData(codename);
    const dataContext = { ...agentMetrics, ...liveData, ...(contextData || {}) };

    // Build a context-aware prompt for the agent
    const metricsStr = Object.entries(dataContext)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    try {
      // v5: Inject strategic priorities and learned patterns into agent prompts
      const { getPrioritiesForPrompt } = await import("./strategicCompass");
      const { getLearnedPatternsForPrompt } = await import("./overrideLearner");
      const strategicContext = await getPrioritiesForPrompt().catch(() => "");
      const learnedPatterns = await getLearnedPatternsForPrompt(codename).catch(() => "");

      const aiResponse = await routeAITask({
        taskType: "agent_report",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: (agent.personalityPrompt || `You are ${agent.codename}, the ${agent.title}.`) + `${strategicContext}${learnedPatterns}`,
          },
          {
            role: "user",
            content: `Generate your CEO briefing report. You are ${agent.title} (codename: ${agent.codename}), wing: ${agent.wing}.

Here are your current metrics and context:
${metricsStr}

Trust score: ${agent.trustScore}/100
Status: ${agent.status}
Last activity: ${agent.lastActivityAt?.toISOString() || "No recent activity"}

Write a 2-3 sentence summary in your characteristic voice. Be specific with numbers when available. Focus on what matters most right now. Also identify your current health score (0-100) and any alerts.

Respond in JSON format:
{
  "summary": "Your 2-3 sentence report in character",
  "healthScore": 85,
  "alerts": [{"level": "info|warning|critical", "message": "..."}],
  "keyMetrics": {"metricName": "value"}
}`,
          },
        ],
        responseFormat: { type: "json_object" },
      });

      const parsed = JSON.parse(aiResponse.content);

      return {
        codename: agent.codename,
        title: agent.title,
        wing: agent.wing,
        healthScore: parsed.healthScore ?? 80,
        summary: parsed.summary ?? "No report generated.",
        metrics: parsed.keyMetrics ?? agentMetrics,
        alerts: parsed.alerts ?? [],
      };
    } catch (err) {
      // Fallback: generate a basic report without AI
      return {
        codename: agent.codename,
        title: agent.title,
        wing: agent.wing,
        healthScore: agent.trustScore,
        summary: `${agent.title} is ${agent.status}. Trust score: ${agent.trustScore}/100. ${agentMetrics.lastWeekActions || 0} actions last week.`,
        metrics: agentMetrics,
        alerts: [],
      };
    }
  }

  /**
   * Determine which agent owns a decision based on item type.
   */
  getOwnerForDecisionType(itemType: string): string | null {
    const mapping: Record<string, string> = {
      support_escalation: "sophie_csm",
      critical_alert: "sentinel_devops",
      churn_risk_intervention: "forge_revenue",
      dunning_recovery: "forge_revenue",
      feature_request_flagged: "compass_pm",
      billing_anomaly: "ledger_finance",
      compliance_flag: "shield_legal",
      quality_regression: "crucible_qa",
      metric_anomaly: "oracle_analytics",
      content_review: "beacon_marketing",
      architecture_decision: "atlas_cto",
    };
    return mapping[itemType] || null;
  }

  /** Get the agent roster definitions (for reference/display) */
  getAgentRoster(): AgentPersona[] {
    return AGENT_ROSTER;
  }

  // ─── ACTION EXECUTION (v2) ──────────────────────────────────────────────

  /**
   * Execute a skill through the agent's authority gate.
   * Maps company agent to its core agent type, then invokes the skill registry.
   */
  async executeSkill(codename: string, skillName: string, params: Record<string, any>, context: any): Promise<any> {
    return executeWithAuthority(codename, skillName, async () => {
      const { SkillRegistry } = await import("./agent-skills");
      const registry = new SkillRegistry();
      const coreType = CORE_AGENT_MAP[codename] || "research";
      return registry.executeSkill(skillName, params, { ...context, agentType: coreType });
    }, {
      actionType: "skill",
      actionName: skillName,
      input: params,
    });
  }

  /**
   * Queue a goal for the Director Agent on behalf of a company agent.
   * Authority-gated: requires trust for 'queue_director_goal'.
   */
  async queueGoal(codename: string, goal: string, context: any, priority?: number): Promise<any> {
    return executeWithAuthority(codename, "queue_director_goal", async () => {
      const { queueDirectorGoal } = await import("./directorAgent");
      return queueDirectorGoal(
        context.organizationId || 0,
        goal,
        context,
        priority || 50
      );
    }, {
      actionType: "goal",
      actionName: "queue_director_goal",
      input: { goal, priority },
    });
  }

  /**
   * Store a learning in the Atlas Memory system.
   * No authority gate — memory storage is always allowed.
   */
  async storeMemory(codename: string, type: string, content: string, confidence: number): Promise<void> {
    try {
      await db.insert(agentMemory).values({
        agentType: codename,
        memoryType: type,
        content,
        confidence: confidence.toString(),
        usageCount: 0,
      } as any);
      await this.recordActivity(codename);
    } catch {}
  }

  /**
   * Resolve live data for this agent from its owned services.
   */
  async getLiveData(codename: string): Promise<Record<string, any>> {
    return resolveAgentData(codename);
  }

  /**
   * Check if an agent can perform an action at its current trust level.
   */
  async canPerform(codename: string, action: string): Promise<{ allowed: boolean; level: number; reason: string }> {
    const auth = await checkAuthority(codename, action);
    return { allowed: auth.allowed, level: auth.effectiveLevel, reason: auth.reason };
  }
}

export const companyAgentService = new CompanyAgentService();
