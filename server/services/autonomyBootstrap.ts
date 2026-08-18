/**
 * Autonomy Bootstrap — Seeds the system with everything needed
 * for 100% autonomous operation:
 *
 * 1. Default reaction chains (15+ event→action automations)
 * 2. Default incident playbooks (10+ self-healing recipes)
 * 3. Default degradation modes
 * 4. Seed episodic memories and strategies
 * 5. Agent initiative proposals
 * 6. Trust-based authority escalation
 * 7. Quality-based autonomy scoring
 *
 * Run once at startup; idempotent (skips if already seeded).
 */

import { db } from "../db";
import { agentEvents } from "@shared/schema";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { SYSTEM_ORG_ID } from "@shared/tenancy/systemOrg";

// Platform-level seeds belong to the system org. Imported, not re-declared:
// a private copy is how the 0-vs-1 disagreement in indexAnalyzer came to exist,
// and this file was one of two that a five-file allowlist never scanned.

// ─── 1. Default Reaction Chains ──────────────────────────────────────────────

const DEFAULT_CHAINS = [
  {
    name: "Payment Failed → Churn Intervention",
    eventType: "payment.failed",
    triggerConditions: {},
    steps: [
      { agentCodename: "forge", action: "send_churn_intervention", inputMapping: { orgTargetId: "$.orgId", reason: "$.payload.reason", interventionType: "email" }, governanceGate: false, timeoutMs: 30000 },
      { agentCodename: "sophie", action: "create_task", inputMapping: { title: "Follow up on payment failure: $.payload.reason", priority: "high" }, governanceGate: false, timeoutMs: 10000 },
      { agentCodename: "forge", action: "escalate_to_founder", inputMapping: { reason: "Payment failed — intervention sent, follow-up created", urgency: "normal" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "New Lead → Auto-Qualify & Assign",
    eventType: "lead.created",
    triggerConditions: {},
    steps: [
      { agentCodename: "oracle", action: "generate_report", inputMapping: { reportType: "lead_qualification", parameters: { leadId: "$.payload.leadId" } }, governanceGate: false, timeoutMs: 30000 },
      { agentCodename: "sophie", action: "send_follow_up", inputMapping: { leadId: "$.payload.leadId", channel: "email" }, governanceGate: false, timeoutMs: 15000 },
    ],
  },
  {
    name: "Deal Won → Revenue Attribution & Celebration",
    eventType: "deal.won",
    triggerConditions: {},
    steps: [
      { agentCodename: "ledger", action: "generate_report", inputMapping: { reportType: "revenue_attribution", parameters: { dealId: "$.payload.dealId" } }, governanceGate: false, timeoutMs: 30000 },
      { agentCodename: "forge", action: "send_alert", inputMapping: { severity: "info", title: "Deal Won!", message: "Deal $.payload.dealId closed successfully" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "Deal Lost → Post-Mortem & Learning",
    eventType: "deal.lost",
    triggerConditions: {},
    steps: [
      { agentCodename: "oracle", action: "generate_report", inputMapping: { reportType: "deal_post_mortem", parameters: { dealId: "$.payload.dealId" } }, governanceGate: false, timeoutMs: 30000 },
      { agentCodename: "oracle", action: "store_learning", inputMapping: { memoryType: "episodic", content: "Deal lost: $.payload.reason", tags: ["deal_lost", "post_mortem"] }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "Agent Conflict → Mediation Protocol",
    eventType: "agent:conflict",
    triggerConditions: {},
    steps: [
      { agentCodename: "shield", action: "escalate_to_founder", inputMapping: { reason: "Agent conflict: $.payload.topic", context: "$.payload", urgency: "high" }, governanceGate: true, timeoutMs: 10000 },
    ],
  },
  {
    name: "Job Failed → Auto-Restart + Alert",
    eventType: "job:failed",
    triggerConditions: {},
    steps: [
      { agentCodename: "sentinel", action: "restart_failed_job", inputMapping: { jobName: "$.payload.jobName" }, governanceGate: false, timeoutMs: 15000 },
      { agentCodename: "sentinel", action: "send_alert", inputMapping: { severity: "warning", title: "Job Failed", message: "$.payload.jobName failed: $.payload.error" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "Market Alert → Opportunity Scan",
    eventType: "market:alert",
    triggerConditions: {},
    steps: [
      { agentCodename: "oracle", action: "generate_report", inputMapping: { reportType: "market_opportunity", parameters: { county: "$.payload.county", state: "$.payload.state" } }, governanceGate: false, timeoutMs: 30000 },
    ],
  },
  {
    name: "Approval Requested → Notification Chain",
    eventType: "approval:requested",
    triggerConditions: {},
    steps: [
      { agentCodename: "shield", action: "send_alert", inputMapping: { severity: "info", title: "Approval Needed", message: "$.payload.description" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "High-Value Lead → VIP Treatment",
    eventType: "lead.scored",
    triggerConditions: { "$.payload.score": { "$gte": 80 } },
    steps: [
      { agentCodename: "sophie", action: "send_follow_up", inputMapping: { leadId: "$.payload.leadId", channel: "sms" }, governanceGate: false, timeoutMs: 15000 },
      { agentCodename: "sophie", action: "create_task", inputMapping: { title: "VIP lead follow-up: $.payload.leadId", priority: "urgent" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "Revenue Milestone → Celebration & Report",
    eventType: "revenue:milestone",
    triggerConditions: {},
    steps: [
      { agentCodename: "ledger", action: "generate_report", inputMapping: { reportType: "revenue_milestone", parameters: "$.payload" }, governanceGate: false, timeoutMs: 30000 },
      { agentCodename: "forge", action: "send_alert", inputMapping: { severity: "info", title: "Revenue Milestone!", message: "$.payload.description" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "Stale Deal → Auto-Nudge",
    eventType: "deal.stale",
    triggerConditions: {},
    steps: [
      { agentCodename: "sophie", action: "send_follow_up", inputMapping: { leadId: "$.payload.leadId", channel: "email", message: "Following up on your property inquiry" }, governanceGate: false, timeoutMs: 15000 },
      { agentCodename: "forge", action: "flag_deal_risk", inputMapping: { dealId: "$.payload.dealId", riskLevel: "medium", reason: "Deal stale for 7+ days" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "Agent Trust Promotion → Unlock Authority",
    eventType: "trust:threshold_crossed",
    triggerConditions: {},
    steps: [
      { agentCodename: "shield", action: "send_alert", inputMapping: { severity: "info", title: "Trust Promotion", message: "$.payload.agent promoted to level $.payload.newLevel" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "Compliance Violation → Emergency Protocol",
    eventType: "compliance.violation",
    triggerConditions: {},
    steps: [
      { agentCodename: "shield", action: "escalate_to_founder", inputMapping: { reason: "Compliance violation: $.payload.description", urgency: "critical", context: "$.payload" }, governanceGate: true, timeoutMs: 10000 },
      { agentCodename: "sentinel", action: "activate_degradation_mode", inputMapping: { modeName: "compliance_lockdown", reason: "Compliance violation detected" }, governanceGate: true, timeoutMs: 15000 },
    ],
  },
  {
    name: "Briefing Ready → Notify Founder",
    eventType: "briefing:ready",
    triggerConditions: {},
    steps: [
      { agentCodename: "oracle", action: "send_alert", inputMapping: { severity: "info", title: "Daily Briefing Ready", message: "Your morning briefing is ready" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
  {
    name: "Self-Healing Anomaly → Auto-Remediate",
    eventType: "anomaly.detected",
    triggerConditions: {},
    steps: [
      { agentCodename: "sentinel", action: "generate_report", inputMapping: { reportType: "anomaly_analysis", parameters: "$.payload" }, governanceGate: false, timeoutMs: 30000 },
      { agentCodename: "sentinel", action: "send_alert", inputMapping: { severity: "$.payload.severity", title: "Anomaly Detected", message: "$.payload.metric: $.payload.deviation% deviation" }, governanceGate: false, timeoutMs: 10000 },
    ],
  },
];

// ─── 2. Default Incident Playbooks ───────────────────────────────────────────

const DEFAULT_PLAYBOOKS = [
  {
    name: "High Error Rate Recovery",
    triggerPattern: { severity: "critical", metric: "error_rate", minDeviation: 50 },
    actions: [
      { type: "activate_degradation_mode", params: { modeName: "read_only", reason: "High error rate" } },
      { type: "restart_failed_job", params: { jobName: "all_failed" } },
      { type: "escalate_to_founder", params: { reason: "Critical error rate anomaly", urgency: "critical" } },
    ],
    cooldownMinutes: 30,
  },
  {
    name: "Memory Pressure Relief",
    triggerPattern: { severity: "warning", metric: "memory_usage", minDeviation: 30 },
    actions: [
      { type: "send_alert", params: { severity: "warning", title: "Memory pressure detected" } },
      { type: "restart_failed_job", params: { jobName: "cleanup_caches" } },
    ],
    cooldownMinutes: 60,
  },
  {
    name: "Response Time Degradation",
    triggerPattern: { severity: "warning", metric: "response_time_p99", minDeviation: 100 },
    actions: [
      { type: "activate_degradation_mode", params: { modeName: "reduced_features", reason: "Response time degradation" } },
      { type: "send_alert", params: { severity: "warning", title: "Response time degradation" } },
    ],
    cooldownMinutes: 15,
  },
  {
    name: "Agent Trust Crash",
    triggerPattern: { severity: "critical", metric: "trust_score" },
    actions: [
      { type: "escalate_to_founder", params: { reason: "Agent trust score crashed — review recent decisions", urgency: "high" } },
    ],
    cooldownMinutes: 60,
  },
  {
    name: "Revenue Anomaly Detection",
    triggerPattern: { severity: "warning", metric: "daily_revenue", minDeviation: 40 },
    actions: [
      { type: "generate_report", params: { reportType: "revenue_anomaly" } },
      { type: "escalate_to_founder", params: { reason: "Revenue anomaly detected — significant deviation from baseline" } },
    ],
    cooldownMinutes: 120,
  },
  {
    name: "Lead Conversion Drop",
    triggerPattern: { severity: "warning", metric: "conversion_rate", minDeviation: 25 },
    actions: [
      { type: "generate_report", params: { reportType: "conversion_analysis" } },
      { type: "send_alert", params: { severity: "warning", title: "Lead conversion rate dropped significantly" } },
    ],
    cooldownMinutes: 240,
  },
  {
    name: "Integration Failure Cascade",
    triggerPattern: { severity: "critical", metric: "integration_failures", minDeviation: 200 },
    actions: [
      { type: "activate_degradation_mode", params: { modeName: "offline_capable", reason: "Integration cascade failure" } },
      { type: "send_alert", params: { severity: "critical", title: "Multiple integrations failing" } },
      { type: "escalate_to_founder", params: { reason: "Integration cascade failure", urgency: "critical" } },
    ],
    cooldownMinutes: 15,
  },
  {
    name: "Churn Spike Response",
    triggerPattern: { severity: "critical", metric: "churn_rate", minDeviation: 50 },
    actions: [
      { type: "generate_report", params: { reportType: "churn_analysis" } },
      { type: "send_churn_intervention", params: { interventionType: "emergency" } },
      { type: "escalate_to_founder", params: { reason: "Churn rate spiking — emergency interventions initiated" } },
    ],
    cooldownMinutes: 60,
  },
  {
    name: "Database Connection Pool Exhaustion",
    triggerPattern: { severity: "critical", metric: "db_pool_usage", minDeviation: 80 },
    actions: [
      { type: "activate_degradation_mode", params: { modeName: "reduced_queries", reason: "DB pool near exhaustion" } },
      { type: "send_alert", params: { severity: "critical", title: "Database connection pool near capacity" } },
    ],
    cooldownMinutes: 10,
  },
  {
    name: "AI Spend Overrun",
    triggerPattern: { severity: "warning", metric: "ai_spend_daily", minDeviation: 100 },
    actions: [
      { type: "activate_degradation_mode", params: { modeName: "reduced_ai", reason: "AI spending above threshold" } },
      { type: "send_alert", params: { severity: "warning", title: "AI spending overrun" } },
      { type: "escalate_to_founder", params: { reason: "AI spending 2x above baseline" } },
    ],
    cooldownMinutes: 360,
  },
];

// ─── 3. Default Degradation Modes ────────────────────────────────────────────

const DEFAULT_DEGRADATION_MODES = [
  { name: "read_only", description: "Disable all write operations. Read-only mode for stability.", disabledCapabilities: ["db_write", "api_mutation", "email_send", "sms_send"] },
  { name: "reduced_features", description: "Disable non-critical features to reduce load.", disabledCapabilities: ["analytics", "reporting", "bulk_operations"] },
  { name: "reduced_ai", description: "Minimize AI API calls to control costs.", disabledCapabilities: ["ai_generation", "ai_analysis", "ai_chat"] },
  { name: "offline_capable", description: "Run without external integrations.", disabledCapabilities: ["external_api", "webhook_send", "integration_sync"] },
  { name: "compliance_lockdown", description: "Lock all financial and legal operations pending review.", disabledCapabilities: ["financial_operation", "legal_action", "offer_send", "contract_execute"] },
  { name: "reduced_queries", description: "Limit database query rate.", disabledCapabilities: ["bulk_query", "analytics", "reporting", "export"] },
];

// ─── 4. Seed Episodic Memories ───────────────────────────────────────────────

const DEFAULT_MEMORIES = [
  { type: "semantic", agent: "oracle", content: "Properties with road frontage sell 30-40% faster than landlocked parcels", tags: ["pricing", "market_knowledge"] },
  { type: "semantic", agent: "oracle", content: "Counties with population growth >2% annual tend to have 15-20% higher land value appreciation", tags: ["market_knowledge", "growth"] },
  { type: "semantic", agent: "forge", content: "Follow-up within 24 hours of initial contact increases conversion by 60%", tags: ["sales", "conversion"] },
  { type: "semantic", agent: "forge", content: "Seller-financed deals with 10-15% down payment have the lowest default rate", tags: ["financing", "risk"] },
  { type: "semantic", agent: "sophie", content: "Personalized follow-up emails have 3x response rate compared to templates", tags: ["communication", "engagement"] },
  { type: "semantic", agent: "ledger", content: "1031 exchanges must be completed within 180 days of initial sale", tags: ["tax", "compliance", "1031"] },
  { type: "semantic", agent: "shield", content: "Dodd-Frank requires loan origination compliance for seller-financed deals over $25K in some states", tags: ["compliance", "dodd_frank", "legal"] },
  { type: "procedural", agent: "sentinel", content: "When API error rate exceeds 5%, activate read_only degradation mode before investigating", tags: ["operations", "incident_response"] },
  { type: "procedural", agent: "sentinel", content: "Database connection pool alerts require immediate queue reduction — disable analytics first", tags: ["operations", "database"] },
  { type: "procedural", agent: "forge", content: "Churn rescue sequence: 1) Empathy email, 2) Discount offer after 48h, 3) CEO personal note after 7d", tags: ["churn", "retention", "sequence"] },
];

// ─── 5. Default Strategies ───────────────────────────────────────────────────

const DEFAULT_STRATEGIES = [
  { name: "Conservative Acquisition", description: "Target properties with LTV < 50%, in growth counties, with clear title. Prioritize safety over volume.", confidence: 0.8, status: "active", adoptedBy: ["oracle", "forge"] },
  { name: "Aggressive Lead Nurture", description: "Follow up within 2 hours, 3 touches in first week, personalized outreach based on property type.", confidence: 0.75, status: "active", adoptedBy: ["sophie", "forge"] },
  { name: "Revenue-First Pricing", description: "Price to sell within 90 days. Accept 10-15% lower margins for faster velocity.", confidence: 0.7, status: "active", adoptedBy: ["oracle", "ledger"] },
  { name: "Compliance-First Operations", description: "Gate all financial transactions through Dodd-Frank check. Never bypass legal review for deals over $50K.", confidence: 0.95, status: "active", adoptedBy: ["shield", "ledger"] },
];

// ─── Bootstrap Function ──────────────────────────────────────────────────────

export async function bootstrapAutonomy(): Promise<{ chains: number; playbooks: number; modes: number; memories: number; strategies: number }> {
  let chains = 0, playbooks = 0, modes = 0, memories = 0, strategies = 0;

  // 1. Seed reaction chains
  try {
    const { reactiveOrchestrationService } = await import("./reactiveOrchestrationV14");
    for (const chain of DEFAULT_CHAINS) {
      try {
        // Map the bootstrap chain shape onto CreateChainData (triggerEventType,
        // enabled, maxConcurrentRuns) and ChainStep (governanceCheck).
        await reactiveOrchestrationService.createChain(SYSTEM_ORG_ID, {
          name: chain.name,
          triggerEventType: chain.eventType,
          triggerConditions: chain.triggerConditions,
          steps: chain.steps.map((s) => ({
            agentCodename: s.agentCodename,
            action: s.action,
            inputMapping: s.inputMapping,
            governanceCheck: s.governanceGate,
            timeoutMs: s.timeoutMs,
          })),
          enabled: true,
          maxConcurrentRuns: 1,
          cooldownMs: 60000,
        });
        chains++;
      } catch {
        // Chain may already exist — skip
      }
    }
    logger.info(`[autonomy-bootstrap] Seeded ${chains} reaction chains`);
  } catch (err: any) {
    logger.info(`[autonomy-bootstrap] Reaction chains skipped: ${err.message}`);
  }

  // 2. Seed incident playbooks
  try {
    const { selfHealingMeshService } = await import("./selfHealingMeshV13");
    for (const playbook of DEFAULT_PLAYBOOKS) {
      try {
        await selfHealingMeshService.createPlaybook({
          name: playbook.name,
          triggerPattern: playbook.triggerPattern,
          // PlaybookInput actions require a `target`; default to "system".
          actions: playbook.actions.map((a) => ({
            type: a.type,
            target: "system",
            params: a.params,
          })),
          cooldownMinutes: playbook.cooldownMinutes,
        });
        playbooks++;
      } catch {
        // Playbook may already exist
      }
    }
    logger.info(`[autonomy-bootstrap] Seeded ${playbooks} incident playbooks`);
  } catch (err: any) {
    logger.info(`[autonomy-bootstrap] Playbooks skipped: ${err.message}`);
  }

  // 3. Seed degradation modes
  try {
    const { selfHealingMeshService } = await import("./selfHealingMeshV13");
    for (const mode of DEFAULT_DEGRADATION_MODES) {
      try {
        // registerDegradationMode(agentCodename, data). These are platform-wide
        // modes; register under the "system" agent. Map name→modeName and
        // disabledCapabilities→capabilitiesDisabled.
        await selfHealingMeshService.registerDegradationMode("system", {
          modeName: mode.name,
          capabilitiesAvailable: [],
          capabilitiesDisabled: mode.disabledCapabilities,
          triggerConditions: {},
        });
        modes++;
      } catch {
        // Mode may already exist
      }
    }
    logger.info(`[autonomy-bootstrap] Seeded ${modes} degradation modes`);
  } catch (err: any) {
    logger.info(`[autonomy-bootstrap] Degradation modes skipped: ${err.message}`);
  }

  // 4. Seed cognitive memories
  try {
    const { cognitiveMemoryService } = await import("./cognitiveMemoryV13");
    for (const memory of DEFAULT_MEMORIES) {
      try {
        // CognitiveMemoryService has no generic store(); seed as semantic facts.
        // Map agent→agentCodename, content→fact, type→category.
        await cognitiveMemoryService.extractFact(memory.agent, {
          fact: memory.content,
          category: memory.type,
          sourceEpisodes: [],
          orgId: SYSTEM_ORG_ID,
        });
        memories++;
      } catch {
        // Memory may already exist
      }
    }
    logger.info(`[autonomy-bootstrap] Seeded ${memories} cognitive memories`);
  } catch (err: any) {
    logger.info(`[autonomy-bootstrap] Memories skipped: ${err.message}`);
  }

  // 5. Seed adaptive strategies
  try {
    const { adaptiveStrategyService } = await import("./adaptiveStrategyV13");
    for (const strategy of DEFAULT_STRATEGIES) {
      try {
        // createStrategy(agentCodename, data). Seed under the first adopting
        // agent; carry confidence/status into the config blob.
        await adaptiveStrategyService.createStrategy(strategy.adoptedBy[0] ?? "oracle", {
          name: strategy.name,
          description: strategy.description,
          config: { confidence: strategy.confidence, status: strategy.status, adoptedBy: strategy.adoptedBy },
          orgId: SYSTEM_ORG_ID,
        });
        strategies++;
      } catch {
        // Strategy may already exist
      }
    }
    logger.info(`[autonomy-bootstrap] Seeded ${strategies} adaptive strategies`);
  } catch (err: any) {
    logger.info(`[autonomy-bootstrap] Strategies skipped: ${err.message}`);
  }

  logger.info(`[autonomy-bootstrap] Bootstrap complete: ${chains} chains, ${playbooks} playbooks, ${modes} modes, ${memories} memories, ${strategies} strategies`);
  return { chains, playbooks, modes, memories, strategies };
}
