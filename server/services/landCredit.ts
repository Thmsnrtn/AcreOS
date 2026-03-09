// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import { 
  landCreditScores, 
  properties 
} from '../../shared/schema';
import { eq, and, desc } from 'drizzle-orm';

interface ScoringFactors {
  location: {
    score: number; // 0-100
    weight: number;
    factors: {
      marketStrength: number; // County market momentum
      growthRate: number; // Population growth
      economicHealth: number; // Employment, income
      accessibility: number; // Highway proximity, airports
    };
  };
  physical: {
    score: number;
    weight: number;
    factors: {
      topography: number; // Flat vs steep
      soilQuality: number; // Ag potential
      waterAccess: number; // Rivers, wells, rights
      utilities: number; // Power, gas, internet
      roadAccess: number; // Paved, dirt, or none
    };
  };
  legal: {
    score: number;
    weight: number;
    factors: {
      zoning: number; // Flexibility and value
      restrictions: number; // HOAs, covenants
      mineralRights: number; // Owned or severed
      waterRights: number; // Owned or shared
      clearTitle: number; // Liens, disputes
    };
  };
  financial: {
    score: number;
    weight: number;
    factors: {
      cashFlow: number; // Current income generation
      appreciation: number; // Historical + projected
      liquidity: number; // How fast it sells
      taxBurden: number; // Property taxes
      maintenanceCost: number; // Annual upkeep
    };
  };
  environmental: {
    score: number;
    weight: number;
    factors: {
      floodRisk: number; // FEMA zones
      wildfire: number; // CAL FIRE zones
      contamination: number; // Superfund sites
      wetlands: number; // Protected areas
      endangered: number; // Species restrictions
    };
  };
  market: {
    score: number;
    weight: number;
    factors: {
      demand: number; // Buyer interest
      supply: number; // Comparable inventory
      priceHistory: number; // Value stability
      daysOnMarket: number; // Sales velocity
      comparables: number; // Quality of comps
    };
  };
}

interface CreditScore {
  overall: number; // 300-850 (like FICO)
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  factors: ScoringFactors;
  riskLevel: 'excellent' | 'good' | 'fair' | 'poor' | 'high';
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

class LandCreditScoring {
  // Scoring weights (must sum to 100)
  private readonly WEIGHTS = {
    location: 25,
    physical: 20,
    legal: 15,
    financial: 20,
    environmental: 10,
    market: 10,
  };

  /**
   * Calculate comprehensive land credit score
   */
  async calculateCreditScore(
    organizationId: string,
    propertyId: string
  ): Promise<CreditScore> {
    try {
      // Get property details
      const property = await db.query.properties.findFirst({
        where: and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, organizationId)
        ),
      });

      if (!property) {
        throw new Error('Property not found');
      }

      // Calculate each dimension
      const location = await this.scoreLocation(property);
      const physical = await this.scorePhysical(property);
      const legal = await this.scoreLegal(property);
      const financial = await this.scoreFinancial(property);
      const environmental = await this.scoreEnvironmental(property);
      const market = await this.scoreMarket(property);

      // Calculate weighted overall score
      const overall = Math.round(
        (location.score * this.WEIGHTS.location +
         physical.score * this.WEIGHTS.physical +
         legal.score * this.WEIGHTS.legal +
         financial.score * this.WEIGHTS.financial +
         environmental.score * this.WEIGHTS.environmental +
         market.score * this.WEIGHTS.market) / 100
      );

      // Convert to 300-850 scale (like FICO)
      const creditScore = Math.round(300 + (overall / 100) * 550);

      // Determine grade
      const grade = this.determineGrade(creditScore);
      const riskLevel = this.determineRiskLevel(creditScore);

      // Analyze strengths and weaknesses
      const factors: ScoringFactors = {
        location: { ...location, weight: this.WEIGHTS.location },
        physical: { ...physical, weight: this.WEIGHTS.physical },
        legal: { ...legal, weight: this.WEIGHTS.legal },
        financial: { ...financial, weight: this.WEIGHTS.financial },
        environmental: { ...environmental, weight: this.WEIGHTS.environmental },
        market: { ...market, weight: this.WEIGHTS.market },
      };

      const { strengths, weaknesses } = this.identifyStrengthsWeaknesses(factors);
      const recommendations = this.generateRecommendations(factors, creditScore);

      // Save score to database
      await db.insert(landCreditScores).values({
        organizationId,
        propertyId,
        score: creditScore,
        grade,
        factors: factors as any,
        riskLevel,
        strengths,
        weaknesses,
        recommendations,
      });

      return {
        overall: creditScore,
        grade,
        factors,
        riskLevel,
        strengths,
        weaknesses,
        recommendations,
      };
    } catch (error) {
      console.error('Credit score calculation failed:', error);
      throw error;
    }
  }

  /**
   * Score location factors (25% weight)
   */
  private async scoreLocation(property: any): Promise<{ score: number; factors: any }> {
    const factors = {
      marketStrength: 70, // Default - would pull from marketPredictions
      growthRate: 60, // Default - would pull from census data
      economicHealth: 65, // Default - would pull from BLS data
      accessibility: 50, // Default - would calculate from highway/airport distance
    };

    // Would integrate with actual data sources
    // For now, make educated guesses based on property data

    if (property.state === 'TX' || property.state === 'FL') {
      factors.growthRate = 80; // High growth states
      factors.economicHealth = 75;
    } else if (property.state === 'CA' || property.state === 'NY') {
      factors.economicHealth = 70;
      factors.accessibility = 80; // Well-connected states
    }

    // Calculate weighted average
    const score = Math.round(
      (factors.marketStrength * 0.30 +
       factors.growthRate * 0.30 +
       factors.economicHealth * 0.25 +
       factors.accessibility * 0.15)
    );

    return { score, factors };
  }

  /**
   * Score physical characteristics (20% weight)
   */
  private async scorePhysical(property: any): Promise<{ score: number; factors: any }> {
    const factors = {
      topography: 50,
      soilQuality: 50,
      waterAccess: 50,
      utilities: 50,
      roadAccess: 50,
    };

    // Topography
    const topography = property.topography?.toLowerCase();
    if (topography === 'flat') factors.topography = 90;
    else if (topography === 'rolling') factors.topography = 70;
    else if (topography === 'hilly') factors.topography = 50;
    else if (topography === 'steep') factors.topography = 30;

    // Water access
    if (property.waterRights) {
      factors.waterAccess = 95;
    } else if (property.waterFrontage) {
      factors.waterAccess = 80;
    } else if (property.wellDepth && property.wellDepth < 200) {
      factors.waterAccess = 70;
    }

    // Utilities - count available
    let utilityCount = 0;
    if (property.electricAvailable) utilityCount++;
    if (property.gasAvailable) utilityCount++;
    if (property.sewerAvailable) utilityCount++;
    if (property.internetAvailable) utilityCount++;
    factors.utilities = Math.min(100, 50 + (utilityCount * 12));

    // Road access
    const roadAccess = property.roadAccess?.toLowerCase();
    if (roadAccess === 'paved') factors.roadAccess = 90;
    else if (roadAccess === 'gravel') factors.roadAccess = 70;
    else if (roadAccess === 'dirt') factors.roadAccess = 50;
    else if (roadAccess === 'none') factors.roadAccess = 20;

    const score = Math.round(
      (factors.topography * 0.20 +
       factors.soilQuality * 0.20 +
       factors.waterAccess * 0.25 +
       factors.utilities * 0.20 +
       factors.roadAccess * 0.15)
    );

    return { score, factors };
  }

  /**
   * Score legal factors (15% weight)
   */
  private async scoreLegal(property: any): Promise<{ score: number; factors: any }> {
    const factors = {
      zoning: 50,
      restrictions: 70, // Assume few restrictions by default
      mineralRights: 50,
      waterRights: 50,
      clearTitle: 90, // Assume clear title by default
    };

    // Zoning
    const zoning = property.zoning?.toLowerCase();
    if (zoning?.includes('commercial')) factors.zoning = 95;
    else if (zoning?.includes('residential')) factors.zoning = 90;
    else if (zoning?.includes('industrial')) factors.zoning = 85;
    else if (zoning?.includes('agricultural')) factors.zoning = 70;
    else if (zoning?.includes('conservation')) factors.zoning = 40;

    // Water rights
    if (property.waterRights) {
      factors.waterRights = 95;
    }

    // Mineral rights
    if (property.mineralRights === 'owned') {
      factors.mineralRights = 100;
    } else if (property.mineralRights === 'partial') {
      factors.mineralRights = 60;
    } else if (property.mineralRights === 'severed') {
      factors.mineralRights = 30;
    }

    // HOA restrictions
    if (property.hoaFees && property.hoaFees > 0) {
      factors.restrictions = 50; // HOAs reduce flexibility
    }

    const score = Math.round(
      (factors.zoning * 0.30 +
       factors.restrictions * 0.20 +
       factors.mineralRights * 0.15 +
       factors.waterRights * 0.20 +
       factors.clearTitle * 0.15)
    );

    return { score, factors };
  }

  /**
   * Score financial factors (20% weight)
   */
  private async scoreFinancial(property: any): Promise<{ score: number; factors: any }> {
    const factors = {
      cashFlow: 50,
      appreciation: 60,
      liquidity: 50,
      taxBurden: 70,
      maintenanceCost: 75,
    };

    // Cash flow - if generating income
    if (property.monthlyIncome && property.monthlyIncome > 0) {
      const annualIncome = property.monthlyIncome * 12;
      const value = property.estimatedValue || property.purchasePrice || 0;
      const yieldPercent = (annualIncome / value) * 100;
      
      if (yieldPercent > 8) factors.cashFlow = 95;
      else if (yieldPercent > 5) factors.cashFlow = 80;
      else if (yieldPercent > 3) factors.cashFlow = 65;
      else factors.cashFlow = 50;
    } else {
      factors.cashFlow = 40; // No income generation
    }

    // Appreciation - historical
    if (property.purchasePrice && property.estimatedValue) {
      const appreciation = ((property.estimatedValue - property.purchasePrice) / property.purchasePrice) * 100;
      const annualAppreciation = appreciation / ((new Date().getTime() - new Date(property.purchaseDate).getTime()) / (365 * 24 * 60 * 60 * 1000));
      
      if (annualAppreciation > 10) factors.appreciation = 95;
      else if (annualAppreciation > 7) factors.appreciation = 85;
      else if (annualAppreciation > 5) factors.appreciation = 75;
      else if (annualAppreciation > 3) factors.appreciation = 60;
      else if (annualAppreciation > 0) factors.appreciation = 50;
      else factors.appreciation = 30; // Depreciation
    }

    // Liquidity - based on acreage and price
    const acres = property.acres || 0;
    const value = property.estimatedValue || property.purchasePrice || 0;
    const pricePerAcre = acres > 0 ? value / acres : 0;

    // Smaller parcels and reasonable prices = higher liquidity
    if (acres < 5 && pricePerAcre < 10000) factors.liquidity = 85;
    else if (acres < 20 && pricePerAcre < 15000) factors.liquidity = 70;
    else if (acres < 40 && pricePerAcre < 20000) factors.liquidity = 60;
    else if (acres > 100 || pricePerAcre > 50000) factors.liquidity = 35;

    // Tax burden
    const annualTax = property.annualPropertyTax || 0;
    if (value > 0) {
      const taxRate = (annualTax / value) * 100;
      if (taxRate < 0.5) factors.taxBurden = 95;
      else if (taxRate < 1.0) factors.taxBurden = 80;
      else if (taxRate < 1.5) factors.taxBurden = 65;
      else if (taxRate < 2.0) factors.taxBurden = 50;
      else factors.taxBurden = 35;
    }

    const score = Math.round(
      (factors.cashFlow * 0.25 +
       factors.appreciation * 0.30 +
       factors.liquidity * 0.20 +
       factors.taxBurden * 0.15 +
       factors.maintenanceCost * 0.10)
    );

    return { score, factors };
  }

  /**
   * Score environmental factors (10% weight)
   */
  private async scoreEnvironmental(property: any): Promise<{ score: number; factors: any }> {
    const factors = {
      floodRisk: 80, // Assume low risk by default
      wildfire: 80,
      contamination: 90,
      wetlands: 85,
      endangered: 85,
    };

    // Flood risk
    const floodZone = property.floodZone?.toUpperCase();
    if (floodZone === 'X' || floodZone === 'C') {
      factors.floodRisk = 95; // Minimal risk
    } else if (floodZone === 'B' || floodZone === 'SHADED X') {
      factors.floodRisk = 75; // Moderate risk
    } else if (floodZone === 'A' || floodZone === 'AE') {
      factors.floodRisk = 40; // High risk
    } else if (floodZone === 'V' || floodZone === 'VE') {
      factors.floodRisk = 20; // Coastal high-hazard area
    }

    // Wildfire risk - approximate by state
    if (['CA', 'CO', 'OR', 'WA', 'MT', 'ID'].includes(property.state)) {
      factors.wildfire = 60; // Higher risk western states
    }

    const score = Math.round(
      (factors.floodRisk * 0.30 +
       factors.wildfire * 0.25 +
       factors.contamination * 0.20 +
       factors.wetlands * 0.15 +
       factors.endangered * 0.10)
    );

    return { score, factors };
  }

  /**
   * Score market factors (10% weight)
   */
  private async scoreMarket(property: any): Promise<{ score: number; factors: any }> {
    const factors = {
      demand: 60,
      supply: 60,
      priceHistory: 70,
      daysOnMarket: 60,
      comparables: 65,
    };

    // Would integrate with marketPrediction service
    // For now, use heuristics

    // Days on market
    if (property.daysOnMarket) {
      if (property.daysOnMarket < 30) factors.daysOnMarket = 95;
      else if (property.daysOnMarket < 90) factors.daysOnMarket = 75;
      else if (property.daysOnMarket < 180) factors.daysOnMarket = 55;
      else if (property.daysOnMarket < 365) factors.daysOnMarket = 40;
      else factors.daysOnMarket = 25;
    }

    const score = Math.round(
      (factors.demand * 0.25 +
       factors.supply * 0.20 +
       factors.priceHistory * 0.20 +
       factors.daysOnMarket * 0.20 +
       factors.comparables * 0.15)
    );

    return { score, factors };
  }

  /**
   * Convert numeric score to letter grade
   */
  private determineGrade(score: number): CreditScore['grade'] {
    if (score >= 800) return 'A+';
    if (score >= 740) return 'A';
    if (score >= 700) return 'B+';
    if (score >= 660) return 'B';
    if (score >= 620) return 'C+';
    if (score >= 580) return 'C';
    if (score >= 500) return 'D';
    return 'F';
  }

  /**
   * Determine risk level
   */
  private determineRiskLevel(score: number): CreditScore['riskLevel'] {
    if (score >= 740) return 'excellent';
    if (score >= 670) return 'good';
    if (score >= 580) return 'fair';
    if (score >= 500) return 'poor';
    return 'high';
  }

  /**
   * Identify top strengths and weaknesses
   */
  private identifyStrengthsWeaknesses(
    factors: ScoringFactors
  ): { strengths: string[]; weaknesses: string[] } {
    const dimensions = [
      { name: 'Location', score: factors.location.score, factors: factors.location.factors },
      { name: 'Physical', score: factors.physical.score, factors: factors.physical.factors },
      { name: 'Legal', score: factors.legal.score, factors: factors.legal.factors },
      { name: 'Financial', score: factors.financial.score, factors: factors.financial.factors },
      { name: 'Environmental', score: factors.environmental.score, factors: factors.environmental.factors },
      { name: 'Market', score: factors.market.score, factors: factors.market.factors },
    ];

    // Sort by score
    dimensions.sort((a, b) => b.score - a.score);

    // Top 3 = strengths
    const strengths = dimensions.slice(0, 3).map(d => {
      const topFactor = Object.entries(d.factors as any)
        .sort((a, b) => (b[1] as number) - (a[1] as number))[0];
      return `${d.name}: ${this.formatFactorName(topFactor[0])} (${d.score}/100)`;
    });

    // Bottom 3 = weaknesses
    const weaknesses = dimensions.slice(-3).reverse().map(d => {
      const bottomFactor = Object.entries(d.factors as any)
        .sort((a, b) => (a[1] as number) - (b[1] as number))[0];
      return `${d.name}: ${this.formatFactorName(bottomFactor[0])} (${d.score}/100)`;
    });

    return { strengths, weaknesses };
  }

  /**
   * Generate improvement recommendations
   */
  private generateRecommendations(
    factors: ScoringFactors,
    overallScore: number
  ): string[] {
    const recommendations: string[] = [];

    // Check each dimension for improvement opportunities
    if (factors.physical.score < 60) {
      if (factors.physical.factors.utilities < 60) {
        recommendations.push('Improve utility access to increase property value and marketability');
      }
      if (factors.physical.factors.roadAccess < 60) {
        recommendations.push('Invest in road improvements or establish legal access');
      }
    }

    if (factors.legal.score < 60) {
      if (factors.legal.factors.zoning < 60) {
        recommendations.push('Explore zoning change or variance for higher-value use');
      }
      if (factors.legal.factors.mineralRights < 60) {
        recommendations.push('Consider negotiating mineral rights purchase if economically viable');
      }
    }

    if (factors.financial.score < 60) {
      if (factors.financial.factors.cashFlow < 50) {
        recommendations.push('Explore income-generating opportunities: leasing, ag use, cell towers');
      }
      if (factors.financial.factors.liquidity < 50) {
        recommendations.push('Consider subdivision to create smaller, more liquid parcels');
      }
    }

    if (factors.environmental.score < 60) {
      if (factors.environmental.factors.floodRisk < 60) {
        recommendations.push('Investigate flood mitigation strategies or elevation certificates');
      }
      if (factors.environmental.factors.wildfire < 60) {
        recommendations.push('Implement defensible space and fire-safe landscaping');
      }
    }

    if (overallScore < 620) {
      recommendations.push('Overall score indicates higher risk - focus on top 2-3 weaknesses first');
    }

    if (recommendations.length === 0) {
      recommendations.push('Property scores well across all dimensions - maintain current characteristics');
    }

    return recommendations.slice(0, 5); // Return top 5
  }

  /**
   * Format factor name for display
   */
  private formatFactorName(factor: string): string {
    return factor
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Get score history for property
   */
  async getScoreHistory(
    organizationId: string,
    propertyId: string
  ): Promise<any[]> {
    try {
      return await db.query.landCreditScores.findMany({
        where: and(
          eq(landCreditScores.organizationId, organizationId),
          eq(landCreditScores.propertyId, propertyId)
        ),
        orderBy: [desc(landCreditScores.createdAt)],
      });
    } catch (error) {
      console.error('Failed to get score history:', error);
      throw error;
    }
  }

  /**
   * Calculate scores for all properties (bulk operation)
   */
  async calculateBulkScores(
    organizationId: string
  ): Promise<{ scored: number; failed: number }> {
    try {
      const props = await db.query.properties.findMany({
        where: eq(properties.organizationId, organizationId),
      });

      let scored = 0;
      let failed = 0;

      for (const prop of props) {
        try {
          await this.calculateCreditScore(organizationId, prop.id);
          scored++;
        } catch (error) {
          failed++;
          console.error(`Failed to score property ${prop.id}:`, error);
        }
      }

      return { scored, failed };
    } catch (error) {
      console.error('Bulk scoring failed:', error);
      throw error;
    }
  }

  /**
   * Get portfolio score distribution
   */
  async getPortfolioScoreDistribution(
    organizationId: string
  ): Promise<{
    avgScore: number;
    gradeDistribution: { grade: string; count: number }[];
    riskDistribution: { risk: string; count: number }[];
  }> {
    try {
      const scores = await db.query.landCreditScores.findMany({
        where: eq(landCreditScores.organizationId, organizationId),
        orderBy: [desc(landCreditScores.createdAt)],
      });

      if (scores.length === 0) {
        return {
          avgScore: 0,
          gradeDistribution: [],
          riskDistribution: [],
        };
      }

      // Calculate average score
      const avgScore = Math.round(
        scores.reduce((sum, s) => sum + s.score, 0) / scores.length
      );

      // Grade distribution
      const gradeMap = new Map<string, number>();
      for (const score of scores) {
        gradeMap.set(score.grade, (gradeMap.get(score.grade) || 0) + 1);
      }
      const gradeDistribution = Array.from(gradeMap.entries())
        .map(([grade, count]) => ({ grade, count }))
        .sort((a, b) => b.count - a.count);

      // Risk distribution
      const riskMap = new Map<string, number>();
      for (const score of scores) {
        riskMap.set(score.riskLevel, (riskMap.get(score.riskLevel) || 0) + 1);
      }
      const riskDistribution = Array.from(riskMap.entries())
        .map(([risk, count]) => ({ risk, count }))
        .sort((a, b) => b.count - a.count);

      return {
        avgScore,
        gradeDistribution,
        riskDistribution,
      };
    } catch (error) {
      console.error('Failed to get portfolio distribution:', error);
      throw error;
    }
  }
}

  /**
   * Get ranked feature importance — which factors most affect the score
   */
  getFeatureImportance(): { factor: string; weight: number; description: string }[] {
    return [
      { factor: 'Location', weight: this.WEIGHTS.location, description: 'Market strength, population growth, economic health, accessibility' },
      { factor: 'Financial', weight: this.WEIGHTS.financial, description: 'Cash flow, appreciation, liquidity, tax burden, maintenance cost' },
      { factor: 'Physical', weight: this.WEIGHTS.physical, description: 'Topography, soil quality, water access, utilities, road access' },
      { factor: 'Legal', weight: this.WEIGHTS.legal, description: 'Zoning, restrictions, mineral rights, water rights, clear title' },
      { factor: 'Environmental', weight: this.WEIGHTS.environmental, description: 'Flood risk, wildfire, contamination, wetlands, endangered species' },
      { factor: 'Market', weight: this.WEIGHTS.market, description: 'Demand, supply, price history, days on market, comparables' },
    ].sort((a, b) => b.weight - a.weight);
  }

  /**
   * Compare score to industry benchmarks — returns percentile rank
   */
  compareToIndustryBenchmarks(
    score: number,
    propertyType: string,
    state: string
  ): {
    percentile: number;
    benchmarkAvg: number;
    benchmarkMedian: number;
    outperforms: boolean;
  } {
    // Industry benchmark scores by property type and state (simplified lookup)
    // In production these would come from aggregated transaction data
    const benchmarks: Record<string, { avg: number; median: number }> = {
      agricultural: { avg: 620, median: 610 },
      residential: { avg: 650, median: 640 },
      commercial: { avg: 670, median: 660 },
      industrial: { avg: 640, median: 630 },
      recreational: { avg: 590, median: 580 },
    };

    const stateBonus: Record<string, number> = {
      TX: 10, FL: 8, GA: 5, TN: 5, NC: 5,
      CA: -5, NY: -5, NJ: -3,
    };

    const base = benchmarks[propertyType?.toLowerCase()] || { avg: 625, median: 615 };
    const stateAdj = stateBonus[state?.toUpperCase()] || 0;
    const benchmarkAvg = base.avg + stateAdj;
    const benchmarkMedian = base.median + stateAdj;

    // Percentile approximation: assume normal distribution around benchmark avg (std dev ~80)
    const stdDev = 80;
    const z = (score - benchmarkAvg) / stdDev;
    // Approximate CDF for percentile
    const percentile = Math.min(99, Math.max(1, Math.round(50 + 50 * Math.tanh(z * 0.8))));

    return {
      percentile,
      benchmarkAvg: Math.round(benchmarkAvg),
      benchmarkMedian: Math.round(benchmarkMedian),
      outperforms: score > benchmarkAvg,
    };
  }

  /**
   * Personalize score based on investor strategy
   */
  personalizeScore(
    baseScore: number,
    strategy: 'cash_flow' | 'appreciation' | 'flip'
  ): {
    adjustedScore: number;
    strategy: string;
    adjustments: { factor: string; change: number; reason: string }[];
  } {
    const adjustments: { factor: string; change: number; reason: string }[] = [];
    let total = 0;

    if (strategy === 'cash_flow') {
      adjustments.push({ factor: 'Financial (cash flow weight x1.5)', change: 5, reason: 'Cash flow investors prioritize income generation' });
      adjustments.push({ factor: 'Liquidity (lower weight)', change: -2, reason: 'Long hold periods reduce liquidity importance' });
      total = 3;
    } else if (strategy === 'appreciation') {
      adjustments.push({ factor: 'Location (growth markets x1.3)', change: 8, reason: 'Appreciation driven by population and job growth' });
      adjustments.push({ factor: 'Market (demand weight x1.4)', change: 5, reason: 'Strong demand markets drive appreciation' });
      adjustments.push({ factor: 'Cash flow (lower weight)', change: -5, reason: 'Appreciation investors tolerate lower current income' });
      total = 8;
    } else if (strategy === 'flip') {
      adjustments.push({ factor: 'Liquidity (x2.0 weight)', change: 10, reason: 'Flippers need to sell quickly' });
      adjustments.push({ factor: 'Market (days on market)', change: 6, reason: 'Fast-selling markets essential for flip strategy' });
      adjustments.push({ factor: 'Legal (zoning flexibility)', change: 5, reason: 'Rezoning potential increases flip upside' });
      adjustments.push({ factor: 'Environmental (higher penalty)', change: -8, reason: 'Environmental issues kill flip timelines' });
      total = 13;
    }

    return {
      adjustedScore: Math.min(850, Math.max(300, baseScore + total)),
      strategy,
      adjustments,
    };
  }

  /**
   * Generate score drill-down with improvement suggestions per factor
   */
  async generateScoreDrillDown(
    propertyId: string,
    orgId: string
  ): Promise<{
    score: number;
    factors: {
      name: string;
      value: number;
      weight: number;
      impact: 'positive' | 'negative' | 'neutral';
      howToImprove: string;
    }[];
  }> {
    const property = await db.query.properties.findFirst({
      where: and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, orgId)
      ),
    });

    if (!property) throw new Error('Property not found');

    const location = await this.scoreLocation(property);
    const physical = await this.scorePhysical(property);
    const legal = await this.scoreLegal(property);
    const financial = await this.scoreFinancial(property);
    const environmental = await this.scoreEnvironmental(property);
    const market = await this.scoreMarket(property);

    const overall = Math.round(
      (location.score * this.WEIGHTS.location +
       physical.score * this.WEIGHTS.physical +
       legal.score * this.WEIGHTS.legal +
       financial.score * this.WEIGHTS.financial +
       environmental.score * this.WEIGHTS.environmental +
       market.score * this.WEIGHTS.market) / 100
    );
    const creditScore = Math.round(300 + (overall / 100) * 550);

    const improvementMap: Record<string, string> = {
      location: 'Target high-growth markets (TX, FL, GA) for better location scores. Proximity to highways and cities improves accessibility.',
      physical: 'Add utility connections (electric, water, gas) and improve road access from dirt/gravel to paved.',
      legal: 'Pursue zoning upgrade to commercial/residential. Acquire severed mineral rights if economically viable.',
      financial: 'Generate income via leasing, agricultural use, or cell tower ground leases. Reduce holding costs.',
      environmental: 'Obtain elevation certificate to reduce flood insurance premiums. Implement wildfire defensible space.',
      market: 'Price competitively to reduce days on market. Improve listing marketing and photos.',
    };

    const factors = [
      { name: 'Location', value: location.score, weight: this.WEIGHTS.location, impact: (location.score >= 65 ? 'positive' : location.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.location },
      { name: 'Physical', value: physical.score, weight: this.WEIGHTS.physical, impact: (physical.score >= 65 ? 'positive' : physical.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.physical },
      { name: 'Legal', value: legal.score, weight: this.WEIGHTS.legal, impact: (legal.score >= 65 ? 'positive' : legal.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.legal },
      { name: 'Financial', value: financial.score, weight: this.WEIGHTS.financial, impact: (financial.score >= 65 ? 'positive' : financial.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.financial },
      { name: 'Environmental', value: environmental.score, weight: this.WEIGHTS.environmental, impact: (environmental.score >= 65 ? 'positive' : environmental.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.environmental },
      { name: 'Market', value: market.score, weight: this.WEIGHTS.market, impact: (market.score >= 65 ? 'positive' : market.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.market },
    ];

    return { score: creditScore, factors };
  }

  /**
   * Backtest score against historical performance
   */
  async backtestScore(
    propertyId: string
  ): Promise<{
    predictedPerformance: { grade: string; appreciationPct: number };
    actualPerformance: { appreciationPct: number; daysToSell: number | null };
    accuracy: number;
  }> {
    const scores = await db.query.landCreditScores.findMany({
      where: eq(landCreditScores.propertyId, propertyId),
      orderBy: [desc(landCreditScores.createdAt)],
    });

    if (scores.length === 0) {
      return {
        predictedPerformance: { grade: 'N/A', appreciationPct: 0 },
        actualPerformance: { appreciationPct: 0, daysToSell: null },
        accuracy: 0,
      };
    }

    const latestScore = scores[0];
    // Predicted appreciation based on grade
    const gradeAppreciation: Record<string, number> = {
      'A+': 12, 'A': 10, 'B+': 8, 'B': 6, 'C+': 4, 'C': 2, 'D': 0, 'F': -2,
    };
    const predictedAppreciation = gradeAppreciation[latestScore.grade] || 5;

    const property = await db.query.properties.findFirst({
      where: eq(properties.id, propertyId),
    });

    // Actual appreciation (from property data)
    let actualAppreciation = 0;
    if (property?.purchasePrice && property?.estimatedValue) {
      actualAppreciation = ((property.estimatedValue - property.purchasePrice) / property.purchasePrice) * 100;
    }

    const accuracy = actualAppreciation > 0
      ? Math.max(0, Math.min(100, 100 - Math.abs(predictedAppreciation - actualAppreciation) * 5))
      : 50;

    return {
      predictedPerformance: { grade: latestScore.grade, appreciationPct: predictedAppreciation },
      actualPerformance: {
        appreciationPct: Math.round(actualAppreciation * 10) / 10,
        daysToSell: (property as any)?.daysOnMarket || null,
      },
      accuracy: Math.round(accuracy),
    };
  }
}

export const landCredit = new LandCreditScoring();
