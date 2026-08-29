/**
 * The outbound seam refuses like the hand and freezes instead of sending
 * (stage-4 turn 4). Driven against the real proposeGovernedEmail with its
 * three dependencies mocked at the module boundary. The seam must NEVER
 * send — there is no emailService mock here because the seam must not even
 * import it; a send appearing in this module is a design regression the
 * import assertion at the bottom catches at the source level.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
  counterpartyHit: null as null | { kind: string; recordId: number; organizationId: number },
  counterpartyThrows: false,
  suppressed: false,
  proposed: [] as any[],
  proposeReturns: undefined as any,
}));

vi.mock("../../server/services/autopilot/pendingHands", () => ({
  proposePendingHand: vi.fn(async (input: any) => {
    state.proposed.push(input);
    if (state.proposeReturns !== undefined) return state.proposeReturns;
    return { id: 42, createdAt: new Date(), status: "pending" };
  }),
}));
vi.mock("../../server/services/autopilot/hands/counterpartyMatch", () => ({
  counterpartyMatch: vi.fn(async () => {
    if (state.counterpartyThrows) throw new Error("db down");
    return state.counterpartyHit;
  }),
}));
vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(async (addrs: string[]) => ({
    allowed: state.suppressed ? [] : addrs,
    suppressed: state.suppressed ? addrs : [],
  })),
}));

import { proposeGovernedEmail } from "../../server/services/autopilot/outboundSeam";

const BASE = {
  organizationId: 1,
  to: "owner@customer.example",
  subject: "Your weekly summary",
  html: "<p>hi</p>",
  source: "test:probe",
};

beforeEach(() => {
  state.counterpartyHit = null;
  state.counterpartyThrows = false;
  state.suppressed = false;
  state.proposed = [];
  state.proposeReturns = undefined;
});

describe("outboundSeam — refuses like the hand, freezes instead of sending", () => {
  it("freezes a clean send as a pending witnessed action with source attribution", async () => {
    const r = await proposeGovernedEmail(BASE);
    expect(r).toEqual({ proposed: true, pendingActionId: 42, deduped: false });
    expect(state.proposed).toHaveLength(1);
    expect(state.proposed[0].handName).toBe("send_email");
    expect(state.proposed[0].args.proposed_by).toBe("test:probe");
    expect(state.proposed[0].summary).toContain("test:probe");
  });

  it("refuses a customer counterparty and proposes nothing", async () => {
    state.counterpartyHit = { kind: "lead", recordId: 9, organizationId: 3 };
    const r = await proposeGovernedEmail(BASE);
    expect(r.proposed).toBe(false);
    if (!r.proposed) expect(r.refusal).toMatch(/counterparty/i);
    expect(state.proposed).toHaveLength(0);
  });

  it("FAILS CLOSED when the counterparty lookup errors", async () => {
    state.counterpartyThrows = true;
    const r = await proposeGovernedEmail(BASE);
    expect(r.proposed).toBe(false);
    if (!r.proposed) expect(r.refusal).toMatch(/fail|could not verify/i);
    expect(state.proposed).toHaveLength(0);
  });

  it("refuses a suppressed recipient before the door ever sees a card", async () => {
    state.suppressed = true;
    const r = await proposeGovernedEmail(BASE);
    expect(r.proposed).toBe(false);
    if (!r.proposed) expect(r.refusal).toMatch(/suppress/i);
    expect(state.proposed).toHaveLength(0);
  });

  it("reports an honest failure when the freeze itself fails", async () => {
    state.proposeReturns = null;
    const r = await proposeGovernedEmail(BASE);
    expect(r.proposed).toBe(false);
    if (!r.proposed) expect(r.refusal).toMatch(/nothing was sent or queued/i);
  });

  it("dedupes: an existing live pending row reports deduped:true", async () => {
    state.proposeReturns = { id: 7, createdAt: new Date(Date.now() - 60_000), status: "pending" };
    const r = await proposeGovernedEmail(BASE);
    expect(r).toEqual({ proposed: true, pendingActionId: 7, deduped: true });
  });

  it("the seam cannot send: it never imports emailService", () => {
    // Source-level pin for the property the mocks cannot prove. The seam's
    // whole design is freeze-don't-send; an emailService import appearing
    // here is the regression this catches.
    const src = fs.readFileSync(
      path.join(__dirname, "../../server/services/autopilot/outboundSeam.ts"),
      "utf8",
    );
    // Import-line match only — the header PROSE legitimately names
    // emailService when describing what callers used to do.
    expect(src).not.toMatch(/from\s+["'][^"']*emailService/);
    const code = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/(?<![.\w])sendEmail\s*\(/);
  });
});
