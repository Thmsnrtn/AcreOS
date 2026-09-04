/**
 * The stance is READ by both dispatch switches (AUTONOMY_SPEC.md §4.3, §7).
 *
 * Wave 0 stored `organizations.pax_controls.stance` and made it readable
 * through the ONE reader (getPaxControls); until this file's subjects landed
 * nothing consumed it — a canonical value with zero production callers
 * (CLAUDE.md, second law). This pins that both model-driven dispatch
 * switches consult it, with the identical predicate:
 *
 *     requiresAsk = <always-ask set>.has(tool)
 *                || (controls.stance === "ask_before_everything" && !pauseSafe)
 *
 * TOOL_SWITCHES enumerates the population (CLAUDE.md, third law — the
 * support switch was the blind spot of two earlier gates). For EACH switch:
 *   - a record write at "ask_before_everything" returns a pending artifact
 *     and its write mock is never called;
 *   - the same write at "ask_before_sending" executes;
 *   - the always-ask member (a send / a billing fix) freezes at BOTH stances;
 *   - a failed controls read refuses with "could not verify" and mints NO
 *     ask row;
 *   - while paused, the record write is refused with the glossary line and
 *     the always-ask member still freezes (asks accumulate while paused);
 *   - the human-approved replay reads no controls and runs.
 * Plus, support only: apply_credit refuses at both stances, touching nothing.
 *
 * Probes that must turn this red: delete the stance read in either switch;
 * move apply_billing_fix out of ALWAYS_ASK_SUPPORT_TOOLS.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const H = vi.hoisted(() => ({
  getPaxControls: vi.fn(async () => ({
    stance: "ask_before_sending" as "ask_before_sending" | "ask_before_everything",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null as { userId: string; name: string } | null,
    checkFailed: false,
    timezone: "America/Chicago",
  })),
  proposePendingAction: vi.fn(async (input: any) => ({
    id: 501,
    organizationId: input.organizationId,
    toolName: input.toolName,
    args: input.args,
    contentHash: "h",
    status: "pending",
    expiresAt: new Date(Date.now() + 3600_000),
    createdByUserId: input.createdByUserId ?? null,
  })),
  // tools.ts rails
  getLead: vi.fn(async () => ({ id: 42, email: "l@example.com", phone: "+16175550142", status: "new", tcpaConsent: true, doNotContact: false })),
  updateLead: vi.fn(async () => ({ id: 42, status: "qualified" })),
  sendEmail: vi.fn(async () => ({ success: true, messageId: "m1" })),
  logActivity: vi.fn(async () => undefined),
  // supportAgent.ts rails
  autoResolveAlert: vi.fn(async () => true),
  stripeInvoicesPay: vi.fn(async () => ({ id: "in_1", status: "paid" })),
  stripeCustomersUpdate: vi.fn(async () => ({})),
  recordPaxEffect: vi.fn(async () => ({ written: true })),
}));

// ── shared ──
vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: H.getPaxControls };
});
// The ticket-ownership probe added on 2026-09-04 reads
// `support_tickets.organization_id` for the ticketId a call carries and REFUSES
// when it finds nothing — a tool must not act on a ticket that does not exist
// or belongs to another tenant. The rows below say "ticket 12 is org 7's", so
// the calls in this file get past that probe and go on testing the stance,
// which is what they are about.
vi.mock("../../server/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ organizationId: 7 }] }) }) }), insert: () => ({ values: async () => undefined }) } }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/services/approvalKernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/approvalKernel")>();
  return { ...actual, proposePendingAction: H.proposePendingAction };
});
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: H.recordPaxEffect }));
vi.mock("../../server/storage", () => ({
  storage: { getLead: H.getLead, updateLead: H.updateLead, logActivity: H.logActivity },
  db: {},
}));
// The permission ladder: an IDENTIFIED caller is held to the intent's scope
// (paxToolScopeAndFcra.test.ts proves that gate); here the human holds it.
vi.mock("../../server/middleware/roleScope", () => ({ userHasScope: vi.fn(async () => true) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── tools.ts graph ──
vi.mock("../../server/services/autonomyGuardrails", () => ({
  checkSendRateLimit: vi.fn(async () => ({ allowed: true })),
  checkTcpaBeforeSend: vi.fn(async () => ({ allowed: true })),
  recordAutonomousSend: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: H.sendEmail, isConfigured: vi.fn(async () => true) },
}));
vi.mock("../../server/services/smsService", () => ({ smsService: {}, sendOrgSMS: vi.fn() }));
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
vi.mock("../../server/services/aiOfferService", () => ({ generateOfferSuggestions: vi.fn(), generateOfferLetter: vi.fn() }));
vi.mock("../../server/services/comps", () => ({ getComparableProperties: vi.fn() }));
vi.mock("../../server/services/data-source-broker", () => ({ DataSourceBroker: class {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/leadEvents", () => ({ emitLeadCreated: vi.fn(), emitLeadUpdated: vi.fn() }));
vi.mock("../../server/ai/validators", () => ({ validateAtlasOutput: vi.fn(), AtlasOutputType: {} }));

// ── supportAgent.ts graph ──
vi.mock("openai", () => ({ default: class {} }));
vi.mock("stripe", () => ({
  default: class {
    invoices = { pay: H.stripeInvoicesPay, voidInvoice: vi.fn() };
    customers = { update: H.stripeCustomersUpdate };
    billingPortal = { sessions: { create: vi.fn(async () => ({ url: "https://billing" })) } };
  },
}));
vi.mock("../../server/stripeClient", () => ({ subscriptionPeriodIso: vi.fn(), STRIPE_API_VERSION: "2024-06-20" }));
vi.mock("../../server/services/decisionsInbox", () => ({ decisionsInboxService: {} }));
vi.mock("../../server/services/data-source-broker.js", () => ({ dataSourceBroker: {} }));
vi.mock("../../server/services/propertyEnrichment.js", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/complianceValidator", () => ({ validateCompliance: vi.fn() }));
vi.mock("../../server/services/aiSpendGuard", () => ({ assertAiSpendAllowed: vi.fn(), recordExternalAiSpend: vi.fn() }));
vi.mock("../../server/services/proactiveMonitor", () => ({ proactiveMonitor: { autoResolveAlert: H.autoResolveAlert } }));

import { executeTool } from "../../server/ai/tools";
import { executeSupportTool } from "../../server/ai/supportAgent";
import { ALWAYS_ASK_SUPPORT_TOOLS } from "../../shared/pax-controls";
import { PAX_PAUSE_COPY, formatPaxTime } from "../../shared/pax-glossary";

const org = { id: 7, name: "Test Org", ownerId: "u-owner", stripeCustomerId: "cus_1" } as any;
const TZ = "America/Chicago";
type Stance = "ask_before_sending" | "ask_before_everything";

function setControls(over: Partial<Awaited<ReturnType<typeof H.getPaxControls>>> = {}) {
  H.getPaxControls.mockResolvedValue({
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    timezone: TZ,
    ...over,
  });
}

interface SwitchUnderTest {
  file: string;
  fn: string;
  origin: "chat" | "support";
  run: (name: string, args: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ success: boolean; data?: any; error?: string }>;
  /** A record write that the stance decides. */
  recordWrite: { tool: string; args: Record<string, unknown>; rail: ReturnType<typeof vi.fn> };
  /** A member of the always-ask set for this switch. */
  alwaysAsk: { tool: string; args: Record<string, unknown>; rail: ReturnType<typeof vi.fn> };
}

/** The population: every dispatch switch a model drives. */
const TOOL_SWITCHES: SwitchUnderTest[] = [
  {
    file: "server/ai/tools.ts",
    fn: "executeTool",
    origin: "chat",
    run: (name, args, options) => executeTool(name, args, org, options as any),
    recordWrite: { tool: "update_lead_status", args: { lead_id: 42, status: "qualified" }, rail: H.updateLead },
    alwaysAsk: { tool: "send_email", args: { lead_id: 42, subject: "s", message: "m" }, rail: H.sendEmail },
  },
  {
    file: "server/ai/supportAgent.ts",
    fn: "executeSupportTool",
    origin: "support",
    run: (name, args, options) => executeSupportTool(name, args, org, 12, options as any),
    recordWrite: { tool: "resolve_alert", args: { alert_id: 5, resolution_details: "fixed" }, rail: H.autoResolveAlert },
    alwaysAsk: { tool: "apply_billing_fix", args: { fix_type: "retry_payment", invoice_id: "in_1", reason: "card updated" }, rail: H.stripeInvoicesPay },
  },
];

const ROOT = path.resolve(__dirname, "../..");

beforeEach(() => {
  vi.clearAllMocks();
  setControls();
});

describe("the population", () => {
  it("vacuity: both switches exist in source and carry the stance predicate", () => {
    expect(TOOL_SWITCHES).toHaveLength(2);
    for (const s of TOOL_SWITCHES) {
      const src = fs.readFileSync(path.join(ROOT, s.file), "utf8");
      const fnAt = src.indexOf(`export async function ${s.fn}(`);
      expect(fnAt, `${s.fn} missing from ${s.file}`).toBeGreaterThan(-1);
      const switchAt = src.indexOf("switch (toolName)", fnAt);
      const readAt = src.indexOf("await getPaxControls(org.id)", fnAt);
      const predicateAt = src.indexOf('controls?.stance === "ask_before_everything" && !pauseSafe', fnAt);
      expect(readAt, `${s.file}: no controls read inside ${s.fn}`).toBeGreaterThan(fnAt);
      expect(readAt).toBeLessThan(switchAt);
      expect(predicateAt, `${s.file}: the stance predicate is not in ${s.fn}`).toBeGreaterThan(readAt);
      expect(predicateAt).toBeLessThan(switchAt);
    }
  });

  it("the support always-ask member is in ALWAYS_ASK_SUPPORT_TOOLS (the frozen registry)", () => {
    expect(ALWAYS_ASK_SUPPORT_TOOLS.has("apply_billing_fix")).toBe(true);
    expect(ALWAYS_ASK_SUPPORT_TOOLS.size).toBeGreaterThanOrEqual(5);
  });
});

describe.each(TOOL_SWITCHES)("$fn reads the stance", (sw) => {
  it("ask_before_everything: the record write returns a pending artifact and its rail is never called", async () => {
    setControls({ stance: "ask_before_everything" });
    const result = await sw.run(sw.recordWrite.tool, sw.recordWrite.args, { userId: "u-1" });
    expect(result.success).toBe(true);
    expect(result.data?.pendingApproval).toBe(true);
    expect(result.data?.pendingActionId).toBe(501);
    expect(sw.recordWrite.rail).not.toHaveBeenCalled();
    expect(H.getPaxControls).toHaveBeenCalledTimes(1);
    expect(H.getPaxControls).toHaveBeenCalledWith(7);
    expect(H.proposePendingAction).toHaveBeenCalledTimes(1);
    expect(H.proposePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 7, toolName: sw.recordWrite.tool, createdByUserId: "u-1", origin: sw.origin }),
    );
  });

  it("ask_before_sending: the same record write executes, and no ask is minted", async () => {
    setControls({ stance: "ask_before_sending" });
    const result = await sw.run(sw.recordWrite.tool, sw.recordWrite.args, { userId: "u-1" });
    expect(result.success).toBe(true);
    expect(result.data?.pendingApproval).toBeUndefined();
    expect(sw.recordWrite.rail).toHaveBeenCalledTimes(1);
    expect(H.proposePendingAction).not.toHaveBeenCalled();
  });

  it.each<Stance>(["ask_before_sending", "ask_before_everything"])(
    "%s: the always-ask member freezes and its rail is never called",
    async (stance) => {
      setControls({ stance });
      const result = await sw.run(sw.alwaysAsk.tool, sw.alwaysAsk.args, { userId: "u-1" });
      expect(result.success).toBe(true);
      expect(result.data?.pendingApproval).toBe(true);
      expect(sw.alwaysAsk.rail).not.toHaveBeenCalled();
      expect(H.proposePendingAction).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: sw.alwaysAsk.tool, origin: sw.origin }),
      );
    },
  );

  it("a failed controls read refuses with 'could not verify' and mints NO ask row — for the write AND the always-ask member", async () => {
    setControls({ stance: "ask_before_everything", paused: true, checkFailed: true });
    const write = await sw.run(sw.recordWrite.tool, sw.recordWrite.args);
    expect(write.success).toBe(false);
    expect(write.error).toBe(PAX_PAUSE_COPY.checkFailedRefusal);
    const ask = await sw.run(sw.alwaysAsk.tool, sw.alwaysAsk.args);
    expect(ask.success).toBe(false);
    expect(ask.error).toBe(PAX_PAUSE_COPY.checkFailedRefusal);
    expect(sw.recordWrite.rail).not.toHaveBeenCalled();
    expect(sw.alwaysAsk.rail).not.toHaveBeenCalled();
    expect(H.proposePendingAction).not.toHaveBeenCalled();
  });

  it("paused: the record write is refused with the glossary line; the always-ask member still freezes", async () => {
    const until = new Date(Date.now() + 3600_000);
    setControls({ paused: true, pausedUntil: until, pausedBy: { userId: "u-m", name: "Maria" } });
    const write = await sw.run(sw.recordWrite.tool, sw.recordWrite.args);
    expect(write.success).toBe(false);
    expect(write.error).toContain(`Pax is paused until ${formatPaxTime(until, TZ)}`);
    expect(write.error).toContain("paused by Maria");
    expect(sw.recordWrite.rail).not.toHaveBeenCalled();
    const ask = await sw.run(sw.alwaysAsk.tool, sw.alwaysAsk.args);
    expect(ask.data?.pendingApproval).toBe(true);
    expect(sw.alwaysAsk.rail).not.toHaveBeenCalled();
  });

  it("the trusted replay reads no controls and runs the always-ask member", async () => {
    setControls({ stance: "ask_before_everything" });
    const result = await sw.run(sw.alwaysAsk.tool, sw.alwaysAsk.args, {
      trustedApproval: true,
      origin: "approval_replay",
      userId: "u-1",
    });
    expect(result.success).toBe(true);
    expect(result.data?.pendingApproval).toBeUndefined();
    expect(sw.alwaysAsk.rail).toHaveBeenCalledTimes(1);
    expect(H.getPaxControls).not.toHaveBeenCalled();
    expect(H.proposePendingAction).not.toHaveBeenCalled();
  });
});

describe("executeSupportTool: apply_credit is model-unreachable at every stance", () => {
  it.each<Stance>(["ask_before_sending", "ask_before_everything"])("%s: refuses, touches nothing, asks nothing", async (stance) => {
    setControls({ stance });
    const result = await executeSupportTool(
      "apply_billing_fix",
      { fix_type: "apply_credit", amount_cents: 500, reason: "goodwill" },
      org,
      12,
      { origin: "support", userId: "u-1" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("a person will review this");
    expect(H.stripeCustomersUpdate).not.toHaveBeenCalled();
    expect(H.stripeInvoicesPay).not.toHaveBeenCalled();
    expect(H.proposePendingAction).not.toHaveBeenCalled();
    // Before ANY gate — the controls are not even consulted.
    expect(H.getPaxControls).not.toHaveBeenCalled();
  });
});
