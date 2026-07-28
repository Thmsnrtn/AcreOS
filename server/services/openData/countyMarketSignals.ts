/**
 * County market signals — read helpers over the Open-Data Program 2.1/2.2/2.3
 * reference tables (county_migration_summary, county_building_permits,
 * county_employment_wages).
 *
 * All three tables are platform-global, ingested by the irs_soi_migration_v1 /
 * census_bps_permits_v1 / bls_qcew_employment_v1 ETL jobs
 * (server/services/etlHandlers.ts). These helpers return null when the data
 * isn't there — callers keep their own fallbacks; nothing here estimates or
 * fabricates.
 */

import { and, desc, eq } from "drizzle-orm";

import {
  countyMigrationSummary,
  countyBuildingPermits,
  countyEmploymentWages,
} from "@shared/schema";
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
  /** Newest ingested Census BPS survey year. */
  latestYear: number;
  /** The consecutive prior survey year (latestYear - 1). */
  priorYear: number;
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
    latestYear: latest.year,
    priorYear: prior.year,
    latestYearUnits: latest.totalUnits,
    priorYearUnits: prior.totalUnits,
    trendPercent: ((latest.totalUnits - prior.totalUnits) / prior.totalUnits) * 100,
  };
}

export interface CountyEmploymentSignal {
  /** Newest ingested QCEW data year. */
  latestYear: number;
  /** Annual average of monthly employment for the latest year. */
  avgEmployment: number;
  /** Annual average weekly wage in whole dollars for the latest year. */
  avgWeeklyWage: number;
  /** Year-over-year % change in average employment. */
  employmentTrendPercent: number;
  /** Year-over-year % change in average weekly wage. */
  wageTrendPercent: number;
}

/**
 * Year-over-year employment + wage trajectory for a county from BLS QCEW
 * annual averages — the economic-durability leg of county scoring. Null when
 * fewer than two CONSECUTIVE years are ingested, when either year is
 * BLS-suppressed (stored NULL), or when a prior-year value is zero (a
 * percent against zero would be a fabricated number).
 */
export async function getEmploymentSignal(
  stateFips: string,
  countyFips: string,
): Promise<CountyEmploymentSignal | null> {
  const rows = await db
    .select({
      year: countyEmploymentWages.year,
      avgEmployment: countyEmploymentWages.avgEmployment,
      avgWeeklyWage: countyEmploymentWages.avgWeeklyWage,
    })
    .from(countyEmploymentWages)
    .where(
      and(
        eq(countyEmploymentWages.stateFips, stateFips),
        eq(countyEmploymentWages.countyFips, countyFips),
      ),
    )
    .orderBy(desc(countyEmploymentWages.year))
    .limit(2);

  if (rows.length < 2) return null;
  const [latest, prior] = rows;
  if (latest.year !== prior.year + 1) return null;
  if (latest.avgEmployment === null || latest.avgWeeklyWage === null) return null;
  if (prior.avgEmployment === null || prior.avgWeeklyWage === null) return null;
  if (prior.avgEmployment === 0 || prior.avgWeeklyWage === 0) return null;

  return {
    latestYear: latest.year,
    avgEmployment: latest.avgEmployment,
    avgWeeklyWage: latest.avgWeeklyWage,
    employmentTrendPercent:
      ((latest.avgEmployment - prior.avgEmployment) / prior.avgEmployment) * 100,
    wageTrendPercent:
      ((latest.avgWeeklyWage - prior.avgWeeklyWage) / prior.avgWeeklyWage) * 100,
  };
}

// ─── Fused county momentum ───────────────────────────────────────────────────

/** -1 = negative, 0 = flat (exactly zero change), +1 = positive. */
export type MomentumDirection = -1 | 0 | 1;

export type MomentumSignalName = "migration" | "permits" | "employment";

export interface MomentumEvidenceItem {
  signal: MomentumSignalName;
  /** Where the numbers come from — upstream program + local table. */
  source: string;
  /** Which data years the numbers cover. */
  years: string;
  /**
   * This signal's direction vote: sign of the signal's headline delta
   * (netReturns for migration, permit trendPercent for permits,
   * employmentTrendPercent for employment). No magnitude weighting —
   * a weight would invent precision the sources don't support.
   */
  direction: MomentumDirection;
  /** The raw numbers the direction was derived from, verbatim. */
  values: Record<string, number | string>;
  /** Human-readable one-liner; every number restates a `values` entry. */
  detail: string;
}

export interface MomentumMissingSignal {
  signal: MomentumSignalName;
  source: string;
  reason: string;
}

export interface CountyMomentum {
  stateFips: string;
  countyFips: string;
  /** Always 3 — the signals this fusion checks. */
  signalsConsidered: 3;
  /** How many of the 3 signals had usable ingested data. */
  signalsPresent: number;
  /** One entry per PRESENT signal — source label, years, raw numbers. */
  evidence: MomentumEvidenceItem[];
  /** One entry per ABSENT signal, with why it is absent. */
  missingSignals: MomentumMissingSignal[];
  /**
   * Composite momentum. Present ONLY when ≥2 of 3 signals exist — a
   * "momentum" number derived from one signal would overstate. Null (with
   * `compositeUnavailableReason`) otherwise; the partial evidence still
   * flows through above.
   */
  composite: {
    /** Sum of the per-signal direction votes (each -1/0/+1). */
    score: number;
    /** score is bounded by ±outOf (= signalsPresent). */
    outOf: number;
    direction: "rising" | "cooling" | "flat" | "mixed";
    /** Exact combination rule, stated with the response. */
    basis: string;
  } | null;
  compositeUnavailableReason: string | null;
}

const MIGRATION_SOURCE =
  "IRS SOI county-to-county migration (county_migration_summary)";
const PERMITS_SOURCE =
  "Census Building Permits Survey annual county data (county_building_permits)";
const EMPLOYMENT_SOURCE =
  "BLS QCEW annual averages (county_employment_wages)";

const COMPOSITE_BASIS =
  "Unweighted sum of per-signal direction votes (each present signal votes -1/0/+1 by the sign of its headline year-over-year delta). No magnitude weights — the three sources cover different years and units, so any weighting would invent precision.";

function sign(n: number): MomentumDirection {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/**
 * Test seam (same pattern as etlHandlers `_runtime`): getCountyMomentum reads
 * the three signals through this object so tests can inject readers without a
 * database. Production code never reassigns it.
 */
export const _momentumSignalReaders = {
  getMigrationSignal,
  getPermitTrend,
  getEmploymentSignal,
};

/**
 * Fuse the three ingested county market signals (IRS SOI migration, Census BPS
 * permits, BLS QCEW employment) into a single county-momentum readout.
 *
 * Honesty contract:
 * - Every number in the output is traceable to exactly one source signal and
 *   is labeled with that signal's source + data years.
 * - Signals that are missing are LISTED as missing with a reason — never
 *   silently treated as neutral.
 * - A composite is emitted only when ≥2 of 3 signals are present; with fewer,
 *   the partial evidence passes through with `composite: null`.
 * - The composite is an unweighted direction-vote sum (see COMPOSITE_BASIS) —
 *   simple, documented, and free of invented weights.
 */
export async function getCountyMomentum(
  stateFips: string,
  countyFips: string,
): Promise<CountyMomentum> {
  const [migration, permits, employment] = await Promise.all([
    _momentumSignalReaders.getMigrationSignal(stateFips, countyFips),
    _momentumSignalReaders.getPermitTrend(stateFips, countyFips),
    _momentumSignalReaders.getEmploymentSignal(stateFips, countyFips),
  ]);

  const evidence: MomentumEvidenceItem[] = [];
  const missingSignals: MomentumMissingSignal[] = [];

  if (migration) {
    evidence.push({
      signal: "migration",
      source: MIGRATION_SOURCE,
      years: `IRS filing-year pair ${migration.filingYear}`,
      direction: sign(migration.netReturns),
      values: {
        netReturns: migration.netReturns,
        netAgiThousands: migration.netAgiThousands,
        filingYear: migration.filingYear,
      },
      detail: `Net ${migration.netReturns >= 0 ? "inflow" : "outflow"} of ${Math.abs(migration.netReturns)} tax returns (net AGI ${migration.netAgiThousands >= 0 ? "+" : "-"}$${Math.abs(migration.netAgiThousands)}k), filing years ${migration.filingYear}`,
    });
  } else {
    missingSignals.push({
      signal: "migration",
      source: MIGRATION_SOURCE,
      reason:
        "No ingested (or non-suppressed) IRS SOI net-migration row for this county",
    });
  }

  if (permits) {
    evidence.push({
      signal: "permits",
      source: PERMITS_SOURCE,
      years: `${permits.priorYear}→${permits.latestYear}`,
      direction: sign(permits.trendPercent),
      values: {
        latestYear: permits.latestYear,
        priorYear: permits.priorYear,
        latestYearUnits: permits.latestYearUnits,
        priorYearUnits: permits.priorYearUnits,
        trendPercent: permits.trendPercent,
      },
      detail: `Permitted units ${permits.priorYearUnits} (${permits.priorYear}) → ${permits.latestYearUnits} (${permits.latestYear}), ${permits.trendPercent >= 0 ? "+" : ""}${permits.trendPercent.toFixed(1)}% year-over-year`,
    });
  } else {
    missingSignals.push({
      signal: "permits",
      source: PERMITS_SOURCE,
      reason:
        "Fewer than two consecutive ingested Census BPS years for this county (or a zero prior year that would force a percent-against-zero)",
    });
  }

  if (employment) {
    evidence.push({
      signal: "employment",
      source: EMPLOYMENT_SOURCE,
      years: `${employment.latestYear - 1}→${employment.latestYear}`,
      // Employment count is the momentum leg; wages are reported as evidence
      // but do not vote — one vote per signal keeps the sum interpretable.
      direction: sign(employment.employmentTrendPercent),
      values: {
        latestYear: employment.latestYear,
        avgEmployment: employment.avgEmployment,
        avgWeeklyWage: employment.avgWeeklyWage,
        employmentTrendPercent: employment.employmentTrendPercent,
        wageTrendPercent: employment.wageTrendPercent,
      },
      detail: `Avg employment ${employment.avgEmployment} in ${employment.latestYear} (${employment.employmentTrendPercent >= 0 ? "+" : ""}${employment.employmentTrendPercent.toFixed(1)}% YoY); avg weekly wage $${employment.avgWeeklyWage} (${employment.wageTrendPercent >= 0 ? "+" : ""}${employment.wageTrendPercent.toFixed(1)}% YoY)`,
    });
  } else {
    missingSignals.push({
      signal: "employment",
      source: EMPLOYMENT_SOURCE,
      reason:
        "Fewer than two consecutive ingested BLS QCEW years for this county, or the county is BLS-suppressed",
    });
  }

  const signalsPresent = evidence.length;

  if (signalsPresent < 2) {
    return {
      stateFips,
      countyFips,
      signalsConsidered: 3,
      signalsPresent,
      evidence,
      missingSignals,
      composite: null,
      compositeUnavailableReason: `Only ${signalsPresent} of 3 signals ingested for this county — a composite from fewer than 2 signals would overstate. Partial evidence returned as-is.`,
    };
  }

  const score = evidence.reduce((sum, e) => sum + e.direction, 0);
  const allFlat = evidence.every((e) => e.direction === 0);
  const direction =
    score > 0 ? "rising" : score < 0 ? "cooling" : allFlat ? "flat" : "mixed";

  return {
    stateFips,
    countyFips,
    signalsConsidered: 3,
    signalsPresent,
    evidence,
    missingSignals,
    composite: { score, outOf: signalsPresent, direction, basis: COMPOSITE_BASIS },
    compositeUnavailableReason: null,
  };
}
