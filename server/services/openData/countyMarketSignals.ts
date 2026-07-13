/**
 * County market signals — read helpers over the Open-Data Program 2.1/2.2
 * reference tables (county_migration_summary, county_building_permits).
 *
 * Both tables are platform-global, ingested by the irs_soi_migration_v1 /
 * census_bps_permits_v1 ETL jobs (server/services/etlHandlers.ts). These
 * helpers return null when the data isn't there — callers keep their own
 * fallbacks; nothing here estimates or fabricates.
 */

import { and, desc, eq } from "drizzle-orm";

import { countyMigrationSummary, countyBuildingPermits } from "@shared/schema";
import { db } from "../../db";

export interface CountyMigrationSignal {
  /** Net tax returns (inflow − outflow) for the latest ingested filing year. */
  netReturns: number;
  /** Net AGI in thousands of dollars (inflow − outflow). */
  netAgiThousands: number;
  /** IRS filing-year pair label, e.g. '2223' = tax years 2022→2023. */
  filingYear: string;
}

/**
 * Latest IRS SOI migration net-flow for a county, or null when the county
 * has no ingested row (or the latest row is IRS-suppressed on either side).
 */
export async function getMigrationSignal(
  stateFips: string,
  countyFips: string,
): Promise<CountyMigrationSignal | null> {
  const [row] = await db
    .select({
      netReturns: countyMigrationSummary.netReturns,
      netAgiThousands: countyMigrationSummary.netAgiThousands,
      filingYear: countyMigrationSummary.filingYear,
    })
    .from(countyMigrationSummary)
    .where(
      and(
        eq(countyMigrationSummary.stateFips, stateFips),
        eq(countyMigrationSummary.countyFips, countyFips),
      ),
    )
    .orderBy(desc(countyMigrationSummary.filingYear))
    .limit(1);

  if (!row || row.netReturns === null || row.netAgiThousands === null) return null;
  return {
    netReturns: row.netReturns,
    netAgiThousands: row.netAgiThousands,
    filingYear: row.filingYear,
  };
}

export interface CountyPermitTrend {
  latestYearUnits: number;
  priorYearUnits: number;
  /** Year-over-year % change in total permitted units. */
  trendPercent: number;
}

/**
 * Year-over-year building-permit trend for a county from Census BPS annual
 * data. Null when fewer than two CONSECUTIVE years are ingested, or when the
 * prior year is zero (a percent against zero would be a fabricated number).
 */
export async function getPermitTrend(
  stateFips: string,
  countyFips: string,
): Promise<CountyPermitTrend | null> {
  const rows = await db
    .select({
      year: countyBuildingPermits.year,
      totalUnits: countyBuildingPermits.totalUnits,
    })
    .from(countyBuildingPermits)
    .where(
      and(
        eq(countyBuildingPermits.stateFips, stateFips),
        eq(countyBuildingPermits.countyFips, countyFips),
      ),
    )
    .orderBy(desc(countyBuildingPermits.year))
    .limit(2);

  if (rows.length < 2) return null;
  const [latest, prior] = rows;
  if (latest.year !== prior.year + 1) return null;
  if (prior.totalUnits === 0) return null;

  return {
    latestYearUnits: latest.totalUnits,
    priorYearUnits: prior.totalUnits,
    trendPercent: ((latest.totalUnits - prior.totalUnits) / prior.totalUnits) * 100,
  };
}
