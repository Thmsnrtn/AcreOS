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

const SUPPORTED_CATEGORIES: DataCategory[] = [
  "environmental",
  "demographics",
  "parcel_data",
];

export const openDataProvider: DataProvider = {
  name: "open-data",
  displayName: "Open Data (FEMA, Census, USGS, USDA, EPA, BLM)",
  categories: SUPPORTED_CATEGORIES,
  supportedInputTypes: ["coordinates", "address"],
  tierRequired: "free",

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

    switch (category) {
      case "environmental": {
        // Delegate to existing data source broker for environmental categories
        const { dataSourceBroker } = await import("../data-source-broker");
        const lat = input.type === "coordinates" ? input.latitude : 0;
        const lng = input.type === "coordinates" ? input.longitude : 0;

        const result = await dataSourceBroker.lookup("flood_zone", {
          latitude: lat,
          longitude: lng,
          maxTier: "free",
        });

        data = result.data;
        confidence = result.success ? 70 : 30;
        break;
      }

      case "demographics": {
        const { dataSourceBroker } = await import("../data-source-broker");
        const lat = input.type === "coordinates" ? input.latitude : 0;
        const lng = input.type === "coordinates" ? input.longitude : 0;

        const result = await dataSourceBroker.lookup("demographics", {
          latitude: lat,
          longitude: lng,
          maxTier: "free",
        });

        data = result.data;
        confidence = result.success ? 75 : 30;
        break;
      }

      case "parcel_data": {
        const { lookupParcelByCoordinates } = await import("../parcel");
        if (input.type === "coordinates") {
          const result = await lookupParcelByCoordinates(input.latitude, input.longitude);
          data = result.parcel ?? null;
          confidence = result.found ? 80 : 20;
        } else {
          data = null;
          confidence = 0;
        }
        break;
      }

      default:
        throw new Error(`open-data does not support category: ${category}`);
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
