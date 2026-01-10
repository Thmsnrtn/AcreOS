/**
 * Price Optimizer Service
 * Suggests optimal offer/list prices based on comps and market signals
 */

import { db } from "../db";
import {
  priceRecommendations,
  properties,
  deals,
  marketMetrics,
  sellerIntentPredictions,
  agentEvents,
  type PriceRecommendation,
  type InsertPriceRecommendation,
  type Property,
  type Deal,
  type MarketMetric,
  type SellerIntentPrediction,
} from "@shared/schema";
import { eq, and, desc, gte, sql, avg, count } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";
import { getComparableProperties, ComparableProperty, calculateMarketValue } from "./comps";

interface AdjustmentFactor {
  factor: number;
  reason: string;
}

interface Adjustments {
  sizeAdjustment?: AdjustmentFactor;
  accessAdjustment?: AdjustmentFactor;
  zoningAdjustment?: AdjustmentFactor;
  utilitiesAdjustment?: AdjustmentFactor;
  terrainAdjustment?: AdjustmentFactor;
  marketTrendAdjustment?: AdjustmentFactor;
  sellerMotivationAdjustment?: AdjustmentFactor;
  holdingCostAdjustment?: AdjustmentFactor;
}

interface Strategy {
  targetMargin?: number;
  competitionLevel?: string;
  marketTiming?: string;
  negotiationRoom?: number;
  quickSaleDiscount?: number;
}

interface ComparableSummary {
  count: number;
  medianPricePerAcre: number;
  avgDaysOnMarket?: number;
  recentTrend?: string;
  comps?: Array<{
    apn: string;
    salePrice: number;
    acres: number;
    pricePerAcre: number;
    saleDate: string;
    distance?: number;
    similarityScore?: number;
  }>;
}

interface PriceRecommendationResult {
  recommendedPrice: number;
  priceRangeMin: number;
  priceRangeMax: number;
  confidence: number;
  comparablesSummary: ComparableSummary;
  adjustments: Adjustments;
  strategy: Strategy;
  reasoning?: string;
}

interface AccuracyMetrics {
  totalRecommendations: number;
  recommendationsWithOutcome: number;
  averageAccuracy: number;
  accuracyByType: {
    acquisition: { count: number; avgAccuracy: number };
    disposition: { count: number; avgAccuracy: number };
    counter: { count: number; avgAccuracy: number };
  };
  acceptanceRate: number;
  avgPriceDeviation: number;
}

const DEFAULT_TARGET_MARGIN = 0.30; // 30% target margin
const DEFAULT_NEGOTIATION_BUFFER = 0.10; // 10% negotiation room
const QUICK_SALE_DISCOUNT = 0.15; // 15% discount for quick sale

export class PriceOptimizerService {

  async recommendAcquisitionPrice(
    organizationId: number,
    propertyId: number,
    targetMargin?: number
  ): Promise<PriceRecommendation> {
    const [property] = await db.select().from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const margin = targetMargin ?? DEFAULT_TARGET_MARGIN;
    
    const comps = await this.findComparables(propertyId);
    const basePrice = this.calculateBasePrice(comps, property);
    const adjustments = this.calculateAdjustmentFactors(property, comps);
    const adjustedPrice = this.applyAdjustments(basePrice, property, adjustments);

    let finalPrice = adjustedPrice;

    if (property.sellerId) {
      finalPrice = await this.incorporateSellerIntent(finalPrice, property.sellerId);
    }

    finalPrice = await this.incorporateMarketTrends(finalPrice, property.county, property.state);

    const maxOfferPrice = finalPrice * (1 - margin);
    
    const negotiationBuffer = DEFAULT_NEGOTIATION_BUFFER;
    const recommendedPrice = maxOfferPrice * (1 - negotiationBuffer);
    const priceRangeMin = recommendedPrice * 0.90;
    const priceRangeMax = maxOfferPrice;

    const compsSimilarity = this.calculateCompsSimilarity(comps, property);
    const marketVolatility = await this.getMarketVolatility(property.county, property.state);
    const confidence = this.getConfidence(comps.length, compsSimilarity, marketVolatility);

    const comparablesSummary = this.buildComparablesSummary(comps);
    const strategy: Strategy = {
      targetMargin: margin,
      competitionLevel: await this.assessCompetition(property.county, property.state),
      marketTiming: await this.getMarketTiming(property.county, property.state),
      negotiationRoom: negotiationBuffer,
    };

    const recommendation: InsertPriceRecommendation = {
      organizationId,
      propertyId,
      recommendationType: "acquisition_offer",
      recommendedPrice: recommendedPrice.toString(),
      priceRangeMin: priceRangeMin.toString(),
      priceRangeMax: priceRangeMax.toString(),
      confidence: confidence.toString(),
      comparablesSummary,
      adjustments,
      strategy,
    };

    const [inserted] = await db.insert(priceRecommendations)
      .values(recommendation)
      .returning();

    const reasoning = await this.generatePriceReasoning(inserted);

    if (reasoning) {
      await db.update(priceRecommendations)
        .set({ reasoning })
        .where(eq(priceRecommendations.id, inserted.id));
      inserted.reasoning = reasoning;
    }

    await this.logEvent(organizationId, "acquisition_price_recommended", {
      recommendationId: inserted.id,
      propertyId,
      recommendedPrice,
      confidence,
    });

    return inserted;
  }

  async recommendDispositionPrice(
    organizationId: number,
    propertyId: number,
    quickSale?: boolean
  ): Promise<PriceRecommendation> {
    const [property] = await db.select().from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const comps = await this.findComparables(propertyId);
    const basePrice = this.calculateBasePrice(comps, property);
    const adjustments = this.calculateAdjustmentFactors(property, comps);
    let adjustedPrice = this.applyAdjustments(basePrice, property, adjustments);

    adjustedPrice = await this.incorporateMarketTrends(adjustedPrice, property.county, property.state);

    let recommendedListPrice = adjustedPrice;
    let quickSaleDiscount = 0;

    if (quickSale) {
      quickSaleDiscount = QUICK_SALE_DISCOUNT;
      recommendedListPrice = adjustedPrice * (1 - quickSaleDiscount);
    } else {
      recommendedListPrice = adjustedPrice * 1.05;
    }

    const priceRangeMin = quickSale ? recommendedListPrice * 0.95 : adjustedPrice * 0.95;
    const priceRangeMax = adjustedPrice * 1.10;

    const compsSimilarity = this.calculateCompsSimilarity(comps, property);
    const marketVolatility = await this.getMarketVolatility(property.county, property.state);
    const confidence = this.getConfidence(comps.length, compsSimilarity, marketVolatility);

    const comparablesSummary = this.buildComparablesSummary(comps);
    const strategy: Strategy = {
      competitionLevel: await this.assessCompetition(property.county, property.state),
      marketTiming: await this.getMarketTiming(property.county, property.state),
      quickSaleDiscount: quickSale ? quickSaleDiscount : undefined,
    };

    const recommendation: InsertPriceRecommendation = {
      organizationId,
      propertyId,
      recommendationType: "disposition_list",
      recommendedPrice: recommendedListPrice.toString(),
      priceRangeMin: priceRangeMin.toString(),
      priceRangeMax: priceRangeMax.toString(),
      confidence: confidence.toString(),
      comparablesSummary,
      adjustments,
      strategy,
    };

    const [inserted] = await db.insert(priceRecommendations)
      .values(recommendation)
      .returning();

    const reasoning = await this.generatePriceReasoning(inserted);

    if (reasoning) {
      await db.update(priceRecommendations)
        .set({ reasoning })
        .where(eq(priceRecommendations.id, inserted.id));
      inserted.reasoning = reasoning;
    }

    await this.logEvent(organizationId, "disposition_price_recommended", {
      recommendationId: inserted.id,
      propertyId,
      recommendedPrice: recommendedListPrice,
      quickSale,
      confidence,
    });

    return inserted;
  }

  async recommendCounterOffer(
    organizationId: number,
    propertyId: number,
    currentOffer: number,
    sellerAsk: number
  ): Promise<PriceRecommendation> {
    const [property] = await db.select().from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const comps = await this.findComparables(propertyId);
    const basePrice = this.calculateBasePrice(comps, property);
    const adjustments = this.calculateAdjustmentFactors(property, comps);
    const fairMarketValue = this.applyAdjustments(basePrice, property, adjustments);

    let sellerMotivationFactor = 1.0;
    if (property.sellerId) {
      const intentPrediction = await this.getLatestSellerIntent(property.sellerId);
      if (intentPrediction) {
        const intentScore = intentPrediction.intentScore;
        if (intentScore >= 80) {
          sellerMotivationFactor = 0.90;
        } else if (intentScore >= 60) {
          sellerMotivationFactor = 0.95;
        } else if (intentScore <= 30) {
          sellerMotivationFactor = 1.05;
        }
      }
    }

    const spread = sellerAsk - currentOffer;
    const midpoint = currentOffer + (spread * 0.5);
    
    let counterSuggestion: number;
    
    if (fairMarketValue < currentOffer) {
      counterSuggestion = currentOffer;
    } else if (fairMarketValue > sellerAsk) {
      counterSuggestion = currentOffer + (spread * 0.6);
    } else {
      const fmvPosition = (fairMarketValue - currentOffer) / spread;
      counterSuggestion = currentOffer + (spread * Math.max(0.3, fmvPosition * 0.8));
    }

    counterSuggestion = counterSuggestion * sellerMotivationFactor;
    
    counterSuggestion = Math.min(counterSuggestion, sellerAsk * 0.95);
    counterSuggestion = Math.max(counterSuggestion, currentOffer * 1.05);

    const priceRangeMin = Math.max(currentOffer * 1.02, counterSuggestion * 0.95);
    const priceRangeMax = Math.min(sellerAsk * 0.95, counterSuggestion * 1.10);

    const compsSimilarity = this.calculateCompsSimilarity(comps, property);
    const marketVolatility = await this.getMarketVolatility(property.county, property.state);
    const confidence = this.getConfidence(comps.length, compsSimilarity, marketVolatility);

    const comparablesSummary = this.buildComparablesSummary(comps);
    const strategy: Strategy = {
      competitionLevel: await this.assessCompetition(property.county, property.state),
      negotiationRoom: (sellerAsk - counterSuggestion) / sellerAsk,
    };

    const recommendation: InsertPriceRecommendation = {
      organizationId,
      propertyId,
      recommendationType: "counter_offer",
      recommendedPrice: counterSuggestion.toString(),
      priceRangeMin: priceRangeMin.toString(),
      priceRangeMax: priceRangeMax.toString(),
      confidence: confidence.toString(),
      comparablesSummary,
      adjustments: {
        ...adjustments,
        sellerMotivationAdjustment: sellerMotivationFactor !== 1.0 ? {
          factor: sellerMotivationFactor,
          reason: sellerMotivationFactor < 1 ? "High seller motivation detected" : "Low seller motivation detected",
        } : undefined,
      },
      strategy,
    };

    const [inserted] = await db.insert(priceRecommendations)
      .values(recommendation)
      .returning();

    const reasoning = await this.generatePriceReasoning(inserted, { currentOffer, sellerAsk, fairMarketValue });

    if (reasoning) {
      await db.update(priceRecommendations)
        .set({ reasoning })
        .where(eq(priceRecommendations.id, inserted.id));
      inserted.reasoning = reasoning;
    }

    await this.logEvent(organizationId, "counter_offer_recommended", {
      recommendationId: inserted.id,
      propertyId,
      currentOffer,
      sellerAsk,
      recommendedCounter: counterSuggestion,
      confidence,
    });

    return inserted;
  }

  async findComparables(
    propertyId: number,
    radiusMiles: number = 10,
    monthsBack: number = 12
  ): Promise<ComparableProperty[]> {
    const [property] = await db.select().from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
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
      console.error("[PriceOptimizer] Failed to find comps:", result.error);
      return [];
    }

    return result.comps.filter(c => c.salePrice && c.salePrice > 0);
  }

  calculateBasePrice(comps: ComparableProperty[], property: Property): number {
    if (comps.length === 0) {
      const assessed = property.assessedValue ? parseFloat(property.assessedValue) : null;
      const market = property.marketValue ? parseFloat(property.marketValue) : null;
      return market || assessed || 0;
    }

    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 1;
    const compsWithPrices = comps.filter(c => c.pricePerAcre && c.pricePerAcre > 0);

    if (compsWithPrices.length === 0) {
      const assessed = property.assessedValue ? parseFloat(property.assessedValue) : null;
      return assessed || 0;
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

  calculateAdjustmentFactors(property: Property, comps: ComparableProperty[]): Adjustments {
    const adjustments: Adjustments = {};

    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 0;
    if (sizeAcres > 0) {
      if (sizeAcres < 1) {
        adjustments.sizeAdjustment = { factor: 1.10, reason: "Small parcel premium" };
      } else if (sizeAcres > 40) {
        adjustments.sizeAdjustment = { factor: 0.90, reason: "Large parcel discount" };
      } else if (sizeAcres >= 2 && sizeAcres <= 10) {
        adjustments.sizeAdjustment = { factor: 1.05, reason: "Optimal size range premium" };
      }
    }

    const roadAccess = (property.roadAccess || "").toLowerCase();
    if (roadAccess.includes("paved") || roadAccess.includes("asphalt")) {
      adjustments.accessAdjustment = { factor: 1.15, reason: "Paved road access premium" };
    } else if (roadAccess.includes("gravel") || roadAccess.includes("improved")) {
      adjustments.accessAdjustment = { factor: 1.05, reason: "Improved road access" };
    } else if (roadAccess.includes("none") || roadAccess === "") {
      adjustments.accessAdjustment = { factor: 0.75, reason: "No road access discount" };
    } else if (roadAccess.includes("dirt") || roadAccess.includes("unimproved")) {
      adjustments.accessAdjustment = { factor: 0.90, reason: "Unimproved road discount" };
    }

    const utilities = property.utilities as { electric?: boolean; water?: boolean; sewer?: boolean; gas?: boolean } | null;
    if (utilities) {
      const utilityCount = [utilities.electric, utilities.water, utilities.sewer, utilities.gas]
        .filter(Boolean).length;
      if (utilityCount >= 3) {
        adjustments.utilitiesAdjustment = { factor: 1.20, reason: "Full utilities premium" };
      } else if (utilityCount >= 2) {
        adjustments.utilitiesAdjustment = { factor: 1.10, reason: "Partial utilities premium" };
      } else if (utilityCount === 1) {
        adjustments.utilitiesAdjustment = { factor: 1.05, reason: "Single utility available" };
      }
    }

    const terrain = (property.terrain || "").toLowerCase();
    if (terrain.includes("flat") || terrain.includes("level")) {
      adjustments.terrainAdjustment = { factor: 1.10, reason: "Flat terrain premium" };
    } else if (terrain.includes("steep") || terrain.includes("mountainous")) {
      adjustments.terrainAdjustment = { factor: 0.85, reason: "Steep terrain discount" };
    } else if (terrain.includes("rolling") || terrain.includes("gentle")) {
      adjustments.terrainAdjustment = { factor: 1.02, reason: "Gentle terrain" };
    }

    const zoning = (property.zoning || "").toLowerCase();
    if (zoning.includes("residential") || zoning.includes("r-1") || zoning.includes("r1")) {
      adjustments.zoningAdjustment = { factor: 1.15, reason: "Residential zoning premium" };
    } else if (zoning.includes("commercial") || zoning.includes("industrial")) {
      adjustments.zoningAdjustment = { factor: 1.10, reason: "Commercial/industrial zoning" };
    } else if (zoning.includes("conservation") || zoning.includes("preserve")) {
      adjustments.zoningAdjustment = { factor: 0.80, reason: "Conservation restriction discount" };
    }

    return adjustments;
  }

  applyAdjustments(basePrice: number, property: Property, adjustments?: Adjustments): number {
    if (!adjustments) {
      adjustments = this.calculateAdjustmentFactors(property, []);
    }

    let adjustedPrice = basePrice;

    const adjustmentValues = Object.values(adjustments).filter(
      (adj): adj is AdjustmentFactor => adj !== undefined
    );

    for (const adj of adjustmentValues) {
      adjustedPrice *= adj.factor;
    }

    return adjustedPrice;
  }

  async incorporateSellerIntent(price: number, leadId: number): Promise<number> {
    const intentPrediction = await this.getLatestSellerIntent(leadId);

    if (!intentPrediction) {
      return price;
    }

    const intentScore = intentPrediction.intentScore;

    if (intentScore >= 80) {
      return price * 0.92;
    } else if (intentScore >= 65) {
      return price * 0.95;
    } else if (intentScore >= 50) {
      return price * 0.98;
    } else if (intentScore <= 30) {
      return price * 1.05;
    }

    return price;
  }

  async incorporateMarketTrends(price: number, county: string, state: string): Promise<number> {
    const recentMetrics = await db.select().from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state)
      ))
      .orderBy(desc(marketMetrics.metricDate))
      .limit(1);

    if (recentMetrics.length === 0) {
      return price;
    }

    const metric = recentMetrics[0];
    const status = metric.marketStatus;

    if (status === "heating") {
      return price * 1.05;
    } else if (status === "cooling") {
      return price * 0.95;
    } else if (status === "volatile") {
      return price * 0.98;
    }

    return price;
  }

  getConfidence(
    compsCount: number,
    compsSimilarity: number,
    marketVolatility: number
  ): number {
    let confidence = 0.5;

    if (compsCount >= 10) {
      confidence += 0.20;
    } else if (compsCount >= 5) {
      confidence += 0.15;
    } else if (compsCount >= 3) {
      confidence += 0.10;
    } else if (compsCount === 0) {
      confidence -= 0.20;
    }

    confidence += compsSimilarity * 0.20;

    if (marketVolatility < 0.10) {
      confidence += 0.10;
    } else if (marketVolatility < 0.20) {
      confidence += 0.05;
    } else if (marketVolatility > 0.30) {
      confidence -= 0.10;
    }

    return Math.max(0.1, Math.min(0.95, confidence));
  }

  async generatePriceReasoning(
    recommendation: PriceRecommendation,
    additionalContext?: { currentOffer?: number; sellerAsk?: number; fairMarketValue?: number }
  ): Promise<string | null> {
    const openai = getOpenAIClient();

    if (!openai) {
      return this.generateFallbackReasoning(recommendation, additionalContext);
    }

    try {
      const summary = recommendation.comparablesSummary as ComparableSummary | null;
      const adjustments = recommendation.adjustments as Adjustments | null;
      const strategy = recommendation.strategy as Strategy | null;

      const contextParts: string[] = [
        `Recommendation Type: ${recommendation.recommendationType}`,
        `Recommended Price: $${parseFloat(recommendation.recommendedPrice).toLocaleString()}`,
        `Price Range: $${parseFloat(recommendation.priceRangeMin).toLocaleString()} - $${parseFloat(recommendation.priceRangeMax).toLocaleString()}`,
        `Confidence: ${(parseFloat(recommendation.confidence) * 100).toFixed(0)}%`,
      ];

      if (summary) {
        contextParts.push(`Comparable Sales: ${summary.count} properties found`);
        contextParts.push(`Median Price/Acre: $${summary.medianPricePerAcre?.toLocaleString() || "N/A"}`);
        if (summary.avgDaysOnMarket) {
          contextParts.push(`Avg Days on Market: ${summary.avgDaysOnMarket}`);
        }
      }

      if (adjustments) {
        const adjustmentList = Object.entries(adjustments)
          .filter(([_, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${v.factor}x (${v.reason})`)
          .join(", ");
        if (adjustmentList) {
          contextParts.push(`Adjustments Applied: ${adjustmentList}`);
        }
      }

      if (strategy) {
        if (strategy.targetMargin) {
          contextParts.push(`Target Margin: ${(strategy.targetMargin * 100).toFixed(0)}%`);
        }
        if (strategy.competitionLevel) {
          contextParts.push(`Competition: ${strategy.competitionLevel}`);
        }
        if (strategy.quickSaleDiscount) {
          contextParts.push(`Quick Sale Discount: ${(strategy.quickSaleDiscount * 100).toFixed(0)}%`);
        }
      }

      if (additionalContext) {
        if (additionalContext.currentOffer) {
          contextParts.push(`Current Offer: $${additionalContext.currentOffer.toLocaleString()}`);
        }
        if (additionalContext.sellerAsk) {
          contextParts.push(`Seller Ask: $${additionalContext.sellerAsk.toLocaleString()}`);
        }
        if (additionalContext.fairMarketValue) {
          contextParts.push(`Fair Market Value Estimate: $${additionalContext.fairMarketValue.toLocaleString()}`);
        }
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a land investment pricing expert. Generate a clear, concise explanation (2-4 sentences) for a price recommendation. Focus on the key factors that influenced the pricing decision. Be specific about numbers and percentages when relevant.`
          },
          {
            role: "user",
            content: contextParts.join("\n")
          }
        ],
        temperature: 0.3,
        max_tokens: 200,
      });

      return response.choices[0].message.content || null;
    } catch (error) {
      console.error("[PriceOptimizer] AI reasoning generation failed:", error);
      return this.generateFallbackReasoning(recommendation, additionalContext);
    }
  }

  private generateFallbackReasoning(
    recommendation: PriceRecommendation,
    additionalContext?: { currentOffer?: number; sellerAsk?: number; fairMarketValue?: number }
  ): string {
    const summary = recommendation.comparablesSummary as ComparableSummary | null;
    const type = recommendation.recommendationType;

    if (type === "acquisition_offer") {
      return `Based on ${summary?.count || 0} comparable sales with a median price of $${summary?.medianPricePerAcre?.toLocaleString() || "N/A"}/acre, the recommended acquisition offer factors in target margins and negotiation room.`;
    } else if (type === "disposition_list") {
      return `List price recommendation based on ${summary?.count || 0} comparable sales and current market conditions. The pricing accounts for property features and market positioning.`;
    } else if (type === "counter_offer") {
      const { currentOffer, sellerAsk } = additionalContext || {};
      return `Counter-offer recommendation positions between the current offer of $${currentOffer?.toLocaleString() || "N/A"} and seller's ask of $${sellerAsk?.toLocaleString() || "N/A"}, factoring in fair market value and negotiation dynamics.`;
    }

    return "Price recommendation based on comparable sales analysis and market conditions.";
  }

  async recordPriceOutcome(
    recommendationId: number,
    actualPrice: number,
    accepted: boolean
  ): Promise<void> {
    await db.update(priceRecommendations)
      .set({
        actualPrice: actualPrice.toString(),
        priceAccepted: accepted,
        outcomeRecordedAt: new Date(),
      })
      .where(eq(priceRecommendations.id, recommendationId));

    const [recommendation] = await db.select().from(priceRecommendations)
      .where(eq(priceRecommendations.id, recommendationId));

    if (recommendation) {
      await this.logEvent(recommendation.organizationId, "price_outcome_recorded", {
        recommendationId,
        recommendedPrice: parseFloat(recommendation.recommendedPrice),
        actualPrice,
        accepted,
        accuracy: 1 - Math.abs(actualPrice - parseFloat(recommendation.recommendedPrice)) / parseFloat(recommendation.recommendedPrice),
      });
    }
  }

  async analyzeRecommendationAccuracy(organizationId: number): Promise<AccuracyMetrics> {
    const allRecommendations = await db.select().from(priceRecommendations)
      .where(eq(priceRecommendations.organizationId, organizationId));

    const withOutcome = allRecommendations.filter(r => r.actualPrice !== null);

    const calculateAccuracy = (recommended: string, actual: string): number => {
      const rec = parseFloat(recommended);
      const act = parseFloat(actual);
      return Math.max(0, 1 - Math.abs(act - rec) / rec);
    };

    const typeAccuracy = {
      acquisition: { count: 0, totalAccuracy: 0 },
      disposition: { count: 0, totalAccuracy: 0 },
      counter: { count: 0, totalAccuracy: 0 },
    };

    let totalAccuracy = 0;
    let acceptedCount = 0;
    let totalDeviation = 0;

    for (const rec of withOutcome) {
      const accuracy = calculateAccuracy(rec.recommendedPrice, rec.actualPrice!);
      totalAccuracy += accuracy;

      if (rec.priceAccepted) {
        acceptedCount++;
      }

      totalDeviation += Math.abs(parseFloat(rec.actualPrice!) - parseFloat(rec.recommendedPrice)) / parseFloat(rec.recommendedPrice);

      if (rec.recommendationType === "acquisition_offer") {
        typeAccuracy.acquisition.count++;
        typeAccuracy.acquisition.totalAccuracy += accuracy;
      } else if (rec.recommendationType === "disposition_list") {
        typeAccuracy.disposition.count++;
        typeAccuracy.disposition.totalAccuracy += accuracy;
      } else if (rec.recommendationType === "counter_offer") {
        typeAccuracy.counter.count++;
        typeAccuracy.counter.totalAccuracy += accuracy;
      }
    }

    return {
      totalRecommendations: allRecommendations.length,
      recommendationsWithOutcome: withOutcome.length,
      averageAccuracy: withOutcome.length > 0 ? totalAccuracy / withOutcome.length : 0,
      accuracyByType: {
        acquisition: {
          count: typeAccuracy.acquisition.count,
          avgAccuracy: typeAccuracy.acquisition.count > 0 
            ? typeAccuracy.acquisition.totalAccuracy / typeAccuracy.acquisition.count 
            : 0,
        },
        disposition: {
          count: typeAccuracy.disposition.count,
          avgAccuracy: typeAccuracy.disposition.count > 0 
            ? typeAccuracy.disposition.totalAccuracy / typeAccuracy.disposition.count 
            : 0,
        },
        counter: {
          count: typeAccuracy.counter.count,
          avgAccuracy: typeAccuracy.counter.count > 0 
            ? typeAccuracy.counter.totalAccuracy / typeAccuracy.counter.count 
            : 0,
        },
      },
      acceptanceRate: withOutcome.length > 0 ? acceptedCount / withOutcome.length : 0,
      avgPriceDeviation: withOutcome.length > 0 ? totalDeviation / withOutcome.length : 0,
    };
  }

  async getPropertyRecommendations(
    organizationId: number,
    propertyId: number
  ): Promise<PriceRecommendation[]> {
    return db.select().from(priceRecommendations)
      .where(and(
        eq(priceRecommendations.organizationId, organizationId),
        eq(priceRecommendations.propertyId, propertyId)
      ))
      .orderBy(desc(priceRecommendations.createdAt));
  }

  private async getLatestSellerIntent(leadId: number): Promise<SellerIntentPrediction | null> {
    const [prediction] = await db.select().from(sellerIntentPredictions)
      .where(eq(sellerIntentPredictions.leadId, leadId))
      .orderBy(desc(sellerIntentPredictions.createdAt))
      .limit(1);

    return prediction || null;
  }

  private calculateCompsSimilarity(comps: ComparableProperty[], property: Property): number {
    if (comps.length === 0) return 0;

    const sizeAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : 0;
    let totalSimilarity = 0;

    for (const comp of comps) {
      let similarity = 0;

      const sizeDiff = sizeAcres > 0 ? Math.abs(comp.acreage - sizeAcres) / sizeAcres : 1;
      const sizeSimilarity = Math.max(0, 1 - sizeDiff);
      similarity += sizeSimilarity * 0.40;

      const distanceSimilarity = Math.max(0, 1 - comp.distance / 20);
      similarity += distanceSimilarity * 0.30;

      if (comp.saleDate) {
        const monthsAgo = (Date.now() - new Date(comp.saleDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
        const recencySimilarity = Math.max(0, 1 - monthsAgo / 24);
        similarity += recencySimilarity * 0.30;
      }

      totalSimilarity += similarity;
    }

    return totalSimilarity / comps.length;
  }

  private async getMarketVolatility(county: string, state: string): Promise<number> {
    const recentMetrics = await db.select().from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state)
      ))
      .orderBy(desc(marketMetrics.metricDate))
      .limit(6);

    if (recentMetrics.length < 2) {
      return 0.15;
    }

    const priceChanges = recentMetrics
      .filter(m => m.priceChangePercent)
      .map(m => parseFloat(m.priceChangePercent!));

    if (priceChanges.length < 2) {
      return 0.15;
    }

    const mean = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
    const variance = priceChanges.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / priceChanges.length;
    const stdDev = Math.sqrt(variance);

    return Math.abs(stdDev) / 100;
  }

  private async assessCompetition(county: string, state: string): Promise<string> {
    const recentMetrics = await db.select().from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state)
      ))
      .orderBy(desc(marketMetrics.metricDate))
      .limit(1);

    if (recentMetrics.length === 0) {
      return "moderate";
    }

    const metric = recentMetrics[0];
    const absorptionRate = metric.absorptionRate ? parseFloat(metric.absorptionRate) : null;

    if (absorptionRate === null) {
      return "moderate";
    }

    if (absorptionRate < 3) {
      return "high";
    } else if (absorptionRate < 6) {
      return "moderate";
    } else {
      return "low";
    }
  }

  private async getMarketTiming(county: string, state: string): Promise<string> {
    const recentMetrics = await db.select().from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state)
      ))
      .orderBy(desc(marketMetrics.metricDate))
      .limit(1);

    if (recentMetrics.length === 0) {
      return "neutral";
    }

    const status = recentMetrics[0].marketStatus;

    if (status === "heating") {
      return "sellers_market";
    } else if (status === "cooling") {
      return "buyers_market";
    } else {
      return "balanced";
    }
  }

  private buildComparablesSummary(comps: ComparableProperty[]): ComparableSummary {
    const compsWithPrices = comps.filter(c => c.pricePerAcre && c.pricePerAcre > 0);

    if (compsWithPrices.length === 0) {
      return {
        count: 0,
        medianPricePerAcre: 0,
      };
    }

    const prices = compsWithPrices.map(c => c.pricePerAcre!).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const medianPrice = prices.length % 2 === 0 
      ? (prices[mid - 1] + prices[mid]) / 2 
      : prices[mid];

    const daysOnMarket = compsWithPrices
      .filter(c => c.saleDate)
      .map(c => {
        const saleDate = new Date(c.saleDate!);
        return Math.floor((Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24));
      });

    const avgDom = daysOnMarket.length > 0 
      ? daysOnMarket.reduce((a, b) => a + b, 0) / daysOnMarket.length 
      : undefined;

    const recentComps = compsWithPrices.slice(0, 3);
    const olderComps = compsWithPrices.slice(-3);

    let recentTrend: string | undefined;
    if (recentComps.length > 0 && olderComps.length > 0) {
      const recentAvg = recentComps.reduce((sum, c) => sum + c.pricePerAcre!, 0) / recentComps.length;
      const olderAvg = olderComps.reduce((sum, c) => sum + c.pricePerAcre!, 0) / olderComps.length;
      const change = (recentAvg - olderAvg) / olderAvg;

      if (change > 0.05) {
        recentTrend = "increasing";
      } else if (change < -0.05) {
        recentTrend = "decreasing";
      } else {
        recentTrend = "stable";
      }
    }

    return {
      count: compsWithPrices.length,
      medianPricePerAcre: Math.round(medianPrice),
      avgDaysOnMarket: avgDom ? Math.round(avgDom) : undefined,
      recentTrend,
      comps: compsWithPrices.slice(0, 10).map(c => ({
        apn: c.apn,
        salePrice: c.salePrice!,
        acres: c.acreage,
        pricePerAcre: Math.round(c.pricePerAcre!),
        saleDate: c.saleDate || "",
        distance: Math.round(c.distance * 100) / 100,
      })),
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
        eventSource: "price_optimizer",
        payload,
        relatedEntityType: "property",
        relatedEntityId: payload.propertyId,
      });
    } catch (error) {
      console.error("[PriceOptimizer] Failed to log event:", error);
    }
  }
}

export const priceOptimizerService = new PriceOptimizerService();
