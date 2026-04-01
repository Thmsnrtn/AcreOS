import { db } from "../db";
import { properties, deals, landCreditScores, organizations } from "@shared/schema";
import { eq, sql, count, desc, avg } from "drizzle-orm";
import { logger } from "../utils/logger";

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
  percentileRank: number;
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
    const countyData = await db
      .select({
        county: properties.county,
        state: properties.state,
        orgCount: sql<number>`count(distinct ${properties.organizationId})`,
        propertyCount: count(properties.id),
        lastUpdated: sql<string>`max(${properties.purchaseDate})`,
      })
      .from(properties)
      .groupBy(properties.county, properties.state)
      .orderBy(desc(count(properties.id)));

    const totalOrgs = await db
      .select({ ct: sql<number>`count(distinct ${properties.organizationId})` })
      .from(properties);

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

    // Percentile rank: what % of orgs have fewer properties than this org
    const orgPropertyCount = Number(propStats?.propertyCount ?? 0);
    const allOrgCounts = await db
      .select({
        orgId: properties.organizationId,
        ct: count(properties.id),
      })
      .from(properties)
      .groupBy(properties.organizationId);

    const below = allOrgCounts.filter((o) => Number(o.ct) < orgPropertyCount).length;
    const total = allOrgCounts.length;
    const percentileRank = total > 0 ? Math.round((below / total) * 100) : 0;

    logger.info("Data contribution metrics generated", { orgId, orgPropertyCount });

    return {
      orgId,
      propertiesContributed: orgPropertyCount,
      countiesReached: Number(propStats?.countyCount ?? 0),
      dealsCompleted: Number(dealStats?.dealCount ?? 0),
      percentileRank,
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
      .groupBy(properties.county, properties.state)
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
