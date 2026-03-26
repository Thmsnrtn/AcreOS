// @ts-nocheck
/**
 * AI Advisor Team — Sovereign Company Protocol v15: Proactive Business Intelligence
 *
 * The missing layer: a proactive intelligence system that TELLS the founder
 * what matters instead of waiting to be asked.
 *
 * This service orchestrates all founder-facing services into a unified
 * proactive operations layer:
 *
 * 1. DETECT — continuously monitors business health signals
 * 2. ANALYZE — correlates signals across revenue, churn, ops, support
 * 3. ACT — triggers graduated autonomous responses
 * 4. BRIEF — surfaces only what the founder needs to know
 *
 * Every reactive service (briefing, digest, wellbeing, reminders, absence,
 * twin, autopilot, intent) is now orchestrated proactively from here.
 */

import { db } from "../db";
import {
  organizations, deals, leads, campaigns, churnRiskScores,
  agentActionLog, systemAlerts, supportTickets, decisionsInboxItems,
  systemMeta,
} from "@shared/schema";
import { eq, and, gte, desc, count, sql, lt } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { getFounderEmails } from "./founder";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BusinessSignal {
  id: string;
  category: "revenue" | "churn" | "operations" | "support" | "growth" | "cost" | "opportunity";
  severity: "info" | "warning" | "critical" | "opportunity";
  title: string;
  detail: string;
  metric?: { current: number; previous: number; change: number; unit: string };
  suggestedAction?: string;
  autoActionTaken?: string;
  detectedAt: string;
}

interface ProactiveInsight {
  type: "alert" | "opportunity" | "recommendation" | "celebration";
  priority: number; // 1-10
  title: string;
  body: string;
  signals: string[]; // signal IDs that contributed
  suggestedActions: Array<{ label: string; action: string; canAutoExecute: boolean }>;
  autoExecuted?: boolean;
}

interface BusinessHealthSnapshot {
  timestamp: string;
  mrrCents: number;
  mrrGrowthPct: number;
  activeOrgs: number;
  newSignups7d: number;
  churnRisk: { critical: number; high: number; medium: number };
  supportLoad: { open: number; autoResolved24h: number; pendingEscalations: number };
  agentHealth: { successRate: number; totalActions7d: number; failedActions7d: number };
  pendingDecisions: number;
  activeIntents: number;
  founderEnergy: number | null;
}

interface AdvisorReport {
  snapshot: BusinessHealthSnapshot;
  signals: BusinessSignal[];
  insights: ProactiveInsight[];
  autonomousActionsTaken: string[];
  founderAttentionRequired: string[];
  generatedAt: string;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const THRESHOLDS = {
  mrrDropAlertPct: -5,           // alert if MRR drops > 5%
  churnCriticalCount: 3,         // alert if 3+ orgs in critical churn
  supportBacklogAlert: 10,       // alert if 10+ unresolved tickets
  agentFailureRateAlert: 20,     // alert if agent failure rate > 20%
  signupSurgeMultiplier: 2,      // opportunity if signups 2x normal
  costSpikeAlertPct: 30,         // alert if AI costs spike 30%+
  pendingDecisionAlert: 5,       // alert if 5+ pending founder decisions
};

// ─── Service ──────────────────────────────────────────────────────────────────

class AIAdvisorTeamService {

  // ── 1. DETECT — Gather Business Health Snapshot ─────────────────────────────

  async gatherHealthSnapshot(): Promise<BusinessHealthSnapshot> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);

    // MRR
    const mrrResult = await db.select({
      total: sql<number>`COALESCE(SUM(monthly_price_cents), 0)`,
    }).from(organizations)
      .where(sql`${organizations.subscriptionStatus} IN ('active', 'trialing')`);
    const mrrCents = Number(mrrResult[0]?.total ?? 0);

    // Active orgs
    const [activeResult] = await db.select({ c: count() })
      .from(organizations)
      .where(sql`${organizations.subscriptionStatus} IN ('active', 'trialing')`);
    const activeOrgs = Number(activeResult?.c ?? 0);

    // New signups 7d
    const [signupsResult] = await db.select({ c: count() })
      .from(organizations)
      .where(gte(organizations.createdAt, weekAgo));
    const newSignups7d = Number(signupsResult?.c ?? 0);

    // Churn risk distribution
    const churnRows = await db.select({
      band: churnRiskScores.riskBand,
      c: count(),
    }).from(churnRiskScores)
      .groupBy(churnRiskScores.riskBand);
    const churnMap: Record<string, number> = {};
    for (const r of churnRows) churnMap[r.band] = Number(r.c);

    // Support load
    const [openTickets] = await db.select({ c: count() })
      .from(supportTickets)
      .where(eq(supportTickets.status, "open"));
    const [pendingEscalations] = await db.select({ c: count() })
      .from(decisionsInboxItems)
      .where(and(
        eq(decisionsInboxItems.status, "pending"),
        eq(decisionsInboxItems.itemType, "support_escalation"),
      ));

    // Agent health
    const [totalActions] = await db.select({ c: count() })
      .from(agentActionLog)
      .where(gte(agentActionLog.createdAt, weekAgo));
    const [successActions] = await db.select({ c: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "success"),
        gte(agentActionLog.createdAt, weekAgo),
      ));
    const [failedActions] = await db.select({ c: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "failed"),
        gte(agentActionLog.createdAt, weekAgo),
      ));
    const total7d = Number(totalActions?.c ?? 0);
    const success7d = Number(successActions?.c ?? 0);
    const failed7d = Number(failedActions?.c ?? 0);

    // Pending decisions
    const [pendingDecisions] = await db.select({ c: count() })
      .from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.status, "pending"));

    // Founder energy (latest)
    let founderEnergy: number | null = null;
    try {
      const { founderWellbeingService } = await import("./founderWellbeing");
      const latest = await founderWellbeingService.getLatest();
      founderEnergy = latest?.energyScore ?? null;
    } catch {}

    // Active intents
    let activeIntents = 0;
    try {
      const { founderIntents } = await import("@shared/schema");
      const [intentCount] = await db.select({ c: count() })
        .from(founderIntents)
        .where(eq(founderIntents.status, "active"));
      activeIntents = Number(intentCount?.c ?? 0);
    } catch {}

    return {
      timestamp: now.toISOString(),
      mrrCents,
      mrrGrowthPct: 0, // calculated via historical comparison in analyzeSignals
      activeOrgs,
      newSignups7d,
      churnRisk: {
        critical: churnMap["critical"] || 0,
        high: churnMap["red"] || churnMap["high"] || 0,
        medium: churnMap["yellow"] || churnMap["medium"] || 0,
      },
      supportLoad: {
        open: Number(openTickets?.c ?? 0),
        autoResolved24h: 0, // populated by customerSupportAutoResolver
        pendingEscalations: Number(pendingEscalations?.c ?? 0),
      },
      agentHealth: {
        successRate: total7d > 0 ? Math.round((success7d / total7d) * 100) : 0,
        totalActions7d: total7d,
        failedActions7d: failed7d,
      },
      pendingDecisions: Number(pendingDecisions?.c ?? 0),
      activeIntents,
      founderEnergy,
    };
  }

  // ── 2. ANALYZE — Detect Signals from Snapshot ───────────────────────────────

  async analyzeSignals(snapshot: BusinessHealthSnapshot): Promise<BusinessSignal[]> {
    const signals: BusinessSignal[] = [];
    const now = new Date().toISOString();

    // Get previous snapshot for comparison
    const previous = await this.getPreviousSnapshot();
    if (previous) {
      const mrrChange = previous.mrrCents > 0
        ? ((snapshot.mrrCents - previous.mrrCents) / previous.mrrCents) * 100
        : 0;
      snapshot.mrrGrowthPct = Math.round(mrrChange * 10) / 10;

      if (mrrChange < THRESHOLDS.mrrDropAlertPct) {
        signals.push({
          id: `mrr_drop_${Date.now()}`,
          category: "revenue",
          severity: "critical",
          title: "MRR Decline Detected",
          detail: `MRR dropped ${Math.abs(mrrChange).toFixed(1)}% from $${(previous.mrrCents / 100).toLocaleString()} to $${(snapshot.mrrCents / 100).toLocaleString()}`,
          metric: { current: snapshot.mrrCents, previous: previous.mrrCents, change: mrrChange, unit: "cents" },
          suggestedAction: "Review recent cancellations and activate retention campaigns",
          detectedAt: now,
        });
      }

      // Signup surge detection
      const prevSignups = previous.newSignups7d || 1;
      if (snapshot.newSignups7d >= prevSignups * THRESHOLDS.signupSurgeMultiplier && snapshot.newSignups7d > 5) {
        signals.push({
          id: `signup_surge_${Date.now()}`,
          category: "growth",
          severity: "opportunity",
          title: "Signup Surge Detected",
          detail: `${snapshot.newSignups7d} signups this week — ${Math.round(snapshot.newSignups7d / prevSignups)}x your average`,
          suggestedAction: "Consider increasing onboarding support and scaling infrastructure",
          detectedAt: now,
        });
      }
    }

    // Churn risk alerts
    if (snapshot.churnRisk.critical >= THRESHOLDS.churnCriticalCount) {
      signals.push({
        id: `churn_critical_${Date.now()}`,
        category: "churn",
        severity: "critical",
        title: `${snapshot.churnRisk.critical} Customers in Critical Churn Risk`,
        detail: `${snapshot.churnRisk.critical} critical, ${snapshot.churnRisk.high} high, ${snapshot.churnRisk.medium} medium risk`,
        suggestedAction: "Trigger personalized retention outreach for critical accounts",
        detectedAt: now,
      });
    }

    // Support backlog
    if (snapshot.supportLoad.open >= THRESHOLDS.supportBacklogAlert) {
      signals.push({
        id: `support_backlog_${Date.now()}`,
        category: "support",
        severity: "warning",
        title: "Support Ticket Backlog Growing",
        detail: `${snapshot.supportLoad.open} open tickets, ${snapshot.supportLoad.pendingEscalations} awaiting founder`,
        suggestedAction: "Review escalated tickets or boost Sophie's confidence threshold",
        detectedAt: now,
      });
    }

    // Agent failure rate
    const failureRate = snapshot.agentHealth.totalActions7d > 0
      ? (snapshot.agentHealth.failedActions7d / snapshot.agentHealth.totalActions7d) * 100
      : 0;
    if (failureRate > THRESHOLDS.agentFailureRateAlert) {
      signals.push({
        id: `agent_failures_${Date.now()}`,
        category: "operations",
        severity: "critical",
        title: "Agent Failure Rate Elevated",
        detail: `${failureRate.toFixed(0)}% failure rate this week (${snapshot.agentHealth.failedActions7d} of ${snapshot.agentHealth.totalActions7d} actions)`,
        suggestedAction: "Check agent logs for systemic issues — consider pausing affected agents",
        detectedAt: now,
      });
    }

    // Pending decisions piling up
    if (snapshot.pendingDecisions >= THRESHOLDS.pendingDecisionAlert) {
      signals.push({
        id: `decision_backlog_${Date.now()}`,
        category: "operations",
        severity: "warning",
        title: `${snapshot.pendingDecisions} Pending Decisions`,
        detail: "Your decisions inbox is accumulating. Consider enabling autopilot for predictable patterns.",
        suggestedAction: "Review inbox or enable decision autopilot for eligible patterns",
        detectedAt: now,
      });
    }

    // Agent success celebration
    if (snapshot.agentHealth.successRate > 95 && snapshot.agentHealth.totalActions7d > 50) {
      signals.push({
        id: `agent_success_${Date.now()}`,
        category: "operations",
        severity: "info",
        title: "AI Team Performing Exceptionally",
        detail: `${snapshot.agentHealth.successRate}% success rate across ${snapshot.agentHealth.totalActions7d} actions this week`,
        detectedAt: now,
      });
    }

    // Founder energy warning
    if (snapshot.founderEnergy !== null && snapshot.founderEnergy < 40) {
      signals.push({
        id: `founder_energy_${Date.now()}`,
        category: "operations",
        severity: "warning",
        title: "Founder Energy Low",
        detail: `Your energy score is ${snapshot.founderEnergy}/100. Decision quality degrades below 40.`,
        suggestedAction: "Consider activating absence mode — your team can handle it",
        detectedAt: now,
      });
    }

    return signals;
  }

  // ── 3. ACT — Take Graduated Autonomous Actions ─────────────────────────────

  async takeAutonomousActions(signals: BusinessSignal[]): Promise<string[]> {
    const actionsTaken: string[] = [];

    for (const signal of signals) {
      // Only act on signals with suggested actions and sufficient severity
      if (!signal.suggestedAction) continue;

      switch (signal.category) {
        case "churn": {
          if (signal.severity === "critical") {
            // Auto-trigger retention campaign for critical churn
            try {
              const { executeAction } = await import("./agentActionExecutors");
              await executeAction({
                agentCodename: "sophie_csm",
                actionName: "batch_retention_outreach",
                input: { trigger: "advisor_churn_alert", signalId: signal.id },
                triggeredBy: "ai_advisor",
              });
              signal.autoActionTaken = "Triggered batch retention outreach for critical accounts";
              actionsTaken.push(signal.autoActionTaken);
            } catch {}
          }
          break;
        }

        case "operations": {
          if (signal.id.startsWith("decision_backlog")) {
            // Auto-check if any patterns are ready for autopilot
            try {
              const { decisionAutopilotService } = await import("./decisionAutopilot");
              const suggestions = await decisionAutopilotService.getSuggestions();
              if (suggestions.length > 0) {
                signal.autoActionTaken = `Found ${suggestions.length} decision pattern(s) eligible for autopilot`;
                actionsTaken.push(signal.autoActionTaken);
              }
            } catch {}
          }
          break;
        }

        case "growth": {
          if (signal.severity === "opportunity") {
            // Auto-log the opportunity for the founder briefing
            signal.autoActionTaken = "Flagged growth opportunity for next briefing";
            actionsTaken.push(signal.autoActionTaken);
          }
          break;
        }
      }
    }

    return actionsTaken;
  }

  // ── 4. BRIEF — Generate Proactive Insights ─────────────────────────────────

  async generateInsights(snapshot: BusinessHealthSnapshot, signals: BusinessSignal[]): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];

    // Critical signals → alerts
    const criticalSignals = signals.filter(s => s.severity === "critical");
    if (criticalSignals.length > 0) {
      insights.push({
        type: "alert",
        priority: 10,
        title: `${criticalSignals.length} Critical Issue${criticalSignals.length > 1 ? "s" : ""} Detected`,
        body: criticalSignals.map(s => `• ${s.title}: ${s.detail}`).join("\n"),
        signals: criticalSignals.map(s => s.id),
        suggestedActions: criticalSignals
          .filter(s => s.suggestedAction)
          .map(s => ({ label: s.title, action: s.suggestedAction!, canAutoExecute: !!s.autoActionTaken })),
      });
    }

    // Opportunities
    const opportunities = signals.filter(s => s.severity === "opportunity");
    for (const opp of opportunities) {
      insights.push({
        type: "opportunity",
        priority: 7,
        title: opp.title,
        body: opp.detail,
        signals: [opp.id],
        suggestedActions: opp.suggestedAction
          ? [{ label: "Act on this", action: opp.suggestedAction, canAutoExecute: false }]
          : [],
      });
    }

    // Proactive recommendations based on patterns
    if (snapshot.pendingDecisions > 3) {
      try {
        const { decisionAutopilotService } = await import("./decisionAutopilot");
        const stats = await decisionAutopilotService.getAccuracyStats();
        if (stats.eligibleNotActive > 0) {
          insights.push({
            type: "recommendation",
            priority: 6,
            title: `${stats.eligibleNotActive} Decision Pattern${stats.eligibleNotActive > 1 ? "s" : ""} Ready for Autopilot`,
            body: `Your shadow predictions are ${stats.overallAccuracy}% accurate. Enabling autopilot would handle ${stats.eligibleNotActive} recurring decision types automatically.`,
            signals: [],
            suggestedActions: [{ label: "Review & Enable", action: "open_autopilot_settings", canAutoExecute: false }],
          });
        }
      } catch {}
    }

    // Wellbeing-driven recommendations
    if (snapshot.founderEnergy !== null && snapshot.founderEnergy < 50 && snapshot.agentHealth.successRate > 85) {
      insights.push({
        type: "recommendation",
        priority: 8,
        title: "Your Team Can Handle More",
        body: `Your energy is at ${snapshot.founderEnergy}/100 but your AI team runs at ${snapshot.agentHealth.successRate}% success rate. Consider activating absence mode for 24-48 hours.`,
        signals: [],
        suggestedActions: [
          { label: "Activate Absence Mode (48h)", action: "activate_absence_48h", canAutoExecute: true },
          { label: "Review Team Performance", action: "show_agent_health", canAutoExecute: false },
        ],
      });
    }

    // Celebrations
    const celebrations = signals.filter(s => s.category === "operations" && s.severity === "info");
    for (const cel of celebrations) {
      insights.push({
        type: "celebration",
        priority: 3,
        title: cel.title,
        body: cel.detail,
        signals: [cel.id],
        suggestedActions: [],
      });
    }

    return insights.sort((a, b) => b.priority - a.priority);
  }

  // ── 5. FULL ADVISOR RUN — Orchestrate Everything ────────────────────────────

  async runAdvisorCycle(): Promise<AdvisorReport> {
    console.log("[AIAdvisor] Starting proactive advisor cycle...");

    // 1. Gather current state
    const snapshot = await this.gatherHealthSnapshot();

    // 2. Detect signals
    const signals = await this.analyzeSignals(snapshot);

    // 3. Take autonomous actions where appropriate
    const autonomousActionsTaken = await this.takeAutonomousActions(signals);

    // 4. Generate insights for the founder
    const insights = await this.generateInsights(snapshot, signals);

    // 5. Determine what needs founder attention
    const founderAttentionRequired = insights
      .filter(i => i.type === "alert" || (i.type === "recommendation" && i.priority >= 8))
      .map(i => i.title);

    // 6. Store snapshot for trend analysis
    await this.storeSnapshot(snapshot);

    // 7. Store the report
    const report: AdvisorReport = {
      snapshot,
      signals,
      insights,
      autonomousActionsTaken,
      founderAttentionRequired,
      generatedAt: new Date().toISOString(),
    };

    await this.storeReport(report);

    console.log(`[AIAdvisor] Cycle complete: ${signals.length} signals, ${insights.length} insights, ${autonomousActionsTaken.length} autonomous actions`);
    return report;
  }

  // ── 6. PROACTIVE MONITOR — Run on interval ─────────────────────────────────

  async startProactiveMonitor(intervalMs: number = 60 * 60 * 1000): Promise<void> {
    // Run immediately
    await this.runAdvisorCycle().catch(err =>
      console.error("[AIAdvisor] Cycle error:", err)
    );

    // Then on interval
    setInterval(async () => {
      try {
        const report = await this.runAdvisorCycle();

        // If critical signals detected, trigger immediate notification
        const criticals = report.signals.filter(s => s.severity === "critical");
        if (criticals.length > 0) {
          await this.sendUrgentNotification(criticals);
        }
      } catch (err) {
        console.error("[AIAdvisor] Cycle error:", err);
      }
    }, intervalMs);

    console.log(`[AIAdvisor] Proactive monitor started (interval: ${intervalMs / 60000}m)`);
  }

  // ── 7. AI-GENERATED STRATEGIC SUMMARY ───────────────────────────────────────

  async generateStrategicSummary(report: AdvisorReport): Promise<string> {
    try {
      const response = await routeAITask({
        taskType: "strategic_summary",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are the AI advisor to the CEO of AcreOS, a land investment technology platform. Generate a concise strategic summary (3-5 sentences) from the latest business intelligence report. Be direct. Lead with what matters most. No fluff.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              mrr: `$${(report.snapshot.mrrCents / 100).toLocaleString()}`,
              growth: `${report.snapshot.mrrGrowthPct}%`,
              activeOrgs: report.snapshot.activeOrgs,
              churnRisk: report.snapshot.churnRisk,
              agentSuccessRate: `${report.snapshot.agentHealth.successRate}%`,
              criticalSignals: report.signals.filter(s => s.severity === "critical").map(s => s.title),
              opportunities: report.signals.filter(s => s.severity === "opportunity").map(s => s.title),
              autonomousActions: report.autonomousActionsTaken,
              founderEnergy: report.snapshot.founderEnergy,
              pendingDecisions: report.snapshot.pendingDecisions,
            }),
          },
        ],
        maxTokens: 200,
        temperature: 0.3,
      });
      return response.content;
    } catch {
      return `MRR: $${(report.snapshot.mrrCents / 100).toLocaleString()}. ${report.signals.length} signals detected. ${report.autonomousActionsTaken.length} autonomous actions taken.`;
    }
  }

  // ── 8. SUGGEST NEXT FOUNDER INTENT ──────────────────────────────────────────

  async suggestNextIntent(snapshot: BusinessHealthSnapshot): Promise<{
    suggestion: string;
    reasoning: string;
    confidence: number;
  } | null> {
    // Only suggest if no active intents
    if (snapshot.activeIntents > 2) return null;

    const suggestions: Array<{ suggestion: string; reasoning: string; confidence: number }> = [];

    if (snapshot.churnRisk.critical > 0) {
      suggestions.push({
        suggestion: `Reduce churn risk — retain ${snapshot.churnRisk.critical} critical accounts this month`,
        reasoning: `${snapshot.churnRisk.critical} customers are in the critical churn band. Proactive retention could save significant MRR.`,
        confidence: 0.85,
      });
    }

    if (snapshot.newSignups7d > 10) {
      suggestions.push({
        suggestion: `Convert ${Math.round(snapshot.newSignups7d * 0.3)} trial signups to paid this month`,
        reasoning: `${snapshot.newSignups7d} new signups this week suggests strong top-of-funnel. Focus on conversion.`,
        confidence: 0.75,
      });
    }

    if (snapshot.agentHealth.successRate > 90 && snapshot.pendingDecisions > 3) {
      suggestions.push({
        suggestion: "Enable full autopilot for support and low-value pricing decisions",
        reasoning: `Agent success rate is ${snapshot.agentHealth.successRate}% but you still have ${snapshot.pendingDecisions} pending decisions. Time to delegate more.`,
        confidence: 0.80,
      });
    }

    if (suggestions.length === 0) return null;
    return suggestions.sort((a, b) => b.confidence - a.confidence)[0];
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  private async getPreviousSnapshot(): Promise<BusinessHealthSnapshot | null> {
    try {
      const meta = await db.query.systemMeta.findFirst({
        where: eq(systemMeta.key, "advisor_last_snapshot"),
      });
      return meta?.value ? JSON.parse(meta.value) : null;
    } catch { return null; }
  }

  private async storeSnapshot(snapshot: BusinessHealthSnapshot): Promise<void> {
    try {
      const existing = await db.query.systemMeta.findFirst({
        where: eq(systemMeta.key, "advisor_last_snapshot"),
      });
      const value = JSON.stringify(snapshot);
      if (existing) {
        await db.update(systemMeta).set({ value, updatedAt: new Date() })
          .where(eq(systemMeta.key, "advisor_last_snapshot"));
      } else {
        await db.insert(systemMeta).values({ key: "advisor_last_snapshot", value });
      }
    } catch {}
  }

  private async storeReport(report: AdvisorReport): Promise<void> {
    try {
      const existing = await db.query.systemMeta.findFirst({
        where: eq(systemMeta.key, "advisor_latest_report"),
      });
      const value = JSON.stringify(report);
      if (existing) {
        await db.update(systemMeta).set({ value, updatedAt: new Date() })
          .where(eq(systemMeta.key, "advisor_latest_report"));
      } else {
        await db.insert(systemMeta).values({ key: "advisor_latest_report", value });
      }
    } catch {}
  }

  private async sendUrgentNotification(criticals: BusinessSignal[]): Promise<void> {
    try {
      const { emailService } = await import("./emailService");
      const founderEmails = getFounderEmails();
      if (founderEmails.length === 0) return;

      const subject = `[URGENT] AcreOS: ${criticals.length} critical issue${criticals.length > 1 ? "s" : ""} detected`;
      const html = `
        <h2>AI Advisor — Urgent Alert</h2>
        <ul>
          ${criticals.map(c => `<li><strong>${c.title}</strong>: ${c.detail}${c.autoActionTaken ? `<br/><em>Auto-action: ${c.autoActionTaken}</em>` : ""}</li>`).join("")}
        </ul>
        <p><a href="/founder-dashboard">Open Dashboard →</a></p>
      `;

      for (const email of founderEmails) {
        await emailService.sendEmail({ to: email, subject, html, organizationId: undefined }).catch(() => {});
      }
    } catch {}
  }

  // ── Public Getters ──────────────────────────────────────────────────────────

  async getLatestReport(): Promise<AdvisorReport | null> {
    try {
      const meta = await db.query.systemMeta.findFirst({
        where: eq(systemMeta.key, "advisor_latest_report"),
      });
      return meta?.value ? JSON.parse(meta.value) : null;
    } catch { return null; }
  }

  async getHealthTrend(days: number = 7): Promise<BusinessHealthSnapshot[]> {
    // For now returns just the latest; in production would store daily snapshots
    const latest = await this.getPreviousSnapshot();
    return latest ? [latest] : [];
  }
}

export const aiAdvisorTeamService = new AIAdvisorTeamService();

// ─── Job Starter ──────────────────────────────────────────────────────────────

export async function startAIAdvisorJob(): Promise<void> {
  // Run every hour
  await aiAdvisorTeamService.startProactiveMonitor(60 * 60 * 1000);
}
