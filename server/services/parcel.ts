/**
 * Parcel Boundary Service - Tiered Lookup System
 * Priority: County GIS (free) -> Regrid API (paid fallback)
 */

import { db } from "../db";
import { countyGisEndpoints } from "@shared/schema";
import { eq, and } from "drizzle-orm";

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
  source?: "county_gis" | "regrid" | "cache";
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

function calculateCentroid(geometry: RegridParcel["geometry"]): { lat: number; lng: number } {
  let coords: number[][] = [];
  
  if (geometry.type === "Polygon") {
    coords = geometry.coordinates[0] as number[][];
  } else if (geometry.type === "MultiPolygon") {
    coords = (geometry.coordinates[0] as number[][][])[0];
  }
  
  if (coords.length === 0) {
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
          geometry = {
            apn: String(attrs[mappings.apn || apnField] || apn),
            boundary: {
              type: "Polygon" as const,
              coordinates: rings,
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
            centroid = {
              lng: sumX / firstRing.length,
              lat: sumY / firstRing.length,
            };
          }
          geometry.centroid = centroid;
        } else {
          geometry = {
            apn: String(attrs[mappings.apn || apnField] || apn),
            boundary: {
              type: "Polygon" as const,
              coordinates: [],
            },
            centroid: {
              lat: feature.geometry?.y || 0,
              lng: feature.geometry?.x || 0,
            },
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
 * Tiered parcel lookup: County GIS (free) -> Regrid (paid fallback)
 */
export async function lookupParcelByAPN(
  apn: string,
  stateCountyPath?: string
): Promise<ParcelLookupResult> {
  let state = "";
  let county = "";
  
  if (stateCountyPath) {
    const parts = stateCountyPath.replace(/^\/us\//i, "").split("/");
    if (parts.length >= 1) state = parts[0].toUpperCase();
    if (parts.length >= 2) county = parts[1].replace(/-/g, " ");
  }
  
  if (state && county) {
    const countyResult = await lookupFromCountyGIS(apn, state, county);
    if (countyResult?.found) {
      console.log(`[Parcel] Found via County GIS (FREE)`);
      return countyResult;
    }
  }
  
  console.log(`[Parcel] Falling back to Regrid API`);
  return lookupFromRegrid(apn, stateCountyPath);
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
      let url = `https://app.regrid.com/api/v2/parcels/parcelnumb?parcelnumb=${encodeURIComponent(apnVariant)}&token=${token}&return_geometry=true`;
      
      if (stateCountyPath) {
        url += `&path=${encodeURIComponent(stateCountyPath)}`;
      }
      
      console.log(`[Regrid] Trying APN lookup: ${apnVariant}`);
      
      const response = await fetch(url);
      
      if (response.ok) {
        const result = await response.json() as RegridResponse;
        
        if (result.status === "error") {
          console.log(`[Regrid] Account error: ${result.message}`);
          return { 
            found: false, 
            error: "Regrid API account issue: Your API key may not have parcel data access." 
          };
        }
        
        const features = result.parcels?.features || result.results || [];
        if (features.length > 0) {
          data = { ...result, results: features };
          break;
        }
      } else if (response.status === 401 || response.status === 403) {
        return { found: false, error: "Regrid API key is invalid or expired." };
      }
    }
    
    const features = data?.parcels?.features || data?.results || [];
    
    if (!data || features.length === 0) {
      return { found: false, error: `Parcel not found for APN: ${apn}` };
    }
    
    const parcel = features[0];
    const props = parcel.properties;
    
    const centroid = props.lat && props.lon
      ? { lat: props.lat, lng: props.lon }
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
