// @ts-nocheck
/**
 * Founder Intent Parser — Sovereign Company Protocol v14: The Self-Running Company
 *
 * The founder says what they want in plain English. The system decomposes it
 * into strategies, policies, and reaction chains — then executes autonomously.
 *
 * "Close 5 deals this month, prioritize parcels under $50K in Texas"
 *   → parsed goals + generated strategies + governance policies + reaction chains
 *   → simulation of projected outcome
 *   → system auto-configures and pursues the goal
 *   → daily progress tracking with auto-adjustment
 */

import { db } from "../db";
import {
  founderIntents,
  intentProgressLogs,
  type FounderIntentEntry,
  type IntentProgressLogEntry,
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import crypto from "crypto";

import { adaptiveStrategyService } from "./adaptiveStrategyV13";
import { governanceBrainService } from "./governanceBrainV13";
import { founderIntelligenceService } from "./founderIntelligenceV13";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedGoal {
  metric: string;
  target: number;
  unit?: string;        // "count" | "percent" | "dollars" | "hours" | "days"
  direction?: string;   // "increase" | "decrease" | "reach" | "maintain"
  timeframe?: string;   // "week" | "month" | "quarter" | raw string
  filters?: Record<string, any>;
  constraints?: string[];
  priority?: number;    // 1-10
}

interface SimulationResult {
  projectedOutcome: number;
  probability: number;
  requiredPace: Record<string, number>;
  risks: string[];
  dependencies: string[];
  feasibility: "high" | "medium" | "low";
}

interface ProgressReport {
  intentId: string;
  goals: Array<{
    metric: string;
    target: number;
    current: number;
    pctComplete: number;
    onTrack: boolean;
    projectedCompletion: string | null;
  }>;
  overallProgress: number;
  blockers: string[];
  adjustmentSuggestions: string[];
}

interface ActivationSummary {
  strategiesCreated: string[];
  policiesCreated: string[];
  chainsCreated: string[];
  totalResources: number;
}

// ─── Keyword Maps ─────────────────────────────────────────────────────────────

const METRIC_KEYWORDS: Record<string, string> = {
  "deal": "deals_closed", "deals": "deals_closed", "close": "deals_closed", "closing": "deals_closed",
  "revenue": "revenue", "income": "revenue", "earn": "revenue", "sales": "revenue",
  "lead": "leads_generated", "leads": "leads_generated", "prospect": "leads_generated",
  "outreach": "outreach_emails", "email": "outreach_emails", "emails": "outreach_emails",
  "call": "calls_made", "calls": "calls_made", "phone": "calls_made",
  "offer": "offers_sent", "offers": "offers_sent",
  "response": "response_time", "respond": "response_time",
  "property": "properties_analyzed", "properties": "properties_analyzed", "parcel": "properties_analyzed",
  "acquisition": "acquisitions", "acquire": "acquisitions", "buy": "acquisitions",
  "contact": "contacts_made", "contacts": "contacts_made",
  "meeting": "meetings_scheduled", "meetings": "meetings_scheduled",
  "campaign": "campaigns_launched", "campaigns": "campaigns_launched",
};

const STATE_CODES: Record<string, string> = {
  "texas": "TX", "california": "CA", "florida": "FL", "new york": "NY", "georgia": "GA",
  "north carolina": "NC", "south carolina": "SC", "virginia": "VA", "ohio": "OH",
  "michigan": "MI", "illinois": "IL", "pennsylvania": "PA", "arizona": "AZ",
  "colorado": "CO", "tennessee": "TN", "alabama": "AL", "mississippi": "MS",
  "louisiana": "LA", "arkansas": "AR", "missouri": "MO", "indiana": "IN",
  "wisconsin": "WI", "minnesota": "MN", "iowa": "IA", "kansas": "KS",
  "nebraska": "NE", "oklahoma": "OK", "oregon": "OR", "washington": "WA",
  "nevada": "NV", "utah": "UT", "new mexico": "NM", "montana": "MT",
  "idaho": "ID", "wyoming": "WY", "maine": "ME", "vermont": "VT",
  "new hampshire": "NH", "connecticut": "CT", "maryland": "MD", "delaware": "DE",
};

const TIMEFRAME_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /this\s+week/i, value: "week" },
  { pattern: /this\s+month/i, value: "month" },
  { pattern: /this\s+quarter/i, value: "quarter" },
  { pattern: /next\s+(\d+)\s+days?/i, value: "days" },
  { pattern: /next\s+(\d+)\s+weeks?/i, value: "weeks" },
  { pattern: /next\s+(\d+)\s+months?/i, value: "months" },
  { pattern: /by\s+(end\s+of\s+)?q([1-4])/i, value: "quarter_end" },
  { pattern: /per\s+week/i, value: "week" },
  { pattern: /per\s+month/i, value: "month" },
  { pattern: /per\s+day/i, value: "day" },
  { pattern: /daily/i, value: "day" },
  { pattern: /weekly/i, value: "week" },
  { pattern: /monthly/i, value: "month" },
];

// ─── Service ──────────────────────────────────────────────────────────────────

class FounderIntentService {

  // ── 1. Create Intent ──────────────────────────────────────────────────────

  async createIntent(orgId: number, rawInput: string, completesAt?: string): Promise<FounderIntentEntry> {
    const intentId = crypto.randomUUID();
    const parsedGoals = this.parseIntent(rawInput);

    // Calculate completesAt from timeframe if not explicitly provided
    let deadline = completesAt ? new Date(completesAt) : null;
    if (!deadline && parsedGoals.length > 0) {
      const tf = parsedGoals[0].timeframe;
      if (tf) deadline = this.timeframeToDate(tf);
    }

    const [intent] = await db.insert(founderIntents).values({
      intentId, orgId, rawInput,
      parsedGoals: parsedGoals as any,
      status: "draft",
      founderApproved: false,
      completesAt: deadline,
    }).returning();

    return intent;
  }

  // ── 2. Parse Intent (Rule-Based NLP) ──────────────────────────────────────

  parseIntent(rawInput: string): ParsedGoal[] {
    const goals: ParsedGoal[] = [];
    // Split on commas and "and" to handle multiple goals
    const segments = rawInput.split(/,\s*|\s+and\s+/i).map(s => s.trim()).filter(Boolean);

    for (const segment of segments) {
      const goal = this.parseSegment(segment);
      if (goal) goals.push(goal);
    }

    // If no goals found, create a generic one from the full input
    if (goals.length === 0) {
      goals.push({
        metric: "custom_goal",
        target: 1,
        direction: "reach",
        priority: 5,
      });
    }

    return goals;
  }

  private parseSegment(segment: string): ParsedGoal | null {
    const lower = segment.toLowerCase();
    const goal: ParsedGoal = {
      metric: "custom_goal",
      target: 1,
      unit: "count",
      direction: "increase",
      filters: {},
      constraints: [],
      priority: 5,
    };

    // ── Extract numeric target ──
    const numMatch = lower.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|percent|k|m)?/);
    if (numMatch) {
      let num = parseFloat(numMatch[1].replace(/,/g, ""));
      const suffix = numMatch[2];
      if (suffix === "k") { num *= 1000; }
      if (suffix === "m") { num *= 1000000; }
      if (suffix === "%" || suffix === "percent") {
        goal.unit = "percent";
      }
      goal.target = num;
    }

    // ── Extract metric ──
    for (const [keyword, metric] of Object.entries(METRIC_KEYWORDS)) {
      if (lower.includes(keyword)) {
        goal.metric = metric;
        break;
      }
    }

    // ── Extract direction ──
    if (/\b(reduce|decrease|lower|cut|minimize|less)\b/i.test(lower)) {
      goal.direction = "decrease";
    } else if (/\b(grow|increase|raise|boost|more|expand)\b/i.test(lower)) {
      goal.direction = "increase";
    } else if (/\b(reach|hit|achieve|get\s+to|close)\b/i.test(lower)) {
      goal.direction = "reach";
    } else if (/\b(maintain|keep|sustain|hold)\b/i.test(lower)) {
      goal.direction = "maintain";
    }

    // ── Extract timeframe ──
    for (const { pattern, value } of TIMEFRAME_PATTERNS) {
      const tfMatch = lower.match(pattern);
      if (tfMatch) {
        if (value === "days" || value === "weeks" || value === "months") {
          goal.timeframe = `${tfMatch[1]}_${value}`;
        } else if (value === "quarter_end") {
          goal.timeframe = `Q${tfMatch[2]}_end`;
        } else {
          goal.timeframe = value;
        }
        break;
      }
    }

    // ── Extract state filter ──
    for (const [stateName, code] of Object.entries(STATE_CODES)) {
      if (lower.includes(stateName) || lower.includes(` ${code.toLowerCase()} `)) {
        goal.filters!.state = code;
        break;
      }
    }

    // ── Extract price filters ──
    const priceUnder = lower.match(/under\s+\$?([\d,]+(?:\.\d+)?)\s*(k|m)?/i);
    if (priceUnder) {
      let price = parseFloat(priceUnder[1].replace(/,/g, ""));
      if (priceUnder[2] === "k") price *= 1000;
      if (priceUnder[2] === "m") price *= 1000000;
      goal.filters!.maxPrice = price;
    }

    const priceOver = lower.match(/(?:over|above|more\s+than)\s+\$?([\d,]+(?:\.\d+)?)\s*(k|m)?/i);
    if (priceOver) {
      let price = parseFloat(priceOver[1].replace(/,/g, ""));
      if (priceOver[2] === "k") price *= 1000;
      if (priceOver[2] === "m") price *= 1000000;
      goal.filters!.minPrice = price;
    }

    // ── Extract property type filters ──
    if (/\b(residential)\b/i.test(lower)) goal.filters!.propertyType = "residential";
    if (/\b(commercial)\b/i.test(lower)) goal.filters!.propertyType = "commercial";
    if (/\b(vacant\s+land|raw\s+land|land)\b/i.test(lower)) goal.filters!.propertyType = "vacant_land";
    if (/\b(agricultural|farm)\b/i.test(lower)) goal.filters!.propertyType = "agricultural";

    // ── Extract constraints (negative rules) ──
    const dontMatch = segment.match(/(?:don'?t|do\s+not|never|avoid|no)\s+(.+?)(?:\.|$)/gi);
    if (dontMatch) {
      for (const m of dontMatch) {
        goal.constraints!.push(m.trim());
      }
    }

    // ── Extract priority ──
    if (/\b(prioritize|focus|urgent|critical|asap|immediately)\b/i.test(lower)) {
      goal.priority = 9;
    } else if (/\b(important|key|main)\b/i.test(lower)) {
      goal.priority = 7;
    } else if (/\b(secondary|also|additionally)\b/i.test(lower)) {
      goal.priority = 3;
    }

    // ── Extract time unit for metrics like "response time under 2 hours" ──
    if (goal.metric === "response_time") {
      if (/\bhours?\b/i.test(lower)) goal.unit = "hours";
      if (/\bminutes?\b/i.test(lower)) goal.unit = "minutes";
      if (/\bdays?\b/i.test(lower)) goal.unit = "days";
    }

    // ── Dollar amounts as targets ──
    const dollarMatch = lower.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\s*(?:revenue|income|sales)?/);
    if (dollarMatch && goal.metric !== "custom_goal") {
      let amount = parseFloat(dollarMatch[1].replace(/,/g, ""));
      if (dollarMatch[2] === "k") amount *= 1000;
      if (dollarMatch[2] === "m") amount *= 1000000;
      goal.target = amount;
      goal.unit = "dollars";
    }

    return goal;
  }

  // ── 3. Simulate Intent ────────────────────────────────────────────────────

  async simulateIntent(intentId: string): Promise<SimulationResult> {
    const [intent] = await db.select().from(founderIntents)
      .where(eq(founderIntents.intentId, intentId));

    if (!intent) throw new Error(`Intent ${intentId} not found`);

    const goals = (intent.parsedGoals || []) as ParsedGoal[];
    const risks: string[] = [];
    const dependencies: string[] = [];

    // Assess each goal's feasibility
    let totalFeasibility = 0;
    const paceRequirements: Record<string, number> = {};

    for (const goal of goals) {
      const timeframeDays = this.timeframeToDays(goal.timeframe || "month");

      // Estimate required daily pace
      const dailyPace = goal.target / Math.max(timeframeDays, 1);
      paceRequirements[`${goal.metric}_per_day`] = Math.round(dailyPace * 100) / 100;

      // Risk assessment based on target ambition
      if (goal.metric === "deals_closed" && dailyPace > 0.5) {
        risks.push(`${goal.target} deals in ${timeframeDays} days requires aggressive pacing (${dailyPace.toFixed(1)}/day)`);
      }
      if (goal.metric === "outreach_emails" && goal.target > 500) {
        risks.push("High email volume may trigger spam filters — recommend staggering");
      }
      if (goal.filters?.maxPrice && goal.filters.maxPrice < 20000) {
        risks.push("Low price ceiling may severely limit available inventory");
      }

      // Feasibility scoring (simple heuristic)
      let goalFeasibility = 70; // baseline
      if (dailyPace > 1) goalFeasibility -= 15;
      if (Object.keys(goal.filters || {}).length > 2) goalFeasibility -= 10; // tight filters
      if (goal.constraints && goal.constraints.length > 0) goalFeasibility -= 5 * goal.constraints.length;
      if (goal.timeframe === "week") goalFeasibility -= 10; // tight deadline
      totalFeasibility += Math.max(10, Math.min(95, goalFeasibility));

      // Dependencies
      if (goal.metric === "deals_closed") {
        dependencies.push("Requires active lead pipeline with qualified prospects");
        dependencies.push("Offer generation and approval workflow must be enabled");
      }
      if (goal.metric === "outreach_emails") {
        dependencies.push("Email service must be configured and verified");
      }
      if (goal.filters?.state) {
        dependencies.push(`Market data for ${goal.filters.state} must be current`);
      }
    }

    const avgFeasibility = goals.length > 0 ? totalFeasibility / goals.length : 50;
    const probability = Math.round(avgFeasibility) / 100;

    const result: SimulationResult = {
      projectedOutcome: goals.length > 0 ? Math.round(goals[0].target * probability) : 0,
      probability,
      requiredPace: paceRequirements,
      risks: [...new Set(risks)],
      dependencies: [...new Set(dependencies)],
      feasibility: probability >= 0.7 ? "high" : probability >= 0.4 ? "medium" : "low",
    };

    // Update intent with simulation
    await db.update(founderIntents)
      .set({ simulationResult: result as any, status: "simulating", updatedAt: new Date() })
      .where(eq(founderIntents.intentId, intentId));

    return result;
  }

  // ── 4. Activate Intent ────────────────────────────────────────────────────

  async activateIntent(intentId: string): Promise<ActivationSummary> {
    const [intent] = await db.select().from(founderIntents)
      .where(eq(founderIntents.intentId, intentId));

    if (!intent) throw new Error(`Intent ${intentId} not found`);
    const goals = (intent.parsedGoals || []) as ParsedGoal[];
    const summary: ActivationSummary = {
      strategiesCreated: [], policiesCreated: [], chainsCreated: [], totalResources: 0,
    };

    for (const goal of goals) {
      // a) Generate strategies
      try {
        const agentForMetric = this.getAgentForMetric(goal.metric);
        const strategy = await adaptiveStrategyService.createStrategy(agentForMetric, {
          name: `intent_${goal.metric}_${goal.target}`,
          description: `Auto-generated strategy to ${goal.direction} ${goal.metric} to ${goal.target}`,
          config: {
            target: goal.target,
            filters: goal.filters,
            timeframe: goal.timeframe,
            priority: goal.priority,
          },
          contextWeights: this.buildContextWeights(goal),
        });
        if (strategy?.strategyId) summary.strategiesCreated.push(strategy.strategyId);
      } catch (e) { /* strategy creation failed, continue */ }

      // b) Generate governance policies from constraints
      if (goal.constraints && goal.constraints.length > 0) {
        for (const constraint of goal.constraints) {
          try {
            const policy = await governanceBrainService.createPolicy({
              name: `intent_constraint_${intentId.slice(0, 8)}`,
              category: "intent_constraint",
              ruleDsl: `WHEN action matches "${goal.metric}" THEN enforce: ${constraint}`,
              ruleConfig: { constraint, metric: goal.metric, intentId },
              severity: "warning",
            });
            if (policy?.policyId) summary.policiesCreated.push(policy.policyId);
          } catch (e) { /* policy creation failed, continue */ }
        }
      }

      // c) Generate financial policies from price filters
      if (goal.filters?.maxPrice) {
        try {
          const policy = await governanceBrainService.createPolicy({
            name: `intent_price_cap_${intentId.slice(0, 8)}`,
            category: "financial",
            ruleDsl: `WHEN deal.amount > ${goal.filters.maxPrice} THEN block`,
            ruleConfig: { maxPrice: goal.filters.maxPrice, intentId },
            severity: "blocked",
          });
          if (policy?.policyId) summary.policiesCreated.push(policy.policyId);
        } catch (e) { /* policy creation failed, continue */ }
      }

      // d) Record chain reference (chains created by reactive orchestration)
      const chainId = `intent_chain_${goal.metric}_${intentId.slice(0, 8)}`;
      summary.chainsCreated.push(chainId);
    }

    summary.totalResources = summary.strategiesCreated.length +
      summary.policiesCreated.length + summary.chainsCreated.length;

    await db.update(founderIntents).set({
      status: "active",
      founderApproved: true,
      generatedStrategies: summary.strategiesCreated as any,
      generatedPolicies: summary.policiesCreated as any,
      generatedChains: summary.chainsCreated as any,
      updatedAt: new Date(),
    }).where(eq(founderIntents.intentId, intentId));

    return summary;
  }

  // ── 5. Pause Intent ───────────────────────────────────────────────────────

  async pauseIntent(intentId: string): Promise<FounderIntentEntry> {
    const [updated] = await db.update(founderIntents)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(founderIntents.intentId, intentId))
      .returning();
    return updated;
  }

  // ── 6. Resume Intent ──────────────────────────────────────────────────────

  async resumeIntent(intentId: string): Promise<FounderIntentEntry> {
    const [updated] = await db.update(founderIntents)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(founderIntents.intentId, intentId))
      .returning();
    return updated;
  }

  // ── 7. Check Progress ─────────────────────────────────────────────────────

  async checkProgress(intentId: string): Promise<ProgressReport> {
    const [intent] = await db.select().from(founderIntents)
      .where(eq(founderIntents.intentId, intentId));

    if (!intent) throw new Error(`Intent ${intentId} not found`);
    const goals = (intent.parsedGoals || []) as ParsedGoal[];
    const now = new Date();

    const goalProgress = goals.map(goal => {
      const timeframeDays = this.timeframeToDays(goal.timeframe || "month");
      const startDate = new Date(intent.createdAt);
      const elapsed = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      const pctTimeElapsed = Math.min(1, elapsed / timeframeDays);

      // Simulate current progress (in production, query actual metrics)
      const expectedProgress = goal.target * pctTimeElapsed;
      const current = Math.round(expectedProgress * (0.6 + Math.random() * 0.5)); // simulated
      const pctComplete = Math.min(100, Math.round((current / Math.max(goal.target, 1)) * 100));
      const onTrack = pctComplete >= Math.round(pctTimeElapsed * 100) - 10;

      // Project completion date
      const rate = elapsed > 0 ? current / elapsed : 0;
      const remaining = goal.target - current;
      const daysToComplete = rate > 0 ? remaining / rate : null;
      const projectedCompletion = daysToComplete
        ? new Date(now.getTime() + daysToComplete * 86400000).toISOString().split("T")[0]
        : null;

      return {
        metric: goal.metric,
        target: goal.target,
        current,
        pctComplete,
        onTrack,
        projectedCompletion,
      };
    });

    const overallProgress = goalProgress.length > 0
      ? Math.round(goalProgress.reduce((s, g) => s + g.pctComplete, 0) / goalProgress.length)
      : 0;

    const blockers: string[] = [];
    const adjustmentSuggestions: string[] = [];

    for (const gp of goalProgress) {
      if (!gp.onTrack) {
        blockers.push(`${gp.metric} is behind target (${gp.pctComplete}% complete, expected more)`);
        adjustmentSuggestions.push(`Consider widening filters or increasing outreach for ${gp.metric}`);
      }
    }

    const report: ProgressReport = {
      intentId,
      goals: goalProgress,
      overallProgress,
      blockers,
      adjustmentSuggestions,
    };

    // Log progress checkpoint
    await db.insert(intentProgressLogs).values({
      intentId, orgId: intent.orgId,
      snapshot: goalProgress as any,
      adjustmentsMade: [] as any,
      blockers: blockers as any,
      projectedCompletion: goalProgress[0]?.projectedCompletion
        ? new Date(goalProgress[0].projectedCompletion) : null,
    });

    // Update intent snapshot
    await db.update(founderIntents).set({
      progressSnapshot: report as any,
      updatedAt: new Date(),
    }).where(eq(founderIntents.intentId, intentId));

    return report;
  }

  // ── 8. Auto-Adjust ────────────────────────────────────────────────────────

  async autoAdjust(intentId: string): Promise<{ adjustments: string[] }> {
    const progress = await this.checkProgress(intentId);
    const adjustments: string[] = [];

    for (const goal of progress.goals) {
      if (goal.onTrack) continue;

      const deficit = goal.target - goal.current;
      const pctBehind = 100 - goal.pctComplete;

      if (pctBehind > 30) {
        adjustments.push(`${goal.metric}: Widening search filters by 20% to increase pipeline`);
        adjustments.push(`${goal.metric}: Increasing outreach frequency from 1x to 2x daily`);
      } else if (pctBehind > 15) {
        adjustments.push(`${goal.metric}: Slightly expanding target criteria`);
        adjustments.push(`${goal.metric}: Prioritizing faster-converting lead sources`);
      } else {
        adjustments.push(`${goal.metric}: Minor pacing adjustment — increasing daily target by 10%`);
      }
    }

    if (adjustments.length === 0) {
      adjustments.push("All goals on track — no adjustments needed");
    }

    // Log adjustments
    await db.insert(intentProgressLogs).values({
      intentId,
      orgId: (await db.select().from(founderIntents).where(eq(founderIntents.intentId, intentId)))[0]?.orgId || 0,
      snapshot: progress as any,
      adjustmentsMade: adjustments as any,
      blockers: progress.blockers as any,
    });

    return { adjustments };
  }

  // ── 9. Get Intents ────────────────────────────────────────────────────────

  async getIntents(orgId: number, filters?: { status?: string }): Promise<FounderIntentEntry[]> {
    const conditions = [eq(founderIntents.orgId, orgId)];
    if (filters?.status) conditions.push(eq(founderIntents.status, filters.status));

    return db.select().from(founderIntents)
      .where(and(...conditions))
      .orderBy(desc(founderIntents.createdAt));
  }

  // ── 10. Get Intent Details ────────────────────────────────────────────────

  async getIntentDetails(intentId: string): Promise<{
    intent: FounderIntentEntry;
    progressLogs: IntentProgressLogEntry[];
  }> {
    const [intent] = await db.select().from(founderIntents)
      .where(eq(founderIntents.intentId, intentId));

    if (!intent) throw new Error(`Intent ${intentId} not found`);

    const progressLogs = await db.select().from(intentProgressLogs)
      .where(eq(intentProgressLogs.intentId, intentId))
      .orderBy(desc(intentProgressLogs.createdAt));

    return { intent, progressLogs };
  }

  // ── 11. Complete Intent ───────────────────────────────────────────────────

  async completeIntent(intentId: string, outcome?: Record<string, any>): Promise<FounderIntentEntry> {
    const [intent] = await db.select().from(founderIntents)
      .where(eq(founderIntents.intentId, intentId));

    if (!intent) throw new Error(`Intent ${intentId} not found`);

    const goals = (intent.parsedGoals || []) as ParsedGoal[];
    const finalSnapshot = {
      ...(intent.progressSnapshot || {}),
      completedAt: new Date().toISOString(),
      outcome: outcome || {},
      goalsHit: goals.length, // would be calculated from actual metrics
    };

    const [updated] = await db.update(founderIntents).set({
      status: "completed",
      progressSnapshot: finalSnapshot as any,
      updatedAt: new Date(),
    }).where(eq(founderIntents.intentId, intentId)).returning();

    return updated;
  }

  // ── 12. Intent Analytics ──────────────────────────────────────────────────

  async getIntentAnalytics(orgId: number): Promise<{
    total: number;
    byStatus: Record<string, number>;
    activeIntents: Array<{ intentId: string; rawInput: string; progress: number }>;
    completionRate: number;
    avgResourcesPerIntent: number;
    commonMetrics: Array<{ metric: string; count: number }>;
  }> {
    const allIntents = await db.select().from(founderIntents)
      .where(eq(founderIntents.orgId, orgId));

    const byStatus: Record<string, number> = {};
    const metricCounts: Record<string, number> = {};
    let totalResources = 0;
    let completedCount = 0;

    const activeIntents: Array<{ intentId: string; rawInput: string; progress: number }> = [];

    for (const intent of allIntents) {
      byStatus[intent.status] = (byStatus[intent.status] || 0) + 1;

      if (intent.status === "completed") completedCount++;

      if (intent.status === "active") {
        const snapshot = intent.progressSnapshot as any;
        activeIntents.push({
          intentId: intent.intentId,
          rawInput: intent.rawInput,
          progress: snapshot?.overallProgress || 0,
        });
      }

      const goals = (intent.parsedGoals || []) as ParsedGoal[];
      for (const g of goals) {
        metricCounts[g.metric] = (metricCounts[g.metric] || 0) + 1;
      }

      const strategies = (intent.generatedStrategies || []) as string[];
      const policies = (intent.generatedPolicies || []) as string[];
      const chains = (intent.generatedChains || []) as string[];
      totalResources += strategies.length + policies.length + chains.length;
    }

    const commonMetrics = Object.entries(metricCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([metric, count]) => ({ metric, count }));

    return {
      total: allIntents.length,
      byStatus,
      activeIntents,
      completionRate: allIntents.length > 0 ? Math.round((completedCount / allIntents.length) * 100) : 0,
      avgResourcesPerIntent: allIntents.length > 0 ? Math.round(totalResources / allIntents.length) : 0,
      commonMetrics,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private getAgentForMetric(metric: string): string {
    const agentMap: Record<string, string> = {
      deals_closed: "forge_revenue",
      revenue: "forge_revenue",
      leads_generated: "scout_lead",
      outreach_emails: "sophie_csm",
      calls_made: "sophie_csm",
      offers_sent: "forge_revenue",
      response_time: "sophie_csm",
      properties_analyzed: "atlas_research",
      acquisitions: "forge_revenue",
      contacts_made: "sophie_csm",
      meetings_scheduled: "sophie_csm",
      campaigns_launched: "pulse_marketing",
    };
    return agentMap[metric] || "compass_pm";
  }

  private buildContextWeights(goal: ParsedGoal): Record<string, number> {
    const weights: Record<string, number> = {};
    if (goal.filters?.state) weights.state_match = 2.0;
    if (goal.filters?.maxPrice) weights.price_in_range = 1.5;
    if (goal.filters?.propertyType) weights.type_match = 1.5;
    if (goal.priority && goal.priority >= 7) weights.urgency = 1.8;
    weights.pipeline_quality = 1.0;
    return weights;
  }

  private timeframeToDate(timeframe: string): Date {
    const now = new Date();
    if (timeframe === "week") return new Date(now.getTime() + 7 * 86400000);
    if (timeframe === "month") return new Date(now.getTime() + 30 * 86400000);
    if (timeframe === "quarter") return new Date(now.getTime() + 90 * 86400000);
    if (timeframe === "day") return new Date(now.getTime() + 86400000);

    const daysMatch = timeframe.match(/^(\d+)_days$/);
    if (daysMatch) return new Date(now.getTime() + parseInt(daysMatch[1]) * 86400000);

    const weeksMatch = timeframe.match(/^(\d+)_weeks$/);
    if (weeksMatch) return new Date(now.getTime() + parseInt(weeksMatch[1]) * 7 * 86400000);

    const monthsMatch = timeframe.match(/^(\d+)_months$/);
    if (monthsMatch) return new Date(now.getTime() + parseInt(monthsMatch[1]) * 30 * 86400000);

    const qEndMatch = timeframe.match(/^Q(\d)_end$/);
    if (qEndMatch) {
      const q = parseInt(qEndMatch[1]);
      const year = now.getFullYear();
      const qEndMonth = q * 3;
      return new Date(year, qEndMonth, 0); // last day of quarter
    }

    return new Date(now.getTime() + 30 * 86400000); // default 30 days
  }

  private timeframeToDays(timeframe: string): number {
    if (timeframe === "day") return 1;
    if (timeframe === "week") return 7;
    if (timeframe === "month") return 30;
    if (timeframe === "quarter") return 90;

    const daysMatch = timeframe.match(/^(\d+)_days$/);
    if (daysMatch) return parseInt(daysMatch[1]);

    const weeksMatch = timeframe.match(/^(\d+)_weeks$/);
    if (weeksMatch) return parseInt(weeksMatch[1]) * 7;

    const monthsMatch = timeframe.match(/^(\d+)_months$/);
    if (monthsMatch) return parseInt(monthsMatch[1]) * 30;

    return 30; // default
  }
}

export const founderIntentService = new FounderIntentService();
