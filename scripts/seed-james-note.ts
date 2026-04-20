#!/usr/bin/env tsx
/**
 * One-off seed: make the test org's pre-existing promissory note
 * (originally `Borrower #null / Property #null`) a real seller-financed
 * note with a named borrower lead and the Yavapai property #3 as the
 * underlying collateral. Used by r8 James × note-servicing verification.
 *
 * Run inside a fly ssh console:
 *   npx tsx scripts/seed-james-note.ts
 */
import { db } from "../server/db";
import { notes, leads, properties } from "../shared/schema";
import { eq, and } from "drizzle-orm";

const ORG_ID = 2;

async function main() {
  // 1. Ensure a borrower lead exists.
  let [borrower] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, ORG_ID), eq(leads.email, "marisol.vega@example.com")))
    .limit(1);
  if (!borrower) {
    const inserted = await db
      .insert(leads)
      .values({
        organizationId: ORG_ID,
        firstName: "Marisol",
        lastName: "Vega",
        email: "marisol.vega@example.com",
        phone: "+15205550142",
        status: "closed",
        source: "seed",
        stage: "converted",
      } as any)
      .returning();
    borrower = inserted[0];
    console.log("created borrower lead:", borrower.id);
  } else {
    console.log("reusing borrower lead:", borrower.id);
  }

  // 2. Confirm property 3 (Yavapai) exists.
  const [property] = await db.select().from(properties).where(eq(properties.id, 3)).limit(1);
  if (!property) {
    console.error("property id 3 (Yavapai) not found — aborting");
    process.exit(1);
  }

  // 3. Update any existing notes for this org that are missing borrower/property.
  const existing = await db
    .select()
    .from(notes)
    .where(eq(notes.organizationId, ORG_ID));
  console.log("existing notes in org:", existing.length);
  for (const n of existing) {
    if (!n.borrowerId || !n.propertyId) {
      const updated = await db
        .update(notes)
        .set({
          borrowerId: borrower.id,
          propertyId: property.id,
          status: "active",
        })
        .where(eq(notes.id, n.id))
        .returning({ id: notes.id, borrowerId: notes.borrowerId, propertyId: notes.propertyId });
      console.log("updated note:", updated);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
