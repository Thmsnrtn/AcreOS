/**
 * Phase D2 — signup-to-first-value instrumentation.
 *
 * Read-side analysis on the Rosy-River lifecycle_events firehose. Computes
 * per-org TTFV (time-to-first-value) + abandonment + funnel rates and
 * persists snapshots in onboarding_funnel_metrics. Surfaced to the
 * founder dashboard via /api/founder/onboarding-funnel/*.
 *
 * "First value" = the FIRST lifecycle event per org whose eventType matches
 * one of FIRST_VALUE_EVENT_TYPES (defined in shared/schema/onboarding-funnel.ts).
 *
 * Phase 0-1 Elevate target: median TTFV < 90 seconds. The summary endpoint
 * returns belowNinetySecondThreshold for charting against that bar.
 *
 * Cron registration is deferred — Solene wires computeFunnelMetrics into
 * runScheduledJobs.ts in a follow-up.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { lifecycleEvents } from "@shared/schema";
import { paxUserContext } from "@shared/schema/pax-user-context";
import {
  ABANDONMENT_THRESHOLD_DAYS,
  FIRST_VALUE_EVENT_TYPES,
  type FirstValueEventType,
  type OnboardingFunnelMetricRow,
  onboardingFunnelMetrics,
} from "@shared/schema/onboarding-funnel";
import { logger } from "../../utils/logger";

// ─── Public types ───────────────────────────────────────────────────────────

export interface FunnelComputeResult {
  orgsProcessed: number;
  metricsWritten: number;
  errors: number;
  durationMs: number;
}

export interface FunnelSummary {
  windowDays: number;
  totalSignups: number;
  totalFirstValue: number;
  firstValueRate: number;
  medianTimeToFirstValueSeconds: number | null;
  p50TimeToFirstValueSeconds: number | null;
  p90TimeToFirstValueSeconds: number | null;
  belowNinetySecondThreshold: number;
  abandonmentByStep: Record<number, number>;
}

export interface OrgFunnelDetail {
  metric: OnboardingFunnelMetricRow | null;
  qualifyingEvent: { kind: string; occurredAt: Date } | null;
  recentEvents: Array<{ kind: string; occurredAt: Date }>;
}

// Re-export for callers; keeps the contract local.
export { FIRST_VALUE_EVENT_TYPES };
export type { FirstValueEventType };

// Lifecycle row shape we actually consume — narrowed to the columns we read.
interface LifecycleRow {
  organizationId: number | null;
  eventType: string;
  occurredAt: Date;
}

// ─── Compute ───────────────────────────────────────────────────────────────

/**
 * Compute funnel metrics for orgs that signed up in the configured window.
 * Upserts onboarding_funnel_metrics rows keyed by (org_id, today's date).
 * Never throws — fire-and-forget pattern for the cron path.
 *
 * Default window: last 30 days (orgs newer than that get recomputed each run;
 * older orgs are considered settled and not recomputed by the cron loop —
 * the founder UI can trigger a recompute via the POST endpoint).
 */
export async function computeFunnelMetrics(opts?: {
  sinceDate?: Date;
}): Promise<FunnelComputeResult> {
  const start = Date.now();
  const since =
    opts?.sinceDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const measuredDate = formatDateOnly(now);

  let orgsProcessed = 0;
  let metricsWritten = 0;
  let errors = 0;

  try {
    // 1. Find every org with a signup event in the window.
    const signupRows = await db
      .select({
        organizationId: lifecycleEvents.organizationId,
        occurredAt: lifecycleEvents.occurredAt,
      })
      .from(lifecycleEvents)
      .where(
        and(
          eq(lifecycleEvents.eventType, "signup.created"),
          gte(lifecycleEvents.occurredAt, since),
        ),
      );

    // De-dupe by org_id, keep earliest signup.
    const signupByOrg = new Map<number, Date>();
    for (const row of signupRows) {
      if (row.organizationId == null) continue;
      const existing = signupByOrg.get(row.organizationId);
      if (!existing || row.occurredAt < existing) {
        signupByOrg.set(row.organizationId, row.occurredAt);
      }
    }

    orgsProcessed = signupByOrg.size;
    if (orgsProcessed === 0) {
      return {
        orgsProcessed: 0,
        metricsWritten: 0,
        errors: 0,
        durationMs: Date.now() - start,
      };
    }

    // 2. For each org, pull every relevant event in one query and derive
    // the funnel snapshot.
    const orgIds = [...signupByOrg.keys()];
    const allEvents = await db
      .select({
        organizationId: lifecycleEvents.organizationId,
        eventType: lifecycleEvents.eventType,
        occurredAt: lifecycleEvents.occurredAt,
      })
      .from(lifecycleEvents)
      .where(inArray(lifecycleEvents.organizationId, orgIds));

    // Bucket events by org for O(N) processing.
    const eventsByOrg = new Map<number, LifecycleRow[]>();
    for (const e of allEvents) {
      if (e.organizationId == null) continue;
      const arr = eventsByOrg.get(e.organizationId);
      if (arr) arr.push(e as LifecycleRow);
      else eventsByOrg.set(e.organizationId, [e as LifecycleRow]);
    }

    // 3. Vertical lookup — single query, then map by org_id.
    const verticalRows = await db
      .select({
        organizationId: paxUserContext.organizationId,
        vertical: paxUserContext.vertical,
      })
      .from(paxUserContext)
      .where(
        inArray(
          paxUserContext.organizationId,
          orgIds.map((n) => String(n)),
        ),
      );
    const verticalByOrg = new Map<string, string | null>();
    for (const v of verticalRows) {
      // First non-null vertical per org wins — pax_user_context is per-user,
      // so an org with multiple users may have multiple rows.
      const existing = verticalByOrg.get(v.organizationId);
      if (existing == null && v.vertical) {
        verticalByOrg.set(v.organizationId, v.vertical);
      }
    }

    // 4. Compute + upsert per org.
    for (const [orgId, signupAt] of signupByOrg) {
      try {
        const orgEvents = (eventsByOrg.get(orgId) ?? []).slice().sort(
          (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
        );

        const snapshot = deriveFunnelSnapshot({
          orgId,
          signupAt,
          events: orgEvents,
          vertical: verticalByOrg.get(String(orgId)) ?? null,
          now,
        });

        await db
          .insert(onboardingFunnelMetrics)
          .values({
            orgId: String(orgId),
            measuredDate,
            signupAt,
            firstValueAt: snapshot.firstValueAt,
            timeToFirstValueSeconds: snapshot.timeToFirstValueSeconds,
            firstValueAction: snapshot.firstValueAction,
            step1CompletedAt: snapshot.stepCompletedAt[1],
            step2CompletedAt: snapshot.stepCompletedAt[2],
            step3CompletedAt: snapshot.stepCompletedAt[3],
            step4CompletedAt: snapshot.stepCompletedAt[4],
            step5CompletedAt: snapshot.stepCompletedAt[5],
            abandonedAtStep: snapshot.abandonedAtStep,
            abandonedReason: snapshot.abandonedReason,
            vertical: snapshot.vertical,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              onboardingFunnelMetrics.orgId,
              onboardingFunnelMetrics.measuredDate,
            ],
            set: {
              signupAt,
              firstValueAt: snapshot.firstValueAt,
              timeToFirstValueSeconds: snapshot.timeToFirstValueSeconds,
              firstValueAction: snapshot.firstValueAction,
              step1CompletedAt: snapshot.stepCompletedAt[1],
              step2CompletedAt: snapshot.stepCompletedAt[2],
              step3CompletedAt: snapshot.stepCompletedAt[3],
              step4CompletedAt: snapshot.stepCompletedAt[4],
              step5CompletedAt: snapshot.stepCompletedAt[5],
              abandonedAtStep: snapshot.abandonedAtStep,
              abandonedReason: snapshot.abandonedReason,
              vertical: snapshot.vertical,
              updatedAt: now,
            },
          });

        metricsWritten++;
      } catch (err) {
        errors++;
        logger.warn("[firstValueInstrumentation] per-org compute failed", {
          source: "first-value-instrumentation",
          metadata: {
            orgId: String(orgId),
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  } catch (err) {
    logger.error("[firstValueInstrumentation] compute failed", {
      source: "first-value-instrumentation",
      metadata: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    errors++;
  }

  return {
    orgsProcessed,
    metricsWritten,
    errors,
    durationMs: Date.now() - start,
  };
}

// ─── Pure derivation (exported for tests) ──────────────────────────────────

export interface FunnelSnapshot {
  firstValueAt: Date | null;
  timeToFirstValueSeconds: number | null;
  firstValueAction: string | null;
  stepCompletedAt: Record<1 | 2 | 3 | 4 | 5, Date | null>;
  abandonedAtStep: number | null;
  abandonedReason: string | null;
  vertical: string | null;
}

/**
 * Derive the funnel-snapshot fields from a single org's chronologically-
 * sorted event list. Pure function — no DB access, easy to unit test.
 */
export function deriveFunnelSnapshot(input: {
  orgId: number;
  signupAt: Date;
  events: LifecycleRow[];
  vertical: string | null;
  now: Date;
}): FunnelSnapshot {
  const { signupAt, events, vertical, now } = input;

  // Find the FIRST qualifying event after signup. "First" is by occurredAt;
  // ties broken by the order in FIRST_VALUE_EVENT_TYPES.
  const qualifyingSet = new Set<string>(FIRST_VALUE_EVENT_TYPES);
  let firstValueEvent: LifecycleRow | null = null;
  for (const e of events) {
    if (e.occurredAt < signupAt) continue;
    if (!qualifyingSet.has(e.eventType)) continue;
    if (
      !firstValueEvent ||
      e.occurredAt < firstValueEvent.occurredAt ||
      (e.occurredAt.getTime() === firstValueEvent.occurredAt.getTime() &&
        eventTypeRank(e.eventType) <
          eventTypeRank(firstValueEvent.eventType))
    ) {
      firstValueEvent = e;
    }
  }

  const firstValueAt = firstValueEvent?.occurredAt ?? null;
  const timeToFirstValueSeconds = firstValueAt
    ? Math.max(
        0,
        Math.floor((firstValueAt.getTime() - signupAt.getTime()) / 1000),
      )
    : null;
  const firstValueAction = firstValueEvent?.eventType ?? null;

  // Step completion timestamps.
  const stepCompletedAt: Record<1 | 2 | 3 | 4 | 5, Date | null> = {
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
  };
  for (const e of events) {
    const match = e.eventType.match(/^onboarding\.step_([1-5])_completed$/);
    if (!match) continue;
    const step = Number(match[1]) as 1 | 2 | 3 | 4 | 5;
    // First completion wins (stable for re-completion events).
    if (!stepCompletedAt[step]) stepCompletedAt[step] = e.occurredAt;
  }

  // Abandonment: if step 5 not done and no recent step-completion in the
  // abandonment window, mark abandoned at the last-incomplete step (the
  // step they were SUPPOSED to do next).
  let abandonedAtStep: number | null = null;
  let abandonedReason: string | null = null;
  if (!stepCompletedAt[5]) {
    const lastCompletedTs = ([1, 2, 3, 4, 5] as const)
      .map((s) => stepCompletedAt[s]?.getTime() ?? null)
      .filter((t): t is number => t !== null)
      .reduce((max, t) => Math.max(max, t), 0);
    // Use the later of signup or last completion as the "last activity"
    // baseline — orgs that signed up + never moved are abandoned at step 1.
    const lastActivityTs = Math.max(signupAt.getTime(), lastCompletedTs);
    const stalledMs = now.getTime() - lastActivityTs;
    const stalledDays = stalledMs / (24 * 60 * 60 * 1000);
    if (stalledDays > ABANDONMENT_THRESHOLD_DAYS) {
      // The step they abandoned AT = the lowest step number not yet
      // completed. If they completed up through step 2, they abandoned
      // at step 3.
      const lastDoneStep = ([1, 2, 3, 4, 5] as const)
        .filter((s) => stepCompletedAt[s] !== null)
        .reduce((max, s) => Math.max(max, s), 0);
      abandonedAtStep = Math.min(5, lastDoneStep + 1);
      abandonedReason = `no activity for ${Math.floor(stalledDays)} days`;
    }
  }

  return {
    firstValueAt,
    timeToFirstValueSeconds,
    firstValueAction,
    stepCompletedAt,
    abandonedAtStep,
    abandonedReason,
    vertical,
  };
}

function eventTypeRank(t: string): number {
  const i = (FIRST_VALUE_EVENT_TYPES as readonly string[]).indexOf(t);
  return i < 0 ? 999 : i;
}

// ─── Summary ───────────────────────────────────────────────────────────────

/**
 * Roll up the persisted onboarding_funnel_metrics rows into a single
 * summary suitable for the founder dashboard headline cards.
 *
 * Looks at the most-recent metric row per org in the window. Percentiles
 * come from Postgres `percentile_cont`.
 */
export async function getFunnelSummary(
  windowDays: number,
): Promise<FunnelSummary> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Pull the most-recent metric per org within the window. We select all
  // rows, then de-dupe in memory keyed by org_id — keeps the SQL portable
  // (no DISTINCT ON in the orm layer).
  const rows = await db
    .select({
      orgId: onboardingFunnelMetrics.orgId,
      signupAt: onboardingFunnelMetrics.signupAt,
      timeToFirstValueSeconds:
        onboardingFunnelMetrics.timeToFirstValueSeconds,
      abandonedAtStep: onboardingFunnelMetrics.abandonedAtStep,
      measuredDate: onboardingFunnelMetrics.measuredDate,
    })
    .from(onboardingFunnelMetrics)
    .where(gte(onboardingFunnelMetrics.signupAt, since));

  const latestByOrg = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const existing = latestByOrg.get(r.orgId);
    if (
      !existing ||
      String(r.measuredDate) > String(existing.measuredDate)
    ) {
      latestByOrg.set(r.orgId, r);
    }
  }

  const latest = [...latestByOrg.values()];
  const totalSignups = latest.length;
  const ttfvValues = latest
    .map((r) => r.timeToFirstValueSeconds)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const totalFirstValue = ttfvValues.length;
  const firstValueRate =
    totalSignups > 0 ? totalFirstValue / totalSignups : 0;

  const p50 = percentile(ttfvValues, 0.5);
  const p90 = percentile(ttfvValues, 0.9);
  const belowNinety = ttfvValues.filter((v) => v < 90).length;

  const abandonmentByStep: Record<number, number> = {};
  for (const r of latest) {
    if (r.abandonedAtStep != null) {
      abandonmentByStep[r.abandonedAtStep] =
        (abandonmentByStep[r.abandonedAtStep] ?? 0) + 1;
    }
  }

  return {
    windowDays,
    totalSignups,
    totalFirstValue,
    firstValueRate,
    medianTimeToFirstValueSeconds: p50,
    p50TimeToFirstValueSeconds: p50,
    p90TimeToFirstValueSeconds: p90,
    belowNinetySecondThreshold: belowNinety,
    abandonmentByStep,
  };
}

// ─── Per-org drill-down ────────────────────────────────────────────────────

export async function getOrgFunnelDetail(
  orgId: string,
): Promise<OrgFunnelDetail | null> {
  // Latest metric row for this org.
  const metricRows = await db
    .select()
    .from(onboardingFunnelMetrics)
    .where(eq(onboardingFunnelMetrics.orgId, orgId))
    .orderBy(desc(onboardingFunnelMetrics.measuredDate))
    .limit(1);

  const metric = metricRows[0] ?? null;

  // Recent lifecycle events (most-recent 50). org_id on the analytics
  // table is text; on lifecycle_events it's integer — coerce.
  const orgIdNum = Number(orgId);
  if (!Number.isFinite(orgIdNum)) {
    if (!metric) return null;
    return { metric, qualifyingEvent: null, recentEvents: [] };
  }

  const events = await db
    .select({
      eventType: lifecycleEvents.eventType,
      occurredAt: lifecycleEvents.occurredAt,
    })
    .from(lifecycleEvents)
    .where(eq(lifecycleEvents.organizationId, orgIdNum))
    .orderBy(desc(lifecycleEvents.occurredAt))
    .limit(50);

  if (!metric && events.length === 0) {
    return null;
  }

  // qualifyingEvent = the lifecycle event that backs this org's first value.
  let qualifyingEvent: { kind: string; occurredAt: Date } | null = null;
  if (metric?.firstValueAction && metric.firstValueAt) {
    qualifyingEvent = {
      kind: metric.firstValueAction,
      occurredAt: metric.firstValueAt,
    };
  }

  return {
    metric,
    qualifyingEvent,
    recentEvents: events.map((e) => ({
      kind: e.eventType,
      occurredAt: e.occurredAt,
    })),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Linear-interpolated percentile, matching Postgres's percentile_cont.
 * Returns null on empty input.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function formatDateOnly(d: Date): string {
  // YYYY-MM-DD in UTC. Postgres date column happily accepts this string.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Re-export sql helper for downstream callers that want raw access.
export { sql };
