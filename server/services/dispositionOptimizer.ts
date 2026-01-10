/**
 * Disposition Optimizer Service
 * Provides best channel/price/timing recommendations for selling properties
 */

import { db } from "../db";
import {
  dispositionRecommendations,
  properties,
  deals,
  marketMetrics,
  agentEvents,
  type DispositionRecommendation,
  type InsertDispositionRecommendation,
  type Property,
  type Deal,
} from "@shared/schema";
import { eq, and, desc, gte, inArray } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";
import { getComparableProperties, ComparableProperty } from "./comps";

type DispositionStrategy = "list_retail" | "sell_wholesale" | "owner_finance" | "auction" | "hold";
type MarketingChannel = "mls" | "facebook" | "craigslist" | "landwatch" | "direct_mail" | "buyer_list";

interface PropertyAnalysis {
  property: Property;
  acquisitionCost: number;
  holdingDays: number;
  marketValue: number;
  pricePerAcre: number;
  comparables: ComparableProperty[];
  marketCondition: string;
  recommendedStrategy: DispositionStrategy;
  confidence: number;
}

interface ChannelRecommendation {
  channel: MarketingChannel;
  priority: number;
  estimatedReach: number;
  estimatedCost: number;
  notes?: string;
}

interface TimingAnalysis {
  optimalListDate: string;
  seasonality: string;
  marketTrend: string;
  urgencyScore: number;
  holdRecommendation?: string;
}

interface TargetBuyerProfile {
  profileType: string;
  likelyUseCase: string;
  financingPreference: string;
  keyFeaturesToHighlight: string[];
}

interface OwnerFinanceTerms {
  downPaymentPercent: number;
  interestRate: number;
  termMonths: number;
  monthlyPayment: number;
  totalValue: number;
}

interface ROIAnalysis {
  acquisitionCost: number;
  holdingCosts: number;
  sellingCosts: number;
  netProfit: number;
  roi: number;
  annualizedReturn: number;
}

interface StrategyComparison {
  strategy: DispositionStrategy;
  expectedValue: number;
  pros: string[];
  cons: string[];
  timeToSell: number;
  netProfit: number;
  roi: number;
}

interface PricingRecommendation {
  recommendedPrice: number;
  priceRange: { min: number; max: number };
  marketComps: Array<{ address: string; price: number; soldDate?: string }>;
  pricePerAcre: number;
  daysToSellEstimate: number;
}

const STRATEGIES: DispositionStrategy[] = ["list_retail", "sell_wholesale", "owner_finance", "auction", "hold"];
const CHANNELS: MarketingChannel[] = ["mls", "facebook", "craigslist", "landwatch", "direct_mail", "buyer_list"];

const CHANNEL_COSTS: Record<MarketingChannel, number> = {
  mls: 500,
  facebook: 200,
  craigslist: 0,
  landwatch: 300,
  direct_mail: 1000,
  buyer_list: 50,
};

const CHANNEL_REACH: Record<MarketingChannel, number> = {
  mls: 5000,
  facebook: 10000,
  craigslist: 3000,
  landwatch: 8000,
  direct_mail: 500,
  buyer_list: 200,
};

export class DispositionOptimizerService {

  async analyzeProperty(
    organizationId: number,
    propertyId: number
  ): Promise<PropertyAnalysis> {
    const [property] = await db.select().from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const acquisitionCost = property.purchasePrice ? parseFloat(property.purchasePrice) : 0;
    const purchaseDate = property.purchaseDate || property.createdAt;
    const holdingDays = purchaseDate 
      ? Math.floor((Date.now() - new Date(purchaseDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const comps = await this.findComparables(propertyId);
    const marketValue = this.calculateMarketValue(property, comps);
    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 1;
    const pricePerAcre = marketValue / sizeAcres;

    const marketCondition = await this.getMarketCondition(property.county, property.state);
    const { strategy, confidence } = this.determineOptimalStrategy(property, marketValue, acquisitionCost, comps, marketCondition);

    await this.logEvent(organizationId, "property_analyzed", {
      propertyId,
      marketValue,
      recommendedStrategy: strategy,
      confidence,
    });

    return {
      property,
      acquisitionCost,
      holdingDays,
      marketValue,
      pricePerAcre,
      comparables: comps,
      marketCondition,
      recommendedStrategy: strategy,
      confidence,
    };
  }

  async generateRecommendation(
    organizationId: number,
    propertyId: number
  ): Promise<DispositionRecommendation> {
    const analysis = await this.analyzeProperty(organizationId, propertyId);
    const { property, marketValue, acquisitionCost, comparables, marketCondition } = analysis;

    const pricing = await this.calculateOptimalPrice(propertyId);
    const channels = await this.recommendChannels(propertyId);
    const timing = await this.analyzeTimingFactors(propertyId);
    const targetBuyer = this.determineTargetBuyer(property, analysis.recommendedStrategy);
    const roiAnalysis = await this.calculateROI(organizationId, propertyId);
    const alternatives = await this.compareStrategies(organizationId, propertyId);

    let ownerFinanceTerms: OwnerFinanceTerms | undefined;
    if (analysis.recommendedStrategy === "owner_finance" || marketValue > 20000) {
      ownerFinanceTerms = await this.calculateOwnerFinanceTerms(propertyId, pricing.recommendedPrice);
    }

    const confidence = Math.round(analysis.confidence * 100);

    const recommendation: InsertDispositionRecommendation = {
      organizationId,
      propertyId,
      strategy: analysis.recommendedStrategy,
      confidence,
      pricing,
      channels,
      timing,
      targetBuyer,
      ownerFinanceTerms: ownerFinanceTerms || null,
      roiAnalysis,
      alternatives,
    };

    const [inserted] = await db.insert(dispositionRecommendations)
      .values(recommendation)
      .returning();

    await this.logEvent(organizationId, "disposition_recommendation_created", {
      recommendationId: inserted.id,
      propertyId,
      strategy: analysis.recommendedStrategy,
      confidence,
      recommendedPrice: pricing.recommendedPrice,
    });

    return inserted;
  }

  async calculateOptimalPrice(propertyId: number): Promise<PricingRecommendation> {
    const [property] = await db.select().from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const comps = await this.findComparables(propertyId);
    const marketValue = this.calculateMarketValue(property, comps);
    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 1;

    const recommendedPrice = Math.round(marketValue * 1.05);
    const priceRange = {
      min: Math.round(marketValue * 0.90),
      max: Math.round(marketValue * 1.15),
    };

    const marketComps = comps.slice(0, 5).map(c => ({
      address: c.address || c.apn,
      price: c.salePrice || 0,
      soldDate: c.saleDate || undefined,
    }));

    const avgDaysOnMarket = await this.getAverageDaysOnMarket(property.county, property.state);

    return {
      recommendedPrice,
      priceRange,
      marketComps,
      pricePerAcre: Math.round(recommendedPrice / sizeAcres),
      daysToSellEstimate: avgDaysOnMarket,
    };
  }

  async recommendChannels(propertyId: number): Promise<ChannelRecommendation[]> {
    const [property] = await db.select().from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 1;
    const marketValue = property.marketValue ? parseFloat(property.marketValue) : 0;

    const recommendations: ChannelRecommendation[] = [];

    if (marketValue >= 50000) {
      recommendations.push({
        channel: "mls",
        priority: 1,
        estimatedReach: CHANNEL_REACH.mls,
        estimatedCost: CHANNEL_COSTS.mls,
        notes: "Best for high-value properties with broad buyer appeal",
      });
    }

    recommendations.push({
      channel: "landwatch",
      priority: recommendations.length + 1,
      estimatedReach: CHANNEL_REACH.landwatch,
      estimatedCost: CHANNEL_COSTS.landwatch,
      notes: "Specialized land marketplace with targeted buyers",
    });

    recommendations.push({
      channel: "facebook",
      priority: recommendations.length + 1,
      estimatedReach: CHANNEL_REACH.facebook,
      estimatedCost: CHANNEL_COSTS.facebook,
      notes: "Good for local buyers and investors",
    });

    if (sizeAcres <= 10) {
      recommendations.push({
        channel: "craigslist",
        priority: recommendations.length + 1,
        estimatedReach: CHANNEL_REACH.craigslist,
        estimatedCost: CHANNEL_COSTS.craigslist,
        notes: "Free listing, good for smaller parcels",
      });
    }

    recommendations.push({
      channel: "buyer_list",
      priority: recommendations.length + 1,
      estimatedReach: CHANNEL_REACH.buyer_list,
      estimatedCost: CHANNEL_COSTS.buyer_list,
      notes: "Existing buyer database for quick sales",
    });

    if (marketValue >= 30000) {
      recommendations.push({
        channel: "direct_mail",
        priority: recommendations.length + 1,
        estimatedReach: CHANNEL_REACH.direct_mail,
        estimatedCost: CHANNEL_COSTS.direct_mail,
        notes: "Target neighboring property owners",
      });
    }

    return recommendations;
  }

  async analyzeTimingFactors(propertyId: number): Promise<TimingAnalysis> {
    const [property] = await db.select().from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const marketCondition = await this.getMarketCondition(property.county, property.state);
    const currentMonth = new Date().getMonth();

    let seasonality: string;
    let optimalListDateOffset = 0;

    if (currentMonth >= 2 && currentMonth <= 5) {
      seasonality = "peak_season";
      optimalListDateOffset = 0;
    } else if (currentMonth >= 6 && currentMonth <= 8) {
      seasonality = "summer_slowdown";
      optimalListDateOffset = 14;
    } else if (currentMonth >= 9 && currentMonth <= 10) {
      seasonality = "fall_activity";
      optimalListDateOffset = 7;
    } else {
      seasonality = "off_season";
      optimalListDateOffset = 30;
    }

    const optimalListDate = new Date();
    optimalListDate.setDate(optimalListDate.getDate() + optimalListDateOffset);

    let urgencyScore = 50;
    if (marketCondition === "heating") {
      urgencyScore = 80;
    } else if (marketCondition === "cooling") {
      urgencyScore = 30;
    } else if (seasonality === "peak_season") {
      urgencyScore = 70;
    }

    const acquisitionDate = property.purchaseDate || property.createdAt;
    const holdingMonths = acquisitionDate
      ? Math.floor((Date.now() - new Date(acquisitionDate).getTime()) / (1000 * 60 * 60 * 24 * 30))
      : 0;

    let holdRecommendation: string | undefined;
    if (holdingMonths < 3 && marketCondition !== "heating") {
      holdRecommendation = "Consider holding 3-6 months for better market conditions";
    } else if (marketCondition === "cooling" && seasonality === "off_season") {
      holdRecommendation = "Market conditions suggest waiting until spring";
    }

    return {
      optimalListDate: optimalListDate.toISOString().split('T')[0],
      seasonality,
      marketTrend: marketCondition,
      urgencyScore,
      holdRecommendation,
    };
  }

  async calculateOwnerFinanceTerms(
    propertyId: number,
    salePrice: number
  ): Promise<OwnerFinanceTerms> {
    const [property] = await db.select().from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    let downPaymentPercent: number;
    let interestRate: number;
    let termMonths: number;

    if (salePrice < 10000) {
      downPaymentPercent = 20;
      interestRate = 10;
      termMonths = 36;
    } else if (salePrice < 25000) {
      downPaymentPercent = 15;
      interestRate = 9.5;
      termMonths = 60;
    } else if (salePrice < 50000) {
      downPaymentPercent = 10;
      interestRate = 9;
      termMonths = 84;
    } else {
      downPaymentPercent = 10;
      interestRate = 8.5;
      termMonths = 120;
    }

    const downPayment = salePrice * (downPaymentPercent / 100);
    const principal = salePrice - downPayment;
    const monthlyRate = interestRate / 100 / 12;
    
    const monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / 
                           (Math.pow(1 + monthlyRate, termMonths) - 1);

    const totalValue = downPayment + (monthlyPayment * termMonths);

    return {
      downPaymentPercent,
      interestRate,
      termMonths,
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
      totalValue: Math.round(totalValue),
    };
  }

  async calculateROI(
    organizationId: number,
    propertyId: number
  ): Promise<ROIAnalysis> {
    const [property] = await db.select().from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const acquisitionCost = property.purchasePrice ? parseFloat(property.purchasePrice) : 0;
    const purchaseDate = property.purchaseDate || property.createdAt;
    const holdingDays = purchaseDate
      ? Math.floor((Date.now() - new Date(purchaseDate).getTime()) / (1000 * 60 * 60 * 24))
      : 30;

    const annualPropertyTax = property.assessedValue 
      ? parseFloat(property.assessedValue) * 0.015 
      : 0;
    const holdingCostPerDay = (annualPropertyTax / 365) + 1;
    const holdingCosts = Math.round(holdingCostPerDay * holdingDays);

    const pricing = await this.calculateOptimalPrice(propertyId);
    const salePrice = pricing.recommendedPrice;

    const sellingCostsPercent = 0.08;
    const sellingCosts = Math.round(salePrice * sellingCostsPercent);

    const netProfit = salePrice - acquisitionCost - holdingCosts - sellingCosts;
    const totalInvestment = acquisitionCost + holdingCosts;
    const roi = totalInvestment > 0 ? (netProfit / totalInvestment) * 100 : 0;

    const holdingYears = Math.max(holdingDays / 365, 1/12);
    const annualizedReturn = Math.pow(1 + (roi / 100), 1 / holdingYears) - 1;

    return {
      acquisitionCost,
      holdingCosts,
      sellingCosts,
      netProfit: Math.round(netProfit),
      roi: Math.round(roi * 100) / 100,
      annualizedReturn: Math.round(annualizedReturn * 10000) / 100,
    };
  }

  async compareStrategies(
    organizationId: number,
    propertyId: number
  ): Promise<StrategyComparison[]> {
    const [property] = await db.select().from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const pricing = await this.calculateOptimalPrice(propertyId);
    const baseROI = await this.calculateROI(organizationId, propertyId);
    const ownerFinanceTerms = await this.calculateOwnerFinanceTerms(propertyId, pricing.recommendedPrice);

    const comparisons: StrategyComparison[] = [];

    comparisons.push({
      strategy: "list_retail",
      expectedValue: pricing.recommendedPrice,
      pros: [
        "Maximum sale price potential",
        "Access to retail buyer market",
        "Standard transaction process",
      ],
      cons: [
        "Longer time to sell (60-180 days)",
        "Marketing costs",
        "Buyer financing contingencies",
      ],
      timeToSell: pricing.daysToSellEstimate,
      netProfit: baseROI.netProfit,
      roi: baseROI.roi,
    });

    const wholesalePrice = Math.round(pricing.recommendedPrice * 0.70);
    const wholesaleProfit = wholesalePrice - baseROI.acquisitionCost - baseROI.holdingCosts - 500;
    comparisons.push({
      strategy: "sell_wholesale",
      expectedValue: wholesalePrice,
      pros: [
        "Quick sale (7-30 days)",
        "Cash buyers, no financing contingency",
        "Lower marketing costs",
      ],
      cons: [
        "30-40% discount from retail",
        "Limited buyer pool",
        "Requires investor network",
      ],
      timeToSell: 14,
      netProfit: wholesaleProfit,
      roi: baseROI.acquisitionCost > 0 ? (wholesaleProfit / baseROI.acquisitionCost) * 100 : 0,
    });

    comparisons.push({
      strategy: "owner_finance",
      expectedValue: ownerFinanceTerms.totalValue,
      pros: [
        "Premium total return (10-20% higher)",
        "Monthly cash flow",
        "Larger buyer pool",
        "Retain collateral until paid",
      ],
      cons: [
        "Delayed full payment",
        "Default risk",
        "Collection management",
        "Tied up capital",
      ],
      timeToSell: 45,
      netProfit: ownerFinanceTerms.totalValue - baseROI.acquisitionCost - baseROI.holdingCosts - 300,
      roi: baseROI.acquisitionCost > 0 
        ? ((ownerFinanceTerms.totalValue - baseROI.acquisitionCost) / baseROI.acquisitionCost) * 100 
        : 0,
    });

    const auctionPrice = Math.round(pricing.recommendedPrice * 0.85);
    const auctionProfit = auctionPrice - baseROI.acquisitionCost - baseROI.holdingCosts - 800;
    comparisons.push({
      strategy: "auction",
      expectedValue: auctionPrice,
      pros: [
        "Defined timeline",
        "Creates urgency among buyers",
        "Market-driven pricing",
      ],
      cons: [
        "Auction fees (10-15%)",
        "Uncertain final price",
        "May not meet reserve",
      ],
      timeToSell: 30,
      netProfit: auctionProfit,
      roi: baseROI.acquisitionCost > 0 ? (auctionProfit / baseROI.acquisitionCost) * 100 : 0,
    });

    const marketCondition = await this.getMarketCondition(property.county, property.state);
    const holdAppreciation = marketCondition === "heating" ? 0.08 : marketCondition === "cooling" ? 0.02 : 0.05;
    const futureValue = Math.round(pricing.recommendedPrice * (1 + holdAppreciation));
    comparisons.push({
      strategy: "hold",
      expectedValue: futureValue,
      pros: [
        "Potential appreciation",
        "No immediate selling costs",
        "Flexibility for future",
      ],
      cons: [
        "Ongoing holding costs",
        "Market uncertainty",
        "Opportunity cost",
        "Property tax obligations",
      ],
      timeToSell: 365,
      netProfit: futureValue - baseROI.acquisitionCost - baseROI.holdingCosts * 12 - baseROI.sellingCosts,
      roi: 0,
    });

    return comparisons;
  }

  async getRecommendation(recommendationId: number): Promise<DispositionRecommendation | null> {
    const [recommendation] = await db.select().from(dispositionRecommendations)
      .where(eq(dispositionRecommendations.id, recommendationId));

    return recommendation || null;
  }

  async getRecommendationsByProperty(
    organizationId: number,
    propertyId: number
  ): Promise<DispositionRecommendation[]> {
    return db.select().from(dispositionRecommendations)
      .where(and(
        eq(dispositionRecommendations.organizationId, organizationId),
        eq(dispositionRecommendations.propertyId, propertyId)
      ))
      .orderBy(desc(dispositionRecommendations.createdAt));
  }

  async getPropertiesReadyForDisposition(
    organizationId: number
  ): Promise<Property[]> {
    const eligibleStatuses = ["owned", "listed"];
    
    return db.select().from(properties)
      .where(and(
        eq(properties.organizationId, organizationId),
        inArray(properties.status, eligibleStatuses)
      ))
      .orderBy(desc(properties.createdAt));
  }

  async refreshRecommendation(
    recommendationId: number
  ): Promise<DispositionRecommendation> {
    const existing = await this.getRecommendation(recommendationId);
    
    if (!existing) {
      throw new Error(`Recommendation ${recommendationId} not found`);
    }

    const newRecommendation = await this.generateRecommendation(
      existing.organizationId,
      existing.propertyId
    );

    await this.logEvent(existing.organizationId, "recommendation_refreshed", {
      oldRecommendationId: recommendationId,
      newRecommendationId: newRecommendation.id,
      propertyId: existing.propertyId,
    });

    return newRecommendation;
  }

  private async findComparables(
    propertyId: number,
    radiusMiles: number = 10,
    monthsBack: number = 12
  ): Promise<ComparableProperty[]> {
    const [property] = await db.select().from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      return [];
    }

    const lat = property.latitude ? parseFloat(property.latitude) : null;
    const lng = property.longitude ? parseFloat(property.longitude) : null;

    if (!lat || !lng) {
      return [];
    }

    const minSaleDate = new Date();
    minSaleDate.setMonth(minSaleDate.getMonth() - monthsBack);

    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 5;
    const minAcreage = sizeAcres * 0.5;
    const maxAcreage = sizeAcres * 2;

    const result = await getComparableProperties(
      lat,
      lng,
      radiusMiles,
      {
        minAcreage,
        maxAcreage,
        minSaleDate: minSaleDate.toISOString().split('T')[0],
        maxResults: 20,
      },
      property.organizationId
    );

    if (!result.success) {
      console.error("[DispositionOptimizer] Failed to find comps:", result.error);
      return [];
    }

    return result.comps.filter(c => c.salePrice && c.salePrice > 0);
  }

  private calculateMarketValue(property: Property, comps: ComparableProperty[]): number {
    if (comps.length === 0) {
      const assessed = property.assessedValue ? parseFloat(property.assessedValue) : null;
      const market = property.marketValue ? parseFloat(property.marketValue) : null;
      return market || assessed || 0;
    }

    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 1;
    const compsWithPrices = comps.filter(c => c.pricePerAcre && c.pricePerAcre > 0);

    if (compsWithPrices.length === 0) {
      return property.marketValue ? parseFloat(property.marketValue) : 0;
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const comp of compsWithPrices) {
      const distanceWeight = 1 / (comp.distance + 0.5);
      
      let recencyWeight = 1.0;
      if (comp.saleDate) {
        const saleDate = new Date(comp.saleDate);
        const monthsAgo = (Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
        recencyWeight = Math.max(0.5, 1 - (monthsAgo / 24));
      }

      let sizeWeight = 1.0;
      const sizeDiff = Math.abs(comp.acreage - sizeAcres) / sizeAcres;
      sizeWeight = Math.max(0.5, 1 - sizeDiff);

      const combinedWeight = distanceWeight * recencyWeight * sizeWeight;
      weightedSum += comp.pricePerAcre! * combinedWeight;
      totalWeight += combinedWeight;
    }

    const weightedPricePerAcre = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return weightedPricePerAcre * sizeAcres;
  }

  private async getMarketCondition(county: string, state: string): Promise<string> {
    const recentMetrics = await db.select().from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state)
      ))
      .orderBy(desc(marketMetrics.metricDate))
      .limit(1);

    if (recentMetrics.length === 0) {
      return "stable";
    }

    return recentMetrics[0].marketStatus || "stable";
  }

  private async getAverageDaysOnMarket(county: string, state: string): Promise<number> {
    const recentMetrics = await db.select().from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state)
      ))
      .orderBy(desc(marketMetrics.metricDate))
      .limit(1);

    if (recentMetrics.length === 0 || !recentMetrics[0].averageDaysOnMarket) {
      return 90;
    }

    return parseFloat(recentMetrics[0].averageDaysOnMarket);
  }

  private determineOptimalStrategy(
    property: Property,
    marketValue: number,
    acquisitionCost: number,
    comps: ComparableProperty[],
    marketCondition: string
  ): { strategy: DispositionStrategy; confidence: number } {
    let listRetailScore = 50;
    let wholesaleScore = 30;
    let ownerFinanceScore = 40;
    let auctionScore = 20;
    let holdScore = 25;

    const potentialProfit = marketValue - acquisitionCost;
    const profitMargin = acquisitionCost > 0 ? potentialProfit / acquisitionCost : 0;

    if (profitMargin >= 0.30) {
      listRetailScore += 20;
    } else if (profitMargin >= 0.20) {
      listRetailScore += 10;
      ownerFinanceScore += 10;
    } else if (profitMargin < 0.10) {
      wholesaleScore += 15;
      auctionScore += 10;
    }

    if (marketCondition === "heating") {
      listRetailScore += 15;
      ownerFinanceScore += 5;
    } else if (marketCondition === "cooling") {
      wholesaleScore += 15;
      holdScore += 10;
    } else if (marketCondition === "volatile") {
      wholesaleScore += 10;
      auctionScore += 10;
    }

    if (marketValue >= 15000 && marketValue <= 75000) {
      ownerFinanceScore += 15;
    }

    if (comps.length >= 5) {
      listRetailScore += 10;
    } else if (comps.length === 0) {
      listRetailScore -= 10;
      auctionScore += 10;
    }

    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 0;
    if (sizeAcres >= 2 && sizeAcres <= 20) {
      listRetailScore += 5;
      ownerFinanceScore += 5;
    } else if (sizeAcres > 40) {
      auctionScore += 10;
    }

    const scores: { strategy: DispositionStrategy; score: number }[] = [
      { strategy: "list_retail", score: listRetailScore },
      { strategy: "sell_wholesale", score: wholesaleScore },
      { strategy: "owner_finance", score: ownerFinanceScore },
      { strategy: "auction", score: auctionScore },
      { strategy: "hold", score: holdScore },
    ];

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    const confidence = best.score / totalScore;

    return {
      strategy: best.strategy,
      confidence: Math.min(0.95, Math.max(0.4, confidence)),
    };
  }

  private determineTargetBuyer(
    property: Property,
    strategy: DispositionStrategy
  ): TargetBuyerProfile {
    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 0;
    const features: string[] = [];

    if (property.roadAccess) features.push(`Road access: ${property.roadAccess}`);
    if (property.zoning) features.push(`Zoning: ${property.zoning}`);
    if (property.terrain) features.push(`Terrain: ${property.terrain}`);
    
    const utilities = property.utilities as { electric?: boolean; water?: boolean; sewer?: boolean; gas?: boolean } | null;
    if (utilities) {
      const availableUtilities = Object.entries(utilities)
        .filter(([_, v]) => v)
        .map(([k]) => k);
      if (availableUtilities.length > 0) {
        features.push(`Utilities: ${availableUtilities.join(", ")}`);
      }
    }

    let profileType: string;
    let likelyUseCase: string;
    let financingPreference: string;

    if (strategy === "sell_wholesale") {
      profileType = "investor";
      likelyUseCase = "Flip or hold for appreciation";
      financingPreference = "cash";
    } else if (strategy === "owner_finance") {
      profileType = "budget_buyer";
      likelyUseCase = "Recreational use or future building";
      financingPreference = "owner_financing";
    } else if (sizeAcres <= 5) {
      profileType = "homesteader";
      likelyUseCase = "Build home or cabin";
      financingPreference = "bank_or_owner_financing";
    } else if (sizeAcres <= 20) {
      profileType = "recreational_buyer";
      likelyUseCase = "Hunting, camping, or weekend getaway";
      financingPreference = "cash_or_owner_financing";
    } else {
      profileType = "rancher_or_developer";
      likelyUseCase = "Agriculture, ranching, or development";
      financingPreference = "bank_financing";
    }

    if (features.length === 0) {
      features.push(`${sizeAcres.toFixed(2)} acres in ${property.county}, ${property.state}`);
    }

    return {
      profileType,
      likelyUseCase,
      financingPreference,
      keyFeaturesToHighlight: features.slice(0, 5),
    };
  }

  private async logEvent(
    organizationId: number,
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    try {
      await db.insert(agentEvents).values({
        organizationId,
        eventType,
        eventSource: "disposition_optimizer",
        payload,
        relatedEntityType: "property",
        relatedEntityId: payload.propertyId,
      });
    } catch (error) {
      console.error("[DispositionOptimizer] Failed to log event:", error);
    }
  }
}

export const dispositionOptimizerService = new DispositionOptimizerService();
