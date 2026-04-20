#!/usr/bin/env tsx
/**
 * One-off seed: add lat/lng to the two pre-seeded test properties so
 * /maps renders pins for them. Cochise AZ near Sierra Vista;
 * Yavapai AZ / Sedona.
 *
 * Run inside fly ssh: npx tsx scripts/seed-property-coords.ts
 */
import { db } from "../server/db";
import { properties } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  // Yavapai AZ (property #3) — Sedona area
  await db
    .update(properties)
    .set({
      latitude: "34.8697",
      longitude: "-111.7609",
      parcelCentroid: { lat: 34.8697, lng: -111.7609 },
    })
    .where(eq(properties.id, 3));
  // Cochise AZ (property #2) — Sierra Vista / southeast AZ
  await db
    .update(properties)
    .set({
      latitude: "31.5455",
      longitude: "-110.2773",
      parcelCentroid: { lat: 31.5455, lng: -110.2773 },
    })
    .where(eq(properties.id, 2));
  console.log("seeded coords for properties 2 and 3");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
