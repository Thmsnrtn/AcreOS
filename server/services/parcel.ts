/**
 * Parcel Boundary Service - Regrid API Integration
 * Provides parcel boundary lookups by APN, address, or coordinates
 */

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

interface ParcelLookupResult {
  found: boolean;
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

// Calculate centroid from polygon coordinates
function calculateCentroid(geometry: RegridParcel["geometry"]): { lat: number; lng: number } {
  let coords: number[][] = [];
  
  if (geometry.type === "Polygon") {
    coords = geometry.coordinates[0] as number[][];
  } else if (geometry.type === "MultiPolygon") {
    // Use the first polygon's outer ring
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

// Format owner address from Regrid fields
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
 * Lookup parcel boundary by APN
 * @param apn - Assessor's Parcel Number
 * @param stateCountyPath - Optional path like "/us/tx/harris" to narrow search
 */
export async function lookupParcelByAPN(
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
    // Clean the APN - remove dashes and spaces for matching
    const cleanApn = apn.replace(/[-\s]/g, "");
    
    // Try multiple APN formats
    const apnVariants = [
      cleanApn,
      apn.trim(), // Original with dashes/spaces
      cleanApn.replace(/^0+/, ""), // Without leading zeros
    ].filter((v, i, arr) => arr.indexOf(v) === i); // Unique only
    
    let data: RegridResponse | null = null;
    let lastError = "";
    
    for (const apnVariant of apnVariants) {
      // Build the URL using parcelnumb endpoint (v2 API)
      let url = `https://app.regrid.com/api/v2/parcels/parcelnumb?parcelnumb=${encodeURIComponent(apnVariant)}&token=${token}&return_geometry=true`;
      
      if (stateCountyPath) {
        url += `&path=${encodeURIComponent(stateCountyPath)}`;
      }
      
      console.log(`[Regrid] Trying APN lookup: ${apnVariant} (path: ${stateCountyPath || 'none'})`);
      
      const response = await fetch(url);
      
      if (response.ok) {
        const result = await response.json() as RegridResponse;
        
        // Check for account-level error (status: error in JSON body)
        if (result.status === "error") {
          console.log(`[Regrid] Account error: ${result.message}`);
          return { 
            found: false, 
            error: "Regrid API account issue: Your API key may not have parcel data access. Please verify your Regrid subscription includes Parcel API access." 
          };
        }
        
        // Handle v2 API response format (parcels.features instead of results)
        const features = result.parcels?.features || result.results || [];
        if (features.length > 0) {
          console.log(`[Regrid] Found parcel with APN variant: ${apnVariant}`);
          data = { ...result, results: features };
          break;
        }
      } else if (response.status === 401 || response.status === 403) {
        return { found: false, error: "Regrid API key is invalid or expired. Please check your REGRID_API_KEY." };
      } else if (response.status !== 404) {
        lastError = `Regrid API error: ${response.status}`;
      }
    }
    
    // Get the features array
    const features = data?.parcels?.features || data?.results || [];
    
    if (!data || features.length === 0) {
      console.log(`[Regrid] Parcel not found for APN: ${apn}`);
      return { found: false, error: `Parcel not found for APN: ${apn}. This may indicate: (1) The parcel isn't in Regrid's database, (2) Your Regrid subscription doesn't include this county, or (3) The APN format doesn't match.` };
    }
    
    const parcel = features[0];
    const props = parcel.properties;
    
    // Calculate centroid from geometry or use provided lat/lon
    const centroid = props.lat && props.lon
      ? { lat: props.lat, lng: props.lon }
      : calculateCentroid(parcel.geometry);
    
    return {
      found: true,
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
    console.error("Parcel lookup error:", error);
    return {
      found: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Lookup parcel by coordinates
 * @param lat - Latitude
 * @param lng - Longitude
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
