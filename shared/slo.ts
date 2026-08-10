/**
 * O4 (P5 §2 — "promises with sensors") — the SLO REGISTER as data.
 *
 * The product's reliability promises differ in KIND, so they are declared per
 * surface class, not as one number. Four classes (handoff P5 §2.1):
 *
 *   send_lanes              — correctness-then-timeliness; zero compliance-gate
 *                             bypasses, ever
 *   five_doors              — interactive latency behind Today/Map/Deals/
 *                             Finance/Pax
 *   portals                 — availability for borrowers/tenants who aren't
 *                             our customers
 *   background_intelligence — honest freshness (staleness surfaced, never
 *                             papered over)
 *
 * HONESTY CONTRACT (refuse-not-fabricate):
 *   - `target` is a DECLARED goal, labelled as such — never presented as a
 *     measurement.
 *   - Each row names exactly ONE machine-checkable sensor reference. Whether
 *     that sensor is WIRED is *derived* in server/services/slo.ts from the
 *     real artifacts (JOB_ROSTER membership, schema tables) — never declared
 *     here, so a row naming a nonexistent sensor can only render as
 *     "declared, not yet sensed" (and tests/unit/sloRegister.test.ts fails).
 *   - `notYetSensed` lists the aspects of the promise that have NO live
 *     sensor today. They render as honestly absent, not as numbers.
 *   - Current readings (PublicSloRow.current) are assembled server-side from
 *     real telemetry rows only; a row without a wired sensor NEVER carries a
 *     reading (pinned by sloRegister.test.ts).
 *
 * Shared (not server-only) because the /status page imports the payload types.
 */

export type SloSurfaceClass =
  | "send_lanes"
  | "five_doors"
  | "portals"
  | "background_intelligence";

export type SloSensorKind =
  /** A JOB_ROSTER job whose runs/failures land in job_health_logs and whose
   *  absence the deadman dispatches via resolveFailureLane. */
  | "job_failure_lane"
  /** Durable per-route latency windows (api_telemetry_samples, L14). */
  | "api_latency_samples"
  /** uptime_samples heartbeats — outside-in probe preferred, worker fallback. */
  | "uptime_probe"
  /** synthetic_check_runs rows written by a scheduled canary. */
  | "synthetic_journey";

export interface SloSensorRef {
  kind: SloSensorKind;
  /**
   * Machine-checkable name: a JOB_ROSTER job name for `job_failure_lane`,
   * otherwise the exact pg table name. Resolution (server/services/slo.ts
   * resolveSensorWired) fails closed: unknown name ⇒ not wired.
   */
  source: string;
  /** What the sensor actually measures — precisely, so nobody over-reads it. */
  senses: string;
}

export interface SloRegisterRow {
  surfaceClass: SloSurfaceClass;
  /** Display name for the surface class. */
  name: string;
  /** The promise, in customer language. */
  promise: string;
  /** The DECLARED target. A goal, not a measurement. */
  target: string;
  sensor: SloSensorRef;
  /** Promise aspects with NO live sensor today — rendered as honestly absent. */
  notYetSensed: string[];
}

/**
 * THE register. Exactly one row per surface class.
 * Sensor sources must resolve against real artifacts — see sloRegister.test.ts.
 */
export const SLO_REGISTER: readonly SloRegisterRow[] = [
  {
    surfaceClass: "send_lanes",
    name: "Send lanes (email · SMS · postal mail)",
    promise:
      "Correctness before timeliness: nothing dispatches without passing its compliance gates, and cleared messages leave promptly.",
    target:
      "Dispatch machinery green; zero compliance-gate bypasses — ever (declared target).",
    sensor: {
      kind: "job_failure_lane",
      source: "mail_flusher",
      senses:
        "The outbound mail flusher's recorded runs and failures (job_health_logs). It is a critical roster entry: failure or absence pages P1 via the deadman.",
    },
    notYetSensed: [
      "per-message dispatch success rate by lane",
      "a compliance-gate bypass counter (bypasses are structurally refused today, but not yet counted as a metric)",
    ],
  },
  {
    surfaceClass: "five_doors",
    name: "The five doors (Today · Map · Deals · Finance · Pax)",
    promise: "Signed-in customers get interactive latency behind every door.",
    target: "API p95 under 1500 ms (declared target).",
    sensor: {
      kind: "api_latency_samples",
      source: "api_telemetry_samples",
      senses:
        "Durable per-route p50/p95 latency windows flushed every minute by the API telemetry middleware (server API latency, a proxy for door interactivity).",
    },
    notYetSensed: [
      "client-perceived door render latency (no real-user monitoring yet)",
    ],
  },
  {
    surfaceClass: "portals",
    name: "Borrower & tenant portals",
    promise:
      "Portals stay reachable for the borrowers and tenants who aren't our customers but depend on them.",
    target: "99.9% availability over a rolling 30 days (declared target).",
    sensor: {
      kind: "uptime_probe",
      source: "uptime_samples",
      senses:
        "Uptime heartbeat samples: the outside-in probe (source 'external') when armed, otherwise worker-process liveness — each reading is labelled with which one it is.",
    },
    notYetSensed: [
      "a portal-specific probe (today's probe measures the shared app surface, not the portal routes in isolation)",
    ],
  },
  {
    surfaceClass: "background_intelligence",
    name: "Background intelligence (enrichment · deltas · probes)",
    promise:
      "Background data stays honestly fresh — staleness is surfaced in-product, never papered over.",
    target:
      "Data-source probes green; probe failures always land as findings (declared target).",
    sensor: {
      kind: "job_failure_lane",
      source: "data_source_probe",
      senses:
        "The 30-minute data-source probe's recorded runs and failures (job_health_logs). It is a critical roster entry: failure or absence pages P1 via the deadman.",
    },
    notYetSensed: [
      "a single cross-source freshness-age rollup (freshness is currently shown per surface in-product)",
    ],
  },
];

// ─── Public payload types (assembled server-side, rendered by /status) ───────

export interface SloCurrentReading {
  /** What was measured, e.g. "p95 target attainment (24h)". */
  label: string;
  /** Pre-formatted value derived ONLY from real telemetry rows. */
  value: string;
  /** ISO timestamp of the newest underlying datum; null for rolling windows. */
  asOf: string | null;
}

export interface PublicSloRow extends SloRegisterRow {
  /** DERIVED from real artifacts — see resolveSensorWired. */
  wired: boolean;
  /** Real reading, or null (unwired sensor OR no data yet). Never invented. */
  current: SloCurrentReading | null;
}

export type CanaryStepStatus = "ok" | "degraded" | "failing";

export interface CanaryStepPublic {
  key: string;
  label: string;
  status: CanaryStepStatus;
  /** Measured wall-clock ms; null when the step was refused/skipped. */
  latencyMs: number | null;
  /** Honest annotation (e.g. why a step was refused). */
  detail?: string;
}

export interface CanaryRunPublic {
  at: string;
  overallStatus: CanaryStepStatus;
  /**
   * Which journey was actually walked: "demo_org" (the public demo workspace,
   * sample-marked data only) or "platform_only" (demo org not provisioned —
   * the deepest journey available without it, recorded honestly).
   */
  substrate: "demo_org" | "platform_only";
  steps: CanaryStepPublic[];
}

export interface CanaryWindowPublic {
  /** Canary runs recorded in the window. */
  runs: number;
  /** Runs whose overall status was "failing". */
  failing: number;
  /**
   * Error-budget burn rate over the window (observed failure fraction ÷
   * allowed fraction; 1.0 = exactly budget pace). Null when there is no
   * history — never fabricated.
   */
  burnRate: number | null;
}

export interface PublicSloStatus {
  generatedAt: string;
  rows: PublicSloRow[];
  canary: {
    lastRun: CanaryRunPublic | null;
    window24h: CanaryWindowPublic | null;
  };
}
