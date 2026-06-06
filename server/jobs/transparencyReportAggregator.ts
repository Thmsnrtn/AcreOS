/**
 * QUINN (Chief of Alignment) — nightly transparency report aggregator.
 *
 * Tahoe wave E9. Reads the rolling 90-day window across the new ledgers
 * (pax_refusal_payloads, pax_decision_appeals, solene_pre_call_decisions
 * founder-bypass rows) plus the alignment-detector drift findings and
 * upserts a `transparency_reports` row. The /transparency public surface
 * (future wave) reads the most-recent published row.
 *
 * Why aggregate vs query-at-render:
 *   - The transparency report is a public surface; we don't want every
 *     anonymous page load to hammer the audit tables.
 *   - Aggregating nightly also lets us snapshot the numbers so a regulator
 *     can verify the same window's metrics ship the same numbers next month.
 *
 * Idempotency: upsert on the unique (period_start, period_end) index. Same
 * window re-aggregated = same row updated in place.
 *
 * Publication: this job does NOT publish (no published_at set). Publication
 * is a separate manual gesture; the founder reviews the draft before
 * declaring it live.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../utils/logger";
import { transparencyReports } from "@shared/schema/transparency-reports";
import { alignmentDetectors } from "../services/pax/alignmentDetectors";

interface AggregationCounts {
  refusalCount: number;
  refusalByImmutable: Record<string, number>;
  appealCount: number;
  appealsUpheldCount: number;
  appealsReversedCount: number;
  founderBypassCount: number;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Run the aggregation pass over the rolling 90-day window ending at `endAt`.
 * Returns the upserted row's id, or null on failure.
 */
export async function runTransparencyReportAggregation(opts: {
  endAt?: Date;
} = {}): Promise<number | null> {
  const endAt = opts.endAt ?? new Date();
  const startAt = new Date(endAt.getTime() - NINETY_DAYS_MS);

  try {
    const counts = await aggregateCounts(startAt, endAt);
    const driftFindings = await collectAlignmentDriftFindings();

    // Upsert via raw SQL — drizzle's onConflictDoUpdate works but we need
    // the conflict-target index name which lives in the unique index DSL.
    const inserted = await db
      .insert(transparencyReports)
      .values({
        periodStart: startAt,
        periodEnd: endAt,
        refusalCount: counts.refusalCount,
        refusalByImmutable: counts.refusalByImmutable,
        appealCount: counts.appealCount,
        appealsUpheldCount: counts.appealsUpheldCount,
        appealsReversedCount: counts.appealsReversedCount,
        founderBypassCount: counts.founderBypassCount,
        demographicBiasFindings: { findings: [], reviewedAt: null },
        driftFindings,
      })
      .onConflictDoUpdate({
        target: [transparencyReports.periodStart, transparencyReports.periodEnd],
        set: {
          refusalCount: counts.refusalCount,
          refusalByImmutable: counts.refusalByImmutable,
          appealCount: counts.appealCount,
          appealsUpheldCount: counts.appealsUpheldCount,
          appealsReversedCount: counts.appealsReversedCount,
          founderBypassCount: counts.founderBypassCount,
          driftFindings,
        },
      })
      .returning({ id: transparencyReports.id });

    const id = inserted[0]?.id ?? null;
    logger.info(
      `[transparencyReportAggregator] aggregated period=${startAt.toISOString().slice(0, 10)}..${endAt.toISOString().slice(0, 10)} ` +
        `refusals=${counts.refusalCount} appeals=${counts.appealCount} bypasses=${counts.founderBypassCount} report_id=${id ?? "null"}`,
    );
    return id;
  } catch (err) {
    logger.error(
      "[transparencyReportAggregator] aggregation failed",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

async function aggregateCounts(
  start: Date,
  end: Date,
): Promise<AggregationCounts> {
  // Refusal counts (total + per cited immutable).
  const refusalRows = await db.execute(sql`
    SELECT cited_immutable_id AS imm, COUNT(*)::int AS c
    FROM pax_refusal_payloads
    WHERE created_at >= ${start.toISOString()}
      AND created_at <  ${end.toISOString()}
    GROUP BY cited_immutable_id
  `);
  const refusalByImmutable: Record<string, number> = {};
  let refusalCount = 0;
  for (const row of (refusalRows as unknown as {
    rows?: Array<{ imm: string; c: number }>;
  }).rows ?? []) {
    refusalByImmutable[row.imm] = Number(row.c);
    refusalCount += Number(row.c);
  }

  // Appeal totals + outcomes.
  const appealRows = await db.execute(sql`
    SELECT status, COUNT(*)::int AS c
    FROM pax_decision_appeals
    WHERE created_at >= ${start.toISOString()}
      AND created_at <  ${end.toISOString()}
    GROUP BY status
  `);
  let appealCount = 0;
  let appealsUpheldCount = 0;
  let appealsReversedCount = 0;
  for (const row of (appealRows as unknown as {
    rows?: Array<{ status: string; c: number }>;
  }).rows ?? []) {
    appealCount += Number(row.c);
    if (row.status === "upheld") appealsUpheldCount = Number(row.c);
    if (row.status === "reversed") appealsReversedCount = Number(row.c);
  }

  // Founder bypass count — solene_pre_call_decisions rows whose reasoning
  // matches the bypass markers.
  const bypassRows = await db.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM solene_pre_call_decisions
    WHERE decided_at >= ${start.toISOString()}
      AND decided_at <  ${end.toISOString()}
      AND reasoning ~* '\\m(founder.bypass|founder.override|sovereign.veto)\\M'
  `);
  const founderBypassCount = Number(
    (bypassRows as unknown as { rows?: Array<{ c: number }> }).rows?.[0]?.c ??
      0,
  );

  return {
    refusalCount,
    refusalByImmutable,
    appealCount,
    appealsUpheldCount,
    appealsReversedCount,
    founderBypassCount,
  };
}

async function collectAlignmentDriftFindings(): Promise<Record<string, unknown>> {
  // Best-effort: run each alignment detector and collect its findings into
  // the jsonb column. If any detector throws, we log + carry on; one bad
  // detector should never poison the whole report row.
  const out: Record<string, unknown> = {};
  for (const detector of alignmentDetectors) {
    try {
      const findings = await detector.run(db, {
        start: new Date(Date.now() - NINETY_DAYS_MS),
        end: new Date(),
      });
      out[detector.id] = {
        scope: detector.scope,
        citedImmutables: detector.citedImmutables,
        findingCount: findings.length,
        findings: findings.map((f) => ({
          key: f.key,
          severity: f.severity,
          summary: f.summary,
        })),
      };
    } catch (err) {
      out[detector.id] = {
        scope: detector.scope,
        citedImmutables: detector.citedImmutables,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return out;
}
