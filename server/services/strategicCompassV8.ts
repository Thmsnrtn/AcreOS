/**
 * Strategic Compass v8 — Sovereign Company Protocol v8
 *
 * A living strategy document that every agent reads before every action.
 * "We're in growth mode. Revenue > efficiency. Ship fast, iterate."
 *
 * When the CEO adjusts the compass, everything cascades:
 * - Agent risk tolerance, spend authority, approval thresholds
 * - Focus areas rotate, avoid areas enforce
 * - Season config propagates
 *
 * Also self-suggests mode changes based on data.
 */

import { db } from "../db";
import { strategicCompass, type StrategicCompass } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { resolveAgentData } from "./agentDataResolvers";

// ─── Mode Presets ────────────────────────────────────────────────────────────

const MODE_PRESETS: Record<string, {
  northStar: string;
  priorities: Array<{ rank: number; priority: string; weight: number }>;
  defaultDirectives: {
    riskTolerance: "low" | "medium" | "high";
    spendAuthority: "tight" | "normal" | "aggressive";
    approvalThreshold: "strict" | "normal" | "loose";
  };
  metrics: Record<string, any>;
}> = {
  growth: {
    northStar: "Revenue over efficiency. Acquire customers aggressively. Ship fast, iterate, learn.",
    priorities: [
      { rank: 1, priority: "Customer acquisition", weight: 10 },
      { rank: 2, priority: "Revenue growth", weight: 9 },
      { rank: 3, priority: "Product velocity", weight: 8 },
      { rank: 4, priority: "Customer retention", weight: 6 },
      { rank: 5, priority: "Cost efficiency", weight: 4 },
    ],
    defaultDirectives: { riskTolerance: "high", spendAuthority: "aggressive", approvalThreshold: "loose" },
    metrics: { acceptableChurn: 5, hiringStatus: "aggressive" },
  },
  efficiency: {
    northStar: "Margin over growth. Every dollar must justify itself. Retain and expand existing customers.",
    priorities: [
      { rank: 1, priority: "Profit margin", weight: 10 },
      { rank: 2, priority: "Customer retention", weight: 9 },
      { rank: 3, priority: "Cost reduction", weight: 8 },
      { rank: 4, priority: "Revenue expansion (existing)", weight: 7 },
      { rank: 5, priority: "New acquisition", weight: 3 },
    ],
    defaultDirectives: { riskTolerance: "low", spendAuthority: "tight", approvalThreshold: "strict" },
    metrics: { acceptableChurn: 2, hiringStatus: "freeze" },
  },
  crisis: {
    northStar: "Survive. Protect cash. Every agent at maximum autonomy for speed. Daily briefings mandatory.",
    priorities: [
      { rank: 1, priority: "Cash preservation", weight: 10 },
      { rank: 2, priority: "Customer communication", weight: 9 },
      { rank: 3, priority: "System stability", weight: 9 },
      { rank: 4, priority: "Team morale", weight: 7 },
      { rank: 5, priority: "Recovery planning", weight: 6 },
    ],
    defaultDirectives: { riskTolerance: "low", spendAuthority: "tight", approvalThreshold: "strict" },
    metrics: { acceptableChurn: 0, hiringStatus: "freeze" },
  },
  exploration: {
    northStar: "Experiment boldly. Failure is data. Find the next big thing before competitors do.",
    priorities: [
      { rank: 1, priority: "Innovation experiments", weight: 10 },
      { rank: 2, priority: "Market discovery", weight: 9 },
      { rank: 3, priority: "Agent initiative proposals", weight: 8 },
      { rank: 4, priority: "Learning velocity", weight: 7 },
      { rank: 5, priority: "Revenue maintenance", weight: 5 },
    ],
    defaultDirectives: { riskTolerance: "high", spendAuthority: "normal", approvalThreshold: "loose" },
    metrics: { acceptableChurn: 4, hiringStatus: "selective" },
  },
  balanced: {
    northStar: "Steady growth with healthy margins. No extremes. Sustainable pace.",
    priorities: [
      { rank: 1, priority: "Sustainable revenue growth", weight: 8 },
      { rank: 2, priority: "Customer satisfaction", weight: 8 },
      { rank: 3, priority: "Operational efficiency", weight: 7 },
      { rank: 4, priority: "Product quality", weight: 7 },
      { rank: 5, priority: "Team development", weight: 6 },
    ],
    defaultDirectives: { riskTolerance: "medium", spendAuthority: "normal", approvalThreshold: "normal" },
    metrics: { acceptableChurn: 3, hiringStatus: "selective" },
  },
};

// ─── Agent-Specific Focus Areas by Mode ──────────────────────────────────────

const AGENT_MODE_FOCUS: Record<string, Record<string, { focusAreas: string[]; avoidAreas: string[] }>> = {
  growth: {
    forge_revenue: { focusAreas: ["upsell", "new deals", "aggressive pricing"], avoidAreas: ["deep discounts"] },
    sophie_csm: { focusAreas: ["fast onboarding", "expansion revenue"], avoidAreas: ["over-servicing small accounts"] },
    beacon_marketing: { focusAreas: ["paid acquisition", "content volume", "brand awareness"], avoidAreas: ["budget conservation"] },
    ledger_finance: { focusAreas: ["runway monitoring", "growth investment tracking"], avoidAreas: ["penny pinching"] },
  },
  efficiency: {
    forge_revenue: { focusAreas: ["retention offers", "price optimization", "margin improvement"], avoidAreas: ["aggressive discounting"] },
    sophie_csm: { focusAreas: ["churn prevention", "self-serve enablement"], avoidAreas: ["high-touch for low-value"] },
    beacon_marketing: { focusAreas: ["organic growth", "referral programs"], avoidAreas: ["expensive paid campaigns"] },
    ledger_finance: { focusAreas: ["cost auditing", "vendor renegotiation"], avoidAreas: ["new investments"] },
  },
  crisis: {
    forge_revenue: { focusAreas: ["protect existing revenue"], avoidAreas: ["new experiments"] },
    sophie_csm: { focusAreas: ["proactive communication", "escalation handling"], avoidAreas: ["feature requests"] },
    sentinel_devops: { focusAreas: ["stability", "incident response"], avoidAreas: ["infrastructure upgrades"] },
  },
  exploration: {
    forge_revenue: { focusAreas: ["new pricing models", "market experiments"], avoidAreas: ["conservative estimates"] },
    compass_pm: { focusAreas: ["prototype testing", "bold feature bets"], avoidAreas: ["incremental improvements"] },
    oracle_analytics: { focusAreas: ["trend detection", "anomaly hunting"], avoidAreas: ["routine reporting"] },
  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

class StrategicCompassV8Service {

  /** Get the active compass */
  async getActive(): Promise<StrategicCompass | null> {
    return db.query.strategicCompass.findFirst({
      where: eq(strategicCompass.isActive, true),
      orderBy: [desc(strategicCompass.updatedAt)],
    }) as any;
  }

  /** Initialize compass with a default mode */
  async initialize(mode = "balanced"): Promise<number> {
    const existing = await this.getActive();
    if (existing) {
      await db.update(strategicCompass).set({ isActive: false }).where(eq(strategicCompass.id, existing.id));
    }

    const preset = MODE_PRESETS[mode] || MODE_PRESETS.balanced;
    const agentDirectives = this.buildAgentDirectives(mode);

    const [compass] = await db.insert(strategicCompass).values({
      isActive: true,
      mode,
      northStar: preset.northStar,
      priorities: preset.priorities,
      agentDirectives,
      metrics: preset.metrics,
      lastUpdatedBy: "ceo",
      changelog: [{ timestamp: new Date().toISOString(), changedBy: "ceo", description: `Initialized in ${mode} mode`, newMode: mode }],
    }).returning({ id: strategicCompass.id });

    return compass.id;
  }

  /** Switch the company mode */
  async switchMode(newMode: string, reason?: string): Promise<void> {
    const compass = await this.getActive();
    if (!compass) { await this.initialize(newMode); return; }

    const preset = MODE_PRESETS[newMode] || MODE_PRESETS.balanced;
    const agentDirectives = this.buildAgentDirectives(newMode);
    const changelog = [...((compass.changelog as any[]) || [])];
    changelog.push({ timestamp: new Date().toISOString(), changedBy: "ceo", description: reason || `Switched to ${newMode}`, previousMode: compass.mode, newMode });

    await db.update(strategicCompass).set({
      mode: newMode, northStar: preset.northStar, priorities: preset.priorities,
      agentDirectives, metrics: preset.metrics, changelog, lastUpdatedBy: "ceo", updatedAt: new Date(),
    }).where(eq(strategicCompass.id, compass.id));
  }

  /** Update north star */
  async updateNorthStar(northStar: string): Promise<void> {
    const compass = await this.getActive();
    if (!compass) return;
    const changelog = [...((compass.changelog as any[]) || [])];
    changelog.push({ timestamp: new Date().toISOString(), changedBy: "ceo", description: `North star: "${northStar}"` });
    await db.update(strategicCompass).set({ northStar, changelog, updatedAt: new Date() }).where(eq(strategicCompass.id, compass.id));
  }

  /** Get directive for a specific agent */
  async getAgentDirective(agentCodename: string): Promise<any | null> {
    const compass = await this.getActive();
    if (!compass) return null;
    const directives = (compass.agentDirectives as Record<string, any>) || {};
    const agentDir = directives[agentCodename] || {};
    const preset = MODE_PRESETS[compass.mode] || MODE_PRESETS.balanced;
    return {
      mode: compass.mode, northStar: compass.northStar,
      riskTolerance: agentDir.riskTolerance || preset.defaultDirectives.riskTolerance,
      spendAuthority: agentDir.spendAuthority || preset.defaultDirectives.spendAuthority,
      approvalThreshold: agentDir.approvalThreshold || preset.defaultDirectives.approvalThreshold,
      focusAreas: agentDir.focusAreas || [], avoidAreas: agentDir.avoidAreas || [],
      priorities: compass.priorities as any[],
    };
  }

  /** AI-suggested mode change */
  async suggestModeChange(): Promise<{ suggestedMode: string; reason: string; confidence: string } | null> {
    const compass = await this.getActive();
    if (!compass) return null;
    const data = await resolveAgentData("forge_revenue").catch(() => ({}));
    try {
      const response = await routeAITask({
        taskType: "compass_suggestion", complexity: TaskComplexity.MODERATE,
        messages: [
          { role: "system", content: "Analyze business data to suggest mode changes. Modes: growth, efficiency, crisis, exploration, balanced. Only suggest if clear evidence." },
          { role: "user", content: `Current mode: ${compass.mode}\nData: ${JSON.stringify(data)}\nRespond JSON: { "shouldSwitch": boolean, "suggestedMode": "...", "reason": "...", "confidence": "low|medium|high" }` },
        ],
        responseFormat: { type: "json_object" }, temperature: 0.3,
      });
      const parsed = JSON.parse(response.content);
      return parsed.shouldSwitch ? { suggestedMode: parsed.suggestedMode, reason: parsed.reason, confidence: parsed.confidence } : null;
    } catch { return null; }
  }

  private buildAgentDirectives(mode: string): Record<string, any> {
    const preset = MODE_PRESETS[mode] || MODE_PRESETS.balanced;
    const modeOverrides = AGENT_MODE_FOCUS[mode] || {};
    const directives: Record<string, any> = {};
    for (const agent of ["atlas_cto", "sophie_csm", "forge_revenue", "beacon_marketing", "sentinel_devops", "ledger_finance", "shield_legal", "oracle_analytics", "compass_pm", "crucible_qa"]) {
      const override = modeOverrides[agent] || {};
      directives[agent] = { ...preset.defaultDirectives, focusAreas: override.focusAreas || [], avoidAreas: override.avoidAreas || [] };
    }
    return directives;
  }
}

export const strategicCompassV8Service = new StrategicCompassV8Service();
