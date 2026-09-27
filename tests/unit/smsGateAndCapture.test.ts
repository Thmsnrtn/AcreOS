/**
 * Roadmap W1.4/W1.5 — SMS response capture + TCPA gate-by-construction.
 *
 * Coverage:
 *  - sendOrgSMS gates by declared PURPOSE (DEFECT-0104):
 *    prospecting → every lead at the number through tcpaGateForSms;
 *    blocked → refused with the named reason, nothing routed
 *  - a prospecting text to a number with NO lead is REFUSED (it used to
 *    pass as "transactional" — the inversion DEFECT-0104 names)
 *  - two leads on one number: any refusal wins (it used to be row order)
 *  - servicing → bound to a note's borrower phone; marketing consent not
 *    required; STOP / doNotContact still blocks; no touch recorded
 *  - reply → only after an inbound from that number in the last 24h
 *  - once the carrier returned a SID, a bookkeeping failure cannot turn
 *    the send into a reported failure
 *  - consent state unverifiable (storage error) → FAIL CLOSED
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

// TCPA gate — scripted verdict (per lead when `gateByLead` names one).
let gateVerdict: { allowed: boolean; reason?: string } = { allowed: true };
let gateByLead: Record<number, { allowed: boolean; reason?: string }> = {};
const gateCalls: Array<{ leadId: number }> = [];
let quietVerdict: { blocked: boolean; reason?: string } = { blocked: false };
vi.mock("../../server/services/tcpaCompliance", () => ({
  tcpaGateForSms: vi.fn(async (leadId: number) => {
    gateCalls.push({ leadId });
    return gateByLead[leadId] ?? gateVerdict;
  }),
  isWithinQuietHours: vi.fn(() => ({ ...quietVerdict, zone: "America/Chicago" })),
  detectOptKeyword: (body: string) =>
    ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"].includes(body.trim().toLowerCase())
      ? "opt_out"
      : null,
}));

// db mock — leads select, message/unattached inserts, updates.
interface LeadRow {
  id: number;
  phone: string | null;
  status?: string;
  doNotContact?: boolean;
  tcpaConsent?: boolean;
  timezone?: string | null;
}
let LEADS: LeadRow[] = [];
let leadsSelectThrows = false;
/** Notes the servicing purpose can bind to. */
const NOTES = new Map<number, { id: number; borrowerId: number | null }>();
/** Last-10 digits → the LATEST text that number sent inside the reply window. */
const INBOUND_FROM = new Map<string, string>();
/** Make the contact-touch write throw AFTER the carrier accepted the message. */
let touchThrows = false;

const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);

// Storage — the two DEFECT-0104 lookups plus note/lead reads, over the same
// in-memory rows the db double serves.
vi.mock("../../server/storage", () => ({
  storage: {
    findLeadsByPhoneLast10: vi.fn(async (_orgId: number, phone: string) => {
      if (leadsSelectThrows) throw new Error("db down");
      return LEADS.filter((l) => l.phone && last10(l.phone) === last10(phone));
    }),
    latestInboundSmsFrom: vi.fn(async (_orgId: number, phone: string) => {
      const body = INBOUND_FROM.get(last10(phone));
      return body === undefined ? null : { body, receivedAt: new Date() };
    }),
    getNote: vi.fn(async (_orgId: number, id: number) => NOTES.get(id)),
    getLead: vi.fn(async (_orgId: number, id: number) => LEADS.find((l) => l.id === id)),
  },
}));

vi.mock("../../server/services/compliance/contactFrequency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/compliance/contactFrequency")>();
  return {
    ...actual,
    recordContactTouch: vi.fn(async (input: Parameters<typeof actual.recordContactTouch>[0]) => {
      if (touchThrows) throw new Error("touch ledger unavailable");
      return actual.recordContactTouch(input);
    }),
  };
});
const LEAD_UPDATES: any[] = [];
const UNATTACHED: any[] = [];
const MESSAGES: any[] = [];
let CONVERSATIONS: any[] = [];
/** Prior contact touches the frequency cap counts. Empty = clean lead. */
let TOUCHES: Array<{ createdAt: Date }> = [];
/** Touch-ledger rows written back after a send actually succeeds. */
const TOUCH_WRITES: any[] = [];

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
          // lead_activities (contact-frequency touch ledger) and
          // organizations (per-org cap overrides) resolve empty: a lead with
          // no prior touches and an org with no override, i.e. a
          // frequency-clean fixture. The gate then allows on the DEFAULT
          // caps, which is the state these consent tests are about.
          if (name === "lead_activities") return TOUCHES;
          return [];
        };
        // Every terminal in the builder must be thenable — the frequency gate
        // ends its read on .orderBy(), and a non-thenable there resolves to
        // the builder object itself, which the gate reads as "contact history
        // unverifiable" and fails CLOSED. That is correct behaviour reacting
        // to a broken double, so the double has to be complete.
        const step = (): any => {
          const p: any = Promise.resolve(rowsFor());
          p.where = step;
          p.orderBy = step;
          p.limit = step;
          p.groupBy = step;
          return p;
        };
        return step();
      },
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] ?? "";
        const sink =
          name === "unattached_inbound_messages" ? UNATTACHED :
          name === "messages" ? MESSAGES :
          name === "conversations" ? CONVERSATIONS :
          name === "lead_activities" ? TOUCH_WRITES : [];
        const row = { id: sink.length + 1, ...v };
        sink.push(row);
        // Awaited directly by some writers (the contact-frequency touch
        // ledger) and via .returning()/.onConflictDoNothing() by others, so
        // the builder is itself thenable.
        const p: any = Promise.resolve([row]);
        p.onConflictDoNothing = (_t?: unknown) =>
          Object.assign(Promise.resolve(), {
            returning: () => Promise.resolve([row]),
          });
        p.returning = () => Promise.resolve([row]);
        return p;
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

import { sendOrgSMS, handleIncomingSMS, type SendOrgSmsInput } from "../../server/services/smsService";

const prospect = (to: string, message: string, extra: Partial<SendOrgSmsInput> = {}) =>
  sendOrgSMS({ organizationId: 1, to, message, purpose: "prospecting", ...extra });

beforeEach(() => {
  ROUTED.length = 0;
  gateCalls.length = 0;
  gateVerdict = { allowed: true };
  gateByLead = {};
  quietVerdict = { blocked: false };
  LEADS = [];
  leadsSelectThrows = false;
  NOTES.clear();
  INBOUND_FROM.clear();
  touchThrows = false;
  LEAD_UPDATES.length = 0;
  UNATTACHED.length = 0;
  MESSAGES.length = 0;
  CONVERSATIONS = [];
  TOUCHES = [];
  TOUCH_WRITES.length = 0;
  vi.clearAllMocks();
});

describe("sendOrgSMS — TCPA gate by construction (W1.5)", () => {
  it("routes a lead-matched send through the gate and refuses when blocked", async () => {
    LEADS = [{ id: 9, phone: "+1 (555) 123-4567" }];
    gateVerdict = { allowed: false, reason: "no TCPA consent on record" };
    const r = await prospect("5551234567", "hey, still own that lot?");
    expect(gateCalls).toEqual([{ leadId: 9 }]);
    expect(r.success).toBe(false);
    expect(r.error).toContain("no TCPA consent");
    expect(ROUTED).toHaveLength(0); // nothing reached the carrier
  });

  it("sends when the gate allows", async () => {
    LEADS = [{ id: 9, phone: "5551234567" }];
    gateVerdict = { allowed: true };
    const r = await prospect("+15551234567", "hello");
    expect(r.success).toBe(true);
    expect(ROUTED).toHaveLength(1);
    // The touch is recorded only AFTER the carrier accepted it.
    expect(TOUCH_WRITES).toHaveLength(1);
    expect(TOUCH_WRITES[0].type).toBe("communication_sms");
    expect(TOUCH_WRITES[0].leadId).toBe(9);
  });

  it("refuses a lead already at the contact-frequency cap — and records no touch", async () => {
    LEADS = [{ id: 9, phone: "5551234567" }];
    gateVerdict = { allowed: true };
    // Default cap is 1 per rolling 24h; one recent touch already spends it.
    TOUCHES = [{ createdAt: new Date(Date.now() - 60 * 60 * 1000) }];
    const r = await prospect("+15551234567", "hello again");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/contact-frequency cap/i);
    expect(ROUTED).toHaveLength(0);
    expect(TOUCH_WRITES).toHaveLength(0);
  });

  it("consent still takes precedence over the frequency cap", async () => {
    // Both would refuse. The consent refusal must be the one reported —
    // frequency is only ever an ADDITIONAL reason, evaluated last.
    LEADS = [{ id: 9, phone: "5551234567" }];
    gateVerdict = { allowed: false, reason: "no TCPA consent on record" };
    TOUCHES = [{ createdAt: new Date(Date.now() - 60 * 60 * 1000) }];
    const r = await prospect("+15551234567", "hello");
    expect(r.success).toBe(false);
    expect(r.error).toContain("no TCPA consent");
    expect(r.error).not.toMatch(/frequency/i);
    expect(ROUTED).toHaveLength(0);
  });

  // DEFECT-0104 — INVERTED. This case used to read "a recipient matching no
  // lead (customer/transactional) passes without the gate" and assert
  // success: a missing consent record was treated as permission. Every
  // caller of this sender texts a counterparty; system SMS never comes here.
  it("a PROSPECTING text to a number with no lead record is REFUSED — consent cannot be shown", async () => {
    LEADS = [{ id: 9, phone: "5559999999" }];
    const r = await prospect("5551230000", "want to sell your land?");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^TCPA gate: no lead record/);
    expect(gateCalls).toHaveLength(0);
    expect(ROUTED).toHaveLength(0);
  });

  it("two leads on one number: ANY refusal wins, whatever the row order", async () => {
    LEADS = [
      { id: 9, phone: "5551234567" },
      { id: 10, phone: "+1 (555) 123-4567" },
    ];
    gateByLead = { 10: { allowed: false, reason: "no TCPA consent on record" } };
    const r = await prospect("5551234567", "still own that lot?");
    expect(r.success).toBe(false);
    expect(r.error).toContain("no TCPA consent");
    expect(gateCalls.map((c) => c.leadId)).toEqual([9, 10]);
    expect(ROUTED).toHaveLength(0);
  });

  it("refuses a prospecting text naming a lead that is not on file at the number", async () => {
    LEADS = [{ id: 9, phone: "5551234567" }];
    const r = await prospect("5551234567", "hi", { leadId: 44 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/lead 44 is not on file/);
    expect(ROUTED).toHaveLength(0);
  });

  it("FAILS CLOSED when consent state is unverifiable", async () => {
    leadsSelectThrows = true;
    const r = await prospect("5551234567", "marketing text");
    expect(r.success).toBe(false);
    expect(r.error).toContain("unverifiable");
    expect(ROUTED).toHaveLength(0);
  });

  it("once the carrier returned a SID, a bookkeeping failure still reports the send that happened", async () => {
    LEADS = [{ id: 9, phone: "5551234567" }];
    touchThrows = true;
    const r = await prospect("+15551234567", "hello");
    expect(ROUTED).toHaveLength(1);
    expect(r).toEqual({ success: true, messageId: "SM_test_1" });
  });
});

describe("sendOrgSMS — servicing purpose (DEFECT-0104)", () => {
  const service = (to: string, extra: Partial<SendOrgSmsInput> = {}) =>
    sendOrgSMS({ organizationId: 1, to, message: "Your payment is due on the 1st.", purpose: "servicing", noteId: 77, ...extra });

  it("texts the note's borrower without the MARKETING consent flag, and records no touch", async () => {
    LEADS = [{ id: 9, phone: "5551234567", tcpaConsent: false }];
    NOTES.set(77, { id: 77, borrowerId: 9 });
    gateVerdict = { allowed: false, reason: "no TCPA consent on record" }; // must not be consulted
    const r = await service("+15551234567");
    expect(r.success).toBe(true);
    expect(gateCalls).toHaveLength(0);
    expect(ROUTED).toHaveLength(1);
    expect(TOUCH_WRITES).toHaveLength(0);
  });

  it("refuses a destination that is not the borrower of record on the note", async () => {
    LEADS = [{ id: 9, phone: "5551234567" }];
    NOTES.set(77, { id: 77, borrowerId: 9 });
    const r = await service("+15550009999");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not the borrower of record/);
    expect(ROUTED).toHaveLength(0);
  });

  it("a borrower who sent STOP (doNotContact) is still refused", async () => {
    LEADS = [{ id: 9, phone: "5551234567", doNotContact: true }];
    NOTES.set(77, { id: 77, borrowerId: 9 });
    const r = await service("+15551234567");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/revoked contact/);
    expect(ROUTED).toHaveLength(0);
  });

  it("recipient quiet hours still block a servicing text", async () => {
    LEADS = [{ id: 9, phone: "5551234567" }];
    NOTES.set(77, { id: 77, borrowerId: 9 });
    quietVerdict = { blocked: true, reason: "outside 8am-9pm recipient local time" };
    const r = await service("+15551234567");
    expect(r.success).toBe(false);
    expect(r.error).toContain("outside 8am-9pm");
    expect(ROUTED).toHaveLength(0);
  });

  it("refuses a servicing text that names no note", async () => {
    LEADS = [{ id: 9, phone: "5551234567" }];
    const r = await service("+15551234567", { noteId: undefined });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/must name the note/);
    expect(ROUTED).toHaveLength(0);
  });
});

describe("sendOrgSMS — reply purpose (DEFECT-0104)", () => {
  const reply = (to: string) =>
    sendOrgSMS({ organizationId: 1, to, message: "Thanks — yes, we can talk tomorrow.", purpose: "reply" });

  it("refuses a reply when the number has not texted the org in the window", async () => {
    const r = await reply("+15551230000");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nothing|no inbound text/);
    expect(ROUTED).toHaveLength(0);
  });

  it("answers a number that texted first, even with no lead record, and records no touch", async () => {
    INBOUND_FROM.set("5551230000", "is the lot still available?");
    const r = await reply("+15551230000");
    expect(r.success).toBe(true);
    expect(ROUTED).toHaveLength(1);
    expect(TOUCH_WRITES).toHaveLength(0);
  });

  it("does not answer a number whose LATEST text was STOP, even with no lead record", async () => {
    INBOUND_FROM.set("5551230000", "STOP");
    const r = await reply("+15551230000");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/opt-out/);
    expect(ROUTED).toHaveLength(0);
  });

  it("does not answer a lead at that number who has sent STOP", async () => {
    INBOUND_FROM.set("5551234567", "still interested");
    LEADS = [{ id: 9, phone: "5551234567", doNotContact: true }];
    const r = await reply("+15551234567");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/revoked contact/);
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

  it("a STOP from a number matching NO lead is recorded, so a later reply can see it", async () => {
    LEADS = [{ id: 4, phone: "5559999999" }];
    const r = await handleIncomingSMS(1, "+15551234567", "+15550001111", "STOP", "SM_stop_unmatched");
    expect(r.success).toBe(true);
    expect(UNATTACHED).toHaveLength(1);
    expect(UNATTACHED[0].body).toBe("STOP");
    expect(UNATTACHED[0].externalId).toBe("SM_stop_unmatched");
    expect(LEAD_UPDATES).toHaveLength(0);
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
