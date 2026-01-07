import { storage } from "../storage";
import { db } from "../db";
import { dataSources, dataSourceCache } from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import type { DataSource } from "@shared/schema";

export type AccessTier = "free" | "cached" | "byok" | "paid";
export type LookupCategory = 
  | "parcel_data" 
  | "flood_zone" 
  | "wetlands" 
  | "soil" 
  | "environmental" 
  | "tax_assessment" 
  | "market_data" 
  | "zoning"
  | "satellite"
  | "valuation";

interface BrokerLookupOptions {
  latitude: number;
  longitude: number;
  state?: string;
  county?: string;
  address?: string;
  apn?: string;
  forceRefresh?: boolean;
  maxTier?: AccessTier;
  byokKeys?: Record<string, string>;
}

interface BrokerResult {
  success: boolean;
  data: any;
  source: {
    id: number;
    title: string;
    tier: AccessTier;
    costCents: number;
  };
  fromCache: boolean;
  cachedAt?: Date;
  lookupTimeMs: number;
  fallbacksUsed: string[];
}

interface SourceHealth {
  sourceId: number;
  successRate: number;
  avgLatencyMs: number;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  consecutiveFailures: number;
}

interface UsageMetrics {
  sourceId: number;
  lookupCount: number;
  totalCostCents: number;
  cacheHitRate: number;
}

const CACHE_DURATION_DAYS = 30;
const TIER_PRIORITY: AccessTier[] = ["free", "cached", "byok", "paid"];

export class DataSourceBroker {
  private healthCache: Map<number, SourceHealth> = new Map();
  private usageMetrics: Map<number, UsageMetrics> = new Map();

  private generateLookupKey(category: LookupCategory, options: BrokerLookupOptions): string {
    const lat = options.latitude.toFixed(4);
    const lng = options.longitude.toFixed(4);
    return `${category}:${lat}:${lng}`;
  }

  private determineTier(source: DataSource): AccessTier {
    const accessLevel = source.accessLevel?.toLowerCase() || "free";
    if (accessLevel === "free" || accessLevel === "public") return "free";
    if (accessLevel === "limited" || accessLevel === "freemium") return "free";
    if (accessLevel === "byok") return "byok";
    return "paid";
  }

  private async getSourcesForCategory(category: LookupCategory): Promise<DataSource[]> {
    const categoryMappings: Record<LookupCategory, string[]> = {
      parcel_data: ["county_gis", "parcel_lookup", "assessor"],
      flood_zone: ["fema_flood", "flood", "environmental"],
      wetlands: ["wetlands_nwi", "wetlands", "environmental"],
      soil: ["usda_soil", "soil", "environmental"],
      environmental: ["epa_superfund", "epa", "environmental", "hazards"],
      tax_assessment: ["county_gis", "assessor", "tax"],
      market_data: ["real_estate_market", "mls", "valuation"],
      zoning: ["county_gis", "zoning", "planning"],
      satellite: ["advanced_analytics", "satellite"],
      valuation: ["real_estate_market", "valuation", "advanced_analytics"],
    };

    const categories = categoryMappings[category] || [category];
    const allSources: DataSource[] = [];

    for (const cat of categories) {
      const sources = await db.select().from(dataSources)
        .where(and(
          eq(dataSources.isEnabled, true),
          sql`${dataSources.category} ILIKE ${'%' + cat + '%'} OR ${dataSources.subcategory} ILIKE ${'%' + cat + '%'}`
        ))
        .orderBy(dataSources.priority);
      allSources.push(...sources);
    }

    const uniqueSources = Array.from(new Map(allSources.map(s => [s.id, s])).values());
    return this.sortByTierAndHealth(uniqueSources);
  }

  private sortByTierAndHealth(sources: DataSource[]): DataSource[] {
    return sources.sort((a, b) => {
      const tierA = TIER_PRIORITY.indexOf(this.determineTier(a));
      const tierB = TIER_PRIORITY.indexOf(this.determineTier(b));
      if (tierA !== tierB) return tierA - tierB;

      const priorityA = a.priority || 100;
      const priorityB = b.priority || 100;
      if (priorityA !== priorityB) return priorityA - priorityB;

      const healthA = this.healthCache.get(a.id)?.successRate || 0.5;
      const healthB = this.healthCache.get(b.id)?.successRate || 0.5;
      return healthB - healthA;
    });
  }

  private async getCachedResult(lookupKey: string, sourceId?: number): Promise<{ data: any; cachedAt: Date } | null> {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - CACHE_DURATION_DAYS);

    let query = db.select().from(dataSourceCache)
      .where(and(
        eq(dataSourceCache.lookupKey, lookupKey),
        gte(dataSourceCache.fetchedAt, expirationDate),
        eq(dataSourceCache.successfulFetch, true)
      ))
      .orderBy(desc(dataSourceCache.fetchedAt))
      .limit(1);

    const results = await query;
    if (results.length > 0 && results[0].data) {
      return {
        data: results[0].data,
        cachedAt: results[0].fetchedAt || new Date(),
      };
    }
    return null;
  }

  private async cacheResult(sourceId: number, lookupKey: string, data: any, state?: string, county?: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CACHE_DURATION_DAYS);

    await db.insert(dataSourceCache).values({
      dataSourceId: sourceId,
      lookupKey,
      state: state || null,
      county: county || null,
      data,
      expiresAt,
      successfulFetch: true,
    }).onConflictDoUpdate({
      target: [dataSourceCache.lookupKey, dataSourceCache.dataSourceId],
      set: {
        data,
        expiresAt,
        successfulFetch: true,
        fetchedAt: new Date(),
      },
    }).catch(() => {
      db.insert(dataSourceCache).values({
        dataSourceId: sourceId,
        lookupKey,
        state: state || null,
        county: county || null,
        data,
        expiresAt,
        successfulFetch: true,
      });
    });
  }

  private updateHealth(sourceId: number, success: boolean, latencyMs: number): void {
    const current = this.healthCache.get(sourceId) || {
      sourceId,
      successRate: 0.5,
      avgLatencyMs: 1000,
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
    };

    const newSuccessRate = current.successRate * 0.9 + (success ? 0.1 : 0);
    const newAvgLatency = current.avgLatencyMs * 0.8 + latencyMs * 0.2;

    this.healthCache.set(sourceId, {
      ...current,
      successRate: newSuccessRate,
      avgLatencyMs: newAvgLatency,
      lastSuccess: success ? new Date() : current.lastSuccess,
      lastFailure: success ? current.lastFailure : new Date(),
      consecutiveFailures: success ? 0 : current.consecutiveFailures + 1,
    });
  }

  private trackUsage(sourceId: number, costCents: number, cacheHit: boolean): void {
    const current = this.usageMetrics.get(sourceId) || {
      sourceId,
      lookupCount: 0,
      totalCostCents: 0,
      cacheHitRate: 0,
    };

    const newLookupCount = current.lookupCount + 1;
    const newCacheHitRate = (current.cacheHitRate * current.lookupCount + (cacheHit ? 1 : 0)) / newLookupCount;

    this.usageMetrics.set(sourceId, {
      sourceId,
      lookupCount: newLookupCount,
      totalCostCents: current.totalCostCents + (cacheHit ? 0 : costCents),
      cacheHitRate: newCacheHitRate,
    });
  }

  async lookup(category: LookupCategory, options: BrokerLookupOptions): Promise<BrokerResult> {
    const startTime = Date.now();
    const lookupKey = this.generateLookupKey(category, options);
    const fallbacksUsed: string[] = [];
    const maxTierIndex = options.maxTier ? TIER_PRIORITY.indexOf(options.maxTier) : TIER_PRIORITY.length - 1;

    if (!options.forceRefresh) {
      const cached = await this.getCachedResult(lookupKey);
      if (cached) {
        return {
          success: true,
          data: cached.data,
          source: {
            id: 0,
            title: "Cache",
            tier: "cached",
            costCents: 0,
          },
          fromCache: true,
          cachedAt: cached.cachedAt,
          lookupTimeMs: Date.now() - startTime,
          fallbacksUsed: [],
        };
      }
    }

    const sources = await this.getSourcesForCategory(category);
    
    for (const source of sources) {
      const tier = this.determineTier(source);
      const tierIndex = TIER_PRIORITY.indexOf(tier);
      
      if (tierIndex > maxTierIndex) {
        continue;
      }

      if (tier === "byok" && !options.byokKeys?.[source.key]) {
        continue;
      }

      const health = this.healthCache.get(source.id);
      if (health && health.consecutiveFailures >= 5) {
        fallbacksUsed.push(`${source.title} (disabled - too many failures)`);
        continue;
      }

      try {
        const result = await this.executeSourceLookup(source, category, options);
        const latencyMs = Date.now() - startTime;
        const costCents = source.costPerCall || 0;

        this.updateHealth(source.id, true, latencyMs);
        this.trackUsage(source.id, costCents, false);

        await this.cacheResult(source.id, lookupKey, result, options.state, options.county);

        return {
          success: true,
          data: result,
          source: {
            id: source.id,
            title: source.title,
            tier,
            costCents,
          },
          fromCache: false,
          lookupTimeMs: latencyMs,
          fallbacksUsed,
        };
      } catch (error: any) {
        this.updateHealth(source.id, false, Date.now() - startTime);
        fallbacksUsed.push(`${source.title}: ${error.message}`);
        continue;
      }
    }

    return {
      success: false,
      data: null,
      source: {
        id: 0,
        title: "None",
        tier: "free",
        costCents: 0,
      },
      fromCache: false,
      lookupTimeMs: Date.now() - startTime,
      fallbacksUsed,
    };
  }

  private async executeSourceLookup(source: DataSource, category: LookupCategory, options: BrokerLookupOptions): Promise<any> {
    const { latitude, longitude } = options;

    if (category === "flood_zone") {
      return this.queryFemaFlood(latitude, longitude);
    }
    if (category === "wetlands") {
      return this.queryNwiWetlands(latitude, longitude);
    }
    if (category === "soil") {
      return this.querySoilData(latitude, longitude);
    }
    if (category === "environmental") {
      return this.queryEpaData(latitude, longitude);
    }
    if (category === "parcel_data" && source.category === "county_gis") {
      return this.queryCountyGis(source, latitude, longitude, options.state, options.county);
    }

    if (source.apiUrl) {
      return this.queryGenericApi(source, options);
    }

    throw new Error(`No query implementation for category: ${category}`);
  }

  private async queryFemaFlood(lat: number, lng: number): Promise<any> {
    const baseUrl = "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer";
    const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
    const url = `${baseUrl}/28/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=DFIRM_ID,FLD_ZONE,ZONE_SUBTY,STATIC_BFE&returnGeometry=false&f=json`;
    
    const response = await fetch(url, { 
      headers: { "User-Agent": "AcreOS Land Investment Platform" },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) throw new Error(`FEMA API error: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const feature = data.features?.[0]?.attributes;
    const zone = feature?.FLD_ZONE || "X";
    const highRiskZones = ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE"];
    const mediumRiskZones = ["B", "X500"];
    
    let riskLevel: "low" | "medium" | "high" = "low";
    if (highRiskZones.some(z => zone.startsWith(z))) riskLevel = "high";
    else if (mediumRiskZones.some(z => zone.startsWith(z))) riskLevel = "medium";
    
    return {
      zone: feature ? `Zone ${zone}` : "Zone X (Minimal Flood Hazard)",
      riskLevel,
      source: "FEMA NFHL",
      lastUpdated: new Date().toISOString(),
      details: feature || {},
    };
  }

  private async queryNwiWetlands(lat: number, lng: number): Promise<any> {
    const baseUrl = "https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer";
    const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
    const url = `${baseUrl}/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=WETLAND_TYPE,ATTRIBUTE,ACRES&returnGeometry=false&f=json`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Land Investment Platform" },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) throw new Error(`NWI API error: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const features = data.features || [];
    return {
      hasWetlands: features.length > 0,
      classification: features[0]?.attributes?.WETLAND_TYPE || null,
      percentage: features.length > 0 ? 100 : 0,
      source: "NWI",
      lastUpdated: new Date().toISOString(),
      details: features[0]?.attributes || {},
    };
  }

  private async querySoilData(lat: number, lng: number): Promise<any> {
    const baseUrl = "https://SDMDataAccess.nrcs.usda.gov/Tabular/post.rest";
    const query = `SELECT TOP 1 musym, muname FROM mapunit WHERE mukey IN (SELECT mukey FROM mupolygon WHERE mupolygonGeometry.STContains(geometry::Point(${lng}, ${lat}, 4326)) = 1)`;
    
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "AcreOS Land Investment Platform" 
      },
      body: `query=${encodeURIComponent(query)}&format=json`,
      signal: AbortSignal.timeout(15000),
    });
    
    if (!response.ok) throw new Error(`USDA Soil API error: ${response.status}`);
    const data = await response.json();
    
    return {
      soilType: data.Table?.[0]?.muname || "Unknown",
      soilSymbol: data.Table?.[0]?.musym || "Unknown",
      suitability: "good",
      drainage: "Well drained",
      source: "USDA NRCS",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryEpaData(lat: number, lng: number): Promise<any> {
    const radiusMiles = 3;
    const url = `https://data.epa.gov/efservice/tri_facility/latitude/${lat}/longitude/${lng}/radius/${radiusMiles}/JSON`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Land Investment Platform" },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) throw new Error(`EPA API error: ${response.status}`);
    const sites = await response.json();
    
    return {
      superfundSites: sites.slice(0, 10).map((site: any) => ({
        name: site.FACILITY_NAME,
        address: site.STREET_ADDRESS,
        city: site.CITY,
        state: site.STATE,
      })),
      nearestSiteDistance: sites.length > 0 ? radiusMiles : null,
      riskLevel: sites.length > 5 ? "high" : sites.length > 0 ? "medium" : "low",
      source: "EPA TRI",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryCountyGis(source: DataSource, lat: number, lng: number, state?: string, county?: string): Promise<any> {
    if (!source.portalUrl && !source.apiUrl) {
      throw new Error("No GIS endpoint configured for this county");
    }

    const baseUrl = source.apiUrl || source.portalUrl;
    if (!baseUrl) throw new Error("No API URL available");

    const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
    const url = `${baseUrl}/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;

    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Land Investment Platform" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`County GIS error: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    return {
      parcelData: data.features?.[0]?.attributes || {},
      source: source.title,
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryGenericApi(source: DataSource, options: BrokerLookupOptions): Promise<any> {
    if (!source.apiUrl) throw new Error("No API URL configured");

    let url = source.apiUrl;
    url = url.replace("{lat}", options.latitude.toString());
    url = url.replace("{lng}", options.longitude.toString());
    url = url.replace("{latitude}", options.latitude.toString());
    url = url.replace("{longitude}", options.longitude.toString());

    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Land Investment Platform" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  }

  async getHealthMetrics(): Promise<SourceHealth[]> {
    return Array.from(this.healthCache.values());
  }

  async getUsageMetrics(): Promise<UsageMetrics[]> {
    return Array.from(this.usageMetrics.values());
  }

  async getCostSummary(): Promise<{ totalCostCents: number; lookupCount: number; cacheHitRate: number }> {
    const metrics = Array.from(this.usageMetrics.values());
    const totalCost = metrics.reduce((sum, m) => sum + m.totalCostCents, 0);
    const totalLookups = metrics.reduce((sum, m) => sum + m.lookupCount, 0);
    const avgCacheHitRate = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.cacheHitRate, 0) / metrics.length 
      : 0;

    return {
      totalCostCents: totalCost,
      lookupCount: totalLookups,
      cacheHitRate: avgCacheHitRate,
    };
  }
}

export const dataSourceBroker = new DataSourceBroker();
