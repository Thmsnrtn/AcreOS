/**
 * Founder settings service — the read/write layer over `founder_settings`.
 *
 * Every hardcoded threshold in the platform that the founder might want to
 * tune lives here as a row in `founder_settings`. Existing services that
 * today reach for a magic number get refactored to call `getSetting(key,
 * fallback)` — the fallback is the prior hardcoded value, so behavior is
 * unchanged on the first deploy. On subsequent founder edits via
 * `setSetting()`, the new value applies on the next decision without a
 * restart.
 *
 * Scope hierarchy (most specific wins):
 *   skill > agent > org > global
 *
 * Caching:
 *   In-process LRU keyed by (scope|scopeRef|key) with 30s TTL. Settings
 *   change rarely; the cache avoids hammering the DB on hot paths like
 *   the autonomy gate which fires on every agent action.
 *
 * Audit:
 *   Every `setSetting()` call writes a row to `founder_audit` with the
 *   previous value, new value, founder id, optional note. The audit log
 *   is queried from /founder/inspector/audit (Phase D).
 *
 * Design note: settings are JSON-typed so we can store breakpoints arrays,
 * rule objects, enum strings, numbers — without per-key columns. The
 * `validRange` jsonb describes the shape so /founder/studio can render the
 * right input without per-key UI code.
 */

import { db } from "../db";
import { platformSettings, founderAudit, type PlatformSetting } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

const CACHE_TTL_MS = 30_000;

// F-D21: thrown by setSetting() when a value is outside the registered
// validRange. The route handler catches this and translates to a 422.
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

interface CachedSetting {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CachedSetting>();

function cacheKey(key: string, scope: string, scopeRef: string | null): string {
  return `${scope}|${scopeRef ?? ""}|${key}`;
}

export interface SettingScope {
  scope?: "global" | "org" | "agent" | "skill";
  scopeRef?: string | null;
}

/**
 * Get a setting's effective value, walking the scope hierarchy:
 *   skill (most specific) → agent → org → global → fallback
 *
 * The caller passes the most specific scope they care about; this helper
 * walks up to global automatically. Returns the provided fallback when no
 * row exists at any scope (the boot-time seeder ensures every known key
 * has a global row, so this only happens for un-seeded keys — usually a
 * coding error rather than runtime state).
 */
export async function getSetting<T = unknown>(
  key: string,
  fallback: T,
  scope?: SettingScope,
): Promise<T> {
  const chain = buildScopeChain(scope);
  for (const [scopeName, scopeRef] of chain) {
    const cached = readCache<T>(key, scopeName, scopeRef);
    if (cached !== undefined) {
      if (cached === SENTINEL_MISS) continue;
      return cached as T;
    }

    const [row] = await db
      .select({
        value: platformSettings.value,
        defaultValue: platformSettings.defaultValue,
        lastChangedBy: platformSettings.lastChangedBy,
      })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.key, key),
          eq(platformSettings.scope, scopeName),
          scopeRef === null ? isNull(platformSettings.scopeRef) : eq(platformSettings.scopeRef, scopeRef),
        ),
      )
      .limit(1);

    if (row) {
      // P12-1a env fallback (opt-in keys only): at global scope, an
      // untouched seed row does not shadow the env var.
      if (scopeName === "global") {
        const envVal = resolveEnvFallback(key, fallback, row);
        if (envVal !== undefined) {
          writeCache(key, scopeName, scopeRef, envVal);
          return envVal as T;
        }
      }
      writeCache(key, scopeName, scopeRef, row.value);
      return row.value as T;
    }
    writeCache(key, scopeName, scopeRef, SENTINEL_MISS);
  }
  // No row at any scope: an opt-in env fallback still beats the caller's
  // fallback (founderSettings parity for env-only environments).
  const envVal = resolveEnvFallback(key, fallback);
  if (envVal !== undefined) return envVal as T;
  return fallback;
}

/**
 * P12-1b string adapter — the founderSettings string contract over this
 * registry. founderSettings.getSetting spoke strings end-to-end
 * (string | null; objects as JSON text); this registry speaks typed
 * JSON. Former founderSettings readers keep their exact observable
 * behaviour through these two helpers:
 *   string        → as-is
 *   number/bool   → String(value)  ("true" / "90" — archival's literal
 *                    comparison and the Atlas kill-switch check rely on it)
 *   object/array  → JSON.stringify (allocation.policy and the provider
 *                    lists are JSON.parsed by their callers)
 *   null / absent → null (the caller's previous default path)
 * A read failure resolves to null instead of throwing, mirroring
 * founderSettings' fail-soft read (a settings-table outage must not
 * become an exception in a job or a money path).
 */
export async function getStringSetting(key: string): Promise<string | null> {
  try {
    const value = await getSetting<unknown>(key, null);
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  } catch (err) {
    logger.warn("[settings] getStringSetting read failed", {
      metadata: { key, error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

/** Number sibling of getStringSetting — founderSettings.getNumberSetting parity. */
export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getStringSetting(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Get the raw setting row (any scope) for the studio UI. Returns null
 * when the key has no row at the given scope.
 */
export async function getSettingRow(
  key: string,
  scope: SettingScope = { scope: "global", scopeRef: null },
): Promise<PlatformSetting | null> {
  const scopeName = scope.scope ?? "global";
  const scopeRef = scope.scopeRef ?? null;
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.key, key),
        eq(platformSettings.scope, scopeName),
        scopeRef === null ? isNull(platformSettings.scopeRef) : eq(platformSettings.scopeRef, scopeRef),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface SetSettingArgs {
  key: string;
  value: unknown;
  founderId: string;
  note?: string;
  scope?: SettingScope;
}

/**
 * Update a setting (or insert at the right scope if it doesn't exist yet).
 * Writes a `founder_audit` row capturing the before/after diff.
 *
 * The key MUST have been registered via `seedSetting()` first — we refuse
 * to write an unknown key so typos don't silently create orphan rows. The
 * studio UI lists only registered keys.
 */
export async function setSetting(args: SetSettingArgs): Promise<PlatformSetting> {
  const scopeName = args.scope?.scope ?? "global";
  const scopeRef = args.scope?.scopeRef ?? null;

  const globalRow = await getSettingRow(args.key, { scope: "global", scopeRef: null });
  if (!globalRow) {
    throw new Error(
      `[settings] unknown key '${args.key}' — must be seeded via seedSetting() before it can be set. ` +
        "This guard prevents typos from creating orphan rows that the studio UI can't render.",
    );
  }

  // F-D21: validate value against validRange before persisting. The studio
  // UI already constrains inputs but direct API callers (or buggy clients)
  // could send out-of-range values that PATCH would silently accept.
  const range = globalRow.validRange as { type?: string; min?: number; max?: number; oneOf?: unknown[] } | null;
  if (range && typeof range === "object") {
    if (range.type === "number" && typeof args.value === "number") {
      if (typeof range.min === "number" && args.value < range.min) {
        throw new SettingsValidationError(`value ${args.value} is below min ${range.min}`);
      }
      if (typeof range.max === "number" && args.value > range.max) {
        throw new SettingsValidationError(`value ${args.value} is above max ${range.max}`);
      }
    }
    // P12-1a: boolean validation. Previously validRange.type:"boolean" was
    // ignored, so any shape could be written to a boolean key. Now a
    // boolean-typed key requires a real boolean — EXCEPT null, which is
    // the catalog's own cleared-override shape (e.g.
    // infra.override.stripe.achEnabled defaults to null and is cleared
    // back to null; its client writes real booleans). Every value shape
    // the current catalog writes (boolean, null) stays accepted.
    if (range.type === "boolean" && args.value !== null && typeof args.value !== "boolean") {
      throw new SettingsValidationError(
        `value '${String(args.value)}' is not a boolean`,
      );
    }
    if (Array.isArray(range.oneOf) && !range.oneOf.includes(args.value as never)) {
      throw new SettingsValidationError(
        `value '${String(args.value)}' is not one of [${range.oneOf.map(String).join(", ")}]`,
      );
    }
  }

  const existing = scopeName === "global" && scopeRef === null
    ? globalRow
    : await getSettingRow(args.key, { scope: scopeName, scopeRef });

  const previousValue = existing?.value ?? null;

  let row: PlatformSetting;
  if (existing) {
    const [updated] = await db
      .update(platformSettings)
      .set({
        value: args.value,
        lastChangedBy: args.founderId,
        lastChangedAt: clock.now(),
        lastChangedNote: args.note ?? null,
      })
      .where(eq(platformSettings.id, existing.id))
      .returning();
    row = updated;
  } else {
    // New scope override — clone the global row's metadata for shape.
    const [inserted] = await db
      .insert(platformSettings)
      .values({
        key: args.key,
        scope: scopeName,
        scopeRef,
        value: args.value,
        defaultValue: globalRow.defaultValue,
        validRange: globalRow.validRange,
        category: globalRow.category,
        description: globalRow.description,
        lastChangedBy: args.founderId,
        lastChangedAt: clock.now(),
        lastChangedNote: args.note ?? null,
      })
      .returning();
    row = inserted;
  }

  invalidateCache(args.key, scopeName, scopeRef);

  await db.insert(founderAudit).values({
    founderId: args.founderId,
    area: "settings",
    action: existing ? "update" : "override-insert",
    targetType: "setting",
    targetId: `${scopeName}:${scopeRef ?? "_"}:${args.key}`,
    before: previousValue,
    after: args.value,
    note: args.note ?? null,
  });

  logger.info(`[settings] key='${args.key}' scope=${scopeName}${scopeRef ? `(${scopeRef})` : ""} updated by ${args.founderId}`);
  return row;
}

/**
 * Reset a setting back to its default value (clears any override).
 * For global rows this writes value=defaultValue; for narrower scopes
 * it deletes the row so resolution falls back to the parent scope.
 */
export async function resetSetting(
  key: string,
  founderId: string,
  scope: SettingScope = { scope: "global", scopeRef: null },
): Promise<void> {
  const row = await getSettingRow(key, scope);
  if (!row) return;

  const scopeName = scope.scope ?? "global";
  const scopeRef = scope.scopeRef ?? null;

  if (scopeName === "global") {
    await db
      .update(platformSettings)
      .set({
        value: row.defaultValue,
        lastChangedBy: founderId,
        lastChangedAt: clock.now(),
        lastChangedNote: "reset to default",
      })
      .where(eq(platformSettings.id, row.id));
  } else {
    await db.delete(platformSettings).where(eq(platformSettings.id, row.id));
  }

  invalidateCache(key, scopeName, scopeRef);

  await db.insert(founderAudit).values({
    founderId,
    area: "settings",
    action: "reset",
    targetType: "setting",
    targetId: `${scopeName}:${scopeRef ?? "_"}:${key}`,
    before: row.value,
    after: row.defaultValue,
    note: "reset to default",
  });
}

export interface SeedSettingArgs {
  key: string;
  // P12-1a: union widened with the KNOBS catalog categories
  // ("learning" | "scheduling" | "general") so founderSettings KNOBS can be
  // seeded faithfully. Type-level only — platform_settings.category is text.
  category:
    | "autonomy"
    | "cost"
    | "lifecycle"
    | "voice"
    | "safety"
    | "compliance"
    | "learning"
    | "scheduling"
    | "general";
  description: string;
  defaultValue: unknown;
  validRange?: PlatformSetting["validRange"];
  /**
   * P12-1a: OPT-IN env fallback (default OFF — absent means the key never
   * consults process.env, so no existing key's resolution changes). When
   * set to an env var name, getSetting() mirrors founderSettings'
   * resolution order for that key: a founder-set DB row wins, then the
   * env var, then the seeded default. A global row that is still the
   * untouched seed (value deep-equals defaultValue and lastChangedBy is
   * null) does NOT shadow the env var — it is a default, not a founder
   * set. Registration is in-process, populated by seedSetting() at boot
   * (the seeder runs before reads); see registerSettingEnvFallback.
   */
  envFallback?: string;
}

// ─── Env fallback registry (P12-1a, opt-in per key) ─────────────────────────

const envFallbackByKey = new Map<string, string>();

/**
 * Register an env fallback for a key. Called by seedSetting(); idempotent.
 * Deliberately NOT exported: seedSetting() is its only caller, and an
 * exported-but-internal symbol trips lint:reachability's
 * internal-only-exports ratchet (+1 over baseline, found in P12-1a's
 * resumed build). The registry stays an implementation detail of this
 * module; keys opt in via SeedSettingArgs.envFallback.
 */
function registerSettingEnvFallback(key: string, envVar: string): void {
  envFallbackByKey.set(key, envVar);
}

/**
 * Resolve the env fallback for `key`, or undefined when the key has no
 * registered fallback, the env var is unset/empty, or a founder-set row
 * shadows it. `row` is the global row when one was found; an untouched
 * seed row (value === defaultValue, never changed) does not shadow.
 * Coercion follows the caller's fallback type: number → Number(raw)
 * (non-finite → undefined), boolean → "true"/"false" only, else string.
 */
function resolveEnvFallback(
  key: string,
  fallback: unknown,
  row?: { value: unknown; defaultValue: unknown; lastChangedBy: string | null },
): unknown {
  const envVar = envFallbackByKey.get(key);
  if (!envVar) return undefined;
  const raw = process.env[envVar];
  if (raw === undefined || raw === "") return undefined;
  if (row) {
    const untouchedSeed =
      row.lastChangedBy == null &&
      JSON.stringify(row.value) === JSON.stringify(row.defaultValue);
    if (!untouchedSeed) return undefined;
  }
  if (typeof fallback === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof fallback === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return undefined;
  }
  return raw;
}

/**
 * Idempotent seed for a known setting key. Called from server boot to
 * ensure every key the platform reads is materialized at the global scope.
 *
 * If the row already exists, this is a no-op (preserves any founder edit
 * that's already been made). If only the description / validRange / default
 * has changed in code, those metadata fields update — but the user-facing
 * value never gets overwritten by a deploy.
 */
export async function seedSetting(args: SeedSettingArgs): Promise<void> {
  // P12-1a: register the opt-in env fallback (if any) before any DB work,
  // so resolution is armed even when the row already exists.
  if (args.envFallback) registerSettingEnvFallback(args.key, args.envFallback);
  const existing = await getSettingRow(args.key, { scope: "global", scopeRef: null });
  if (existing) {
    // Metadata refresh only; do not touch value.
    if (
      existing.description !== args.description ||
      existing.category !== args.category ||
      JSON.stringify(existing.defaultValue) !== JSON.stringify(args.defaultValue) ||
      JSON.stringify(existing.validRange) !== JSON.stringify(args.validRange ?? null)
    ) {
      await db
        .update(platformSettings)
        .set({
          category: args.category,
          description: args.description,
          defaultValue: args.defaultValue,
          validRange: args.validRange ?? null,
        })
        .where(eq(platformSettings.id, existing.id));
    }
    return;
  }

  // platform_settings.value + .default_value are jsonb NOT NULL on prod.
  // Override-style entries (e.g. infra.override.fly.autoStop) declare
  // `defaultValue: null` in the catalog — those rows are meant to be ABSENT
  // until a founder explicitly overrides them, not inserted with SQL NULL.
  // Skip the INSERT entirely for those: getSetting() handles a missing row
  // by returning null. Eliminates ~6 boot-time warnings per process start.
  if (args.defaultValue === null || args.defaultValue === undefined) {
    return;
  }

  await db.insert(platformSettings).values({
    key: args.key,
    scope: "global",
    scopeRef: null,
    value: args.defaultValue,
    defaultValue: args.defaultValue,
    validRange: args.validRange ?? null,
    category: args.category,
    description: args.description,
  });
  logger.info(`[settings] seeded key='${args.key}' at global scope`);
}

/**
 * Append-only audit helper for non-settings mutations (decision overrides,
 * agent kill toggles, feature flag flips, etc.). Used by Phase B+ services
 * so every founder-visible change ends up in one timeline.
 */
export interface AuditArgs {
  founderId: string;
  area: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}
export async function recordAudit(args: AuditArgs): Promise<void> {
  await db.insert(founderAudit).values({
    founderId: args.founderId,
    area: args.area,
    action: args.action,
    targetType: args.targetType ?? null,
    targetId: args.targetId ?? null,
    before: args.before ?? null,
    after: args.after ?? null,
    note: args.note ?? null,
  });
}

// ─── Scope resolution + cache plumbing ──────────────────────────────────────

const SENTINEL_MISS = Symbol("settings.cache.miss");

function buildScopeChain(scope?: SettingScope): Array<[string, string | null]> {
  // Most specific first → fall back to global.
  if (!scope) return [["global", null]];
  const chain: Array<[string, string | null]> = [];
  if (scope.scope === "skill" && scope.scopeRef) {
    chain.push(["skill", scope.scopeRef]);
    // For a skill scope like 'sophie.send_retention_email', also probe the
    // parent agent scope by splitting on the last dot. Falls back to global.
    const lastDot = scope.scopeRef.lastIndexOf(".");
    if (lastDot > 0) {
      const agentRef = scope.scopeRef.slice(0, lastDot);
      chain.push(["agent", agentRef]);
    }
  } else if (scope.scope === "agent" && scope.scopeRef) {
    chain.push(["agent", scope.scopeRef]);
  } else if (scope.scope === "org" && scope.scopeRef) {
    chain.push(["org", scope.scopeRef]);
  }
  chain.push(["global", null]);
  return chain;
}

function readCache<T>(key: string, scope: string, scopeRef: string | null): T | typeof SENTINEL_MISS | undefined {
  const entry = cache.get(cacheKey(key, scope, scopeRef));
  if (!entry) return undefined;
  if (entry.expiresAt < clock.nowMs()) {
    cache.delete(cacheKey(key, scope, scopeRef));
    return undefined;
  }
  return entry.value as T | typeof SENTINEL_MISS;
}

function writeCache(key: string, scope: string, scopeRef: string | null, value: unknown): void {
  cache.set(cacheKey(key, scope, scopeRef), { value, expiresAt: clock.nowMs() + CACHE_TTL_MS });
  // Bounded cap so a runaway never blows memory.
  if (cache.size > 5000) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

function invalidateCache(key: string, scope: string, scopeRef: string | null): void {
  cache.delete(cacheKey(key, scope, scopeRef));
  // Also bust any narrower-scope cached values that might shadow this row.
  for (const cachedKey of cache.keys()) {
    if (cachedKey.endsWith(`|${key}`)) cache.delete(cachedKey);
  }
}

/** Test-only — clears the in-process cache. */
export function _resetSettingsCache(): void {
  cache.clear();
}
