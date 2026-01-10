import { db } from "../db";
import {
  portfolioAlerts,
  properties,
  notes,
  marketMetrics,
  agentEvents,
  documentAnalysis,
  complianceChecks,
  type InsertPortfolioAlert,
  type PortfolioAlert,
  type Property,
} from "@shared/schema";
import { eq, and, desc, gte, lte, or, isNull, sql } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

export type AlertType = "tax_due" | "market_change" | "competitor_activity" | "maintenance" | "document_expiring" | "compliance";
export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface AlertFilterOptions {
  alertTypes?: AlertType[];
  severities?: AlertSeverity[];
  status?: string;
  propertyId?: number;
  limit?: number;
  offset?: number;
}

export interface MonitoringResult {
  propertyId: number;
  checksRun: string[];
  alertsCreated: number;
  errors: string[];
}

export interface PortfolioHealthScore {
  overallScore: number;
  breakdown: {
    taxHealth: number;
    marketPosition: number;
    complianceStatus: number;
    documentStatus: number;
  };
  activeAlerts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  recommendations: string[];
}

class PortfolioSentinelService {
  async monitorProperty(organizationId: number, propertyId: number): Promise<MonitoringResult> {
    const result: MonitoringResult = {
      propertyId,
      checksRun: [],
      alertsCreated: 0,
      errors: [],
    };

    const property = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);

    if (property.length === 0) {
      result.errors.push("Property not found");
      return result;
    }

    const checks = [
      { name: "tax_status", fn: () => this.checkTaxStatus(organizationId, propertyId) },
      { name: "market_changes", fn: () => this.checkMarketChanges(organizationId, propertyId) },
      { name: "competitor_activity", fn: () => this.checkCompetitorActivity(organizationId, propertyId) },
      { name: "document_expiration", fn: () => this.checkDocumentExpiration(organizationId, propertyId) },
      { name: "compliance_status", fn: () => this.checkComplianceStatus(organizationId, propertyId) },
    ];

    for (const check of checks) {
      try {
        const alertCreated = await check.fn();
        result.checksRun.push(check.name);
        if (alertCreated) {
          result.alertsCreated++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`${check.name}: ${errorMessage}`);
      }
    }

    await this.logAgentEvent(organizationId, "portfolio_monitoring", {
      propertyId,
      checksRun: result.checksRun,
      alertsCreated: result.alertsCreated,
    });

    return result;
  }

  async monitorPortfolio(organizationId: number): Promise<MonitoringResult[]> {
    const ownedProperties = await db
      .select()
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), eq(properties.status, "owned")));

    const results: MonitoringResult[] = [];

    for (const property of ownedProperties) {
      const result = await this.monitorProperty(organizationId, property.id);
      results.push(result);
    }

    return results;
  }

  async checkTaxStatus(organizationId: number, propertyId: number): Promise<boolean> {
    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);

    if (!property) return false;

    const dueDiligenceData = property.dueDiligenceData as {
      taxesCurrent?: boolean;
      taxDueDate?: string;
      taxAmount?: number;
    } | null;

    if (dueDiligenceData?.taxesCurrent === false) {
      const existingAlert = await this.findExistingAlert(organizationId, propertyId, "tax_due");
      if (!existingAlert) {
        await this.createAlert(
          organizationId,
          propertyId,
          "tax_due",
          "high",
          "Property Taxes Delinquent",
          `Property taxes are not current. Review tax status and payment options.`,
          {
            taxesCurrent: false,
            taxAmount: dueDiligenceData.taxAmount,
            source: "due_diligence_data",
          }
        );
        return true;
      }
    }

    if (dueDiligenceData?.taxDueDate) {
      const dueDate = new Date(dueDiligenceData.taxDueDate);
      const now = new Date();
      const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntilDue <= 30 && daysUntilDue > 0) {
        const existingAlert = await this.findExistingAlert(organizationId, propertyId, "tax_due");
        if (!existingAlert) {
          await this.createAlert(
            organizationId,
            propertyId,
            "tax_due",
            daysUntilDue <= 7 ? "critical" : "medium",
            `Property Taxes Due in ${daysUntilDue} Days`,
            `Property taxes are due on ${dueDate.toLocaleDateString()}. Ensure payment is scheduled.`,
            {
              dueDate: dueDiligenceData.taxDueDate,
              daysUntilDue,
              taxAmount: dueDiligenceData.taxAmount,
            }
          );
          return true;
        }
      }
    }

    return false;
  }

  async checkMarketChanges(organizationId: number, propertyId: number): Promise<boolean> {
    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);

    if (!property || !property.county || !property.state) return false;

    const recentMetrics = await db
      .select()
      .from(marketMetrics)
      .where(
        and(
          eq(marketMetrics.county, property.county),
          eq(marketMetrics.state, property.state)
        )
      )
      .orderBy(desc(marketMetrics.metricDate))
      .limit(2);

    if (recentMetrics.length < 2) return false;

    const current = recentMetrics[0];
    const previous = recentMetrics[1];

    if (current.medianPricePerAcre && previous.medianPricePerAcre) {
      const currentPrice = parseFloat(current.medianPricePerAcre);
      const previousPrice = parseFloat(previous.medianPricePerAcre);
      const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;

      if (Math.abs(changePercent) > 10) {
        const existingAlert = await this.findExistingAlert(organizationId, propertyId, "market_change");
        if (!existingAlert) {
          const direction = changePercent > 0 ? "increased" : "decreased";
          await this.createAlert(
            organizationId,
            propertyId,
            "market_change",
            Math.abs(changePercent) > 20 ? "high" : "medium",
            `Market Value ${direction} by ${Math.abs(changePercent).toFixed(1)}%`,
            `The median price per acre in ${property.county}, ${property.state} has ${direction} significantly. Review property valuation and pricing strategy.`,
            {
              previousValue: previousPrice,
              currentValue: currentPrice,
              changePercent,
              county: property.county,
              state: property.state,
            }
          );
          return true;
        }
      }
    }

    return false;
  }

  async checkCompetitorActivity(organizationId: number, propertyId: number): Promise<boolean> {
    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);

    if (!property || !property.county || !property.state) return false;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentMetrics = await db
      .select()
      .from(marketMetrics)
      .where(
        and(
          eq(marketMetrics.county, property.county),
          eq(marketMetrics.state, property.state),
          gte(marketMetrics.metricDate, thirtyDaysAgo)
        )
      )
      .orderBy(desc(marketMetrics.metricDate))
      .limit(1);

    if (recentMetrics.length === 0) return false;

    const metrics = recentMetrics[0];

    if (metrics.newListingsCount && metrics.newListingsCount > 10) {
      const existingAlert = await this.findExistingAlert(organizationId, propertyId, "competitor_activity");
      if (!existingAlert) {
        await this.createAlert(
          organizationId,
          propertyId,
          "competitor_activity",
          metrics.newListingsCount > 20 ? "high" : "medium",
          `High Competitor Activity Detected`,
          `${metrics.newListingsCount} new listings in ${property.county}, ${property.state} in the past month. Consider adjusting your pricing or marketing strategy.`,
          {
            newListingsCount: metrics.newListingsCount,
            inventoryCount: metrics.inventoryCount,
            county: property.county,
            state: property.state,
          }
        );
        return true;
      }
    }

    return false;
  }

  async checkDocumentExpiration(organizationId: number, propertyId: number): Promise<boolean> {
    const documents = await db
      .select()
      .from(documentAnalysis)
      .where(
        and(
          eq(documentAnalysis.propertyId, propertyId),
          eq(documentAnalysis.organizationId, organizationId)
        )
      );

    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    let alertCreated = false;

    for (const doc of documents) {
      const extractedData = doc.extractedData as {
        closingDate?: string;
        maturityDate?: string;
        deadlines?: Array<{ name: string; date: string }>;
      } | null;

      if (!extractedData) continue;

      const datesToCheck: Array<{ label: string; date: string }> = [];

      if (extractedData.closingDate) {
        datesToCheck.push({ label: "Closing Date", date: extractedData.closingDate });
      }
      if (extractedData.maturityDate) {
        datesToCheck.push({ label: "Maturity Date", date: extractedData.maturityDate });
      }
      if (extractedData.deadlines) {
        datesToCheck.push(...extractedData.deadlines.map((d) => ({ label: d.name, date: d.date })));
      }

      for (const dateInfo of datesToCheck) {
        const expirationDate = new Date(dateInfo.date);
        if (expirationDate > now && expirationDate <= thirtyDaysFromNow) {
          const daysUntil = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          const existingAlert = await this.findExistingAlert(organizationId, propertyId, "document_expiring");
          if (!existingAlert) {
            await this.createAlert(
              organizationId,
              propertyId,
              "document_expiring",
              daysUntil <= 7 ? "critical" : daysUntil <= 14 ? "high" : "medium",
              `${dateInfo.label} Approaching: ${daysUntil} Days`,
              `The ${dateInfo.label} for ${doc.documentName} is on ${expirationDate.toLocaleDateString()}. Take necessary action.`,
              {
                documentId: doc.id,
                documentType: doc.documentType,
                documentName: doc.documentName,
                dateLabel: dateInfo.label,
                expirationDate: dateInfo.date,
                daysUntil,
              }
            );
            alertCreated = true;
          }
        }
      }
    }

    return alertCreated;
  }

  async checkComplianceStatus(organizationId: number, propertyId: number): Promise<boolean> {
    const pendingChecks = await db
      .select()
      .from(complianceChecks)
      .where(
        and(
          eq(complianceChecks.propertyId, propertyId),
          eq(complianceChecks.organizationId, organizationId),
          or(
            eq(complianceChecks.status, "pending"),
            eq(complianceChecks.status, "non_compliant"),
            eq(complianceChecks.status, "needs_review")
          )
        )
      );

    if (pendingChecks.length === 0) return false;

    const criticalChecks = pendingChecks.filter((c) => c.status === "non_compliant");
    const pendingReviewChecks = pendingChecks.filter(
      (c) => c.status === "pending" || c.status === "needs_review"
    );

    let alertCreated = false;

    if (criticalChecks.length > 0) {
      const existingAlert = await this.findExistingAlert(organizationId, propertyId, "compliance");
      if (!existingAlert) {
        await this.createAlert(
          organizationId,
          propertyId,
          "compliance",
          "critical",
          `${criticalChecks.length} Compliance Issue(s) Require Attention`,
          `Property has ${criticalChecks.length} non-compliant status check(s). Immediate action required.`,
          {
            nonCompliantCount: criticalChecks.length,
            checkIds: criticalChecks.map((c) => c.id),
            checkTypes: criticalChecks.map((c) => c.checkType),
          }
        );
        alertCreated = true;
      }
    }

    if (pendingReviewChecks.length > 0 && !alertCreated) {
      const existingAlert = await this.findExistingAlert(organizationId, propertyId, "compliance");
      if (!existingAlert) {
        await this.createAlert(
          organizationId,
          propertyId,
          "compliance",
          "medium",
          `${pendingReviewChecks.length} Compliance Check(s) Pending Review`,
          `Property has ${pendingReviewChecks.length} compliance check(s) that need review.`,
          {
            pendingCount: pendingReviewChecks.length,
            checkIds: pendingReviewChecks.map((c) => c.id),
            checkTypes: pendingReviewChecks.map((c) => c.checkType),
          }
        );
        alertCreated = true;
      }
    }

    return alertCreated;
  }

  async createAlert(
    organizationId: number,
    propertyId: number,
    alertType: AlertType,
    severity: AlertSeverity,
    title: string,
    description: string,
    triggerData?: Record<string, any>
  ): Promise<PortfolioAlert> {
    const [alert] = await db
      .insert(portfolioAlerts)
      .values({
        organizationId,
        propertyId,
        alertType,
        severity,
        title,
        description,
        triggeredBy: "system",
        triggerData,
        status: "active",
      })
      .returning();

    await this.logAgentEvent(organizationId, "alert_created", {
      alertId: alert.id,
      alertType,
      severity,
      propertyId,
    });

    return alert;
  }

  async acknowledgeAlert(alertId: number, userId: number): Promise<PortfolioAlert | null> {
    const [updated] = await db
      .update(portfolioAlerts)
      .set({
        status: "acknowledged",
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(portfolioAlerts.id, alertId))
      .returning();

    return updated || null;
  }

  async resolveAlert(alertId: number, resolution: string): Promise<PortfolioAlert | null> {
    const [updated] = await db
      .update(portfolioAlerts)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolution,
        updatedAt: new Date(),
      })
      .where(eq(portfolioAlerts.id, alertId))
      .returning();

    return updated || null;
  }

  async dismissAlert(alertId: number): Promise<PortfolioAlert | null> {
    const [updated] = await db
      .update(portfolioAlerts)
      .set({
        status: "dismissed",
        updatedAt: new Date(),
      })
      .where(eq(portfolioAlerts.id, alertId))
      .returning();

    return updated || null;
  }

  async getActiveAlerts(
    organizationId: number,
    options: AlertFilterOptions = {}
  ): Promise<PortfolioAlert[]> {
    const conditions = [eq(portfolioAlerts.organizationId, organizationId)];

    if (options.status) {
      conditions.push(eq(portfolioAlerts.status, options.status));
    } else {
      conditions.push(
        or(
          eq(portfolioAlerts.status, "active"),
          eq(portfolioAlerts.status, "acknowledged")
        )!
      );
    }

    if (options.propertyId) {
      conditions.push(eq(portfolioAlerts.propertyId, options.propertyId));
    }

    if (options.alertTypes && options.alertTypes.length > 0) {
      conditions.push(
        sql`${portfolioAlerts.alertType} IN (${sql.join(
          options.alertTypes.map((t) => sql`${t}`),
          sql`, `
        )})`
      );
    }

    if (options.severities && options.severities.length > 0) {
      conditions.push(
        sql`${portfolioAlerts.severity} IN (${sql.join(
          options.severities.map((s) => sql`${s}`),
          sql`, `
        )})`
      );
    }

    const alerts = await db
      .select()
      .from(portfolioAlerts)
      .where(and(...conditions))
      .orderBy(
        sql`CASE ${portfolioAlerts.severity} 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          WHEN 'low' THEN 4 
          END`,
        desc(portfolioAlerts.createdAt)
      )
      .limit(options.limit || 50)
      .offset(options.offset || 0);

    return alerts;
  }

  async getPropertyAlerts(organizationId: number, propertyId: number): Promise<PortfolioAlert[]> {
    const alerts = await db
      .select()
      .from(portfolioAlerts)
      .where(
        and(
          eq(portfolioAlerts.organizationId, organizationId),
          eq(portfolioAlerts.propertyId, propertyId)
        )
      )
      .orderBy(desc(portfolioAlerts.createdAt));

    return alerts;
  }

  async generateAlertSummary(organizationId: number): Promise<string> {
    const activeAlerts = await this.getActiveAlerts(organizationId);

    if (activeAlerts.length === 0) {
      return "Your portfolio is healthy with no active alerts. All properties are performing as expected.";
    }

    const alertsByType: Record<string, number> = {};
    const alertsBySeverity: Record<string, number> = {};

    for (const alert of activeAlerts) {
      alertsByType[alert.alertType] = (alertsByType[alert.alertType] || 0) + 1;
      alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] || 0) + 1;
    }

    const criticalAlerts = activeAlerts.filter((a) => a.severity === "critical");
    const highAlerts = activeAlerts.filter((a) => a.severity === "high");

    const openai = getOpenAIClient();
    if (!openai) {
      return this.generateFallbackSummary(activeAlerts);
    }

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a portfolio management assistant. Generate a concise, actionable summary of the portfolio health based on the alerts provided. Focus on the most critical issues first.`,
          },
          {
            role: "user",
            content: `Generate a portfolio health summary based on these active alerts:

Total Active Alerts: ${activeAlerts.length}

By Severity:
- Critical: ${alertsBySeverity["critical"] || 0}
- High: ${alertsBySeverity["high"] || 0}
- Medium: ${alertsBySeverity["medium"] || 0}
- Low: ${alertsBySeverity["low"] || 0}

By Type:
${Object.entries(alertsByType)
  .map(([type, count]) => `- ${type}: ${count}`)
  .join("\n")}

Critical Alerts:
${criticalAlerts.map((a) => `- ${a.title}: ${a.description}`).join("\n") || "None"}

High Priority Alerts:
${highAlerts.slice(0, 5).map((a) => `- ${a.title}: ${a.description}`).join("\n") || "None"}

Provide a 2-3 paragraph summary with specific recommendations.`,
          },
        ],
        max_completion_tokens: 500,
      });

      return response.choices[0]?.message?.content || this.generateFallbackSummary(activeAlerts);
    } catch (error) {
      console.error("[portfolio-sentinel] Error generating AI summary:", error);
      return this.generateFallbackSummary(activeAlerts);
    }
  }

  async suggestActions(alertId: number): Promise<string[]> {
    const [alert] = await db
      .select()
      .from(portfolioAlerts)
      .where(eq(portfolioAlerts.id, alertId))
      .limit(1);

    if (!alert) {
      return ["Alert not found"];
    }

    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, alert.propertyId))
      .limit(1);

    const openai = getOpenAIClient();
    if (!openai) {
      return this.getDefaultActions(alert.alertType);
    }

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a land investment portfolio advisor. Suggest 3-5 specific, actionable steps to address the given alert. Be concise and practical.`,
          },
          {
            role: "user",
            content: `Suggest actions for this portfolio alert:

Alert Type: ${alert.alertType}
Severity: ${alert.severity}
Title: ${alert.title}
Description: ${alert.description}
Property: ${property?.address || "Unknown"} in ${property?.county || "Unknown"}, ${property?.state || "Unknown"}
Trigger Data: ${JSON.stringify(alert.triggerData || {})}

Provide 3-5 specific action items as a JSON array of strings.`,
          },
        ],
        max_completion_tokens: 300,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return parsed.actions || parsed.suggestions || this.getDefaultActions(alert.alertType);
      }
    } catch (error) {
      console.error("[portfolio-sentinel] Error generating action suggestions:", error);
    }

    return this.getDefaultActions(alert.alertType);
  }

  async getPortfolioHealthScore(organizationId: number): Promise<PortfolioHealthScore> {
    const activeAlerts = await this.getActiveAlerts(organizationId);

    const ownedProperties = await db
      .select()
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), eq(properties.status, "owned")));

    const alertCounts = {
      critical: activeAlerts.filter((a) => a.severity === "critical").length,
      high: activeAlerts.filter((a) => a.severity === "high").length,
      medium: activeAlerts.filter((a) => a.severity === "medium").length,
      low: activeAlerts.filter((a) => a.severity === "low").length,
    };

    const taxAlerts = activeAlerts.filter((a) => a.alertType === "tax_due").length;
    const marketAlerts = activeAlerts.filter((a) => a.alertType === "market_change").length;
    const complianceAlerts = activeAlerts.filter((a) => a.alertType === "compliance").length;
    const documentAlerts = activeAlerts.filter((a) => a.alertType === "document_expiring").length;

    const propertyCount = Math.max(ownedProperties.length, 1);

    const taxHealth = Math.max(0, 100 - (taxAlerts / propertyCount) * 50 - alertCounts.critical * 10);
    const marketPosition = Math.max(0, 100 - marketAlerts * 15);
    const complianceStatus = Math.max(0, 100 - complianceAlerts * 20 - alertCounts.critical * 15);
    const documentStatus = Math.max(0, 100 - documentAlerts * 10);

    const overallScore = Math.round(
      (taxHealth * 0.3 + marketPosition * 0.25 + complianceStatus * 0.25 + documentStatus * 0.2) -
        alertCounts.critical * 5 -
        alertCounts.high * 2
    );

    const recommendations: string[] = [];

    if (alertCounts.critical > 0) {
      recommendations.push(`Address ${alertCounts.critical} critical alert(s) immediately`);
    }
    if (taxAlerts > 0) {
      recommendations.push("Review and resolve tax-related issues to avoid penalties");
    }
    if (complianceAlerts > 0) {
      recommendations.push("Complete pending compliance reviews to maintain good standing");
    }
    if (documentAlerts > 0) {
      recommendations.push("Review expiring documents and take necessary action");
    }
    if (marketAlerts > 0) {
      recommendations.push("Evaluate pricing strategy based on market changes");
    }
    if (recommendations.length === 0) {
      recommendations.push("Portfolio is healthy - continue regular monitoring");
    }

    return {
      overallScore: Math.max(0, Math.min(100, overallScore)),
      breakdown: {
        taxHealth: Math.round(taxHealth),
        marketPosition: Math.round(marketPosition),
        complianceStatus: Math.round(complianceStatus),
        documentStatus: Math.round(documentStatus),
      },
      activeAlerts: alertCounts,
      recommendations,
    };
  }

  private async findExistingAlert(
    organizationId: number,
    propertyId: number,
    alertType: AlertType
  ): Promise<PortfolioAlert | null> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [existing] = await db
      .select()
      .from(portfolioAlerts)
      .where(
        and(
          eq(portfolioAlerts.organizationId, organizationId),
          eq(portfolioAlerts.propertyId, propertyId),
          eq(portfolioAlerts.alertType, alertType),
          or(eq(portfolioAlerts.status, "active"), eq(portfolioAlerts.status, "acknowledged")),
          gte(portfolioAlerts.createdAt, sevenDaysAgo)
        )
      )
      .limit(1);

    return existing || null;
  }

  private async logAgentEvent(
    organizationId: number,
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    try {
      await db.insert(agentEvents).values({
        organizationId,
        eventType,
        eventSource: "system",
        payload,
      });
    } catch (error) {
      console.error("[portfolio-sentinel] Failed to log agent event:", error);
    }
  }

  private generateFallbackSummary(alerts: PortfolioAlert[]): string {
    const criticalCount = alerts.filter((a) => a.severity === "critical").length;
    const highCount = alerts.filter((a) => a.severity === "high").length;

    let summary = `Your portfolio has ${alerts.length} active alert(s). `;

    if (criticalCount > 0) {
      summary += `There are ${criticalCount} critical issue(s) requiring immediate attention. `;
    }
    if (highCount > 0) {
      summary += `Additionally, ${highCount} high-priority alert(s) should be addressed soon. `;
    }

    summary += "Review the alerts dashboard for detailed information and recommended actions.";

    return summary;
  }

  private getDefaultActions(alertType: string): string[] {
    const defaultActions: Record<string, string[]> = {
      tax_due: [
        "Review current tax statement",
        "Verify payment deadline",
        "Schedule payment or set up payment plan",
        "Check for available exemptions",
      ],
      market_change: [
        "Review comparable sales in the area",
        "Update property valuation",
        "Adjust listing price if applicable",
        "Consider timing for sale or hold decision",
      ],
      competitor_activity: [
        "Analyze competitor listings",
        "Review pricing strategy",
        "Update marketing materials",
        "Consider promotional pricing",
      ],
      document_expiring: [
        "Review the expiring document",
        "Contact relevant parties for renewal",
        "Update records after renewal",
        "Set reminders for future expirations",
      ],
      compliance: [
        "Review compliance requirements",
        "Contact relevant authorities if needed",
        "Complete required documentation",
        "Schedule follow-up review",
      ],
      maintenance: [
        "Inspect the property",
        "Get quotes for repairs",
        "Schedule maintenance work",
        "Document completed work",
      ],
    };

    return defaultActions[alertType] || ["Review the alert details", "Take appropriate action"];
  }
}

export const portfolioSentinelService = new PortfolioSentinelService();
