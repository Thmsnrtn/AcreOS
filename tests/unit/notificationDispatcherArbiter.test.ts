/**
 * Notification-dispatcher interrupt-arbiter wrapper — Jarvis 2.2 (G3).
 *
 * Pins the EXPLICIT per-event class mapping (urgentChannel events —
 * agent:escalation / approval:requested / agent:conflict — are Class B; the
 * rest are Class C) and the separation of legs:
 *
 *   - the org broadcast (customer-facing) is NEVER arbitrated — it fires on
 *     every outcome, including arbiter failure;
 *   - the founder legs (founder broadcast + SMS + email) fire only on
 *     "deliver"; deferrals write a deferral row; Class C is suppressed;
 *   - an arbiter throw fails CLOSED-quiet for the founder legs only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// dispatcher imports db/sql at module load; it never queries in dispatch().
vi.mock("../../server/db", () => ({ db: {} }));

const ORG_BROADCASTS: Array<{ orgId: number; event: string }> = [];
const FOUNDER_BROADCASTS: Array<{ channel: string; eventType: string }> = [];
vi.mock("../../server/websocket", () => ({
  wsServer: {
    broadcastToOrg: vi.fn((orgId: number, event: string, _payload: any) => {
      ORG_BROADCASTS.push({ orgId, event });
    }),
    broadcast: vi.fn((channel: string, _event: string, payload: any) => {
      FOUNDER_BROADCASTS.push({ channel, eventType: payload.eventType });
    }),
  },
}));

const ARBITER_CALLS: Array<{ source: string; interruptClass: string; channel: string; subject: string }> = [];
const DEFERRALS: Array<{ interruptClass: string; outcome: string }> = [];
let arbiterMode: "deliver" | "defer" | "suppress" | "throw" = "deliver";

vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => {
    ARBITER_CALLS.push({
      source: req.source,
      interruptClass: req.interruptClass,
      channel: req.channel,
      subject: req.subject,
    });
    if (arbiterMode === "throw") throw new Error("arbiter exploded");
    const outcome =
      arbiterMode === "defer" ? "defer_to_letter" : arbiterMode === "suppress" ? "suppress" : "deliver";
    return {
      outcome,
      interruptClass: req.interruptClass,
      reason: "test",
      quietHoursActive: false,
      budget: null,
      deferUntil: arbiterMode === "defer" ? new Date(Date.now() + 86400000) : null,
    };
  }),
  recordDeferredInterrupt: vi.fn(async (req: any, decision: any) => {
    DEFERRALS.push({ interruptClass: req.interruptClass, outcome: decision.outcome });
    return 1;
  }),
}));

import { notificationDispatcher } from "../../server/services/notificationDispatcher";
import { logger } from "../../server/utils/logger";

beforeEach(() => {
  ORG_BROADCASTS.length = 0;
  FOUNDER_BROADCASTS.length = 0;
  ARBITER_CALLS.length = 0;
  DEFERRALS.length = 0;
  arbiterMode = "deliver";
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.error).mockClear();
});

describe("explicit per-event class mapping", () => {
  it("urgentChannel events (escalation / approval / conflict) map to Class B", async () => {
    for (const eventType of ["agent:escalation", "approval:requested", "agent:conflict"]) {
      await notificationDispatcher.dispatch({
        eventType,
        channel: "in_app",
        payload: {},
        priority: 3,
        orgId: 1,
      });
    }
    expect(ARBITER_CALLS.map((c) => c.interruptClass)).toEqual(["B", "B", "B"]);
    expect(ARBITER_CALLS[0]).toMatchObject({
      source: "notification_dispatcher",
      channel: "founder_broadcast",
    });
  });

  it("the rest map to Class C — including unmapped event types", async () => {
    for (const eventType of ["deal:discovered", "job:failed", "briefing:ready", "made:up_event"]) {
      await notificationDispatcher.dispatch({
        eventType,
        channel: "in_app",
        payload: {},
        priority: 3,
        orgId: 1,
      });
    }
    expect(ARBITER_CALLS.map((c) => c.interruptClass)).toEqual(["C", "C", "C", "C"]);
  });
});

describe("founder legs vs customer-facing org broadcast", () => {
  it("deliver → org broadcast AND founder broadcast AND urgent SMS leg", async () => {
    await notificationDispatcher.dispatch({
      eventType: "agent:escalation",
      channel: "in_app",
      payload: { agent: "sophie", reason: "needs input" },
      priority: 1, // urgent → SMS leg
      orgId: 42,
    });

    expect(ORG_BROADCASTS).toEqual([{ orgId: 42, event: "notification" }]);
    expect(FOUNDER_BROADCASTS).toEqual([
      { channel: "founder:activity", eventType: "agent:escalation" },
    ]);
    const smsLogs = vi
      .mocked(logger.info)
      .mock.calls.filter(([msg]) => String(msg).includes("SMS queued"));
    expect(smsLogs).toHaveLength(1);
  });

  it("suppress (Class C) → org broadcast still fires; founder broadcast, SMS and email do not", async () => {
    arbiterMode = "suppress";
    await notificationDispatcher.dispatch({
      eventType: "deal:discovered",
      channel: "in_app",
      payload: { address: "1 Acre Rd", price: 5000 },
      priority: 1,
      orgId: 42,
    });

    expect(ORG_BROADCASTS).toHaveLength(1);
    expect(FOUNDER_BROADCASTS).toHaveLength(0);
    const founderLegLogs = vi
      .mocked(logger.info)
      .mock.calls.filter(([msg]) => String(msg).includes("SMS queued") || String(msg).includes("Email queued"));
    expect(founderLegLogs).toHaveLength(0);
    expect(DEFERRALS).toHaveLength(0); // suppression is not a deferral
  });

  it("defer (Class B over budget) → founder legs held AND a deferral row recorded; org broadcast unaffected", async () => {
    arbiterMode = "defer";
    await notificationDispatcher.dispatch({
      eventType: "approval:requested",
      channel: "in_app",
      payload: { description: "spend $40" },
      priority: 1,
      orgId: 42,
    });

    expect(ORG_BROADCASTS).toHaveLength(1);
    expect(FOUNDER_BROADCASTS).toHaveLength(0);
    expect(DEFERRALS).toEqual([{ interruptClass: "B", outcome: "defer_to_letter" }]);
  });

  it("arbiter throw fails CLOSED-quiet: founder legs suppressed with a logged error, customer path untouched", async () => {
    arbiterMode = "throw";
    await notificationDispatcher.dispatch({
      eventType: "agent:conflict",
      channel: "in_app",
      payload: { topic: "pricing" },
      priority: 1,
      orgId: 42,
    });

    expect(ORG_BROADCASTS).toHaveLength(1);
    expect(FOUNDER_BROADCASTS).toHaveLength(0);
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });

  it("the in-app history store (pull-based tray) records the notification regardless of outcome", async () => {
    arbiterMode = "suppress";
    await notificationDispatcher.dispatch({
      eventType: "market:alert",
      channel: "in_app",
      payload: { county: "Travis", description: "prices up" },
      priority: 3,
      orgId: 42,
    });

    const stored = notificationDispatcher.getNotifications(5);
    expect(stored.some((n) => n.eventType === "market:alert")).toBe(true);
  });
});
