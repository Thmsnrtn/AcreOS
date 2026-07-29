/**
 * Pax pause kill switch — the executeTool chokepoint gate (server/ai/tools.ts).
 *
 * The finding this closes: /settings/pax wrote pax.pausedUntil but NO executor
 * read it — "Pause all Pax automation" paused nothing. This suite proves the
 * chokepoint now makes the switch real:
 *
 *   1. While the org is paused, a SIDE-EFFECTING tool call (anything not on
 *      PAUSE_SAFE_TOOLS) is refused with the honest user-visible message and
 *      executes NOTHING.
 *   2. Read-only tools still run while paused (drafting/looking-up isn't
 *      automation acting).
 *   3. An unpaused org's side-effecting call succeeds as before.
 *   4. trustedApproval (a human explicitly tapping "Send") bypasses the pause
 *      gate — a human acting is not Pax automation.
 *   5. A failed pause read FAILS CLOSED: the side-effecting call is refused
 *      with the "could not verify" message.
 *   6. Allowlist hygiene: every PAUSE_SAFE_TOOLS entry names a real tool, and
 *      every known send/trigger/write tool is NOT on it.
 *
 * Mock scaffold mirrors tests/unit/paxWitnessedSend.test.ts so the module
 * graph stays light (no DB, no SES).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getPaxPauseState,
  getOrgAutonomyLevel,
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
  sendEmail,
  isConfigured,
  proposePendingAction,
  getLead,
  updateLead,
  createLead,
  logActivity,
} = vi.hoisted(() => ({
  getPaxPauseState: vi.fn(async () => ({
    paused: false,
    pausedUntil: null as Date | null,
    checkFailed: false,
  })),
  getOrgAutonomyLevel: vi.fn(async () => "assisted" as const),
  checkSendRateLimit: vi.fn(async () => ({ allowed: true })),
  checkTcpaBeforeSend: vi.fn(async () => ({ allowed: true })),
  recordAutonomousSend: vi.fn(async () => undefined),
  sendEmail: vi.fn(async () => ({ success: true, messageId: "msg_pause_1" })),
  isConfigured: vi.fn(async () => true),
  proposePendingAction: vi.fn(async (input: any) => ({
    id: 9002,
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
    email: "lead@example.com",
    phone: "+16175550142",
    firstName: "Test",
    lastName: "Lead",
    status: "new",
    tcpaConsent: true,
    doNotContact: false,
  })),
  updateLead: vi.fn(async () => ({ id: 42, status: "qualified" })),
  createLead: vi.fn(async (input: any) => ({ id: 43, ...input })),
  logActivity: vi.fn(async () => undefined),
}));

// The gate under test — controllable pause state.
vi.mock("../../server/services/paxPause", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/paxPause")
  >("../../server/services/paxPause");
  return { ...actual, getPaxPauseState };
});

vi.mock("../../server/services/autonomyGuardrails", () => ({
  getOrgAutonomyLevel,
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
}));
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
    args: row.args,
  }),
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail, isConfigured },
}));
vi.mock("../../server/storage", () => ({
  storage: { getLead, updateLead, createLead, logActivity },
  db: {},
}));
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

import { executeTool, PAUSE_SAFE_TOOLS, toolDefinitions } from "../../server/ai/tools";

const org = { id: 7, name: "Test Org" } as any;
const PAUSED_UNTIL = new Date(Date.now() + 24 * 60 * 60 * 1000);

function setPaused() {
  getPaxPauseState.mockResolvedValue({
    paused: true,
    pausedUntil: PAUSED_UNTIL,
    checkFailed: false,
  });
}

function setUnpaused() {
  getPaxPauseState.mockResolvedValue({
    paused: false,
    pausedUntil: null,
    checkFailed: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setUnpaused();
  getOrgAutonomyLevel.mockResolvedValue("assisted" as const);
  isConfigured.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("paused org — side-effecting tool calls are refused, honestly", () => {
  it("refuses update_lead_status with the pause message; nothing executes", async () => {
    setPaused();
    const result = await executeTool(
      "update_lead_status",
      { lead_id: 42, status: "qualified" },
      org,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Pax is paused until");
    expect(result.error).toContain(PAUSED_UNTIL.toISOString());
    expect(result.error).toContain("Settings");
    expect(updateLead).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("refuses create_lead too — record writes are acting, not drafting", async () => {
    setPaused();
    const result = await executeTool(
      "create_lead",
      { first_name: "New", last_name: "Lead" },
      org,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Pax is paused until");
    expect(createLead).not.toHaveBeenCalled();
  });

  it("still allows READ-ONLY tools while paused (lookups aren't automation acting)", async () => {
    setPaused();
    getLead.mockResolvedValue({
      id: 42,
      email: "lead@example.com",
      phone: "+16175550142",
      firstName: "Test",
      lastName: "Lead",
      status: "new",
      tcpaConsent: true,
      doNotContact: false,
    });
    const result = await executeTool("get_lead_details", { lead_id: 42 }, org);
    expect(result.success).toBe(true);
    expect((result.data as any)?.id).toBe(42);
    // The pause gate is not even consulted for pause-safe tools.
    expect(getPaxPauseState).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when the pause read failed — refuses with the honest 'could not verify' message", async () => {
    getPaxPauseState.mockResolvedValue({
      paused: true,
      pausedUntil: null,
      checkFailed: true,
    });
    const result = await executeTool(
      "update_lead_status",
      { lead_id: 42, status: "qualified" },
      org,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("could not verify");
    expect(result.error).toContain("not executed");
    expect(updateLead).not.toHaveBeenCalled();
  });

  it("an unapproved send while paused is frozen as an ask (kernel), never sent", async () => {
    setPaused();
    const result = await executeTool(
      "send_email",
      { lead_id: 42, subject: "s", message: "m" },
      org,
    );
    expect(result.success).toBe(true);
    expect((result.data as any)?.pendingApproval).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("trustedApproval bypasses the pause gate — a human tapping Send is the human acting", async () => {
    setPaused();
    const result = await executeTool(
      "send_email",
      { lead_id: 42, subject: "s", message: "m" },
      org,
      { trustedApproval: true },
    );
    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // The pause state was never consulted on the human-approved path.
    expect(getPaxPauseState).not.toHaveBeenCalled();
  });
});

describe("unpaused org — side-effecting tool calls run as before", () => {
  it("update_lead_status executes when not paused", async () => {
    setUnpaused();
    const result = await executeTool(
      "update_lead_status",
      { lead_id: 42, status: "qualified" },
      org,
    );
    expect(result.success).toBe(true);
    expect(updateLead).toHaveBeenCalledTimes(1);
    // The gate DID check (this is what makes the switch real).
    expect(getPaxPauseState).toHaveBeenCalledWith(7);
  });

  it("an expired pause behaves exactly like no pause (implicit expiry)", async () => {
    // getPaxPauseState already reports paused:false for past timestamps —
    // simulate its contract for an expired pause.
    getPaxPauseState.mockResolvedValue({
      paused: false,
      pausedUntil: null,
      checkFailed: false,
    });
    const result = await executeTool(
      "create_lead",
      { first_name: "A", last_name: "B" },
      org,
    );
    expect(result.success).toBe(true);
    expect(createLead).toHaveBeenCalledTimes(1);
  });
});

describe("PAUSE_SAFE_TOOLS allowlist hygiene", () => {
  it("every allowlisted name is a real tool (no typos silently allowing nothing)", () => {
    const known = new Set(Object.keys(toolDefinitions));
    for (const name of PAUSE_SAFE_TOOLS) {
      expect(known.has(name), `PAUSE_SAFE_TOOLS entry "${name}" must exist in toolDefinitions`).toBe(true);
    }
  });

  it("sends, external triggers, and record writes are NOT pause-safe", () => {
    for (const name of [
      "send_email",
      "send_sms",
      "send_gmail",
      "send_slack_message",
      "create_stripe_payment_link",
      "create_calendar_event",
      "trigger_zapier",
      "trigger_make",
      "schedule_background_job",
      "create_lead",
      "update_lead_status",
      "create_property",
      "update_property",
      "create_properties_batch",
      "create_deal",
      "update_deal",
      "create_task",
      "update_task",
      "complete_task",
      "schedule_followup",
      "schedule_follow_up",
      "generate_offer_letter", // upserts a pipeline deal — a record write
    ]) {
      expect(PAUSE_SAFE_TOOLS.has(name), `"${name}" must NOT be pause-safe`).toBe(false);
    }
  });
});
