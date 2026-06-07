/**
 * Open Data Provider — wraps existing free APIs (FEMA, Census, USGS, USDA, EPA, BLM).
 * Delegates to existing service implementations. Tier: free. Cost: 0.
 *
 * Bulk / incremental FEMA flood-zone pulls are owned by the Wenzeslaus
 * ETL orchestrator — see `server/services/etlHandlers.ts`
 * (`femaEtlHandler`) and the seeded `fema_flood_zones_v1` row in
 * `etl_jobs`. This module remains the on-demand lookup surface for
 * coordinate/address hits.
 */
import { logger } from "../../utils/logger";
import type {
  DataCategory,
  DataProvider,
  LookupInput,
  LookupResult,
  ProviderHealthStatus,
} from "./types";
import type { LookupCategory } from "../data-source-broker";

/**
 * Broker-backed categories: each registry DataCategory in this map is fulfilled
 * by delegating to `dataSourceBroker.lookup(<brokerCategory>, …)`. The broker
 * keeps its ~30 federal/open endpoint integrations; the REGISTRY owns the one
 * cache + circuit breaker + provenance/license contract. (`parcel_data` is
 * handled specially below via the parcel service, NOT through this map.)
 *
 * The registry DataCategory names were deliberately chosen to equal the broker
 * LookupCategory names for these sub-kinds, so this is mostly the identity map;
 * `environmental` deliberately delegates to the broker's `flood_zone` to
 * preserve the historical behavior that surface relied on.
 */
const BROKER_CATEGORY: Partial<Record<DataCategory, LookupCategory>> = {
  environmental: "flood_zone",
  demographics: "demographics",
  flood_zone: "flood_zone",
  wetlands: "wetlands",
  soil: "soil",
  tax_assessment: "tax_assessment",
  market_data: "market_data",
  zoning: "zoning",
  satellite: "satellite",
  infrastructure: "infrastructure",
  natural_hazards: "natural_hazards",
  public_lands: "public_lands",
  transportation: "transportation",
  water_resources: "water_resources",
  elevation: "elevation",
  climate: "climate",
  agricultural_values: "agricultural_values",
  land_cover: "land_cover",
  cropland: "cropland",
  epa_frs: "epa_frs",
  storm_history: "storm_history",
  plss: "plss",
  watershed: "watershed",
  fema_nri: "fema_nri",
  usda_clu: "usda_clu",
};

const SUPPORTED_CATEGORIES: DataCategory[] = [
  "parcel_data",
  ...(Object.keys(BROKER_CATEGORY) as DataCategory[]),
];

/**
 * Authoritative source name per category. Federal open-data parcel/federal
 * layers are authoritative systems-of-record (Quinn lens). Names should match
 * entries in `data-licenses.ts` where one exists, so the registry's
 * cache-and-redistribute guard recognizes them as redistributable.
 */
const SOURCE_BY_CATEGORY: Partial<Record<DataCategory, string>> = {
  environmental: "FEMA NFHL",
  demographics: "US Census ACS",
  parcel_data: "County GIS",
  flood_zone: "FEMA NFHL",
  wetlands: "USFWS NWI",
  soil: "USDA SSURGO",
  tax_assessment: "County GIS",
  market_data: "Open Data",
  zoning: "County GIS",
  satellite: "Open Data",
  infrastructure: "Open Data",
  natural_hazards: "FEMA NRI",
  public_lands: "BLM PLSS",
  transportation: "Open Data",
  water_resources: "USGS",
  elevation: "USGS 3DEP",
  climate: "Open Data",
  agricultural_values: "USDA NASS",
  land_cover: "Open Data",
  cropland: "USDA NASS",
  epa_frs: "EPA FRS",
  storm_history: "Open Data",
  plss: "BLM PLSS",
  watershed: "USGS",
  fema_nri: "FEMA NRI",
  usda_clu: "USDA SSURGO",
};

export const openDataProvider: DataProvider = {
  name: "open-data",
  displayName: "Open Data (FEMA, Census, USGS, USDA, EPA, BLM)",
  categories: SUPPORTED_CATEGORIES,
  supportedInputTypes: ["coordinates", "address"],
  tierRequired: "free",
  // Mixed federal sources; all public-domain §105. The per-source attribution
  // is stamped via LookupResult.source → data-licenses register at render time.
  license: "public-domain-usgov",
  redistributable: "yes",

  costPerLookupCents(_category: DataCategory): number {
    return 0;
  },

  async isConfigured(_organizationId?: number): Promise<boolean> {
    // Free APIs don't require credentials (some accept optional keys for rate limits)
    return true;
  },

  async lookup(category: DataCategory, input: LookupInput): Promise<LookupResult> {
    const start = Date.now();

    if (input.type !== "coordinates" && input.type !== "address") {
      throw new Error(`open-data provider does not support input type: ${input.type}`);
    }

    let data: unknown;
    let confidence = 60; // Open data has moderate confidence

    if (category === "parcel_data") {
      const { lookupParcelByCoordinates } = await import("../parcel");
      if (input.type === "coordinates") {
        const result = await lookupParcelByCoordinates(input.latitude, input.longitude);
        data = result.parcel ?? null;
        confidence = result.found ? 80 : 20;
      } else {
        data = null;
        confidence = 0;
      }
    } else {
      const brokerCategory = BROKER_CATEGORY[category];
      if (!brokerCategory) {
        throw new Error(`open-data does not support category: ${category}`);
      }

      // Delegate to the broker, which owns the ~30 federal/open endpoint
      // integrations. The broker becomes the fetch IMPLEMENTATION; the
      // registry (our caller) owns the one cache + circuit breaker.
      const { dataSourceBroker } = await import("../data-source-broker");
      const lat = input.type === "coordinates" ? input.latitude : 0;
      const lng = input.type === "coordinates" ? input.longitude : 0;
      const state = input.type === "coordinates" || input.type === "address" ? input.state : undefined;
      const county = input.type === "coordinates" ? input.county : undefined;

      const result = await dataSourceBroker.lookup(brokerCategory, {
        latitude: lat,
        longitude: lng,
        state,
        county,
        // Hard-cap to free tier: the registry escalates to paid providers
        // explicitly via its tier ladder, never implicitly through the broker.
        maxTier: "free",
      });

      data = result.data;
      // Preserve the historical confidence values for the two original
      // delegated categories; use a uniform success/miss split for the rest.
      if (category === "environmental") {
        confidence = result.success ? 70 : 30;
      } else if (category === "demographics") {
        confidence = result.success ? 75 : 30;
      } else {
        confidence = result.success ? 70 : 30;
      }
    }

    return {
      provider: "open-data",
      category,
      confidence,
      costCents: 0,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: Date.now() - start,
      data,
      source: SOURCE_BY_CATEGORY[category] ?? "Open Data",
      // Open-data parcel/federal layers are authoritative systems-of-record.
      // Federal upstreams don't return a single fact-level effective date here,
      // so sourceAsOf is null (the customer sees "fetched" date instead).
      sourceAsOf: null,
      classification: "authoritative",
    };
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    try {
      // Quick check against FEMA NFHL (reliable free endpoint)
      const response = await fetch(
        "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer?f=json",
        { signal: AbortSignal.timeout(5000) }
      );
      return {
        healthy: response.ok,
        latencyMs: Date.now() - start,
        message: response.ok ? "FEMA NFHL reachable" : `Status ${response.status}`,
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
