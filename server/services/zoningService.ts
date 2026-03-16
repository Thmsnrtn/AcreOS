/**
 * T28 — Zoning API Integration
 *
 * Retrieves zoning information for a property given its address or APN.
 * Primary: Zoneomics API (https://zoneomics.com)
 * Fallback: ATTOM Property API (https://api.attomdata.com)
 * Development fallback: returns mock data for local testing
 *
 * Required env:
 *   ZONEOMICS_API_KEY  — Zoneomics API key
 *   ATTOM_API_KEY      — (optional) ATTOM fallback
 *
 * Returns standardized zoning data regardless of source.
 */

export interface ZoningInfo {
  zoningCode: string;       // e.g. "A-1", "RR-5", "AG"
  zoningDescription: string; // e.g. "Agricultural - 1 acre minimum"
  category: "agricultural" | "residential" | "commercial" | "industrial" | "mixed" | "open_space" | "unknown";
  permittedUses: string[];
  minimumLotSize?: number;    // acres
  maxBuildingHeight?: number; // feet
  setbacks?: {
    front?: number;
    rear?: number;
    side?: number;
  };
  developmentPotential: "low" | "medium" | "high";
  source: "zoneomics" | "attom" | "mock";
  confidence: number; // 0-1
}

function categorizingZoning(code: string, desc: string): ZoningInfo["category"] {
  const lower = (code + " " + desc).toLowerCase();
  if (/agri|farm|ranch|rural|pasture|ag\b/.test(lower)) return "agricultural";
  if (/residential|single.family|multi.family|r-\d|rr/.test(lower)) return "residential";
  if (/commercial|retail|office|business|b-\d|c-\d/.test(lower)) return "commercial";
  if (/industrial|warehouse|manufacturing|m-\d/.test(lower)) return "industrial";
  if (/mixed|pud|planned/.test(lower)) return "mixed";
  if (/open.space|conservation|park|wetland/.test(lower)) return "open_space";
  return "unknown";
}

async function fetchFromZoneomics(address: string): Promise<ZoningInfo | null> {
  const apiKey = process.env.ZONEOMICS_API_KEY;
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams({ address, apikey: apiKey, format: "json" });
    const res = await fetch(`https://zoneomics.com/api/v2/zoning?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;

    const zone = data.result?.zoning?.[0] || data.zoning?.[0];
    if (!zone) return null;

    const code = zone.code || zone.zoning_code || "";
    const desc = zone.description || zone.zoning_description || "";
    const category = categorizingZoning(code, desc);

    return {
      zoningCode: code,
      zoningDescription: desc,
      category,
      permittedUses: zone.permitted_uses || [],
      minimumLotSize: zone.min_lot_size_acres,
      maxBuildingHeight: zone.max_building_height_ft,
      setbacks: zone.setbacks,
      developmentPotential:
        ["commercial", "industrial", "mixed"].includes(category)
          ? "high"
          : category === "residential"
          ? "medium"
          : "low",
      source: "zoneomics",
      confidence: 0.9,
    };
  } catch {
    return null;
  }
}

async function fetchFromAttom(address: string): Promise<ZoningInfo | null> {
  const apiKey = process.env.ATTOM_API_KEY;
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams({ address1: address });
    const res = await fetch(`https://api.attomdata.com/propertyapi/v1.0.0/property/detail?${params}`, {
      headers: { apikey: apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    const prop = data?.property?.[0];
    const zoning = prop?.lot?.zoningCode || "";
    if (!zoning) return null;

    const category = categorizingZoning(zoning, "");
    return {
      zoningCode: zoning,
      zoningDescription: zoning,
      category,
      permittedUses: [],
      developmentPotential: "low",
      source: "attom",
      confidence: 0.6,
    };
  } catch {
    return null;
  }
}

export const zoningService = {
  /**
   * Get zoning information for a property.
   */
  async getZoning(address: string): Promise<ZoningInfo> {
    // Try Zoneomics first
    const zoneomics = await fetchFromZoneomics(address);
    if (zoneomics) return zoneomics;

    // Try ATTOM fallback
    const attom = await fetchFromAttom(address);
    if (attom) return attom;

    // Return unknown placeholder
    return {
      zoningCode: "Unknown",
      zoningDescription: "Zoning information not available — check county GIS",
      category: "unknown",
      permittedUses: [],
      developmentPotential: "low",
      source: "mock",
      confidence: 0,
    };
  },

  isConfigured(): boolean {
    return !!(process.env.ZONEOMICS_API_KEY || process.env.ATTOM_API_KEY);
  },
};
