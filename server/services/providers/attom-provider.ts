/**
 * ATTOM Data Provider — ATTOM Data API for property details, valuations, comps.
 * Base: https://api.gateway.attomdata.com, auth via apikey header.
 * Tier: pro. Cost: 5–20 cents.
 */
import { logger } from "../../utils/logger";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import type {
  DataCategory,
  DataProvider,
  LookupInput,
  LookupResult,
  ProviderHealthStatus,
} from "./types";
import crypto from "crypto";

const ATTOM_BASE = "https://api.gateway.attomdata.com";

const CATEGORY_COSTS: Partial<Record<DataCategory, number>> = {
  property_details: 5,
  valuation: 10,
  comps: 20,
  owner_info: 8,
  structure: 5,
};

const SUPPORTED_CATEGORIES: DataCategory[] = [
  "property_details",
  "valuation",
  "comps",
  "owner_info",
  "structure",
];

function getApiKey(): string | null {
  return process.env.ATTOM_API_KEY ?? null;
}

function makeCacheKey(category: DataCategory, input: LookupInput): string {
  const hash = crypto.createHash("sha256");
  hash.update(`attom:${category}:${JSON.stringify(input)}`);
  return hash.digest("hex");
}

async function getCached(cacheKey: string): Promise<unknown | null> {
  try {
    const rows = await db.execute(
      sql`SELECT response_data FROM provider_cache
          WHERE cache_key = ${cacheKey}
          AND expires_at > NOW()
          LIMIT 1`
    );
    if (rows.rows && rows.rows.length > 0) {
      return (rows.rows[0] as any).response_data;
    }
  } catch {
    // Cache miss — proceed with API call
  }
  return null;
}

async function setCache(
  cacheKey: string,
  provider: string,
  category: DataCategory,
  data: unknown,
  costCents: number,
  ttlDays: number = 30
): Promise<void> {
  try {
    await db.execute(
      sql`INSERT INTO provider_cache (provider, category, cache_key, response_data, cost_cents, expires_at)
          VALUES (${provider}, ${category}, ${cacheKey}, ${JSON.stringify(data)}::jsonb, ${costCents},
                  NOW() + ${`${ttlDays} days`}::interval)
          ON CONFLICT (cache_key) DO UPDATE SET
            response_data = EXCLUDED.response_data,
            cost_cents = EXCLUDED.cost_cents,
            expires_at = EXCLUDED.expires_at`
    );
  } catch (error) {
    logger.warn("Failed to cache provider response", {
      source: "AttomProvider",
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function attomFetch(path: string, apiKey: string): Promise<unknown> {
  const url = `${ATTOM_BASE}${path}`;
  const response = await fetch(url, {
    headers: { apikey: apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`ATTOM API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function buildAddressParam(input: LookupInput): string {
  if (input.type === "address") {
    return `address1=${encodeURIComponent(input.street)}&address2=${encodeURIComponent(`${input.city}, ${input.state} ${input.zip}`)}`;
  }
  return "";
}

function buildGeoParam(input: LookupInput): string {
  if (input.type === "coordinates") {
    return `latitude=${input.latitude}&longitude=${input.longitude}`;
  }
  return "";
}

export const attomProvider: DataProvider = {
  name: "attom",
  displayName: "ATTOM Data",
  categories: SUPPORTED_CATEGORIES,
  supportedInputTypes: ["coordinates", "address"],
  tierRequired: "pro",

  costPerLookupCents(category: DataCategory): number {
    return CATEGORY_COSTS[category] ?? 10;
  },

  async isConfigured(_organizationId?: number): Promise<boolean> {
    return getApiKey() !== null;
  },

  async lookup(category: DataCategory, input: LookupInput): Promise<LookupResult> {
    const start = Date.now();
    const apiKey = getApiKey();

    if (!apiKey) {
      throw new Error("ATTOM API key not configured");
    }

    if (input.type !== "coordinates" && input.type !== "address") {
      throw new Error(`ATTOM does not support input type: ${input.type}`);
    }

    // Check cache first
    const cacheKey = makeCacheKey(category, input);
    const cached = await getCached(cacheKey);
    if (cached) {
      return {
        provider: "attom",
        category,
        confidence: 90,
        costCents: 0, // Cached = no cost
        fetchedAt: new Date(),
        cached: true,
        latencyMs: Date.now() - start,
        data: cached,
      };
    }

    const locationParam =
      input.type === "address" ? buildAddressParam(input) : buildGeoParam(input);

    let data: unknown;
    let confidence = 85;
    const costCents = this.costPerLookupCents(category);

    switch (category) {
      case "property_details": {
        data = await attomFetch(
          `/propertyapi/v1.0.0/property/detail?${locationParam}`,
          apiKey
        );
        confidence = 90;
        break;
      }

      case "valuation": {
        data = await attomFetch(
          `/propertyapi/v1.0.0/attomavm/detail?${locationParam}`,
          apiKey
        );
        confidence = 85;
        break;
      }

      case "comps": {
        if (input.type === "coordinates") {
          data = await attomFetch(
            `/propertyapi/v1.0.0/sale/comparables?${locationParam}&radius=5&propertytype=SFR`,
            apiKey
          );
        } else {
          data = await attomFetch(
            `/propertyapi/v1.0.0/sale/comparables?${locationParam}`,
            apiKey
          );
        }
        confidence = 80;
        break;
      }

      case "owner_info": {
        data = await attomFetch(
          `/propertyapi/v1.0.0/property/detail?${locationParam}`,
          apiKey
        );
        // Extract owner-relevant fields
        const prop = (data as any)?.property?.[0];
        data = {
          owner: prop?.assessment?.owner1?.last,
          ownerFull: `${prop?.assessment?.owner1?.first ?? ""} ${prop?.assessment?.owner1?.last ?? ""}`.trim(),
          mailingAddress: prop?.address?.oneLine,
        };
        confidence = 85;
        break;
      }

      case "structure": {
        const raw = await attomFetch(
          `/propertyapi/v1.0.0/property/detail?${locationParam}`,
          apiKey
        );
        const prop = (raw as any)?.property?.[0]?.building;
        data = {
          bedrooms: prop?.rooms?.beds,
          bathrooms: prop?.rooms?.bathsFull,
          sqft: prop?.size?.livingSize,
          yearBuilt: prop?.summary?.yearBuilt,
          stories: prop?.summary?.levels,
          structureType: prop?.summary?.propType,
        };
        confidence = 90;
        break;
      }

      default:
        throw new Error(`ATTOM does not support category: ${category}`);
    }

    // Cache the result
    await setCache(cacheKey, "attom", category, data, costCents);

    return {
      provider: "attom",
      category,
      confidence,
      costCents,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: Date.now() - start,
      data,
    };
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    const apiKey = getApiKey();

    if (!apiKey) {
      return {
        healthy: false,
        latencyMs: 0,
        message: "No API key configured",
        checkedAt: new Date(),
      };
    }

    try {
      // Lightweight call to verify credentials
      const response = await fetch(
        `${ATTOM_BASE}/propertyapi/v1.0.0/property/detail?address1=123+Main+St&address2=San+Francisco,+CA+94105`,
        {
          headers: { apikey: apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        }
      );
      return {
        healthy: response.status !== 401 && response.status !== 403,
        latencyMs: Date.now() - start,
        message: `ATTOM API responded with status ${response.status}`,
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : "Health check failed",
        checkedAt: new Date(),
      };
    }
  },
};
