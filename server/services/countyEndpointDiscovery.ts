/**
 * County GIS endpoint autonomous-discovery loop.
 *
 * Wraps the existing `runDiscoveryScan` from arcgis-discovery.ts and persists
 * validated endpoints into the `countyGisEndpoints` table so the parcel
 * tiered-fallback chain (`server/services/parcel.ts:496+`) can rely on them
 * instead of paid Regrid calls.
 *
 * Idempotent: skips inserts when (state, county, baseUrl) already exists.
 * Validates every candidate via `validateEndpoint` (HEAD-of-metadata, field
 * inspection, sample query) before insertion — only writes rows we know
 * actually return parcel-shaped data.
 */

import { logger } from "../utils/logger";
import { db } from "../db";
import { countyGisEndpoints } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import {
  runDiscoveryScan,
  validateEndpoint,
  type ArcGISSearchOptions,
} from "./arcgis-discovery";

export interface DiscoveryRunResult {
  scanned: number;
  candidatesExtracted: number;
  alreadyKnown: number;
  validated: number;
  inserted: number;
  failed: number;
}

export async function runCountyEndpointDiscovery(
  options: ArcGISSearchOptions = {},
): Promise<DiscoveryRunResult> {
  const result: DiscoveryRunResult = {
    scanned: 0,
    candidatesExtracted: 0,
    alreadyKnown: 0,
    validated: 0,
    inserted: 0,
    failed: 0,
  };

  const scan = await runDiscoveryScan(options);
  result.scanned = scan.stats.totalSearchResults;
  result.candidatesExtracted = scan.endpoints.length;

  for (const endpoint of scan.endpoints) {
    try {
      // De-dupe against the table before paying the validation cost.
      const existing = await db
        .select({ id: countyGisEndpoints.id })
        .from(countyGisEndpoints)
        .where(
          and(
            eq(countyGisEndpoints.state, endpoint.state),
            eq(countyGisEndpoints.county, endpoint.county),
            eq(countyGisEndpoints.baseUrl, endpoint.baseUrl),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        result.alreadyKnown += 1;
        continue;
      }

      // SSRF guard (Beatrice item 5): auto-discovered baseUrls are fetched
      // server-side. Reject private/loopback/link-local/non-https before we
      // validate or persist them.
      const { checkOperatorUrl } = await import("./providers/ssrf-guard");
      if (!checkOperatorUrl(endpoint.baseUrl).ok) {
        result.failed += 1;
        continue;
      }

      const validation = await validateEndpoint(endpoint.baseUrl);
      if (!validation.valid || !validation.hasParcelData) {
        result.failed += 1;
        continue;
      }
      result.validated += 1;

      const apnFieldNames = ["apn", "parcel_id", "parcelid", "pin", "parcel_number"];
      const ownerFieldNames = ["owner", "ownername", "owner_name", "owner1"];
      const fields = validation.parcelFields ?? [];
      const apnField =
        fields.find((f) => apnFieldNames.some((n) => f.toLowerCase().includes(n))) ?? "APN";
      const ownerField =
        fields.find((f) => ownerFieldNames.some((n) => f.toLowerCase().includes(n))) ?? "OWNER";

      await db.insert(countyGisEndpoints).values({
        state: endpoint.state,
        county: endpoint.county,
        endpointType: endpoint.endpointType,
        baseUrl: endpoint.baseUrl,
        layerId: String(validation.parcelLayerId ?? 0),
        apnField,
        ownerField,
        geometryField: "geometry",
        isVerified: true,
        lastVerified: new Date(),
        isActive: true,
        errorCount: 0,
        sourceUrl: `arcgis-online:${endpoint.discoverySource}`,
        notes: `auto-discovered ${new Date().toISOString().slice(0, 10)} — confidence ${endpoint.confidenceScore.toFixed(2)} — ${validation.message}`,
        contributedBy: "auto-discovery",
      });
      result.inserted += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn(
        `[county-discovery] insert failed for ${endpoint.state}/${endpoint.county}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  logger.info(`[county-discovery] run complete`, { metadata: { ...result } });
  return result;
}
