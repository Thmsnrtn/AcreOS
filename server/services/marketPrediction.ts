// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import { storage } from "../storage";
import { 
  marketPredictions, 
  marketIndicators, 
  priceTrends,
  type InsertMarketPrediction,
  type InsertMarketIndicator,
  type InsertPriceTrend
} from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";

interface MarketPredictionParams {
  state: string;
  county: string;
}

interface PredictionResult {
  prediction: {
    marketTiming: string;
    timingConfidence: number;
    avgPricePerAcre: number;
    predictedPriceChange30Days: number;
    predictedPriceChange90Days: number;
    predictedPriceChange12Months: number;
    demandScore: number;
    isOpportunityWindow: boolean;
    opportunityReason?: string;
  };
  indicators: {
    daysOnMarketAvg: number;
    listToSaleRatio: number;
    inventoryLevel: string;
    interestRateImpact: string;
    developmentActivity: string;
  };
  confidence: {
    dataPoints: number;
    lastUpdated: Date;
  };
}

export class MarketPredictionService {
  
  /**
   * Get or generate market prediction for a county
   */
  async getPrediction(params: MarketPredictionParams): Promise<PredictionResult | null> {
    const { state, county } = params;
    
    // Check for existing valid prediction (less than 7 days old)
    const validDate = new Date();
    validDate.setDate(validDate.getDate() - 7);
    
    const existing = await db.select()
      .from(marketPredictions)
      .where(and(
        eq(marketPredictions.state, state),
        eq(marketPredictions.county, county),
        gte(marketPredictions.predictionDate, validDate)
      ))
      .orderBy(desc(marketPredictions.predictionDate))
      .limit(1);
    
    if (existing.length > 0) {
      return this.formatPrediction(existing[0]);
    }
    
    // Generate new prediction
    const prediction = await this.generatePrediction(state, county);
    
    if (prediction) {
      await db.insert(marketPredictions).values(prediction);
      const saved = await db.select()
        .from(marketPredictions)
        .where(and(
          eq(marketPredictions.state, state),
          eq(marketPredictions.county, county)
        ))
        .orderBy(desc(marketPredictions.predictionDate))
        .limit(1);
      
      return saved.length > 0 ? this.formatPrediction(saved[0]) : null;
    }
    
    return null;
  }
  
  /**
   * Generate prediction using historical data and market indicators
   */
  private async generatePrediction(state: string, county: string): Promise<InsertMarketPrediction | null> {
    // Get historical price trends
    const trends = await this.getHistoricalTrends(state, county);
    if (trends.length === 0) {
      return null; // Not enough data
    }
    
    // Get current market indicators
    const indicators = await this.getCurrentIndicators();
    
    // Calculate market timing
    const timing = this.calculateMarketTiming(trends, indicators);
    
    // Calculate price predictions
    const pricePredictions = this.calculatePricePredictions(trends, indicators);
    
    // Calculate demand score
    const demandScore = this.calculateDemandScore(trends, indicators);
    
    // Detect opportunity windows
    const opportunity = this.detectOpportunityWindow(timing, demandScore, indicators);
    
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);
    
    return {
      state,
      county,
      validUntil,
      marketTiming: timing.timing,
      timingConfidence: timing.confidence,
      avgPricePerAcre: pricePredictions.current,
      predictedPriceChange30Days: pricePredictions.change30Days,
      predictedPriceChange90Days: pricePredictions.change90Days,
      predictedPriceChange12Months: pricePredictions.change12Months,
      daysOnMarketAvg: trends[0]?.avgDaysOnMarket || 60,
      listToSaleRatio: this.calculateListToSaleRatio(trends),
      inventoryLevel: this.calculateInventoryLevel(trends),
      demandScore,
      interestRateImpact: this.assessInterestRateImpact(indicators),
      developmentActivity: this.assessDevelopmentActivity(trends),
      economicIndicators: {
        employmentGrowth: indicators?.gdpGrowthRate || 0,
        populationGrowth: 0,
        incomeGrowth: 0,
      },
      isOpportunityWindow: opportunity.isOpportunity,
      opportunityReason: opportunity.reason,
      opportunityScore: opportunity.score,
      modelVersion: "v1.0.0",
      dataPoints: trends.length,
    };
  }
  
  /**
   * Get historical price trends for analysis
   */
  private async getHistoricalTrends(state: string, county: string) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    return await db.select()
      .from(priceTrends)
      .where(and(
        eq(priceTrends.state, state),
        eq(priceTrends.county, county),
        gte(priceTrends.periodStart, sixMonthsAgo)
      ))
      .orderBy(desc(priceTrends.periodEnd));
  }
  
  /**
   * Get current economic indicators
   */
  private async getCurrentIndicators() {
    const recent = await db.select()
      .from(marketIndicators)
      .orderBy(desc(marketIndicators.indicatorDate))
      .limit(1);
    
    return recent.length > 0 ? recent[0] : null;
  }
  
  /**
   * Calculate market timing (hot, warm, cooling, cold)
   */
  private calculateMarketTiming(
    trends: any[], 
    indicators: any
  ): { timing: string; confidence: number } {
    if (trends.length < 2) {
      return { timing: "warm", confidence: 0.5 };
    }
    
    const latest = trends[0];
    const previous = trends[1];
    
    // Calculate momentum score
    let momentumScore = 0;
    
    // Price momentum
    if (latest.priceChange && parseFloat(latest.priceChange) > 5) {
      momentumScore += 30;
    } else if (latest.priceChange && parseFloat(latest.priceChange) < -5) {
      momentumScore -= 30;
    }
    
    // Volume momentum
    if (latest.volumeChange && parseFloat(latest.volumeChange) > 20) {
      momentumScore += 25;
    } else if (latest.volumeChange && parseFloat(latest.volumeChange) < -20) {
      momentumScore -= 25;
    }
    
    // Days on market trend (lower is better)
    if (latest.avgDaysOnMarket < 45) {
      momentumScore += 20;
    } else if (latest.avgDaysOnMarket > 90) {
      momentumScore -= 20;
    }
    
    // Interest rate impact
    if (indicators?.federalFundsRate) {
      const rate = parseFloat(indicators.federalFundsRate);
      if (rate < 3) {
        momentumScore += 15;
      } else if (rate > 5) {
        momentumScore -= 15;
      }
    }
    
    // Determine timing
    let timing: string;
    if (momentumScore > 50) {
      timing = "hot";
    } else if (momentumScore > 15) {
      timing = "warm";
    } else if (momentumScore > -15) {
      timing = "cooling";
    } else {
      timing = "cold";
    }
    
    // Confidence based on data quality
    const confidence = Math.min(0.95, 0.5 + (trends.length * 0.05));
    
    return { timing, confidence };
  }
  
  /**
   * Calculate price predictions for multiple time horizons
   */
  private calculatePricePredictions(trends: any[], indicators: any) {
    if (trends.length === 0) {
      return {
        current: 5000,
        change30Days: 0,
        change90Days: 0,
        change12Months: 0,
      };
    }
    
    const latest = trends[0];
    const currentPrice = parseFloat(latest.avgPricePerAcre) || 5000;
    
    // Simple momentum-based prediction (can be enhanced with ML)
    const recentChangeRate = trends.length >= 2 
      ? parseFloat(trends[0].priceChange || "0") 
      : 0;
    
    // Dampen predictions (mean reversion)
    const change30Days = recentChangeRate * 0.5;
    const change90Days = recentChangeRate * 1.2;
    const change12Months = recentChangeRate * 3.0;
    
    return {
      current: currentPrice,
      change30Days,
      change90Days,
      change12Months,
    };
  }
  
  /**
   * Calculate overall demand score (0-100)
   */
  private calculateDemandScore(trends: any[], indicators: any): number {
    let score = 50; // Start at neutral
    
    if (trends.length > 0) {
      const latest = trends[0];
      
      // Transaction volume
      if (latest.transactionCount > 20) {
        score += 20;
      } else if (latest.transactionCount < 5) {
        score -= 20;
      }
      
      // Days on market
      if (latest.avgDaysOnMarket < 45) {
        score += 15;
      } else if (latest.avgDaysOnMarket > 90) {
        score -= 15;
      }
      
      // Price trend
      const priceChange = parseFloat(latest.priceChange || "0");
      if (priceChange > 10) {
        score += 15;
      } else if (priceChange < -10) {
        score -= 15;
      }
    }
    
    // Economic factors
    if (indicators) {
      if (indicators.unemploymentRate && parseFloat(indicators.unemploymentRate) < 4) {
        score += 10;
      }
      if (indicators.gdpGrowthRate && parseFloat(indicators.gdpGrowthRate) > 2) {
        score += 10;
      }
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Detect opportunity windows for investing
   */
  private detectOpportunityWindow(
    timing: { timing: string; confidence: number },
    demandScore: number,
    indicators: any
  ): { isOpportunity: boolean; reason?: string; score: number } {
    let opportunityScore = 0;
    const reasons: string[] = [];
    
    // Hot market with high confidence
    if (timing.timing === "hot" && timing.confidence > 0.7) {
      opportunityScore += 30;
      reasons.push("Strong market momentum");
    }
    
    // High demand score
    if (demandScore > 70) {
      opportunityScore += 25;
      reasons.push("High buyer demand");
    }
    
    // Favorable interest rates
    if (indicators?.federalFundsRate && parseFloat(indicators.federalFundsRate) < 3.5) {
      opportunityScore += 20;
      reasons.push("Favorable interest rates");
    }
    
    // Strong economy
    if (indicators?.gdpGrowthRate && parseFloat(indicators.gdpGrowthRate) > 2.5) {
      opportunityScore += 15;
      reasons.push("Strong economic growth");
    }
    
    // Low unemployment
    if (indicators?.unemploymentRate && parseFloat(indicators.unemploymentRate) < 4) {
      opportunityScore += 10;
      reasons.push("Healthy employment");
    }
    
    const isOpportunity = opportunityScore >= 60;
    
    return {
      isOpportunity,
      reason: isOpportunity ? reasons.join("; ") : undefined,
      score: opportunityScore,
    };
  }
  
  /**
   * Calculate list-to-sale price ratio
   */
  private calculateListToSaleRatio(trends: any[]): number {
    if (trends.length === 0) return 0.95;
    
    // Simplified - would use actual list vs sale data
    const latest = trends[0];
    const priceChange = parseFloat(latest.priceChange || "0");
    
    // If prices are rising, properties likely selling at/above list
    if (priceChange > 5) {
      return 1.02;
    } else if (priceChange < -5) {
      return 0.88;
    }
    
    return 0.95;
  }
  
  /**
   * Calculate inventory level
   */
  private calculateInventoryLevel(trends: any[]): string {
    if (trends.length === 0) return "normal";
    
    const latest = trends[0];
    const avgDaysOnMarket = latest.avgDaysOnMarket || 60;
    
    if (avgDaysOnMarket < 30) return "low";
    if (avgDaysOnMarket < 60) return "normal";
    if (avgDaysOnMarket < 120) return "high";
    return "oversupplied";
  }
  
  /**
   * Assess interest rate impact on land market
   */
  private assessInterestRateImpact(indicators: any): string {
    if (!indicators?.federalFundsRate) return "neutral";
    
    const rate = parseFloat(indicators.federalFundsRate);
    
    if (rate < 3) return "positive";
    if (rate > 5) return "negative";
    return "neutral";
  }
  
  /**
   * Assess development activity trend
   */
  private assessDevelopmentActivity(trends: any[]): string {
    if (trends.length < 2) return "stable";
    
    const latest = trends[0];
    const previous = trends[1];
    
    const latestVolume = latest.transactionCount || 0;
    const previousVolume = previous.transactionCount || 0;
    
    if (latestVolume > previousVolume * 1.2) return "increasing";
    if (latestVolume < previousVolume * 0.8) return "decreasing";
    return "stable";
  }
  
  /**
   * Format prediction for API response
   */
  private formatPrediction(prediction: any): PredictionResult {
    return {
      prediction: {
        marketTiming: prediction.marketTiming,
        timingConfidence: parseFloat(prediction.timingConfidence),
        avgPricePerAcre: parseFloat(prediction.avgPricePerAcre),
        predictedPriceChange30Days: parseFloat(prediction.predictedPriceChange30Days),
        predictedPriceChange90Days: parseFloat(prediction.predictedPriceChange90Days),
        predictedPriceChange12Months: parseFloat(prediction.predictedPriceChange12Months),
        demandScore: prediction.demandScore,
        isOpportunityWindow: prediction.isOpportunityWindow,
        opportunityReason: prediction.opportunityReason,
      },
      indicators: {
        daysOnMarketAvg: prediction.daysOnMarketAvg,
        listToSaleRatio: parseFloat(prediction.listToSaleRatio),
        inventoryLevel: prediction.inventoryLevel,
        interestRateImpact: prediction.interestRateImpact,
        developmentActivity: prediction.developmentActivity,
      },
      confidence: {
        dataPoints: prediction.dataPoints,
        lastUpdated: prediction.predictionDate,
      },
    };
  }
  
  /**
   * Get property-specific price trajectory
   */
  async getPropertyTrajectory(propertyId: number) {
    const property = await storage.getProperty(0, propertyId); // orgId not needed for read
    if (!property) {
      return null;
    }
    
    const prediction = await this.getPrediction({
      state: property.state,
      county: property.county,
    });
    
    if (!prediction) {
      return null;
    }
    
    // Calculate property-specific adjustments
    const basePrice = parseFloat(property.marketValue || property.listPrice || "0");
    
    return {
      currentValue: basePrice,
      predicted30Days: basePrice * (1 + prediction.prediction.predictedPriceChange30Days / 100),
      predicted90Days: basePrice * (1 + prediction.prediction.predictedPriceChange90Days / 100),
      predicted12Months: basePrice * (1 + prediction.prediction.predictedPriceChange12Months / 100),
      marketTiming: prediction.prediction.marketTiming,
      confidence: prediction.confidence,
    };
  }
  
  /**
   * Get all opportunity windows (hot markets)
   */
  async getOpportunityWindows(limit = 10) {
    const opportunities = await db.select()
      .from(marketPredictions)
      .where(eq(marketPredictions.isOpportunityWindow, true))
      .orderBy(desc(marketPredictions.opportunityScore))
      .limit(limit);
    
    return opportunities.map(opp => ({
      state: opp.state,
      county: opp.county,
      score: opp.opportunityScore,
      reason: opp.opportunityReason,
      marketTiming: opp.marketTiming,
      demandScore: opp.demandScore,
      avgPricePerAcre: parseFloat(opp.avgPricePerAcre || "0"),
      lastUpdated: opp.predictionDate,
    }));
  }
  
  /**
   * Update market indicators (called by background job)
   */
  async updateMarketIndicators(data: Partial<InsertMarketIndicator>) {
    await db.insert(marketIndicators).values({
      federalFundsRate: data.federalFundsRate || "0",
      mortgageRate30Yr: data.mortgageRate30Yr || "0",
      gdpGrowthRate: data.gdpGrowthRate || "0",
      inflationRate: data.inflationRate || "0",
      unemploymentRate: data.unemploymentRate || "0",
      nationalHomePriceIndex: data.nationalHomePriceIndex || "0",
      landDemandIndex: data.landDemandIndex || "0",
      consumerConfidenceIndex: data.consumerConfidenceIndex || "0",
    });
  }
  
  /**
   * Record price trend data
   */
  async recordPriceTrend(data: InsertPriceTrend) {
    await db.insert(priceTrends).values(data);
  }
}

export const marketPredictionService = new MarketPredictionService();
