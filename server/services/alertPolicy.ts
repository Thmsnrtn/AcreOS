/**
 * Escalation-Only Alert Policy
 *
 * P0 — System down (page Thomas immediately via email + SMS)
 *   Triggers: health check failure >5 min, DB unreachable, Stripe webhook failures, Clerk auth broken
 *
 * P1 — Degraded service (email within 1 hour)
 *   Triggers: single data source down, payment failure rate >10%, error rate spike
 *
 * P2 — Non-urgent (batch into weekly digest)
 *   Triggers: customer support escalation from Sophie, usage approaching tier limits, single payment failure
 *
 * P3 — Informational (log only)
 *   Triggers: routine agent operations, successful autonomous decisions, normal metrics
 */

import { db } from "../db";
import { systemAlerts } from "@shared/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";
import { logger } from "../utils/logger";

export type AlertPriority = "P0" | "P1" | "P2" | "P3";

interface AlertPolicyConfig {
  founderEmail: string;
  founderPhone?: string;
  appUrl: string;
}

// Map existing severity to priority levels
export function severityToPriority(severity: string, alertType?: string): AlertPriority {
  // P0 — critical system failures
  if (severity === "critical") {
    const p0Types = new Set([
      "health_check_failure", "database_unreachable", "stripe_webhook_failure",
      "auth_broken", "system_down", "mass_outage",
    ]);
    if (alertType && p0Types.has(alertType)) return "P0";
    return "P1"; // Critical but not system-down = P1
  }

  // P1 — degraded service
  if (severity === "warning") {
    const p1Types = new Set([
      "data_source_down", "payment_failure_rate_high", "error_rate_spike",
      "revenue_at_risk", "mass_delinquency", "high_churn_risk",
    ]);
    if (alertType && p1Types.has(alertType)) return "P1";
    return "P2";
  }

  // P2 — non-urgent issues
  if (severity === "info") {
    const p2Types = new Set([
      "support_escalation", "usage_approaching_limit", "refund_request",
      "single_payment_failure", "low_credits",
    ]);
    if (alertType && p2Types.has(alertType)) return "P2";
  }

  // Everything else is P3
  return "P3";
}

class AlertPolicyService {
  private config: AlertPolicyConfig;

  constructor() {
    this.config = {
      founderEmail: process.env.FOUNDER_EMAIL || process.env.ALERT_EMAIL || "",
      founderPhone: process.env.FOUNDER_PHONE,
      appUrl: process.env.APP_URL || "https://app.acreos.com",
    };
  }

  /**
   * Route an alert based on its priority level.
   * Called after an alert is created in the systemAlerts table.
   */
  async routeAlert(alertId: number): Promise<void> {
    const [alert] = await db
      .select()
      .from(systemAlerts)
      .where(eq(systemAlerts.id, alertId))
      .limit(1);

    if (!alert) return;

    const priority = severityToPriority(alert.severity, alert.alertType || alert.type);

    switch (priority) {
      case "P0":
        await this.handleP0(alert);
        break;
      case "P1":
        await this.handleP1(alert);
        break;
      case "P2":
        // P2 alerts are batched into weekly digest — no immediate action
        logger.info(`[AlertPolicy] P2 alert queued for weekly digest: ${alert.title}`);
        break;
      case "P3":
        // P3 alerts are log-only
        logger.info(`[AlertPolicy] P3 alert logged: ${alert.title}`);
        break;
    }
  }

  /**
   * P0 — Page Thomas immediately via email + SMS
   */
  private async handleP0(alert: any): Promise<void> {
    logger.warn(`[AlertPolicy] P0 ALERT — paging founder: ${alert.title}`);

    if (!this.config.founderEmail) {
      logger.error("[AlertPolicy] No FOUNDER_EMAIL configured for P0 alerts");
      return;
    }

    try {
      const { emailService } = await import("./emailService");
      await emailService.sendEmail({
        to: this.config.founderEmail,
        subject: `[P0 CRITICAL] ${alert.title}`,
        html: `
          <h2 style="color:#dc2626;">P0 — System Critical</h2>
          <p><strong>${alert.title}</strong></p>
          <p>${alert.message}</p>
          <p><a href="${this.config.appUrl}/founder/dashboard">View Dashboard</a></p>
          <p style="color:#666;font-size:12px;">Alert ID: ${alert.id} | ${new Date().toISOString()}</p>
        `,
        text: `[P0 CRITICAL] ${alert.title}\n\n${alert.message}\n\nDashboard: ${this.config.appUrl}/founder/dashboard`,
      });
    } catch (err) {
      logger.error("[AlertPolicy] Failed to send P0 email", err);
    }

    // SMS if phone configured
    if (this.config.founderPhone) {
      try {
        const { smsService } = await import("./smsService");
        await smsService.sendSMS({
          to: this.config.founderPhone,
          body: `[AcreOS P0] ${alert.title}: ${alert.message.substring(0, 120)}`,
        });
      } catch (err) {
        logger.error("[AlertPolicy] Failed to send P0 SMS", err);
      }
    }

    // Broadcast to incidents channel for agent awareness
    try {
      const { agentCommsService } = await import("./agentComms");
      await agentCommsService.broadcast({
        from: "alert_policy",
        channel: "incidents",
        priority: "critical",
        subject: `[P0] ${alert.title}`,
        body: alert.message,
        data: { alertId: alert.id, priority: "P0" },
      });
    } catch {}
  }

  /**
   * P1 — Email Thomas within 1 hour
   */
  private async handleP1(alert: any): Promise<void> {
    logger.warn(`[AlertPolicy] P1 ALERT — emailing founder: ${alert.title}`);

    if (!this.config.founderEmail) {
      logger.error("[AlertPolicy] No FOUNDER_EMAIL configured for P1 alerts");
      return;
    }

    try {
      const { emailService } = await import("./emailService");
      await emailService.sendEmail({
        to: this.config.founderEmail,
        subject: `[P1 Warning] ${alert.title}`,
        html: `
          <h2 style="color:#f59e0b;">P1 — Degraded Service</h2>
          <p><strong>${alert.title}</strong></p>
          <p>${alert.message}</p>
          <p><a href="${this.config.appUrl}/founder/dashboard">View Dashboard</a></p>
          <p style="color:#666;font-size:12px;">Alert ID: ${alert.id} | ${new Date().toISOString()}</p>
        `,
        text: `[P1 Warning] ${alert.title}\n\n${alert.message}\n\nDashboard: ${this.config.appUrl}/founder/dashboard`,
      });
    } catch (err) {
      logger.error("[AlertPolicy] Failed to send P1 email", err);
    }
  }

  /**
   * Generate weekly P2 digest for founder
   */
  async generateWeeklyDigest(): Promise<{ html: string; text: string; count: number } | null> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const alerts = await db
      .select()
      .from(systemAlerts)
      .where(and(
        gte(systemAlerts.createdAt, oneWeekAgo),
      ))
      .orderBy(desc(systemAlerts.createdAt));

    // Classify all alerts
    const p2Alerts = alerts.filter(a => {
      const priority = severityToPriority(a.severity, a.alertType || a.type);
      return priority === "P2";
    });

    if (p2Alerts.length === 0) return null;

    const groupedByType: Record<string, typeof p2Alerts> = {};
    for (const alert of p2Alerts) {
      const type = alert.alertType || alert.type;
      if (!groupedByType[type]) groupedByType[type] = [];
      groupedByType[type].push(alert);
    }

    const sections = Object.entries(groupedByType).map(([type, alerts]) => {
      const items = alerts.map(a => `<li>${a.title}: ${a.message}</li>`).join("\n");
      return `<h3>${type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} (${alerts.length})</h3>\n<ul>${items}</ul>`;
    }).join("\n");

    const textSections = Object.entries(groupedByType).map(([type, alerts]) => {
      const items = alerts.map(a => `  - ${a.title}: ${a.message}`).join("\n");
      return `${type.replace(/_/g, " ").toUpperCase()} (${alerts.length}):\n${items}`;
    }).join("\n\n");

    return {
      html: `
        <h2>AcreOS Weekly Alert Digest</h2>
        <p>${p2Alerts.length} non-urgent items from the past week:</p>
        ${sections}
        <p><a href="${this.config.appUrl}/founder/dashboard">View Full Dashboard</a></p>
        <p>— AcreOS Ops</p>
      `,
      text: `AcreOS Weekly Alert Digest\n\n${p2Alerts.length} items:\n\n${textSections}\n\nDashboard: ${this.config.appUrl}/founder/dashboard`,
      count: p2Alerts.length,
    };
  }

  /**
   * Send the weekly P2 digest email
   */
  async sendWeeklyDigest(): Promise<void> {
    if (!this.config.founderEmail) {
      logger.warn("[AlertPolicy] No FOUNDER_EMAIL configured, skipping weekly digest");
      return;
    }

    const digest = await this.generateWeeklyDigest();
    if (!digest) {
      logger.info("[AlertPolicy] No P2 alerts this week — skipping digest");
      return;
    }

    try {
      const { emailService } = await import("./emailService");
      await emailService.sendEmail({
        to: this.config.founderEmail,
        subject: `[AcreOS Weekly Digest] ${digest.count} items to review`,
        html: digest.html,
        text: digest.text,
      });
      logger.info(`[AlertPolicy] Weekly digest sent with ${digest.count} items`);
    } catch (err) {
      logger.error("[AlertPolicy] Failed to send weekly digest", err);
    }
  }
}

export const alertPolicyService = new AlertPolicyService();
