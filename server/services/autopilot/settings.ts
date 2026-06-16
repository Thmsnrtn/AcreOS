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

/** Read the effective settings (DB row if present, else env). Never throws. */
export async function getEffectiveSettings(now = Date.now()): Promise<EffectiveSettings> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  let value: EffectiveSettings = {
    dispatchEnabled: envDispatch(),
    publishEnabled: envPublish(),
    source: { dispatch: "env", publish: "env" },
  };
  try {
    const [row] = await db.select().from(autopilotSettings).where(eq(autopilotSettings.id, 1)).limit(1);
    if (row) {
      value = {
        dispatchEnabled: row.dispatchEnabled ?? envDispatch(),
        publishEnabled: row.publishEnabled ?? envPublish(),
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

/** Flip a master switch (founder action). Upserts the singleton + busts the cache. */
export async function setAutopilotSetting(
  key: "dispatchEnabled" | "publishEnabled",
  value: boolean,
  updatedBy?: string,
): Promise<EffectiveSettings> {
  const col = key === "dispatchEnabled" ? "dispatch_enabled" : "publish_enabled";
  await db
    .insert(autopilotSettings)
    .values({ id: 1, [key === "dispatchEnabled" ? "dispatchEnabled" : "publishEnabled"]: value, updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: autopilotSettings.id,
      set: { [key === "dispatchEnabled" ? "dispatchEnabled" : "publishEnabled"]: value, updatedAt: new Date(), updatedBy: updatedBy ?? null },
    });
  logger.warn("[autopilot/settings] master switch flipped by founder", { key, value, col });
  cache = null;
  return getEffectiveSettings();
}
