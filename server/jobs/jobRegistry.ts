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
  /**
   * OPTIONAL standard 5-field cron expression (min hour dom month dow, UTC) for
   * jobs whose cadence is a true wall-clock / calendar boundary (monthly on the
   * 1st, daily at a fixed hour, quarterly, etc.) rather than interval drift.
   *
   * ⚠️ NOT YET CONSUMED. This is pure declarative data — the deadman still uses
   * `intervalMs` as its (deadman/fallback) cadence, and the scheduler is
   * unchanged. `cron` is the data foundation for the deferred, multi-session
   * `scheduleSelfRescheduling` consolidation that will eventually drive a
   * roster-derived launcher (cron for calendar-anchored jobs, intervalMs as the
   * deadman/fallback cadence for everyone). Leave `cron` undefined for
   * interval-drift jobs (every-N-minutes pollers) — they have no wall-clock
   * anchor to express. Do NOT remove intervalMs when adding cron.
   */
  cron?: string;
  /** true → page P1 on absence; false → P2. */
  critical: boolean;
  /**
   * Optional predicate, evaluated at deadman-run time. When it returns true
   * the job is treated as intentionally off (env kill-switch / not-production)
   * and is SKIPPED — never paged as dark. Reads the exact env vars the
   * registration site reads.
   *
   * Tier 1E contract: every job that no-ops on missing config MUST declare
   * its dormancy here (predicate + human-readable disabledReason) — a job
   * body that silently skips without a roster-level disabledWhen is the
   * "wired but dark, nobody remembers" failure mode this field exists to
   * kill. The deadman's config-dormant meta-check (deadmanCheck.ts) lists
   * every currently-dormant CRITICAL job each sweep so dormancy stays
   * visible until the config lands.
   */
  disabledWhen?: () => boolean;
  /**
   * REQUIRED whenever disabledWhen is present: the human-readable reason the
   * job is dormant, including which env var / secret unblocks it (and 🔑 when
   * it's founder-provisioned). Surfaced verbatim by the deadman meta-check.
   */
  disabledReason?: string;
}

/**
 * Tier 1E — shared config predicate for the backup pipeline (db_backup daily
 * dump + backup_restore_verify weekly restore proof). Lives here (the only
 * dependency-free jobs module) so the roster, the job bodies, and unit tests
 * all evaluate ONE predicate instead of three drifting copies.
 * 🔑 FOUNDER: fly secrets set DB_BACKUP_S3_BUCKET=... AWS_ACCESS_KEY_ID=...
 * AWS_SECRET_ACCESS_KEY=... (see server/jobs/dbBackup.ts header).
 */
export function backupConfigMissingReason(): string | null {
  if (!process.env.DB_BACKUP_S3_BUCKET) {
    return "DB_BACKUP_S3_BUCKET unset — 🔑 founder must provision the backup bucket (fly secrets set DB_BACKUP_S3_BUCKET=...)";
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return "AWS credentials unset (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) — 🔑 founder must provision S3 credentials";
  }
  return null;
}

/**
 * Wave C ("Money moves") — shared config predicate for the borrower ACH
 * autopay cycle. Lives here (the only dependency-free jobs module) so the
 * roster entry, the job body, and unit tests evaluate ONE predicate instead
 * of three drifting copies — same arrangement as backupConfigMissingReason
 * above. Returns null when the cycle can actually move money.
 * 🔑 FOUNDER: STRIPE_SECRET_KEY must be provisioned; SIMULATION_MODE /
 * SIMULATION_MODE_STRIPE must be off.
 */
export function achAutopayDormantReason(): string | null {
  const on = (v: string | undefined) => {
    const t = (v || "").toLowerCase().trim();
    return t === "true" || t === "1" || t === "yes";
  };
  if (on(process.env.SIMULATION_MODE_STRIPE)) {
    return "SIMULATION_MODE_STRIPE is on — no ACH debit will be created.";
  }
  if (on(process.env.SIMULATION_MODE)) {
    return "SIMULATION_MODE is on — no ACH debit will be created.";
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return "STRIPE_SECRET_KEY unset — 🔑 founder must provision the Stripe key before borrower ACH autopay can debit.";
  }
  return null;
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
  // W5.1 — former bare setIntervals routed through the runtime (2026-07).
  // The task processor auto-executes agent actions: critical.
  { name: "autonomous_task_processor", intervalMs: 30 * 1000, critical: true },
  { name: "atlas_pending_confirmation_nudge", intervalMs: MIN, critical: false },
  // founder_digest took the job lock (job_health_logs rows existed) but was
  // never rostered — locked yet invisible to the deadman. Daily send window
  // gated inside an hourly tick; roster tracks the hourly tick.
  { name: "founder_digest", intervalMs: HOUR, critical: false },
  { name: "api_queue", intervalMs: 10 * 1000, critical: false },
  { name: "alerting", intervalMs: HOUR, critical: true },
  { name: "digest", intervalMs: 6 * HOUR, critical: false },
  { name: "domain_audit", intervalMs: DAY, critical: false },
  { name: "operator_cycle", intervalMs: DAY, critical: false },
  { name: "scheduled_tasks", intervalMs: MIN, critical: true },
  // Wave B: without this sweep every workflow parked on a long `delay` stops
  // forever mid-run, so its absence is a P1.
  { name: "workflow_delay_resume", intervalMs: MIN, critical: true },
  { name: "pax_scheduler", intervalMs: MIN, critical: true },
  { name: "pax_nudges", intervalMs: 6 * HOUR, critical: true },
  { name: "voice_learning_refresh", intervalMs: 12 * HOUR, critical: false },
  { name: "autonomous_deal_machine", intervalMs: HOUR, critical: true },
  { name: "autonomous_health_monitor", intervalMs: HOUR, critical: true },
  { name: "customer_concentration", intervalMs: DAY, critical: false },
  // Launch-Week WS4 — Gate-Watcher: daily 09:00 UTC evaluation of the
  // machine-encoded roadmap gates (mature-machine §4 + phase triggers).
  // Non-critical: a dark watcher delays a gate by days, it doesn't harm a
  // customer — and the deadman still surfaces the absence as P2.
  { name: "gate_watcher_daily", intervalMs: DAY, critical: false, cron: "0 9 * * *" },
  // Jarvis 2.1 (audit G2) — note payment due-date detector: daily 11:00 UTC
  // scan turning borrower payments due-soon/overdue into mesh events +
  // counts-only outward senses. Non-critical: a dark scan delays perception
  // by a day; the deadman still surfaces the absence.
  { name: "note_payment_due_scan", intervalMs: DAY, critical: false, cron: "0 11 * * *" },
  // Wave C "Money moves" — borrower ACH autopay cycle: hourly submit of due
  // debits (one per note+period, guarded by a unique claim) + reconciliation
  // of every in-flight debit into settlement or return. CRITICAL: this is the
  // only path that collects a borrower payment the portal has already
  // promised to collect automatically, and it is also the only path that
  // discovers ACH RETURNS (no webhook is wired — see
  // server/services/achAutopay.ts). A dark cycle means both uncollected money
  // and unnoticed NSFs, so its absence pages P1.
  {
    name: "ach_autopay_cycle",
    intervalMs: HOUR,
    critical: true,
    cron: "0 * * * *",
    disabledWhen: () => achAutopayDormantReason() !== null,
    disabledReason:
      "Borrower ACH autopay is dormant: either SIMULATION_MODE / SIMULATION_MODE_STRIPE is on (no debit may be created) or STRIPE_SECRET_KEY is unset — 🔑 founder must provision the Stripe key. Per-lender dormancy (Connect onboarding incomplete / us_bank_account_ach_payments not active) is refused per note and counted in the cycle's refusalsByReason.",
  },
  // Structural build B — acquired-note aging: the daily sweep that recomputes
  // next-due, days-delinquent and the performing/late/default band for the
  // acquired book, and is the only caller of the RESPA §1024.39 day-36
  // early-intervention flag. Non-critical: delinquency moves in days, so one
  // dark run costs a day of freshness rather than money — but the deadman must
  // still see it, because if this stops the whole book silently freezes at
  // whatever standing it last had, which reads as "everyone is current".
  { name: "acquired_note_aging", intervalMs: DAY, critical: false },
  // Horizon A5 — doctrine corpus ingest: daily 03:00 UTC walk of the repo
  // doctrine dirs into the 'doctrine' embedding namespace (hash-skip on
  // unchanged). Non-critical: a dark ingest delays memory freshness by a
  // day; the deadman surfaces the absence as P2 and corpusCompleteness()
  // shows the drift.
  { name: "doctrine_ingest_daily", intervalMs: DAY, critical: false, cron: "0 3 * * *" },
  // Horizon A5 — weekly connections sweep: Mondays 13:00 UTC, one read-only
  // self_audit_drift dispatch per ISO week (contradictions / forgotten
  // precedents / stale doctrine → findings blob + Letter paragraph, never an
  // interrupt). Non-critical: a missed week is recoverable next Monday.
  { name: "connections_sweep_weekly", intervalMs: WEEK, critical: false, cron: "0 13 * * 1" },
  { name: "customer_unit_economics", intervalMs: DAY, critical: false },
  { name: "api_telemetry_rollup", intervalMs: DAY, critical: false },
  { name: "reserve_floor_check", intervalMs: DAY, critical: true },
  { name: "parcel_delta_detector", intervalMs: 6 * HOUR, critical: false },
  { name: "founder_weekly_digest", intervalMs: WEEK, critical: false },
  { name: "cost_optimizer_weekly_digest", intervalMs: WEEK, critical: false },
  // W4.5 — weekly MRR snapshot (Monday window shared with the digests).
  { name: "mrr_snapshot_weekly", intervalMs: WEEK, critical: false },
  // S2d — weekly LCS outcome-calibration sweep (same Monday window).
  { name: "lcs_calibration_weekly", intervalMs: WEEK, critical: false },
  { name: "growth_automation", intervalMs: 6 * HOUR, critical: false },
  // Wall-clock daily 06:00 (local==UTC on the Fly worker). cron not yet consumed.
  { name: "churn_engine_daily", intervalMs: DAY, critical: true, cron: "0 6 * * *" },
  // Wall-clock daily 07:00. cron not yet consumed.
  // Founder-trust audit (2026-07) gap #4 — critical: the system that tells
  // the founder everything is fine must be watched at least as strictly as
  // what it reports on. A dead daily briefing is silence that reads as calm.
  // (founder_digest, company_briefing_generator and customer_letters_monthly
  // deliberately stay non-critical: they overlap this briefing + the monthly
  // letter, which are the two canonical founder-truth channels.)
  { name: "founder_briefing_daily", intervalMs: DAY, critical: true, cron: "0 7 * * *" },
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
  // Wall-clock daily 03:30 UTC. cron not yet consumed.
  { name: "data_retention", intervalMs: DAY, critical: true, cron: "30 3 * * *" },
  // The withJobLock liveness fires DAILY at 14:00 UTC (the body self-gates to
  // the first Tue of Jan/Apr/Jul/Oct internally) — so the deadman cadence + the
  // cron anchor are both daily. cron not yet consumed.
  { name: "access_review_quarterly", intervalMs: DAY, critical: true, cron: "0 14 * * *" },
  // Wall-clock 1st-of-month 09:00 UTC. cron not yet consumed.
  { name: "prompt_evolution_monthly", intervalMs: MONTH, critical: false, cron: "0 9 1 * *" },
  { name: "outcome_driven_evolution_nightly", intervalMs: DAY, critical: false },
  { name: "experiment_sweep_weekly", intervalMs: WEEK, critical: false },
  { name: "agent_memory_consolidation_weekly", intervalMs: WEEK, critical: false },
  { name: "expansion_radar_weekly", intervalMs: WEEK, critical: false },
  { name: "onboarding_sweeper", intervalMs: HOUR, critical: true },
  { name: "customer_letters_monthly", intervalMs: HOUR, critical: false },
  { name: "action_preview_sweeper", intervalMs: HOUR, critical: false },
  { name: "dispatch_reaper", intervalMs: 10 * MIN, critical: false },
  { name: "mail_flusher", intervalMs: 3 * MIN, critical: true },
  { name: "proof_chain_audit", intervalMs: DAY, critical: true },
  { name: "strategic_proposals_weekly", intervalMs: WEEK, critical: false },
  // Wall-clock 1st-of-month 10:00 UTC. cron not yet consumed.
  { name: "strategic_proposals_monthly_synthesis", intervalMs: MONTH, critical: false, cron: "0 10 1 * *" },
  // Wall-clock 1st-of-month 12:00 UTC. cron not yet consumed.
  // Founder-trust audit (2026-07) gap #4 — critical: the system that tells
  // the founder everything is fine must be watched at least as strictly as
  // what it reports on (see founder_briefing_daily above).
  { name: "founder_letter_monthly", intervalMs: MONTH, critical: true, cron: "0 12 1 * *" },
  { name: "autonomy_outcome_grader", intervalMs: DAY, critical: false },
  // Horizon A1 — outcome-ledger 30/90-day check-in scorer, daily 12:00 UTC.
  // Non-critical: a dark pass delays scoring by a day; the unscored rows
  // stay honestly unscored (reported as overdue) until the next run.
  { name: "outcome_ledger_check_ins", intervalMs: DAY, critical: false, cron: "0 12 * * *" },
  { name: "company_briefing_generator", intervalMs: DAY, critical: false },
  // §1026.41 periodic statements — wall-clock 1st-of-month 09:00 UTC. cron not
  // yet consumed.
  { name: "periodic_statements_monthly", intervalMs: MONTH, critical: true, cron: "0 9 1 * *" },
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
  { name: "solene_loop_watchdog", intervalMs: 30 * MIN, critical: false },
  { name: "solene_agent_claims_expiry", intervalMs: 5 * MIN, critical: false },
  // Step-away gap #5 — taps frozen witnessed-send actions covered by a live
  // founder-issued WitnessGrant. No-op with zero grants issued.
  { name: "autopilot_auto_witness_sweep", intervalMs: 5 * MIN, critical: false },
  // Step-away gap #6 — durable Stage-6 evolution regression check driver.
  { name: "evolution_regression_scan", intervalMs: 10 * MIN, critical: false },
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
  // Tier 3F — cross-org data co-op: monthly privacy-preserving county
  // rollups (k>=5 floor enforced in the aggregation). Production check on
  // "ran but produced nothing" is the job's own two-zero-runs alert-spine
  // warning; the deadman covers absence.
  // NO cron: this is a scheduleSelfRescheduling 30d INTERVAL-DRIFT job (fires
  // ~30d from process start, not on a calendar boundary), so there is no
  // wall-clock anchor to express — intervalMs is the truth. (Same applies to
  // fair_lending_audit / reconciliation_cron / disclosure_timing_dispatch.)
  { name: "county_market_rollup", intervalMs: MONTH, critical: false },
  // db_backup's body (runDbBackupIfConfigured) no-ops without the S3 bucket —
  // declare that dormancy HERE so the deadman skips it cleanly AND the
  // config-dormant meta-check reports it every sweep instead of letting a
  // critical job rot invisibly. Same predicate gates backup_restore_verify.
  // Wall-clock daily 07:00 UTC dump. cron not yet consumed.
  { name: "db_backup", intervalMs: DAY, critical: true, cron: "0 7 * * *",
    disabledWhen: () => backupConfigMissingReason() !== null,
    disabledReason: "backup destination not configured — 🔑 founder: fly secrets set DB_BACKUP_S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY" },
  // Tier 1E — weekly restore-verification of the latest backup (scratch-DB
  // restore + crown-jewel count parity + backup_verified proof row).
  // Wall-clock weekly Sunday 05:00 UTC restore-verify. cron not yet consumed.
  { name: "backup_restore_verify", intervalMs: WEEK, critical: true, cron: "0 5 * * 0",
    disabledWhen: () => backupConfigMissingReason() !== null,
    disabledReason: "backup bucket/creds not configured — 🔑 founder: fly secrets set DB_BACKUP_S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY" },
  // course_completion_check's body no-ops without SES sender config.
  { name: "course_completion_check", intervalMs: DAY, critical: false,
    disabledWhen: () => !process.env.AWS_SES_FROM_EMAIL,
    disabledReason: "AWS_SES_FROM_EMAIL unset — completion path emails learners; dormant until SES sender configured" },

  // ── Per-member continuous audits ───────────────────────────────────────────
  { name: "krieger_mobile_feel_audit", intervalMs: 30 * MIN, critical: false },
  { name: "iris_perf_monitor", intervalMs: 30 * MIN, critical: false },
  { name: "soren_seo_tracker", intervalMs: DAY, critical: false },
  { name: "anthropic_watch", intervalMs: DAY, critical: false },
  { name: "daily_ai_cost_guard", intervalMs: DAY, critical: true },
  { name: "npm_watch", intervalMs: DAY, critical: false },
  { name: "model_upgrade_backfill", intervalMs: DAY, critical: false },
  { name: "beatrice_reg_watch", intervalMs: DAY, critical: false },
  // Wall-clock daily 04:15 UTC. cron not yet consumed.
  { name: "nps_prompt_scheduler", intervalMs: DAY, critical: false, cron: "15 4 * * *" },
  // Tier 2C — daily 15:05 UTC lifecycle email dispatcher
  // (d7_check_in / d30_nps / cancellation_reason_ask). cron not yet consumed.
  { name: "lifecycle_dispatch", intervalMs: DAY, critical: false, cron: "5 15 * * *" },
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
  // Tier 2B — hourly replay of failed financial_ledger postings. Critical:
  // if this goes dark while dead letters exist, money is silently missing
  // from the system of record and nothing is retrying.
  { name: "ledger_dead_letter_replay", intervalMs: HOUR, critical: true },
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

  // ── Cadenced agent/ops jobs the roster initially missed (parity-test caught) ──
  // The two solene reviews are wall-clock jobs (1st-of-month / quarter-start at
  // 09:00 UTC); intervalMs is their EXPECTED cadence so the deadman's 2× window
  // tolerates the wall-clock gap. The calibration grader is Andrei's daily job
  // (server/services/andrei/supportResolverCalibration.ts), registered alongside.
  // Wall-clock 1st-of-month 09:00 UTC. cron not yet consumed.
  { name: "solene_monthly_team_member_review", intervalMs: MONTH, critical: false, cron: "0 9 1 * *" },
  // Wall-clock 1st of Jan/Apr/Jul/Oct 09:00 UTC (quarter starts). cron not yet
  // consumed.
  { name: "solene_quarterly_arc_review", intervalMs: 3 * MONTH, critical: false, cron: "0 9 1 1,4,7,10 *" },
  { name: "support_resolve_calibration_grader", intervalMs: DAY, critical: false },
];

/** Roster entries that are NOT currently disabled by their env predicate. */
export function activeRosterEntries(): JobRosterEntry[] {
  return JOB_ROSTER.filter((e) => !(e.disabledWhen?.() ?? false));
}

export interface ConfigDormantEntry {
  name: string;
  critical: boolean;
  reason: string;
}

/**
 * Tier 1E meta-check input — roster entries whose disabledWhen currently
 * evaluates true. These are jobs that are WIRED but intentionally dormant
 * (missing secret / env kill-switch / not-production). The deadman lists
 * the critical ones every sweep so "dormant" can never decay into
 * "forgotten". Returns ALL dormant entries; callers filter on `critical`.
 */
export function configDormantEntries(): ConfigDormantEntry[] {
  return JOB_ROSTER
    .filter((e) => e.disabledWhen?.() ?? false)
    .map((e) => ({
      name: e.name,
      critical: e.critical,
      reason: e.disabledReason ?? "disabledWhen returned true (no disabledReason declared — add one)",
    }));
}
