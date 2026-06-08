// ============================================================================
// server/services/audit/detectors/taxReserveDetector.ts
// ----------------------------------------------------------------------------
// LENA (finance domain) — EXEMPLAR detector.
//
// Warns when the tax_reserve bucket is under-funded relative to trailing-12mo
// revenue. The allocation policy targets a 25% tax set-aside (settingsSeeder:
// tax_reserve = 0.25), so the reserve floor we audit against is 25% of the
// last twelve months of recognized revenue. If the bucket balance has drifted
// below that floor — e.g. a founder draw or refund drained it — the company is
// carrying an under-reserved tax liability and we surface it.
//
//   warn:     0 < balance < floor              (under-reserved but positive)
//   critical: balance <= 0  while revenue > 0   (no reserve at all)
//
// Read-only: reuses getBucketBalance() + a trailing-12mo revenue sum off the
// financial_ledger system-of-record. Emits ONE finding (dedupe_key fixed) so
// re-runs update the same row rather than duplicating.
// ============================================================================

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "../../../db";
import { financialLedger } from "@shared/schema";
import { getBucketBalance } from "../../financial-ledger";
import type { DomainDetector, FindingInput } from "../domainAudit";

const TAX_RESERVE_TARGET_RATIO = 0.25; // mirrors settingsSeeder tax_reserve default

/** Sum of category='revenue' rows posted in the trailing 12 months (cents). */
async function trailing12moRevenueCents(): Promise<number> {
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${financialLedger.amountCents}), 0)`.mapWith(
        Number,
      ),
    })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.category, "revenue"),
        gte(financialLedger.postedAt, since),
      ),
    );
  return row?.total ?? 0;
}

export const taxReserveDetector: DomainDetector = {
  id: "tax_reserve",
  domain: "finance",
  async run(): Promise<FindingInput[]> {
    const [revenueCents, balanceCents] = await Promise.all([
      trailing12moRevenueCents(),
      getBucketBalance("tax_reserve"),
    ]);

    // Zero-revenue company has no tax liability to reserve against — green.
    if (revenueCents <= 0) return [];

    const floorCents = Math.round(revenueCents * TAX_RESERVE_TARGET_RATIO);
    if (balanceCents >= floorCents) return [];

    const dollars = (c: number) => (c / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });

    const isCritical = balanceCents <= 0;
    const shortfallCents = floorCents - balanceCents;

    return [
      {
        domain: "finance",
        detector: "tax_reserve",
        severity: isCritical ? "critical" : "warn",
        title: isCritical
          ? "Tax reserve is empty while revenue exists"
          : "Tax reserve under-funded vs trailing-12mo revenue",
        detail:
          `tax_reserve balance is ${dollars(balanceCents)} against a ` +
          `${Math.round(TAX_RESERVE_TARGET_RATIO * 100)}% floor of ` +
          `${dollars(floorCents)} (trailing-12mo revenue ${dollars(revenueCents)}). ` +
          `Shortfall: ${dollars(shortfallCents)}.`,
        citedReason:
          "Allocation policy sets aside 25% of revenue for tax (settingsSeeder " +
          "tax_reserve=0.25); dipping below that floor leaves the company " +
          "under-reserved for its tax liability.",
        dedupeKey: "tax_reserve:underfunded",
        subjectRef: "tax_reserve",
        metadata: {
          balanceCents,
          floorCents,
          shortfallCents,
          trailing12moRevenueCents: revenueCents,
          targetRatio: TAX_RESERVE_TARGET_RATIO,
        },
      },
    ];
  },
};
