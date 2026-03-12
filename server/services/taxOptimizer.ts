/**
 * Tax Optimization Engine
 *
 * Comprehensive year-end tax planning for land investors:
 * - Capital gains analysis (short-term vs long-term)
 * - Depreciation optimization (cost segregation opportunities)
 * - 1031 exchange candidate identification
 * - Installment sale analysis
 * - Loss harvesting opportunities
 * - State tax considerations
 * - Dealer vs investor status analysis
 */

import { db } from "../db";
import {
  deals,
  properties,
  payments,
  organizations,
  valuationPredictions,
} from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ─── Tax Rate Tables ──────────────────────────────────────────────────────

const FEDERAL_LTCG_RATES = [
  { maxIncome: 47025, rate: 0 },      // Single 2024
  { maxIncome: 518900, rate: 0.15 },
  { maxIncome: Infinity, rate: 0.20 },
];

const FEDERAL_STCG_RATES = [
  { maxIncome: 11600, rate: 0.10 },   // Single 2024 ordinary income brackets
  { maxIncome: 47150, rate: 0.12 },
  { maxIncome: 100525, rate: 0.22 },
  { maxIncome: 191950, rate: 0.24 },
  { maxIncome: 243725, rate: 0.32 },
  { maxIncome: 609350, rate: 0.35 },
  { maxIncome: Infinity, rate: 0.37 },
];

// Net Investment Income Tax (NIIT) applies at 3.8% above $200k (single)
const NIIT_THRESHOLD_SINGLE = 200000;
const NIIT_RATE = 0.038;

// ─── Types ────────────────────────────────────────────────────────────────

export interface TaxableTransaction {
  dealId: number;
  propertyId?: number;
  propertyAddress?: string;
  county?: string;
  state?: string;
  acquisitionDate?: Date;
  dispositionDate?: Date;
  acquisitionCost: number;
  saleProceeds: number;
  improvementCosts: number;
  closingCosts: number;
  realizedGain: number;
  holdingPeriodDays: number;
  isLongTerm: boolean;
  gainType: "capital" | "ordinary";  // Ordinary if dealer status
  estimatedTax: number;
  taxSavingOpportunities: string[];
}

export interface TaxPositionSummary {
  taxYear: number;
  totalRealizedGains: number;
  longTermGains: number;
  shortTermGains: number;
  unrealizedGains: number;
  potentialLosses: number;
  estimatedFederalTax: number;
  estimatedNIIT: number;
  totalEstimatedTax: number;
  transactions: TaxableTransaction[];
  recommendations: TaxRecommendation[];
  installmentSaleOpportunities: InstallmentSaleAnalysis[];
  exchange1031Candidates: Exchange1031Candidate[];
  generatedAt: Date;
}

export interface TaxRecommendation {
  priority: "critical" | "high" | "medium" | "low";
  category: "1031_exchange" | "installment_sale" | "loss_harvesting" | "timing" | "dealer_status" | "depreciation" | "qoz";
  title: string;
  description: string;
  estimatedSavings: number;
  deadline?: string;
  actionItems: string[];
}

export interface InstallmentSaleAnalysis {
  dealId: number;
  propertyAddress: string;
  totalGain: number;
  spreadOverYears: number;
  annualGain: number;
  annualTaxSavings: number;
  eligible: boolean;
  notes: string;
}

export interface Exchange1031Candidate {
  dealId: number;
  propertyAddress: string;
  gain: number;
  deadline45Day: Date;
  deadline180Day: Date;
  requiredReplacementValue: number;
  potentialTaxDeferred: number;
}

// ─── Tax Optimizer Service ────────────────────────────────────────────────

class TaxOptimizerService {
  /**
   * Full year-end tax position analysis
   */
  async analyzeYearEndPosition(
    organizationId: number,
    taxYear: number
  ): Promise<TaxPositionSummary> {
    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31);

    // Get all closed deals this year
    const closedDeals = await db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.organizationId, organizationId),
          eq(deals.status, "closed"),
          gte(deals.closingDate, yearStart),
          lte(deals.closingDate, yearEnd)
        )
      );

    // Get all properties
    const orgProperties = await db
      .select()
      .from(properties)
      .where(eq(properties.organizationId, organizationId));

    const propMap = new Map(orgProperties.map(p => [p.id, p]));

    // Build taxable transactions
    const transactions: TaxableTransaction[] = [];

    for (const deal of closedDeals) {
      if (!deal.acceptedAmount && !deal.offerAmount) continue;

      const property = deal.propertyId ? propMap.get(deal.propertyId) : null;
      // Use acceptedAmount as the sale proceeds, or offerAmount as fallback
      const saleProceeds = parseFloat((deal.acceptedAmount || deal.offerAmount || "0").toString());
      // Get purchase price from linked property or analysis results
      const propPurchasePrice = property?.purchasePrice ? parseFloat(property.purchasePrice.toString()) : 0;
      const analysisResults = deal.analysisResults as any;
      const acquisitionCost = analysisResults?.purchasePrice ? parseFloat(analysisResults.purchasePrice.toString()) : propPurchasePrice;
      const closingCosts = (deal.closingCosts ? parseFloat(deal.closingCosts.toString()) : 0);
      const improvementCosts = analysisResults?.improvementCosts ? parseFloat(analysisResults.improvementCosts.toString()) : 0;

      if (!saleProceeds) continue;

      const adjustedBasis = acquisitionCost + improvementCosts + closingCosts;
      const realizedGain = saleProceeds - adjustedBasis;

      const acquisitionDate = deal.createdAt ? new Date(deal.createdAt) : null;
      const dispositionDate = deal.closingDate ? new Date(deal.closingDate) : new Date();

      const holdingPeriodDays = acquisitionDate
        ? Math.floor((dispositionDate.getTime() - acquisitionDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      const isLongTerm = holdingPeriodDays > 365;

      const taxRate = isLongTerm ? 0.15 : 0.24; // simplified estimate
      const estimatedTax = Math.max(0, realizedGain * taxRate);

      const savingOps: string[] = [];
      if (realizedGain > 50000 && isLongTerm) {
        savingOps.push("1031 exchange candidate — defer entire gain");
      }
      if (realizedGain > 100000) {
        savingOps.push("Installment sale — spread gain over 2-5 years");
      }
      if (!isLongTerm && realizedGain > 0) {
        savingOps.push("Consider holding through 12-month mark for LTCG rates");
      }

      transactions.push({
        dealId: deal.id,
        propertyId: deal.propertyId ?? undefined,
        propertyAddress: property
          ? `${property.address || ""}, ${property.city || ""} ${property.state || ""}`.trim()
          : `Deal #${deal.id}`,
        county: property?.county ?? undefined,
        state: property?.state ?? undefined,
        acquisitionDate: acquisitionDate ?? undefined,
        dispositionDate,
        acquisitionCost,
        saleProceeds,
        improvementCosts,
        closingCosts,
        realizedGain,
        holdingPeriodDays,
        isLongTerm,
        gainType: "capital",
        estimatedTax,
        taxSavingOpportunities: savingOps,
      });
    }

    // Aggregate numbers
    const longTermGains = transactions
      .filter(t => t.isLongTerm && t.realizedGain > 0)
      .reduce((sum, t) => sum + t.realizedGain, 0);

    const shortTermGains = transactions
      .filter(t => !t.isLongTerm && t.realizedGain > 0)
      .reduce((sum, t) => sum + t.realizedGain, 0);

    const totalRealizedGains = longTermGains + shortTermGains;

    const potentialLosses = transactions
      .filter(t => t.realizedGain < 0)
      .reduce((sum, t) => sum + Math.abs(t.realizedGain), 0);

    // Estimated tax
    const estimatedFederalTax =
      longTermGains * 0.15 +
      shortTermGains * 0.24;

    const estimatedNIIT = totalRealizedGains > NIIT_THRESHOLD_SINGLE
      ? (totalRealizedGains - NIIT_THRESHOLD_SINGLE) * NIIT_RATE
      : 0;

    const totalEstimatedTax = estimatedFederalTax + estimatedNIIT;

    // Build recommendations
    const recommendations = this.buildRecommendations(
      transactions,
      totalRealizedGains,
      longTermGains,
      shortTermGains,
      taxYear
    );

    // Installment sale opportunities
    const installmentSaleOpportunities = this.analyzeInstallmentSales(transactions);

    // 1031 exchange candidates
    const exchange1031Candidates = this.find1031Candidates(transactions);

    // Unrealized gain estimate from current holdings
    const unrealizedGains = orgProperties
      .filter(p => !p.soldDate)
      .reduce((sum, p) => {
        const currentVal = p.marketValue ? parseFloat(p.marketValue.toString()) : 0;
        const purchaseVal = p.purchasePrice ? parseFloat(p.purchasePrice.toString()) : 0;
        return sum + Math.max(0, currentVal - purchaseVal);
      }, 0);

    return {
      taxYear,
      totalRealizedGains,
      longTermGains,
      shortTermGains,
      unrealizedGains,
      potentialLosses,
      estimatedFederalTax,
      estimatedNIIT,
      totalEstimatedTax,
      transactions,
      recommendations,
      installmentSaleOpportunities,
      exchange1031Candidates,
      generatedAt: new Date(),
    };
  }

  private buildRecommendations(
    transactions: TaxableTransaction[],
    totalGains: number,
    ltGains: number,
    stGains: number,
    taxYear: number
  ): TaxRecommendation[] {
    const recs: TaxRecommendation[] = [];

    // 1. Installment sale for large gains
    const bigGains = transactions.filter(t => t.realizedGain > 100000);
    if (bigGains.length > 0) {
      recs.push({
        priority: "high",
        category: "installment_sale",
        title: "Installment Sale Election Available",
        description: `${bigGains.length} deal(s) with gains over $100k qualify for installment sale treatment, spreading the tax over multiple years.`,
        estimatedSavings: bigGains.reduce((s, t) => s + t.realizedGain * 0.08, 0),
        actionItems: [
          "Consult with CPA about installment sale election on Form 6252",
          "Ensure deed transfer and payment schedule qualify",
          "Track payments received each year",
        ],
      });
    }

    // 2. Short-term to long-term conversion
    const nearLongTerm = transactions.filter(
      t => !t.isLongTerm && t.holdingPeriodDays > 300 && t.realizedGain > 10000
    );
    if (nearLongTerm.length > 0) {
      recs.push({
        priority: "medium",
        category: "timing",
        title: "Timing Strategy for Short-Term Gains",
        description: `${nearLongTerm.length} deal(s) were close to the 1-year mark. Future sales near the 12-month mark should be timed to qualify for long-term capital gains rates.`,
        estimatedSavings: nearLongTerm.reduce((s, t) => s + t.realizedGain * 0.12, 0),
        actionItems: [
          "Track acquisition dates for all current properties",
          "Delay sales of properties held 10-11 months to reach 12-month mark",
          "Calendar alerts for properties approaching 12-month anniversary",
        ],
      });
    }

    // 3. Loss harvesting
    const lossDeals = transactions.filter(t => t.realizedGain < 0);
    const gainDeals = transactions.filter(t => t.realizedGain > 0);
    if (lossDeals.length > 0 && gainDeals.length > 0) {
      const totalLosses = lossDeals.reduce((s, t) => s + Math.abs(t.realizedGain), 0);
      recs.push({
        priority: "medium",
        category: "loss_harvesting",
        title: "Capital Loss Harvesting Opportunity",
        description: `You have $${totalLosses.toLocaleString()} in realized losses that can offset gains. Capital losses can offset gains dollar-for-dollar and up to $3,000 of ordinary income.`,
        estimatedSavings: Math.min(totalLosses, totalGains) * 0.15,
        actionItems: [
          "Confirm losses are properly reported on Schedule D",
          "Consider harvesting additional losses from underperforming holdings before year-end",
          "Capital loss carryforward available if losses exceed gains",
        ],
      });
    }

    // 4. QOZ opportunity
    if (totalGains > 50000) {
      recs.push({
        priority: "high",
        category: "qoz",
        title: "Qualified Opportunity Zone (QOZ) Investment",
        description: `Investing capital gains of $${totalGains.toLocaleString()} into a Qualified Opportunity Fund can defer taxes until 2026 and potentially reduce or eliminate gains on the QOF investment.`,
        estimatedSavings: totalGains * 0.15,
        deadline: `December 31, ${taxYear}`,
        actionItems: [
          "Identify QOZ-eligible land investments in your target markets",
          "Must invest within 180 days of sale",
          "Minimum 10-year hold for step-up in basis on QOF investment",
          "Consult tax advisor about IRS Form 8949 and 8997",
        ],
      });
    }

    // 5. Dealer status warning for high-volume
    if (transactions.length >= 5) {
      recs.push({
        priority: "critical",
        category: "dealer_status",
        title: "Dealer vs. Investor Status Review",
        description: `With ${transactions.length} property sales this year, the IRS may classify you as a real estate dealer rather than an investor. Dealer status means gains are taxed as ordinary income (up to 37%) instead of capital gains rates.`,
        estimatedSavings: stGains * 0.13,
        actionItems: [
          "Review IRS criteria: frequency of sales, intent at purchase, holding period",
          "Document investment intent for each acquisition",
          "Consider using a separate LLC for dealer activity",
          "Consult with real estate tax attorney",
        ],
      });
    }

    // 6. Depreciation recapture planning
    if (ltGains > 25000) {
      recs.push({
        priority: "medium",
        category: "depreciation",
        title: "Depreciation Recapture Planning",
        description: "Land is not depreciable, but any improvements (buildings, roads, utilities) are subject to depreciation recapture at 25% on disposition.",
        estimatedSavings: 0,
        actionItems: [
          "Track all improvement costs separately from land basis",
          "Calculate accumulated depreciation on any improvements",
          "Section 1250 unrecaptured depreciation taxed at 25%",
          "Cost segregation study can accelerate depreciation on future improvements",
        ],
      });
    }

    return recs.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.priority] - order[b.priority];
    });
  }

  private analyzeInstallmentSales(transactions: TaxableTransaction[]): InstallmentSaleAnalysis[] {
    return transactions
      .filter(t => t.realizedGain > 50000 && t.isLongTerm)
      .map(t => {
        const spreadYears = t.realizedGain > 500000 ? 5 : t.realizedGain > 200000 ? 4 : t.realizedGain > 100000 ? 3 : 2;
        const annualGain = t.realizedGain / spreadYears;
        const deferredTaxPerYear = t.realizedGain * 0.15 - annualGain * 0.15;
        const timeValueSavings = deferredTaxPerYear * 0.05 * spreadYears; // 5% time value

        return {
          dealId: t.dealId,
          propertyAddress: t.propertyAddress || `Deal #${t.dealId}`,
          totalGain: t.realizedGain,
          spreadOverYears: spreadYears,
          annualGain,
          annualTaxSavings: timeValueSavings / spreadYears,
          eligible: true,
          notes: `Spread $${t.realizedGain.toLocaleString()} gain over ${spreadYears} years. Requires installment note from buyer.`,
        };
      });
  }

  private find1031Candidates(transactions: TaxableTransaction[]): Exchange1031Candidate[] {
    return transactions
      .filter(t => t.realizedGain > 25000 && t.isLongTerm)
      .map(t => {
        const saleDate = t.dispositionDate || new Date();
        const deadline45 = new Date(saleDate.getTime() + 45 * 24 * 60 * 60 * 1000);
        const deadline180 = new Date(saleDate.getTime() + 180 * 24 * 60 * 60 * 1000);
        const potentialTaxDeferred = t.realizedGain * 0.15 + (t.realizedGain > 200000 ? (t.realizedGain - 200000) * 0.038 : 0);

        return {
          dealId: t.dealId,
          propertyAddress: t.propertyAddress || `Deal #${t.dealId}`,
          gain: t.realizedGain,
          deadline45Day: deadline45,
          deadline180Day: deadline180,
          requiredReplacementValue: t.saleProceeds,
          potentialTaxDeferred,
        };
      });
  }

  /**
   * Get a quick tax estimate for a specific deal
   */
  async estimateDealTax(
    organizationId: number,
    dealId: number
  ): Promise<{
    gain: number;
    isLongTerm: boolean;
    estimatedFederalTax: number;
    estimatedNIIT: number;
    total: number;
    recommendations: string[];
  }> {
    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, organizationId)));

    if (!deal) throw new Error("Deal not found");

    const salePrice = parseFloat((deal.acceptedAmount ?? deal.offerAmount ?? 0).toString());
    const analysisResults = deal.analysisResults as any;
    const purchasePrice = analysisResults?.purchasePrice ? parseFloat(analysisResults.purchasePrice) : 0;
    const closingCosts = parseFloat((deal.closingCosts ?? 0).toString());
    const gain = salePrice - purchasePrice - closingCosts;

    const holdingDays = deal.createdAt
      ? Math.floor((Date.now() - new Date(deal.createdAt).getTime()) / 86400000)
      : 0;
    const isLongTerm = holdingDays > 365;

    const federalRate = isLongTerm ? 0.15 : 0.24;
    const estimatedFederalTax = Math.max(0, gain * federalRate);
    const estimatedNIIT = gain > NIIT_THRESHOLD_SINGLE ? (gain - NIIT_THRESHOLD_SINGLE) * NIIT_RATE : 0;

    const recs: string[] = [];
    if (gain > 50000 && isLongTerm) recs.push("Consider 1031 exchange to defer taxes");
    if (gain > 100000) recs.push("Installment sale can spread tax over multiple years");
    if (!isLongTerm && holdingDays > 330) recs.push(`Hold ${365 - holdingDays} more days for long-term capital gains rates`);
    if (gain > 200000) recs.push("QOZ investment can defer and reduce capital gains tax");

    return {
      gain,
      isLongTerm,
      estimatedFederalTax,
      estimatedNIIT,
      total: estimatedFederalTax + estimatedNIIT,
      recommendations: recs,
    };
  }

  /**
   * Generate AI-powered tax planning narrative
   */
  async generateTaxPlanningReport(
    organizationId: number,
    taxYear: number
  ): Promise<string> {
    const position = await this.analyzeYearEndPosition(organizationId, taxYear);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a tax advisor specializing in real estate and land investment tax strategy. Write clear, actionable tax planning advice.",
        },
        {
          role: "user",
          content: `Tax position for ${taxYear}:
- Total realized gains: $${position.totalRealizedGains.toLocaleString()}
- Long-term gains: $${position.longTermGains.toLocaleString()}
- Short-term gains: $${position.shortTermGains.toLocaleString()}
- Estimated total tax: $${position.totalEstimatedTax.toLocaleString()}
- Number of transactions: ${position.transactions.length}
- Top recommendations: ${position.recommendations.slice(0, 3).map(r => r.title).join(", ")}

Write a 3-paragraph tax planning summary with specific action items for this land investor. Be specific about dollar amounts and timing.`,
        },
      ],
      max_tokens: 600,
    });

    return response.choices[0].message.content || "Tax planning report unavailable.";
  }
}

export const taxOptimizerService = new TaxOptimizerService();
