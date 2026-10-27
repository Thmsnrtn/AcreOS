/**
 * P0 (D2e census, 2026-10-25): Pax's get_lead_details must never put a lead's
 * registered secret columns — leads.taxId (ciphertext) and leads.taxIdType —
 * into the model's context. The tool result is serialized to the model
 * provider by serializeToolResultForModel with no response guard on that
 * path, so the tool itself projects the row through omitSecretColumns.
 *
 * This runs the REAL executeTool and the REAL model serializer over a lead row
 * that carries both columns, and asserts neither the keys nor the ciphertext
 * value reach the string the provider would receive.
 *
 * Mock scaffold copied from tests/unit/tenantBoundaryTaskTools.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getPaxControls,
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
  getPaxControls: vi.fn(async () => ({
    stance: "ask_before_sending" as const,
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  })),
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

// The ONE reader of the org's Pax controls (pause folded in) — unpaused, at
// the default stance, so the org-scope prechecks are what run here.
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
vi.mock("../../server/services/tcpaCompliance", async (importOriginal) => ({
  ...(await importOriginal<object>()),
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
import { serializeToolResultForModel } from "../../server/ai/untrustedEnvelope";

const org = { id: 7, name: "Org A" } as any;

beforeEach(() => {
  vi.clearAllMocks();
  getPaxControls.mockResolvedValue({
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  });
});
afterEach(() => vi.clearAllMocks());

const CIPHERTEXT = "v1:SYNTHETIC-CIPHERTEXT-9f3a1c";
const leadRow = {
  id: 42,
  organizationId: 7,
  firstName: "Jane",
  lastName: "Owner",
  email: "jane@example.com",
  phone: "5125550100",
  address: "1 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  status: "new",
  doNotContact: false,
  tcpaConsent: false,
  taxId: CIPHERTEXT,
  taxIdType: "ssn",
};

describe("get_lead_details keeps the lead's secret columns out of the model's context", () => {
  it("the tool result carries neither taxId nor taxIdType, and the serialized model payload never contains the ciphertext", async () => {
    getLead.mockResolvedValue({ ...leadRow });
    const result = await executeTool("get_lead_details", { lead_id: 42 }, org);

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(getLead).toHaveBeenCalledWith(7, 42);
    expect(result.data).not.toHaveProperty("taxId");
    expect(result.data).not.toHaveProperty("taxIdType");
    // The ordinary lead fields still reach Pax.
    expect(result.data).toMatchObject({ id: 42, firstName: "Jane", email: "jane@example.com", name: "Jane Owner" });

    const toModel = serializeToolResultForModel("get_lead_details", result);
    expect(toModel).not.toContain(CIPHERTEXT);
    expect(toModel).not.toMatch(/"taxId"/);
    expect(toModel).not.toMatch(/"taxIdType"/);
    expect(toModel).toContain("Jane");
  });
});
