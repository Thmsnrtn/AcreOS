/**
 * Phase E — background-task worker for Atlas.
 *
 * Polls `founder_chat_background_tasks` every 10s, picks the next
 * `queued` row in FIFO order, dispatches via a runner registry, then:
 *   - persists the resultArtifact (markBackgroundTaskComplete / fail)
 *   - posts a follow-up assistant message into the originating thread
 *     carrying the result artifact
 *   - attempts a best-effort push notification (no-op when VAPID isn't
 *     configured)
 *
 * Runners live in this file alongside the loop so adding a new one is a
 * three-line change. Each runner returns `{ artifacts, followUp? }` —
 * artifacts feed straight into the chat message via the same toolCalls-
 * jsonb piggyback the morningBrief job uses.
 */

import { and, asc, eq } from "drizzle-orm";
import {
  aiConversations,
  aiMessages,
  financialLedger,
  founderChatBackgroundTasks,
} from "@shared/schema";
import { db } from "../db";
import type { Artifact } from "@shared/founder-chat/artifacts";
import {
  completeBackgroundTask,
  failBackgroundTask,
  markBackgroundTaskRunning,
} from "../services/founder-chat/background-tasks";
import { logger } from "../utils/logger";
import { selectModelForTurn } from "../services/founder-chat/model-selector";
import { promises as fs } from "node:fs";
import * as path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Runner registry
// ─────────────────────────────────────────────────────────────────────────────

export interface RunnerResult {
  artifacts: Artifact[];
  followUp?: string;
}

export interface RunnerContext {
  taskId: string;
  threadId: number;
  founderUserId: string;
  payload: Record<string, unknown>;
}

export type Runner = (ctx: RunnerContext) => Promise<RunnerResult>;

const RUNNERS = new Map<string, Runner>();

export function registerRunner(key: string, fn: Runner): void {
  RUNNERS.set(key, fn);
}

export function getRunner(key: string): Runner | undefined {
  return RUNNERS.get(key);
}

export function listRunnerKeys(): string[] {
  return Array.from(RUNNERS.keys());
}

/** Reset for tests. NEVER call in production. */
export function __resetRunnersForTests(): void {
  RUNNERS.clear();
  registerStarterRunners();
}

// ─── Runner: idor_audit ─────────────────────────────────────────────────────
// Greps a single file or directory for write operations missing org-
// scoping. Read-only, cheap. Intended as a starting point — Phase G/H
// adds the real grade.
async function idorAuditRunner(ctx: RunnerContext): Promise<RunnerResult> {
  const target = String(ctx.payload.filePathOrGlob ?? "").trim();
  if (!target) {
    return {
      artifacts: [{ type: "text", markdown: "**IDOR audit:** no path provided." }],
    };
  }

  // Resolve only inside the repo root for safety. The cwd of the worker
  // is the project root in production.
  const repoRoot = process.cwd();
  const absolute = path.isAbsolute(target) ? target : path.resolve(repoRoot, target);
  if (!absolute.startsWith(repoRoot)) {
    return {
      artifacts: [{ type: "text", markdown: "**IDOR audit:** refusing to scan outside the repo." }],
    };
  }

  const files = await collectFiles(absolute);
  const findings: Array<{ file: string; line: number; snippet: string; reason: string }> = [];
  // Crude heuristic: any db.update / db.delete / db.insert that does NOT
  // mention organizationId on the same line is a candidate. Phase G can
  // upgrade to ts-morph.
  const writePatterns = [/db\.update\(/, /db\.delete\(/, /db\.insert\(/];
  for (const file of files) {
    try {
      const text = await fs.readFile(file, "utf-8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isWrite = writePatterns.some((p) => p.test(line));
        if (!isWrite) continue;
        // Inspect a 6-line window for organizationId.
        const window = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 6)).join("\n");
        if (!/organizationId|organization_id/.test(window)) {
          findings.push({
            file: path.relative(repoRoot, file),
            line: i + 1,
            snippet: line.trim().slice(0, 200),
            reason: "Write op without organizationId in 6-line window",
          });
        }
      }
    } catch (err) {
      logger.warn(`[idor_audit] could not read ${file}`, { metadata: { err: String(err) } });
    }
  }

  const cap = findings.slice(0, 25);
  const md =
    findings.length === 0
      ? `**IDOR audit on \`${target}\`:** clean — scanned ${files.length} file(s), zero unscoped writes.`
      : `**IDOR audit on \`${target}\`:** ${findings.length} candidate site(s) across ${files.length} file(s).\n\n` +
        cap.map((f) => `- \`${f.file}:${f.line}\` — ${f.snippet}`).join("\n") +
        (findings.length > cap.length ? `\n\n…and ${findings.length - cap.length} more.` : "");

  return {
    artifacts: [{ type: "text", markdown: md }],
    followUp:
      findings.length === 0
        ? "Audit clean. No follow-up needed."
        : `Found ${findings.length} site${findings.length === 1 ? "" : "s"} worth a closer look.`,
  };
}

async function collectFiles(target: string): Promise<string[]> {
  try {
    const stat = await fs.stat(target);
    if (stat.isFile()) return [target];
    if (!stat.isDirectory()) return [];
    const out: string[] = [];
    const stack: string[] = [target];
    while (stack.length) {
      const dir = stack.pop()!;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
      }
      if (out.length > 200) break; // cap for cheapness
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Runner: provider_savings_analysis ──────────────────────────────────────
async function providerSavingsAnalysisRunner(ctx: RunnerContext): Promise<RunnerResult> {
  const provider = String(ctx.payload.provider ?? "").toLowerCase();
  const days = Math.max(1, Math.min(365, Number(ctx.payload.days ?? 30)));
  if (!provider) {
    return { artifacts: [{ type: "text", markdown: "**Provider savings:** no provider supplied." }] };
  }
  const since = new Date(Date.now() - days * 86_400_000);
  try {
    const { and: andOp, eq: eqOp, gte: gteOp, sum, sql } = await import("drizzle-orm");
    const [row] = await db
      .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(andOp(eqOp(financialLedger.provider, provider), gteOp(financialLedger.postedAt, since)));
    const totalCents = Math.abs(row?.total ?? 0);

    // Naive savings estimate: assume a 25% provider-swap savings band.
    const lowSavings = Math.round(totalCents * 0.1);
    const highSavings = Math.round(totalCents * 0.25);

    const md =
      `**Provider savings — ${provider} (${days}d):**\n\n` +
      `- Spend: $${(totalCents / 100).toFixed(2)}\n` +
      `- Estimated savings band (switch / renegotiate): $${(lowSavings / 100).toFixed(2)} – $${(highSavings / 100).toFixed(2)}\n` +
      `- Suggested next step: \`/audit_provider_savings ${provider} ${days}\` for a fuller breakdown.`;
    void sql;
    return {
      artifacts: [{ type: "text", markdown: md }],
      followUp:
        totalCents === 0
          ? `No ${provider} spend in the last ${days}d — nothing to optimize.`
          : `Best case ${(highSavings / 100).toFixed(0)} dollars/${days}d if we switch.`,
    };
  } catch (err) {
    return {
      artifacts: [
        { type: "text", markdown: `**Provider savings:** query failed — ${String(err)}` },
      ],
    };
  }
}

// ─── Runner: weekly_money_letter ────────────────────────────────────────────
async function weeklyMoneyLetterRunner(ctx: RunnerContext): Promise<RunnerResult> {
  const { model } = selectModelForTurn({ intent: "morning_brief" });
  void ctx;
  try {
    const { routeAITask, TaskComplexity } = await import("../services/aiRouter");
    const r = await routeAITask({
      taskType: "atlas_weekly_money_letter",
      complexity: TaskComplexity.MODERATE,
      taskTier: "standard",
      messages: [
        {
          role: "system",
          content:
            "You are Atlas. Compose Tom's weekly money letter (≤6 lines, terse, direct).",
        },
        { role: "user", content: "Compose the letter for this week." },
      ],
    });
    const body = (r?.content ?? "").toString().trim() || `Weekly letter draft (${model}) — composer returned empty.`;
    return {
      artifacts: [
        {
          type: "letter_card",
          title: `Weekly money letter — ${new Date().toISOString().slice(0, 10)}`,
          body,
          sendTarget: "draft_only",
        },
      ],
      followUp: "Letter drafted. Review and send when ready.",
    };
  } catch (err) {
    return {
      artifacts: [
        {
          type: "letter_card",
          title: `Weekly money letter — ${new Date().toISOString().slice(0, 10)}`,
          body: `(LLM unavailable: ${String(err)})`,
          sendTarget: "draft_only",
        },
      ],
    };
  }
}

function registerStarterRunners(): void {
  RUNNERS.set("idor_audit", idorAuditRunner);
  RUNNERS.set("provider_savings_analysis", providerSavingsAnalysisRunner);
  RUNNERS.set("weekly_money_letter", weeklyMoneyLetterRunner);
}

registerStarterRunners();

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

export interface RunOneResult {
  taskId: string;
  runnerKey: string;
  status: "complete" | "failed" | "no_runner";
  artifacts?: Artifact[];
}

/**
 * Run a single queued task end-to-end. Exposed for the tests and for
 * the poller loop. Returns null when there is nothing queued.
 */
export async function runNextQueuedTask(): Promise<RunOneResult | null> {
  const [task] = await db
    .select()
    .from(founderChatBackgroundTasks)
    .where(eq(founderChatBackgroundTasks.status, "queued"))
    .orderBy(asc(founderChatBackgroundTasks.createdAt))
    .limit(1);
  if (!task) return null;

  await markBackgroundTaskRunning(task.id);

  const runner = RUNNERS.get(task.runnerKey);
  if (!runner) {
    const err = `no runner registered for key='${task.runnerKey}'`;
    await failBackgroundTask(task.id, err);
    await postFollowUpMessage(task.threadId, {
      content: `Background task **${task.label}** failed: ${err}`,
      artifacts: [{ type: "text", markdown: `Background task **${task.label}** failed: ${err}` }],
      kind: "background_task_result",
      taskId: task.id,
    });
    return { taskId: task.id, runnerKey: task.runnerKey, status: "no_runner" };
  }

  try {
    const result = await runner({
      taskId: task.id,
      threadId: task.threadId,
      founderUserId: task.founderUserId,
      payload: (task.payload as Record<string, unknown>) ?? {},
    });
    const artifacts = result.artifacts.length > 0
      ? result.artifacts
      : [{ type: "text", markdown: `Task **${task.label}** complete.` } as Artifact];

    await completeBackgroundTask(task.id, { artifacts });
    await postFollowUpMessage(task.threadId, {
      content: result.followUp ?? `Background task **${task.label}** complete.`,
      artifacts,
      kind: "background_task_result",
      taskId: task.id,
    });
    await maybeFirePushNotification({
      founderUserId: task.founderUserId,
      threadId: task.threadId,
      label: task.label,
      status: "complete",
    });
    return { taskId: task.id, runnerKey: task.runnerKey, status: "complete", artifacts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failBackgroundTask(task.id, msg);
    await postFollowUpMessage(task.threadId, {
      content: `Background task **${task.label}** failed: ${msg}`,
      artifacts: [
        { type: "text", markdown: `Background task **${task.label}** failed: \`${msg}\`` },
      ],
      kind: "background_task_result",
      taskId: task.id,
    });
    await maybeFirePushNotification({
      founderUserId: task.founderUserId,
      threadId: task.threadId,
      label: task.label,
      status: "failed",
    });
    return { taskId: task.id, runnerKey: task.runnerKey, status: "failed" };
  }
}

async function postFollowUpMessage(
  threadId: number,
  args: {
    content: string;
    artifacts: Artifact[];
    kind: string;
    taskId: string;
  },
): Promise<void> {
  try {
    await db
      .insert(aiMessages)
      .values({
        conversationId: threadId,
        role: "assistant",
        content: args.content,
        toolCalls: [
          {
            kind: args.kind,
            taskId: args.taskId,
            postedBy: "atlas_background_runner",
            artifacts: args.artifacts,
          },
        ] as any,
      } as any);
    await db
      .update(aiConversations)
      .set({ updatedAt: new Date() } as any)
      .where(eq(aiConversations.id, threadId));
  } catch (err) {
    logger.warn("[background-runner] failed to persist follow-up message", {
      metadata: { err: String(err), threadId, taskId: args.taskId },
    });
  }
}

async function maybeFirePushNotification(args: {
  founderUserId: string;
  threadId: number;
  label: string;
  status: "complete" | "failed";
}): Promise<void> {
  try {
    const { sendPushToPerson } = await import("../services/pushNotificationService");
    // The org id genuinely is unknown here — a background task lives off the
    // thread, not the org. This used to pass `0 as any`, with a comment saying
    // the service "will skip delivery if it can't resolve a subscription".
    // It never could: subscriptions are stored under the subscriber's real org,
    // so org 0 matched nothing and the founder got none of these. The cast was
    // the tell — a tenant id you have to force past the type checker is not a
    // tenant id. `sendPushToPerson` addresses the human directly.
    const pushResult = await sendPushToPerson(args.founderUserId, {
      title: `Atlas — ${args.label} ${args.status}`,
      body: `Open chat for details.`,
      url: `/founder?thread=${args.threadId}`,
      tag: `atlas-task-${args.threadId}`,
    } as any);

    // Say which of the six things happened. This block used to log only on a
    // THROW, with a TODO speculating that push was "not wired yet" — while the
    // real reason nothing arrived was org 0 matching no subscription, silently,
    // on every call. A notification channel that cannot report its own
    // non-delivery will keep being described as unfinished instead of broken.
    if (pushResult.status !== "delivered" && pushResult.status !== "partial") {
      logger.warn("[background-runner] founder push did not land", {
        metadata: { status: pushResult.status, founderUserId: args.founderUserId },
      });
    }
  } catch (err) {
    logger.warn("[background-runner] founder push threw", {
      metadata: { err: String(err), founderUserId: args.founderUserId },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Poller (worker process entrypoint)
// ─────────────────────────────────────────────────────────────────────────────

let pollerStarted = false;

export function startFounderChatBackgroundTaskRunner(intervalMs = 10_000): void {
  if (pollerStarted) return;
  pollerStarted = true;
  void (async function loop() {
    // Tight inner drain: as long as the runner returns work, keep
    // draining; once queue empty, sleep intervalMs.
    while (pollerStarted) {
      try {
        const r = await runNextQueuedTask();
        if (!r) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      } catch (err) {
        logger.error(
          "[background-runner] loop error",
          err instanceof Error ? err : undefined,
        );
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  })();
  logger.info("[background-runner] started", { metadata: { intervalMs } });
}

/** Stop the poller (tests). */
export function stopFounderChatBackgroundTaskRunner(): void {
  pollerStarted = false;
}

// Silence the lint about unused `and` import (we keep it for clarity);
// Drizzle treats this as a no-op at runtime.
void and;
