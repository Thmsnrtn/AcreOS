/**
 * Roadmap W1.4/W1.5 — SMS response capture + TCPA gate-by-construction.
 *
 * Coverage:
 *  - sendOrgSMS gates lead-matched recipients through tcpaGateForSms;
 *    blocked → refused with the named reason, nothing routed
 *  - non-lead recipients (customer/transactional) pass through
 *  - consent state unverifiable (db error) → FAIL CLOSED
 *  - handleIncomingSMS: matched inbound flips the lead to "responded"
 *  - unmatched inbound is PERSISTED as an unattached reply (not dropped)
 *    and reports unmatched:true
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Comms router — capture routed sends.
const ROUTED: Array<{ to: string; body: string }> = [];
vi.mock("../../server/services/comms/router", () => ({
  commsRouter: {
    route: vi.fn(async (input: { to: string; body: string }) => {
      ROUTED.push({ to: input.to, body: input.body });
      return { sid: "SM_test_1" };
    }),
  },
}));
vi.mock("../../server/services/comms/providers/twilio", () => ({ twilioProvider: {} }));
vi.mock("../../server/services/comms/providers/telnyx", () => ({}));

// TCPA gate — scripted verdict.
let gateVerdict: { allowed: boolean; reason?: string } = { allowed: true };
const gateCalls: Array<{ leadId: number }> = [];
vi.mock("../../server/services/tcpaCompliance", () => ({
  tcpaGateForSms: vi.fn(async (leadId: number) => {
    gateCalls.push({ leadId });
    return gateVerdict;
  }),
}));

// db mock — leads select, message/unattached inserts, updates.
interface LeadRow { id: number; phone: string | null; status?: string }
let LEADS: LeadRow[] = [];
let leadsSelectThrows = false;
const LEAD_UPDATES: any[] = [];
const UNATTACHED: any[] = [];
const MESSAGES: any[] = [];
let CONVERSATIONS: any[] = [];

vi.mock("../../server/db", () => ({
  db: {
    select: (_proj?: unknown) => ({
      from: (table: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] ?? "";
        const rowsFor = () => {
          if (name === "leads") {
            if (leadsSelectThrows) throw new Error("db down");
            return LEADS;
          }
          if (name === "conversations") return CONVERSATIONS;
          return [];
        };
        return {
          where: (_w: unknown) => {
            const p = Promise.resolve(rowsFor());
            return Object.assign(p, {
              orderBy: () => ({ limit: () => p }),
              limit: () => p,
            });
          },
        };
      },
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] ?? "";
        const sink =
          name === "unattached_inbound_messages" ? UNATTACHED :
          name === "messages" ? MESSAGES :
          name === "conversations" ? CONVERSATIONS : [];
        const row = { id: sink.length + 1, ...v };
        return {
          onConflictDoNothing: (_t?: unknown) => {
            sink.push(row);
            return Object.assign(Promise.resolve(), {
              returning: () => Promise.resolve([row]),
            });
          },
          returning: () => {
            sink.push(row);
            return Promise.resolve([row]);
          },
        };
      },
    }),
    update: (table: any) => ({
      set: (patch: any) => ({
        where: (_w: unknown) => {
          const name = table?.[Symbol.for("drizzle:Name")] ?? "";
          if (name === "leads") LEAD_UPDATES.push(patch);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

import { sendOrgSMS, handleIncomingSMS } from "../../server/services/smsService";

beforeEach(() => {
  ROUTED.length = 0;
  gateCalls.length = 0;
  gateVerdict = { allowed: true };
  LEADS = [];
  leadsSelectThrows = false;
  LEAD_UPDATES.length = 0;
  UNATTACHED.length = 0;
  MESSAGES.length = 0;
  CONVERSATIONS = [];
  vi.clearAllMocks();
});

describe("sendOrgSMS — TCPA gate by construction (W1.5)", () => {
  it("routes a lead-matched send through the gate and refuses when blocked", async () => {
    LEADS = [{ id: 9, phone: "+1 (555) 123-4567" }];
    gateVerdict = { allowed: false, reason: "no TCPA consent on record" };
    const r = await sendOrgSMS(1, "5551234567", "hey, still own that lot?");
    expect(gateCalls).toEqual([{ leadId: 9 }]);
    expect(r.success).toBe(false);
    expect(r.error).toContain("no TCPA consent");
    expect(ROUTED).toHaveLength(0); // nothing reached the carrier
  });

  it("sends when the gate allows", async () => {
    LEADS = [{ id: 9, phone: "5551234567" }];
    gateVerdict = { allowed: true };
    const r = await sendOrgSMS(1, "+15551234567", "hello");
    expect(r.success).toBe(true);
    expect(ROUTED).toHaveLength(1);
  });

  it("a recipient matching no lead (customer/transactional) passes without the gate", async () => {
    LEADS = [{ id: 9, phone: "5559999999" }];
    const r = await sendOrgSMS(1, "5551230000", "your payment failed — update your card");
    expect(gateCalls).toHaveLength(0);
    expect(r.success).toBe(true);
  });

  it("FAILS CLOSED when consent state is unverifiable", async () => {
    leadsSelectThrows = true;
    const r = await sendOrgSMS(1, "5551234567", "marketing text");
    expect(r.success).toBe(false);
    expect(r.error).toContain("unverifiable");
    expect(ROUTED).toHaveLength(0);
  });
});

describe("handleIncomingSMS — response capture (W1.4)", () => {
  it("a matched inbound flips the lead to responded (mirrors the email path)", async () => {
    LEADS = [{ id: 4, phone: "5551234567" }];
    CONVERSATIONS = [{ id: 20, organizationId: 1, leadId: 4, channel: "sms" }];
    const r = await handleIncomingSMS(1, "+15551234567", "+15550001111", "yes I still own it, make me an offer", "SM_in_1");
    expect(r.success).toBe(true);
    expect(r.leadId).toBe(4);
    expect(LEAD_UPDATES.some((p) => p.status === "responded")).toBe(true);
  });

  it("an UNMATCHED inbound is persisted as an unattached reply, not dropped", async () => {
    LEADS = [{ id: 4, phone: "5559999999" }]; // different number
    const r = await handleIncomingSMS(1, "+15551234567", "+15550001111", "this is his wife, we want to sell", "SM_in_2");
    expect(r.success).toBe(true);
    expect(r.unmatched).toBe(true);
    expect(r.leadId).toBeUndefined();
    expect(UNATTACHED).toHaveLength(1);
    expect(UNATTACHED[0].fromAddress).toBe("+15551234567");
    expect(UNATTACHED[0].body).toContain("his wife");
    expect(UNATTACHED[0].externalId).toBe("SM_in_2");
    // No responded flip — nothing matched.
    expect(LEAD_UPDATES).toHaveLength(0);
  });
});
