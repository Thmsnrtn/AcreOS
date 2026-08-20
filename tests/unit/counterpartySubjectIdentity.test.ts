/**
 * BYO send rails, applied to the SUBJECT LINE (founder decision 2026-07-17).
 *
 * THE DEFECT THIS GATE EXISTS FOR. `CommunicationsService.sendToLead` sent
 * deal mail with:
 *
 *     subject: options.subject || 'Message from AcreOS'
 *
 * on a call that also passes `purpose: 'counterparty'`. The live caller —
 * POST /api/communications/send (server/routes-core-ai.ts) — reads `subject`
 * straight from the request body, where it is optional. So a send with no
 * subject put OUR name in the first thing the recipient reads, on a message
 * the CUSTOMER is sending to their own seller. The sender-identity enforcement
 * in emailService could never catch it: that guard governs credentials, the
 * From: display name and the CAN-SPAM footer — not body or header TEXT.
 *
 * The lane gates that already existed all supplied an explicit subject, so the
 * defaulting branch was never executed by a test. These cases execute it.
 *
 * WHY BEHAVIOURAL, NOT A SOURCE SCAN. "the string 'Message from AcreOS' is
 * gone from communications.ts" is the wrong proposition — the platform brand
 * can return through a renamed constant, an env value, a helper, or a
 * different default expression. What matters is what lands in the `subject`
 * field handed to `emailService.sendEmail` on the counterparty lane, so that
 * is what every case below reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: (opts: unknown) => sendEmail(opts) },
}));

const state = {
  org: null as null | { id: number; name?: string | null },
  lead: {
    id: 7,
    organizationId: 42,
    firstName: "Lee",
    email: "seller@example.com",
    phone: null as string | null,
  },
};
const createLeadActivity = vi.fn();
vi.mock("../../server/storage", () => ({
  storage: {
    getLead: async () => state.lead,
    getOrganization: async () => state.org,
    createLeadActivity: (row: unknown) => createLeadActivity(row),
  },
}));

vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: () => ({ blocked: false }),
  checkTcpaConsent: async () => ({ blocked: false, canSms: true }),
  canSendViaChannel: () => ({ allowed: true }),
}));

vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => ({ allowed: true }),
  describeFrequencySkip: () => "frequency",
}));

vi.mock("../../server/services/smsService", () => ({
  smsService: { isConfigured: () => false },
  sendOrgSMS: async () => ({ success: false }),
}));

vi.mock("../../server/services/lobService", () => ({
  lobService: {
    sendLetter: async () => ({ success: false, isTestMode: true }),
    isConfiguredForOrg: async () => false,
  },
  LobErrorType: {},
}));

vi.mock("../../server/services/actions/outwardAction", () => ({
  classifyExisting: () => "execute",
  requestHash: () => "hash",
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { communicationsService } from "../../server/services/communications";

const BASE = { leadId: 7, organizationId: 42, channel: "email" as const, message: "Are you selling?" };

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue({ success: true, messageId: "m-1" });
  state.org = { id: 42, name: "Brazos Land Partners" };
});

/** The options object handed to emailService for the one send under test. */
function sentOptions(): Record<string, any> {
  expect(sendEmail).toHaveBeenCalledTimes(1);
  return sendEmail.mock.calls[0][0] as Record<string, any>;
}

describe("VACUITY — this harness really does reach emailService on the counterparty lane", () => {
  it("an explicit subject is passed through verbatim, on the counterparty lane", async () => {
    // Without this control every "the subject is not 'Message from AcreOS'"
    // assertion below could pass on a send that never happened.
    const result = await communicationsService.sendToLead({ ...BASE, subject: "Your 40 acres on FM 2147" });

    expect(result.success).toBe(true);
    expect(sentOptions().subject).toBe("Your 40 acres on FM 2147");
    expect(sentOptions().purpose).toBe("counterparty");
  });
});

describe("a counterparty send with NO subject never names the platform", () => {
  it("falls back to the SENDING ORG's own name", async () => {
    const result = await communicationsService.sendToLead({ ...BASE });

    expect(result.success).toBe(true);
    expect(sentOptions().subject).toBe("Message from Brazos Land Partners");
    // Unanchored and case-insensitive on purpose: the defect is "our identity
    // on their mail", and it does not care which spelling it arrives in.
    expect(sentOptions().subject).not.toMatch(/acreos/i);
  });

  it("a whitespace-only subject is treated as absent, not sent as-is", async () => {
    // The old `options.subject || …` accepted "   " as a subject. An empty
    // subject line is its own defect, and a gate that only checked `undefined`
    // would miss the equivalent representation.
    await communicationsService.sendToLead({ ...BASE, subject: "   " });

    expect(sentOptions().subject).toBe("Message from Brazos Land Partners");
  });

  it("REFUSES when the org has no name on file — it never invents a sender", async () => {
    // Refuse, never fabricate. A generic subject would be a made-up sender
    // identity on a real person's inbox, which is worse than an unsent email.
    state.org = { id: 42, name: "  " };

    const result = await communicationsService.sendToLead({ ...BASE });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/subject/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("REFUSES when the org row cannot be read at all", async () => {
    state.org = null;

    const result = await communicationsService.sendToLead({ ...BASE });

    expect(result.success).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("records the subject that was ACTUALLY SENT, not the caller's absent one", async () => {
    // The activity row is the durable account of what the counterparty
    // received; logging `undefined` there would leave no record of the line
    // that went out under the customer's name.
    await communicationsService.sendToLead({ ...BASE });

    expect(createLeadActivity).toHaveBeenCalledTimes(1);
    const row = createLeadActivity.mock.calls[0][0] as Record<string, any>;
    expect(row.metadata.subject).toBe("Message from Brazos Land Partners");
  });
});
