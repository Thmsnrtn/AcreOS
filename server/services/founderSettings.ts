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

export async function getSetting(key: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.value;

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
