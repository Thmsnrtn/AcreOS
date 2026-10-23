/**
 * Regrid Provider — extracts from comps.ts and parcel.ts.
 * Uses BYOK pattern. Categories: parcel_data, comps, owner_info, valuation.
 * Tier: starter. Cost: 10¢ (Standard) / 15¢ (Premium) per record returned.
 *
 * Bulk / incremental Regrid pulls (boundary-update sync) are owned by the
 * Wenzeslaus ETL orchestrator — see `server/services/etlHandlers.ts`
 * (`regridEtlHandler`) and the seeded `regrid_parcels_v1` row in
 * `etl_jobs`. This module is the on-demand lookup path only (single
 * APN/coordinate hits initiated by user actions), and intentionally
 * stays separate so on-demand lookups don't have to wait for a
 * scheduled tick.
 */
import type {
  DataCategory,
  DataProvider,
  LookupInput,
  LookupResult,
  ProviderHealthStatus,
  ProviderLookupContext,
} from "./types";
import { clock } from "../../utils/clock";

/**
 * Regrid's published API price floor, in cents PER RECORD RETURNED — a call
 * that returns no record is not billed. Source: Regrid API pricing
 * (https://regrid.com/api), as stated in the D1 data-sourcing package
 * 2026-10-22: 10¢/record Standard schema, 15¢/record Premium schema. The old
 * table (3–8¢) sat below this floor, so every paid lookup was metered at less
 * than it cost. Not re-read live from this container (the host is outside its
 * network policy) — re-verify against the page when it changes.
 */
const REGRID_CENTS_PER_RECORD = { standard: 10, premium: 15 } as const;

/**
 * Which schema each category reads. A bare parcel boundary + identity is the
 * Standard schema; owner, valuation and the comps radius search read Premium
 * fields (the comps search also returns several records per call — this is a
 * per-record price, so a multi-record comps call costs a multiple of it).
 */
const REGRID_CATEGORY_SCHEMA = {
  parcel_data: "standard",
  comps: "premium",
  owner_info: "premium",
  valuation: "premium",
} as const satisfies Partial<Record<DataCategory, keyof typeof REGRID_CENTS_PER_RECORD>>;

const CATEGORY_COSTS: Partial<Record<DataCategory, number>> = Object.fromEntries(
  Object.entries(REGRID_CATEGORY_SCHEMA).map(([category, schema]) => [category, REGRID_CENTS_PER_RECORD[schema]]),
);

const SUPPORTED_CATEGORIES: DataCategory[] = ["parcel_data", "comps", "owner_info", "valuation"];

async function getApiKey(organizationId?: number): Promise<string | null> {
  // BYOK first — vault (connectors hub) then legacy, via the shared resolver.
  // Previously this read ONLY the legacy store, so a regrid key connected in
  // the hub (which writes the canonical vault) was silently ignored.
  if (organizationId) {
    const { resolveProviderCredential } = await import("./resolveProviderCredential");
    const key = await resolveProviderCredential(organizationId, {
      channel: "regrid",
      legacyProvider: "regrid",
      legacyField: "apiKey",
    });
    if (key) return key;
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
    // An unlisted category is never priced below the published floor.
    return CATEGORY_COSTS[category] ?? REGRID_CENTS_PER_RECORD.standard;
  },

  async isConfigured(organizationId?: number): Promise<boolean> {
    const key = await getApiKey(organizationId);
    return key !== null;
  },

  async lookup(category: DataCategory, input: LookupInput, ctx?: ProviderLookupContext): Promise<LookupResult> {
    const start = clock.nowMs();
    // R1d BYO-data-keys: the registry resolves the customer's Regrid key from
    // the canonical BYOK vault and passes it here; prefer it over the platform
    // key. It is handed to the parcel service, which calls Regrid with it — it
    // used to stop here, so the parcel service called Regrid on the PLATFORM
    // key while the registry, believing BYOK served, debited no credit.
    const apiKey = ctx?.apiKeyOverride ?? await getApiKey();

    if (!apiKey) {
      throw new Error("Regrid API key not configured");
    }

    // Only the customer's OWN key is handed down as theirs — the parcel
    // service puts Regrid first for an org's own key, and behind free county
    // data for AcreOS's platform licence.
    const byokOpts = ctx?.apiKeyOverride ? { regridApiKey: ctx.apiKeyOverride } : {};

    let data: unknown;
    let confidence = 75;
    // lookupParcelByCoordinates/ByAPN fall back to free tiers (statewide/
    // county GIS, cache) before Regrid. When the answer came from a free
    // source, report zero cost — never bill a free hit as a Regrid call.
    // Regrid bills per record RETURNED, so a call that found nothing is not
    // billed either (D1a) — `notBilled` covers both.
    let notBilled = false;

    // Delegate to existing comps/parcel services that already handle Regrid API
    switch (category) {
      case "parcel_data": {
        if (input.type === "coordinates") {
          const { lookupParcelByCoordinates } = await import("../parcel");
          const result = await lookupParcelByCoordinates(input.latitude, input.longitude, byokOpts);
          data = result.parcel ?? null;
          confidence = result.found ? 85 : 20;
          notBilled = !result.found || result.source !== "regrid";
        } else if (input.type === "apn") {
          const { lookupParcelByAPN } = await import("../parcel");
          // lookupParcelByAPN takes a combined "state/county" path, not
          // separate state/county arguments.
          const stateCountyPath = [input.state, input.county].filter(Boolean).join("/");
          const result = await lookupParcelByAPN(input.apn, stateCountyPath, undefined, byokOpts);
          data = result.parcel ?? null;
          confidence = result.found ? 90 : 20;
          notBilled = !result.found || result.source !== "regrid";
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
            {},
            undefined,
            // The registry resolved the customer's key; comps used to drop it
            // and spend the platform key (audit of 6b730aa).
            ctx?.apiKeyOverride,
          );
          data = result.comps ?? [];
          confidence = (result as any).success ? 80 : 30;
          notBilled = (result.comps ?? []).length === 0;
        } else {
          throw new Error(`Regrid comps does not support input type: ${input.type}`);
        }
        break;
      }

      case "owner_info":
      case "valuation": {
        if (input.type === "coordinates") {
          const { lookupParcelByCoordinates } = await import("../parcel");
          const result = await lookupParcelByCoordinates(input.latitude, input.longitude, byokOpts);
          data = result.parcel?.data ?? null;
          confidence = result.found ? 80 : 20;
          notBilled = !result.found || result.source !== "regrid";
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
      costCents: notBilled ? 0 : this.costPerLookupCents(category),
      fetchedAt: clock.now(),
      cached: false,
      latencyMs: clock.nowMs() - start,
      data,
      source: "Regrid",
      sourceAsOf: null,
      // Regrid normalizes parcel-of-record data; treat as authoritative for
      // parcel/owner, estimate for valuation (it's a derived value).
      classification: category === "valuation" ? "estimate" : "authoritative",
    };
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = clock.nowMs();
    const key = await getApiKey();

    if (!key) {
      return {
        healthy: false,
        latencyMs: 0,
        message: "No API key configured",
        checkedAt: clock.now(),
      };
    }

    try {
      // Regrid has no bare `/parcels` collection route (it 404s); a valid call
      // needs a selector sub-path. Mirror the real lookup/validate path
      // (parcels/address) so the probe reflects the integration's true health.
      const response = await fetch(
        "https://app.regrid.com/api/v2/parcels/address?query=1600%20Pennsylvania%20Ave%20NW,%20Washington,%20DC&limit=1",
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        },
      );
      return {
        healthy: response.ok,
        latencyMs: clock.nowMs() - start,
        message: response.ok ? "Regrid API reachable" : `Status ${response.status}`,
        checkedAt: clock.now(),
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: clock.nowMs() - start,
        message: error instanceof Error ? error.message : "Health check failed",
        checkedAt: clock.now(),
      };
    }
  },
};
