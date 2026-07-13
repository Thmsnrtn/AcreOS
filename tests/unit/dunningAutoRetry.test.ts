/**
 * D1 — unattended dunning auto-retry ladder (processAutoRetries).
 *
 * Pins the founder-decision rules (2026-07-11):
 *   - Skips entirely while Stripe is unconfigured (ladder not burned).
 *   - Attempts the outstanding invoice on day 1/3/7 after failure.
 *   - One attempt per ladder day — a 6-hourly sweep can't double-fire.
 *   - Success resolves the event (auto_recovered) + clears org dunning
 *     state; failure records the attempt honestly. Both are
 *     Letter-visible via logActivity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({
  storage: {
    getDunningEvents: vi.fn(),
    updateDunningEvent: vi.fn().mockResolvedValue(undefined),
    updateOrganization: vi.fn().mockResolvedValue(undefined),
    createSystemAlert: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../server/services/systemActivityLogger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const payMock = vi.fn();
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => ({ invoices: { pay: payMock } })),
}));

import { dunningService } from "../../server/services/dunning";
import { storage } from "../../server/storage";
import { logActivity } from "../../server/services/systemActivityLogger";
import { getUncachableStripeClient } from "../../server/stripeClient";

const NOW = new Date("2026-07-13T12:00:00Z");

function orgInDunning(daysAgo: number) {
  return {
    id: 42,
    dunningStartedAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    dunningStage: "grace_period",
  } as any;
}

function openEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    organizationId: 42,
    status: "scheduled_retry",
    stripeInvoiceId: "in_123",
    retryCount: 0,
    notificationsSent: [],
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processAutoRetries — D1 ladder", () => {
  it("skips everything when Stripe is unconfigured (ladder preserved)", async () => {
    vi.mocked(getUncachableStripeClient).mockRejectedValueOnce(new Error("no key"));
    const orgsSpy = vi
      .spyOn(dunningService, "getActiveDunningOrgs")
      .mockResolvedValue([orgInDunning(2)]);

    await dunningService.processAutoRetries(NOW);

    expect(orgsSpy).not.toHaveBeenCalled();
    expect(payMock).not.toHaveBeenCalled();
    orgsSpy.mockRestore();
  });

  it("day 0 — before the first rung, no attempt", async () => {
    const orgsSpy = vi
      .spyOn(dunningService, "getActiveDunningOrgs")
      .mockResolvedValue([orgInDunning(0)]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([openEvent()]);

    await dunningService.processAutoRetries(NOW);
    expect(payMock).not.toHaveBeenCalled();
    orgsSpy.mockRestore();
  });

  it("day 1 success — pays, resolves as auto_recovered, clears org, Letter-visible", async () => {
    const orgsSpy = vi
      .spyOn(dunningService, "getActiveDunningOrgs")
      .mockResolvedValue([orgInDunning(1)]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([openEvent()]);
    payMock.mockResolvedValueOnce({});

    await dunningService.processAutoRetries(NOW);

    expect(payMock).toHaveBeenCalledWith("in_123");
    expect(storage.updateDunningEvent).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "resolved",
        resolutionType: "auto_recovered",
        retryCount: 1,
        notificationsSent: [expect.objectContaining({ type: "auto_retry_d1", channel: "stripe" })],
      }),
    );
    expect(storage.updateOrganization).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ dunningStage: "none", dunningStartedAt: null }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ job: "dunning", action: "auto_retry_succeeded" }),
    );
    orgsSpy.mockRestore();
  });

  it("day 1 failure — records the attempt honestly, org stays in dunning, Letter-visible", async () => {
    const orgsSpy = vi
      .spyOn(dunningService, "getActiveDunningOrgs")
      .mockResolvedValue([orgInDunning(1)]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([openEvent()]);
    payMock.mockRejectedValueOnce(new Error("card_declined"));

    await dunningService.processAutoRetries(NOW);

    expect(storage.updateDunningEvent).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        retryCount: 1,
        notificationsSent: [expect.objectContaining({ type: "auto_retry_d1" })],
      }),
    );
    // Failure must NOT resolve the event or clear the org.
    const update = vi.mocked(storage.updateDunningEvent).mock.calls[0][1] as any;
    expect(update.status).toBeUndefined();
    expect(storage.updateOrganization).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ job: "dunning", action: "auto_retry_failed" }),
    );
    orgsSpy.mockRestore();
  });

  it("no double-fire — a ladder day already attempted is skipped, next rung waits", async () => {
    const orgsSpy = vi
      .spyOn(dunningService, "getActiveDunningOrgs")
      .mockResolvedValue([orgInDunning(2)]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([
      openEvent({
        notificationsSent: [{ type: "auto_retry_d1", sentAt: "2026-07-12T12:00:00Z", channel: "stripe" }],
      }),
    ]);

    await dunningService.processAutoRetries(NOW);
    // Day 2: rung 1 already attempted, rung 3 not yet due.
    expect(payMock).not.toHaveBeenCalled();
    orgsSpy.mockRestore();
  });

  it("day 3 fires the second rung after a failed day-1 attempt", async () => {
    const orgsSpy = vi
      .spyOn(dunningService, "getActiveDunningOrgs")
      .mockResolvedValue([orgInDunning(3)]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([
      openEvent({
        retryCount: 1,
        notificationsSent: [{ type: "auto_retry_d1", sentAt: "2026-07-11T12:00:00Z", channel: "stripe" }],
      }),
    ]);
    payMock.mockResolvedValueOnce({});

    await dunningService.processAutoRetries(NOW);

    expect(payMock).toHaveBeenCalledTimes(1);
    expect(storage.updateDunningEvent).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        retryCount: 2,
        notificationsSent: expect.arrayContaining([
          expect.objectContaining({ type: "auto_retry_d3" }),
        ]),
      }),
    );
    orgsSpy.mockRestore();
  });

  it("events without a Stripe invoice are never attempted", async () => {
    const orgsSpy = vi
      .spyOn(dunningService, "getActiveDunningOrgs")
      .mockResolvedValue([orgInDunning(1)]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([openEvent({ stripeInvoiceId: null })]);

    await dunningService.processAutoRetries(NOW);
    expect(payMock).not.toHaveBeenCalled();
    orgsSpy.mockRestore();
  });
});
