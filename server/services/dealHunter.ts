import { db } from "../db";
import { storage } from "../storage";
import {
  scrapedDeals,
  dealSources,
  autoBidRules,
  dealAlerts,
  leads,
  properties,
  type InsertScrapedDeal,
  type InsertDealSource,
  type InsertDealAlert,
} from "@shared/schema";
import { eq, and, desc, gte, lte, inArray, sql } from "drizzle-orm";
import { browserAutomationService } from "./browserAutomation";

export class DealHunterService {
  
  /**
   * Register a new deal source (county website, auction site, etc.)
   */
  async registerSource(data: {
    name: string;
    sourceType: string;
    state: string;
    county?: string;
    baseUrl: string;
    scrapingConfig: any;
    priority?: number;
  }) {
    const [source] = await db.insert(dealSources).values({
      name: data.name,
      sourceType: data.sourceType,
      state: data.state,
      county: data.county,
      baseUrl: data.baseUrl,
      scrapingConfig: data.scrapingConfig,
      priority: data.priority || 50,
      isActive: true,
      consecutiveFailures: 0,
    }).returning();
    
    return source;
  }
  
  /**
   * Scrape a specific deal source
   */
  async scrapeSource(sourceId: number) {
    const [source] = await db.select()
      .from(dealSources)
      .where(eq(dealSources.id, sourceId))
      .limit(1);
    
    if (!source) {
      throw new Error("Deal source not found");
    }
    
    if (!source.isActive) {
      return { success: false, reason: "Source is inactive" };
    }
    
    try {
      const deals = await this.performScrape(source);
      
      // Save scraped deals
      for (const deal of deals) {
        await this.saveDeal(deal);
      }
      
      // Update source stats
      await db.update(dealSources)
        .set({
          lastScraped: new Date(),
          lastSuccessful: new Date(),
          consecutiveFailures: 0,
          totalDealsFound: sql`${dealSources.totalDealsFound} + ${deals.length}`,
          avgDealsPerScrape: sql`(COALESCE(${dealSources.avgDealsPerScrape}, 0) * 0.8 + ${deals.length} * 0.2)`,
        })
        .where(eq(dealSources.id, sourceId));
      
      return { success: true, dealsFound: deals.length };
    } catch (error: any) {
      // Update failure count
      await db.update(dealSources)
        .set({
          lastScraped: new Date(),
          consecutiveFailures: sql`${dealSources.consecutiveFailures} + 1`,
        })
        .where(eq(dealSources.id, sourceId));
      
      // Disable if too many failures
      const updated = await db.select()
        .from(dealSources)
        .where(eq(dealSources.id, sourceId))
        .limit(1);
      
      if (updated[0] && updated[0].consecutiveFailures >= 5) {
        await db.update(dealSources)
          .set({ isActive: false })
          .where(eq(dealSources.id, sourceId));
      }
      
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Perform actual scraping based on source configuration
   */
  private async performScrape(source: any): Promise<any[]> {
    const { scrapingConfig } = source;
    
    if (scrapingConfig.scraperType === "puppeteer") {
      return await this.scrapePuppeteer(source);
    } else if (scrapingConfig.scraperType === "api") {
      return await this.scrapeAPI(source);
    } else {
      throw new Error(`Unsupported scraper type: ${scrapingConfig.scraperType}`);
    }
  }
  
  /**
   * Scrape using Puppeteer for dynamic websites
   * NOTE: Requires a configured Puppeteer/browser automation service.
   * Returns empty results until a browser automation endpoint is configured.
   */
  private async scrapePuppeteer(source: any): Promise<any[]> {
    console.warn(
      `[DealHunter] Puppeteer scraping not configured for source ${source.id} (${source.baseUrl}). ` +
      `Configure a browser automation service to enable live scraping.`
    );
    return [];
  }
  
  /**
   * Scrape using API for structured data sources
   */
  private async scrapeAPI(source: any): Promise<any[]> {
    const { scrapingConfig } = source;
    const deals: any[] = [];
    
    // Make API request
    const response = await fetch(scrapingConfig.apiEndpoint, {
      method: "GET",
      headers: {
        ...scrapingConfig.customHeaders,
        "Authorization": scrapingConfig.apiKey ? `Bearer ${scrapingConfig.apiKey}` : undefined,
      },
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Transform API data to deal format
    // This would be customized based on the API structure
    
    return deals;
  }
  
  /**
   * Save a scraped deal
   */
  private async saveDeal(dealData: any) {
    // Check for duplicates
    const existing = await db.select()
      .from(scrapedDeals)
      .where(and(
        eq(scrapedDeals.apn, dealData.apn || ""),
        eq(scrapedDeals.state, dealData.state),
        eq(scrapedDeals.county, dealData.county)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      // Update existing deal
      await db.update(scrapedDeals)
        .set({
          ...dealData,
          lastVerified: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(scrapedDeals.id, existing[0].id));
      
      return existing[0].id;
    }
    
    // Calculate distress score
    const distressScore = this.calculateDistressScore(dealData);
    
    // Create new deal
    const [saved] = await db.insert(scrapedDeals).values({
      ...dealData,
      distressScore,
      status: "new",
      scrapedAt: new Date(),
    }).returning();
    
    // Check for matching auto-bid rules
    await this.checkAutoBidRules(saved);
    
    return saved.id;
  }
  
  /**
   * Calculate distress score (0-100) based on multiple factors
   */
  private calculateDistressScore(dealData: any): number {
    let score = 0;
    
    const factors: any = {};
    
    // Tax delinquency
    if (dealData.taxesOwed > 0) {
      factors.taxDelinquent = true;
      score += 25;
      
      // Years delinquent (estimate based on tax amount)
      const estimatedYears = Math.floor(dealData.taxesOwed / 500);
      if (estimatedYears > 3) {
        factors.yearsDelinquent = estimatedYears;
        score += Math.min(20, estimatedYears * 5);
      }
    }
    
    // Foreclosure
    if (dealData.sourceType === "foreclosure") {
      factors.foreclosureStage = "active";
      score += 30;
    }
    
    // Probate
    if (dealData.sourceType === "probate") {
      factors.probateStatus = "active";
      score += 20;
    }
    
    // Vacant land (no improvements)
    if (!dealData.improvements || dealData.improvements === 0) {
      factors.vacantLand = true;
      score += 10;
    }
    
    // Corporate owner (often more motivated)
    if (dealData.ownerType === "corporate" || dealData.ownerType === "llc") {
      score += 10;
    }
    
    // Estate owner
    if (dealData.ownerType === "estate") {
      score += 15;
    }
    
    // Absentee owner (different state)
    if (dealData.ownerAddress && !dealData.ownerAddress.includes(dealData.state)) {
      factors.absenteeOwner = true;
      score += 15;
    }
    
    dealData.distressFactors = factors;
    
    return Math.min(100, score);
  }
  
  /**
   * Check if deal matches any auto-bid rules
   */
  private async checkAutoBidRules(deal: any) {
    const rules = await db.select()
      .from(autoBidRules)
      .where(eq(autoBidRules.isActive, true));
    
    for (const rule of rules) {
      if (this.dealMatchesRule(deal, rule)) {
        await this.createDealAlert(deal, rule);
        
        // Auto-bid if enabled and no approval required
        if (!rule.requiresApproval && rule.maxBidAmount) {
          await this.placeAutoBid(deal, rule);
        }
      }
    }
  }
  
  /**
   * Check if deal matches auto-bid rule criteria
   */
  private dealMatchesRule(deal: any, rule: any): boolean {
    // Geographic filters
    if (rule.states && !rule.states.includes(deal.state)) {
      return false;
    }
    
    if (rule.counties && !rule.counties.includes(deal.county)) {
      return false;
    }
    
    // Property size filters
    if (rule.minAcres && deal.sizeAcres < parseFloat(rule.minAcres)) {
      return false;
    }
    
    if (rule.maxAcres && deal.sizeAcres > parseFloat(rule.maxAcres)) {
      return false;
    }
    
    // Distress criteria
    if (rule.minDistressScore && deal.distressScore < rule.minDistressScore) {
      return false;
    }
    
    if (rule.requireTaxDelinquent && !deal.distressFactors?.taxDelinquent) {
      return false;
    }
    
    // Budget check
    const bidAmount = this.calculateBidAmount(deal, rule);
    if (bidAmount > parseFloat(rule.maxBidAmount)) {
      return false;
    }
    
    // Monthly budget check
    if (rule.monthlyBudget) {
      const monthlySpent = parseFloat(rule.currentMonthSpent || "0");
      if (monthlySpent + bidAmount > parseFloat(rule.monthlyBudget)) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Calculate bid amount based on strategy
   */
  private calculateBidAmount(deal: any, rule: any): number {
    const strategy = rule.bidStrategy;
    
    if (strategy === "fixed_amount") {
      return parseFloat(rule.maxBidAmount);
    }
    
    if (strategy === "percentage_of_value") {
      const value = deal.assessedValue || deal.minimumBid || 0;
      const percentage = parseFloat(rule.bidPercentage || "50") / 100;
      return value * percentage;
    }
    
    if (strategy === "incremental") {
      const minimumBid = deal.minimumBid || 0;
      const increment = parseFloat(rule.incrementAmount || "100");
      return minimumBid + increment;
    }
    
    return deal.minimumBid || 0;
  }
  
  /**
   * Create deal alert for matching opportunity
   */
  private async createDealAlert(deal: any, rule: any) {
    const bidAmount = this.calculateBidAmount(deal, rule);
    
    const message = `New ${deal.sourceType} opportunity in ${deal.county}, ${deal.state}: ${deal.sizeAcres} acres. Distress Score: ${deal.distressScore}/100. Suggested Bid: $${bidAmount.toLocaleString()}`;
    
    await db.insert(dealAlerts).values({
      organizationId: rule.organizationId,
      scrapedDealId: deal.id,
      autoBidRuleId: rule.id,
      alertType: "match",
      priority: deal.distressScore > 70 ? "high" : "medium",
      message,
      actionRequired: rule.requiresApproval,
      actionUrl: `/deals/${deal.id}`,
    });
  }
  
  /**
   * Place an automatic bid
   */
  private async placeAutoBid(deal: any, rule: any) {
    const bidAmount = this.calculateBidAmount(deal, rule);
    
    // Record bid
    // In production, would integrate with auction platforms
    
    // Update rule stats
    await db.update(autoBidRules)
      .set({
        bidsPlaced: sql`${autoBidRules.bidsPlaced} + 1`,
        currentMonthSpent: sql`${autoBidRules.currentMonthSpent} + ${bidAmount}`,
        totalSpent: sql`${autoBidRules.totalSpent} + ${bidAmount}`,
      })
      .where(eq(autoBidRules.id, rule.id));
    
    // Create alert
    await db.insert(dealAlerts).values({
      organizationId: rule.organizationId,
      scrapedDealId: deal.id,
      autoBidRuleId: rule.id,
      alertType: "bid_placed",
      priority: "high",
      message: `Auto-bid placed: $${bidAmount.toLocaleString()} on ${deal.county}, ${deal.state} property`,
      actionRequired: false,
    });
  }
  
  /**
   * Get scraped deals with filters
   */
  async getDeals(filters: {
    status?: string;
    sourceType?: string;
    states?: string[];
    minDistressScore?: number;
    limit?: number;
    offset?: number;
  }) {
    let query = db.select().from(scrapedDeals);
    
    const conditions: any[] = [];
    
    if (filters.status) {
      conditions.push(eq(scrapedDeals.status, filters.status));
    }
    
    if (filters.sourceType) {
      conditions.push(eq(scrapedDeals.sourceType, filters.sourceType));
    }
    
    if (filters.states && filters.states.length > 0) {
      conditions.push(inArray(scrapedDeals.state, filters.states));
    }
    
    if (filters.minDistressScore) {
      conditions.push(gte(scrapedDeals.distressScore, filters.minDistressScore));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    query = query
      .orderBy(desc(scrapedDeals.distressScore), desc(scrapedDeals.scrapedAt)) as any;
    
    if (filters.limit) {
      query = query.limit(filters.limit) as any;
    }
    
    if (filters.offset) {
      query = query.offset(filters.offset) as any;
    }
    
    return await query;
  }
  
  /**
   * Convert scraped deal to lead
   */
  async convertToLead(organizationId: number, dealId: number) {
    const [deal] = await db.select()
      .from(scrapedDeals)
      .where(eq(scrapedDeals.id, dealId))
      .limit(1);
    
    if (!deal) {
      throw new Error("Deal not found");
    }
    
    // Create lead
    const [lead] = await db.insert(leads).values({
      organizationId,
      type: "seller",
      firstName: deal.ownerName?.split(" ")[0] || "Unknown",
      lastName: deal.ownerName?.split(" ").slice(1).join(" ") || "Owner",
      address: deal.ownerAddress || deal.address,
      city: deal.city,
      state: deal.state,
      zip: deal.zip,
      status: "new",
      source: `deal_hunter_${deal.sourceType}`,
      notes: `Distress Score: ${deal.distressScore}/100\nSource: ${deal.sourceType}\nTaxes Owed: $${deal.taxesOwed || 0}`,
      score: deal.distressScore,
    }).returning();
    
    // Update deal status
    await db.update(scrapedDeals)
      .set({
        status: "added_to_crm",
        convertedToLeadId: lead.id,
      })
      .where(eq(scrapedDeals.id, dealId));
    
    return lead;
  }
  
  /**
   * Convert scraped deal to property
   */
  async convertToProperty(organizationId: number, dealId: number) {
    const [deal] = await db.select()
      .from(scrapedDeals)
      .where(eq(scrapedDeals.id, dealId))
      .limit(1);
    
    if (!deal) {
      throw new Error("Deal not found");
    }
    
    // Create property
    const [property] = await db.insert(properties).values({
      organizationId,
      apn: deal.apn,
      address: deal.address,
      city: deal.city,
      county: deal.county,
      state: deal.state,
      zip: deal.zip,
      sizeAcres: deal.sizeAcres,
      zoning: deal.zoning,
      listPrice: deal.minimumBid,
      marketValue: deal.assessedValue,
      status: "prospect",
      acquisitionPrice: deal.minimumBid,
      notes: `From Deal Hunter: ${deal.sourceType}\nDistress Score: ${deal.distressScore}/100`,
    }).returning();
    
    // Update deal status
    await db.update(scrapedDeals)
      .set({
        status: "added_to_crm",
        convertedToPropertyId: property.id,
      })
      .where(eq(scrapedDeals.id, dealId));
    
    return property;
  }
  
  /**
   * Get deal hunter statistics
   */
  async getStats() {
    const totalDeals = await db.select({ count: sql<number>`count(*)` })
      .from(scrapedDeals);
    
    const newDeals = await db.select({ count: sql<number>`count(*)` })
      .from(scrapedDeals)
      .where(eq(scrapedDeals.status, "new"));
    
    const highQuality = await db.select({ count: sql<number>`count(*)` })
      .from(scrapedDeals)
      .where(gte(scrapedDeals.distressScore, 70));
    
    const converted = await db.select({ count: sql<number>`count(*)` })
      .from(scrapedDeals)
      .where(eq(scrapedDeals.status, "added_to_crm"));
    
    return {
      totalDeals: totalDeals[0]?.count || 0,
      newDeals: newDeals[0]?.count || 0,
      highQualityDeals: highQuality[0]?.count || 0,
      convertedDeals: converted[0]?.count || 0,
    };
  }
  
  /**
   * Scrape all active sources (background job)
   */
  async scrapeAllActiveSources() {
    const sources = await db.select()
      .from(dealSources)
      .where(eq(dealSources.isActive, true))
      .orderBy(desc(dealSources.priority));
    
    const results = [];
    for (const source of sources) {
      const result = await this.scrapeSource(source.id);
      results.push({ sourceId: source.id, name: source.name, ...result });
    }
    
    return results;
  }
}

export const dealHunterService = new DealHunterService();
