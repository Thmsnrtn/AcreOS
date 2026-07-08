/**
 * Founder Autopilot — runtime settings (the master switches).
 *
 * The hands (dispatch consumer) and the publish path are gated by switches the
 * founder can flip from the Control Center. Those switches are DB-backed
 * (singleton `autopilot_settings` row) so flipping them is a tap, not a Fly
 * secret + redeploy.
 *
 * Safety default: a null column falls back to the ENV default, and the env
 * default is OFF. So the system stays safe-off until a real row says otherwise —
 * the DB can only ever turn things on/off explicitly, never accidentally enable.
 *
 * Reads are cached briefly because the consumer polls every few seconds; the
 * cache TTL bounds how stale a flip can be (≤ a few seconds).
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { autopilotSettings } from "@shared/schema";
import { logger } from "../../utils/logger";

export interface EffectiveSettings {
  dispatchEnabled: boolean;
  publishEnabled: boolean;
  /** Master switch for the autonomous daily Operator cadence (cognition layer). */
  cognitionEnabled: boolean;
  /** Master switch for the immune system's motor half (gated self-patch PRs). */
  selfPatchEnabled: boolean;
  /**
   * DB-backed monthly growth-budget cap (USD) an approved ramp wrote, or null
   * when none — in which case the env/charter default governs. The cap reader
   * (capitalTracker.getEffectiveMonthlyCapUsd) clamps this to a hard ceiling.
   */
  growthBudgetOverrideUsd: number | null;
  /** Whether each value came from an explicit DB row vs the env fallback. */
  source: { dispatch: "db" | "env"; publish: "db" | "env" };
}

const CACHE_TTL_MS = 5_000;
let cache: { at: number; value: EffectiveSettings } | null = null;

function envDispatch(): boolean {
  return process.env.SOLENE_DISPATCH_ENABLED === "true";
}
function envPublish(): boolean {
  return process.env.AUTOPILOT_PUBLISH_ENABLED === "true";
}
function envCognition(): boolean {
  return process.env.COGNITION_ENABLED === "true";
}
function envSelfPatch(): boolean {
  return process.env.SELF_PATCH_ENABLED === "true";
}

/**
 * The hard, OUT-OF-REACH off-switch (kernel-elevation T0.3). SOLENE_PANIC_STOP is
 * an env/secret the autopilot cannot write (it has no shell + no env-write tool),
 * so it overrides the DB switches UNCONDITIONALLY: when set, every master switch
 * reads OFF regardless of the DB row or the cache — a kill the agent can never
 * undo by itself. The founder-facing panicStop() (panicStop.ts) flips the DB
 * switches for the routine atomic STOP; this env is the last-resort floor.
 */
export function isPanicStopped(): boolean {
  const v = process.env.SOLENE_PANIC_STOP;
  return v === "true" || v === "1";
}

const ALL_OFF = (): EffectiveSettings => ({
  dispatchEnabled: false,
  publishEnabled: false,
  cognitionEnabled: false,
  selfPatchEnabled: false,
  growthBudgetOverrideUsd: null,
  source: { dispatch: "env", publish: "env" },
});

/** TEST-ONLY: drop the read cache so env changes take effect immediately. */
export function __resetSettingsCacheForTest(): void {
  cache = null;
}

/** Read the effective settings (DB row if present, else env). Never throws. */
export async function getEffectiveSettings(now = Date.now()): Promise<EffectiveSettings> {
  // The out-of-reach kill wins over everything, every read — never cached-on.
  if (isPanicStopped()) return ALL_OFF();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  let value: EffectiveSettings = {
    dispatchEnabled: envDispatch(),
    publishEnabled: envPublish(),
    cognitionEnabled: envCognition(),
    selfPatchEnabled: envSelfPatch(),
    growthBudgetOverrideUsd: null,
    source: { dispatch: "env", publish: "env" },
  };
  try {
    const [row] = await db.select().from(autopilotSettings).where(eq(autopilotSettings.id, 1)).limit(1);
    if (row) {
      value = {
        dispatchEnabled: row.dispatchEnabled ?? envDispatch(),
        publishEnabled: row.publishEnabled ?? envPublish(),
        cognitionEnabled: row.cognitionEnabled ?? envCognition(),
        selfPatchEnabled: row.selfPatchEnabled ?? envSelfPatch(),
        growthBudgetOverrideUsd:
          row.growthBudgetOverrideUsd != null && Number.isFinite(row.growthBudgetOverrideUsd)
            ? row.growthBudgetOverrideUsd
            : null,
        source: { dispatch: row.dispatchEnabled == null ? "env" : "db", publish: row.publishEnabled == null ? "env" : "db" },
      };
    }
  } catch (err) {
    logger.warn("[autopilot/settings] read failed; using env defaults", err instanceof Error ? err : undefined);
  }
  cache = { at: now, value };
  return value;
}

export async function isDispatchEnabled(): Promise<boolean> {
  return (await getEffectiveSettings()).dispatchEnabled;
}
export async function isPublishEnabled(): Promise<boolean> {
  return (await getEffectiveSettings()).publishEnabled;
}
export async function isCognitionEnabled(): Promise<boolean> {
  return (await getEffectiveSettings()).cognitionEnabled;
}
export async function isSelfPatchEnabled(): Promise<boolean> {
  return (await getEffectiveSettings()).selfPatchEnabled;
}

/** Flip a master switch (founder action). Upserts the singleton + busts the cache. */
export async function setAutopilotSetting(
  key: "dispatchEnabled" | "publishEnabled" | "cognitionEnabled" | "selfPatchEnabled",
  value: boolean,
  updatedBy?: string,
): Promise<EffectiveSettings> {
  // Explicit per-column branches (not a computed key) so the static
  // schema-column validator can resolve the references.
  const stamp = { updatedAt: new Date(), updatedBy: updatedBy ?? null };
  if (key === "dispatchEnabled") {
    await db
      .insert(autopilotSettings)
      .values({ id: 1, dispatchEnabled: value, updatedBy: updatedBy ?? null })
      .onConflictDoUpdate({ target: autopilotSettings.id, set: { dispatchEnabled: value, ...stamp } });
  } else if (key === "cognitionEnabled") {
    await db
      .insert(autopilotSettings)
      .values({ id: 1, cognitionEnabled: value, updatedBy: updatedBy ?? null })
      .onConflictDoUpdate({ target: autopilotSettings.id, set: { cognitionEnabled: value, ...stamp } });
  } else if (key === "selfPatchEnabled") {
    await db
      .insert(autopilotSettings)
      .values({ id: 1, selfPatchEnabled: value, updatedBy: updatedBy ?? null })
      .onConflictDoUpdate({ target: autopilotSettings.id, set: { selfPatchEnabled: value, ...stamp } });
  } else {
    await db
      .insert(autopilotSettings)
      .values({ id: 1, publishEnabled: value, updatedBy: updatedBy ?? null })
      .onConflictDoUpdate({ target: autopilotSettings.id, set: { publishEnabled: value, ...stamp } });
  }
  logger.warn("[autopilot/settings] master switch flipped by founder", { key, value });
  cache = null;
  return getEffectiveSettings();
}

/**
 * Write the DB-backed growth-budget cap (the apply-side of an approved budget
 * ramp). Pass null to clear it (revert to the env/charter default). Upserts the
 * singleton + busts the cache. The cap reader still clamps to a hard ceiling, so
 * this can never set an unbounded budget.
 */
export async function setGrowthBudgetOverrideUsd(
  value: number | null,
  updatedBy?: string,
): Promise<EffectiveSettings> {
  const clean = value != null && Number.isFinite(value) && value > 0 ? value : null;
  await db
    .insert(autopilotSettings)
    .values({ id: 1, growthBudgetOverrideUsd: clean, updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: autopilotSettings.id,
      set: { growthBudgetOverrideUsd: clean, updatedAt: new Date(), updatedBy: updatedBy ?? null },
    });
  logger.warn("[autopilot/settings] growth budget cap override set", { value: clean, updatedBy });
  cache = null;
  return getEffectiveSettings();
}
