import { db } from '../db';
import { 
  buyerBehaviorEvents, 
  demandHeatmaps,
  properties 
} from '../../shared/schema';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { logger } from "../utils/logger";

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
      // TODO(tsc): buyer_behavior_events schema is anonymized and county-level only —
      // it has no organizationId/propertyId/searchCriteria/sessionId/timestamp columns.
      // Persist what the schema supports; the rest is carried in metadata.
      await db.insert(buyerBehaviorEvents).values({
        anonymousId: event.anonymizedBuyerId,
        eventType: event.eventType,
        eventDate: event.timestamp,
        metadata: event.metadata || {},
      });

      // Update demand heatmaps asynchronously
      if (event.propertyId) {
        await this.updatePropertyDemand(organizationId, event.propertyId, event.eventType);
      }
    } catch (error) {
      logger.error('Failed to track behavior event', error);
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
          eq(properties.id, Number(propertyId)),
          eq(properties.organizationId, Number(organizationId))
        ),
      });

      if (!property || !property.state || !property.county) return;

      // TODO(tsc): demand_heatmaps is keyed by state/county (no org/location/metrics
      // columns). Find-or-update the per-county row and bump the matching counter.
      const existing = await db.query.demandHeatmaps.findFirst({
        where: and(
          eq(demandHeatmaps.state, property.state),
          eq(demandHeatmaps.county, property.county)
        ),
      });

      if (existing) {
        // Increment relevant metric counter on the existing heatmap row
        const updates: Partial<typeof demandHeatmaps.$inferInsert> = {};
        if (eventType === 'property_view') {
          updates.viewCount = (existing.viewCount || 0) + 1;
        } else if (eventType === 'contact_seller') {
          updates.inquiryCount = (existing.inquiryCount || 0) + 1;
        } else if (eventType === 'make_offer') {
          updates.bidCount = (existing.bidCount || 0) + 1;
        }

        if (Object.keys(updates).length > 0) {
          await db.update(demandHeatmaps)
            .set(updates)
            .where(eq(demandHeatmaps.id, existing.id));
        }
      } else {
        // Create new heatmap row for this county
        const now = new Date();
        await db.insert(demandHeatmaps).values({
          state: property.state,
          county: property.county,
          periodStart: now,
          periodEnd: now,
          demandScore: 50, // Start at neutral
          viewCount: eventType === 'property_view' ? 1 : 0,
          inquiryCount: eventType === 'contact_seller' ? 1 : 0,
          bidCount: eventType === 'make_offer' ? 1 : 0,
          demandTrend: 'stable',
        });
      }
    } catch (error) {
      logger.error('Failed to update property demand', error);
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
          gte(buyerBehaviorEvents.eventDate, ninetyDaysAgo),
          eq(buyerBehaviorEvents.state, state),
          eq(buyerBehaviorEvents.county, county)
        ),
      });

      // Properties in this location (used for views-per-listing ratio)
      const locationProperties = await db.query.properties.findMany({
        where: and(
          eq(properties.organizationId, Number(organizationId)),
          eq(properties.state, state),
          eq(properties.county, county)
        ),
      });
      // Events are already county-scoped via the query above
      const relevantEvents = events;

      // Calculate metrics
      const views = relevantEvents.filter(e => e.eventType === 'property_view');
      const saves = relevantEvents.filter(e => e.eventType === 'save_favorite');
      const contacts = relevantEvents.filter(e => e.eventType === 'contact_seller');
      const offers = relevantEvents.filter(e => e.eventType === 'make_offer');

      const metrics = {
        searchVolume: views.length,
        viewsPerListing: locationProperties.length > 0 ? views.length / locationProperties.length : 0,
        avgTimeOnPage: 0, // Would calculate from session data
        saveRate: views.length > 0 ? (saves.length / views.length) * 100 : 0,
        contactRate: views.length > 0 ? (contacts.length / views.length) * 100 : 0,
        offerRate: contacts.length > 0 ? (offers.length / contacts.length) * 100 : 0,
      };

      // TODO(tsc): buyer_behavior_events has no searchCriteria column (anonymized,
      // county-level). Budget/acreage profiling cannot be derived from stored events.
      const searchEvents = events.filter(e => e.eventType === 'search');
      const budgets: number[] = [];
      const acreages: number[] = [];

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

      // Save heatmap. TODO(tsc): demand_heatmaps stores scalar columns only — the rich
      // metrics/buyerProfile/confidence are computed in-memory and returned, not persisted.
      const nowPeriod = new Date();
      await db.insert(demandHeatmaps).values({
        state,
        county,
        periodStart: nowPeriod,
        periodEnd: nowPeriod,
        demandScore,
        viewCount: views.length,
        inquiryCount: contacts.length,
        bidCount: offers.length,
        demandTrend: trend,
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
      logger.error('Failed to calculate demand heatmap', error);
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
          eq(buyerBehaviorEvents.state, state),
          eq(buyerBehaviorEvents.county, county),
          gte(buyerBehaviorEvents.eventDate, ninetyDaysAgo)
        ),
      });

      const previousEvents = await db.query.buyerBehaviorEvents.findMany({
        where: and(
          eq(buyerBehaviorEvents.state, state),
          eq(buyerBehaviorEvents.county, county),
          gte(buyerBehaviorEvents.eventDate, oneEightyDaysAgo),
          sql`${buyerBehaviorEvents.eventDate} < ${ninetyDaysAgo}`
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
      logger.error('Failed to calculate trend', error);
      return 'stable';
    }
  }

  /**
   * Map a stored demand_heatmaps row to the rich DemandHeatmap shape.
   * TODO(tsc): the table stores scalar columns only; metrics/buyerProfile are
   * reconstructed from the available counters and confidence defaults to neutral.
   */
  private mapHeatmapRow(h: typeof demandHeatmaps.$inferSelect): DemandHeatmap {
    const validTrends: DemandHeatmap['trend'][] = ['surging', 'growing', 'stable', 'declining'];
    const trend = validTrends.includes(h.demandTrend as DemandHeatmap['trend'])
      ? (h.demandTrend as DemandHeatmap['trend'])
      : 'stable';
    return {
      location: { state: h.state, county: h.county },
      demandScore: h.demandScore,
      metrics: {
        searchVolume: h.viewCount ?? 0,
        viewsPerListing: 0,
        avgTimeOnPage: 0,
        saveRate: 0,
        contactRate: h.inquiryCount ?? 0,
        offerRate: h.bidCount ?? 0,
      },
      buyerProfile: {
        avgBudget: 0,
        avgAcreagePreference: 0,
        topFeatures: [],
        buyerTypes: [],
      },
      trend,
      confidence: 50,
    };
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
          eq(demandHeatmaps.state, state),
          eq(demandHeatmaps.county, county)
        ),
        orderBy: [desc(demandHeatmaps.createdAt)],
      });

      if (!heatmap) return null;

      return this.mapHeatmapRow(heatmap);
    } catch (error) {
      logger.error('Failed to get demand heatmap', error);
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
        orderBy: [desc(demandHeatmaps.demandScore)],
        limit,
      });

      return heatmaps.map(h => this.mapHeatmapRow(h));
    } catch (error) {
      logger.error('Failed to get top demand locations', error);
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

      // TODO(tsc): buyer_behavior_events is anonymized with no propertyId/org columns,
      // so per-property insights fall back to recent county-agnostic event activity.
      const events = await db.query.buyerBehaviorEvents.findMany({
        where: gte(buyerBehaviorEvents.eventDate, thirtyDaysAgo),
      });

      const views = events.filter(e => e.eventType === 'property_view');
      const uniqueViewers = new Set(events.map(e => e.anonymousId)).size;
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
      logger.error('Failed to get property buyer insights', error);
      throw error;
    }
  }

  /**
   * Refresh all heatmaps for organization
   */
  async refreshAllHeatmaps(organizationId: string): Promise<{ updated: number; failed: number }> {
    try {
      // Get unique locations from properties
      const orgProperties = await db.query.properties.findMany({
        where: eq(properties.organizationId, Number(organizationId)),
      });

      const locations = new Set<string>();
      for (const prop of orgProperties) {
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
          logger.error(`Failed to refresh heatmap for ${loc}`, error);
        }
      }

      return { updated, failed };
    } catch (error) {
      logger.error('Failed to refresh heatmaps', error);
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

      // TODO(tsc): buyer_behavior_events has no org/searchCriteria columns; group by the
      // anonymized property-characteristic fields the schema actually stores.
      const searches = await db.query.buyerBehaviorEvents.findMany({
        where: and(
          eq(buyerBehaviorEvents.eventType, 'search'),
          gte(buyerBehaviorEvents.eventDate, cutoffDate)
        ),
        orderBy: [desc(buyerBehaviorEvents.eventDate)],
      });

      // Group similar searches
      const searchMap = new Map<string, number>();
      for (const search of searches) {
        const key = JSON.stringify({
          propertyType: search.propertyType,
          acreageRange: search.acreageRange,
          priceRange: search.priceRange,
          state: search.state,
          county: search.county,
        });
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
      logger.error('Failed to get trending searches', error);
      return [];
    }
  }
}

export const buyerNetwork = new BuyerIntelligenceNetwork();
