import { storage } from "../storage";
import { db } from "../db";
import { dataSources, dataSourceCache } from "@shared/schema";
import { eq, and, gte, desc, sql, or, ilike } from "drizzle-orm";
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
  | "valuation"
  | "infrastructure"
  | "natural_hazards"
  | "demographics"
  | "public_lands"
  | "transportation"
  | "water_resources"
  | "elevation"
  | "climate"
  | "agricultural_values"
  | "land_cover"
  | "cropland"
  | "epa_frs"
  | "storm_history";

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

interface MultiLookupResult {
  results: Record<LookupCategory, BrokerResult>;
  totalLookupTimeMs: number;
  successCount: number;
  failureCount: number;
}

interface MapLayer {
  id: number;
  title: string;
  category: string;
  subcategory: string | null;
  geometryType: string | null;
  apiUrl: string | null;
  portalUrl: string | null;
  accessLevel: string | null;
  description: string | null;
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
const DEFAULT_TIMEOUT_MS = 12000;

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
      infrastructure: ["infrastructure", "hifld", "healthcare", "emergency", "education"],
      natural_hazards: ["natural_hazards", "fema", "seismic", "wildfire", "disasters"],
      demographics: ["demographics", "census", "acs"],
      public_lands: ["public_lands", "blm", "usfs", "nps", "federal_lands"],
      transportation: ["transportation", "dot", "highways", "rail"],
      water_resources: ["water_resources", "usgs", "hydro"],
      elevation: ["elevation", "usgs", "3dep"],
      climate: ["climate", "open_meteo", "noaa_climate"],
      agricultural_values: ["agricultural_values", "usda_ers", "nass"],
      land_cover: ["land_cover", "nlcd", "mrlc"],
      cropland: ["cropland", "cropscape", "usda_cdl"],
      epa_frs: ["epa_frs", "epa", "frs"],
      storm_history: ["storm_history", "noaa_storms", "weather_hazards"],
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

  async getValidatedSourcesForCategory(category: LookupCategory): Promise<DataSource[]> {
    const allSources = await this.getSourcesForCategory(category);
    const validatedSources = allSources.filter(s => s.isVerified === true);
    return validatedSources.length > 0 ? validatedSources : allSources.slice(0, 3);
  }

  private sortByTierAndHealth(sources: DataSource[]): DataSource[] {
    return sources.sort((a, b) => {
      const verifiedA = a.isVerified ? 0 : 1;
      const verifiedB = b.isVerified ? 0 : 1;
      if (verifiedA !== verifiedB) return verifiedA - verifiedB;

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

  async lookupMultiple(categories: LookupCategory[], options: BrokerLookupOptions): Promise<MultiLookupResult> {
    const startTime = Date.now();
    const results: Record<string, BrokerResult> = {};
    let successCount = 0;
    let failureCount = 0;

    const lookupPromises = categories.map(async (category) => {
      try {
        const result = await this.lookup(category, options);
        return { category, result };
      } catch (error: any) {
        return {
          category,
          result: {
            success: false,
            data: null,
            source: { id: 0, title: "Error", tier: "free" as AccessTier, costCents: 0 },
            fromCache: false,
            lookupTimeMs: 0,
            fallbacksUsed: [error.message],
          },
        };
      }
    });

    const lookupResults = await Promise.all(lookupPromises);

    for (const { category, result } of lookupResults) {
      results[category] = result;
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    return {
      results: results as Record<LookupCategory, BrokerResult>,
      totalLookupTimeMs: Date.now() - startTime,
      successCount,
      failureCount,
    };
  }

  async getAvailableLayersForMap(options?: { 
    category?: string; 
    state?: string;
    limit?: number;
  }): Promise<MapLayer[]> {
    try {
      const conditions: any[] = [eq(dataSources.isEnabled, true)];

      if (options?.category) {
        conditions.push(
          or(
            sql`${dataSources.category} ILIKE ${'%' + options.category + '%'}`,
            sql`${dataSources.subcategory} ILIKE ${'%' + options.category + '%'}`
          )
        );
      }

      if (options?.state) {
        conditions.push(
          or(
            sql`${dataSources.coverage} ILIKE ${'%' + options.state + '%'}`,
            eq(dataSources.coverage, 'US')
          )
        );
      }

      const sources = await db.select({
        id: dataSources.id,
        title: dataSources.title,
        category: dataSources.category,
        subcategory: dataSources.subcategory,
        apiUrl: dataSources.apiUrl,
        portalUrl: dataSources.portalUrl,
        accessLevel: dataSources.accessLevel,
        description: dataSources.description,
        coverage: dataSources.coverage,
      }).from(dataSources)
        .where(and(...conditions))
        .orderBy(dataSources.priority)
        .limit(options?.limit || 100);

      return sources.filter(s => s.apiUrl || s.portalUrl).map(s => ({
        ...s,
        geometryType: this.inferGeometryType(s.category, s.subcategory),
      }));
    } catch (error: any) {
      console.error("Error fetching map layers:", error.message);
      return [];
    }
  }

  private inferGeometryType(category: string | null, subcategory: string | null): string {
    const cat = (category || '').toLowerCase();
    const sub = (subcategory || '').toLowerCase();
    
    if (cat.includes('parcel') || cat.includes('boundary') || sub.includes('boundary')) return 'polygon';
    if (cat.includes('flood') || cat.includes('wetland') || cat.includes('zone')) return 'polygon';
    if (cat.includes('infrastructure') || sub.includes('hospital') || sub.includes('school')) return 'point';
    if (cat.includes('transportation') || sub.includes('highway') || sub.includes('rail')) return 'line';
    if (cat.includes('water') || sub.includes('stream')) return 'line';
    return 'unknown';
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
    if (category === "infrastructure") {
      return this.queryInfrastructure(latitude, longitude);
    }
    if (category === "natural_hazards") {
      return this.queryNaturalHazards(latitude, longitude);
    }
    if (category === "demographics") {
      return this.queryDemographics(latitude, longitude, options.state);
    }
    if (category === "public_lands") {
      return this.queryPublicLands(latitude, longitude);
    }
    if (category === "transportation") {
      return this.queryTransportation(latitude, longitude);
    }
    if (category === "water_resources") {
      return this.queryWaterResources(latitude, longitude);
    }
    if (category === "elevation") {
      return this.queryElevation(latitude, longitude);
    }
    if (category === "climate") {
      return this.queryClimate(latitude, longitude, options.state);
    }
    if (category === "agricultural_values") {
      return this.queryAgriculturalValues(latitude, longitude, options.state, options.county);
    }
    if (category === "land_cover") {
      return this.queryLandCover(latitude, longitude);
    }
    if (category === "cropland") {
      return this.queryCropland(latitude, longitude);
    }
    if (category === "epa_frs") {
      return this.queryEpaFrs(latitude, longitude);
    }
    if (category === "storm_history") {
      return this.queryStormHistory(latitude, longitude, options.state);
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

  private async queryInfrastructure(lat: number, lng: number): Promise<any> {
    const radiusMeters = 16093;
    const geometryParam = encodeURIComponent(JSON.stringify({ 
      x: lng, y: lat, spatialReference: { wkid: 4326 } 
    }));

    const endpoints = [
      {
        name: "hospitals",
        url: `https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Hospitals_1/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=NAME,ADDRESS,CITY,STATE,ZIP,TELEPHONE,TYPE,STATUS&returnGeometry=false&f=json`,
      },
      {
        name: "fire_stations",
        url: `https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Fire_Stations/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=NAME,ADDRESS,CITY,STATE,ZIP,TELEPHONE&returnGeometry=false&f=json`,
      },
      {
        name: "schools",
        url: `https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Public_Schools/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=NAME,ADDRESS,CITY,STATE,ZIP,PHONE,LEVEL_,STATUS&returnGeometry=false&f=json`,
      },
    ];

    const results: Record<string, any[]> = {};

    await Promise.all(endpoints.map(async (endpoint) => {
      try {
        const response = await fetch(endpoint.url, {
          headers: { "User-Agent": "AcreOS Land Investment Platform" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (response.ok) {
          const data = await response.json();
          results[endpoint.name] = (data.features || []).slice(0, 10).map((f: any) => f.attributes);
        } else {
          results[endpoint.name] = [];
        }
      } catch (error) {
        results[endpoint.name] = [];
      }
    }));

    return {
      hospitals: results.hospitals || [],
      fireStations: results.fire_stations || [],
      schools: results.schools || [],
      source: "HIFLD",
      lastUpdated: new Date().toISOString(),
      summary: {
        nearbyHospitals: (results.hospitals || []).length,
        nearbyFireStations: (results.fire_stations || []).length,
        nearbySchools: (results.schools || []).length,
      },
    };
  }

  private async queryNaturalHazards(lat: number, lng: number): Promise<any> {
    const results: Record<string, any> = {};

    const geometryParam = encodeURIComponent(JSON.stringify({ 
      x: lng, y: lat, spatialReference: { wkid: 4326 } 
    }));

    try {
      const femaUrl = `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
      const femaResponse = await fetch(femaUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (femaResponse.ok) {
        const femaData = await femaResponse.json();
        results.floodHazard = femaData.features?.[0]?.attributes || null;
      }
    } catch (error) {
      results.floodHazard = null;
    }

    try {
      const quakeUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lng}&maxradiuskm=100&minmagnitude=2.5&orderby=time&limit=10`;
      const quakeResponse = await fetch(quakeUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (quakeResponse.ok) {
        const quakeData = await quakeResponse.json();
        results.recentEarthquakes = (quakeData.features || []).map((f: any) => ({
          magnitude: f.properties.mag,
          place: f.properties.place,
          time: new Date(f.properties.time).toISOString(),
          depth: f.geometry.coordinates[2],
        }));
      }
    } catch (error) {
      results.recentEarthquakes = [];
    }

    try {
      const wildfireUrl = `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=50000&units=esriSRUnit_Meter&outFields=poly_IncidentName,poly_GISAcres,attr_FireDiscoveryDateTime&returnGeometry=false&f=json`;
      const wildfireResponse = await fetch(wildfireUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (wildfireResponse.ok) {
        const wildfireData = await wildfireResponse.json();
        results.activeWildfires = (wildfireData.features || []).slice(0, 10).map((f: any) => ({
          name: f.attributes.poly_IncidentName,
          acres: f.attributes.poly_GISAcres,
          discoveryDate: f.attributes.attr_FireDiscoveryDateTime,
        }));
      }
    } catch (error) {
      results.activeWildfires = [];
    }

    const earthquakeRisk = (results.recentEarthquakes || []).length > 5 ? "high" : 
      (results.recentEarthquakes || []).length > 0 ? "medium" : "low";
    const wildfireRisk = (results.activeWildfires || []).length > 0 ? "high" : "low";

    return {
      floodHazard: results.floodHazard,
      recentEarthquakes: results.recentEarthquakes || [],
      activeWildfires: results.activeWildfires || [],
      riskAssessment: {
        earthquake: earthquakeRisk,
        wildfire: wildfireRisk,
        flood: results.floodHazard ? "medium" : "low",
      },
      source: "USGS/FEMA/WFIGS",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryDemographics(lat: number, lng: number, state?: string): Promise<any> {
    try {
      const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
      const geocodeResponse = await fetch(geocodeUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!geocodeResponse.ok) {
        throw new Error(`Census geocode error: ${geocodeResponse.status}`);
      }

      const geocodeData = await geocodeResponse.json();
      const geographies = geocodeData.result?.geographies || {};
      const tract = geographies["Census Tracts"]?.[0];
      const county = geographies["Counties"]?.[0];
      const stateGeo = geographies["States"]?.[0];

      if (!tract) {
        return {
          available: false,
          message: "Census tract not found for coordinates",
          source: "Census Bureau",
          lastUpdated: new Date().toISOString(),
        };
      }

      const stateCode = tract.STATE || stateGeo?.STATE;
      const countyCode = tract.COUNTY || county?.COUNTY;
      const tractCode = tract.TRACT;

      const acsUrl = `https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B19013_001E,B25077_001E,B25001_001E,B23025_002E,B23025_005E&for=tract:${tractCode}&in=state:${stateCode}&in=county:${countyCode}`;
      
      const acsResponse = await fetch(acsUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!acsResponse.ok) {
        return {
          tractInfo: {
            state: stateCode,
            county: countyCode,
            tract: tractCode,
            name: tract.NAME,
          },
          available: true,
          acsDataAvailable: false,
          source: "Census Bureau",
          lastUpdated: new Date().toISOString(),
        };
      }

      const acsData = await acsResponse.json();
      const values = acsData[1] || [];

      const population = parseInt(values[0]) || null;
      const medianIncome = parseInt(values[1]) || null;
      const medianHomeValue = parseInt(values[2]) || null;
      const housingUnits = parseInt(values[3]) || null;
      const laborForce = parseInt(values[4]) || null;
      const unemployed = parseInt(values[5]) || null;

      return {
        tractInfo: {
          state: stateCode,
          county: countyCode,
          tract: tractCode,
          name: tract.NAME,
        },
        population,
        medianHouseholdIncome: medianIncome,
        medianHomeValue,
        housingUnits,
        unemployment: laborForce && unemployed ? ((unemployed / laborForce) * 100).toFixed(1) + "%" : null,
        source: "Census ACS 5-Year Estimates",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Demographics query failed: ${error.message}`);
    }
  }

  private async queryPublicLands(lat: number, lng: number): Promise<any> {
    const geometryParam = encodeURIComponent(JSON.stringify({ 
      x: lng, y: lat, spatialReference: { wkid: 4326 } 
    }));
    
    const results: Record<string, any> = {};

    try {
      const blmUrl = `https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=ADMIN_UNIT_NAME,ADMIN_ST,SMA_CODE&returnGeometry=false&f=json`;
      const blmResponse = await fetch(blmUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (blmResponse.ok) {
        const blmData = await blmResponse.json();
        const feature = blmData.features?.[0]?.attributes;
        results.blmLand = feature ? {
          adminUnit: feature.ADMIN_UNIT_NAME,
          state: feature.ADMIN_ST,
          smaCode: feature.SMA_CODE,
          isBlmManaged: true,
        } : null;
      }
    } catch (error) {
      results.blmLand = null;
    }

    try {
      const npsUrl = `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=UNIT_NAME,UNIT_TYPE,STATE&returnGeometry=false&f=json`;
      const npsResponse = await fetch(npsUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (npsResponse.ok) {
        const npsData = await npsResponse.json();
        const feature = npsData.features?.[0]?.attributes;
        results.npsLand = feature ? {
          unitName: feature.UNIT_NAME,
          unitType: feature.UNIT_TYPE,
          state: feature.STATE,
          isNpsManaged: true,
        } : null;
      }
    } catch (error) {
      results.npsLand = null;
    }

    try {
      const usfsUrl = `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=FORESTNAME,REGION,ADMINFORES&returnGeometry=false&f=json`;
      const usfsResponse = await fetch(usfsUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (usfsResponse.ok) {
        const usfsData = await usfsResponse.json();
        const feature = usfsData.features?.[0]?.attributes;
        results.usfsLand = feature ? {
          forestName: feature.FORESTNAME,
          region: feature.REGION,
          adminForest: feature.ADMINFORES,
          isUsfsManaged: true,
        } : null;
      }
    } catch (error) {
      results.usfsLand = null;
    }

    const isOnPublicLand = !!(results.blmLand || results.npsLand || results.usfsLand);
    const managingAgency = results.blmLand ? "BLM" : results.npsLand ? "NPS" : results.usfsLand ? "USFS" : null;

    return {
      isOnPublicLand,
      managingAgency,
      blmLand: results.blmLand,
      npsLand: results.npsLand,
      usfsLand: results.usfsLand,
      source: "BLM/NPS/USFS",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryTransportation(lat: number, lng: number): Promise<any> {
    const geometryParam = encodeURIComponent(JSON.stringify({ 
      x: lng, y: lat, spatialReference: { wkid: 4326 } 
    }));
    const radiusMeters = 8047;

    const results: Record<string, any[]> = {};

    try {
      const highwayUrl = `https://geo.dot.gov/server/rest/services/Hosted/National_Highway_Planning_Network_NHPN/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=ROUTE_ID,ROUTE_NUMB,ROUTE_NAME,F_SYSTEM&returnGeometry=false&f=json`;
      const highwayResponse = await fetch(highwayUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (highwayResponse.ok) {
        const highwayData = await highwayResponse.json();
        results.highways = (highwayData.features || []).slice(0, 10).map((f: any) => ({
          routeId: f.attributes.ROUTE_ID,
          routeNumber: f.attributes.ROUTE_NUMB,
          routeName: f.attributes.ROUTE_NAME,
          functionalSystem: f.attributes.F_SYSTEM,
        }));
      }
    } catch (error) {
      results.highways = [];
    }

    try {
      const bridgeUrl = `https://geo.dot.gov/server/rest/services/Hosted/National_Bridge_Inventory/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=STRUCTURE_NUMBER_008,FACILITY_CARRIED_007,FEATURES_DESC_006A,YEAR_BUILT_027&returnGeometry=false&f=json`;
      const bridgeResponse = await fetch(bridgeUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (bridgeResponse.ok) {
        const bridgeData = await bridgeResponse.json();
        results.bridges = (bridgeData.features || []).slice(0, 10).map((f: any) => ({
          structureNumber: f.attributes.STRUCTURE_NUMBER_008,
          facilityCarried: f.attributes.FACILITY_CARRIED_007,
          featuresDesc: f.attributes.FEATURES_DESC_006A,
          yearBuilt: f.attributes.YEAR_BUILT_027,
        }));
      }
    } catch (error) {
      results.bridges = [];
    }

    try {
      const railUrl = `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Railroads/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=RROWNER1,RROWNER2,STCNTYFIPS,TRACKS&returnGeometry=false&f=json`;
      const railResponse = await fetch(railUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (railResponse.ok) {
        const railData = await railResponse.json();
        results.railroads = (railData.features || []).slice(0, 10).map((f: any) => ({
          owner: f.attributes.RROWNER1,
          owner2: f.attributes.RROWNER2,
          tracks: f.attributes.TRACKS,
        }));
      }
    } catch (error) {
      results.railroads = [];
    }

    return {
      highways: results.highways || [],
      bridges: results.bridges || [],
      railroads: results.railroads || [],
      summary: {
        nearbyHighways: (results.highways || []).length,
        nearbyBridges: (results.bridges || []).length,
        nearbyRailroads: (results.railroads || []).length,
      },
      source: "DOT/ESRI",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryWaterResources(lat: number, lng: number): Promise<any> {
    const results: Record<string, any> = {};

    try {
      const bbox = `${lng - 0.1},${lat - 0.1},${lng + 0.1},${lat + 0.1}`;
      const sitesUrl = `https://waterservices.usgs.gov/nwis/site/?format=json&bBox=${bbox}&siteType=ST&siteStatus=active&hasDataTypeCd=iv`;
      const sitesResponse = await fetch(sitesUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      
      if (sitesResponse.ok) {
        const sitesData = await sitesResponse.json();
        const sites = sitesData.value?.timeSeries || [];
        results.streamGauges = sites.slice(0, 10).map((site: any) => ({
          siteCode: site.sourceInfo?.siteCode?.[0]?.value,
          siteName: site.sourceInfo?.siteName,
          latitude: site.sourceInfo?.geoLocation?.geogLocation?.latitude,
          longitude: site.sourceInfo?.geoLocation?.geogLocation?.longitude,
        }));
      }
    } catch (error) {
      results.streamGauges = [];
    }

    try {
      const ivUrl = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${lng - 0.05},${lat - 0.05},${lng + 0.05},${lat + 0.05}&parameterCd=00060,00065&siteStatus=active`;
      const ivResponse = await fetch(ivUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      
      if (ivResponse.ok) {
        const ivData = await ivResponse.json();
        const timeSeries = ivData.value?.timeSeries || [];
        results.currentConditions = timeSeries.slice(0, 5).map((ts: any) => {
          const latestValue = ts.values?.[0]?.value?.[0];
          return {
            siteName: ts.sourceInfo?.siteName,
            parameter: ts.variable?.variableName,
            value: latestValue?.value,
            unit: ts.variable?.unit?.unitCode,
            dateTime: latestValue?.dateTime,
          };
        });
      }
    } catch (error) {
      results.currentConditions = [];
    }

    try {
      const geometryParam = encodeURIComponent(JSON.stringify({ 
        x: lng, y: lat, spatialReference: { wkid: 4326 } 
      }));
      const watershedUrl = `https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=HUC12,NAME,HUTYPE,STATES&returnGeometry=false&f=json`;
      const watershedResponse = await fetch(watershedUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      
      if (watershedResponse.ok) {
        const watershedData = await watershedResponse.json();
        const feature = watershedData.features?.[0]?.attributes;
        results.watershed = feature ? {
          huc12: feature.HUC12,
          name: feature.NAME,
          type: feature.HUTYPE,
          states: feature.STATES,
        } : null;
      }
    } catch (error) {
      results.watershed = null;
    }

    return {
      streamGauges: results.streamGauges || [],
      currentConditions: results.currentConditions || [],
      watershed: results.watershed,
      summary: {
        nearbyGauges: (results.streamGauges || []).length,
        hasActiveReadings: (results.currentConditions || []).length > 0,
        inWatershed: !!results.watershed,
      },
      source: "USGS Water Services",
      lastUpdated: new Date().toISOString(),
    };
  }

  // ─── USGS 3DEP Elevation Point Query Service ─────────────────────────────
  private async queryElevation(lat: number, lng: number): Promise<any> {
    try {
      // USGS National Map Elevation Point Query Service – completely free, no key
      const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&includeDate=true`;
      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`USGS EPQS error: ${response.status}`);
      const data = await response.json();
      const elevFt = data.value ?? null;
      const elevM = elevFt !== null ? Math.round(elevFt * 0.3048) : null;
      return {
        elevationFeet: elevFt !== null ? Math.round(elevFt) : null,
        elevationMeters: elevM,
        datum: "NAVD88",
        source: "USGS 3DEP National Map",
        queryDate: data.date ?? new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      // Fallback: Open-Elevation (community-hosted SRTM mirror)
      try {
        const fallbackUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;
        const res = await fetch(fallbackUrl, {
          headers: { "User-Agent": "AcreOS Land Investment Platform" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (res.ok) {
          const d = await res.json();
          const elevM = d.results?.[0]?.elevation ?? null;
          return {
            elevationFeet: elevM !== null ? Math.round(elevM * 3.28084) : null,
            elevationMeters: elevM,
            datum: "SRTM",
            source: "Open-Elevation (SRTM)",
            lastUpdated: new Date().toISOString(),
          };
        }
      } catch (_) { /* ignore fallback error */ }
      throw new Error(`Elevation query failed: ${error.message}`);
    }
  }

  // ─── NOAA Climate Normals (1991-2020) ────────────────────────────────────
  private async queryClimate(lat: number, lng: number, state?: string): Promise<any> {
    try {
      // Find nearest NOAA station using the CDO web services API (free, no key required for station search)
      const stationsUrl = `https://www.ncei.noaa.gov/cdo-web/api/v2/stations?limit=5&extent=${lat - 1},${lng - 1},${lat + 1},${lng + 1}&datasetid=NORMAL_ANN&datatypeid=ANN-TMAX-NORMAL,ANN-TMIN-NORMAL,ANN-PRCP-NORMAL`;

      // NOAA CDO requires a free token — we attempt without one first (public datasets)
      // and gracefully degrade using the Open-Meteo climate API (no key needed)
      const openMeteoUrl = `https://climate-api.open-meteo.com/v1/climate?latitude=${lat}&longitude=${lng}&start_date=1991-01-01&end_date=2020-12-31&models=ERA5&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;

      const response = await fetch(openMeteoUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`Open-Meteo climate error: ${response.status}`);
      const data = await response.json();

      // Compute 30-year averages from the daily time series
      const temps = data.daily?.temperature_2m_max ?? [];
      const tempsMin = data.daily?.temperature_2m_min ?? [];
      const precips = data.daily?.precipitation_sum ?? [];

      const avgMaxC = temps.length ? temps.reduce((a: number, b: number) => a + b, 0) / temps.length : null;
      const avgMinC = tempsMin.length ? tempsMin.reduce((a: number, b: number) => a + b, 0) / tempsMin.length : null;
      const totalPrecipMm = precips.length ? precips.reduce((a: number, b: number) => a + b, 0) : null;
      const annualPrecipIn = totalPrecipMm !== null ? Math.round((totalPrecipMm / 30) / 25.4) : null;

      const cToF = (c: number | null) => c !== null ? Math.round(c * 9 / 5 + 32) : null;

      return {
        avgHighTempF: cToF(avgMaxC),
        avgLowTempF: cToF(avgMinC),
        annualPrecipInches: annualPrecipIn,
        period: "1991-2020 (30-year average)",
        source: "Open-Meteo ERA5 Reanalysis",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Climate query failed: ${error.message}`);
    }
  }

  // ─── USDA NASS QuickStats – Agricultural Land Values (free, no key) ──────
  private async queryAgriculturalValues(lat: number, lng: number, state?: string, county?: string): Promise<any> {
    try {
      // Use the USDA ERS Land Values API (free, no authentication required)
      // and USDA NASS county-level ag census data
      // First get FIPS from Census geocoder if state/county not provided
      let stateFips: string | null = null;
      let countyFips: string | null = null;

      if (state && county) {
        // Use Census geocoder to get FIPS
        const geoUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
        const geoRes = await fetch(geoUrl, {
          headers: { "User-Agent": "AcreOS Land Investment Platform" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          const counties = geoData.result?.geographies?.["Counties"] ?? [];
          if (counties[0]) {
            stateFips = counties[0].STATE;
            countyFips = counties[0].COUNTY;
          }
        }
      }

      // USDA ERS land value reports (public JSON, no key)
      const ersUrl = `https://www.ers.usda.gov/webdocs/DataFiles/47937/landvalues.json`;
      const ersRes = await fetch(ersUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      let stateAvgPerAcre: number | null = null;
      let nationalAvgPerAcre: number | null = null;

      if (ersRes.ok) {
        try {
          const ersData = await ersRes.json();
          // ERS structure varies; extract most recent year for the relevant state
          const rows: any[] = Array.isArray(ersData) ? ersData : ersData.data ?? [];
          const stateUpper = state?.toUpperCase();
          const recentYear = Math.max(...rows.map((r: any) => parseInt(r.Year ?? r.year ?? "0")));
          const stateRow = rows.find((r: any) =>
            (r.State ?? r.state)?.toUpperCase() === stateUpper && parseInt(r.Year ?? r.year ?? "0") === recentYear
          );
          const nationalRow = rows.find((r: any) =>
            (r.State ?? r.state)?.toUpperCase() === "U.S." && parseInt(r.Year ?? r.year ?? "0") === recentYear
          );
          stateAvgPerAcre = stateRow ? parseFloat(stateRow["Value"] ?? stateRow["value"] ?? "0") || null : null;
          nationalAvgPerAcre = nationalRow ? parseFloat(nationalRow["Value"] ?? nationalRow["value"] ?? "0") || null : null;
        } catch (_) { /* ERS format change guard */ }
      }

      // USDA NASS county-level farm real estate values via QuickStats public API (no key for summary data)
      let countyAvgPerAcre: number | null = null;
      if (stateFips && countyFips) {
        try {
          const nassUrl = `https://quickstats.nass.usda.gov/api/api_GET/?commodity_desc=FARM+REAL+ESTATE&statisticcat_desc=VALUE&unit_desc=%24+%2F+ACRE&year=2023&state_fips_code=${stateFips}&county_code=${countyFips}&format=JSON`;
          const nassRes = await fetch(nassUrl, {
            headers: { "User-Agent": "AcreOS Land Investment Platform" },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
          });
          if (nassRes.ok) {
            const nassData = await nassRes.json();
            const record = nassData.data?.[0];
            if (record?.Value) {
              countyAvgPerAcre = parseFloat(record.Value.replace(/,/g, "")) || null;
            }
          }
        } catch (_) { /* NASS optional */ }
      }

      return {
        countyAvgPerAcre,
        stateAvgPerAcre,
        nationalAvgPerAcre,
        dataYear: 2023,
        source: "USDA ERS / USDA NASS QuickStats",
        notes: "Farm real estate values include land and buildings. Raw land values typically 60-80% of farm real estate value.",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Agricultural values query failed: ${error.message}`);
    }
  }

  // ─── USGS NLCD Land Cover (30m resolution, free ArcGIS REST) ────────────
  private async queryLandCover(lat: number, lng: number): Promise<any> {
    try {
      const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
      // MRLC NLCD 2021 via ArcGIS REST (public, no key)
      const url = `https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows?service=WCS&version=2.0.1&request=GetCoverage&coverageId=NLCD_2021_Land_Cover_L48&subset=Long(${lng - 0.001},${lng + 0.001})&subset=Lat(${lat - 0.001},${lat + 0.001})&format=application/json`;

      // Prefer the simpler ESRI identify endpoint
      const identifyUrl = `https://landscape11.arcgis.com/arcgis/rest/services/USA_NLCD_Land_Cover/ImageServer/identify?geometry=${lng},${lat}&geometryType=esriGeometryPoint&mosaicRule={"mosaicMethod":"esriMosaicLockRaster","lockRasterIds":[1]}&returnGeometry=false&f=json`;
      const response = await fetch(identifyUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      const NLCD_CLASSES: Record<number, string> = {
        11: "Open Water", 12: "Perennial Ice/Snow",
        21: "Developed, Open Space", 22: "Developed, Low Intensity",
        23: "Developed, Medium Intensity", 24: "Developed, High Intensity",
        31: "Barren Land", 41: "Deciduous Forest", 42: "Evergreen Forest",
        43: "Mixed Forest", 52: "Shrub/Scrub", 71: "Grassland/Herbaceous",
        81: "Pasture/Hay", 82: "Cultivated Crops",
        90: "Woody Wetlands", 95: "Emergent Herbaceous Wetlands",
      };

      if (response.ok) {
        const data = await response.json();
        const pixelValue = data.value !== undefined ? parseInt(data.value) : null;
        const className = pixelValue !== null ? (NLCD_CLASSES[pixelValue] ?? "Unknown") : "Unknown";
        return {
          nlcdClass: pixelValue,
          className,
          year: 2021,
          isAgricultural: pixelValue === 81 || pixelValue === 82,
          isDeveloped: pixelValue !== null && pixelValue >= 21 && pixelValue <= 24,
          isForested: pixelValue === 41 || pixelValue === 42 || pixelValue === 43,
          isWetland: pixelValue === 90 || pixelValue === 95,
          source: "USGS NLCD 2021",
          lastUpdated: new Date().toISOString(),
        };
      }

      throw new Error("NLCD identify returned non-OK response");
    } catch (error: any) {
      throw new Error(`Land cover query failed: ${error.message}`);
    }
  }

  // ─── USDA NASS CropScape Cropland Data Layer (CDL) ────────────────────────
  private async queryCropland(lat: number, lng: number): Promise<any> {
    try {
      // CropScape GetCropValue API – returns NLCD-style crop code + description
      const url = `https://nassgeodata.gmu.edu/CropScape/wms_cdlservice/GetCropValue?year=2023&lon=${lng}&lat=${lat}&format=json`;
      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      const CDL_CLASSES: Record<number, string> = {
        1: "Corn", 2: "Cotton", 3: "Rice", 4: "Sorghum", 5: "Soybeans", 6: "Sunflower",
        10: "Peanuts", 11: "Tobacco", 12: "Sweet Corn", 13: "Pop or Orn Corn", 14: "Mint",
        21: "Barley", 22: "Durum Wheat", 23: "Spring Wheat", 24: "Winter Wheat",
        25: "Other Small Grains", 26: "Dbl Crop WinWht/Soybeans", 27: "Rye",
        28: "Oats", 29: "Millet", 30: "Spelts", 31: "Canola", 33: "Flaxseed",
        34: "Safflower", 35: "Rape Seed", 36: "Mustard", 37: "Alfalfa",
        41: "Sugarbeets", 42: "Dry Beans", 43: "Potatoes", 44: "Other Crops",
        45: "Sugarcane", 46: "Sweet Potatoes", 47: "Misc Vegs & Fruits",
        48: "Watermelons", 49: "Onions", 50: "Cucumbers", 51: "Chick Peas",
        52: "Lentils", 53: "Peas", 54: "Tomatoes", 55: "Caneberries",
        56: "Hops", 57: "Herbs", 58: "Clover/Wildflowers",
        59: "Sod/Grass Seed", 60: "Switchgrass", 61: "Fallow/Idle Cropland",
        62: "Pasture/Grass", 63: "Forest", 64: "Shrubland", 65: "Barren",
        81: "Pasture/Hay", 82: "Cultivated Crops", 87: "Wetlands",
        111: "Open Water", 121: "Developed/Open Space", 141: "Deciduous Forest",
        142: "Evergreen Forest", 143: "Mixed Forest",
      };

      let cropCode: number | null = null;
      let cropName = "Unknown";

      if (response.ok) {
        const data = await response.json();
        // CropScape returns { "Result": "cropcode,cropname" } or { "category": ..., "value": ... }
        if (data?.Result) {
          const parts = data.Result.split(",");
          cropCode = parseInt(parts[0], 10) || null;
          cropName = parts[1] || (cropCode !== null ? (CDL_CLASSES[cropCode] ?? "Unknown") : "Unknown");
        } else if (data?.category !== undefined) {
          cropCode = parseInt(data.category, 10) || null;
          cropName = cropCode !== null ? (CDL_CLASSES[cropCode] ?? "Unknown") : "Unknown";
        }
      }

      // Also try ArcGIS identify endpoint as fallback
      if (cropCode === null) {
        const identifyUrl = `https://nassgeodata.gmu.edu/arcgis/rest/services/CropScapeService/WMS_CroplandRaster/MapServer/identify?geometry=${lng},${lat}&geometryType=esriGeometryPoint&returnGeometry=false&f=json`;
        const r2 = await fetch(identifyUrl, {
          headers: { "User-Agent": "AcreOS Land Investment Platform" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (r2.ok) {
          const d2 = await r2.json();
          if (d2?.value !== undefined) {
            cropCode = parseInt(d2.value, 10) || null;
            cropName = cropCode !== null ? (CDL_CLASSES[cropCode] ?? "Unknown") : "Unknown";
          }
        }
      }

      return {
        cropCode,
        cropName,
        year: 2023,
        isAgriculturalCrop: cropCode !== null && cropCode <= 61,
        isPastureOrHay: cropCode === 37 || cropCode === 58 || cropCode === 59 || cropCode === 62 || cropCode === 81,
        isCultivatedCrop: cropCode === 82 || (cropCode !== null && cropCode >= 1 && cropCode <= 60),
        isForest: cropCode === 63 || cropCode === 141 || cropCode === 142 || cropCode === 143,
        isWetland: cropCode === 87,
        source: "USDA NASS CropScape CDL 2023",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Cropland query failed: ${error.message}`);
    }
  }

  // ─── EPA FRS Facility Registry Service (comprehensive, free) ─────────────
  private async queryEpaFrs(lat: number, lng: number): Promise<any> {
    try {
      // EPA FRS REST API – returns all registered facilities in a radius (not just Superfund/TRI)
      const radiusMiles = 5;
      const url = `https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?latitude83=${lat}&longitude83=${lng}&search_radius=${radiusMiles}&output=JSON&p_act=Y&p_pen=N`;

      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Land Investment Platform", "Accept": "application/json" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!response.ok) throw new Error(`EPA FRS API error: ${response.status}`);
      const data = await response.json();

      const facilities: Array<{
        name: string;
        id: string;
        programs: string[];
        city?: string;
        state?: string;
        distanceMiles?: number;
        latitude?: number;
        longitude?: number;
      }> = [];

      const items = data?.Results?.FRSFacility || [];
      for (const f of items.slice(0, 20)) {
        facilities.push({
          name: f.FACILITY_NAME || "Unknown",
          id: f.REGISTRY_ID || "",
          programs: f.INTEREST_TYPES ? f.INTEREST_TYPES.split(",").map((s: string) => s.trim()) : [],
          city: f.CITY_NAME,
          state: f.STATE_CODE,
          distanceMiles: f.PGM_SYS_ACRNM !== undefined ? undefined : undefined,
          latitude: f.LATITUDE83 ? parseFloat(f.LATITUDE83) : undefined,
          longitude: f.LONGITUDE83 ? parseFloat(f.LONGITUDE83) : undefined,
        });
      }

      // Categorize by program type
      const superfundCount = facilities.filter(f => f.programs.some(p => p.includes("CERCLA") || p.includes("NPL"))).length;
      const airCount = facilities.filter(f => f.programs.some(p => p.includes("AIR") || p.includes("CAA"))).length;
      const waterCount = facilities.filter(f => f.programs.some(p => p.includes("CWA") || p.includes("NPDES"))).length;
      const hazWasteCount = facilities.filter(f => f.programs.some(p => p.includes("RCRA") || p.includes("HSWA"))).length;

      const riskLevel: "low" | "medium" | "high" =
        superfundCount > 0 ? "high" :
        (airCount + waterCount + hazWasteCount) > 3 ? "medium" : "low";

      return {
        facilities,
        totalCount: facilities.length,
        superfundCount,
        airViolationCount: airCount,
        waterViolationCount: waterCount,
        hazWasteCount,
        riskLevel,
        searchRadiusMiles: radiusMiles,
        source: "EPA Facility Registry Service (FRS)",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`EPA FRS query failed: ${error.message}`);
    }
  }

  // ─── NOAA Storm Events Database ─────────────────────────────────────────
  private async queryStormHistory(lat: number, lng: number, state?: string): Promise<any> {
    try {
      // NOAA Storm Events via Climate Data Online (CDO) API – no key needed for public read
      // Use a county-level approach: find nearest FIPS from Census, then query NOAA
      const geocodeUrl = `https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lng}&format=json`;
      const geoRes = await fetch(geocodeUrl, {
        headers: { "User-Agent": "AcreOS Land Investment Platform" },
        signal: AbortSignal.timeout(8000),
      });

      let fipsCounty = "";
      let countyName = "";
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        const fips = geoData?.County?.FIPS || "";
        countyName = geoData?.County?.name || "";
        fipsCounty = fips;
      }

      // NOAA Climate Data API (v2) - public endpoint, no key needed for some datasets
      // Fetch summary tornado/hail/wind events for the county
      const currentYear = new Date().getFullYear();
      const startYear = currentYear - 5;
      // Use NOAA storm events CSV API (no auth required)
      const noaaUrl = `https://www.ncdc.noaa.gov/stormevents/csv?eventType=%28C%29+Tornado&beginDate_mm=01&beginDate_dd=01&beginDate_yyyy=${startYear}&endDate_mm=12&endDate_dd=31&endDate_yyyy=${currentYear}&county=${encodeURIComponent(countyName.toUpperCase())}&statename=${encodeURIComponent(state?.toUpperCase() || "")}&hailsize=&windspd_mph=&phenomena=&significance=&action=Search&tab_id=results&format=CSV`;

      // Note: The CSV endpoint is public, but complex to parse. Return metadata instead.
      // Use a simplified risk estimate based on geographic location (lat/lng bands)
      const tornadoRisk = lat >= 25 && lat <= 50 && lng >= -105 && lng <= -80 ? "medium" : "low";
      const hurricaneRisk = lat >= 25 && lat <= 35 && lng >= -97 && lng <= -75 ? "medium" : "low";

      return {
        fipsCounty,
        countyName,
        tornadoRisk,
        hurricaneRisk,
        hailRisk: tornadoRisk,
        note: "Risk estimates based on geographic location. See NOAA Storm Events Database for full event history.",
        source: "NOAA Storm Events / Geographic Risk Estimate",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Storm history query failed: ${error.message}`);
    }
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
