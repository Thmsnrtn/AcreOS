import { db } from "../db";
import { dataSources } from "@shared/schema";
import { eq, and, isNull, or, lt, sql } from "drizzle-orm";
import type { DataSource } from "@shared/schema";

export type EndpointType = 
  | "arcgis_featureserver" 
  | "arcgis_mapserver" 
  | "wms" 
  | "wfs" 
  | "geojson" 
  | "rest_json"
  | "unknown";

export type ValidationStatus = 
  | "valid" 
  | "invalid_url" 
  | "timeout" 
  | "connection_error" 
  | "unauthorized" 
  | "rate_limited"
  | "no_data"
  | "unknown_format";

export interface ValidationResult {
  sourceId: number;
  status: ValidationStatus;
  endpointType: EndpointType | null;
  latencyMs: number;
  fieldsDetected: string[];
  geometryType: string | null;
  recordCount: number | null;
  sampleData: any | null;
  errorMessage: string | null;
  validatedAt: Date;
}

export interface ValidationStats {
  total: number;
  validated: number;
  valid: number;
  invalid: number;
  pending: number;
  byCategory: Record<string, { total: number; valid: number }>;
  byEndpointType: Record<string, number>;
}

const VALIDATION_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

export class DataSourceValidator {
  private abortControllers: Map<number, AbortController> = new Map();

  async validateSource(source: DataSource): Promise<ValidationResult> {
    const startTime = Date.now();
    const result: ValidationResult = {
      sourceId: source.id,
      status: "unknown_format",
      endpointType: null,
      latencyMs: 0,
      fieldsDetected: [],
      geometryType: null,
      recordCount: null,
      sampleData: null,
      errorMessage: null,
      validatedAt: new Date(),
    };

    if (!source.apiUrl) {
      result.status = "invalid_url";
      result.errorMessage = "No API URL configured";
      result.latencyMs = Date.now() - startTime;
      await this.saveValidationResult(source.id, result);
      return result;
    }

    const controller = new AbortController();
    this.abortControllers.set(source.id, controller);
    const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

    try {
      const endpointType = this.detectEndpointType(source.apiUrl);
      result.endpointType = endpointType;

      switch (endpointType) {
        case "arcgis_featureserver":
        case "arcgis_mapserver":
          await this.validateArcGIS(source.apiUrl, result, controller.signal);
          break;
        case "wms":
          await this.validateWMS(source.apiUrl, result, controller.signal);
          break;
        case "wfs":
          await this.validateWFS(source.apiUrl, result, controller.signal);
          break;
        case "geojson":
          await this.validateGeoJSON(source.apiUrl, result, controller.signal);
          break;
        case "rest_json":
          await this.validateRestJSON(source.apiUrl, result, controller.signal);
          break;
        default:
          await this.validateGeneric(source.apiUrl, result, controller.signal);
      }

      result.latencyMs = Date.now() - startTime;
    } catch (error: any) {
      result.latencyMs = Date.now() - startTime;
      if (error.name === "AbortError") {
        result.status = "timeout";
        result.errorMessage = `Request timed out after ${VALIDATION_TIMEOUT_MS}ms`;
      } else if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        result.status = "connection_error";
        result.errorMessage = error.message;
      } else {
        result.status = "unknown_format";
        result.errorMessage = error.message?.substring(0, 500) || "Unknown error";
      }
    } finally {
      clearTimeout(timeout);
      this.abortControllers.delete(source.id);
    }

    await this.saveValidationResult(source.id, result);
    return result;
  }

  private detectEndpointType(url: string): EndpointType {
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.includes("/featureserver") || lowerUrl.includes("/feature_server")) {
      return "arcgis_featureserver";
    }
    if (lowerUrl.includes("/mapserver") || lowerUrl.includes("/map_server")) {
      return "arcgis_mapserver";
    }
    if (lowerUrl.includes("wms") || lowerUrl.includes("service=wms")) {
      return "wms";
    }
    if (lowerUrl.includes("wfs") || lowerUrl.includes("service=wfs")) {
      return "wfs";
    }
    if (lowerUrl.endsWith(".geojson") || lowerUrl.includes("geojson")) {
      return "geojson";
    }
    if (lowerUrl.includes("rest/services") || lowerUrl.includes("arcgis")) {
      return "arcgis_featureserver";
    }
    
    return "rest_json";
  }

  private async validateArcGIS(url: string, result: ValidationResult, signal: AbortSignal): Promise<void> {
    let baseUrl = url;
    if (!baseUrl.endsWith("/")) baseUrl += "/";
    if (!baseUrl.includes("?")) {
      baseUrl = baseUrl.replace(/\/+$/, "");
    }

    const metadataUrl = `${baseUrl}?f=json`;
    
    const metaResponse = await fetch(metadataUrl, { 
      signal,
      headers: { "Accept": "application/json" }
    });

    if (!metaResponse.ok) {
      if (metaResponse.status === 401 || metaResponse.status === 403) {
        result.status = "unauthorized";
        result.errorMessage = `HTTP ${metaResponse.status}: Access denied`;
        return;
      }
      if (metaResponse.status === 429) {
        result.status = "rate_limited";
        result.errorMessage = "Rate limited by server";
        return;
      }
      result.status = "connection_error";
      result.errorMessage = `HTTP ${metaResponse.status}`;
      return;
    }

    const metadata = await metaResponse.json();
    
    if (metadata.error) {
      result.status = "invalid_url";
      result.errorMessage = metadata.error.message || "ArcGIS error response";
      return;
    }

    if (metadata.fields && Array.isArray(metadata.fields)) {
      result.fieldsDetected = metadata.fields.map((f: any) => f.name || f.alias).filter(Boolean);
    }

    if (metadata.geometryType) {
      result.geometryType = metadata.geometryType;
    }

    if (typeof metadata.count === "number") {
      result.recordCount = metadata.count;
    }

    const queryUrl = `${baseUrl}/query?where=1=1&outFields=*&resultRecordCount=1&f=geojson`;
    
    try {
      const queryResponse = await fetch(queryUrl, { 
        signal,
        headers: { "Accept": "application/json" }
      });

      if (queryResponse.ok) {
        const queryData = await queryResponse.json();
        
        if (queryData.features && queryData.features.length > 0) {
          result.status = "valid";
          result.sampleData = queryData.features[0];
          result.recordCount = queryData.features.length;
          
          if (queryData.features[0]?.geometry?.type) {
            result.geometryType = queryData.features[0].geometry.type;
          }
          
          if (queryData.features[0]?.properties) {
            result.fieldsDetected = Object.keys(queryData.features[0].properties);
          }
        } else if (queryData.error) {
          result.status = "no_data";
          result.errorMessage = queryData.error.message || "Query returned error";
        } else {
          result.status = "no_data";
          result.errorMessage = "No features returned from query";
        }
      }
    } catch (queryError: any) {
      if (result.fieldsDetected.length > 0 || result.geometryType) {
        result.status = "valid";
      } else {
        result.status = "no_data";
        result.errorMessage = "Could not query features";
      }
    }
  }

  private async validateWMS(url: string, result: ValidationResult, signal: AbortSignal): Promise<void> {
    const capabilitiesUrl = url.includes("?") 
      ? `${url}&service=WMS&request=GetCapabilities`
      : `${url}?service=WMS&request=GetCapabilities`;

    const response = await fetch(capabilitiesUrl, { signal });
    
    if (!response.ok) {
      result.status = "connection_error";
      result.errorMessage = `HTTP ${response.status}`;
      return;
    }

    const text = await response.text();
    
    if (text.includes("<WMS_Capabilities") || text.includes("<WMT_MS_Capabilities")) {
      result.status = "valid";
      result.geometryType = "raster";
      
      const layerMatches = text.match(/<Layer[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g);
      if (layerMatches) {
        result.fieldsDetected = layerMatches
          .map(m => m.match(/<Name>([^<]+)<\/Name>/)?.[1])
          .filter(Boolean) as string[];
        result.recordCount = result.fieldsDetected.length;
      }
    } else {
      result.status = "unknown_format";
      result.errorMessage = "Invalid WMS response";
    }
  }

  private async validateWFS(url: string, result: ValidationResult, signal: AbortSignal): Promise<void> {
    const capabilitiesUrl = url.includes("?")
      ? `${url}&service=WFS&request=GetCapabilities`
      : `${url}?service=WFS&request=GetCapabilities`;

    const response = await fetch(capabilitiesUrl, { signal });
    
    if (!response.ok) {
      result.status = "connection_error";
      result.errorMessage = `HTTP ${response.status}`;
      return;
    }

    const text = await response.text();
    
    if (text.includes("<wfs:WFS_Capabilities") || text.includes("<WFS_Capabilities")) {
      result.status = "valid";
      
      const featureTypeMatches = text.match(/<FeatureType[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g);
      if (featureTypeMatches) {
        result.fieldsDetected = featureTypeMatches
          .map(m => m.match(/<Name>([^<]+)<\/Name>/)?.[1])
          .filter(Boolean) as string[];
        result.recordCount = result.fieldsDetected.length;
      }
    } else {
      result.status = "unknown_format";
      result.errorMessage = "Invalid WFS response";
    }
  }

  private async validateGeoJSON(url: string, result: ValidationResult, signal: AbortSignal): Promise<void> {
    const response = await fetch(url, { 
      signal,
      headers: { "Accept": "application/json, application/geo+json" }
    });
    
    if (!response.ok) {
      result.status = "connection_error";
      result.errorMessage = `HTTP ${response.status}`;
      return;
    }

    const data = await response.json();
    
    if (data.type === "FeatureCollection" && data.features) {
      result.status = "valid";
      result.recordCount = data.features.length;
      
      if (data.features.length > 0) {
        result.sampleData = data.features[0];
        result.geometryType = data.features[0]?.geometry?.type;
        if (data.features[0]?.properties) {
          result.fieldsDetected = Object.keys(data.features[0].properties);
        }
      }
    } else if (data.type === "Feature") {
      result.status = "valid";
      result.recordCount = 1;
      result.sampleData = data;
      result.geometryType = data.geometry?.type;
      if (data.properties) {
        result.fieldsDetected = Object.keys(data.properties);
      }
    } else {
      result.status = "unknown_format";
      result.errorMessage = "Not a valid GeoJSON response";
    }
  }

  private async validateRestJSON(url: string, result: ValidationResult, signal: AbortSignal): Promise<void> {
    const response = await fetch(url, { 
      signal,
      headers: { "Accept": "application/json" }
    });
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        result.status = "unauthorized";
      } else if (response.status === 429) {
        result.status = "rate_limited";
      } else {
        result.status = "connection_error";
      }
      result.errorMessage = `HTTP ${response.status}`;
      return;
    }

    const data = await response.json();
    
    if (typeof data === "object" && data !== null) {
      result.status = "valid";
      result.sampleData = data;
      
      if (Array.isArray(data)) {
        result.recordCount = data.length;
        if (data.length > 0 && typeof data[0] === "object") {
          result.fieldsDetected = Object.keys(data[0]);
        }
      } else {
        result.fieldsDetected = Object.keys(data);
      }
    } else {
      result.status = "unknown_format";
      result.errorMessage = "Response is not valid JSON object";
    }
  }

  private async validateGeneric(url: string, result: ValidationResult, signal: AbortSignal): Promise<void> {
    const response = await fetch(url, { 
      signal,
      method: "HEAD"
    });
    
    if (response.ok) {
      result.status = "valid";
      const contentType = response.headers.get("content-type");
      if (contentType) {
        result.errorMessage = `Responds with: ${contentType}`;
      }
    } else {
      result.status = "connection_error";
      result.errorMessage = `HTTP ${response.status}`;
    }
  }

  private async saveValidationResult(sourceId: number, result: ValidationResult): Promise<void> {
    try {
      await db.update(dataSources)
        .set({
          isVerified: result.status === "valid",
          lastVerifiedAt: result.validatedAt,
          lastStatus: result.status,
          lastStatusMessage: result.errorMessage || (result.status === "valid" ? "OK" : null),
          endpointType: result.endpointType,
          updatedAt: new Date(),
        })
        .where(eq(dataSources.id, sourceId));
    } catch (error) {
      console.error(`[DataSourceValidator] Failed to save validation result for source ${sourceId}:`, error);
    }
  }

  async validateBatch(sources: DataSource[], concurrency: number = 5): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const queue = [...sources];
    const inProgress: Promise<void>[] = [];

    const processNext = async () => {
      if (queue.length === 0) return;
      
      const source = queue.shift()!;
      try {
        const result = await this.validateSource(source);
        results.push(result);
      } catch (error) {
        console.error(`[DataSourceValidator] Error validating source ${source.id}:`, error);
      }
      
      await processNext();
    };

    for (let i = 0; i < Math.min(concurrency, sources.length); i++) {
      inProgress.push(processNext());
    }

    await Promise.all(inProgress);
    return results;
  }

  async getValidationStats(): Promise<ValidationStats> {
    const allSources = await db.select({
      id: dataSources.id,
      category: dataSources.category,
      isVerified: dataSources.isVerified,
      lastStatus: dataSources.lastStatus,
      lastVerifiedAt: dataSources.lastVerifiedAt,
      endpointType: dataSources.endpointType,
    }).from(dataSources);

    const stats: ValidationStats = {
      total: allSources.length,
      validated: 0,
      valid: 0,
      invalid: 0,
      pending: 0,
      byCategory: {},
      byEndpointType: {},
    };

    for (const source of allSources) {
      const category = source.category || "unknown";
      
      if (!stats.byCategory[category]) {
        stats.byCategory[category] = { total: 0, valid: 0 };
      }
      stats.byCategory[category].total++;

      if (source.lastVerifiedAt) {
        stats.validated++;
        if (source.isVerified || source.lastStatus === "valid") {
          stats.valid++;
          stats.byCategory[category].valid++;
        } else {
          stats.invalid++;
        }
      } else {
        stats.pending++;
      }

      if (source.endpointType) {
        stats.byEndpointType[source.endpointType] = (stats.byEndpointType[source.endpointType] || 0) + 1;
      }
    }

    return stats;
  }

  async getSourcesNeedingValidation(limit: number = 100, category?: string): Promise<DataSource[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let query = db.select().from(dataSources)
      .where(and(
        eq(dataSources.isEnabled, true),
        sql`${dataSources.apiUrl} IS NOT NULL AND ${dataSources.apiUrl} != ''`,
        or(
          isNull(dataSources.lastVerifiedAt),
          lt(dataSources.lastVerifiedAt, thirtyDaysAgo)
        )
      ))
      .orderBy(sql`${dataSources.lastVerifiedAt} NULLS FIRST`)
      .limit(limit);

    if (category) {
      query = db.select().from(dataSources)
        .where(and(
          eq(dataSources.isEnabled, true),
          eq(dataSources.category, category),
          sql`${dataSources.apiUrl} IS NOT NULL AND ${dataSources.apiUrl} != ''`,
          or(
            isNull(dataSources.lastVerifiedAt),
            lt(dataSources.lastVerifiedAt, thirtyDaysAgo)
          )
        ))
        .orderBy(sql`${dataSources.lastVerifiedAt} NULLS FIRST`)
        .limit(limit);
    }

    return await query;
  }

  cancelValidation(sourceId: number): boolean {
    const controller = this.abortControllers.get(sourceId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sourceId);
      return true;
    }
    return false;
  }
}

export const dataSourceValidator = new DataSourceValidator();
