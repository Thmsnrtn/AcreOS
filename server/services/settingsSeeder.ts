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
