/**
 * A tapped borrower-reminder ask whose reminder is QUEUED is closed — not
 * released for a retry that would create a second reminder row.
 *
 * `queued` means the dispatcher still owns the reminder and its sweep will
 * send it. Reporting that as a failure made the approval kernel release the
 * ask back to the queue; the next tap ran sendManualReminder again, which
 * created another reminder row — two notices to the borrower once the queue
 * drained. Real approval kernel and real pending_actions table; the finance
 * agent is stubbed so the test can count reminder rows created.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("paxQueuedReminderIsNotRetried.realdb.test.ts");

const S = vi.hoisted(() => ({ calls: 0, status: "queued" }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/services/financeAgent", () => ({
  financeAgentService: {
    // Each call is one reminder row created (sendManualReminder inserts before dispatching).
    sendManualReminder: async () => (S.calls++, { success: true, reminderId: 100 + S.calls, status: S.status, deliveryNote: "Retried on the next sweep." }),
  },
}));
vi.mock("../../server/services/paxControls", () => ({
  getPaxControls: async () => ({ stance: "ask_before_sending", checkFailed: false, timezone: "UTC" }),
}));
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: async () => ({ written: true }) }));

const tag = `pqr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = { org: 0 };

async function propose(): Promise<number> {
  const { db } = await import("../../server/db");
  const { pendingActions } = await import("@shared/schema");
  const { actionContentHash } = await import("../../server/services/approvalKernel");
  const args = { noteId: 3, type: "late" };
  const [row] = await db
    .insert(pendingActions)
    .values({
      organizationId: ids.org,
      toolName: "send_borrower_reminder",
      args,
      contentHash: actionContentHash("send_borrower_reminder", args),
      status: "pending",
      expiresAt: new Date(Date.now() + 3600_000),
      origin: "finance_ladder",
    } as any)
    .returning();
  return row.id;
}

async function tapTwice(pendingActionId: number) {
  const { approvePendingAction } = await import("../../server/services/approvalKernel");
  const { executeApprovedAsk } = await import("../../server/services/paxAskExecutors");
  const org = { id: ids.org } as any;
  const tap = () =>
    approvePendingAction({
      organizationId: ids.org,
      pendingActionId,
      approvedByUserId: "u-1",
      execute: (toolName, args) => executeApprovedAsk(toolName, args, { org, userId: "u-1", pendingActionId }),
    });
  return [await tap(), await tap()];
}

describe.runIf(realDbAvailable)("queued borrower reminder ask (real kernel)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as any).returning();
    ids.org = org.id;
  });
  afterAll(async () => {
    if (!ids.org) return;
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM pending_actions WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ids.org}`);
  });

  it("a queued reminder closes the ask: a second tap creates no second reminder row", async () => {
    S.calls = 0;
    S.status = "queued";
    const [first, second] = await tapTwice(await propose());
    expect(first.outcome).toBe("executed");
    expect(second.outcome).toBe("already_executed");
    expect(S.calls).toBe(1);
  });

  it("CONTROL: a failed reminder is released, and the re-tap does try again", async () => {
    S.calls = 0;
    S.status = "failed";
    const [first, second] = await tapTwice(await propose());
    expect(first.outcome).toBe("execution_failed");
    expect(second.outcome).toBe("execution_failed");
    expect(S.calls).toBe(2);
  });
});
