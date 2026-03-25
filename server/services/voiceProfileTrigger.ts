/**
 * Voice Profile Auto-Build Trigger
 *
 * Automatically rebuilds voice profiles when new communication samples
 * accumulate past a threshold. Called after outbound emails, SMS, notes, and
 * campaign sends so profiles stay fresh without manual intervention.
 */

import { voiceLearningService } from "./voiceLearning";
import { logger } from "../utils/logger";

const REBUILD_THRESHOLD = 10; // new samples since last build
const MIN_REBUILD_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Track new sample counts per org since last rebuild
const newSampleCounts = new Map<number, { count: number; lastRebuilt: number }>();

/**
 * Call after any outbound communication (email, SMS, note, campaign copy).
 * When enough new samples accumulate, triggers a background voice profile rebuild.
 */
export function onNewCommunication(organizationId: number): void {
  const entry = newSampleCounts.get(organizationId) ?? { count: 0, lastRebuilt: 0 };
  entry.count++;
  newSampleCounts.set(organizationId, entry);

  if (entry.count >= REBUILD_THRESHOLD) {
    const now = Date.now();
    if (now - entry.lastRebuilt < MIN_REBUILD_INTERVAL_MS) return;

    // Reset counter and trigger async rebuild
    entry.count = 0;
    entry.lastRebuilt = now;
    newSampleCounts.set(organizationId, entry);

    rebuildProfileAsync(organizationId);
  }
}

/**
 * Force a profile rebuild (e.g., from an admin route or after import).
 */
export async function forceRebuild(organizationId: number): Promise<void> {
  voiceLearningService.invalidateProfile(organizationId);
  await voiceLearningService.buildProfile(organizationId);
  const entry = newSampleCounts.get(organizationId) ?? { count: 0, lastRebuilt: 0 };
  entry.count = 0;
  entry.lastRebuilt = Date.now();
  newSampleCounts.set(organizationId, entry);
}

function rebuildProfileAsync(organizationId: number): void {
  voiceLearningService.invalidateProfile(organizationId);
  voiceLearningService.buildProfile(organizationId).catch((err) => {
    logger.error("Voice profile auto-rebuild failed", err instanceof Error ? err : undefined, {
      organizationId,
    });
  });
}
