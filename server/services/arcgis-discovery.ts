/**
 * ArcGIS Online Discovery Service
 * 
 * Searches ArcGIS Online for parcel/property services and validates them.
 * Uses the free ArcGIS Online REST API for searching public services.
 */

const ARCGIS_SEARCH_URL = "https://www.arcgis.com/sharing/rest/search";

const PARCEL_KEYWORDS = [
  "parcel",
  "parcels", 
  "property",
  "assessor",
  "cadastral",
  "tax parcel",
  "land parcel",
  "property boundary"
];

const US_STATES: Record<string, string> = {
  "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
  "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
  "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
  "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
  "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
  "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
  "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
  "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
  "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
  "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"
};

export interface ArcGISSearchItem {
  id: string;
  title: string;
  name?: string;
  url?: string;
  type: string;
  owner: string;
  description?: string;
  snippet?: string;
  tags?: string[];
  culture?: string;
  extent?: number[][];
  spatialReference?: string;
  accessInformation?: string;
  licenseInfo?: string;
  numViews?: number;
  avgRating?: number;
  created?: number;
  modified?: number;
}

export interface DiscoveredEndpointInfo {
  state: string;
  county: string;
  baseUrl: string;
  endpointType: string;
  serviceName: string;
  discoverySource: string;
  confidenceScore: number;
  metadata: Record<string, any>;
}

export interface ArcGISSearchOptions {
  maxResults?: number;
  targetStates?: string[];
  keywords?: string[];
}

interface ArcGISSearchResponse {
  results: ArcGISSearchItem[];
  total: number;
  start: number;
  num: number;
  nextStart: number;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search ArcGIS Online for parcel/property services
 */
export async function searchArcGISOnline(
  keywords: string[] = PARCEL_KEYWORDS,
  options: ArcGISSearchOptions = {}
): Promise<ArcGISSearchItem[]> {
  const { maxResults = 100, targetStates } = options;
  const allItems: ArcGISSearchItem[] = [];
  
  for (const keyword of keywords) {
    let query = `${keyword} type:("Feature Service" OR "Map Service")`;
    
    if (targetStates && targetStates.length > 0) {
      const stateQueries = targetStates.map(s => {
        const stateName = US_STATES[s.toUpperCase()] || s;
        return `(${stateName} OR ${s})`;
      }).join(" OR ");
      query += ` AND (${stateQueries})`;
    }
    
    try {
      let start = 1;
      const num = Math.min(maxResults, 100);
      
      while (allItems.length < maxResults) {
        const params = new URLSearchParams({
          q: query,
          f: "json",
          start: String(start),
          num: String(num),
          sortField: "numViews",
          sortOrder: "desc"
        });
        
        const response = await fetch(`${ARCGIS_SEARCH_URL}?${params}`);
        
        if (!response.ok) {
          console.error(`ArcGIS search failed for keyword "${keyword}": ${response.status}`);
          break;
        }
        
        const data: ArcGISSearchResponse = await response.json();
        
        if (!data.results || data.results.length === 0) {
          break;
        }
        
        for (const item of data.results) {
          if (!allItems.some(existing => existing.id === item.id)) {
            allItems.push(item);
          }
        }
        
        if (data.nextStart === -1 || allItems.length >= maxResults) {
          break;
        }
        
        start = data.nextStart;
        await delay(200);
      }
    } catch (error) {
      console.error(`Error searching ArcGIS for keyword "${keyword}":`, error);
    }
    
    await delay(300);
  }
  
  return allItems.slice(0, maxResults);
}

/**
 * Extract county and state from ArcGIS item metadata
 */
function extractLocationInfo(item: ArcGISSearchItem): { state: string | null; county: string | null } {
  const text = `${item.title} ${item.description || ""} ${item.snippet || ""} ${(item.tags || []).join(" ")}`;
  const textLower = text.toLowerCase();
  
  let state: string | null = null;
  let county: string | null = null;
  
  for (const [abbrev, name] of Object.entries(US_STATES)) {
    const stateNameLower = name.toLowerCase();
    if (textLower.includes(stateNameLower) || text.includes(abbrev)) {
      state = abbrev;
      break;
    }
  }
  
  const countyPatterns = [
    /(\w+(?:\s+\w+)?)\s+county/gi,
    /county\s+of\s+(\w+(?:\s+\w+)?)/gi
  ];
  
  for (const pattern of countyPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const foundCounty = match[1].trim();
      if (foundCounty.toLowerCase() !== "the") {
        county = foundCounty;
        break;
      }
    }
  }
  
  if (!county && item.owner) {
    const ownerMatch = item.owner.match(/(\w+)_?county/i);
    if (ownerMatch) {
      county = ownerMatch[1];
    }
  }
  
  return { state, county };
}

/**
 * Build service URL from ArcGIS item
 */
function buildServiceUrl(item: ArcGISSearchItem): string | null {
  if (item.url) {
    return item.url;
  }
  
  return null;
}

/**
 * Calculate confidence score based on various factors
 */
function calculateConfidence(item: ArcGISSearchItem, state: string | null, county: string | null): number {
  let score = 50;
  
  const textLower = `${item.title} ${item.description || ""} ${item.snippet || ""}`.toLowerCase();
  
  if (textLower.includes("parcel")) score += 15;
  if (textLower.includes("property")) score += 10;
  if (textLower.includes("assessor")) score += 10;
  if (textLower.includes("cadastral")) score += 10;
  if (textLower.includes("tax")) score += 5;
  if (textLower.includes("apn") || textLower.includes("parcel number")) score += 10;
  
  if (state && county) score += 10;
  else if (state || county) score += 5;
  
  if ((item.numViews || 0) > 1000) score += 5;
  if ((item.numViews || 0) > 10000) score += 5;
  
  if ((item.avgRating || 0) > 3) score += 5;
  
  return Math.min(score, 100);
}

/**
 * Extract endpoint information from an ArcGIS item
 */
export function extractEndpointInfo(item: ArcGISSearchItem): DiscoveredEndpointInfo | null {
  const serviceUrl = buildServiceUrl(item);
  if (!serviceUrl) {
    return null;
  }
  
  const { state, county } = extractLocationInfo(item);
  if (!state || !county) {
    return null;
  }
  
  const confidence = calculateConfidence(item, state, county);
  
  const endpointType = item.type.includes("Feature") ? "arcgis_feature" : "arcgis_rest";
  
  return {
    state: state.toUpperCase(),
    county: county.charAt(0).toUpperCase() + county.slice(1).toLowerCase(),
    baseUrl: serviceUrl,
    endpointType,
    serviceName: item.title,
    discoverySource: "arcgis_online",
    confidenceScore: confidence,
    metadata: {
      arcgisId: item.id,
      owner: item.owner,
      description: item.description || item.snippet,
      tags: item.tags,
      numViews: item.numViews,
      avgRating: item.avgRating,
      created: item.created ? new Date(item.created).toISOString() : null,
      modified: item.modified ? new Date(item.modified).toISOString() : null,
    }
  };
}

/**
 * Validate that an endpoint is accessible and returns valid parcel data
 * Performs deep validation by checking layers and attempting a query
 * Handles both service-level URLs (FeatureServer) and layer-level URLs (FeatureServer/0)
 */
export async function validateEndpoint(url: string): Promise<{ 
  valid: boolean; 
  message: string;
  hasParcelData?: boolean;
  parcelLayerId?: number;
  parcelFields?: string[];
}> {
  const apnFieldNames = ["apn", "parcel_id", "parcelid", "pin", "parcel_number", "parcelnumber", "parcel_no", "prop_id", "property_id", "objectid"];
  const parcelKeywords = ["parcel", "property", "tax", "lot", "cadastral", "assessor"];
  
  try {
    let baseUrl = url;
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    const infoUrl = `${baseUrl}?f=json`;
    const response = await fetch(infoUrl, { 
      signal: AbortSignal.timeout(10000) 
    });
    
    if (!response.ok) {
      return { 
        valid: false, 
        message: `HTTP ${response.status}: ${response.statusText}` 
      };
    }
    
    const data = await response.json();
    
    if (data.error) {
      return { 
        valid: false, 
        message: `ArcGIS error: ${data.error.message || JSON.stringify(data.error)}` 
      };
    }
    
    const isLayerResponse = data.type === "Feature Layer" || data.geometryType !== undefined || 
      (data.fields && Array.isArray(data.fields) && !data.layers);
    
    if (isLayerResponse) {
      const parcelFields = data.fields ? data.fields.map((f: any) => f.name) : [];
      const layerName = (data.name || "").toLowerCase();
      
      const hasParcelKeyword = parcelKeywords.some(kw => layerName.includes(kw));
      const hasApnField = parcelFields.some((fieldName: string) => 
        apnFieldNames.some(apn => fieldName.toLowerCase().includes(apn))
      );
      
      if (!hasParcelKeyword && !hasApnField) {
        return {
          valid: false,
          message: "Layer does not appear to contain parcel data (no matching keywords or APN fields)",
          hasParcelData: false
        };
      }
      
      try {
        const queryUrl = `${baseUrl}/query?where=1=1&returnCountOnly=true&f=json`;
        const queryResponse = await fetch(queryUrl, { 
          signal: AbortSignal.timeout(5000) 
        });
        
        if (queryResponse.ok) {
          const queryData = await queryResponse.json();
          if (queryData.count !== undefined && queryData.count > 0) {
            return {
              valid: true,
              message: `Valid parcel layer with ${queryData.count.toLocaleString()} records`,
              hasParcelData: true,
              parcelLayerId: data.id,
              parcelFields
            };
          }
        }
      } catch {
      }
      
      return {
        valid: true,
        message: hasApnField ? "Valid parcel layer with APN field" : "Valid layer with parcel keywords",
        hasParcelData: true,
        parcelLayerId: data.id,
        parcelFields
      };
    }
    
    const hasLayers = data.layers && Array.isArray(data.layers) && data.layers.length > 0;
    const isFeatureServer = data.serviceDescription !== undefined || data.layers !== undefined;
    
    if (!isFeatureServer && !hasLayers) {
      return {
        valid: false,
        message: "No layers found or invalid service response"
      };
    }
    
    let parcelLayerId: number | undefined;
    let hasParcelData = false;
    let parcelFields: string[] = [];
    
    if (data.layers) {
      for (const layer of data.layers) {
        const layerName = (layer.name || "").toLowerCase();
        if (parcelKeywords.some(kw => layerName.includes(kw))) {
          parcelLayerId = layer.id;
          hasParcelData = true;
          break;
        }
      }
      
      if (parcelLayerId === undefined && data.layers.length > 0) {
        parcelLayerId = data.layers[0].id;
      }
    }
    
    if (parcelLayerId !== undefined) {
      try {
        const layerUrl = `${baseUrl}/${parcelLayerId}?f=json`;
        const layerResponse = await fetch(layerUrl, { 
          signal: AbortSignal.timeout(8000) 
        });
        
        if (layerResponse.ok) {
          const layerData = await layerResponse.json();
          
          if (layerData.fields && Array.isArray(layerData.fields)) {
            parcelFields = layerData.fields.map((f: any) => f.name);
            
            const hasApnField = parcelFields.some(fieldName => 
              apnFieldNames.some(apn => fieldName.toLowerCase().includes(apn))
            );
            
            if (hasApnField) {
              hasParcelData = true;
            }
            
            try {
              const queryUrl = `${baseUrl}/${parcelLayerId}/query?where=1=1&returnCountOnly=true&f=json`;
              const queryResponse = await fetch(queryUrl, { 
                signal: AbortSignal.timeout(5000) 
              });
              
              if (queryResponse.ok) {
                const queryData = await queryResponse.json();
                if (queryData.count !== undefined && queryData.count > 0) {
                  return {
                    valid: true,
                    message: hasParcelData 
                      ? `Valid parcel service with ${queryData.count.toLocaleString()} records`
                      : `Service has ${queryData.count.toLocaleString()} records (verify parcel content)`,
                    hasParcelData,
                    parcelLayerId,
                    parcelFields
                  };
                }
              }
            } catch {
            }
            
            if (hasApnField) {
              return {
                valid: true,
                message: "Valid service with APN field found",
                hasParcelData: true,
                parcelLayerId,
                parcelFields
              };
            }
          }
        }
      } catch {
      }
    }
    
    return {
      valid: hasParcelData,
      message: hasParcelData 
        ? "Valid service with parcel-related layers" 
        : "Service accessible but parcel data uncertain - manual review recommended",
      hasParcelData,
      parcelLayerId,
      parcelFields
    };
    
  } catch (error: any) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return { valid: false, message: "Request timed out after 10 seconds" };
    }
    return { 
      valid: false, 
      message: `Network error: ${error.message}` 
    };
  }
}

/**
 * Run a full discovery scan
 */
export async function runDiscoveryScan(options: ArcGISSearchOptions = {}): Promise<{
  items: ArcGISSearchItem[];
  endpoints: DiscoveredEndpointInfo[];
  stats: {
    totalSearchResults: number;
    validEndpoints: number;
    skippedNoLocation: number;
  };
}> {
  console.log("[ArcGIS Discovery] Starting scan...");
  
  const items = await searchArcGISOnline(options.keywords || PARCEL_KEYWORDS, options);
  console.log(`[ArcGIS Discovery] Found ${items.length} search results`);
  
  const endpoints: DiscoveredEndpointInfo[] = [];
  let skippedNoLocation = 0;
  
  for (const item of items) {
    const endpointInfo = extractEndpointInfo(item);
    if (endpointInfo) {
      const isDuplicate = endpoints.some(
        ep => ep.state === endpointInfo.state && 
              ep.county.toLowerCase() === endpointInfo.county.toLowerCase() &&
              ep.baseUrl === endpointInfo.baseUrl
      );
      if (!isDuplicate) {
        endpoints.push(endpointInfo);
      }
    } else {
      skippedNoLocation++;
    }
  }
  
  console.log(`[ArcGIS Discovery] Extracted ${endpoints.length} valid endpoints, skipped ${skippedNoLocation}`);
  
  return {
    items,
    endpoints,
    stats: {
      totalSearchResults: items.length,
      validEndpoints: endpoints.length,
      skippedNoLocation
    }
  };
}
