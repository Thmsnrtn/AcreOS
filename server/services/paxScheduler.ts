import { storage } from "../storage";
import { db } from "../db";
import { processChat } from "../ai/executive";
import { paxScheduledTaskRuns } from "@shared/schema";
import type { PaxScheduledTask } from "@shared/schema";
import type { Organization } from "@shared/schema";

// ── Schedule preset → next run time ─────────────────────────────────────────

const DEFAULT_TIMEZONE = "America/New_York";

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

// ── Execute a single scheduled task ─────────────────────────────────────────

// In-flight guard per org — prevents concurrent executions
const runningOrgs = new Set<number>();

export async function executeTask(task: PaxScheduledTask, org: Organization): Promise<void> {
  if (runningOrgs.has(org.id)) {
    console.log(`[pax-scheduler] Skipping task ${task.id} — org ${org.id} has a task running`);
    return;
  }
  runningOrgs.add(org.id);
  const startedAt = Date.now();
  // Prefer the org-level timezone so all scheduled tasks for an org fire at consistent
  // local times. Fall back to the task's own timezone, then the platform default.
  const effectiveTimezone = (org as any).timezone || task.timezone || DEFAULT_TIMEZONE;
  try {
    const result = await processChat(
      task.prompt,
      org,
      task.userId,
      { agentRole: "executive", conversationId: undefined }
    );

    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const summary = result.response.slice(0, 400);

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
    });

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

    console.log(`[pax-scheduler] Task ${task.id} "${task.name}" completed (conv ${result.conversationId})`);
  } catch (err: any) {
    console.error(`[pax-scheduler] Task ${task.id} "${task.name}" failed:`, err.message);
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

  console.log(`[pax-scheduler] ${due.length} task(s) due`);

  for (const task of due) {
    try {
      // Load the org — executeTask needs the full org object
      const org = await storage.getOrganization(task.organizationId);
      if (!org) {
        console.warn(`[pax-scheduler] Org ${task.organizationId} not found for task ${task.id}`);
        continue;
      }
      await executeTask(task, org);
    } catch (err: any) {
      console.error(`[pax-scheduler] Unexpected error for task ${task.id}:`, err.message);
    }
  }
}
