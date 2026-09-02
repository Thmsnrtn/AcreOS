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
 * This module is the single source of truth consulted by every enforcement
 * point. The population below is pinned by tests/unit/paxPauseCoverage.test.ts
 * in both directions: each listed file must call getPaxPauseState inside its
 * dispatch function, before dispatch, and no other production file may call
 * it without being added here. A pause is always a SKIP or DEFER — never a
 * cancellation, never a failure mark: the work runs the moment the pause
 * lifts.
 *
 *   Model-driven tool dispatch
 *   - server/ai/tools.ts (executeTool) — refuses side-effecting tool calls
 *     while paused (read-only lookups and drafts still run).
 *   - server/ai/supportAgent.ts (executeSupportTool) — same allowlist gate
 *     over the support agent's dispatch switch (added 2026-09-01; it was the
 *     population blind spot CLAUDE.md documents).
 *
 *   Scheduled / autonomous Pax surfaces
 *   - server/services/paxScheduler.ts — skips scheduled Pax tasks for paused
 *     orgs with a logged skip reason, never silently.
 *   - server/services/autonomousDecisionExecutor.ts — defers org-scoped
 *     inbox items for paused orgs until the pause lifts.
 *   - server/services/financeAgent.ts — parks ladder reminders as "queued"
 *     (not sent) for paused orgs.
 *
 *   Unattended execution engines (pause coverage, 2026-09-02 — before this
 *   the switch promised "every auto-execution path" and covered only the
 *   five above)
 *   - server/services/workflow-engine.ts (executeAction) — every acting
 *     workflow step (send_email, create_task, update_record,
 *     run_agent_skill, send_notification) returns a "blocked" result; the
 *     run continues, nothing sends, nothing is written.
 *   - server/services/sequenceProcessor.ts (sendStep) — Gate 0: the step is
 *     DEFERRED (not consumed) until the pause lifts, or 15 minutes out when
 *     the expiry is unknown.
 *   - server/services/leadNurturer.ts (processLeadsForOrg) — the org's
 *     nurturing pass is skipped for this tick (`skippedPaused: true`).
 *   - server/jobs/autonomousTaskProcessor.ts (processBatch) — a paused org's
 *     pending agent tasks are left pending; never failed, never cancelled.
 *   - server/services/agent-skills.ts (executeSkill) — side-effecting skills
 *     (anything not on PAUSE_SAFE_SKILLS) are refused for every caller of
 *     the registry.
 *   - server/services/task-runner.ts (runTask) — scheduled tasks return
 *     before executing, without advancing nextRunAt or counting a retry.
 *
 *   Read-only consumers (not enforcement points)
 *   - server/routes-autonomy.ts (GET /api/me/autonomy/org-pause) — the
 *     settings surface reads the ORG-WIDE state so "Clear pause" is honest
 *     when a teammate's pause is what holds the org.
 *   - server/services/paxAskExecutors.ts — reads the state (via
 *     getPaxControls) for stance attribution on the ask receipt only.
 *
 *   Aggregator (wraps this primitive; its consumers are the enforcers)
 *   - server/services/paxControls.ts (getPaxControls) — folds the pause
 *     into the org's stance for engines that consult the "one reader".
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
