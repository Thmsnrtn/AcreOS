/**
 * O4 (P5 §2 — "promises with sensors") — SLO register derivation + the
 * persona-journey canary + the public /status truth layer.
 *
 * Three jobs, one honesty contract:
 *
 *   1. resolveSensorWired — `wired` is DERIVED from the real artifacts the
 *      register names (JOB_ROSTER membership for job sensors, the actual
 *      drizzle table objects for table sensors). A register row naming a
 *      nonexistent sensor resolves unwired and renders "declared, not yet
 *      sensed" — it can never render a number.
 *   2. runPersonaJourneyCanary — walks the deepest REAL minimal journey
 *      available and records per-step latency+success to the EXISTING
 *      synthetic_check_runs table (no new table, no migration):
 *        · demo org provisioned (G1.2 DEMO_ORG_ID): resolve → sample-marked
 *          workspace read (the same reads /api/demo/workspace serves) →
 *          sample-marked sentinel write round-trip (REFUSED unless the org is
 *          in simulationMode — the canary never writes to a non-simulated org).
 *        · demo org not provisioned: resolve (recorded honestly as
 *          "platform_only") → a real platform read. No journey is invented.
 *   3. getPublicSloStatus — assembles the register + current sensor readings
 *      + the canary's last run for the public /api/status payload. Every
 *      reading is a query result or null (refuse-not-fabricate); the
 *      error-budget seam reuses the house burn-rate math (computeBurnRateWindow
 *      from reliability/sloCompute — ONE definition of "burn" platform-wide).
 *
 * Public-page discipline: nothing org-identifying leaves this module — job
 * names, aggregate latencies, uptime percentages, and canary step labels only.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  apiTelemetrySamples,
  jobHealthLogs,
  syntheticCheckRuns,
  uptimeSamples,
  leads,
} from "@shared/schema";
import {
  SLO_REGISTER,
  type CanaryRunPublic,
  type CanaryStepPublic,
  type CanaryStepStatus,
  type CanaryWindowPublic,
  type PublicSloRow,
  type PublicSloStatus,
  type SloCurrentReading,
  type SloRegisterRow,
  type SloSensorRef,
} from "@shared/slo";
import { JOB_ROSTER } from "../jobs/jobRegistry";
import { computeBurnRateWindow } from "./reliability/sloCompute";
import { computeUptimePct } from "./autopilot/uptime";
import { logger } from "../utils/logger";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;

/** The declared doors p95 target the attainment reading is computed against. */
export const DOORS_P95_TARGET_MS = 1500;

/** Canary journey success target for the 24h burn-rate window (declared). */
export const CANARY_SUCCESS_TARGET = 0.99;

/** checkKey of the canary's summary row in synthetic_check_runs. */
export const CANARY_CHECK_KEY = "persona_journey";

// ─── Sensor wiring: DERIVED, never declared ──────────────────────────────────

/**
 * The table sensors the register may name, mapped to the REAL drizzle table
 * objects. An unknown source string cannot resolve — fails closed.
 */
const SENSOR_TABLES = {
  api_telemetry_samples: apiTelemetrySamples,
  uptime_samples: uptimeSamples,
  synthetic_check_runs: syntheticCheckRuns,
} as const;

/**
 * Is this sensor reference backed by a real artifact TODAY? Job sensors must
 * name a JOB_ROSTER entry (so failure/absence actually dispatches through
 * resolveFailureLane); table sensors must name a known schema table. A
 * register row that names anything else is "declared, not yet sensed".
 */
export function resolveSensorWired(ref: SloSensorRef): boolean {
  switch (ref.kind) {
    case "job_failure_lane":
      return JOB_ROSTER.some((e) => e.name === ref.source);
    case "api_latency_samples":
      return (
        SENSOR_TABLES[ref.source as keyof typeof SENSOR_TABLES] ===
        apiTelemetrySamples
      );
    case "uptime_probe":
      return (
        SENSOR_TABLES[ref.source as keyof typeof SENSOR_TABLES] === uptimeSamples
      );
    case "synthetic_journey":
      return (
        SENSOR_TABLES[ref.source as keyof typeof SENSOR_TABLES] ===
          syntheticCheckRuns &&
        JOB_ROSTER.some((e) => e.name === "persona_journey_canary")
      );
    default:
      return false;
  }
}

/**
 * Pure assembly step, pinned by tests/unit/sloRegister.test.ts: an UNWIRED row
 * can never carry a reading, whatever a caller passes. This is the structural
 * "no fabricated current-values" guarantee.
 */
export function assemblePublicRow(
  row: SloRegisterRow,
  wired: boolean,
  current: SloCurrentReading | null,
): PublicSloRow {
  return { ...row, wired, current: wired ? current : null };
}

// ─── Current readings — real queries or null, nothing else ───────────────────

async function readJobLaneCurrent(jobName: string): Promise<SloCurrentReading | null> {
  const [last] = await db
    .select({ status: jobHealthLogs.status, at: jobHealthLogs.runStartedAt })
    .from(jobHealthLogs)
    .where(eq(jobHealthLogs.jobName, jobName))
    .orderBy(desc(jobHealthLogs.runStartedAt))
    .limit(1);
  if (!last) return null; // no recorded runs → no reading, honestly
  const [failed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobHealthLogs)
    .where(
      and(
        eq(jobHealthLogs.jobName, jobName),
        eq(jobHealthLogs.status, "failed"),
        gte(jobHealthLogs.runStartedAt, new Date(Date.now() - DAY_MS)),
      ),
    );
  const failed24h = Number(failed?.n ?? 0);
  return {
    label: `${jobName} (last recorded run — successes sampled hourly · failures 24h)`,
    value: `${last.status} · ${failed24h} failed run${failed24h === 1 ? "" : "s"} in 24h`,
    asOf: last.at ? new Date(last.at).toISOString() : null,
  };
}

async function readDoorsLatencyCurrent(): Promise<SloCurrentReading | null> {
  const since = new Date(Date.now() - DAY_MS);
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${apiTelemetrySamples.count2xx} + ${apiTelemetrySamples.count4xx} + ${apiTelemetrySamples.count5xx}), 0)::bigint`,
      meeting: sql<number>`coalesce(sum(case when ${apiTelemetrySamples.p95Ms} <= ${DOORS_P95_TARGET_MS} then ${apiTelemetrySamples.count2xx} + ${apiTelemetrySamples.count4xx} + ${apiTelemetrySamples.count5xx} else 0 end), 0)::bigint`,
    })
    .from(apiTelemetrySamples)
    .where(gte(apiTelemetrySamples.windowEnd, since));
  const total = Number(row?.total ?? 0);
  if (total === 0) return null; // no traffic recorded → no reading
  const meeting = Number(row?.meeting ?? 0);
  const pct = Math.round((meeting / total) * 1000) / 10;
  return {
    label: `p95 ≤ ${DOORS_P95_TARGET_MS} ms attainment, request-weighted (24h)`,
    value: `${pct}% of API traffic in sample windows meeting the target`,
    asOf: null, // rolling window
  };
}

async function readPortalUptimeCurrent(): Promise<SloCurrentReading | null> {
  const now = Date.now();
  const since = new Date(now - THIRTY_DAYS_MS);
  const readSource = async (source: string): Promise<number | null> => {
    const rows = await db
      .select({ at: uptimeSamples.at })
      .from(uptimeSamples)
      .where(and(gte(uptimeSamples.at, since), eq(uptimeSamples.source, source)))
      .orderBy(uptimeSamples.at);
    // The expected cadence is PER SOURCE: the worker heartbeat posts every
    // minute (computeUptimePct's default), but the outside-in probe is a
    // 5-minute GitHub cron — scoring it against the 60s default counted
    // every healthy probe gap as ~4 minutes of downtime, so a perfectly
    // healthy system computed ~20% uptime on the PUBLIC status page
    // (fleet-7 verifier catch). Grace stays 3× the interval, which also
    // absorbs GitHub's best-effort cron jitter.
    return computeUptimePct(
      rows.map((r) => r.at.getTime()),
      source === "external" ? { now, expectedIntervalMs: 5 * 60_000 } : { now },
    );
  };
  // Outside-in probe is the measure of record when it has data; the worker
  // heartbeat is a labelled fallback, never passed off as a web SLA.
  const external = await readSource("external");
  if (external != null) {
    return {
      label: "measured uptime, outside-in probe (30d)",
      value: `${external}%`,
      asOf: null,
    };
  }
  const worker = await readSource("worker");
  if (worker != null) {
    return {
      label: "worker-liveness uptime (30d) — not an outside-in web measure",
      value: `${worker}%`,
      asOf: null,
    };
  }
  return null; // not enough samples for an honest claim
}

async function readCurrentForRow(row: SloRegisterRow): Promise<SloCurrentReading | null> {
  try {
    switch (row.sensor.kind) {
      case "job_failure_lane":
        return await readJobLaneCurrent(row.sensor.source);
      case "api_latency_samples":
        return await readDoorsLatencyCurrent();
      case "uptime_probe":
        return await readPortalUptimeCurrent();
      case "synthetic_journey":
        return null; // the canary surfaces through the dedicated canary block
      default:
        return null;
    }
  } catch (err) {
    // A failed sensor read renders as absent, never as a stale/invented value.
    logger.warn(
      `[slo] sensor read failed for ${row.surfaceClass}`,
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

// ─── The persona-journey canary ──────────────────────────────────────────────

export interface CanaryRunResult extends CanaryRunPublic {
  totalLatencyMs: number;
}

const STATUS_RANK: Record<CanaryStepStatus, number> = {
  ok: 0,
  degraded: 1,
  failing: 2,
};

function worstStatus(steps: CanaryStepPublic[]): CanaryStepStatus {
  return steps.reduce<CanaryStepStatus>(
    (worst, s) => (STATUS_RANK[s.status] > STATUS_RANK[worst] ? s.status : worst),
    "ok",
  );
}

async function timedStep(
  key: string,
  label: string,
  fn: () => Promise<{ status: CanaryStepStatus; detail?: string }>,
): Promise<CanaryStepPublic> {
  const start = Date.now();
  try {
    const r = await fn();
    return { key, label, status: r.status, latencyMs: Date.now() - start, detail: r.detail };
  } catch (err) {
    // The raw exception goes to the LOGS only. Step details are persisted to
    // synthetic_check_runs and re-served on the PUBLIC /api/status payload,
    // so an err.message here (which can carry connection strings, hostnames,
    // SQL fragments) must never enter the record (fleet-7 verifier catch).
    // Honest authored annotations (a step RETURNING status+detail) pass
    // through untouched — only exception text is withheld.
    logger.warn("[slo] canary step threw", {
      metadata: { step: key, error: err instanceof Error ? err.message : String(err) },
    });
    return {
      key,
      label,
      status: "failing",
      latencyMs: Date.now() - start,
      detail: "step failed — details in server logs",
    };
  }
}

/**
 * Walk the journey and persist per-step + summary rows to
 * synthetic_check_runs. Called by the persona_journey_canary job
 * (server/jobs/reliabilityCanaries.ts).
 */
export async function runPersonaJourneyCanary(): Promise<CanaryRunResult> {
  const steps: CanaryStepPublic[] = [];
  // Heavy imports stay dynamic: the demo-org resolver drags the storage layer,
  // which unit tests importing this module must not pay for.
  const { resolveDemoOrg } = await import("../routes-demo");
  const { isOrgSimulated } = await import("../utils/simulationMode");
  const { SAMPLE_LEAD_SOURCE, SAMPLE_APN_PREFIX } = await import(
    "./onboarding/sampleMarkers"
  );

  // Resolve OUTSIDE a closure so TS control flow can narrow the union.
  type DemoResolution = Awaited<ReturnType<typeof resolveDemoOrg>>;
  let resolution: DemoResolution | null = null;
  {
    const start = Date.now();
    const label = "Resolve the public demo workspace";
    try {
      resolution = await resolveDemoOrg();
      steps.push({
        key: "demo_resolve",
        label,
        status: "ok",
        latencyMs: Date.now() - start,
        detail: resolution.provisioned
          ? "provisioned"
          : `not provisioned (${resolution.reason}) — journey recorded as platform_only`,
      });
    } catch (err) {
      // Same public-boundary rule as timedStep: exception text stays in the
      // logs; the persisted/served record carries a fixed honest string.
      logger.warn("[slo] canary demo_resolve threw", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      steps.push({
        key: "demo_resolve",
        label,
        status: "failing",
        latencyMs: Date.now() - start,
        detail: "step failed — details in server logs",
      });
    }
  }

  const substrate: CanaryRunPublic["substrate"] = resolution?.provisioned
    ? "demo_org"
    : "platform_only";

  if (resolution?.provisioned) {
    const org = resolution.org;

    steps.push(
      await timedStep(
        "workspace_read",
        "Read the sample-marked demo workspace (leads + properties)",
        async () => {
          const { storage } = await import("../storage");
          const [allLeads, allProperties] = await Promise.all([
            storage.getLeads(org.id),
            storage.getProperties(org.id),
          ]);
          const sampleLeads = allLeads.filter((l) => l.source === SAMPLE_LEAD_SOURCE).length;
          const sampleProperties = allProperties.filter(
            (p) => typeof p.apn === "string" && p.apn.startsWith(SAMPLE_APN_PREFIX),
          ).length;
          if (sampleLeads === 0 && sampleProperties === 0) {
            return {
              status: "degraded",
              detail: "demo org designated but no sample fixtures seeded yet",
            };
          }
          return { status: "ok", detail: `${sampleLeads} sample leads · ${sampleProperties} sample properties` };
        },
      ),
    );

    steps.push(
      await timedStep(
        "sample_row_roundtrip",
        "Create + hard-delete a sample-marked sentinel row",
        async () => {
          if (!isOrgSimulated(org)) {
            // Refuse, don't write: the canary never mutates a non-simulated org.
            return {
              status: "degraded",
              detail: "refused — demo org is not in simulationMode; canary will not write",
            };
          }
          const [row] = await db
            .insert(leads)
            .values({
              organizationId: org.id,
              firstName: "Canary",
              lastName: "Journey Probe",
              source: SAMPLE_LEAD_SOURCE,
              notes: "Synthetic canary sentinel — created and deleted in the same step.",
            })
            .returning({ id: leads.id });
          if (!row?.id) throw new Error("sentinel insert returned no id");
          // Hard delete of the canary's OWN sentinel (sample-marked, same org,
          // same run) — soft-delete would accumulate rows forever.
          await db
            .delete(leads)
            .where(and(eq(leads.id, row.id), eq(leads.organizationId, org.id)));
          return { status: "ok" };
        },
      ),
    );
  } else {
    steps.push(
      await timedStep(
        "platform_read",
        "Read latest platform check (deepest journey without the demo org)",
        async () => {
          await db
            .select({ id: syntheticCheckRuns.id })
            .from(syntheticCheckRuns)
            .orderBy(desc(syntheticCheckRuns.runAt))
            .limit(1);
          return { status: "ok" };
        },
      ),
    );
  }

  const overallStatus = worstStatus(steps);
  const totalLatencyMs = steps.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0);
  const at = new Date().toISOString();

  // Persist per-step + summary rows to the EXISTING synthetic_check_runs table
  // (best-effort — a persistence failure must not crash the canary itself).
  try {
    for (const s of steps) {
      await db.insert(syntheticCheckRuns).values({
        checkKey: `journey_${s.key}`,
        status: s.status,
        latencyMs: s.latencyMs,
        errorMessage: s.status === "failing" ? s.detail ?? null : null,
        metadata: { journey: CANARY_CHECK_KEY, substrate, detail: s.detail ?? null },
      });
    }
    await db.insert(syntheticCheckRuns).values({
      checkKey: CANARY_CHECK_KEY,
      status: overallStatus,
      latencyMs: totalLatencyMs,
      errorMessage: null,
      metadata: {
        substrate,
        steps: steps.map((s) => ({
          key: s.key,
          label: s.label,
          status: s.status,
          latencyMs: s.latencyMs,
          detail: s.detail ?? null,
        })),
      },
    });
  } catch (err) {
    logger.warn(
      "[slo] canary persistence failed",
      err instanceof Error ? err : undefined,
    );
  }

  return { at, overallStatus, substrate, steps, totalLatencyMs };
}

// ─── Canary history + error-budget seam ──────────────────────────────────────

async function readCanaryLastRun(): Promise<CanaryRunPublic | null> {
  const [row] = await db
    .select({
      runAt: syntheticCheckRuns.runAt,
      status: syntheticCheckRuns.status,
      metadata: syntheticCheckRuns.metadata,
    })
    .from(syntheticCheckRuns)
    .where(eq(syntheticCheckRuns.checkKey, CANARY_CHECK_KEY))
    .orderBy(desc(syntheticCheckRuns.runAt))
    .limit(1);
  if (!row) return null;
  const meta = (row.metadata ?? {}) as {
    substrate?: string;
    steps?: Array<{
      key?: string;
      label?: string;
      status?: string;
      latencyMs?: number | null;
      detail?: string | null;
    }>;
  };
  const steps: CanaryStepPublic[] = Array.isArray(meta.steps)
    ? meta.steps.map((s) => ({
        key: String(s.key ?? "unknown"),
        label: String(s.label ?? s.key ?? "unknown"),
        status: (["ok", "degraded", "failing"].includes(String(s.status))
          ? s.status
          : "failing") as CanaryStepStatus,
        latencyMs: typeof s.latencyMs === "number" ? s.latencyMs : null,
        detail: s.detail ?? undefined,
      }))
    : [];
  return {
    at: new Date(row.runAt).toISOString(),
    overallStatus: (["ok", "degraded", "failing"].includes(row.status)
      ? row.status
      : "failing") as CanaryStepStatus,
    substrate: meta.substrate === "demo_org" ? "demo_org" : "platform_only",
    steps,
  };
}

/**
 * The error-budget seam over the canary's RECORDED history: reuses the house
 * burn-rate math (reliability/sloCompute.computeBurnRateWindow) so "burn" has
 * exactly one definition platform-wide. Null burn when there is no history.
 * (The P5 "burning budget pauses Phase work" POLICY is a founder decision and
 * is deliberately NOT encoded here.)
 */
async function readCanaryWindow24h(): Promise<CanaryWindowPublic | null> {
  const since = new Date(Date.now() - DAY_MS);
  const [row] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      failing: sql<number>`sum(case when ${syntheticCheckRuns.status} = 'failing' then 1 else 0 end)::int`,
    })
    .from(syntheticCheckRuns)
    .where(
      and(
        eq(syntheticCheckRuns.checkKey, CANARY_CHECK_KEY),
        gte(syntheticCheckRuns.runAt, since),
      ),
    );
  const runs = Number(row?.runs ?? 0);
  if (runs === 0) return null; // no history → no window, no invented burn
  const failing = Number(row?.failing ?? 0);
  const burn = computeBurnRateWindow({
    sloId: "persona_journey_success",
    target: CANARY_SUCCESS_TARGET,
    windowMs: DAY_MS,
    windowLabel: "24h",
    total: runs,
    failed: failing,
  });
  return { runs, failing, burnRate: burn.burnRate };
}

// ─── Public assembly (cached — /api/status is polled every 30s per viewer) ───

let cache: { at: number; value: PublicSloStatus } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getPublicSloStatus(): Promise<PublicSloStatus> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const rows: PublicSloRow[] = [];
  for (const row of SLO_REGISTER) {
    const wired = resolveSensorWired(row.sensor);
    // Unwired rows never even attempt a reading; assemblePublicRow enforces
    // the same invariant structurally on the way out.
    const current = wired ? await readCurrentForRow(row) : null;
    rows.push(assemblePublicRow(row, wired, current));
  }

  let lastRun: CanaryRunPublic | null = null;
  let window24h: CanaryWindowPublic | null = null;
  try {
    [lastRun, window24h] = await Promise.all([
      readCanaryLastRun(),
      readCanaryWindow24h(),
    ]);
  } catch (err) {
    logger.warn(
      "[slo] canary history read failed",
      err instanceof Error ? err : undefined,
    );
  }

  const value: PublicSloStatus = {
    generatedAt: new Date().toISOString(),
    rows,
    canary: { lastRun, window24h },
  };
  cache = { at: Date.now(), value };
  return value;
}
