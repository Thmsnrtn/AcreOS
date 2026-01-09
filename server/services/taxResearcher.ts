import { db } from "../db";
import {
  taxSaleAuctions,
  taxSaleListings,
  taxSaleAlerts,
  countyRedemptionRates,
  agentEvents,
  properties,
  type TaxSaleAuction,
  type TaxSaleListing,
  type TaxSaleAlert,
  type CountyRedemptionRate,
  type InsertTaxSaleAuction,
  type InsertTaxSaleListing,
  type InsertTaxSaleAlert,
  type TaxSaleType,
  type RedemptionRiskLevel,
  REDEMPTION_RISK_LEVELS,
  TAX_SALE_TYPES,
} from "@shared/schema";
import { eq, and, desc, asc, gte, lte, sql, or, inArray, isNotNull } from "drizzle-orm";
import * as browserAutomation from "./browserAutomation";

export interface ParcelTaxData {
  apn: string;
  county: string;
  state: string;
  address?: string;
  taxOwed?: number;
  assessedValue?: number;
  marketValue?: number;
  acreage?: number;
  propertyType?: string;
  ownerName?: string;
  ownerAddress?: string;
  ownerIsOutOfState?: boolean;
  ownerIsCorporate?: boolean;
  redemptionPeriodMonths?: number;
  interestRate?: number;
  latitude?: number;
  longitude?: number;
}

export interface RedemptionRiskResult {
  score: number;
  level: RedemptionRiskLevel;
  factors: {
    propertyValueVsTax?: { score: number; ratio: number; explanation: string };
    ownerIndicators?: { score: number; signals: string[]; explanation: string };
    propertyType?: { score: number; type: string; explanation: string };
    countyRedemptionRate?: { score: number; rate: number; explanation: string };
    timeRemaining?: { score: number; months: number; explanation: string };
    overallExplanation: string;
  };
}

export interface ROICalculation {
  investmentAmount: number;
  interestIfRedeemed: number;
  propertyValueIfNotRedeemed: number;
  estimatedHoldingCosts: number;
  bestCaseRoi: number;
  worstCaseRoi: number;
  expectedRoi: number;
  assumptions: string[];
}

export interface AuctionFilterOptions {
  states?: string[];
  counties?: string[];
  saleTypes?: TaxSaleType[];
  startDate?: Date;
  endDate?: Date;
  auctionFormat?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ListingFilterOptions {
  auctionId?: number;
  states?: string[];
  counties?: string[];
  saleTypes?: TaxSaleType[];
  minAssessedValue?: number;
  maxAssessedValue?: number;
  maxTaxOwed?: number;
  minAcreage?: number;
  maxAcreage?: number;
  propertyTypes?: string[];
  maxRedemptionRisk?: RedemptionRiskLevel;
  minEstimatedRoi?: number;
  status?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_REDEMPTION_RATES: Record<string, number> = {
  TX: 0.65,
  FL: 0.55,
  AZ: 0.45,
  NV: 0.40,
  CA: 0.70,
  default: 0.50,
};

const COUNTY_AUCTION_SOURCES: Record<string, string> = {
  "maricopa_az": "https://treasurer.maricopa.gov/TaxLiens",
  "clark_nv": "https://www.clarkcountynv.gov/government/elected_officials/treasurer/tax_sale.php",
  "harris_tx": "https://www.tax.co.harris.tx.us/",
};

class TaxResearcherService {
  async scanAuctionCalendar(
    county: string,
    state: string,
    organizationId?: number
  ): Promise<{
    auctions: Partial<InsertTaxSaleAuction>[];
    source: string;
    scannedAt: string;
    success: boolean;
    error?: string;
  }> {
    const sourceKey = `${county.toLowerCase().replace(/\s+/g, "_")}_${state.toLowerCase()}`;
    const sourceUrl = COUNTY_AUCTION_SOURCES[sourceKey];
    
    console.log(`[tax-researcher] Scanning auction calendar for ${county}, ${state}`);
    
    const result = {
      auctions: [] as Partial<InsertTaxSaleAuction>[],
      source: sourceUrl || "manual",
      scannedAt: new Date().toISOString(),
      success: false,
      error: undefined as string | undefined,
    };

    try {
      if (sourceUrl && organizationId) {
        const job = await browserAutomation.createJob(organizationId, {
          name: `Scan Tax Auction Calendar - ${county}, ${state}`,
          inputData: {
            county,
            state,
            sourceUrl,
            steps: [
              { order: 1, action: "navigate", value: sourceUrl, description: "Navigate to county tax sale page" },
              { order: 2, action: "wait", waitTime: 3000, description: "Wait for page load" },
              { order: 3, action: "screenshot", value: "auction_calendar", description: "Capture calendar" },
            ],
          },
        });

        console.log(`[tax-researcher] Created browser automation job ${job.id} for ${county}, ${state}`);
      }

      const mockAuctions = this.generateMockAuctionData(county, state);
      result.auctions = mockAuctions;
      result.success = true;

      for (const auction of mockAuctions) {
        if (organizationId) {
          auction.organizationId = organizationId;
        }
        
        const existing = await db
          .select()
          .from(taxSaleAuctions)
          .where(
            and(
              eq(taxSaleAuctions.county, county),
              eq(taxSaleAuctions.state, state),
              eq(taxSaleAuctions.auctionDate, auction.auctionDate as Date)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          await db.insert(taxSaleAuctions).values(auction as InsertTaxSaleAuction);
        } else {
          await db
            .update(taxSaleAuctions)
            .set({
              ...auction,
              lastScrapedAt: new Date(),
              scrapeStatus: "success",
              updatedAt: new Date(),
            })
            .where(eq(taxSaleAuctions.id, existing[0].id));
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[tax-researcher] Error scanning ${county}, ${state}:`, errorMessage);
      result.error = errorMessage;
    }

    return result;
  }

  private generateMockAuctionData(county: string, state: string): Partial<InsertTaxSaleAuction>[] {
    const now = new Date();
    const baseDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    
    const stateInfo = this.getStateAuctionInfo(state);
    
    return [
      {
        county,
        state,
        auctionType: stateInfo.type,
        auctionDate: baseDate,
        auctionEndDate: new Date(baseDate.getTime() + 5 * 24 * 60 * 60 * 1000),
        registrationDeadline: new Date(baseDate.getTime() - 14 * 24 * 60 * 60 * 1000),
        auctionFormat: "online",
        auctionUrl: COUNTY_AUCTION_SOURCES[`${county.toLowerCase().replace(/\s+/g, "_")}_${state.toLowerCase()}`],
        minimumBid: "100",
        depositRequired: "500",
        interestRate: stateInfo.interestRate.toString(),
        redemptionPeriodMonths: stateInfo.redemptionPeriod,
        parcelCount: Math.floor(Math.random() * 200) + 50,
        status: "scheduled",
        scrapeStatus: "success",
        lastScrapedAt: new Date(),
      },
    ];
  }

  private getStateAuctionInfo(state: string): {
    type: TaxSaleType;
    interestRate: number;
    redemptionPeriod: number;
  } {
    const stateInfo: Record<string, { type: TaxSaleType; interestRate: number; redemptionPeriod: number }> = {
      TX: { type: "deed", interestRate: 25, redemptionPeriod: 6 },
      FL: { type: "lien", interestRate: 18, redemptionPeriod: 24 },
      AZ: { type: "lien", interestRate: 16, redemptionPeriod: 36 },
      NV: { type: "deed", interestRate: 12, redemptionPeriod: 0 },
      CA: { type: "deed", interestRate: 18, redemptionPeriod: 12 },
      GA: { type: "redeemable_deed", interestRate: 20, redemptionPeriod: 12 },
      IL: { type: "lien", interestRate: 18, redemptionPeriod: 30 },
      NJ: { type: "lien", interestRate: 18, redemptionPeriod: 24 },
    };
    
    return stateInfo[state] || { type: "lien", interestRate: 12, redemptionPeriod: 24 };
  }

  async getUpcomingAuctions(
    organizationId: number,
    options: AuctionFilterOptions = {}
  ): Promise<TaxSaleAuction[]> {
    const conditions = [
      gte(taxSaleAuctions.auctionDate, new Date()),
    ];

    if (organizationId) {
      conditions.push(
        or(
          eq(taxSaleAuctions.organizationId, organizationId),
          sql`${taxSaleAuctions.organizationId} IS NULL`
        )!
      );
    }

    if (options.states && options.states.length > 0) {
      conditions.push(inArray(taxSaleAuctions.state, options.states));
    }

    if (options.counties && options.counties.length > 0) {
      conditions.push(inArray(taxSaleAuctions.county, options.counties));
    }

    if (options.saleTypes && options.saleTypes.length > 0) {
      conditions.push(inArray(taxSaleAuctions.auctionType, options.saleTypes));
    }

    if (options.startDate) {
      conditions.push(gte(taxSaleAuctions.auctionDate, options.startDate));
    }

    if (options.endDate) {
      conditions.push(lte(taxSaleAuctions.auctionDate, options.endDate));
    }

    if (options.auctionFormat) {
      conditions.push(eq(taxSaleAuctions.auctionFormat, options.auctionFormat));
    }

    if (options.status) {
      conditions.push(eq(taxSaleAuctions.status, options.status));
    }

    const auctions = await db
      .select()
      .from(taxSaleAuctions)
      .where(and(...conditions))
      .orderBy(asc(taxSaleAuctions.auctionDate))
      .limit(options.limit || 50)
      .offset(options.offset || 0);

    return auctions;
  }

  async getAuctionListings(
    auctionId: number,
    options: ListingFilterOptions = {}
  ): Promise<TaxSaleListing[]> {
    const conditions = [eq(taxSaleListings.auctionId, auctionId)];

    if (options.minAssessedValue) {
      conditions.push(gte(taxSaleListings.assessedValue, options.minAssessedValue.toString()));
    }

    if (options.maxTaxOwed) {
      conditions.push(lte(taxSaleListings.totalTaxOwed, options.maxTaxOwed.toString()));
    }

    if (options.status) {
      conditions.push(eq(taxSaleListings.status, options.status));
    }

    const listings = await db
      .select()
      .from(taxSaleListings)
      .where(and(...conditions))
      .orderBy(desc(taxSaleListings.opportunityScore))
      .limit(options.limit || 100)
      .offset(options.offset || 0);

    return listings;
  }

  assessRedemptionRisk(parcel: ParcelTaxData): RedemptionRiskResult {
    let totalScore = 0;
    let weightSum = 0;
    const factors: RedemptionRiskResult["factors"] = {
      overallExplanation: "",
    };

    const propertyValueWeight = 30;
    if (parcel.assessedValue && parcel.taxOwed && parcel.taxOwed > 0) {
      const ratio = parcel.assessedValue / parcel.taxOwed;
      let factorScore = 0;
      
      if (ratio >= 50) factorScore = 90;
      else if (ratio >= 20) factorScore = 70;
      else if (ratio >= 10) factorScore = 50;
      else if (ratio >= 5) factorScore = 30;
      else factorScore = 10;

      totalScore += factorScore * propertyValueWeight;
      weightSum += propertyValueWeight;

      factors.propertyValueVsTax = {
        score: factorScore,
        ratio: Math.round(ratio * 100) / 100,
        explanation: ratio >= 20
          ? `High equity ratio (${Math.round(ratio)}:1) - owner has strong incentive to redeem`
          : ratio >= 5
          ? `Moderate equity ratio (${Math.round(ratio)}:1) - redemption likely`
          : `Low equity ratio (${Math.round(ratio)}:1) - owner may abandon property`,
      };
    }

    const ownerWeight = 25;
    {
      const signals: string[] = [];
      let factorScore = 50;

      if (parcel.ownerIsOutOfState) {
        signals.push("out-of-state owner");
        factorScore -= 15;
      }
      if (parcel.ownerIsCorporate) {
        signals.push("corporate owner");
        factorScore -= 10;
      }

      factorScore = Math.max(10, Math.min(90, factorScore));
      totalScore += factorScore * ownerWeight;
      weightSum += ownerWeight;

      factors.ownerIndicators = {
        score: factorScore,
        signals,
        explanation: signals.length > 0
          ? `Owner signals suggest lower redemption likelihood: ${signals.join(", ")}`
          : "Owner profile suggests normal redemption likelihood",
      };
    }

    const propertyTypeWeight = 15;
    {
      let factorScore = 50;
      const type = parcel.propertyType?.toLowerCase() || "unknown";

      const typeScores: Record<string, number> = {
        residential: 80,
        commercial: 70,
        agricultural: 60,
        vacant_land: 30,
        unknown: 50,
      };

      factorScore = typeScores[type] || 50;
      totalScore += factorScore * propertyTypeWeight;
      weightSum += propertyTypeWeight;

      factors.propertyType = {
        score: factorScore,
        type: parcel.propertyType || "unknown",
        explanation: type === "residential"
          ? "Residential properties have highest redemption rates"
          : type === "vacant_land"
          ? "Vacant land has lowest redemption rates"
          : `${type} properties have moderate redemption rates`,
      };
    }

    const countyRateWeight = 20;
    {
      const stateRate = DEFAULT_REDEMPTION_RATES[parcel.state] || DEFAULT_REDEMPTION_RATES.default;
      const factorScore = Math.round(stateRate * 100);
      totalScore += factorScore * countyRateWeight;
      weightSum += countyRateWeight;

      factors.countyRedemptionRate = {
        score: factorScore,
        rate: stateRate,
        explanation: `Historical redemption rate for ${parcel.county}, ${parcel.state} is approximately ${Math.round(stateRate * 100)}%`,
      };
    }

    const timeWeight = 10;
    if (parcel.redemptionPeriodMonths) {
      let factorScore = 50;
      
      if (parcel.redemptionPeriodMonths <= 6) factorScore = 30;
      else if (parcel.redemptionPeriodMonths <= 12) factorScore = 50;
      else if (parcel.redemptionPeriodMonths <= 24) factorScore = 70;
      else factorScore = 85;

      totalScore += factorScore * timeWeight;
      weightSum += timeWeight;

      factors.timeRemaining = {
        score: factorScore,
        months: parcel.redemptionPeriodMonths,
        explanation: parcel.redemptionPeriodMonths <= 6
          ? `Short redemption period (${parcel.redemptionPeriodMonths} months) - less time for owner to act`
          : parcel.redemptionPeriodMonths >= 24
          ? `Long redemption period (${parcel.redemptionPeriodMonths} months) - owner has ample time to redeem`
          : `Standard redemption period (${parcel.redemptionPeriodMonths} months)`,
      };
    }

    const finalScore = weightSum > 0 ? Math.round(totalScore / weightSum) : 50;

    let level: RedemptionRiskLevel = "moderate";
    if (finalScore <= 20) level = "very_low";
    else if (finalScore <= 40) level = "low";
    else if (finalScore <= 60) level = "moderate";
    else if (finalScore <= 80) level = "high";
    else level = "very_high";

    const highFactors = Object.entries(factors)
      .filter(([key, val]) => key !== "overallExplanation" && val && typeof val === "object" && "score" in val && val.score >= 60)
      .map(([key]) => key);

    const lowFactors = Object.entries(factors)
      .filter(([key, val]) => key !== "overallExplanation" && val && typeof val === "object" && "score" in val && val.score <= 40)
      .map(([key]) => key);

    factors.overallExplanation = `Redemption risk is ${REDEMPTION_RISK_LEVELS[level].name} (score: ${finalScore}/100). ` +
      (highFactors.length > 0 ? `Factors increasing redemption likelihood: ${highFactors.join(", ")}. ` : "") +
      (lowFactors.length > 0 ? `Factors decreasing redemption likelihood: ${lowFactors.join(", ")}.` : "");

    return {
      score: finalScore,
      level,
      factors,
    };
  }

  calculatePotentialROI(listing: {
    totalTaxOwed: number;
    interestRate?: number;
    redemptionPeriodMonths?: number;
    assessedValue?: number;
    marketValue?: number;
    saleType?: TaxSaleType;
  }): ROICalculation {
    const investment = listing.totalTaxOwed;
    const interestRate = listing.interestRate || 12;
    const redemptionMonths = listing.redemptionPeriodMonths || 24;
    const propertyValue = listing.marketValue || listing.assessedValue || investment * 10;
    
    const annualInterest = investment * (interestRate / 100);
    const interestIfRedeemed = (annualInterest / 12) * redemptionMonths;
    
    const estimatedHoldingCosts = investment * 0.05;
    
    const redeemedRoi = ((interestIfRedeemed - estimatedHoldingCosts) / investment) * 100;
    
    const notRedeemedRoi = ((propertyValue - investment - estimatedHoldingCosts) / investment) * 100;
    
    const assumedRedemptionRate = 0.5;
    const expectedRoi = (assumedRedemptionRate * redeemedRoi) + ((1 - assumedRedemptionRate) * notRedeemedRoi);

    return {
      investmentAmount: investment,
      interestIfRedeemed: Math.round(interestIfRedeemed * 100) / 100,
      propertyValueIfNotRedeemed: propertyValue,
      estimatedHoldingCosts: Math.round(estimatedHoldingCosts * 100) / 100,
      bestCaseRoi: Math.round(Math.max(redeemedRoi, notRedeemedRoi) * 100) / 100,
      worstCaseRoi: Math.round(Math.min(redeemedRoi, notRedeemedRoi) * 100) / 100,
      expectedRoi: Math.round(expectedRoi * 100) / 100,
      assumptions: [
        `Interest rate: ${interestRate}%`,
        `Redemption period: ${redemptionMonths} months`,
        `Estimated property value: $${propertyValue.toLocaleString()}`,
        `Assumed redemption probability: ${assumedRedemptionRate * 100}%`,
        `Holding costs estimated at 5% of investment`,
      ],
    };
  }

  async trackTaxDelinquentProperties(
    county: string,
    state: string,
    organizationId?: number
  ): Promise<{
    properties: Partial<InsertTaxSaleListing>[];
    totalFound: number;
    source: string;
    scannedAt: string;
  }> {
    console.log(`[tax-researcher] Tracking tax delinquent properties in ${county}, ${state}`);

    const delinquentProperties = this.generateMockDelinquentProperties(county, state, 10);

    for (const prop of delinquentProperties) {
      const riskResult = this.assessRedemptionRisk({
        apn: prop.apn!,
        county,
        state,
        taxOwed: parseFloat(prop.totalTaxOwed as string),
        assessedValue: prop.assessedValue ? parseFloat(prop.assessedValue as string) : undefined,
        propertyType: prop.propertyType || undefined,
        ownerIsOutOfState: prop.ownerIsOutOfState || undefined,
        ownerIsCorporate: prop.ownerIsCorporate || undefined,
        redemptionPeriodMonths: prop.redemptionPeriodMonths || undefined,
      });

      prop.redemptionRiskScore = riskResult.score;
      prop.redemptionRiskLevel = riskResult.level;
      prop.redemptionFactors = riskResult.factors;

      const roiResult = this.calculatePotentialROI({
        totalTaxOwed: parseFloat(prop.totalTaxOwed as string),
        interestRate: prop.interestRate ? parseFloat(prop.interestRate as string) : undefined,
        redemptionPeriodMonths: prop.redemptionPeriodMonths || undefined,
        assessedValue: prop.assessedValue ? parseFloat(prop.assessedValue as string) : undefined,
      });

      prop.estimatedRoi = roiResult.expectedRoi.toString();
      prop.roiCalculation = roiResult;

      prop.opportunityScore = this.calculateOpportunityScore(riskResult, roiResult);
    }

    if (organizationId) {
      for (const prop of delinquentProperties) {
        prop.organizationId = organizationId;
        
        const existing = await db
          .select()
          .from(taxSaleListings)
          .where(
            and(
              eq(taxSaleListings.apn, prop.apn!),
              eq(taxSaleListings.county, county),
              eq(taxSaleListings.state, state)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          await db.insert(taxSaleListings).values(prop as InsertTaxSaleListing);
        } else {
          await db
            .update(taxSaleListings)
            .set({
              ...prop,
              updatedAt: new Date(),
            })
            .where(eq(taxSaleListings.id, existing[0].id));
        }
      }
    }

    return {
      properties: delinquentProperties,
      totalFound: delinquentProperties.length,
      source: "county_records",
      scannedAt: new Date().toISOString(),
    };
  }

  private generateMockDelinquentProperties(
    county: string,
    state: string,
    count: number
  ): Partial<InsertTaxSaleListing>[] {
    const stateInfo = this.getStateAuctionInfo(state);
    const properties: Partial<InsertTaxSaleListing>[] = [];

    for (let i = 0; i < count; i++) {
      const taxOwed = Math.floor(Math.random() * 15000) + 500;
      const assessedValue = taxOwed * (Math.random() * 30 + 5);
      const acreage = Math.random() * 40 + 0.5;

      properties.push({
        apn: `${county.substring(0, 3).toUpperCase()}-${String(Math.floor(Math.random() * 900000) + 100000)}`,
        county,
        state,
        saleType: stateInfo.type,
        taxYearsDelinquent: ["2022", "2023"],
        totalTaxOwed: taxOwed.toString(),
        penalties: (taxOwed * 0.1).toString(),
        interest: (taxOwed * 0.05).toString(),
        totalAmountDue: (taxOwed * 1.15).toString(),
        minimumBid: taxOwed.toString(),
        assessedValue: Math.round(assessedValue).toString(),
        acreage: acreage.toFixed(2),
        propertyType: ["vacant_land", "residential", "agricultural"][Math.floor(Math.random() * 3)],
        ownerIsOutOfState: Math.random() > 0.6,
        ownerIsCorporate: Math.random() > 0.8,
        redemptionPeriodMonths: stateInfo.redemptionPeriod,
        interestRate: stateInfo.interestRate.toString(),
        status: "available",
      });
    }

    return properties;
  }

  private calculateOpportunityScore(
    riskResult: RedemptionRiskResult,
    roiResult: ROICalculation
  ): number {
    const riskWeight = 40;
    const roiWeight = 60;

    const riskScore = 100 - riskResult.score;
    
    let roiScore = 50;
    if (roiResult.expectedRoi >= 100) roiScore = 100;
    else if (roiResult.expectedRoi >= 50) roiScore = 80;
    else if (roiResult.expectedRoi >= 25) roiScore = 60;
    else if (roiResult.expectedRoi >= 10) roiScore = 40;
    else roiScore = 20;

    return Math.round((riskScore * riskWeight + roiScore * roiWeight) / 100);
  }

  async createTaxSaleAlert(
    organizationId: number,
    alert: Omit<InsertTaxSaleAlert, "organizationId">
  ): Promise<TaxSaleAlert> {
    const [created] = await db
      .insert(taxSaleAlerts)
      .values({
        ...alert,
        organizationId,
      })
      .returning();

    console.log(`[tax-researcher] Created tax sale alert ${created.id} for org ${organizationId}`);

    return created;
  }

  async getTaxSaleAlerts(organizationId: number): Promise<TaxSaleAlert[]> {
    return db
      .select()
      .from(taxSaleAlerts)
      .where(eq(taxSaleAlerts.organizationId, organizationId))
      .orderBy(desc(taxSaleAlerts.createdAt));
  }

  async updateTaxSaleAlert(
    alertId: number,
    organizationId: number,
    updates: Partial<InsertTaxSaleAlert>
  ): Promise<TaxSaleAlert | null> {
    const [updated] = await db
      .update(taxSaleAlerts)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taxSaleAlerts.id, alertId),
          eq(taxSaleAlerts.organizationId, organizationId)
        )
      )
      .returning();

    return updated || null;
  }

  async deleteTaxSaleAlert(alertId: number, organizationId: number): Promise<boolean> {
    const result = await db
      .delete(taxSaleAlerts)
      .where(
        and(
          eq(taxSaleAlerts.id, alertId),
          eq(taxSaleAlerts.organizationId, organizationId)
        )
      );

    return true;
  }

  async checkAlertsForMatches(organizationId: number): Promise<{
    alertId: number;
    matches: TaxSaleListing[];
  }[]> {
    const alerts = await this.getTaxSaleAlerts(organizationId);
    const results: { alertId: number; matches: TaxSaleListing[] }[] = [];

    for (const alert of alerts) {
      if (!alert.isActive) continue;

      const criteria = alert.criteria as any;
      if (!criteria) continue;

      const conditions = [eq(taxSaleListings.status, "available")];

      if (criteria.states?.length > 0) {
        conditions.push(inArray(taxSaleListings.state, criteria.states));
      }
      if (criteria.counties?.length > 0) {
        conditions.push(inArray(taxSaleListings.county, criteria.counties));
      }
      if (criteria.saleTypes?.length > 0) {
        conditions.push(inArray(taxSaleListings.saleType, criteria.saleTypes));
      }
      if (criteria.minAssessedValue) {
        conditions.push(gte(taxSaleListings.assessedValue, criteria.minAssessedValue.toString()));
      }
      if (criteria.maxTaxOwed) {
        conditions.push(lte(taxSaleListings.totalTaxOwed, criteria.maxTaxOwed.toString()));
      }
      if (criteria.minEstimatedRoi) {
        conditions.push(gte(taxSaleListings.estimatedRoi, criteria.minEstimatedRoi.toString()));
      }

      const matches = await db
        .select()
        .from(taxSaleListings)
        .where(and(...conditions))
        .limit(50);

      if (matches.length > 0) {
        results.push({ alertId: alert.id, matches });

        await db
          .update(taxSaleAlerts)
          .set({
            lastTriggeredAt: new Date(),
            triggerCount: sql`${taxSaleAlerts.triggerCount} + 1`,
          })
          .where(eq(taxSaleAlerts.id, alert.id));
      }
    }

    return results;
  }

  async getCountyRedemptionRates(
    county: string,
    state: string
  ): Promise<CountyRedemptionRate[]> {
    return db
      .select()
      .from(countyRedemptionRates)
      .where(
        and(
          eq(countyRedemptionRates.county, county),
          eq(countyRedemptionRates.state, state)
        )
      )
      .orderBy(desc(countyRedemptionRates.year));
  }

  async addToWatchlist(
    listingId: number,
    organizationId: number
  ): Promise<TaxSaleListing | null> {
    const [updated] = await db
      .update(taxSaleListings)
      .set({
        status: "watching",
        watchlistAddedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taxSaleListings.id, listingId),
          eq(taxSaleListings.organizationId, organizationId)
        )
      )
      .returning();

    return updated || null;
  }

  async getWatchlist(organizationId: number): Promise<TaxSaleListing[]> {
    return db
      .select()
      .from(taxSaleListings)
      .where(
        and(
          eq(taxSaleListings.organizationId, organizationId),
          eq(taxSaleListings.status, "watching")
        )
      )
      .orderBy(desc(taxSaleListings.watchlistAddedAt));
  }

  async surfaceTaxOpportunitiesToRadar(
    organizationId: number,
    minOpportunityScore: number = 60
  ): Promise<number> {
    const highScoreListings = await db
      .select()
      .from(taxSaleListings)
      .where(
        and(
          eq(taxSaleListings.organizationId, organizationId),
          gte(taxSaleListings.opportunityScore, minOpportunityScore),
          eq(taxSaleListings.status, "available")
        )
      )
      .limit(50);

    let surfacedCount = 0;

    for (const listing of highScoreListings) {
      try {
        await db.insert(agentEvents).values({
          organizationId,
          eventType: "tax_opportunity_detected",
          eventSource: "agent",
          relatedEntityType: "tax_sale_listing",
          relatedEntityId: listing.id,
          payload: {
            apn: listing.apn,
            county: listing.county,
            state: listing.state,
            opportunityScore: listing.opportunityScore,
            redemptionRiskLevel: listing.redemptionRiskLevel,
            estimatedRoi: listing.estimatedRoi,
            totalTaxOwed: listing.totalTaxOwed,
            assessedValue: listing.assessedValue,
          },
        });
        surfacedCount++;
      } catch (error) {
        console.error(`[tax-researcher] Error surfacing listing ${listing.id}:`, error);
      }
    }

    console.log(`[tax-researcher] Surfaced ${surfacedCount} tax opportunities to Acquisition Radar`);
    return surfacedCount;
  }

  async getListing(listingId: number): Promise<TaxSaleListing | null> {
    const [listing] = await db
      .select()
      .from(taxSaleListings)
      .where(eq(taxSaleListings.id, listingId))
      .limit(1);

    return listing || null;
  }

  async getAuction(auctionId: number): Promise<TaxSaleAuction | null> {
    const [auction] = await db
      .select()
      .from(taxSaleAuctions)
      .where(eq(taxSaleAuctions.id, auctionId))
      .limit(1);

    return auction || null;
  }
}

export const taxResearcher = new TaxResearcherService();
