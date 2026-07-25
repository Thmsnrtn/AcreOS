/**
 * Founder settings seeder — registers every known key with sensible defaults.
 *
 * Called on server boot (see server/index.ts). Idempotent; safe to re-run
 * every restart. The defaults below mirror the current hardcoded values
 * across the platform so the first deploy is a no-op — services start
 * reading via `getSetting(key, fallback)` and get the same number they
 * always got. Subsequent founder edits via `setSetting()` shift the
 * effective value with no restart needed.
 *
 * Adding a new setting: drop an entry in SETTINGS_CATALOG below and
 * `getSetting()` the value where you need it. The `/founder/studio` UI
 * renders new keys automatically (Phase C — generic dial-rendering engine
 * over this catalog).
 */

import { seedSetting, type SeedSettingArgs } from "./settings";
import { logger } from "../utils/logger";

export const SETTINGS_CATALOG: SeedSettingArgs[] = [
  // ─── Autonomy ──────────────────────────────────────────────────────────
  {
    key: "trust.tier_breakpoints",
    category: "autonomy",
    description:
      "Trust score breakpoints between tiers (observer / assistant / operator / director). Lower numbers mean agents reach higher autonomy faster.",
    defaultValue: { observer: 0, assistant: 60, operator: 75, director: 90 },
    validRange: { type: "object" },
  },
  {
    key: "trust.promotion_accuracy_gate",
    category: "autonomy",
    description: "Required accuracy rate (0-1) before an agent can advance one trust tier.",
    defaultValue: 0.9,
    validRange: { type: "number", min: 0, max: 1 },
  },
  {
    key: "trust.promotion_success_gate",
    category: "autonomy",
    description: "Required action success rate (0-1) before an agent can advance one trust tier.",
    defaultValue: 0.8,
    validRange: { type: "number", min: 0, max: 1 },
  },
  {
    key: "autonomy.proposal_auto_execute_confidence",
    category: "autonomy",
    description:
      "Minimum confidence score (0-1) at which a proposal is auto-executed instead of escalated to the founder inbox (when trust also permits).",
    defaultValue: 0.75,
    validRange: { type: "number", min: 0, max: 1 },
  },
  {
    key: "autonomy.default_gate",
    category: "autonomy",
    description:
      "Default autonomy gate when no agent / skill / category override exists. 'auto' = engine runs itself; 'review' = founder approves before execution; 'off' = action blocked entirely.",
    defaultValue: "auto",
    validRange: { type: "enum", oneOf: ["auto", "review", "off"] },
  },

  // ─── Cost ──────────────────────────────────────────────────────────────
  {
    key: "cost.per_org_daily_cap_cents",
    category: "cost",
    description:
      "Default daily AI spend cap per organization in cents. Per-org overrides live in aiCostCeilingOverrides; this is the floor when no override is set.",
    defaultValue: 50000,
    validRange: { type: "number", min: 0 },
  },
  {
    key: "cost.per_agent_daily_cap_cents",
    category: "cost",
    description:
      "Default daily spend cap per agent in cents. Lets the founder throttle one agent without affecting others.",
    defaultValue: 10000,
    validRange: { type: "number", min: 0 },
  },

  // ─── Lifecycle ─────────────────────────────────────────────────────────
  {
    key: "lifecycle.onboarding_step_days",
    category: "lifecycle",
    description:
      "Days from signup at which each onboarding stage fires (day0_welcome, day1_goals_prompt, day3_starter_leads, day7_checkin, day14_feature_review, day30_activation_verdict).",
    defaultValue: { day0: 0, day1: 1, day3: 3, day7: 7, day14: 14, day30: 30 },
    validRange: { type: "object" },
  },
  {
    key: "lifecycle.activation_verdict_rule",
    category: "lifecycle",
    description:
      "Logic deciding whether a 30-day-old org counts as 'activated'. Default: dealCount >= 1 OR leadCount >= 5. Stored as JSON so the studio can render the editor.",
    defaultValue: { type: "any", clauses: [{ field: "dealCount", op: ">=", value: 1 }, { field: "leadCount", op: ">=", value: 5 }] },
    validRange: { type: "object" },
  },

  // ─── Safety / Compliance ───────────────────────────────────────────────
  {
    key: "safety.quiet_hours_utc",
    category: "safety",
    description:
      "Hours of day (UTC) during which non-critical agent actions are deferred. Format: { start: number, end: number } using 24h ints. null = always-on.",
    defaultValue: null,
    validRange: { type: "object" },
  },
  {
    key: "safety.max_action_retries",
    category: "safety",
    description: "Maximum retries before an agent action is marked terminal-failed.",
    defaultValue: 3,
    validRange: { type: "number", min: 0, max: 10 },
  },

  // ─── Churn / Customer ──────────────────────────────────────────────────
  {
    key: "churn.risk_band_thresholds",
    category: "lifecycle",
    description:
      "Score thresholds (0-100) for risk bands. Default: green<40, yellow<60, red<80, critical=80+.",
    defaultValue: { green: 0, yellow: 40, red: 60, critical: 80 },
    validRange: { type: "object" },
  },
  {
    key: "churn.intervention_rules",
    category: "lifecycle",
    description:
      "When and how to auto-intervene by risk band. List of { band, action, templateId, delayHours } objects. Empty list = manual interventions only.",
    defaultValue: [],
    validRange: { type: "array" },
  },

  // ─── Voice ─────────────────────────────────────────────────────────────
  {
    key: "voice.persona_vocabulary_overrides",
    category: "voice",
    description:
      "Per-key overrides for the persona vocabulary (e.g. customers see 'parcel' instead of 'property'). Key = dotted vocab key, value = string override.",
    defaultValue: {},
    validRange: { type: "object" },
  },

  // ─── Founder UX ────────────────────────────────────────────────────────
  {
    key: "founder.now_attention_cap",
    category: "safety",
    description:
      "Maximum number of items to surface on /founder (Now) at once. Soft cap — items beyond this fall into /founder/inspector/decision.",
    defaultValue: 5,
    validRange: { type: "number", min: 1, max: 20 },
  },

  // ─── Pillar 1 + 4 — Financial substrate (Round 1) ─────────────────────
  {
    key: "allocation.policy",
    category: "cost",
    description:
      "Revenue allocation policy. Splits every paid invoice into the five buckets (tax / refund / profit / draw / opex). Fractions sum to 1.0.",
    defaultValue: {
      tax_reserve: 0.25,
      refund_reserve: 0.10,
      profit_reserve: 0.05,
      owner_draw: 0.05,
      opex_available: 0.55,
    },
    validRange: { type: "object" },
  },

  // ─── Credit weights — 1 credit ≈ 1¢ of cost-to-us ─────────────────────
  ...["sms_outbound", "email_outbound", "postcard_eddm", "postcard_postgrid", "postcard_lob", "letter_presort", "letter_lob", "skip_trace", "ai_turn_avg"].map((action): SeedSettingArgs => ({
    key: `credits.weight.${action}`,
    category: "cost" as const,
    description: `Credit weight for ${action} action (1 credit ≈ 1¢ of platform cost). Tunable in /founder/studio/credits.`,
    defaultValue: 0,  // 0 = use the canonical constant from shared/billing/credit-weights.ts
    validRange: { type: "number", min: 0, max: 10000 },
  })),

  // ─── Revenue-trigger ladder ───────────────────────────────────────────
  {
    key: "revenue.triggers",
    category: "cost",
    description:
      "Revenue-trigger ladder. List of MRR thresholds and the scale-up actions they unlock (Sentry, Fly machines, USPS permit, Telnyx, aggregation queue). Editable in /founder/studio/triggers.",
    defaultValue: [
      { threshold: 50_00, action: "sentry_starter", autoApprove: false },
      { threshold: 200_00, action: "fly_app_shared_cpu_2x", autoApprove: false },
      { threshold: 500_00, action: "fly_app_redundancy", autoApprove: false },
      { threshold: 1000_00, action: "usps_mail_permit", autoApprove: false },
      { threshold: 1000_00, action: "elevenlabs_pro", autoApprove: false },
      { threshold: 2000_00, action: "postgres_paid_tier", autoApprove: false },
      { threshold: 3000_00, action: "telnyx_a2p_10dlc", autoApprove: false },
      { threshold: 5000_00, action: "mail_aggregation_queue", autoApprove: false },
      { threshold: 10000_00, action: "fly_performance_2x", autoApprove: false },
    ],
    validRange: { type: "object" },
  },

  // ─── Provider routing rules (Pillars 2, 5, 6, 7) ──────────────────────
  // Shapes below MUST match the studio routing zod schemas
  // (server/routes-founder-studio-dials.ts: mail/comms/data/aiRoutingSchema).
  // The GET handler validates stored values against those schemas and falls back
  // to code defaults on mismatch, but seeding the correct shape here avoids
  // seeding data that would just be discarded on read.
  {
    key: "routing.mail",
    category: "cost",
    description: "Mail provider routing rules: priority order, EDDM state rules, hold-and-batch hours, co-marketing toggle.",
    defaultValue: { providerPriority: ["eddm", "presort", "postgrid", "lob", "lettrlabs"], eddmStates: ["TX", "FL", "AZ", "NM", "OK", "CO"], holdAndBatchHours: 0.5, coMarketingEnabled: false },
    validRange: { type: "object" },
  },
  {
    key: "routing.comms",
    category: "cost",
    description: "SMS/voice routing: Telnyx vs Twilio priority, carrier overrides, tracking-pool size, BYOK precedence.",
    defaultValue: { smsPriority: ["telnyx", "twilio"], carrierOverrides: "", trackingPoolSize: 50, byokWins: true },
    validRange: { type: "object" },
  },
  {
    key: "routing.data",
    category: "cost",
    description: "Data-cache TTL (days) per entity-type + free-source-first toggle + provider fallback order.",
    defaultValue: {
      cacheTtlDays: { skip_trace: 90, parcel_ownership: 30, parcel_polygon: 365, avm: 30, flood_zone: 365, liens: 30 },
      freeSourceFirst: true,
      fallbackOrder: ["regrid", "estated", "datatree"],
    },
    validRange: { type: "object" },
  },
  {
    key: "routing.ai",
    category: "cost",
    description: "Per-task model floor (highest model allowed), cache TTL (hours) per complexity, prompt-cache enforcement.",
    defaultValue: {
      modelFloor: { classification: "claude-haiku-4-5", synthesis: "claude-sonnet-4-6", agent_tool: "claude-sonnet-4-6", other: "claude-sonnet-4-6" },
      cacheTtlHoursByComplexity: { trivial: 24, simple: 12, moderate: 4, complex: 1 },
      enforcePromptCache: true,
    },
    validRange: { type: "object" },
  },

  // ─── BYOK minimum tier per channel ────────────────────────────────────
  ...["twilio", "telnyx", "sendgrid", "ses", "lob", "postgrid", "openrouter", "anthropic", "openai", "batch_skiptracing", "mapbox", "s3"].map((channel): SeedSettingArgs => ({
    key: `byok.minTier.${channel}`,
    category: "cost" as const,
    description: `Minimum tier that can BYOK for ${channel}. Defaults to "pro".`,
    defaultValue: "pro",
    validRange: { type: "string", oneOf: ["free", "starter", "pro", "scale", "enterprise", "founder_only"] },
  })),

  // ─── Infrastructure overrides (Pillar 8 — manual escape hatches) ──────
  {
    key: "infra.override.fly.size",
    category: "cost",
    description: "Manual Fly VM size override. When null, the revenue-trigger ladder manages this.",
    defaultValue: null,
    validRange: { type: "string", oneOf: ["shared-cpu-1x", "shared-cpu-2x", "shared-cpu-4x", "shared-cpu-8x", "performance-1x", "performance-2x", "performance-4x"] },
  },
  {
    key: "infra.override.fly.minMachines",
    category: "cost",
    description: "Manual Fly min_machines_running override. When null, the revenue-trigger ladder manages this.",
    defaultValue: null,
    validRange: { type: "number", min: 0, max: 10 },
  },
  {
    key: "infra.override.fly.autoStop",
    category: "cost",
    description: "Manual Fly auto_stop_machines override. When null, the revenue-trigger ladder manages this.",
    defaultValue: null,
    validRange: { type: "string", oneOf: ["off", "stop", "suspend"] },
  },
  {
    key: "infra.override.sentry.sampleRate",
    category: "cost",
    description: "Manual Sentry traces sample rate (0–1) override. When null, env var SENTRY_TRACES_SAMPLE_RATE wins (default 0.05).",
    defaultValue: null,
    validRange: { type: "number", min: 0, max: 1 },
  },
  {
    key: "infra.override.stripe.achEnabled",
    category: "cost",
    description: "Manual override for Stripe ACH-on-yearly behavior. When null, the routes-billing.ts auto-detect (yearly interval) wins.",
    defaultValue: null,
    validRange: { type: "boolean" },
  },
  {
    key: "infra.override.readReplica.categories",
    category: "cost",
    description: "List of query categories routed to the Postgres read replica. Empty array means no replica adoption.",
    defaultValue: [],
    validRange: { type: "object" },
  },

  // ─── Mail aggregation thresholds (Pillar 2 batch queue) ───────────────
  {
    key: "mail.providers.enabled",
    category: "cost",
    description: "List of mail providers the router is allowed to use. Add 'postgrid' after POSTGRID_API_KEY is set.",
    defaultValue: ["lob"],
    validRange: { type: "object" },
  },

  // ─── Tracking-number pool auto-release (Pillar 5) ─────────────────────
  {
    key: "comms.pool.auto_release_days",
    category: "cost",
    description: "Number of idle days before a tracking number is auto-released back to the pool.",
    defaultValue: 60,
    validRange: { type: "number", min: 1, max: 365 },
  },

  // ─── Archival horizon (Pillar 9.2) ────────────────────────────────────
  {
    key: "archival.enabled",
    category: "safety",
    description: "Master toggle for the daily archival sweep. Off by default — only flip on once R2 storage is configured.",
    defaultValue: false,
    validRange: { type: "boolean" },
  },
  {
    key: "archival.horizon_days",
    category: "safety",
    description: "Activity older than this many days is archived to cold storage on the daily sweep.",
    defaultValue: 90,
    validRange: { type: "number", min: 30, max: 730 },
  },
];

export async function seedAllSettings(): Promise<void> {
  for (const entry of SETTINGS_CATALOG) {
    try {
      await seedSetting(entry);
    } catch (err) {
      logger.warn(
        `[settings:seed] failed for key='${entry.key}': ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  logger.info(`[settings:seed] catalog of ${SETTINGS_CATALOG.length} keys seeded`);
}
