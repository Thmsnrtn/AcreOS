/**
 * One-shot boot reconcile for Pillar R trust graduation (2026-07).
 *
 * The old auto-promotion ladder graduated (agent, action_category) pairs
 * to "silent" (auto-execute, NO notification) after 50 consecutive
 * acceptances — an agent unilaterally expanding its own authority, which
 * Sovereign Principle 10 forbids. The ladder is now clamped at
 * notify_only (see trustGraduation.ts); this module re-collars the rows
 * already graduated under the old rule: every "silent" pair WITHOUT the
 * founder's explicit force_silent override is demoted to "notify_only".
 *
 * One-shot: guarded by a platform_settings marker so boot re-runs never
 * repeat the demotion (a founder may legitimately force_silent a pair
 * afterward, and later boots must not undo that decision's neighbors'
 * context). Fail-open: a failure logs and retries next boot (marker
 * written only after the reconcile succeeds).
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { platformSettings } from "@shared/schema";
import { logger } from "../utils/logger";

const MARKER_KEY = "trust_graduation.silent_recollar_2026_07";

export async function recollarSilentTiersOnce(): Promise<"reconciled" | "already_reconciled" | "failed"> {
  try {
    const existing = await db
      .select({ id: platformSettings.id })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.scope, "global"),
          isNull(platformSettings.scopeRef),
          eq(platformSettings.key, MARKER_KEY),
        ),
      )
      .limit(1);
    if (existing.length > 0) return "already_reconciled";

    const { reconcileSilentTiers } = await import("./trustGraduation");
    const { demoted } = await reconcileSilentTiers();

    await db.insert(platformSettings).values({
      key: MARKER_KEY,
      scope: "global",
      scopeRef: null,
      value: { reconciledAt: new Date().toISOString(), demoted },
      defaultValue: {},
      category: "autopilot",
      description:
        "One-shot marker: 2026-07 trust-graduation re-collar — silent tiers without founder force_silent demoted to notify_only (Sovereign Principle 10).",
      lastChangedBy: "trust-graduation-recollar",
      lastChangedAt: new Date(),
    });
    logger.info(`[trustGraduationReconcile] re-collar complete — ${demoted} silent tier(s) demoted to notify_only (founder force_silent rows untouched)`);
    return "reconciled";
  } catch (err) {
    logger.error(
      "[trustGraduationReconcile] re-collar failed — will retry next boot (marker not written)",
      err instanceof Error ? err : undefined,
    );
    return "failed";
  }
}
