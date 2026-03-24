import { db } from "../db";
import { deals, properties, notes, payments, parcelSnapshots, marketMetrics } from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";

export interface UnderwritingScenario {
  name: "base" | "bull" | "bear";
  appreciationRate: number;  // annual %, e.g. 0.03 = 3%
  holdMonths: number;
  exitCapRate?: number;
  vacancyRate?: number;
}

export interface UnderwritingResult {
  scenario: UnderwritingScenario["name"];
  purchasePrice: number;
  acquisitionCosts: number;  // closing, due diligence
  totalInvested: number;
  holdingCosts: {
    monthlyTaxes: number;
    monthlyInsurance: number;
    monthlyMaintenance: number;
    totalHoldingCost: number;
  };
  exitAnalysis: {
    projectedValue: number;
    grossProceeds: number;
    sellingCosts: number;      // agent, closing, transfer tax
    netProceeds: number;
    netProfit: number;
    roi: number;               // %
    annualizedROI: number;     // %
    irr: number;               // % internal rate of return
    cashOnCash: number;        // %
    equityMultiple: number;
  };
  exitStrategies: {
    wholesale: { netProfit: number; timeMonths: number; recommendation: string };
    ownerFinance: { monthlyIncome: number; noteValue: number; totalReturn: number; recommendation: string };
    retail: { netProfit: number; timeMonths: number; recommendation: string };
    recommended: "wholesale" | "owner_finance" | "retail";
  };
  riskFactors: string[];
  confidence: number;  // 0-100
}

export interface UnderwritingInput {
  purchasePrice: number;
  acreage: number;
  state: string;
  county?: string;
  propertyId?: number;
  dealId?: number;
  currentAnnualTaxes?: number;
  hasRoadAccess?: boolean;
  hasUtilities?: boolean;
  zoning?: string;
  customScenarios?: Partial<UnderwritingScenario>[];
}

export class DealUnderwritingService {

  calculateIRR(cashFlows: number[]): number {
    if (cashFlows.length < 2) return 0;

    // Newton's method for monthly IRR
    let rate = 0.01; // initial guess: 1% per month
    const maxIterations = 100;
    const tolerance = 1e-6;

    for (let i = 0; i < maxIterations; i++) {
      let npv = 0;
      let dNpv = 0;

      for (let t = 0; t < cashFlows.length; t++) {
        const factor = Math.pow(1 + rate, t);
        npv += cashFlows[t] / factor;
        if (t > 0) {
          dNpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
        }
      }

      if (Math.abs(dNpv) < 1e-10) return 0; // Derivative too small, bail out
      const newRate = rate - npv / dNpv;

      if (Math.abs(newRate - rate) < tolerance) {
        // Converged — return annualized %
        return newRate * 12 * 100;
      }
      rate = newRate;
      if (rate <= -1) return 0; // Invalid rate
    }

    return 0; // Did not converge
  }

  private calcAmortizationPayment(principal: number, annualRate: number, termMonths: number): number {
    if (annualRate === 0) return principal / termMonths;
    const r = annualRate / 12;
    return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
  }

  private runScenario(input: UnderwritingInput, scenario: UnderwritingScenario): UnderwritingResult {
    const { purchasePrice, acreage, state, hasRoadAccess, hasUtilities, zoning, currentAnnualTaxes } = input;
    const { appreciationRate, holdMonths } = scenario;

    // 1. Acquisition costs
    const acquisitionCosts = purchasePrice * 0.02;
    const totalInvested = purchasePrice + acquisitionCosts;

    // 2. Holding costs
    const monthlyTaxes = (currentAnnualTaxes !== undefined ? currentAnnualTaxes : purchasePrice * 0.015) / 12;
    const monthlyInsurance = (purchasePrice * 0.005) / 12;
    const monthlyMaintenance = (purchasePrice * 0.002) / 12;
    const totalHoldingCost = (monthlyTaxes + monthlyInsurance + monthlyMaintenance) * holdMonths;

    // 3. Exit analysis
    const projectedValue = purchasePrice * Math.pow(1 + appreciationRate, holdMonths / 12);
    const sellingCosts = projectedValue * 0.06;
    const grossProceeds = projectedValue;
    const netProceeds = projectedValue - sellingCosts;
    const netProfit = netProceeds - totalInvested - totalHoldingCost;
    const roi = (netProfit / totalInvested) * 100;
    const annualizedROI = roi / (holdMonths / 12);
    const cashOnCash = (netProfit / totalInvested) * 100;
    const equityMultiple = netProceeds / totalInvested;

    // Build cash flows for IRR: index 0 = initial outflow, last = exit proceeds, monthly holding costs in between
    const cashFlows: number[] = [];
    cashFlows.push(-(totalInvested)); // month 0: initial investment
    const monthlyCost = monthlyTaxes + monthlyInsurance + monthlyMaintenance;
    for (let m = 1; m < holdMonths; m++) {
      cashFlows.push(-monthlyCost);
    }
    // Final month: exit net proceeds minus last holding cost
    cashFlows.push(netProceeds - monthlyCost);

    const irr = this.calculateIRR(cashFlows);

    // 4. Exit strategies
    // Wholesale: quick flip at 85% of purchase price
    const wholesaleProfit = purchasePrice * 0.85 - totalInvested;
    const wholesaleTimeMonths = 1;

    // Owner finance: 9.9% interest, 10 years, 20% down
    const ofNoteValue = projectedValue * 1.15; // owner finance premium
    const ofDownPayment = ofNoteValue * 0.20;
    const ofLoanAmount = ofNoteValue - ofDownPayment;
    const ofMonthlyPayment = this.calcAmortizationPayment(ofLoanAmount, 0.099, 120);
    const ofTotalReturn = ofDownPayment + ofMonthlyPayment * 120 - totalInvested - totalHoldingCost;

    // Retail: full market price exit
    const retailProfit = netProceeds - totalInvested - totalHoldingCost;
    const retailTimeMonths = 4; // mid-point of 3-6 months

    // Determine recommended exit strategy (risk-adjusted)
    let recommended: "wholesale" | "owner_finance" | "retail" = "retail";
    const wholesaleRiskAdj = wholesaleProfit; // fast, low risk
    const ownerFinanceRiskAdj = ofTotalReturn * 0.85; // slight discount for illiquidity risk
    const retailRiskAdj = retailProfit * 0.9; // slight discount for market risk

    if (wholesaleRiskAdj >= ownerFinanceRiskAdj && wholesaleRiskAdj >= retailRiskAdj) {
      recommended = "wholesale";
    } else if (ownerFinanceRiskAdj >= retailRiskAdj) {
      recommended = "owner_finance";
    } else {
      recommended = "retail";
    }

    // 5. Risk factors
    const riskFactors: string[] = [];
    if (hasRoadAccess === false) riskFactors.push("No road access — significantly limits buyers and value");
    if (hasUtilities === false) riskFactors.push("No utilities access — reduces marketability");
    if (appreciationRate < 0) riskFactors.push("Bear market scenario: projected value decline");
    if (monthlyTaxes * 12 > purchasePrice * 0.03) riskFactors.push("High annual tax burden (>3% of purchase price)");
    if (holdMonths > 18) riskFactors.push("Extended hold period increases carrying cost risk");
    if (acreage < 1) riskFactors.push("Sub-acre parcel may face limited demand");
    if (zoning && zoning.toLowerCase().includes("ag") && !zoning.toLowerCase().includes("res")) {
      riskFactors.push("Agricultural zoning may restrict development potential");
    }
    if (roi < 0) riskFactors.push("Projected negative return under this scenario");

    // 6. Confidence score based on data completeness
    let confidence = 40;
    if (currentAnnualTaxes !== undefined) confidence += 10;
    if (hasRoadAccess !== undefined) confidence += 10;
    if (hasUtilities !== undefined) confidence += 10;
    if (zoning) confidence += 10;
    if (input.county) confidence += 10;
    if (input.propertyId) confidence += 5;
    if (input.dealId) confidence += 5;
    confidence = Math.min(90, confidence);

    return {
      scenario: scenario.name,
      purchasePrice,
      acquisitionCosts,
      totalInvested,
      holdingCosts: {
        monthlyTaxes,
        monthlyInsurance,
        monthlyMaintenance,
        totalHoldingCost,
      },
      exitAnalysis: {
        projectedValue,
        grossProceeds,
        sellingCosts,
        netProceeds,
        netProfit,
        roi,
        annualizedROI,
        irr,
        cashOnCash,
        equityMultiple,
      },
      exitStrategies: {
        wholesale: {
          netProfit: wholesaleProfit,
          timeMonths: wholesaleTimeMonths,
          recommendation: wholesaleProfit > 0
            ? `Quick flip at 85% of purchase price yields $${Math.round(wholesaleProfit).toLocaleString()} in ~1 month`
            : "Wholesale exit not profitable at this purchase price",
        },
        ownerFinance: {
          monthlyIncome: ofMonthlyPayment,
          noteValue: ofNoteValue,
          totalReturn: ofTotalReturn,
          recommendation: `Create a note at $${Math.round(ofNoteValue).toLocaleString()} (9.9%, 10yr) generating $${Math.round(ofMonthlyPayment).toLocaleString()}/mo`,
        },
        retail: {
          netProfit: retailProfit,
          timeMonths: retailTimeMonths,
          recommendation: retailProfit > 0
            ? `List at market price for $${Math.round(netProfit).toLocaleString()} net profit in 3-6 months`
            : "Retail exit projected at a loss under this scenario",
        },
        recommended,
      },
      riskFactors,
      confidence,
    };
  }

  async analyzeScenarios(orgId: number, input: UnderwritingInput): Promise<UnderwritingResult[]> {
    const defaultScenarios: UnderwritingScenario[] = [
      { name: "base", appreciationRate: 0.03, holdMonths: 12 },
      { name: "bull", appreciationRate: 0.07, holdMonths: 6 },
      { name: "bear", appreciationRate: -0.02, holdMonths: 24 },
    ];

    // Merge any custom scenario overrides
    const scenarios: UnderwritingScenario[] = defaultScenarios.map((def, i) => {
      const custom = input.customScenarios?.[i];
      if (!custom) return def;
      return { ...def, ...custom, name: def.name };
    });

    return scenarios.map(scenario => this.runScenario(input, scenario));
  }

  async getUnderwritingHistory(orgId: number, dealId?: number): Promise<any[]> {
    const query = db.select({
      id: deals.id,
      status: deals.status,
      offerAmount: deals.offerAmount,
      acceptedAmount: deals.acceptedAmount,
      analysisResults: deals.analysisResults,
      createdAt: deals.createdAt,
      updatedAt: deals.updatedAt,
    })
      .from(deals)
      .where(
        dealId
          ? and(eq(deals.organizationId, orgId), eq(deals.id, dealId))
          : eq(deals.organizationId, orgId)
      )
      .orderBy(desc(deals.createdAt))
      .limit(50);

    return query;
  }

  /**
   * ARV analysis for fix & flip properties.
   * Uses 70% rule: MAO = ARV × 0.70 − estimated repair cost.
   */
  calculateFlipAnalysis(afterRepairValue: number, estimatedRepairCost: number, purchasePrice: number): {
    mao: number;
    profitProjection: number;
    roi: number;
    isGoodDeal: boolean;
  } {
    const mao = afterRepairValue * 0.70 - estimatedRepairCost;
    const totalInvested = purchasePrice + estimatedRepairCost;
    const profitProjection = afterRepairValue * 0.93 - totalInvested; // 7% selling costs
    const roi = totalInvested > 0 ? (profitProjection / totalInvested) * 100 : 0;

    return {
      mao: Math.round(mao),
      profitProjection: Math.round(profitProjection),
      roi: Math.round(roi * 10) / 10,
      isGoodDeal: purchasePrice <= mao && profitProjection > 0,
    };
  }

  /**
   * Cash-on-cash and cap rate analysis for buy & hold (rental) properties.
   */
  calculateRentalAnalysis(
    purchasePrice: number,
    monthlyRent: number,
    monthlyExpenses: number = 0
  ): {
    cashOnCashReturn: number;
    capRate: number;
    grossRentMultiplier: number;
    monthlyCashFlow: number;
    annualNOI: number;
  } {
    const annualRent = monthlyRent * 12;
    // Estimate 40% expenses if not provided (taxes, insurance, maintenance, vacancy)
    const annualExpenses = monthlyExpenses > 0 ? monthlyExpenses * 12 : annualRent * 0.4;
    const annualNOI = annualRent - annualExpenses;
    const monthlyCashFlow = annualNOI / 12;
    const capRate = purchasePrice > 0 ? (annualNOI / purchasePrice) * 100 : 0;
    const cashOnCashReturn = capRate; // Simplified — no leverage
    const grossRentMultiplier = monthlyRent > 0 ? purchasePrice / annualRent : 0;

    return {
      cashOnCashReturn: Math.round(cashOnCashReturn * 10) / 10,
      capRate: Math.round(capRate * 10) / 10,
      grossRentMultiplier: Math.round(grossRentMultiplier * 10) / 10,
      monthlyCashFlow: Math.round(monthlyCashFlow),
      annualNOI: Math.round(annualNOI),
    };
  }
}

export const dealUnderwritingService = new DealUnderwritingService();
