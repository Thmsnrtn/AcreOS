import { db } from "../db";
import {
  complianceRules,
  complianceChecks,
  properties,
  agentEvents,
  type ComplianceRule,
  type ComplianceCheck,
  type InsertComplianceRule,
  type InsertComplianceCheck,
} from "@shared/schema";
import { eq, and, desc, isNull, or, sql, inArray } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

export type RuleType = "subdivision" | "building" | "zoning" | "environmental" | "disclosure" | "recording" | "tax";
export type CheckStatus = "pending" | "compliant" | "non_compliant" | "not_applicable" | "needs_review";

export const RULE_TYPES: RuleType[] = ["subdivision", "building", "zoning", "environmental", "disclosure", "recording", "tax"];
export const CHECK_STATUSES: CheckStatus[] = ["pending", "compliant", "non_compliant", "not_applicable", "needs_review"];

interface AddRuleParams {
  state: string;
  county?: string;
  municipality?: string;
  ruleType: RuleType;
  ruleName: string;
  ruleDescription?: string;
  requirements?: Array<{
    requirement: string;
    mandatory: boolean;
    deadline?: string;
    fee?: number;
    authority?: string;
  }>;
  triggers?: {
    acreageMin?: number;
    acreageMax?: number;
    transactionType?: string[];
    propertyType?: string[];
    useType?: string[];
    priceThreshold?: number;
  };
  penalties?: {
    description: string;
    fineRange?: { min: number; max: number };
    otherConsequences?: string[];
  };
  sourceUrl?: string;
  effectiveDate?: Date;
  expirationDate?: Date;
}

interface UpdateRuleParams {
  ruleName?: string;
  ruleDescription?: string;
  requirements?: Array<{
    requirement: string;
    mandatory: boolean;
    deadline?: string;
    fee?: number;
    authority?: string;
  }>;
  triggers?: {
    acreageMin?: number;
    acreageMax?: number;
    transactionType?: string[];
    propertyType?: string[];
    useType?: string[];
    priceThreshold?: number;
  };
  penalties?: {
    description: string;
    fineRange?: { min: number; max: number };
    otherConsequences?: string[];
  };
  sourceUrl?: string;
  effectiveDate?: Date;
  expirationDate?: Date;
  isActive?: boolean;
}

interface ComplianceFindings {
  isCompliant: boolean;
  issues?: string[];
  requiredActions?: string[];
  estimatedCost?: number;
  deadline?: string;
}

interface ComplianceOverview {
  totalProperties: number;
  compliantProperties: number;
  nonCompliantProperties: number;
  pendingChecks: number;
  needsReviewCount: number;
  byRuleType: Record<RuleType, { compliant: number; nonCompliant: number; pending: number }>;
}

interface CostEstimate {
  propertyId: number;
  totalEstimatedCost: number;
  breakdown: Array<{
    ruleId: number;
    ruleName: string;
    estimatedCost: number;
    requiredActions: string[];
  }>;
}

class ComplianceGuardianService {
  private async logAgentEvent(
    organizationId: number,
    eventType: string,
    payload: Record<string, any>,
    relatedEntityType?: string,
    relatedEntityId?: number
  ): Promise<void> {
    try {
      await db.insert(agentEvents).values({
        organizationId,
        eventType,
        eventSource: "system",
        payload,
        relatedEntityType,
        relatedEntityId,
      });
    } catch (error) {
      console.error(`[compliance-guardian] Failed to log agent event:`, error);
    }
  }

  async addRule(params: AddRuleParams): Promise<ComplianceRule> {
    const ruleData: InsertComplianceRule = {
      state: params.state,
      county: params.county,
      municipality: params.municipality,
      ruleType: params.ruleType,
      ruleName: params.ruleName,
      ruleDescription: params.ruleDescription,
      requirements: params.requirements,
      triggers: params.triggers,
      penalties: params.penalties,
      sourceUrl: params.sourceUrl,
      effectiveDate: params.effectiveDate,
      expirationDate: params.expirationDate,
      isActive: true,
    };

    const [rule] = await db.insert(complianceRules).values(ruleData).returning();
    
    console.log(`[compliance-guardian] Added rule ${rule.id}: ${rule.ruleName} for ${params.state}${params.county ? `/${params.county}` : ""}`);
    
    return rule;
  }

  async updateRule(ruleId: number, updates: UpdateRuleParams): Promise<ComplianceRule | null> {
    const updateData: Partial<ComplianceRule> = {
      ...updates,
      updatedAt: new Date(),
    };

    const [rule] = await db
      .update(complianceRules)
      .set(updateData)
      .where(eq(complianceRules.id, ruleId))
      .returning();

    if (rule) {
      console.log(`[compliance-guardian] Updated rule ${ruleId}: ${rule.ruleName}`);
    }

    return rule || null;
  }

  async deactivateRule(ruleId: number): Promise<ComplianceRule | null> {
    const [rule] = await db
      .update(complianceRules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(complianceRules.id, ruleId))
      .returning();

    if (rule) {
      console.log(`[compliance-guardian] Deactivated rule ${ruleId}: ${rule.ruleName}`);
    }

    return rule || null;
  }

  async getRulesForLocation(
    state: string,
    county?: string,
    municipality?: string
  ): Promise<ComplianceRule[]> {
    const conditions = [
      eq(complianceRules.state, state),
      eq(complianceRules.isActive, true),
    ];

    const rules = await db
      .select()
      .from(complianceRules)
      .where(
        and(
          ...conditions,
          or(
            isNull(complianceRules.expirationDate),
            sql`${complianceRules.expirationDate} > NOW()`
          )
        )
      )
      .orderBy(complianceRules.ruleType, complianceRules.ruleName);

    return rules.filter((rule) => {
      if (rule.county && county && rule.county.toLowerCase() !== county.toLowerCase()) {
        return false;
      }
      if (rule.municipality && municipality && rule.municipality.toLowerCase() !== municipality.toLowerCase()) {
        return false;
      }
      if (!rule.county && county) {
        return true;
      }
      if (!rule.municipality && municipality) {
        return true;
      }
      return true;
    });
  }

  async checkPropertyCompliance(
    organizationId: number,
    propertyId: number
  ): Promise<{ status: string; checks: ComplianceCheck[] }> {
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const applicableRules = await this.getRulesForLocation(
      property.state,
      property.county || undefined,
      property.city || undefined
    );

    const createdChecks: ComplianceCheck[] = [];
    const propertyAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 0;

    for (const rule of applicableRules) {
      if (!this.doesRuleApply(rule, property, propertyAcres)) {
        continue;
      }

      const existing = await db
        .select()
        .from(complianceChecks)
        .where(
          and(
            eq(complianceChecks.organizationId, organizationId),
            eq(complianceChecks.propertyId, propertyId),
            eq(complianceChecks.ruleId, rule.id)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        createdChecks.push(existing[0]);
        continue;
      }

      const checkData: InsertComplianceCheck = {
        organizationId,
        propertyId,
        ruleId: rule.id,
        checkType: rule.ruleType,
        checkDescription: `${rule.ruleName}: ${rule.ruleDescription || "Compliance check"}`,
        status: "pending",
        lastCheckedAt: new Date(),
      };

      const [check] = await db.insert(complianceChecks).values(checkData).returning();
      createdChecks.push(check);
    }

    await this.logAgentEvent(
      organizationId,
      "compliance_check_initiated",
      {
        propertyId,
        rulesChecked: createdChecks.length,
        propertyLocation: `${property.county}, ${property.state}`,
      },
      "property",
      propertyId
    );

    const statuses = createdChecks.map((c) => c.status);
    let overallStatus = "compliant";
    if (statuses.includes("non_compliant")) {
      overallStatus = "non_compliant";
    } else if (statuses.includes("pending") || statuses.includes("needs_review")) {
      overallStatus = "pending";
    }

    return { status: overallStatus, checks: createdChecks };
  }

  private doesRuleApply(
    rule: ComplianceRule,
    property: typeof properties.$inferSelect,
    propertyAcres: number
  ): boolean {
    const triggers = rule.triggers as {
      acreageMin?: number;
      acreageMax?: number;
      transactionType?: string[];
      propertyType?: string[];
      useType?: string[];
      priceThreshold?: number;
    } | null;

    if (!triggers) {
      return true;
    }

    if (triggers.acreageMin !== undefined && propertyAcres < triggers.acreageMin) {
      return false;
    }
    if (triggers.acreageMax !== undefined && propertyAcres > triggers.acreageMax) {
      return false;
    }

    if (triggers.propertyType && triggers.propertyType.length > 0) {
      const propertyZoning = property.zoning?.toLowerCase() || "";
      if (!triggers.propertyType.some((t) => propertyZoning.includes(t.toLowerCase()))) {
        return false;
      }
    }

    return true;
  }

  async runSingleCheck(
    organizationId: number,
    propertyId: number,
    ruleId: number
  ): Promise<ComplianceCheck> {
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const [rule] = await db
      .select()
      .from(complianceRules)
      .where(eq(complianceRules.id, ruleId))
      .limit(1);

    if (!rule) {
      throw new Error(`Rule ${ruleId} not found`);
    }

    let [check] = await db
      .select()
      .from(complianceChecks)
      .where(
        and(
          eq(complianceChecks.organizationId, organizationId),
          eq(complianceChecks.propertyId, propertyId),
          eq(complianceChecks.ruleId, ruleId)
        )
      )
      .limit(1);

    if (!check) {
      const checkData: InsertComplianceCheck = {
        organizationId,
        propertyId,
        ruleId,
        checkType: rule.ruleType,
        checkDescription: `${rule.ruleName}: ${rule.ruleDescription || "Compliance check"}`,
        status: "pending",
        lastCheckedAt: new Date(),
      };
      [check] = await db.insert(complianceChecks).values(checkData).returning();
    } else {
      [check] = await db
        .update(complianceChecks)
        .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
        .where(eq(complianceChecks.id, check.id))
        .returning();
    }

    return check;
  }

  async updateCheckStatus(
    checkId: number,
    status: CheckStatus,
    findings?: ComplianceFindings
  ): Promise<ComplianceCheck | null> {
    const updateData: Partial<ComplianceCheck> = {
      status,
      findings,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    };

    if (status === "compliant") {
      updateData.resolvedAt = new Date();
    }

    const [check] = await db
      .update(complianceChecks)
      .set(updateData)
      .where(eq(complianceChecks.id, checkId))
      .returning();

    if (check) {
      await this.logAgentEvent(
        check.organizationId,
        "compliance_check_updated",
        { checkId, status, findings },
        "property",
        check.propertyId
      );
    }

    return check || null;
  }

  async resolveCheck(checkId: number, resolutionNotes: string): Promise<ComplianceCheck | null> {
    const [check] = await db
      .update(complianceChecks)
      .set({
        status: "compliant",
        resolutionNotes,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(complianceChecks.id, checkId))
      .returning();

    if (check) {
      await this.logAgentEvent(
        check.organizationId,
        "compliance_check_resolved",
        { checkId, resolutionNotes },
        "property",
        check.propertyId
      );
    }

    return check || null;
  }

  async getPropertyComplianceStatus(
    organizationId: number,
    propertyId: number
  ): Promise<ComplianceCheck[]> {
    return db
      .select()
      .from(complianceChecks)
      .where(
        and(
          eq(complianceChecks.organizationId, organizationId),
          eq(complianceChecks.propertyId, propertyId)
        )
      )
      .orderBy(desc(complianceChecks.createdAt));
  }

  async getOrganizationComplianceOverview(organizationId: number): Promise<ComplianceOverview> {
    const allChecks = await db
      .select()
      .from(complianceChecks)
      .where(eq(complianceChecks.organizationId, organizationId));

    const propertyIds = new Set(allChecks.map((c) => c.propertyId));
    const compliantPropertyIds = new Set<number>();
    const nonCompliantPropertyIds = new Set<number>();

    for (const propertyId of Array.from(propertyIds)) {
      const propertyChecks = allChecks.filter((c) => c.propertyId === propertyId);
      const hasNonCompliant = propertyChecks.some((c) => c.status === "non_compliant");
      if (hasNonCompliant) {
        nonCompliantPropertyIds.add(propertyId);
      } else if (propertyChecks.every((c) => c.status === "compliant" || c.status === "not_applicable")) {
        compliantPropertyIds.add(propertyId);
      }
    }

    const byRuleType: ComplianceOverview["byRuleType"] = {} as any;
    for (const ruleType of RULE_TYPES) {
      byRuleType[ruleType] = { compliant: 0, nonCompliant: 0, pending: 0 };
    }

    for (const check of allChecks) {
      const ruleType = check.checkType as RuleType;
      if (byRuleType[ruleType]) {
        if (check.status === "compliant") {
          byRuleType[ruleType].compliant++;
        } else if (check.status === "non_compliant") {
          byRuleType[ruleType].nonCompliant++;
        } else {
          byRuleType[ruleType].pending++;
        }
      }
    }

    return {
      totalProperties: propertyIds.size,
      compliantProperties: compliantPropertyIds.size,
      nonCompliantProperties: nonCompliantPropertyIds.size,
      pendingChecks: allChecks.filter((c) => c.status === "pending").length,
      needsReviewCount: allChecks.filter((c) => c.status === "needs_review").length,
      byRuleType,
    };
  }

  async findNonCompliantProperties(
    organizationId: number
  ): Promise<Array<{ propertyId: number; issues: ComplianceCheck[] }>> {
    const nonCompliantChecks = await db
      .select()
      .from(complianceChecks)
      .where(
        and(
          eq(complianceChecks.organizationId, organizationId),
          eq(complianceChecks.status, "non_compliant")
        )
      );

    const propertyMap = new Map<number, ComplianceCheck[]>();
    for (const check of nonCompliantChecks) {
      const existing = propertyMap.get(check.propertyId) || [];
      existing.push(check);
      propertyMap.set(check.propertyId, existing);
    }

    return Array.from(propertyMap.entries()).map(([propertyId, issues]) => ({
      propertyId,
      issues,
    }));
  }

  async estimateComplianceCosts(propertyId: number): Promise<CostEstimate> {
    const checks = await db
      .select({
        check: complianceChecks,
        rule: complianceRules,
      })
      .from(complianceChecks)
      .leftJoin(complianceRules, eq(complianceChecks.ruleId, complianceRules.id))
      .where(
        and(
          eq(complianceChecks.propertyId, propertyId),
          eq(complianceChecks.status, "non_compliant")
        )
      );

    let totalEstimatedCost = 0;
    const breakdown: CostEstimate["breakdown"] = [];

    for (const { check, rule } of checks) {
      const findings = check.findings as ComplianceFindings | null;
      const estimatedCost = findings?.estimatedCost || 0;
      const requirements = rule?.requirements as Array<{ requirement: string; fee?: number }> | null;
      
      let ruleCost = estimatedCost;
      if (!ruleCost && requirements) {
        ruleCost = requirements.reduce((sum, r) => sum + (r.fee || 0), 0);
      }

      totalEstimatedCost += ruleCost;
      breakdown.push({
        ruleId: rule?.id || 0,
        ruleName: rule?.ruleName || check.checkType,
        estimatedCost: ruleCost,
        requiredActions: findings?.requiredActions || [],
      });
    }

    return {
      propertyId,
      totalEstimatedCost,
      breakdown,
    };
  }

  async generateComplianceReport(
    organizationId: number,
    propertyId: number
  ): Promise<string> {
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const checks = await db
      .select({
        check: complianceChecks,
        rule: complianceRules,
      })
      .from(complianceChecks)
      .leftJoin(complianceRules, eq(complianceChecks.ruleId, complianceRules.id))
      .where(
        and(
          eq(complianceChecks.organizationId, organizationId),
          eq(complianceChecks.propertyId, propertyId)
        )
      );

    const openai = getOpenAIClient();
    if (!openai) {
      const compliant = checks.filter((c) => c.check.status === "compliant").length;
      const nonCompliant = checks.filter((c) => c.check.status === "non_compliant").length;
      const pending = checks.filter((c) => c.check.status === "pending").length;

      return `
# Compliance Report for Property ${propertyId}

## Property Information
- **Location:** ${property.address || "N/A"}, ${property.city || ""}, ${property.county}, ${property.state}
- **APN:** ${property.apn}
- **Size:** ${property.sizeAcres} acres
- **Zoning:** ${property.zoning || "Unknown"}

## Compliance Summary
- **Total Checks:** ${checks.length}
- **Compliant:** ${compliant}
- **Non-Compliant:** ${nonCompliant}
- **Pending:** ${pending}

## Details
${checks
  .map(
    ({ check, rule }) =>
      `### ${rule?.ruleName || check.checkType}
- Status: ${check.status}
- Description: ${check.checkDescription || "N/A"}
`
  )
  .join("\n")}
      `.trim();
    }

    const prompt = `Generate a professional compliance report for a real estate property.

Property Details:
- Address: ${property.address || "N/A"}, ${property.city || ""}, ${property.county}, ${property.state}
- APN: ${property.apn}
- Size: ${property.sizeAcres} acres
- Zoning: ${property.zoning || "Unknown"}
- Status: ${property.status}

Compliance Checks:
${checks
  .map(
    ({ check, rule }) =>
      `- ${rule?.ruleName || check.checkType}: ${check.status}
  Description: ${check.checkDescription || "N/A"}
  Findings: ${JSON.stringify(check.findings || {})}
`
  )
  .join("")}

Generate a comprehensive compliance report in markdown format that includes:
1. Executive summary
2. Property overview
3. Compliance status by category
4. Identified issues and required actions
5. Recommendations for achieving full compliance
6. Estimated timeline and costs if available`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    });

    const report = response.choices[0]?.message?.content || "Unable to generate report";

    await this.logAgentEvent(
      organizationId,
      "compliance_report_generated",
      { propertyId, checksCount: checks.length },
      "property",
      propertyId
    );

    return report;
  }

  async scheduleComplianceReminders(organizationId: number): Promise<Array<{
    propertyId: number;
    checkId: number;
    ruleName: string;
    deadline: Date;
    daysRemaining: number;
  }>> {
    const checks = await db
      .select({
        check: complianceChecks,
        rule: complianceRules,
      })
      .from(complianceChecks)
      .leftJoin(complianceRules, eq(complianceChecks.ruleId, complianceRules.id))
      .where(
        and(
          eq(complianceChecks.organizationId, organizationId),
          or(
            eq(complianceChecks.status, "pending"),
            eq(complianceChecks.status, "non_compliant"),
            eq(complianceChecks.status, "needs_review")
          )
        )
      );

    const reminders: Array<{
      propertyId: number;
      checkId: number;
      ruleName: string;
      deadline: Date;
      daysRemaining: number;
    }> = [];

    const now = new Date();

    for (const { check, rule } of checks) {
      const findings = check.findings as ComplianceFindings | null;
      let deadline: Date | null = null;

      if (findings?.deadline) {
        deadline = new Date(findings.deadline);
      } else if (check.nextCheckDue) {
        deadline = new Date(check.nextCheckDue);
      }

      if (deadline && deadline > now) {
        const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysRemaining <= 30) {
          reminders.push({
            propertyId: check.propertyId,
            checkId: check.id,
            ruleName: rule?.ruleName || check.checkType,
            deadline,
            daysRemaining,
          });
        }
      }
    }

    reminders.sort((a, b) => a.daysRemaining - b.daysRemaining);

    if (reminders.length > 0) {
      await this.logAgentEvent(
        organizationId,
        "compliance_reminders_scheduled",
        { remindersCount: reminders.length, upcomingDeadlines: reminders.slice(0, 5) }
      );
    }

    return reminders;
  }

  async getRulesByType(state: string, ruleType: RuleType): Promise<ComplianceRule[]> {
    return db
      .select()
      .from(complianceRules)
      .where(
        and(
          eq(complianceRules.state, state),
          eq(complianceRules.ruleType, ruleType),
          eq(complianceRules.isActive, true),
          or(
            isNull(complianceRules.expirationDate),
            sql`${complianceRules.expirationDate} > NOW()`
          )
        )
      )
      .orderBy(complianceRules.county, complianceRules.ruleName);
  }
}

export const complianceGuardianService = new ComplianceGuardianService();
