/**
 * Witnessed first-follow-up send loop (Maren / "Pax acted" proof).
 *
 * Proves the autonomyGuardrails kernel is wired into the live Pax send path:
 *
 *   1. At the default "assisted" level, executeTool("send_email", …) returns a
 *      DRAFT and sends NOTHING — no email, no rate-limit consumption, no record.
 *   2. An EXPLICIT human approval (args._approved === true) unlocks the guarded
 *      send: it runs checkSendRateLimit → checkTcpaBeforeSend → emailService.send
 *      → recordAutonomousSend, in that order.
 *   3. A default org never auto-sends: the bare (unapproved) call is the only
 *      path the LLM tool loop can reach, and it never touches sendEmail().
 *
 * Every external dependency of server/ai/tools.ts is stubbed so the test
 * isolates the send-path control flow, not the DB or SES.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mock fns (vi.mock factories run before module-body declarations) ─
const {
  getOrgAutonomyLevel,
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
  sendEmail,
  isConfigured,
  getLead,
} = vi.hoisted(() => ({
  getOrgAutonomyLevel: vi.fn(async () => "assisted" as const),
  checkSendRateLimit: vi.fn(async () => ({ allowed: true }) as { allowed: boolean; reason?: string }),
  checkTcpaBeforeSend: vi.fn(async () => ({ allowed: true }) as { allowed: boolean; reason?: string }),
  recordAutonomousSend: vi.fn(async () => undefined),
  sendEmail: vi.fn(async () => ({ success: true, messageId: "msg_witnessed_1" }) as { success: boolean; messageId?: string; error?: string }),
  isConfigured: vi.fn(async () => true),
  getLead: vi.fn(async () => ({
    id: 42,
    email: "stale.lead@example.com",
    firstName: "Stale",
    lastName: "Lead",
    tcpaConsent: true,
    doNotContact: false,
    status: "new",
  })),
}));

// ── Stub the autonomy kernel so we can assert it's actually invoked ──────────
vi.mock("../../server/services/autonomyGuardrails", () => ({
  getOrgAutonomyLevel,
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
}));

// ── Stub the send path + the lead lookup ─────────────────────────────────────
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail, isConfigured },
}));

vi.mock("../../server/storage", () => ({
  storage: { getLead },
  db: {},
}));

// TCPA consent helper at the top of the send_email case — always allow here so
// the test exercises the autonomy gate, not the static consent check.
vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: vi.fn(() => ({ canEmail: true, canSms: true })),
  isWithinQuietHours: vi.fn(() => ({ blocked: false })),
  isWithinQuietHoursForLead: vi.fn(() => ({ blocked: false })),
}));

// ── Stub the remaining heavy imports so the module graph stays light ─────────
vi.mock("../../server/services/aiContextAggregator", () => ({
  getSystemContext: vi.fn(),
  formatContextForAI: vi.fn(),
  invalidateContextCache: vi.fn(),
}));
vi.mock("../../server/services/parcel", () => ({ lookupParcelByAPN: vi.fn() }));
vi.mock("../../server/services/aiOfferService", () => ({
  generateOfferSuggestions: vi.fn(),
  generateOfferLetter: vi.fn(),
}));
vi.mock("../../server/services/smsService", () => ({
  smsService: {},
  sendOrgSMS: vi.fn(),
}));
vi.mock("../../server/services/comps", () => ({ getComparableProperties: vi.fn() }));
vi.mock("../../server/services/data-source-broker", () => ({ DataSourceBroker: class {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/ai/validators", () => ({
  validateAtlasOutput: vi.fn(),
  AtlasOutputType: {},
}));

import { executeTool } from "../../server/ai/tools";

const org = { id: 7, name: "Test Org" } as any;

const sendArgs = {
  lead_id: 42,
  subject: "Following up on your land",
  message: "Hi Stale, just checking in.",
};

beforeEach(() => {
  vi.clearAllMocks();
  getOrgAutonomyLevel.mockResolvedValue("assisted" as const);
  checkSendRateLimit.mockResolvedValue({ allowed: true });
  checkTcpaBeforeSend.mockResolvedValue({ allowed: true });
  isConfigured.mockResolvedValue(true);
  sendEmail.mockResolvedValue({ success: true, messageId: "msg_witnessed_1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("witnessed send — assisted level returns a draft, never sends", () => {
  it("returns a draft (no send) when no explicit approval is given", async () => {
    const result = await executeTool("send_email", sendArgs, org);

    expect(result.success).toBe(true);
    expect((result.data as any)?.draft).toBe(true);
    expect((result.data as any)?.requiresApproval).toBe(true);
    expect((result.data as any)?.to).toBe("stale.lead@example.com");

    // The invariant: NOTHING sent.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
    // Draft must not consume the daily envelope.
    expect(checkSendRateLimit).not.toHaveBeenCalled();
  });

  it("default org never auto-sends — the LLM-reachable call only ever drafts", async () => {
    // The tool loop never passes _approved; simulate that exact call shape.
    const result = await executeTool("send_email", { ...sendArgs }, org);
    expect((result.data as any)?.draft).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("witnessed send — explicit human approval triggers the guarded send", () => {
  it("runs rate-limit + TCPA + send + record, in order, on _approved:true", async () => {
    const result = await executeTool(
      "send_email",
      { ...sendArgs, _approved: true },
      org,
    );

    expect(result.success).toBe(true);
    expect((result.data as any)?.messageId).toBe("msg_witnessed_1");

    // The full guarded path fired.
    expect(checkSendRateLimit).toHaveBeenCalledWith(7, "email");
    expect(checkTcpaBeforeSend).toHaveBeenCalledWith(42);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(recordAutonomousSend).toHaveBeenCalledTimes(1);
    expect(recordAutonomousSend).toHaveBeenCalledWith(
      7,
      "email",
      42,
      expect.stringContaining("Following up on your land"),
    );

    // Ordering: envelope + TCPA checked before the send; record after it.
    const rateOrder = checkSendRateLimit.mock.invocationCallOrder[0];
    const tcpaOrder = checkTcpaBeforeSend.mock.invocationCallOrder[0];
    const sendOrder = sendEmail.mock.invocationCallOrder[0];
    const recordOrder = recordAutonomousSend.mock.invocationCallOrder[0];
    expect(rateOrder).toBeLessThan(sendOrder);
    expect(tcpaOrder).toBeLessThan(sendOrder);
    expect(sendOrder).toBeLessThan(recordOrder);
  });

  it("blocks the approved send when the daily envelope is exhausted", async () => {
    checkSendRateLimit.mockResolvedValue({ allowed: false, reason: "Daily autonomous send limit reached" });

    const result = await executeTool(
      "send_email",
      { ...sendArgs, _approved: true },
      org,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Daily autonomous send limit reached");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
  });

  it("blocks the approved send when TCPA disallows the lead", async () => {
    checkTcpaBeforeSend.mockResolvedValue({ allowed: false, reason: "Lead is marked do-not-contact" });

    const result = await executeTool(
      "send_email",
      { ...sendArgs, _approved: true },
      org,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("do-not-contact");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
  });
});
