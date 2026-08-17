/**
 * "Autopilot is system-only" — founder ruling, 2026-08-16.
 *
 * The send_email hand takes a FREE-FORM recipient address. Nothing in its shape
 * stopped it being pointed at a customer org's seller, buyer or borrower, which
 * would re-front the platform send rail (founder decision, 2026-07-17:
 * counterparty mail requires the org's OWN connected identity). The founder
 * closed the question in the narrowing direction: the autopilot may only ever
 * mail AcreOS's own users.
 *
 * These tests pin the three halves of that ruling as it is implemented in
 * server/services/autopilot/hands/send-email.ts:
 *   (a) a normal AcreOS-user send still works, and carries an EXPLICIT
 *       purpose: "system" — a decision of record, not the interface's silent
 *       `?? 'system'` default;
 *   (b) a send addressed to a lead / borrower / buyer / seller record is
 *       REFUSED and never reaches emailService;
 *   (c) the refusal is LOUD — it names the ruling and the matched record, is
 *       logged at warn, and is never dressed up as a success;
 *   plus the two properties that make (b) a real hard stop rather than a
 *   formality: it fails CLOSED when the lookup errors, and it is
 *   case-insensitive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Controllable fake DB ────────────────────────────────────────────────────
// Keyed by real table name AND by the address the query actually bound, so a
// row only comes back when the source's own normalization produced the armed
// needle. Without the address check the case-insensitivity test would be
// vacuous — the fake would answer "match" no matter what was searched for.
const state = vi.hoisted(() => ({
  rowsByTable: {} as Record<string, { email: string; row: Record<string, unknown> }>,
  lookupError: null as Error | null,
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const makeChain = () => {
    let table = "";
    let needle: string | null = null;
    const chain: any = {
      select: () => chain,
      from: (t: unknown) => {
        try {
          table = getTableName(t as any);
        } catch {
          table = String(t);
        }
        return chain;
      },
      where: (cond: unknown) => {
        // drizzle stores an interpolated value as a bare string chunk; the
        // column and literal SQL are objects. So the bare string IS the needle.
        for (const ch of ((cond as any)?.queryChunks ?? []) as unknown[]) {
          if (typeof ch === "string") needle = ch;
        }
        return chain;
      },
      orderBy: () => chain,
      limit: () => {
        if (state.lookupError) return Promise.reject(state.lookupError);
        const armed = state.rowsByTable[table];
        return Promise.resolve(armed && armed.email === needle ? [armed.row] : []);
      },
    };
    return chain;
  };
  return {
    db: {
      select: (...args: unknown[]) => makeChain().select(...args),
      // proof-receipt persistence writes through here; a no-op is enough.
      insert: () => ({ values: () => Promise.resolve() }),
    },
  };
});

vi.mock("../../server/services/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("../../server/services/emailSuppressions", () => ({ filterSuppressed: vi.fn() }));

import { sendEmail } from "../../server/services/emailService";
import { filterSuppressed } from "../../server/services/emailSuppressions";
import { logger } from "../../server/utils/logger";
import { executeHandWitnessed } from "../../server/services/autopilot/hands";
import { counterpartyMatch } from "../../server/services/autopilot/hands/counterpartyMatch";

const ACREOS_USER = { to: "owner@customer-co.com", subject: "Your trial", html: "<p>Hi</p>" };

/** Arm `table` so that exactly `email` (as the source normalizes it) resolves to `row`. */
function armCounterparty(table: string, row: Record<string, unknown>, email = ACREOS_USER.to) {
  state.rowsByTable[table] = { email, row };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rowsByTable = {};
  state.lookupError = null;
  (filterSuppressed as any).mockResolvedValue({ allowed: [ACREOS_USER.to], suppressed: [] });
  (sendEmail as any).mockResolvedValue({ success: true, messageId: "m_sys_1" });
});

// ── (a) a normal AcreOS-user send still works ───────────────────────────────
describe("(a) AcreOS's own users are still reachable", () => {
  it("sends to an address that is nobody's counterparty", async () => {
    const r = await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    expect(r.success).toBe(true);
    expect(r.output).toContain("m_sys_1");
    expect(sendEmail).toHaveBeenCalledOnce();
    expect((sendEmail as any).mock.calls[0][0].to).toBe(ACREOS_USER.to);
  });

  it("labels the lane EXPLICITLY as system — a decision of record, not the `?? 'system'` default", async () => {
    await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    const opts = (sendEmail as any).mock.calls[0][0];
    // `in` rather than a truthy check: the whole point is that the field is
    // PRESENT. An omitted field would also read as "system" at the service,
    // which is exactly the silent default this ruling replaces.
    expect(Object.prototype.hasOwnProperty.call(opts, "purpose")).toBe(true);
    expect(opts.purpose).toBe("system");
  });

  it("does NOT forward organization_id as a sender identity (ledger attribution only)", async () => {
    const r = await executeHandWitnessed(
      "send_email",
      { ...ACREOS_USER, organization_id: 7 },
      "founder_1",
    );
    expect(r.success).toBe(true);
    // sendEmail treats organizationId as a SENDER-IDENTITY selector (org BYO SES
    // creds + verified-domain From override). Autopilot mail rides the AcreOS
    // platform identity, so the field must not be handed over.
    expect((sendEmail as any).mock.calls[0][0].organizationId).toBeUndefined();
    // ...while attribution is untouched: the receipt still carries the org.
    expect(r.receipt?.scope).toBe("org:7");
  });

  // ── Invariants carried over from autopilotCommHands.test.ts ───────────────
  // That file's db mock returns a lead row for EVERY query (it was written for
  // send-sms's consent lookup), so it cannot express "this address is nobody's
  // counterparty" and its send_email cases now trip this guard. These two tests
  // re-pin the invariants it was protecting in a harness that CAN express it,
  // so they survive regardless of how that file is repaired.
  it("still attaches a verifiable proof-receipt to a witnessed send (Foundry move #3)", async () => {
    const { verifyReceipt } = await import("../../server/services/autopilot/proofReceipt");
    const r = await executeHandWitnessed(
      "send_email",
      { ...ACREOS_USER, organization_id: 7 },
      "founder_1",
    );
    expect(r.success).toBe(true);
    expect(r.receipt).toBeTruthy();
    expect(r.receipt!.actionKind).toBe("send_email");
    expect(r.receipt!.scope).toBe("org:7");
    expect(r.receipt!.accountableHumanId).toBe("founder_1");
    expect(verifyReceipt(r.receipt!).valid).toBe(true);
  });

  it("still honors the suppression list for a non-counterparty recipient", async () => {
    (filterSuppressed as any).mockResolvedValue({ allowed: [], suppressed: [ACREOS_USER.to] });
    const r = await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).toContain("suppression list");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still keeps the commercial lane — not marked transactional (CAN-SPAM footer stays)", async () => {
    await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    const opts = (sendEmail as any).mock.calls[0][0];
    expect(opts.transactional).toBeUndefined();
    expect(opts.isCampaignEmail).toBe(true);
  });

  it("the tool schema documents organization_id as attribution, not sender identity", async () => {
    const { getHand } = await import("../../server/services/autopilot/hands");
    const desc = String(
      (getHand("send_email")!.schema.input_schema as any).properties.organization_id.description,
    );
    expect(desc).toMatch(/attribution/i);
    expect(desc).not.toMatch(/for sender identity/i);
  });
});

// ── (b) counterparty recipients are refused ─────────────────────────────────
describe("(b) a send addressed to a customer's counterparty is refused", () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["a lead/seller", "leads", { id: 41, organizationId: 9 }],
    ["a borrower payment profile", "borrower_payment_profiles", { id: 42, organizationId: 9 }],
    ["a borrower portal session", "borrower_sessions", { id: 43, organizationId: 9 }],
    ["a borrower autopay enrollment", "autopay_enrollments", { id: 44, organizationId: 9 }],
    ["a buyer reservation", "buyer_reservations", { id: 45, organizationId: 9 }],
  ];

  for (const [label, table, row] of cases) {
    it(`refuses ${label} and never calls sendEmail`, async () => {
      armCounterparty(table, row);
      const r = await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
      expect(r.success).toBe(false);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(r.output).toContain(String(row.id));
    });
  }

  it("matches case-insensitively and ignores padding — a capital letter must not defeat the hard stop", async () => {
    // The lead is stored lowercase; the model addresses it in mixed case with
    // stray whitespace. Only the source's own trim+lowercase makes these meet.
    armCounterparty("leads", { id: 41, organizationId: 9 }, "seller@example.com");
    (filterSuppressed as any).mockResolvedValue({ allowed: ["SelLer@Example.COM"], suppressed: [] });
    const r = await executeHandWitnessed(
      "send_email",
      { ...ACREOS_USER, to: "  SelLer@Example.COM  " },
      "founder_1",
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("#41");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("checks across ALL orgs — passing a different organization_id does not buy a pass", async () => {
    armCounterparty("leads", { id: 41, organizationId: 9 });
    const r = await executeHandWitnessed(
      "send_email",
      { ...ACREOS_USER, organization_id: 12345 },
      "founder_1",
    );
    expect(r.success).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("runs BEFORE the suppression check, so the governance signal is not masked", async () => {
    armCounterparty("leads", { id: 41, organizationId: 9 });
    (filterSuppressed as any).mockResolvedValue({ allowed: [], suppressed: [ACREOS_USER.to] });
    const r = await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).toContain("counterparty");
    expect(r.output).not.toContain("suppression list");
  });

  it("FAILS CLOSED when the lookup itself errors — an errored check is not permission to send", async () => {
    state.lookupError = new Error("connection terminated unexpectedly");
    const r = await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    expect(r.success).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(r.output).toMatch(/fails closed/i);
    expect(r.output).toContain("connection terminated unexpectedly");
  });

  it("counterpartyMatch reports WHICH record matched", async () => {
    armCounterparty("autopay_enrollments", { id: 44, organizationId: 9 }, "borrower@example.com");
    const hit = await counterpartyMatch("borrower@example.com");
    expect(hit).toEqual({ kind: "borrower autopay enrollment", organizationId: 9, recordId: 44 });
    // An address that is nobody's counterparty resolves to null.
    expect(await counterpartyMatch("nobody@example.com")).toBeNull();
  });
});

// ── (c) the refusal is loud ─────────────────────────────────────────────────
describe("(c) the refusal is loud and names the reason", () => {
  it("names the ruling, the rule it protects, the matched record, and that nothing was sent", async () => {
    armCounterparty("leads", { id: 41, organizationId: 9 });
    const r = await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    expect(r.success).toBe(false);
    // the ruling being enforced, by date and by name
    expect(r.output).toContain("2026-08-16");
    expect(r.output).toMatch(/system-only/i);
    // the standing decision it protects
    expect(r.output).toContain("2026-07-17");
    expect(r.output).toMatch(/own connected email identity/i);
    // what was matched, specifically enough to go look at it
    expect(r.output).toMatch(/lead/i);
    expect(r.output).toContain("#41");
    expect(r.output).toContain("org 9");
    // and an unambiguous statement of the outcome
    expect(r.output).toMatch(/nothing was sent/i);
  });

  it("logs the refusal at warn with the matched record — not silently dropped", async () => {
    const warn = vi.spyOn(logger, "warn");
    armCounterparty("leads", { id: 41, organizationId: 9 });
    await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    const call = warn.mock.calls.find(([m]) => String(m).includes("send_email refused"));
    expect(call, "expected a warn-level log naming the refusal").toBeTruthy();
    expect((call![1] as any).metadata).toMatchObject({
      matchedRecordId: 41,
      counterpartyOrganizationId: 9,
    });
    warn.mockRestore();
  });

  it("does not fabricate a success — no messageId, no receipt-bearing send result", async () => {
    armCounterparty("leads", { id: 41, organizationId: 9 });
    const r = await executeHandWitnessed("send_email", ACREOS_USER, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).not.toContain("messageId");
    expect(() => JSON.parse(r.output)).toThrow();
  });
});
