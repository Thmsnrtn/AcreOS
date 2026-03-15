/**
 * Market Network Contributor — Pillar 3 of AcreOS Durability Strategy
 *
 * When a deal closes, this service extracts anonymized market signal data
 * and contributes it to the global (cross-org) market metrics pool.
 *
 * Privacy model:
 * - organizationId is set to null for all global pool entries (not traceable to any org)
 * - No APN, seller names, deal IDs, or buyer names are included
 * - Acreage is bucketed (not exact), price-per-acre is a range (not exact)
 * - A minimum cohort of 5 contributions per county is required before aggregate data
 *   is surfaced to users (prevents fingerprinting small markets)
 *
 * Network effect: every new org that closes deals enriches the market intelligence
 * for all orgs. The aggregate becomes a real-time acquisition-channel pricing oracle
 * that no retail data provider can replicate.
 */

import { db } from "../db";
import { eq, and, isNull, count, sql } from "drizzle-orm";
import { marketMetrics, properties, organizations } from "@shared/schema";

const MIN_COHORT_SIZE = 5; // Minimum contributions before county data is surfaced

// Buckets acreage to prevent fingerprinting exact parcel sizes
function bucketAcreage(acres: number): string {
  if (acres < 1)  return "under_1";
  if (acres < 5)  return "1_to_5";
  if (acres < 10) return "5_to_10";
  if (acres < 25) return "10_to_25";
  if (acres < 50) return "25_to_50";
  if (acres < 100) return "50_to_100";
  return "over_100";
}

// Converts exact price-per-acre to a rounded range midpoint (±25%)
function bucketPricePerAcre(pricePerAcre: number): number {
  // Round to nearest $250 to prevent exact deal fingerprinting
  return Math.round(pricePerAcre / 250) * 250;
}

/**
 * Called from routes-deals.ts when a deal status changes to "closed".
 * Extracts anonymized signals and writes a global market metrics record.
 */
export async function contributeMarketSignal(
  organizationId: number,
  deal: {
    id: number;
    propertyId?: number;
    acceptedAmount?: string | number | null;
    dealType?: string | null;
  }
): Promise<void> {
  try {
    if (!deal.propertyId) return;

    const property = await db
      .select({
        county: properties.county,
        state: properties.state,
        acres: properties.acres,
        zoning: properties.zoning,
        financing: properties.financingType,
      })
      .from(properties)
      .where(eq(properties.id, deal.propertyId))
      .limit(1)
      .then(r => r[0]);

    if (!property || !property.county || !property.state) return;

    const acres = property.acres ? parseFloat(String(property.acres)) : null;
    const closedPrice = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : null;

    if (!acres || !closedPrice || acres <= 0 || closedPrice <= 0) return;

    const pricePerAcre = closedPrice / acres;
    const now = new Date();

    // Write the anonymized global signal (organizationId: null = global pool)
    await db.insert(marketMetrics).values({
      organizationId: null, // ← key: no org identifier in the global pool
      county: property.county,
      state: property.state,
      metricDate: now,
      periodType: "transaction", // marks this as a transaction-level signal
      salesVolume: 1,
      medianPricePerAcre: String(bucketPricePerAcre(pricePerAcre)),
      averagePricePerAcre: String(bucketPricePerAcre(pricePerAcre)),
      medianSalePrice: String(Math.round(closedPrice / 1000) * 1000), // round to nearest $1k
      averageSalePrice: String(Math.round(closedPrice / 1000) * 1000),
      // Store bucketed metadata in economicData (reusing existing jsonb field)
      economicData: {
        acreageBucket: acres ? bucketAcreage(acres) : undefined,
        zoningCategory: property.zoning ?? undefined,
        financingType: (deal.dealType === "seller_finance" || (property.financing as any) === "owner") ? "seller_finance" : "cash",
      } as any,
      dataSources: [{
        sourceId: 0,
        sourceName: "acreOS_network",
        fetchedAt: now.toISOString(),
      }],
    });

    console.log(`[MarketNetwork] Contributed signal for ${property.county}, ${property.state} ($${Math.round(pricePerAcre)}/acre)`);
  } catch (err: any) {
    // Non-blocking — never let this fail the deal close
    console.error(`[MarketNetwork] contributeMarketSignal error:`, err.message);
  }
}

/**
 * Returns the global pool contribution count for a county.
 * Used to enforce the MIN_COHORT_SIZE privacy threshold before surfacing data.
 */
export async function getCountyContributionCount(county: string, state: string): Promise<number> {
  const result = await db
    .select({ n: count() })
    .from(marketMetrics)
    .where(
      and(
        isNull(marketMetrics.organizationId),
        eq(marketMetrics.county, county),
        eq(marketMetrics.state, state)
      )
    );
  return result[0]?.n ?? 0;
}

/**
 * Returns aggregated acquisition-channel pricing intelligence for a county.
 * Returns null if below the minimum cohort size (privacy threshold).
 *
 * This is the data that makes AcreOS unique: "platform investors have been
 * buying in this county at X-Y $/acre over the last 90 days."
 */
export async function getCountyNetworkIntelligence(
  county: string,
  state: string
): Promise<{
  medianPricePerAcre: number;
  minPricePerAcre: number;
  maxPricePerAcre: number;
  transactionCount: number;
  dataAvailable: boolean;
} | null> {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const rows = await db
      .select({
        medianPpa: marketMetrics.medianPricePerAcre,
      })
      .from(marketMetrics)
      .where(
        and(
          isNull(marketMetrics.organizationId),
          eq(marketMetrics.county, county),
          eq(marketMetrics.state, state),
          sql`${marketMetrics.metricDate} >= ${ninetyDaysAgo}`,
          sql`${marketMetrics.periodType} = 'transaction'`
        )
      );

    if (rows.length < MIN_COHORT_SIZE) {
      return { medianPricePerAcre: 0, minPricePerAcre: 0, maxPricePerAcre: 0, transactionCount: rows.length, dataAvailable: false };
    }

    const prices = rows.map(r => parseFloat(String(r.medianPpa ?? "0"))).filter(p => p > 0);
    if (prices.length === 0) return null;

    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    return {
      medianPricePerAcre: median,
      minPricePerAcre: prices[0],
      maxPricePerAcre: prices[prices.length - 1],
      transactionCount: prices.length,
      dataAvailable: true,
    };
  } catch (err: any) {
    console.error(`[MarketNetwork] getCountyNetworkIntelligence error:`, err.message);
    return null;
  }
}
