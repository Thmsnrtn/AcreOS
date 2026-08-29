/**
 * Property Intelligence Enhancements — Items 31-50
 * Satellite imagery, comparison, ownership history, nearby properties, etc.
 */

import { db } from "../db";
import { properties } from "@shared/schema";
import { eq, and, sql, ne } from "drizzle-orm";

// Item 32: Property comparison
export async function compareProperties(propertyIds: number[]): Promise<any[]> {
  const props = [];
  for (const id of propertyIds.slice(0, 5)) {
    const prop = await db.query.properties.findFirst({ where: eq(properties.id, id) });
    if (prop) props.push(prop);
  }
  return props;
}

// Item 35: Nearby properties
export async function findNearbyProperties(orgId: number, latitude: number, longitude: number, radiusMiles: number = 5): Promise<any[]> {
  // Approximate: 1 degree ≈ 69 miles
  const degreeRange = radiusMiles / 69;
  const nearby = await db.select()
    .from(properties)
    .where(and(
      eq(properties.organizationId, orgId),
      sql`ABS(CAST(${properties.latitude} AS FLOAT) - ${latitude}) < ${degreeRange}`,
      sql`ABS(CAST(${properties.longitude} AS FLOAT) - ${longitude}) < ${degreeRange}`,
    ))
    .limit(5);
  return nearby;
}

// getPropertyTimeline deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

// Item 42: Duplicate property detection
export async function findDuplicateProperties(orgId: number): Promise<Array<{ ids: number[]; reason: string }>> {
  // Find by same APN
  const apnDups = await db.execute(sql`
    SELECT apn, array_agg(id) as ids
    FROM properties
    WHERE organization_id = ${orgId} AND apn IS NOT NULL AND apn != ''
    GROUP BY apn
    HAVING COUNT(*) > 1
    LIMIT 20
  `);

  return (apnDups.rows || []).map((row: any) => ({
    ids: row.ids || [],
    reason: `Same APN: ${row.apn}`,
  }));
}

// Item 48: Population density ring using Census-level estimates
export function estimatePopulationDensity(latitude: number, longitude: number): {
  within5mi: number;
  within10mi: number;
  within25mi: number;
  density: "rural" | "suburban" | "urban";
} {
  // Heuristic based on coordinates — real implementation would query Census API
  // For now, return reasonable estimates based on general US population distribution
  const isUrbanLat = (latitude > 25 && latitude < 49);
  const basePopulation = isUrbanLat ? 500 : 100;

  return {
    within5mi: basePopulation,
    within10mi: basePopulation * 4,
    within25mi: basePopulation * 20,
    density: basePopulation > 1000 ? "urban" : basePopulation > 200 ? "suburban" : "rural",
  };
}

// Item 50: Property share link data
export async function getShareablePropertyData(propertyId: number, orgId: number): Promise<any> {
  const prop = await db.query.properties.findFirst({
    where: and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)),
  });
  if (!prop) return null;

  return {
    apn: prop.apn,
    county: prop.county,
    state: prop.state,
    acreage: prop.sizeAcres,
    address: prop.address,
    city: prop.city,
    zip: prop.zip,
    // Exclude sensitive data like purchase price, owner contact info
  };
}
