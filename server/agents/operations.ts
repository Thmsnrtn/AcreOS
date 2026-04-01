/**
 * Operations Agent — on-call engineer replacement. Monitors data sources, API health, and background jobs.
 */

import { BaseAgent, type AgentDecision } from "./base-agent";
import { db } from "../storage";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export class OperationsAgent extends BaseAgent {
  readonly name = "operations";
  readonly featureFlag = "agent_operations";
  readonly intervalMs = 15 * MINUTE; // Check every 15 minutes

  async runOnce(): Promise<void> {
    await this.checkDataSourceHealth();
    await this.checkApiHealth();
    await this.expireTrials();

    // Daily ops brief
    const now = new Date();
    if (now.getHours() >= 8 && now.getHours() <= 9) {
      await this.generateDailyOpsBrief();
    }
  }

  private async checkDataSourceHealth(): Promise<void> {
    try {
      const { runHealthProbe, getLatestHealth } = await import("../services/dataQualityMonitor");
      const results = await runHealthProbe();

      const downSources = results.filter((r) => r.status === "down");
      if (downSources.length > 0) {
        // Check if we already alerted recently
        const recentAlert = await db.execute(sql`
          SELECT 1 FROM founder_briefs
          WHERE agent_type = 'operations'
            AND brief_type = 'source_down_alert'
            AND generated_at > ${new Date(Date.now() - HOUR)}
          LIMIT 1
        `);

        if ((recentAlert as any).rows?.length === 0) {
          const decision: AgentDecision = {
            agentName: this.name,
            action: "data_source_alert",
            reason: `${downSources.length} data source(s) down: ${downSources.map((s) => s.name).join(", ")}`,
            riskLevel: "high",
            autoApproved: true,
            data: { downSources: downSources.map((s) => ({ name: s.name, error: s.error })) },
            timestamp: new Date(),
          };
          await this.logDecision(decision);
          await this.storeBrief("source_down_alert", {
            downCount: downSources.length,
            sources: downSources.map((s) => s.name),
          });
        }
      }

      logger.info(`[${this.name}] Data sources: ${results.length - downSources.length}/${results.length} healthy`);
    } catch (err: any) {
      logger.error(`[${this.name}] Data source health check failed`, err);
    }
  }

  private async checkApiHealth(): Promise<void> {
    try {
      const { healthCheckService } = await import("../services/healthCheck");
      const result = await healthCheckService.checkAll();

      const unhealthy = result.services.filter(
        (s: any) => s.status !== "healthy" && s.status !== "unconfigured"
      );

      if (unhealthy.length > 0) {
        const decision: AgentDecision = {
          agentName: this.name,
          action: "service_health_alert",
          reason: `${unhealthy.length} service(s) unhealthy: ${unhealthy.map((s: any) => `${s.name}(${s.status})`).join(", ")}`,
          riskLevel: unhealthy.some((s: any) => s.status === "unavailable") ? "high" : "medium",
          autoApproved: true,
          data: { unhealthy: unhealthy.map((s: any) => ({ name: s.name, status: s.status, message: s.message })) },
          timestamp: new Date(),
        };
        await this.logDecision(decision);
      }
    } catch (err: any) {
      logger.error(`[${this.name}] API health check failed`, err);
    }
  }

  private async expireTrials(): Promise<void> {
    try {
      const { trialService } = await import("../services/trialService");
      const expired = await trialService.expireTrials();
      if (expired > 0) {
        await this.logDecision({
          agentName: this.name,
          action: "expire_trials",
          reason: `Expired ${expired} trial(s) past 14-day window`,
          riskLevel: "low",
          autoApproved: true,
          data: { expiredCount: expired },
          timestamp: new Date(),
        });
      }
    } catch (err: any) {
      logger.error(`[${this.name}] Trial expiry check failed`, err);
    }
  }

  private async generateDailyOpsBrief(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await db.execute(sql`
      SELECT 1 FROM founder_briefs
      WHERE agent_type = 'operations' AND brief_type = 'daily' AND generated_at >= ${today}
      LIMIT 1
    `);
    if ((existing as any).rows?.length > 0) return;

    // Get data source health
    let sourceHealthSummary = "Unknown";
    try {
      const { getLatestHealth } = await import("../services/dataQualityMonitor");
      const health = getLatestHealth();
      const up = health.filter((h) => h.status === "up").length;
      sourceHealthSummary = `${up}/${health.length} healthy`;
    } catch {
      sourceHealthSummary = "Health check unavailable";
    }

    // Get service health
    let serviceHealthSummary = "Unknown";
    try {
      const { healthCheckService } = await import("../services/healthCheck");
      const result = await healthCheckService.checkAll();
      const healthy = result.services.filter((s: any) => s.status === "healthy").length;
      serviceHealthSummary = `${healthy}/${result.services.length} healthy (overall: ${result.overall})`;
    } catch {
      serviceHealthSummary = "Health check unavailable";
    }

    const brief = {
      date: new Date().toISOString().split("T")[0],
      dataSources: sourceHealthSummary,
      services: serviceHealthSummary,
    };

    await this.storeBrief("daily", brief);
    logger.info(`[${this.name}] Daily ops brief: sources ${sourceHealthSummary}, services ${serviceHealthSummary}`);
  }
}

export const operationsAgent = new OperationsAgent();
