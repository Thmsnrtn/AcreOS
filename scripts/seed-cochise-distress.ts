#!/usr/bin/env tsx
/**
 * One-off seed: mark Cochise AZ (property id 2) as tax-delinquent so
 * cycle-4 distressed-parcel journeys (r4 Priya, r3 Robert, r7 Sofia)
 * have a realistic target.
 *
 * Run inside a fly ssh console (DATABASE_URL is available):
 *   npx tsx scripts/seed-cochise-distress.ts
 */
import { db } from "../server/db";
import { properties } from "../shared/schema";
import { eq } from "drizzle-orm";

const distress = {
  taxDelinquent: true,
  taxDelinquentYears: 4,
  taxPrincipalCents: 240000, // $2,400.00 principal
  taxPenaltyCents: 48000, // $480.00 penalty
  taxInterestCents: 32000, // $320.00 interest
  taxPayoffAsOf: "2026-04-01",
  probate: false,
  codeViolation: false,
  source: "Cochise County Treasurer, 2026-04",
  updatedAt: new Date().toISOString(),
  // Cycle 5 r2 Priya / r3 Sofia: AZ tax-lien lifecycle. Arizona is a
  // tax-lien state; lien was sold in Feb 2023 to a private investor;
  // 3-year redemption window runs through Feb 2026 (now in the
  // treasurer-deed eligibility window).
  lienState: "tax-lien" as const,
  lienSoldDate: "2023-02-14",
  lienHolder: "Desert Tax Lien Fund LLC (private investor)",
  redemptionDeadline: "2026-02-14",
  auctionDate: "2026-06-10", // next treasurer-deed auction if not redeemed
  openingBid: 320000, // $3,200.00 opening bid — equals payoff
};

async function main() {
  const [row] = await db.select().from(properties).where(eq(properties.id, 2)).limit(1);
  if (!row) {
    console.error("property id 2 not found");
    process.exit(1);
  }
  const next = { ...(row.dueDiligenceData as Record<string, unknown> | null ?? {}), distress };
  const updated = await db
    .update(properties)
    .set({ dueDiligenceData: next as any })
    .where(eq(properties.id, 2))
    .returning({ id: properties.id });
  console.log("updated:", updated);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
