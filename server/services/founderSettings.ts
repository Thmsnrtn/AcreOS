/**
 * Founder Settings — editable operational knobs.
 *
 * Before this service, the founder had to SSH into Fly and edit
 * environment variables to change things like the financial hard cap
 * or the auto-execute confidence threshold. That's a developer
 * interface, not a founder interface. These are the three knobs a
 * non-technical founder most needs to touch.
 *
 * Now they're in a keyed table, editable from /founder/settings, and
 * applied live — the next decision uses the new value, no restart.
 *
 * Priority order when resolving any key:
 *   1. founder_settings row (founder-set value)
 *   2. process.env (legacy env-var path — still works)
 *   3. hardcoded default
 *
 * Infrastructure knobs (SIMULATION_MODE, DATABASE_URL,
 * AUTONOMOUS_EXECUTOR_ENABLED) stay env-var only — those are
 * deployment-level, not founder-level.
 *
 * A 30s in-memory cache keeps read cost near-zero on the hot path.
 */

import { db } from "../db";
import { founderSettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface KnobDefinition {
  key: string;
  valueType: "string" | "number" | "boolean" | "json";
  defaultValue: string;
  envFallback?: string;
  description: string;
  category: "safety" | "learning" | "scheduling" | "general";
  min?: number;
  max?: number;
  units?: string;
}

/**
 * Catalog of tunable knobs exposed to the founder. Adding a new knob
 * here makes it appear on the settings page automatically.
 */
export const KNOBS: KnobDefinition[] = [
  {
    key: "FINANCIAL_HARD_CAP_CENTS",
    valueType: "number",
    defaultValue: "2500000",
    envFallback: "FINANCIAL_HARD_CAP_CENTS",
    description:
      "Hard cap on autonomous spend. Any spend request above this is blocked outright, with no consensus flow. In cents — $25,000 by default.",
    category: "safety",
    min: 100_000, // $1,000 floor — never less than that
    max: 100_000_000, // $1M ceiling — anything above requires explicit lifting
    units: "cents",
  },
  {
    key: "FINANCIAL_APPROVAL_TTL_HOURS",
    valueType: "number",
    defaultValue: "72",
    envFallback: "FINANCIAL_APPROVAL_TTL_HOURS",
    description:
      "How long a pending financial approval stays valid before the TTL sweeper retires it. 72h is the safe default — long enough for a weekend, short enough that stale approvals can't linger indefinitely.",
    category: "safety",
    min: 1,
    max: 720, // 30 days
    units: "hours",
  },
  {
    key: "AUTO_EXECUTE_THRESHOLD",
    valueType: "number",
    defaultValue: "75",
    description:
      "Confidence threshold above which the executor auto-acts on a decision. Below this, the item is deferred for founder review. Raise it if the calibration report shows overconfidence.",
    category: "learning",
    min: 50,
    max: 99,
    units: "%",
  },
  {
    key: "MAX_FINANCIAL_IMPACT_CENTS",
    valueType: "number",
    defaultValue: "1000000",
    description:
      "Per-decision autonomous financial impact cap. Any decision with estimatedImpactCents above this is hard-stopped for founder review regardless of confidence. Defense-in-depth layer above the hard cap.",
    category: "safety",
    min: 10_000,
    max: 25_000_000, // never equal or exceed the hard cap
    units: "cents",
  },
  {
    key: "OUTREACH_STOPLOSS_MONTHLY_CENTS",
    valueType: "number",
    defaultValue: "50000",
    description:
      "Monthly mail+data outreach spend line (founder ruling #5, 2026-07-28 — $500/month to start). When month-to-date mail+data spend crosses this line, outreach pauses until you tap ‘I’ve looked — resume’ in Costs. Resets monthly. In cents.",
    category: "safety",
    min: 1_000, // $10 floor — a lower line would pause on the first postcard
    max: 10_000_000, // $100,000 ceiling — raising past this is a deliberate act
    units: "cents",
  },
  {
    key: "OUTCOME_GRADE_WINDOW_DAYS",
    valueType: "number",
    defaultValue: "14",
    description:
      "How far back the autonomy-health meter looks when computing the rolling average outcome score.",
    category: "learning",
    min: 3,
    max: 90,
    units: "days",
  },
  {
    key: "ACTION_PREVIEW_WINDOW_SECONDS",
    valueType: "number",
    defaultValue: "0",
    description:
      "Pause before each auto-approved action commits, giving you a chance to cancel from /founder/preview. Set to 0 for audit-only (no delay). Raise to 30+ to supervise in real-time.",
    category: "safety",
    min: 0,
    max: 300,
    units: "seconds",
  },
  // Pillar 9.2 — Cold-storage archival knobs.
  {
    key: "archival.enabled",
    valueType: "boolean",
    defaultValue: "false",
    description:
      "Enable nightly cold-storage archival of activity tables to Cloudflare R2 in Parquet format. Off by default — flip on once CMO_R2_* env vars are configured in Fly and the bucket exists.",
    category: "scheduling",
  },
  // Atlas operational-hands kill switch (Phase G/H/I batch 2).
  // When true, every destructive Atlas tool refuses fast with a pointer
  // to /founder/studio/atlas. Read-only tools are unaffected. Defaults
  // OFF per Tom's decision #13 (2026-05-23).
  {
    key: "atlas.kill_switch",
    valueType: "boolean",
    defaultValue: "false",
    description:
      "Panic button for Atlas. When ON, every destructive Atlas tool refuses immediately; inquiry tools still work. Use during incidents where Atlas is misbehaving.",
    category: "safety",
  },
  // Bridge dashboard — fused chat + telemetry surface at /founder/bridge.
  // Default OFF; flip ON for personal dogfooding before the planned
  // /founder swap (founder-dashboard-v2 redesign, 2026-05-23 decision).
  {
    key: "atlas.bridge_enabled",
    valueType: "boolean",
    defaultValue: "false",
    description:
      "Enables the Bridge dashboard at /founder/bridge — a fused chat-first + modular-telemetry surface. Default OFF. Flip ON to dogfood the redesign before it replaces /founder.",
    category: "general",
  },
  // Frugal Autonomy — total daily AI spend ceiling (cents). Every call into
  // routeAITask checks this before firing; once today's spend (across all
  // categories) hits the cap, further calls are refused with a
  // BudgetExceededError. Default $10/day (pre-launch). Raise to ~$200/day
  // once paying customers exist. The total is split into per-category
  // buckets via DEFAULT_SHARES in intelligence/budget.ts; founder can
  // override per-category via `ai.budget.{category}_share_pct` knobs.
  {
    key: "ai.daily_budget_cents",
    valueType: "number",
    defaultValue: "1000",
    description:
      "Total daily AI spend cap across the whole platform, in cents. When today's spend hits this, autonomous jobs refuse further LLM calls until UTC midnight. The cap is sliced into per-category budgets (executor, briefing, founder_brief, etc.) — see ai.budget.* knobs.",
    category: "safety",
    min: 100,           // $1/day absolute floor
    max: 1_000_000,     // $10k/day absolute ceiling
    units: "cents",
  },
  {
    key: "archival.horizon_days",
    valueType: "number",
    defaultValue: "90",
    description:
      "Rows older than this many days become eligible for archival. Lower = more aggressive (smaller hot DB, more R2 reads); higher = larger hot DB, fewer cold-storage hops.",
    category: "scheduling",
    min: 7,
    max: 3650,
    units: "days",
  },
];

const cache = new Map<string, { value: string; fetchedAt: number }>();
const CACHE_TTL_MS = 30_000;

/**
 * Keys declared in BOTH this module's KNOBS and settingsSeeder's
 * SETTINGS_CATALOG. Unit 121 found the overlap is exactly two, and that both
 * were live on opposite sides of a broken wire:
 *
 *   PATCH /api/founder/studio/dial  →  settings.setSetting  →  platform_settings
 *   server/jobs/archival.ts         →  getSetting (here)    →  founder_settings
 *
 * So the founder flipped `archival.enabled` in the studio, the route wrote a row,
 * WROTE A FOUNDER_AUDIT ROW, and returned success — and the job that reads the
 * toggle never saw it. A control that reports success while reaching nothing is
 * worse than a missing control, because the audit trail says it was set.
 *
 * Founder ruling (picker, 2026-08-15): bridge the READS. For an overlapping key
 * this consults platform_settings FIRST, then falls through to this module's own
 * table → env → default chain unchanged, so a key the founder has never touched
 * behaves exactly as before. `settingsOverlap.test.ts` pins that the overlap is
 * exactly this set — a third overlapping key must be a decision, not a surprise.
 */
const PLATFORM_OWNED_KEYS = new Set(["archival.enabled", "archival.horizon_days"]);

/** Read an overlapping key from platform_settings; null if absent or unreadable. */
async function readPlatformOwned(key: string): Promise<string | null> {
  try {
    const { getSettingRow } = await import("./settings");
    const row = await getSettingRow(key);
    if (row && row.value !== null && row.value !== undefined) {
      // platform_settings.value is JSONB — a boolean/number arrives typed, and
      // this module's contract is string. String() keeps `true`/`90` readable by
      // the existing callers (archival compares against the literal "true").
      return typeof row.value === "string" ? row.value : String(row.value);
    }
  } catch (err) {
    logger.warn("[founderSettings] platform_settings bridge read failed", {
      metadata: { key, error: err instanceof Error ? err.message : String(err) },
    });
  }
  return null;
}

export async function getSetting(key: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.value;

  if (PLATFORM_OWNED_KEYS.has(key)) {
    const bridged = await readPlatformOwned(key);
    if (bridged !== null) {
      cache.set(key, { value: bridged, fetchedAt: now });
      return bridged;
    }
  }

  try {
    const [row] = await db
      .select()
      .from(founderSettings)
      .where(eq(founderSettings.key, key))
      .limit(1);
    if (row) {
      cache.set(key, { value: row.value, fetchedAt: now });
      return row.value;
    }
  } catch (err: any) {
    logger.warn("[founderSettings] getSetting read failed", {
      metadata: { key, error: err?.message },
    });
  }
  // Fall through to env var
  const def = KNOBS.find((k) => k.key === key);
  if (def?.envFallback && process.env[def.envFallback]) {
    const envVal = process.env[def.envFallback]!;
    cache.set(key, { value: envVal, fetchedAt: now });
    return envVal;
  }
  if (def) {
    cache.set(key, { value: def.defaultValue, fetchedAt: now });
    return def.defaultValue;
  }
  return null;
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function setSetting(
  key: string,
  value: string,
  updatedBy?: string,
): Promise<void> {
  const def = KNOBS.find((k) => k.key === key);
  if (!def) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  // Type-check
  if (def.valueType === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${key} requires a numeric value`);
    if (def.min != null && n < def.min) throw new Error(`${key} minimum is ${def.min}`);
    if (def.max != null && n > def.max) throw new Error(`${key} maximum is ${def.max}`);
  } else if (def.valueType === "boolean") {
    if (value !== "true" && value !== "false") throw new Error(`${key} requires true|false`);
  }

  await db
    .insert(founderSettings)
    .values({
      key,
      value,
      valueType: def.valueType,
      description: def.description,
      category: def.category,
      updatedBy: updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: founderSettings.key,
      set: {
        value,
        updatedAt: new Date(),
        updatedBy: updatedBy ?? null,
      },
    });
  // Invalidate cache so the next read picks up the new value.
  cache.delete(key);
}

export async function listSettings(): Promise<Array<{
  key: string;
  value: string;
  source: "founder" | "env" | "default";
  definition: KnobDefinition;
}>> {
  const rows = await db.select().from(founderSettings);
  const rowsByKey = new Map(rows.map((r) => [r.key, r]));
  return KNOBS.map((def) => {
    const row = rowsByKey.get(def.key);
    if (row) {
      return { key: def.key, value: row.value, source: "founder" as const, definition: def };
    }
    if (def.envFallback && process.env[def.envFallback]) {
      return {
        key: def.key,
        value: process.env[def.envFallback]!,
        source: "env" as const,
        definition: def,
      };
    }
    return { key: def.key, value: def.defaultValue, source: "default" as const, definition: def };
  });
}

/**
 * Clear the in-memory cache. Useful when approval flows need to be
 * sure they're reading the absolute latest value.
 */
export function clearSettingsCache(): void {
  cache.clear();
}
