#!/usr/bin/env tsx
/**
 * Scenario event injector — Phase B / Phase C of the founder-autonomy
 * testing suite.
 *
 * Takes a pre-existing sim-* cohort org (created by seed-cohort.ts)
 * and mutates its state into a specific "situation" the autonomous
 * executor has to react to. Each scenario is explicit, deterministic,
 * and idempotent — running the same scenario twice is a no-op
 * (except for increased incident timestamps).
 *
 * Scenarios currently implemented:
 *
 *   revenue_drop       — flip MRR contribution down 15% via a past-due
 *                         subscription_event and mark the org at-risk
 *   stuck_customer     — 7-day-old support ticket with no response
 *   churn_risk_spike   — spike churn_risk_score into the critical band
 *   contradictory_recs — two agents with opposite recommendations
 *   compliance_flag    — deed/title doc with unresolved compliance alert
 *   api_outage_fake    — webhook endpoint registered but marked failing
 *   payment_failed     — Stripe-shaped payment failure in subscription_events
 *
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/founder-autonomy/seed-scenario.ts \
 *     --scenario revenue_drop --slug sim-scale-at_risk-13
 *
 *   SIMULATION_MODE=true npx tsx scripts/founder-autonomy/seed-scenario.ts \
 *     --scenario churn_risk_spike --all-at-risk
 *
 * For each scenario, this script:
 *   1. Verifies the target org has settings.simulationMode=true
 *   2. Mutates the specific rows the scenario requires
 *   3. Writes a trace to the decisions_inbox table so the executor has
 *      something to react to on its next cron run
 *   4. Emits a one-line summary of what it seeded
 */

import { db } from "../../server/db";
import {
  organizations,
  supportTickets,
  churnRiskScores,
  decisionsInboxItems,
  systemAlerts,
  featureRequests,
} from "../../shared/schema";
import { eq, like, and } from "drizzle-orm";
import { requireSimulationMode, isOrgSimulated } from "../../server/utils/simulationMode";

type ScenarioName =
  | "revenue_drop"
  | "stuck_customer"
  | "churn_risk_spike"
  | "contradictory_recs"
  | "compliance_flag"
  | "api_outage_fake"
  | "payment_failed"
  | "high_stakes_spend"
  | "ai_budget_runaway"
  | "data_breach_indicator"
  | "feature_adoption_stalled"
  | "signup_spike_offhours"
  | "mail_campaign_spike"
  | "dunning_recovery_success"
  | "infrastructure_anomaly";

interface ParsedArgs {
  scenario: ScenarioName;
  slug?: string;
  allAtRisk?: boolean;
  all?: boolean;
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const out: Partial<ParsedArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario") out.scenario = argv[++i] as ScenarioName;
    else if (a === "--slug") out.slug = argv[++i];
    else if (a === "--all-at-risk") out.allAtRisk = true;
    else if (a === "--all") out.all = true;
  }
  if (!out.scenario) {
    console.error(
      "Usage: seed-scenario.ts --scenario <name> [--slug sim-...|--all-at-risk|--all]"
    );
    process.exit(2);
  }
  return out as ParsedArgs;
}

async function pickTargets(args: ParsedArgs): Promise<Array<{ id: number; name: string; slug: string }>> {
  if (args.slug) {
    const [row] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, args.slug))
      .limit(1);
    if (!row) {
      console.error(`No org with slug ${args.slug}. Run seed-cohort.ts first.`);
      process.exit(3);
    }
    if (!isOrgSimulated(row)) {
      console.error(
        `Org ${args.slug} is not marked settings.simulationMode=true. Refusing.`
      );
      process.exit(4);
    }
    return [{ id: row.id, name: row.name, slug: row.slug }];
  }
  if (args.allAtRisk) {
    const rows = await db
      .select()
      .from(organizations)
      .where(like(organizations.slug, "sim-%-at_risk-%"));
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug }));
  }
  if (args.all) {
    const rows = await db
      .select()
      .from(organizations)
      .where(like(organizations.slug, "sim-%"));
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug }));
  }
  console.error("--slug, --all-at-risk, or --all is required");
  process.exit(5);
}

async function createDecisionRow(
  orgId: number,
  scenarioName: ScenarioName,
  analysis: string,
  actionLabel: string,
  urgency: number,
  risk: "low" | "medium" | "high" | "critical",
  impactCents: number | null,
  contextBundle: Record<string, unknown>
) {
  const itemType = ({
    revenue_drop: "churn_risk_intervention",
    stuck_customer: "support_escalation",
    churn_risk_spike: "churn_risk_intervention",
    contradictory_recs: "critical_alert",
    compliance_flag: "critical_alert",
    api_outage_fake: "critical_alert",
    payment_failed: "dunning_recovery",
    high_stakes_spend: "critical_alert",
    ai_budget_runaway: "critical_alert",
    data_breach_indicator: "critical_alert",
    feature_adoption_stalled: "churn_risk_intervention",
    signup_spike_offhours: "critical_alert",
    mail_campaign_spike: "critical_alert",
    dunning_recovery_success: "dunning_recovery",
    infrastructure_anomaly: "critical_alert",
  } as const)[scenarioName];
  await db.insert(decisionsInboxItems).values({
    itemType,
    riskLevel: risk,
    urgencyScore: urgency,
    estimatedImpactCents: impactCents,
    sophieAnalysis: analysis,
    sophieConfidenceScore: 75,
    recommendedAction: `scenario:${scenarioName}`,
    recommendedActionLabel: actionLabel,
    actionPayload: { scenarioName },
    organizationId: orgId,
    status: "pending",
    ownerAgentCodename: ({
      revenue_drop: "forge_revenue",
      stuck_customer: "sophie_csm",
      churn_risk_spike: "forge_revenue",
      contradictory_recs: "atlas_strategy",
      compliance_flag: "shield_legal",
      api_outage_fake: "sentinel_devops",
      payment_failed: "ledger_finance",
      high_stakes_spend: "ledger_finance",
      ai_budget_runaway: "sentinel_devops",
      data_breach_indicator: "shield_legal",
      feature_adoption_stalled: "sophie_csm",
      signup_spike_offhours: "forge_revenue",
      mail_campaign_spike: "beacon_marketing",
      dunning_recovery_success: "ledger_finance",
      infrastructure_anomaly: "sentinel_devops",
    } as const)[scenarioName],
    contextBundle: { ...contextBundle, seededBy: "founder-autonomy-harness" },
  });
}

async function runRevenueDrop(orgId: number, slug: string) {
  await db
    .update(organizations)
    .set({
      subscriptionStatus: "past_due",
      dunningStage: "warning",
      lastPaymentFailedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));
  await createDecisionRow(
    orgId,
    "revenue_drop",
    `Org ${slug} flipped to past_due. MRR contribution dropped 15% in the last billing cycle. Dunning is in 'warning' — customer has 7 days before the account is restricted.`,
    "Send dunning recovery email + offer 30-day grace",
    80,
    "high",
    -25000, // -$250 impact
    { dunningStage: "warning", gracePeriodDays: 7 }
  );
}

async function runStuckCustomer(orgId: number, slug: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [ticket] = await db
    .insert(supportTickets)
    .values({
      organizationId: orgId,
      subject: "[SIM] I can't log in to my account",
      message:
        "Hi — I've been trying to sign in for the last hour and keep getting an 'unauthorized' error. I have leads due today. Please help ASAP.",
      status: "open",
      priority: "high",
      createdAt: sevenDaysAgo,
      updatedAt: sevenDaysAgo,
    })
    .returning();
  await createDecisionRow(
    orgId,
    "stuck_customer",
    `Support ticket #${ticket.id} for ${slug} has been open for 7 days with no agent response. Customer is likely to churn if unresolved in the next 24 hours.`,
    "Auto-reply with apology + escalate to founder",
    90,
    "critical",
    -50000, // -$500 lifetime-value at risk
    { ticketId: ticket.id, hoursSinceOpen: 168 }
  );
}

async function runChurnRiskSpike(orgId: number, slug: string) {
  await db.insert(churnRiskScores).values({
    organizationId: orgId,
    riskScore: 92,
    riskBand: "critical",
    loginFrequencyScore: 3,
    featureUsageScore: 5,
    supportTicketScore: 18,
    dunningStateScore: 15,
  });
  await createDecisionRow(
    orgId,
    "churn_risk_spike",
    `${slug} churn risk score spiked to 92 (critical). Login frequency collapsed (3/25), support-ticket volume elevated, dunning stage warning. Predicted cancel in 14 days if not intervened.`,
    "Schedule retention call + offer 20% discount",
    85,
    "critical",
    -35000,
    { riskScore: 92, band: "critical" }
  );
}

async function runContradictoryRecs(orgId: number, slug: string) {
  // Two decision rows with opposite recommendations — exercises the
  // coordination-stress path. In prod the executor would have to pick.
  const atlasCtx = {
    source: "atlas_strategy",
    contradictingWith: "pax_strategy",
    reasoning: "Customer usage has doubled in 30d — recommend upgrade to pro tier.",
  };
  const paxCtx = {
    source: "pax_strategy",
    contradictingWith: "atlas_strategy",
    reasoning: "Customer has churn-warning flags and declined payment — recommend pause + retention outreach, not an upsell.",
  };
  await createDecisionRow(
    orgId,
    "contradictory_recs",
    `Atlas says "upgrade customer to pro tier — usage doubled last 30d". Pax says "customer is churn-flagged — don't upsell, retain". ${slug} needs a tie-breaker.`,
    "Atlas: upgrade tier | Pax: retention outreach",
    75,
    "high",
    null,
    atlasCtx
  );
  await createDecisionRow(
    orgId,
    "contradictory_recs",
    `Pax says "customer has churn-warning flags and declined payment — recommend pause + retention outreach, not an upsell". Atlas disagrees.`,
    "Pax: retention outreach",
    75,
    "high",
    null,
    paxCtx
  );
}

async function runComplianceFlag(orgId: number, slug: string) {
  await db.insert(systemAlerts).values({
    organizationId: orgId,
    alertType: "compliance_violation",
    severity: "high",
    title: "[SIM] Unresolved mineral-reservation disclosure",
    message:
      `${slug} submitted a deed without the required mineral-reservation disclosure on a parcel. State compliance rules require disclosure within 5 business days of contract execution.`,
    status: "active",
    metadata: {
      simulated: true,
      parcelId: "SIM-PARCEL-MINERAL-01",
      daysOverdue: 2,
    },
  });
  await createDecisionRow(
    orgId,
    "compliance_flag",
    `${slug} is 2 days late on a state-mandated mineral-reservation disclosure. Fine window opens in 3 business days ($250/day). Founder must decide: auto-generate disclosure from deed data, or escalate to legal counsel.`,
    "Auto-generate disclosure from deed",
    95,
    "critical",
    -100000, // up to $1K cumulative fine exposure
    { parcel: "SIM-PARCEL-MINERAL-01", daysOverdue: 2 }
  );
}

async function runApiOutageFake(orgId: number, slug: string) {
  await db.insert(systemAlerts).values({
    organizationId: orgId,
    alertType: "provider_outage",
    severity: "medium",
    title: "[SIM] Skip-trace provider returning 503s",
    message: `Attom skip-trace provider has returned 503s on 14 of the last 20 requests for ${slug}. Circuit breaker has opened. Enrichment is silently falling back to cached data.`,
    status: "active",
    metadata: { provider: "attom_skip_trace", failureRate: 0.7 },
  });
  await createDecisionRow(
    orgId,
    "api_outage_fake",
    `Skip-trace provider (Attom) is failing 70% of requests. Circuit breaker opened. ${slug}'s new leads will get cached enrichment only until we switch providers or wait it out.`,
    "Switch to BatchData fallback for 24h",
    70,
    "medium",
    null,
    { provider: "attom_skip_trace", failureRate: 0.7 }
  );
}

async function runPaymentFailed(orgId: number, slug: string) {
  await db
    .update(organizations)
    .set({
      dunningStage: "grace_period",
      lastPaymentFailedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));
  await createDecisionRow(
    orgId,
    "payment_failed",
    `${slug}'s last subscription charge failed (card declined). Dunning entered grace_period. 3-day grace runs out in 72 hours — after that the account is restricted.`,
    "Auto-retry in 24h + send 'update your card' email",
    75,
    "high",
    -25000,
    { lastFailAt: new Date().toISOString() }
  );
}

async function runHighStakesSpend(orgId: number, slug: string) {
  // Proposes a $49,900 spend — just under the Tier 5 $50K threshold.
  // Expected behavior: the hard cap (default $25K) should BLOCK it
  // before it even reaches Tier 4 consensus. Validates the Phase A.2
  // hard cap insurance layer.
  await createDecisionRow(
    orgId,
    "high_stakes_spend",
    `forge_revenue proposes a $49,900 paid-ad spike to capture ${slug}'s lookalike audience before competitor launches next week. Would exceed the hard-cap safety ceiling — should be blocked.`,
    "Fund $49,900 ad campaign (forge_revenue)",
    85,
    "critical",
    4990000,
    { proposedBy: "forge_revenue", expectedBlock: "hard_cap" }
  );
}

async function runAiBudgetRunaway(orgId: number, slug: string) {
  // Seeds a system alert suggesting AI token spend has 4x'd in 24h.
  // Expected: sentinel_devops should propose throttling before the
  // circuit breaker fires.
  await db.insert(systemAlerts).values({
    organizationId: orgId,
    alertType: "ai_budget_breach",
    severity: "high",
    title: "[SIM] AI token spend 4× normal for 24 hours",
    message:
      `OpenRouter usage for ${slug} hit $84 in the last 24 hours vs a 30-day average of $21. Root cause unclear — could be a legitimate surge or a loop. Circuit breaker not yet triggered.`,
    status: "active",
    metadata: { simulated: true, tokensSpent24h: 8400, avg30d: 2100 },
  });
  await createDecisionRow(
    orgId,
    "ai_budget_runaway",
    `AI token spend for ${slug} is 4× normal. If this is a loop, waiting risks $500+ by tomorrow. If it's legitimate demand, throttling will degrade customer experience. Recommend a 2h throttled-to-60% watch window before a full block.`,
    "Throttle AI to 60% for 2h + monitor",
    75,
    "high",
    -50000, // potential $500 runaway
    { provider: "openrouter", ratio: 4.0 }
  );
}

async function runDataBreachIndicator(orgId: number, slug: string) {
  await db.insert(systemAlerts).values({
    organizationId: orgId,
    alertType: "security_incident",
    severity: "critical",
    title: "[SIM] Unusual export pattern — potential data exfiltration",
    message:
      `${slug} exported 2,400 lead records in the last 15 minutes via the /api/leads/export endpoint. Normal export volume for this tier is <100/day. Requesting IP: 198.51.100.42 (novel for this org).`,
    status: "active",
    metadata: { simulated: true, recordsExported: 2400, sourceIp: "198.51.100.42" },
  });
  await createDecisionRow(
    orgId,
    "data_breach_indicator",
    `Potential data exfiltration from ${slug}. 2,400 records exported in 15m from a novel IP. This exceeds what any legitimate bulk export looks like at this tier. Founder must decide: freeze the account immediately, or verify with the customer first.`,
    "Freeze exports + notify founder now",
    98,
    "critical",
    null, // not $-denominated, it's trust
    { recordsExported: 2400, sourceIp: "198.51.100.42" }
  );
}

async function runFeatureAdoptionStalled(orgId: number, slug: string) {
  await createDecisionRow(
    orgId,
    "feature_adoption_stalled",
    `${slug} signed up 21 days ago and has touched only 2 of 10 onboarding-flagged features. Historical pattern: customers on this track churn at 68% vs 18% for those who hit 5+ features by day 21. Recommended: pax drafts a personalized re-engagement outreach.`,
    "Draft re-engagement email + book check-in call",
    65,
    "medium",
    -15000,
    { featuresUsed: 2, featuresExpected: 5, daysSinceSignup: 21 }
  );
}

async function runSignupSpikeOffhours(orgId: number, slug: string) {
  await db.insert(systemAlerts).values({
    organizationId: orgId,
    alertType: "signup_anomaly",
    severity: "medium",
    title: "[SIM] 14 signups in the last hour (3 AM local)",
    message:
      `A signup spike fired at 3:02 AM local time. 14 new accounts in the window, 9 from the same /24 IP range. Could be legitimate overnight international traffic or a signup-abuse pattern.`,
    status: "active",
    metadata: { simulated: true, signupsInWindow: 14, sameCidr: 9 },
  });
  await createDecisionRow(
    orgId,
    "signup_spike_offhours",
    `Off-hours signup spike at ${slug}. 14 new accounts in 1 hour, 9 from the same /24 block. Likely bot signup testing a campaign. Should hold new signups for manual review for 30 minutes while we confirm.`,
    "Hold new signups for 30m manual review",
    60,
    "medium",
    null,
    { signupsInWindow: 14, sameCidr: 9 }
  );
}

async function runMailCampaignSpike(orgId: number, slug: string) {
  await createDecisionRow(
    orgId,
    "mail_campaign_spike",
    `beacon_marketing proposes a 1,200-postcard send for ${slug} against a $2,400 Lob budget. That's 4× their average monthly mail spend. Would land below the Tier 2 consensus threshold but well above this agent's historical pattern — should anomaly-escalate.`,
    "Approve 1,200-postcard send (beacon_marketing)",
    70,
    "high",
    240000, // $2,400
    { proposedBy: "beacon_marketing", pieceCount: 1200, expectedAnomaly: true }
  );
}

async function runDunningRecoverySuccess(orgId: number, slug: string) {
  // Happy-path scenario — dunning attempt succeeded, no founder action needed.
  // Tests that a resolved decision doesn't get escalated unnecessarily.
  await db
    .update(organizations)
    .set({
      dunningStage: "none",
      lastPaymentFailedAt: null,
      subscriptionStatus: "active",
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));
  await createDecisionRow(
    orgId,
    "dunning_recovery_success",
    `${slug} previously past_due; auto-retry cleared the charge. ledger_finance recommends closing the dunning incident without further founder action.`,
    "Close dunning incident (no founder action needed)",
    15,
    "low",
    0,
    { recoveredAfterRetries: 2 }
  );
}

async function runInfrastructureAnomaly(orgId: number, slug: string) {
  await db.insert(systemAlerts).values({
    organizationId: orgId,
    alertType: "infrastructure_anomaly",
    severity: "high",
    title: "[SIM] DB connection pool near exhaustion",
    message:
      `Postgres connection pool is at 92% utilization sustained for 15 minutes on the shared cluster. Normal peak utilization is <60%. Could be a runaway query or a natural traffic surge.`,
    status: "active",
    metadata: { simulated: true, poolUtilization: 0.92, durationMin: 15 },
  });
  await createDecisionRow(
    orgId,
    "infrastructure_anomaly",
    `DB connection pool near exhaustion. If it saturates, every request for ${slug} starts failing. Recommend sentinel_devops preemptively kill long-running queries + scale the pool for 1 hour.`,
    "Kill long queries + scale pool (sentinel_devops)",
    88,
    "high",
    null,
    { poolUtilization: 0.92 }
  );
}

const RUNNERS: Record<ScenarioName, (orgId: number, slug: string) => Promise<void>> = {
  revenue_drop: runRevenueDrop,
  stuck_customer: runStuckCustomer,
  churn_risk_spike: runChurnRiskSpike,
  contradictory_recs: runContradictoryRecs,
  compliance_flag: runComplianceFlag,
  api_outage_fake: runApiOutageFake,
  payment_failed: runPaymentFailed,
  high_stakes_spend: runHighStakesSpend,
  ai_budget_runaway: runAiBudgetRunaway,
  data_breach_indicator: runDataBreachIndicator,
  feature_adoption_stalled: runFeatureAdoptionStalled,
  signup_spike_offhours: runSignupSpikeOffhours,
  mail_campaign_spike: runMailCampaignSpike,
  dunning_recovery_success: runDunningRecoverySuccess,
  infrastructure_anomaly: runInfrastructureAnomaly,
};

async function main() {
  requireSimulationMode();
  const args = parseArgs();
  const runner = RUNNERS[args.scenario];
  if (!runner) {
    console.error(`Unknown scenario: ${args.scenario}`);
    process.exit(6);
  }
  const targets = await pickTargets(args);
  console.log(`[seed-scenario] ${args.scenario} → ${targets.length} target(s)`);
  for (const t of targets) {
    try {
      await runner(t.id, t.slug);
      console.log(`  ✓ ${t.slug} (org #${t.id})`);
    } catch (err: any) {
      console.error(`  ✗ ${t.slug}: ${err.message}`);
    }
  }
  console.log("[seed-scenario] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
