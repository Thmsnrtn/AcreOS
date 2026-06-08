// ============================================================================
// server/services/audit/detectors/observationRateDetector.ts
// ----------------------------------------------------------------------------
// IYARI (future domain) — EXEMPLAR detector. "The acorn stopped growing."
//
// parcel_observations is the append-only fact log every enrichment/ingest path
// writes into. A healthy cluster is constantly observing new facts. If that
// insert-rate falls to ZERO over the last 24h — but the system was clearly
// observing in the prior week — something upstream stalled (a provider, a job,
// a credential) and the "acorn" has quietly stopped growing.
//
// We only fire ONCE THERE'S TRAFFIC: a brand-new zero-customer cluster that
// has never observed anything is honestly green, not broken. So the trigger is
// "prior 7-day window had observations AND the last 24h had none".
//
//   warn:     prior week had >0 observations, last 24h had 0
//   critical: same, and the prior week was high-volume (>= 100) — a busy
//             pipeline going fully silent is a louder signal than a trickle.
//
// Read-only against parcel_observations. Emits ONE finding (fixed dedupe_key)
// so re-runs update rather than duplicate; when ingest resumes the finding
// stops firing and ages out to 'stale'.
// ============================================================================

import { and, gte, lt, sql } from "drizzle-orm";

import { db } from "../../../db";
import { parcelObservations } from "@shared/schema";
import type { DomainDetector, FindingInput } from "../domainAudit";

const DAY_MS = 24 * 60 * 60 * 1000;
const HIGH_VOLUME_PRIOR = 100; // prior-week count above which a full stall is critical

async function countObservations(since: Date, before?: Date): Promise<number> {
  const conditions = [gte(parcelObservations.observedAt, since)];
  if (before) conditions.push(lt(parcelObservations.observedAt, before));
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(parcelObservations)
    .where(and(...conditions));
  return row?.n ?? 0;
}

export const observationRateDetector: DomainDetector = {
  id: "observation_rate",
  domain: "future",
  async run(): Promise<FindingInput[]> {
    const now = Date.now();
    const last24hStart = new Date(now - DAY_MS);
    const priorWeekStart = new Date(now - 8 * DAY_MS);

    const [last24h, priorWeek] = await Promise.all([
      countObservations(last24hStart),
      // prior 7 days, ending where the last-24h window begins (no overlap)
      countObservations(priorWeekStart, last24hStart),
    ]);

    // No recent ingest history → nothing to compare against → green.
    if (priorWeek <= 0) return [];
    // Still observing → green.
    if (last24h > 0) return [];

    const isCritical = priorWeek >= HIGH_VOLUME_PRIOR;

    return [
      {
        domain: "future",
        detector: "observation_rate",
        severity: isCritical ? "critical" : "warn",
        title: "Parcel observation ingest stalled (0 in last 24h)",
        detail:
          `parcel_observations recorded 0 facts in the last 24h after ` +
          `${priorWeek} in the prior 7 days. Ingest appears to have stopped — ` +
          `the acorn stopped growing.`,
        citedReason:
          "parcel_observations is the append-only system-of-record every " +
          "enrichment path writes into; a healthy cluster never goes a full " +
          "day silent once it has been observing.",
        dedupeKey: "observation_rate:stalled",
        metadata: {
          last24hCount: last24h,
          priorWeekCount: priorWeek,
          highVolumeThreshold: HIGH_VOLUME_PRIOR,
        },
      },
    ];
  },
};
