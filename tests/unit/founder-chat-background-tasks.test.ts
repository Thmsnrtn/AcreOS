/**
 * Phase E — background-task lifecycle + idor_audit runner happy path.
 *
 * The DB is mocked so the queue/run/complete state lives in-memory. We
 * exercise the real runNextQueuedTask + the registered idor_audit
 * runner end-to-end against a tiny temp file with no organizationId.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface FakeTaskRow {
  id: string;
  threadId: number;
  founderUserId: string;
  label: string;
  runnerKey: string;
  payload: any;
  status: "queued" | "running" | "complete" | "failed";
  resultArtifact?: any;
  error?: string;
  estimatedSeconds: number | null;
  parentTaskId: string | null;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

const fake = {
  tasks: [] as FakeTaskRow[],
  messages: [] as Array<{ conversationId: number; role: string; content: string; toolCalls: any[] }>,
  conversationsBumped: [] as number[],
};

// ─── Drizzle stubs ───────────────────────────────────────────────────────────

function makeChainFor(rows: () => any[]): any {
  const promise = () => Promise.resolve(rows());
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    groupBy: () => chain,
    limit: () => promise(),
    then: (r: any, e?: any) => promise().then(r, e),
    catch: (fn: any) => promise().catch(fn),
  };
  return chain;
}

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        if (table.__tag === "founder_chat_background_tasks") {
          return makeChainFor(() =>
            fake.tasks
              .filter((t) => t.status === "queued")
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
          );
        }
        return makeChainFor(() => []);
      },
    }),
    insert: (table: any) => ({
      values(row: any) {
        if (table.__tag === "founder_chat_background_tasks") {
          const t: FakeTaskRow = {
            id: row.id,
            threadId: row.threadId,
            founderUserId: row.founderUserId,
            label: row.label,
            runnerKey: row.runnerKey,
            payload: row.payload,
            status: row.status ?? "queued",
            estimatedSeconds: row.estimatedSeconds ?? null,
            parentTaskId: row.parentTaskId ?? null,
            createdAt: new Date(),
          };
          fake.tasks.push(t);
        } else if (table.__tag === "ai_messages") {
          fake.messages.push({
            conversationId: row.conversationId,
            role: row.role,
            content: row.content,
            toolCalls: row.toolCalls ?? [],
          });
        }
        return {
          returning: () => Promise.resolve([{ id: fake.messages.length || fake.tasks.length }]),
          then: (fn: any) => Promise.resolve(fn(undefined)),
        };
      },
    }),
    update: (table: any) => ({
      set(values: any) {
        return {
          where(_cond: any) {
            if (table.__tag === "founder_chat_background_tasks") {
              // Pull the id off the where's drizzle eq — too messy.
              // Instead, find the first row whose status doesn't match
              // the new status (lifecycle is sequential).
              const target =
                values.status === "running"
                  ? fake.tasks.find((t) => t.status === "queued")
                  : values.status === "complete"
                    ? fake.tasks.find((t) => t.status === "running")
                    : values.status === "failed"
                      ? fake.tasks.find((t) => t.status === "running")
                      : undefined;
              if (target) {
                if (values.status) target.status = values.status;
                if (values.startedAt) target.startedAt = values.startedAt;
                if (values.completedAt) target.completedAt = values.completedAt;
                if (values.error) target.error = values.error;
                if (values.resultArtifact) target.resultArtifact = values.resultArtifact;
              }
            } else if (table.__tag === "ai_conversations") {
              fake.conversationsBumped.push(Date.now());
            }
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

vi.mock("@shared/schema", async () => {
  const actual: any = await vi.importActual("@shared/schema");
  function tag(name: string, base: any) {
    return new Proxy(base, {
      get(target, prop) {
        if (prop === "__tag") return name;
        return target[prop as keyof typeof target];
      },
    });
  }
  return {
    ...actual,
    founderChatBackgroundTasks: tag("founder_chat_background_tasks", actual.founderChatBackgroundTasks),
    aiMessages: tag("ai_messages", actual.aiMessages),
    aiConversations: tag("ai_conversations", actual.aiConversations),
    financialLedger: tag("financial_ledger", actual.financialLedger),
  };
});

vi.mock("../../server/services/aiRouter", () => ({
  routeAITask: vi.fn(async () => ({ content: "Weekly letter draft (test)." })),
  TaskComplexity: { MODERATE: "moderate" },
}));

beforeEach(() => {
  fake.tasks = [];
  fake.messages = [];
  fake.conversationsBumped = [];
});

// ─── Lifecycle: queue → run → complete ──────────────────────────────────────

describe("founder-chat background-task lifecycle", () => {
  it("startBackgroundTask + runNextQueuedTask drives queued → complete and posts a follow-up", async () => {
    const bt = await import("../../server/services/founder-chat/background-tasks");
    const runner = await import("../../server/jobs/founderChatBackgroundTaskRunner");

    // Register a controllable runner.
    runner.__resetRunnersForTests();
    runner.registerRunner("test_echo", async (ctx) => ({
      artifacts: [{ type: "text", markdown: `echo ${String((ctx.payload as any).x)}` }],
      followUp: `done with ${String((ctx.payload as any).x)}`,
    }));

    const { taskId } = await bt.startBackgroundTask({
      threadId: 7,
      founderUserId: "founder-a",
      label: "echo test",
      runnerKey: "test_echo",
      payload: { x: 99 },
    });
    expect(taskId).toMatch(/^[0-9a-f]{32}$/);
    expect(fake.tasks.length).toBe(1);
    expect(fake.tasks[0].status).toBe("queued");

    const r = await runner.runNextQueuedTask();
    expect(r?.status).toBe("complete");

    const t = fake.tasks[0];
    expect(t.status).toBe("complete");
    expect(t.resultArtifact?.artifacts?.[0]?.markdown).toContain("echo 99");

    // A follow-up assistant message was posted to the originating thread.
    expect(fake.messages.length).toBe(1);
    const msg = fake.messages[0];
    expect(msg.conversationId).toBe(7);
    expect(msg.role).toBe("assistant");
    expect(msg.content).toContain("done with 99");
    expect(msg.toolCalls?.[0]?.kind).toBe("background_task_result");
    expect(msg.toolCalls?.[0]?.taskId).toBe(taskId);
  });

  it("runner exception ⇒ task marked failed and an error follow-up is posted", async () => {
    const bt = await import("../../server/services/founder-chat/background-tasks");
    const runner = await import("../../server/jobs/founderChatBackgroundTaskRunner");

    runner.__resetRunnersForTests();
    runner.registerRunner("test_boom", async () => {
      throw new Error("boom");
    });

    await bt.startBackgroundTask({
      threadId: 7,
      founderUserId: "founder-a",
      label: "boomer",
      runnerKey: "test_boom",
      payload: {},
    });

    const r = await runner.runNextQueuedTask();
    expect(r?.status).toBe("failed");
    expect(fake.tasks[0].status).toBe("failed");
    expect(fake.tasks[0].error).toBe("boom");
    expect(fake.messages[0].content).toMatch(/failed: boom/);
  });

  it("no runner registered for key ⇒ task fails with a clear error", async () => {
    const bt = await import("../../server/services/founder-chat/background-tasks");
    const runner = await import("../../server/jobs/founderChatBackgroundTaskRunner");

    runner.__resetRunnersForTests();
    // Explicitly clear and don't re-register the test key.

    await bt.startBackgroundTask({
      threadId: 7,
      founderUserId: "founder-a",
      label: "orphan",
      runnerKey: "does_not_exist",
      payload: {},
    });

    const r = await runner.runNextQueuedTask();
    expect(r?.status).toBe("no_runner");
    expect(fake.tasks[0].status).toBe("failed");
  });

  it("runNextQueuedTask returns null when the queue is empty", async () => {
    const runner = await import("../../server/jobs/founderChatBackgroundTaskRunner");
    runner.__resetRunnersForTests();
    const r = await runner.runNextQueuedTask();
    expect(r).toBeNull();
  });
});

// ─── idor_audit runner happy path ───────────────────────────────────────────

describe("idor_audit runner", () => {
  it("flags db.update without organizationId on a real temp file", async () => {
    const bt = await import("../../server/services/founder-chat/background-tasks");
    const runner = await import("../../server/jobs/founderChatBackgroundTaskRunner");
    runner.__resetRunnersForTests();

    // Write a temp file inside repo root so the runner's safety check accepts it.
    const repoRoot = process.cwd();
    const tmpName = `idor_audit_test_${Date.now()}.ts`;
    const tmpPath = path.join(repoRoot, tmpName);
    // Crafted so the bad write's 6-line window doesn't bleed into the
    // scoped write below. Filler comments keep the windows separate.
    const tmpContent = `
import { db } from "./db";
export async function bad() {
  // No scope below — flagged
  await db.update(someTable).set({ flag: true }).where(eq(id, 1));
  return 1;
}
// filler line 1
// filler line 2
// filler line 3
// filler line 4
// filler line 5
// filler line 6
// filler line 7
// filler line 8
export async function good(ctxOrg: number) {
  await db.update(someTable).set({ flag: true })
    .where(and(eq(id, 1), eq(organizationId, ctxOrg)));
}
`.trim();
    await fs.writeFile(tmpPath, tmpContent, "utf-8");

    try {
      await bt.startBackgroundTask({
        threadId: 7,
        founderUserId: "founder-a",
        label: `IDOR audit: ${tmpName}`,
        runnerKey: "idor_audit",
        payload: { filePathOrGlob: tmpPath },
      });

      const r = await runner.runNextQueuedTask();
      expect(r?.status).toBe("complete");

      const md = (fake.tasks[0].resultArtifact as any).artifacts[0].markdown as string;
      expect(md).toContain("IDOR audit");
      expect(md).toContain("candidate site");
      // The bad `db.update` line should appear in the findings list.
      expect(md).toMatch(/db\.update\(someTable\)/);
      expect(md).toContain(`${tmpName}:`); // file:line marker for the finding
    } finally {
      // Clean up even if the test fails.
      await fs.unlink(tmpPath).catch(() => undefined);
      // Detect any os import warning suppression.
      void os;
    }
  });
});
