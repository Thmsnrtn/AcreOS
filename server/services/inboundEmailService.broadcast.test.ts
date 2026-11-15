/**
 * Cohesion Wave-1 — live inbox unread badge (inbound email path).
 *
 * When an inbound seller reply lands and is persisted to inbox_messages,
 * processInboundEmail must publish `inbox.unread` to the org channel so the
 * sidebar badge refetches live. The inbox is per-org, so the event is
 * org-scoped (never user-scoped).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// db is imported from ../storage in the service; mocking it here also avoids
// dragging in the storage god-class.
const { dbMock, broadcastToOrg } = vi.hoisted(() => {
  const stored = { id: 555 };
  const lead = { id: 42, organizationId: 99, firstName: "Sam", lastName: "Seller" };
  // insert(...).values(v) is BOTH awaitable (inbox_messages, lead_activities)
  // AND chainable to .returning() (lead_emails). A thenable with a .returning
  // method satisfies both call shapes.
  const valuesResult: any = Promise.resolve([stored]);
  valuesResult.returning = () => Promise.resolve([stored]);
  return {
    dbMock: {
      _lead: lead,
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([lead]) }) }),
      }),
      insert: () => ({ values: () => valuesResult }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    broadcastToOrg: vi.fn(),
  };
});

vi.mock("../storage", () => ({ db: dbMock }));
vi.mock("../websocket", () => ({ wsServer: { broadcastToOrg } }));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./activityLogger", () => ({
  activityLogger: { logEmailSent: vi.fn() },
}));

vi.mock("./activation", () => ({
  recordActivationEventAsync: vi.fn(),
}));

// Stop-on-reply seam: spy on the pause the writer must call (the real helper
// lazily loads the whole sequence processor).
const { pauseSequencesOnResponse } = vi.hoisted(() => ({
  pauseSequencesOnResponse: vi.fn(async (_orgId: number, _leadId: number) => undefined),
}));
vi.mock("./leadResponse", () => ({ pauseSequencesOnResponse }));

import { processInboundEmail, generateReplyToAddress } from "./inboundEmailService";

beforeEach(() => {
  broadcastToOrg.mockClear();
  pauseSequencesOnResponse.mockClear();
});

describe("processInboundEmail → stop-on-reply", () => {
  it("pauses the resolved lead's active drip enrollments", async () => {
    const result = await processInboundEmail({
      from: "seller@example.com",
      to: generateReplyToAddress(42, 99),
      subject: "Re: your offer",
    });
    expect(result.success).toBe(true);
    expect(pauseSequencesOnResponse).toHaveBeenCalledWith(99, 42);
  });

  it("does not pause when the recipient resolves to no lead", async () => {
    const result = await processInboundEmail({ from: "x@example.com", to: "nobody@example.com" });
    expect(result.success).toBe(false);
    expect(pauseSequencesOnResponse).not.toHaveBeenCalled();
  });
});

describe("processInboundEmail → inbox.unread broadcast", () => {
  it("publishes inbox.unread to the recipient lead's org channel", async () => {
    // Build a to-address whose HMAC hash verifies for (leadId 42, org 99),
    // using the module's own generator so the secret matches.
    const to = generateReplyToAddress(42, 99);

    const result = await processInboundEmail({
      from: "seller@example.com",
      to,
      subject: "Re: your offer",
      textBody: "Yes, I'm interested.",
    });

    expect(result).toEqual({ success: true, leadId: 42 });
    expect(broadcastToOrg).toHaveBeenCalledTimes(1);
    expect(broadcastToOrg).toHaveBeenCalledWith(99, "inbox.unread", { channel: "email" });
  });
});
