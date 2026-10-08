/**
 * H1/H2 — a delegated release (a WitnessGrant, not a founder tap) is re-checked
 * AT EXECUTION, inside executeHandWitnessed: the hand/role bounds against the
 * frozen row's source role, the founder's controls (dispatch off, domain
 * paused, domain at OBSERVE) and the hand's own delegated rules. A founder's
 * own tap is not subject to them.
 *
 * And the delegated rules themselves (delegationRules.ts), driven against fake
 * data: the email recipient must be the org's owner; the controls block.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  panic: false,
  dispatchEnabled: true,
  paused: [] as string[],
  level: "draft",
  ownerByOrg: { 5: "u-owner" } as Record<number, string>,
  emailByUser: { "u-owner": "owner@acme.test", "u-other": "other@acme.test" } as Record<string, string>,
}));

vi.mock("../../server/services/autopilot/settings", () => ({
  isPanicStopped: () => state.panic,
  getEffectiveSettings: async () => ({ dispatchEnabled: state.dispatchEnabled }),
}));
vi.mock("../../server/services/autopilot/founderControls", () => ({
  getControlState: async () => ({ pausedDomains: state.paused, adsEnabled: true }),
}));
vi.mock("../../server/services/autopilot/domainAutonomy", () => ({
  getDomainLevel: async () => state.level,
}));
vi.mock("../../server/services/autopilot/proofReceiptStore", () => ({ recordReceipt: async () => null }));

// A tiny fake for the two owner lookups ownerEmailOf makes (organizations → users).
vi.mock("../../server/utils/orgScopedDb", () => ({
  unscopedForPlatformOps: () => {
    let table = "";
    let id: unknown = null;
    const chain = {
      select: () => chain,
      from: (t: { [k: symbol]: unknown }) => {
        table = String((t as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ?? "");
        return chain;
      },
      where: (cond: { queryChunks?: unknown[] }) => {
        const p = (cond.queryChunks ?? []).find((c) => (c as object)?.constructor?.name === "Param") as { value?: unknown } | undefined;
        id = p?.value;
        return chain;
      },
      limit: async () => {
        if (table === "organizations") return state.ownerByOrg[Number(id)] ? [{ ownerId: state.ownerByOrg[Number(id)] }] : [];
        if (table === "users") return state.emailByUser[String(id)] ? [{ email: state.emailByUser[String(id)] }] : [];
        return [];
      },
    };
    return chain;
  },
}));

import { registerHand, executeHandWitnessed, __resetHandsForTest } from "../../server/services/autopilot/hands/registry";
import { delegatedHandRefusal, delegationBlockedByControls } from "../../server/services/autopilot/delegationRules";

const handler = vi.fn(async () => ({ success: true, output: "sent", durationMs: 0 }));
const DELEGATED = "solene (delegated by founder-tom via witness-grant #3)";
const ownerMail = { to: "owner@acme.test", subject: "s", html: "<p>h</p>", organization_id: 5 };

beforeEach(() => {
  Object.assign(state, { panic: false, dispatchEnabled: true, paused: [], level: "draft" });
  __resetHandsForTest();
  handler.mockClear();
  registerHand({
    name: "send_email",
    schema: { name: "send_email", description: "test stand-in", input_schema: {} },
    domain: "support",
    isCustomerFacing: true,
    movesMoney: false,
    outwardClass: "none",
    requiresApproval: true,
    surface: "support",
    handler,
  });
});

describe("executeHandWitnessed — a delegated release is re-checked at execution", () => {
  it("runs a delegated release that every rule allows", async () => {
    const r = await executeHandWitnessed("send_email", ownerMail, DELEGATED, { delegation: { grantId: "3", sourceRole: "retention" } });
    expect(r.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the domain was paused after the sweep", () => (state.paused = ["support"]), /paused support/],
    ["dispatch was switched off", () => (state.dispatchEnabled = false), /dispatch disabled/],
    ["the domain is quarantined at OBSERVE", () => (state.level = "observe"), /OBSERVE/],
  ])("refuses when %s", async (_l, arrange, why) => {
    arrange();
    const r = await executeHandWitnessed("send_email", ownerMail, DELEGATED, { delegation: { grantId: "3", sourceRole: "retention" } });
    expect(r.success).toBe(false);
    expect(r.output).toMatch(why);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a draft whose role may not draft this hand", async () => {
    const r = await executeHandWitnessed("send_email", ownerMail, DELEGATED, { delegation: { grantId: "3", sourceRole: "support" } });
    expect(r.success).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("an approver carrying grant attribution is delegated even without the flag (fails closed: no role)", async () => {
    const r = await executeHandWitnessed("send_email", ownerMail, DELEGATED, {});
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/DELEGATED-RELEASE/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a delegated email to anyone but the org's owner", async () => {
    const r = await executeHandWitnessed("send_email", { ...ownerMail, to: "stranger@elsewhere.test" }, DELEGATED, { delegation: { grantId: "3", sourceRole: "retention" } });
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/only go to the owner/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("a founder's own tap is not a delegated release", async () => {
    state.paused = ["support"];
    const r = await executeHandWitnessed("send_email", { ...ownerMail, to: "stranger@elsewhere.test" }, "founder-tom", {});
    expect(r.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("delegationRules", () => {
  it("send_email: owner passes, anyone else (or a missing org) is refused", async () => {
    expect(await delegatedHandRefusal("send_email", ownerMail)).toBeNull();
    expect(await delegatedHandRefusal("send_email", { ...ownerMail, to: "OWNER@acme.test " })).toBeNull();
    expect(await delegatedHandRefusal("send_email", { ...ownerMail, to: "other@acme.test" })).toMatch(/only go to the owner/);
    expect(await delegatedHandRefusal("send_email", { ...ownerMail, organization_id: 6 })).toMatch(/no owner email/);
    expect(await delegatedHandRefusal("send_email", { to: "owner@acme.test" })).toMatch(/must name its organization/);
  });
  it("an unlisted hand is refused", async () => {
    expect(await delegatedHandRefusal("run_ad_campaign", {})).toMatch(/never released by a grant/);
  });
  it("controls: panic, dispatch off, pause, observe each block; a clear board does not", async () => {
    expect(await delegationBlockedByControls("support")).toBeNull();
    state.panic = true;
    expect(await delegationBlockedByControls("support")).toMatch(/panic/);
    state.panic = false;
    state.level = "observe";
    expect(await delegationBlockedByControls("support")).toMatch(/OBSERVE/);
  });
});
