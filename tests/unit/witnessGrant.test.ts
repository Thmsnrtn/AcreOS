import { describe, it, expect } from "vitest";
import {
  evaluateWitnessGrant,
  authorizeByAnyGrant,
  type WitnessGrant,
  type WitnessRequest,
} from "../../server/services/autopilot/witnessGrant";

/**
 * Frontier #13 — the WitnessGrant policy engine. The keystone test surface: a
 * grant may only ever NARROW, never widen; it fails CLOSED on every bound; and
 * an authorized delegation still carries grantor+grantee accountability.
 */
const NOW = Date.parse("2026-06-25T12:00:00.000Z");
const future = "2026-06-26T12:00:00.000Z";
const past = "2026-06-24T12:00:00.000Z";

const grant = (over: Partial<WitnessGrant> = {}): WitnessGrant => ({
  id: "g1",
  grantorId: "founder_1",
  granteeId: "delegate_1",
  bounds: { domains: ["support"], maxCostUsd: 10, maxActions: 5, expiresAt: future },
  usedCount: 0,
  revoked: false,
  issuedAt: past,
  ...over,
});

const req = (over: Partial<WitnessRequest> = {}): WitnessRequest => ({
  domain: "support",
  predictedCostUsd: 1,
  movesMoney: false,
  isBroadcast: false,
  granteeId: "delegate_1",
  ...over,
});

describe("evaluateWitnessGrant — authorizes only within bounds", () => {
  it("authorizes a request that satisfies every bound, with grantor+grantee attribution", () => {
    const v = evaluateWitnessGrant(grant(), req(), NOW);
    expect(v.authorized).toBe(true);
    expect(v.attribution).toEqual({ grantee: "delegate_1", grantor: "founder_1", grantId: "g1" });
  });
});

describe("evaluateWitnessGrant — fails CLOSED on every violation", () => {
  it("revoked", () => expect(evaluateWitnessGrant(grant({ revoked: true }), req(), NOW).authorized).toBe(false));
  it("expired", () => expect(evaluateWitnessGrant(grant({ bounds: { ...grant().bounds, expiresAt: past } }), req(), NOW).authorized).toBe(false));
  it("budget exhausted", () => expect(evaluateWitnessGrant(grant({ usedCount: 5 }), req(), NOW).authorized).toBe(false));
  it("wrong grantee (a different principal can't borrow the grant)", () =>
    expect(evaluateWitnessGrant(grant(), req({ granteeId: "someone_else" }), NOW).authorized).toBe(false));
  it("domain not covered", () => expect(evaluateWitnessGrant(grant(), req({ domain: "finance" }), NOW).authorized).toBe(false));
  it("over the per-action cost ceiling", () =>
    expect(evaluateWitnessGrant(grant(), req({ predictedCostUsd: 11 }), NOW).authorized).toBe(false));
  it("the permanent $500 spend hard-stop clamps even a generous grant ceiling", () => {
    // A founder-issued grant with maxCostUsd $10,000 must NOT authorize a
    // $501 spend — the >$500 hard-stop binds above every grant, forever.
    const generous = grant({ bounds: { ...grant().bounds, maxCostUsd: 10_000 } });
    const v = evaluateWitnessGrant(generous, req({ predictedCostUsd: 501 }), NOW);
    expect(v.authorized).toBe(false);
    expect(v.reason).toContain("hard-stop");
    // ...while a $499 spend under the same generous grant is still evaluable.
    expect(evaluateWitnessGrant(generous, req({ predictedCostUsd: 499 }), NOW).authorized).toBe(true);
  });
  it("money denied when denyMoney is set", () =>
    expect(evaluateWitnessGrant(grant({ bounds: { ...grant().bounds, domains: ["finance"], denyMoney: true } }), req({ domain: "finance", movesMoney: true }), NOW).authorized).toBe(false));
  it("broadcast denied when denyBroadcast is set", () =>
    expect(evaluateWitnessGrant(grant({ bounds: { ...grant().bounds, domains: ["growth"], denyBroadcast: true } }), req({ domain: "growth", isBroadcast: true }), NOW).authorized).toBe(false));
  it("malformed input → deny, never throw", () => {
    expect(evaluateWitnessGrant(null as unknown as WitnessGrant, req(), NOW).authorized).toBe(false);
    expect(evaluateWitnessGrant(grant({ grantorId: "" }), req(), NOW).authorized).toBe(false);
  });
  it("an empty-domains grant covers NOTHING (fail-closed default)", () =>
    expect(evaluateWitnessGrant(grant({ bounds: { ...grant().bounds, domains: [] } }), req(), NOW).authorized).toBe(false));
});

describe("evaluateWitnessGrant — a grant can only NARROW, never widen", () => {
  it("the cost ceiling is a strict ≤ (exactly at ceiling allowed, a cent over denied)", () => {
    expect(evaluateWitnessGrant(grant(), req({ predictedCostUsd: 10 }), NOW).authorized).toBe(true);
    expect(evaluateWitnessGrant(grant(), req({ predictedCostUsd: 10.01 }), NOW).authorized).toBe(false);
  });
  it("at expiry instant it's already dead (>=, not >)", () => {
    expect(evaluateWitnessGrant(grant({ bounds: { ...grant().bounds, expiresAt: new Date(NOW).toISOString() } }), req(), NOW).authorized).toBe(false);
  });
});

describe("authorizeByAnyGrant", () => {
  it("returns the first authorizing grant + its attribution", () => {
    const g1 = grant({ id: "a", bounds: { ...grant().bounds, domains: ["finance"] } }); // won't cover support
    const g2 = grant({ id: "b" }); // covers support
    const { verdict, grant: winner } = authorizeByAnyGrant([g1, g2], req(), NOW);
    expect(verdict.authorized).toBe(true);
    expect(winner?.id).toBe("b");
  });
  it("denies when NO grant covers the request", () => {
    const { verdict, grant: winner } = authorizeByAnyGrant([grant({ revoked: true })], req(), NOW);
    expect(verdict.authorized).toBe(false);
    expect(winner).toBeNull();
  });
  it("denies on an empty grant set (status quo — the founder must tap)", () => {
    expect(authorizeByAnyGrant([], req(), NOW).verdict.authorized).toBe(false);
  });
});
