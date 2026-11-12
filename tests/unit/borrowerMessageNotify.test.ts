/**
 * S-05 (P1-4b) — borrower-message lender notification.
 *
 * The borrower's portal message used to be a dead letter: the row was
 * written and nobody was told. `notifyLenderOfBorrowerMessage` is the wire:
 * a mute-gated push to the note's org plus an in-app notification row per
 * eligible team member. These tests pin:
 *  - the push goes to the MESSAGE'S org with the borrower_message family,
 *    deep-links to the note, and carries NO message text / borrower PII on
 *    the lock screen;
 *  - in-app rows are written only for active members whose stored
 *    preference allows finance.borrower_message inApp (shouldNotify — which
 *    refuses a global mute);
 *  - the service never throws: a failing leg degrades, it does not fail
 *    the borrower's send.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  pushOrgEvent: vi.fn(async () => true),
  shouldNotify: vi.fn(async () => true),
  getTeamMembers: vi.fn(async () => [] as Array<Record<string, unknown>>),
  createNotification: vi.fn(async (row: Record<string, unknown>) => ({ id: 1, ...row })),
}));

vi.mock("../../server/services/orgPushFanout", () => ({ pushOrgEvent: h.pushOrgEvent }));
vi.mock("../../server/services/notificationPreferences", () => ({
  notificationPrefsService: { shouldNotify: h.shouldNotify },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getTeamMembers: h.getTeamMembers,
    createNotification: h.createNotification,
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  notifyLenderOfBorrowerMessage,
  BORROWER_MESSAGE_EVENT_ID,
} from "../../server/services/borrowerMessageNotify";

const member = (userId: string, isActive = true) => ({
  id: Math.abs(userId.split("").reduce((a, c) => a + c.charCodeAt(0), 0)),
  organizationId: 7,
  userId,
  email: `${userId}@example.test`,
  displayName: userId,
  role: "member",
  permissions: null,
  viewOnlyAssignedLeads: null,
  isActive,
  invitedAt: null,
  joinedAt: null,
});

const notice = {
  orgId: 7,
  noteId: 42,
  messageId: 99,
  content: "Hi, my payment will be two days late this month.",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.pushOrgEvent.mockResolvedValue(true);
  h.shouldNotify.mockResolvedValue(true);
  h.getTeamMembers.mockResolvedValue([]);
  h.createNotification.mockImplementation(async (row: Record<string, unknown>) => ({ id: 1, ...row }));
});

describe("notifyLenderOfBorrowerMessage", () => {
  it("pushes to the message's org with the borrower_message family and no message text on the lock screen", async () => {
    const r = await notifyLenderOfBorrowerMessage(notice);

    expect(r.pushed).toBe(true);
    expect(h.pushOrgEvent).toHaveBeenCalledTimes(1);
    const [orgId, ev] = h.pushOrgEvent.mock.calls[0] as unknown as [
      number,
      { family: string; title: string; body: string; url: string; tag: string },
    ];
    expect(orgId).toBe(7);
    expect(ev.family).toBe("borrower_message");
    expect(ev.url).toBe("/notes/42");
    expect(ev.tag).toContain("42");
    // No counterparty content on a lock screen: neither the message text
    // nor any part of it rides in the push payload.
    expect(ev.body).not.toContain("payment will be two days late");
    expect(ev.title).not.toContain("payment");
  });

  it("writes an in-app row per active member whose preference allows it, linked to the note", async () => {
    h.getTeamMembers.mockResolvedValue([member("uOwner"), member("uVa")]);

    const r = await notifyLenderOfBorrowerMessage(notice);

    expect(r.inApp).toBe(2);
    expect(h.shouldNotify).toHaveBeenCalledWith("uOwner", 7, BORROWER_MESSAGE_EVENT_ID, "inApp");
    const row = h.createNotification.mock.calls[0][0] as Record<string, unknown>;
    expect(row.organizationId).toBe(7);
    expect(row.userId).toBe("uOwner");
    expect(row.type).toBe("finance.borrower_message");
    expect(row.entityType).toBe("note");
    expect(row.entityId).toBe(42);
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.actionUrl).toBe("/notes/42");
    expect(metadata.borrowerMessageId).toBe(99);
    // The in-app row (inside the lender's own app) carries the preview.
    expect(row.message).toContain("payment will be two days late");
  });

  it("skips members whose stored preference refuses the event, and inactive members entirely", async () => {
    h.getTeamMembers.mockResolvedValue([
      member("uMuted"),
      member("uOk"),
      member("uGone", false),
    ]);
    h.shouldNotify.mockImplementation(async (userId: string) => userId !== "uMuted");

    const r = await notifyLenderOfBorrowerMessage(notice);

    expect(r.inApp).toBe(1);
    expect(h.shouldNotify).not.toHaveBeenCalledWith(
      "uGone",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    const rows = h.createNotification.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(rows.map((x) => x.userId)).toEqual(["uOk"]);
  });

  it("a failing push leg does not stop the in-app leg, and nothing throws", async () => {
    h.pushOrgEvent.mockRejectedValue(new Error("push transport exploded"));
    h.getTeamMembers.mockResolvedValue([member("uOwner")]);

    const r = await notifyLenderOfBorrowerMessage(notice);

    expect(r.pushed).toBe(false);
    expect(r.inApp).toBe(1);
  });

  it("a failing member read degrades to no in-app rows, and nothing throws", async () => {
    h.getTeamMembers.mockRejectedValue(new Error("db down"));

    const r = await notifyLenderOfBorrowerMessage(notice);

    expect(r.pushed).toBe(true);
    expect(r.inApp).toBe(0);
    expect(h.createNotification).not.toHaveBeenCalled();
  });

  it("refuses a non-tenant org id without touching either leg", async () => {
    const r = await notifyLenderOfBorrowerMessage({ ...notice, orgId: 0 });

    expect(r).toEqual({ pushed: false, inApp: 0 });
    expect(h.pushOrgEvent).not.toHaveBeenCalled();
    expect(h.getTeamMembers).not.toHaveBeenCalled();
  });
});
