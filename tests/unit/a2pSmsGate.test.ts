/**
 * A2P 10DLC (W5b): a text to a landowner is refused at the send chokepoint
 * (sendOrgSMS) until the org's OWN brand + campaign registration is
 * confirmed — read from its provider, or self-reported and labelled so.
 *
 *   1. The rule (a2pSendVerdict): no record, brand or campaign not approved,
 *      a record for a different number → refused; both approved → allowed;
 *      toll-free numbers need verification instead of a brand.
 *   2. The chokepoint: with every TCPA check passing, sendOrgSMS refuses with
 *      an `A2P gate:` reason and routes NOTHING when the registration is
 *      missing / pending / for another number, and routes once it is
 *      approved — for every purpose. A storage error fails closed.
 *   3. Provider status: Twilio's raw statuses normalise conservatively (an
 *      unknown status is never "approved"); a refusal is a deferral, not a
 *      permanent failure, for the sequence engine and a 403 for a person.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  a2pSendVerdict,
  normaliseTwilioBrandStatus,
  normaliseTwilioCampaignStatus,
  numberKindOf,
} from "../../shared/sms/a2p10dlc";

describe("1 · the rule", () => {
  const ok = { numberKind: "10dlc", brandStatus: "approved", campaignStatus: "approved", statusSource: "provider_api", phoneNumber: "+15125550100" };
  it("refuses with no registration on file", () => {
    expect(a2pSendVerdict(null, "+15125550100").allowed).toBe(false);
  });
  it.each([
    ["pending", "approved"],
    ["approved", "pending"],
    ["failed", "approved"],
    ["approved", "not_started"],
  ])("refuses brand=%s campaign=%s", (brandStatus, campaignStatus) => {
    const v = a2pSendVerdict({ ...ok, brandStatus, campaignStatus }, "+15125550100");
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/A2P 10DLC (brand|campaign)/);
  });
  it("refuses when the registration covers a different number", () => {
    expect(a2pSendVerdict(ok, "+15125559999").allowed).toBe(false);
  });
  it("allows when brand and campaign are approved — self-reported counts, and says so elsewhere", () => {
    expect(a2pSendVerdict(ok, "+1 (512) 555-0100").allowed).toBe(true);
    expect(a2pSendVerdict({ ...ok, statusSource: "self_reported" }, "+15125550100").allowed).toBe(true);
  });
  it("toll-free: verification decides, no brand needed", () => {
    const tf = { ...ok, numberKind: "toll_free", brandStatus: "not_started", phoneNumber: "+18885550100" };
    expect(numberKindOf("+1 888 555 0100")).toBe("toll_free");
    expect(a2pSendVerdict(tf, "+18885550100").allowed).toBe(true);
    expect(a2pSendVerdict({ ...tf, campaignStatus: "pending" }, "+18885550100").allowed).toBe(false);
  });
  it("Twilio statuses normalise conservatively", () => {
    expect(normaliseTwilioBrandStatus("APPROVED")).toBe("approved");
    expect(normaliseTwilioBrandStatus("IN_REVIEW")).toBe("pending");
    expect(normaliseTwilioBrandStatus("SUSPENDED")).toBe("failed");
    expect(normaliseTwilioBrandStatus("SOMETHING_NEW")).toBe("pending");
    expect(normaliseTwilioCampaignStatus("VERIFIED")).toBe("approved");
    expect(normaliseTwilioCampaignStatus("IN_PROGRESS")).toBe("pending");
    expect(normaliseTwilioCampaignStatus("FAILED")).toBe("failed");
  });
});

// ── 2 · the chokepoint ──────────────────────────────────────────────────────

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const ROUTED: string[] = [];
vi.mock("../../server/services/comms/router", () => ({
  commsRouter: { route: vi.fn(async (i: { to: string }) => { ROUTED.push(i.to); return { sid: "SM_a2p" }; }) },
}));
const TW = vi.hoisted(() => ({ number: "+15125550100" as string | null }));
vi.mock("../../server/services/comms/providers/twilio", () => ({
  twilioProvider: {},
  orgByoTwilioNumber: async () => TW.number,
}));
vi.mock("../../server/services/comms/providers/telnyx", () => ({}));
vi.mock("../../server/services/tcpaCompliance", () => ({
  tcpaGateForSms: async () => ({ allowed: true }),
  isWithinQuietHours: () => ({ blocked: false }),
  detectOptKeyword: () => null,
}));
vi.mock("../../server/services/compliance/dncScrub", () => ({ dncGateForSms: async () => ({ allowed: true }) }));
vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => ({ allowed: true }),
  describeFrequencySkip: () => "",
  recordContactTouch: async () => undefined,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    findLeadsByPhoneLast10: async () => [{ id: 9, phone: "+15125551234" }],
    getNote: async () => ({ id: 3, borrowerId: 9 }),
    getLead: async () => ({ id: 9, phone: "+15125551234", doNotContact: false, optOutDate: null, timezone: null }),
    latestInboundSmsFrom: async () => ({ body: "yes call me", receivedAt: new Date() }),
  },
}));
vi.mock("../../server/services/byok/toggle", () => ({ isByokEnabled: async () => true }));
const REG = vi.hoisted(() => ({ rows: [] as any[], throws: false, tables: [] as string[] }));
vi.mock("../../server/db", () => {
  const select = () => ({
    from: (table: any) => {
      const name = table?.[Symbol.for("drizzle:Name")] ?? "";
      REG.tables.push(name);
      const rows = () => {
        if (name === "sms_a2p_registrations") {
          if (REG.throws) throw new Error("db down");
          return REG.rows;
        }
        return [];
      };
      const step = (): any => {
        let p: any;
        try {
          p = Promise.resolve(rows());
        } catch (e) {
          p = Promise.reject(e);
          p.catch(() => undefined);
        }
        p.where = step;
        p.limit = step;
        p.orderBy = step;
        return p;
      };
      return step();
    },
  });
  return { db: { select, insert: () => ({ values: () => ({ returning: async () => [] }) }) } };
});

import { sendOrgSMS, isSmsGateRefusal, type SmsPurpose } from "../../server/services/smsService";

const approved = { organizationId: 1, numberKind: "10dlc", phoneNumber: "+15125550100", brandStatus: "approved", campaignStatus: "approved", statusSource: "provider_api" };
const send = (purpose: SmsPurpose) =>
  sendOrgSMS({ organizationId: 1, to: "+15125551234", message: "Hello — still own the lot?", purpose, leadId: 9, noteId: purpose === "servicing" ? 3 : undefined });

beforeEach(() => {
  ROUTED.length = 0;
  REG.rows = [];
  REG.throws = false;
  REG.tables.length = 0;
  TW.number = "+15125550100";
});

describe("2 · sendOrgSMS refuses until the registration is confirmed", () => {
  it.each<SmsPurpose>(["prospecting", "servicing", "reply"])("%s: no registration → refused, nothing routed", async (purpose) => {
    const r = await send(purpose);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^A2P gate: /);
    expect(isSmsGateRefusal(r.error)).toBe(true);
    expect(ROUTED).toEqual([]);
    expect(REG.tables).toContain("sms_a2p_registrations"); // the gate read the real table
  });

  it("a pending campaign is still refused", async () => {
    REG.rows = [{ ...approved, campaignStatus: "pending" }];
    const r = await send("prospecting");
    expect(r.error).toMatch(/campaign is pending/);
    expect(ROUTED).toEqual([]);
  });

  it("a registration for another number does not cover this one", async () => {
    REG.rows = [{ ...approved, phoneNumber: "+15125559999" }];
    expect((await send("prospecting")).success).toBe(false);
    expect(ROUTED).toEqual([]);
  });

  it.each<SmsPurpose>(["prospecting", "servicing", "reply"])("%s: approved → routed once", async (purpose) => {
    REG.rows = [approved];
    const r = await send(purpose);
    expect(r).toEqual({ success: true, messageId: "SM_a2p" });
    expect(ROUTED).toEqual(["+15125551234"]);
  });

  it("own Twilio connected: a SELF-REPORTED approval on file is not confirmation (the provider is the authority)", async () => {
    // W5b audit: selfReportA2p refuses a self-report once Twilio is connected,
    // but a row reported BEFORE connecting stayed on file and passed the gate.
    REG.rows = [{ ...approved, statusSource: "self_reported" }];
    const r = await send("prospecting");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^A2P gate: .*read from Twilio/);
    expect(ROUTED).toEqual([]);
    // Without a connected Twilio the same self-report is honoured (and labelled elsewhere).
    TW.number = null;
    expect((await send("prospecting")).success).toBe(true);
  });

  it("the platform system rail (smsService.sendSMS — AcreOS's own alerts and dunning) never consults an org's A2P row", async () => {
    const { smsService } = await import("../../server/services/smsService");
    await smsService.sendSMS({ to: "+15125550000", message: "AcreOS: your verification code" } as never);
    expect(REG.tables).not.toContain("sms_a2p_registrations");
  });

  it("an unreadable registration fails CLOSED", async () => {
    REG.throws = true;
    const r = await send("prospecting");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^A2P gate: .*could not be checked/);
    expect(ROUTED).toEqual([]);
  });
});

describe("3 · the refusal is a deferral to the sequence engine, a 403 to a person", () => {
  it("both callers use isSmsGateRefusal, not a TCPA-only prefix", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    for (const f of ["server/services/sequenceProcessor.ts", "server/routes-misc.ts"]) {
      const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../..", f), "utf8"));
      expect(src, f).toMatch(/isSmsGateRefusal\(result\.error\)/);
      expect(src, f).not.toMatch(/startsWith\("TCPA gate:"\)/);
    }
  });
});
