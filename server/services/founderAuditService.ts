/**
 * Founder Audit Service
 *
 * Provides comprehensive audit trail for founder liability protection.
 * Logs all high-risk operations, autonomous decisions, and compliance events.
 * All entries are immutable (append-only) and timestamped.
 */
import { db } from "../db";
import { auditLog } from "@shared/schema";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export type AuditSeverity = "info" | "warning" | "critical";
export type AuditCategory =
  | "autonomous_decision"
  | "compliance_override"
  | "financial_transaction"
  | "data_deletion"
  | "ai_action"
  | "security_event"
  | "system_error";

interface FounderAuditEntry {
  category: AuditCategory;
  severity: AuditSeverity;
  action: string;
  description: string;
  organizationId?: number;
  userId?: string;
  metadata?: Record<string, any>;
  complianceFlags?: string[];
}

class FounderAuditService {
  /**
   * Log a founder-visible audit event. These events are surfaced
   * in the Founder Dashboard and retained for 7 years (legal requirement).
   */
  async log(entry: FounderAuditEntry): Promise<void> {
    try {
      // Always log to structured output for external aggregation
      const logEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      };

      // Production: structured JSON for log aggregation (Datadog, etc.)
      if (process.env.NODE_ENV === "production") {
        logger.info(JSON.stringify({ type: "FOUNDER_AUDIT", ...logEntry }));
      }

      // Also persist to database audit log
      if (entry.organizationId) {
        await db.execute(sql`
          INSERT INTO audit_log (organization_id, user_id, action, entity_type, entity_id, changes, ip_address, user_agent, created_at)
          VALUES (
            ${entry.organizationId},
            ${entry.userId || 'system'},
            ${`founder_audit:${entry.category}:${entry.action}`},
            ${'system'},
            ${0},
            ${JSON.stringify({ severity: entry.severity, description: entry.description, metadata: entry.metadata, complianceFlags: entry.complianceFlags })}::jsonb,
            ${'system'},
            ${'founder-audit-service'},
            NOW()
          )
        `).catch(err => {
          // Never let audit logging failure crash the application
          logger.error("[FounderAudit] Failed to persist audit entry", err);
        });
      }
    } catch (err) {
      // Audit logging must never throw
      logger.error("[FounderAudit] Logging error", err);
    }
  }

  /** Log an autonomous AI decision */
  async logAutonomousDecision(
    orgId: number,
    action: string,
    confidence: number,
    wasExecuted: boolean,
    reasoning: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      category: "autonomous_decision",
      severity: confidence >= 90 ? "info" : confidence >= 75 ? "warning" : "critical",
      action,
      description: `Autonomous decision (${confidence}% confidence): ${reasoning}. ${wasExecuted ? "EXECUTED" : "DEFERRED to founder."}`,
      organizationId: orgId,
      metadata: { confidence, wasExecuted, ...metadata },
    });
  }

  /** Log a compliance override (user proceeded despite warning) */
  async logComplianceOverride(
    orgId: number,
    userId: string,
    complianceType: string,
    warnings: string[],
    entityType: string,
    entityId: number
  ): Promise<void> {
    await this.log({
      category: "compliance_override",
      severity: "critical",
      action: `override_${complianceType}`,
      description: `User ${userId} overrode ${complianceType} compliance warning on ${entityType}#${entityId}`,
      organizationId: orgId,
      userId,
      complianceFlags: warnings,
      metadata: { entityType, entityId },
    });
  }

  /** Log a high-value financial transaction */
  async logFinancialTransaction(
    orgId: number,
    userId: string,
    amount: number,
    transactionType: string,
    description: string
  ): Promise<void> {
    const severity: AuditSeverity = amount > 50000 ? "critical" : amount > 10000 ? "warning" : "info";
    await this.log({
      category: "financial_transaction",
      severity,
      action: transactionType,
      description: `$${amount.toLocaleString()} ${transactionType}: ${description}`,
      organizationId: orgId,
      userId,
      metadata: { amount, transactionType },
    });
  }

  /** Log data deletion events */
  async logDataDeletion(
    orgId: number,
    userId: string,
    entityType: string,
    count: number,
    isPermanent: boolean
  ): Promise<void> {
    await this.log({
      category: "data_deletion",
      severity: isPermanent ? "critical" : "warning",
      action: isPermanent ? "permanent_delete" : "soft_delete",
      description: `${isPermanent ? "Permanently deleted" : "Soft-deleted"} ${count} ${entityType}(s)`,
      organizationId: orgId,
      userId,
      metadata: { entityType, count, isPermanent },
    });
  }

  /** Log a security event */
  async logSecurityEvent(
    severity: AuditSeverity,
    action: string,
    description: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      category: "security_event",
      severity,
      action,
      description,
      metadata,
    });
  }
}

export const founderAudit = new FounderAuditService();
