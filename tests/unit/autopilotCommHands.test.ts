import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for the underlying services (the hands are thin adapters over them) ──
vi.mock("../../server/services/emailService", () => ({
  sendEmail: vi.fn(),
}));
vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(),
}));
vi.mock("../../server/services/smsService", () => ({
  sendSMSToLead: vi.fn(),
}));

// Chainable drizzle-db mock for send-sms's consent lookup.
const leadRowHolder: { row: any } = { row: { doNotContact: false, tcpaConsent: true } };
vi.mock("../../server/db", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain, // proofReceiptStore.getPrevReceiptHash chains through this
    limit: () => Promise.resolve(leadRowHolder.row ? [leadRowHolder.row] : []),
  };
  // recordReceipt's INSERT (proof_receipts) — resolve as a no-op write.
  return { db: { ...chain, insert: () => ({ values: () => Promise.resolve() }) } };
});

import { sendEmail } from "../../server/services/emailService";
import { filterSuppressed } from "../../server/services/emailSuppressions";
import { sendSMSToLead } from "../../server/services/smsService";
import {
  getHand,
  listHandSpecs,
  executeHandWitnessed,
} from "../../server/services/autopilot/hands";
import { isQuietHour } from "../../server/services/autopilot/hands/send-sms";
import { executeDispatchTool } from "../../server/services/solene/dispatchToolExecutor";

describe("safety invariant — money + customer-facing + broadcast hands MUST be witnessed (elite-audit P0, re-audit it.2)", () => {
  it("every finance / money-moving / customer-facing / broadcast registered hand requires approval", () => {
    for (const h of listHandSpecs()) {
      if (
        h.domain === "finance" ||
        (h as any).movesMoney === true ||
        h.isCustomerFacing ||
        (h as any).outwardClass === "broadcast"
      ) {
        expect(
          h.requiresApproval,
          `${h.name} (domain=${h.domain}, movesMoney=${(h as any).movesMoney}, customerFacing=${h.isCustomerFacing}, outwardClass=${(h as any).outwardClass}) MUST requiresApproval`,
        ).toBe(true);
      }
    }
    // sanity: the registry actually has hands to check.
    expect(listHandSpecs().length).toBeGreaterThanOrEqual(6);
  });

  it("the registry REFUSES to register an un-witnessed money hand (fail-closed at boot, not just in a test)", async () => {
    const { registerHand } = await import("../../server/services/autopilot/hands/registry");
    expect(() =>
      registerHand({
        name: "rogue_money_hand",
        schema: { name: "rogue_money_hand", description: "x", input_schema: { type: "object", properties: {} } },
        domain: "growth",
        isCustomerFacing: false,
        movesMoney: true,
        requiresApproval: false, // ← the violation
        surface: "generic",
        handler: async () => ({ success: true, output: "", durationMs: 0 }),
      } as any),
    ).toThrow(/witnessed-send/i);
  });
});

describe("communication limb — registration + governance", () => {
  it("registers all four comm hands, each customer-facing + approval-required", () => {
    for (const name of ["send_email", "send_sms", "send_push", "send_letter"]) {
      const h = getHand(name);
      expect(h, name).toBeTruthy();
      expect(h!.isCustomerFacing, name).toBe(true);
      expect(h!.requiresApproval, name).toBe(true);
    }
    expect(listHandSpecs().length).toBeGreaterThanOrEqual(4);
  });

  it("the executor REFUSES a direct model call to send_email (no path around the tap)", async () => {
    const r = await executeDispatchTool("send_email", { to: "a@b.com", subject: "x", html: "<p>x</p>" });
    expect(r.success).toBe(false);
    expect(r.output).toContain("WITNESSED-SEND");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the witnessed entrypoint refuses without a real approver identity", async () => {
    const r = await executeHandWitnessed("send_email", { to: "a@b.com", subject: "x", html: "<p>x</p>" }, "");
    expect(r.success).toBe(false);
    expect(r.output).toContain("missing witnessing founder");
  });
});

describe("send_email hand — suppression honored", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a suppressed recipient and never calls sendEmail", async () => {
    (filterSuppressed as any).mockResolvedValue({ allowed: [], suppressed: ["spam@x.com"] });
    const r = await executeHandWitnessed("send_email", { to: "spam@x.com", subject: "Hi", html: "<p>Hi</p>" }, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).toContain("suppression list");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends a clean recipient via the witnessed path", async () => {
    (filterSuppressed as any).mockResolvedValue({ allowed: ["ok@x.com"], suppressed: [] });
    (sendEmail as any).mockResolvedValue({ success: true, messageId: "m_123" });
    const r = await executeHandWitnessed("send_email", { to: "ok@x.com", subject: "Hi", html: "<p>Hi</p>" }, "founder_1");
    expect(r.success).toBe(true);
    expect(r.output).toContain("m_123");
    expect(sendEmail).toHaveBeenCalledOnce();
    // commercial send → NOT marked transactional (keeps CAN-SPAM footer).
    expect((sendEmail as any).mock.calls[0][0].transactional).toBeUndefined();
  });

  it("attaches a verifiable proof-receipt to a witnessed send (Foundry move #3)", async () => {
    (filterSuppressed as any).mockResolvedValue({ allowed: ["ok@x.com"], suppressed: [] });
    (sendEmail as any).mockResolvedValue({ success: true, messageId: "m_456" });
    const { verifyReceipt } = await import("../../server/services/autopilot/proofReceipt");
    const r = await executeHandWitnessed(
      "send_email",
      { organization_id: 7, to: "ok@x.com", subject: "Hi", html: "<p>Hi</p>" },
      "founder_1",
    );
    expect(r.success).toBe(true);
    expect(r.receipt).toBeTruthy();
    expect(r.receipt!.actionKind).toBe("send_email");
    expect(r.receipt!.scope).toBe("org:7"); // the move-#2 scope flows through
    expect(r.receipt!.accountableHumanId).toBe("founder_1");
    expect(verifyReceipt(r.receipt!).valid).toBe(true);
  });
});

describe("send_sms hand — TCPA consent + quiet hours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leadRowHolder.row = { doNotContact: false, tcpaConsent: true };
  });

  it("isQuietHour is true outside 8am–9pm", () => {
    expect(isQuietHour(7)).toBe(true);
    expect(isQuietHour(8)).toBe(false);
    expect(isQuietHour(20)).toBe(false);
    expect(isQuietHour(21)).toBe(true);
    expect(isQuietHour(2)).toBe(true);
  });

  it("refuses a lead with no consent and never sends", async () => {
    leadRowHolder.row = { doNotContact: true, tcpaConsent: false };
    const r = await executeHandWitnessed("send_sms", { organization_id: 1, lead_id: 9, message: "hi" }, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).toContain("not consented");
    expect(sendSMSToLead).not.toHaveBeenCalled();
  });

  it("sends to a consented lead via the witnessed path", async () => {
    (sendSMSToLead as any).mockResolvedValue({ success: true, messageId: "sms_1" });
    const r = await executeHandWitnessed("send_sms", { organization_id: 1, lead_id: 9, message: "hi" }, "founder_1");
    expect(r.success).toBe(true);
    expect(sendSMSToLead).toHaveBeenCalledOnce();
  });
});
