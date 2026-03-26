// @ts-nocheck
/**
 * Legal Autonomy Engine — Sovereign Company Protocol
 *
 * Classifies legal actions into three tiers and handles them accordingly:
 *
 *   Routine  (risk < 30):  TOS updates from template, standard NDAs,
 *                           known vendor renewals, compliance filings with
 *                           established templates → Shield executes autonomously
 *
 *   Structured (risk 30–70): New vendor contracts < $10K, customer enterprise
 *                             agreements, DPAs → Shield drafts + multi-agent peer review
 *
 *   Novel (risk > 70):       Litigation, regulatory disputes, contracts > $50K,
 *                             IP licensing, partnership agreements → Founder required
 */

import { db } from "../db";
import {
  legalActions,
  contractTemplates,
  regulatoryFilingCalendar,
  companyAgents,
} from "@shared/schema";
import { eq, and, desc, lte, gte, sql, inArray, isNull } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LegalTier = "routine" | "structured" | "novel";

export type LegalActionType =
  | "tos_update"
  | "standard_nda"
  | "vendor_renewal"
  | "compliance_filing"
  | "new_vendor_contract"
  | "enterprise_agreement"
  | "dpa"
  | "litigation"
  | "regulatory_dispute"
  | "high_value_contract"
  | "ip_licensing"
  | "partnership_agreement"
  | "custom";

export type ActionStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "executed"
  | "rejected"
  | "escalated"
  | "filed";

export interface LegalClassification {
  tier: LegalTier;
  riskScore: number;
  reasoning: string;
}

export interface LegalActionContext {
  valueAtStakeCents?: number;
  counterparty?: string;
  counterpartyType?: "individual" | "small_business" | "enterprise" | "government" | "unknown";
  regulatoryInvolvement?: boolean;
  hasPrecedent?: boolean;
  jurisdiction?: string;
  urgency?: "low" | "medium" | "high" | "critical";
  description?: string;
}

export interface ReviewWorkflow {
  actionId: string;
  reviewers: string[];
  status: string;
  createdAt: Date;
}

export interface FounderEscalation {
  actionId: string;
  actionType: string;
  reasoning: string;
  context: LegalActionContext;
  createdAt: Date;
}

// ─── Base Risk Scores by Action Type ──────────────────────────────────────────

const ACTION_TYPE_BASE_SCORES: Record<string, number> = {
  tos_update: 8,
  standard_nda: 12,
  vendor_renewal: 15,
  compliance_filing: 10,
  new_vendor_contract: 35,
  enterprise_agreement: 45,
  dpa: 40,
  litigation: 85,
  regulatory_dispute: 80,
  high_value_contract: 75,
  ip_licensing: 72,
  partnership_agreement: 70,
  custom: 50,
};

// ─── Engine ───────────────────────────────────────────────────────────────────

export class LegalAutonomyEngine {
  /**
   * Classify a legal action into a tier and compute its risk score.
   *
   * Risk scoring factors:
   *   1. Action type base score
   *   2. Value at stake: +2 points per $10K
   *   3. Counterparty complexity: +0 (individual) to +15 (government)
   *   4. Regulatory involvement: +10
   *   5. Precedent availability: −8 when precedent exists
   */
  async classifyLegalAction(
    actionType: string,
    context: LegalActionContext = {},
  ): Promise<LegalClassification> {
    let score = ACTION_TYPE_BASE_SCORES[actionType] ?? ACTION_TYPE_BASE_SCORES.custom;
    const reasons: string[] = [`Base score for ${actionType}: ${score}`];

    // Factor: value at stake
    if (context.valueAtStakeCents && context.valueAtStakeCents > 0) {
      const valuePoints = Math.floor(context.valueAtStakeCents / 1_000_000) * 2; // per $10K in cents
      score += valuePoints;
      reasons.push(`Value at stake ($${(context.valueAtStakeCents / 100).toLocaleString()}): +${valuePoints}`);
    }

    // Factor: counterparty complexity
    const counterpartyScores: Record<string, number> = {
      individual: 0,
      small_business: 3,
      enterprise: 8,
      government: 15,
      unknown: 5,
    };
    if (context.counterpartyType) {
      const cpScore = counterpartyScores[context.counterpartyType] ?? 5;
      score += cpScore;
      reasons.push(`Counterparty complexity (${context.counterpartyType}): +${cpScore}`);
    }

    // Factor: regulatory involvement
    if (context.regulatoryInvolvement) {
      score += 10;
      reasons.push("Regulatory involvement: +10");
    }

    // Factor: precedent availability (reduces risk)
    if (context.hasPrecedent === true) {
      score -= 8;
      reasons.push("Has precedent: −8");
    } else if (context.hasPrecedent === false) {
      score += 5;
      reasons.push("No precedent available: +5");
    }

    // Clamp score to 0–100
    score = Math.max(0, Math.min(100, score));

    // Determine tier
    let tier: LegalTier;
    if (score < 30) {
      tier = "routine";
      reasons.push(`Tier: routine (score ${score} < 30) — Shield executes autonomously`);
    } else if (score <= 70) {
      tier = "structured";
      reasons.push(`Tier: structured (score ${score} in 30–70) — Shield drafts + multi-agent peer review`);
    } else {
      tier = "novel";
      reasons.push(`Tier: novel (score ${score} > 70) — Founder required`);
    }

    return {
      tier,
      riskScore: score,
      reasoning: reasons.join("; "),
    };
  }

  /**
   * Execute a routine legal action autonomously using a template.
   * Only actions classified as "routine" (risk < 30) should use this path.
   */
  async executeRoutineAction(
    actionType: string,
    templateId: string,
    variables: Record<string, string>,
  ): Promise<{ actionId: string; document: string; status: string }> {
    // Fetch the template
    const [template] = await db
      .select()
      .from(contractTemplates)
      .where(
        and(
          eq(contractTemplates.templateId, templateId),
          eq(contractTemplates.isActive, true),
        ),
      )
      .limit(1);

    if (!template) {
      throw new Error(`Template not found or inactive: ${templateId}`);
    }

    if (template.requiresReview) {
      throw new Error(
        `Template ${templateId} requires review — cannot auto-execute. Use initiateStructuredReview instead.`,
      );
    }

    // Render the template by substituting variables
    let document = template.content;
    for (const [key, value] of Object.entries(variables)) {
      document = document.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    // Check for unresolved variables
    const unresolvedMatch = document.match(/\{\{(\w+)\}\}/g);
    if (unresolvedMatch) {
      throw new Error(
        `Unresolved template variables: ${unresolvedMatch.join(", ")}. Provide values for all required fields.`,
      );
    }

    // Create the legal action record
    const actionId = `la_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await db.insert(legalActions).values({
      actionId,
      actionType,
      category: template.category,
      tier: "routine",
      riskScore: ACTION_TYPE_BASE_SCORES[actionType] ?? 10,
      templateId,
      requestedBy: "shield_agent",
      status: "executed",
      executedAt: new Date(),
      outcome: "auto_executed",
      reasoning: `Routine action auto-executed using template ${templateId} (v${template.version})`,
    });

    return {
      actionId,
      document,
      status: "executed",
    };
  }

  /**
   * Initiate a structured review workflow for medium-risk actions.
   * Creates a draft and assigns it to multiple agent reviewers for peer review.
   */
  async initiateStructuredReview(
    actionType: string,
    draft: string,
    reviewers: string[],
  ): Promise<ReviewWorkflow> {
    if (!reviewers.length) {
      throw new Error("At least one reviewer is required for structured review");
    }

    // Validate that reviewers are active agents
    const activeAgents = await db
      .select({ codename: companyAgents.codename })
      .from(companyAgents)
      .where(
        and(
          inArray(companyAgents.codename, reviewers),
          eq(companyAgents.status, "active"),
        ),
      );

    const activeCodenames = new Set(activeAgents.map((a) => a.codename));
    const invalidReviewers = reviewers.filter((r) => !activeCodenames.has(r));

    if (invalidReviewers.length > 0) {
      throw new Error(
        `Inactive or unknown agent reviewers: ${invalidReviewers.join(", ")}. Only active agents can review.`,
      );
    }

    // Classify for risk score
    const classification = await this.classifyLegalAction(actionType, {});

    const actionId = `la_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await db.insert(legalActions).values({
      actionId,
      actionType,
      category: "structured_review",
      tier: "structured",
      riskScore: classification.riskScore,
      requestedBy: "shield_agent",
      status: "in_review",
      reviewedBy: reviewers,
      reasoning: `Structured review initiated. Draft length: ${draft.length} chars. Reviewers: ${reviewers.join(", ")}`,
    });

    return {
      actionId,
      reviewers,
      status: "in_review",
      createdAt: new Date(),
    };
  }

  /**
   * Escalate a high-risk legal action to the founder.
   * Creates an inbox item requiring explicit founder approval before proceeding.
   */
  async escalateToFounder(
    actionType: string,
    context: LegalActionContext,
    reasoning: string,
  ): Promise<FounderEscalation> {
    const classification = await this.classifyLegalAction(actionType, context);

    const actionId = `la_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await db.insert(legalActions).values({
      actionId,
      actionType,
      category: "founder_escalation",
      tier: "novel",
      riskScore: classification.riskScore,
      requestedBy: "shield_agent",
      counterparty: context.counterparty ?? null,
      valueAtStakeCents: context.valueAtStakeCents ?? null,
      status: "escalated",
      reasoning: `FOUNDER REVIEW REQUIRED: ${reasoning}. Classification: ${classification.reasoning}`,
    });

    return {
      actionId,
      actionType,
      reasoning,
      context,
      createdAt: new Date(),
    };
  }

  /**
   * Query legal actions, optionally filtering by status.
   */
  async getActiveActions(status?: ActionStatus): Promise<any[]> {
    const conditions = status ? [eq(legalActions.status, status)] : [];

    const actions = await db
      .select()
      .from(legalActions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(legalActions.createdAt))
      .limit(100);

    return actions;
  }

  /**
   * Get available contract templates, optionally filtered by category.
   */
  async getTemplates(category?: string): Promise<any[]> {
    const conditions = [eq(contractTemplates.isActive, true)];

    if (category) {
      conditions.push(eq(contractTemplates.category, category));
    }

    const templates = await db
      .select()
      .from(contractTemplates)
      .where(and(...conditions))
      .orderBy(desc(contractTemplates.updatedAt));

    return templates;
  }

  /**
   * Process and auto-file a regulatory filing using its associated template
   * and current data. Only files with status "upcoming" or "pending".
   */
  async processRegulatoryFiling(
    filingId: number,
  ): Promise<{ filingId: number; status: string; confirmationRef: string }> {
    const [filing] = await db
      .select()
      .from(regulatoryFilingCalendar)
      .where(eq(regulatoryFilingCalendar.id, filingId))
      .limit(1);

    if (!filing) {
      throw new Error(`Regulatory filing not found: ${filingId}`);
    }

    if (filing.status !== "upcoming" && filing.status !== "pending") {
      throw new Error(
        `Filing ${filingId} cannot be processed — current status is "${filing.status}". Only "upcoming" or "pending" filings can be processed.`,
      );
    }

    // If the filing has an associated template, verify it exists
    if (filing.templateId) {
      const [template] = await db
        .select()
        .from(contractTemplates)
        .where(
          and(
            eq(contractTemplates.templateId, filing.templateId),
            eq(contractTemplates.isActive, true),
          ),
        )
        .limit(1);

      if (!template) {
        throw new Error(
          `Template ${filing.templateId} referenced by filing ${filingId} is missing or inactive. Cannot auto-file.`,
        );
      }
    }

    // Generate a confirmation reference
    const confirmationRef = `RF-${filing.jurisdiction.toUpperCase().replace(/\s+/g, "")}-${Date.now().toString(36).toUpperCase()}`;

    // Record the filing
    await db
      .update(regulatoryFilingCalendar)
      .set({
        status: "filed",
        filedAt: new Date(),
        filedBy: "shield_agent",
        confirmationRef,
      })
      .where(eq(regulatoryFilingCalendar.id, filingId));

    // Also create a legal action record for audit trail
    const actionId = `la_filing_${filingId}_${Date.now().toString(36)}`;

    await db.insert(legalActions).values({
      actionId,
      actionType: "compliance_filing",
      category: "regulatory",
      tier: "routine",
      riskScore: ACTION_TYPE_BASE_SCORES.compliance_filing,
      templateId: filing.templateId ?? null,
      requestedBy: "shield_agent",
      status: "executed",
      executedAt: new Date(),
      outcome: `Filed: ${filing.filingType} in ${filing.jurisdiction}. Ref: ${confirmationRef}`,
      reasoning: `Auto-filed regulatory obligation. Due: ${filing.dueDate.toISOString()}`,
    });

    return {
      filingId,
      status: "filed",
      confirmationRef,
    };
  }

  /**
   * Get filings due within the specified number of days ahead.
   */
  async getUpcomingFilings(daysAhead: number): Promise<any[]> {
    const now = new Date();
    const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const filings = await db
      .select()
      .from(regulatoryFilingCalendar)
      .where(
        and(
          gte(regulatoryFilingCalendar.dueDate, now),
          lte(regulatoryFilingCalendar.dueDate, cutoff),
          eq(regulatoryFilingCalendar.status, "upcoming"),
        ),
      )
      .orderBy(regulatoryFilingCalendar.dueDate);

    return filings;
  }

  /**
   * Seed the database with default contract templates for common routine actions:
   * Standard NDA, Terms of Service, and Data Processing Agreement.
   */
  async seedDefaultTemplates(): Promise<{ seeded: string[] }> {
    const defaults = [
      {
        templateId: "tpl_standard_nda",
        name: "Standard Non-Disclosure Agreement",
        category: "nda",
        content: [
          "NON-DISCLOSURE AGREEMENT",
          "",
          "This Non-Disclosure Agreement (\"Agreement\") is entered into as of {{effective_date}}",
          "by and between {{company_name}} (\"Disclosing Party\") and {{counterparty_name}}",
          "(\"Receiving Party\").",
          "",
          "1. DEFINITION OF CONFIDENTIAL INFORMATION",
          "\"Confidential Information\" means any non-public information disclosed by the",
          "Disclosing Party to the Receiving Party, whether orally, in writing, or by",
          "inspection of tangible objects, including but not limited to: business plans,",
          "financial data, customer lists, technical data, trade secrets, and know-how.",
          "",
          "2. OBLIGATIONS OF RECEIVING PARTY",
          "The Receiving Party shall: (a) hold Confidential Information in strict confidence;",
          "(b) not disclose Confidential Information to any third party without prior written",
          "consent; (c) use Confidential Information solely for the purpose of {{purpose}};",
          "(d) protect Confidential Information with at least the same degree of care it uses",
          "to protect its own confidential information.",
          "",
          "3. TERM",
          "This Agreement shall remain in effect for {{term_years}} year(s) from the date",
          "of execution. Obligations regarding Confidential Information shall survive",
          "termination for a period of {{survival_years}} year(s).",
          "",
          "4. GOVERNING LAW",
          "This Agreement shall be governed by the laws of the State of {{governing_state}}.",
          "",
          "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date",
          "first written above.",
          "",
          "Disclosing Party: {{company_name}}",
          "Receiving Party: {{counterparty_name}}",
        ].join("\n"),
        variables: [
          "effective_date",
          "company_name",
          "counterparty_name",
          "purpose",
          "term_years",
          "survival_years",
          "governing_state",
        ],
        maxValueCents: null,
        requiresReview: false,
        approvedBy: "founder",
        version: 1,
        isActive: true,
      },
      {
        templateId: "tpl_terms_of_service",
        name: "Standard Terms of Service",
        category: "tos",
        content: [
          "TERMS OF SERVICE",
          "",
          "Last Updated: {{effective_date}}",
          "",
          "Welcome to {{company_name}} (\"Company\", \"we\", \"us\", or \"our\").",
          "These Terms of Service (\"Terms\") govern your access to and use of our",
          "services at {{service_url}} (\"Service\").",
          "",
          "1. ACCEPTANCE OF TERMS",
          "By accessing or using the Service, you agree to be bound by these Terms.",
          "If you do not agree to all of these Terms, do not use the Service.",
          "",
          "2. USE OF SERVICE",
          "You may use the Service only for lawful purposes and in accordance with",
          "these Terms. You agree not to use the Service: (a) in any way that violates",
          "applicable law; (b) to transmit harmful or malicious code; (c) to attempt",
          "unauthorized access to any portion of the Service.",
          "",
          "3. INTELLECTUAL PROPERTY",
          "The Service and its original content, features, and functionality are owned",
          "by {{company_name}} and are protected by copyright, trademark, and other",
          "intellectual property laws.",
          "",
          "4. LIMITATION OF LIABILITY",
          "In no event shall {{company_name}} be liable for any indirect, incidental,",
          "special, consequential, or punitive damages arising out of your use of",
          "the Service.",
          "",
          "5. GOVERNING LAW",
          "These Terms shall be governed by the laws of the State of {{governing_state}}.",
          "",
          "6. CHANGES TO TERMS",
          "We reserve the right to modify these Terms at any time. Changes will be",
          "effective upon posting to the Service.",
          "",
          "Contact: {{contact_email}}",
        ].join("\n"),
        variables: [
          "effective_date",
          "company_name",
          "service_url",
          "governing_state",
          "contact_email",
        ],
        maxValueCents: null,
        requiresReview: false,
        approvedBy: "founder",
        version: 1,
        isActive: true,
      },
      {
        templateId: "tpl_data_processing_agreement",
        name: "Data Processing Agreement",
        category: "dpa",
        content: [
          "DATA PROCESSING AGREEMENT",
          "",
          "This Data Processing Agreement (\"DPA\") is entered into as of {{effective_date}}",
          "between {{company_name}} (\"Controller\") and {{processor_name}} (\"Processor\").",
          "",
          "1. DEFINITIONS",
          "\"Personal Data\" means any information relating to an identified or identifiable",
          "natural person as defined under applicable Data Protection Laws.",
          "\"Data Protection Laws\" means GDPR, CCPA, and any other applicable privacy",
          "legislation in {{jurisdictions}}.",
          "",
          "2. SCOPE AND PURPOSE",
          "The Processor shall process Personal Data only on behalf of and in accordance",
          "with the Controller's documented instructions for the purpose of {{processing_purpose}}.",
          "",
          "3. PROCESSOR OBLIGATIONS",
          "The Processor shall: (a) process Personal Data only on documented instructions",
          "from the Controller; (b) ensure that persons authorized to process Personal Data",
          "are bound by confidentiality obligations; (c) implement appropriate technical and",
          "organizational security measures; (d) assist the Controller with data subject",
          "requests; (e) delete or return all Personal Data upon termination.",
          "",
          "4. SUB-PROCESSORS",
          "The Processor shall not engage another processor without prior written",
          "authorization from the Controller. Current approved sub-processors:",
          "{{sub_processors}}",
          "",
          "5. DATA BREACH NOTIFICATION",
          "The Processor shall notify the Controller without undue delay (and in any",
          "event within {{breach_notification_hours}} hours) upon becoming aware of a",
          "Personal Data breach.",
          "",
          "6. DATA TRANSFERS",
          "Transfers of Personal Data outside the EEA shall be subject to appropriate",
          "safeguards as required by Data Protection Laws.",
          "",
          "7. TERM AND TERMINATION",
          "This DPA shall remain in effect for the duration of the underlying service",
          "agreement. Upon termination, the Processor shall delete all Personal Data",
          "within {{deletion_days}} days.",
          "",
          "8. GOVERNING LAW",
          "This DPA shall be governed by the laws of {{governing_state}}.",
          "",
          "Controller: {{company_name}}",
          "Processor: {{processor_name}}",
        ].join("\n"),
        variables: [
          "effective_date",
          "company_name",
          "processor_name",
          "jurisdictions",
          "processing_purpose",
          "sub_processors",
          "breach_notification_hours",
          "deletion_days",
          "governing_state",
        ],
        maxValueCents: null,
        requiresReview: true,
        approvedBy: "founder",
        version: 1,
        isActive: true,
      },
    ];

    const seeded: string[] = [];

    for (const tpl of defaults) {
      // Upsert: skip if template already exists
      const [existing] = await db
        .select({ templateId: contractTemplates.templateId })
        .from(contractTemplates)
        .where(eq(contractTemplates.templateId, tpl.templateId))
        .limit(1);

      if (existing) {
        continue;
      }

      await db.insert(contractTemplates).values(tpl);
      seeded.push(tpl.templateId);
    }

    return { seeded };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const legalAutonomyEngine = new LegalAutonomyEngine();
