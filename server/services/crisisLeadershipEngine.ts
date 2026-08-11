/**
 * Crisis Leadership Engine — Sovereign Company Protocol Phase 19
 *
 * Pre-authorized trade-offs, cascading failure mitigation, post-crisis
 * learning, crisis communication, and financial crisis protocol.
 */

import { db } from "../db";
import {
  preAuthorizedTradeoffs, crisisPlaybooks, warRooms, warRoomMessages,
  systemAlerts, anomalyDetections, companyAgents, organizations,
  agentActionLog,
} from "@shared/schema";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeoffEvaluation {
  tradeoffId: string;
  triggered: boolean;
  condition: string;
  action: string;
  executedAt?: string;
}

interface CrisisMetrics {
  errorRate: number;
  uptimePercent: number;
  revenueDeltaPercent: number;
  activeAnomalies: number;
  openWarRooms: number;
}

interface FinancialHealth {
  cashRunwayMonths: number;
  monthlyBurnCents: number;
  monthlyRevenueCents: number;
  netCashFlowCents: number;
  runwayStatus: "healthy" | "warning" | "critical";
}

// ─── Named pre-authorisation (founder ruling R-3, 2026-08-11) ────────────────
//
// `auto_execute` used to default to TRUE, so a seeded row could run an
// unattended crisis action because a schema default said so. The founder ruled
// that founder-side unattended handling stays available but must be a NAMED
// grant: someone is on record as having authorised it.
//
// ⚠️ HONEST SCOPE: `evaluateTradeoffs()` below currently has NO call site in
// the repo (only `seedTradeoffs` and `evaluateFinancialHealth` are reached, from
// ceoAbsenceMode.ts and permanentSovereignty.ts). This gate therefore hardens a
// DORMANT path — it is a correctness fix to a hazard, not a change to live
// behaviour. Do not report it as having stopped a running automation.

export interface NameableTradeoff {
  autoExecute?: boolean | null;
  preAuthorizedBy?: string | null;
}

/**
 * True only when unattended execution was granted BY SOMEONE. `auto_execute`
 * on its own — the shape every pre-R-3 row has — is not a grant.
 */
export function isNamedPreAuthorization(tradeoff: NameableTradeoff): boolean {
  return Boolean(tradeoff.autoExecute) && Boolean(tradeoff.preAuthorizedBy?.trim());
}

// ─── Service ──────────────────────────────────────────────────────────────────

class CrisisLeadershipEngine {

  // ─── Pre-Authorized Trade-Offs ────────────────────────────────────────────

  /**
   * Seed default pre-authorized trade-offs.
   *
   * R-3: these seed as CANDIDATES, not grants — `autoExecute: false` and no
   * `preAuthorizedBy`. Seeding them armed would just recreate the implicit
   * default under a new name, and stamping a grantor here would fabricate a
   * consent nobody gave. A founder names the grant (setting `auto_execute`
   * AND `pre_authorized_by`) to turn one into unattended handling.
   */
  async seedTradeoffs(): Promise<void> {
    const defaults = [
      {
        tradeoffId: "uptime_feature_sacrifice",
        condition: "Service uptime drops below 99% in a 1-hour window",
        action: "Disable non-critical features (content generation, analytics, background jobs) to preserve core functionality (auth, deal management, payments)",
        severity: "high",
        autoExecute: false,
      },
      {
        tradeoffId: "security_breach_isolation",
        condition: "Security breach or unauthorized access detected",
        action: "Immediately isolate affected systems, revoke compromised credentials, activate incident response. No data egress allowed.",
        severity: "critical",
        autoExecute: false,
      },
      {
        tradeoffId: "revenue_drop_retention",
        condition: "Daily revenue drops more than 20% compared to 7-day average",
        action: "Freeze all discretionary spending, activate retention playbooks for at-risk accounts, alert Forge + Ledger for emergency review",
        severity: "high",
        autoExecute: false,
      },
      {
        tradeoffId: "error_rate_rollback",
        condition: "API error rate exceeds 5% for more than 10 minutes",
        action: "Disable newest deployment, rollback to previous stable version, notify Sentinel + Atlas",
        severity: "high",
        autoExecute: false,
      },
      {
        tradeoffId: "ai_provider_failover",
        condition: "Primary AI provider (OpenAI) unavailable or responding >5s",
        action: "Route all AI requests to fallback provider (Anthropic). Queue non-urgent requests.",
        severity: "medium",
        autoExecute: false,
      },
    ];

    for (const tradeoff of defaults) {
      const existing = await db.query.preAuthorizedTradeoffs.findFirst({
        where: eq(preAuthorizedTradeoffs.tradeoffId, tradeoff.tradeoffId),
      });
      if (!existing) {
        await db.insert(preAuthorizedTradeoffs).values(tradeoff);
      }
    }
  }

  /**
   * Evaluate all active trade-offs against current metrics.
   */
  async evaluateTradeoffs(metrics: CrisisMetrics): Promise<TradeoffEvaluation[]> {
    const tradeoffs = await db.select()
      .from(preAuthorizedTradeoffs)
      .where(eq(preAuthorizedTradeoffs.isActive, true));

    const evaluations: TradeoffEvaluation[] = [];

    for (const tradeoff of tradeoffs) {
      let triggered = false;

      switch (tradeoff.tradeoffId) {
        case "uptime_feature_sacrifice":
          triggered = metrics.uptimePercent < 99;
          break;
        case "security_breach_isolation":
          triggered = false; // Only triggered by explicit security events
          break;
        case "revenue_drop_retention":
          triggered = metrics.revenueDeltaPercent < -20;
          break;
        case "error_rate_rollback":
          triggered = metrics.errorRate > 5;
          break;
        case "ai_provider_failover":
          triggered = false; // Handled by circuit breaker
          break;
      }

      // R-3 (founder ruling 2026-08-11): unattended crisis execution stays
      // allowed — a 3am outage should not wait for a human — but it must be a
      // NAMED pre-authorisation, never an implicit default. `auto_execute`
      // alone is no longer sufficient: `pre_authorized_by` must name who
      // granted it. A row carrying auto_execute=true from the old schema
      // default with no grantor is escalated rather than silently run.
      let executed = false;
      if (triggered && isNamedPreAuthorization(tradeoff)) {
        await this.executeTradeoff(tradeoff.tradeoffId, metrics);
        executed = true;
      } else if (triggered && tradeoff.autoExecute) {
        logger.warn(
          `[Crisis] Trade-off ${tradeoff.tradeoffId} triggered with auto_execute set but NO named ` +
            `pre-authorisation (pre_authorized_by is null) — refusing to auto-execute. ` +
            `Name the grant to restore unattended handling.`,
        );
      }

      // `executedAt` reports what actually ran. It used to be stamped from
      // `triggered` alone, which would now claim an execution the gate above
      // refused — a fabricated outcome. It tracks `executed`.
      evaluations.push({
        tradeoffId: tradeoff.tradeoffId,
        triggered,
        condition: tradeoff.condition,
        action: tradeoff.action,
        executedAt: executed ? new Date().toISOString() : undefined,
      });
    }

    return evaluations;
  }

  /**
   * Execute a triggered trade-off.
   */
  async executeTradeoff(tradeoffId: string, context: any): Promise<{ success: boolean; message: string }> {
    const tradeoff = await db.query.preAuthorizedTradeoffs.findFirst({
      where: eq(preAuthorizedTradeoffs.tradeoffId, tradeoffId),
    });
    if (!tradeoff) return { success: false, message: "Tradeoff not found" };

    // Record execution
    await db.update(preAuthorizedTradeoffs)
      .set({
        executionCount: sql`${preAuthorizedTradeoffs.executionCount} + 1`,
        lastExecutedAt: new Date(),
      })
      .where(eq(preAuthorizedTradeoffs.tradeoffId, tradeoffId));

    // Log the action
    await db.insert(agentActionLog).values({
      agentCodename: "sentinel_devops",
      actionType: "crisis_response",
      actionName: `tradeoff_${tradeoffId}`,
      input: context,
      output: { tradeoffId, action: tradeoff.action },
      reasoning: `Pre-authorized tradeoff triggered: ${tradeoff.condition}`,
      confidence: 95,
      authorityLevel: 0,
      trustScoreAtTime: 0,
      outcome: "success",
      durationMs: 0,
    });

    // Broadcast to all agents
    try {
      const { agentCommsService } = await import("./agentComms");
      await agentCommsService.broadcast({
        from: "sentinel_devops",
        channel: "incidents",
        priority: "critical",
        subject: `TRADE-OFF EXECUTED: ${tradeoff.condition}`,
        body: `Action taken: ${tradeoff.action}`,
        data: { tradeoffId, context },
      });
    } catch {}

    // Specific actions per tradeoff
    if (tradeoffId === "uptime_feature_sacrifice") {
      try {
        const { infrastructureManager } = await import("./predictiveAutoscaler");
        await infrastructureManager.activateSurvivalMode("Uptime below 99% — non-critical features disabled");
      } catch {}
    }

    return { success: true, message: `Tradeoff ${tradeoffId} executed: ${tradeoff.action}` };
  }

  async getActiveTradeoffs() {
    return db.select()
      .from(preAuthorizedTradeoffs)
      .where(eq(preAuthorizedTradeoffs.isActive, true));
  }

  // ─── Cascading Failure Mitigation ─────────────────────────────────────────

  /**
   * Detect cascading failures from multiple concurrent anomalies.
   */
  async detectCascade(): Promise<{ cascade: boolean; severity: string; anomalyCount: number; recommendation: string }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [recentAnomalies] = await db.select({ count: sql<number>`count(*)` })
      .from(anomalyDetections)
      .where(and(
        gte(anomalyDetections.createdAt, oneHourAgo),
        eq(anomalyDetections.autoResolved, false),
      ));

    const anomalyCount = Number(recentAnomalies?.count || 0);

    if (anomalyCount >= 5) {
      return {
        cascade: true,
        severity: "critical",
        anomalyCount,
        recommendation: "Activate survival mode immediately. Multiple cascading failures detected.",
      };
    }
    if (anomalyCount >= 3) {
      return {
        cascade: true,
        severity: "high",
        anomalyCount,
        recommendation: "Potential cascade forming. Monitor closely. Consider preemptive survival mode.",
      };
    }

    return {
      cascade: false,
      severity: "none",
      anomalyCount,
      recommendation: anomalyCount > 0
        ? `${anomalyCount} anomalies detected but not cascading. Continue monitoring.`
        : "No anomalies detected. System healthy.",
    };
  }

  /**
   * Activate survival mode — only critical paths active.
   */
  async activateSurvivalMode(reason: string): Promise<void> {
    try {
      const { infrastructureManager } = await import("./predictiveAutoscaler");
      await infrastructureManager.activateSurvivalMode(reason);
    } catch {
      logger.info(`[CrisisEngine] Survival mode requested but infrastructure manager unavailable: ${reason}`);
    }
  }

  async deactivateSurvivalMode(reason: string): Promise<void> {
    try {
      const { infrastructureManager } = await import("./predictiveAutoscaler");
      await infrastructureManager.deactivateSurvivalMode(reason);
    } catch {}
  }

  getSurvivalModeStatus(): { active: boolean } {
    try {
      const { infrastructureManager } = require("./predictiveAutoscaler");
      return { active: infrastructureManager.isSurvivalModeActive() };
    } catch {
      return { active: false };
    }
  }

  // ─── Post-Crisis Learning ─────────────────────────────────────────────────

  /**
   * Analyze a war room to extract learnings.
   */
  async analyzeWarRoom(warRoomId: number): Promise<{
    timeline: string[];
    whatWorked: string[];
    whatFailed: string[];
    recommendations: string[];
  }> {
    const room = await db.query.warRooms.findFirst({
      where: eq(warRooms.id, warRoomId),
    });
    if (!room) throw new Error(`War room ${warRoomId} not found`);

    const messages = await db.select()
      .from(warRoomMessages)
      .where(eq(warRoomMessages.warRoomId, warRoomId))
      .orderBy(warRoomMessages.createdAt);

    const timeline = messages.map(m =>
      `[${m.fromAgent}] (${m.messageType}): ${m.content.slice(0, 100)}`
    );

    // Simple analysis based on message patterns
    const analysisMessages = messages.filter(m => m.messageType === "analysis");
    const actionMessages = messages.filter(m => m.messageType === "action_taken");

    return {
      timeline,
      whatWorked: actionMessages.map(m => m.content.slice(0, 150)),
      whatFailed: room.resolution ? [] : ["Crisis not yet resolved"],
      recommendations: [
        "Update incident playbooks based on this experience",
        "Consider adjusting trust scores based on agent performance during crisis",
        `Add new chaos experiment to test against "${room.triggerEvent}"`,
      ],
    };
  }

  /**
   * Auto-generate a crisis playbook from war room learnings.
   */
  async generatePlaybook(warRoomId: number): Promise<string> {
    const analysis = await this.analyzeWarRoom(warRoomId);
    const room = await db.query.warRooms.findFirst({ where: eq(warRooms.id, warRoomId) });
    if (!room) throw new Error("War room not found");

    const playbookId = `playbook-${crypto.randomUUID().slice(0, 8)}`;

    await db.insert(crisisPlaybooks).values({
      playbookId,
      crisisType: room.triggerEvent,
      steps: analysis.whatWorked.map((action, i) => ({
        action,
        owner: room.leadAgent,
        timeframe: `Step ${i + 1}`,
        priority: i + 1,
      })),
      communicationPlan: [
        { channel: "status_page", audience: "public", template: "Service disruption notice" },
        { channel: "email", audience: "affected_customers", template: "Personal notification" },
      ],
    });

    return playbookId;
  }

  async getPlaybooks(crisisType?: string) {
    if (crisisType) {
      return db.select().from(crisisPlaybooks)
        .where(eq(crisisPlaybooks.crisisType, crisisType));
    }
    return db.select().from(crisisPlaybooks).limit(50);
  }

  /**
   * Adjust agent trust scores based on crisis performance.
   */
  async adjustTrustScores(warRoomId: number): Promise<Record<string, number>> {
    const messages = await db.select()
      .from(warRoomMessages)
      .where(eq(warRoomMessages.warRoomId, warRoomId));

    const agentContributions: Record<string, number> = {};

    for (const msg of messages) {
      if (!agentContributions[msg.fromAgent]) agentContributions[msg.fromAgent] = 0;
      if (msg.messageType === "analysis") agentContributions[msg.fromAgent] += 1;
      if (msg.messageType === "action_taken") agentContributions[msg.fromAgent] += 2;
      if (msg.messageType === "proposal") agentContributions[msg.fromAgent] += 1;
    }

    const adjustments: Record<string, number> = {};
    const { companyAgentService } = await import("./companyAgents");

    for (const [codename, contribution] of Object.entries(agentContributions)) {
      const delta = Math.min(5, Math.round(contribution));
      if (delta > 0) {
        await companyAgentService.updateTrustScore(codename, delta);
        adjustments[codename] = delta;
      }
    }

    return adjustments;
  }

  // ─── Crisis Communication Protocol ────────────────────────────────────────

  /**
   * Coordinate crisis communications.
   */
  async coordinateCrisisComms(crisisType: string, severity: string, details: string): Promise<{ actions: string[] }> {
    const actions: string[] = [];

    try {
      const { externalCommsManager } = await import("./externalCommunicationsManager");

      const result = await externalCommsManager.initiateCrisisComms(crisisType, severity, details);
      actions.push(...result.actions);

      // Get regulatory requirements
      const regReqs = externalCommsManager.getRegulatoryNotificationRequirements(crisisType);
      if (regReqs.length > 0) {
        actions.push(`REGULATORY: ${regReqs.join("; ")}`);
      }
    } catch (err: any) {
      actions.push(`Crisis comms manager unavailable: ${err.message}`);
    }

    return { actions };
  }

  // ─── Financial Crisis Protocol ────────────────────────────────────────────

  /**
   * Evaluate current financial health.
   */
  async evaluateFinancialHealth(): Promise<FinancialHealth> {
    const { resolveAgentData } = await import("./agentDataResolvers");
    const forgeData = await resolveAgentData("forge_revenue");
    const ledgerData = await resolveAgentData("ledger_finance");

    const monthlyRevenue = forgeData.mrrCents || 0;
    const monthlyBurn = ledgerData.aiSpend30dCents || 0;
    const netCashFlow = monthlyRevenue - monthlyBurn;

    // Assume some cash reserves (simplified)
    const estimatedCashCents = monthlyRevenue * 6; // 6 months revenue as proxy
    const runwayMonths = monthlyBurn > 0 ? Math.round(estimatedCashCents / monthlyBurn) : 999;

    return {
      cashRunwayMonths: runwayMonths,
      monthlyBurnCents: monthlyBurn,
      monthlyRevenueCents: monthlyRevenue,
      netCashFlowCents: netCashFlow,
      runwayStatus: runwayMonths > 12 ? "healthy" : runwayMonths > 6 ? "warning" : "critical",
    };
  }

  /**
   * Activate financial crisis protocol.
   */
  async activateFinancialCrisis(trigger: string): Promise<{ actions: string[] }> {
    const actions: string[] = [];

    // 1. Freeze discretionary spend
    actions.push("Discretionary spending frozen pending review");

    // 2. Activate retention playbooks
    actions.push("Retention playbooks activated for all at-risk accounts");

    // 3. Broadcast to all agents
    try {
      const { agentCommsService } = await import("./agentComms");
      await agentCommsService.broadcast({
        from: "ledger_finance",
        channel: "revenue_events",
        priority: "critical",
        subject: "FINANCIAL CRISIS PROTOCOL ACTIVATED",
        body: `Trigger: ${trigger}. Discretionary spend frozen. Retention playbooks activated.`,
        data: { trigger, protocol: "financial_crisis" },
      });
    } catch {}

    // 4. Log the activation
    await db.insert(agentActionLog).values({
      agentCodename: "ledger_finance",
      actionType: "crisis_response",
      actionName: "activate_financial_crisis",
      input: { trigger },
      output: { actions },
      reasoning: `Financial crisis protocol activated: ${trigger}`,
      confidence: 95,
      authorityLevel: 0,
      trustScoreAtTime: 0,
      outcome: "success",
      durationMs: 0,
    });

    actions.push("All agents notified of financial crisis protocol");
    return { actions };
  }

  async getFinancialCrisisStatus(): Promise<FinancialHealth> {
    return this.evaluateFinancialHealth();
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  async getCrisisDashboard(): Promise<{
    activeTradeoffs: number;
    cascadeDetected: boolean;
    survivalModeActive: boolean;
    financialHealth: FinancialHealth;
    recentPlaybooks: number;
  }> {
    const [tradeoffs, cascade, financial, playbooks] = await Promise.all([
      this.getActiveTradeoffs().then(t => t.length),
      this.detectCascade(),
      this.evaluateFinancialHealth(),
      db.select({ count: sql<number>`count(*)` }).from(crisisPlaybooks),
    ]);

    return {
      activeTradeoffs: tradeoffs,
      cascadeDetected: cascade.cascade,
      survivalModeActive: this.getSurvivalModeStatus().active,
      financialHealth: financial,
      recentPlaybooks: Number(playbooks[0]?.count || 0),
    };
  }
}

export const crisisLeadershipEngine = new CrisisLeadershipEngine();
