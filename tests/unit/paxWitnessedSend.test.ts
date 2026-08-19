/**
 * Witnessed first-follow-up send loop (Maren / "Pax acted" proof).
 *
 * Proves the autonomyGuardrails kernel is wired into the live Pax send path:
 *
 *   1. At the default "assisted" level, executeTool("send_email", …) returns a
 *      DRAFT and sends NOTHING — no email, no rate-limit consumption, no record.
 *   2. An EXPLICIT human approval ({ trustedApproval: true } executeTool
 *      OPTION — server-side only, never a model-suppliable arg) unlocks the
 *      guarded send: it runs checkSendRateLimit → checkTcpaBeforeSend →
 *      emailService.send → recordAutonomousSend, in that order.
 *   3. A default org never auto-sends: the bare (unapproved) call is the only
 *      path the LLM tool loop can reach, and it never touches sendEmail().
 *
 * 2026-06-10 (T0-1, elevation blueprint): approval moved from args._approved
 * (which the MODEL could emit itself) to the trustedApproval option, and the
 * same kernel gate now covers send_sms, which previously had NO autonomy gate
 * at all. New assertions: model-supplied _approved is stripped and ignored;
 * send_sms drafts at assisted level and runs the full envelope on approval.
 *
 * 2026-06-10 (Tier 1A): the unapproved path no longer returns a per-tool
 * draft — the approval kernel inside executeTool freezes the call as a
 * pending_actions row and returns a pending artifact. The invariant under
 * test is unchanged (NOTHING sends without trustedApproval); the artifact
 * shape assertions moved from { draft: true } to { pendingApproval: true }.
 * Kernel internals (hash, idempotency, expiry) are covered by
 * approvalKernel.test.ts — here the kernel's propose path is stubbed.
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
  sendOrgSMS,
  isConfigured,
  proposePendingAction,
  getLead,
} = vi.hoisted(() => ({
  getOrgAutonomyLevel: vi.fn(async () => "assisted" as const),
  checkSendRateLimit: vi.fn(async () => ({ allowed: true }) as { allowed: boolean; reason?: string }),
  checkTcpaBeforeSend: vi.fn(async () => ({ allowed: true }) as { allowed: boolean; reason?: string }),
  recordAutonomousSend: vi.fn(async () => undefined),
  sendEmail: vi.fn(async () => ({ success: true, messageId: "msg_witnessed_1" }) as { success: boolean; messageId?: string; error?: string }),
  sendOrgSMS: vi.fn(async () => ({ success: true, messageId: "sms_witnessed_1" }) as { success: boolean; messageId?: string; error?: string }),
  isConfigured: vi.fn(async () => true),
  proposePendingAction: vi.fn(async (input: any) => ({
    id: 9001,
    organizationId: input.organizationId,
    toolName: input.toolName,
    args: input.args,
    contentHash: "test-hash",
    status: "pending",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdByUserId: input.createdByUserId ?? null,
  })),
  getLead: vi.fn(async () => ({
    id: 42,
    email: "stale.lead@example.com",
    phone: "+16175550142",
    firstName: "Stale",
    lastName: "Lead",
    tcpaConsent: true,
    doNotContact: false,
    status: "new",
  })),
}));

// ── Stub the autonomy kernel so we can assert it's actually invoked ──────────
//
// `unattendedSendPermitted` is deliberately the REAL implementation, not a stub.
// It is the predicate that decides whether a level may send without a human tap,
// and a mock returning a fixed answer would make this suite agree with any
// implementation of it — including one that inverts the polarity. The rest of
// the kernel is stubbed because this file isolates send-path CONTROL FLOW; that
// one function IS the control flow being asserted.
vi.mock("../../server/services/autonomyGuardrails", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/autonomyGuardrails")>();
  return {
    getOrgAutonomyLevel,
    checkSendRateLimit,
    checkTcpaBeforeSend,
    recordAutonomousSend,
    unattendedSendPermitted: actual.unattendedSendPermitted,
  };
});

// ── Stub the Tier-1A approval kernel's propose path (no DB in this test).
// pendingActionArtifact mirrors the real shape; kernel internals are covered
// by approvalKernel.test.ts.
vi.mock("../../server/services/approvalKernel", () => ({
  APPROVAL_REQUIRED_TOOLS: new Set([
    "send_email",
    "send_sms",
    "send_gmail",
    "send_slack_message",
    "create_stripe_payment_link",
  ]),
  proposePendingAction,
  pendingActionArtifact: (row: any) => ({
    pendingApproval: true,
    requiresApproval: true,
    pendingActionId: row.id,
    toolName: row.toolName,
    channel: row.toolName === "send_sms" ? "sms" : "email",
    args: row.args,
    contentHash: row.contentHash,
    expiresAt: row.expiresAt,
  }),
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
  sendOrgSMS,
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
  it("returns a pending action (no send) when no explicit approval is given", async () => {
    const result = await executeTool("send_email", sendArgs, org);

    expect(result.success).toBe(true);
    expect((result.data as any)?.pendingApproval).toBe(true);
    expect((result.data as any)?.requiresApproval).toBe(true);
    // The call is frozen exactly as proposed.
    expect(proposePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 7, toolName: "send_email", args: sendArgs }),
    );

    // The invariant: NOTHING sent.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
    // A pending action must not consume the daily envelope.
    expect(checkSendRateLimit).not.toHaveBeenCalled();
  });

  it("default org never auto-sends — the LLM-reachable call only ever proposes", async () => {
    // The tool loop never passes options; simulate that exact call shape.
    const result = await executeTool("send_email", { ...sendArgs }, org);
    expect((result.data as any)?.pendingApproval).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("ignores a model-supplied _approved:true arg — still proposes, never sends", async () => {
    // 2026-06-10 (T0-1): approval used to be args._approved, which the model
    // could emit itself. The kernel now strips it; only the server-side
    // trustedApproval OPTION unlocks the send.
    const result = await executeTool(
      "send_email",
      { ...sendArgs, _approved: true },
      org,
    );

    expect(result.success).toBe(true);
    expect((result.data as any)?.pendingApproval).toBe(true);
    expect((result.data as any)?.requiresApproval).toBe(true);
    // The stripped arg never reaches the frozen row.
    expect(proposePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ args: sendArgs }),
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
    expect(checkSendRateLimit).not.toHaveBeenCalled();
  });
});

describe("witnessed send — explicit human approval triggers the guarded send", () => {
  it("runs rate-limit + TCPA + send + record, in order, on trustedApproval", async () => {
    const result = await executeTool(
      "send_email",
      { ...sendArgs },
      org,
      { trustedApproval: true },
    );

    expect(result.success).toBe(true);
    expect((result.data as any)?.messageId).toBe("msg_witnessed_1");

    // The full guarded path fired.
    expect(checkSendRateLimit).toHaveBeenCalledWith(7, "email");
    // (T0-5: TCPA lookup is org-scoped now — orgId first, then leadId.)
    expect(checkTcpaBeforeSend).toHaveBeenCalledWith(7, 42);
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
      { ...sendArgs },
      org,
      { trustedApproval: true },
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
      { ...sendArgs },
      org,
      { trustedApproval: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("do-not-contact");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// send_sms — same kernel, same invariants (2026-06-10, T0-1). Before this,
// send_sms had NO autonomy gate: one model tool call fired a live SMS.
// ─────────────────────────────────────────────────────────────────────────────

const smsArgs = {
  lead_id: 42,
  message: "Hi Stale, just checking in about your land.",
};

describe("witnessed send — send_sms proposes at assisted level, never sends", () => {
  it("returns a pending action (no send) when no trusted approval is given", async () => {
    const result = await executeTool("send_sms", { ...smsArgs }, org);

    expect(result.success).toBe(true);
    expect((result.data as any)?.pendingApproval).toBe(true);
    expect((result.data as any)?.requiresApproval).toBe(true);
    expect((result.data as any)?.channel).toBe("sms");
    expect(proposePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 7, toolName: "send_sms", args: smsArgs }),
    );

    // The invariant: NOTHING sent, no envelope consumed, no audit record.
    expect(sendOrgSMS).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
    expect(checkSendRateLimit).not.toHaveBeenCalled();
  });

  it("ignores a model-supplied _approved:true arg on send_sms too", async () => {
    const result = await executeTool(
      "send_sms",
      { ...smsArgs, _approved: true },
      org,
    );

    expect((result.data as any)?.pendingApproval).toBe(true);
    expect(proposePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ args: smsArgs }),
    );
    expect(sendOrgSMS).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
  });
});

describe("witnessed send — send_sms guarded send on trusted approval", () => {
  it("runs rate-limit + org-scoped TCPA + send + record on trustedApproval", async () => {
    const result = await executeTool(
      "send_sms",
      { ...smsArgs },
      org,
      { trustedApproval: true },
    );

    expect(result.success).toBe(true);
    expect((result.data as any)?.messageId).toBe("sms_witnessed_1");

    expect(checkSendRateLimit).toHaveBeenCalledWith(7, "sms");
    expect(checkTcpaBeforeSend).toHaveBeenCalledWith(7, 42);
    expect(sendOrgSMS).toHaveBeenCalledTimes(1);
    expect(sendOrgSMS).toHaveBeenCalledWith(7, "+16175550142", smsArgs.message);
    expect(recordAutonomousSend).toHaveBeenCalledWith(7, "sms", 42, smsArgs.message);

    // Ordering: envelope + TCPA checked before the send; record after it.
    const rateOrder = checkSendRateLimit.mock.invocationCallOrder[0];
    const tcpaOrder = checkTcpaBeforeSend.mock.invocationCallOrder[0];
    const sendOrder = sendOrgSMS.mock.invocationCallOrder[0];
    const recordOrder = recordAutonomousSend.mock.invocationCallOrder[0];
    expect(rateOrder).toBeLessThan(sendOrder);
    expect(tcpaOrder).toBeLessThan(sendOrder);
    expect(sendOrder).toBeLessThan(recordOrder);
  });

  it("blocks the approved SMS when the daily envelope is exhausted", async () => {
    checkSendRateLimit.mockResolvedValue({ allowed: false, reason: "Daily autonomous send limit reached" });

    const result = await executeTool(
      "send_sms",
      { ...smsArgs },
      org,
      { trustedApproval: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Daily autonomous send limit reached");
    expect(sendOrgSMS).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
  });

  it("blocks the approved SMS when TCPA disallows the lead", async () => {
    checkTcpaBeforeSend.mockResolvedValue({ allowed: false, reason: "No TCPA consent on record for this lead" });

    const result = await executeTool(
      "send_sms",
      { ...smsArgs },
      org,
      { trustedApproval: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No TCPA consent");
    expect(sendOrgSMS).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
  });
});
