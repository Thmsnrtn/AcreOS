import { storage } from "../storage";
import { db } from "../db";
import { processChat } from "../ai/executive";
import { paxScheduledTaskRuns } from "@shared/schema";
import type { PaxScheduledTask } from "@shared/schema";
import type { Organization } from "@shared/schema";

// ── Schedule preset → next run time ─────────────────────────────────────────

const PRESET_MAP: Record<string, (now: Date) => Date> = {
  daily_8am: (now) => {
    const d = new Date(now);
    d.setHours(8, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  },
  daily_6pm: (now) => {
    const d = new Date(now);
    d.setHours(18, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  },
  weekly_monday_9am: (now) => {
    const d = new Date(now);
    const day = d.getDay(); // 0=Sun, 1=Mon
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
    d.setDate(d.getDate() + daysUntilMonday);
    d.setHours(9, 0, 0, 0);
    return d;
  },
  weekly_friday_5pm: (now) => {
    const d = new Date(now);
    const day = d.getDay();
    const daysUntilFriday = day === 5 ? 7 : (12 - day) % 7;
    d.setDate(d.getDate() + daysUntilFriday);
    d.setHours(17, 0, 0, 0);
    return d;
  },
  hourly: (now) => {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  },
};

export function computeNextRun(schedule: string, _timezone: string): Date {
  const now = new Date();
  const preset = PRESET_MAP[schedule];
  if (preset) return preset(now);

  // Unknown schedule — default to 24h from now
  const d = new Date(now);
  d.setHours(d.getHours() + 24);
  return d;
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
      nextRunAt: computeNextRun(task.schedule, task.timezone),
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
      nextRunAt: computeNextRun(task.schedule, task.timezone),
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
