/**
 * countyRollupJob.ts — DB gather + materialization for the cross-org data
 * co-op county rollups (Tier 3F).
 *
 * Monthly worker job (`county_market_rollup` in runScheduledJobs.ts +
 * jobRegistry roster). Each run:
 *
 *   1. Finds candidate counties: (state, county) pairs in parcel_observations
 *      with >= MIN_COHORT_SIZE distinct APNs. The HAVING clause is a
 *      belt-and-braces twin of the structural gate in computeCountyRollup()
 *      — a sub-k county never even reaches the aggregation.
 *   2. Gathers raw samples per county (asked/accepted $/acre,
 *      days-to-response, observation density, LCS grades) from CONSENTING
 *      operators only (founder ruling 2026-09-29 #11, DEFECT-0159). The org
 *      column is selected so the 5-distinct-operator floor can be counted;
 *      it never reaches the persisted row.
 *   3. computeCountyRollup() (pure substrate) k-gates + buckets + composes;
 *      non-null results are upserted into county_market_rollups.
 *   4. Records a county_rollup_runs ledger row; if the last TWO runs both
 *      wrote zero rollups, raises an alert-spine warning (deadman tells us
 *      the job ran — this tells us it stopped PRODUCING).
 *   5. When a quarter just closed (run lands in the first month of a new
 *      quarter), drafts the previous quarter's market report if absent —
 *      draft only, founder-reviewable, never auto-published.
 *
 * Recomputes the previous AND current calendar months each run: the previous
 * month catches data that arrived after month rollover; the current month
 * keeps the Map-door heat surface fresh mid-period.
 */

import { sql, and, eq, desc, gte, inArray, lt, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import {
  countyMarketRollups,
  countyRollupRuns,
  deals,
  landCreditScores,
  offerLetters,
  parcelObservations,
  properties,
} from "@shared/schema";
import { logger } from "../../utils/logger";
import { consentingOrgIds } from "../sophiePrivacyGuard";
import {
  MIN_COHORT_SIZE,
  MIN_DISTINCT_OPERATORS,
  type OperatorSample,
  computeCountyRollup,
  periodOf,
  periodWindow,
  quarterOf,
  type CountyRollupRow,
} from "./privacyRollup";

interface CandidateCounty {
  state: string;
  county: string;
  parcelsObserved: number;
}

/** An int[] literal for `= ANY(...)`; empty is a valid, match-nothing array. */
function intArray(ids: Iterable<number>) {
  const list = [...ids].filter((n) => Number.isInteger(n));
  return list.length === 0
    ? sql`ARRAY[]::int[]`
    : sql`ARRAY[${sql.join(list.map((n) => sql`${n}`), sql`, `)}]::int[]`;
}

/**
 * Counties with at least k parcels observed by the platform itself (public
 * records, organization_id NULL) or by a consenting operator. A candidate
 * only — the published density is decided per county in the gather.
 */
async function findCandidateCounties(consenting: Set<number>): Promise<CandidateCounty[]> {
  const result = await db.execute<{
    state: string;
    county: string;
    parcels: number;
  }>(sql`
    SELECT state, county, COUNT(DISTINCT apn)::int AS parcels
    FROM parcel_observations
    WHERE state IS NOT NULL AND county IS NOT NULL
      AND (organization_id IS NULL OR organization_id = ANY(${intArray(consenting)}))
    GROUP BY state, county
    HAVING COUNT(DISTINCT apn) >= ${MIN_COHORT_SIZE}
  `);
  const rows = ((result as unknown as { rows?: unknown[] })?.rows ??
    []) as Array<{ state: string; county: string; parcels: number }>;
  return rows.map((r) => ({
    state: r.state,
    county: r.county,
    parcelsObserved: Number(r.parcels),
  }));
}

/** Gather raw samples and compose ONE county's rollup (null below k). */
async function gatherCountyRollup(
  candidate: CandidateCounty,
  period: string,
  consenting: Set<number>,
): Promise<CountyRollupRow | null> {
  const { start, end } = periodWindow(period);
  const st = candidate.state.trim().toUpperCase();
  const county = candidate.county.trim();
  const consentingIds = [...consenting];

  // Parcel density. Platform observations (public records, no org) always
  // count; consenting operators' observations count only when at least
  // MIN_DISTINCT_OPERATORS of them observed parcels here — otherwise the
  // density figure would carry one operator's activity.
  const opsResult = await db.execute<{ ops: number }>(sql`
    SELECT COUNT(DISTINCT organization_id)::int AS ops
    FROM parcel_observations
    WHERE state = ${candidate.state} AND county = ${candidate.county}
      AND organization_id = ANY(${intArray(consenting)})
  `);
  const observingOperators = Number(
    ((opsResult as unknown as { rows?: Array<{ ops: number }> })?.rows ?? [])[0]?.ops ?? 0,
  );
  const includeOperators = observingOperators >= MIN_DISTINCT_OPERATORS;
  const densityResult = await db.execute<{ parcels: number; n: number }>(sql`
    SELECT COUNT(DISTINCT apn)::int AS parcels,
           COUNT(*) FILTER (WHERE observed_at >= ${start} AND observed_at < ${end})::int AS n
    FROM parcel_observations
    WHERE state = ${candidate.state} AND county = ${candidate.county}
      AND (organization_id IS NULL
           OR (${includeOperators} AND organization_id = ANY(${intArray(consenting)})))
  `);
  const density = ((densityResult as unknown as { rows?: Array<{ parcels: number; n: number }> })?.rows ?? [])[0];
  const parcelsObserved = Number(density?.parcels ?? 0);
  const observationsInPeriod = Number(density?.n ?? 0);

  // Priced samples come only from consenting operators; with none, there is
  // nothing to gather (and `inArray` over an empty list is not a query).
  if (consentingIds.length === 0) {
    return computeCountyRollup({
      state: st,
      county,
      period,
      parcelsObserved,
      observationsInPeriod,
      askedPricePerAcre: [],
      acceptedPricePerAcre: [],
      daysToResponse: [],
      lcsGradeCounts: {},
      lcsOperators: [],
    });
  }

  // Asked $/acre — offer letters sent in the period, by consenting operators.
  const askedRows = await db
    .select({
      operator: offerLetters.organizationId,
      offerAmount: offerLetters.offerAmount,
      sizeAcres: properties.sizeAcres,
    })
    .from(offerLetters)
    .innerJoin(properties, eq(properties.id, offerLetters.propertyId))
    .where(
      and(
        inArray(offerLetters.organizationId, consentingIds),
        eq(properties.county, county),
        eq(properties.state, st),
        isNotNull(offerLetters.sentAt),
        gte(offerLetters.sentAt, start),
        lt(offerLetters.sentAt, end),
      ),
    );
  const askedPricePerAcre: OperatorSample[] = askedRows.map((r) => {
    const amount = parseFloat(String(r.offerAmount ?? "0"));
    const acres = parseFloat(String(r.sizeAcres ?? "0"));
    return { operator: r.operator, value: acres > 0 && amount > 0 ? amount / acres : NaN };
  });

  // Accepted $/acre — deals with an accepted amount, anchored to the period
  // by close date (or offer date when not yet closed).
  const acceptedRows = await db
    .select({
      operator: deals.organizationId,
      acceptedAmount: deals.acceptedAmount,
      sizeAcres: properties.sizeAcres,
    })
    .from(deals)
    .innerJoin(properties, eq(properties.id, deals.propertyId))
    .where(
      and(
        inArray(deals.organizationId, consentingIds),
        eq(properties.county, county),
        eq(properties.state, st),
        isNotNull(deals.acceptedAmount),
        sql`COALESCE(${deals.closingDate}, ${deals.offerDate}, ${deals.createdAt}) >= ${start}`,
        sql`COALESCE(${deals.closingDate}, ${deals.offerDate}, ${deals.createdAt}) < ${end}`,
      ),
    );
  const acceptedPricePerAcre: OperatorSample[] = acceptedRows.map((r) => {
    const amount = parseFloat(String(r.acceptedAmount ?? "0"));
    const acres = parseFloat(String(r.sizeAcres ?? "0"));
    return { operator: r.operator, value: acres > 0 && amount > 0 ? amount / acres : NaN };
  });

  // Days-to-response — offers with both sent + responded timestamps,
  // anchored by response date.
  const responseRows = await db
    .select({
      operator: offerLetters.organizationId,
      sentAt: offerLetters.sentAt,
      respondedAt: offerLetters.respondedAt,
    })
    .from(offerLetters)
    .innerJoin(properties, eq(properties.id, offerLetters.propertyId))
    .where(
      and(
        inArray(offerLetters.organizationId, consentingIds),
        eq(properties.county, county),
        eq(properties.state, st),
        isNotNull(offerLetters.sentAt),
        isNotNull(offerLetters.respondedAt),
        gte(offerLetters.respondedAt, start),
        lt(offerLetters.respondedAt, end),
      ),
    );
  const daysToResponse: OperatorSample[] = responseRows.map((r) => {
    const sent = r.sentAt ? new Date(r.sentAt).getTime() : NaN;
    const responded = r.respondedAt ? new Date(r.respondedAt).getTime() : NaN;
    const days = (responded - sent) / (24 * 60 * 60 * 1000);
    return { operator: r.operator, value: Number.isFinite(days) && days >= 0 ? days : NaN };
  });

  // LCS grade counts — latest score per parcel, for parcels a CONSENTING
  // operator holds. land_credit_scores has no org column; the property's
  // owner is the operator whose work produced the score.
  const gradeResult = await db.execute<{ grade: string; operator: number; n: number }>(sql`
    SELECT grade, operator, COUNT(*)::int AS n
    FROM (
      SELECT DISTINCT ON (s.property_id) s.property_id, s.grade, p.organization_id AS operator
      FROM land_credit_scores s
      JOIN properties p ON p.id = s.property_id
      WHERE s.state = ${st} AND s.county = ${county}
        AND p.organization_id = ANY(${intArray(consenting)})
      ORDER BY s.property_id, s.created_at DESC
    ) latest
    GROUP BY grade, operator
  `);
  const gradeRows = ((gradeResult as unknown as {
    rows?: Array<{ grade: string; operator: number; n: number }>;
  })?.rows ?? []) as Array<{ grade: string; operator: number; n: number }>;
  const lcsGradeCounts: Record<string, number> = {};
  const lcsOperators = new Set<number>();
  for (const r of gradeRows) {
    if (!r.grade) continue;
    lcsGradeCounts[r.grade] = (lcsGradeCounts[r.grade] ?? 0) + Number(r.n);
    lcsOperators.add(Number(r.operator));
  }

  return computeCountyRollup({
    state: st,
    county,
    period,
    parcelsObserved,
    observationsInPeriod,
    askedPricePerAcre,
    acceptedPricePerAcre,
    daysToResponse,
    lcsGradeCounts,
    lcsOperators: [...lcsOperators],
  });
}

export interface CountyRollupRunResult {
  periods: string[];
  countiesScanned: number;
  rollupsWritten: number;
}

/**
 * The job body. Recomputes the current + previous month for every candidate
 * county, upserts results, records the run, and raises the two-zero-runs
 * alert-spine warning.
 */
export async function runCountyMarketRollup(
  now: Date = new Date(),
): Promise<CountyRollupRunResult> {
  const currentPeriod = periodOf(now);
  const prevMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const previousPeriod = periodOf(prevMonth);
  const periods = [previousPeriod, currentPeriod];

  // Read once per run: an org that opted out is excluded from this run on.
  const consenting = await consentingOrgIds();
  const candidates = await findCandidateCounties(consenting);
  let rollupsWritten = 0;

  for (const candidate of candidates) {
    for (const period of periods) {
      try {
        const rollup = await gatherCountyRollup(candidate, period, consenting);
        if (!rollup) continue; // structurally below k — never materialized
        await db
          .insert(countyMarketRollups)
          .values({
            state: rollup.state,
            county: rollup.county,
            period: rollup.period,
            metrics: rollup.metrics as unknown as Record<string, unknown>,
            cohortSize: rollup.cohortSize,
            computedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              countyMarketRollups.state,
              countyMarketRollups.county,
              countyMarketRollups.period,
            ],
            set: {
              metrics: rollup.metrics as unknown as Record<string, unknown>,
              cohortSize: rollup.cohortSize,
              computedAt: new Date(),
            },
          });
        rollupsWritten++;
      } catch (err) {
        logger.error(
          "[dataCoop] county rollup failed",
          err instanceof Error ? err : undefined,
          {
            metadata: {
              state: candidate.state,
              county: candidate.county,
              period,
            },
          },
        );
      }
    }
  }

  // Run ledger + two-consecutive-zero-runs warning.
  await db.insert(countyRollupRuns).values({
    period: currentPeriod,
    rollupsWritten,
    countiesScanned: candidates.length,
    ranAt: new Date(),
  });

  try {
    const lastTwo = await db
      .select({ rollupsWritten: countyRollupRuns.rollupsWritten })
      .from(countyRollupRuns)
      .orderBy(desc(countyRollupRuns.ranAt))
      .limit(2);
    if (
      lastTwo.length === 2 &&
      lastTwo.every((r) => r.rollupsWritten === 0)
    ) {
      const { raiseAlert } = await import("../alertSpine");
      await raiseAlert({
        severity: "warning",
        source: "county_market_rollup",
        title: "Data co-op produced zero county rollups two runs straight",
        detail:
          "The monthly county_market_rollup job ran twice in a row without " +
          "materializing a single rollup row. Either no county has cleared " +
          `the k=${MIN_COHORT_SIZE} contributing-parcel privacy floor yet, or the ` +
          "observation pipeline feeding parcel_observations has gone dark. " +
          "Check parcel_observations growth and county_rollup_runs.",
        dedupeKey: "zero_rollups_two_runs",
        domain: "reliability",
        citedReason:
          "Tier 3F: the co-op silently producing nothing is the wired-but-dark failure mode.",
        metadata: { countiesScanned: candidates.length, periods },
      });
    }
  } catch (err) {
    logger.error(
      "[dataCoop] zero-rollup alert check failed",
      err instanceof Error ? err : undefined,
    );
  }

  // Quarter-close draft: in the first month of a new quarter, draft the
  // previous quarter's report once (draft only — founder reviews; nothing
  // is published).
  try {
    if (now.getUTCMonth() % 3 === 0) {
      const prevQuarterAnchor = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );
      const quarter = quarterOf(prevQuarterAnchor);
      const { draftQuarterlyMarketReportIfAbsent } = await import(
        "./quarterlyMarketReport"
      );
      const drafted = await draftQuarterlyMarketReportIfAbsent(quarter);
      if (drafted) {
        logger.info("[dataCoop] quarterly market report drafted", {
          metadata: { quarter },
        });
      }
    }
  } catch (err) {
    logger.error(
      "[dataCoop] quarterly draft step failed",
      err instanceof Error ? err : undefined,
    );
  }

  logger.info("[dataCoop] county market rollup run complete", {
    metadata: {
      periods,
      countiesScanned: candidates.length,
      rollupsWritten,
    },
  });

  return { periods, countiesScanned: candidates.length, rollupsWritten };
}
