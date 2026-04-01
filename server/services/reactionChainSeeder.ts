/**
 * Reaction Chain Seeder — Pre-built agent reaction chains for the full business lifecycle.
 * Idempotent: skips chains that already exist by name.
 */

import { db } from "../db";
import { reactionChains } from "@shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";

interface ChainStep {
  agent: string;
  action: string;
  params: Record<string, any>;
  condition?: string;
  delayMs?: number;
}

interface ChainDef {
  name: string;
  description: string;
  triggerEvent: string;
  steps: ChainStep[];
  priority?: number;
  cooldownMs?: number;
  escalateToFounder?: boolean;
  escalateCondition?: string;
}

const CHAIN_DEFINITIONS: ChainDef[] = [
  // ── User Lifecycle ──
  {
    name: "user_welcome",
    description: "Welcome sequence for new signups: email, activation baseline, session tracking",
    triggerEvent: "user.signed_up",
    steps: [
      { agent: "sophie_csm", action: "send_retention_email", params: { templateType: "welcome" } },
      { agent: "compass_pm", action: "create_feature_request", params: { title: "Log activation baseline", source: "reaction" } },
      { agent: "oracle_analytics", action: "generate_trend_report", params: {} },
    ],
  },
  {
    name: "trial_midpoint_check",
    description: "Day 7: check activation, send walkthrough if stuck, nudge if active",
    triggerEvent: "user.trial_day_7",
    steps: [
      { agent: "oracle_analytics", action: "generate_trend_report", params: {} },
      { agent: "sophie_csm", action: "send_guided_walkthrough", params: { stuckFeature: "deals", condition: "activation_score_low" } },
      { agent: "forge_revenue", action: "send_upgrade_nudge", params: { reason: "high_activation", condition: "activation_score_high" } },
    ],
  },
  {
    name: "trial_expiring",
    description: "Day 12: urgently nudge upgrade before trial ends",
    triggerEvent: "user.trial_day_12",
    steps: [
      { agent: "forge_revenue", action: "send_upgrade_nudge", params: { reason: "trial_ending_soon" } },
    ],
    priority: 70,
  },
  {
    name: "trial_expired",
    description: "Trial ended: send final upgrade nudge and retention email",
    triggerEvent: "user.trial_expired",
    steps: [
      { agent: "forge_revenue", action: "send_upgrade_nudge", params: { reason: "trial_ended" } },
      { agent: "sophie_csm", action: "send_retention_email", params: { templateType: "trial_expired" } },
    ],
    priority: 80,
  },
  {
    name: "user_upgraded",
    description: "Celebrate upgrade: welcome, log MRR, queue testimonial request",
    triggerEvent: "user.upgraded",
    steps: [
      { agent: "sophie_csm", action: "send_retention_email", params: { templateType: "upgrade_welcome" } },
      { agent: "forge_revenue", action: "send_churn_rescue", params: {} }, // logs MRR event
      { agent: "oracle_analytics", action: "generate_trend_report", params: {} },
    ],
  },
  {
    name: "churn_signal",
    description: "Churn risk detected: retention email, unlock feature, offer discount if all else fails",
    triggerEvent: "user.churn_signal",
    steps: [
      { agent: "sophie_csm", action: "send_retention_email", params: { templateType: "we_miss_you" } },
      { agent: "sophie_csm", action: "unlock_feature_temporarily", params: { feature: "deal_feed", durationDays: 7 }, delayMs: 48 * 60 * 60 * 1000 },
      { agent: "forge_revenue", action: "apply_discount", params: { percentOff: 20, durationMonths: 3, condition: "all_steps_failed" }, delayMs: 120 * 60 * 60 * 1000 },
    ],
    escalateToFounder: true,
    escalateCondition: "all_steps_failed",
    priority: 90,
  },
  // ── Deal Lifecycle ──
  {
    name: "deal_closed_won",
    description: "Deal closed: log revenue, update market intel, request case study",
    triggerEvent: "deal.closed_won",
    steps: [
      { agent: "forge_revenue", action: "send_churn_rescue", params: {} },
      { agent: "oracle_analytics", action: "generate_trend_report", params: {} },
      { agent: "sophie_csm", action: "send_retention_email", params: { templateType: "congratulations" } },
    ],
  },
  {
    name: "deal_stalled",
    description: "Deal stalled 7 days: walkthrough, check UX friction, create issue if likely bug",
    triggerEvent: "deal.stalled_7_days",
    steps: [
      { agent: "sophie_csm", action: "send_guided_walkthrough", params: { stuckFeature: "deals" } },
      { agent: "compass_pm", action: "create_feature_request", params: { title: "Check UX friction for stalled deals", source: "reaction" } },
      { agent: "atlas_cto", action: "create_issue", params: { title: "Investigate stalled deal pattern", severity: "medium", condition: "likely_bug" } },
    ],
  },
  // ── Platform Health ──
  {
    name: "data_source_down",
    description: "Data source outage: log, disable source, notify affected users after 60min",
    triggerEvent: "data_source.down",
    steps: [
      { agent: "sentinel_devops", action: "restart_failed_job", params: {} },
      { agent: "sentinel_devops", action: "toggle_data_source", params: { enabled: false }, delayMs: 5 * 60 * 1000 },
      { agent: "sophie_csm", action: "send_retention_email", params: { templateType: "service_update" }, delayMs: 60 * 60 * 1000 },
    ],
    priority: 95,
  },
  {
    name: "error_rate_spike",
    description: "Error rate spike: investigate deploys, create issue, escalate to founder",
    triggerEvent: "system.error_rate_spike",
    steps: [
      { agent: "sentinel_devops", action: "restart_failed_job", params: {} },
      { agent: "atlas_cto", action: "create_issue", params: { title: "Error rate spike detected", severity: "high" } },
    ],
    escalateToFounder: true,
    escalateCondition: "always",
    priority: 99,
  },
  {
    name: "ai_cost_spike",
    description: "AI cost anomaly: flag, trace to endpoint, check for loops",
    triggerEvent: "system.ai_cost_spike",
    steps: [
      { agent: "ledger_finance", action: "flag_anomaly", params: { anomalyType: "ai_cost_spike" } },
      { agent: "oracle_analytics", action: "flag_metric_anomaly", params: { metric: "ai_cost", severity: "warning" } },
      { agent: "atlas_cto", action: "create_issue", params: { title: "AI cost spike — check for loops", severity: "high" } },
    ],
    escalateToFounder: true,
    escalateCondition: "unresolved_30_minutes",
    priority: 85,
  },
  // ── Growth ──
  {
    name: "content_published",
    description: "Content published: monitor performance, track attribution",
    triggerEvent: "content.published",
    steps: [
      { agent: "oracle_analytics", action: "generate_trend_report", params: {} },
    ],
  },
  {
    name: "referral_signup",
    description: "Referral signup: welcome with referral context, track activation",
    triggerEvent: "referral.signup",
    steps: [
      { agent: "sophie_csm", action: "send_retention_email", params: { templateType: "referral_welcome" } },
      { agent: "oracle_analytics", action: "generate_trend_report", params: {} },
    ],
  },
  // ── Governance ──
  {
    name: "agent_action_flagged",
    description: "Governance flag: review and potentially reverse the action",
    triggerEvent: "governance.action_flagged",
    steps: [
      { agent: "shield_legal", action: "run_compliance_check", params: { checkType: "flagged_action_review" } },
      { agent: "shield_legal", action: "flag_compliance_issue", params: { issueType: "policy_violation", condition: "confirmed" } },
    ],
    escalateToFounder: true,
    escalateCondition: "always",
    priority: 95,
  },
  {
    name: "agent_disagreement",
    description: "Two agents disagree: Oracle mediates with data, escalate to founder",
    triggerEvent: "agents.disagreement",
    steps: [
      { agent: "oracle_analytics", action: "generate_trend_report", params: {} },
    ],
    escalateToFounder: true,
    escalateCondition: "always",
    priority: 80,
  },
];

export async function seedReactionChains(): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;

  for (const def of CHAIN_DEFINITIONS) {
    try {
      const existing = await db.select({ id: reactionChains.id })
        .from(reactionChains)
        .where(eq(reactionChains.name, def.name))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(reactionChains).values({
        chainId: uuidv4(),
        name: def.name,
        description: def.description,
        triggerEventType: def.triggerEvent,
        triggerConditions: def.escalateToFounder
          ? { escalateToFounder: true, escalateCondition: def.escalateCondition }
          : {},
        steps: def.steps,
        enabled: true,
        priority: def.priority || 50,
        maxConcurrentRuns: 5,
        cooldownMs: def.cooldownMs || 0,
      });

      seeded++;
    } catch (err) {
      logger.error(`[ReactionChainSeeder] Failed to seed chain "${def.name}"`, err);
    }
  }

  return { seeded, skipped };
}
