/**
 * Pax pause kill-switch — the READ side (the pause PRIMITIVE).
 *
 * `POST /api/pax/pause` writes `users.autonomyPreferences.pax.pausedUntil`
 * (server/routes-pax-controls.ts). Storage is per-user, but the switch's
 * promise is org-level ("one red button pauses all of it"), so enforcement is
 * org-scoped: an ACTIVE pause held by the org owner or by any active team
 * member pauses Pax for the whole org. That is deliberately the fail-safe
 * direction — one panicked human stops the machine for everyone.
 *
 * ONE READER (AUTONOMY_SPEC.md §4.2). Engines do not call this module
 * directly any more: they call `getPaxControls(orgId)` in
 * server/services/paxControls.ts, which folds this pause state — expiry AND
 * holder — into the org's stance and switches in one read. This module stays
 * the primitive that reads the rows. The population of production files that
 * consult the pause (through either form) is pinned by
 * tests/unit/paxPauseCoverage.test.ts, DERIVED from UNATTENDED_PATHS in
 * shared/pax-controls.ts, in both directions: every registered path must gate
 * before dispatch, and no other production file may consult the switch
 * without being enumerated. A pause is always a SKIP, DEFER or PARK — never a
 * cancellation, never a failure mark: the work runs the moment the pause
 * lifts.
 *
 *   Model-driven tool dispatch (kernel)
 *   - server/ai/tools.ts (executeTool) — refuses record writes while paused;
 *     sends freeze as asks at every stance (looks and drafts still run).
 *   - server/ai/supportAgent.ts (executeSupportTool) — the same gate over the
 *     support agent's dispatch switch.
 *   - server/services/agent-skills.ts (executeSkill) — side-effecting skills
 *     are refused for every caller of the registry.
 *
 *   Scheduled Pax surfaces
 *   - server/services/paxScheduler.ts — a paused org's scheduled prompt is
 *     skipped (`skipped_paused`) and re-aimed at the moment the pause lifts.
 *   - server/jobs/leadCampaignJobs.ts + server/services/leadNurturer.ts —
 *     lead scoring / staging and campaign suggestions skip the org for the
 *     tick (`skipped_paused`; `skipped_off` when the org's switch is off).
 *   - server/services/paxNudges.ts + server/services/alerting.ts — no new
 *     cards for a paused org.
 *   - server/services/autonomousDecisionExecutor.ts — defers org-scoped inbox
 *     items for paused orgs until the pause lifts (founder lane).
 *
 *   Rules the customer turned on
 *   - server/services/workflow-engine.ts — a paused org's run PARKS
 *     (status "waiting", resumeAt = the lift, resumeState.reason "paused") and
 *     resumes whole; the resume sweep re-checks.
 *   - server/services/sequenceProcessor.ts — a step is DEFERRED
 *     (`deferred_paused`), never consumed, until the pause lifts; the
 *     frequency cap and quiet hours still meter on resume.
 *   - server/services/task-runner.ts — scheduled tasks return before
 *     executing, without advancing nextRunAt or counting a retry.
 *   - server/services/financeAgent.ts — nothing is prepared while paused
 *     (`pax_paused`); a prepared reminder always waits for a tap anyway.
 *   - server/routes-ai-draft.ts — inbox reply drafts keep drafting (a draft is
 *     not an action); the org's `inboxDrafts` switch is what it reads.
 *
 *   Read-only consumers (display or attribution; enforce nothing)
 *   - server/routes-pax-controls.ts — the Settings page reads ORG truth.
 *   - server/routes-pax-insights.ts — approve / revise: a tap is the human
 *     acting; the state is read for attribution only.
 *   - server/services/paxAskExecutors.ts — stance attribution on the ask
 *     receipt only; a tap is the human acting.
 *   - server/jobs/pendingActionExpiryJob.ts — stance attribution on the
 *     `ask_expired` receipt only.
 *   - server/routes-autonomy.ts — the pre-program settings surface, deleted
 *     by wave 1 C; listed only until the file is gone.
 *
 *   Aggregator (wraps this primitive; its consumers are the enforcers)
 *   - server/services/paxControls.ts (getPaxControls)
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
import { PAX_LABELS, PAX_PAUSE_COPY } from "@shared/pax-glossary";

/** The person whose `pax.pausedUntil` is the org's latest active pause. */
export interface PaxPauseHolder {
  userId: string;
  /** Display name, or the glossary's "a teammate" when no name is on file. */
  name: string;
}

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
   * Who holds that latest pause. Null when not paused, when the check failed,
   * or when the holding row carries no usable user id — never a fabricated
   * person.
   */
  pausedBy: PaxPauseHolder | null;
  /**
   * True when the DB read failed. Callers on side-effecting paths must treat
   * this as paused (fail closed) and say so honestly — never fabricate an
   * expiry time for it.
   */
  checkFailed: boolean;
}

interface PauseRow {
  id?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  prefs: unknown;
}

function holderOf(row: PauseRow): PaxPauseHolder | null {
  if (typeof row.id !== "string" || row.id.length === 0) return null;
  const name = [row.firstName, row.lastName]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
  return { userId: row.id, name: name || PAX_LABELS.unknownHolder };
}

function latestFuturePause(
  rows: PauseRow[],
  nowMs: number,
): { until: Date | null; holder: PaxPauseHolder | null } {
  let latest: Date | null = null;
  let holder: PaxPauseHolder | null = null;
  for (const row of rows) {
    const iso = (row.prefs as { pax?: { pausedUntil?: unknown } } | null)?.pax
      ?.pausedUntil;
    if (typeof iso !== "string") continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || t <= nowMs) continue;
    if (!latest || t > latest.getTime()) {
      latest = new Date(t);
      holder = holderOf(row);
    }
  }
  return { until: latest, holder };
}

/**
 * Org-level Pax pause state, holder included. Any active pause held by the
 * org owner or an active team member pauses the org. Fails CLOSED on read
 * errors.
 */
export async function getPaxPauseState(orgId: number): Promise<PaxPauseState> {
  try {
    const nowMs = Date.now();
    const shape = {
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      prefs: users.autonomyPreferences,
    };

    // Org owner's preferences (organizations.ownerId → users.id).
    const ownerRows = await db
      .select(shape)
      .from(users)
      .innerJoin(organizations, eq(organizations.ownerId, users.id))
      .where(eq(organizations.id, orgId));

    // Active team members' preferences.
    const memberRows = await db
      .select(shape)
      .from(users)
      .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
      .where(
        and(
          eq(teamMembers.organizationId, orgId),
          eq(teamMembers.isActive, true),
        ),
      );

    const { until, holder } = latestFuturePause([...ownerRows, ...memberRows], nowMs);
    return { paused: until !== null, pausedUntil: until, pausedBy: holder, checkFailed: false };
  } catch (err) {
    logger.error(
      "[paxPause] Pause-state read failed — failing CLOSED (treating org as paused)",
      err as Error,
      { orgId },
    );
    return { paused: true, pausedUntil: null, pausedBy: null, checkFailed: true };
  }
}

/**
 * The customer-visible refusal for a side-effecting action while paused, from
 * the glossary: a local time, the holder by name, never an ISO string, never
 * an invented expiry. Engines that hold a PaxControlsState should prefer
 * `paxControlsRefusalMessage` (server/services/paxControls.ts), which also
 * knows the org's timezone; this form prints in the runtime's zone.
 */
export function paxPauseRefusalMessage(state: PaxPauseState, timeZone?: string): string {
  if (state.checkFailed) return PAX_PAUSE_COPY.checkFailedRefusal;
  return PAX_PAUSE_COPY.refusal({
    until: state.pausedUntil,
    byName: state.pausedBy?.name ?? null,
    timeZone,
  });
}
