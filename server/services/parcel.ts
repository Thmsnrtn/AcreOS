/**
 * Parcel Boundary Service - Tiered Lookup System
 * Priority: Cache (instant) -> County GIS (free) -> RapidAPI (cheap) -> Regrid API (paid fallback)
 * 
 * Cache freshness: 30 days
 */

import { db } from "../db";
import { countyGisEndpoints, type InsertParcelSnapshot } from "@shared/schema";
import { eq, and, ilike } from "drizzle-orm";
import { storage } from "../storage";

interface RegridParcel {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    ll_uuid: string;
    parcelnumb: string;
    owner: string;
    mail_addno?: string;
    mail_addpref?: string;
    mail_addstr?: string;
    mail_addsttyp?: string;
    mail_addr2?: string;
    mail_city?: string;
    mail_state2?: string;
    mail_zip?: string;
    saddno?: string;
    saddpref?: string;
    saddstr?: string;
    saddsttyp?: string;
    scity?: string;
    szip?: string;
    state2?: string;
    county?: string;
    ll_gisacre?: number;
    ll_stable_id?: string;
    path?: string;
    lat?: number;
    lon?: number;
    taxamt?: string;
    [key: string]: unknown;
  };
}

interface RegridResponse {
  results?: RegridParcel[];
  parcels?: {
    type: "FeatureCollection";
    features: RegridParcel[];
  };
  status?: string;
  message?: string;
}

export interface ParcelLookupResult {
  found: boolean;
  source?: "county_gis" | "regrid" | "rapidapi" | "cache";
  parcel?: {
    apn: string;
    boundary: {
      type: "Polygon" | "MultiPolygon";
      coordinates: number[][][] | number[][][][];
    };
    centroid: {
      lat: number;
      lng: number;
    };
    data: {
      regridId: string;
      owner: string;
      ownerAddress: string;
      taxAmount: string;
      lastUpdated: string;
      acres?: number;
      county?: string;
      state?: string;
    };
  };
  error?: string;
}

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
    x?: number;
    y?: number;
  };
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  error?: { message: string };
}

function calculateCentroid(geometry: GeoJSON.Geometry | RegridParcel["geometry"]): { lat: number; lng: number } {
  // Handle Point geometry - return the point itself as centroid
  if (geometry.type === "Point") {
    const coords = geometry.coordinates as number[];
    return { lng: coords[0], lat: coords[1] };
  }
  
  // Handle LineString - use midpoint
  if (geometry.type === "LineString") {
    const coords = geometry.coordinates as number[][];
    if (coords.length === 0) return { lat: 0, lng: 0 };
    const mid = Math.floor(coords.length / 2);
    return { lng: coords[mid][0], lat: coords[mid][1] };
  }
  
  let coords: number[][] = [];
  
  if (geometry.type === "Polygon") {
    coords = (geometry.coordinates as number[][][])[0] as number[][];
  } else if (geometry.type === "MultiPolygon") {
    coords = ((geometry.coordinates as number[][][][])[0] as number[][][])[0];
  }
  
  if (!coords || coords.length === 0) {
    return { lat: 0, lng: 0 };
  }
  
  let totalLng = 0;
  let totalLat = 0;
  
  for (const coord of coords) {
    totalLng += coord[0];
    totalLat += coord[1];
  }
  
  return {
    lng: totalLng / coords.length,
    lat: totalLat / coords.length,
  };
}

/**
 * Convert Web Mercator (EPSG:3857) to WGS84 (EPSG:4326)
 * Used when ArcGIS returns coordinates in meters instead of degrees
 */
function webMercatorToWGS84(x: number, y: number): { lat: number; lng: number } {
  const lng = (x * 180) / 20037508.34;
  const lat = (Math.atan(Math.exp((y * Math.PI) / 20037508.34)) * 360) / Math.PI - 90;
  return { lat, lng };
}

/**
 * Check if coordinates are in Web Mercator format (very large values)
 * and convert to WGS84 if needed
 */
function normalizeCoordinates(lat: number, lng: number): { lat: number; lng: number } {
  // If values are way outside normal lat/lng range, they're likely Web Mercator
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    // Web Mercator: x is longitude, y is latitude in meters
    return webMercatorToWGS84(lng, lat);
  }
  return { lat, lng };
}

/**
 * Validate that coordinates are within valid WGS84 bounds
 */
function isValidLatLng(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Convert polygon ring coordinates from Web Mercator to WGS84 if needed
 * ArcGIS rings are [lng, lat] pairs (x, y in Web Mercator)
 */
function normalizePolygonRings(rings: number[][][]): number[][][] {
  return rings.map(ring => 
    ring.map(coord => {
      const x = coord[0]; // lng in degrees or x in meters
      const y = coord[1]; // lat in degrees or y in meters
      
      // Check if coordinates are in Web Mercator (very large values)
      if (Math.abs(x) > 180 || Math.abs(y) > 90) {
        const converted = webMercatorToWGS84(x, y);
        return [converted.lng, converted.lat];
      }
      return [x, y];
    })
  );
}

function formatOwnerAddress(props: RegridParcel["properties"]): string {
  const parts = [
    props.mail_addno,
    props.mail_addpref,
    props.mail_addstr,
    props.mail_addsttyp,
  ].filter(Boolean).join(" ");
  
  const cityStateZip = [
    props.mail_city,
    props.mail_state2,
    props.mail_zip,
  ].filter(Boolean).join(", ");
  
  return [parts, props.mail_addr2, cityStateZip].filter(Boolean).join(", ");
}

/**
 * Lookup parcel from County GIS endpoint
 */
async function lookupFromCountyGIS(
  apn: string,
  state: string,
  county: string
): Promise<ParcelLookupResult | null> {
  try {
    const normalizedCounty = county.toLowerCase().replace(/ county$/i, "").trim();
    const normalizedState = state.toUpperCase();
    
    // Single efficient query to find matching endpoint
    const endpoints = await db
      .select()
      .from(countyGisEndpoints)
      .where(
        and(
          eq(countyGisEndpoints.state, normalizedState),
          eq(countyGisEndpoints.isActive, true)
        )
      );
    
    // Find the endpoint matching the county (case-insensitive)
    const matchingEndpoint = endpoints.find(e => 
      e.county.toLowerCase().replace(/ county$/i, "").trim() === normalizedCounty
    );
    
    if (!matchingEndpoint) {
      console.log(`[CountyGIS] No endpoint for ${county}, ${state} (checked ${endpoints.length} state endpoints)`);
      return null;
    }
    
    console.log(`[CountyGIS] Found endpoint for ${county}, ${state}: ${matchingEndpoint.endpointType}`);
    
    if (matchingEndpoint.endpointType === "arcgis_rest" || matchingEndpoint.endpointType === "arcgis_feature") {
      return await queryArcGISEndpoint(apn, matchingEndpoint);
    }
    
    console.log(`[CountyGIS] Unsupported endpoint type: ${matchingEndpoint.endpointType}`);
    return null;
  } catch (error) {
    console.error("[CountyGIS] Lookup error:", error);
    return null;
  }
}

/**
 * Query ArcGIS REST endpoint for parcel data
 */
async function queryArcGISEndpoint(
  apn: string,
  endpoint: typeof countyGisEndpoints.$inferSelect
): Promise<ParcelLookupResult | null> {
  try {
    const apnField = endpoint.apnField || "APN";
    const cleanApn = apn.replace(/[-\s]/g, "");
    
    const apnVariants = [
      cleanApn,
      apn.trim(),
      cleanApn.replace(/^0+/, ""),
    ].filter((v, i, arr) => arr.indexOf(v) === i);
    
    for (const apnVariant of apnVariants) {
      const baseUrl = endpoint.baseUrl.replace(/\/$/, "");
      const layerId = endpoint.layerId || "0";
      
      const whereClause = `${apnField} = '${apnVariant}'`;
      const params = new URLSearchParams({
        where: whereClause,
        outFields: "*",
        returnGeometry: "true",
        f: "json",
        ...((endpoint.additionalParams as Record<string, string>) || {}),
      });
      
      const url = `${baseUrl}/${layerId}/query?${params.toString()}`;
      console.log(`[CountyGIS] Querying: ${url.substring(0, 100)}...`);
      
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
      });
      
      if (!response.ok) continue;
      
      const data = await response.json() as ArcGISResponse;
      
      if (data.error) {
        console.log(`[CountyGIS] API error: ${data.error.message}`);
        continue;
      }
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const attrs = feature.attributes;
        const mappings = (endpoint.fieldMappings as Record<string, string>) || {};
        
        let geometry: ParcelLookupResult["parcel"];
        let centroid = { lat: 0, lng: 0 };
        
        if (feature.geometry?.rings) {
          const rings = feature.geometry.rings;
          // Convert boundary coordinates from Web Mercator to WGS84 if needed
          const normalizedRings = normalizePolygonRings(rings);
          geometry = {
            apn: String(attrs[mappings.apn || apnField] || apn),
            boundary: {
              type: "Polygon" as const,
              coordinates: normalizedRings,
            },
            centroid: { lat: 0, lng: 0 },
            data: {
              regridId: "",
              owner: String(attrs[mappings.owner || endpoint.ownerField || "OWNER"] || "Unknown"),
              ownerAddress: String(attrs[mappings.address || "SITUS"] || ""),
              taxAmount: String(attrs[mappings.taxAmount || "TAXAMT"] || ""),
              lastUpdated: new Date().toISOString(),
              acres: attrs[mappings.acres || "ACRES"] as number | undefined,
              county: endpoint.county,
              state: endpoint.state,
            },
          };
          
          const firstRing = rings[0] || [];
          if (firstRing.length > 0) {
            let sumX = 0, sumY = 0;
            for (const coord of firstRing) {
              sumX += coord[0];
              sumY += coord[1];
            }
            const rawCentroid = {
              lng: sumX / firstRing.length,
              lat: sumY / firstRing.length,
            };
            // Convert from Web Mercator if needed
            centroid = normalizeCoordinates(rawCentroid.lat, rawCentroid.lng);
          }
          geometry.centroid = centroid;
        } else {
          // Normalize coordinates from potential Web Mercator format
          const rawLat = feature.geometry?.y || 0;
          const rawLng = feature.geometry?.x || 0;
          const normalized = normalizeCoordinates(rawLat, rawLng);
          
          geometry = {
            apn: String(attrs[mappings.apn || apnField] || apn),
            boundary: {
              type: "Polygon" as const,
              coordinates: [],
            },
            centroid: normalized,
            data: {
              regridId: "",
              owner: String(attrs[mappings.owner || endpoint.ownerField || "OWNER"] || "Unknown"),
              ownerAddress: String(attrs[mappings.address || "SITUS"] || ""),
              taxAmount: String(attrs[mappings.taxAmount || "TAXAMT"] || ""),
              lastUpdated: new Date().toISOString(),
              acres: attrs[mappings.acres || "ACRES"] as number | undefined,
              county: endpoint.county,
              state: endpoint.state,
            },
          };
        }
        
        console.log(`[CountyGIS] Found parcel via ${endpoint.county}, ${endpoint.state}`);
        
        await db
          .update(countyGisEndpoints)
          .set({ 
            lastVerified: new Date(),
            isVerified: true,
            errorCount: 0,
          })
          .where(eq(countyGisEndpoints.id, endpoint.id));
        
        return {
          found: true,
          source: "county_gis",
          parcel: geometry,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[CountyGIS] Query error for ${endpoint.county}:`, error);
    
    await db
      .update(countyGisEndpoints)
      .set({ 
        errorCount: (endpoint.errorCount || 0) + 1,
        lastError: error instanceof Error ? error.message : String(error),
      })
      .where(eq(countyGisEndpoints.id, endpoint.id));
    
    return null;
  }
}

/**
 * Cache freshness in days
 */
const CACHE_FRESHNESS_DAYS = 30;

/**
 * Convert cached snapshot to ParcelLookupResult format
 */
function snapshotToResult(snapshot: {
  apn: string;
  boundary: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][]; } | null;
  centroid: { lat: number; lng: number } | null;
  owner: string | null;
  ownerAddress: string | null;
  taxAmount: string | null;
  acres: string | null;
  county: string;
  state: string;
  sourceId: string | null;
  fetchedAt: Date | null;
}): ParcelLookupResult {
  return {
    found: true,
    source: "cache",
    parcel: {
      apn: snapshot.apn,
      boundary: snapshot.boundary || { type: "Polygon", coordinates: [] },
      centroid: snapshot.centroid || { lat: 0, lng: 0 },
      data: {
        regridId: snapshot.sourceId || "",
        owner: snapshot.owner || "Unknown",
        ownerAddress: snapshot.ownerAddress || "",
        taxAmount: snapshot.taxAmount || "",
        lastUpdated: snapshot.fetchedAt?.toISOString() || new Date().toISOString(),
        acres: snapshot.acres ? parseFloat(snapshot.acres) : undefined,
        county: snapshot.county,
        state: snapshot.state,
      },
    },
  };
}

/**
 * Store parcel result in cache
 */
async function cacheParcelResult(result: ParcelLookupResult, state: string, county: string): Promise<void> {
  if (!result.found || !result.parcel) return;
  
  try {
    const snapshotData: InsertParcelSnapshot = {
      apn: result.parcel.apn,
      state: state.toUpperCase(),
      county: county,
      source: result.source === "regrid" ? "regrid" : "county_gis",
      sourceId: result.parcel.data.regridId || null,
      boundary: result.parcel.boundary,
      centroid: result.parcel.centroid,
      owner: result.parcel.data.owner,
      ownerAddress: result.parcel.data.ownerAddress,
      acres: result.parcel.data.acres?.toString() || null,
      taxAmount: result.parcel.data.taxAmount || null,
    };
    
    await storage.upsertParcelSnapshot(snapshotData);
    console.log(`[ParcelCache] Cached parcel ${result.parcel.apn} for ${county}, ${state}`);
  } catch (error) {
    console.error(`[ParcelCache] Failed to cache parcel:`, error);
  }
}

/**
 * Tiered parcel lookup: Cache (instant) -> County GIS (free) -> RapidAPI (cheap BYOK) -> Regrid (paid)
 */
export async function lookupParcelByAPN(
  apn: string,
  stateCountyPath?: string,
  organizationId?: number
): Promise<ParcelLookupResult> {
  let state = "";
  let county = "";
  
  if (stateCountyPath) {
    const parts = stateCountyPath.replace(/^\/us\//i, "").split("/");
    if (parts.length >= 1) state = parts[0].toUpperCase();
    if (parts.length >= 2) county = parts[1].replace(/-/g, " ");
  }
  
  // Step 1: Check cache first (if we have state/county)
  if (state && county) {
    try {
      const cachedSnapshot = await storage.getParcelSnapshot(apn, state, county, CACHE_FRESHNESS_DAYS);
      if (cachedSnapshot) {
        console.log(`[Parcel] Found in cache (age: ${Math.round((Date.now() - (cachedSnapshot.fetchedAt?.getTime() || 0)) / (1000 * 60 * 60 * 24))} days)`);
        return snapshotToResult(cachedSnapshot);
      }
    } catch (error) {
      console.error(`[ParcelCache] Cache lookup error:`, error);
    }
  }
  
  // Step 2: Try County GIS (free)
  if (state && county) {
    const countyResult = await lookupFromCountyGIS(apn, state, county);
    if (countyResult?.found) {
      console.log(`[Parcel] Found via County GIS (FREE)`);
      await cacheParcelResult(countyResult, state, county);
      return countyResult;
    }
  }
  
  // Step 3: Try RapidAPI Property Lines (cheaper than Regrid) - requires org key (BYOK)
  if (organizationId) {
    const rapidApiResult = await lookupFromRapidAPI(apn, state, county, organizationId);
    if (rapidApiResult?.found) {
      console.log(`[Parcel] Found via RapidAPI Property Lines (CHEAP BYOK)`);
      await cacheParcelResult(rapidApiResult, state, county);
      return rapidApiResult;
    }
  }
  
  // Step 4: Fall back to Regrid (paid, most expensive)
  console.log(`[Parcel] Falling back to Regrid API`);
  const regridResult = await lookupFromRegrid(apn, stateCountyPath);
  
  // Cache Regrid results too
  if (regridResult.found && state && county) {
    await cacheParcelResult(regridResult, state, county);
  }
  
  return regridResult;
}

/**
 * RapidAPI Property Lines lookup (cheaper than Regrid)
 * Uses BYOK credentials from organization's integration settings
 */
async function lookupFromRapidAPI(
  apn: string,
  state: string,
  county: string,
  organizationId: number
): Promise<ParcelLookupResult | null> {
  // Fetch org-specific RapidAPI key from BYOK integration settings
  let rapidApiKey: string | null = null;
  
  try {
    const integration = await storage.getOrganizationIntegration(organizationId, "rapidapi");
    if (integration?.credentials?.apiKey) {
      rapidApiKey = integration.credentials.apiKey;
      console.log(`[RapidAPI] Using org BYOK key for org ${organizationId}`);
    }
  } catch (error) {
    console.error(`[RapidAPI] Failed to get org integration:`, error);
  }
  
  // Fall back to environment variable for single-tenant deployments
  if (!rapidApiKey) {
    rapidApiKey = process.env.RAPIDAPI_KEY || null;
  }
  
  if (!rapidApiKey) {
    console.log(`[RapidAPI] No RapidAPI key configured, skipping`);
    return null;
  }
  
  try {
    // RapidAPI Property Lines works with lat/lng, not APN directly
    // We need coordinates - if we don't have them, we can't use this API
    // Try to get coordinates from a geocoding step or skip
    
    // For now, try the parcel lookup by address approach
    // The API has an endpoint to get boundaries by coordinates
    const stateCode = state.toUpperCase();
    
    // Try to look up using the get_boundaries_by_coordinate endpoint
    // First, we need coordinates. Let's see if we can get them from a basic geocode
    const geocodeUrl = `https://property-lines.p.rapidapi.com/get_parcel?state_code=${stateCode}&parcel_number=${encodeURIComponent(apn)}`;
    
    console.log(`[RapidAPI] Trying parcel lookup: ${apn} in ${stateCode}`);
    
    const response = await fetch(geocodeUrl, {
      method: "GET",
      headers: {
        "x-rapidapi-host": "property-lines.p.rapidapi.com",
        "x-rapidapi-key": rapidApiKey,
      },
      signal: AbortSignal.timeout(15000),
    });
    
    if (!response.ok) {
      console.log(`[RapidAPI] Response status: ${response.status}`);
      if (response.status === 401 || response.status === 403) {
        console.log(`[RapidAPI] Auth error - key may be invalid`);
        return null;
      }
      return null;
    }
    
    const data = await response.json();
    console.log(`[RapidAPI] Response keys:`, Object.keys(data));
    
    // Parse the response - Property Lines API returns GeoJSON features
    if (data.type === "FeatureCollection" && data.features?.length > 0) {
      const feature = data.features[0];
      const geometry = feature.geometry;
      const props = feature.properties || {};
      
      if (geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon")) {
        const centroid = calculateCentroid(geometry);
        
        return {
          found: true,
          source: "rapidapi",
          parcel: {
            apn: props.parcel_number || props.apn || apn,
            boundary: geometry,
            centroid,
            data: {
              regridId: props.id || "",
              owner: props.owner || "Unknown",
              ownerAddress: props.owner_address || "",
              taxAmount: props.tax_amount || "",
              lastUpdated: new Date().toISOString(),
              acres: props.acres || props.area_acres,
              county: county,
              state: state,
            },
          },
        };
      }
    }
    
    // Try alternate response format
    if (data.geometry && (data.geometry.type === "Polygon" || data.geometry.type === "MultiPolygon")) {
      const centroid = calculateCentroid(data.geometry);
      
      return {
        found: true,
        source: "rapidapi",
        parcel: {
          apn: data.parcel_number || data.apn || apn,
          boundary: data.geometry,
          centroid,
          data: {
            regridId: data.id || "",
            owner: data.owner || "Unknown",
            ownerAddress: data.owner_address || "",
            taxAmount: data.tax_amount || "",
            lastUpdated: new Date().toISOString(),
            acres: data.acres || data.area_acres,
            county: county,
            state: state,
          },
        },
      };
    }
    
    console.log(`[RapidAPI] No parcel geometry found in response`);
    return null;
  } catch (error) {
    console.error("[RapidAPI] Lookup error:", error);
    return null;
  }
}

/**
 * Regrid API lookup (paid fallback)
 */
async function lookupFromRegrid(
  apn: string,
  stateCountyPath?: string
): Promise<ParcelLookupResult> {
  const token = process.env.REGRID_API_KEY;
  
  if (!token) {
    return {
      found: false,
      error: "Regrid API key not configured. Please add REGRID_API_KEY to secrets.",
    };
  }
  
  try {
    const cleanApn = apn.replace(/[-\s]/g, "");
    
    const apnVariants = [
      cleanApn,
      apn.trim(),
      cleanApn.replace(/^0+/, ""),
    ].filter((v, i, arr) => arr.indexOf(v) === i);
    
    let data: RegridResponse | null = null;
    
    for (const apnVariant of apnVariants) {
      // Use the correct APN endpoint
      let url = `https://app.regrid.com/api/v2/parcels/apn?parcelnumb=${encodeURIComponent(apnVariant)}&token=${token}&return_custom=true`;
      
      if (stateCountyPath) {
        url += `&path=${encodeURIComponent(stateCountyPath)}`;
      }
      
      console.log(`[Regrid] Trying APN lookup: ${apnVariant}`);
      console.log(`[Regrid] URL: ${url.replace(token, 'REDACTED')}`);
      
      const response = await fetch(url);
      console.log(`[Regrid] Response status: ${response.status}`);
      
      if (response.ok) {
        const result = await response.json() as RegridResponse;
        console.log(`[Regrid] Response keys:`, Object.keys(result));
        
        if (result.status === "error") {
          console.log(`[Regrid] Account error: ${result.message}`);
          return { 
            found: false, 
            error: "Regrid API account issue: Your API key may not have parcel data access." 
          };
        }
        
        const features = result.parcels?.features || result.results || [];
        console.log(`[Regrid] Found ${features.length} features`);
        if (features.length > 0) {
          data = { ...result, results: features };
          break;
        }
      } else if (response.status === 401 || response.status === 403) {
        const errorText = await response.text();
        console.log(`[Regrid] Auth error: ${errorText}`);
        
        // Check for trial limitation
        if (errorText.includes("not included in API trials")) {
          return { found: false, error: "This area is not included in your Regrid trial. Upgrade your Regrid account or use a property in a covered area." };
        }
        return { found: false, error: "Regrid API key is invalid or expired." };
      } else {
        const errorText = await response.text();
        console.log(`[Regrid] Error response: ${errorText}`);
      }
    }
    
    const features = data?.parcels?.features || data?.results || [];
    
    if (!data || features.length === 0) {
      return { found: false, error: `Parcel not found for APN: ${apn}` };
    }
    
    const parcel = features[0];
    // Regrid v2 API nests properties under properties.fields
    const rawProps = parcel.properties?.fields || parcel.properties || {};
    const props = rawProps as Record<string, any>;
    
    console.log(`[Regrid] Parcel properties keys:`, Object.keys(props).slice(0, 20));
    
    const centroid = props.lat && props.lon
      ? { lat: Number(props.lat), lng: Number(props.lon) }
      : calculateCentroid(parcel.geometry);
    
    return {
      found: true,
      source: "regrid",
      parcel: {
        apn: props.parcelnumb || apn,
        boundary: parcel.geometry,
        centroid,
        data: {
          regridId: props.ll_uuid || props.ll_stable_id || "",
          owner: props.owner || "Unknown",
          ownerAddress: formatOwnerAddress(props as any),
          taxAmount: props.taxamt || "",
          lastUpdated: new Date().toISOString(),
          acres: props.ll_gisacre,
          county: props.county,
          state: props.state2,
        },
      },
    };
  } catch (error) {
    console.error("Regrid lookup error:", error);
    return {
      found: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Lookup parcel by coordinates
 */
export async function lookupParcelByCoordinates(
  lat: number,
  lng: number
): Promise<ParcelLookupResult> {
  const token = process.env.REGRID_API_KEY;
  
  if (!token) {
    return {
      found: false,
      error: "Regrid API key not configured. Please add REGRID_API_KEY to secrets.",
    };
  }
  
  try {
    const url = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&token=${token}&return_geometry=true`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Regrid API error: ${response.status}`);
    }
    
    const data = await response.json() as RegridResponse;
    
    if (!data.results || data.results.length === 0) {
      return { found: false, error: "No parcel found at coordinates" };
    }
    
    const parcel = data.results[0];
    const props = parcel.properties;
    
    const centroid = props.lat && props.lon
      ? { lat: props.lat, lng: props.lon }
      : { lat, lng };
    
    return {
      found: true,
      source: "regrid",
      parcel: {
        apn: props.parcelnumb || "",
        boundary: parcel.geometry,
        centroid,
        data: {
          regridId: props.ll_uuid || props.ll_stable_id || "",
          owner: props.owner || "Unknown",
          ownerAddress: formatOwnerAddress(props),
          taxAmount: props.taxamt || "",
          lastUpdated: new Date().toISOString(),
          acres: props.ll_gisacre,
          county: props.county,
          state: props.state2,
        },
      },
    };
  } catch (error) {
    console.error("Parcel coordinate lookup error:", error);
    return {
      found: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get all registered county GIS endpoints
 */
export async function getCountyGisEndpoints(): Promise<typeof countyGisEndpoints.$inferSelect[]> {
  return await db.select().from(countyGisEndpoints).orderBy(countyGisEndpoints.state, countyGisEndpoints.county);
}

/**
 * Seed initial county GIS endpoints for major land investment states
 */
export async function seedCountyGisEndpoints(): Promise<{ added: number; skipped: number }> {
  const endpoints = [
    // TEXAS - Popular land investment counties
    {
      state: "TX",
      county: "Harris",
      fipsCode: "48201",
      endpointType: "arcgis_rest",
      baseUrl: "https://pdata.hcad.org/GIS/rest/services/public/public_parcel/MapServer",
      layerId: "0",
      apnField: "HCAD_NUM",
      ownerField: "OWNER_NAME",
      fieldMappings: { apn: "HCAD_NUM", owner: "OWNER_NAME", address: "SITUS_ADDRESS", acres: "ACREAGE" },
      sourceUrl: "https://pdata.hcad.org/GIS/",
      notes: "Harris County Appraisal District",
    },
    {
      state: "TX",
      county: "Travis",
      fipsCode: "48453",
      endpointType: "arcgis_rest",
      baseUrl: "https://www.traviscad.org/gis/rest/services/GISPublic/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER_NAME",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER_NAME", acres: "ACRES" },
      sourceUrl: "https://www.traviscad.org/",
      notes: "Travis Central Appraisal District",
    },
    {
      state: "TX",
      county: "Bexar",
      fipsCode: "48029",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.bexar.org/arcgis/rest/services/Bexar/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://www.bcad.org/",
      notes: "Bexar Appraisal District",
    },
    // ARIZONA
    {
      state: "AZ",
      county: "Maricopa",
      fipsCode: "04013",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.maricopa.gov/arcgis/rest/services/Assessor/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER_NAME",
      fieldMappings: { apn: "APN", owner: "OWNER_NAME", address: "SITUS" },
      sourceUrl: "https://www.maricopa.gov/2076/GIS-Data",
      notes: "Maricopa County Assessor",
    },
    {
      state: "AZ",
      county: "Pima",
      fipsCode: "04019",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.pima.gov/arcgis/rest/services/maps/ParcelData/MapServer",
      layerId: "0",
      apnField: "PARCEL_NO",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_NO", owner: "OWNER" },
      sourceUrl: "https://gis.pima.gov/",
      notes: "Pima County GIS",
    },
    // NEW MEXICO
    {
      state: "NM",
      county: "Bernalillo",
      fipsCode: "35001",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.bernco.gov/arcgis/rest/services/parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://gis.bernco.gov/",
      notes: "Bernalillo County GIS",
    },
    // COLORADO
    {
      state: "CO",
      county: "El Paso",
      fipsCode: "08041",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.elpasoco.com/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PIN",
      ownerField: "OWNER",
      fieldMappings: { apn: "PIN", owner: "OWNER" },
      sourceUrl: "https://gis.elpasoco.com/",
      notes: "El Paso County GIS",
    },
    // NEVADA
    {
      state: "NV",
      county: "Clark",
      fipsCode: "32003",
      endpointType: "arcgis_rest",
      baseUrl: "https://gisgate.co.clark.nv.us/arcgis/rest/services/Assessor/AssessorParcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gisgate.co.clark.nv.us/",
      notes: "Clark County Assessor",
    },
    // FLORIDA
    {
      state: "FL",
      county: "Miami-Dade",
      fipsCode: "12086",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.miamidade.gov/arcgis/rest/services/Basemap/MD_Parcels/MapServer",
      layerId: "0",
      apnField: "FOLIO",
      ownerField: "OWNER1",
      fieldMappings: { apn: "FOLIO", owner: "OWNER1", address: "ADDR" },
      sourceUrl: "https://gisweb.miamidade.gov/",
      notes: "Miami-Dade County GIS",
    },
    {
      state: "FL",
      county: "Orange",
      fipsCode: "12095",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.ocpafl.org/arcgis/rest/services/Property/Property_Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER_NAME",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER_NAME" },
      sourceUrl: "https://www.ocpafl.org/",
      notes: "Orange County Property Appraiser",
    },
    // CALIFORNIA
    {
      state: "CA",
      county: "Los Angeles",
      fipsCode: "06037",
      endpointType: "arcgis_rest",
      baseUrl: "https://assessor.gis.lacounty.gov/oam/rest/services/assessor/parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://assessor.lacounty.gov/",
      notes: "LA County Assessor",
    },
    {
      state: "CA",
      county: "San Diego",
      fipsCode: "06073",
      endpointType: "arcgis_rest",
      baseUrl: "https://sdgis.sandag.org/arcgis/rest/services/Assessor/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://www.sandiegocounty.gov/assessor/",
      notes: "San Diego County Assessor",
    },
    // GEORGIA
    {
      state: "GA",
      county: "Fulton",
      fipsCode: "13121",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.fultoncountyga.gov/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://www.fultoncountyga.gov/",
      notes: "Fulton County GIS",
    },
    // NORTH CAROLINA
    {
      state: "NC",
      county: "Mecklenburg",
      fipsCode: "37119",
      endpointType: "arcgis_rest",
      baseUrl: "https://maps.mecklenburgcountync.gov/arcgis/rest/services/POLARIS/Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://maps.mecklenburgcountync.gov/",
      notes: "Mecklenburg County POLARIS",
    },
    // TENNESSEE
    {
      state: "TN",
      county: "Davidson",
      fipsCode: "47037",
      endpointType: "arcgis_rest",
      baseUrl: "https://maps.nashville.gov/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://maps.nashville.gov/",
      notes: "Nashville/Davidson County",
    },
    // NEW MEXICO - Rural Land Investment Counties
    {
      state: "NM",
      county: "Luna",
      fipsCode: "35029",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.lunacountynm.us/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.lunacountynm.us/",
      notes: "Luna County GIS",
    },
    {
      state: "NM",
      county: "Dona Ana",
      fipsCode: "35013",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.donaanacounty.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.donaanacounty.org/",
      notes: "Dona Ana County GIS",
    },
    {
      state: "NM",
      county: "Otero",
      fipsCode: "35035",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.co.otero.nm.us/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.co.otero.nm.us/",
      notes: "Otero County GIS",
    },
    {
      state: "NM",
      county: "Chaves",
      fipsCode: "35005",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.chavescounty.net/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.chavescounty.net/",
      notes: "Chaves County GIS",
    },
    {
      state: "NM",
      county: "Eddy",
      fipsCode: "35015",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.eddycounty.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.eddycounty.org/",
      notes: "Eddy County GIS",
    },
    {
      state: "NM",
      county: "Lea",
      fipsCode: "35025",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.leacounty.net/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.leacounty.net/",
      notes: "Lea County GIS",
    },
    {
      state: "NM",
      county: "Curry",
      fipsCode: "35009",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.currycounty.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.currycounty.org/",
      notes: "Curry County GIS",
    },
    // TEXAS - Rural Land Investment Counties
    {
      state: "TX",
      county: "Val Verde",
      fipsCode: "48465",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.valverdecad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.valverdecad.org/",
      notes: "Val Verde County Appraisal District",
    },
    {
      state: "TX",
      county: "Hudspeth",
      fipsCode: "48229",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.hudspethcad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.hudspethcad.org/",
      notes: "Hudspeth County Appraisal District",
    },
    {
      state: "TX",
      county: "Culberson",
      fipsCode: "48109",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.culbersoncad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.culbersoncad.org/",
      notes: "Culberson County Appraisal District",
    },
    {
      state: "TX",
      county: "Presidio",
      fipsCode: "48377",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.presidiocad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.presidiocad.org/",
      notes: "Presidio County Appraisal District",
    },
    {
      state: "TX",
      county: "Terrell",
      fipsCode: "48443",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.terrellcad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.terrellcad.org/",
      notes: "Terrell County Appraisal District",
    },
    {
      state: "TX",
      county: "Webb",
      fipsCode: "48479",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.webbcad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.webbcad.org/",
      notes: "Webb County Appraisal District",
    },
    {
      state: "TX",
      county: "Maverick",
      fipsCode: "48323",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.maverickcad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.maverickcad.org/",
      notes: "Maverick County Appraisal District",
    },
    {
      state: "TX",
      county: "Kinney",
      fipsCode: "48271",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.kinneycad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.kinneycad.org/",
      notes: "Kinney County Appraisal District",
    },
    {
      state: "TX",
      county: "Zavala",
      fipsCode: "48507",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.zavalacad.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PROP_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PROP_ID", owner: "OWNER" },
      sourceUrl: "https://gis.zavalacad.org/",
      notes: "Zavala County Appraisal District",
    },
    // ARIZONA - Rural Land Investment Counties
    {
      state: "AZ",
      county: "Cochise",
      fipsCode: "04003",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.cochise.az.gov/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.cochise.az.gov/",
      notes: "Cochise County GIS",
    },
    {
      state: "AZ",
      county: "Santa Cruz",
      fipsCode: "04023",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.santacruzcountyaz.gov/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.santacruzcountyaz.gov/",
      notes: "Santa Cruz County GIS",
    },
    {
      state: "AZ",
      county: "Mohave",
      fipsCode: "04015",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.mohavecounty.us/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.mohavecounty.us/",
      notes: "Mohave County GIS",
    },
    {
      state: "AZ",
      county: "La Paz",
      fipsCode: "04012",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.lapazcountyaz.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.lapazcountyaz.org/",
      notes: "La Paz County GIS",
    },
    {
      state: "AZ",
      county: "Yuma",
      fipsCode: "04027",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.yumacountyaz.gov/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.yumacountyaz.gov/",
      notes: "Yuma County GIS",
    },
    // COLORADO - Rural Land Investment Counties
    {
      state: "CO",
      county: "Costilla",
      fipsCode: "08023",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.costillacounty.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PIN",
      ownerField: "OWNER",
      fieldMappings: { apn: "PIN", owner: "OWNER" },
      sourceUrl: "https://gis.costillacounty.org/",
      notes: "Costilla County GIS",
    },
    {
      state: "CO",
      county: "Huerfano",
      fipsCode: "08055",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.huerfanocounty.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PIN",
      ownerField: "OWNER",
      fieldMappings: { apn: "PIN", owner: "OWNER" },
      sourceUrl: "https://gis.huerfanocounty.org/",
      notes: "Huerfano County GIS",
    },
    {
      state: "CO",
      county: "Las Animas",
      fipsCode: "08071",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.lasanimascounty.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PIN",
      ownerField: "OWNER",
      fieldMappings: { apn: "PIN", owner: "OWNER" },
      sourceUrl: "https://gis.lasanimascounty.org/",
      notes: "Las Animas County GIS",
    },
    {
      state: "CO",
      county: "Saguache",
      fipsCode: "08109",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.saguachecounty.net/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PIN",
      ownerField: "OWNER",
      fieldMappings: { apn: "PIN", owner: "OWNER" },
      sourceUrl: "https://gis.saguachecounty.net/",
      notes: "Saguache County GIS",
    },
    {
      state: "CO",
      county: "Alamosa",
      fipsCode: "08003",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.alamosacounty.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PIN",
      ownerField: "OWNER",
      fieldMappings: { apn: "PIN", owner: "OWNER" },
      sourceUrl: "https://gis.alamosacounty.org/",
      notes: "Alamosa County GIS",
    },
    {
      state: "CO",
      county: "Park",
      fipsCode: "08093",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.parkco.us/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PIN",
      ownerField: "OWNER",
      fieldMappings: { apn: "PIN", owner: "OWNER" },
      sourceUrl: "https://gis.parkco.us/",
      notes: "Park County GIS",
    },
    // NEVADA - Rural Land Investment Counties
    {
      state: "NV",
      county: "Nye",
      fipsCode: "32023",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.nyecounty.net/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.nyecounty.net/",
      notes: "Nye County GIS",
    },
    {
      state: "NV",
      county: "Elko",
      fipsCode: "32007",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.elkocountynv.net/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.elkocountynv.net/",
      notes: "Elko County GIS",
    },
    {
      state: "NV",
      county: "Esmeralda",
      fipsCode: "32009",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.esmeraldacounty.us/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.esmeraldacounty.us/",
      notes: "Esmeralda County GIS",
    },
    {
      state: "NV",
      county: "Lincoln",
      fipsCode: "32017",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.lincolncountynv.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.lincolncountynv.org/",
      notes: "Lincoln County GIS",
    },
    {
      state: "NV",
      county: "White Pine",
      fipsCode: "32033",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.whitepinecounty.net/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
      fieldMappings: { apn: "APN", owner: "OWNER" },
      sourceUrl: "https://gis.whitepinecounty.net/",
      notes: "White Pine County GIS",
    },
    // FLORIDA - Rural Land Investment Counties
    {
      state: "FL",
      county: "Hendry",
      fipsCode: "12051",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.hendryfl.net/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://gis.hendryfl.net/",
      notes: "Hendry County GIS",
    },
    {
      state: "FL",
      county: "Glades",
      fipsCode: "12043",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.gladescountyfl.gov/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://gis.gladescountyfl.gov/",
      notes: "Glades County GIS",
    },
    {
      state: "FL",
      county: "Highlands",
      fipsCode: "12055",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.highlandsfl.gov/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://gis.highlandsfl.gov/",
      notes: "Highlands County GIS",
    },
    {
      state: "FL",
      county: "Polk",
      fipsCode: "12105",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.polkcountyfl.gov/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://gis.polkcountyfl.gov/",
      notes: "Polk County Property Appraiser GIS",
    },
    {
      state: "FL",
      county: "Osceola",
      fipsCode: "12097",
      endpointType: "arcgis_rest",
      baseUrl: "https://gis.osceola.org/arcgis/rest/services/Parcels/MapServer",
      layerId: "0",
      apnField: "PARCEL_ID",
      ownerField: "OWNER",
      fieldMappings: { apn: "PARCEL_ID", owner: "OWNER" },
      sourceUrl: "https://gis.osceola.org/",
      notes: "Osceola County Property Appraiser GIS",
    },
  ];
  
  let added = 0;
  let skipped = 0;
  
  for (const endpoint of endpoints) {
    const existing = await db
      .select()
      .from(countyGisEndpoints)
      .where(
        and(
          eq(countyGisEndpoints.state, endpoint.state),
          eq(countyGisEndpoints.county, endpoint.county)
        )
      )
      .limit(1);
    
    if (existing.length === 0) {
      await db.insert(countyGisEndpoints).values({
        ...endpoint,
        isActive: true,
        isVerified: false,
        contributedBy: "system",
      });
      added++;
      console.log(`[Seed] Added endpoint: ${endpoint.county}, ${endpoint.state}`);
    } else {
      skipped++;
    }
  }
  
  return { added, skipped };
}

/**
 * Fetch nearby parcels from county GIS within a bounding box
 * Returns boundaries only (no owner data) for map visualization
 */
export async function getNearbyParcelsFromCountyGIS(
  centerLat: number,
  centerLng: number,
  state: string,
  county: string,
  radiusMiles: number = 0.5
): Promise<{
  parcels: Array<{
    apn: string;
    boundary: GeoJSON.Geometry;
    centroid: { lat: number; lng: number };
  }>;
  source: string;
  count: number;
}> {
  const endpoints = await db
    .select()
    .from(countyGisEndpoints)
    .where(
      and(
        eq(countyGisEndpoints.state, state.toUpperCase()),
        ilike(countyGisEndpoints.county, county.replace(/-/g, " ")),
        eq(countyGisEndpoints.isActive, true)
      )
    )
    .limit(1);

  if (endpoints.length === 0) {
    console.log(`[NearbyParcels] No county GIS endpoint for ${county}, ${state}`);
    return { parcels: [], source: "none", count: 0 };
  }

  const endpoint = endpoints[0];
  
  // Convert radius to approximate degrees (1 mile ≈ 0.0145 degrees at mid-latitudes)
  const degreeOffset = radiusMiles * 0.0145;
  
  // Create bounding box in WGS84
  const minLng = centerLng - degreeOffset;
  const minLat = centerLat - degreeOffset;
  const maxLng = centerLng + degreeOffset;
  const maxLat = centerLat + degreeOffset;
  
  // Convert to Web Mercator (EPSG:3857) for ArcGIS query
  const toWebMercator = (lng: number, lat: number) => {
    const x = lng * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
    return { x, y: y * 20037508.34 / 180 };
  };
  
  const minMerc = toWebMercator(minLng, minLat);
  const maxMerc = toWebMercator(maxLng, maxLat);
  
  try {
    const queryUrl = `${endpoint.baseUrl}/${endpoint.layerId || 0}/query`;
    const params = new URLSearchParams({
      where: "1=1",
      geometry: JSON.stringify({
        xmin: minMerc.x,
        ymin: minMerc.y,
        xmax: maxMerc.x,
        ymax: maxMerc.y,
        spatialReference: { wkid: 3857 }
      }),
      geometryType: "esriGeometryEnvelope",
      spatialRel: "esriSpatialRelIntersects",
      outFields: endpoint.apnField || "APN",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
      resultRecordCount: "100",
    });

    console.log(`[NearbyParcels] Querying ${endpoint.county}, ${endpoint.state} - ${queryUrl}`);
    
    const response = await fetch(`${queryUrl}?${params.toString()}`);
    
    if (!response.ok) {
      console.log(`[NearbyParcels] Query failed: ${response.status}`);
      return { parcels: [], source: "error", count: 0 };
    }
    
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      console.log(`[NearbyParcels] No features returned`);
      return { parcels: [], source: endpoint.county, count: 0 };
    }
    
    console.log(`[NearbyParcels] Found ${data.features.length} nearby parcels`);
    
    const parcels = data.features.map((feature: any) => {
      let geometry: GeoJSON.Geometry;
      
      if (feature.geometry.rings) {
        // ArcGIS polygon format
        if (feature.geometry.rings.length === 1) {
          geometry = {
            type: "Polygon",
            coordinates: feature.geometry.rings,
          };
        } else {
          geometry = {
            type: "MultiPolygon",
            coordinates: feature.geometry.rings.map((ring: number[][]) => [ring]),
          };
        }
      } else {
        geometry = feature.geometry;
      }
      
      const centroid = calculateCentroid(geometry);
      const apnField = endpoint.apnField || "APN";
      
      return {
        apn: feature.attributes[apnField] || feature.attributes["PARCEL_ID"] || "Unknown",
        boundary: geometry,
        centroid,
      };
    });
    
    return {
      parcels,
      source: `${endpoint.county}, ${endpoint.state}`,
      count: parcels.length,
    };
  } catch (error) {
    console.error(`[NearbyParcels] Error:`, error);
    return { parcels: [], source: "error", count: 0 };
  }
}
