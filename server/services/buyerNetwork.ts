import { db } from '../db';
import { 
  buyerBehaviorEvents, 
  demandHeatmaps,
  properties 
} from '../../shared/schema';
import { eq, and, desc, gte, sql } from 'drizzle-orm';

interface BuyerBehaviorEvent {
  eventType: 'property_view' | 'search' | 'save_favorite' | 'contact_seller' | 'make_offer' | 'attend_showing';
  propertyId?: string;
  searchCriteria?: {
    minAcres?: number;
    maxAcres?: number;
    minPrice?: number;
    maxPrice?: number;
    state?: string;
    county?: string;
    zoning?: string[];
    features?: string[];
  };
  sessionId: string;
  anonymizedBuyerId: string; // Hash of actual buyer ID
  timestamp: Date;
  metadata?: any;
}

interface DemandHeatmap {
  location: {
    state: string;
    county: string;
    zipCode?: string;
  };
  demandScore: number; // 0-100
  metrics: {
    searchVolume: number;
    viewsPerListing: number;
    avgTimeOnPage: number;
    saveRate: number; // % of views that become favorites
    contactRate: number; // % of views that become contacts
    offerRate: number; // % of contacts that become offers
  };
  buyerProfile: {
    avgBudget: number;
    avgAcreagePreference: number;
    topFeatures: { feature: string; frequency: number }[];
    buyerTypes: { type: string; percentage: number }[];
  };
  trend: 'surging' | 'growing' | 'stable' | 'declining';
  confidence: number; // 0-100
}

class BuyerIntelligenceNetwork {
  /**
   * Track buyer behavior event (anonymized)
   */
  async trackBehaviorEvent(
    organizationId: string,
    event: BuyerBehaviorEvent
  ): Promise<void> {
    try {
      await db.insert(buyerBehaviorEvents).values({
        organizationId,
        eventType: event.eventType,
        propertyId: event.propertyId || null,
        searchCriteria: event.searchCriteria || null,
        sessionId: event.sessionId,
        anonymizedBuyerId: event.anonymizedBuyerId,
        timestamp: event.timestamp,
        metadata: event.metadata || {},
      });

      // Update demand heatmaps asynchronously
      if (event.propertyId) {
        await this.updatePropertyDemand(organizationId, event.propertyId, event.eventType);
      }
    } catch (error) {
      console.error('Failed to track behavior event:', error);
      // Don't throw - tracking should not break user experience
    }
  }

  /**
   * Update property demand metrics
   */
  private async updatePropertyDemand(
    organizationId: string,
    propertyId: string,
    eventType: BuyerBehaviorEvent['eventType']
  ): Promise<void> {
    try {
      // Get property location
      const property = await db.query.properties.findFirst({
        where: and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, organizationId)
        ),
      });

      if (!property || !property.state || !property.county) return;

      // Find or create heatmap for this location
      const existing = await db.query.demandHeatmaps.findFirst({
        where: and(
          eq(demandHeatmaps.organizationId, organizationId),
          sql`${demandHeatmaps.location}->>'state' = ${property.state}`,
          sql`${demandHeatmaps.location}->>'county' = ${property.county}`
        ),
      });

      if (existing) {
        // Update existing heatmap
        const metrics = existing.metrics as any;
        
        // Increment relevant metric
        if (eventType === 'property_view') {
          metrics.searchVolume = (metrics.searchVolume || 0) + 1;
        } else if (eventType === 'save_favorite') {
          metrics.saveRate = (metrics.saveRate || 0) + 1;
        } else if (eventType === 'contact_seller') {
          metrics.contactRate = (metrics.contactRate || 0) + 1;
        } else if (eventType === 'make_offer') {
          metrics.offerRate = (metrics.offerRate || 0) + 1;
        }

        await db.update(demandHeatmaps)
          .set({
            metrics,
            lastUpdated: new Date(),
          })
          .where(eq(demandHeatmaps.id, existing.id));
      } else {
        // Create new heatmap
        const initialMetrics = {
          searchVolume: eventType === 'property_view' ? 1 : 0,
          viewsPerListing: 0,
          avgTimeOnPage: 0,
          saveRate: eventType === 'save_favorite' ? 1 : 0,
          contactRate: eventType === 'contact_seller' ? 1 : 0,
          offerRate: eventType === 'make_offer' ? 1 : 0,
        };

        await db.insert(demandHeatmaps).values({
          organizationId,
          location: {
            state: property.state,
            county: property.county,
            zipCode: property.zipCode || undefined,
          },
          demandScore: 50, // Start at neutral
          metrics: initialMetrics,
          buyerProfile: {
            avgBudget: 0,
            avgAcreagePreference: 0,
            topFeatures: [],
            buyerTypes: [],
          },
          trend: 'stable',
          confidence: 30, // Low confidence initially
          lastUpdated: new Date(),
        });
      }
    } catch (error) {
      console.error('Failed to update property demand:', error);
    }
  }

  /**
   * Calculate demand heatmap for a location
   */
  async calculateDemandHeatmap(
    organizationId: string,
    state: string,
    county: string
  ): Promise<DemandHeatmap> {
    try {
      // Get all behavior events for this location in last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const events = await db.query.buyerBehaviorEvents.findMany({
        where: and(
          eq(buyerBehaviorEvents.organizationId, organizationId),
          gte(buyerBehaviorEvents.timestamp, ninetyDaysAgo)
        ),
      });

      // Filter events for properties in this location
      const properties = await db.query.properties.findMany({
        where: and(
          eq(properties.organizationId, organizationId),
          eq(properties.state, state),
          eq(properties.county, county)
        ),
      });
      const propertyIds = new Set(properties.map(p => p.id));
      const relevantEvents = events.filter(e => e.propertyId && propertyIds.has(e.propertyId));

      // Calculate metrics
      const views = relevantEvents.filter(e => e.eventType === 'property_view');
      const saves = relevantEvents.filter(e => e.eventType === 'save_favorite');
      const contacts = relevantEvents.filter(e => e.eventType === 'contact_seller');
      const offers = relevantEvents.filter(e => e.eventType === 'make_offer');

      const metrics = {
        searchVolume: views.length,
        viewsPerListing: properties.length > 0 ? views.length / properties.length : 0,
        avgTimeOnPage: 0, // Would calculate from session data
        saveRate: views.length > 0 ? (saves.length / views.length) * 100 : 0,
        contactRate: views.length > 0 ? (contacts.length / views.length) * 100 : 0,
        offerRate: contacts.length > 0 ? (offers.length / contacts.length) * 100 : 0,
      };

      // Analyze buyer profiles
      const searchEvents = events.filter(e => e.eventType === 'search' && e.searchCriteria);
      const budgets = searchEvents
        .map(e => e.searchCriteria?.maxPrice)
        .filter(p => p !== undefined) as number[];
      const acreages = searchEvents
        .map(e => e.searchCriteria?.maxAcres)
        .filter(a => a !== undefined) as number[];

      const buyerProfile = {
        avgBudget: budgets.length > 0 ? budgets.reduce((sum, b) => sum + b, 0) / budgets.length : 0,
        avgAcreagePreference: acreages.length > 0 ? acreages.reduce((sum, a) => sum + a, 0) / acreages.length : 0,
        topFeatures: this.extractTopFeatures(searchEvents),
        buyerTypes: this.classifyBuyerTypes(searchEvents),
      };

      // Calculate demand score (0-100)
      const demandScore = this.calculateDemandScore(metrics, buyerProfile);

      // Determine trend
      const trend = await this.calculateTrend(organizationId, state, county);

      // Calculate confidence based on sample size
      const confidence = Math.min(95, 30 + Math.log10(Math.max(1, relevantEvents.length)) * 20);

      // Save heatmap
      await db.insert(demandHeatmaps).values({
        organizationId,
        location: { state, county },
        demandScore,
        metrics,
        buyerProfile,
        trend,
        confidence: Math.round(confidence),
        lastUpdated: new Date(),
      });

      return {
        location: { state, county },
        demandScore,
        metrics,
        buyerProfile,
        trend,
        confidence: Math.round(confidence),
      };
    } catch (error) {
      console.error('Failed to calculate demand heatmap:', error);
      throw error;
    }
  }

  /**
   * Calculate demand score (0-100)
   */
  private calculateDemandScore(metrics: DemandHeatmap['metrics'], profile: DemandHeatmap['buyerProfile']): number {
    let score = 50; // Start at neutral

    // Search volume impact (0-20 points)
    if (metrics.searchVolume > 100) score += 20;
    else if (metrics.searchVolume > 50) score += 15;
    else if (metrics.searchVolume > 20) score += 10;
    else if (metrics.searchVolume > 10) score += 5;
    else if (metrics.searchVolume < 5) score -= 10;

    // Views per listing impact (0-15 points)
    if (metrics.viewsPerListing > 20) score += 15;
    else if (metrics.viewsPerListing > 10) score += 10;
    else if (metrics.viewsPerListing > 5) score += 5;
    else if (metrics.viewsPerListing < 2) score -= 5;

    // Save rate impact (0-15 points)
    if (metrics.saveRate > 20) score += 15;
    else if (metrics.saveRate > 10) score += 10;
    else if (metrics.saveRate > 5) score += 5;
    else if (metrics.saveRate < 2) score -= 5;

    // Contact rate impact (0-20 points)
    if (metrics.contactRate > 15) score += 20;
    else if (metrics.contactRate > 10) score += 15;
    else if (metrics.contactRate > 5) score += 10;
    else if (metrics.contactRate > 2) score += 5;

    // Offer rate impact (0-20 points)
    if (metrics.offerRate > 50) score += 20;
    else if (metrics.offerRate > 30) score += 15;
    else if (metrics.offerRate > 15) score += 10;
    else if (metrics.offerRate > 5) score += 5;

    // Buyer profile impact (0-10 points)
    if (profile.avgBudget > 0) score += 5; // Serious buyers with budget
    if (profile.topFeatures.length > 3) score += 5; // Specific preferences

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Extract top features from search criteria
   */
  private extractTopFeatures(searchEvents: any[]): { feature: string; frequency: number }[] {
    const featureMap = new Map<string, number>();

    for (const event of searchEvents) {
      const features = event.searchCriteria?.features || [];
      for (const feature of features) {
        featureMap.set(feature, (featureMap.get(feature) || 0) + 1);
      }
    }

    return Array.from(featureMap.entries())
      .map(([feature, frequency]) => ({ feature, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
  }

  /**
   * Classify buyer types based on search patterns
   */
  private classifyBuyerTypes(searchEvents: any[]): { type: string; percentage: number }[] {
    const types = {
      'First-Time Buyer': 0,
      'Investor': 0,
      'Developer': 0,
      'Recreational': 0,
      'Agricultural': 0,
    };

    for (const event of searchEvents) {
      const criteria = event.searchCriteria;
      if (!criteria) continue;

      // Classify based on patterns
      if (criteria.minAcres < 5 && criteria.maxPrice < 100000) {
        types['First-Time Buyer']++;
      } else if (criteria.minAcres > 20 && criteria.features?.includes('income_potential')) {
        types['Investor']++;
      } else if (criteria.features?.includes('subdividable') || criteria.zoning?.includes('residential')) {
        types['Developer']++;
      } else if (criteria.features?.includes('hunting') || criteria.features?.includes('recreation')) {
        types['Recreational']++;
      } else if (criteria.features?.includes('tillable') || criteria.zoning?.includes('agricultural')) {
        types['Agricultural']++;
      }
    }

    const total = Object.values(types).reduce((sum, count) => sum + count, 0);
    if (total === 0) return [];

    return Object.entries(types)
      .map(([type, count]) => ({
        type,
        percentage: Math.round((count / total) * 100),
      }))
      .filter(t => t.percentage > 0)
      .sort((a, b) => b.percentage - a.percentage);
  }

  /**
   * Calculate trend direction
   */
  private async calculateTrend(
    organizationId: string,
    state: string,
    county: string
  ): Promise<DemandHeatmap['trend']> {
    try {
      // Get events from last 90 days vs previous 90 days
      const now = new Date();
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const oneEightyDaysAgo = new Date(now);
      oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);

      const recentEvents = await db.query.buyerBehaviorEvents.findMany({
        where: and(
          eq(buyerBehaviorEvents.organizationId, organizationId),
          gte(buyerBehaviorEvents.timestamp, ninetyDaysAgo)
        ),
      });

      const previousEvents = await db.query.buyerBehaviorEvents.findMany({
        where: and(
          eq(buyerBehaviorEvents.organizationId, organizationId),
          gte(buyerBehaviorEvents.timestamp, oneEightyDaysAgo),
          sql`${buyerBehaviorEvents.timestamp} < ${ninetyDaysAgo}`
        ),
      });

      const recentCount = recentEvents.length;
      const previousCount = previousEvents.length;

      if (previousCount === 0) return 'stable';

      const change = ((recentCount - previousCount) / previousCount) * 100;

      if (change > 50) return 'surging';
      if (change > 20) return 'growing';
      if (change < -20) return 'declining';
      return 'stable';
    } catch (error) {
      console.error('Failed to calculate trend:', error);
      return 'stable';
    }
  }

  /**
   * Get demand heatmap for location
   */
  async getDemandHeatmap(
    organizationId: string,
    state: string,
    county: string
  ): Promise<DemandHeatmap | null> {
    try {
      const heatmap = await db.query.demandHeatmaps.findFirst({
        where: and(
          eq(demandHeatmaps.organizationId, organizationId),
          sql`${demandHeatmaps.location}->>'state' = ${state}`,
          sql`${demandHeatmaps.location}->>'county' = ${county}`
        ),
        orderBy: [desc(demandHeatmaps.lastUpdated)],
      });

      if (!heatmap) return null;

      return {
        location: heatmap.location as any,
        demandScore: heatmap.demandScore,
        metrics: heatmap.metrics as any,
        buyerProfile: heatmap.buyerProfile as any,
        trend: heatmap.trend as any,
        confidence: heatmap.confidence,
      };
    } catch (error) {
      console.error('Failed to get demand heatmap:', error);
      return null;
    }
  }

  /**
   * Get all heatmaps sorted by demand score
   */
  async getTopDemandLocations(
    organizationId: string,
    limit: number = 20
  ): Promise<DemandHeatmap[]> {
    try {
      const heatmaps = await db.query.demandHeatmaps.findMany({
        where: eq(demandHeatmaps.organizationId, organizationId),
        orderBy: [desc(demandHeatmaps.demandScore)],
        limit,
      });

      return heatmaps.map(h => ({
        location: h.location as any,
        demandScore: h.demandScore,
        metrics: h.metrics as any,
        buyerProfile: h.buyerProfile as any,
        trend: h.trend as any,
        confidence: h.confidence,
      }));
    } catch (error) {
      console.error('Failed to get top demand locations:', error);
      return [];
    }
  }

  /**
   * Get buyer insights for property
   */
  async getPropertyBuyerInsights(
    organizationId: string,
    propertyId: string
  ): Promise<{
    totalViews: number;
    uniqueViewers: number;
    avgViewDuration: number;
    saveCount: number;
    contactCount: number;
    offerCount: number;
    competitorViews: number; // Views on similar properties
    demandScore: number;
  }> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const events = await db.query.buyerBehaviorEvents.findMany({
        where: and(
          eq(buyerBehaviorEvents.organizationId, organizationId),
          eq(buyerBehaviorEvents.propertyId, propertyId),
          gte(buyerBehaviorEvents.timestamp, thirtyDaysAgo)
        ),
      });

      const views = events.filter(e => e.eventType === 'property_view');
      const uniqueViewers = new Set(events.map(e => e.anonymizedBuyerId)).size;
      const saves = events.filter(e => e.eventType === 'save_favorite');
      const contacts = events.filter(e => e.eventType === 'contact_seller');
      const offers = events.filter(e => e.eventType === 'make_offer');

      // Calculate demand score
      const saveRate = views.length > 0 ? (saves.length / views.length) * 100 : 0;
      const contactRate = views.length > 0 ? (contacts.length / views.length) * 100 : 0;
      const demandScore = Math.min(100, Math.round(
        views.length * 2 + 
        saveRate * 3 + 
        contactRate * 5 + 
        offers.length * 10
      ));

      return {
        totalViews: views.length,
        uniqueViewers,
        avgViewDuration: 0, // Would calculate from session data
        saveCount: saves.length,
        contactCount: contacts.length,
        offerCount: offers.length,
        competitorViews: 0, // Would calculate from similar properties
        demandScore,
      };
    } catch (error) {
      console.error('Failed to get property buyer insights:', error);
      throw error;
    }
  }

  /**
   * Refresh all heatmaps for organization
   */
  async refreshAllHeatmaps(organizationId: string): Promise<{ updated: number; failed: number }> {
    try {
      // Get unique locations from properties
      const properties = await db.query.properties.findMany({
        where: eq(properties.organizationId, organizationId),
      });

      const locations = new Set<string>();
      for (const prop of properties) {
        if (prop.state && prop.county) {
          locations.add(`${prop.state}|${prop.county}`);
        }
      }

      let updated = 0;
      let failed = 0;

      for (const loc of locations) {
        const [state, county] = loc.split('|');
        try {
          await this.calculateDemandHeatmap(organizationId, state, county);
          updated++;
        } catch (error) {
          failed++;
          console.error(`Failed to refresh heatmap for ${loc}:`, error);
        }
      }

      return { updated, failed };
    } catch (error) {
      console.error('Failed to refresh heatmaps:', error);
      throw error;
    }
  }

  /**
   * Get trending searches
   */
  async getTrendingSearches(
    organizationId: string,
    days: number = 7
  ): Promise<{
    criteria: any;
    frequency: number;
    trend: 'up' | 'down' | 'stable';
  }[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const searches = await db.query.buyerBehaviorEvents.findMany({
        where: and(
          eq(buyerBehaviorEvents.organizationId, organizationId),
          eq(buyerBehaviorEvents.eventType, 'search'),
          gte(buyerBehaviorEvents.timestamp, cutoffDate)
        ),
        orderBy: [desc(buyerBehaviorEvents.timestamp)],
      });

      // Group similar searches
      const searchMap = new Map<string, number>();
      for (const search of searches) {
        const key = JSON.stringify(search.searchCriteria);
        searchMap.set(key, (searchMap.get(key) || 0) + 1);
      }

      const trending = Array.from(searchMap.entries())
        .map(([key, frequency]) => ({
          criteria: JSON.parse(key),
          frequency,
          trend: 'stable' as const, // Would compare to previous period
        }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10);

      return trending;
    } catch (error) {
      console.error('Failed to get trending searches:', error);
      return [];
    }
  }
}

export const buyerNetwork = new BuyerIntelligenceNetwork();
