/**
 * Dunning must reach the customer, and its ledger must record only what went out.
 *
 * organizations.owner_id holds users.id (the session's user id), NOT a Clerk id.
 * The billing-email fallback matched users.clerk_user_id against it, found no
 * row, logged "No billing email found", and the event still recorded the email
 * as sent. Drives handlePaymentFailed with an org that has no companyEmail so
 * the owner lookup is the only route to an address; the mocked db answers only
 * when the lookup is keyed on the `id` column.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/systemActivityLogger", () => ({
  logActivity: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: any, val: unknown) => ({ __eqColumn: col?.name, val }) };
});

let ownerRow: { email: string } | null = { email: "owner@acme.test" };
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: any) => ({
          limit: async () => (cond?.__eqColumn === "id" && ownerRow ? [ownerRow] : []),
        }),
      }),
    }),
  },
}));

const SENT: Array<{ to: string }> = [];
let sendResult: { success: boolean; error?: string } = { success: true };
vi.mock("../../server/services/emailService", () => ({
  emailService: {
    sendEmail: vi.fn(async (input: { to: string }) => {
      SENT.push({ to: input.to });
      return sendResult;
    }),
  },
}));

const CREATED: any[] = [];
vi.mock("../../server/storage", () => ({
  storage: {
    getOrganization: vi.fn(async () => ({
      id: 7, name: "Acme", ownerId: "11111111-uuid", settings: {}, dunningStartedAt: null,
      dunningStage: "none", subscriptionTier: "pro", stripeCustomerId: "cus_1",
    })),
    createDunningEvent: vi.fn(async (e: any) => { CREATED.push(e); return { id: 1, ...e }; }),
    updateOrganization: vi.fn(async () => undefined),
    createSystemAlert: vi.fn(async () => ({ id: 1 })),
  },
}));

import { dunningService } from "../../server/services/dunning";

beforeEach(() => {
  SENT.length = 0; CREATED.length = 0;
  ownerRow = { email: "owner@acme.test" };
  sendResult = { success: true };
});

describe("dunning owner-email lookup", () => {
  it("emails the owner resolved by users.id and records the notification", async () => {
    await dunningService.handlePaymentFailed(7, "in_1", "sub_1", 5000, 1);
    expect(SENT).toEqual([{ to: "owner@acme.test" }]);
    expect(CREATED[0].notificationsSent).toHaveLength(1);
  });

  it("records nothing when no address can be found", async () => {
    ownerRow = null;
    await dunningService.handlePaymentFailed(7, "in_1", "sub_1", 5000, 1);
    expect(SENT).toHaveLength(0);
    expect(CREATED[0].notificationsSent).toEqual([]);
  });

  it("records nothing when the provider reports a failed send", async () => {
    sendResult = { success: false, error: "bounced" };
    await dunningService.handlePaymentFailed(7, "in_1", "sub_1", 5000, 1);
    expect(CREATED[0].notificationsSent).toEqual([]);
  });
});
