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
    limit: () => Promise.resolve(leadRowHolder.row ? [leadRowHolder.row] : []),
  };
  return { db: chain };
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

describe("safety invariant — money + customer-facing hands MUST be witnessed (elite-audit P0)", () => {
  it("every finance-domain OR customer-facing registered hand requires approval", () => {
    for (const h of listHandSpecs()) {
      if (h.domain === "finance" || h.isCustomerFacing) {
        expect(h.requiresApproval, `${h.name} (domain=${h.domain}, customerFacing=${h.isCustomerFacing}) MUST requiresApproval`).toBe(true);
      }
    }
    // sanity: the registry actually has hands to check.
    expect(listHandSpecs().length).toBeGreaterThanOrEqual(6);
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
