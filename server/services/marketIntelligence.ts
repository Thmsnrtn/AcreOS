/**
 * Market Intelligence Engine
 * Predicts value trends and market conditions for land investments
 */

import { db } from "../db";
import { 
  marketMetrics, 
  marketPredictions,
  agentEvents,
  type InsertMarketMetric,
  type InsertMarketPrediction,
  type MarketMetric,
  type MarketPrediction,
  type MarketStatus,
  MARKET_STATUS,
} from "@shared/schema";
import { eq, and, gte, lte, desc, asc, sql } from "drizzle-orm";
import { DataSourceBroker } from "./data-source-broker";

const dataSourceBroker = new DataSourceBroker();

// Types
export interface MarketLocation {
  county: string;
  state: string;
}

export interface MarketAnalysisResult {
  location: MarketLocation;
  analyzedAt: string;
  
  // Current metrics
  currentMetrics: {
    medianPricePerAcre: number | null;
    averageDaysOnMarket: number | null;
    inventoryCount: number | null;
    absorptionRate: number | null;
    salesVolumeLastMonth: number | null;
  };
  
  // Trends
  trends: {
    pricePerAcreTrend: TrendDirection;
    priceChangePercent6Month: number | null;
    priceChangePercent12Month: number | null;
    velocityTrend: TrendDirection;
    inventoryTrend: TrendDirection;
  };
  
  // Scores
  scores: {
    marketHealth: number; // 0-100
    growthPotential: number; // 0-100
    investmentScore: number; // 0-100
  };
  
  // Status
  marketStatus: MarketStatus;
  marketStatusLabel: string;
  
  // Growth indicators
  growthIndicators: GrowthIndicators;
  
  // Historical comparison
  historicalComparison: {
    currentVsHistoricalAvg: number; // Percent difference
    isAboveHistoricalAvg: boolean;
  };
}

export interface MarketHealthResult {
  location: MarketLocation;
  healthScore: number;
  status: MarketStatus;
  statusLabel: string;
  quickMetrics: {
    pricePerAcre: number | null;
    daysOnMarket: number | null;
    monthlyVelocity: TrendDirection;
  };
  alerts: string[];
}

export interface PricePredictionResult {
  location: MarketLocation;
  predictions: {
    horizon3Month: PredictionDetail;
    horizon6Month: PredictionDetail;
    horizon12Month: PredictionDetail;
  };
  confidenceFactors: string[];
  leadingIndicators: LeadingIndicator[];
}

export interface PredictionDetail {
  predictedPricePerAcre: number | null;
  predictedChangePercent: number;
  direction: TrendDirection;
  confidence: number;
  status: MarketStatus;
}

export interface MarketComparisonResult {
  markets: MarketComparisonItem[];
  rankings: {
    byGrowthPotential: MarketLocation[];
    byAffordability: MarketLocation[];
    byVelocity: MarketLocation[];
  };
  recommendations: string[];
}

export interface MarketComparisonItem {
  location: MarketLocation;
  metrics: {
    medianPricePerAcre: number | null;
    growthPotentialScore: number;
    marketHealthScore: number;
    daysOnMarket: number | null;
    yearOverYearChange: number | null;
  };
  status: MarketStatus;
  rank: number;
}

export interface GrowthIndicators {
  permits: {
    residentialPermits: number | null;
    commercialPermits: number | null;
    trend: TrendDirection;
    score: number;
  };
  population: {
    currentPopulation: number | null;
    changePercent: number | null;
    migrationRate: number | null;
    score: number;
  };
  infrastructure: {
    newRoadsPlanned: boolean;
    utilityExpansion: boolean;
    majorDevelopments: string[];
    score: number;
  };
  economic: {
    unemploymentRate: number | null;
    medianIncome: number | null;
    jobGrowthRate: number | null;
    score: number;
  };
  overallScore: number;
}

export interface LeadingIndicator {
  name: string;
  value: number | string;
  trend: TrendDirection;
  impact: "positive" | "negative" | "neutral";
  description: string;
}

export interface PredictionAccuracyResult {
  totalPredictions: number;
  verifiedPredictions: number;
  averageAccuracy: number;
  accuracyByHorizon: {
    threeMonth: number;
    sixMonth: number;
    twelveMonth: number;
  };
  accuracyByType: {
    priceDirection: number;
    marketStatus: number;
  };
  recentAccuracy: number; // Last 30 days
}

type TrendDirection = "up" | "down" | "stable";

// Helper functions
function calculateTrend(values: number[]): TrendDirection {
  if (values.length < 2) return "stable";
  
  const recentAvg = values.slice(0, Math.ceil(values.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(values.length / 2);
  const olderAvg = values.slice(Math.ceil(values.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(values.length / 2);
  
  const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;
  
  if (changePercent > 3) return "up";
  if (changePercent < -3) return "down";
  return "stable";
}

function calculateMarketStatus(
  priceTrend: TrendDirection,
  velocityTrend: TrendDirection,
  inventoryTrend: TrendDirection
): MarketStatus {
  // Heating: prices up, velocity up, inventory down
  if (priceTrend === "up" && velocityTrend === "up") return "heating";
  
  // Cooling: prices down, velocity down, inventory up
  if (priceTrend === "down" && velocityTrend === "down") return "cooling";
  
  // Volatile: mixed signals
  if (
    (priceTrend !== velocityTrend && priceTrend !== "stable" && velocityTrend !== "stable") ||
    (inventoryTrend === "up" && priceTrend === "up")
  ) {
    return "volatile";
  }
  
  return "stable";
}

function calculateHealthScore(metrics: Partial<MarketMetric>): number {
  let score = 50; // Base score
  
  // Adjust based on days on market (lower is better)
  if (metrics.averageDaysOnMarket) {
    const dom = parseFloat(metrics.averageDaysOnMarket as string);
    if (dom < 30) score += 15;
    else if (dom < 60) score += 10;
    else if (dom < 90) score += 5;
    else if (dom > 180) score -= 10;
    else if (dom > 365) score -= 20;
  }
  
  // Adjust based on price changes
  if (metrics.yearOverYearChangePercent) {
    const change = parseFloat(metrics.yearOverYearChangePercent as string);
    if (change > 10) score += 15;
    else if (change > 5) score += 10;
    else if (change > 0) score += 5;
    else if (change < -10) score -= 15;
    else if (change < -5) score -= 10;
  }
  
  // Adjust based on absorption rate
  if (metrics.absorptionRate) {
    const rate = parseFloat(metrics.absorptionRate as string);
    if (rate < 3) score += 10; // Seller's market
    else if (rate < 6) score += 5; // Balanced
    else if (rate > 12) score -= 15; // Buyer's market
  }
  
  // Adjust based on sales volume
  if (metrics.salesVolume && metrics.salesVolume > 10) {
    score += 5;
  }
  
  return Math.max(0, Math.min(100, score));
}

function calculateGrowthPotentialScore(indicators: GrowthIndicators): number {
  const weights = {
    permits: 0.25,
    population: 0.25,
    infrastructure: 0.30,
    economic: 0.20,
  };
  
  return Math.round(
    indicators.permits.score * weights.permits +
    indicators.population.score * weights.population +
    indicators.infrastructure.score * weights.infrastructure +
    indicators.economic.score * weights.economic
  );
}

function calculateInvestmentScore(healthScore: number, growthScore: number, priceToHistorical: number): number {
  // Investment score combines health, growth potential, and value relative to historical
  let score = (healthScore * 0.4) + (growthScore * 0.4);
  
  // Bonus for being below historical average (potential upside)
  if (priceToHistorical < 0) {
    score += Math.min(20, Math.abs(priceToHistorical) / 2);
  }
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Main service class
class MarketIntelligenceService {
  
  /**
   * Full market analysis with trends and scores
   */
  async analyzeMarket(county: string, state: string): Promise<MarketAnalysisResult> {
    const location: MarketLocation = { county, state };
    
    // Fetch historical metrics from database
    const historicalMetrics = await this.getHistoricalMetrics(county, state, 12);
    
    // Fetch fresh data from data sources
    const freshData = await this.fetchMarketData(county, state);
    
    // Calculate current metrics
    const latestMetric = historicalMetrics[0] || freshData.metrics;
    
    const currentMetrics = {
      medianPricePerAcre: latestMetric?.medianPricePerAcre ? parseFloat(latestMetric.medianPricePerAcre as string) : null,
      averageDaysOnMarket: latestMetric?.averageDaysOnMarket ? parseFloat(latestMetric.averageDaysOnMarket as string) : null,
      inventoryCount: latestMetric?.inventoryCount || null,
      absorptionRate: latestMetric?.absorptionRate ? parseFloat(latestMetric.absorptionRate as string) : null,
      salesVolumeLastMonth: latestMetric?.salesVolume || null,
    };
    
    // Calculate trends
    const priceHistory = historicalMetrics
      .filter(m => m.medianPricePerAcre)
      .map(m => parseFloat(m.medianPricePerAcre as string));
    
    const domHistory = historicalMetrics
      .filter(m => m.averageDaysOnMarket)
      .map(m => parseFloat(m.averageDaysOnMarket as string));
    
    const inventoryHistory = historicalMetrics
      .filter(m => m.inventoryCount)
      .map(m => m.inventoryCount!);
    
    const pricePerAcreTrend = calculateTrend(priceHistory);
    const velocityTrend = calculateTrend(domHistory.map(d => -d)); // Invert: lower DOM = higher velocity
    const inventoryTrend = calculateTrend(inventoryHistory);
    
    // Calculate price changes
    const priceChangePercent6Month = priceHistory.length >= 6
      ? ((priceHistory[0] - priceHistory[5]) / priceHistory[5]) * 100
      : null;
    
    const priceChangePercent12Month = priceHistory.length >= 12
      ? ((priceHistory[0] - priceHistory[11]) / priceHistory[11]) * 100
      : null;
    
    // Get growth indicators
    const growthIndicators = await this.getGrowthIndicators(county, state);
    
    // Calculate scores
    const healthScore = calculateHealthScore(latestMetric || {});
    const growthPotentialScore = calculateGrowthPotentialScore(growthIndicators);
    
    // Historical comparison
    const historicalAvg = priceHistory.length > 0
      ? priceHistory.reduce((a, b) => a + b, 0) / priceHistory.length
      : null;
    
    const currentVsHistoricalAvg = historicalAvg && currentMetrics.medianPricePerAcre
      ? ((currentMetrics.medianPricePerAcre - historicalAvg) / historicalAvg) * 100
      : 0;
    
    const investmentScore = calculateInvestmentScore(healthScore, growthPotentialScore, currentVsHistoricalAvg);
    
    // Determine market status
    const marketStatus = calculateMarketStatus(pricePerAcreTrend, velocityTrend, inventoryTrend);
    
    // Store the analysis
    await this.storeMarketMetric({
      county,
      state,
      metricDate: new Date(),
      periodType: "monthly",
      salesVolume: currentMetrics.salesVolumeLastMonth,
      averageDaysOnMarket: currentMetrics.averageDaysOnMarket?.toString(),
      inventoryCount: currentMetrics.inventoryCount,
      absorptionRate: currentMetrics.absorptionRate?.toString(),
      medianPricePerAcre: currentMetrics.medianPricePerAcre?.toString(),
      priceChangePercent: priceChangePercent6Month?.toString(),
      yearOverYearChangePercent: priceChangePercent12Month?.toString(),
      marketHealthScore: healthScore,
      growthPotentialScore: growthPotentialScore,
      investmentScore: investmentScore,
      marketStatus: marketStatus,
      permitData: {
        residentialPermits: growthIndicators.permits.residentialPermits ?? undefined,
        commercialPermits: growthIndicators.permits.commercialPermits ?? undefined,
        permitTrend: growthIndicators.permits.trend === "up" ? "increasing" : 
                     growthIndicators.permits.trend === "down" ? "decreasing" : "stable",
      },
      populationData: {
        currentPopulation: growthIndicators.population.currentPopulation ?? undefined,
        populationChangePercent: growthIndicators.population.changePercent ?? undefined,
        migrationRate: growthIndicators.population.migrationRate ?? undefined,
      },
      infrastructureData: {
        newRoadsPlanned: growthIndicators.infrastructure.newRoadsPlanned,
        utilityExpansion: growthIndicators.infrastructure.utilityExpansion,
        majorDevelopments: growthIndicators.infrastructure.majorDevelopments,
        infrastructureScore: growthIndicators.infrastructure.score,
      },
      economicData: {
        unemploymentRate: growthIndicators.economic.unemploymentRate ?? undefined,
        medianHouseholdIncome: growthIndicators.economic.medianIncome ?? undefined,
        jobGrowthRate: growthIndicators.economic.jobGrowthRate ?? undefined,
      },
    });
    
    return {
      location,
      analyzedAt: new Date().toISOString(),
      currentMetrics,
      trends: {
        pricePerAcreTrend,
        priceChangePercent6Month,
        priceChangePercent12Month,
        velocityTrend,
        inventoryTrend,
      },
      scores: {
        marketHealth: healthScore,
        growthPotential: growthPotentialScore,
        investmentScore,
      },
      marketStatus,
      marketStatusLabel: MARKET_STATUS[marketStatus].name,
      growthIndicators,
      historicalComparison: {
        currentVsHistoricalAvg,
        isAboveHistoricalAvg: currentVsHistoricalAvg > 0,
      },
    };
  }
  
  /**
   * Quick market health score
   */
  async getMarketHealth(county: string, state: string): Promise<MarketHealthResult> {
    const location: MarketLocation = { county, state };
    
    // Get most recent metric
    const [latestMetric] = await db.select()
      .from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state)
      ))
      .orderBy(desc(marketMetrics.metricDate))
      .limit(1);
    
    const alerts: string[] = [];
    
    // If no recent data, fetch fresh
    if (!latestMetric || this.isStaleData(latestMetric.updatedAt)) {
      const analysis = await this.analyzeMarket(county, state);
      return {
        location,
        healthScore: analysis.scores.marketHealth,
        status: analysis.marketStatus,
        statusLabel: analysis.marketStatusLabel,
        quickMetrics: {
          pricePerAcre: analysis.currentMetrics.medianPricePerAcre,
          daysOnMarket: analysis.currentMetrics.averageDaysOnMarket,
          monthlyVelocity: analysis.trends.velocityTrend,
        },
        alerts,
      };
    }
    
    // Generate alerts based on metrics
    if (latestMetric.marketStatus === "heating") {
      alerts.push("Market is heating up - prices may be rising quickly");
    }
    if (latestMetric.marketStatus === "cooling") {
      alerts.push("Market is cooling - potential buying opportunities");
    }
    if (latestMetric.absorptionRate && parseFloat(latestMetric.absorptionRate as string) < 3) {
      alerts.push("Low inventory - seller's market");
    }
    if (latestMetric.yearOverYearChangePercent && parseFloat(latestMetric.yearOverYearChangePercent as string) > 15) {
      alerts.push("Significant price appreciation in the past year");
    }
    
    return {
      location,
      healthScore: latestMetric.marketHealthScore || 50,
      status: (latestMetric.marketStatus as MarketStatus) || "stable",
      statusLabel: MARKET_STATUS[(latestMetric.marketStatus as MarketStatus) || "stable"].name,
      quickMetrics: {
        pricePerAcre: latestMetric.medianPricePerAcre ? parseFloat(latestMetric.medianPricePerAcre as string) : null,
        daysOnMarket: latestMetric.averageDaysOnMarket ? parseFloat(latestMetric.averageDaysOnMarket as string) : null,
        monthlyVelocity: this.determineTrendFromChange(latestMetric.priceChangePercent),
      },
      alerts,
    };
  }
  
  /**
   * Predict future price trends
   */
  async predictPriceTrends(county: string, state: string): Promise<PricePredictionResult> {
    const location: MarketLocation = { county, state };
    
    // Get historical data for predictions
    const historicalMetrics = await this.getHistoricalMetrics(county, state, 24);
    const growthIndicators = await this.getGrowthIndicators(county, state);
    
    // Calculate prediction factors
    const priceHistory = historicalMetrics
      .filter(m => m.medianPricePerAcre)
      .map(m => parseFloat(m.medianPricePerAcre as string));
    
    const currentPrice = priceHistory[0] || 0;
    
    // Leading indicators
    const leadingIndicators = this.calculateLeadingIndicators(historicalMetrics, growthIndicators);
    
    // Generate predictions for different horizons
    const predictions = {
      horizon3Month: this.generatePrediction(currentPrice, priceHistory, growthIndicators, 3),
      horizon6Month: this.generatePrediction(currentPrice, priceHistory, growthIndicators, 6),
      horizon12Month: this.generatePrediction(currentPrice, priceHistory, growthIndicators, 12),
    };
    
    // Store predictions
    await this.storePredictions(county, state, predictions);
    
    // Check for significant predictions and trigger alerts
    await this.checkAndTriggerAlerts(county, state, predictions);
    
    return {
      location,
      predictions,
      confidenceFactors: this.getConfidenceFactors(historicalMetrics),
      leadingIndicators,
    };
  }
  
  /**
   * Compare multiple markets side by side
   */
  async compareMarkets(markets: MarketLocation[]): Promise<MarketComparisonResult> {
    const marketItems: MarketComparisonItem[] = [];
    
    for (const market of markets) {
      const analysis = await this.analyzeMarket(market.county, market.state);
      
      marketItems.push({
        location: market,
        metrics: {
          medianPricePerAcre: analysis.currentMetrics.medianPricePerAcre,
          growthPotentialScore: analysis.scores.growthPotential,
          marketHealthScore: analysis.scores.marketHealth,
          daysOnMarket: analysis.currentMetrics.averageDaysOnMarket,
          yearOverYearChange: analysis.trends.priceChangePercent12Month,
        },
        status: analysis.marketStatus,
        rank: 0, // Will be set after sorting
      });
    }
    
    // Sort and rank by different criteria
    const byGrowthPotential = [...marketItems]
      .sort((a, b) => b.metrics.growthPotentialScore - a.metrics.growthPotentialScore)
      .map((m, i) => ({ ...m, rank: i + 1 }));
    
    const byAffordability = [...marketItems]
      .sort((a, b) => (a.metrics.medianPricePerAcre || Infinity) - (b.metrics.medianPricePerAcre || Infinity))
      .map((m, i) => ({ ...m, rank: i + 1 }));
    
    const byVelocity = [...marketItems]
      .sort((a, b) => (a.metrics.daysOnMarket || Infinity) - (b.metrics.daysOnMarket || Infinity))
      .map((m, i) => ({ ...m, rank: i + 1 }));
    
    // Generate recommendations
    const recommendations = this.generateMarketRecommendations(marketItems);
    
    return {
      markets: byGrowthPotential,
      rankings: {
        byGrowthPotential: byGrowthPotential.map(m => m.location),
        byAffordability: byAffordability.map(m => m.location),
        byVelocity: byVelocity.map(m => m.location),
      },
      recommendations,
    };
  }
  
  /**
   * Get growth indicators for a market
   */
  async getGrowthIndicators(county: string, state: string): Promise<GrowthIndicators> {
    // Fetch data from DataSourceBroker
    const [demographicsResult, infrastructureResult] = await Promise.all([
      dataSourceBroker.lookup("demographics", {
        latitude: 0, // Will use county/state lookup
        longitude: 0,
        county,
        state,
      }),
      dataSourceBroker.lookup("infrastructure", {
        latitude: 0,
        longitude: 0,
        county,
        state,
      }),
    ]);
    
    // Parse demographics data
    const demographics = demographicsResult.success ? demographicsResult.data : {};
    const infrastructure = infrastructureResult.success ? infrastructureResult.data : {};
    
    // Calculate permit score
    const permitScore = this.calculatePermitScore(demographics.permits || {});
    
    // Calculate population score
    const populationScore = this.calculatePopulationScore({
      currentPopulation: demographics.population,
      changePercent: demographics.populationChangePercent,
      migrationRate: demographics.migrationRate,
    });
    
    // Calculate infrastructure score
    const infrastructureScore = this.calculateInfrastructureScore(infrastructure);
    
    // Calculate economic score
    const economicScore = this.calculateEconomicScore({
      unemploymentRate: demographics.unemploymentRate,
      medianIncome: demographics.medianHouseholdIncome,
      jobGrowthRate: demographics.jobGrowthRate,
    });
    
    const indicators: GrowthIndicators = {
      permits: {
        residentialPermits: demographics.permits?.residential || null,
        commercialPermits: demographics.permits?.commercial || null,
        trend: this.calculatePermitTrend(demographics.permits),
        score: permitScore,
      },
      population: {
        currentPopulation: demographics.population || null,
        changePercent: demographics.populationChangePercent || null,
        migrationRate: demographics.migrationRate || null,
        score: populationScore,
      },
      infrastructure: {
        newRoadsPlanned: infrastructure.newRoads || false,
        utilityExpansion: infrastructure.utilityExpansion || false,
        majorDevelopments: infrastructure.majorDevelopments || [],
        score: infrastructureScore,
      },
      economic: {
        unemploymentRate: demographics.unemploymentRate || null,
        medianIncome: demographics.medianHouseholdIncome || null,
        jobGrowthRate: demographics.jobGrowthRate || null,
        score: economicScore,
      },
      overallScore: 0,
    };
    
    indicators.overallScore = calculateGrowthPotentialScore(indicators);
    
    return indicators;
  }
  
  /**
   * Track prediction accuracy over time
   */
  async trackPredictionAccuracy(): Promise<PredictionAccuracyResult> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Get all verified predictions
    const verifiedPredictions = await db.select()
      .from(marketPredictions)
      .where(eq(marketPredictions.status, "verified"));
    
    // Get predictions that need verification
    const expiredPredictions = await db.select()
      .from(marketPredictions)
      .where(and(
        eq(marketPredictions.status, "active"),
        lte(marketPredictions.targetDate, now)
      ));
    
    // Verify expired predictions
    for (const prediction of expiredPredictions) {
      await this.verifyPrediction(prediction);
    }
    
    // Calculate accuracy metrics
    const totalPredictions = await db.select({ count: sql<number>`count(*)` })
      .from(marketPredictions);
    
    const accuracyScores = verifiedPredictions
      .filter(p => p.accuracyScore !== null)
      .map(p => p.accuracyScore!);
    
    const averageAccuracy = accuracyScores.length > 0
      ? accuracyScores.reduce((a, b) => a + b, 0) / accuracyScores.length
      : 0;
    
    // Accuracy by horizon
    const threeMonthPredictions = verifiedPredictions.filter(p => p.horizonMonths === 3);
    const sixMonthPredictions = verifiedPredictions.filter(p => p.horizonMonths === 6);
    const twelveMonthPredictions = verifiedPredictions.filter(p => p.horizonMonths === 12);
    
    const threeMonthAccuracy = this.calculateAverageAccuracy(threeMonthPredictions);
    const sixMonthAccuracy = this.calculateAverageAccuracy(sixMonthPredictions);
    const twelveMonthAccuracy = this.calculateAverageAccuracy(twelveMonthPredictions);
    
    // Accuracy by type
    const pricePredictions = verifiedPredictions.filter(p => p.predictionType === "price_direction");
    const statusPredictions = verifiedPredictions.filter(p => p.predictionType === "market_status");
    
    const priceDirectionAccuracy = this.calculateAverageAccuracy(pricePredictions);
    const marketStatusAccuracy = this.calculateAverageAccuracy(statusPredictions);
    
    // Recent accuracy
    const recentPredictions = verifiedPredictions.filter(p => 
      p.verifiedAt && p.verifiedAt >= thirtyDaysAgo
    );
    const recentAccuracy = this.calculateAverageAccuracy(recentPredictions);
    
    return {
      totalPredictions: totalPredictions[0]?.count || 0,
      verifiedPredictions: verifiedPredictions.length,
      averageAccuracy: Math.round(averageAccuracy),
      accuracyByHorizon: {
        threeMonth: Math.round(threeMonthAccuracy),
        sixMonth: Math.round(sixMonthAccuracy),
        twelveMonth: Math.round(twelveMonthAccuracy),
      },
      accuracyByType: {
        priceDirection: Math.round(priceDirectionAccuracy),
        marketStatus: Math.round(marketStatusAccuracy),
      },
      recentAccuracy: Math.round(recentAccuracy),
    };
  }
  
  // Private helper methods
  
  private async getHistoricalMetrics(county: string, state: string, months: number): Promise<MarketMetric[]> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    
    return db.select()
      .from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state),
        gte(marketMetrics.metricDate, startDate)
      ))
      .orderBy(desc(marketMetrics.metricDate));
  }
  
  private async fetchMarketData(county: string, state: string): Promise<{ metrics: Partial<MarketMetric> }> {
    // Fetch data from multiple sources via DataSourceBroker
    const [marketDataResult, salesResult] = await Promise.all([
      dataSourceBroker.lookup("market_data", {
        latitude: 0,
        longitude: 0,
        county,
        state,
      }),
      dataSourceBroker.lookup("valuation", {
        latitude: 0,
        longitude: 0,
        county,
        state,
      }),
    ]);
    
    const marketData = marketDataResult.success ? marketDataResult.data : {};
    const salesData = salesResult.success ? salesResult.data : {};
    
    return {
      metrics: {
        county,
        state,
        metricDate: new Date(),
        medianPricePerAcre: marketData.medianPricePerAcre?.toString(),
        averagePricePerAcre: marketData.averagePricePerAcre?.toString(),
        averageDaysOnMarket: marketData.averageDaysOnMarket?.toString(),
        salesVolume: salesData.recentSalesCount,
        inventoryCount: marketData.activeListings,
        absorptionRate: marketData.absorptionRate?.toString(),
      },
    };
  }
  
  private isStaleData(updatedAt: Date | null): boolean {
    if (!updatedAt) return true;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return updatedAt < oneWeekAgo;
  }
  
  private determineTrendFromChange(changePercent: string | null): TrendDirection {
    if (!changePercent) return "stable";
    const change = parseFloat(changePercent);
    if (change > 3) return "up";
    if (change < -3) return "down";
    return "stable";
  }
  
  private generatePrediction(
    currentPrice: number,
    priceHistory: number[],
    growthIndicators: GrowthIndicators,
    horizonMonths: number
  ): PredictionDetail {
    if (priceHistory.length < 3) {
      return {
        predictedPricePerAcre: currentPrice,
        predictedChangePercent: 0,
        direction: "stable",
        confidence: 30,
        status: "stable",
      };
    }
    
    // Calculate historical trend
    const monthlyChanges: number[] = [];
    for (let i = 0; i < priceHistory.length - 1; i++) {
      const change = (priceHistory[i] - priceHistory[i + 1]) / priceHistory[i + 1];
      monthlyChanges.push(change);
    }
    
    const avgMonthlyChange = monthlyChanges.reduce((a, b) => a + b, 0) / monthlyChanges.length;
    
    // Adjust based on growth indicators
    let growthAdjustment = 0;
    if (growthIndicators.overallScore > 70) growthAdjustment = 0.005;
    else if (growthIndicators.overallScore > 50) growthAdjustment = 0.002;
    else if (growthIndicators.overallScore < 30) growthAdjustment = -0.003;
    
    // Project future price
    const projectedMonthlyChange = avgMonthlyChange + growthAdjustment;
    const compoundedChange = Math.pow(1 + projectedMonthlyChange, horizonMonths) - 1;
    const predictedPrice = currentPrice * (1 + compoundedChange);
    const predictedChangePercent = compoundedChange * 100;
    
    // Determine direction
    let direction: TrendDirection = "stable";
    if (predictedChangePercent > 3) direction = "up";
    else if (predictedChangePercent < -3) direction = "down";
    
    // Calculate confidence based on data quality and horizon
    let confidence = 70;
    confidence -= horizonMonths * 3; // Longer horizon = less confidence
    if (priceHistory.length < 6) confidence -= 15;
    if (priceHistory.length >= 12) confidence += 10;
    
    // Higher confidence if growth indicators align with trend
    if (
      (direction === "up" && growthIndicators.overallScore > 60) ||
      (direction === "down" && growthIndicators.overallScore < 40)
    ) {
      confidence += 10;
    }
    
    confidence = Math.max(20, Math.min(90, confidence));
    
    // Determine market status
    const status = this.predictMarketStatus(direction, growthIndicators);
    
    return {
      predictedPricePerAcre: Math.round(predictedPrice),
      predictedChangePercent: Math.round(predictedChangePercent * 10) / 10,
      direction,
      confidence,
      status,
    };
  }
  
  private predictMarketStatus(direction: TrendDirection, indicators: GrowthIndicators): MarketStatus {
    if (direction === "up" && indicators.overallScore > 60) return "heating";
    if (direction === "down" && indicators.overallScore < 40) return "cooling";
    if (direction === "up" && indicators.overallScore < 40) return "volatile";
    return "stable";
  }
  
  private calculateLeadingIndicators(
    metrics: MarketMetric[],
    growthIndicators: GrowthIndicators
  ): LeadingIndicator[] {
    const indicators: LeadingIndicator[] = [];
    
    // Permit activity
    if (growthIndicators.permits.residentialPermits !== null) {
      indicators.push({
        name: "Building Permits",
        value: growthIndicators.permits.residentialPermits,
        trend: growthIndicators.permits.trend,
        impact: growthIndicators.permits.trend === "up" ? "positive" : 
                growthIndicators.permits.trend === "down" ? "negative" : "neutral",
        description: "New residential permits indicate future development",
      });
    }
    
    // Population change
    if (growthIndicators.population.changePercent !== null) {
      const trend: TrendDirection = growthIndicators.population.changePercent > 1 ? "up" :
                                     growthIndicators.population.changePercent < -1 ? "down" : "stable";
      indicators.push({
        name: "Population Growth",
        value: `${growthIndicators.population.changePercent}%`,
        trend,
        impact: trend === "up" ? "positive" : trend === "down" ? "negative" : "neutral",
        description: "Population changes affect land demand",
      });
    }
    
    // Days on market trend
    if (metrics.length >= 3) {
      const recentDOM = metrics.slice(0, 3)
        .filter(m => m.averageDaysOnMarket)
        .map(m => parseFloat(m.averageDaysOnMarket as string));
      
      if (recentDOM.length >= 2) {
        const domTrend = calculateTrend(recentDOM.map(d => -d));
        indicators.push({
          name: "Days on Market",
          value: Math.round(recentDOM[0]),
          trend: domTrend,
          impact: domTrend === "up" ? "positive" : domTrend === "down" ? "negative" : "neutral",
          description: "Faster sales indicate stronger demand",
        });
      }
    }
    
    // Inventory levels
    if (metrics.length >= 3) {
      const recentInventory = metrics.slice(0, 3)
        .filter(m => m.inventoryCount)
        .map(m => m.inventoryCount!);
      
      if (recentInventory.length >= 2) {
        const inventoryTrend = calculateTrend(recentInventory);
        indicators.push({
          name: "Inventory Levels",
          value: recentInventory[0],
          trend: inventoryTrend,
          impact: inventoryTrend === "down" ? "positive" : 
                  inventoryTrend === "up" ? "negative" : "neutral",
          description: "Lower inventory typically leads to price increases",
        });
      }
    }
    
    // Infrastructure development
    if (growthIndicators.infrastructure.majorDevelopments.length > 0) {
      indicators.push({
        name: "Infrastructure Projects",
        value: growthIndicators.infrastructure.majorDevelopments.length,
        trend: "up",
        impact: "positive",
        description: "New infrastructure increases land value potential",
      });
    }
    
    return indicators;
  }
  
  private getConfidenceFactors(metrics: MarketMetric[]): string[] {
    const factors: string[] = [];
    
    if (metrics.length >= 12) {
      factors.push("Strong historical data (12+ months)");
    } else if (metrics.length >= 6) {
      factors.push("Moderate historical data (6-12 months)");
    } else {
      factors.push("Limited historical data (< 6 months) - predictions less reliable");
    }
    
    const hasRecentData = metrics.some(m => {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      return m.metricDate >= oneMonthAgo;
    });
    
    if (hasRecentData) {
      factors.push("Recent market data available");
    } else {
      factors.push("No recent data - using older metrics");
    }
    
    return factors;
  }
  
  private async storePredictions(
    county: string,
    state: string,
    predictions: {
      horizon3Month: PredictionDetail;
      horizon6Month: PredictionDetail;
      horizon12Month: PredictionDetail;
    }
  ): Promise<void> {
    const now = new Date();
    
    const predictionRecords: InsertMarketPrediction[] = [
      {
        county,
        state,
        predictionType: "price_direction",
        predictionDate: now,
        targetDate: new Date(now.getTime() + 3 * 30 * 24 * 60 * 60 * 1000),
        horizonMonths: 3,
        predictedValue: predictions.horizon3Month.predictedPricePerAcre?.toString(),
        predictedDirection: predictions.horizon3Month.direction,
        predictedChangePercent: predictions.horizon3Month.predictedChangePercent.toString(),
        predictedMarketStatus: predictions.horizon3Month.status,
        confidenceScore: predictions.horizon3Month.confidence,
        modelVersion: "v1",
        algorithmUsed: "weighted_trend_analysis",
        status: "active",
      },
      {
        county,
        state,
        predictionType: "price_direction",
        predictionDate: now,
        targetDate: new Date(now.getTime() + 6 * 30 * 24 * 60 * 60 * 1000),
        horizonMonths: 6,
        predictedValue: predictions.horizon6Month.predictedPricePerAcre?.toString(),
        predictedDirection: predictions.horizon6Month.direction,
        predictedChangePercent: predictions.horizon6Month.predictedChangePercent.toString(),
        predictedMarketStatus: predictions.horizon6Month.status,
        confidenceScore: predictions.horizon6Month.confidence,
        modelVersion: "v1",
        algorithmUsed: "weighted_trend_analysis",
        status: "active",
      },
      {
        county,
        state,
        predictionType: "price_direction",
        predictionDate: now,
        targetDate: new Date(now.getTime() + 12 * 30 * 24 * 60 * 60 * 1000),
        horizonMonths: 12,
        predictedValue: predictions.horizon12Month.predictedPricePerAcre?.toString(),
        predictedDirection: predictions.horizon12Month.direction,
        predictedChangePercent: predictions.horizon12Month.predictedChangePercent.toString(),
        predictedMarketStatus: predictions.horizon12Month.status,
        confidenceScore: predictions.horizon12Month.confidence,
        modelVersion: "v1",
        algorithmUsed: "weighted_trend_analysis",
        status: "active",
      },
    ];
    
    for (const prediction of predictionRecords) {
      await db.insert(marketPredictions).values(prediction);
    }
  }
  
  private async checkAndTriggerAlerts(
    county: string,
    state: string,
    predictions: {
      horizon3Month: PredictionDetail;
      horizon6Month: PredictionDetail;
      horizon12Month: PredictionDetail;
    }
  ): Promise<void> {
    // Trigger alert if significant market shift is predicted
    const significantChange = Math.abs(predictions.horizon6Month.predictedChangePercent) > 10;
    const statusChange = predictions.horizon6Month.status !== "stable";
    
    if (significantChange || statusChange) {
      await db.insert(agentEvents).values({
        organizationId: 1, // System-wide event
        eventType: "market_shift_predicted",
        eventSource: "market_intelligence",
        payload: {
          county,
          state,
          predictedChange: predictions.horizon6Month.predictedChangePercent,
          predictedStatus: predictions.horizon6Month.status,
          confidence: predictions.horizon6Month.confidence,
          alertReason: significantChange ? "significant_price_change" : "market_status_shift",
        },
        relatedEntityType: "market",
      });
      
      console.log(`[MarketIntelligence] Alert triggered for ${county}, ${state}: ${predictions.horizon6Month.predictedChangePercent}% change predicted`);
    }
  }
  
  private async storeMarketMetric(metric: InsertMarketMetric): Promise<void> {
    await db.insert(marketMetrics).values(metric);
  }
  
  private async verifyPrediction(prediction: MarketPrediction): Promise<void> {
    // Get actual data for the prediction target date
    const [actualMetric] = await db.select()
      .from(marketMetrics)
      .where(and(
        eq(marketMetrics.county, prediction.county),
        eq(marketMetrics.state, prediction.state),
        gte(marketMetrics.metricDate, prediction.targetDate)
      ))
      .orderBy(asc(marketMetrics.metricDate))
      .limit(1);
    
    if (!actualMetric || !actualMetric.medianPricePerAcre) {
      return; // Can't verify yet
    }
    
    const actualValue = parseFloat(actualMetric.medianPricePerAcre as string);
    const predictedValue = prediction.predictedValue ? parseFloat(prediction.predictedValue as string) : null;
    
    let accuracyScore = 0;
    let predictionError = 0;
    
    if (predictedValue) {
      predictionError = ((actualValue - predictedValue) / predictedValue) * 100;
      
      // Score: 100 if exactly right, decreasing as error increases
      const absError = Math.abs(predictionError);
      if (absError <= 5) accuracyScore = 100 - absError * 2;
      else if (absError <= 10) accuracyScore = 90 - (absError - 5) * 4;
      else if (absError <= 20) accuracyScore = 70 - (absError - 10) * 3;
      else accuracyScore = Math.max(0, 40 - (absError - 20) * 2);
    }
    
    // Determine actual direction
    const priceAtPrediction = prediction.predictedValue ? parseFloat(prediction.predictedValue as string) : actualValue;
    const actualChangePercent = ((actualValue - priceAtPrediction) / priceAtPrediction) * 100;
    const actualDirection = actualChangePercent > 3 ? "up" : actualChangePercent < -3 ? "down" : "stable";
    
    // Update prediction with actual values
    await db.update(marketPredictions)
      .set({
        actualValue: actualValue.toString(),
        actualDirection,
        actualChangePercent: actualChangePercent.toString(),
        predictionError: predictionError.toString(),
        accuracyScore: Math.round(accuracyScore),
        status: "verified",
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketPredictions.id, prediction.id));
  }
  
  private calculateAverageAccuracy(predictions: MarketPrediction[]): number {
    const scores = predictions
      .filter(p => p.accuracyScore !== null)
      .map(p => p.accuracyScore!);
    
    if (scores.length === 0) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }
  
  private calculatePermitScore(permits: any): number {
    if (!permits) return 50;
    
    let score = 50;
    if (permits.residential > 100) score += 20;
    else if (permits.residential > 50) score += 10;
    else if (permits.residential < 10) score -= 10;
    
    if (permits.commercial > 20) score += 15;
    else if (permits.commercial > 10) score += 8;
    
    return Math.max(0, Math.min(100, score));
  }
  
  private calculatePopulationScore(data: { currentPopulation?: number; changePercent?: number; migrationRate?: number }): number {
    let score = 50;
    
    if (data.changePercent) {
      if (data.changePercent > 3) score += 25;
      else if (data.changePercent > 1) score += 15;
      else if (data.changePercent > 0) score += 5;
      else if (data.changePercent < -1) score -= 15;
    }
    
    if (data.migrationRate) {
      if (data.migrationRate > 2) score += 15;
      else if (data.migrationRate > 0) score += 8;
      else if (data.migrationRate < -2) score -= 15;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  private calculateInfrastructureScore(data: any): number {
    let score = 50;
    
    if (data.newRoads) score += 15;
    if (data.utilityExpansion) score += 15;
    if (data.majorDevelopments?.length > 0) {
      score += Math.min(20, data.majorDevelopments.length * 5);
    }
    if (data.publicTransit) score += 10;
    
    return Math.max(0, Math.min(100, score));
  }
  
  private calculateEconomicScore(data: { unemploymentRate?: number; medianIncome?: number; jobGrowthRate?: number }): number {
    let score = 50;
    
    if (data.unemploymentRate) {
      if (data.unemploymentRate < 3) score += 20;
      else if (data.unemploymentRate < 5) score += 10;
      else if (data.unemploymentRate > 8) score -= 15;
      else if (data.unemploymentRate > 6) score -= 10;
    }
    
    if (data.jobGrowthRate) {
      if (data.jobGrowthRate > 3) score += 15;
      else if (data.jobGrowthRate > 1) score += 8;
      else if (data.jobGrowthRate < 0) score -= 10;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  private calculatePermitTrend(permits: any): TrendDirection {
    if (!permits || !permits.history) return "stable";
    
    const history = permits.history as number[];
    if (history.length < 2) return "stable";
    
    return calculateTrend(history);
  }
  
  private generateMarketRecommendations(markets: MarketComparisonItem[]): string[] {
    const recommendations: string[] = [];
    
    // Find best growth potential
    const bestGrowth = [...markets].sort((a, b) => 
      b.metrics.growthPotentialScore - a.metrics.growthPotentialScore
    )[0];
    
    if (bestGrowth && bestGrowth.metrics.growthPotentialScore > 70) {
      recommendations.push(
        `${bestGrowth.location.county}, ${bestGrowth.location.state} shows the strongest growth potential with a score of ${bestGrowth.metrics.growthPotentialScore}`
      );
    }
    
    // Find best value
    const mostAffordable = [...markets]
      .filter(m => m.metrics.medianPricePerAcre)
      .sort((a, b) => (a.metrics.medianPricePerAcre || 0) - (b.metrics.medianPricePerAcre || 0))[0];
    
    if (mostAffordable && mostAffordable.metrics.growthPotentialScore > 50) {
      recommendations.push(
        `${mostAffordable.location.county}, ${mostAffordable.location.state} offers the best value with potential for appreciation`
      );
    }
    
    // Find heating markets
    const heatingMarkets = markets.filter(m => m.status === "heating");
    if (heatingMarkets.length > 0) {
      recommendations.push(
        `Caution: ${heatingMarkets.length} market(s) showing heating conditions - prices may be elevated`
      );
    }
    
    // Find cooling markets with opportunity
    const coolingWithGrowth = markets.filter(m => 
      m.status === "cooling" && m.metrics.growthPotentialScore > 60
    );
    if (coolingWithGrowth.length > 0) {
      recommendations.push(
        `Opportunity: ${coolingWithGrowth.length} cooling market(s) with strong growth fundamentals may offer buying opportunities`
      );
    }
    
    return recommendations;
  }
}

// Export singleton instance
export const marketIntelligence = new MarketIntelligenceService();
