/**
 * quarterlyMarketReport.ts — quarterly public market report generator
 * (Tier 3F foundation — NOT auto-published).
 *
 * Produces a structured JSON + markdown artifact per quarter from the
 * persisted county_market_rollups. The artifact is stored in
 * market_report_drafts (status 'draft') and is founder-reviewable via
 * /api/founder/market-reports. Witnessed-publish is a follow-up: there is
 * deliberately NO publish path here.
 *
 * Honesty contract (no-fabrication discipline):
 *   - Every number in the report is carried VERBATIM from a rollup row that
 *     itself cleared the k>=5 privacy floor. Nothing is interpolated,
 *     extrapolated, or invented.
 *   - Empty inputs produce an EXPLICITLY-empty report
 *     (insufficientData: true + a markdown section saying so) — never a
 *     placeholder market narrative.
 *
 * The pure core (buildQuarterlyMarketReport) takes rollup rows and is
 * directly unit-tested; the DB wrappers gather + persist.
 */

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  countyMarketRollups,
  marketReportDrafts,
  type CountyMarketRollup,
} from "@shared/schema";
import { logger } from "../../utils/logger";
import {
  MIN_COHORT_SIZE,
  periodsOfQuarter,
  type CountyRollupMetrics,
  type PrivateDistribution,
} from "./privacyRollup";

export interface QuarterlyReportCounty {
  state: string;
  county: string;
  /** Largest cohort across the quarter's monthly rollups for this county. */
  cohortSize: number;
  /** Periods ("YYYY-MM") that contributed a rollup row. */
  periods: string[];
  /** Latest-period metrics, carried verbatim (each sub-metric may be null). */
  metrics: CountyRollupMetrics;
}

export interface QuarterlyMarketReport {
  quarter: string;
  generatedAt: string;
  /** True when zero counties cleared the privacy floor this quarter. */
  insufficientData: boolean;
  privacyFloor: number;
  countiesReported: number;
  counties: QuarterlyReportCounty[];
  methodology: string;
}

const METHODOLOGY =
  `Every figure aggregates real activity across the AcreOS network at county ` +
  `level. A county is reported only when at least ${MIN_COHORT_SIZE} distinct ` +
  `parcels contribute (privacy floor); price samples are bucketed to the ` +
  `nearest $500 per acre before aggregation; no organization-level data is ` +
  `stored or derivable. Counties below the floor are omitted entirely rather ` +
  `than estimated.`;

function fmtDistribution(
  label: string,
  unit: string,
  d: PrivateDistribution | null,
): string {
  if (!d) {
    return `- ${label}: not enough network data this quarter`;
  }
  const f = (v: number) =>
    unit === "$"
      ? `$${Math.round(v).toLocaleString("en-US")}`
      : `${Math.round(v * 10) / 10}`;
  const suffix = unit === "$" ? "/acre" : unit;
  return `- ${label}: median ${f(d.median)}${suffix} (p25 ${f(d.p25)}${suffix}, p75 ${f(d.p75)}${suffix}, n=${d.n})`;
}

function renderMarkdown(report: QuarterlyMarketReport): string {
  const lines: string[] = [];
  lines.push(`# AcreOS Land Market Report — ${report.quarter}`);
  lines.push("");
  lines.push(`Generated ${report.generatedAt}. DRAFT — not published.`);
  lines.push("");

  if (report.insufficientData) {
    lines.push("## Not enough network data this quarter");
    lines.push("");
    lines.push(
      `No county cleared the ${report.privacyFloor}-parcel contribution floor ` +
        `during ${report.quarter}, so this report contains no market figures. ` +
        `AcreOS reports only aggregates backed by real network activity — ` +
        `there is nothing to show yet, and this report says so instead of ` +
        `estimating.`,
    );
  } else {
    lines.push(
      `${report.countiesReported} count${report.countiesReported === 1 ? "y" : "ies"} ` +
        `cleared the ${report.privacyFloor}-parcel contribution floor this quarter.`,
    );
    lines.push("");
    for (const c of report.counties) {
      const m = c.metrics;
      lines.push(`## ${c.county}, ${c.state}`);
      lines.push("");
      lines.push(
        `Contributing parcels: ${c.cohortSize} · months with data: ${c.periods.join(", ")}`,
      );
      lines.push(fmtDistribution("Asked price per acre", "$", m.askedPricePerAcre));
      lines.push(
        fmtDistribution("Accepted price per acre", "$", m.acceptedPricePerAcre),
      );
      lines.push(fmtDistribution("Days to seller response", " days", m.daysToResponse));
      if (m.lcsGradeDistribution) {
        const shares = Object.entries(m.lcsGradeDistribution.shares)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([grade, pct]) => `${grade} ${pct}%`)
          .join(", ");
        lines.push(
          `- Land Credit Score grades (${m.lcsGradeDistribution.total} parcels): ${shares}`,
        );
      } else {
        lines.push(`- Land Credit Score grades: not enough scored parcels`);
      }
      lines.push(
        `- Observation density: ${m.parcelObservationDensity.parcelsObserved} parcels observed`,
      );
      lines.push("");
    }
  }

  lines.push("## Methodology");
  lines.push("");
  lines.push(report.methodology);
  lines.push("");
  return lines.join("\n");
}

/**
 * Pure core: compose the quarter's report from its monthly rollup rows.
 * Empty input → explicitly-empty report (insufficientData: true).
 */
export function buildQuarterlyMarketReport(
  quarter: string,
  rollups: Array<
    Pick<CountyMarketRollup, "state" | "county" | "period" | "metrics" | "cohortSize">
  >,
  generatedAt: Date = new Date(),
): { json: QuarterlyMarketReport; markdown: string } {
  // Group by county; keep the LATEST period's metrics verbatim and the max
  // cohort across the quarter.
  const byCounty = new Map<
    string,
    { state: string; county: string; cohortSize: number; periods: string[]; latestPeriod: string; metrics: CountyRollupMetrics }
  >();

  for (const r of rollups) {
    const key = `${r.state}|${r.county}`;
    const existing = byCounty.get(key);
    if (!existing) {
      byCounty.set(key, {
        state: r.state,
        county: r.county,
        cohortSize: r.cohortSize,
        periods: [r.period],
        latestPeriod: r.period,
        metrics: r.metrics as unknown as CountyRollupMetrics,
      });
    } else {
      existing.cohortSize = Math.max(existing.cohortSize, r.cohortSize);
      existing.periods.push(r.period);
      if (r.period > existing.latestPeriod) {
        existing.latestPeriod = r.period;
        existing.metrics = r.metrics as unknown as CountyRollupMetrics;
      }
    }
  }

  const counties: QuarterlyReportCounty[] = Array.from(byCounty.values())
    .map((c) => ({
      state: c.state,
      county: c.county,
      cohortSize: c.cohortSize,
      periods: c.periods.sort(),
      metrics: c.metrics,
    }))
    .sort(
      (a, b) =>
        b.cohortSize - a.cohortSize ||
        a.state.localeCompare(b.state) ||
        a.county.localeCompare(b.county),
    );

  const json: QuarterlyMarketReport = {
    quarter,
    generatedAt: generatedAt.toISOString(),
    insufficientData: counties.length === 0,
    privacyFloor: MIN_COHORT_SIZE,
    countiesReported: counties.length,
    counties,
    methodology: METHODOLOGY,
  };

  return { json, markdown: renderMarkdown(json) };
}

/** Gather the quarter's rollups and build the report (no persistence). */
export async function generateQuarterlyMarketReport(
  quarter: string,
): Promise<{ json: QuarterlyMarketReport; markdown: string }> {
  const periods = periodsOfQuarter(quarter);
  const rollups =
    periods.length === 0
      ? []
      : await db
          .select({
            state: countyMarketRollups.state,
            county: countyMarketRollups.county,
            period: countyMarketRollups.period,
            metrics: countyMarketRollups.metrics,
            cohortSize: countyMarketRollups.cohortSize,
          })
          .from(countyMarketRollups)
          .where(inArray(countyMarketRollups.period, periods));
  return buildQuarterlyMarketReport(quarter, rollups);
}

/**
 * Generate + upsert the quarter's DRAFT artifact. Returns the draft row.
 * Regeneration replaces the existing draft (status stays 'draft').
 */
export async function upsertQuarterlyMarketReportDraft(quarter: string) {
  const { json, markdown } = await generateQuarterlyMarketReport(quarter);
  const [row] = await db
    .insert(marketReportDrafts)
    .values({
      quarter,
      status: "draft",
      report: json as unknown as Record<string, unknown>,
      markdown,
      generatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [marketReportDrafts.quarter],
      set: {
        report: json as unknown as Record<string, unknown>,
        markdown,
        generatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/** Draft the quarter ONCE (used by the rollup job at quarter close). */
export async function draftQuarterlyMarketReportIfAbsent(
  quarter: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: marketReportDrafts.id })
    .from(marketReportDrafts)
    .where(eq(marketReportDrafts.quarter, quarter))
    .limit(1);
  if (existing.length > 0) return false;
  await upsertQuarterlyMarketReportDraft(quarter);
  return true;
}

/** Newest-first draft list for the founder surface. */
export async function listMarketReportDrafts() {
  try {
    return await db
      .select({
        id: marketReportDrafts.id,
        quarter: marketReportDrafts.quarter,
        status: marketReportDrafts.status,
        generatedAt: marketReportDrafts.generatedAt,
      })
      .from(marketReportDrafts)
      .orderBy(desc(marketReportDrafts.generatedAt));
  } catch (err) {
    logger.error(
      "[dataCoop] listMarketReportDrafts failed",
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}
