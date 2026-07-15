/**
 * Cohesion Wave-1 — live notifications.
 *
 * storage.createNotification is the single DB chokepoint every notification
 * row flows through (mentionService, workflow-engine, …). After the insert it
 * must publish `notification.new` to the recipient's OWN `user:{id}` channel
 * so the notification center updates live.
 *
 * The load-bearing correctness test: a notification for user A is NEVER
 * published to user B's channel. Delivery is keyed strictly on the inserted
 * row's userId (a varchar UUID — compared as a string, never parseInt'd).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { insertSpy, sendToUser } = vi.hoisted(() => ({
  // db.insert(notifications).values(v).returning() → [{ id, ...v }]
  insertSpy: vi.fn((_table: any) => ({
    values: (v: any) => ({
      returning: () => Promise.resolve([{ id: 101, ...v }]),
    }),
  })),
  sendToUser: vi.fn(),
}));

vi.mock("../db", () => ({ db: { insert: insertSpy } }));
vi.mock("../websocket", () => ({ wsServer: { sendToUser } }));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { automationRepo } from "./automationRepo";

beforeEach(() => {
  sendToUser.mockClear();
  insertSpy.mockClear();
});

describe("createNotification → WebSocket publish", () => {
  it("publishes notification.new to the recipient's own user channel with a minimal payload", async () => {
    await automationRepo.createNotification.call({} as any, {
      organizationId: 7,
      userId: "user-A",
      type: "team_mention",
      title: "You were mentioned",
    } as any);

    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser).toHaveBeenCalledWith("user-A", "notification.new", {
      id: 101,
      type: "team_mention",
    });
  });

  it("scoping: a notification for user A never publishes to user B's channel", async () => {
    await automationRepo.createNotification.call({} as any, {
      organizationId: 7,
      userId: "user-A",
      type: "deal_update",
      title: "Deal moved",
    } as any);

    const targetedUserIds = sendToUser.mock.calls.map((c) => c[0]);
    expect(targetedUserIds).toEqual(["user-A"]);
    expect(targetedUserIds).not.toContain("user-B");
  });

  it("is fail-safe: a WebSocket throw does not fail notification creation", async () => {
    sendToUser.mockImplementationOnce(() => {
      throw new Error("socket down");
    });

    const result = await automationRepo.createNotification.call({} as any, {
      organizationId: 7,
      userId: "user-A",
      type: "system_alert",
      title: "Heads up",
    } as any);

    // The row is still returned even though the broadcast blew up.
    expect(result).toMatchObject({ id: 101, userId: "user-A" });
  });
});
