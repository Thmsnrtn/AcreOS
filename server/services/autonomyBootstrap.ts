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

// (1. Default reaction chains DELETED 2026-08-29, stage-4 turn 16 — see the
// v14 router tombstone; nothing consumed the chains a boot re-seeded.)

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

// (DEFAULT_MEMORIES deleted 2026-08-29 with its seeding — stage-4 turn 17.)

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

  // (Reaction-chain seeding removed 2026-08-29 — stage-4 turn 16.)

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

  // (4. Cognitive-memory seeding removed 2026-08-29 — stage-4 turn 17: the
  // V13 store is drained; the canonical corpus is seeded by real learnings,
  // not boot defaults.)

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
