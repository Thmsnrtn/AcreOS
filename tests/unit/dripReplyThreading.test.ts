/**
 * Gap slice 2 — outbound lead email carries the lead-threaded Reply-To.
 *
 * A reply to drip mail only stops the sequence (slice 1) and lands on the
 * lead's timeline if it comes back through the inbound seam, which resolves
 * the lead from `inbox+{leadId}-{hash}@…`. So the outbound send must carry
 * EXACTLY `generateReplyToAddress(leadId, orgId)` as its Reply-To.
 *
 * The REAL generator and the REAL sequence processor run here; only the
 * transport and heavy side modules are mocked. The expected value is computed
 * by the generator itself, and the parse/verify half of the same module is
 * used to prove the address round-trips to the lead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: any) => ({ success: true, messageId: "m1" })),
}));

vi.mock("../../server/storage", () => ({ storage: {}, db: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcast: vi.fn() } }));
vi.mock("../../server/services/activityLogger", () => ({ activityLogger: {} }));
vi.mock("../../server/services/paxControls", () => ({
  getPaxControls: async () => ({}),
  paxControlsRefusalMessage: () => "",
}));
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: async () => ({ written: true }) }));
vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: () => ({ blocked: false }),
  canSendViaChannel: () => ({ allowed: true }),
  isWithinQuietHoursForLead: () => ({ blocked: false }),
}));
vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => ({ allowed: true }),
  describeFrequencySkip: () => "",
  recordContactTouch: async () => undefined,
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { isConfigured: async () => true, sendEmail: H.sendEmail },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sequenceProcessorService } from "../../server/services/sequenceProcessor";
import {
  generateReplyToAddress,
  parseReplyToAddress,
  verifyReplyHash,
} from "../../server/services/inboundEmailService";

const LEAD_ID = 42;
const ORG_ID = 7;

function lead(over: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    organizationId: ORG_ID,
    email: "seller@example.com",
    firstName: "Dana",
    ...over,
  } as any;
}

beforeEach(() => {
  H.sendEmail.mockClear();
});

describe("sequenceProcessor.sendEmail threads the reply through the inbound seam", () => {
  it("passes exactly generateReplyToAddress(leadId, orgId) as replyTo", async () => {
    const result = await sequenceProcessorService.sendEmail(lead(), "Hello", "<p>Body</p>");

    expect(result.status).toBe("sent");
    expect(H.sendEmail).toHaveBeenCalledTimes(1);
    const opts = H.sendEmail.mock.calls[0][0];
    expect(opts.replyTo).toBe(generateReplyToAddress(LEAD_ID, ORG_ID));
    // Lane and identity are untouched by the threading.
    expect(opts.purpose).toBe("counterparty");
    expect(opts.organizationId).toBe(ORG_ID);
    expect(opts.to).toBe("seller@example.com");
  });

  it("the address round-trips through the inbound parser and hash check to THIS lead and org", async () => {
    await sequenceProcessorService.sendEmail(lead(), "Hello", "<p>Body</p>");
    const { replyTo } = H.sendEmail.mock.calls[0][0];

    const parsed = parseReplyToAddress(replyTo);
    expect(parsed).not.toBeNull();
    expect(parsed!.leadId).toBe(LEAD_ID);
    expect(verifyReplyHash(LEAD_ID, ORG_ID, parsed!.hash)).toBe(true);
    // And it does not verify for a different tenant.
    expect(() => verifyReplyHash(LEAD_ID, ORG_ID + 1, parsed!.hash)).not.toThrow();
    expect(verifyReplyHash(LEAD_ID, ORG_ID + 1, parsed!.hash)).toBe(false);
  });

  it("is per-lead: two leads never share a Reply-To", async () => {
    await sequenceProcessorService.sendEmail(lead({ id: 1 }), "Hi", "<p>a</p>");
    await sequenceProcessorService.sendEmail(lead({ id: 2 }), "Hi", "<p>b</p>");
    const [a, b] = H.sendEmail.mock.calls.map((c) => c[0].replyTo);
    expect(a).toBe(generateReplyToAddress(1, ORG_ID));
    expect(b).toBe(generateReplyToAddress(2, ORG_ID));
    expect(a).not.toBe(b);
  });

  it("uses the lead's own organization, the same one the send is made under", async () => {
    await sequenceProcessorService.sendEmail(lead({ organizationId: 99 }), "Hi", "<p>a</p>");
    const opts = H.sendEmail.mock.calls[0][0];
    expect(opts.organizationId).toBe(99);
    expect(opts.replyTo).toBe(generateReplyToAddress(LEAD_ID, 99));
  });

  it("a lead with no email is skipped and nothing is sent", async () => {
    const result = await sequenceProcessorService.sendEmail(lead({ email: null }), "Hi", "<p>a</p>");
    expect(result.status).toBe("skipped");
    expect(H.sendEmail).not.toHaveBeenCalled();
  });
});
