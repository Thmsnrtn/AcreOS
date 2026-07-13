/**
 * Rosy River B10 — County GIS DataProvider wrap.
 *
 * Wraps the existing `lookupFromCountyGIS` in parcel.ts as a free-tier
 * DataProvider so it slots into the provider-registry at priority 5
 * (lowest = tried first within the same tier). Within the `parcel_data`
 * + `owner_info` categories, this means county GIS gets attempted
 * before Regrid (starter tier, priority 30) for every lookup — which
 * is the actual mechanical demotion of Regrid the original plan
 * called for.
 *
 * No new data sources, no new lookups. This module is a 30-line
 * adapter that lets the existing tiered-fallback architecture do its
 * job correctly.
 */

import { db } from "../../db";
import { countyGisEndpoints } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import type {
  DataCategory,
  DataProvider,
  LookupInput,
  LookupResult,
  ProviderHealthStatus,
} from "./types";

const SUPPORTED_CATEGORIES: DataCategory[] = ["parcel_data", "owner_info"];

export const countyGisProvider: DataProvider = {
  name: "county-gis",
  displayName: "County GIS (free, direct)",
  categories: SUPPORTED_CATEGORIES,
  // apn/address inputs resolve (state, county) themselves via
  // lookupFromCountyGIS; coordinates go through the statewide
  // point-intersection path (lookupFromCountyGISByPoint, Open-Data
  // Phase 3). Owner-name lookups don't carry a county, so they're
  // excluded — they'll route to a paid provider as before.
  supportedInputTypes: ["coordinates", "address", "apn"],
  tierRequired: "free",
  // County portals: terms vary by jurisdiction. Default conservative —
  // redistribution is "review-required" per Beatrice's policy until a human
  // reviews the specific county's terms (tracked per-row on county_gis_endpoints).
  license: "county-tos",
  redistributable: "review-required",

  costPerLookupCents(): number {
    return 0;
  },

  async isConfigured(): Promise<boolean> {
    // The provider is "configured" when at least one active county
    // endpoint exists. Any deploy with the seedCountyGisEndpoints rows
    // will satisfy this; future bulk imports just grow coverage.
    try {
      const [first] = await db
        .select({ id: countyGisEndpoints.id })
        .from(countyGisEndpoints)
        .where(eq(countyGisEndpoints.isActive, true))
        .limit(1);
      return Boolean(first);
    } catch (err) {
      logger.warn("[county-gis-provider] isConfigured query failed", {
        source: "county-gis-provider",
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      return false;
    }
  },

  async lookup(category: DataCategory, input: LookupInput): Promise<LookupResult> {
    const start = Date.now();

    // Coordinate inputs: FREE statewide point-intersection lookup against
    // the county = "*" statewide rows (Open-Data Phase 3). A point sits in
    // exactly one parcel, so no state/county/apn is needed up front.
    if (input.type === "coordinates") {
      const { lookupFromCountyGISByPoint } = await import("../parcel");
      const pointResult = await lookupFromCountyGISByPoint(input.latitude, input.longitude);
      if (!pointResult || !pointResult.found || !pointResult.parcel) {
        // No seeded statewide service covers this point. Throw so the
        // registry's tiered-fallback picks the next provider.
        throw new Error("county-gis: no statewide GIS match at these coordinates");
      }
      return {
        provider: "county-gis",
        category,
        confidence: 80,
        costCents: 0,
        fetchedAt: new Date(),
        cached: false,
        latencyMs: Date.now() - start,
        data: pointResult.parcel,
        source: "County GIS",
        sourceAsOf: null,
        classification: "authoritative",
      };
    }

    // Resolve state + county + apn from whatever input shape we got.
    let state: string | undefined;
    let county: string | undefined;
    let apn: string | undefined;
    if (input.type === "apn") {
      apn = input.apn;
      state = input.state;
      county = input.county;
    } else if (input.type === "address") {
      state = input.state;
      // address input has no county — try to infer by city is too lossy;
      // bail to next provider.
    }

    if (!state || !county || !apn) {
      // Missing required fields for a county GIS lookup. Throw so the
      // registry's tiered-fallback picks the next provider.
      throw new Error("county-gis requires state + county + apn");
    }

    // Delegate to the existing function in parcel.ts via dynamic import
    // to avoid a circular module dep at startup.
    const { lookupFromCountyGIS } = await import("../parcel");
    const result = await lookupFromCountyGIS(apn, state, county);

    if (!result || !result.found || !result.parcel) {
      throw new Error("county-gis: no match for apn in this county");
    }

    return {
      provider: "county-gis",
      category,
      confidence: 80, // county records are authoritative; deduct 20 for staleness
      costCents: 0,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: Date.now() - start,
      data: result.parcel,
      source: "County GIS",
      // County assessor records are systems-of-record; freshness lags by tax
      // year. The upstream doesn't expose a per-fact effective date here.
      sourceAsOf: null,
      classification: "authoritative",
    };
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    try {
      const [endpoints] = await db
        .select({ id: countyGisEndpoints.id })
        .from(countyGisEndpoints)
        .where(and(eq(countyGisEndpoints.isActive, true)))
        .limit(1);
      return {
        healthy: Boolean(endpoints),
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
        message: endpoints ? undefined : "no active county endpoints seeded",
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
