/**
 * Market Network Contributor — Cross-org anonymized deal data aggregation.
 *
 * When a deal closes, this service extracts anonymized pricing signals and
 * contributes them to the global market intelligence pool.
 *
 * Privacy model:
 * - organizationId is null for all global pool rows (no org traceability)
 * - APN, lead names, org ID are stripped from every contribution
 * - Acreage is bucketed; price-per-acre is rounded to nearest $500
 * - Minimum cohort of 5 contributions per county before aggregate data is served
 * - OPT-IN, and 5 DISTINCT consenting operators behind every served figure
 *   (founder ruling 2026-09-29 #11, DEFECT-0159): an org contributes only
 *   while it has consented, and a contribution counts only while its org
 *   still consents — an opt-out removes it from the next figure served.
 *
 * Network effect: every closed deal from a consenting org enriches market
 * comps for all orgs.
 */

import { db } from "../db";
import { SYSTEM_ORG_ID } from "@shared/tenancy/systemOrg";
import { eq, and, isNull, count, sql, type SQL } from "drizzle-orm";
import { createHash } from "crypto";
import { marketMetrics, agentMemory, properties, deals, organizations, notes } from "@shared/schema";
import { SAMPLE_APN_PREFIX } from "./onboarding/sampleSeeder";
import { consentingOrgIds, sophiePrivacyGuard } from "./sophiePrivacyGuard";
import { MIN_DISTINCT_OPERATORS } from "./dataCoop/privacyRollup";
import { logger } from "../utils/logger";

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_COHORT_SIZE = 5; // Minimum contributions before county data is served
/**
 * And the contributions must come from at least this many DISTINCT orgs
 * (DEFECT-0155). Counting deals alone let one operator's five deals be the
 * whole cohort, so the "network" median was that operator's pricing. Raised
 * from 3 to the platform-wide floor of 5 by ruling 2026-09-29 #11.
 */
const MIN_DISTINCT_ORGS = MIN_DISTINCT_OPERATORS;

/**
 * Raw network contributions (one row per closed deal, organizationId NULL,
 * periodType "transaction") are INPUT to getNetworkCompsForCounty's
 * aggregate, never a market metric in their own right. Every other reader of
 * market_metrics took "the latest row for the county" — which, after a
 * contribution, was one other operator's just-closed deal's $/acre, and
 * analyzeMarket re-published it as a "monthly" metric (DEFECT-0155). Every
 * market_metrics reader outside this module applies this predicate.
 */
export const publishedMarketMetric = (): SQL =>
  sql`NOT (${marketMetrics.organizationId} IS NULL AND ${marketMetrics.periodType} = 'transaction')`;

/** A non-reversible-without-the-org-id tag, stored only to COUNT distinct contributors. */
function contributorTag(orgId: number): string {
  return createHash("sha256").update(`acreos-market-network:${orgId}`).digest("hex").slice(0, 16);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Bucket exact acreage into an anonymized range label. */
function bucketAcreage(acres: number): string {
  if (acres < 1)  return "0-1";
  if (acres < 5)  return "1-5";
  if (acres < 20) return "5-20";
  if (acres < 50) return "20-50";
  return "50+";
}

/** Round price-per-acre to nearest $500 to prevent exact deal fingerprinting. */
function roundPricePerAcre(ppa: number): number {
  return Math.round(ppa / 500) * 500;
}

/** Return the calendar quarter string for a date: e.g. "2025-Q2" */
function quarterOf(date: Date): string {
  const q = Math.ceil((date.getMonth() + 1) / 3);
  return `${date.getFullYear()}-Q${q}`;
}

/** Read staging list from agentMemory for a county. Returns parsed array. */
async function getStagingEntries(
  county: string,
  state: string
): Promise<Array<Record<string, any>>> {
  const key = `staging_${county}_${state}`;
  const rows = await db
    .select({ value: agentMemory.value })
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.agentType, "market_network"),
        eq(agentMemory.key, key)
      )
    )
    .limit(1);

  if (!rows[0]) return [];
  const val = rows[0].value as any;
  return Array.isArray(val?.entries) ? val.entries : [];
}

/** Write or replace staging list in agentMemory. */
async function setStagingEntries(
  county: string,
  state: string,
  entries: Array<Record<string, any>>
): Promise<void> {
  const key = `staging_${county}_${state}`;

  // Delete existing staging row(s) for this county+state
  await db
    .delete(agentMemory)
    .where(
      and(
        eq(agentMemory.agentType, "market_network"),
        eq(agentMemory.key, key)
      )
    );

  await db.insert(agentMemory).values({
    organizationId: SYSTEM_ORG_ID,
    agentType: "market_network",
    memoryType: "fact",
    key,
    value: { entries },
    confidence: "1.0",
  });
}

// ── Core Exports ───────────────────────────────────────────────────────────────

/**
 * Called when a deal is marked as closed.
 * Anonymizes deal data and contributes it to the global market pool.
 */
/**
 * Is this closed deal evidence of a MARKET SALE price? (quality directive
 * 2026-09-29.) Every close used to feed the valuation training corpus (as
 * "high" quality) and the cross-customer market network, whatever it was:
 *
 *  - an ACQUISITION's accepted amount is what an investor paid — often a
 *    fraction of value by design — not what the parcel sells for;
 *  - a seller-financed disposition's contract total is not a cash price;
 *  - a "Try with sample data" fixture is not a sale at all;
 *  - re-closing a deal contributed it again.
 *
 * Only a real, cash disposition qualifies. `dealKey` is a stable, anonymous
 * identity for the deal (never its ids) so a repeat close dedupes and a
 * reopened deal can be retracted. The price is operator-entered, not a
 * recorded deed, and callers label it so.
 */
/** The anonymous, stable identity of a closed deal as a sale (never its ids). */
export function closedSaleDealKey(orgId: number, dealId: number): string {
  return createHash("sha256").update(`closed-sale:${orgId}:${dealId}`).digest("hex").slice(0, 32);
}

export async function closedSaleEvidence(
  dealId: number,
  orgId: number,
): Promise<
  | {
      ok: true;
      dealKey: string;
      price: number;
      acres: number;
      county: string;
      state: string;
      zoning: string | null;
      closingDate: Date | null;
      propertyId: number;
    }
  | { ok: false; reason: string }
> {
  const [row] = await db
    .select({
      type: deals.type,
      status: deals.status,
      dealValue: deals.acceptedAmount,
      closingDate: deals.closingDate,
      propertyId: deals.propertyId,
      apn: properties.apn,
      county: properties.county,
      state: properties.state,
      sizeAcres: properties.sizeAcres,
      zoning: properties.zoning,
    })
    .from(deals)
    .innerJoin(properties, and(eq(properties.id, deals.propertyId), eq(properties.organizationId, orgId)))
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)))
    .limit(1);
  if (!row) return { ok: false, reason: "Deal not found" };
  if (row.status !== "closed") return { ok: false, reason: "Deal is not closed" };
  if (row.type !== "disposition") {
    return { ok: false, reason: "Not a sale: an acquisition price is what the investor paid, not a market sale price" };
  }
  if ((row.apn ?? "").startsWith(SAMPLE_APN_PREFIX)) return { ok: false, reason: "Sample data is not a sale" };
  const [financed] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), eq(notes.propertyId, row.propertyId)))
    .limit(1);
  if (financed) return { ok: false, reason: "Seller-financed: the contract total is not a cash sale price" };
  if (!row.county || !row.state) return { ok: false, reason: "Deal property missing county/state" };
  const acres = row.sizeAcres ? parseFloat(String(row.sizeAcres)) : NaN;
  const price = row.dealValue ? parseFloat(String(row.dealValue)) : NaN;
  if (!(acres > 0) || !(price > 0)) return { ok: false, reason: "Insufficient pricing data" };
  return {
    ok: true,
    dealKey: closedSaleDealKey(orgId, dealId),
    price,
    acres,
    county: row.county,
    state: row.state,
    zoning: row.zoning ?? null,
    closingDate: row.closingDate ?? null,
    propertyId: row.propertyId,
  };
}

export async function contributeClosedDealToNetwork(
  dealId: number,
  orgId: number
): Promise<{ contributed: boolean; reason: string }> {
  try {
    // Opt-in (ruling #11): nothing leaves an org that has not consented.
    if (!(await sophiePrivacyGuard.hasConsent(orgId))) {
      return { contributed: false, reason: "Organization has not opted in to shared market data" };
    }
    // 1. Only a real cash sale is market evidence (closedSaleEvidence).
    const evidence = await closedSaleEvidence(dealId, orgId);
    if (!evidence.ok) {
      return { contributed: false, reason: evidence.reason };
    }

    const { county, state, zoning, closingDate, acres, price, dealKey } = evidence;

    // A deal already contributed (closed, reopened, closed again) is not a
    // second sale.
    const [already] = await db
      .select({ n: count() })
      .from(marketMetrics)
      .where(and(isNull(marketMetrics.organizationId), sql`${marketMetrics.economicData}->>'dealKey' = ${dealKey}`));
    const stagedAlready = (await getStagingEntries(county, state)).some(
      (e) => (e as { dealKey?: unknown }).dealKey === dealKey,
    );
    if (Number(already?.n ?? 0) > 0 || stagedAlready) {
      return { contributed: false, reason: "Deal already contributed" };
    }

    const pricePerAcre = roundPricePerAcre(price / acres);

    // 2. Build anonymized entry — no APN, no lead names, no org ID
    const entry = {
      contributor: contributorTag(orgId),
      acreageBucket: bucketAcreage(acres),
      pricePerAcre,          // Rounded to nearest $500
      zoningCategory: zoning ?? "unknown",
      saleQuarter: quarterOf(closingDate ?? new Date()),
      contributedAt: new Date().toISOString(),
      dealKey,
      // Operator-entered at close — not a recorded deed price.
      evidence: "operator_entered_close",
    };

    // 3. Check existing global pool contribution count for this county
    const countResult = await db
      .select({ n: count() })
      .from(marketMetrics)
      .where(
        and(
          isNull(marketMetrics.organizationId),
          eq(marketMetrics.county, county),
          eq(marketMetrics.state, state),
          sql`${marketMetrics.dataSources}::text LIKE '%network_aggregate%'`
        )
      );

    const existingGlobalCount = Number(countResult[0]?.n ?? 0);

    // Also check staging entries
    const stagingEntries = await getStagingEntries(county, state);
    const totalAfterThis = existingGlobalCount + stagingEntries.length + 1;

    if (totalAfterThis >= MIN_COHORT_SIZE) {
      // 4. Write to global marketMetrics pool (organizationId: null)
      await db.insert(marketMetrics).values({
        organizationId: null, // ← global pool marker
        county,
        state,
        metricDate: new Date(),
        periodType: "transaction",
        averagePricePerAcre: String(pricePerAcre),
        medianPricePerAcre: String(pricePerAcre),
        salesVolume: 1,
        dataSources: [
          {
            sourceId: 0,
            sourceName: "network_aggregate",
            fetchedAt: new Date().toISOString(),
          },
        ],
        economicData: {
          contributor: entry.contributor,
          acreageBucket: entry.acreageBucket,
          zoningCategory: entry.zoningCategory,
          saleQuarter: entry.saleQuarter,
          dealKey: entry.dealKey,
          evidence: entry.evidence,
        } as any,
      });

      // If this was the threshold-breaking contribution, also flush staged entries
      if (stagingEntries.length > 0) {
        for (const staged of stagingEntries) {
          await db.insert(marketMetrics).values({
            organizationId: null,
            county,
            state,
            metricDate: new Date(staged.contributedAt ?? Date.now()),
            periodType: "transaction",
            averagePricePerAcre: String(staged.pricePerAcre),
            medianPricePerAcre: String(staged.pricePerAcre),
            salesVolume: 1,
            dataSources: [
              {
                sourceId: 0,
                sourceName: "network_aggregate",
                fetchedAt: new Date().toISOString(),
              },
            ],
            economicData: {
              contributor: staged.contributor ?? null,
              acreageBucket: staged.acreageBucket,
              zoningCategory: staged.zoningCategory,
              saleQuarter: staged.saleQuarter,
              dealKey: staged.dealKey ?? null,
              evidence: staged.evidence ?? null,
            } as any,
          });
        }
        // Clear staging for this county
        await setStagingEntries(county, state, []);
      }

      logger.info(`[marketNetworkContributor] Contributed to global pool for ${county}, ${state} — ` +
          `total now ${totalAfterThis} (flushed ${stagingEntries.length} staged)`);
      return {
        contributed: true,
        reason: `Contributed to global pool for ${county}, ${state}`,
      };
    } else {
      // 5. Below threshold — stage the entry
      stagingEntries.push(entry);
      await setStagingEntries(county, state, stagingEntries);

      logger.info(`[marketNetworkContributor] Staged contribution for ${county}, ${state} — ` +
          `${stagingEntries.length}/${MIN_COHORT_SIZE} entries (privacy threshold not yet met)`);
      return {
        contributed: false,
        reason: `Staged for ${county}, ${state} (${stagingEntries.length}/${MIN_COHORT_SIZE} privacy threshold)`,
      };
    }
  } catch (err: any) {
    logger.error("[marketNetworkContributor] contributeClosedDealToNetwork error", err);
    return { contributed: false, reason: `Error: ${err.message}` };
  }
}

/**
 * Returns aggregated network comps for a county.
 * Returns null if fewer than MIN_COHORT_SIZE data points exist (privacy threshold).
 */
export async function getNetworkCompsForCounty(
  county: string,
  state: string
): Promise<{
  avgPricePerAcre: number;
  medianPricePerAcre: number;
  dataPoints: number;
  note: string;
} | null> {
  try {
    const rows = await db
      .select({
        ppa: marketMetrics.averagePricePerAcre,
        contributor: sql<string | null>`${marketMetrics.economicData}->>'contributor'`,
      })
      .from(marketMetrics)
      .where(
        and(
          isNull(marketMetrics.organizationId),
          eq(marketMetrics.county, county),
          eq(marketMetrics.state, state),
          sql`${marketMetrics.dataSources}::text LIKE '%network_aggregate%'`
        )
      );

    // Consent is read NOW: only contributions whose org currently consents
    // count, so an opt-out leaves the next figure served (ruling #11). Rows
    // written before contributor tags existed carry no tag and never count —
    // the floor fails closed until real tags accumulate.
    const consentingTags = new Set([...(await consentingOrgIds())].map(contributorTag));
    const served = rows.filter((r) => !!r.contributor && consentingTags.has(r.contributor));
    const distinctOrgs = new Set(served.map((r) => r.contributor)).size;
    if (served.length < MIN_COHORT_SIZE || distinctOrgs < MIN_DISTINCT_ORGS) {
      return null;
    }

    const prices = served
      .map((r) => parseFloat(String(r.ppa ?? "0")))
      .filter((p) => p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) return null;

    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    const median =
      prices.length % 2 === 0
        ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
        : prices[Math.floor(prices.length / 2)];

    // No min / max: each is one operator's single deal.
    return {
      avgPricePerAcre: Math.round(avg),
      medianPricePerAcre: Math.round(median),
      dataPoints: prices.length,
      note: `Based on ${prices.length} AcreOS network transactions`,
    };
  } catch (err: any) {
    logger.error("[marketNetworkContributor] getNetworkCompsForCounty error", err);
    return null;
  }
}

/**
 * Wraps getNetworkCompsForCounty with the interface expected by marketIntelligence.ts.
 * Maps dataPoints → transactionCount and adds dataAvailable flag.
 */
export async function getCountyNetworkIntelligence(
  county: string,
  state: string
): Promise<{
  medianPricePerAcre: number;
  transactionCount: number;
  dataAvailable: boolean;
  summary: string;
} | null> {
  const comps = await getNetworkCompsForCounty(county, state);
  if (!comps) return null;
  return {
    medianPricePerAcre: comps.medianPricePerAcre,
    transactionCount: comps.dataPoints,
    dataAvailable: comps.dataPoints >= MIN_COHORT_SIZE,
    summary: comps.note,
  };
}

