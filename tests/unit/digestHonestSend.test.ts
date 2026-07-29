/**
 * Weekly digest send honesty — Wave A ("Nothing lies").
 *
 * The old behavior stamped lastSentAt and counted `sent` even when no email
 * provider was configured (fabricated success). Pins the fix:
 *  - only a provider-accepted send counts `sent` and stamps the digest;
 *  - an unconfigured/failed send counts `failed` with reason, unstamped
 *    (so it retries next run);
 *  - a subscriber with no email address counts `skipped`, unstamped;
 *  - a thrown error counts `failed`, unstamped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  subs: [] as any[],
  orgs: [] as any[],
  members: [] as any[],
  stamped: [] as any[],
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Route the digest service's direct drizzle queries by table identity.
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: async (_cond: any) => {
          const schema = await import("@shared/schema");
          if (table === schema.digestSubscriptions) return h.subs;
          if (table === schema.organizations) return h.orgs;
          if (table === schema.teamMembers) return h.members;
          return [];
        },
      }),
    }),
    update: (_table: any) => ({
      set: (values: any) => ({
        where: async (_cond: any) => {
          h.stamped.push(values);
        },
      }),
    }),
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getLeads: vi.fn(async () => []),
    getCampaigns: vi.fn(async () => []),
    getNotes: vi.fn(async () => []),
    getPayments: vi.fn(async () => []),
  },
}));

const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: sendEmailMock },
}));

import { digestService } from "../../server/services/digest";
import { logger } from "../../server/utils/logger";

beforeEach(() => {
  h.subs.length = 0;
  h.orgs.length = 0;
  h.members.length = 0;
  h.stamped.length = 0;
  sendEmailMock.mockReset();
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();

  h.subs.push({
    id: 1,
    userId: "u1",
    organizationId: 7,
    frequency: "weekly",
    emailEnabled: true,
    lastSentAt: null,
  });
  h.orgs.push({ id: 7, name: "Test Org" });
  h.members.push({ userId: "u1", organizationId: 7, email: "u1@test.com" });
});

describe("processWeeklyDigests honesty", () => {
  it("counts sent and stamps delivered ONLY when the provider accepted the email", async () => {
    sendEmailMock.mockResolvedValue({ success: true, messageId: "m1" });

    const result = await digestService.processWeeklyDigests();

    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(h.stamped).toHaveLength(1);
    expect(h.stamped[0].lastSentAt).toBeInstanceOf(Date);
  });

  it("an unconfigured provider is failed-with-reason, NEVER sent, and NOT stamped", async () => {
    sendEmailMock.mockResolvedValue({ success: false, error: "No email provider configured" });

    const result = await digestService.processWeeklyDigests();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(h.stamped).toHaveLength(0); // digest NOT stamped delivered → retried next run
    const warned = vi
      .mocked(logger.warn)
      .mock.calls.filter(([msg]) => String(msg).includes("NOT delivered") && String(msg).includes("No email provider configured"));
    expect(warned).toHaveLength(1);
  });

  it("a provider-reported failure is failed-with-reason and NOT stamped", async () => {
    sendEmailMock.mockResolvedValue({ success: false, error: "SES rejected: sandbox" });

    const result = await digestService.processWeeklyDigests();

    expect(result).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(h.stamped).toHaveLength(0);
  });

  it("a subscriber with no email address is skipped-with-reason and NOT stamped", async () => {
    h.members.length = 0;

    const result = await digestService.processWeeklyDigests();

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(h.stamped).toHaveLength(0);
    expect(
      vi.mocked(logger.warn).mock.calls.some(([msg]) => String(msg).includes("no email address")),
    ).toBe(true);
  });

  it("a thrown send error is failed and NOT stamped", async () => {
    sendEmailMock.mockRejectedValue(new Error("network down"));

    const result = await digestService.processWeeklyDigests();

    expect(result).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(h.stamped).toHaveLength(0);
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });

  it("a missing organization is skipped, not silently dropped", async () => {
    h.orgs.length = 0;

    const result = await digestService.processWeeklyDigests();

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(h.stamped).toHaveLength(0);
  });
});
