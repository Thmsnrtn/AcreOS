/**
 * Pax pause kill-switch — the READ side (Workstream A, Honesty).
 *
 * /settings/pax writes `users.autonomyPreferences.pax.pausedUntil` via
 * PATCH /api/me/autonomy (server/routes-autonomy.ts). Storage is per-user,
 * but the switch's promise is org-level ("Pause ALL Pax automation"), so
 * enforcement is org-scoped: an ACTIVE pause held by the org owner or by any
 * active team member pauses Pax for the whole org. That is deliberately the
 * fail-safe direction — one panicked human stops the machine for everyone.
 *
 * This module is the single source of truth consulted by the three
 * enforcement points:
 *   - server/ai/tools.ts (executeTool) — refuses side-effecting tool calls
 *     while paused (read-only lookups and drafts still run).
 *   - server/services/paxScheduler.ts — skips scheduled Pax tasks for paused
 *     orgs with a logged skip reason, never silently.
 *   - server/services/autonomousDecisionExecutor.ts — defers org-scoped
 *     inbox items for paused orgs until the pause lifts.
 *
 * Expiry is implicit: every read compares `pausedUntil` against now, so
 * behavior resumes automatically the moment the timestamp passes — no cron.
 *
 * Failure policy: if the pause-state read itself fails, we FAIL CLOSED
 * (report paused with `checkFailed: true`). A kill switch that silently
 * fails open would be the same lie this module exists to remove.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { organizations, teamMembers } from "@shared/schema";
import { users } from "@shared/models/auth";
import { logger } from "../utils/logger";

export interface PaxPauseState {
  /** True while any org user holds a future pax.pausedUntil (or the check failed). */
  paused: boolean;
  /**
   * Latest active pause expiry across the org's users. Null when not paused,
   * and null when the check failed (we don't know the real expiry and will
   * not invent one).
   */
  pausedUntil: Date | null;
  /**
   * True when the DB read failed. Callers on side-effecting paths must treat
   * this as paused (fail closed) and say so honestly — never fabricate an
   * expiry time for it.
   */
  checkFailed: boolean;
}

function latestFuturePause(
  rows: Array<{ prefs: unknown }>,
  nowMs: number,
): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    const iso = (row.prefs as { pax?: { pausedUntil?: unknown } } | null)?.pax
      ?.pausedUntil;
    if (typeof iso !== "string") continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || t <= nowMs) continue;
    if (!latest || t > latest.getTime()) latest = new Date(t);
  }
  return latest;
}

/**
 * Org-level Pax pause state. Any active pause held by the org owner or an
 * active team member pauses the org. Fails CLOSED on read errors.
 */
export async function getPaxPauseState(orgId: number): Promise<PaxPauseState> {
  try {
    const nowMs = Date.now();

    // Org owner's preferences (organizations.ownerId → users.id).
    const ownerRows = await db
      .select({ prefs: users.autonomyPreferences })
      .from(users)
      .innerJoin(organizations, eq(organizations.ownerId, users.id))
      .where(eq(organizations.id, orgId));

    // Active team members' preferences.
    const memberRows = await db
      .select({ prefs: users.autonomyPreferences })
      .from(users)
      .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
      .where(
        and(
          eq(teamMembers.organizationId, orgId),
          eq(teamMembers.isActive, true),
        ),
      );

    const pausedUntil = latestFuturePause([...ownerRows, ...memberRows], nowMs);
    return { paused: pausedUntil !== null, pausedUntil, checkFailed: false };
  } catch (err) {
    logger.error(
      "[paxPause] Pause-state read failed — failing CLOSED (treating org as paused)",
      err as Error,
      { orgId },
    );
    return { paused: true, pausedUntil: null, checkFailed: true };
  }
}

/**
 * The honest, user-visible refusal for a side-effecting action while paused.
 * Shown verbatim in chat when a tool call is refused.
 */
export function paxPauseRefusalMessage(state: PaxPauseState): string {
  if (state.checkFailed) {
    return (
      "Pax could not verify your pause setting, so this action was not " +
      "executed (failing closed). Try again, or check Settings → Pax controls."
    );
  }
  const until = state.pausedUntil
    ? state.pausedUntil.toISOString()
    : "the pause is cleared";
  return (
    `Pax is paused until ${until}; this action was not executed. ` +
    "Resume in Settings → Pax controls. Read-only lookups and drafts still work."
  );
}
