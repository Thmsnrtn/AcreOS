#!/usr/bin/env tsx
/**
 * Seed lat/lng + parcel_centroid on every property in every active org
 * that doesn't already have coordinates, so /maps renders something
 * instead of the empty state.
 *
 * The earlier version of this script hard-coded property IDs 2 + 3.
 * That broke against production: properties 2 + 3 happen to belong to a
 * different org than the founder, so /maps for the founder still showed
 * the empty state and the map-smoke spec skipped every check.
 *
 * The fix: walk every property with NULL latitude and spread it across
 * a small AZ fixture-point pool. Idempotent — re-running is a no-op.
 *
 * Run locally:    npx tsx scripts/seed-property-coords.ts
 * Run on Fly:     fly ssh console -a acreos -C 'npx tsx scripts/seed-property-coords.ts'
 */
import { db } from "../server/db";
import { properties } from "../shared/schema";
import { eq, isNull, sql } from "drizzle-orm";

const FIXTURE_POINTS: Array<{ lat: number; lng: number; label: string }> = [
  { lat: 34.8697, lng: -111.7609, label: "Yavapai AZ (Sedona)" },
  { lat: 31.5455, lng: -110.2773, label: "Cochise AZ (Sierra Vista)" },
  { lat: 33.4484, lng: -112.0740, label: "Maricopa AZ (Phoenix)" },
  { lat: 32.2226, lng: -110.9747, label: "Pima AZ (Tucson)" },
  { lat: 35.1983, lng: -111.6513, label: "Coconino AZ (Flagstaff)" },
];

async function main() {
  const rows = await db
    .select({ id: properties.id, organizationId: properties.organizationId })
    .from(properties)
    .where(isNull(properties.latitude));

  if (rows.length === 0) {
    console.log("no properties missing coordinates — nothing to seed");
    process.exit(0);
  }

  console.log(`found ${rows.length} properties without coords — seeding`);

  let i = 0;
  for (const row of rows) {
    const point = FIXTURE_POINTS[i % FIXTURE_POINTS.length];
    await db
      .update(properties)
      .set({
        latitude: String(point.lat),
        longitude: String(point.lng),
        parcelCentroid: sql`${JSON.stringify({ lat: point.lat, lng: point.lng })}::jsonb`,
      })
      .where(eq(properties.id, row.id));
    console.log(`  property ${row.id} (org ${row.organizationId}) → ${point.label}`);
    i += 1;
  }

  console.log(`seeded ${rows.length} properties`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
