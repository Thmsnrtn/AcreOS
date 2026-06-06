/**
 * Regrid Provider — extracts from comps.ts and parcel.ts.
 * Uses BYOK pattern. Categories: parcel_data, comps, owner_info, valuation.
 * Tier: starter. Cost: 3–8 cents.
 *
 * Bulk / incremental Regrid pulls (boundary-update sync) are owned by the
 * Wenzeslaus ETL orchestrator — see `server/services/etlHandlers.ts`
 * (`regridEtlHandler`) and the seeded `regrid_parcels_v1` row in
 * `etl_jobs`. This module is the on-demand lookup path only (single
 * APN/coordinate hits initiated by user actions), and intentionally
 * stays separate so on-demand lookups don't have to wait for a
 * scheduled tick.
 */
import { logger } from "../../utils/logger";
import type {
  DataCategory,
  DataProvider,
  LookupInput,
  LookupResult,
  ProviderHealthStatus,
} from "./types";

const CATEGORY_COSTS: Partial<Record<DataCategory, number>> = {
  parcel_data: 3,
  comps: 8,
  owner_info: 5,
  valuation: 5,
};

const SUPPORTED_CATEGORIES: DataCategory[] = ["parcel_data", "comps", "owner_info", "valuation"];

async function getApiKey(organizationId?: number): Promise<string | null> {
  // BYOK first
  if (organizationId) {
    try {
      const { storage } = await import("../../storage");
      const integration = await storage.getOrganizationIntegration(organizationId, "regrid");
      if (integration?.isEnabled && (integration.credentials as any)?.encrypted) {
        const { decryptJsonCredentials } = await import("../fieldEncryption");
        const creds = decryptJsonCredentials<{ apiKey: string }>(
          (integration.credentials as any).encrypted,
          organizationId
        );
        if (creds.apiKey) return creds.apiKey;
      }
    } catch (error) {
      logger.warn("Failed to get BYOK Regrid key", {
        source: "RegridProvider",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  // Platform fallback
  return process.env.REGRID_API_KEY ?? null;
}

export const regridProvider: DataProvider = {
  name: "regrid",
  displayName: "Regrid",
  categories: SUPPORTED_CATEGORIES,
  supportedInputTypes: ["coordinates", "address", "apn"],
  tierRequired: "starter",
  // Proprietary feed — contract governs redistribution + cache TTL. Default
  // conservative: live-passthrough only until a signed contract upgrades it.
  license: "proprietary",
  attributionText: "Parcel data: Regrid",
  redistributable: "no",
  // Regrid is pay-per-call (no monthly floor) at our stage — passes the
  // 2%-of-MRR guard. Set explicitly to 0 so the guard reads it as no-floor.
  minMonthlyCommitCents: 0,

  costPerLookupCents(category: DataCategory): number {
    return CATEGORY_COSTS[category] ?? 5;
  },

  async isConfigured(organizationId?: number): Promise<boolean> {
    const key = await getApiKey(organizationId);
    return key !== null;
  },

  async lookup(category: DataCategory, input: LookupInput): Promise<LookupResult> {
    const start = Date.now();
    const apiKey = await getApiKey();

    if (!apiKey) {
      throw new Error("Regrid API key not configured");
    }

    let data: unknown;
    let confidence = 75;

    // Delegate to existing comps/parcel services that already handle Regrid API
    switch (category) {
      case "parcel_data": {
        if (input.type === "coordinates") {
          const { lookupParcelByCoordinates } = await import("../parcel");
          const result = await lookupParcelByCoordinates(input.latitude, input.longitude);
          data = result.parcel ?? null;
          confidence = result.found ? 85 : 20;
        } else if (input.type === "apn") {
          const { lookupParcelByAPN } = await import("../parcel");
          // lookupParcelByAPN takes a combined "state/county" path, not
          // separate state/county arguments.
          const stateCountyPath = [input.state, input.county].filter(Boolean).join("/");
          const result = await lookupParcelByAPN(input.apn, stateCountyPath);
          data = result.parcel ?? null;
          confidence = result.found ? 90 : 20;
        } else {
          throw new Error(`Regrid parcel_data does not support input type: ${input.type}`);
        }
        break;
      }

      case "comps": {
        if (input.type === "coordinates") {
          const { getComparableProperties } = await import("../comps");
          const result = await getComparableProperties(
            input.latitude,
            input.longitude,
            5, // radius miles
            {}
          );
          data = result.comps ?? [];
          confidence = (result as any).success ? 80 : 30;
        } else {
          throw new Error(`Regrid comps does not support input type: ${input.type}`);
        }
        break;
      }

      case "owner_info":
      case "valuation": {
        if (input.type === "coordinates") {
          const { lookupParcelByCoordinates } = await import("../parcel");
          const result = await lookupParcelByCoordinates(input.latitude, input.longitude);
          data = result.parcel?.data ?? null;
          confidence = result.found ? 80 : 20;
        } else {
          throw new Error(`Regrid ${category} does not support input type: ${input.type}`);
        }
        break;
      }

      default:
        throw new Error(`Regrid does not support category: ${category}`);
    }

    return {
      provider: "regrid",
      category,
      confidence,
      costCents: this.costPerLookupCents(category),
      fetchedAt: new Date(),
      cached: false,
      latencyMs: Date.now() - start,
      data,
      source: "Regrid",
      sourceAsOf: null,
      // Regrid normalizes parcel-of-record data; treat as authoritative for
      // parcel/owner, estimate for valuation (it's a derived value).
      classification: category === "valuation" ? "estimate" : "authoritative",
    };
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    const key = await getApiKey();

    if (!key) {
      return {
        healthy: false,
        latencyMs: 0,
        message: "No API key configured",
        checkedAt: new Date(),
      };
    }

    try {
      const response = await fetch("https://app.regrid.com/api/v2/parcels?limit=1", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      return {
        healthy: response.ok,
        latencyMs: Date.now() - start,
        message: response.ok ? "Regrid API reachable" : `Status ${response.status}`,
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
