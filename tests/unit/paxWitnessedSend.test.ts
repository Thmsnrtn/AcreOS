/**
 * Witnessed send — a send never executes without a human tap, at EITHER
 * stance, and APPROVAL_REQUIRED_TOOLS may only grow.
 *
 * The invariant (founder decision 1, 2026-09-02, and the standing posture
 * before it): NOTHING Pax writes to another person goes out until a human
 * taps Approve. The approval kernel inside executeTool freezes every
 * approval-required call as a pending_actions row and returns a pending
 * artifact; the ONLY path to execution is the approve endpoint replaying
 * the frozen row with { trustedApproval: true }.
 *
 * What is asserted, and why each half is load-bearing:
 *   1. The REAL APPROVAL_REQUIRED_TOOLS (imported from the kernel, not a
 *      copy) is a superset of the baseline below — the set may only GROW.
 *      Remove `send_sms` from the kernel and this goes red on its own.
 *   2. Every member of the REAL set, called without trustedApproval at BOTH
 *      offered stances, proposes an ask and touches no rail — the stance is
 *      read from the ONE reader and does not matter for a send. The rails
 *      (SES, Twilio, the connector executor) are spies, so "never sent" is
 *      an observation, not an assumption.
 *   3. The trusted replay runs the guarded envelope in order: rate limit →
 *      TCPA → send → record. Envelope / TCPA refusals still hold after a tap.
 *   4. Model-supplied `_approved: true` is stripped and ignored.
 *
 * The per-tool "autonomy level" branches that used to sit inside the send
 * cases were unreachable (the kernel gate ran first) and are deleted; there
 * is no level to read any more, so no mock of one.
 *
 * Every external dependency of server/ai/tools.ts is stubbed so the test
 * isolates the send-path control flow, not the DB or SES.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getPaxControls,
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
  sendEmail,
  sendOrgSMS,
  isConfigured,
  proposePendingAction,
  getLead,
  connectors,
} = vi.hoisted(() => ({
  getPaxControls: vi.fn(async () => ({
    stance: "ask_before_sending" as "ask_before_sending" | "ask_before_everything",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  })),
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
  // The connector rails behind send_gmail / send_slack_message /
  // create_stripe_payment_link — spies, so "never executed" is observed.
  connectors: {
    sendGmail: vi.fn(async () => ({ success: true, data: {} })),
    sendSlackMessage: vi.fn(async () => ({ success: true, data: {} })),
    createStripePaymentLink: vi.fn(async () => ({ success: true, data: {} })),
  },
}));

// The ONE reader, controllable per stance. The refusal formatter stays real.
vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls };
});
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));

vi.mock("../../server/services/autonomyGuardrails", () => ({
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
}));

// The kernel: APPROVAL_REQUIRED_TOOLS is the REAL set (a copy would make the
// superset ratchet below agree with any kernel); only the propose path is
// stubbed (no DB in this test). pendingActionArtifact mirrors the real shape.
vi.mock("../../server/services/approvalKernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/approvalKernel")>();
  return {
    ...actual,
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
  };
});

vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail, isConfigured },
}));
vi.mock("../../server/storage", () => ({
  storage: { getLead, logActivity: vi.fn(async () => undefined) },
  db: {},
}));
vi.mock("../../server/services/connectors/executor", () => connectors);
vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: vi.fn(() => ({ canEmail: true, canSms: true })),
  isWithinQuietHours: vi.fn(() => ({ blocked: false })),
  isWithinQuietHoursForLead: vi.fn(() => ({ blocked: false })),
}));
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

import { executeTool, APPROVAL_REQUIRED_TOOLS, toolDefinitions } from "../../server/ai/tools";
import { OFFERED_STANCES } from "../../shared/pax-controls";

const org = { id: 7, name: "Test Org" } as any;

const sendArgs = {
  lead_id: 42,
  subject: "Following up on your land",
  message: "Hi Stale, just checking in.",
};

const smsArgs = {
  lead_id: 42,
  message: "Hi Stale, just checking in about your land.",
};

/** Minimal args for every member of the real set (per-member vacuity below). */
const SEND_ARGS: Record<string, Record<string, unknown>> = {
  send_email: sendArgs,
  send_sms: smsArgs,
  send_gmail: { to: "seller@example.com", subject: "s", body: "b" },
  send_slack_message: { channel: "#deals", message: "m" },
  create_stripe_payment_link: { amount_cents: 5000, description: "d" },
};

function setStance(stance: "ask_before_sending" | "ask_before_everything") {
  getPaxControls.mockResolvedValue({
    stance,
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  });
}

/** Every rail a send could reach — all spies. */
const railCalls = () =>
  sendEmail.mock.calls.length +
  sendOrgSMS.mock.calls.length +
  connectors.sendGmail.mock.calls.length +
  connectors.sendSlackMessage.mock.calls.length +
  connectors.createStripePaymentLink.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  setStance("ask_before_sending");
  checkSendRateLimit.mockResolvedValue({ allowed: true });
  checkTcpaBeforeSend.mockResolvedValue({ allowed: true });
  isConfigured.mockResolvedValue(true);
  sendEmail.mockResolvedValue({ success: true, messageId: "msg_witnessed_1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── The superset ratchet ─────────────────────────────────────────────────────

/** What the kernel gated on 2026-06-10. The set may only grow from here. */
const APPROVAL_REQUIRED_BASELINE = [
  "send_email",
  "send_sms",
  "send_gmail",
  "send_slack_message",
  "create_stripe_payment_link",
] as const;

describe("APPROVAL_REQUIRED_TOOLS may only grow", () => {
  it("the REAL kernel set is a superset of the baseline", () => {
    for (const name of APPROVAL_REQUIRED_BASELINE) {
      expect(APPROVAL_REQUIRED_TOOLS.has(name), `${name} left APPROVAL_REQUIRED_TOOLS — a send became unwitnessed`).toBe(true);
    }
    expect(APPROVAL_REQUIRED_TOOLS.size).toBeGreaterThanOrEqual(APPROVAL_REQUIRED_BASELINE.length);
  });

  it("every member is a real tool, and every member has a fixture here (per-member vacuity)", () => {
    const known = new Set(Object.keys(toolDefinitions));
    for (const name of APPROVAL_REQUIRED_TOOLS) {
      expect(known.has(name), `${name} is approval-required but is not a tool`).toBe(true);
      expect(SEND_ARGS[name], `${name} joined APPROVAL_REQUIRED_TOOLS — add its args to SEND_ARGS so it is proven witnessed below`).toBeDefined();
    }
  });
});

// ── Every send, both stances, no tap → an ask, no rail ──────────────────────

describe.each([...OFFERED_STANCES])("at stance %s — a send never executes without a tap", (stance) => {
  it("vacuity: both offered stances are exercised", () => {
    expect(OFFERED_STANCES).toContain(stance);
    expect(OFFERED_STANCES.length).toBe(2);
  });

  it.each([...APPROVAL_REQUIRED_TOOLS])("%s proposes an ask and touches no rail", async (name) => {
    setStance(stance);
    const result = await executeTool(name, { ...SEND_ARGS[name] }, org);

    expect(result.success).toBe(true);
    expect((result.data as any)?.pendingApproval).toBe(true);
    expect((result.data as any)?.requiresApproval).toBe(true);
    expect(proposePendingAction).toHaveBeenCalledTimes(1);
    expect(proposePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 7, toolName: name, args: SEND_ARGS[name], origin: "chat" }),
    );
    // The invariant: NOTHING sent, no envelope consumed, no audit record.
    expect(railCalls()).toBe(0);
    expect(recordAutonomousSend).not.toHaveBeenCalled();
    expect(checkSendRateLimit).not.toHaveBeenCalled();
  });

  it("send_email carries the lead it is about on the ask (sourceRef) and no invented reason", async () => {
    setStance(stance);
    await executeTool("send_email", { ...sendArgs }, org, { userId: "u-1" });
    expect(proposePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByUserId: "u-1",
        sourceRef: { leadId: 42 },
        reason: null,
      }),
    );
  });

  it("ignores a model-supplied _approved:true arg — still proposes, never sends", async () => {
    setStance(stance);
    const result = await executeTool("send_email", { ...sendArgs, _approved: true }, org);
    expect((result.data as any)?.pendingApproval).toBe(true);
    // The stripped arg never reaches the frozen row.
    expect(proposePendingAction).toHaveBeenCalledWith(expect.objectContaining({ args: sendArgs }));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();

    const sms = await executeTool("send_sms", { ...smsArgs, _approved: true }, org);
    expect((sms.data as any)?.pendingApproval).toBe(true);
    expect(sendOrgSMS).not.toHaveBeenCalled();
  });
});

// ── The trusted replay runs the guarded envelope ────────────────────────────

describe("witnessed send — explicit human approval triggers the guarded send", () => {
  it("runs rate-limit + TCPA + send + record, in order, on trustedApproval (email)", async () => {
    const result = await executeTool("send_email", { ...sendArgs }, org, {
      trustedApproval: true,
      origin: "approval_replay",
    });

    expect(result.success).toBe(true);
    expect((result.data as any)?.messageId).toBe("msg_witnessed_1");
    expect(checkSendRateLimit).toHaveBeenCalledWith(7, "email");
    // (T0-5: TCPA lookup is org-scoped — orgId first, then leadId.)
    expect(checkTcpaBeforeSend).toHaveBeenCalledWith(7, 42);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(recordAutonomousSend).toHaveBeenCalledWith(7, "email", 42, expect.stringContaining("Following up on your land"));
    // The replay does not re-read the controls — a tap is the human acting.
    expect(getPaxControls).not.toHaveBeenCalled();
    expect(proposePendingAction).not.toHaveBeenCalled();

    const rateOrder = checkSendRateLimit.mock.invocationCallOrder[0];
    const tcpaOrder = checkTcpaBeforeSend.mock.invocationCallOrder[0];
    const sendOrder = sendEmail.mock.invocationCallOrder[0];
    const recordOrder = recordAutonomousSend.mock.invocationCallOrder[0];
    expect(rateOrder).toBeLessThan(sendOrder);
    expect(tcpaOrder).toBeLessThan(sendOrder);
    expect(sendOrder).toBeLessThan(recordOrder);
  });

  it("runs rate-limit + org-scoped TCPA + send + record on trustedApproval (sms)", async () => {
    const result = await executeTool("send_sms", { ...smsArgs }, org, { trustedApproval: true });

    expect(result.success).toBe(true);
    expect((result.data as any)?.messageId).toBe("sms_witnessed_1");
    expect(checkSendRateLimit).toHaveBeenCalledWith(7, "sms");
    expect(checkTcpaBeforeSend).toHaveBeenCalledWith(7, 42);
    expect(sendOrgSMS).toHaveBeenCalledWith(7, "+16175550142", smsArgs.message);
    expect(recordAutonomousSend).toHaveBeenCalledWith(7, "sms", 42, smsArgs.message);
  });

  it("blocks the approved send when the daily envelope is exhausted — with the post-tap line", async () => {
    checkSendRateLimit.mockResolvedValue({ allowed: false, reason: "Daily send limit reached (50/50 emails today)" });
    const result = await executeTool("send_email", { ...sendArgs }, org, { trustedApproval: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Daily send limit reached");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAutonomousSend).not.toHaveBeenCalled();
  });

  it("blocks the approved send when TCPA disallows the lead", async () => {
    checkTcpaBeforeSend.mockResolvedValue({ allowed: false, reason: "Lead is marked do-not-contact" });
    const result = await executeTool("send_email", { ...sendArgs }, org, { trustedApproval: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("do-not-contact");
    expect(sendEmail).not.toHaveBeenCalled();

    checkTcpaBeforeSend.mockResolvedValue({ allowed: false, reason: "No TCPA consent on record for this lead" });
    const sms = await executeTool("send_sms", { ...smsArgs }, org, { trustedApproval: true });
    expect(sms.success).toBe(false);
    expect(sms.error).toContain("No TCPA consent");
    expect(sendOrgSMS).not.toHaveBeenCalled();
  });
});
