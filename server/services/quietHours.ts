// @ts-nocheck
/**
 * Quiet Hours — Sovereign Company Protocol v4
 *
 * Agents still run during quiet hours (they queue decisions and actions),
 * but NO notifications are sent to the CEO. No buzzing at 2am.
 *
 * Emergency override: critical alerts break quiet hours if configured.
 * At quiet hours end, a consolidated "overnight summary" is sent.
 */

import { db } from "../db";
import { quietHoursConfig } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Check if current time falls within quiet hours.
 */
export async function isQuietHours(): Promise<boolean> {
  const config = await getQuietHoursConfig();
  if (!config || !config.isActive) return false;

  // Get current hour in the configured timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    hour: "numeric",
    hour12: false,
  });
  const currentHour = parseInt(formatter.format(now), 10);

  // Get current day of week (0=Sunday)
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    weekday: "narrow",
  });
  const dayOfWeek = now.getDay();

  // Check if today is a quiet day
  const daysOfWeek = (config.daysOfWeek as number[]) || [0, 1, 2, 3, 4, 5, 6];
  if (!daysOfWeek.includes(dayOfWeek)) return false;

  // Handle overnight ranges (e.g., 22:00 - 07:00)
  if (config.startHour > config.endHour) {
    return currentHour >= config.startHour || currentHour < config.endHour;
  }

  // Same-day range (e.g., 13:00 - 15:00)
  return currentHour >= config.startHour && currentHour < config.endHour;
}

/**
 * Check if an emergency should break quiet hours.
 */
export async function shouldBreakQuietHours(severity: string): Promise<boolean> {
  const config = await getQuietHoursConfig();
  if (!config) return true; // No config = always notify

  // Only critical severity breaks quiet hours (if enabled)
  return config.emergencyOverride && severity === "critical";
}

/**
 * Get the quiet hours configuration.
 */
export async function getQuietHoursConfig() {
  const configs = await db.select()
    .from(quietHoursConfig)
    .orderBy(desc(quietHoursConfig.updatedAt))
    .limit(1);

  return configs[0] || null;
}

/**
 * Set quiet hours configuration.
 */
export async function setQuietHours(params: {
  startHour: number;
  endHour: number;
  timezone?: string;
  daysOfWeek?: number[];
  emergencyOverride?: boolean;
  isActive: boolean;
}): Promise<void> {
  const existing = await getQuietHoursConfig();

  if (existing) {
    await db.update(quietHoursConfig)
      .set({
        startHour: params.startHour,
        endHour: params.endHour,
        timezone: params.timezone || existing.timezone,
        daysOfWeek: params.daysOfWeek || existing.daysOfWeek,
        emergencyOverride: params.emergencyOverride ?? existing.emergencyOverride,
        isActive: params.isActive,
        updatedAt: new Date(),
      })
      .where(eq(quietHoursConfig.id, existing.id));
  } else {
    await db.insert(quietHoursConfig).values({
      startHour: params.startHour,
      endHour: params.endHour,
      timezone: params.timezone || "America/Chicago",
      daysOfWeek: params.daysOfWeek || [0, 1, 2, 3, 4, 5, 6],
      emergencyOverride: params.emergencyOverride ?? true,
      isActive: params.isActive,
    });
  }

  console.log(`[QuietHours] ${params.isActive ? "Enabled" : "Disabled"}: ${params.startHour}:00 - ${params.endHour}:00`);
}
