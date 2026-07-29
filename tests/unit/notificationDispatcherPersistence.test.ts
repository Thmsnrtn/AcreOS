/**
 * Notification dispatcher persistence + honest channel status — Wave A
 * ("Nothing lies", founder ruling #12(c)).
 *
 * Pins:
 *  1. Every dispatched notification is written through to the `notifications`
 *     table (mocked storage here) and a RE-INSTANTIATED dispatcher hydrates
 *     everything that was persisted — restart/deploy loses nothing persisted.
 *  2. Read state survives re-instantiation (write-through markAsRead).
 *  3. Channels with no real rail (SMS / email / push — Wave C wires delivery)
 *     record `channel_unavailable`, NEVER `sent`, and never log "queued";
 *     the in-app leg carries the notification.
 *  4. A persistence failure is loud (logger.error) and honest: the item is
 *     marked persisted:false and is genuinely absent after re-instantiation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const dbRows: any[] = [];
  const state = {
    nextId: 1,
    arbiterMode: "deliver" as "deliver" | "suppress",
    failNextPersist: false,
  };
  const fakeStorage = {
    createNotification: async (n: any) => {
      if (state.failNextPersist) {
        state.failNextPersist = false;
        throw new Error("db down");
      }
      const row = {
        id: state.nextId++,
        isRead: false,
        readAt: null,
        createdAt: new Date(state.nextId * 1000),
        entityType: null,
        entityId: null,
        ...n,
      };
      dbRows.push(row);
      return row;
    },
    getNotifications: async (orgId: number, userId: string) =>
      dbRows
        .filter((r) => r.organizationId === orgId && r.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 50),
    markNotificationRead: async (id: number) => {
      const row = dbRows.find((r) => r.id === id);
      if (row) {
        row.isRead = true;
        row.readAt = new Date();
      }
      return row;
    },
  };
  return { dbRows, state, fakeStorage };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/websocket", () => ({
  wsServer: { broadcastToOrg: vi.fn(), broadcast: vi.fn() },
}));

vi.mock("../../server/storage", () => ({ storage: h.fakeStorage }));

vi.mock("../../server/services/founder", () => ({
  getFounderPrimaryOrgId: vi.fn(async () => 1),
  getFounderUserIds: vi.fn(async () => ["founder_user"]),
}));

vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => ({
    outcome: h.state.arbiterMode === "deliver" ? "deliver" : "suppress",
    interruptClass: req.interruptClass,
    reason: "test",
    quietHoursActive: false,
    budget: null,
    deferUntil: null,
  })),
  recordDeferredInterrupt: vi.fn(async () => 1),
}));

import { NotificationDispatcher } from "../../server/services/notificationDispatcher";
import { logger } from "../../server/utils/logger";

beforeEach(() => {
  h.dbRows.length = 0;
  h.state.arbiterMode = "deliver";
  h.state.failNextPersist = false;
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();
});

async function freshDispatcher(): Promise<NotificationDispatcher> {
  const d = new NotificationDispatcher();
  await d.whenReady();
  return d;
}

describe("restart survival (DB write-through + hydration)", () => {
  it("a re-instantiated dispatcher recovers everything that was persisted", async () => {
    const a = await freshDispatcher();
    await a.dispatch({
      eventType: "deal:discovered",
      channel: "in_app",
      payload: { address: "1 Acre Rd", price: 5000 },
      priority: 3,
      orgId: 42,
    });
    await a.dispatch({
      eventType: "job:failed",
      channel: "in_app",
      payload: { jobName: "etl", error: "boom" },
      priority: 3,
    });

    expect(h.dbRows).toHaveLength(2);
    const before = a.getNotifications();
    expect(before.every((n) => n.persisted)).toBe(true);

    // "Restart": brand-new instance, empty memory, hydrates from the DB.
    const b = await freshDispatcher();
    const after = b.getNotifications();
    expect(after).toHaveLength(2);
    expect(after.map((n) => n.eventType).sort()).toEqual(["deal:discovered", "job:failed"]);
    // Same tray ids as before the restart — nothing renamed, nothing lost.
    expect(after.map((n) => n.id).sort()).toEqual(before.map((n) => n.id).sort());
    expect(b.getUnreadCount()).toBe(2);
  });

  it("read state survives re-instantiation", async () => {
    const a = await freshDispatcher();
    await a.dispatch({
      eventType: "market:alert",
      channel: "in_app",
      payload: { county: "Travis", description: "prices up" },
      priority: 3,
      orgId: 7,
    });
    const [notif] = a.getNotifications();
    expect(a.markAsRead(notif.id)).toBe(true);

    // The read write-back is fire-and-forget — wait for it to land.
    await vi.waitFor(() => {
      expect(h.dbRows[0].isRead).toBe(true);
    });

    const b = await freshDispatcher();
    const [rehydrated] = b.getNotifications();
    expect(rehydrated.id).toBe(notif.id);
    expect(rehydrated.read).toBe(true);
    expect(b.getUnreadCount()).toBe(0);
  });

  it("persisted rows carry the honest delivery record in metadata", async () => {
    const a = await freshDispatcher();
    await a.dispatch({
      eventType: "agent:escalation",
      channel: "in_app",
      payload: { agent: "sophie", reason: "needs input" },
      priority: 1, // urgent → SMS + email legs wanted
      orgId: 42,
    });

    const row = h.dbRows[0];
    expect(row.metadata.source).toBe("notification_dispatcher");
    expect(row.metadata.sourceOrgId).toBe(42);
    expect(row.metadata.delivery.sms).toBe("channel_unavailable");
    expect(row.metadata.delivery.email).toBe("channel_unavailable");
    expect(row.metadata.delivery.in_app).toBe("sent");

    const b = await freshDispatcher();
    const [n] = b.getNotifications();
    expect(n.delivery.sms).toBe("channel_unavailable");
  });
});

describe("honest channel status (no rail → never `sent`)", () => {
  it("urgent SMS/email legs record channel_unavailable, never sent, never 'queued'", async () => {
    const a = await freshDispatcher();
    await a.dispatch({
      eventType: "approval:requested",
      channel: "in_app",
      payload: { description: "spend $40" },
      priority: 1,
      orgId: 42,
    });

    const [n] = a.getNotifications();
    expect(n.delivery.sms).toBe("channel_unavailable");
    expect(n.delivery.email).toBe("channel_unavailable");
    // In-app degrade path actually carried it.
    expect(n.delivery.in_app).toBe("sent");
    expect(n.delivery.in_app_org).toBe("sent");
    expect(n.delivery.in_app_founder).toBe("sent");

    // No fabricated "queued"/"sent" logs for unwired rails.
    const fabricated = [...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls].filter(
      ([msg]) => String(msg).includes("queued") || /\b(SMS|Email) sent\b/i.test(String(msg)),
    );
    expect(fabricated).toHaveLength(0);
    // The unavailable status IS logged honestly.
    const honest = vi
      .mocked(logger.warn)
      .mock.calls.filter(([msg]) => String(msg).includes("rail not wired"));
    expect(honest.length).toBeGreaterThanOrEqual(2); // sms + email
  });

  it("arbiter-suppressed founder legs record `suppressed`, not `sent`", async () => {
    h.state.arbiterMode = "suppress";
    const a = await freshDispatcher();
    await a.dispatch({
      eventType: "agent:conflict",
      channel: "in_app",
      payload: { topic: "pricing" },
      priority: 1,
      orgId: 42,
    });

    const [n] = a.getNotifications();
    expect(n.delivery.in_app_founder).toBe("suppressed");
    expect(n.delivery.sms).toBe("suppressed");
    expect(n.delivery.email).toBe("suppressed");
    // Customer-facing org leg is never arbitrated.
    expect(n.delivery.in_app_org).toBe("sent");
  });
});

describe("persistence failure is loud and honest", () => {
  it("marks persisted:false, logs an error, and the item genuinely does not survive", async () => {
    const a = await freshDispatcher();
    h.state.failNextPersist = true;
    await a.dispatch({
      eventType: "briefing:ready",
      channel: "in_app",
      payload: {},
      priority: 3,
      orgId: 42,
    });

    // Still served from memory (tray keeps working)…
    const [n] = a.getNotifications();
    expect(n.eventType).toBe("briefing:ready");
    expect(n.persisted).toBe(false);
    // …but the failure was logged loudly, not swallowed as success.
    expect(
      vi.mocked(logger.error).mock.calls.some(([msg]) => String(msg).includes("NOT survive a restart")),
    ).toBe(true);

    // And a restart honestly does not have it.
    const b = await freshDispatcher();
    expect(b.getNotifications()).toHaveLength(0);
  });
});
