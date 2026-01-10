import { db } from "../db";
import {
  buyerQualifications,
  buyerProfiles,
  leads,
  properties,
  agentEvents,
  type BuyerQualification,
  type InsertBuyerQualification,
  type BuyerProfile,
  type Property,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

type QualificationStatus = "pending" | "qualified" | "conditionally_qualified" | "not_qualified";
type RiskLevel = "low" | "medium" | "high";

interface FinancialCheckResult {
  proofOfFundsVerified: boolean;
  preApprovalStatus: string;
  creditStatus: string;
  debtToIncome: number | null;
  ownerFinanceEligible: boolean;
  score: number;
  notes: string[];
}

interface BackgroundCheckResult {
  identityVerified: boolean;
  referencesVerified: boolean;
  previousPurchases: number;
  score: number;
  notes: string[];
}

interface FinancingReadinessResult {
  cashAvailable: number | null;
  preApprovalStatus: string;
  downPaymentReady: boolean;
  monthlyPaymentCapacity: number | null;
  readinessScore: number;
  notes: string[];
}

interface AssessmentResult {
  overallScore: number;
  strengths: string[];
  concerns: string[];
  recommendations: string[];
  riskLevel: RiskLevel;
  closingProbability: number;
}

interface QualificationReport {
  qualificationId: number;
  buyerProfileId: number;
  status: QualificationStatus;
  assessment: AssessmentResult;
  financialSummary: string;
  backgroundSummary: string;
  overallRecommendation: string;
  generatedAt: string;
}

export class BuyerQualificationBotService {
  async startQualification(
    organizationId: number,
    buyerProfileId: number
  ): Promise<BuyerQualification> {
    const [profile] = await db.select().from(buyerProfiles)
      .where(and(eq(buyerProfiles.id, buyerProfileId), eq(buyerProfiles.organizationId, organizationId)));

    if (!profile) {
      throw new Error(`Buyer profile ${buyerProfileId} not found`);
    }

    const existingQualifications = await db.select().from(buyerQualifications)
      .where(and(
        eq(buyerQualifications.organizationId, organizationId),
        eq(buyerQualifications.buyerProfileId, buyerProfileId),
        eq(buyerQualifications.status, "pending")
      ));

    if (existingQualifications.length > 0) {
      return existingQualifications[0];
    }

    const qualification: InsertBuyerQualification = {
      organizationId,
      buyerProfileId,
      status: "pending",
      checks: {
        financialVerified: false,
        identityVerified: false,
        proofOfFunds: false,
        preApprovalLetter: false,
        references: false,
        backgroundCheck: false,
      },
      financingReadiness: {
        cashAvailable: undefined,
        preApprovalStatus: "unknown",
        creditStatus: "unknown",
        debtToIncome: undefined,
        downPaymentReady: false,
        ownerFinanceEligible: false,
      },
      assessment: {
        overallScore: 0,
        strengths: [],
        concerns: [],
        recommendations: ["Complete qualification process"],
        riskLevel: "medium",
        closingProbability: 0,
      },
    };

    const [inserted] = await db.insert(buyerQualifications)
      .values(qualification)
      .returning();

    await db.insert(agentEvents).values({
      organizationId,
      eventType: "buyer_qualification_started",
      eventSource: "system",
      payload: {
        qualificationId: inserted.id,
        buyerProfileId,
      },
      relatedEntityType: "buyer_profile",
      relatedEntityId: buyerProfileId,
    });

    return inserted;
  }

  async runFinancialCheck(qualificationId: number): Promise<FinancialCheckResult> {
    const [qualification] = await db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.id, qualificationId));

    if (!qualification) {
      throw new Error(`Qualification ${qualificationId} not found`);
    }

    const [profile] = await db.select().from(buyerProfiles)
      .where(eq(buyerProfiles.id, qualification.buyerProfileId));

    if (!profile) {
      throw new Error(`Buyer profile not found`);
    }

    const financialInfo = profile.financialInfo as {
      budget?: number;
      preApproved?: boolean;
      preApprovalAmount?: number;
      financingType?: string;
      downPaymentCapacity?: number;
      monthlyPaymentCapacity?: number;
      creditScoreRange?: string;
    } | null;

    const notes: string[] = [];
    let score = 50;

    const proofOfFundsVerified = !!(financialInfo?.budget && financialInfo.budget > 0);
    if (proofOfFundsVerified) {
      notes.push(`Budget indicated: $${financialInfo?.budget?.toLocaleString()}`);
      score += 15;
    } else {
      notes.push("No proof of funds on file");
      score -= 10;
    }

    let preApprovalStatus = "not_provided";
    if (financialInfo?.preApproved) {
      preApprovalStatus = "approved";
      notes.push(`Pre-approved for $${financialInfo.preApprovalAmount?.toLocaleString() || "amount not specified"}`);
      score += 20;
    } else if (financialInfo?.financingType === "cash") {
      preApprovalStatus = "cash_buyer";
      notes.push("Cash buyer - no pre-approval needed");
      score += 25;
    }

    let creditStatus = "unknown";
    if (financialInfo?.creditScoreRange) {
      creditStatus = financialInfo.creditScoreRange;
      if (creditStatus.includes("excellent") || creditStatus.includes("750")) {
        score += 15;
        notes.push("Excellent credit indicated");
      } else if (creditStatus.includes("good") || creditStatus.includes("700")) {
        score += 10;
        notes.push("Good credit indicated");
      } else if (creditStatus.includes("fair") || creditStatus.includes("650")) {
        score += 5;
        notes.push("Fair credit - may need owner financing");
      } else {
        score -= 5;
        notes.push("Credit status may be a concern");
      }
    }

    let debtToIncome: number | null = null;
    let ownerFinanceEligible = false;

    if (financialInfo?.monthlyPaymentCapacity && financialInfo?.budget) {
      debtToIncome = (financialInfo.monthlyPaymentCapacity * 12) / financialInfo.budget;
      if (debtToIncome < 0.28) {
        notes.push("Low debt-to-income ratio - strong position");
        score += 10;
      } else if (debtToIncome < 0.36) {
        notes.push("Acceptable debt-to-income ratio");
        score += 5;
      } else {
        notes.push("High debt-to-income ratio - may need owner financing");
        score -= 5;
      }
    }

    if (financialInfo?.financingType === "owner_finance" || 
        financialInfo?.downPaymentCapacity && financialInfo.downPaymentCapacity >= 0.1) {
      ownerFinanceEligible = true;
      notes.push("Eligible for owner financing");
    }

    score = Math.max(0, Math.min(100, score));

    const checks = (qualification.checks as Record<string, boolean>) || {};
    checks.financialVerified = true;
    checks.proofOfFunds = proofOfFundsVerified;
    checks.preApprovalLetter = preApprovalStatus === "approved";

    const financingReadiness = (qualification.financingReadiness as Record<string, any>) || {};
    financingReadiness.preApprovalStatus = preApprovalStatus;
    financingReadiness.creditStatus = creditStatus;
    financingReadiness.debtToIncome = debtToIncome;
    financingReadiness.ownerFinanceEligible = ownerFinanceEligible;
    financingReadiness.cashAvailable = financialInfo?.budget;

    await db.update(buyerQualifications)
      .set({
        checks,
        financingReadiness,
        updatedAt: new Date(),
      })
      .where(eq(buyerQualifications.id, qualificationId));

    await db.insert(agentEvents).values({
      organizationId: qualification.organizationId,
      eventType: "financial_check_completed",
      eventSource: "system",
      payload: {
        qualificationId,
        score,
        proofOfFundsVerified,
        preApprovalStatus,
      },
      relatedEntityType: "buyer_qualification",
      relatedEntityId: qualificationId,
    });

    return {
      proofOfFundsVerified,
      preApprovalStatus,
      creditStatus,
      debtToIncome,
      ownerFinanceEligible,
      score,
      notes,
    };
  }

  async runBackgroundChecks(qualificationId: number): Promise<BackgroundCheckResult> {
    const [qualification] = await db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.id, qualificationId));

    if (!qualification) {
      throw new Error(`Qualification ${qualificationId} not found`);
    }

    const [profile] = await db.select().from(buyerProfiles)
      .where(eq(buyerProfiles.id, qualification.buyerProfileId));

    if (!profile) {
      throw new Error(`Buyer profile not found`);
    }

    const notes: string[] = [];
    let score = 50;

    const intent = profile.intent as {
      previousPurchases?: number;
      purchaseTimeline?: string;
      urgency?: number;
    } | null;

    const engagement = profile.engagement as {
      inquiriesMade?: number;
      responsiveness?: string;
      lastContactDate?: string;
    } | null;

    let identityVerified = false;
    if (profile.leadId) {
      const [lead] = await db.select().from(leads)
        .where(eq(leads.id, profile.leadId));
      if (lead && lead.email && lead.phone) {
        identityVerified = true;
        notes.push("Identity verified via contact information");
        score += 15;
      }
    }

    let referencesVerified = false;
    if (engagement?.inquiriesMade && engagement.inquiriesMade >= 2) {
      referencesVerified = true;
      notes.push("Multiple positive interactions recorded");
      score += 10;
    }

    if (engagement?.responsiveness === "high") {
      notes.push("High responsiveness - engaged buyer");
      score += 10;
    } else if (engagement?.responsiveness === "low") {
      notes.push("Low responsiveness - may need follow-up");
      score -= 5;
    }

    const previousPurchases = intent?.previousPurchases || 0;
    if (previousPurchases > 0) {
      notes.push(`${previousPurchases} previous purchase(s) - experienced buyer`);
      score += previousPurchases * 5;
    } else {
      notes.push("First-time buyer");
    }

    score = Math.max(0, Math.min(100, score));

    const checks = (qualification.checks as Record<string, boolean>) || {};
    checks.identityVerified = identityVerified;
    checks.references = referencesVerified;
    checks.backgroundCheck = true;

    await db.update(buyerQualifications)
      .set({
        checks,
        updatedAt: new Date(),
      })
      .where(eq(buyerQualifications.id, qualificationId));

    await db.insert(agentEvents).values({
      organizationId: qualification.organizationId,
      eventType: "background_check_completed",
      eventSource: "system",
      payload: {
        qualificationId,
        score,
        identityVerified,
        previousPurchases,
      },
      relatedEntityType: "buyer_qualification",
      relatedEntityId: qualificationId,
    });

    return {
      identityVerified,
      referencesVerified,
      previousPurchases,
      score,
      notes,
    };
  }

  async assessFinancingReadiness(qualificationId: number): Promise<FinancingReadinessResult> {
    const [qualification] = await db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.id, qualificationId));

    if (!qualification) {
      throw new Error(`Qualification ${qualificationId} not found`);
    }

    const [profile] = await db.select().from(buyerProfiles)
      .where(eq(buyerProfiles.id, qualification.buyerProfileId));

    if (!profile) {
      throw new Error(`Buyer profile not found`);
    }

    const financialInfo = profile.financialInfo as {
      budget?: number;
      preApproved?: boolean;
      preApprovalAmount?: number;
      financingType?: string;
      downPaymentCapacity?: number;
      monthlyPaymentCapacity?: number;
    } | null;

    const notes: string[] = [];
    let readinessScore = 50;

    const cashAvailable = financialInfo?.budget || null;
    if (cashAvailable) {
      notes.push(`Cash available: $${cashAvailable.toLocaleString()}`);
      readinessScore += 15;
    }

    let preApprovalStatus = "not_provided";
    if (financialInfo?.preApproved) {
      preApprovalStatus = "approved";
      readinessScore += 20;
    } else if (financialInfo?.financingType === "cash") {
      preApprovalStatus = "cash_buyer";
      readinessScore += 25;
    }

    let downPaymentReady = false;
    if (financialInfo?.downPaymentCapacity && financialInfo.downPaymentCapacity >= 0.1) {
      downPaymentReady = true;
      notes.push(`Down payment capacity: ${(financialInfo.downPaymentCapacity * 100).toFixed(0)}%`);
      readinessScore += 10;
    }

    const monthlyPaymentCapacity = financialInfo?.monthlyPaymentCapacity || null;
    if (monthlyPaymentCapacity) {
      notes.push(`Monthly payment capacity: $${monthlyPaymentCapacity.toLocaleString()}`);
      readinessScore += 10;
    }

    readinessScore = Math.max(0, Math.min(100, readinessScore));

    const financingReadiness = (qualification.financingReadiness as Record<string, any>) || {};
    financingReadiness.cashAvailable = cashAvailable;
    financingReadiness.preApprovalStatus = preApprovalStatus;
    financingReadiness.downPaymentReady = downPaymentReady;

    await db.update(buyerQualifications)
      .set({
        financingReadiness,
        updatedAt: new Date(),
      })
      .where(eq(buyerQualifications.id, qualificationId));

    return {
      cashAvailable,
      preApprovalStatus,
      downPaymentReady,
      monthlyPaymentCapacity,
      readinessScore,
      notes,
    };
  }

  async generateAssessment(qualificationId: number): Promise<AssessmentResult> {
    const [qualification] = await db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.id, qualificationId));

    if (!qualification) {
      throw new Error(`Qualification ${qualificationId} not found`);
    }

    const [profile] = await db.select().from(buyerProfiles)
      .where(eq(buyerProfiles.id, qualification.buyerProfileId));

    if (!profile) {
      throw new Error(`Buyer profile not found`);
    }

    const financialCheck = await this.runFinancialCheck(qualificationId);
    const backgroundCheck = await this.runBackgroundChecks(qualificationId);
    const financingReadiness = await this.assessFinancingReadiness(qualificationId);

    const weights = {
      financial: 0.4,
      background: 0.25,
      financing: 0.35,
    };

    const overallScore = Math.round(
      financialCheck.score * weights.financial +
      backgroundCheck.score * weights.background +
      financingReadiness.readinessScore * weights.financing
    );

    const strengths: string[] = [];
    const concerns: string[] = [];
    const recommendations: string[] = [];

    if (financialCheck.proofOfFundsVerified) {
      strengths.push("Proof of funds verified");
    } else {
      concerns.push("No proof of funds on file");
      recommendations.push("Request proof of funds documentation");
    }

    if (financialCheck.preApprovalStatus === "approved" || financialCheck.preApprovalStatus === "cash_buyer") {
      strengths.push(financialCheck.preApprovalStatus === "cash_buyer" ? "Cash buyer" : "Pre-approved for financing");
    } else {
      recommendations.push("Obtain pre-approval letter or verify cash position");
    }

    if (backgroundCheck.identityVerified) {
      strengths.push("Identity verified");
    } else {
      concerns.push("Identity not fully verified");
      recommendations.push("Complete identity verification");
    }

    if (backgroundCheck.previousPurchases > 0) {
      strengths.push(`Experienced buyer with ${backgroundCheck.previousPurchases} previous purchase(s)`);
    }

    if (financingReadiness.downPaymentReady) {
      strengths.push("Down payment ready");
    } else {
      concerns.push("Down payment status unclear");
      recommendations.push("Confirm down payment availability");
    }

    if (financialCheck.ownerFinanceEligible) {
      strengths.push("Eligible for owner financing");
    }

    let riskLevel: RiskLevel = "medium";
    if (overallScore >= 75 && concerns.length <= 1) {
      riskLevel = "low";
    } else if (overallScore < 50 || concerns.length >= 3) {
      riskLevel = "high";
    }

    let closingProbability = overallScore;
    if (riskLevel === "low") closingProbability = Math.min(closingProbability + 10, 95);
    if (riskLevel === "high") closingProbability = Math.max(closingProbability - 15, 5);

    const openai = getOpenAIClient();
    if (openai) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a buyer qualification expert for land investment. Analyze the buyer's profile and provide additional insights.
Keep responses concise and actionable.`,
            },
            {
              role: "user",
              content: `Buyer Profile:
- Profile Type: ${profile.profileType}
- Financial Score: ${financialCheck.score}/100
- Background Score: ${backgroundCheck.score}/100
- Financing Readiness: ${financingReadiness.readinessScore}/100
- Strengths: ${strengths.join(", ") || "None identified"}
- Concerns: ${concerns.join(", ") || "None identified"}

Provide 1-2 additional recommendations to improve this buyer's closing probability.`,
            },
          ],
          max_tokens: 200,
          temperature: 0.3,
        });

        const aiRecommendation = response.choices[0]?.message?.content;
        if (aiRecommendation) {
          recommendations.push(aiRecommendation);
        }
      } catch (error) {
        console.error("AI assessment failed:", error);
      }
    }

    const assessment: AssessmentResult = {
      overallScore,
      strengths,
      concerns,
      recommendations,
      riskLevel,
      closingProbability,
    };

    await db.update(buyerQualifications)
      .set({
        assessment,
        updatedAt: new Date(),
      })
      .where(eq(buyerQualifications.id, qualificationId));

    await db.insert(agentEvents).values({
      organizationId: qualification.organizationId,
      eventType: "buyer_assessment_generated",
      eventSource: "system",
      payload: {
        qualificationId,
        overallScore,
        riskLevel,
        closingProbability,
      },
      relatedEntityType: "buyer_qualification",
      relatedEntityId: qualificationId,
    });

    return assessment;
  }

  async updateQualificationStatus(
    qualificationId: number,
    status: QualificationStatus
  ): Promise<BuyerQualification> {
    const [qualification] = await db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.id, qualificationId));

    if (!qualification) {
      throw new Error(`Qualification ${qualificationId} not found`);
    }

    const updateData: Partial<BuyerQualification> = {
      status,
      updatedAt: new Date(),
    };

    if (status === "qualified" || status === "conditionally_qualified") {
      updateData.qualifiedAt = new Date();
      updateData.qualifiedBy = "system";
    }

    const [updated] = await db.update(buyerQualifications)
      .set(updateData)
      .where(eq(buyerQualifications.id, qualificationId))
      .returning();

    await db.insert(agentEvents).values({
      organizationId: qualification.organizationId,
      eventType: "qualification_status_updated",
      eventSource: "system",
      payload: {
        qualificationId,
        previousStatus: qualification.status,
        newStatus: status,
      },
      relatedEntityType: "buyer_qualification",
      relatedEntityId: qualificationId,
    });

    return updated;
  }

  async getQualificationById(qualificationId: number): Promise<BuyerQualification | null> {
    const [qualification] = await db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.id, qualificationId));

    return qualification || null;
  }

  async getQualificationsByOrganization(organizationId: number): Promise<BuyerQualification[]> {
    return db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.organizationId, organizationId))
      .orderBy(desc(buyerQualifications.createdAt));
  }

  async getQualifiedBuyers(organizationId: number): Promise<BuyerQualification[]> {
    return db.select().from(buyerQualifications)
      .where(and(
        eq(buyerQualifications.organizationId, organizationId),
        sql`${buyerQualifications.status} IN ('qualified', 'conditionally_qualified')`
      ))
      .orderBy(desc(buyerQualifications.qualifiedAt));
  }

  async getHighRiskBuyers(organizationId: number): Promise<BuyerQualification[]> {
    const qualifications = await db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.organizationId, organizationId))
      .orderBy(desc(buyerQualifications.createdAt));

    return qualifications.filter(q => {
      const assessment = q.assessment as AssessmentResult | null;
      if (!assessment) return false;
      return assessment.riskLevel === "high" || assessment.concerns?.length >= 2;
    });
  }

  async generateQualificationReport(qualificationId: number): Promise<QualificationReport> {
    const [qualification] = await db.select().from(buyerQualifications)
      .where(eq(buyerQualifications.id, qualificationId));

    if (!qualification) {
      throw new Error(`Qualification ${qualificationId} not found`);
    }

    const assessment = qualification.assessment as AssessmentResult | null;
    if (!assessment || assessment.overallScore === 0) {
      const newAssessment = await this.generateAssessment(qualificationId);
      Object.assign(assessment || {}, newAssessment);
    }

    const checks = qualification.checks as Record<string, boolean> | null;
    const financingReadiness = qualification.financingReadiness as Record<string, any> | null;

    let financialSummary = "Financial assessment pending.";
    if (checks?.financialVerified) {
      const cashAvailable = financingReadiness?.cashAvailable;
      const preApproval = financingReadiness?.preApprovalStatus;
      financialSummary = `Cash available: ${cashAvailable ? `$${cashAvailable.toLocaleString()}` : "Not verified"}. Pre-approval: ${preApproval || "Unknown"}.`;
    }

    let backgroundSummary = "Background verification pending.";
    if (checks?.backgroundCheck) {
      const identity = checks.identityVerified ? "Verified" : "Pending";
      const refs = checks.references ? "Verified" : "Pending";
      backgroundSummary = `Identity: ${identity}. References: ${refs}.`;
    }

    let overallRecommendation = "";
    const openai = getOpenAIClient();
    if (openai && assessment) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a buyer qualification expert. Generate a concise overall recommendation (2-3 sentences) based on the buyer's qualification data.`,
            },
            {
              role: "user",
              content: `Status: ${qualification.status}
Score: ${assessment.overallScore}/100
Risk Level: ${assessment.riskLevel}
Closing Probability: ${assessment.closingProbability}%
Strengths: ${assessment.strengths?.join(", ") || "None"}
Concerns: ${assessment.concerns?.join(", ") || "None"}

Generate an overall recommendation.`,
            },
          ],
          max_tokens: 150,
          temperature: 0.3,
        });

        overallRecommendation = response.choices[0]?.message?.content || "";
      } catch (error) {
        console.error("AI report generation failed:", error);
      }
    }

    if (!overallRecommendation) {
      if (qualification.status === "qualified") {
        overallRecommendation = "Buyer is fully qualified and ready to proceed with property purchases.";
      } else if (qualification.status === "conditionally_qualified") {
        overallRecommendation = "Buyer is conditionally qualified. Address noted concerns before proceeding.";
      } else if (qualification.status === "not_qualified") {
        overallRecommendation = "Buyer does not meet qualification criteria at this time.";
      } else {
        overallRecommendation = "Qualification process is ongoing. Complete remaining checks for final assessment.";
      }
    }

    const report: QualificationReport = {
      qualificationId,
      buyerProfileId: qualification.buyerProfileId,
      status: qualification.status as QualificationStatus,
      assessment: assessment as AssessmentResult,
      financialSummary,
      backgroundSummary,
      overallRecommendation,
      generatedAt: new Date().toISOString(),
    };

    await db.insert(agentEvents).values({
      organizationId: qualification.organizationId,
      eventType: "qualification_report_generated",
      eventSource: "system",
      payload: {
        qualificationId,
        status: qualification.status,
      },
      relatedEntityType: "buyer_qualification",
      relatedEntityId: qualificationId,
    });

    return report;
  }

  async estimateClosingProbability(
    buyerProfileId: number,
    propertyId: number
  ): Promise<{ probability: number; factors: string[]; confidence: number }> {
    const [profile] = await db.select().from(buyerProfiles)
      .where(eq(buyerProfiles.id, buyerProfileId));

    if (!profile) {
      throw new Error(`Buyer profile ${buyerProfileId} not found`);
    }

    const [property] = await db.select().from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const factors: string[] = [];
    let probability = 50;
    let confidence = 70;

    const financialInfo = profile.financialInfo as {
      budget?: number;
      preApproved?: boolean;
      financingType?: string;
    } | null;

    const preferences = profile.preferences as {
      minAcreage?: number;
      maxAcreage?: number;
      minPrice?: number;
      maxPrice?: number;
      states?: string[];
    } | null;

    const listPrice = property.listPrice ? parseFloat(property.listPrice) : null;
    const budget = financialInfo?.budget;

    if (listPrice && budget) {
      if (budget >= listPrice * 1.1) {
        factors.push("Budget exceeds property price by 10%+");
        probability += 15;
      } else if (budget >= listPrice) {
        factors.push("Budget meets property price");
        probability += 10;
      } else if (budget >= listPrice * 0.8) {
        factors.push("Budget is 80-100% of property price");
        probability += 5;
      } else {
        factors.push("Budget may be insufficient");
        probability -= 15;
      }
    } else {
      confidence -= 15;
    }

    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : null;
    if (sizeAcres && preferences) {
      const minAcres = preferences.minAcreage || 0;
      const maxAcres = preferences.maxAcreage || Infinity;
      if (sizeAcres >= minAcres && sizeAcres <= maxAcres) {
        factors.push("Property size matches preferences");
        probability += 10;
      } else {
        factors.push("Property size outside preferences");
        probability -= 10;
      }
    }

    if (preferences?.states?.includes(property.state)) {
      factors.push("Property in preferred state");
      probability += 10;
    }

    if (financialInfo?.preApproved || financialInfo?.financingType === "cash") {
      factors.push("Buyer has financing ready");
      probability += 15;
    }

    const intent = profile.intent as { urgency?: number; purchaseTimeline?: string } | null;
    if (intent?.urgency && intent.urgency >= 7) {
      factors.push("High buyer urgency");
      probability += 10;
    }

    if (intent?.purchaseTimeline === "immediate" || intent?.purchaseTimeline === "1_month") {
      factors.push("Short purchase timeline");
      probability += 10;
    }

    probability = Math.max(5, Math.min(95, probability));
    confidence = Math.max(30, Math.min(95, confidence));

    await db.insert(agentEvents).values({
      organizationId: profile.organizationId,
      eventType: "closing_probability_estimated",
      eventSource: "system",
      payload: {
        buyerProfileId,
        propertyId,
        probability,
        factors,
      },
      relatedEntityType: "property",
      relatedEntityId: propertyId,
    });

    return { probability, factors, confidence };
  }
}

export const buyerQualificationBotService = new BuyerQualificationBotService();
