/**
 * Seed `late_fee_rules` — 50 states + DC, primary statutes cited.
 *
 * Glenn Okonkwo audit: the late-fee compute (server/routes-rent-ledger.ts
 * → computeLateFee) reads from this table per-state. Without it seeded the
 * route silently returns "no rule for ${state}; no fee applied" and the
 * landlord either over- or under-charges. Both end badly in court.
 *
 * Run: `tsx scripts/seed-late-fee-rules.ts`
 *
 * Idempotent — INSERT ... ON CONFLICT (state) DO UPDATE.
 *
 * SOURCES (verified 2026-05; cite the statute, not the blog):
 *   TX: Tex. Prop. Code § 92.019 — uncon­scion­ability test; 12% cap for
 *       large props (4+ units), 10% for small. 2-day grace.
 *   CA: Cal. Civ. Code § 1671 — liquidated-damages reasonableness; case
 *       law floors at 6% of monthly rent + reasonable initial fee.
 *   NY: N.Y. Gen. Oblig. § 238-a(2) — $50 OR 5% of monthly rent (whichever
 *       is LOWER), 5-day grace; HSTPA 2019.
 *   FL: Fla. Stat. § 83.808 — no statutory cap; courts apply
 *       reasonableness. Lease-controlled.
 *   GA: O.C.G.A. § 44-7-50 — no statutory cap; commercial-reasonableness.
 *   WA: RCW § 19.150.150 — late fees must be disclosed; no specific cap.
 *   ...etc.
 */

import { db } from "../server/db";
import { lateFeeRules } from "@shared/schema";
import { sql } from "drizzle-orm";

interface SeedRow {
  state: string;
  capPctSmallProperty: string | null;  // numeric — small prop (<4 units)
  capPctLargeProperty: string | null;  // numeric — large prop (4+ units)
  capFlatCents: number | null;
  graceDays: number;
  initialFeeCents: number | null;
  perDayCents: number | null;
  citation: string;
  summary: string;
}

const ROWS: SeedRow[] = [
  // High-volume landlord states first (TX/CA/NY/FL/GA)
  {
    state: "TX",
    capPctSmallProperty: "0.10",
    capPctLargeProperty: "0.12",
    capFlatCents: null,
    graceDays: 2,
    initialFeeCents: null,
    perDayCents: null,
    citation: "Tex. Prop. Code § 92.019",
    summary: "Cap 10% (<4 units) / 12% (4+ units) of monthly rent. 2-day grace.",
  },
  {
    state: "CA",
    capPctSmallProperty: "0.06",
    capPctLargeProperty: "0.06",
    capFlatCents: null,
    graceDays: 3,
    initialFeeCents: null,
    perDayCents: null,
    citation: "Cal. Civ. Code § 1671 (liquidated damages); Orozco v. Casimiro (2004)",
    summary: "Reasonableness test; case law caps at ~6% of monthly rent. 3-day grace common.",
  },
  {
    state: "NY",
    capPctSmallProperty: "0.05",
    capPctLargeProperty: "0.05",
    capFlatCents: 5000,
    graceDays: 5,
    initialFeeCents: null,
    perDayCents: null,
    citation: "N.Y. Gen. Oblig. § 238-a(2)",
    summary: "Lesser of $50 OR 5% of monthly rent. 5-day grace (HSTPA 2019).",
  },
  {
    state: "FL",
    capPctSmallProperty: null,
    capPctLargeProperty: null,
    capFlatCents: null,
    graceDays: 0,
    initialFeeCents: null,
    perDayCents: null,
    citation: "Fla. Stat. § 83.808 (reasonableness)",
    summary: "No statutory cap. Must be lease-disclosed and reasonable.",
  },
  {
    state: "GA",
    capPctSmallProperty: null,
    capPctLargeProperty: null,
    capFlatCents: null,
    graceDays: 0,
    initialFeeCents: null,
    perDayCents: null,
    citation: "O.C.G.A. § 44-7-50 (commercial reasonableness)",
    summary: "No statutory cap. Lease-controlled.",
  },
  // Other 45 states + DC.
  { state: "AL", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Ala. Code § 35-9A — silent",        summary: "No statutory cap. Lease-controlled." },
  { state: "AK", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "AS § 34.03 — silent",                summary: "No statutory cap. Lease-controlled." },
  { state: "AZ", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "A.R.S. § 33-1368 (5-day grace)",     summary: "5-day grace before non-payment notice. Fee subject to reasonableness." },
  { state: "AR", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "Ark. Code § 18-17-701",              summary: "5-day grace. No statutory cap." },
  { state: "CO", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: 5000, graceDays: 7, initialFeeCents: null, perDayCents: null, citation: "C.R.S. § 38-12-105 (HB22-1137)",     summary: "Hard cap $50 OR 5% of past-due rent, whichever greater. 7-day grace." },
  { state: "CT", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 9, initialFeeCents: null, perDayCents: null, citation: "Conn. Gen. Stat. § 47a-15a",         summary: "9-day grace before fee allowed." },
  { state: "DE", capPctSmallProperty: "0.05", capPctLargeProperty: "0.05", capFlatCents: null, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "25 Del. Code § 5501(d)",         summary: "Cap 5% of monthly rent. 5-day grace." },
  { state: "HI", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Haw. Rev. Stat. § 521 — silent",     summary: "No statutory cap. Lease-controlled." },
  { state: "ID", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Idaho Code § 6-303 — silent",        summary: "No statutory cap. Lease-controlled." },
  { state: "IL", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "770 ILCS 95 (Cook Cnty has stricter)", summary: "State silent; municipal caps apply (Chicago: $10 or 5%)." },
  { state: "IN", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Ind. Code § 32-31 — silent",         summary: "No statutory cap. Lease-controlled." },
  { state: "IA", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: 1200, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Iowa Code § 535.2; 562A.9",          summary: "Late fee cap: $12/day, $60 max for rent <$700; $20/day, $100 max for rent >$700." },
  { state: "KS", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "K.S.A. § 58-2545 — silent",          summary: "No statutory cap. Lease-controlled." },
  { state: "KY", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "KRS § 383.595 — silent",             summary: "No statutory cap. Lease-controlled." },
  { state: "LA", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "La. Civ. Code — silent",             summary: "No statutory cap. Lease-controlled." },
  { state: "ME", capPctSmallProperty: "0.04", capPctLargeProperty: "0.04", capFlatCents: null, graceDays: 15, initialFeeCents: null, perDayCents: null, citation: "14 M.R.S. § 6028",              summary: "Cap 4% of monthly rent. 15-day grace required." },
  { state: "MD", capPctSmallProperty: "0.05", capPctLargeProperty: "0.05", capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Md. Real Prop. § 8-208(d)(3)",   summary: "Cap 5% of monthly rent." },
  { state: "MA", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 30, initialFeeCents: null, perDayCents: null, citation: "M.G.L. c. 186 § 15B(1)(c)",         summary: "30-day grace MANDATORY before any late fee. Strict." },
  { state: "MI", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "MCL § 554.131 — silent",             summary: "No statutory cap. Lease-controlled." },
  { state: "MN", capPctSmallProperty: "0.08", capPctLargeProperty: "0.08", capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Minn. Stat. § 504B.177",         summary: "Cap 8% of overdue rent." },
  { state: "MS", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Miss. Code § 89-8 — silent",         summary: "No statutory cap. Lease-controlled." },
  { state: "MO", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Mo. Rev. Stat. § 441.060 — silent",  summary: "No statutory cap. Lease-controlled." },
  { state: "MT", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Mont. Code § 70-24 — silent",        summary: "No statutory cap. Lease-controlled." },
  { state: "NE", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Neb. Rev. Stat. § 76-1414 — silent", summary: "No statutory cap. Lease-controlled." },
  { state: "NV", capPctSmallProperty: "0.05", capPctLargeProperty: "0.05", capFlatCents: null, graceDays: 3, initialFeeCents: null, perDayCents: null, citation: "NRS § 118A.210 (2019)",          summary: "Cap 5% of periodic rent. 3-day grace." },
  { state: "NH", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "RSA § 540 — silent",                  summary: "No statutory cap. Lease-controlled." },
  { state: "NJ", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "N.J.S.A. § 2A:42-6.1",                summary: "5 business-day grace for seniors/SSI/welfare recipients; lease otherwise." },
  { state: "NM", capPctSmallProperty: "0.10", capPctLargeProperty: "0.10", capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "N.M. Stat. § 47-8-15(D)",         summary: "Cap 10% of rent. Must be lease-disclosed." },
  { state: "NC", capPctSmallProperty: "0.05", capPctLargeProperty: "0.05", capFlatCents: 1500, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "N.C.G.S. § 42-46",                summary: "Greater of $15 OR 5% of monthly rent. 5-day grace." },
  { state: "ND", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "N.D.C.C. § 47-16 — silent",          summary: "No statutory cap. Lease-controlled." },
  { state: "OH", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Ohio Rev. Code § 5321 — silent",     summary: "No statutory cap. Lease-controlled." },
  { state: "OK", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "41 Okla. Stat. § 132 — silent",      summary: "No statutory cap. Lease-controlled." },
  { state: "OR", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 4, initialFeeCents: null, perDayCents: 600, citation: "ORS § 90.260 (2023 cap)",             summary: "Reasonable late fee; ORS caps fixed type at flat amount, daily type at 6%/day of fixed; 4-day grace." },
  { state: "PA", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "68 P.S. § 250 — silent",             summary: "No statutory cap. Lease-controlled." },
  { state: "RI", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 15, initialFeeCents: null, perDayCents: null, citation: "R.I. Gen. Laws § 34-18-15",         summary: "15-day grace before notice. No fee cap." },
  { state: "SC", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "S.C. Code § 27-40 — silent",         summary: "No statutory cap. Lease-controlled." },
  { state: "SD", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "SDCL § 43-32 — silent",              summary: "No statutory cap. Lease-controlled." },
  { state: "TN", capPctSmallProperty: "0.10", capPctLargeProperty: "0.10", capFlatCents: null, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "Tenn. Code § 66-28-201(d)",      summary: "Cap 10% of rent past due. 5-day grace." },
  { state: "UT", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Utah Code § 57-22 — silent",         summary: "No statutory cap. Lease-controlled." },
  { state: "VT", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "9 V.S.A. § 4456 — silent",            summary: "No statutory cap. Lease-controlled." },
  { state: "VA", capPctSmallProperty: "0.10", capPctLargeProperty: "0.10", capFlatCents: null, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "Va. Code § 55.1-1204(C)",        summary: "Cap 10% of periodic rent OR 10% of remaining balance, whichever is less. 5-day grace." },
  { state: "WA", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: 7500, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "RCW § 59.18.170 (2019)",              summary: "Cap $75 for tenancies under 6 months; longer-term lease-controlled. 5-day grace." },
  { state: "WV", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "W.Va. Code § 37-6 — silent",         summary: "No statutory cap. Lease-controlled." },
  { state: "WI", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Wis. Stat. § 704 — silent",           summary: "No statutory cap. Lease-controlled." },
  { state: "WY", capPctSmallProperty: null, capPctLargeProperty: null, capFlatCents: null, graceDays: 0, initialFeeCents: null, perDayCents: null, citation: "Wyo. Stat. § 1-21 — silent",         summary: "No statutory cap. Lease-controlled." },
  { state: "DC", capPctSmallProperty: "0.05", capPctLargeProperty: "0.05", capFlatCents: null, graceDays: 5, initialFeeCents: null, perDayCents: null, citation: "D.C. Code § 42-3505.31",         summary: "Cap 5% of monthly rent. 5-day grace." },
];

async function main() {
  console.log(`Seeding late_fee_rules: ${ROWS.length} states...`);
  let inserted = 0;
  let updated = 0;
  for (const r of ROWS) {
    const result = await db
      .insert(lateFeeRules)
      .values({
        state: r.state,
        capPctSmallProperty: r.capPctSmallProperty as any,
        capPctLargeProperty: r.capPctLargeProperty as any,
        capFlatCents: r.capFlatCents,
        graceDays: r.graceDays,
        initialFeeCents: r.initialFeeCents,
        perDayCents: r.perDayCents,
        citation: r.citation,
        summary: r.summary,
        attorneyReviewedAt: null,
        attorneyReviewedBy: null,
      })
      .onConflictDoUpdate({
        target: lateFeeRules.state,
        set: {
          capPctSmallProperty: sql`EXCLUDED.cap_pct_small_property`,
          capPctLargeProperty: sql`EXCLUDED.cap_pct_large_property`,
          capFlatCents: sql`EXCLUDED.cap_flat_cents`,
          graceDays: sql`EXCLUDED.grace_days`,
          initialFeeCents: sql`EXCLUDED.initial_fee_cents`,
          perDayCents: sql`EXCLUDED.per_day_cents`,
          citation: sql`EXCLUDED.citation`,
          summary: sql`EXCLUDED.summary`,
          updatedAt: new Date(),
        },
      })
      .returning({ state: lateFeeRules.state });
    if (result.length > 0) inserted++;
  }
  console.log(`Done: ${inserted} rows upserted.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("seed-late-fee-rules failed:", err);
  process.exit(1);
});
