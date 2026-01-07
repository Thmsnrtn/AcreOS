import { storage } from "../storage";
import type { DataSource, DataSourceCache } from "@shared/schema";

interface LookupResult {
  success: boolean;
  source: string;
  data: any;
  cachedAt?: Date;
  fromCache: boolean;
}

interface LookupOptions {
  latitude: number;
  longitude: number;
  state?: string;
  county?: string;
  address?: string;
  apn?: string;
  forceRefresh?: boolean;
}

const CACHE_DURATION_HOURS = 24 * 30;

export class DataSourceLookupService {
  private async getCachedData(lookupKey: string, dataSourceId?: number): Promise<DataSourceCache | undefined> {
    const cached = await storage.getDataSourceCacheEntry(lookupKey, dataSourceId);
    if (!cached || !cached.expiresAt) return undefined;
    
    if (new Date(cached.expiresAt) < new Date()) {
      return undefined;
    }
    return cached;
  }

  private async cacheData(dataSourceId: number, lookupKey: string, data: any, state?: string, county?: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CACHE_DURATION_HOURS);
    
    await storage.createDataSourceCacheEntry({
      dataSourceId,
      lookupKey,
      state,
      county,
      data,
      expiresAt,
      successfulFetch: true,
    });
  }

  private generateLookupKey(type: string, options: LookupOptions): string {
    return `${type}:${options.latitude.toFixed(4)}:${options.longitude.toFixed(4)}`;
  }

  async lookupFloodZone(options: LookupOptions): Promise<LookupResult> {
    const lookupKey = this.generateLookupKey("flood", options);
    
    const sources = await storage.getDataSources({ category: "fema_flood", isEnabled: true });
    const femaSource = sources.find(s => s.key.includes("nfhl") || s.key.includes("fema"));
    
    if (!options.forceRefresh && femaSource) {
      const cached = await this.getCachedData(lookupKey, femaSource.id);
      if (cached && cached.data) {
        return {
          success: true,
          source: femaSource.title,
          data: cached.data,
          cachedAt: cached.fetchedAt || undefined,
          fromCache: true,
        };
      }
    }

    try {
      const floodData = await this.queryFemaFloodService(options.latitude, options.longitude);
      
      if (femaSource) {
        await this.cacheData(femaSource.id, lookupKey, floodData, options.state, options.county);
      }
      
      return {
        success: true,
        source: "FEMA National Flood Hazard Layer",
        data: floodData,
        fromCache: false,
      };
    } catch (error) {
      console.error("FEMA flood lookup error:", error);
      return {
        success: false,
        source: "FEMA National Flood Hazard Layer",
        data: this.getDefaultFloodData(),
        fromCache: false,
      };
    }
  }

  private async queryFemaFloodService(lat: number, lng: number): Promise<any> {
    const baseUrl = "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer";
    const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
    
    const url = `${baseUrl}/28/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=DFIRM_ID,FLD_ZONE,ZONE_SUBTY,STATIC_BFE,SOURCE_CIT&returnGeometry=false&f=json`;
    
    const response = await fetch(url, { 
      headers: { "User-Agent": "AcreOS Land Investment Platform" },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      throw new Error(`FEMA API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || "FEMA API returned an error");
    }
    
    const feature = data.features?.[0]?.attributes;
    
    if (!feature) {
      return {
        zone: "Zone X (Area of Minimal Flood Hazard)",
        riskLevel: "low",
        lastUpdated: new Date().toISOString(),
        source: "FEMA NFHL",
        details: { message: "No flood zone data found for this location" },
      };
    }
    
    const zone = feature.FLD_ZONE || "Unknown";
    const riskLevel = this.determineFloodRisk(zone);
    
    return {
      zone: this.formatFloodZone(zone, feature.ZONE_SUBTY),
      riskLevel,
      lastUpdated: new Date().toISOString(),
      source: "FEMA NFHL",
      details: {
        dfirmId: feature.DFIRM_ID,
        zoneSubtype: feature.ZONE_SUBTY,
        staticBfe: feature.STATIC_BFE,
        sourceCitation: feature.SOURCE_CIT,
      },
    };
  }

  private determineFloodRisk(zone: string): "low" | "medium" | "high" {
    const highRiskZones = ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE"];
    const mediumRiskZones = ["B", "X500"];
    
    if (highRiskZones.some(z => zone.startsWith(z))) return "high";
    if (mediumRiskZones.some(z => zone.startsWith(z))) return "medium";
    return "low";
  }

  private formatFloodZone(zone: string, subtype?: string): string {
    const zoneDescriptions: Record<string, string> = {
      "A": "Zone A (High Risk - 1% Annual Flood Chance)",
      "AE": "Zone AE (High Risk with Base Flood Elevations)",
      "AH": "Zone AH (Shallow Flooding - Ponding)",
      "AO": "Zone AO (Shallow Flooding - Sheet Flow)",
      "V": "Zone V (Coastal High Hazard)",
      "VE": "Zone VE (Coastal High Hazard with BFE)",
      "X": "Zone X (Minimal Flood Hazard)",
      "B": "Zone B (Moderate Flood Hazard)",
      "C": "Zone C (Minimal Flood Hazard)",
      "D": "Zone D (Undetermined Flood Hazard)",
    };
    
    return zoneDescriptions[zone] || `Zone ${zone}${subtype ? ` (${subtype})` : ""}`;
  }

  private getDefaultFloodData(): any {
    return {
      zone: "Zone X (Minimal Flood Hazard)",
      riskLevel: "low",
      lastUpdated: new Date().toISOString(),
      source: "Default (API Unavailable)",
      details: { message: "Could not reach FEMA flood service" },
    };
  }

  async lookupWetlands(options: LookupOptions): Promise<LookupResult> {
    const lookupKey = this.generateLookupKey("wetlands", options);
    
    const sources = await storage.getDataSources({ category: "wetlands_nwi", isEnabled: true });
    const nwiSource = sources.find(s => s.key.includes("nwi") || s.key.includes("wetlands"));
    
    if (!options.forceRefresh && nwiSource) {
      const cached = await this.getCachedData(lookupKey, nwiSource.id);
      if (cached && cached.data) {
        return {
          success: true,
          source: nwiSource.title,
          data: cached.data,
          cachedAt: cached.fetchedAt || undefined,
          fromCache: true,
        };
      }
    }

    try {
      const wetlandsData = await this.queryNwiService(options.latitude, options.longitude);
      
      if (nwiSource) {
        await this.cacheData(nwiSource.id, lookupKey, wetlandsData, options.state, options.county);
      }
      
      return {
        success: true,
        source: "US Fish & Wildlife NWI",
        data: wetlandsData,
        fromCache: false,
      };
    } catch (error) {
      console.error("NWI wetlands lookup error:", error);
      return {
        success: false,
        source: "National Wetlands Inventory",
        data: this.getDefaultWetlandsData(),
        fromCache: false,
      };
    }
  }

  private async queryNwiService(lat: number, lng: number): Promise<any> {
    const baseUrl = "https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer";
    const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
    const url = `${baseUrl}/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=WETLAND_TYPE,ATTRIBUTE,ACRES&returnGeometry=false&f=json`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Land Investment Platform" },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      throw new Error(`NWI API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || "NWI API returned an error");
    }
    
    const features = data.features || [];
    const hasWetlands = features.length > 0;
    
    if (!hasWetlands) {
      return {
        hasWetlands: false,
        classification: null,
        percentage: 0,
        source: "NWI",
        lastUpdated: new Date().toISOString(),
        details: { nearestWetland: "Unknown", watershedName: "Unknown" },
      };
    }
    
    const firstFeature = features[0].attributes;
    return {
      hasWetlands: true,
      classification: firstFeature.WETLAND_TYPE || firstFeature.ATTRIBUTE,
      percentage: 100,
      source: "NWI",
      lastUpdated: new Date().toISOString(),
      details: {
        wetlandType: firstFeature.WETLAND_TYPE,
        attribute: firstFeature.ATTRIBUTE,
        acres: firstFeature.ACRES,
        featureCount: features.length,
      },
    };
  }

  private getDefaultWetlandsData(): any {
    return {
      hasWetlands: false,
      classification: null,
      percentage: 0,
      source: "Default (API Unavailable)",
      lastUpdated: new Date().toISOString(),
      details: { message: "Could not reach NWI wetlands service" },
    };
  }

  async lookupSoilData(options: LookupOptions): Promise<LookupResult> {
    const lookupKey = this.generateLookupKey("soil", options);
    
    const sources = await storage.getDataSources({ category: "usda_soil", isEnabled: true });
    const soilSource = sources.find(s => s.key.includes("soil") || s.key.includes("ssurgo"));
    
    if (!options.forceRefresh && soilSource) {
      const cached = await this.getCachedData(lookupKey, soilSource.id);
      if (cached && cached.data) {
        return {
          success: true,
          source: soilSource.title,
          data: cached.data,
          cachedAt: cached.fetchedAt || undefined,
          fromCache: true,
        };
      }
    }

    try {
      const soilData = await this.querySoilService(options.latitude, options.longitude);
      
      if (soilSource) {
        await this.cacheData(soilSource.id, lookupKey, soilData, options.state, options.county);
      }
      
      return {
        success: true,
        source: "USDA NRCS Soil Survey",
        data: soilData,
        fromCache: false,
      };
    } catch (error) {
      console.error("USDA soil lookup error:", error);
      return {
        success: false,
        source: "USDA NRCS Soil Survey",
        data: { message: "Soil data unavailable" },
        fromCache: false,
      };
    }
  }

  private async querySoilService(lat: number, lng: number): Promise<any> {
    const baseUrl = "https://SDMDataAccess.nrcs.usda.gov/Tabular/post.rest";
    
    const query = `SELECT musym, muname, mukind, hydgrpdcd, drclassdcd
      FROM mapunit
      INNER JOIN component ON component.mukey = mapunit.mukey
      WHERE mupolygonkey IN (
        SELECT mupolygonkey FROM mupolygon
        WHERE mupolygonGeometry.STContains(geometry::Point(${lng}, ${lat}, 4326)) = 1
      )
      LIMIT 1`;
    
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "AcreOS Land Investment Platform" 
      },
      body: `query=${encodeURIComponent(query)}&format=json`,
      signal: AbortSignal.timeout(15000),
    });
    
    if (!response.ok) {
      throw new Error(`USDA Soil API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      soilType: data.Table?.[0]?.muname || "Unknown",
      soilSymbol: data.Table?.[0]?.musym || "Unknown",
      hydrologicGroup: data.Table?.[0]?.hydgrpdcd || "Unknown",
      drainageClass: data.Table?.[0]?.drclassdcd || "Unknown",
      source: "USDA NRCS SSURGO",
      lastUpdated: new Date().toISOString(),
    };
  }

  async lookupEpaData(options: LookupOptions): Promise<LookupResult> {
    const lookupKey = this.generateLookupKey("epa", options);
    
    const sources = await storage.getDataSources({ category: "epa_superfund", isEnabled: true });
    const epaSource = sources.find(s => s.key.includes("epa") || s.key.includes("superfund"));
    
    if (!options.forceRefresh && epaSource) {
      const cached = await this.getCachedData(lookupKey, epaSource.id);
      if (cached && cached.data) {
        return {
          success: true,
          source: epaSource.title,
          data: cached.data,
          cachedAt: cached.fetchedAt || undefined,
          fromCache: true,
        };
      }
    }

    try {
      const radiusMiles = 3;
      const epaData = await this.queryEpaService(options.latitude, options.longitude, radiusMiles);
      
      if (epaSource) {
        await this.cacheData(epaSource.id, lookupKey, epaData, options.state, options.county);
      }
      
      return {
        success: true,
        source: "EPA Envirofacts",
        data: epaData,
        fromCache: false,
      };
    } catch (error) {
      console.error("EPA data lookup error:", error);
      return {
        success: false,
        source: "EPA Envirofacts",
        data: { nearbySites: [], riskLevel: "unknown" },
        fromCache: false,
      };
    }
  }

  private async queryEpaService(lat: number, lng: number, radiusMiles: number): Promise<any> {
    const url = `https://data.epa.gov/efservice/tri_facility/latitude/${lat}/longitude/${lng}/radius/${radiusMiles}/JSON`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Land Investment Platform" },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      throw new Error(`EPA API error: ${response.status}`);
    }
    
    const sites = await response.json();
    
    return {
      nearbySites: sites.slice(0, 10).map((site: any) => ({
        name: site.FACILITY_NAME,
        address: site.STREET_ADDRESS,
        city: site.CITY,
        state: site.STATE,
        distance: "Within " + radiusMiles + " miles",
      })),
      sitesWithinRadius: sites.length,
      riskLevel: sites.length > 5 ? "elevated" : sites.length > 0 ? "low" : "none",
      source: "EPA TRI",
      lastUpdated: new Date().toISOString(),
    };
  }
}

export const dataSourceLookupService = new DataSourceLookupService();
