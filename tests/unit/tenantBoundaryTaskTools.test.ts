/**
 * Tenant boundary — Pax update_task / complete_task org scope (audit F-23-3).
 *
 * The finding this closes: server/ai/tools.ts update_task/complete_task called
 * storage.updateTask(args.task_id, ...) with NO org arg and NO getTask
 * precheck, while every sibling tool (update_lead_status, update_property)
 * fetch-verifies against org.id first. Task ids are sequential integers, so a
 * prompt-injected doc or a user in org A could read+mutate any org's task.
 *
 * This suite proves the precheck now holds:
 *   1. update_task on a task NOT in the caller's org (getTask → undefined) is
 *      refused; storage.updateTask is never called (no cross-org write).
 *   2. update_task on the caller's own task succeeds and passes org.id through.
 *   3. complete_task has the identical guard.
 *
 * Mock scaffold mirrors tests/unit/paxPauseToolGate.test.ts so the executeTool
 * module graph stays light (no DB, no SES).
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
  getTask,
  updateTask,
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
  sendEmail: vi.fn(async () => ({ success: true, messageId: "msg_1" })),
  isConfigured: vi.fn(async () => true),
  proposePendingAction: vi.fn(async (input: any) => ({ id: 1, ...input })),
  getTask: vi.fn(async () => undefined as any),
  updateTask: vi.fn(async (id: number, updates: any) => ({ id, ...updates })),
  getLead: vi.fn(async () => undefined as any),
  updateLead: vi.fn(async () => ({ id: 42 })),
  createLead: vi.fn(async (input: any) => ({ id: 43, ...input })),
  logActivity: vi.fn(async () => undefined),
}));

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
  APPROVAL_REQUIRED_TOOLS: new Set(["send_email", "send_sms"]),
  proposePendingAction,
  pendingActionArtifact: (row: any) => ({ pendingApproval: true, pendingActionId: row.id }),
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail, isConfigured },
}));
vi.mock("../../server/storage", () => ({
  storage: { getTask, updateTask, getLead, updateLead, createLead, logActivity },
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
vi.mock("../../server/services/smsService", () => ({ smsService: {}, sendOrgSMS: vi.fn() }));
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

const org = { id: 7, name: "Org A" } as any;

beforeEach(() => {
  vi.clearAllMocks();
  getPaxPauseState.mockResolvedValue({ paused: false, pausedUntil: null, checkFailed: false });
  getOrgAutonomyLevel.mockResolvedValue("assisted" as const);
});
afterEach(() => vi.clearAllMocks());

describe("update_task / complete_task enforce org scope (F-23-3)", () => {
  it("refuses update_task for a task not in the caller's org; no write happens", async () => {
    getTask.mockResolvedValue(undefined); // cross-org: not found in org 7
    const result = await executeTool("update_task", { task_id: 50123, status: "completed" }, org);

    expect(result.success).toBe(false);
    expect(getTask).toHaveBeenCalledWith(7, 50123);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("allows update_task for the caller's own task and scopes the write to org.id", async () => {
    getTask.mockResolvedValue({ id: 99, organizationId: 7, title: "mine" });
    const result = await executeTool("update_task", { task_id: 99, status: "in_progress" }, org);

    expect(result.success).toBe(true);
    expect(getTask).toHaveBeenCalledWith(7, 99);
    // org.id (7) is passed as the 3rd arg so the repo applies the org predicate
    expect(updateTask).toHaveBeenCalledWith(99, expect.objectContaining({ status: "in_progress" }), 7);
  });

  it("refuses complete_task for a cross-org task; no write happens", async () => {
    getTask.mockResolvedValue(undefined);
    const result = await executeTool("complete_task", { task_id: 50124 }, org);

    expect(result.success).toBe(false);
    expect(getTask).toHaveBeenCalledWith(7, 50124);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("allows complete_task for the caller's own task, scoped to org.id", async () => {
    getTask.mockResolvedValue({ id: 88, organizationId: 7, title: "mine" });
    const result = await executeTool("complete_task", { task_id: 88 }, org);

    expect(result.success).toBe(true);
    expect(updateTask).toHaveBeenCalledWith(88, { status: "completed" }, 7);
  });
});
