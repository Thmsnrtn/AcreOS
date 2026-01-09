import { db } from "../db";
import { 
  opportunityScores, 
  radarConfigs, 
  properties,
  agentEvents,
  eventSubscriptions,
  type OpportunityScore,
  type RadarConfig,
  type InsertOpportunityScore,
  type InsertRadarConfig,
  type OpportunityType,
  OPPORTUNITY_TYPES,
} from "@shared/schema";
import { eq, and, desc, asc, gte, lte, sql, isNull, or } from "drizzle-orm";
import { DataSourceBroker, type LookupCategory } from "./data-source-broker";

const dataSourceBroker = new DataSourceBroker();

export interface ScoringWeights {
  priceVsAssessed: number;
  daysOnMarket: number;
  sellerMotivation: number;
  marketVelocity: number;
  comparableSpreads: number;
  environmentalRisk: number;
  ownerSignals: number;
}

export interface ScoringThresholds {
  hotOpportunity: number;
  goodOpportunity: number;
  minimumScore: number;
  maxDaysOnMarket: number;
  minPriceDiscount: number;
  maxFloodRisk: number;
}

export interface ParcelData {
  apn?: string;
  county?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  listPrice?: number;
  assessedValue?: number;
  acreage?: number;
  zoning?: string;
  daysOnMarket?: number;
  propertyId?: number;
}

export interface OwnerData {
  isOutOfState?: boolean;
  isInherited?: boolean;
  isTaxDelinquent?: boolean;
  isCorporate?: boolean;
  ownershipYears?: number;
  ownerState?: string;
  ownerName?: string;
  taxDelinquentAmount?: number;
}

export interface MarketData {
  recentSales?: number;
  absorptionRate?: number;
  avgPricePerAcre?: number;
  medianDaysOnMarket?: number;
  priceChangePercent?: number;
}

export interface EnvironmentalData {
  floodZone?: string;
  wetlandsPercent?: number;
  soilType?: string;
  hasEnvironmentalIssues?: boolean;
}

export interface EnrichedParcelData extends ParcelData {
  owner?: OwnerData;
  market?: MarketData;
  environmental?: EnvironmentalData;
}

interface ScoreFactor {
  score: number;
  weight: number;
  contribution: number;
  details: Record<string, any> & { explanation: string };
}

interface ScoreBreakdown {
  priceVsAssessed?: ScoreFactor;
  daysOnMarket?: ScoreFactor;
  sellerMotivation?: ScoreFactor;
  marketVelocity?: ScoreFactor;
  comparableSpreads?: ScoreFactor;
  environmentalRisk?: ScoreFactor;
  ownerSignals?: ScoreFactor;
}

export interface ScoringResult {
  score: number;
  opportunityType: OpportunityType;
  factors: ScoreBreakdown;
  explanation: string;
  dataSources: Array<{
    sourceId: number;
    sourceName: string;
    fetchedAt: string;
    dataType: string;
  }>;
}

export interface ScannerConfig {
  batchSize: number;
  scanIntervalMinutes: number;
  priorityCounties?: string[];
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  priceVsAssessed: 25,
  daysOnMarket: 15,
  sellerMotivation: 20,
  marketVelocity: 15,
  comparableSpreads: 15,
  environmentalRisk: -10,
  ownerSignals: 20,
};

const DEFAULT_THRESHOLDS: ScoringThresholds = {
  hotOpportunity: 80,
  goodOpportunity: 60,
  minimumScore: 40,
  maxDaysOnMarket: 365,
  minPriceDiscount: 10,
  maxFloodRisk: 50,
};

class AcquisitionRadarService {
  private scanIntervalId: NodeJS.Timeout | null = null;
  private isScanning = false;

  async getOrCreateConfig(organizationId: number): Promise<RadarConfig> {
    const [existing] = await db
      .select()
      .from(radarConfigs)
      .where(and(
        eq(radarConfigs.organizationId, organizationId),
        eq(radarConfigs.isActive, true)
      ))
      .limit(1);

    if (existing) return existing;

    const [newConfig] = await db.insert(radarConfigs).values({
      organizationId,
      name: "Default",
      isActive: true,
    }).returning();

    return newConfig;
  }

  async updateConfig(
    organizationId: number, 
    configId: number, 
    updates: Partial<InsertRadarConfig>
  ): Promise<RadarConfig> {
    const [updated] = await db
      .update(radarConfigs)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(radarConfigs.id, configId),
        eq(radarConfigs.organizationId, organizationId)
      ))
      .returning();

    return updated;
  }

  async fetchEnrichedData(parcel: ParcelData): Promise<EnrichedParcelData> {
    if (!parcel.latitude || !parcel.longitude) {
      return parcel;
    }

    const categories: LookupCategory[] = [
      "parcel_data",
      "tax_assessment", 
      "market_data",
      "flood_zone",
      "wetlands",
    ];

    const lookupOptions = {
      latitude: parcel.latitude,
      longitude: parcel.longitude,
      state: parcel.state,
      county: parcel.county,
      apn: parcel.apn,
    };

    const results = await dataSourceBroker.lookupMultiple(categories, lookupOptions);
    
    const enriched: EnrichedParcelData = { ...parcel };

    if (results.results.parcel_data?.success) {
      const parcelResult = results.results.parcel_data.data;
      enriched.assessedValue = enriched.assessedValue || parcelResult?.assessedValue;
      enriched.acreage = enriched.acreage || parcelResult?.acres;
      enriched.zoning = enriched.zoning || parcelResult?.zoning;
      
      if (parcelResult?.owner) {
        enriched.owner = {
          ownerName: parcelResult.owner.name,
          ownerState: parcelResult.owner.state,
          isOutOfState: parcelResult.owner.state !== parcel.state,
          isCorporate: this.detectCorporateOwner(parcelResult.owner.name),
          ownershipYears: parcelResult.owner.ownershipYears,
        };
      }
    }

    if (results.results.tax_assessment?.success) {
      const taxData = results.results.tax_assessment.data;
      if (!enriched.owner) enriched.owner = {};
      enriched.owner.isTaxDelinquent = taxData?.delinquent === true;
      enriched.owner.taxDelinquentAmount = taxData?.delinquentAmount;
    }

    if (results.results.market_data?.success) {
      const marketResult = results.results.market_data.data;
      enriched.market = {
        recentSales: marketResult?.recentSalesCount,
        absorptionRate: marketResult?.absorptionRate,
        avgPricePerAcre: marketResult?.avgPricePerAcre,
        medianDaysOnMarket: marketResult?.medianDom,
        priceChangePercent: marketResult?.priceChangePercent,
      };
    }

    if (results.results.flood_zone?.success || results.results.wetlands?.success) {
      enriched.environmental = {
        floodZone: results.results.flood_zone?.data?.zone,
        wetlandsPercent: results.results.wetlands?.data?.wetlandPercent,
        hasEnvironmentalIssues: 
          (results.results.flood_zone?.data?.zone && 
           !['X', 'UNSHADED X'].includes(results.results.flood_zone.data.zone)) ||
          (results.results.wetlands?.data?.wetlandPercent > 20),
      };
    }

    return enriched;
  }

  private detectCorporateOwner(ownerName?: string): boolean {
    if (!ownerName) return false;
    const corporateIndicators = [
      'LLC', 'INC', 'CORP', 'LP', 'LLP', 'TRUST', 'ESTATE',
      'COMPANY', 'PARTNERS', 'HOLDINGS', 'PROPERTIES', 'INVESTMENTS'
    ];
    const upper = ownerName.toUpperCase();
    return corporateIndicators.some(ind => upper.includes(ind));
  }

  scorePriceVsAssessed(
    parcel: EnrichedParcelData, 
    weight: number
  ): ScoreFactor {
    const listPrice = parcel.listPrice;
    const assessedValue = parcel.assessedValue;

    if (!listPrice || !assessedValue || assessedValue === 0) {
      return {
        score: 0,
        weight,
        contribution: 0,
        details: { explanation: "Insufficient price/assessed value data" }
      };
    }

    const discountPercent = ((assessedValue - listPrice) / assessedValue) * 100;
    
    let rawScore = 0;
    if (discountPercent >= 50) rawScore = 100;
    else if (discountPercent >= 40) rawScore = 90;
    else if (discountPercent >= 30) rawScore = 80;
    else if (discountPercent >= 20) rawScore = 60;
    else if (discountPercent >= 10) rawScore = 40;
    else if (discountPercent >= 0) rawScore = 20;
    else rawScore = 0;

    const contribution = (rawScore * weight) / 100;

    return {
      score: rawScore,
      weight,
      contribution,
      details: {
        listPrice,
        assessedValue,
        discountPercent: Math.round(discountPercent * 100) / 100,
        explanation: discountPercent >= 20 
          ? `Listed ${Math.round(discountPercent)}% below assessed value - significant opportunity`
          : discountPercent >= 10
          ? `Listed ${Math.round(discountPercent)}% below assessed value - moderate opportunity`
          : discountPercent >= 0
          ? `Listed near assessed value`
          : `Listed above assessed value - potential overpricing`
      }
    };
  }

  scoreDaysOnMarket(
    parcel: EnrichedParcelData,
    weight: number,
    thresholds: ScoringThresholds
  ): ScoreFactor {
    const dom = parcel.daysOnMarket;
    const marketMedian = parcel.market?.medianDaysOnMarket || 90;

    if (dom === undefined || dom === null) {
      return {
        score: 0,
        weight,
        contribution: 0,
        details: { dom: 0, explanation: "Days on market data unavailable" }
      };
    }

    if (dom > thresholds.maxDaysOnMarket) {
      return {
        score: 0,
        weight,
        contribution: 0,
        details: { 
          dom, 
          explanation: `Listed over ${thresholds.maxDaysOnMarket} days - likely issues` 
        }
      };
    }

    let rawScore = 0;
    const domRatio = dom / marketMedian;
    
    if (domRatio >= 3) rawScore = 100;
    else if (domRatio >= 2) rawScore = 80;
    else if (domRatio >= 1.5) rawScore = 60;
    else if (domRatio >= 1) rawScore = 40;
    else rawScore = 20;

    const contribution = (rawScore * weight) / 100;

    return {
      score: rawScore,
      weight,
      contribution,
      details: {
        dom,
        averageDom: marketMedian,
        explanation: dom > marketMedian * 2
          ? `On market ${dom} days (${Math.round(domRatio)}x market avg) - seller may be motivated`
          : dom > marketMedian
          ? `On market ${dom} days, above market average - potential negotiation room`
          : `On market ${dom} days, at or below market average`
      }
    };
  }

  scoreSellerMotivation(
    parcel: EnrichedParcelData,
    weight: number
  ): ScoreFactor {
    const signals: string[] = [];
    let rawScore = 0;

    if (parcel.owner?.isInherited) {
      signals.push("Inherited property");
      rawScore += 30;
    }

    if (parcel.owner?.isTaxDelinquent) {
      signals.push(`Tax delinquent${parcel.owner.taxDelinquentAmount ? ` ($${parcel.owner.taxDelinquentAmount})` : ''}`);
      rawScore += 35;
    }

    if (parcel.owner?.isOutOfState) {
      signals.push("Out-of-state owner");
      rawScore += 20;
    }

    if (parcel.owner?.ownershipYears && parcel.owner.ownershipYears > 15) {
      signals.push(`Long-term owner (${parcel.owner.ownershipYears} years)`);
      rawScore += 15;
    }

    if (parcel.daysOnMarket && parcel.daysOnMarket > 180) {
      signals.push("Extended time on market");
      rawScore += 10;
    }

    rawScore = Math.min(100, rawScore);
    const contribution = (rawScore * weight) / 100;

    return {
      score: rawScore,
      weight,
      contribution,
      details: {
        signals,
        explanation: signals.length > 0
          ? `Motivation signals detected: ${signals.join(', ')}`
          : "No clear motivation signals detected"
      }
    };
  }

  scoreMarketVelocity(
    parcel: EnrichedParcelData,
    weight: number
  ): ScoreFactor {
    const market = parcel.market;

    if (!market) {
      return {
        score: 0,
        weight,
        contribution: 0,
        details: { explanation: "Market data unavailable" }
      };
    }

    let rawScore = 50;

    if (market.absorptionRate) {
      if (market.absorptionRate > 2) rawScore += 20;
      else if (market.absorptionRate > 1) rawScore += 10;
      else if (market.absorptionRate < 0.5) rawScore -= 10;
    }

    if (market.priceChangePercent) {
      if (market.priceChangePercent > 10) rawScore += 20;
      else if (market.priceChangePercent > 5) rawScore += 10;
      else if (market.priceChangePercent < -5) rawScore -= 10;
    }

    if (market.recentSales && market.recentSales > 10) {
      rawScore += 10;
    }

    rawScore = Math.max(0, Math.min(100, rawScore));
    const contribution = (rawScore * weight) / 100;

    return {
      score: rawScore,
      weight,
      contribution,
      details: {
        recentSales: market.recentSales,
        absorptionRate: market.absorptionRate,
        priceChangePercent: market.priceChangePercent,
        explanation: market.priceChangePercent && market.priceChangePercent > 5
          ? `Active market with ${market.priceChangePercent}% price growth`
          : market.absorptionRate && market.absorptionRate > 1
          ? `Strong absorption rate indicates buyer demand`
          : `Market velocity is average`
      }
    };
  }

  scoreComparableSpreads(
    parcel: EnrichedParcelData,
    weight: number
  ): ScoreFactor {
    const listPrice = parcel.listPrice;
    const acreage = parcel.acreage;
    const avgPricePerAcre = parcel.market?.avgPricePerAcre;

    if (!listPrice || !acreage || !avgPricePerAcre || acreage === 0) {
      return {
        score: 0,
        weight,
        contribution: 0,
        details: { explanation: "Insufficient comparable data" }
      };
    }

    const parcelPricePerAcre = listPrice / acreage;
    const spreadPercent = ((avgPricePerAcre - parcelPricePerAcre) / avgPricePerAcre) * 100;

    let rawScore = 0;
    if (spreadPercent >= 40) rawScore = 100;
    else if (spreadPercent >= 30) rawScore = 85;
    else if (spreadPercent >= 20) rawScore = 70;
    else if (spreadPercent >= 10) rawScore = 50;
    else if (spreadPercent >= 0) rawScore = 30;
    else rawScore = 10;

    const contribution = (rawScore * weight) / 100;

    return {
      score: rawScore,
      weight,
      contribution,
      details: {
        avgCompPrice: avgPricePerAcre,
        pricePerAcre: Math.round(parcelPricePerAcre),
        spreadPercent: Math.round(spreadPercent * 100) / 100,
        explanation: spreadPercent >= 20
          ? `Priced ${Math.round(spreadPercent)}% below comparable sales - strong value`
          : spreadPercent >= 10
          ? `Priced ${Math.round(spreadPercent)}% below comps - fair value`
          : spreadPercent >= 0
          ? `Priced near comparable sales`
          : `Priced above comparable sales`
      }
    };
  }

  scoreEnvironmentalRisk(
    parcel: EnrichedParcelData,
    weight: number
  ): ScoreFactor {
    const env = parcel.environmental;

    if (!env) {
      return {
        score: 50,
        weight,
        contribution: (50 * weight) / 100,
        details: { riskLevel: "medium" as const, explanation: "Environmental data unavailable - assumed medium risk" }
      };
    }

    let riskScore = 0;

    if (env.floodZone) {
      const highRiskZones = ['A', 'AE', 'AH', 'AO', 'AR', 'V', 'VE'];
      const moderateRiskZones = ['B', 'X (SHADED)', 'D'];
      
      if (highRiskZones.some(z => env.floodZone?.startsWith(z))) {
        riskScore += 50;
      } else if (moderateRiskZones.includes(env.floodZone)) {
        riskScore += 20;
      }
    }

    if (env.wetlandsPercent) {
      if (env.wetlandsPercent > 50) riskScore += 40;
      else if (env.wetlandsPercent > 20) riskScore += 20;
      else if (env.wetlandsPercent > 5) riskScore += 10;
    }

    const rawScore = 100 - Math.min(100, riskScore);
    const contribution = (rawScore * Math.abs(weight)) / 100 * (weight < 0 ? -1 : 1);

    const riskLevel: "low" | "medium" | "high" = 
      riskScore > 50 ? "high" : riskScore > 20 ? "medium" : "low";

    return {
      score: rawScore,
      weight,
      contribution,
      details: {
        floodZone: env.floodZone,
        wetlandsPercent: env.wetlandsPercent,
        riskLevel,
        explanation: riskLevel === "high"
          ? `High environmental risk - flood zone ${env.floodZone || 'present'}${env.wetlandsPercent ? `, ${env.wetlandsPercent}% wetlands` : ''}`
          : riskLevel === "medium"
          ? `Moderate environmental factors present`
          : `Low environmental risk - clear for development`
      }
    };
  }

  scoreOwnerSignals(
    parcel: EnrichedParcelData,
    weight: number
  ): ScoreFactor {
    const owner = parcel.owner;

    if (!owner) {
      return {
        score: 0,
        weight,
        contribution: 0,
        details: { explanation: "Owner data unavailable" }
      };
    }

    let rawScore = 0;

    if (owner.isOutOfState) rawScore += 30;
    if (owner.isInherited) rawScore += 25;
    if (owner.isTaxDelinquent) rawScore += 30;
    if (owner.isCorporate) rawScore += 15;
    if (owner.ownershipYears && owner.ownershipYears > 20) rawScore += 10;

    rawScore = Math.min(100, rawScore);
    const contribution = (rawScore * weight) / 100;

    const signalsList = [];
    if (owner.isOutOfState) signalsList.push("out-of-state");
    if (owner.isInherited) signalsList.push("inherited");
    if (owner.isTaxDelinquent) signalsList.push("tax delinquent");
    if (owner.isCorporate) signalsList.push("corporate");

    return {
      score: rawScore,
      weight,
      contribution,
      details: {
        isOutOfState: owner.isOutOfState,
        isInherited: owner.isInherited,
        isTaxDelinquent: owner.isTaxDelinquent,
        isCorporate: owner.isCorporate,
        ownershipYears: owner.ownershipYears,
        explanation: signalsList.length > 0
          ? `Owner signals: ${signalsList.join(', ')}`
          : owner.ownershipYears && owner.ownershipYears > 10
          ? `Long-term owner (${owner.ownershipYears} years)`
          : "No notable owner signals"
      }
    };
  }

  determineOpportunityType(
    factors: ScoreBreakdown,
    parcel: EnrichedParcelData
  ): OpportunityType {
    const priceScore = factors.priceVsAssessed?.score || 0;
    const motivationScore = factors.sellerMotivation?.score || 0;
    const marketScore = factors.marketVelocity?.score || 0;
    const ownerScore = factors.ownerSignals?.score || 0;

    if (!parcel.listPrice && (parcel.owner?.isTaxDelinquent || parcel.owner?.isInherited)) {
      return "off_market";
    }

    if (marketScore >= 70 && factors.marketVelocity?.details?.priceChangePercent > 10) {
      return "market_shift";
    }

    if (motivationScore >= 60 || ownerScore >= 60) {
      return "motivated_seller";
    }

    if (priceScore >= 60) {
      return "undervalued";
    }

    return "undervalued";
  }

  generateExplanation(
    factors: ScoreBreakdown,
    totalScore: number,
    opportunityType: OpportunityType
  ): string {
    const topFactors: { name: string; contribution: number; explanation: string }[] = [];

    for (const [name, factor] of Object.entries(factors)) {
      if (factor && factor.contribution > 0) {
        topFactors.push({
          name: name.replace(/([A-Z])/g, ' $1').trim(),
          contribution: factor.contribution,
          explanation: factor.details.explanation,
        });
      }
    }

    topFactors.sort((a, b) => b.contribution - a.contribution);
    const top3 = topFactors.slice(0, 3);

    const oppType = OPPORTUNITY_TYPES[opportunityType];
    
    let explanation = `${oppType.name} opportunity (Score: ${totalScore}/100). `;
    
    if (top3.length > 0) {
      explanation += `Key factors: `;
      explanation += top3.map((f, i) => `${i + 1}) ${f.explanation}`).join(' ');
    }

    return explanation;
  }

  async scoreParcel(
    parcel: ParcelData,
    config: RadarConfig
  ): Promise<ScoringResult> {
    const enriched = await this.fetchEnrichedData(parcel);
    
    const weights = (config.weights as ScoringWeights) || DEFAULT_WEIGHTS;
    const thresholds = (config.thresholds as ScoringThresholds) || DEFAULT_THRESHOLDS;

    const factors: ScoreBreakdown = {
      priceVsAssessed: this.scorePriceVsAssessed(enriched, weights.priceVsAssessed),
      daysOnMarket: this.scoreDaysOnMarket(enriched, weights.daysOnMarket, thresholds),
      sellerMotivation: this.scoreSellerMotivation(enriched, weights.sellerMotivation),
      marketVelocity: this.scoreMarketVelocity(enriched, weights.marketVelocity),
      comparableSpreads: this.scoreComparableSpreads(enriched, weights.comparableSpreads),
      environmentalRisk: this.scoreEnvironmentalRisk(enriched, weights.environmentalRisk),
      ownerSignals: this.scoreOwnerSignals(enriched, weights.ownerSignals),
    };

    let totalContribution = 0;
    let totalWeight = 0;

    for (const factor of Object.values(factors)) {
      if (factor) {
        totalContribution += factor.contribution;
        totalWeight += Math.abs(factor.weight);
      }
    }

    const normalizedScore = totalWeight > 0 
      ? Math.round(Math.max(0, Math.min(100, (totalContribution / totalWeight) * 100)))
      : 0;

    const opportunityType = this.determineOpportunityType(factors, enriched);
    const explanation = this.generateExplanation(factors, normalizedScore, opportunityType);

    return {
      score: normalizedScore,
      opportunityType,
      factors,
      explanation,
      dataSources: [],
    };
  }

  async saveOpportunityScore(
    organizationId: number,
    parcel: ParcelData,
    result: ScoringResult,
    radarConfigId?: number
  ): Promise<OpportunityScore> {
    const existing = await db
      .select()
      .from(opportunityScores)
      .where(and(
        eq(opportunityScores.organizationId, organizationId),
        eq(opportunityScores.apn, parcel.apn || ''),
        eq(opportunityScores.county, parcel.county || ''),
        eq(opportunityScores.state, parcel.state || '')
      ))
      .limit(1);

    const previousScore = existing[0]?.score;
    const scoreChange = previousScore ? result.score - previousScore : undefined;

    if (existing.length > 0) {
      const [updated] = await db
        .update(opportunityScores)
        .set({
          score: result.score,
          previousScore,
          scoreChange,
          opportunityType: result.opportunityType,
          scoreFactors: result.factors as any,
          explanation: result.explanation,
          dataSources: result.dataSources as any,
          isStale: false,
          scoredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(opportunityScores.id, existing[0].id))
        .returning();

      return updated;
    }

    const [newScore] = await db.insert(opportunityScores).values({
      organizationId,
      radarConfigId,
      propertyId: parcel.propertyId,
      apn: parcel.apn,
      county: parcel.county,
      state: parcel.state,
      opportunityType: result.opportunityType,
      score: result.score,
      scoreFactors: result.factors as any,
      explanation: result.explanation,
      dataSources: result.dataSources as any,
      status: "new",
    }).returning();

    return newScore;
  }

  async getTopOpportunities(
    organizationId: number,
    options: {
      limit?: number;
      county?: string;
      state?: string;
      opportunityType?: OpportunityType;
      minScore?: number;
      status?: string;
    } = {}
  ): Promise<OpportunityScore[]> {
    const {
      limit = 20,
      county,
      state,
      opportunityType,
      minScore = 40,
      status,
    } = options;

    const conditions = [
      eq(opportunityScores.organizationId, organizationId),
      gte(opportunityScores.score, minScore),
      eq(opportunityScores.isStale, false),
    ];

    if (county) conditions.push(eq(opportunityScores.county, county));
    if (state) conditions.push(eq(opportunityScores.state, state));
    if (opportunityType) conditions.push(eq(opportunityScores.opportunityType, opportunityType));
    if (status) conditions.push(eq(opportunityScores.status, status));

    return db
      .select()
      .from(opportunityScores)
      .where(and(...conditions))
      .orderBy(desc(opportunityScores.score))
      .limit(limit);
  }

  async getOpportunitiesByMarket(
    organizationId: number,
    topN: number = 10
  ): Promise<Record<string, OpportunityScore[]>> {
    const opportunities = await db
      .select()
      .from(opportunityScores)
      .where(and(
        eq(opportunityScores.organizationId, organizationId),
        gte(opportunityScores.score, 40),
        eq(opportunityScores.isStale, false)
      ))
      .orderBy(desc(opportunityScores.score));

    const byMarket: Record<string, OpportunityScore[]> = {};

    for (const opp of opportunities) {
      const market = `${opp.county || 'Unknown'}, ${opp.state || 'Unknown'}`;
      if (!byMarket[market]) byMarket[market] = [];
      if (byMarket[market].length < topN) {
        byMarket[market].push(opp);
      }
    }

    return byMarket;
  }

  async updateOpportunityStatus(
    opportunityId: number,
    organizationId: number,
    status: string,
    reviewNotes?: string,
    reviewedBy?: string
  ): Promise<OpportunityScore | null> {
    const [updated] = await db
      .update(opportunityScores)
      .set({
        status,
        reviewNotes,
        reviewedBy,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(opportunityScores.id, opportunityId),
        eq(opportunityScores.organizationId, organizationId)
      ))
      .returning();

    return updated || null;
  }

  async emitOpportunityEvent(
    organizationId: number,
    eventType: string,
    opportunity: OpportunityScore
  ): Promise<void> {
    await db.insert(agentEvents).values({
      organizationId,
      eventType,
      eventSource: "acquisition_radar",
      payload: {
        opportunityId: opportunity.id,
        score: opportunity.score,
        opportunityType: opportunity.opportunityType,
        apn: opportunity.apn,
        county: opportunity.county,
        state: opportunity.state,
        explanation: opportunity.explanation,
      },
      relatedEntityType: "opportunity_score",
      relatedEntityId: opportunity.id,
    });
  }

  async subscribeToOpportunities(
    organizationId: number,
    subscriberId: string,
    subscriberType: "agent" | "workflow" | "webhook" = "agent",
    minScore: number = 60
  ): Promise<void> {
    await db.insert(eventSubscriptions).values({
      organizationId,
      subscriberType,
      subscriberId,
      eventType: "new_opportunity",
      eventFilter: {
        entityType: "opportunity_score",
        conditions: { minScore },
      },
      isActive: true,
    });
  }

  async processOpportunityAlerts(organizationId: number): Promise<number> {
    const config = await this.getOrCreateConfig(organizationId);
    const alertSettings = config.alertSettings as {
      enabled: boolean;
      topNPerMarket: number;
      autoTriggerDueDiligence: boolean;
      notifyOnHotOnly: boolean;
    } | null;

    if (!alertSettings?.enabled) return 0;

    const thresholds = (config.thresholds as ScoringThresholds) || DEFAULT_THRESHOLDS;
    const minScore = alertSettings.notifyOnHotOnly 
      ? thresholds.hotOpportunity 
      : thresholds.goodOpportunity;

    const unsent = await db
      .select()
      .from(opportunityScores)
      .where(and(
        eq(opportunityScores.organizationId, organizationId),
        eq(opportunityScores.alertSent, false),
        gte(opportunityScores.score, minScore),
        eq(opportunityScores.status, "new")
      ))
      .orderBy(desc(opportunityScores.score))
      .limit(alertSettings.topNPerMarket * 10);

    let alertCount = 0;

    for (const opp of unsent) {
      await this.emitOpportunityEvent(organizationId, "new_opportunity", opp);
      
      await db
        .update(opportunityScores)
        .set({ 
          alertSent: true, 
          alertSentAt: new Date() 
        })
        .where(eq(opportunityScores.id, opp.id));

      if (alertSettings.autoTriggerDueDiligence && opp.score >= thresholds.hotOpportunity) {
        await this.emitOpportunityEvent(organizationId, "trigger_due_diligence", opp);
        await db
          .update(opportunityScores)
          .set({ dueDiligenceTriggered: true })
          .where(eq(opportunityScores.id, opp.id));
      }

      alertCount++;
    }

    return alertCount;
  }

  async scanParcelsForOrganization(
    organizationId: number,
    options: {
      county?: string;
      state?: string;
      limit?: number;
    } = {}
  ): Promise<{
    scanned: number;
    scored: number;
    newOpportunities: number;
    updatedOpportunities: number;
  }> {
    const config = await this.getOrCreateConfig(organizationId);
    const scannerSettings = config.scannerSettings as ScannerConfig | null;
    const batchSize = options.limit || scannerSettings?.batchSize || 100;

    const conditions = [eq(properties.organizationId, organizationId)];
    if (options.county) conditions.push(eq(properties.county, options.county));
    if (options.state) conditions.push(eq(properties.state, options.state));

    const parcels = await db
      .select()
      .from(properties)
      .where(and(...conditions))
      .limit(batchSize);

    let scanned = 0;
    let scored = 0;
    let newOpportunities = 0;
    let updatedOpportunities = 0;

    for (const property of parcels) {
      scanned++;

      const parcelData: ParcelData = {
        propertyId: property.id,
        apn: property.apn,
        county: property.county,
        state: property.state,
        latitude: property.latitude ? parseFloat(property.latitude) : undefined,
        longitude: property.longitude ? parseFloat(property.longitude) : undefined,
        listPrice: property.listPrice ? parseFloat(property.listPrice) : undefined,
        assessedValue: property.assessedValue ? parseFloat(property.assessedValue) : undefined,
        acreage: property.sizeAcres ? parseFloat(property.sizeAcres) : undefined,
        zoning: property.zoning || undefined,
      };

      try {
        const result = await this.scoreParcel(parcelData, config);
        scored++;

        const thresholds = (config.thresholds as ScoringThresholds) || DEFAULT_THRESHOLDS;
        
        if (result.score >= thresholds.minimumScore) {
          const existing = await db
            .select()
            .from(opportunityScores)
            .where(and(
              eq(opportunityScores.organizationId, organizationId),
              eq(opportunityScores.apn, parcelData.apn || ''),
            ))
            .limit(1);

          await this.saveOpportunityScore(organizationId, parcelData, result, config.id);
          
          if (existing.length > 0) {
            updatedOpportunities++;
          } else {
            newOpportunities++;
          }
        }
      } catch (error) {
        console.error(`[acquisition-radar] Error scoring parcel ${property.apn}:`, error);
      }
    }

    await this.processOpportunityAlerts(organizationId);

    return { scanned, scored, newOpportunities, updatedOpportunities };
  }

  async markStaleOpportunities(organizationId: number, staleDays: number = 7): Promise<number> {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - staleDays);

    const result = await db
      .update(opportunityScores)
      .set({ isStale: true })
      .where(and(
        eq(opportunityScores.organizationId, organizationId),
        lte(opportunityScores.scoredAt, staleDate),
        eq(opportunityScores.isStale, false)
      ));

    return 0;
  }

  startBackgroundScanner(
    organizationId: number,
    intervalMinutes: number = 60
  ): void {
    if (this.scanIntervalId) {
      clearInterval(this.scanIntervalId);
    }

    const runScan = async () => {
      if (this.isScanning) return;
      
      this.isScanning = true;
      console.log(`[acquisition-radar] Starting background scan for org ${organizationId}`);
      
      try {
        await this.markStaleOpportunities(organizationId);
        const results = await this.scanParcelsForOrganization(organizationId);
        console.log(`[acquisition-radar] Scan complete:`, results);
      } catch (error) {
        console.error(`[acquisition-radar] Background scan error:`, error);
      } finally {
        this.isScanning = false;
      }
    };

    runScan();

    this.scanIntervalId = setInterval(runScan, intervalMinutes * 60 * 1000);
  }

  stopBackgroundScanner(): void {
    if (this.scanIntervalId) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
    }
  }

  async getRadarStats(organizationId: number): Promise<{
    totalOpportunities: number;
    hotOpportunities: number;
    byType: Record<string, number>;
    byMarket: Record<string, number>;
    avgScore: number;
    lastScanAt: Date | null;
  }> {
    const opportunities = await db
      .select()
      .from(opportunityScores)
      .where(and(
        eq(opportunityScores.organizationId, organizationId),
        eq(opportunityScores.isStale, false)
      ));

    const config = await this.getOrCreateConfig(organizationId);
    const thresholds = (config.thresholds as ScoringThresholds) || DEFAULT_THRESHOLDS;

    const byType: Record<string, number> = {};
    const byMarket: Record<string, number> = {};
    let totalScore = 0;
    let hotCount = 0;
    let lastScanAt: Date | null = null;

    for (const opp of opportunities) {
      byType[opp.opportunityType] = (byType[opp.opportunityType] || 0) + 1;
      
      const market = `${opp.county || 'Unknown'}, ${opp.state || 'Unknown'}`;
      byMarket[market] = (byMarket[market] || 0) + 1;
      
      totalScore += opp.score;
      
      if (opp.score >= thresholds.hotOpportunity) hotCount++;
      
      if (!lastScanAt || (opp.scoredAt && opp.scoredAt > lastScanAt)) {
        lastScanAt = opp.scoredAt;
      }
    }

    return {
      totalOpportunities: opportunities.length,
      hotOpportunities: hotCount,
      byType,
      byMarket,
      avgScore: opportunities.length > 0 ? Math.round(totalScore / opportunities.length) : 0,
      lastScanAt,
    };
  }
}

export const acquisitionRadar = new AcquisitionRadarService();
