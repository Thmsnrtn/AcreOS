/**
 * PF-11 Class-D cure (2026-11-28) — the pause contract for the two tools
 * whose pauseSafe flipped in this PR.
 *
 * `remember_fact` inserts a paxMemory row and `spawn_subagent` dispatches
 * a nested agent loop. Both sat on PAUSE_SAFE_TOOLS as looks_and_drafts —
 * remember_fact under a BOOKKEEPING exemption that the draft_offer
 * precedent (spec §3d: pause-safe must mean no storage mutation) condemns,
 * spawn_subagent as an "action/agent"-class tool misfiled as a draft.
 * The cure reclassifies both as changes_records / pauseSafe false, in
 * every registry at once (shared/pax-capabilities.ts, PAUSE_SAFE_TOOLS,
 * shared/pax-controls.ts, scripts/resolver-dispositions.json).
 *
 * This test pins the behavioural contract through the REAL executeTool:
 * while the org is paused both tools are REFUSED at the pause gate (and
 * their case bodies never run — the db insert / sub-agent dispatch mocks
 * must stay uncalled); while unpaused both execute.
 *
 * escalate_to_support is deliberately NOT here: by founder ruling
 * (2026-11-28) reaching a person must work while Pax is paused, so it
 * stays pause-safe and out of this cure's scope.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  controls: {
    stance: "ask_before_sending" as const,
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  },
  insertValues: vi.fn(async () => undefined),
  processChat: vi.fn(async () => ({ response: "sub-agent reply", conversationId: 42 })),
}));
vi.mock("../../server/services/paxControls", async (orig) => ({
  ...(await orig<typeof import("../../server/services/paxControls")>()),
  getPaxControls: vi.fn(async () => H.controls),
}));
vi.mock("../../server/db", () => ({
  db: { insert: vi.fn(() => ({ values: H.insertValues })) },
}));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/services/approvalKernel", () => ({
  APPROVAL_REQUIRED_TOOLS: new Set(["send_email", "send_sms"]),
  proposePendingAction: vi.fn(async (input: any) => ({ id: 91, status: "pending", ...input })),
  pendingActionArtifact: (row: any) => ({ pendingApproval: true, pendingActionId: row.id, toolName: row.toolName }),
}));
vi.mock("../../server/storage", () => ({ storage: { getLeads: vi.fn(async () => []) }, db: {} }));
vi.mock("../../server/services/paxAccountReads", () => ({}));
vi.mock("../../server/ai/supportAgent", () => ({ createSupportTicket: vi.fn(async () => ({ id: 1 })) }));
vi.mock("../../server/services/supportNotifications", () => ({ notifyFounderOfTicket: vi.fn(async () => undefined) }));
vi.mock("../../server/ai/executive", () => ({ processChat: H.processChat }));
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

import { executeTool, PAUSE_SAFE_TOOLS } from "../../server/ai/tools";
import { CAPABILITY_ROWS } from "../../shared/pax-capabilities";

const org = { id: 7, name: "Pax Land", ownerId: "owner_1", subscriptionTier: "pro" } as any;

const FLIPPED = ["remember_fact", "spawn_subagent"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  H.controls.paused = false;
});

describe("the reclassification is registered consistently", () => {
  it("neither tool is pause-safe anywhere, and both rows are write-class", () => {
    for (const t of FLIPPED) {
      expect(PAUSE_SAFE_TOOLS.has(t), `${t} still on PAUSE_SAFE_TOOLS`).toBe(false);
      const row = (CAPABILITY_ROWS as Record<string, any>)[t];
      expect(row, `${t} has no capability row`).toBeDefined();
      expect(row.pauseSafe, `${t} row still pauseSafe`).toBe(false);
      expect(row.group, `${t} row still looks_and_drafts`).toBe("changes_records");
    }
    // The founder-ruled exception is untouched by this cure.
    expect(PAUSE_SAFE_TOOLS.has("escalate_to_support")).toBe(true);
    expect((CAPABILITY_ROWS as Record<string, any>)["escalate_to_support"].pauseSafe).toBe(true);
  });
});

describe("while the org is paused, both tools are refused and never execute", () => {
  beforeEach(() => {
    H.controls.paused = true;
  });

  it("remember_fact is refused at the pause gate — no paxMemory insert", async () => {
    const result = await executeTool("remember_fact", { fact: "the seller prefers email" }, org, { userId: "user_1" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/paused/i);
    expect(H.insertValues).not.toHaveBeenCalled();
  });

  it("spawn_subagent is refused at the pause gate — no sub-agent dispatched", async () => {
    const result = await executeTool("spawn_subagent", { prompt: "research this parcel" }, org, { userId: "user_1" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/paused/i);
    expect(H.processChat).not.toHaveBeenCalled();
  });
});

describe("while the org is not paused, both tools work", () => {
  it("remember_fact writes the memory row", async () => {
    const result = await executeTool("remember_fact", { fact: "the seller prefers email" }, org, { userId: "user_1" });
    expect(result.success, `remember_fact refused while unpaused: ${result.error}`).toBe(true);
    expect(H.insertValues).toHaveBeenCalledTimes(1);
  });

  it("spawn_subagent dispatches the sub-agent", async () => {
    const result = await executeTool("spawn_subagent", { prompt: "research this parcel" }, org, { userId: "user_1" });
    expect(result.success, `spawn_subagent refused while unpaused: ${result.error}`).toBe(true);
    expect(H.processChat).toHaveBeenCalledTimes(1);
  });
});
