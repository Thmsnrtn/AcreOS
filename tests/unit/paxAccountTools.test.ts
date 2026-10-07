/**
 * The Stage 2 Pax tools, dispatched through the REAL `executeTool` (the switch
 * the customer chat calls — server/ai/executive.ts → executeTool), so each test
 * proves the tool is reachable, org-scoped and reports what it read.
 *
 *   get_credits · quote_outbound_cost · get_campaigns · get_inbox_replies ·
 *   get_team_activity · get_plan_limits · get_sending_identity_status ·
 *   get_product_facts · escalate_to_support · get_leads (county + score)
 *
 * And the approval card's amount: a send Pax drafts is frozen as an ask whose
 * artifact carries recipients + credits + dollars.
 *
 * POPULATION: NEW_TOOLS below must equal the tools added to toolDefinitions
 * this stage, each must be offered to the customer chat role ("executive"),
 * have intent metadata, and be on the pause-safe list (they read; escalation
 * reaches a person). A tool added without a dispatch test fails "every new
 * tool is exercised here".
 *
 * Mutations recorded (reverted after each red run):
 *   - get_leads projection without county/score → "get_leads carries county" red.
 *   - escalate_to_support without `escalateToHuman: true` → red.
 *   - kernel artifact without the cost line → "a drafted text is frozen…" red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
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
  proposePendingAction: vi.fn(async (input: any) => ({ id: 91, status: "pending", ...input })),
  getLeads: vi.fn(async () => [] as any[]),
  reads: {
    readCreditsForPax: vi.fn(async (orgId: number) => ({ orgId, balanceCredits: 20000 })),
    readCampaignsForPax: vi.fn(async (orgId: number) => ({ orgId, campaigns: [] })),
    readInboxRepliesForPax: vi.fn(async (orgId: number) => ({ orgId, emailReplies: [], textReplies: [] })),
    readTeamActivityForPax: vi.fn(async (orgId: number) => ({ orgId, activity: [] })),
    readPlanLimitsForPax: vi.fn(async (orgId: number) => ({ orgId, plan: "pro" })),
    readSendingIdentityForPax: vi.fn(async (orgId: number) => ({ orgId, sms: { ownTwilioConnected: false } })),
    countContactableLeadsForPax: vi.fn(async () => 0),
  },
  readSendRails: vi.fn(async () => ({ ownMailAccount: false, ownEmailAccount: false, emailCanSend: true, smsConnected: true })),
  createSupportTicket: vi.fn(async (_org: any, _u: string, subject: string) => ({ id: 555, status: "open", subject })),
  notifyFounderOfTicket: vi.fn(async () => undefined),
}));

vi.mock("../../server/services/paxControls", async (orig) => ({
  ...(await orig<typeof import("../../server/services/paxControls")>()),
  getPaxControls: H.getPaxControls,
}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/services/approvalKernel", () => ({
  APPROVAL_REQUIRED_TOOLS: new Set(["send_email", "send_sms"]),
  proposePendingAction: H.proposePendingAction,
  pendingActionArtifact: (row: any) => ({ pendingApproval: true, pendingActionId: row.id, toolName: row.toolName }),
}));
vi.mock("../../server/storage", () => ({ storage: { getLeads: H.getLeads }, db: {} }));
vi.mock("../../server/services/paxAccountReads", () => H.reads);
vi.mock("../../server/services/sendPricing", async (orig) => ({
  ...(await orig<typeof import("../../server/services/sendPricing")>()),
  readSendRails: H.readSendRails,
}));
vi.mock("../../server/ai/supportAgent", () => ({ createSupportTicket: H.createSupportTicket }));
vi.mock("../../server/services/supportNotifications", () => ({ notifyFounderOfTicket: H.notifyFounderOfTicket }));
vi.mock("../../server/utils/permissions", () => ({
  getPermissionsForRole: (r: string) => ({
    viewOnlyAssignedLeads: r === "va" || r === "viewer",
    canImportData: r === "owner" || r === "admin",
    canExportData: r === "owner" || r === "admin",
    canManageTeam: r === "owner" || r === "admin",
    canManageBilling: r === "owner",
    canAssignLeads: r === "owner" || r === "admin",
    canEditLeads: r !== "viewer",
  }),
  getRoleLabel: (r: string) => r,
}));
vi.mock("../../server/services/autonomyGuardrails", () => ({
  checkSendRateLimit: vi.fn(),
  checkTcpaBeforeSend: vi.fn(),
  recordAutonomousSend: vi.fn(),
}));
vi.mock("../../server/services/emailService", () => ({ emailService: {} }));
vi.mock("../../server/services/smsService", () => ({ smsService: {}, sendOrgSMS: vi.fn() }));
vi.mock("../../server/services/aiContextAggregator", () => ({
  getSystemContext: vi.fn(),
  formatContextForAI: vi.fn(),
  invalidateContextCache: vi.fn(),
}));
vi.mock("../../server/services/parcel", () => ({ lookupParcelByAPN: vi.fn() }));
vi.mock("../../server/services/aiOfferService", () => ({ generateOfferSuggestions: vi.fn(), generateOfferLetter: vi.fn() }));
vi.mock("../../server/services/comps", () => ({ getComparableProperties: vi.fn() }));
vi.mock("../../server/services/data-source-broker", () => ({ DataSourceBroker: class {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/ai/validators", () => ({ validateAtlasOutput: vi.fn(), AtlasOutputType: {} }));

import { executeTool, toolDefinitions, PAUSE_SAFE_TOOLS } from "../../server/ai/tools";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";
import { DIRECT_MAIL_COSTS, CAMPAIGN_SEND_PRICE_CREDITS } from "../../server/services/sendPricing";
import { CSV_IMPORT_MAX_ROWS_PER_FILE } from "@shared/product-limits";

const org = { id: 7, name: "Pax Land", ownerId: "owner_1", subscriptionTier: "pro" } as any;

const NEW_TOOLS = [
  "get_credits",
  "quote_outbound_cost",
  "get_campaigns",
  "get_inbox_replies",
  "get_team_activity",
  "get_plan_limits",
  "get_sending_identity_status",
  "get_product_facts",
  "escalate_to_support",
] as const;
const exercised = new Set<string>();
async function run(tool: string, args: Record<string, unknown> = {}, opts?: any) {
  exercised.add(tool);
  return executeTool(tool, args, org, opts);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe("population", () => {
  it("every new tool is defined, has intent metadata, and reads while paused", () => {
    for (const t of NEW_TOOLS) {
      expect((toolDefinitions as Record<string, unknown>)[t], `${t} missing from toolDefinitions`).toBeDefined();
      expect(INTENT_META[t], `${t} has no door/scope`).toBeDefined();
      expect(PAUSE_SAFE_TOOLS.has(t), `${t} should run while Pax is paused`).toBe(true);
    }
  });
});

describe("the account reads delegate to the org-pinned readers with the caller's org", () => {
  it.each([
    ["get_credits", "readCreditsForPax"],
    ["get_campaigns", "readCampaignsForPax"],
    ["get_inbox_replies", "readInboxRepliesForPax"],
    ["get_team_activity", "readTeamActivityForPax"],
    ["get_plan_limits", "readPlanLimitsForPax"],
    ["get_sending_identity_status", "readSendingIdentityForPax"],
  ] as const)("%s → %s(org.id)", async (tool, reader) => {
    const r: any = await run(tool);
    expect(r.success).toBe(true);
    expect(H.reads[reader]).toHaveBeenCalledTimes(1);
    expect((H.reads[reader].mock.calls[0] as unknown[])[0]).toBe(7);
    expect(r.data.orgId).toBe(7);
  });
});

describe("quote_outbound_cost reads the same prices the campaign send charges", () => {
  it("500 postcards = 500 × the 4x6 piece price, in credits and dollars", async () => {
    const r: any = await run("quote_outbound_cost", { channel: "postcard", recipients: 500 });
    expect(r.success).toBe(true);
    expect(r.data.unitCredits).toBe(DIRECT_MAIL_COSTS.postcard_4x6);
    expect(r.data.totalCredits).toBe(500 * DIRECT_MAIL_COSTS.postcard_4x6);
    expect(r.data.totalDollars).toBe(`$${((500 * DIRECT_MAIL_COSTS.postcard_4x6) / 100).toFixed(2)}`);
    expect(r.data.chargedTo).toBe("acreos_credits");
  });

  it("texts on the org's own Twilio number cost no AcreOS credits; without one they cannot send", async () => {
    const own: any = await run("quote_outbound_cost", { channel: "sms", recipients: 10 });
    expect(own.data).toMatchObject({ listPriceCredits: CAMPAIGN_SEND_PRICE_CREDITS.sms, unitCredits: 0, chargedTo: "your_own_account", blocked: false });
    H.readSendRails.mockResolvedValueOnce({ ownMailAccount: false, ownEmailAccount: false, emailCanSend: false, smsConnected: false });
    const none: any = await run("quote_outbound_cost", { channel: "sms", recipients: 10 });
    expect(none.data.blocked).toBe(true);
  });

  it("an unknown channel is refused, not priced", async () => {
    const r = await run("quote_outbound_cost", { channel: "fax", recipients: 1 });
    expect(r.success).toBe(false);
  });
});

describe("get_product_facts answers from the enforcing constants", () => {
  it("the import cap is the one the import routes enforce, and va sees only assigned leads", async () => {
    const r: any = await run("get_product_facts", { topic: "all" });
    expect(r.data.imports.rowsPerFile).toBe(CSV_IMPORT_MAX_ROWS_PER_FILE);
    const va = r.data.team.roles.find((x: any) => x.role === "va");
    expect(va.seesOnlyAssignedLeads).toBe(true);
    expect(r.data.sending.textsPlanRequirement).toEqual(["pro", "scale"]);
  });
});

describe("escalate_to_support files a real ticket, already escalated", () => {
  it("uses the Help chat's createSupportTicket with escalateToHuman, and names the ticket", async () => {
    const r: any = await run("escalate_to_support", { subject: "Export all my data", details: "Customer wants a full export" }, { userId: "user_9" });
    expect(r.success).toBe(true);
    expect(H.createSupportTicket).toHaveBeenCalledTimes(1);
    const [o, uid, subject, details, opts] = H.createSupportTicket.mock.calls[0] as any[];
    expect(o.id).toBe(7);
    expect(uid).toBe("user_9");
    expect(subject).toBe("Export all my data");
    expect(details).toContain("full export");
    expect(opts).toMatchObject({ escalateToHuman: true });
    expect(H.notifyFounderOfTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 555, reason: "escalated" }));
    expect(r.data.ticketId).toBe(555);
  });

  it("refuses without a subject — nothing is filed and nothing is claimed", async () => {
    const r = await run("escalate_to_support", { subject: "", details: "x" });
    expect(r.success).toBe(false);
    expect(H.createSupportTicket).not.toHaveBeenCalled();
  });
});

describe("get_leads carries county, score and the contact flags, and filters by county", () => {
  it("get_leads carries county / score / doNotContact and the county filter ignores case and 'County'", async () => {
    H.getLeads.mockResolvedValue([
      { id: 1, firstName: "A", lastName: "One", county: "Cochise", state: "AZ", score: 80, nurturingStage: "hot", doNotContact: false, tcpaConsent: true, status: "new", type: "seller" },
      { id: 2, firstName: "B", lastName: "Two", county: "Pima", state: "AZ", score: 20, nurturingStage: "cold", doNotContact: true, tcpaConsent: false, status: "new", type: "seller" },
    ]);
    const all: any = await executeTool("get_leads", {}, org);
    expect(all.data[0]).toMatchObject({ county: "Cochise", score: 80, doNotContact: false, tcpaConsent: true });
    expect(all.data[1]).toMatchObject({ county: "Pima", score: 20, doNotContact: true });
    const cochise: any = await executeTool("get_leads", { county: "cochise county" }, org);
    expect(cochise.data.map((l: any) => l.id)).toEqual([1]);
  });
});

describe("a send Pax drafts is frozen with its amount and reach", () => {
  it("a drafted text is frozen as an ask whose artifact shows 1 recipient, 0 credits, $0.00", async () => {
    const r: any = await executeTool("send_sms", { lead_id: 12, message: "Hi" }, org, { userId: "user_9" });
    expect(H.proposePendingAction).toHaveBeenCalledTimes(1);
    expect(r.success).toBe(true);
    expect(r.data.pendingApproval).toBe(true);
    expect(r.data.cost).toMatchObject({ recipients: 1, credits: 0, dollars: "$0.00" });
  });
});

describe("vacuity", () => {
  it("every new tool is exercised here", () => {
    for (const t of NEW_TOOLS) expect(exercised.has(t), `${t} has no dispatch test`).toBe(true);
  });
});
