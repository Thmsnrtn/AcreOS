/**
 * jobRegistry.ts — the canonical roster of every scheduled background job,
 * lifted from the `withJobLock('...')` literals in runScheduledJobs.ts.
 *
 * Why this file exists (Tess — "a job silently went dark")
 * ───────────────────────────────────────────────────────
 * The worker runs ~116 distinct `withJobLock` jobs. Three health systems
 * existed (jobHealthLogs, burnRateMonitor/sloCompute, autonomousHealthMonitor)
 * but EVERY one keys on rows that EXIST, not rows that SHOULD exist:
 *   - jobHealthLogs only writes on failed / skipped_lock / sampled-success
 *     (success is sampled 1/hr per process) — a job that stops registering
 *     never writes another row, and nothing notices the absence.
 *   - burnRateMonitor / sloCompute gate on `totalEvents > 0`, so a vanished
 *     job never burns its budget.
 *   - autonomousHealthMonitor GROUPs BY jobName, so a missing job simply
 *     isn't in the result set.
 * None of them is a DEADMAN — none asks "which jobs that I EXPECT to have
 * run recently have gone quiet?" This roster is that expectation set.
 *
 * `runJobDeadmanCheck()` (in deadmanCheck.ts) walks this roster and pages
 * on-call when a non-disabled job hasn't emitted ANY job_health_logs row
 * (success | failed | skipped_lock | timeout) within 2× its expected
 * cadence.
 *
 * intervalMs is the EFFECTIVE WORK cadence, not the setInterval tick cadence
 * ──────────────────────────────────────────────────────────────────────────
 * Many jobs tick every 5 min but only call `withJobLock` inside a wall-clock
 * guard (e.g. `if (now.getUTCHours() === 7) withJobLock('customer_health', …)`).
 * On the other 287 ticks/day the guard returns BEFORE `withJobLock`, so NO
 * job_health_logs row is written. The liveness cadence is therefore the
 * wall-clock cadence (daily / weekly / monthly), NOT the tick interval. Using
 * the 5-min tick as the deadman interval would false-page constantly; using
 * the work cadence is correct. Each entry's intervalMs reflects how often the
 * job actually reaches `withJobLock`.
 *
 * `critical` → P1 page on absence; non-critical → P2. A finding is recorded in
 * the domain-audit `reliability` domain either way (degrades gracefully when
 * the on-call webhook secret is unset).
 *
 * Keep in sync: when a `withJobLock('foo', …)` is added/removed/retimed in
 * runScheduledJobs.ts, update the matching roster entry here. The
 * `jobRosterCoverage` unit test asserts every withJobLock literal has a roster
 * entry and vice-versa so drift is caught in CI.
 */

export interface JobRosterEntry {
  /** Logical job name — MUST match the `withJobLock('<name>', …)` literal. */
  name: string;
  /**
   * Effective work cadence in ms — how often the job actually reaches
   * `withJobLock` (the wall-clock cadence for time-gated jobs, the tick
   * interval for free-running jobs). The deadman threshold is 2× this.
   */
  intervalMs: number;
  /** true → page P1 on absence; false → P2. */
  critical: boolean;
  /**
   * Optional predicate, evaluated at deadman-run time. When it returns true
   * the job is treated as intentionally off (env kill-switch / not-production)
   * and is SKIPPED — never paged as dark. Reads the exact env vars the
   * registration site reads.
   */
  disabledWhen?: () => boolean;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

/**
 * The roster. 118 entries: the 116 distinct `withJobLock` jobs registered in
 * runScheduledJobs.ts, plus the two jobs added in this same change —
 * `audit_chain_verify` (Quinn-F2 weekly chain-integrity verifier) and
 * `job_deadman_monitor` (this very monitor, so it watches itself). Derived by
 * reading every registration site for its effective cadence + criticality.
 *
 * `critical: true` is reserved for jobs whose silent death directly harms a
 * customer, loses money, breaks compliance, or blinds on-call:
 *   billing/dunning/reconciliation, compliance (OFAC/sanctions/fair-lending/
 *   disclosure/periodic-statements/access-review), the alerting + health +
 *   external-status + synthetic + burn-rate + data-source watchdogs, the
 *   customer-facing autopilots (Pax scheduler/nudges, deal machine, churn,
 *   trial, onboarding, recourse), backups/retention, and the audit-chain
 *   verifier. Everything else (self-improvement, digests, internal audits,
 *   prewarm/discovery) is non-critical → P2.
 */
export const JOB_ROSTER: JobRosterEntry[] = [
  // ── Customer-facing autopilots & lead/marketing (env-gated AI jobs) ────────
  // LEAD_NURTURING_AI_DISABLED=1 skips registration entirely (Iris cost switch).
  { name: "lead_nurturing", intervalMs: 15 * MIN, critical: false,
    disabledWhen: () => process.env.LEAD_NURTURING_AI_DISABLED === "1" },
  // CAMPAIGN_OPTIMIZER_AI_DISABLED=1 skips registration entirely.
  { name: "campaign_optimizer", intervalMs: HOUR, critical: false,
    disabledWhen: () => process.env.CAMPAIGN_OPTIMIZER_AI_DISABLED === "1" },
  // AUTONOMOUS_DECISION_EXECUTOR_DISABLED=1 skips registration entirely.
  { name: "autonomous_decision_executor", intervalMs: 30 * MIN, critical: false,
    disabledWhen: () => process.env.AUTONOMOUS_DECISION_EXECUTOR_DISABLED === "1" },

  { name: "finance_agent", intervalMs: 30 * MIN, critical: false },
  { name: "api_queue", intervalMs: 10 * 1000, critical: false },
  { name: "alerting", intervalMs: HOUR, critical: true },
  { name: "digest", intervalMs: 6 * HOUR, critical: false },
  { name: "domain_audit", intervalMs: DAY, critical: false },
  { name: "scheduled_tasks", intervalMs: MIN, critical: true },
  { name: "pax_scheduler", intervalMs: MIN, critical: true },
  { name: "pax_nudges", intervalMs: 6 * HOUR, critical: true },
  { name: "voice_learning_refresh", intervalMs: 12 * HOUR, critical: false },
  { name: "autonomous_deal_machine", intervalMs: HOUR, critical: true },
  { name: "autonomous_health_monitor", intervalMs: HOUR, critical: true },
  { name: "customer_concentration", intervalMs: DAY, critical: false },
  { name: "customer_unit_economics", intervalMs: DAY, critical: false },
  { name: "api_telemetry_rollup", intervalMs: DAY, critical: false },
  { name: "reserve_floor_check", intervalMs: DAY, critical: true },
  { name: "parcel_delta_detector", intervalMs: 6 * HOUR, critical: false },
  { name: "founder_weekly_digest", intervalMs: WEEK, critical: false },
  { name: "cost_optimizer_weekly_digest", intervalMs: WEEK, critical: false },
  { name: "growth_automation", intervalMs: 6 * HOUR, critical: false },
  { name: "churn_engine_daily", intervalMs: DAY, critical: true },
  { name: "founder_briefing_daily", intervalMs: DAY, critical: false },
  { name: "atlas_morning_brief_daily", intervalMs: DAY, critical: true },
  { name: "error_boundary_spike_detect", intervalMs: 15 * MIN, critical: true },
  { name: "outcome_analyzer", intervalMs: DAY, critical: false },
  { name: "telemetry_optimizer", intervalMs: DAY, critical: false },
  { name: "model_intelligence", intervalMs: WEEK, critical: false },
  { name: "self_assessment", intervalMs: WEEK, critical: false },
  { name: "evolution_pipeline", intervalMs: 6 * HOUR, critical: false },
  { name: "codebase_monitor", intervalMs: DAY, critical: false },
  { name: "telemetry_digest", intervalMs: WEEK, critical: false },
  { name: "multi_week_planner", intervalMs: WEEK, critical: false },
  { name: "personality_drift", intervalMs: WEEK, critical: false },
  { name: "trial_engine", intervalMs: DAY, critical: true },
  { name: "customer_health", intervalMs: DAY, critical: true },
  { name: "onboarding_scheduler", intervalMs: DAY, critical: true },
  { name: "data_retention", intervalMs: DAY, critical: true },
  { name: "access_review_quarterly", intervalMs: DAY, critical: true },
  { name: "prompt_evolution_monthly", intervalMs: MONTH, critical: false },
  { name: "outcome_driven_evolution_nightly", intervalMs: DAY, critical: false },
  { name: "experiment_sweep_weekly", intervalMs: WEEK, critical: false },
  { name: "agent_memory_consolidation_weekly", intervalMs: WEEK, critical: false },
  { name: "expansion_radar_weekly", intervalMs: WEEK, critical: false },
  { name: "onboarding_sweeper", intervalMs: HOUR, critical: true },
  { name: "customer_letters_monthly", intervalMs: HOUR, critical: false },
  { name: "action_preview_sweeper", intervalMs: HOUR, critical: false },
  { name: "strategic_proposals_weekly", intervalMs: WEEK, critical: false },
  { name: "strategic_proposals_monthly_synthesis", intervalMs: MONTH, critical: false },
  { name: "founder_letter_monthly", intervalMs: MONTH, critical: false },
  { name: "autonomy_outcome_grader", intervalMs: DAY, critical: false },
  { name: "company_briefing_generator", intervalMs: DAY, critical: false },
  { name: "periodic_statements_monthly", intervalMs: MONTH, critical: true },
  { name: "trust_evolution", intervalMs: WEEK, critical: false },
  { name: "agent_reaction_processor", intervalMs: 2 * MIN, critical: false },
  { name: "agent_proactive_engine", intervalMs: 5 * MIN, critical: false },
  { name: "v5_maintenance", intervalMs: 15 * MIN, critical: false },
  { name: "pax_continuous_audit", intervalMs: DAY, critical: false },
  { name: "transparency_report_aggregation", intervalMs: DAY, critical: false },

  // ── Solene (COO) self-loop ─────────────────────────────────────────────────
  { name: "solene_audit_per_week", intervalMs: WEEK, critical: false },
  { name: "solene_audit_per_session", intervalMs: HOUR, critical: false },
  { name: "solene_morning_pulse", intervalMs: DAY, critical: false },
  { name: "solene_continuous_tick", intervalMs: 30 * MIN, critical: false },
  { name: "solene_agent_claims_expiry", intervalMs: 5 * MIN, critical: false },
  { name: "solene_team_state_regenerator", intervalMs: 15 * MIN, critical: false },
  { name: "solene_weekly_retro", intervalMs: WEEK, critical: false },
  { name: "solene_failure_modes_seed", intervalMs: DAY, critical: false },
  { name: "team_system_audit_weekly", intervalMs: WEEK, critical: false },
  { name: "team_system_audit_continuous", intervalMs: HOUR, critical: false },

  // ── Compliance / sanctions (customer-blocking if dark) ─────────────────────
  { name: "ofac_sdn_refresh", intervalMs: DAY, critical: true },
  { name: "sanctions_list_entries_sync", intervalMs: DAY, critical: true },

  // ── Tess infra / data ──────────────────────────────────────────────────────
  { name: "index_analyzer", intervalMs: DAY, critical: false },
  { name: "land_credit_score_recalc", intervalMs: DAY, critical: false },
  { name: "feature_engineering", intervalMs: WEEK, critical: false },
  { name: "db_backup", intervalMs: DAY, critical: true },
  { name: "course_completion_check", intervalMs: DAY, critical: false },

  // ── Per-member continuous audits ───────────────────────────────────────────
  { name: "krieger_mobile_feel_audit", intervalMs: 30 * MIN, critical: false },
  { name: "iris_perf_monitor", intervalMs: 30 * MIN, critical: false },
  { name: "soren_seo_tracker", intervalMs: DAY, critical: false },
  { name: "anthropic_watch", intervalMs: DAY, critical: false },
  { name: "daily_ai_cost_guard", intervalMs: DAY, critical: true },
  { name: "npm_watch", intervalMs: DAY, critical: false },
  { name: "model_upgrade_backfill", intervalMs: DAY, critical: false },
  { name: "beatrice_reg_watch", intervalMs: DAY, critical: false },
  { name: "nps_prompt_scheduler", intervalMs: DAY, critical: false },
  { name: "recourse_sweep", intervalMs: 30 * MIN, critical: true },
  { name: "resume_expired_pauses", intervalMs: HOUR, critical: true },
  { name: "data_source_probe", intervalMs: 30 * MIN, critical: true },
  { name: "burn_rate_monitor", intervalMs: 5 * MIN, critical: true },

  // ── Health / external monitors ─────────────────────────────────────────────
  { name: "health_check_periodic", intervalMs: MIN, critical: true },
  { name: "external_status_monitor", intervalMs: 5 * MIN, critical: true },

  // ── Final-mile autonomy ────────────────────────────────────────────────────
  { name: "daily_autonomous_summary", intervalMs: DAY, critical: false },
  { name: "check_delegation_completions", intervalMs: 15 * MIN, critical: false },
  { name: "retry_failed_actions", intervalMs: 30 * MIN, critical: true },
  { name: "execute_resolved_consensus", intervalMs: 5 * MIN, critical: false },
  { name: "weekly_alert_digest", intervalMs: WEEK, critical: false },

  // ── Billing / dunning / reconciliation ─────────────────────────────────────
  { name: "dunning_tasks", intervalMs: 6 * HOUR, critical: true },
  // fly_night_mode is only registered in production w/ FLY_API_TOKEN set.
  { name: "fly_night_mode", intervalMs: 5 * MIN, critical: false,
    disabledWhen: () =>
      process.env.NODE_ENV !== "production" || !process.env.FLY_API_TOKEN },
  { name: "synthetic_checks", intervalMs: 15 * MIN, critical: true },
  { name: "reconciliation_cron", intervalMs: DAY, critical: true },
  { name: "disclosure_timing_dispatch", intervalMs: HOUR, critical: true },
  { name: "fair_lending_audit", intervalMs: MONTH, critical: true },

  // ── Agent initiative / verification / discovery ────────────────────────────
  { name: "agent_initiative_engine", intervalMs: 30 * MIN, critical: false },
  { name: "outcome_verification", intervalMs: DAY, critical: false },
  { name: "county_endpoint_discovery", intervalMs: WEEK, critical: false },
  { name: "county_discovery_queue_drain", intervalMs: 30 * MIN, critical: false },
  { name: "land_profile_prewarm", intervalMs: 15 * MIN, critical: false },
  { name: "stripe_drift_detector", intervalMs: DAY, critical: true },
  { name: "vendor_secret_rotation", intervalMs: DAY, critical: false },
  { name: "agent_retract_cron", intervalMs: DAY, critical: false },
  { name: "pillar_reviewer", intervalMs: MONTH, critical: false },
  { name: "schema_drift_detector", intervalMs: DAY, critical: false },
  { name: "dlq_poison_job_surfacer", intervalMs: HOUR, critical: true },
  { name: "archival_sweep", intervalMs: DAY, critical: false },
  { name: "redemption_clock_refresh", intervalMs: DAY, critical: true },

  // ── Quinn F2 — audit-chain integrity verifier (added in this change) ───────
  // Weekly walk of the global audit_events hash chain. Not a withJobLock job
  // in the legacy sense — it's the new scheduleSelfRescheduling job registered
  // alongside the deadman. Listed here so the deadman watches the watcher.
  { name: "audit_chain_verify", intervalMs: WEEK, critical: true },

  // ── The deadman itself (added in this change) ──────────────────────────────
  // The deadman watches the deadman: a surviving worker generation will page if
  // the monitor's own withJobLock liveness goes quiet. (If EVERY worker is
  // down, the external worker-heartbeat probe is the backstop.)
  { name: "job_deadman_monitor", intervalMs: 5 * MIN, critical: true },
];

/** Roster entries that are NOT currently disabled by their env predicate. */
export function activeRosterEntries(): JobRosterEntry[] {
  return JOB_ROSTER.filter((e) => !(e.disabledWhen?.() ?? false));
}
