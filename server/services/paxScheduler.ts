import { storage } from "../storage";
import { db } from "../db";
import { processChat } from "../ai/executive";
import { paxScheduledTaskRuns } from "@shared/schema";
import type { PaxScheduledTask } from "@shared/schema";
import type { Organization } from "@shared/schema";
import { logger } from "../utils/logger";
import { getPaxControls } from "./paxControls";
import { PAX_LABELS, PAX_PAUSE_COPY } from "@shared/pax-glossary";

// ── Schedule preset → next run time ─────────────────────────────────────────

const DEFAULT_TIMEZONE = "America/New_York";

/** How soon a paused run is re-aimed when the pause expiry is not known. */
const PAUSED_RETRY_MS = 15 * 60 * 1000;

/**
 * Returns the org-local wall-clock parts (year, month, day, hour, minute, weekday)
 * for a given UTC instant, using the Intl API (no external deps required).
 */
function getLocalParts(utc: Date, tz: string): {
  year: number; month: number; day: number;
  hour: number; minute: number; weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(utc).map(p => [p.type, p.value]));
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    hour: parseInt(parts.hour === "24" ? "0" : parts.hour),
    minute: parseInt(parts.minute),
    weekday: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.weekday),
  };
}

/**
 * Converts org-local wall-clock time (hour, minute) on a specific calendar date
 * (year, month, day in org timezone) to a UTC Date.
 */
function localToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  // Use Intl to find the UTC offset by binary search via Date.parse with a known local string
  // The reliable cross-platform approach: format a candidate date and see if it round-trips.
  const iso = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00`;
  // Estimate UTC by parsing without timezone, then adjust using the measured offset
  const naive = new Date(iso);
  const localParts = getLocalParts(naive, tz);
  const offsetMs = naive.getTime() - new Date(
    `${localParts.year}-${String(localParts.month).padStart(2,"0")}-${String(localParts.day).padStart(2,"0")}T${String(localParts.hour).padStart(2,"0")}:${String(localParts.minute).padStart(2,"0")}:00`
  ).getTime();
  return new Date(naive.getTime() + offsetMs);
}

/**
 * Given a UTC "now" and a target local hour/minute, returns the next UTC Date
 * when that local time occurs in the org's timezone (today if still in the future,
 * otherwise tomorrow).
 */
function nextLocalTime(now: Date, hour: number, minute: number, tz: string): Date {
  const lp = getLocalParts(now, tz);
  // Try today first
  let candidate = localToUtc(lp.year, lp.month, lp.day, hour, minute, tz);
  if (candidate <= now) {
    // Roll to tomorrow
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const lp2 = getLocalParts(tomorrow, tz);
    candidate = localToUtc(lp2.year, lp2.month, lp2.day, hour, minute, tz);
  }
  return candidate;
}

/**
 * Returns the next UTC Date for a given weekday (0=Sun…6=Sat) and local time.
 * Always returns at least 1 day in the future if today matches and time has passed.
 */
function nextLocalWeekday(now: Date, targetWeekday: number, hour: number, minute: number, tz: string): Date {
  const lp = getLocalParts(now, tz);
  let daysAhead = (targetWeekday - lp.weekday + 7) % 7;
  // If it's the target weekday but the time has already passed, schedule for next week
  if (daysAhead === 0) {
    const todayCandidate = localToUtc(lp.year, lp.month, lp.day, hour, minute, tz);
    if (todayCandidate <= now) daysAhead = 7;
    else return todayCandidate;
  }
  const target = new Date(now);
  target.setUTCDate(target.getUTCDate() + daysAhead);
  const lp2 = getLocalParts(target, tz);
  return localToUtc(lp2.year, lp2.month, lp2.day, hour, minute, tz);
}

export function computeNextRun(schedule: string, timezone: string): Date {
  const tz = timezone || DEFAULT_TIMEZONE;
  const now = new Date();

  switch (schedule) {
    case "daily_8am":
      return nextLocalTime(now, 8, 0, tz);
    case "daily_6pm":
      return nextLocalTime(now, 18, 0, tz);
    case "weekly_monday_9am":
      return nextLocalWeekday(now, 1 /* Mon */, 9, 0, tz);
    case "weekly_friday_5pm":
      return nextLocalWeekday(now, 5 /* Fri */, 17, 0, tz);
    case "hourly": {
      const d = new Date(now);
      d.setUTCMinutes(0, 0, 0);
      d.setUTCHours(d.getUTCHours() + 1);
      return d;
    }
    default:
      // Unknown schedule — default to 24h from now
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

// ── "N things waiting for your tap" ─────────────────────────────────────────

/**
 * Count the asks a scheduled run left in the queue. The kernel returns a
 * pending artifact (`pendingApproval: true`, `pendingActionId`) INSTEAD of
 * executing whenever a tool freezes — every send at every stance, and every
 * record write at "Ask before everything" — so the count is read off the
 * run's own tool results, never guessed. Distinct rows only: the model may
 * re-propose the same frozen action within one run.
 */
function countAsksParked(toolCalls: unknown): number {
  if (!Array.isArray(toolCalls)) return 0;
  const ids = new Set<string>();
  for (const call of toolCalls) {
    const result = (call as { result?: unknown } | null)?.result;
    if (!result || typeof result !== "object") continue;
    const data = (result as { data?: unknown }).data;
    const artifact =
      data && typeof data === "object" && (data as { pendingApproval?: unknown }).pendingApproval === true
        ? (data as { pendingActionId?: unknown })
        : (result as { pendingApproval?: unknown }).pendingApproval === true
          ? (result as { pendingActionId?: unknown })
          : null;
    if (!artifact) continue;
    ids.add(String(artifact.pendingActionId ?? ids.size));
  }
  return ids.size;
}

/** "3 things waiting for your tap" — the glossary's queue label, counted. */
function waitingLine(count: number): string {
  const queue = PAX_LABELS.queue.charAt(0).toLowerCase() + PAX_LABELS.queue.slice(1);
  return `${count} ${count === 1 ? "thing" : "things"} ${queue}`;
}

// ── Execute a single scheduled task ─────────────────────────────────────────

// In-flight guard per org — prevents concurrent executions
const runningOrgs = new Set<number>();

/**
 * The chat options a scheduled run passes down. `origin` and `scheduledTask`
 * are the kernel's ask lanes (AUTONOMY_SPEC.md §4.3): every tool call this
 * run makes is proposed as `origin: "scheduled"` with the task it came from
 * frozen on the row (source_ref.scheduledTaskId / scheduledTaskName), so the
 * ask card can say "from your scheduled prompt 'Monday lead pull'".
 * processChat threads both to executeTool.
 */
type ScheduledChatOptions = NonNullable<Parameters<typeof processChat>[3]>;

export async function executeTask(task: PaxScheduledTask, org: Organization): Promise<void> {
  if (runningOrgs.has(org.id)) {
    logger.info(`[pax-scheduler] Skipping task ${task.id} — org ${org.id} has a task running`);
    return;
  }
  runningOrgs.add(org.id);
  const startedAt = Date.now();
  // Prefer the org-level timezone so all scheduled tasks for an org fire at consistent
  // local times. Fall back to the task's own timezone, then the platform default.
  const effectiveTimezone = org.timezone || task.timezone || DEFAULT_TIMEZONE;
  try {
    const chatOptions: ScheduledChatOptions = {
      agentRole: "executive",
      conversationId: undefined,
      origin: "scheduled",
      scheduledTask: { id: task.id, name: task.name },
    };
    const result = await processChat(task.prompt, org, task.userId, chatOptions);

    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    // The run summary leads with what is now waiting on the human — a count
    // read off the kernel's own pending artifacts — then the model's own words.
    const parked = countAsksParked(result.toolCalls);
    const summary = (parked > 0 ? `${waitingLine(parked)}. ` : "") + result.response.slice(0, 400);

    await storage.updatePaxScheduledTask(task.id, {
      lastRunAt: new Date(),
      nextRunAt: computeNextRun(task.schedule, effectiveTimezone),
      lastRunConversationId: result.conversationId,
      lastRunStatus: "success",
      lastRunSummary: summary,
      runCount: (task.runCount ?? 0) + 1,
    });

    // Rename the conversation to make it identifiable
    await storage.updateAiConversation(result.conversationId, {
      title: `[Scheduled] ${task.name} — ${date}`,
    }, org.id);

    // Log run history
    await db.insert(paxScheduledTaskRuns as any).values({
      taskId: task.id,
      organizationId: org.id,
      runAt: new Date(),
      status: "success",
      summary: summary,
      conversationId: result.conversationId,
      durationMs: Date.now() - startedAt,
    } as any).catch(() => {});

    logger.info(
      `[pax-scheduler] Task ${task.id} "${task.name}" completed (conv ${result.conversationId}; ${parked} ask(s) parked)`,
    );
  } catch (err: any) {
    logger.error(`[pax-scheduler] Task ${task.id} "${task.name}" failed`, err);
    await storage.updatePaxScheduledTask(task.id, {
      lastRunAt: new Date(),
      nextRunAt: computeNextRun(task.schedule, effectiveTimezone),
      lastRunStatus: "error",
      lastRunSummary: err.message?.slice(0, 200) ?? "Unknown error",
    });
    await db.insert(paxScheduledTaskRuns as any).values({
      taskId: task.id,
      organizationId: org.id,
      runAt: new Date(),
      status: "error",
      summary: err.message?.slice(0, 200) ?? "Unknown error",
      durationMs: Date.now() - startedAt,
    } as any).catch(() => {});
  } finally {
    runningOrgs.delete(org.id);
  }
}

// ── Scheduler job — called by the server's background loop ──────────────────

export async function processPaxScheduledTasks(): Promise<void> {
  const now = new Date();
  const due = await storage.getPaxScheduledTasksDue(now);
  if (due.length === 0) return;

  logger.info(`[pax-scheduler] ${due.length} task(s) due`);

  for (const task of due) {
    try {
      // Load the org — executeTask needs the full org object
      const org = await storage.getOrganization(task.organizationId);
      if (!org) {
        logger.warn(`[pax-scheduler] Org ${task.organizationId} not found for task ${task.id}`);
        continue;
      }

      // ── Pax controls: the one reader (AUTONOMY_SPEC.md §4.4) ──────────
      // Paused ⇒ the run is skipped with a recorded reason — never silently
      // — and re-aimed at the moment the pause lifts (or shortly, when the
      // read failed and we are failing closed). The stance itself is read
      // by the kernel on every tool call this run makes: at "Ask before
      // everything" every record write freezes as an ask and the run summary
      // above says how many are waiting.
      const controls = await getPaxControls(org.id);
      if (controls.paused) {
        const resumeAt = controls.pausedUntil ?? new Date(Date.now() + PAUSED_RETRY_MS);
        logger.info(
          `[pax-scheduler] Skipping task ${task.id} "${task.name}" — Pax is paused for org ${org.id}` +
            (controls.checkFailed
              ? " (controls read failed; failing closed, retrying soon)"
              : ` until ${controls.pausedUntil?.toISOString() ?? "(unknown)"}`),
        );
        await storage.updatePaxScheduledTask(task.id, {
          nextRunAt: resumeAt,
          lastRunStatus: "skipped_paused",
          lastRunSummary: controls.checkFailed
            ? PAX_PAUSE_COPY.checkFailedRefusal
            : PAX_PAUSE_COPY.skippedLine({ until: controls.pausedUntil, timeZone: controls.timezone }),
        });
        continue;
      }

      await executeTask(task, org);
    } catch (err: any) {
      logger.error(`[pax-scheduler] Unexpected error for task ${task.id}`, err);
    }
  }
}
