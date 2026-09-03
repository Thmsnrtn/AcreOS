/**
 * /api/pax/controls · /pause · /resume · /receipts — the ONE customer surface
 * behind Settings → Pax (AUTONOMY_SPEC.md §3a, §4.5, §4.6, §4.7).
 *
 * Mounted on the existing /api/pax router in server/routes.ts (same auth
 * posture as routes-pax-insights.ts: isAuthenticated + getOrCreateOrg; the
 * org comes from req.organization, never from the client).
 *
 *   GET   /controls   org truth — stance, switches, the pause with its
 *                     holder, and every "right now" / "runs on its own"
 *                     number read from a real row. True zeros are zeros;
 *                     a value with no row is null. NEVER the caller's own
 *                     preferences: the pause is org-wide by construction
 *                     (server/services/paxPause.ts), so "Pax is active"
 *                     cannot show while a teammate holds a pause.
 *   POST  /pause      { until: "tomorrow_8am" | "3d" | "30d" } — any active
 *                     member. Writes the CALLER's users.autonomyPreferences
 *                     .pax.pausedUntil (the primitive the engines read);
 *                     "tomorrow 8 am" is computed in the caller's zone when
 *                     the client sends one, else the org's.
 *   POST  /resume     owner / admin clears EVERY org user's pausedUntil; a
 *                     member clears only their own row. The response is org
 *                     truth either way, so a member who resumes while a
 *                     teammate still holds a pause sees "Paused", not a lie.
 *   PATCH /controls   { stance?, leadScoring?, borrowerReminders?,
 *                     inboxDrafts? } — zod .strict(): any other key, or a
 *                     stance outside OFFERED_STANCES, is 422. Cannot touch
 *                     pausedUntil (the pause has its own two routes above;
 *                     routes-autonomy.ts's shallow-merge clobber is gone
 *                     with that file). Owner / admin only.
 *   GET   /receipts   "What Pax did" — server/services/paxReceiptsReader.ts.
 *
 * Every response of the four control routes is the SAME controls object, so
 * the page has one shape to render. A controls read that FAILED (the column
 * unreadable, the pause rows unreadable) is refused with the glossary's
 * "could not verify" line — a failed read is not a stance, and the page must
 * not render one (wave-1 decision i).
 *
 * Pause and Resume each leave a receipt in "What Pax did" whose counts are
 * read from the rows the pause will hold — active sequence enrollments,
 * active workflows, active scheduled prompts — and the live ask count.
 *
 * Read-only consumer of the pause state (tests/unit/paxPauseCoverage.test.ts
 * PAUSE_READ_ONLY_CONSUMERS): this file displays and records the state; it
 * enforces nothing.
 */

import { Router, type Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users, type AutonomyPreferences } from "@shared/models/auth";
import {
  activityLog,
  agentMemory,
  campaignSequences,
  leads,
  organizations,
  paxScheduledTasks,
  paymentReminders,
  sequenceEnrollments,
  teamMembers,
  workflowRuns,
  workflows,
  type Organization,
} from "@shared/schema";
import { isLiveWorkflowTriggerEvent } from "@shared/workflow-live-triggers";
import { OFFERED_STANCES, type PaxControls } from "@shared/pax-controls";
import { PAX_LABELS, PAX_PAUSE_COPY } from "@shared/pax-glossary";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { getUserPermissionContext, isAdminOrAbove } from "./utils/permissions";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { getPaxControls, type PaxControlsState } from "./services/paxControls";
import { countPendingActions } from "./services/approvalKernel";
import { recordPaxEffect } from "./services/paxReceipts";
import { listPaxReceipts } from "./services/paxReceiptsReader";
import { REMINDER_STATUS } from "./services/financeAgent";

const router = Router();

// ── The fixed send envelope ────────────────────────────────────────────────
// The numbers the post-tap limiter enforces (server/services/autonomyGuardrails
// .ts: EMAIL_DAILY_LIMIT / SMS_DAILY_LIMIT). Printed read-only on the page
// beside today's usage, which is read from the SAME agent_memory row the
// limiter counts — so the page can never show room the limiter would refuse.
const EMAIL_DAILY_LIMIT = 50;
const SMS_DAILY_LIMIT = 20;

/** The one row the limiter reads for today (autonomyGuardrails.checkSendRateLimit). */
function sendLogKeyForToday(now: Date): string {
  return `autonomous_send_log_${now.toISOString().slice(0, 10)}`;
}

// ── Zone arithmetic (no library; Intl only) ────────────────────────────────

interface ZoneParts { y: number; m: number; d: number; h: number; mi: number; s: number }

function zoneParts(date: Date, timeZone: string): ZoneParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

/** Zone offset (local wall clock minus UTC) at `date`, in ms. */
function offsetMsAt(date: Date, timeZone: string): number {
  const p = zoneParts(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - date.getTime();
}

/** The instant at which the zone's wall clock reads y-m-d h:00 (day may overflow). */
function zonedToUtc(y: number, m: number, d: number, h: number, timeZone: string): Date {
  const wall = Date.UTC(y, m - 1, d, h);
  const first = offsetMsAt(new Date(wall), timeZone);
  let result = wall - first;
  // A DST edge between the guess and the target shifts the offset once; a
  // second pass lands it.
  const second = offsetMsAt(new Date(result), timeZone);
  if (second !== first) result = wall - second;
  return new Date(result);
}

/** Local midnight of `now` in the zone. */
function startOfTodayIn(timeZone: string, now: Date = new Date()): Date {
  const p = zoneParts(now, timeZone);
  return zonedToUtc(p.y, p.m, p.d, 0, timeZone);
}

/** Tomorrow at `hour`:00 in the zone. */
function tomorrowAtIn(hour: number, timeZone: string, now: Date = new Date()): Date {
  const p = zoneParts(now, timeZone);
  return zonedToUtc(p.y, p.m, p.d + 1, hour, timeZone);
}

/** An IANA zone Intl accepts, or null — never a zone we cannot print. */
function validZone(tz: unknown): string | null {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

// ── Who is asking ──────────────────────────────────────────────────────────

interface Caller {
  userId: string;
  role: string;
  /** Owner or admin — may change the stance / switches and resume for everyone. */
  isAdmin: boolean;
}

async function resolveCaller(req: AuthenticatedRequest, org: Organization): Promise<Caller> {
  const userId = getUserId(req);
  if (org.ownerId === userId) return { userId, role: "owner", isAdmin: true };
  const ctx = await getUserPermissionContext(req.user, org);
  const role = ctx?.role ?? "member";
  return { userId, role, isAdmin: isAdminOrAbove(role) };
}

// ── The numbers (every one from a row) ─────────────────────────────────────

interface RulesRunning { workflows: number; sequences: number; scheduledPrompts: number }

async function readRulesRunning(orgId: number): Promise<RulesRunning> {
  const [wf] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workflows)
    .where(and(eq(workflows.organizationId, orgId), eq(workflows.isActive, true)));
  const [seq] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sequenceEnrollments)
    .innerJoin(campaignSequences, eq(sequenceEnrollments.sequenceId, campaignSequences.id))
    .where(and(eq(campaignSequences.organizationId, orgId), eq(sequenceEnrollments.status, "active")));
  const [prompts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paxScheduledTasks)
    .where(and(eq(paxScheduledTasks.organizationId, orgId), eq(paxScheduledTasks.isActive, true)));
  return {
    workflows: Number(wf?.n ?? 0),
    sequences: Number(seq?.n ?? 0),
    scheduledPrompts: Number(prompts?.n ?? 0),
  };
}

const iso = (d: Date | null | undefined): string | null => (d instanceof Date ? d.toISOString() : null);

async function readRunsOnItsOwn(orgId: number, startOfToday: Date, now: Date) {
  // Workflows: active count, how many of those sit on a trigger that really
  // fires today (LIVE_WORKFLOW_TRIGGER_EVENTS), and the last run's start.
  const wfRows = await db
    .select({ isActive: workflows.isActive, trigger: workflows.trigger })
    .from(workflows)
    .where(eq(workflows.organizationId, orgId));
  const activeWorkflows = wfRows.filter((w) => w.isActive);
  const liveWorkflows = activeWorkflows.filter((w) => isLiveWorkflowTriggerEvent(String(w.trigger?.event ?? "")));
  const [lastRun] = await db
    .select({ at: sql<Date | null>`max(${workflowRuns.startedAt})` })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
    .where(eq(workflows.organizationId, orgId));

  // Sequences: active enrollments and the last step that ACTUALLY went out
  // (lastStepSentAt is stamped only on a real send — sequenceProcessor).
  const [seq] = await db
    .select({
      active: sql<number>`count(*) filter (where ${sequenceEnrollments.status} = 'active')::int`,
      lastSendAt: sql<Date | null>`max(${sequenceEnrollments.lastStepSentAt})`,
    })
    .from(sequenceEnrollments)
    .innerJoin(campaignSequences, eq(sequenceEnrollments.sequenceId, campaignSequences.id))
    .where(eq(campaignSequences.organizationId, orgId));

  // Scheduled prompts: the rows themselves, with their own last run.
  const promptRows = await db
    .select({
      id: paxScheduledTasks.id,
      name: paxScheduledTasks.name,
      isActive: paxScheduledTasks.isActive,
      lastRunAt: paxScheduledTasks.lastRunAt,
      lastRunStatus: paxScheduledTasks.lastRunStatus,
      nextRunAt: paxScheduledTasks.nextRunAt,
    })
    .from(paxScheduledTasks)
    .where(eq(paxScheduledTasks.organizationId, orgId))
    .orderBy(desc(paxScheduledTasks.createdAt));

  // Lead scoring: the last lead the job scored, and how many today.
  const [scoring] = await db
    .select({
      lastRanAt: sql<Date | null>`max(${leads.lastScoreAt})`,
      rescoredToday: sql<number>`count(*) filter (where ${leads.lastScoreAt} >= ${startOfToday})::int`,
    })
    .from(leads)
    .where(eq(leads.organizationId, orgId));

  // Borrower reminders prepared and parked for a tap.
  const [reminders] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentReminders)
    .where(
      and(eq(paymentReminders.organizationId, orgId), eq(paymentReminders.status, REMINDER_STATUS.awaitingApproval)),
    );

  // Today's usage against the fixed envelope — the limiter's own row.
  const [sendLog] = await db
    .select({ value: agentMemory.value })
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.organizationId, orgId),
        eq(agentMemory.agentType, "pax"),
        eq(agentMemory.memoryType, "fact"),
        eq(agentMemory.key, sendLogKeyForToday(now)),
      ),
    )
    .limit(1);
  const sends: Array<{ channelType?: unknown }> = Array.isArray((sendLog?.value as { sends?: unknown })?.sends)
    ? ((sendLog!.value as { sends: Array<{ channelType?: unknown }> }).sends)
    : [];
  const emailsUsedToday = sends.filter((s) => s.channelType === "email").length;
  const textsUsedToday = sends.filter((s) => s.channelType === "sms").length;

  return {
    workflows: {
      active: activeWorkflows.length,
      live: liveWorkflows.length,
      lastRanAt: iso(lastRun?.at ?? null),
    },
    sequences: {
      activeEnrollments: Number(seq?.active ?? 0),
      lastSendAt: iso(seq?.lastSendAt ?? null),
    },
    scheduledPrompts: promptRows.map((p) => ({
      id: p.id,
      name: p.name,
      isActive: p.isActive,
      lastRunAt: iso(p.lastRunAt),
      lastRunStatus: p.lastRunStatus ?? null,
      nextRunAt: iso(p.nextRunAt),
    })),
    leadScoring: {
      lastRanAt: iso(scoring?.lastRanAt ?? null),
      rescoredToday: Number(scoring?.rescoredToday ?? 0),
    },
    borrowerReminders: { waiting: Number(reminders?.n ?? 0) },
    fixedRules: {
      emailsUsedToday,
      emailLimit: EMAIL_DAILY_LIMIT,
      textsUsedToday,
      textLimit: SMS_DAILY_LIMIT,
    },
  };
}

async function readChangedTodayOnItsOwn(orgId: number, startOfToday: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.organizationId, orgId),
        eq(activityLog.agentType, "pax"),
        gte(activityLog.createdAt, startOfToday),
        sql`${activityLog.metadata}->>'how' = 'onItsOwn'`,
      ),
    );
  return Number(row?.n ?? 0);
}

// ── The controls object ────────────────────────────────────────────────────

type ControlsPayload = Record<string, unknown>;

/**
 * Build the one object every control route returns. Returns `null` when the
 * controls could not be read — the caller refuses with the glossary line.
 */
async function buildControls(
  req: AuthenticatedRequest,
  org: Organization,
): Promise<{ payload: ControlsPayload; state: PaxControlsState } | { payload: null; state: PaxControlsState }> {
  const orgId = org.id;
  const state = await getPaxControls(orgId);
  if (state.checkFailed) return { payload: null, state };

  const now = new Date();
  const startOfToday = startOfTodayIn(state.timezone, now);
  const caller = await resolveCaller(req, org);

  const [waiting, changedTodayOnItsOwn, rulesRunning, runsOnItsOwn] = await Promise.all([
    countPendingActions(orgId),
    readChangedTodayOnItsOwn(orgId, startOfToday),
    readRulesRunning(orgId),
    readRunsOnItsOwn(orgId, startOfToday, now),
  ]);

  const pauseWords = {
    until: state.pausedUntil,
    byName: state.pausedBy?.name ?? null,
    timeZone: state.timezone,
  };

  const payload: ControlsPayload = {
    paused: state.paused,
    pausedUntil: iso(state.pausedUntil),
    pausedBy: state.pausedBy ? { userId: state.pausedBy.userId, name: state.pausedBy.name } : null,
    checkFailed: false,
    stance: state.stance,
    canChangeStance: caller.isAdmin,
    canResume: caller.isAdmin || (state.pausedBy?.userId != null && state.pausedBy.userId === caller.userId),
    switches: {
      leadScoring: state.leadScoring,
      borrowerReminders: state.borrowerReminders,
      inboxDrafts: state.inboxDrafts,
    },
    rightNow: { waiting, changedTodayOnItsOwn, rulesRunning },
    runsOnItsOwn,
    // Convenience for the page: the glossary lines, printed in the ORG zone.
    timezone: state.timezone,
    statusLine: state.paused ? PAX_PAUSE_COPY.statusLine(pauseWords) : PAX_LABELS.active,
    pausedSentence: state.paused ? PAX_PAUSE_COPY.sentence(pauseWords) : null,
  };
  return { payload, state };
}

/** Refuse a controls read that could not be verified (decision i). */
function refuseUnverified(res: Response): void {
  Errors.serviceUnavailable(res, PAX_PAUSE_COPY.checkFailedRefusal);
}

// ── GET /controls ──────────────────────────────────────────────────────────

router.get("/controls", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const built = await buildControls(req, org);
    if (!built.payload) return refuseUnverified(res);
    return res.json(built.payload);
  } catch (error) {
    logger.error("[pax-controls] GET /controls failed", error as Error, { orgId: req.organization?.id });
    return Errors.internal(res, error);
  }
});

// ── Pause primitive writes (users.autonomyPreferences.pax.pausedUntil) ─────

interface PauseRow { id: string; prefs: AutonomyPreferences | null }

async function readUserPrefs(userId: string): Promise<AutonomyPreferences | null> {
  const [row] = await db
    .select({ prefs: users.autonomyPreferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.prefs ?? null;
}

async function writePausedUntil(userId: string, prefs: AutonomyPreferences | null, until: Date | null): Promise<void> {
  const pax: { pausedUntil?: string } = { ...(prefs?.pax ?? {}) };
  if (until) pax.pausedUntil = until.toISOString();
  else delete pax.pausedUntil;
  const next: AutonomyPreferences = { ...(prefs ?? {}), pax };
  await db.update(users).set({ autonomyPreferences: next, updatedAt: new Date() }).where(eq(users.id, userId));
}

/** The org's owner and active members, with their preference rows — the union the primitive reads. */
async function orgUserRows(orgId: number): Promise<PauseRow[]> {
  const shape = { id: users.id, prefs: users.autonomyPreferences };
  const ownerRows = await db
    .select(shape)
    .from(users)
    .innerJoin(organizations, eq(organizations.ownerId, users.id))
    .where(eq(organizations.id, orgId));
  const memberRows = await db
    .select(shape)
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.isActive, true)));
  const seen = new Map<string, PauseRow>();
  for (const r of [...ownerRows, ...memberRows]) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

function holdsFuturePause(prefs: AutonomyPreferences | null, nowMs: number): boolean {
  const raw = prefs?.pax?.pausedUntil;
  if (typeof raw !== "string") return false;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t > nowMs;
}

/** "2 sequences, 1 workflow, 1 scheduled prompt" — counts from the rows the pause holds. */
function rulesClause(rules: RulesRunning): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    plural(rules.sequences, "sequence", "sequences"),
    plural(rules.workflows, "workflow", "workflows"),
    plural(rules.scheduledPrompts, "scheduled prompt", "scheduled prompts"),
  ].join(", ");
}

const pauseUntilSchema = z
  .object({
    until: z.enum(["tomorrow_8am", "3d", "30d"]),
    /** Optional IANA zone from the browser; "tomorrow 8 am" is computed in it. */
    timeZone: z.string().max(64).optional(),
  })
  .strict();

const DAY_MS = 24 * 60 * 60 * 1000;

// ── POST /pause ────────────────────────────────────────────────────────────

router.post("/pause", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const orgId = getOrganizationId(req);
    const parsed = pauseUntilSchema.safeParse(req.body ?? {});
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

    const before = await getPaxControls(orgId);
    const now = new Date();
    const zone = validZone(parsed.data.timeZone) ?? before.timezone;
    const until =
      parsed.data.until === "tomorrow_8am"
        ? tomorrowAtIn(8, zone, now)
        : parsed.data.until === "3d"
          ? new Date(now.getTime() + 3 * DAY_MS)
          : new Date(now.getTime() + 30 * DAY_MS);

    const caller = await resolveCaller(req, org);
    const prefs = await readUserPrefs(caller.userId);
    await writePausedUntil(caller.userId, prefs, until);

    logger.info("[pax-controls] Pax paused", {
      orgId,
      userId: caller.userId,
      metadata: { until: until.toISOString(), choice: parsed.data.until, zone },
    });

    // The receipt: who, until when, and what the pause holds — counts from
    // the rows, the live ask count from the kernel.
    const built = await buildControls(req, org);
    const state = built.state;
    const rules = (built.payload?.rightNow as { rulesRunning?: RulesRunning } | undefined)?.rulesRunning
      ?? (await readRulesRunning(orgId));
    const waiting = (built.payload?.rightNow as { waiting?: number } | undefined)?.waiting
      ?? (await countPendingActions(orgId));
    const holderName = state.pausedBy?.name ?? null;
    await recordPaxEffect({
      orgId,
      actor: "pax",
      origin: "engine",
      group: "runs_rules",
      stance: state.checkFailed ? null : state.stance,
      tool: "pause_pax",
      action: "pax_paused",
      entityType: "organization",
      entityId: orgId,
      description:
        `${PAX_PAUSE_COPY.statusLine({ until, byName: holderName, timeZone: state.timezone })} — ` +
        `${rulesClause(rules)} will wait; ${waiting} ${PAX_LABELS.queue.toLowerCase()}`,
      after: { pausedUntil: until.toISOString(), rules, waiting },
      witnessed: true,
      userId: caller.userId,
    });

    if (!built.payload) return refuseUnverified(res);
    return res.json(built.payload);
  } catch (error) {
    logger.error("[pax-controls] POST /pause failed", error as Error, { orgId: req.organization?.id });
    return Errors.internal(res, error);
  }
});

// ── POST /resume ───────────────────────────────────────────────────────────

router.post("/resume", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const orgId = getOrganizationId(req);
    const caller = await resolveCaller(req, org);
    const nowMs = Date.now();

    // Owner / admin: every org user's row. Member: their own row only.
    const rows = caller.isAdmin ? await orgUserRows(orgId) : [{ id: caller.userId, prefs: await readUserPrefs(caller.userId) }];
    const cleared: string[] = [];
    for (const row of rows) {
      if (!holdsFuturePause(row.prefs, nowMs)) continue;
      await writePausedUntil(row.id, row.prefs, null);
      cleared.push(row.id);
    }

    logger.info("[pax-controls] Pax resume requested", {
      orgId,
      userId: caller.userId,
      metadata: { scope: caller.isAdmin ? "org" : "self", cleared: cleared.length },
    });

    const built = await buildControls(req, org);
    const state = built.state;
    if (cleared.length > 0) {
      const rules = (built.payload?.rightNow as { rulesRunning?: RulesRunning } | undefined)?.rulesRunning
        ?? (await readRulesRunning(orgId));
      const stillPaused = state.paused && !state.checkFailed;
      await recordPaxEffect({
        orgId,
        actor: "pax",
        origin: "engine",
        group: "runs_rules",
        stance: state.checkFailed ? null : state.stance,
        tool: "resume_pax",
        action: "pax_resumed",
        entityType: "organization",
        entityId: orgId,
        description: stillPaused
          ? // A member cleared their own pause while a teammate still holds one.
            PAX_PAUSE_COPY.statusLine({
              until: state.pausedUntil,
              byName: state.pausedBy?.name ?? null,
              timeZone: state.timezone,
            })
          : `${PAX_LABELS.active} — ${rulesClause(rules)} run again`,
        after: { cleared: cleared.length, stillPaused, rules },
        witnessed: true,
        userId: caller.userId,
      });
    }

    if (!built.payload) return refuseUnverified(res);
    return res.json(built.payload);
  } catch (error) {
    logger.error("[pax-controls] POST /resume failed", error as Error, { orgId: req.organization?.id });
    return Errors.internal(res, error);
  }
});

// ── PATCH /controls ────────────────────────────────────────────────────────

/**
 * Exactly the stored keys, nothing more. `.strict()` is the whole point: a
 * `pausedUntil`, a `level`, a `pax: {…}` — anything the model does not
 * offer — is 422, and a stance outside OFFERED_STANCES is 422.
 */
const controlsPatchSchema = z
  .object({
    stance: z.enum(OFFERED_STANCES).optional(),
    leadScoring: z.boolean().optional(),
    borrowerReminders: z.boolean().optional(),
    inboxDrafts: z.boolean().optional(),
  })
  .strict();

/** The stored column shape, re-validated on the way OUT so a bad merge can never land. */
const storedControlsSchema = z
  .object({
    stance: z.enum(OFFERED_STANCES),
    leadScoring: z.boolean(),
    borrowerReminders: z.boolean(),
    inboxDrafts: z.boolean(),
  })
  .strict();

router.patch("/controls", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const orgId = getOrganizationId(req);
    const parsed = controlsPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    if (Object.keys(parsed.data).length === 0) return Errors.badRequest(res, "Nothing to change");

    const caller = await resolveCaller(req, org);
    if (!caller.isAdmin) return Errors.forbidden(res, "Ask an owner to change this");

    const current = await getPaxControls(orgId);
    // A stored value we could not read is not a base to merge onto — refuse
    // rather than overwrite what a human may have meant.
    if (current.checkFailed) return refuseUnverified(res);

    const before: PaxControls = {
      stance: current.stance,
      leadScoring: current.leadScoring,
      borrowerReminders: current.borrowerReminders,
      inboxDrafts: current.inboxDrafts,
    };
    const next = storedControlsSchema.safeParse({ ...before, ...parsed.data });
    if (!next.success) return Errors.validationFailed(res, next.error.issues);

    await db
      .update(organizations)
      .set({ paxControls: next.data, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));

    logger.info("[pax-controls] Pax controls changed", {
      orgId,
      userId: caller.userId,
      metadata: { fields: Object.keys(parsed.data), before, after: next.data },
    });

    await recordPaxEffect({
      orgId,
      actor: "pax",
      origin: "engine",
      group: "runs_rules",
      stance: next.data.stance,
      tool: "change_pax_controls",
      action: "pax_controls_changed",
      entityType: "organization",
      entityId: orgId,
      description: `${PAX_LABELS.active} — ${Object.keys(parsed.data).join(", ")} changed`,
      before,
      after: next.data,
      witnessed: true,
      userId: caller.userId,
    });

    const built = await buildControls(req, org);
    if (!built.payload) return refuseUnverified(res);
    return res.json(built.payload);
  } catch (error) {
    logger.error("[pax-controls] PATCH /controls failed", error as Error, { orgId: req.organization?.id });
    return Errors.internal(res, error);
  }
});

// ── GET /receipts ──────────────────────────────────────────────────────────

router.get("/receipts", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
    const page = await listPaxReceipts(orgId, {
      limit: Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined,
      cursor,
    });
    return res.json(page);
  } catch (error) {
    logger.error("[pax-controls] GET /receipts failed", error as Error, { orgId: req.organization?.id });
    return Errors.internal(res, error);
  }
});

export default router;
