/**
 * The "data network" figures customers see about each other (founder ruling
 * 2026-09-29 #11, DEFECT-0159): county coverage, county LCS averages and a
 * contributor's percentile. Each is computed from organizations that have
 * OPTED IN only (`consentingOrgIds()`), and a county or rank is published
 * only when MIN_DISTINCT_OPERATORS of them stand behind it. These ran across
 * every org with no floor: a county with one operator showed that
 * operator's property count and average credit score.
 */
import { db } from "../db";
import { properties, deals, landCreditScores, organizations } from "@shared/schema";
import { eq, inArray, sql, count, desc, avg } from "drizzle-orm";
import { logger } from "../utils/logger";
import { consentingOrgIds } from "./sophiePrivacyGuard";
import { MIN_DISTINCT_OPERATORS } from "./dataCoop/privacyRollup";

interface CountyStats {
  county: string;
  state: string;
  orgCount: number;
  propertyCount: number;
  lastUpdated: string | null;
}

interface CountyIntelligenceOverview {
  counties: CountyStats[];
  totalCounties: number;
  totalProperties: number;
  totalContributingOrgs: number;
}

interface ContributionMetrics {
  orgId: number;
  propertiesContributed: number;
  countiesReached: number;
  dealsCompleted: number;
  /** Null unless MIN_DISTINCT_OPERATORS other opted-in orgs exist to rank against. */
  percentileRank: number | null;
  /** Whether this org has opted in — only then is it a contributor at all. */
  contributing: boolean;
}

interface LcsBenchmark {
  county: string;
  state: string;
  avgOverallScore: number;
  avgLiquidityScore: number;
  avgRiskScore: number;
  avgMarketabilityScore: number;
  propertyCount: number;
}

export async function getCountyIntelligenceOverview(
  orgId: number,
): Promise<CountyIntelligenceOverview> {
  try {
    const consenting = [...(await consentingOrgIds())];
    if (consenting.length < MIN_DISTINCT_OPERATORS) {
      return { counties: [], totalCounties: 0, totalProperties: 0, totalContributingOrgs: 0 };
    }
    const countyData = await db
      .select({
        county: properties.county,
        state: properties.state,
        orgCount: sql<number>`count(distinct ${properties.organizationId})`,
        propertyCount: count(properties.id),
        lastUpdated: sql<string>`max(${properties.purchaseDate})`,
      })
      .from(properties)
      .where(inArray(properties.organizationId, consenting))
      .groupBy(properties.county, properties.state)
      .having(sql`count(distinct ${properties.organizationId}) >= ${MIN_DISTINCT_OPERATORS}`)
      .orderBy(desc(count(properties.id)));

    const totalOrgs = await db
      .select({ ct: sql<number>`count(distinct ${properties.organizationId})` })
      .from(properties)
      .where(inArray(properties.organizationId, consenting));

    const counties: CountyStats[] = countyData.map((row) => ({
      county: row.county,
      state: row.state,
      orgCount: Number(row.orgCount),
      propertyCount: Number(row.propertyCount),
      lastUpdated: row.lastUpdated,
    }));

    const totalProperties = counties.reduce((s, c) => s + c.propertyCount, 0);

    logger.info("County intelligence overview generated", {
      orgId,
      totalCounties: counties.length,
      totalProperties,
    });

    return {
      counties,
      totalCounties: counties.length,
      totalProperties,
      totalContributingOrgs: Number(totalOrgs[0]?.ct ?? 0),
    };
  } catch (error) {
    logger.error("Failed to generate county intelligence overview", { orgId, error });
    throw error;
  }
}

export async function getDataContributionMetrics(
  orgId: number,
): Promise<ContributionMetrics> {
  try {
    const [propStats] = await db
      .select({
        propertyCount: count(properties.id),
        countyCount: sql<number>`count(distinct ${properties.county})`,
      })
      .from(properties)
      .where(eq(properties.organizationId, orgId));

    const [dealStats] = await db
      .select({ dealCount: count(deals.id) })
      .from(deals)
      .where(eq(deals.organizationId, orgId));

    // Percentile rank among OPTED-IN orgs: what % have fewer properties than
    // this org. Only for an org that has opted in itself, and only when at
    // least MIN_DISTINCT_OPERATORS others stand in the ranking — with fewer,
    // a rank reads individual operators' portfolio sizes.
    const orgPropertyCount = Number(propStats?.propertyCount ?? 0);
    const consenting = await consentingOrgIds();
    const contributing = consenting.has(orgId);
    let percentileRank: number | null = null;
    if (contributing && orgPropertyCount > 0 && consenting.size > MIN_DISTINCT_OPERATORS) {
      const allOrgCounts = await db
        .select({
          orgId: properties.organizationId,
          ct: count(properties.id),
        })
        .from(properties)
        .where(inArray(properties.organizationId, [...consenting]))
        .groupBy(properties.organizationId);
      // The ranked population is opted-in orgs that HOLD properties — an
      // opted-in org with none is not an operator in this ranking. Rank only
      // against at least MIN_DISTINCT_OPERATORS others, or the rank reads
      // their portfolio sizes.
      const others = allOrgCounts.filter((o) => o.orgId !== orgId && Number(o.ct) > 0);
      if (others.length >= MIN_DISTINCT_OPERATORS) {
        const below = others.filter((o) => Number(o.ct) < orgPropertyCount).length;
        percentileRank = Math.round((below / (others.length + 1)) * 100);
      }
    }

    logger.info("Data contribution metrics generated", { orgId, orgPropertyCount });

    return {
      orgId,
      propertiesContributed: orgPropertyCount,
      countiesReached: Number(propStats?.countyCount ?? 0),
      dealsCompleted: Number(dealStats?.dealCount ?? 0),
      percentileRank,
      contributing,
    };
  } catch (error) {
    logger.error("Failed to generate contribution metrics", { orgId, error });
    throw error;
  }
}

export async function getLcsBenchmarks(
  orgId: number,
): Promise<LcsBenchmark[]> {
  try {
    const consenting = [...(await consentingOrgIds())];
    if (consenting.length < MIN_DISTINCT_OPERATORS) return [];
    const benchmarks = await db
      .select({
        county: properties.county,
        state: properties.state,
        avgOverallScore: avg(landCreditScores.overallScore),
        avgLiquidityScore: avg(landCreditScores.liquidityScore),
        avgRiskScore: avg(landCreditScores.riskScore),
        avgMarketabilityScore: avg(landCreditScores.marketabilityScore),
        propertyCount: count(landCreditScores.id),
      })
      .from(landCreditScores)
      .innerJoin(properties, eq(landCreditScores.propertyId, properties.id))
      .where(inArray(properties.organizationId, consenting))
      .groupBy(properties.county, properties.state)
      .having(sql`count(distinct ${properties.organizationId}) >= ${MIN_DISTINCT_OPERATORS}`)
      .orderBy(desc(avg(landCreditScores.overallScore)));

    const results: LcsBenchmark[] = benchmarks.map((row) => ({
      county: row.county,
      state: row.state,
      avgOverallScore: Math.round(Number(row.avgOverallScore ?? 0)),
      avgLiquidityScore: Math.round(Number(row.avgLiquidityScore ?? 0)),
      avgRiskScore: Math.round(Number(row.avgRiskScore ?? 0)),
      avgMarketabilityScore: Math.round(Number(row.avgMarketabilityScore ?? 0)),
      propertyCount: Number(row.propertyCount),
    }));

    logger.info("LCS benchmarks generated", { orgId, countyCount: results.length });

    return results;
  } catch (error) {
    logger.error("Failed to generate LCS benchmarks", { orgId, error });
    throw error;
  }
}
